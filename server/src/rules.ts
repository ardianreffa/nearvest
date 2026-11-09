// Game rules and numbers. Prices come from the GDD; timings, XP and titles
// are first drafts to tune during play testing. Durations are in game days,
// so demo mode (1 day = 1 minute) speeds everything up automatically.

import { VOLCANIC_BOOST, type SkyView } from './weather.ts';

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

/**
 * Chances of each fruit quality on the next harvest. `goldBonus` (Volcanic soil) moves that much
 * chance to Gold, taken from Common first, then Rare.
 */
export function fruitOdds(treeQuality: Quality, fertilized: boolean, goldBonus = 0): Record<Quality, number> {
  let odds: Record<Quality, number>;
  if (!fertilized || treeQuality === 'gold') {
    odds = { common: treeQuality === 'common' ? 1 : 0, rare: treeQuality === 'rare' ? 1 : 0, gold: treeQuality === 'gold' ? 1 : 0 };
  } else if (treeQuality === 'rare') odds = { common: 0, rare: 1 - FERT_STEP1, gold: FERT_STEP1 };
  else odds = { common: 1 - FERT_STEP1 - FERT_STEP2, rare: FERT_STEP1, gold: FERT_STEP2 };
  if (goldBonus > 0 && odds.gold < 1) {
    const fromCommon = Math.min(odds.common, goldBonus);
    const fromRare = Math.min(odds.rare, goldBonus - fromCommon);
    odds = { common: odds.common - fromCommon, rare: odds.rare - fromRare, gold: odds.gold + fromCommon + fromRare };
  }
  return odds;
}

/** Fruit quality of a harvest. `roll` is in [0, 1). */
export function rollFruitQuality(treeQuality: Quality, fertilized: boolean, roll: number, goldBonus = 0): Quality {
  const odds = fruitOdds(treeQuality, fertilized, goldBonus);
  if (roll < odds.gold) return 'gold';
  if (roll < odds.gold + odds.rare) return 'rare';
  return 'common';
}

/** Profile avatars (pixel art drawn in web/src/art/avatars.tsx). Stored on the game server, not on chain. */
export const AVATARS = [
  'farmer_hat', 'farmer_hijab', 'solarpunk', 'grandpa', 'mango', 'rambutan', 'durian', 'tanibot',
  // TaniBot heads per title: each unlocks when the player reaches that title.
  'bot_seedling', 'bot_farmhand', 'bot_farmer', 'bot_orchard_master', 'bot_durian_king', 'bot_legend',
] as const;
/** Avatars that need a title first. */
export const AVATAR_TITLE: Partial<Record<(typeof AVATARS)[number], string>> = {
  bot_farmhand: 'Farmhand',
  bot_farmer: 'Farmer',
  bot_orchard_master: 'Orchard Master',
  bot_durian_king: 'Durian King',
  bot_legend: 'Legend',
};
export type AvatarId = (typeof AVATARS)[number];
export const DEFAULT_AVATAR: AvatarId = 'farmer_hat';

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
  /** Weather rules only: the last moment the tree had water (or wilted, or the weather release). */
  dryFromMs?: number;
  /** Weather rules only: when the tree was last cleaned of volcanic ash. */
  ashCleanMs?: number;
  /** Weather rules only: when the tree last went back one stage from thirst (0 = never). */
  wiltedAtMs?: number;
}

/**
 * One stage back after too long without water (GDD wilting). Never kills a tree:
 * fruiting -> tree (60% grown), tree -> sprout (25%), sprout -> seed (0%); a seed stays a seed.
 * A tree that was harvested before (regrowing, always "tree") loses its progress instead. Old
 * trees are not affected.
 */
export function wiltBack(t: Pick<TreeGrowth, 'growth' | 'target' | 'harvestCount' | 'maxHarvests'>, growth: number): number {
  if (t.harvestCount >= t.maxHarvests || t.target <= 0) return growth;
  const f = growth / t.target;
  if (f >= 1 - 1e-9) return 0.6 * t.target;
  if (t.harvestCount > 0) return 0;
  if (f >= 0.6) return 0.25 * t.target;
  if (f >= 0.25) return 0;
  return growth;
}

/**
 * Advances growth to `nowMs`. Trees only grow while watered; fertilizer adds speed.
 * With `sky` (the village weather) also: rain waters every tree for free, volcanic ash stops
 * growth until the tree is cleaned (or the eruption ends), cleaned trees grow faster on Volcanic
 * soil, and a tree without water for `sky.wiltMs` goes back one stage (then the count restarts).
 * The result does not depend on how often it is called (time is cut at every rule change).
 */
export function advance(t: TreeGrowth, nowMs: number, dayMs: number, sky?: SkyView): TreeGrowth {
  if (sky) return advanceWithWeather(t, nowMs, sky);
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

function advanceWithWeather(t: TreeGrowth, nowMs: number, sky: SkyView): TreeGrowth {
  let time = t.lastTickMs;
  if (nowMs <= time) return t;
  const dayMs = sky.dayMs;
  const old = t.harvestCount >= t.maxHarvests;
  const ashClean = t.ashCleanMs ?? 0;
  let growth = t.growth;
  let dry = Math.max(t.dryFromMs ?? time, 0);
  let wiltedAt = t.wiltedAtMs ?? 0;
  while (time < nowMs) {
    const day = Math.floor(time / dayMs);
    let end = Math.min(nowMs, (day + 1) * dayMs);
    const eruptions = sky.eruptionsNear(day);
    const marks = [t.waterUntilMs, t.fertUntilMs, ashClean, dry + sky.wiltMs];
    for (const e of eruptions) marks.push(e.start, e.end, e.volcanicEnd);
    for (const m of marks) if (m > time && m < end) end = m;

    const watered = sky.kind(day) === 'rain' || time < t.waterUntilMs;
    const e = eruptions.find((x) => time >= x.start && time < x.volcanicEnd);
    const cleaned = !!e && ashClean >= e.start && ashClean < e.end;
    const ashy = !old && !!e && time < e.end && !(cleaned && time >= ashClean);
    const volcanic = !old && !!e && time >= e.end && cleaned;
    if (watered && !ashy) {
      let rate = 1;
      if (time < t.fertUntilMs) rate += FERTILIZER_BOOST;
      if (volcanic) rate += VOLCANIC_BOOST;
      growth = Math.min(t.target, growth + (rate * (end - time)) / dayMs);
    }
    if (watered) dry = end;
    else if (!old && end - dry >= sky.wiltMs - 1e-6) {
      const back = wiltBack(t, growth);
      if (back !== growth) wiltedAt = end;
      growth = back;
      dry = end;
    }
    time = end;
  }
  return { ...t, growth, lastTickMs: nowMs, dryFromMs: dry, wiltedAtMs: wiltedAt };
}

/** How thirsty a tree is right now (call on a tree advanced to `nowMs` with the sky). */
export function thirstOf(t: TreeGrowth, nowMs: number, sky: SkyView) {
  const dryMs = Math.max(0, nowMs - (t.dryFromMs ?? nowMs));
  const old = t.harvestCount >= t.maxHarvests;
  return {
    dryMs,
    /** Half the wilting time without water. */
    thirsty: !old && dryMs >= 0.5 * sky.wiltMs,
    /** Three quarters: it goes back one stage soon. */
    wilting: !old && dryMs >= 0.75 * sky.wiltMs,
    msToWilt: old ? null : Math.max(0, sky.wiltMs - dryMs),
  };
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
