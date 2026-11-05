// In-memory chain for tests and offline development. Mirrors the contract rules
// that matter to the game: minter-only mint, Season divisor, burn balance check.

import { randomBytes } from 'node:crypto';
import type { Quality, Species, Stage } from '../rules.ts';
import { PermanentChainError, type Chain, type ChainVillageStats, type TxResult } from './types.ts';

interface FakeTree {
  owner: string;
  species: Species;
  quality: Quality;
  stage: Stage;
  ageDays: number;
  harvestCount: number;
  parent: string | null;
  memorial: boolean;
}

export class FakeChain implements Chain {
  accounts = new Set<string>();
  balances = new Map<string, bigint>();
  trees = new Map<string, FakeTree>();
  totalMinted = 0n;
  totalBurned = 0n;
  /** Tests can change the Season divisor directly. */
  rewardDivisor = 1;
  calls: { method: string; args: unknown }[] = [];
  /** Make the next N calls fail with a temporary error (retry tests). */
  failNext = 0;

  private hash(): TxResult {
    return { txHash: 'fake' + randomBytes(8).toString('hex') };
  }

  private record(method: string, args: unknown): void {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error('fake network error');
    }
    this.calls.push({ method, args });
  }

  async accountExists(accountId: string): Promise<boolean> {
    return this.accounts.has(accountId);
  }

  async createPlayerAccount(name: string, publicKey: string): Promise<TxResult> {
    this.record('create_player', { name, publicKey });
    const id = `${name}.nearvest.testnet`;
    if (this.accounts.has(id)) throw new PermanentChainError('Account already exists');
    this.accounts.add(id);
    return this.hash();
  }

  private deposit(accountId: string, amount: bigint): void {
    this.balances.set(accountId, (this.balances.get(accountId) ?? 0n) + amount);
    this.totalMinted += amount;
  }

  async mint(accountId: string, amount: bigint, memo: string) {
    this.record('mint', { accountId, amount, memo });
    this.deposit(accountId, amount);
    return { ...this.hash(), amount };
  }

  async mintReward(accountId: string, baseAmount: bigint, memo: string) {
    this.record('mint_reward', { accountId, baseAmount, memo });
    const amount = baseAmount / BigInt(this.rewardDivisor);
    this.deposit(accountId, amount);
    return { ...this.hash(), amount };
  }

  async burnAsPlayer(accountId: string, secretKey: string, amount: bigint, memo: string) {
    this.record('burn', { accountId, amount, memo, signedWithKey: secretKey.length > 0 });
    if (!this.accounts.has(accountId)) throw new PermanentChainError('Account does not exist');
    const balance = this.balances.get(accountId) ?? 0n;
    if (balance < amount) throw new PermanentChainError("The account doesn't have enough balance");
    this.balances.set(accountId, balance - amount);
    this.totalBurned += amount;
    return this.hash();
  }

  async mintTree(receiverId: string, species: Species, quality: Quality, parentTokenId: string | null) {
    this.record('mint_tree', { receiverId, species, quality, parentTokenId });
    const tokenId = String(this.trees.size + 1);
    this.trees.set(tokenId, {
      owner: receiverId,
      species,
      quality,
      stage: 'seed',
      ageDays: 0,
      harvestCount: 0,
      parent: parentTokenId,
      memorial: false,
    });
    return { ...this.hash(), tokenId };
  }

  async updateTree(tokenId: string, stage: Stage, ageDays: number, harvestCount: number) {
    this.record('update_tree', { tokenId, stage, ageDays, harvestCount });
    const tree = this.trees.get(tokenId);
    if (!tree) throw new PermanentChainError('Tree not found');
    if (tree.memorial) throw new PermanentChainError('Memorial trees cannot be updated');
    Object.assign(tree, { stage, ageDays, harvestCount });
    return this.hash();
  }

  async makeMemorial(tokenId: string) {
    this.record('make_memorial', { tokenId });
    const tree = this.trees.get(tokenId);
    if (!tree) throw new PermanentChainError('Tree not found');
    tree.memorial = true;
    return this.hash();
  }

  async villageStats(): Promise<ChainVillageStats> {
    return {
      totalMinted: this.totalMinted,
      totalBurned: this.totalBurned,
      circulatingSupply: this.totalMinted - this.totalBurned,
      season: Math.log2(this.rewardDivisor) + 1,
      rewardDivisor: this.rewardDivisor,
      nextSeasonAt: null,
    };
  }

  async treeSupply(): Promise<number> {
    return this.trees.size;
  }
}
