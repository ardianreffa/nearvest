// The landing page's little game scenes (2026-11-12), made from the game's own sprites and art:
// - PanenMedal: the round gold PANEN coin, big, turning slowly;
// - GrowLoop: plant a seed -> the tree grows -> fruit -> harvest -> sell to Mr. Darto -> PANEN coins
//   fly to the balance, which counts up;
// - DuelLoop: two TaniBots on the Tandur Arena throw fruit until one is K.O.; the prize comes from
//   the game;
// - FishLoop: the real pond scene (art/pond.tsx): cast, the float bobs, a bite, reel in, the fish
//   jumps out, +PANEN.
// Each loop only runs while its scene is on screen, and stands still on one telling frame with
// prefers-reduced-motion. Colours: design tokens; sprites keep their pixel-art palettes.

import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Billboard, TIME_LOCK } from './art/backdrop';
import { CatchIcon } from './art/catch-icons';
import { DuelBackdrop } from './art/duel-backdrop';
import { skyBackground, skyBands } from './art/sky-colors';
import { boxIn, V3_WEB } from './art/village';
import { DARTO_IDLE, DARTO_PALETTE, DARTO_WAVE } from './art/darto-sprite';
import { PanenCoin } from './art/panen-coin';
import { PondScene, pondAt, type PondPhase } from './art/pond';
import { WIDE } from './art/pond-layouts';
import { TaniBot } from './art/tanibot';
import { TreePixels } from './art/trees';
import { Pixels, Sprite } from './sprites';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** True while the element is (partly) on screen. */
function useInView<T extends Element>(): [preact.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver !== 'function') return setInView(true);
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.15 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return [ref, inView];
}

/**
 * The element's width in CSS px (follows resizes). The scenes pick a whole-number pixel scale from it
 * (2026-11-12, Ardian: much bigger art on laptops, full width on phones, always sharp).
 */
export function useWidth<T extends Element>(): [preact.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = () => setW(el.getBoundingClientRect().width);
    on();
    if (typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(on);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** A whole-number scale so that `base` art px fill about `w` CSS px (at least `min`). */
export const fitScale = (w: number, base: number, min = 1) => Math.max(min, Math.floor(w / base));

/**
 * Steps through `durations` (ms per step) in a loop while `run`; reduced motion = stays on `still`.
 * Returns the step and a counter of finished loops.
 */
function useSteps(durations: number[], run: boolean, still: number): [number, number] {
  const [state, setState] = useState<[number, number]>([reducedMotion() ? still : 0, 0]);
  useEffect(() => {
    if (!run || reducedMotion()) return;
    const t = window.setTimeout(
      () => setState(([s, n]) => (s + 1 >= durations.length ? [0, n + 1] : [s + 1, n])),
      durations[state[0]],
    );
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, state]);
  return state;
}

/** A "screenshot" card: a thick paper-white frame, a shadow, a slight tilt; an optional card behind. */
export function Card({ tilt = -2, back, children, class: cls = '' }: { tilt?: number; back?: string; children: ComponentChildren; class?: string }) {
  return (
    <div class={`lp-card-stack ${cls}`}>
      {back && <div class="lp-card lp-card-back" style={{ '--tilt': `${-tilt * 1.6}deg`, backgroundImage: `url('${back}')` }} aria-hidden="true" />}
      <div class="lp-card" style={{ '--tilt': `${tilt}deg` }}>
        {children}
      </div>
    </div>
  );
}

/** The big round PANEN medal: the game's PANEN coin, turning slowly in its gold ring. */
export function PanenMedal() {
  // The 13 px coin fills about half the medal.
  const [ref, w] = useWidth<HTMLDivElement>();
  const scale = fitScale(w, 26, 6);
  return (
    <div class="lp-medal" role="img" aria-label="The PANEN coin" ref={ref}>
      <span class="lp-medal-ring" aria-hidden="true" />
      <span class="lp-medal-coin">
        <PanenCoin scale={scale} />
      </span>
    </div>
  );
}

/**
 * The village at midday as in the game, for a landing card: the code sky's day bands (the art's sky
 * is see-through), the v3 laptop village picture and its own overlays from art/village.ts V3_WEB (the
 * "1 VS 1" billboard on the Arena gazebo, holograms, waterfalls, lanterns), in the art's 240 x 135
 * grid, covering the card (bottom-anchored, centred).
 */
function VillagePicture() {
  const v = V3_WEB;
  const at = (b: [number, number, number, number]) => boxIn(v, ...b);
  return (
    <div class="lp-village" aria-hidden="true">
      <div class="lp-village-sky" style={{ background: skyBackground(skyBands(12), v.h) }} />
      <img class="lp-village-img" src={v.src('day', true)} alt="" draggable={false} />
      {v.falls.map((b, i) => (
        <i key={`f${i}`} class="fall" style={{ ...at(b), animationDelay: `${i * 0.15}s` }} />
      ))}
      {v.holograms.map((b, i) => (
        <i key={`h${i}`} class={`holo${v.softHolograms ? ' soft' : ''}`} style={{ ...at(b), animationDelay: `${i * 1.7}s` }} />
      ))}
      {v.billboard && <Billboard style={at(v.billboard)} />}
      {v.lanterns.map(([x, y, w, h], i) => (
        <i key={`l${i}`} class="lamp" style={{ ...at([x - 2, y - 2, w + 4, h + 4]), animationDelay: `${i * 0.7}s` }} />
      ))}
    </div>
  );
}

const GROW_MS = [1100, 1000, 1000, 1200, 1100, 1700];
const GROW_LABEL = ['Plant a seed', 'It sprouts', 'It grows', 'Fruit!', 'Harvest', 'Sell to Mr. Darto'];

/** Plant -> grow -> fruit -> harvest -> sell: coins fly to the balance, which counts up. */
export function GrowLoop() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [wref, w] = useWidth<HTMLDivElement>();
  // About 150 art px across the scene (the tree, Mr. Darto and the coins grow with the card).
  const scale = fitScale(w, 150, 2);
  const [step, loops] = useSteps(GROW_MS, inView, 3);
  const sold = step === 5;
  const balance = 50 + (loops + (sold ? 1 : 0)) * 10;
  const stage = step === 1 ? ('sprout' as const) : step === 2 ? ('tree' as const) : step === 3 || step === 4 ? ('fruiting' as const) : null;
  return (
    <div class="lp-grow" ref={ref} data-step={step}>
      <Card tilt={-2} back="/assets/bg/bg-market.png">
        <div class="lp-grow-scene" ref={wref}>
          <VillagePicture />
          <div class="lp-grow-plot">
            {stage && (
              <span class="lp-grow-tree" key={stage}>
                <TreePixels species="mango" stage={stage} quality="common" scale={scale + 1} seed={7} />
              </span>
            )}
            {step === 0 && (
              <span class="lp-grow-seed" key={`seed${loops}`}>
                <Sprite name="seedPacket" scale={scale + 1} />
              </span>
            )}
            <span class="lp-grow-soil" />
            {step === 4 &&
              [0, 1, 2].map((i) => (
                <span key={`f${loops}-${i}`} class="lp-grow-fruit" style={{ animationDelay: `${i * 120}ms` }}>
                  <Sprite name="mango" scale={scale} />
                </span>
              ))}
          </div>
          <div class="lp-grow-darto">
            <Pixels rows={sold ? DARTO_WAVE : DARTO_IDLE} palette={DARTO_PALETTE} scale={scale} />
            {sold &&
              [0, 1, 2, 3].map((i) => (
                <span key={`c${loops}-${i}`} class="lp-grow-coin" style={{ animationDelay: `${150 + i * 140}ms` }}>
                  <PanenCoin scale={Math.max(1, scale - 1)} />
                </span>
              ))}
          </div>
          <div class={`lp-grow-balance${sold ? ' bump' : ''}`} key={`b${balance}`}>
            <PanenCoin scale={2} />
            <b>{balance}</b>
          </div>
          <div class="lp-grow-label" aria-live="off">
            {GROW_LABEL[step]}
          </div>
        </div>
      </Card>
    </div>
  );
}

const DUEL_MS = [1100, 1100, 1100, 1300, 1700];

/** Two TaniBots on the Tandur Arena: fruit flies, bars drop, K.O., the prize from the game. */
export function DuelLoop() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [wref, w] = useWidth<HTMLDivElement>();
  // Two 58 px TaniBots across about 280 art px.
  const scale = fitScale(w, 280, 1);
  const [step, loops] = useSteps(DUEL_MS, inView, 3);
  const right = step === 0 ? 100 : step === 1 || step === 2 ? 60 : 0;
  const left = step >= 2 ? 65 : 100;
  return (
    <div class="lp-duel" ref={ref} data-step={step}>
      <Card tilt={2} back="/assets/bg/arena-web-dusk.png">
        <div class="lp-duel-scene" ref={wref}>
          {/* The game's own Tandur Arena (lanterns, neon, the ring, the volcano's smoke), at midday. */}
          <DuelBackdrop fraction={TIME_LOCK.day} wide />
          <div class="lp-duel-bars" aria-hidden="true">
            <span class="lp-bar">
              <i style={{ width: `${left}%` }} />
            </span>
            <b class="lp-vs">VS</b>
            <span class="lp-bar right">
              <i style={{ width: `${right}%` }} />
            </span>
          </div>
          <div class={`lp-duel-bot left${step === 2 ? ' hit' : ''}`}>
            <div class="lp-face-right">
              <TaniBot tier="farmer" scale={scale} effects={false} />
            </div>
          </div>
          <div class={`lp-duel-bot right${step === 1 || step === 3 ? ' hit' : ''}${step >= 3 ? ' ko' : ''}`}>
            <TaniBot tier="orchard_master" scale={scale} effects={false} />
            {step >= 3 && <span class="lp-zzz">Zzz</span>}
          </div>
          {(step === 1 || step === 3) && (
            <span class="lp-throw to-right" key={`t${loops}-${step}`}>
              <Sprite name={step === 3 ? 'durian' : 'mango'} scale={scale + 1} />
            </span>
          )}
          {step === 2 && (
            <span class="lp-throw to-left" key={`t${loops}-${step}`}>
              <Sprite name="rambutan" scale={scale + 1} />
            </span>
          )}
          {step >= 3 && <span class="lp-ko">K.O.!</span>}
          {step === 4 && (
            <span class="lp-prize">
              <PanenCoin scale={2} /> +PANEN from the game
            </span>
          )}
        </div>
      </Card>
    </div>
  );
}

/** The pond's own scene: cast, wait, bite, reel, the catch jumps out, +PANEN. */
const FISH_STEPS: [PondPhase, number][] = [
  ['ready', 900],
  ['casting', 1300],
  ['wait', 1300],
  ['bite', 1100],
  ['reeling', 800],
  ['result', 1900],
];
export function FishLoop() {
  const [ref, inView] = useInView<HTMLDivElement>();
  const [step, loops] = useSteps(
    FISH_STEPS.map(([, ms]) => ms),
    inView,
    2,
  );
  const [phase] = FISH_STEPS[step];
  // The pond animates the cast and the reel from the moment they start.
  const since = useRef(0);
  const lastKey = useRef('');
  const key = `${loops}-${step}`;
  if (lastKey.current !== key) {
    lastKey.current = key;
    if (phase === 'casting' || phase === 'bite' || phase === 'reeling') since.current = Date.now();
    if (phase === 'ready') since.current = 0;
  }
  const L = WIDE;
  return (
    <div class="lp-fish" ref={ref} data-phase={phase}>
      <Card tilt={-1.5} back="/assets/bg/fishing-pond-night.png">
        <div class="lp-fish-scene">
          {/* Off screen: just the picture (the pond's life timers stop with it). */}
          {!inView && <img class="lp-fish-still" src={L.pics.day} alt="" draggable={false} />}
          {inView && (
          <PondScene phase={phase} since={since.current} time="day" weather="clear" layout={L} bot={<TaniBot tier="farmer" scale={1} effects={false} />}>
            {phase === 'bite' && (
              <span class="pond-bang" style={pondAt(L.float.x, L.float.y - 10, L)} aria-hidden="true">
                !
              </span>
            )}
            {phase === 'result' && (
              <div class="pond-result-fx" key={loops}>
                <span class="pond-catch tier-fish" style={pondAt(L.float.x, L.float.y, L)} aria-hidden="true">
                  <CatchIcon id="tilapia" scale={2} />
                </span>
                <span class="lp-fish-gain" style={pondAt(L.float.x, L.float.y - 26, L)}>
                  <PanenCoin scale={2} /> +PANEN
                </span>
              </div>
            )}
          </PondScene>
          )}
        </div>
      </Card>
    </div>
  );
}

/** Renders `children(scale)` with a whole-number scale fitted to its own width (`base` art px across). */
export function Fitted({ base, min = 1, max = 12, class: cls = '', children }: { base: number; min?: number; max?: number; class?: string; children: (scale: number) => ComponentChildren }) {
  const [ref, w] = useWidth<HTMLDivElement>();
  return (
    <div class={`lp-fitted ${cls}`} ref={ref}>
      {w > 0 && children(Math.min(max, fitScale(w, base, min)))}
    </div>
  );
}
