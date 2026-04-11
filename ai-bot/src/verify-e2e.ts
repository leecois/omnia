// Full end-to-end RAG quality test.
//
// 1. Connect as the bot (so we can read the state and call reducers).
// 2. Ask 3 specific questions in the default server.
// 3. Wait for the bot to resolve each.
// 4. Fetch the answer messages from SpacetimeDB.
// 5. Print each answer so the operator can eyeball the quality.
//
// Usage: bun --env-file=../.env.local run src/verify-e2e.ts

import { loadConfig } from './config.ts';
import { connectBot, subscribeAll } from './spacetime.ts';

const SERVER_ID = 1n;

const QUESTIONS = [
  'What is Omnia?',
  'How do threads work in this chat?',
  'Tell me about permissions and roles',
];

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { conn, identityHex } = await connectBot(cfg);
  await subscribeAll(conn);

  // Pick the first channel in server #1 to post in.
  let channelId: bigint | null = null;
  for (const ch of conn.db.channel.iter()) {
    if (ch.serverId === SERVER_ID) {
      channelId = ch.id;
      break;
    }
  }
  if (!channelId) throw new Error('no channel found in server #1');
  console.log(`posting questions in server #${SERVER_ID}, channel #${channelId}`);
  console.log(`bot identity: ${identityHex.slice(0, 16)}…\n`);

  // Track pre-existing ask_request IDs so we can identify ours.
  const preExistingIds = new Set<string>();
  for (const r of conn.db.ask_request.iter()) preExistingIds.add(r.id.toString());

  // Post each question and wait for resolution.
  for (let i = 0; i < QUESTIONS.length; i++) {
    const q = QUESTIONS[i]!;
    console.log(`[${i + 1}/${QUESTIONS.length}] Q: ${q}`);
    try {
      await conn.reducers.createAskRequest({
        channelId,
        threadId: 0n,
        question: q,
      });
    } catch (err) {
      console.log(`  ✗ reducer rejected: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    // Wait up to 15 s for the bot to resolve a new ask_request row.
    const deadline = Date.now() + 15_000;
    let resolvedRow = null;
    while (Date.now() < deadline) {
      for (const r of conn.db.ask_request.iter()) {
        if (preExistingIds.has(r.id.toString())) continue;
        if (r.question === q && r.status !== 'pending') {
          resolvedRow = r;
          break;
        }
      }
      if (resolvedRow) break;
      await new Promise(res => setTimeout(res, 300));
    }
    if (!resolvedRow) {
      console.log('  ✗ timeout waiting for bot');
      continue;
    }
    preExistingIds.add(resolvedRow.id.toString());
    console.log(`  → request #${resolvedRow.id} status=${resolvedRow.status}`);

    if (resolvedRow.status === 'failed') {
      console.log(`  ✗ failed: ${resolvedRow.errorMessage}`);
      continue;
    }

    // Find the most recent bot-authored message in this channel with a
    // timestamp after the request's createdAt.
    const createdMicros = resolvedRow.createdAt.microsSinceUnixEpoch;
    let latest = null;
    for (const m of conn.db.message.iter()) {
      if (m.channelId !== channelId) continue;
      if (m.authorId.toHexString() !== identityHex) continue;
      if (m.sent.microsSinceUnixEpoch < createdMicros) continue;
      if (!latest || m.sent.microsSinceUnixEpoch > latest.sent.microsSinceUnixEpoch) {
        latest = m;
      }
    }
    if (!latest) {
      console.log('  ✗ no bot message found matching this request');
      continue;
    }

    const lines = latest.text.split('\n').map(l => '    ' + l).join('\n');
    console.log(`  ✓ answer:\n${lines}\n`);
  }

  // Print audit total at the end.
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0n;
  let rows = 0;
  for (const a of conn.db.ai_audit.iter()) {
    totalIn += a.inputTokens;
    totalOut += a.outputTokens;
    totalCost += a.costMicros;
    rows++;
  }
  console.log(`Audit totals: ${rows} calls, ${totalIn} in + ${totalOut} out tokens, $${(Number(totalCost) / 1_000_000).toFixed(6)}`);
  process.exit(0);
}

main().catch(err => {
  console.error('[verify-e2e fatal]', err);
  process.exit(1);
});
