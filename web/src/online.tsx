// The Online dot (docs/PLAN-arena.md 7.11): an 8 px mint square with an ink outline on the
// avatar's corner, and the word "Online". A garden is online when its visible game tab pinged in
// the last minute (presence.ts, server rules.ts ONLINE_MS).

import { Avatar } from './art/avatars';

/** An avatar with the Online dot on its corner (an 8 px mint square with an ink outline). */
export function OnlineAvatar({ id, size, online }: { id: string; size: number; online: boolean }) {
  return (
    <span class="online-avatar">
      <Avatar id={id} size={size} />
      {online && <span class="online-dot" aria-hidden="true" />}
    </span>
  );
}

/** The word "Online" next to the dot. */
export function OnlineTag() {
  return (
    <span class="tag tag-online" aria-label="Online now">
      <span class="online-dot inline" aria-hidden="true" /> Online
    </span>
  );
}

