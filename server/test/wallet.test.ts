// NEAR wallet login (NEP-413), "Connect NEAR Wallet" for Google gardens, and
// wallet Shop purchases (burn signed in the browser with the game key, relayed
// by the game). Real ed25519 keys; the chain is FakeChain.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KeyPair } from 'near-api-js';
import { burnDelegateHash, nep413Hash, LOGIN_MESSAGE } from '../src/wallet.ts';
import { makeWorld, MINUTE } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;
const RECIPIENT = 'nearvest.testnet';

async function call(app: World['app'], method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');

/** A wallet: an account with a FullAccess key registered on the fake chain. */
function wallet(w: World, accountId: string) {
  const key = KeyPair.fromRandom('ed25519');
  w.chain.addAccessKey(accountId, key.getPublicKey().toString(), 'FullAccess');
  return { accountId, key };
}

/** What the browser does: get a nonce, let the wallet sign it (NEP-413), send the proof. */
async function proof(w: World, accountId: string, key: KeyPair, nonce?: string) {
  const n = nonce ?? (await call(w.app, 'POST', '/auth/near/challenge')).json.nonce;
  const hash = nep413Hash(LOGIN_MESSAGE, Buffer.from(n, 'base64'), RECIPIENT);
  return { accountId, publicKey: key.getPublicKey().toString(), signature: b64(key.sign(hash).signature), nonce: n };
}

async function googleLike(w: World, username: string, garden: string) {
  const { json } = await call(w.app, 'POST', '/auth/dev', undefined, { username });
  await call(w.app, 'POST', '/api/player', json.token, { name: garden });
  return json.token as string;
}

describe('NEAR wallet login (NEP-413)', () => {
  it('a valid signature signs in; the garden uses the wallet account, the game pays and no key is stored', async () => {
    const w = makeWorld();
    const { accountId, key } = wallet(w, 'alice.testnet');
    const res = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, accountId, key));
    assert.equal(res.status, 200);
    assert.equal(res.json.player, null);
    const session = await call(w.app, 'GET', '/api/session', res.json.token);
    assert.equal(session.json.walletAccountId, 'alice.testnet');

    const created = await call(w.app, 'POST', '/api/player', res.json.token, { name: 'alice' });
    assert.equal(created.status, 201);
    assert.equal(created.json.player.accountId, 'alice.testnet');
    assert.equal(created.json.player.custody, 'wallet');
    const row = w.db.prepare('SELECT public_key, secret_key_enc FROM players').get() as { public_key: string; secret_key_enc: string };
    assert.deepEqual({ ...row }, { public_key: '', secret_key_enc: '' });

    // Second login: same garden.
    const again = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, accountId, key));
    assert.equal(again.json.player.player.name, 'alice');
  });

  it('a nonce works only once', async () => {
    const w = makeWorld();
    const { accountId, key } = wallet(w, 'alice.testnet');
    const p = await proof(w, accountId, key);
    assert.equal((await call(w.app, 'POST', '/auth/near', undefined, p)).status, 200);
    const replay = await call(w.app, 'POST', '/auth/near', undefined, p);
    assert.equal(replay.status, 401);
    assert.equal(replay.json.code, 'nonce_invalid');
  });

  it('an expired nonce is rejected (older than 5 minutes)', async () => {
    const w = makeWorld();
    const { accountId, key } = wallet(w, 'alice.testnet');
    const p = await proof(w, accountId, key);
    w.advance(6 * MINUTE);
    const res = await call(w.app, 'POST', '/auth/near', undefined, p);
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'nonce_invalid');
  });

  it('a nonce the server never issued is rejected', async () => {
    const w = makeWorld();
    const { accountId, key } = wallet(w, 'alice.testnet');
    const res = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, accountId, key, b64(new Uint8Array(32).fill(7))));
    assert.equal(res.json.code, 'nonce_invalid');
  });

  it('a key that does not own the account is rejected', async () => {
    const w = makeWorld();
    wallet(w, 'alice.testnet');
    // Mallory signs correctly with her own key but claims to be alice.
    const mallory = KeyPair.fromRandom('ed25519');
    const res = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, 'alice.testnet', mallory));
    assert.equal(res.status, 401);
    assert.equal(res.json.code, 'not_owner');

    // A limited (function call) key of the account is not enough either.
    const limited = KeyPair.fromRandom('ed25519');
    w.chain.addAccessKey('alice.testnet', limited.getPublicKey().toString(), { receiverId: 'panen.nearvest.testnet', methodNames: ['burn'], allowance: null });
    const res2 = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, 'alice.testnet', limited));
    assert.equal(res2.json.code, 'not_owner');
  });

  it('a signature over something else is rejected', async () => {
    const w = makeWorld();
    const { accountId, key } = wallet(w, 'alice.testnet');
    const p = await proof(w, accountId, key);
    const other = nep413Hash('Send all my tokens', Buffer.from(p.nonce, 'base64'), RECIPIENT);
    const res = await call(w.app, 'POST', '/auth/near', undefined, { ...p, signature: b64(key.sign(other).signature) });
    assert.equal(res.json.code, 'bad_signature');
  });
});

describe('Connect NEAR Wallet (Google gardens)', () => {
  it('links a wallet; the wallet then signs in to the same garden', async () => {
    const w = makeWorld();
    const token = await googleLike(w, 'sari-google', 'sari');
    const { accountId, key } = wallet(w, 'sari.testnet');
    const linked = await call(w.app, 'POST', '/api/wallet/link', token, await proof(w, accountId, key));
    assert.equal(linked.status, 200);
    assert.equal(linked.json.player.walletAccountId, 'sari.testnet');
    assert.equal(linked.json.player.custody, 'server');

    const viaWallet = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, accountId, key));
    assert.equal(viaWallet.json.player.player.name, 'sari');
  });

  it('one wallet = one garden', async () => {
    const w = makeWorld();
    const sari = await googleLike(w, 'sari-google', 'sari');
    const budi = await googleLike(w, 'budi-google', 'budi');
    const { accountId, key } = wallet(w, 'sari.testnet');
    assert.equal((await call(w.app, 'POST', '/api/wallet/link', sari, await proof(w, accountId, key))).status, 200);

    const steal = await call(w.app, 'POST', '/api/wallet/link', budi, await proof(w, accountId, key));
    assert.equal(steal.status, 409);
    assert.equal(steal.json.code, 'wallet_linked');

    // A wallet that already has its own garden cannot be linked to a Google garden.
    const alice = wallet(w, 'alice.testnet');
    const login = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, alice.accountId, alice.key));
    await call(w.app, 'POST', '/api/player', login.json.token, { name: 'alice' });
    const res = await call(w.app, 'POST', '/api/wallet/link', budi, await proof(w, alice.accountId, alice.key));
    assert.equal(res.json.code, 'wallet_linked');

    // A garden keeps its first wallet.
    const other = wallet(w, 'sari2.testnet');
    const second = await call(w.app, 'POST', '/api/wallet/link', sari, await proof(w, other.accountId, other.key));
    assert.equal(second.json.code, 'garden_linked');
  });

  it('a wallet linked to a Google garden cannot also start its own garden', async () => {
    const w = makeWorld();
    const { accountId, key } = wallet(w, 'sari.testnet');
    // Signs in first (no garden yet), then the wallet gets linked to a Google garden.
    const early = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, accountId, key));
    const sari = await googleLike(w, 'sari-google', 'sari');
    await call(w.app, 'POST', '/api/wallet/link', sari, await proof(w, accountId, key));
    const res = await call(w.app, 'POST', '/api/player', early.json.token, { name: 'sari2' });
    assert.equal(res.status, 409);
  });
});

describe('Shop for wallet players (game key + relayed burn)', () => {
  async function walletPlayer(w: World) {
    const { accountId, key } = wallet(w, 'alice.testnet');
    const { json } = await call(w.app, 'POST', '/auth/near', undefined, await proof(w, accountId, key));
    await call(w.app, 'POST', '/api/player', json.token, { name: 'alice' });
    await w.worker.drain(); // welcome pack: 50 PANEN minted to alice.testnet
    const gameKey = KeyPair.fromRandom('ed25519');
    w.chain.addAccessKey(accountId, gameKey.getPublicKey().toString(), { receiverId: 'panen.nearvest.testnet', methodNames: ['burn'], allowance: '1' }, 0n);
    return { token: json.token as string, gameKey };
  }

  /** What the browser does with the server's burn request. */
  function signBurn(req: any, gameKey: KeyPair) {
    const hash = burnDelegateHash({
      accountId: req.senderId,
      publicKey: req.publicKey,
      nonce: BigInt(req.nonce),
      maxBlockHeight: BigInt(req.maxBlockHeight),
      amount: BigInt(req.amount),
      memo: req.memo,
      panenContractId: req.receiverId,
    });
    return { publicKey: req.publicKey, nonce: req.nonce, maxBlockHeight: req.maxBlockHeight, signature: b64(gameKey.sign(hash).signature) };
  }

  it('the browser signs the exact burn, the game relays it and the PANEN is burned on chain', async () => {
    const w = makeWorld();
    const { token, gameKey } = await walletPlayer(w);
    const req = await call(w.app, 'POST', '/api/wallet/burn', token, { item: 'fertilizer', qty: 1, publicKey: gameKey.getPublicKey().toString() });
    assert.equal(req.status, 200);
    const buy = await call(w.app, 'POST', '/api/shop/buy', token, { item: 'fertilizer', qty: 1, signedBurn: signBurn(req.json, gameKey) });
    assert.equal(buy.status, 200);
    await w.worker.drain();
    assert.equal(await w.chain.ftBalanceOf('alice.testnet'), 42n * 10n ** 18n);
    assert.ok(w.chain.calls.some((c) => c.method === 'relay_burn'));
  });

  it('without a signature, with a reused nonce or for another amount the purchase is refused', async () => {
    const w = makeWorld();
    const { token, gameKey } = await walletPlayer(w);
    const none = await call(w.app, 'POST', '/api/shop/buy', token, { item: 'fertilizer', qty: 1 });
    assert.equal(none.json.code, 'signature_required');

    const req = await call(w.app, 'POST', '/api/wallet/burn', token, { item: 'fertilizer', qty: 1, publicKey: gameKey.getPublicKey().toString() });
    const signed = signBurn(req.json, gameKey);
    const cheaper = await call(w.app, 'POST', '/api/shop/buy', token, { item: 'fertilizer', qty: 2, signedBurn: signed });
    assert.equal(cheaper.json.code, 'bad_signature');

    assert.equal((await call(w.app, 'POST', '/api/shop/buy', token, { item: 'fertilizer', qty: 1, signedBurn: signed })).status, 200);
    const replay = await call(w.app, 'POST', '/api/shop/buy', token, { item: 'fertilizer', qty: 1, signedBurn: signed });
    assert.equal(replay.json.code, 'nonce_used');
  });

  it('asks for the game key when the wallet has not added it yet', async () => {
    const w = makeWorld();
    const { token } = await walletPlayer(w);
    const missing = KeyPair.fromRandom('ed25519').getPublicKey().toString();
    const res = await call(w.app, 'POST', '/api/wallet/burn', token, { item: 'fertilizer', qty: 1, publicKey: missing });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'game_key_missing');
  });
});
