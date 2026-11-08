// Makes the link preview image for X and other sites (web/public/og-image.png, 1200x630): the landing
// page's first screen drawn by headless Chrome at 1200x630 (code sky, v3 village, TaniBot, the
// NEARvest logo and "Grow. Harvest. Own."), without buttons and text below the tagline.
// Usage (web dev server running): node tools/icons/make-og.mjs http://localhost:5173 web/public/og-image.png
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const [URL = 'http://localhost:5173', OUT = 'web/public/og-image.png'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PORT = 9520;
const chrome = spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), 'og-'))}`, 'about:blank'], { stdio: 'ignore' });
let tg; for (let i = 0; i < 50 && !tg; i++) { try { tg = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).find((x) => x.type === 'page'); } catch {} if (!tg) await sleep(200); }
const ws = new WebSocket(tg.webSocketDebuggerUrl); await new Promise((r) => ws.addEventListener('open', r));
let id = 0; const w = new Map(); ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (w.has(m.id)) { w.get(m.id)(m); w.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; w.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
await send('Page.navigate', { url: URL + '/' }); await sleep(3500);
await send('Runtime.evaluate', { expression: `(() => {
  for (const s of ['.lp-cta', '.lp-lead', '.lp-more', '.lp-drone']) document.querySelectorAll(s).forEach(e => e.style.display = 'none');
  const hero = document.querySelector('.lp-hero'); hero.style.height = '630px'; hero.style.minHeight = '0';
  const top = document.querySelector('.lp-hero-top'); top.style.top = '34px';
  document.querySelector('.lp-logo').style.fontSize = '112px';
  document.querySelector('.lp-tagline').style.fontSize = '44px';
  const bot = document.querySelector('.lp-hero-bot'); bot.style.left = '13%'; bot.style.transform = 'scale(1.5)'; bot.style.transformOrigin = 'bottom left';
  window.scrollTo(0, 0);
})()` });
await sleep(800);
const r = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
writeFileSync(OUT, Buffer.from(r.result.data, 'base64'));
console.log('wrote', OUT);
ws.close(); chrome.kill();
