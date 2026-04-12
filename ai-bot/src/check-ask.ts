import { loadConfig } from './config.ts';
import { connectBot } from './spacetime.ts';

async function main() {
  const cfg = loadConfig();
  const { conn } = await connectBot(cfg);
  await new Promise<void>((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError(ctx => reject(ctx.event))
      .subscribe([
        'SELECT * FROM ask_request',
        'SELECT * FROM ai_config',
        'SELECT * FROM message',
        'SELECT * FROM server_member',
      ]);
  });
  console.log('\nASK REQUESTS:');
  let count = 0;
  for (const r of conn.db.ask_request.iter()) {
    console.log(
      `  #${r.id} [${r.status}] ch=${r.channelId} qmid=${r.questionMessageId} q="${r.question.slice(0, 50)}"`
    );
    count++;
  }
  console.log(`  total: ${count}`);
  console.log('\nAI CONFIG:');
  for (const c of conn.db.ai_config.iter()) {
    console.log(`  server ${c.serverId}: enabled=${c.enabled} ask=${c.askEnabled}`);
  }
  console.log('\nSERVER MEMBERS (server 1):');
  let mcount = 0;
  for (const m of conn.db.server_member.iter()) {
    if (m.serverId === 1n) {
      console.log(`  ${m.userIdentity.toHexString().slice(0, 16)}… role=${m.role}`);
      mcount++;
    }
  }
  console.log(`  total: ${mcount}`);
  console.log('\nMESSAGES (last 5):');
  const msgs = [...conn.db.message.iter()].sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, 5);
  for (const m of msgs) {
    console.log(
      `  #${m.id} ch=${m.channelId} by=${m.authorId.toHexString().slice(0, 12)}… "${m.text.slice(0, 60)}"`
    );
  }
  process.exit(0);
}
main().catch(e => {
  console.error(e);
  process.exit(1);
});
