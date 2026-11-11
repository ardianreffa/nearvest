// Fishing window in the browser (web/src/fishing.tsx, docs/PLAN-fishing.md). Needs a FAKE-CHAIN server
// with FISHING=on (API_URL, default http://127.0.0.1:8788; FAKE_DB = its sqlite file, used to pick a
// catch before reeling and to skip the tutorial) and the dev web (UI_URL, default
// http://localhost:5174/play). Playwright from PLAYWRIGHT=<path> (not a repo dependency):
//   PLAYWRIGHT=... FAKE_DB=... node tools/fishing-test.mjs <outDir> <newDevUser> [w] [h]
// Checks: the pin opens the window; the window and its buttons fit the screen (no sideways shift,
// thumb-sized buttons); cast -> too-early tap -> bite -> reel -> catch card; forced catches (Golden
// Arowana, seed sold, released, bottle); 3 casts then "No casts left"; reduced motion still works;
// a server without fishing keeps "Fishing · Soon" with the coming-soon window and no errors.
import { DatabaseSync } from 'node:sqlite';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const user = process.argv[3] ?? `fish${Date.now() % 100000}`;
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

// A new dev garden, ready, no tutorial in the way.
const { token } = await post('/auth/dev', { username: user });
await post('/api/player', { name: user }, token);
for (let i = 0; i < 40; i++) {
  const p = db.prepare('SELECT account_status FROM players WHERE name = ?').get(user);
  if (p?.account_status === 'ready') break;
  await new Promise((r) => setTimeout(r, 250));
}
db.prepare('UPDATE players SET tutorial_step = 100 WHERE name = ?').run(user);
const pid = db.prepare('SELECT id FROM players WHERE name = ?').get(user).id;

const browser = await pw.chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const phone = W < 1024;
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
await ctx.addInitScript((t) => {
  localStorage.setItem('nearvest.token', t);
  localStorage.setItem('nearvest.howto', '1');
}, token);
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

/** The window and its buttons are inside the screen, nothing scrolls sideways, buttons >= 48 px high. */
async function fits(what) {
  const r = await pg.evaluate(() => {
    const d = document.querySelector('.fishing-dialog')?.getBoundingClientRect();
    const btns = [...document.querySelectorAll('.fishing-dialog .info-actions .btn')].map((b) => b.getBoundingClientRect());
    const pond = document.querySelector('.pond')?.getBoundingClientRect();
    return {
      d: d && { l: d.left, r: d.right, t: d.top, b: d.bottom },
      pond: pond && { l: pond.left, r: pond.right, w: pond.width, h: pond.height },
      btns: btns.map((b) => ({ h: b.height, l: b.left, r: b.right, b: b.bottom })),
      sx: document.documentElement.scrollWidth,
      bodyX: document.querySelector('.fishing-dialog .info-body')?.scrollWidth - document.querySelector('.fishing-dialog .info-body')?.clientWidth,
    };
  });
  const inside = r.d && r.d.l >= 0 && r.d.r <= W + 0.5 && r.d.t >= 0 && r.d.b <= H + 0.5;
  check(inside, `${what}: window inside the screen (${JSON.stringify(r.d)})`);
  check(r.sx <= W && r.bodyX <= 0, `${what}: no sideways scroll (page ${r.sx}, body overflow ${r.bodyX})`);
  check(!r.pond || (r.pond.l >= r.d.l && r.pond.r <= r.d.r && Math.abs(r.pond.w / r.pond.h - 16 / 9) < 0.05), `${what}: pond whole, 16:9 (${r.pond && `${Math.round(r.pond.w)}x${Math.round(r.pond.h)}`})`);
  check(r.btns.length > 0 && r.btns.every((b) => b.h >= 48 && b.l >= 0 && b.r <= W && b.b <= H), `${what}: buttons on screen, >= 48 px high (${r.btns.map((b) => Math.round(b.h)).join(', ')})`);
}

const openWindow = async () => {
  await pg.locator('.place-pin.pin-fishing').click({ force: true });
  await pg.waitForSelector('.fishing-dialog');
};
const forceCatch = (id) => db.prepare("UPDATE fishing_casts SET catch = ?, paid = ?, line = ? WHERE player_id = ? AND status = 'open'").run(id, ['stone', 'driftwood', 'fish_bone', 'old_boot', 'bottle'].includes(id) ? 0 : 1, id === 'bottle' ? 3 : null, pid);

/** Cast, (optionally tap early), wait for the bite, reel; returns the catch card text. */
async function oneCast(n, opts = {}) {
  await pg.locator('.fish-cast').click();
  await pg.waitForSelector('.pond-wait', { timeout: 5000 });
  if (opts.force) forceCatch(opts.force);
  if (opts.released) db.prepare("UPDATE fishing_casts SET released = 1 WHERE player_id = ? AND status = 'open'").run(pid);
  if (opts.early) {
    await pg.locator('.fish-reel').click();
    check(/Wait for the bite/.test(await pg.locator('.fish-status').innerText()), `cast ${n}: an early tap says "Wait for the bite!"`);
    check(!(await pg.locator('.fish-result').count()), `cast ${n}: an early tap catches nothing`);
    await fits(`cast ${n} waiting`);
    await pg.screenshot({ path: `${out}/fish-${tag}-${n}-wait.png` });
  }
  await pg.waitForSelector('.pond-bite', { timeout: 8000 });
  check(await pg.locator('.pond-bang').isVisible(), `cast ${n}: the bite shows "!"`);
  check((await pg.locator('.fish-reel').innerText()).includes('Reel in!'), `cast ${n}: button says "Reel in!"`);
  if (opts.shotBite) await pg.screenshot({ path: `${out}/fish-${tag}-${n}-bite.png` });
  await pg.locator('.fish-reel').click();
  await pg.waitForSelector('.fish-result', { timeout: 5000 });
  await pg.waitForTimeout(900);
  const text = await pg.locator('.fish-result').innerText();
  await pg.screenshot({ path: `${out}/fish-${tag}-${n}-result.png` });
  await fits(`cast ${n} result`);
  return text;
}

await pg.goto(UI, { waitUntil: 'networkidle' });
await pg.waitForSelector('.place-pin.pin-fishing', { timeout: 15000 });
check(!(await pg.locator('.place-pin.pin-fishing.soon').count()), 'the Fishing pin is live (no "Soon")');
await openWindow();
check((await pg.locator('.fish-casts').innerText()).includes('3 of 3'), 'the window shows 3 of 3 casts');
await fits('open');
await pg.screenshot({ path: `${out}/fish-${tag}-0-open.png` });

const t1 = await oneCast(1, { early: true, force: 'golden_arowana', shotBite: true });
check(/GOLDEN AROWANA/i.test(t1) && /PANEN/.test(t1), `cast 1: Golden Arowana with PANEN (${t1.replace(/\n/g, ' | ')})`);
check(await pg.locator('.fish-result.legend').count() === 1, 'cast 1: the Golden Arowana card glows');
// Storage full + Mango seed = Mr. Darto buys it.
for (let i = 0; i < 25; i++) db.prepare("INSERT INTO seeds (player_id, species, quality, source, created_at) SELECT ?, 'mango', NULL, 'test', 0 WHERE (SELECT COUNT(*) FROM seeds WHERE player_id = ?) < 20").run(pid, pid);
const t2 = await oneCast(2, { force: 'mango_seed' });
check(/Mr\. Darto bought/.test(t2) && /\+2 PANEN/.test(t2), `cast 2: Storage full, seed sold (${t2.replace(/\n/g, ' | ')})`);
const t3 = await oneCast(3, { force: 'bottle' });
check(/message in a bottle/i.test(t3) && /“/.test(t3) && /\+5 XP/.test(t3), `cast 3: bottle line + 5 XP (${t3.replace(/\n/g, ' | ')})`);
check((await pg.locator('.fish-cast').isDisabled()) && /No casts left/.test(await pg.locator('.fish-cast').innerText()), 'after 3 casts: "No casts left" (disabled)');
check(/Come back at 07:00 WIB/.test(await pg.locator('.fish-status').innerText()), 'after 3 casts: come back at 07:00 WIB');
await pg.locator('.fish-list .link-btn').click();
check((await pg.locator('.fish-list li').count()) === 13, 'What can I catch? lists 13 catches');
await fits('list open');
await pg.screenshot({ path: `${out}/fish-${tag}-4-list.png` });
await pg.locator('.fishing-dialog .info-actions .btn', { hasText: 'Close' }).click();

// A new day: released catch + reduced motion.
db.prepare('UPDATE fishing_casts SET cast_day = cast_day - 1 WHERE player_id = ?').run(pid);
await pg.emulateMedia({ reducedMotion: 'reduce' });
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('.place-pin.pin-fishing');
await openWindow();
const t4 = await oneCast(5, { force: 'tilapia', released: true });
check(/released/i.test(t4) && /used up/.test(t4) && !/PANEN/.test(t4), `released + reduced motion (${t4.replace(/\n/g, ' | ')})`);
const anim = await pg.evaluate(() => getComputedStyle(document.querySelector('.pond-catch')).animationName);
check(anim === 'none', `reduced motion: the catch does not fly (${anim})`);
await pg.locator('.fishing-dialog .info-actions .btn', { hasText: 'Close' }).click();
await pg.emulateMedia({ reducedMotion: null });

// A line left in the water is resumed when the window opens again.
await openWindow();
await pg.locator('.fish-cast').click();
await pg.waitForSelector('.pond-wait');
await pg.locator('.info-close').click();
await openWindow();
check((await pg.locator('.pond-wait, .pond-bite').count()) === 1, 'reopening resumes the line in the water');
await pg.waitForSelector('.pond-bite', { timeout: 8000 });
await pg.locator('.fish-reel').click();
await pg.waitForSelector('.fish-result');
await pg.locator('.fishing-dialog .info-actions .btn', { hasText: 'Close' }).click();

// A server without fishing: the pin says "Soon" and opens the coming-soon window; no errors.
await pg.route(`${API}/api/me**`, async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  delete j.fishing;
  await route.fulfill({ response: res, json: j });
});
await pg.route(`${API}/api/config`, async (route) => {
  const res = await route.fetch();
  const j = await res.json();
  delete j.fishing;
  await route.fulfill({ response: res, json: j });
});
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('.place-pin.pin-fishing');
check((await pg.locator('.place-pin.pin-fishing.soon').count()) === 1, 'old server: the pin says "Soon"');
await pg.locator('.place-pin.pin-fishing').click({ force: true });
await pg.waitForSelector('.fishing-dialog');
check(/coming soon/i.test(await pg.locator('.fishing-dialog').innerText()) && !(await pg.locator('.fishing-live').count()), 'old server: the coming-soon window');
await pg.screenshot({ path: `${out}/fish-${tag}-6-oldserver.png` });

check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' / ')})`);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
