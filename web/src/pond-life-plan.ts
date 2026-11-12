// The fishing pond's life and mood (Fishing package 2, Ardian 2026-11-12; docs/PLAN-fishing.md
// section 9): pure rules, tested in web/test/pond-life.test.ts. art/pond-life.tsx draws them and
// audio.ts (setPondAmbience) plays the sounds.
//
// - Time follows the village clock like the garden: morning, day, dusk, night.
// - Weather follows the village, but the pond only knows clear and rain: NO eruption or ash here
//   (warning / eruption / volcanic soil / drought = a clear pond).
// - Frogs hop in place now and then (and turn to a random side), sometimes to a neighbouring lily pad.
// - Ducks swim slowly to random points on the right-hand side only (never near the float); at night
//   they sleep (still, "zzz").

import type { WeatherLook } from './weather';

export type PondTime = 'morning' | 'day' | 'dusk' | 'night';
export type PondWeather = 'clear' | 'rain';
export type Pt = { x: number; y: number };

/** Village hour (0-24) -> the pond's time of day. */
export function pondTime(hour: number): PondTime {
  if (hour >= 19 || hour < 5) return 'night';
  if (hour < 10) return 'morning';
  if (hour < 16.5) return 'day';
  return 'dusk';
}

/** Only rain reaches the pond; everything else (eruption, ash, drought...) is a clear day here. */
export function pondWeather(look: WeatherLook): PondWeather {
  return look === 'rain' ? 'rain' : 'clear';
}

/** What plays in the pond's background (the sounds are made in code, audio.ts). */
export interface PondSounds {
  waterfall: boolean;
  ripples: boolean;
  breeze: boolean;
  frogs: boolean;
  /** Frogs croak more often at night and in the rain. */
  frogsBusy: boolean;
  crickets: boolean;
  ducks: boolean;
  rain: boolean;
}
export function pondSounds(time: PondTime, weather: PondWeather): PondSounds {
  const night = time === 'night';
  const rain = weather === 'rain';
  return {
    waterfall: true,
    ripples: true,
    breeze: !night && !rain,
    frogs: true,
    frogsBusy: night || rain,
    crickets: night && !rain,
    ducks: !night,
    rain,
  };
}

/** Falling leaves: their colours by time (design tokens); a few only (light on phones). */
export const LEAF_COLORS: Record<PondTime, [string, string]> = {
  morning: ['--leaf-300', '--leaf-500'],
  day: ['--leaf-300', '--leaf-500'],
  dusk: ['--gold-500', '--soil-300'],
  night: ['--leaf-700', '--cyan-700'],
};
export const LEAF_COUNT = 5;

/** Ducks sleep at night. */
export const ducksAsleep = (time: PondTime) => time === 'night';

// ---------- Frogs ----------

/** Lily pads a frog can sit on (pond grid px: the frog's middle). */
export const FROG_SPOTS: Pt[] = [
  { x: 149, y: 74 },
  { x: 176, y: 73 },
  { x: 307, y: 53 },
  { x: 446, y: 85 },
  { x: 104, y: 192 },
  { x: 89, y: 178 },
  { x: 127, y: 189 },
];
/** The four frogs: where each starts and the pads it may hop between (neighbours only). */
export const FROGS: { start: number; pads: number[] }[] = [
  { start: 0, pads: [0, 1] },
  { start: 2, pads: [2] },
  { start: 3, pads: [3] },
  { start: 4, pads: [4, 5, 6] },
];
export interface FrogState {
  spot: number;
  /** Facing in 90 degree steps (0 = head up). */
  dir: 0 | 1 | 2 | 3;
  /** Counts hops (restarts the hop animation). */
  hops: number;
}
export const startFrogs = (rand: () => number): FrogState[] => FROGS.map((f) => ({ spot: f.start, dir: Math.floor(rand() * 4) as FrogState['dir'], hops: 0 }));

/** One tick (about every 1.5 s): a frog hops in place now and then, and sometimes to another pad. */
export function frogTick(f: FrogState, i: number, rand: () => number): FrogState {
  if (rand() > 0.16) return f;
  const pads = FROGS[i].pads;
  const others = pads.filter((p) => p !== f.spot);
  const move = others.length > 0 && rand() < 0.3;
  return {
    spot: move ? others[Math.floor(rand() * others.length)] : f.spot,
    dir: Math.floor(rand() * 4) as FrogState['dir'],
    hops: f.hops + 1,
  };
}

// ---------- Ducks ----------

/** Where the ducks may swim (their middle): the right-hand side, far from the float at (250, 142). */
export const DUCK_AREA = { x0: 398, y0: 102, x1: 462, y1: 176 };
/** Slow paddling, grid px per second. */
export const DUCK_SPEED = 4;
export const DUCK_STARTS: Pt[] = [
  { x: 438, y: 118 },
  { x: 415, y: 137 },
  { x: 452, y: 153 },
];
/** A new spot to paddle to: in the area, a little away from where it is, never too close to another duck. */
export function duckTarget(from: Pt, others: Pt[], rand: () => number): Pt {
  let best = from;
  for (let i = 0; i < 12; i++) {
    const p = {
      x: Math.round(DUCK_AREA.x0 + rand() * (DUCK_AREA.x1 - DUCK_AREA.x0)),
      y: Math.round(DUCK_AREA.y0 + rand() * (DUCK_AREA.y1 - DUCK_AREA.y0)),
    };
    const far = Math.hypot(p.x - from.x, p.y - from.y);
    if (far >= 10 && far <= 40 && others.every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= 18)) return p;
    best = p;
  }
  return best;
}
/** Seconds a duck needs to paddle from a to b. */
export const swimSeconds = (a: Pt, b: Pt) => Math.max(2, Math.hypot(b.x - a.x, b.y - a.y) / DUCK_SPEED);

/**
 * Boxes [x, y, w, h] the rod, line, float, "!", catch and sparkles must never touch: every lily pad a
 * frog can sit on and the ducks' whole swimming area (with room for their size).
 */
export const CRITTERS: [number, number, number, number][] = [
  ...FROG_SPOTS.map((p): [number, number, number, number] => [p.x - 7, p.y - 7, 14, 14]),
  [DUCK_AREA.x0 - 10, DUCK_AREA.y0 - 6, DUCK_AREA.x1 - DUCK_AREA.x0 + 20, DUCK_AREA.y1 - DUCK_AREA.y0 + 12],
];
