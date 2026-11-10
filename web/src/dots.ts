// Red dots on the tabs (phone bottom tabs, laptop drawer tabs and icon rail) and on the Friends
// pin, in the same style as the check-in dot (Ardian, 2026-11-10):
// - Village: a new visitor, sticker, watering, wave back or paid referral not seen yet. "Seen" is
//   stored on the server (`state.news.seenAt`, POST /api/village/seen) so every device agrees.
//   Servers without `news` (before 2026-11-10): never a Village dot.
// - Market: NEW fruit (harvested after the Market was last opened; Ardian, 2026-11-10). Gone as
//   soon as the Market opens. "Seen" is on the server (`state.market`, POST /api/market/seen);
//   servers without `market`: this browser remembers how much fruit it saw (`LocalSeen.fruits`).
// - Shop: no seed in Storage AND an empty plot, until the Shop is opened (this browser remembers it
//   until the need is gone: then a later "out of seeds" shows the dot again).
// - Garden: a ripe or thirsty tree, only while the player is on another tab.
// - Friends pin: a new wave back.
// Never for fertilizer (it is optional), never while visiting a friend's garden, never on the tab
// that is open right now.

import { useEffect } from 'preact/hooks';
import type { GameState } from './api';

export type DotTab = 'garden' | 'storage' | 'shop' | 'market' | 'village';

export interface Dots {
  tabs: Record<DotTab, boolean>;
  friends: boolean;
}

const NONE: Dots = {
  tabs: {
    garden: false,
    storage: false,
    shop: false,
    market: false,
    village: false,
  },
  friends: false,
};

/** The Village news the owner has not seen yet (false on servers without `news`). */
export function villageNews(state: GameState): boolean {
  const n = state.news;
  return !!n && n.latestAt > n.seenAt;
}

type Tree = NonNullable<GameState['plots'][number]['tree']>;

/** The tree shows "Thirsty" / "Water 1/2" / "Wilting!" (the same rule as the scene's tree label). */
const needsWater = (t: Tree) => !t.ready && (!t.isWatered || !!t.wilting || ((t.waterNeed ?? 1) > 1 && !t.wateredToday));

/** What this browser saw (localStorage per garden): fruit per kind when the Market was last open, Shop opened. */
export interface LocalSeen {
  fruits: Record<string, number> | null;
  shop: boolean;
}

export const LOCAL_NONE: LocalSeen = { fruits: null, shop: false };

const fruitKey = (f: { species: string; quality: string }) => `${f.species}-${f.quality}`;

/** How much fruit of each kind the player holds now. */
export function fruitSnap(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of state.fruits) if (f.qty > 0) out[fruitKey(f)] = f.qty;
  return out;
}

/** Fruit harvested since the Market was last opened (and still in Storage). */
export function marketNew(state: GameState, local: LocalSeen = LOCAL_NONE): boolean {
  if (!state.fruits.some((f) => f.qty > 0)) return false;
  const m = state.market;
  if (m) return m.fruitAt > m.seenAt;
  // Older server: more fruit of some kind than this browser saw in the Market.
  const seen = local.fruits;
  return !seen || state.fruits.some((f) => f.qty > (seen[fruitKey(f)] ?? 0));
}

/** No seed in Storage and an empty (unlocked) plot: the Shop can help. */
export function shopNeed(state: GameState): boolean {
  return state.seeds.length === 0 && state.plots.some((p) => !p.locked && !p.tree);
}

/**
 * The local record after a state change: fruit counts that went down (sold, also by TaniBot) go
 * down too, so a later harvest counts as new; the Shop flag clears once seeds are back. Returns
 * the same object when nothing changed.
 */
export function settleLocal(state: GameState, local: LocalSeen): LocalSeen {
  let fruits = local.fruits;
  if (fruits) {
    const now = fruitSnap(state);
    const lower = Object.keys(fruits).some((k) => (now[k] ?? 0) < fruits![k]);
    if (lower) {
      const next: Record<string, number> = {};
      for (const [k, v] of Object.entries(fruits)) if (Math.min(v, now[k] ?? 0) > 0) next[k] = Math.min(v, now[k] ?? 0);
      fruits = next;
    }
  }
  const shop = local.shop && shopNeed(state);
  return fruits === local.fruits && shop === local.shop ? local : { fruits, shop };
}

const localKey = (account: string) => `nearvest.seen.${account}`;

export function readLocalSeen(account: string): LocalSeen {
  try {
    const v = JSON.parse(localStorage.getItem(localKey(account)) ?? 'null') as Partial<LocalSeen> | null;
    return { fruits: v?.fruits && typeof v.fruits === 'object' ? v.fruits : null, shop: !!v?.shop };
  } catch {
    return LOCAL_NONE;
  }
}

export function saveLocalSeen(account: string, v: LocalSeen): void {
  try {
    localStorage.setItem(localKey(account), JSON.stringify(v));
  } catch {
    // Storage blocked: remembered for this visit only.
  }
}

/** The state right after the owner opened the Market (no Market dot on any device). */
export function markMarketSeen(state: GameState): GameState {
  const m = state.market;
  return m && m.seenAt < m.fruitAt ? { ...state, market: { ...m, seenAt: m.fruitAt } } : state;
}

/** Which dots to show. `open`: the tab on screen now (no dot there); `visiting`: a friend's garden is open. */
export function dotsFor(state: GameState, open: DotTab | null, visiting: boolean, local: LocalSeen = LOCAL_NONE): Dots {
  if (visiting) return NONE;
  const n = state.news;
  const tabs: Record<DotTab, boolean> = {
    garden: state.plots.some((p) => !!p.tree && (p.tree.ready || needsWater(p.tree))),
    storage: false,
    shop: shopNeed(state) && !local.shop,
    market: marketNew(state, local),
    village: villageNews(state),
  };
  if (open) tabs[open] = false;
  return { tabs, friends: !!n && n.waveAt > n.seenAt };
}

/** The state as it is right after the owner saw the Village news (no dot on any device). */
export function markSeen(state: GameState): GameState {
  const n = state.news;
  return n && n.seenAt < n.latestAt ? { ...state, news: { ...n, seenAt: n.latestAt } } : state;
}

/**
 * Calls `onSeen` once one of the boxes matching `selector` is really on screen (at least 40% of it,
 * or 120 px) while `active`: the Village tab's Visitors / Invite boxes, so the dot goes away only
 * after the player has looked at them (phones scroll the Village tab).
 */
export function useSeenWhenVisible(selector: string, active: boolean, onSeen: () => void): void {
  useEffect(() => {
    if (!active) return;
    let done = false;
    const fire = () => {
      if (done) return;
      done = true;
      onSeen();
    };
    if (typeof IntersectionObserver === 'undefined') {
      fire();
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting && (e.intersectionRatio >= 0.4 || e.intersectionRect.height >= 120))) fire();
      },
      { threshold: [0, 0.4, 1] },
    );
    // The boxes may render a moment after the tab opens.
    const watch = () => document.querySelectorAll(selector).forEach((el) => io.observe(el));
    watch();
    const t = window.setTimeout(watch, 300);
    return () => {
      done = true;
      io.disconnect();
      window.clearTimeout(t);
    };
  }, [selector, active, onSeen]);
}
