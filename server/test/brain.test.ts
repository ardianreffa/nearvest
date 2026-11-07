// TaniBot's AI brain with a FAKE AI (no NEAR AI calls in tests): the server
// checks every suggestion, ignores invalid ones, falls back to the rules on a
// broken answer, counts calls and costs, and respects the limits.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDecision, type Brain, type BrainInput, type BrainResult } from '../src/brain.ts';
import { DEMO_AI_INTERVAL_MS } from '../src/tanibot.ts';
import { makeWorld, MINUTE } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

/** A fake AI: answers with whatever the test sets, and remembers what it saw. */
class FakeBrain implements Brain {
  readonly model = 'fake/brain';
  calls = 0;
  inputs: BrainInput[] = [];
  answer: string | (() => never) = '{"actions":[],"summary":"Nothing to do."}';
  async decide(input: BrainInput): Promise<BrainResult> {
    this.calls++;
    this.inputs.push(input);
    if (typeof this.answer === 'function') this.answer();
    return { decision: parseDecision(this.answer as string), model: this.model, tokensIn: 500, tokensOut: 60, costUsd: 0.0001 };
  }
}

async function botGarden(w: World, opts = { dailyLimit: 20, budget: 20 }) {
  const p = w.newPlayer('sari');
  await w.worker.drain();
  w.tanibot.setup(p.id, opts);
  await w.worker.drain();
  return p;
}

const seedOf = (w: World, playerId: number, species: string) =>
  (w.db.prepare('SELECT id FROM seeds WHERE player_id = ? AND species = ? LIMIT 1').get(playerId, species) as { id: number }).id;

describe('parseDecision', () => {
  it('reads plain JSON and JSON inside a ```json fence, and cleans reasons', () => {
    const d = parseDecision('Sure!\n```json\n{"actions":[{"action":"water","plot":1,"reason":"  Dry   soil  "}],"summary":"ok"}\n```');
    assert.deepEqual(d.actions, [{ action: 'water', plot: 1, reason: 'Dry soil' }]);
    assert.equal(d.summary, 'ok');
  });
  it('counts malformed suggestions and rejects non-JSON', () => {
    const d = parseDecision('{"actions":[{"action":"dance"},{"action":"water"},{"action":"harvest","plot":2}]}');
    assert.equal(d.actions.length, 1);
    assert.equal(d.malformed, 2);
    assert.throws(() => parseDecision('I think you should water the mango.'), /not JSON/);
    assert.throws(() => parseDecision('{"plan":"water"}'), /no "actions"/);
  });
});

describe('TaniBot with the AI brain (fake AI)', () => {
  it('does what the AI suggests, logs the AI reason marked as AI, and buys before fertilizing', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain });
    const p = await botGarden(w);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    brain.answer = JSON.stringify({
      actions: [
        { action: 'water', plot: 1, reason: 'The durian looks thirsty' },
        { action: 'fertilize', plot: 1, reason: 'Durian grows slowly, a boost helps' },
      ],
      summary: 'Watered and fed the durian.',
    });
    await w.tanibot.tick();
    await w.worker.drain();
    assert.equal(brain.calls, 1);
    const tree = w.game.state(p.id).plots[0].tree!;
    assert.equal(tree.wateredToday && tree.isFertilized, true);
    const log = w.tanibot.view(p.id)!.log;
    const water = log.find((l) => l.action === 'water')!;
    assert.equal(water.brain, 'ai');
    assert.match(water.reason, /^The durian looks thirsty\. Watered Durian on plot 1\./);
    const buy = log.find((l) => l.action === 'buy')!;
    assert.equal(buy.brain, 'ai');
    assert.equal(buy.txStatus, 'done', 'the purchase is a real burn by the bot key');
    assert.ok(log.some((l) => l.action === 'summary' && l.reason === 'Watered and fed the durian.'));
    // What the AI saw: garden, prices, budget and style; no keys or account secrets.
    const input = JSON.stringify(brain.inputs[0]);
    assert.match(input, /"style":"balanced"/);
    assert.doesNotMatch(input, /secret|ed25519|nearvest\.testnet/);
  });

  it('ignores suggestions the game rules do not allow, and says so', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain });
    const p = await botGarden(w);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    w.db.prepare("INSERT INTO fruits (player_id, species, quality, qty) VALUES (?, 'durian', 'rare', 1)").run(p.id);
    brain.answer = JSON.stringify({
      actions: [
        { action: 'harvest', plot: 1, reason: 'harvest now' },
        { action: 'water', plot: 9, reason: 'water plot 9' },
        { action: 'sell', species: 'durian', quality: 'rare', qty: 1, reason: 'good price' },
        { action: 'buy', item: 'fertilizer', qty: 5, reason: 'stock up' },
        { action: 'fly', reason: 'why not' },
      ],
    });
    await w.tanibot.tick();
    const log = w.tanibot.view(p.id)!.log;
    const ignored = log.find((l) => l.action === 'ignored')!;
    assert.equal(ignored.brain, 'ai');
    assert.match(ignored.reason, /ignored 5 AI suggestions/);
    assert.match(ignored.reason, /not ripe/);
    assert.match(ignored.reason, /plot 9/);
    assert.match(ignored.reason, /Rare and Gold are your call/);
    assert.match(ignored.reason, /only 1 fertilizer/);
    assert.equal(w.game.state(p.id).fruits.find((f) => f.quality === 'rare')!.qty, 1, 'rare fruit kept');
    assert.equal(w.tanibot.view(p.id)!.budget, 20, 'nothing bought');
    // Safety net: the AI forgot to water, the rules still did.
    const net = log.find((l) => l.action === 'water')!;
    assert.equal(net.brain, 'rules');
    assert.match(net.reason, /^Safety net: Watered/);
  });

  it('a broken answer or a timeout falls back to the simple rules and is logged', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain });
    const p = await botGarden(w);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    brain.answer = 'Sorry, I cannot help with farming today.';
    await w.tanibot.tick();
    let log = w.tanibot.view(p.id)!.log;
    assert.ok(log.some((l) => l.action === 'notice' && /did not answer properly \(AI answer is not JSON\)/.test(l.reason)));
    assert.ok(w.game.state(p.id).plots[0].tree!.wateredToday, 'rules watered instead');

    brain.answer = () => {
      throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    };
    w.advance(6 * 60 * MINUTE); // next scheduled round
    await w.tanibot.tick();
    log = w.tanibot.view(p.id)!.log;
    assert.ok(log.some((l) => /it took too long/.test(l.reason)));
    const t = w.meter.totals(w.now());
    assert.equal(t.callsTotal, 2, 'failed calls are counted too');
  });

  it('demo gardens call the AI at most once per 10 minutes; quick reactions never call it', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain, demo: true });
    const p = await botGarden(w);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    await w.tanibot.tick(); // round 1: AI
    assert.equal(brain.calls, 1);
    for (let i = 0; i < 9; i++) {
      w.advance(MINUTE); // trees get dry every demo day: quick reactions + 2-minute rounds
      await w.tanibot.tick();
      w.advance(10_000);
      await w.tanibot.tick();
    }
    assert.equal(brain.calls, 1, 'no AI within 10 minutes');
    assert.ok(w.game.state(p.id).plots[0].tree!.wateredToday, 'the rules kept watering');
    w.advance(DEMO_AI_INTERVAL_MS);
    await w.tanibot.tick();
    assert.equal(brain.calls, 2);
  });

  it('the same number of AI calls for Thrifty, Balanced and Turbo', async () => {
    const counts: number[] = [];
    for (const style of ['thrifty', 'balanced', 'turbo']) {
      const brain = new FakeBrain();
      const w = makeWorld({ brain });
      const p = await botGarden(w);
      w.tanibot.settings(p.id, { style });
      for (let i = 0; i < 3; i++) {
        await w.tanibot.tick();
        w.advance(8 * 60 * MINUTE);
      }
      counts.push(brain.calls);
      assert.equal(brain.inputs[0].style, style, 'the style is only context for the AI');
    }
    assert.deepEqual(counts, [3, 3, 3]);
  });

  it('the daily call limit and the dollar brake switch the AI off (rules take over)', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain, aiLimits: { maxCallsPerDay: 2, budgetUsd: 8 } });
    const p = await botGarden(w);
    for (let i = 0; i < 3; i++) {
      await w.tanibot.tick();
      w.advance(8 * 60 * MINUTE);
    }
    assert.equal(brain.calls, 2);
    assert.ok(w.tanibot.view(p.id)!.log.some((l) => /call limit \(2\) was reached/.test(l.reason)));

    const brain2 = new FakeBrain();
    const w2 = makeWorld({ brain: brain2, aiLimits: { maxCallsPerDay: 100, budgetUsd: 0.00015 } });
    await botGarden(w2);
    for (let i = 0; i < 3; i++) {
      await w2.tanibot.tick();
      w2.advance(8 * 60 * MINUTE);
    }
    assert.equal(brain2.calls, 2, 'stops once the estimated total reaches the brake');
    assert.ok(w2.tanibot.view(1)!.log.some((l) => /budget brake/.test(l.reason)));
  });

  it('shows the brain and model in the API', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain });
    assert.deepEqual(w.tanibot.brainInfo(), { brain: 'ai', model: 'fake/brain' });
    assert.deepEqual(makeWorld().tanibot.brainInfo(), { brain: 'rules', model: null });
  });
});
