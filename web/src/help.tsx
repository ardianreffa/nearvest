// "How to play" guide and the $PANEN info window. Plain, honest texts: testnet
// only, no promises of profit.

import type { ComponentChildren } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { api, nearblocksAccount, type GameState, type ServerConfig, type VillageStats } from './api';
import { DartoFace } from './art/darto';
import { TaniBotHead } from './art/tanibot';
import { TreePixels } from './art/trees';
import { Sprite } from './sprites';
import { Coin, formatPanen } from './ui';

export function Modal({
  title,
  onClose,
  children,
  closeLabel = 'Got it',
  class: cls,
}: {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  closeLabel?: string;
  class?: string;
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
          <button class="btn btn-mint" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Step {
  icon: ComponentChildren;
  title: string;
  text: ComponentChildren;
}

const STEPS: Step[] = [
  {
    icon: <TaniBotHead version={1} scale={1} />,
    title: 'Log in',
    text: 'Sign in with Google or with your NEAR wallet. Google: no wallet needed, the game creates your NEAR testnet account (name.nearvest.testnet) and pays all fees. NEAR wallet: your garden lives in your own account; the game pays the fees too, only the one-time Shop setup is paid by your wallet (a tiny testnet fee).',
  },
  {
    icon: <Sprite name="seedPacket" scale={3} />,
    title: 'Check in every day',
    text: 'Get 5 PANEN and a free Mango seed each day. Day 7 of a streak doubles the PANEN and adds a Gold seed.',
  },
  {
    icon: <TreePixels species="mango" stage="sprout" quality="common" scale={1} />,
    title: 'Plant: a Tree NFT is born',
    text: 'Pick an empty plot and plant a seed. A Tree NFT is minted to your account on NEAR. It changes as the tree grows: seed, sprout, tree, fruiting, old.',
  },
  {
    icon: <Sprite name="droplet" scale={3} />,
    title: 'Water',
    text: 'Trees only grow while watered. One watering lasts one game day.',
  },
  {
    icon: <Sprite name="fertilizer" scale={3} />,
    title: 'Fertilize (optional)',
    text: '1.5x growth speed for a day and a better chance of Rare or Gold fruit on the next harvest.',
  },
  {
    icon: <TreePixels species="mango" stage="fruiting" quality="common" scale={1} />,
    title: 'Harvest',
    text: 'Ripe fruit goes to your Storage and gives XP. Old trees drop a superior seed for the next generation, then become Memorial Trees.',
  },
  {
    icon: <DartoFace scale={1} />,
    title: 'Sell to Mr. Darto: earn PANEN',
    text: 'Mr. Darto buys fruit (and seeds) at a daily price. The PANEN is minted to your NEAR account. Rare pays x2, Gold x5.',
  },
  {
    icon: <Sprite name="fire" scale={3} />,
    title: 'Shop: PANEN is burned',
    text: 'Buy seeds and fertilizer in the Shop. Every PANEN you spend there is burned forever.',
  },
  {
    icon: <Sprite name="sparkle" scale={3} />,
    title: 'Level up',
    text: 'XP from harvests raises your title: Seedling, Farmhand, Farmer, Orchard Master, Durian King, Legend. Farmhand unlocks plot 3; Farmer upgrades TaniBot.',
  },
  {
    icon: <Sprite name="bolt" scale={3} />,
    title: 'Share on X',
    text: 'Big moments (first harvest, first Gold tree, a new title...) make a share card you can post.',
  },
];

export function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="How to play" onClose={onClose}>
      <p class="info-lead">
        Grow fruit trees in the solarpunk village of Tandur. Each tree is a living NFT on NEAR; its fruit earns $PANEN. Goal: build the best
        orchard and rise from Seedling to Legend.
      </p>
      <ol class="steps">
        {STEPS.map((s, i) => (
          <li key={s.title}>
            <span class="step-icon">{s.icon}</span>
            <span>
              <b>
                {i + 1}. {s.title}
              </b>
              <span class="step-text">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
      <div class="info-box">
        <b>How do I get a Tree NFT?</b> Plant any seed: the NFT is minted to your own NEAR account right away. You start with a Rare Durian
        seed, and get a Mango seed every day.
      </div>
      <div class="info-box">
        <b>How do I get PANEN?</b> 50 PANEN welcome pack, 5 PANEN per daily check-in, and selling fruit or seeds to Mr. Darto.
      </div>
      <div class="info-box soon">
        <b>Coming soon: TaniBot, your AI farmer.</b> TaniBot gets its own wallet and a daily budget, and tends your garden while you sleep.
      </div>
      <p class="muted small">Demo mode: 1 game day = 1 minute, so you can see everything in a few minutes. Runs on NEAR testnet.</p>
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
