import { useCallback, useEffect, useMemo, useState } from 'react';
import { useReducer, useSpacetimeDB, useTable } from 'spacetimedb/react';
import Chat from './components/Chat';
import DevAdminModal from './components/DevAdminModal';
import Members from './components/Members';
import Sidebar from './components/Sidebar';
import SuperAdminBanner from './components/SuperAdminBanner';
import UserProfile, { EditProfileModal } from './components/UserProfile';
import { navigateTo, parseInviteRoute, useRoute } from './hooks/useRoute';
import { reducers, tables } from './module_bindings';
import type { ReadState, ServerMember, Typing, User } from './module_bindings/types';
import './App.css';

export interface ProfileAnchor {
  user: User;
  rect: DOMRect;
}

const TYPING_TTL_MS = 10_000;

export default function App() {
  const { identity, isActive } = useSpacetimeDB();

  const [servers] = useTable(tables.server);
  const [channels] = useTable(tables.channel);
  const [users] = useTable(tables.user);
  const [threads] = useTable(tables.thread);
  const [allMembers] = useTable(tables.server_member);
  const [reactions] = useTable(tables.reaction);
  const [typingRows] = useTable(tables.typing);
  const [readStates] = useTable(tables.read_state);
  const [categories] = useTable(tables.category);
  const [superAdmins] = useTable(tables.super_admin);
  const [specialChatRoles] = useTable(tables.special_chat_role);
  const [serverRoles] = useTable(tables.server_role);
  const [memberRoles] = useTable(tables.member_role);
  const [allInvites] = useTable(tables.invite);
  const [allNotifications] = useTable(tables.notification);
  const [channelPermissionOverrides] = useTable(tables.channel_permission_override);

  const joinServer = useReducer(reducers.joinServer);

  // Capture invite code from URL once at mount (e.g. /invite/ABC12345)
  const [pendingInviteCode] = useState<string | null>(() =>
    parseInviteRoute(window.location.pathname)
  );
  const [inviteHandled, setInviteHandled] = useState(false);

  // Auto-join when arriving via an invite link
  useEffect(() => {
    if (!isActive || !pendingInviteCode || inviteHandled) return;
    setInviteHandled(true);

    // Clear the /invite/... URL immediately so refresh doesn't re-trigger
    window.history.replaceState({}, '', '/');
    window.dispatchEvent(new Event('omnia:route-change'));

    // Look up the invite to find which server we're joining
    const inv = allInvites.find(i => i.code === pendingInviteCode);

    // Already a member? Just navigate there
    if (inv && myServerIds.has(inv.serverId.toString())) {
      navigateTo(inv.serverId, null, { replace: true });
      return;
    }

    joinServer({ inviteCode: pendingInviteCode })
      .then(() => {
        if (inv) navigateTo(inv.serverId, null);
      })
      .catch(err => {
        console.error('Invite join failed:', err);
        alert('Could not join: invite may be invalid or expired.');
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, pendingInviteCode, inviteHandled]);

  const { serverId: routeServerId, channelId: routeChannelId } = useRoute();
  const selectedServerId = routeServerId;
  const selectedChannelId = routeChannelId;
  const [activeThreadId, setActiveThreadId] = useState<bigint | null>(null);
  const [activeProfile, setActiveProfile] = useState<ProfileAnchor | null>(null);
  const [showEditProfile, setShowEditProfile] = useState(false);
  const [showMembers, setShowMembers] = useState(true);
  const [showDevAdmin, setShowDevAdmin] = useState(false);

  // Ctrl/Cmd+Shift+A anywhere opens the Developer Access modal, even for
  // users who don't currently hold super_admin. This is the recovery path
  // for wiped databases, lost sessions, or shared-dev access.
  //
  // The shortcut is open-only — pressing it while the modal is already
  // open does nothing. Closing goes through the Escape/backdrop/Close-btn
  // paths, all of which are owned by DevAdminModal and run the focus
  // restoration logic in one place.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowDevAdmin(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const myHex = identity?.toHexString() ?? '';

  // Super admin status: user has a row in super_admin table
  const isSuperAdmin = useMemo(
    () => superAdmins.some(sa => sa.userIdentity.toHexString() === myHex),
    [superAdmins, myHex]
  );

  // Silence the "declared but never used" warning — legacy table kept for
  // backward compat; all chat-write permission is now computed from roles.
  void specialChatRoles;

  // Permission bitflag constants (must match backend)
  const PERM_VIEW_CHANNELS = 1n;
  const PERM_SEND_MESSAGES = 2n;
  const PERM_ADMINISTRATOR = 1024n;

  // Role lookup helpers.
  const rolePermById = useMemo(() => {
    const byId = new Map<string, bigint>();
    for (const r of serverRoles) byId.set(r.id.toString(), r.permissions);
    return byId;
  }, [serverRoles]);

  const defaultRoleIdByServer = useMemo(() => {
    const byServer = new Map<string, string>();
    for (const r of serverRoles) {
      if (r.isDefault) byServer.set(r.serverId.toString(), r.id.toString());
    }
    return byServer;
  }, [serverRoles]);

  const defaultRolePermByServer = useMemo(() => {
    const byServer = new Map<string, bigint>();
    for (const r of serverRoles) {
      if (r.isDefault) byServer.set(r.serverId.toString(), r.permissions);
    }
    return byServer;
  }, [serverRoles]);

  const myRoleIdsByServer = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const m of allMembers) {
      if (m.userIdentity.toHexString() !== myHex) continue;
      result.set(m.serverId.toString(), new Set());
    }
    for (const mr of memberRoles) {
      if (mr.userIdentity.toHexString() !== myHex) continue;
      const key = mr.serverId.toString();
      if (!result.has(key)) continue;
      result.get(key)!.add(mr.roleId.toString());
    }
    for (const [serverId, roleIds] of result) {
      const defaultRoleId = defaultRoleIdByServer.get(serverId);
      if (defaultRoleId) roleIds.add(defaultRoleId);
    }
    return result;
  }, [allMembers, memberRoles, myHex, defaultRoleIdByServer]);

  // Compute the current user's combined permission bits per server.
  // Keys are serverId.toString(); values are OR(role.permissions), including
  // @everyone by default for each joined server.
  const myPermissionsByServer = useMemo(() => {
    const result = new Map<string, bigint>();
    for (const [serverId, roleIds] of myRoleIdsByServer) {
      let perms = defaultRolePermByServer.get(serverId) ?? 0n;
      for (const roleId of roleIds) {
        const perm = rolePermById.get(roleId);
        if (perm !== undefined) perms |= perm;
      }
      result.set(serverId, perms);
    }
    return result;
  }, [myRoleIdsByServer, defaultRolePermByServer, rolePermById]);

  const getChannelEffectivePermissions = useCallback(
    (channel: { id: bigint; serverId: bigint }): bigint => {
      const myMembership = allMembers.find(
        m => m.serverId === channel.serverId && m.userIdentity.toHexString() === myHex
      );
      if (!myMembership) return 0n;
      if (myMembership.role === 'owner' || isSuperAdmin) return PERM_ADMINISTRATOR;

      const serverIdKey = channel.serverId.toString();
      const serverPerms = myPermissionsByServer.get(serverIdKey) ?? 0n;
      if ((serverPerms & PERM_ADMINISTRATOR) !== 0n) return serverPerms;

      const myRoleIds = myRoleIdsByServer.get(serverIdKey) ?? new Set<string>();
      const everyoneRoleId = defaultRoleIdByServer.get(serverIdKey) ?? null;

      let everyoneDeny = 0n;
      let everyoneAllow = 0n;
      let roleDeny = 0n;
      let roleAllow = 0n;
      let memberDeny = 0n;
      let memberAllow = 0n;

      for (const ov of channelPermissionOverrides) {
        if (ov.channelId !== channel.id) continue;
        if (ov.targetType === 'role') {
          if (everyoneRoleId !== null && ov.targetId === everyoneRoleId) {
            everyoneDeny |= ov.deny;
            everyoneAllow |= ov.allow;
          } else if (myRoleIds.has(ov.targetId)) {
            roleDeny |= ov.deny;
            roleAllow |= ov.allow;
          }
        } else if (ov.targetType === 'member' && ov.targetId === myHex) {
          memberDeny |= ov.deny;
          memberAllow |= ov.allow;
        }
      }

      let perms = serverPerms;
      perms = (perms & ~everyoneDeny) | everyoneAllow;
      perms = (perms & ~roleDeny) | roleAllow;
      perms = (perms & ~memberDeny) | memberAllow;
      return perms;
    },
    [
      allMembers,
      myHex,
      isSuperAdmin,
      myPermissionsByServer,
      myRoleIdsByServer,
      defaultRoleIdByServer,
      channelPermissionOverrides,
    ]
  );

  const canViewInChannel = useCallback(
    (channel: { id: bigint; serverId: bigint }): boolean => {
      if (isSuperAdmin) return true;
      const perms = getChannelEffectivePermissions(channel);
      return (perms & PERM_VIEW_CHANNELS) !== 0n || (perms & PERM_ADMINISTRATOR) !== 0n;
    },
    [isSuperAdmin, getChannelEffectivePermissions]
  );

  const canWriteInChannel = (channel: { id: bigint; serverId: bigint }): boolean => {
    if (!canViewInChannel(channel)) return false;
    const perms = getChannelEffectivePermissions(channel);
    return (perms & PERM_SEND_MESSAGES) !== 0n || (perms & PERM_ADMINISTRATOR) !== 0n;
  };

  // Only show servers the current user has joined
  const myServerIds = useMemo(
    () =>
      new Set(
        allMembers
          .filter(m => m.userIdentity.toHexString() === myHex)
          .map(m => m.serverId.toString())
      ),
    [allMembers, myHex]
  );

  const joinedServers = useMemo(
    () =>
      [...servers]
        .filter(s => myServerIds.has(s.id.toString()))
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    [servers, myServerIds]
  );

  // Validate server from URL — if invalid or missing, auto-select first joined
  useEffect(() => {
    if (joinedServers.length === 0) return;
    if (routeServerId !== null && myServerIds.has(routeServerId.toString())) {
      return;
    }
    navigateTo(joinedServers[0].id, null, { replace: true });
  }, [joinedServers, myServerIds, routeServerId]);

  // Channels for the active server, sorted by position
  const serverChannels = useMemo(
    () =>
      channels
        .filter(c => selectedServerId !== null && c.serverId === selectedServerId)
        .filter(c => canViewInChannel(c))
        .sort((a, b) => a.position - b.position),
    [channels, selectedServerId, canViewInChannel]
  );

  // Validate channel from URL — if missing or not in current server, auto-select first
  useEffect(() => {
    if (selectedServerId === null) return;
    if (selectedChannelId !== null && serverChannels.some(c => c.id === selectedChannelId)) {
      return;
    }
    if (serverChannels.length > 0) {
      navigateTo(selectedServerId, serverChannels[0].id, { replace: true });
    }
  }, [selectedServerId, selectedChannelId, serverChannels]);

  // Close thread when channel changes
  useEffect(() => setActiveThreadId(null), [selectedChannelId]);

  // Members of the selected server
  const serverMembers = useMemo(
    () =>
      selectedServerId !== null ? allMembers.filter(m => m.serverId === selectedServerId) : [],
    [allMembers, selectedServerId]
  );

  // Current user's role in the selected server
  const myServerMember = useMemo(
    () => serverMembers.find(m => m.userIdentity.toHexString() === myHex) ?? null,
    [serverMembers, myHex]
  );
  const isChannelAdmin =
    myServerMember !== null && (myServerMember.role === 'owner' || myServerMember.role === 'admin');
  const myServerNickname = myServerMember?.nickname ?? '';

  // Read states keyed by channelId for unread badges
  const myReadStates = useMemo(
    () =>
      new Map<string, ReadState>(
        readStates
          .filter(rs => rs.userIdentity.toHexString() === myHex)
          .map(rs => [rs.channelId.toString(), rs])
      ),
    [readStates, myHex]
  );

  // Active typing users in the selected channel (excluding self, within TTL)
  const now = Date.now();
  const channelTypers = useMemo(
    () =>
      typingRows.filter(
        t =>
          t.channelId === selectedChannelId &&
          t.userIdentity.toHexString() !== myHex &&
          now - Number(t.startedAt.microsSinceUnixEpoch / 1000n) < TYPING_TTL_MS
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [typingRows, selectedChannelId, myHex]
  );

  if (!isActive || !identity) {
    return (
      <div className="loading-screen">
        <div className="loading-logo">Ω</div>
        <p>Connecting to Omnia…</p>
      </div>
    );
  }

  const selectedServer = servers.find(s => s.id === selectedServerId) ?? null;
  const selectedChannel = serverChannels.find(c => c.id === selectedChannelId) ?? null;
  const currentUser = users.find(u => u.identity.toHexString() === myHex) ?? null;

  return (
    <>
      {isSuperAdmin && <SuperAdminBanner />}
      <div
        className={`app ${showMembers ? '' : 'members-hidden'} ${isSuperAdmin ? 'sa-active' : ''}`}
      >
        <Sidebar
          servers={joinedServers}
          channels={serverChannels}
          categories={categories}
          isChannelAdmin={isChannelAdmin}
          isSuperAdmin={isSuperAdmin}
          superAdmins={superAdmins}
          specialChatRoles={specialChatRoles}
          serverRoles={serverRoles}
          memberRoles={memberRoles}
          allUsers={users}
          myServerNickname={myServerNickname}
          selectedServerId={selectedServerId}
          selectedChannelId={selectedChannelId}
          onSelectServer={id => {
            // Pre-compute the first channel for this server so we land directly
            // on /c/:serverId/:channelId with a single history entry.
            const first = channels
              .filter(c => c.serverId === id)
              .filter(c => canViewInChannel(c))
              .sort((a, b) => a.position - b.position)[0];
            navigateTo(id, first?.id ?? null);
          }}
          onSelectChannel={id => navigateTo(selectedServerId, id)}
          selectedServer={selectedServer}
          currentUser={currentUser}
          myReadStates={myReadStates}
          notifications={allNotifications.filter(n => n.recipientIdentity.toHexString() === myHex)}
          onEditMyProfile={() => setShowEditProfile(true)}
        />
        {selectedChannel ? (
          <Chat
            channel={selectedChannel}
            users={users}
            threads={threads}
            reactions={reactions}
            typingUsers={channelTypers as Typing[]}
            serverMembers={serverMembers as ServerMember[]}
            isChannelAdmin={isChannelAdmin}
            currentIdentityHex={myHex}
            canWrite={canWriteInChannel(selectedChannel)}
            activeThreadId={activeThreadId}
            onOpenThread={setActiveThreadId}
            onCloseThread={() => setActiveThreadId(null)}
            onOpenProfile={(u, r) => setActiveProfile({ user: u, rect: r })}
            showMembers={showMembers}
            onToggleMembers={() => setShowMembers(v => !v)}
          />
        ) : (
          <>
            <header className="chat-header empty" />
            <main className="chat-main empty-state">
              <h2># no channel selected</h2>
              <p>Pick a channel from the sidebar, or join a server using an invite code.</p>
            </main>
          </>
        )}
        {showMembers && (
          <Members
            users={users}
            members={serverMembers as ServerMember[]}
            currentIdentityHex={myHex}
            onOpenProfile={(u, r) => setActiveProfile({ user: u, rect: r })}
          />
        )}

        {activeProfile && (
          <UserProfile
            user={activeProfile.user}
            member={
              (serverMembers as ServerMember[]).find(
                m => m.userIdentity.toHexString() === activeProfile.user.identity.toHexString()
              ) ?? null
            }
            anchorRect={activeProfile.rect}
            isMe={activeProfile.user.identity.toHexString() === myHex}
            onClose={() => setActiveProfile(null)}
            onEditProfile={() => {
              setActiveProfile(null);
              setShowEditProfile(true);
            }}
          />
        )}

        {showEditProfile && currentUser && (
          <EditProfileModal user={currentUser} onClose={() => setShowEditProfile(false)} />
        )}
      </div>

      <DevAdminModal
        open={showDevAdmin}
        onClose={() => setShowDevAdmin(false)}
        isSuperAdmin={isSuperAdmin}
      />
    </>
  );
}
