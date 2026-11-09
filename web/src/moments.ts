// Share-card moments and the order they are shown in (pure logic, unit-tested in
// web/test/moments.test.ts). Several moments can happen at once, e.g. the first harvest in demo
// mode also gives enough XP (x5) for a new title and a TaniBot evolution. The cards are shown one
// at a time, the achievement itself first: first harvest, first Gold tree, 7-day streak, then the
// new title / TaniBot evolution, then Legend.
//
// Each moment first plays its animation and sound (moment-fx.tsx); its share popup opens
// POPUP_AFTER_FX_MS after the animation ends. Cards opened by the player (profile card, "Share
// later", previews) open at once.

import type { Quality, Species } from './api';

export type MomentKind = 'first_harvest' | 'first_gold' | 'big_durian' | 'evolved' | 'streak7' | 'title' | 'legend' | 'profile' | 'eruption';

export interface Moment {
  kind: MomentKind;
  species?: Species;
  quality?: Quality;
  title?: string;
  /** Village hour when it happened (the card's sky: day, dusk or night). */
  hour?: number;
}

/** The share popup opens this long after the moment's animation has ended. */
export const POPUP_AFTER_FX_MS = 1500;
/** At most this many cards wait in "Share later". */
export const SHARE_LATER_MAX = 10;

const RANK: Record<MomentKind, number> = {
  first_harvest: 0,
  first_gold: 1,
  big_durian: 1,
  streak7: 2,
  eruption: 2,
  title: 3,
  evolved: 3,
  legend: 4,
  profile: 5,
};

/** Identity of a moment for "show once": title and evolution cards once per title, others once ever. */
export function momentId(m: Moment): string {
  return m.kind === 'title' || m.kind === 'evolved' ? `${m.kind}:${m.title}` : m.kind;
}

/** Moments in showing order (stable: equal ranks keep the order they happened in), duplicates dropped. */
export function orderMoments(list: Moment[]): Moment[] {
  const seen = new Set<string>();
  return list
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => (seen.has(momentId(m)) ? false : (seen.add(momentId(m)), true)))
    .sort((a, b) => RANK[a.m.kind] - RANK[b.m.kind] || a.i - b.i)
    .map(({ m }) => m);
}

/** A card waiting for the share popup. */
export interface QueuedMoment {
  m: Moment;
  /** Play the moment's animation and sound first (false: it already played, or the player opened it). */
  fx: boolean;
  /** Opened by the player (profile, "Share later", preview): before the automatic cards, no wait. */
  manual?: boolean;
  /** Opened from the "Share later" list (X removes it from there). */
  fromLater?: boolean;
}

/**
 * Adds a card to the waiting queue (the card on screen is not in it). Cards the player opened come
 * first; automatic ones keep their showing order (a first harvest that arrives a moment after a new
 * title still comes before it). An exact duplicate of a waiting card is ignored.
 */
export function enqueueMoment(queue: QueuedMoment[], item: QueuedMoment): QueuedMoment[] {
  if (queue.some((q) => momentId(q.m) === momentId(item.m) && !!q.manual === !!item.manual)) return queue;
  const rank = (q: QueuedMoment) => (q.manual ? -1 : RANK[q.m.kind]);
  return [...queue, item]
    .map((q, i) => ({ q, i }))
    .sort((a, b) => rank(a.q) - rank(b.q) || a.i - b.i)
    .map(({ q }) => q);
}

/**
 * How long to wait before showing a card's popup: its animation plus POPUP_AFTER_FX_MS; a card whose
 * animation already played (it waited for the tutorial / Judge tour) waits POPUP_AFTER_FX_MS; a card
 * the player opened opens at once.
 */
export function popupDelay(item: QueuedMoment, fxMs: number): number {
  if (item.manual) return 0;
  return (item.fx ? fxMs : 0) + POPUP_AFTER_FX_MS;
}

/** "Later": the newest first, one card per moment, at most SHARE_LATER_MAX. */
export function addLater(list: Moment[], m: Moment): Moment[] {
  return [m, ...list.filter((x) => momentId(x) !== momentId(m))].slice(0, SHARE_LATER_MAX);
}

export function removeLater(list: Moment[], m: Moment): Moment[] {
  return list.filter((x) => momentId(x) !== momentId(m));
}
