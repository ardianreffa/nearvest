// Game actions. Every action updates SQLite immediately and queues the
// matching NEAR transaction (see chain/worker.ts).

import { KeyPair } from 'near-api-js';
import { dayIndex, dayLengthMs, msUntilNextDay } from './clock.ts';
import { encryptSecret } from './crypto.ts';
import { allPrices, greeting, type DartoPrice } from './darto.ts';
import { fromMicro, toMicro, tx, TUTORIAL_DONE, type DB } from './db.ts';
import { enqueue, enqueueTreeUpdate } from './chain/worker.ts';
import { UNITS_PER_MICRO } from './chain/types.ts';
import { burnDelegateHash, verifySignature } from './wallet.ts';
import {
  advance,
  AVATARS,
  AVATAR_TITLE,
  CHECKIN_DAY7_MULTIPLIER,
  CHECKIN_PANEN,
  DEMO_STREAK_GRACE_DAYS,
  DEMO_XP_MULTIPLIER,
  FERTILIZER_BOOST,
  FERTILIZER_DAYS,
  fruitOdds,
  FIRST_HARVEST_MS,
  isReady,
  msToReady,
  plotCount,
  QUALITY_LIST,
  QUALITY_MULTIPLIER,
  rollFruitQuality,
  rollQuality,
  SEED_STORAGE_SLOTS,
  seedSellPrice,
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
  /** PANEN contract: wallet players' burns are signed for this receiver. */
  panenContractId?: string;
}

/** A shop burn signed in the browser with a wallet player's game key. */
export interface SignedBurn {
  publicKey: string;
  nonce: string;
  maxBlockHeight: string;
  signature: string;
}

export interface PlayerRow {
  id: number;
  user_id: number;
  name: string;
  account_id: string;
  public_key: string;
  account_status: string;
  /** 'server' = game-held key (Google/dev), 'wallet' = player's own NEAR account. */
  custody: 'server' | 'wallet';
  key_nonce: number;
  /** NEAR wallet that can sign in to this garden (wallet players: their own account). */
  wallet_account_id: string | null;
  /** Google account linked to a wallet garden. */
  google_sub: string | null;
  avatar: string;
  demo: number;
  tutorial_step: number;
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
  fert_boost: number;
  harvest_count: number;
  max_harvests: number;
  regrow_days: number;
  synced_stage: string | null;
  status: string;
}

/**
 * The tutorial for new gardens (TaniBot guides): the player learns the loop by hand first,
 * then meets TaniBot right after the first manual harvest. A step is done as soon as its goal
 * is reached, in any order (e.g. a check-in before the tutorial asks for it).
 */
export const TUTORIAL_STEPS = ['welcome', 'plant', 'water', 'buy_fertilizer', 'fertilize', 'checkin', 'harvest', 'sell', 'tanibot'] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];

/** Try as Judge: starting XP (Farmhand, third plot open) and PANEN. */
export const JUDGE_XP = 60;
export const JUDGE_PANEN = 100;
export const JUDGE_STEPS = ['harvest', 'sell', 'shop', 'tanibot', 'village'] as const;
export type JudgeStep = (typeof JUDGE_STEPS)[number];

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
  // `<name>-bot.nearvest.testnet` is the TaniBot account of a wallet garden.
  if (name.endsWith('-bot')) return "Names ending in '-bot' are reserved for TaniBots";
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

  /** The garden a NEAR wallet can sign in to (its own garden or a linked Google garden). */
  getPlayerByWallet(accountId: string): PlayerRow | null {
    return (this.db.prepare('SELECT * FROM players WHERE wallet_account_id = ?').get(accountId) as unknown as PlayerRow) ?? null;
  }

  /** The wallet garden a Google account was linked to, if any. */
  getPlayerByGoogle(sub: string): PlayerRow | null {
    return (this.db.prepare('SELECT * FROM players WHERE google_sub = ?').get(sub) as unknown as PlayerRow) ?? null;
  }

  /** Links a verified Google account to a wallet garden. One Google account = one garden. */
  linkGoogle(playerId: number, sub: string): void {
    const p = this.getPlayer(playerId);
    if (p.custody !== 'wallet') throw new GameError('This garden already signs in with Google');
    if (p.google_sub === sub) return;
    if (p.google_sub) throw new GameError('This garden is already linked to a Google account', 409, { code: 'garden_linked' });
    const own = this.db
      .prepare("SELECT 1 FROM players p JOIN users u ON u.id = p.user_id WHERE u.provider = 'google' AND u.subject = ?")
      .get(sub);
    if (own) throw new GameError('This Google account already has its own garden', 409, { code: 'google_has_garden' });
    if (this.getPlayerByGoogle(sub)) throw new GameError('This Google account is already linked to another garden', 409, { code: 'google_linked' });
    this.db.prepare('UPDATE players SET google_sub = ? WHERE id = ?').run(sub, p.id);
  }

  setAvatar(playerId: number, avatar: unknown): void {
    if (typeof avatar !== 'string' || !(AVATARS as readonly string[]).includes(avatar)) throw new GameError('Unknown avatar');
    const p = this.getPlayer(playerId);
    const needs = AVATAR_TITLE[avatar as keyof typeof AVATAR_TITLE];
    const needXp = needs ? TITLES.find((t) => t.name === needs)!.xp : 0;
    if (p.xp < needXp) throw new GameError(`Reach ${needs} to unlock this avatar`, 403, { code: 'avatar_locked' });
    this.db.prepare('UPDATE players SET avatar = ? WHERE id = ?').run(avatar, p.id);
  }

  /** Links a proven NEAR wallet to a Google/dev garden. One wallet = one garden. */
  linkWallet(playerId: number, accountId: string): void {
    const p = this.getPlayer(playerId);
    if (p.custody === 'wallet') throw new GameError('This garden already uses a NEAR wallet');
    if (p.wallet_account_id === accountId) return;
    if (p.wallet_account_id) throw new GameError(`This garden is already linked to ${p.wallet_account_id}`, 409, { code: 'garden_linked' });
    const taken = this.db.prepare('SELECT 1 FROM players WHERE (wallet_account_id = ? OR account_id = ?) AND id != ?').get(accountId, accountId, p.id);
    if (taken) throw new GameError('This NEAR wallet is already linked to another garden', 409, { code: 'wallet_linked' });
    this.db.prepare('UPDATE players SET wallet_account_id = ? WHERE id = ?').run(accountId, p.id);
  }

  getPlayer(playerId: number): PlayerRow {
    const p = this.db.prepare('SELECT * FROM players WHERE id = ?').get(playerId) as unknown as PlayerRow | undefined;
    if (!p) throw new GameError('Player not found', 404);
    return p;
  }

  /**
   * Creates the garden. Google/dev players get a new NEAR account `<name>.<suffix>`
   * (key pair generated here, stored encrypted). Wallet players keep their own
   * account; the name is only their farmer name.
   */
  createPlayer(userId: number, name: string, ip: string | null, demo?: boolean): PlayerRow {
    const err = nameError(name);
    if (err) throw new GameError(err);
    if (this.getPlayerByUser(userId)) throw new GameError('You already have a garden', 409);
    if (this.db.prepare('SELECT 1 FROM players WHERE name = ?').get(name)) {
      throw new GameError('This name is taken', 409);
    }
    const now = this.d.now();
    const user = this.db.prepare('SELECT provider, subject FROM users WHERE id = ?').get(userId) as
      | { provider: string; subject: string }
      | undefined;
    if (!user) throw new GameError('Please sign in', 401);
    // Wallet players bring their own account; everyone else gets <name>.<suffix>, created by the game.
    const wallet = user.provider === 'near';
    if (name.startsWith('judge-') && user.provider !== 'judge') throw new GameError("Names starting with 'judge-' are reserved for Try as Judge");
    if (user.provider === 'google' && this.getPlayerByGoogle(user.subject)) {
      throw new GameError('This Google account is already linked to another garden', 409, { code: 'google_linked' });
    }
    let accountId = `${name}.${this.d.accountSuffix}`;
    let publicKey = '';
    let secretEnc = '';
    if (wallet) {
      accountId = user.subject;
      if (this.db.prepare('SELECT 1 FROM players WHERE account_id = ? OR wallet_account_id = ?').get(accountId, accountId)) {
        throw new GameError('This NEAR account already has a garden', 409);
      }
    } else {
      const keyPair = KeyPair.fromRandom('ed25519');
      publicKey = keyPair.getPublicKey().toString();
      secretEnc = encryptSecret(keyPair.toString(), this.d.masterKey);
    }

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
          `INSERT INTO players (user_id, name, account_id, public_key, secret_key_enc, account_status, custody, wallet_account_id, demo, created_ip, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          userId,
          name,
          accountId,
          publicKey,
          secretEnc,
          wallet ? 'ready' : 'pending',
          wallet ? 'wallet' : 'server',
          wallet ? accountId : null,
          (demo ?? this.d.demoModeDefault) ? 1 : 0,
          ip,
          now,
        );
      const id = Number(res.lastInsertRowid);
      // New gardens start the tutorial; judge gardens have the Judge tour instead.
      this.db.prepare('UPDATE players SET tutorial_step = ? WHERE id = ?').run(user.provider === 'judge' ? TUTORIAL_DONE : 0, id);
      if (!wallet) enqueue(this.db, id, { kind: 'create_account', name, publicKey }, now);

      if (fromIp < WELCOME_PACKS_PER_IP_PER_DAY) {
        this.addSeed(id, 'durian', 'rare', null, 'welcome');
        this.earn(id, accountId, 'welcome', WELCOME_PANEN, 'Welcome pack');
      }
      return id;
    });
    return this.getPlayer(playerId);
  }

  /**
   * Try as Judge: fills a new judge garden so every feature can be tried right away.
   * Three real Tree NFTs (ripe Rare Durian, nearly ripe Gold Rambutan, Mango sprout),
   * Rare / Gold seeds, 100 PANEN in total and Farmhand XP (third plot open). All chain
   * jobs queue after the account creation, so they land in order.
   */
  prefillJudgeGarden(playerId: number): void {
    tx(this.db, () => {
      const p = this.getPlayer(playerId);
      const now = this.d.now();
      const dayMs = this.dayMs(p);
      this.db.prepare('UPDATE players SET xp = MAX(xp, ?), first_tree_planted = 1 WHERE id = ?').run(JUDGE_XP, p.id);
      const trees: { plot: number; species: Species; quality: Quality; ripe: number }[] = [
        { plot: 0, species: 'durian', quality: 'rare', ripe: 1 },
        { plot: 1, species: 'rambutan', quality: 'gold', ripe: 0.8 },
        { plot: 2, species: 'mango', quality: 'common', ripe: 0.4 },
      ];
      for (const t of trees) {
        if (this.treeOnPlot(p.id, t.plot)) continue;
        const rules = SPECIES[t.species];
        const res = this.db
          .prepare(
            `INSERT INTO trees (player_id, plot, species, quality, parent_tree_id, planted_at, growth, target, last_tick,
               water_until, water_day, max_harvests, regrow_days, synced_stage)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'seed')`,
          )
          .run(p.id, t.plot, t.species, t.quality, now - dayMs * rules.growDays, rules.growDays * t.ripe, rules.growDays, now, now + dayMs * WATER_DAYS, this.today(p), rules.harvests, rules.regrowDays);
        const treeId = Number(res.lastInsertRowid);
        enqueue(this.db, p.id, { kind: 'mint_tree', treeId, accountId: p.account_id, species: t.species, quality: t.quality }, now);
      }
      // Seeds: the Rare Durian of the welcome pack (if given) plus these.
      const seeds: [Species, Quality | null][] = [
        ['durian', 'gold'],
        ['rambutan', 'rare'],
        ['rambutan', 'rare'],
        ['mango', null],
        ['mango', null],
      ];
      for (const [species, quality] of seeds) if (this.storageFree(p.id) > 0) this.addSeed(p.id, species, quality, null, 'judge');
      const top = JUDGE_PANEN - fromMicro(this.getPlayer(p.id).balance_micro);
      if (top > 0) this.earn(p.id, p.account_id, 'judge', top, 'Try as Judge starter PANEN');
    });
  }

  /** Whether the goal of a tutorial step is reached already. */
  private tutorialGoal(p: PlayerRow, step: TutorialStep): boolean {
    const one = (sql: string) => !!this.db.prepare(sql).get(p.id);
    switch (step) {
      case 'welcome':
        return false; // only the player's "Let's go" ends it
      case 'plant':
        return one('SELECT 1 FROM trees WHERE player_id = ?');
      case 'water':
        return one('SELECT 1 FROM trees WHERE player_id = ? AND water_day IS NOT NULL');
      case 'buy_fertilizer':
        return one("SELECT 1 FROM items WHERE player_id = ? AND item = 'fertilizer' AND qty > 0") || one('SELECT 1 FROM trees WHERE player_id = ? AND fert_until > 0');
      case 'fertilize':
        return one('SELECT 1 FROM trees WHERE player_id = ? AND fert_until > 0');
      case 'checkin':
        return p.checkin_day !== null;
      case 'harvest':
        return one('SELECT 1 FROM trees WHERE player_id = ? AND (harvest_count > 0 OR status = \'dead\')');
      case 'sell':
        return one('SELECT 1 FROM sales WHERE player_id = ?');
      case 'tanibot':
        return one('SELECT 1 FROM bots WHERE player_id = ?');
    }
  }

  /** The current tutorial step (moves past steps whose goal is reached); null when finished. */
  tutorial(playerId: number): { step: TutorialStep; index: number; total: number } | null {
    const p = this.getPlayer(playerId);
    let i = p.tutorial_step;
    while (i < TUTORIAL_STEPS.length && this.tutorialGoal(p, TUTORIAL_STEPS[i])) i++;
    if (i >= TUTORIAL_STEPS.length) i = TUTORIAL_DONE;
    if (i !== p.tutorial_step) this.db.prepare('UPDATE players SET tutorial_step = ? WHERE id = ?').run(i, p.id);
    return i === TUTORIAL_DONE ? null : { step: TUTORIAL_STEPS[i], index: i, total: TUTORIAL_STEPS.length };
  }

  /** "Let's go" on the welcome step, or skip the whole tutorial (also "Later" at the TaniBot step). */
  tutorialAction(playerId: number, action: unknown): void {
    const p = this.getPlayer(playerId);
    if (action === 'skip') {
      this.db.prepare('UPDATE players SET tutorial_step = ? WHERE id = ?').run(TUTORIAL_DONE, p.id);
      return;
    }
    if (action !== 'start') throw new GameError('Unknown tutorial action');
    if (p.tutorial_step === 0) this.db.prepare('UPDATE players SET tutorial_step = 1 WHERE id = ?').run(p.id);
  }

  /** Whether this garden was made by Try as Judge. */
  isJudge(playerId: number): boolean {
    return !!this.db.prepare("SELECT 1 FROM players p JOIN users u ON u.id = p.user_id WHERE p.id = ? AND u.provider = 'judge'").get(playerId);
  }

  /** Records a Judge tour step once (with the chain job of the action that did it). */
  judgeStep(playerId: number, step: JudgeStep): void {
    if (!JUDGE_STEPS.includes(step)) throw new GameError('Unknown tour step');
    const job = ['harvest', 'sell', 'shop'].includes(step)
      ? ((this.db.prepare('SELECT MAX(id) AS id FROM chain_jobs WHERE player_id = ?').get(playerId) as { id: number | null }).id ?? null)
      : null;
    this.db.prepare('INSERT OR IGNORE INTO judge_steps (player_id, step, job_id, created_at) VALUES (?, ?, ?, ?)').run(playerId, step, job, this.d.now());
  }

  /** The Judge tour (judge gardens only): which steps are done, with the transaction that proves each. */
  private judgeTour(playerId: number) {
    const rows = this.db
      .prepare(
        `SELECT s.step, j.status, j.tx_hash FROM judge_steps s LEFT JOIN chain_jobs j ON j.id = s.job_id WHERE s.player_id = ?`,
      )
      .all(playerId) as { step: string; status: string | null; tx_hash: string | null }[];
    const by = new Map(rows.map((r) => [r.step, r]));
    return JUDGE_STEPS.map((step) => {
      const r = by.get(step);
      return {
        step,
        done: !!r,
        txStatus: r?.status ?? null,
        txUrl: r?.tx_hash && !r.tx_hash.startsWith('fake') ? this.d.explorerTxUrl + r.tx_hash : null,
      };
    });
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

  private storageFree(playerId: number): number {
    return Math.max(0, SEED_STORAGE_SLOTS - this.seedCount(playerId));
  }

  /** Adds a seed; the caller must check there is a free slot (the storage limit is never broken). */
  private addSeed(playerId: number, species: Species, quality: Quality | null, parentTreeId: number | null, source: string): number {
    if (this.storageFree(playerId) < 1) throw new GameError('Your seed storage is full', 409, { code: 'storage_full' });
    const res = this.db
      .prepare('INSERT INTO seeds (player_id, species, quality, parent_tree_id, source, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(playerId, species, quality, parentTreeId, source, this.d.now());
    return Number(res.lastInsertRowid);
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
      // A free mango seed every day, so nobody is ever stuck. Seeds only go in while
      // there is a free slot (the Gold seed first); the rest is reported as skipped.
      const rewards = [`${panen} PANEN`];
      const skipped: string[] = [];
      const seeds: [Quality | null, string][] = calendarDay === 7 ? [['gold', '1 Gold Mango seed'], [null, '1 Mango seed']] : [[null, '1 Mango seed']];
      for (const [quality, label] of seeds) {
        if (this.storageFree(p.id) > 0) {
          this.addSeed(p.id, 'mango', quality, null, 'checkin');
          rewards.push(label);
        } else skipped.push(label);
      }
      return { streak, calendarDay, rewards, skipped };
    });
  }

  plant(playerId: number, plot: number, seedId: number) {
    return tx(this.db, () => this.plantNow(this.getPlayer(playerId), plot, seedId));
  }

  /** Plants inside the caller's transaction. */
  private plantNow(player: PlayerRow, plot: number, seedId: number) {
    {
      const p = player;
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
    }
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
      this.db.prepare('UPDATE trees SET fert_until = ?, fert_boost = 1 WHERE id = ?').run(now + FERTILIZER_DAYS * this.dayMs(p), t.id);
      return { fertilized: true, speed: 1 + FERTILIZER_BOOST, nextHarvestOdds: fruitOdds(t.quality, true) };
    });
  }

  /**
   * Harvests a ripe tree. An old tree drops its superior seed: into storage if there
   * is room; if storage is full the seed stays on the tree (409 storage_full) unless
   * the player chooses `then`: 'plant' (plant it right here) or 'sell' (to Mr. Darto).
   */
  harvest(playerId: number, plot: number, then?: 'plant' | 'sell') {
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
        const full = this.storageFree(p.id) < 1;
        if (full && !then) {
          throw new GameError('Your seed storage is full. The seed stays safe on the tree until you choose what to do.', 409, {
            code: 'storage_full',
            species: t.species,
            sellPrice: this.afterSeason(seedSellPrice(t.species, null)),
          });
        }
        if (then === 'sell') {
          this.killTree(p, t);
          const sale = this.payForSeeds(p, [{ species: t.species, quality: null }], `Sold the seed of an old ${t.species} tree to Mr. Darto`);
          return { kind: 'seed' as const, species: t.species, treeDied: true, sold: sale };
        }
        if (then === 'plant') {
          // Room is made by the tree itself: the seed goes straight into the freed plot.
          this.killTree(p, t);
          const seedId = Number(
            this.db
              .prepare('INSERT INTO seeds (player_id, species, quality, parent_tree_id, source, created_at) VALUES (?, ?, NULL, ?, ?, ?)')
              .run(p.id, t.species, t.id, 'tree', now).lastInsertRowid,
          );
          const planted = this.plantNow(p, plot, seedId);
          return { kind: 'seed' as const, species: t.species, treeDied: true, planted };
        }
        this.addSeed(p.id, t.species, null, t.id, 'tree');
        this.killTree(p, t);
        return { kind: 'seed' as const, species: t.species, treeDied: true };
      }

      const fertilized = t.fert_boost === 1;
      const fruitQuality = rollFruitQuality(t.quality, fertilized, this.d.random());
      const xp = rules.xpPerHarvest * (p.demo === 1 ? DEMO_XP_MULTIPLIER : 1);
      this.addFruit(p.id, t.species, fruitQuality, 1);
      const harvestCount = t.harvest_count + 1;
      this.db
        .prepare('UPDATE trees SET harvest_count = ?, growth = 0, target = regrow_days, last_tick = ?, fert_boost = 0 WHERE id = ?')
        .run(harvestCount, now, t.id);
      this.db.prepare('UPDATE players SET xp = xp + ? WHERE id = ?').run(xp, p.id);
      enqueueTreeUpdate(this.db, p.id, t.id, now);
      const titleBefore = titleFor(p.xp);
      const titleAfter = titleFor(p.xp + xp);
      return {
        kind: 'fruit' as const,
        species: t.species,
        quality: fruitQuality,
        qty: 1,
        xp,
        harvestCount,
        fertilized,
        firstHarvest: p.xp === 0,
        titleUp: titleAfter !== titleBefore ? titleAfter : null,
      };
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

  /** PANEN actually paid for a Mr. Darto sale of `basePanen` under the current Season. */
  afterSeason(basePanen: number): number {
    return fromMicro(Math.floor(toMicro(basePanen) / this.seasonDivisor));
  }

  /** Current Season of $PANEN: harvest-sale rewards are divided by `divisor` (1, 2, 4, 8). */
  seasonInfo() {
    const divisor = this.seasonDivisor;
    return { number: Math.round(Math.log2(divisor)) + 1, divisor, rewardPercent: 100 / divisor };
  }

  private ownedSeeds(p: PlayerRow, seedIds: unknown) {
    if (!Array.isArray(seedIds) || seedIds.length < 1 || seedIds.length > SEED_STORAGE_SLOTS * 2 || !seedIds.every(Number.isInteger)) {
      throw new GameError('Choose at least one seed');
    }
    const ids = [...new Set(seedIds as number[])];
    const rows = this.db
      .prepare(`SELECT id, species, quality FROM seeds WHERE player_id = ? AND id IN (${ids.map(() => '?').join(',')})`)
      .all(p.id, ...ids) as unknown as { id: number; species: Species; quality: Quality | null }[];
    if (rows.length !== ids.length) throw new GameError('Seed not found');
    return rows;
  }

  /** Pays for seeds sold to Mr. Darto (mint_reward, so the Season rule applies). */
  private payForSeeds(p: PlayerRow, seeds: { species: Species; quality: Quality | null }[], note: string) {
    const basePanen = seeds.reduce((sum, s) => sum + seedSellPrice(s.species, s.quality), 0);
    const baseMicro = toMicro(basePanen);
    const expectedMicro = Math.floor(baseMicro / this.seasonDivisor);
    const now = this.d.now();
    const ledgerId = this.ledger(p.id, 'sell_seed', expectedMicro, note);
    const jobId = enqueue(this.db, p.id, { kind: 'mint_reward', accountId: p.account_id, baseMicro, memo: note, ledgerId }, now);
    this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(jobId, ledgerId);
    this.db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?').run(expectedMicro, p.id);
    return { basePanen, expectedPanen: fromMicro(expectedMicro), seasonDivisor: this.seasonDivisor };
  }

  /** Sells seeds to Mr. Darto at the small fixed seed price. */
  sellSeeds(playerId: number, seedIds: unknown) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      this.assertAccountOk(p);
      const rows = this.ownedSeeds(p, seedIds);
      for (const r of rows) this.db.prepare('DELETE FROM seeds WHERE id = ?').run(r.id);
      const sale = this.payForSeeds(p, rows, `Sold ${rows.length} seed${rows.length > 1 ? 's' : ''} to Mr. Darto`);
      return { sold: rows.length, ...sale };
    });
  }

  /** Throws seeds away (no reward) to free storage slots. */
  discardSeeds(playerId: number, seedIds: unknown) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      const rows = this.ownedSeeds(p, seedIds);
      for (const r of rows) this.db.prepare('DELETE FROM seeds WHERE id = ?').run(r.id);
      return { discarded: rows.length };
    });
  }

  /**
   * TaniBot buys from the Shop with ITS OWN budget (not the player's balance).
   * The bot's key burns the PANEN on chain; the contract enforces the daily limit,
   * and the local mirror (budget, spent today) is checked first so we never queue
   * a burn that would fail. The item goes to the player's storage.
   */
  botBuy(playerId: number, item: ShopItem, qty: number, limitDay: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      const entry = SHOP_ITEMS[item];
      if (!entry) throw new GameError('Unknown item');
      const bot = this.db.prepare('SELECT * FROM bots WHERE player_id = ?').get(p.id) as
        | { account_id: string; status: string; budget_micro: number; daily_limit_micro: number; spent_day: number | null; spent_micro: number }
        | undefined;
      if (!bot || bot.status !== 'ready') throw new GameError('TaniBot is not ready');
      const costMicro = toMicro(entry.price * qty);
      const spent = bot.spent_day === limitDay ? bot.spent_micro : 0;
      if (bot.budget_micro < costMicro) throw new GameError('TaniBot budget is empty', 409, { code: 'bot_budget_empty' });
      if (spent + costMicro > bot.daily_limit_micro) throw new GameError('TaniBot daily limit reached', 409, { code: 'bot_limit_reached' });
      const isSeed = item.startsWith('seed_');
      if (isSeed && this.seedCount(p.id) + qty > SEED_STORAGE_SLOTS) throw new GameError('Your seed storage is full');
      const seedIds: number[] = [];
      if (isSeed) {
        const species = item.slice('seed_'.length) as Species;
        for (let i = 0; i < qty; i++) seedIds.push(this.addSeed(p.id, species, null, null, 'tanibot'));
      } else {
        this.addItem(p.id, item, qty);
      }
      this.db
        .prepare('UPDATE bots SET budget_micro = budget_micro - ?, spent_day = ?, spent_micro = ? WHERE player_id = ?')
        .run(costMicro, limitDay, spent + costMicro, p.id);
      const memo = `TaniBot Shop: ${qty} x ${entry.name}`;
      const jobId = enqueue(this.db, p.id, { kind: 'bot_burn', botId: bot.account_id, amountMicro: costMicro, memo, grant: { item, qty, seedIds } }, this.d.now());
      return { jobId, costPanen: entry.price * qty, name: entry.name };
    });
  }

  /**
   * TaniBot at a glance for the garden (no need to open its window): active or
   * not, ON/OFF, a warning when it can no longer buy (budget or daily limit),
   * and its latest action for the speech bubble.
   */
  private tanibotStatus(playerId: number) {
    const b = this.db
      .prepare('SELECT status, enabled, budget_micro, daily_limit_micro, spent_day, spent_micro FROM bots WHERE player_id = ?')
      .get(playerId) as { status: string; enabled: number; budget_micro: number; daily_limit_micro: number; spent_day: number | null; spent_micro: number } | undefined;
    if (!b) return null;
    const price = toMicro(SHOP_ITEMS.fertilizer.price);
    const spent = b.spent_day === dayIndex(this.d.now(), false) ? b.spent_micro : 0;
    const last = this.db
      .prepare("SELECT id, short, created_at FROM bot_log WHERE player_id = ? AND short IS NOT NULL ORDER BY id DESC LIMIT 1")
      .get(playerId) as { id: number; short: string; created_at: number } | undefined;
    return {
      status: b.status as 'creating' | 'linking' | 'ready' | 'failed',
      enabled: b.enabled === 1,
      /** 'low': budget below a fertilizer, 'limit': today's spending limit reached. */
      alert: b.budget_micro < price ? ('low' as const) : b.daily_limit_micro - spent < price ? ('limit' as const) : null,
      last: last ? { id: last.id, text: last.short, at: last.created_at } : null,
    };
  }

  /** Items in storage (TaniBot checks fertilizer). */
  itemCount(playerId: number, item: string): number {
    return this.itemQty(playerId, item);
  }

  /** Checks a Shop purchase and returns its price and memo (also used to prepare wallet burns). */
  shopQuote(playerId: number, item: ShopItem, qty: number) {
    const p = this.getPlayer(playerId);
    this.assertAccountOk(p);
    const entry = SHOP_ITEMS[item];
    if (!entry) throw new GameError('Unknown item');
    if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw new GameError('Quantity must be 1-20');
    const costMicro = toMicro(entry.price * qty);
    if (p.balance_micro < costMicro) throw new GameError('Not enough PANEN');
    const isSeed = item.startsWith('seed_');
    if (isSeed && this.seedCount(p.id) + qty > SEED_STORAGE_SLOTS) throw new GameError('Your seed storage is full');
    return { p, entry, costMicro, isSeed, memo: `Shop: ${qty} x ${entry.name}` };
  }

  /**
   * Shop purchase; the spent PANEN is burned on chain. Google players: the server
   * signs the burn with their stored key. Wallet players: `signed` is the burn their
   * browser signed with the game key; it must match this exact purchase.
   */
  buy(playerId: number, item: ShopItem, qty = 1, signed?: SignedBurn) {
    return tx(this.db, () => {
      const { p, entry, costMicro, isSeed, memo } = this.shopQuote(playerId, item, qty);
      const now = this.d.now();
      let wallet: { nonce: bigint; signed: SignedBurn } | null = null;
      if (p.custody === 'wallet') {
        if (!signed) throw new GameError('Please confirm the purchase with your game key', 400, { code: 'signature_required' });
        let nonce: bigint;
        try {
          nonce = BigInt(signed.nonce);
          BigInt(signed.maxBlockHeight);
        } catch {
          throw new GameError('Invalid signed burn');
        }
        if (nonce <= BigInt(p.key_nonce)) throw new GameError('This purchase was already signed, please try again', 409, { code: 'nonce_used' });
        const hash = burnDelegateHash({
          accountId: p.account_id,
          publicKey: signed.publicKey,
          nonce,
          maxBlockHeight: BigInt(signed.maxBlockHeight),
          amount: BigInt(costMicro) * UNITS_PER_MICRO,
          memo,
          panenContractId: this.d.panenContractId ?? 'panen.nearvest.testnet',
        });
        if (!verifySignature(signed.publicKey, hash, signed.signature)) {
          throw new GameError('The signed burn does not match this purchase', 400, { code: 'bad_signature' });
        }
        wallet = { nonce, signed };
      }

      const ledgerId = this.ledger(p.id, 'shop', -costMicro, memo);
      this.db.prepare('UPDATE players SET balance_micro = balance_micro - ? WHERE id = ?').run(costMicro, p.id);
      const seedIds: number[] = [];
      if (isSeed) {
        const species = item.slice('seed_'.length) as Species;
        for (let i = 0; i < qty; i++) seedIds.push(this.addSeed(p.id, species, null, null, 'shop'));
      } else {
        this.addItem(p.id, item, qty);
      }
      const jobId = wallet
        ? enqueue(
            this.db,
            p.id,
            {
              kind: 'burn_wallet',
              accountId: p.account_id,
              publicKey: wallet.signed.publicKey,
              nonce: wallet.nonce.toString(),
              maxBlockHeight: wallet.signed.maxBlockHeight,
              amountMicro: costMicro,
              memo,
              signature: wallet.signed.signature,
              ledgerId,
              grant: { item, qty, seedIds },
            },
            now,
          )
        : enqueue(this.db, p.id, { kind: 'burn', accountId: p.account_id, amountMicro: costMicro, memo, ledgerId }, now);
      this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(jobId, ledgerId);
      if (wallet) this.db.prepare('UPDATE players SET key_nonce = ? WHERE id = ?').run(Number(wallet.nonce), p.id);
      return { bought: item, qty, burnedPanen: entry.price * qty };
    });
  }

  /**
   * Wallet players own their tokens and can move them outside the game, so the
   * chain is the source of truth: balance = chain balance + effect of jobs not sent yet.
   */
  syncWalletBalance(playerId: number, chainUnits: bigint): void {
    tx(this.db, () => {
      const p = this.getPlayer(playerId);
      if (p.custody !== 'wallet') return;
      const pending = this.db
        .prepare(
          `SELECT COALESCE(SUM(l.amount_micro), 0) AS n FROM ledger l JOIN chain_jobs j ON j.id = l.job_id
           WHERE l.player_id = ? AND j.status = 'pending'`,
        )
        .get(p.id) as { n: number };
      const expected = Number(chainUnits / UNITS_PER_MICRO) + pending.n;
      if (expected !== p.balance_micro) {
        this.db.prepare('UPDATE players SET balance_micro = ? WHERE id = ?').run(Math.max(0, expected), p.id);
      }
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
          fertMsLeft: Math.max(0, t.fert_until - now),
          fertSpeed: t.fert_until > now ? 1 + FERTILIZER_BOOST : 1,
          nextHarvestOdds: fruitOdds(t.quality, t.fert_boost === 1),
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

    const signIn = (this.db.prepare('SELECT provider FROM users WHERE id = ?').get(p.user_id) as { provider: string } | undefined)?.provider ?? 'dev';
    return {
      player: {
        name: p.name,
        accountId: p.account_id,
        accountStatus: p.account_status,
        custody: p.custody,
        walletAccountId: p.wallet_account_id,
        /** How the garden's owner signs in: 'google', 'near' (wallet garden) or 'dev'. */
        googleLinked: p.google_sub !== null,
        avatar: p.avatar,
        tanibot: this.tanibotStatus(p.id),
        signIn,
        demo,
        balance: fromMicro(p.balance_micro),
        xp: p.xp,
        title: titleFor(p.xp),
        nextTitle,
        xpMultiplier: demo ? DEMO_XP_MULTIPLIER : 1,
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
      season: this.seasonInfo(),
      activity: this.activity(p.id),
      /** New gardens: the current tutorial step (null when finished or skipped). */
      tutorial: this.tutorial(p.id),
      /** Try as Judge gardens only: the 5-step tour. */
      judgeTour: signIn === 'judge' ? this.judgeTour(p.id) : null,
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

