// The garden: three plots, the selected plot's actions and the daily check-in.

import { useRef, useState } from 'preact/hooks';
import type { GameState } from './api';
import { floatText } from './fx';
import { GardenScene, type ActionKind, type SceneFx } from './scene';
import { Sprite } from './sprites';
import {
  formatDuration,
  FruitIcon,
  groupSeeds,
  Panel,
  QualityTag,
  QUALITY_NAME,
  SPECIES_NAME,
  STAGE_NAME,
} from './ui';

/** Runs a game action; resolves to the server result, or null if it failed. */
export type Act = (path: string, body?: unknown, success?: string) => Promise<unknown | null>;
/** Shows an in-game confirmation dialog; resolves true when the player confirms. */
export type Ask = (message: string, confirmLabel: string) => Promise<boolean>;

interface Props {
  state: GameState;
  act: Act;
  ask: Ask;
  /** Milliseconds since the state was loaded, for live countdowns. */
  elapsed: number;
  busy: boolean;
  goShop: () => void;
  showCheckin: boolean;
  /** Wide screens draw the scene art at 4 px per pixel. */
  big: boolean;
}

export function Garden({ state, act, ask, elapsed, busy, goShop, showCheckin, big }: Props) {
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

  return (
    <div class="garden-screen">
      {showCheckin && <CheckinBanner state={state} act={act} busy={busy} />}

      <GardenScene state={state} selected={selected} onSelect={setSelected} elapsed={elapsed} fx={fx} big={big} />

      <PlotPanel state={state} plotIndex={selected} act={botAct} ask={ask} busy={busy} elapsed={elapsed} goShop={goShop} key={selected} />
      {!plot.tree && !plot.locked && state.seeds.length === 0 && (
        <p class="hint">No seeds? Check in daily for a free Mango seed, or visit the Shop.</p>
      )}
    </div>
  );
}

export function CheckinBanner({ state, act, busy }: { state: GameState; act: Act; busy: boolean }) {
  const c = state.checkin;
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
      <button class="btn btn-mint" disabled={!c.available || busy} onClick={() => act('/api/checkin', undefined, 'Checked in!')}>
        {c.available ? `Check in · day ${c.nextCalendarDay}` : `Streak ${c.streak} · see you tomorrow`}
      </button>
      {state.player.demo && <p class="checkin-note">Demo mode: your streak keeps going if you miss up to 10 minutes.</p>}
    </div>
  );
}

function PlotPanel({
  state,
  plotIndex,
  act,
  ask,
  busy,
  elapsed,
  goShop,
}: {
  state: GameState;
  plotIndex: number;
  act: Act;
  ask: Ask;
  busy: boolean;
  elapsed: number;
  goShop: () => void;
}) {
  const p = state.plots[plotIndex];
  const fertilizer = state.items.find((i) => i.item === 'fertilizer')?.qty ?? 0;

  if (p.locked) {
    return (
      <Panel title={`Plot ${plotIndex + 1}`}>
        <p class="muted">Locked. Reach 50 XP (Farmhand) to unlock this plot. You have {state.player.xp} XP.</p>
      </Panel>
    );
  }

  if (!p.tree) {
    const groups = groupSeeds(state.seeds);
    return (
      <Panel title={`Plot ${plotIndex + 1} · empty`}>
        {groups.length === 0 ? (
          <p class="muted">You have no seeds.</p>
        ) : (
          <div class="seed-grid">
            {groups.map((g) => (
              <button
                key={g.key}
                class="seed-btn"
                disabled={busy}
                onClick={() => act('/api/plant', { plot: plotIndex, seedId: g.ids[0] }, `Planted ${SPECIES_NAME[g.species]}!`)}
              >
                <FruitIcon species={g.species} scale={3} />
                <span>
                  {SPECIES_NAME[g.species]} <b>x{g.ids.length}</b>
                </span>
                {g.fromTree && <span class="tiny">from your tree</span>}
                <QualityTag quality={g.quality} />
              </button>
            ))}
          </div>
        )}
        <p class="muted small">Tap a seed to plant it. A Tree NFT is minted to your account.</p>
      </Panel>
    );
  }

  const t = p.tree;
  const plot = { plot: plotIndex };
  return (
    <Panel
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
            ? `Growing${t.isFertilized ? ' fast (fertilized)' : ''}. Ready in about ${formatDuration(t.msToReady - elapsed)}.`
            : 'Thirsty: trees only grow while watered.'}
      </p>
      <div class="actions">
        <button class="btn btn-cyan" disabled={busy || t.wateredToday} onClick={() => act('/api/water', plot, 'Watered!')}>
          <Sprite name="droplet" scale={2} /> {t.wateredToday ? 'Watered today' : 'Water'}
        </button>
        <button class="btn" disabled={busy || t.isFertilized || fertilizer < 1} onClick={() => act('/api/fertilize', plot, 'Fertilized!')}>
          <Sprite name="fertilizer" scale={2} /> Fertilize ({fertilizer})
        </button>
        <button
          class="btn btn-gold"
          disabled={busy || !t.ready}
          onClick={() => act('/api/harvest', plot, t.stage === 'old' ? 'Got a superior seed!' : 'Harvested!')}
        >
          <Sprite name="sparkle" scale={2} /> Harvest
        </button>
      </div>
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
