// End-to-end test against a running server (CHAIN_MODE=near, DEV_LOGIN=true):
// new dev player -> check-in -> plant -> water -> harvest -> sell -> shop,
// then waits until every transaction has landed and prints explorer links.
//
// Usage: node scripts/e2e.ts [baseUrl] [playerName]

const base = process.argv[2] ?? 'http://127.0.0.1:8787';
const name = process.argv[3] ?? `farmer-${Math.floor(Math.random() * 9000 + 1000)}`;
let token = '';

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${json.error}`);
  return json;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const step = (msg: string) => console.log(`\n== ${msg}`);

async function waitFor(what: string, check: (s: any) => boolean, timeoutMs = 240_000): Promise<any> {
  const start = Date.now();
  for (;;) {
    const s = await api('GET', '/api/me');
    if (check(s)) return s;
    if (s.activity.some((a: any) => a.status === 'failed')) {
      throw new Error(`A transaction failed: ${JSON.stringify(s.activity.filter((a: any) => a.status === 'failed'))}`);
    }
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await sleep(2000);
  }
}

step(`Dev login and new garden "${name}" (demo mode: 1 day = 1 minute)`);
token = (await api('POST', '/auth/dev', { username: `e2e-${name}` })).token;
let s = await api('POST', '/api/player', { name, demo: true });
console.log(`account ${s.player.accountId}, balance ${s.player.balance} PANEN, seeds: ${s.seeds.map((x: any) => `${x.quality ?? '?'} ${x.species}`).join(', ')}`);
s = await waitFor('account creation', (x) => x.player.accountStatus === 'ready');
console.log('NEAR account created on testnet');

step('Check-in');
s = (await api('POST', '/api/checkin')).state;
console.log(`balance ${s.player.balance} PANEN, streak ${s.checkin.streak}`);

step('Plant a mango seed on plot 0');
const mango = s.seeds.find((x: any) => x.species === 'mango');
const planted = await api('POST', '/api/plant', { plot: 0, seedId: mango.id });
console.log(`planted ${planted.result.quality} ${planted.result.species}`);

step('Water it');
s = (await api('POST', '/api/water', { plot: 0 })).state;
console.log(`ready in about ${Math.ceil(s.plots[0].tree.msToReady / 1000)} s`);

step('Wait until it is ready to harvest (NFT minted meanwhile)');
s = await waitFor('ripe fruit', (x) => x.plots[0].tree?.ready && x.plots[0].tree?.tokenId);
console.log(`tree NFT #${s.plots[0].tree.tokenId} is ${s.plots[0].tree.stage}`);

step('Harvest');
const h = await api('POST', '/api/harvest', { plot: 0 });
console.log(`got ${h.result.qty} ${h.result.quality} ${h.result.species}, +${h.result.xp} XP`);

step('Sell to Mr. Darto');
const sold = await api('POST', '/api/sell', { species: h.result.species, quality: h.result.quality, qty: 1 });
console.log(`price ${sold.result.price}, expected ${sold.result.expectedPanen} PANEN (Season divisor ${sold.result.seasonDivisor})`);
console.log(`Mr. Darto says: "${sold.state.darto.greeting}"`);

step('Buy fertilizer in the Shop (burns 8 PANEN)');
s = (await api('POST', '/api/shop/buy', { item: 'fertilizer', qty: 1 })).state;
console.log(`balance ${s.player.balance} PANEN`);

step('Wait for every transaction to land');
s = await waitFor('all transactions', (x) => x.activity.every((a: any) => a.status === 'done'));
for (const a of [...s.activity].reverse()) console.log(`${a.kind.padEnd(15)} ${a.status}  ${a.explorerUrl ?? a.txHash}`);

step('Village Stats');
console.log(JSON.stringify(await api('GET', '/api/stats'), null, 2));
console.log(`\nE2E OK for ${s.player.accountId}. Local balance: ${s.player.balance} PANEN`);
