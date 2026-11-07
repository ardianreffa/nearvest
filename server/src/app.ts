// HTTP API (JSON). The web game on Vercel calls these routes.

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { devIdentity, login, logout, openSession, userFromToken, verifyGoogleCredential } from './auth.ts';
import type { JWTVerifyGetKey } from 'jose';
import { DEFAULT_BOT_BUDGET, DEFAULT_BOT_DAILY_LIMIT, MAX_BOT_DAILY_LIMIT, type TaniBotService } from './tanibot.ts';
import type { Chain } from './chain/types.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { Game, GameError, type SignedBurn } from './game.ts';
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
  /** Google's signing keys; tests pass a fake key set. Default: Google's live keys. */
  googleKeys?: JWTVerifyGetKey;
}

type Env = { Variables: { userId: number } };

const STATS_CACHE_MS = 15_000;
/** Wallet players' balances are re-read from the chain at most this often. */
const WALLET_SYNC_MS = 30_000;

export function createApp(deps: AppDeps) {
  const { db, game, chain, config, now, tanibot } = deps;
  const app = new Hono<Env>();

  app.use('*', cors({ origin: config.webOrigins, allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST'] }));

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
    const { name, demo } = await body(c);
    if (typeof name !== 'string') throw new GameError('Missing name');
    const p = game.createPlayer(c.get('userId'), name.trim().toLowerCase(), clientIp(c), typeof demo === 'boolean' ? demo : undefined);
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

  app.post('/api/checkin', (c) => respond(c, game.checkin(playerId(c))));

  app.post('/api/plant', async (c) => {
    const b = await body(c);
    if (typeof b.seedId !== 'number') throw new GameError('Missing seedId');
    return respond(c, game.plant(playerId(c), plotOf(b), b.seedId));
  });

  app.post('/api/water', async (c) => respond(c, game.water(playerId(c), plotOf(await body(c)))));
  app.post('/api/fertilize', async (c) => respond(c, game.fertilize(playerId(c), plotOf(await body(c)))));
  app.post('/api/harvest', async (c) => {
    const b = await body(c);
    const then = b.then === 'plant' || b.then === 'sell' ? b.then : undefined;
    return respond(c, game.harvest(playerId(c), plotOf(b), then));
  });
  app.post('/api/seeds/sell', async (c) => respond(c, game.sellSeeds(playerId(c), (await body(c)).seedIds)));
  app.post('/api/seeds/discard', async (c) => respond(c, game.discardSeeds(playerId(c), (await body(c)).seedIds)));
  app.post('/api/chop', async (c) => respond(c, game.chop(playerId(c), plotOf(await body(c)))));

  app.post('/api/sell', async (c) => {
    const b = await body(c);
    const expectedPrice = typeof b.expectedPrice === 'number' ? b.expectedPrice : undefined;
    return respond(c, game.sell(playerId(c), b.species as Species, b.quality as Quality, Number(b.qty ?? 1), expectedPrice));
  });

  app.post('/api/shop/buy', async (c) => {
    const b = await body(c);
    const sb = b.signedBurn as Record<string, unknown> | undefined;
    const signed: SignedBurn | undefined =
      sb && typeof sb === 'object' && ['publicKey', 'nonce', 'maxBlockHeight', 'signature'].every((k) => typeof sb[k] === 'string')
        ? (sb as unknown as SignedBurn)
        : undefined;
    return respond(c, game.buy(playerId(c), b.item as ShopItem, Number(b.qty ?? 1), signed));
  });

  return app;
}
