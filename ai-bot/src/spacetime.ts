// SpacetimeDB connection wrapper for the bot. Reuses the exact same
// generated bindings the frontend does — they live in ../../src/module_bindings
// and are imported via relative path so both clients stay in perfect sync.
//
// Responsibilities:
//   * load/persist the bot's identity token to disk (so restarts keep the
//     same Identity and can be authorised as a normal server member)
//   * connect, subscribe, expose a typed handle to reducers + tables
//   * surface a tiny `awaitReady()` helper so the main loop can block
//     until the initial state has been synced

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DbConnection } from '../../src/module_bindings/index.ts';
import type { BotConfig } from './config.ts';

export interface SpacetimeHandle {
  conn: DbConnection;
  identityHex: string;
}

export async function connectBot(cfg: BotConfig): Promise<SpacetimeHandle> {
  // 1. Figure out a starting token. Prefer env override, then on-disk cache,
  //    then fall through to anonymous (SpacetimeDB will mint one for us).
  const token: string | undefined =
    cfg.botToken ??
    (existsSync(cfg.botTokenPath) ? readFileSync(cfg.botTokenPath, 'utf8').trim() : undefined) ??
    undefined;

  // 2. Wire up the builder. We resolve a Promise when onConnect fires and
  //    reject on connect errors so the caller can await a ready connection.
  let conn!: DbConnection;
  const identityHex: string = await new Promise<string>((resolve, reject) => {
    const builder = DbConnection.builder()
      .withUri(cfg.spacetimeHost)
      .withDatabaseName(cfg.spacetimeDbName)
      .onConnect((c, identity, newToken) => {
        conn = c;
        // Persist the (possibly new) token so the next restart reuses it.
        try {
          writeFileSync(cfg.botTokenPath, newToken, { mode: 0o600 });
        } catch (err) {
          console.warn(`[spacetime] could not persist token to ${cfg.botTokenPath}:`, err);
        }
        const hex = identity.toHexString();
        console.log(`[spacetime] connected as ${hex.slice(0, 12)}…`);
        resolve(hex);
      })
      .onDisconnect(() => console.warn('[spacetime] disconnected'))
      .onConnectError((_ctx, err) => {
        console.error('[spacetime] connect error:', err);
        reject(err);
      });

    if (token) builder.withToken(token);
    builder.build();
  });

  return { conn, identityHex };
}

/** Subscribe to all tables the bot needs to read. Returns a promise that
 *  resolves when the initial snapshot has been delivered. */
export function subscribeAll(conn: DbConnection): Promise<void> {
  return new Promise((resolve, reject) => {
    conn
      .subscriptionBuilder()
      .onApplied(() => {
        console.log('[spacetime] initial subscription applied');
        resolve();
      })
      .onError(ctx => reject(ctx.event ?? new Error('subscription error')))
      .subscribe([
        'SELECT * FROM "user"',
        'SELECT * FROM server',
        'SELECT * FROM channel',
        'SELECT * FROM category',
        'SELECT * FROM server_member',
        'SELECT * FROM message',
        'SELECT * FROM thread',
        'SELECT * FROM ai_config',
        'SELECT * FROM channel_ai_config',
        'SELECT * FROM ask_request',
        'SELECT * FROM ai_audit',
      ]);
  });
}
