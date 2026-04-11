// DevAdminModal — the break-glass modal for claiming super_admin.
//
// Opens on Ctrl/Cmd+Shift+A from anywhere in the app, regardless of
// whether the caller is currently signed in as a super admin.
//
// Two modes:
//   - 'seed'  — only offered to the first caller, when the dev_admin_secret
//               table is still empty. We detect this via a reducer attempt
//               rather than exposing the private table to the client.
//   - 'claim' — default. The user enters the shared secret and we call
//               claim_super_admin; on success they immediately flip to
//               super admin via the existing super_admin subscription.
//
// Design choices:
//   * Plain password input, autoFocus, Enter submits
//   * Inline error message on the reducer's SenderError text
//   * No "remember me" — re-entering the secret per session is fine for a
//     break-glass tool and keeps the blast radius small

import { useEffect, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';

interface Props {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
}

// Selector that matches every focusable element. Used for the focus trap.
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export default function DevAdminModal({ open, onClose, isSuperAdmin }: Props) {
  const [mode, setMode] = useState<'claim' | 'seed'>('claim');
  const [secret, setSecret] = useState('');
  const [newSecret, setNewSecret] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  const claimSuperAdmin = useReducer(reducers.claimSuperAdmin);
  const seedDevAdminSecret = useReducer(reducers.seedDevAdminSecret);
  const rotateDevAdminSecret = useReducer(reducers.rotateDevAdminSecret);

  // Clear state whenever the modal opens
  useEffect(() => {
    if (!open) return;
    setSecret('');
    setNewSecret('');
    setError(null);
    setNotice(null);
    setBusy(false);
    setMode('claim');
  }, [open]);

  // Escape to close + Tab focus trap. Scoped to this component so the
  // handler always reads the current `open` value via the effect closure.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !dialogRef.current) return;
      const nodes = dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !dialogRef.current.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const doClaim = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!secret.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await claimSuperAdmin({ secret });
      setNotice('Super admin mode activated.');
      setTimeout(onClose, 600);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If the reducer says the secret hasn't been seeded yet, auto-switch
      // the modal into seed mode so the operator can bootstrap it inline.
      if (/not been seeded/i.test(msg)) {
        setMode('seed');
        setError(null);
        setNotice('The dev secret has not been seeded yet. Enter a new one below (minimum 16 characters).');
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  };

  const doSeed = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newSecret.length < 16 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await seedDevAdminSecret({ secret: newSecret });
      setNotice('Secret seeded. Now enter it to claim super admin.');
      setMode('claim');
      setSecret(newSecret);
      setNewSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const doRotate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newSecret.length < 16 || busy) return;
    setBusy(true);
    setError(null);
    try {
      await rotateDevAdminSecret({ newSecret });
      setNotice('Secret rotated.');
      setNewSecret('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        ref={dialogRef}
        className="dev-admin-modal"
        onMouseDown={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-admin-title"
      >
        <header className="dev-admin-header">
          <div className="dev-admin-header-text">
            <h3 id="dev-admin-title" className="dev-admin-title">
              Developer Access
            </h3>
            <p className="dev-admin-sub">
              Break-glass claim of super-admin privileges. Every action on this
              screen is recorded in <code>dev_admin_audit</code>.
            </p>
          </div>
          <button
            type="button"
            className="dev-admin-close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </header>

        {mode === 'claim' && (
          <form onSubmit={doClaim} className="dev-admin-body">
            <label className="dev-admin-label">
              Shared secret
              <input
                type="password"
                autoFocus
                autoComplete="off"
                className="dev-admin-input"
                value={secret}
                onChange={e => setSecret(e.target.value)}
                placeholder="Paste the dev-admin secret"
                disabled={busy}
              />
            </label>
            <button type="submit" className="dev-admin-submit" disabled={busy || !secret.trim()}>
              {busy ? 'Claiming…' : 'Claim Super Admin'}
            </button>
            {isSuperAdmin && (
              <div className="dev-admin-rotate">
                <h4>Rotate secret</h4>
                <p>
                  You are currently super admin — you can rotate the stored
                  secret. All future claimers will need the new value.
                </p>
                <input
                  type="password"
                  autoComplete="off"
                  className="dev-admin-input"
                  value={newSecret}
                  onChange={e => setNewSecret(e.target.value)}
                  placeholder="New secret (≥16 chars)"
                  disabled={busy}
                />
                <button
                  type="button"
                  className="dev-admin-submit dev-admin-submit-secondary"
                  onClick={e => doRotate(e as unknown as React.FormEvent)}
                  disabled={busy || newSecret.length < 16}
                >
                  Rotate
                </button>
              </div>
            )}
          </form>
        )}

        {mode === 'seed' && (
          <form onSubmit={doSeed} className="dev-admin-body">
            <label className="dev-admin-label">
              New shared secret (minimum 16 characters)
              <input
                type="password"
                autoFocus
                autoComplete="off"
                className="dev-admin-input"
                value={newSecret}
                onChange={e => setNewSecret(e.target.value)}
                placeholder="Pick a strong secret"
                disabled={busy}
              />
            </label>
            <p className="dev-admin-help">
              This is a one-time bootstrap — the table is empty, so the first
              caller wins. Store this value in a password manager before
              submitting.
            </p>
            <button type="submit" className="dev-admin-submit" disabled={busy || newSecret.length < 16}>
              {busy ? 'Seeding…' : 'Seed & continue'}
            </button>
          </form>
        )}

        {notice && <div className="dev-admin-notice">{notice}</div>}
        {error && <div className="dev-admin-error">{error}</div>}
      </div>
    </div>
  );
}
