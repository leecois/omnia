// /ask RAG handler.
//
// Subscribes to ask_request inserts, processes pending rows one at a time:
//   1. Embed the question via the configured LLM provider.
//   2. Vector-search Qdrant filtered by the requesting server's ID.
//   3. Fetch the matching messages from SpacetimeDB's local cache (they
//      are already synced via our subscription).
//   4. Build a prompt with relevant context snippets.
//   5. Call the LLM chat completion endpoint.
//   6. Post the answer as a regular message via sendMessage reducer.
//   7. Call resolveAskRequest to flip the row's status to 'answered'
//      and log token usage into ai_audit.
//
// Failures are captured via failAskRequest so the UI can surface them.

import type { DbConnection } from '../../src/module_bindings/index.ts';
import type { AiConfig, AskRequest, Message } from '../../src/module_bindings/types.ts';
import type { BotConfig } from './config.ts';
import type { LLMAdapter } from './llm.ts';
import type { QdrantStore } from './qdrant.ts';

const SYSTEM_PROMPT = `You are Omnia, a helpful documentation assistant for a chat platform.
You answer questions grounded in the provided context snippets from the community.

RULES:
- If the context doesn't contain the answer, say so politely — do NOT guess.
- Keep answers concise (≤ 6 sentences unless the question clearly needs detail).
- Respond in the same language as the question.
- Use markdown formatting (lists, code blocks) when it aids clarity.
- Do NOT include citations, source links, or a "Sources" section in the response.`;

export class RAGHandler {
  private processing = new Set<string>();
  private cumulativeHitFilter = {
    missingMessage: 0,
    missingChannel: 0,
    wrongServer: 0,
    policyDenied: 0,
  };

  constructor(
    private conn: DbConnection,
    private qdrant: QdrantStore,
    private llm: LLMAdapter,
    private cfg: BotConfig,
    private botIdentityHex: string
  ) {}

  /** Ensure the bot is a server_member so send_message won't reject it. */
  private async ensureBotMember(serverId: bigint): Promise<void> {
    for (const m of this.conn.db.server_member.byServerId.filter(serverId)) {
      if (m.userIdentity.toHexString() === this.botIdentityHex) return;
    }
    try {
      await this.conn.reducers.joinAsBot({ serverId });
      console.log(`[rag] joined server ${serverId} as bot member`);
    } catch {
      // Idempotent — ignore "already a member" races.
    }
  }

  private allowedChannels(sourceChannelIds: string): Set<string> | null {
    const raw = sourceChannelIds.trim();
    if (raw === '') return null;
    return new Set(
      raw
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    );
  }

  private isChannelSearchEnabled(
    cfg: AiConfig,
    channelId: bigint,
    allowedChannels: Set<string> | null
  ): boolean {
    if (allowedChannels !== null && !allowedChannels.has(channelId.toString())) return false;
    const chCfg = this.conn.db.channel_ai_config.channelId.find(channelId);
    if (chCfg) return chCfg.indexingEnabled;
    return cfg.indexingEnabledByDefault;
  }

  /** Scan existing pending rows on startup, then watch for new inserts. */
  start(): void {
    // Catch any rows that existed before we connected (bot restart while
    // requests were in-flight).
    for (const req of this.conn.db.ask_request.iter()) {
      if (req.status === 'pending') {
        void this.tryHandle(req);
      }
    }
    // Live: pick up new pending requests.
    this.conn.db.ask_request.onInsert((_ctx, req) => {
      if (req.status !== 'pending') return;
      void this.tryHandle(req);
    });
    console.log('[rag] handler started');
  }

  private async tryHandle(req: AskRequest): Promise<void> {
    const key = req.id.toString();
    if (this.processing.has(key)) return;
    this.processing.add(key);
    try {
      await this.handle(req);
    } catch (err) {
      console.error(`[rag] failed to handle request ${key}:`, err);
      try {
        const msg = err instanceof Error ? err.message : String(err);
        await this.conn.reducers.failAskRequest({
          requestId: req.id,
          errorMessage: msg,
        });
      } catch (innerErr) {
        console.error(`[rag] failAskRequest call failed for ${key}:`, innerErr);
      }
    } finally {
      this.processing.delete(key);
    }
  }

  private async handle(req: AskRequest): Promise<void> {
    console.log(
      `[rag] handling request #${req.id} in channel ${req.channelId}: "${req.question.slice(0, 60)}…"`
    );

    // Confirm the feature is still enabled at handle time (config can change).
    const cfg = this.conn.db.ai_config.serverId.find(req.serverId);
    if (!cfg || !cfg.enabled || !cfg.askEnabled) {
      throw new Error('AI assistant disabled for this server');
    }
    const allowedChannels = this.allowedChannels(cfg.sourceChannelIds);

    // 1. Embed the question.
    const qVec = await this.llm.embed(req.question);

    // 2. Vector search filtered by server.
    const hits = await this.qdrant.search(qVec, {
      serverId: req.serverId,
      limit: this.cfg.topK,
    });

    // 3. Resolve hits against the local SpacetimeDB cache. If a point is
    //    stale (message deleted), skip it.
    const contexts: Array<{ msg: Message; score: number }> = [];
    const filterStats = {
      total: hits.length,
      accepted: 0,
      missingMessage: 0,
      missingChannel: 0,
      wrongServer: 0,
      policyDenied: 0,
    };
    for (const hit of hits) {
      const msgId = BigInt(hit.point.messageId);
      const msg = this.conn.db.message.id.find(msgId);
      if (!msg) {
        filterStats.missingMessage++;
        continue;
      }
      const channel = this.conn.db.channel.id.find(msg.channelId);
      if (!channel) {
        filterStats.missingChannel++;
        continue;
      }
      if (channel.serverId !== req.serverId) {
        filterStats.wrongServer++;
        continue;
      }
      if (!this.isChannelSearchEnabled(cfg, msg.channelId, allowedChannels)) {
        filterStats.policyDenied++;
        continue;
      }
      contexts.push({ msg, score: hit.score });
      filterStats.accepted++;
      if (totalChars(contexts) >= this.cfg.maxContextChars) break;
    }
    this.cumulativeHitFilter.missingMessage += filterStats.missingMessage;
    this.cumulativeHitFilter.missingChannel += filterStats.missingChannel;
    this.cumulativeHitFilter.wrongServer += filterStats.wrongServer;
    this.cumulativeHitFilter.policyDenied += filterStats.policyDenied;
    const rejectedTotal =
      filterStats.missingMessage +
      filterStats.missingChannel +
      filterStats.wrongServer +
      filterStats.policyDenied;
    const accountedTotal = filterStats.accepted + rejectedTotal;
    console.log(
      `[rag] hit filter request #${req.id}: total=${filterStats.total} accepted=${filterStats.accepted} rejected=${rejectedTotal} accounted=${accountedTotal} ` +
        `rejected={missingMessage:${filterStats.missingMessage},missingChannel:${filterStats.missingChannel},` +
        `wrongServer:${filterStats.wrongServer},policyDenied:${filterStats.policyDenied}} ` +
        `cumulative={missingMessage:${this.cumulativeHitFilter.missingMessage},missingChannel:${this.cumulativeHitFilter.missingChannel},` +
        `wrongServer:${this.cumulativeHitFilter.wrongServer},policyDenied:${this.cumulativeHitFilter.policyDenied}}`
    );

    // Apply authority weight multiplier from channel_ai_config.
    // Low=0.5, Normal=1.0, High=1.5, Canonical=2.0
    const WEIGHT_MULTIPLIERS = [0.5, 1.0, 1.5, 2.0];
    for (const entry of contexts) {
      const chCfg = this.conn.db.channel_ai_config.channelId.find(entry.msg.channelId);
      const weight = chCfg?.authorityWeight ?? 1;
      entry.score *= WEIGHT_MULTIPLIERS[weight] ?? 1.0;
    }
    contexts.sort((a, b) => b.score - a.score);

    if (contexts.length === 0) {
      // No sources — degrade gracefully with a "not found" answer.
      await this.ensureBotMember(req.serverId);
      const answerText =
        `I couldn't find anything in the docs that answers **"${req.question}"**. ` +
        'Try rephrasing or ask a human member of the server.';
      await this.postAnswer(req, answerText, 0, 0, 0n);
      return;
    }

    // 4. Build the prompt.
    const contextBlock = contexts
      .map(c => `- (${fmtDate(c.msg.sent.microsSinceUnixEpoch)}) ${c.msg.text.trim()}`)
      .join('\n\n');

    const userPrompt = `QUESTION:\n${req.question}\n\nCONTEXT:\n${contextBlock}`;

    // Collect pinned contexts from channels referenced in results.
    const seenChannels = new Set<string>();
    const pinnedParts: string[] = [];
    for (const c of contexts) {
      const chKey = c.msg.channelId.toString();
      if (seenChannels.has(chKey)) continue;
      seenChannels.add(chKey);
      const chCfg = this.conn.db.channel_ai_config.channelId.find(c.msg.channelId);
      if (chCfg?.pinnedContext?.trim()) {
        const chName = this.conn.db.channel.id.find(c.msg.channelId)?.name ?? chKey;
        pinnedParts.push(`[#${chName}]: ${chCfg.pinnedContext.trim()}`);
      }
    }
    let systemPrompt = SYSTEM_PROMPT;
    if (pinnedParts.length > 0) {
      systemPrompt += '\n\nCHANNEL CONTEXT:\n' + pinnedParts.join('\n');
    }

    // 5. Call the LLM.
    const res = await this.llm.chat(systemPrompt, userPrompt);

    // 6. Keep output clean: no citation markers or trailing source footer.
    const answerText = stripSourceMentions(res.text);

    // 7. Ensure the bot is a member before posting (no-op if already joined).
    await this.ensureBotMember(req.serverId);

    // 8. Post the answer and resolve.
    await this.postAnswer(req, answerText, res.inputTokens, res.outputTokens, res.costMicros);
  }

  private async postAnswer(
    req: AskRequest,
    answerText: string,
    inputTokens: number,
    outputTokens: number,
    costMicros: bigint
  ): Promise<void> {
    // Call sendMessage reducer. Single-object argument per SpacetimeDB SDK v2.
    // MUST be awaited — reducer calls return Promise<void> and reject if the
    // server-side reducer throws. Unhandled rejections crash the bot.
    //
    // The question is already in the channel as a normal message (the
    // createAskRequest reducer inserted it). We reply TO that message so the
    // answer renders as a threaded reply in the existing reply-rendering UI.
    await this.conn.reducers.sendMessage({
      channelId: req.channelId,
      threadId: req.threadId,
      replyToId: req.questionMessageId,
      text: answerText,
      attachmentUrl: '',
    });

    // Resolve the request. answerMessageId is 0n for now — the frontend
    // correlates answer ⇄ request by looking at bot-authored messages in
    // the channel after the request's createdAt timestamp.
    await this.conn.reducers.resolveAskRequest({
      requestId: req.id,
      answerMessageId: 0n,
      inputTokens,
      outputTokens,
      costMicros,
    });

    console.log(
      `[rag] resolved request #${req.id} — ${inputTokens}+${outputTokens} tokens, ` +
        `$${(Number(costMicros) / 1_000_000).toFixed(4)}`
    );
  }
}

function totalChars(contexts: Array<{ msg: Message }>): number {
  let total = 0;
  for (const c of contexts) total += c.msg.text.length;
  return total;
}

function fmtDate(micros: bigint): string {
  const ms = Number(micros / 1000n);
  return new Date(ms).toISOString().slice(0, 10);
}

function stripSourceMentions(text: string): string {
  let out = text.trim();

  // Remove explicit source/footer sections.
  out = out.replace(/\n{0,2}_?\s*sources?\s*:[\s\S]*$/im, '').trim();
  out = out.replace(/\n{0,2}_?\s*references?\s*:[\s\S]*$/im, '').trim();
  out = out.replace(/\n{0,2}_?\s*nguồn\s*:[\s\S]*$/im, '').trim();
  out = out.replace(/\n{0,2}_?\s*tài\s*liệu\s*tham\s*khảo\s*:[\s\S]*$/im, '').trim();

  // Remove inline citation markers like [1], [12], [[3]](/link).
  out = out.replace(/\[\[(\d+)\]\]\([^)]*\)/g, '');
  out = out.replace(/(?<![\w\]])\[(\d{1,2})\](?!\w)/g, '');

  return out.replace(/[ \t]{2,}/g, ' ').trim();
}
