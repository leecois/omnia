// Thin wrapper around @qdrant/js-client-rest with:
//   * idempotent collection bootstrap
//   * upsert helpers that encode our message payload schema
//   * search helpers that filter by server_id so cross-server
//     retrieval leakage is impossible at the vector layer

import { QdrantClient } from '@qdrant/js-client-rest';
import type { BotConfig } from './config.ts';

export interface MessagePoint {
  messageId: string; // stringified bigint
  serverId: string;
  channelId: string;
  threadId: string; // '0' when message is top-level
  authorIdentity: string; // hex
  createdAtMicros: string;
  content: string;
  roleLabel?: string;       // from channel_ai_config (default: 'general')
  authorityWeight?: number; // from channel_ai_config (0-3, default: 1)
}

export interface SearchResult {
  point: MessagePoint;
  score: number;
}

// Qdrant point IDs must be unsigned integers or UUIDs. We use the message's
// BigInt ID cast to a JS number because SpacetimeDB IDs fit in u64; for safety
// against overflow we also accept string IDs for collision-free addressing.
function messageIdToPointId(messageId: bigint): number {
  // Safe integer cap is 2^53; SpacetimeDB autoinc starts at 1 so we'll stay
  // well below this for the foreseeable future. Guard anyway.
  if (messageId > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`Message ID ${messageId} exceeds safe integer — use UUID IDs instead`);
  }
  return Number(messageId);
}

export class QdrantStore {
  private client: QdrantClient;
  constructor(private cfg: BotConfig) {
    // port: null stops the client from appending :6333 (Qdrant's default
    // REST port) to the URL. Our Dokploy-hosted instance is behind Traefik
    // on standard HTTPS 443, so the port should come from the URL itself.
    this.client = new QdrantClient({
      url: cfg.qdrantUrl,
      apiKey: cfg.qdrantApiKey,
      port: null,
      checkCompatibility: false,
    });
  }

  async ensureCollection(): Promise<void> {
    try {
      await this.client.getCollection(this.cfg.qdrantCollection);
      return;
    } catch {
      // fall through — collection doesn't exist yet
    }
    await this.client.createCollection(this.cfg.qdrantCollection, {
      vectors: {
        size: this.cfg.qdrantVectorSize,
        distance: 'Cosine',
      },
    });
    // Add payload indexes so filters are O(log n), not a full scan.
    for (const field of ['serverId', 'channelId', 'threadId']) {
      await this.client.createPayloadIndex(this.cfg.qdrantCollection, {
        field_name: field,
        field_schema: 'keyword',
      });
    }
    console.log(`[qdrant] created collection "${this.cfg.qdrantCollection}"`);
  }

  async upsert(point: MessagePoint, vector: number[]): Promise<void> {
    await this.client.upsert(this.cfg.qdrantCollection, {
      wait: false,
      points: [
        {
          id: messageIdToPointId(BigInt(point.messageId)),
          vector,
          payload: point as unknown as Record<string, unknown>,
        },
      ],
    });
  }

  async upsertMany(points: Array<{ point: MessagePoint; vector: number[] }>): Promise<void> {
    if (points.length === 0) return;
    await this.client.upsert(this.cfg.qdrantCollection, {
      wait: false,
      points: points.map(({ point, vector }) => ({
        id: messageIdToPointId(BigInt(point.messageId)),
        vector,
        payload: point as unknown as Record<string, unknown>,
      })),
    });
  }

  async deleteMessage(messageId: bigint): Promise<void> {
    await this.client.delete(this.cfg.qdrantCollection, {
      wait: false,
      points: [messageIdToPointId(messageId)],
    });
  }

  async search(
    vector: number[],
    opts: { serverId: bigint; limit: number }
  ): Promise<SearchResult[]> {
    const res = await this.client.search(this.cfg.qdrantCollection, {
      vector,
      limit: opts.limit,
      filter: {
        must: [{ key: 'serverId', match: { value: opts.serverId.toString() } }],
      },
      with_payload: true,
    });
    return res.map(r => ({
      point: r.payload as unknown as MessagePoint,
      score: r.score,
    }));
  }

  async count(serverId: bigint): Promise<number> {
    const res = await this.client.count(this.cfg.qdrantCollection, {
      filter: {
        must: [{ key: 'serverId', match: { value: serverId.toString() } }],
      },
      exact: true,
    });
    return res.count;
  }
}
