// What the game needs from the blockchain. Two implementations:
// `near.ts` (real NEAR testnet) and `fake.ts` (tests and offline dev).

import type { Quality, Species, Stage } from '../rules.ts';

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

export interface Chain {
  accountExists(accountId: string): Promise<boolean>;
  /** Creates `<name>.nearvest.testnet` through the factory; the game pays. */
  createPlayerAccount(name: string, publicKey: string): Promise<TxResult>;
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
}

/** An error that will not go away by retrying (for example a contract panic). */
export class PermanentChainError extends Error {}

/** 1 PANEN = 10^18 smallest units; the server stores micro-PANEN (10^6). */
export const UNITS_PER_MICRO = 10n ** 12n;
