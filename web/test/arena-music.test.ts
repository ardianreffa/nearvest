// The Arena's code-made music (src/arena-music-plan.ts): fast, a whole loop, notes in range.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ARENA_BPM, ARENA_LOOP, ARENA_LOOP_STEPS, midiHz, STEP_S } from '../src/arena-music-plan.ts';

describe('Arena music', () => {
  it('is fast (160 BPM, about 12 s per loop)', () => {
    assert.ok(ARENA_BPM >= 150);
    assert.ok(Math.abs(ARENA_LOOP_STEPS * STEP_S - 12) < 0.5);
  });
  it('every note sits inside the loop, with lead, bass, arpeggio and drums', () => {
    assert.ok(ARENA_LOOP.every((n) => n.step >= 0 && n.step < ARENA_LOOP_STEPS && n.len >= 1));
    for (const v of ['lead', 'bass', 'arp', 'hat', 'snare']) assert.ok(ARENA_LOOP.some((n) => n.voice === v), v);
  });
  it('pitched notes stay in a pleasant range (about 55 Hz to 1.2 kHz)', () => {
    for (const n of ARENA_LOOP.filter((x) => x.midi > 0)) {
      const hz = midiHz(n.midi);
      assert.ok(hz > 50 && hz < 1300, `${n.voice} ${hz}`);
    }
    assert.equal(Math.round(midiHz(69)), 440);
  });
});
