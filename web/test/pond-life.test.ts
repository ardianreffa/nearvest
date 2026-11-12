// The fishing pond's life and mood (src/pond-life-plan.ts, Fishing package 2): village clock, rain
// only (never ash), which sounds play, frogs on their pads, ducks on the right-hand side.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FLOAT_AT } from '../src/art/rod-pose.ts';
import {
  CRITTERS,
  DUCK_AREA,
  DUCK_STARTS,
  duckTarget,
  ducksAsleep,
  FROG_SPOTS,
  FROGS,
  frogTick,
  LEAF_COLORS,
  pondSounds,
  pondTime,
  pondWeather,
  startFrogs,
  swimSeconds,
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

  it('ducks stay on the right-hand side, far from the float, and paddle slowly', () => {
    const r = seeded(3);
    const ds = DUCK_STARTS.map((p) => ({ ...p }));
    for (let t = 0; t < 3000; t++) {
      const i = t % ds.length;
      const to = duckTarget(ds[i], ds.filter((_, j) => j !== i), r);
      assert.ok(to.x >= DUCK_AREA.x0 && to.x <= DUCK_AREA.x1 && to.y >= DUCK_AREA.y0 && to.y <= DUCK_AREA.y1, 'inside the area');
      assert.ok(swimSeconds(ds[i], to) >= 2, 'slow');
      ds[i] = to;
    }
    // The whole area (with the ducks' size) is far from the float and its ripples.
    assert.ok(DUCK_AREA.x0 - 10 - FLOAT_AT.x > 120);
  });

  it('the critter boxes hold every lily pad a frog uses and the ducks area', () => {
    for (const p of FROG_SPOTS) assert.ok(CRITTERS.some(([x, y, w, h]) => p.x > x && p.x < x + w && p.y > y && p.y < y + h));
    assert.ok(CRITTERS.some(([x, y, w, h]) => x <= DUCK_AREA.x0 - 10 && y <= DUCK_AREA.y0 - 6 && x + w >= DUCK_AREA.x1 + 10 && y + h >= DUCK_AREA.y1 + 6));
  });
});
