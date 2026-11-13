// The landing page at / (the game itself is at /play). Full-screen sections like a game site
// (redesigned 2026-11-12, Ardian): the hero (the game's own village at midday), then $PANEN (a big
// pixel title and the PANEN coin turning in its medal), "Grow, harvest, earn" (a loop made of the
// game's sprites), "1 VS 1" (two TaniBots on the Tandur Arena), "Fishing" (the real pond scene),
// the Living Tree NFT, TaniBot, "Play first, own later", "Built on NEAR" and the closing call. Each
// section has its own look; the borders are Indonesian textile motifs as pixel art (landing-motif.tsx:
// tumpal, kawung, mega mendung, parang). Design tokens only (sprites keep their pixel palettes). Only
// features that exist are claimed. Still with prefers-reduced-motion. A floating "Play for free"
// appears once the hero is scrolled away.
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
import { Backdrop } from './art/backdrop';
import { V3_PHONE, V3_WEB } from './art/village';
import { Avatar } from './art/avatars';
import { TaniBot } from './art/tanibot';
import { TreePixels } from './art/trees';
import { Sprite, type SpriteName } from './sprites';
import { PanenCoin } from './art/panen-coin';
import { Motif, type MotifKind } from './landing-motif';
import { Card, DuelLoop, FishLoop, Fitted, GrowLoop, PanenMedal } from './landing-scenes';
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

/** The avatar's art is 16 px across: a size in whole multiples of it keeps every pixel sharp. */
const sharp = (px: number) => Math.max(16, Math.floor(px / 16) * 16);

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
      <Motif kind="tumpal" to="--paper" id="m-hero" />
    </header>
  );
}

/** One full-screen section: its colour and look, the art, the title and the points (one screen). */
function Screen({
  id,
  tone,
  next,
  motif,
  title,
  track,
  bigTitle,
  art,
  children,
}: {
  id: string;
  tone: string;
  next?: `--${string}`;
  motif?: MotifKind;
  title: string;
  /** The hackathon track this section belongs to (a small label above the title). */
  track?: 'Games' | 'Memecoins' | 'NFTs' | 'Agents';
  /** A big pixel display title (e.g. "$PANEN") instead of the normal one. */
  bigTitle?: boolean;
  art?: preact.ComponentChildren;
  children: preact.ComponentChildren;
}) {
  return (
    <section class={`lp-screen tone-${tone}`} id={id}>
      <div class="lp-screen-inner">
        {art && <div class="lp-screen-art">{art}</div>}
        <div class="lp-screen-text">
          {track && <span class={`lp-track track-${track.toLowerCase()}`}>Track: {track}</span>}
          <h2 class={bigTitle ? 'lp-big-title' : undefined} data-text={title}>
            {title}
          </h2>
          {children}
        </div>
      </div>
      {next && motif && <Motif kind={motif} to={next} id={`m-${id}`} />}
    </section>
  );
}

function Points({ items }: { items: [SpriteName, preact.ComponentChildren][] }) {
  return (
    <ul class="lp-points">
      {items.map(([icon, text], i) => (
        <li key={i}>
          <span class="lp-point-icon">
            {/* PANEN points use the game's round PANEN coin (Ardian 2026-11-13). */}
            {icon === 'coin' ? <PanenCoin scale={1} /> : <Sprite name={icon} scale={2} />}
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

/**
 * Sections off screen pause their CSS animations (.lp-paused), to save phone batteries; the game
 * scene loops (landing-scenes.tsx) stop by themselves when off screen.
 */
function usePauseOffscreen() {
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const els = [...document.querySelectorAll('.lp-hero, .lp-screen, .lp-judges')];
    const io = new IntersectionObserver((entries) => entries.forEach((e) => e.target.classList.toggle('lp-paused', !e.isIntersecting)), { rootMargin: '80px 0px' });
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
    const target = document.getElementById('judges');
    if (!target) return;
    scrollToY(Math.round(target.getBoundingClientRect().top + window.scrollY));
  };
  const gone = !top;
  return (
    <a class={`btn btn-small lp-how${gone ? ' gone' : ''}`} href="#judges" onClick={go} aria-hidden={gone} tabIndex={gone ? -1 : 0}>
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
    // Also hidden while the judges box's own button is on screen.
    const judges = document.querySelector('.lp-judges-go');
    if (judges) io.observe(judges);
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
  usePauseOffscreen();
  const narrow = useNarrow();
  return (
    <>
      <Hero />
      <main class="lp-main">
        <section class="lp-judges" id="judges">
          <div class="lp-judges-inner">
            <h2 class="lp-judges-title">For judges</h2>
            <p class="lp-judges-line">
              <b>Try as Judge</b> (no sign-in, ~3 min): harvest → sell to Mr. Darto → buy in the Shop (burn) → TaniBot Log → Village Stats
            </p>
            <div class="lp-judges-row">
              <a class="btn btn-gold lp-judges-go" href={JUDGE}>
                Try as Judge
              </a>
              <span class="lp-judges-proof">
                On-chain proof (NEAR testnet):{' '}
                <a href={`${EXPLORER}/token/panen.nearvest.testnet`} target="_blank" rel="noreferrer">
                  panen.nearvest.testnet
                </a>{' '}
                ·{' '}
                <a href={`${EXPLORER}/nft-token/pohon.nearvest.testnet`} target="_blank" rel="noreferrer">
                  pohon.nearvest.testnet
                </a>{' '}
                ·{' '}
                <a href={`${EXPLORER}/address/nearvest.testnet`} target="_blank" rel="noreferrer">
                  nearvest.testnet
                </a>
              </span>
            </div>
          </div>
          <Motif kind="kawung" to="--hud" id="m-judges" />
        </section>

        <Screen id="panen"
          track="Memecoins" tone="hud" next="--leaf-500" motif="mendung" title="$PANEN" bigTitle art={<PanenMedal />}>
          <Points
            items={[
              ['sprout', <><b>Earn it</b> by harvesting and selling fruit to Mr. Darto, by fishing and by winning duels.</>],
              ['fire', <><b>Spend it</b> in the Shop: every PANEN spent there is <b>burned</b> forever.</>],
              ['coin', <><b>Fair launch:</b> 0% team, no pre-mint. Only farming makes new PANEN.</>],
              ['sparkle', <><b>Halving every Season:</b> rewards halve as more PANEN exists.</>],
            ]}
          />
          <LiveStats />
          <p class="lp-mainnet">Mainnet plan: a $PANEN/NEAR pair on a NEAR DEX (planned, after legal advice).</p>
          <p class="lp-small-note">Testnet token, no monetary value.</p>
        </Screen>

        <Screen id="grow"
          track="Games" tone="leaf" next="--soil-500" motif="parang" title="Grow, harvest, earn" art={<GrowLoop />}>
          <Points
            items={[
              ['seedPacket', <><b>Plant</b> a seed: a Tree NFT is born.</>],
              ['droplet', <><b>Water</b> it and watch it grow and fruit.</>],
              ['mango', <><b>Harvest</b> and <b>sell</b> to Mr. Darto: PANEN lands in your balance (after the Season rule).</>],
            ]}
          />
        </Screen>

        <Screen
          id="tanibot"
          track="Agents"
          tone="soil"
          next="--leaf-700"
          motif="tumpal"
          title="TaniBot, your AI farmer"
          art={
            <Card tilt={2} back="/assets/bg/bg-shop.png" class="lp-bot-card">
              <Fitted base={110} class="lp-bot-stand">
                {(k) => <TaniBot tier="farmer" scale={k} effects={false} />}
              </Fitted>
            </Card>
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
          id="trees"
          track="NFTs"
          tone="forest"
          next="--purple-700"
          motif="kawung"
          title="Your tree is a living NFT"
          art={
            <Card tilt={-2} back="/assets/bg/village3-web-dusk.png" class="lp-tree-card">
              <Fitted base={160} min={2} class="lp-tree-row">
                {(k) => (
                  <>
                {(
                  [
                    ['sprout', 'Sprout', 'common'],
                    ['tree', 'Tree', 'rare'],
                    ['fruiting', 'Fruiting', 'gold'],
                    ['old', 'Memorial', 'common'],
                  ] as const
                ).map(([stage, label, q], i) => (
                  <figure key={stage}>
                    <TreePixels species={i === 2 ? 'durian' : 'mango'} stage={stage} quality={q} scale={k} seed={i + 1} />
                    <figcaption>{label}</figcaption>
                  </figure>
                ))}
                  </>
                )}
              </Fitted>
            </Card>
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

        <Screen id="duel"
          track="Games" tone="purple" next="--cyan-700" motif="mendung" title="1 VS 1" art={<DuelLoop />}>
          <Points
            items={[
              ['bolt', <><b>Challenge another farmer</b>, live or against their TaniBot.</>],
              ['durian', <><b>Best fruit hits hardest</b>: your garden's trees are your weapons.</>],
              ['lock', <><b>No token wagering</b>: nobody loses PANEN.</>],
              ['coin', <>The winner's <b>reward comes from the game</b> (a few duels a day).</>],
            ]}
          />
        </Screen>

        <Screen id="fishing"
          track="Games" tone="cyan" next="--gold-700" motif="parang" title="Fishing" art={<FishLoop />}>
          <Points
            items={[
              ['fish', <><b>Cast, wait for the bite, reel in</b> at the jungle pond.</>],
              ['coin', <>Mr. Darto <b>buys your fish</b> on the spot: +PANEN.</>],
              ['sparkle', <>Rare finds: seeds, Fertilizer, the <b>Golden Arowana</b>. 5 casts a day.</>],
            ]}
          />
        </Screen>

        <Screen
          id="own"
          tone="gold"
          next="--soil-700"
          motif="tumpal"
          title="Play first, own later"
          art={
            <Fitted base={1} min={180} max={620} class="lp-own">
              {(k) => <Avatar id="farmer_hat" size={sharp(Math.min(k, narrow ? 260 : Math.round(window.innerHeight * 0.66)))} />}
            </Fitted>
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

        <Screen id="near" tone="soil-dark" next="--ink" motif="kawung" title="Built on NEAR">
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
            <p class="lp-end-note">Built solo by Ardian Reffa with Claude Code · Pixel art AI-generated (ChatGPT) and code-drawn · Runs on NEAR testnet</p>
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
