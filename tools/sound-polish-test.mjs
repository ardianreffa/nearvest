// Sound polish (2026-11-12) in the browser: which sounds play, read from the dev build's sound log
// (window.__sfxLog; sounds are not in screenshots). Checks: nothing before the first tap; a soft click
// for pins / tabs / windows / plain buttons (exactly one, never on top of a button's own sound); buying
// in the Shop = burn + "item received" (no click); selling to Mr. Darto = coins + "cring"s, more for a
// big sale (no click); Sound switch off = silence. Screenshots of the Shop and the Market, no page errors.
// Needs a FAKE-CHAIN server (API_URL, default http://127.0.0.1:8788; FAKE_DB = its sqlite file, gives
// fruit) and the dev web (UI_URL, default http://localhost:5174/play). Playwright from PLAYWRIGHT=<path>:
//   PLAYWRIGHT=... FAKE_DB=... node tools/sound-polish-test.mjs <outDir> <newDevUser> [w] [h]
import { DatabaseSync } from 'node:sqlite';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const user = process.argv[3] ?? `sfx${Date.now() % 100000}`;
const W = Number(process.argv[4] ?? 390);
const H = Number(process.argv[5] ?? 844);
const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
const UI = process.env.UI_URL ?? 'http://localhost:5174/play';
const db = new DatabaseSync(process.env.FAKE_DB);
const tag = `${W}x${H}`;
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${tag} ${msg}`);
  if (!ok) fails++;
};
const post = async (path, body, token) => {
  const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) });
  return r.json();
};

const { token } = await post('/auth/dev', { username: user });
await post('/api/player', { name: user }, token);
for (let i = 0; i < 40; i++) {
  if (db.prepare('SELECT account_status FROM players WHERE name = ?').get(user)?.account_status === 'ready') break;
  await new Promise((r) => setTimeout(r, 250));
}
const id = db.prepare('SELECT id FROM players WHERE name = ?').get(user).id;
db.prepare('UPDATE players SET tutorial_step = 100 WHERE id = ?').run(id);
db.prepare('INSERT OR REPLACE INTO fruits (player_id, species, quality, qty) VALUES (?, ?, ?, ?)').run(id, 'mango', 'common', 12);

const browser = await pw.chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
const phone = W < 1024;
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
await ctx.addInitScript((t) => {
  localStorage.setItem('nearvest.token', t);
  localStorage.setItem('nearvest.howto', '1');
  localStorage.setItem('nearvest.sfx', '1');
  localStorage.setItem('nearvest.music', '0');
}, token);
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

/** The sounds that started during `fn` (and 400 ms after). */
const heard = async (fn) => {
  await pg.evaluate(() => (window.__sfxLog = []));
  await fn();
  await pg.waitForTimeout(400);
  return pg.evaluate(() => (window.__sfxLog ?? []).map((e) => e.kind));
};
const closeWindow = async () => {
  const x = pg.locator('.dialog-backdrop .dialog-close, .dialog-backdrop button:has-text("Close")').first();
  if (await x.count()) await x.click();
  else await pg.keyboard.press('Escape');
  await pg.waitForTimeout(300);
};

await pg.goto(UI, { waitUntil: 'networkidle' });
await pg.waitForSelector('.place-pin.pin-shop', { timeout: 15000 });
check((await pg.evaluate(() => (window.__sfxLog ?? []).length)) === 0, 'nothing plays before the first tap');
await pg.mouse.click(W - 4, Math.round(H / 2)); // the first tap unlocks sound (like a player)
await pg.waitForTimeout(1200);

// Opening the Shop (phones: its tab; laptops: its pin): one soft click.
let s = await heard(() => (phone ? pg.locator('.tab', { hasText: 'Shop' }).first().click() : pg.locator('.place-pin.pin-shop').click({ force: true })));
check(s.filter((k) => k === 'click').length === 1, `opening the Shop: one soft click (${s.join(', ')})`);
await pg.waitForSelector('.shop-buy', { state: 'attached' });
await pg.locator('.shop-buy:not([disabled])').first().scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${out}/sfx-${tag}-shop.png` });
// Buying: burn + "item received", no click on top.
s = await heard(() => pg.locator('.shop-buy:not([disabled])').first().click());
check(s.includes('burn') && s.includes('buy') && !s.includes('click'), `buying in the Shop: burn + item received, no click (${s.join(', ')})`);
await pg.waitForTimeout(800);
if (phone) {
  // A bottom tab: one soft click.
  s = await heard(() => pg.locator('.tab', { hasText: 'Market' }).first().click());
  check(s.filter((k) => k === 'click').length === 1, `the Market tab: one soft click (${s.join(', ')})`);
} else {
  await closeWindow();
  s = await heard(() => pg.locator('.place-pin.pin-market').click({ force: true }));
  check(s.filter((k) => k === 'click').length === 1, `the Market pin: one soft click (${s.join(', ')})`);
}
await pg.waitForSelector('.sell-go:not([disabled])', { timeout: 8000, state: 'attached' });
await pg.locator('.sell-go:not([disabled])').first().scrollIntoViewIfNeeded();
await pg.screenshot({ path: `${out}/sfx-${tag}-market.png` });
// Sell one: coins + one cring.
s = await heard(() => pg.locator('.sell-go:not([disabled])').first().click());
check(s.includes('coins') && s.includes('cring x1') && !s.includes('click'), `selling 1 fruit: coins + one cring, no click (${s.join(', ')})`);
await pg.waitForTimeout(1200);
// Max (a plain button: soft click), then a big sale: more crings.
s = await heard(() => pg.locator('.sell-max:not([disabled])').first().click());
check(s.filter((k) => k === 'click').length === 1, `the Max button: one soft click (${s.join(', ')})`);
s = await heard(() => pg.locator('.sell-go:not([disabled])').first().click());
check(s.includes('coins') && s.includes('cring x4') && !s.includes('click'), `selling 11 fruits at once: coins + 4 crings, no click (${s.join(', ')})`);
// A disabled button: silence.
s = await heard(() => pg.locator('.sell-go[disabled]').first().click({ force: true }).catch(() => undefined));
check(!s.includes('click'), `a disabled button stays silent (${s.join(', ') || 'silence'})`);
// Sound switch off (the HUD speaker button, like a player): nothing at all afterwards.
await pg.locator('button[aria-label="Turn sound effects off"]').first().click();
await pg.waitForTimeout(400);
s = await heard(() => (phone ? pg.locator('.tab', { hasText: 'Shop' }).first().click() : pg.locator('.place-pin.pin-shop').click({ force: true })));
check(s.length === 0, `Sound switch off: silence (${s.join(', ') || 'silence'})`);
check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' / ')})`);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
