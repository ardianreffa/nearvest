import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SLOPE_GONE, slopeTrainAt } from '../src/art/train-path.ts';

describe('v3 train in perspective', () => {
  const near = 241;
  const far = 135;
  const run = Array.from({ length: 101 }, (_, i) => slopeTrainAt(i / 100, near, far));

  it('starts big at the right edge and only ever gets smaller while rolling away', () => {
    assert.ok(run[0].size >= 0.96 && run[0].left >= near - 1);
    for (let i = 1; i < run.length; i++) {
      assert.ok(run[i].size <= run[i - 1].size, `size grows at step ${i}`);
      assert.ok(run[i].left <= run[i - 1].left, `moves backwards at step ${i}`);
    }
  });

  it('is gone (too small) before the end of the rail; sizes change in small steps', () => {
    assert.ok(run[100].size < SLOPE_GONE);
    assert.ok(run[100].left >= far - 0.01);
    const sizes = new Set(run.map((r) => r.size.toFixed(2)));
    assert.ok(sizes.size >= 10, 'many steps, not a jump');
    for (const r of run) assert.ok(Math.abs(r.size / 0.04 - Math.round(r.size / 0.04)) < 1e-9 || r.size === 0.1);
  });

  it('slows down in the distance (like a real train far away)', () => {
    const first = run[0].left - run[20].left;
    const last = run[80].left - run[100].left;
    assert.ok(first > last * 2);
  });
});
