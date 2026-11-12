// The fishing pond's life and mood (src/pond-life-plan.ts, Fishing package 2): village clock, rain
// only (never ash), which sounds play, frogs on their pads, ducks on the right-hand side.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLOAT_AT } from '../src/art/rod-pose.ts';
import {
  CRITTERS,
  DUCK_GAP,
  DUCK_STARTS,
  duckAt,
  ducksAsleep,
  inZone,
  mustFlee,
  planDuck,
  still,
  swimmable,
  WATERFALL_FOOT,
  type DuckMove,
  type FishingZone,
  FROG_SPOTS,
  FROGS,
  frogTick,
  LEAF_COLORS,
  moodMix,
  nextMood,
  pickJump,
  POND_HOLD_DEMO_MS,
  pondFit,
  PHONE_PANEL_MIN,
  PHONE_TOP_CROP,
  pondMix,
  pondSounds,
  pondTime,
  pondWeather,
  startFrogs,
} from '../src/pond-life-plan.ts';

/** A repeatable random source. */
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

describe('fishing pond life', () => {
  it('follows the village clock: morning, day, dusk, night (same hours as ?time=day|dusk|night)', () => {
    assert.equal(pondTime(6), 'morning');
    assert.equal(pondTime(9.5), 'morning');
    assert.equal(pondTime(12), 'day'); // ?time=day
    assert.equal(pondTime(17.75), 'dusk'); // ?time=dusk
    assert.equal(pondTime(23), 'night'); // ?time=night
    assert.equal(pondTime(3), 'night');
  });

  it('only rain reaches the pond: no eruption or ash (they show a clear pond)', () => {
    assert.equal(pondWeather('rain'), 'rain');
    for (const look of ['clear', 'drought', 'warning', 'eruption', 'volcanic'] as const) assert.equal(pondWeather(look), 'clear', look);
  });

  it('sounds: breeze by day, frogs + crickets and no ducks at night (rain too), rain with frogs (ducks only by day)', () => {
    const day = pondSounds('day', 'clear');
    assert.ok(day.waterfall && day.ripples && day.breeze && day.ducks && day.frogs && !day.crickets && !day.rain);
    assert.ok(pondSounds('morning', 'clear').breeze);
    const night = pondSounds('night', 'clear');
    assert.ok(night.frogs && night.frogsBusy && night.crickets && !night.ducks && !night.breeze);
    const rainDay = pondSounds('day', 'rain');
    assert.ok(rainDay.rain && rainDay.frogs && rainDay.frogsBusy && rainDay.ducks && !rainDay.breeze);
    const rainNight = pondSounds('night', 'rain');
    assert.ok(rainNight.rain && rainNight.frogs && rainNight.crickets && !rainNight.ducks, 'crickets at night, also in the rain');
    assert.ok(ducksAsleep('night') && !ducksAsleep('dusk'));
  });

  it('leaves have a colour for every time of day (design tokens)', () => {
    for (const t of ['morning', 'day', 'dusk', 'night'] as const) for (const c of LEAF_COLORS[t]) assert.match(c, /^--[a-z]+-\d00$/);
    assert.notDeepEqual(LEAF_COLORS.day, LEAF_COLORS.dusk);
    assert.notDeepEqual(LEAF_COLORS.dusk, LEAF_COLORS.night);
  });

  it('frogs hop now and then, turn to random sides and only move between their own pads', () => {
    const r = seeded(7);
    let fs = startFrogs(r);
    const seen = FROGS.map(() => new Set<number>());
    const dirs = new Set<number>();
    let hops = 0;
    for (let t = 0; t < 2000; t++) {
      fs = fs.map((f, i) => frogTick(f, i, r));
      fs.forEach((f, i) => {
        assert.ok(FROGS[i].pads.includes(f.spot), `frog ${i} on pad ${f.spot}`);
        seen[i].add(f.spot);
        dirs.add(f.dir);
      });
    }
    hops = fs.reduce((s, f) => s + f.hops, 0);
    assert.ok(hops > 4 * 2000 * 0.1 && hops < 4 * 2000 * 0.25, `hops now and then (${hops})`);
    assert.equal(dirs.size, 4, 'every facing');
    FROGS.forEach((f, i) => assert.equal(seen[i].size, f.pads.length, `frog ${i} visits its pads`));
  });

  it('ducks swim anywhere on the water, never bump into each other, and leave the line and float alone', () => {
    const r = seeded(11);
    const zone: FishingZone = { tip: { x: 133, y: 87 }, float: FLOAT_AT };
    const panel: [number, number, number, number] = [150, 220, 180, 50];
    let t = 0;
    let ds: DuckMove[] = DUCK_STARTS.map((p) => still(p, 0));
    for (const p of DUCK_STARTS) assert.ok(swimmable(p), 'starts on the water');
    const seen = { left: false, right: false };
    let fishing = false;
    let fishingSince = 0;
    for (let step = 0; step < 6000; step++) {
      t += 250;
      // TaniBot fishes now and then (the zone switches on and off).
      if (step % 400 === 0) {
        fishing = !fishing;
        fishingSince = t;
      }
      const z = fishing ? zone : null;
      for (let i = 0; i < ds.length; i++) {
        const flee = mustFlee(ds[i], t, z);
        if (!flee && t < ds[i].start + ds[i].dur + 1000) continue;
        const next = planDuck(ds, i, t, r, { zone: z, avoid: [panel], flee });
        if (next) ds = ds.map((m, j) => (j === i ? next : m));
      }
      const at = ds.map((m) => duckAt(m, t));
      for (const p of at) {
        assert.ok(swimmable(p), `on the water (${p.x}, ${p.y})`);
        seen.left ||= p.x < 200;
        seen.right ||= p.x > 380;
      }
      for (let i = 0; i < at.length; i++)
        for (let j = i + 1; j < at.length; j++) assert.ok(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) >= DUCK_GAP - 0.01, 'never bump into each other');
      // Six seconds after the line goes out, no duck is near the float or the line any more.
      if (fishing && t - fishingSince > 6000) for (const p of at) assert.ok(!inZone(p, p, zone), `away from the line (${p.x}, ${p.y})`);
    }
    assert.ok(seen.left && seen.right, 'they use the whole lake, left and right');
  });

  it('the water map keeps ducks off land, the dock, lily pads and the waterfall foot', () => {
    assert.ok(!swimmable({ x: 40, y: 120 }), 'the dock');
    assert.ok(!swimmable({ x: 30, y: 30 }), 'land');
    for (const p of FROG_SPOTS) assert.ok(!swimmable(p), `lily pad ${p.x},${p.y}`);
    assert.ok(!swimmable({ x: WATERFALL_FOOT[0] + 10, y: WATERFALL_FOOT[1] + 10 }), 'the waterfall foot');
    assert.ok(swimmable(FLOAT_AT) && swimmable({ x: 300, y: 200 }), 'open water');
  });

  it('the critter boxes hold every lily pad a frog uses', () => {
    for (const p of FROG_SPOTS) assert.ok(CRITTERS.some(([x, y, w, h]) => p.x > x && p.x < x + w && p.y > y && p.y < y + h));
  });
  it('full screen: laptops covered by the pond, upright phones show the whole pond across the width', () => {
    const lap = pondFit(1280, 800);
    assert.equal(lap.mode, 'cover');
    assert.ok(lap.w >= 1280 && lap.h >= 800 && Math.abs(lap.w / lap.h - 16 / 9) < 0.01);
    assert.ok((lap.w - 1280) / lap.w <= 0.12, 'crops at most 12%');
    assert.equal(pondFit(1920, 1080).mode, 'cover');
    const phone = pondFit(390, 844);
    assert.equal(phone.mode, 'fit');
    assert.equal(phone.w, 390);
    assert.ok(phone.top >= 72 && phone.top + phone.h < 844 * 0.6, 'upper part, room for the panel below');
    assert.equal(pondFit(1024, 768).mode, 'fit', 'too much would be cut: the whole pond with a blurred copy around');
  });
  it('dusk and night pictures fade in on the village clock (same hours as the village)', () => {
    assert.deepEqual(pondMix(12), { dusk: 0, night: 0 }); // ?time=day
    assert.deepEqual(pondMix(17.75), { dusk: 1, night: 0 }); // ?time=dusk
    assert.deepEqual(pondMix(23), { dusk: 0, night: 1 }); // ?time=night
    assert.deepEqual(pondMix(16.5), { dusk: 0.5, night: 0 }, 'day -> dusk halfway');
    assert.deepEqual(pondMix(19), { dusk: 1, night: 0.5 }, 'dusk -> night halfway');
    assert.deepEqual(pondMix(5.5), { dusk: 1, night: 0.5 }, 'dawn: night -> dusk');
    assert.deepEqual(pondMix(6.5), { dusk: 0.5, night: 0 }, 'dawn: dusk -> day');
  });
  it('birds sing on clear mornings and days, a few at dusk, never at night or in the rain', () => {
    assert.ok(pondSounds('morning', 'clear').birds && pondSounds('day', 'clear').birdRate > pondSounds('dusk', 'clear').birdRate);
    assert.ok(pondSounds('dusk', 'clear').birds && pondSounds('dusk', 'clear').birdRate > 0);
    for (const [t, w] of [['night', 'clear'], ['day', 'rain'], ['night', 'rain'], ['dusk', 'rain']] as const) assert.ok(!pondSounds(t, w).birds && pondSounds(t, w).birdRate === 0, `${t} ${w}`);
  });
  it('fish jump on open water, never near the float, the line, a duck or a lily pad; the Golden Arowana very rarely', () => {
    const r = seeded(5);
    const zone: FishingZone = { tip: { x: 133, y: 87 }, float: FLOAT_AT };
    const ducks = [
      { x: 300, y: 200 },
      { x: 420, y: 150 },
      { x: 200, y: 230 },
    ];
    const count = new Map<string, number>();
    for (let i = 0; i < 4000; i++) {
      const j = pickJump(r, { ducks, zone });
      assert.ok(j, 'a spot is found');
      assert.ok(swimmable(j));
      assert.ok(ducks.every((d) => Math.hypot(d.x - j.x, d.y - j.y) >= 36), 'away from ducks');
      assert.ok(FROG_SPOTS.every((f) => Math.hypot(f.x - j.x, f.y - j.y) >= 28), 'away from lily pads');
      assert.ok(Math.hypot(j.x - FLOAT_AT.x, j.y - FLOAT_AT.y) >= 56 && !inZone(j, j, zone), 'away from the float and line');
      count.set(j.fish, (count.get(j.fish) ?? 0) + 1);
    }
    const aro = (count.get('golden_arowana') ?? 0) / 4000;
    assert.ok(aro > 0 && aro < 0.04, `Golden Arowana very rare (${aro})`);
    for (const f of ['tilapia', 'catfish', 'carp', 'gourami']) assert.ok((count.get(f) ?? 0) > 400, f);
  });
  it('calm changes: demo mode holds each picture and weather 20 s; normal mode follows at once (the change fades in CSS)', () => {
    let m = nextMood(null, { time: 'day', weather: 'clear' }, 0, true);
    // Demo: the village rushes day -> dusk -> night -> dusk -> day within a minute.
    const seq: [number, 'day' | 'dusk' | 'night' | 'morning'][] = [[6000, 'dusk'], [14000, 'night'], [19000, 'night'], [21000, 'night'], [30000, 'night'], [41000, 'night'], [45000, 'day']];
    const shown: string[] = [];
    for (const [t, want] of seq) {
      m = nextMood(m, { time: want, weather: t > 10000 ? 'rain' : 'clear' }, t, true);
      shown.push(`${t / 1000}:${m.time}/${m.weather}`);
    }
    assert.deepEqual(shown, ['6:day/clear', '14:day/clear', '19:day/clear', '21:night/rain', '30:night/rain', '41:night/rain', '45:day/rain']);
    // Normal mode: at once.
    let n = nextMood(null, { time: 'day', weather: 'clear' }, 0, false);
    n = nextMood(n, { time: 'dusk', weather: 'rain' }, 1000, false);
    assert.deepEqual([n.time, n.weather], ['dusk', 'rain']);
    // Morning <-> day share the day picture: no hold needed.
    let d = nextMood(null, { time: 'morning', weather: 'clear' }, 0, true);
    d = nextMood(d, { time: 'day', weather: 'clear' }, 1000, true);
    assert.equal(d.time, 'day');
    assert.equal(POND_HOLD_DEMO_MS, 20000);
    assert.deepEqual(moodMix('dusk'), { dusk: 1, night: 0 });
    assert.deepEqual(moodMix('morning'), { dusk: 0, night: 0 });
  });
  it('the phone pond: ducks, jumping fish and frogs in the right places; the controls stay below the lake', async () => {
    const { PHONE, layoutFor } = await import('../src/art/pond-layouts.ts');
    assert.equal(layoutFor(390, 844).key, 'phone');
    assert.equal(layoutFor(390, 664).key, 'phone');
    assert.equal(layoutFor(1280, 800).key, 'wide');
    for (const p of PHONE.duckStarts) assert.ok(swimmable(p, [], PHONE), `duck start ${p.x},${p.y}`);
    for (const p of PHONE.frogSpots) assert.ok(!swimmable(p, [], PHONE), `lily pad ${p.x},${p.y}`);
    assert.ok(swimmable(PHONE.float, [], PHONE), 'the float is on open water');
    assert.ok(!swimmable(PHONE.bot, [], PHONE) && !swimmable(PHONE.bucket, [], PHONE), 'TaniBot and the bucket stand on the dock');
    // Ducks on the phone lake: on the water, never touching, away from the line.
    const r = seeded(21);
    const zone: FishingZone = { tip: { x: 128, y: 237 }, float: PHONE.float };
    let ds: DuckMove[] = PHONE.duckStarts.map((p) => still(p, 0));
    let t = 0;
    for (let step = 0; step < 3000; step++) {
      t += 250;
      for (let i = 0; i < ds.length; i++) {
        const flee = mustFlee(ds[i], t, zone);
        if (!flee && t < ds[i].start + ds[i].dur + 1000) continue;
        const next = planDuck(ds, i, t, r, { zone, flee, layout: PHONE });
        if (next) ds = ds.map((m, j) => (j === i ? next : m));
      }
      const at = ds.map((m) => duckAt(m, t));
      for (const p of at) assert.ok(swimmable(p, [], PHONE), `phone duck on the water (${p.x}, ${p.y})`);
      for (let i = 0; i < at.length; i++) for (let j = i + 1; j < at.length; j++) assert.ok(Math.hypot(at[i].x - at[j].x, at[i].y - at[j].y) >= DUCK_GAP - 0.01);
    }
    for (let i = 0; i < 500; i++) {
      const j = pickJump(r, { layout: PHONE, zone });
      assert.ok(j && swimmable(j, [], PHONE) && PHONE.frogSpots.every((f) => Math.hypot(f.x - j.x, f.y - j.y) >= 28));
    }
    // Full screen, no blur (package 7): the whole width, from the top (or a little above it), the
    // controls below the lake: 390x844, 390x664 (iPhone Safari) and 430x932.
    for (const [W, H] of [[390, 844], [390, 664], [430, 932]]) {
      const f = pondFit(W, H, PHONE);
      assert.equal(f.mode, 'phone');
      assert.equal(f.left, 0);
      assert.equal(f.w, W);
      assert.ok(f.top <= 0 && f.top >= -PHONE_TOP_CROP * (W / PHONE.w) - 0.01, `top ${f.top}`);
      assert.ok(H - (f.top + PHONE.lakeBottom * (f.w / PHONE.w)) >= PHONE_PANEL_MIN - 0.01, `room under the lake at ${W}x${H}`);
    }
  });
});
