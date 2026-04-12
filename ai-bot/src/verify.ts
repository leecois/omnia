// End-to-end verification harness.
//
// Connects to SpacetimeDB using the same identity/token as the main bot,
// reads the current state, and prints a report. Also exercises the reducers
// against known edge cases so we can confirm validation works without
// clicking through the UI.
//
// Usage:  bun --env-file=../.env.local run src/verify.ts

import { loadConfig } from './config.ts';
import { QdrantStore } from './qdrant.ts';
import { connectBot, subscribeAll } from './spacetime.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const qdrant = new QdrantStore(cfg);
  const { conn, identityHex } = await connectBot(cfg);
  await subscribeAll(conn);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  STATE REPORT');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── AI config across all servers ─────────────────────────────────────
  console.log('AI CONFIGS:');
  let enabledCount = 0;
  for (const c of conn.db.ai_config.iter()) {
    const srv = conn.db.server.id.find(c.serverId);
    const name = srv?.name ?? `#${c.serverId}`;
    console.log(`  server ${c.serverId} (${name})`);
    console.log(`    enabled:      ${c.enabled}`);
    console.log(`    askEnabled:   ${c.askEnabled}`);
    console.log(`    budget:       ${c.monthlyTokenBudget}`);
    console.log(`    used:         ${c.tokensUsedThisMonth}`);
    console.log(`    sources:      ${c.sourceChannelIds || '(all channels)'}`);
    if (c.enabled) enabledCount++;
  }
  console.log(`  → ${enabledCount} server(s) with AI enabled\n`);

  // ── Message counts per ai-enabled server ─────────────────────────────
  console.log('MESSAGES:');
  for (const c of conn.db.ai_config.iter()) {
    if (!c.enabled) continue;
    let total = 0;
    let byBot = 0;
    for (const m of conn.db.message.iter()) {
      const ch = conn.db.channel.id.find(m.channelId);
      if (!ch || ch.serverId !== c.serverId) continue;
      total++;
      if (m.authorId.toHexString() === identityHex) byBot++;
    }
    console.log(
      `  server ${c.serverId}: ${total} total, ${byBot} by bot, ${total - byBot} by humans`
    );
  }
  console.log();

  // ── ask_request rows ─────────────────────────────────────────────────
  console.log('ASK REQUESTS:');
  const byStatus: Record<string, number> = {};
  const rows: Array<{ id: bigint; status: string; question: string; costMs: bigint }> = [];
  for (const r of conn.db.ask_request.iter()) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    rows.push({ id: r.id, status: r.status, question: r.question, costMs: 0n });
  }
  for (const [status, count] of Object.entries(byStatus)) {
    console.log(`  ${status}: ${count}`);
  }
  console.log('  recent:');
  rows
    .sort((a, b) => (a.id < b.id ? 1 : -1))
    .slice(0, 5)
    .forEach(r => {
      console.log(`    #${r.id} [${r.status}] "${r.question.slice(0, 60)}…"`);
    });
  console.log();

  // ── ai_audit totals ──────────────────────────────────────────────────
  console.log('AUDIT:');
  let totalIn = 0;
  let totalOut = 0;
  let totalCost = 0n;
  let auditRows = 0;
  for (const a of conn.db.ai_audit.iter()) {
    totalIn += a.inputTokens;
    totalOut += a.outputTokens;
    totalCost += a.costMicros;
    auditRows++;
  }
  console.log(
    `  ${auditRows} audit rows, ${totalIn} in + ${totalOut} out tokens, $${(Number(totalCost) / 1_000_000).toFixed(6)}\n`
  );

  // ── Qdrant ───────────────────────────────────────────────────────────
  console.log('QDRANT:');
  for (const c of conn.db.ai_config.iter()) {
    if (!c.enabled) continue;
    const count = await qdrant.count(c.serverId);
    console.log(`  server ${c.serverId}: ${count} points`);
  }
  console.log();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  REDUCER VALIDATION TESTS');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Find an enabled server/channel pair to test against.
  let testServerId: bigint | null = null;
  let testChannelId: bigint | null = null;
  for (const c of conn.db.ai_config.iter()) {
    if (!c.enabled || !c.askEnabled) continue;
    testServerId = c.serverId;
    for (const ch of conn.db.channel.iter()) {
      if (ch.serverId === c.serverId) {
        testChannelId = ch.id;
        break;
      }
    }
    if (testChannelId) break;
  }
  if (!testServerId || !testChannelId) {
    console.log('⚠ no enabled server with a channel found — skipping reducer tests');
    process.exit(0);
  }
  console.log(`Using server #${testServerId}, channel #${testChannelId}\n`);

  const testCase = async (
    name: string,
    args: { channelId: bigint; threadId: bigint; question: string },
    expectSuccess: boolean
  ): Promise<void> => {
    process.stdout.write(`  ${name.padEnd(38)} `);
    try {
      // Reducer calls return Promise<void>; must be awaited to observe
      // server-side errors. Otherwise they become unhandled rejections.
      await conn.reducers.createAskRequest(args);
      console.log(expectSuccess ? '✓' : '✗ expected failure but succeeded');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(expectSuccess ? `✗ ${msg}` : `✓ rejected: ${msg.slice(0, 60)}`);
    }
  };

  // These hit the reducer directly. The bot identity is allowed to call
  // create_ask_request because it only requires server-member + view perms,
  // which the bot has as a regular signed-in user.
  await testCase(
    'empty question (should fail)',
    { channelId: testChannelId, threadId: 0n, question: '   ' },
    false
  );
  await testCase(
    'very long question (should fail)',
    { channelId: testChannelId, threadId: 0n, question: 'x'.repeat(3000) },
    false
  );
  await testCase(
    'unknown channel (should fail)',
    { channelId: 999_999_999n, threadId: 0n, question: 'hi?' },
    false
  );
  await testCase(
    'normal question (should succeed)',
    { channelId: testChannelId, threadId: 0n, question: 'VERIFY_SMOKE_TEST: what is Omnia about?' },
    true
  );

  console.log('\nwaiting 8 s for the bot to handle the verification request…');
  await new Promise(r => setTimeout(r, 8000));

  // Re-scan ask_request to confirm the test row was resolved.
  let latestMatch = null;
  for (const r of conn.db.ask_request.iter()) {
    if (r.question.startsWith('VERIFY_SMOKE_TEST')) {
      if (!latestMatch || r.id > latestMatch.id) latestMatch = r;
    }
  }
  if (latestMatch) {
    console.log(`\nverification row #${latestMatch.id}: status=${latestMatch.status}`);
    if (latestMatch.status !== 'pending') {
      console.log('✓ bot handled it');
    } else {
      console.log('⚠ still pending — bot may be unreachable or slow');
    }
  } else {
    console.log('⚠ could not find verification row');
  }

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  DONE');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

main().catch(err => {
  console.error('[verify fatal]', err);
  process.exit(1);
});
