// The landing page at / (the game itself is at /play). Full-screen sections like a game site:
// the hero (the game's own village at midday with all its animations), then one screen each for
// the Living Tree NFT, TaniBot, $PANEN, "Play first, own later" and the closing call. Each
// section has its own palette colour; the borders are stepped pixel dithers (Dither). A floating
// "Play for free" appears once the hero is scrolled away. Still with prefers-reduced-motion.
// A signed-in player (or an old link with game options such as ?record=1) goes straight to /play
// (inline script in index.html, before anything loads). "Try as Judge" opens /play?judge=1, which
// makes the judge garden right away, exactly like the button on the sign-in page.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './fonts.css';
import './styles.css';
import './landing.css';
import { API_URL } from './api';
import { installChunkReload } from './chunk-reload';
import { DARTO_IDLE, DARTO_PALETTE } from './art/darto-sprite';
import { Backdrop } from './art/backdrop';
import { V3_PHONE, V3_WEB } from './art/village';
import { Avatar } from './art/avatars';
import { TaniBot } from './art/tanibot';
import { TreePixels } from './art/trees';
import { Pixels, Sprite, type SpriteName } from './sprites';
import { parseRef, readRef, withRef } from './referral';

/** An invite (?ref=) goes with every link to /play (index.html's script also kept it in localStorage). */
const REF: string | null = (() => {
  try {
    return parseRef(location.search) ?? readRef(localStorage, Date.now());
  } catch {
    return parseRef(location.search);
  }
})();
const PLAY = withRef('/play', REF);
const JUDGE = withRef('/play?judge=1', REF);

const EXPLORER = 'https://testnet.nearblocks.io';
const HOUR = 11; // a sunny late morning in Tandur: the landing is always day (no clock, no weather)
const DAY = (HOUR - 7) / 24; // village clock fraction (the day starts at 07:00)
/** Phones: the sky's sun, clouds and birds sit just above the village (game rows; the art is 120 x 180). */
const PHONE_SKY_TOP = 38;

interface Stats {
  panen: { totalMinted: number; totalBurned: number; season: number; rewardDivisor: number };
  treeNfts: number;
  village: { players: number; harvests: number };
}

const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString('en-US'));

/** Phones and small tablets use the upright village. */
function useNarrow(): boolean {
  const query = '(max-width: 1023px)';
  const [narrow, setNarrow] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const m = matchMedia(query);
    const on = () => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

function Hero() {
  const narrow = useNarrow();
  return (
    <header class={`lp-hero${narrow ? ' narrow' : ' wide'}`} id="top">
      {/* The game's own village and sky, always at midday: waterfalls, rotors, train, volcano smoke,
          lanterns, drones, sun, clouds and birds move exactly as in the garden. */}
      <div class="lp-backdrop" aria-label="The farming village of Tandur" role="img">
        <Backdrop fraction={DAY} hd village={narrow ? V3_PHONE : V3_WEB} skyTop={narrow ? PHONE_SKY_TOP : undefined} />
      </div>
      <div class="lp-hero-top">
        <h1 class="logo lp-logo">NEARvest</h1>
        <div class="lp-tagline">Grow. Harvest. Own.</div>
        <div class="lp-lead">A pixel farming game on NEAR where your tree is a living NFT and an AI farmer tends it while you sleep.</div>
      </div>
      <div class="lp-cta">
        <a class="btn btn-mint lp-play" href={PLAY}>
          Play for free
        </a>
        <a class="btn btn-gold lp-judge" href={JUDGE}>
          Try as Judge
        </a>
        <span class="lp-cta-note">Sign in with Google or a NEAR wallet. No fees, testnet.</span>
        <span class="lp-cta-note lp-device-note">Plays on phones and laptops. For the best view, use Chrome on a laptop.</span>
      </div>
      <Dither to="--leaf-500" id="d0" />
    </header>
  );
}

/**
 * The stepped pixel border at the bottom of a section: three rows of 8 px squares in the next
 * section's colour, 25% -> 50% -> 75% filled (an ordered dither), then the next section starts.
 */
function Dither({ to, id }: { to: `--${string}`; id: string }) {
  const sq = 8;
  return (
    <svg class="lp-dither" style={{ color: `var(${to})` }} aria-hidden="true" height={sq * 6} preserveAspectRatio="none">
      <defs>
        <pattern id={`${id}-25`} width={sq * 2} height={sq * 2} patternUnits="userSpaceOnUse">
          <rect width={sq} height={sq} fill="currentColor" />
        </pattern>
        <pattern id={`${id}-50`} width={sq * 2} height={sq * 2} patternUnits="userSpaceOnUse">
          <rect width={sq} height={sq} fill="currentColor" />
          <rect x={sq} y={sq} width={sq} height={sq} fill="currentColor" />
        </pattern>
        <pattern id={`${id}-75`} width={sq * 2} height={sq * 2} patternUnits="userSpaceOnUse">
          <rect width={sq * 2} height={sq} fill="currentColor" />
          <rect x={sq} y={sq} width={sq} height={sq} fill="currentColor" />
        </pattern>
      </defs>
      <rect y={0} width="100%" height={sq * 2} fill={`url(#${id}-25)`} />
      <rect y={sq * 2} width="100%" height={sq * 2} fill={`url(#${id}-50)`} />
      <rect y={sq * 4} width="100%" height={sq * 2} fill={`url(#${id}-75)`} />
    </svg>
  );
}

/** One full-screen section: its colour, the art, the title and the points (all within one screen). */
function Screen({ id, tone, next, title, art, children }: { id: string; tone: string; next?: `--${string}`; title: string; art?: preact.ComponentChildren; children: preact.ComponentChildren }) {
  return (
    <section class={`lp-screen tone-${tone}`} id={id}>
      <div class="lp-screen-inner">
        {art && <div class="lp-screen-art">{art}</div>}
        <div class="lp-screen-text">
          <h2>{title}</h2>
          {children}
        </div>
      </div>
      {next && <Dither to={next} id={`d-${id}`} />}
    </section>
  );
}

function Points({ items }: { items: [SpriteName, preact.ComponentChildren][] }) {
  return (
    <ul class="lp-points">
      {items.map(([icon, text], i) => (
        <li key={i}>
          <span class="lp-point-icon">
            <Sprite name={icon} scale={2} />
          </span>
          <span>{text}</span>
        </li>
      ))}
    </ul>
  );
}

/** Live numbers from the testnet contracts (small, under the $PANEN points). */
function LiveStats() {
  const [s, setS] = useState<Stats | null>(null);
  useEffect(() => {
    fetch(`${API_URL}/api/stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setS)
      .catch(() => undefined);
  }, []);
  if (!s) return null;
  const items: [string, string, string][] = [
    ['Farmers', fmt(s.village.players), `${EXPLORER}/address/nearvest.testnet`],
    ['PANEN burned', fmt(s.panen.totalBurned), `${EXPLORER}/token/panen.nearvest.testnet`],
    ['Tree NFTs', fmt(s.treeNfts), `${EXPLORER}/nft-token/pohon.nearvest.testnet`],
  ];
  return (
    <div class="lp-live">
      {items.map(([label, value, link]) => (
        <a key={label} href={link} target="_blank" rel="noreferrer">
          <b>{value}</b> {label}
        </a>
      ))}
      <span>Season {s.panen.season} · live on testnet ↗</span>
    </div>
  );
}

/** Sections fade in once as they enter the screen (none with prefers-reduced-motion: CSS). */
function useReveal() {
  useEffect(() => {
    const els = [...document.querySelectorAll('.lp-screen')];
    if (typeof IntersectionObserver !== 'function') {
      els.forEach((e) => e.classList.add('in'));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
      { threshold: 0.25 },
    );
    els.forEach((e) => io.observe(e));
    return () => io.disconnect();
  }, []);
}

/** The page is at the very top (the hero fully in view). */
const atTop = () => window.scrollY <= 8;

/**
 * Smooth scroll to `y` with our own animation (ease in-out, ~600 ms): the browser's smooth
 * scrollIntoView did not move the page for Ardian. Reduced motion = a jump. A wheel / touch / key
 * by the visitor stops it. Returns a stop function.
 */
function scrollToY(y: number): () => void {
  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const from = window.scrollY;
  const dist = y - from;
  if (reduced || Math.abs(dist) < 2) {
    window.scrollTo(0, y);
    return () => undefined;
  }
  const ms = 600;
  const t0 = performance.now();
  let raf = 0;
  const stop = () => {
    cancelAnimationFrame(raf);
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.removeEventListener(ev, stop);
  };
  const step = (t: number) => {
    const k = Math.min(1, (t - t0) / ms);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    window.scrollTo(0, Math.round(from + dist * e));
    if (k < 1) raf = requestAnimationFrame(step);
    else stop();
  };
  for (const ev of ['wheel', 'touchstart', 'keydown'] as const) window.addEventListener(ev, stop, { passive: true });
  raf = requestAnimationFrame(step);
  return stop;
}

/**
 * "See how it works ↓": a small button on the strip of the next section that peeks under the hero
 * (the hero is a little shorter than the screen). Tap = smooth scroll to the start of the first
 * section. Shown whenever the page is at the very top, hidden as soon as it is scrolled down
 * (it comes back at the top). The arrow bobs slowly (still with reduced motion).
 */
function HowItWorks() {
  const [top, setTop] = useState(() => typeof window === 'undefined' || atTop());
  useEffect(() => {
    const on = () => setTop(atTop());
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);
  const go = (e: Event) => {
    e.preventDefault();
    const target = document.getElementById('trees');
    if (!target) return;
    scrollToY(Math.round(target.getBoundingClientRect().top + window.scrollY));
  };
  const gone = !top;
  return (
    <a class={`btn btn-small lp-how${gone ? ' gone' : ''}`} href="#trees" onClick={go} aria-hidden={gone} tabIndex={gone ? -1 : 0}>
      See how it works <span class="lp-how-arrow" aria-hidden="true">↓</span>
    </a>
  );
}

/** The floating "Play for free": shown once the hero's own buttons are out of view. */
function FloatingPlay() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const cta = document.querySelector('.lp-hero .lp-cta');
    const end = document.querySelector('.lp-end .lp-end-buttons');
    if (!cta || typeof IntersectionObserver !== 'function') return;
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((e) => seen.set(e.target, e.isIntersecting));
      // Hidden while the hero's or the closing section's own buttons are on screen.
      setShow(![...seen.values()].some(Boolean));
    });
    io.observe(cta);
    if (end) io.observe(end);
    return () => io.disconnect();
  }, []);
  return (
    <a class={`btn btn-mint lp-float${show ? ' show' : ''}`} href={PLAY} aria-hidden={!show} tabIndex={show ? 0 : -1}>
      Play for free
    </a>
  );
}

function Landing() {
  useReveal();
  const narrow = useNarrow();
  const treeScale = narrow ? 2 : 4;
  return (
    <>
      <Hero />
      <main class="lp-main">
        <Screen
          id="trees"
          tone="leaf"
          next="--soil-500"
          title="Your tree is a living NFT"
          art={
            <div class="lp-tree-row">
              {(
                [
                  ['sprout', 'Sprout', 'common'],
                  ['tree', 'Tree', 'rare'],
                  ['fruiting', 'Fruiting', 'gold'],
                  ['old', 'Memorial', 'common'],
                ] as const
              ).map(([stage, label, q], i) => (
                <figure key={stage}>
                  <TreePixels species={i === 2 ? 'durian' : 'mango'} stage={stage} quality={q} scale={treeScale} seed={i + 1} />
                  <figcaption>{label}</figcaption>
                </figure>
              ))}
            </div>
          }
        >
          <Points
            items={[
              ['seedPacket', <>Plant a seed and a <b>Tree NFT</b> is born in your NEAR account.</>],
              ['droplet', <>It <b>grows, fruits and ages</b> on chain as you water it.</>],
              ['sprout', <><b>Lineage:</b> an old tree drops a superior seed for its next generation.</>],
              ['sparkle', <>Then it becomes a <b>Memorial Tree</b>: it stands on its plot until you plant again, and stays in your Memorial list.</>],
            ]}
          />
        </Screen>

        <Screen
          id="tanibot"
          tone="soil"
          next="--hud"
          title="TaniBot, your AI farmer"
          art={
            <div class="lp-bot-stand">
              <TaniBot tier="farmer" scale={narrow ? 1 : 4} effects={false} />
            </div>
          }
        >
          <Points
            items={[
              ['bolt', <>Its <b>own NEAR wallet</b>: a sub-account just for your bot.</>],
              ['coin', <>You give it a <b>budget</b>; the PANEN contract enforces its <b>daily spending limit</b>.</>],
              ['droplet', <>It waters, harvests and sells <b>while you sleep</b>.</>],
              ['seedPacket', <>Every action is in its <b>Log</b>, with a link to the transaction.</>],
            ]}
          />
        </Screen>

        <Screen
          id="panen"
          tone="hud"
          next="--purple-700"
          title="$PANEN"
          art={
            <div class="lp-panen">
              <Pixels rows={DARTO_IDLE} palette={DARTO_PALETTE} scale={narrow ? 2 : 4} class="lp-darto" />
              <span class="lp-coins">
                <Sprite name="coin" scale={narrow ? 4 : 8} />
                <Sprite name="fire" scale={narrow ? 4 : 8} />
              </span>
            </div>
          }
        >
          <Points
            items={[
              ['coin', <><b>Fair launch:</b> 0% team, no pre-mint. Earned only by farming.</>],
              ['sparkle', <><b>Seasons:</b> harvest rewards halve as more PANEN exists.</>],
              ['fire', <><b>Burn:</b> every PANEN spent in the Shop is burned forever.</>],
            ]}
          />
          <LiveStats />
        </Screen>

        <Screen
          id="own"
          tone="purple"
          next="--cyan-700"
          title="Play first, own later"
          art={
            <div class="lp-own">
              <Avatar id="farmer_hat" size={narrow ? 96 : 224} />
            </div>
          }
        >
          <Points
            items={[
              ['sprout', <><b>Sign in with Google</b>: the game creates your NEAR account.</>],
              ['bolt', <><b>No gas fees</b>: the game pays for every transaction.</>],
              ['lock', <><b>No wallet popups</b> while you play.</>],
              ['coin', <><b>NEAR wallet optional</b>: sign in with Meteor and others too.</>],
              ['sparkle', <><b>Testnet</b>: tokens have no real value.</>],
            ]}
          />
        </Screen>

        <Screen id="near" tone="cyan" next="--ink" title="Built on NEAR">
          <Points
            items={[
              ['coin', <><b>$PANEN</b>: NEP-141 fungible token.</>],
              ['sprout', <><b>Tree NFT</b>: NEP-171 / 177 / 178 / 181.</>],
              ['bolt', <><b>TaniBot</b>: its own sub-account, a function call key and a contract-enforced daily limit.</>],
              ['droplet', <><b>Gasless</b>: NEP-366 meta transactions, relayed by the game.</>],
              ['lock', <><b>Wallet login</b>: NEP-413 signed message via near-connect.</>],
              ['sparkle', <><b>TaniBot's brain</b>: NEAR AI Cloud.</>],
            ]}
          />
          <p class="lp-near-note">Everything runs on NEAR testnet. NEAR Intents are not used (there is no Intents testnet).</p>
        </Screen>

        <section class="lp-screen lp-end tone-ink" id="play">
          <div class="lp-screen-inner lp-end-inner">
            <h2 class="logo lp-end-logo">NEARvest</h2>
            <div class="lp-end-line">Grow. Harvest. Own.</div>
            <div class="lp-end-buttons">
              <a class="btn btn-mint" href={PLAY}>
                Play for free
              </a>
              <a class="btn btn-gold" href={JUDGE}>
                Try as Judge
              </a>
            </div>
            <p class="lp-end-note">Built for the NEAR Hackathon. Testnet: tokens have no real value.</p>
            <nav class="lp-end-links">
              <a href="/privacy">Privacy</a> · <a href="/terms">Terms</a> ·{' '}
              <a href="https://x.com/intent/post?text=I%20found%20NEARvest%3A%20a%20pixel%20farming%20game%20where%20your%20tree%20is%20a%20living%20NFT.%20%40NEARProtocol%20%23NEARHackathon%20https%3A%2F%2Fnearvest-six.vercel.app" target="_blank" rel="noreferrer">
                Share on X
              </a>
            </nav>
          </div>
        </section>
      </main>
      <HowItWorks />
      <FloatingPlay />
    </>
  );
}

installChunkReload();
render(<Landing />, document.getElementById('app')!);
