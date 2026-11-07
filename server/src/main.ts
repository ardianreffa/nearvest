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
import { TaniBotService } from './tanibot.ts';
import { JudgeService } from './judge.ts';
import { AiMeter, NearAiBrain } from './brain.ts';

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
  panenContractId: config.panenContractId,
});

const worker = new ChainWorker({
  db,
  chain,
  masterKey: config.masterKey,
  panenContractId: config.panenContractId,
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

// TaniBot's AI brain only when TANIBOT_AI=on (credits are limited: call limit + dollar brake).
const meter = new AiMeter(db, { maxCallsPerDay: config.tanibotAiMaxCallsPerDay, budgetUsd: config.tanibotAiBudgetUsd }, (m) => console.log(m));
const brain = config.tanibotAi ? new NearAiBrain({ apiKey: config.nearAiApiKey, model: config.tanibotAiModel }) : null;
{
  const t = meter.totals(systemNow());
  console.log(
    `[ai] TaniBot brain: ${brain ? `NEAR AI (${brain.model}), max ${config.tanibotAiMaxCallsPerDay} calls/day, brake US$${config.tanibotAiBudgetUsd}` : 'simple rules (TANIBOT_AI=off)'}` +
      ` | used so far: ${t.callsTotal} calls, US$${t.costTotal.toFixed(6)} (today ${t.callsToday} calls)`,
  );
}

const tanibot = new TaniBotService({
  brain,
  meter,
  db,
  game,
  chain,
  now: systemNow,
  masterKey: config.masterKey,
  factoryAccountId: config.factoryAccountId,
  panenContractId: config.panenContractId,
  explorerTxUrl: config.explorerTxUrl,
});

worker.start();
// TaniBot: every 5 seconds, run the bots that are due (3x/day; demo every 2 minutes)
// and, in demo gardens, react to newly ripe or dry trees within about 10 seconds.
let ticking = false;
setInterval(() => {
  if (ticking) return; // an AI round can take a few seconds
  ticking = true;
  tanibot
    .tick()
    .catch((err) => console.warn('TaniBot tick failed:', err instanceof Error ? err.message : err))
    .finally(() => (ticking = false));
}, 5_000);
// Sync tree stages to the NFTs every 20 seconds.
setInterval(() => game.syncStages(), 20_000);

const judge = new JudgeService(db, game, tanibot, systemNow);
const app = createApp({ db, game, chain, config, now: systemNow, tanibot, judge });
serve({ fetch: app.fetch, port: config.port, hostname: '127.0.0.1' }, (info) => {
  console.log(`NEARvest server on http://127.0.0.1:${info.port} (chain: ${config.chainMode}, dev login: ${config.devLogin})`);
});
