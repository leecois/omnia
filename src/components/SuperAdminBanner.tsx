// Visually unmissable red bar shown whenever the current user holds a
// super_admin row. The intent is "you should never forget you're in
// elevated mode" — so it sits at the top of the app, stays visible, and
// offers an obvious Exit path.
//
// Two-state exit flow:
//   idle  →  click Exit          →  confirming
//   confirming → click "Revoke"  →  call revoke_super_admin_self
//                                →  super_admin row drops
//                                →  live subscription hides this banner
//   confirming → click "Cancel"  →  back to idle
//
// No native window.confirm / alert — stays consistent with the rest of
// the app's in-chrome confirmation style.

import { useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';

export default function SuperAdminBanner() {
  const revokeSelf = useReducer(reducers.revokeSuperAdminSelf);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doRevoke = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await revokeSelf();
      // On success the live subscription will drop our super_admin row
      // and this component unmounts — nothing else to do.
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <div className="sa-banner" role="banner">
      <span className="sa-banner-dot" aria-hidden="true" />
      <span className="sa-banner-text">
        <strong>SUPER ADMIN MODE</strong>
        <span className="sa-banner-sub">
          {error
            ? `Revoke failed: ${error}`
            : 'every action is logged to dev_admin_audit'}
        </span>
      </span>
      {confirming ? (
        <div className="sa-banner-confirm">
          <span className="sa-banner-confirm-q">Revoke?</span>
          <button
            type="button"
            className="sa-banner-exit sa-banner-danger"
            onClick={doRevoke}
            disabled={busy}
          >
            {busy ? 'Revoking…' : 'Yes, revoke'}
          </button>
          <button
            type="button"
            className="sa-banner-exit"
            onClick={() => { setConfirming(false); setError(null); }}
            disabled={busy}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="sa-banner-exit"
          onClick={() => setConfirming(true)}
        >
          Exit
        </button>
      )}
    </div>
  );
}
