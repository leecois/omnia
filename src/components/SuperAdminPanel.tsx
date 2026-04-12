import { useEffect, useMemo, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { Server, SpecialChatRole, SuperAdmin, User } from '../module_bindings/types';
import { generateAlias } from '../utils/alias';

const DEFAULT_SERVER_ID = 1n;

interface Props {
  servers: readonly Server[];
  superAdmins: readonly SuperAdmin[];
  specialChatRoles: readonly SpecialChatRole[];
  allUsers: readonly User[];
  currentIdentityHex: string;
  onClose: () => void;
}

type Tab = 'super' | 'special';

export default function SuperAdminPanel({
  servers,
  superAdmins,
  specialChatRoles,
  allUsers,
  currentIdentityHex,
  onClose,
}: Props) {
  const [tab, setTab] = useState<Tab>('super');
  const [query, setQuery] = useState('');

  const grantSuperAdmin = useReducer(reducers.grantSuperAdmin);
  const revokeSuperAdmin = useReducer(reducers.revokeSuperAdmin);
  const grantSpecialRole = useReducer(reducers.grantSpecialRole);
  const revokeSpecialRole = useReducer(reducers.revokeSpecialRole);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const userByHex = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of allUsers) m.set(u.identity.toHexString(), u);
    return m;
  }, [allUsers]);

  const superAdminHexes = useMemo(
    () => new Set(superAdmins.map(sa => sa.userIdentity.toHexString())),
    [superAdmins]
  );

  const defaultServer = servers.find(s => s.id === DEFAULT_SERVER_ID) ?? null;

  const specialHexes = useMemo(() => {
    const s = new Set<string>();
    for (const r of specialChatRoles) {
      if (r.serverId === DEFAULT_SERVER_ID) {
        s.add(r.userIdentity.toHexString());
      }
    }
    return s;
  }, [specialChatRoles]);

  // Filtered/sorted user rows for the current tab
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allUsers
      .map(u => {
        const hex = u.identity.toHexString();
        const displayName = u.name || generateAlias(hex);
        return { user: u, hex, displayName };
      })
      .filter(row => {
        if (!q) return true;
        return row.displayName.toLowerCase().includes(q) || row.hex.toLowerCase().startsWith(q);
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [allUsers, query]);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-super-admin" onMouseDown={e => e.stopPropagation()}>
        <header className="super-admin-header">
          <div className="super-admin-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
            </svg>
            <div>
              <h3>Super Admin Panel</h3>
              <p>
                Grant administrative privileges and chat-write access for the default community
                server.
              </p>
            </div>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </header>

        <div className="super-admin-tabs">
          <button
            type="button"
            className={`super-admin-tab ${tab === 'super' ? 'active' : ''}`}
            onClick={() => setTab('super')}
          >
            Super Admins <span className="super-admin-tab-count">{superAdmins.length}</span>
          </button>
          <button
            type="button"
            className={`super-admin-tab ${tab === 'special' ? 'active' : ''}`}
            onClick={() => setTab('special')}
          >
            Special Role ({defaultServer?.name ?? 'Default Server'}){' '}
            <span className="super-admin-tab-count">{specialHexes.size}</span>
          </button>
        </div>

        <div className="super-admin-body">
          <input
            type="text"
            className="settings-search-input"
            placeholder="Search users by name or identity prefix"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />

          {tab === 'super' && (
            <div className="settings-list">
              {filtered.length === 0 && <div className="settings-empty">No users found.</div>}
              {filtered.map(({ user, hex, displayName }) => {
                const isMe = hex === currentIdentityHex;
                const granted = superAdminHexes.has(hex);
                const color = user.avatarColor ?? '#5865F2';
                return (
                  <div key={hex} className="settings-member-row">
                    <div className="settings-member-avatar" style={{ backgroundColor: color }}>
                      {displayName[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="settings-member-body">
                      <div className="settings-member-name">
                        {displayName}
                        {isMe && <span className="settings-member-self"> (you)</span>}
                      </div>
                      <div className="settings-member-meta">{hex.slice(0, 12)}…</div>
                    </div>
                    {granted ? (
                      <>
                        <span className="settings-role-badge owner">Super Admin</span>
                        {!isMe && (
                          <button
                            type="button"
                            className="settings-row-action danger"
                            onClick={() =>
                              revokeSuperAdmin({
                                userIdentity: user.identity,
                              }).catch(err => alert(String(err)))
                            }
                          >
                            Revoke
                          </button>
                        )}
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() =>
                          grantSuperAdmin({
                            userIdentity: user.identity,
                          }).catch(err => alert(String(err)))
                        }
                      >
                        Grant
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'special' && (
            <div className="settings-list">
              {filtered.length === 0 && <div className="settings-empty">No users found.</div>}
              {filtered.map(({ user, hex, displayName }) => {
                const isMe = hex === currentIdentityHex;
                const granted = specialHexes.has(hex);
                const color = user.avatarColor ?? '#5865F2';
                return (
                  <div key={hex} className="settings-member-row">
                    <div className="settings-member-avatar" style={{ backgroundColor: color }}>
                      {displayName[0]?.toUpperCase() ?? '?'}
                    </div>
                    <div className="settings-member-body">
                      <div className="settings-member-name">
                        {displayName}
                        {isMe && <span className="settings-member-self"> (you)</span>}
                      </div>
                      <div className="settings-member-meta">{hex.slice(0, 12)}…</div>
                    </div>
                    {granted ? (
                      <>
                        <span className="settings-role-badge mod">Special Role</span>
                        <button
                          type="button"
                          className="settings-row-action danger"
                          onClick={() =>
                            revokeSpecialRole({
                              serverId: DEFAULT_SERVER_ID,
                              userIdentity: user.identity,
                            }).catch(err => alert(String(err)))
                          }
                        >
                          Revoke
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={() =>
                          grantSpecialRole({
                            serverId: DEFAULT_SERVER_ID,
                            userIdentity: user.identity,
                          }).catch(err => alert(String(err)))
                        }
                      >
                        Grant
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
