// The fishing rod, line and float (src/art/rod-pose.ts): the line always starts at the rod's tip,
// the cast flies the float out to the water, a bite bends the rod toward the float with a taut line,
// reeling brings the float back to the tip. Package 1 of Ardian's fishing test (2026-11-12).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CRITTERS } from '../src/pond-life-plan.ts';
import { CAST_MS, CAST_RELEASE_MS, FLOAT_AT, HANDS, REEL_MS, ROD_LEN, qAt, rodPose, type Pt, type RodPhase } from '../src/art/rod-pose.ts';

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const PHASES: RodPhase[] = ['ready', 'casting', 'wait', 'bite', 'reeling', 'result'];
// Lily pads and the ducks' area (pond-life-plan.ts CRITTERS) the rod, line and float must never touch.
const inCritter = (p: Pt) => CRITTERS.some(([x, y, w, h]) => p.x > x - 1 && p.x < x + w + 1 && p.y > y - 1 && p.y < y + h + 1);

describe('fishing rod pose', () => {
  it('every pose: the rod starts in the hands, has its length, and the line runs tip -> float', () => {
    for (const ph of PHASES)
      for (let ms = 0; ms <= 1500; ms += 10)
        for (const still of [false, true]) {
          const p = rodPose(ph, ms, still);
          assert.deepEqual(p.butt, HANDS, ph);
          const len = dist(p.butt, p.tip);
          assert.ok(len > ROD_LEN * 0.85 && len <= ROD_LEN + 0.01, `${ph} ${ms}: rod chord ${len}`);
          for (const v of [p.tip.x, p.tip.y, p.float.x, p.float.y, p.line.x, p.line.y]) assert.ok(Number.isFinite(v), `${ph} ${ms}`);
          // Never broken: the float stays within reach (a line can only be so long).
          assert.ok(dist(p.tip, p.float) < 200, `${ph} ${ms}: float ${dist(p.tip, p.float)} from the tip`);
        }
  });

  it('the cast swings back, releases, and the float lands on the water spot', () => {
    const start = rodPose('casting', 0);
    const back = rodPose('casting', 250);
    assert.ok(back.tip.x < start.tip.x, 'swings back first');
    const flying = rodPose('casting', (CAST_RELEASE_MS + CAST_MS) / 2);
    assert.ok(flying.lift > 0.5 && !flying.inWater, 'the float flies');
    assert.ok(flying.float.x > rodPose('casting', CAST_RELEASE_MS - 1).float.x, 'out over the water');
    const landed = rodPose('wait', CAST_MS);
    assert.deepEqual(landed.float, FLOAT_AT);
    assert.ok(landed.inWater && landed.lift === 0);
    // A line resumed from the server (no animation) is in the water right away.
    assert.deepEqual(rodPose('wait', Infinity).float, FLOAT_AT);
  });

  it('the float moves smoothly (no jumps) through the cast and the reel', () => {
    for (const ph of ['casting', 'reeling'] as const) {
      let prev = rodPose(ph, 0);
      for (let ms = 10; ms <= (ph === 'casting' ? CAST_MS : REEL_MS); ms += 10) {
        const p = rodPose(ph, ms);
        assert.ok(dist(p.float, prev.float) < 12, `${ph} ${ms}: float jumped ${dist(p.float, prev.float)}`);
        assert.ok(dist(p.tip, prev.tip) < 12, `${ph} ${ms}: tip jumped`);
        prev = p;
      }
    }
  });

  it('waiting: a soft sag; a bite: the rod bends toward the float and the line is taut', () => {
    const w = rodPose('wait', Infinity);
    const sagMid = qAt(w.tip, w.line, w.float, 0.5);
    const straightMid = { x: (w.tip.x + w.float.x) / 2, y: (w.tip.y + w.float.y) / 2 };
    assert.ok(sagMid.y - straightMid.y > 4, 'the line sags');
    assert.equal(w.bend, 0);
    for (const ms of [0, 40, 120, 333]) {
      const b = rodPose('bite', ms);
      assert.ok(b.bend > 10, `bent (${b.bend})`);
      assert.ok(b.tip.y > w.tip.y, 'the tip is pulled down toward the water');
      const m = qAt(b.tip, b.line, b.float, 0.5);
      const s = { x: (b.tip.x + b.float.x) / 2, y: (b.tip.y + b.float.y) / 2 };
      assert.ok(dist(m, s) < 0.01, 'taut line');
    }
    assert.equal(rodPose('bite', 77, true).bend, rodPose('bite', 500, true).bend, 'reduced motion: no tremble');
  });

  it('reeling pulls the float back to the rod tip', () => {
    const a = rodPose('reeling', 0);
    const z = rodPose('reeling', REEL_MS);
    assert.ok(dist(a.float, FLOAT_AT) < 0.01);
    assert.ok(dist(z.float, z.tip) < 10, 'back at the tip');
    assert.ok(dist(rodPose('reeling', REEL_MS / 2).float, a.float) > 10, 'on its way in');
    assert.deepEqual(rodPose('result', 0).float, z.float, 'the result pose continues from the reel');
  });

  it('nothing of the rod, line or float touches a frog or a duck, at any moment', () => {
    for (const ph of PHASES)
      for (let ms = 0; ms <= 1500; ms += 10) {
        const p = rodPose(ph, ms);
        for (let t = 0; t <= 1; t += 0.05) {
          assert.ok(!inCritter(qAt(p.butt, p.ctrl, p.tip, t)), `${ph} ${ms}: rod`);
          assert.ok(!inCritter(qAt(p.tip, p.line, p.float, t)), `${ph} ${ms}: line`);
        }
        assert.ok(!inCritter({ x: p.float.x, y: p.float.y - p.lift * 10 }), `${ph} ${ms}: float`);
      }
  });
  it('the phone pond: the rod, line and float never touch a lily pad there either; the line is on the tip', async () => {
    const { PHONE } = await import('../src/art/pond-layouts.ts');
    const { crittersOf } = await import('../src/pond-life-plan.ts');
    const boxes = crittersOf(PHONE);
    const hit = (p: Pt) => boxes.some(([x, y, w, h]) => p.x > x - 1 && p.x < x + w + 1 && p.y > y - 1 && p.y < y + h + 1);
    for (const ph of PHASES)
      for (let ms = 0; ms <= 1500; ms += 10) {
        const p = rodPose(ph, ms, false, PHONE);
        assert.deepEqual(p.butt, PHONE.hands);
        for (let t = 0; t <= 1; t += 0.05) {
          assert.ok(!hit(qAt(p.butt, p.ctrl, p.tip, t)), `${ph} ${ms}: rod`);
          assert.ok(!hit(qAt(p.tip, p.line, p.float, t)), `${ph} ${ms}: line`);
        }
        assert.ok(!hit({ x: p.float.x, y: p.float.y - p.lift * 10 }), `${ph} ${ms}: float`);
      }
    assert.deepEqual(rodPose('wait', Infinity, false, PHONE).float, PHONE.float);
  });
  it('the phone pond casts like the laptop pond (package 7): the same angles, so the same swing', async () => {
    const { PHONE, WIDE } = await import('../src/art/pond-layouts.ts');
    assert.deepEqual(PHONE.angles, WIDE.angles);
    for (let ms = 0; ms <= CAST_MS; ms += 50) {
      const a = rodPose('casting', ms, false, PHONE);
      const b = rodPose('casting', ms, false, WIDE);
      // Seen from each one's hands: the rod's tip is in the same place at the same moment.
      assert.ok(dist({ x: a.tip.x - PHONE.hands.x, y: a.tip.y - PHONE.hands.y }, { x: b.tip.x - WIDE.hands.x, y: b.tip.y - WIDE.hands.y }) < 0.01, `${ms}`);
      assert.equal(a.lift.toFixed(3), b.lift.toFixed(3));
    }
  });
});
