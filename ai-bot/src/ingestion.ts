// Message ingestion pipeline.
//
// The bot watches the `message` table for inserts, embeds the content, and
// upserts the vector into Qdrant. On startup it also runs a backfill so
// existing messages become searchable immediately.
//
// We only index messages that belong to a server whose ai_config.enabled
// flag is true — this keeps cost predictable and lets admins opt in
// per-server. If ai_config.source_channel_ids is non-empty, only messages
// from those channels are indexed (the "docs channels" subset).
//
// Note: `message` rows do NOT carry server_id — we look it up via
// `channel.serverId` using the locally-cached channel table.

import type { DbConnection } from '../../src/module_bindings/index.ts';
import type { Message, AiConfig } from '../../src/module_bindings/types.ts';
import type { LLMAdapter } from './llm.ts';
import type { QdrantStore, MessagePoint } from './qdrant.ts';
import type { BotConfig } from './config.ts';

export class Ingester {
  private backfilled = new Set<string>();  // server IDs we've already backfilled this session

  constructor(
    private conn: DbConnection,
    private qdrant: QdrantStore,
    private llm: LLMAdapter,
    private _cfg: BotConfig,
    private botIdentityHex: string,
  ) {}

  /** Return the serverId for a given channelId, or null if unknown. */
  private serverIdForChannel(channelId: bigint): bigint | null {
    const ch = this.conn.db.channel.id.find(channelId);
    return ch ? ch.serverId : null;
  }

  /** Return the set of server IDs with ai_config.enabled = true. */
  private enabledServerIds(): Set<string> {
    const out = new Set<string>();
    for (const c of this.conn.db.ai_config.iter()) {
      if (c.enabled) out.add(c.serverId.toString());
    }
    return out;
  }

  /** Return allowed channel IDs for a given server (null = wildcard all). */
  private allowedChannels(serverId: bigint): Set<string> | null {
    const cfg = this.conn.db.ai_config.serverId.find(serverId);
    if (!cfg) return new Set(); // AI not enabled = deny all
    const raw = cfg.sourceChannelIds.trim();
    if (raw === '') return null; // null = wildcard
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
  }

  private shouldIndex(msg: Message): { ok: boolean; serverId: bigint | null } {
    // Never index the bot's own messages — they would poison the RAG
    // context with its own answers and create a self-referential loop.
    if (msg.authorId.toHexString() === this.botIdentityHex) {
      return { ok: false, serverId: null };
    }
    const serverId = this.serverIdForChannel(msg.channelId);
    if (serverId === null) return { ok: false, serverId: null };
    const enabled = this.enabledServerIds();
    if (!enabled.has(serverId.toString())) return { ok: false, serverId };
    const allowed = this.allowedChannels(serverId);
    if (allowed === null) return { ok: true, serverId };            // wildcard
    return { ok: allowed.has(msg.channelId.toString()), serverId };
  }

  private toPoint(msg: Message, serverId: bigint): MessagePoint {
    return {
      messageId:       msg.id.toString(),
      serverId:        serverId.toString(),
      channelId:       msg.channelId.toString(),
      threadId:        msg.threadId.toString(),
      authorIdentity:  msg.authorId.toHexString(),
      createdAtMicros: msg.sent.microsSinceUnixEpoch.toString(),
      content:         msg.text,
    };
  }

  private trim(text: string): string {
    // Strip trivial content before embedding (cost + noise reduction).
    const t = text.trim();
    if (t.length === 0) return t;
    // Slash commands shouldn't pollute the index.
    if (t.startsWith('/')) return '';
    return t.slice(0, 4000);
  }

  /** Backfill every message for every enabled server that hasn't been
   *  done yet this session. Called on startup AND whenever a server's
   *  ai_config flips from disabled→enabled. */
  async backfillAll(): Promise<void> {
    const enabled = this.enabledServerIds();
    if (enabled.size === 0) {
      console.log('[ingest] no ai-enabled servers, skipping backfill');
      return;
    }
    for (const serverIdStr of enabled) {
      if (this.backfilled.has(serverIdStr)) continue;
      await this.backfillServer(BigInt(serverIdStr));
    }
  }

  private async backfillServer(serverId: bigint): Promise<void> {
    const key = serverId.toString();
    if (this.backfilled.has(key)) return;
    this.backfilled.add(key);

    // Collect every human message in this server.
    const batch: Message[] = [];
    for (const m of this.conn.db.message.iter()) {
      if (m.authorId.toHexString() === this.botIdentityHex) continue;
      const ch = this.conn.db.channel.id.find(m.channelId);
      if (!ch || ch.serverId !== serverId) continue;
      const allowed = this.allowedChannels(serverId);
      if (allowed !== null && !allowed.has(m.channelId.toString())) continue;
      batch.push(m);
    }
    if (batch.length === 0) {
      console.log(`[ingest] server ${serverId}: no human messages to backfill`);
      return;
    }
    console.log(`[ingest] server ${serverId}: backfilling ${batch.length} messages`);
    const CHUNK = 32;
    for (let i = 0; i < batch.length; i += CHUNK) {
      const slice = batch.slice(i, i + CHUNK);
      const kept: Array<{ msg: Message; text: string }> = [];
      for (const msg of slice) {
        const text = this.trim(msg.text);
        if (text.length > 0) kept.push({ msg, text });
      }
      if (kept.length === 0) continue;
      try {
        const vectors = await this.llm.embedBatch(kept.map(k => k.text));
        await this.qdrant.upsertMany(
          kept.map((k, idx) => ({
            point: this.toPoint(k.msg, serverId),
            vector: vectors[idx]!,
          })),
        );
        console.log(`[ingest] server ${serverId}: backfilled ${Math.min(i + CHUNK, batch.length)}/${batch.length}`);
      } catch (err) {
        console.error(`[ingest] server ${serverId}: backfill chunk failed:`, err);
        await new Promise(r => setTimeout(r, 1000));
      }
    }
  }

  /** Wire up the live message-insert listener and ai_config watcher. */
  subscribeLive(): void {
    this.conn.db.message.onInsert((_ctx, msg) => {
      void this.handleNew(msg);
    });
    this.conn.db.message.onDelete((_ctx, msg) => {
      void this.qdrant.deleteMessage(msg.id).catch(err => {
        console.error('[ingest] qdrant delete failed for message', msg.id, err);
      });
    });

    // When a server flips ai_config.enabled from false→true we need to
    // backfill its existing messages. ai_config has a primary key on
    // serverId so onUpdate is exposed.
    this.conn.db.ai_config.onUpdate((_ctx, oldRow, newRow) => {
      if (!oldRow.enabled && newRow.enabled) {
        console.log(`[ingest] ai_config enabled for server ${newRow.serverId}, starting backfill`);
        void this.backfillServer(newRow.serverId);
      }
      if (oldRow.enabled && !newRow.enabled) {
        // Allow a future enable to re-trigger backfill.
        this.backfilled.delete(newRow.serverId.toString());
        console.log(`[ingest] ai_config disabled for server ${newRow.serverId}`);
      }
    });
    this.conn.db.ai_config.onInsert((_ctx, row) => {
      if (row.enabled) {
        console.log(`[ingest] ai_config inserted already-enabled for server ${row.serverId}, starting backfill`);
        void this.backfillServer(row.serverId);
      }
    });
  }

  private async handleNew(msg: Message): Promise<void> {
    const check = this.shouldIndex(msg);
    if (!check.ok || check.serverId === null) return;
    const text = this.trim(msg.text);
    if (text.length === 0) return;
    try {
      const vec = await this.llm.embed(text);
      await this.qdrant.upsert(this.toPoint(msg, check.serverId), vec);
    } catch (err) {
      console.error('[ingest] failed to index message', msg.id.toString(), err);
    }
  }
}

export function enabledServerSummary(conn: DbConnection): AiConfig[] {
  const out: AiConfig[] = [];
  for (const c of conn.db.ai_config.iter()) {
    if (c.enabled) out.push(c);
  }
  return out;
}
