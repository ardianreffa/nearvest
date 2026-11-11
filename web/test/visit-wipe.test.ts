// The pixel-leaf wipe between gardens (src/visit-wipe-plan.ts): about 0.8 s, squares on the game's
// pixel grid, every square covered by the end of the cover phase, a ragged sweep, mostly leaf colours.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BACK_TEXT, cellsBy, sparkleLength, sparkleNotes, seededRandom, visitingText, WIPE_COLORS, WIPE_COVER_MS, WIPE_HOLD_MS, WIPE_REVEAL_MS, wipeCellPx, wipeCells } from '../src/visit-wipe-plan.ts';

describe('visit wipe', () => {
  it('takes about 0.8 s', () => {
    assert.equal(WIPE_COVER_MS + WIPE_HOLD_MS + WIPE_REVEAL_MS, 800);
  });
  it('squares on the 8 px game grid', () => {
    for (const w of [360, 390, 768, 1280, 1920]) assert.equal(wipeCellPx(w) % 8, 0);
  });
  it('every square is covered at the end of the phase, none at the start', () => {
    const cells = wipeCells(25, 53, seededRandom(7));
    assert.equal(cells.length, 25 * 53);
    assert.equal(cellsBy(cells, 0), cells.filter((c) => c.at === 0).length);
    assert.equal(cellsBy(cells, 1), cells.length);
    // About half way: some covered, some not (a sweep, not all at once).
    const half = cellsBy(cells, 0.5);
    assert.ok(half > cells.length * 0.2 && half < cells.length * 0.8, `half way: ${half}`);
  });
  it('sweeps from the bottom left to the top right, with a ragged edge', () => {
    const cells = wipeCells(25, 53, seededRandom(3));
    const at = (col: number, row: number) => cells.find((c) => c.col === col && c.row === row)!.at;
    assert.ok(at(0, 52) < at(24, 0), 'bottom left before top right');
    // Not a straight line: squares on the same diagonal differ.
    const diag = cells.filter((c) => c.col + (52 - c.row) === 30).map((c) => c.at);
    assert.ok(Math.max(...diag) - Math.min(...diag) > 0.1);
  });
  it('mostly leaf colours, a little mint', () => {
    const cells = wipeCells(54, 34, seededRandom(11));
    const n = (i: number) => cells.filter((c) => c.color === i).length / cells.length;
    const mint = WIPE_COLORS.findIndex((c) => c.token === '--mint-500');
    assert.ok(n(mint) > 0.03 && n(mint) < 0.15, `mint share ${n(mint)}`);
    assert.ok(WIPE_COLORS.every((_, i) => n(i) > 0));
  });
  it('the words', () => {
    assert.equal(visitingText('budi'), 'Visiting budi’s garden');
    assert.equal(BACK_TEXT, 'Back to my garden');
  });
});

describe('pixel sparkle sound', () => {
  it('rises for a visit, falls on the way back, about 0.6-0.8 s', () => {
    const up = sparkleNotes('up');
    const down = sparkleNotes('down');
    for (const notes of [up, down]) {
      const len = sparkleLength(notes);
      assert.ok(len >= 0.6 && len <= 0.8, `length ${len}`);
      assert.ok(notes.every((n) => n.level > 0 && n.level <= 1));
    }
    assert.ok(up.every((n, i) => i === 0 || n.freq > up[i - 1].freq), 'rising');
    assert.ok(down.every((n, i) => i === 0 || n.freq < down[i - 1].freq), 'falling');
    assert.notDeepEqual(up.map((n) => n.freq), [...down].reverse().map((n) => n.freq), 'back is not just the visit reversed');
  });
});
