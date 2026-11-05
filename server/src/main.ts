// Entry point: wires config, database, chain, game, worker and HTTP server.

import { serve } from '@hono/node-server';
import { createApp } from './app.ts';
import { FakeChain } from './chain/fake.ts';
import { NearChain } from './chain/near.ts';
import type { Chain } from './chain/types.ts';
import { ChainWorker } from './chain/worker.ts';
import { systemNow } from './clock.ts';
import { loadConfig } from './config.ts';
import { openDb } from './db.ts';
import { Game } from './game.ts';

const config = loadConfig();
const db = openDb(config.databasePath);

const chain: Chain =
  config.chainMode === 'near'
    ? new NearChain({
        rpcUrl: config.rpcUrl,
        factoryAccountId: config.factoryAccountId,
        gameAccountId: config.gameAccountId,
        gamePrivateKey: config.gamePrivateKey,
        panenContractId: config.panenContractId,
        pohonContractId: config.pohonContractId,
        playerAccountDepositNear: config.playerAccountDepositNear,
      })
    : new FakeChain();

const game = new Game({
  db,
  now: systemNow,
  random: Math.random,
  masterKey: config.masterKey,
  accountSuffix: config.factoryAccountId,
  explorerTxUrl: config.explorerTxUrl,
  demoModeDefault: config.demoModeDefault,
});

const worker = new ChainWorker({
  db,
  chain,
  masterKey: config.masterKey,
  now: systemNow,
  treeSnapshot: (id) => game.treeSnapshot(id),
  onSeasonDivisor: (d) => (game.seasonDivisor = d),
  log: (msg) => console.log(`[chain] ${msg}`),
});

try {
  game.seasonDivisor = (await chain.villageStats()).rewardDivisor;
} catch (err) {
  console.warn('Could not read the Season from the chain yet:', err instanceof Error ? err.message : err);
}

worker.start();
// Sync tree stages to the NFTs every 20 seconds.
setInterval(() => game.syncStages(), 20_000);

const app = createApp({ db, game, chain, config, now: systemNow });
serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`NEARvest server on http://127.0.0.1:${info.port} (chain: ${config.chainMode}, dev login: ${config.devLogin})`);
});
