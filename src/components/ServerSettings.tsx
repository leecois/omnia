import { useEffect, useMemo, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type {
  Server,
  Channel,
  Category,
  ServerMember,
  Invite,
  User,
  ServerRole,
  MemberRole,
} from '../module_bindings/types';
import { generateAlias } from '../utils/alias';

type SettingsSection =
  | 'profile'
  | 'tag'
  | 'engagement'
  | 'boost'
  | 'emoji'
  | 'stickers'
  | 'soundboard'
  | 'members'
  | 'roles'
  | 'invites'
  | 'access'
  | 'channels'
  | 'ai'
  | 'integrations'
  | 'appdir'
  | 'safety'
  | 'audit'
  | 'bans'
  | 'community'
  | 'onboarding'
  | 'insights'
  | 'template';

interface NavItem {
  id: SettingsSection;
  label: string;
  stub?: boolean;
  external?: boolean;
  badge?: string;
}

interface NavGroup {
  header?: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    items: [
      { id: 'profile', label: 'Server Profile' },
      { id: 'tag', label: 'Server Tag', stub: true },
      { id: 'engagement', label: 'Engagement', stub: true },
      { id: 'boost', label: 'Boost Perks', stub: true },
    ],
  },
  {
    header: 'Expression',
    items: [
      { id: 'emoji', label: 'Emoji', stub: true },
      { id: 'stickers', label: 'Stickers', stub: true },
      { id: 'soundboard', label: 'Soundboard', stub: true },
    ],
  },
  {
    header: 'People',
    items: [
      { id: 'members', label: 'Members', external: true },
      { id: 'roles', label: 'Roles' },
      { id: 'invites', label: 'Invites' },
      { id: 'access', label: 'Access', stub: true },
    ],
  },
  {
    header: 'Channels',
    items: [
      { id: 'channels', label: 'Channel Setup' },
    ],
  },
  {
    header: 'Apps',
    items: [
      { id: 'ai', label: 'AI Assistant' },
      { id: 'integrations', label: 'Integrations', stub: true },
      { id: 'appdir', label: 'App Directory', stub: true, external: true },
    ],
  },
  {
    header: 'Moderation',
    items: [
      { id: 'safety', label: 'Safety Setup', stub: true },
      { id: 'audit', label: 'Audit Log', stub: true },
      { id: 'bans', label: 'Bans', stub: true },
    ],
  },
  {
    items: [
      { id: 'community', label: 'Community Overview', stub: true, badge: 'ON' },
      { id: 'onboarding', label: 'Onboarding', stub: true, badge: 'ON' },
      { id: 'insights', label: 'Server Insights', stub: true },
    ],
  },
  {
    items: [{ id: 'template', label: 'Server Template', stub: true }],
  },
];

const BANNER_COLORS = [
  '#4fa3d4', '#e84a90', '#d94040', '#e88f3e', '#edc63a',
  '#9a5cd6', '#3d88e0', '#4cd6bc', '#4c9f5a', '#5a6270',
];

const DEFAULT_BANNER = '#5865f2';

// Backend stores a sentinel 'none' for string columns that were migrated into
// existing rows with a non-empty default. Normalize these away for display.
function normStr(s: string): string {
  return s === 'none' ? '' : s;
}
function normBanner(s: string): string {
  if (!s || s === 'none') return DEFAULT_BANNER;
  return s;
}

interface ServerSettingsProps {
  server: Server;
  channels: readonly Channel[];
  categories: readonly Category[];
  members: ServerMember[];
  users: readonly User[];
  invites: Invite[];
  serverRoles: readonly ServerRole[];
  memberRoles: readonly MemberRole[];
  currentIdentityHex: string;
  isOwner: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  onClose: () => void;
}

export default function ServerSettings({
  server,
  channels,
  categories,
  members,
  users,
  invites,
  serverRoles,
  memberRoles,
  currentIdentityHex,
  isOwner,
  isAdmin,
  isSuperAdmin,
  onClose,
}: ServerSettingsProps) {

  const [section, setSection] = useState<SettingsSection>('profile');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showDeleteConfirm) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showDeleteConfirm]);

  const renderNavItem = (item: NavItem) => (
    <button
      key={item.id}
      className={`settings-nav-item ${section === item.id ? 'active' : ''} ${item.stub ? 'stub' : ''}`}
      onClick={() => setSection(item.id)}
    >
      <span className="settings-nav-label">{item.label}</span>
      {item.badge && (
        <span className="settings-nav-badge">{item.badge}</span>
      )}
      {item.external && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 3h7v7" />
          <path d="M10 14L21 3" />
          <path d="M21 14v5a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h5" />
        </svg>
      )}
    </button>
  );

  return (
    <div className="settings-fullscreen">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-inner">
          <div className="settings-server-name">
            {server.name.toUpperCase()}
          </div>

          {NAV_GROUPS.map((group, i) => (
            <div key={i} className="settings-nav-group">
              {group.header && (
                <div className="settings-nav-header">{group.header}</div>
              )}
              {group.items.map(renderNavItem)}
            </div>
          ))}

          {isOwner && (
            <div className="settings-nav-group">
              <button
                className="settings-nav-item danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <span className="settings-nav-label">Delete Server</span>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </aside>

      <div className="settings-content-wrap">
        <div className="settings-content">
          {section === 'profile' && (
            <ServerProfileSection
              server={server}
              members={members}
              users={users}
              canEdit={isAdmin}
            />
          )}
          {section === 'members' && (
            <MembersSection
              serverId={server.id}
              ownerHex={server.ownerId.toHexString()}
              members={members}
              users={users}
              currentIdentityHex={currentIdentityHex}
              canKick={isAdmin}
              canSetRole={isOwner}
            />
          )}
          {section === 'invites' && (
            <InvitesSection
              serverId={server.id}
              invites={invites}
              users={users}
              canManage={isAdmin}
            />
          )}
          {section === 'roles' && (
            <RolesSection
              serverId={server.id}
              roles={serverRoles}
              memberRoles={memberRoles}
              members={members}
              users={users}
              canEdit={isSuperAdmin || (isAdmin && server.id !== 1n)}
            />
          )}
          {section === 'channels' && (
            <ChannelsSection
              server={server}
              channels={channels}
              categories={categories}
              canEdit={isAdmin || isSuperAdmin}
              isSuperAdmin={isSuperAdmin}
            />
          )}
          {section === 'ai' && (
            <AiSection
              server={server}
              canEdit={isAdmin || isSuperAdmin}
            />
          )}
          {/* All other sections are stubs */}
          {section !== 'profile' &&
            section !== 'members' &&
            section !== 'invites' &&
            section !== 'roles' &&
            section !== 'channels' &&
            section !== 'ai' && <ComingSoonSection sectionId={section} />}
        </div>

        <button
          className="settings-close-esc"
          onClick={onClose}
          aria-label="Close settings"
        >
          <div className="settings-close-esc-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </div>
          <div className="settings-close-esc-label">ESC</div>
        </button>
      </div>

      {showDeleteConfirm && (
        <DeleteServerConfirm
          server={server}
          onCancel={() => setShowDeleteConfirm(false)}
          onDeleted={() => {
            setShowDeleteConfirm(false);
            onClose();
          }}
        />
      )}
    </div>
  );
}

// ─── Server Profile Section ──────────────────────────────────────────────

function ServerProfileSection({
  server,
  members,
  users,
  canEdit,
}: {
  server: Server;
  members: ServerMember[];
  users: readonly User[];
  canEdit: boolean;
}) {
  const updateServer = useReducer(reducers.updateServer);
  const initialIcon = normStr(server.iconUrl);
  const initialBanner = normBanner(server.bannerColor);
  const initialTraits = normStr(server.traits);
  const [name, setName] = useState(server.name);
  const [description, setDescription] = useState(server.description);
  const [iconUrl, setIconUrl] = useState(initialIcon);
  const [bannerColor, setBannerColor] = useState(initialBanner);
  const [traits, setTraits] = useState(initialTraits);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    setName(server.name);
    setDescription(server.description);
    setIconUrl(normStr(server.iconUrl));
    setBannerColor(normBanner(server.bannerColor));
    setTraits(normStr(server.traits));
  }, [server.id, server.name, server.description, server.iconUrl, server.bannerColor, server.traits]);

  const dirty =
    name !== server.name ||
    description !== server.description ||
    iconUrl !== normStr(server.iconUrl) ||
    bannerColor !== normBanner(server.bannerColor) ||
    traits !== normStr(server.traits);

  const reset = () => {
    setName(server.name);
    setDescription(server.description);
    setIconUrl(normStr(server.iconUrl));
    setBannerColor(normBanner(server.bannerColor));
    setTraits(normStr(server.traits));
    setErr('');
  };

  const save = () => {
    if (!name.trim()) {
      setErr('Server name is required');
      return;
    }
    setSaving(true);
    setErr('');
    updateServer({
      serverId: server.id,
      name: name.trim(),
      description,
      isPublic: server.isPublic,
      iconUrl,
      bannerColor,
      traits,
    })
      .catch(e => setErr(String(e?.message ?? e)))
      .finally(() => setSaving(false));
  };

  // Parse traits array from comma-separated string
  const traitList = traits
    .split(',')
    .map(t => t.trim())
    .filter(Boolean)
    .slice(0, 5);

  const updateTraitAt = (idx: number, value: string) => {
    const arr = [...traitList];
    while (arr.length <= idx) arr.push('');
    arr[idx] = value;
    setTraits(arr.filter(Boolean).join(','));
  };

  // Compute preview stats
  const memberCount = members.length;
  const onlineCount = useMemo(() => {
    const memberHexes = new Set(
      members.map(m => m.userIdentity.toHexString())
    );
    return users.filter(
      u => memberHexes.has(u.identity.toHexString()) && u.online
    ).length;
  }, [members, users]);

  const createdDate = new Date(
    Number(server.createdAt.microsSinceUnixEpoch / 1000n)
  );
  const estText = `Est. ${createdDate.toLocaleString('en-US', { month: 'short', year: 'numeric' })}`;

  return (
    <div className="settings-section profile-section">
      <div className="profile-top">
        <div className="profile-top-fields">
          <h2 className="settings-section-title">Server Profile</h2>
          <p className="settings-section-subtitle">
            Customize how your server appears in invite links and, if enabled,
            in Server Discovery and Announcement Channel messages
          </p>

          <div className="settings-field">
            <label>NAME</label>
            <input
              type="text"
              value={name}
              disabled={!canEdit}
              maxLength={48}
              onChange={e => setName(e.target.value)}
            />
          </div>

          <div className="settings-field">
            <label>ICON</label>
            <div className="settings-field-hint">
              We recommend an image of at least 512x512.
            </div>
            <div className="profile-icon-row">
              <button
                type="button"
                className="btn-primary"
                disabled={!canEdit}
                onClick={() => {
                  const url = window.prompt(
                    'Enter an image URL for your server icon:',
                    iconUrl
                  );
                  if (url !== null) setIconUrl(url);
                }}
              >
                Change Server Icon
              </button>
              {iconUrl && canEdit && (
                <button
                  type="button"
                  className="btn-link"
                  onClick={() => setIconUrl('')}
                >
                  Remove Icon
                </button>
              )}
            </div>
          </div>
        </div>

        <PreviewCard
          name={name}
          iconUrl={iconUrl}
          bannerColor={bannerColor}
          onlineCount={onlineCount}
          memberCount={memberCount}
          estText={estText}
        />
      </div>

      <div className="settings-field">
        <label>BANNER</label>
        <div className="profile-banner-grid">
          {BANNER_COLORS.map(c => (
            <button
              key={c}
              type="button"
              className={`profile-banner-swatch ${bannerColor === c ? 'selected' : ''}`}
              style={{ backgroundColor: c }}
              disabled={!canEdit}
              onClick={() => setBannerColor(c)}
              title={c}
            />
          ))}
        </div>
      </div>

      <div className="settings-field">
        <label>TRAITS</label>
        <div className="settings-field-hint">
          Add up to 5 traits to show off your server&apos;s interests and personality.
        </div>
        <div className="profile-traits-row">
          {[0, 1, 2, 3, 4].map(idx => (
            <div key={idx} className="profile-trait-chip">
              <span className="profile-trait-dot" />
              <input
                type="text"
                placeholder=""
                value={traitList[idx] ?? ''}
                disabled={!canEdit}
                maxLength={24}
                onChange={e => updateTraitAt(idx, e.target.value)}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="settings-field">
        <label>DESCRIPTION</label>
        <div className="settings-field-hint">
          How did your server get started? Why should people join?
        </div>
        <textarea
          value={description}
          disabled={!canEdit}
          maxLength={256}
          rows={4}
          placeholder="Tell the world a bit about this server."
          onChange={e => setDescription(e.target.value)}
        />
      </div>

      {err && <div className="settings-error">{err}</div>}

      {canEdit && dirty && (
        <div className="settings-save-bar">
          <span>Careful — you have unsaved changes!</span>
          <div>
            <button
              type="button"
              className="btn-secondary"
              onClick={reset}
              disabled={saving}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={save}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Preview Card ────────────────────────────────────────────────────────

function PreviewCard({
  name,
  iconUrl,
  bannerColor,
  onlineCount,
  memberCount,
  estText,
}: {
  name: string;
  iconUrl: string;
  bannerColor: string;
  onlineCount: number;
  memberCount: number;
  estText: string;
}) {
  return (
    <div className="profile-preview">
      <div
        className="profile-preview-banner"
        style={{ backgroundColor: bannerColor || DEFAULT_BANNER }}
      />
      <div className="profile-preview-body">
        <div className="profile-preview-icon">
          {iconUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={iconUrl}
              alt={name}
              onError={e => {
                (e.target as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <span>{name[0]?.toUpperCase() ?? '?'}</span>
          )}
        </div>
        <div className="profile-preview-title">
          <span>{name}</span>
          <svg
            className="profile-preview-check"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M22.7 10l-2.1-2.1c-.4-.4-.6-.9-.6-1.4V3.5c0-1.1-.9-2-2-2h-3c-.5 0-1-.2-1.4-.6L11.4-1.2c-.8-.8-2-.8-2.8 0L6.5.9c-.4.4-.9.6-1.4.6h-3c-1.1 0-2 .9-2 2v3c0 .5-.2 1-.6 1.4L-2.7 10c-.8.8-.8 2 0 2.8l2.1 2.1c.4.4.6.9.6 1.4v3c0 1.1.9 2 2 2h3c.5 0 1 .2 1.4.6l2.1 2.1c.8.8 2 .8 2.8 0l2.1-2.1c.4-.4.9-.6 1.4-.6h3c1.1 0 2-.9 2-2v-3c0-.5.2-1 .6-1.4l2.1-2.1c.8-.8.8-2 0-2.8zM9.7 17.3l-4.4-4.4 1.4-1.4 3 3 6.6-6.6 1.4 1.4-8 8z" />
          </svg>
        </div>
        <div className="profile-preview-stats">
          <span className="profile-preview-stat">
            <span className="profile-preview-dot online" /> {onlineCount} Online
          </span>
          <span className="profile-preview-stat">
            <span className="profile-preview-dot muted" /> {memberCount} Members
          </span>
        </div>
        <div className="profile-preview-est">{estText}</div>
      </div>
    </div>
  );
}

// ─── Section: Members ────────────────────────────────────────────────────

function MembersSection({
  serverId,
  ownerHex,
  members,
  users,
  currentIdentityHex,
  canKick,
  canSetRole,
}: {
  serverId: bigint;
  ownerHex: string;
  members: ServerMember[];
  users: readonly User[];
  currentIdentityHex: string;
  canKick: boolean;
  canSetRole: boolean;
}) {
  const kickMember = useReducer(reducers.kickMember);
  const setMemberRole = useReducer(reducers.setMemberRole);
  const [query, setQuery] = useState('');

  const userByHex = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of users) m.set(u.identity.toHexString(), u);
    return m;
  }, [users]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return members
      .map(m => {
        const hex = m.userIdentity.toHexString();
        const u = userByHex.get(hex);
        const displayName = m.nickname || u?.name || generateAlias(hex);
        return { member: m, user: u, hex, displayName };
      })
      .filter(row => {
        if (!q) return true;
        return (
          row.displayName.toLowerCase().includes(q) ||
          (row.user?.name ?? '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const rank = (r: string) =>
          r === 'owner' ? 0 : r === 'admin' ? 1 : r === 'mod' ? 2 : 3;
        const ra = rank(a.member.role);
        const rb = rank(b.member.role);
        if (ra !== rb) return ra - rb;
        return a.displayName.localeCompare(b.displayName);
      });
  }, [members, userByHex, query]);

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">
        Members <span className="settings-count">— {members.length}</span>
      </h2>

      <input
        className="settings-search-input"
        type="text"
        placeholder="Search members"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />

      <div className="settings-list">
        {filtered.map(({ member, user, hex, displayName }) => {
          const isOwnerRow = hex === ownerHex;
          const isSelf = hex === currentIdentityHex;
          const color = user?.avatarColor ?? '#5865F2';
          return (
            <div key={hex} className="settings-member-row">
              <div
                className="settings-member-avatar"
                style={{ backgroundColor: color }}
              >
                {displayName[0]?.toUpperCase() ?? '?'}
              </div>
              <div className="settings-member-body">
                <div className="settings-member-name">
                  {displayName}
                  {isSelf && (
                    <span className="settings-member-self"> (you)</span>
                  )}
                </div>
                <div className="settings-member-meta">
                  {user?.name ?? hex.slice(0, 8)}
                </div>
              </div>
              <div className="settings-member-role">
                {canSetRole && !isOwnerRow ? (
                  <select
                    value={member.role}
                    onChange={e =>
                      setMemberRole({
                        serverId,
                        userIdentity: member.userIdentity,
                        role: e.target.value,
                      }).catch(err => alert(String(err)))
                    }
                  >
                    <option value="admin">Admin</option>
                    <option value="mod">Mod</option>
                    <option value="member">Member</option>
                  </select>
                ) : (
                  <span className={`settings-role-badge ${member.role}`}>
                    {member.role}
                  </span>
                )}
              </div>
              {canKick && !isOwnerRow && !isSelf && (
                <button
                  type="button"
                  className="settings-row-action danger"
                  title="Kick member"
                  onClick={() => {
                    if (confirm(`Kick ${displayName} from this server?`)) {
                      kickMember({
                        serverId,
                        userIdentity: member.userIdentity,
                      }).catch(err => alert(String(err)));
                    }
                  }}
                >
                  Kick
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section: Invites ────────────────────────────────────────────────────

function InvitesSection({
  serverId,
  invites,
  users,
  canManage,
}: {
  serverId: bigint;
  invites: Invite[];
  users: readonly User[];
  canManage: boolean;
}) {
  const createInvite = useReducer(reducers.createInvite);
  const deleteInvite = useReducer(reducers.deleteInvite);
  const [maxUses, setMaxUses] = useState(0);
  const [expiresInHours, setExpiresInHours] = useState(24);
  const [copied, setCopied] = useState('');
  const [err, setErr] = useState('');

  const userByHex = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of users) m.set(u.identity.toHexString(), u);
    return m;
  }, [users]);

  const serverInvites = invites
    .filter(inv => inv.serverId === serverId)
    .sort((a, b) => (a.id < b.id ? 1 : -1));

  const copy = (code: string) => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(code);
      setTimeout(() => setCopied(''), 1500);
    });
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Invites</h2>

      {canManage && (
        <>
          <div className="settings-sub-header">Create New Invite</div>
          <div className="settings-invite-form">
            <label>
              Max uses (0 = unlimited)
              <input
                type="number"
                min={0}
                value={maxUses}
                onChange={e => setMaxUses(Number(e.target.value))}
              />
            </label>
            <label>
              Expires (hours, 0 = never)
              <input
                type="number"
                min={0}
                value={expiresInHours}
                onChange={e => setExpiresInHours(Number(e.target.value))}
              />
            </label>
            <button
              type="button"
              className="btn-primary"
              onClick={() => {
                setErr('');
                createInvite({ serverId, maxUses, expiresInHours }).catch(e =>
                  setErr(String(e?.message ?? e))
                );
              }}
            >
              Generate
            </button>
          </div>
        </>
      )}

      {err && <div className="settings-error">{err}</div>}

      <div className="settings-sub-header">
        Active Invites ({serverInvites.length})
      </div>
      <div className="settings-list">
        {serverInvites.length === 0 && (
          <div className="settings-empty">No invites yet.</div>
        )}
        {serverInvites.map(inv => {
          const creator = userByHex.get(inv.createdBy.toHexString());
          const creatorName =
            creator?.name ?? generateAlias(inv.createdBy.toHexString());
          const expiresText =
            inv.expiresAt === 0n
              ? 'Never expires'
              : `Expires ${new Date(
                  Number(inv.expiresAt / 1000n)
                ).toLocaleDateString()}`;
          const usesText =
            inv.maxUses > 0
              ? `${inv.usesCount}/${inv.maxUses} uses`
              : `${inv.usesCount} uses`;
          return (
            <div key={inv.id.toString()} className="settings-invite-row">
              <code className="settings-invite-code">{inv.code}</code>
              <div className="settings-invite-meta">
                <span>{usesText}</span>
                <span>·</span>
                <span>{expiresText}</span>
                <span>·</span>
                <span>by {creatorName}</span>
              </div>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => copy(inv.code)}
              >
                {copied === inv.code ? '✓ Copied' : 'Copy'}
              </button>
              {canManage && (
                <button
                  type="button"
                  className="settings-row-action danger"
                  onClick={() =>
                    deleteInvite({ inviteId: inv.id }).catch(err =>
                      alert(String(err))
                    )
                  }
                >
                  Revoke
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Section: Roles (custom Discord-style permission roles) ─────────────

const PERMISSION_FLAGS: Array<{
  flag: bigint;
  label: string;
  description: string;
}> = [
  { flag: 1n, label: 'View Channels', description: 'See channels in this server.' },
  { flag: 2n, label: 'Send Messages', description: 'Post messages in text channels.' },
  { flag: 4n, label: 'Manage Messages', description: 'Delete and pin any message.' },
  { flag: 8n, label: 'Manage Channels', description: 'Create, edit, and delete channels.' },
  { flag: 16n, label: 'Kick Members', description: 'Remove members from this server.' },
  { flag: 32n, label: 'Ban Members', description: 'Permanently ban members.' },
  { flag: 64n, label: 'Manage Roles', description: 'Create and edit roles below their own.' },
  { flag: 128n, label: 'Manage Server', description: 'Edit server settings and profile.' },
  { flag: 256n, label: 'Create Invite', description: 'Generate invite links to share.' },
  { flag: 512n, label: 'Add Reactions', description: 'React to messages with emoji.' },
  { flag: 1024n, label: 'Administrator', description: 'Bypass all permission checks. Use with care.' },
];

function RolesSection({
  serverId,
  roles,
  memberRoles,
  members,
  users,
  canEdit,
}: {
  serverId: bigint;
  roles: readonly ServerRole[];
  memberRoles: readonly MemberRole[];
  members: ServerMember[];
  users: readonly User[];
  canEdit: boolean;
}) {
  const createRole = useReducer(reducers.createRole);
  const updateRole = useReducer(reducers.updateRole);
  const deleteRole = useReducer(reducers.deleteRole);
  const assignRole = useReducer(reducers.assignRole);
  const unassignRole = useReducer(reducers.unassignRole);

  const sortedRoles = useMemo(
    () => [...roles].sort((a, b) => b.position - a.position),
    [roles]
  );

  const [selectedId, setSelectedId] = useState<bigint | null>(null);
  useEffect(() => {
    if (selectedId === null && sortedRoles.length > 0) {
      setSelectedId(sortedRoles[0].id);
    }
    if (
      selectedId !== null &&
      !sortedRoles.some(r => r.id === selectedId)
    ) {
      setSelectedId(sortedRoles[0]?.id ?? null);
    }
  }, [sortedRoles, selectedId]);

  const selected = sortedRoles.find(r => r.id === selectedId) ?? null;

  // Edit form state
  const [name, setName] = useState('');
  const [color, setColor] = useState('');
  const [perms, setPerms] = useState<bigint>(0n);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (selected) {
      setName(selected.name);
      setColor(selected.color);
      setPerms(selected.permissions);
      setErr('');
    }
  }, [selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty =
    selected !== null &&
    (name !== selected.name ||
      color !== selected.color ||
      perms !== selected.permissions);

  const togglePerm = (flag: bigint) => {
    setPerms(p => ((p & flag) !== 0n ? p & ~flag : p | flag));
  };

  const save = () => {
    if (!selected) return;
    setErr('');
    updateRole({
      roleId: selected.id,
      name: name.trim(),
      color,
      permissions: perms,
    }).catch(e => setErr(String(e?.message ?? e)));
  };

  const removeSelected = () => {
    if (!selected || selected.isDefault) return;
    if (!confirm(`Delete role "${selected.name}"?`)) return;
    deleteRole({ roleId: selected.id }).catch(e => alert(String(e)));
  };

  const create = () => {
    setErr('');
    createRole({
      serverId,
      name: 'New Role',
      color: '',
      permissions: 1n, // VIEW_CHANNELS by default
    }).catch(e => setErr(String(e?.message ?? e)));
  };

  // Member assignment for the selected role
  const memberRowsForRole = useMemo(() => {
    if (!selected) return [];
    const userByHex = new Map<string, User>();
    for (const u of users) userByHex.set(u.identity.toHexString(), u);
    const assignedHexes = new Set<string>();
    for (const mr of memberRoles) {
      if (mr.roleId === selected.id) {
        assignedHexes.add(mr.userIdentity.toHexString());
      }
    }
    return members.map(m => {
      const hex = m.userIdentity.toHexString();
      const u = userByHex.get(hex);
      return {
        member: m,
        user: u,
        hex,
        displayName: m.nickname || u?.name || generateAlias(hex),
        assigned: assignedHexes.has(hex),
      };
    }).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [selected, members, users, memberRoles]);

  return (
    <div className="settings-section roles-section">
      <h2 className="settings-section-title">Roles</h2>
      <p className="settings-section-subtitle">
        Use roles to group server members and assign permissions.
      </p>

      <div className="roles-layout">
        <div className="roles-list-col">
          <div className="roles-list-header">
            <span>ROLES — {sortedRoles.length}</span>
            {canEdit && (
              <button type="button" className="btn-primary" onClick={create}>
                Create Role
              </button>
            )}
          </div>
          <div className="roles-list">
            {sortedRoles.map(r => (
              <button
                key={r.id.toString()}
                type="button"
                className={`role-list-item ${selectedId === r.id ? 'active' : ''}`}
                onClick={() => setSelectedId(r.id)}
              >
                <span
                  className="role-color-dot"
                  style={{ backgroundColor: r.color || 'var(--channels-default)' }}
                />
                <span className="role-list-name">{r.name}</span>
                {r.isDefault && <span className="role-default-tag">default</span>}
              </button>
            ))}
            {sortedRoles.length === 0 && (
              <div className="settings-empty">No roles yet.</div>
            )}
          </div>
        </div>

        <div className="roles-edit-col">
          {selected ? (
            <>
              <div className="settings-field">
                <label>ROLE NAME</label>
                <input
                  type="text"
                  value={name}
                  disabled={!canEdit || selected.isDefault}
                  maxLength={48}
                  onChange={e => setName(e.target.value)}
                />
                {selected.isDefault && (
                  <div className="settings-field-hint">
                    The @everyone role applies to every member and cannot be renamed or removed.
                  </div>
                )}
              </div>

              <div className="settings-field">
                <label>ROLE COLOR</label>
                <div className="role-color-row">
                  {['', '#5865f2', '#3ba55c', '#faa61a', '#ed4245', '#eb459e', '#9b59b6', '#1abc9c'].map(c => (
                    <button
                      key={c || 'none'}
                      type="button"
                      className={`role-color-swatch ${color === c ? 'selected' : ''}`}
                      style={{ backgroundColor: c || 'transparent' }}
                      disabled={!canEdit}
                      onClick={() => setColor(c)}
                      title={c || 'No color'}
                    >
                      {!c && <span>∅</span>}
                    </button>
                  ))}
                </div>
              </div>

              <div className="settings-field">
                <label>PERMISSIONS</label>
                <div className="role-perms-list">
                  {PERMISSION_FLAGS.map(p => {
                    const checked = (perms & p.flag) !== 0n;
                    return (
                      <label key={p.flag.toString()} className="role-perm-row">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={!canEdit}
                          onChange={() => togglePerm(p.flag)}
                        />
                        <div>
                          <div className="role-perm-name">{p.label}</div>
                          <div className="role-perm-desc">{p.description}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>

              {err && <div className="settings-error">{err}</div>}

              {canEdit && (
                <div className="role-actions-row">
                  {!selected.isDefault && (
                    <button
                      type="button"
                      className="btn-danger"
                      onClick={removeSelected}
                    >
                      Delete Role
                    </button>
                  )}
                  <div className="role-actions-spacer" />
                  {dirty && (
                    <>
                      <button
                        type="button"
                        className="btn-secondary"
                        onClick={() => {
                          if (!selected) return;
                          setName(selected.name);
                          setColor(selected.color);
                          setPerms(selected.permissions);
                        }}
                      >
                        Reset
                      </button>
                      <button
                        type="button"
                        className="btn-primary"
                        onClick={save}
                      >
                        Save Changes
                      </button>
                    </>
                  )}
                </div>
              )}

              {!selected.isDefault && (
                <div className="settings-field">
                  <label>MANAGE MEMBERS</label>
                  <div className="settings-field-hint">
                    Click a member to grant or revoke this role.
                  </div>
                  <div className="settings-list">
                    {memberRowsForRole.map(({ user, hex, displayName, assigned }) => {
                      const color = user?.avatarColor ?? '#5865F2';
                      return (
                        <div key={hex} className="settings-member-row">
                          <div
                            className="settings-member-avatar"
                            style={{ backgroundColor: color }}
                          >
                            {displayName[0]?.toUpperCase() ?? '?'}
                          </div>
                          <div className="settings-member-body">
                            <div className="settings-member-name">
                              {displayName}
                            </div>
                          </div>
                          {canEdit && user && (
                            assigned ? (
                              <button
                                type="button"
                                className="settings-row-action danger"
                                onClick={() =>
                                  unassignRole({
                                    roleId: selected.id,
                                    userIdentity: user.identity,
                                  }).catch(e => alert(String(e)))
                                }
                              >
                                Remove
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="btn-primary"
                                onClick={() =>
                                  assignRole({
                                    roleId: selected.id,
                                    userIdentity: user.identity,
                                  }).catch(e => alert(String(e)))
                                }
                              >
                                Assign
                              </button>
                            )
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="settings-empty">
              Select a role to edit, or create a new one.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Section: AI Assistant ───────────────────────────────────────────────

function AiSection({
  server,
  canEdit,
}: {
  server: Server;
  canEdit: boolean;
}) {
  const [allConfigs] = useTable(tables.ai_config);
  const ensureAiConfig = useReducer(reducers.ensureAiConfig);
  const updateAiConfig = useReducer(reducers.updateAiConfig);

  const existing = useMemo(
    () => allConfigs.find(c => c.serverId === server.id) ?? null,
    [allConfigs, server.id]
  );

  // Local editor state — seeded from the existing row, fall back to defaults.
  const [enabled, setEnabled] = useState(false);
  const [askEnabled, setAskEnabled] = useState(false);
  const [summarizeEnabled, setSummarizeEnabled] = useState(false);
  const [monthlyTokenBudget, setMonthlyTokenBudget] = useState<string>('1000000');
  const [sourceChannelIds, setSourceChannelIds] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Ensure an ai_config row exists so the bot sees the server as "known".
  // Called exactly once on mount (per server).
  useEffect(() => {
    ensureAiConfig({ serverId: server.id }).catch(err => {
      console.warn('[ai] ensure_ai_config failed:', err);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id]);

  // Sync local editor state when the row first arrives / changes externally.
  useEffect(() => {
    if (existing) {
      setEnabled(existing.enabled);
      setAskEnabled(existing.askEnabled);
      setSummarizeEnabled(existing.summarizeEnabled);
      setMonthlyTokenBudget(existing.monthlyTokenBudget.toString());
      setSourceChannelIds(existing.sourceChannelIds);
    }
  }, [existing]);

  const save = async () => {
    if (!canEdit || saving) return;
    setSaving(true);
    try {
      const budget = BigInt(monthlyTokenBudget.trim() || '0');
      await updateAiConfig({
        serverId: server.id,
        enabled,
        askEnabled,
        summarizeEnabled,
        monthlyTokenBudget: budget,
        sourceChannelIds: sourceChannelIds.trim(),
      });
      setSavedAt(Date.now());
      setTimeout(() => setSavedAt(null), 2500);
    } catch (err) {
      alert(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  const tokensUsed = existing?.tokensUsedThisMonth ?? 0n;
  const tokensBudget = existing?.monthlyTokenBudget ?? 0n;
  const pctUsed =
    tokensBudget > 0n
      ? Math.min(100, Number((tokensUsed * 100n) / tokensBudget))
      : 0;

  return (
    <div className="profile-section">
      <h2 className="profile-heading">AI Assistant</h2>
      <p className="profile-sub">
        Enable the <code>/ask</code> slash command so members can ask questions grounded in this
        server's messages. Answers are produced by a sidecar bot that indexes your docs channels
        into a vector store (Qdrant) and queries an LLM (OpenAI or Gemini).
      </p>

      <div className="ch-setup-section" style={{ marginTop: 24 }}>
        <label className="profile-field">
          <input
            type="checkbox"
            checked={enabled}
            disabled={!canEdit}
            onChange={e => setEnabled(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          <span className="profile-field-label" style={{ display: 'inline' }}>
            Enable AI assistant on this server
          </span>
        </label>

        <label className="profile-field" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={askEnabled}
            disabled={!canEdit || !enabled}
            onChange={e => setAskEnabled(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          <span className="profile-field-label" style={{ display: 'inline' }}>
            Enable <code>/ask</code> slash command
          </span>
        </label>

        <label className="profile-field" style={{ marginTop: 12 }}>
          <input
            type="checkbox"
            checked={summarizeEnabled}
            disabled={!canEdit || !enabled}
            onChange={e => setSummarizeEnabled(e.target.checked)}
            style={{ marginRight: 8 }}
          />
          <span className="profile-field-label" style={{ display: 'inline' }}>
            Enable thread summarization (coming soon)
          </span>
        </label>
      </div>

      <div className="ch-setup-section" style={{ marginTop: 24 }}>
        <label className="profile-field">
          <span className="profile-field-label">Monthly token budget</span>
          <input
            type="number"
            min="0"
            value={monthlyTokenBudget}
            disabled={!canEdit}
            onChange={e => setMonthlyTokenBudget(e.target.value)}
            className="profile-input"
          />
          <span className="profile-field-help">
            0 = unlimited. 1 M tokens ≈ $0.30 at gpt-4o-mini rates.
          </span>
        </label>

        {tokensBudget > 0n && (
          <div className="profile-field-help" style={{ marginTop: 8 }}>
            Used this month: <strong>{tokensUsed.toString()}</strong> / {tokensBudget.toString()} tokens ({pctUsed}%)
          </div>
        )}
      </div>

      <div className="ch-setup-section" style={{ marginTop: 24 }}>
        <label className="profile-field">
          <span className="profile-field-label">Source channels</span>
          <input
            type="text"
            value={sourceChannelIds}
            disabled={!canEdit}
            onChange={e => setSourceChannelIds(e.target.value)}
            placeholder="Leave blank to index all channels"
            className="profile-input"
          />
          <span className="profile-field-help">
            Comma-separated channel IDs. Leave blank to index every channel in this server.
          </span>
        </label>
      </div>

      <div className="profile-actions" style={{ marginTop: 24 }}>
        <button className="btn-primary" onClick={save} disabled={!canEdit || saving}>
          {saving ? 'Saving…' : savedAt ? 'Saved ✓' : 'Save'}
        </button>
      </div>

      {!canEdit && (
        <p className="profile-field-help" style={{ marginTop: 16 }}>
          You need the Manage Server permission to change AI settings.
        </p>
      )}
    </div>
  );
}

// ─── Section: Channels ───────────────────────────────────────────────────

function ChannelsSection({
  server,
  channels,
  categories,
  canEdit,
  isSuperAdmin,
}: {
  server: Server;
  channels: readonly Channel[];
  categories: readonly Category[];
  canEdit: boolean;
  isSuperAdmin: boolean;
}) {
  const callUpdateChannel = useReducer(reducers.updateChannel);
  const callUpdateCategory = useReducer(reducers.updateCategory);
  const callCreateChannel = useReducer(reducers.createChannel);
  const callCreateCategory = useReducer(reducers.createCategory);
  const callDeleteChannel = useReducer(reducers.deleteChannel);
  const callDeleteCategory = useReducer(reducers.deleteCategory);
  const callReseed = useReducer(reducers.reseedDefaultServer);

  // Inline edit state: { type: 'channel'|'category', id: bigint }
  const [editing, setEditing] = useState<{ type: string; id: bigint } | null>(null);
  const [editName, setEditName] = useState('');
  const [editTopic, setEditTopic] = useState('');
  const [showReseedConfirm, setShowReseedConfirm] = useState(false);
  const [newChannelCatId, setNewChannelCatId] = useState<bigint>(0n);
  const [newChannelName, setNewChannelName] = useState('');
  const [showNewChannel, setShowNewChannel] = useState(false);
  const [newCatName, setNewCatName] = useState('');
  const [showNewCat, setShowNewCat] = useState(false);

  const isDefault = server.id === 1n;

  // Sort categories by position; channels by position within each category
  const sortedCats = useMemo(
    () => [...categories]
      .filter(c => c.serverId === server.id)
      .sort((a, b) => a.position - b.position),
    [categories, server.id]
  );
  const channelsByCat = useMemo(() => {
    const map = new Map<string, Channel[]>();
    for (const c of channels) {
      if (c.serverId !== server.id) continue;
      const key = c.categoryId.toString();
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(c);
    }
    for (const [, arr] of map) arr.sort((a, b) => a.position - b.position);
    return map;
  }, [channels, server.id]);

  function startEditChannel(c: Channel) {
    setEditing({ type: 'channel', id: c.id });
    setEditName(c.name);
    setEditTopic(c.topic);
  }
  function startEditCategory(cat: { id: bigint; name: string }) {
    setEditing({ type: 'category', id: cat.id });
    setEditName(cat.name);
    setEditTopic('');
  }
  function cancelEdit() { setEditing(null); }

  function saveEdit() {
    if (!editing) return;
    if (editing.type === 'channel') {
      callUpdateChannel({ channelId: editing.id, name: editName, topic: editTopic });
    } else {
      callUpdateCategory({ categoryId: editing.id, name: editName });
    }
    setEditing(null);
  }

  function submitNewChannel() {
    if (!newChannelName.trim()) return;
    callCreateChannel({ serverId: server.id, name: newChannelName.trim(), topic: '' });
    if (newChannelCatId !== 0n) {
      // We can't know the new channel id yet, so the user can move it after creation
    }
    setNewChannelName('');
    setShowNewChannel(false);
  }

  function submitNewCategory() {
    if (!newCatName.trim()) return;
    callCreateCategory({ serverId: server.id, name: newCatName.trim() });
    setNewCatName('');
    setShowNewCat(false);
  }

  // Uncategorized channels (categoryId === 0n or unknown category)
  const knownCatIds = new Set(sortedCats.map(c => c.id.toString()));
  const uncategorized = (channelsByCat.get('0') ?? []).concat(
    [...channelsByCat.entries()]
      .filter(([k]) => k !== '0' && !knownCatIds.has(k))
      .flatMap(([, v]) => v)
  );

  function renderChannelRow(c: Channel) {
    const isEditing = editing?.type === 'channel' && editing.id === c.id;
    return (
      <div key={c.id.toString()} className="ch-setup-channel-row">
        {isEditing ? (
          <div className="ch-setup-inline-edit">
            <input
              className="ch-setup-input"
              value={editName}
              onChange={e => setEditName(e.target.value)}
              placeholder="channel-name"
              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
              autoFocus
            />
            <input
              className="ch-setup-input"
              value={editTopic}
              onChange={e => setEditTopic(e.target.value)}
              placeholder="Channel topic (optional)"
              onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
            />
            <div className="ch-setup-inline-actions">
              <button className="ch-setup-btn-save" onClick={saveEdit}>Save</button>
              <button className="ch-setup-btn-cancel" onClick={cancelEdit}>Cancel</button>
            </div>
          </div>
        ) : (
          <>
            <span className="ch-setup-hash">#</span>
            <div className="ch-setup-channel-info">
              <span className="ch-setup-channel-name">{c.name}</span>
              {c.topic && <span className="ch-setup-channel-topic">{c.topic}</span>}
            </div>
            {canEdit && (
              <div className="ch-setup-row-actions">
                <button className="ch-setup-icon-btn" title="Edit" onClick={() => startEditChannel(c)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                  </svg>
                </button>
                <button className="ch-setup-icon-btn danger" title="Delete" onClick={() => callDeleteChannel({ channelId: c.id })}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/>
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  function renderCategoryBlock(cat: { id: bigint; name: string; position: number }, chans: Channel[]) {
    const isEditingCat = editing?.type === 'category' && editing.id === cat.id;
    return (
      <div key={cat.id.toString()} className="ch-setup-category-block">
        <div className="ch-setup-category-header">
          {isEditingCat ? (
            <div className="ch-setup-inline-edit">
              <input
                className="ch-setup-input"
                value={editName}
                onChange={e => setEditName(e.target.value)}
                placeholder="CATEGORY NAME"
                onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') cancelEdit(); }}
                autoFocus
              />
              <div className="ch-setup-inline-actions">
                <button className="ch-setup-btn-save" onClick={saveEdit}>Save</button>
                <button className="ch-setup-btn-cancel" onClick={cancelEdit}>Cancel</button>
              </div>
            </div>
          ) : (
            <>
              <span className="ch-setup-cat-name">{cat.name}</span>
              {canEdit && (
                <div className="ch-setup-row-actions">
                  <button className="ch-setup-icon-btn" title="Rename" onClick={() => startEditCategory(cat)}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
                    </svg>
                  </button>
                  <button className="ch-setup-icon-btn danger" title="Delete category" onClick={() => callDeleteCategory({ categoryId: cat.id })}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z"/>
                    </svg>
                  </button>
                </div>
              )}
            </>
          )}
        </div>
        <div className="ch-setup-channel-list">
          {chans.map(renderChannelRow)}
        </div>
      </div>
    );
  }

  return (
    <div className="ch-setup-wrap">
      <div className="settings-section-header">
        <h2>Channel Setup</h2>
        <p className="settings-section-desc">
          Manage the categories and channels in this server.
        </p>
      </div>

      {/* Reseed button — super admin + default server only */}
      {isSuperAdmin && isDefault && (
        <div className="ch-setup-reseed-bar">
          {showReseedConfirm ? (
            <div className="ch-setup-reseed-confirm">
              <span>This will delete all existing channels and messages. Continue?</span>
              <button
                className="ch-setup-btn-danger"
                onClick={() => { callReseed(); setShowReseedConfirm(false); }}
              >
                Yes, reseed
              </button>
              <button className="ch-setup-btn-cancel" onClick={() => setShowReseedConfirm(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button className="ch-setup-reseed-btn" onClick={() => setShowReseedConfirm(true)}>
              Reseed to Documentation Hub
            </button>
          )}
        </div>
      )}

      <div className="ch-setup-body">
        {sortedCats.map(cat =>
          renderCategoryBlock(cat, channelsByCat.get(cat.id.toString()) ?? [])
        )}
        {uncategorized.length > 0 && renderCategoryBlock(
          { id: 0n, name: 'UNCATEGORIZED', position: 9999 },
          uncategorized
        )}
      </div>

      {canEdit && (
        <div className="ch-setup-add-bar">
          {showNewChannel ? (
            <div className="ch-setup-add-form">
              <input
                className="ch-setup-input"
                placeholder="new-channel-name"
                value={newChannelName}
                onChange={e => setNewChannelName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNewChannel(); if (e.key === 'Escape') setShowNewChannel(false); }}
                autoFocus
              />
              <select
                className="ch-setup-select"
                value={newChannelCatId.toString()}
                onChange={e => setNewChannelCatId(BigInt(e.target.value))}
              >
                <option value="0">No category</option>
                {sortedCats.map(c => (
                  <option key={c.id.toString()} value={c.id.toString()}>{c.name}</option>
                ))}
              </select>
              <button className="ch-setup-btn-save" onClick={submitNewChannel}>Add</button>
              <button className="ch-setup-btn-cancel" onClick={() => setShowNewChannel(false)}>Cancel</button>
            </div>
          ) : showNewCat ? (
            <div className="ch-setup-add-form">
              <input
                className="ch-setup-input"
                placeholder="CATEGORY NAME"
                value={newCatName}
                onChange={e => setNewCatName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') submitNewCategory(); if (e.key === 'Escape') setShowNewCat(false); }}
                autoFocus
              />
              <button className="ch-setup-btn-save" onClick={submitNewCategory}>Add</button>
              <button className="ch-setup-btn-cancel" onClick={() => setShowNewCat(false)}>Cancel</button>
            </div>
          ) : (
            <>
              <button className="ch-setup-add-btn" onClick={() => setShowNewChannel(true)}>+ Add Channel</button>
              <button className="ch-setup-add-btn" onClick={() => setShowNewCat(true)}>+ Add Category</button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Coming Soon stub ────────────────────────────────────────────────────

function ComingSoonSection({ sectionId }: { sectionId: string }) {
  const label =
    NAV_GROUPS.flatMap(g => g.items).find(i => i.id === sectionId)?.label ??
    sectionId;
  return (
    <div className="settings-section">
      <h2 className="settings-section-title">{label}</h2>
      <div className="settings-empty coming-soon">
        <svg width="72" height="72" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 8a4 4 0 0 0-4 4v1h8v-1a4 4 0 0 0-4-4zm6 6v5a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2v-1a4 4 0 1 1 8 0v1a2 2 0 0 1 2 2z" />
        </svg>
        <h3>Coming soon</h3>
        <p>
          The <b>{label}</b> module isn&apos;t available yet. Stay tuned — it
          will appear here once implemented.
        </p>
      </div>
    </div>
  );
}

// ─── Delete Server Confirm ───────────────────────────────────────────────

function DeleteServerConfirm({
  server,
  onCancel,
  onDeleted,
}: {
  server: Server;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const deleteServer = useReducer(reducers.deleteServer);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const canConfirm = typed.trim().toLowerCase() === server.name.toLowerCase();

  const doDelete = () => {
    setDeleting(true);
    setErr('');
    deleteServer({ serverId: server.id })
      .then(() => onDeleted())
      .catch(e => {
        setErr(String(e?.message ?? e));
        setDeleting(false);
      });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div
        className="modal modal-danger"
        onMouseDown={e => e.stopPropagation()}
      >
        <h3>Delete &lsquo;{server.name}&rsquo;</h3>
        <p className="modal-subtitle">
          Are you sure you want to delete <b>{server.name}</b>? This action
          cannot be undone. All channels, messages, members, and invites will
          be permanently removed.
        </p>
        <div style={{ padding: '0 16px 16px' }}>
          <label>
            ENTER SERVER NAME TO CONFIRM
            <input
              autoFocus
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={server.name}
            />
          </label>
          {err && <div className="settings-error">{err}</div>}
        </div>
        <div className="modal-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={onCancel}
            disabled={deleting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={doDelete}
            disabled={!canConfirm || deleting}
          >
            {deleting ? 'Deleting…' : 'Delete Server'}
          </button>
        </div>
      </div>
    </div>
  );
}
