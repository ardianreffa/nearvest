// Demo mode check-in: at most 7 check-ins per garden per real day (00:00 UTC) pay PANEN;
// later ones keep the streak and the seeds, without PANEN. Normal mode is unchanged.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEMO_CHECKIN_PANEN_PER_REAL_DAY } from '../src/rules.ts';
import { DAY, makeWorld, MINUTE } from './helpers.ts';

const balance = (w: ReturnType<typeof makeWorld>, id: number) =>
  (w.db.prepare('SELECT balance_micro FROM players WHERE id = ?').get(id) as { balance_micro: number }).balance_micro / 1e6;
const mints = (w: ReturnType<typeof makeWorld>) =>
  (w.db.prepare("SELECT COUNT(*) AS n FROM chain_jobs WHERE kind = 'mint' AND payload LIKE '%check-in%'").get() as { n: number }).n;

describe('demo check-in PANEN limit', () => {
  it('pays PANEN for 7 demo check-ins a real day, then streak + seeds only, and again after 00:00 UTC', () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('demo1');
    assert.equal(DEMO_CHECKIN_PANEN_PER_REAL_DAY, 7);
    const start = balance(w, p.id);
    let paid = 0;
    for (let i = 0; i < 7; i++) {
      const r = w.game.checkin(p.id);
      assert.equal(r.noPanen, null);
      assert.match(r.rewards[0], /PANEN$/);
      paid += Number(r.rewards[0].split(' ')[0]);
      w.advance(MINUTE);
    }
    assert.equal(balance(w, p.id), start + paid);
    assert.deepEqual(w.game.state(p.id).checkin.demoPanen, { used: 7, max: 7 });

    const r8 = w.game.checkin(p.id);
    assert.equal(r8.noPanen, 'No PANEN: demo check-in reward limit reached today (7/7)');
    assert.deepEqual(r8.rewards, ['1 Mango seed']);
    assert.equal(r8.streak, 8);
    assert.equal(balance(w, p.id), start + paid);
    assert.equal(mints(w), 7);

    // The next real day (00:00 UTC) pays again.
    w.advance(DAY);
    const next = w.game.checkin(p.id);
    assert.equal(next.noPanen, null);
    assert.match(next.rewards[0], /PANEN$/);
    assert.deepEqual(w.game.state(p.id).checkin.demoPanen, { used: 1, max: 7 });
  });

  it('normal mode is unchanged (no limit field, one paid check-in a village day)', () => {
    const w = makeWorld({ demo: false });
    const p = w.newPlayer('normal1');
    for (let i = 0; i < 9; i++) {
      const r = w.game.checkin(p.id);
      assert.equal(r.noPanen, null);
      assert.match(r.rewards[0], /PANEN$/);
      w.advance(DAY);
    }
    assert.equal(w.game.state(p.id).checkin.demoPanen, null);
  });
});
