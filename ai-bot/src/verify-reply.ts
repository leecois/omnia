// Verifies the /ask reply chain end-to-end after the schema migration.
//
// Uses the bot's own super_admin power (auto-granted because it was the
// first user to connect after --delete-data) to:
//
//   1. Enable AI on server #1
//   2. Submit an ask_request via createAskRequest
//   3. Confirm a question message was inserted with the bot as author
//   4. Confirm ask_request.questionMessageId points at that message
//   5. Wait for the main bot to resolve the request
//   6. Confirm an answer message exists whose replyToId matches the
//      question's messageId
//
// This exercises the new "question as a real message, answer as a
// threaded reply" flow without needing the frontend to be open.

import { loadConfig } from './config.ts';
import { connectBot, subscribeAll } from './spacetime.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { conn, identityHex } = await connectBot(cfg);
  await subscribeAll(conn);

  console.log(`[verify] bot identity: ${identityHex.slice(0, 16)}…\n`);

  // ── Step 1: enable AI on server #1 ──────────────────────────────────
  const SERVER_ID = 1n;
  const existingCfg = conn.db.ai_config.serverId.find(SERVER_ID);
  if (!existingCfg || !existingCfg.enabled || !existingCfg.askEnabled) {
    console.log('[verify] enabling AI on server #1…');
    try {
      await conn.reducers.ensureAiConfig({ serverId: SERVER_ID });
      await conn.reducers.updateAiConfig({
        serverId: SERVER_ID,
        enabled: true,
        askEnabled: true,
        summarizeEnabled: false,
        monthlyTokenBudget: 0n,
        sourceChannelIds: '',
      });
      console.log('[verify] ✓ AI enabled');
    } catch (err) {
      console.error('[verify] ✗ could not enable AI:', err);
      process.exit(1);
    }
  } else {
    console.log('[verify] AI already enabled on server #1');
  }

  // ── Step 2: pick a channel to post in ───────────────────────────────
  let channelId: bigint | null = null;
  for (const ch of conn.db.channel.iter()) {
    if (ch.serverId === SERVER_ID) {
      channelId = ch.id;
      break;
    }
  }
  if (!channelId) {
    console.error('[verify] no channel found in server #1');
    process.exit(1);
  }
  console.log(`[verify] using channel #${channelId}\n`);

  // Snapshot current message count so we can spot new rows.
  const beforeMsgIds = new Set<string>();
  for (const m of conn.db.message.iter()) beforeMsgIds.add(m.id.toString());
  const beforeAskIds = new Set<string>();
  for (const r of conn.db.ask_request.iter()) beforeAskIds.add(r.id.toString());

  // ── Step 3: submit a test question ──────────────────────────────────
  const TEST_QUESTION = 'REPLY_TEST: What channels exist in Omnia Lounge?';
  console.log(`[verify] submitting ask_request: "${TEST_QUESTION}"`);
  await conn.reducers.createAskRequest({
    channelId,
    threadId: 0n,
    question: TEST_QUESTION,
  });
  console.log('[verify] ✓ reducer returned\n');

  // Give the subscription a moment to catch up.
  await new Promise(r => setTimeout(r, 500));

  // ── Step 4: find the new ask_request row ────────────────────────────
  let newAsk = null;
  for (const r of conn.db.ask_request.iter()) {
    if (!beforeAskIds.has(r.id.toString()) && r.question === TEST_QUESTION) {
      newAsk = r;
      break;
    }
  }
  if (!newAsk) {
    console.error('[verify] ✗ new ask_request not found');
    process.exit(1);
  }
  console.log(`[verify] new ask_request: #${newAsk.id}`);
  console.log(`         questionMessageId: ${newAsk.questionMessageId}`);
  console.log(`         status:            ${newAsk.status}`);

  if (newAsk.questionMessageId === 0n) {
    console.error('[verify] ✗ questionMessageId is 0 — migration failed');
    process.exit(1);
  }

  // ── Step 5: confirm the question message exists ─────────────────────
  const questionMsg = conn.db.message.id.find(newAsk.questionMessageId);
  if (!questionMsg) {
    console.error(`[verify] ✗ question message ${newAsk.questionMessageId} not found`);
    process.exit(1);
  }
  console.log(`[verify] question message:`);
  console.log(`         id:        ${questionMsg.id}`);
  console.log(`         text:      "${questionMsg.text}"`);
  console.log(`         author:    ${questionMsg.authorId.toHexString().slice(0, 16)}…`);
  console.log(`         channel:   ${questionMsg.channelId}`);
  console.log(`         replyToId: ${questionMsg.replyToId} (should be 0)\n`);

  if (questionMsg.text !== TEST_QUESTION) {
    console.error('[verify] ✗ question message text mismatch');
    process.exit(1);
  }
  if (questionMsg.authorId.toHexString() !== identityHex) {
    console.error('[verify] ✗ question authored by wrong identity');
    process.exit(1);
  }

  // ── Step 6: wait up to 20s for the bot to post the answer ───────────
  console.log('[verify] waiting for bot to post answer…');
  const deadline = Date.now() + 20_000;
  let answerMsg = null;
  while (Date.now() < deadline) {
    for (const m of conn.db.message.iter()) {
      if (m.replyToId === questionMsg.id && m.id !== questionMsg.id) {
        answerMsg = m;
        break;
      }
    }
    if (answerMsg) break;
    await new Promise(r => setTimeout(r, 400));
  }
  if (!answerMsg) {
    console.error('[verify] ✗ answer not posted within 20 s');
    // Check if the request failed
    for (const r of conn.db.ask_request.iter()) {
      if (r.id === newAsk.id) {
        console.log(`         current ask_request status: ${r.status}`);
        if (r.errorMessage) console.log(`         error: ${r.errorMessage}`);
      }
    }
    process.exit(1);
  }
  console.log(`[verify] answer message:`);
  console.log(`         id:        ${answerMsg.id}`);
  console.log(`         replyToId: ${answerMsg.replyToId} (should be ${questionMsg.id})`);
  console.log(`         author:    ${answerMsg.authorId.toHexString().slice(0, 16)}…`);
  console.log(`         text (first 200 chars): "${answerMsg.text.slice(0, 200).replace(/\n/g, ' ⏎ ')}…"`);

  // ── Step 7: assert the reply chain ──────────────────────────────────
  if (answerMsg.replyToId !== questionMsg.id) {
    console.error('[verify] ✗ answer does not reply to the question');
    process.exit(1);
  }

  // ── Step 8: confirm ask_request is marked answered ──────────────────
  // The bot posts the answer (sendMessage) and THEN calls resolveAskRequest
  // in sequence. The two updates propagate back through our subscription
  // in that same order, so by the time we see the answer message we may
  // not yet have observed the status flip. Poll briefly.
  const statusDeadline = Date.now() + 5_000;
  let resolvedAsk = null;
  while (Date.now() < statusDeadline) {
    for (const r of conn.db.ask_request.iter()) {
      if (r.id === newAsk.id) {
        resolvedAsk = r;
        break;
      }
    }
    if (resolvedAsk && resolvedAsk.status === 'answered') break;
    await new Promise(res => setTimeout(res, 200));
  }
  if (!resolvedAsk || resolvedAsk.status !== 'answered') {
    console.error(`[verify] ✗ ask_request status is ${resolvedAsk?.status ?? 'missing'}, expected 'answered'`);
    process.exit(1);
  }
  console.log(`\n[verify] ✓ ask_request #${newAsk.id} status=answered`);

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('  ALL CHECKS PASSED — reply chain works');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  process.exit(0);
}

main().catch(err => { console.error('[verify-reply fatal]', err); process.exit(1); });
