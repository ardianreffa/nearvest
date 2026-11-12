// The fishing pond in DEMO mode (fishing package 6, Ardian's live test): a demo village day lasts one
// minute, but the pond must not flicker: each picture (day / dusk / night) and the weather hold at
// least 20 s and change with a fade of a few seconds (the picture's opacity passes in-between values).
// Fake-chain server with FISHING=on; Playwright from PLAYWRIGHT=<path>:
//   PLAYWRIGHT=... FAKE_DB=... node tools/pond-demo-test.mjs <outDir> [w] [h]
import { DatabaseSync } from 'node:sqlite';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const W = Number(process.argv[3] ?? 1280);
const H = Number(process.argv[4] ?? 800);
const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
const UI = process.env.UI_URL ?? 'http://localhost:5174/play';
const db = new DatabaseSync(process.env.FAKE_DB);
const tag = `${W}x${H}`;
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${tag} ${msg}`);
  if (!ok) fails++;
};
const post = async (p, b, t) => (await fetch(API + p, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: `Bearer ${t}` } : {}) }, body: JSON.stringify(b ?? {}) })).json();
const user = 'demo' + (Date.now() % 100000);
const { token } = await post('/auth/dev', { username: user });
await post('/api/player', { name: user, demo: true }, token);
for (let i = 0; i < 40; i++) {
  if (db.prepare('SELECT account_status FROM players WHERE name=?').get(user)?.account_status === 'ready') break;
  await new Promise((r) => setTimeout(r, 250));
}
db.prepare('UPDATE players SET tutorial_step=100 WHERE name=?').run(user);
const b = await pw.chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const phone = W < 1024;
const c = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, isMobile: phone, hasTouch: phone });
await c.addInitScript((t) => {
  localStorage.setItem('nearvest.token', t);
  localStorage.setItem('nearvest.howto', '1');
}, token);
const pg = await c.newPage();
await pg.goto(UI, { waitUntil: 'networkidle' });
await pg.locator('.place-pin.pin-fishing').click({ force: true });
// 2026-11-12: the pin asks first ("Go to the fishing pond?"): Go fishing.
await pg.locator('.dialog button:has-text("Go fishing")').click({ timeout: 3000 }).catch(() => undefined);
await pg.waitForSelector('.pond-screen');
await pg.waitForSelector('.visit-wipe', { state: 'detached' });
const samples = [];
for (let i = 0; i < 130; i++) {
  samples.push(
    await pg.evaluate(() => {
      const p = document.querySelector('.pond');
      const op = (q) => { const e = document.querySelector(q); return e ? Number(getComputedStyle(e).opacity) : null; };
      return { t: performance.now(), time: p.dataset.time, dusk: op('.pond-img-dusk') ?? op('.pond-pic-dusk'), night: op('.pond-img-night') ?? op('.pond-pic-night'), rain: op('.pond-rain') ?? 0 };
    }),
  );
  if (i % 10 === 0) await pg.screenshot({ path: `${out}/demo-${tag}-${String(i).padStart(3, '0')}.png` });
  await pg.waitForTimeout(450);
}
const changes = [];
// A change of PICTURE (morning and day share the day picture).
const pic = (t) => (t === 'morning' ? 'day' : t);
for (let i = 1; i < samples.length; i++) if (pic(samples[i].time) !== pic(samples[i - 1].time)) changes.push(samples[i].t);
const gaps = changes.slice(1).map((t, i) => t - changes[i]);
check(changes.length >= 1, `the demo pond still changes its picture (${changes.length} changes in ${Math.round((samples.at(-1).t - samples[0].t) / 1000)} s)`);
check(gaps.every((g) => g >= 19000), `each picture holds at least 20 s (gaps ${gaps.map((g) => Math.round(g / 1000)).join(', ')} s)`);
const between = samples.some((s) => [s.dusk, s.night, s.rain].some((v) => v > 0.05 && v < 0.95));
check(between, 'pictures fade (in-between opacity seen), never pop');
console.log(samples.filter((_, i) => i % 6 === 0).map((s) => `${Math.round((s.t - samples[0].t) / 1000)}s ${s.time} dusk ${s.dusk.toFixed(2)} night ${s.night.toFixed(2)} rain ${s.rain.toFixed(2)}`).join('\n'));
await b.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
