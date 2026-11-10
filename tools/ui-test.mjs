// Browser test: drives headless Chrome (temporary profile) through the whole game loop and saves screenshots.
// Needs the server (npm run dev in server/, DEV_LOGIN=true) and the web dev server running.
// Usage: node tools/ui-test.mjs <outDir> <playerName> [width=390] [height=844]
// Login page only (no account is created): node tools/ui-test.mjs <outDir> --login-only [width] [height]
//   Also checks the footer text, the Privacy / Terms links and pages (/privacy, /terms) and whether the Dev login form shows.
// Profile window of an EXISTING dev garden (no account is created): node tools/ui-test.mjs <outDir> --profile=<devUsername> [width] [height]
// Garden layout (top bar, plot panel with a Rare Durian, TaniBot hint) on a NEW dev garden (fake-chain server!): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --layout=<newDevUsername> [width] [height]
// TaniBot motion (jets, landing, idle moments) on a NEW dev garden (fake-chain server!): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --motion=<newDevUsername> [width] [height]
// Market rows (needs an EXISTING dev garden with fruit; fake-chain server): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --market=<devUser> [width] [height]
// Fullscreen layout at several screen sizes (EXISTING dev garden): node tools/ui-test.mjs <outDir> --fullscreen=<devUser>
// TaniBot tiers in the garden (EXISTING dev garden with TaniBot ON; FAKE_DB=<fake server's sqlite> NEXT_XP=<xp> to raise its XP live; UI_URL=...?record=1 checks that no share card opens): node tools/ui-test.mjs <outDir> --tiers=<devUser>
// Village train frames, hotspot hit test and hover (EXISTING dev garden, no changes): node tools/ui-test.mjs <outDir> --train=<devUser> [w] [h]
// Water drone (EXISTING dev garden with a tree; fake-chain server): node tools/ui-test.mjs <outDir> --water=<devUser> [w] [h] (REDUCED_MOTION=1 too)
// Info (i) bubbles in every panel of an EXISTING dev garden (fake-chain server): node tools/ui-test.mjs <outDir> --info=<devUser> [w] [h]
// Garden scene of an EXISTING dev garden (no changes): UI_URL='http://localhost:5173/?time=dusk' node tools/ui-test.mjs <outDir> --scene=<devUser> [w] [h]
//   PINS=1 checks the pins and (phones) the sheet; it always reports the garden (mounds, plots and village in view, TaniBot clear of other plots and labels).
//   Add &bg=v1 to UI_URL for the first village. REDUCED_MOTION=1 emulates prefers-reduced-motion.
// Tutorial on a NEW dev garden (fake-chain server!): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --tutorial=<newDevUser> [w] [h]
// Phone garden fit on a NEW dev garden (fake-chain server; FAKE_DB=<its sqlite> adds seeds, fruit, items): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --phonefit=<newDevUser> [w] [h]
// Garden visit of an EXISTING dev garden (fake-chain server): opens <friend>'s garden from the farmer list, checks the
//   name in the visit panel (no sky sign any more), their TaniBot (tier, ON / asleep, no menu) and its hello bubble:
//   UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --visit=<devUser>:<friend> [w] [h]
// Create-garden form on a NEW dev user (fake-chain server; never submits): typing stops at 16 characters, the "n/16"
//   counter, a pasted 20-character name is cut to 16: UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --create=<newDevUser> [w] [h]
// Referral + stickers (fake-chain server; API_URL = that server, default http://127.0.0.1:8788; FAKE_DB=<its sqlite>
//   also ripens the new garden's tree for a paid referral): makes <friend> (dev, with a tree and TaniBot ON) through the API, opens
//   the landing page /?ref=<friend> and clicks "Play for free", makes the NEW garden <newUser> (tutorial on), visits <friend> (coach + Judge chip hidden, comes
//   back unchanged), leaves a sticker, then signs in as <friend>: Invite a friend + Visitors in the Village tab:
//   UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --social=<newUser>:<friend> [w] [h]
// How to play pages (login page): node tools/ui-test.mjs <outDir> --howto [w] [h]
// Try as Judge (one click, then the whole tour; a NEW judge garden each run, so use a fake-chain server or a fresh browser profile): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --judge [width] [height]
// TaniBot window on a NEW dev garden: activate, add budget, take back (button text, green toast, budget flash) (use a fake-chain server!): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --tanibot=<newDevUsername> [width] [height]
// Drives headless Chrome (temporary profile) through the NEARvest web game via CDP.
// Usage: node ui-test.mjs <outDir> <playerName>
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
const name = process.argv[3];
const W = Number(process.argv[4] ?? 390), H = Number(process.argv[5] ?? 844);
const MOBILE = W < 1024;
mkdirSync(out, { recursive: true });
const PORT = 9333;
const UI_URL_RAW = process.env.UI_URL ?? 'http://localhost:5173';
// The game lives at /play (/ is the landing page): a bare site address points at /play.
const UI_URL = (() => {
  const u = new URL(UI_URL_RAW);
  if (u.pathname === '/' || u.pathname === '') u.pathname = '/play';
  return u.toString().replace(/\/play\/$/, '/play');
})();
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${out}/profile`,
  '--no-first-run', '--no-default-browser-check', `--window-size=${W},${H}`, 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((t) => t.type === 'page'); } catch {}
  if (!target) await sleep(200);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let seq = 0; const waiting = new Map(); const problems = [];
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && waiting.has(msg.id)) { waiting.get(msg.id)(msg); waiting.delete(msg.id); }
  if (msg.method === 'Runtime.exceptionThrown') problems.push('exception: ' + msg.params.exceptionDetails.exception?.description);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
    problems.push(`console.${msg.params.type}: ` + msg.params.args.map((a) => a.value ?? a.description).join(' '));
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') problems.push('log: ' + msg.params.entry.text + ' ' + (msg.params.entry.url ?? ''));
});
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; waiting.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'eval failed');
  return r.result?.result?.value;
};
let shot = 0;
const screenshot = async (label) => {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = `${out}/${String(++shot).padStart(2, '0')}-${label}.png`;
  writeFileSync(file, Buffer.from(r.result.data, 'base64'));
  console.log('screenshot', file);
};
const waitFor = async (expr, what, timeout = 30000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await evaluate(expr)) return; await sleep(300); }
  throw new Error('timeout waiting for ' + what);
};
const clickText = (text, scope = 'button') => evaluate(`(() => {
  const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find(b => (b.textContent.includes(${JSON.stringify(text)}) || (b.getAttribute('aria-label') || '').includes(${JSON.stringify(text)})) && !b.disabled);
  if (!el) return false; el.click(); return true; })()`);
const typeInto = (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
// Case-insensitive: titles are shown in UPPER CASE (text-transform), which innerText reflects.
const bodyHas = (t) => `!!document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(t.toLowerCase())})`;
/** One notice at most, one thin line, never over TaniBot, the plots, the bottom panel, tabs, menu or a window. */
const TOAST_CHECK = `(() => {
  const ts = [...document.querySelectorAll('.toasts > .toast')].filter(t => getComputedStyle(t).visibility !== 'hidden');
  if (!ts.length) return 'none showing';
  const t = ts[0].getBoundingClientRect();
  const hit = (q) => q.width && t.left < q.right && q.left < t.right && t.top < q.bottom && q.top < t.bottom;
  const over = ['.bot-spot .tanibot', '.plot-art', '.soil', '.garden-sheet', '.hud-bar', '.tabs', '.hud-drawer', '.hud-rail', '.dialog-backdrop > *', '.hud-top .hud-capsule', '.topbar', '.hud-chips'].filter(sel => [...document.querySelectorAll(sel)].some(e => hit(e.getBoundingClientRect())));
  return ts.length + ' showing | ' + Math.round(t.height) + 'px high | "' + ts[0].innerText.replace(/\\n/g, ' ') + '" | covers: ' + (over.join(', ') || 'nothing');
})()`;
const step = async (label, fn) => { console.log('==', label); await fn(); };

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE });
await send('Emulation.setTouchEmulationEnabled', { enabled: MOBILE });
// REDUCED_MOTION=1: emulate prefers-reduced-motion: reduce.
if (process.env.REDUCED_MOTION) await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
const realClick = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };

try {
  await step('open login', async () => {
    await send('Page.navigate', { url: UI_URL });
    await waitFor(bodyHas('Grow. Harvest. Own.'), 'login screen');
    await sleep(800); await screenshot('login');
    await realClick(5, 5); // a real pointer event unlocks audio
  });
  if (name.startsWith('--layout=')) {
    await step('garden layout on a new dev garden', async () => {
      const user = name.slice('--layout='.length);
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(bodyHas('Welcome to Tandur'), 'create screen');
      await typeInto('.create input:not([type=checkbox])', user);
      await clickText('Start farming');
      await waitFor(`!!document.querySelector('.plots')`, 'garden');
      await waitFor(`!document.body.innerText.includes('Creating your NEAR account')`, 'account', 60000);
      await evaluate(`document.querySelectorAll('.plot')[0].click()`);
      await sleep(800); await screenshot('seed-cards');
      console.log('asleep bubble:', await evaluate(`document.querySelector('.bot-hint')?.innerText`), '| chip:', await evaluate(`document.querySelector('.bot-status')?.innerText`), '| zzz:', await evaluate(`!!document.querySelector('.bot-zzz')`));
      console.log('TaniBot shortcut:', await evaluate(`!!document.querySelector('.rail-bot, .tab-bot, .drawer-bot')`), '| dot:', await evaluate(`document.querySelector('.bot-dot')?.className`));
      console.log('seed cards:', await evaluate(`[...document.querySelectorAll('.seed-card')].map(c => c.innerText.replace(/\\n/g, ' / ')).join(' || ')`));
      // "Not now": the bubble goes away and does not come back after a reload in the same session.
      await clickText('Not now');
      await sleep(300);
      const goneNow = await evaluate(`!document.querySelector('.bot-nudge')`);
      await send('Page.reload');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden after reload');
      await sleep(4500);
      console.log('Not now: hidden', goneNow, '| still hidden after reload:', await evaluate(`!document.querySelector('.bot-nudge')`));
      await evaluate(`document.querySelectorAll('.plot')[0].click()`);
      await sleep(400);
      await clickText('Durian', '.seed-card');
      await waitFor(`!!document.querySelector('.plot .tree')`, 'planted');
      if (MOBILE) {
        // Phones: toasts sit above the plot sheet, never on it.
        await waitFor(`!!document.querySelector('.toast')`, 'toast', 15000).catch(() => {});
        console.log('toast above the sheet:', await evaluate(`(() => { const t = [...document.querySelectorAll('.toast')].pop(); const s = document.querySelector('.plot-sheet'); if (!t || !s) return 'no toast'; return t.getBoundingClientRect().bottom <= s.getBoundingClientRect().top + 1; })()`));
        console.log('toast:', await evaluate(TOAST_CHECK));
        await screenshot('toast');
      }
      await clickText('Water');
      await waitFor(`[...document.querySelectorAll('.act-water')].some(b => /Watered/.test(b.innerText))`, 'watered');
      // The chain notices of plant + water arrive now: still one thin line, covering nothing.
      await waitFor(`!!document.querySelector('.toast-chain')`, 'chain notice', 20000).catch(() => {});
      console.log('toast after chain jobs:', await evaluate(TOAST_CHECK));
      await screenshot('toast-chain');
      await sleep(1500); await screenshot('plot-panel');
      const overlap = await evaluate(`(() => {
        const bar = document.querySelector('.hud-bar .panel') || document.querySelector('.garden-screen .panel');
        if (!bar) return 'no panel';
        const els = [...bar.querySelectorAll('h2, .tree-info, .odds-line, .progress, .fert-badge, .actions, .btn, p')].filter(e => e.offsetParent);
        const r = els.map(e => [e.className || e.tagName, e.getBoundingClientRect()]);
        const hits = [];
        for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) {
          const [a, A] = r[i], [b, B] = r[j];
          if (A.width && B.width && A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1 && !els[i].contains(els[j]) && !els[j].contains(els[i])) hits.push(a + ' x ' + b);
        }
        const pr = bar.getBoundingClientRect();
        const cut = els.filter(e => { const x = e.getBoundingClientRect(); return x.bottom > pr.bottom + 1 || x.right > pr.right + 1; }).map(e => e.className || e.tagName);
        return JSON.stringify({ overlaps: hits, cutOff: cut, scroll: bar.scrollHeight > bar.clientHeight + 1 });
      })()`);
      console.log('plot panel:', overlap);
      console.log('plots covered by the action bar:', await evaluate(`(() => { const B = document.querySelector('.hud-bar .panel')?.getBoundingClientRect(); if (!B) return 'no bar (phone)'; return [...document.querySelectorAll('.plot .soil')].some(p => { const P = p.getBoundingClientRect(); return P.bottom > B.top + 1 && P.right > B.left && P.left < B.right; }); })()`));
      // Switch TaniBot on (fake chain) and watch the garden.
      await evaluate(`document.querySelector('.bot-click').click()`);
      await waitFor(bodyHas('Activate TaniBot'), 'activate panel');
      await clickText('Activate TaniBot');
      await waitFor(bodyHas('Wallet and budget'), 'bot ready', 60000);
      await clickText('Close');
      await waitFor(`document.querySelector('.bot-status')?.innerText === 'ON'`, 'ON chip', 30000);
      const tagOverlap = await evaluate(`(() => { const c = document.querySelector('.bot-status').getBoundingClientRect(); return [...document.querySelectorAll('.plot-status, .badge, .bot-hint')].some(e => { const r = e.getBoundingClientRect(); return r.width && c.left < r.right && r.left < c.right && c.top < r.bottom && r.top < c.bottom; }); })()`);
      console.log('ON chip overlaps a timer/bubble:', tagOverlap, '| dot:', await evaluate(`document.querySelector('.bot-dot')?.className`));
      await sleep(400); await screenshot('bot-on');
      // The short action bubble ("Watered 1 tree.") appears after TaniBot's next action, then fades away.
      await waitFor(`!!document.querySelector('.bot-hint-flash')`, 'action bubble', 150000);
      console.log('action bubble:', await evaluate(`document.querySelector('.bot-hint-flash').innerText`));
      await sleep(300); await screenshot('bot-bubble');
      await sleep(5000);
      console.log('bubble gone after ~4 s:', await evaluate(`!document.querySelector('.bot-hint-flash') || getComputedStyle(document.querySelector('.bot-hint-flash')).opacity === '0'`));
    });
    throw Object.assign(new Error('layout done'), { done: true });
  }
  if (name.startsWith('--tiers=')) {
    await step('TaniBot tiers', async () => {
      const user = name.slice('--tiers='.length);
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await sleep(2500);
      const info = () => evaluate(`(() => { const t = document.querySelector('.bot-spot .tanibot'); return JSON.stringify({ tier: t?.className, drones: document.querySelectorAll('.bot-drones .drone').length, parked: !!document.querySelector('.bot-drones.parked'), aura: !!t?.querySelector('.bot-aura'), halo: !!t?.querySelector('.bot-halo'), prop: !!t?.querySelector('.bot-prop'), leaf: !!t?.querySelector('.bot-leaf'), title: document.querySelector('.title-line')?.innerText }); })()`);
      console.log('garden:', await info());
      await screenshot('tier-garden');
      // Drones: 4 moments of the 8 s orbit (sides and behind; never over the face).
      for (let i = 1; i <= 4; i++) {
        await sleep(2000);
        console.log(`drone frame ${i}:`, await evaluate(`[...document.querySelectorAll('.bot-drones .orbit')].map(o => getComputedStyle(o).zIndex).join(',')`));
        await screenshot(`drones-${i}`);
      }
      if (process.env.FAKE_DB && process.env.NEXT_XP) {
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(process.env.FAKE_DB);
        db.prepare("UPDATE players SET xp = ? WHERE name = ? OR user_id = (SELECT id FROM users WHERE provider = 'dev' AND subject = ?)").run(Number(process.env.NEXT_XP), user, user);
        db.close();
        await waitFor(`!!document.querySelector('.bot-spot.evolving')`, 'evolution moment', 20000);
        await sleep(500); await screenshot('evolving-flash');
        console.log('evolving: scan line', await evaluate(`!!document.querySelector('.bot-evolve-scan')`));
        await sleep(2600);
        console.log('after evolution:', await info());
        await screenshot('evolved');
        // The share card opens ~2.6 s after the moment (not with ?record=1 in UI_URL).
        await sleep(1500);
        console.log('share card open:', await evaluate(`!!document.querySelector('.share-card')`), '| toast:', await evaluate(`[...document.querySelectorAll('.toast')].map(t => t.innerText).join(' | ')`));
        await screenshot('after-moment');
      }
      // Avatars: TaniBot heads unlock with titles.
      await evaluate(`document.querySelector('.who-btn').click()`);
      await waitFor(`!!document.querySelector('[aria-label="Profile"]')`, 'profile');
      await clickText('Change avatar');
      await sleep(400);
      console.log('avatar heads:', await evaluate(`[...document.querySelectorAll('.avatar-choice')].filter(b => (b.title || '').includes('TaniBot') || b.classList.contains('locked')).map(b => (b.classList.contains('locked') ? 'LOCKED ' : '') + b.innerText.trim()).join(' | ')`));
      await evaluate(`document.querySelector('.avatar-grid').scrollIntoView()`);
      await sleep(300); await screenshot('avatars');
    });
    throw Object.assign(new Error('tiers done'), { done: true });
  }
  if (name.startsWith('--market=')) {
    await step('Market rows', async () => {
      await typeInto('#dev-user', name.slice('--market='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      if (MOBILE) await clickText('Market', '.tab'); else await evaluate(`[...document.querySelectorAll('.rail-btn, .side-tabs button')].find(b => b.textContent.includes('Market'))?.click()`);
      await waitFor(`!!document.querySelector('.market-rows')`, 'market');
      await sleep(800); await screenshot('market');
      console.log('panel title:', await evaluate(`[...document.querySelectorAll('.panel-head h2')].map(h => h.innerText).join(' | ')`));
      console.log('speech:', await evaluate(`document.querySelector('.market-scene .speech').innerText`));
      console.log('rows:', await evaluate(`[...document.querySelectorAll('.market-panel .market-row')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' || ')`));
      const fit = await evaluate(`(() => { const rows = [...document.querySelectorAll('.market-panel .market-row')]; return rows.map(r => { const h = r.querySelector('.market-price').getBoundingClientRect(); const s = r.querySelector('.sell-go').getBoundingClientRect(); return Math.round(s.bottom - h.top); }).join(','); })()`);
      console.log('price-to-sell height per row (px):', fit);
      const balBefore = await evaluate(`document.querySelector('.chip-panen b').innerText`);
      const row = await evaluate(`(() => { const r = [...document.querySelectorAll('.market-panel .market-row')].find(x => !x.classList.contains('empty')); if (!r) return 'none'; r.querySelector('.sell-max').click(); return r.querySelector('.market-name').innerText; })()`);
      await sleep(200);
      const label = await evaluate(`[...document.querySelectorAll('.market-panel .market-row')].find(x => !x.classList.contains('empty')).querySelector('.sell-go').innerText`);
      await evaluate(`[...document.querySelectorAll('.market-panel .market-row')].find(x => !x.classList.contains('empty')).querySelector('.sell-go').click()`);
      await waitFor(bodyHas('Sold'), 'sold toast', 20000);
      await sleep(600);
      console.log('sold', row, 'with', label, '| balance', balBefore, '->', await evaluate(`document.querySelector('.chip-panen b').innerText`));
      await screenshot('market-sold');
      const hasSeeds = await evaluate(`!!document.querySelector('details.sell-seeds')`);
      if (hasSeeds) {
        await evaluate(`document.querySelector('details.sell-seeds > summary').click()`);
        await sleep(400);
        await evaluate(`document.querySelector('details.sell-seeds').scrollIntoView()`);
        await sleep(300); await screenshot('market-seeds');
        console.log('seed rows:', await evaluate(`[...document.querySelectorAll('details.sell-seeds .market-row')].map(r => r.innerText.replace(/\\s+/g, ' ')).join(' || ')`));
      }
    });
    throw Object.assign(new Error('market done'), { done: true });
  }
  if (name.startsWith('--fullscreen=')) {
    await step('fullscreen layout', async () => {
      await typeInto('#dev-user', name.slice('--fullscreen='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      const hudCheck = `(() => {
        const r = (sel) => { const e = document.querySelector(sel); if (!e) return null; const b = e.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
        const left = r('.hud-left'), cap = r('.hud-capsule-left'), sys = r('.hud-sys'), rail = r('.hud-rail') || r('.hud-drawer'), bar = r('.hud-bar .panel');
        const W = innerWidth, H = innerHeight;
        const els = ['.hud-capsule-left', '.hud-chips', '.hud-sys', '.hud-rail', '.hud-drawer', '.hud-bar .panel'].map(s => [s, r(s)]).filter(([, b]) => b && b.r > b.l);
        const overlaps = [];
        for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const [a, A] = els[i], [c, C] = els[j]; if (A.l < C.r && C.l < A.r && A.t < C.b && C.t < A.b) overlaps.push(a + ' x ' + c); }
        for (const p of document.querySelectorAll('.plot .soil')) { const P = p.getBoundingClientRect(); const B = document.querySelector('.hud-bar .panel')?.getBoundingClientRect(); if (B && P.bottom > B.top + 1 && P.right > B.left && P.left < B.right) overlaps.push('plot soil x action bar'); }
        return JSON.stringify({ edgeLeft: cap.l, edgeTop: cap.t, edgeRight: W - sys.r, edgeBottom: bar ? H - bar.b : null, topsAligned: cap.t === sys.t, railRightAligned: rail ? rail.r === sys.r : 'no rail', railGapBelowSys: rail ? rail.t - sys.b : null, chips: document.querySelector('.hud-chips')?.innerText.replace(/\\s+/g, ' '), overlaps });
      })()`;
      for (const [w, h] of [[1280, 800], [1440, 900], [1920, 1080]]) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
        await evaluate(`document.dispatchEvent(new Event('fullscreenchange'))`);
        await sleep(900);
        const r = await evaluate(`(() => { const a = document.querySelector('.bg-art').getBoundingClientRect(); return JSON.stringify({ k: getComputedStyle(document.querySelector('.scene')).getPropertyValue('--k'), covers: a.left <= 0 && a.top <= 0 && a.right >= innerWidth && (a.bottom >= innerHeight || !!document.querySelector('.bg-soil-ext')) }); })()`);
        console.log(`fullscreen ${w}x${h}:`, r, '| HUD', await evaluate(hudCheck));
        await screenshot(`fullscreen-${w}x${h}`);
      }
      // Drawer closed: the rail.
      await evaluate(`document.querySelector('.drawer-close')?.click()`);
      await sleep(600);
      console.log('rail closed: HUD', await evaluate(hudCheck));
      console.log('rail buttons:', await evaluate(`[...document.querySelectorAll('.hud-rail .rail-btn')].map(b => b.innerText.trim()).join(', ')`));
      console.log('check-in chip:', await evaluate(`(() => { const b = document.querySelector('.chip-checkin'); return b ? b.className + ' | ' + b.innerText.replace(/\\s+/g, ' ') + ' | dot ' + !!b.querySelector('.chip-dot') + ' | check ' + !!b.querySelector('.chip-check') : 'missing'; })()`));
      await screenshot('rail');
      await evaluate(`document.querySelector('.chip-checkin').click()`);
      await sleep(400);
      console.log('check-in window opens:', await evaluate(`!!document.querySelector('.checkin-dialog .calendar')`));
      await screenshot('checkin-window');
      await clickText('Close');
      // Leaving fullscreen (Esc) back to a window with browser bars.
      await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
      await evaluate(`document.dispatchEvent(new Event('fullscreenchange'))`);
      await sleep(900);
      console.log('after Esc 1280x720:', await evaluate(`(() => { const a = document.querySelector('.bg-art').getBoundingClientRect(); return JSON.stringify({ window: innerWidth + 'x' + innerHeight, k: getComputedStyle(document.querySelector('.scene')).getPropertyValue('--k'), covers: a.left <= 0 && a.top <= 0 && a.right >= innerWidth && (a.bottom >= innerHeight || !!document.querySelector('.bg-soil-ext')) }); })()`));
    });
    throw Object.assign(new Error('fullscreen done'), { done: true });
  }
  if (name.startsWith('--motion=')) {
    await step('TaniBot motion', async () => {
      const user = name.slice('--motion='.length);
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(bodyHas('Welcome to Tandur'), 'create screen');
      await typeInto('.create input:not([type=checkbox])', user);
      await clickText('Start farming');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await waitFor(`!document.body.innerText.includes('Creating your NEAR account')`, 'account', 60000);
      console.log('new garden: asleep', await evaluate(`!!document.querySelector('.bot-click.asleep')`), '| chip', await evaluate(`document.querySelector('.bot-status')?.innerText`));
      // Asleep: moving shows no jets.
      await evaluate(`document.querySelectorAll('.plot')[1].click()`);
      await sleep(250);
      console.log('asleep move: jets visible', await evaluate(`!!document.querySelector('.bot-jet')`));
      await evaluate(`document.querySelectorAll('.plot')[0].click()`);
      await sleep(900);
      // Switch on.
      await evaluate(`document.querySelector('.bot-click').click()`);
      await waitFor(bodyHas('Activate TaniBot'), 'activate panel');
      await clickText('Activate TaniBot');
      await waitFor(bodyHas('Wallet and budget'), 'bot ready', 60000);
      await clickText('Close');
      await waitFor(`document.querySelector('.bot-status')?.innerText === 'ON'`, 'ON', 30000);
      await sleep(1500);
      await evaluate(`document.querySelectorAll('.plot')[1].click()`);
      await sleep(280);
      console.log('moving:', await evaluate(`document.querySelector('.bot-spot').className`), '| jets', await evaluate(`getComputedStyle(document.querySelector('.bot-jet')).display`), '| dust', await evaluate(`document.querySelector('.bot-dust')?.className`));
      await screenshot('moving');
      await sleep(560);
      console.log('landing:', await evaluate(`document.querySelector('.bot-spot').className`), '| dust', await evaluate(`document.querySelector('.bot-dust')?.className`));
      await screenshot('landing');
      const seen = new Set();
      for (let i = 0; i < 60 && seen.size < 3; i++) {
        const c = await evaluate(`document.querySelector('.bot-spot').className`);
        for (const k of c.split(' ')) if (k.startsWith('idle-')) seen.add(k);
        await sleep(500);
      }
      console.log('idle moments seen:', [...seen].join(', '));
    });
    throw Object.assign(new Error('motion done'), { done: true });
  }
  if (name.startsWith('--cards=')) {
    await step('share card dialog (EXISTING dev garden; opens a preview card, no post)', async () => {
      await typeInto('#dev-user', name.slice('--cards='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close').forEach(b => b.click())`);
      if (MOBILE) await clickText('Village', '.tab'); else await evaluate(`[...document.querySelectorAll('.rail-btn, .side-tabs button')].find(b => b.textContent.includes('Village'))?.click()`);
      await waitFor(`!!document.querySelector('.share-preview > summary')`, 'village');
      await evaluate(`document.querySelector('.share-preview > summary').click()`);
      // Every kind of card: open it, save the card image, close it with the x in the corner.
      const kinds = await evaluate(`[...document.querySelectorAll('.share-preview button'), ...[...document.querySelectorAll('button')].filter(b => /farmer card/i.test(b.innerText))].map(b => b.innerText.trim())`);
      for (const [i, label] of kinds.entries()) {
        await clickText(label, 'button');
        await waitFor(`!!document.querySelector('.share-card img')`, 'card image ' + label, 15000);
        await sleep(400);
        if (i === 0) {
          await screenshot('card-dialog');
          console.log('card image size:', await evaluate(`(() => { const i = document.querySelector('.share-card img'); return i.naturalWidth + 'x' + i.naturalHeight + ' shown ' + Math.round(i.getBoundingClientRect().width) + 'px'; })()`), '| buttons:', await evaluate(`[...document.querySelectorAll('.share-dialog button, .share-dialog a.btn')].map(b => b.innerText.trim()).join(' / ')`));
          console.log('x in the top right corner:', await evaluate(`(() => { const x = document.querySelector('.share-dialog .share-x').getBoundingClientRect(); const d = document.querySelector('.share-dialog').getBoundingClientRect(); return Math.round(d.right - x.right) + 'px from the right, ' + Math.round(x.top - d.top) + 'px from the top'; })()`));
        }
        const data = await evaluate(`document.querySelector('.share-card img').src`);
        writeFileSync(`${out}/card-${String(i + 1).padStart(2, '0')}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`, Buffer.from(data.split(',')[1], 'base64'));
        await evaluate(`document.querySelector('.share-dialog .share-x').click()`);
        await sleep(300);
        console.log('card', label, '| closed with x:', await evaluate(`!document.querySelector('.share-dialog')`));
      }
    });
    throw Object.assign(new Error('cards done'), { done: true });
  }
  if (name.startsWith('--train=')) {
    await step('village: train frames, rotors, hotspots (EXISTING dev garden, no changes)', async () => {
      await typeInto('#dev-user', name.slice('--train='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close').forEach(b => b.click())`);
      await evaluate(`document.querySelector('.drawer-close')?.click()`);
      await sleep(800);
      // Train frames: freeze the 18 s run at a few points (dev builds: window.__trainT).
      for (const t of [1.5, 4, 7, 10, 13, 16, 18.5, 20, 21.5]) {
        await evaluate(`window.__trainT = ${t}`);
        await sleep(400);
        // v3: one sloped train image (never rotated); its bottom must sit on the rail's top.
        console.log(`train at ${t}s:`, await evaluate(`[...document.querySelectorAll('.train-car, .slope-train')].map(c => { const r = c.getBoundingClientRect(); return (c.classList.contains('slope-train') ? 'slope-train size=' + c.dataset.size + ' opacity=' + getComputedStyle(c).opacity + ' rotate=' + getComputedStyle(c).transform : c.className.split(' ')[1] + ' ' + c.dataset.angle + 'deg') + ' @' + Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }).join(' | ') || 'not on screen'`));
        await screenshot(`train-${t}s`);
      }
      await evaluate(`delete window.__trainT`);
      // Hotspots: what is on top at each hotspot's centre (must be the hotspot), and at each plot (must be the plot).
      console.log('hit test:', await evaluate(`[...document.querySelectorAll('.hotspot')].map(h => { const r = h.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return h.className.split(' ')[1] + '=' + (e === h ? 'ok' : (e?.className || e?.tagName)); }).join(' | ')`));
      console.log('plots still win:', await evaluate(`[...document.querySelectorAll('.plot')].map(p => { const r = p.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.bottom - 6); return p.contains(e) ? 'ok' : (e?.className || e?.tagName); }).join(' | ')`));
      const hs = await evaluate(`(() => { const h = document.querySelector('.hs-shop'); const r = h.getBoundingClientRect(); for (let y = r.top + 4; y < r.bottom; y += 6) for (let x = r.left + 4; x < r.right; x += 6) if (document.elementFromPoint(x, y) === h) return [x, y]; return [r.left + 4, r.top + 4]; })()`);
      await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hs[0], y: hs[1] });
      await sleep(300); await screenshot('hover-shop');
      await evaluate(`document.querySelector('.hs-arena').click()`);
      await sleep(300); await screenshot('arena-bubble');
      console.log('arena bubble:', await evaluate(`document.querySelector('.hs-bubble')?.innerText.replace(/\\n/g, ' ') ?? 'none'`));
      // Pins: always visible, inside the visible scene, not under the HUD / TaniBot / plots.
      console.log('pins:', await evaluate(`(() => { const obs = [...document.querySelectorAll('.hud-capsule, .hud-chips, .hud-drawer, .hud-rail, .hud-bar, .bot-spot .tanibot, .bot-hint, .badge, .plot-art, .soil')].map(e => e.getBoundingClientRect()).filter(r => r.width); return [...document.querySelectorAll('.place-pin')].map(p => { const r = p.getBoundingClientRect(); const cover = obs.some(o => r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom); const off = r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight; return p.innerText.replace(/\\n/g, ' ') + (cover ? ' COVERS' : '') + (off ? ' OFFSCREEN' : ''); }).join(' | '); })()`));
      await screenshot('pins');
      await evaluate(`document.querySelector('.hs-market').click()`);
      await sleep(500);
      console.log('after market click:', await evaluate(`document.querySelector('.hs-bubble')?.innerText.replace(/\\n/g, ' ') ?? 'no bubble'`), '| market open:', await evaluate(`!!document.querySelector('.market-rows')`));
      await screenshot('after-market');
    });
    throw Object.assign(new Error('train done'), { done: true });
  }
  if (name.startsWith('--water=')) {
    await step('water drone flies to the chosen tree (EXISTING dev garden with a thirsty tree; fake-chain server)', async () => {
      await typeInto('#dev-user', name.slice('--water='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close').forEach(b => b.click())`);
      await sleep(600);
      // Demo days last a minute: wait until some tree can be watered, select it.
      const plot = await (async () => {
        for (let i = 0; i < 90; i++) {
          for (let p = 0; p < 3; p++) {
            await evaluate(`document.querySelectorAll('.plot')[${p}].click()`);
            await sleep(250);
            if (await evaluate(`!!document.querySelector('.act-water:not(:disabled)')`)) return p;
          }
          await sleep(1000);
        }
        return -1;
      })();
      if (plot < 0) throw new Error('no tree to water');
      await clickText('Water', '.act-water');
      for (const [ms, label] of [[250, 'take-off'], [700, 'over-tree'], [1500, 'back']]) {
        await sleep(ms === 250 ? 250 : ms === 700 ? 450 : 800);
        console.log(`water ${label}:`, await evaluate(`(() => {
          const d = document.querySelector('.act-water .fly-drone');
          if (!d) return 'no drone';
          const r = d.getBoundingClientRect();
          const tree = document.querySelectorAll('.plot')[${plot}].querySelector('.plot-art .tree svg') || document.querySelectorAll('.plot')[${plot}].querySelector('.plot-art');
          const t = tree.getBoundingClientRect();
          const top = t.top + t.height * Number(tree.closest('.tree')?.dataset.top ?? 0);
          const drops = [...document.querySelectorAll('.act-water .drop')].filter(x => getComputedStyle(x).opacity > 0.05).length;
          return 'drone centre ' + Math.round(r.left + r.width / 2) + ' vs tree centre ' + Math.round(t.left + t.width / 2) + ' | drone bottom ' + Math.round(r.bottom) + ' vs crown top ' + Math.round(top) + ' | drops falling ' + drops;
        })()`));
        await screenshot(`water-${label}`);
      }
    });
    throw Object.assign(new Error('water done'), { done: true });
  }
  if (name.startsWith('--info=')) {
    await step('info (i) bubbles in every panel (EXISTING dev garden with a tree and TaniBot)', async () => {
      await typeInto('#dev-user', name.slice('--info='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close').forEach(b => b.click())`);
      await sleep(800);
      // Click every (i) visible now, check its bubble, close it with its x.
      const checkAll = async (where) => {
        // With a window open only its own (i) buttons count (the rest is behind it).
        const pick = `[...(document.querySelector('.dialog-backdrop .dialog') || document).querySelectorAll('.info-i')].filter(b => b.getClientRects().length && getComputedStyle(b).visibility !== 'hidden')`;
        const n = await evaluate(pick + '.length');
        const out = [];
        for (let i = 0; i < n; i++) {
          const r = await evaluate(`(async () => {
            const b = ${pick}[${i}];
            b.scrollIntoView({ block: 'center' });
            await new Promise(r => setTimeout(r, 150));
            b.click();
            await new Promise(r => setTimeout(r, 250));
            const bub = document.querySelector('.info-bubble');
            if (!bub) return 'NO BUBBLE (' + b.getAttribute('aria-label') + ')';
            const q = bub.getBoundingClientRect();
            const inside = q.left >= 0 && q.top >= 0 && q.right <= innerWidth && q.bottom <= innerHeight;
            const text = bub.innerText.replace('×', '').trim();
            const words = text.split(' ').length;
            return b.getAttribute('aria-label').replace('What is ', '').replace('?', '') + ': ' + words + ' words' + (inside ? '' : ' OUTSIDE-SCREEN');
          })()`);
          if (i === 0) await screenshot(`info-${where}`);
          await evaluate(`document.querySelector('.info-bubble-x')?.click()`);
          await sleep(150);
          out.push(r);
        }
        console.log(`info in ${where} (${n}):`, out.join(' | ') || 'none', '| bubble left open:', await evaluate(`!!document.querySelector('.info-bubble')`));
      };
      await checkAll('garden');
      if (MOBILE) {
        await evaluate(`document.querySelector('.sheet-toggle')?.click()`);
        await sleep(400);
        await checkAll('plot-sheet');
        await evaluate(`document.querySelector('.sheet-toggle')?.click()`);
      }
      for (const tab of ['Storage', 'Shop', 'Market', 'Village']) {
        if (MOBILE) await evaluate(`[...document.querySelectorAll('.tabs .tab')].find(t => t.innerText.includes(${JSON.stringify(tab)}))?.click()`);
        else await evaluate(`[...document.querySelectorAll('.rail-btn, .side-tabs .tab')].find(t => t.innerText.includes(${JSON.stringify(tab)}))?.click()`);
        await sleep(900);
        await checkAll(tab.toLowerCase());
      }
      if (MOBILE) await evaluate(`[...document.querySelectorAll('.tabs .tab')].find(t => t.innerText.includes('Garden'))?.click()`);
      await sleep(400);
      await evaluate(`document.querySelector('.bot-click').click()`);
      await sleep(1200);
      await checkAll('tanibot');
      // Esc and a tap outside close the bubble too.
      await evaluate(`[...document.querySelectorAll('.info-i')].find(b => b.getClientRects().length)?.click()`);
      await sleep(200);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape' });
      await sleep(200);
      console.log('Esc closes the bubble:', await evaluate(`!document.querySelector('.info-bubble')`));
    });
    throw Object.assign(new Error('info done'), { done: true });
  }
  if (name.startsWith('--create=')) {
    await step('create-garden form: name limit 16 (NEW dev user; does not create the garden)', async () => {
      await typeInto('#dev-user', name.slice('--create='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('form.create input:not([type])')`, 'create form');
      const field = `document.querySelector('form.create input:not([type])')`;
      const read = `(() => { const i = ${field}; return 'value "' + i.value + '" (' + i.value.length + ') | counter "' + document.querySelector('.name-count').innerText + '" | preview "' + document.querySelector('.account-preview').innerText + '"'; })()`;
      // Real key presses: 8 letters, then 12 more (the field stops at 16).
      await evaluate(`${field}.focus()`);
      await send('Input.insertText', { text: 'tanifarm' });
      await sleep(200);
      console.log('typed 8:', await evaluate(read));
      await screenshot('create-8');
      for (const ch of 'abcdefghijkl') await send('Input.insertText', { text: ch });
      await sleep(200);
      console.log('typed 20:', await evaluate(read));
      await screenshot('create-16');
      // A pasted / scripted 20-character value is cut to 16 as well.
      await typeInto('form.create input:not([type])', 'abcdefghijklmnopqrst');
      await sleep(200);
      console.log('pasted 20:', await evaluate(read));
      console.log('fonts of the counter:', await evaluate(`getComputedStyle(document.querySelector('.name-count')).fontFamily + ' ' + getComputedStyle(document.querySelector('.name-count')).fontSize`));
    });
    throw { done: true };
  }
  if (name.startsWith('--social=')) {
    const [user, friend] = name.slice('--social='.length).split(':');
    const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
    const call = async (method, path, token, body) => {
      const res = await fetch(API + path, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      return res.json();
    };
    const inPage = (path, method = 'GET', body) => evaluate(`fetch(${JSON.stringify(API)} + ${JSON.stringify(path)}, { method: ${JSON.stringify(method)}, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('nearvest.token') }${body ? `, body: ${JSON.stringify(JSON.stringify(body))}` : ''} }).then(r => r.json())`);
    const coachShown = `!!document.querySelector('.coach')`;
    const judgeChip = `!!document.querySelector('.chip-judge')`;
    await step(`friend garden ${friend} through the API`, async () => {
      const { token } = await call('POST', '/auth/dev', null, { username: friend });
      let st = await call('GET', '/api/me', token);
      if (st.error) st = await call('POST', '/api/player', token, { name: friend, demo: true });
      for (let i = 0; i < 40 && st.player.accountStatus !== 'ready'; i++) (await sleep(500), (st = await call('GET', '/api/me', token)));
      if (!st.plots[0].tree) {
        await call('POST', '/api/checkin', token);
        st = await call('GET', '/api/me', token);
        const seed = st.seeds.find((x) => x.species === 'mango') ?? st.seeds[0];
        await call('POST', '/api/plant', token, { plot: 0, seedId: seed.id });
      }
      // The friend's TaniBot (ON), so the visit shows it as decoration.
      let bot = (await call('GET', '/api/tanibot', token)).bot;
      if (!bot) bot = (await call('POST', '/api/tanibot/setup', token, {})).bot;
      for (let i = 0; i < 40 && bot?.status !== 'ready'; i++) (await sleep(500), (bot = (await call('GET', '/api/tanibot', token)).bot));
      console.log(friend + ':', 'account', st.player.accountStatus, '| TaniBot', bot?.status, bot?.enabled ? 'ON' : 'OFF', '| referral box from the server:', !!st.referral, '| stickers list:', Array.isArray(st.stickers));
    });
    await step(`invite link -> NEW garden ${user}`, async () => {
      // Start on the LANDING page (/?ref=), then "Play for free" as a real invited friend would.
      await evaluate(`localStorage.removeItem('nearvest.ref')`);
      const u = new URL('/', UI_URL);
      u.searchParams.set('ref', friend);
      await send('Page.navigate', { url: u.toString() });
      await waitFor(`!!document.querySelector('.lp-play')`, 'landing page');
      console.log('landing links:', await evaluate(`[...document.querySelectorAll('a[href^="/play"]')].map(a => a.getAttribute('href')).join(' ')`));
      await evaluate(`document.querySelector('.lp-play').click()`);
      await waitFor(bodyHas('Grow. Harvest. Own.') + ` && location.pathname === '/play'`, 'login screen');
      await sleep(500);
      console.log('ref kept:', await evaluate(`localStorage.getItem('nearvest.ref')`), '| address bar:', await evaluate(`location.pathname + location.search`));
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(bodyHas('Welcome to Tandur'), 'create screen');
      await typeInto('.create input:not([type=checkbox])', user);
      await clickText('Start farming');
      await waitFor(`!!document.querySelector('.plots')`, 'garden');
      await waitFor(`!document.body.innerText.includes('Creating your NEAR account')`, 'account', 60000);
      await sleep(1500);
      const me = await inPage('/api/me');
      console.log('invited by:', JSON.stringify(me.referral?.invitedBy), '| ref cleared:', await evaluate(`localStorage.getItem('nearvest.ref') === null`));
      console.log('tutorial before the visit:', JSON.stringify(me.tutorial), '| coach shown:', await evaluate(coachShown));
      await screenshot('social-home-coach');
    });
    let stepBefore;
    await step(`visit ${friend}: coach hidden, sticker`, async () => {
      stepBefore = (await inPage('/api/me')).tutorial;
      const opened = await evaluate(`(() => { const p = [...document.querySelectorAll('.place-pin')].find(e => /friends/i.test(e.innerText + (e.getAttribute('aria-label') || ''))); if (!p) return false; p.click(); return true; })()`);
      if (!opened) throw new Error('no Friends pin');
      await sleep(400);
      await evaluate(`document.querySelector('.hotspots .btn-mint')?.click()`);
      await waitFor(`!!document.querySelector('.farmer-row')`, 'farmer rows');
      const ok = await evaluate(`(() => { const row = [...document.querySelectorAll('.farmer-row')].find(r => r.querySelector('.farmer-name')?.innerText.trim().toLowerCase() === ${JSON.stringify(friend.toLowerCase())}); if (!row) return false; row.querySelector('button').click(); return true; })()`);
      if (!ok) throw new Error('friend not in the list: ' + friend);
      await waitFor(`!!document.querySelector('.visit-panel .visit-sub')`, 'visit loaded');
      await sleep(1500);
      console.log('visiting: coach shown', await evaluate(coachShown), '| Judge chip', await evaluate(judgeChip), '| data-tut', await evaluate(`document.querySelector('main.shell').getAttribute('data-tut')`));
      // Sticker vs "← My garden": same height, one row, icon left of the text; the garden name whole (no cut, no word split).
      const btn = `(() => { const b = document.querySelector('.visit-sticker'); if (!b) return 'NO BUTTON'; const r = b.getBoundingClientRect(); const k = document.querySelector('.visit-back').getBoundingClientRect(); const i = b.querySelector('svg').getBoundingClientRect(); const l = b.querySelector('.visit-sticker-label').getBoundingClientRect(); const t = document.querySelector('.visit-title b'); const lines = Math.round(t.getBoundingClientRect().height / parseFloat(getComputedStyle(t).lineHeight || 20)); return '"' + b.innerText.trim() + '" ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' | back ' + Math.round(k.width) + 'x' + Math.round(k.height) + ' | same height: ' + (Math.abs(r.height - k.height) < 1) + ' | same row: ' + (Math.abs(r.top - k.top) < 1) + ' | icon ' + Math.round(i.width) + 'x' + Math.round(i.height) + ' left of text: ' + (i.right <= l.left) + ' | name "' + t.innerText + '" cut: ' + (t.scrollWidth > t.clientWidth + 1) + ' lines: ' + lines + ' | inside screen: ' + (r.left >= 0 && k.right <= innerWidth); })()`;
      console.log('sticker button:', await evaluate(btn));
      console.log('friend TaniBot shown:', await evaluate(`!!document.querySelector('.bot-spot.visit-bot .tanibot')`), '| sky sign gone:', await evaluate(`!document.querySelector('.visit-sign')`));
      await screenshot('social-visit');
      await evaluate(`document.querySelector('.visit-sticker').click()`);
      await waitFor(`!!document.querySelector('.sticker-grid')`, 'sticker picker');
      await sleep(400);
      console.log('picker:', await evaluate(`[...document.querySelectorAll('.sticker-pick')].map(b => b.innerText.trim()).join(' | ')`), '| fits the screen:', await evaluate(`(() => { const d = document.querySelector('.sticker-dialog').getBoundingClientRect(); return d.left >= 0 && d.right <= innerWidth && d.top >= 0 && d.bottom <= innerHeight; })()`));
      await screenshot('social-sticker-picker');
      await evaluate(`[...document.querySelectorAll('.sticker-pick')][0].click()`);
      await waitFor(`!document.querySelector('.sticker-grid')`, 'picker closed');
      await sleep(600);
      console.log('after sending:', await evaluate(btn), '| disabled:', await evaluate(`document.querySelector('.visit-sticker').disabled`), '| toast:', await evaluate(TOAST_CHECK));
      await screenshot('social-sticker-sent');
      await clickText('Back to my garden');
      await sleep(1000);
      const after = (await inPage('/api/me')).tutorial;
      console.log('back home: coach shown', await evaluate(coachShown), '| tutorial unchanged:', JSON.stringify(after) === JSON.stringify(stepBefore), JSON.stringify(after));
      await screenshot('social-back-home');
    });
    if (process.env.FAKE_DB) {
      await step(`${user}'s first harvest pays the referral (FAKE_DB ripens the tree)`, async () => {
        const st = await inPage('/api/me');
        if (!st.plots[0].tree) {
          await inPage('/api/checkin', 'POST', {});
          const s2 = await inPage('/api/me');
          await inPage('/api/plant', 'POST', { plot: 0, seedId: (s2.seeds.find((x) => x.species === 'mango') ?? s2.seeds[0]).id });
        }
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(process.env.FAKE_DB, { timeout: 10000 });
        db.prepare("UPDATE trees SET growth = target WHERE status = 'alive' AND player_id = (SELECT id FROM players WHERE name = ?)").run(user);
        db.close();
        const h = await inPage('/api/harvest', 'POST', { plot: 0 });
        console.log('harvest:', h.result?.kind, '| referral:', JSON.stringify(h.result?.referral), h.error ?? '');
      });
    }
    await step(`sign in as ${friend}: Village tab`, async () => {
      await evaluate(`localStorage.removeItem('nearvest.token')`);
      await send('Page.navigate', { url: UI_URL });
      await waitFor(bodyHas('Grow. Harvest. Own.'), 'login screen');
      await typeInto('#dev-user', friend);
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.plots')`, 'garden');
      await sleep(3000);
      console.log('notice:', await evaluate(TOAST_CHECK));
      await screenshot('social-friend-notice');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close').forEach(b => b.click())`);
      if (MOBILE) await evaluate(`document.querySelector('.tabs .tab-village').click()`);
      else await evaluate(`(document.querySelector('.rail-village') ?? document.querySelector('.side-tabs .tab-village'))?.click()`);
      await waitFor(`!!document.querySelector('.invite-panel')`, 'invite panel');
      await sleep(600);
      await evaluate(`document.querySelector('.invite-panel').scrollIntoView({ block: 'start' })`);
      await sleep(300);
      console.log('invite:', await evaluate(`document.querySelector('.invite-panel').innerText.replace(/\\n+/g, ' / ')`));
      console.log('invite link field:', await evaluate(`document.querySelector('.invite-link input').value`), '| X link:', await evaluate(`document.querySelector('.invite-x').href.slice(0, 60)`));
      console.log('panel inside screen width:', await evaluate(`(() => { const r = document.querySelector('.invite-panel').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth; })()`), '| page scrolls sideways:', await evaluate(`document.documentElement.scrollWidth > innerWidth`));
      await screenshot('social-village-invite');
      await evaluate(`document.querySelector('.visitors-panel').scrollIntoView({ block: 'start' })`);
      await sleep(300);
      console.log('visitors:', await evaluate(`document.querySelector('.visitors-panel').innerText.replace(/\\n+/g, ' / ')`));
      await screenshot('social-village-visitors');
      // Village Stats: the Season note says "lowest level" only at 12.5%.
      await waitFor(`!!document.querySelector('.stats')`, 'Village Stats', 20000);
      await evaluate(`document.querySelector('.stats').scrollIntoView({ block: 'start' })`);
      await sleep(300);
      console.log('season:', await evaluate(`document.querySelector('.stats').innerText.split('\\n').slice(0, 4).join(' / ')`));
      await screenshot('social-village-stats');
    });
    throw { done: true };
  }
  if (name.startsWith('--visit=')) {
    await step('visit a friend garden (EXISTING dev garden; fake-chain server)', async () => {
      const [user, friend] = name.slice('--visit='.length).split(':');
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.plots')`, 'garden');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close').forEach(b => b.click())`);
      await sleep(1500);
      const botSize = `(() => { const b = document.querySelector('.bot-spot .tanibot'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`;
      // The drawn sprite (body layer) in CSS px, with the side menu open and closed (laptops).
      const botBody = `(() => { const b = document.querySelector('.bot-spot .tanibot .bot-body'); if (!b) return 'none'; const r = b.getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`;
      const drawerSizes = async (label) => {
        if (!(await evaluate(`innerWidth >= 1024`))) return console.log(label + ' TaniBot drawn:', await evaluate(botBody));
        const out = [];
        for (const want of ['open', 'closed']) {
          const isOpen = await evaluate(`document.querySelector('.hud-drawer')?.getAttribute('aria-hidden') !== 'true'`);
          if (want === 'open' && !isOpen) await evaluate(`document.querySelector('.hud-rail button')?.click()`);
          if (want === 'closed' && isOpen) await evaluate(`document.querySelector('.drawer-close').click()`);
          await sleep(700);
          out.push('menu ' + want + ' ' + (await evaluate(botBody)));
          await screenshot(label.replace(/\W+/g, '-') + '-menu-' + want);
        }
        await evaluate(`document.querySelector('.hud-rail button')?.click()`);
        await sleep(500);
        console.log(label + ' TaniBot drawn:', out.join(' | '));
      };
      console.log('my TaniBot size:', await evaluate(botSize));
      await drawerSizes('own');
      // Open the farmer list from the Friends pin, then Visit <friend>.
      await waitFor(`!!document.querySelector('.place-pin[aria-label*="Friends" i], .place-pin')`, 'pins');
      const opened = await evaluate(`(() => { const p = [...document.querySelectorAll('.place-pin')].find(e => /friends/i.test(e.innerText + (e.getAttribute('aria-label') || ''))); if (!p) return false; p.click(); return true; })()`);
      if (!opened) throw new Error('no Friends pin');
      await sleep(400);
      // Touch screens: the pin opens a small bubble first; its button opens the place.
      await evaluate(`document.querySelector('.hotspots .btn-mint')?.click()`);
      await waitFor(bodyHas('Farmers of Tandur'), 'farmer list');
      await waitFor(`!!document.querySelector('.farmer-row')`, 'farmer rows');
      const ok = await evaluate(`(() => { const row = [...document.querySelectorAll('.farmer-row')].find(r => r.querySelector('.farmer-name')?.innerText.trim().toLowerCase() === ${JSON.stringify(friend.toLowerCase())}); if (!row) return false; row.querySelector('button').click(); return true; })()`);
      if (!ok) throw new Error('friend not in the list: ' + friend);
      await waitFor(`!!document.querySelector('.visit-panel .visit-sub')`, 'visit loaded');
      await sleep(2500);
      await screenshot('visit-' + friend);
      const report = await evaluate(`(() => {
        const r = (e) => e && e.getBoundingClientRect();
        const hit = (a, b) => a && b && b.width && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const sign = document.querySelector('.visit-sign');
        const sr = r(sign);
        const covers = [['pin', '.place-pin'], ['Darto', '.village-darto'], ['Back button', '.visit-back'], ['HUD', '.hud-top .hud-capsule, .hud-top .hud-chips, .hud-sys, .phone-hud > *'], ['TaniBot', '.bot-spot .tanibot'], ['tree label', '.badge'], ['toast', '.toasts > .toast']]
          .filter(([, q]) => [...document.querySelectorAll(q)].some(e => hit(sr, r(e)))).map(([n]) => n);
        const bot = document.querySelector('.bot-spot');
        return 'sign "' + (sign ? sign.innerText.replace(/\\n/g, ' / ') : (innerWidth >= 1024 ? 'none (laptop: bottom bar only)' : 'MISSING')) + '" ' + (sr ? Math.round(sr.left) + ',' + Math.round(sr.top) + ' ' + Math.round(sr.width) + 'x' + Math.round(sr.height) : '')
          + ' | covers: ' + (covers.join(', ') || 'nothing')
          + ' | inside screen: ' + (sr ? sr.left >= 0 && sr.right <= innerWidth : '-')
          + ' | TaniBot: ' + (bot ? bot.className.match(/tier-\\S+/)[0] + (bot.querySelector('.bot-click.asleep') ? ' asleep' : ' awake') + ' | ON/OFF chip: ' + !!bot.querySelector('.bot-status') + ' | other bubbles: ' + !!bot.querySelector('.bot-nudge, .bot-bye') : 'none')
          + ' | panel name "' + document.querySelector('.visit-title b').innerText.replace(/\\n/g, ' ') + '" cut: ' + (() => { const b = document.querySelector('.visit-title b'); return b.scrollWidth > b.clientWidth + 1 || /…|_$/.test(b.innerText); })()
          + ' | back button "' + [...document.querySelectorAll('.visit-back')].map(b => b.innerText.trim()).join('') + '" ' + Math.round(document.querySelector('.visit-back').getBoundingClientRect().width) + 'px'
          + ' | pins visible: ' + [...document.querySelectorAll('.place-pin')].filter(p => getComputedStyle(p).visibility !== 'hidden').length;
      })()`);
      console.log('visit:', report, '| their TaniBot size:', await evaluate(botSize));
      await drawerSizes('visit');
      if (await evaluate(`!!document.querySelector('.bot-spot .bot-click')`)) {
        await evaluate(`document.querySelector('.bot-spot .bot-click').click()`);
        await sleep(600);
        console.log('hello:', await evaluate(`(() => { const b = document.querySelector('.bot-hello'); if (!b) return 'NO BUBBLE'; const br = b.getBoundingClientRect(); const hit = (q) => [...document.querySelectorAll(q)].some(e => { const o = e.getBoundingClientRect(); return o.width && br.left < o.right && o.left < br.right && br.top < o.bottom && o.top < br.bottom; }); return '"' + b.innerText + '" ' + Math.round(br.width) + 'x' + Math.round(br.height) + ' (' + Math.round(100 * br.width / innerWidth) + '% of the width, font ' + getComputedStyle(b).fontSize + ') | inside screen: ' + (br.left >= 0 && br.right <= innerWidth && br.top >= 0) + ' | covers pin: ' + hit('.place-pin') + ' | covers sign: ' + hit('.visit-sign') + ' | covers Darto: ' + hit('.village-darto') + ' | a window opened: ' + !!document.querySelector('.dialog-backdrop'); })()`));
        await screenshot('visit-' + friend + '-hello');
        await sleep(4200);
        console.log('hello gone after ~4 s:', await evaluate(`!document.querySelector('.bot-hello')`));
      }
      await clickText('Back to my garden');
      await sleep(800);
      console.log('back home: sign gone', await evaluate(`!document.querySelector('.visit-sign')`), '| my TaniBot chip:', await evaluate(`!!document.querySelector('.bot-status')`));
    });
    throw { done: true };
  }
  if (name.startsWith('--scene=')) {
    await step('garden scene (EXISTING dev garden; add ?time=day|dusk|night to UI_URL)', async () => {
      await typeInto('#dev-user', name.slice('--scene='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close').forEach(b => b.click())`);
      await sleep(2500); await screenshot('scene-a');
      if (process.env.BIRDS) {
        // Freeze both flocks in the middle of the sky and report their size (birds: 3-5 game pixels).
        await evaluate(`document.querySelectorAll('.day-flock, .home-flock').forEach(f => { f.style.animationDelay = '${process.env.BIRDS_AT || '-5s'}'; f.style.animationPlayState = 'paused'; })`);
        await sleep(300);
        console.log('birds:', await evaluate(`[...document.querySelectorAll('.bird')].filter(b => getComputedStyle(b.closest('.sky-day, .sky-dusk')).opacity > 0).slice(0, 2).map(b => { const r = b.getBoundingClientRect(); return Math.round(r.left) + ',' + Math.round(r.top) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height); }).join(' | ') || 'none visible'`));
        await screenshot('birds');
      }
      if (process.env.PINS) {
        if (process.env.PINS === 'closed') { await evaluate(`document.querySelector('.drawer-close')?.click()`); await sleep(1500); }
        // Pins: inside the screen, below the top HUD, and not on the HUD, TaniBot, its ON chip, tree timers, plots or the panel.
        console.log('pins:', await evaluate(`(() => { const sel = '.hud-capsule, .hud-chips, .hud-drawer, .hud-rail, .hud-bar, .coach-hud, .topbar, .bot-spot .tanibot, .bot-hint, .bot-status, .badge, .plot-art, .soil, .garden-sheet, .tabs'; const obs = [...document.querySelectorAll(sel)].map(e => [e, e.getBoundingClientRect()]).filter(([, r]) => r.width); const hudBottom = Math.max(0, ...[...document.querySelectorAll('.hud-top .hud-capsule, .hud-top .hud-chips, .hud-sys')].map(e => e.getBoundingClientRect().bottom)); return [...document.querySelectorAll('.place-pin')].map(p => { const r = p.getBoundingClientRect(); const hit = obs.filter(([, o]) => r.left < o.right && o.left < r.right && r.top < o.bottom && o.top < r.bottom).map(([e]) => e.className.split(' ')[0]); const off = r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight; return p.innerText.replace(/\\n/g, ' ') + ' ' + Math.round(r.width) + 'x' + Math.round(r.height) + (hit.length ? ' COVERS ' + hit.join('/') : '') + (off ? ' OFFSCREEN' : '') + (hudBottom && r.top < hudBottom ? ' ABOVE-SAFE-LINE' : ''); }).join(' | '); })()`));
        await screenshot('pins');
        if (MOBILE && await evaluate(`!!document.querySelector('.sheet-toggle')`)) {
          await evaluate(`document.querySelector('.sheet-toggle').click()`);
          await sleep(400);
          console.log('sheet open:', await evaluate(`(() => { const s = document.querySelector('.plot-sheet'); const r = s.getBoundingClientRect(); return s.className + ' ' + Math.round(r.height) + 'px of ' + innerHeight + ' | remembered ' + localStorage.getItem('nearvest.gardenSheet'); })()`));
          await screenshot('sheet-open');
          await evaluate(`document.querySelector('.sheet-toggle').click()`);
          await sleep(1500);
          console.log('sheet closed:', await evaluate(`(() => { const s = document.querySelector('.plot-sheet'); const r = s.getBoundingClientRect(); const tabs = document.querySelector('.tabs').getBoundingClientRect(); return Math.round(100 * r.height / innerHeight) + '% of the screen | gap to tabs ' + Math.round(tabs.top - r.bottom) + 'px | buttons ' + [...s.querySelectorAll('.actions .btn')].map(b => b.innerText.trim()).join(' / '); })()`));
        }
        if (MOBILE) {
          // Phones: no panning; every pin is visible at once and the page never scrolls sideways.
          console.log('pins visible:', await evaluate(`[...document.querySelectorAll('.place-pin')].filter(p => getComputedStyle(p).visibility !== 'hidden' && p.getBoundingClientRect().right <= innerWidth && p.getBoundingClientRect().left >= 0).length`), 'of 5 | page scrolls sideways:', await evaluate(`document.documentElement.scrollWidth > innerWidth || scrollX !== 0`), '| scene box scrolls:', await evaluate(`(() => { const b = document.querySelector('.phone-scene-box'); return b ? b.scrollWidth > b.clientWidth + 1 : 'no box'; })()`));
        }
      }
      // The garden itself: mounds, the whole village and all plots in view, TaniBot clear of the
      // other plots and of the tree labels, pin touch areas.
      console.log('garden:', await evaluate(`(() => {
        const scene = document.querySelector('.scene').getBoundingClientRect();
        const plots = [...document.querySelectorAll('.plot')];
        const sel = document.querySelector('.plot.selected');
        const bot = document.querySelector('.bot-spot .tanibot')?.getBoundingClientRect();
        const hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        const others = plots.filter(p => p !== sel).flatMap(p => [...p.querySelectorAll('.soil:not(.mound), .soil.mound .mound-back, .plot-art .tree, .plot-art > svg, .empty-hint')]).map(e => Object.assign(e.getBoundingClientRect().toJSON(), { what: (e.getAttribute('class') || e.tagName).split(' ')[0] })).filter(r => r.width);
        const labels = [...document.querySelectorAll('.badge')].map(e => e.getBoundingClientRect());
        const art = document.querySelector('.bg-art').getBoundingClientRect();
        const pin = document.querySelector('.place-pin');
        const touch = pin ? getComputedStyle(pin, '::after') : null;
        return 'mounds ' + document.querySelectorAll('.soil.mound').length
          + ' | plots in view ' + plots.filter(p => { const r = p.querySelector('.soil').getBoundingClientRect(); return r.left >= scene.left - 1 && r.right <= scene.right + 1 && r.bottom <= scene.bottom + 1; }).length + '/3'
          + ' | village width in view ' + (art.left >= scene.left - 1 && art.right <= scene.right + 1 ? 'all' : Math.round(100 * (Math.min(art.right, scene.right) - Math.max(art.left, scene.left)) / art.width) + '%')
          + ' | TaniBot covers other plots: ' + (others.filter(r => hit(bot, r)).map(r => 'YES (' + r.what + ')').join(' ') || 'no')
          + ' | TaniBot covers labels: ' + (labels.some(r => hit(bot, r)) ? 'YES' : 'no')
          + (touch && ${MOBILE} ? ' | pin touch area ' + touch.width + ' x ' + touch.height : '');
      })()`));
      // Empty plot on phones: the seed buttons fit in one row (no sideways scrolling), and the sheet stays small.
      if (MOBILE && await evaluate(`!!document.querySelector('.plot-sheet .seed-row')`)) {
        console.log('seed row:', await evaluate(`(() => { const r = document.querySelector('.plot-sheet .seed-row'); const cards = [...r.querySelectorAll('.seed-card')]; const tops = new Set(cards.map(c => Math.round(c.getBoundingClientRect().top))); const s = document.querySelector('.plot-sheet').getBoundingClientRect(); return cards.length + ' buttons (' + cards.map(c => c.innerText.trim()).join(', ') + ') | one row: ' + (tops.size === 1) + ' | scrolls: ' + (r.scrollWidth > r.clientWidth + 1) + ' | all inside: ' + cards.every(c => { const b = c.getBoundingClientRect(); return b.left >= s.left && b.right <= s.right; }) + ' | sheet ' + Math.round(100 * s.height / innerHeight) + '% of the screen'; })()`));
      }
      // Phones: the art fills the scene's width (no blurred sides).
      if (MOBILE) console.log('art width:', await evaluate(`(() => { const a = document.querySelector('.bg-art').getBoundingClientRect(); return Math.round(a.left) + '..' + Math.round(a.right) + ' of ' + innerWidth + ' | blurred sides: ' + !!document.querySelector('.bg-blur'); })()`));
      // TaniBot fully in view (not cut by the scene's edge or the plot sheet) and drawn behind the
      // other trees and labels (what is on top at points of them is never TaniBot).
      console.log('TaniBot view:', await evaluate(`(() => {
        const b = document.querySelector('.bot-spot .tanibot'); if (!b) return 'no TaniBot';
        const r = b.getBoundingClientRect(); const box = (document.querySelector('.phone-scene-box') || document.querySelector('.scene')).getBoundingClientRect();
        const sheet = document.querySelector('.garden-sheet, .hud-bar')?.getBoundingClientRect();
        const floor = Math.min(box.bottom, sheet ? sheet.top : Infinity, innerHeight);
        const cut = r.top < box.top - 1 || r.bottom > floor + 1 || r.left < box.left - 1 || r.right > box.right + 1;
        const sel = document.querySelector('.plot.selected');
        const others = [...document.querySelectorAll('.plot')].filter(p => p !== sel).flatMap(p => [...p.querySelectorAll('.plot-art .tree, .badge, .empty-hint')]);
        let hidden = 0;
        for (const o of others) { const q = o.getBoundingClientRect(); for (let x = q.left + 2; x < q.right; x += 4) for (let y = q.top + 2; y < q.bottom; y += 4) { const all = document.elementsFromPoint(x, y); if (all[0] && b.contains(all[0]) && all.some(z => o.contains(z) && z !== o)) hidden++; } }
        return (cut ? 'CUT (' + Math.round(r.top) + '..' + Math.round(r.bottom) + ', visible to ' + Math.round(floor) + ')' : 'fully visible') + ' | over other trees/labels: ' + (hidden ? 'YES ' + hidden + ' points' : 'no');
      })()`));
      // Fonts: every visible text uses Silkscreen, DotGothic16 or Tiny5 (the three design-system fonts) (no sans-serif anywhere).
      console.log('fonts:', await evaluate(`(() => {
        const ok = ['Silkscreen', 'DotGothic16', 'Tiny5'];
        const bad = new Map();
        const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n; (n = walk.nextNode()); ) {
          if (!n.textContent.trim()) continue;
          const el = n.parentElement; if (!el || !el.getClientRects().length) continue;
          const first = getComputedStyle(el).fontFamily.split(',')[0].replace(/["']/g, '').trim();
          if (!ok.includes(first)) bad.set(first + ' <' + el.tagName.toLowerCase() + '.' + (el.className || '').toString().split(' ')[0] + '>', 1);
        }
        return bad.size ? 'OTHER FONTS: ' + [...bad.keys()].slice(0, 8).join(', ') : 'only Silkscreen / DotGothic16 / Tiny5';
      })()`));
      // Any sky element bigger than 3 game pixels drawn as a plain box (no picture inside, solid fill)?
      console.log('plain boxes in the sky:', await evaluate(`(() => { const art = document.querySelector('.bg-art').getBoundingClientRect(); const px = art.width / 240; return [...document.querySelectorAll('.sky *, .bg-fx > *')].filter(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); if (r.width < 3 * px || r.height < 3 * px || e.querySelector('svg, img') || e.tagName === 'svg' || e.closest('svg')) return false; const solid = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none' && cs.clipPath === 'none' && cs.borderRadius === '0px'; return solid && parseFloat(cs.opacity) > 0.05; }).map(e => e.className).join(', ') || 'none'; })()`));
      console.log('sky layers (day / dusk / night opacity):', await evaluate(`['.sky-day', '.sky-dusk', '.sky-night'].map(s => getComputedStyle(document.querySelector(s)).opacity).join(' / ')`), '| phase:', await evaluate(`document.querySelector('.scene').className`));
      await sleep(6000); await screenshot('scene-b');
    });
    throw Object.assign(new Error('scene done'), { done: true });
  }
  if (name.startsWith('--tutorial=')) {
    await step('Tutorial on a NEW dev garden: TaniBot guides the whole loop', async () => {
      const user = name.slice('--tutorial='.length);
      const coach = () => evaluate(`(() => { const c = document.querySelector('.coach'); return c ? c.className.replace('coach coach-', '') + ' | ' + (c.querySelector('.coach-progress')?.innerText ?? '') + ' | ' + c.querySelector('.coach-text').innerText : 'no coach'; })()`);
      const glow = () => evaluate(`[...document.querySelectorAll('*')].filter(e => getComputedStyle(e).animationName === 'tut-glow').map(e => e.className.split(' ').slice(0, 2).join('.')).join(', ') || 'none'`);
      const waitStep = (id, ms = 30000) => waitFor(`!!document.querySelector('.coach-${id}')`, `tutorial step ${id}`, ms);
      // Phones: the coach floats over the scene's sky; the three mounds stay in view without scrolling.
      const mounds = () => evaluate(`(() => { const soils = [...document.querySelectorAll('.plot .soil')].map(e => e.getBoundingClientRect()); if (!soils.length) return 'no garden'; const sheet = document.querySelector('.garden-sheet')?.getBoundingClientRect(); const c = document.querySelector('.coach')?.getBoundingClientRect(); const hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; const inView = soils.filter(r => r.top >= 0 && r.bottom <= Math.min(innerHeight, sheet ? sheet.top + 1 : innerHeight)).length; return 'mounds in view ' + inView + '/3 | coach covers a mound: ' + soils.some(r => hit(r, c)) + ' | page scrolled ' + Math.round(scrollY) + 'px'; })()`);
      const shot = async (label) => {
        console.log(`${label}: ${await coach()} | glowing: ${await glow()}${MOBILE ? ' | ' + (await mounds()) : ''}`);
        await screenshot(`tut-${label}`);
      };
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(bodyHas('Welcome to Tandur'), 'create screen');
      await typeInto('.create input:not([type=checkbox])', user);
      await clickText('Start farming');
      await waitStep('welcome');
      await sleep(400); await shot('welcome');
      console.log('turn-on nudge during the tutorial (expect false):', await evaluate(`!!document.querySelector('.bot-nudge')`));
      await clickText("Let's go", '.coach button');
      await waitStep('plant');
      await clickText('Show me', '.coach button');
      await sleep(400); await shot('plant');
      await waitFor(`!document.body.innerText.includes('Creating your NEAR account')`, 'account', 60000);
      await evaluate(`document.querySelectorAll('.plot')[0].click()`);
      await sleep(200);
      await evaluate(`document.querySelector('.plot-empty .seed-row > *').click()`);
      await waitStep('water');
      await clickText('Show me', '.coach button');
      await sleep(400); await shot('water');
      await evaluate(`document.querySelector('.act-water').click()`);
      await waitStep('buy_fertilizer');
      await sleep(300); await shot('buy_fertilizer');
      await clickText('Open the Shop', '.coach button');
      await waitFor(`!!document.querySelector('.shop-fertilizer .shop-buy')`, 'shop');
      await sleep(400); await shot('shop-open');
      await evaluate(`document.querySelector('.shop-fertilizer .shop-buy').click()`);
      await waitStep('fertilize');
      await clickText('Show me', '.coach button');
      await sleep(400); await shot('fertilize');
      await evaluate(`document.querySelector('.act-fertilize').click()`);
      await waitStep('checkin');
      await sleep(300); await shot('checkin');
      await clickText('Open check-in', '.coach button');
      await waitFor(`!!document.querySelector('.checkin-dialog')`, 'check-in window');
      await clickText('Check in', '.checkin-dialog button');
      await waitStep('harvest');
      await evaluate(`[...document.querySelectorAll('.checkin-dialog button')].find(b => b.innerText === 'Close')?.click()`);
      await clickText('Show me', '.coach button');
      await sleep(400); await shot('harvest-wait');
      // Keep it watered until ripe (first tree: about 3 minutes, faster with fertilizer).
      await waitFor(`(() => { const w = document.querySelector('.act-water'); if (w && !w.disabled) w.click(); const h = document.querySelector('.act-harvest'); return !!h && !h.disabled; })()`, 'ripe fruit', 300000);
      await sleep(300); await shot('harvest');
      await evaluate(`document.querySelector('.act-harvest').click()`);
      await waitStep('sell');
      await sleep(400); await shot('sell');
      await clickText('Open the Market', '.coach button');
      await waitFor(`!!document.querySelector('.market-row:not(.empty) .sell-go')`, 'market');
      await sleep(300); await shot('market-open');
      await evaluate(`document.querySelector('.market-row:not(.empty) .sell-go').click()`);
      // Demo days last a minute: if Mr. Darto's price changed meanwhile, accept the new price.
      await waitFor(`!!document.querySelector('.coach-tanibot') || [...document.querySelectorAll('.dialog button')].some(b => /^Sell for/.test(b.innerText))`, 'sold or new price', 30000);
      if (await clickText('Sell for', '.dialog button')) console.log('new day: sold at the new price');
      await waitStep('tanibot');
      await sleep(400); await shot('tanibot');
      console.log('share card while the tutorial runs (expect false):', await evaluate(`!!document.querySelector('.share-card')`));
      await clickText('Activate TaniBot', '.coach button');
      await waitFor(`[...document.querySelectorAll('.tanibot-dialog button')].some(b => b.innerText === 'Activate TaniBot')`, 'TaniBot window with Activate');
      await sleep(300); await screenshot('tut-tanibot-window');
      await clickText('Activate TaniBot', '.tanibot-dialog button');
      await waitFor(`!document.querySelector('.coach')`, 'tutorial finished', 30000);
      await sleep(2500);
      // Share cards come one at a time, the first harvest first; close each and note the next.
      const cards = [];
      for (let i = 0; i < 4; i++) {
        const h = await evaluate(`[...document.querySelectorAll('h2')].map(h => h.innerText).find(t => t.startsWith('Share:')) || ''`);
        if (!h) break;
        cards.push(h.replace('Share: ', ''));
        await screenshot(`tut-card-${i + 1}`);
        await clickText('Close', '.share-dialog button');
        await sleep(1800);
      }
      console.log('tutorial finished; share cards in order (first harvest expected first):', cards.join(' -> ') || 'none');
      await screenshot('tut-done');
      console.log('horizontal overflow:', await evaluate(`document.documentElement.scrollWidth > window.innerWidth`));
    });
    throw Object.assign(new Error('tutorial done'), { done: true });
  }
  if (name.startsWith('--phonefit=')) {
    // Phone garden fit (NEW dev garden, fake-chain server, FAKE_DB=<its sqlite> to add seeds, fruit and items):
    // no page scroll, sky behind the HUD, grass under the panel, TaniBot in front of the mounds,
    // seed cards whole, Storage sections, the on-chain log, and the "turn your phone" screen sideways.
    await step('phone garden fit', async () => {
      const user = name.slice('--phonefit='.length);
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(bodyHas('Welcome to Tandur'), 'create screen');
      await typeInto('.create input:not([type=checkbox])', user);
      await clickText('Start farming');
      await waitFor(`!!document.querySelector('.plots')`, 'garden');
      await waitFor(`!document.body.innerText.includes('Creating your NEAR account')`, 'account', 60000);
      await clickText('Skip tutorial');
      if (process.env.FAKE_DB) {
        const { DatabaseSync } = await import('node:sqlite');
        const db = new DatabaseSync(process.env.FAKE_DB, { timeout: 10000 });
        const pid = db.prepare("SELECT p.id FROM players p JOIN users u ON u.id = p.user_id WHERE u.provider = 'dev' AND u.subject = ?").get(user)?.id;
        const seed = db.prepare("INSERT INTO seeds (player_id, species, quality, source, created_at) VALUES (?, ?, ?, 'shop', ?)");
        const now = Date.now();
        for (const [sp, q, n] of [['mango', null, 6], ['mango', 'rare', 1], ['mango', 'gold', 1], ['rambutan', null, 2], ['rambutan', 'rare', 1], ['durian', 'gold', 1], ['durian', null, 1]]) for (let i = 0; i < n; i++) seed.run(pid, sp, q, now);
        const fruit = db.prepare('INSERT OR REPLACE INTO fruits (player_id, species, quality, qty) VALUES (?, ?, ?, ?)');
        for (const [sp, q, n] of [['mango', 'common', 5], ['mango', 'rare', 2], ['rambutan', 'common', 3], ['durian', 'gold', 1]]) fruit.run(pid, sp, q, n);
        db.prepare("INSERT OR REPLACE INTO items (player_id, item, qty) VALUES (?, 'fertilizer', 3)").run(pid);
        db.close();
        await send('Page.reload');
        await waitFor(`!!document.querySelector('.plots')`, 'garden after reload');
      }
      await sleep(1500);
      await evaluate(`document.querySelectorAll('.plot')[0].click()`);
      await sleep(1200);
      const fit = `(() => {
        const se = document.scrollingElement; const before = se.scrollHeight - innerHeight;
        window.scrollTo(0, 400); const y = scrollY; window.scrollTo(0, 0);
        const sheet = document.querySelector('.garden-sheet')?.getBoundingClientRect();
        const tabs = document.querySelector('.tabs')?.getBoundingClientRect();
        const under = (x, yy) => document.elementsFromPoint(x, yy).filter(e => !e.closest('.topbar, .hud-chips, .garden-sheet, .tabs')).map(e => (e.className?.baseVal ?? e.className ?? '').toString().split(' ')[0] || e.tagName.toLowerCase()).slice(0, 3).join(' > ');
        const top = document.querySelector('.topbar')?.getBoundingClientRect();
        return 'page scroll room ' + before + 'px, scrolled to ' + y + ' | behind HUD: ' + under(innerWidth / 2, (top?.top ?? 0) + 4) +
          ' | just above the panel: ' + under(innerWidth / 2, (sheet?.top ?? 0) - 3) +
          ' | between panel and tabs: ' + Math.round((tabs?.top ?? 0) - (sheet?.bottom ?? 0)) + 'px';
      })()`;
      console.log('fit:', await evaluate(fit));
      const seeds = `(() => {
        const cards = [...document.querySelectorAll('.plot-empty .seed-card')];
        const cut = cards.filter(c => { const r = c.getBoundingClientRect(); return [...c.querySelectorAll('*')].some(e => { const q = e.getBoundingClientRect(); return q.width && (q.right > r.right + 0.5 || q.left < r.left - 0.5); }) || c.scrollWidth > c.clientWidth + 1; });
        const row = document.querySelector('.plot-empty .seed-row');
        const bar = document.querySelector('.seed-scroll');
        return cards.length + ' cards, cut: ' + (cut.length ? cut.map(c => c.innerText.replace(/\\n/g, ' ')).join(' | ') : 'none') + ' | row overflows: ' + (row ? row.scrollWidth > row.clientWidth + 1 : '-') + ' | pixel scrollbar: ' + (bar ? Math.round(bar.getBoundingClientRect().width) + 'x' + Math.round(bar.getBoundingClientRect().height) : 'none') + ' | hint: ' + (document.querySelector('.seed-swipe-hint')?.innerText ?? 'none');
      })()`;
      console.log('seeds:', await evaluate(seeds));
      await screenshot('garden-empty-plot');
      if (await evaluate(`!!document.querySelector('.plot-empty .seed-row')`)) {
        await evaluate(`(() => { const r = document.querySelector('.plot-empty .seed-row'); r.scrollLeft = r.scrollWidth; })()`);
        await sleep(500); await screenshot('seed-row-end');
        await evaluate(`document.querySelector('.plot-empty .seed-row').scrollLeft = 0`);
      }
      // Plant on plot 1, then check TaniBot against the mounds and the labels.
      await evaluate(`document.querySelector('.plot-empty .seed-card')?.click()`);
      await waitFor(`!!document.querySelector('.plot .tree')`, 'planted');
      await sleep(2500);
      await clickText('Close', '.dialog-backdrop button');
      await sleep(400);
      // A second tree (plot 2), so TaniBot stands next to trees on both sides.
      await evaluate(`document.querySelectorAll('.plot')[1].click()`);
      await sleep(600);
      await evaluate(`document.querySelectorAll('.plot-empty .seed-card')[2]?.click()`);
      await waitFor(`document.querySelectorAll('.plot .tree').length >= 2`, 'second tree');
      await sleep(1500);
      await clickText('Close', '.dialog-backdrop button');
      const view = `(() => {
        const b = document.querySelector('.bot-spot .tanibot'); if (!b) return 'no TaniBot';
        const r = b.getBoundingClientRect();
        const sheet = document.querySelector('.garden-sheet')?.getBoundingClientRect();
        const cut = r.top < 0 || r.bottom > (sheet ? sheet.top : innerHeight) + 1 || r.left < -1 || r.right > innerWidth + 1;
        const sel = document.querySelector('.plot.selected');
        const others = [...document.querySelectorAll('.plot')].filter(p => p !== sel).flatMap(p => [...p.querySelectorAll('.plot-art .badge, .empty-hint')]);
        let hidden = 0;
        for (const o of others) { const q = o.getBoundingClientRect(); for (let x = q.left + 2; x < q.right; x += 4) for (let y = q.top + 2; y < q.bottom; y += 4) { const all = document.elementsFromPoint(x, y); if (all[0] && b.contains(all[0]) && all.some(z => o.contains(z) && z !== o)) hidden++; } }
        return (cut ? 'CUT' : 'fully visible') + ' | over other labels: ' + (hidden ? 'YES ' + hidden + ' points' : 'no');
      })()`;
      const bot = `(() => {
        const st = document.createElement('style'); st.textContent = '.scene * { pointer-events: auto !important; }'; document.head.appendChild(st);
        const b = document.querySelector('.bot-spot .tanibot'); if (!b) { st.remove(); return 'no TaniBot'; }
        const r = b.getBoundingClientRect(); let behind = 0, pts = 0, sample = '';
        for (let x = r.left + 2; x < r.right - 2; x += 3) for (let y = r.top + r.height * 0.55; y < r.bottom - 1; y += 3) { const all = document.elementsFromPoint(x, y); if (!all.some(z => b.contains(z) || z === b)) continue; pts++; if (all[0].closest('.soil')) { behind++; sample = all.slice(0, 4).map(e => e.tagName.toLowerCase() + '.' + ((e.className?.baseVal ?? e.className) || '').toString().split(' ').join('.') + '[z' + getComputedStyle(e).zIndex + ']').join(' > '); } }
        const chip = document.querySelector('.bot-status')?.getBoundingClientRect();
        const hits = chip ? [...document.querySelectorAll('.plot .badge, .plot .empty-hint')].filter(e => { const q = e.getBoundingClientRect(); return q.width && q.left < chip.right && chip.left < q.right && q.top < chip.bottom && chip.top < q.bottom; }).map(e => e.innerText) : [];
        st.remove();
        return 'TaniBot points behind a mound: ' + behind + '/' + pts + (sample ? ' (' + sample + ')' : '') + ' | labels over the ON/OFF chip: ' + (hits.join(', ') || 'none');
      })()`;
      for (const plot of [0, 1, 2]) {
        await evaluate(`document.querySelectorAll('.plot')[${plot}].click()`);
        await sleep(2200);
        console.log(`plot ${plot + 1}:`, await evaluate(bot), '|', await evaluate(view));
        await screenshot(`garden-plot${plot + 1}`);
      }
      console.log('fit (tree):', await evaluate(fit));
      // Storage
      await clickText('Storage', '.tab');
      await sleep(800);
      const storage = `(() => {
        const tabs = document.querySelector('.tabs').getBoundingClientRect();
        return [...document.querySelectorAll('.content .panel')].map(p => { const r = p.getBoundingClientRect(); return (p.querySelector('h2')?.innerText ?? '?') + ' [' + p.querySelectorAll('.list > li').length + ' rows' + (p.querySelector('.inv-more') ? ', ' + p.querySelector('.inv-more').innerText : '') + '] ' + (r.bottom <= tabs.top + 1 ? 'in view' : 'below the fold'); }).join(' | ') + ' | page scroll room ' + (document.scrollingElement.scrollHeight - innerHeight);
      })()`;
      console.log('storage:', await evaluate(storage));
      await screenshot('storage');
      if (await clickText('Seeds', '.inv-toggle')) {
        await sleep(400);
        console.log('storage (Seeds open):', await evaluate(storage));
        await screenshot('storage-seeds-open');
        await clickText('Sell / discard');
        await sleep(400);
        console.log('sell pickers open:', await evaluate(`document.querySelectorAll('.qty-picker, .qty').length`));
        await screenshot('storage-sell');
        await clickText('Seeds', '.inv-toggle');
        await sleep(300);
        console.log('storage (Seeds closed again):', await evaluate(storage));
      }
      // Village: the on-chain log has every transaction
      await clickText('Village', '.tab');
      await sleep(1500);
      await evaluate(`document.querySelector('.log')?.scrollIntoView({ block: 'center' })`);
      await sleep(400);
      console.log('log:', await evaluate(`(() => { const rows = [...document.querySelectorAll('.log > li')]; return rows.length + ' rows: ' + rows.slice(0, 6).map(r => r.innerText.replace(/\\n/g, ' ')).join(' | '); })()`));
      await screenshot('village-log');
      await clickText('Garden', '.tab');
      await sleep(800);
      // Sideways phones
      for (const [w, h] of [[874, 402], [956, 440]]) {
        await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true, screenOrientation: { type: 'landscapePrimary', angle: 90 } });
        await sleep(1500);
        console.log(`${w}x${h}:`, await evaluate(`(() => { const r = document.querySelector('.rotate-screen'); return r && getComputedStyle(r).display !== 'none' ? 'rotate screen: ' + r.innerText.replace(/\\n/g, ' ') : 'game shows'; })()`));
        await screenshot(`landscape-${w}x${h}`);
      }
      await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: true });
      await sleep(1200);
      console.log('upright again:', await evaluate(fit));
    });
    throw Object.assign(new Error('phone fit done'), { done: true });
  }
  if (name === '--howto') {
    await step('How to play: 4 pages', async () => {
      await clickText('How to play');
      await waitFor(`!!document.querySelector('.howto-dialog')`, 'how to play');
      for (let i = 1; i <= 4; i++) {
        await sleep(400);
        console.log(`page ${i}:`, await evaluate(`document.querySelector('.howto-title').innerText + ' | buttons: ' + [...document.querySelectorAll('.howto-dialog .info-actions .btn')].map(b => b.innerText).join(' / ')`));
        await screenshot(`howto-${i}`);
        if (i < 4) await clickText('Next', '.howto-dialog button');
      }
      await clickText('Back', '.howto-dialog button');
      await sleep(300);
      console.log('after Back:', await evaluate(`document.querySelector('.howto-title').innerText`));
      console.log('fits without page scroll:', await evaluate(`(() => { const b = document.querySelector('.howto-dialog .info-body'); return b.scrollHeight <= b.clientHeight + 1; })()`));
    });
    throw Object.assign(new Error('howto done'), { done: true });
  }
  if (name === '--judge') {
    await step('Try as Judge: one click, then the 5-step tour', async () => {
      const tour = () => evaluate(`document.querySelector('.chip-judge')?.innerText.replace(/\\s+/g, ' ') ?? 'no chip'`);
      const openTour = async () => {
        if (!(await evaluate(`!!document.querySelector('.judge-dialog')`))) await evaluate(`document.querySelector('.chip-judge').click()`);
        await waitFor(`!!document.querySelector('.judge-dialog')`, 'tour window');
      };
      const go = async (label) => {
        await openTour();
        await clickText(label, '.judge-dialog button');
        await sleep(500);
      };
      await screenshot('login');
      await clickText('Try as Judge');
      await waitFor(`!!document.querySelector('.judge-dialog')`, 'tour opens', 30000);
      await sleep(500); await screenshot('tour-start');
      console.log('garden:', await evaluate(`document.querySelector('.who-btn')?.innerText.replace(/\\n/g, ' ')`), '|', await tour());
      console.log('steps:', await evaluate(`[...document.querySelectorAll('.judge-step')].map(l => l.querySelector('b').innerText).join(' / ')`));
      // 1. Harvest the ripe Rare Durian.
      await go('Go to the garden');
      await evaluate(`document.querySelectorAll('.plot')[0].click()`);
      await sleep(300); await screenshot('garden');
      console.log('plots:', await evaluate(`[...document.querySelectorAll('.plot')].map(p => p.getAttribute('aria-label')).join(' | ')`));
      await clickText('Harvest');
      await waitFor(`(document.querySelector('.chip-judge')?.innerText ?? '').includes('1/5')`, 'harvest step', 20000);
      console.log('after harvest:', await tour());
      await sleep(3500);
      console.log('share card during the tour (expect false):', await evaluate(`!!document.querySelector('.share-card')`));
      // 2. Sell to Mr. Darto.
      await go('Open the Market');
      await waitFor(`!!document.querySelector('.market-row:not(.empty) .sell-go')`, 'market');
      await evaluate(`(() => { const r = document.querySelector('.market-row:not(.empty)'); r.querySelector('.sell-max').click(); })()`);
      await sleep(200);
      await evaluate(`document.querySelector('.market-row:not(.empty) .sell-go').click()`);
      // Demo days last a minute: if Mr. Darto's price changed meanwhile, accept the new price.
      await waitFor(`(${bodyHas('Sold')}) || [...document.querySelectorAll('.dialog button')].some(b => /^Sell for/.test(b.innerText))`, 'sold or new price', 30000).catch(() => {});
      if (await clickText('Sell for', '.dialog button')) console.log('new day: sold at the new price');
      await waitFor(bodyHas('Sold'), 'sold', 20000);
      await sleep(400); await screenshot('sold');
      // 3. Buy in the Shop (burn).
      await go('Open the Shop');
      await waitFor(`[...document.querySelectorAll('.shop li')].some(l => l.textContent.includes('Fertilizer'))`, 'shop');
      await evaluate(`[...document.querySelectorAll('.shop li')].find(l => l.textContent.includes('Fertilizer')).querySelector('.shop-buy').click()`);
      await waitFor(bodyHas('Bought'), 'bought', 20000);
      // 4. TaniBot's Log.
      await go('Open TaniBot');
      await waitFor(`!!document.querySelector('[aria-label="TaniBot"]')`, 'TaniBot window');
      await sleep(800); await screenshot('tanibot');
      console.log('TaniBot log:', await evaluate(`[...document.querySelectorAll('.bot-log li')].slice(0, 6).map(l => l.innerText.replace(/\\n/g, ' ')).join(' || ')`));
      await clickText('Close', '[aria-label="TaniBot"] button');
      await sleep(300);
      // 5. Village Stats.
      await go('Open the Village');
      await waitFor(bodyHas('PANEN ever minted'), 'village stats', 30000);
      await sleep(1500); await screenshot('village');
      await waitFor(`(document.querySelector('.chip-judge')?.innerText ?? '').includes('5/5')`, 'all steps', 20000);
      await sleep(3000);
      console.log('share cards after 5/5 (expect a card):', await evaluate(`document.querySelector('.share-dialog h2, .share-card') ? [...document.querySelectorAll('h2')].map(h => h.innerText).filter(t => t.startsWith('Share')).join(' | ') : 'none'`));
      await evaluate(`[...document.querySelectorAll('button')].filter(b => b.innerText === 'Close' && b.closest('.dialog')?.innerText.includes('Share:')).forEach(b => b.click())`);
      await sleep(400);
      await openTour();
      await waitFor(`!document.querySelector('.judge-dialog').innerText.includes('Sending to NEAR')`, 'all transactions landed', 90000);
      await sleep(500); await screenshot('tour-done');
      await evaluate(`document.querySelector('.judge-dialog')?.closest('.dialog')?.querySelector('button')?.click()`);
      await sleep(300);
      await evaluate(`document.querySelector('.share-preview')?.scrollIntoView({ block: 'center' })`);
      await sleep(300); await screenshot('share-preview');
      await evaluate(`document.querySelector('.share-preview > summary')?.click()`);
      await sleep(300); await screenshot('share-preview-open');
      console.log('preview buttons:', await evaluate(`[...document.querySelectorAll('.share-preview button')].map(b => b.innerText).join(' / ')`));
      console.log('tour:', await tour(), '|', await evaluate(`[...document.querySelectorAll('.judge-step')].map(l => (l.classList.contains('done') ? 'DONE ' : 'todo ') + l.querySelector('b').innerText + ' ' + (l.querySelector('.judge-proof a')?.href ?? l.querySelector('.judge-proof')?.innerText ?? '')).join(' | ')`));
      const overflow = await evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
      console.log('horizontal overflow:', overflow);
    });
    throw Object.assign(new Error('judge done'), { done: true });
  }
  if (name.startsWith('--tanibot=')) {
    await step('TaniBot window on a new dev garden', async () => {
      const user = name.slice('--tanibot='.length);
      await typeInto('#dev-user', user);
      await clickText('Enter');
      await waitFor(bodyHas('Welcome to Tandur'), 'create screen');
      await typeInto('.create input:not([type=checkbox])', user);
      await clickText('Start farming');
      await waitFor(`!!document.querySelector('.bot-click')`, 'garden');
      await waitFor(`!document.body.innerText.includes('Creating your NEAR account')`, 'account', 60000);
      await evaluate(`document.querySelector('.bot-click').click()`);
      await waitFor(`!!document.querySelector('[aria-label="TaniBot"]')`, 'TaniBot window');
      await waitFor(bodyHas('Activate TaniBot'), 'activate panel');
      await sleep(300); await screenshot('tanibot-activate');
      // Success indicators: the button says what it waits for, then a green toast with a check mark.
      const watchAction = async (label) => {
        const seen = new Set();
        for (let i = 0; i < 100; i++) {
          const t = await evaluate(`[...document.querySelectorAll('[aria-label="TaniBot"] button')].map(b => b.innerText).find(x => /Waiting for wallet|Confirming on NEAR|Please wait/.test(x)) ?? ''`);
          if (t) seen.add(t);
          const toast = await evaluate(`[...document.querySelectorAll('.toast-success, .toast-error')].map(x => x.className.split(' ').pop() + ': ' + x.innerText.replace(/\\n/g, ' ')).join(' | ')`);
          if (toast) {
            console.log(`${label}: button ${[...seen].join(' -> ') || '(too fast to see)'} | toast ${toast} | budget flash ${await evaluate(`!!document.querySelector('.count-num.flash')`)}`);
            await sleep(400);
            await screenshot(`toast-${label}`);
            return;
          }
          await sleep(150);
        }
        console.log(`${label}: NO toast`);
      };
      await clickText('Activate TaniBot');
      await watchAction('activate');
      await waitFor(bodyHas('Wallet and budget'), 'bot ready', 60000);
      await sleep(6500);
      await evaluate(`(() => { const i = document.querySelector('.bot-budget input'); i.value = '5'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await clickText('Add budget');
      await watchAction('add-budget');
      await sleep(6500);
      await evaluate(`(() => { const i = document.querySelector('.bot-budget input'); i.value = '3'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await clickText('Take back');
      await watchAction('take-back');
      await waitFor(bodyHas('Checked the garden') + ' || ' + bodyHas('watered'), 'first round', 60000);
      await sleep(500); await screenshot('tanibot-ready');
      await clickText('Turbo', '.bot-style');
      await waitFor(bodyHas('Turbo: I fertilize'), 'style log');
      await clickText('ON', '.bot-switch');
      await waitFor(bodyHas('Switched off'), 'switched off');
      let bye = 'none';
      for (let i = 0; i < 15 && bye === 'none'; i++) {
        bye = await evaluate(`document.querySelector('.bot-bye')?.innerText ?? 'none'`);
        if (bye === 'none') await sleep(200);
      }
      console.log('goodbye bubble:', bye, '| asleep:', await evaluate(`!!document.querySelector('.bot-click.asleep')`), '| scene mounted:', await evaluate(`!!document.querySelector('.scene')`));
      await evaluate(`document.querySelector('[aria-label="TaniBot"] .info-body').scrollTop = 9999`);
      await sleep(300); await screenshot('tanibot-log');
      console.log('log:', await evaluate(`[...document.querySelectorAll('.bot-log li')].map(l => l.innerText.replace(/\\n/g, ' ')).join(' || ')`));
    });
    throw Object.assign(new Error('tanibot done'), { done: true });
  }
  if (name.startsWith('--profile=')) {
    await step('profile of an existing dev garden', async () => {
      await typeInto('#dev-user', name.slice('--profile='.length));
      await clickText('Enter');
      await waitFor(`!!document.querySelector('.who-btn')`, 'garden');
      await sleep(800);
      console.log('sign out in top bar:', await evaluate(bodyHas('Sign out')));
      await evaluate(`document.querySelector('.who-btn').click()`);
      await waitFor(`!!document.querySelector('[aria-label="Profile"]')`, 'profile window');
      await sleep(400); await screenshot('profile');
      console.log('profile:', await evaluate(`document.querySelector('[aria-label="Profile"]').innerText.replace(/\\n+/g, ' | ')`));
      await clickText('Change avatar');
      await sleep(300); await screenshot('avatar-grid');
      await evaluate(`document.querySelector('.avatar-choice[title="Durian"]').click()`);
      await waitFor(`document.querySelector('.who-btn .avatar svg title')?.textContent === 'Durian'`, 'durian avatar in the top bar');
      await sleep(300); await screenshot('avatar-durian');
      await clickText('Change avatar');
      await evaluate(`document.querySelector('.avatar-choice[title="Farmer"]').click()`);
      await waitFor(`document.querySelector('.who-btn .avatar svg title')?.textContent === 'Farmer'`, 'farmer avatar back');
      console.log('avatar change: ok');
      await evaluate(`document.querySelector('[aria-label="Profile"] .info-body').scrollTop = 9999`);
      await sleep(300); await screenshot('profile-bottom');
      await clickText('Close');
      if (MOBILE) await clickText('Village', '.tab'); else await evaluate(`[...document.querySelectorAll('.rail-btn, .side-tabs button')].find(b => b.textContent.includes('Village'))?.click()`);
      await sleep(800);
      console.log('wallet section still in Village:', await evaluate(bodyHas('Connect NEAR Wallet')));
      await screenshot('village');
    });
    throw Object.assign(new Error('profile done'), { done: true });
  }
  if (name === '--login-only') {
    await step('login copy, legal links, dev login form', async () => {
      // The footer names both ways in; the Privacy / Terms links open the static pages.
      console.log('footer:', await evaluate(`document.querySelector('.login-foot')?.innerText`));
      console.log('legal links:', await evaluate(`[...document.querySelectorAll('.login-legal a')].map(a => a.innerText + ' -> ' + a.getAttribute('href')).join(' | ')`));
      console.log('dev login form shown:', await evaluate(`!!document.querySelector('#dev-user')`), '(must be false on a production build)');
      await evaluate(`document.querySelector('.login-legal')?.scrollIntoView({ block: 'center' })`);
      await sleep(300); await screenshot('login-footer');
      await clickText('How to play');
      await sleep(600);
      console.log('how to play page 1:', await evaluate(`(document.querySelector('.info-dialog') || document.body).innerText.split('\\n').filter(l => /Google|wallet/i.test(l)).join(' / ')`));
      await screenshot('howto-1');
      await evaluate(`document.querySelectorAll('.dialog-backdrop .info-close, .help-skip').forEach(b => b.click())`);
      await sleep(300);
    });
    await step('privacy and terms pages (opened directly by URL)', async () => {
      const base = new URL(UI_URL).origin;
      for (const page of ['privacy', 'terms']) {
        await send('Page.navigate', { url: `${base}/${page}` });
        await waitFor(`document.readyState === 'complete' && !!document.querySelector('h1')`, page);
        console.log(page + ':', await evaluate(`document.title + ' | ' + document.querySelector('h1').innerText + ' | contact ' + (document.body.innerText.match(/[a-z0-9.]+@gmail[.]com/) || ['none'])[0] + ' | page scrolls sideways: ' + (document.documentElement.scrollWidth > innerWidth)`));
        await sleep(300); await screenshot(page);
      }
      await send('Page.navigate', { url: UI_URL });
      await waitFor(bodyHas('Grow. Harvest. Own.'), 'login screen again');
    });
    await step('NEAR wallet picker', async () => {
      if (!(await clickText('Connect NEAR Wallet'))) throw new Error('no Connect NEAR Wallet button');
      await sleep(5000); await screenshot('wallet-picker');
    });
    throw Object.assign(new Error('login-only done'), { done: true });
  }
  await step('dev login', async () => {
    await typeInto('#dev-user', `ui-${name}`);
    await clickText('Enter');
    await waitFor(bodyHas('Welcome to Tandur'), 'create screen');
    await typeInto('.create input:not([type=checkbox])', name);
    await sleep(200); await screenshot('create');
    await clickText('Start farming');
    await waitFor(`!!document.querySelector('.plots')`, 'garden');
    await sleep(500); await screenshot('garden-new');
  });
  await step('wait for NEAR account', async () => {
    await waitFor(`!document.body.innerText.includes('Creating your NEAR account')`, 'account', 90000);
    await sleep(1500); await screenshot('account-ready-flash');
  });
  await step('check-in', async () => {
    await clickText('Check in');
    await waitFor(bodyHas('see you tomorrow'), 'checked in');
    await sleep(300); await screenshot('checked-in');
  });
  await step('plant mango on plot 1', async () => {
    await evaluate(`document.querySelectorAll('.plot')[0].click()`);
    await sleep(200);
    const label = await evaluate(`document.querySelector('.seed-grid').innerText.replace(/\\n/g, ' | ')`); console.log('seed cards:', label);
    await clickText('Mango', '.seed-btn');
    await waitFor(`!!document.querySelector('.plot .tree')`, 'planted');
    await clickText('Water');
    await waitFor(`[...document.querySelectorAll('.act-water')].some(b => /Watered/.test(b.innerText))`, 'watered');
    await sleep(400); await screenshot('planted-watered');
  });
  await step('plot 3 is locked', async () => {
    await evaluate(`document.querySelectorAll('.plot')[2].click()`);
    await sleep(300); await screenshot('plot3-locked');
    await evaluate(`document.querySelectorAll('.plot')[0].click()`);
  });
  await step('wait until ripe (demo: about 1 minute)', async () => {
    await sleep(25000); await screenshot('growing');
    await waitFor(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Harvest') && !b.disabled)`, 'ripe', 120000);
    await sleep(300); await screenshot('ripe');
    await clickText('Harvest');
    await waitFor(bodyHas('Harvested'), 'harvested');
    await sleep(300); await screenshot('harvested');
  });
  await step('barn', async () => {
    await clickText('Storage', '.tab'); await sleep(400); await screenshot('storage');
    console.log('storage seeds:', await evaluate(`[...document.querySelectorAll('.panel')][0].innerText.replace(/\\n/g, ' | ').slice(0, 200)`));
  });
  await step('sell to Mr. Darto', async () => {
    await clickText('Market', '.tab'); await sleep(400); await screenshot('darto');
    await clickText('Sell 1');
    await waitFor(bodyHas('Sold 1'), 'sold');
    await sleep(300); await screenshot('sold');
  });
  await step('shop: buy fertilizer', async () => {
    await clickText('Shop', '.tab'); await sleep(300);
    await evaluate(`(() => { const li = [...document.querySelectorAll('.shop li')].find(l => l.textContent.includes('Fertilizer')); li.querySelector('.shop-buy').click(); return true; })()`);
    await waitFor(bodyHas('Bought Fertilizer'), 'bought');
    await sleep(300); await screenshot('shop');
  });
  await step('fertilize and chop animations', async () => {
    if (MOBILE) { await clickText('Garden', '.tab'); await sleep(300); }
    await evaluate(`document.querySelectorAll('.plot')[0].click()`);
    await sleep(200);
    await clickText('Fertilize');
    await sleep(700); await screenshot('fertilize-anim');
    await sleep(1500);
    await clickText('Cut down tree');
    await waitFor(`!!document.querySelector('.dialog')`, 'dialog');
    await screenshot('chop-dialog');
    await clickText('Cut down', '.dialog button');
    await sleep(650); await screenshot('chop-anim');
    if (MOBILE) await clickText('Village', '.tab');
  });
  await step('village stats and on-chain log', async () => {
    await clickText('Village', '.tab');
    await waitFor(bodyHas('PANEN ever minted'), 'stats', 30000);
    await waitFor(`![...document.querySelectorAll('.log li')].some(l => l.textContent.includes('sending'))`, 'all tx landed', 120000);
    await sleep(500); await screenshot('village');
    const links = await evaluate(`[...document.querySelectorAll('.log a')].map(a => a.closest('li').innerText.split('\\n')[0] + ' ' + a.href)`);
    console.log('LOG LINKS\n' + links.join('\n'));
    const audio = await evaluate(`performance.getEntriesByType('resource').filter(e => e.name.includes('/assets/audio/')).map(e => e.name.split('/').pop() + ':' + e.responseStatus).join(' ')`);
    console.log('audio loaded:', audio || 'none');
    const muteBefore = await evaluate(`document.querySelector('.icon-btn').getAttribute('aria-label')`);
    await evaluate(`document.querySelector('.icon-btn').click()`);
    await sleep(200);
    const muteAfter = await evaluate(`document.querySelector('.icon-btn').getAttribute('aria-label') + ' / stored=' + localStorage.getItem('nearvest.muted')`);
    console.log('mute button:', muteBefore, '->', muteAfter);
    await evaluate(`document.querySelector('.icon-btn').click()`);
    const season = await evaluate(`[...document.querySelectorAll('.stat')].map(s => s.innerText.replace(/\\n/g, ' ')).find(t => t.startsWith('Season'))`);
    console.log('season stat:', season);
    const overflow = await evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
    console.log('horizontal overflow:', overflow);
  });
} catch (e) {
  if (e.done) {
    const overflow = await evaluate(`document.documentElement.scrollWidth > window.innerWidth`);
    console.log('horizontal overflow:', overflow);
  } else {
    console.log('FAILED:', e.message);
    await screenshot('failure');
  }
} finally {
  console.log('PROBLEMS:', problems.length ? '\n' + problems.join('\n') : 'none');
  ws.close(); chrome.kill();
}
