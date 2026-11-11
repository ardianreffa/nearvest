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

// ---------- Garden visits (social.ts; docs/PLAN-social.md, Ardian 2026-11-09) ----------
/** XP for helping water a friend's tree (the demo XP multiplier applies, like every XP). */
export const HELP_XP_HELPER = 5;
/** XP for the garden's owner when a friend waters one of their trees... */
export const HELP_XP_OWNER = 3;
/** ...at most this many times per village day (more helps still water, without XP). */
export const HELP_OWNER_XP_PER_DAY = 3;
/** Gardens younger than this (real time) water and get watered, but get no help XP. */
export const HELP_MIN_GARDEN_AGE_MS = 24 * 60 * 60 * 1000;
/** The farmer list: at most this many rows, gardens active within this many days. */
export const FARMER_LIST_MAX = 30;
export const FARMER_ACTIVE_DAYS = 7;
/** Fewer real farmers than this: the newest judge gardens fill the list (never empty). */
export const FARMER_LIST_MIN = 5;

// ---------- Stickers and referral (docs/PLAN-social.md, Ardian 2026-11-10) ----------
/** Template stickers a visitor can leave (no free text anywhere); the web draws an icon per id. */
export const STICKERS = [
  { id: 'nice_garden', text: 'Nice garden!' },
  { id: 'great_durian', text: 'Great durian!' },
  { id: 'keep_it_up', text: 'Keep it up!' },
  { id: 'thanks_water', text: 'Thanks for the water!' },
  { id: 'gold_vibes', text: 'Gold vibes!' },
  { id: 'see_you', text: 'See you tomorrow!' },
] as const;
export type StickerId = (typeof STICKERS)[number]['id'];
/** The owner sees this many stickers received (newest first). */
export const STICKERS_SHOWN = 10;
/** A visitor can leave at most this many stickers per garden per village day (Ardian 2026-11-10)... */
export const STICKERS_PER_DAY = 3;
/** ...at least this long apart (the web counts down, the server refuses faster ones). */
export const STICKER_COOLDOWN_MS = 5000;
/** Village tab "Visitors": this many rows (1 row per visitor per garden per day) and waves back. */
export const VISITORS_SHOWN = 10;
/** Farmer search: names starting with this many characters at most (longer queries are cut). */
export const FARMER_SEARCH_MAX = 32;

// ---------- Friends and Online (docs/PLAN-arena.md 7.11, Ardian 2026-11-11) ----------
/** Add friend is one way (no accept): at most this many friends per garden... */
export const FRIENDS_MAX = 50;
/** ...and at most this many adds per village day (removing does not give one back), so nobody spams notices. */
export const FRIENDS_ADDS_PER_DAY = 20;
/** A garden is "Online" when its web sent a sign of life (POST /api/ping) this recently. */
export const ONLINE_MS = 60_000;
/** The web pings this often while its tab is visible (sent to the web in `state.friends.pingMs`). */
export const PING_MS = 30_000;
/** The ping writes `players.active_at` at most this often (the web pings every 30 s while visible). */
export const ACTIVE_WRITE_MS = 20_000;
/** Is a garden online now? (its visible game tab pinged in the last minute) */
export const isOnline = (activeAt: number | null | undefined, now: number) => !!activeAt && now - activeAt < ONLINE_MS;
/** Village tab: this many "added you as a friend" rows (newest first). */
export const FRIEND_ADDS_SHOWN = 10;
/** Referral: the inviter gets this (mint_reward, the Season rule applies) after the friend's first harvest... */
export const REF_REWARD_REFERRER = 20;
/** ...and the friend gets this (exact mint, like the welcome pack). */
export const REF_REWARD_FRIEND = 5;
/** At most this many referrals per real day from one device and from one IP (the friend's side). */
export const REF_PER_DAY_PER_DEVICE = 3;
export const REF_PER_DAY_PER_IP = 3;
/** An inviter is paid for at most this many referrals per real day (more wait for the next day). */
export const REF_PAID_PER_DAY_PER_REFERRER = 10;

// ---------- Arena 1 VS 1 (arena.ts; docs/PLAN-arena.md, Ardian 2026-11-11) ----------
/** Challenges a garden may start per village day (normal 07:00 WIB day, also for demo gardens). */
export const ARENA_DUELS_PER_DAY = 3;
/** A challenger's win pays this from the game (mint_reward: the Season rule applies). */
export const ARENA_PRIZE = 8;
/** Paid wins per real village day from one browser and from one IP; more wins are practice duels. */
export const ARENA_PAID_PER_DEVICE_PER_DAY = 3;
/** 10, not 3: many Indonesian mobile players share one IP, also friends on one WiFi (Ardian 2026-11-11). */
export const ARENA_PAID_PER_IP_PER_DAY = 10;
/**
 * XP (the demo multiplier applies): a challenger's win gives 15 XP at most 3 times per village day
 * (the same as the prize limit; Ardian 2026-11-11), a loss 1 XP, a defender's win 3 XP (at most 3
 * times a day). Practice duels (one person's gardens) give none.
 */
export const ARENA_XP_WIN = 15;
export const ARENA_XP_WINS_PER_DAY = 3;
export const ARENA_XP_LOSS = 1;
export const ARENA_XP_DEFEND = 3;
export const ARENA_DEFEND_XP_PER_DAY = 3;
/** A tied round is rolled again at most this many times; then the challenged garden wins it. */
export const ARENA_TIE_REROLLS = 5;
/** Recent duels shown in the Arena window and the Village tab. */
export const ARENA_RECENT = 10;
// Arena v2 (arena-match.ts, docs/PLAN-arena.md section 7): Rock / Paper / Scissors against the
// other garden's TaniBot. Draft numbers, tune in testing.
/** Life of each side. */
export const ARENA_HP = 100;
/**
 * No turn limit: a match runs until a K.O. (Ardian 2026-11-11). It always ends: a player who does not
 * pick loses the turn every ~13 s and is hit each time. This many turns is only a safety net that
 * a real match never reaches (then most life wins).
 */
export const ARENA_SAFETY_TURNS = 200;
/** Each turn the player has 10 s to pick (measured on the server). */
export const ARENA_TURN_MS = 10_000;
/** Extra time a pick may arrive after the 10 s (slow networks); the web never shows it. */
export const ARENA_TURN_GRACE_MS = 1_500;
/**
 * The next turn's 10 s start after the web has played the decided turn: about 3 s for a normal
 * turn, about 4 s more for each Gold Durian (its big animation).
 */
export const ARENA_PLAYBACK_MS = 3_000;
export const ARENA_PLAYBACK_GOLD_MS = 4_200;
/** The first turn starts this long after the duel opens (the screen appears). */
export const ARENA_START_MS = 1_500;
/** A match lost while the player missed this many turns in a row at the end = left (no XP). */
export const ARENA_IDLE_TURNS = 3;
/** Turns won to fill the skill bar (then the Gold Durian can be thrown). */
export const ARENA_SKILL_MAX = 3;
/** The Gold Durian: a sure hit that cannot be dodged (x the garden bonus). */
export const ARENA_GOLD_DURIAN = 40;
/** A turn winner's throw: a random fruit (percent chances) and its damage. */
export const ARENA_FRUIT_CHANCE = { mango: 50, rambutan: 35, durian: 15 } as const;
export const ARENA_QUALITY_CHANCE = { common: 70, rare: 22, gold: 8 } as const;
export const ARENA_FRUIT_DAMAGE = { mango: 14, rambutan: 18, durian: 24 } as const;
export const ARENA_QUALITY_DAMAGE = { common: 1, rare: 1.3, gold: 1.6 } as const;
/** Garden bonus on every hit: 0-20%, from the v1 garden score (0-9): max(0, score - 3) / 6 x 20%. */
export const ARENA_BONUS_MAX = 20;
// Arena v3 part 2: the online duel against a real player (arena-match.ts, docs/PLAN-arena.md 7.12).
// Only when the server's switch ARENA_ONLINE=on (default off: then the Arena works as v2).
/** The challenged player has this long to Accept / Decline; no answer = the duel goes on against their TaniBot. */
export const ARENA_INVITE_MS = 30_000;
/** While the online duel is switched on, the web pings this often (invites arrive within ~4 s). */
export const PING_LIVE_MS = 4_000;
/** A side of an online duel whose web has not asked for the match this long is "gone": the duel pauses. */
export const ARENA_GONE_MS = 5_000;
/** The other side waits this long ("Waiting for <name>... 20"); back in time = the duel goes on. */
export const ARENA_PAUSE_MS = 20_000;

// ---------- Fishing (fishing.ts, docs/PLAN-fishing.md, Ardian 2026-11-11) ----------

/** Casts per garden per village day (the normal 07:00 WIB day, also for demo gardens, like the Arena). */
export const FISHING_CASTS_PER_DAY = 3;
/** Paid catches (PANEN, a seed or Fertilizer) per village day from one browser / one IP; more = "released" (1 XP). */
export const FISHING_PAID_PER_DEVICE_PER_DAY = 3;
export const FISHING_PAID_PER_IP_PER_DAY = 10;
/** The bite comes this long after the cast (server clock). */
export const FISHING_BITE_MIN_MS = 2_000;
export const FISHING_BITE_MAX_MS = 6_000;
/** A reel may arrive this much before the bite time (network / clock jitter). */
export const FISHING_REEL_GRACE_MS = 300;
/** A line nobody reels in is pulled in by the server this long after the bite (paid all the same). */
export const FISHING_AUTO_REEL_MS = 60_000;
/** XP for junk and for a "released" catch (over the paid limit); a message in a bottle gives more. */
export const FISHING_JUNK_XP = 1;
export const FISHING_BOTTLE_XP = 5;
/** Small chest: PANEN between these (inclusive), rolled at the cast. */
export const FISHING_CHEST_MIN = 10;
export const FISHING_CHEST_MAX = 15;

export type FishingCatchId =
  | 'tilapia'
  | 'catfish'
  | 'carp'
  | 'gourami'
  | 'golden_arowana'
  | 'stone'
  | 'driftwood'
  | 'fish_bone'
  | 'old_boot'
  | 'mango_seed'
  | 'fertilizer'
  | 'bottle'
  | 'chest';
export type FishingKind = 'fish' | 'junk' | 'item';

/**
 * The catch table: `chance` in 1/1000 (sums to 1000). `panen` = base PANEN before the Season rule
 * (mint_reward). `paid` = counts toward the paid-catch limits per browser / IP.
 */
export const FISHING_CATCHES: { id: FishingCatchId; name: string; kind: FishingKind; chance: number; panen: number; paid: boolean }[] = [
  { id: 'tilapia', name: 'Tilapia', kind: 'fish', chance: 250, panen: 3, paid: true },
  { id: 'catfish', name: 'Catfish', kind: 'fish', chance: 150, panen: 5, paid: true },
  { id: 'carp', name: 'Carp', kind: 'fish', chance: 100, panen: 5, paid: true },
  { id: 'gourami', name: 'Gourami', kind: 'fish', chance: 70, panen: 10, paid: true },
  { id: 'golden_arowana', name: 'Golden Arowana', kind: 'fish', chance: 10, panen: 30, paid: true },
  { id: 'stone', name: 'Stone', kind: 'junk', chance: 75, panen: 0, paid: false },
  { id: 'driftwood', name: 'Driftwood', kind: 'junk', chance: 75, panen: 0, paid: false },
  { id: 'fish_bone', name: 'Fish bone', kind: 'junk', chance: 75, panen: 0, paid: false },
  { id: 'old_boot', name: 'Old boot', kind: 'junk', chance: 75, panen: 0, paid: false },
  { id: 'mango_seed', name: 'Mango seed', kind: 'item', chance: 50, panen: 0, paid: true },
  { id: 'fertilizer', name: 'Fertilizer', kind: 'item', chance: 30, panen: 0, paid: true },
  { id: 'bottle', name: 'Message in a bottle', kind: 'item', chance: 30, panen: 0, paid: false },
  { id: 'chest', name: 'Small chest', kind: 'item', chance: 10, panen: 0, paid: true },
];

/** Picks a catch from a roll in [0, 1). */
export function rollCatch(roll: number): FishingCatchId {
  let n = Math.floor(Math.min(Math.max(roll, 0), 0.999999) * 1000);
  for (const c of FISHING_CATCHES) {
    if (n < c.chance) return c.id;
    n -= c.chance;
  }
  return FISHING_CATCHES[0].id;
}

/** A judge garden's first cast: always Tilapia or Catfish (their normal 25:15 weights), never Golden Arowana. */
export function rollJudgeFirstCatch(roll: number): FishingCatchId {
  return roll < 250 / 400 ? 'tilapia' : 'catfish';
}

/** Messages in a bottle (one per bottle, picked at the cast). */
export const FISHING_BOTTLE_LINES = [
  'Dear finder: the train is late again because the conductor stopped to buy durian.',
  'Mount Tandur says hi. Please sweep the ash off your porch. - The Volcano',
  'If you find this, tell Mr. Darto his mango price is too low. - Every farmer',
  'Day 12 on the raft. Still no fish. TaniBot keeps watering the ocean.',
  'Lost: one bamboo hat, LED model. Last seen flying over the rice fields.',
  'The fish in this pond have formed a union. Their demand: more lily pads.',
  'Roses are red, durians are spiky, I tried to hug one and it went badly.',
  'Note to self: do not let TaniBot taste the fertilizer again.',
  'Whoever planted a mango on the train roof: it is now taller than the train.',
  'The Arena champion owes me 3 rambutans. You know who you are.',
  'Secret of Tandur: the holograms are shy. Wave at them at night.',
  'This bottle was sent by a very patient catfish. Please write back.',
];

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
  // Watered right now (by hand or by the rain): not thirsty at all.
  const wateredNow = t.waterUntilMs > nowMs || sky.kind(Math.floor(nowMs / sky.dayMs)) === 'rain';
  const dryMs = wateredNow ? 0 : Math.max(0, nowMs - (t.dryFromMs ?? nowMs));
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
