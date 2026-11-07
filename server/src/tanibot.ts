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
import { SHOP_ITEMS, SPECIES, type Quality, type Species } from './rules.ts';

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

  log(playerId: number, action: string, reason: string, jobId: number | null = null): void {
    this.db
      .prepare('INSERT INTO bot_log (player_id, action, reason, job_id, brain, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(playerId, action, reason, jobId, 'rules', this.d.now());
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
  setup(playerId: number, opts: { dailyLimit?: number; budget?: number }) {
    const p = this.d.game.getPlayer(playerId);
    if (p.account_status !== 'ready') throw new GameError('Your NEAR account is still being created. Try again in a moment.', 409);
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
    });
    return {
      bot: this.view(playerId),
      // Wallet gardens: the wallet signs this (1 yoctoNEAR proves it is the player's full access key).
      walletCalls: wallet
        ? [{ receiverId: this.d.panenContractId, method: 'set_bot', args: { bot_id: botId, daily_limit: units(limitMicro) }, deposit: '1' }]
        : null,
    };
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
  settings(playerId: number, s: { enabled?: unknown; style?: unknown }) {
    const b = this.mustRow(playerId);
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
      brain: 'rules' as const,
      budget: fromMicro(b.budget_micro),
      dailyLimit: fromMicro(b.daily_limit_micro),
      spentToday: fromMicro(spent),
      remainingToday: fromMicro(Math.max(0, b.daily_limit_micro - spent)),
      nextRunAt: b.enabled === 1 && b.status === 'ready' ? b.next_run_at : null,
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
  tick(): number {
    const now = this.d.now();
    const due = this.db
      .prepare("SELECT player_id FROM bots WHERE status = 'ready' AND enabled = 1 AND next_run_at <= ?")
      .all(now) as { player_id: number }[];
    for (const { player_id } of due) {
      try {
        this.run(player_id);
      } catch (err) {
        this.log(player_id, 'notice', `Something went wrong this round, I will try again later. (${err instanceof Error ? err.message : err})`);
      }
      const p = this.d.game.getPlayer(player_id);
      this.db.prepare('UPDATE bots SET next_run_at = ? WHERE player_id = ?').run(nextRunAt(now, p.demo === 1), player_id);
    }
    return due.length;
  }

  // ---------- Brain: simple rules (fallback when the AI is off or fails) ----------

  /** One round of work. Returns the number of actions taken. */
  run(playerId: number): number {
    const b = this.mustRow(playerId);
    const game = this.d.game;
    let done = 0;
    const act = (action: string, fn: () => string | null) => {
      const before = this.lastJobId();
      try {
        const reason = fn();
        if (reason) {
          this.log(playerId, action, reason, this.jobSince(playerId, before));
          done++;
        }
      } catch (err) {
        if (err instanceof GameError && err.details?.code === 'storage_full') {
          this.log(playerId, 'notice', 'An old tree has a superior seed, but your seed storage is full. I left the seed on the tree for you to decide.');
        } else if (!(err instanceof GameError)) throw err;
      }
    };

    // 1. Harvest everything that is ripe.
    for (const plot of game.state(playerId).plots) {
      const t = plot.tree;
      if (t?.ready) {
        act('harvest', () => {
          const r = game.harvest(playerId, plot.plot);
          if (r.kind === 'fruit') return `${label(r.species)} on plot ${plot.plot + 1} was ripe: harvested 1 ${qualityName[r.quality]} fruit (+${r.xp} XP).`;
          return `The old ${label(r.species)} tree on plot ${plot.plot + 1} gave its superior seed and became a Memorial Tree.`;
        });
      }
    }

    // 2. Water every thirsty tree.
    for (const plot of game.state(playerId).plots) {
      const t = plot.tree;
      if (t && !t.wateredToday) {
        act('water', () => {
          game.water(playerId, plot.plot);
          return `${label(t.species)} on plot ${plot.plot + 1} was dry: watered it (watering is free and happens off-chain).`;
        });
      }
    }

    // 3. Fertilize (Balanced: slow trees only; Turbo: every growing tree). Buy fertilizer from my budget if needed.
    if (b.style !== 'thrifty') {
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
            return `${label(t.species)} grows slowly, so I bought 1 Fertilizer for ${r.costPanen} PANEN from my budget (burned on chain).`;
          });
          if (!bought) {
            this.noticeOnce(playerId, price);
            break;
          }
        }
        act('fertilize', () => {
          game.fertilize(playerId, plot.plot);
          return `Fertilized ${label(t.species)} on plot ${plot.plot + 1}: 1.5x growth for a day and a better chance of Rare or Gold fruit.`;
        });
      }
    }

    // 4. Sell Common fruit when Mr. Darto pays well. Rare and Gold fruit are the player's call.
    const st = game.state(playerId);
    for (const f of st.fruits) {
      if (f.quality !== 'common' || f.qty < 1) continue;
      const price = st.darto.prices.find((x) => x.species === f.species);
      if (!price) continue;
      const good = price.price >= price.base;
      if (!good && b.style !== 'turbo') continue;
      act('sell', () => {
        const r = game.sell(playerId, f.species, 'common', f.qty, price.price);
        const why = good ? `Mr. Darto pays ${price.price} (normal ${price.base})` : `Turbo style sells right away (price ${price.price}, normal ${price.base})`;
        return `${why}: sold ${f.qty} Common ${label(f.species)} for ${r.expectedPanen} PANEN, paid to you.`;
      });
    }
    const keep = st.fruits.filter((f) => f.quality !== 'common' && f.qty > 0);
    if (keep.length > 0 && done > 0) {
      this.log(playerId, 'keep', `I kept your ${keep.map((f) => `${f.qty} ${qualityName[f.quality]} ${label(f.species)}`).join(', ')}: special fruit is your decision.`);
    }

    if (done === 0) this.log(playerId, 'check', 'Checked the garden: every tree is watered and nothing is ripe yet.');
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
