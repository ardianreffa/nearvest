// Google login with a fake Google: our own RSA key plays Google's signing key.

import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { makeWorld, START } from './helpers.ts';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';

let keys: JWTVerifyGetKey;
let privateKey: CryptoKey;
let strangerKey: CryptoKey;

before(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'google-test', alg: 'RS256', use: 'sig' };
  keys = createLocalJWKSet({ keys: [jwk] });
  strangerKey = (await generateKeyPair('RS256')).privateKey;
});

interface TokenOpts {
  sub?: string;
  aud?: string;
  iss?: string;
  emailVerified?: boolean;
  /** Seconds after START when the token expires. */
  expIn?: number;
  key?: CryptoKey;
}

function googleToken(o: TokenOpts = {}): Promise<string> {
  const iat = Math.floor(START / 1000) - 60;
  return new SignJWT({ email: 'farmer@example.com', email_verified: o.emailVerified ?? true })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-test' })
    .setSubject(o.sub ?? '1234567890')
    .setAudience(o.aud ?? CLIENT_ID)
    .setIssuer(o.iss ?? 'https://accounts.google.com')
    .setIssuedAt(iat)
    .setExpirationTime(Math.floor(START / 1000) + (o.expIn ?? 3600))
    .sign(o.key ?? privateKey);
}

async function call(app: ReturnType<typeof makeWorld>['app'], method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const world = (devLogin = false) => makeWorld({ googleClientId: CLIENT_ID, googleKeys: keys, devLogin });

describe('Google login', () => {
  it('a valid token signs in; the first time there is no garden yet', async () => {
    const { app } = world();
    const res = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken() });
    assert.equal(res.status, 200);
    assert.equal(typeof res.json.token, 'string');
    assert.equal(res.json.player, null);
    assert.equal((await call(app, 'GET', '/api/me', res.json.token)).status, 404);
  });

  it('a second login with the same Google account opens the same garden', async () => {
    const { app } = world();
    const first = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken() });
    const created = await call(app, 'POST', '/api/player', first.json.token, { name: 'sari' });
    assert.equal(created.status, 201);

    const second = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken() });
    assert.equal(second.status, 200);
    assert.notEqual(second.json.token, first.json.token);
    assert.equal(second.json.player.player.name, 'sari');
    // One Google account = one garden.
    assert.equal((await call(app, 'POST', '/api/player', second.json.token, { name: 'budi' })).status, 409);

    // Another Google account gets its own, new garden.
    const other = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken({ sub: '999' }) });
    assert.equal(other.json.player, null);
  });

  it('rejects a token made for another app (wrong audience)', async () => {
    const { app } = world();
    const res = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken({ aud: 'someone-else.apps.googleusercontent.com' }) });
    assert.equal(res.status, 401);
  });

  it('rejects an expired token', async () => {
    const { app } = world();
    const res = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken({ expIn: -120 }) });
    assert.equal(res.status, 401);
  });

  it('rejects an unverified email', async () => {
    const { app } = world();
    const res = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken({ emailVerified: false }) });
    assert.equal(res.status, 401);
  });

  it('rejects a wrong issuer and a token not signed by Google', async () => {
    const { app } = world();
    const wrongIss = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken({ iss: 'https://evil.example' }) });
    assert.equal(wrongIss.status, 401);
    const forged = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken({ key: strangerKey }) });
    assert.equal(forged.status, 401);
  });

  it('logout ends the session', async () => {
    const { app } = world();
    const { json } = await call(app, 'POST', '/auth/google', undefined, { credential: await googleToken() });
    await call(app, 'POST', '/api/player', json.token, { name: 'sari' });
    assert.equal((await call(app, 'GET', '/api/me', json.token)).status, 200);
    await call(app, 'POST', '/auth/logout', json.token);
    assert.equal((await call(app, 'GET', '/api/me', json.token)).status, 401);
  });

  it('dev login only works when DEV_LOGIN is on', async () => {
    const off = await call(world(false).app, 'POST', '/auth/dev', undefined, { username: 'tester' });
    assert.equal(off.status, 404);
    const on = await call(world(true).app, 'POST', '/auth/dev', undefined, { username: 'tester' });
    assert.equal(on.status, 200);
  });
});
