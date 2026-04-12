import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useReducer, useTable } from 'spacetimedb/react';
import { buildMessageLink, useRoute } from '../hooks/useRoute';
import { reducers, tables } from '../module_bindings';
import type {
  Channel,
  Message as MessageRow,
  Reaction,
  ServerMember,
  Thread,
  Typing,
  User,
} from '../module_bindings/types';
import { generateAlias } from '../utils/alias';
import MessageText from './MessageText';

const REACTION_EMOJIS = ['👍', '👎', '❤️', '🎉', '😂', '😮', '😢', '😡'];
const EMOJI_NAMES: Record<string, string> = {
  '👍': 'thumbsup',
  '👎': 'thumbsdown',
  '❤️': 'heart',
  '🎉': 'tada',
  '😂': 'joy',
  '😮': 'open_mouth',
  '😢': 'cry',
  '😡': 'rage',
};
const GROUP_WINDOW_MICROS = 5n * 60n * 1_000_000n;
const TYPING_DEBOUNCE_MS = 3000;

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

interface SlashCommand {
  name: string;
  description: string;
  transform: (arg: string) => string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  {
    name: 'ask',
    description: 'Ask the AI assistant a question (RAG-grounded)',
    transform: a => a, // handled specially — intercepted before sendMessage
  },
  {
    name: 'shrug',
    description: 'Appends ¯\\_(ツ)_/¯ to your message',
    transform: a => (a ? `${a} ¯\\_(ツ)_/¯` : '¯\\_(ツ)_/¯'),
  },
  {
    name: 'tableflip',
    description: 'Appends (╯°□°)╯︵ ┻━┻ to your message',
    transform: a => (a ? `${a} (╯°□°)╯︵ ┻━┻` : '(╯°□°)╯︵ ┻━┻'),
  },
  {
    name: 'unflip',
    description: 'Appends ┬─┬ ノ( ゜-゜ノ) to your message',
    transform: a => (a ? `${a} ┬─┬ ノ( ゜-゜ノ)` : '┬─┬ ノ( ゜-゜ノ)'),
  },
  {
    name: 'flip',
    description: 'Appends (╯°□°)╯︵ ┻━┻ to your message',
    transform: a => (a ? `${a} (╯°□°)╯︵ ┻━┻` : '(╯°□°)╯︵ ┻━┻'),
  },
  {
    name: 'me',
    description: 'Displays message as an action in italics',
    transform: a => `_${a}_`,
  },
  {
    name: 'spoiler',
    description: 'Marks your message as a spoiler',
    transform: a => `||${a}||`,
  },
];

function parseSlash(draft: string): { cmd: string; arg: string } | null {
  if (!draft.startsWith('/')) return null;
  const m = draft.match(/^\/(\w*)(.*)$/);
  if (!m) return null;
  return { cmd: m[1], arg: m[2].replace(/^\s+/, '') };
}

function transformSlashCommand(draft: string): string {
  const parsed = parseSlash(draft);
  if (!parsed) return draft;
  const command = SLASH_COMMANDS.find(c => c.name === parsed.cmd);
  return command ? command.transform(parsed.arg) : draft;
}

function formatReactionTooltip(users: string[], emoji: string, mine: boolean): string {
  // Put "You" first if present
  const cleaned = [...users];
  if (mine) {
    // User's name is in the list; replace it with "You" at the front
    // We don't know the exact "me" label here, so just prepend "You"
    // (the mine flag is the source of truth)
    const names = cleaned.filter((_, i) => i !== cleaned.indexOf(cleaned[0]));
    void names;
  }
  const total = cleaned.length;
  let head = '';
  if (mine) {
    const others = cleaned.filter(() => true);
    // Move self conceptually
    head = total === 1 ? 'You' : `You and ${total - 1} other${total - 1 === 1 ? '' : 's'}`;
  } else if (total <= 3) {
    head = cleaned.join(', ');
  } else {
    head = `${cleaned.slice(0, 2).join(', ')} and ${total - 2} other${total - 2 === 1 ? '' : 's'}`;
  }
  return `${head} reacted with ${emoji}`;
}

interface ChatProps {
  channel: Channel;
  users: readonly User[];
  threads: readonly Thread[];
  reactions: readonly Reaction[];
  typingUsers: Typing[];
  serverMembers: ServerMember[];
  isChannelAdmin: boolean;
  currentIdentityHex: string;
  canWrite: boolean;
  activeThreadId: bigint | null;
  onOpenThread: (id: bigint) => void;
  onCloseThread: () => void;
  onOpenProfile: (user: User, rect: DOMRect) => void;
  showMembers: boolean;
  onToggleMembers: () => void;
}

export default function Chat({
  channel,
  users,
  threads,
  reactions,
  typingUsers,
  serverMembers,
  isChannelAdmin,
  currentIdentityHex,
  canWrite,
  activeThreadId,
  onOpenThread,
  onCloseThread,
  onOpenProfile,
  showMembers,
  onToggleMembers,
}: ChatProps) {
  const setSlowmode = useReducer(reducers.setSlowmode);
  const unpinMessageFromPanel = useReducer(reducers.unpinMessage);
  const channelQuery = useMemo(
    () => tables.message.where(m => m.channelId.eq(channel.id)),
    [channel.id]
  );
  const [allChannelMessages] = useTable(channelQuery);
  const updateReadState = useReducer(reducers.updateReadState);
  const [showPinned, setShowPinned] = useState(false);
  const [showThreads, setShowThreads] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [flashMessageId, setFlashMessageId] = useState<bigint | null>(null);
  const [confirmUnpin, setConfirmUnpin] = useState<MessageRow | null>(null);
  useEffect(() => {
    setShowPinned(false);
    setShowThreads(false);
  }, [channel.id]);
  useEffect(() => {
    setShowSearch(false);
    setSearchQuery('');
  }, [channel.id]);
  useEffect(() => {
    if (flashMessageId === null) return;
    const t = setTimeout(() => setFlashMessageId(null), 2500);
    return () => clearTimeout(t);
  }, [flashMessageId]);

  const jumpToMessage = (msgId: bigint) => {
    const el = document.querySelector(`[data-message-id="${msgId.toString()}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setFlashMessageId(msgId);
    }
  };

  // Deep-link: when URL has /c/:sid/:cid/:mid and the message belongs to the
  // current channel, scroll to it and flash once.
  const { messageId: routeMessageId } = useRoute();
  const lastJumpedRouteMsgRef = useRef<bigint | null>(null);
  useEffect(() => {
    if (routeMessageId === null) {
      lastJumpedRouteMsgRef.current = null;
      return;
    }
    if (lastJumpedRouteMsgRef.current === routeMessageId) return;
    const exists = allChannelMessages.some(m => m.id === routeMessageId);
    if (!exists) return;
    lastJumpedRouteMsgRef.current = routeMessageId;
    // Defer so the DOM has rendered the target node
    setTimeout(() => jumpToMessage(routeMessageId), 120);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMessageId, allChannelMessages]);

  const topMessages = allChannelMessages
    .filter(m => m.threadId === 0n)
    .sort((a, b) => (a.sent.microsSinceUnixEpoch < b.sent.microsSinceUnixEpoch ? -1 : 1));

  const pinnedMessages = allChannelMessages
    .filter(m => m.pinned && m.threadId === 0n)
    .sort((a, b) => (a.sent.microsSinceUnixEpoch < b.sent.microsSinceUnixEpoch ? 1 : -1));

  const channelThreads = threads.filter(th => th.channelId === channel.id);
  const activeThread =
    activeThreadId !== null ? (channelThreads.find(th => th.id === activeThreadId) ?? null) : null;
  const activeThreadParent =
    activeThread !== null
      ? (allChannelMessages.find(m => m.id === activeThread.parentMessageId) ?? null)
      : null;

  // Mark channel as read when latest message changes
  const latestMsgId = topMessages.length > 0 ? topMessages[topMessages.length - 1].id : undefined;
  useEffect(() => {
    if (latestMsgId !== undefined) {
      updateReadState({ channelId: channel.id, lastMessageId: latestMsgId }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel.id, latestMsgId?.toString()]);

  // Build lookup maps
  const userByHex = useMemo(() => {
    const m = new Map<string, User>();
    for (const u of users) m.set(u.identity.toHexString(), u);
    return m;
  }, [users]);

  // Server-specific nicknames
  const nicknameByHex = useMemo(() => {
    const m = new Map<string, string>();
    for (const sm of serverMembers) {
      if (sm.nickname) m.set(sm.userIdentity.toHexString(), sm.nickname);
    }
    return m;
  }, [serverMembers]);

  const threadsByParent = useMemo(() => {
    const m = new Map<string, Thread>();
    for (const th of channelThreads) m.set(th.parentMessageId.toString(), th);
    return m;
  }, [channelThreads]);

  const reactionsByMessage = useMemo(() => {
    const m = new Map<string, Reaction[]>();
    for (const r of reactions) {
      if (!allChannelMessages.some(msg => msg.id === r.messageId)) continue;
      const key = r.messageId.toString();
      const arr = m.get(key) ?? [];
      arr.push(r);
      m.set(key, arr);
    }
    return m;
  }, [reactions, allChannelMessages]);

  return (
    <>
      <header className="chat-header">
        <div className="chat-header-title">
          <span className="channel-hash-lg">#</span>
          <span className="channel-name-lg">{channel.name}</span>
        </div>
        {channel.topic && (
          <>
            <div className="chat-header-divider" />
            <div className="chat-header-topic">{channel.topic}</div>
          </>
        )}
        {channel.slowmodeSeconds > 0 && (
          <button
            className="slowmode-chip"
            title={
              isChannelAdmin
                ? 'Click to change slowmode'
                : `Slowmode: ${channel.slowmodeSeconds}s between messages`
            }
            onClick={() => {
              if (!isChannelAdmin) return;
              const v = prompt(
                'Slowmode seconds (0 to disable, max 21600):',
                String(channel.slowmodeSeconds)
              );
              if (v === null) return;
              const n = Number(v);
              if (!Number.isFinite(n) || n < 0 || n > 21600) {
                alert('Invalid slowmode value');
                return;
              }
              setSlowmode({ channelId: channel.id, seconds: Math.floor(n) }).catch(err =>
                alert(String(err))
              );
            }}
          >
            ⏱ {channel.slowmodeSeconds}s
          </button>
        )}
        <div className="chat-header-actions">
          {isChannelAdmin && (
            <button
              className="icon-btn"
              title="Channel settings (slowmode)"
              onClick={() => {
                const v = prompt(
                  'Slowmode seconds (0 = disabled, max 21600):',
                  String(channel.slowmodeSeconds)
                );
                if (v === null) return;
                const n = Number(v);
                if (!Number.isFinite(n) || n < 0 || n > 21600) {
                  alert('Invalid slowmode value');
                  return;
                }
                setSlowmode({ channelId: channel.id, seconds: Math.floor(n) }).catch(err =>
                  alert(String(err))
                );
              }}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M19.738 10H22V14H19.739C19.498 14.931 19.1 15.798 18.565 16.564L20 18L18 20L16.564 18.564C15.798 19.099 14.932 19.498 14 19.738V22H10V19.738C9.069 19.498 8.202 19.099 7.436 18.564L6 20L4 18L5.435 16.564C4.9 15.799 4.502 14.932 4.262 14H2V10H4.262C4.502 9.068 4.9 8.202 5.436 7.436L4 6L6 4L7.436 5.436C8.202 4.9 9.068 4.502 10 4.262V2H14V4.261C14.932 4.502 15.797 4.9 16.565 5.435L18 3.999L20 6L18.564 7.436C19.099 8.202 19.498 9.069 19.738 10ZM12 16C14.209 16 16 14.209 16 12C16 9.791 14.209 8 12 8C9.791 8 8 9.791 8 12C8 14.209 9.791 16 12 16Z" />
              </svg>
            </button>
          )}
          <div className="threads-button-wrap">
            <button
              className={`icon-btn ${showThreads ? 'active' : ''}`}
              title="Threads"
              onClick={() => setShowThreads(v => !v)}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.5913 13.3345L9.16674 11.3571L12.5913 9.38018V6.41791L9.16674 8.39543V4.44051L6.60241 2.96069L6.60241 8.39543L3.1778 10.3729V13.3352L6.60241 11.3571V15.3127L9.16674 16.7925V20.7476L9.16739 20.7484L11.7317 22.2282V18.2731L15.1575 20.251V17.2876L11.7317 15.3102V13.3345L12.5913 13.3345Z" />
                <path d="M17.7213 12.3449L20.8219 10.5547V7.59242L17.7213 9.38269V5.4276L15.1579 3.94776V9.38269L12.5914 10.8606V13.8228L15.1579 12.3449V16.3024L17.7213 17.7803V21.7354L20.8219 19.9451V16.9828L17.7213 18.7731V12.3449Z" />
              </svg>
            </button>
            {showThreads && (
              <ThreadsPanel
                threads={channelThreads}
                allChannelMessages={allChannelMessages as MessageRow[]}
                userByHex={userByHex}
                nicknameByHex={nicknameByHex}
                onOpenThread={id => {
                  setShowThreads(false);
                  onOpenThread(id);
                }}
                onClose={() => setShowThreads(false)}
              />
            )}
          </div>
          <div className="pin-button-wrap">
            <button
              className={`icon-btn ${showPinned ? 'active' : ''}`}
              title="Pinned messages"
              onClick={() => setShowPinned(v => !v)}
            >
              <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                <path d="M22 12L12.101 2.10101L10.686 3.51401L12.101 4.92801L7.15096 9.87801V9.88001L5.73596 8.46501L4.32196 9.87801L8.56496 14.121L2.90796 19.778L4.32196 21.192L9.97896 15.535L14.222 19.778L15.636 18.364L14.222 16.95L19.172 12L20.586 13.414L22 12Z" />
              </svg>
            </button>
            {showPinned && (
              <PinnedPanel
                messages={pinnedMessages}
                userByHex={userByHex}
                onClose={() => setShowPinned(false)}
                onJump={msg => {
                  setShowPinned(false);
                  // Let the panel unmount before scrolling
                  setTimeout(() => jumpToMessage(msg.id), 60);
                }}
                onUnpin={(msg, shiftHeld) => {
                  if (shiftHeld) {
                    unpinMessageFromPanel({ messageId: msg.id }).catch(console.error);
                  } else {
                    setConfirmUnpin(msg);
                  }
                }}
              />
            )}
          </div>
          <button
            className={`icon-btn member-toggle-btn ${showMembers ? 'active' : ''}`}
            title={showMembers ? 'Hide Member List' : 'Show Member List'}
            onClick={onToggleMembers}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14.5 8C16.433 8 18 6.433 18 4.5C18 2.567 16.433 1 14.5 1C12.567 1 11 2.567 11 4.5C11 6.433 12.567 8 14.5 8ZM5 8.5C5 10.433 6.567 12 8.5 12C10.433 12 12 10.433 12 8.5C12 6.567 10.433 5 8.5 5C6.567 5 5 6.567 5 8.5ZM8.5 13.5C5.444 13.5 0 15.022 0 18.05V20.5H17V18.05C17 15.022 11.556 13.5 8.5 13.5ZM14.5 13.5C14.124 13.5 13.697 13.53 13.242 13.582C13.314 13.627 13.384 13.676 13.453 13.725C14.965 14.744 15.5 16.056 15.5 18.05V20.5H24V18.05C24 15.022 18.556 13.5 14.5 13.5Z" />
            </svg>
          </button>
          <div className="header-search">
            <input
              className="header-search-input"
              placeholder="Search"
              value={searchQuery}
              onFocus={() => setShowSearch(true)}
              onChange={e => {
                setSearchQuery(e.target.value);
                if (!showSearch) setShowSearch(true);
              }}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  setShowSearch(false);
                  setSearchQuery('');
                }
              }}
            />
            {searchQuery ? (
              <button
                type="button"
                className="header-search-clear"
                title="Clear"
                onClick={() => {
                  setSearchQuery('');
                  setShowSearch(false);
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                </svg>
              </button>
            ) : (
              <svg
                className="header-search-icon"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
              >
                <path d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z" />
              </svg>
            )}
            {showSearch && searchQuery.trim() && (
              <SearchDropdown
                query={searchQuery}
                messages={topMessages}
                members={serverMembers}
                users={users}
                userByHex={userByHex}
                nicknameByHex={nicknameByHex}
                onJump={id => {
                  setShowSearch(false);
                  setSearchQuery('');
                  setTimeout(() => jumpToMessage(id), 50);
                }}
                onOpenProfile={(u, r) => {
                  setShowSearch(false);
                  setSearchQuery('');
                  onOpenProfile(u, r);
                }}
                onClose={() => {
                  setShowSearch(false);
                  setSearchQuery('');
                }}
              />
            )}
          </div>
        </div>
      </header>

      <main className="chat-main">
        <ChannelPane
          channel={channel}
          messages={topMessages}
          users={users}
          userByHex={userByHex}
          nicknameByHex={nicknameByHex}
          threadsByParent={threadsByParent}
          reactionsByMessage={reactionsByMessage}
          allChannelMessages={allChannelMessages as MessageRow[]}
          typingUsers={typingUsers}
          currentIdentityHex={currentIdentityHex}
          canWrite={canWrite}
          onOpenThread={onOpenThread}
          onOpenProfile={onOpenProfile}
          flashMessageId={flashMessageId}
          onJumpToMessage={jumpToMessage}
        />
        {activeThread && (
          <ThreadPanel
            thread={activeThread}
            parentMessage={activeThreadParent}
            messages={allChannelMessages.filter(m => m.threadId === activeThread.id)}
            users={users}
            userByHex={userByHex}
            nicknameByHex={nicknameByHex}
            reactionsByMessage={reactionsByMessage}
            channelId={channel.id}
            serverId={channel.serverId}
            currentIdentityHex={currentIdentityHex}
            onClose={onCloseThread}
            onOpenProfile={onOpenProfile}
          />
        )}
      </main>
      {confirmUnpin && (
        <UnpinConfirmModal
          message={confirmUnpin}
          author={userByHex.get(confirmUnpin.authorId.toHexString()) ?? null}
          onCancel={() => setConfirmUnpin(null)}
          onConfirm={() => {
            unpinMessageFromPanel({ messageId: confirmUnpin.id }).catch(console.error);
            setConfirmUnpin(null);
          }}
        />
      )}
    </>
  );
}

// ─── Channel messages pane ───────────────────────────────────────────────────

function ChannelPane({
  channel,
  messages,
  users,
  userByHex,
  nicknameByHex,
  threadsByParent,
  reactionsByMessage,
  allChannelMessages,
  typingUsers,
  currentIdentityHex,
  canWrite,
  onOpenThread,
  onOpenProfile,
  flashMessageId,
  onJumpToMessage,
}: {
  channel: Channel;
  messages: MessageRow[];
  users: readonly User[];
  userByHex: Map<string, User>;
  nicknameByHex: Map<string, string>;
  threadsByParent: Map<string, Thread>;
  reactionsByMessage: Map<string, Reaction[]>;
  allChannelMessages: MessageRow[];
  typingUsers: Typing[];
  currentIdentityHex: string;
  canWrite: boolean;
  onOpenThread: (id: bigint) => void;
  onOpenProfile: (user: User, rect: DOMRect) => void;
  flashMessageId: bigint | null;
  onJumpToMessage: (msgId: bigint) => void;
}) {
  const [cooldownUntil, setCooldownUntil] = useState(0);
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (cooldownUntil === 0) return;
    const iv = setInterval(() => forceTick(t => t + 1), 500);
    return () => clearInterval(iv);
  }, [cooldownUntil]);
  const now = Date.now();
  const cooldownRemaining = Math.max(0, Math.ceil((cooldownUntil - now) / 1000));
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTypingRef = useRef(0);
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [draft, setDraft] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [slashError, setSlashError] = useState<string | null>(null);

  const sendMessage = useReducer(reducers.sendMessage);
  const setTypingReducer = useReducer(reducers.setTyping);
  const deleteMessage = useReducer(reducers.deleteMessage);
  const editMessage = useReducer(reducers.editMessage);
  const createThread = useReducer(reducers.createThread);
  const toggleReaction = useReducer(reducers.toggleReaction);
  const pinMessage = useReducer(reducers.pinMessage);
  const unpinMessage = useReducer(reducers.unpinMessage);
  const createAskRequest = useReducer(reducers.createAskRequest);

  useEffect(() => {
    setDraft('');
    setReplyTo(null);
  }, [channel.id]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, channel.id]);

  const onSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canWrite) return;
    if (!draft.trim() && !attachmentUrl) return;
    if (cooldownRemaining > 0) return;

    // /ask [question] — route to the AI RAG pipeline. Matches both
    // "/ask some question" and "/ask" (standalone, prompts for question).
    const trimmed = draft.trim();
    const askMatch = trimmed.match(/^\/ask(?:\s+(.+))?$/i);
    if (askMatch) {
      const question = (askMatch[1] ?? '').trim();
      if (question.length === 0) {
        // User typed just "/ask" with no question — don't send, just hint
        setSlashError('Type your question after /ask, e.g. /ask What is this server about?');
        return;
      }
      setDraft('');
      setSlashError(null);
      createAskRequest({
        channelId: channel.id,
        threadId: 0n,
        question,
      }).catch(err => {
        console.error(err);
        setDraft(trimmed);
        setSlashError(String(err?.message ?? err));
      });
      return;
    }

    const text = transformSlashCommand(draft);
    const url = attachmentUrl;
    const reply = replyTo;
    setDraft('');
    setAttachmentUrl('');
    setReplyTo(null);
    sendMessage({
      channelId: channel.id,
      threadId: 0n,
      replyToId: reply?.id ?? 0n,
      text,
      attachmentUrl: url,
    })
      .then(() => {
        if (channel.slowmodeSeconds > 0) {
          setCooldownUntil(Date.now() + channel.slowmodeSeconds * 1000);
        }
      })
      .catch(err => {
        console.error(err);
        setDraft(text);
        setAttachmentUrl(url);
        // Parse "wait Ns" from slowmode error and start cooldown
        const msg = String(err?.message ?? err);
        const m = msg.match(/wait (\d+)s/);
        if (m) setCooldownUntil(Date.now() + Number.parseInt(m[1], 10) * 1000);
      });
  };

  const onDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setDraft(e.target.value);
    if (slashError) setSlashError(null);
    const now = Date.now();
    if (now - lastTypingRef.current > TYPING_DEBOUNCE_MS) {
      lastTypingRef.current = now;
      setTypingReducer({ channelId: channel.id }).catch(() => {});
    }
  };

  const typingNames = typingUsers.map(
    t => userByHex.get(t.userIdentity.toHexString())?.name ?? 'Someone'
  );

  return (
    <div className="channel-pane">
      <div className="messages-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="no-messages">
            <h2>Welcome to #{channel.name}!</h2>
            <p>This is the beginning of #{channel.name}.</p>
          </div>
        )}
        <MessageList
          messages={messages}
          users={users}
          userByHex={userByHex}
          nicknameByHex={nicknameByHex}
          reactionsByMessage={reactionsByMessage}
          allChannelMessages={allChannelMessages}
          currentIdentityHex={currentIdentityHex}
          channelServerId={channel.serverId}
          onOpenProfile={onOpenProfile}
          flashMessageId={flashMessageId}
          onJumpToMessage={onJumpToMessage}
          onReply={setReplyTo}
          onEdit={(msgId, text) => editMessage({ messageId: msgId, text }).catch(console.error)}
          onDelete={msgId => {
            if (confirm('Delete this message?')) {
              deleteMessage({ messageId: msgId }).catch(console.error);
            }
          }}
          onStartThread={msg => {
            const name = prompt('Thread name?', msg.text.slice(0, 40));
            if (!name) return;
            createThread({ parentMessageId: msg.id, name })
              .then(onOpenThread as unknown as () => void)
              .catch(console.error);
          }}
          onTogglePin={msg =>
            (msg.pinned ? unpinMessage : pinMessage)({ messageId: msg.id }).catch(console.error)
          }
          onOpenThread={msg => {
            const th = threadsByParent.get(msg.id.toString());
            if (th) onOpenThread(th.id);
          }}
          onToggleReaction={(msgId, emoji) =>
            toggleReaction({ messageId: msgId, emoji }).catch(console.error)
          }
          threadsByParent={threadsByParent}
        />
      </div>

      {typingNames.length > 0 && (
        <div className="typing-indicator">
          <span className="typing-dots">
            <span />
            <span />
            <span />
          </span>
          {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
        </div>
      )}

      {/* Old slash-autocomplete removed — replaced by SlashHints above the form */}

      {replyTo && (
        <div className="reply-banner">
          <span>
            Replying to <b>{userByHex.get(replyTo.authorId.toHexString())?.name ?? 'someone'}</b>
            {' — '}
            <span className="reply-quote-preview">{replyTo.text.slice(0, 100)}</span>
          </span>
          <button onClick={() => setReplyTo(null)}>×</button>
        </div>
      )}

      {attachmentUrl && (
        <div className="attachment-chip-bar">
          <div className="attachment-chip">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16.5 6V17.5C16.5 19.71 14.71 21.5 12.5 21.5C10.29 21.5 8.5 19.71 8.5 17.5V5C8.5 3.62 9.62 2.5 11 2.5C12.38 2.5 13.5 3.62 13.5 5V15.5C13.5 16.05 13.05 16.5 12.5 16.5C11.95 16.5 11.5 16.05 11.5 15.5V6H10V15.5C10 16.88 11.12 18 12.5 18C13.88 18 15 16.88 15 15.5V5C15 2.79 13.21 1 11 1C8.79 1 7 2.79 7 5V17.5C7 20.54 9.46 23 12.5 23C15.54 23 18 20.54 18 17.5V6H16.5Z" />
            </svg>
            <span className="attachment-chip-url">{attachmentUrl}</span>
            <button
              type="button"
              className="attachment-chip-close"
              title="Remove attachment"
              onClick={() => setAttachmentUrl('')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {!canWrite ? (
        <div className="chat-noperm-bar">
          You do not have permission to send messages in this channel.
        </div>
      ) : (
        <>
          {/* Slash command suggestions + active-command pill */}
          <SlashHints
            draft={draft}
            error={slashError}
            onPick={cmd => {
              setDraft(`/${cmd} `);
              setSlashError(null);
            }}
          />
          <form className="message-input" onSubmit={onSend}>
            <button
              type="button"
              className="message-input-attach"
              title="Attach a URL"
              disabled={!canWrite}
              onClick={() => {
                if (!canWrite) return;
                const url = window.prompt('Attachment URL:', attachmentUrl);
                if (url !== null) setAttachmentUrl(url);
              }}
            >
              <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2.00098C6.486 2.00098 2 6.48698 2 12.001C2 17.515 6.486 22.001 12 22.001C17.514 22.001 22 17.515 22 12.001C22 6.48698 17.514 2.00098 12 2.00098ZM17 13.001H13V17.001H11V13.001H7V11.001H11V7.00098H13V11.001H17V13.001Z" />
              </svg>
            </button>

            <SlashHighlightInput
              draft={draft}
              onChange={onDraftChange}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onSend(e as unknown as React.FormEvent);
                }
              }}
              placeholder={
                !canWrite
                  ? `You don't have write access to #${channel.name}`
                  : cooldownRemaining > 0
                    ? `Slowmode — wait ${cooldownRemaining}s`
                    : channel.slowmodeSeconds > 0
                      ? `Message #${channel.name} (slowmode: ${channel.slowmodeSeconds}s)`
                      : `Message #${channel.name}`
              }
              disabled={cooldownRemaining > 0 || !canWrite}
            />

            <div className="message-input-tools">
              <button
                type="button"
                className="message-input-tool"
                title="Send a gift"
                disabled={!canWrite}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M20 7H16.62C16.86 6.56 17 6.05 17 5.5C17 3.57 15.43 2 13.5 2C12.28 2 11.21 2.63 10.59 3.58L10 4.38L9.41 3.57C8.79 2.63 7.72 2 6.5 2C4.57 2 3 3.57 3 5.5C3 6.05 3.14 6.56 3.38 7H0V20C0 21.1 0.9 22 2 22H18C19.1 22 20 21.1 20 20V7ZM13.5 4C14.33 4 15 4.67 15 5.5C15 6.33 14.33 7 13.5 7C12.67 7 12 6.33 12 5.5C12 4.67 12.67 4 13.5 4ZM6.5 4C7.33 4 8 4.67 8 5.5C8 6.33 7.33 7 6.5 7C5.67 7 5 6.33 5 5.5C5 4.67 5.67 4 6.5 4ZM18 20H2V16H7.08L4.15 11.98L5.77 10.8L9 15.23L10 13.85L11 15.23L14.23 10.8L15.85 11.98L12.92 16H18V20ZM18 14H14.08L16.85 10.2L15.23 9.02L12 13.45L10.2 10.98L9.01 12.62L7.92 14H2V9H18V14Z" />
                </svg>
              </button>
              <button type="button" className="message-input-tool" title="GIF" disabled={!canWrite}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M2.5 3C1.672 3 1 3.672 1 4.5V19.5C1 20.328 1.672 21 2.5 21H21.5C22.328 21 23 20.328 23 19.5V4.5C23 3.672 22.328 3 21.5 3H2.5ZM8 10V13H9V14H6V9H9V10H8ZM11 9H12V14H11V9ZM14 9V14H15V12H17V11H15V10H18V9H14Z" />
                </svg>
              </button>
              <button
                type="button"
                className="message-input-tool"
                title="Emoji"
                disabled={!canWrite}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2C6.486 2 2 6.486 2 12C2 17.514 6.486 22 12 22C17.514 22 22 17.514 22 12C22 6.486 17.514 2 12 2ZM8.5 8C9.328 8 10 8.672 10 9.5C10 10.328 9.328 11 8.5 11C7.672 11 7 10.328 7 9.5C7 8.672 7.672 8 8.5 8ZM15.5 8C16.328 8 17 8.672 17 9.5C17 10.328 16.328 11 15.5 11C14.672 11 14 10.328 14 9.5C14 8.672 14.672 8 15.5 8ZM12 18C9.636 18 7.604 16.585 6.646 14.577L7.551 14.123C8.361 15.817 10.024 17 12 17C13.976 17 15.639 15.817 16.449 14.123L17.354 14.577C16.396 16.585 14.364 18 12 18Z" />
                </svg>
              </button>
            </div>
          </form>
        </>
      )}
    </div>
  );
}

// ─── Slash command hints ─────────────────────────────────────────────────────
//
// Three visual states depending on what the user has typed:
//
//   1. Draft starts with `/` but no space yet (typing the command name)
//      → show a filtered popup of matching commands
//
//   2. Draft starts with `/command ` and command is known (typing the arg)
//      → hide the popup, show a highlighted "active command" pill with
//        the command name + description so the user knows it's recognised
//
//   3. Draft doesn't start with `/`, OR the command is unrecognised
//      → show nothing (or just the error strip if present)

function SlashHints({
  draft,
  error,
  onPick,
}: {
  draft: string;
  error: string | null;
  onPick: (cmd: string) => void;
}) {
  if (!draft.startsWith('/')) return error ? <div className="slash-error">{error}</div> : null;

  const spaceIdx = draft.indexOf(' ');
  const cmdPart =
    spaceIdx === -1 ? draft.slice(1).toLowerCase() : draft.slice(1, spaceIdx).toLowerCase();
  const hasArg = spaceIdx !== -1;
  const exactMatch = SLASH_COMMANDS.find(c => c.name === cmdPart);

  // State 1: still typing the command name — show filtered popup
  if (!hasArg) {
    const matches = SLASH_COMMANDS.filter(c => c.name.startsWith(cmdPart));
    if (matches.length === 0) return error ? <div className="slash-error">{error}</div> : null;
    return (
      <>
        <div className="slash-popup">
          {matches.map(c => (
            <button
              key={c.name}
              type="button"
              className={`slash-popup-item ${c.name === cmdPart ? 'slash-popup-item-active' : ''}`}
              onMouseDown={e => {
                e.preventDefault();
                onPick(c.name);
              }}
            >
              <span className="slash-popup-name">/{c.name}</span>
              <span className="slash-popup-desc">{c.description}</span>
            </button>
          ))}
        </div>
        {error && <div className="slash-error">{error}</div>}
      </>
    );
  }

  // State 2: command recognised + user is typing the argument
  if (exactMatch) {
    return (
      <>
        <div className="slash-active-cmd">
          <span className="slash-active-cmd-pill">/{exactMatch.name}</span>
          <span className="slash-active-cmd-desc">{exactMatch.description}</span>
        </div>
        {error && <div className="slash-error">{error}</div>}
      </>
    );
  }

  // State 3: unrecognised command
  return error ? <div className="slash-error">{error}</div> : null;
}

// ─── Slash-highlighted textarea ──────────────────────────────────────────────
//
// Uses the "mirror overlay" technique to highlight the /command portion in
// blurple inside a regular <textarea>:
//
//   - A mirror <div> sits BEHIND the textarea, same font/padding/size.
//     It renders the command portion in blurple and the rest in normal color.
//   - When a command is active, the textarea's text color becomes transparent
//     (so the mirror's colors show through) but the caret stays visible.
//   - When no command, the textarea renders normally — no mirror shown.

function SlashHighlightInput({
  draft,
  onChange,
  onKeyDown,
  placeholder,
  disabled,
}: {
  draft: string;
  onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  disabled: boolean;
}) {
  // Detect a matched command in the draft.
  const parsed = draft.startsWith('/') ? parseSlash(draft) : null;
  const matched = parsed ? SLASH_COMMANDS.find(c => c.name === parsed.cmd) : null;
  const cmdLen = matched ? matched.name.length + 1 : 0; // +1 for the leading /

  return (
    <div className="slash-input-wrap">
      {matched && (
        <div className="slash-input-mirror" aria-hidden="true">
          <span className="slash-input-mirror-cmd">{draft.slice(0, cmdLen)}</span>
          <span className="slash-input-mirror-rest">{draft.slice(cmdLen)}</span>
        </div>
      )}
      <textarea
        className={`message-input-textarea ${matched ? 'slash-input-active' : ''}`}
        value={draft}
        onChange={onChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        rows={1}
      />
    </div>
  );
}

// ─── Thread panel ────────────────────────────────────────────────────────────

function ThreadPanel({
  thread,
  parentMessage,
  messages,
  users,
  userByHex,
  nicknameByHex,
  reactionsByMessage,
  channelId,
  serverId,
  currentIdentityHex,
  onClose,
  onOpenProfile,
}: {
  thread: Thread;
  parentMessage: MessageRow | null;
  messages: readonly MessageRow[];
  users: readonly User[];
  userByHex: Map<string, User>;
  nicknameByHex: Map<string, string>;
  reactionsByMessage: Map<string, Reaction[]>;
  channelId: bigint;
  serverId: bigint;
  currentIdentityHex: string;
  onClose: () => void;
  onOpenProfile: (user: User, rect: DOMRect) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastTypingRef = useRef(0);
  const [draft, setDraft] = useState('');
  const sendMessage = useReducer(reducers.sendMessage);
  const setTypingReducer = useReducer(reducers.setTyping);
  const deleteMessage = useReducer(reducers.deleteMessage);
  const editMessage = useReducer(reducers.editMessage);
  const toggleReaction = useReducer(reducers.toggleReaction);
  const createAskRequest = useReducer(reducers.createAskRequest);

  const sorted = [...messages].sort((a, b) =>
    a.sent.microsSinceUnixEpoch < b.sent.microsSinceUnixEpoch ? -1 : 1
  );

  useEffect(() => setDraft(''), [thread.id]);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length, thread.id]);

  const onSend = (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;

    // /ask [question] — route to the AI bot inside this thread.
    const trimmed = draft.trim();
    const askMatch = trimmed.match(/^\/ask(?:\s+(.+))?$/i);
    if (askMatch) {
      const question = (askMatch[1] ?? '').trim();
      if (question.length === 0) return; // thread input is smaller; just ignore
      setDraft('');
      createAskRequest({
        channelId,
        threadId: thread.id,
        question,
      }).catch(err => {
        console.error(err);
        setDraft(trimmed);
      });
      return;
    }

    const text = draft;
    setDraft('');
    sendMessage({ channelId, threadId: thread.id, replyToId: 0n, text, attachmentUrl: '' }).catch(
      err => {
        console.error(err);
        setDraft(text);
      }
    );
  };

  return (
    <aside className="thread-panel">
      <header className="thread-header">
        <div>
          <div className="thread-title">{thread.name}</div>
          <div className="thread-subtitle">Thread</div>
        </div>
        <button className="icon-btn" onClick={onClose}>
          ×
        </button>
      </header>
      <div className="messages-scroll" ref={scrollRef}>
        {parentMessage && (
          <div className="thread-parent">
            <MessageList
              messages={[parentMessage]}
              users={users}
              userByHex={userByHex}
              nicknameByHex={nicknameByHex}
              reactionsByMessage={reactionsByMessage}
              allChannelMessages={[parentMessage]}
              currentIdentityHex={currentIdentityHex}
              channelServerId={serverId}
              compact
              onOpenProfile={onOpenProfile}
              onEdit={(msgId, text) => editMessage({ messageId: msgId, text }).catch(console.error)}
              onDelete={msgId => {
                if (confirm('Delete?')) deleteMessage({ messageId: msgId }).catch(console.error);
              }}
              onToggleReaction={(msgId, emoji) =>
                toggleReaction({ messageId: msgId, emoji }).catch(console.error)
              }
            />
            <div className="thread-divider">
              <span>
                {sorted.length} {sorted.length === 1 ? 'reply' : 'replies'}
              </span>
            </div>
          </div>
        )}
        <MessageList
          messages={sorted}
          users={users}
          userByHex={userByHex}
          nicknameByHex={nicknameByHex}
          reactionsByMessage={reactionsByMessage}
          allChannelMessages={sorted}
          currentIdentityHex={currentIdentityHex}
          channelServerId={serverId}
          compact
          onOpenProfile={onOpenProfile}
          onEdit={(msgId, text) => editMessage({ messageId: msgId, text }).catch(console.error)}
          onDelete={msgId => {
            if (confirm('Delete?')) deleteMessage({ messageId: msgId }).catch(console.error);
          }}
          onToggleReaction={(msgId, emoji) =>
            toggleReaction({ messageId: msgId, emoji }).catch(console.error)
          }
        />
      </div>
      <form className="message-input" onSubmit={onSend}>
        <button type="button" className="message-input-attach" title="Attach a URL">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2.00098C6.486 2.00098 2 6.48698 2 12.001C2 17.515 6.486 22.001 12 22.001C17.514 22.001 22 17.515 22 12.001C22 6.48698 17.514 2.00098 12 2.00098ZM17 13.001H13V17.001H11V13.001H7V11.001H11V7.00098H13V11.001H17V13.001Z" />
          </svg>
        </button>
        <textarea
          className="message-input-textarea"
          value={draft}
          onChange={e => {
            setDraft(e.target.value);
            const now = Date.now();
            if (now - lastTypingRef.current > TYPING_DEBOUNCE_MS) {
              lastTypingRef.current = now;
              setTypingReducer({ channelId }).catch(() => {});
            }
          }}
          placeholder={`Reply in ${truncate(thread.name, 18)}`}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              onSend(e as unknown as React.FormEvent);
            }
          }}
          rows={1}
        />
        <div className="message-input-tools">
          <button type="button" className="message-input-tool" title="Send a gift">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M20 7H16.62C16.86 6.56 17 6.05 17 5.5C17 3.57 15.43 2 13.5 2C12.28 2 11.21 2.63 10.59 3.58L10 4.38L9.41 3.57C8.79 2.63 7.72 2 6.5 2C4.57 2 3 3.57 3 5.5C3 6.05 3.14 6.56 3.38 7H0V20C0 21.1 0.9 22 2 22H18C19.1 22 20 21.1 20 20V7ZM13.5 4C14.33 4 15 4.67 15 5.5C15 6.33 14.33 7 13.5 7C12.67 7 12 6.33 12 5.5C12 4.67 12.67 4 13.5 4ZM6.5 4C7.33 4 8 4.67 8 5.5C8 6.33 7.33 7 6.5 7C5.67 7 5 6.33 5 5.5C5 4.67 5.67 4 6.5 4ZM18 20H2V16H7.08L4.15 11.98L5.77 10.8L9 15.23L10 13.85L11 15.23L14.23 10.8L15.85 11.98L12.92 16H18V20ZM18 14H14.08L16.85 10.2L15.23 9.02L12 13.45L10.2 10.98L9.01 12.62L7.92 14H2V9H18V14Z" />
            </svg>
          </button>
          <button type="button" className="message-input-tool" title="GIF">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.5 3C1.672 3 1 3.672 1 4.5V19.5C1 20.328 1.672 21 2.5 21H21.5C22.328 21 23 20.328 23 19.5V4.5C23 3.672 22.328 3 21.5 3H2.5ZM8 10V13H9V14H6V9H9V10H8ZM11 9H12V14H11V9ZM14 9V14H15V12H17V11H15V10H18V9H14Z" />
            </svg>
          </button>
          <button type="button" className="message-input-tool" title="Emoji">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.486 2 2 6.486 2 12C2 17.514 6.486 22 12 22C17.514 22 22 17.514 22 12C22 6.486 17.514 2 12 2ZM8.5 8C9.328 8 10 8.672 10 9.5C10 10.328 9.328 11 8.5 11C7.672 11 7 10.328 7 9.5C7 8.672 7.672 8 8.5 8ZM15.5 8C16.328 8 17 8.672 17 9.5C17 10.328 16.328 11 15.5 11C14.672 11 14 10.328 14 9.5C14 8.672 14.672 8 15.5 8ZM12 18C9.636 18 7.604 16.585 6.646 14.577L7.551 14.123C8.361 15.817 10.024 17 12 17C13.976 17 15.639 15.817 16.449 14.123L17.354 14.577C16.396 16.585 14.364 18 12 18Z" />
            </svg>
          </button>
        </div>
      </form>
    </aside>
  );
}

// ─── Message list with grouping ───────────────────────────────────────────────

function MessageList({
  messages,
  users,
  userByHex,
  nicknameByHex,
  reactionsByMessage,
  allChannelMessages,
  currentIdentityHex,
  compact,
  channelServerId,
  onJumpToMessage,
  onReply,
  onEdit,
  onDelete,
  onStartThread,
  onOpenThread,
  onToggleReaction,
  onTogglePin,
  onOpenProfile,
  flashMessageId,
  threadsByParent,
}: {
  messages: readonly MessageRow[];
  users: readonly User[];
  userByHex: Map<string, User>;
  nicknameByHex?: Map<string, string>;
  reactionsByMessage: Map<string, Reaction[]>;
  allChannelMessages: readonly MessageRow[];
  currentIdentityHex: string;
  compact?: boolean;
  channelServerId?: bigint;
  onJumpToMessage?: (msgId: bigint) => void;
  onReply?: (msg: MessageRow) => void;
  onEdit?: (msgId: bigint, text: string) => void;
  onDelete?: (msgId: bigint) => void;
  onStartThread?: (msg: MessageRow) => void;
  onOpenThread?: (msg: MessageRow) => void;
  onToggleReaction?: (msgId: bigint, emoji: string) => void;
  onTogglePin?: (msg: MessageRow) => void;
  onOpenProfile?: (user: User, rect: DOMRect) => void;
  flashMessageId?: bigint | null;
  threadsByParent?: Map<string, Thread>;
}) {
  void users; // used via userByHex

  const [menuMsgId, setMenuMsgId] = useState<bigint | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const [pickerMsgId, setPickerMsgId] = useState<bigint | null>(null);
  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [editingId, setEditingId] = useState<bigint | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const closeMenu = () => {
    setMenuMsgId(null);
    setMenuPos(null);
  };

  const closePicker = () => {
    setPickerMsgId(null);
    setPickerPos(null);
  };

  const openPicker = (msgId: bigint, anchorEl: HTMLElement) => {
    const rect = anchorEl.getBoundingClientRect();
    const PICKER_W = 400;
    // Anchor below and to the left of the button's right edge
    const left = Math.max(8, Math.min(rect.right - PICKER_W, window.innerWidth - PICKER_W - 8));
    const top = rect.bottom + 4;
    setPickerPos({ top, left });
    setPickerMsgId(msgId);
  };

  useEffect(() => {
    if (menuMsgId === null && pickerMsgId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeMenu();
        closePicker();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuMsgId, pickerMsgId]);

  // After render, measure menu and flip/clamp so it stays in viewport
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el || !menuPos) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let { top, left } = menuPos;
    const maxTop = window.innerHeight - rect.height - pad;
    const maxLeft = window.innerWidth - rect.width - pad;
    if (top > maxTop) top = Math.max(pad, maxTop);
    if (left > maxLeft) left = Math.max(pad, maxLeft);
    if (top !== menuPos.top || left !== menuPos.left) {
      setMenuPos({ top, left });
    }
  }, [menuPos, menuMsgId]);

  // Same clamping for emoji picker
  useLayoutEffect(() => {
    const el = pickerRef.current;
    if (!el || !pickerPos) return;
    const rect = el.getBoundingClientRect();
    const pad = 8;
    let { top, left } = pickerPos;
    const maxTop = window.innerHeight - rect.height - pad;
    const maxLeft = window.innerWidth - rect.width - pad;
    if (top > maxTop) top = Math.max(pad, maxTop);
    if (left > maxLeft) left = Math.max(pad, maxLeft);
    if (top !== pickerPos.top || left !== pickerPos.left) {
      setPickerPos({ top, left });
    }
  }, [pickerPos, pickerMsgId]);

  const openContextMenu = (msgId: bigint, e: React.MouseEvent) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const menuWidth = 224;
    const left = Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8));
    // Tentatively anchor below the trigger; useLayoutEffect will flip up if needed
    setMenuPos({ top: rect.bottom + 4, left });
    setMenuMsgId(msgId);
  };

  const beginEdit = (msg: MessageRow) => {
    setEditingId(msg.id);
    setEditDraft(msg.text);
    closeMenu();
  };

  const saveEdit = (msgId: bigint) => {
    const text = editDraft.trim();
    if (text && onEdit) onEdit(msgId, text);
    setEditingId(null);
  };

  const copyToClipboard = (text: string) => {
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  };

  const activeMenuMsg = messages.find(m => m.id === menuMsgId) ?? null;
  const activeMenuThread = activeMenuMsg
    ? threadsByParent?.get(activeMenuMsg.id.toString())
    : undefined;

  return (
    <>
      {messages.map((msg, idx) => {
        const prev = messages[idx - 1];
        const sameAuthor = prev && prev.authorId.toHexString() === msg.authorId.toHexString();
        const closeInTime =
          prev &&
          msg.sent.microsSinceUnixEpoch - prev.sent.microsSinceUnixEpoch < GROUP_WINDOW_MICROS;
        // Never group replies — they must always show their own avatar so the
        // reply indicator L-shape can connect to it.
        const isReply = msg.replyToId !== 0n;
        const grouped = !compact && sameAuthor && closeInTime && !isReply;

        const authorHex = msg.authorId.toHexString();
        const author = userByHex.get(authorHex);
        const displayName =
          nicknameByHex?.get(authorHex) || author?.name || generateAlias(authorHex);
        const color = author?.avatarColor ?? '#5865F2';
        const isMine = authorHex === currentIdentityHex;

        const date = new Date(Number(msg.sent.microsSinceUnixEpoch / 1000n));
        const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const dateStr = date.toLocaleDateString([], {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        });

        // Replied-to parent
        const replyParent =
          msg.replyToId !== 0n
            ? (allChannelMessages.find(m => m.id === msg.replyToId) ?? null)
            : null;

        const msgReactions = reactionsByMessage.get(msg.id.toString()) ?? [];
        const reactionGroups = new Map<string, { count: number; mine: boolean; users: string[] }>();
        for (const r of msgReactions) {
          const entry = reactionGroups.get(r.emoji) ?? {
            count: 0,
            mine: false,
            users: [] as string[],
          };
          entry.count++;
          const rHex = r.userIdentity.toHexString();
          if (rHex === currentIdentityHex) entry.mine = true;
          const rName =
            nicknameByHex?.get(rHex) || userByHex.get(rHex)?.name || generateAlias(rHex);
          entry.users.push(rName);
          reactionGroups.set(r.emoji, entry);
        }

        const existingThread = threadsByParent?.get(msg.id.toString());

        const isFlashing =
          flashMessageId !== undefined && flashMessageId !== null && flashMessageId === msg.id;
        return (
          <div
            key={msg.id.toString()}
            data-message-id={msg.id.toString()}
            className={`message ${grouped ? 'grouped' : ''} ${compact ? 'compact' : ''} ${isMine ? 'mine' : ''} ${isFlashing ? 'flash' : ''}`}
          >
            {!grouped ? (
              <div
                className="message-avatar clickable"
                style={{ backgroundColor: color }}
                onClick={e => {
                  if (author && onOpenProfile) {
                    onOpenProfile(author, (e.currentTarget as HTMLElement).getBoundingClientRect());
                  }
                }}
              >
                {displayName[0]?.toUpperCase()}
              </div>
            ) : (
              <div className="message-avatar-spacer" />
            )}

            {/* Reply-to quote — sits ABOVE the avatar row, spans cols 1+2 */}
            {replyParent && (
              <div
                className="reply-quote-line"
                onClick={() => onJumpToMessage?.(replyParent.id)}
                style={{ cursor: 'pointer' }}
              >
                <span className="reply-quote-icon">↩</span>
                <span
                  className="reply-quote-author"
                  style={{
                    color: userByHex.get(replyParent.authorId.toHexString())?.avatarColor ?? '#999',
                  }}
                >
                  {nicknameByHex?.get(replyParent.authorId.toHexString()) ??
                    userByHex.get(replyParent.authorId.toHexString())?.name ??
                    'unknown'}
                </span>
                <span className="reply-quote-text">{replyParent.text.slice(0, 80)}</span>
              </div>
            )}

            <div className="message-body">
              {!grouped && (
                <div className="message-head">
                  <span
                    className="message-author clickable"
                    style={{ color }}
                    onClick={e => {
                      if (author && onOpenProfile) {
                        onOpenProfile(
                          author,
                          (e.currentTarget as HTMLElement).getBoundingClientRect()
                        );
                      }
                    }}
                  >
                    {displayName}
                  </span>
                  <span className="message-timestamp">
                    {dateStr} {timeStr}
                  </span>
                  {msg.pinned && (
                    <span className="pinned-badge" title="Pinned">
                      📌
                    </span>
                  )}
                </div>
              )}

              {editingId === msg.id ? (
                <div className="message-edit">
                  <textarea
                    className="message-edit-textarea"
                    value={editDraft}
                    autoFocus
                    onChange={e => setEditDraft(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Escape') {
                        e.preventDefault();
                        setEditingId(null);
                      } else if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        saveEdit(msg.id);
                      }
                    }}
                  />
                  <div className="message-edit-hint">
                    escape to{' '}
                    <span className="message-edit-link" onClick={() => setEditingId(null)}>
                      cancel
                    </span>{' '}
                    • enter to{' '}
                    <span className="message-edit-link" onClick={() => saveEdit(msg.id)}>
                      save
                    </span>
                  </div>
                </div>
              ) : (
                <div className="message-text">
                  <MessageText text={msg.text} />
                  {msg.editedAt && <span className="edited-tag"> (edited)</span>}
                </div>
              )}

              {/* Attachment */}
              {msg.attachmentUrl && (
                <div className="attachment-wrap">
                  {/\.(png|jpe?g|gif|webp|svg)(\?.*)?$/i.test(msg.attachmentUrl) ? (
                    <img
                      className="attachment-img"
                      src={msg.attachmentUrl}
                      alt="attachment"
                      onError={e => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  ) : (
                    <a
                      className="attachment-link"
                      href={msg.attachmentUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                    >
                      📎 {msg.attachmentUrl}
                    </a>
                  )}
                </div>
              )}

              {/* Thread preview */}
              {existingThread && (
                <div className="thread-preview" onClick={() => onOpenThread?.(msg)}>
                  <span className="thread-icon">↳</span>
                  <span className="thread-name">{existingThread.name}</span>
                  <span className="thread-open">View thread →</span>
                </div>
              )}

              {/* Reactions */}
              {reactionGroups.size > 0 && (
                <div className="reaction-row">
                  {[...reactionGroups.entries()].map(([emoji, { count, mine, users }]) => {
                    const tooltip = formatReactionTooltip(users, emoji, mine);
                    return (
                      <button
                        key={emoji}
                        className={`reaction-pill ${mine ? 'mine' : ''}`}
                        onClick={() => onToggleReaction?.(msg.id, emoji)}
                      >
                        <span className="reaction-pill-emoji">{emoji}</span>
                        <span className="reaction-pill-count">{count}</span>
                        <span className="reaction-tooltip">{tooltip}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Hover actions — Discord-style compact toolbar */}
            <div className="message-actions-wrap">
              <div className="message-actions">
                {REACTION_EMOJIS.slice(0, 3).map(e => (
                  <button
                    key={e}
                    className="msg-tool-btn emoji"
                    title={`React with ${e}`}
                    onClick={() => onToggleReaction?.(msg.id, e)}
                  >
                    {e}
                  </button>
                ))}
                <button
                  className="msg-tool-btn"
                  title="Add Reaction"
                  onClick={ev => {
                    ev.stopPropagation();
                    openPicker(msg.id, ev.currentTarget as HTMLElement);
                  }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12.2 2A10 10 0 1 0 22 12.2a1 1 0 1 0-2 0A8 8 0 1 1 11.8 4a1 1 0 1 0 .4-2Z" />
                    <path d="M15.5 10.5a1.5 1.5 0 1 0-1.5-1.5 1.5 1.5 0 0 0 1.5 1.5ZM8.5 10.5A1.5 1.5 0 1 0 7 9a1.5 1.5 0 0 0 1.5 1.5ZM16.75 13.25a.75.75 0 0 0-.75.75 4 4 0 0 1-8 0 .75.75 0 0 0-1.5 0 5.5 5.5 0 0 0 11 0 .75.75 0 0 0-.75-.75ZM19 2h2v2h2v2h-2v2h-2V6h-2V4h2V2Z" />
                  </svg>
                </button>
                {isMine && onEdit && (
                  <button className="msg-tool-btn" title="Edit" onClick={() => beginEdit(msg)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M19.2 5.5l-.7-.7a2 2 0 0 0-2.8 0l-1.8 1.8 3.5 3.5 1.8-1.8a2 2 0 0 0 0-2.8ZM3 17.5V21h3.5l10.1-10.1-3.5-3.5L3 17.5Z" />
                    </svg>
                  </button>
                )}
                {onReply && (
                  <button className="msg-tool-btn" title="Reply" onClick={() => onReply(msg)}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M10 8V4l-8 8 8 8v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" />
                    </svg>
                  </button>
                )}
                <button
                  className="msg-tool-btn"
                  title="More"
                  onClick={ev => openContextMenu(msg.id, ev)}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM14 12a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM19 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        );
      })}

      {/* Full context menu rendered once */}
      {menuMsgId !== null && menuPos && activeMenuMsg && (
        <>
          <div className="msg-ctx-backdrop" onMouseDown={closeMenu} />
          <div
            ref={menuRef}
            className="msg-ctx-menu"
            style={{ top: menuPos.top, left: menuPos.left }}
            onMouseDown={e => e.stopPropagation()}
          >
            {/* Quick emoji row */}
            <div className="msg-ctx-emoji-row">
              {REACTION_EMOJIS.slice(0, 5).map(e => (
                <button
                  key={e}
                  className="msg-ctx-emoji"
                  onClick={() => {
                    onToggleReaction?.(activeMenuMsg.id, e);
                    closeMenu();
                  }}
                >
                  {e}
                </button>
              ))}
            </div>

            <button
              className="msg-ctx-item"
              onClick={ev => {
                ev.stopPropagation();
                openPicker(activeMenuMsg.id, ev.currentTarget as HTMLElement);
                closeMenu();
              }}
            >
              <span>Add Reaction</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>

            {activeMenuMsg.authorId.toHexString() === currentIdentityHex && onEdit && (
              <button className="msg-ctx-item" onClick={() => beginEdit(activeMenuMsg)}>
                <span>Edit Message</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M19.2 5.5l-.7-.7a2 2 0 0 0-2.8 0l-1.8 1.8 3.5 3.5 1.8-1.8a2 2 0 0 0 0-2.8ZM3 17.5V21h3.5l10.1-10.1-3.5-3.5L3 17.5Z" />
                </svg>
              </button>
            )}

            {onReply && (
              <button
                className="msg-ctx-item"
                onClick={() => {
                  onReply(activeMenuMsg);
                  closeMenu();
                }}
              >
                <span>Reply</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 8V4l-8 8 8 8v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11Z" />
                </svg>
              </button>
            )}

            <button className="msg-ctx-item disabled" disabled>
              <span>Forward</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M14 8V4l8 8-8 8v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11Z" />
              </svg>
            </button>

            {threadsByParent &&
              (activeMenuThread ? (
                <button
                  className="msg-ctx-item"
                  onClick={() => {
                    onOpenThread?.(activeMenuMsg);
                    closeMenu();
                  }}
                >
                  <span>Open Thread</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M5.43 21a8.5 8.5 0 0 1 12.14-12A6 6 0 0 0 12 3a9 9 0 0 0-9 9 9 9 0 0 0 2.43 9Zm2.4-7a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
                  </svg>
                </button>
              ) : (
                onStartThread && (
                  <button
                    className="msg-ctx-item"
                    onClick={() => {
                      onStartThread(activeMenuMsg);
                      closeMenu();
                    }}
                  >
                    <span>Create Thread</span>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M5.43 21a8.5 8.5 0 0 1 12.14-12A6 6 0 0 0 12 3a9 9 0 0 0-9 9 9 9 0 0 0 2.43 9Zm2.4-7a6.5 6.5 0 1 0 13 0 6.5 6.5 0 0 0-13 0Z" />
                    </svg>
                  </button>
                )
              ))}

            <div className="msg-ctx-divider" />

            <button
              className="msg-ctx-item"
              onClick={() => {
                copyToClipboard(activeMenuMsg.text);
                closeMenu();
              }}
            >
              <span>Copy Text</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z" />
              </svg>
            </button>

            {onTogglePin && activeMenuMsg.threadId === 0n && (
              <button
                className="msg-ctx-item"
                onClick={() => {
                  onTogglePin(activeMenuMsg);
                  closeMenu();
                }}
              >
                <span>{activeMenuMsg.pinned ? 'Unpin Message' : 'Pin Message'}</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2Z" />
                </svg>
              </button>
            )}

            <button className="msg-ctx-item disabled" disabled>
              <span>Apps</span>
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>

            <button className="msg-ctx-item disabled" disabled>
              <span>Mark Unread</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2Zm0 4l-8 5-8-5V6l8 5 8-5v2Z" />
              </svg>
            </button>

            <button
              className={`msg-ctx-item ${channelServerId === undefined ? 'disabled' : ''}`}
              disabled={channelServerId === undefined}
              onClick={() => {
                if (channelServerId === undefined) return;
                const link = buildMessageLink(
                  channelServerId,
                  activeMenuMsg.channelId,
                  activeMenuMsg.id
                );
                copyToClipboard(link);
                closeMenu();
              }}
            >
              <span>Copy Message Link</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3.9 12a3.1 3.1 0 0 1 3.1-3.1h4V7H7a5 5 0 1 0 0 10h4v-1.9H7A3.1 3.1 0 0 1 3.9 12ZM8 13h8v-2H8v2Zm9-6h-4v1.9h4a3.1 3.1 0 1 1 0 6.2h-4V17h4a5 5 0 0 0 0-10Z" />
              </svg>
            </button>

            <button className="msg-ctx-item disabled" disabled>
              <span>Speak Message</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M3 9v6h4l5 5V4L7 9H3Zm13.5 3A4.5 4.5 0 0 0 14 7.97v8.05A4.5 4.5 0 0 0 16.5 12Z" />
              </svg>
            </button>

            {activeMenuMsg.authorId.toHexString() === currentIdentityHex && onDelete && (
              <>
                <div className="msg-ctx-divider" />
                <button
                  className="msg-ctx-item danger"
                  onClick={() => {
                    onDelete(activeMenuMsg.id);
                    closeMenu();
                  }}
                >
                  <span>Delete Message</span>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />
                  </svg>
                </button>
              </>
            )}

            <div className="msg-ctx-divider" />

            <button
              className="msg-ctx-item"
              onClick={() => {
                copyToClipboard(activeMenuMsg.id.toString());
                closeMenu();
              }}
            >
              <span>Copy Message ID</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M2 4v16h20V4H2Zm7 11H7v-3H5v3H3V9h2v1.2h4V9h2V15Zm5-3h-1v2h2v1h-2v2h-1v-4h-1v-1h3v1Zm2-3h-2v4h2V9Z" />
              </svg>
            </button>
          </div>
        </>
      )}

      {/* Discord-style emoji reaction picker */}
      {pickerMsgId !== null && pickerPos && (
        <EmojiPickerPopover
          pickerRef={pickerRef}
          top={pickerPos.top}
          left={pickerPos.left}
          onPick={emoji => {
            onToggleReaction?.(pickerMsgId, emoji);
            closePicker();
          }}
          onClose={closePicker}
        />
      )}
    </>
  );
}

// ─── Discord-style emoji picker popover ─────────────────────────────────────

function EmojiPickerPopover({
  pickerRef,
  top,
  left,
  onPick,
  onClose,
}: {
  pickerRef: React.RefObject<HTMLDivElement | null>;
  top: number;
  left: number;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hovered, setHovered] = useState<string | null>(null);
  const q = query.trim().toLowerCase();
  const filtered = REACTION_EMOJIS.filter(e => {
    if (!q) return true;
    return (EMOJI_NAMES[e] ?? '').toLowerCase().includes(q) || e.includes(q);
  });
  const displayEmoji = hovered ?? filtered[0] ?? null;

  return (
    <>
      <div className="emoji-picker-backdrop" onMouseDown={onClose} />
      <div
        ref={pickerRef}
        className="emoji-picker"
        style={{ top, left }}
        onMouseDown={e => e.stopPropagation()}
      >
        <header className="emoji-picker-header">
          <div className="emoji-picker-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M21.707 20.293 16.314 14.9a8 8 0 1 0-1.414 1.414l5.393 5.393a1 1 0 0 0 1.414-1.414ZM10 16a6 6 0 1 1 0-12 6 6 0 0 1 0 12Z" />
            </svg>
            <input
              type="text"
              placeholder="Find the perfect reaction"
              value={query}
              onChange={e => setQuery(e.target.value)}
              autoFocus
            />
          </div>
          <button className="emoji-picker-add-btn" disabled title="Coming soon">
            Add Emoji
          </button>
        </header>

        <div className="emoji-picker-body">
          <aside className="emoji-picker-sidebar">
            <button className="emoji-picker-cat active" title="Frequently Used">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2Zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8Zm1-13h-1.5v6l5.25 3.15.75-1.23-4.5-2.67Z" />
              </svg>
            </button>
          </aside>

          <div className="emoji-picker-grid-wrap">
            {filtered.length === 0 ? (
              <div className="emoji-picker-empty">No emoji matching &ldquo;{query}&rdquo;</div>
            ) : (
              <>
                <div className="emoji-picker-category">Frequently Used</div>
                <div className="emoji-picker-grid">
                  {filtered.map(e => (
                    <button
                      key={e}
                      type="button"
                      className="emoji-picker-cell"
                      onClick={() => onPick(e)}
                      onMouseEnter={() => setHovered(e)}
                    >
                      {e}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="emoji-picker-footer">
          {displayEmoji ? (
            <>
              <span className="emoji-picker-footer-emoji">{displayEmoji}</span>
              <span className="emoji-picker-footer-name">
                :{EMOJI_NAMES[displayEmoji] ?? 'emoji'}:
              </span>
            </>
          ) : (
            <span className="emoji-picker-footer-hint">Pick an emoji…</span>
          )}
        </footer>
      </div>
    </>
  );
}

// ─── Pinned messages popover ──────────────────────────────────────────────────

function PinnedPanel({
  messages,
  userByHex,
  onClose,
  onJump,
  onUnpin,
}: {
  messages: MessageRow[];
  userByHex: Map<string, User>;
  onClose: () => void;
  onJump: (msg: MessageRow) => void;
  onUnpin: (msg: MessageRow, shiftHeld: boolean) => void;
}) {
  return (
    <>
      <div className="pinned-backdrop" onClick={onClose} />
      <div className="pinned-panel" onClick={e => e.stopPropagation()}>
        <header className="pinned-panel-header">
          <span>Pinned Messages</span>
          <button className="icon-btn" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="pinned-list">
          {messages.length === 0 ? (
            <div className="pinned-empty">
              <p>This channel doesn&apos;t have any pinned messages yet.</p>
            </div>
          ) : (
            messages.map(msg => {
              const author = userByHex.get(msg.authorId.toHexString());
              const name = author?.name || generateAlias(msg.authorId.toHexString());
              const color = author?.avatarColor ?? '#5865F2';
              const date = new Date(Number(msg.sent.microsSinceUnixEpoch / 1000n));
              return (
                <div key={msg.id.toString()} className="pinned-item">
                  <div className="pinned-avatar" style={{ backgroundColor: color }}>
                    {name[0]?.toUpperCase()}
                  </div>
                  <div className="pinned-body">
                    <div className="pinned-head">
                      <span className="pinned-author" style={{ color }}>
                        {name}
                      </span>
                      <span className="pinned-time">
                        {date.toLocaleString([], {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <div className="pinned-text">
                      <MessageText text={msg.text} />
                    </div>
                  </div>
                  <div className="pinned-item-actions">
                    <button
                      type="button"
                      className="pinned-jump-btn"
                      title="Jump to message"
                      onClick={() => onJump(msg)}
                    >
                      Jump
                    </button>
                    <button
                      type="button"
                      className="pinned-unpin-btn"
                      title="Unpin message (hold Shift to skip confirmation)"
                      onClick={e => onUnpin(msg, e.shiftKey)}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
                      </svg>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// ─── Unpin confirmation modal ───────────────────────────────────────────────

function UnpinConfirmModal({
  message,
  author,
  onCancel,
  onConfirm,
}: {
  message: MessageRow;
  author: User | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const name = author?.name || generateAlias(message.authorId.toHexString());
  const color = author?.avatarColor ?? '#5865F2';
  const date = new Date(Number(message.sent.microsSinceUnixEpoch / 1000n));

  return (
    <div className="modal-backdrop" onMouseDown={onCancel}>
      <div className="modal unpin-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="unpin-modal-header">
          <h3>Unpin Message</h3>
          <button type="button" className="unpin-modal-close" onClick={onCancel} aria-label="Close">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
              <path d="M18.4 4L12 10.4L5.6 4L4 5.6L10.4 12L4 18.4L5.6 20L12 13.6L18.4 20L20 18.4L13.6 12L20 5.6L18.4 4Z" />
            </svg>
          </button>
        </div>
        <div className="unpin-modal-body">
          <p className="unpin-modal-question">You sure you want to remove this pinned message?</p>
          <div className="unpin-modal-preview">
            <div className="pinned-avatar" style={{ backgroundColor: color }}>
              {name[0]?.toUpperCase()}
            </div>
            <div className="pinned-body">
              <div className="pinned-head">
                <span className="pinned-author" style={{ color }}>
                  {name}
                </span>
                <span className="pinned-time">
                  {date.toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </span>
              </div>
              <div className="pinned-text">
                <MessageText text={message.text} />
              </div>
            </div>
          </div>
          <p className="unpin-modal-protip">
            <span className="unpin-modal-protip-label">PROTIP:</span> You can hold down{' '}
            <kbd>shift</kbd> when clicking <b>unpin message</b> to bypass this confirmation
            entirely.
          </p>
        </div>
        <div className="modal-actions unpin-modal-actions">
          <button type="button" className="btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="btn-danger" onClick={onConfirm}>
            Remove it please!
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline header search dropdown ──────────────────────────────────────────

function SearchDropdown({
  query,
  messages,
  members,
  users,
  userByHex,
  nicknameByHex,
  onJump,
  onOpenProfile,
  onClose,
}: {
  query: string;
  messages: MessageRow[];
  members: ServerMember[];
  users: readonly User[];
  userByHex: Map<string, User>;
  nicknameByHex: Map<string, string>;
  onJump: (id: bigint) => void;
  onOpenProfile: (user: User, rect: DOMRect) => void;
  onClose: () => void;
}) {
  const q = query.trim().toLowerCase();
  if (!q) return null;

  // Member matches — check nickname, name, or hex prefix
  const memberMatches: User[] = [];
  for (const m of members) {
    const hex = m.userIdentity.toHexString();
    const u = userByHex.get(hex);
    if (!u) continue;
    const nick = m.nickname ?? '';
    const name = u.name ?? '';
    if (
      nick.toLowerCase().includes(q) ||
      name.toLowerCase().includes(q) ||
      hex.toLowerCase().startsWith(q)
    ) {
      memberMatches.push(u);
      if (memberMatches.length >= 3) break;
    }
  }

  // Message matches — newest first
  const messageMatches = messages
    .filter(m => m.text.toLowerCase().includes(q))
    .slice(-5)
    .reverse();

  // Mention matches — same set as From User, but only show if any of the text
  // matches include `@name` style mentions; for simplicity we reuse members.
  const mentionMatches: User[] = memberMatches.slice(0, 3);

  const renderMemberRow = (u: User, label: 'from' | 'mentions'): React.ReactElement => {
    const hex = u.identity.toHexString();
    const nick = nicknameByHex.get(hex);
    const name = nick || u.name || generateAlias(hex);
    return (
      <button
        key={`${label}-${hex}`}
        className="search-dd-row"
        onClick={e => onOpenProfile(u, (e.currentTarget as HTMLElement).getBoundingClientRect())}
      >
        <span className="search-dd-prefix">
          {label === 'from' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 12C14.21 12 16 10.21 16 8C16 5.79 14.21 4 12 4C9.79 4 8 5.79 8 8C8 10.21 9.79 12 12 12ZM12 14C9.33 14 4 15.34 4 18V20H20V18C20 15.34 14.67 14 12 14Z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C14.04 22 15.93 21.38 17.5 20.34L16.07 18.92C14.89 19.59 13.5 20 12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12V13.43C20 14.22 19.29 15 18.5 15C17.71 15 17 14.22 17 13.43V12C17 9.24 14.76 7 12 7C9.24 7 7 9.24 7 12C7 14.76 9.24 17 12 17C13.38 17 14.63 16.44 15.54 15.54C16.19 16.43 17.31 17 18.5 17C20.46 17 22 15.41 22 13.43V12C22 6.48 17.52 2 12 2ZM12 15C10.34 15 9 13.66 9 12C9 10.34 10.34 9 12 9C13.66 9 15 10.34 15 12C15 13.66 13.66 15 12 15Z" />
            </svg>
          )}
        </span>
        <span className="search-dd-avatar" style={{ backgroundColor: u.avatarColor }}>
          {name[0]?.toUpperCase()}
        </span>
        <span className="search-dd-body">
          <span className="search-dd-title">{name}</span>
          <span className="search-dd-sub">
            {label}: <span className="search-dd-sub-value">{u.name || hex.slice(0, 8)}</span>
          </span>
        </span>
      </button>
    );
  };

  const renderMessageRow = (msg: MessageRow): React.ReactElement => {
    const hex = msg.authorId.toHexString();
    const author = userByHex.get(hex);
    const name = nicknameByHex.get(hex) || author?.name || generateAlias(hex);
    return (
      <button
        key={`msg-${msg.id.toString()}`}
        className="search-dd-row"
        onClick={() => onJump(msg.id)}
      >
        <span className="search-dd-prefix">
          <span className="search-dd-hash">#</span>
        </span>
        <span className="search-dd-body">
          <span className="search-dd-title search-dd-msg-line">
            <span className="search-dd-in">in:</span>{' '}
            <span className="search-dd-channel-name">💬 {name}:</span> {highlightQuery(msg.text, q)}
          </span>
        </span>
      </button>
    );
  };

  const hasResults = memberMatches.length + messageMatches.length + mentionMatches.length > 0;

  return (
    <>
      <div className="search-dd-backdrop" onClick={onClose} />
      <div className="search-dd">
        <button
          type="button"
          className="search-dd-row search-dd-action"
          onClick={e => e.preventDefault()}
        >
          <span className="search-dd-prefix">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z" />
            </svg>
          </span>
          <span className="search-dd-title">
            Search for <b>{query}</b>
          </span>
        </button>
        <button
          type="button"
          className="search-dd-row search-dd-action"
          onClick={e => e.preventDefault()}
        >
          <span className="search-dd-prefix">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M4 6H20V8H4V6ZM7 11H17V13H7V11ZM10 16H14V18H10V16Z" />
            </svg>
          </span>
          <span className="search-dd-title">Add search filters</span>
        </button>

        {memberMatches.length > 0 && (
          <>
            <div className="search-dd-section">FROM USER</div>
            {memberMatches.map(u => renderMemberRow(u, 'from'))}
          </>
        )}

        {messageMatches.length > 0 && (
          <>
            <div className="search-dd-section">IN CHANNEL</div>
            {messageMatches.map(renderMessageRow)}
          </>
        )}

        {mentionMatches.length > 0 && (
          <>
            <div className="search-dd-section">MENTIONS USER</div>
            {mentionMatches.map(u => renderMemberRow(u, 'mentions'))}
          </>
        )}

        {!hasResults && <div className="search-dd-empty">No results for "{query}"</div>}
      </div>
    </>
  );
}

function highlightQuery(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const idx = text.toLowerCase().indexOf(q);
  if (idx === -1) return text.slice(0, 60) + (text.length > 60 ? '…' : '');
  const start = Math.max(0, idx - 15);
  const end = Math.min(text.length, idx + q.length + 40);
  const pre = start > 0 ? '…' : '';
  const post = end < text.length ? '…' : '';
  return (
    <>
      {pre}
      {text.slice(start, idx)}
      <mark className="search-highlight">{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length, end)}
      {post}
    </>
  );
}

// ─── Threads popover (Discord-style) ───────────────────────────────────────

function ThreadsPanel({
  threads,
  allChannelMessages,
  userByHex,
  nicknameByHex,
  onOpenThread,
  onClose,
}: {
  threads: Thread[];
  allChannelMessages: MessageRow[];
  userByHex: Map<string, User>;
  nicknameByHex: Map<string, string>;
  onOpenThread: (id: bigint) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');

  // Count replies per thread
  const repliesByThread = new Map<string, number>();
  for (const m of allChannelMessages) {
    if (m.threadId !== 0n) {
      const key = m.threadId.toString();
      repliesByThread.set(key, (repliesByThread.get(key) ?? 0) + 1);
    }
  }

  const q = query.trim().toLowerCase();
  const filtered = threads
    .filter(t => !q || t.name.toLowerCase().includes(q))
    .sort((a, b) => (a.createdAt.microsSinceUnixEpoch < b.createdAt.microsSinceUnixEpoch ? 1 : -1));

  const threadsIconSvg = (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12.5913 13.3345L9.16674 11.3571L12.5913 9.38018V6.41791L9.16674 8.39543V4.44051L6.60241 2.96069L6.60241 8.39543L3.1778 10.3729V13.3352L6.60241 11.3571V15.3127L9.16674 16.7925V20.7476L9.16739 20.7484L11.7317 22.2282V18.2731L15.1575 20.251V17.2876L11.7317 15.3102V13.3345L12.5913 13.3345Z" />
      <path d="M17.7213 12.3449L20.8219 10.5547V7.59242L17.7213 9.38269V5.4276L15.1579 3.94776V9.38269L12.5914 10.8606V13.8228L15.1579 12.3449V16.3024L17.7213 17.7803V21.7354L20.8219 19.9451V16.9828L17.7213 18.7731V12.3449Z" />
    </svg>
  );

  return (
    <>
      <div className="threads-backdrop" onClick={onClose} />
      <div className="threads-popover">
        <header className="threads-popover-header">
          <div className="threads-popover-title">
            {threadsIconSvg}
            <span>Threads</span>
          </div>
          <div className="threads-popover-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M15.5 14H14.71L14.43 13.73C15.41 12.59 16 11.11 16 9.5C16 5.91 13.09 3 9.5 3C5.91 3 3 5.91 3 9.5C3 13.09 5.91 16 9.5 16C11.11 16 12.59 15.41 13.73 14.43L14 14.71V15.5L19 20.49L20.49 19L15.5 14ZM9.5 14C7.01 14 5 11.99 5 9.5C5 7.01 7.01 5 9.5 5C11.99 5 14 7.01 14 9.5C14 11.99 11.99 14 9.5 14Z" />
            </svg>
            <input
              type="text"
              placeholder="Search for Thread Name"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </div>
          <button className="btn-primary threads-popover-create" disabled>
            Create
          </button>
        </header>

        {filtered.length === 0 ? (
          <div className="threads-empty-state">
            <div className="threads-empty-icon">
              <svg width="56" height="56" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12.5913 13.3345L9.16674 11.3571L12.5913 9.38018V6.41791L9.16674 8.39543V4.44051L6.60241 2.96069L6.60241 8.39543L3.1778 10.3729V13.3352L6.60241 11.3571V15.3127L9.16674 16.7925V20.7476L9.16739 20.7484L11.7317 22.2282V18.2731L15.1575 20.251V17.2876L11.7317 15.3102V13.3345L12.5913 13.3345Z" />
                <path d="M17.7213 12.3449L20.8219 10.5547V7.59242L17.7213 9.38269V5.4276L15.1579 3.94776V9.38269L12.5914 10.8606V13.8228L15.1579 12.3449V16.3024L17.7213 17.7803V21.7354L20.8219 19.9451V16.9828L17.7213 18.7731V12.3449Z" />
              </svg>
            </div>
            <h3 className="threads-empty-title">
              {q ? `No threads match "${query}"` : 'There are no threads.'}
            </h3>
            <p className="threads-empty-subtitle">
              {q
                ? 'Try a different search term.'
                : 'Stay focused on a conversation with a thread — a temporary text channel.'}
            </p>
            {!q && (
              <button className="btn-primary threads-empty-button" disabled>
                Create Thread
              </button>
            )}
          </div>
        ) : (
          <div className="threads-list">
            {filtered.map(th => {
              const parent = allChannelMessages.find(m => m.id === th.parentMessageId);
              const creatorHex = th.createdBy.toHexString();
              const creatorName =
                nicknameByHex.get(creatorHex) ||
                userByHex.get(creatorHex)?.name ||
                generateAlias(creatorHex);
              const creatorColor = userByHex.get(creatorHex)?.avatarColor ?? '#5865F2';
              const replyCount = repliesByThread.get(th.id.toString()) ?? 0;
              const created = new Date(Number(th.createdAt.microsSinceUnixEpoch / 1000n));
              return (
                <button
                  key={th.id.toString()}
                  className="threads-list-item"
                  onClick={() => onOpenThread(th.id)}
                >
                  <div className="threads-list-avatar" style={{ backgroundColor: creatorColor }}>
                    {creatorName[0]?.toUpperCase()}
                  </div>
                  <div className="threads-list-body">
                    <div className="threads-list-head">
                      <span className="threads-list-title" style={{ color: creatorColor }}>
                        {th.name}
                      </span>
                      <span className="threads-list-time">
                        {created.toLocaleDateString([], {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    {parent && (
                      <div className="threads-list-parent">↳ {parent.text.slice(0, 90)}</div>
                    )}
                    <div className="threads-list-meta">
                      {replyCount === 0
                        ? 'No replies yet'
                        : `${replyCount} ${replyCount === 1 ? 'reply' : 'replies'}`}
                      {' · '}
                      Started by {creatorName}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
