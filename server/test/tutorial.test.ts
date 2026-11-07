// Tutorial: new gardens go through the loop by hand (plant, water, buy fertilizer = burn,
// fertilize, check in, harvest, sell) and meet TaniBot after the first harvest. Steps finish as
// soon as their goal is reached, in any order; progress lives on the server; skip ends it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeWorld, MINUTE } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

const step = (w: World, id: number) => w.game.state(id).tutorial?.step ?? 'done';
const seed = (w: World, id: number) => (w.db.prepare('SELECT id FROM seeds WHERE player_id = ? LIMIT 1').get(id) as { id: number }).id;

describe('Tutorial', () => {
  it('walks a new garden through the whole loop and ends after TaniBot', async () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('sari');
    await w.worker.drain();
    assert.equal(step(w, p.id), 'welcome');
    assert.deepEqual({ index: w.game.state(p.id).tutorial!.index, total: w.game.state(p.id).tutorial!.total }, { index: 0, total: 9 });
    w.game.tutorialAction(p.id, 'start');
    assert.equal(step(w, p.id), 'plant');
    w.game.plant(p.id, 0, seed(w, p.id));
    assert.equal(step(w, p.id), 'water');
    w.game.water(p.id, 0);
    assert.equal(step(w, p.id), 'buy_fertilizer');
    w.game.buy(p.id, 'fertilizer', 1);
    assert.equal(step(w, p.id), 'fertilize');
    w.game.fertilize(p.id, 0);
    assert.equal(step(w, p.id), 'checkin');
    w.game.checkin(p.id);
    assert.equal(step(w, p.id), 'harvest');
    // The first tree fruits after about 3 minutes of watered growth (faster with fertilizer).
    for (let i = 0; i < 6 && !w.game.state(p.id).plots[0].tree?.ready; i++) {
      w.advance(MINUTE);
      try {
        w.game.water(p.id, 0);
      } catch {
        // already watered today
      }
    }
    const r = w.game.harvest(p.id, 0);
    assert.equal(r.kind, 'fruit');
    assert.equal(step(w, p.id), 'sell');
    w.game.sell(p.id, r.species, r.quality, 1);
    assert.equal(step(w, p.id), 'tanibot');
    w.tanibot.setup(p.id, {});
    assert.equal(step(w, p.id), 'done');
    assert.equal(w.game.state(p.id).tutorial, null);
  });

  it('skips steps whose goal was reached earlier (check-in before it was asked)', async () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('sari');
    await w.worker.drain();
    w.game.checkin(p.id);
    w.game.tutorialAction(p.id, 'start');
    w.game.plant(p.id, 0, seed(w, p.id));
    w.game.water(p.id, 0);
    w.game.buy(p.id, 'fertilizer', 1);
    w.game.fertilize(p.id, 0);
    assert.equal(step(w, p.id), 'harvest', 'check-in was already done');
  });

  it('can be skipped at any time, survives a reload, and judge gardens have none', async () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('sari');
    w.game.tutorialAction(p.id, 'start');
    assert.equal(step(w, p.id), 'plant');
    // Progress is stored on the server: a fresh state read gives the same step.
    assert.equal(w.game.state(p.id).tutorial!.step, 'plant');
    w.game.tutorialAction(p.id, 'skip');
    assert.equal(w.game.state(p.id).tutorial, null);
    assert.throws(() => w.game.tutorialAction(p.id, 'jump'), /Unknown tutorial action/);

    const res = await w.app.request('/auth/judge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'device-000000000001' }) });
    const judge = (await res.json()) as { player: { tutorial: unknown } };
    assert.equal(judge.player.tutorial, null);
  });

  it('the HTTP route starts and skips', async () => {
    const w = makeWorld({ demo: true });
    const login = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester' }) });
    const { token } = (await login.json()) as { token: string };
    const post = async (path: string, body: unknown) =>
      (await (await w.app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) })).json()) as any;
    const created = await post('/api/player', { name: 'tester' });
    assert.equal(created.tutorial.step, 'welcome');
    assert.equal((await post('/api/tutorial', { action: 'start' })).state.tutorial.step, 'plant');
    assert.equal((await post('/api/tutorial', { action: 'skip' })).state.tutorial, null);
  });
});
