// Browser test: drives headless Chrome (temporary profile) through the whole game loop and saves screenshots.
// Needs the server (npm run dev in server/, DEV_LOGIN=true) and the web dev server running.
// Usage: node tools/ui-test.mjs <outDir> <playerName> [width=390] [height=844]
// Login page only (no account is created): node tools/ui-test.mjs <outDir> --login-only [width] [height]
// Profile window of an EXISTING dev garden (no account is created): node tools/ui-test.mjs <outDir> --profile=<devUsername> [width] [height]
// Garden layout (top bar, plot panel with a Rare Durian, TaniBot hint) on a NEW dev garden (fake-chain server!): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --layout=<newDevUsername> [width] [height]
// TaniBot motion (jets, landing, idle moments) on a NEW dev garden (fake-chain server!): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --motion=<newDevUsername> [width] [height]
// Market rows (needs an EXISTING dev garden with fruit; fake-chain server): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --market=<devUser> [width] [height]
// Fullscreen layout at several screen sizes (EXISTING dev garden): node tools/ui-test.mjs <outDir> --fullscreen=<devUser>
// TaniBot window on a NEW dev garden (use a fake-chain server!): UI_URL=http://localhost:5174 node tools/ui-test.mjs <outDir> --tanibot=<newDevUsername> [width] [height]
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
const UI_URL = process.env.UI_URL ?? 'http://localhost:5173';
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
  const el = [...document.querySelectorAll(${JSON.stringify(scope)})].find(b => b.textContent.includes(${JSON.stringify(text)}) && !b.disabled);
  if (!el) return false; el.click(); return true; })()`);
const typeInto = (selector, value) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)});
  el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const bodyHas = (t) => `!!document.body && document.body.innerText.includes(${JSON.stringify(t)})`;
const step = async (label, fn) => { console.log('==', label); await fn(); };

await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: MOBILE ? 2 : 1, mobile: MOBILE });
await send('Emulation.setTouchEmulationEnabled', { enabled: MOBILE });
const realClick = async (x, y) => { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); };

try {
  await step('open login', async () => {
    await send('Page.navigate', { url: UI_URL + '/' });
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
      await clickText('Water');
      await waitFor(bodyHas('Watered today'), 'watered');
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
      await clickText('Activate TaniBot');
      await waitFor(bodyHas('Wallet and budget'), 'bot ready', 60000);
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
    await waitFor(bodyHas('Watered today'), 'watered');
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
    await evaluate(`(() => { const li = [...document.querySelectorAll('.shop li')].find(l => l.textContent.includes('Fertilizer')); li.querySelector('button').click(); return true; })()`);
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
