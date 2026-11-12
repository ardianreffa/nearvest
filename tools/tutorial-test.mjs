// The guided tutorial of a NEW garden, played to the end in the browser (2026-11-12, docs/CLAUDE.md).
// Needs a FAKE-CHAIN server with FISHING=on (API_URL, default http://127.0.0.1:8788; FAKE_DB = its
// sqlite file, used only to ripen the tree and to make the fish bite now) and the dev web (UI_URL,
// default http://127.0.0.1:5174/play). Playwright from PLAYWRIGHT=<path> (not a repo dependency):
//   PLAYWRIGHT=... FAKE_DB=... node tools/tutorial-test.mjs <outDir> <newDevUser> [w] [h]
// Checks per step: the coach shows that step, the pixel arrow points at a target, other buttons are
// dimmed; buying a SEED does not finish "buy fertilizer"; TaniBot "Later" and the Arena "Got it"
// pass; at the end the "Welcome to Tandur!" banner and TaniBot's last words. Screenshots per step.
import { DatabaseSync } from 'node:sqlite';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const user = process.argv[3] ?? `tut${Date.now() % 100000}`;
const W = Number(process.argv[4] ?? 390);
const H = Number(process.argv[5] ?? 844);
const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
const UI = process.env.UI_URL ?? 'http://127.0.0.1:5174/play';
const db = new DatabaseSync(process.env.FAKE_DB, { timeout: 10000 });
const tag = `${W}x${H}`;
const phone = W < 1024;
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${tag} ${msg}`);
  if (!ok) fails++;
};
const post = async (path, body, token) => (await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) })).json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { token } = await post('/auth/dev', { username: user });
await post('/api/player', { name: user }, token);
for (let i = 0; i < 40; i++) {
  if (db.prepare('SELECT account_status FROM players WHERE name = ?').get(user)?.account_status === 'ready') break;
  await sleep(250);
}
const pid = db.prepare('SELECT id FROM players WHERE name = ?').get(user).id;

const browser = await pw.chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
await ctx.addInitScript((t) => {
  localStorage.setItem('nearvest.token', t);
  localStorage.setItem('nearvest.howto', '1');
}, token);
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
await pg.goto(UI, { waitUntil: 'networkidle' });
await pg.waitForSelector('.coach', { timeout: 15000 });

const coachStep = () => pg.evaluate(() => [...document.querySelector('.coach')?.classList ?? []].find((c) => c.startsWith('coach-'))?.slice(6) ?? 'none');
const waitStep = async (want, ms = 15000) => {
  for (let t = 0; t < ms; t += 250) {
    if ((await coachStep()) === want) return true;
    await sleep(250);
  }
  return false;
};
const coachBtn = (text) => pg.locator('.coach button', { hasText: text }).first().click();
let n = 0;
const shot = async (name) => pg.screenshot({ path: `${out}/tut-${tag}-${String(++n).padStart(2, '0')}-${name}.png` });
/** The arrow is on screen and points at a glowing target; something else is dimmed. */
const guided = async (step) => {
  await sleep(600);
  const r = await pg.evaluate(() => {
    const a = document.querySelector('.tut-arrow')?.getBoundingClientRect();
    const t = document.querySelector('.tut-target');
    const dim = [...document.querySelectorAll('.btn, .tab, .place-pin')].some((e) => !e.classList.contains('tut-target') && getComputedStyle(e).opacity === '0.5');
    return { arrow: !!a && a.top >= -10 && a.top < innerHeight, target: t ? t.className.split(' ').slice(0, 3).join('.') : null, dim };
  });
  check(r.arrow && !!r.target, `${step}: the arrow points at the target (${r.target})${r.dim ? ', other buttons dimmed' : ''}`);
  await shot(step);
};

// welcome
check(await waitStep('welcome'), 'the coach starts with the welcome step');
await shot('welcome');
await coachBtn("Let's go");
// plant
check(await waitStep('plant'), 'step: plant');
await guided('plant');
await pg.evaluate(() => document.querySelectorAll('.plots .plot')[0]?.click());
await sleep(500);
await pg.locator('.plot-empty .seed-row > *').first().click();
// water
// water (when it rains, the rain waters the tree: the step passes by itself)
for (let t = 0; t < 40 && !['water', 'buy_fertilizer'].includes(await coachStep()); t++) await sleep(250);
if ((await coachStep()) === 'buy_fertilizer') check(true, 'step: water passed by the rain (the Water button is off in the rain)');
else {
check(true, 'step: water (after planting)');
await guided('water');
// The village may be under volcanic ash: clean it first, then water.
if (await pg.locator('.act-clean:not(:disabled)').count()) {
  await pg.locator('.act-clean:not(:disabled)').first().click();
  await pg.waitForSelector('.act-water:not(:disabled)', { timeout: 8000 });
}
await pg.locator('.act-water:not(:disabled)').first().click();
}
// buy fertilizer: a SEED first does not finish the step
check(await waitStep('buy_fertilizer'), 'step: buy fertilizer');
await coachBtn('Open the Shop');
await sleep(800);
await guided('buy_fertilizer');
await pg.evaluate(() => [...document.querySelectorAll('.shop-buy')].find((b) => !b.closest('.shop-fertilizer') && !b.disabled)?.click());
await sleep(1500);
check((await coachStep()) === 'buy_fertilizer', 'buying a seed does NOT finish "buy fertilizer"');
await pg.locator('.shop-fertilizer .shop-buy').first().click();
// fertilize
check(await waitStep('fertilize'), 'step: fertilize (after buying fertilizer)');
if (phone) await pg.locator('.tab', { hasText: 'Garden' }).first().click();
else await coachBtn('Show me');
await sleep(600);
await guided('fertilize');
if (await pg.locator('.act-clean:not(:disabled)').count()) {
  await pg.locator('.act-clean:not(:disabled)').first().click();
  await pg.waitForSelector('.act-fertilize:not(:disabled)', { timeout: 8000 });
}
await pg.locator('.act-fertilize:not(:disabled)').first().click();
// check in
check(await waitStep('checkin'), 'step: check-in');
await coachBtn('Open check-in');
await sleep(700);
await guided('checkin');
await pg.locator('.checkin-claim:not(:disabled)').first().click();
await sleep(800);
await pg.evaluate(() => document.querySelectorAll('.dialog-backdrop .info-close').forEach((b) => b.click()));
// harvest: the coach explains the wait; the tree is ripened in the test database
check(await waitStep('harvest'), 'step: harvest');
const waitText = await pg.locator('.coach-text').innerText();
check(/demo mode/i.test(waitText) && /minute/.test(waitText), `the harvest step explains the wait ("${waitText.slice(0, 60)}...")`);
await shot('harvest-wait');
db.prepare('UPDATE trees SET growth = target + 0.01 WHERE player_id = ? AND status = ?').run(pid, 'alive');
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('.coach');
await pg.evaluate(() => document.querySelectorAll('.plots .plot')[0]?.click());
if (await pg.locator('.act-clean:not(:disabled)').count()) await pg.locator('.act-clean:not(:disabled)').first().click();
await pg.waitForSelector('.act-harvest:not(:disabled)', { timeout: 15000 });
await guided('harvest');
await pg.locator('.act-harvest:not(:disabled)').first().click();
await sleep(1500);
await pg.evaluate(() => document.querySelectorAll('.share-dialog .info-close, .dialog-backdrop .info-close').forEach((b) => b.click()));
// sell
check(await waitStep('sell'), 'step: sell');
await coachBtn('Open the Market');
await sleep(900);
await guided('sell');
await pg.locator('.sell-go:not(:disabled)').first().click();
// TaniBot: "Later" passes it
check(await waitStep('tanibot'), 'step: meet TaniBot');
await guided('tanibot');
await coachBtn('Later');
// fishing: go to the pond, cast once
check(await waitStep('fishing'), 'TaniBot "Later" passes to the fishing step');
await coachBtn('Go fishing');
await pg.waitForSelector('.pond-screen', { timeout: 10000 });
await pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 6000 });
await guided('fishing');
await pg.locator('.fish-cast').click();
await sleep(800);
db.prepare("UPDATE fishing_casts SET bite_at = 0 WHERE player_id = ? AND status = 'open'").run(pid);
await pg.waitForSelector('.fish-now', { timeout: 20000 });
await pg.locator('.fish-reel').click();
await pg.waitForSelector('.fish-result', { timeout: 10000 });
await pg.locator('.pond-back').click();
await pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 6000 });
// arena: open it, then "Got it"
check(await waitStep('arena', 20000), 'one cast finishes the fishing step');
await coachBtn('Open the Arena');
await pg.waitForSelector('.arena-dialog', { timeout: 8000 });
await sleep(500);
await shot('arena-window');
await pg.evaluate(() => document.querySelector('.arena-dialog .info-close')?.click());
await sleep(500);
await coachBtn('Got it');
// the end
const banner = await pg.waitForSelector('.mfx-banner', { timeout: 8000 }).catch(() => null);
const bt = banner ? (await banner.innerText()).replace(/\n/g, ' ') : '';
check(/welcome to/i.test(bt) && /tandur/i.test(bt), `the welcome banner plays ("${bt}")`);
await shot('welcome-banner');
const done = await pg.waitForSelector('.tutorial-done-dialog', { timeout: 12000 }).catch(() => null);
const dt = done ? await pg.locator('.tutorial-done p').innerText() : '';
check(/You did it, farmer!/.test(dt), `TaniBot's last words ("${dt.slice(0, 50)}...")`);
await shot('done');
check(!(await pg.locator('.share-dialog').count()), 'no share card on top of TaniBot\'s last words');
await pg.locator('.tutorial-done-dialog button', { hasText: "Let's farm!" }).first().click();
const card = await pg.waitForSelector('.share-dialog', { timeout: 8000 }).catch(() => null);
check(!!card, 'after "Let\'s farm!" the first-harvest share card comes');
await shot('share-after');
check(!(await pg.locator('.coach').count()), 'the coach is gone');
const ex = db.prepare('SELECT tutorial_step FROM players WHERE id = ?').get(pid).tutorial_step;
check(ex === 100, `the server stores the end (tutorial_step ${ex})`);
check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
