// Share-card moments and the order they are shown in (pure logic, unit-tested in
// web/test/moments.test.ts). Several moments can happen at once, e.g. the first harvest in demo
// mode also gives enough XP (x5) for a new title and a TaniBot evolution. The cards are shown one
// at a time, the achievement itself first: first harvest, first Gold tree, 7-day streak, then the
// new title / TaniBot evolution, then Legend.

import type { Quality, Species } from './api';

export type MomentKind = 'first_harvest' | 'first_gold' | 'evolved' | 'streak7' | 'title' | 'legend' | 'profile';

export interface Moment {
  kind: MomentKind;
  species?: Species;
  quality?: Quality;
  title?: string;
  /** Village hour when it happened (the card's sky: day, dusk or night). */
  hour?: number;
}

const RANK: Record<MomentKind, number> = {
  first_harvest: 0,
  first_gold: 1,
  streak7: 2,
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

/**
 * Adds a moment to the dialog's queue. The card on screen (`queue[0]`) stays; the new one is
 * placed among the waiting cards by its rank, so a first harvest that arrives a moment after a
 * new title still comes before it.
 */
export function enqueueMoment(queue: Moment[], m: Moment): Moment[] {
  if (queue.some((q) => momentId(q) === momentId(m))) return queue;
  if (queue.length === 0) return [m];
  return [queue[0], ...orderMoments([...queue.slice(1), m])];
}
