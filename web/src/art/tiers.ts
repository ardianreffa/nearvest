// TaniBot's looks per title, without any drawing code (unit-tested in web/test/arena-turn.test.ts).
// The garden and the Arena duel both use these, so a TaniBot looks the same everywhere.

import type { EvolutionId } from './tanibot-evolutions.ts';

export type Tier = EvolutionId;
export const TIERS: Tier[] = ['seedling', 'farmhand', 'farmer', 'orchard_master', 'durian_king', 'legend'];
export const TIER_TITLE: Record<Tier, string> = {
  seedling: 'Seedling',
  farmhand: 'Farmhand',
  farmer: 'Farmer',
  orchard_master: 'Orchard Master',
  durian_king: 'Durian King',
  legend: 'Legend',
};

/** The TaniBot look that belongs to a title. */
export function tierOf(title: string): Tier {
  return TIERS.find((t) => TIER_TITLE[t] === title) ?? 'seedling';
}

export function tierRank(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/** Drones that fly with TaniBot: none at first, one from Farmer, two for the Legend. */
export function droneCount(tier: Tier): number {
  return tier === 'legend' ? 2 : tierRank(tier) >= tierRank('farmer') ? 1 : 0;
}
