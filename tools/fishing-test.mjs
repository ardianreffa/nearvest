// Fishing window in the browser (web/src/fishing.tsx, docs/PLAN-fishing.md). Needs a FAKE-CHAIN server
// with FISHING=on (API_URL, default http://127.0.0.1:8788; FAKE_DB = its sqlite file, used to pick a
// catch before reeling and to skip the tutorial) and the dev web (UI_URL, default
// http://localhost:5174/play). Playwright from PLAYWRIGHT=<path> (not a repo dependency):
//   PLAYWRIGHT=... FAKE_DB=... node tools/fishing-test.mjs <outDir> <newDevUser> [w] [h]
// Checks: the pin opens the window; the window and its buttons fit the screen (no sideways shift,
// thumb-sized buttons); cast -> too-early tap -> bite -> reel -> catch card; forced catches (Golden
// Arowana, seed sold, released, bottle); 5 casts then "No casts left"; reduced motion still works;
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

/**
 * Full screen (package 3): the pond fills the screen (laptops: covers it; phones: the whole pond across
 * the width), the floating top bar and panel are inside the screen, nothing scrolls sideways, every
 * button is thumb-sized (>= 48 px high) and the panel does not hide the pond on phones.
 */
async function fits(what) {
  const r = await pg.evaluate(() => {
    const rect = (sel) => {
      const e = document.querySelector(sel);
      if (!e) return null;
      const q = e.getBoundingClientRect();
      return { l: q.left, r: q.right, t: q.top, b: q.bottom, w: q.width, h: q.height };
    };
    return {
      screen: rect('.pond-screen'),
      fit: document.querySelector('.pond-screen')?.dataset.fit,
      pond: rect('.pond'),
      panel: rect('.pond-panel'),
      top: rect('.pond-hud-top'),
      btns: [...document.querySelectorAll('.pond-screen .pond-actions .btn, .pond-back')].map((b) => b.getBoundingClientRect()).map((b) => ({ h: b.height, l: b.left, r: b.right, b: b.bottom })),
      sx: document.documentElement.scrollWidth,
      panelX: (() => {
        const e = document.querySelector('.pond-panel-body');
        return e ? e.scrollWidth - e.clientWidth : 0;
      })(),
    };
  });
  const inScreen = (x) => x && x.l >= -0.5 && x.r <= W + 0.5 && x.t >= -0.5 && x.b <= H + 0.5;
  check(r.screen && r.screen.w === W && r.screen.h === H, `${what}: the pond is full screen (${r.screen && `${r.screen.w}x${r.screen.h}`}, ${r.fit})`);
  check(inScreen(r.panel) && inScreen(r.top), `${what}: top bar and panel inside the screen`);
  check(r.sx <= W && r.panelX <= 0, `${what}: no sideways scroll (page ${r.sx}, panel ${r.panelX})`);
  check(Math.abs(r.pond.w / r.pond.h - 16 / 9) < 0.05, `${what}: pond 16:9 (${Math.round(r.pond.w)}x${Math.round(r.pond.h)})`);
  if (W < H) check(r.pond.l >= -0.5 && r.pond.r <= W + 0.5 && r.panel.t >= r.pond.b - 0.5 && r.top.b <= r.pond.t + 0.5, `${what}: phone: the whole pond shows, bar above, panel below`);
  else check(r.fit === 'cover' && r.pond.w >= W && r.pond.h >= H - 0.5, `${what}: laptop: the pond covers the window`);
  check(r.btns.length > 0 && r.btns.every((b) => b.h >= 48 && b.l >= 0 && b.r <= W && b.b <= H), `${what}: buttons on screen, >= 48 px high (${r.btns.map((b) => Math.round(b.h)).join(', ')})`);
}

/** The line, float, "!", the catch, sparkles and TaniBot never touch a frog or a duck (art/pond.tsx CRITTERS). */
async function clearOfCritters(what) {
  const hits = await pg.evaluate(() => {
    const pond = document.querySelector('.pond');
    if (!pond) return ['no pond'];
    const pr = pond.getBoundingClientRect();
    const [gw, gh] = pond.dataset.grid.split('x').map(Number);
    const sx = pr.width / gw;
    const sy = pr.height / gh;
    const boxes = JSON.parse(pond.dataset.critters).map(([x, y, w, h]) => ({ l: pr.left + x * sx, t: pr.top + y * sy, r: pr.left + (x + w) * sx, b: pr.top + (y + h) * sy }));
    const touch = (a, b) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;
    const out = [];
    const line = document.querySelector('.pond-line');
    if (line) {
      const n = line.getTotalLength();
      const m = line.getScreenCTM();
      for (let i = 0; i <= 40; i++) {
        const p = line.getPointAtLength((n * i) / 40);
        const x = m.a * p.x + m.c * p.y + m.e;
        const y = m.b * p.x + m.d * p.y + m.f;
        if (boxes.some((b) => touch({ l: x - 1, r: x + 1, t: y - 1, b: y + 1 }, b))) out.push('line');
      }
    }
    for (const sel of ['.pond-rod', '.pond-float', '.pond-bang', '.pond-catch', '.pond-spark', '.pond-splash i', '.pond-bot .tanibot']) {
      for (const el of document.querySelectorAll(sel)) {
        const r = el.getBoundingClientRect();
        if (boxes.some((b) => touch({ l: r.left, r: r.right, t: r.top, b: r.bottom }, b))) out.push(sel);
      }
    }
    return [...new Set(out)];
  });
  check(hits.length === 0, `${what}: nothing covers a frog or a duck${hits.length ? ` (${hits.join(', ')})` : ''}`);
}

/** The line starts exactly at the rod's tip (never broken); returns the pond's bend and the line's sag. */
async function lineOnTip(what) {
  const r = await pg.evaluate(() => {
    const pond = document.querySelector('.pond');
    const d = document.querySelector('.pond-line')?.getAttribute('d') ?? '';
    const m = /^M([\d.-]+) ([\d.-]+) Q([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+)/.exec(d);
    const [tx, ty] = pond.dataset.tip.split(',').map(Number);
    if (!m) return { ok: false, d };
    const [x0, y0, cx, cy, x1, y1] = m.slice(1).map(Number);
    // How far the control point is from the straight line tip -> float (0 = taut).
    const len = Math.hypot(x1 - x0, y1 - y0) || 1;
    const sag = Math.abs((cx - x0) * (y1 - y0) - (cy - y0) * (x1 - x0)) / len;
    return { ok: Math.abs(x0 - tx) < 0.02 && Math.abs(y0 - ty) < 0.02, bend: Number(pond.dataset.bend), sag, float: [x1, y1] };
  });
  check(r.ok, `${what}: the line starts at the rod's tip`);
  return r;
}

/** The water pixel wipe (on the way in and out) has finished. */
const wipeDone = () => pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 5000 });
const openWindow = async () => {
  await pg.locator('.place-pin.pin-fishing').click({ force: true });
  await pg.waitForSelector('.pond-screen');
  await wipeDone();
};
const forceCatch = (id) => db.prepare("UPDATE fishing_casts SET catch = ?, paid = ?, line = ? WHERE player_id = ? AND status = 'open'").run(id, ['stone', 'driftwood', 'fish_bone', 'old_boot', 'rusty_can', 'bottle'].includes(id) ? 0 : 1, id === 'bottle' ? 3 : null, pid);

/** Cast, (optionally tap early), wait for the bite, reel; returns the catch card text. */
async function oneCast(n, opts = {}) {
  await pg.locator('.fish-cast').click();
  if (opts.shotBite) {
    // Mid-cast: the rod swings, the float flies on its line.
    for (const ms of [120, 380, 640]) {
      await pg.waitForTimeout(ms === 120 ? 120 : 260);
      await lineOnTip(`cast ${n} at ~${ms} ms`);
    }
    await pg.screenshot({ path: `${out}/fish-${tag}-${n}-casting.png` });
  }
  await pg.waitForSelector('.pond-wait', { timeout: 5000 });
  await pg.waitForTimeout(1000);
  const w = await lineOnTip(`cast ${n} waiting`);
  check(w.bend === 0 && w.sag > 4, `cast ${n} waiting: straight rod, the line sags softly (sag ${w.sag.toFixed(1)})`);
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
  const b = await lineOnTip(`cast ${n} bite`);
  const still = await pg.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  check(b.bend > 10 && b.sag < 0.05, `cast ${n} bite: the rod bends (${b.bend}) and the line is taut (sag ${b.sag.toFixed(2)})${still ? ' (reduced motion)' : ''}`);
  check((await pg.locator('.fish-reel').innerText()).includes('Reel in!'), `cast ${n}: button says "Reel in!"`);
  if (opts.shotBite) await pg.screenshot({ path: `${out}/fish-${tag}-${n}-bite.png` });
  await clearOfCritters(`cast ${n} bite`);
  await pg.locator('.fish-reel').click();
  if (!still) {
    await pg.waitForTimeout(300);
    const r = await lineOnTip(`cast ${n} reeling`);
    check(r.float[0] < 245, `cast ${n} reeling: the float is being pulled in (x ${r.float[0].toFixed(0)})`);
    if (opts.shotBite) await pg.screenshot({ path: `${out}/fish-${tag}-${n}-reeling.png` });
  }
  await pg.waitForSelector('.fish-result', { timeout: 5000 });
  await pg.waitForTimeout(900);
  const text = await pg.locator('.fish-result').innerText();
  if (opts.tier) {
    const cls = await pg.evaluate(() => [document.querySelector('.pond-catch')?.className, document.querySelector('.pond-splash')?.className ?? '', !!document.querySelector('.pond-plop')]);
    const splashOk = opts.tier === 'junk' ? cls[2] && !cls[1] : cls[1].includes(`splash-${opts.tier}`);
    check(cls[0].includes(`tier-${opts.tier}`) && splashOk, `cast ${n}: ${opts.tier} animation (${cls.join(' / ')})`);
  }
  await pg.screenshot({ path: `${out}/fish-${tag}-${n}-result.png` });
  await clearOfCritters(`cast ${n} result`);
  await fits(`cast ${n} result`);
  return text;
}

await pg.goto(UI, { waitUntil: 'networkidle' });
await pg.waitForSelector('.place-pin.pin-fishing', { timeout: 15000 });
check(!(await pg.locator('.place-pin.pin-fishing.soon').count()), 'the Fishing pin is live (no "Soon")');
await openWindow();
check((await pg.locator('.fish-casts').innerText()).includes('5 of 5'), 'the pond shows 5 of 5 casts');
await fits('open');
await clearOfCritters('open');
check(await pg.evaluate(() => { const i = document.querySelector('.pond-img'); return i && i.complete && i.naturalWidth === 480; }), 'the pond image (480 x 270) is loaded');
await pg.screenshot({ path: `${out}/fish-${tag}-0-open.png` });
check(await pg.evaluate(() => new DOMMatrix(getComputedStyle(document.querySelector('.pond-bot-in')).transform).a < 0), 'TaniBot faces right, toward the water (mirrored sprite)');
await lineOnTip('open');

const t1 = await oneCast(1, { early: true, force: 'golden_arowana', shotBite: true, tier: 'legend' });
check(/GOLDEN AROWANA/i.test(t1) && /PANEN/.test(t1), `cast 1: Golden Arowana with PANEN (${t1.replace(/\n/g, ' | ')})`);
check((await pg.locator('.pond-spark').count()) > 0, 'cast 1: gold sparkles around the Golden Arowana in the pond');
check(await pg.locator('.fish-result.legend').count() === 1, 'cast 1: the Golden Arowana card glows');
// Storage full + Mango seed = Mr. Darto buys it.
for (let i = 0; i < 25; i++) db.prepare("INSERT INTO seeds (player_id, species, quality, source, created_at) SELECT ?, 'mango', NULL, 'test', 0 WHERE (SELECT COUNT(*) FROM seeds WHERE player_id = ?) < 20").run(pid, pid);
const t2 = await oneCast(2, { force: 'mango_seed', tier: 'item' });
check(/Mr\. Darto bought/.test(t2) && /\+2 PANEN/.test(t2), `cast 2: Storage full, seed sold (${t2.replace(/\n/g, ' | ')})`);
const t3 = await oneCast(3, { force: 'bottle' });
check(/message in a bottle/i.test(t3) && /“/.test(t3) && /\+5 XP/.test(t3), `cast 3: bottle line + 5 XP (${t3.replace(/\n/g, ' | ')})`);
// Casts 4 and 5 (5 a day since package 6).
const t3b = await oneCast('3b', { force: 'stone', tier: 'junk' });
check(/STONE/i.test(t3b) && /\+1 XP/.test(t3b), `cast 4: Stone, 1 XP (${t3b.replace(/\n/g, ' | ')})`);
await oneCast('3c', { force: 'driftwood' });
check((await pg.locator('.fish-cast').isDisabled()) && /No casts left/.test(await pg.locator('.fish-cast').innerText()), 'after 5 casts: "No casts left" (disabled)');
check(/Come back at 07:00 WIB/.test(await pg.locator('.fish-status').innerText()), 'after 5 casts: come back at 07:00 WIB');
await pg.locator('.fish-list-open').click();
await pg.waitForSelector('.fishing-list-dialog');
check((await pg.locator('.fish-list li').count()) === 14, 'What can I catch? lists 14 catches (with the Rusty can)');
check(/what you receive/.test(await pg.locator('.fish-list-note').innerText()), 'What can I catch? says the amounts are what you receive');
await pg.evaluate(() => {
  const b = document.querySelector('.fishing-list-dialog .info-body');
  b.scrollTop = b.scrollHeight;
});
check(await pg.evaluate(() => [...document.querySelectorAll('.fish-list-name')].every((e) => e.getBoundingClientRect().height < 56)), 'catch names stay on one or two lines');
check(await pg.evaluate(() => { const d = document.querySelector('.fishing-list-dialog').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth && d.bottom <= innerHeight; }), 'the catch list fits the screen');
await pg.screenshot({ path: `${out}/fish-${tag}-4-list.png` });
await pg.locator('.fishing-list-dialog .info-actions .btn').click();
await pg.locator('.pond-back').click();
await wipeDone();

// The Golden Arowana's share card waits until the window closes, then opens.
await pg.waitForSelector('.mfx-golden_arowana', { timeout: 4000 }).catch(() => null);
check((await pg.locator('.mfx-golden_arowana').count()) === 1, 'Golden Arowana: the big moment animation plays when the window closes');
await pg.screenshot({ path: `${out}/fish-${tag}-4a-moment.png` });
await pg.waitForSelector('.share-dialog', { timeout: 8000 }).catch(() => null);
check((await pg.locator('.share-dialog').count()) === 1, 'Golden Arowana: the share card opens after the window closes');
await pg.waitForSelector('.share-card img', { timeout: 8000 }).catch(() => null);
check(/Golden Arowana/.test(await pg.locator('.share-text').innerText().catch(() => '')), 'Golden Arowana: the post text names the fish');
await pg.screenshot({ path: `${out}/fish-${tag}-4b-share.png` });
await pg.locator('.share-x').click();

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
await pg.locator('.pond-back').click();
await wipeDone();
await pg.emulateMedia({ reducedMotion: null });

// A line left in the water is resumed when the window opens again.
await openWindow();
await pg.locator('.fish-cast').click();
await pg.waitForSelector('.pond-wait');
await pg.keyboard.press('Escape');
await wipeDone();
await openWindow();
check((await pg.locator('.pond-wait, .pond-bite').count()) === 1, 'reopening resumes the line in the water');
await pg.waitForSelector('.pond-bite', { timeout: 8000 });
await pg.locator('.fish-reel').click();
await pg.waitForSelector('.fish-result');
await pg.locator('.pond-back').click();
await wipeDone();

// Another day: the other result tiers (Gourami festive, junk = Rusty can, a normal fish).
db.prepare('UPDATE fishing_casts SET cast_day = cast_day - 1 WHERE player_id = ?').run(pid);
await pg.reload({ waitUntil: 'networkidle' });
await pg.waitForSelector('.place-pin.pin-fishing');
await openWindow();
const t7 = await oneCast(7, { force: 'gourami', tier: 'gourami' });
check(/GOURAMI/i.test(t7) && /PANEN/.test(t7), `cast 7: Gourami (${t7.replace(/\n/g, ' | ')})`);
const t8 = await oneCast(8, { force: 'rusty_can', tier: 'junk' });
check(/RUSTY CAN/i.test(t8) && /\+1 XP/.test(t8) && !/PANEN/.test(t8), `cast 8: Rusty can, 1 XP (${t8.replace(/\n/g, ' | ')})`);
const t9 = await oneCast(9, { force: 'catfish', tier: 'fish' });
check(/CATFISH/i.test(t9), `cast 9: Catfish (${t9.replace(/\n/g, ' | ')})`);
await pg.locator('.fish-list-open').click();
await pg.waitForSelector('.fishing-list-dialog');
await pg.screenshot({ path: `${out}/fish-${tag}-9-list.png` });
await pg.locator('.fishing-list-dialog .info-actions .btn').click();
await pg.locator('.pond-back').click();
await wipeDone();

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
