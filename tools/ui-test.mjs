// Browser test: drives headless Chrome (temporary profile) through the whole game loop and saves screenshots.
// Needs the server (npm run dev in server/, DEV_LOGIN=true) and the web dev server running.
// Usage: node tools/ui-test.mjs <outDir> <playerName> [width=390] [height=844]
// Login page only (no account is created): node tools/ui-test.mjs <outDir> --login-only [width] [height]
// Profile window of an EXISTING dev garden (no account is created): node tools/ui-test.mjs <outDir> --profile=<devUsername> [width] [height]
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
    await send('Page.navigate', { url: 'http://localhost:5173/' });
    await waitFor(bodyHas('Grow. Harvest. Own.'), 'login screen');
    await sleep(800); await screenshot('login');
    await realClick(5, 5); // a real pointer event unlocks audio
  });
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
