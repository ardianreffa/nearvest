// Honest PANEN at the pond in a later Season (fishing package 4): on a FAKE-CHAIN server started with
// FAKE_SEASON=3 (rewards / 4) and FISHING=on, a Carp (base 5 PANEN) pays 1.25 PANEN, the catch card
// and "What can I catch?" show the amounts after the Season rule with "Season 3: rewards 25%".
//   PLAYWRIGHT=... FAKE_DB=<that server's sqlite> API_URL=http://127.0.0.1:8789 UI_URL=http://localhost:5175/play \
//     node tools/fishing-season-test.mjs <outDir> <newDevUser> [w] [h]
import { DatabaseSync } from 'node:sqlite';

const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const user = process.argv[3] ?? `season${Date.now() % 100000}`;
const W = Number(process.argv[4] ?? 390);
const H = Number(process.argv[5] ?? 844);
const API = process.env.API_URL ?? 'http://127.0.0.1:8789';
const UI = process.env.UI_URL ?? 'http://localhost:5175/play';
const db = new DatabaseSync(process.env.FAKE_DB);
const tag = `${W}x${H}`;
let fails = 0;
const check = (ok, msg) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${tag} ${msg}`);
  if (!ok) fails++;
};
const post = async (path, body, token) =>
  (await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body ?? {}) })).json();

const { token } = await post('/auth/dev', { username: user });
await post('/api/player', { name: user }, token);
for (let i = 0; i < 40; i++) {
  if (db.prepare('SELECT account_status FROM players WHERE name = ?').get(user)?.account_status === 'ready') break;
  await new Promise((r) => setTimeout(r, 250));
}
db.prepare('UPDATE players SET tutorial_step = 100 WHERE name = ?').run(user);
const pid = db.prepare('SELECT id FROM players WHERE name = ?').get(user).id;
const me = await (await fetch(`${API}/api/me`, { headers: { Authorization: `Bearer ${token}` } })).json();
check(me.season?.number === 3 && me.season?.divisor === 4, `the server is in Season 3 (${JSON.stringify(me.season)})`);

const browser = await pw.chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const phone = W < 1024;
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, isMobile: phone, hasTouch: phone });
await ctx.addInitScript((t) => {
  localStorage.setItem('nearvest.token', t);
  localStorage.setItem('nearvest.howto', '1');
}, token);
const pg = await ctx.newPage();
await pg.goto(UI + '?time=day&weather=clear', { waitUntil: 'networkidle' });
await pg.locator('.place-pin.pin-fishing').click({ force: true });
// 2026-11-12: the pin asks first ("Go to the fishing pond?"): Go fishing.
await pg.locator('.dialog button:has-text("Go fishing")').click({ timeout: 3000 }).catch(() => undefined);
await pg.waitForSelector('.pond-screen');
await pg.waitForSelector('.visit-wipe', { state: 'detached', timeout: 5000 });

// What can I catch?: the amounts you receive now.
await pg.locator('.fish-list-open').click();
await pg.waitForSelector('.fishing-list-dialog');
const list = await pg.evaluate(() => Object.fromEntries([...document.querySelectorAll('.fish-list li')].map((li) => [li.querySelector('.fish-list-name').textContent, li.querySelector('.fish-list-reward').textContent])));
const note = await pg.locator('.fish-list-note').innerText();
check(list.Tilapia === '0.75 PANEN' && list.Catfish === '1.25 PANEN' && list.Carp === '1.25 PANEN' && list.Gourami === '2.5 PANEN' && list['Golden Arowana'] === '7.5 PANEN' && list['Small chest'] === '2.5-3.75 PANEN', `list after the Season rule (${JSON.stringify(list)})`);
check(/Season 3: rewards 25%/.test(note) && /what you receive/.test(note), `list note: "${note}"`);
await pg.screenshot({ path: `${out}/season3-${tag}-list.png` });
await pg.locator('.fishing-list-dialog .info-actions .btn').click();

// A Carp (base 5) pays 1.25 PANEN, the card says so.
await pg.locator('.fish-cast').click();
await pg.waitForSelector('.pond-wait', { timeout: 5000 });
db.prepare("UPDATE fishing_casts SET catch = 'carp', paid = 1 WHERE player_id = ? AND status = 'open'").run(pid);
await pg.waitForSelector('.pond-bite', { timeout: 9000 });
await pg.locator('.fish-reel').click();
await pg.waitForSelector('.fish-result', { timeout: 5000 });
await pg.waitForTimeout(900);
const card = await pg.locator('.fish-result').innerText();
check(/CARP/i.test(card) && /\+1\.25 PANEN/.test(card) && /Season 3: rewards 25%/.test(card) && /Mr\. Darto bought it on the spot/.test(card), `catch card (${card.replace(/\n/g, ' | ')})`);
await pg.screenshot({ path: `${out}/season3-${tag}-card.png` });
await browser.close();
console.log(fails ? `${fails} FAILED` : 'ALL OK');
process.exit(fails ? 1 : 0);
