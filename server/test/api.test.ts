import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeWorld } from './helpers.ts';

async function call(app: ReturnType<typeof makeWorld>['app'], method: string, path: string, token?: string, body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

describe('HTTP API', () => {
  it('dev login -> create garden -> check-in -> plant -> water', async () => {
    const { app } = makeWorld();
    const login = await call(app, 'POST', '/auth/dev', undefined, { username: 'tester' });
    assert.equal(login.status, 200);
    assert.equal(login.json.player, null);
    const token = login.json.token as string;

    const created = await call(app, 'POST', '/api/player', token, { name: 'Ardian' });
    assert.equal(created.status, 201);
    assert.equal(created.json.player.accountId, 'ardian.nearvest.testnet');
    assert.equal(created.json.player.balance, 50);

    const checkin = await call(app, 'POST', '/api/checkin', token);
    assert.equal(checkin.status, 200);
    assert.equal(checkin.json.state.player.balance, 55);

    const seed = checkin.json.state.seeds[0];
    const planted = await call(app, 'POST', '/api/plant', token, { plot: 0, seedId: seed.id });
    assert.equal(planted.status, 200);
    const watered = await call(app, 'POST', '/api/water', token, { plot: 0 });
    assert.equal(watered.json.state.plots[0].tree.isWatered, true);

    const again = await call(app, 'POST', '/api/water', token, { plot: 0 });
    assert.equal(again.status, 400);
    assert.match(again.json.error, /already watered/);
  });

  it('requires a session for player routes', async () => {
    const { app } = makeWorld();
    assert.equal((await call(app, 'GET', '/api/me')).status, 401);
    assert.equal((await call(app, 'GET', '/api/me', 'not-a-token')).status, 401);
  });

  it('one login has one garden', async () => {
    const { app } = makeWorld();
    const { json } = await call(app, 'POST', '/auth/dev', undefined, { username: 'tester' });
    await call(app, 'POST', '/api/player', json.token, { name: 'ardian' });
    const second = await call(app, 'POST', '/api/player', json.token, { name: 'budi' });
    assert.equal(second.status, 409);
    const relogin = await call(app, 'POST', '/auth/dev', undefined, { username: 'tester' });
    assert.equal(relogin.json.player.player.name, 'ardian');
  });

  it('Village Stats and Mr. Darto are public', async () => {
    const w = makeWorld();
    w.newPlayer('ardian');
    await w.worker.drain();
    const stats = await call(w.app, 'GET', '/api/stats');
    assert.equal(stats.status, 200);
    assert.equal(stats.json.panen.totalMinted, 50);
    assert.equal(stats.json.panen.season, 1);
    assert.equal(stats.json.village.players, 1);
    const darto = await call(w.app, 'GET', '/api/darto');
    assert.equal(darto.json.prices.length, 3);
    assert.equal(typeof darto.json.greeting, 'string');
  });

  it('Google login rejects a bad credential', async () => {
    const { app } = makeWorld();
    const res = await call(app, 'POST', '/auth/google', undefined, { credential: 'bad' });
    assert.equal(res.status, 503); // not configured in tests
  });
});

describe('garden names (new gardens: at most 16 characters)', () => {
  it('refuses a 17-character name with a clear message and accepts 16', async () => {
    const { app } = makeWorld();
    const { json } = await call(app, 'POST', '/auth/dev', undefined, { username: 'longname' });
    const tooLong = await call(app, 'POST', '/api/player', json.token, { name: 'abcdefghijklmnopq' });
    assert.equal(tooLong.status, 400);
    assert.equal(tooLong.json.code, 'name_too_long');
    assert.equal(tooLong.json.max, 16);
    assert.equal(tooLong.json.error, 'Name must be 2-16 characters (yours has 17)');
    const ok = await call(app, 'POST', '/api/player', json.token, { name: 'abcdefghijklmnop' });
    assert.equal(ok.status, 201);
    assert.equal(ok.json.player.name, 'abcdefghijklmnop');
  });

  it('an older garden with a longer name keeps working and is shown in full', async () => {
    const w = makeWorld();
    const old = w.newPlayer('oldie');
    const longName = 'a-very-long-farmer-name-24';
    // Gardens made before the limit (the contract allows up to 32 characters).
    w.db.prepare('UPDATE players SET name = ? WHERE id = ?').run(longName, old.id);
    const state = w.game.state(old.id);
    assert.equal(state.player.name, longName);
    const seed = state.seeds[0];
    w.game.plant(old.id, 0, seed.id);
    assert.ok(w.game.state(old.id).plots[0].tree);
  });

  it('judge gardens keep their judge-xxxx names', async () => {
    const w = makeWorld();
    const r = await w.app.request('/auth/judge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'device-000000000001' }) });
    const json = (await r.json()) as any;
    assert.equal(r.status, 200);
    assert.match(json.player.player.name, /^judge-[a-z0-9]{4}$/);
  });
});

describe('HTTP API price lock', () => {
  it('returns 409 with the new price when it changed', async () => {
    const w = makeWorld({ demo: true });
    const login = await call(w.app, 'POST', '/auth/dev', undefined, { username: 'seller' });
    await call(w.app, 'POST', '/api/player', login.json.token, { name: 'seller' });
    const p = w.game.getPlayerByUser(1)!;
    w.db.prepare("INSERT INTO fruits (player_id, species, quality, qty) VALUES (?, 'mango', 'common', 1)").run(p.id);
    const real = w.game.dartoPrices(true).prices.find((x) => x.species === 'mango')!.price;
    const res = await call(w.app, 'POST', '/api/sell', login.json.token, { species: 'mango', quality: 'common', qty: 1, expectedPrice: real + 1 });
    assert.equal(res.status, 409);
    assert.equal(res.json.code, 'price_changed');
    assert.equal(res.json.price, real);
  });
});

describe('CORS', () => {
  it('lets browsers remember the preflight (one round trip per game action)', async () => {
    const { app } = makeWorld();
    const res = await app.request('/api/harvest', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
    });
    assert.equal(res.headers.get('access-control-allow-origin'), 'http://localhost:5173');
    assert.equal(res.headers.get('access-control-max-age'), '7200');
  });

  it('does not allow other sites', async () => {
    const { app } = makeWorld();
    const res = await app.request('/api/config', { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.headers.get('access-control-allow-origin'), null);
  });
});
