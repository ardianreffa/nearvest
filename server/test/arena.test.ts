// Arena 1 VS 1 (arena.ts, docs/PLAN-arena.md): round scores, best of three with dice, limits,
// anti-cheat (own garden, same person = practice, paid wins per browser / IP), the prize from the
// game (mint_reward with the Season rule), the defender's XP / news, privacy, and a new player's
// real chance against a veteran.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Arena, arenaScores, playDuel, type ArenaScores, type ArenaTree } from '../src/arena.ts';
import type { PlayerRow } from '../src/game.ts';
import { ARENA_DUELS_PER_DAY, ARENA_PAID_PER_DEVICE_PER_DAY, ARENA_PAID_PER_IP_PER_DAY, ARENA_PRIZE } from '../src/rules.ts';
import { DAY, makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

const tree = (o: Partial<ArenaTree> = {}): ArenaTree => ({ species: 'mango', quality: 'common', stage: 'fruiting', thirsty: false, wilting: false, ash: false, ...o });

/** Dice from a fixed list (then 3s). */
const dice = (...v: number[]) => () => v.shift() ?? 3;

/** A small seeded random generator (mulberry32) for long runs through the real duel code. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let ips = 0;
/** A ready garden with a Mango planted on plot 1 (unless plant: false). */
async function garden(w: World, name: string, opts: { plant?: boolean; ip?: string } = {}): Promise<PlayerRow> {
  const p = w.newPlayer(name, opts.ip ?? `10.0.1.${++ips}`);
  await w.worker.drain();
  if (opts.plant !== false) {
    w.game.checkin(p.id);
    const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
    w.game.plant(p.id, 0, seed);
    await w.worker.drain();
  }
  return w.game.getPlayer(p.id);
}

/** Challenger always wins: 6 vs 1 in every round. */
const cWins = () => {
  let i = 0;
  return () => (i++ % 2 === 0 ? 6 : 1);
};
/** Defender always wins. */
const dWins = () => {
  let i = 0;
  return () => (i++ % 2 === 0 ? 1 : 6);
};

const PRIVATE_KEY = /balance|seeds|fruits|items|email|google|wallet|custody|secret|public_?key|^ip$|device|budget|provider|subject|session|streak|account/i;
function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

describe('arena scores', () => {
  it('quality = best tree, care = share cared for, ripeness = most grown tree', () => {
    assert.deepEqual(arenaScores([]).scores, { quality: 0, care: 0, ripeness: 0 });
    const s = arenaScores([tree({ quality: 'rare', stage: 'seed', thirsty: true }), tree({ quality: 'common', stage: 'fruiting' }), tree({ stage: 'tree', ash: true })]);
    assert.deepEqual(s.scores, { quality: 2, care: 1, ripeness: 3 });
    assert.deepEqual(s.best, { species: 'mango', quality: 'rare' });
    assert.equal(s.ripest?.stage, 'fruiting');
    assert.equal(arenaScores([tree({ quality: 'gold' }), tree({ wilting: true })]).scores.care, 1);
    assert.equal(arenaScores([tree({ stage: 'old' })]).scores.ripeness, 2);
    assert.equal(arenaScores([tree({ stage: 'sprout' })]).scores.ripeness, 1);
  });

  it('best of three with dice; a tie is rolled again; all three rounds are played', () => {
    const a: ArenaScores = { quality: 1, care: 3, ripeness: 3 };
    const b: ArenaScores = { quality: 3, care: 3, ripeness: 3 };
    // Round 1: 1+4 vs 3+2 = tie, again 1+6 vs 3+1 -> challenger. Round 2: 3+1 vs 3+5 -> defender. Round 3: 3+6 vs 3+2 -> challenger.
    const r = playDuel(a, b, dice(4, 2, 6, 1, 1, 5, 6, 2));
    assert.deepEqual(r.rounds.map((x) => x.winner), ['challenger', 'defender', 'challenger']);
    assert.deepEqual(r.rounds[0].c.dice, [4, 6]);
    assert.deepEqual(r.rounds[0].d.dice, [2, 1]);
    assert.equal(r.winner, 'challenger');
    assert.deepEqual(r.score, { challenger: 2, defender: 1 });
    // Endless ties: the challenged garden wins the round.
    const t = playDuel(a, a, () => 3);
    assert.equal(t.winner, 'defender');
    assert.equal(t.rounds[0].c.dice.length, 6);
  });
});

describe('a new player has a real chance', () => {
  // Seedling with a watered Common Mango that has fruit (1 / 3 / 3) against the strongest garden
  // (Gold tree, all cared for, ripe: 3 / 3 / 3). Plan section 1.1: about 34%.
  const newbie: ArenaScores = { quality: 1, care: 3, ripeness: 3 };
  const veteran: ArenaScores = { quality: 3, care: 3, ripeness: 3 };

  it('exact odds over every dice outcome: between 30% and 40%', () => {
    // Exact chance per round (two dice, ties rolled again, after the last tie the defender wins).
    const round = (x: number, y: number) => {
      let win = 0;
      let tie = 0;
      for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) (x + a > y + b ? win++ : x + a === y + b ? tie++ : 0);
      let p = 0;
      for (let i = 0, t = 1; i <= 5; i++, t *= tie / 36) p += t * (win / 36);
      return p;
    };
    const [p1, p2, p3] = (['quality', 'care', 'ripeness'] as const).map((k) => round(newbie[k], veteran[k]));
    const duel = p1 * p2 + p1 * p3 + p2 * p3 - 2 * p1 * p2 * p3;
    assert.ok(p1 > 0.15, `quality round vs Gold: ${p1}`);
    assert.ok(duel > 0.3 && duel < 0.4, `new player wins ${(duel * 100).toFixed(1)}%`);
  });

  it('20,000 seeded duels through the real duel code agree', () => {
    const rnd = seeded(2026_11_11);
    const die = () => 1 + Math.floor(rnd() * 6);
    let wins = 0;
    const n = 20_000;
    for (let i = 0; i < n; i++) if (playDuel(newbie, veteran, die).winner === 'challenger') wins++;
    const rate = wins / n;
    assert.ok(rate > 0.31 && rate < 0.38, `new player as challenger won ${(rate * 100).toFixed(1)}%`);
    // And as the challenged garden (ties go to the defender, so a little more).
    let defended = 0;
    for (let i = 0; i < n; i++) if (playDuel(veteran, newbie, die).winner === 'defender') defended++;
    assert.ok(defended / n > 0.31 && defended / n < 0.4, `new player defended ${((defended / n) * 100).toFixed(1)}%`);
  });

  it('a real new garden (Seedling, Common Mango, watered, ripe) scores 1 / 3 / 3', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now);
    const p = await garden(w, 'baru');
    w.game.water(p.id, 0);
    w.advance(DAY); // 1 game day of growth: the Mango fruits
    w.game.water(p.id, 0);
    const side = arena.side(w.game.getPlayer(p.id));
    assert.equal(side.title, 'Seedling');
    assert.deepEqual(side.scores, { quality: 1, care: 3, ripeness: 3 });
  });
});

describe('duels', () => {
  it('a win pays the prize from the game (mint_reward, Season rule) and gives XP; the defender gets news', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now, { die: cWins() });
    const a = await garden(w, 'sari');
    const b = await garden(w, 'budi');
    w.game.seasonDivisor = 4;
    const xpA = a.xp;
    const { duel } = arena.duel(a.id, 'budi', '10.9.9.1', 'device-aaaaaaaaaaaaaaaa');
    assert.equal(duel.winner, 'challenger');
    assert.equal(duel.practice, null);
    assert.equal(duel.prize, ARENA_PRIZE / 4);
    assert.equal(duel.gainedXp, 5);
    assert.equal(w.game.getPlayer(a.id).xp, xpA + 5);
    const job = w.db.prepare("SELECT kind, payload FROM chain_jobs WHERE player_id = ? AND payload LIKE '%Arena prize%'").get(a.id) as { kind: string; payload: string };
    assert.equal(job.kind, 'mint_reward');
    assert.match(job.payload, /"memo":"Arena prize vs budi"/);
    await w.worker.drain();
    assert.equal(w.game.state(a.id).activity.find((x) => x.note === 'arena')?.status, 'done');
    // The defender: the duel in state.arena.received and a Village red dot.
    const sb = w.game.state(b.id);
    assert.equal(sb.arena.received.length, 1);
    assert.equal(sb.arena.received[0].you, 'defender');
    assert.equal(sb.arena.received[0].challenger.name, 'sari');
    assert.ok(sb.news.latestAt > sb.news.seenAt);
    assert.equal(sb.arena.received[0].gainedXp, 0);
  });

  it('a loss costs nothing; the defender gets +3 XP at most 3 times a day', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now, { die: dWins() });
    const d = await garden(w, 'kuat');
    const balance = (id: number) => w.game.getPlayer(id).balance_micro;
    const xp0 = w.game.getPlayer(d.id).xp;
    for (const n of ['a1', 'a2', 'a3', 'a4']) {
      const c = await garden(w, n);
      const before = balance(c.id);
      const { duel } = arena.duel(c.id, 'kuat', null, null);
      assert.equal(duel.winner, 'defender');
      assert.equal(duel.prize, 0);
      assert.equal(duel.gainedXp, 1);
      assert.equal(balance(c.id), before, 'no wagering: nothing taken');
    }
    assert.equal(w.game.getPlayer(d.id).xp, xp0 + 9, '3 x 3 XP, the 4th gives none');
  });

  it('3 duels a day, 1 per opponent a day (a rematch the other way is fine), new day resets', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now, { die: dWins() });
    const me = await garden(w, 'sari');
    for (const n of ['b1', 'b2', 'b3', 'b4']) await garden(w, n);
    arena.duel(me.id, 'b1', null, null);
    assert.throws(() => arena.duel(me.id, 'b1', null, null), (e: { details?: { code?: string } }) => e.details?.code === 'arena_pair_today');
    assert.equal(arena.canChallenge(me.id, 'b1').reason, 'pair_today');
    // Rematch: b1 may challenge sari.
    arena.duel(w.game.getPlayerByName('b1')!.id, 'sari', null, null);
    arena.duel(me.id, 'b2', null, null);
    arena.duel(me.id, 'b3', null, null);
    assert.equal(w.game.state(me.id).arena.left, 0);
    assert.throws(() => arena.duel(me.id, 'b4', null, null), (e: { status: number; details?: { code?: string } }) => e.status === 429 && e.details?.code === 'arena_limit');
    assert.equal(ARENA_DUELS_PER_DAY, 3);
    w.advance(DAY);
    assert.equal(w.game.state(me.id).arena.left, 3);
    assert.doesNotThrow(() => arena.duel(me.id, 'b1', null, null));
  });

  it('own garden, unknown garden and gardens without trees are refused (not counted)', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now);
    const me = await garden(w, 'sari');
    const empty = await garden(w, 'kosong', { plant: false });
    await garden(w, 'budi');
    const code = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as { details?: { code?: string } }).details?.code;
      }
      return null;
    };
    assert.equal(code(() => arena.duel(me.id, 'sari', null, null)), 'own_garden');
    assert.equal(code(() => arena.duel(me.id, 'nobody', null, null)), 'unknown_garden');
    assert.equal(code(() => arena.duel(me.id, 'kosong', null, null)), 'no_trees');
    assert.equal(code(() => arena.duel(empty.id, 'budi', null, null)), 'no_tree_you');
    assert.equal(arena.view(empty.id, []).blocked, 'no_tree');
    assert.equal(w.game.state(me.id).arena.left, 3);
  });

  it('a second garden of the same person (same browser) is a practice duel: no prize, no XP', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now, { die: cWins() });
    const main = await garden(w, 'utama');
    const alt = await garden(w, 'kedua');
    const dev = 'device-shared-000000000';
    w.db.prepare('INSERT INTO devices (player_id, device_id, first_at) VALUES (?, ?, ?)').run(main.id, dev, w.now());
    const xp = w.game.getPlayer(alt.id).xp;
    const { duel } = arena.duel(alt.id, 'utama', null, dev);
    assert.equal(duel.practice, 'self');
    assert.equal(duel.prize, 0);
    assert.equal(duel.gainedXp, 0);
    assert.equal(w.game.getPlayer(alt.id).xp, xp);
    assert.equal((w.db.prepare("SELECT count(*) AS n FROM chain_jobs WHERE payload LIKE '%Arena prize%'").get() as { n: number }).n, 0);
    // The browser is now known for the alt garden too: the reverse direction is practice as well (without a device id).
    assert.equal(arena.duel(main.id, 'kedua', null, null).duel.practice, 'self');
  });

  it('paid wins: at most 3 per browser and 10 per IP per day (then practice, XP still counts)', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now, { die: cWins() });
    const foes = [];
    for (let i = 0; i < 12; i++) foes.push(await garden(w, `foe${i}`));
    // One browser: 4 gardens on it win; the 4th win is practice.
    const dev = 'device-one-browser-0000';
    const results = [];
    for (let i = 0; i < 4; i++) {
      const c = await garden(w, `dev${i}`);
      results.push(arena.duel(c.id, foes[i].name, `10.8.0.${i}`, dev).duel);
    }
    assert.deepEqual(results.map((r) => r.practice), [null, null, null, 'limit']);
    assert.equal(results[3].prize, 0);
    assert.equal(results[3].gainedXp, 5);
    assert.equal(ARENA_PAID_PER_DEVICE_PER_DAY, 3);
    // One IP (carrier NAT / one WiFi): 10 paid wins, the 11th is practice.
    assert.equal(ARENA_PAID_PER_IP_PER_DAY, 10);
    const ipResults = [];
    for (let i = 0; i < 11; i++) {
      const c = await garden(w, `ip${i}`);
      ipResults.push(arena.duel(c.id, foes[i].name, '10.7.7.7', null).duel.practice);
    }
    assert.deepEqual(ipResults, [...Array(10).fill(null), 'limit']);
  });

  it('judge gardens can duel and win a real prize', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now, { die: cWins() });
    await garden(w, 'budi');
    const userId = Number(w.db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run('judge', 'judge-device-1', w.now()).lastInsertRowid);
    const j = w.game.createPlayer(userId, 'judge-ab12', '10.0.0.9', true);
    await w.worker.drain();
    w.game.checkin(j.id);
    const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(j.id) as { id: number }).id;
    w.game.plant(j.id, 0, seed);
    const { duel } = arena.duel(j.id, 'budi', '10.0.0.9', null);
    assert.equal(duel.practice, null);
    assert.equal(duel.prize, ARENA_PRIZE);
    assert.equal(duel.gainedXp, 25, 'demo XP x5');
  });

  it('the duel is stored once (no re-roll) and holds only public data', async () => {
    const w = makeWorld();
    const arena = new Arena(w.db, w.game, w.now);
    const a = await garden(w, 'sari');
    await garden(w, 'budi');
    const { duel } = arena.duel(a.id, 'budi', '10.1.2.3', 'device-aaaaaaaaaaaaaaaa');
    const again = arena.view(a.id, []).recent[0];
    assert.deepEqual(again.rounds, duel.rounds);
    assert.equal(again.winner, duel.winner);
    const bad = keysOf(duel).filter((k) => PRIVATE_KEY.test(k));
    assert.deepEqual(bad, [], `private fields: ${bad.join(', ')}`);
    assert.doesNotMatch(JSON.stringify(duel), /10\.1\.2\.3|device-a|@/);
  });

  it('HTTP: GET /api/arena lists opponents with a tree, POST /api/arena/duel plays', async () => {
    const w = makeWorld();
    const res = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester' }) });
    const { token } = (await res.json()) as { token: string };
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    const created = await w.app.request('/api/player', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'tester' }) });
    assert.equal(created.status, 201);
    await w.worker.drain();
    const me = w.game.getPlayerByName('tester')!;
    w.game.checkin(me.id);
    const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(me.id) as { id: number }).id;
    w.game.plant(me.id, 0, seed);
    await garden(w, 'budi');
    await garden(w, 'kosong', { plant: false });
    const view = (await (await w.app.request('/api/arena', { headers: auth })).json()) as { opponents: { name: string }[]; left: number; blocked: string | null };
    assert.deepEqual(view.opponents.map((o) => o.name), ['budi']);
    assert.equal(view.left, 3);
    assert.equal(view.blocked, null);
    const can = (await (await w.app.request('/api/arena/can/budi', { headers: auth })).json()) as { ok: boolean };
    assert.equal(can.ok, true);
    const r = await w.app.request('/api/arena/duel', { method: 'POST', headers: auth, body: JSON.stringify({ opponent: 'budi' }) });
    assert.equal(r.status, 200);
    const out = (await r.json()) as { duel: { rounds: unknown[] }; arena: { left: number }; state: { arena: { left: number } } };
    assert.equal(out.duel.rounds.length, 3);
    assert.equal(out.arena.left, 2);
    assert.equal(out.state.arena.left, 2);
  });
});
