// The v3 train's path in perspective (art/train.tsx SlopeTrain): pure math, tested in
// web/test/train.test.ts.

/** Size at the far end of the rail, and the size below which the train is gone (too small to see). */
const SLOPE_FAR = 0.1;
export const SLOPE_GONE = 0.16;
/** Size steps (no shimmering from tiny changes every frame). */
const SLOPE_STEP = 0.04;

/** Train size (1 = full) and its left end (game x) at u = 0..1 of a run. */
export function slopeTrainAt(u: number, nearX: number, farX: number): { left: number; size: number } {
  // Fast while near, slower in the distance.
  const e = 1 - (1 - Math.min(1, Math.max(0, u))) ** 1.7;
  const left = nearX + (farX - nearX) * e;
  const raw = SLOPE_FAR + (1 - SLOPE_FAR) * ((left - farX) / (nearX - farX));
  return { left, size: Math.max(SLOPE_FAR, Math.round(raw / SLOPE_STEP) * SLOPE_STEP) };
}

