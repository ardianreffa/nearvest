// Mr. Darto, the village fruit buyer (simple rule-based version).
// Daily price = base price moved by up to ±30% (random per day and fruit),
// pushed down a little when many fruits were sold yesterday.
// Bounds: never below the seed price, never above base + 30%.
// (The AI brain from NEAR AI Cloud replaces the random part later, inside the same bounds.)

import { seededRandom } from './crypto.ts';
import { SPECIES, SPECIES_LIST, type Species } from './rules.ts';

export const PRICE_SWING = 0.3;
/** Fruits sold yesterday that push the price down by the maximum 15%. */
export const SUPPLY_FOR_MAX_DROP = 200;
export const MAX_SUPPLY_DROP = 0.15;

export interface DartoPrice {
  species: Species;
  price: number;
  base: number;
  min: number;
  max: number;
}

export function priceBounds(species: Species): { min: number; max: number } {
  const s = SPECIES[species];
  return { min: s.seedPrice, max: Math.floor(s.sellPrice * (1 + PRICE_SWING)) };
}

export function dailyPrice(species: Species, day: number, soldYesterday: number): DartoPrice {
  const base = SPECIES[species].sellPrice;
  const swing = (seededRandom(`darto:${species}:${day}`) * 2 - 1) * PRICE_SWING;
  const supplyDrop = Math.min(MAX_SUPPLY_DROP, (soldYesterday / SUPPLY_FOR_MAX_DROP) * MAX_SUPPLY_DROP);
  const { min, max } = priceBounds(species);
  const raw = Math.round(base * (1 + swing - supplyDrop));
  return { species, price: Math.min(max, Math.max(min, raw)), base, min, max };
}

export function greeting(prices: DartoPrice[]): string {
  const best = [...prices].sort((a, b) => b.price / b.base - a.price / a.base)[0];
  const ratio = best.price / best.base;
  const name = SPECIES[best.species].name.toLowerCase();
  if (ratio >= 1.15) return `Good day, farmer! I pay top coin for ${name} today. Bring me all you have!`;
  if (ratio >= 1) return `Fair prices today. ${SPECIES[best.species].name} is selling well.`;
  return `Hmm, the market is full of fruit. I can only offer modest prices today.`;
}

export function allPrices(day: number, soldYesterday: (s: Species) => number): DartoPrice[] {
  return SPECIES_LIST.map((s) => dailyPrice(s, day, soldYesterday(s)));
}
