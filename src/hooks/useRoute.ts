/**
 * Minimal URL routing hook — no external dependency.
 *
 * Supported shapes:
 *   /                                    → no selection (home)
 *   /c/:serverId                         → server selected, no channel yet
 *   /c/:serverId/:channelId              → server + channel selected
 *   /c/:serverId/:channelId/:messageId   → deep-link to a specific message
 *
 * Usage:
 *   const { serverId, channelId, messageId } = useRoute();
 *   navigateTo(serverId, channelId);           // no message
 *   navigateTo(serverId, channelId, messageId); // deep link
 */

import { useEffect, useState } from 'react';

const ROUTE_CHANGE_EVENT = 'omnia:route-change';

export interface Route {
  serverId: bigint | null;
  channelId: bigint | null;
  messageId: bigint | null;
}

export function parseRoute(pathname: string): Route {
  const match = pathname.match(/^\/c\/(\d+)(?:\/(\d+))?(?:\/(\d+))?\/?$/);
  if (!match) return { serverId: null, channelId: null, messageId: null };
  let serverId: bigint | null = null;
  let channelId: bigint | null = null;
  let messageId: bigint | null = null;
  try {
    serverId = BigInt(match[1]);
    if (match[2]) channelId = BigInt(match[2]);
    if (match[3]) messageId = BigInt(match[3]);
  } catch {
    return { serverId: null, channelId: null, messageId: null };
  }
  return { serverId, channelId, messageId };
}

function buildPath(
  serverId: bigint | null,
  channelId: bigint | null,
  messageId: bigint | null
): string {
  if (serverId === null) return '/';
  if (channelId === null) return `/c/${serverId.toString()}`;
  if (messageId === null) {
    return `/c/${serverId.toString()}/${channelId.toString()}`;
  }
  return `/c/${serverId.toString()}/${channelId.toString()}/${messageId.toString()}`;
}

export function navigateTo(
  serverId: bigint | null,
  channelId: bigint | null,
  messageIdOrOpts: bigint | null | { replace?: boolean } = null,
  opts: { replace?: boolean } = {}
): void {
  let messageId: bigint | null = null;
  let options = opts;
  if (
    typeof messageIdOrOpts === 'bigint' ||
    messageIdOrOpts === null
  ) {
    messageId = messageIdOrOpts;
  } else {
    options = messageIdOrOpts;
  }

  const path = buildPath(serverId, channelId, messageId);
  if (path === window.location.pathname) return;
  if (options.replace) {
    window.history.replaceState({}, '', path);
  } else {
    window.history.pushState({}, '', path);
  }
  window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
}

/**
 * If the current pathname is /invite/:code, return the code string.
 * Otherwise return null.
 */
export function parseInviteRoute(pathname: string): string | null {
  const m = pathname.match(/^\/invite\/([A-Za-z0-9]+)\/?$/);
  return m ? m[1] : null;
}

/** Build a shareable absolute URL for a specific message. */
export function buildMessageLink(
  serverId: bigint,
  channelId: bigint,
  messageId: bigint
): string {
  return `${window.location.origin}${buildPath(serverId, channelId, messageId)}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() =>
    parseRoute(window.location.pathname)
  );

  useEffect(() => {
    const sync = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(ROUTE_CHANGE_EVENT, sync);
    };
  }, []);

  return route;
}
