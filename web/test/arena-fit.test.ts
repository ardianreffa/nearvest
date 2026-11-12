// The full-screen duel's arena picture (src/art/arena-fit.ts arenaFullFit): it reaches the bottom of
// the screen, the TaniBots' feet stay above the floating dock, laptops use a whole-number scale and
// phones show the picture's full width; missing height is filled with the picture's own floor rows.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARENA_PHONE, ARENA_WEB, arenaFullFit, FEET_ABOVE_DOCK } from '../src/art/arena-fit.ts';

describe('arenaFullFit', () => {
  for (const [w, h, dock] of [
    [1280, 736, 568],
    [1440, 836, 640],
    [1920, 1016, 800],
  ]) {
    it(`laptop ${w}x${h}: whole-number scale, covers the width, reaches the bottom, feet above the dock`, () => {
      const f = arenaFullFit(ARENA_WEB, w, h, dock, true);
      assert.equal(f.k, Math.round(f.k));
      assert.ok(ARENA_WEB.w * f.k >= w, 'covers the width');
      assert.ok(f.left <= 0 && f.top <= 0, 'no empty band at the side or top');
      assert.ok(f.top + ARENA_WEB.h * f.k + f.fill >= h, 'picture + floor rows reach the bottom');
      assert.ok(f.feet <= dock - FEET_ABOVE_DOCK, 'feet above the dock');
    });
  }

  for (const [w, h, dock] of [
    [390, 788, 600],
    [390, 608, 420],
  ]) {
    it(`phone ${w}x${h}: the whole width shows, floor rows fill the rest, feet above the dock`, () => {
      const f = arenaFullFit(ARENA_PHONE, w, h, dock, false);
      assert.equal(ARENA_PHONE.w * f.k, w, 'nothing cut at the sides');
      assert.equal(f.left, 0);
      assert.ok(f.top <= 0);
      assert.ok(f.top + ARENA_PHONE.h * f.k + f.fill >= h);
      assert.ok(f.fill > 0, 'the picture alone is too short: floor rows are added');
      assert.ok(f.feet <= dock - FEET_ABOVE_DOCK);
    });
  }

  it('a taller dock lifts the feet and the picture (never above the stage top otherwise)', () => {
    const low = arenaFullFit(ARENA_WEB, 1280, 736, 568, true);
    const high = arenaFullFit(ARENA_WEB, 1280, 736, 468, true);
    assert.ok(high.feet < low.feet && high.top < low.top);
    const roomy = arenaFullFit(ARENA_WEB, 1920, 1016, 1000, true);
    assert.equal(roomy.top, 0, 'with room to spare the picture starts at the stage top');
    assert.equal(roomy.feet, ARENA_WEB.ring.cy * roomy.k, 'feet on the ring');
  });

  it('the floor band and cut lie below the ring, inside the picture', () => {
    for (const a of [ARENA_WEB, ARENA_PHONE]) {
      const [b0, b1] = a.floor.band;
      assert.ok(a.ring.cy + a.ring.ry < b0 && b0 < b1 && b1 <= a.floor.cut && a.floor.cut < a.h);
    }
  });
});
