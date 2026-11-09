// Village weather and village events (never called "seasons": a Season is the PANEN halving).
//
// The weather is the same for the whole village and comes from the village day number alone, so
// it needs no table and a restart gives the same weather. Normal mode: a fixed pseudo-random draw
// per real day. Demo mode (1 day = 1 minute): a fixed 10-day cycle, so judges see rain, a drought
// and an eruption within about 10 minutes.
//
// Kinds: clear (water once), rain (every tree is watered for free all day), drought (a watering
// only lasts half a day: water twice). Village event: the Mount Tandur eruption, in three phases:
// warning ("Mount Tandur is rumbling!") -> eruption (ash stops growth until cleaned) -> Volcanic soil
// (cleaned trees grow faster and get a better Gold chance). Nothing ever kills a tree or an NFT.

import { DEMO_DAY_MS, REAL_DAY_MS } from './clock.ts';

export type WeatherKind = 'clear' | 'rain' | 'drought';
export type EruptionPhase = 'warning' | 'eruption' | 'volcanic';

/** One eruption (times in ms since the epoch). */
export interface Eruption {
  /** Village day on which the warning starts. */
  day: number;
  warnStart: number;
  /** Ash falls from here; trees stop growing until cleaned. */
  start: number;
  /** The eruption ends; Volcanic soil starts. */
  end: number;
  volcanicEnd: number;
}

/** The village sky for one mode (normal or demo), as the growth rules and the game use it. */
export interface SkyView {
  dayMs: number;
  /** Days without water before a tree goes back one stage, in ms. */
  wiltMs: number;
  kind(day: number): WeatherKind;
  /** Eruptions whose phases may touch `day` (their warning starts on that day or up to 2 days before). */
  eruptionsNear(day: number): Eruption[];
}

/** Draft numbers (tune in testing). */
export const RAIN_CHANCE = 0.2;
export const DROUGHT_CHANCE = 0.12;
export const ERUPTION_CHANCE = 0.1;
/** Normal mode: the warning starts at 10:00 WIB (3 h into the village day). */
export const ERUPTION_WARN_OFFSET_MS = 3 * 60 * 60 * 1000;
export const ERUPTION_WARN_MS = 2 * 60 * 60 * 1000;
export const ERUPTION_MS = 60 * 60 * 1000;
export const VOLCANIC_MS = REAL_DAY_MS;
/** Demo mode timings (one demo day = 60 s). */
export const DEMO_ERUPTION_WARN_MS = 20_000;
export const DEMO_ERUPTION_MS = 30_000;
export const DEMO_VOLCANIC_MS = DEMO_DAY_MS;
/** 2 village days without water = back one stage; demo mode is gentler: about 10 demo days (Ardian). */
export const WILT_DAYS = 2;
export const WILT_DAYS_DEMO = 10;
/** Volcanic soil: +30% growth speed and +5 points of Gold chance at harvest (cleaned trees only). */
export const VOLCANIC_BOOST = 0.3;
export const VOLCANIC_GOLD_BONUS = 0.05;
/** In a drought one watering lasts half a day; a tree can be watered twice that day. */
export const DROUGHT_WATER_DAYS = 0.5;
export const DROUGHT_WATERINGS = 2;

/** Demo mode: a fixed cycle of 10 demo days (10 minutes). */
export const DEMO_CYCLE: readonly (WeatherKind | 'eruption')[] = ['clear', 'rain', 'clear', 'drought', 'clear', 'clear', 'eruption', 'clear', 'rain', 'clear'];

/** A stable number in [0, 1) for a day (integer hash, no state). */
function unit(day: number, salt: number): number {
  let h = (Math.imul(day | 0, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 2 ** 32;
}

/** The village weather schedule (normal and demo). Tests may pass their own (see clearSky). */
export interface WeatherSchedule {
  kind(day: number, demo: boolean): WeatherKind;
  /** The eruption whose warning starts on `day`, if any. */
  eruption(day: number, demo: boolean): Eruption | null;
}

function normalCandidate(day: number): boolean {
  const u = unit(day, 1);
  return u >= RAIN_CHANCE + DROUGHT_CHANCE && unit(day, 2) < ERUPTION_CHANCE;
}

/** The phases of an eruption whose warning starts on `day` (normal: 10:00 WIB; demo: at the day's start). */
export function eruptionTimes(day: number, demo: boolean): Eruption {
  const warnStart = demo ? day * DEMO_DAY_MS : day * REAL_DAY_MS + ERUPTION_WARN_OFFSET_MS;
  const start = warnStart + (demo ? DEMO_ERUPTION_WARN_MS : ERUPTION_WARN_MS);
  const end = start + (demo ? DEMO_ERUPTION_MS : ERUPTION_MS);
  return { day, warnStart, start, end, volcanicEnd: end + (demo ? DEMO_VOLCANIC_MS : VOLCANIC_MS) };
}

export const villageWeather: WeatherSchedule = {
  kind(day, demo) {
    if (demo) {
      const k = DEMO_CYCLE[((day % DEMO_CYCLE.length) + DEMO_CYCLE.length) % DEMO_CYCLE.length];
      return k === 'eruption' ? 'clear' : k;
    }
    const u = unit(day, 1);
    if (u < RAIN_CHANCE) return 'rain';
    if (u < RAIN_CHANCE + DROUGHT_CHANCE) return 'drought';
    return 'clear';
  },
  eruption(day, demo) {
    if (demo) {
      return DEMO_CYCLE[((day % DEMO_CYCLE.length) + DEMO_CYCLE.length) % DEMO_CYCLE.length] === 'eruption' ? eruptionTimes(day, true) : null;
    }
    // At most one eruption in three days: a clear day whose own draw is low and whose two
    // previous days were no candidates.
    if (!normalCandidate(day) || normalCandidate(day - 1) || normalCandidate(day - 2)) return null;
    return eruptionTimes(day, false);
  },
};

/** Always clear, never an eruption (tests that are not about the weather). */
export const clearSky: WeatherSchedule = { kind: () => 'clear', eruption: () => null };

/** The sky of one mode, for the growth rules. */
export function skyView(schedule: WeatherSchedule, demo: boolean): SkyView {
  const dayMs = demo ? DEMO_DAY_MS : REAL_DAY_MS;
  return {
    dayMs,
    wiltMs: (demo ? WILT_DAYS_DEMO : WILT_DAYS) * dayMs,
    kind: (day) => schedule.kind(day, demo),
    eruptionsNear(day) {
      const out: Eruption[] = [];
      for (let d = day - 2; d <= day; d++) {
        const e = schedule.eruption(d, demo);
        if (e) out.push(e);
      }
      return out;
    },
  };
}

/** The eruption around `ms` (from its warning to the end of its Volcanic soil), with its phase. */
export function eruptionAt(sky: SkyView, ms: number): { eruption: Eruption; phase: EruptionPhase } | null {
  const day = Math.floor(ms / sky.dayMs);
  for (const e of sky.eruptionsNear(day)) {
    if (ms < e.warnStart || ms >= e.volcanicEnd) continue;
    return { eruption: e, phase: ms < e.start ? 'warning' : ms < e.end ? 'eruption' : 'volcanic' };
  }
  return null;
}

/** Was the tree cleaned of this eruption's ash (during the eruption)? */
export function cleanedOf(e: Eruption, ashCleanMs: number): boolean {
  return ashCleanMs >= e.start && ashCleanMs < e.end;
}
