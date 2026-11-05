// Game actions. Every action updates SQLite immediately and queues the
// matching NEAR transaction (see chain/worker.ts).

import { KeyPair } from 'near-api-js';
import { dayIndex, dayLengthMs, msUntilNextDay } from './clock.ts';
import { encryptSecret } from './crypto.ts';
import { allPrices, greeting, type DartoPrice } from './darto.ts';
import { fromMicro, toMicro, tx, type DB } from './db.ts';
import { enqueue, enqueueTreeUpdate } from './chain/worker.ts';
import {
  advance,
  CHECKIN_DAY7_MULTIPLIER,
  CHECKIN_PANEN,
  DEMO_STREAK_GRACE_DAYS,
  FERTILIZER_DAYS,
  FIRST_HARVEST_MS,
  isReady,
  msToReady,
  plotCount,
  QUALITY_LIST,
  QUALITY_MULTIPLIER,
  rollQuality,
  SEED_STORAGE_SLOTS,
  SHOP_ITEMS,
  SPECIES,
  SPECIES_LIST,
  stageOf,
  TITLES,
  titleFor,
  WATER_DAYS,
  WELCOME_PACKS_PER_IP_PER_DAY,
  WELCOME_PANEN,
  type Quality,
  type ShopItem,
  type Species,
  type Stage,
  type TreeGrowth,
} from './rules.ts';

export class GameError extends Error {
  status: number;
  /** Extra machine-readable fields sent to the client, e.g. { code: 'price_changed' }. */
  details?: Record<string, unknown>;
  constructor(message: string, status = 400, details?: Record<string, unknown>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export interface GameDeps {
  db: DB;
  now: () => number;
  /** Random number in [0, 1); injectable for tests. */
  random: () => number;
  masterKey: string;
  /** Parent account for player names, e.g. "nearvest.testnet". */
  accountSuffix: string;
  explorerTxUrl: string;
  demoModeDefault: boolean;
}

export interface PlayerRow {
  id: number;
  user_id: number;
  name: string;
  account_id: string;
  public_key: string;
  account_status: string;
  demo: number;
  balance_micro: number;
  xp: number;
  checkin_day: number | null;
  streak: number;
  first_tree_planted: number;
  created_at: number;
}

export interface SeedView {
  id: number;
  species: Species;
  quality: Quality | null;
  parentTreeId: number | null;
  source: string;
}

interface TreeRow {
  id: number;
  player_id: number;
  plot: number | null;
  species: Species;
  quality: Quality;
  parent_tree_id: number | null;
  token_id: string | null;
  planted_at: number;
  growth: number;
  target: number;
  last_tick: number;
  water_until: number;
  water_day: number | null;
  fert_until: number;
  harvest_count: number;
  max_harvests: number;
  regrow_days: number;
  synced_stage: string | null;
  status: string;
}

const RESERVED_NAMES = new Set([
  'game', 'panen', 'pohon', 'garden', 'market', 'bot', 'admin', 'owner', 'nearvest', 'darto',
  'tanibot', 'lumbung', 'judge', 'system',
]);

/** Same rules as the factory contract. Returns an error message or null. */
export function nameError(name: string): string | null {
  if (name.length < 2 || name.length > 32) return 'Name must be 2-32 characters';
  if (!/^[a-z0-9]+([-_][a-z0-9]+)*$/.test(name)) {
    return "Use lowercase letters and digits, optionally joined by single '-' or '_'";
  }
  if (RESERVED_NAMES.has(name)) return 'This name is reserved';
  return null;
}

function growthOf(t: TreeRow): TreeGrowth {
  return {
    growth: t.growth,
    target: t.target,
    lastTickMs: t.last_tick,
    waterUntilMs: t.water_until,
    fertUntilMs: t.fert_until,
    harvestCount: t.harvest_count,
    maxHarvests: t.max_harvests,
  };
}

export class Game {
  private d: GameDeps;
  /** Current Season divisor (1, 2, 4, 8), refreshed from the chain. */
  seasonDivisor = 1;

  constructor(deps: GameDeps) {
    this.d = deps;
  }

  private get db(): DB {
    return this.d.db;
  }

  // ---------- Players ----------

  getPlayerByUser(userId: number): PlayerRow | null {
    return (this.db.prepare('SELECT * FROM players WHERE user_id = ?').get(userId) as unknown as PlayerRow) ?? null;
  }

  getPlayer(playerId: number): PlayerRow {
    const p = this.db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as unknown as PlayerRow | undefined;
    if (!p) throw new GameError('Player not found', 404);
    return p;
  }

  /**
   * Creates the garden and the player's NEAR account `<name>.<suffix>`.
   * The key pair is generated here and stored encrypted.
   */
  createPlayer(userId: number, name: string, ip: string | null, demo?: boolean): PlayerRow {
    const err = nameError(name);
    if (err) throw new GameError(err);
    if (this.getPlayerByUser(userId)) throw new GameError('You already have a garden', 409);
    if (this.db.prepare('SELECT 1 FROM players WHERE name = ?').get(name)) {
      throw new GameError('This name is taken', 409);
    }
    const now = this.d.now();
    const keyPair = KeyPair.fromRandom('ed25519');
    const publicKey = keyPair.getPublicKey().toString();
    const secretEnc = encryptSecret(keyPair.toString(), this.d.masterKey);
    const accountId = `${name}.${this.d.accountSuffix}`;

    const playerId = tx(this.db, () => {
      // Anti-cheat: limit welcome packs per IP per real day (never block the login itself).
      const since = now - 24 * 60 * 60 * 1000;
      const fromIp = ip
        ? (this.db.prepare('SELECT COUNT(*) AS n FROM players WHERE created_ip = ? AND created_at >= ?').get(ip, since) as {
            n: number;
          }).n
        : 0;
      const res = this.db
        .prepare(
          `INSERT INTO players (user_id, name, account_id, public_key, secret_key_enc, account_status, demo, created_ip, created_at)
           VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
        )
        .run(userId, name, accountId, publicKey, secretEnc, (demo ?? this.d.demoModeDefault) ? 1 : 0, ip, now);
      const id = Number(res.lastInsertRowid);
      enqueue(this.db, id, { kind: 'create_account', name, publicKey }, now);

      if (fromIp < WELCOME_PACKS_PER_IP_PER_DAY) {
        this.addSeed(id, 'durian', 'rare', null, 'welcome');
        this.earn(id, accountId, 'welcome', WELCOME_PANEN, 'Welcome pack');
      }
      return id;
    });
    return this.getPlayer(playerId);
  }

  private dayMs(p: PlayerRow): number {
    return dayLengthMs(p.demo === 1);
  }

  private today(p: PlayerRow): number {
    return dayIndex(this.d.now(), p.demo === 1);
  }

  /** Streak after checking in today: continues after yesterday (or within the demo grace window). */
  private nextStreak(p: PlayerRow, today: number): number {
    if (p.checkin_day === null) return 1;
    const gap = today - p.checkin_day;
    const allowed = p.demo === 1 ? DEMO_STREAK_GRACE_DAYS + 1 : 1;
    return gap >= 1 && gap <= allowed ? p.streak + 1 : 1;
  }

  private assertAccountOk(p: PlayerRow): void {
    if (p.account_status === 'failed') {
      throw new GameError('Your NEAR account could not be created. Please contact support.', 409);
    }
  }

  // ---------- $PANEN ledger ----------

  /** Exact mint (welcome pack, check-in): same amount in every Season. */
  private earn(playerId: number, accountId: string, kind: string, panen: number, note: string): void {
    const now = this.d.now();
    const micro = toMicro(panen);
    const ledgerId = this.ledger(playerId, kind, micro, note);
    const jobId = enqueue(this.db, playerId, { kind: 'mint', accountId, amountMicro: micro, memo: note, ledgerId }, now);
    this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(jobId, ledgerId);
    this.db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?').run(micro, playerId);
  }

  private ledger(playerId: number, kind: string, micro: number, note: string): number {
    const res = this.db
      .prepare('INSERT INTO ledger (player_id, kind, amount_micro, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(playerId, kind, micro, note, this.d.now());
    return Number(res.lastInsertRowid);
  }

  // ---------- Inventory ----------

  private seedCount(playerId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM seeds WHERE player_id = ?').get(playerId) as { n: number }).n;
  }

  private addSeed(playerId: number, species: Species, quality: Quality | null, parentTreeId: number | null, source: string): void {
    this.db
      .prepare('INSERT INTO seeds (player_id, species, quality, parent_tree_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(playerId, species, quality, parentTreeId, source, this.d.now());
  }

  private addFruit(playerId: number, species: Species, quality: Quality, qty: number): void {
    this.db
      .prepare(
        `INSERT INTO fruits (player_id, species, quality, qty) VALUES (?, ?, ?, ?)
         ON CONFLICT (player_id, species, quality) DO UPDATE SET qty = qty + excluded.qty`,
      )
      .run(playerId, species, quality, qty);
  }

  private itemQty(playerId: number, item: string): number {
    const row = this.db.prepare('SELECT qty FROM items WHERE player_id = ? AND item = ?').get(playerId, item) as
      | { qty: number }
      | undefined;
    return row?.qty ?? 0;
  }

  private addItem(playerId: number, item: string, qty: number): void {
    this.db
      .prepare(
        `INSERT INTO items (player_id, item, qty) VALUES (?, ?, ?)
         ON CONFLICT (player_id, item) DO UPDATE SET qty = qty + excluded.qty`,
      )
      .run(playerId, item, qty);
  }

  // ---------- Trees ----------

  private treeOnPlot(playerId: number, plot: number): TreeRow | null {
    return (
      (this.db.prepare("SELECT * FROM trees WHERE player_id = ? AND plot = ? AND status = 'alive'").get(playerId, plot) as unknown as
        | TreeRow
        | undefined) ?? null
    );
  }

  /** Loads the tree on a plot and brings its growth up to now. */
  private tickedTree(p: PlayerRow, plot: number): TreeRow {
    const t = this.treeOnPlot(p.id, plot);
    if (!t) throw new GameError('There is no tree on this plot');
    return this.saveGrowth(t, advance(growthOf(t), this.d.now(), this.dayMs(p)));
  }

  private saveGrowth(t: TreeRow, g: TreeGrowth): TreeRow {
    this.db.prepare('UPDATE trees SET growth = ?, last_tick = ? WHERE id = ?').run(g.growth, g.lastTickMs, t.id);
    return { ...t, growth: g.growth, last_tick: g.lastTickMs };
  }

  /** Stage and age of a tree right now (used by the chain worker to sync the NFT). */
  treeSnapshot(treeId: number) {
    const t = this.db
      .prepare(
        `SELECT t.*, p.account_id, p.demo, pt.token_id AS parent_token_id
         FROM trees t JOIN players p ON p.id = t.player_id LEFT JOIN trees pt ON pt.id = t.parent_tree_id
         WHERE t.id = ?`,
      )
      .get(treeId) as unknown as (TreeRow & { account_id: string; demo: number; parent_token_id: string | null }) | undefined;
    if (!t) return null;
    const dayMs = dayLengthMs(t.demo === 1);
    const g = advance(growthOf(t), this.d.now(), dayMs);
    return {
      token_id: t.token_id,
      account_id: t.account_id,
      stage: stageOf(g),
      age_days: Math.floor((this.d.now() - t.planted_at) / dayMs),
      harvest_count: t.harvest_count,
      parent_token_id: t.parent_token_id,
    };
  }

  /** Queues NFT updates for trees whose stage changed since the last sync. */
  syncStages(): number {
    const trees = this.db
      .prepare("SELECT t.*, p.demo FROM trees t JOIN players p ON p.id = t.player_id WHERE t.status = 'alive'")
      .all() as unknown as (TreeRow & { demo: number })[];
    let queued = 0;
    for (const t of trees) {
      const stage = stageOf(advance(growthOf(t), this.d.now(), dayLengthMs(t.demo === 1)));
      if (stage !== t.synced_stage) {
        enqueueTreeUpdate(this.db, t.player_id, t.id, this.d.now());
        queued++;
      }
    }
    return queued;
  }

  // ---------- Actions ----------

  checkin(playerId: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      this.assertAccountOk(p);
      const today = this.today(p);
      if (p.checkin_day === today) throw new GameError('You already checked in today. Come back tomorrow!');
      const streak = this.nextStreak(p, today);
      const calendarDay = ((streak - 1) % 7) + 1;
      const panen = calendarDay === 7 ? CHECKIN_PANEN * CHECKIN_DAY7_MULTIPLIER : CHECKIN_PANEN;
      this.db.prepare('UPDATE players SET checkin_day = ?, streak = ? WHERE id = ?').run(today, streak, p.id);
      this.earn(p.id, p.account_id, 'checkin', panen, `Daily check-in, day ${calendarDay}`);
      // A free mango seed every day, so nobody is ever stuck (even with full storage).
      this.addSeed(p.id, 'mango', null, null, 'checkin');
      const rewards = [`${panen} PANEN`, '1 Mango seed'];
      if (calendarDay === 7) {
        this.addSeed(p.id, 'mango', 'gold', null, 'checkin');
        rewards.push('1 Gold Mango seed');
      }
      return { streak, calendarDay, rewards };
    });
  }

  plant(playerId: number, plot: number, seedId: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      this.assertAccountOk(p);
      if (!Number.isInteger(plot) || plot < 0 || plot >= plotCount(p.xp)) throw new GameError('This plot is locked');
      if (this.treeOnPlot(p.id, plot)) throw new GameError('This plot already has a tree');
      const seed = this.db.prepare('SELECT * FROM seeds WHERE id = ? AND player_id = ?').get(seedId, p.id) as
        | { id: number; species: Species; quality: Quality | null; parent_tree_id: number | null }
        | undefined;
      if (!seed) throw new GameError('Seed not found');

      let parentQuality: Quality | null = null;
      if (seed.parent_tree_id) {
        const parent = this.db.prepare('SELECT quality FROM trees WHERE id = ?').get(seed.parent_tree_id) as
          | { quality: Quality }
          | undefined;
        parentQuality = parent?.quality ?? null;
      }
      const quality = seed.quality ?? rollQuality(this.d.random(), parentQuality);
      const rules = SPECIES[seed.species];
      const now = this.d.now();
      const dayMs = this.dayMs(p);
      // The very first tree fruits after ~3 real minutes of watered growth.
      const target = p.first_tree_planted ? rules.growDays : Math.min(rules.growDays, FIRST_HARVEST_MS / dayMs);

      this.db.prepare('DELETE FROM seeds WHERE id = ?').run(seed.id);
      const res = this.db
        .prepare(
          `INSERT INTO trees (player_id, plot, species, quality, parent_tree_id, planted_at, growth, target, last_tick,
             max_harvests, regrow_days, synced_stage)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'seed')`,
        )
        .run(p.id, plot, seed.species, quality, seed.parent_tree_id, now, target, now, rules.harvests, rules.regrowDays);
      const treeId = Number(res.lastInsertRowid);
      this.db.prepare('UPDATE players SET first_tree_planted = 1 WHERE id = ?').run(p.id);
      enqueue(this.db, p.id, { kind: 'mint_tree', treeId, accountId: p.account_id, species: seed.species, quality }, now);
      return { treeId, species: seed.species, quality };
    });
  }

  water(playerId: number, plot: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      const t = this.tickedTree(p, plot);
      const today = this.today(p);
      if (t.water_day === today) throw new GameError('This tree was already watered today');
      const now = this.d.now();
      this.db.prepare('UPDATE trees SET water_until = ?, water_day = ? WHERE id = ?').run(now + WATER_DAYS * this.dayMs(p), today, t.id);
      return { watered: true };
    });
  }

  fertilize(playerId: number, plot: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      const t = this.tickedTree(p, plot);
      const now = this.d.now();
      if (t.fert_until > now) throw new GameError('This tree is already fertilized');
      if (this.itemQty(p.id, 'fertilizer') < 1) throw new GameError('You have no fertilizer. Buy some in the Shop.');
      this.addItem(p.id, 'fertilizer', -1);
      this.db.prepare('UPDATE trees SET fert_until = ? WHERE id = ?').run(now + FERTILIZER_DAYS * this.dayMs(p), t.id);
      return { fertilized: true };
    });
  }

  harvest(playerId: number, plot: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      this.assertAccountOk(p);
      const t = this.tickedTree(p, plot);
      const g = growthOf(t);
      if (!isReady(g)) throw new GameError('Nothing to harvest yet. Keep watering!');
      const now = this.d.now();
      const rules = SPECIES[t.species];

      if (t.harvest_count >= t.max_harvests) {
        // An old tree drops one superior seed, then dies and becomes a Memorial Tree.
        if (this.seedCount(p.id) >= SEED_STORAGE_SLOTS) throw new GameError('Your seed storage is full. Plant some seeds first.');
        this.addSeed(p.id, t.species, null, t.id, 'tree');
        this.killTree(p, t);
        return { kind: 'seed' as const, species: t.species, treeDied: true };
      }

      this.addFruit(p.id, t.species, t.quality, 1);
      const harvestCount = t.harvest_count + 1;
      this.db
        .prepare('UPDATE trees SET harvest_count = ?, growth = 0, target = regrow_days, last_tick = ? WHERE id = ?')
        .run(harvestCount, now, t.id);
      this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(rules.xpPerHarvest, p.id);
      enqueueTreeUpdate(this.db, p.id, t.id, now);
      return { kind: 'fruit' as const, species: t.species, quality: t.quality, qty: 1, xp: rules.xpPerHarvest, harvestCount };
    });
  }

  /** Cuts a tree down early to free the plot. It becomes a Memorial Tree. */
  chop(playerId: number, plot: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      const t = this.treeOnPlot(p.id, plot);
      if (!t) throw new GameError('There is no tree on this plot');
      this.killTree(p, t);
      return { chopped: true };
    });
  }

  private killTree(p: PlayerRow, t: TreeRow): void {
    const now = this.d.now();
    this.db.prepare("UPDATE trees SET status = 'dead', plot = NULL, died_at = ? WHERE id = ?").run(now, t.id);
    enqueue(this.db, p.id, { kind: 'make_memorial', treeId: t.id }, now);
  }

  dartoPrices(demo: boolean): { day: number; prices: DartoPrice[]; greeting: string } {
    const day = dayIndex(this.d.now(), demo);
    const prices = allPrices(day, (s) => this.soldOnDay(s, day - 1, demo));
    return { day, prices, greeting: greeting(prices) };
  }

  private soldOnDay(species: Species, day: number, demo: boolean): number {
    const row = this.db
      .prepare('SELECT COALESCE(SUM(qty), 0) AS n FROM sales WHERE species = ? AND day = ? AND demo = ?')
      .get(species, day, demo ? 1 : 0) as { n: number };
    return row.n;
  }

  /**
   * Sells fruit to Mr. Darto. `expectedPrice` is the per-fruit price the player saw;
   * if today's price is different (the day changed), nothing is sold and the client
   * gets the new price to confirm.
   */
  sell(playerId: number, species: Species, quality: Quality, qty: number, expectedPrice?: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      this.assertAccountOk(p);
      if (!SPECIES_LIST.includes(species) || !QUALITY_LIST.includes(quality)) throw new GameError('Unknown fruit');
      if (!Number.isInteger(qty) || qty < 1) throw new GameError('Quantity must be at least 1');
      const have = this.db
        .prepare('SELECT qty FROM fruits WHERE player_id = ? AND species = ? AND quality = ?')
        .get(p.id, species, quality) as { qty: number } | undefined;
      if (!have || have.qty < qty) throw new GameError('You do not have that many fruits');

      const demo = p.demo === 1;
      const { day, prices } = this.dartoPrices(demo);
      const price = prices.find((x) => x.species === species)!.price;
      if (expectedPrice !== undefined && expectedPrice !== price) {
        throw new GameError(`Mr. Darto's price changed from ${expectedPrice} to ${price} per fruit.`, 409, {
          code: 'price_changed',
          oldPrice: expectedPrice,
          price,
        });
      }
      const basePanen = price * QUALITY_MULTIPLIER[quality] * qty;
      const baseMicro = toMicro(basePanen);
      // Expected amount after the Season rule; the contract has the final say.
      const expectedMicro = Math.floor(baseMicro / this.seasonDivisor);
      const now = this.d.now();

      this.addFruit(p.id, species, quality, -qty);
      this.db.prepare('INSERT INTO sales (player_id, species, qty, day, demo, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(p.id, species, qty, day, demo ? 1 : 0, now);
      const note = `Sold ${qty} ${quality} ${species} to Mr. Darto at ${price}`;
      const ledgerId = this.ledger(p.id, 'sell', expectedMicro, note);
      const jobId = enqueue(this.db, p.id, { kind: 'mint_reward', accountId: p.account_id, baseMicro, memo: note, ledgerId }, now);
      this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(jobId, ledgerId);
      this.db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?').run(expectedMicro, p.id);
      return { price, basePanen, expectedPanen: fromMicro(expectedMicro), seasonDivisor: this.seasonDivisor };
    });
  }

  buy(playerId: number, item: ShopItem, qty = 1) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      this.assertAccountOk(p);
      const entry = SHOP_ITEMS[item];
      if (!entry) throw new GameError('Unknown item');
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new GameError('Quantity must be 1-20');
      const costMicro = toMicro(entry.price * qty);
      if (p.balance_micro < costMicro) throw new GameError('Not enough PANEN');
      const isSeed = item.startsWith('seed_');
      if (isSeed && this.seedCount(p.id) + qty > SEED_STORAGE_SLOTS) throw new GameError('Your seed storage is full');

      const now = this.d.now();
      const note = `Shop: ${qty} x ${entry.name}`;
      const ledgerId = this.ledger(p.id, 'shop', -costMicro, note);
      const jobId = enqueue(this.db, p.id, { kind: 'burn', accountId: p.account_id, amountMicro: costMicro, memo: note, ledgerId }, now);
      this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(jobId, ledgerId);
      this.db.prepare('UPDATE players SET balance_micro = balance_micro - ? WHERE id = ?').run(costMicro, p.id);
      if (isSeed) {
        const species = item.slice('seed_'.length) as Species;
        for (let i = 0; i < qty; i++) this.addSeed(p.id, species, null, null, 'shop');
      } else {
        this.addItem(p.id, item, qty);
      }
      return { bought: item, qty, burnedPanen: entry.price * qty };
    });
  }

  // ---------- Views ----------

  state(playerId: number) {
    const p = this.getPlayer(playerId);
    const now = this.d.now();
    const demo = p.demo === 1;
    const dayMs = this.dayMs(p);
    const today = this.today(p);
    const plots = plotCount(p.xp);

    const plotViews = [];
    for (let plot = 0; plot < 3; plot++) {
      const t = this.treeOnPlot(p.id, plot);
      let tree = null;
      if (t) {
        const g = advance(growthOf(t), now, dayMs);
        const ready = isReady(g);
        tree = {
          id: t.id,
          tokenId: t.token_id,
          species: t.species,
          quality: t.quality,
          stage: stageOf(g) as Stage,
          growthPercent: Math.round((g.growth / g.target) * 100),
          ready,
          wateredToday: t.water_day === today,
          isWatered: t.water_until > now,
          isFertilized: t.fert_until > now,
          harvestCount: t.harvest_count,
          maxHarvests: t.max_harvests,
          msToReady: ready ? 0 : msToReady(g, dayMs),
          ageDays: Math.floor((now - t.planted_at) / dayMs),
        };
      }
      plotViews.push({ plot, locked: plot >= plots, tree });
    }

    const nextTitle = TITLES.find((t) => t.xp > p.xp) ?? null;
    const checkedInToday = p.checkin_day === today;
    const nextStreak = checkedInToday ? p.streak : this.nextStreak(p, today);
    const seeds = this.db
      .prepare('SELECT id, species, quality, parent_tree_id AS parentTreeId, source FROM seeds WHERE player_id = ? ORDER BY id')
      .all(p.id) as unknown as SeedView[];
    const fruits = this.db
      .prepare('SELECT species, quality, qty FROM fruits WHERE player_id = ? AND qty > 0')
      .all(p.id) as unknown as { species: Species; quality: Quality; qty: number }[];
    const items = this.db
      .prepare('SELECT item, qty FROM items WHERE player_id = ? AND qty > 0')
      .all(p.id) as unknown as { item: string; qty: number }[];

    return {
      player: {
        name: p.name,
        accountId: p.account_id,
        accountStatus: p.account_status,
        demo,
        balance: fromMicro(p.balance_micro),
        xp: p.xp,
        title: titleFor(p.xp),
        nextTitle,
      },
      clock: { day: today, farmDay: today - dayIndex(p.created_at, demo) + 1, msUntilNextDay: msUntilNextDay(now, demo), dayLengthMs: dayMs },
      checkin: {
        available: !checkedInToday,
        streak: p.streak,
        nextCalendarDay: ((nextStreak - 1) % 7) + 1,
        calendar: [1, 2, 3, 4, 5, 6, 7].map((day) => ({
          day,
          reward: day === 7
            ? `${CHECKIN_PANEN * CHECKIN_DAY7_MULTIPLIER} PANEN + Mango seed + Gold Mango seed`
            : `${CHECKIN_PANEN} PANEN + Mango seed`,
        })),
      },
      plots: plotViews,
      seeds,
      seedSlots: { used: seeds.length, max: SEED_STORAGE_SLOTS },
      fruits,
      items,
      darto: this.dartoPrices(demo),
      activity: this.activity(p.id),
    };
  }

  /** Recent on-chain activity with explorer links (proof for judges). */
  activity(playerId: number, limit = 20) {
    const rows = this.db
      .prepare('SELECT id, kind, status, tx_hash, error, created_at FROM chain_jobs WHERE player_id = ? ORDER BY id DESC LIMIT ?')
      .all(playerId, limit) as { id: number; kind: string; status: string; tx_hash: string | null; error: string | null; created_at: number }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      txHash: r.tx_hash,
      explorerUrl: r.tx_hash && !r.tx_hash.startsWith('fake') ? this.d.explorerTxUrl + r.tx_hash : null,
      error: r.status === 'failed' ? r.error : null,
      createdAt: r.created_at,
    }));
  }

  localStats() {
    const one = (sql: string) => (this.db.prepare(sql).get() as { n: number }).n;
    return {
      players: one('SELECT COUNT(*) AS n FROM players'),
      treesAlive: one("SELECT COUNT(*) AS n FROM trees WHERE status = 'alive'"),
      memorialTrees: one("SELECT COUNT(*) AS n FROM trees WHERE status = 'dead'"),
      harvests: one('SELECT COALESCE(SUM(harvest_count), 0) AS n FROM trees'),
      fruitsSold: one('SELECT COALESCE(SUM(qty), 0) AS n FROM sales'),
      pendingTransactions: one("SELECT COUNT(*) AS n FROM chain_jobs WHERE status = 'pending'"),
    };
  }
}

