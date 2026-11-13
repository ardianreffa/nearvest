import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { decryptSecret } from '../src/crypto.ts';
import { DAY, makeWorld, MINUTE, UNIT } from './helpers.ts';

describe('new player', () => {
  it('gets a NEAR account, the welcome pack and an encrypted key', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    assert.equal(p.account_id, 'ardian.nearvest.testnet');
    const s = w.game.state(p.id);
    assert.equal(s.player.balance, 50);
    assert.deepEqual(
      s.seeds.map((x: any) => [x.species, x.quality]),
      [['durian', 'rare']],
    );

    await w.worker.drain();
    assert.ok(w.chain.accounts.has('ardian.nearvest.testnet'));
    assert.equal(w.chain.balances.get('ardian.nearvest.testnet'), 50n * UNIT);
    assert.equal(w.game.getPlayer(p.id).account_status, 'ready');

    const row = w.db.prepare('SELECT secret_key_enc FROM players WHERE id = ?').get(p.id) as { secret_key_enc: string };
    assert.ok(!row.secret_key_enc.includes('ed25519:'), 'key must not be stored in plain text');
    assert.match(decryptSecret(row.secret_key_enc, w.masterKey), /^ed25519:/);
  });

  it('names must be unique', () => {
    const w = makeWorld();
    w.newPlayer('ardian');
    assert.throws(() => w.newPlayer('ardian'), /taken/);
  });

  it('welcome packs are limited to 3 per IP per day', () => {
    const w = makeWorld();
    for (const n of ['aa', 'bb', 'cc']) assert.equal(w.game.state(w.newPlayer(n, '1.2.3.4').id).player.balance, 50);
    const fourth = w.newPlayer('dd', '1.2.3.4');
    assert.equal(w.game.state(fourth.id).player.balance, 0);
    assert.equal(w.game.state(w.newPlayer('ee', '5.6.7.8').id).player.balance, 50);
  });
});

describe('check-in', () => {
  it('gives 5 PANEN and a mango seed once per day', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    const r = w.game.checkin(p.id);
    assert.equal(r.streak, 1);
    assert.equal(w.game.state(p.id).player.balance, 55);
    assert.throws(() => w.game.checkin(p.id), /already checked in/);
    await w.worker.drain();
    assert.equal(w.chain.balances.get(p.account_id), 55n * UNIT);
  });

  it('day 7 of a streak gives 2x PANEN and a Gold seed; a missed day resets the streak', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    for (let i = 1; i <= 6; i++) {
      assert.equal(w.game.checkin(p.id).calendarDay, i);
      w.advance(DAY);
    }
    const day7 = w.game.checkin(p.id);
    assert.equal(day7.calendarDay, 7);
    assert.ok(day7.rewards.includes('10 PANEN'));
    assert.ok(w.game.state(p.id).seeds.some((s: any) => s.quality === 'gold'));
    assert.equal(w.game.state(p.id).player.balance, 50 + 6 * 5 + 10);

    w.advance(2 * DAY); // missed a day
    assert.equal(w.game.checkin(p.id).streak, 1);
  });

  it('the day changes at 07:00 WIB, not at midnight local time', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id); // 08:00 WIB
    w.advance(22 * 60 * MINUTE + 59 * MINUTE); // 06:59 WIB next day
    assert.throws(() => w.game.checkin(p.id), /already/);
    w.advance(MINUTE); // 07:00 WIB
    assert.equal(w.game.checkin(p.id).streak, 2);
  });
});

describe('core loop', () => {
  it('plant -> water -> harvest -> sell -> shop, with every step on chain', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const mangoSeed = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;

    // Plant: an NFT is minted to the player.
    w.game.plant(p.id, 0, mangoSeed.id);
    await w.worker.drain();
    const tree = w.game.state(p.id).plots[0].tree!;
    assert.equal(tree.tokenId, '1');
    assert.equal(w.chain.trees.get('1')!.owner, 'ardian.nearvest.testnet');

    // No water, no growth.
    w.advance(10 * MINUTE);
    assert.throws(() => w.game.harvest(p.id, 0), /Nothing to harvest/);

    // First tree: ready about 3 minutes after watering.
    w.game.water(p.id, 0);
    assert.throws(() => w.game.water(p.id, 0), /already watered/);
    w.advance(2 * MINUTE);
    assert.equal(w.game.state(p.id).plots[0].tree!.ready, false);
    w.advance(MINUTE + 1000);
    assert.equal(w.game.state(p.id).plots[0].tree!.stage, 'fruiting');

    const h = w.game.harvest(p.id, 0);
    assert.equal(h.kind, 'fruit');
    assert.equal(w.game.state(p.id).player.xp, 10);
    assert.equal(w.game.state(p.id).plots[0].tree!.stage, 'tree');

    // Sell to Mr. Darto: mint_reward with today's price.
    const price = w.game.dartoPrices(false).prices.find((x) => x.species === 'mango')!.price;
    const sale = w.game.sell(p.id, 'mango', 'common', 1);
    assert.equal(sale.price, price);
    assert.ok(price >= 5 && price <= 13);
    const before = w.game.state(p.id).player.balance;
    assert.equal(before, 55 + price);

    // Shop: buying burns PANEN through the player's own (meta) transaction.
    w.game.buy(p.id, 'fertilizer', 1);
    assert.equal(w.game.state(p.id).player.balance, before - 8);
    await w.worker.drain();

    const methods = w.chain.calls.map((c) => c.method);
    assert.deepEqual(methods, ['create_player', 'mint', 'mint', 'mint_tree', 'update_tree', 'mint_reward', 'burn']);
    const burn = w.chain.calls.find((c) => c.method === 'burn')!.args as { signedWithKey: boolean };
    assert.equal(burn.signedWithKey, true);
    assert.equal(w.chain.balances.get(p.account_id), BigInt(55 + price - 8) * UNIT);
    assert.equal(w.chain.totalBurned, 8n * UNIT);
    assert.equal(w.chain.trees.get('1')!.harvestCount, 1);
    assert.ok(w.game.state(p.id).items.some((i: any) => i.item === 'fertilizer' && i.qty === 1));
  });

  it('the Season rule from the contract decides the sale reward', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.chain.rewardDivisor = 2;
    w.db.prepare("INSERT INTO fruits (player_id, species, quality, qty) VALUES (?, 'durian', 'gold', 1)").run(p.id);
    const sale = w.game.sell(p.id, 'durian', 'gold', 1);
    assert.equal(sale.expectedPanen, sale.basePanen); // server did not know about the new Season yet
    await w.worker.drain();
    assert.equal(w.game.state(p.id).player.balance, 50 + sale.basePanen / 2);
    assert.equal(w.game.seasonDivisor, 2);
    assert.equal(sale.basePanen, sale.price * 5); // Gold x5
  });

  it('cannot spend more PANEN than you have', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.buy(p.id, 'seed_durian', 1); // 40 of 50
    assert.throws(() => w.game.buy(p.id, 'seed_rambutan', 1), /Not enough PANEN/);
  });

  it('fertilizer makes a tree grow faster', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const seeds = w.game.state(p.id).seeds;
    w.game.plant(p.id, 0, seeds[0].id); // first tree (fast) on plot 0
    w.game.plant(p.id, 1, seeds[1].id); // mango, normal speed: 1 day
    w.game.buy(p.id, 'fertilizer', 1);
    w.game.water(p.id, 1);
    w.game.fertilize(p.id, 1);
    w.advance(DAY / 1.5 + 1000);
    assert.equal(w.game.state(p.id).plots[1].tree!.ready, true);
  });

  it('plot 3 unlocks at 50 XP', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const seed = w.game.state(p.id).seeds[0];
    assert.throws(() => w.game.plant(p.id, 2, seed.id), /locked/);
    w.db.prepare('UPDATE players SET xp = 50 WHERE id = ?').run(p.id);
    w.game.plant(p.id, 2, seed.id);
    assert.equal(w.game.state(p.id).player.title, 'Farmhand');
  });

  it('an old tree drops a seed with lineage, then becomes a Memorial Tree', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    const seed = w.game.state(p.id).seeds.find((s: any) => s.species === 'mango')!;
    w.game.plant(p.id, 0, seed.id);
    for (let i = 0; i < 3; i++) {
      w.advance(DAY);
      w.game.water(p.id, 0);
      w.advance(DAY);
      w.game.harvest(p.id, 0);
    }
    assert.equal(w.game.state(p.id).plots[0].tree!.stage, 'old');
    w.advance(DAY);
    w.game.water(p.id, 0);
    w.advance(DAY);
    const r = w.game.harvest(p.id, 0);
    assert.equal(r.kind, 'seed');
    assert.equal(w.game.state(p.id).plots[0].tree, null);
    const child = w.game.state(p.id).seeds.find((s: any) => s.source === 'tree')!;
    assert.ok(child.parentTreeId);

    // Planting the child records the parent NFT on chain.
    w.game.plant(p.id, 0, child.id);
    await w.worker.drain();
    assert.equal(w.chain.trees.get('1')!.memorial, true);
    assert.equal(w.chain.trees.get('2')!.parent, '1');
  });

  it('chopping frees the plot and makes a Memorial Tree', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.plant(p.id, 0, w.game.state(p.id).seeds[0].id);
    w.game.chop(p.id, 0);
    assert.equal(w.game.state(p.id).plots[0].tree, null);
    await w.worker.drain();
    assert.equal(w.chain.trees.get('1')!.memorial, true);
  });

  it('stage changes are synced to the NFT', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.plant(p.id, 0, w.game.state(p.id).seeds[0].id);
    w.game.water(p.id, 0);
    w.advance(MINUTE);
    assert.equal(w.game.syncStages(), 0); // not minted yet: nothing to update
    await w.worker.drain();
    // The mint landed a minute late, so it sent the tree's real data itself.
    assert.equal(w.chain.trees.get('1')!.stage, 'sprout');
    assert.equal(w.game.syncStages(), 0);
    w.advance(MINUTE);
    assert.equal(w.game.syncStages(), 1);
    assert.equal(w.game.syncStages(), 1); // still pending: no duplicate job
    assert.equal((w.db.prepare("SELECT COUNT(*) AS n FROM chain_jobs WHERE kind = 'update_tree'").get() as { n: number }).n, 1);
    await w.worker.drain();
    assert.equal(w.chain.trees.get('1')!.stage, 'tree');
    assert.equal(w.game.syncStages(), 0);
  });
});

describe('demo mode', () => {
  it('one game day is one minute', () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('judge1');
    w.game.checkin(p.id);
    w.advance(MINUTE);
    assert.equal(w.game.checkin(p.id).streak, 2);
    assert.equal(w.game.state(p.id).clock.dayLengthMs, MINUTE);
  });
});

describe('chain worker', () => {
  it('retries temporary errors and keeps order', async () => {
    const w = makeWorld();
    w.newPlayer('ardian');
    w.chain.failNext = 1;
    await w.worker.drain();
    const job = w.db.prepare('SELECT status, attempts FROM chain_jobs ORDER BY id LIMIT 1').get() as { status: string; attempts: number };
    assert.deepEqual({ ...job }, { status: 'pending', attempts: 1 });
    w.advance(10_000);
    await w.worker.drain();
    const statuses = w.db.prepare('SELECT status FROM chain_jobs ORDER BY id').all().map((r: any) => r.status);
    assert.deepEqual(statuses, ['done', 'done']);
  });

  it('a failed burn gives the PANEN back locally', async () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    await w.worker.drain();
    w.chain.balances.set(p.account_id, 0n); // chain disagrees with the local ledger
    w.game.buy(p.id, 'fertilizer', 1);
    assert.equal(w.game.state(p.id).player.balance, 42);
    await w.worker.drain();
    assert.equal(w.game.state(p.id).player.balance, 50);
    assert.equal(w.game.state(p.id).activity[0].status, 'failed');
  });
});

describe('price lock', () => {
  it('sells at the price the player saw, or refuses with the new price', async () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('ardian');
    w.db.prepare("INSERT INTO fruits (player_id, species, quality, qty) VALUES (?, 'durian', 'common', 2)").run(p.id);
    const seen = w.game.dartoPrices(true).prices.find((x) => x.species === 'durian')!.price;

    // Same day: the shown price is honored.
    assert.equal(w.game.sell(p.id, 'durian', 'common', 1, seen).price, seen);

    // Find a later demo day where the price is different.
    let next = seen;
    while (next === seen) {
      w.advance(MINUTE);
      next = w.game.dartoPrices(true).prices.find((x) => x.species === 'durian')!.price;
    }
    assert.throws(
      () => w.game.sell(p.id, 'durian', 'common', 1, seen),
      (err: any) => err.status === 409 && err.details.code === 'price_changed' && err.details.price === next,
    );
    // Nothing was sold.
    assert.equal(w.game.state(p.id).fruits.find((f) => f.species === 'durian')!.qty, 1);
    // Confirming the new price works.
    assert.equal(w.game.sell(p.id, 'durian', 'common', 1, next).price, next);
  });
});

describe('demo streak grace', () => {
  it('in demo mode a streak survives a few missed minutes', () => {
    const w = makeWorld({ demo: true });
    const p = w.newPlayer('judge1');
    assert.equal(w.game.checkin(p.id).streak, 1);
    w.advance(5 * MINUTE); // missed 4 demo days
    assert.equal(w.game.checkin(p.id).streak, 2);
    w.advance(11 * MINUTE); // missed 10 demo days: still allowed
    assert.equal(w.game.checkin(p.id).streak, 3);
    w.advance(12 * MINUTE); // missed 11: reset
    assert.equal(w.game.checkin(p.id).streak, 1);
  });

  it('in normal mode a missed day still resets the streak', () => {
    const w = makeWorld();
    const p = w.newPlayer('ardian');
    w.game.checkin(p.id);
    w.advance(2 * DAY);
    assert.equal(w.game.checkin(p.id).streak, 1);
  });
});
