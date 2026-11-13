// Arena v2 "lite" (arena-match.ts, docs/PLAN-arena.md section 7): Rock / Paper / Scissors turns
// against the other garden's TaniBot. The rules (pure), the secret computer pick (never in any
// answer before the player's pick), retries, limits shared with v1 duels, the prize and XP, the
// 2-minute leave rule, the state for the web and privacy.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Arena } from '../src/arena.ts';
import { ArenaMatches, botPick, fruitDamage, gardenBonus, goldDamage, matchEnd, playbackMs, resolveTurn, rollFruit, type Bars, type Pick, type TurnLog } from '../src/arena-match.ts';
import type { PlayerRow } from '../src/game.ts';
import { ARENA_DUELS_PER_DAY, ARENA_PLAYBACK_MS, ARENA_PRIZE, ARENA_SAFETY_TURNS, ARENA_SKILL_MAX, ARENA_START_MS, ARENA_TURN_GRACE_MS, ARENA_TURN_MS, ARENA_XP_DEFEND, ARENA_XP_WIN } from '../src/rules.ts';
import { makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

const bars = (o: Partial<Bars> = {}): Bars => ({ hp_c: 100, hp_d: 100, skill_c: 0, skill_d: 0, bonus_c: 0, bonus_d: 0, ...o });
/** rand that always returns the same value (0 = Mango / Common / Rock for the computer). */
const fixed = (v: number) => (_n: number) => v;

let ips = 0;
async function garden(w: World, name: string): Promise<PlayerRow> {
  const p = w.newPlayer(name, `10.0.2.${++ips}`);
  await w.worker.drain();
  w.game.checkin(p.id);
  const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
  w.game.plant(p.id, 0, seed);
  await w.worker.drain();
  return w.game.getPlayer(p.id);
}

function setup(rand: (n: number) => number = fixed(0)) {
  const w = makeWorld({ devLogin: true });
  const arena = new Arena(w.db, w.game, w.now);
  const matches = new ArenaMatches(w.db, w.game, arena, w.now, { rand });
  return { w, arena, matches };
}

/** Sets the locked computer pick of a match (tests only). */
const lockBot = (w: World, id: number, pick: Pick) => w.db.prepare('UPDATE arena_matches SET bot_pick = ? WHERE id = ?').run(pick, id);

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

describe('arena v2 rules', () => {
  it('Rock beats Scissors, Scissors beat Paper, Paper beats Rock; the same pick = both dodge', () => {
    const win = (c: Pick, d: Pick) => resolveTurn(bars(), 0, c, d, fixed(0)).log.winner;
    assert.equal(win('rock', 'scissors'), 'challenger');
    assert.equal(win('scissors', 'paper'), 'challenger');
    assert.equal(win('paper', 'rock'), 'challenger');
    assert.equal(win('scissors', 'rock'), 'defender');
    assert.equal(win('paper', 'scissors'), 'defender');
    assert.equal(win('rock', 'paper'), 'defender');
    for (const p of ['rock', 'paper', 'scissors'] as const) {
      const t = resolveTurn(bars(), 0, p, p, fixed(0));
      assert.equal(t.log.winner, 'tie');
      assert.deepEqual(t.log.hits, []);
      assert.deepEqual(t.log.hp, { c: 100, d: 100 });
    }
  });

  it('the winner throws a random fruit; durian and Gold hit harder; the garden bonus adds at most 20%', () => {
    assert.deepEqual(rollFruit(fixed(0)), { species: 'mango', quality: 'common' });
    assert.deepEqual(rollFruit(fixed(99)), { species: 'durian', quality: 'gold' });
    assert.equal(fruitDamage({ species: 'mango', quality: 'common' }, 0), 14);
    assert.equal(fruitDamage({ species: 'rambutan', quality: 'common' }, 0), 18);
    assert.equal(fruitDamage({ species: 'durian', quality: 'common' }, 0), 24);
    assert.equal(fruitDamage({ species: 'durian', quality: 'gold' }, 0), 38);
    assert.ok(fruitDamage({ species: 'mango', quality: 'rare' }, 0) > 14);
    assert.equal(fruitDamage({ species: 'mango', quality: 'common' }, 20), 17);
    // Bonus from the v1 garden score: veteran 3/3/3 = 20, new player with a watered fruiting Mango 1/3/3 = 13, neglected 1/0/1 = 0.
    assert.equal(gardenBonus({ quality: 3, care: 3, ripeness: 3 }), 20);
    assert.equal(gardenBonus({ quality: 1, care: 3, ripeness: 3 }), 13);
    assert.equal(gardenBonus({ quality: 1, care: 0, ripeness: 1 }), 0);
    // Every species x quality can come out (species and quality are two separate draws).
    const kinds = new Set<string>();
    for (let sp = 0; sp < 100; sp += 7)
      for (let q = 0; q < 100; q += 7) {
        const draws = [sp, q];
        kinds.add(JSON.stringify(rollFruit(() => draws.shift()!)));
      }
    assert.equal(kinds.size, 9);
  });

  it('the skill bar fills by 1 per turn won; full = the Gold Durian: 40 x bonus, cannot be dodged, then the bar is empty', () => {
    let b = bars({ bonus_c: 20 });
    for (let i = 0; i < 5; i++) b = resolveTurn(b, i, 'rock', 'scissors', fixed(0)).bars;
    assert.equal(b.skill_c, ARENA_SKILL_MAX, 'never above full');
    const g = resolveTurn(b, 5, 'gold', 'paper', fixed(0));
    assert.equal(g.log.winner, 'challenger');
    assert.deepEqual(g.log.hits, [{ to: 'defender', fruit: { species: 'durian', quality: 'gold' }, damage: goldDamage(20), gold: true }]);
    assert.equal(goldDamage(20), 48);
    assert.equal(g.bars.skill_c, 0);
    // Both throw it: both hit.
    const both = resolveTurn(bars({ skill_c: 3, skill_d: 3 }), 0, 'gold', 'gold', fixed(0));
    assert.equal(both.log.winner, 'both');
    assert.deepEqual(both.log.hp, { c: 60, d: 60 });
    assert.deepEqual(both.log.skill, { c: 0, d: 0 });
    // A missed turn ('timeout'): the TaniBot wins it, throws, and its skill bar fills; with a full bar it throws its Gold Durian.
    const late = resolveTurn(bars({ skill_d: 1 }), 0, 'timeout', 'rock', fixed(0));
    assert.equal(late.log.winner, 'defender');
    assert.deepEqual(late.log.hits, [{ to: 'challenger', fruit: { species: 'mango', quality: 'common' }, damage: 14, gold: false }]);
    assert.equal(late.bars.skill_d, 2);
    const lateGold = resolveTurn(bars({ skill_d: 3 }), 0, 'timeout', 'gold', fixed(0));
    assert.deepEqual(lateGold.log.hits.map((h) => [h.to, h.gold, h.damage]), [['challenger', true, 40]]);
    assert.equal(lateGold.bars.skill_d, 0);
    // The web needs longer for a Gold Durian, so the next turn's clock waits for it.
    assert.equal(playbackMs(late.log), ARENA_PLAYBACK_MS);
    assert.ok(playbackMs(lateGold.log) > ARENA_PLAYBACK_MS + 3000);
    // The computer throws its own as soon as its bar is full; else a random Rock / Paper / Scissors.
    assert.equal(botPick(ARENA_SKILL_MAX, fixed(0)), 'gold');
    assert.deepEqual([0, 1, 2].map((v) => botPick(0, fixed(v))), ['rock', 'paper', 'scissors']);
  });

  it('only a K.O. ends the match (no turn limit); both down at once = a draw (arena-draw.test.ts)', () => {
    const log = (to: 'challenger' | 'defender' | null): TurnLog => ({
      turn: 0,
      pick: { c: 'rock', d: 'rock' },
      winner: 'tie',
      hits: to ? [{ to, fruit: { species: 'mango', quality: 'common' }, damage: 14, gold: false }] : [],
      hp: { c: 0, d: 0 },
      skill: { c: 0, d: 0 },
    });
    assert.equal(matchEnd(bars(), [log(null)]), null);
    const many = (n: number, to: 'challenger' | 'defender' | null) => Array.from({ length: n }, () => log(to));
    assert.equal(matchEnd(bars({ hp_c: 30, hp_d: 20 }), many(15, null)), null, 'the old 15-turn limit is gone');
    assert.equal(matchEnd(bars({ hp_c: 30, hp_d: 20 }), many(60, null)), null);
    assert.deepEqual(matchEnd(bars({ hp_d: 0 }), [log('defender')]), { winner: 'challenger', reason: 'ko' });
    assert.deepEqual(matchEnd(bars({ hp_c: 0 }), [log('challenger')]), { winner: 'defender', reason: 'ko' });
    // Both thrown down by two Gold Durians in the same turn: a draw (Ardian 2026-11-13).
    assert.deepEqual(matchEnd(bars({ hp_c: 0, hp_d: 0 }), [log('defender'), log('defender')]), { winner: null, reason: 'draw' });
    assert.deepEqual(matchEnd(bars({ hp_c: 0, hp_d: 0 }), [log(null)]), { winner: null, reason: 'draw' });
    // Only a safety net that a real match never reaches.
    assert.deepEqual(matchEnd(bars({ hp_c: 30, hp_d: 20 }), many(ARENA_SAFETY_TURNS, null)), { winner: 'challenger', reason: 'turns' });
  });
});

describe('arena v2 matches', () => {
  it('the computer pick is locked on the server and NEVER in an answer before the player picks', async () => {
    const { w, matches } = setup();
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    const { match } = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a');
    const hidden = (m: unknown) => {
      const keys = keysOf(m);
      assert.ok(!keys.some((k) => /bot_?pick|next|open|secret/i.test(k)), `no hidden pick field: ${keys.join(',')}`);
    };
    hidden(match);
    assert.equal(match.turns.length, 0);
    // The answer is the same whatever the locked pick is: nothing of it leaks.
    const answers = (['rock', 'paper', 'scissors'] as const).map((p) => {
      lockBot(w, match.id, p);
      return JSON.stringify(matches.get(a.id, match.id).match);
    });
    assert.equal(new Set(answers).size, 1);
    // After a turn, the next turn's pick is locked again and still invisible.
    lockBot(w, match.id, 'scissors');
    const after = matches.pick(a.id, match.id, 0, 'rock').match;
    hidden(after);
    assert.equal(after.turns[0].pick.d, 'scissors', 'the locked pick decided the turn');
    assert.equal(after.turns[0].winner, 'challenger');
    const next = (['rock', 'paper', 'scissors'] as const).map((p) => {
      lockBot(w, match.id, p);
      return JSON.stringify(matches.get(a.id, match.id).match);
    });
    assert.equal(new Set(next).size, 1);
  });

  it('the HTTP answers hold no open pick either (start, poll, pick)', async () => {
    const w = makeWorld({ devLogin: true });
    const login = async (u: string) => {
      const r = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u }) });
      const token = ((await r.json()) as { token: string }).token;
      const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
      await w.app.request('/api/player', { method: 'POST', headers: auth, body: JSON.stringify({ name: u }) });
      await w.worker.drain();
      const p = w.game.getPlayerByName(u)!;
      w.game.checkin(p.id);
      const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
      w.game.plant(p.id, 0, seed);
      await w.worker.drain();
      return auth;
    };
    const auth = await login('tani');
    await login('wati');
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await w.app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, text: await r.text() };
    };
    const start = await call('POST', '/api/arena/match', { opponent: 'wati', deviceId: 'dev-t' });
    assert.equal(start.status, 200);
    const id = (JSON.parse(start.text) as { match: { id: number } }).match.id;
    const bodies = [];
    for (const p of ['rock', 'paper', 'scissors'] as const) {
      lockBot(w, id, p);
      bodies.push((await call('GET', `/api/arena/match/${id}`)).text);
    }
    assert.equal(new Set(bodies).size, 1, 'the poll does not depend on the locked pick');
    assert.ok(!/bot_?pick/i.test(start.text + bodies[0]));
    lockBot(w, id, 'paper');
    const picked = await call('POST', `/api/arena/match/${id}/pick`, { turn: 0, pick: 'rock' });
    assert.equal(picked.status, 200);
    assert.ok(!/bot_?pick/i.test(picked.text));
    assert.equal((JSON.parse(picked.text) as { match: { turns: TurnLog[] } }).match.turns[0].winner, 'defender');
    // state.arena tells the web that v2 is here, and the open match to resume.
    const me = JSON.parse((await call('GET', '/api/me')).text) as { arena: { v: number; active: { id: number; opponent: string } } };
    assert.equal(me.arena.v, 2);
    assert.deepEqual(me.arena.active, { id, opponent: 'wati', live: false });
  });

  it('a retry of a decided turn gives the same result; a later turn is refused; Gold Durian only with a full bar', async () => {
    const { w, matches } = setup((n) => n - 1);
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    const { match } = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a');
    assert.throws(() => matches.pick(a.id, match.id, 0, 'gold'), /skill bar/);
    assert.throws(() => matches.pick(a.id, match.id, 0, 'lizard'), /Rock, Paper or Scissors/);
    assert.throws(() => matches.pick(a.id, match.id, 3, 'rock'), /not started/);
    lockBot(w, match.id, 'scissors');
    const first = JSON.stringify(matches.pick(a.id, match.id, 0, 'rock').match);
    const again = JSON.stringify(matches.pick(a.id, match.id, 0, 'paper').match);
    assert.equal(again, first, 'the same turn is never played twice');
    // Someone else cannot see or play it.
    const c = await garden(w, 'citra');
    assert.throws(() => matches.get(c.id, match.id), /not found/);
  });

  it('a whole match: K.O., prize from the game (mint_reward, 8 base) and win XP', async () => {
    const { w, matches } = setup(fixed(0)); // every thrown fruit = Common Mango (14), so the Gold Durian comes before the K.O.
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    let m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a').match;
    const xp0 = w.game.getPlayer(a.id).xp;
    let guard = 0;
    while (m.status === 'playing' && guard++ < 30) {
      lockBot(w, m.id, 'scissors');
      m = matches.pick(a.id, m.id, m.turn, m.skill.c >= ARENA_SKILL_MAX ? 'gold' : 'rock').match;
    }
    assert.equal(m.status, 'done');
    assert.equal(m.winner, 'challenger');
    assert.equal(m.endReason, 'ko');
    assert.equal(m.hp.d, 0);
    assert.ok(m.turns.some((t) => t.hits.some((h) => h.gold)), 'the Gold Durian was thrown');
    assert.equal(m.gainedXp, ARENA_XP_WIN);
    assert.equal(w.game.getPlayer(a.id).xp, xp0 + ARENA_XP_WIN);
    const job = w.db.prepare("SELECT kind, payload FROM chain_jobs WHERE kind = 'mint_reward' ORDER BY id DESC LIMIT 1").get() as { kind: string; payload: string };
    assert.match(job.payload, /Arena prize vs budi/);
    assert.equal(m.prize, ARENA_PRIZE);
    // A finished match cannot be played on.
    assert.equal(JSON.stringify(matches.pick(a.id, m.id, m.turn, 'rock').match), JSON.stringify(m));
  });

  it('the challenged garden sees the finished match (state, Village news) and gets defender XP when its TaniBot wins', async () => {
    const { w, matches } = setup((n) => n - 1);
    const a = await garden(w, 'sari');
    const b = await garden(w, 'budi');
    const before = w.game.state(b.id).news!.latestAt;
    let m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a').match;
    assert.equal(w.game.state(b.id).arena.receivedMatches.length, 0, 'not while it is played');
    while (m.status === 'playing') {
      lockBot(w, m.id, 'paper');
      m = matches.pick(a.id, m.id, m.turn, 'rock').match; // the TaniBot wins every turn
    }
    assert.equal(m.winner, 'defender');
    const sb = w.game.state(b.id);
    assert.equal(sb.arena.receivedMatches.length, 1);
    assert.equal(sb.arena.receivedMatches[0].you, 'defender');
    assert.equal(sb.arena.receivedMatches[0].gainedXp, ARENA_XP_DEFEND);
    assert.equal(sb.arena.receivedMatches[0].turns, undefined, 'the state stays small: no turn log');
    assert.ok(sb.news!.latestAt > before);
    assert.equal(w.game.state(a.id).arena.active, null);
  });

  it('limits are shared with v1 duels: 3 a day, 1 per opponent, one open match at a time', async () => {
    const { w, arena, matches } = setup();
    const a = await garden(w, 'sari');
    const names = ['budi', 'citra', 'dewi', 'eko'];
    for (const n of names) await garden(w, n);
    const m1 = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a').match;
    assert.throws(() => matches.start(a.id, 'citra', '1.1.1.1', 'dev-a'), (e: { details?: { code: string; matchId: number } }) => e.details?.code === 'match_open' && e.details.matchId === m1.id);
    // Leave it: its turns run out one after another until the K.O.; then the next one may start.
    w.advance(10 * 60_000);
    assert.equal(matches.sweep(), 1);
    assert.equal(w.db.prepare('SELECT status FROM arena_matches WHERE id = ?').get(m1.id)!.status, 'done');
    assert.throws(() => matches.start(a.id, 'budi', '1.1.1.1', 'dev-a'), /already challenged budi/);
    assert.throws(() => arena.duel(a.id, 'budi', '1.1.1.1', 'dev-a'), /already challenged budi/, 'a v1 duel sees the match too');
    arena.duel(a.id, 'citra', '1.1.1.1', 'dev-a');
    matches.start(a.id, 'dewi', '1.1.1.1', 'dev-a');
    w.advance(10 * 60_000);
    matches.sweep();
    assert.equal(w.game.state(a.id).arena.left, 0);
    assert.throws(() => matches.start(a.id, 'eko', '1.1.1.1', 'dev-a'), new RegExp(`${ARENA_DUELS_PER_DAY} duels today`));
    assert.equal(arena.canChallenge(a.id, 'eko').reason, 'limit');
  });

  it('each turn has 10 s on the server clock (+ a small grace); the view shows the time left', async () => {
    const { w, matches } = setup();
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    const m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a').match;
    // The first turn starts when the screen is open.
    assert.equal(m.turnStartsInMs, ARENA_START_MS);
    assert.equal(m.turnMsLeft, ARENA_TURN_MS);
    w.advance(ARENA_START_MS + 4000);
    assert.equal(matches.get(a.id, m.id).match.turnMsLeft, ARENA_TURN_MS - 4000);
    // A pick 0.5 s after the 10 s (slow network) still counts.
    w.advance(ARENA_TURN_MS - 4000 + 500);
    lockBot(w, m.id, 'scissors');
    const r = matches.pick(a.id, m.id, 0, 'rock').match;
    assert.equal(r.turns[0].pick.c, 'rock');
    assert.equal(r.turns[0].winner, 'challenger');
    // The next turn's 10 s start after the web has played this one.
    assert.equal(r.turnStartsInMs, playbackMs(r.turns[0]));
    assert.equal(r.turnMsLeft, ARENA_TURN_MS);
  });

  it('no pick in time = the turn is lost: the TaniBot throws and its skill bar fills; a late pick gets the match as it is', async () => {
    const { w, matches } = setup();
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    const m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a').match;
    w.advance(ARENA_START_MS + ARENA_TURN_MS + ARENA_TURN_GRACE_MS + 1);
    const late = matches.pick(a.id, m.id, 0, 'rock').match;
    assert.equal(late.turns.length, 1, 'the late pick did not play the turn again');
    assert.equal(late.turns[0].pick.c, 'timeout');
    assert.equal(late.turns[0].winner, 'defender');
    assert.equal(late.turns[0].hits[0].to, 'challenger');
    assert.equal(late.skill.d, 1);
    assert.ok(late.hp.c < 100);
    // The TaniBot's Gold Durian also hits a player who does not pick.
    w.db.prepare("UPDATE arena_matches SET skill_d = 3, bot_pick = 'gold' WHERE id = ?").run(m.id);
    w.advance(playbackMs(late.turns[0]) + ARENA_TURN_MS + ARENA_TURN_GRACE_MS + 1);
    const gold = matches.get(a.id, m.id).match;
    assert.equal(gold.turns[1].pick.c, 'timeout');
    assert.equal(gold.turns[1].pick.d, 'gold');
    assert.ok(gold.turns[1].hits[0].gold);
  });

  it('a player who closes the page always ends K.O. ("left": no prize, no XP); the defender gets its XP', async () => {
    const { w, matches } = setup();
    const a = await garden(w, 'sari');
    const b = await garden(w, 'budi');
    const m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a').match;
    // Away: the sweep decides the missed turns as they run out.
    let rounds = 0;
    while (w.db.prepare('SELECT status FROM arena_matches WHERE id = ?').get(m.id)!.status === 'playing' && rounds++ < 200) {
      w.advance(5000);
      matches.sweep();
    }
    const done = matches.get(a.id, m.id).match;
    assert.equal(done.status, 'done');
    assert.equal(done.winner, 'defender');
    assert.equal(done.endReason, 'left');
    assert.equal(done.hp.c, 0);
    assert.ok(done.turns.every((t) => t.pick.c === 'timeout'));
    assert.ok(done.turns.length <= 8, `K.O. after ${done.turns.length} missed turns`);
    // About 13-14 s per missed turn (10 s + grace + playback): K.O. within about two minutes.
    assert.ok(rounds * 5 <= 120, `ended after about ${rounds * 5} s`);
    assert.equal(done.prize, 0);
    assert.equal(done.gainedXp, 0);
    assert.equal(w.game.state(b.id).arena.receivedMatches[0].gainedXp, ARENA_XP_DEFEND);
    assert.equal(w.db.prepare("SELECT count(*) AS n FROM chain_jobs WHERE payload LIKE '%Arena prize%'").get()!.n, 0);
  });

  it('coming back in time: the match goes on from where the missed turns left it', async () => {
    const { w, matches } = setup();
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    const m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a').match;
    w.advance(ARENA_START_MS + ARENA_TURN_MS + ARENA_TURN_GRACE_MS + 1);
    const back = matches.get(a.id, m.id).match;
    assert.equal(back.status, 'playing');
    assert.equal(back.turn, 1);
    w.advance(back.turnStartsInMs + 1000);
    lockBot(w, m.id, 'scissors');
    const on = matches.pick(a.id, m.id, 1, 'rock').match;
    assert.equal(on.turns[1].winner, 'challenger');
    assert.equal(on.status, 'playing');
  });

  it('one person\'s two gardens play a practice match: no prize, no XP', async () => {
    const { w, matches } = setup((n) => n - 1);
    const a = await garden(w, 'sari');
    const b = await garden(w, 'budi');
    w.db.prepare('INSERT INTO devices (player_id, device_id, first_at) VALUES (?, ?, ?)').run(b.id, 'shared-browser-0001', w.now());
    let m = matches.start(a.id, 'budi', '1.1.1.1', 'shared-browser-0001').match;
    assert.equal(m.practice, 'self');
    while (m.status === 'playing') {
      lockBot(w, m.id, 'scissors');
      m = matches.pick(a.id, m.id, m.turn, m.skill.c >= ARENA_SKILL_MAX ? 'gold' : 'rock').match;
    }
    assert.equal(m.winner, 'challenger');
    assert.equal(m.prize, 0);
    assert.equal(m.gainedXp, 0);
  });

  it('a match holds only public data (no balance, seeds, email, wallet, IP, device)', async () => {
    const { w, matches } = setup();
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    const m = matches.start(a.id, 'budi', '9.9.9.9', 'dev-secret').match;
    const keys = keysOf(m);
    const bad = keys.filter((k) => /balance|seeds|fruits|items|email|google|wallet|custody|secret|^ip$|device|budget|provider|subject|session|account/i.test(k));
    assert.deepEqual(bad, []);
    assert.ok(!JSON.stringify(m).includes('9.9.9.9') && !JSON.stringify(m).includes('dev-secret'));
  });
});
