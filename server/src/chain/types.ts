// What the game needs from the blockchain. Two implementations:
// `near.ts` (real NEAR testnet) and `fake.ts` (tests and offline dev).

import type { Quality, Species, Stage } from '../rules.ts';
import type { AccessKeyPermission, BurnDelegate } from '../wallet.ts';

export interface TxResult {
  txHash: string;
}

export interface ChainVillageStats {
  totalMinted: bigint; // smallest units (18 decimals)
  totalBurned: bigint;
  circulatingSupply: bigint;
  season: number;
  rewardDivisor: number;
  nextSeasonAt: bigint | null;
}

/** A function call inside a meta transaction. */
export interface FnCall {
  method: string;
  args: Record<string, unknown>;
  /** yoctoNEAR; only 0 or 1 (full access keys) is used. */
  deposit?: bigint;
}

/** What the $PANEN contract knows about a TaniBot (`bot_info`). */
export interface ChainBotInfo {
  ownerId: string;
  accepted: boolean;
  dailyLimit: bigint;
  spentToday: bigint;
  balance: bigint;
}

/** TaniBot's only key: it can call these methods on the PANEN contract, nothing else. */
export const BOT_KEY_METHODS = ['burn', 'bot_accept'];

export interface Chain {
  accountExists(accountId: string): Promise<boolean>;
  /** Creates `<name>.nearvest.testnet` through the factory; the game pays. */
  createPlayerAccount(name: string, publicKey: string, depositNear?: string): Promise<TxResult>;
  /** Exact mint (welcome pack, check-in). */
  mint(accountId: string, amount: bigint, memo: string): Promise<TxResult & { amount: bigint }>;
  /** Harvest sale: the contract applies the Season rule and returns the minted amount. */
  mintReward(accountId: string, baseAmount: bigint, memo: string): Promise<TxResult & { amount: bigint }>;
  /** Burns the player's own tokens with a meta transaction (the game pays gas). */
  burnAsPlayer(accountId: string, secretKey: string, amount: bigint, memo: string): Promise<TxResult>;
  mintTree(
    receiverId: string,
    species: Species,
    quality: Quality,
    parentTokenId: string | null,
  ): Promise<TxResult & { tokenId: string }>;
  updateTree(tokenId: string, stage: Stage, ageDays: number, harvestCount: number): Promise<TxResult>;
  makeMemorial(tokenId: string): Promise<TxResult>;
  villageStats(): Promise<ChainVillageStats>;
  treeSupply(): Promise<number>;
  /** An access key of an account, or null when the key is not on that account. */
  viewAccessKey(accountId: string, publicKey: string): Promise<{ nonce: bigint; permission: AccessKeyPermission } | null>;
  /** Latest final block height (for meta transaction expiry). */
  blockHeight(): Promise<bigint>;
  /** $PANEN balance in smallest units. */
  ftBalanceOf(accountId: string): Promise<bigint>;
  /** Relays a burn signed in the player's browser with their game key (wallet players). The game pays gas. */
  relayWalletBurn(d: BurnDelegate, signature: string): Promise<TxResult>;
  /** Function calls on `receiverId` signed by `signerId`'s key as a meta transaction; the game relays and pays gas. */
  callAs(signerId: string, secretKey: string, receiverId: string, calls: FnCall[]): Promise<TxResult>;
  /**
   * Google gardens: the player's account creates `bot.<player>` whose only key is
   * the bot's function call key (BOT_KEY_METHODS on PANEN). The game funds it.
   */
  createSubBot(ownerId: string, ownerSecret: string, botId: string, botPublicKey: string): Promise<TxResult>;
  /**
   * Wallet gardens: the factory creates `<name>.<factory>` with a temporary full
   * access key, which then adds the bot's function call key and deletes itself.
   */
  createFactoryBot(name: string, tempSecret: string, botPublicKey: string): Promise<TxResult>;
  botInfo(botId: string): Promise<ChainBotInfo | null>;
}

/** An error that will not go away by retrying (for example a contract panic). */
export class PermanentChainError extends Error {}

/** 1 PANEN = 10^18 smallest units; the server stores micro-PANEN (10^6). */
export const UNITS_PER_MICRO = 10n ** 12n;
