import { randomBytes } from 'node:crypto';
import type { JWTVerifyGetKey } from 'jose';
import { createApp } from '../src/app.ts';
import { FakeChain } from '../src/chain/fake.ts';
import { ChainWorker } from '../src/chain/worker.ts';
import { openDb } from '../src/db.ts';
import { Game } from '../src/game.ts';

/** 2026-11-07 01:00 UTC (08:00 WIB), one hour after the village day began. */
export const START = Date.UTC(2026, 10, 7, 1, 0, 0);
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function makeWorld(opts: { random?: number; demo?: boolean; googleClientId?: string; googleKeys?: JWTVerifyGetKey; devLogin?: boolean } = {}) {
  const db = openDb(':memory:');
  const chain = new FakeChain();
  const clock = { t: START };
  /** Value returned by the game's random(); tests may change it between actions. */
  const rng = { value: opts.random ?? 0.5 };
  const now = () => clock.t;
  const masterKey = randomBytes(32).toString('base64');
  const game = new Game({
    db,
    now,
    random: () => rng.value,
    masterKey,
    accountSuffix: 'nearvest.testnet',
    explorerTxUrl: 'https://testnet.nearblocks.io/txns/',
    demoModeDefault: opts.demo ?? false,
  });
  const worker = new ChainWorker({
    db,
    chain,
    masterKey,
    now,
    treeSnapshot: (id) => game.treeSnapshot(id),
    onSeasonDivisor: (d) => (game.seasonDivisor = d),
  });
  const app = createApp({
    db,
    game,
    chain,
    now,
    googleKeys: opts.googleKeys,
    config: {
      devLogin: opts.devLogin ?? true,
      googleClientId: opts.googleClientId ?? '',
      webOrigins: ['http://localhost:5173'],
      panenContractId: 'panen.nearvest.testnet',
      pohonContractId: 'pohon.nearvest.testnet',
      networkId: 'testnet',
      factoryAccountId: 'nearvest.testnet',
    },
  });
  const advance = (ms: number) => {
    clock.t += ms;
  };
  let users = 0;
  const newPlayer = (name: string, ip = '10.0.0.1') => {
    const userId = Number(
      db.prepare('INSERT INTO users (provider, subject, created_at) VALUES (?, ?, ?)').run('dev', `${name}-${++users}`, now())
        .lastInsertRowid,
    );
    return game.createPlayer(userId, name, ip);
  };
  return { db, chain, game, worker, app, clock, now, advance, masterKey, newPlayer, rng };
}

export const UNIT = 10n ** 18n;
