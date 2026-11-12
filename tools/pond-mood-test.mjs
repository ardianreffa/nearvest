// The fishing pond's mood and life in the browser (Fishing package 2, docs/PLAN-fishing.md section 9).
// Needs a FAKE-CHAIN server with FISHING=on (API_URL, default http://127.0.0.1:8788; FAKE_DB = its
// sqlite file, to skip the tutorial) and the dev web (UI_URL, default http://localhost:5174/play).
// Playwright from PLAYWRIGHT=<path> (not a repo dependency):
//   PLAYWRIGHT=... FAKE_DB=... node tools/pond-mood-test.mjs <outDir> <newDevUser> [w] [h]
// For ?time=day|dusk|night and ?weather=rain (and eruption = a clear pond): the water wipe on the way
// in and out, 4 frogs and 3 ducks, frogs hop / ducks paddle (asleep with zzz at night), falling
// leaves in the time's colours, the tint, the rain, the pond's sounds (dev: data-pond-sound), and
// with reduced motion nothing moves. Screenshots of the pond for each look.
import { DatabaseSync } from 'node:sqlite';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const user = process.argv[3] ?? `pond${Date.now() % 100000}`;
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
db.prepare('UPDATE players SET tutorial_step = 100 WHERE name = ?').run(user);

const browser = await pw.chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const phone = W < 1024;
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
await ctx.addInitScript((t) => {
  localStorage.setItem('nearvest.token', t);
  localStorage.setItem('nearvest.howto', '1');
  localStorage.setItem('nearvest.sfx', '1');
}, token);
const pg = await ctx.newPage();
const errors = [];
pg.on('pageerror', (e) => errors.push(String(e)));
pg.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));

const look = () =>
  pg.evaluate(() => {
    const pond = document.querySelector('.pond');
    const tr = (el) => getComputedStyle(el).transform;
    return {
      time: pond?.dataset.time,
      weather: pond?.dataset.weather,
      frogs: [...document.querySelectorAll('.pond-frog')].map((e) => `${e.dataset.spot}|${e.querySelector('[transform^=rotate]')?.getAttribute('transform')}|${e.querySelector('.frog-hop') ? 1 : 0}`),
      frogHops: [...document.querySelectorAll('.pond-frog > g')].map((g) => g.getAttribute('class') ?? ''),
      ducks: [...document.querySelectorAll('.pond-duck')].map((e) => tr(e)),
      asleep: document.querySelectorAll('.pond-duck.asleep').length,
      zzz: document.querySelectorAll('.pond-zzz').length,
      leaves: [...document.querySelectorAll('.pond-leaf')].map((e) => getComputedStyle(e).backgroundColor),
      tint: document.querySelector('.pond-tint')?.className,
      rain: document.querySelectorAll('.pond-rain .wx-rain-layer').length,
      rings: document.querySelectorAll('.rain-ring').length,
      tree: !!document.querySelector('.pond-tree')?.complete && document.querySelector('.pond-tree')?.naturalWidth === 80,
      treeAnim: document.querySelector('.pond-tree') && getComputedStyle(document.querySelector('.pond-tree')).animationName,
      sound: document.documentElement.dataset.pondSound ?? '',
    };
  });

/** Open the pond with the pin (water wipe), check the wipe, return the look. */
async function openPond(what) {
  await pg.waitForSelector('.place-pin.pin-fishing', { timeout: 15000 });
  await pg.locator('.place-pin.pin-fishing').click({ force: true });
  const wipe = await pg.waitForSelector('.visit-wipe.wipe-water', { timeout: 3000 }).catch(() => null);
  check(!!wipe, `${what}: water pixel wipe on the way in`);
  check(/fishing pond/i.test((await pg.locator('.visit-wipe-text').innerText().catch(() => '')) ?? ''), `${what}: wipe says "To the fishing pond"`);
  await pg.waitForSelector('.fishing-live .pond');
  await pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 5000 });
  await pg.waitForTimeout(400);
}
async function closePond(what) {
  await pg.locator('.fishing-dialog .info-actions .btn', { hasText: 'Close' }).click();
  const wipe = await pg.waitForSelector('.visit-wipe.wipe-water', { timeout: 3000 }).catch(() => null);
  check(!!wipe, `${what}: water pixel wipe on the way out`);
  await pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 5000 });
  check(!(await pg.locator('.fishing-live').count()), `${what}: back in the village`);
}

const LOOKS = [
  { q: '?time=day&weather=clear', time: 'day', weather: 'clear' },
  { q: '?time=dusk&weather=clear', time: 'dusk', weather: 'clear' },
  { q: '?time=night&weather=clear', time: 'night', weather: 'clear' },
  { q: '?time=day&weather=rain', time: 'day', weather: 'rain' },
  { q: '?time=night&weather=rain', time: 'night', weather: 'rain' },
  { q: '?time=day&weather=eruption', time: 'day', weather: 'clear' },
];
const leafColors = {};
for (const L of LOOKS) {
  await pg.goto(UI + L.q, { waitUntil: 'networkidle' });
  await pg.mouse.click(5, H - 5); // the first tap unlocks sound (like a player)
  await openPond(L.q);
  const a = await look();
  check(a.time === L.time && a.weather === L.weather, `${L.q}: pond time ${a.time}, weather ${a.weather}`);
  check(a.frogs.length === 4 && a.ducks.length === 3, `${L.q}: 4 frogs, 3 ducks`);
  check(a.tree && a.treeAnim === 'pond-sway', `${L.q}: the big tree sways (${a.treeAnim})`);
  check(a.leaves.length === 5, `${L.q}: 5 falling leaves`);
  leafColors[L.time] ??= a.leaves[0];
  check(L.time === 'day' ? !/tint-(dusk|night)/.test(a.tint) : a.tint.includes(`tint-${L.time}`), `${L.q}: tint (${a.tint})`);
  check(L.weather === 'rain' ? a.rain === 2 && a.rings === 8 : a.rain === 0 && a.rings === 0, `${L.q}: rain layers ${a.rain}, rings ${a.rings}`);
  const night = L.time === 'night';
  check(night ? a.asleep === 3 && a.zzz === 3 : a.asleep === 0 && a.zzz === 0, `${L.q}: ducks ${night ? 'asleep with zzz' : 'awake'} (${a.asleep}, ${a.zzz})`);
  await pg.screenshot({ path: `${out}/pond-${tag}-${L.time}-${L.weather}${L.q.includes('eruption') ? '-eruption' : ''}.png` });
  // Life: within ~12 s a frog hops and (by day) a duck paddles somewhere else.
  let hopped = false;
  let swam = false;
  for (let i = 0; i < 24 && !(hopped && (swam || night)); i++) {
    await pg.waitForTimeout(500);
    const b = await look();
    hopped ||= b.frogHops.some((c) => c.includes('frog-hop'));
    swam ||= b.ducks.some((t, j) => t !== a.ducks[j]);
  }
  check(hopped, `${L.q}: a frog hops`);
  check(night ? !swam : swam, `${L.q}: ducks ${night ? 'stay still (asleep)' : 'paddle'}`);
  const s = (await look()).sound;
  const want = { waterfall: true, breeze: !night && L.weather !== 'rain', crickets: night, ducks: !night, rain: L.weather === 'rain', frogs: true };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, s.split(',').includes(k)]));
  check(JSON.stringify(got) === JSON.stringify(want), `${L.q}: pond sounds ${s}`);
  await closePond(L.q);
  check(!(await look()).sound, `${L.q}: pond sounds stop after leaving`);
}
check(new Set(Object.values(leafColors)).size === 3, `leaf colours differ by time (${JSON.stringify(leafColors)})`);

// Reduced motion: nothing moves, no leaves, a short fade instead of the squares.
await pg.emulateMedia({ reducedMotion: 'reduce' });
await pg.goto(UI + '?time=day', { waitUntil: 'networkidle' });
await pg.waitForSelector('.place-pin.pin-fishing');
await pg.locator('.place-pin.pin-fishing').click({ force: true });
await pg.waitForSelector('.fishing-live .pond');
await pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 5000 });
const r0 = await look();
await pg.waitForTimeout(6000);
const r1 = await look();
check(JSON.stringify(r0.frogs) === JSON.stringify(r1.frogs) && JSON.stringify(r0.ducks) === JSON.stringify(r1.ducks), 'reduced motion: frogs and ducks stay still');
check(r1.leaves.length === 0 && r1.treeAnim === 'none', `reduced motion: no leaves, the tree is still (${r1.treeAnim})`);
await pg.screenshot({ path: `${out}/pond-${tag}-reduced.png` });

check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' / ')})`);
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
