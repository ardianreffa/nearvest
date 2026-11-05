// Quantity picker rules (pure functions, unit-tested in web/test/qty.test.ts).

/** Keeps a picked quantity a whole number between 1 and max (0 when there is nothing). */
export function clampQty(value: number, max: number): number {
  if (!Number.isFinite(max) || max < 1) return 0;
  if (!Number.isFinite(value)) return 1;
  return Math.min(Math.floor(max), Math.max(1, Math.round(value)));
}

/** Next quantity after pressing - (step -1) or + (step +1). */
export function stepQty(value: number, step: number, max: number): number {
  return clampQty(value + step, max);
}

/** Total PANEN for a sale: unit price x quality multiplier x quantity. */
export function saleTotal(unitPrice: number, multiplier: number, qty: number): number {
  return Math.max(0, unitPrice * multiplier * qty);
}

/**
 * What a Mr. Darto sale really pays under the Season rule (harvest-sale rewards
 * are divided by 1, 2, 4 or 8). Same rounding as the server: down to 0.000001 PANEN.
 */
export function seasonPayout(total: number, divisor: number): number {
  const d = divisor >= 1 ? divisor : 1;
  return Math.floor(Math.round(total * 1_000_000) / d) / 1_000_000;
}
