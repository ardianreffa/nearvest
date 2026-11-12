// The Tandur Arena pictures and how they fit the duel's stage (pure math, unit-tested in
// web/test/arena-fit.test.ts; drawn by duel-backdrop.tsx).

export type Box = [number, number, number, number]; // x, y, w, h in image pixels

/** One arena picture: its size and the places the animations sit on (measured on arena-*-day.png). */
export interface ArenaArt {
  key: 'web' | 'phone';
  w: number;
  h: number;
  src: (light: 'day' | 'dusk' | 'night') => string;
  /** The ring's middle: the TaniBots' feet stand on this row. */
  ring: { cx: number; cy: number; rx: number; ry: number };
  crater: [number, number];
  lava: Box;
  lanterns: Box[];
  neon: Box[];
  /**
   * The stone floor below the ring: `band` = rows [from, to) that repeat cleanly (they start on a
   * joint line); `cut` = the first row of the picture's front edge (the bushes), which always stays at
   * the very bottom. Used when the picture is not tall enough for the screen (full-screen duel).
   */
  floor: { band: [number, number]; cut: number };
}

export const ARENA_WEB: ArenaArt = {
  key: 'web',
  w: 480,
  h: 270,
  src: (light) => `/assets/bg/arena-web-${light}.png`,
  ring: { cx: 240, cy: 206, rx: 158, ry: 16 },
  crater: [233, 37],
  lava: [200, 38, 71, 31],
  lanterns: [
    [56, 45, 39, 54],
    [387, 45, 36, 55],
  ],
  neon: [
    [51, 154, 10, 15],
    [143, 159, 10, 10],
    [327, 158, 11, 11],
    [420, 154, 9, 15],
  ],
  floor: { band: [235, 251], cut: 251 },
};

export const ARENA_PHONE: ArenaArt = {
  key: 'phone',
  w: 480,
  h: 720,
  src: (light) => `/assets/bg/arena-phone-${light}.png`,
  ring: { cx: 240, cy: 465, rx: 210, ry: 38 },
  crater: [241, 134],
  lava: [181, 136, 128, 61],
  lanterns: [
    [45, 122, 47, 78],
    [390, 120, 49, 80],
  ],
  neon: [
    [47, 347, 14, 32],
    [131, 357, 18, 22],
    [330, 355, 19, 29],
    [423, 347, 15, 32],
  ],
  floor: { band: [609, 643], cut: 643 },
};

/**
 * Scale and offset of the picture for a stage of w x h CSS px whose feet line is `feet` px from the
 * stage's top: the ring's middle row on the feet line, the picture covers the stage, centred.
 */
export function arenaFit(art: ArenaArt, w: number, h: number, feet: number) {
  const k = Math.max(w / art.w, feet / art.ring.cy, h / art.h);
  return { k, left: (w - art.w * k) / 2, top: feet - art.ring.cy * k };
}

/** The TaniBots' feet stay at least this far above the dock (room for the K.O. tilt of the loser). */
export const FEET_ABOVE_DOCK = 24;

/**
 * The full-screen duel (Ardian 2026-11-12): the arena reaches the bottom of the screen and the turn
 * text and buttons float over its floor in a see-through dock. Laptops: a whole-number scale that
 * covers the width (sharp pixels); phones: exactly the screen's width (nothing cut off at the sides).
 * The ring's middle row is the TaniBots' feet line, as low as possible but above the dock and never
 * so low that the picture's top leaves the stage. When the picture ends above the stage's bottom, the
 * gap (`fill`) is filled with the picture's own floor rows (`floor.band`), its bushes stay at the bottom.
 */
export function arenaFullFit(art: ArenaArt, w: number, h: number, dockTop: number, wide: boolean) {
  const k = wide ? Math.max(1, Math.ceil(w / art.w - 1e-6)) : w / art.w;
  const ring = art.ring.cy * k;
  let top = Math.min(0, dockTop - FEET_ABOVE_DOCK - ring);
  if (wide) top = Math.round(top);
  const left = wide ? Math.round((w - art.w * k) / 2) : (w - art.w * k) / 2;
  const feet = top + ring;
  const fill = Math.max(0, Math.ceil(h - (top + art.h * k)));
  return { k, left, top, feet, fill };
}
