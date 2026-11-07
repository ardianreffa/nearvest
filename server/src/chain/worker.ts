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
      case 'mint_tree': {
        const snap = this.deps.treeSnapshot(p.treeId);
        const r = await chain.mintTree(p.accountId, p.species, p.quality, snap?.parent_token_id ?? null);
        db.prepare('UPDATE trees SET token_id = ? WHERE id = ?').run(r.tokenId, p.treeId);
        return { txHash: r.txHash, result: { tokenId: r.tokenId } };
      }
      case 'update_tree': {
        const snap = this.deps.treeSnapshot(p.treeId);
        if (!snap?.token_id) throw new PermanentChainError('Tree has no NFT yet');
        const r = await chain.updateTree(snap.token_id, snap.stage, snap.age_days, snap.harvest_count);
        db.prepare('UPDATE trees SET synced_stage = ? WHERE id = ?').run(snap.stage, p.treeId);
        return { txHash: r.txHash, result: { stage: snap.stage } };
      }
      case 'make_memorial': {
        const snap = this.deps.treeSnapshot(p.treeId);
        if (!snap?.token_id) throw new PermanentChainError('Tree has no NFT yet');
        const r = await chain.makeMemorial(snap.token_id);
        return { txHash: r.txHash };
      }
    }
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
