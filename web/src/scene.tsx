// The garden scene: backdrop, three plots, TaniBot standing next to the
// selected plot, and TaniBot's action animations.

import { loadToken, type GameState, type TreeView } from './api';
import { Backdrop, phaseOf } from './art/backdrop';
import { BASKET, botVersion, Drone, HOE, TaniBot } from './art/tanibot';
import { TreePixels } from './art/trees';
import { leafBurst } from './fx';
import { Pixels, Sprite } from './sprites';
import { formatDuration } from './ui';
import { useEffect, useRef, useState } from 'preact/hooks';

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
}

export function GardenScene({ state, selected, onSelect, elapsed, fx, big, immersive, onBot }: Props) {
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
  const tb = state.player.tanibot;
  const on = !!tb && tb.enabled && tb.status === 'ready';
  /** Not active, switched off or failed: TaniBot sleeps and asks to be switched on. */
  const asleep = !on;
  const askOn = !tb || tb.status === 'failed' || (tb.status === 'ready' && !tb.enabled);
  const flash = useActionBubble(on, tb?.last ?? null);
  const nudge = useTurnOnNudge(askOn, state);
  const motion = useBotMotion(bx, on, working, selected);

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

      {motion.dust && (
        <span class={`bot-dust ${motion.dust.kind}`} style={{ left: `${motion.dust.x}%` }} key={motion.dust.id} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      <div class={`bot-spot ${motion.cls}`} style={{ left: `${bx}%` }}>
        {on && (
          <span class="bot-jet" aria-hidden="true">
            <b />
            <b />
            <i />
            <i />
            <i />
          </span>
        )}
        <div class="bot-drones">
          <Drone version={version} scale={px} class="idle-drone d1" />
          {version === 2 && <Drone version={version} scale={px} class="idle-drone d2" />}
        </div>
        {askOn ? (
          nudge.text && (
            <div class="bot-hint bot-nudge" role="status" key={nudge.key}>
              <button class="bot-nudge-text" onClick={onBot}>
                {nudge.text}
              </button>
              <button class="bot-nudge-later" onClick={nudge.notNow}>
                Not now
              </button>
            </div>
          )
        ) : (
          flash && (
            <button class="bot-hint bot-hint-flash" onClick={onBot} key={flash.id}>
              {flash.text}
            </button>
          )
        )}
        <button
          class={`bot-click${asleep ? ' asleep' : ''}`}
          onClick={onBot}
          aria-label={`TaniBot is ${on ? 'on' : 'off'}: open its log and settings`}
          title="TaniBot: log and settings"
        >
          <TaniBot version={version} scale={botScale} working={working && on} />
          {asleep && (
            <span class="bot-zzz" aria-hidden="true">
              <i>z</i>
              <i>z</i>
              <i>z</i>
            </span>
          )}
        </button>
        <span class={`bot-status ${on ? 'on' : 'off'}`} aria-hidden="true">
          <i />
          {on ? 'ON' : 'OFF'}
        </span>
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

/**
 * While TaniBot is ON: a short bubble about its latest action ("Harvested 1
 * Durian!"), at most once a minute, gone after about 4 seconds. Actions that
 * already happened before the page was opened are not shown.
 */
function useActionBubble(on: boolean, last: { id: number; text: string; at: number } | null): { id: number; text: string } | null {
  const [bubble, setBubble] = useState<{ id: number; text: string } | null>(null);
  const seen = useRef<{ id: number | null; shownAt: number }>({ id: last?.id ?? null, shownAt: 0 });
  useEffect(() => {
    if (!on || !last || last.id === seen.current.id) return;
    seen.current.id = last.id;
    const now = Date.now();
    if (now - seen.current.shownAt < 60_000) return;
    seen.current.shownAt = now;
    setBubble({ id: last.id, text: last.text });
    const t = setTimeout(() => setBubble(null), 4000);
    return () => clearTimeout(t);
  }, [on, last?.id]);
  return on ? bubble : null;
}

/** How long the "turn me on" bubble stays, the idle time before it appears, and its minimum spacing. */
const NUDGE_SHOW_MS = 8_000;
const NUDGE_IDLE_MS = 20_000;
const NUDGE_GAP_MS = 3 * 60_000;

/** A short, stable id of the current login (a new login = a new session). */
function sessionId(): string {
  const t = loadToken() ?? '';
  let h = 0;
  for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0;
  return String(h >>> 0);
}

function storage(kind: 'local' | 'session') {
  try {
    return kind === 'local' ? localStorage : sessionStorage;
  } catch {
    return null;
  }
}

const SPECIES_LABEL: Record<string, string> = { mango: 'mango', rambutan: 'rambutan', durian: 'durian' };

/**
 * The friendly "turn me on" bubble while TaniBot is off, without nagging:
 * once per session after login, and when a tree is thirsty or ripe while the
 * player has been idle for ~20 s. At most every 3 minutes, gone after ~8 s.
 * "Not now" hides it until the next login (remembered per account).
 */
function useTurnOnNudge(askOn: boolean, state: GameState): { text: string | null; key: number; notNow: () => void } {
  const account = state.player.accountId;
  const offKey = `nearvest.botNudgeOff.${account}`;
  const greetKey = `nearvest.botNudgeGreeted.${account}`;
  const [shown, setShown] = useState<{ text: string; key: number } | null>(null);
  const lastShownAt = useRef(0);
  const lastActivity = useRef(Date.now());
  const plots = useRef(state.plots);
  plots.current = state.plots;

  const muted = () => storage('local')?.getItem(offKey) === sessionId();

  // Remember when the player last did something.
  useEffect(() => {
    const touch = () => (lastActivity.current = Date.now());
    const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const;
    for (const e of events) window.addEventListener(e, touch, { passive: true });
    return () => {
      for (const e of events) window.removeEventListener(e, touch);
    };
  }, []);

  const show = (text: string) => {
    lastShownAt.current = Date.now();
    setShown({ text, key: Date.now() });
  };

  useEffect(() => {
    if (!askOn) {
      setShown(null);
      return;
    }
    const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)];
    const check = () => {
      if (muted()) return;
      const now = Date.now();
      if (now - lastShownAt.current < NUDGE_GAP_MS) return;
      // (a) Once per session after login.
      const session = storage('session');
      if (session && session.getItem(greetKey) !== sessionId()) {
        session.setItem(greetKey, sessionId());
        show(
          pick([
            "Zzz... need a hand? Tap me and I'll water your trees.",
            "Psst! Switch me on and I'll look after your garden while you're away.",
            "Hi farmer! I can water, harvest and sell for you. Just tap me.",
          ]),
        );
        return;
      }
      // (b) A tree needs care and the player has been idle for a while.
      if (now - lastActivity.current < NUDGE_IDLE_MS) return;
      const trees = plots.current.map((p) => p.tree).filter((t): t is TreeView => !!t);
      const ripe = trees.find((t) => t.ready);
      const thirsty = trees.find((t) => !t.wateredToday && !t.ready);
      if (ripe) show(pick(['Ripe fruit! I can harvest and sell it for you.', `Your ${SPECIES_LABEL[ripe.species]} is ripe. Want me to take care of it?`]));
      else if (thirsty) show(pick([`Your ${SPECIES_LABEL[thirsty.species]} looks thirsty. Want me to help?`, 'Some trees need water. Tap me and I can do it for you.']));
    };
    check();
    const id = setInterval(check, 2000);
    return () => clearInterval(id);
  }, [askOn, account]);

  // Gone by itself after ~8 seconds.
  useEffect(() => {
    if (!shown) return;
    const t = setTimeout(() => setShown(null), NUDGE_SHOW_MS);
    return () => clearTimeout(t);
  }, [shown?.key]);

  const notNow = () => {
    storage('local')?.setItem(offKey, sessionId());
    setShown(null);
  };
  return { text: askOn && shown ? shown.text : null, key: shown?.key ?? 0, notNow };
}

type IdleAct = 'glance' | 'blink' | 'leds' | 'wave' | 'look';

/**
 * TaniBot's body language in the garden (CSS classes on the bot spot):
 * - moving between plots: faces and leans toward the move, jets under the feet,
 *   dust when it lifts off, a puff and a small knee bend when it lands;
 * - idle: a calm "breathing" pose and, now and then, a random small action
 *   (glance, blink, hat lights, wave, look at the nearest tree);
 * - a happy bounce only right after it finished a job;
 * - switched off: none of this (it sleeps).
 */
function useBotMotion(x: number, on: boolean, working: boolean, plot: number) {
  const [move, setMove] = useState<{ dir: 'left' | 'right'; id: number } | null>(null);
  const [landing, setLanding] = useState(0);
  const [dust, setDust] = useState<{ x: number; id: number; kind: 'lift' | 'land' } | null>(null);
  const [idle, setIdle] = useState<IdleAct | null>(null);
  const [bounce, setBounce] = useState(0);
  const prevX = useRef(x);
  const wasWorking = useRef(working);

  // A move between plots.
  useEffect(() => {
    const from = prevX.current;
    prevX.current = x;
    if (from === x) return;
    const id = Date.now();
    const dir = x > from ? 'right' : 'left';
    setIdle(null);
    if (!on) return; // asleep: it just shifts, no jets, no dust
    setMove({ dir, id });
    setDust({ x: from, id, kind: 'lift' });
    const land = setTimeout(() => {
      setMove(null);
      setLanding(Date.now());
      setDust({ x, id: id + 1, kind: 'land' });
    }, 720);
    const clear = setTimeout(() => (setLanding(0), setDust(null)), 1300);
    return () => (clearTimeout(land), clearTimeout(clear));
  }, [x]);

  // A happy bounce right after a job.
  useEffect(() => {
    if (wasWorking.current && !working && on) {
      setBounce(Date.now());
      const t = setTimeout(() => setBounce(0), 700);
      wasWorking.current = working;
      return () => clearTimeout(t);
    }
    wasWorking.current = working;
  }, [working]);

  // Random idle moments every 5-10 seconds.
  useEffect(() => {
    if (!on) {
      setIdle(null);
      return;
    }
    let timer = 0;
    let off = 0;
    const next = () => {
      timer = window.setTimeout(() => {
        const acts: IdleAct[] = ['glance', 'blink', 'leds', 'wave', 'look'];
        setIdle(acts[Math.floor(Math.random() * acts.length)]);
        off = window.setTimeout(() => setIdle(null), 1700);
        next();
      }, 5000 + Math.random() * 5000);
    };
    next();
    return () => (clearTimeout(timer), clearTimeout(off));
  }, [on]);

  // The nearest tree is on the bot's left for plots 1-2 and on its right for plot 3.
  const lookDir = plot < 2 ? 'left' : 'right';
  const cls = [
    move ? `moving dir-${move.dir}` : '',
    landing ? 'landing' : '',
    bounce ? 'bounce' : '',
    !move && !working && idle ? `idle-${idle === 'look' ? `look-${lookDir}` : idle}` : '',
  ]
    .filter(Boolean)
    .join(' ');
  return { cls, dust };
}
