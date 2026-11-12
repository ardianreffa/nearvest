// Fishing window rules (src/fishing-logic.ts): start step (resume a line in the water), casts-left
// text, countdown, the note and reward chips of a catch, and the one-time notice for a line the
// server pulled in.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CatchView } from '../src/api.ts';
import { CATCH_GRIDS, FISH_PALETTE } from '../src/art/catch-grids.ts';
import { autoCatchToShow, autoNotice, castsLeftText, catchNote, catchReward, catchTier, seasonNote, rewardChips, startPhase, untilText } from '../src/fishing-logic.ts';

const NOW = 1_800_000_000_000;
const c = (o: Partial<CatchView> = {}): CatchView => ({
  id: 1,
  catch: 'tilapia',
  name: 'Tilapia',
  kind: 'fish',
  panen: 3,
  basePanen: 3,
  xp: 0,
  released: false,
  item: null,
  line: null,
  moment: null,
  jobId: 5,
  jobStatus: 'pending',
  auto: false,
  at: NOW,
  ...o,
});
const st = (o = {}) => ({ left: 3, max: 3, msUntilNextDay: 3_600_000, open: null, last: null, ...o });

describe('fishing window', () => {
  it('starts ready, or resumes a line in the water (before or after the bite)', () => {
    assert.deepEqual(startPhase(undefined, NOW), { k: 'ready' });
    assert.deepEqual(startPhase(st(), NOW), { k: 'ready' });
    assert.deepEqual(startPhase(st({ open: { id: 7, biteInMs: 2500 } }), NOW), { k: 'wait', id: 7, biteAt: NOW + 2500 });
    assert.deepEqual(startPhase(st({ open: { id: 7, biteInMs: 0 } }), NOW), { k: 'bite', id: 7 });
  });

  it('casts left and the countdown to 07:00 WIB', () => {
    assert.equal(castsLeftText({ left: 2, max: 3 }), '2 of 3 casts left today');
    assert.equal(castsLeftText({ left: 0, max: 3 }), 'No casts left today');
    assert.equal(untilText(5 * 3_600_000 + 12 * 60_000), '5h 12m');
    assert.equal(untilText(30_000), '1m');
    assert.equal(untilText(59 * 60_000), '59m');
  });

  it('notes and chips show only what was really given (Season rule, released, seed sold)', () => {
    assert.deepEqual(rewardChips(c({ panen: 1.5 })), [{ kind: 'panen', text: '+1.5 PANEN' }]);
    assert.deepEqual(rewardChips(c({ kind: 'junk', catch: 'old_boot', panen: 0, xp: 5 })), [{ kind: 'xp', text: '+5 XP' }]);
    assert.deepEqual(rewardChips(c({ panen: 0.375 })), [{ kind: 'panen', text: '+0.38 PANEN' }]);
    assert.match(catchNote(c({ released: true, panen: 0, xp: 1 })), /used up/);
    assert.match(catchNote(c({ catch: 'mango_seed', kind: 'item', item: 'seed_sold', panen: 2 })), /Mr\. Darto bought/);
    assert.match(catchNote(c({ catch: 'mango_seed', kind: 'item', item: 'seed', panen: 0 })), /Storage/);
    assert.match(catchNote(c({ catch: 'golden_arowana', name: 'Golden Arowana' })), /legendary/);
    assert.match(catchNote(c({ catch: 'stone', kind: 'junk' })), /Junk/);
  });

  it('a line the server pulled in gets one notice (new, recent, auto only)', () => {
    const auto = c({ id: 9, auto: true, at: NOW - 60_000 });
    assert.equal(autoCatchToShow(st({ last: auto }), 0, NOW)?.id, 9);
    assert.equal(autoCatchToShow(st({ last: auto }), 9, NOW), null, 'already shown');
    assert.equal(autoCatchToShow(st({ last: c({ id: 10 }) }), 0, NOW), null, 'reeled by the player');
    assert.equal(autoCatchToShow(st({ last: c({ id: 11, auto: true, at: NOW - 2 * 86_400_000 }) }), 0, NOW), null, 'too old');
    assert.equal(autoCatchToShow(undefined, 0, NOW), null);
    assert.equal(autoNotice(c({ name: 'Catfish', panen: 5, auto: true })), 'TaniBot pulled in your fishing line: Catfish (+5 PANEN).');
  });

  it('catch icons: every grid is a clean rectangle and uses only known colours', () => {
    const known = new Set(['.', 'k', 'w', 'y', 'Y', ...Object.keys(FISH_PALETTE)]);
    const ids = ['tilapia', 'catfish', 'carp', 'gourami', 'golden_arowana', 'stone', 'driftwood', 'fish_bone', 'old_boot', 'rusty_can', 'bottle', 'chest'] as const;
    for (const id of ids) {
      const g = CATCH_GRIDS[id]!;
      assert.ok(g, id);
      assert.ok(g.every((r) => r.length === g[0].length), `${id}: rows of one width`);
      for (const ch of g.join('')) assert.ok(known.has(ch), `${id}: unknown colour ${ch}`);
    }
  });
  it('result tiers: junk / fish / item / gourami / legend (a released fish counts as junk)', () => {
    assert.equal(catchTier(c({ kind: 'junk', catch: 'rusty_can' })), 'junk');
    assert.equal(catchTier(c({ released: true })), 'junk');
    assert.equal(catchTier(c({ released: true, catch: 'golden_arowana' })), 'junk');
    assert.equal(catchTier(c()), 'fish');
    assert.equal(catchTier(c({ catch: 'catfish' })), 'fish');
    assert.equal(catchTier(c({ catch: 'gourami' })), 'gourami');
    assert.equal(catchTier(c({ catch: 'golden_arowana' })), 'legend');
    for (const id of ['mango_seed', 'fertilizer', 'bottle', 'chest'] as const) assert.equal(catchTier(c({ kind: 'item', catch: id })), 'item', id);
  });
  it('honest PANEN: the list shows what you receive after the Season rule, with a Season note', () => {
    const s1 = { number: 1, divisor: 1, rewardPercent: 100 };
    const s3 = { number: 3, divisor: 4, rewardPercent: 25 };
    assert.equal(seasonNote(s1), null);
    assert.equal(seasonNote(s3), 'Season 3: rewards 25%');
    assert.equal(seasonNote({ number: 4, divisor: 8, rewardPercent: 12.5 }), 'Season 4: rewards 12.5%');
    const chest = { min: 10, max: 15 };
    assert.equal(catchReward({ id: 'carp', kind: 'fish', panenNow: 1.25 }, chest, s3), '1.25 PANEN');
    assert.equal(catchReward({ id: 'chest', kind: 'item', panenNow: 0 }, chest, s3), '2.5-3.75 PANEN');
    assert.equal(catchReward({ id: 'chest', kind: 'item', panenNow: 0 }, chest, s1), '10-15 PANEN');
    assert.equal(catchReward({ id: 'rusty_can', kind: 'junk', panenNow: 0 }, chest, s3), '1 XP');
    assert.match(catchNote(c()), /Mr\. Darto bought it on the spot/);
  });
});
