// ─────────────────────────────────────────────────────────────────────────────
// Omnia — Discord clone on SpacetimeDB  (Milestone 3)
// ─────────────────────────────────────────────────────────────────────────────
import { schema, t, table, SenderError } from 'spacetimedb/server';

// ============================================================================
// TABLES
// ============================================================================

const user = table(
  { name: 'user', public: true },
  {
    identity: t.identity().primaryKey(),
    name: t.string().optional(),
    avatarColor: t.string(),
    bio: t.string(),        // profile bio, '' = empty
    pronouns: t.string(),   // profile pronouns, '' = empty
    status: t.string(),     // 'online' | 'idle' | 'dnd' | 'invisible'
    online: t.bool(),
    createdAt: t.timestamp(),
    lastSeen: t.timestamp(),
  }
);

const server = table(
  { name: 'server', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    name: t.string(),
    description: t.string(),
    ownerId: t.identity(),
    isPublic: t.bool(),
    createdAt: t.timestamp(),
    // Appended fields — keep at the end so additive migrations succeed
    iconUrl: t.string().default('none'),             // 'none' = fallback to initial letter
    bannerColor: t.string().default('#5865f2'),      // default blurple banner
    traits: t.string().default('none'),              // 'none' = no traits
  }
);

const channel = table(
  {
    name: 'channel',
    public: true,
    indexes: [
      {
        accessor: 'byServerId',
        name: 'channel_server_id',
        algorithm: 'btree',
        columns: ['serverId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    serverId: t.u64(),
    name: t.string(),
    topic: t.string(),
    position: t.i32(),
    categoryId: t.u64(),        // 0n = uncategorized
    slowmodeSeconds: t.i32(),   // 0 = no slowmode (max 21600 = 6h)
    lastMessageId: t.u64(),     // 0n = no messages yet
    createdAt: t.timestamp(),
  }
);

const category = table(
  {
    name: 'category',
    public: true,
    indexes: [
      {
        accessor: 'byServerId',
        name: 'category_server_id',
        algorithm: 'btree',
        columns: ['serverId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    serverId: t.u64(),
    name: t.string(),
    position: t.i32(),
  }
);

const rate_limit = table(
  { name: 'rate_limit', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    key: t.string().unique(), // `${userHex}_${channelId}`
    userIdentity: t.identity(),
    channelId: t.u64(),
    lastMessageAt: t.timestamp(),
  }
);

const server_member = table(
  {
    name: 'server_member',
    public: true,
    indexes: [
      {
        accessor: 'byServerId',
        name: 'member_server_id',
        algorithm: 'btree',
        columns: ['serverId'],
      },
      {
        accessor: 'byUserIdentity',
        name: 'member_user_identity',
        algorithm: 'btree',
        columns: ['userIdentity'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    serverId: t.u64(),
    userIdentity: t.identity(),
    nickname: t.string().optional(),
    role: t.string(), // 'owner' | 'admin' | 'mod' | 'member'
    joinedAt: t.timestamp(),
  }
);

const invite = table(
  { name: 'invite', public: true },
  {
    id: t.u64().primaryKey().autoInc(),
    code: t.string().unique(), // accessor: 'code', find by ctx.db.invite.code.find(code)
    serverId: t.u64(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
    expiresAt: t.u64(), // micros since unix epoch; 0n = never
    maxUses: t.i32(), // 0 = unlimited
    usesCount: t.i32(),
  }
);

const message = table(
  {
    name: 'message',
    public: true,
    indexes: [
      {
        accessor: 'byChannelId',
        name: 'message_channel_id',
        algorithm: 'btree',
        columns: ['channelId'],
      },
      {
        accessor: 'byThreadId',
        name: 'message_thread_id',
        algorithm: 'btree',
        columns: ['threadId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    channelId: t.u64(),
    threadId: t.u64(),      // 0n = top-level channel message
    replyToId: t.u64(),     // 0n = no reply
    authorId: t.identity(),
    text: t.string(),
    attachmentUrl: t.string(), // '' = no attachment
    pinned: t.bool(),
    sent: t.timestamp(),
    editedAt: t.timestamp().optional(),
  }
);

const thread = table(
  {
    name: 'thread',
    public: true,
    indexes: [
      {
        accessor: 'byChannelId',
        name: 'thread_channel_id',
        algorithm: 'btree',
        columns: ['channelId'],
      },
      {
        accessor: 'byParentId',
        name: 'thread_parent_id',
        algorithm: 'btree',
        columns: ['parentMessageId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    channelId: t.u64(),
    parentMessageId: t.u64(),
    name: t.string(),
    createdBy: t.identity(),
    createdAt: t.timestamp(),
  }
);

const reaction = table(
  {
    name: 'reaction',
    public: true,
    indexes: [
      {
        accessor: 'byMessageId',
        name: 'reaction_message_id',
        algorithm: 'btree',
        columns: ['messageId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    messageId: t.u64(),
    emoji: t.string(),
    userIdentity: t.identity(),
    reactedAt: t.timestamp(),
  }
);

const typing = table(
  { name: 'typing', public: true },
  {
    userIdentity: t.identity().primaryKey(),
    channelId: t.u64(),
    startedAt: t.timestamp(),
  }
);

const read_state = table(
  {
    name: 'read_state',
    public: true,
    indexes: [
      {
        accessor: 'byUserIdentity',
        name: 'read_state_user_identity',
        algorithm: 'btree',
        columns: ['userIdentity'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    userIdentity: t.identity(),
    channelId: t.u64(),
    lastReadMessageId: t.u64(),
  }
);

// Super Admin — exclusive privilege to create new servers, modify the
// default community server, and manage server roles.
const super_admin = table(
  { name: 'super_admin', public: true },
  {
    userIdentity: t.identity().primaryKey(),
    grantedAt: t.timestamp(),
  }
);

// DEPRECATED — kept for backward compatibility with existing data.
// New code uses server_role + member_role with permission bitfields.
const special_chat_role = table(
  {
    name: 'special_chat_role',
    public: true,
    indexes: [
      {
        accessor: 'byServerId',
        name: 'special_chat_role_server_id',
        algorithm: 'btree',
        columns: ['serverId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    serverId: t.u64(),
    userIdentity: t.identity(),
    grantedAt: t.timestamp(),
  }
);

// Server Role — Discord-style custom role with a permission bitfield.
// Every server has at least one role named "@everyone" (isDefault = true)
// that is automatically assigned to every member on join.
const server_role = table(
  {
    name: 'server_role',
    public: true,
    indexes: [
      {
        accessor: 'byServerId',
        name: 'server_role_server_id',
        algorithm: 'btree',
        columns: ['serverId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    serverId: t.u64(),
    name: t.string(),
    color: t.string(),       // hex like '#5865f2' or '' for default
    position: t.i32(),       // ordering, higher = higher in hierarchy
    permissions: t.u64(),    // bitfield — see PERMISSIONS constants below
    isDefault: t.bool(),     // true for @everyone (cannot be deleted)
  }
);

// Member <-> Role junction.
const member_role = table(
  {
    name: 'member_role',
    public: true,
    indexes: [
      {
        accessor: 'byServerId',
        name: 'member_role_server_id',
        algorithm: 'btree',
        columns: ['serverId'],
      },
      {
        accessor: 'byRoleId',
        name: 'member_role_role_id',
        algorithm: 'btree',
        columns: ['roleId'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    serverId: t.u64(),
    userIdentity: t.identity(),
    roleId: t.u64(),
    assignedAt: t.timestamp(),
  }
);

// Per-user notifications (e.g. server invite from another member).
// Public so the client SDK can subscribe; clients must filter to their own identity.
const notification = table(
  {
    name: 'notification',
    public: true,
    indexes: [
      {
        accessor: 'byRecipient',
        name: 'notification_recipient',
        algorithm: 'btree',
        columns: ['recipientIdentity'],
      },
    ],
  },
  {
    id: t.u64().primaryKey().autoInc(),
    recipientIdentity: t.identity(),
    type: t.string(),        // 'server_invite'
    inviteCode: t.string(),  // code to pass to join_server
    serverId: t.u64(),
    serverName: t.string(),
    senderName: t.string(),
    createdAt: t.timestamp(),
  }
);

const spacetimedb = schema({
  user,
  server,
  channel,
  category,
  server_member,
  invite,
  message,
  thread,
  reaction,
  typing,
  read_state,
  rate_limit,
  super_admin,
  special_chat_role,
  server_role,
  member_role,
  notification,
});
export default spacetimedb;

// ============================================================================
// HELPERS
// ============================================================================

const AVATAR_PALETTE = [
  '#5865F2', '#57F287', '#FEE75C', '#EB459E',
  '#ED4245', '#9B59B6', '#1ABC9C', '#E67E22',
];

function hashColor(hex: string): string {
  let h = 5381;
  for (let i = 0; i < hex.length; i++) h = ((h << 5) + h + hex.charCodeAt(i)) >>> 0;
  return AVATAR_PALETTE[h % AVATAR_PALETTE.length];
}

function normalizeChannelName(raw: string): string {
  return raw.trim().toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
}

// Deterministic invite code: djb2 over "micros:serverId:senderHex"
function generateInviteCode(micros: bigint, serverId: bigint, senderHex: string): string {
  const input = `${micros}:${serverId}:${senderHex}`;
  let h = 5381n;
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5n) + h + BigInt(input.charCodeAt(i))) & 0xFFFFFFFFn;
  }
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  let n = h;
  for (let i = 0; i < 8; i++) {
    const len = BigInt(chars.length);
    code = chars[Number(n % len)] + code;
    n = n / len;
  }
  return code;
}

// Return member row for ctx.sender in a server, or undefined
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMember(ctx: any, serverId: bigint): any {
  for (const m of ctx.db.server_member.byServerId.filter(serverId)) {
    if ((m.userIdentity as { toHexString(): string }).toHexString() === (ctx.sender as { toHexString(): string }).toHexString()) return m;
  }
  return undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireMember(ctx: any, serverId: bigint): any {
  const m = getMember(ctx, serverId);
  if (!m) throw new SenderError('You are not a member of this server');
  return m;
}

function isPrivileged(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

// The default community server is the first one created by `init` (auto-inc
// starts at 1). It is locked down — cannot be deleted or left by any user,
// and the client hides its admin dropdown entirely.
const DEFAULT_SERVER_ID = 1n;

function isDefaultServer(serverId: bigint): boolean {
  return serverId === DEFAULT_SERVER_ID;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isSuperAdmin(ctx: any, identity: { toHexString(): string }): boolean {
  const row = ctx.db.super_admin.userIdentity.find(identity);
  return row !== undefined;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function hasSpecialRole(ctx: any, serverId: bigint, identity: { toHexString(): string }): boolean {
  for (const r of ctx.db.special_chat_role.byServerId.filter(serverId)) {
    if ((r.userIdentity as { toHexString(): string }).toHexString() === identity.toHexString()) {
      return true;
    }
  }
  return false;
}

// ============================================================================
// PERMISSION SYSTEM (Discord-style bitfield)
// ============================================================================

const PERM_VIEW_CHANNELS   = 1n;
const PERM_SEND_MESSAGES   = 2n;
const PERM_MANAGE_MESSAGES = 4n;
const PERM_MANAGE_CHANNELS = 8n;
const PERM_KICK_MEMBERS    = 16n;
const PERM_BAN_MEMBERS     = 32n;
const PERM_MANAGE_ROLES    = 64n;
const PERM_MANAGE_SERVER   = 128n;
const PERM_CREATE_INVITE   = 256n;
const PERM_ADD_REACTIONS   = 512n;
const PERM_ADMINISTRATOR   = 1024n; // bypass all permission checks

// Default @everyone permissions for a brand new server: basic interaction
const DEFAULT_EVERYONE_PERMS =
  PERM_VIEW_CHANNELS |
  PERM_SEND_MESSAGES |
  PERM_ADD_REACTIONS |
  PERM_CREATE_INVITE;

// @everyone permissions on the locked default community server: read-only
const LOCKED_EVERYONE_PERMS = PERM_VIEW_CHANNELS | PERM_ADD_REACTIONS;

// Compute the union of permission bits across all roles assigned to a
// member in a given server. Returns 0n if the member has no roles or
// the server has no roles defined (fresh install / legacy data).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMemberPermissions(
  ctx: any,
  serverId: bigint,
  identity: { toHexString(): string }
): bigint {
  const hexStr = identity.toHexString();

  // Collect role IDs assigned to this user in this server
  const roleIds: bigint[] = [];
  for (const mr of ctx.db.member_role.byServerId.filter(serverId)) {
    if ((mr.userIdentity as { toHexString(): string }).toHexString() === hexStr) {
      roleIds.push(mr.roleId as bigint);
    }
  }

  // OR permissions from each role
  let perms = 0n;
  for (const r of ctx.db.server_role.byServerId.filter(serverId)) {
    if (roleIds.includes(r.id as bigint)) {
      perms = perms | (r.permissions as bigint);
    }
  }
  return perms;
}

function hasPerm(perms: bigint, flag: bigint): boolean {
  if ((perms & PERM_ADMINISTRATOR) !== 0n) return true;
  return (perms & flag) !== 0n;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function ensureDefaultRole(ctx: any, serverId: bigint, lockedDefault: boolean): bigint {
  // Returns the id of the @everyone role for this server, creating it if missing.
  for (const r of ctx.db.server_role.byServerId.filter(serverId)) {
    if (r.isDefault === true) return r.id as bigint;
  }
  const perms = lockedDefault ? LOCKED_EVERYONE_PERMS : DEFAULT_EVERYONE_PERMS;
  const row = ctx.db.server_role.insert({
    id: 0n,
    serverId,
    name: '@everyone',
    color: '',
    position: 0,
    permissions: perms,
    isDefault: true,
  });
  return row.id as bigint;
}

// ============================================================================
// USER REDUCERS
// ============================================================================

export const set_name = spacetimedb.reducer(
  { name: t.string() },
  (ctx, { name }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new SenderError('Name must not be empty');
    if (trimmed.length > 32) throw new SenderError('Name must be 32 chars or fewer');
    const u = ctx.db.user.identity.find(ctx.sender);
    if (!u) throw new SenderError('Unknown user');
    ctx.db.user.identity.update({ ...u, name: trimmed });
  }
);

export const set_status = spacetimedb.reducer(
  { status: t.string() },
  (ctx, { status }) => {
    if (!['online', 'idle', 'dnd', 'invisible'].includes(status)) {
      throw new SenderError('Invalid status');
    }
    const u = ctx.db.user.identity.find(ctx.sender);
    if (!u) throw new SenderError('Unknown user');
    ctx.db.user.identity.update({ ...u, status });
  }
);

export const set_profile = spacetimedb.reducer(
  { bio: t.string(), pronouns: t.string() },
  (ctx, { bio, pronouns }) => {
    if (bio.length > 190) throw new SenderError('Bio must be 190 characters or fewer');
    if (pronouns.length > 40) throw new SenderError('Pronouns must be 40 characters or fewer');
    const u = ctx.db.user.identity.find(ctx.sender);
    if (!u) throw new SenderError('Unknown user');
    ctx.db.user.identity.update({
      ...u,
      bio: bio.trim(),
      pronouns: pronouns.trim(),
    });
  }
);

// ============================================================================
// SERVER REDUCERS
// ============================================================================

export const create_server = spacetimedb.reducer(
  { name: t.string(), description: t.string(), isPublic: t.bool() },
  (ctx, { name, description, isPublic }) => {
    if (!isSuperAdmin(ctx, ctx.sender)) {
      throw new SenderError('Only Super Admins may create new servers');
    }
    const trimmed = name.trim();
    if (!trimmed) throw new SenderError('Server name is required');
    if (trimmed.length > 48) throw new SenderError('Server name too long');
    const row = ctx.db.server.insert({
      id: 0n,
      name: trimmed,
      description: description.slice(0, 256),
      ownerId: ctx.sender,
      isPublic,
      iconUrl: '',
      bannerColor: '',
      traits: '',
      createdAt: ctx.timestamp,
    });
    // Owner is first member
    ctx.db.server_member.insert({
      id: 0n,
      serverId: row.id,
      userIdentity: ctx.sender,
      nickname: undefined,
      role: 'owner',
      joinedAt: ctx.timestamp,
    });
    // Seed a #general channel
    ctx.db.channel.insert({
      id: 0n,
      serverId: row.id,
      name: 'general',
      topic: 'Start the conversation.',
      position: 0,
      categoryId: 0n,
      slowmodeSeconds: 0,
      lastMessageId: 0n,
      createdAt: ctx.timestamp,
    });
    // Seed @everyone role with default interaction permissions
    const everyoneRoleId = ensureDefaultRole(ctx, row.id, false);
    // Assign @everyone to the owner so their roles aren't empty
    ctx.db.member_role.insert({
      id: 0n,
      serverId: row.id,
      userIdentity: ctx.sender,
      roleId: everyoneRoleId,
      assignedAt: ctx.timestamp,
    });
  }
);

export const leave_server = spacetimedb.reducer(
  { serverId: t.u64() },
  (ctx, { serverId }) => {
    if (isDefaultServer(serverId)) {
      throw new SenderError('This is the default community server and cannot be left.');
    }
    const svr = ctx.db.server.id.find(serverId);
    if (!svr) throw new SenderError('Server not found');
    if (svr.ownerId.toHexString() === ctx.sender.toHexString()) {
      throw new SenderError('Server owner cannot leave — delete the server or transfer ownership');
    }
    for (const m of ctx.db.server_member.byServerId.filter(serverId)) {
      if (m.userIdentity.toHexString() === ctx.sender.toHexString()) {
        ctx.db.server_member.id.delete(m.id);
        return;
      }
    }
    throw new SenderError('Not a member of this server');
  }
);

export const update_server = spacetimedb.reducer(
  {
    serverId: t.u64(),
    name: t.string(),
    description: t.string(),
    isPublic: t.bool(),
    iconUrl: t.string(),
    bannerColor: t.string(),
    traits: t.string(),
  },
  (ctx, { serverId, name, description, isPublic, iconUrl, bannerColor, traits }) => {
    const svr = ctx.db.server.id.find(serverId);
    if (!svr) throw new SenderError('Server not found');
    // The default community server can only be modified by Super Admins
    if (isDefaultServer(serverId)) {
      if (!isSuperAdmin(ctx, ctx.sender)) {
        throw new SenderError('Only Super Admins may modify the default community server');
      }
    } else {
      const member = requireMember(ctx, serverId);
      if (!isPrivileged(member.role)) {
        throw new SenderError('Only admins and the owner may update server settings');
      }
    }
    const trimmed = name.trim();
    if (!trimmed) throw new SenderError('Server name is required');
    if (trimmed.length > 48) throw new SenderError('Server name too long');
    if (iconUrl.length > 512) throw new SenderError('Icon URL too long');
    if (bannerColor.length > 16) throw new SenderError('Banner color invalid');
    if (traits.length > 256) throw new SenderError('Traits too long');
    ctx.db.server.id.update({
      ...svr,
      name: trimmed,
      description: description.slice(0, 256),
      isPublic,
      iconUrl: iconUrl.trim(),
      bannerColor: bannerColor.trim(),
      traits: traits.trim(),
    });
  }
);

export const delete_server = spacetimedb.reducer(
  { serverId: t.u64() },
  (ctx, { serverId }) => {
    if (isDefaultServer(serverId)) {
      throw new SenderError('This is the default community server and cannot be deleted.');
    }
    const svr = ctx.db.server.id.find(serverId);
    if (!svr) throw new SenderError('Server not found');
    if (svr.ownerId.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only the owner can delete the server');
    }
    // Cascade: per-channel messages, reactions, threads, then the channel
    for (const c of ctx.db.channel.byServerId.filter(serverId)) {
      for (const m of ctx.db.message.byChannelId.filter(c.id)) {
        for (const r of ctx.db.reaction.byMessageId.filter(m.id)) {
          ctx.db.reaction.id.delete(r.id);
        }
        ctx.db.message.id.delete(m.id);
      }
      for (const th of ctx.db.thread.byChannelId.filter(c.id)) {
        ctx.db.thread.id.delete(th.id);
      }
      ctx.db.channel.id.delete(c.id);
    }
    // Categories
    for (const cat of ctx.db.category.byServerId.filter(serverId)) {
      ctx.db.category.id.delete(cat.id);
    }
    // Members
    for (const mem of ctx.db.server_member.byServerId.filter(serverId)) {
      ctx.db.server_member.id.delete(mem.id);
    }
    // Invites (no server-id index; scan)
    for (const inv of ctx.db.invite.iter()) {
      if (inv.serverId === serverId) {
        ctx.db.invite.id.delete(inv.id);
      }
    }
    ctx.db.server.id.delete(serverId);
  }
);

export const kick_member = spacetimedb.reducer(
  { serverId: t.u64(), userIdentity: t.identity() },
  (ctx, { serverId, userIdentity }) => {
    const svr = ctx.db.server.id.find(serverId);
    if (!svr) throw new SenderError('Server not found');
    const me = requireMember(ctx, serverId);
    if (!isPrivileged(me.role)) {
      throw new SenderError('Only admins and the owner may kick members');
    }
    if (svr.ownerId.toHexString() === userIdentity.toHexString()) {
      throw new SenderError('Cannot kick the server owner');
    }
    if (userIdentity.toHexString() === ctx.sender.toHexString()) {
      throw new SenderError('Cannot kick yourself — use Leave Server instead');
    }
    for (const m of ctx.db.server_member.byServerId.filter(serverId)) {
      if (m.userIdentity.toHexString() === userIdentity.toHexString()) {
        ctx.db.server_member.id.delete(m.id);
        return;
      }
    }
    throw new SenderError('Member not found in this server');
  }
);

export const set_member_role = spacetimedb.reducer(
  { serverId: t.u64(), userIdentity: t.identity(), role: t.string() },
  (ctx, { serverId, userIdentity, role }) => {
    if (!['admin', 'mod', 'member'].includes(role)) {
      throw new SenderError('Invalid role — must be admin, mod, or member');
    }
    const svr = ctx.db.server.id.find(serverId);
    if (!svr) throw new SenderError('Server not found');
    if (svr.ownerId.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError('Only the owner may change member roles');
    }
    if (svr.ownerId.toHexString() === userIdentity.toHexString()) {
      throw new SenderError("Cannot change the owner's role");
    }
    for (const m of ctx.db.server_member.byServerId.filter(serverId)) {
      if (m.userIdentity.toHexString() === userIdentity.toHexString()) {
        ctx.db.server_member.id.update({ ...m, role });
        return;
      }
    }
    throw new SenderError('Member not found in this server');
  }
);

export const delete_invite = spacetimedb.reducer(
  { inviteId: t.u64() },
  (ctx, { inviteId }) => {
    const inv = ctx.db.invite.id.find(inviteId);
    if (!inv) throw new SenderError('Invite not found');
    const member = requireMember(ctx, inv.serverId);
    if (!isPrivileged(member.role)) {
      throw new SenderError('Only admins and the owner may revoke invites');
    }
    ctx.db.invite.id.delete(inviteId);
  }
);

// ============================================================================
// SUPER ADMIN / SPECIAL ROLE REDUCERS
// ============================================================================

export const grant_super_admin = spacetimedb.reducer(
  { userIdentity: t.identity() },
  (ctx, { userIdentity }) => {
    if (!isSuperAdmin(ctx, ctx.sender)) {
      throw new SenderError('Only Super Admins may grant Super Admin status');
    }
    const existing = ctx.db.super_admin.userIdentity.find(userIdentity);
    if (existing) return;
    ctx.db.super_admin.insert({
      userIdentity,
      grantedAt: ctx.timestamp,
    });
  }
);

export const revoke_super_admin = spacetimedb.reducer(
  { userIdentity: t.identity() },
  (ctx, { userIdentity }) => {
    if (!isSuperAdmin(ctx, ctx.sender)) {
      throw new SenderError('Only Super Admins may revoke Super Admin status');
    }
    if (userIdentity.toHexString() === ctx.sender.toHexString()) {
      throw new SenderError('Cannot revoke your own Super Admin status');
    }
    ctx.db.super_admin.userIdentity.delete(userIdentity);
  }
);

export const grant_special_role = spacetimedb.reducer(
  { serverId: t.u64(), userIdentity: t.identity() },
  (ctx, { serverId, userIdentity }) => {
    if (!isSuperAdmin(ctx, ctx.sender)) {
      throw new SenderError('Only Super Admins may grant the Special Role');
    }
    // Idempotent: no-op if already granted
    for (const r of ctx.db.special_chat_role.byServerId.filter(serverId)) {
      if (r.userIdentity.toHexString() === userIdentity.toHexString()) return;
    }
    ctx.db.special_chat_role.insert({
      id: 0n,
      serverId,
      userIdentity,
      grantedAt: ctx.timestamp,
    });
  }
);

export const revoke_special_role = spacetimedb.reducer(
  { serverId: t.u64(), userIdentity: t.identity() },
  (ctx, { serverId, userIdentity }) => {
    if (!isSuperAdmin(ctx, ctx.sender)) {
      throw new SenderError('Only Super Admins may revoke the Special Role');
    }
    for (const r of ctx.db.special_chat_role.byServerId.filter(serverId)) {
      if (r.userIdentity.toHexString() === userIdentity.toHexString()) {
        ctx.db.special_chat_role.id.delete(r.id);
        return;
      }
    }
  }
);

// ============================================================================
// ROLE MANAGEMENT REDUCERS (Discord-style)
// ============================================================================

function requireRolePermission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctx: any,
  serverId: bigint
) {
  // Super admins bypass, and for the default community server they're the
  // only ones who can manage roles.
  if (isSuperAdmin(ctx, ctx.sender)) return;
  if (isDefaultServer(serverId)) {
    throw new SenderError('Only Super Admins may manage roles on the default community server');
  }
  const member = requireMember(ctx, serverId);
  if (member.role === 'owner') return;
  const perms = getMemberPermissions(ctx, serverId, ctx.sender);
  if (!hasPerm(perms, PERM_MANAGE_ROLES)) {
    throw new SenderError('You do not have permission to manage roles in this server');
  }
}

export const create_role = spacetimedb.reducer(
  {
    serverId: t.u64(),
    name: t.string(),
    color: t.string(),
    permissions: t.u64(),
  },
  (ctx, { serverId, name, color, permissions }) => {
    requireRolePermission(ctx, serverId);
    const trimmed = name.trim();
    if (!trimmed) throw new SenderError('Role name is required');
    if (trimmed.length > 48) throw new SenderError('Role name too long');
    // Compute next position (max + 1)
    let maxPos = 0;
    for (const r of ctx.db.server_role.byServerId.filter(serverId)) {
      if (r.position > maxPos) maxPos = r.position;
    }
    ctx.db.server_role.insert({
      id: 0n,
      serverId,
      name: trimmed,
      color: color.slice(0, 16),
      position: maxPos + 1,
      permissions,
      isDefault: false,
    });
  }
);

export const update_role = spacetimedb.reducer(
  {
    roleId: t.u64(),
    name: t.string(),
    color: t.string(),
    permissions: t.u64(),
  },
  (ctx, { roleId, name, color, permissions }) => {
    const role = ctx.db.server_role.id.find(roleId);
    if (!role) throw new SenderError('Role not found');
    requireRolePermission(ctx, role.serverId);
    const trimmed = name.trim();
    if (!trimmed) throw new SenderError('Role name is required');
    if (trimmed.length > 48) throw new SenderError('Role name too long');
    // @everyone name cannot be changed
    const finalName = role.isDefault ? '@everyone' : trimmed;
    ctx.db.server_role.id.update({
      ...role,
      name: finalName,
      color: color.slice(0, 16),
      permissions,
    });
  }
);

export const delete_role = spacetimedb.reducer(
  { roleId: t.u64() },
  (ctx, { roleId }) => {
    const role = ctx.db.server_role.id.find(roleId);
    if (!role) throw new SenderError('Role not found');
    if (role.isDefault) {
      throw new SenderError('Cannot delete the @everyone role');
    }
    requireRolePermission(ctx, role.serverId);
    // Remove all member_role rows that reference this role
    for (const mr of ctx.db.member_role.byRoleId.filter(roleId)) {
      ctx.db.member_role.id.delete(mr.id);
    }
    ctx.db.server_role.id.delete(roleId);
  }
);

export const assign_role = spacetimedb.reducer(
  { roleId: t.u64(), userIdentity: t.identity() },
  (ctx, { roleId, userIdentity }) => {
    const role = ctx.db.server_role.id.find(roleId);
    if (!role) throw new SenderError('Role not found');
    requireRolePermission(ctx, role.serverId);
    // Idempotent
    for (const mr of ctx.db.member_role.byServerId.filter(role.serverId)) {
      if (
        mr.roleId === roleId &&
        mr.userIdentity.toHexString() === userIdentity.toHexString()
      ) {
        return;
      }
    }
    ctx.db.member_role.insert({
      id: 0n,
      serverId: role.serverId,
      userIdentity,
      roleId,
      assignedAt: ctx.timestamp,
    });
  }
);

export const unassign_role = spacetimedb.reducer(
  { roleId: t.u64(), userIdentity: t.identity() },
  (ctx, { roleId, userIdentity }) => {
    const role = ctx.db.server_role.id.find(roleId);
    if (!role) throw new SenderError('Role not found');
    if (role.isDefault) {
      throw new SenderError('Cannot unassign the @everyone role');
    }
    requireRolePermission(ctx, role.serverId);
    for (const mr of ctx.db.member_role.byServerId.filter(role.serverId)) {
      if (
        mr.roleId === roleId &&
        mr.userIdentity.toHexString() === userIdentity.toHexString()
      ) {
        ctx.db.member_role.id.delete(mr.id);
        return;
      }
    }
  }
);

// ============================================================================
// INVITE REDUCERS
// ============================================================================

export const create_invite = spacetimedb.reducer(
  { serverId: t.u64(), maxUses: t.i32(), expiresInHours: t.i32() },
  (ctx, { serverId, maxUses, expiresInHours }) => {
    requireMember(ctx, serverId);
    const code = generateInviteCode(
      ctx.timestamp.microsSinceUnixEpoch,
      serverId,
      ctx.sender.toHexString()
    );
    const expiresAt =
      expiresInHours > 0
        ? ctx.timestamp.microsSinceUnixEpoch + BigInt(expiresInHours) * 3_600_000_000n
        : 0n;
    ctx.db.invite.insert({
      id: 0n,
      code,
      serverId,
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
      expiresAt,
      maxUses,
      usesCount: 0,
    });
  }
);

export const join_server = spacetimedb.reducer(
  { inviteCode: t.string() },
  (ctx, { inviteCode }) => {
    const inv = ctx.db.invite.code.find(inviteCode);
    if (!inv) throw new SenderError('Invalid invite code');

    // Check expiry
    if (inv.expiresAt !== 0n && ctx.timestamp.microsSinceUnixEpoch > inv.expiresAt) {
      throw new SenderError('This invite has expired');
    }
    // Check max uses
    if (inv.maxUses > 0 && inv.usesCount >= inv.maxUses) {
      throw new SenderError('This invite has reached its maximum uses');
    }
    // Check not already a member
    if (getMember(ctx, inv.serverId)) {
      throw new SenderError('You are already a member of this server');
    }

    ctx.db.server_member.insert({
      id: 0n,
      serverId: inv.serverId,
      userIdentity: ctx.sender,
      nickname: undefined,
      role: 'member',
      joinedAt: ctx.timestamp,
    });
    // Ensure @everyone exists, then assign it to the new member
    const roleId = ensureDefaultRole(
      ctx,
      inv.serverId,
      isDefaultServer(inv.serverId)
    );
    ctx.db.member_role.insert({
      id: 0n,
      serverId: inv.serverId,
      userIdentity: ctx.sender,
      roleId,
      assignedAt: ctx.timestamp,
    });
    // Increment uses
    ctx.db.invite.id.update({ ...inv, usesCount: inv.usesCount + 1 });
  }
);

// ============================================================================
// CHANNEL REDUCERS
// ============================================================================

export const create_channel = spacetimedb.reducer(
  { serverId: t.u64(), name: t.string(), topic: t.string() },
  (ctx, { serverId, name, topic }) => {
    const normalized = normalizeChannelName(name);
    if (!normalized) throw new SenderError('Channel name is required');
    requireMember(ctx, serverId);
    let maxPos = -1;
    for (const c of ctx.db.channel.byServerId.filter(serverId)) {
      if (c.position > maxPos) maxPos = c.position;
    }
    ctx.db.channel.insert({
      id: 0n,
      serverId,
      name: normalized,
      topic: topic.slice(0, 256),
      position: maxPos + 1,
      categoryId: 0n,
      slowmodeSeconds: 0,
      lastMessageId: 0n,
      createdAt: ctx.timestamp,
    });
  }
);

export const delete_channel = spacetimedb.reducer(
  { channelId: t.u64() },
  (ctx, { channelId }) => {
    const chn = ctx.db.channel.id.find(channelId);
    if (!chn) throw new SenderError('Channel not found');
    const member = requireMember(ctx, chn.serverId);
    if (!isPrivileged(member.role)) {
      throw new SenderError('Only admins and the owner may delete channels');
    }
    for (const m of ctx.db.message.byChannelId.filter(channelId)) {
      ctx.db.message.id.delete(m.id);
    }
    for (const th of ctx.db.thread.byChannelId.filter(channelId)) {
      ctx.db.thread.id.delete(th.id);
    }
    ctx.db.channel.id.delete(channelId);
  }
);

// ============================================================================
// MESSAGE REDUCERS
// ============================================================================

export const send_message = spacetimedb.reducer(
  {
    channelId: t.u64(),
    threadId: t.u64(),
    replyToId: t.u64(),
    text: t.string(),
    attachmentUrl: t.string(),
  },
  (ctx, { channelId, threadId, replyToId, text, attachmentUrl }) => {
    const trimmed = text.trim();
    if (!trimmed && !attachmentUrl) throw new SenderError('Message cannot be empty');
    if (trimmed.length > 2000) throw new SenderError('Message too long (2000 char max)');

    const chn = ctx.db.channel.id.find(channelId);
    if (!chn) throw new SenderError('Channel not found');
    const senderMember = requireMember(ctx, chn.serverId);

    // Permission check: Super Admins, server owners, and users whose
    // combined roles include SEND_MESSAGES (or ADMINISTRATOR) may post.
    // The server owner always has full access.
    if (!isSuperAdmin(ctx, ctx.sender) && senderMember.role !== 'owner') {
      const perms = getMemberPermissions(ctx, chn.serverId, ctx.sender);
      if (!hasPerm(perms, PERM_SEND_MESSAGES)) {
        throw new SenderError(
          "You don't have permission to send messages in this channel"
        );
      }
    }

    if (threadId !== 0n) {
      const th = ctx.db.thread.id.find(threadId);
      if (!th) throw new SenderError('Thread not found');
      if (th.channelId !== channelId) throw new SenderError('Thread does not belong to this channel');
    }
    if (replyToId !== 0n) {
      const parent = ctx.db.message.id.find(replyToId);
      if (!parent) throw new SenderError('Replied-to message not found');
    }

    // Slowmode enforcement (top-level channel messages only; thread replies bypass slowmode)
    const rateKey = `${ctx.sender.toHexString()}_${channelId}`;
    if (chn.slowmodeSeconds > 0 && threadId === 0n) {
      const rl = ctx.db.rate_limit.key.find(rateKey);
      if (rl) {
        const elapsedMicros =
          ctx.timestamp.microsSinceUnixEpoch - rl.lastMessageAt.microsSinceUnixEpoch;
        const requiredMicros = BigInt(chn.slowmodeSeconds) * 1_000_000n;
        if (elapsedMicros < requiredMicros) {
          const remaining =
            Number((requiredMicros - elapsedMicros) / 1_000_000n) + 1;
          throw new SenderError(
            `Slowmode active — wait ${remaining}s before posting again`
          );
        }
      }
    }

    const row = ctx.db.message.insert({
      id: 0n,
      channelId,
      threadId,
      replyToId,
      authorId: ctx.sender,
      text: trimmed,
      attachmentUrl,
      pinned: false,
      sent: ctx.timestamp,
      editedAt: undefined,
    });

    // Update channel's lastMessageId
    ctx.db.channel.id.update({ ...chn, lastMessageId: row.id });

    // Upsert rate_limit entry for slowmode tracking
    if (chn.slowmodeSeconds > 0 && threadId === 0n) {
      const rl = ctx.db.rate_limit.key.find(rateKey);
      if (rl) {
        ctx.db.rate_limit.id.update({ ...rl, lastMessageAt: ctx.timestamp });
      } else {
        ctx.db.rate_limit.insert({
          id: 0n,
          key: rateKey,
          userIdentity: ctx.sender,
          channelId,
          lastMessageAt: ctx.timestamp,
        });
      }
    }

    // Clear typing indicator for this user in this channel
    const typingEntry = ctx.db.typing.userIdentity.find(ctx.sender);
    if (typingEntry && typingEntry.channelId === channelId) {
      ctx.db.typing.userIdentity.delete(ctx.sender);
    }
  }
);

export const edit_message = spacetimedb.reducer(
  { messageId: t.u64(), text: t.string() },
  (ctx, { messageId, text }) => {
    const trimmed = text.trim();
    if (!trimmed) throw new SenderError('Message cannot be empty');
    const msg = ctx.db.message.id.find(messageId);
    if (!msg) throw new SenderError('Message not found');
    if (msg.authorId.toHexString() !== ctx.sender.toHexString()) {
      throw new SenderError("Cannot edit another user's message");
    }
    ctx.db.message.id.update({ ...msg, text: trimmed, editedAt: ctx.timestamp });
  }
);

export const delete_message = spacetimedb.reducer(
  { messageId: t.u64() },
  (ctx, { messageId }) => {
    const msg = ctx.db.message.id.find(messageId);
    if (!msg) throw new SenderError('Message not found');
    const chn = ctx.db.channel.id.find(msg.channelId);
    let canDelete = msg.authorId.toHexString() === ctx.sender.toHexString();
    if (!canDelete && chn) {
      const member = getMember(ctx, chn.serverId);
      canDelete = member !== undefined && isPrivileged(member.role);
    }
    if (!canDelete) throw new SenderError("Cannot delete this message");
    ctx.db.message.id.delete(messageId);
  }
);

// ============================================================================
// THREAD REDUCERS
// ============================================================================

export const create_thread = spacetimedb.reducer(
  { parentMessageId: t.u64(), name: t.string() },
  (ctx, { parentMessageId, name }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new SenderError('Thread name is required');
    const parent = ctx.db.message.id.find(parentMessageId);
    if (!parent) throw new SenderError('Parent message not found');
    requireMember(ctx, ctx.db.channel.id.find(parent.channelId)!.serverId);
    const existing = [...ctx.db.thread.byParentId.filter(parentMessageId)];
    if (existing.length > 0) throw new SenderError('Thread already exists for this message');
    ctx.db.thread.insert({
      id: 0n,
      channelId: parent.channelId,
      parentMessageId,
      name: trimmed.slice(0, 64),
      createdBy: ctx.sender,
      createdAt: ctx.timestamp,
    });
  }
);

// ============================================================================
// REACTION REDUCERS
// ============================================================================

export const toggle_reaction = spacetimedb.reducer(
  { messageId: t.u64(), emoji: t.string() },
  (ctx, { messageId, emoji }) => {
    const msg = ctx.db.message.id.find(messageId);
    if (!msg) throw new SenderError('Message not found');
    const chn = ctx.db.channel.id.find(msg.channelId);
    if (chn) requireMember(ctx, chn.serverId);
    for (const r of ctx.db.reaction.byMessageId.filter(messageId)) {
      if (r.emoji === emoji && r.userIdentity.toHexString() === ctx.sender.toHexString()) {
        ctx.db.reaction.id.delete(r.id);
        return;
      }
    }
    ctx.db.reaction.insert({
      id: 0n,
      messageId,
      emoji,
      userIdentity: ctx.sender,
      reactedAt: ctx.timestamp,
    });
  }
);

// ============================================================================
// TYPING REDUCER
// ============================================================================

export const set_typing = spacetimedb.reducer(
  { channelId: t.u64() },
  (ctx, { channelId }) => {
    const chn = ctx.db.channel.id.find(channelId);
    if (!chn) throw new SenderError('Channel not found');
    requireMember(ctx, chn.serverId);
    const existing = ctx.db.typing.userIdentity.find(ctx.sender);
    if (existing) {
      ctx.db.typing.userIdentity.update({ ...existing, channelId, startedAt: ctx.timestamp });
    } else {
      ctx.db.typing.insert({ userIdentity: ctx.sender, channelId, startedAt: ctx.timestamp });
    }
  }
);

// ============================================================================
// READ STATE REDUCER
// ============================================================================

export const update_read_state = spacetimedb.reducer(
  { channelId: t.u64(), lastMessageId: t.u64() },
  (ctx, { channelId, lastMessageId }) => {
    for (const rs of ctx.db.read_state.byUserIdentity.filter(ctx.sender)) {
      if (rs.channelId === channelId) {
        if (rs.lastReadMessageId < lastMessageId) {
          ctx.db.read_state.id.update({ ...rs, lastReadMessageId: lastMessageId });
        }
        return;
      }
    }
    ctx.db.read_state.insert({
      id: 0n,
      userIdentity: ctx.sender,
      channelId,
      lastReadMessageId: lastMessageId,
    });
  }
);

// ============================================================================
// CATEGORY REDUCERS
// ============================================================================

export const create_category = spacetimedb.reducer(
  { serverId: t.u64(), name: t.string() },
  (ctx, { serverId, name }) => {
    const trimmed = name.trim();
    if (!trimmed) throw new SenderError('Category name required');
    if (trimmed.length > 48) throw new SenderError('Category name too long');
    const member = requireMember(ctx, serverId);
    if (!isPrivileged(member.role)) {
      throw new SenderError('Only admins and the owner may create categories');
    }
    let maxPos = -1;
    for (const c of ctx.db.category.byServerId.filter(serverId)) {
      if (c.position > maxPos) maxPos = c.position;
    }
    ctx.db.category.insert({
      id: 0n,
      serverId,
      name: trimmed,
      position: maxPos + 1,
    });
  }
);

export const delete_category = spacetimedb.reducer(
  { categoryId: t.u64() },
  (ctx, { categoryId }) => {
    const cat = ctx.db.category.id.find(categoryId);
    if (!cat) throw new SenderError('Category not found');
    const member = requireMember(ctx, cat.serverId);
    if (!isPrivileged(member.role)) {
      throw new SenderError('Only admins and the owner may delete categories');
    }
    // Move all child channels to uncategorized
    for (const c of ctx.db.channel.byServerId.filter(cat.serverId)) {
      if (c.categoryId === categoryId) {
        ctx.db.channel.id.update({ ...c, categoryId: 0n });
      }
    }
    ctx.db.category.id.delete(categoryId);
  }
);

export const move_channel = spacetimedb.reducer(
  { channelId: t.u64(), categoryId: t.u64() },
  (ctx, { channelId, categoryId }) => {
    const chn = ctx.db.channel.id.find(channelId);
    if (!chn) throw new SenderError('Channel not found');
    const member = requireMember(ctx, chn.serverId);
    if (!isPrivileged(member.role)) {
      throw new SenderError('Only admins and the owner may move channels');
    }
    if (categoryId !== 0n) {
      const cat = ctx.db.category.id.find(categoryId);
      if (!cat || cat.serverId !== chn.serverId) {
        throw new SenderError('Invalid category');
      }
    }
    ctx.db.channel.id.update({ ...chn, categoryId });
  }
);

export const update_channel = spacetimedb.reducer(
  { channelId: t.u64(), name: t.string(), topic: t.string() },
  (ctx, { channelId, name, topic }) => {
    const chn = ctx.db.channel.id.find(channelId);
    if (!chn) throw new SenderError('Channel not found');
    if (isDefaultServer(chn.serverId)) {
      if (!isSuperAdmin(ctx, ctx.sender)) {
        throw new SenderError('Only Super Admins may edit default server channels');
      }
    } else {
      const member = requireMember(ctx, chn.serverId);
      if (!isPrivileged(member.role)) {
        throw new SenderError('Only admins and the owner may edit channels');
      }
    }
    const normalized = normalizeChannelName(name);
    if (!normalized) throw new SenderError('Channel name is required');
    ctx.db.channel.id.update({ ...chn, name: normalized, topic: topic.slice(0, 256) });
  }
);

export const update_category = spacetimedb.reducer(
  { categoryId: t.u64(), name: t.string() },
  (ctx, { categoryId, name }) => {
    const cat = ctx.db.category.id.find(categoryId);
    if (!cat) throw new SenderError('Category not found');
    if (isDefaultServer(cat.serverId)) {
      if (!isSuperAdmin(ctx, ctx.sender)) {
        throw new SenderError('Only Super Admins may edit default server categories');
      }
    } else {
      const member = requireMember(ctx, cat.serverId);
      if (!isPrivileged(member.role)) {
        throw new SenderError('Only admins and the owner may edit categories');
      }
    }
    const trimmed = name.trim().toUpperCase();
    if (!trimmed) throw new SenderError('Category name required');
    if (trimmed.length > 48) throw new SenderError('Category name too long');
    ctx.db.category.id.update({ ...cat, name: trimmed });
  }
);

// ============================================================================
// NICKNAME REDUCER
// ============================================================================

export const set_nickname = spacetimedb.reducer(
  { serverId: t.u64(), nickname: t.string() },
  (ctx, { serverId, nickname }) => {
    const member = requireMember(ctx, serverId);
    const trimmed = nickname.trim();
    if (trimmed.length > 32) throw new SenderError('Nickname too long (32 max)');
    ctx.db.server_member.id.update({
      ...member,
      nickname: trimmed ? trimmed : undefined,
    });
  }
);

// ============================================================================
// PIN REDUCERS
// ============================================================================

export const pin_message = spacetimedb.reducer(
  { messageId: t.u64() },
  (ctx, { messageId }) => {
    const msg = ctx.db.message.id.find(messageId);
    if (!msg) throw new SenderError('Message not found');
    if (msg.threadId !== 0n) throw new SenderError('Cannot pin thread replies');
    const chn = ctx.db.channel.id.find(msg.channelId);
    if (!chn) throw new SenderError('Channel not found');
    requireMember(ctx, chn.serverId);
    if (msg.pinned) return;
    ctx.db.message.id.update({ ...msg, pinned: true });
  }
);

export const unpin_message = spacetimedb.reducer(
  { messageId: t.u64() },
  (ctx, { messageId }) => {
    const msg = ctx.db.message.id.find(messageId);
    if (!msg) throw new SenderError('Message not found');
    const chn = ctx.db.channel.id.find(msg.channelId);
    if (!chn) throw new SenderError('Channel not found');
    requireMember(ctx, chn.serverId);
    if (!msg.pinned) return;
    ctx.db.message.id.update({ ...msg, pinned: false });
  }
);

// ============================================================================
// SLOWMODE REDUCER
// ============================================================================

export const set_slowmode = spacetimedb.reducer(
  { channelId: t.u64(), seconds: t.i32() },
  (ctx, { channelId, seconds }) => {
    if (seconds < 0 || seconds > 21600) {
      throw new SenderError('Slowmode must be 0 to 21600 seconds');
    }
    const chn = ctx.db.channel.id.find(channelId);
    if (!chn) throw new SenderError('Channel not found');
    const member = requireMember(ctx, chn.serverId);
    if (!isPrivileged(member.role)) {
      throw new SenderError('Only admins and the owner may set slowmode');
    }
    ctx.db.channel.id.update({ ...chn, slowmodeSeconds: seconds });
  }
);

export const send_server_invite = spacetimedb.reducer(
  { targetIdentity: t.identity(), inviteCode: t.string() },
  (ctx, { targetIdentity, inviteCode }) => {
    const inv = ctx.db.invite.code.find(inviteCode);
    if (!inv) throw new SenderError('Invalid invite code');
    if (inv.expiresAt !== 0n && ctx.timestamp.microsSinceUnixEpoch > inv.expiresAt) {
      throw new SenderError('Invite has expired');
    }
    if (inv.maxUses > 0 && inv.usesCount >= inv.maxUses) {
      throw new SenderError('Invite has reached max uses');
    }
    const svr = ctx.db.server.id.find(inv.serverId);
    if (!svr) throw new SenderError('Server not found');
    // Silently no-op if the target is already a member
    for (const m of ctx.db.server_member.byServerId.filter(inv.serverId)) {
      if ((m.userIdentity as { toHexString(): string }).toHexString() ===
          (targetIdentity as { toHexString(): string }).toHexString()) return;
    }
    const sender = ctx.db.user.identity.find(ctx.sender);
    const senderName = (sender?.name as string | undefined) ?? 'Someone';
    ctx.db.notification.insert({
      id: 0n,
      recipientIdentity: targetIdentity,
      type: 'server_invite',
      inviteCode,
      serverId: inv.serverId,
      serverName: svr.name as string,
      senderName,
      createdAt: ctx.timestamp,
    });
  }
);

export const dismiss_notification = spacetimedb.reducer(
  { notificationId: t.u64() },
  (ctx, { notificationId }) => {
    const notif = ctx.db.notification.id.find(notificationId);
    if (!notif) return;
    if ((notif.recipientIdentity as { toHexString(): string }).toHexString() !==
        ctx.sender.toHexString()) {
      throw new SenderError('Not your notification');
    }
    ctx.db.notification.id.delete(notificationId);
  }
);

export const reseed_default_server = spacetimedb.reducer(ctx => {
  if (!isSuperAdmin(ctx, ctx.sender)) {
    throw new SenderError('Only Super Admins may reseed the default server');
  }
  const serverId = DEFAULT_SERVER_ID;
  // Wipe all existing channels (cascade messages, reactions, threads)
  for (const c of ctx.db.channel.byServerId.filter(serverId)) {
    for (const m of ctx.db.message.byChannelId.filter(c.id)) {
      for (const r of ctx.db.reaction.byMessageId.filter(m.id)) {
        ctx.db.reaction.id.delete(r.id);
      }
      ctx.db.message.id.delete(m.id);
    }
    for (const th of ctx.db.thread.byChannelId.filter(c.id)) {
      ctx.db.thread.id.delete(th.id);
    }
    ctx.db.channel.id.delete(c.id);
  }
  // Wipe all existing categories
  for (const cat of ctx.db.category.byServerId.filter(serverId)) {
    ctx.db.category.id.delete(cat.id);
  }
  // Re-seed documentation-hub structure
  const structure = [
    {
      name: 'INFORMATION', pos: 0,
      channels: [
        { name: 'welcome',       topic: 'Welcome to Omnia — read this first.' },
        { name: 'announcements', topic: 'Official updates from the team.' },
        { name: 'changelog',     topic: 'Release notes and version history.' },
      ],
    },
    {
      name: 'GETTING STARTED', pos: 1,
      channels: [
        { name: 'quick-start',   topic: 'New here? This guide gets you up and running fast.' },
        { name: 'installation',  topic: 'Installation and setup for all platforms.' },
        { name: 'faq',           topic: 'Answers to the most common questions.' },
      ],
    },
    {
      name: 'DOCUMENTATION', pos: 2,
      channels: [
        { name: 'guides',        topic: 'In-depth how-to guides and walkthroughs.' },
        { name: 'api-reference', topic: 'Complete API reference.' },
        { name: 'examples',      topic: 'Sample code and example projects.' },
      ],
    },
    {
      name: 'COMMUNITY', pos: 3,
      channels: [
        { name: 'general',       topic: 'Open discussion for everyone.' },
        { name: 'help',          topic: 'Ask questions and get support.' },
        { name: 'feedback',      topic: 'Share ideas and feature requests.' },
        { name: 'showcase',      topic: "Show off what you've built." },
      ],
    },
  ];
  for (const cat of structure) {
    const catRow = ctx.db.category.insert({
      id: 0n, serverId, name: cat.name, position: cat.pos,
    });
    cat.channels.forEach((c, i) => {
      ctx.db.channel.insert({
        id: 0n, serverId,
        name: c.name, topic: c.topic,
        position: i, categoryId: catRow.id,
        slowmodeSeconds: 0, lastMessageId: 0n,
        createdAt: ctx.timestamp,
      });
    });
  }
});

// ============================================================================
// LIFECYCLE
// ============================================================================

export const init = spacetimedb.init(ctx => {
  const svr = ctx.db.server.insert({
    id: 0n,
    name: 'Omnia Lounge',
    description: 'The default community server — everyone joins automatically.',
    ownerId: ctx.sender,
    isPublic: true,
    iconUrl: '',
    bannerColor: '#5865f2',
    traits: 'Community,Tech,Friendly',
    createdAt: ctx.timestamp,
  });
  ctx.db.server_member.insert({
    id: 0n,
    serverId: svr.id,
    userIdentity: ctx.sender,
    nickname: undefined,
    role: 'owner',
    joinedAt: ctx.timestamp,
  });
  // Seed documentation-hub channel structure
  const initStructure = [
    {
      name: 'INFORMATION', pos: 0,
      channels: [
        { name: 'welcome',       topic: 'Welcome to Omnia — read this first.' },
        { name: 'announcements', topic: 'Official updates from the team.' },
        { name: 'changelog',     topic: 'Release notes and version history.' },
      ],
    },
    {
      name: 'GETTING STARTED', pos: 1,
      channels: [
        { name: 'quick-start',   topic: 'New here? This guide gets you up and running fast.' },
        { name: 'installation',  topic: 'Installation and setup for all platforms.' },
        { name: 'faq',           topic: 'Answers to the most common questions.' },
      ],
    },
    {
      name: 'DOCUMENTATION', pos: 2,
      channels: [
        { name: 'guides',        topic: 'In-depth how-to guides and walkthroughs.' },
        { name: 'api-reference', topic: 'Complete API reference.' },
        { name: 'examples',      topic: 'Sample code and example projects.' },
      ],
    },
    {
      name: 'COMMUNITY', pos: 3,
      channels: [
        { name: 'general',       topic: 'Open discussion for everyone.' },
        { name: 'help',          topic: 'Ask questions and get support.' },
        { name: 'feedback',      topic: 'Share ideas and feature requests.' },
        { name: 'showcase',      topic: "Show off what you've built." },
      ],
    },
  ];
  for (const cat of initStructure) {
    const catRow = ctx.db.category.insert({
      id: 0n, serverId: svr.id, name: cat.name, position: cat.pos,
    });
    cat.channels.forEach((c, i) => {
      ctx.db.channel.insert({
        id: 0n, serverId: svr.id,
        name: c.name, topic: c.topic,
        position: i, categoryId: catRow.id,
        slowmodeSeconds: 0, lastMessageId: 0n,
        createdAt: ctx.timestamp,
      });
    });
  }
});

export const onConnect = spacetimedb.clientConnected(ctx => {
  const u = ctx.db.user.identity.find(ctx.sender);
  if (u) {
    ctx.db.user.identity.update({
      ...u,
      online: true,
      status: u.status === 'offline' ? 'online' : u.status,
      lastSeen: ctx.timestamp,
    });
  } else {
    ctx.db.user.insert({
      identity: ctx.sender,
      name: undefined,
      avatarColor: hashColor(ctx.sender.toHexString()),
      bio: '',
      pronouns: '',
      status: 'online',
      online: true,
      createdAt: ctx.timestamp,
      lastSeen: ctx.timestamp,
    });
  }

  // Auto-join all public servers the user is not yet a member of
  for (const svr of ctx.db.server.iter()) {
    if (!svr.isPublic) continue;
    if (getMember(ctx, svr.id)) continue;
    ctx.db.server_member.insert({
      id: 0n,
      serverId: svr.id,
      userIdentity: ctx.sender,
      nickname: undefined,
      role: 'member',
      joinedAt: ctx.timestamp,
    });
  }

  // Ensure every existing server has an @everyone role and every member
  // of each server (including this user) has it assigned. This is the
  // backward-compat path for data created before the role system.
  for (const svr of ctx.db.server.iter()) {
    const locked = isDefaultServer(svr.id);
    const everyoneId = ensureDefaultRole(ctx, svr.id, locked);
    // Assign @everyone to every member that doesn't already have a role
    for (const m of ctx.db.server_member.byServerId.filter(svr.id)) {
      let hasAny = false;
      for (const mr of ctx.db.member_role.byServerId.filter(svr.id)) {
        if (mr.userIdentity.toHexString() === m.userIdentity.toHexString()) {
          hasAny = true;
          break;
        }
      }
      if (!hasAny) {
        ctx.db.member_role.insert({
          id: 0n,
          serverId: svr.id,
          userIdentity: m.userIdentity,
          roleId: everyoneId,
          assignedAt: ctx.timestamp,
        });
      }
    }
  }

  // Bootstrap: if no super admin exists yet, the first connecting user
  // becomes Super Admin. They also receive a Speaker role on the default
  // community server so they can immediately post.
  const superAdmins = [...ctx.db.super_admin.iter()];
  if (superAdmins.length === 0) {
    ctx.db.super_admin.insert({
      userIdentity: ctx.sender,
      grantedAt: ctx.timestamp,
    });
    // Ensure a "Speaker" role exists on the default server with write access
    let speakerRoleId: bigint | null = null;
    for (const r of ctx.db.server_role.byServerId.filter(DEFAULT_SERVER_ID)) {
      if (r.name === 'Speaker') {
        speakerRoleId = r.id;
        break;
      }
    }
    if (speakerRoleId === null) {
      const row = ctx.db.server_role.insert({
        id: 0n,
        serverId: DEFAULT_SERVER_ID,
        name: 'Speaker',
        color: '#5865f2',
        position: 10,
        permissions:
          PERM_VIEW_CHANNELS |
          PERM_SEND_MESSAGES |
          PERM_ADD_REACTIONS |
          PERM_CREATE_INVITE,
        isDefault: false,
      });
      speakerRoleId = row.id;
    }
    // Assign Speaker role to the bootstrapping super admin
    let alreadyAssigned = false;
    for (const mr of ctx.db.member_role.byServerId.filter(DEFAULT_SERVER_ID)) {
      if (
        mr.roleId === speakerRoleId &&
        mr.userIdentity.toHexString() === ctx.sender.toHexString()
      ) {
        alreadyAssigned = true;
        break;
      }
    }
    if (!alreadyAssigned) {
      ctx.db.member_role.insert({
        id: 0n,
        serverId: DEFAULT_SERVER_ID,
        userIdentity: ctx.sender,
        roleId: speakerRoleId,
        assignedAt: ctx.timestamp,
      });
    }
  }
});

export const onDisconnect = spacetimedb.clientDisconnected(ctx => {
  const u = ctx.db.user.identity.find(ctx.sender);
  if (u) {
    ctx.db.user.identity.update({ ...u, online: false, lastSeen: ctx.timestamp });
  }
  // Clear typing indicator
  const typing = ctx.db.typing.userIdentity.find(ctx.sender);
  if (typing) {
    ctx.db.typing.userIdentity.delete(ctx.sender);
  }
});
