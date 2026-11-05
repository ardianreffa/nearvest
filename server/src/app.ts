// HTTP API (JSON). The web game on Vercel calls these routes.

import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { devIdentity, login, logout, userFromToken, verifyGoogleCredential } from './auth.ts';
import type { Chain } from './chain/types.ts';
import type { Config } from './config.ts';
import type { DB } from './db.ts';
import { Game, GameError } from './game.ts';
import { SHOP_ITEMS, SPECIES, type Quality, type ShopItem, type Species } from './rules.ts';

export interface AppDeps {
  db: DB;
  game: Game;
  chain: Chain;
  config: Pick<Config, 'devLogin' | 'googleClientId' | 'webOrigins' | 'panenContractId' | 'pohonContractId' | 'networkId'>;
  now: () => number;
}

type Env = { Variables: { userId: number } };

const STATS_CACHE_MS = 15_000;

export function createApp(deps: AppDeps) {
  const { db, game, chain, config, now } = deps;
  const app = new Hono<Env>();

  app.use('*', cors({ origin: config.webOrigins, allowHeaders: ['Content-Type', 'Authorization'], allowMethods: ['GET', 'POST'] }));

  app.onError((err, c) => {
    if (err instanceof GameError) return c.json({ error: err.message }, err.status as 400);
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
      googleClientId: config.googleClientId || null,
      devLogin: config.devLogin,
      contracts: { panen: config.panenContractId, pohon: config.pohonContractId },
      shop: SHOP_ITEMS,
      species: SPECIES,
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
    const identity = await verifyGoogleCredential(credential, config.googleClientId);
    const { token, userId } = login(db, identity, now());
    return c.json({ token, player: game.getPlayerByUser(userId) ? game.state(game.getPlayerByUser(userId)!.id) : null });
  });

  app.post('/auth/dev', async (c) => {
    if (!config.devLogin) throw new GameError('Dev login is disabled', 404);
    const { username } = await body(c);
    if (typeof username !== 'string') throw new GameError('Missing username');
    const { token, userId } = login(db, devIdentity(username), now());
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

  app.post('/api/player', async (c) => {
    const { name, demo } = await body(c);
    if (typeof name !== 'string') throw new GameError('Missing name');
    const p = game.createPlayer(c.get('userId'), name.trim().toLowerCase(), clientIp(c), typeof demo === 'boolean' ? demo : undefined);
    return c.json(game.state(p.id), 201);
  });

  app.get('/api/me', (c) => c.json(game.state(playerId(c))));

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
  app.post('/api/harvest', async (c) => respond(c, game.harvest(playerId(c), plotOf(await body(c)))));
  app.post('/api/chop', async (c) => respond(c, game.chop(playerId(c), plotOf(await body(c)))));

  app.post('/api/sell', async (c) => {
    const b = await body(c);
    return respond(c, game.sell(playerId(c), b.species as Species, b.quality as Quality, Number(b.qty ?? 1)));
  });

  app.post('/api/shop/buy', async (c) => {
    const b = await body(c);
    return respond(c, game.buy(playerId(c), b.item as ShopItem, Number(b.qty ?? 1)));
  });

  return app;
}
