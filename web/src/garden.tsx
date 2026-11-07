// The garden: three plots, the selected plot's actions and the daily check-in.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Place } from './art/hotspots';
import type { GameState, Quality, ServerConfig } from './api';
import { floatText } from './fx';
import { phoneLayout } from './layout';
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
    <PhoneGarden
      state={state}
      selected={selected}
      onSelect={setSelected}
      elapsed={elapsed}
      fx={fx}
      big={big}
      onBot={onBot}
      onPlace={onPlace}
      sheet={
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
          sheet
          key={selected}
        />
      }
      hint={!plot.tree && !plot.locked && state.seeds.length === 0}
    />
  );
}

/** The window size (phones re-lay out the garden when it changes, e.g. on rotation). */
function useWindowSize() {
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight });
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return size;
}

/**
 * Phones: "game first". The zoomed garden fills about 55% of the screen and pans sideways (the
 * selected plot scrolls into view); the selected plot's panel is a compact sheet above the tabs.
 */
function PhoneGarden({
  state,
  selected,
  onSelect,
  elapsed,
  fx,
  big,
  onBot,
  onPlace,
  sheet,
  hint,
}: {
  state: GameState;
  selected: number;
  onSelect: (plot: number) => void;
  elapsed: number;
  fx: SceneFx | null;
  big: boolean;
  onBot?: () => void;
  onPlace?: (p: Place) => void;
  sheet: preact.ComponentChildren;
  hint: boolean;
}) {
  const { w, h } = useWindowSize();
  const base = phoneLayout(w, h);
  const pan = useRef<HTMLDivElement>(null);
  const sheetBox = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  // The scene grows into any room left between the top bar and the sheet, so the sheet always
  // sits right above the tab bar (the art stays at the bottom; more sky shows above it).
  const [extra, setExtra] = useState(0);
  useLayoutEffect(() => {
    const fit = () => {
      const p = pan.current;
      const sb = sheetBox.current;
      const tabs = document.querySelector('.tabs');
      if (!p || !sb || !tabs) return;
      const room = tabs.getBoundingClientRect().top - 8 - sb.getBoundingClientRect().height - (p.getBoundingClientRect().top + window.scrollY) - 8;
      setExtra((e) => {
        const next = Math.max(0, Math.round(room - base.sceneH));
        return Math.abs(next - e) > 2 ? next : e;
      });
    };
    fit();
    const t = setInterval(fit, 1000);
    return () => clearInterval(t);
  });
  const zoom = { ...base, sceneH: base.sceneH + extra };

  // Keep the selected plot in view (smoothly, unless the player prefers less motion).
  useEffect(() => {
    const el = pan.current;
    if (!el) return;
    const stageW = zoom.sceneW - zoom.stageLeft - zoom.stageRight;
    const centre = zoom.stageLeft + (stageW * (selected + 0.5)) / 3;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: Math.max(0, centre - el.clientWidth / 2), behavior: first.current || reduce ? 'auto' : 'smooth' });
    first.current = false;
  }, [selected, zoom.sceneW, zoom.stageLeft, zoom.stageRight]);

  return (
    <div class="garden-screen phone-garden">
      <div class="scene-pan" ref={pan} style={{ height: `${zoom.sceneH}px` }}>
        <GardenScene state={state} selected={selected} onSelect={onSelect} elapsed={elapsed} fx={fx} big={big} phone={zoom} onBot={onBot} onPlace={onPlace} />
      </div>
      <div class="garden-sheet" ref={sheetBox}>
        {sheet}
        {hint && <p class="hint">No seeds? Check in daily for a free Mango seed, or visit the Shop.</p>}
      </div>
    </div>
  );
}

const SHEET_KEY = 'nearvest.gardenSheet';
function readSheetOpen(): boolean {
  try {
    return localStorage.getItem(SHEET_KEY) === 'open';
  } catch {
    return false;
  }
}

/** Open / closed state of the phone sheet, remembered in localStorage; tap or swipe the header. */
function useSheet(): { open: boolean; toggle: () => void; set: (v: boolean) => void; handlers: Record<string, (e: PointerEvent) => void> } {
  const [open, setOpen] = useState(readSheetOpen);
  const set = (v: boolean) => {
    setOpen(v);
    try {
      localStorage.setItem(SHEET_KEY, v ? 'open' : 'closed');
    } catch {
      // Storage blocked: remembered for this visit only.
    }
  };
  const startY = useRef<number | null>(null);
  const handlers = {
    onPointerDown: (e: PointerEvent) => {
      startY.current = e.clientY;
    },
    onPointerUp: (e: PointerEvent) => {
      if (startY.current === null) return;
      const dy = e.clientY - startY.current;
      startY.current = null;
      if (dy < -24) set(true);
      else if (dy > 24) set(false);
    },
  };
  return { open, toggle: () => set(!open), set, handlers };
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
  sheet = false,
}: {
  state: GameState;
  config: ServerConfig;
  plotIndex: number;
  /** Compact action-bar layout (immersive mode). */
  bar?: boolean;
  /** Phones: a compact sheet above the tabs (closed: name, time and actions; open: details). */
  sheet?: boolean;
  act: Act;
  ask: Ask;
  choose: Choose;
  busy: boolean;
  elapsed: number;
  goShop: () => void;
}) {
  const p = state.plots[plotIndex];
  const fertilizer = state.items.find((i) => i.item === 'fertilizer')?.qty ?? 0;
  const sh = useSheet();
  const [help, setHelp] = useState(false);

  if (p.locked) {
    return (
      <Panel title={`Plot ${plotIndex + 1}`} class={bar ? 'plot-bar' : sheet ? 'plot-sheet plain' : undefined}>
        <p class="muted">Locked. Reach 50 XP (Farmhand) to unlock this plot. You have {state.player.xp} XP.</p>
      </Panel>
    );
  }

  if (!p.tree) {
    const groups = groupSeeds(state.seeds, true);
    return (
      <Panel title={`Plot ${plotIndex + 1} · empty`} class={`plot-empty${bar ? ' plot-bar' : ''}${sheet ? ' plot-sheet plain' : ''}`}>
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
  const statusText = t.ready
    ? t.stage === 'old'
      ? 'This old tree is ready to drop a superior seed. After that it becomes a Memorial Tree.'
      : 'Fruit is ripe. Harvest it!'
    : t.isWatered
      ? `Growing. Ready in about ${formatDuration(t.msToReady - Math.min(elapsed, t.msToReady))}.`
      : 'Thirsty: water it, trees only grow while watered.';
  const helpText =
    t.stage === 'old'
      ? 'Old trees give no more fruit or XP. Harvest the seed to plant a new generation.'
      : `XP comes from harvests: +${xpGain} XP per ${SPECIES_NAME[t.species]}${state.player.xpMultiplier > 1 ? ` (demo: ${state.player.xpMultiplier}x)` : ''}. Watering is required: trees only grow while watered (1 day per watering). Fertilizer: 1.5x speed for 1 day and better fruit odds on the next harvest.`;
  const actions = (
    <div class="actions">
      <button class="btn btn-cyan act-water" disabled={busy || t.wateredToday} onClick={() => act('/api/water', plot, 'Watered!')}>
        <Sprite name="droplet" scale={2} /> {t.wateredToday ? (sheet ? 'Watered' : 'Watered today') : 'Water'}
      </button>
      <button class="btn act-fertilize" disabled={busy || t.isFertilized || fertilizer < 1} onClick={() => act('/api/fertilize', plot, 'Fertilized!')}>
        <Sprite name="fertilizer" scale={2} /> Fertilize ({fertilizer})
      </button>
      <button class="btn btn-gold act-harvest" disabled={busy || !t.ready} onClick={() => void harvest()}>
        <Sprite name="sparkle" scale={2} /> Harvest
      </button>
    </div>
  );
  const buyLink = fertilizer < 1 && !t.isFertilized && (
    <p class="buy-link">
      No fertilizer.{' '}
      <button class="link-btn" onClick={goShop}>
        Buy in Shop
      </button>
    </p>
  );
  const chop = (
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
  );

  if (sheet) {
    // Phones: a compact sheet. Closed: name + quality, time / progress, the three actions.
    // Open (tap or swipe the header up): Harvests, Age, Next harvest, Cut down tree.
    return (
      <section class={`panel plot-sheet ${sh.open ? 'open' : 'closed'}`} aria-label="Selected plot">
        <header class="sheet-head" {...sh.handlers}>
          <button class="sheet-toggle" onClick={sh.toggle} aria-expanded={sh.open} aria-label={sh.open ? 'Show less' : 'Show details'}>
            <span class="sheet-grip" aria-hidden="true" />
            <h2>
              {QUALITY_NAME[t.quality]} {SPECIES_NAME[t.species]}
            </h2>
            <span class="sheet-chevron" aria-hidden="true">
              {sh.open ? '▾' : '▴'}
            </span>
          </button>
          <button class="icon-btn sheet-help-btn" onClick={() => setHelp(!help)} aria-label="How this tree grows" aria-expanded={help}>
            ?
          </button>
        </header>
        {help && <p class="sheet-help small">{helpText}</p>}
        <div class="sheet-status">
          <div class="progress" aria-label="Growth">
            <div class="progress-bar" style={{ width: `${Math.min(100, t.growthPercent)}%` }} />
          </div>
          <span class="small">
            {t.ready ? (t.stage === 'old' ? 'Seed ready' : 'Ripe!') : t.isWatered ? formatDuration(t.msToReady - Math.min(elapsed, t.msToReady)) : 'Thirsty'}
          </span>
        </div>
        {actions}
        {buyLink}
        {sh.open && (
          <div class="sheet-details">
            <div class="tree-info">
              <span>{STAGE_NAME[t.stage]}</span>
              <span>
                Harvests {t.harvestCount}/{t.maxHarvests}
              </span>
              <span>Age {t.ageDays}d</span>
              <span class="muted">{t.tokenId ? `NFT #${t.tokenId}` : 'minting NFT...'}</span>
            </div>
            <p class="muted small">{statusText}</p>
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
            {chop}
          </div>
        )}
      </section>
    );
  }

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
