// /ask RAG handler.
//
// Subscribes to ask_request inserts, processes pending rows one at a time:
//   1. Embed the question via the configured LLM provider.
//   2. Vector-search Qdrant filtered by the requesting server's ID.
//   3. Fetch the matching messages from SpacetimeDB's local cache (they
//      are already synced via our subscription).
//   4. Build a prompt with [1] [2] ... citation markers.
//   5. Call the LLM chat completion endpoint.
//   6. Post the answer as a regular message via sendMessage reducer.
//   7. Call resolveAskRequest to flip the row's status to 'answered'
//      and log token usage into ai_audit.
//
// Failures are captured via failAskRequest so the UI can surface them.

import type { DbConnection } from '../../src/module_bindings/index.ts';
import type { AskRequest, Message } from '../../src/module_bindings/types.ts';
import type { BotConfig } from './config.ts';
import type { LLMAdapter } from './llm.ts';
import type { QdrantStore } from './qdrant.ts';

const SYSTEM_PROMPT = `You are Omnia, a helpful documentation assistant for a chat platform.
You answer questions grounded in the provided context snippets from the community.

RULES:
- Cite sources inline with [N] markers matching the context numbering.
- If the context doesn't contain the answer, say so politely — do NOT guess.
- Keep answers concise (≤ 6 sentences unless the question clearly needs detail).
- Respond in the same language as the question.
- Use markdown formatting (lists, code blocks) when it aids clarity.`;

export class RAGHandler {
  private processing = new Set<string>();

  constructor(
    private conn: DbConnection,
    private qdrant: QdrantStore,
    private llm: LLMAdapter,
    private cfg: BotConfig
  ) {}

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

    // 1. Embed the question.
    const qVec = await this.llm.embed(req.question);

    // 2. Vector search filtered by server.
    const hits = await this.qdrant.search(qVec, {
      serverId: req.serverId,
      limit: this.cfg.topK,
    });

    // 3. Resolve hits against the local SpacetimeDB cache. If a point is
    //    stale (message deleted), skip it.
    const contexts: Array<{ rank: number; msg: Message; score: number }> = [];
    for (const hit of hits) {
      const msgId = BigInt(hit.point.messageId);
      const msg = this.conn.db.message.id.find(msgId);
      if (msg) {
        contexts.push({ rank: contexts.length + 1, msg, score: hit.score });
        if (totalChars(contexts) >= this.cfg.maxContextChars) break;
      }
    }

    if (contexts.length === 0) {
      // No sources — degrade gracefully with a "not found" answer.
      const answerText =
        `I couldn't find anything in the docs that answers **"${req.question}"**. ` +
        'Try rephrasing or ask a human member of the server.';
      await this.postAnswer(req, answerText, 0, 0, 0n);
      return;
    }

    // 4. Build the prompt.
    const contextBlock = contexts
      .map(c => `[${c.rank}] (${fmtDate(c.msg.sent.microsSinceUnixEpoch)}) ${c.msg.text.trim()}`)
      .join('\n\n');

    const userPrompt = `QUESTION:\n${req.question}\n\nCONTEXT:\n${contextBlock}`;

    // 5. Call the LLM.
    const res = await this.llm.chat(SYSTEM_PROMPT, userPrompt);

    // 6. Append a citations footer with deep-links to each source message.
    // Path format: /c/:serverId/:channelId/:messageId (matches useRoute.ts)
    const citations = contexts
      .map(c => `[[${c.rank}]](/c/${req.serverId}/${c.msg.channelId}/${c.msg.id})`)
      .join('  ');
    const answerText = `${res.text}\n\n_Sources: ${citations}_`;

    // 7. Post the answer and resolve.
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
