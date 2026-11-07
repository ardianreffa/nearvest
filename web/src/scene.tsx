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

// Plots sit on the brown ground at the bottom of the backdrop, a little toward
// the middle so the houses on both sides stay visible (keep in sync with .plots).
// In the immersive layout the plots fill their own "stage" box instead.
interface Lane {
  left: number;
  width: number;
  botOffset: number;
}
const LANE_NORMAL: Lane = { left: 11, width: 78, botOffset: 14 };
const LANE_STAGE: Lane = { left: 0, width: 100, botOffset: 18 };

/** Horizontal center of a plot in % of the scene (or stage) width. */
function plotCenter(plot: number, lane: Lane): number {
  return lane.left + (lane.width / 3) * (plot + 0.5);
}

/** TaniBot stands to the right of plots 1-2 and to the left of plot 3. */
function botX(plot: number, lane: Lane): number {
  return plot < 2 ? plotCenter(plot, lane) + lane.botOffset : plotCenter(plot, lane) - lane.botOffset;
}

// ---------- Immersive layout (laptop / PC) ----------

export const ART_W = 240;
export const ART_H = 135;
/** Art rows: grass ends at 103, the beds sit on rows 104-110. */
const SOIL_TOP_ROW = 104;
const BED_ROWS = 7;

export interface Immersive {
  /**
   * CSS px per pixel of the 240x135 art grid (trees and plots use it). The
   * laptop backdrop is the 480x270 HD image at k / 2 px per pixel, always whole.
   */
  k: number;
  artLeft: number;
  artBottom: number;
  stageLeft: number;
  stageRight: number;
  stageBottom: number;
}

/**
 * Picks a whole-number pixel scale for a full-window garden: cover the window
 * when that crops at most 20% of the width, otherwise fit it (the rest is filled
 * with a blurred copy of the backdrop). The plots get a stage that avoids the
 * open drawer and the action bar.
 */
export function immersiveLayout(width: number, height: number, drawerWidth: number, barHeight: number): Immersive {
  // Whole-pixel scale of the HD (480x270) backdrop.
  const hdW = ART_W * 2;
  const hdH = ART_H * 2;
  const cover = Math.ceil(Math.max(width / hdW, height / hdH));
  const fit = Math.max(1, Math.floor(Math.min(width / hdW, height / hdH)));
  const hdScale = (hdW * cover - width) / width <= 0.2 ? cover : fit;
  const k = hdScale * 2;
  const artW = ART_W * k;
  const artLeft = Math.round((width - artW) / 2);
  const bedBottom = (ART_H - SOIL_TOP_ROW - BED_ROWS) * k;
  // Lift the art if the action bar would cover the beds (the soil continues below).
  const artBottom = Math.max(0, barHeight + 16 - bedBottom);
  const margin = Math.round(artW * 0.11);
  const stageLeft = Math.max(24, artLeft + margin);
  const stageRight = Math.max(drawerWidth > 0 ? drawerWidth + 36 : 24, width - (artLeft + artW) + margin);
  return { k, artLeft, artBottom, stageLeft, stageRight, stageBottom: artBottom + bedBottom };
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
  /** Full-window garden with whole-pixel scale (laptop / PC). */
  immersive?: Immersive;
  onBot?: () => void;
  /** Shows "Tap me!" above TaniBot until the player opens its window once. */
  botHint?: boolean;
}

export function GardenScene({ state, selected, onSelect, elapsed, fx, big, immersive, onBot, botHint }: Props) {
  // Trees use the same pixel size as the backdrop: 2 on phones, 3 on the wide
  // layout, k in the immersive layout.
  const px = immersive ? immersive.k : big ? 3 : 2;
  const botScale = immersive ? Math.max(1, Math.round(immersive.k / 2)) : big ? 2 : 1;
  const lane = immersive ? LANE_STAGE : LANE_NORMAL;
  const fraction = 1 - Math.max(0, state.clock.msUntilNextDay - elapsed) / state.clock.dayLengthMs;
  const phase = phaseOf(fraction);
  const version = botVersion(state.player.title);
  const bx = botX(selected, lane);
  const working = fx !== null;

  return (
    <div
      class={`scene phase-${phase}${immersive ? ' immersive-scene' : ''}`}
      role="group"
      aria-label="Your garden"
      style={immersive ? { '--k': String(immersive.k), '--art-left': `${immersive.artLeft}px`, '--art-bottom': `${immersive.artBottom}px` } : undefined}
    >
      <Backdrop fraction={fraction} blurFill={!!immersive} hd={!!immersive} />

      <Stage immersive={immersive}>
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
              <div class={`plot-art${p.tree?.isFertilized && p.tree.fertMsLeft - elapsed > 0 ? ' fertilized' : ''}`}>
                {p.locked ? (
                  <Sprite name="lock" scale={px * 2} title="Locked" />
                ) : p.tree ? (
                  <TreePixels species={p.tree.species} stage={p.tree.stage} quality={p.tree.quality} scale={px} />
                ) : (
                  <span class="empty-hint">Plant</span>
                )}
                {p.tree?.isFertilized && p.tree.fertMsLeft - elapsed > 0 && (
                  <span class="fert-glow" aria-hidden="true">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <i key={i} style={{ left: `${15 + i * 17}%`, animationDelay: `${i * 0.35}s` }} />
                    ))}
                  </span>
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
        {botHint && (
          <button class="bot-hint" onClick={onBot}>
            Tap me! I can water, harvest and sell for you.
          </button>
        )}
        <button class="bot-click" onClick={onBot} aria-label="TaniBot: open its log and settings" title="TaniBot: log and settings">
          <TaniBot version={version} scale={botScale} working={working} />
        </button>
        {fx?.kind === 'harvest' && (
          <div class="basket" key={fx.id}>
            <Pixels rows={BASKET} palette={{ H: '#9A7438', h: '#C9A35A' }} scale={px} />
          </div>
        )}
      </div>

      {fx && <ActionEffect fx={fx} from={botX(fx.plot, lane)} to={plotCenter(fx.plot, lane)} version={version} px={px} key={fx.id} />}
      </Stage>
    </div>
  );
}

/** In the immersive layout the plots, TaniBot and effects live in a box above the action bar. */
function Stage({ immersive, children }: { immersive?: Immersive; children: preact.ComponentChildren }) {
  if (!immersive) return <>{children}</>;
  return (
    <div class="stage" style={{ left: immersive.stageLeft, right: immersive.stageRight, bottom: immersive.stageBottom }}>
      {children}
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
