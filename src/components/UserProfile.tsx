import { useEffect, useMemo, useRef, useState } from 'react';
import { useReducer } from 'spacetimedb/react';
import { reducers } from '../module_bindings';
import type { ServerMember, User } from '../module_bindings/types';
import { generateAlias } from '../utils/alias';

const STATUS_INFO: Record<string, { label: string; color: string }> = {
  online: { label: 'Online', color: '#23a55a' },
  idle: { label: 'Idle', color: '#f0b232' },
  dnd: { label: 'Do Not Disturb', color: '#f23f43' },
  invisible: { label: 'Offline', color: '#80848e' },
  offline: { label: 'Offline', color: '#80848e' },
};

const ROLE_COLOR: Record<string, string> = {
  owner: '#f0b232',
  admin: '#eb459e',
  mod: '#57f287',
  member: '#b5bac1',
};

interface UserProfileProps {
  user: User;
  member: ServerMember | null;
  anchorRect: DOMRect;
  isMe: boolean;
  onClose: () => void;
  onEditProfile: () => void;
}

const PANEL_WIDTH = 320;

export default function UserProfile({
  user,
  member,
  anchorRect,
  isMe,
  onClose,
  onEditProfile,
}: UserProfileProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Position the panel near the anchor, clamped to viewport
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const panelRect = panel.getBoundingClientRect();
    const panelHeight = panelRect.height;

    let left = anchorRect.right + 8;
    let top = anchorRect.top;

    // If not enough room on the right, place on the left
    if (left + PANEL_WIDTH > window.innerWidth - 16) {
      left = anchorRect.left - PANEL_WIDTH - 8;
    }
    // Clamp left
    if (left < 16) left = 16;

    // Keep panel on screen vertically
    if (top + panelHeight > window.innerHeight - 16) {
      top = window.innerHeight - panelHeight - 16;
    }
    if (top < 16) top = 16;

    setPos({ top, left });
  }, [anchorRect]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const displayName = member?.nickname || user.name || generateAlias(user.identity.toHexString());

  const statusKey = user.online ? user.status : 'offline';
  const statusInfo = STATUS_INFO[statusKey] ?? STATUS_INFO.offline;

  const createdDate = new Date(Number(user.createdAt.microsSinceUnixEpoch / 1000n));

  const joinedDate = member ? new Date(Number(member.joinedAt.microsSinceUnixEpoch / 1000n)) : null;

  const roleLabel = member?.role ?? null;

  return (
    <>
      <div className="profile-backdrop" onClick={onClose} />
      <div
        className="profile-panel"
        ref={panelRef}
        style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
        onClick={e => e.stopPropagation()}
      >
        <div className="profile-banner" style={{ backgroundColor: user.avatarColor }} />
        <div className="profile-avatar-wrap">
          <div className="profile-avatar" style={{ backgroundColor: user.avatarColor }}>
            {displayName[0]?.toUpperCase() ?? '?'}
            <span className="profile-status-dot" style={{ backgroundColor: statusInfo.color }} />
          </div>
        </div>

        <div className="profile-body">
          <div className="profile-name-row">
            <h3 className="profile-display-name">{displayName}</h3>
            {isMe && (
              <button className="profile-edit-btn" onClick={onEditProfile}>
                Edit Profile
              </button>
            )}
          </div>
          {user.name && (
            <div className="profile-username">
              {user.name}
              {user.pronouns && <span className="profile-pronouns"> · {user.pronouns}</span>}
            </div>
          )}
          {!user.name && user.pronouns && (
            <div className="profile-username profile-pronouns">{user.pronouns}</div>
          )}
          <div className="profile-status-line">
            <span className="profile-status-dot-sm" style={{ backgroundColor: statusInfo.color }} />
            {statusInfo.label}
          </div>

          <div className="profile-divider" />

          {user.bio && (
            <>
              <div className="profile-section-label">About Me</div>
              <div className="profile-bio">{user.bio}</div>
            </>
          )}

          <div className="profile-section-label">Omnia Member Since</div>
          <div className="profile-since">
            {createdDate.toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}
          </div>

          {joinedDate && (
            <>
              <div className="profile-section-label">Server Member Since</div>
              <div className="profile-since">
                {joinedDate.toLocaleDateString([], {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </div>
            </>
          )}

          {roleLabel && (
            <>
              <div className="profile-section-label">Role in this Server</div>
              <div className="profile-roles">
                <span
                  className="role-badge"
                  style={{
                    borderColor: ROLE_COLOR[roleLabel] ?? '#b5bac1',
                    color: ROLE_COLOR[roleLabel] ?? '#b5bac1',
                  }}
                >
                  <span
                    className="role-dot"
                    style={{
                      backgroundColor: ROLE_COLOR[roleLabel] ?? '#b5bac1',
                    }}
                  />
                  {roleLabel.charAt(0).toUpperCase() + roleLabel.slice(1)}
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ─── EditProfileModal ─────────────────────────────────────────────────────────

export function EditProfileModal({ user, onClose }: { user: User; onClose: () => void }) {
  const setProfile = useReducer(reducers.setProfile);
  const [bio, setBio] = useState(user.bio);
  const [pronouns, setPronouns] = useState(user.pronouns);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProfile({ bio, pronouns })
      .then(onClose)
      .catch(err => alert(String(err)));
  };

  const bioRemaining = 190 - bio.length;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <h3>Edit Profile</h3>
        <p className="modal-subtitle">Your profile is visible to everyone on Omnia.</p>
        <form onSubmit={submit}>
          <label>
            Pronouns
            <input
              value={pronouns}
              maxLength={40}
              placeholder="e.g. they/them"
              onChange={e => setPronouns(e.target.value)}
            />
          </label>
          <label>
            About Me
            <textarea
              value={bio}
              maxLength={190}
              placeholder="Tell everyone a little about yourself"
              rows={3}
              onChange={e => setBio(e.target.value)}
            />
            <div className="char-counter">{bioRemaining} characters remaining</div>
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

// Small helper for any consumer that needs to compute the anchor rect from an event
export function rectFromEvent(e: React.MouseEvent): DOMRect {
  const target = e.currentTarget as HTMLElement;
  return target.getBoundingClientRect();
}

// Silence unused import warning
void useMemo;
