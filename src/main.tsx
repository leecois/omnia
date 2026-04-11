import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { Identity } from 'spacetimedb';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, ErrorContext } from './module_bindings/index.ts';

const HOST = import.meta.env.VITE_SPACETIMEDB_HOST ?? 'ws://localhost:3000';
const DB_NAME = import.meta.env.VITE_SPACETIMEDB_DB_NAME ?? 'quickstart-chat';
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

const onConnect = (conn: DbConnection, identity: Identity, token: string) => {
  localStorage.setItem(TOKEN_KEY, token);
  console.log('Connected to SpacetimeDB with identity:', identity.toHexString());

  // Explicit subscription so the read_state table (public) and all new tables
  // are included. useTable() auto-subscribes but views/private tables benefit
  // from an explicit SQL sub list.
  conn
    .subscriptionBuilder()
    .onApplied(() => console.log('Subscriptions applied.'))
    .onError(e => console.error('Subscription error:', e))
    .subscribe([
      'SELECT * FROM "user"',
      'SELECT * FROM server',
      'SELECT * FROM channel',
      'SELECT * FROM server_member',
      'SELECT * FROM invite',
      'SELECT * FROM message',
      'SELECT * FROM thread',
      'SELECT * FROM reaction',
      'SELECT * FROM typing',
      'SELECT * FROM read_state',
      'SELECT * FROM notification',
    ]);
};

const onDisconnect = () => {
  console.log('Disconnected from SpacetimeDB');
};

const onConnectError = (_ctx: ErrorContext, err: Error) => {
  console.log('Error connecting to SpacetimeDB:', err);
};

const connectionBuilder = DbConnection.builder()
  .withUri(HOST)
  .withDatabaseName(DB_NAME)
  .withToken(localStorage.getItem(TOKEN_KEY) || undefined)
  .onConnect(onConnect)
  .onDisconnect(onDisconnect)
  .onConnectError(onConnectError);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
      <App />
    </SpacetimeDBProvider>
  </StrictMode>
);
