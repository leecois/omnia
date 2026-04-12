import { useEffect, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { reducers, tables } from '../module_bindings';
import type {
  Category,
  Channel,
  Invite,
  MemberRole,
  Notification,
  ReadState,
  Server,
  ServerMember,
  ServerRole,
  SpecialChatRole,
  SuperAdmin,
  User,
} from '../module_bindings/types';
import { generateAlias } from '../utils/alias';
import ServerSettings from './ServerSettings';
import SuperAdminPanel from './SuperAdminPanel';

interface SidebarProps {
  servers: readonly Server[];
  channels: readonly Channel[];
  categories: readonly Category[];
  isChannelAdmin: boolean;
  isSuperAdmin: boolean;
  superAdmins: readonly SuperAdmin[];
  specialChatRoles: readonly SpecialChatRole[];
  serverRoles: readonly ServerRole[];
  memberRoles: readonly MemberRole[];
  allUsers: readonly User[];
  myServerNickname: string;
  selectedServerId: bigint | null;
  selectedChannelId: bigint | null;
  onSelectServer: (id: bigint) => void;
  onSelectChannel: (id: bigint) => void;
  selectedServer: Server | null;
  currentUser: User | null;
  myReadStates: Map<string, ReadState>;
  notifications: Notification[];
  onEditMyProfile: () => void;
}

const STATUS_OPTIONS = [
  { value: 'online', label: 'Online', color: '#23a55a' },
  { value: 'idle', label: 'Idle', color: '#f0b232' },
  { value: 'dnd', label: 'Do Not Disturb', color: '#f23f43' },
  { value: 'invisible', label: 'Invisible', color: '#80848e' },
];

export default function Sidebar({
  servers,
  channels,
  categories,
  isChannelAdmin,
  isSuperAdmin,
  superAdmins,
  specialChatRoles,
  serverRoles,
  memberRoles,
  allUsers,
  myServerNickname,
  selectedServerId,
  selectedChannelId,
  onSelectServer,
  onSelectChannel,
  selectedServer,
  currentUser,
  myReadStates,
  notifications,
  onEditMyProfile,
}: SidebarProps) {
  const [showCreateServer, setShowCreateServer] = useState(false);
  const [showCreateChannel, setShowCreateChannel] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showNicknameEdit, setShowNicknameEdit] = useState(false);
  const [showServerMenu, setShowServerMenu] = useState(false);
  const [showServerSettings, setShowServerSettings] = useState(false);
  const [showSuperAdminPanel, setShowSuperAdminPanel] = useState(false);
  const [showNameEdit, setShowNameEdit] = useState(false);
  const [showStatusMenu, setShowStatusMenu] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [collapsedCats, setCollapsedCats] = useState<Set<string>>(new Set());
  const [showNotifications, setShowNotifications] = useState(false);

  const [allInvites] = useTable(tables.invite);
  const [allServerMembers] = useTable(tables.server_member);

  const createServer = useReducer(reducers.createServer);
  const createChannel = useReducer(reducers.createChannel);
  const deleteChannel = useReducer(reducers.deleteChannel);
  const joinServer = useReducer(reducers.joinServer);
  const leaveServer = useReducer(reducers.leaveServer);
  const createInvite = useReducer(reducers.createInvite);
  const createCategory = useReducer(reducers.createCategory);
  const deleteCategory = useReducer(reducers.deleteCategory);
  const moveChannel = useReducer(reducers.moveChannel);
  const setNickname = useReducer(reducers.setNickname);
  const setName = useReducer(reducers.setName);
  const setStatus = useReducer(reducers.setStatus);
  const sendServerInvite = useReducer(reducers.sendServerInvite);
  const dismissNotification = useReducer(reducers.dismissNotification);

  const toggleCat = (catId: string) => {
    setCollapsedCats(prev => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  };

  const renderChannelItem = (channel: Channel) => {
    const active = channel.id === selectedChannelId;
    const rs = myReadStates.get(channel.id.toString());
    const unread =
      channel.lastMessageId !== 0n &&
      (rs === undefined || rs.lastReadMessageId < channel.lastMessageId);
    return (
      <div
        key={channel.id.toString()}
        className={`channel-item ${active ? 'active' : ''}`}
        onClick={() => onSelectChannel(channel.id)}
      >
        <span className="channel-hash">#</span>
        <span className="channel-name">{channel.name}</span>
        {channel.slowmodeSeconds > 0 && (
          <span className="channel-slowmode-icon" title={`Slowmode: ${channel.slowmodeSeconds}s`}>
            ⏱
          </span>
        )}
        {unread && !active && <span className="unread-dot" />}
        {active && isChannelAdmin && (
          <>
            {serverCats.length > 0 && (
              <select
                className="channel-move-select"
                value={channel.categoryId.toString()}
                onClick={e => e.stopPropagation()}
                onChange={e => {
                  const id = BigInt(e.target.value);
                  moveChannel({ channelId: channel.id, categoryId: id }).catch(console.error);
                }}
                title="Move to category"
              >
                <option value="0">Uncategorized</option>
                {serverCats.map(c => (
                  <option key={c.id.toString()} value={c.id.toString()}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <button
              className="channel-delete"
              title="Delete channel"
              onClick={e => {
                e.stopPropagation();
                if (confirm(`Delete #${channel.name}?`)) {
                  deleteChannel({ channelId: channel.id }).catch(console.error);
                }
              }}
            >
              ×
            </button>
          </>
        )}
      </div>
    );
  };

  // Group channels by category
  const serverCats = [...categories]
    .filter(c => c.serverId === selectedServerId)
    .sort((a, b) => a.position - b.position);
  const uncategorized = channels.filter(c => c.categoryId === 0n);
  const categoryGroups: Array<{ category: Category; channels: Channel[] }> = serverCats.map(
    cat => ({
      category: cat,
      channels: channels.filter(c => c.categoryId === cat.id),
    })
  );

  const displayName =
    currentUser?.name ||
    (currentUser ? generateAlias(currentUser.identity.toHexString()) : 'unknown');

  const statusColor = STATUS_OPTIONS.find(s => s.value === currentUser?.status)?.color ?? '#80848e';

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nameDraft.trim()) return;
    setName({ name: nameDraft.trim() })
      .then(() => {
        setShowNameEdit(false);
        setNameDraft('');
      })
      .catch(console.error);
  };

  // Latest invite for the selected server
  const serverInvites = allInvites
    .filter(inv => inv.serverId === selectedServerId)
    .sort((a, b) => (a.id < b.id ? 1 : -1));

  // The default community server (first one, created by init) is protected:
  // regular users see no admin dropdown. Super Admins still get full access
  // so they can manage roles and chat permissions for it.
  const isDefaultServer = selectedServer?.id === 1n;
  const isLocked = isDefaultServer && !isSuperAdmin;

  return (
    <>
      {/* Server rail */}
      <nav className="server-rail">
        <div className="server-rail-scroll">
          {servers.map(server => {
            const initials = server.name
              .split(/\s+/)
              .slice(0, 2)
              .map(w => w[0])
              .join('')
              .toUpperCase();
            const active = server.id === selectedServerId;
            return (
              <button
                key={server.id.toString()}
                className={`server-icon ${active ? 'active' : ''}`}
                title={server.name}
                onClick={() => onSelectServer(server.id)}
              >
                {initials}
              </button>
            );
          })}
          {isSuperAdmin && (
            <button
              className="server-icon server-icon-add"
              title="Create a Server"
              onClick={() => setShowCreateServer(true)}
            >
              +
            </button>
          )}
        </div>
      </nav>

      {/* Channel panel */}
      <aside className="channel-panel">
        <header
          className={`channel-panel-header ${showServerMenu ? 'open' : ''} ${isLocked ? 'locked' : ''}`}
          onClick={() => {
            if (isLocked) return;
            if (selectedServer) setShowServerMenu(v => !v);
          }}
        >
          <div className="server-header-title">
            <h2>{selectedServer?.name ?? 'No server'}</h2>
            {selectedServer?.description && (
              <p className="server-description">{selectedServer.description}</p>
            )}
          </div>
          {selectedServer && !isLocked && (
            <svg
              className="server-header-chevron"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              {showServerMenu ? (
                <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
              ) : (
                <path d="M16.59 8.59L12 13.17L7.41 8.59L6 10L12 16L18 10L16.59 8.59Z" />
              )}
            </svg>
          )}
          {isLocked && (
            <svg
              className="server-header-lock"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="currentColor"
              aria-label="Protected server"
            >
              <path d="M18 8h-1V6a5 5 0 0 0-10 0v2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2Zm-6 9a2 2 0 1 1 0-4 2 2 0 0 1 0 4Zm3.1-9H8.9V6a3.1 3.1 0 0 1 6.2 0v2Z" />
            </svg>
          )}
        </header>

        {showServerMenu && selectedServer && !isLocked && (
          <>
            <div className="server-menu-backdrop" onClick={() => setShowServerMenu(false)} />
            <div className="server-menu" onClick={e => e.stopPropagation()}>
              {(isChannelAdmin || isSuperAdmin) && (
                <button
                  className="server-menu-item"
                  onClick={() => {
                    setShowServerSettings(true);
                    setShowServerMenu(false);
                  }}
                >
                  <span>Server Settings</span>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.738 10H22V14H19.739C19.498 14.931 19.1 15.798 18.565 16.564L20 18L18 20L16.564 18.564C15.798 19.099 14.932 19.498 14 19.738V22H10V19.738C9.069 19.498 8.202 19.099 7.436 18.564L6 20L4 18L5.435 16.564C4.9 15.799 4.502 14.932 4.262 14H2V10H4.262C4.502 9.068 4.9 8.202 5.436 7.436L4 6L6 4L7.436 5.436C8.202 4.9 9.068 4.502 10 4.262V2H14V4.261C14.932 4.502 15.797 4.9 16.565 5.435L18 3.999L20 6L18.564 7.436C19.099 8.202 19.498 9.069 19.738 10ZM12 16C14.209 16 16 14.209 16 12C16 9.791 14.209 8 12 8C9.791 8 8 9.791 8 12C8 14.209 9.791 16 12 16Z" />
                  </svg>
                </button>
              )}
              <button
                className="server-menu-item"
                onClick={() => {
                  setShowInviteModal(true);
                  setShowServerMenu(false);
                }}
              >
                <span>Invite People</span>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 8C14 10.21 12.21 12 10 12C7.79 12 6 10.21 6 8C6 5.79 7.79 4 10 4C12.21 4 14 5.79 14 8ZM10 14C7.33 14 2 15.34 2 18V20H18V18C18 15.34 12.67 14 10 14ZM18.41 10H21.5V8H18.41L19.41 7L18 5.59L15.59 8L18 10.41L19.41 9L18.41 10Z" />
                </svg>
              </button>
              <button
                className="server-menu-item"
                onClick={() => {
                  setShowCreateChannel(true);
                  setShowServerMenu(false);
                }}
              >
                <span>Create Channel</span>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19 13H13V19H11V13H5V11H11V5H13V11H19V13Z" />
                </svg>
              </button>
              {isChannelAdmin && (
                <button
                  className="server-menu-item"
                  onClick={() => {
                    setShowCreateCategory(true);
                    setShowServerMenu(false);
                  }}
                >
                  <span>Create Category</span>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10 4H4c-1.11 0-2 .89-2 2v12a2 2 0 002 2h16c1.11 0 2-.89 2-2V8a2 2 0 00-2-2h-8l-2-2z" />
                  </svg>
                </button>
              )}
              <div className="server-menu-divider" />
              <button
                className="server-menu-item"
                onClick={() => {
                  setShowNicknameEdit(true);
                  setShowServerMenu(false);
                }}
              >
                <span>Edit Server Nickname</span>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25ZM20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04Z" />
                </svg>
              </button>
              <div className="server-menu-divider" />
              {selectedServer.ownerId.toHexString() === currentUser?.identity.toHexString() ? (
                <button className="server-menu-item" disabled>
                  <span>You are the owner</span>
                </button>
              ) : (
                <button
                  className="server-menu-item danger"
                  onClick={() => {
                    if (confirm(`Leave "${selectedServer.name}"?`)) {
                      leaveServer({ serverId: selectedServer.id }).catch(console.error);
                    }
                    setShowServerMenu(false);
                  }}
                >
                  <span>Leave Server</span>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M10.09 15.59L11.5 17L16.5 12L11.5 7L10.09 8.41L12.67 11H3V13H12.67L10.09 15.59ZM19 3H5C3.89 3 3 3.9 3 5V9H5V5H19V19H5V15H3V19C3 20.1 3.89 21 5 21H19C20.1 21 21 20.1 21 19V5C21 3.9 20.1 3 19 3Z" />
                  </svg>
                </button>
              )}
            </div>
          </>
        )}

        <div className="channel-list">
          {channels.length === 0 && <p className="channel-empty">No channels yet.</p>}

          {/* Uncategorized channels */}
          {uncategorized.length > 0 && (
            <>
              <div className="channel-group-header">
                <span>TEXT CHANNELS</span>
                {selectedServer && (
                  <button
                    className="icon-btn"
                    title="New channel"
                    onClick={() => setShowCreateChannel(true)}
                  >
                    +
                  </button>
                )}
              </div>
              {uncategorized.map(channel => renderChannelItem(channel))}
            </>
          )}

          {/* Categorized channels */}
          {categoryGroups.map(({ category, channels: catChannels }) => {
            const collapsed = collapsedCats.has(category.id.toString());
            return (
              <div key={category.id.toString()}>
                <div
                  className="category-group-header"
                  onClick={() => toggleCat(category.id.toString())}
                >
                  <svg
                    className={`category-chevron ${collapsed ? 'collapsed' : ''}`}
                    width="12"
                    height="12"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M16.59 8.59L12 13.17L7.41 8.59L6 10L12 16L18 10L16.59 8.59Z" />
                  </svg>
                  <span>{category.name.toUpperCase()}</span>
                  {isChannelAdmin && (
                    <div className="category-actions">
                      <button
                        className="icon-btn"
                        title="Delete category"
                        onClick={e => {
                          e.stopPropagation();
                          if (
                            confirm(
                              `Delete category "${category.name}"? Channels will become uncategorized.`
                            )
                          ) {
                            deleteCategory({ categoryId: category.id }).catch(console.error);
                          }
                        }}
                      >
                        ×
                      </button>
                      <button
                        className="icon-btn"
                        title="New channel in this category"
                        onClick={e => {
                          e.stopPropagation();
                          setShowCreateChannel(true);
                        }}
                      >
                        +
                      </button>
                    </div>
                  )}
                </div>
                {!collapsed && catChannels.map(channel => renderChannelItem(channel))}
              </div>
            );
          })}
        </div>
      </aside>

      {/* Account Panel — spans server rail + channel panel at footer */}
      <div className="account-panel">
        <div
          className="account-avatar"
          style={{ backgroundColor: currentUser?.avatarColor ?? '#5865F2' }}
        >
          {displayName[0]?.toUpperCase() ?? '?'}
          <span className="status-dot" style={{ backgroundColor: statusColor }} />
        </div>
        <div className="account-info">
          {showNameEdit ? (
            <form onSubmit={handleNameSubmit}>
              <input
                autoFocus
                className="name-input"
                value={nameDraft}
                placeholder="Username"
                onChange={e => setNameDraft(e.target.value)}
                onBlur={() => setShowNameEdit(false)}
              />
            </form>
          ) : (
            <>
              <div
                className="account-name"
                onClick={() => {
                  setNameDraft(currentUser?.name ?? '');
                  setShowNameEdit(true);
                }}
              >
                {displayName}
              </div>
              <div className="account-status" onClick={() => setShowStatusMenu(v => !v)}>
                <span className="status-dot-sm" style={{ backgroundColor: statusColor }} />
                {STATUS_OPTIONS.find(s => s.value === currentUser?.status)?.label ?? 'Online'}
              </div>
            </>
          )}
        </div>
        <div className="account-actions">
          <button
            className="footer-icon-btn notif-bell-btn"
            title="Notifications"
            aria-label="Notifications"
            onClick={() => setShowNotifications(v => !v)}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 22c1.1 0 2-.9 2-2h-4c0 1.1.9 2 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" />
            </svg>
            {notifications.length > 0 && (
              <span className="notif-badge">
                {notifications.length > 9 ? '9+' : notifications.length}
              </span>
            )}
          </button>
          {isSuperAdmin && (
            <button
              className="footer-icon-btn super-admin-btn"
              title="Super Admin Panel"
              aria-label="Super Admin panel"
              onClick={() => {
                setShowStatusMenu(false);
                setShowSuperAdminPanel(true);
              }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z" />
              </svg>
            </button>
          )}
          <button
            className="footer-icon-btn"
            title="User Settings"
            aria-label="User settings"
            onClick={() => {
              setShowStatusMenu(false);
              onEditMyProfile();
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.738 10H22V14H19.739C19.498 14.931 19.1 15.798 18.565 16.564L20 18L18 20L16.564 18.564C15.798 19.099 14.932 19.498 14 19.738V22H10V19.738C9.069 19.498 8.202 19.099 7.436 18.564L6 20L4 18L5.435 16.564C4.9 15.799 4.502 14.932 4.262 14H2V10H4.262C4.502 9.068 4.9 8.202 5.436 7.436L4 6L6 4L7.436 5.436C8.202 4.9 9.068 4.502 10 4.262V2H14V4.261C14.932 4.502 15.797 4.9 16.565 5.435L18 3.999L20 6L18.564 7.436C19.099 8.202 19.498 9.069 19.738 10ZM12 16C14.209 16 16 14.209 16 12C16 9.791 14.209 8 12 8C9.791 8 8 9.791 8 12C8 14.209 9.791 16 12 16Z" />
            </svg>
          </button>
        </div>
        {showStatusMenu && (
          <div className="status-menu" onMouseLeave={() => setShowStatusMenu(false)}>
            {STATUS_OPTIONS.map(opt => (
              <button
                key={opt.value}
                className="status-menu-item"
                onClick={() => {
                  setStatus({ status: opt.value }).catch(console.error);
                  setShowStatusMenu(false);
                }}
              >
                <span className="status-dot-sm" style={{ backgroundColor: opt.color }} />
                {opt.label}
              </button>
            ))}
            <div className="status-menu-divider" />
            <button
              className="status-menu-item"
              onClick={() => {
                setShowStatusMenu(false);
                onEditMyProfile();
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 17.25V21H6.75L17.81 9.94L14.06 6.19L3 17.25ZM20.71 7.04C21.1 6.65 21.1 6.02 20.71 5.63L18.37 3.29C17.98 2.9 17.35 2.9 16.96 3.29L15.13 5.12L18.88 8.87L20.71 7.04Z" />
              </svg>
              Edit Profile
            </button>
          </div>
        )}
      </div>

      {/* Notification panel */}
      {showNotifications && (
        <div className="notif-panel">
          <div className="notif-panel-header">
            <span>Notifications</span>
            <button className="notif-panel-close" onClick={() => setShowNotifications(false)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
              </svg>
            </button>
          </div>
          {notifications.length === 0 ? (
            <p className="notif-panel-empty">No notifications</p>
          ) : (
            notifications.map(n => (
              <div key={n.id.toString()} className="notif-row">
                <div className="notif-icon">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M14 8C14 10.21 12.21 12 10 12C7.79 12 6 10.21 6 8C6 5.79 7.79 4 10 4C12.21 4 14 5.79 14 8ZM10 14C7.33 14 2 15.34 2 18V20H18V18C18 15.34 12.67 14 10 14ZM18.41 10H21.5V8H18.41L19.41 7L18 5.59L15.59 8L18 10.41L19.41 9L18.41 10Z" />
                  </svg>
                </div>
                <div className="notif-content">
                  <p className="notif-text">
                    <strong>{n.senderName}</strong> invited you to join{' '}
                    <strong>{n.serverName}</strong>
                  </p>
                  <div className="notif-actions">
                    <button
                      className="notif-btn notif-btn-join"
                      onClick={() => {
                        joinServer({ inviteCode: n.inviteCode })
                          .then(() => dismissNotification({ notificationId: n.id }))
                          .catch(err => {
                            console.error(err);
                            alert('Could not join: invite may be invalid or expired.');
                          });
                        setShowNotifications(false);
                      }}
                    >
                      Join
                    </button>
                    <button
                      className="notif-btn notif-btn-dismiss"
                      onClick={() =>
                        dismissNotification({ notificationId: n.id }).catch(console.error)
                      }
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Modals */}
      {showCreateServer && (
        <CreateServerModal
          onClose={() => setShowCreateServer(false)}
          onCreate={(name, description, isPublic) =>
            createServer({ name, description, isPublic })
              .then(() => setShowCreateServer(false))
              .catch(console.error)
          }
          onJoin={code =>
            joinServer({ inviteCode: code })
              .then(() => setShowCreateServer(false))
              .catch(err => {
                console.error(err);
                alert('Invalid or expired invite code.');
              })
          }
        />
      )}

      {showCreateChannel && selectedServerId !== null && (
        <CreateChannelModal
          onClose={() => setShowCreateChannel(false)}
          onCreate={(name, topic) =>
            createChannel({ serverId: selectedServerId, name, topic })
              .then(() => setShowCreateChannel(false))
              .catch(console.error)
          }
        />
      )}

      {showInviteModal && selectedServerId !== null && selectedServer !== null && (
        <InviteModal
          server={selectedServer}
          channel={channels.find(c => c.id === selectedChannelId) ?? null}
          allUsers={allUsers}
          serverMembers={(allServerMembers as ServerMember[]).filter(
            m => m.serverId === selectedServerId
          )}
          currentIdentityHex={currentUser?.identity.toHexString() ?? ''}
          invites={serverInvites as Invite[]}
          onClose={() => setShowInviteModal(false)}
          onCreateInvite={(maxUses, expiresInHours) =>
            createInvite({ serverId: selectedServerId, maxUses, expiresInHours }).catch(
              console.error
            )
          }
          onInviteUser={(userHex, inviteCode) => {
            const target = allUsers.find(u => u.identity.toHexString() === userHex);
            if (target) {
              sendServerInvite({ targetIdentity: target.identity, inviteCode }).catch(
                console.error
              );
            }
          }}
        />
      )}

      {showCreateCategory && selectedServerId !== null && (
        <CreateCategoryModal
          onClose={() => setShowCreateCategory(false)}
          onCreate={name =>
            createCategory({ serverId: selectedServerId, name })
              .then(() => setShowCreateCategory(false))
              .catch(err => alert(String(err)))
          }
        />
      )}

      {showNicknameEdit && selectedServerId !== null && (
        <NicknameModal
          current={myServerNickname}
          onClose={() => setShowNicknameEdit(false)}
          onSave={nickname =>
            setNickname({ serverId: selectedServerId, nickname })
              .then(() => setShowNicknameEdit(false))
              .catch(err => alert(String(err)))
          }
        />
      )}

      {showSuperAdminPanel && (
        <SuperAdminPanel
          servers={servers}
          superAdmins={superAdmins}
          specialChatRoles={specialChatRoles}
          allUsers={allUsers}
          currentIdentityHex={currentUser?.identity.toHexString() ?? ''}
          onClose={() => setShowSuperAdminPanel(false)}
        />
      )}

      {showServerSettings && selectedServer && (
        <ServerSettings
          server={selectedServer}
          channels={channels}
          categories={categories}
          members={(allServerMembers as ServerMember[]).filter(
            m => m.serverId === selectedServer.id
          )}
          users={allUsers}
          invites={(allInvites as Invite[]).filter(inv => inv.serverId === selectedServer.id)}
          serverRoles={serverRoles.filter(r => r.serverId === selectedServer.id)}
          memberRoles={memberRoles.filter(r => r.serverId === selectedServer.id)}
          currentIdentityHex={currentUser?.identity.toHexString() ?? ''}
          isOwner={currentUser?.identity.toHexString() === selectedServer.ownerId.toHexString()}
          isAdmin={isChannelAdmin}
          isSuperAdmin={isSuperAdmin}
          onClose={() => setShowServerSettings(false)}
        />
      )}
    </>
  );
}

// ─── Modals ──────────────────────────────────────────────────────────────────

interface ServerTemplate {
  id: string;
  label: string;
  emoji: string;
  iconBg: string;
}

const SERVER_TEMPLATES: ServerTemplate[] = [
  { id: 'gaming', label: 'Gaming', emoji: '🎮', iconBg: '#5865f2' },
  { id: 'friends', label: 'Friends', emoji: '💕', iconBg: '#eb459e' },
  { id: 'study', label: 'Study Group', emoji: '📚', iconBg: '#f0b232' },
  { id: 'school', label: 'School Club', emoji: '🏫', iconBg: '#5865f2' },
];

type CreateServerView = 'landing' | 'form' | 'join';

function CreateServerModal({
  onClose,
  onCreate,
  onJoin,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string, isPublic: boolean) => void;
  onJoin: (code: string) => void;
}) {
  const [view, setView] = useState<CreateServerView>('landing');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [code, setCode] = useState('');

  const pickTemplate = (tpl: ServerTemplate | null) => {
    if (tpl) setName(`${tpl.label} Hangout`);
    setView('form');
  };

  const chevron = (
    <svg
      className="create-server-option-chevron"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal modal-create-server" onMouseDown={e => e.stopPropagation()}>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
          </svg>
        </button>

        {view === 'landing' && (
          <>
            <h3>Create Your Server</h3>
            <p className="modal-subtitle">
              Your server is where you and your friends hang out. Make yours and start talking.
            </p>

            <div className="create-server-body">
              <button
                type="button"
                className="create-server-option create-server-option-own"
                onClick={() => pickTemplate(null)}
              >
                <span className="create-server-option-icon" style={{ backgroundColor: '#3ba55c' }}>
                  🏞️
                </span>
                <span className="create-server-option-label">Create My Own</span>
                {chevron}
              </button>

              <div className="create-server-section-header">START FROM A TEMPLATE</div>

              {SERVER_TEMPLATES.map(tpl => (
                <button
                  key={tpl.id}
                  type="button"
                  className="create-server-option"
                  onClick={() => pickTemplate(tpl)}
                >
                  <span
                    className="create-server-option-icon"
                    style={{ backgroundColor: tpl.iconBg }}
                  >
                    {tpl.emoji}
                  </span>
                  <span className="create-server-option-label">{tpl.label}</span>
                  {chevron}
                </button>
              ))}
            </div>

            <div className="create-server-footer">
              <p className="create-server-footer-title">Have an invite already?</p>
              <button type="button" className="btn-wide" onClick={() => setView('join')}>
                Join a Server
              </button>
            </div>
          </>
        )}

        {view === 'form' && (
          <>
            <h3>Customize Your Server</h3>
            <p className="modal-subtitle">
              Give your new server a name and description. You can always change it later.
            </p>
            <form
              onSubmit={e => {
                e.preventDefault();
                if (name.trim()) onCreate(name, description, isPublic);
              }}
            >
              <label>
                Server name
                <input
                  autoFocus
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="My Awesome Server"
                  maxLength={48}
                />
              </label>
              <label>
                Description
                <textarea
                  value={description}
                  onChange={e => setDescription(e.target.value)}
                  placeholder="What's this server about?"
                  maxLength={256}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={isPublic}
                  onChange={e => setIsPublic(e.target.checked)}
                />
                Public (anyone can join automatically)
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setView('landing')}>
                  Back
                </button>
                <button type="submit" className="btn-primary">
                  Create
                </button>
              </div>
            </form>
          </>
        )}

        {view === 'join' && (
          <>
            <h3>Join a Server</h3>
            <p className="modal-subtitle">
              Enter an invite link or code to join an existing server.
            </p>
            <form
              onSubmit={e => {
                e.preventDefault();
                const raw = code.trim();
                if (!raw) return;
                // Accept either a full URL (.../invite/CODE) or a bare code
                const urlMatch = raw.match(/\/invite\/([A-Za-z0-9]+)\/?$/);
                const resolved = urlMatch ? urlMatch[1] : raw;
                onJoin(resolved);
              }}
            >
              <label>
                Invite link or code
                <input
                  autoFocus
                  value={code}
                  onChange={e => setCode(e.target.value)}
                  placeholder="https://…/invite/ABC12345 or ABC12345"
                />
              </label>
              <div className="modal-actions">
                <button type="button" className="btn-secondary" onClick={() => setView('landing')}>
                  Back
                </button>
                <button type="submit" className="btn-primary">
                  Join Server
                </button>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}

function CreateChannelModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string, topic: string) => void;
}) {
  const [name, setName] = useState('');
  const [topic, setTopic] = useState('');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Create a Channel</h3>
        <form
          onSubmit={e => {
            e.preventDefault();
            if (name.trim()) onCreate(name, topic);
          }}
        >
          <label>
            Channel name
            <div className="channel-name-input">
              <span>#</span>
              <input
                autoFocus
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="new-channel"
                maxLength={32}
              />
            </div>
          </label>
          <label>
            Topic (optional)
            <input
              value={topic}
              onChange={e => setTopic(e.target.value)}
              placeholder="What's this channel about?"
              maxLength={256}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function InviteModal({
  server,
  channel,
  allUsers,
  serverMembers,
  currentIdentityHex,
  invites,
  onClose,
  onCreateInvite,
  onInviteUser,
}: {
  server: Server;
  channel: Channel | null;
  allUsers: readonly User[];
  serverMembers: ServerMember[];
  currentIdentityHex: string;
  invites: Invite[];
  onClose: () => void;
  onCreateInvite: (maxUses: number, expiresInHours: number) => void;
  onInviteUser: (userHex: string, inviteCode: string) => void;
}) {
  const [search, setSearch] = useState('');
  const [copied, setCopied] = useState(false);
  const [invitedUsers, setInvitedUsers] = useState<Set<string>>(new Set());
  const [showLinkSettings, setShowLinkSettings] = useState(false);

  // Auto-create an invite when the modal first opens so it's ready to share
  useEffect(() => {
    if (invites.length === 0) onCreateInvite(0, 168);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Most recent active invite
  const activeInvite = invites.length > 0 ? invites[0] : null;
  const inviteLink = activeInvite ? `${window.location.origin}/invite/${activeInvite.code}` : null;

  const memberHexes = new Set(serverMembers.map(m => m.userIdentity.toHexString()));
  const nonMembers = allUsers.filter(u => {
    const hex = u.identity.toHexString();
    if (hex === currentIdentityHex) return false;
    if (memberHexes.has(hex)) return false;
    const name = (u.name ?? generateAlias(hex)).toLowerCase();
    return !search || name.includes(search.toLowerCase());
  });

  const copyLink = () => {
    const link = inviteLink ?? '';
    if (!link) return;
    navigator.clipboard.writeText(link).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const inviteUser = (hex: string) => {
    if (!activeInvite) {
      alert('Invite link is being created, please try again in a moment.');
      return;
    }
    onInviteUser(hex, activeInvite.code);
    setInvitedUsers(prev => new Set([...prev, hex]));
  };

  const expireLabel = (): string => {
    if (!activeInvite || activeInvite.expiresAt === 0n) return 'never expires';
    const ms = Number(activeInvite.expiresAt / 1000n);
    const days = Math.ceil((ms - Date.now()) / 86_400_000);
    if (days <= 0) return 'has expired';
    if (days === 1) return 'expires in 1 day';
    return `expires in ${days} days`;
  };

  if (showLinkSettings) {
    return (
      <InviteLinkSettings
        onClose={() => setShowLinkSettings(false)}
        onGenerate={(maxUses, expiresInHours) => {
          onCreateInvite(maxUses, expiresInHours);
          setShowLinkSettings(false);
        }}
      />
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="invite-modal" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="invite-modal-header">
          <div>
            <h3 className="invite-modal-title">Invite friends to {server.name}</h3>
            {channel && (
              <p className="invite-modal-subtitle">
                Recipients will land in <strong># {channel.name}</strong>
              </p>
            )}
          </div>
          <button className="invite-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="invite-modal-search-wrap">
          <svg
            className="invite-modal-search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" />
          </svg>
          <input
            className="invite-modal-search"
            placeholder="Search for friends"
            value={search}
            onChange={e => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        {/* User list */}
        <div className="invite-modal-user-list">
          {nonMembers.length === 0 ? (
            <p className="invite-modal-empty">
              {search ? 'No users match your search.' : 'All users are already members.'}
            </p>
          ) : (
            nonMembers.map(u => {
              const hex = u.identity.toHexString();
              const name = u.name ?? generateAlias(hex);
              const isInvited = invitedUsers.has(hex);
              return (
                <div key={hex} className="invite-modal-user-row">
                  <div className="invite-modal-avatar" style={{ background: u.avatarColor }}>
                    {name[0]?.toUpperCase()}
                  </div>
                  <span className="invite-modal-user-name">{name}</span>
                  <button
                    className={`invite-modal-invite-btn ${isInvited ? 'invited' : ''}`}
                    onClick={() => inviteUser(hex)}
                    disabled={isInvited}
                  >
                    {isInvited ? 'Invited' : 'Invite'}
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Invite link section */}
        <div className="invite-modal-link-section">
          <p className="invite-modal-link-label">Or, send a server invite link to a friend</p>
          <div className="invite-modal-link-row">
            <span className="invite-modal-link-text">
              {inviteLink ?? 'No active invite — click Generate'}
            </span>
            <button
              className={`invite-modal-copy-btn ${copied ? 'copied' : ''}`}
              onClick={inviteLink ? copyLink : () => onCreateInvite(0, 168)}
            >
              {copied ? 'Copied' : inviteLink ? 'Copy' : 'Generate'}
            </button>
          </div>
          {activeInvite && (
            <p className="invite-modal-link-footer">
              Your invite link {expireLabel()}.{' '}
              <button className="invite-modal-edit-link" onClick={() => setShowLinkSettings(true)}>
                Edit invite link
              </button>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function InviteLinkSettings({
  onClose,
  onGenerate,
}: {
  onClose: () => void;
  onGenerate: (maxUses: number, expiresInHours: number) => void;
}) {
  const [expiresInHours, setExpiresInHours] = useState(168);
  const [maxUses, setMaxUses] = useState(0);

  const EXPIRE_OPTIONS = [
    { label: '1 hour', value: 1 },
    { label: '6 hours', value: 6 },
    { label: '12 hours', value: 12 },
    { label: '1 day', value: 24 },
    { label: '7 days', value: 168 },
    { label: '30 days', value: 720 },
    { label: 'Never', value: 0 },
  ];
  const MAX_USES_OPTIONS = [
    { label: 'No limit', value: 0 },
    { label: '1 use', value: 1 },
    { label: '5 uses', value: 5 },
    { label: '10 uses', value: 10 },
    { label: '25 uses', value: 25 },
    { label: '50 uses', value: 50 },
    { label: '100 uses', value: 100 },
  ];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="invite-settings-modal" onClick={e => e.stopPropagation()}>
        <div className="invite-settings-header">
          <h3>Server invite link settings</h3>
          <button className="invite-modal-close" onClick={onClose}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>

        <div className="invite-settings-body">
          <div className="invite-settings-field">
            <label className="invite-settings-label">Expire After</label>
            <div className="invite-settings-select-wrap">
              <select
                className="invite-settings-select"
                value={expiresInHours}
                onChange={e => setExpiresInHours(Number(e.target.value))}
              >
                {EXPIRE_OPTIONS.map(o => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <svg
                className="invite-settings-select-chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M16.59 8.59L12 13.17L7.41 8.59L6 10L12 16L18 10L16.59 8.59Z" />
              </svg>
            </div>
          </div>

          <div className="invite-settings-field">
            <label className="invite-settings-label">Max Number of Uses</label>
            <div className="invite-settings-select-wrap">
              <select
                className="invite-settings-select"
                value={maxUses}
                onChange={e => setMaxUses(Number(e.target.value))}
              >
                {MAX_USES_OPTIONS.map(o => (
                  <option key={o.label} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <svg
                className="invite-settings-select-chevron"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M16.59 8.59L12 13.17L7.41 8.59L6 10L12 16L18 10L16.59 8.59Z" />
              </svg>
            </div>
          </div>

          <div className="invite-settings-toggle-row">
            <div className="invite-settings-toggle-text">
              <span className="invite-settings-toggle-label">Grant temporary membership</span>
              <span className="invite-settings-toggle-desc">
                Temporary members are automatically kicked when they disconnect unless a role has
                been assigned
              </span>
            </div>
            <div className="invite-settings-toggle-switch" />
          </div>
        </div>

        <div className="invite-settings-footer">
          <button className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => onGenerate(maxUses, expiresInHours)}>
            Generate a New Link
          </button>
        </div>
      </div>
    </div>
  );
}

function CreateCategoryModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (name: string) => void;
}) {
  const [name, setName] = useState('');
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Create Category</h3>
        <p className="modal-subtitle">Group related channels together.</p>
        <form
          onSubmit={e => {
            e.preventDefault();
            if (name.trim()) onCreate(name);
          }}
        >
          <label>
            Category name
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Voice Channels"
              maxLength={48}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Create
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function NicknameModal({
  current,
  onClose,
  onSave,
}: {
  current: string;
  onClose: () => void;
  onSave: (nickname: string) => void;
}) {
  const [nickname, setNickname] = useState(current);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Change Nickname</h3>
        <p className="modal-subtitle">Your nickname will only appear in this server.</p>
        <form
          onSubmit={e => {
            e.preventDefault();
            onSave(nickname.trim());
          }}
        >
          <label>
            Nickname
            <input
              autoFocus
              value={nickname}
              onChange={e => setNickname(e.target.value)}
              placeholder="Leave empty to reset to your global name"
              maxLength={32}
            />
          </label>
          <div className="modal-actions">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary">
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
