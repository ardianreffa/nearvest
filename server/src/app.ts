// HTTP API (JSON). The web game on Vercel calls these routes.

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { devIdentity, login, logout, openSession, userFromToken, verifyGoogleCredential } from './auth.ts';
import type { JWTVerifyGetKey } from 'jose';
import { DEFAULT_BOT_BUDGET, DEFAULT_BOT_DAILY_LIMIT, MAX_BOT_DAILY_LIMIT, type TaniBotService } from './tanibot.ts';
import type { Chain } from './chain/types.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { Game, GameError, type JudgeStep, type SignedBurn } from './game.ts';
import type { JudgeService } from './judge.ts';
import { Arena } from './arena.ts';
import { ArenaMatches } from './arena-match.ts';
import { Social } from './social.ts';
import {
  BURN_GAS,
  BURN_TTL_BLOCKS,
  createChallenge,
  GAME_KEY_ALLOWANCE_YOCTO,
  GAME_KEY_METHODS,
  isGameKey,
  parsePublicKey,
  verifyWalletProof,
} from './wallet.ts';
import { UNITS_PER_MICRO } from './chain/types.ts';
import { DEMO_XP_MULTIPLIER, fruitOdds, SEED_STORAGE_SLOTS, seedSellPrice, SHOP_ITEMS, SPECIES, SPECIES_LIST, TITLES, type Quality, type ShopItem, type Species } from './rules.ts';

export interface AppDeps {
  db: DB;
  game: Game;
  chain: Chain;
  config: Pick<Config, 'devLogin' | 'googleClientId' | 'webOrigins' | 'panenContractId' | 'pohonContractId' | 'networkId' | 'factoryAccountId' | 'explorerTxUrl'>;
  now: () => number;
  tanibot: TaniBotService;
  judge: JudgeService;
  /** Google's signing keys; tests pass a fake key set. Default: Google's live keys. */
  googleKeys?: JWTVerifyGetKey;
}

type Env = { Variables: { userId: number } };

const STATS_CACHE_MS = 15_000;
/** Wallet players' balances are re-read from the chain at most this often. */
const WALLET_SYNC_MS = 30_000;

export function createApp(deps: AppDeps) {
  const { db, game, chain, config, now, tanibot, judge } = deps;
  const social = new Social(db, game, now);
  const arena = new Arena(db, game, now, { explorerTxUrl: config.explorerTxUrl });
  const matches = new ArenaMatches(db, game, arena, now, { explorerTxUrl: config.explorerTxUrl });
  const app = new Hono<Env>();

  // maxAge: browsers remember the CORS preflight (Chrome up to 2 h), so each game action is one
  // round trip to the server instead of two (the preflight was repeated after a few seconds idle).
  app.use('*', cors({ origin: config.webOrigins, allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST'], maxAge: 7200 }));

  app.onError((err, c) => {
    if (err instanceof GameError) return c.json({ error: err.message, ...err.details }, err.status as 400);
    console.error(err);
    return c.json({ error: 'Something went wrong on the server' }, 500);
  });

  const body = async (c: Context): Promise<Record<string, unknown>> => {
    try {
      return (await c.req.json()) as Record<string, unknown>;
    } catch {
      return {};
    }
  };
  const bearer = (c: Context) => c.req.header('Authorization')?.replace(/^Bearer\s+/i, '');
  const clientIp = (c: Context) =>
    c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ?? null;

  // ---------- Public ----------

  app.get('/health', (c) => c.json({ ok: true }));

  app.get('/api/config', (c) =>
    c.json({
      network: config.networkId,
      explorerTxUrl: config.explorerTxUrl,
      googleClientId: config.googleClientId || null,
      devLogin: config.devLogin,
      contracts: { panen: config.panenContractId, pohon: config.pohonContractId },
      wallet: {
        loginRecipient: config.factoryAccountId,
        gameKey: { contractId: config.panenContractId, methodNames: GAME_KEY_METHODS, allowance: GAME_KEY_ALLOWANCE_YOCTO },
      },
      shop: SHOP_ITEMS,
      species: SPECIES,
      titles: TITLES,
      demoXpMultiplier: DEMO_XP_MULTIPLIER,
      seedStorageSlots: SEED_STORAGE_SLOTS,
      /** Mr. Darto's price for a seed of unknown quality (Rare x2, Gold x5 when known). */
      seedSellPrices: Object.fromEntries(SPECIES_LIST.map((sp) => [sp, seedSellPrice(sp, null)])),
      fertilizedOdds: { common: fruitOdds('common', true), rare: fruitOdds('rare', true), gold: fruitOdds('gold', true) },
    }),
  );

  let statsCache: { at: number; value: unknown } | null = null;
  app.get('/api/stats', async (c) => {
    if (!statsCache || now() - statsCache.at > STATS_CACHE_MS) {
      const [s, trees] = await Promise.all([chain.villageStats(), chain.treeSupply()]);
      game.seasonDivisor = s.rewardDivisor;
      const panen = (v: bigint) => Number(v / 10n ** 12n) / 1e6;
      statsCache = {
        at: now(),
        value: {
          panen: {
            totalMinted: panen(s.totalMinted),
            totalBurned: panen(s.totalBurned),
            circulatingSupply: panen(s.circulatingSupply),
            season: s.season,
            rewardDivisor: s.rewardDivisor,
            nextSeasonAt: s.nextSeasonAt === null ? null : panen(s.nextSeasonAt),
          },
          treeNfts: trees,
          village: game.localStats(),
          darto: game.dartoPrices(false),
        },
      };
    }
    return c.json(statsCache.value);
  });

  app.get('/api/darto', (c) => c.json(game.dartoPrices(c.req.query('demo') === 'true')));

  // ---------- Auth ----------

  app.post('/auth/google', async (c) => {
    const { credential } = await body(c);
    if (typeof credential !== 'string') throw new GameError('Missing Google credential');
    const identity = await verifyGoogleCredential(credential, config.googleClientId, { keys: deps.googleKeys, nowMs: now() });
    // A Google account linked to a wallet garden signs in to that garden.
    const linked = game.getPlayerByGoogle(identity.subject);
    if (linked) return c.json({ token: openSession(db, linked.user_id, now()), player: game.state(linked.id) });
    const { token, userId } = login(db, identity, now());
    const p = game.getPlayerByUser(userId);
    return c.json({ token, player: p ? game.state(p.id) : null });
  });

  app.post('/auth/dev', async (c) => {
    if (!config.devLogin) throw new GameError('Dev login is disabled', 404);
    const { username } = await body(c);
    if (typeof username !== 'string') throw new GameError('Missing username');
    const { token, userId } = login(db, devIdentity(username), now());
    const p = game.getPlayerByUser(userId);
    return c.json({ token, player: p ? game.state(p.id) : null });
  });

  // Try as Judge: one click, a new filled garden for this device (see judge.ts).
  app.post('/auth/judge', async (c) => {
    const r = judge.enter((await body(c)).deviceId, clientIp(c));
    return c.json({ token: r.token, kind: r.kind, player: game.state(r.playerId) });
  });

  // NEAR wallet login (NEP-413). Step 1: a one-time nonce for the wallet to sign.
  app.post('/auth/near/challenge', (c) => c.json({ ...createChallenge(db, now()), recipient: config.factoryAccountId }));

  // Step 2: the signed message. The key must be a FullAccess key of the account.
  // A wallet linked to a Google garden signs in to that garden; otherwise it is its own login.
  app.post('/auth/near', async (c) => {
    const accountId = await verifyWalletProof(db, chain, config.factoryAccountId, await body(c), now());
    const linked = game.getPlayerByWallet(accountId);
    if (linked) return c.json({ token: openSession(db, linked.user_id, now()), player: game.state(linked.id) });
    const { token, userId } = login(db, { provider: 'near', subject: accountId, email: null }, now());
    const p = game.getPlayerByUser(userId);
    return c.json({ token, player: p ? game.state(p.id) : null });
  });

  app.post('/auth/logout', (c) => {
    const token = bearer(c);
    if (token) logout(db, token);
    return c.json({ ok: true });
  });

  // ---------- Player (login required) ----------

  app.use('/api/*', async (c, next) => {
    if (['/api/config', '/api/stats', '/api/darto'].includes(c.req.path)) return next();
    const userId = userFromToken(db, bearer(c), now());
    if (!userId) throw new GameError('Please sign in', 401);
    c.set('userId', userId);
    return next();
  });

  const playerId = (c: Context<Env>) => {
    const p = game.getPlayerByUser(c.get('userId'));
    if (!p) throw new GameError('Create your garden first', 404);
    return p.id;
  };

  /** Who is signed in (the create-garden screen shows the wallet account of wallet players). */
  app.get('/api/session', (c) => {
    const u = db.prepare('SELECT provider, subject FROM users WHERE id = ?').get(c.get('userId')) as { provider: string; subject: string };
    return c.json({ provider: u.provider, walletAccountId: u.provider === 'near' ? u.subject : null });
  });

  // "Connect NEAR Wallet" for Google/dev gardens: the same NEP-413 proof, then the wallet is linked.
  app.post('/api/wallet/link', async (c) => {
    const pid = playerId(c);
    const accountId = await verifyWalletProof(db, chain, config.factoryAccountId, await body(c), now());
    game.linkWallet(pid, accountId);
    return c.json(game.state(pid));
  });

  // "Link Google account" for wallet gardens: then Google sign-in opens this garden too.
  app.post('/api/google/link', async (c) => {
    const pid = playerId(c);
    const { credential } = await body(c);
    if (typeof credential !== 'string') throw new GameError('Missing Google credential');
    const identity = await verifyGoogleCredential(credential, config.googleClientId, { keys: deps.googleKeys, nowMs: now() });
    game.linkGoogle(pid, identity.subject);
    return c.json(game.state(pid));
  });

  // ---------- TaniBot ----------

  const lastBotSync = new Map<number, number>();
  const botView = async (pid: number, forceSync = false) => {
    if (forceSync || now() - (lastBotSync.get(pid) ?? 0) > 20_000) {
      lastBotSync.set(pid, now());
      await tanibot.sync(pid).catch((err) => console.warn('TaniBot sync failed:', err instanceof Error ? err.message : err));
    }
    return {
      bot: tanibot.view(pid),
      ...tanibot.brainInfo(),
      defaults: { dailyLimit: DEFAULT_BOT_DAILY_LIMIT, budget: DEFAULT_BOT_BUDGET, maxDailyLimit: MAX_BOT_DAILY_LIMIT },
    };
  };
  const num = (v: unknown) => (typeof v === 'number' ? v : Number(v));

  app.get('/api/tanibot', async (c) => c.json(await botView(playerId(c))));

  app.post('/api/tanibot/setup', async (c) => {
    const b = await body(c);
    const pid = playerId(c);
    const r = tanibot.setup(pid, {
      dailyLimit: b.dailyLimit === undefined ? undefined : num(b.dailyLimit),
      budget: b.budget === undefined ? undefined : num(b.budget),
    });
    return c.json({ ...(await botView(pid)), walletCalls: r.walletCalls, state: game.state(pid) });
  });

  app.post('/api/tanibot/linked', async (c) => {
    const pid = playerId(c);
    tanibot.walletLinked(pid);
    return c.json(await botView(pid));
  });

  app.post('/api/tanibot/settings', async (c) => {
    const pid = playerId(c);
    tanibot.settings(pid, await body(c));
    // The garden shows ON/OFF right away (sleeping pose, goodbye bubble).
    return c.json({ ...(await botView(pid)), state: game.state(pid) });
  });

  app.post('/api/tanibot/fund', async (c) => {
    const pid = playerId(c);
    tanibot.fund(pid, num((await body(c)).amount));
    return c.json({ ...(await botView(pid)), state: game.state(pid) });
  });

  app.post('/api/tanibot/withdraw', async (c) => {
    const pid = playerId(c);
    tanibot.withdraw(pid, num((await body(c)).amount));
    return c.json({ ...(await botView(pid)), state: game.state(pid) });
  });

  /** Wallet gardens: after a wallet transaction (budget, limit), re-read the bot from the chain. */
  app.post('/api/tanibot/sync', async (c) => c.json(await botView(playerId(c), true)));

  app.post('/api/avatar', async (c) => {
    const pid = playerId(c);
    game.setAvatar(pid, (await body(c)).avatar);
    return c.json(game.state(pid));
  });

  app.post('/api/player', async (c) => {
    const { name, demo, ref, deviceId } = await body(c);
    if (typeof name !== 'string') throw new GameError('Missing name');
    // ref: the inviter's garden from an invite link (?ref=<name>, referral.ts); deviceId: this browser.
    const p = game.createPlayer(c.get('userId'), name.trim().toLowerCase(), clientIp(c), typeof demo === 'boolean' ? demo : undefined, { ref, deviceId });
    return c.json(game.state(p.id), 201);
  });

  const lastWalletSync = new Map<number, number>();
  const syncWallet = async (pid: number) => {
    const p = game.getPlayer(pid);
    if (p.custody !== 'wallet') return;
    game.syncWalletBalance(pid, await chain.ftBalanceOf(p.account_id));
    lastWalletSync.set(pid, now());
  };

  app.get('/api/me', async (c) => {
    const pid = playerId(c);
    if (now() - (lastWalletSync.get(pid) ?? 0) > WALLET_SYNC_MS) {
      lastWalletSync.set(pid, now());
      await syncWallet(pid).catch((err) => console.warn('wallet balance sync failed:', err instanceof Error ? err.message : err));
    }
    // ?device=<id>: the browser's random id (refuses self-invites, referral.ts).
    game.touch(pid, c.req.query('device'));
    return c.json(game.state(pid));
  });

  // Wallet players, step 1 of a Shop purchase: the exact burn their game key must sign.
  app.post('/api/wallet/burn', async (c) => {
    const b = await body(c);
    const pid = playerId(c);
    const p = game.getPlayer(pid);
    if (p.custody !== 'wallet') throw new GameError('Only for NEAR wallet players');
    const publicKey = parsePublicKey(b.publicKey).toString();
    const key = await chain.viewAccessKey(p.account_id, publicKey);
    if (!key || !isGameKey(key.permission, config.panenContractId)) {
      throw new GameError('Your game key is missing. Connect your wallet once more to enable the Shop.', 409, { code: 'game_key_missing' });
    }
    await syncWallet(pid);
    const quote = game.shopQuote(pid, b.item as ShopItem, Number(b.qty ?? 1));
    const height = await chain.blockHeight();
    const nonce = (key.nonce > BigInt(p.key_nonce) ? key.nonce : BigInt(p.key_nonce)) + 1n;
    return c.json({
      senderId: p.account_id,
      receiverId: config.panenContractId,
      publicKey,
      nonce: nonce.toString(),
      maxBlockHeight: (height + BURN_TTL_BLOCKS).toString(),
      amount: (BigInt(quote.costMicro) * UNITS_PER_MICRO).toString(),
      memo: quote.memo,
      gas: BURN_GAS.toString(),
    });
  });

  const plotOf = (b: Record<string, unknown>) => {
    if (typeof b.plot !== 'number') throw new GameError('Missing plot');
    return b.plot;
  };
  const respond = (c: Context<Env>, result: unknown) => c.json({ result, state: game.state(playerId(c)) });
  /** Judge gardens: marks a tour step done (with the chain job the action just queued). */
  const judgeStep = (c: Context<Env>, step: JudgeStep) => {
    const id = playerId(c);
    if (game.isJudge(id)) game.judgeStep(id, step);
  };

  // Tutorial: "Let's go" (start) or skip.
  app.post('/api/tutorial', async (c) => {
    game.tutorialAction(playerId(c), (await body(c)).action);
    return c.json({ state: game.state(playerId(c)) });
  });

  // The viewing steps of the Judge tour (TaniBot Log, Village Stats) are reported by the web.
  app.post('/api/judge/step', async (c) => {
    const step = (await body(c)).step;
    if (step !== 'tanibot' && step !== 'village') throw new GameError('Unknown tour step');
    judgeStep(c, step);
    return c.json({ state: game.state(playerId(c)) });
  });

  app.post('/api/checkin', (c) => respond(c, game.checkin(playerId(c))));

  app.post('/api/plant', async (c) => {
    const b = await body(c);
    if (typeof b.seedId !== 'number') throw new GameError('Missing seedId');
    return respond(c, game.plant(playerId(c), plotOf(b), b.seedId));
  });

  app.post('/api/water', async (c) => respond(c, game.water(playerId(c), plotOf(await body(c)))));
  app.post('/api/fertilize', async (c) => respond(c, game.fertilize(playerId(c), plotOf(await body(c)))));
  app.post('/api/clean', async (c) => respond(c, game.cleanAsh(playerId(c), plotOf(await body(c)))));

  // Garden visits (social.ts): the farmer list, a garden (read only), help water one tree per day.
  app.get('/api/farmers', (c) => c.json(social.farmers(playerId(c), c.req.query('q'))));
  app.get('/api/farmers/:name', (c) => c.json(social.visit(playerId(c), c.req.param('name'))));
  app.post('/api/farmers/:name/water', async (c) => {
    const pid = playerId(c);
    const name = c.req.param('name');
    const result = social.help(pid, name, plotOf(await body(c)));
    return c.json({ result, state: game.state(pid), visit: social.visit(pid, name) });
  });
  app.post('/api/farmers/:name/sticker', async (c) => {
    const pid = playerId(c);
    const name = c.req.param('name');
    const result = social.sticker(pid, name, (await body(c)).sticker);
    return c.json({ result, visit: social.visit(pid, name) });
  });
  // Wave back to a visitor (a row of the Village tab "Visitors" list).
  // Add friend + Online (social.ts, docs/PLAN-arena.md 7.11). The ping is tiny on purpose: one
  // indexed UPDATE at most every 20 s, no open connection (the VPS has about 1 GB free).
  app.post('/api/ping', async (c) => c.json(social.ping(playerId(c), (await body(c)).away === true)));
  app.post('/api/friends/:name', (c) => {
    const pid = playerId(c);
    const result = social.addFriend(pid, c.req.param('name'));
    return c.json({ result, state: game.state(pid) });
  });
  app.post('/api/friends/:name/remove', (c) => {
    const pid = playerId(c);
    const result = social.removeFriend(pid, c.req.param('name'));
    return c.json({ result, state: game.state(pid) });
  });
  app.post('/api/visitors/:id/wave', async (c) => {
    const pid = playerId(c);
    const result = social.waveBack(pid, Number(c.req.param('id')), (await body(c)).sticker);
    return c.json({ result, state: game.state(pid) });
  });
  // Arena 1 VS 1 (arena.ts, docs/PLAN-arena.md): the Arena window (opponents = Farmers of Tandur
  // rows with a tree; `q` searches like the farmer list), whether a garden can be challenged
  // (visit panel), and a duel (decided and stored on the server; the web sends only the name).
  app.get('/api/arena', (c) => {
    const pid = playerId(c);
    // v2: `v: 2` and finished turn-based matches next to the v1 duels (old webs ignore them).
    const f = social.farmers(pid, c.req.query('q'));
    // Friends first (also those the farmer list leaves out), then the other farmers.
    const names = new Set(f.friends.map((x) => x.name));
    return c.json({ ...arena.view(pid, [...f.friends, ...f.farmers.filter((x) => !names.has(x.name))]), v: 2, matches: matches.recent(pid) });
  });
  app.get('/api/arena/can/:name', (c) => c.json(arena.canChallenge(playerId(c), c.req.param('name'))));
  app.post('/api/arena/duel', async (c) => {
    const pid = playerId(c);
    const b = await body(c);
    const result = arena.duel(pid, b.opponent, clientIp(c), b.deviceId);
    return c.json({ ...result, arena: arena.view(pid, social.farmers(pid).farmers), state: game.state(pid) });
  });
  // Arena v2 (arena-match.ts): Rock / Paper / Scissors turns against the other garden's TaniBot.
  // The computer's pick is locked on the server and never sent before the player's pick.
  app.post('/api/arena/match', async (c) => {
    const pid = playerId(c);
    const b = await body(c);
    const r = matches.start(pid, b.opponent, clientIp(c), b.deviceId);
    return c.json({ ...r, state: game.state(pid) });
  });
  app.get('/api/arena/match/:id', (c) => {
    const pid = playerId(c);
    const r = matches.get(pid, Number(c.req.param('id')));
    // Missed turns may have ended the match during this request: then the game state too.
    return c.json(r.match.status === 'done' ? { ...r, state: game.state(pid) } : r);
  });
  app.post('/api/arena/match/:id/pick', async (c) => {
    const pid = playerId(c);
    const b = await body(c);
    const r = matches.pick(pid, Number(c.req.param('id')), b.turn, b.pick);
    // The game state only when the match is over (prize, XP, duels left).
    return c.json(r.match.status === 'done' ? { ...r, state: game.state(pid) } : r);
  });
  // Red dot: the owner saw the Village tab's Visitors / Invite boxes (up to the newest event shown).
  app.post('/api/village/seen', async (c) => {
    const pid = playerId(c);
    game.villageSeen(pid, (await body(c)).upTo);
    return c.json({ state: game.state(pid) });
  });
  // Red dot: the owner opened the Market (saw the fruit added up to `upTo`).
  app.post('/api/market/seen', async (c) => {
    const pid = playerId(c);
    game.marketSeen(pid, (await body(c)).upTo);
    return c.json({ state: game.state(pid) });
  });
  app.post('/api/harvest', async (c) => {
    const b = await body(c);
    const then = b.then === 'plant' || b.then === 'sell' ? b.then : undefined;
    const result = game.harvest(playerId(c), plotOf(b), then);
    judgeStep(c, 'harvest');
    // A TaniBot waiting for the player's first harvest starts working now.
    tanibot.release(playerId(c));
    return respond(c, result);
  });
  app.post('/api/seeds/sell', async (c) => respond(c, game.sellSeeds(playerId(c), (await body(c)).seedIds)));
  app.post('/api/seeds/discard', async (c) => respond(c, game.discardSeeds(playerId(c), (await body(c)).seedIds)));
  app.post('/api/chop', async (c) => respond(c, game.chop(playerId(c), plotOf(await body(c)))));

  app.post('/api/sell', async (c) => {
    const b = await body(c);
    const expectedPrice = typeof b.expectedPrice === 'number' ? b.expectedPrice : undefined;
    const result = game.sell(playerId(c), b.species as Species, b.quality as Quality, Number(b.qty ?? 1), expectedPrice);
    judgeStep(c, 'sell');
    return respond(c, result);
  });

  app.post('/api/shop/buy', async (c) => {
    const b = await body(c);
    const sb = b.signedBurn as Record<string, unknown> | undefined;
    const signed: SignedBurn | undefined =
      sb && typeof sb === 'object' && ['publicKey', 'nonce', 'maxBlockHeight', 'signature'].every((k) => typeof sb[k] === 'string')
        ? (sb as unknown as SignedBurn)
        : undefined;
    const result = game.buy(playerId(c), b.item as ShopItem, Number(b.qty ?? 1), signed);
    judgeStep(c, 'shop');
    return respond(c, result);
  });

  return app;
}
