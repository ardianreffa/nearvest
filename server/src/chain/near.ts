// Real NEAR testnet implementation. The game account (game.nearvest.testnet)
// signs every transaction and pays all gas. Player actions that must come from
// the player (burning their own $PANEN) are signed by the player's key as a
// meta transaction (NEP-366) and relayed by the game account.

import { Account, JsonRpcProvider, KeyPairSigner, actions, nearToYocto, teraToGas } from 'near-api-js';
import type { Quality, Species, Stage } from '../rules.ts';
import { PermanentChainError, type Chain, type ChainVillageStats, type TxResult } from './types.ts';

const GAS = teraToGas('30');
const FACTORY_GAS = teraToGas('60');

export interface NearChainOptions {
  rpcUrl: string;
  factoryAccountId: string;
  gameAccountId: string;
  gamePrivateKey: string;
  panenContractId: string;
  pohonContractId: string;
  playerAccountDepositNear: string;
}

// The RPC response shape is large; we only read these parts.
interface Outcome {
  status: { SuccessValue?: string; Failure?: unknown; SuccessReceiptId?: string } | string;
}
interface TxResponse {
  transaction?: { hash: string };
  transaction_outcome?: { id: string; outcome: Outcome };
  receipts_outcome?: { id: string; outcome: Outcome }[];
  status?: { SuccessValue?: string; Failure?: unknown } | string;
}

function failureOf(res: TxResponse): unknown {
  if (res.status && typeof res.status === 'object' && 'Failure' in res.status && res.status.Failure) {
    return res.status.Failure;
  }
  for (const r of res.receipts_outcome ?? []) {
    const s = r.outcome.status;
    if (s && typeof s === 'object' && 'Failure' in s && s.Failure) return s.Failure;
  }
  return null;
}

function returnValue<T>(res: TxResponse): T | null {
  const s = res.status;
  if (s && typeof s === 'object' && s.SuccessValue) {
    return JSON.parse(Buffer.from(s.SuccessValue, 'base64').toString('utf8')) as T;
  }
  return null;
}

function check(res: TxResponse): TxResult {
  const hash = res.transaction?.hash ?? res.transaction_outcome?.id ?? 'unknown';
  const failure = failureOf(res);
  if (failure) {
    throw new PermanentChainError(`Transaction ${hash} failed: ${JSON.stringify(failure)}`);
  }
  return { txHash: hash };
}

/** Errors thrown by the RPC client for failed execution are permanent; network errors are not. */
function classify(err: unknown): never {
  if (err instanceof PermanentChainError) throw err;
  const msg = err instanceof Error ? err.message : String(err);
  if (/ActionError|FunctionCallError|ExecutionError|panicked|Smart contract/i.test(msg)) {
    throw new PermanentChainError(msg);
  }
  throw err instanceof Error ? err : new Error(msg);
}

export class NearChain implements Chain {
  private provider: JsonRpcProvider;
  private game: Account;
  private opts: NearChainOptions;

  constructor(opts: NearChainOptions) {
    this.opts = opts;
    this.provider = new JsonRpcProvider({ url: opts.rpcUrl });
    this.game = new Account(
      opts.gameAccountId,
      this.provider,
      KeyPairSigner.fromSecretKey(opts.gamePrivateKey as `ed25519:${string}`),
    );
  }

  private async call(contractId: string, method: string, args: object, deposit = 0n, gas = GAS): Promise<TxResponse> {
    try {
      return (await this.game.signAndSendTransaction({
        receiverId: contractId,
        actions: [actions.functionCall(method, args, gas, deposit)],
        throwOnFailure: false,
      })) as unknown as TxResponse;
    } catch (err) {
      classify(err);
    }
  }

  private async view<T>(contractId: string, method: string, args: object = {}): Promise<T> {
    return (await this.provider.callFunction({ contractId, method, args } as never)) as T;
  }

  async accountExists(accountId: string): Promise<boolean> {
    try {
      await this.provider.viewAccount({ accountId } as never);
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/does not exist|UNKNOWN_ACCOUNT/i.test(msg)) return false;
      throw err;
    }
  }

  async createPlayerAccount(name: string, publicKey: string): Promise<TxResult> {
    const res = await this.call(
      this.opts.factoryAccountId,
      'create_player',
      { name, public_key: publicKey },
      nearToYocto(this.opts.playerAccountDepositNear as `${number}`),
      FACTORY_GAS,
    );
    const result = check(res);
    if (returnValue<boolean>(res) !== true) {
      throw new PermanentChainError(`Account ${name} could not be created (name taken?) in ${result.txHash}`);
    }
    return result;
  }

  async mint(accountId: string, amount: bigint, memo: string) {
    const res = await this.call(this.opts.panenContractId, 'mint', { account_id: accountId, amount: amount.toString(), memo });
    const result = check(res);
    return { ...result, amount: BigInt(returnValue<string>(res) ?? amount.toString()) };
  }

  async mintReward(accountId: string, baseAmount: bigint, memo: string) {
    const res = await this.call(this.opts.panenContractId, 'mint_reward', {
      account_id: accountId,
      base_amount: baseAmount.toString(),
      memo,
    });
    const result = check(res);
    const minted = returnValue<string>(res);
    if (minted === null) throw new PermanentChainError(`mint_reward returned no amount in ${result.txHash}`);
    return { ...result, amount: BigInt(minted) };
  }

  async burnAsPlayer(accountId: string, secretKey: string, amount: bigint, memo: string): Promise<TxResult> {
    try {
      const player = new Account(accountId, this.provider, KeyPairSigner.fromSecretKey(secretKey as `ed25519:${string}`));
      const { signedDelegate } = await player.createSignedMetaTransaction({
        receiverId: this.opts.panenContractId,
        actions: [actions.functionCall('burn', { amount: amount.toString(), memo }, GAS, 0n)],
      });
      const res = (await this.game.signAndSendTransaction({
        receiverId: accountId,
        actions: [actions.signedDelegate(signedDelegate)],
        throwOnFailure: false,
      })) as unknown as TxResponse;
      return check(res);
    } catch (err) {
      classify(err);
    }
  }

  async mintTree(receiverId: string, species: Species, quality: Quality, parentTokenId: string | null) {
    const res = await this.call(this.opts.pohonContractId, 'mint_tree', {
      receiver_id: receiverId,
      species,
      quality,
      parent_id: parentTokenId,
    });
    const result = check(res);
    const view = returnValue<{ token_id: string }>(res);
    if (!view) throw new PermanentChainError(`mint_tree returned no token in ${result.txHash}`);
    return { ...result, tokenId: view.token_id };
  }

  async updateTree(tokenId: string, stage: Stage, ageDays: number, harvestCount: number) {
    return check(
      await this.call(this.opts.pohonContractId, 'update_tree', {
        token_id: tokenId,
        stage,
        age_days: ageDays,
        harvest_count: harvestCount,
      }),
    );
  }

  async makeMemorial(tokenId: string) {
    return check(await this.call(this.opts.pohonContractId, 'make_memorial', { token_id: tokenId }));
  }

  async villageStats(): Promise<ChainVillageStats> {
    const s = await this.view<{
      total_minted: string;
      total_burned: string;
      circulating_supply: string;
      season: { season: number; reward_divisor: number; next_season_at: string | null };
    }>(this.opts.panenContractId, 'village_stats');
    return {
      totalMinted: BigInt(s.total_minted),
      totalBurned: BigInt(s.total_burned),
      circulatingSupply: BigInt(s.circulating_supply),
      season: s.season.season,
      rewardDivisor: s.season.reward_divisor,
      nextSeasonAt: s.season.next_season_at === null ? null : BigInt(s.season.next_season_at),
    };
  }

  async treeSupply(): Promise<number> {
    return Number(await this.view<string>(this.opts.pohonContractId, 'nft_total_supply'));
  }
}
