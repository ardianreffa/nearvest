// The garden: three plots, the selected plot's actions and the daily check-in.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Place } from './art/hotspots';
import type { GameState, Quality, ServerConfig, TreeView } from './api';
import { floatText } from './fx';
import { phoneFill, phoneLayout } from './layout';
import { bgVersion, villageFor } from './art/village';
import { seasonPayout } from './qty';
import { Info } from './info';
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

/** The Water button's words: rain, a drought (1/2), or the usual. Older servers: the usual. */
function waterLabel(t: TreeView, short: boolean): string {
  if ((t.waterNeed ?? 1) === 0) return short ? 'Rain' : 'Watered by rain';
  if ((t.waterNeed ?? 1) > 1) return t.wateredToday ? (short ? 'Watered' : 'Watered twice') : `Water ${t.waterCount ?? 0}/${t.waterNeed}`;
  return t.wateredToday ? (short ? 'Watered' : 'Watered today') : 'Water';
}

export function Garden({ state, config, act, ask, choose, elapsed, busy, goShop, big, immersive, onBot, onPlace }: Props) {
  const [selected, setSelected] = useState(0);
  const [fx, setFx] = useState<SceneFx | null>(null);
  const fxTimer = useRef<number>(0);
  const plot = state.plots[selected];

  // TaniBot waters on its own (server rounds): when a tree turns watered without the player pressing
  // Water here, its water drone flies to that tree too.
  const lastLocal = useRef(0);
  const prevWatered = useRef<boolean[] | null>(null);
  useEffect(() => {
    const now = state.plots.map((p) => !!p.tree?.wateredToday);
    const prev = prevWatered.current;
    prevWatered.current = now;
    if (!prev || Date.now() - lastLocal.current < 4000) return;
    const plot = now.findIndex((w, i) => w && !prev[i] && state.plots[i].tree);
    if (plot < 0) return;
    window.clearTimeout(fxTimer.current);
    setFx({ id: Date.now(), kind: 'water', plot, tree: state.plots[plot].tree });
    fxTimer.current = window.setTimeout(() => setFx(null), 1700);
  }, [state]);

  /** Runs an action and plays TaniBot's animation for it when it succeeds. */
  const botAct: Act = async (path, body, success) => {
    const kind = (path.split('/').pop() ?? '') as ActionKind;
    const plotIndex = (body as { plot?: number } | undefined)?.plot ?? selected;
    const before = state.plots[plotIndex]?.tree ?? null;
    // TaniBot's animation starts the moment the button is pressed (not after the server answers);
    // it is cut short if the action fails.
    const animated = ['plant', 'water', 'harvest', 'fertilize', 'chop'].includes(kind);
    const id = Date.now();
    lastLocal.current = id;
    if (animated) {
      window.clearTimeout(fxTimer.current);
      setFx({ id, kind, plot: plotIndex, tree: before });
      fxTimer.current = window.setTimeout(() => setFx(null), 1700);
    }
    // A ripe (not old) tree: the XP is known already, so it floats up right away too.
    const knownXp = kind === 'harvest' && before?.ready && before.stage !== 'old' ? (config.species?.[before.species]?.xpPerHarvest ?? 0) * state.player.xpMultiplier : 0;
    if (knownXp) floatText(`+${knownXp} XP`, 'xp');
    const result = await act(path, body, success);
    if (animated && result === null) {
      window.clearTimeout(fxTimer.current);
      setFx((f) => (f?.id === id ? null : f));
    }
    const xp = (result as { xp?: number } | null)?.xp;
    if (kind === 'harvest' && xp && !knownXp) floatText(`+${xp} XP`, 'xp');
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
 * Phones: "game first". The upright village fits the screen's width with the whole village and
 * all three plots in view (no panning); the selected plot's panel is a compact sheet above the
 * tabs. Dev builds with ?bg=v1 show the first village in the classic phone scene.
 */
export function PhoneGarden({
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
  visit = false,
  visitBot = null,
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
  /** Visiting a friend's garden (friends.tsx): their TaniBot only as decoration. */
  visit?: boolean;
  visitBot?: { on: boolean; owner: string } | null;
}) {
  const { w, h } = useWindowSize();
  const version = bgVersion();
  const v1 = version === 'v1';
  // Wider than tall (small tablets; phones held sideways see the "turn your phone" screen): the
  // wide village (as on laptops) with its top sky cut off.
  const upright = villageFor(version === 'v1' ? 'v3' : version, true);
  const base = phoneLayout(w, h, w > h ? { ...villageFor(version === 'v1' ? 'v3' : version, false), shownFrom: 50, moundArt: upright.moundArt } : upright);
  const sceneBox = useRef<HTMLDivElement>(null);
  const sheetBox = useRef<HTMLDivElement>(null);
  // The garden fills the whole screen: measure the HUD's bottom, the sheet's top and the screen's
  // height, then place the village between them (layout.ts phoneFill).
  const [room, setRoom] = useState<{ height: number; hud: number; sheet: number } | null>(null);
  useLayoutEffect(() => {
    if (v1) return;
    const fit = () => {
      const box = sceneBox.current;
      const sb = sheetBox.current;
      const tabs = document.querySelector('.tabs');
      if (!box || !sb || !tabs) return;
      const height = box.getBoundingClientRect().height || window.innerHeight;
      let hud = 0;
      for (const el of document.querySelectorAll('.phone-hud .topbar, .phone-hud .hud-chips, .phone-hud .notice')) {
        const r = el.getBoundingClientRect();
        if (r.height) hud = Math.max(hud, r.bottom);
      }
      const root = document.documentElement.style;
      root.setProperty('--tabs-h', `${Math.round(tabs.getBoundingClientRect().height)}px`);
      root.setProperty('--hud-bottom', `${Math.round(hud)}px`);
      const sheet = Math.round(sb.getBoundingClientRect().top);
      // Toasts sit above the sheet, not on it.
      root.setProperty('--sheet-room', `${Math.round(window.innerHeight - sheet + 8)}px`);
      setRoom((r) => (r && Math.abs(r.height - height) < 2 && Math.abs(r.hud - hud) < 2 && Math.abs(r.sheet - sheet) < 2 ? r : { height, hud, sheet }));
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (sheetBox.current) ro.observe(sheetBox.current);
    if (sceneBox.current) ro.observe(sceneBox.current);
    const hud = document.querySelector('.phone-hud');
    if (hud) ro.observe(hud);
    window.addEventListener('resize', fit);
    const t = setInterval(fit, 1000);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', fit);
      clearInterval(t);
    };
  }, [v1]);
  useEffect(
    () => () => {
      for (const v of ['--sheet-room', '--tabs-h', '--hud-bottom']) document.documentElement.style.removeProperty(v);
    },
    [],
  );
  const zoom = room ? phoneFill(base, room.height, room.hud, room.sheet) : base;

  return (
    <div class="garden-screen phone-garden">
      <div class={`phone-scene-box${v1 ? ' v1' : ''}`} ref={sceneBox} style={room || v1 ? undefined : { visibility: 'hidden' }}>
        <GardenScene state={state} selected={selected} onSelect={onSelect} elapsed={elapsed} fx={fx} big={big} phone={v1 ? undefined : zoom} onBot={onBot} onPlace={onPlace} visit={visit} visitBot={visitBot} />
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
      <p class="checkin-note">
        Streak: {c.streak} {c.streak === 1 ? 'day' : 'days'} <Info k="streak" label="the check-in streak" />
        {state.player.demo && <> · Demo mode: your streak keeps going if you miss up to 10 minutes.</>}
      </p>
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

const SWIPE_HINT_KEY = 'nearvest.seedSwipeHint';

/**
 * The seeds of an empty plot in one row. When they do not fit, the row scrolls sideways (swipe, or
 * drag / tap the pixel scrollbar under it); a small "Swipe" hint shows once. The laptop action bar
 * also has arrow buttons at the ends.
 */
function SeedRow({ children, arrows = false }: { children: preact.ComponentChildren; arrows?: boolean }) {
  const row = useRef<HTMLDivElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [bar, setBar] = useState({ over: false, left: 0, width: 1, atStart: true, atEnd: true });
  const [hint, setHint] = useState(false);
  const update = () => {
    const r = row.current;
    if (!r) return;
    const over = r.scrollWidth > r.clientWidth + 2;
    const max = Math.max(1, r.scrollWidth - r.clientWidth);
    const width = over ? r.clientWidth / r.scrollWidth : 1;
    const left = over ? (r.scrollLeft / max) * (1 - width) : 0;
    const atStart = r.scrollLeft <= 2;
    const atEnd = r.scrollLeft >= max - 2;
    // Only a real change re-renders (this runs after every render).
    setBar((b) =>
      b.over === over && Math.abs(b.left - left) < 0.002 && Math.abs(b.width - width) < 0.002 && b.atStart === atStart && b.atEnd === atEnd ? b : { over, left, width, atStart, atEnd },
    );
  };
  useLayoutEffect(() => {
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  });
  // The first time a row is too long: a small "Swipe" hint (once per browser).
  useEffect(() => {
    if (!bar.over) return;
    let seen = true;
    try {
      seen = localStorage.getItem(SWIPE_HINT_KEY) === 'seen';
      localStorage.setItem(SWIPE_HINT_KEY, 'seen');
    } catch {
      seen = false;
    }
    if (seen) return;
    setHint(true);
    const t = window.setTimeout(() => setHint(false), 5000);
    return () => window.clearTimeout(t);
  }, [bar.over]);
  const onScroll = () => {
    update();
    if (hint) setHint(false);
  };
  const go = (dir: number) => row.current?.scrollBy({ left: dir * row.current.clientWidth * 0.8, behavior: 'smooth' });
  /** Drag the thumb, or tap the track to jump there. */
  const drag = (e: PointerEvent) => {
    const r = row.current;
    const t = track.current;
    if (!r || !t) return;
    e.preventDefault();
    const box = t.getBoundingClientRect();
    const thumbW = box.width * bar.width;
    const to = (x: number) => {
      const f = Math.min(1, Math.max(0, (x - box.left - thumbW / 2) / Math.max(1, box.width - thumbW)));
      r.scrollLeft = f * (r.scrollWidth - r.clientWidth);
    };
    to(e.clientX);
    const move = (ev: PointerEvent) => to(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  return (
    <div class={`seed-row-box${bar.over ? ' overflows' : ''}`}>
      <div class="seed-row-wrap">
        {arrows && bar.over && !bar.atStart && (
          <button class="seed-arrow left" onClick={() => go(-1)} aria-label="Show earlier seeds">
            ‹
          </button>
        )}
        <div class="seed-row" role="list" aria-label="Your seeds" ref={row} onScroll={onScroll}>
          {children}
        </div>
        {arrows && bar.over && !bar.atEnd && (
          <button class="seed-arrow right" onClick={() => go(1)} aria-label="Show more seeds">
            ›
          </button>
        )}
      </div>
      {bar.over && (
        <div class="seed-scroll" ref={track} onPointerDown={drag} aria-hidden="true">
          <i style={{ left: `${bar.left * 100}%`, width: `${bar.width * 100}%` }} />
        </div>
      )}
      {hint && (
        <span class="seed-swipe-hint" aria-hidden="true">
          Swipe for more ›
        </span>
      )}
    </div>
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
      <Panel
        title={p.memorial ? `Plot ${plotIndex + 1} · Memorial` : `Plot ${plotIndex + 1} · empty`}
        class={`plot-empty${bar ? ' plot-bar' : ''}${sheet ? ' plot-sheet plain' : ''}`}
        right={
          sheet && (
            <button class="icon-btn sheet-help-btn" onClick={() => setHelp(!help)} aria-label="How planting works" aria-expanded={help}>
              ?
            </button>
          )
        }
      >
        {p.memorial && (
          <p class={`memorial-note${sheet ? ' short' : ''}`}>
            {sheet
              ? `Memorial ${SPECIES_NAME[p.memorial.species]} · planting moves it to Village`
              : `A Memorial ${SPECIES_NAME[p.memorial.species]} stands here (${p.memorial.harvestCount} harvests). Planting a seed moves it to your Memorial list in the Village tab; its NFT stays yours.`}
          </p>
        )}
        {groups.length === 0 ? (
          <p class="muted">You have no seeds.</p>
        ) : (
          <SeedRow arrows={bar}>
            {groups.map((g) => (
              <SeedCard
                key={g.key}
                group={g}
                compact={sheet || bar}
                disabled={busy}
                onPick={() => act('/api/plant', { plot: plotIndex, seedId: g.ids[0] }, `Planted ${SPECIES_NAME[g.species]}!`)}
              />
            ))}
          </SeedRow>
        )}
        {/* Phones: the long note waits behind the "?" button. */}
        {(!sheet || help) && <p class="seed-note">Tap a seed to plant it: a Tree NFT is minted to your account. {SEED_ODDS_TEXT}</p>}
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
  const statusText = t.ash
    ? 'Volcanic ash stops this tree from growing. Clean it (free) to get Volcanic soil after the eruption.'
    : t.ready
    ? t.stage === 'old'
      ? 'This old tree is ready to drop a superior seed. After that it stands here as a Memorial Tree until you plant a new seed. TaniBot leaves this choice to you.'
      : 'Fruit is ripe. Harvest it!'
    : t.wilting
      ? `Wilting! Water it now, or it goes back one stage${t.msToWilt ? ` in about ${formatDuration(t.msToWilt - Math.min(elapsed, t.msToWilt))}` : ''} (it never dies).`
      : (t.waterNeed ?? 1) > 1 && !t.wateredToday
        ? `Drought: a watering only lasts half a day. Water it ${t.waterNeed! - (t.waterCount ?? 0)} more time${t.waterNeed! - (t.waterCount ?? 0) === 1 ? '' : 's'} today.`
        : t.isWatered
          ? `${t.volcanicSoil ? 'Volcanic soil: growing faster. ' : ''}Growing. Ready in about ${formatDuration(t.msToReady - Math.min(elapsed, t.msToReady))}.`
          : 'Thirsty: water it, trees only grow while watered.';
  const helpText =
    t.stage === 'old'
      ? 'Old trees give no more fruit or XP. Harvest the seed to plant a new generation.'
      : `XP comes from harvests: +${xpGain} XP per ${SPECIES_NAME[t.species]}${state.player.xpMultiplier > 1 ? ` (demo: ${state.player.xpMultiplier}x)` : ''}. Watering is required: trees only grow while watered (1 day per watering). Fertilizer: 1.5x speed for 1 day and better fruit odds on the next harvest.`;
  const actions = (
    <div class="actions">
      {t.ash ? (
        <button class="btn btn-mint act-clean" disabled={busy} onClick={() => act('/api/clean', plot, 'Ash cleaned!')}>
          <Sprite name="sparkle" scale={2} /> Clean ash
        </button>
      ) : (
        <button class="btn btn-cyan act-water" disabled={busy || t.wateredToday} onClick={() => act('/api/water', plot, 'Watered!')}>
          <Sprite name="droplet" scale={2} /> {waterLabel(t, sheet)}
        </button>
      )}
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
        if (await ask('Cut this tree down? It becomes a Memorial Tree that stands here until you plant a new seed (its NFT stays yours).', 'Cut down')) {
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
              <span class="muted">{t.tokenId ? `NFT #${t.tokenId}` : 'minting NFT...'} <Info k="treeNft" label="the Tree NFT" /></span>
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
                Next harvest: <OddsLine odds={t.nextHarvestOdds} /> <Info k="nextHarvest" label="the next harvest quality" />
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
      right={<span class="muted small">{t.tokenId ? `NFT #${t.tokenId}` : 'minting NFT...'} <Info k="treeNft" label="the Tree NFT" /></span>}
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
            ? 'This old tree is ready to drop a superior seed. After that it stands here as a Memorial Tree until you plant a new seed. TaniBot leaves this choice to you.'
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
          Next harvest: <OddsLine odds={t.nextHarvestOdds} /> <Info k="nextHarvest" label="the next harvest quality" />
        </p>
      )}
      <div class="actions">
        {t.ash ? (
          <button class="btn btn-mint act-clean" disabled={busy} onClick={() => act('/api/clean', plot, 'Ash cleaned!')}>
            <Sprite name="sparkle" scale={2} /> Clean ash
          </button>
        ) : (
          <button class="btn btn-cyan act-water" disabled={busy || t.wateredToday} onClick={() => act('/api/water', plot, 'Watered!')}>
            <Sprite name="droplet" scale={2} /> {waterLabel(t, false)}
          </button>
        )}
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
          if (await ask('Cut this tree down? It becomes a Memorial Tree that stands here until you plant a new seed (its NFT stays yours).', 'Cut down')) {
            await act('/api/chop', plot, 'Tree cut down');
          }
        }}
      >
        Cut down tree
      </button>
    </Panel>
  );
}
