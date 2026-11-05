import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fruitOdds, msToReady, rollFruitQuality, seedSellPrice, SEED_STORAGE_SLOTS, TITLES } from '../src/rules.ts';
import { DAY, makeWorld, MINUTE, UNIT } from './helpers.ts';

/** Fills the player's storage to exactly the limit with mango seeds. */
function fillStorage(w: ReturnType<typeof makeWorld>, playerId: number) {
  const free = SEED_STORAGE_SLOTS - w.game.state(playerId).seeds.length;
  const add = w.db.prepare("INSERT INTO seeds (player_id, species, quality, source, created_at) VALUES (?, 'mango', NULL, 'test', ?)");
  for (let i = 0; i < free; i++) add.run(playerId, w.now());
  assert.equal(w.game.state(playerId).seedSlots.used, SEED_STORAGE_SLOTS);
}

/** Plants a mango on plot 0 and grows it until it is old and ripe (seed ready). */
function growOldTree(w: ReturnType<typeof makeWorld>, playerId: number, seedId: number) {
  w.game.plant(playerId, 0, seedId);
  for (let i = 0; i < 4; i++) {
    w.advance(DAY);
    w.game.water(playerId, 0);
    w.advance(DAY);
    if (i < 3) w.game.harvest(playerId, 0);
  }
  const tree = w.game.state(playerId).plots[0].tree!;
  assert.equal(tree.stage, 'old');
  assert.equal(tree.ready, true);
}

describe('seed storage limit', () => {
  it('check-in never pushes storage over the limit and reports the skipped seed', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    fillStorage(w, p.id);
    const r = w.game.checkin(p.id);
    assert.deepEqual(r.skipped, ['1 Mango seed']);
    assert.deepEqual(r.rewards, ['5 PANEN']);
    const s = w.game.state(p.id);
    assert.equal(s.seedSlots.used, SEED_STORAGE_SLOTS);
    assert.equal(s.player.balance, 55);
  });

  it('day 7 with one free slot keeps the Gold seed first', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    for (let i = 1; i <= 6; i++) {
      w.game.checkin(p.id);
      w.advance(DAY);
    }
    fillStorage(w, p.id);
    w.game.discardSeeds(p.id, [w.game.state(p.id).seeds[0].id]);
    const r = w.game.checkin(p.id);
    assert.equal(r.calendarDay, 7);
    assert.ok(r.rewards.includes('1 Gold Mango seed'));
    assert.deepEqual(r.skipped, ['1 Mango seed']);
    assert.equal(w.game.state(p.id).seedSlots.used, SEED_STORAGE_SLOTS);
  });

  it('the shop refuses seeds that do not fit', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    fillStorage(w, p.id);
    assert.throws(() => w.game.buy(p.id, 'seed_mango', 1), /storage is full/);
    assert.equal(w.game.state(p.id).player.balance, 50);
  });
});

describe('selling and discarding seeds', () => {
  it('Mr. Darto buys seeds cheaply, on chain with the Season rule', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const seeds = w.game.state(p.id).seeds; // rare durian (welcome) + mango (check-in)
    const r = w.game.sellSeeds(p.id, seeds.map((s: any) => s.id));
    assert.equal(r.sold, 2);
    assert.equal(r.basePanen, seedSellPrice('durian', 'rare') + seedSellPrice('mango', null));
    assert.equal(r.basePanen, 16 * 2 + 2);
    const s = w.game.state(p.id);
    assert.equal(s.seedSlots.used, 0);
    assert.equal(s.player.balance, 55 + 34);
    await w.worker.drain();
    assert.equal(w.chain.balances.get(p.account_id), BigInt(55 + 34) * UNIT);
    assert.ok(w.chain.calls.some((c) => c.method === 'mint_reward'));
  });

  it('discarding frees slots without any reward', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    fillStorage(w, p.id);
    const ids = w.game.state(p.id).seeds.slice(0, 3).map((s: any) => s.id);
    assert.equal(w.game.discardSeeds(p.id, ids).discarded, 3);
    assert.equal(w.game.state(p.id).seedSlots.used, SEED_STORAGE_SLOTS - 3);
    assert.equal(w.game.state(p.id).player.balance, 50);
  });

  it('only your own seeds, and at least one', () => {
    const w = makeWorld();
    const a = w.newPlayer('aa');
    const b = w.newPlayer('bb');
    const bSeed = w.game.state(b.id).seeds[0].id;
    assert.throws(() => w.game.sellSeeds(a.id, [bSeed]), /not found/);
    assert.throws(() => w.game.discardSeeds(a.id, []), /at least one/);
    assert.throws(() => w.game.sellSeeds(a.id, 'x'), /at least one/);
  });
});

describe('a player is never stuck', () => {
  it('full storage: the old tree keeps its seed until the player chooses', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const mango = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;
    growOldTree(w, p.id, mango.id);
    fillStorage(w, p.id);

    assert.throws(
      () => w.game.harvest(p.id, 0),
      (e: any) => e.status === 409 && e.details.code === 'storage_full' && e.details.species === 'mango',
    );
    // Nothing was lost: the tree and its seed are still there.
    assert.equal(w.game.state(p.id).plots[0].tree!.stage, 'old');
    assert.equal(w.game.state(p.id).seedSlots.used, SEED_STORAGE_SLOTS);
  });

  it('choice "plant": the superior seed goes straight into the freed plot, with lineage', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const mango = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;
    growOldTree(w, p.id, mango.id);
    fillStorage(w, p.id);
    const oldTreeId = w.game.state(p.id).plots[0].tree!.id;

    const r = w.game.harvest(p.id, 0, 'plant');
    assert.equal(r.kind, 'seed');
    const s = w.game.state(p.id);
    assert.equal(s.seedSlots.used, SEED_STORAGE_SLOTS);
    assert.equal(s.plots[0].tree!.stage, 'seed');
    assert.notEqual(s.plots[0].tree!.id, oldTreeId);
    const parent = w.db.prepare('SELECT parent_tree_id AS p FROM trees WHERE id = ?').get(s.plots[0].tree!.id) as { p: number };
    assert.equal(parent.p, oldTreeId);
    await w.worker.drain();
    assert.equal(w.chain.trees.get('1')!.memorial, true);
    assert.equal(w.chain.trees.get('2')!.parent, '1');
  });

  it('choice "sell": Mr. Darto buys the seed and the plot is free', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const mango = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;
    growOldTree(w, p.id, mango.id);
    fillStorage(w, p.id);
    const before = w.game.state(p.id).player.balance;
    w.game.harvest(p.id, 0, 'sell');
    const s = w.game.state(p.id);
    assert.equal(s.plots[0].tree, null);
    assert.equal(s.player.balance, before + seedSellPrice('mango', null));
    assert.equal(s.seedSlots.used, SEED_STORAGE_SLOTS);
  });
});

describe('fertilizer', () => {
  it('shows the boost and raises the next fruit quality chance', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const mango = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;
    w.game.plant(p.id, 0, mango.id); // random 0.5 -> Common tree
    w.game.buy(p.id, 'fertilizer', 1);
    w.game.water(p.id, 0);
    w.game.fertilize(p.id, 0);
    const t = w.game.state(p.id).plots[0].tree!;
    assert.equal(t.quality, 'common');
    assert.equal(t.fertSpeed, 1.5);
    assert.equal(t.fertMsLeft, DAY);
    assert.deepEqual(t.nextHarvestOdds, { common: 0.75, rare: 0.2, gold: 0.05 });

    w.rng.value = 0.01; // lucky roll
    w.advance(3 * MINUTE);
    const h = w.game.harvest(p.id, 0);
    assert.equal(h.kind === 'fruit' && h.quality, 'gold');
    assert.equal(h.kind === 'fruit' && h.fertilized, true);
    // The boost is used up by the harvest.
    assert.deepEqual(w.game.state(p.id).plots[0].tree!.nextHarvestOdds, { common: 1, rare: 0, gold: 0 });
  });

  it('without fertilizer a tree always gives fruit of its own quality', () => {
    assert.equal(rollFruitQuality('common', false, 0), 'common');
    assert.equal(rollFruitQuality('rare', false, 0.99), 'rare');
    assert.equal(rollFruitQuality('rare', true, 0.1), 'gold');
    assert.deepEqual(fruitOdds('gold', true), { common: 0, rare: 0, gold: 1 });
  });

  it('the countdown counts the fertilizer speed', () => {
    const g = { growth: 0, target: 1, lastTickMs: 0, waterUntilMs: DAY, fertUntilMs: DAY, harvestCount: 0, maxHarvests: 3 };
    assert.equal(Math.round(msToReady(g, DAY)), Math.round(DAY / 1.5));
    assert.equal(msToReady({ ...g, fertUntilMs: 0 }, DAY), DAY);
  });
});

describe('titles and demo XP', () => {
  it('titles are all English', () => {
    assert.deepEqual(TITLES.map((t) => t.name), ['Seedling', 'Farmhand', 'Farmer', 'Orchard Master', 'Durian King', 'Legend']);
  });

  it('demo mode gives 5x XP per harvest, normal mode 1x', () => {
    for (const [demo, xp] of [[true, 50], [false, 10]] as const) {
      const w = makeWorld({ demo });
      const p = w.newPlayer('ardian');
      w.game.checkin(p.id);
      const mango = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;
      w.game.plant(p.id, 0, mango.id);
      w.game.water(p.id, 0);
      w.advance(3 * MINUTE + 1000);
      const h = w.game.harvest(p.id, 0);
      assert.equal(h.kind === 'fruit' && h.xp, xp);
      assert.equal(h.kind === 'fruit' && h.firstHarvest, true);
      assert.equal(w.game.state(p.id).player.xp, xp);
      if (demo) assert.equal(h.kind === 'fruit' && h.titleUp, 'Farmhand');
    }
  });
});
