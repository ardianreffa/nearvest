// The village clock. A new day starts at 07:00 WIB (UTC+7), which is
// exactly 00:00 UTC, so day boundaries line up with UTC midnight.
// In demo mode one game day lasts one real minute.

export const REAL_DAY_MS = 24 * 60 * 60 * 1000;
export const DEMO_DAY_MS = 60 * 1000;

export function dayLengthMs(demo: boolean): number {
  return demo ? DEMO_DAY_MS : REAL_DAY_MS;
}

/** Index of the current game day (0 = the day that started at 1970-01-01 07:00 WIB). */
export function dayIndex(nowMs: number, demo: boolean): number {
  return Math.floor(nowMs / dayLengthMs(demo));
}

/** Milliseconds until the next game day starts. */
export function msUntilNextDay(nowMs: number, demo: boolean): number {
  const len = dayLengthMs(demo);
  return len - (nowMs % len);
}

export type Now = () => number;
export const systemNow: Now = () => Date.now();
