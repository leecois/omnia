import type { ServerMember, User } from '../module_bindings/types';
import { generateAlias } from '../utils/alias';

interface MembersProps {
  users: readonly User[];
  members: ServerMember[];
  currentIdentityHex: string;
  onOpenProfile: (user: User, rect: DOMRect) => void;
}

const STATUS_COLOR: Record<string, string> = {
  online: '#23a55a',
  idle: '#f0b232',
  dnd: '#f23f43',
  invisible: '#80848e',
  offline: '#80848e',
};

export default function Members({
  users,
  members,
  currentIdentityHex,
  onOpenProfile,
}: MembersProps) {
  const memberHexes = new Set(members.map(m => m.userIdentity.toHexString()));
  const memberNickname = new Map(members.map(m => [m.userIdentity.toHexString(), m.nickname]));

  const serverUsers = users.filter(u => memberHexes.has(u.identity.toHexString()));

  const online = serverUsers
    .filter(u => u.online && u.status !== 'invisible')
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const offline = serverUsers
    .filter(u => !u.online || u.status === 'invisible')
    .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  return (
    <aside className="member-panel">
      <div className="member-list">
        <div className="member-group-header">ONLINE — {online.length}</div>
        {online.map(u => (
          <MemberRow
            key={u.identity.toHexString()}
            user={u}
            nickname={memberNickname.get(u.identity.toHexString()) ?? undefined}
            isSelf={u.identity.toHexString() === currentIdentityHex}
            onOpenProfile={onOpenProfile}
          />
        ))}
        {offline.length > 0 && (
          <>
            <div className="member-group-header">OFFLINE — {offline.length}</div>
            {offline.map(u => (
              <MemberRow
                key={u.identity.toHexString()}
                user={u}
                nickname={memberNickname.get(u.identity.toHexString()) ?? undefined}
                isSelf={u.identity.toHexString() === currentIdentityHex}
                onOpenProfile={onOpenProfile}
                muted
              />
            ))}
          </>
        )}
      </div>
    </aside>
  );
}

function MemberRow({
  user,
  nickname,
  isSelf,
  muted,
  onOpenProfile,
}: {
  user: User;
  nickname?: string;
  isSelf: boolean;
  muted?: boolean;
  onOpenProfile: (user: User, rect: DOMRect) => void;
}) {
  const display = nickname || user.name || generateAlias(user.identity.toHexString());
  const statusColor =
    user.online && user.status !== 'invisible'
      ? (STATUS_COLOR[user.status] ?? '#80848e')
      : STATUS_COLOR.offline;
  return (
    <div
      className={`member-row ${muted ? 'muted' : ''}`}
      onClick={e => onOpenProfile(user, (e.currentTarget as HTMLElement).getBoundingClientRect())}
    >
      <div className="member-avatar" style={{ backgroundColor: user.avatarColor ?? '#5865F2' }}>
        {display[0]?.toUpperCase()}
        <span className="status-dot" style={{ backgroundColor: statusColor }} />
      </div>
      <div className="member-name">
        {display}
        {isSelf && <span className="you-tag"> (you)</span>}
      </div>
    </div>
  );
}
