// Fishing (fishing.ts, docs/PLAN-fishing.md): the catch table, the catch decided at the cast and never
// sent before the reel, 3 casts per normal village day (also demo), reel rules (too early, twice,
// someone else's), lines pulled in by the server, mint_reward with the Season rule, the Mango seed
// with a full Storage (Mr. Darto buys it), paid-catch limits per browser / IP, judge and wallet
// gardens, and the FISHING switch over HTTP.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Fishing } from '../src/fishing.ts';
import type { PlayerRow } from '../src/game.ts';
import {
  FISHING_AUTO_REEL_MS,
  FISHING_BOTTLE_LINES,
  FISHING_CASTS_PER_DAY,
  FISHING_CATCHES,
  FISHING_PAID_PER_DEVICE_PER_DAY,
  FISHING_PAID_PER_IP_PER_DAY,
  SEED_STORAGE_SLOTS,
  rollCatch,
  rollJudgeFirstCatch,
  type FishingCatchId,
} from '../src/rules.ts';
import { DAY, MINUTE, makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

/** The middle of a catch's slice of the table (a roll in [0, 1)). */
function rollFor(id: FishingCatchId): number {
  let start = 0;
  for (const c of FISHING_CATCHES) {
    if (c.id === id) return (start + c.chance / 2) / 1000;
    start += c.chance;
  }
  throw new Error(id);
}

/** Random numbers from a queue (then 0: the earliest bite, the first chest amount / bottle line). */
function queue() {
  const q: number[] = [];
  return { q, random: () => q.shift() ?? 0 };
}

let users = 0;
function user(w: World, provider: string, subject: string) {
  return Number(w.db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run(provider, subject, w.now()).lastInsertRowid);
}
async function garden(w: World, name: string, ip = `10.3.0.${++users}`): Promise<PlayerRow> {
  const p = w.newPlayer(name, ip);
  await w.worker.drain();
  return w.game.getPlayer(p.id);
}

function setup(opts: { demo?: boolean } = {}) {
  const w = makeWorld({ demo: opts.demo });
  w.game.fishing = true;
  const r = queue();
  const fishing = new Fishing(w.db, w.game, w.now, r.random);
  /** Casts with the given catch and reels after the bite. */
  const catchOne = (p: PlayerRow, id: FishingCatchId, o: { device?: string | null; ip?: string | null; extra?: number[] } = {}) => {
    r.q.push(rollFor(id), ...(o.extra ?? []));
    const c = fishing.cast(p.id, o.ip === undefined ? null : o.ip, o.device ?? null);
    w.advance(c.cast.biteInMs);
    return fishing.reel(p.id, c.cast.id);
  };
  return { w, r, fishing, catchOne };
}

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

describe('fishing', () => {
  it('the catch table: chances sum to 1000 and the rolls follow them', () => {
    assert.equal(
      FISHING_CATCHES.reduce((s, c) => s + c.chance, 0),
      1000,
    );
    // Every per-mille slot maps to exactly its catch's chance.
    const exact = new Map<string, number>();
    for (let i = 0; i < 1000; i++) exact.set(rollCatch((i + 0.5) / 1000), (exact.get(rollCatch((i + 0.5) / 1000)) ?? 0) + 1);
    for (const c of FISHING_CATCHES) assert.equal(exact.get(c.id), c.chance, c.id);
    // 100,000 random rolls stay within ±0.5% of every row.
    const rnd = seeded(7);
    const n = 100_000;
    const seen = new Map<string, number>();
    for (let i = 0; i < n; i++) {
      const id = rollCatch(rnd());
      seen.set(id, (seen.get(id) ?? 0) + 1);
    }
    for (const c of FISHING_CATCHES) assert.ok(Math.abs((seen.get(c.id) ?? 0) / n - c.chance / 1000) < 0.005, c.id);
    // Groups: fish 58%, junk 30%, items 12%.
    const group = (k: string) => FISHING_CATCHES.filter((c) => c.kind === k).reduce((s, c) => s + c.chance, 0);
    assert.deepEqual([group('fish'), group('junk'), group('item')], [580, 300, 120]);
  });

  it('the cast answer and the state never hold the catch; the reel does', async () => {
    const { w, r, fishing } = setup();
    const p = await garden(w, 'sari');
    r.q.push(rollFor('gourami'));
    const c = fishing.cast(p.id, null, null);
    assert.ok(c.cast.biteInMs >= 2000 && c.cast.biteInMs <= 6000);
    const leaks = [JSON.stringify(c), JSON.stringify(w.game.state(p.id).fishing), JSON.stringify(fishing.view(p.id).today), JSON.stringify(fishing.view(p.id).open)];
    for (const s of leaks) assert.ok(!/gourami/i.test(s), s);
    assert.deepEqual(w.game.state(p.id).fishing?.open?.id, c.cast.id);
    w.advance(c.cast.biteInMs);
    const { result } = fishing.reel(p.id, c.cast.id);
    assert.equal(result.catch, 'gourami');
    assert.equal(result.name, 'Gourami');
    assert.equal(result.panen, 10);
    assert.equal(w.game.state(p.id).fishing?.open, null);
    assert.equal(w.game.state(p.id).fishing?.last?.id, c.cast.id);
  });

  it(`${FISHING_CASTS_PER_DAY} casts per village day; the 4th is refused; casts come back at 07:00 WIB`, async () => {
    const { w, fishing, catchOne } = setup();
    const p = await garden(w, 'sari');
    for (let i = 0; i < FISHING_CASTS_PER_DAY; i++) catchOne(p, 'stone');
    assert.equal(w.game.state(p.id).fishing?.left, 0);
    assert.throws(() => fishing.cast(p.id, null, null), (e: { status: number; details: { code: string } }) => e.status === 429 && e.details.code === 'fishing_limit');
    w.advance(DAY);
    assert.equal(w.game.state(p.id).fishing?.left, FISHING_CASTS_PER_DAY);
    catchOne(p, 'stone');
  });

  it('demo gardens: still 3 casts per NORMAL day (a 1-minute demo day does not reset them); XP x5', async () => {
    const { w, fishing, catchOne } = setup({ demo: true });
    const p = await garden(w, 'demo');
    const xp0 = w.game.getPlayer(p.id).xp;
    for (let i = 0; i < FISHING_CASTS_PER_DAY; i++) catchOne(p, 'old_boot');
    assert.equal(w.game.getPlayer(p.id).xp, xp0 + 3 * 5, 'junk 1 XP x5');
    w.advance(5 * MINUTE); // five demo days
    assert.throws(() => fishing.cast(p.id, null, null), /casts today/);
  });

  it('reel: too early = 409; twice = paid once; someone else’s cast = 404', async () => {
    const { w, r, fishing } = setup();
    const p = await garden(w, 'sari');
    const q = await garden(w, 'budi');
    r.q.push(rollFor('catfish'), 0.9); // bite late (about 5.6 s)
    const c = fishing.cast(p.id, null, null);
    assert.throws(() => fishing.reel(p.id, c.cast.id), (e: { status: number; details: { code: string } }) => e.status === 409 && e.details.code === 'too_early');
    assert.throws(() => fishing.reel(q.id, c.cast.id), (e: { status: number }) => e.status === 404);
    w.advance(c.cast.biteInMs - 200); // within the 300 ms grace
    const a = fishing.reel(p.id, c.cast.id).result;
    const b = fishing.reel(p.id, c.cast.id).result;
    assert.deepEqual(a, b);
    const jobs = w.db.prepare("SELECT COUNT(*) AS n FROM chain_jobs WHERE player_id = ? AND payload LIKE '%Fishing%'").get(p.id) as { n: number };
    assert.equal(jobs.n, 1);
  });

  it('a line nobody reels is pulled in by the server (sweep or the next cast) and paid once', async () => {
    const { w, r, fishing } = setup();
    const p = await garden(w, 'sari');
    r.q.push(rollFor('carp'));
    const c = fishing.cast(p.id, null, null);
    w.advance(c.cast.biteInMs + 10_000);
    assert.equal(fishing.sweep(), 0, 'not yet: a minute after the bite');
    w.advance(FISHING_AUTO_REEL_MS);
    assert.equal(fishing.sweep(), 1);
    const last = w.game.state(p.id).fishing!.last!;
    assert.equal(last.catch, 'carp');
    assert.equal(last.auto, true);
    assert.equal(fishing.reel(p.id, c.cast.id).result.auto, true);
    // A new cast pulls in a line still in the water first (its catch was fixed at its cast).
    r.q.push(rollFor('tilapia'));
    const c2 = fishing.cast(p.id, null, null);
    r.q.push(rollFor('stone'));
    fishing.cast(p.id, null, null);
    const done = fishing.reel(p.id, c2.cast.id).result;
    assert.equal(done.catch, 'tilapia');
    assert.equal(done.auto, true);
    const jobs = w.db.prepare("SELECT COUNT(*) AS n FROM chain_jobs WHERE player_id = ? AND payload LIKE '%Fishing%'").get(p.id) as { n: number };
    assert.equal(jobs.n, 2, 'carp + tilapia, once each');
  });

  it('PANEN comes from mint_reward with the base amount; the Season rule halves it; Golden Arowana is a moment', async () => {
    const { w, catchOne } = setup();
    const p = await garden(w, 'sari');
    w.game.seasonDivisor = 2;
    const t = catchOne(p, 'tilapia').result;
    assert.equal(t.panen, 1.5);
    assert.equal(t.basePanen, 3);
    const job = w.db.prepare("SELECT kind, payload FROM chain_jobs WHERE id = ?").get(t.jobId) as { kind: string; payload: string };
    assert.equal(job.kind, 'mint_reward');
    assert.match(job.payload, /"memo":"Fishing: Tilapia"/);
    assert.match(job.payload, /"baseMicro":3000000/);
    const a = catchOne(p, 'golden_arowana').result;
    assert.equal(a.basePanen, 30);
    assert.equal(a.panen, 15);
    assert.equal(a.moment, 'golden_arowana');
    await w.worker.drain();
    assert.ok(w.game.state(p.id).activity.some((x) => x.note === 'fishing' && x.status === 'done'));
  });

  it('items: Fertilizer, a message in a bottle (5 XP + a line), a small chest of 10-15 PANEN', async () => {
    const { w, catchOne } = setup();
    const p = await garden(w, 'sari');
    const f = catchOne(p, 'fertilizer').result;
    assert.equal(f.item, 'fertilizer');
    assert.equal(w.game.state(p.id).items.find((i) => i.item === 'fertilizer')?.qty, 1);
    const xp0 = w.game.getPlayer(p.id).xp;
    const b = catchOne(p, 'bottle', { extra: [0.99] }).result;
    assert.equal(b.xp, 5);
    assert.equal(b.line, FISHING_BOTTLE_LINES.at(-1));
    assert.equal(w.game.getPlayer(p.id).xp, xp0 + 5);
    const c1 = catchOne(p, 'chest', { extra: [0] }).result;
    assert.equal(c1.panen, 10);
    w.advance(DAY);
    const c2 = catchOne(p, 'chest', { extra: [0.999] }).result;
    assert.equal(c2.panen, 15);
  });

  it('Mango seed: into Storage when there is room; Storage full = Mr. Darto buys it (2 PANEN base, mint_reward)', async () => {
    const { w, catchOne } = setup();
    const p = await garden(w, 'sari');
    const before = w.game.state(p.id).seeds.length;
    const s = catchOne(p, 'mango_seed').result;
    assert.equal(s.item, 'seed');
    assert.equal(s.panen, 0);
    const seeds = w.game.state(p.id).seeds;
    assert.equal(seeds.length, before + 1);
    assert.equal(seeds.at(-1)?.source, 'fishing');
    assert.equal(seeds.at(-1)?.quality, null, 'unknown quality, like a check-in seed');
    for (let i = seeds.length; i < SEED_STORAGE_SLOTS; i++)
      w.db.prepare("INSERT INTO seeds (player_id, species, quality, source, created_at) VALUES (?, 'mango', NULL, 'test', ?)").run(p.id, w.now());
    const sold = catchOne(p, 'mango_seed').result;
    assert.equal(sold.item, 'seed_sold');
    assert.equal(sold.basePanen, 2);
    assert.equal(sold.panen, 2);
    assert.equal(w.game.state(p.id).seeds.length, SEED_STORAGE_SLOTS, 'the storage limit holds');
    const job = w.db.prepare('SELECT kind, payload FROM chain_jobs WHERE id = ?').get(sold.jobId) as { kind: string; payload: string };
    assert.equal(job.kind, 'mint_reward');
    assert.match(job.payload, /Mr\. Darto/);
  });

  it(`paid catches: at most ${FISHING_PAID_PER_DEVICE_PER_DAY} per browser and ${FISHING_PAID_PER_IP_PER_DAY} per IP a day; more = released (1 XP)`, async () => {
    const { w, catchOne } = setup();
    // One browser, two gardens: the 4th paid catch from that browser is released.
    const a = await garden(w, 'sari');
    const b = await garden(w, 'budi');
    const dev = 'device-aaaaaaaaaaaaaaaa';
    const res = [catchOne(a, 'tilapia', { device: dev }), catchOne(a, 'catfish', { device: dev }), catchOne(a, 'fertilizer', { device: dev })].map((x) => x.result);
    assert.ok(res.every((x) => !x.released));
    const junk = catchOne(b, 'stone', { device: dev }).result;
    assert.equal(junk.released, false, 'junk is never released');
    const over = catchOne(b, 'gourami', { device: dev }).result;
    assert.equal(over.released, true);
    assert.equal(over.panen, 0);
    assert.equal(over.xp, 1);
    assert.equal(over.jobId, null);
    // One IP, many browsers: 10 paid catches, then released.
    const ipResults: boolean[] = [];
    for (let i = 0; i < 4; i++) {
      const g = await garden(w, `ip${i}`);
      for (let k = 0; k < 3; k++) ipResults.push(catchOne(g, 'tilapia', { device: `device-${i}-bbbbbbbbbbbbbbbb`, ip: '10.8.8.8' }).result.released);
    }
    assert.deepEqual(ipResults, [...Array(FISHING_PAID_PER_IP_PER_DAY).fill(false), true, true]);
    // The next day the limits start again.
    w.advance(DAY);
    assert.equal(catchOne(b, 'tilapia', { device: dev }).result.released, false);
  });

  it('judge gardens: the first cast is always Tilapia or Catfish (never Golden Arowana); then the normal table', async () => {
    for (let i = 0; i < 1000; i++) assert.ok(['tilapia', 'catfish'].includes(rollJudgeFirstCatch(i / 1000)));
    const { w, r, fishing, catchOne } = setup();
    const j = w.game.createPlayer(user(w, 'judge', 'judge-device-1'), 'judge-ab12', '10.0.0.9', true);
    await w.worker.drain();
    r.q.push(0.999); // the very end of the normal table (a chest); judges still get a fish
    const c = fishing.cast(j.id, null, null);
    w.advance(c.cast.biteInMs);
    assert.equal(fishing.reel(j.id, c.cast.id).result.catch, 'catfish');
    assert.equal(catchOne(w.game.getPlayer(j.id), 'old_boot').result.catch, 'old_boot');
    // A normal garden's first cast follows the table.
    const p = await garden(w, 'sari');
    assert.equal(catchOne(p, 'golden_arowana').result.catch, 'golden_arowana');
  });

  it('wallet gardens: the reward is minted to the player’s own account (no wallet popup, no burn)', async () => {
    const { w, catchOne } = setup();
    const wal = w.game.createPlayer(user(w, 'near', 'sariwallet.testnet'), 'sariw', '10.2.0.1');
    assert.equal(wal.custody, 'wallet');
    const t = catchOne(w.game.getPlayer(wal.id), 'tilapia').result;
    const job = w.db.prepare('SELECT kind, payload FROM chain_jobs WHERE id = ?').get(t.jobId) as { kind: string; payload: string };
    assert.equal(job.kind, 'mint_reward');
    assert.equal(JSON.parse(job.payload).accountId, wal.account_id);
  });

  it('HTTP: FISHING off = 404 fishing_off, no state.fishing, config false; on = cast and reel work', async () => {
    const w = makeWorld({ devLogin: true });
    const r = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tani' }) });
    const token = ((await r.json()) as { token: string }).token;
    const auth = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
    await w.app.request('/api/player', { method: 'POST', headers: auth, body: JSON.stringify({ name: 'tani' }) });
    await w.worker.drain();
    const call = async (method: string, path: string, body?: unknown) => {
      const res = await w.app.request(path, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as Record<string, unknown> };
    };
    assert.equal(((await call('GET', '/api/config')).json as { fishing: boolean }).fishing, false);
    const off = await call('POST', '/api/fishing/cast', { deviceId: 'device-cccccccccccccccc' });
    assert.equal(off.status, 404);
    assert.equal(off.json.code, 'fishing_off');
    assert.equal((await call('GET', '/api/fishing')).status, 404);
    assert.equal((await call('POST', '/api/fishing/1/reel')).status, 404);
    const me = (await call('GET', '/api/me')).json as { state?: Record<string, unknown> } & Record<string, unknown>;
    assert.ok(!('fishing' in (me.state ?? me)), 'no state.fishing while off');

    w.game.fishing = true;
    assert.equal(((await call('GET', '/api/config')).json as { fishing: boolean }).fishing, true);
    const cast = await call('POST', '/api/fishing/cast', { deviceId: 'device-cccccccccccccccc' });
    assert.equal(cast.status, 200);
    const id = (cast.json.cast as { id: number; biteInMs: number }).id;
    assert.deepEqual(Object.keys(cast.json).sort(), ['cast', 'left']);
    w.advance(6_000);
    const reel = await call('POST', `/api/fishing/${id}/reel`);
    assert.equal(reel.status, 200);
    assert.ok((reel.json.result as { name: string }).name);
    assert.ok((reel.json.state as { fishing: unknown }).fishing);
    const view = await call('GET', '/api/fishing');
    assert.equal((view.json.today as unknown[]).length, 1);
    assert.equal((view.json as { left: number }).left, FISHING_CASTS_PER_DAY - 1);
  });
});
