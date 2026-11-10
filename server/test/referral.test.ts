// Referral (referral.ts, docs/PLAN-social.md section 3): pending on a new garden from an invite
// link, paid only after the friend's first harvest (inviter 20 PANEN with mint_reward = Season
// rule, friend 5 PANEN with exact mint), never for judge gardens or yourself, one inviter per
// garden, at most 3 per real day per device and per IP.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PlayerRow } from '../src/game.ts';
import { REF_PAID_PER_DAY_PER_REFERRER, REF_REWARD_FRIEND, REF_REWARD_REFERRER } from '../src/rules.ts';
import { DAY, MINUTE, makeWorld } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;

const DEV_A = 'deviceAAAAAAAAAAAAAAAA';
const DEV_B = 'deviceBBBBBBBBBBBBBBBB';

let users = 0;
function user(w: World, provider = 'dev', subject?: string): number {
  return Number(
    w.db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run(provider, subject ?? `u-${++users}`, w.now()).lastInsertRowid,
  );
}

/** A new garden, optionally from an invite link, on a device and an IP. */
function make(w: World, name: string, o: { ref?: string; device?: string; ip?: string; provider?: string } = {}): PlayerRow {
  return w.game.createPlayer(user(w, o.provider), name, o.ip ?? `10.1.0.${++users}`, false, { ref: o.ref, deviceId: o.device });
}

const status = (w: World, friendId: number) =>
  ((r) => (r ? { status: r.status, reason: r.reason } : null))(
    w.db.prepare('SELECT status, reason FROM referrals WHERE friend_id = ?').get(friendId) as { status: string; reason: string | null } | undefined,
  );
const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

/** Plants the friend's first tree, waters it and waits until it is ripe. */
async function growFirst(w: World, p: PlayerRow) {
  await w.worker.drain();
  w.game.checkin(p.id);
  const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(p.id) as { id: number }).id;
  w.game.plant(p.id, 0, seed);
  w.game.water(p.id, 0);
  w.advance(4 * MINUTE);
}

describe('referral: invite link -> pending', () => {
  it('a new garden from ?ref=<name> waits for its first harvest; both see it (inviter: pending, friend: invited by)', () => {
    const w = makeWorld();
    const sari = make(w, 'sari', { device: DEV_A });
    const budi = make(w, 'budi', { ref: 'SARI', device: DEV_B });
    assert.deepEqual(status(w, budi.id), { status: 'pending', reason: null });
    const mine = w.game.state(sari.id).referral;
    assert.equal(mine.canInvite, true);
    assert.deepEqual(mine.rewards, { referrer: REF_REWARD_REFERRER, referrerNow: REF_REWARD_REFERRER, friend: REF_REWARD_FRIEND });
    assert.deepEqual(mine.invited.map((r) => [r.name, r.status]), [['budi', 'pending']]);
    assert.equal(w.game.state(budi.id).referral.invitedBy?.name, 'sari');
    assert.equal(w.game.state(budi.id).referral.invitedBy?.status, 'pending');
  });

  it('no referral for an unknown name, a garbage ref, or no ref at all', () => {
    const w = makeWorld();
    make(w, 'sari');
    for (const [name, ref] of [['a1', 'nobody'], ['a2', '../x'], ['a3', undefined]] as const) {
      const p = make(w, name, { ref });
      assert.equal(status(w, p.id), null);
    }
  });

  it('judge gardens never count: not as inviter, not as friend', async () => {
    const w = makeWorld();
    const judge = w.judge.enter('judgeDeviceXXXXXXXXXXXX', '10.9.9.9');
    const jName = w.game.getPlayer(judge.playerId).name;
    const p = make(w, 'budi', { ref: jName });
    assert.equal(status(w, p.id), null, 'a judge garden cannot invite');
    assert.equal(w.game.state(judge.playerId).referral.canInvite, false);
    // A judge garden made with a ref (the judge route has none, but even if it had): nothing.
    make(w, 'sari');
    const jp = w.game.createPlayer(user(w, 'judge', 'judgeDeviceYYYYYYYYYYYY'), 'judge-zzzz', '10.9.9.8', true, { ref: 'sari' });
    assert.equal(status(w, jp.id), null);
  });

  it('you cannot invite yourself: a browser the inviter used, or the same identity', () => {
    const w = makeWorld();
    const sari = make(w, 'sari', { device: DEV_A });
    // Same browser as the inviter (device seen at creation).
    const alt = make(w, 'alt', { ref: 'sari', device: DEV_A });
    assert.deepEqual(status(w, alt.id), { status: 'refused', reason: 'self' });
    // A browser seen later through /api/me counts too.
    w.game.touch(sari.id, DEV_B);
    const alt2 = make(w, 'alt2', { ref: 'sari', device: DEV_B });
    assert.equal(status(w, alt2.id)?.status, 'refused');
    // Refused referrals are not shown and never paid.
    assert.deepEqual(w.game.state(sari.id).referral.invited, []);
    assert.equal(w.game.state(alt.id).referral.invitedBy, null);
    // A Google account linked to the inviter's wallet garden.
    const wal = w.game.createPlayer(user(w, 'near', 'sariwallet.testnet'), 'sariw', '10.2.0.1');
    w.db.prepare('UPDATE players SET google_sub = ? WHERE id = ?').run('google-sari', wal.id);
    const g = w.game.createPlayer(user(w, 'google', 'google-sari-2'), 'gg', '10.2.0.2', false, { ref: 'sariw' });
    assert.equal(status(w, g.id)?.status, 'pending', 'a different Google account is fine');
    const same = w.db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run('google', 'google-sari', w.now());
    // (createPlayer refuses a Google account linked elsewhere outright; the referral check is a second line.)
    assert.throws(() => w.game.createPlayer(Number(same.lastInsertRowid), 'gg2', '10.2.0.3', false, { ref: 'sariw' }), /already linked/);
  });

  it('a garden has one inviter only (the referral is made once, at creation)', () => {
    const w = makeWorld();
    make(w, 'sari');
    make(w, 'tono');
    const budi = make(w, 'budi', { ref: 'sari' });
    assert.equal((w.db.prepare('SELECT count(*) AS n FROM referrals WHERE friend_id = ?').get(budi.id) as { n: number }).n, 1);
    assert.throws(() => w.db.prepare("INSERT INTO referrals (referrer_id, friend_id, status, created_at) VALUES (?, ?, 'pending', 0)").run(w.game.getPlayerByName('tono')!.id, budi.id));
  });

  it('at most 3 referrals per real day from one device and from one IP; the next day works again', () => {
    const w = makeWorld();
    make(w, 'sari');
    const st = (n: string, o: { device?: string; ip?: string }) => status(w, make(w, n, { ref: 'sari', ...o }).id)?.status;
    assert.deepEqual(['d1', 'd2', 'd3', 'd4'].map((n) => st(n, { device: DEV_B })), ['pending', 'pending', 'pending', 'refused']);
    assert.deepEqual(['i1', 'i2', 'i3', 'i4'].map((n) => st(n, { ip: '10.3.3.3' })), ['pending', 'pending', 'pending', 'refused']);
    assert.equal(status(w, w.game.getPlayerByName('d4')!.id)?.reason, 'limit');
    w.advance(DAY + 1);
    assert.equal(st('d5', { device: DEV_B }), 'pending');
    assert.equal(st('i5', { ip: '10.3.3.3' }), 'pending');
  });
});

describe('referral: paid after the first harvest', () => {
  it('nothing before the harvest; the first harvest pays inviter 20 (mint_reward) and friend 5 (exact mint), once', async () => {
    const w = makeWorld();
    const sari = make(w, 'sari');
    const budi = make(w, 'budi', { ref: 'sari' });
    await growFirst(w, budi);
    await w.worker.drain();
    const callsBefore = w.chain.calls.length;
    const sariBefore = w.game.getPlayer(sari.id).balance_micro;
    assert.equal(w.game.state(sari.id).referral.invited[0].status, 'pending', 'still pending before the harvest');

    const h = w.game.harvest(budi.id, 0);
    assert.equal(h.kind, 'fruit');
    assert.deepEqual(h.kind === 'fruit' && h.referral, { referrer: 'sari', friendPanen: REF_REWARD_FRIEND, referrerPanen: REF_REWARD_REFERRER });
    assert.equal(w.game.getPlayer(sari.id).balance_micro - sariBefore, REF_REWARD_REFERRER * 1_000_000);
    await w.worker.drain();
    const calls = w.chain.calls.slice(callsBefore);
    const reward = calls.find((c) => c.method === 'mint_reward');
    const mint = calls.find((c) => c.method === 'mint');
    assert.ok(reward && mint, `mint_reward + mint, got ${calls.map((c) => c.method).join(', ')}`);
    assert.match(json(reward.args), /sari\.nearvest\.testnet/);
    assert.match(json(mint.args), /budi\.nearvest\.testnet/);

    const s = w.game.state(sari.id);
    assert.equal(s.referral.invited[0].status, 'paid');
    assert.ok(s.activity.some((a) => a.kind === 'mint_reward' && a.note === 'referral'), 'the log says referral, not harvest sale');
    assert.equal(w.game.state(budi.id).referral.invitedBy?.status, 'paid');

    // The next harvest pays nothing more.
    w.advance(DAY);
    w.game.water(budi.id, 0);
    w.advance(DAY);
    const h2 = w.game.harvest(budi.id, 0);
    assert.equal(h2.kind === 'fruit' && h2.referral, null);
  });

  it('a TaniBot harvest counts as the first harvest too (it uses the same harvest)', async () => {
    const w = makeWorld();
    make(w, 'sari');
    const budi = make(w, 'budi', { ref: 'sari' });
    await growFirst(w, budi);
    // Any caller of game.harvest pays; TaniBot calls game.harvest (tanibot.ts).
    w.game.harvest(budi.id, 0);
    assert.equal(status(w, budi.id)?.status, 'paid');
  });

  it('the inviter reward follows the Season rule (Season 3: 20 -> 5 PANEN); the friend bonus does not', async () => {
    const w = makeWorld();
    const sari = make(w, 'sari');
    const budi = make(w, 'budi', { ref: 'sari' });
    await growFirst(w, budi);
    w.game.seasonDivisor = 4;
    assert.equal(w.game.state(sari.id).referral.rewards.referrerNow, 5);
    const before = { s: w.game.getPlayer(sari.id).balance_micro, b: w.game.getPlayer(budi.id).balance_micro };
    const h = w.game.harvest(budi.id, 0);
    assert.equal(h.kind === 'fruit' && h.referral?.referrerPanen, 5);
    assert.equal(w.game.getPlayer(sari.id).balance_micro - before.s, 5_000_000);
    assert.equal(w.game.getPlayer(budi.id).balance_micro - before.b, REF_REWARD_FRIEND * 1_000_000);
  });

  it(`an inviter is paid for at most ${REF_PAID_PER_DAY_PER_REFERRER} referrals a day; more wait for a later harvest`, async () => {
    const w = makeWorld();
    make(w, 'sari');
    const friends = Array.from({ length: REF_PAID_PER_DAY_PER_REFERRER + 1 }, (_, i) => make(w, `f${i}`, { ref: 'sari', ip: `10.7.${i}.1` }));
    await w.worker.drain();
    for (const f of friends) {
      w.game.checkin(f.id);
      const seed = (w.db.prepare("SELECT id FROM seeds WHERE player_id = ? AND species = 'mango' LIMIT 1").get(f.id) as { id: number }).id;
      w.game.plant(f.id, 0, seed);
      w.game.water(f.id, 0);
    }
    w.advance(4 * MINUTE);
    for (const f of friends) w.game.harvest(f.id, 0);
    const last = friends[friends.length - 1];
    assert.equal(status(w, last.id)?.status, 'pending');
    w.advance(DAY + 1);
    w.game.water(last.id, 0);
    w.advance(DAY);
    w.game.harvest(last.id, 0);
    assert.equal(status(w, last.id)?.status, 'paid');
  });
});

describe('referral over HTTP', () => {
  it('POST /api/player takes ref + deviceId; GET /api/me?device= records the browser', async () => {
    const w = makeWorld();
    const call = async (method: string, path: string, token?: string, body?: unknown) => {
      const res = await w.app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as any };
    };
    const a = (await call('POST', '/auth/dev', undefined, { username: 'sari' })).json.token;
    await call('POST', '/api/player', a, { name: 'sari', deviceId: DEV_A });
    await call('GET', `/api/me?device=${DEV_B}`, a);
    const b = (await call('POST', '/auth/dev', undefined, { username: 'budi' })).json.token;
    const created = await call('POST', '/api/player', b, { name: 'budi', ref: 'sari', deviceId: 'deviceCCCCCCCCCCCCCCCC' });
    assert.equal(created.status, 201);
    assert.equal(created.json.referral.invitedBy.name, 'sari');
    const c = (await call('POST', '/auth/dev', undefined, { username: 'sari2' })).json.token;
    const self = await call('POST', '/api/player', c, { name: 'sari2', ref: 'sari', deviceId: DEV_B });
    assert.equal(self.status, 201, 'the garden is made anyway');
    assert.equal(self.json.referral.invitedBy, null, 'but no referral (same browser as the inviter)');
  });
});
