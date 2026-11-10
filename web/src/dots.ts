// Red dots on the tabs (phone bottom tabs, laptop drawer tabs and icon rail) and on the Friends
// pin, in the same style as the check-in dot (Ardian, 2026-11-10):
// - Village: a new visitor, sticker, watering, wave back or paid referral not seen yet. "Seen" is
//   stored on the server (`state.news.seenAt`, POST /api/village/seen) so every device agrees.
//   Servers without `news` (before 2026-11-10): never a Village dot.
// - Market: fruit in Storage to sell. Gone when the fruit is gone.
// - Shop: no seed in Storage AND an empty plot. Gone once there is a seed.
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

/** Which dots to show. `open`: the tab on screen now (no dot there); `visiting`: a friend's garden is open. */
export function dotsFor(state: GameState, open: DotTab | null, visiting: boolean): Dots {
  if (visiting) return NONE;
  const n = state.news;
  const tabs: Record<DotTab, boolean> = {
    garden: state.plots.some((p) => !!p.tree && (p.tree.ready || needsWater(p.tree))),
    storage: false,
    shop: state.seeds.length === 0 && state.plots.some((p) => !p.locked && !p.tree),
    market: state.fruits.some((f) => f.qty > 0),
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
