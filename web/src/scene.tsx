// The garden scene: backdrop, three plots, TaniBot standing next to the
// selected plot, and TaniBot's action animations.

import type { GameState, TreeView } from './api';
import { Backdrop, phaseOf } from './art/backdrop';
import { BASKET, botVersion, Drone, HOE, TaniBot } from './art/tanibot';
import { TreePixels } from './art/trees';
import { leafBurst } from './fx';
import { Pixels, Sprite } from './sprites';
import { formatDuration } from './ui';

export type ActionKind = 'plant' | 'water' | 'harvest' | 'fertilize' | 'chop';

export interface SceneFx {
  id: number;
  kind: ActionKind;
  plot: number;
  /** The tree before the action (used to dissolve a chopped tree). */
  tree: TreeView | null;
}

/** Horizontal center of a plot in % of the scene width. */
export function plotCenter(plot: number): number {
  return 4 + (92 / 3) * (plot + 0.5);
}

/** TaniBot stands to the right of plots 1-2 and to the left of plot 3. */
function botX(plot: number): number {
  return plot < 2 ? plotCenter(plot) + 14 : plotCenter(plot) - 14;
}

function status(tree: TreeView, elapsed: number) {
  if (tree.ready) return { text: tree.stage === 'old' ? 'Seed ready' : 'Ready!', cls: 'ready' };
  if (!tree.isWatered) return { text: 'Thirsty', cls: 'thirsty' };
  return { text: formatDuration(tree.msToReady - elapsed), cls: 'growing' };
}

const FRUIT_SPRITE = { mango: 'mango', rambutan: 'rambutan', durian: 'durian' } as const;

interface Props {
  state: GameState;
  selected: number;
  onSelect: (plot: number) => void;
  elapsed: number;
  fx: SceneFx | null;
  big: boolean;
}

export function GardenScene({ state, selected, onSelect, elapsed, fx, big }: Props) {
  const px = big ? 4 : 2;
  const fraction = 1 - Math.max(0, state.clock.msUntilNextDay - elapsed) / state.clock.dayLengthMs;
  const phase = phaseOf(fraction);
  const version = botVersion(state.player.title);
  const bx = botX(selected);
  const working = fx !== null;

  return (
    <div class={`scene phase-${phase}`} role="group" aria-label="Your garden">
      <Backdrop phase={phase} />

      <div class="plots">
        {state.plots.map((p) => {
          const st = p.tree ? status(p.tree, elapsed) : null;
          return (
            <button
              key={p.plot}
              class={`plot${p.plot === selected ? ' selected' : ''}${p.locked ? ' locked' : ''}`}
              onClick={() => onSelect(p.plot)}
              aria-label={`Plot ${p.plot + 1}${p.tree ? `: ${p.tree.species}, ${p.tree.stage}` : p.locked ? ': locked' : ': empty'}`}
            >
              <div class="plot-art">
                {p.locked ? (
                  <Sprite name="lock" scale={px * 2} title="Locked" />
                ) : p.tree ? (
                  <TreePixels species={p.tree.species} stage={p.tree.stage} quality={p.tree.quality} scale={px} />
                ) : (
                  <span class="empty-hint">Plant</span>
                )}
                {st && (
                  <span class={`badge ${st.cls}`}>
                    {st.cls === 'thirsty' && <Sprite name="droplet" scale={2} />}
                    {st.cls === 'ready' && <Sprite name="sparkle" scale={2} />}
                    {st.text}
                  </span>
                )}
              </div>
              <div class="soil">
                {fx?.kind === 'plant' && fx.plot === p.plot && <span class="soil-glow" key={fx.id} />}
              </div>
            </button>
          );
        })}
      </div>

      <div class="bot-spot" style={{ left: `${bx}%` }}>
        <div class="bot-drones">
          <Drone version={version} scale={px} class="idle-drone d1" />
          {version === 2 && <Drone version={version} scale={px} class="idle-drone d2" />}
        </div>
        <TaniBot version={version} scale={px} working={working} />
        {fx?.kind === 'harvest' && (
          <div class="basket" key={fx.id}>
            <Pixels rows={BASKET} palette={{ H: '#9A7438', h: '#C9A35A' }} scale={px} />
          </div>
        )}
      </div>

      {fx && <ActionEffect fx={fx} from={botX(fx.plot)} to={plotCenter(fx.plot)} version={version} px={px} key={fx.id} />}
    </div>
  );
}

function ActionEffect({ fx, from, to, version, px }: { fx: SceneFx; from: number; to: number; version: 1 | 2; px: number }) {
  const vars = { '--from': `${from}%`, '--to': `${to}%` };
  const left = Math.min(from, to);
  const width = Math.abs(from - to);

  switch (fx.kind) {
    case 'water':
      return (
        <div class="act act-water" style={vars}>
          <Drone version={version} scale={px} class="fly-drone" />
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} class="drop" style={{ left: `calc(${to}% + ${(i % 3) * 6 - 6}px)`, animationDelay: `${450 + i * 70}ms` }} />
          ))}
        </div>
      );
    case 'plant':
      return (
        <div class="act act-plant" style={vars}>
          <span class="hoe" style={{ left: `calc(${to}% - 6px)` }}>
            <Pixels rows={HOE} palette={{ c: '#00EC97', m: '#E0FFF4', k: '#5C5F66' }} scale={px + 1} />
          </span>
        </div>
      );
    case 'harvest':
      return (
        <div
          class="act act-harvest"
          style={vars}
          ref={(el) => {
            if (!el || el.dataset.done) return;
            el.dataset.done = '1';
            const r = el.parentElement!.getBoundingClientRect();
            leafBurst(r.left + (r.width * to) / 100, r.top + r.height * 0.45, 12);
          }}
        >
          <span class="laser" style={{ left: `${left}%`, width: `${width}%` }} />
          {fx.tree &&
            [0, 1, 2].map((i) => (
              <span key={i} class="jump-fruit" style={{ animationDelay: `${250 + i * 120}ms` }}>
                <Sprite name={FRUIT_SPRITE[fx.tree!.species]} scale={px} />
              </span>
            ))}
        </div>
      );
    case 'fertilize':
      return (
        <div class="act act-fertilize" style={vars}>
          <span class="spray" style={{ left: `${left}%`, width: `${width}%` }} />
          {Array.from({ length: 12 }, (_, i) => (
            <i
              key={i}
              class={`nano ${i % 2 ? 'gold' : 'mint'}`}
              style={{ left: `calc(${to}% + ${((i * 37) % 60) - 30}px)`, animationDelay: `${200 + i * 60}ms` }}
            />
          ))}
        </div>
      );
    case 'chop':
      return (
        <div class="act act-chop" style={vars}>
          {fx.tree && (
            <span class="ghost-tree" style={{ left: `${to}%` }}>
              <TreePixels species={fx.tree.species} stage={fx.tree.stage} quality={fx.tree.quality} scale={px} />
            </span>
          )}
          <span class="saw" style={{ left: `calc(${to}% - 34px)` }} />
          {Array.from({ length: 16 }, (_, i) => (
            <i key={i} class="mote" style={{ left: `calc(${to}% + ${((i * 29) % 64) - 32}px)`, animationDelay: `${500 + i * 45}ms` }} />
          ))}
        </div>
      );
  }
}
