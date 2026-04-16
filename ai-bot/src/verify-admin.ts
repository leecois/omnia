// End-to-end verification of the Admin Impersonation flow.
//
// Runs against the live maincloud instance using a reused bot connection.
// Exercises every reducer + every error path + the audit trail.
//
// Flow:
//   0. Connect — the bot becomes super_admin via clientConnected bootstrap
//      (first user wins) because the DB was just wiped.
//   1. claim with nothing seeded → expected fail "not seeded"
//   2. seed with too-short secret → expected fail
//   3. seed with valid secret → expected success
//   4. seed again → expected fail "already seeded"
//   5. claim with wrong secret → expected fail "wrong secret"
//   6. claim with right secret → success, but "already super" no-op path
//   7. revoke_super_admin_self → success, bot is no longer super
//   8. claim with right secret → success, bot is super again
//   9. rotate secret → success
//  10. claim with OLD secret → fail
//  11. claim with NEW secret → success (already super path)
//
// At the end, prints the dev_admin_audit table for eyeballing.

import { loadConfig } from './config.ts';
import { connectBot } from './spacetime.ts';

const SECRET_GOOD = 'omnia-verify-initial-secret-x1';
const SECRET_BAD = 'definitely-not-the-secret';
const SECRET_ROTATED = 'omnia-verify-rotated-secret-y2';

type Step = { name: string; fn: () => Promise<void>; expectError?: RegExp };

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { conn, identityHex } = await connectBot(cfg);

  await new Promise<void>((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => resolve())
      .onError(ctx => reject(ctx.event ?? new Error('sub error')))
      .subscribe(['SELECT * FROM super_admin', 'SELECT * FROM dev_admin_audit']);
  });

  const isSuper = (): boolean => {
    for (const sa of conn.db.super_admin.iter()) {
      if (sa.userIdentity.toHexString() === identityHex) return true;
    }
    return false;
  };

  console.log(`\nbot identity: ${identityHex.slice(0, 16)}…`);
  console.log(`initial super_admin: ${isSuper()}\n`);

  // If we're super from the bootstrap, revoke once so we can exercise
  // the full seed-while-not-super path.
  if (isSuper()) {
    try {
      await conn.reducers.revokeSuperAdminSelf({});
      console.log('  (revoked bootstrap super_admin to start clean)');
      await new Promise(r => setTimeout(r, 300));
    } catch {}
  }

  const steps: Step[] = [
    {
      name: 'claim before seed → fails',
      fn: () => conn.reducers.claimSuperAdmin({ secret: 'anything' }),
      expectError: /not been seeded/i,
    },
    {
      name: 'seed too-short → fails',
      fn: () => conn.reducers.seedDevAdminSecret({ secret: 'short' }),
      expectError: /at least 16/i,
    },
    {
      name: 'seed valid → ok',
      fn: () => conn.reducers.seedDevAdminSecret({ secret: SECRET_GOOD }),
    },
    {
      name: 'seed again → fails (already seeded)',
      fn: () => conn.reducers.seedDevAdminSecret({ secret: SECRET_GOOD }),
      expectError: /already been seeded/i,
    },
    {
      name: 'claim wrong secret → fails',
      fn: () => conn.reducers.claimSuperAdmin({ secret: SECRET_BAD }),
      expectError: /invalid secret/i,
    },
    {
      name: 'claim right secret → ok (grants super_admin)',
      fn: () => conn.reducers.claimSuperAdmin({ secret: SECRET_GOOD }),
    },
    {
      name: 'claim again (already super) → ok (idempotent no-op)',
      fn: () => conn.reducers.claimSuperAdmin({ secret: SECRET_GOOD }),
    },
    {
      name: 'revoke_super_admin_self → ok',
      fn: () => conn.reducers.revokeSuperAdminSelf({}),
    },
    {
      name: 'revoke again (not super) → fails',
      fn: () => conn.reducers.revokeSuperAdminSelf({}),
      expectError: /not currently a super admin/i,
    },
    {
      name: 'claim right secret → ok (re-grants)',
      fn: () => conn.reducers.claimSuperAdmin({ secret: SECRET_GOOD }),
    },
    {
      name: 'rotate with too-short → fails',
      fn: () => conn.reducers.rotateDevAdminSecret({ newSecret: 'x' }),
      expectError: /at least 16/i,
    },
    {
      name: 'rotate to new secret → ok',
      fn: () => conn.reducers.rotateDevAdminSecret({ newSecret: SECRET_ROTATED }),
    },
    {
      name: 'revoke and claim with OLD → fails',
      fn: async () => {
        await conn.reducers.revokeSuperAdminSelf({});
        await new Promise(r => setTimeout(r, 200));
        await conn.reducers.claimSuperAdmin({ secret: SECRET_GOOD });
      },
      expectError: /invalid secret/i,
    },
    {
      name: 'claim with NEW secret → ok (regrants after rotation)',
      fn: () => conn.reducers.claimSuperAdmin({ secret: SECRET_ROTATED }),
    },
  ];

  let passed = 0;
  let failed = 0;
  for (const step of steps) {
    process.stdout.write(`  ${step.name.padEnd(58)} `);
    try {
      await step.fn();
      if (step.expectError) {
        console.log('✗ EXPECTED ERROR BUT GOT SUCCESS');
        failed++;
      } else {
        console.log('✓');
        passed++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (step.expectError && step.expectError.test(msg)) {
        console.log(`✓ rejected: ${msg.slice(0, 40)}`);
        passed++;
      } else if (step.expectError) {
        console.log(`✗ wrong error: ${msg}`);
        failed++;
      } else {
        console.log(`✗ ${msg}`);
        failed++;
      }
    }
    // Brief pause to avoid tripping the 5-fails/60s rate limiter.
    await new Promise(r => setTimeout(r, 150));
  }

  console.log(`\nfinal super_admin: ${isSuper()}`);
  console.log(`final result: ${passed} passed, ${failed} failed\n`);

  // Print audit table.
  console.log('dev_admin_audit:');
  const audit = [...conn.db.dev_admin_audit.iter()].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (const row of audit) {
    const tag = row.success ? '✓' : '✗';
    console.log(`  #${row.id}  ${tag}  ${row.action.padEnd(14)} ${row.detail}`);
  }

  // Clean up — leave the bot revoked at the end so the user's browser
  // session can auto-claim super_admin via clientConnected bootstrap.
  if (isSuper()) {
    try {
      await conn.reducers.revokeSuperAdminSelf({});
      console.log('\n(bot revoked for clean exit)');
    } catch {}
  }

  process.exit(failed === 0 ? 0 : 1);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
