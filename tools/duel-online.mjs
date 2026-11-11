// Arena online duel with TWO browsers (docs/PLAN-arena.md 7.12): two separate browser contexts (like
// a normal Chrome window + an Incognito window: own localStorage, own device id) play a live duel.
// Needs a fake-chain server on API_URL (default http://127.0.0.1:8788) started with DEV_LOGIN=true
// and ARENA_ONLINE=on, the web on UI_URL (default http://127.0.0.1:5174/play), FAKE_DB=<that
// server's sqlite> (only to read the match row for the log) and Playwright (not a repo dependency:
// PLAYWRIGHT=<path to playwright/index.mjs>; uses the installed Google Chrome).
//   FAKE_DB=... PLAYWRIGHT=... node tools/duel-online.mjs <outDir> <prefix> [w=390] [h=844] [scenarios=ko,decline,gone,cancel]
// Scenarios (each with its own two new gardens <prefix>a<n> / <prefix>b<n>, so daily limits never mix):
//   ko      invite -> popup on B -> Accept -> turns (B's screen never shows A's open pick) -> K.O. -> result on both
//   decline invite -> Decline -> A fights B's TaniBot ("said no")
//   gone    a missed turn ("Time's up!") -> B closes its page -> A sees "Waiting for B... 20" -> B comes back
//           (the duel resumes by itself) -> B closes again for good -> A wins ("left the duel, so you win!")
//   cancel  B accepts, closes its page before the first turn ends -> "CANCELLED" on A, not counted
// Exit code 1 when a check fails.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');
const [, , out = '.', prefix = 'on', W = '390', H = '844', which = 'ko,decline,gone,cancel'] = process.argv;
const API = process.env.API_URL ?? 'http://127.0.0.1:8788';
const UI = process.env.UI_URL ?? 'http://127.0.0.1:5174/play';
const db = process.env.FAKE_DB ? new DatabaseSync(process.env.FAKE_DB, { timeout: 10000 }) : null;
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}`);
  if (!ok) failures++;
};
const call = async (m, p, t, b) =>
  (await fetch(API + p, { method: m, headers: { 'Content-Type': 'application/json', ...(t ? { Authorization: 'Bearer ' + t } : {}) }, body: b === undefined ? undefined : JSON.stringify(b) })).json();
const make = async (u) => {
  const { token } = await call('POST', '/auth/dev', null, { username: u });
  let st = await call('GET', '/api/me', token);
  if (st.error) st = await call('POST', '/api/player', token, { name: u, demo: true });
  if (!st.player) throw new Error(`cannot make ${u}: ${JSON.stringify(st)}`);
  for (let i = 0; i < 40 && st.player.accountStatus !== 'ready'; i++) {
    await sleep(300);
    st = await call('GET', '/api/me', token);
  }
  if (!st.plots[0].tree) {
    await call('POST', '/api/checkin', token);
    st = await call('GET', '/api/me', token);
    await call('POST', '/api/plant', token, { plot: 0, seedId: (st.seeds.find((x) => x.species === 'mango') ?? st.seeds[0]).id });
  }
  await call('POST', '/api/water', token, { plot: 0 });
  // Skip the tutorial so its coach does not cover the screen.
  await call('POST', '/api/tutorial', token, { skip: true }).catch(() => undefined);
  return token;
};
const row = (a) => db?.prepare("SELECT m.id, m.kind, m.status, m.turn, m.winner, m.end_reason, m.prize_micro, m.practice FROM arena_matches m JOIN players p ON p.id = m.challenger_id WHERE p.name = ? ORDER BY m.id DESC LIMIT 1").get(a);

const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const viewport = { width: +W, height: +H };
const shot = async (page, name) => {
  const file = `${out}/${W}x${H}-${name}.png`;
  await page.screenshot({ path: file });
  console.log('   screenshot', file);
};

async function open(ctx, name) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.log(`[${name}] pageerror`, e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && console.log(`[${name}] console`, m.text()));
  await page.goto(UI);
  // A saved session (same browser context) skips the sign-in.
  await Promise.race([page.waitForSelector('#dev-user'), page.waitForSelector('.plots')]);
  if (await page.$('#dev-user')) {
    await page.fill('#dev-user', name);
    await page.getByText('Enter', { exact: true }).click();
    await page.waitForSelector('.plots');
  }
  await sleep(1500);
  await page.evaluate(() => document.querySelectorAll('.dialog-backdrop .info-close').forEach((b) => b.click()));
  const skip = page.getByText('Skip tutorial');
  if (await skip.count()) await skip.first().click().catch(() => undefined);
  await sleep(400);
  await page.evaluate(() => document.querySelectorAll('.dialog-backdrop:not(.invite-backdrop):not(.duel-backdrop) .info-close').forEach((b) => b.click()));
  return page;
}

/** A opens the Arena window and taps Duel on B (B must be online: the button has the mint dot). */
async function challenge(page, foe) {
  await page.evaluate(() => document.querySelector('.pin-arena').click());
  await sleep(400);
  if (await page.$('.hs-bubble')) await page.locator('.hs-bubble button', { hasText: 'Open' }).click();
  await page.waitForSelector('.arena-dialog .arena-duel-btn');
  // The opponent list loads; wait until B shows as online (its ping every 4 s).
  let dot = false;
  for (let i = 0; i < 20 && !dot; i++) {
    dot = await page.evaluate((foe) => {
      const r = [...document.querySelectorAll('.arena-list .farmer-row')].find((x) => x.querySelector('.farmer-name').innerText === foe);
      return !!r?.querySelector('.arena-duel-btn .online-dot');
    }, foe);
    if (!dot) {
      await sleep(1000);
      // Re-open the window for a fresh list.
      await page.evaluate(() => document.querySelector('.arena-dialog .info-close')?.click());
      await sleep(200);
      await page.evaluate(() => document.querySelector('.pin-arena').click());
      await sleep(300);
      if (await page.$('.hs-bubble')) await page.locator('.hs-bubble button', { hasText: 'Open' }).click();
      await page.waitForSelector('.arena-dialog .arena-duel-btn');
    }
  }
  check(dot, `Duel button of ${foe} has the Online dot (live duel)`);
  return dot;
}
const tapDuel = (page, foe) =>
  page.evaluate((foe) => [...document.querySelectorAll('.arena-list .farmer-row')].find((r) => r.querySelector('.farmer-name').innerText === foe).querySelector('.arena-duel-btn').click(), foe);

const ready = (page) => page.evaluate(() => { const b = document.querySelector('.rps-btn'); return !!b && !b.disabled; });
const ended = (page) => page.evaluate(() => !!document.querySelector('.duel-result'));
const waitReady = async (page, ms = 20000) => {
  for (let t = 0; t < ms; t += 100) {
    if ((await ended(page)) || (await ready(page))) return;
    await sleep(100);
  }
};
const pickOn = (page, p) =>
  p === 'gold' ? page.click('.gold-durian-btn') : page.evaluate((p) => [...document.querySelectorAll('.rps-btn')].find((b) => b.innerText.trim().toLowerCase() === p).click(), p);
const goldLit = (page) => page.evaluate(() => !!document.querySelector('.gold-durian-btn.lit:not([disabled])'));
const state = (page) =>
  page.evaluate(() => {
    const d = document.querySelector('.duel.match');
    if (!d) return { screen: 'none' };
    return {
      head: [...d.querySelectorAll('.fighter-name')].map((e) => e.innerText.replace(/\n/g, ' ')).join(' | '),
      hp: [...d.querySelectorAll('.hp-fill')].map((e) => e.style.width).join(' '),
      picks: [...d.querySelectorAll('.fighter')].map((f) => f.querySelector('.pick-bubble')?.getAttribute('aria-label') ?? '-').join(' | '),
      turn: d.querySelector('.match-turn')?.innerText ?? null,
      why: d.querySelector('.match-why')?.innerText ?? null,
      note: d.querySelector('.match-note')?.innerText ?? null,
      banner: d.querySelector('.turn-banner')?.innerText ?? null,
      wait: d.querySelector('.match-wait')?.innerText.replace(/\n/g, ' ') ?? null,
      invite: d.querySelector('.match-invite')?.innerText.replace(/\n/g, ' ') ?? null,
      result: d.querySelector('.duel-headline')?.innerText ?? null,
      reward: [...d.querySelectorAll('.duel-reward, .duel-gains')].map((e) => e.innerText.replace(/\n/g, ' ')).join(' / ') || null,
      pageScroll: document.documentElement.scrollHeight > innerHeight + 1 || document.documentElement.scrollWidth > innerWidth + 1,
    };
  });
const QQ = 'Choosing... | Choosing...';
const log = async (label, page) => console.log(`   ${label}:`, JSON.stringify(await state(page)));

/** Invite -> popup on B -> Accept. Returns when both are on the duel screen. */
async function inviteAndAccept(A, B, a, b, tag) {
  await challenge(A, b);
  await tapDuel(A, b);
  await A.waitForSelector('.duel.match .match-invite', { timeout: 10000 });
  await sleep(300);
  await log('A waits', A);
  await shot(A, `${tag}-a-waiting`);
  await B.waitForSelector('.arena-invite', { timeout: 10000 });
  await sleep(300);
  const pop = await B.evaluate(() => {
    const e = document.querySelector('.arena-invite');
    const r = e.getBoundingClientRect();
    return { text: e.innerText.replace(/\n/g, ' '), onScreen: r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth };
  });
  console.log('   B popup:', JSON.stringify(pop));
  check(new RegExp(`${a.toUpperCase()} CHALLENGES YOU!`).test(pop.text) && pop.onScreen, 'B sees "<NAME> CHALLENGES YOU!" fully on screen');
  await shot(B, `${tag}-b-popup`);
  return pop;
}

async function koScenario(n) {
  const a = `${prefix}a${n}`, b = `${prefix}b${n}`;
  console.log(`\n== ko: ${a} challenges ${b} ==`);
  await make(a);
  await make(b);
  const ca = await browser.newContext({ viewport });
  const cb = await browser.newContext({ viewport });
  const A = await open(ca, a);
  const B = await open(cb, b);
  await inviteAndAccept(A, B, a, b, 'ko');
  await B.locator('.arena-invite .btn-gold').click();
  await A.waitForSelector('.duel.match .rps-btn', { timeout: 10000 });
  await B.waitForSelector('.duel.match .rps-btn', { timeout: 10000 });
  await sleep(800);
  await log('A start', A);
  await log('B start', B);
  const hb = await B.evaluate(() => [...document.querySelectorAll('.duel.match .fighter-name')].map((e) => e.innerText).join(' | '));
  check(hb.startsWith(b) && !/TaniBot/.test(hb.split('|')[1] ?? ''), `B sees itself on the left and ${a} (not "TaniBot") on the right: ${hb.replace(/\n/g, ' ')}`);
  await shot(A, 'ko-a-start');
  await shot(B, 'ko-b-start');
  check(!(await state(A)).pageScroll && !(await state(B)).pageScroll, 'no page scroll on either screen');
  let t = 0;
  for (; t < 30; t++) {
    await waitReady(A);
    await waitReady(B);
    if ((await ended(A)) || (await ended(B))) break;
    // Every new turn starts with "?" over BOTH heads on BOTH screens (last turn's picks are gone).
    const startA = (await state(A)).picks;
    const startB = (await state(B)).picks;
    check(startA === QQ && startB === QQ, `turn ${t + 1} starts with "?" over both heads: A ${startA} / B ${startB}`);
    if (t === 1) {
      await shot(A, 'ko-a-turn2-start');
      await shot(B, 'ko-b-turn2-start');
    }
    const pa = (await goldLit(A)) ? 'gold' : 'paper';
    await pickOn(A, pa);
    // B's web asks every second: give it time to hear that A picked.
    await sleep(t <= 1 ? 1600 : 300);
    if (t <= 1) {
      const pA = (await state(A)).picks;
      const pB = (await state(B)).picks;
      check(pA === `${pa === 'gold' ? 'Gold Durian' : 'Paper'} | Choosing...` && pB === QQ, `turn ${t + 1}: A sees its own pick + "?", B sees "?" + "?" while A's pick is secret: A ${pA} / B ${pB}`);
      if (t === 1) await shot(B, 'ko-b-turn2-a-picked');
    }
    if (t === 0) {
      const sb = await state(B);
      const html = await B.evaluate(() => document.querySelector('.duel.match').innerHTML);
      console.log('   B after A picked:', JSON.stringify(sb));
      check(/has picked/.test(sb.turn ?? '') && !/aria-label="Paper"/.test(html), "B sees only that A picked, never A's pick");
      await shot(B, 'ko-b-a-picked');
      const sa = await state(A);
      check(/Waiting for/.test(sa.turn ?? ''), `A waits for B: ${sa.turn}`);
      await shot(A, 'ko-a-waiting-for-b');
    }
    await pickOn(B, 'rock');
    if (pa !== 'gold') {
      // Decided: both picks open together on both screens.
      let rA = '', rB = '';
      for (let i = 0; i < 25; i++) {
        rA = (await state(A)).picks;
        rB = (await state(B)).picks;
        if (rA === 'Paper | Rock' && rB === 'Rock | Paper') break;
        await sleep(80);
      }
      check(rA === 'Paper | Rock' && rB === 'Rock | Paper', `turn ${t + 1} decided: both picks open on both screens: A ${rA} / B ${rB}`);
    }
    if (t === 0) {
      await sleep(300);
      await log('A turn 1 reveal', A);
      await shot(A, 'ko-a-reveal');
    }
    if (pa === 'gold') {
      await sleep(400);
      await shot(B, 'ko-b-gold-durian');
    }
  }
  for (let i = 0; i < 80 && !((await ended(A)) && (await ended(B))); i++) await sleep(250);
  await sleep(500);
  const ra = await state(A);
  const rb = await state(B);
  console.log('   A result:', JSON.stringify(ra));
  console.log('   B result:', JSON.stringify(rb));
  check(ra.result === 'YOU WIN!' && /PANEN/.test(ra.reward ?? ''), 'A wins with a PANEN prize');
  check(rb.result === `${a.toUpperCase()} WINS`, `B sees "${a.toUpperCase()} WINS"`);
  console.log('   row:', JSON.stringify(row(a)), `(${t} turns)`);
  await shot(A, 'ko-a-result');
  await shot(B, 'ko-b-result');
  await ca.close();
  await cb.close();
}

async function declineScenario(n) {
  const a = `${prefix}a${n}`, b = `${prefix}b${n}`;
  console.log(`\n== decline: ${a} challenges ${b}, ${b} declines ==`);
  await make(a);
  await make(b);
  const ca = await browser.newContext({ viewport });
  const cb = await browser.newContext({ viewport });
  const A = await open(ca, a);
  const B = await open(cb, b);
  await inviteAndAccept(A, B, a, b, 'decline');
  await B.locator('.arena-invite button', { hasText: 'Decline' }).click();
  await A.waitForSelector('.duel.match .rps-btn', { timeout: 6000 });
  await sleep(500);
  const s = await state(A);
  console.log('   A after decline:', JSON.stringify(s));
  check(new RegExp(`${b} said no: you fight ${b}'s TaniBot!`).test(s.note ?? ''), 'A: "said no: you fight <b>\'s TaniBot!"');
  check(/TaniBot/.test(s.head), 'A now fights the TaniBot');
  await shot(A, 'decline-a-taniBot');
  // Against the TaniBot too: after a turn, the next one starts with "?" over both heads.
  check(s.picks === QQ, `TaniBot duel turn 1 starts with "?" over both: ${s.picks}`);
  for (let t = 0; t < 2; t++) {
    await pickOn(A, 'paper');
    await sleep(200);
    const mid = (await state(A)).picks;
    check(/^Paper \| /.test(mid), `TaniBot duel turn ${t + 1}: my pick shows at once: ${mid}`);
    await sleep(900);
    await waitReady(A);
    const next = (await state(A)).picks;
    check(next === QQ || (await ended(A)), `TaniBot duel turn ${t + 2} starts with "?" over both: ${next}`);
  }
  await shot(A, 'decline-a-taniBot-turn3');
  check(!(await B.$('.arena-invite')), 'B: popup gone');
  console.log('   row:', JSON.stringify(row(a)));
  await ca.close();
  await cb.close();
}

async function goneScenario(n) {
  const a = `${prefix}a${n}`, b = `${prefix}b${n}`;
  console.log(`\n== gone: missed turn, ${b} leaves and comes back, then leaves for good ==`);
  await make(a);
  await make(b);
  const ca = await browser.newContext({ viewport });
  const cb = await browser.newContext({ viewport });
  const A = await open(ca, a);
  let B = await open(cb, b);
  await inviteAndAccept(A, B, a, b, 'gone');
  await B.locator('.arena-invite .btn-gold').click();
  await waitReady(A);
  await waitReady(B);
  // Turn 1: only A picks; B lets the 10 s run out.
  await pickOn(A, 'rock');
  let banner = null;
  for (let i = 0; i < 100 && !banner; i++) {
    await sleep(200);
    banner = (await state(B)).banner;
  }
  const sb = await state(B);
  console.log('   B after its missed turn:', JSON.stringify(sb));
  check(banner === 'Time’s up!', `B: banner "Time’s up!" (got ${banner})`);
  await shot(B, 'gone-b-times-up');
  await sleep(1500);
  await log('A after B missed', A);
  // B closes its page.
  await B.close();
  let wait = null;
  for (let i = 0; i < 50 && !wait; i++) {
    await sleep(250);
    wait = (await state(A)).wait;
  }
  console.log('   A sees:', wait);
  check(new RegExp(`Waiting for ${b}`).test(wait ?? ''), `A: "Waiting for ${b}... 20"`);
  await sleep(2000);
  await shot(A, 'gone-a-waiting');
  check((await A.evaluate(() => [...document.querySelectorAll('.rps-btn')].every((x) => x.disabled))), 'A cannot pick while waiting');
  // B comes back (same browser): the duel opens again by itself.
  B = await open(cb, b);
  await B.waitForSelector('.duel.match', { timeout: 10000 });
  let back = false;
  for (let i = 0; i < 40 && !back; i++) {
    await sleep(250);
    back = !(await state(A)).wait;
  }
  check(back, 'B came back: A no longer waits, the duel goes on');
  await waitReady(B);
  await log('B back', B);
  await shot(B, 'gone-b-back');
  // B leaves for good (Leave button): A wins after 20 s.
  await B.click('.duel.match .info-close');
  await sleep(300);
  console.log('   B leave question:', await B.evaluate(() => document.querySelector('.match-leave')?.innerText.replace(/\n/g, ' ')));
  await shot(B, 'gone-b-leave-question');
  await B.locator('.match-leave button', { hasText: 'Leave' }).click();
  await B.close();
  for (let i = 0; i < 140 && !(await ended(A)); i++) await sleep(250);
  const ra = await state(A);
  console.log('   A result:', JSON.stringify(ra));
  check(ra.result === 'YOU WIN!' && new RegExp(`${b} left the duel, so you win!`).test(ra.reward ?? ''), 'A wins because B left (prize)');
  console.log('   row:', JSON.stringify(row(a)));
  await shot(A, 'gone-a-win');
  await ca.close();
  await cb.close();
}

async function cancelScenario(n) {
  const a = `${prefix}a${n}`, b = `${prefix}b${n}`;
  console.log(`\n== cancel: ${b} leaves before the first turn ends ==`);
  const ta = await make(a);
  await make(b);
  const ca = await browser.newContext({ viewport });
  const cb = await browser.newContext({ viewport });
  const A = await open(ca, a);
  const B = await open(cb, b);
  const left0 = (await call('GET', '/api/me', ta)).arena?.left;
  await inviteAndAccept(A, B, a, b, 'cancel');
  await B.locator('.arena-invite .btn-gold').click();
  await B.waitForSelector('.duel.match .rps-btn', { timeout: 8000 });
  await B.close();
  for (let i = 0; i < 140 && !(await ended(A)); i++) await sleep(250);
  const ra = await state(A);
  console.log('   A result:', JSON.stringify(ra));
  check(ra.result === 'CANCELLED', 'A: CANCELLED');
  const left1 = (await call('GET', '/api/me', ta)).arena?.left;
  check(left0 === left1, `not counted: duels left ${left0} -> ${left1}`);
  console.log('   row:', JSON.stringify(row(a)));
  await shot(A, 'cancel-a');
  await ca.close();
  await cb.close();
}

const list = which.split(',');
let n = Date.now() % 1000;
for (const s of list) {
  n++;
  if (s === 'ko') await koScenario(n);
  if (s === 'decline') await declineScenario(n);
  if (s === 'gone') await goneScenario(n);
  if (s === 'cancel') await cancelScenario(n);
}
await browser.close();
console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
