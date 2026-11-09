// Storage, Shop, Market (Mr. Darto) and Village Stats screens.

import { useEffect, useRef, useState } from 'preact/hooks';
import { ACTIVITY_LABELS, api, nearblocksAccount, nearblocksNft, type GameState, type MemorialView, type Quality, type ServerConfig, type Species, type VillageStats } from './api';
import type { Act } from './garden';
import { DartoFace, DartoFigure, HoverCart, type DartoPose } from './art/darto';
import { MarketBackdrop, ShopBackdrop } from './art/scenes';
import { MOMENT_LABELS, openShare, type MomentKind } from './share';
import { ShopStall } from './art/shop';
import { Sprite } from './sprites';
import { TreePixels } from './art/trees';
import { Info, type InfoKey } from './info';
import { clampQty, saleTotal, seasonPayout, stepQty } from './qty';
import { Coin, formatPanen, FruitIcon, groupSeeds, Panel, QtyPicker, QualityTag, QUALITY_NAME, SPECIES_NAME, type SeedGroup } from './ui';

const QUALITY_MULT = { common: 1, rare: 2, gold: 5 } as const;

export type Sell = (species: Species, quality: Quality, qty: number, shownPrice: number) => Promise<void>;

/** Mr. Darto's price for one seed of a group (Rare x2, Gold x5 when the quality is known). */
export function seedPrice(config: ServerConfig, g: Pick<SeedGroup, 'species' | 'quality'>): number {
  return (config.seedSellPrices?.[g.species] ?? 1) * (g.quality ? QUALITY_MULT[g.quality] : 1);
}

type StorageSection = 'seeds' | 'fruits' | 'items';
const STORAGE_OPEN_KEY = 'nearvest.storageOpen';
/** Rows a closed Storage section shows (the rest: "... 4 more"). */
const STORAGE_PEEK = 2;

function readStorageOpen(): Record<StorageSection, boolean> {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_OPEN_KEY) ?? '{}') as Partial<Record<StorageSection, boolean>>;
    return { seeds: !!v.seeds, fruits: !!v.fruits, items: !!v.items };
  } catch {
    return { seeds: false, fruits: false, items: false };
  }
}

/** "+ SEEDS (6)" / "− SEEDS (6)": opens or closes a Storage section (remembered in this browser). */
function SectionToggle({ name, count, open, toggle }: { name: string; count: number; open: boolean; toggle: () => void }) {
  return (
    <button class="inv-toggle" onClick={toggle} aria-expanded={open} aria-label={`${open ? 'Show less' : 'Show all'} ${name} (${count})`}>
      <span class="inv-sign" aria-hidden="true">
        {open ? '−' : '+'}
      </span>
      {name} ({count})
    </button>
  );
}

function MoreRow({ hidden, onOpen }: { hidden: number; onOpen: () => void }) {
  if (hidden <= 0) return null;
  return (
    <li class="inv-more-row">
      <button class="link-btn inv-more" onClick={onOpen}>
        ... {hidden} more
      </button>
    </li>
  );
}

export function Storage({ state, config, act, busy, goSell }: { state: GameState; config: ServerConfig; act: Act; busy: boolean; goSell: () => void }) {
  const fertilizer = state.items.find((i) => i.item === 'fertilizer')?.qty ?? 0;
  const [open, setOpen] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(readStorageOpen);
  const toggle = (section: StorageSection, to = !expanded[section]) => {
    const next = { ...expanded, [section]: to };
    setExpanded(next);
    try {
      localStorage.setItem(STORAGE_OPEN_KEY, JSON.stringify(next));
    } catch {
      // Storage blocked: remembered for this visit only.
    }
  };
  const full = state.seedSlots.used >= state.seedSlots.max;
  const seedGroups = groupSeeds(state.seeds);
  const shownSeeds = expanded.seeds ? seedGroups : seedGroups.slice(0, STORAGE_PEEK);
  const shownFruits = expanded.fruits ? state.fruits : state.fruits.slice(0, STORAGE_PEEK);
  const items = [{ key: 'fertilizer', qty: fertilizer }];
  return (
    <>
      <Panel
        class="inv-section"
        title={<SectionToggle name="Seeds" count={seedGroups.length} open={expanded.seeds} toggle={() => toggle('seeds')} />}
        right={
          <span class={`small ${full ? 'slots-full' : 'muted'}`}>
            {state.seedSlots.used}/{state.seedSlots.max} slots <Info k="seedStorage" label="seed storage" />
          </span>
        }
      >
        {full && (
          <p class="notice-inline">Storage is full. Plant, sell (to Mr. Darto) or discard seeds to make room. New seeds wait on your old trees until there is space.</p>
        )}
        {state.seeds.length === 0 ? (
          <p class="muted">No seeds yet.</p>
        ) : (
          <ul class="list">
            {shownSeeds.map((g) => (
              <li key={g.key} class="seed-row">
                <div class="seed-row-main">
                  <FruitIcon species={g.species} />
                  <span class="grow">
                    {SPECIES_NAME[g.species]} seed <b>x{g.ids.length}</b>
                    {g.fromTree && <span class="tiny block">from your tree</span>}
                  </span>
                  <QualityTag quality={g.quality} short />
                  <button class="link-btn" onClick={() => setOpen(open === g.key ? null : g.key)} aria-expanded={open === g.key}>
                    {open === g.key ? 'Close' : 'Sell / discard'}
                  </button>
                </div>
                {open === g.key && (
                  <QtyPicker
                    key={g.key}
                    max={g.ids.length}
                    unitPrice={seedPrice(config, g)}
                    season={state.season}
                    busy={busy}
                    actionLabel="Sell to Darto"
                    onAction={(qty) => void act('/api/seeds/sell', { seedIds: g.ids.slice(0, qty) }, `Sold ${qty} ${SPECIES_NAME[g.species]} seed${qty > 1 ? 's' : ''}`)}
                    secondary={{
                      label: 'Discard',
                      onAction: (qty) => void act('/api/seeds/discard', { seedIds: g.ids.slice(0, qty) }, `Discarded ${qty} seed${qty > 1 ? 's' : ''}`),
                    }}
                  />
                )}
              </li>
            ))}
            <MoreRow hidden={seedGroups.length - shownSeeds.length} onOpen={() => toggle('seeds', true)} />
          </ul>
        )}
        {expanded.seeds && <p class="muted small">Quality of shop and check-in seeds is revealed when you plant them: 80% Common, 17% Rare, 3% Gold.</p>}
      </Panel>
      <Panel
        class="inv-section"
        title={<SectionToggle name="Fruits" count={state.fruits.length} open={expanded.fruits} toggle={() => toggle('fruits')} />}
        right={state.fruits.length > 0 && <button class="link-btn" onClick={goSell}>Sell to Mr. Darto</button>}
      >
        {state.fruits.length === 0 ? (
          <p class="muted">Harvest ripe trees to fill your storage.</p>
        ) : (
          <ul class="list">
            {shownFruits.map((f) => (
              <li key={`${f.species}-${f.quality}`}>
                <FruitIcon species={f.species} />
                <span class="grow">{SPECIES_NAME[f.species]}</span>
                <QualityTag quality={f.quality} />
                <b>x{f.qty}</b>
              </li>
            ))}
            <MoreRow hidden={state.fruits.length - shownFruits.length} onOpen={() => toggle('fruits', true)} />
          </ul>
        )}
      </Panel>
      <Panel class="inv-section" title={<SectionToggle name="Items" count={items.length} open={expanded.items} toggle={() => toggle('items')} />}>
        <ul class="list">
          {(expanded.items ? items : items.slice(0, STORAGE_PEEK)).map((i) => (
            <li key={i.key}>
              <Sprite name="fertilizer" scale={3} />
              <span class="grow">
                Fertilizer <Info k="fertilizer" label="Fertilizer" />
              </span>
              <b>x{i.qty}</b>
            </li>
          ))}
          <MoreRow hidden={expanded.items ? 0 : items.length - STORAGE_PEEK} onOpen={() => toggle('items', true)} />
        </ul>
      </Panel>
    </>
  );
}

export function Shop({ state, config, act, busy }: { state: GameState; config: ServerConfig; act: Act; busy: boolean }) {
  return (
    <Panel title="Village Shop" right={<span class="balance-chip"><Coin /> {formatPanen(state.player.balance)}</span>}>
      <div class="shop-scene">
        <ShopBackdrop />
        <ShopStall scale={2} />
      </div>
      <p class="burn-note">
        <Sprite name="fire" scale={2} /> Every PANEN you spend here is burned forever. <Info k="burned" label="burned PANEN" />
      </p>
      <ul class="list shop">
        {Object.entries(config.shop).map(([id, item]) => {
          const species = id.startsWith('seed_') ? (id.slice(5) as 'mango' | 'rambutan' | 'durian') : null;
          const canAfford = state.player.balance >= item.price;
          return (
            <li key={id} class={`shop-${id}`}>
              {species ? <FruitIcon species={species} /> : <Sprite name="fertilizer" scale={3} />}
              <span class="grow">
                {item.name}
                {id === 'fertilizer' ? <> <Info k="fertilizer" label="Fertilizer" /></> : <> <Info k="unknownSeed" label="seed quality" /></>}
              </span>
              <button class="btn btn-small shop-buy" disabled={busy || !canAfford} onClick={() => act('/api/shop/buy', { item: id, qty: 1 }, `Bought ${item.name}`)}>
                <Coin /> {item.price}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Shows a Darto pose for a moment, then goes back to idle. */
function useDartoPose(): [DartoPose, Species, (pose: DartoPose, fruit?: Species) => void] {
  const [pose, setPose] = useState<DartoPose>('idle');
  const [fruit, setFruit] = useState<Species>('durian');
  const timer = useRef<number>();
  const show = (p: DartoPose, f?: Species) => {
    setPose(p);
    if (f) setFruit(f);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setPose('idle'), 2400);
  };
  useEffect(() => {
    show('wave'); // he waves when the Market opens
    return () => clearTimeout(timer.current);
  }, []);
  return [pose, fruit, show];
}

export function Market({ state, config, sell, act, busy }: { state: GameState; config: ServerConfig; sell: Sell; act: Act; busy: boolean }) {
  const d = state.darto;
  const [pose, heldFruit, showPose] = useDartoPose();
  const sceneRef = useRef<HTMLDivElement>(null);
  const [thanks, setThanks] = useState(0);
  const thanksTimer = useRef<number>();
  /** Darto reacts in the scene; if the scene is scrolled out of view, a small face says thanks next to the list. */
  const react = (fruit: Species) => {
    showPose('hold', fruit);
    const r = sceneRef.current?.getBoundingClientRect();
    if (r && (r.bottom < 40 || r.top > window.innerHeight - 40)) {
      setThanks((n) => n + 1);
      clearTimeout(thanksTimer.current);
      thanksTimer.current = window.setTimeout(() => setThanks(0), 2200);
    }
  };
  const seedGroups = groupSeeds(state.seeds);
  const owned = (species: Species) => state.fruits.filter((f) => f.species === species && f.qty > 0);
  const seedCount = seedGroups.reduce((n, g) => n + g.ids.length, 0);
  return (
    <>
      <Panel title="Today's Prices" class="market-panel">
        <div class="market-scene" ref={sceneRef}>
          <MarketBackdrop />
          <DartoFigure pose={pose} fruit={heldFruit} scale={2} />
          <HoverCart scale={2} />
          <p class="speech">"Welcome, farmer! I'm Mr. Darto. Show me what you've got! {d.greeting}"</p>
        </div>
        {thanks > 0 && (
          <div class="darto-thanks" key={thanks} role="status">
            <DartoFace scale={1} />
            <span class="speech">Thanks!</span>
          </div>
        )}
        <ul class="market-rows">
          {d.prices.map((p) => (
            <FruitRow
              key={p.species}
              price={p}
              owned={owned(p.species)}
              season={state.season}
              busy={busy}
              onSell={(quality, qty) => {
                react(p.species);
                void sell(p.species, quality, qty, p.price);
              }}
            />
          ))}
        </ul>
        <p class="muted small">
          Prices change every day and never drop below the seed price. Rare pays x2, Gold x5.{' '}
          {state.season.divisor > 1
            ? `Season ${state.season.number}: harvest rewards ${formatPanen(state.season.rewardPercent)}%. The amount on Sell is what you receive.`
            : 'The amount on Sell is what you receive.'}{' '}
          <Info k="season" label="Seasons" />
        </p>
      </Panel>
      {seedGroups.length > 0 && (
        <details class="panel sell-seeds">
          <summary class="panel-head">
            <h2>Sell seeds</h2>
            <span class="muted small">
              {seedCount} in storage · {state.seedSlots.used}/{state.seedSlots.max} slots
            </span>
          </summary>
          <p class="muted small">Mr. Darto also buys seeds, cheaply. Handy when your storage is full.</p>
          <ul class="market-rows">
            {seedGroups.map((g) => (
              <SeedSellRow
                key={g.key}
                group={g}
                unitPrice={seedPrice(config, g)}
                season={state.season}
                busy={busy}
                onSell={(qty) => {
                  react(g.species);
                  void act('/api/seeds/sell', { seedIds: g.ids.slice(0, qty) }, `Sold ${qty} ${SPECIES_NAME[g.species]} seed${qty > 1 ? 's' : ''}`);
                }}
              />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

type Season = GameState['season'];

/** - / amount / + / Max and a Sell button showing what the player really receives. */
function SellControl({
  max,
  unitPrice,
  multiplier = 1,
  season,
  busy,
  onSell,
}: {
  max: number;
  unitPrice: number;
  multiplier?: number;
  season: Season;
  busy: boolean;
  onSell: (qty: number) => void;
}) {
  const [picked, setPicked] = useState(1);
  const qty = clampQty(picked, max);
  const total = seasonPayout(saleTotal(unitPrice, multiplier, qty), season.divisor);
  const none = max < 1;
  return (
    <div class="sell-ctl">
      <button class="btn btn-small sell-step" aria-label="One less" disabled={busy || none || qty <= 1} onClick={() => setPicked(stepQty(qty, -1, max))}>
        -
      </button>
      <span class="sell-qty" aria-live="polite">
        {qty}
      </span>
      <button class="btn btn-small sell-step" aria-label="One more" disabled={busy || none || qty >= max} onClick={() => setPicked(stepQty(qty, 1, max))}>
        +
      </button>
      <button class="btn btn-small sell-max" disabled={busy || none || qty >= max} onClick={() => setPicked(max)}>
        Max
      </button>
      <button class="btn btn-small btn-gold sell-go" disabled={busy || none} onClick={() => onSell(qty)}>
        {none ? 'Sell' : `Sell ${formatPanen(total)}`}
      </button>
    </div>
  );
}

/** One fruit: today's price (with its range), what you own per quality, and selling, all in one row. */
function FruitRow({
  price,
  owned,
  season,
  busy,
  onSell,
}: {
  price: { species: Species; price: number; base: number; min: number; max: number };
  owned: { quality: Quality; qty: number }[];
  season: Season;
  busy: boolean;
  onSell: (quality: Quality, qty: number) => void;
}) {
  const [quality, setQuality] = useState<Quality | null>(owned[0]?.quality ?? null);
  const chosen = owned.find((o) => o.quality === quality) ?? owned[0] ?? null;
  const pos = ((price.price - price.min) / Math.max(1, price.max - price.min)) * 100;
  return (
    <li class={`market-row${chosen ? '' : ' empty'}`}>
      <div class="market-row-head">
        <FruitIcon species={price.species} scale={3} />
        <span class="market-name">{SPECIES_NAME[price.species]}</span>
        <span class="market-price">
          <b class={price.price >= price.base ? 'up' : 'down'}>{price.price}</b>
          <span class="tiny"> PANEN</span>
        </span>
        <span class="market-range" title={`Today's range ${price.min}-${price.max} (normal ${price.base})`}>
          <span class="range" aria-hidden="true">
            <span class="range-dot" style={{ left: `${pos}%` }} />
          </span>
          <span class="tiny">
            {price.min}-{price.max}
          </span>
        </span>
      </div>
      <div class="market-row-sell">
        {owned.length === 0 ? (
          <span class="muted small market-none">None in storage</span>
        ) : (
          <span class="market-owned" role="radiogroup" aria-label={`${SPECIES_NAME[price.species]} quality to sell`}>
            {owned.map((o) => (
              <button
                key={o.quality}
                role="radio"
                aria-checked={chosen?.quality === o.quality}
                class={`owned-chip q-${o.quality}${chosen?.quality === o.quality ? ' selected' : ''}`}
                onClick={() => setQuality(o.quality)}
                title={o.quality === 'common' ? undefined : `${QUALITY_NAME[o.quality]} pays x${QUALITY_MULT[o.quality]}`}
              >
                {QUALITY_NAME[o.quality]} x{o.qty}
              </button>
            ))}
          </span>
        )}
        <SellControl
          key={`${chosen?.quality ?? 'none'}-${chosen?.qty ?? 0}`}
          max={chosen?.qty ?? 0}
          unitPrice={price.price}
          multiplier={chosen ? QUALITY_MULT[chosen.quality] : 1}
          season={season}
          busy={busy}
          onSell={(qty) => chosen && onSell(chosen.quality, qty)}
        />
      </div>
    </li>
  );
}

/** One kind of seed in the same row pattern. */
function SeedSellRow({ group, unitPrice, season, busy, onSell }: { group: SeedGroup; unitPrice: number; season: Season; busy: boolean; onSell: (qty: number) => void }) {
  return (
    <li class="market-row">
      <div class="market-row-head">
        <FruitIcon species={group.species} scale={3} />
        <span class="market-name">{SPECIES_NAME[group.species]} seed</span>
        <span class="market-price">
          <b>{unitPrice}</b>
          <span class="tiny"> each</span>
        </span>
      </div>
      <div class="market-row-sell">
        <span class="market-owned">
          <span class={`owned-chip q-${group.quality ?? 'unknown'} selected`}>
            {group.quality ? QUALITY_NAME[group.quality] : 'Unknown'} x{group.ids.length}
          </span>
          {group.fromTree && <span class="tiny">from your tree</span>}
        </span>
        <SellControl key={`${group.key}-${group.ids.length}`} max={group.ids.length} unitPrice={unitPrice} season={season} busy={busy} onSell={onSell} />
      </div>
    </li>
  );
}

/**
 * The player's Memorial Trees (old trees that dropped their seed, or cut-down trees), newest first:
 * the tree, its species and quality, its harvests and its NFT on nearblocks. Older servers send no
 * list: then nothing is shown.
 */
function MemorialList({ memorials, pohon }: { memorials?: MemorialView[]; pohon: string }) {
  if (!memorials || memorials.length === 0) return null;
  return (
    <Panel title={`Memorial Trees (${memorials.length})`}>
      <p class="muted small">Old trees that gave their superior seed, and trees that were cut down. Their Tree NFTs stay in your account with their whole history.</p>
      <ul class="list memorial-list">
        {memorials.map((m) => (
          <li key={m.id} class="memorial-row">
            <span class="memorial-art" aria-hidden="true">
              <TreePixels species={m.species} stage="old" quality={m.quality} scale={1} seed={m.tokenId ?? m.id} />
            </span>
            <span class="grow">
              <b>
                {QUALITY_NAME[m.quality]} {SPECIES_NAME[m.species]}
              </b>
              <span class="memorial-meta">
                {m.harvestCount} harvest{m.harvestCount === 1 ? '' : 's'}
                {m.plot !== null ? ` · stands on plot ${m.plot + 1}` : ''}
              </span>
            </span>
            {m.tokenId ? (
              <a class="memorial-nft" href={nearblocksNft(pohon, m.tokenId)} target="_blank" rel="noreferrer">
                NFT #{m.tokenId} ↗
              </a>
            ) : (
              <span class="memorial-nft muted">NFT pending</span>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function Village({ state, config, onBot }: { state: GameState; config: ServerConfig; onBot: () => void }) {
  const [stats, setStats] = useState<VillageStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api<VillageStats>('GET', '/api/stats')
        .then((s) => alive && (setStats(s), setError(null)))
        .catch((e: Error) => alive && setError(e.message));
    void load();
    const id = setInterval(load, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <>
      <Panel title="TaniBot">
        <p class="muted small">Your AI farmer with its own NEAR wallet and a daily spending limit enforced by the PANEN contract.</p>
        <button class="btn btn-mint" onClick={onBot}>
          Open TaniBot
        </button>
      </Panel>
      <MemorialList memorials={state.memorials} pohon={config.contracts.pohon} />
      <Panel title="Village Stats">
        {error && <p class="error-text">{error}</p>}
        {!stats ? (
          <p class="muted">Loading live data from NEAR...</p>
        ) : (
          <div class="stats">
            <Stat
              wide
              label={`Season ${stats.panen.season}`}
              info="season"
              value={`Harvest rewards: ${formatPanen(100 / stats.panen.rewardDivisor)}%`}
              note={
                stats.panen.nextSeasonAt
                  ? `Rewards halve when ${formatPanen(stats.panen.nextSeasonAt)} PANEN have been minted (never below 12.5%)`
                  : 'Lowest reward level reached (12.5%)'
              }
            />
            <Stat label="PANEN ever minted" value={formatPanen(stats.panen.totalMinted)} />
            <Stat label="PANEN burned" value={formatPanen(stats.panen.totalBurned)} accent="burn" info="burned" />
            <Stat label="In circulation" value={formatPanen(stats.panen.circulatingSupply)} />
            <Stat label="Tree NFTs" value={String(stats.treeNfts)} info="treeNft" />
            <Stat label="Farmers" value={String(stats.village.players)} />
            <Stat label="Harvests" value={String(stats.village.harvests)} />
            <Stat label="Fruits sold" value={String(stats.village.fruitsSold)} />
          </div>
        )}
        <p class="muted small">
          Contracts on NEAR {config.network}:{' '}
          <a href={nearblocksAccount(config.contracts.panen)} target="_blank" rel="noreferrer">
            {config.contracts.panen}
          </a>
          ,{' '}
          <a href={nearblocksAccount(config.contracts.pohon)} target="_blank" rel="noreferrer">
            {config.contracts.pohon}
          </a>
        </p>
      </Panel>
      <Panel title="Share to X">
        <p class="muted small">Big moments (first harvest, first Gold tree, TaniBot evolving, a 7-day streak, a new title) open a share card automatically.</p>
        <div class="share-buttons">
          <button class="btn btn-mint" onClick={() => openShare({ kind: 'profile' })}>
            Share my farmer card
          </button>
        </div>
        <details class="share-preview">
          <summary class="btn btn-small">Preview share cards ▾</summary>
          <div class="share-buttons">
            {(['first_harvest', 'first_gold', 'evolved', 'streak7', 'title', 'legend', 'eruption'] as MomentKind[]).map((k) => (
              <button
                key={k}
                class="btn btn-small"
                onClick={() => openShare({ kind: k, species: k === 'first_gold' ? 'durian' : 'mango', quality: k === 'first_gold' ? 'gold' : 'common', title: k === 'title' ? 'Orchard Master' : undefined })}
              >
                {MOMENT_LABELS[k]}
              </button>
            ))}
          </div>
        </details>
      </Panel>
      <Panel title="Your on-chain log">
        <p class="muted small">
          Your account:{' '}
          <a href={nearblocksAccount(state.player.accountId)} target="_blank" rel="noreferrer">
            {state.player.accountId}
          </a>
        </p>
        <ActivityLog activity={state.activity} />
      </Panel>
    </>
  );
}

/** Rows the on-chain log shows before "Show all". */
const LOG_PEEK = 12;

function ago(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * Every NEAR transaction of the garden, newest first: what it was, when, its short hash and a
 * "view tx" link to nearblocks. The one-line notices in the garden only show the latest one; the
 * full details always stay here.
 */
function ActivityLog({ activity }: { activity: GameState['activity'] }) {
  const [all, setAll] = useState(false);
  const rows = all ? activity : activity.slice(0, LOG_PEEK);
  if (activity.length === 0) return <p class="muted small">No transactions yet.</p>;
  return (
    <>
      <ul class="list log">
        {rows.map((a) => (
          <li key={a.id}>
            <span class={`dot dot-${a.status}`} />
            <span class="grow">
              {ACTIVITY_LABELS[a.kind] ?? a.kind}
              <span class="log-meta">
                {ago(a.createdAt)}
                {a.txHash && !a.txHash.startsWith('fake') && <> · {a.txHash.slice(0, 6)}...{a.txHash.slice(-4)}</>}
                {a.status === 'failed' && a.error && <> · {a.error}</>}
              </span>
            </span>
            {a.explorerUrl ? (
              <a href={a.explorerUrl} target="_blank" rel="noreferrer">
                view tx ›
              </a>
            ) : (
              <span class="muted small">{a.status === 'failed' ? 'failed' : a.status === 'done' ? 'done' : 'sending...'}</span>
            )}
          </li>
        ))}
      </ul>
      {activity.length > LOG_PEEK && (
        <button class="link-btn" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${activity.length} transactions`}
        </button>
      )}
    </>
  );
}

function Stat({ label, value, note, accent, wide, info }: { label: string; value: string; note?: string; accent?: string; wide?: boolean; info?: InfoKey }) {
  return (
    <div class={`stat${accent ? ` stat-${accent}` : ''}${wide ? ' stat-wide' : ''}`}>
      <span class="stat-label">
        {label}
        {info && <> <Info k={info} label={label} /></>}
      </span>
      <span class="stat-value">{value}</span>
      {note && <span class="stat-note">{note}</span>}
    </div>
  );
}

