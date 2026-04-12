// Omnia AI bot — entry point.
//
// Flow:
//   1. Load config from env
//   2. Bootstrap the Qdrant collection (idempotent)
//   3. Connect to SpacetimeDB and subscribe to required tables
//   4. Backfill any existing messages in AI-enabled servers
//   5. Start live ingestion (onInsert/onDelete on `message`)
//   6. Start the RAG handler (watches ask_request for pending rows)
//   7. Run forever — graceful shutdown on SIGINT / SIGTERM

// Polyfill DecompressionStream for Bun's baseline build (no AVX2).
// The SpacetimeDB SDK uses it for WebSocket decompression.
if (typeof globalThis.DecompressionStream === 'undefined') {
  const zlib = await import('node:zlib');
  // @ts-expect-error — minimal polyfill, matches the subset the SDK uses
  globalThis.DecompressionStream = class DecompressionStream {
    readable: ReadableStream;
    writable: WritableStream;
    constructor(format: string) {
      const decompressor =
        format === 'gzip' ? zlib.createGunzip() :
        format === 'deflate' ? zlib.createInflate() :
        format === 'deflate-raw' ? zlib.createInflateRaw() :
        (() => { throw new Error(`Unsupported format: ${format}`); })();
      this.readable = new ReadableStream({
        start(controller) {
          decompressor.on('data', (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          decompressor.on('end', () => controller.close());
          decompressor.on('error', (err: Error) => controller.error(err));
        },
      });
      this.writable = new WritableStream({
        write(chunk) { decompressor.write(chunk); },
        close() { decompressor.end(); },
      });
    }
  };
  console.log('[polyfill] DecompressionStream shimmed via node:zlib');
}

import { loadConfig } from './config.ts';
import { enabledServerSummary, Ingester } from './ingestion.ts';
import { makeLLM } from './llm.ts';
import { QdrantStore } from './qdrant.ts';
import { RAGHandler } from './rag.ts';
import { connectBot, subscribeAll } from './spacetime.ts';

async function main(): Promise<void> {
  console.log('──────────────────────────────────────');
  console.log('  Omnia AI bot — starting');
  console.log('──────────────────────────────────────');

  const cfg = loadConfig();
  console.log(`[boot] provider: ${cfg.provider}`);
  console.log(`[boot] qdrant:   ${cfg.qdrantUrl} (${cfg.qdrantCollection})`);
  console.log(`[boot] stdb:     ${cfg.spacetimeHost}/${cfg.spacetimeDbName}`);

  // Qdrant — create collection if missing.
  const qdrant = new QdrantStore(cfg);
  await qdrant.ensureCollection();

  // LLM adapter.
  const llm = makeLLM(cfg);

  // SpacetimeDB — connect as the bot's stable identity.
  const { conn, identityHex } = await connectBot(cfg);
  console.log(`[boot] bot identity: ${identityHex}`);

  // Subscribe to the tables we need, wait for the snapshot to arrive.
  await subscribeAll(conn);

  const enabled = enabledServerSummary(conn);
  console.log(`[boot] AI is enabled on ${enabled.length} server(s)`);
  for (const c of enabled) {
    console.log(
      `         - server #${c.serverId}  budget=${c.monthlyTokenBudget}  used=${c.tokensUsedThisMonth}`
    );
  }

  // Ingestion: subscribe first so nothing posted during backfill is missed,
  // then run the one-shot backfill over pre-existing messages.
  const ingester = new Ingester(conn, qdrant, llm, cfg, identityHex);
  ingester.subscribeLive();
  await ingester.backfillAll();

  // RAG handler.
  const rag = new RAGHandler(conn, qdrant, llm, cfg, identityHex);
  rag.start();

  console.log('[boot] bot is running — Ctrl-C to stop');

  // Keep the process alive.
  await new Promise<void>(resolve => {
    const shutdown = (signal: string) => {
      console.log(`\n[shutdown] received ${signal}, exiting…`);
      resolve();
    };
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  });

  process.exit(0);
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
