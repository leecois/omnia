// One-shot: enable AI on server #1. Run after a --delete-data wipe.
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
      .subscribe(['SELECT * FROM ai_config', 'SELECT * FROM server']);
  });
  const SERVER_ID = 1n;
  console.log('Ensuring ai_config row…');
  await conn.reducers.ensureAiConfig({ serverId: SERVER_ID });
  console.log('Enabling AI…');
  await conn.reducers.updateAiConfig({
    serverId: SERVER_ID,
    enabled: true,
    askEnabled: true,
    summarizeEnabled: false,
    monthlyTokenBudget: 0n,
    sourceChannelIds: '',
  });
  console.log('Done — AI is now enabled on server #1');
  process.exit(0);
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
