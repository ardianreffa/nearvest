// The fishing pond scene at the top of the Fishing window (fishing.tsx, docs/PLAN-fishing.md).
//
// Backdrop: Ardian's ChatGPT pond, seen from ABOVE (docs/art-source/fishing-pond.png), pixelized to
// 480 x 270 (`/assets/bg/fishing-pond.png`, commands in docs/ASSETS.md; since package 2 the frogs and
// ducks are taken out of the picture by tools/pixelize/pond_clean.py and live in code: art/pond-life.tsx,
// with the village clock, the rain and the swaying tree). On top, drawn in code in the same
// 480 x 270 grid and the same top-down view: TaniBot on the end of the dock facing the water, a bamboo
// rod (nodes, cork handle, small reel, tapering tip), the line and the float seen from above (a red /
// white disc) with round ripples, a small waterfall animation (falling streaks + foam) and the catch
// popping up out of the water. Rod, line and float move together from one pose (art/rod-pose.ts), so
// the line always hangs from the rod's tip: cast swing, soft sag while waiting, the rod bends and the
// line goes taut on a bite, the line is pulled back in when reeling.
// Nothing ever covers the frogs' lily pads or the ducks' area (CRITTERS; checked in tools/fishing-test.mjs
// and web/test/rod-pose.test.ts).
// Overlay colours: pixel art, its own palette (CLAUDE.md Design system). With prefers-reduced-motion
// nothing moves (CSS).

import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { CRITTERS, crittersOf, type Box, type FishingZone, type PondTime, type PondWeather } from '../pond-life-plan';
import { WIDE, type PondLayout } from './pond-layouts';
import { PondLife, PondMood } from './pond-life';
import { CAST_MS, FLOAT_AT, REEL_MS, qAt, qNormal, rodPose, type Pt, type RodPose } from './rod-pose';

/** Pond grid (image px). */
export const POND_W = 480;
export const POND_H = 270;
export { FLOAT_AT };
/** TaniBot's feet on the end of the dock (it faces right, toward the water). */
export const BOT_AT = { x: 62, y: 130 };
/** TaniBot's height in the pond grid (its sprite is scaled to it). */
const BOT_H = 58;

export { CRITTERS };

/** While the line is out: the ducks keep away from the float and the line to the rod's tip. */
const zoneOf = (L: PondLayout): FishingZone => ({ tip: rodPose('wait', Infinity, false, L).tip, float: L.float });
const ZONES = new Map<string, FishingZone>();
const fishingZone = (L: PondLayout) => ZONES.get(L.key) ?? (ZONES.set(L.key, zoneOf(L)), ZONES.get(L.key)!);

const C = {
  rodDark: '#3f2a19',
  bamboo: '#d9b26f',
  bambooLight: '#f0d59a',
  node: '#8a6a2f',
  cork: '#b9824f',
  wrap: '#5e4026',
  reel: '#9ca3af',
  reelDark: '#4b5563',
  line: '#fffaf0',
  shadow: '#0b3a4a',
  crystal: '#9cf8d2',
  crystalCore: '#fffaf0',
  leaf: '#4caf6a',
  lampGlass: '#1e5a38',
  floatRed: '#e5484d',
  floatWhite: '#fffaf0',
  floatDark: '#1b1b2f',
  ripple: '#a8f1fb',
  foam: '#fffaf0',
};

/**
 * The waterfall (package 4: the picture's OWN waterfall colours, tools/pixelize/pond_fall.py; package 5:
 * the flow follows the real path down the rock steps). The fall in the picture comes in from the top
 * right, runs down-left onto the first step, then falls three more steps into the pool. Each step is
 * its own layer: clipped to that step, masked to the falling water, its texture slides down along the
 * water's slant there (a skewed layer), a little faster on each lower step. White spray flickers on each
 * step's lip, and foam spreads out at the foot. Day / dusk / night textures fade like the pictures.
 */
/** Package 7 (Ardian): the water flows a little slower (every step, lips and foam). */
const FALL_SLOW = 1.4;

function Waterfall({ mix, k, L }: { mix: { dusk: number; night: number }; k: number; L: PondLayout }) {
  const { box: FALL_BOX, steps: FALL_STEPS, lips: FALL_LIPS, foam: FOAM_PUFFS } = L.fall;
  const layers: [string, number][] = [
    ['day', 1],
    ['dusk', mix.dusk],
    ['night', mix.night],
  ];
  const box = {
    left: `${(FALL_BOX.x / L.w) * 100}%`,
    top: `${(FALL_BOX.y / L.h) * 100}%`,
    width: `${(FALL_BOX.w / L.w) * 100}%`,
    height: `${(FALL_BOX.h / L.h) * 100}%`,
    '--fall-mask': `url('${L.fall.mask}')`,
    '--fall-w': `${FALL_BOX.w * k}px`,
    '--fall-h': `${FALL_BOX.h * k}px`,
  };
  const pct = ([x, y]: [number, number]) => `${(((x - FALL_BOX.x) / FALL_BOX.w) * 100).toFixed(2)}% ${(((y - FALL_BOX.y) / FALL_BOX.h) * 100).toFixed(2)}%`;
  return (
    <>
      {FALL_STEPS.map((st, i) => (
        <div key={i} class="pond-fall" data-step={i} aria-hidden="true" style={{ ...box, clipPath: `polygon(${st.pts.map(pct).join(', ')})` }}>
          {layers.map(([t, o]) => (
            <i
              key={t}
              class={`fall-flow fall-${t} pond-fade`}
              style={{ opacity: o, transform: `skewX(${st.skew}deg)`, animationDuration: `${(st.s * FALL_SLOW).toFixed(2)}s`, backgroundImage: `url('${L.fall.tex[t as 'day' | 'dusk' | 'night']}')` }}
            />
          ))}
        </div>
      ))}
      {FALL_LIPS.map(([x, y, w], i) => (
        <i key={`l${i}`} class="fall-lip" style={{ ...pondAt(x + w / 2, y, L), width: `${w * k}px`, height: `${2.4 * k}px`, animationDelay: `${-i * 0.29}s` }} aria-hidden="true" />
      ))}
      {FOAM_PUFFS.map(([x, y, r], i) => (
        <i key={i} class="fall-foam" style={{ ...pondAt(x, y, L), '--r': `${r * k}px`, animationDelay: `${-i * 0.37}s` }} aria-hidden="true" />
      ))}
    </>
  );
}

export type PondPhase = 'ready' | 'casting' | 'wait' | 'bite' | 'reeling' | 'result';

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Re-renders every frame while `active` (the rod is moving), with the ms since `since`. */
function useClock(active: boolean, since: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return;
    let id = 0;
    const tick = () => {
      setNow(Date.now());
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active, since]);
  return now - since;
}

/**
 * The scene. `since` = when the current animation started (Date.now(): the Cast tap for casting and
 * the wait after it, the bite, the Reel tap; 0 = no animation, e.g. a line resumed from the server).
 * `bot` = TaniBot (any element), placed on the dock and sized to the pond; `children` = HTML on top
 * (the "!" bubble, the catch), placed with `pondAt`.
 */
export function PondScene({
  phase,
  since = 0,
  time = 'day',
  weather = 'clear',
  avoid = [],
  mix = { dusk: 0, night: 0 },
  layout: L = WIDE,
  rain = true,
  pictures = true,
  angler = true,
  bot,
  children,
}: {
  /**
   * false = the caller draws the day / dusk / night pictures itself (the laptop Fishing window: one
   * screen-sized canvas per picture, package 7c), the scene has no background of its own.
   */
  pictures?: boolean;
  /** false = just the pond (the sign-in page): no rod, line, float, bucket or lamp light. */
  angler?: boolean;
  /** false = the caller draws the rain over the whole screen (the Fishing window, package 7b). */
  rain?: boolean;
  phase: PondPhase;
  since?: number;
  /** The village clock and weather (pond-life-plan.ts: rain only, never ash). */
  time?: PondTime;
  weather?: PondWeather;
  /** Floating panels over the pond (grid boxes): the ducks do not swim under them. */
  avoid?: Box[];
  /** How much of the dusk / night pictures show (pondMix: cross-fade like the village). */
  mix?: { dusk: number; night: number };
  /** Which pond: the 16:9 one or the phone pictures (art/pond-layouts.ts). */
  layout?: PondLayout;
  bot?: ComponentChildren;
  children?: ComponentChildren;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  // TaniBot's scale: its 64 px sprite should be BOT_H image px tall, whatever the pond's width.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / L.w);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [L]);
  const still = reduced();
  // Night (and dark rain): the float glows and TaniBot carries its lamp.
  const dark = time === 'night' || weather === 'rain';
  const sinceMs = since > 0 ? Date.now() - since : Infinity;
  const moving =
    !still &&
    since > 0 &&
    (phase === 'bite' || ((phase === 'casting' || phase === 'wait') && sinceMs < CAST_MS + 50) || (phase === 'reeling' && sinceMs < REEL_MS + 50));
  const elapsed = useClock(moving, since);
  const ms = since > 0 ? elapsed : Infinity;
  const pose = rodPose(phase, ms, still, L);
  // Seen from above, a flying float is drawn higher and bigger, its shadow stays on the water.
  const f = { x: pose.float.x, y: pose.float.y - pose.lift * 10 };
  const fs = 1 + pose.lift * 0.7;
  return (
    <div
      class={`pond pond-${phase} pond-${time}${weather === 'rain' ? ' pond-rain-on' : ''}${pictures ? '' : ' pond-no-pics'}`}
      data-time={time}
      data-dark={dark ? '1' : '0'}
      data-weather={weather}
      ref={host}
      data-critters={JSON.stringify(crittersOf(L))}
      data-grid={`${L.w}x${L.h}`}
      data-layout={L.key}
      data-lake-bottom={(L.lakeBottom / L.h).toFixed(4)}
      data-tip={`${pose.tip.x.toFixed(2)},${pose.tip.y.toFixed(2)}`}
      data-bend={pose.bend.toFixed(1)}
      style={{ '--pk': String(k), aspectRatio: `${L.w} / ${L.h}` }}
    >
      {pictures && (
        <>
      <img class="pond-img" src={L.pics.day} alt="" draggable={false} />
      {/* Ardian's dusk and night pictures over the day one, faded in by the village clock. */}
      {/* Always there (loaded once), faded in and out by CSS: no popping when the time changes. */}
      <img class="pond-img pond-img-dusk pond-fade" src={L.pics.dusk} alt="" style={{ opacity: mix.dusk }} draggable={false} />
      <img class="pond-img pond-img-night pond-fade" src={L.pics.night} alt="" style={{ opacity: mix.night }} draggable={false} />
        </>
      )}
      <Waterfall mix={mix} k={k} L={L} />
      <PondLife bucket={angler} mix={mix} time={time} weather={weather} still={still} zone={phase === 'casting' || phase === 'wait' || phase === 'bite' || phase === 'reeling' ? fishingZone(L) : null} avoid={avoid} layout={L} />
      {angler && (
        <>
      <svg class="pond-svg" viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true">
        {pose.inWater && (
          <g class="pond-rings" fill="none" stroke={C.ripple} stroke-width={1}>
            <circle class="ring ring-a" cx={L.float.x} cy={L.float.y} r={6} />
            <circle class="ring ring-b" cx={L.float.x} cy={L.float.y} r={10} />
          </g>
        )}
        {pose.lift > 0 && <ellipse class="pond-float-shadow" cx={pose.float.x} cy={pose.float.y + 1} rx={3} ry={1.6} fill={C.shadow} opacity={0.45} />}
      </svg>
        </>
      )}
      {bot && (
        <div class="pond-bot" style={{ ...pondAt(L.bot.x, L.bot.y, L), '--bot-k': String((k * BOT_H) / 64) }}>
          {/* An own box for the size and the facing: TaniBot's idle animation sets its own transform. */}
          <div class="pond-bot-in">
            <div class="pond-bot-body">
              {/* The torch's bamboo grip and box BEHIND TaniBot: its own hand pixels cover the grip, so
                  it is gripped in the fist (package 7: the lamp floated beside it). */}
              <HeldLamp part="body" on={dark} />
              {bot}
            </div>
            <HeldLamp part="glow" on={dark} />
          </div>
        </div>
      )}
      {angler && (
        <>
      <svg class="pond-svg pond-rod-layer" viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true">
        {/* In front of TaniBot: the rod from its hands out over the water, then the line and the float. */}
        <Rod pose={pose} spin={phase === 'reeling' ? ms : 0} />
        <path class="pond-line" d={`M${pose.tip.x} ${pose.tip.y} Q${pose.line.x} ${pose.line.y} ${f.x} ${f.y}`} fill="none" stroke={C.line} stroke-width={0.9} />
        <g class="pond-float-at" transform={`translate(${f.x} ${f.y}) scale(${fs})`}>
          <g class="pond-float" shape-rendering="crispEdges">
            {/* The float from above: a red cap with a white band and a dark tip. */}
            <rect x={-2} y={-3} width={4} height={6} fill={C.floatWhite} />
            <rect x={-3} y={-2} width={6} height={4} fill={C.floatWhite} />
            <rect x={-2} y={-2} width={4} height={3} fill={C.floatRed} />
            <rect x={-1} y={-1} width={2} height={1} fill={C.floatDark} />
          </g>
        </g>
      </svg>
      <svg class="pond-lights pond-fade" style={{ opacity: dark ? 1 : 0 }} viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true">
          <defs>
            <radialGradient id="pond-glow-warm">
              <stop offset="0" style={{ stopColor: 'var(--gold-300)', stopOpacity: 0.9 }} />
              <stop offset="1" style={{ stopColor: 'var(--gold-300)', stopOpacity: 0 }} />
            </radialGradient>
            <radialGradient id="pond-glow-mint">
              <stop offset="0" style={{ stopColor: 'var(--mint-300)', stopOpacity: 0.95 }} />
              <stop offset="0.4" style={{ stopColor: 'var(--cyan-300)', stopOpacity: 0.45 }} />
              <stop offset="1" style={{ stopColor: 'var(--cyan-300)', stopOpacity: 0 }} />
            </radialGradient>
          </defs>
          {/* The lamp's light on the dock around TaniBot (the crystal and its halo move with TaniBot: HeldLamp). */}
          <ellipse class="lamp-pool" cx={lampAt(L).x + 6} cy={L.bot.y - 2} rx={30} ry={13} fill="url(#pond-glow-mint)" />
          {/* The float glows, and so does its reflection on the water. */}
          <ellipse class="float-reflect" cx={f.x} cy={f.y + 4} rx={4} ry={1.6} fill="url(#pond-glow-warm)" />
          <circle class="float-glow" cx={f.x} cy={f.y} r={8} fill="url(#pond-glow-warm)" />
          <circle cx={f.x} cy={f.y - 0.5} r={0.9} fill={C.crystalCore} />
        </svg>
        </>
      )}
      <PondMood time={time} weather={weather} layout={L} rain={rain} />
      {children}
    </div>
  );
}

/** Points of the rod's curve between t0 and t1, as an SVG polyline path. */
function sub(p: RodPose, t0: number, t1: number): string {
  const n = Math.max(2, Math.round((t1 - t0) * 16));
  let d = '';
  for (let i = 0; i <= n; i++) {
    const q = qAt(p.butt, p.ctrl, p.tip, t0 + ((t1 - t0) * i) / n);
    d += `${i ? 'L' : 'M'}${q.x.toFixed(2)} ${q.y.toFixed(2)}`;
  }
  return d;
}

/** A short band across the rod at t (a bamboo node or a wrap on the handle). */
function band(p: RodPose, t: number, half: number): { x1: number; y1: number; x2: number; y2: number } {
  const q = qAt(p.butt, p.ctrl, p.tip, t);
  const n = qNormal(p.butt, p.ctrl, p.tip, t);
  return { x1: q.x - n.x * half, y1: q.y - n.y * half, x2: q.x + n.x * half, y2: q.y + n.y * half };
}

/**
 * TaniBot's night lamp (package 4; a short torch since package 5, own design; package 7: really HELD).
 * Drawn in TaniBot's own 58 x 64 sprite grid, inside its mirrored box, so it moves with TaniBot's
 * breathing and fits every tier (they share the original's body outline). The bamboo grip runs through
 * the fist on the side away from the rod (sprite px LAMP_HAND; the body is drawn over it there, so the
 * fingers wrap the grip), leaning outward; on top a small dark lantern box with corner rivets and a tiny
 * leaf (solarpunk). part "body" = grip + box (dimmed with TaniBot at night); part "glow" = the mint
 * crystal and its halo (never dimmed).
 */
export const LAMP_HAND: Pt = { x: 43, y: 50 };
const LAMP_TILT = 30;
/** The lantern box's middle in the sprite grid (the grip is 19 sprite px from the fist to the box). */
export const LAMP_BOX: Pt = {
  x: LAMP_HAND.x + Math.sin((LAMP_TILT * Math.PI) / 180) * 19,
  y: LAMP_HAND.y - Math.cos((LAMP_TILT * Math.PI) / 180) * 19,
};
/** The lantern's middle in pond grid px (TaniBot is mirrored and BOT_H / 64 grid px per sprite px). */
const lampAt = (L: PondLayout) => ({ x: L.bot.x - (LAMP_BOX.x + 0.5 - 29) * (BOT_H / 64), y: L.bot.y - (64 - LAMP_BOX.y - 0.5) * (BOT_H / 64) });
function HeldLamp({ part, on }: { part: 'body' | 'glow'; on: boolean }) {
  const { x, y } = LAMP_HAND;
  return (
    <svg class={`held-lamp held-lamp-${part} pond-fade`} style={{ opacity: on ? 1 : 0 }} viewBox="0 0 58 64" aria-hidden="true">
      <g transform={`rotate(${LAMP_TILT} ${x + 0.5} ${y + 0.5})`} shape-rendering="crispEdges">
        {part === 'body' ? (
          <>
            {/* grip: from just below the fist up to the box */}
            <rect x={x - 1} y={y - 15} width={3} height={22} fill={C.rodDark} />
            <rect x={x} y={y - 15} width={1} height={21} fill={C.bamboo} />
            <rect x={x - 0.5} y={y - 9} width={2} height={1} fill={C.node} />
            {/* the lantern box: dark frame, corner rivets, the glass (the crystal glows in part "glow") */}
            <rect x={x - 4} y={y - 23} width={9} height={9} fill={C.rodDark} />
            <rect x={x - 3} y={y - 22} width={7} height={7} fill={C.lampGlass} />
            {[
              [-4, -23],
              [4, -23],
              [-4, -15],
              [4, -15],
            ].map(([dx, dy]) => (
              <rect key={`${dx}${dy}`} x={x + dx} y={y + dy} width={1} height={1} fill={C.reel} />
            ))}
            <rect x={x - 2} y={y - 24} width={5} height={1} fill={C.rodDark} />
            <path d={`M${x + 0.5} ${y - 24} q 1 -3 4 -3 q -1 3 -4 3 z`} fill={C.leaf} stroke={C.rodDark} stroke-width={0.35} />
          </>
        ) : (
          <>
            <circle class="lamp-halo" cx={x + 0.5} cy={y - 18.5} r={13} fill="url(#pond-glow-mint)" />
            <rect x={x - 1.5} y={y - 21} width={4} height={5} fill={C.crystal} />
            <rect x={x - 0.5} y={y - 22} width={2} height={7} fill={C.crystal} />
            <rect x={x} y={y - 20} width={1} height={2} fill={C.crystalCore} />
          </>
        )}
      </g>
    </svg>
  );
}

/** Thick to thin: handle, butt, middle, tip (t ranges along the rod and stroke widths in grid px). */
const ROD_PARTS: [number, number, number][] = [
  [0.18, 0.5, 2.6],
  [0.5, 0.78, 1.9],
  [0.78, 1, 1.15],
];
const NODES = [0.3, 0.42, 0.55, 0.67, 0.79, 0.9];

/** The bamboo rod: dark outline, cork handle with wraps, shaft with nodes, a small reel under the handle. */
function Rod({ pose, spin }: { pose: RodPose; spin: number }) {
  const reelT = 0.12;
  const q = qAt(pose.butt, pose.ctrl, pose.tip, reelT);
  const n = qNormal(pose.butt, pose.ctrl, pose.tip, reelT);
  const reel: Pt = { x: q.x + n.x * 3.4, y: q.y + n.y * 3.4 };
  const a = spin * 0.025;
  return (
    <g class="pond-rod" stroke-linecap="round" fill="none">
      <path d={sub(pose, 0, 0.18)} stroke={C.rodDark} stroke-width={4.6} />
      {ROD_PARTS.map(([t0, t1, w]) => (
        <path key={t0} d={sub(pose, t0, t1)} stroke={C.rodDark} stroke-width={w + 1.3} />
      ))}
      <line x1={q.x} y1={q.y} x2={reel.x} y2={reel.y} stroke={C.rodDark} stroke-width={1.2} />
      <circle cx={reel.x} cy={reel.y} r={2.6} fill={C.reel} stroke={C.rodDark} stroke-width={0.8} />
      <circle cx={reel.x} cy={reel.y} r={0.8} fill={C.reelDark} />
      <line x1={reel.x} y1={reel.y} x2={reel.x + Math.cos(a) * 2.6} y2={reel.y + Math.sin(a) * 2.6} stroke={C.reelDark} stroke-width={0.8} />
      <path d={sub(pose, 0, 0.18)} stroke={C.cork} stroke-width={3.2} />
      {[0.03, 0.09, 0.15].map((t) => (
        <line key={t} {...band(pose, t, 1.6)} stroke={C.wrap} stroke-width={0.8} stroke-linecap="butt" />
      ))}
      {ROD_PARTS.map(([t0, t1, w]) => (
        <path key={t0} d={sub(pose, t0, t1)} stroke={C.bamboo} stroke-width={w} />
      ))}
      <path d={sub(pose, 0.2, 0.7)} stroke={C.bambooLight} stroke-width={0.6} transform="translate(-0.4 -0.4)" />
      {NODES.map((t) => (
        <line key={t} {...band(pose, t, t < 0.5 ? 1.7 : t < 0.78 ? 1.35 : 1)} stroke={C.node} stroke-width={0.8} stroke-linecap="butt" />
      ))}
      <circle cx={pose.tip.x} cy={pose.tip.y} r={0.7} fill={C.rodDark} />
    </g>
  );
}

/** CSS position (percent of the scene) of a pond grid point. */
export const pondAt = (x: number, y: number, L: PondLayout = WIDE) => ({ left: `${(x / L.w) * 100}%`, top: `${(y / L.h) * 100}%` });
