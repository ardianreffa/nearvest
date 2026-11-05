// Game rules and numbers. Prices come from the GDD; timings, XP and titles
// are first drafts to tune during play testing. Durations are in game days,
// so demo mode (1 day = 1 minute) speeds everything up automatically.

export type Species = 'mango' | 'rambutan' | 'durian';
export type Quality = 'common' | 'rare' | 'gold';
export type Stage = 'seed' | 'sprout' | 'tree' | 'fruiting' | 'old';

export const SPECIES_LIST: Species[] = ['mango', 'rambutan', 'durian'];
export const QUALITY_LIST: Quality[] = ['common', 'rare', 'gold'];

export interface SpeciesRules {
  name: string;
  /** Shop price of a seed (GDD). */
  seedPrice: number;
  /** Mr. Darto base price per fruit (GDD). */
  sellPrice: number;
  /** Days of watered growth from seed to first fruit. */
  growDays: number;
  /** Days of watered growth between harvests. */
  regrowDays: number;
  /** Harvests before the tree becomes old. */
  harvests: number;
  xpPerHarvest: number;
}

export const SPECIES: Record<Species, SpeciesRules> = {
  mango: { name: 'Mango', seedPrice: 5, sellPrice: 10, growDays: 1, regrowDays: 0.5, harvests: 3, xpPerHarvest: 10 },
  rambutan: { name: 'Rambutan', seedPrice: 15, sellPrice: 25, growDays: 2, regrowDays: 1, harvests: 4, xpPerHarvest: 25 },
  durian: { name: 'Durian', seedPrice: 40, sellPrice: 60, growDays: 4, regrowDays: 2, harvests: 5, xpPerHarvest: 60 },
};

/** Sale price multiplier by quality (GDD: Rare x2, Gold x5). */
export const QUALITY_MULTIPLIER: Record<Quality, number> = { common: 1, rare: 2, gold: 5 };

/** Shop items (GDD prices). Every purchase is burned. */
export const SHOP_ITEMS = {
  seed_mango: { name: 'Mango seed', price: 5 },
  seed_rambutan: { name: 'Rambutan seed', price: 15 },
  seed_durian: { name: 'Durian seed', price: 40 },
  fertilizer: { name: 'Fertilizer', price: 8 },
} as const;
export type ShopItem = keyof typeof SHOP_ITEMS;

export const CHECKIN_PANEN = 5;
/**
 * Demo mode only: a streak survives this many missed game days (1 day = 1 minute,
 * so judges can see the streak grow without checking in every single minute).
 */
export const DEMO_STREAK_GRACE_DAYS = 10;
export const CHECKIN_DAY7_MULTIPLIER = 2;
export const WELCOME_PANEN = 50;
/** Maximum welcome packs per IP address per real day (anti-cheat). */
export const WELCOME_PACKS_PER_IP_PER_DAY = 3;

export const SEED_STORAGE_SLOTS = 20;
export const START_PLOTS = 2;
/** XP needed to unlock plot 3 (reaching the Farmhand title). */
export const PLOT3_XP = 50;

/** First tree of a new player fruits after about 3 real minutes of watered growth. */
export const FIRST_HARVEST_MS = 3 * 60 * 1000;
/** Watering keeps a tree growing for one game day. */
export const WATER_DAYS = 1;
/** Fertilizer adds +50% growth speed for one game day. */
export const FERTILIZER_DAYS = 1;
export const FERTILIZER_BOOST = 0.5;

/** Demo mode only: XP per harvest is multiplied so judges can see titles go up. */
export const DEMO_XP_MULTIPLIER = 5;

/**
 * Mr. Darto also buys seeds, cheaply (40% of the shop price, rounded down), so a
 * full storage never blocks a player. Known Rare/Gold seeds use the quality multiplier.
 */
export const SEED_SELL_FRACTION = 0.4;
export function seedSellPrice(species: Species, quality: Quality | null): number {
  return Math.max(1, Math.floor(SPECIES[species].seedPrice * SEED_SELL_FRACTION)) * (quality ? QUALITY_MULTIPLIER[quality] : 1);
}

/**
 * Fertilizer also raises the chance of better fruit on the next harvest (GDD:
 * quality chances rise when a tree is well cared for). Draft numbers: one quality
 * step up 20% (Common -> Rare, Rare -> Gold), two steps 5% (Common -> Gold).
 * Without fertilizer a tree gives fruit of its own quality.
 */
export const FERT_STEP1 = 0.2;
export const FERT_STEP2 = 0.05;

/** Chances of each fruit quality on the next harvest. */
export function fruitOdds(treeQuality: Quality, fertilized: boolean): Record<Quality, number> {
  if (!fertilized || treeQuality === 'gold') {
    return { common: treeQuality === 'common' ? 1 : 0, rare: treeQuality === 'rare' ? 1 : 0, gold: treeQuality === 'gold' ? 1 : 0 };
  }
  if (treeQuality === 'rare') return { common: 0, rare: 1 - FERT_STEP1, gold: FERT_STEP1 };
  return { common: 1 - FERT_STEP1 - FERT_STEP2, rare: FERT_STEP1, gold: FERT_STEP2 };
}

/** Fruit quality of a harvest. `roll` is in [0, 1). */
export function rollFruitQuality(treeQuality: Quality, fertilized: boolean, roll: number): Quality {
  const odds = fruitOdds(treeQuality, fertilized);
  if (roll < odds.gold) return 'gold';
  if (roll < odds.gold + odds.rare) return 'rare';
  return 'common';
}

export const TITLES: { name: string; xp: number }[] = [
  { name: 'Seedling', xp: 0 },
  { name: 'Farmhand', xp: 50 },
  { name: 'Farmer', xp: 200 },
  { name: 'Orchard Master', xp: 600 },
  { name: 'Durian King', xp: 1500 },
  { name: 'Legend', xp: 4000 },
];

export function titleFor(xp: number): string {
  let title = TITLES[0].name;
  for (const t of TITLES) if (xp >= t.xp) title = t.name;
  return title;
}

export function plotCount(xp: number): number {
  return START_PLOTS + (xp >= PLOT3_XP ? 1 : 0);
}

/**
 * Quality of a tree at planting (GDD: Common 80%, Rare 17%, Gold 3%;
 * a Gold parent raises the Gold chance to 10%). `roll` is in [0, 1).
 */
export function rollQuality(roll: number, parentQuality: Quality | null): Quality {
  let gold = 0.03;
  let rare = 0.17;
  if (parentQuality === 'gold') {
    gold = 0.1;
    rare = 0.2;
  } else if (parentQuality === 'rare') {
    gold = 0.05;
    rare = 0.25;
  }
  if (roll < gold) return 'gold';
  if (roll < gold + rare) return 'rare';
  return 'common';
}

// ---------- Tree growth ----------

export interface TreeGrowth {
  growth: number; // watered game days accumulated toward `target`
  target: number; // game days needed for the next fruit (or seed drop when old)
  lastTickMs: number;
  waterUntilMs: number;
  fertUntilMs: number;
  harvestCount: number;
  maxHarvests: number;
}

/** Advances growth to `nowMs`. Trees only grow while watered; fertilizer adds speed. */
export function advance(t: TreeGrowth, nowMs: number, dayMs: number): TreeGrowth {
  const from = t.lastTickMs;
  if (nowMs <= from) return t;
  const wateredEnd = Math.min(nowMs, t.waterUntilMs);
  let growth = t.growth;
  if (wateredEnd > from) {
    const watered = wateredEnd - from;
    const fertilized = Math.max(0, Math.min(wateredEnd, t.fertUntilMs) - from);
    growth += (watered + FERTILIZER_BOOST * fertilized) / dayMs;
  }
  return { ...t, growth: Math.min(growth, t.target), lastTickMs: nowMs };
}

export function isReady(t: TreeGrowth): boolean {
  return t.growth >= t.target - 1e-9;
}

export function stageOf(t: TreeGrowth): Stage {
  if (t.harvestCount >= t.maxHarvests) return 'old';
  if (isReady(t)) return 'fruiting';
  if (t.harvestCount > 0) return 'tree';
  const fraction = t.target > 0 ? t.growth / t.target : 1;
  if (fraction < 0.25) return 'seed';
  if (fraction < 0.6) return 'sprout';
  return 'tree';
}

/** Real milliseconds until ready if the tree stays watered (counts the fertilizer boost). */
export function msToReady(t: TreeGrowth, dayMs: number): number {
  const needMs = Math.max(0, (t.target - t.growth) * dayMs);
  const fertMs = Math.max(0, t.fertUntilMs - t.lastTickMs);
  const boosted = 1 + FERTILIZER_BOOST;
  if (needMs <= fertMs * boosted) return needMs / boosted;
  return fertMs + (needMs - fertMs * boosted);
}
