import { useEffect, useMemo, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type {
  Channel,
  ChannelPermissionOverride,
  Invite,
  ServerRole,
  User,
} from '../module_bindings/types';
import { generateAlias } from '../utils/alias';

// ── Permission constants (mirror backend) ──────────────────────────────────

const PERM_VIEW_CHANNELS = 1n;
const PERM_SEND_MESSAGES = 2n;
const PERM_MANAGE_MESSAGES = 4n;
const PERM_MANAGE_CHANNELS = 8n;
const PERM_KICK_MEMBERS = 16n;
const PERM_MANAGE_ROLES = 64n;
const PERM_MANAGE_SERVER = 128n;
const PERM_CREATE_INVITE = 256n;
const PERM_ADD_REACTIONS = 512n;
const PERM_ADMINISTRATOR = 1024n;

interface PermissionDef {
  bit: bigint;
  label: string;
  description: string;
}

const GENERAL_PERMS: PermissionDef[] = [
  { bit: PERM_VIEW_CHANNELS, label: 'View Channel', description: 'Allows members to view this channel by default. Disabling this for @everyone will make this channel private.' },
  { bit: PERM_MANAGE_CHANNELS, label: 'Manage Channel', description: "Allows members to change this channel's name, description, and text settings. They can also delete the channel." },
  { bit: PERM_MANAGE_ROLES, label: 'Manage Permissions', description: "Allows members to change this channel's permissions." },
];

const MEMBERSHIP_PERMS: PermissionDef[] = [
  { bit: PERM_CREATE_INVITE, label: 'Create Invite', description: 'Allows members to invite new people to this server via a direct invite link to this channel.' },
];

const TEXT_PERMS: PermissionDef[] = [
  { bit: PERM_SEND_MESSAGES, label: 'Send Messages', description: 'Allows members to send messages in this channel.' },
  { bit: PERM_ADD_REACTIONS, label: 'Add Reactions', description: 'Allows members to add new reactions to a message.' },
  { bit: PERM_MANAGE_MESSAGES, label: 'Manage Messages', description: 'Allows members to delete messages by other members or pin any message.' },
];

// ── Types ──────────────────────────────────────────────────────────────────

type ChannelSettingsTab = 'overview' | 'permissions' | 'invites' | 'ai';

interface ChannelSettingsProps {
  channel: Channel;
  serverId: bigint;
  serverRoles: readonly ServerRole[];
  invites: Invite[];
  users: readonly User[];
  isOwner: boolean;
  isAdmin: boolean;
  isSuperAdmin: boolean;
  onClose: () => void;
  onDeleted?: () => void;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function ChannelSettings({
  channel,
  serverId,
  serverRoles,
  invites,
  users,
  isOwner,
  isAdmin,
  isSuperAdmin,
  onClose,
  onDeleted,
}: ChannelSettingsProps) {
  const [tab, setTab] = useState<ChannelSettingsTab>('overview');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const canEdit = isAdmin || isOwner || isSuperAdmin;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showDeleteConfirm) onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, showDeleteConfirm]);

  const navItems: { id: ChannelSettingsTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'permissions', label: 'Permissions' },
    { id: 'invites', label: 'Invites' },
    { id: 'ai', label: 'AI Assistant' },
  ];

  return (
    <div className="settings-fullscreen">
      <aside className="settings-sidebar">
        <div className="settings-sidebar-inner">
          <div className="settings-server-name cs-header">
            <span className="cs-hash">#</span> {channel.name}
            <span className="cs-breadcrumb">TEXT CHANNEL SETTINGS</span>
          </div>

          <div className="settings-nav-group">
            {navItems.map(item => (
              <button
                key={item.id}
                className={`settings-nav-item${tab === item.id ? ' active' : ''}`}
                onClick={() => setTab(item.id)}
              >
                <span className="settings-nav-label">{item.label}</span>
              </button>
            ))}
          </div>

          {canEdit && (
            <div className="settings-nav-group">
              <button
                className="settings-nav-item danger"
                onClick={() => setShowDeleteConfirm(true)}
              >
                <span className="settings-nav-label">Delete Channel</span>
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
          {tab === 'overview' && (
            <OverviewTab channel={channel} canEdit={canEdit} />
          )}
          {tab === 'permissions' && (
            <PermissionsTab
              channel={channel}
              serverRoles={serverRoles}
              canEdit={canEdit}
            />
          )}
          {tab === 'invites' && (
            <InvitesTab
              serverId={serverId}
              invites={invites}
              users={users}
              canManage={canEdit}
            />
          )}
          {tab === 'ai' && <AIAssistantTab channel={channel} canEdit={canEdit} />}
        </div>

        <button className="settings-close-esc" onClick={onClose} aria-label="Close settings">
          <div className="settings-close-esc-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </div>
          <div className="settings-close-esc-label">ESC</div>
        </button>
      </div>

      {showDeleteConfirm && (
        <DeleteChannelConfirm
          channel={channel}
          onCancel={() => setShowDeleteConfirm(false)}
          onDeleted={() => {
            setShowDeleteConfirm(false);
            onDeleted?.();
            onClose();
          }}
        />
      )}
    </div>
  );
}

// ── Overview tab ───────────────────────────────────────────────────────────

const SLOWMODE_OPTIONS = [
  { value: 0, label: 'Off' },
  { value: 5, label: '5s' },
  { value: 10, label: '10s' },
  { value: 15, label: '15s' },
  { value: 30, label: '30s' },
  { value: 60, label: '1m' },
  { value: 120, label: '2m' },
  { value: 300, label: '5m' },
  { value: 600, label: '10m' },
  { value: 900, label: '15m' },
  { value: 1800, label: '30m' },
  { value: 3600, label: '1h' },
  { value: 7200, label: '2h' },
  { value: 21600, label: '6h' },
];

function OverviewTab({ channel, canEdit }: { channel: Channel; canEdit: boolean }) {
  const updateChannel = useReducer(reducers.updateChannel);
  const setSlowmode = useReducer(reducers.setSlowmode);

  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic);
  const [slowmode, setSlowmodeVal] = useState(channel.slowmodeSeconds);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  // Sync with external changes
  useEffect(() => {
    setName(channel.name);
    setTopic(channel.topic);
    setSlowmodeVal(channel.slowmodeSeconds);
  }, [channel.name, channel.topic, channel.slowmodeSeconds]);

  const dirty = name !== channel.name || topic !== channel.topic;
  const slowmodeDirty = slowmode !== channel.slowmodeSeconds;

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      if (dirty) {
        await updateChannel({ channelId: channel.id, name, topic });
      }
      if (slowmodeDirty) {
        await setSlowmode({ channelId: channel.id, seconds: slowmode });
      }
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  const reset = () => {
    setName(channel.name);
    setTopic(channel.topic);
    setSlowmodeVal(channel.slowmodeSeconds);
    setErr('');
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Overview</h2>

      <label className="cs-label">
        CHANNEL NAME
        <div className="cs-input-wrap">
          <span className="cs-input-prefix">#</span>
          <input
            type="text"
            className="cs-input"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={!canEdit}
            maxLength={100}
          />
        </div>
      </label>

      <label className="cs-label">
        CHANNEL TOPIC
        <div className="cs-topic-wrap">
          <textarea
            className="cs-textarea"
            value={topic}
            onChange={e => setTopic(e.target.value)}
            disabled={!canEdit}
            maxLength={1024}
            placeholder="Let everyone know how to use this channel!"
            rows={4}
          />
          <span className="cs-char-count">{topic.length}/1024</span>
        </div>
      </label>

      <label className="cs-label">
        SLOWMODE
        <select
          className="cs-select"
          value={slowmode}
          onChange={e => {
            const val = Number(e.target.value);
            setSlowmodeVal(val);
            if (canEdit) {
              setSlowmode({ channelId: channel.id, seconds: val }).catch(() => {});
            }
          }}
          disabled={!canEdit}
        >
          {SLOWMODE_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="cs-hint">
          Members will be restricted to sending one message and creating one thread per this interval,
          unless they have the Bypass Slowmode permission.
        </span>
      </label>

      {err && <div className="settings-error">{err}</div>}

      {(dirty || slowmodeDirty) && (
        <div className="cs-save-bar">
          <span>Careful — you have unsaved changes!</span>
          <div className="cs-save-actions">
            <button type="button" className="btn-secondary" onClick={reset} disabled={saving}>
              Reset
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Permissions tab ────────────────────────────────────────────────────────

type TriState = 'allow' | 'neutral' | 'deny';

function PermissionsTab({
  channel,
  serverRoles,
  canEdit,
}: {
  channel: Channel;
  serverRoles: readonly ServerRole[];
  canEdit: boolean;
}) {
  const [overrides] = useTable(tables.channel_permission_override);
  const setOverride = useReducer(reducers.setChannelPermissionOverride);

  // Sort roles: @everyone first, then by position descending
  const sortedRoles = useMemo(
    () =>
      [...serverRoles]
        .filter(r => r.serverId === channel.serverId)
        .sort((a, b) => {
          if (a.isDefault && !b.isDefault) return -1;
          if (!a.isDefault && b.isDefault) return 1;
          return b.position - a.position;
        }),
    [serverRoles, channel.serverId]
  );

  // Eagerly initialize to @everyone so the first click is never sent with targetId ''
  const [selectedRoleId, setSelectedRoleId] = useState<string>(
    () => sortedRoles[0]?.id.toString() ?? ''
  );

  // Keep in sync if sortedRoles loads after mount (edge case)
  useEffect(() => {
    if (sortedRoles.length > 0 && !selectedRoleId) {
      setSelectedRoleId(sortedRoles[0].id.toString());
    }
  }, [sortedRoles, selectedRoleId]);

  // Find the override for the selected role on this channel
  const channelOverrides = useMemo(
    () => overrides.filter(ov => ov.channelId === channel.id),
    [overrides, channel.id]
  );

  const currentOverride = useMemo(
    () =>
      channelOverrides.find(
        ov => ov.targetType === 'role' && ov.targetId === selectedRoleId
      ),
    [channelOverrides, selectedRoleId]
  );

  const getState = (bit: bigint): TriState => {
    if (!currentOverride) return 'neutral';
    if ((currentOverride.allow & bit) !== 0n) return 'allow';
    if ((currentOverride.deny & bit) !== 0n) return 'deny';
    return 'neutral';
  };

  const togglePerm = (bit: bigint) => {
    if (!canEdit || !selectedRoleId) return;
    const current = getState(bit);
    let allow = currentOverride?.allow ?? 0n;
    let deny = currentOverride?.deny ?? 0n;

    // Cycle: neutral → allow → deny → neutral
    if (current === 'neutral') {
      allow |= bit;
      deny &= ~bit;
    } else if (current === 'allow') {
      allow &= ~bit;
      deny |= bit;
    } else {
      allow &= ~bit;
      deny &= ~bit;
    }

    setOverride({
      channelId: channel.id,
      targetType: 'role',
      targetId: selectedRoleId,
      allow,
      deny,
    }).catch(() => {});
  };

  const renderPermGroup = (title: string, perms: PermissionDef[]) => (
    <div className="cs-perm-group">
      <h4 className="cs-perm-group-title">{title}</h4>
      {perms.map(p => {
        const state = getState(p.bit);
        return (
          <div key={p.bit.toString()} className="cs-perm-row">
            <div className="cs-perm-info">
              <div className="cs-perm-label">{p.label}</div>
              <div className="cs-perm-desc">{p.description}</div>
            </div>
            <div className="cs-tri-toggle">
              <button
                type="button"
                className={`cs-tri-btn deny${state === 'deny' ? ' active' : ''}`}
                onClick={() => {
                  if (!canEdit || !selectedRoleId) return;
                  let allow = currentOverride?.allow ?? 0n;
                  let deny = currentOverride?.deny ?? 0n;
                  if (state === 'deny') {
                    deny &= ~p.bit;
                  } else {
                    deny |= p.bit;
                    allow &= ~p.bit;
                  }
                  setOverride({
                    channelId: channel.id,
                    targetType: 'role',
                    targetId: selectedRoleId,
                    allow,
                    deny,
                  }).catch(() => {});
                }}
                disabled={!canEdit}
                title="Deny"
              >
                ✕
              </button>
              <button
                type="button"
                className={`cs-tri-btn neutral${state === 'neutral' ? ' active' : ''}`}
                onClick={() => {
                  if (!canEdit || !selectedRoleId) return;
                  let allow = currentOverride?.allow ?? 0n;
                  let deny = currentOverride?.deny ?? 0n;
                  allow &= ~p.bit;
                  deny &= ~p.bit;
                  setOverride({
                    channelId: channel.id,
                    targetType: 'role',
                    targetId: selectedRoleId,
                    allow,
                    deny,
                  }).catch(() => {});
                }}
                disabled={!canEdit}
                title="Inherit"
              >
                /
              </button>
              <button
                type="button"
                className={`cs-tri-btn allow${state === 'allow' ? ' active' : ''}`}
                onClick={() => {
                  if (!canEdit || !selectedRoleId) return;
                  let allow = currentOverride?.allow ?? 0n;
                  let deny = currentOverride?.deny ?? 0n;
                  if (state === 'allow') {
                    allow &= ~p.bit;
                  } else {
                    allow |= p.bit;
                    deny &= ~p.bit;
                  }
                  setOverride({
                    channelId: channel.id,
                    targetType: 'role',
                    targetId: selectedRoleId,
                    allow,
                    deny,
                  }).catch(() => {});
                }}
                disabled={!canEdit}
                title="Allow"
              >
                ✓
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Channel Permissions</h2>
      <p className="cs-subtitle">
        Use permissions to customize who can do what in this channel.
      </p>

      <div className="cs-role-selector">
        <label className="cs-label">ROLES/MEMBERS</label>
        <select
          className="cs-select"
          value={selectedRoleId}
          onChange={e => setSelectedRoleId(e.target.value)}
        >
          {sortedRoles.map(r => (
            <option key={r.id.toString()} value={r.id.toString()}>
              {r.isDefault ? '@everyone' : r.name}
            </option>
          ))}
        </select>
      </div>

      <div className="cs-perm-grid">
        {renderPermGroup('General Channel Permissions', GENERAL_PERMS)}
        {renderPermGroup('Membership Permissions', MEMBERSHIP_PERMS)}
        {renderPermGroup('Text Channel Permissions', TEXT_PERMS)}
      </div>
    </div>
  );
}

// ── Invites tab ────────────────────────────────────────────────────────────

function InvitesTab({
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

  const fmtExpiry = (expiresAt: bigint) => {
    if (expiresAt === 0n) return 'Never';
    const ms = Number(expiresAt / 1000n);
    const diff = ms - Date.now();
    if (diff <= 0) return 'Expired';
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    const s = Math.floor((diff % 60000) / 1000);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">Invites</h2>
      <p className="cs-subtitle">
        Here&rsquo;s a list of all active invite links. You can revoke any one or{' '}
        <button
          type="button"
          className="cs-link-btn"
          onClick={() => {
            setErr('');
            createInvite({ serverId, maxUses: 0, expiresInHours: 24 }).catch(e =>
              setErr(String(e?.message ?? e))
            );
          }}
        >
          create one
        </button>
        .
      </p>

      {err && <div className="settings-error">{err}</div>}

      {serverInvites.length === 0 ? (
        <div className="settings-empty">No active invites.</div>
      ) : (
        <table className="cs-invite-table">
          <thead>
            <tr>
              <th>Inviter</th>
              <th>Invite Code</th>
              <th>Uses</th>
              <th>Expires</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {serverInvites.map(inv => {
              const creator = userByHex.get(inv.createdBy.toHexString());
              const creatorName = creator?.name || generateAlias(inv.createdBy.toHexString());
              const avatarColor = creator?.avatarColor ?? '#5865F2';
              return (
                <tr key={inv.id.toString()}>
                  <td className="cs-inviter-cell">
                    <span className="cs-inviter-avatar" style={{ background: avatarColor }}>
                      {creatorName.charAt(0).toUpperCase()}
                    </span>
                    {creatorName}
                  </td>
                  <td>
                    <code className="cs-invite-code">{inv.code}</code>
                    <button
                      type="button"
                      className="cs-copy-btn"
                      onClick={() => copy(inv.code)}
                    >
                      {copied === inv.code ? '✓' : '⎘'}
                    </button>
                  </td>
                  <td>{inv.usesCount}</td>
                  <td>{fmtExpiry(inv.expiresAt)}</td>
                  <td>
                    {canManage && (
                      <button
                        type="button"
                        className="settings-row-action danger"
                        onClick={() =>
                          deleteInvite({ inviteId: inv.id }).catch(e => alert(String(e)))
                        }
                      >
                        Revoke
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── AI Assistant tab ──────────────────────────────────────────────────────

const ROLE_OPTIONS = [
  { value: 'general', label: 'General' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'changelog', label: 'Changelog' },
  { value: 'qa', label: 'Q&A' },
  { value: 'support', label: 'Support' },
  { value: 'announcements', label: 'Announcements' },
];

const AUTHORITY_OPTIONS = [
  { value: 0, label: 'Low' },
  { value: 1, label: 'Normal' },
  { value: 2, label: 'High' },
  { value: 3, label: 'Canonical' },
];

function AIAssistantTab({ channel, canEdit }: { channel: Channel; canEdit: boolean }) {
  const setConfig = useReducer(reducers.setChannelAiConfig);
  const resetConfig = useReducer(reducers.resetChannelAiConfig);
  const [allChannelConfigs] = useTable(tables.channel_ai_config);
  const [allServerConfigs] = useTable(tables.ai_config);

  // channel override row (undefined = using server default)
  const channelCfg = allChannelConfigs.find(c => c.channelId === channel.id);
  const serverCfg = allServerConfigs.find(c => c.serverId === channel.serverId);
  const serverDefault = serverCfg?.indexingEnabledByDefault ?? true;

  // Optimistic override state: null = follow subscription, true/false = pending op.
  // Cleared whenever the subscription row actually changes so real state wins.
  const [pendingOverride, setPendingOverride] = useState<boolean | null>(null);
  const isOverride = pendingOverride ?? (channelCfg !== undefined);

  const [indexing, setIndexing] = useState(channelCfg?.indexingEnabled ?? serverDefault);
  const [role, setRole] = useState(channelCfg?.roleLabel ?? 'general');
  const [weight, setWeight] = useState<number>(channelCfg?.authorityWeight ?? 1);
  const [pinned, setPinned] = useState(channelCfg?.pinnedContext ?? '');
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    // Real state arrived from subscription — clear optimistic flag and sync form.
    setPendingOverride(null);
    const srDefault = serverCfg?.indexingEnabledByDefault ?? true;
    setIndexing(channelCfg?.indexingEnabled ?? srDefault);
    setRole(channelCfg?.roleLabel ?? 'general');
    setWeight(channelCfg?.authorityWeight ?? 1);
    setPinned(channelCfg?.pinnedContext ?? '');
  }, [
    channelCfg?.indexingEnabled,
    channelCfg?.roleLabel,
    channelCfg?.authorityWeight,
    channelCfg?.pinnedContext,
    serverCfg?.indexingEnabledByDefault,
  ]);

  const dirty =
    isOverride &&
    (indexing !== channelCfg!.indexingEnabled ||
      role !== channelCfg!.roleLabel ||
      weight !== channelCfg!.authorityWeight ||
      pinned !== channelCfg!.pinnedContext);

  const save = async () => {
    setSaving(true);
    setErr('');
    try {
      await setConfig({
        channelId: channel.id,
        indexingEnabled: indexing,
        roleLabel: role,
        authorityWeight: weight,
        pinnedContext: pinned,
      });
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  // Creates an override row seeded from the current server default.
  const handleCustomize = async () => {
    // Optimistically switch to override mode so the UI responds immediately,
    // before the maincloud subscription round-trip completes.
    setPendingOverride(true);
    setIndexing(serverDefault);
    setRole('general');
    setWeight(1);
    setPinned('');
    setSaving(true);
    setErr('');
    try {
      await setConfig({
        channelId: channel.id,
        indexingEnabled: serverDefault,
        roleLabel: 'general',
        authorityWeight: 1,
        pinnedContext: '',
      });
    } catch (e: unknown) {
      setPendingOverride(null); // roll back on error
      setErr(e instanceof Error ? e.message : String(e));
    }
    setSaving(false);
  };

  // Deletes the override row — channel reverts to server default.
  const handleReset = async () => {
    // Optimistically switch back to synced mode immediately.
    setPendingOverride(false);
    setResetting(true);
    setErr('');
    try {
      await resetConfig({ channelId: channel.id });
    } catch (e: unknown) {
      setPendingOverride(null); // roll back on error
      setErr(e instanceof Error ? e.message : String(e));
    }
    setResetting(false);
  };

  const resetForm = () => {
    if (!channelCfg) return;
    setIndexing(channelCfg.indexingEnabled);
    setRole(channelCfg.roleLabel);
    setWeight(channelCfg.authorityWeight);
    setPinned(channelCfg.pinnedContext);
    setErr('');
  };

  return (
    <div className="settings-section">
      <h2 className="settings-section-title">AI Assistant</h2>
      <p className="cs-hint" style={{ marginBottom: 20 }}>
        Configure how this channel interacts with the AI assistant and search indexing.
      </p>

      {/* ── Search indexing — synced vs override ── */}
      <div className="cs-ai-toggle-row" style={{ marginBottom: 24 }}>
        <div className="cs-ai-toggle-text">
          <span className="cs-ai-toggle-label">Search Indexing</span>
          {!isOverride ? (
            <span className="cs-ai-toggle-desc">
              Using server default —{' '}
              <strong style={{ color: serverDefault ? 'var(--green-360)' : 'var(--text-muted)' }}>
                {serverDefault ? 'On' : 'Off'}
              </strong>
            </span>
          ) : (
            <span className="cs-ai-toggle-desc">
              Channel override — overrides server default (
              {serverDefault ? 'On' : 'Off'})
            </span>
          )}
        </div>
        {!isOverride ? (
          <button
            className="btn-secondary"
            style={{ flexShrink: 0, fontSize: 13, padding: '6px 12px' }}
            onClick={handleCustomize}
            disabled={!canEdit || saving}
          >
            Customize
          </button>
        ) : (
          <button
            className={`cs-ai-toggle-switch ${indexing ? 'active' : ''}`}
            onClick={() => canEdit && setIndexing(v => !v)}
            disabled={!canEdit}
            aria-label="Toggle search indexing"
          >
            <span className="cs-ai-toggle-knob" />
          </button>
        )}
      </div>

      {/* ── Override-only settings ── */}
      {isOverride && (
        <>
          <label className="cs-label">
            CHANNEL ROLE
            <select
              className="cs-select"
              value={role}
              onChange={e => setRole(e.target.value)}
              disabled={!canEdit}
            >
              {ROLE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            <span className="cs-hint">
              Helps the AI understand the type of content in this channel
            </span>
          </label>

          <label className="cs-label">
            CONTENT AUTHORITY
            <div className="cs-ai-weight-group">
              {AUTHORITY_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  className={`cs-ai-weight-btn ${weight === opt.value ? 'active' : ''}`}
                  onClick={() => canEdit && setWeight(opt.value)}
                  disabled={!canEdit}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <span className="cs-hint">
              Higher authority channels are prioritized in AI search results
            </span>
          </label>

          <label className="cs-label">
            PINNED CONTEXT
            <div className="cs-topic-wrap">
              <textarea
                className="cs-textarea"
                value={pinned}
                onChange={e => setPinned(e.target.value.slice(0, 500))}
                disabled={!canEdit}
                maxLength={500}
                placeholder="Extra context the AI will use when answering questions about this channel..."
                rows={4}
              />
              <span className="cs-char-count">{pinned.length}/500</span>
            </div>
            <span className="cs-hint">
              This text is injected into the AI's system prompt for queries referencing this channel
            </span>
          </label>

          {canEdit && (
            <div className="cs-reset-row">
              <button className="cs-link-btn" onClick={handleReset} disabled={resetting}>
                ↩ Reset to server default ({serverDefault ? 'On' : 'Off'})
              </button>
            </div>
          )}
        </>
      )}

      {err && <div className="settings-error">{err}</div>}

      {dirty && (
        <div className="cs-save-bar">
          <span>Careful — you have unsaved changes!</span>
          <div className="cs-save-actions">
            <button type="button" className="btn-secondary" onClick={resetForm} disabled={saving}>
              Reset
            </button>
            <button type="button" className="btn-primary" onClick={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Delete channel confirm ─────────────────────────────────────────────────

function DeleteChannelConfirm({
  channel,
  onCancel,
  onDeleted,
}: {
  channel: Channel;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const deleteChannel = useReducer(reducers.deleteChannel);
  const [typed, setTyped] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [err, setErr] = useState('');
  const canConfirm = typed.trim().toLowerCase() === channel.name.toLowerCase();

  const doDelete = () => {
    setDeleting(true);
    setErr('');
    deleteChannel({ channelId: channel.id })
      .then(() => onDeleted())
      .catch(e => {
        setErr(e instanceof Error ? e.message : String(e));
        setDeleting(false);
      });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal modal-danger" onMouseDown={e => e.stopPropagation()}>
        <h3>Delete #{channel.name}</h3>
        <p className="modal-subtitle">
          Are you sure you want to delete <b>#{channel.name}</b>? This action cannot be undone.
          All messages in this channel will be permanently removed.
        </p>
        <div style={{ padding: '0 16px 16px' }}>
          <label>
            ENTER CHANNEL NAME TO CONFIRM
            <input
              autoFocus
              type="text"
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={channel.name}
            />
          </label>
          {err && <div className="settings-error">{err}</div>}
        </div>
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={deleting}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-danger"
            onClick={doDelete}
            disabled={!canConfirm || deleting}
          >
            {deleting ? 'Deleting…' : 'Delete Channel'}
          </button>
        </div>
      </div>
    </div>
  );
}
