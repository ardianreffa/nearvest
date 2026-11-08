// The landing page at / (the game itself is at /play). Same pixel-art world as the game: the v3
// village under the code sky, the six TaniBots, Mr. Darto, trees and fruit. Light on phones (no
// game code, only the art it shows) and still with prefers-reduced-motion (landing.css).
// A signed-in player (or an old link with game options such as ?record=1) goes straight to /play
// (inline script in index.html, before anything loads). "Try as Judge" opens /play?judge=1, which
// makes the judge garden right away, exactly like the button on the sign-in page.

import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import './fonts.css';
import './styles.css';
import './landing.css';
import { API_URL } from './api';
import { DARTO_IDLE, DARTO_PALETTE } from './art/darto-sprite';
import { SkyBack } from './art/sky';
import { Drone, TaniBot, TIER_TITLE, TIERS } from './art/tanibot';
import { TreePixels } from './art/trees';
import { Pixels, Sprite } from './sprites';

const EXPLORER = 'https://testnet.nearblocks.io';
const HOUR = 11; // a sunny late morning in Tandur

interface Stats {
  panen: { totalMinted: number; totalBurned: number; season: number; rewardDivisor: number };
  treeNfts: number;
  village: { players: number; harvests: number };
}

const fmt = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : Math.round(n).toLocaleString('en-US'));

function Hero() {
  return (
    <header class="lp-hero" style={{ '--day': '1', '--dusk': '0', '--night': '0' }}>
      <div class="lp-sky">
        <SkyBack hour={HOUR} />
      </div>
      <picture>
        <source media="(max-width: 1023px)" srcset="/assets/bg/village3-phone-day.png" />
        <img class="lp-village" src="/assets/bg/village3-web-day.png" alt="The farming village of Tandur" />
      </picture>
      <span class="lp-drone d1" aria-hidden="true">
        <Drone scale={2} />
      </span>
      <span class="lp-drone d2" aria-hidden="true">
        <Drone scale={2} />
      </span>
      <div class="lp-hero-bot" aria-hidden="true">
        <TaniBot tier="farmer" scale={2} />
      </div>
      <div class="lp-hero-top">
        <h1 class="logo lp-logo">NEARvest</h1>
        <div class="lp-tagline">Grow. Harvest. Own.</div>
        <div class="lp-lead">A pixel farming game on NEAR where your tree is a living NFT and an AI farmer tends it while you sleep.</div>
      </div>
      {/* Phones: the six TaniBots from Seedling to Legend fill the tall sky. */}
      <div class="lp-sky-bots" aria-hidden="true">
        {TIERS.map((t, i) => (
          <span key={t} style={{ animationDelay: `${-i * 0.4}s` }}>
            <TaniBot tier={t} scale={1} />
          </span>
        ))}
      </div>
      <div class="lp-cta">
        <a class="btn btn-mint lp-play" href="/play">
          Play for free
        </a>
        <a class="btn btn-gold lp-judge" href="/play?judge=1">
          Try as Judge
        </a>
        <span class="lp-cta-note">Sign in with Google or a NEAR wallet. No fees, testnet.</span>
      </div>
      <a class="lp-more" href="#trees" aria-label="See how it works">
        ▼
      </a>
    </header>
  );
}

function Section({ id, title, children, art }: { id?: string; title: string; children: preact.ComponentChildren; art: preact.ComponentChildren }) {
  return (
    <section class="lp-section" id={id}>
      <div class="lp-art-box" aria-hidden="true">
        {art}
      </div>
      <div class="lp-text">
        <h2>{title}</h2>
        {children}
      </div>
    </section>
  );
}

function LiveStats() {
  const [s, setS] = useState<Stats | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch(`${API_URL}/api/stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setS)
      .catch(() => setFailed(true));
  }, []);
  const items: [string, string, string][] = s
    ? [
        ['Farmers', fmt(s.village.players), `${EXPLORER}/address/nearvest.testnet`],
        ['Harvests', fmt(s.village.harvests), `${EXPLORER}/token/panen.nearvest.testnet`],
        ['PANEN burned', fmt(s.panen.totalBurned), `${EXPLORER}/token/panen.nearvest.testnet`],
        ['Tree NFTs', fmt(s.treeNfts), `${EXPLORER}/nft-token/pohon.nearvest.testnet`],
      ]
    : [];
  return (
    <section class="lp-section lp-stats-section" id="stats">
      <div class="lp-text lp-wide">
        <h2>Live from Tandur</h2>
        {failed ? (
          <p>The village stats are resting right now. Open the game to see them.</p>
        ) : !s ? (
          <p>Counting the harvest...</p>
        ) : (
          <div class="lp-stats">
            {items.map(([label, value, link]) => (
              <a key={label} class="lp-stat" href={link} target="_blank" rel="noreferrer">
                <b>{value}</b>
                <span>{label}</span>
                <i>proof on nearblocks ↗</i>
              </a>
            ))}
          </div>
        )}
        {s && (
          <p class="lp-small">
            Season {s.panen.season}: harvest rewards {Math.round(100 / s.panen.rewardDivisor)}%. Everything here is read live from the testnet contracts.
          </p>
        )}
      </div>
    </section>
  );
}

function Landing() {
  return (
    <>
      <Hero />
      <main class="lp-main">
        <Section
          id="trees"
          title="Living Tree NFTs"
          art={
            <div class="lp-trees">
              <TreePixels species="mango" stage="sprout" quality="common" scale={4} seed={1} />
              <TreePixels species="rambutan" stage="tree" quality="rare" scale={4} seed={2} />
              <TreePixels species="durian" stage="fruiting" quality="gold" scale={4} seed={3} />
            </div>
          }
        >
          <p>Plant a seed and a Tree NFT is born in your NEAR account. It grows, fruits and ages on chain as you water it, and an old tree drops a superior seed for the next generation.</p>
        </Section>

        <Section
          title="TaniBot, your AI farmer"
          art={
            <div class="lp-bots">
              {TIERS.map((t) => (
                <figure key={t}>
                  <TaniBot tier={t} scale={1} />
                  <figcaption>{TIER_TITLE[t]}</figcaption>
                </figure>
              ))}
            </div>
          }
        >
          <p>TaniBot waters, harvests and sells while you sleep. It has its own NEAR wallet and a budget you give it; the PANEN contract enforces its daily spending limit, so it can never spend more. It evolves with your title.</p>
        </Section>

        <Section
          title="$PANEN with real mechanics"
          art={
            <div class="lp-panen">
              <Pixels rows={DARTO_IDLE} palette={DARTO_PALETTE} scale={2} class="lp-darto" />
              <span class="lp-coins">
                <Sprite name="coin" scale={6} />
                <Sprite name="fire" scale={6} />
              </span>
            </div>
          }
        >
          <ul class="lp-list">
            <li>
              <b>Fair launch:</b> 0% team, no pre-mint. Earned only by farming.
            </li>
            <li>
              <b>Seasons:</b> harvest rewards halve as more PANEN exists.
            </li>
            <li>
              <b>Burn:</b> every PANEN spent in the Shop is burned forever.
            </li>
          </ul>
        </Section>

        <section class="lp-section lp-steps-section">
          <div class="lp-text lp-wide">
            <h2>How to play</h2>
            <ol class="lp-steps">
              <li>
                <Sprite name="seedPacket" scale={4} />
                <b>Plant</b>
                <span>a seed: a Tree NFT is born</span>
              </li>
              <li>
                <Sprite name="droplet" scale={4} />
                <b>Water</b>
                <span>daily, or let TaniBot do it</span>
              </li>
              <li>
                <Sprite name="durian" scale={4} />
                <b>Harvest</b>
                <span>ripe fruit (Rare x2, Gold x5)</span>
              </li>
              <li>
                <Sprite name="coin" scale={4} />
                <b>Sell</b>
                <span>to Mr. Darto for PANEN</span>
              </li>
            </ol>
          </div>
        </section>

        <LiveStats />

        <section class="lp-section">
          <div class="lp-text lp-wide">
            <h2>Built on NEAR</h2>
            <ul class="lp-tech">
              <li>
                <b>NEP-141</b> $PANEN token
              </li>
              <li>
                <b>NEP-171</b> Living Tree NFTs
              </li>
              <li>
                <b>Sub-accounts</b> for every player and TaniBot
              </li>
              <li>
                <b>Function call keys</b> + contract spending limit
              </li>
              <li>
                <b>NEP-366</b> meta transactions: the game pays gas
              </li>
              <li>
                <b>NEP-413</b> wallet sign-in (near-connect)
              </li>
              <li>
                <b>NEAR AI Cloud</b> TaniBot's brain
              </li>
            </ul>
          </div>
        </section>

        <section class="lp-section">
          <div class="lp-text lp-wide">
            <h2>Roadmap</h2>
            <ol class="lp-roadmap">
              <li class="done">
                <b>Now</b> Plant, water, harvest, sell, Shop burn, Seasons, TaniBot with its own wallet, Try as Judge
              </li>
              <li>
                <b>Next</b> Weather and volcano events, garden visits, P2P market, Arena duels
              </li>
              <li>
                <b>Later</b> Mainnet launch (after legal advice), $PANEN/NEAR pool on a NEAR DEX
              </li>
            </ol>
          </div>
        </section>

        <section class="lp-final">
          <TaniBot tier="seedling" scale={2} />
          <a class="btn btn-mint lp-play" href="/play">
            Play for free
          </a>
        </section>
      </main>
      <footer class="lp-footer">
        <a href="/privacy">Privacy</a>
        <a href="/terms">Terms</a>
        <a href="https://x.com/intent/post?text=I%20found%20NEARvest%3A%20a%20pixel%20farming%20game%20where%20your%20tree%20is%20a%20living%20NFT.%20%40NEARProtocol%20%23NEARHackathon%20https%3A%2F%2Fnearvest-six.vercel.app" target="_blank" rel="noreferrer">
          Share on X
        </a>
        <span>Built for the NEAR Hackathon. Testnet: tokens have no real value.</span>
      </footer>
    </>
  );
}

render(<Landing />, document.getElementById('app')!);
