// Smoke test — exercises every non-SpacetimeDB path end-to-end:
//
//   1. Load config
//   2. Embed a message via the configured LLM provider
//   3. Upsert the vector into Qdrant
//   4. Search for a near-duplicate query
//   5. Call a chat completion
//   6. Delete the test point so we don't pollute the collection
//
// Run with:  bun --env-file=../.env.local run src/smoke.ts
// Exits 0 on full success, non-zero on any failure.

import { loadConfig } from './config.ts';
import { makeLLM } from './llm.ts';
import { QdrantStore } from './qdrant.ts';

const TEST_MESSAGE_ID = 999_999_999_999n; // unlikely to collide with a real message
const TEST_CONTENT = 'Omnia is a Discord-style chat built on SpacetimeDB.';
const TEST_QUERY = 'What platform powers the Omnia chat app?';

async function main(): Promise<void> {
  console.log('─ smoke test starting ─');

  const cfg = loadConfig();
  console.log(`[cfg] provider=${cfg.provider}, qdrant=${cfg.qdrantUrl}`);

  const llm = makeLLM(cfg);
  const qdrant = new QdrantStore(cfg);

  console.log('[1/6] ensuring qdrant collection');
  await qdrant.ensureCollection();

  console.log('[2/6] embedding a test message');
  const messageVec = await llm.embed(TEST_CONTENT);
  console.log(`       → ${messageVec.length}-dim vector`);

  console.log('[3/6] upserting test point');
  await qdrant.upsert(
    {
      messageId: TEST_MESSAGE_ID.toString(),
      serverId: '999',
      channelId: '999',
      threadId: '0',
      authorIdentity: 'deadbeef',
      createdAtMicros: '0',
      content: TEST_CONTENT,
    },
    messageVec
  );

  // Give Qdrant a moment to index the point.
  await new Promise(r => setTimeout(r, 500));

  console.log('[4/6] searching with a related query');
  const queryVec = await llm.embed(TEST_QUERY);
  const hits = await qdrant.search(queryVec, {
    serverId: 999n,
    limit: 5,
  });
  console.log(`       → ${hits.length} hit(s)`);
  if (hits.length === 0) {
    throw new Error('expected at least one search hit');
  }
  const top = hits[0]!;
  console.log(`       top score: ${top.score.toFixed(4)}`);
  console.log(`       top content: "${top.point.content.slice(0, 80)}…"`);
  if (top.point.messageId !== TEST_MESSAGE_ID.toString()) {
    throw new Error(`expected top hit to be our test point, got ${top.point.messageId}`);
  }

  console.log('[5/6] running a chat completion');
  const answer = await llm.chat(
    'You are a concise assistant.',
    `Context: ${TEST_CONTENT}\n\nQuestion: ${TEST_QUERY}\n\nAnswer briefly.`
  );
  console.log(`       → answer: "${answer.text.slice(0, 120)}"`);
  console.log(`       → tokens: ${answer.inputTokens} in, ${answer.outputTokens} out`);
  console.log(`       → cost:   $${(Number(answer.costMicros) / 1_000_000).toFixed(6)}`);

  console.log('[6/6] cleaning up test point');
  await qdrant.deleteMessage(TEST_MESSAGE_ID);

  console.log('─ smoke test passed ✓ ─');
}

main().catch(err => {
  console.error('✗ smoke test failed:', err);
  process.exit(1);
});
