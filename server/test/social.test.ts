// Garden visits (social.ts, docs/PLAN-social.md): the farmer list (no judge gardens unless fewer
// than 5 farmers, never private data), visiting a garden (read only) and helping water one tree
// per village day (thirsty trees only, not in the rain, helper +5 XP, owner +3 XP at most 3 times
// per day, no XP for gardens younger than a day).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlayerRow } from '../src/game.ts';
import { HELP_OWNER_XP_PER_DAY } from '../src/rules.ts';
import { Social } from '../src/social.ts';
import type { WeatherKind, WeatherSchedule } from '../src/weather.ts';
import { DAY, makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

/** Fields that must never be in what visitors get (balances, storage, sign-in, keys, IP...). */
const PRIVATE_KEY = /balance|seeds|fruits|items|email|google|wallet|custody|secret|public_?key|^ip$|_ip$|created_ip|budget|signin|provider|subject|session|xp$|streak|checkin|tanibot|activity/i;

/** Every key name in a JSON value (nested). */
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
  assert.deepEqual(bad, [], `private fields in a public view: ${bad.join(', ')}`);
  assert.doesNotMatch(JSON.stringify(v), /@|10\.0\.0\.|ed25519:/, 'no email, IP address or key');
}

function weather(kind: WeatherKind): WeatherSchedule {
  return { kind: () => kind, eruption: () => null };
}

let users = 0;
/** A ready garden with a mango planted on plot 1 (thirsty: never watered). */
async function garden(w: World, name: string, opts: { judge?: boolean; plant?: boolean } = {}): Promise<PlayerRow> {
  let p: PlayerRow;
  if (opts.judge) {
    const userId = Number(
      w.db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run('judge', `device-${++users}-${name}`, w.now()).lastInsertRowid,
    );
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

const xpOf = (w: World, id: number) => w.game.getPlayer(id).xp;
/** The owner's tree dries out again (as if a day passed for it), to test more helps on one day. */
const dryAgain = (w: World, ownerId: number) => w.db.prepare("UPDATE trees SET water_until = 0, water_day = NULL, water_count = 0 WHERE player_id = ? AND status = 'alive'").run(ownerId);

describe('farmer list', () => {
  it('shows other ready gardens with a living tree; not your own, not empty gardens; no private data', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const me = await garden(w, 'sari');
    await garden(w, 'budi');
    await garden(w, 'tono', { plant: false }); // no tree: not listed
    const list = social.farmers(me.id);
    assert.deepEqual(list.farmers.map((f) => f.name), ['budi']);
    assert.deepEqual(Object.keys(list.farmers[0]).sort(), ['avatar', 'helpedYou', 'judge', 'name', 'thirsty', 'title', 'trees']);
    assert.equal(list.farmers[0].trees, 1);
    assert.equal(list.farmers[0].thirsty, 1);
    assertPublic(list.farmers);
  });

  it('judge gardens are hidden, but fill the list (newest first) while there are fewer than 5 farmers', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const me = await garden(w, 'sari');
    await garden(w, 'budi');
    for (const n of ['judge-aaaa', 'judge-bbbb', 'judge-cccc', 'judge-dddd', 'judge-eeee']) {
      await garden(w, n, { judge: true });
      w.advance(60_000);
    }
    const names = social.farmers(me.id).farmers.map((f) => f.name);
    assert.equal(names.length, 5, 'never empty: topped up to 5');
    assert.equal(names[0], 'budi');
    assert.deepEqual(names.slice(1).sort(), ['judge-bbbb', 'judge-cccc', 'judge-dddd', 'judge-eeee'], 'the newest judge gardens');
    assert.ok(social.farmers(me.id).farmers.find((f) => f.name === 'judge-eeee')!.judge);

    for (const n of ['ani', 'eko', 'dewi', 'fajar']) await garden(w, n);
    const full = social.farmers(me.id).farmers;
    assert.equal(full.length, 5);
    assert.ok(full.every((f) => !f.judge), 'with 5 real farmers no judge garden is shown');
  });

  it('a judge sees the real farmers too (judges can visit and help)', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    await garden(w, 'budi');
    const judge = await garden(w, 'judge-aaaa', { judge: true });
    assert.deepEqual(social.farmers(judge.id).farmers.map((f) => f.name), ['budi']);
  });

  it('leaves out gardens not seen for more than 7 days; /api/me marks a garden as seen', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    await garden(w, 'budi');
    const me = await garden(w, 'sari');
    w.advance(8 * DAY);
    w.game.touch(me.id);
    const other = await garden(w, 'ani');
    assert.deepEqual(social.farmers(other.id).farmers.map((f) => f.name), ['sari']);
  });

  it('order: farmers who helped you first, then gardens with a thirsty tree, then the most recently active', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const me = await garden(w, 'sari');
    const helper = await garden(w, 'budi');
    const watered = await garden(w, 'ani');
    w.game.water(watered.id, 0);
    w.game.water(helper.id, 0);
    w.advance(60_000);
    const thirsty = await garden(w, 'eko');
    w.game.water(thirsty.id, 0);
    dryAgain(w, thirsty.id);
    social.help(helper.id, 'sari', 0);
    const rows = social.farmers(me.id).farmers;
    assert.deepEqual(rows.map((f) => f.name), ['budi', 'eko', 'ani']);
    assert.equal(rows[0].helpedYou, true);
    assert.equal(rows[1].thirsty, 1);
  });
});

describe('visiting a garden (read only)', () => {
  it('shows name, title, avatar and trees; never private data', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const me = await garden(w, 'sari');
    await garden(w, 'budi');
    const v = social.visit(me.id, 'budi');
    assert.equal(v.own, false);
    assert.equal(v.garden.name, 'budi');
    assert.equal(v.garden.title, 'Seedling');
    assert.equal(v.garden.plots[0].tree!.species, 'mango');
    assert.equal(v.garden.plots[0].tree!.needsWater, true);
    assert.equal(v.garden.plots[1].tree, null);
    assertPublic(v.garden);
    assert.equal(social.visit(me.id, 'sari').own, true);
    assert.throws(() => social.visit(me.id, 'nobody'), /Garden not found/);
  });

  it('over HTTP: the farmer list and a visit need a session and carry no private data', async () => {
    const w = makeWorld();
    await garden(w, 'budi');
    assert.equal((await w.app.request('/api/farmers')).status, 401);
    const login = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester' }) });
    const { token } = (await login.json()) as { token: string };
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    await w.app.request('/api/player', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'tester' }) });
    await w.worker.drain();
    const list = await w.app.request('/api/farmers', { headers: auth });
    assert.equal(list.status, 200);
    const visit = await w.app.request('/api/farmers/budi', { headers: auth });
    assert.equal(visit.status, 200);
    assertPublic(((await visit.json()) as { garden: unknown }).garden);
    assertPublic(((await list.json()) as { farmers: unknown }).farmers);
  });
});

describe('help water: one tree per day', () => {
  it('waters a thirsty friend tree: helper +5 XP, owner +3 XP, and the owner sees who helped', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const helper = await garden(w, 'sari');
    const owner = await garden(w, 'budi');
    w.advance(DAY + 60_000); // both gardens are older than a day
    w.game.water(helper.id, 0);
    w.game.water(owner.id, 0);
    dryAgain(w, owner.id);
    const before = { helper: xpOf(w, helper.id), owner: xpOf(w, owner.id) };
    const r = social.help(helper.id, 'budi', 0);
    assert.equal(r.helperXp, 5);
    assert.equal(r.ownerXp, 3);
    assert.equal(xpOf(w, helper.id), before.helper + 5);
    assert.equal(xpOf(w, owner.id), before.owner + 3);
    const s = w.game.state(owner.id);
    assert.equal(s.plots[0].tree!.wateredToday, true, "the owner's tree is watered");
    assert.equal(s.helps[0].helper, 'sari');
    assert.equal(s.helps[0].species, 'mango');
    assert.equal(s.helps[0].xp, 3);
    assert.equal(social.visit(helper.id, 'budi').helpedToday!.name, 'budi');
  });

  it('once per village day (any garden); the next day again', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const helper = await garden(w, 'sari');
    await garden(w, 'budi');
    await garden(w, 'ani');
    social.help(helper.id, 'budi', 0);
    assert.throws(() => social.help(helper.id, 'ani', 0), /already helped budi today/);
    w.advance(DAY);
    assert.equal(social.help(helper.id, 'ani', 0).watered, true);
  });

  it('demo gardens: the limit is the normal village day, not a 1-minute demo day', async () => {
    const w = makeWorld({ demo: true });
    const social = new Social(w.db, w.game, w.now);
    const helper = await garden(w, 'sari');
    await garden(w, 'budi');
    await garden(w, 'ani');
    social.help(helper.id, 'budi', 0);
    w.advance(5 * 60_000); // five demo days
    assert.throws(() => social.help(helper.id, 'ani', 0), /already helped/);
  });

  it('only a thirsty tree: not a watered tree, not an empty plot, not an old tree', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const helper = await garden(w, 'sari');
    const owner = await garden(w, 'budi');
    w.game.water(owner.id, 0);
    assert.throws(() => social.help(helper.id, 'budi', 0), (e: Error & { details?: { code?: string } }) => e.details?.code === 'not_thirsty');
    assert.throws(() => social.help(helper.id, 'budi', 1), /no tree/);
    dryAgain(w, owner.id);
    w.db.prepare("UPDATE trees SET harvest_count = max_harvests WHERE player_id = ? AND status = 'alive'").run(owner.id);
    assert.throws(() => social.help(helper.id, 'budi', 0), /enough water/);
    assert.equal(social.visit(helper.id, 'budi').helpedToday, null, 'a refused help does not use up the day');
  });

  it('not in the rain (every tree is watered for free)', async () => {
    const w = makeWorld({ weather: weather('rain') });
    const social = new Social(w.db, w.game, w.now);
    const helper = await garden(w, 'sari');
    await garden(w, 'budi');
    assert.throws(() => social.help(helper.id, 'budi', 0), (e: Error & { details?: { code?: string } }) => e.details?.code === 'rain');
    assert.equal(social.farmers(helper.id).farmers[0].thirsty, 0);
  });

  it('never your own garden', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const me = await garden(w, 'sari');
    assert.throws(() => social.help(me.id, 'sari', 0), /your own garden/);
  });

  it('the owner gets help XP at most 3 times a day; more helps still water', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const owner = await garden(w, 'budi');
    const helpers = [];
    for (const n of ['sari', 'ani', 'eko', 'dewi']) helpers.push(await garden(w, n));
    w.advance(DAY + 60_000);
    const xp = [];
    for (const h of helpers) {
      dryAgain(w, owner.id);
      xp.push(social.help(h.id, 'budi', 0));
    }
    assert.deepEqual(xp.map((r) => r.ownerXp), [3, 3, 3, 0]);
    assert.equal(HELP_OWNER_XP_PER_DAY, 3);
    assert.ok(xp.every((r) => r.watered && r.helperXp === 5), 'every helper still gets XP and waters');
  });

  it('a garden younger than a day gets no help XP (watering still works)', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const old = await garden(w, 'budi');
    w.advance(DAY + 60_000);
    const young = await garden(w, 'sari');
    // A young helper: no XP for the helper, the older owner still gets XP.
    dryAgain(w, old.id);
    const a = social.help(young.id, 'budi', 0);
    assert.deepEqual([a.helperXp, a.ownerXp, a.noXpReason], [0, 3, 'young']);
    // A young owner: the older helper gets XP, the young owner none.
    const b = social.help(old.id, 'sari', 0);
    assert.deepEqual([b.helperXp, b.ownerXp], [5, 0]);
    assert.equal(w.game.state(young.id).plots[0].tree!.wateredToday, true);
  });

  it('a drought: a help counts as one of the two waterings', async () => {
    const w = makeWorld({ weather: weather('drought') });
    const social = new Social(w.db, w.game, w.now);
    const helper = await garden(w, 'sari');
    const owner = await garden(w, 'budi');
    const r = social.help(helper.id, 'budi', 0);
    assert.deepEqual([r.waterings, r.needed], [1, 2]);
    assert.equal(w.game.state(owner.id).plots[0].tree!.waterCount, 1);
  });

  it('over HTTP: POST /api/farmers/:name/water returns the result, my state and the updated visit', async () => {
    const w = makeWorld();
    await garden(w, 'budi');
    const login = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester' }) });
    const { token } = (await login.json()) as { token: string };
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    await w.app.request('/api/player', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'tester' }) });
    await w.worker.drain();
    const res = await w.app.request('/api/farmers/budi/water', { method: 'POST', headers: auth, body: JSON.stringify({ plot: 0 }) });
    assert.equal(res.status, 200);
    const j = (await res.json()) as { result: { owner: string }; state: { player: { name: string } }; visit: { garden: { plots: { tree: { needsWater: boolean } }[] } } };
    assert.equal(j.result.owner, 'budi');
    assert.equal(j.state.player.name, 'tester');
    assert.equal(j.visit.garden.plots[0].tree.needsWater, false);
    const again = await w.app.request('/api/farmers/budi/water', { method: 'POST', headers: auth, body: JSON.stringify({ plot: 0 }) });
    assert.equal(again.status, 409);
  });
});
