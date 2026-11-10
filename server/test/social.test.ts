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
const PRIVATE_KEY =
  /balance|seeds|fruits|items|email|google|wallet|custody|secret|public_?key|^ip$|_ip$|created_ip|budget|signin|provider|subject|session|xp$|streak|checkin|tanibot.|bot_?account|limit|spent|style|status|log$|activity/i;

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

/** Every value stored under the key `name` (nested). */
function valuesOf(v: unknown, name: string, out: unknown[] = []): unknown[] {
  if (Array.isArray(v)) v.forEach((x) => valuesOf(x, name, out));
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      if (k === name) out.push(x);
      valuesOf(x, name, out);
    }
  return out;
}

function assertPublic(v: unknown) {
  // A visited garden's TaniBot is decoration: ON / OFF and nothing else.
  for (const bot of valuesOf(v, 'tanibot')) if (bot !== null) assert.deepEqual(Object.keys(bot as object), ['on'], 'TaniBot: only on/off');
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

  it("shows the owner's TaniBot as ON / OFF only (no budget, limit, account, style or log)", async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const me = await garden(w, 'sari');
    const budi = await garden(w, 'budi');
    assert.equal(social.visit(me.id, 'budi').garden.tanibot, null, 'no TaniBot yet: none shown');
    w.tanibot.setup(budi.id, { dailyLimit: 10, budget: 20 });
    await w.worker.drain();
    const on = social.visit(me.id, 'budi').garden;
    assert.deepEqual(on.tanibot, { on: true });
    assertPublic(on);
    const json = JSON.stringify(on);
    assert.doesNotMatch(json, /bot\.budi|nearvest\.testnet"?[^"]*bot|"budget|"dailyLimit|"style|"log/, 'no TaniBot account or settings');
    w.tanibot.settings(budi.id, { enabled: false });
    assert.deepEqual(social.visit(me.id, 'budi').garden.tanibot, { on: false });
    // Over HTTP too (the same view).
    const login = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester' }) });
    const { token } = (await login.json()) as { token: string };
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    await w.app.request('/api/player', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'tester' }) });
    await w.worker.drain();
    const body = (await (await w.app.request('/api/farmers/budi', { headers: auth })).json()) as { garden: { tanibot: unknown } };
    assert.deepEqual(body.garden.tanibot, { on: false });
    assertPublic(body.garden);
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

describe('stickers', () => {
  it('a visitor leaves up to 3 stickers per garden per village day, 5 s apart; the owner sees them', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const sari = await garden(w, 'sari');
    const budi = await garden(w, 'budi');
    const tono = await garden(w, 'tono');
    const v = social.visit(budi.id, 'sari');
    assert.equal(v.stickers.length, 6);
    assert.equal(v.stickerToday, null);
    assert.deepEqual([v.stickersToday, v.stickerMax, v.stickerWaitMs], [[], 3, 0]);
    const r = social.sticker(budi.id, 'sari', 'nice_garden');
    assert.deepEqual(r, { owner: 'sari', sticker: 'nice_garden', text: 'Nice garden!', sent: 1, max: 3 });
    const v1 = social.visit(budi.id, 'sari');
    assert.equal(v1.stickerToday, 'nice_garden');
    assert.equal(v1.stickerWaitMs, 5000);
    // Too fast: refused with the time left (the web counts down).
    w.advance(2000);
    assert.throws(() => social.sticker(budi.id, 'sari', 'gold_vibes'), (e: any) => e.status === 429 && e.details.code === 'sticker_wait' && e.details.waitMs === 3000);
    assert.equal(social.visit(budi.id, 'sari').stickerWaitMs, 3000);
    w.advance(3000);
    social.sticker(budi.id, 'sari', 'gold_vibes');
    w.advance(5000);
    assert.equal(social.sticker(budi.id, 'sari', 'see_you').sent, 3);
    assert.deepEqual(social.visit(budi.id, 'sari').stickersToday, ['nice_garden', 'gold_vibes', 'see_you']);
    w.advance(5000);
    assert.throws(() => social.sticker(budi.id, 'sari', 'keep_it_up'), (e: any) => e.status === 409 && e.details.code === 'sticker_today');
    // Another garden the same day is fine; so is another visitor.
    social.sticker(budi.id, 'tono', 'keep_it_up');
    social.sticker(tono.id, 'sari', 'gold_vibes');
    const got = w.game.state(sari.id).stickers;
    assert.deepEqual(got.map((s) => [s.from, s.sticker]), [['tono', 'gold_vibes'], ['budi', 'see_you'], ['budi', 'gold_vibes'], ['budi', 'nice_garden']]);
    // The next village day: again.
    w.advance(DAY);
    social.sticker(budi.id, 'sari', 'see_you');
    assert.equal(w.game.state(sari.id).stickers.length, 5);
  });

  it('only known stickers (no free text), never in your own garden, the visit view stays public', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const sari = await garden(w, 'sari');
    const budi = await garden(w, 'budi');
    for (const bad of ['hello there', '', null, 42, { id: 'nice_garden' }])
      assert.throws(() => social.sticker(budi.id, 'sari', bad), (e: any) => e.status === 400 && e.details.code === 'unknown_sticker');
    assert.throws(() => social.sticker(sari.id, 'sari', 'nice_garden'), (e: any) => e.details.code === 'own_garden');
    assert.throws(() => social.sticker(sari.id, 'nobody', 'nice_garden'), (e: any) => e.status === 404);
    assert.equal(social.visit(sari.id, 'sari').stickerToday, null);
    assertPublic(social.visit(budi.id, 'sari').garden);
  });

  it('POST /api/farmers/:name/sticker returns the visit with stickerToday; the owner state lists only the last 10', async () => {
    const w = makeWorld();
    const tok = async (u: string) => ((await (await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u }) })).json()) as any).token as string;
    const post = async (t: string, path: string, body: unknown) => {
      const res = await w.app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any };
    };
    const owner = await tok('owner');
    await post(owner, '/api/player', { name: 'sari' });
    await w.worker.drain();
    for (let i = 0; i < 12; i++) {
      const t = await tok(`v${i}`);
      await post(t, '/api/player', { name: `visitor${i}` });
      const r = await post(t, '/api/farmers/sari/sticker', { sticker: 'keep_it_up' });
      assert.equal(r.status, 200);
      assert.equal(r.json.visit.stickerToday, 'keep_it_up');
      // Straight away a second one: 429 with the wait.
      const fast = await post(t, '/api/farmers/sari/sticker', { sticker: 'see_you' });
      assert.equal(fast.status, 429);
      assert.equal(fast.json.code, 'sticker_wait');
    }
    const me = await w.app.request('/api/me', { headers: { Authorization: `Bearer ${owner}` } });
    const s = (await me.json()) as any;
    assert.equal(s.stickers.length, 10);
    assert.equal(s.stickers[0].from, 'visitor11');
  });
});

describe('visits, visitors list and wave back', () => {
  it('every visit is recorded once per visitor per garden per day, without XP; stickers and watering join that row', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const sari = await garden(w, 'sari');
    const budi = await garden(w, 'budi');
    const tono = await garden(w, 'tono');
    const xp = xpOf(w, budi.id);
    social.visit(budi.id, 'sari');
    social.visit(budi.id, 'sari');
    social.visit(sari.id, 'sari'); // your own garden: no row
    assert.equal(xpOf(w, budi.id), xp, 'visiting alone gives no XP');
    let rows = w.game.state(sari.id).visitors;
    assert.equal(rows.length, 1);
    assert.deepEqual([rows[0].from, rows[0].today, rows[0].stickers, rows[0].watered, rows[0].wave, rows[0].canWave], ['budi', true, [], null, null, true]);
    w.advance(10_000);
    social.sticker(budi.id, 'sari', 'nice_garden');
    w.advance(6000);
    social.sticker(budi.id, 'sari', 'keep_it_up');
    social.help(budi.id, 'sari', 0);
    w.advance(1000);
    social.visit(tono.id, 'sari');
    rows = w.game.state(sari.id).visitors;
    assert.deepEqual(rows.map((r) => r.from), ['tono', 'budi'], 'newest activity first, one row per visitor');
    assert.deepEqual(rows[1].stickers.map((s) => s.text), ['Nice garden!', 'Keep it up!']);
    assert.equal(rows[1].watered, 'mango');
    // The next day: a new row for the same visitor; never more than one per day.
    w.advance(DAY);
    social.visit(budi.id, 'sari');
    social.visit(budi.id, 'sari');
    rows = w.game.state(sari.id).visitors;
    assert.deepEqual(rows.map((r) => [r.from, r.today]), [['budi', true], ['tono', false], ['budi', false]]);
    assertPublic(social.visit(budi.id, 'sari').garden);
  });

  it('the owner waves back once per visitor per day; the visitor gets it without visiting', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const sari = await garden(w, 'sari');
    const budi = await garden(w, 'budi');
    const tono = await garden(w, 'tono');
    social.visit(budi.id, 'sari');
    social.visit(tono.id, 'sari');
    const row = w.game.state(sari.id).visitors.find((r) => r.from === 'budi')!;
    assert.throws(() => social.waveBack(sari.id, row.id, 'free text'), (e: any) => e.details.code === 'unknown_sticker');
    assert.throws(() => social.waveBack(tono.id, row.id, 'see_you'), (e: any) => e.status === 404, 'only the owner of the row');
    assert.deepEqual(social.waveBack(sari.id, row.id, 'see_you'), { visitor: 'budi', sticker: 'see_you', text: 'See you tomorrow!' });
    assert.throws(() => social.waveBack(sari.id, row.id, 'nice_garden'), (e: any) => e.status === 409 && e.details.code === 'waved_today');
    const after = w.game.state(sari.id).visitors.find((r) => r.from === 'budi')!;
    assert.deepEqual([after.wave?.text, after.canWave], ['See you tomorrow!', false]);
    const waves = w.game.state(budi.id).waves;
    assert.deepEqual(waves.map((x) => [x.from, x.text]), [['sari', 'See you tomorrow!']]);
    assert.equal(w.game.state(tono.id).waves.length, 0);
    // Next day: yesterday's row stays "Waved"; a new visit can be waved again (once).
    w.advance(DAY);
    social.visit(budi.id, 'sari');
    const [today, old] = w.game.state(sari.id).visitors.filter((r) => r.from === 'budi');
    assert.deepEqual([today.canWave, old.canWave], [true, false]);
    social.waveBack(sari.id, today.id, 'gold_vibes');
    assert.equal(w.game.state(budi.id).waves.length, 2);
  });

  it('POST /api/visitors/:id/wave returns the owner state', async () => {
    const w = makeWorld();
    const tok = async (u: string) => ((await (await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u }) })).json()) as any).token as string;
    const call = async (t: string, method: string, path: string, body?: unknown) => {
      const res = await w.app.request(path, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any };
    };
    const a = await tok('owner');
    const b = await tok('guest');
    await call(a, 'POST', '/api/player', { name: 'sari' });
    await call(b, 'POST', '/api/player', { name: 'budi' });
    await w.worker.drain();
    assert.equal((await call(b, 'GET', '/api/farmers/sari')).status, 200);
    const me = (await call(a, 'GET', '/api/me')).json;
    const r = await call(a, 'POST', `/api/visitors/${me.visitors[0].id}/wave`, { sticker: 'thanks_water' });
    assert.equal(r.status, 200);
    assert.equal(r.json.state.visitors[0].wave.id, 'thanks_water');
    assert.equal((await call(a, 'POST', `/api/visitors/${me.visitors[0].id}/wave`, { sticker: 'thanks_water' })).status, 409);
    assert.equal((await call(b, 'GET', '/api/me')).json.waves[0].from, 'sari');
  });
});

describe('farmer search', () => {
  it('finds ready gardens by name prefix (any case), also inactive or treeless ones; never judge gardens or yourself', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const me = await garden(w, 'sariwangi');
    await garden(w, 'sari');
    await garden(w, 'sarah', { plant: false });
    await garden(w, 'budi');
    await garden(w, 'sarijudge', { judge: true });
    w.advance(30 * DAY); // nobody active lately: the normal list would be empty
    const r = social.farmers(me.id, '  SAR ');
    assert.equal(r.query, 'sar');
    assert.deepEqual(r.farmers.map((f) => f.name).sort(), ['sarah', 'sari']);
    assert.equal(social.farmers(me.id, 'sari').farmers[0].name, 'sari', 'exact name first');
    assert.deepEqual(social.farmers(me.id, '%').farmers, [], 'no wildcards');
    assert.deepEqual(social.farmers(me.id, 'zzz').farmers, []);
    assertPublic(r.farmers);
    assert.ok(Array.isArray(social.farmers(me.id, '').farmers), 'empty query = the normal list');
  });
});

describe('database upgrade', () => {
  it('an old stickers table (one a day, UNIQUE) is rebuilt and old stickers / helps become visit rows', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { openDb } = await import('../src/db.ts');
    const path = join(mkdtempSync(join(tmpdir(), 'nv-')), 'old.sqlite');
    const first = openDb(path);
    first.exec('DROP TABLE visits; DROP TABLE stickers');
    first.exec(`CREATE TABLE stickers (id INTEGER PRIMARY KEY, from_id INTEGER NOT NULL REFERENCES players(id), to_id INTEGER NOT NULL REFERENCES players(id),
      sticker TEXT NOT NULL, sticker_day INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE (from_id, to_id, sticker_day))`);
    first.exec("INSERT INTO users (id, provider, subject, created_at) VALUES (1, 'dev', 'a', 0), (2, 'dev', 'b', 0)");
    first.exec("INSERT INTO players (id, user_id, name, account_id, public_key, secret_key_enc, account_status, created_at) VALUES (1, 1, 'sari', 'sari.t', '', '', 'ready', 0), (2, 2, 'budi', 'budi.t', '', '', 'ready', 0)");
    first.exec("INSERT INTO stickers (from_id, to_id, sticker, sticker_day, created_at) VALUES (2, 1, 'nice_garden', 7, 1000)");
    first.close();
    const db = openDb(path);
    assert.equal((db.prepare('PRAGMA index_list(stickers)').all() as { origin: string }[]).filter((i) => i.origin === 'u').length, 0);
    db.exec("INSERT INTO stickers (from_id, to_id, sticker, sticker_day, created_at) VALUES (2, 1, 'see_you', 7, 7000)");
    assert.deepEqual(db.prepare('SELECT visitor_id, owner_id, visit_day FROM visits').all().map((r) => ({ ...r })), [{ visitor_id: 2, owner_id: 1, visit_day: 7 }]);
    db.close();
  });
});

describe('privacy of search, Visitors and wave back', () => {
  it('search rows, Visitors rows, waves and the wave result hold only public data (no email, wallet, budget, key)', async () => {
    const w = makeWorld();
    const social = new Social(w.db, w.game, w.now);
    const sari = await garden(w, 'sari');
    const budi = await garden(w, 'budi');
    // Private data that must never show up: a linked wallet, a Google email, a TaniBot budget.
    w.db.prepare("UPDATE players SET wallet_account_id = 'budiwallet.testnet', google_sub = 'g-123' WHERE id = ?").run(budi.id);
    w.db.prepare("UPDATE users SET subject = 'budi@example.com' WHERE id = ?").run(budi.user_id);
    social.visit(budi.id, 'sari');
    social.sticker(budi.id, 'sari', 'nice_garden');
    const rows = w.game.state(sari.id).visitors;
    const wave = social.waveBack(sari.id, rows[0].id, 'see_you');
    const waves = w.game.state(budi.id).waves;
    const search = social.farmers(sari.id, 'bu');
    for (const v of [rows, waves, wave, search.farmers]) {
      assertPublic(v);
      assert.doesNotMatch(JSON.stringify(v), /budiwallet|g-123|example\.com|nearvest\.testnet/, 'no wallet, Google id, email or account id');
    }
    assert.deepEqual(Object.keys(rows[0]).sort(), ['at', 'avatar', 'canWave', 'from', 'id', 'stickers', 'today', 'watered', 'wave']);
    assert.deepEqual(Object.keys(waves[0]).sort(), ['at', 'avatar', 'from', 'id', 'sticker', 'text']);
    assert.deepEqual(Object.keys(search.farmers[0]).sort(), ['avatar', 'helpedYou', 'judge', 'name', 'thirsty', 'title', 'trees']);
  });
});
