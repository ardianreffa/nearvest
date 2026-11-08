import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameState, ServerConfig } from '../src/api.ts';
import { likelyQuality, predict } from '../src/optimistic.ts';

const tree = (over: Record<string, unknown> = {}) => ({
  id: 1, tokenId: '1', species: 'mango', quality: 'common', stage: 'fruiting', growthPercent: 100, ready: true,
  wateredToday: false, isWatered: false, isFertilized: false, fertMsLeft: 0, fertSpeed: 1,
  nextHarvestOdds: { common: 1, rare: 0, gold: 0 }, harvestCount: 0, maxHarvests: 3, msToReady: 0, ageDays: 1, ...over,
});

function state(over: Partial<GameState> = {}): GameState {
  return {
    player: { custody: 'server', balance: 50, xp: 10, xpMultiplier: 5 },
    clock: { day: 1, farmDay: 1, msUntilNextDay: 1000, dayLengthMs: 60000 },
    plots: [{ plot: 0, locked: false, tree: tree() }, { plot: 1, locked: false, tree: null }],
    fruits: [], items: [{ item: 'fertilizer', qty: 1 }], seeds: [],
    season: { number: 2, divisor: 2, rewardPercent: 50 },
    ...over,
  } as unknown as GameState;
}

const config = { shop: { fertilizer: { name: 'Fertilizer', price: 8 } }, species: { mango: { xpPerHarvest: 10 } } } as unknown as ServerConfig;

describe('optimistic updates (shown before the server answers)', () => {
  it('harvest: the tree resets, a fruit lands in storage, XP goes up; the original state is untouched', () => {
    const s = state();
    const g = predict('/api/harvest', { plot: 0 }, s, config)!;
    assert.equal(g.plots[0].tree!.ready, false);
    assert.equal(g.plots[0].tree!.harvestCount, 1);
    assert.deepEqual(g.fruits, [{ species: 'mango', quality: 'common', qty: 1 }]);
    assert.equal(g.player.xp, 10 + 10 * 5);
    assert.equal(s.plots[0].tree!.ready, true, 'never mutates the shown state');
    assert.equal(s.fruits.length, 0);
  });

  it('no guess when the result is unknown or the action cannot work', () => {
    assert.equal(predict('/api/harvest', { plot: 0 }, state({ plots: [{ plot: 0, locked: false, tree: tree({ ready: false }) }] } as never), config), null);
    assert.equal(predict('/api/harvest', { plot: 0 }, state({ plots: [{ plot: 0, locked: false, tree: tree({ stage: 'old' }) }] } as never), config), null);
    assert.equal(predict('/api/plant', { plot: 1, seedId: 3 }, state(), config), null);
    assert.equal(predict('/api/fertilize', { plot: 0 }, state({ items: [] }), config), null);
  });

  it('water and fertilize', () => {
    const w = predict('/api/water', { plot: 0 }, state(), config)!;
    assert.equal(w.plots[0].tree!.wateredToday, true);
    const f = predict('/api/fertilize', { plot: 0 }, state(), config)!;
    assert.equal(f.plots[0].tree!.isFertilized, true);
    assert.equal(f.items.find((i) => i.item === 'fertilizer')!.qty, 0);
  });

  it('Shop: the price leaves the balance at once (Google gardens only)', () => {
    const g = predict('/api/shop/buy', { item: 'fertilizer', qty: 1 }, state(), config)!;
    assert.equal(g.player.balance, 42);
    assert.equal(g.items.find((i) => i.item === 'fertilizer')!.qty, 2);
    const wallet = state({ player: { custody: 'wallet', balance: 50 } } as never);
    assert.equal(predict('/api/shop/buy', { item: 'fertilizer', qty: 1 }, wallet, config), null);
  });

  it('Sell: fruit leaves storage and the Season-adjusted total joins the balance', () => {
    const s = state({ fruits: [{ species: 'mango', quality: 'rare', qty: 3 }] });
    const g = predict('/api/sell', { species: 'mango', quality: 'rare', qty: 2, expectedPrice: 12 }, s, config)!;
    assert.deepEqual(g.fruits, [{ species: 'mango', quality: 'rare', qty: 1 }]);
    assert.equal(g.player.balance, 50 + (12 * 2 * 2) / 2);
  });

  it('the likely fruit quality follows the odds', () => {
    assert.equal(likelyQuality({ common: 0.75, rare: 0.2, gold: 0.05 }), 'common');
    assert.equal(likelyQuality({ common: 0, rare: 0.8, gold: 0.2 }), 'rare');
  });
});
