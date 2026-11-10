// Red dot on the Market tab (Ardian, 2026-11-10): only for NEW fruit (harvested after the owner
// last opened the Market). "Seen" is stored on the server so every device agrees.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { makeWorld, MINUTE } from './helpers.ts';

async function ripeMango(w: ReturnType<typeof makeWorld>, name: string) {
  const p = w.newPlayer(name);
  w.game.checkin(p.id);
  const seed = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;
  w.game.plant(p.id, 0, seed.id);
  await w.worker.drain();
  w.game.water(p.id, 0);
  w.advance(3 * MINUTE + 1000);
  return p;
}

describe('red dot: new fruit for the Market', () => {
  it('a harvest is news until the owner opens the Market; a sale is not news', async () => {
    const w = makeWorld();
    const p = await ripeMango(w, 'sari');
    const m = () => w.game.state(p.id).market;
    assert.deepEqual(m(), { fruitAt: 0, seenAt: 0 }, 'no fruit yet: no dot');
    w.game.harvest(p.id, 0);
    const m1 = m();
    assert.ok(m1.fruitAt > m1.seenAt, 'new fruit: dot');
    w.game.marketSeen(p.id, m1.fruitAt);
    assert.equal(m().seenAt, m1.fruitAt, 'Market opened: no dot');
    w.advance(1000);
    w.game.sell(p.id, 'mango', 'common', 1);
    assert.equal(m().fruitAt, m1.fruitAt, 'selling does not make a dot');
    // Seen never goes back, never past now, and ignores junk.
    w.game.marketSeen(p.id, 5);
    w.game.marketSeen(p.id, 'x');
    assert.equal(m().seenAt, m1.fruitAt);
    w.game.marketSeen(p.id, w.now() + 10 * MINUTE);
    assert.equal(m().seenAt, w.now());
  });

  it('POST /api/market/seen stores it for this garden only', async () => {
    const w = makeWorld();
    const tok = async (u: string) => ((await (await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: u }) })).json()) as any).token as string;
    const call = async (t: string, path: string, body: unknown) => {
      const res = await w.app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` }, body: JSON.stringify(body) });
      return { status: res.status, json: (await res.json()) as any };
    };
    const a = await tok('owner');
    await call(a, '/api/player', { name: 'sari' });
    const id = (w.db.prepare("SELECT id FROM players WHERE name = 'sari'").get() as { id: number }).id;
    w.db.prepare('UPDATE players SET fruit_at = ? WHERE id = ?').run(w.now(), id);
    const r = await call(a, '/api/market/seen', { upTo: w.now() });
    assert.equal(r.status, 200);
    assert.equal(r.json.state.market.seenAt, w.now());
    assert.equal(r.json.state.market.fruitAt, r.json.state.market.seenAt);
  });

  it('database upgrade: gardens that already hold fruit get one dot', async () => {
    const { mkdtempSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { openDb } = await import('../src/db.ts');
    const path = join(mkdtempSync(join(tmpdir(), 'nv-')), 'old.sqlite');
    const first = openDb(path);
    first.exec('ALTER TABLE players DROP COLUMN fruit_at; ALTER TABLE players DROP COLUMN market_seen_at');
    first.exec("INSERT INTO users (id, provider, subject, created_at) VALUES (1, 'dev', 'a', 0), (2, 'dev', 'b', 0)");
    first.exec("INSERT INTO players (id, user_id, name, account_id, public_key, secret_key_enc, account_status, created_at) VALUES (1, 1, 'sari', 'sari.t', '', '', 'ready', 0), (2, 2, 'budi', 'budi.t', '', '', 'ready', 0)");
    first.exec("INSERT INTO fruits (player_id, species, quality, qty) VALUES (1, 'mango', 'common', 3), (2, 'mango', 'common', 0)");
    first.close();
    const db = openDb(path);
    assert.deepEqual(
      db.prepare('SELECT id, fruit_at, market_seen_at FROM players ORDER BY id').all().map((r) => ({ ...r })),
      [
        { id: 1, fruit_at: 1, market_seen_at: 0 },
        { id: 2, fruit_at: 0, market_seen_at: 0 },
      ],
    );
    db.close();
  });
});
