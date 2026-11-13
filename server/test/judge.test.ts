// Try as Judge: one click -> a NEW filled garden per device (real accounts, Tree NFTs and TaniBot
// on the fake chain), limits per IP and per day, TaniBot waits for the first harvest, and the tour.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { JUDGE_BOT_BUDGET, JUDGE_GARDENS_PER_DAY, JUDGE_GARDENS_PER_IP_PER_DAY } from '../src/judge.ts';
import { JUDGE_PANEN } from '../src/game.ts';
import { makeWorld, UNIT } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

async function call(w: World, path: string, body?: unknown, token?: string, ip?: string) {
  const res = await w.app.request(path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(ip ? { 'X-Forwarded-For': ip } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const device = (n: number) => `device-${String(n).padStart(12, '0')}`;

describe('Try as Judge', () => {
  it('one click gives a new, filled garden with real NFTs, PANEN and a ready TaniBot', async () => {
    const w = makeWorld();
    const r = await call(w, '/auth/judge', { deviceId: device(1) });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.kind, 'new');
    const s = r.json.player;
    assert.match(s.player.name, /^judge-[a-z0-9]{4}$/);
    assert.equal(s.player.signIn, 'judge');
    assert.equal(s.player.demo, true);
    assert.equal(s.player.title, 'Farmhand');
    // Three trees: ripe Rare Durian, nearly ripe Gold Rambutan, Mango sprout.
    const trees = s.plots.map((p: any) => p.tree && `${p.tree.species}:${p.tree.quality}:${p.tree.stage}`);
    assert.deepEqual(trees, ['durian:rare:fruiting', 'rambutan:gold:tree', 'mango:common:sprout']);
    assert.ok(s.seeds.some((x: any) => x.quality === 'gold'), 'a Gold seed in storage');
    assert.ok(s.seeds.some((x: any) => x.quality === 'rare'), 'Rare seeds in storage');
    assert.equal(s.player.balance, JUDGE_PANEN - JUDGE_BOT_BUDGET);
    assert.equal(s.judgeTour.length, 5);
    assert.ok(s.judgeTour.every((t: any) => !t.done));

    // Everything lands on the chain, in order (account first).
    await w.worker.drain();
    const account = s.player.accountId;
    assert.equal(w.chain.trees.size, 3);
    // The NFTs show the grown trees at once (the contract mints a Seed of age 0), without
    // waiting for the 20 s stage sync.
    const nfts = [...w.chain.trees.values()].map((t: any) => `${t.species}:${t.stage}:${t.ageDays}:${t.harvestCount}`);
    assert.deepEqual(nfts, ['durian:fruiting:4:0', 'rambutan:tree:2:0', 'mango:sprout:1:0']);
    assert.equal(w.game.syncStages(), 0);
    assert.ok([...w.chain.trees.values()].every((t: any) => t.owner === account));
    assert.equal(await w.chain.ftBalanceOf(account), BigInt(JUDGE_PANEN - JUDGE_BOT_BUDGET) * UNIT);
    assert.equal(await w.chain.ftBalanceOf(`bot.${account}`), BigInt(JUDGE_BOT_BUDGET) * UNIT);
    const bot = w.tanibot.view((w.db.prepare('SELECT id FROM players WHERE account_id = ?').get(account) as { id: number }).id)!;
    assert.equal(bot.status, 'ready');
    assert.equal(bot.enabled, true);
    assert.equal(bot.dailyLimit, 50);
    assert.ok(bot.log.filter((l) => l.txStatus !== null).every((l) => l.txStatus === 'done'), 'setup, limit and budget transactions landed');
  });

  it('the same device returns to its garden; a new device makes a new one', async () => {
    const w = makeWorld();
    const a = await call(w, '/auth/judge', { deviceId: device(1) });
    const again = await call(w, '/auth/judge', { deviceId: device(1) });
    assert.equal(again.json.kind, 'same');
    assert.equal(again.json.player.player.accountId, a.json.player.player.accountId);
    const b = await call(w, '/auth/judge', { deviceId: device(2) });
    assert.equal(b.json.kind, 'new');
    assert.notEqual(b.json.player.player.accountId, a.json.player.player.accountId);
    assert.equal((await call(w, '/auth/judge', { deviceId: 'short' })).status, 400);
  });

  it(`limits new judge gardens to ${JUDGE_GARDENS_PER_IP_PER_DAY} per IP per day, then shares the one unused the longest`, async () => {
    const w = makeWorld();
    const made: string[] = [];
    for (let i = 1; i <= JUDGE_GARDENS_PER_IP_PER_DAY; i++) {
      const r = await call(w, '/auth/judge', { deviceId: device(i) }, undefined, '1.2.3.4');
      assert.equal(r.json.kind, 'new');
      made.push(r.json.player.player.accountId);
      w.advance(60_000);
    }
    // The first garden was used a moment ago; the second one was left alone the longest.
    w.db.prepare('UPDATE players SET last_seen_at = ? WHERE account_id = ?').run(w.now(), made[0]);
    const extra = await call(w, '/auth/judge', { deviceId: device(99) }, undefined, '1.2.3.4');
    assert.equal(extra.status, 200);
    assert.equal(extra.json.kind, 'shared');
    assert.equal(extra.json.player.player.accountId, made[1]);
    // Another IP still gets its own garden; the next day this IP can make new ones again.
    assert.equal((await call(w, '/auth/judge', { deviceId: device(50) }, undefined, '5.6.7.8')).json.kind, 'new');
    w.advance(25 * 60 * 60 * 1000);
    assert.equal((await call(w, '/auth/judge', { deviceId: device(98) }, undefined, '1.2.3.4')).json.kind, 'new');
  });

  it(`limits the whole game to ${JUDGE_GARDENS_PER_DAY} new judge gardens per day`, async () => {
    const w = makeWorld();
    for (let i = 1; i <= JUDGE_GARDENS_PER_DAY; i++) {
      assert.equal((await call(w, '/auth/judge', { deviceId: device(i) }, undefined, `10.0.0.${i}`)).json.kind, 'new');
    }
    // Everyone played a moment ago except garden 2 (left alone the longest): that one is shared.
    w.advance(60_000);
    w.db.prepare("UPDATE players SET active_at = ? WHERE name LIKE 'judge-%'").run(w.now());
    const idle = w.db.prepare("SELECT account_id FROM players WHERE name LIKE 'judge-%' ORDER BY id LIMIT 1 OFFSET 1").get() as { account_id: string };
    w.db.prepare('UPDATE players SET active_at = 0, last_seen_at = NULL WHERE account_id = ?').run(idle.account_id);
    const r = await call(w, '/auth/judge', { deviceId: device(1000) }, undefined, '10.0.1.1');
    assert.equal(r.json.kind, 'shared');
    assert.equal(r.json.player.player.accountId, idle.account_id);
    assert.equal(w.db.prepare("SELECT COUNT(*) AS n FROM users WHERE provider = 'judge'").get()!.n, JUDGE_GARDENS_PER_DAY);
  });

  it('TaniBot waits for the judge to harvest first, then starts working', async () => {
    const w = makeWorld();
    const r = await call(w, '/auth/judge', { deviceId: device(1) });
    const token = r.json.token;
    await w.worker.drain();
    w.advance(30_000);
    await w.tanibot.tick();
    let s = (await call(w, '/api/judge/step', { step: 'village' }, token)).json.state;
    assert.equal(s.plots[0].tree.ready, true, 'the ripe tree is still there for the judge');
    const h = await call(w, '/api/harvest', { plot: 0 }, token);
    assert.equal(h.status, 200, JSON.stringify(h.json));
    const id = (w.db.prepare('SELECT id FROM players WHERE account_id = ?').get(h.json.state.player.accountId) as { id: number }).id;
    assert.equal((w.db.prepare('SELECT hold_until FROM bots WHERE player_id = ?').get(id) as { hold_until: number }).hold_until, 0);
    w.advance(10_000);
    const before = w.tanibot.view(id)!.log.length;
    await w.tanibot.tick();
    assert.ok(w.tanibot.view(id)!.log.length > before, 'TaniBot did its first round');
    s = h.json.state;
    assert.equal(s.judgeTour.find((t: any) => t.step === 'harvest').done, true);
  });

  it('the tour records harvest, sell, shop (with their transactions), TaniBot Log and Village', async () => {
    const w = makeWorld();
    const r = await call(w, '/auth/judge', { deviceId: device(1) });
    const token = r.json.token;
    await w.worker.drain();
    await call(w, '/api/harvest', { plot: 0 }, token);
    const st = (await call(w, '/api/judge/step', { step: 'tanibot' }, token)).json.state;
    const fruit = st.fruits[0];
    const sold = await call(w, '/api/sell', { species: fruit.species, quality: fruit.quality, qty: 1 }, token);
    assert.equal(sold.status, 200, JSON.stringify(sold.json));
    const bought = await call(w, '/api/shop/buy', { item: 'fertilizer', qty: 1 }, token);
    assert.equal(bought.status, 200, JSON.stringify(bought.json));
    await call(w, '/api/judge/step', { step: 'village' }, token);
    await w.worker.drain();
    const tour = (await call(w, '/api/judge/step', { step: 'village' }, token)).json.state.judgeTour;
    assert.deepEqual(tour.map((t: any) => `${t.step}:${t.done}`), ['harvest:true', 'sell:true', 'shop:true', 'tanibot:true', 'village:true']);
    for (const t of tour.slice(0, 3)) assert.equal(t.txStatus, 'done', `${t.step} transaction landed`);
    assert.equal((await call(w, '/api/judge/step', { step: 'harvest' }, token)).status, 400, 'actions are recorded by the server only');
  });

  it("other players can not take a 'judge-' name, and normal gardens have no tour", async () => {
    const w = makeWorld();
    const login = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester' }) });
    const { token } = (await login.json()) as { token: string };
    const bad = await w.app.request('/api/player', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'judge-abcd' }),
    });
    assert.equal(bad.status, 400);
    const p = w.newPlayer('sari');
    assert.equal(w.game.state(p.id).judgeTour, null);
  });
});
