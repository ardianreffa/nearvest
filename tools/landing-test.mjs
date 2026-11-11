// Landing page "See how it works ↓" (web/src/landing.tsx HowItWorks): a click scrolls to the start of
// "Your tree is a living NFT"; the button hides when scrolled down and comes back at the top.
// Chrome (390x844, 1280x800) and WebKit (iPhone profile 390x844, 1280x800). Needs a running web
// (vite) and Playwright from PLAYWRIGHT=<path to the playwright package> (not a repo dependency):
//   UI_URL=http://127.0.0.1:5174/ PLAYWRIGHT=... node tools/landing-test.mjs <outDir>
const pw = await import(process.env.PLAYWRIGHT ?? 'playwright');
const out = process.argv[2] ?? '.';
const B = process.env.UI_URL ?? 'http://127.0.0.1:5174/';
let fails = 0;
const check = (ok, msg) => { console.log(`${ok ? 'OK  ' : 'FAIL'} ${msg}`); if (!ok) fails++; };
const runs = [
  ['chrome', 390, 844], ['chrome', 1280, 800], ['webkit-iphone', 390, 844], ['webkit', 1280, 800],
];
for (const [eng, w, h] of runs) {
  const browser = eng.startsWith('webkit') ? await pw.webkit.launch() : await pw.chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  const opts = eng === 'webkit-iphone' ? { ...pw.devices['iPhone 13'], viewport: { width: w, height: h } } : { viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 500, hasTouch: w < 500 };
  const ctx = await browser.newContext(opts);
  const pg = await ctx.newPage();
  const tag = `${eng} ${w}x${h}`;
  await pg.goto(B, { waitUntil: 'networkidle' });
  await pg.waitForTimeout(600);
  const visible = async () => (await pg.locator('.lp-how').evaluate((e) => getComputedStyle(e).opacity)) === '1' && !(await pg.locator('.lp-how.gone').count());
  check(await visible(), `${tag}: button visible at the top`);
  if (eng !== 'webkit-iphone') {
    // Pressing must not move the button (.btn:active's transform once made it jump and lose the click).
    const b0 = await pg.locator('.lp-how').boundingBox();
    await pg.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await pg.mouse.down();
    const b1 = await pg.locator('.lp-how').boundingBox();
    const hit = await pg.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest('.lp-how'), [b0.x + b0.width / 2, b0.y + b0.height / 2]);
    await pg.mouse.move(0, 0);
    await pg.mouse.up();
    check(Math.abs(b1.x - b0.x) <= 1 && hit, `${tag}: pressed button stays in place (x ${Math.round(b0.x)} -> ${Math.round(b1.x)}), still under the pointer`);
    await pg.evaluate(() => window.scrollTo(0, 0));
    await pg.waitForTimeout(200);
  }
  const treesY = await pg.evaluate(() => Math.round(document.getElementById('trees').getBoundingClientRect().top + scrollY));
  if (w < 500) await pg.tap('.lp-how'); else await pg.click('.lp-how');
  await pg.waitForTimeout(1100);
  const y = await pg.evaluate(() => scrollY);
  const top = await pg.evaluate(() => Math.round(document.getElementById('trees').getBoundingClientRect().top));
  check(Math.abs(top) <= 1, `${tag}: click scrolled to "Your tree is a living NFT" (scrollY ${y}, section start ${treesY}, section top now ${top})`);
  check(!(await visible()), `${tag}: button hidden after scrolling down`);
  await pg.screenshot({ path: `${out}/L-after-click-${eng}-${w}.png` });
  await pg.evaluate(() => window.scrollTo(0, 1500));
  await pg.waitForTimeout(300);
  await pg.evaluate(() => window.scrollTo(0, 0));
  await pg.waitForTimeout(500);
  check(await visible(), `${tag}: button visible again back at the top`);
  await pg.screenshot({ path: `${out}/L-back-top-${eng}-${w}.png` });
  // mouse wheel / finger scroll down and up
  if (eng !== 'webkit-iphone') {
    await pg.mouse.wheel(0, 300); await pg.waitForTimeout(400);
    check(!(await visible()), `${tag}: hidden after a wheel down`);
    await pg.mouse.wheel(0, -2000); await pg.waitForTimeout(500);
    check(await visible(), `${tag}: visible after a wheel back up`);
  }
  // a second click works too
  if (w < 500) await pg.tap('.lp-how'); else await pg.click('.lp-how');
  await pg.waitForTimeout(1100);
  check(Math.abs(await pg.evaluate(() => Math.round(document.getElementById('trees').getBoundingClientRect().top))) <= 1, `${tag}: second click scrolls too`);
  // reduced motion: a jump
  await pg.emulateMedia({ reducedMotion: 'reduce' });
  await pg.evaluate(() => window.scrollTo(0, 0)); await pg.waitForTimeout(300);
  if (w < 500) await pg.tap('.lp-how'); else await pg.click('.lp-how');
  await pg.waitForTimeout(150);
  check(Math.abs(await pg.evaluate(() => Math.round(document.getElementById('trees').getBoundingClientRect().top))) <= 1, `${tag}: reduced motion jumps straight there`);
  await browser.close();
}
console.log(fails ? `${fails} FAILED` : 'ALL OK');
