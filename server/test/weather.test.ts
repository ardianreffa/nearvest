import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, it } from 'node:test';
import { DEMO_DAY_MS, REAL_DAY_MS } from '../src/clock.ts';
import { openDb } from '../src/db.ts';
import { advance, fruitOdds, stageOf, thirstOf, wiltBack, type TreeGrowth } from '../src/rules.ts';
import {
  DEMO_CYCLE,
  DROUGHT_CHANCE,
  eruptionAt,
  eruptionTimes,
  RAIN_CHANCE,
  skyView,
  villageWeather,
  VOLCANIC_BOOST,
  VOLCANIC_GOLD_BONUS,
  WILT_DAYS,
  WILT_DAYS_DEMO,
  type WeatherKind,
  type WeatherSchedule,
} from '../src/weather.ts';
import { DAY, HOUR, makeWorld, MINUTE, START } from './helpers.ts';

/** A schedule for tests: `kind` per day, and an eruption whose warning starts on `eruptionDay`. */
function schedule(kind: (day: number) => WeatherKind, eruptionDay?: (demo: boolean) => number | null): WeatherSchedule {
  return {
    kind: (day) => kind(day),
    eruption: (day, demo) => (eruptionDay && eruptionDay(demo) === day ? eruptionTimes(day, demo) : null),
  };
}

const clear = schedule(() => 'clear');
const TODAY = Math.floor(START / DAY);

describe('weather schedule', () => {
  it('is the same for the same day, every time (no table, survives a restart)', () => {
    for (let d = 20000; d < 20100; d++) {
      assert.equal(villageWeather.kind(d, false), villageWeather.kind(d, false));
      assert.deepEqual(villageWeather.eruption(d, false), villageWeather.eruption(d, false));
    }
  });

  it('normal mode: about 20% rain, 12% drought, rare eruptions never closer than 3 days, only on clear days', () => {
    const n = 20000;
    let rain = 0;
    let drought = 0;
    let eruptions = 0;
    let last = -10;
    for (let d = 0; d < n; d++) {
      const k = villageWeather.kind(d, false);
      if (k === 'rain') rain++;
      if (k === 'drought') drought++;
      if (villageWeather.eruption(d, false)) {
        eruptions++;
        assert.equal(k, 'clear');
        assert.ok(d - last >= 3, `eruptions on day ${last} and ${d}`);
        last = d;
      }
    }
    assert.ok(Math.abs(rain / n - RAIN_CHANCE) < 0.02, `rain ${rain / n}`);
    assert.ok(Math.abs(drought / n - DROUGHT_CHANCE) < 0.02, `drought ${drought / n}`);
    assert.ok(eruptions / n > 0.04 && eruptions / n < 0.1, `eruptions ${eruptions / n}`);
  });

  it('demo mode: a fixed 10-minute cycle with rain, a drought and an eruption', () => {
    assert.equal(DEMO_CYCLE.length, 10);
    const kinds = DEMO_CYCLE.map((_, i) => villageWeather.kind(i, true));
    assert.ok(kinds.includes('rain') && kinds.includes('drought'));
    const eruptionDays = DEMO_CYCLE.map((_, i) => i).filter((i) => villageWeather.eruption(i, true));
    assert.equal(eruptionDays.length, 1);
    // The cycle repeats.
    assert.equal(villageWeather.kind(13, true), villageWeather.kind(3, true));
    assert.ok(villageWeather.eruption(eruptionDays[0] + 10, true));
  });

  it('an eruption has three phases: warning, eruption, Volcanic soil', () => {
    const sky = skyView(villageWeather, true);
    const e = eruptionTimes(6, true);
    assert.equal(eruptionAt(sky, e.warnStart + 1)!.phase, 'warning');
    assert.equal(eruptionAt(sky, e.start + 1)!.phase, 'eruption');
    assert.equal(eruptionAt(sky, e.end + 1)!.phase, 'volcanic');
    assert.equal(eruptionAt(sky, e.volcanicEnd + 1), null);
    assert.equal(eruptionAt(sky, e.warnStart - 1), null);
  });
});

describe('growth rules with the weather', () => {
  const base: TreeGrowth = { growth: 0, target: 10, lastTickMs: 0, waterUntilMs: 0, fertUntilMs: 0, harvestCount: 0, maxHarvests: 3, dryFromMs: 0 };
  const day = REAL_DAY_MS;

  it('rain waters every tree for free', () => {
    const sky = skyView(schedule((d) => (d === 1 ? 'rain' : 'clear')), false);
    const g = advance({ ...base, dryFromMs: 0 }, 2 * day, day, sky);
    assert.equal(g.growth, 1); // only the rain day
  });

  it('2 days without water: back one stage, then the count starts again; never below a seed', () => {
    const sky = skyView(clear, false);
    const grown = { ...base, growth: 7 }; // 70%: tree
    assert.equal(stageOf(grown), 'tree');
    let g = advance(grown, 2 * day - 1, day, sky);
    assert.equal(stageOf(g), 'tree');
    assert.equal(thirstOf(g, 2 * day - 1, sky).wilting, true);
    g = advance(g, 2 * day, day, sky);
    assert.equal(stageOf(g), 'sprout');
    assert.equal(g.wiltedAtMs, 2 * day);
    g = advance(g, 3.9 * day, day, sky);
    assert.equal(stageOf(g), 'sprout', 'the count started again after the wilt');
    g = advance(g, 4 * day, day, sky);
    assert.equal(stageOf(g), 'seed');
    g = advance(g, 30 * day, day, sky);
    assert.equal(stageOf(g), 'seed', 'a seed never goes further back, and the tree never dies');
  });

  it('the result is the same whether it is checked often or once', () => {
    const sky = skyView(schedule((d) => (['clear', 'rain', 'drought'] as const)[d % 3], () => 4), false);
    const t = { ...base, growth: 6, waterUntilMs: 0.7 * day, fertUntilMs: 0.4 * day, ashCleanMs: 0 };
    const once = advance(t, 9 * day, day, sky);
    let step: TreeGrowth = t;
    for (let ms = 0; ms <= 9 * day; ms += 37 * MINUTE) step = advance(step, ms, day, sky);
    step = advance(step, 9 * day, day, sky);
    assert.ok(Math.abs(once.growth - step.growth) < 1e-9);
    assert.equal(once.dryFromMs, step.dryFromMs);
    assert.equal(once.wiltedAtMs, step.wiltedAtMs);
  });

  it('demo mode wilts only after about 10 demo days', () => {
    const sky = skyView(clear, true);
    const g0 = { ...base, growth: 7 };
    assert.equal(sky.wiltMs, WILT_DAYS_DEMO * DEMO_DAY_MS);
    assert.equal(stageOf(advance(g0, (WILT_DAYS_DEMO - 0.1) * DEMO_DAY_MS, DEMO_DAY_MS, sky)), 'tree');
    assert.equal(stageOf(advance(g0, WILT_DAYS_DEMO * DEMO_DAY_MS, DEMO_DAY_MS, sky)), 'sprout');
    assert.equal(WILT_DAYS, 2);
  });

  it('wilting: fruiting -> tree, a regrowing tree loses its progress, old trees are not affected', () => {
    assert.equal(wiltBack({ growth: 10, target: 10, harvestCount: 0, maxHarvests: 3 }, 10), 6);
    assert.equal(wiltBack({ growth: 5, target: 10, harvestCount: 1, maxHarvests: 3 }, 5), 0);
    assert.equal(wiltBack({ growth: 5, target: 10, harvestCount: 3, maxHarvests: 3 }, 5), 5);
    const sky = skyView(clear, false);
    const oldTree = advance({ ...base, growth: 5, harvestCount: 3 }, 20 * day, day, sky);
    assert.equal(oldTree.growth, 5);
    assert.equal(stageOf(oldTree), 'old');
  });

  it('volcanic ash stops growth until cleaned; Volcanic soil grows cleaned trees faster', () => {
    const e = eruptionTimes(0, false);
    const sky = skyView(schedule(() => 'clear', () => 0), false);
    const watered = { ...base, waterUntilMs: 5 * day, dryFromMs: 0 };
    // Not cleaned: no growth during the eruption hour, no bonus afterwards.
    const dirty = advance(watered, e.volcanicEnd, day, sky);
    assert.ok(Math.abs(dirty.growth - (e.volcanicEnd - (e.end - e.start)) / day) < 1e-9);
    // Cleaned 10 minutes into the eruption: grows again from then, +30% on Volcanic soil.
    const cleanAt = e.start + 10 * MINUTE;
    const clean = advance({ ...watered, ashCleanMs: cleanAt }, e.volcanicEnd, day, sky);
    const expected = (e.start + (e.end - cleanAt) + (1 + VOLCANIC_BOOST) * (e.volcanicEnd - e.end)) / day;
    assert.ok(Math.abs(clean.growth - expected) < 1e-9);
  });

  it('Volcanic soil moves a little chance to Gold', () => {
    const odds = fruitOdds('common', false, VOLCANIC_GOLD_BONUS);
    assert.equal(odds.gold, VOLCANIC_GOLD_BONUS);
    assert.equal(odds.common, 1 - VOLCANIC_GOLD_BONUS);
    assert.deepEqual(fruitOdds('gold', false, VOLCANIC_GOLD_BONUS), { common: 0, rare: 0, gold: 1 });
  });
});

/** A garden with a mango tree (normal speed, 1 day to fruit) on plot 1. */
function gardenWithMango(weather: WeatherSchedule, demo = false) {
  const w = makeWorld({ weather, demo });
  const p = w.newPlayer('ardian');
  w.game.checkin(p.id);
  const seeds = w.game.state(p.id).seeds;
  w.game.plant(p.id, 0, seeds[0].id); // the first tree (fast)
  w.game.plant(p.id, 1, seeds.find((s: any) => s.species === 'mango')!.id);
  return { w, p };
}

describe('the game with the weather', () => {
  it('rain: trees are watered for free and watering by hand is not needed', () => {
    const { w, p } = gardenWithMango(schedule(() => 'rain'));
    const s = w.game.state(p.id);
    assert.equal(s.weather.kind, 'rain');
    assert.equal(s.weather.waterNeed, 0);
    assert.equal(s.plots[1].tree!.wateredToday, true);
    assert.equal(s.plots[1].tree!.isWatered, true);
    assert.throws(() => w.game.water(p.id, 1), /raining/);
    w.advance(DAY / 2);
    assert.equal(w.game.state(p.id).plots[1].tree!.growthPercent, 50);
  });

  it('drought: a tree needs two waterings; one only lasts half a day', () => {
    const { w, p } = gardenWithMango(schedule(() => 'drought'));
    assert.equal(w.game.state(p.id).weather.waterNeed, 2);
    const first = w.game.water(p.id, 1);
    assert.deepEqual([first.waterings, first.needed], [1, 2]);
    assert.equal(w.game.state(p.id).plots[1].tree!.wateredToday, false);
    w.game.water(p.id, 1);
    assert.equal(w.game.state(p.id).plots[1].tree!.wateredToday, true);
    assert.throws(() => w.game.water(p.id, 1), /twice/);
    w.advance(DAY);
    assert.equal(w.game.state(p.id).plots[1].tree!.ready, true);
  });

  it('a dry tree warns first, then goes back one stage and the NFT follows; it never dies', async () => {
    const { w, p } = gardenWithMango(clear);
    w.game.water(p.id, 1);
    w.advance(0.7 * DAY);
    await w.worker.drain();
    w.game.syncStages();
    await w.worker.drain();
    assert.equal(w.game.state(p.id).plots[1].tree!.stage, 'tree');
    const tokenId = w.game.state(p.id).plots[1].tree!.tokenId!;
    // The water ran out at 1 day, when the mango was ripe: thirsty after 1 more day, wilting after 1.5.
    w.advance(0.3 * DAY + 1.6 * DAY);
    let t = w.game.state(p.id).plots[1].tree!;
    assert.equal(t.thirsty, true);
    assert.equal(t.wilting, true);
    assert.equal(t.stage, 'fruiting');
    w.advance(0.4 * DAY + MINUTE);
    t = w.game.state(p.id).plots[1].tree!;
    assert.equal(t.stage, 'tree', 'the fruit is lost: back one stage');
    assert.equal(t.wiltedRecently, true);
    w.game.syncStages();
    await w.worker.drain();
    assert.equal(w.chain.trees.get(tokenId)!.stage, 'tree');
    // Never stuck: a long time later the tree is still there, a seed at worst, and can be watered.
    w.advance(30 * DAY);
    t = w.game.state(p.id).plots[1].tree!;
    assert.ok(t, 'the tree is still on its plot');
    assert.equal(t.stage, 'seed');
    w.game.water(p.id, 1);
    assert.equal(w.game.state(p.id).plots[1].tree!.thirsty, false);
  });

  it('eruption: warning -> ash (clean it) -> Volcanic soil with a better Gold chance; no tree is lost', () => {
    const { w, p } = gardenWithMango(schedule(() => 'clear', (demo) => (demo ? null : TODAY)));
    const e = eruptionTimes(TODAY, false);
    w.game.water(p.id, 1);
    w.clock.t = e.warnStart + MINUTE;
    let s = w.game.state(p.id);
    assert.equal(s.weather.eruption!.phase, 'warning');
    assert.throws(() => w.game.cleanAsh(p.id, 1), /no ash/);
    w.clock.t = e.start + MINUTE;
    s = w.game.state(p.id);
    assert.equal(s.weather.eruption!.phase, 'eruption');
    assert.equal(s.plots[1].tree!.ash, true);
    const before = s.plots[1].tree!.growthPercent;
    w.clock.t = e.start + 20 * MINUTE;
    assert.equal(w.game.state(p.id).plots[1].tree!.growthPercent, before, 'ash: no growth');
    w.game.cleanAsh(p.id, 1);
    assert.throws(() => w.game.cleanAsh(p.id, 1), /already clean/);
    assert.equal(w.game.state(p.id).plots[1].tree!.ash, false);
    w.clock.t = e.end + MINUTE;
    s = w.game.state(p.id);
    assert.equal(s.weather.eruption!.phase, 'volcanic');
    assert.equal(s.plots[1].tree!.volcanicSoil, true);
    assert.equal(s.plots[1].tree!.nextHarvestOdds.gold, VOLCANIC_GOLD_BONUS);
    assert.throws(() => w.game.cleanAsh(p.id, 1), /over/);
    // Nothing was lost.
    assert.equal(s.plots.filter((x: any) => x.tree).length, 2);
    w.clock.t = e.volcanicEnd + MINUTE;
    s = w.game.state(p.id);
    assert.equal(s.weather.eruption, null);
    assert.equal(s.plots[1].tree!.nextHarvestOdds.gold, 0);
  });

  it('demo gardens follow the demo cycle; normal gardens the normal weather', () => {
    const w = makeWorld({ weather: villageWeather, demo: true });
    const p = w.newPlayer('demo');
    const day = Math.floor(w.now() / DEMO_DAY_MS);
    assert.equal(w.game.state(p.id).weather.kind, villageWeather.kind(day, true));
    assert.equal(w.game.state(p.id).weather.wiltDays, WILT_DAYS_DEMO);
  });

  it('the release does not wilt gardens that were dry before the weather existed', () => {
    const dir = mkdtempSync(join(tmpdir(), 'nearvest-weather-'));
    try {
      const file = join(dir, 'old.sqlite');
      // A database from before the weather: no weather columns, a tree last watered long ago.
      const db = openDb(file);
      db.exec('ALTER TABLE trees DROP COLUMN dry_from');
      db.exec('PRAGMA foreign_keys = OFF');
      db.prepare(
        `INSERT INTO trees (player_id, plot, species, quality, planted_at, growth, target, last_tick, water_until, max_harvests, regrow_days)
         VALUES (1, 0, 'mango', 'common', 0, 0.8, 1, 0, 0, 3, 0.5)`,
      ).run();
      db.close();
      const before = Date.now();
      openDb(file).close();
      const row = new DatabaseSync(file).prepare('SELECT dry_from FROM trees').get() as { dry_from: number };
      assert.ok(row.dry_from >= before, 'thirst counts from the release');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

void HOUR;
