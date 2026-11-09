// TaniBot: the player's AI farmer with its own NEAR wallet.
//
// - Account: Google gardens get `bot.<player>.nearvest.testnet` (created by the
//   player's account); wallet gardens get `<name>-bot.nearvest.testnet` (factory).
//   The account's ONLY key is a function call key for `burn` and `bot_accept` on
//   the PANEN contract, held (encrypted) by the server.
// - Budget: PANEN in the bot's own account. The PANEN contract enforces the daily
//   spending limit and blocks any transfer by the bot; only the player can take
//   the budget back. So a wrong decision can never spend more than the limit.
// - Brain: simple rules for now (TANIBOT_AI=off). Every action is logged with a
//   short reason and, when it touches the chain, the transaction.
// - Schedule: 3 times a day (08:00, 13:00, 20:00 WIB); demo gardens every 2 minutes.

import { KeyPair } from 'near-api-js';
import { encryptSecret } from './crypto.ts';
import { dayIndex } from './clock.ts';
import { fromMicro, toMicro, tx, type DB } from './db.ts';
import { Game, GameError } from './game.ts';
import { enqueue } from './chain/worker.ts';
import type { Chain } from './chain/types.ts';
import { SHOP_ITEMS, SPECIES, SPECIES_LIST, type Quality, type Species } from './rules.ts';
import type { AiMeter, Brain, BrainAction, BrainInput } from './brain.ts';

export const BOT_STYLES = ['thrifty', 'balanced', 'turbo'] as const;
export type BotStyle = (typeof BOT_STYLES)[number];

/** Draft numbers (tune in testing). */
export const DEFAULT_BOT_DAILY_LIMIT = 20;
export const DEFAULT_BOT_BUDGET = 20;
export const MAX_BOT_DAILY_LIMIT = 200;
/** Normal gardens: runs at 01:00, 06:00 and 13:00 UTC = 08:00, 13:00, 20:00 WIB. */
export const BOT_RUN_HOURS_UTC = [1, 6, 13];
/** Demo gardens (1 game day = 1 minute): one run every 2 minutes, not every game day. */
export const DEMO_BOT_INTERVAL_MS = 2 * 60_000;
/**
 * Demo gardens also react between rounds: a tree that just got ripe or dry is
 * handled within about this time (rules only, never the AI).
 */
export const QUICK_REACTION_MS = 10_000;
/** Demo gardens call the AI brain at most this often (other rounds use the rules). */
export const DEMO_AI_INTERVAL_MS = 10 * 60_000;
/** An identical Log line (without a transaction) is not repeated within this time. */
const SAME_LOG_WINDOW_MS: Record<string, number> = { water: 3 * 60_000, default: 10 * 60_000 };

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface BotRow {
  player_id: number;
  account_id: string;
  public_key: string;
  mode: 'sub' | 'factory';
  status: 'creating' | 'linking' | 'ready' | 'failed';
  enabled: number;
  style: BotStyle;
  daily_limit_micro: number;
  budget_micro: number;
  spent_day: number | null;
  spent_micro: number;
  next_run_at: number;
  empty_notice_day: number | null;
  last_ai_at: number;
  auto_plant: 'off' | 'common';
  created_at: number;
}

export interface TaniBotDeps {
  db: DB;
  game: Game;
  chain: Chain;
  now: () => number;
  masterKey: string;
  factoryAccountId: string;
  panenContractId: string;
  explorerTxUrl: string;
  /** AI brain (TANIBOT_AI=on). Without it TaniBot uses its simple rules. */
  brain?: Brain | null;
  /** Counts AI calls and costs; enforces the daily call limit and the dollar brake. */
  meter?: AiMeter | null;
}

/** Next scheduled run after `nowMs`. */
export function nextRunAt(nowMs: number, demo: boolean): number {
  if (demo) return nowMs + DEMO_BOT_INTERVAL_MS;
  const dayStart = Math.floor(nowMs / DAY) * DAY;
  for (let d = 0; d < 2; d++) {
    for (const h of BOT_RUN_HOURS_UTC) {
      const t = dayStart + d * DAY + h * HOUR;
      if (t > nowMs) return t;
    }
  }
  return dayStart + DAY + BOT_RUN_HOURS_UTC[0] * HOUR;
}

const label = (species: Species) => SPECIES[species].name;
const qualityName: Record<Quality, string> = { common: 'Common', rare: 'Rare', gold: 'Gold' };

export class TaniBotService {
  private d: TaniBotDeps;

  constructor(deps: TaniBotDeps) {
    this.d = deps;
  }

  private get db() {
    return this.d.db;
  }

  private row(playerId: number): BotRow | null {
    return (this.db.prepare('SELECT * FROM bots WHERE player_id = ?').get(playerId) as unknown as BotRow) ?? null;
  }

  private mustRow(playerId: number): BotRow {
    const r = this.row(playerId);
    if (!r) throw new GameError('Activate TaniBot first', 404);
    return r;
  }

  /** The contract's day: 00:00 UTC (= 07:00 WIB). */
  private limitDay(): number {
    return dayIndex(this.d.now(), false);
  }

  /** Last quick reaction per player: when, and what it saw (to skip repeats). */
  private quick = new Map<number, { at: number; sig: string; acted: boolean }>();

  /** `short`: a few words for the speech bubble above TaniBot in the garden ("Harvested 1 Durian!"). */
  log(playerId: number, action: string, reason: string, jobId: number | null = null, brain: 'rules' | 'ai' = 'rules', short: string | null = null): void {
    if (jobId === null) {
      // No spam: skip a line identical to a recent one (water 3 minutes, notices 10 minutes).
      const window = SAME_LOG_WINDOW_MS[action] ?? SAME_LOG_WINDOW_MS.default;
      const same = this.db
        .prepare('SELECT 1 FROM bot_log WHERE player_id = ? AND action = ? AND reason = ? AND created_at > ? LIMIT 1')
        .get(playerId, action, reason, this.d.now() - window);
      if (same) return;
    }
    this.db
      .prepare('INSERT INTO bot_log (player_id, action, reason, job_id, brain, short, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(playerId, action, reason, jobId, brain, short, this.d.now());
  }

  /** Logs a weather line once since `sinceMs` (the start of a rain day or of an eruption warning). */
  private logOnceSince(playerId: number, action: string, reason: string, sinceMs: number, short: string): void {
    const seen = this.db.prepare('SELECT 1 FROM bot_log WHERE player_id = ? AND action = ? AND reason = ? AND created_at >= ? LIMIT 1').get(playerId, action, reason, sinceMs);
    if (seen) return;
    this.db
      .prepare('INSERT INTO bot_log (player_id, action, reason, job_id, brain, short, created_at) VALUES (?, ?, ?, NULL, ?, ?, ?)')
      .run(playerId, action, reason, 'rules', short, this.d.now());
  }

  /** Start of the current village day of this player's mode. */
  private dayStart(playerId: number): number {
    const demo = this.d.game.getPlayer(playerId).demo === 1;
    const dayMs = this.d.game.sky(demo).dayMs;
    return dayIndex(this.d.now(), demo) * dayMs;
  }

  /** Latest chain job of this player created after `afterId` (the proof of an action). */
  private jobSince(playerId: number, afterId: number): number | null {
    const r = this.db.prepare('SELECT MIN(id) AS id FROM chain_jobs WHERE player_id = ? AND id > ?').get(playerId, afterId) as { id: number | null };
    return r.id;
  }

  private lastJobId(): number {
    return (this.db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM chain_jobs').get() as { id: number }).id;
  }

  // ---------- Setup and settings ----------

  /**
   * Creates the bot account and links it. Google gardens: everything is done by
   * the game (player key held by the server). Wallet gardens: returns the
   * `set_bot` call the player's wallet must sign; then call `walletLinked`.
   */
  /**
   * `afterAccount`: the player's account is still being created; the bot's jobs simply queue
   * after it (Try as Judge). `holdMs`: the bot waits for the player's first harvest, at most this long.
   */
  setup(playerId: number, opts: { dailyLimit?: number; budget?: number; afterAccount?: boolean; holdMs?: number }) {
    const p = this.d.game.getPlayer(playerId);
    const accountOk = p.account_status === 'ready' || (opts.afterAccount && p.account_status === 'pending');
    if (!accountOk) throw new GameError('Your NEAR account is still being created. Try again in a moment.', 409);
    const dailyLimit = opts.dailyLimit ?? DEFAULT_BOT_DAILY_LIMIT;
    if (!Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > MAX_BOT_DAILY_LIMIT) {
      throw new GameError(`Daily limit must be 0-${MAX_BOT_DAILY_LIMIT} PANEN`);
    }
    const wallet = p.custody === 'wallet';
    const budget = wallet ? 0 : (opts.budget ?? Math.min(DEFAULT_BOT_BUDGET, Math.floor(fromMicro(p.balance_micro))));
    if (!Number.isInteger(budget) || budget < 0) throw new GameError('Budget must be a whole number of PANEN');
    if (toMicro(budget) > p.balance_micro) throw new GameError('You do not have that much PANEN for the budget');

    const existing = this.row(playerId);
    if (existing && existing.status !== 'failed') throw new GameError('TaniBot is already active', 409);

    const now = this.d.now();
    const botName = wallet ? `${p.name.slice(0, 28)}-bot` : 'bot';
    const botId = wallet ? `${botName}.${this.d.factoryAccountId}` : `bot.${p.account_id}`;
    if (wallet && this.db.prepare('SELECT 1 FROM players WHERE account_id = ?').get(botId)) {
      throw new GameError('This TaniBot name is taken', 409);
    }
    const limitMicro = toMicro(dailyLimit);

    tx(this.db, () => {
      // Retry after a failure keeps the same key, so a half-created account can still be used.
      let publicKey = existing?.public_key;
      if (!existing) {
        const key = KeyPair.fromRandom('ed25519');
        publicKey = key.getPublicKey().toString();
        this.db
          .prepare(
            `INSERT INTO bots (player_id, account_id, public_key, secret_key_enc, mode, status, daily_limit_micro, next_run_at, created_at)
             VALUES (?, ?, ?, ?, ?, 'creating', ?, 0, ?)`,
          )
          .run(p.id, botId, publicKey, encryptSecret(key.toString(), this.d.masterKey), wallet ? 'factory' : 'sub', limitMicro, now);
      } else {
        this.db.prepare("UPDATE bots SET status = 'creating', enabled = 1, daily_limit_micro = ? WHERE player_id = ?").run(limitMicro, p.id);
      }
      const temp = wallet ? encryptSecret(KeyPair.fromRandom('ed25519').toString(), this.d.masterKey) : undefined;
      const createJob = enqueue(
        this.db,
        p.id,
        { kind: 'create_bot', mode: wallet ? 'factory' : 'sub', ownerId: p.account_id, botId, name: botName, publicKey: publicKey!, tempSecretEnc: temp },
        now,
      );
      this.log(p.id, 'setup', `Hello! I am TaniBot. My own NEAR wallet is ${botId}. My only key can burn PANEN for Shop purchases, nothing else.`, createJob);
      if (!wallet) {
        const linkJob = enqueue(this.db, p.id, { kind: 'bot_link', ownerId: p.account_id, botId, dailyLimitMicro: limitMicro, ownerSigns: true }, now);
        this.log(p.id, 'limit', `Daily spending limit set to ${dailyLimit} PANEN. The PANEN contract enforces it, not me.`, linkJob);
        if (budget > 0) this.moveBudget(p.id, p.account_id, botId, toMicro(budget));
      }
      if (opts.holdMs) {
        this.db.prepare('UPDATE bots SET hold_until = ? WHERE player_id = ?').run(now + opts.holdMs, p.id);
        this.log(p.id, 'notice', 'Your first harvest is yours: I will start working after you harvest a tree (or in a few minutes).');
      }
    });
    return {
      bot: this.view(playerId),
      // Wallet gardens: the wallet signs this (1 yoctoNEAR proves it is the player's full access key).
      walletCalls: wallet
        ? [{ receiverId: this.d.panenContractId, method: 'set_bot', args: { bot_id: botId, daily_limit: units(limitMicro) }, deposit: '1' }]
        : null,
    };
  }

  /** The player harvested: a bot that was waiting for that starts working now. */
  release(playerId: number): void {
    this.db.prepare('UPDATE bots SET hold_until = 0, next_run_at = MIN(next_run_at, ?) WHERE player_id = ? AND hold_until > 0').run(this.d.now() + 5000, playerId);
  }

  /** Wallet gardens: the wallet signed set_bot; the bot accepts with its own key. */
  walletLinked(playerId: number) {
    const p = this.d.game.getPlayer(playerId);
    const b = this.mustRow(playerId);
    if (p.custody !== 'wallet') throw new GameError('Only for NEAR wallet gardens');
    if (b.status === 'ready') return this.view(playerId);
    const job = enqueue(this.db, p.id, { kind: 'bot_link', ownerId: p.account_id, botId: b.account_id, dailyLimitMicro: b.daily_limit_micro, ownerSigns: false }, this.d.now());
    this.log(p.id, 'limit', `Your wallet set my daily spending limit to ${fromMicro(b.daily_limit_micro)} PANEN. Accepting you as my player.`, job);
    return this.view(playerId);
  }

  private moveBudget(playerId: number, ownerId: string, botId: string, micro: number): void {
    const now = this.d.now();
    const res = this.db
      .prepare('INSERT INTO ledger (player_id, kind, amount_micro, note, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(playerId, 'bot_budget', -micro, `TaniBot budget to ${botId}`, now);
    const ledgerId = Number(res.lastInsertRowid);
    const job = enqueue(this.db, playerId, { kind: 'bot_fund', ownerId, botId, amountMicro: micro, ledgerId }, now);
    this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(job, ledgerId);
    this.db.prepare('UPDATE players SET balance_micro = balance_micro - ? WHERE id = ?').run(micro, playerId);
    this.db.prepare('UPDATE bots SET budget_micro = budget_micro + ? WHERE player_id = ?').run(micro, playerId);
    this.log(playerId, 'budget', `Thanks! ${fromMicro(micro)} PANEN moved from you to my wallet as my budget.`, job);
  }

  /** Google gardens: add budget from the player's balance. */
  fund(playerId: number, amount: number) {
    const p = this.d.game.getPlayer(playerId);
    const b = this.mustRow(playerId);
    if (p.custody === 'wallet') throw new GameError('Wallet gardens add budget with their wallet');
    if (b.status === 'failed') throw new GameError('TaniBot setup failed. Activate it again.');
    if (!Number.isInteger(amount) || amount < 1) throw new GameError('Amount must be at least 1 PANEN');
    if (toMicro(amount) > p.balance_micro) throw new GameError('Not enough PANEN');
    tx(this.db, () => this.moveBudget(p.id, p.account_id, b.account_id, toMicro(amount)));
    return this.view(playerId);
  }

  /** Google gardens: take budget back (only the player can, enforced by the contract). */
  withdraw(playerId: number, amount: number) {
    const p = this.d.game.getPlayer(playerId);
    const b = this.mustRow(playerId);
    if (p.custody === 'wallet') throw new GameError('Wallet gardens take budget back with their wallet');
    if (b.status !== 'ready') throw new GameError('TaniBot is not ready yet');
    const micro = toMicro(amount);
    if (!Number.isInteger(amount) || amount < 1 || micro > b.budget_micro) throw new GameError('Amount must be 1 PANEN up to the budget');
    tx(this.db, () => {
      const now = this.d.now();
      const ledgerId = Number(
        this.db
          .prepare('INSERT INTO ledger (player_id, kind, amount_micro, note, created_at) VALUES (?, ?, ?, ?, ?)')
          .run(p.id, 'bot_budget', micro, `TaniBot budget back from ${b.account_id}`, now).lastInsertRowid,
      );
      const job = enqueue(this.db, p.id, { kind: 'bot_withdraw', ownerId: p.account_id, botId: b.account_id, amountMicro: micro, ledgerId }, now);
      this.db.prepare('UPDATE ledger SET job_id = ? WHERE id = ?').run(job, ledgerId);
      this.db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?').run(micro, p.id);
      this.db.prepare('UPDATE bots SET budget_micro = budget_micro - ? WHERE player_id = ?').run(micro, p.id);
      this.log(p.id, 'budget', `${amount} PANEN went back from my wallet to you.`, job);
    });
    return this.view(playerId);
  }

  /** On/off and working style. Off = no runs (the budget stays in the bot's wallet). */
  settings(playerId: number, s: { enabled?: unknown; style?: unknown; autoPlant?: unknown }) {
    const b = this.mustRow(playerId);
    if (s.autoPlant !== undefined) {
      if (s.autoPlant !== 'off' && s.autoPlant !== 'common') throw new GameError('autoPlant must be off or common');
      if (s.autoPlant !== b.auto_plant) {
        this.db.prepare('UPDATE bots SET auto_plant = ? WHERE player_id = ?').run(s.autoPlant, playerId);
        this.log(
          playerId,
          'switch',
          s.autoPlant === 'common'
            ? 'Auto-plant on: I plant Common or unknown seeds in empty plots. Rare, Gold and superior seeds are always yours to plant.'
            : 'Auto-plant off: I leave empty plots for you.',
        );
      }
    }
    if (s.enabled !== undefined) {
      if (typeof s.enabled !== 'boolean') throw new GameError('enabled must be true or false');
      this.db.prepare('UPDATE bots SET enabled = ?, next_run_at = ? WHERE player_id = ?').run(s.enabled ? 1 : 0, s.enabled ? 0 : b.next_run_at, playerId);
      this.log(playerId, 'switch', s.enabled ? 'Switched on. Back to work!' : 'Switched off. I will rest until you switch me on again.');
    }
    if (s.style !== undefined) {
      if (!BOT_STYLES.includes(s.style as BotStyle)) throw new GameError('Unknown style');
      this.db.prepare('UPDATE bots SET style = ? WHERE player_id = ?').run(s.style as string, playerId);
      const what: Record<BotStyle, string> = {
        thrifty: 'Thrifty: I only water, harvest and sell. I never buy.',
        balanced: 'Balanced: I fertilize the slow trees (rambutan, durian) when it helps.',
        turbo: 'Turbo: I fertilize every growing tree and buy fertilizer when needed.',
      };
      this.log(playerId, 'style', what[s.style as BotStyle]);
    }
    return this.view(playerId);
  }

  /** Re-reads the bot's budget and today's spending from the contract (when nothing is still on its way). */
  async sync(playerId: number): Promise<void> {
    const b = this.row(playerId);
    if (!b || b.status !== 'ready') return;
    const pending = this.db
      .prepare("SELECT 1 FROM chain_jobs WHERE player_id = ? AND status = 'pending' AND kind IN ('bot_fund', 'bot_withdraw', 'bot_burn', 'bot_limit')")
      .get(playerId);
    if (pending) return;
    const info = await this.d.chain.botInfo(b.account_id);
    if (!info) return;
    const day = this.limitDay();
    this.db
      .prepare('UPDATE bots SET budget_micro = ?, daily_limit_micro = ?, spent_micro = ?, spent_day = ? WHERE player_id = ?')
      .run(Number(info.balance / 10n ** 12n), Number(info.dailyLimit / 10n ** 12n), Number(info.spentToday / 10n ** 12n), day, playerId);
  }

  view(playerId: number) {
    const b = this.row(playerId);
    if (!b) return null;
    const day = this.limitDay();
    const spent = b.spent_day === day ? b.spent_micro : 0;
    const log = this.db
      .prepare(
        `SELECT l.id, l.action, l.reason, l.brain, l.created_at, j.status AS job_status, j.tx_hash
         FROM bot_log l LEFT JOIN chain_jobs j ON j.id = l.job_id
         WHERE l.player_id = ? ORDER BY l.id DESC LIMIT 40`,
      )
      .all(playerId) as { id: number; action: string; reason: string; brain: string; created_at: number; job_status: string | null; tx_hash: string | null }[];
    return {
      accountId: b.account_id,
      explorerUrl: `${this.d.explorerTxUrl.replace(/txns\/?$/, 'address/')}${b.account_id}`,
      status: b.status,
      enabled: b.enabled === 1,
      style: b.style,
      brain: (this.d.brain ? 'ai' : 'rules') as 'ai' | 'rules',
      model: this.d.brain?.model ?? null,
      budget: fromMicro(b.budget_micro),
      dailyLimit: fromMicro(b.daily_limit_micro),
      spentToday: fromMicro(spent),
      remainingToday: fromMicro(Math.max(0, b.daily_limit_micro - spent)),
      nextRunAt: b.enabled === 1 && b.status === 'ready' ? b.next_run_at : null,
      autoPlant: b.auto_plant,
      log: log.map((l) => ({
        id: l.id,
        action: l.action,
        reason: l.reason,
        brain: l.brain,
        at: l.created_at,
        txStatus: l.job_status,
        txUrl: l.tx_hash && !l.tx_hash.startsWith('fake') && l.tx_hash !== 'already-created' ? this.d.explorerTxUrl + l.tx_hash : null,
      })),
    };
  }

  // ---------- Schedule ----------

  /** Runs every bot that is due. Called every few seconds by the server. */
  async tick(): Promise<number> {
    const now = this.d.now();
    const due = this.db
      .prepare("SELECT player_id FROM bots WHERE status = 'ready' AND enabled = 1 AND next_run_at <= ? AND hold_until <= ?")
      .all(now, now) as { player_id: number }[];
    for (const { player_id } of due) {
      try {
        if (this.aiAllowed(player_id, now)) await this.runAi(player_id);
        else this.run(player_id);
      } catch (err) {
        this.log(player_id, 'notice', `Something went wrong this round, I will try again later. (${err instanceof Error ? err.message : err})`);
      }
      const p = this.d.game.getPlayer(player_id);
      this.db.prepare('UPDATE bots SET next_run_at = ? WHERE player_id = ?').run(nextRunAt(now, p.demo === 1), player_id);
    }
    return due.length + this.quickReactions(now, new Set(due.map((d) => d.player_id)));
  }

  /**
   * Demo gardens only: between rounds, react to a tree that is ripe or dry.
   * Rules only (no AI): harvest, water and sell; no shopping.
   */
  private quickReactions(now: number, justRan: Set<number>): number {
    const ash = this.ashReactions(now);
    const bots = this.db
      .prepare(
        `SELECT b.player_id FROM bots b JOIN players p ON p.id = b.player_id
         WHERE b.status = 'ready' AND b.enabled = 1 AND p.demo = 1 AND b.hold_until <= ?`,
      )
      .all(now) as { player_id: number }[];
    let n = 0;
    for (const { player_id } of bots) {
      if (justRan.has(player_id)) {
        this.quick.set(player_id, { at: now, sig: '', acted: true });
        continue;
      }
      const last = this.quick.get(player_id);
      if (last && now - last.at < QUICK_REACTION_MS) continue;
      const plots = this.d.game.state(player_id).plots;
      const sig = plots
        .filter((x) => x.tree && (x.tree.ready || !x.tree.wateredToday || x.tree.ash))
        .map((x) => `${x.plot}:${x.tree!.ash ? 'ash' : x.tree!.ready ? 'ripe' : 'dry'}`)
        .join(',');
      if (!sig) continue;
      // Nothing changed since a round that could not help (e.g. storage full): wait for a change.
      if (last && last.sig === sig && !last.acted) continue;
      let acted = false;
      try {
        acted = this.run(player_id, 'quick') > 0;
      } catch (err) {
        this.log(player_id, 'notice', `Something went wrong, I will try again later. (${err instanceof Error ? err.message : err})`);
      }
      this.quick.set(player_id, { at: now, sig, acted });
      n++;
    }
    return n + ash;
  }

  /**
   * Normal gardens, during an eruption only: clean the ash between scheduled rounds (an eruption
   * lasts about an hour, rounds are 3x a day). Free; nothing else is done. Demo gardens do this
   * in their quick reactions.
   */
  private ashReactions(now: number): number {
    if (this.d.game.weatherView(false).eruption?.phase !== 'eruption') return 0;
    const bots = this.db
      .prepare(
        `SELECT b.player_id FROM bots b JOIN players p ON p.id = b.player_id
         WHERE b.status = 'ready' AND b.enabled = 1 AND p.demo = 0 AND b.hold_until <= ?`,
      )
      .all(now) as { player_id: number }[];
    let n = 0;
    for (const { player_id } of bots) {
      if (!this.d.game.state(player_id).plots.some((x) => x.tree?.ash)) continue;
      try {
        n += this.run(player_id, 'ash');
      } catch (err) {
        this.log(player_id, 'notice', `Something went wrong while cleaning the ash, I will try again. (${err instanceof Error ? err.message : err})`);
      }
    }
    return n;
  }

  // ---------- Brain: NEAR AI (suggests) + the game rules (decide what is allowed) ----------

  brainInfo(): { brain: 'ai' | 'rules'; model: string | null } {
    return { brain: this.d.brain ? 'ai' : 'rules', model: this.d.brain?.model ?? null };
  }

  /** AI only for scheduled rounds: normal gardens every round (3x/day), demo gardens at most every 10 minutes. */
  private aiAllowed(playerId: number, now: number): boolean {
    if (!this.d.brain || !this.d.meter) return false;
    const b = this.mustRow(playerId);
    const demo = this.d.game.getPlayer(playerId).demo === 1;
    if (demo && now - b.last_ai_at < DEMO_AI_INTERVAL_MS) return false;
    const blocked = this.d.meter.blocked(now);
    if (blocked) {
      this.log(playerId, 'notice', `I used my simple rules this round because ${blocked}.`);
      return false;
    }
    return true;
  }

  /** What the AI sees: no secrets, only the garden, prices, budget and style. */
  private brainInput(playerId: number): BrainInput {
    const b = this.mustRow(playerId);
    const st = this.d.game.state(playerId);
    const day = this.limitDay();
    const spent = b.spent_day === day ? b.spent_micro : 0;
    const wx = st.weather;
    const dayMs = this.d.game.sky(st.player.demo).dayMs;
    return {
      weather: {
        today: wx.kind,
        tomorrow: wx.tomorrow,
        volcano: wx.eruption ? wx.eruption.phase : 'quiet',
        volcanoMinutesLeft: wx.eruption ? Math.ceil(wx.eruption.msLeft / 60_000) : null,
      },
      style: b.style,
      budget: fromMicro(b.budget_micro),
      budgetLeftToday: fromMicro(Math.max(0, b.daily_limit_micro - spent)),
      fertilizerInStorage: this.d.game.itemCount(playerId, 'fertilizer'),
      trees: st.plots
        .filter((x) => x.tree)
        .map((x) => ({
          plot: x.plot + 1,
          species: x.tree!.species,
          quality: x.tree!.quality,
          stage: x.tree!.stage,
          ripe: x.tree!.ready,
          watered: x.tree!.wateredToday,
          fertilized: x.tree!.isFertilized,
          waterTimesLeft: Math.max(0, x.tree!.waterNeed - x.tree!.waterCount),
          thirsty: x.tree!.thirsty,
          wilting: x.tree!.wilting,
          daysToWilt: x.tree!.msToWilt === null ? null : Math.round((x.tree!.msToWilt / dayMs) * 10) / 10,
          ash: x.tree!.ash,
          volcanicSoil: x.tree!.volcanicSoil,
        })),
      fruits: st.fruits.filter((f) => f.qty > 0).map((f) => ({ species: f.species, quality: f.quality, qty: f.qty })),
      darto: st.darto.prices.map((p) => ({ species: p.species, price: p.price, normal: p.base })),
      shop: { fertilizer: SHOP_ITEMS.fertilizer.price, mangoSeed: SHOP_ITEMS.seed_mango.price },
      autoPlant: b.auto_plant === 'common',
      emptyPlots: st.plots.filter((x) => !x.tree && !x.locked).map((x) => x.plot + 1),
      plantableSeeds: this.plantableSeeds(playerId).length,
    };
  }

  /**
   * One round decided by the AI. Every suggestion is checked against the game
   * rules (and the contract limits); invalid ones are ignored. A broken answer
   * or a timeout falls back to the simple rules. Afterwards a safety net still
   * waters dry trees and harvests ripe ones the AI missed.
   */
  async runAi(playerId: number): Promise<number> {
    const brain = this.d.brain!;
    const meter = this.d.meter!;
    const now = this.d.now();
    this.db.prepare('UPDATE bots SET last_ai_at = ? WHERE player_id = ?').run(now, playerId);
    let result;
    try {
      result = await brain.decide(this.brainInput(playerId));
      meter.record(this.d.now(), { playerId, model: brain.model, ok: true, tokensIn: result.tokensIn, tokensOut: result.tokensOut, costUsd: result.costUsd });
    } catch (err) {
      const e = err as Error & { tokensIn?: number; tokensOut?: number; costUsd?: number };
      const why = e.name === 'TimeoutError' || /abort|timeout/i.test(e.message) ? 'it took too long' : e.message;
      meter.record(this.d.now(), { playerId, model: brain.model, ok: false, tokensIn: e.tokensIn ?? 0, tokensOut: e.tokensOut ?? 0, costUsd: e.costUsd ?? 0, error: why });
      this.log(playerId, 'notice', `My AI brain did not answer properly (${why}), so I used my simple rules this round.`);
      return this.run(playerId);
    }
    return this.executeAi(playerId, result.decision.actions, result.decision.malformed, result.decision.summary);
  }

  private executeAi(playerId: number, actions: BrainAction[], malformed: number, summary: string): number {
    const game = this.d.game;
    const b = this.mustRow(playerId);
    let done = 0;
    let aiDone = 0;
    let bought = false;
    let buyFailed = false;
    const ignored: string[] = [];
    if (malformed > 0) ignored.push(`${malformed} unreadable`);
    const plotOf = (n: number) => {
      const p = game.state(playerId).plots[n - 1];
      return p && !p.locked ? p : null;
    };
    /** Runs one checked action; logs it with the AI's reason; a game error means the suggestion was not allowed. */
    const doIt = (a: BrainAction, fn: () => [string, string]): boolean => {
      const before = this.lastJobId();
      try {
        const [fact, short] = fn();
        this.log(playerId, a.action, `${a.reason.replace(/[.!]?$/, '.')} ${fact}`, this.jobSince(playerId, before), 'ai', short);
        done++;
        aiDone++;
        return true;
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
        ignored.push(`${a.action} (${err.message})`);
        return false;
      }
    };
    const buyFertilizer = (a: BrainAction): boolean => {
      if (b.style === 'thrifty') return ignored.push('buy (Thrifty never buys)'), false;
      if (bought) return ignored.push('buy (at most one purchase per round)'), false;
      if (buyFailed) return false; // already explained once this round
      bought = doIt({ ...a, action: 'buy' } as BrainAction, () => {
        const r = game.botBuy(playerId, 'fertilizer', 1, this.limitDay());
        return [`Bought 1 Fertilizer for ${r.costPanen} PANEN from my budget (burned on chain).`, 'Bought 1 Fertilizer!'];
      });
      buyFailed = !bought;
      return bought;
    };

    let boughtSeed = false;
    for (const a of actions) {
      if (a.action === 'plant') {
        const plot = plotOf(a.plot);
        if (b.auto_plant !== 'common') {
          ignored.push('plant (auto-plant is off)');
          continue;
        }
        if (!plot || plot.tree) {
          ignored.push(`plant on plot ${a.plot} (not an empty plot)`);
          continue;
        }
        if (this.plantableSeeds(playerId).length === 0) {
          if (b.style === 'thrifty' || boughtSeed) {
            ignored.push(`plant on plot ${a.plot} (no Common seed${b.style === 'thrifty' ? '; Thrifty never buys' : ''})`);
            continue;
          }
          boughtSeed = doIt({ action: 'buy', item: 'seed_mango', qty: 1, reason: a.reason }, () => {
            const r = game.botBuy(playerId, 'seed_mango', 1, this.limitDay());
            return [`Bought 1 Mango seed for ${r.costPanen} PANEN from my budget (burned on chain).`, 'Bought a Mango seed!'];
          });
          if (!boughtSeed) continue;
        }
        doIt(a, () => this.plantOne(playerId, plot.plot));
        continue;
      }
      if (a.action === 'buy' && a.item === 'seed_mango') {
        // A seed is bought together with the plant action that needs it.
        continue;
      }
      if (a.action === 'clean') {
        const plot = plotOf(a.plot);
        const t = plot?.tree;
        if (!plot || !t) {
          ignored.push(`clean on plot ${a.plot} (no tree)`);
          continue;
        }
        // Free: cleaning ash never touches the budget.
        doIt(a, () => (game.cleanAsh(playerId, plot.plot), [`Cleaned the volcanic ash off ${label(t.species)} on plot ${a.plot} (free).`, `Cleaned the ${label(t.species)}!`]));
        continue;
      }
      if (a.action === 'harvest' || a.action === 'water' || a.action === 'fertilize') {
        const plot = plotOf(a.plot);
        const t = plot?.tree;
        if (!plot || !t) {
          ignored.push(`${a.action} on plot ${a.plot} (no tree)`);
          continue;
        }
        if (a.action === 'harvest') {
          if (!t.ready) {
            ignored.push(`harvest on plot ${a.plot} (not ripe)`);
            continue;
          }
          doIt(a, () => {
            const r = game.harvest(playerId, plot.plot);
            return r.kind === 'fruit'
              ? [`Harvested 1 ${qualityName[r.quality]} ${label(r.species)} on plot ${a.plot} (+${r.xp} XP).`, `Harvested 1 ${label(r.species)}!`]
              : [`The old ${label(r.species)} tree on plot ${a.plot} gave its superior seed.`, `Got a superior ${label(r.species)} seed!`];
          });
        } else if (a.action === 'water') {
          doIt(a, () => (game.water(playerId, plot.plot), [`Watered ${label(t.species)} on plot ${a.plot}.`, `Watered the ${label(t.species)}.`]));
        } else {
          if (b.style === 'thrifty') {
            ignored.push('fertilize (Thrifty never fertilizes)');
            continue;
          }
          if (game.itemCount(playerId, 'fertilizer') < 1 && !buyFertilizer(a)) continue;
          doIt(a, () => (game.fertilize(playerId, plot.plot), [`Fertilized ${label(t.species)} on plot ${a.plot}.`, `Fertilized the ${label(t.species)}!`]));
        }
      } else if (a.action === 'buy') {
        if (a.item !== 'fertilizer' || a.qty !== 1) {
          ignored.push(`buy ${a.qty} ${a.item} (only 1 fertilizer per round)`);
          continue;
        }
        if (game.itemCount(playerId, 'fertilizer') > 0) {
          ignored.push('buy (fertilizer already in storage)');
          continue;
        }
        buyFertilizer(a);
      } else if (a.action === 'sell') {
        if (a.quality !== 'common' || !SPECIES_LIST.includes(a.species as Species)) {
          ignored.push(`sell ${a.quality} ${a.species} (only Common fruit; Rare and Gold are your call)`);
          continue;
        }
        const st = game.state(playerId);
        const have = st.fruits.find((f) => f.species === a.species && f.quality === 'common')?.qty ?? 0;
        const price = st.darto.prices.find((p) => p.species === a.species)!;
        const qty = Math.min(a.qty, have);
        if (qty < 1) {
          ignored.push(`sell ${a.species} (none in storage)`);
          continue;
        }
        doIt(a, () => {
          const r = game.sell(playerId, a.species as Species, 'common', qty, price.price);
          return [`Sold ${qty} Common ${label(a.species as Species)} at ${price.price} (normal ${price.base}) for ${r.expectedPanen} PANEN, paid to you.`, `Sold ${qty} ${label(a.species as Species)}!`];
        });
      }
    }

    if (ignored.length > 0) {
      this.log(playerId, 'ignored', `I ignored ${ignored.length} AI suggestion${ignored.length > 1 ? 's' : ''} that the game rules do not allow: ${ignored.join('; ')}.`, null, 'ai');
    }
    // Safety net: whatever the AI missed, dry trees are watered and ripe trees harvested.
    done += this.run(playerId, 'safety');
    // The AI's own summary only when its actions really happened (it can be wrong about the garden).
    if (summary && aiDone > 0) this.log(playerId, 'summary', summary, null, 'ai');
    if (done === 0) this.log(playerId, 'check', 'Checked the garden: nothing to do right now.', null, 'ai');
    return done;
  }

  // ---------- Auto-plant (Common / unknown seeds only) ----------

  /**
   * Seeds TaniBot may plant: Common or unknown quality, bought or from check-ins. Never Rare or
   * Gold seeds, and never superior seeds from old trees (their lineage is the player's call).
   * Mango first (fast and always profitable).
   */
  plantableSeeds(playerId: number) {
    const order: Record<Species, number> = { mango: 0, rambutan: 1, durian: 2 };
    return this.d.game
      .state(playerId)
      .seeds.filter((x) => (x.quality === null || x.quality === 'common') && x.parentTreeId === null)
      .sort((a, b) => order[a.species] - order[b.species] || a.id - b.id);
  }

  /** Plants one plantable seed in the plot; returns the Log text, or throws GameError. */
  private plantOne(playerId: number, plot: number): [string, string] {
    const seed = this.plantableSeeds(playerId)[0];
    if (!seed) throw new GameError('no Common or unknown seed in storage');
    const r = this.d.game.plant(playerId, plot, seed.id);
    const kind = seed.quality === 'common' ? 'Common' : 'unknown-quality';
    return [
      `Plot ${plot + 1} was empty, so I planted a ${kind} ${label(r.species)} seed: a new Tree NFT was minted to you (it turned out ${qualityName[r.quality]}). I never plant Rare, Gold or superior seeds.`,
      `Planted a ${label(r.species)}!`,
    ];
  }

  // ---------- Brain: simple rules (fallback when the AI is off or fails) ----------

  /**
   * One round of work with the simple rules. Returns the number of actions taken.
   * - 'full': a scheduled round.
   * - 'quick' (demo reactions between rounds): harvest, water and sell only, no
   *   shopping and no "nothing to do" line.
   * - 'safety' (after an AI round): only harvest and water what the AI missed.
   */
  run(playerId: number, mode: 'full' | 'quick' | 'safety' | 'ash' = 'full'): number {
    const quick = mode !== 'full';
    const prefix = mode === 'safety' ? 'Safety net: ' : '';
    const b = this.mustRow(playerId);
    const game = this.d.game;
    let done = 0;
    const act = (action: string, fn: () => [string, string] | null) => {
      const before = this.lastJobId();
      try {
        const r = fn();
        if (r) {
          const [reason, short] = r;
          this.log(playerId, action, prefix + reason, this.jobSince(playerId, before), 'rules', short);
          done++;
        }
      } catch (err) {
        if (err instanceof GameError && err.details?.code === 'storage_full') {
          this.log(playerId, 'notice', 'An old tree has a superior seed, but your seed storage is full. I left the seed on the tree for you to decide.');
        } else if (!(err instanceof GameError)) throw err;
      }
    };

    // 0. Weather first (weather.ts). Volcanic ash: clean every tree; it is free (no budget).
    const cleaned: string[] = [];
    for (const plot of game.state(playerId).plots) {
      const t = plot.tree;
      if (!t?.ash) continue;
      try {
        game.cleanAsh(playerId, plot.plot);
        cleaned.push(`${label(t.species)} (plot ${plot.plot + 1})`);
      } catch (err) {
        if (!(err instanceof GameError)) throw err;
      }
    }
    if (cleaned.length > 0) {
      this.log(
        playerId,
        'clean',
        `${prefix}Ash from Mount Tandur covered ${cleaned.length === 1 ? 'a tree' : `${cleaned.length} trees`}, so I cleaned ${cleaned.join(', ')}: ${cleaned.length === 1 ? 'it grows again and gets' : 'they grow again and get'} Volcanic soil after the eruption (faster growth, better Gold chance). Cleaning is free.`,
        null,
        'rules',
        'Cleaned the ash!',
      );
      done += cleaned.length;
    }
    if (mode === 'ash') return done;
    const weather = game.state(playerId).weather;
    if (weather.eruption?.phase === 'warning' && mode !== 'safety') {
      const warnedFrom = this.d.now() - weather.eruption.msSinceWarning;
      this.logOnceSince(playerId, 'weather', 'Mount Tandur is rumbling! When the ash falls I will clean your trees right away.', warnedFrom, 'Mount Tandur is rumbling!');
    }

    // 1. Harvest everything that is ripe.
    for (const plot of game.state(playerId).plots) {
      const t = plot.tree;
      if (t?.ready) {
        act('harvest', () => {
          const r = game.harvest(playerId, plot.plot);
          if (r.kind === 'fruit') return [`${label(r.species)} on plot ${plot.plot + 1} was ripe: harvested 1 ${qualityName[r.quality]} fruit (+${r.xp} XP).`, `Harvested 1 ${label(r.species)}!`];
          return [`The old ${label(r.species)} tree on plot ${plot.plot + 1} gave its superior seed and became a Memorial Tree.`, `Got a superior ${label(r.species)} seed!`];
        });
      }
    }

    // 1b. Auto-plant empty plots with Common / unknown seeds (buying a Mango seed only in full
    //     rounds, never in Thrifty style; the purchase stays within the contract's daily limit).
    if (b.auto_plant === 'common' && mode !== 'safety') {
      let boughtSeed = false;
      for (const plot of game.state(playerId).plots.filter((x) => !x.tree && !x.locked)) {
        if (this.plantableSeeds(playerId).length === 0) {
          if (quick || b.style === 'thrifty' || boughtSeed) break;
          act('buy', () => {
            const r = game.botBuy(playerId, 'seed_mango', 1, this.limitDay());
            boughtSeed = true;
            return [`Plot ${plot.plot + 1} is empty and there is no Common seed left, so I bought 1 Mango seed for ${r.costPanen} PANEN from my budget (burned on chain).`, 'Bought a Mango seed!'];
          });
          if (!boughtSeed) {
            this.noticeOnce(playerId, SHOP_ITEMS.seed_mango.price);
            break;
          }
        }
        act('plant', () => this.plantOne(playerId, plot.plot));
      }
    }

    // 2. Water every thirsty tree (one Log line for all of them). Rain waters everything for free;
    //    a drought needs two waterings; wilting trees come first.
    if (weather.kind === 'rain') {
      if (game.state(playerId).plots.some((x) => x.tree) && mode !== 'safety') {
        this.logOnceSince(playerId, 'weather', "It's raining: every tree is watered for free today, so I saved my water.", this.dayStart(playerId), "It's raining!");
      }
    } else {
      const thirsty = game
        .state(playerId)
        .plots.filter((x) => x.tree && !x.tree.wateredToday)
        .sort((a, b) => Number(b.tree!.wilting) - Number(a.tree!.wilting) || Number(b.tree!.thirsty) - Number(a.tree!.thirsty));
      const watered: string[] = [];
      const wilting: string[] = [];
      let volcanic = false;
      for (const plot of thirsty) {
        const t = plot.tree!;
        const times = Math.max(1, t.waterNeed - t.waterCount);
        let ok = 0;
        for (let i = 0; i < times; i++) {
          try {
            game.water(playerId, plot.plot);
            ok++;
          } catch (err) {
            if (!(err instanceof GameError)) throw err;
            break;
          }
        }
        if (ok === 0) continue;
        const name = `${label(t.species)} (plot ${plot.plot + 1})`;
        watered.push(name);
        if (t.wilting) wilting.push(label(t.species));
        if (t.volcanicSoil) volcanic = true;
      }
      if (watered.length > 0) {
        const n = watered.length;
        let reason = `${prefix}Watered ${n === 1 ? 'a dry tree' : `${n} dry trees`}: ${watered.join(', ')}. Watering is free and happens off-chain.`;
        if (weather.kind === 'drought') {
          reason = `${prefix}Drought: a watering only lasts half a day, so I watered ${watered.join(', ')} twice. Watering is free and happens off-chain.`;
        }
        if (wilting.length > 0) {
          reason = `${prefix}${wilting.join(' and ')} ${wilting.length === 1 ? 'was' : 'were'} wilting (about to go back a stage), so I watered ${wilting.length === 1 ? 'it' : 'them'} first. ${reason.slice(prefix.length)}`;
        }
        if (volcanic) reason += ' Volcanic soil: watered trees grow faster now.';
        if (weather.tomorrow === 'drought') reason += ' A drought is coming tomorrow: I will water twice.';
        this.log(playerId, 'water', reason, null, 'rules', n === 1 ? 'Watered 1 tree.' : `Watered ${n} trees.`);
        done += n;
      }
    }

    // 3. Fertilize (Balanced: slow trees only; Turbo: every growing tree). Buy fertilizer from my budget if needed.
    if (b.style !== 'thrifty' && !quick) {
      const wants = game
        .state(playerId)
        .plots.filter((x) => x.tree && !x.tree.ready && !x.tree.isFertilized && x.tree.stage !== 'old')
        .filter((x) => b.style === 'turbo' || x.tree!.species !== 'mango');
      let bought = false;
      for (const plot of wants) {
        const t = plot.tree!;
        if (game.itemCount(playerId, 'fertilizer') < 1) {
          if (bought) break; // careful: at most one purchase per round
          const price = SHOP_ITEMS.fertilizer.price;
          act('buy', () => {
            const r = game.botBuy(playerId, 'fertilizer', 1, this.limitDay());
            bought = true;
            return [`${label(t.species)} grows slowly, so I bought 1 Fertilizer for ${r.costPanen} PANEN from my budget (burned on chain).`, 'Bought 1 Fertilizer!'];
          });
          if (!bought) {
            this.noticeOnce(playerId, price);
            break;
          }
        }
        act('fertilize', () => {
          game.fertilize(playerId, plot.plot);
          return [`Fertilized ${label(t.species)} on plot ${plot.plot + 1}: 1.5x growth for a day and a better chance of Rare or Gold fruit.`, `Fertilized the ${label(t.species)}!`];
        });
      }
    }

    // 4. Sell Common fruit when Mr. Darto pays well. Rare and Gold fruit are the player's call.
    const st = game.state(playerId);
    for (const f of mode === 'safety' ? [] : st.fruits) {
      if (f.quality !== 'common' || f.qty < 1) continue;
      const price = st.darto.prices.find((x) => x.species === f.species);
      if (!price) continue;
      const good = price.price >= price.base;
      if (!good && b.style !== 'turbo') continue;
      act('sell', () => {
        const r = game.sell(playerId, f.species, 'common', f.qty, price.price);
        const why = good ? `Mr. Darto pays ${price.price} (normal ${price.base})` : `Turbo style sells right away (price ${price.price}, normal ${price.base})`;
        return [`${why}: sold ${f.qty} Common ${label(f.species)} for ${r.expectedPanen} PANEN, paid to you.`, `Sold ${f.qty} ${label(f.species)}!`];
      });
    }
    const keep = st.fruits.filter((f) => f.quality !== 'common' && f.qty > 0);
    if (keep.length > 0 && done > 0 && mode !== 'safety') {
      this.log(playerId, 'keep', `I kept your ${keep.map((f) => `${f.qty} ${qualityName[f.quality]} ${label(f.species)}`).join(', ')}: special fruit is your decision.`);
    }

    if (done === 0 && !quick) this.log(playerId, 'check', 'Checked the garden: every tree is watered and nothing is ripe yet.');
    return done;
  }

  private noticeOnce(playerId: number, price: number): void {
    const b = this.mustRow(playerId);
    const day = this.limitDay();
    if (b.empty_notice_day === day) return;
    this.db.prepare('UPDATE bots SET empty_notice_day = ? WHERE player_id = ?').run(day, playerId);
    const spent = b.spent_day === day ? b.spent_micro : 0;
    const msg =
      b.budget_micro < toMicro(price)
        ? `My budget is empty (${fromMicro(b.budget_micro)} PANEN), so I stopped buying. Add budget if you want me to buy fertilizer.`
        : `I reached today's spending limit (${fromMicro(spent)} of ${fromMicro(b.daily_limit_micro)} PANEN). I will buy again tomorrow.`;
    this.log(playerId, 'notice', msg);
  }
}

function units(micro: number): string {
  return (BigInt(micro) * 10n ** 12n).toString();
}
