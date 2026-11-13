// The chain job queue. Game actions update the database right away (the game
// feels instant) and add a job here. One worker sends the jobs to NEAR one at
// a time, in order, so a player's account always exists before its first
// burn, and a tree is minted before it is updated. Jobs survive restarts.

import { decryptSecret } from '../crypto.ts';
import { tx, type DB, MICRO } from '../db.ts';
import type { Quality, Species, Stage } from '../rules.ts';
import { PermanentChainError, UNITS_PER_MICRO, type Chain } from './types.ts';

export type JobPayload =
  | { kind: 'create_account'; name: string; publicKey: string }
  | { kind: 'mint'; accountId: string; amountMicro: number; memo: string; ledgerId: number }
  | { kind: 'mint_reward'; accountId: string; baseMicro: number; memo: string; ledgerId: number }
  | { kind: 'burn'; accountId: string; amountMicro: number; memo: string; ledgerId: number }
  | {
      kind: 'burn_wallet';
      accountId: string;
      publicKey: string;
      nonce: string;
      maxBlockHeight: string;
      amountMicro: number;
      memo: string;
      signature: string;
      ledgerId: number;
      /** What the purchase gave, taken back if the burn fails for good. */
      grant: { item: string; qty: number; seedIds: number[] };
    }
  | { kind: 'create_bot'; mode: 'sub' | 'factory'; ownerId: string; botId: string; name: string; publicKey: string; tempSecretEnc?: string }
  /** Player sets the limit (set_bot, Google gardens only), then the bot accepts with its own key. */
  | { kind: 'bot_link'; ownerId: string; botId: string; dailyLimitMicro: number; ownerSigns: boolean }
  /** Player -> bot budget (Google gardens). */
  | { kind: 'bot_fund'; ownerId: string; botId: string; amountMicro: number; ledgerId: number }
  /** Bot -> player budget (Google gardens). */
  | { kind: 'bot_withdraw'; ownerId: string; botId: string; amountMicro: number; ledgerId: number }
  /** New daily limit (Google gardens). */
  | { kind: 'bot_limit'; ownerId: string; botId: string; dailyLimitMicro: number }
  /** A Shop purchase paid from the bot's budget, signed by the bot's key. */
  | { kind: 'bot_burn'; botId: string; amountMicro: number; memo: string; grant: { item: string; qty: number; seedIds: number[] } }
  | { kind: 'mint_tree'; treeId: number; accountId: string; species: Species; quality: Quality }
  | { kind: 'update_tree'; treeId: number }
  | { kind: 'make_memorial'; treeId: number };

export interface JobRow {
  id: number;
  player_id: number | null;
  kind: string;
  payload: string;
  status: string;
  attempts: number;
  tx_hash: string | null;
  error: string | null;
}

export const MAX_ATTEMPTS = 5;

export function enqueue(db: DB, playerId: number | null, payload: JobPayload, nowMs: number): number {
  const res = db
    .prepare('INSERT INTO chain_jobs (player_id, kind, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
    .run(playerId, payload.kind, JSON.stringify(payload), nowMs, nowMs);
  return Number(res.lastInsertRowid);
}

/** Queues a tree update unless one is already waiting (the worker sends the latest data). */
export function enqueueTreeUpdate(db: DB, playerId: number, treeId: number, nowMs: number): void {
  const waiting = db
    .prepare("SELECT 1 FROM chain_jobs WHERE status = 'pending' AND kind = 'update_tree' AND payload = ?")
    .get(JSON.stringify({ kind: 'update_tree', treeId }));
  if (!waiting) enqueue(db, playerId, { kind: 'update_tree', treeId }, nowMs);
}

interface TreeRow {
  token_id: string | null;
  account_id: string;
  stage: Stage;
  age_days: number;
  harvest_count: number;
  parent_token_id: string | null;
}

export interface WorkerDeps {
  db: DB;
  chain: Chain;
  /** Needed to rebuild wallet players' burn meta transactions. */
  panenContractId?: string;
  masterKey: string;
  now: () => number;
  /** Computes the current stage and age of a tree for syncing to the chain. */
  treeSnapshot: (treeId: number) => TreeRow | null;
  onSeasonDivisor?: (divisor: number) => void;
  log?: (msg: string) => void;
}

export class ChainWorker {
  private deps: WorkerDeps;
  private running = false;
  private timer: NodeJS.Timeout | null = null;

  constructor(deps: WorkerDeps) {
    this.deps = deps;
  }

  start(intervalMs = 500): void {
    const loop = async () => {
      await this.drain();
      this.timer = setTimeout(loop, intervalMs);
    };
    void loop();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Processes every job that is due. Safe to call repeatedly (used by tests). */
  async drain(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    let done = 0;
    try {
      for (;;) {
        const job = this.deps.db
          .prepare("SELECT * FROM chain_jobs WHERE status = 'pending' AND next_try_at <= ? ORDER BY id LIMIT 1")
          .get(this.deps.now()) as JobRow | undefined;
        if (!job) break;
        await this.runOne(job);
        done++;
      }
    } finally {
      this.running = false;
    }
    return done;
  }

  private async runOne(job: JobRow): Promise<void> {
    const { db, now } = this.deps;
    const payload = JSON.parse(job.payload) as JobPayload;
    try {
      const { txHash, result } = await this.execute(job, payload);
      db.prepare("UPDATE chain_jobs SET status = 'done', tx_hash = ?, result = ?, error = NULL, attempts = attempts + 1, updated_at = ? WHERE id = ?")
        .run(txHash, result === undefined ? null : JSON.stringify(result), now(), job.id);
      this.deps.log?.(`job ${job.id} ${job.kind} done ${txHash}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const attempts = job.attempts + 1;
      const permanent = err instanceof PermanentChainError || attempts >= MAX_ATTEMPTS;
      if (permanent) {
        // Note: a timeout after the transaction was sent can, in rare cases, mean it
        // landed anyway; retries are limited to keep that risk small on testnet.
        db.prepare("UPDATE chain_jobs SET status = 'failed', error = ?, attempts = ?, updated_at = ? WHERE id = ?")
          .run(msg.slice(0, 2000), attempts, now(), job.id);
        this.onFailed(job, payload);
        this.deps.log?.(`job ${job.id} ${job.kind} FAILED: ${msg}`);
      } else {
        const backoff = 1000 * 2 ** attempts;
        db.prepare('UPDATE chain_jobs SET error = ?, attempts = ?, next_try_at = ?, updated_at = ? WHERE id = ?')
          .run(msg.slice(0, 2000), attempts, now() + backoff, now(), job.id);
        this.deps.log?.(`job ${job.id} ${job.kind} retry ${attempts}: ${msg}`);
      }
    }
  }

  private async execute(job: JobRow, p: JobPayload): Promise<{ txHash: string; result?: unknown }> {
    const { db, chain } = this.deps;
    switch (p.kind) {
      case 'create_account': {
        const r = await chain.createPlayerAccount(p.name, p.publicKey);
        db.prepare("UPDATE players SET account_status = 'ready' WHERE id = ?").run(job.player_id);
        return { txHash: r.txHash };
      }
      case 'mint': {
        const r = await chain.mint(p.accountId, BigInt(p.amountMicro) * UNITS_PER_MICRO, p.memo);
        return { txHash: r.txHash, result: { amount: r.amount.toString() } };
      }
      case 'mint_reward': {
        const r = await chain.mintReward(p.accountId, BigInt(p.baseMicro) * UNITS_PER_MICRO, p.memo);
        const actualMicro = Number(r.amount / UNITS_PER_MICRO);
        this.reconcileLedger(p.ledgerId, actualMicro);
        if (actualMicro > 0) this.deps.onSeasonDivisor?.(Math.round(p.baseMicro / actualMicro));
        return { txHash: r.txHash, result: { amount: r.amount.toString(), actualMicro } };
      }
      case 'burn': {
        const row = db.prepare('SELECT secret_key_enc FROM players WHERE id = ?').get(job.player_id) as
          | { secret_key_enc: string }
          | undefined;
        if (!row) throw new PermanentChainError('Player not found');
        const secret = decryptSecret(row.secret_key_enc, this.deps.masterKey);
        const r = await chain.burnAsPlayer(p.accountId, secret, BigInt(p.amountMicro) * UNITS_PER_MICRO, p.memo);
        return { txHash: r.txHash };
      }
      case 'burn_wallet': {
        const r = await chain.relayWalletBurn(
          {
            accountId: p.accountId,
            publicKey: p.publicKey,
            nonce: BigInt(p.nonce),
            maxBlockHeight: BigInt(p.maxBlockHeight),
            amount: BigInt(p.amountMicro) * UNITS_PER_MICRO,
            memo: p.memo,
            panenContractId: this.deps.panenContractId ?? 'panen.nearvest.testnet',
          },
          p.signature,
        );
        return { txHash: r.txHash };
      }
      case 'create_bot': {
        const botKey = this.botPublic(job.player_id);
        const r =
          p.mode === 'sub'
            ? await chain.createSubBot(p.ownerId, this.playerSecret(job.player_id), p.botId, botKey)
            : await chain.createFactoryBot(p.name, decryptSecret(p.tempSecretEnc!, this.deps.masterKey), botKey);
        db.prepare("UPDATE bots SET status = 'linking' WHERE player_id = ? AND status = 'creating'").run(job.player_id);
        return { txHash: r.txHash };
      }
      case 'bot_link': {
        let txHash = '';
        if (p.ownerSigns) {
          const r = await chain.callAs(p.ownerId, this.playerSecret(job.player_id), this.panen(), [
            { method: 'set_bot', args: { bot_id: p.botId, daily_limit: units(p.dailyLimitMicro) }, deposit: 1n },
          ]);
          txHash = r.txHash;
        } else {
          // Wallet gardens: the player's wallet sent set_bot; wait until it is on chain.
          const info = await chain.botInfo(p.botId);
          if (!info || info.ownerId !== p.ownerId) throw new Error('Waiting for the wallet to link the bot');
        }
        const r = await chain.callAs(p.botId, this.botSecret(job.player_id), this.panen(), [
          { method: 'bot_accept', args: { owner_id: p.ownerId } },
        ]);
        db.prepare("UPDATE bots SET status = 'ready' WHERE player_id = ?").run(job.player_id);
        return { txHash: txHash || r.txHash, result: { acceptTx: r.txHash } };
      }
      case 'bot_fund': {
        const r = await chain.callAs(p.ownerId, this.playerSecret(job.player_id), this.panen(), [
          { method: 'ft_transfer', args: { receiver_id: p.botId, amount: units(p.amountMicro), memo: 'TaniBot budget' }, deposit: 1n },
        ]);
        return { txHash: r.txHash };
      }
      case 'bot_withdraw': {
        const r = await chain.callAs(p.ownerId, this.playerSecret(job.player_id), this.panen(), [
          { method: 'bot_withdraw', args: { bot_id: p.botId, amount: units(p.amountMicro) }, deposit: 1n },
        ]);
        return { txHash: r.txHash };
      }
      case 'bot_limit': {
        const r = await chain.callAs(p.ownerId, this.playerSecret(job.player_id), this.panen(), [
          { method: 'set_bot', args: { bot_id: p.botId, daily_limit: units(p.dailyLimitMicro) }, deposit: 1n },
        ]);
        return { txHash: r.txHash };
      }
      case 'bot_burn': {
        const r = await chain.callAs(p.botId, this.botSecret(job.player_id), this.panen(), [
          { method: 'burn', args: { amount: units(p.amountMicro), memo: p.memo } },
        ]);
        return { txHash: r.txHash };
      }
      case 'mint_tree': {
        const snap = this.deps.treeSnapshot(p.treeId);
        const r = await chain.mintTree(p.accountId, p.species, p.quality, snap?.parent_token_id ?? null);
        db.prepare('UPDATE trees SET token_id = ? WHERE id = ?').run(r.tokenId, p.treeId);
        // The contract always mints a Seed of age 0. A tree that is already further (a judge
        // garden's grown trees, or a mint that landed late) gets its real data right away.
        let updateTx: string | undefined;
        if (snap && (snap.stage !== 'seed' || snap.age_days > 0 || snap.harvest_count > 0)) {
          updateTx = await this.sendTreeData(p.treeId, r.tokenId, snap, job.id, false);
        }
        return { txHash: r.txHash, result: { tokenId: r.tokenId, ...(updateTx ? { updateTx } : {}) } };
      }
      case 'update_tree': {
        const snap = this.deps.treeSnapshot(p.treeId);
        if (!snap?.token_id) throw new PermanentChainError('Tree has no NFT yet');
        const r = await chain.updateTree(snap.token_id, snap.stage, snap.age_days, snap.harvest_count);
        db.prepare('UPDATE trees SET synced_stage = ? WHERE id = ?').run(snap.stage, p.treeId);
        return { txHash: r.txHash, result: { stage: snap.stage, ageDays: snap.age_days, harvestCount: snap.harvest_count } };
      }
      case 'make_memorial': {
        const snap = this.deps.treeSnapshot(p.treeId);
        if (!snap?.token_id) throw new PermanentChainError('Tree has no NFT yet');
        // The contract refuses every update of a Memorial Tree, so its last stage, age and
        // harvest count (as they were when it died) go to the NFT first.
        const updateTx = await this.sendTreeData(p.treeId, snap.token_id, snap, job.id, true);
        const r = await chain.makeMemorial(snap.token_id);
        return { txHash: r.txHash, result: { ...(updateTx ? { updateTx } : {}) } };
      }
    }
  }

  /**
   * Sends a tree's stage, age and harvest count as an extra step of a mint / memorial job.
   * A refusal by the contract never fails the job (a tree that is already a Memorial is left
   * as it is). A network error fails it only with `retry` (memorial: the whole job runs
   * again); after a mint it must not, because the mint would run twice: the 20 s stage sync
   * sends the data later instead.
   */
  private async sendTreeData(treeId: number, tokenId: string, snap: TreeRow, jobId: number, retry: boolean): Promise<string | undefined> {
    try {
      const u = await this.deps.chain.updateTree(tokenId, snap.stage, snap.age_days, snap.harvest_count);
      this.deps.db.prepare('UPDATE trees SET synced_stage = ? WHERE id = ?').run(snap.stage, treeId);
      return u.txHash;
    } catch (err) {
      if (retry && !(err instanceof PermanentChainError)) throw err;
      this.deps.log?.(`job ${jobId} tree ${treeId} data not sent: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  }

  private panen(): string {
    return this.deps.panenContractId ?? 'panen.nearvest.testnet';
  }

  private playerSecret(playerId: number | null): string {
    const row = this.deps.db.prepare('SELECT secret_key_enc FROM players WHERE id = ?').get(playerId) as { secret_key_enc: string } | undefined;
    if (!row?.secret_key_enc) throw new PermanentChainError('This player has no game-held key');
    return decryptSecret(row.secret_key_enc, this.deps.masterKey);
  }

  private botSecret(playerId: number | null): string {
    const row = this.deps.db.prepare('SELECT secret_key_enc FROM bots WHERE player_id = ?').get(playerId) as { secret_key_enc: string } | undefined;
    if (!row) throw new PermanentChainError('TaniBot not found');
    return decryptSecret(row.secret_key_enc, this.deps.masterKey);
  }

  private botPublic(playerId: number | null): string {
    const row = this.deps.db.prepare('SELECT public_key FROM bots WHERE player_id = ?').get(playerId) as { public_key: string } | undefined;
    if (!row) throw new PermanentChainError('TaniBot not found');
    return row.public_key;
  }

  /** The contract decides the final reward (Season rule); fix the local balance if it differs. */
  private reconcileLedger(ledgerId: number, actualMicro: number): void {
    const { db } = this.deps;
    tx(db, () => {
      const row = db.prepare('SELECT player_id, amount_micro FROM ledger WHERE id = ?').get(ledgerId) as
        | { player_id: number; amount_micro: number }
        | undefined;
      if (!row || row.amount_micro === actualMicro) return;
      db.prepare('UPDATE ledger SET amount_micro = ? WHERE id = ?').run(actualMicro, ledgerId);
      db.prepare('UPDATE players SET balance_micro = balance_micro + ? WHERE id = ?').run(
        actualMicro - row.amount_micro,
        row.player_id,
      );
    });
  }

  /** A wallet purchase whose burn failed: remove what it gave (what is left of it). */
  private takeBack(playerId: number | null, grant: { item: string; qty: number; seedIds: number[] }): void {
    const { db } = this.deps;
    if (playerId === null) return;
    for (const id of grant.seedIds) db.prepare('DELETE FROM seeds WHERE id = ? AND player_id = ?').run(id, playerId);
    if (grant.seedIds.length === 0) {
      db.prepare('UPDATE items SET qty = MAX(0, qty - ?) WHERE player_id = ? AND item = ?').run(grant.qty, playerId, grant.item);
    }
  }

  /** Undo the local balance change of a token job that failed for good. */
  private onFailed(job: JobRow, p: JobPayload): void {
    const { db } = this.deps;
    if (p.kind === 'create_account') {
      db.prepare("UPDATE players SET account_status = 'failed' WHERE id = ?").run(job.player_id);
      return;
    }
    if (p.kind === 'burn_wallet') this.takeBack(job.player_id, p.grant);
    if (p.kind === 'create_bot' || p.kind === 'bot_link') {
      db.prepare("UPDATE bots SET status = 'failed', enabled = 0 WHERE player_id = ?").run(job.player_id);
      return;
    }
    if (p.kind === 'bot_burn') {
      // The purchase did not happen on chain: give the budget back and take the item back.
      this.takeBack(job.player_id, p.grant);
      db.prepare('UPDATE bots SET budget_micro = budget_micro + ?, spent_micro = MAX(0, spent_micro - ?) WHERE player_id = ?').run(p.amountMicro, p.amountMicro, job.player_id);
      return;
    }
    if (p.kind === 'bot_fund' || p.kind === 'bot_withdraw') {
      // Undo the local move between the player's balance and the bot's budget.
      const toBot = p.kind === 'bot_fund' ? -p.amountMicro : p.amountMicro;
      tx(db, () => {
        db.prepare('UPDATE bots SET budget_micro = budget_micro + ? WHERE player_id = ?').run(toBot, job.player_id);
        db.prepare('UPDATE players SET balance_micro = balance_micro - ? WHERE id = ?').run(toBot, job.player_id);
        db.prepare("UPDATE ledger SET amount_micro = 0, note = COALESCE(note, '') || ' (failed on chain, reverted)' WHERE id = ?").run(p.ledgerId);
      });
      return;
    }
    if (p.kind === 'mint' || p.kind === 'mint_reward' || p.kind === 'burn' || p.kind === 'burn_wallet') {
      tx(db, () => {
        const row = db.prepare('SELECT player_id, amount_micro FROM ledger WHERE id = ?').get(p.ledgerId) as
          | { player_id: number; amount_micro: number }
          | undefined;
        if (!row || row.amount_micro === 0) return;
        db.prepare('UPDATE players SET balance_micro = balance_micro - ? WHERE id = ?').run(row.amount_micro, row.player_id);
        db.prepare("UPDATE ledger SET amount_micro = 0, note = COALESCE(note, '') || ' (failed on chain, reverted)' WHERE id = ?").run(p.ledgerId);
      });
    }
  }
}

export { MICRO };

/** Micro-PANEN (6 decimals, the database unit) -> smallest on-chain units (18 decimals), as a string. */
function units(micro: number): string {
  return (BigInt(micro) * UNITS_PER_MICRO).toString();
}
