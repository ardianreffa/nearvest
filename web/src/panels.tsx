// Storage, Shop, Market (Mr. Darto) and Village Stats screens.

import { useEffect, useRef, useState } from 'preact/hooks';
import { ACTIVITY_LABELS, api, nearblocksAccount, type GameState, type Quality, type ServerConfig, type Species, type VillageStats } from './api';
import type { Act } from './garden';
import { DartoFace, DartoFigure, HoverCart, type DartoPose } from './art/darto';
import { MarketBackdrop, ShopBackdrop } from './art/scenes';
import { MOMENT_LABELS, openShare, type MomentKind } from './share';
import { ShopStall } from './art/shop';
import { Sprite } from './sprites';
import { Coin, formatPanen, FruitIcon, groupSeeds, Panel, QtyPicker, QualityTag, QUALITY_NAME, SPECIES_NAME, type SeedGroup } from './ui';

const QUALITY_MULT = { common: 1, rare: 2, gold: 5 } as const;

export type Sell = (species: Species, quality: Quality, qty: number, shownPrice: number) => Promise<void>;

/** Mr. Darto's price for one seed of a group (Rare x2, Gold x5 when the quality is known). */
export function seedPrice(config: ServerConfig, g: Pick<SeedGroup, 'species' | 'quality'>): number {
  return (config.seedSellPrices?.[g.species] ?? 1) * (g.quality ? QUALITY_MULT[g.quality] : 1);
}

export function Storage({ state, config, act, busy, goSell }: { state: GameState; config: ServerConfig; act: Act; busy: boolean; goSell: () => void }) {
  const fertilizer = state.items.find((i) => i.item === 'fertilizer')?.qty ?? 0;
  const [open, setOpen] = useState<string | null>(null);
  const full = state.seedSlots.used >= state.seedSlots.max;
  return (
    <>
      <Panel title="Seeds" right={<span class={`small ${full ? 'slots-full' : 'muted'}`}>{state.seedSlots.used}/{state.seedSlots.max} slots</span>}>
        {full && (
          <p class="notice-inline">Storage is full. Plant, sell (to Mr. Darto) or discard seeds to make room. New seeds wait on your old trees until there is space.</p>
        )}
        {state.seeds.length === 0 ? (
          <p class="muted">No seeds yet.</p>
        ) : (
          <ul class="list">
            {groupSeeds(state.seeds).map((g) => (
              <li key={g.key} class="seed-row">
                <div class="seed-row-main">
                  <FruitIcon species={g.species} />
                  <span class="grow">
                    {SPECIES_NAME[g.species]} seed <b>x{g.ids.length}</b>
                    {g.fromTree && <span class="tiny block">from your tree</span>}
                  </span>
                  <QualityTag quality={g.quality} />
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
          </ul>
        )}
        <p class="muted small">Quality of shop and check-in seeds is revealed when you plant them: 80% Common, 17% Rare, 3% Gold.</p>
      </Panel>
      <Panel title="Fruits" right={state.fruits.length > 0 && <button class="link-btn" onClick={goSell}>Sell to Mr. Darto</button>}>
        {state.fruits.length === 0 ? (
          <p class="muted">Harvest ripe trees to fill your storage.</p>
        ) : (
          <ul class="list">
            {state.fruits.map((f) => (
              <li key={`${f.species}-${f.quality}`}>
                <FruitIcon species={f.species} />
                <span class="grow">{SPECIES_NAME[f.species]}</span>
                <QualityTag quality={f.quality} />
                <b>x{f.qty}</b>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel title="Items">
        <ul class="list">
          <li>
            <Sprite name="fertilizer" scale={3} />
            <span class="grow">Fertilizer</span>
            <b>x{fertilizer}</b>
          </li>
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
        <Sprite name="fire" scale={2} /> Every PANEN you spend here is burned forever.
      </p>
      <ul class="list shop">
        {Object.entries(config.shop).map(([id, item]) => {
          const species = id.startsWith('seed_') ? (id.slice(5) as 'mango' | 'rambutan' | 'durian') : null;
          const canAfford = state.player.balance >= item.price;
          return (
            <li key={id}>
              {species ? <FruitIcon species={species} /> : <Sprite name="fertilizer" scale={3} />}
              <span class="grow">{item.name}</span>
              <button class="btn btn-small" disabled={busy || !canAfford} onClick={() => act('/api/shop/buy', { item: id, qty: 1 }, `Bought ${item.name}`)}>
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
  return (
    <>
      <Panel title="Mr. Darto">
        <div class="market-scene" ref={sceneRef}>
          <MarketBackdrop />
          <DartoFigure pose={pose} fruit={heldFruit} scale={2} />
          <HoverCart scale={2} />
          <p class="speech">"{d.greeting}"</p>
        </div>
        <ul class="list prices">
          {d.prices.map((p) => {
            const pos = ((p.price - p.min) / (p.max - p.min)) * 100;
            return (
              <li key={p.species}>
                <FruitIcon species={p.species} />
                <span class="grow">
                  {SPECIES_NAME[p.species]}
                  <span class="range" aria-hidden="true">
                    <span class="range-dot" style={{ left: `${pos}%` }} />
                  </span>
                  <span class="muted small">
                    {p.min} - {p.max}
                  </span>
                </span>
                <b class={p.price >= p.base ? 'up' : 'down'}>{p.price}</b>
              </li>
            );
          })}
        </ul>
        <p class="muted small">Prices change every day. They never drop below the seed price. Rare fruit pays x2, Gold x5.</p>
      </Panel>
      <Panel title="Sell your fruit">
        {thanks > 0 && (
          <div class="darto-thanks" key={thanks} role="status">
            <DartoFace scale={1} />
            <span class="speech">Thanks!</span>
          </div>
        )}
        {state.fruits.length === 0 ? (
          <p class="muted">You have no fruit to sell.</p>
        ) : (
          <ul class="list">
            {state.fruits.map((f) => {
              const shown = d.prices.find((p) => p.species === f.species)!.price;
              return (
                <li key={`${f.species}-${f.quality}`} class="seed-row">
                  <div class="seed-row-main">
                    <FruitIcon species={f.species} />
                    <span class="grow">
                      {QUALITY_NAME[f.quality]} {SPECIES_NAME[f.species]} <b>x{f.qty}</b>
                      <span class="tiny block">
                        {shown} PANEN each{QUALITY_MULT[f.quality] > 1 ? ` x${QUALITY_MULT[f.quality]} (${QUALITY_NAME[f.quality]})` : ''}
                      </span>
                    </span>
                  </div>
                  <QtyPicker
                    key={`${f.species}-${f.quality}-${f.qty}`}
                    max={f.qty}
                    unitPrice={shown}
                    multiplier={QUALITY_MULT[f.quality]}
                    season={state.season}
                    busy={busy}
                    actionLabel="Sell"
                    onAction={(qty) => {
                      react(f.species);
                      void sell(f.species, f.quality, qty, shown);
                    }}
                  />
                </li>
              );
            })}
          </ul>
        )}
        <p class="muted small">
          {state.season.divisor > 1
            ? `Season ${state.season.number}: harvest rewards ${formatPanen(state.season.rewardPercent)}%. The amounts on the buttons are what you receive.`
            : 'The amounts on the buttons are what you receive.'}
        </p>
      </Panel>
      {seedGroups.length > 0 && (
        <Panel title="Sell seeds" right={<span class="muted small">{state.seedSlots.used}/{state.seedSlots.max} slots</span>}>
          <p class="muted small">Mr. Darto also buys seeds, cheaply. Handy when your storage is full.</p>
          <ul class="list">
            {seedGroups.map((g) => (
              <li key={g.key} class="seed-row">
                <div class="seed-row-main">
                  <FruitIcon species={g.species} />
                  <span class="grow">
                    {SPECIES_NAME[g.species]} seed <b>x{g.ids.length}</b>
                    {g.fromTree && <span class="tiny block">from your tree</span>}
                  </span>
                  <QualityTag quality={g.quality} />
                </div>
                <QtyPicker
                  key={`${g.key}-${g.ids.length}`}
                  max={g.ids.length}
                  unitPrice={seedPrice(config, g)}
                  season={state.season}
                  busy={busy}
                  actionLabel="Sell"
                  onAction={(qty) => {
                    react(g.species);
                    void act('/api/seeds/sell', { seedIds: g.ids.slice(0, qty) }, `Sold ${qty} ${SPECIES_NAME[g.species]} seed${qty > 1 ? 's' : ''}`);
                  }}
                />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
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
      <Panel title="Village Stats">
        {error && <p class="error-text">{error}</p>}
        {!stats ? (
          <p class="muted">Loading live data from NEAR...</p>
        ) : (
          <div class="stats">
            <Stat
              wide
              label={`Season ${stats.panen.season}`}
              value={`Harvest rewards: ${formatPanen(100 / stats.panen.rewardDivisor)}%`}
              note={
                stats.panen.nextSeasonAt
                  ? `Rewards halve when ${formatPanen(stats.panen.nextSeasonAt)} PANEN have been minted (never below 12.5%)`
                  : 'Lowest reward level reached (12.5%)'
              }
            />
            <Stat label="PANEN ever minted" value={formatPanen(stats.panen.totalMinted)} />
            <Stat label="PANEN burned" value={formatPanen(stats.panen.totalBurned)} accent="burn" />
            <Stat label="In circulation" value={formatPanen(stats.panen.circulatingSupply)} />
            <Stat label="Tree NFTs" value={String(stats.treeNfts)} />
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
        {state.player.demo && (
          <>
            <p class="muted small">Demo mode: try every card now.</p>
            <div class="share-buttons">
              {(['first_harvest', 'first_gold', 'evolved', 'streak7', 'title', 'legend'] as MomentKind[]).map((k) => (
                <button
                  key={k}
                  class="btn btn-small"
                  onClick={() => openShare({ kind: k, species: k === 'first_gold' ? 'durian' : 'mango', quality: k === 'first_gold' ? 'gold' : 'common', title: k === 'title' ? 'Orchard Master' : undefined })}
                >
                  {MOMENT_LABELS[k]}
                </button>
              ))}
            </div>
          </>
        )}
      </Panel>
      <Panel title="Your on-chain log">
        <p class="muted small">
          Your account:{' '}
          <a href={nearblocksAccount(state.player.accountId)} target="_blank" rel="noreferrer">
            {state.player.accountId}
          </a>
        </p>
        <ul class="list log">
          {state.activity.map((a) => (
            <li key={a.id}>
              <span class={`dot dot-${a.status}`} />
              <span class="grow">{ACTIVITY_LABELS[a.kind] ?? a.kind}</span>
              {a.explorerUrl ? (
                <a href={a.explorerUrl} target="_blank" rel="noreferrer">
                  view tx
                </a>
              ) : (
                <span class="muted small">{a.status === 'failed' ? 'failed' : 'sending...'}</span>
              )}
            </li>
          ))}
        </ul>
      </Panel>
    </>
  );
}

function Stat({ label, value, note, accent, wide }: { label: string; value: string; note?: string; accent?: string; wide?: boolean }) {
  return (
    <div class={`stat${accent ? ` stat-${accent}` : ''}${wide ? ' stat-wide' : ''}`}>
      <span class="stat-label">{label}</span>
      <span class="stat-value">{value}</span>
      {note && <span class="stat-note">{note}</span>}
    </div>
  );
}

