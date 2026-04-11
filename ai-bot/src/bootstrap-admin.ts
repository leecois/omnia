// Bootstrap: grant super_admin to the first non-bot user that connects.
//
// Context: after a --delete-data republish, the bot was the first client
// to connect and claimed the automatic super_admin grant from the init
// reducer's bootstrap logic. The human operator, who WAS super_admin
// before the wipe, now has an ordinary user row. This script fixes that
// by waiting for the human to reconnect through the frontend and using
// the bot's existing super_admin power to grant them the same.
//
// Usage:  bun --env-file=../.env.local run src/bootstrap-admin.ts
// Then:   open the frontend in your browser.
// The script exits as soon as it successfully grants the first human.

import { loadConfig } from './config.ts';
import { connectBot } from './spacetime.ts';

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { conn, identityHex } = await connectBot(cfg);
  console.log(`[bootstrap] bot identity: ${identityHex}`);

  // Subscribe to user + super_admin so we can see live inserts.
  await new Promise<void>((resolve, reject) => {
    conn.subscriptionBuilder()
      .onApplied(() => resolve())
      .onError(ctx => reject(ctx.event ?? new Error('sub error')))
      .subscribe([
        'SELECT * FROM "user"',
        'SELECT * FROM super_admin',
      ]);
  });

  // Helper: already-super? (avoid double-grant).
  const isSuperAdmin = (hex: string): boolean => {
    for (const sa of conn.db.super_admin.iter()) {
      if (sa.userIdentity.toHexString() === hex) return true;
    }
    return false;
  };

  // Helper: is this the bot's own identity?
  const isBot = (hex: string): boolean => hex === identityHex;

  const grantIfEligible = async (hex: string, identity: unknown): Promise<boolean> => {
    if (isBot(hex)) return false;
    if (isSuperAdmin(hex)) {
      console.log(`[bootstrap] ${hex.slice(0, 16)}… is already super_admin`);
      return true;
    }
    console.log(`[bootstrap] granting super_admin to ${hex}`);
    try {
      await conn.reducers.grantSuperAdmin({ userIdentity: identity as never });
      console.log('[bootstrap] ✓ granted');
      return true;
    } catch (err) {
      console.error('[bootstrap] ✗ grant failed:', err);
      return false;
    }
  };

  // 1. Check for any pre-existing non-bot user with no super_admin.
  for (const u of conn.db.user.iter()) {
    const hex = u.identity.toHexString();
    if (await grantIfEligible(hex, u.identity)) {
      process.exit(0);
    }
  }

  // 2. Otherwise, wait for the next non-bot user to connect.
  console.log('[bootstrap] waiting for a human user to connect…');
  console.log('[bootstrap] open https://omnia.example.com or run the dev server now');
  conn.db.user.onInsert(async (_ctx, u) => {
    const hex = u.identity.toHexString();
    if (await grantIfEligible(hex, u.identity)) {
      setTimeout(() => process.exit(0), 1000);
    }
  });

  // Keep alive.
  await new Promise<void>(() => {});
}

main().catch(err => { console.error(err); process.exit(1); });
