import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ART_H, ART_W, immersiveLayout, PHONE_SHEET_MAX, PHONE_SHOWN_FROM, phoneLayout, phoneSceneRoom } from '../src/layout.ts';
import { V2_PHONE, V2_WEB, V3_PHONE, V3_WEB } from '../src/art/village.ts';

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

describe('v2 village on laptops: the whole village stays left of the side menu', () => {
  const DRAWER = 400;
  const RAIL = 64;
  const BAR = 200;
  for (const [w, h] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    for (const [side, room] of [
      ['drawer open', DRAWER],
      ['drawer closed (icon rail)', RAIL],
    ] as const) {
      it(`${w}x${h}, ${side}`, () => {
        const l = immersiveLayout(w, h, room, BAR, V2_WEB);
        const f = V2_WEB.focus!;
        assert.ok(Number.isInteger(l.k) && l.k >= 4, `k ${l.k}`);
        assert.ok(l.artLeft + f.x0 * l.k >= 0, 'the Shop is on screen');
        assert.ok(l.artLeft + f.x1 * l.k <= w - room - 16, 'the Friends house is left of the side menu');
        assert.ok(l.artLeft <= 0, 'the art reaches the left edge');
        assert.ok(l.stageBottom >= BAR + 16, 'the plots stand above the action bar');
        assert.ok(h - l.artBottom - (V2_WEB.h - f.top) * l.k >= 0, 'the towers fit under the top edge');
      });
    }
  }

  it('uses the biggest scale that fits (1440x900: 5 with the drawer open, 6 closed; 1920x1080: 7 and 9)', () => {
    assert.equal(immersiveLayout(1440, 900, DRAWER, BAR, V2_WEB).k, 5);
    assert.equal(immersiveLayout(1440, 900, RAIL, BAR, V2_WEB).k, 6);
    assert.equal(immersiveLayout(1920, 1080, DRAWER, BAR, V2_WEB).k, 7);
    assert.equal(immersiveLayout(1920, 1080, RAIL, BAR, V2_WEB).k, 9);
  });
});

describe('phone garden layout (v2 upright village, no panning)', () => {
  for (const [w, h] of [
    [360, 780],
    [390, 844],
    [440, 956],
  ]) {
    it(`${w}x${h}: 3 px per game pixel, the whole village and all plots in view`, () => {
      const l = phoneLayout(w, h, V2_PHONE);
      assert.equal(l.k, 3);
      assert.equal(l.sceneW, w, 'the scene is as wide as the screen');
      assert.ok(l.artLeft >= 0 && l.artLeft + V2_PHONE.w * l.k <= w, 'the whole art width is on screen');
      assert.ok(l.stageLeft >= 0 && l.stageRight >= 0, 'all three plots are on screen');
      assert.equal(l.sceneH, (V2_PHONE.h - PHONE_SHOWN_FROM) * l.k);
      // Top bar ~130 px, sheet at most 25%, tabs ~68 px: the scene fits in between.
      assert.ok(130 + l.sceneH + h * 0.25 + 68 <= h, `scene ${l.sceneH}px fits`);
    });
  }
});

describe('v3 village on laptops: the whole village stays left of the side menu', () => {
  for (const [w, h] of [
    [1280, 800],
    [1440, 900],
    [1920, 1080],
  ]) {
    for (const room of [400, 64]) {
      it(`${w}x${h}, side menu ${room}px`, () => {
        const l = immersiveLayout(w, h, room, 200, V3_WEB);
        const f = V3_WEB.focus!;
        assert.ok(Number.isInteger(l.k) && l.k >= 4, `k ${l.k}`);
        assert.ok(l.artLeft + f.x0 * l.k >= 0, 'the Shop is on screen');
        assert.ok(l.artLeft + f.x1 * l.k <= w - room - 16, 'the Friends house and its robot are left of the side menu');
        assert.ok(l.artLeft + V3_WEB.robot!.x * l.k < w - room - 16, 'the little robot is not under the side menu');
        assert.ok(l.stageBottom >= 200 + 16, 'the plots stand above the action bar');
        assert.ok(h - l.artBottom - (V3_WEB.h - f.top) * l.k >= 0, 'the towers fit under the top edge');
      });
    }
  }

  it('is as big as v2 (1440x900: 5 with the drawer open, 6 closed)', () => {
    assert.equal(immersiveLayout(1440, 900, 400, 200, V3_WEB).k, 5);
    assert.equal(immersiveLayout(1440, 900, 64, 200, V3_WEB).k, 6);
  });
});

describe('v3 phone garden: the village fills the screen width, no panning, less sky', () => {
  for (const [w, h] of [
    [360, 780],
    [390, 844],
    [440, 956],
  ]) {
    it(`${w}x${h}`, () => {
      const l = phoneLayout(w, h);
      assert.equal(l.village.key, 'v3-phone', 'v3 is the default');
      assert.equal(l.artLeft, 0);
      assert.ok(Math.abs(V3_PHONE.w * l.k - w) < 0.01, 'the art is exactly as wide as the screen (no blurred sides)');
      assert.equal(l.sceneW, w);
      assert.ok(l.stageLeft >= 0 && l.stageRight >= 0, 'all three plots are on screen');
      assert.ok(Number.isInteger(l.spritePx) && l.spritePx >= 3, 'trees keep whole pixels');
      assert.ok(l.sceneH <= phoneSceneRoom(h), `scene ${l.sceneH}px fits above a sheet of at most ${PHONE_SHEET_MAX * 100}%`);
      assert.ok(l.sceneH >= (V3_PHONE.h - 70) * l.k, 'the towers, the village and the plots are in view');
    });
  }
});
