// One-time repair: makes the Tree NFTs on chain match the game database.
//
// It reads every tree from the database and every token from the Tree NFT contract (view calls,
// free) and lists the trees whose stage, age or harvest count differ. Without `--apply` it only
// prints the list, the number of transactions and the estimated cost: nothing is written.
//
// With `--apply` it adds one `update_tree` job per living tree to the chain job queue; the running
// game server (the only signer, game.nearvest.testnet) sends them in order with the tree's data
// of that moment. This script never signs anything and needs no key.
//
// What it cannot repair: a Memorial Tree. The contract refuses every update of a Memorial Tree
// ("Memorial trees cannot be updated"), so those are only counted.
//
// Usage (in server/, the same Node as the server):
//   node scripts/repair-nft.ts [--db PATH] [--rpc URL] [--contract ID] [--stage-only] [--apply]
//   defaults: --db $DATABASE_PATH (./data/nearvest.sqlite), --rpc $NEAR_RPC_URL
//   (https://test.rpc.fastnear.com), --contract $POHON_CONTRACT_ID (pohon.nearvest.testnet)
//   --stage-only: skip trees where only the age differs (a demo garden's age changes every minute)
// Ask Ardian before running it with --apply on the live database.

import { DatabaseSync } from 'node:sqlite';
import { dayLengthMs } from '../src/clock.ts';

// Measured on testnet 2026-11-13: one update_tree burns about 2.4 Tgas = about 0.00022 NEAR.
// The estimate below rounds that up.
const NEAR_PER_TX = 0.0003;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
const has = (name: string) => process.argv.includes(name);

const dbPath = arg('--db') ?? process.env.DATABASE_PATH ?? './data/nearvest.sqlite';
const rpcUrl = arg('--rpc') ?? process.env.NEAR_RPC_URL ?? 'https://test.rpc.fastnear.com';
const contractId = arg('--contract') ?? process.env.POHON_CONTRACT_ID ?? 'pohon.nearvest.testnet';
const apply = has('--apply');
const stageOnly = has('--stage-only');

async function view(method: string, args: unknown): Promise<any> {
  const res = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'query',
      params: {
        request_type: 'call_function',
        finality: 'final',
        account_id: contractId,
        method_name: method,
        args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
      },
    }),
  });
  const json = (await res.json()) as any;
  if (!json.result?.result) throw new Error(`${method} failed: ${JSON.stringify(json.error ?? json.result)}`);
  return JSON.parse(Buffer.from(json.result.result).toString('utf8'));
}

interface ChainTree {
  owner: string;
  stage: string;
  age_days: number;
  harvest_count: number;
  memorial: boolean;
}

interface DbTree {
  id: number;
  player_id: number;
  species: string;
  quality: string;
  status: string;
  token_id: string | null;
  planted_at: number;
  died_at: number | null;
  harvest_count: number;
  synced_stage: string | null;
  account_id: string;
  demo: number;
}

async function chainTrees(): Promise<Map<string, ChainTree>> {
  const trees = new Map<string, ChainTree>();
  for (let from = 0; ; from += 50) {
    const page = await view('nft_tokens', { from_index: String(from), limit: 50 });
    for (const t of page) trees.set(t.token_id, { owner: t.owner_id, ...JSON.parse(t.metadata.extra) });
    if (page.length < 50) return trees;
  }
}

const db = new DatabaseSync(dbPath, { readOnly: !apply });
db.exec('PRAGMA busy_timeout = 5000');
const now = Date.now();
const rows = db
  .prepare(
    `SELECT t.id, t.player_id, t.species, t.quality, t.status, t.token_id, t.planted_at, t.died_at,
            t.harvest_count, t.synced_stage, p.account_id, p.demo
     FROM trees t JOIN players p ON p.id = t.player_id ORDER BY t.id`,
  )
  .all() as unknown as DbTree[];
const pending = new Set(
  db
    .prepare("SELECT payload FROM chain_jobs WHERE status = 'pending' AND kind IN ('mint_tree', 'update_tree', 'make_memorial')")
    .all()
    .map((j) => JSON.parse(String(j.payload)).treeId as number),
);
const chain = await chainTrees();

const fix: { tree: DbTree; line: string }[] = []; // living trees to update
const memorials: string[] = []; // differ, but the contract refuses updates
const odd: string[] = []; // need a human look
let same = 0;
let waiting = 0;

for (const t of rows) {
  const name = `tree ${t.id} (NFT #${t.token_id ?? '-'}, ${t.quality} ${t.species}, ${t.account_id})`;
  if (pending.has(t.id)) {
    waiting++; // a job for this tree is already in the queue
    continue;
  }
  if (!t.token_id) {
    odd.push(`${name}: no NFT and no mint job waiting`);
    continue;
  }
  const c = chain.get(String(t.token_id));
  if (!c) {
    odd.push(`${name}: token not found on chain`);
    continue;
  }
  const dayMs = dayLengthMs(t.demo === 1);
  const dead = t.status === 'dead';
  const age = Math.max(0, Math.floor(((dead ? (t.died_at ?? now) : now) - t.planted_at) / dayMs));
  const diff: string[] = [];
  if (!dead && c.stage !== t.synced_stage) diff.push(`stage ${c.stage} -> ${t.synced_stage}`);
  if (c.harvest_count !== t.harvest_count) diff.push(`harvests ${c.harvest_count} -> ${t.harvest_count}`);
  if (c.age_days !== age && !(stageOnly && !dead)) diff.push(`age ${c.age_days} -> ${age}`);
  if (dead !== c.memorial) {
    odd.push(`${name}: ${dead ? 'dead in the game but not a Memorial on chain' : 'alive in the game but a Memorial on chain'}`);
    continue;
  }
  if (diff.length === 0) {
    same++;
    continue;
  }
  if (dead) {
    memorials.push(`${name}: ${diff.join(', ')}`);
    continue;
  }
  // The contract refuses an age or harvest count that goes down.
  if (c.age_days > age || c.harvest_count > t.harvest_count) {
    odd.push(`${name}: the chain is ahead of the game (${diff.join(', ')})`);
    continue;
  }
  fix.push({ tree: t, line: `${name}: ${diff.join(', ')}` });
}

console.log(`Database: ${dbPath} (${rows.length} trees). Contract: ${contractId} (${chain.size} NFTs).`);
console.log(`Same on chain and in the game: ${same}. A job already waiting: ${waiting}.`);
console.log(`\nLiving trees to update (${fix.length}):`);
for (const f of fix) console.log(`  ${f.line}`);
console.log(`\nMemorial Trees that differ and cannot be updated (${memorials.length}):`);
for (const m of memorials) console.log(`  ${m}`);
console.log(`\nNeed a look (${odd.length}):`);
for (const o of odd) console.log(`  ${o}`);
console.log(
  `\nTransactions: ${fix.length} update_tree from the game account. Estimated cost: about ${(fix.length * NEAR_PER_TX).toFixed(4)} testnet NEAR (about ${NEAR_PER_TX} each).`,
);

if (!apply) {
  console.log('Dry run: nothing was written. Add --apply to queue these updates (ask Ardian first).');
} else {
  const insert = db.prepare('INSERT INTO chain_jobs (player_id, kind, payload, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const f of fix) {
      // Same shape as enqueueTreeUpdate in src/chain/worker.ts.
      insert.run(f.tree.player_id, 'update_tree', JSON.stringify({ kind: 'update_tree', treeId: f.tree.id }), now, now);
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  console.log(`Queued ${fix.length} update_tree jobs. The game server sends them one by one (see its log).`);
}
db.close();
