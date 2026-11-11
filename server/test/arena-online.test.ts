// Arena v3 part 2: the online duel against a real player (arena-match.ts, docs/PLAN-arena.md 7.12).
// The switch (ARENA_ONLINE, off = TaniBot duels only), the invite (accept / decline / no answer /
// busy / judge / offline), both players' 10 s turns measured on the server, the secret open pick,
// the 20 s wait when a player is gone, cancel before the first turn, prizes and daily limits of both
// players, and the same-IP / same-browser practice rule.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Arena, duelsToday, winsToday } from '../src/arena.ts';
import { ArenaMatches, type MatchView } from '../src/arena-match.ts';
import type { PlayerRow } from '../src/game.ts';
import {
  ARENA_DUELS_PER_DAY,
  ARENA_GONE_MS,
  ARENA_INVITE_MS,
  ARENA_PAUSE_MS,
  ARENA_PLAYBACK_MS,
  ARENA_START_MS,
  ARENA_TURN_GRACE_MS,
  ARENA_TURN_MS,
  ARENA_XP_LOSS,
  ARENA_XP_WIN,
  PING_LIVE_MS,
  PING_MS,
} from '../src/rules.ts';
import { makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

let users = 0;
let ips = 0;
async function garden(w: World, name: string, opts: { judge?: boolean } = {}): Promise<PlayerRow> {
  let p: PlayerRow;
  if (opts.judge) {
    const userId = Number(w.db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run('judge', `j-${++users}-${name}`, w.now()).lastInsertRowid);
    p = w.game.createPlayer(userId, name, `10.0.9.${++ips}`, true);
  } else p = w.newPlayer(name, `10.0.3.${++ips}`);
  await w.worker.drain();
  w.game.checkin(p.id);
  const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
  w.game.plant(p.id, 0, seed);
  await w.worker.drain();
  return w.game.getPlayer(p.id);
}

/** rand = 0 always: Mango / Common throws (14 damage), the TaniBot picks Rock. */
function setup(on = true) {
  const w = makeWorld({ devLogin: true });
  w.game.arenaOnline = on;
  const arena = new Arena(w.db, w.game, w.now);
  const matches = new ArenaMatches(w.db, w.game, arena, w.now, { rand: () => 0 });
  return { w, arena, matches };
}

const online = (w: World, p: PlayerRow) => w.db.prepare('UPDATE players SET active_at = ? WHERE id = ?').run(w.now(), p.id);

async function duo(on = true) {
  const s = setup(on);
  const a = await garden(s.w, 'sari');
  const b = await garden(s.w, 'budi');
  online(s.w, b);
  return { ...s, a, b };
}

/** Starts an online duel (sari -> budi) and budi accepts it from another browser and network. */
async function liveDuel() {
  const s = await duo();
  const m = s.matches.start(s.a.id, 'budi', '1.1.1.1', 'dev-sari', true).match;
  assert.equal(m.kind, 'live');
  assert.equal(m.status, 'invite');
  const accepted = s.matches.accept(s.b.id, m.id, '2.2.2.2', 'dev-budi').match;
  assert.equal(accepted.status, 'playing');
  return { ...s, id: m.id };
}

/** Both webs poll every second for `ms` (no one is gone). */
function both(s: { w: World; matches: ArenaMatches; a: PlayerRow; b: PlayerRow; id: number }, ms: number) {
  for (let t = 0; t < ms; t += 1000) {
    s.w.advance(Math.min(1000, ms - t));
    s.matches.get(s.a.id, s.id);
    s.matches.get(s.b.id, s.id);
  }
}

/** Plays turns until a K.O.: the winner picks Paper, the loser Rock. */
function playTo(s: { w: World; matches: ArenaMatches; a: PlayerRow; b: PlayerRow; id: number }, winner: 'a' | 'b'): MatchView {
  let m = s.matches.get(s.a.id, s.id).match;
  for (let guard = 0; m.status === 'playing' && guard < 40; guard++) {
    both(s, Math.max(0, m.turnStartsInMs) + 200);
    m = s.matches.get(s.a.id, s.id).match;
    const pa = winner === 'a' ? (m.skill.c >= m.skillMax ? 'gold' : 'paper') : 'rock';
    const pb = winner === 'b' ? (m.skill.d >= m.skillMax ? 'gold' : 'paper') : 'rock';
    s.matches.pick(s.a.id, s.id, m.turn, pa);
    m = s.matches.pick(s.b.id, s.id, m.turn, pb).match;
  }
  return s.matches.get(s.a.id, s.id).match;
}

describe('arena online duel', () => {
  it('switch off: no invite, no ping invite, a normal TaniBot duel; /api/config says off', async () => {
    const { w, matches, a } = await duo(false);
    const m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a', true).match;
    assert.equal(m.kind, 'bot');
    assert.equal(m.status, 'playing');
    assert.equal(m.inviteResult, null);
    assert.equal(matches.invite(w.game.getPlayerByName('budi')!.id), null);
    const cfg = (await (await w.app.request('/api/config')).json()) as { arenaOnline: boolean };
    assert.equal(cfg.arenaOnline, false);
    assert.equal(w.game.friendSummary(a.id).pingMs, PING_MS);
    w.game.arenaOnline = true;
    assert.equal(((await (await w.app.request('/api/config')).json()) as { arenaOnline: boolean }).arenaOnline, true);
    assert.equal(w.game.friendSummary(a.id).pingMs, PING_LIVE_MS);
  });

  it('invite: the challenged player sees it, accepts, and both play', async () => {
    const { matches, a, b } = await duo();
    const m = matches.start(a.id, 'budi', '1.1.1.1', 'dev-a', true).match;
    assert.equal(m.inviteLeftMs, ARENA_INVITE_MS);
    const inv = matches.invite(b.id)!;
    assert.equal(inv.id, m.id);
    assert.equal(inv.from, 'sari');
    assert.equal(matches.invite(a.id), null);
    const acc = matches.accept(b.id, m.id, '2.2.2.2', 'dev-b').match;
    assert.equal(acc.you, 'defender');
    assert.equal(acc.status, 'playing');
    assert.equal(acc.inviteResult, 'accepted');
    assert.equal(matches.invite(b.id), null, 'no invite after accepting');
    assert.equal(acc.turnStartsInMs, ARENA_START_MS);
  });

  it('declined / no answer in 30 s / "fight the TaniBot now": the duel goes on against the TaniBot', async () => {
    {
      const { matches, a, b } = await duo();
      const m = matches.start(a.id, 'budi', null, 'dev-a', true).match;
      const d = matches.decline(b.id, m.id).match;
      assert.equal(d.kind, 'bot');
      assert.equal(d.status, 'playing');
      assert.equal(d.inviteResult, 'declined');
      assert.throws(() => matches.pick(b.id, m.id, 0, 'rock'), /Only the challenger/);
      assert.equal(matches.pick(a.id, m.id, 0, 'paper').match.turns.length, 1, 'the challenger plays the TaniBot');
    }
    {
      const { w, matches, a } = await duo();
      const m = matches.start(a.id, 'budi', null, 'dev-a', true).match;
      for (let t = 0; t < ARENA_INVITE_MS; t += 2000) {
        w.advance(2000);
        matches.get(a.id, m.id); // the challenger waits on the screen
      }
      const g = matches.get(a.id, m.id).match;
      assert.equal(g.kind, 'bot');
      assert.equal(g.inviteResult, 'timeout');
    }
    {
      const { matches, a } = await duo();
      const m = matches.start(a.id, 'budi', null, 'dev-a', true).match;
      assert.equal(matches.decline(a.id, m.id).match.inviteResult, 'skipped');
    }
  });

  it('accepting too late / after the challenger left = refused; the challenger closing the invite = cancelled, not counted', async () => {
    const { w, matches, a, b } = await duo();
    const m = matches.start(a.id, 'budi', null, 'dev-a', true).match;
    assert.equal(duelsToday(w.db, a.id, w.now()), 1, 'an invite counts while it is open');
    assert.equal(matches.leave(a.id, m.id).match.status, 'cancelled');
    assert.equal(duelsToday(w.db, a.id, w.now()), 0, 'a cancelled duel is not counted');
    assert.throws(() => matches.accept(b.id, m.id, null, 'dev-b'), /left the Arena/);
    // Can challenge budi again today (the cancelled one does not count as "already challenged").
    const again = matches.start(a.id, 'budi', null, 'dev-a', true).match;
    assert.equal(again.status, 'invite');
    matches.decline(b.id, again.id);
    assert.throws(() => matches.accept(b.id, again.id, null, 'dev-b'), /Too late/);
  });

  it('offline, judge or busy gardens get the TaniBot duel (with the reason for busy / judge)', async () => {
    const { w, matches, a, b } = await duo();
    const c = await garden(w, 'cici');
    // cici is offline: a normal TaniBot duel, no reason.
    const off = matches.start(a.id, 'cici', null, 'dev-a', true).match;
    assert.equal(off.kind, 'bot');
    assert.equal(off.inviteResult, null);
    matches.leave(a.id, off.id);
    // A judge garden that is online: never an online duel.
    const j = await garden(w, 'judge-ab12', { judge: true });
    online(w, j);
    const d = await garden(w, 'dodi');
    online(w, d);
    const jm = matches.start(d.id, 'judge-ab12', null, 'dev-d', true).match;
    assert.equal(jm.kind, 'bot');
    assert.equal(jm.inviteResult, 'judge');
    // budi is in an online duel with cici: busy.
    online(w, c);
    const e = await garden(w, 'eko');
    const live = matches.start(c.id, 'budi', null, 'dev-c', true).match;
    assert.equal(live.status, 'invite');
    const busy = matches.start(e.id, 'budi', null, 'dev-e', true).match;
    assert.equal(busy.kind, 'bot');
    assert.equal(busy.inviteResult, 'busy');
    void b;
  });

  it("the other player's open pick is never sent, only that they picked; the turn is decided once both picked", async () => {
    const s = await liveDuel();
    both(s, ARENA_START_MS + 100);
    const before = JSON.stringify(s.matches.get(s.b.id, s.id).match);
    s.matches.pick(s.a.id, s.id, 0, 'scissors');
    const seenByB = s.matches.get(s.b.id, s.id).match;
    assert.equal(seenByB.theyPicked, true);
    assert.equal(seenByB.myPick, null);
    assert.ok(!JSON.stringify(seenByB).includes('scissors'), 'the open pick is not in the answer');
    assert.equal(JSON.parse(before).turns.length, 0);
    const mine = s.matches.get(s.a.id, s.id).match;
    assert.equal(mine.myPick, 'scissors', 'your own pick survives a refresh');
    assert.equal(mine.theyPicked, false);
    // Same answers to budi whatever sari picked.
    const answers = (['rock', 'paper', 'scissors'] as const).map((p) => {
      s.w.db.prepare('UPDATE arena_matches SET pick_c = ? WHERE id = ?').run(p, s.id);
      return JSON.stringify(s.matches.get(s.b.id, s.id).match);
    });
    assert.equal(new Set(answers).size, 1);
    s.w.db.prepare("UPDATE arena_matches SET pick_c = 'scissors' WHERE id = ?").run(s.id);
    const done = s.matches.pick(s.b.id, s.id, 0, 'rock').match;
    assert.equal(done.turns.length, 1);
    assert.deepEqual(done.turns[0].pick, { c: 'scissors', d: 'rock' });
    assert.equal(done.turns[0].winner, 'defender');
    assert.ok(done.hp.c < 100 && done.hp.d === 100);
    // A retry of the decided turn changes nothing.
    assert.equal(s.matches.pick(s.a.id, s.id, 0, 'paper').match.turns.length, 1);
  });

  it('10 s per turn for both: no pick in time = that player loses the turn; neither = both are hit', async () => {
    const s = await liveDuel();
    both(s, ARENA_START_MS + 2000);
    s.matches.pick(s.b.id, s.id, 0, 'rock');
    both(s, ARENA_TURN_MS + ARENA_TURN_GRACE_MS);
    let m = s.matches.get(s.a.id, s.id).match;
    assert.equal(m.turns.length, 1);
    assert.deepEqual(m.turns[0].pick, { c: 'timeout', d: 'rock' });
    assert.equal(m.turns[0].winner, 'defender');
    assert.equal(m.skill.d, 1);
    // Next turn: nobody picks.
    both(s, ARENA_PLAYBACK_MS + ARENA_TURN_MS + ARENA_TURN_GRACE_MS + 500);
    m = s.matches.get(s.a.id, s.id).match;
    assert.equal(m.turns.length, 2);
    assert.deepEqual(m.turns[1].pick, { c: 'timeout', d: 'timeout' });
    assert.equal(m.turns[1].hits.length, 2);
    // A late pick finds its turn decided (never a second roll).
    assert.equal(s.matches.pick(s.a.id, s.id, 1, 'paper').match.turns.length, 2);
  });

  it('a player gone for 5 s pauses the duel ("Waiting for budi"); back in 20 s = it goes on', async () => {
    const s = await liveDuel();
    both(s, ARENA_START_MS);
    s.matches.pick(s.a.id, s.id, 0, 'paper');
    s.matches.pick(s.b.id, s.id, 0, 'rock'); // turn 1 decided
    for (let t = 0; t < ARENA_GONE_MS + 1000; t += 1000) {
      s.w.advance(1000);
      s.matches.get(s.a.id, s.id); // only sari's web is there
    }
    const p = s.matches.get(s.a.id, s.id).match;
    assert.equal(p.status, 'paused');
    assert.equal(p.waitingFor, 'budi');
    assert.ok(p.pauseLeftMs > ARENA_PAUSE_MS - 2000);
    assert.throws(() => s.matches.pick(s.a.id, s.id, 1, 'rock'), /Waiting for budi/);
    s.w.advance(8000);
    s.matches.get(s.a.id, s.id);
    const back = s.matches.get(s.b.id, s.id).match;
    assert.equal(back.status, 'playing');
    assert.equal(back.turnStartsInMs, ARENA_START_MS, 'the open turn starts its 10 s again');
    assert.equal(back.turns.length, 1);
  });

  it('not back in 20 s: the one who stayed wins (prize + XP, their limits); the one who left gets no XP', async () => {
    const s = await liveDuel();
    both(s, ARENA_START_MS);
    s.matches.pick(s.a.id, s.id, 0, 'rock');
    s.matches.pick(s.b.id, s.id, 0, 'paper'); // budi wins turn 1
    const xpA = s.w.game.getPlayer(s.a.id).xp;
    // sari (the challenger) leaves; budi waits on the screen.
    s.matches.leave(s.a.id, s.id);
    for (let t = 0; t < ARENA_PAUSE_MS + 2000; t += 1000) {
      s.w.advance(1000);
      s.matches.get(s.b.id, s.id);
    }
    const m = s.matches.get(s.b.id, s.id).match;
    assert.equal(m.status, 'done');
    assert.equal(m.winner, 'defender');
    assert.equal(m.endReason, 'left');
    assert.ok(m.prize > 0, 'budi gets the prize');
    assert.equal(m.gainedXp, ARENA_XP_WIN);
    assert.equal(s.w.game.getPlayer(s.a.id).xp, xpA, 'sari left: no XP');
    const job = s.w.db.prepare('SELECT job_id FROM arena_matches WHERE id = ?').get(s.id) as { job_id: number | null };
    assert.ok(job.job_id, 'a prize job for budi');
    // Limits: the duel used one of sari's 3 (the challenger); budi's day is untouched; budi's win counts for budi.
    assert.equal(duelsToday(s.w.db, s.a.id, s.w.now()), 1);
    assert.equal(duelsToday(s.w.db, s.b.id, s.w.now()), 0);
    assert.equal(winsToday(s.w.db, s.b.id, s.w.now()), 1);
    assert.equal(winsToday(s.w.db, s.a.id, s.w.now()), 0);
  });

  it('gone before the first turn was decided = cancelled (no prize, no XP, not counted)', async () => {
    const s = await liveDuel();
    s.matches.leave(s.b.id, s.id);
    for (let t = 0; t < ARENA_PAUSE_MS + 2000; t += 1000) {
      s.w.advance(1000);
      s.matches.get(s.a.id, s.id);
    }
    const m = s.matches.get(s.a.id, s.id).match;
    assert.equal(m.status, 'cancelled');
    assert.equal(m.prize, 0);
    assert.equal(duelsToday(s.w.db, s.a.id, s.w.now()), 0);
    // The sweep alone also ends it (both pages closed).
    const t = await liveDuel();
    t.matches.leave(t.a.id, t.id);
    t.matches.leave(t.b.id, t.id);
    t.w.advance(ARENA_PAUSE_MS + 1000);
    t.matches.sweep();
    t.w.advance(ARENA_PAUSE_MS + 1000);
    t.matches.sweep();
    assert.equal(t.matches.get(t.a.id, t.id).match.status, 'cancelled');
  });

  it('a K.O.: the winner gets the prize whichever side; the loser 1 XP', async () => {
    const s = await liveDuel();
    const m = playTo(s, 'b');
    assert.equal(m.status, 'done');
    assert.equal(m.endReason, 'ko');
    assert.equal(m.winner, 'defender');
    const forB = s.matches.get(s.b.id, s.id).match;
    assert.ok(forB.prize > 0);
    assert.equal(forB.gainedXp, ARENA_XP_WIN);
    assert.equal(m.gainedXp, ARENA_XP_LOSS);
    // Both see it in Recent duels; budi gets no "your TaniBot was challenged" notice for it.
    assert.equal(s.matches.recent(s.b.id)[0].id, s.id);
    assert.equal(s.w.game.state(s.b.id).arena?.receivedMatches?.length, 0);
    // Challenger win: the prize to the challenger.
    const t = await liveDuel();
    const n = playTo(t, 'a');
    assert.equal(n.winner, 'challenger');
    assert.ok(n.prize > 0);
    assert.equal(n.gainedXp, ARENA_XP_WIN);
  });

  it("anti-cheat: the same IP or the same browser on both sides = practice (no prize, no XP)", async () => {
    for (const [ipB, devB] of [
      ['1.1.1.1', 'device-budi-0000001'],
      ['2.2.2.2', 'device-sari-0000001'],
    ]) {
      const s = await duo();
      const m = s.matches.start(s.a.id, 'budi', '1.1.1.1', 'device-sari-0000001', true).match;
      const acc = s.matches.accept(s.b.id, m.id, ipB, devB).match;
      assert.equal(acc.practice, 'self');
      const done = playTo({ ...s, id: m.id }, 'a');
      assert.equal(done.prize, 0);
      assert.equal(done.gainedXp, 0);
    }
  });

  it('limits: an online duel counts toward the 3 a day of the challenger only', async () => {
    const { w, matches, a, b } = await duo();
    for (let i = 0; i < ARENA_DUELS_PER_DAY; i++) {
      const o = await garden(w, `opp${i}`);
      online(w, o);
      const m = matches.start(a.id, o.name, null, 'dev-a', true).match;
      matches.decline(o.id, m.id);
      // finish quickly: leave the TaniBot duel running is fine for the count
      w.db.prepare("UPDATE arena_matches SET status = 'done', winner = 'defender' WHERE id = ?").run(m.id);
    }
    assert.throws(() => matches.start(a.id, 'budi', null, 'dev-a', true), /used your 3 duels/);
    // budi can still challenge sari (accepting / being challenged uses none of budi's).
    online(w, a);
    const back = matches.start(b.id, 'sari', null, 'dev-b', true).match;
    assert.equal(back.status, 'invite');
  });

  it('HTTP: the ping carries the invite; accept / decline / leave routes; the view has no private data', async () => {
    const w = makeWorld({ devLogin: true });
    w.game.arenaOnline = true;
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
      return async (method: string, path: string, body?: unknown) => {
        const r = await w.app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
        return { status: r.status, json: (await r.json()) as Record<string, unknown> };
      };
    };
    const tani = await login('tani');
    const wati = await login('wati');
    await wati('POST', '/api/ping', {});
    const start = await tani('POST', '/api/arena/match', { opponent: 'wati', deviceId: 'dev-t', live: true });
    assert.equal(start.status, 200);
    const match = start.json.match as MatchView;
    assert.equal(match.status, 'invite');
    const ping = await wati('POST', '/api/ping', {});
    assert.equal((ping.json.invite as { from: string }).from, 'tani');
    const acc = await wati('POST', `/api/arena/match/${match.id}/accept`, { deviceId: 'dev-w' });
    assert.equal(acc.status, 200);
    assert.equal((acc.json.match as MatchView).status, 'playing');
    assert.equal(((acc.json.state as { arena: { active: { live: boolean } } }).arena.active).live, true);
    const text = JSON.stringify(acc.json.match);
    assert.ok(!/"ip|device|seen|pick_c|pick_d|bot_pick/.test(text));
    const left = await wati('POST', `/api/arena/match/${match.id}/leave`, {});
    assert.equal(left.status, 200);
    const poll = await tani('GET', `/api/arena/match/${match.id}`);
    assert.equal((poll.json.match as MatchView).status, 'paused');
    assert.equal((poll.json.match as MatchView).waitingFor, 'wati');
    // Switch off: the ping has no invite field at all.
    w.game.arenaOnline = false;
    assert.equal('invite' in (await wati('POST', '/api/ping', {})).json, false);
    const dec = await tani('POST', `/api/arena/match/999/decline`, {});
    assert.equal(dec.status, 404);
  });
  it('trees: an online duel needs a living tree on both sides; a Memorial Tree does not count', async () => {
    const { w, matches, a, b } = await duo();
    const memorial = (p: PlayerRow) => w.db.prepare("UPDATE trees SET status = 'dead', died_at = ? WHERE player_id = ? AND status = 'alive'").run(w.now(), p.id);
    const code = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as { details?: { code?: string } }).details?.code;
      }
      return 'ok';
    };
    memorial(b);
    assert.ok(w.game.memorialOnPlot(b.id, 0), 'budi keeps a Memorial Tree on plot 1');
    assert.equal(code(() => matches.start(a.id, 'budi', '1.1.1.1', 'dev-a', true)), 'no_trees');
    assert.equal(matches.invite(b.id), null);
    memorial(a);
    assert.equal(code(() => matches.start(a.id, 'budi', '1.1.1.1', 'dev-a', true)), 'no_tree_you');
    // budi (no living tree) cannot challenge sari either, online or not.
    assert.equal(code(() => matches.start(b.id, 'sari', '2.2.2.2', 'dev-b', true)), 'no_tree_you');
    assert.equal(duelsToday(w.db, a.id, w.now()), 0);
  });
});
