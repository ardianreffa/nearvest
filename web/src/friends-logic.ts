// Add friend + Online (docs/PLAN-arena.md 7.11, Ardian 2026-11-11), the parts without screen code
// so they can be tested (web/test/friends.test.ts):
// - the server supports it only when `state.friends` is there (older servers: no Add friend, no
//   Online dots and no ping at all);
// - Farmers of Tandur: friends on top ("FRIENDS (n)"), the others below without them;
// - the light sign of life: one tiny POST /api/ping every 30 s, only while the game tab is visible;
//   "away" when the tab is hidden or closed (no open connection, nothing while hidden).

import type { FarmerRow, FriendAddView, GameState } from './api';

/** Does this server know Add friend + Online? */
export const friendsSupported = (s: Pick<GameState, 'friends'> | null | undefined) => !!s?.friends;

/** The farmers below the Friends section: everyone who is not a friend (friends are listed on top). */
export function othersAfterFriends(farmers: FarmerRow[], friends: FarmerRow[] | undefined): FarmerRow[] {
  if (!friends?.length) return farmers;
  const names = new Set(friends.map((f) => f.name));
  return farmers.filter((f) => !names.has(f.name));
}

/** The notice for gardens that added you since you last looked. */
export function friendAddNotice(fresh: FriendAddView[]): string {
  if (fresh.length === 0) return '';
  if (fresh.length === 1) return `${fresh[0].from} added you as a friend`;
  if (fresh.length === 2) return `${fresh[0].from} and ${fresh[1].from} added you as a friend`;
  return `${fresh[0].from} and ${fresh.length - 1} others added you as a friend`;
}

/**
 * The Add friend button's words (the visit panel and the farmer rows). "Friends" is drawn with a
 * pixel check mark after it ("Friends ✓"; the pixel fonts have no ✓ glyph).
 */
export function friendButtonLabel(friend: boolean, busy: boolean, short = false): string {
  if (busy) return friend ? 'Removing...' : 'Adding...';
  if (friend) return 'Friends';
  return short ? 'Add' : 'Add friend';
}

/** Why Add friend is not possible now (null = it is). */
export function addFriendBlocked(my: { count: number; max: number; addsLeft: number } | undefined): string | null {
  if (!my) return null;
  if (my.count >= my.max) return `You have ${my.max} friends, the most a garden can have.`;
  if (my.addsLeft <= 0) return 'You added the most friends for today. Add more tomorrow!';
  return null;
}

export type PresenceStep = { kind: 'ping' } | { kind: 'away' } | { kind: 'none' };

/** What the presence loop does when the tab's visibility changes. */
export function presenceOnVisibility(enabled: boolean, visible: boolean): PresenceStep {
  if (!enabled) return { kind: 'none' };
  return visible ? { kind: 'ping' } : { kind: 'away' };
}
