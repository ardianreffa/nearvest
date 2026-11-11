// The pixel-leaf wipe between gardens (visit-wipe.tsx), without screen code so it can be tested
// (web/test/visit-wipe.test.ts). Ardian 2026-11-11: when a player visits a friend's garden (or goes
// back), small green pixel squares sweep over the screen like leaves until it is fully covered, the
// title says whose garden comes next, then the squares leave in the same order and the new garden
// shows. About 0.8 s in all; the screen stays covered while the friend's garden is still loading.

/** Cover, hold (at least; longer while the garden loads) and reveal: 320 + 160 + 320 = 800 ms. */
export const WIPE_COVER_MS = 320;
export const WIPE_HOLD_MS = 160;
export const WIPE_REVEAL_MS = 320;
/** Reduced motion: a short fade in and out, no moving squares. */
export const WIPE_FADE_MS = 150;
/** Never wait longer than this for a garden: then the visit counts as failed. */
export const WIPE_WAIT_MAX_MS = 15000;

/** Leaf colours (design-system tokens) and how often each is drawn (mostly leaves, a little mint). */
export const WIPE_COLORS = [
  { token: '--leaf-700', weight: 34 },
  { token: '--leaf-500', weight: 34 },
  { token: '--leaf-300', weight: 24 },
  { token: '--mint-500', weight: 8 },
] as const;

/**
 * Size of one square in CSS px: a multiple of the game's pixel grid (8 px). Phones 16 px
 * (about 25 x 53 squares at 390 x 844), laptops 24 px (about 54 x 34 at 1280 x 800).
 */
export function wipeCellPx(viewW: number): number {
  return viewW >= 1024 ? 24 : 16;
}

export interface WipeCell {
  col: number;
  row: number;
  /** When it appears (cover) and leaves (reveal), 0..1 of the phase. */
  at: number;
  /** Index into WIPE_COLORS. */
  color: number;
}

/** A small seeded random (the same pattern for the same seed; tests). */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

/**
 * Every square of the screen with its moment: a sweep from the bottom left to the top right (like
 * leaves blown up through the village) mixed with randomness, so the edge is ragged, never a line.
 * All moments are in [0, 0.999], so at the end of a phase every square has changed.
 */
export function wipeCells(cols: number, rows: number, rand: () => number): WipeCell[] {
  const total = WIPE_COLORS.reduce((n, c) => n + c.weight, 0);
  const cells: WipeCell[] = [];
  const span = Math.max(1, cols - 1 + rows - 1);
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < cols; col++) {
      const sweep = (col + (rows - 1 - row)) / span;
      const at = Math.min(0.999, 0.6 * sweep + 0.4 * rand());
      let pick = rand() * total;
      let color = 0;
      while (color < WIPE_COLORS.length - 1 && pick >= WIPE_COLORS[color].weight) pick -= WIPE_COLORS[color++].weight;
      cells.push({ col, row, at, color });
    }
  // Drawn in time order, so each frame only paints (or clears) the squares that changed.
  return cells.sort((a, b) => a.at - b.at);
}

/** How many squares have changed by `p` (0..1) of a phase (cells sorted by `at`). */
export function cellsBy(cells: WipeCell[], p: number): number {
  let lo = 0;
  let hi = cells.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cells[mid].at <= p) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Ease: quick start, soft end (leaves rushing in, then settling). */
export const easeOut = (p: number) => 1 - (1 - Math.min(1, Math.max(0, p))) ** 2;

/** The words in the middle. */
export const visitingText = (name: string) => `Visiting ${name}’s garden`;
export const BACK_TEXT = 'Back to my garden';
