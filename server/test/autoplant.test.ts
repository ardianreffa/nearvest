// TaniBot auto-plant: off by default; with "Common seeds only" it plants Common / unknown seeds
// in empty plots (a real Tree NFT each), never Rare, Gold or superior seeds; when no seed is
// left, Thrifty never buys while Balanced / Turbo buy a Mango seed from the bot budget (burned,
// within the contract's daily limit). The AI's "plant" suggestions are checked by the same rules.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDecision, type Brain, type BrainInput, type BrainResult } from '../src/brain.ts';
import { makeWorld, UNIT } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

class FakeBrain implements Brain {
  readonly model = 'fake/brain';
  inputs: BrainInput[] = [];
  answer = '{"actions":[],"summary":""}';
  async decide(input: BrainInput): Promise<BrainResult> {
    this.inputs.push(input);
    return { decision: parseDecision(this.answer), model: this.model, tokensIn: 100, tokensOut: 20, costUsd: 0.00001 };
  }
}

async function botGarden(w: World, style: 'thrifty' | 'balanced' | 'turbo' = 'balanced', opts = { dailyLimit: 20, budget: 20 }) {
  const p = w.newPlayer('sari');
  await w.worker.drain();
  w.tanibot.setup(p.id, opts);
  await w.worker.drain();
  w.tanibot.settings(p.id, { style });
  return p;
}

const seeds = (w: World, id: number) => w.game.state(id).seeds.map((s) => `${s.species}:${s.quality ?? 'unknown'}`).sort();
const trees = (w: World, id: number) => w.game.state(id).plots.map((p) => (p.tree ? `${p.tree.species}` : p.locked ? 'locked' : 'empty'));
const addSeed = (w: World, id: number, species: string, quality: string | null, parent: number | null = null) =>
  w.db.prepare("INSERT INTO seeds (player_id, species, quality, parent_tree_id, source, created_at) VALUES (?, ?, ?, ?, 'test', 0)").run(id, species, quality, parent);

describe('TaniBot auto-plant', () => {
  it('is off by default: empty plots stay empty even with seeds in storage', async () => {
    const w = makeWorld({ demo: true });
    const p = await botGarden(w);
    addSeed(w, p.id, 'mango', null);
    assert.equal(w.tanibot.view(p.id)!.autoPlant, 'off');
    w.tanibot.run(p.id);
    assert.deepEqual(trees(w, p.id), ['empty', 'empty', 'locked']);
  });

  it('plants only Common / unknown seeds: never the Rare Durian, a Gold seed or a superior seed', async () => {
    const w = makeWorld({ demo: true });
    const p = await botGarden(w, 'thrifty');
    addSeed(w, p.id, 'durian', 'gold');
    addSeed(w, p.id, 'rambutan', null, 999); // a superior seed from an old tree
    addSeed(w, p.id, 'mango', null); // check-in seed
    w.tanibot.settings(p.id, { autoPlant: 'common' });
    w.tanibot.run(p.id);
    // One plot got the Mango; the other stays empty (Thrifty never buys, nothing else is allowed).
    assert.deepEqual(trees(w, p.id).sort(), ['empty', 'locked', 'mango']);
    assert.deepEqual(seeds(w, p.id), ['durian:gold', 'durian:rare', 'rambutan:unknown']);
    const line = w.tanibot.view(p.id)!.log.find((l) => l.action === 'plant')!;
    assert.match(line.reason, /planted a unknown-quality Mango seed: a new Tree NFT was minted/);
    await w.worker.drain();
    assert.equal(w.tanibot.view(p.id)!.log.find((l) => l.action === 'plant')!.txStatus, 'done', 'the mint landed');
    assert.equal(w.chain.trees.size, 1);
  });

  it('Thrifty never buys: with no seed left the bot budget and today\'s spending stay the same', async () => {
    const w = makeWorld({ demo: true });
    const p = await botGarden(w, 'thrifty', { dailyLimit: 20, budget: 20 });
    w.tanibot.settings(p.id, { autoPlant: 'common' });
    const before = w.tanibot.view(p.id)!;
    for (let i = 0; i < 3; i++) w.tanibot.run(p.id);
    await w.worker.drain();
    await w.tanibot.sync(p.id);
    const after = w.tanibot.view(p.id)!;
    assert.equal(after.budget, before.budget, 'budget unchanged');
    assert.equal(after.budget, 20);
    assert.equal(after.spentToday, 0);
    assert.equal(await w.chain.ftBalanceOf(after.accountId), 20n * UNIT, 'nothing burned from the bot wallet');
    assert.ok(!after.log.some((l) => l.action === 'buy'), 'no purchase in the Log');
    assert.deepEqual(trees(w, p.id), ['empty', 'empty', 'locked'], 'the Rare Durian was not planted either');
  });

  it('Balanced buys a Mango seed from the bot budget (burned, within the daily limit) when none is left', async () => {
    const w = makeWorld({ demo: true });
    const p = await botGarden(w, 'balanced', { dailyLimit: 5, budget: 20 });
    w.tanibot.settings(p.id, { autoPlant: 'common' });
    w.tanibot.run(p.id);
    await w.worker.drain();
    // Limit 5 PANEN = one Mango seed: one plot planted, the second waits for tomorrow.
    assert.deepEqual(trees(w, p.id).sort(), ['empty', 'locked', 'mango']);
    const bot = w.tanibot.view(p.id)!;
    assert.equal(bot.spentToday, 5);
    assert.equal(bot.budget, 15);
    assert.equal(await w.chain.ftBalanceOf(bot.accountId), 15n * UNIT, 'the purchase was burned from the bot wallet');
    assert.ok(bot.log.some((l) => l.action === 'buy' && /Mango seed/.test(l.reason) && l.txStatus === 'done'));
    assert.deepEqual(seeds(w, p.id), ['durian:rare'], 'the welcome Rare Durian is still in storage');
  });

  it('the AI may suggest "plant"; the game rules check it (off, not empty, Thrifty without seeds)', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ demo: true, brain });
    const p = await botGarden(w, 'thrifty');
    brain.answer = JSON.stringify({ actions: [{ action: 'plant', plot: 1, reason: 'Empty plot.' }], summary: 'Planted.' });
    await w.tanibot.runAi(p.id);
    assert.ok(w.tanibot.view(p.id)!.log.some((l) => /plant \(auto-plant is off\)/.test(l.reason)));

    w.tanibot.settings(p.id, { autoPlant: 'common' });
    await w.tanibot.runAi(p.id);
    assert.ok(w.tanibot.view(p.id)!.log.some((l) => /no Common seed; Thrifty never buys/.test(l.reason)));
    assert.equal(brain.inputs.at(-1)!.autoPlant, true);
    assert.deepEqual(brain.inputs.at(-1)!.emptyPlots, [1, 2]);
    assert.equal(brain.inputs.at(-1)!.plantableSeeds, 0, 'the Rare Durian does not count');

    addSeed(w, p.id, 'mango', 'common');
    brain.answer = JSON.stringify({ actions: [{ action: 'plant', plot: 1, reason: 'Empty plot, a Mango grows fast.' }, { action: 'plant', plot: 1, reason: 'Again.' }], summary: 'Planted.' });
    await w.tanibot.runAi(p.id);
    assert.deepEqual(trees(w, p.id), ['mango', 'empty', 'locked']);
    const line = w.tanibot.view(p.id)!.log.find((l) => l.action === 'plant')!;
    assert.equal(line.brain, 'ai');
    assert.match(line.reason, /^Empty plot, a Mango grows fast\. Plot 1 was empty/);
    assert.ok(w.tanibot.view(p.id)!.log.some((l) => /plant on plot 1 \(not an empty plot\)/.test(l.reason)));
  });

  it('judge gardens start with auto-plant on', async () => {
    const w = makeWorld({ demo: true });
    const res = await w.app.request('/auth/judge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ deviceId: 'device-000000000001' }) });
    const id = (w.db.prepare("SELECT p.id FROM players p JOIN users u ON u.id = p.user_id WHERE u.provider = 'judge'").get() as { id: number }).id;
    assert.equal(res.status, 200);
    assert.equal(w.tanibot.view(id)!.autoPlant, 'common');
  });
});
