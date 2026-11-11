// Arena v2 duel in WebKit (iPhone Safari's engine, iPhone profile at 390 px) or Chromium, played live
// (no frozen clock): after every hit, Gold Durian and the K.O. both TaniBots must be back to their own
// colours (no white flash class, no white filter, no flash animation left), and the short white
// flash must have been seen during the hits. Screenshot after every turn. Exit code 1 = TaniBot stuck white.
// Needs a fake-chain server on :8788 (DEV_LOGIN=true), the web on UI_URL (default
// http://127.0.0.1:5174/play), FAKE_DB=<that server's sqlite> and Playwright (not a repo dependency:
// PLAYWRIGHT=<path to a playwright package>, browsers installed with `npx playwright install webkit`).
//   FAKE_DB=... PLAYWRIGHT=... node tools/duel-webkit.mjs webkit <outDir> <me> <foe> 390 844
//   (ME_XP / FOE_XP set the TaniBots' titles; engine `chromium` for the same check in Chrome's engine.)
import { DatabaseSync } from 'node:sqlite';
const { webkit, chromium, devices } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const [,, engine = 'webkit', out = '.', me = 'wk1', foe = 'wk1f', W = '390', H = '844'] = process.argv;
const API = 'http://127.0.0.1:8788', UI = process.env.UI_URL ?? 'http://127.0.0.1:5174/play';
const db = new DatabaseSync(process.env.FAKE_DB, { timeout: 10000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (m, p, t, b) => (await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) })).json();
const make = async (u) => {
  const { token } = await call('POST', '/auth/dev', null, { username: u });
  let st = await call('GET', '/api/me', token);
  if (st.error) st = await call('POST', '/api/player', token, { name: u, demo: true });
  if (!st.player) throw new Error(`cannot make ${u}: ${JSON.stringify(st)}`);
  for (let i = 0; i < 40 && st.player.accountStatus !== 'ready'; i++) { await sleep(300); st = await call('GET', '/api/me', token); }
  if (!st.plots[0].tree) { await call('POST', '/api/checkin', token); st = await call('GET', '/api/me', token); await call('POST', '/api/plant', token, { plot: 0, seedId: (st.seeds.find((x) => x.species === 'mango') ?? st.seeds[0]).id }); }
  await call('POST', '/api/water', token, { plot: 0 });
  return token;
};
await make(me); await make(foe);
if (process.env.ME_XP) db.prepare('UPDATE players SET xp = ? WHERE name = ?').run(Number(process.env.ME_XP), me);
if (process.env.FOE_XP) db.prepare('UPDATE players SET xp = ? WHERE name = ?').run(Number(process.env.FOE_XP), foe);
const openMatch = () => db.prepare("SELECT m.id, m.skill_c, m.skill_d FROM arena_matches m JOIN players p ON p.id = m.challenger_id WHERE p.name = ? AND m.status = 'playing' ORDER BY m.id DESC LIMIT 1").get(me);
const lock = (pick) => { const m = openMatch(); if (m) db.prepare('UPDATE arena_matches SET bot_pick = ? WHERE id = ?').run(pick, m.id); };
// chromium = the installed Google Chrome (like tools/ui-test.mjs), no extra browser download.
const browser = engine === 'webkit' ? await webkit.launch() : await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const ctx = await browser.newContext(engine === 'webkit' && W === '390' ? { ...devices['iPhone 15 Pro'], viewport: { width: +W, height: +H } } : { viewport: { width: +W, height: +H } });
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(UI);
await page.waitForSelector('#dev-user');
await page.fill('#dev-user', me);
await page.getByText('Enter', { exact: true }).click();
await page.waitForSelector('.plots');
await sleep(2500);
await page.evaluate(() => document.querySelectorAll('.dialog-backdrop .info-close').forEach((b) => b.click()));
const skip = page.getByText('Skip tutorial'); if (await skip.count()) await skip.first().click();
await sleep(600);
await page.evaluate(() => document.querySelectorAll('.dialog-backdrop .info-close').forEach((b) => b.click()));
await page.evaluate(() => document.querySelector('.pin-arena').click());
await sleep(400);
if (await page.$('.hs-bubble')) await page.locator('.hs-bubble button', { hasText: 'Open' }).click();
await page.waitForSelector('.arena-dialog .arena-duel-btn');
await sleep(400);
await page.evaluate((foe) => [...document.querySelectorAll('.arena-list .farmer-row')].find((r) => r.querySelector('.farmer-name').innerText === foe).querySelector('.arena-duel-btn').click(), foe);
await page.waitForSelector('.duel.match', { timeout: 15000 });
await sleep(800);
const look = () => page.evaluate(() => [...document.querySelectorAll('.duel.match .fighter')].map((f) => {
  const art = f.querySelector('.fighter-art'), bot = f.querySelector('.tanibot');
  const fl = getComputedStyle(bot).filter;
  const anims = [f, art, bot].flatMap((e) => e ? e.getAnimations().map((a) => a.animationName + ':' + a.playState) : []);
  const white = /brightness\((?:[2-9]|1\.[5-9])/.test(fl) || /saturate\(0\)/.test(fl) || art.classList.contains('flash') || anims.some((a) => /flash/.test(a));
  return `${f.classList.contains('me') ? 'me' : 'them'}${white ? ' WHITE' : ' ok'} [${f.className}] art=${getComputedStyle(art).filter} bot=${fl} anims=${anims.join(',')}`;
}));
const ready = () => page.evaluate(() => { const b = document.querySelector('.rps-btn'); return !!b && !b.disabled; });
const ended = () => page.evaluate(() => !!document.querySelector('.fight-ko, .duel-result'));
const waitTurn = async () => { for (let i = 0; i < 150; i++) { if (await ended() || await ready()) return; await sleep(100); } };
// Plan: alternate who gets hit; use the Gold Durian once each when full.
const plan = ['rock:scissors', 'rock:paper', 'paper:rock', 'scissors:rock', 'rock:rock', 'scissors:paper', 'paper:scissors', 'rock:scissors', 'paper:scissors', 'rock:scissors', 'rock:scissors', 'rock:scissors', 'rock:scissors', 'rock:scissors', 'rock:scissors', 'rock:scissors'];
let bad = 0, flashSeen = 0;
for (let t = 0; t < plan.length; t++) {
  await waitTurn();
  if (await ended()) break;
  const m = openMatch();
  let [mine, bots] = plan[t].split(':');
  if (m && m.skill_c >= 3) mine = 'gold';
  else if (m && m.skill_d >= 3 && t > 6) bots = 'gold';
  lock(bots);
  if (mine === 'gold') await page.click('.gold-durian-btn');
  else await page.evaluate((p) => [...document.querySelectorAll('.rps-btn')].find((b) => b.innerText.trim().toLowerCase() === p).click(), mine);
  // During the turn: sample every 150 ms; after it, check the rest state.
  const samples = [];
  for (let i = 0; i < 120; i++) { await sleep(50); const l = (await look()).join(' || '); if (/WHITE/.test(l)) flashSeen++; samples.push(l); if (i > 20 && (await ready() || await ended())) break; }
  await sleep(300);
  const after = await look();
  const white = after.filter((l) => / WHITE /.test(l));
  if (white.length) bad++;
  console.log(`turn ${t + 1} ${mine} vs ${bots}: ${white.length ? 'WHITE STUCK' : 'ok'}\n  ${after.join('\n  ')}`);
  if (process.env.VERBOSE) console.log(samples.filter((s, i) => s !== samples[i - 1]).join('\n'));
  await page.screenshot({ path: `${out}/${engine}-${W}-turn${t + 1}-${mine}.png` });
}
await sleep(2500);
const end = await look();
if (end.some((l) => / WHITE /.test(l))) bad++;
console.log('end:', end.join('\n  '));
await page.screenshot({ path: `${out}/${engine}-${W}-end.png` });
console.log(`${engine} ${W}x${H}: white flash seen in ${flashSeen} samples during the hits; TaniBot stuck white after a turn / at the end: ${bad}`);
await browser.close();
db.close();
process.exit(bad ? 1 : 0);
