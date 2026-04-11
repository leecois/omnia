// Visually unmissable sticky banner shown whenever the current user
// holds a super_admin row. It's the opposite of a "user should never
// forget they're in this mode" safety feature.
//
// Exit button calls revoke_super_admin_self, which atomically drops
// the row and (via the live subscription) removes the banner.

import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';

export default function SuperAdminBanner() {
  const revokeSelf = useReducer(reducers.revokeSuperAdminSelf);
  const [busy, setBusy] = useState(false);

  const exit = async () => {
    if (busy) return;
    const confirmed = window.confirm(
      'Exit Super Admin mode?\n\n' +
      'Your account will lose elevated privileges immediately. ' +
      'You can re-claim them at any time with Ctrl/Cmd+Shift+A.'
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await revokeSelf();
    } catch (err) {
      alert(`Could not revoke: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="sa-banner" role="status" aria-live="polite">
      <span className="sa-banner-dot" aria-hidden="true" />
      <span className="sa-banner-text">
        <strong>SUPER ADMIN MODE</strong>
        <span className="sa-banner-sub">every action is logged to dev_admin_audit</span>
      </span>
      <button
        type="button"
        className="sa-banner-exit"
        onClick={exit}
        disabled={busy}
      >
        {busy ? 'Exiting…' : 'Exit'}
      </button>
    </div>
  );
}
