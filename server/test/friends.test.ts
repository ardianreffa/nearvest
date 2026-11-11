// Add friend + Online (social.ts, docs/PLAN-arena.md 7.11): one-way friends without accept, the
// limits (50 friends, 20 adds per village day, never yourself), one notice per pair ever, judge
// gardens can add and be added, the Online dot from a light ping, public data only, and the
// HTTP endpoints (ping, add, remove, state, Arena opponents).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlayerRow } from '../src/game.ts';
import { ACTIVE_WRITE_MS, FRIENDS_ADDS_PER_DAY, FRIENDS_MAX, ONLINE_MS } from '../src/rules.ts';
import { Social } from '../src/social.ts';
import { DAY, makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

/** Fields that must never be in what other players see (balances, storage, sign-in, keys, IP...). */
const PRIVATE_KEY =
  /balance|seeds|fruits|items|email|google|wallet|custody|secret|public_?key|^ip$|_ip$|created_ip|budget|signin|provider|subject|session|^xp$|streak|checkin|account|active_at|last_seen|activity/i;

function keysOf(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysOf(x, out);
    }
  return out;
}

function assertPublic(v: unknown) {
  const bad = keysOf(v).filter((k) => PRIVATE_KEY.test(k));
  assert.deepEqual(bad, [], `private fields: ${bad.join(', ')}`);
  assert.doesNotMatch(JSON.stringify(v), /@|10\.0\.0\.|ed25519:/, 'no email, IP address or key');
}

let users = 0;
async function garden(w: World, name: string, opts: { judge?: boolean; plant?: boolean } = {}): Promise<PlayerRow> {
  let p: PlayerRow;
  if (opts.judge) {
    const userId = Number(w.db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run('judge', `dev-${++users}-${name}`, w.now()).lastInsertRowid);
    p = w.game.createPlayer(userId, name, '10.0.0.9', true);
  } else p = w.newPlayer(name);
  await w.worker.drain();
  if (opts.plant !== false) {
    w.game.checkin(p.id);
    const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
    w.game.plant(p.id, 0, seed);
    await w.worker.drain();
  }
  return w.game.getPlayer(p.id);
}

const social = (w: World) => new Social(w.db, w.game, w.now);

describe('add friend', () => {
  it('is one way, needs no accept, and shows the friend on top of Farmers of Tandur', async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    const budi = await garden(w, 'budi');
    await garden(w, 'citra');
    const r = s.addFriend(ani.id, 'budi');
    assert.equal(r.added, true);
    assert.equal(r.myFriends.count, 1);
    const list = s.farmers(ani.id);
    assert.deepEqual(
      list.friends.map((f) => f.name),
      ['budi'],
    );
    assert.equal(list.friends[0].friend, true);
    // The normal list keeps friends (older webs) and marks them.
    assert.equal(list.farmers.find((f) => f.name === 'budi')?.friend, true);
    assert.equal(list.farmers.find((f) => f.name === 'citra')?.friend, false);
    // One way: budi has no friend yet, but sees who added him.
    assert.equal(s.farmers(budi.id).friends.length, 0);
    const adds = w.game.state(budi.id).friendAdds;
    assert.equal(adds.length, 1);
    assert.equal(adds[0].from, 'ani');
    assert.equal(adds[0].mutual, false);
    // The visit knows it too.
    assert.equal(s.visit(ani.id, 'budi').friend, true);
    assert.equal(s.visit(budi.id, 'ani').friend, false);
  });

  it('adding twice changes nothing; remove sends no notice; add back = mutual', async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    const budi = await garden(w, 'budi');
    s.addFriend(ani.id, 'budi');
    const again = s.addFriend(ani.id, 'budi');
    assert.equal(again.added, false);
    assert.equal(again.myFriends.count, 1);
    assert.equal(again.myFriends.addsLeft, FRIENDS_ADDS_PER_DAY - 1, 'a repeat add uses no add');
    // budi adds back: both are friends, ani's notice row says mutual.
    s.addFriend(budi.id, 'ani');
    assert.equal(w.game.state(budi.id).friendAdds[0].mutual, true);
    assert.equal(w.game.state(ani.id).friendAdds[0].from, 'budi');
    // Remove: gone from the list and from budi's "added you" (no notice for the remove).
    const rm = s.removeFriend(ani.id, 'budi');
    assert.equal(rm.removed, true);
    assert.equal(s.farmers(ani.id).friends.length, 0);
    assert.equal(w.game.state(budi.id).friendAdds.length, 0);
    assert.equal(s.removeFriend(ani.id, 'budi').removed, false);
  });

  it('one notice per pair ever: add, remove, add again does not notify twice', async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    const budi = await garden(w, 'budi');
    s.addFriend(ani.id, 'budi');
    const first = w.game.state(budi.id).friendAdds[0];
    const newsAt = w.game.state(budi.id).news.latestAt;
    w.advance(60_000);
    s.removeFriend(ani.id, 'budi');
    s.addFriend(ani.id, 'budi');
    const rows = w.game.state(budi.id).friendAdds;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, first.id, 'the same (first) notice');
    assert.equal(w.game.state(budi.id).news.latestAt, newsAt, 'no new red dot');
  });

  it('the added garden gets a Village red dot until seen', async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    const budi = await garden(w, 'budi');
    w.game.villageSeen(budi.id, w.now());
    w.advance(1000);
    assert.ok(w.game.state(budi.id).news.latestAt <= w.game.state(budi.id).news.seenAt);
    s.addFriend(ani.id, 'budi');
    const n = w.game.state(budi.id).news;
    assert.ok(n.latestAt > n.seenAt, 'dot on');
    w.game.villageSeen(budi.id, n.latestAt);
    const n2 = w.game.state(budi.id).news;
    assert.ok(n2.latestAt <= n2.seenAt, 'dot off');
    // The adder gets no dot from their own add.
    const a = w.game.state(ani.id).news;
    assert.ok(a.latestAt <= w.now());
    assert.equal(w.game.state(ani.id).friendAdds.length, 0);
  });

  it('never yourself; unknown garden 404', async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    assert.throws(() => s.addFriend(ani.id, 'ani'), (e: { status: number; details: { code: string } }) => e.status === 400 && e.details.code === 'own_garden');
    assert.throws(() => s.addFriend(ani.id, 'nobody'), (e: { status: number }) => e.status === 404);
    assert.equal(s.visit(ani.id, 'ani').friend, false);
  });

  it(`at most ${FRIENDS_ADDS_PER_DAY} adds per village day (removes give none back); more the next day`, async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    for (let i = 0; i < FRIENDS_ADDS_PER_DAY + 1; i++) await garden(w, `f${i}`, { plant: false });
    for (let i = 0; i < FRIENDS_ADDS_PER_DAY - 1; i++) s.addFriend(ani.id, `f${i}`);
    s.removeFriend(ani.id, 'f0');
    s.addFriend(ani.id, 'f0'); // the 20th add today
    assert.throws(
      () => s.addFriend(ani.id, `f${FRIENDS_ADDS_PER_DAY}`),
      (e: { status: number; details: { code: string } }) => e.status === 429 && e.details.code === 'friend_adds_today',
    );
    assert.equal(s.myFriends(ani.id).addsLeft, 0);
    w.advance(DAY);
    assert.equal(s.addFriend(ani.id, `f${FRIENDS_ADDS_PER_DAY}`).added, true);
  });

  it(`at most ${FRIENDS_MAX} friends`, async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    for (let i = 0; i <= FRIENDS_MAX; i++) await garden(w, `g${i}`, { plant: false });
    for (let i = 0; i < FRIENDS_MAX; i++) {
      if (i > 0 && i % FRIENDS_ADDS_PER_DAY === 0) w.advance(DAY);
      s.addFriend(ani.id, `g${i}`);
    }
    w.advance(DAY);
    assert.equal(s.myFriends(ani.id).count, FRIENDS_MAX);
    assert.throws(() => s.addFriend(ani.id, `g${FRIENDS_MAX}`), (e: { status: number; details: { code: string } }) => e.status === 409 && e.details.code === 'friends_full');
    // Every friend is listed, also those without a tree.
    assert.equal(s.farmers(ani.id).friends.length, FRIENDS_MAX);
    s.removeFriend(ani.id, 'g0');
    assert.equal(s.addFriend(ani.id, `g${FRIENDS_MAX}`).added, true);
  });

  it('judge gardens can add friends and be added', async () => {
    const w = makeWorld();
    const s = social(w);
    const judge = await garden(w, 'judge-ab12', { judge: true });
    const ani = await garden(w, 'ani');
    assert.equal(s.addFriend(judge.id, 'ani').added, true);
    assert.equal(s.addFriend(ani.id, 'judge-ab12').added, true);
    const f = s.farmers(ani.id).friends;
    assert.equal(f[0].name, 'judge-ab12');
    assert.equal(f[0].judge, true);
    assert.equal(w.game.state(ani.id).friendAdds[0].from, 'judge-ab12');
  });
});

describe('online dot', () => {
  it('a ping makes a garden Online for 1 minute; away = offline at once', async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    const budi = await garden(w, 'budi');
    s.addFriend(ani.id, 'budi');
    const online = () => s.farmers(ani.id).friends[0].online;
    assert.equal(online(), false, 'never pinged');
    s.ping(budi.id);
    assert.equal(online(), true);
    assert.equal(s.farmers(ani.id).farmers.find((f) => f.name === 'budi')?.online, true);
    assert.equal(s.visit(ani.id, 'budi').online, true);
    w.advance(ONLINE_MS - 1000);
    assert.equal(online(), true);
    w.advance(2000);
    assert.equal(online(), false, 'no ping for a minute');
    s.ping(budi.id);
    assert.equal(online(), true);
    s.ping(budi.id, true);
    assert.equal(online(), false, 'tab hidden or closed');
  });

  it(`the ping writes at most every ${ACTIVE_WRITE_MS / 1000} s`, async () => {
    const w = makeWorld();
    const s = social(w);
    const ani = await garden(w, 'ani');
    const at = () => (w.db.prepare('SELECT active_at AS t FROM players WHERE id = ?').get(ani.id) as { t: number }).t;
    s.ping(ani.id);
    const first = at();
    w.advance(ACTIVE_WRITE_MS - 1);
    s.ping(ani.id);
    assert.equal(at(), first, 'no write');
    w.advance(2);
    s.ping(ani.id);
    assert.equal(at(), w.now());
  });

  it('online farmers come first in the farmer list', async () => {
    const w = makeWorld({ devLogin: true });
    const s = social(w);
    const ani = await garden(w, 'ani');
    await garden(w, 'budi');
    const citra = await garden(w, 'citra');
    w.advance(5 * 60_000);
    w.game.touch(w.game.getPlayerByName('budi')!.id);
    s.ping(citra.id);
    const names = s.farmers(ani.id).farmers.map((f) => f.name);
    assert.equal(names[0], 'citra');
    const row = s.farmers(ani.id).farmers[0];
    assert.equal(row.online, true);
  });
});

describe('friends: privacy and HTTP', () => {
  it('lists, visits, notices and Arena opponents hold public data only', async () => {
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
    const a = await login('tani');
    const b = await login('wati');
    const call = async (auth: Record<string, string>, method: string, path: string, body?: unknown) => {
      const r = await w.app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, json: (await r.json()) as Record<string, never> };
    };
    // Ping (wati online), add, then everything tani and wati can see.
    assert.equal((await call(b, 'POST', '/api/ping', {})).status, 200);
    const add = await call(a, 'POST', '/api/friends/wati');
    assert.equal(add.status, 200);
    assert.equal((add.json.result as { added: boolean }).added, true);
    assert.equal((add.json.state as { friends: { count: number } }).friends.count, 1);
    const farmers = await call(a, 'GET', '/api/farmers');
    const friends = farmers.json.friends as { name: string; online: boolean }[];
    assert.deepEqual(
      friends.map((f) => [f.name, f.online]),
      [['wati', true]],
    );
    assertPublic(farmers.json.friends);
    assertPublic(farmers.json.farmers);
    const visit = await call(a, 'GET', '/api/farmers/wati');
    assert.equal(visit.json.friend, true);
    assert.equal(visit.json.online, true);
    const arena = await call(a, 'GET', '/api/arena');
    const opp = (arena.json.opponents as { name: string; friend: boolean; online: boolean }[])[0];
    assert.deepEqual([opp.name, opp.friend, opp.online], ['wati', true, true]);
    assertPublic(arena.json.opponents);
    const me = await call(b, 'GET', '/api/me');
    const adds = me.json.friendAdds as { from: string; title: string; online: boolean; mutual: boolean }[];
    assert.equal(adds[0].from, 'tani');
    assert.equal(adds[0].mutual, false);
    assertPublic(adds);
    assert.deepEqual(Object.keys(adds[0]).sort(), ['at', 'avatar', 'from', 'id', 'mutual', 'online', 'title']);
    assert.deepEqual(Object.keys(friends[0]).sort(), ['avatar', 'friend', 'helpedYou', 'judge', 'name', 'online', 'thirsty', 'title', 'trees']);
    // Errors: yourself, unknown garden; remove.
    assert.equal((await call(a, 'POST', '/api/friends/tani')).status, 400);
    assert.equal((await call(a, 'POST', '/api/friends/nobody')).status, 404);
    const rm = await call(a, 'POST', '/api/friends/wati/remove');
    assert.equal((rm.json.result as { removed: boolean }).removed, true);
    assert.equal(((await call(b, 'GET', '/api/me')).json.friendAdds as unknown[]).length, 0);
    // Away: offline at once.
    await call(b, 'POST', '/api/ping', { away: true });
    assert.equal(((await call(a, 'GET', '/api/farmers')).json.farmers as { name: string; online: boolean }[]).find((f) => f.name === 'wati')?.online, false);
  });

  it('the ping needs a session', async () => {
    const w = makeWorld();
    const r = await w.app.request('/api/ping', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401);
  });
});

describe('judge gardens linked by a friendship', () => {
  it('show in the search and the list when either side added the other; other judge gardens never do', async () => {
    const w = makeWorld();
    const s = social(w);
    const me = await garden(w, 'ardian65');
    for (const n of ['ani', 'budi', 'citra', 'dewi', 'eko']) await garden(w, n); // 5 real farmers: no judge filler
    const s5dv = await garden(w, 'judge-s5dv', { judge: true });
    await garden(w, 'judge-aaaa', { judge: true });
    await garden(w, 'judge-zzzz', { judge: true });
    s.addFriend(s5dv.id, 'ardian65'); // the judge added me
    s.addFriend(me.id, 'judge-aaaa'); // I added a judge

    const search = s.farmers(me.id, 'judge');
    assert.deepEqual(search.farmers.map((f) => f.name).sort(), ['judge-aaaa', 'judge-s5dv']);
    assert.ok(search.farmers.every((f) => f.judge), 'still marked as judge gardens');
    assert.equal(search.farmers.find((f) => f.name === 'judge-aaaa')!.friend, true);
    assert.equal(search.farmers.find((f) => f.name === 'judge-s5dv')!.friend, false);
    assert.equal(s.farmers(me.id, 'judge-s5dv').farmers[0].name, 'judge-s5dv', 'exact name');

    const list = s.farmers(me.id).farmers.map((f) => f.name);
    assert.ok(list.includes('judge-s5dv') && list.includes('judge-aaaa'), list.join());
    assert.ok(!list.includes('judge-zzzz'), 'an unlinked judge garden stays hidden');
    assert.equal(new Set(list).size, list.length, 'no row twice');

    // Never yourself: the judge finds me, not itself, and not the judge it has no link with.
    assert.deepEqual(s.farmers(s5dv.id, 'judge').farmers, []);
    assert.deepEqual(s.farmers(s5dv.id, 'ardian').farmers.map((f) => f.name), ['ardian65']);
    assert.ok(!s.farmers(me.id, 'ardian').farmers.some((f) => f.name === 'ardian65'));

    // The link ends when the judge removes me.
    s.removeFriend(s5dv.id, 'ardian65');
    assert.deepEqual(s.farmers(me.id, 'judge').farmers.map((f) => f.name), ['judge-aaaa']);
    assert.ok(!s.farmers(me.id).farmers.some((f) => f.name === 'judge-s5dv'));
  });

  it('with few real farmers a linked judge garden is not listed twice and sorts with the real farmers', async () => {
    const w = makeWorld();
    const s = social(w);
    const me = await garden(w, 'ardian65');
    await garden(w, 'ani');
    const s5dv = await garden(w, 'judge-s5dv', { judge: true });
    for (const n of ['judge-bbbb', 'judge-cccc', 'judge-dddd', 'judge-eeee']) await garden(w, n, { judge: true });
    s.addFriend(s5dv.id, 'ardian65');
    const list = s.farmers(me.id).farmers.map((f) => f.name);
    assert.equal(new Set(list).size, list.length, 'no row twice');
    assert.equal(list.length, 5, 'still filled up to 5');
    assert.deepEqual(list.slice(0, 2).sort(), ['ani', 'judge-s5dv'], 'the linked judge sorts with the real farmers');
  });
});
