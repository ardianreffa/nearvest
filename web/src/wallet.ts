// NEAR wallet (non-custodial) through @hot-labs/near-connect on testnet.
//
// - Sign in / "Connect NEAR Wallet": the wallet signs a NEP-413 message with a
//   one-time nonce from the server. No transaction, no gas.
// - Shop (wallet gardens only): the first purchase asks the wallet once to add a
//   limited "game key" (only `burn` on the PANEN contract). The browser keeps that
//   key and signs each burn as a meta transaction; the game relays it and pays gas.
//
// The libraries are loaded only when a wallet is used, so Google players never download them.

import type { NearConnector } from '@hot-labs/near-connect';
import { api, ApiError, type ServerConfig } from './api';

export interface WalletProof {
  accountId: string;
  publicKey: string;
  signature: string;
  nonce: string;
}

let connectorPromise: Promise<NearConnector> | null = null;

function connector(network: string): Promise<NearConnector> {
  connectorPromise ??= import('@hot-labs/near-connect').then(
    ({ NearConnector }) =>
      // No manual wallet list: near-connect shows every wallet that supports this network.
      new NearConnector({ network: network === 'mainnet' ? 'mainnet' : 'testnet', autoConnect: false }),
  );
  return connectorPromise;
}

function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

/** Opens the wallet picker and lets the chosen wallet sign the server's one-time login message. */
export async function walletProof(config: ServerConfig): Promise<WalletProof> {
  const challenge = await api<{ nonce: string; message: string; recipient: string }>('POST', '/auth/near/challenge');
  const c = await connector(config.network);
  let signed: WalletProof | null = null;
  const onSigned = (e: { accounts: { accountId: string; signedMessage: { accountId: string; publicKey: string; signature: string } }[] }) => {
    const m = e.accounts[0]?.signedMessage;
    if (m) signed = { accountId: m.accountId || e.accounts[0].accountId, publicKey: m.publicKey, signature: m.signature, nonce: challenge.nonce };
  };
  c.on('wallet:signInAndSignMessage', onSigned);
  try {
    await c.connect({
      signMessageParams: { message: challenge.message, recipient: challenge.recipient, nonce: base64ToBytes(challenge.nonce) },
    });
  } catch (e) {
    throw new Error(friendly(e, 'Wallet sign-in was cancelled'));
  } finally {
    c.off('wallet:signInAndSignMessage', onSigned);
  }
  if (!signed) throw new Error('The wallet did not sign the message. Please try again.');
  return signed;
}

function friendly(e: unknown, fallback: string): string {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return /reject|cancel|closed/i.test(msg) || !msg ? fallback : msg;
}

// ---------- game key (Shop for wallet gardens) ----------

const KEY_PREFIX = 'nearvest.gamekey.';

function loadGameKey(accountId: string): string | null {
  try {
    return localStorage.getItem(KEY_PREFIX + accountId);
  } catch {
    return null;
  }
}

function saveGameKey(accountId: string, secret: string | null): void {
  try {
    if (secret) localStorage.setItem(KEY_PREFIX + accountId, secret);
    else localStorage.removeItem(KEY_PREFIX + accountId);
  } catch {
    // Storage blocked: the key lasts until the tab closes (and is added again next time).
  }
}

/** Asks the wallet to add the limited game key to the player's account (one wallet confirmation). */
async function addGameKey(config: ServerConfig, accountId: string): Promise<string> {
  const { KeyPair } = await import('near-api-js');
  const key = KeyPair.fromRandom('ed25519');
  const c = await connector(config.network);
  let signedInAs: string | undefined;
  const onSignIn = (e: { accounts: { accountId: string }[] }) => (signedInAs = e.accounts[0]?.accountId);
  c.on('wallet:signIn', onSignIn);
  try {
    await c.connect({
      addFunctionCallKey: {
        contractId: config.wallet.gameKey.contractId,
        publicKey: key.getPublicKey().toString(),
        allowMethods: { anyMethod: false, methodNames: config.wallet.gameKey.methodNames },
        gasAllowance: { kind: 'limited', amount: config.wallet.gameKey.allowance },
      },
    });
  } catch (e) {
    throw new Error(friendly(e, 'Shop setup was cancelled'));
  } finally {
    c.off('wallet:signIn', onSignIn);
  }
  if (signedInAs && signedInAs !== accountId) {
    throw new Error(`Please choose ${accountId} in your wallet (you picked ${signedInAs}).`);
  }
  saveGameKey(accountId, key.toString());
  return key.toString();
}

export interface BurnRequest {
  senderId: string;
  receiverId: string;
  publicKey: string;
  nonce: string;
  maxBlockHeight: string;
  amount: string;
  memo: string;
  gas: string;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Prepares a wallet garden's Shop purchase: gets the exact burn from the server
 * and signs it with the game key (adding the key first if needed).
 * Returns null when the player says no to the one-time setup.
 */
export async function signShopBurn(
  config: ServerConfig,
  accountId: string,
  purchase: { item: string; qty: number },
  ask: (message: string, confirmLabel: string) => Promise<boolean>,
): Promise<{ publicKey: string; nonce: string; maxBlockHeight: string; signature: string } | null> {
  const nearApi = await import('near-api-js');
  let secret = loadGameKey(accountId);
  let justAdded = false;
  if (!secret) {
    const ok = await ask(
      'To use the Shop, your wallet adds a small game key once. It can only burn PANEN for Shop purchases. ' +
        'Your wallet pays this one setup step (a tiny testnet fee); after that the game pays every Shop purchase.',
      'Set up Shop',
    );
    if (!ok) return null;
    secret = await addGameKey(config, accountId);
    justAdded = true;
  }

  const publicKey = nearApi.KeyPair.fromString(secret as Parameters<typeof nearApi.KeyPair.fromString>[0]).getPublicKey().toString();
  let req: BurnRequest | null = null;
  // A key added a moment ago needs a few seconds to become final on chain.
  for (let attempt = 0; !req; attempt++) {
    try {
      req = await api<BurnRequest>('POST', '/api/wallet/burn', { ...purchase, publicKey });
    } catch (e) {
      const missing = e instanceof ApiError && e.data.code === 'game_key_missing';
      if (missing && justAdded && attempt < 5) {
        await wait(2000);
        continue;
      }
      if (missing && !justAdded) {
        // The key was removed in the wallet (or this is another browser): set it up again.
        saveGameKey(accountId, null);
        return signShopBurn(config, accountId, purchase, ask);
      }
      throw e;
    }
  }

  const { signature } = await signBurnRequest(req, secret);
  return { publicKey, nonce: req.nonce, maxBlockHeight: req.maxBlockHeight, signature };
}

/**
 * Signs the burn meta transaction (NEP-366 delegate action) exactly as the server
 * rebuilds it in server/src/wallet.ts (burnDelegateHash). Exported for the browser check.
 */
export async function signBurnRequest(req: BurnRequest, secret: string): Promise<{ hashHex: string; signature: string }> {
  const nearApi = await import('near-api-js');
  const key = nearApi.KeyPair.fromString(secret as Parameters<typeof nearApi.KeyPair.fromString>[0]);
  const delegate = nearApi.buildDelegateAction({
    senderId: req.senderId,
    receiverId: req.receiverId,
    actions: [nearApi.actions.functionCall('burn', { amount: req.amount, memo: req.memo }, BigInt(req.gas), 0n)],
    nonce: BigInt(req.nonce),
    maxBlockHeight: BigInt(req.maxBlockHeight),
    publicKey: nearApi.PublicKey.fromString(req.publicKey),
  } as never);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', nearApi.encodeDelegateAction(delegate) as BufferSource));
  const hashHex = [...hash].map((b) => b.toString(16).padStart(2, '0')).join('');
  return { hashHex, signature: bytesToBase64(key.sign(hash).signature) };
}

// ---------- wallet transactions (TaniBot settings for wallet gardens) ----------

export interface WalletCall {
  method: string;
  args: Record<string, unknown>;
  /** yoctoNEAR as a string ('1' proves the player's full access key). */
  deposit: string;
}

/**
 * Asks the player's wallet to sign and send function calls on `receiverId`
 * (one confirmation; the wallet pays this small testnet fee).
 */
export async function walletFunctionCalls(config: ServerConfig, accountId: string, receiverId: string, calls: WalletCall[]): Promise<void> {
  const c = await connector(config.network);
  let wallet: Awaited<ReturnType<NearConnector['wallet']>>;
  try {
    wallet = await c.wallet();
    const accounts = await wallet.getAccounts();
    if (!accounts.some((a) => a.accountId === accountId)) throw new Error('other account');
  } catch {
    try {
      wallet = await c.connect();
    } catch (e) {
      throw new Error(friendly(e, 'Wallet confirmation was cancelled'));
    }
  }
  const accounts = await wallet.getAccounts();
  if (!accounts.some((a) => a.accountId === accountId)) {
    throw new Error(`Please choose ${accountId} in your wallet.`);
  }
  try {
    await wallet.signAndSendTransaction({
      receiverId,
      actions: calls.map((call) => ({
        type: 'FunctionCall' as const,
        params: { methodName: call.method, args: call.args, gas: '30000000000000', deposit: call.deposit },
      })),
    });
  } catch (e) {
    throw new Error(friendly(e, 'Wallet confirmation was cancelled'));
  }
}
