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
import { arenaNewsAt, arenaState } from './arena.ts';
import { arenaMatchState } from './arena-match.ts';
import { createReferral, paidToday, pendingReferralOf, recordDevice, referralRows } from './referral.ts';
import {
  ARENA_PRIZE,
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
  thirstOf,
  TITLES,
  titleFor,
  REF_PAID_PER_DAY_PER_REFERRER,
  REF_REWARD_FRIEND,
  REF_REWARD_REFERRER,
  STICKERS,
  STICKERS_SHOWN,
  VISITORS_SHOWN,
  FRIEND_ADDS_SHOWN,
  FRIENDS_ADDS_PER_DAY,
  FRIENDS_MAX,
  isOnline,
  ONLINE_MS,
  PING_MS,
  PING_LIVE_MS,
  WATER_DAYS,
  WELCOME_PACKS_PER_IP_PER_DAY,
  WELCOME_PANEN,
  type Quality,
  type ShopItem,
  type Species,
  type Stage,
  type TreeGrowth,
} from './rules.ts';
import {
  cleanedOf,
  DROUGHT_WATER_DAYS,
  DROUGHT_WATERINGS,
  eruptionAt,
  skyView,
  villageWeather,
  VOLCANIC_GOLD_BONUS,
  type SkyView,
  type WeatherSchedule,
} from './weather.ts';

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
  /** Village weather and events (default: the real schedule; tests may pass clearSky). */
  weather?: WeatherSchedule;
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
  /** Last time in the game (at most every 10 minutes; the farmer list). */
  last_seen_at?: number | null;
  /** Last sign of life from a visible game tab (POST /api/ping; the Online dot). 0 = never. */
  active_at?: number;
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
  dry_from: number;
  ash_clean_at: number;
  wilt_at: number;
  water_count: number;
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

/**
 * Longest name for a NEW garden (2026-11-10). Older gardens with longer names (up to the
 * contract's 32) keep working; judge gardens (`judge-xxxx`) are always shorter.
 */
export const NEW_NAME_MAX = 16;

/** Extra rule for new gardens on top of `nameError`. Returns an error message or null. */
export function newNameError(name: string): string | null {
  if (name.length > NEW_NAME_MAX) return `Name must be 2-${NEW_NAME_MAX} characters (yours has ${name.length})`;
  return nameError(name);
}

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

/** A Memorial Tree as the web game shows it. */
export interface MemorialView {
  id: number;
  tokenId: string | null;
  species: Species;
  quality: Quality;
  harvestCount: number;
  maxHarvests: number;
  plantedAt: number;
  diedAt: number | null;
  /** The plot it still stands on (until a new seed is planted there), or null. */
  plot: number | null;
}

function memorialView(t: TreeRow & { died_at?: number | null }): MemorialView {
  return {
    id: t.id,
    tokenId: t.token_id,
    species: t.species,
    quality: t.quality,
    harvestCount: t.harvest_count,
    maxHarvests: t.max_harvests,
    plantedAt: t.planted_at,
    diedAt: t.died_at ?? null,
    plot: t.plot,
  };
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
    dryFromMs: t.dry_from || t.planted_at,
    ashCleanMs: t.ash_clean_at,
    wiltedAtMs: t.wilt_at,
  };
}

export class Game {
  private d: GameDeps;
  /** Current Season divisor (1, 2, 4, 8), refreshed from the chain. */
  seasonDivisor = 1;
  /** The online Arena duel (ARENA_ONLINE in .env, default off; set by main.ts). Off = Arena v2 only. */
  arenaOnline = false;

  constructor(deps: GameDeps) {
    this.d = deps;
    const weather = deps.weather ?? villageWeather;
    this.weather = weather;
    this.skies = { normal: skyView(weather, false), demo: skyView(weather, true) };
  }

  readonly weather: WeatherSchedule;
  private readonly skies: { normal: SkyView; demo: SkyView };

  /** The village sky of a player's mode (normal or demo). */
  sky(demo: boolean): SkyView {
    return demo ? this.skies.demo : this.skies.normal;
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
   * account; the name is only their farmer name. `opts.ref` = the inviter's garden name from an
   * invite link (referral.ts), `opts.deviceId` = the browser's random id.
   */
  createPlayer(userId: number, name: string, ip: string | null, demo?: boolean, opts: { ref?: unknown; deviceId?: unknown } = {}): PlayerRow {
    const err = newNameError(name);
    if (err) throw new GameError(err, 400, name.length > NEW_NAME_MAX ? { code: 'name_too_long', max: NEW_NAME_MAX } : undefined);
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
      recordDevice(this.db, id, opts.deviceId, now);
      createReferral(this.db, { friendId: id, friendUser: user, ref: opts.ref, deviceId: opts.deviceId, ip, now });
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
               water_until, water_day, water_count, max_harvests, regrow_days, synced_stage, dry_from)
             VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'seed', ?)`,
          )
          .run(p.id, t.plot, t.species, t.quality, now - dayMs * rules.growDays, rules.growDays * t.ripe, rules.growDays, now, now + dayMs * WATER_DAYS, this.today(p), rules.harvests, rules.regrowDays, now);
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
  private earn(playerId: number, accountId: string, kind: string, panen: number, note: string): number {
    const now = this.d.now();
    const micro = toMicro(panen);
    const ledgerId = this.ledger(playerId, kind, micro, note);
    const jobId = enqueue(this.db, playerId, { kind: 'mint', accountId, amountMicro: micro, memo: note, ledgerId }, now);
    this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(jobId, ledgerId);
    this.db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?').run(micro, playerId);
    return jobId;
  }

  /** Earned reward (mint_reward): the contract divides `panen` by the Season divisor. */
  earnReward(p: PlayerRow, kind: string, panen: number, note: string): { jobId: number; expectedPanen: number } {
    const baseMicro = toMicro(panen);
    const expectedMicro = Math.floor(baseMicro / this.seasonDivisor);
    const ledgerId = this.ledger(p.id, kind, expectedMicro, note);
    const jobId = enqueue(this.db, p.id, { kind: 'mint_reward', accountId: p.account_id, baseMicro, memo: note, ledgerId }, this.d.now());
    this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(jobId, ledgerId);
    this.db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?').run(expectedMicro, p.id);
    return { jobId, expectedPanen: fromMicro(expectedMicro) };
  }

  /**
   * Referral (referral.ts): after the friend's first harvest, pays the inviter (mint_reward, Season
   * rule) and the friend (exact mint). An inviter already paid for 10 referrals today waits: the
   * referral stays pending and is paid at a later harvest. Runs inside the harvest transaction.
   */
  private payReferral(friend: PlayerRow): { referrer: string; friendPanen: number; referrerPanen: number } | null {
    const r = pendingReferralOf(this.db, friend.id);
    if (!r) return null;
    const now = this.d.now();
    if (paidToday(this.db, r.referrer_id, now) >= REF_PAID_PER_DAY_PER_REFERRER) return null;
    const referrer = this.getPlayer(r.referrer_id);
    const paid = this.earnReward(referrer, 'referral', REF_REWARD_REFERRER, `Referral reward: ${friend.name} made their first harvest`);
    const friendJob = this.earn(friend.id, friend.account_id, 'referral', REF_REWARD_FRIEND, `Referral bonus: invited by ${referrer.name}`);
    this.db
      .prepare("UPDATE referrals SET status = 'paid', paid_at = ?, referrer_job_id = ?, friend_job_id = ? WHERE id = ?")
      .run(now, paid.jobId, friendJob, r.id);
    return { referrer: referrer.name, friendPanen: REF_REWARD_FRIEND, referrerPanen: paid.expectedPanen };
  }

  /** The referral box: invite rewards, friends invited (pending / paid) and who invited this garden. */
  referralView(p: PlayerRow, judge: boolean) {
    const rows = referralRows(this.db, p.id);
    const txUrl = (h: string | null) => (h && !h.startsWith('fake') ? this.d.explorerTxUrl + h : null);
    return {
      /** Judge gardens cannot invite (they are throwaway gardens). */
      canInvite: !judge,
      rewards: { referrer: REF_REWARD_REFERRER, referrerNow: this.afterSeason(REF_REWARD_REFERRER), friend: REF_REWARD_FRIEND },
      invited: rows.invited.map((r) => ({ id: r.id, name: r.name, status: r.status, at: r.at, paidAt: r.paidAt, txUrl: txUrl(r.tx) })),
      invitedBy: rows.invitedBy && { id: rows.invitedBy.id, name: rows.invitedBy.name, status: rows.invitedBy.status, paidAt: rows.invitedBy.paidAt, txUrl: txUrl(rows.invitedBy.tx) },
    };
  }

  /** Stickers visitors left in this garden (newest first). */
  stickersReceived(ownerId: number) {
    const text = new Map<string, string>(STICKERS.map((s) => [s.id, s.text]));
    return (
      this.db
        .prepare('SELECT s.id, s.sticker, s.created_at AS at, f.name AS "from" FROM stickers s JOIN players f ON f.id = s.from_id WHERE s.to_id = ? ORDER BY s.id DESC LIMIT ?')
        .all(ownerId, STICKERS_SHOWN) as unknown as { id: number; sticker: string; at: number; from: string }[]
    ).map((r) => ({ ...r, text: text.get(r.sticker) ?? r.sticker }));
  }

  /**
   * Village tab "Visitors": one row per visitor per village day (newest activity first, last 10):
   * who visited, the stickers they left that day (up to 3, on the same row), the tree they watered
   * and the owner's wave back. `canWave`: the owner has not waved back to this visitor today.
   */
  visitorsReceived(ownerId: number) {
    const day = dayIndex(this.d.now(), false);
    const text = new Map<string, string>(STICKERS.map((s) => [s.id, s.text]));
    const rows = this.db
      .prepare(
        `SELECT v.id, v.visit_day AS day, v.created_at AS firstAt, v.last_at AS at, v.wave_sticker AS wave, v.visitor_id AS visitorId,
           f.name AS "from", f.avatar,
           (SELECT group_concat(s.sticker, ',') FROM (SELECT sticker FROM stickers s WHERE s.from_id = v.visitor_id AND s.to_id = v.owner_id AND s.sticker_day = v.visit_day ORDER BY s.id) s) AS stickers,
           (SELECT t.species FROM garden_help h JOIN trees t ON t.id = h.tree_id WHERE h.helper_id = v.visitor_id AND h.owner_id = v.owner_id AND h.help_day = v.visit_day) AS watered,
           EXISTS (SELECT 1 FROM visits w WHERE w.owner_id = v.owner_id AND w.visitor_id = v.visitor_id AND w.wave_day = ?) AS wavedToday
         FROM visits v JOIN players f ON f.id = v.visitor_id
         WHERE v.owner_id = ? ORDER BY v.last_at DESC, v.id DESC LIMIT ?`,
      )
      .all(day, ownerId, VISITORS_SHOWN) as unknown as {
      id: number;
      day: number;
      firstAt: number;
      at: number;
      wave: string | null;
      visitorId: number;
      from: string;
      avatar: string;
      stickers: string | null;
      watered: Species | null;
      wavedToday: number;
    }[];
    return rows.map((r) => ({
      id: r.id,
      from: r.from,
      avatar: r.avatar,
      at: r.at,
      today: r.day === day,
      stickers: (r.stickers ? r.stickers.split(',') : []).map((id) => ({ id, text: text.get(id) ?? id })),
      watered: r.watered,
      wave: r.wave ? { id: r.wave, text: text.get(r.wave) ?? r.wave } : null,
      canWave: !r.wave && !r.wavedToday,
    }));
  }

  /**
   * Red dot on the Village tab: the time of the newest social event for this garden (a new visitor
   * row, a sticker, a friend's watering, a wave back, a paid referral) and the newest one the owner
   * has seen (`village_seen_at`, stored on the server so every device agrees). `waveAt` = the newest
   * wave back (also a dot on the Friends pin).
   */
  villageNews(playerId: number) {
    const at = (sql: string, ...args: number[]) => (this.db.prepare(sql).get(...args) as { at: number | null }).at ?? 0;
    const visitAt = at('SELECT max(created_at) AS at FROM visits WHERE owner_id = ?', playerId);
    const stickerAt = at('SELECT max(created_at) AS at FROM stickers WHERE to_id = ?', playerId);
    const helpAt = at('SELECT max(created_at) AS at FROM garden_help WHERE owner_id = ?', playerId);
    const waveAt = at('SELECT max(wave_at) AS at FROM visits WHERE visitor_id = ? AND wave_sticker IS NOT NULL', playerId);
    const paidAt = at("SELECT max(paid_at) AS at FROM referrals WHERE (referrer_id = ? OR friend_id = ?) AND status = 'paid'", playerId, playerId);
    const seen = this.db.prepare('SELECT village_seen_at AS at FROM players WHERE id = ?').get(playerId) as { at: number };
    const duelAt = arenaNewsAt(this.db, playerId);
    // Add friend (2026-11-11): the first add of a pair notifies (only while that friendship stands).
    const friendAt = at(
      'SELECT max(a.created_at) AS at FROM friend_adds a JOIN friends f ON f.player_id = a.player_id AND f.friend_id = a.friend_id WHERE a.friend_id = ? AND a.notify = 1',
      playerId,
    );
    return { latestAt: Math.max(visitAt, stickerAt, helpAt, waveAt, paidAt, duelAt, friendAt), waveAt, seenAt: seen.at };
  }

  /** The owner saw the Visitors / Invite boxes up to `upTo` (the newest event their screen showed). */
  villageSeen(playerId: number, upTo: unknown): void {
    const t = Math.min(Number(upTo) || 0, this.d.now());
    if (t > 0) this.db.prepare('UPDATE players SET village_seen_at = ? WHERE id = ? AND village_seen_at < ?').run(t, playerId, t);
  }

  /**
   * Red dot on the Market tab: when fruit was last added (`fruitAt`, a harvest by the player or
   * TaniBot) and the newest one the owner has seen by opening the Market (`seenAt`; on the server,
   * so every device agrees).
   */
  marketNews(playerId: number) {
    const r = this.db.prepare('SELECT fruit_at AS fruitAt, market_seen_at AS seenAt FROM players WHERE id = ?').get(playerId) as {
      fruitAt: number;
      seenAt: number;
    };
    return { fruitAt: r.fruitAt, seenAt: r.seenAt };
  }

  /** The owner opened the Market and saw the fruit added up to `upTo`. */
  marketSeen(playerId: number, upTo: unknown): void {
    const t = Math.min(Number(upTo) || 0, this.d.now());
    if (t > 0) this.db.prepare('UPDATE players SET market_seen_at = ? WHERE id = ? AND market_seen_at < ?').run(t, playerId, t);
  }

  /**
   * "<name> added you as a friend" (Village tab + notice; newest first, last 10): only the first
   * add of a pair notifies, and only while that garden still has you as a friend. `mutual` = you
   * added them too (no "Add back"); `online` = their game tab is open now. Public data only.
   */
  friendAddsReceived(playerId: number) {
    const now = this.d.now();
    return (
      this.db
        .prepare(
          `SELECT a.id, a.created_at AS at, p.name AS "from", p.avatar, p.xp, p.active_at,
             EXISTS (SELECT 1 FROM friends m WHERE m.player_id = a.friend_id AND m.friend_id = a.player_id) AS mutual
           FROM friend_adds a JOIN friends f ON f.player_id = a.player_id AND f.friend_id = a.friend_id
             JOIN players p ON p.id = a.player_id
           WHERE a.friend_id = ? AND a.notify = 1 ORDER BY a.created_at DESC, a.id DESC LIMIT ?`,
        )
        .all(playerId, FRIEND_ADDS_SHOWN) as unknown as { id: number; at: number; from: string; avatar: string; xp: number; active_at: number; mutual: number }[]
    ).map((r) => ({ id: r.id, from: r.from, avatar: r.avatar, title: titleFor(r.xp), at: r.at, mutual: r.mutual === 1, online: isOnline(r.active_at, now) }));
  }

  /** Add friend on this server: how many friends, adds left today, the limits (the web shows Add friend only when present). */
  friendSummary(playerId: number) {
    const day = dayIndex(this.d.now(), false);
    const count = (this.db.prepare('SELECT count(*) AS n FROM friends WHERE player_id = ?').get(playerId) as { n: number }).n;
    const adds = (this.db.prepare('SELECT count(*) AS n FROM friend_adds WHERE player_id = ? AND add_day = ?').get(playerId, day) as { n: number }).n;
    return { count, max: FRIENDS_MAX, addsLeft: Math.max(0, FRIENDS_ADDS_PER_DAY - adds), addsPerDay: FRIENDS_ADDS_PER_DAY, onlineMs: ONLINE_MS, pingMs: this.arenaOnline ? PING_LIVE_MS : PING_MS };
  }

  /** Waves back the visitor got from gardens they visited (newest first, last 10). */
  wavesReceived(visitorId: number) {
    const text = new Map<string, string>(STICKERS.map((s) => [s.id, s.text]));
    return (
      this.db
        .prepare(
          `SELECT v.id, v.wave_sticker AS sticker, v.wave_at AS at, o.name AS "from", o.avatar
           FROM visits v JOIN players o ON o.id = v.owner_id
           WHERE v.visitor_id = ? AND v.wave_sticker IS NOT NULL ORDER BY v.wave_at DESC, v.id DESC LIMIT ?`,
        )
        .all(visitorId, VISITORS_SHOWN) as unknown as { id: number; sticker: string; at: number; from: string; avatar: string }[]
    ).map((r) => ({ ...r, text: text.get(r.sticker) ?? r.sticker }));
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
    // New fruit (not a sale): red dot on the Market tab until the owner opens it.
    if (qty > 0) this.db.prepare('UPDATE players SET fruit_at = ? WHERE id = ?').run(this.d.now(), playerId);
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
    return this.saveGrowth(t, advance(growthOf(t), this.d.now(), this.dayMs(p), this.sky(p.demo === 1)));
  }

  private saveGrowth(t: TreeRow, g: TreeGrowth): TreeRow {
    const dry = g.dryFromMs ?? t.dry_from;
    const wilt = g.wiltedAtMs ?? t.wilt_at;
    this.db.prepare('UPDATE trees SET growth = ?, last_tick = ?, dry_from = ?, wilt_at = ? WHERE id = ?').run(g.growth, g.lastTickMs, dry, wilt, t.id);
    return { ...t, growth: g.growth, last_tick: g.lastTickMs, dry_from: dry, wilt_at: wilt };
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
    const g = advance(growthOf(t), this.d.now(), dayMs, this.sky(t.demo === 1));
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
      // Saved as it goes, so the next run (and every view) only has to look at the time since.
      const g = advance(growthOf(t), this.d.now(), dayLengthMs(t.demo === 1), this.sky(t.demo === 1));
      this.saveGrowth(t, g);
      const stage = stageOf(g);
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
      // A Memorial Tree standing here moves to the player's Memorial list (its NFT stays).
      this.moveMemorialOff(p.id, plot);
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
             max_harvests, regrow_days, synced_stage, dry_from)
           VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'seed', ?)`,
        )
        .run(p.id, plot, seed.species, quality, seed.parent_tree_id, now, target, now, rules.harvests, rules.regrowDays, now);
      const treeId = Number(res.lastInsertRowid);
      this.db.prepare('UPDATE players SET first_tree_planted = 1 WHERE id = ?').run(p.id);
      enqueue(this.db, p.id, { kind: 'mint_tree', treeId, accountId: p.account_id, species: seed.species, quality }, now);
      return { treeId, species: seed.species, quality };
    }
  }

  water(playerId: number, plot: number) {
    return tx(this.db, () => {
      const { treeId: _treeId, species: _species, ...result } = this.waterTree(this.getPlayer(playerId), plot);
      return result;
    });
  }

  /**
   * Waters a tree of `p` with the weather rules (call inside a transaction). `helping`: a friend
   * waters it (social.ts), allowed only when the tree needs water now (`needsWater`).
   */
  waterTree(p: PlayerRow, plot: number, opts: { helping?: boolean } = {}) {
    const t = this.tickedTree(p, plot);
    const today = this.today(p);
    const now = this.d.now();
    const kind = this.sky(p.demo === 1).kind(today);
    if (kind === 'rain')
      throw new GameError(opts.helping ? "It's raining in Tandur: every tree is watered for free today." : "It's raining: your trees are watered for free today.", 409, { code: 'rain' });
    if (opts.helping && !this.needsWater(p, t, now))
      throw new GameError('This tree has enough water right now. Help a thirsty one!', 409, { code: 'not_thirsty' });
    const count = t.water_day === today ? t.water_count : 0;
    const done = { treeId: t.id, species: t.species };
    if (kind === 'drought') {
      // A drought: each watering lasts half a day, so a tree is watered twice.
      if (count >= DROUGHT_WATERINGS) throw new GameError('This tree was already watered twice today');
      const until = Math.max(now, t.water_until) + DROUGHT_WATER_DAYS * this.dayMs(p);
      this.db.prepare('UPDATE trees SET water_until = ?, water_day = ?, water_count = ? WHERE id = ?').run(until, today, count + 1, t.id);
      return { watered: true, weather: kind, waterings: count + 1, needed: DROUGHT_WATERINGS, ...done };
    }
    if (count >= 1) throw new GameError('This tree was already watered today');
    this.db.prepare('UPDATE trees SET water_until = ?, water_day = ?, water_count = 1 WHERE id = ?').run(now + WATER_DAYS * this.dayMs(p), today, t.id);
    return { watered: true, weather: kind, waterings: 1, needed: 1, ...done };
  }

  /**
   * A friend may help water this tree now: its water has run out, it is not watered enough for
   * today (a drought needs two), it is not raining, and it still grows (not an old tree).
   */
  private needsWater(p: PlayerRow, t: TreeRow, now: number): boolean {
    if (t.harvest_count >= t.max_harvests) return false;
    const today = this.today(p);
    const kind = this.sky(p.demo === 1).kind(today);
    if (kind === 'rain') return false;
    const count = t.water_day === today ? t.water_count : 0;
    return count < (kind === 'drought' ? DROUGHT_WATERINGS : 1) && t.water_until <= now;
  }

  getPlayerByName(name: string): PlayerRow | null {
    return (this.db.prepare('SELECT * FROM players WHERE name = ?').get(name) as unknown as PlayerRow | undefined) ?? null;
  }

  /** Remembers when the player was last in the game (the farmer list shows active gardens); at most every 10 minutes. */
  touch(playerId: number, deviceId?: unknown): void {
    const now = this.d.now();
    recordDevice(this.db, playerId, deviceId, now);
    this.db.prepare('UPDATE players SET last_seen_at = ? WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < ?)').run(now, playerId, now - 10 * 60_000);
  }

  /** How many trees of a garden need water now (the farmer list's water drop). */
  thirstyTrees(p: PlayerRow): number {
    const now = this.d.now();
    let n = 0;
    for (let plot = 0; plot < 3; plot++) {
      const t = this.treeOnPlot(p.id, plot);
      if (t && this.needsWater(p, t, now)) n++;
    }
    return n;
  }

  /**
   * A garden as visitors see it (read only): name, title, avatar and the trees on its plots. No
   * balance, seeds, fruit, items, TaniBot budget, sign-in or wallet data.
   */
  publicGarden(p: PlayerRow) {
    const now = this.d.now();
    const demo = p.demo === 1;
    const dayMs = this.dayMs(p);
    const today = this.today(p);
    const sky = this.sky(demo);
    const weather = this.weatherView(demo);
    const plots = [];
    for (let plot = 0; plot < 3; plot++) {
      const t = this.treeOnPlot(p.id, plot);
      let tree = null;
      if (t) {
        const g = advance(growthOf(t), now, dayMs, sky);
        const thirst = thirstOf(g, now, sky);
        const at = eruptionAt(sky, now);
        const old = t.harvest_count >= t.max_harvests;
        const cleaned = !!at && cleanedOf(at.eruption, t.ash_clean_at);
        const waterCount = t.water_day === today ? t.water_count : 0;
        tree = {
          tokenId: t.token_id,
          species: t.species,
          quality: t.quality,
          stage: stageOf(g) as Stage,
          growthPercent: Math.round((g.growth / g.target) * 100),
          ready: isReady(g),
          harvestCount: t.harvest_count,
          maxHarvests: t.max_harvests,
          waterCount,
          waterNeed: weather.waterNeed,
          isWatered: t.water_until > now || weather.kind === 'rain',
          thirsty: thirst.thirsty,
          wilting: thirst.wilting,
          ash: !!at && at.phase === 'eruption' && !old && !cleaned,
          volcanicSoil: !!at && at.phase === 'volcanic' && !old && cleaned,
          /** A visitor can help water it now (social.ts). */
          needsWater: this.needsWater(p, t, now),
        };
      }
      const m = tree ? null : this.memorialOnPlot(p.id, plot);
      plots.push({
        plot,
        locked: plot >= plotCount(p.xp),
        tree,
        memorial: m ? { species: m.species, quality: m.quality, tokenId: m.tokenId, harvestCount: m.harvestCount } : null,
      });
    }
    return {
      name: p.name,
      accountId: p.account_id,
      avatar: p.avatar,
      title: titleFor(p.xp),
      demo,
      weather: { kind: weather.kind, waterNeed: weather.waterNeed },
      plots,
      // Their TaniBot as decoration (visits): only whether it is switched on. Never its account,
      // budget, limit, style or log. null = no working TaniBot (the visitor sees none).
      tanibot: this.publicBot(p.id),
    };
  }

  /** A garden's TaniBot for visitors: ON / OFF only (null when it has no ready TaniBot). */
  private publicBot(playerId: number): { on: boolean } | null {
    const b = this.db.prepare("SELECT enabled FROM bots WHERE player_id = ? AND status = 'ready'").get(playerId) as { enabled: number } | undefined;
    return b ? { on: b.enabled === 1 } : null;
  }

  /** Friends who helped water this garden in the last 3 days (newest first; the owner's notices). */
  helpsReceived(ownerId: number) {
    return this.db
      .prepare(
        `SELECT h.id, h.plot, h.owner_xp AS xp, h.created_at AS at, hp.name AS helper, t.species
         FROM garden_help h JOIN players hp ON hp.id = h.helper_id JOIN trees t ON t.id = h.tree_id
         WHERE h.owner_id = ? AND h.created_at > ? ORDER BY h.id DESC LIMIT 10`,
      )
      .all(ownerId, this.d.now() - 3 * 24 * 60 * 60 * 1000) as unknown as { id: number; plot: number; xp: number; at: number; helper: string; species: Species }[];
  }

  /** Cleans the volcanic ash off a tree during an eruption (free). Cleaned trees get the Volcanic soil bonus. */
  cleanAsh(playerId: number, plot: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      const t = this.tickedTree(p, plot);
      const now = this.d.now();
      const at = eruptionAt(this.sky(p.demo === 1), now);
      if (!at || at.phase === 'warning') throw new GameError('There is no ash to clean right now.', 409, { code: 'no_ash' });
      if (at.phase === 'volcanic') throw new GameError('The eruption is over: the ash has blown away.', 409, { code: 'no_ash' });
      if (t.harvest_count >= t.max_harvests) throw new GameError('Old trees are not covered in ash.', 409, { code: 'no_ash' });
      if (cleanedOf(at.eruption, t.ash_clean_at)) throw new GameError('This tree is already clean.', 409, { code: 'already_clean' });
      this.db.prepare('UPDATE trees SET ash_clean_at = ? WHERE id = ?').run(now, t.id);
      return { cleaned: true, volcanicSoilFrom: at.eruption.end, volcanicSoilUntil: at.eruption.volcanicEnd };
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
      const goldBonus = this.volcanicGoldBonus(p, t, now);
      const fruitQuality = rollFruitQuality(t.quality, fertilized, this.d.random(), goldBonus);
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
      // A friend invited by someone: their first harvest pays the referral (both sides).
      const referral = this.payReferral(p);
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
        /** Paid now: this was the first harvest of an invited friend. */
        referral,
      };
    });
  }

  /**
   * "Move to Memorials": the Memorial Tree standing on a plot moves to the player's Memorial list
   * without planting anything, so the plot is empty. Same step as planting there (plantNow). Its NFT
   * stays the player's: no chain job, nothing deleted (only the tree's plot becomes NULL).
   */
  moveMemorial(playerId: number, plot: number) {
    return tx(this.db, () => {
      const p = this.getPlayer(playerId);
      if (!Number.isInteger(plot) || plot < 0 || plot >= plotCount(p.xp)) throw new GameError('This plot is locked');
      if (!this.moveMemorialOff(p.id, plot)) throw new GameError('There is no Memorial Tree on this plot');
      return { moved: true };
    });
  }

  /** Takes the Memorial Tree(s) off a plot (they stay in the Memorial list). Returns how many moved. */
  private moveMemorialOff(playerId: number, plot: number): number {
    return Number(this.db.prepare("UPDATE trees SET plot = NULL WHERE player_id = ? AND plot = ? AND status = 'dead'").run(playerId, plot).changes);
  }

  /** The Memorial Tree standing on a plot (an old or cut-down tree), if any. */
  memorialOnPlot(playerId: number, plot: number): MemorialView | null {
    const t = this.db
      .prepare("SELECT * FROM trees WHERE player_id = ? AND plot = ? AND status = 'dead' ORDER BY died_at DESC LIMIT 1")
      .get(playerId, plot) as unknown as TreeRow | undefined;
    return t ? memorialView(t) : null;
  }

  /** Every Memorial Tree of a player, newest first (standing on a plot or not). */
  memorials(playerId: number): MemorialView[] {
    return (this.db.prepare("SELECT * FROM trees WHERE player_id = ? AND status = 'dead' ORDER BY died_at DESC").all(playerId) as unknown as TreeRow[]).map(memorialView);
  }

  /** Volcanic soil: a better Gold chance for trees cleaned during the eruption, until it ends. */
  private volcanicGoldBonus(p: PlayerRow, t: TreeRow, now: number): number {
    const at = eruptionAt(this.sky(p.demo === 1), now);
    return at && at.phase === 'volcanic' && cleanedOf(at.eruption, t.ash_clean_at) ? VOLCANIC_GOLD_BONUS : 0;
  }

  /** The village weather of a mode, as the web game and TaniBot see it. */
  weatherView(demo: boolean) {
    const now = this.d.now();
    const sky = this.sky(demo);
    const day = dayIndex(now, demo);
    const at = eruptionAt(sky, now);
    const nextDayKind = sky.kind(day + 1);
    return {
      kind: sky.kind(day),
      tomorrow: nextDayKind,
      /** Waterings a tree needs today: 0 in the rain, 2 in a drought, else 1. */
      waterNeed: sky.kind(day) === 'rain' ? 0 : sky.kind(day) === 'drought' ? DROUGHT_WATERINGS : 1,
      wiltDays: sky.wiltMs / sky.dayMs,
      eruption: at
        ? {
            phase: at.phase,
            msSinceWarning: Math.max(0, now - at.eruption.warnStart),
            msToEruption: Math.max(0, at.eruption.start - now),
            msToEnd: Math.max(0, at.eruption.end - now),
            msToVolcanicEnd: Math.max(0, at.eruption.volcanicEnd - now),
            /** Phase ends in this many ms. */
            msLeft: Math.max(0, (at.phase === 'warning' ? at.eruption.start : at.phase === 'eruption' ? at.eruption.end : at.eruption.volcanicEnd) - now),
            id: `${demo ? 'd' : 'n'}${at.eruption.day}`,
          }
        : null,
    };
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
    // The Memorial Tree keeps standing on its plot until the player plants a new seed there
    // (plantNow moves it to the Memorial list). The plot counts as free for planting.
    this.db.prepare("UPDATE trees SET status = 'dead', died_at = ? WHERE id = ?").run(now, t.id);
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
    const sky = this.sky(demo);
    const weather = this.weatherView(demo);

    const plotViews = [];
    for (let plot = 0; plot < 3; plot++) {
      const t = this.treeOnPlot(p.id, plot);
      let tree = null;
      if (t) {
        const g = advance(growthOf(t), now, dayMs, sky);
        const ready = isReady(g);
        const thirst = thirstOf(g, now, sky);
        const at = eruptionAt(sky, now);
        const old = t.harvest_count >= t.max_harvests;
        const cleaned = !!at && cleanedOf(at.eruption, t.ash_clean_at);
        const waterCount = t.water_day === today ? t.water_count : 0;
        tree = {
          id: t.id,
          tokenId: t.token_id,
          species: t.species,
          quality: t.quality,
          stage: stageOf(g) as Stage,
          growthPercent: Math.round((g.growth / g.target) * 100),
          ready,
          // Rain waters every tree; a drought needs two waterings.
          wateredToday: weather.waterNeed === 0 || waterCount >= weather.waterNeed,
          waterCount,
          waterNeed: weather.waterNeed,
          isWatered: t.water_until > now || weather.kind === 'rain',
          /** Weather: thirst (the tree goes back one stage after `wiltDays` without water). */
          thirsty: thirst.thirsty,
          wilting: thirst.wilting,
          msToWilt: thirst.msToWilt,
          wiltedRecently: (g.wiltedAtMs ?? 0) > 0 && now - (g.wiltedAtMs ?? 0) < dayMs,
          /** Volcanic ash (during an eruption, until cleaned) and the Volcanic soil bonus. */
          ash: !!at && at.phase === 'eruption' && !old && !cleaned,
          volcanicSoil: !!at && at.phase === 'volcanic' && !old && cleaned,
          isFertilized: t.fert_until > now,
          fertMsLeft: Math.max(0, t.fert_until - now),
          fertSpeed: t.fert_until > now ? 1 + FERTILIZER_BOOST : 1,
          nextHarvestOdds: fruitOdds(t.quality, t.fert_boost === 1, this.volcanicGoldBonus(p, t, now)),
          harvestCount: t.harvest_count,
          maxHarvests: t.max_harvests,
          msToReady: ready ? 0 : msToReady(g, dayMs),
          ageDays: Math.floor((now - t.planted_at) / dayMs),
        };
      }
      const memorial = tree ? null : this.memorialOnPlot(p.id, plot);
      // `movable`: this server has "Move to Memorials" (POST /api/memorial/move); older servers
      // send no flag, so the web hides the button.
      plotViews.push({ plot, locked: plot >= plots, tree, memorial: memorial ? { ...memorial, movable: true } : null });
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
      /** Village weather and events (weather.ts); the same for every garden of this mode. */
      weather,
      /** The player's Memorial Trees (old or cut-down trees; their NFTs stay), newest first. */
      memorials: this.memorials(p.id),
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
      /** Friends who helped water this garden lately (garden visits, social.ts). */
      helps: this.helpsReceived(p.id),
      /** Stickers visitors left here (newest first, last 10). */
      stickers: this.stickersReceived(p.id),
      /** Visitors: 1 row per visitor per day (stickers, watering, wave back), last 10. */
      visitors: this.visitorsReceived(p.id),
      /** Waves back from gardens this player visited (newest first, last 10). */
      waves: this.wavesReceived(p.id),
      /** Invite a friend: rewards, friends invited and their status, who invited this garden. */
      referral: this.referralView(p, signIn === 'judge'),
      /** Add friend + Online (2026-11-11): the limits, and who added this garden (Village tab + notice). */
      friends: this.friendSummary(p.id),
      friendAdds: this.friendAddsReceived(p.id),
      /** Red dots: the newest Village events and what the owner has seen (all devices). */
      news: this.villageNews(p.id),
      /** Red dot on the Market tab: fruit added since the owner last opened the Market. */
      market: this.marketNews(p.id),
      /** Arena 1 VS 1 (arena.ts): duels left today, the prize now, duels this garden received. */
      // v2 (arena-match.ts): `v: 2`, the open match to resume and matches received; old webs ignore them.
      arena: { ...arenaState(this.db, p.id, now, this.afterSeason(ARENA_PRIZE), this.d.explorerTxUrl), ...arenaMatchState(this.db, p.id, this.d.explorerTxUrl, this.arenaOnline) },
    };
  }

  /** Recent on-chain activity with explorer links (proof for judges). */
  activity(playerId: number, limit = 50) {
    const rows = this.db
      .prepare('SELECT id, kind, status, tx_hash, error, created_at, payload FROM chain_jobs WHERE player_id = ? ORDER BY id DESC LIMIT ?')
      .all(playerId, limit) as { id: number; kind: string; status: string; tx_hash: string | null; error: string | null; created_at: number; payload: string }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      /** 'referral' = a referral reward or bonus (the web labels it so, not as a harvest sale). */
      note:
        (r.kind === 'mint' || r.kind === 'mint_reward') && r.payload.includes('"memo":"Referral')
          ? ('referral' as const)
          : r.kind === 'mint_reward' && r.payload.includes('"memo":"Arena prize')
            ? ('arena' as const)
            : null,
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

