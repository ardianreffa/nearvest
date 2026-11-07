// NEAR wallet login (non-custodial). Players bring their own account (e.g.
// alice.testnet); the server never holds their full access key.
//
// 1. Login: the wallet signs a NEP-413 message containing a one-time nonce from
//    the server. We check the signature and that the signing key is a FullAccess
//    key of that account on chain. Typing someone else's name is not enough.
// 2. Shop: during login the wallet also adds a limited "game key" (function
//    call key: only `burn` on the PANEN contract, small gas allowance) that the
//    browser keeps. The browser signs a burn as a meta transaction (NEP-366) and
//    the game account relays it, so the game still pays the gas.
//
// The burn delegate is rebuilt here from the purchase, so a signature only
// counts for exactly the amount, memo and contract the server expects.

import { createHash, randomBytes } from 'node:crypto';
import { actions, baseDecode, buildDelegateAction, encodeDelegateAction, PublicKey, teraToGas } from 'near-api-js';
import type { Chain } from './chain/types.ts';
import type { DB } from './db.ts';
import { GameError } from './game.ts';

export const LOGIN_MESSAGE = 'Sign in to NEARvest';
export const CHALLENGE_TTL_MS = 5 * 60 * 1000;
/** Gas for the burn call inside the meta transaction (paid by the game). */
export const BURN_GAS = teraToGas('30');
/** Blocks a signed burn stays valid (~1 block per second on testnet). */
export const BURN_TTL_BLOCKS = 600n;
/** Gas allowance of the game key: 0.01 NEAR. Meta transactions are paid by the relayer, so this is a safety cap only. */
export const GAME_KEY_ALLOWANCE_YOCTO = '10000000000000000000000';
export const GAME_KEY_METHODS = ['burn'];

const NEP413_TAG = 2 ** 31 + 413;

// ---------- small Borsh writer (NEP-413 payload) ----------

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n);
  return b;
}

function str(s: string): Buffer {
  const bytes = Buffer.from(s, 'utf8');
  return Buffer.concat([u32(bytes.length), bytes]);
}

/** sha256 of the NEP-413 payload: tag, message, nonce[32], recipient, callbackUrl (None). */
export function nep413Hash(message: string, nonce: Uint8Array, recipient: string, callbackUrl?: string): Uint8Array {
  if (nonce.length !== 32) throw new GameError('Login nonce must be 32 bytes');
  const parts = [u32(NEP413_TAG), str(message), Buffer.from(nonce), str(recipient)];
  parts.push(callbackUrl === undefined ? Buffer.from([0]) : Buffer.concat([Buffer.from([1]), str(callbackUrl)]));
  return new Uint8Array(createHash('sha256').update(Buffer.concat(parts)).digest());
}

/** Wallets return signatures as base64 (NEP-413); a few use "ed25519:<base58>". */
export function decodeSignature(signature: string): Uint8Array {
  const bytes = signature.startsWith('ed25519:') ? baseDecode(signature.slice('ed25519:'.length)) : Buffer.from(signature, 'base64');
  if (bytes.length !== 64) throw new GameError('Invalid wallet signature', 401);
  return new Uint8Array(bytes);
}

export function parsePublicKey(publicKey: unknown): PublicKey {
  if (typeof publicKey !== 'string' || !publicKey.startsWith('ed25519:')) throw new GameError('Invalid public key');
  try {
    return PublicKey.fromString(publicKey);
  } catch {
    throw new GameError('Invalid public key');
  }
}

export function verifySignature(publicKey: string, hash: Uint8Array, signature: string): boolean {
  try {
    return parsePublicKey(publicKey).verify(hash, decodeSignature(signature));
  } catch {
    return false;
  }
}

/** NEAR account id rules (2-64 chars, lowercase, separators . - _). */
export function isValidAccountId(id: unknown): id is string {
  return (
    typeof id === 'string' &&
    id.length >= 2 &&
    id.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)
  );
}

// ---------- login challenges ----------

export function createChallenge(db: DB, nowMs: number) {
  db.prepare('DELETE FROM auth_challenges WHERE expires_at < ?').run(nowMs);
  const nonce = randomBytes(32).toString('base64');
  db.prepare('INSERT INTO auth_challenges (nonce, expires_at) VALUES (?, ?)').run(nonce, nowMs + CHALLENGE_TTL_MS);
  return { nonce, message: LOGIN_MESSAGE };
}

/** Uses up a challenge. Each nonce works once, within 5 minutes. */
export function consumeChallenge(db: DB, nonce: string, nowMs: number): boolean {
  const row = db.prepare('DELETE FROM auth_challenges WHERE nonce = ? RETURNING expires_at').get(nonce) as
    | { expires_at: number }
    | undefined;
  return !!row && row.expires_at >= nowMs;
}

/**
 * Checks a NEP-413 proof from the browser: the nonce was issued by us and is
 * unused and fresh, the signature is valid, and the signing key is a FullAccess
 * key of the account on chain (so typing someone else's name is not enough).
 * Returns the proven NEAR account id.
 */
export async function verifyWalletProof(
  db: DB,
  chain: Pick<Chain, 'viewAccessKey'>,
  recipient: string,
  proof: Record<string, unknown>,
  nowMs: number,
): Promise<string> {
  const { accountId, publicKey, signature, nonce } = proof;
  if (!isValidAccountId(accountId)) throw new GameError('Invalid NEAR account');
  if (typeof signature !== 'string' || typeof nonce !== 'string') throw new GameError('Missing signature');
  parsePublicKey(publicKey);
  if (!consumeChallenge(db, nonce, nowMs)) throw new GameError('Login expired, please try again', 401, { code: 'nonce_invalid' });
  const hash = nep413Hash(LOGIN_MESSAGE, Buffer.from(nonce, 'base64'), recipient);
  if (!verifySignature(publicKey as string, hash, signature)) throw new GameError('Wallet signature is not valid', 401, { code: 'bad_signature' });
  const key = await chain.viewAccessKey(accountId, publicKey as string);
  if (key?.permission !== 'FullAccess') throw new GameError('This key does not own the account', 401, { code: 'not_owner' });
  return accountId;
}

// ---------- shop burns ----------

export interface BurnDelegate {
  accountId: string;
  publicKey: string;
  nonce: bigint;
  maxBlockHeight: bigint;
  /** Smallest PANEN units (18 decimals). */
  amount: bigint;
  memo: string;
  panenContractId: string;
}

/** The exact delegate action the browser must sign (the web builds the same one). */
export function burnDelegateAction(d: BurnDelegate) {
  return buildDelegateAction({
    senderId: d.accountId,
    receiverId: d.panenContractId,
    actions: [actions.functionCall('burn', { amount: d.amount.toString(), memo: d.memo }, BURN_GAS, 0n)],
    nonce: d.nonce,
    maxBlockHeight: d.maxBlockHeight,
    publicKey: PublicKey.fromString(d.publicKey),
  } as never);
}

/** sha256 of the NEP-461-prefixed delegate action: what the game key signs. */
export function burnDelegateHash(d: BurnDelegate): Uint8Array {
  return new Uint8Array(createHash('sha256').update(encodeDelegateAction(burnDelegateAction(d))).digest());
}

export type AccessKeyPermission = 'FullAccess' | { receiverId: string; methodNames: string[]; allowance: string | null };

/** True when a key may sign our burns: function call key for `burn` on the PANEN contract. */
export function isGameKey(permission: AccessKeyPermission | undefined, panenContractId: string): boolean {
  return (
    !!permission &&
    permission !== 'FullAccess' &&
    permission.receiverId === panenContractId &&
    (permission.methodNames.length === 0 || permission.methodNames.includes('burn'))
  );
}
