// The garden scene: backdrop, three plots, TaniBot standing next to the
// selected plot, and TaniBot's action animations.

import { loadToken, type GameState, type TreeView } from './api';
import { Backdrop, lockedFraction, phaseOf } from './art/backdrop';
import type { Place } from './art/hotspots';
import { BASKET, Drone, droneCount, HOE, TaniBot, TANIBOT_H, TANIBOT_W, tierOf, tierRank, type Tier } from './art/tanibot';
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

// ---------- Immersive layout (laptop / PC): web/src/layout.ts ----------

export { ART_H, ART_W, immersiveLayout, type Immersive } from './layout';
import type { Immersive, PhoneZoom } from './layout';

/** Dev builds only: ?time=day / dusk / night locks the village clock (screenshots and video). */
const TIME_LOCKED = import.meta.env.DEV && typeof location !== 'undefined' ? lockedFraction(location.search) : null;

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
  /** Hotspots in the village: open the Shop, the Market or the Village panel. */
  onPlace?: (p: Place) => void;
  /** Phones: the zoomed garden (the scene box is wider than the screen and pans sideways). */
  phone?: PhoneZoom;
}

export function GardenScene({ state, selected, onSelect, elapsed, fx, big, immersive: wideLayout, onBot, onPlace, phone }: Props) {
  const immersive = wideLayout ?? phone;
  // Trees use the same pixel size as the backdrop: 2 on phones, 3 on the wide
  // layout, k in the immersive layout.
  const px = immersive ? immersive.k : big ? 3 : 2;
  const botScale = immersive ? Math.max(1, Math.round(immersive.k / 2)) : big ? 2 : 1;
  const lane = immersive ? LANE_STAGE : LANE_NORMAL;
  // Dev builds: ?time=day / dusk / night locks the village clock (screenshots and video).
  const fraction = TIME_LOCKED ?? 1 - Math.max(0, state.clock.msUntilNextDay - elapsed) / state.clock.dayLengthMs;
  const phase = phaseOf(fraction);
  const tier = tierOf(state.player.title);
  /** Drone size: about a third of TaniBot's width at every scale. */
  const droneScale = Math.max(1, botScale);
  const bx = botX(selected, lane);
  const working = fx !== null;
  const tb = state.player.tanibot;
  const on = !!tb && tb.enabled && tb.status === 'ready';
  /** Not active, switched off or failed: TaniBot sleeps and asks to be switched on. */
  const asleep = !on;
  // During the tutorial TaniBot's coach bubble does the talking (no "Turn me on" nudge).
  const askOn = !state.tutorial && (!tb || tb.status === 'failed' || (tb.status === 'ready' && !tb.enabled));
  const flash = useActionBubble(on, tb?.last ?? null);
  const nudge = useTurnOnNudge(askOn, state);
  const motion = useBotMotion(bx, on, working, selected);
  const bye = useGoodbye(on, tb?.status === 'ready');
  const evolving = useEvolution(tier);

  return (
    <div
      class={`scene phase-${phase}${immersive ? ' immersive-scene' : ''}${phone ? ' phone-scene' : ''}`}
      role="group"
      aria-label="Your garden"
      style={
        immersive
          ? {
              '--k': String(immersive.k),
              '--art-left': `${immersive.artLeft}px`,
              '--art-bottom': `${immersive.artBottom}px`,
              ...(phone ? { width: `${phone.sceneW}px`, height: `${phone.sceneH}px` } : {}),
            }
          : undefined
      }
    >
      <Backdrop fraction={fraction} blurFill={!!immersive && !phone} hd={!!immersive} onPlace={onPlace} account={state.player.accountId} />

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
                  <TreePixels species={p.tree.species} stage={p.tree.stage} quality={p.tree.quality} scale={px} seed={p.tree.tokenId ?? p.tree.id} />
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
      <div class={`bot-spot tier-${tier} ${motion.cls}${evolving ? ' evolving' : ''}`} style={{ left: `${bx}%`, '--bot-w': `${TANIBOT_W * botScale}px` }}>
        {on && (
          <span class="bot-jet" aria-hidden="true">
            <b />
            <b />
            <i />
            <i />
            <i />
          </span>
        )}
        {droneCount(tier) > 0 && (
          // Drones orbit TaniBot's shoulders; their shadows run along the ground. Asleep: parked and dim.
          <div class={`bot-drones${on ? '' : ' parked'}`} aria-hidden="true">
            {Array.from({ length: droneCount(tier) }, (_, i) => (
              <span key={i} class={`orbit o${i + 1}`}>
                <Drone scale={droneScale} shadow={Math.round(TANIBOT_H * botScale * 0.36)} />
              </span>
            ))}
          </div>
        )}
        {bye ? (
          <button class="bot-hint bot-bye" onClick={onBot} key={bye}>
            Okay, going to sleep. Tap me when you need me!
          </button>
        ) : askOn ? (
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
          <TaniBot tier={tier} scale={botScale} working={working && on} effects={on} />
          {evolving > 0 && <span class="bot-evolve-scan" key={evolving} aria-hidden="true" />}
          {tier === 'legend' && on && <i class="bot-ripple" aria-hidden="true" />}
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

      {fx && <ActionEffect fx={fx} from={botX(fx.plot, lane)} to={plotCenter(fx.plot, lane)} tier={tier} px={px} droneScale={droneScale} key={fx.id} />}
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

function ActionEffect({ fx, from, to, tier, px, droneScale }: { fx: SceneFx; from: number; to: number; tier: Tier; px: number; droneScale: number }) {
  const hasCan = tierRank(tier) >= tierRank('farmhand');
  const vars = { '--from': `${from}%`, '--to': `${to}%` };
  const left = Math.min(from, to);
  const width = Math.abs(from - to);

  switch (fx.kind) {
    case 'water':
      return (
        <div class={`act act-water${hasCan ? ' from-can' : ''}`} style={vars}>
          {hasCan ? (
            // From Farmhand on, TaniBot pours from its own watering can.
            Array.from({ length: 12 }, (_, i) => (
              <i key={i} class="pour" style={{ left: `calc(${to}% + ${(i % 4) * 5 - 8}px)`, animationDelay: `${150 + i * 70}ms` }} />
            ))
          ) : (
            <>
              <Drone scale={droneScale} class="fly-drone" />
              {Array.from({ length: 9 }, (_, i) => (
                <i key={i} class="drop" style={{ left: `calc(${to}% + ${(i % 3) * 6 - 6}px)`, animationDelay: `${450 + i * 70}ms` }} />
              ))}
            </>
          )}
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
          {tier === 'durian_king' &&
            [0, 1, 2, 3].map((i) => <i key={`c${i}`} class="king-coin" style={{ left: `calc(${to}% + ${i * 9 - 14}px)`, animationDelay: `${450 + i * 110}ms` }} />)}
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

/** One goodbye bubble (~5 s) when the player switches TaniBot from ON to OFF. */
function useGoodbye(on: boolean, ready: boolean): number {
  const [bye, setBye] = useState(0);
  const was = useRef(on);
  useEffect(() => {
    const switchedOff = was.current && !on && ready;
    was.current = on;
    if (!switchedOff) return;
    const id = Date.now();
    setBye(id);
    const t = setTimeout(() => setBye(0), 5000);
    return () => clearTimeout(t);
  }, [on]);
  return bye;
}

/**
 * The evolution moment when a new title brings a new TaniBot: a flashing white
 * silhouette, a scan line from the feet up, then the new look (the app plays
 * the fanfare and offers the "TaniBot evolved" card).
 */
function useEvolution(tier: Tier): number {
  const [at, setAt] = useState(0);
  const prev = useRef(tier);
  useEffect(() => {
    const up = tierRank(tier) > tierRank(prev.current);
    prev.current = tier;
    if (!up) return;
    const id = Date.now();
    setAt(id);
    const t = setTimeout(() => setAt(0), 2600);
    return () => clearTimeout(t);
  }, [tier]);
  return at;
}
