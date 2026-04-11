// Quick diagnostic — prints every server, channel, and super_admin row
// to see whether init re-seeded the database after --delete-data.

import { loadConfig } from './config.ts';
import { connectBot } from './spacetime.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { conn } = await connectBot(cfg);
  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError(ctx => reject(ctx.event ?? new Error('sub error')))
      .subscribe([
        'SELECT * FROM server',
        'SELECT * FROM channel',
        'SELECT * FROM super_admin',
        'SELECT * FROM "user"',
      ]);
  });
  console.log('');
  console.log('SERVERS:');
  for (const s of conn.db.server.iter()) {
    console.log(`  #${s.id}  ${s.name}   owner=${s.ownerId.toHexString().slice(0, 12)}…`);
  }
  console.log('\nCHANNELS:');
  let n = 0;
  for (const c of conn.db.channel.iter()) {
    console.log(`  #${c.id}  ${c.name}  (server ${c.serverId})`);
    if (++n > 20) { console.log('  …'); break; }
  }
  console.log('\nSUPER ADMINS:');
  for (const sa of conn.db.super_admin.iter()) {
    console.log(`  ${sa.userIdentity.toHexString()}`);
  }
  console.log('\nUSERS:');
  let u = 0;
  for (const user of conn.db.user.iter()) {
    console.log(`  ${user.identity.toHexString()}   name=${user.name ?? '(anon)'}   online=${user.online}`);
    if (++u > 10) { console.log('  …'); break; }
  }
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
