// The garden: three plots, the selected plot's actions and the daily check-in.

import { useRef, useState } from 'preact/hooks';
import type { Place } from './art/hotspots';
import type { GameState, Quality, ServerConfig } from './api';
import { floatText } from './fx';
import { seasonPayout } from './qty';
import { GardenScene, type ActionKind, type Immersive, type SceneFx } from './scene';
import { Sprite } from './sprites';
import {
  formatDuration,
  FruitIcon,
  groupSeeds,
  Panel,
  QualityTag,
  SEED_ODDS_TEXT,
  SeedCard,
  QUALITY_NAME,
  SPECIES_NAME,
  STAGE_NAME,
} from './ui';

/** Runs a game action; resolves to the server result, or null if it failed. */
export type Act = (path: string, body?: unknown, success?: string) => Promise<unknown | null>;
/** Shows an in-game confirmation dialog; resolves true when the player confirms. */
export type Ask = (message: string, confirmLabel: string) => Promise<boolean>;
/** One button of a multiple-choice dialog. */
export interface Choice {
  value: string;
  label: string;
  class?: string;
}
/** Shows a dialog with several choices (plus Cancel); resolves to the chosen value or null. */
export type Choose = (message: string, choices: Choice[]) => Promise<string | null>;

interface Props {
  state: GameState;
  config: ServerConfig;
  act: Act;
  ask: Ask;
  choose: Choose;
  /** Milliseconds since the state was loaded, for live countdowns. */
  elapsed: number;
  busy: boolean;
  goShop: () => void;
  /** Wide screens draw the scene art at 3 px per pixel. */
  big: boolean;
  /** Laptop / PC: full-window garden with the selected plot in a bottom action bar. */
  immersive?: Immersive;
  /** Opens the TaniBot window (click on TaniBot). */
  onBot?: () => void;
  onPlace?: (p: Place) => void;
}

export function Garden({ state, config, act, ask, choose, elapsed, busy, goShop, big, immersive, onBot, onPlace }: Props) {
  const [selected, setSelected] = useState(0);
  const [fx, setFx] = useState<SceneFx | null>(null);
  const fxTimer = useRef<number>(0);
  const plot = state.plots[selected];

  /** Runs an action and plays TaniBot's animation for it when it succeeds. */
  const botAct: Act = async (path, body, success) => {
    const kind = (path.split('/').pop() ?? '') as ActionKind;
    const plotIndex = (body as { plot?: number } | undefined)?.plot ?? selected;
    const before = state.plots[plotIndex]?.tree ?? null;
    const result = await act(path, body, success);
    if (result !== null && ['plant', 'water', 'harvest', 'fertilize', 'chop'].includes(kind)) {
      window.clearTimeout(fxTimer.current);
      setFx({ id: Date.now(), kind, plot: plotIndex, tree: before });
      fxTimer.current = window.setTimeout(() => setFx(null), 1700);
      const xp = (result as { xp?: number }).xp;
      if (kind === 'harvest' && xp) floatText(`+${xp} XP`, 'xp');
    }
    return result;
  };

  const panel = (
    <PlotPanel
      state={state}
      config={config}
      plotIndex={selected}
      act={botAct}
      ask={ask}
      choose={choose}
      busy={busy}
      elapsed={elapsed}
      goShop={goShop}
      bar={!!immersive}
      key={selected}
    />
  );

  if (immersive) {
    return (
      <>
        <GardenScene state={state} selected={selected} onSelect={setSelected} elapsed={elapsed} fx={fx} big={big} immersive={immersive} onBot={onBot} onPlace={onPlace} />
        <div class="hud-bar" role="region" aria-label="Selected plot">
          {panel}
        </div>
      </>
    );
  }

  return (
    <div class="garden-screen">

      <GardenScene state={state} selected={selected} onSelect={setSelected} elapsed={elapsed} fx={fx} big={big} onBot={onBot} onPlace={onPlace} />

      {panel}
      {!plot.tree && !plot.locked && state.seeds.length === 0 && (
        <p class="hint">No seeds? Check in daily for a free Mango seed, or visit the Shop.</p>
      )}
    </div>
  );
}

export function CheckinBanner({ state, act, ask, busy, elapsed = 0 }: { state: GameState; act: Act; ask: Ask; busy: boolean; elapsed?: number }) {
  const c = state.checkin;
  const checkin = async () => {
    const seeds = c.nextCalendarDay === 7 ? 2 : 1;
    const free = state.seedSlots.max - state.seedSlots.used;
    if (free < seeds) {
      const what = free <= 0 ? (seeds === 2 ? "today's 2 seeds (Gold Mango + Mango)" : "today's Mango seed") : 'the plain Mango seed (the Gold seed goes in first)';
      const ok = await ask(
        `Your seed storage is full, so ${what} will not fit. You still get the PANEN. Free a slot first in Storage, or check in anyway?`,
        'Check in anyway',
      );
      if (!ok) return;
    }
    const r = (await act('/api/checkin', undefined, 'Checked in!')) as { skipped?: string[] } | null;
    if (r?.skipped?.length) floatText(`Storage full: ${r.skipped.join(', ')} skipped`, 'burn');
  };
  return (
    <div class="checkin">
      <div class="calendar" aria-label="7-day reward calendar">
        {c.calendar.map((d) => {
          const done = c.available ? d.day < c.nextCalendarDay : d.day <= c.nextCalendarDay;
          const next = c.available && d.day === c.nextCalendarDay;
          return (
            <span key={d.day} class={`cal-day${done ? ' done' : ''}${next ? ' next' : ''}${d.day === 7 ? ' big' : ''}`} title={d.reward}>
              {d.day === 7 ? <Sprite name="seedPacket" scale={2} /> : d.day}
            </span>
          );
        })}
      </div>
      <button class="btn btn-mint" disabled={!c.available || busy} onClick={() => void checkin()}>
        {c.available ? `Check in · day ${c.nextCalendarDay}` : `✓ Checked in · streak ${c.streak} · next in ${formatDuration(state.clock.msUntilNextDay - elapsed)}`}
      </button>
      {state.player.demo && <p class="checkin-note">Demo mode: your streak keeps going if you miss up to 10 minutes.</p>}
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function OddsLine({ odds }: { odds: Record<Quality, number> }) {
  const parts = (['common', 'rare', 'gold'] as Quality[]).filter((q) => odds[q] > 0);
  return (
    <span class="odds">
      {parts.map((q) => (
        <span key={q} class={`tag tag-${q}`}>
          {pct(odds[q])} {QUALITY_NAME[q]}
        </span>
      ))}
    </span>
  );
}

function PlotPanel({
  state,
  config,
  plotIndex,
  act,
  ask,
  choose,
  busy,
  elapsed,
  goShop,
  bar = false,
}: {
  state: GameState;
  config: ServerConfig;
  plotIndex: number;
  /** Compact action-bar layout (immersive mode). */
  bar?: boolean;
  act: Act;
  ask: Ask;
  choose: Choose;
  busy: boolean;
  elapsed: number;
  goShop: () => void;
}) {
  const p = state.plots[plotIndex];
  const fertilizer = state.items.find((i) => i.item === 'fertilizer')?.qty ?? 0;

  if (p.locked) {
    return (
      <Panel title={`Plot ${plotIndex + 1}`} class={bar ? 'plot-bar' : undefined}>
        <p class="muted">Locked. Reach 50 XP (Farmhand) to unlock this plot. You have {state.player.xp} XP.</p>
      </Panel>
    );
  }

  if (!p.tree) {
    const groups = groupSeeds(state.seeds, true);
    return (
      <Panel title={`Plot ${plotIndex + 1} · empty`} class={`plot-empty${bar ? ' plot-bar' : ''}`}>
        {groups.length === 0 ? (
          <p class="muted">You have no seeds.</p>
        ) : (
          <div class="seed-row" role="list" aria-label="Your seeds">
            {groups.map((g) => (
              <SeedCard
                key={g.key}
                group={g}
                disabled={busy}
                onPick={() => act('/api/plant', { plot: plotIndex, seedId: g.ids[0] }, `Planted ${SPECIES_NAME[g.species]}!`)}
              />
            ))}
          </div>
        )}
        <p class="seed-note">Tap a seed to plant it: a Tree NFT is minted to your account. {SEED_ODDS_TEXT}</p>
      </Panel>
    );
  }

  const t = p.tree;
  const plot = { plot: plotIndex };
  const storageFull = state.seedSlots.used >= state.seedSlots.max;
  const xpGain = (config.species?.[t.species]?.xpPerHarvest ?? 0) * state.player.xpMultiplier;
  const harvest = async () => {
    if (t.stage === 'old' && storageFull) {
      // Never stuck: the seed stays safe on the tree until the player picks one of these.
      const price = seasonPayout(config.seedSellPrices?.[t.species] ?? 1, state.season.divisor);
      const choice = await choose(
        `Your seed storage is full (${state.seedSlots.used}/${state.seedSlots.max}). This old tree's superior ${SPECIES_NAME[t.species]} seed stays safe on the tree until you choose:`,
        [
          { value: 'plant', label: 'Plant it here', class: 'btn-mint' },
          { value: 'sell', label: `Sell to Darto · ${price}`, class: 'btn-gold' },
        ],
      );
      if (choice === 'plant') await act('/api/harvest', { ...plot, then: 'plant' }, 'The superior seed is planted!');
      else if (choice === 'sell') await act('/api/harvest', { ...plot, then: 'sell' }, `Sold the seed for ${price} PANEN`);
      return;
    }
    await act('/api/harvest', plot, t.stage === 'old' ? 'Got a superior seed!' : 'Harvested!');
  };
  return (
    <Panel
      class={bar ? 'plot-bar' : undefined}
      title={`${QUALITY_NAME[t.quality]} ${SPECIES_NAME[t.species]}`}
      right={<span class="muted small">{t.tokenId ? `NFT #${t.tokenId}` : 'minting NFT...'}</span>}
    >
      <div class="tree-info">
        <span>{STAGE_NAME[t.stage]}</span>
        <span>
          Harvests {t.harvestCount}/{t.maxHarvests}
        </span>
        <span>Age {t.ageDays}d</span>
      </div>
      <div class="progress" aria-label="Growth">
        <div class="progress-bar" style={{ width: `${Math.min(100, t.growthPercent)}%` }} />
      </div>
      <p class="muted small">
        {t.ready
          ? t.stage === 'old'
            ? 'This old tree is ready to drop a superior seed. After that it becomes a Memorial Tree.'
            : 'Fruit is ripe. Harvest it!'
          : t.isWatered
            ? `Growing. Ready in about ${formatDuration(t.msToReady - Math.min(elapsed, t.msToReady))}.`
            : 'Thirsty: water it, trees only grow while watered.'}
      </p>
      {t.isFertilized && t.fertMsLeft - elapsed > 0 && (
        <div class="fert-badge" role="status">
          <Sprite name="fertilizer" scale={2} />
          <span>
            Fertilized: <b>{t.fertSpeed}x speed</b> · {formatDuration(t.fertMsLeft - elapsed)} left
          </span>
        </div>
      )}
      {t.stage !== 'old' && (
        <p class="odds-line small">
          Next harvest: <OddsLine odds={t.nextHarvestOdds} />
        </p>
      )}
      <div class="actions">
        <button class="btn btn-cyan act-water" disabled={busy || t.wateredToday} onClick={() => act('/api/water', plot, 'Watered!')}>
          <Sprite name="droplet" scale={2} /> {t.wateredToday ? 'Watered today' : 'Water'}
        </button>
        <button class="btn act-fertilize" disabled={busy || t.isFertilized || fertilizer < 1} onClick={() => act('/api/fertilize', plot, 'Fertilized!')}>
          <Sprite name="fertilizer" scale={2} /> Fertilize ({fertilizer})
        </button>
        <button
          class="btn btn-gold act-harvest"
          disabled={busy || !t.ready}
          onClick={() => void harvest()}
        >
          <Sprite name="sparkle" scale={2} /> Harvest
        </button>
      </div>
      <p class="muted small help">
        {t.stage === 'old'
          ? 'Old trees give no more fruit or XP. Harvest the seed to plant a new generation.'
          : `XP comes from harvests: +${xpGain} XP per ${SPECIES_NAME[t.species]}${state.player.xpMultiplier > 1 ? ` (demo: ${state.player.xpMultiplier}x)` : ''}. Watering is required: trees only grow while watered (1 day per watering). Fertilizer: 1.5x speed for 1 day and better fruit odds on the next harvest.`}
      </p>
      {fertilizer < 1 && !t.isFertilized && (
        <p class="buy-link">
          No fertilizer.{' '}
          <button class="link-btn" onClick={goShop}>
            Buy in Shop
          </button>
        </p>
      )}
      <button
        class="link-btn danger"
        disabled={busy}
        onClick={async () => {
          if (await ask('Cut this tree down? It becomes a Memorial Tree and the plot is freed.', 'Cut down')) {
            await act('/api/chop', plot, 'Tree cut down');
          }
        }}
      >
        Cut down tree
      </button>
    </Panel>
  );
}
