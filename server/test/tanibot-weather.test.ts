// TaniBot and the village weather (weather.ts): rain, drought, wilting trees, the Mount Tandur
// eruption (ash cleaned for free) and Volcanic soil; every action with its reason in the Log.
// The AI brain sees today's and tomorrow's weather; the game rules still check every suggestion.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDecision, type Brain, type BrainInput, type BrainResult } from '../src/brain.ts';
import { DEMO_DAY_MS } from '../src/clock.ts';
import { eruptionTimes, type WeatherKind, type WeatherSchedule } from '../src/weather.ts';
import { DAY, makeWorld, MINUTE, START } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

function schedule(kind: (day: number) => WeatherKind, eruptionDay?: number): WeatherSchedule {
  return {
    kind: (day) => kind(day),
    eruption: (day, demo) => (eruptionDay !== undefined && day === eruptionDay ? eruptionTimes(day, demo) : null),
  };
}

class FakeBrain implements Brain {
  readonly model = 'fake/brain';
  inputs: BrainInput[] = [];
  answer = '{"actions":[],"summary":""}';
  async decide(input: BrainInput): Promise<BrainResult> {
    this.inputs.push(input);
    return { decision: parseDecision(this.answer), model: this.model, tokensIn: 100, tokensOut: 20, costUsd: 0 };
  }
}

/** A garden with TaniBot ready, a durian on plot 1 and a mango on plot 2; the budget untouched. */
async function botGarden(w: World) {
  const p = w.newPlayer('sari');
  await w.worker.drain();
  w.game.checkin(p.id);
  w.tanibot.setup(p.id, { dailyLimit: 20, budget: 20 });
  await w.worker.drain();
  const seed = (species: string) => (w.db.prepare('SELECT id FROM seeds WHERE player_id = ? AND species = ? LIMIT 1').get(p.id, species) as { id: number }).id;
  w.game.plant(p.id, 0, seed('durian'));
  w.game.plant(p.id, 1, seed('mango'));
  return p;
}

const logOf = (w: World, playerId: number) => w.tanibot.view(playerId)!.log;
const budgetOf = (w: World, playerId: number) => w.tanibot.view(playerId)!.budget;
const TODAY = Math.floor(START / DAY);

describe('TaniBot and the weather (rules brain)', () => {
  it('rain: does not water, says why once', async () => {
    const w = makeWorld({ weather: schedule(() => 'rain') });
    const p = await botGarden(w);
    w.tanibot.run(p.id);
    w.tanibot.run(p.id);
    const log = logOf(w, p.id);
    assert.equal(log.filter((l) => l.action === 'water').length, 0);
    const rain = log.filter((l) => l.action === 'weather');
    assert.equal(rain.length, 1, 'once per rain day');
    assert.match(rain[0].reason, /raining: every tree is watered for free/);
  });

  it('drought: waters every tree twice and explains it', async () => {
    const w = makeWorld({ weather: schedule(() => 'drought') });
    const p = await botGarden(w);
    w.tanibot.run(p.id);
    const s = w.game.state(p.id);
    assert.equal(s.plots[0].tree!.waterCount, 2);
    assert.equal(s.plots[1].tree!.wateredToday, true);
    const water = logOf(w, p.id).find((l) => l.action === 'water')!;
    assert.match(water.reason, /Drought: a watering only lasts half a day, so I watered .* twice/);
  });

  it('waters a wilting tree first and says it was wilting; warns about a drought tomorrow', async () => {
    const w = makeWorld({ weather: schedule((d) => (d === TODAY + 3 ? 'drought' : 'clear')) });
    const p = await botGarden(w);
    w.game.water(p.id, 0);
    w.advance(2.6 * DAY); // the durian has been dry for 1.6 days: wilting
    assert.equal(w.game.state(p.id).plots[0].tree!.wilting, true);
    w.tanibot.run(p.id);
    const water = logOf(w, p.id).find((l) => l.action === 'water')!;
    assert.match(water.reason, /^Durian was wilting \(about to go back a stage\), so I watered it first\./);
    assert.match(water.reason, /drought is coming tomorrow/);
    assert.equal(w.game.state(p.id).plots[0].tree!.wilting, false);
  });

  it('eruption: warns once, then cleans the ash for free (budget untouched) and mentions Volcanic soil', async () => {
    const w = makeWorld({ weather: schedule(() => 'clear', TODAY) });
    const p = await botGarden(w);
    const e = eruptionTimes(TODAY, false);
    w.clock.t = e.warnStart + MINUTE;
    w.tanibot.run(p.id);
    w.tanibot.run(p.id);
    assert.equal(logOf(w, p.id).filter((l) => /rumbling/.test(l.reason)).length, 1);
    const budget = budgetOf(w, p.id);
    w.clock.t = e.start + MINUTE;
    assert.equal(w.game.state(p.id).plots[0].tree!.ash, true);
    w.tanibot.run(p.id);
    const s = w.game.state(p.id);
    assert.equal(s.plots[0].tree!.ash, false);
    assert.equal(s.plots[1].tree!.ash, false);
    const clean = logOf(w, p.id).find((l) => l.action === 'clean')!;
    assert.match(clean.reason, /Ash from Mount Tandur covered 2 trees, so I cleaned .*Volcanic soil.*Cleaning is free/);
    assert.equal(budgetOf(w, p.id), budget, 'cleaning uses no budget');
    w.clock.t = e.end + MINUTE;
    assert.equal(w.game.state(p.id).plots[0].tree!.volcanicSoil, true);
  });

  it('normal gardens: the ash is cleaned between scheduled rounds during the eruption', async () => {
    const w = makeWorld({ weather: schedule(() => 'clear', TODAY) });
    const p = await botGarden(w);
    const e = eruptionTimes(TODAY, false);
    w.db.prepare('UPDATE bots SET next_run_at = ? WHERE player_id = ?').run(e.volcanicEnd + DAY, p.id); // no round due
    w.clock.t = e.start + MINUTE;
    await w.tanibot.tick();
    assert.equal(w.game.state(p.id).plots[0].tree!.ash, false);
    assert.ok(logOf(w, p.id).some((l) => l.action === 'clean'));
    // Nothing else was done in that reaction (no watering, no selling).
    assert.equal(logOf(w, p.id).filter((l) => l.action === 'water').length, 0);
  });

  it('demo gardens: quick reactions clean the ash within seconds', async () => {
    const day = Math.floor(START / DEMO_DAY_MS);
    const w = makeWorld({ demo: true, weather: schedule(() => 'clear', day) });
    const p = await botGarden(w);
    const e = eruptionTimes(day, true);
    w.db.prepare('UPDATE bots SET next_run_at = ? WHERE player_id = ?').run(e.volcanicEnd + DAY, p.id);
    w.clock.t = e.start + 1000;
    await w.tanibot.tick();
    assert.equal(w.game.state(p.id).plots[0].tree!.ash, false);
  });
});

describe('TaniBot AI brain and the weather', () => {
  it('the AI sees today, tomorrow, the volcano and each tree (thirst, ash, waterings left)', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain, weather: schedule((d) => (d === TODAY ? 'drought' : 'rain'), TODAY) });
    const p = await botGarden(w);
    const e = eruptionTimes(TODAY, false);
    w.clock.t = e.start + MINUTE;
    await w.tanibot.runAi(p.id);
    const input = brain.inputs[0];
    assert.deepEqual(input.weather, { today: 'drought', tomorrow: 'rain', volcano: 'eruption', volcanoMinutesLeft: 59 });
    const durian = input.trees.find((t) => t.plot === 1)!;
    assert.equal(durian.ash, true);
    assert.equal(durian.waterTimesLeft, 2);
    assert.equal(typeof durian.daysToWilt, 'number');
    assert.ok('thirsty' in durian && 'wilting' in durian && 'volcanicSoil' in durian);
  });

  it('does a "clean" suggestion for free; a water suggestion in the rain is refused by the rules', async () => {
    const brain = new FakeBrain();
    const w = makeWorld({ brain, weather: schedule((d) => (d === TODAY ? 'rain' : 'clear'), TODAY) });
    const p = await botGarden(w);
    const e = eruptionTimes(TODAY, false);
    w.clock.t = e.start + MINUTE;
    const budget = budgetOf(w, p.id);
    brain.answer = JSON.stringify({
      actions: [
        { action: 'clean', plot: 1, reason: 'Ash is falling on the durian' },
        { action: 'water', plot: 2, reason: 'The mango needs water' },
      ],
      summary: 'Cleaned the durian.',
    });
    await w.tanibot.runAi(p.id);
    const log = logOf(w, p.id);
    const clean = log.find((l) => l.action === 'clean' && l.brain === 'ai')!;
    assert.match(clean.reason, /^Ash is falling on the durian\. Cleaned the volcanic ash off Durian on plot 1 \(free\)\./);
    const ignored = log.find((l) => l.action === 'ignored')!;
    assert.match(ignored.reason, /raining/);
    assert.equal(budgetOf(w, p.id), budget);
    // The safety net cleans what the AI missed (plot 2).
    assert.equal(w.game.state(p.id).plots[1].tree!.ash, false);
  });
});
