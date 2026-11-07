import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ART_H, ART_W, immersiveLayout, phoneLayout } from '../src/layout.ts';

/** True when the sharp garden art covers the whole window (no blurred bars). */
function covers(width: number, height: number) {
  const l = immersiveLayout(width, height, 64, 128);
  const artW = ART_W * l.k;
  const artH = ART_H * l.k;
  return { l, full: artW >= width && artH + l.artBottom >= height && l.artLeft <= 0 };
}

describe('immersive layout (laptop / fullscreen)', () => {
  for (const [w, h] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
    [1536, 864],
    [1680, 1050],
    [2560, 1600],
    [1366, 768],
  ]) {
    it(`${w}x${h} (fullscreen) is covered by the garden, with whole-pixel trees`, () => {
      const { l, full } = covers(w, h);
      assert.ok(full, `k=${l.k} leaves blurred bars`);
      assert.ok(Number.isInteger(l.k), 'trees, plots and TaniBot use whole pixels');
      assert.ok(((ART_W * l.k - w) / w) <= 0.2, 'crops at most 20% of the width');
    });
  }

  it('1440x900 uses the half step 3.5 (k = 7) instead of shrinking to 3 with blurred bars', () => {
    assert.equal(immersiveLayout(1440, 900, 64, 128).k, 7);
  });

  it('typical windows with browser bars keep the old scales', () => {
    assert.equal(immersiveLayout(1280, 720, 64, 128).k, 6);
    assert.equal(immersiveLayout(1920, 960, 64, 128).k, 8);
  });
});

describe('phone garden layout', () => {
  for (const [w, h] of [
    [360, 780],
    [390, 844],
    [440, 956],
  ]) {
    it(`${w}x${h}: a whole-number scale, about 55% of the height, art wider than the screen`, () => {
      const l = phoneLayout(w, h);
      assert.ok(Number.isInteger(l.k) && l.k >= 3, `k ${l.k}`);
      assert.ok(l.sceneH >= h * 0.5 && l.sceneH <= h * 0.6, `scene ${l.sceneH}`);
      assert.ok(ART_H * l.k <= l.sceneH, 'the whole art height fits');
      assert.equal(l.sceneW, ART_W * l.k);
      assert.ok(l.sceneW > w, 'pans sideways');
      // The plots stand on the art's 11% - 89% like everywhere else.
      assert.equal(l.stageLeft, Math.round(ART_W * l.k * 0.11));
      assert.equal(l.stageRight, l.stageLeft);
    });
  }
});
