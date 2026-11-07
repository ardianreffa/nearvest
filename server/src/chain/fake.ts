// In-memory chain for tests and offline development. Mirrors the contract rules
// that matter to the game: minter-only mint, Season divisor, burn balance check.

import { randomBytes } from 'node:crypto';
import type { Quality, Species, Stage } from '../rules.ts';
import { burnDelegateHash, isGameKey, verifySignature, type AccessKeyPermission, type BurnDelegate } from '../wallet.ts';
import { KeyPair } from 'near-api-js';
import { BOT_KEY_METHODS, PermanentChainError, type Chain, type ChainBotInfo, type ChainVillageStats, type FnCall, type TxResult } from './types.ts';

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
  /** Access keys of wallet accounts: `${accountId} ${publicKey}`. */
  accessKeys = new Map<string, { nonce: bigint; permission: AccessKeyPermission }>();
  height = 1000n;
  panenContractId = 'panen.nearvest.testnet';
  /** Clock for the TaniBot daily limit (tests point it at the test clock). */
  now: () => number = () => Date.now();
  /** TaniBot records, like the contract's `bot:<account>` keys. */
  bots = new Map<string, { ownerId: string; accepted: boolean; dailyLimit: bigint; day: number; spentToday: bigint }>();

  /** Tests: give a wallet account a key (as if the player's wallet added it). */
  addAccessKey(accountId: string, publicKey: string, permission: AccessKeyPermission, nonce = 5n): void {
    this.accounts.add(accountId);
    this.accessKeys.set(`${accountId} ${publicKey}`, { nonce, permission });
  }

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

  async createPlayerAccount(name: string, publicKey: string, depositNear?: string): Promise<TxResult> {
    this.record('create_player', { name, publicKey, depositNear });
    const id = `${name}.nearvest.testnet`;
    if (this.accounts.has(id)) throw new PermanentChainError('Account already exists');
    this.accounts.add(id);
    // The factory adds the given key as the account's full access key.
    this.accessKeys.set(`${id} ${publicKey}`, { nonce: 0n, permission: 'FullAccess' });
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

  async viewAccessKey(accountId: string, publicKey: string) {
    return this.accessKeys.get(`${accountId} ${publicKey}`) ?? null;
  }

  async blockHeight(): Promise<bigint> {
    return this.height;
  }

  async ftBalanceOf(accountId: string): Promise<bigint> {
    return this.balances.get(accountId) ?? 0n;
  }

  /** Same checks as the NEAR runtime: key permission, signature, nonce, expiry, balance. */
  async relayWalletBurn(d: BurnDelegate, signature: string) {
    this.record('relay_burn', { accountId: d.accountId, amount: d.amount, memo: d.memo, nonce: d.nonce });
    const key = this.accessKeys.get(`${d.accountId} ${d.publicKey}`);
    if (!key || !isGameKey(key.permission, this.panenContractId)) throw new PermanentChainError('AccessKeyNotFound');
    if (!verifySignature(d.publicKey, burnDelegateHash(d), signature)) throw new PermanentChainError('DelegateActionInvalidSignature');
    if (d.nonce <= key.nonce) throw new PermanentChainError('DelegateActionInvalidNonce');
    if (d.maxBlockHeight < this.height) throw new PermanentChainError('DelegateActionExpired');
    key.nonce = d.nonce;
    const balance = this.balances.get(d.accountId) ?? 0n;
    if (balance < d.amount) throw new PermanentChainError("The account doesn't have enough balance");
    this.balances.set(d.accountId, balance - d.amount);
    this.totalBurned += d.amount;
    return this.hash();
  }

  // ---------- TaniBot (mirrors the PANEN contract rules) ----------

  private utcDay(): number {
    return Math.floor(this.now() / 86_400_000);
  }

  /** Same checks as the contract for calls signed by `signerId` (deposit 1 = full access key). */
  async callAs(signerId: string, secretKey: string, receiverId: string, calls: FnCall[]): Promise<TxResult> {
    this.record('call_as', { signerId, receiverId, calls: calls.map((c) => ({ ...c, deposit: c.deposit?.toString() })) });
    if (!this.accounts.has(signerId)) throw new PermanentChainError(`Account ${signerId} does not exist`);
    const pub = KeyPair.fromString(secretKey as `ed25519:${string}`).getPublicKey().toString();
    const key = this.accessKeys.get(`${signerId} ${pub}`);
    if (!key) throw new PermanentChainError('AccessKeyNotFound');
    for (const c of calls) {
      if (key.permission !== 'FullAccess') {
        if (key.permission.receiverId !== receiverId || !key.permission.methodNames.includes(c.method)) throw new PermanentChainError('MethodNameMismatch');
        if ((c.deposit ?? 0n) > 0n) throw new PermanentChainError('DepositWithFunctionCall');
      }
    }
    // Apply all calls on a copy so a failing call changes nothing (like a reverted receipt).
    const balances = new Map(this.balances);
    const bots = new Map([...this.bots].map(([k, v]) => [k, { ...v }]));
    let burned = 0n;
    const one = (deposit?: bigint) => {
      if (deposit !== 1n) throw new PermanentChainError('Requires attached deposit of exactly 1 yoctoNEAR');
    };
    const bal = (a: string) => balances.get(a) ?? 0n;
    for (const c of calls) {
      const a = c.args as Record<string, string>;
      const bot = bots.get(signerId);
      switch (c.method) {
        case 'set_bot': {
          one(c.deposit);
          const r = bots.get(a.bot_id);
          if (a.bot_id === signerId) throw new PermanentChainError('A player cannot be their own bot');
          if (r?.accepted && r.ownerId !== signerId) throw new PermanentChainError('This bot belongs to another player');
          bots.set(a.bot_id, r?.accepted ? { ...r, dailyLimit: BigInt(a.daily_limit) } : { ownerId: signerId, accepted: false, dailyLimit: BigInt(a.daily_limit), day: 0, spentToday: 0n });
          break;
        }
        case 'bot_accept': {
          if (!bot) throw new PermanentChainError('No player has linked this bot');
          if (bot.ownerId !== a.owner_id) throw new PermanentChainError('This bot was linked by another player');
          bot.accepted = true;
          break;
        }
        case 'ft_transfer': {
          one(c.deposit);
          if (bot?.accepted) throw new PermanentChainError('A TaniBot cannot transfer tokens');
          const amount = BigInt(a.amount);
          if (bal(signerId) < amount) throw new PermanentChainError("The account doesn't have enough balance");
          balances.set(signerId, bal(signerId) - amount);
          balances.set(a.receiver_id, bal(a.receiver_id) + amount);
          break;
        }
        case 'burn': {
          const amount = BigInt(a.amount);
          if (bot?.accepted) {
            const day = this.utcDay();
            if (bot.day !== day) Object.assign(bot, { day, spentToday: 0n });
            if (bot.spentToday + amount > bot.dailyLimit) throw new PermanentChainError('TaniBot daily spending limit reached');
            bot.spentToday += amount;
          }
          if (bal(signerId) < amount) throw new PermanentChainError("The account doesn't have enough balance");
          balances.set(signerId, bal(signerId) - amount);
          burned += amount;
          break;
        }
        case 'bot_withdraw': {
          one(c.deposit);
          const r = bots.get(a.bot_id);
          if (!r || r.ownerId !== signerId) throw new PermanentChainError("Only the bot's player can withdraw");
          if (!r.accepted) throw new PermanentChainError('This bot has not accepted its player');
          const amount = BigInt(a.amount);
          if (bal(a.bot_id) < amount) throw new PermanentChainError("The account doesn't have enough balance");
          balances.set(a.bot_id, bal(a.bot_id) - amount);
          balances.set(signerId, bal(signerId) + amount);
          break;
        }
        default:
          throw new PermanentChainError(`Unknown method ${c.method}`);
      }
    }
    this.balances = balances;
    this.bots = bots;
    this.totalBurned += burned;
    return this.hash();
  }

  private addBotKey(botId: string, botPublicKey: string): void {
    this.accounts.add(botId);
    this.accessKeys.set(`${botId} ${botPublicKey}`, {
      nonce: 0n,
      permission: { receiverId: this.panenContractId, methodNames: [...BOT_KEY_METHODS], allowance: '50000000000000000000000' },
    });
  }

  async createSubBot(ownerId: string, ownerSecret: string, botId: string, botPublicKey: string): Promise<TxResult> {
    this.record('create_sub_bot', { ownerId, botId, signedWithKey: ownerSecret.length > 0 });
    if (!this.accounts.has(ownerId)) throw new PermanentChainError(`Account ${ownerId} does not exist`);
    if (!botId.endsWith(`.${ownerId}`)) throw new PermanentChainError('Only the parent account can create a sub-account');
    this.addBotKey(botId, botPublicKey);
    return this.hash();
  }

  async createFactoryBot(name: string, tempSecret: string, botPublicKey: string): Promise<TxResult> {
    this.record('create_factory_bot', { name, temp: tempSecret.length > 0 });
    const botId = `${name}.nearvest.testnet`;
    if (this.accounts.has(botId) && !this.accessKeys.has(`${botId} ${botPublicKey}`)) throw new PermanentChainError('Account already exists');
    this.addBotKey(botId, botPublicKey);
    return this.hash();
  }

  async botInfo(botId: string): Promise<ChainBotInfo | null> {
    const r = this.bots.get(botId);
    if (!r) return null;
    const spentToday = r.day === this.utcDay() ? r.spentToday : 0n;
    return { ownerId: r.ownerId, accepted: r.accepted, dailyLimit: r.dailyLimit, spentToday, balance: this.balances.get(botId) ?? 0n };
  }

  /** Tests: the full access key a game-held player key represents (so callAs can find it). */
  addPlayerKey(accountId: string, secretKey: string): void {
    const pub = KeyPair.fromString(secretKey as `ed25519:${string}`).getPublicKey().toString();
    this.accounts.add(accountId);
    this.accessKeys.set(`${accountId} ${pub}`, { nonce: 0n, permission: 'FullAccess' });
  }
}
