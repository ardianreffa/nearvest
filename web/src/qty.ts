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

/**
 * The amount a picker keeps while its stock changes under it (TaniBot harvests or sells, a poll
 * arrives): the player's pick stays; only when the stock drops below it, it follows the stock
 * down (and stays there). An empty stock keeps the pick for when fruit comes back.
 */
export function keepPick(picked: number, max: number): number {
  if (!Number.isFinite(max) || max < 1) return picked;
  return clampQty(picked, max);
}

const QUALITY_ORDER: Record<string, number> = { common: 0, rare: 1, gold: 2 };

/** Quality chips always in the same order (Common, Rare, Gold), whatever order the server sends. */
export function sortByQuality<T extends { quality: string }>(list: T[]): T[] {
  return [...list].sort((a, b) => (QUALITY_ORDER[a.quality] ?? 9) - (QUALITY_ORDER[b.quality] ?? 9));
}

/**
 * The quality a fruit row sells: the player's choice for as long as that quality is in stock,
 * else the first one in stock. New fruit of another quality never moves the choice.
 */
export function chosenQuality<Q extends string>(owned: { quality: Q }[], wanted: Q | null): Q | null {
  return owned.find((o) => o.quality === wanted)?.quality ?? owned[0]?.quality ?? null;
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

/** Village Stats' Season note: "lowest level" only when rewards really are at 12.5% (divisor 8). */
export function seasonNote(p: { rewardDivisor: number; nextSeasonAt: number | null }): string {
  const n = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (p.rewardDivisor >= 8) return 'Lowest reward level reached (12.5%)';
  if (p.nextSeasonAt) return `Rewards halve when ${n(p.nextSeasonAt)} PANEN have been minted (never below 12.5%)`;
  return 'Rewards halve as more PANEN is minted (never below 12.5%)';
}
