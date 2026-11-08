// "How to play" guide and the $PANEN info window. Plain, honest texts: testnet
// only, no promises of profit.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, nearblocksAccount, type GameState, type ServerConfig, type VillageStats } from './api';
import { DartoFace } from './art/darto';
import { TaniBot, TaniBotHead } from './art/tanibot';
import { TreePixels } from './art/trees';
import { Sprite } from './sprites';
import { Coin, formatPanen } from './ui';

export function Modal({
  title,
  onClose,
  children,
  closeLabel = 'Got it',
  class: cls,
  actions,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  closeLabel?: string;
  class?: string;
  /** Replaces the single close button (e.g. Back / Next). */
  actions?: ComponentChildren;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div class="dialog-backdrop" role="presentation" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div class={`dialog panel info-dialog${cls ? ` ${cls}` : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header class="panel-head">
          <h2>{title}</h2>
          <button class="icon-btn info-close" onClick={onClose} aria-label="Close">
            x
          </button>
        </header>
        <div class="info-body">{children}</div>
        <div class="dialog-actions info-actions">
          {actions ?? (
            <button class="btn btn-mint" onClick={onClose}>
              {closeLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface Page {
  title: string;
  art: ComponentChildren;
  points: { icon: ComponentChildren; text: ComponentChildren }[];
}

const PAGES: Page[] = [
  {
    title: 'Your farm on NEAR',
    art: (
      <>
        <TreePixels species="mango" stage="fruiting" quality="common" scale={2} />
        <TaniBot tier="seedling" scale={1} effects={false} />
        <TreePixels species="durian" stage="tree" quality="rare" scale={2} />
      </>
    ),
    points: [
      {
        icon: <Sprite name="seedPacket" scale={2} />,
        text: (
          <>
            <b>Sign in with Google or a NEAR wallet.</b> With Google the game creates your NEAR testnet account (<i>name.nearvest.testnet</i>) and pays every fee: no wallet needed.
          </>
        ),
      },
      {
        icon: <Sprite name="bolt" scale={2} />,
        text: (
          <>
            <b>With your NEAR wallet</b>: your garden lives in your own account. The game pays the fees; only the one-time Shop setup costs a tiny testnet fee.
          </>
        ),
      },
      {
        icon: <Sprite name="sparkle" scale={2} />,
        text: (
          <>
            <b>Demo mode</b>: 1 game day = 1 minute, so you see the whole loop in a few minutes. Testnet tokens have no real value.
          </>
        ),
      },
    ],
  },
  {
    title: 'Grow',
    art: (
      <>
        <TreePixels species="mango" stage="seed" quality="common" scale={2} />
        <TreePixels species="mango" stage="sprout" quality="common" scale={2} />
        <TreePixels species="mango" stage="tree" quality="common" scale={2} />
        <TreePixels species="mango" stage="fruiting" quality="common" scale={2} />
      </>
    ),
    points: [
      { icon: <Sprite name="seedPacket" scale={2} />, text: <><b>Check in every day</b>: 5 PANEN and a free Mango seed. Day 7 of a streak: double PANEN and a Gold seed.</> },
      { icon: <Sprite name="sprout" scale={2} />, text: <><b>Plant</b>: a Tree NFT is born in your account. It changes on chain as it grows: seed, sprout, tree, fruiting, old.</> },
      { icon: <Sprite name="droplet" scale={2} />, text: <><b>Water</b>: trees only grow while watered (one watering lasts a game day). <b>Fertilizer</b>: 1.5x speed and a better chance of Rare or Gold fruit.</> },
      { icon: <Sprite name="mango" scale={2} />, text: <><b>Harvest</b>: fruit and XP. Titles go from Seedling to Legend. Old trees drop a superior seed, then become Memorial Trees.</> },
    ],
  },
  {
    title: 'Earn and spend $PANEN',
    art: (
      <>
        <DartoFace scale={2} />
        <Coin scale={5} />
        <Sprite name="fire" scale={5} />
      </>
    ),
    points: [
      { icon: <DartoFace scale={1} />, text: <><b>Sell to Mr. Darto</b>: he buys fruit and seeds at a daily price (Rare x2, Gold x5). The PANEN is minted to your account.</> },
      { icon: <Sprite name="fire" scale={2} />, text: <><b>Shop</b>: seeds and fertilizer. Every PANEN you spend there is burned forever.</> },
      { icon: <Coin scale={2} />, text: <><b>Seasons</b>: harvest rewards halve as more PANEN exists (on testnet at 2,000 / 5,000 / 10,000). No team share, no pre-mint.</> },
      { icon: <Sprite name="bolt" scale={2} />, text: <><b>Share on X</b>: big moments (first harvest, a new title, TaniBot evolving) make a card you can post.</> },
    ],
  },
  {
    title: 'TaniBot, your AI farmer',
    art: (
      <>
        <TaniBot tier="seedling" scale={1} effects={false} />
        <TaniBot tier="farmer" scale={1} effects={false} />
        <TaniBot tier="legend" scale={1} effects={false} />
      </>
    ),
    points: [
      { icon: <TaniBotHead tier="seedling" scale={0.55} still />, text: <><b>Its own NEAR wallet</b> with a budget you give it. You can take the budget back at any time.</> },
      { icon: <Sprite name="lock" scale={2} />, text: <><b>A daily spending limit enforced by the PANEN contract</b>: TaniBot can only burn PANEN for Shop purchases, never send it anywhere.</> },
      { icon: <Sprite name="droplet" scale={2} />, text: <><b>Works while you sleep</b>: waters, harvests, sells and buys fertilizer (a NEAR AI brain, checked by the game rules). Every action is in its Log with the transaction.</> },
      { icon: <Sprite name="sparkle" scale={2} />, text: <><b>Evolves with your title</b>: six looks from Seedling to Legend, with drones and auras.</> },
    ],
  },
];

/** "How to play": 4 short pages with Back / Next / Skip and page dots. */
export function HowToPlay({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState(0);
  const p = PAGES[page];
  const last = page === PAGES.length - 1;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setPage((n) => Math.min(PAGES.length - 1, n + 1));
      if (e.key === 'ArrowLeft') setPage((n) => Math.max(0, n - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <Modal
      title="How to play"
      onClose={onClose}
      class="howto-dialog"
      actions={
        <>
          {!last && (
            <button class="btn btn-small howto-skip" onClick={onClose}>
              Skip
            </button>
          )}
          <span class="howto-dots" aria-label={`Page ${page + 1} of ${PAGES.length}`}>
            {PAGES.map((x, i) => (
              <button key={x.title} class={`howto-dot${i === page ? ' active' : ''}`} onClick={() => setPage(i)} aria-label={`Page ${i + 1}: ${x.title}`} />
            ))}
          </span>
          {page > 0 && (
            <button class="btn" onClick={() => setPage(page - 1)}>
              Back
            </button>
          )}
          <button class="btn btn-mint" onClick={() => (last ? onClose() : setPage(page + 1))}>
            {last ? "Let's farm!" : 'Next'}
          </button>
        </>
      }
    >
      <div class="howto-page" key={page}>
        <div class="howto-art" aria-hidden="true">
          {p.art}
        </div>
        <h3 class="howto-title">
          {page + 1}. {p.title}
        </h3>
        <ul class="howto-points">
          {p.points.map((pt, i) => (
            <li key={i}>
              <span class="howto-icon">{pt.icon}</span>
              <span>{pt.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
}

export function PanenInfo({ state, config, onClose }: { state: GameState | null; config: ServerConfig; onClose: () => void }) {
  const [stats, setStats] = useState<VillageStats | null>(null);
  useEffect(() => {
    api<VillageStats>('GET', '/api/stats')
      .then(setStats)
      .catch(() => undefined);
  }, []);
  const season = state?.season;
  const contract = config.contracts.panen;

  return (
    <Modal title="$PANEN" onClose={onClose}>
      <div class="panen-head">
        <Coin scale={5} />
        <div>
          <b>PANEN</b> (Indonesian for "harvest")
          <span class="block small">
            NEP-141 token on NEAR {config.network} · contract{' '}
            <a href={nearblocksAccount(contract)} target="_blank" rel="noreferrer">
              {contract}
            </a>
          </span>
          {state && (
            <span class="block small">
              Your balance: <b>{formatPanen(state.player.balance)} PANEN</b> in{' '}
              <a href={nearblocksAccount(state.player.accountId)} target="_blank" rel="noreferrer">
                {state.player.accountId}
              </a>
            </span>
          )}
        </div>
      </div>

      <h3>Fair launch</h3>
      <p>0% for the team, no pre-mint. Every PANEN is minted only when a player earns it in the game.</p>

      <h3>How to get it</h3>
      <ul class="bullets">
        <li>Welcome pack: 50 PANEN</li>
        <li>Daily check-in: 5 PANEN (10 on day 7 of a streak)</li>
        <li>Selling fruit and seeds to Mr. Darto</li>
      </ul>

      <h3>What it is for</h3>
      <ul class="bullets">
        <li>Seeds and fertilizer in the Shop</li>
        <li>Extra plots and tool upgrades (coming soon)</li>
      </ul>

      <h3>Burned when you spend</h3>
      <p>Every PANEN spent in the Shop is burned forever, on chain.</p>

      <h3>Seasons (halving)</h3>
      <p>
        As more PANEN is minted in total, harvest-sale rewards halve: 100%, 50%, 25%, then 12.5% (the floor). Burning never rewinds a Season.
        Testnet thresholds: 2,000 / 5,000 / 10,000 PANEN ever minted. Daily check-in and the welcome pack never halve.
      </p>
      {season && (
        <p class="info-box">
          Now: <b>Season {season.number}</b>, harvest rewards {formatPanen(season.rewardPercent)}%.
          {stats?.panen.nextSeasonAt ? ` Next halving when ${formatPanen(stats.panen.nextSeasonAt)} PANEN have been minted (now ${formatPanen(stats.panen.totalMinted)}).` : ''}
        </p>
      )}

      <h3>Village Granary</h3>
      <p>1% of Mr. Darto's sales will fill the Village Granary, shared with all farmers at the weekly Harvest Festival (coming soon).</p>

      <h3>Withdraw</h3>
      <p>
        Your PANEN already sits in your own NEAR testnet account. Sending it to another NEAR testnet wallet of yours: <b>coming soon</b>.
      </p>

      <p class="info-box warn">
        Mainnet and DEX listing: planned, not live yet. Testnet tokens have no real value. PANEN is a game currency, not an investment.
      </p>
    </Modal>
  );
}
