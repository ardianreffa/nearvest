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

import { WIDE, type PondLayout } from './art/pond-layouts.ts';
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
  /** Jungle birds (package 4): clear mornings and days, a few at dusk, none at night or in the rain. */
  birds: boolean;
  /** Bird songs per second. */
  birdRate: number;
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
    birds: !night && !rain,
    birdRate: night || rain ? 0 : time === 'dusk' ? 0.08 : 0.45,
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

/** Lily pads a frog can sit on (grid px: the frog's middle) and the four frogs (start pad, the pads it
 * may hop between): per layout (art/pond-layouts.ts); these are the 16:9 pond's. */
export const FROG_SPOTS: Pt[] = WIDE.frogSpots;
export const FROGS: { start: number; pads: number[] }[] = WIDE.frogs;
export interface FrogState {
  spot: number;
  /** Facing in 90 degree steps (0 = head up). */
  dir: 0 | 1 | 2 | 3;
  /** Counts hops (restarts the hop animation). */
  hops: number;
}
export const startFrogs = (rand: () => number, L: PondLayout = WIDE): FrogState[] =>
  L.frogs.map((f) => ({ spot: f.start, dir: Math.floor(rand() * 4) as FrogState['dir'], hops: 0 }));

/** One tick (about every 1.5 s): a frog hops in place now and then, and sometimes to another pad. */
export function frogTick(f: FrogState, i: number, rand: () => number, L: PondLayout = WIDE): FrogState {
  if (rand() > 0.16) return f;
  const pads = L.frogs[i].pads;
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
export const DUCK_STARTS: Pt[] = WIDE.duckStarts;
/** The waterfall's foam at the foot of the fall: no swimming there. */
export const WATERFALL_FOOT: Box = WIDE.waterfallFoot;

/** Where the duck is at `now`. */
export function duckAt(m: DuckMove, now: number): Pt {
  const p = m.dur > 0 ? Math.min(1, Math.max(0, (now - m.start) / m.dur)) : 1;
  return { x: m.from.x + (m.to.x - m.from.x) * p, y: m.from.y + (m.to.y - m.from.y) * p };
}
export const still = (at: Pt, now: number): DuckMove => ({ from: at, to: at, start: now, dur: 0 });

const inBox = (p: Pt, [x, y, w, h]: Box, pad = 0) => p.x > x - pad && p.x < x + w + pad && p.y > y - pad && p.y < y + h + pad;

/** Only water under the whole duck (WATER_MASK), not the waterfall's foot, not under a panel. */
export function swimmable(p: Pt, avoid: Box[] = [], L: PondLayout = WIDE): boolean {
  const row = L.water.mask[Math.floor(p.y / L.water.cell)];
  return !!row && row[Math.floor(p.x / L.water.cell)] === '#' && !inBox(p, L.waterfallFoot) && !avoid.some((b) => inBox(p, b, 12));
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
export function pathOk(a: Pt, b: Pt, avoid: Box[], zone: FishingZone | null, L: PondLayout = WIDE): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
  for (let i = 0; i <= n; i++) if (!swimmable({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }, avoid, L)) return false;
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
  opts: { avoid?: Box[]; zone?: FishingZone | null; flee?: boolean; layout?: PondLayout } = {},
): DuckMove | null {
  const L = opts.layout ?? WIDE;
  const avoid = opts.avoid ?? [];
  const zone = opts.zone ?? null;
  const at = duckAt(ducks[i], now);
  const others = ducks.filter((_, j) => j !== i).map((m) => [duckAt(m, now), m.to] as const);
  for (let k = 0; k < 40; k++) {
    const ang = rand() * Math.PI * 2;
    const far = 15 + rand() * 75;
    const to = { x: Math.round(at.x + Math.cos(ang) * far), y: Math.round(at.y + Math.sin(ang) * far * 0.7) };
    if (!pathOk(at, to, avoid, opts.flee ? null : zone, L)) continue;
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
 * frog can sit on (a pad no frog uses is just part of the picture). (The ducks keep away from the line
 * and the float themselves: planDuck.)
 */
export const crittersOf = (L: PondLayout): Box[] =>
  [...new Set(L.frogs.flatMap((f) => [f.start, ...f.pads]))].map((i): Box => [L.frogSpots[i].x - 7, L.frogSpots[i].y - 7, 14, 14]);
export const CRITTERS: Box[] = crittersOf(WIDE);

// ---------- Full screen (package 3) ----------

export interface PondFit {
  /**
   * cover = fills the screen (crops at most 12%); fit = the whole 16:9 pond, blurred copy around it;
   * phone = the phone pictures across the width, at the top, the controls below the lake.
   */
  mode: 'cover' | 'fit' | 'phone';
  left: number;
  top: number;
  w: number;
  h: number;
}
/** Room the phone's (compact, package 7) controls need under the lake (CSS px). */
export const PHONE_PANEL_MIN = 150;
/** At most this much (grid px) of the phone picture's top (jungle above the lake) may go off screen. */
export const PHONE_TOP_CROP = 60;
/**
 * Where the pond goes on a W x H screen (CSS px). With the phone layout (package 7, Ardian): ALWAYS the
 * full width, no blurred copy. If the lake would come too low for the controls, the picture moves up
 * (its jungle top goes off screen, at most PHONE_TOP_CROP grid px); a screen taller than the picture
 * gets more of the picture's own ground below it (art/pond-layouts.ts ground, under the panel).
 */
export function pondFit(W: number, H: number, L: PondLayout = WIDE): PondFit {
  if (L.key === 'phone') {
    const k = W / L.w;
    const top = Math.max(-PHONE_TOP_CROP * k, Math.min(0, H - PHONE_PANEL_MIN - L.lakeBottom * k));
    return { mode: 'phone', left: 0, top, w: W, h: L.h * k };
  }
  const ck = Math.max(W / 480, H / 270);
  const crop = 1 - Math.min(W / (480 * ck), H / (270 * ck));
  if (crop <= 0.12) {
    const w = 480 * ck;
    const h = 270 * ck;
    return { mode: 'cover', left: (W - w) / 2, top: (H - h) / 2, w, h };
  }
  const k = Math.min(W / 480, H / 270);
  const w = 480 * k;
  const h = 270 * k;
  return { mode: 'fit', left: (W - w) / 2, top: W < H ? Math.max(72, Math.round((H - h) * 0.3)) : (H - h) / 2, w, h };
}

// ---------- Dusk and night pictures (Ardian's ChatGPT pond, 2026-11-12) ----------

/**
 * How much of the dusk and night pond pictures show over the day one (0..1, stacked like the village:
 * art/backdrop.tsx skyMix, same hours): day -> dusk 16:00-17:00, dusk -> night 18:30-19:30; at dawn
 * night -> dusk 05:00-06:00 and dusk -> day 06:00-07:00.
 */
export function pondMix(hour: number): { dusk: number; night: number } {
  const ramp = (from: number, to: number) => Math.min(1, Math.max(0, (hour - from) / (to - from)));
  if (hour >= 5 && hour < 7) return { night: 1 - ramp(5, 6), dusk: 1 - ramp(6, 7) };
  if (hour >= 16 && hour < 19.5) return { night: ramp(18.5, 19.5), dusk: ramp(16, 17) };
  return { night: hour >= 7 && hour < 16 ? 0 : 1, dusk: 0 };
}

// ---------- Jumping fish (package 4) ----------

export type JumpFish = 'tilapia' | 'catfish' | 'carp' | 'gourami' | 'golden_arowana';
/** Which fish jumps (weights): the Golden Arowana very rarely. */
export const JUMP_WEIGHTS: [JumpFish, number][] = [
  ['tilapia', 30],
  ['catfish', 25],
  ['carp', 25],
  ['gourami', 18],
  ['golden_arowana', 2],
];
/** Seconds between jumps (random in this range): now and then, not too often. */
export const JUMP_EVERY: [number, number] = [7, 16];
export interface Jump {
  x: number;
  y: number;
  fish: JumpFish;
  /** Jumps to the right (else to the left). */
  right: boolean;
}
/**
 * A spot for a fish to jump: on open water (the ducks' water map: never on pads or the bank), far
 * from the float and the line while fishing, from every duck and every lily pad, not under a panel.
 */
export function pickJump(rand: () => number, opts: { ducks?: Pt[]; zone?: FishingZone | null; avoid?: Box[]; layout?: PondLayout } = {}): Jump | null {
  const L = opts.layout ?? WIDE;
  for (let k = 0; k < 40; k++) {
    const p = { x: Math.round(20 + rand() * (L.w - 40)), y: Math.round(20 + rand() * (L.h - 40)) };
    if (!swimmable(p, opts.avoid ?? [], L)) continue;
    if ((opts.ducks ?? []).some((d) => Math.hypot(d.x - p.x, d.y - p.y) < 36)) continue;
    if (L.frogSpots.some((f) => Math.hypot(f.x - p.x, f.y - p.y) < 28)) continue;
    const z = opts.zone;
    if (z && (segDist(p, p, z.float, z.float) < 56 || segDist(p, p, z.tip, z.float) < 34)) continue;
    let r = rand() * JUMP_WEIGHTS.reduce((s, [, w]) => s + w, 0);
    let fish: JumpFish = 'tilapia';
    for (const [f, w] of JUMP_WEIGHTS) {
      if (r < w) {
        fish = f;
        break;
      }
      r -= w;
    }
    return { x: p.x, y: p.y, fish, right: rand() < 0.5 };
  }
  return null;
}

// ---------- Calm changes of time and weather (package 6) ----------
//
// Ardian's live test: in demo mode a village day lasts one minute, so the pond jumped day -> dusk ->
// night every few seconds (on every state poll), the pictures popping in without a fade. Now the pond
// shows one "mood" (its picture: day / dusk / night, and clear / rain) that fades over POND_FADE_MS
// (CSS) and, in demo mode, holds each mood at least POND_HOLD_DEMO_MS before it may change.

export const POND_FADE_MS = 4000;
export const POND_HOLD_DEMO_MS = 20_000;
export interface PondMood {
  time: PondTime;
  weather: PondWeather;
  /** When the picture (day / dusk / night) last changed, and when the weather last changed. */
  timeSince: number;
  weatherSince: number;
}
/** Which picture a time of day uses (the morning uses the day picture with a soft light). */
export const pictureOf = (t: PondTime): 'day' | 'dusk' | 'night' => (t === 'morning' ? 'day' : t);
/** The mood to show now, given what the village says (`want`) and how long the current one has held. */
export function nextMood(cur: PondMood | null, want: { time: PondTime; weather: PondWeather }, now: number, demo: boolean): PondMood {
  if (!cur) return { ...want, timeSince: now, weatherSince: now };
  const hold = demo ? POND_HOLD_DEMO_MS : 0;
  let { time, weather, timeSince, weatherSince } = cur;
  if (want.time !== time && (pictureOf(want.time) === pictureOf(time) || now - timeSince >= hold)) {
    if (pictureOf(want.time) !== pictureOf(time)) timeSince = now;
    time = want.time;
  }
  if (want.weather !== weather && now - weatherSince >= hold) {
    weather = want.weather;
    weatherSince = now;
  }
  return time === cur.time && weather === cur.weather ? cur : { time, weather, timeSince, weatherSince };
}
/** The pictures' shares for a mood (the change itself fades in CSS). */
export function moodMix(time: PondTime): { dusk: number; night: number } {
  const p = pictureOf(time);
  return { dusk: p === 'dusk' ? 1 : 0, night: p === 'night' ? 1 : 0 };
}
