// The fishing pond's life and mood (Fishing package 2, Ardian 2026-11-12; docs/PLAN-fishing.md
// section 9): pure rules, tested in web/test/pond-life.test.ts. art/pond-life.tsx draws them and
// audio.ts (setPondAmbience) plays the sounds.
//
// - Time follows the village clock like the garden: morning, day, dusk, night.
// - Weather follows the village, but the pond only knows clear and rain: NO eruption or ash here
//   (warning / eruption / volcanic soil / drought = a clear pond).
// - Frogs hop in place now and then (and turn to a random side), sometimes to a neighbouring lily pad.
// - Ducks swim slowly anywhere on the lake (never on land, rocks or pads), never bump into each other
//   and keep away from the float and the line while fishing; at night they sleep (still, "zzz").

import { WATER_CELL, WATER_MASK } from './art/pond-sprites.ts';
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
    crickets: night, // also in the rain at night (Ardian, package 3)
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
//
// Package 3 (Ardian 2026-11-12): ducks swim anywhere on the lake (WATER_MASK from the picture: only
// water under the whole duck, never land, the dock, rocks or lily pads), never bump into or pile on
// each other, and keep away from the float and the line while TaniBot is fishing (and from the
// floating panels on screen). Each duck paddles along a straight segment; a new segment is only
// chosen when it stays clear of every other duck's remaining segment, so two ducks are never closer
// than DUCK_GAP at any moment.

export type Box = [number, number, number, number];
export interface DuckMove {
  from: Pt;
  to: Pt;
  /** ms (any clock) when it left `from`, and how long the paddle takes. */
  start: number;
  dur: number;
}
/** Slow paddling, grid px per second; fleeing from the line a little faster. */
export const DUCK_SPEED = 4;
export const DUCK_FLEE_SPEED = 10;
/** The closest two ducks' middles ever get (a duck is 19 px long). */
export const DUCK_GAP = 24;
export const DUCK_STARTS: Pt[] = [
  { x: 430, y: 118 },
  { x: 404, y: 150 },
  { x: 446, y: 176 },
];
/** The waterfall's foam at the foot of the fall: no swimming there. */
export const WATERFALL_FOOT: Box = [366, 44, 54, 30];

/** Where the duck is at `now`. */
export function duckAt(m: DuckMove, now: number): Pt {
  const p = m.dur > 0 ? Math.min(1, Math.max(0, (now - m.start) / m.dur)) : 1;
  return { x: m.from.x + (m.to.x - m.from.x) * p, y: m.from.y + (m.to.y - m.from.y) * p };
}
export const still = (at: Pt, now: number): DuckMove => ({ from: at, to: at, start: now, dur: 0 });

const inBox = (p: Pt, [x, y, w, h]: Box, pad = 0) => p.x > x - pad && p.x < x + w + pad && p.y > y - pad && p.y < y + h + pad;

/** Only water under the whole duck (WATER_MASK), not the waterfall's foot, not under a panel. */
export function swimmable(p: Pt, avoid: Box[] = []): boolean {
  const row = WATER_MASK[Math.floor(p.y / WATER_CELL)];
  return !!row && row[Math.floor(p.x / WATER_CELL)] === '#' && !inBox(p, WATERFALL_FOOT) && !avoid.some((b) => inBox(p, b, 12));
}

/** Shortest distance between segments ab and cd. */
export function segDist(a: Pt, b: Pt, c: Pt, d: Pt): number {
  const pd = (p: Pt, u: Pt, v: Pt) => {
    const dx = v.x - u.x;
    const dy = v.y - u.y;
    const l = dx * dx + dy * dy;
    const t = l ? Math.min(1, Math.max(0, ((p.x - u.x) * dx + (p.y - u.y) * dy) / l)) : 0;
    return Math.hypot(p.x - (u.x + t * dx), p.y - (u.y + t * dy));
  };
  const cross = (p: Pt, q: Pt, r: Pt) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const hit = cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0;
  return hit ? 0 : Math.min(pd(a, c, d), pd(b, c, d), pd(c, a, b), pd(d, a, b));
}

/** While fishing: the float and the line from the rod's tip (a band around them) are off limits. */
export interface FishingZone {
  tip: Pt;
  float: Pt;
}
export const ZONE_LINE = 22;
export const ZONE_FLOAT = 34;
export function inZone(a: Pt, b: Pt, z: FishingZone | null): boolean {
  if (!z) return false;
  return segDist(a, b, z.float, z.float) < ZONE_FLOAT || segDist(a, b, z.tip, z.float) < ZONE_LINE;
}

/** A paddle that stays on the water (sampled every half pixel, so no corner of a cell is skipped) and out of the fishing zone. */
export function pathOk(a: Pt, b: Pt, avoid: Box[], zone: FishingZone | null): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let i = 0; i <= n; i++) if (!swimmable({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, avoid)) return false;
  return !inZone(a, b, zone);
}

/**
 * The next paddle for duck i: a random spot on the water 15-90 px away, along a path on the water,
 * out of the fishing zone and at least DUCK_GAP from every other duck's remaining path. `flee` =
 * it must get out of the fishing zone now (faster). null = no good spot this time (it waits).
 */
export function planDuck(
  ducks: DuckMove[],
  i: number,
  now: number,
  rand: () => number,
  opts: { avoid?: Box[]; zone?: FishingZone | null; flee?: boolean } = {},
): DuckMove | null {
  const avoid = opts.avoid ?? [];
  const zone = opts.zone ?? null;
  const at = duckAt(ducks[i], now);
  const others = ducks.filter((_, j) => j !== i).map((m) => [duckAt(m, now), m.to] as const);
  for (let k = 0; k < 40; k++) {
    const ang = rand() * Math.PI * 2;
    const far = 15 + rand() * 75;
    const to = { x: Math.round(at.x + Math.cos(ang) * far), y: Math.round(at.y + Math.sin(ang) * far * 0.7) };
    if (!pathOk(at, to, avoid, opts.flee ? null : zone)) continue;
    if (opts.flee && inZone(to, to, zone)) continue;
    if (others.some(([p, q]) => segDist(at, to, p, q) < DUCK_GAP)) continue;
    const speed = opts.flee ? DUCK_FLEE_SPEED : DUCK_SPEED;
    return { from: at, to, start: now, dur: Math.max(1500, (Math.hypot(to.x - at.x, to.y - at.y) / speed) * 1000) };
  }
  return null;
}

/** Does duck i have to get out of the way (its path crosses the fishing zone)? */
export const mustFlee = (m: DuckMove, now: number, zone: FishingZone | null) => inZone(duckAt(m, now), m.to, zone);

/**
 * Boxes [x, y, w, h] the rod, line, float, "!", catch and sparkles must never touch: every lily pad a
 * frog can sit on. (The ducks keep away from the line and the float themselves: planDuck.)
 */
export const CRITTERS: [number, number, number, number][] = FROG_SPOTS.map((p): [number, number, number, number] => [p.x - 7, p.y - 7, 14, 14]);
