import { useState, useEffect, useMemo } from 'react';
import { useSpacetimeDB, useTable, useReducer } from 'spacetimedb/react';
import { tables, reducers } from './module_bindings';
import { useRoute, navigateTo, parseInviteRoute } from './hooks/useRoute';
import type {
  ReadState,
  ServerMember,
  Typing,
  User,
} from './module_bindings/types';
import Sidebar from './components/Sidebar';
import Chat from './components/Chat';
import Members from './components/Members';
import UserProfile, { EditProfileModal } from './components/UserProfile';
import DevAdminModal from './components/DevAdminModal';
import SuperAdminBanner from './components/SuperAdminBanner';
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
  // Escape handling lives inside DevAdminModal so its focus trap owns
  // keyboard lifecycle in one place.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.shiftKey && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        setShowDevAdmin(v => !v);
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
  const PERM_SEND_MESSAGES = 2n;
  const PERM_ADMINISTRATOR = 1024n;

  // Compute the current user's combined permission bits per server.
  // Keys are serverId.toString(); values are the OR of all role.permissions
  // where the user has an assignment in that server.
  const myPermissionsByServer = useMemo(() => {
    const rolesById = new Map<string, bigint>();
    for (const r of serverRoles) {
      rolesById.set(r.id.toString(), r.permissions);
    }
    const result = new Map<string, bigint>();
    for (const mr of memberRoles) {
      if (mr.userIdentity.toHexString() !== myHex) continue;
      const perm = rolesById.get(mr.roleId.toString());
      if (perm === undefined) continue;
      const key = mr.serverId.toString();
      result.set(key, (result.get(key) ?? 0n) | perm);
    }
    return result;
  }, [serverRoles, memberRoles, myHex]);

  const canWriteInServer = (serverId: bigint): boolean => {
    if (isSuperAdmin) return true;
    // Server owners always have write access
    const myMembership = allMembers.find(
      m =>
        m.serverId === serverId &&
        m.userIdentity.toHexString() === myHex
    );
    if (myMembership?.role === 'owner') return true;
    const perms = myPermissionsByServer.get(serverId.toString()) ?? 0n;
    if ((perms & PERM_ADMINISTRATOR) !== 0n) return true;
    return (perms & PERM_SEND_MESSAGES) !== 0n;
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
    if (
      routeServerId !== null &&
      myServerIds.has(routeServerId.toString())
    ) {
      return;
    }
    navigateTo(joinedServers[0].id, null, { replace: true });
  }, [joinedServers, myServerIds, routeServerId]);

  // Channels for the active server, sorted by position
  const serverChannels = useMemo(
    () =>
      channels
        .filter(c => selectedServerId !== null && c.serverId === selectedServerId)
        .sort((a, b) => a.position - b.position),
    [channels, selectedServerId]
  );

  // Validate channel from URL — if missing or not in current server, auto-select first
  useEffect(() => {
    if (selectedServerId === null) return;
    if (
      selectedChannelId !== null &&
      serverChannels.some(c => c.id === selectedChannelId)
    ) {
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
      selectedServerId !== null
        ? allMembers.filter(m => m.serverId === selectedServerId)
        : [],
    [allMembers, selectedServerId]
  );

  // Current user's role in the selected server
  const myServerMember = useMemo(
    () =>
      serverMembers.find(m => m.userIdentity.toHexString() === myHex) ?? null,
    [serverMembers, myHex]
  );
  const isChannelAdmin =
    myServerMember !== null &&
    (myServerMember.role === 'owner' || myServerMember.role === 'admin');
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
  const currentUser =
    users.find(u => u.identity.toHexString() === myHex) ?? null;

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
          canWrite={canWriteInServer(selectedChannel.serverId)}
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
              m =>
                m.userIdentity.toHexString() ===
                activeProfile.user.identity.toHexString()
            ) ?? null
          }
          anchorRect={activeProfile.rect}
          isMe={
            activeProfile.user.identity.toHexString() === myHex
          }
          onClose={() => setActiveProfile(null)}
          onEditProfile={() => {
            setActiveProfile(null);
            setShowEditProfile(true);
          }}
        />
      )}

      {showEditProfile && currentUser && (
        <EditProfileModal
          user={currentUser}
          onClose={() => setShowEditProfile(false)}
        />
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
