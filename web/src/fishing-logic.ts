// Fishing (docs/PLAN-fishing.md): pure text and timing rules of the fishing window (fishing.tsx),
// unit-tested in web/test/fishing.test.ts. The server decides every catch; the web only shows it.

import type { CatchView, FishingState } from './api';

/** The window's steps: ready to cast, line in the water, a bite, reeling in, the catch on screen. */
export type FishPhase =
  | { k: 'ready' }
  | { k: 'casting' }
  | { k: 'wait'; id: number; biteAt: number }
  | { k: 'bite'; id: number }
  | { k: 'reeling'; id: number }
  | { k: 'result'; c: CatchView };

/** The step to start in when the window opens: a line still in the water is resumed. */
export function startPhase(f: FishingState | undefined, now: number): FishPhase {
  if (f?.open) return f.open.biteInMs > 0 ? { k: 'wait', id: f.open.id, biteAt: now + f.open.biteInMs } : { k: 'bite', id: f.open.id };
  return { k: 'ready' };
}

/** "2 of 3 casts left today" */
export function castsLeftText(f: Pick<FishingState, 'left' | 'max'>): string {
  return f.left === 0 ? 'No casts left today' : `${f.left} of ${f.max} cast${f.max === 1 ? '' : 's'} left today`;
}

/** "5h 12m" / "12m" / "1m" until the casts come back. */
export function untilText(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / 60_000));
  const h = Math.floor(m / 60);
  return h ? `${h}h ${m % 60}m` : `${m}m`;
}

/** The line under the catch's name. */
export function catchNote(c: CatchView): string {
  if (c.released) return 'Daily fishing rewards from this device are used up. You let it go. +1 XP';
  if (c.item === 'seed') return 'A Mango seed! It is in your Storage now.';
  if (c.item === 'seed_sold') return 'Your seed storage is full, so Mr. Darto bought the seed for you.';
  if (c.item === 'fertilizer') return 'A drifting bottle of Fertilizer! It is in your Storage now.';
  if (c.catch === 'bottle') return 'A message in a bottle! It says:';
  if (c.catch === 'chest') return 'A small chest full of PANEN!';
  if (c.catch === 'golden_arowana') return 'The legendary fish of Tandur!';
  if (c.kind === 'junk') return 'Junk! Better luck next cast.';
  return 'Mr. Darto buys it on the spot.';
}

/** Reward chips: "+3 PANEN", "+1 XP" (only what was really given). */
export function rewardChips(c: CatchView): { kind: 'panen' | 'xp'; text: string }[] {
  const out: { kind: 'panen' | 'xp'; text: string }[] = [];
  if (c.panen > 0) out.push({ kind: 'panen', text: `+${formatNum(c.panen)} PANEN` });
  if (c.xp > 0) out.push({ kind: 'xp', text: `+${c.xp} XP` });
  return out;
}

const formatNum = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));

/** The notice when the server pulled in a line nobody reeled (the window was closed). */
export function autoNotice(c: CatchView): string {
  const reward = rewardChips(c).map((x) => x.text).join(', ');
  return `TaniBot pulled in your fishing line: ${c.name}${reward ? ` (${reward})` : ''}.`;
}

/**
 * Which finished catch needs a notice: the newest one when the server pulled it in by itself and it
 * was not shown yet (`seen` = the last shown id, per account in localStorage).
 */
export function autoCatchToShow(f: FishingState | undefined, seen: number, now: number): CatchView | null {
  const c = f?.last;
  return c && c.auto && c.id > seen && now - c.at < 24 * 60 * 60 * 1000 ? c : null;
}
