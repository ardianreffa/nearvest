// Memorial Trees stay visible: an old tree that dropped its seed (or a tree that was cut down)
// keeps standing on its plot as a Memorial Tree until the player plants there; every Memorial
// Tree is in the player's list. TaniBot never harvests an old tree's superior seed and never plants
// over a Memorial Tree (rules and AI): those are the player's decisions, said once in the Log.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDecision, type Brain, type BrainInput, type BrainResult } from '../src/brain.ts';
import { makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

/** A garden (TaniBot ready, auto-plant on) with a mango on plot 1, and a second mango seed in storage. */
async function garden(w: World) {
  const p = w.newPlayer('sari');
  await w.worker.drain();
  w.game.checkin(p.id);
  w.game.buy(p.id, 'seed_mango', 1);
  w.tanibot.setup(p.id, { dailyLimit: 20, budget: 20 });
  await w.worker.drain();
  w.tanibot.settings(p.id, { autoPlant: 'common' });
  const mango = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
  w.game.plant(p.id, 0, mango);
  await w.worker.drain();
  return p;
}

/** Makes the tree on a plot old and ripe (its superior seed is ready). */
const makeOldAndRipe = (w: World, playerId: number, plot: number) =>
  w.db.prepare("UPDATE trees SET harvest_count = max_harvests, growth = target WHERE player_id = ? AND plot = ? AND status = 'alive'").run(playerId, plot);

const log = (w: World, playerId: number) => w.tanibot.view(playerId)!.log;

describe('Memorial Trees stay visible', () => {
  it('an old tree that dropped its seed stands on its plot as a Memorial Tree, and is in the list', async () => {
    const w = makeWorld();
    const p = await garden(w);
    makeOldAndRipe(w, p.id, 0);
    const r = w.game.harvest(p.id, 0);
    assert.equal(r.kind, 'seed');
    await w.worker.drain();
    const s = w.game.state(p.id);
    assert.equal(s.plots[0].tree, null);
    assert.equal(s.plots[0].memorial!.species, 'mango');
    assert.equal(s.plots[0].memorial!.plot, 0);
    assert.equal(s.memorials.length, 1);
    assert.equal(s.memorials[0].tokenId, s.plots[0].memorial!.tokenId);
    assert.equal(w.chain.trees.get(s.memorials[0].tokenId!)!.memorial, true, 'the NFT is a Memorial Tree');
  });

  it('planting on that plot is allowed (never stuck); the Memorial Tree moves to the list', async () => {
    const w = makeWorld();
    const p = await garden(w);
    makeOldAndRipe(w, p.id, 0);
    w.game.harvest(p.id, 0);
    const seed = w.game.state(p.id).seeds.find((x: any) => x.species === 'mango' && x.parentTreeId === null)!;
    w.game.plant(p.id, 0, seed.id);
    const s = w.game.state(p.id);
    assert.ok(s.plots[0].tree);
    assert.equal(s.plots[0].memorial, null);
    assert.equal(s.memorials.length, 1);
    assert.equal(s.memorials[0].plot, null, 'still in the Memorial list, no longer on a plot');
  });

  it('a tree that is cut down also stands as a Memorial Tree', async () => {
    const w = makeWorld();
    const p = await garden(w);
    w.game.chop(p.id, 0);
    const s = w.game.state(p.id);
    assert.equal(s.plots[0].tree, null);
    assert.equal(s.plots[0].memorial!.species, 'mango');
  });
});

describe('Move to Memorials (without planting)', () => {
  it('moves the Memorial Tree to the list, the plot is empty, the NFT stays, no chain job', async () => {
    const w = makeWorld();
    const p = await garden(w);
    w.game.chop(p.id, 0);
    await w.worker.drain();
    const before = w.game.state(p.id);
    assert.equal(before.plots[0].memorial!.movable, true, 'the server tells the web it can move it');
    const tokenId = before.plots[0].memorial!.tokenId!;
    const jobs = () => (w.db.prepare('SELECT COUNT(*) AS n FROM chain_jobs').get() as { n: number }).n;
    const jobsBefore = jobs();
    const seedsBefore = before.seeds.length;
    assert.deepEqual(w.game.moveMemorial(p.id, 0), { moved: true });
    const s = w.game.state(p.id);
    assert.equal(s.plots[0].tree, null);
    assert.equal(s.plots[0].memorial, null, 'the plot is empty');
    assert.equal(s.memorials.length, 1);
    assert.equal(s.memorials[0].tokenId, tokenId);
    assert.equal(s.memorials[0].plot, null, 'in the Memorial list, no longer on a plot');
    assert.equal(s.seeds.length, seedsBefore, 'nothing planted, no seed used');
    assert.equal(jobs(), jobsBefore, 'no new chain transaction');
    assert.equal(w.chain.trees.get(tokenId)!.memorial, true, 'the NFT is still there, still a Memorial Tree');
    assert.equal(w.chain.trees.get(tokenId)!.owner, p.account_id, 'still the player\'s');
  });

  it('refuses a plot without a Memorial Tree (empty, living tree, locked, twice)', async () => {
    const w = makeWorld();
    const p = await garden(w);
    assert.throws(() => w.game.moveMemorial(p.id, 0), /no Memorial Tree/, 'a living tree');
    assert.throws(() => w.game.moveMemorial(p.id, 1), /no Memorial Tree/, 'an empty plot');
    assert.throws(() => w.game.moveMemorial(p.id, 5), /locked/);
    w.game.chop(p.id, 0);
    w.game.moveMemorial(p.id, 0);
    assert.throws(() => w.game.moveMemorial(p.id, 0), /no Memorial Tree/, 'already moved');
    assert.ok(w.game.state(p.id).plots[0].tree === null);
  });

  it('only moves your own Memorial Tree', async () => {
    const w = makeWorld();
    const p = await garden(w);
    w.game.chop(p.id, 0);
    const other = w.newPlayer('budi');
    await w.worker.drain();
    assert.throws(() => w.game.moveMemorial(other.id, 0), /no Memorial Tree/);
    assert.ok(w.game.state(p.id).plots[0].memorial, 'sari\'s Memorial Tree still stands');
  });

  it('the plot can be planted afterwards', async () => {
    const w = makeWorld();
    const p = await garden(w);
    w.game.chop(p.id, 0);
    w.game.moveMemorial(p.id, 0);
    const seed = w.game.state(p.id).seeds.find((x: any) => x.species === 'mango')!;
    w.game.plant(p.id, 0, seed.id);
    const s = w.game.state(p.id);
    assert.ok(s.plots[0].tree);
    assert.equal(s.memorials.length, 1);
  });
});

describe('TaniBot leaves old trees and Memorial Trees to the player', () => {
  it('rules: does not harvest an old tree; says why once', async () => {
    const w = makeWorld();
    const p = await garden(w);
    makeOldAndRipe(w, p.id, 0);
    w.tanibot.run(p.id);
    w.tanibot.run(p.id);
    const s = w.game.state(p.id);
    assert.ok(s.plots[0].tree, 'the old tree is still alive on its plot');
    assert.equal(s.memorials.length, 0);
    const notes = log(w, p.id).filter((l) => /superior seed ready/.test(l.reason));
    assert.equal(notes.length, 1, 'once');
    assert.match(notes[0].reason, /that is your call/);
  });

  it('rules: never plants over a Memorial Tree, even with auto-plant on and a seed in storage; says why once', async () => {
    const w = makeWorld();
    const p = await garden(w);
    makeOldAndRipe(w, p.id, 0);
    w.game.harvest(p.id, 0); // the player ends the old tree: a Memorial Tree stands on plot 1
    assert.ok(w.tanibot.plantableSeeds(p.id).length > 0);
    w.tanibot.run(p.id);
    w.tanibot.run(p.id);
    const s = w.game.state(p.id);
    assert.equal(s.plots[0].tree, null);
    assert.ok(s.plots[0].memorial);
    const notes = log(w, p.id).filter((l) => /Memorial Mango stands on plot 1/.test(l.reason));
    assert.equal(notes.length, 1);
    assert.match(notes[0].reason, /I leave that to you/);
    // Plot 2 has no Memorial Tree: auto-plant still works there.
    assert.ok(s.plots[1].tree, 'the free plot 2 was planted');
  });

  it('AI: an old-tree harvest and a plant over a Memorial Tree are refused by the rules', async () => {
    const brain: Brain & { inputs: BrainInput[]; answer: string } = {
      model: 'fake/brain',
      inputs: [],
      answer: '',
      async decide(input: BrainInput): Promise<BrainResult> {
        this.inputs.push(input);
        return { decision: parseDecision(this.answer), model: 'fake/brain', tokensIn: 1, tokensOut: 1, costUsd: 0 };
      },
    };
    const w = makeWorld({ brain });
    const p = await garden(w);
    // Plot 2 gets a tree that becomes old; plot 1 becomes a Memorial Tree.
    const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
    w.game.plant(p.id, 1, seed);
    makeOldAndRipe(w, p.id, 0);
    w.game.harvest(p.id, 0);
    makeOldAndRipe(w, p.id, 1);
    brain.answer = JSON.stringify({
      actions: [
        { action: 'harvest', plot: 2, reason: 'It is ripe' },
        { action: 'plant', plot: 1, reason: 'Plot 1 looks empty' },
      ],
      summary: 'Harvested and planted.',
    });
    await w.tanibot.runAi(p.id);
    assert.deepEqual(brain.inputs[0].emptyPlots, [], 'a Memorial plot is not "empty" for the AI');
    const ignored = log(w, p.id).find((l) => l.action === 'ignored')!;
    assert.match(ignored.reason, /old tree: its superior seed is the player's call/);
    assert.match(ignored.reason, /a Memorial Tree stands there/);
    const s = w.game.state(p.id);
    assert.ok(s.plots[1].tree, 'the old tree on plot 2 is untouched');
    assert.ok(s.plots[0].memorial, 'the Memorial Tree on plot 1 is untouched');
  });
});

describe('The Memorial NFT keeps the tree as it was when it died', () => {
  it('stage, age and harvest count go to the NFT before it becomes a Memorial', async () => {
    const w = makeWorld();
    const p = await garden(w);
    const day = w.game.state(p.id).player.demo ? 60_000 : 24 * 3_600_000;
    // The tree grows old with no stage change in between (no update was sent for days).
    w.advance(6 * day);
    makeOldAndRipe(w, p.id, 0);
    const tree = w.db.prepare("SELECT id, max_harvests FROM trees WHERE player_id = ? AND plot = 0").get(p.id) as { id: number; max_harvests: number };
    w.game.harvest(p.id, 0); // the old tree drops its seed and dies
    // The transactions land later: the NFT must still show the day the tree died.
    w.advance(3 * day);
    await w.worker.drain();
    const nft = w.chain.trees.get('1')!;
    assert.equal(nft.memorial, true);
    assert.equal(nft.stage, 'old');
    assert.equal(nft.ageDays, 6);
    assert.equal(nft.harvestCount, tree.max_harvests);
    // Update first, memorial second (the contract refuses updates of a Memorial Tree).
    const calls = w.chain.calls.filter((c) => c.method === 'update_tree' || c.method === 'make_memorial').map((c) => c.method);
    assert.deepEqual(calls.slice(-2), ['update_tree', 'make_memorial']);
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM chain_jobs WHERE status = 'failed'").get() as { n: number }).n, 0);
  });

  it('a tree that was cut down young keeps its own stage on the Memorial NFT', async () => {
    const w = makeWorld();
    const p = await garden(w);
    w.game.chop(p.id, 0);
    await w.worker.drain();
    const nft = w.chain.trees.get('1')!;
    assert.equal(nft.memorial, true);
    assert.equal(nft.stage, 'seed');
    assert.equal(nft.harvestCount, 0);
  });
});
