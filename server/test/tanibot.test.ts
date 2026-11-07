// TaniBot: bot account with only a function call key, contract-style budget and
// daily limit (FakeChain mirrors the PANEN contract), rules brain, schedule, log.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { KeyPair } from 'near-api-js';
import { decryptSecret } from '../src/crypto.ts';
import { nextRunAt, DEMO_BOT_INTERVAL_MS } from '../src/tanibot.ts';
import { nameError } from '../src/game.ts';
import { DAY, HOUR, MINUTE, makeWorld, UNIT } from './helpers.ts';

type World = ReturnType<typeof makeWorld>;
const PANEN = 'panen.nearvest.testnet';

/** A Google-style garden (server holds the key) with its NEAR account created and 50 PANEN welcome pack. */
async function garden(w: World, name = 'sari') {
  const p = w.newPlayer(name);
  await w.worker.drain();
  return p;
}

async function readyBot(w: World, name = 'sari', opts = { dailyLimit: 10, budget: 20 }) {
  const p = await garden(w, name);
  w.tanibot.setup(p.id, opts);
  await w.worker.drain();
  return p;
}

const botSecret = (w: World, playerId: number) =>
  decryptSecret((w.db.prepare('SELECT secret_key_enc FROM bots WHERE player_id = ?').get(playerId) as { secret_key_enc: string }).secret_key_enc, w.masterKey);

const seedOf = (w: World, playerId: number, species: string) =>
  (w.db.prepare('SELECT id FROM seeds WHERE player_id = ? AND species = ? LIMIT 1').get(playerId, species) as { id: number }).id;

describe('TaniBot account and budget (Google gardens)', () => {
  it('creates bot.<player> with ONE function call key, links it with the limit, and moves the budget', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    const botId = 'bot.sari.nearvest.testnet';

    const keys = [...w.chain.accessKeys].filter(([k]) => k.startsWith(`${botId} `));
    assert.equal(keys.length, 1, 'exactly one key');
    const perm = keys[0][1].permission;
    assert.notEqual(perm, 'FullAccess');
    assert.deepEqual(perm !== 'FullAccess' && [perm.receiverId, perm.methodNames], [PANEN, ['burn', 'bot_accept']]);

    const info = await w.chain.botInfo(botId);
    assert.deepEqual(info && { owner: info.ownerId, accepted: info.accepted, limit: info.dailyLimit, balance: info.balance }, {
      owner: 'sari.nearvest.testnet',
      accepted: true,
      limit: 10n * UNIT,
      balance: 20n * UNIT,
    });
    assert.equal(await w.chain.ftBalanceOf('sari.nearvest.testnet'), 30n * UNIT);

    const v = w.tanibot.view(p.id)!;
    assert.equal(v.status, 'ready');
    assert.equal(v.budget, 20);
    assert.equal(w.game.state(p.id).player.balance, 30);
    assert.deepEqual(v.log.map((l) => l.action).reverse(), ['setup', 'limit', 'budget']);
    assert.ok(v.log.every((l) => l.txStatus === 'done'));
  });

  it('the bot key can not transfer tokens, and only the player gets the budget back', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    const botId = 'bot.sari.nearvest.testnet';
    await assert.rejects(
      w.chain.callAs(botId, botSecret(w, p.id), PANEN, [{ method: 'ft_transfer', args: { receiver_id: 'evil.testnet', amount: '1' }, deposit: 1n }]),
      /MethodNameMismatch/,
    );
    await assert.rejects(
      w.chain.callAs(botId, botSecret(w, p.id), PANEN, [{ method: 'set_bot', args: { bot_id: botId, daily_limit: '999' } }]),
      /MethodNameMismatch/,
    );

    w.tanibot.withdraw(p.id, 5);
    await w.worker.drain();
    assert.equal(await w.chain.ftBalanceOf(botId), 15n * UNIT);
    assert.equal(await w.chain.ftBalanceOf('sari.nearvest.testnet'), 35n * UNIT);
    assert.equal(w.tanibot.view(p.id)!.budget, 15);
    assert.equal(w.game.state(p.id).player.balance, 35);
  });

  it('refuses a second setup, a budget above the balance and a limit out of range', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    assert.throws(() => w.tanibot.setup(p.id, {}), /already active/);
    const q = await garden(w, 'budi');
    assert.throws(() => w.tanibot.setup(q.id, { budget: 51 }), /do not have that much/);
    assert.throws(() => w.tanibot.setup(q.id, { dailyLimit: 1000 }), /Daily limit/);
  });
});

describe('TaniBot rules brain', () => {
  it('waters, buys fertilizer from its own budget for the slow tree, and fertilizes it', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    w.game.checkin(p.id);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    w.game.plant(p.id, 1, seedOf(w, p.id, 'mango'));

    const done = w.tanibot.run(p.id);
    await w.worker.drain();
    assert.ok(done >= 4);
    const plots = w.game.state(p.id).plots;
    assert.equal(plots[0].tree!.wateredToday && plots[1].tree!.wateredToday, true);
    assert.equal(plots[0].tree!.isFertilized, true, 'durian fertilized (Balanced)');
    assert.equal(plots[1].tree!.isFertilized, false, 'mango not fertilized (Balanced)');

    // 8 PANEN burned from the BOT's account, not the player's.
    assert.equal(await w.chain.ftBalanceOf('bot.sari.nearvest.testnet'), 12n * UNIT);
    assert.equal(await w.chain.ftBalanceOf('sari.nearvest.testnet'), 35n * UNIT);
    const v = w.tanibot.view(p.id)!;
    assert.equal(v.spentToday, 8);
    assert.equal(v.remainingToday, 2);
    const buy = v.log.find((l) => l.action === 'buy')!;
    assert.match(buy.reason, /bought 1 Fertilizer for 8 PANEN/);
    assert.equal(buy.txStatus, 'done');
  });

  it('stops buying at the daily limit, says so once, and buys again the next day', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    w.tanibot.settings(p.id, { style: 'turbo' });
    w.game.checkin(p.id);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    w.game.plant(p.id, 1, seedOf(w, p.id, 'mango'));

    w.tanibot.run(p.id); // buys 1 (8 of 10), fertilizes durian; mango would need a 2nd purchase
    await w.worker.drain();
    w.tanibot.run(p.id);
    w.tanibot.run(p.id);
    const log = w.tanibot.view(p.id)!.log;
    assert.equal(log.filter((l) => l.action === 'buy').length, 1);
    assert.equal(log.filter((l) => l.reason.includes("today's spending limit")).length, 1, 'notice only once a day');
    assert.equal(w.game.state(p.id).plots[1].tree!.isFertilized, false);

    w.advance(DAY);
    w.tanibot.run(p.id);
    await w.worker.drain();
    assert.equal(w.tanibot.view(p.id)!.log.filter((l) => l.action === 'buy').length, 2);
    assert.equal(await w.chain.ftBalanceOf('bot.sari.nearvest.testnet'), 4n * UNIT);
  });

  it('says when the budget is empty and stops buying', async () => {
    const w = makeWorld();
    const p = await readyBot(w, 'sari', { dailyLimit: 50, budget: 5 });
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    w.tanibot.run(p.id);
    const v = w.tanibot.view(p.id)!;
    assert.equal(v.log.filter((l) => l.action === 'buy').length, 0);
    assert.ok(v.log.some((l) => /budget is empty/.test(l.reason)));
  });

  it('harvests, sells Common fruit to Mr. Darto (paid to the player) and keeps Rare fruit', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    w.tanibot.settings(p.id, { style: 'turbo' });
    w.game.checkin(p.id);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'mango'));
    w.game.water(p.id, 0);
    w.advance(10 * MINUTE); // the first tree fruits after about 3 minutes of watered growth
    w.db.prepare("INSERT INTO fruits (player_id, species, quality, qty) VALUES (?, 'durian', 'rare', 1)").run(p.id);
    const before = await w.chain.ftBalanceOf('sari.nearvest.testnet');

    w.tanibot.run(p.id);
    await w.worker.drain();
    const log = w.tanibot.view(p.id)!.log;
    assert.ok(log.some((l) => l.action === 'harvest'));
    const sell = log.find((l) => l.action === 'sell')!;
    assert.match(sell.reason, /sold 1 Common Mango/);
    assert.equal(sell.txStatus, 'done');
    assert.ok((await w.chain.ftBalanceOf('sari.nearvest.testnet')) > before, 'sale paid to the player');
    assert.ok(log.some((l) => l.action === 'keep' && /1 Rare Durian/.test(l.reason)));
    assert.deepEqual(w.game.state(p.id).fruits.filter((f) => f.qty > 0).map((f) => `${f.quality} ${f.species}`), ['rare durian']);
  });

  it('a burn the chain refuses gives the budget back and takes the item back', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    // The contract has a lower limit than the server thinks (e.g. changed by the player elsewhere).
    w.chain.bots.get('bot.sari.nearvest.testnet')!.dailyLimit = 1n * UNIT;
    w.tanibot.run(p.id);
    await w.worker.drain();
    assert.equal(w.game.itemCount(p.id, 'fertilizer'), 0);
    const v = w.tanibot.view(p.id)!;
    assert.equal(v.budget, 20);
    assert.equal(v.spentToday, 0);
    assert.equal(v.log.find((l) => l.action === 'buy')!.txStatus, 'failed');
  });
});

describe('TaniBot schedule', () => {
  it('normal gardens: 08:00, 13:00 and 20:00 WIB (01, 06, 13 UTC)', () => {
    const at = (h: number, m = 0) => Date.UTC(2026, 10, 7, h, m);
    assert.equal(nextRunAt(at(0, 30), false), at(1));
    assert.equal(nextRunAt(at(1), false), at(6));
    assert.equal(nextRunAt(at(7), false), at(13));
    assert.equal(nextRunAt(at(14), false), Date.UTC(2026, 10, 8, 1));
  });

  it('runs when due, waits until the next slot, and not at all when switched off', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    assert.equal((await w.tanibot.tick()), 1, 'first run right after activation');
    assert.equal((await w.tanibot.tick()), 0);
    w.advance(5 * HOUR); // START is 01:00 UTC -> 06:00 UTC
    assert.equal((await w.tanibot.tick()), 1);
    w.tanibot.settings(p.id, { enabled: false });
    w.advance(DAY);
    assert.equal((await w.tanibot.tick()), 0);
    w.tanibot.settings(p.id, { enabled: true });
    assert.equal((await w.tanibot.tick()), 1);
  });

  it('demo gardens run every 2 minutes, not every game minute', async () => {
    const w = makeWorld({ demo: true });
    await readyBot(w);
    assert.equal((await w.tanibot.tick()), 1);
    w.advance(MINUTE);
    assert.equal((await w.tanibot.tick()), 0);
    w.advance(DEMO_BOT_INTERVAL_MS - MINUTE);
    assert.equal((await w.tanibot.tick()), 1);
  });
});

describe('TaniBot for wallet gardens', () => {
  it('creates <name>-bot through the factory; the wallet signs set_bot; the bot accepts', async () => {
    const w = makeWorld();
    const walletKey = KeyPair.fromRandom('ed25519');
    w.chain.addAccessKey('alice.testnet', walletKey.getPublicKey().toString(), 'FullAccess');
    const userId = Number(w.db.prepare("INSERT INTO users (provider, subject, created_at) VALUES ('near', 'alice.testnet', ?)").run(w.now()).lastInsertRowid);
    const p = w.game.createPlayer(userId, 'alice', '10.0.0.9');
    await w.worker.drain();

    const r = w.tanibot.setup(p.id, { dailyLimit: 15 });
    assert.equal(r.bot!.accountId, 'alice-bot.nearvest.testnet');
    assert.deepEqual(r.walletCalls, [
      { receiverId: PANEN, method: 'set_bot', args: { bot_id: 'alice-bot.nearvest.testnet', daily_limit: (15n * UNIT).toString() }, deposit: '1' },
    ]);
    await w.worker.drain();
    assert.equal(w.tanibot.view(p.id)!.status, 'linking');

    // What the player's wallet does (near-connect), then the web tells the server.
    await w.chain.callAs('alice.testnet', walletKey.toString(), PANEN, [{ method: 'set_bot', args: r.walletCalls![0].args, deposit: 1n }]);
    w.tanibot.walletLinked(p.id);
    await w.worker.drain();
    assert.equal(w.tanibot.view(p.id)!.status, 'ready');
    assert.equal((await w.chain.botInfo('alice-bot.nearvest.testnet'))!.ownerId, 'alice.testnet');
    assert.throws(() => w.tanibot.fund(p.id, 5), /with their wallet/);
  });

  it("player names can not end in '-bot' (reserved for TaniBot accounts)", () => {
    assert.match(nameError('alice-bot') ?? '', /reserved for TaniBots/);
    assert.equal(nameError('robot'), null);
  });
});

describe('TaniBot HTTP API', () => {
  it('activate, switch off and on, change style, add budget', async () => {
    const w = makeWorld();
    const call = async (method: string, path: string, token: string, body?: unknown) => {
      const res = await w.app.request(path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: res.status, json: (await res.json()) as any };
    };
    const login = await w.app.request('/auth/dev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'tester' }) });
    const { token } = (await login.json()) as { token: string };
    await call('POST', '/api/player', token, { name: 'tester' });
    await w.worker.drain();

    assert.equal((await call('GET', '/api/tanibot', token)).json.bot, null);
    const setup = await call('POST', '/api/tanibot/setup', token, { dailyLimit: 10, budget: 10 });
    assert.equal(setup.status, 200);
    assert.equal(setup.json.bot.accountId, 'bot.tester.nearvest.testnet');
    assert.equal(setup.json.state.player.balance, 40);
    await w.worker.drain();

    const off = await call('POST', '/api/tanibot/settings', token, { enabled: false, style: 'thrifty' });
    assert.equal(off.json.bot.enabled, false);
    assert.equal(off.json.bot.style, 'thrifty');
    assert.equal((await call('POST', '/api/tanibot/settings', token, { style: 'lazy' })).status, 400);
    const fund = await call('POST', '/api/tanibot/fund', token, { amount: 5 });
    assert.equal(fund.json.bot.budget, 15);
    assert.equal((await call('GET', '/api/tanibot', token)).json.brain, 'rules');
  });
});

describe('TaniBot quick reactions (demo gardens)', () => {
  it('reacts to a dry tree within about 10 seconds between rounds, without spamming the Log', async () => {
    const w = makeWorld({ demo: true });
    const p = await readyBot(w);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    w.tanibot.settings(p.id, { style: 'thrifty' });
    assert.equal((await w.tanibot.tick()), 1, 'first round');
    assert.equal(w.game.state(p.id).plots[0].tree!.wateredToday, true);

    // A new demo day (1 minute): the tree is dry again; the next round is still 1 minute away.
    w.advance(MINUTE);
    assert.equal(w.game.state(p.id).plots[0].tree!.wateredToday, false);
    w.advance(5_000);
    await w.tanibot.tick();
    assert.equal(w.game.state(p.id).plots[0].tree!.wateredToday, true, 'watered by a quick reaction');

    // Quick reactions never shop or write "nothing to do" lines.
    const log = w.tanibot.view(p.id)!.log;
    assert.equal(log.filter((l) => l.action === 'check').length, 0);
    assert.equal(log.filter((l) => l.action === 'buy').length, 0);
    // The identical water line within 3 minutes is written only once.
    assert.equal(log.filter((l) => l.action === 'water').length, 1);
  });

  it('does not react between rounds in normal gardens', async () => {
    const w = makeWorld();
    const p = await readyBot(w);
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    await w.tanibot.tick();
    // Same day, between rounds: make the tree dry.
    w.db.prepare('UPDATE trees SET water_day = NULL WHERE player_id = ?').run(p.id);
    w.advance(10_000);
    assert.equal((await w.tanibot.tick()), 0);
    assert.equal(w.game.state(p.id).plots[0].tree!.wateredToday, false);
  });
});

describe('TaniBot at a glance (garden state)', () => {
  it('shows ON/OFF, a budget warning and the latest action for the bubble', async () => {
    const w = makeWorld();
    const p = await garden(w);
    assert.equal(w.game.state(p.id).player.tanibot, null, 'not active yet');
    w.tanibot.setup(p.id, { dailyLimit: 10, budget: 20 });
    await w.worker.drain();
    w.game.plant(p.id, 0, seedOf(w, p.id, 'durian'));
    w.tanibot.run(p.id); // waters, buys 8 of 10 -> today's limit nearly used
    let s = w.game.state(p.id).player.tanibot!;
    assert.equal(s.enabled, true);
    assert.equal(s.alert, 'limit');
    assert.match(s.last!.text, /Fertilized the Durian!|Bought 1 Fertilizer!|Watered/);

    w.tanibot.settings(p.id, { enabled: false });
    s = w.game.state(p.id).player.tanibot!;
    assert.equal(s.enabled, false);

    w.tanibot.withdraw(p.id, 10); // budget 12 -> 2
    assert.equal(w.game.state(p.id).player.tanibot!.alert, 'low');
  });
});

describe('TaniBot for new gardens and across devices', () => {
  const call = async (w: World, method: string, path: string, token?: string, body?: unknown) => {
    const res = await w.app.request(path, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as any };
  };
  const login = async (w: World) => (await call(w, 'POST', '/auth/dev', undefined, { username: 'farmer' })).json.token as string;

  it('a new garden starts WITHOUT an active TaniBot (it sleeps until the player activates it)', async () => {
    const w = makeWorld();
    const token = await login(w);
    const created = await call(w, 'POST', '/api/player', token, { name: 'farmer' });
    assert.equal(created.json.player.tanibot, null);
    assert.equal((await call(w, 'GET', '/api/tanibot', token)).json.bot, null);
    await w.worker.drain();
    assert.equal(await w.tanibot.tick(), 0, 'nothing runs before activation');
  });

  it('settings live on the server: a second device (new login) sees the same ON/OFF, style, limit and budget', async () => {
    const w = makeWorld();
    const phone = await login(w);
    await call(w, 'POST', '/api/player', phone, { name: 'farmer' });
    await w.worker.drain();
    await call(w, 'POST', '/api/tanibot/setup', phone, { dailyLimit: 12, budget: 15 });
    await w.worker.drain();
    await call(w, 'POST', '/api/tanibot/settings', phone, { enabled: false, style: 'turbo' });
    await call(w, 'POST', '/auth/logout', phone);

    const laptop = await login(w); // another device = another session
    const bot = (await call(w, 'GET', '/api/tanibot', laptop)).json.bot;
    assert.deepEqual({ enabled: bot.enabled, style: bot.style, limit: bot.dailyLimit, budget: bot.budget }, { enabled: false, style: 'turbo', limit: 12, budget: 15 });
    const me = (await call(w, 'GET', '/api/me', laptop)).json.player.tanibot;
    assert.equal(me.enabled, false);
  });

  it('works while nobody has the game open (the server runs it on schedule)', async () => {
    const w = makeWorld();
    const token = await login(w);
    await call(w, 'POST', '/api/player', token, { name: 'farmer' });
    await w.worker.drain();
    await call(w, 'POST', '/api/tanibot/setup', token, { dailyLimit: 10, budget: 10 });
    await w.worker.drain();
    const pid = (w.db.prepare("SELECT id FROM players WHERE name = 'farmer'").get() as { id: number }).id;
    w.game.plant(pid, 0, seedOf(w, pid, 'durian'));
    await call(w, 'POST', '/auth/logout', token); // the player is gone
    await w.tanibot.tick();
    assert.equal(w.game.state(pid).plots[0].tree!.wateredToday, true);
  });
});
