// Arena draw (Ardian 2026-11-13): both life bars reach 0 in the same turn (e.g. both throw the Gold
// Durian) = DRAW. No winner, no prize for anyone (no mint_reward), each side gets the XP of a loss,
// the duel still counts toward the challenger's 3 a day, and the duel history keeps it as a draw.
// TaniBot duel, online duel and practice duels. The 200-turn safety net keeps its own rule.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Arena, arenaState } from '../src/arena.ts';
import { ArenaMatches, matchEnd, type Bars, type Pick, type TurnLog } from '../src/arena-match.ts';
import type { PlayerRow } from '../src/game.ts';
import { ARENA_DUELS_PER_DAY, ARENA_SAFETY_TURNS, ARENA_SKILL_MAX, ARENA_XP_LOSS, DEMO_XP_MULTIPLIER } from '../src/rules.ts';
import { makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

let ips = 0;
async function garden(w: World, name: string): Promise<PlayerRow> {
  const p = w.newPlayer(name, `10.0.7.${++ips}`);
  await w.worker.drain();
  w.game.checkin(p.id);
  const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
  w.game.plant(p.id, 0, seed);
  await w.worker.drain();
  return w.game.getPlayer(p.id);
}

function setup(online = false) {
  const w = makeWorld({ devLogin: true });
  w.game.arenaOnline = online;
  const arena = new Arena(w.db, w.game, w.now);
  const matches = new ArenaMatches(w.db, w.game, arena, w.now, { rand: () => 0 });
  return { w, arena, matches };
}

/** Both sides low on life with a full skill bar: two Gold Durians in the next turn throw both down. */
const brink = (w: World, id: number) => w.db.prepare('UPDATE arena_matches SET hp_c = 5, hp_d = 5, skill_c = ?, skill_d = ? WHERE id = ?').run(ARENA_SKILL_MAX, ARENA_SKILL_MAX, id);
const lockBot = (w: World, id: number, pick: Pick) => w.db.prepare('UPDATE arena_matches SET bot_pick = ? WHERE id = ?').run(pick, id);
const xpOf = (w: World, p: PlayerRow) => w.game.getPlayer(p.id).xp;
const lossXp = (p: PlayerRow) => ARENA_XP_LOSS * (p.demo === 1 ? DEMO_XP_MULTIPLIER : 1);
const prizeJobs = (w: World) => (w.db.prepare("SELECT count(*) AS n FROM chain_jobs WHERE kind = 'mint_reward' AND payload LIKE '%Arena prize%'").get() as { n: number }).n;
const row = (w: World, id: number) => ({ ...(w.db.prepare('SELECT status, winner, end_reason, prize_micro, job_id, xp_c, xp_d FROM arena_matches WHERE id = ?').get(id) as Record<string, unknown>) });

const bars = (o: Partial<Bars> = {}): Bars => ({ hp_c: 100, hp_d: 100, skill_c: 0, skill_d: 0, bonus_c: 0, bonus_d: 0, ...o });
const log = (to: 'challenger' | 'defender' | null): TurnLog => ({
  turn: 0,
  pick: { c: 'rock', d: 'rock' },
  winner: 'tie',
  hits: to ? [{ to, fruit: { species: 'mango', quality: 'common' }, damage: 14, gold: false }] : [],
  hp: { c: 0, d: 0 },
  skill: { c: 0, d: 0 },
});

describe('arena draw', () => {
  it('rule: both down in the same turn = draw (no winner); one down = K.O.; the 200-turn safety net is unchanged', () => {
    assert.deepEqual(matchEnd(bars({ hp_c: 0, hp_d: 0 }), [log('defender'), log('defender')]), { winner: null, reason: 'draw' });
    assert.deepEqual(matchEnd(bars({ hp_c: 0, hp_d: 0 }), [log(null)]), { winner: null, reason: 'draw' });
    assert.deepEqual(matchEnd(bars({ hp_d: 0 }), [log('defender')]), { winner: 'challenger', reason: 'ko' });
    assert.deepEqual(matchEnd(bars({ hp_c: 0 }), [log('challenger')]), { winner: 'defender', reason: 'ko' });
    const many = Array.from({ length: ARENA_SAFETY_TURNS }, () => log(null));
    assert.deepEqual(matchEnd(bars({ hp_c: 30, hp_d: 30 }), many), { winner: 'defender', reason: 'turns' }, 'safety net: same life, same hits = the challenged garden');
  });

  it("TaniBot duel: two Gold Durians = DRAW; no prize, no mint_reward, the challenger gets the loss XP, the TaniBot's owner none; it still counts", async () => {
    const { w, matches } = setup();
    const a = await garden(w, 'sari');
    const b = await garden(w, 'budi');
    const m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-sari-0000001').match;
    brink(w, m.id);
    lockBot(w, m.id, 'gold');
    const [xa, xb, jobs] = [xpOf(w, a), xpOf(w, b), prizeJobs(w)];
    const done = matches.pick(a.id, m.id, m.turn, 'gold').match;
    assert.equal(done.turns.at(-1)!.winner, 'both');
    assert.deepEqual(done.hp, { c: 0, d: 0 });
    assert.equal(done.status, 'done');
    assert.equal(done.winner, null);
    assert.equal(done.endReason, 'draw');
    assert.equal(done.prize, 0);
    assert.equal(done.gainedXp, lossXp(a));
    assert.equal(xpOf(w, a) - xa, lossXp(a));
    assert.equal(xpOf(w, b) - xb, 0);
    assert.equal(prizeJobs(w), jobs, 'no mint_reward');
    assert.deepEqual(row(w, m.id), { status: 'done', winner: null, end_reason: 'draw', prize_micro: 0, job_id: null, xp_c: lossXp(a), xp_d: 0 });
    // Counted: one of today's 3 duels is used; the duel history of both gardens says draw.
    assert.equal(arenaState(w.db, a.id, w.now(), 8, '').left, ARENA_DUELS_PER_DAY - 1);
    assert.equal(matches.recent(a.id)[0].endReason, 'draw');
    assert.equal(matches.recent(b.id)[0].endReason, 'draw');
    assert.equal(matches.recent(b.id)[0].winner, null);
  });

  it('online duel: both throw the Gold Durian = DRAW; no prize for anyone, both get the loss XP; counts for the challenger only', async () => {
    const { w, matches } = setup(true);
    const a = await garden(w, 'sari');
    const b = await garden(w, 'budi');
    w.db.prepare('UPDATE players SET active_at = ? WHERE id = ?').run(w.now(), b.id);
    const inv = matches.start(a.id, 'budi', '1.1.1.1', 'dev-sari-0000001', true).match;
    assert.equal(inv.kind, 'live');
    matches.accept(b.id, inv.id, '2.2.2.2', 'dev-budi-0000001');
    brink(w, inv.id);
    let m = matches.get(a.id, inv.id).match;
    w.advance(m.turnStartsInMs + 200);
    matches.get(b.id, inv.id);
    const [xa, xb, jobs] = [xpOf(w, a), xpOf(w, b), prizeJobs(w)];
    matches.pick(a.id, inv.id, m.turn, 'gold');
    m = matches.pick(b.id, inv.id, m.turn, 'gold').match;
    assert.equal(m.status, 'done');
    assert.equal(m.winner, null);
    assert.equal(m.endReason, 'draw');
    assert.equal(m.prize, 0);
    assert.equal(m.gainedXp, lossXp(b));
    assert.equal(matches.get(a.id, inv.id).match.gainedXp, lossXp(a));
    assert.equal(xpOf(w, a) - xa, lossXp(a));
    assert.equal(xpOf(w, b) - xb, lossXp(b));
    assert.equal(prizeJobs(w), jobs, 'no mint_reward');
    assert.equal(arenaState(w.db, a.id, w.now(), 8, '').left, ARENA_DUELS_PER_DAY - 1);
    assert.equal(arenaState(w.db, b.id, w.now(), 8, '').left, ARENA_DUELS_PER_DAY, "accepting uses none of the challenged player's duels");
    assert.equal(matches.recent(a.id)[0].endReason, 'draw');
    assert.equal(matches.recent(b.id)[0].endReason, 'draw');
  });

  it('practice duels (one person, TaniBot or online): a draw gives no prize and no XP, and still counts', async () => {
    // TaniBot duel between two gardens of one browser.
    {
      const { w, matches } = setup();
      const a = await garden(w, 'sari');
      const b = await garden(w, 'budi');
      w.db.prepare('INSERT INTO devices (player_id, device_id, first_at) VALUES (?, ?, ?)').run(b.id, 'shared-browser-0001', w.now());
      const m = matches.start(a.id, 'budi', '1.1.1.1', 'shared-browser-0001').match;
      assert.equal(m.practice, 'self');
      brink(w, m.id);
      lockBot(w, m.id, 'gold');
      const [xa, xb, jobs] = [xpOf(w, a), xpOf(w, b), prizeJobs(w)];
      const done = matches.pick(a.id, m.id, m.turn, 'gold').match;
      assert.equal(done.endReason, 'draw');
      assert.equal(done.winner, null);
      assert.equal(done.prize, 0);
      assert.equal(done.gainedXp, 0);
      assert.deepEqual([xpOf(w, a) - xa, xpOf(w, b) - xb, prizeJobs(w) - jobs], [0, 0, 0]);
      assert.equal(arenaState(w.db, a.id, w.now(), 8, '').left, ARENA_DUELS_PER_DAY - 1);
    }
    // Online duel accepted from the same network = practice.
    {
      const { w, matches } = setup(true);
      const a = await garden(w, 'sari');
      const b = await garden(w, 'budi');
      w.db.prepare('UPDATE players SET active_at = ? WHERE id = ?').run(w.now(), b.id);
      const inv = matches.start(a.id, 'budi', '1.1.1.1', 'dev-sari-0000001', true).match;
      assert.equal(matches.accept(b.id, inv.id, '1.1.1.1', 'dev-budi-0000001').match.practice, 'self');
      brink(w, inv.id);
      let m = matches.get(a.id, inv.id).match;
      w.advance(m.turnStartsInMs + 200);
      matches.get(b.id, inv.id);
      const [xa, xb, jobs] = [xpOf(w, a), xpOf(w, b), prizeJobs(w)];
      matches.pick(a.id, inv.id, m.turn, 'gold');
      m = matches.pick(b.id, inv.id, m.turn, 'gold').match;
      assert.equal(m.endReason, 'draw');
      assert.equal(m.prize, 0);
      assert.deepEqual([xpOf(w, a) - xa, xpOf(w, b) - xb, prizeJobs(w) - jobs], [0, 0, 0]);
    }
  });
});
