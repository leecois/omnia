import { render, screen } from '@testing-library/react';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { describe, expect, it } from 'vitest';
import App from './App';
import { DbConnection } from './module_bindings';

describe('App', () => {
  it('renders the loading screen before the connection is active', () => {
    const connectionBuilder = DbConnection.builder()
      .withUri('ws://localhost:3000')
      .withDatabaseName('omnia-test');

    render(
      <SpacetimeDBProvider connectionBuilder={connectionBuilder}>
        <App />
      </SpacetimeDBProvider>
    );

    expect(screen.getByText(/Connecting to Omnia/i)).toBeInTheDocument();
  });
});
