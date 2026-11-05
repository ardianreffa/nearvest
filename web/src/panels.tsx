// Storage, Shop, Market (Mr. Darto) and Village Stats screens.

import { useEffect, useState } from 'preact/hooks';
import { ACTIVITY_LABELS, api, nearblocksAccount, type GameState, type Quality, type ServerConfig, type Species, type VillageStats } from './api';
import type { Act } from './garden';
import { DartoFigure, HoverCart } from './art/darto';
import { Sprite } from './sprites';
import { Coin, formatPanen, FruitIcon, groupSeeds, Panel, QualityTag, QUALITY_NAME, SPECIES_NAME } from './ui';

const QUALITY_MULT = { common: 1, rare: 2, gold: 5 } as const;

export type Sell = (species: Species, quality: Quality, qty: number, shownPrice: number) => Promise<void>;

export function Storage({ state, goSell }: { state: GameState; goSell: () => void }) {
  const fertilizer = state.items.find((i) => i.item === 'fertilizer')?.qty ?? 0;
  return (
    <>
      <Panel title="Seeds" right={<span class="muted small">{state.seedSlots.used}/{state.seedSlots.max} slots</span>}>
        {state.seeds.length === 0 ? (
          <p class="muted">No seeds yet.</p>
        ) : (
          <ul class="list">
            {groupSeeds(state.seeds).map((g) => (
              <li key={g.key}>
                <FruitIcon species={g.species} />
                <span class="grow">
                  {SPECIES_NAME[g.species]} seed <b>x{g.ids.length}</b>
                  {g.fromTree && <span class="tiny block">from your tree</span>}
                </span>
                <QualityTag quality={g.quality} />
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

export function Market({ state, sell, busy }: { state: GameState; sell: Sell; busy: boolean }) {
  const d = state.darto;
  return (
    <>
      <Panel title="Mr. Darto">
        <div class="market-scene">
          <DartoFigure scale={4} />
          <HoverCart scale={3} />
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
        {state.fruits.length === 0 ? (
          <p class="muted">You have no fruit to sell.</p>
        ) : (
          <ul class="list">
            {state.fruits.map((f) => {
              const shown = d.prices.find((p) => p.species === f.species)!.price;
              const price = shown * QUALITY_MULT[f.quality];
              return (
                <li key={`${f.species}-${f.quality}`}>
                  <FruitIcon species={f.species} />
                  <span class="grow">
                    {QUALITY_NAME[f.quality]} {SPECIES_NAME[f.species]} x{f.qty}
                  </span>
                  <button
                    class="btn btn-small btn-gold"
                    disabled={busy}
                    onClick={() => sell(f.species, f.quality, 1, shown)}
                  >
                    Sell 1 · {price}
                  </button>
                  {f.qty > 1 && (
                    <button
                      class="btn btn-small"
                      disabled={busy}
                      onClick={() => sell(f.species, f.quality, f.qty, shown)}
                    >
                      All
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </>
  );
}

export function Village({ state, config }: { state: GameState; config: ServerConfig }) {
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
