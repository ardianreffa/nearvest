// Simple limits that protect the game's testnet NEAR (audit 2026-11-13 #3): requests per IP
// per minute, new gardens per IP per day, wallet TaniBot activations per IP per day, new trees
// per garden per real day. All answer 429 with a clear message.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GARDENS_PER_IP_PER_DAY, REQUESTS_PER_IP_PER_MINUTE, TREES_PLANTED_PER_REAL_DAY, WALLET_BOTS_PER_IP_PER_DAY } from '../src/rules.ts';
import { DAY, makeWorld, MINUTE } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

async function call(w: World, method: string, path: string, opts: { token?: string; body?: unknown; ip?: string } = {}) {
  const res = await w.app.request(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      ...(opts.ip ? { 'X-Forwarded-For': opts.ip } : {}),
    },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  return { status: res.status, json: (await res.json()) as any, headers: res.headers };
}

async function devToken(w: World, username: string, ip?: string) {
  return (await call(w, 'POST', '/auth/dev', { body: { username }, ip })).json.token as string;
}

describe('limits', () => {
  it(`requests: ${REQUESTS_PER_IP_PER_MINUTE} per IP per minute, then 429 until the next minute; other IPs are not affected`, async () => {
    const w = makeWorld();
    w.advance(60_000 - (w.now() % 60_000)); // start of a minute
    for (let i = 0; i < REQUESTS_PER_IP_PER_MINUTE; i++) assert.equal((await call(w, 'GET', '/api/config', { ip: '1.2.3.4' })).status, 200);
    const over = await call(w, 'GET', '/api/config', { ip: '1.2.3.4' });
    assert.equal(over.status, 429);
    assert.equal(over.json.code, 'rate_limited');
    assert.match(over.json.error, /Too many requests/);
    assert.ok(Number(over.headers.get('Retry-After')) >= 1);
    assert.equal((await call(w, 'GET', '/api/config', { ip: '5.6.7.8' })).status, 200);
    w.advance(MINUTE);
    assert.equal((await call(w, 'GET', '/api/config', { ip: '1.2.3.4' })).status, 200);
  });

  it(`new gardens: ${GARDENS_PER_IP_PER_DAY} per IP in 24 hours, sign-in still works, judge gardens not counted`, async () => {
    const w = makeWorld();
    for (let i = 0; i < GARDENS_PER_IP_PER_DAY; i++) {
      const token = await devToken(w, `u${i}`, '9.9.9.9');
      assert.equal((await call(w, 'POST', '/api/player', { token, body: { name: `farm${i}` }, ip: '9.9.9.9' })).status, 201);
    }
    const token = await devToken(w, 'late', '9.9.9.9');
    const res = await call(w, 'POST', '/api/player', { token, body: { name: 'farmlate' }, ip: '9.9.9.9' });
    assert.equal(res.status, 429);
    assert.equal(res.json.code, 'gardens_limit');
    // Try as Judge from the same IP still works (own limit).
    assert.equal((await call(w, 'POST', '/auth/judge', { body: { deviceId: 'device-judge-0000001' }, ip: '9.9.9.9' })).status, 200);
    // Another IP, or the next day: fine.
    assert.equal((await call(w, 'POST', '/api/player', { token, body: { name: 'farmlate' }, ip: '8.8.8.8' })).status, 201);
  });

  it(`wallet TaniBot: ${WALLET_BOTS_PER_IP_PER_DAY} activations per IP per real day`, async () => {
    const w = makeWorld();
    const tokens: string[] = [];
    for (let i = 0; i <= WALLET_BOTS_PER_IP_PER_DAY; i++) {
      const token = await devToken(w, `w${i}`);
      await call(w, 'POST', '/api/player', { token, body: { name: `wal${i}` } });
      tokens.push(token);
    }
    // Make them wallet gardens (own account, ready).
    w.db.prepare("UPDATE players SET custody = 'wallet', account_status = 'ready', account_id = name || '.testnet'").run();
    for (let i = 0; i < WALLET_BOTS_PER_IP_PER_DAY; i++) {
      assert.equal((await call(w, 'POST', '/api/tanibot/setup', { token: tokens[i], body: {}, ip: '7.7.7.7' })).status, 200);
    }
    const res = await call(w, 'POST', '/api/tanibot/setup', { token: tokens[WALLET_BOTS_PER_IP_PER_DAY], body: {}, ip: '7.7.7.7' });
    assert.equal(res.status, 429);
    assert.equal(res.json.code, 'tanibot_limit');
    w.advance(DAY);
    assert.equal((await call(w, 'POST', '/api/tanibot/setup', { token: tokens[WALLET_BOTS_PER_IP_PER_DAY], body: {}, ip: '7.7.7.7' })).status, 200);
  });

  it(`trees: ${TREES_PLANTED_PER_REAL_DAY} new trees per garden per real day (TaniBot included), again after 00:00 UTC`, async () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('planter');
    await w.worker.drain();
    const game = w.game as any;
    // The welcome pack's durian seed is one of the seeds; fill up with mango seeds as needed.
    const plantOnce = () => {
      const seed = game.addSeed(p.id, 'mango', null, null, 'shop') as number;
      w.game.plant(p.id, 0, seed);
      w.game.chop(p.id, 0);
    };
    const already = (w.db.prepare('SELECT COUNT(*) AS n FROM trees WHERE player_id = ?').get(p.id) as { n: number }).n;
    for (let i = already; i < TREES_PLANTED_PER_REAL_DAY; i++) plantOnce();
    const seed = game.addSeed(p.id, 'mango', null, null, 'shop') as number;
    assert.throws(() => w.game.plant(p.id, 0, seed), (e: any) => e.status === 429 && e.details.code === 'plant_limit' && /50 trees today/.test(e.message));
    w.advance(DAY);
    w.game.plant(p.id, 0, seed);
  });
});
