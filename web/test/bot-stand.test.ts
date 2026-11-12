// TaniBot's spot in the garden (src/bot-stand.ts): it stays in its gap while the picked plot is next
// to it and only walks when the plot is not; it faces the plot it works on.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { besideGap, faceToward, homeGap, nextStand, type BotStand } from '../src/bot-stand.ts';

/** Picks plots in order and returns the gap after each pick. */
function walk(order: number[], plots: number): number[] {
  let s: BotStand | null = null;
  return order.map((p) => (s = nextStand(s, p, plots)).gap);
}

describe('TaniBot stand', () => {
  it('each plot has its own gap: right of it, the last plot left of it', () => {
    assert.deepEqual([0, 1, 2].map((p) => homeGap(p, 3)), [0, 1, 1]);
    assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8].map((p) => homeGap(p, 9)), [0, 1, 2, 3, 4, 5, 6, 7, 7]);
  });

  it('plot 1 then plot 3: walks (not next to it); then plot 2: stays', () => {
    assert.deepEqual(walk([0, 2, 1], 3), [0, 1, 1]);
  });

  it('plot 1 then plot 2: stays in the gap between them (no walk)', () => {
    assert.deepEqual(walk([0, 1], 3), [0, 0]);
    const a = nextStand(null, 0, 3);
    assert.equal(nextStand(a, 1, 3), a, 'same stand object = TaniBot does not move at all');
  });

  it('plot 3 then plot 2 then plot 1: stays, then walks to plot 1', () => {
    assert.deepEqual(walk([2, 1, 0], 3), [1, 1, 0]);
  });

  it('works for more plots in a row', () => {
    assert.deepEqual(walk([0, 1, 2, 3, 2, 8, 7, 5], 9), [0, 0, 2, 2, 2, 7, 7, 5]);
  });

  it('faces the plot: left when the plot is left of its gap', () => {
    assert.equal(faceToward(0, 0), 'left');
    assert.equal(faceToward(0, 1), 'right');
    assert.equal(faceToward(1, 2), 'right');
    assert.equal(faceToward(1, 1), 'left');
    assert.ok(besideGap(1, 1) && besideGap(1, 2) && !besideGap(1, 0));
  });

  it('a garden with fewer plots than the old gap: back to the plot own spot', () => {
    assert.deepEqual(nextStand({ gap: 5, plot: 5 }, 1, 3), { gap: 1, plot: 1 });
  });
});
