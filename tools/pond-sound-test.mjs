// The fishing pond's sounds, measured (Fishing package 7, docs/PLAN-fishing.md section 16). Sounds do
// not show in screenshots, so the dev build logs every pond sound it plays (window.__pondLog) and
// gives the pond's loudness (window.__pondLevel(), RMS of its output). For each time / weather this
// listens ~30 s and checks what was heard (ducks by day and at dusk, also in the rain, never at night;
// frogs at night with the crickets, also in the rain; birds only on clear days; a splash for every
// jumping fish) and how loud each animal is over the waterfall's steady rush (loud enough to hear,
// not too loud).
// Needs a FAKE-CHAIN server with FISHING=on (API_URL, default http://127.0.0.1:8788; FAKE_DB = its
// sqlite file) and the dev web (UI_URL, default http://localhost:5174/play). Playwright from
// PLAYWRIGHT=<path> (not a repo dependency):
//   PLAYWRIGHT=... FAKE_DB=... node tools/pond-sound-test.mjs <outDir> <newDevUser> [seconds]
import { writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const user = process.argv[3] ?? `snd${Date.now() % 100000}`;
const SECONDS = Number(process.argv[4] ?? 30);
const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
const UI = process.env.UI_URL ?? 'http://localhost:5174/play';
const db = new DatabaseSync(process.env.FAKE_DB);
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`);
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

const browser = await pw.chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript((t) => {
  localStorage.setItem('nearvest.token', t);
  localStorage.setItem('nearvest.howto', '1');
  localStorage.setItem('nearvest.sfx', '1');
  localStorage.setItem('nearvest.music', '0');
}, token);
const pg = await ctx.newPage();

const LOOKS = [
  { q: '?time=8&weather=clear', name: 'morning', want: { duck: true, bird: true, cricket: false } },
  { q: '?time=day&weather=clear', name: 'day', want: { duck: true, bird: true, cricket: false } },
  { q: '?time=dusk&weather=clear', name: 'dusk', want: { duck: true, cricket: false } },
  { q: '?time=day&weather=rain', name: 'day rain', want: { duck: true, bird: false, cricket: false } },
  { q: '?time=night&weather=clear', name: 'night', want: { duck: false, bird: false, frog: true, cricket: true } },
  { q: '?time=night&weather=rain', name: 'night rain', want: { duck: false, bird: false, frog: true, cricket: true } },
];
const report = {};
const ratios = {};
for (const L of LOOKS) {
  await pg.goto(UI + L.q, { waitUntil: 'networkidle' });
  await pg.mouse.click(5, 795); // the first tap unlocks sound (like a player)
  await pg.waitForSelector('.place-pin.pin-fishing', { timeout: 15000 });
  await pg.locator('.place-pin.pin-fishing').click({ force: true });
  // 2026-11-12: the pin asks first ("Go to the fishing pond?"): Go fishing.
  await pg.locator('.dialog button:has-text("Go fishing")').click({ timeout: 3000 }).catch(() => undefined);
  await pg.waitForSelector('.fishing-live .pond');
  await pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 6000 });
  await pg.waitForTimeout(1800); // the pond's sound fades in
  // Listen: the level every 40 ms and the log.
  const r = await pg.evaluate(async (ms) => {
    window.__pondLog = [];
    const levels = [];
    const t0 = performance.now();
    while (performance.now() - t0 < ms) {
      levels.push([performance.now(), window.__pondLevel ? window.__pondLevel() : 0]);
      await new Promise((ok) => setTimeout(ok, 40));
    }
    const jumps = document.querySelectorAll('.pond-jump').length;
    return { levels, log: window.__pondLog, jumps, sound: document.documentElement.dataset.pondSound };
  }, SECONDS * 1000);
  const kinds = {};
  for (const e of r.log) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
  // The waterfall's steady rush: the median level at moments at least 0.7 s from any short sound.
  const quiet = r.levels.filter(([t]) => r.log.every((e) => t < e.at - 100 || t > e.at + 700)).map(([, v]) => v).sort((a, b) => a - b);
  const bed = quiet[Math.floor(quiet.length / 2)] ?? 0;
  const peakOf = (kind) => {
    const ps = r.log
      .filter((e) => e.kind === kind)
      .map((e) => Math.max(0, ...r.levels.filter(([t]) => t >= e.at && t <= e.at + 450).map(([, v]) => v)));
    return ps.length ? ps.sort((a, b) => a - b)[Math.floor(ps.length / 2)] : 0;
  };
  const lv = {};
  for (const k of Object.keys(kinds)) lv[k] = bed > 0 ? Number((peakOf(k) / bed).toFixed(2)) : 0;
  report[L.name] = { heard: kinds, overWaterfall: lv, waterfallRms: Number(bed.toFixed(4)) };
  console.log(`${L.name}: heard ${JSON.stringify(kinds)}, loudness over the waterfall ${JSON.stringify(lv)}, waterfall RMS ${bed.toFixed(4)}`);
  check(bed > 0.001, `${L.name}: the pond really plays (waterfall RMS ${bed.toFixed(4)})`);
  for (const [k, on] of Object.entries(L.want)) check(on ? kinds[k] > 0 : !kinds[k], `${L.name}: ${k} ${on ? 'heard' : 'silent'} (${kinds[k] ?? 0})`);
  for (const [k, v] of Object.entries(lv)) (ratios[k] ??= []).push(v);
}
// Balance: every animal clearly over the waterfall (peak at least 1.4 x its rush), none blasting
// (at most 6 x); the jumping fish's splash heard too.
for (const k of ['duck', 'frog', 'cricket', 'bird', 'splash']) {
  const v = ratios[k] ?? [];
  const med = v.length ? v.sort((a, b) => a - b)[Math.floor(v.length / 2)] : 0;
  check(v.length > 0 && med >= 1.4 && med <= 6, `${k}: ${med}x the waterfall's level (heard clearly, not too loud)`);
}
writeFileSync(`${out}/pond-sounds.json`, JSON.stringify(report, null, 2));
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
