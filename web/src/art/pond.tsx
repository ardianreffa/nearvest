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
import { CRITTERS, type Box, type FishingZone, type PondTime, type PondWeather } from '../pond-life-plan';
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
const FISHING_ZONE: FishingZone = { tip: rodPose('wait', Infinity).tip, float: FLOAT_AT };

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
const FALL_BOX = { x: 376, y: 0, w: 58, h: 56 };
/** The steps (grid px polygons), the water's slant (degrees of skew) and the loop time. */
const FALL_STEPS: { pts: [number, number][]; skew: number; s: number }[] = [
  { pts: [[415, 0], [434, 0], [424, 17], [405, 17]], skew: -27, s: 1.05 },
  { pts: [[397, 12], [413, 12], [407, 31], [380, 31]], skew: -14, s: 0.95 },
  { pts: [[376, 30], [410, 30], [408, 45], [379, 45]], skew: -5, s: 0.85 },
  { pts: [[376, 44], [403, 44], [401, 56], [376, 56]], skew: 0, s: 0.75 },
];
/** White spray on each step's lip: x, y, width (grid px). */
const FALL_LIPS = [
  [406, 15, 12],
  [383, 31, 22],
  [381, 40, 20],
];
/** Foam at the foot: puffs, and foam spreading out over the pool. */
const FOAM_PUFFS = [
  [382, 54, 6],
  [389, 56, 8],
  [396, 54, 6],
];

function Waterfall({ mix, k }: { mix: { dusk: number; night: number }; k: number }) {
  const layers: [string, number][] = [
    ['day', 1],
    ['dusk', mix.dusk],
    ['night', mix.night],
  ];
  const box = {
    left: `${(FALL_BOX.x / POND_W) * 100}%`,
    top: `${(FALL_BOX.y / POND_H) * 100}%`,
    width: `${(FALL_BOX.w / POND_W) * 100}%`,
    height: `${(FALL_BOX.h / POND_H) * 100}%`,
    '--fall-w': `${FALL_BOX.w * k}px`,
    '--fall-h': `${FALL_BOX.h * k}px`,
  };
  const pct = ([x, y]: [number, number]) => `${(((x - FALL_BOX.x) / FALL_BOX.w) * 100).toFixed(2)}% ${(((y - FALL_BOX.y) / FALL_BOX.h) * 100).toFixed(2)}%`;
  return (
    <>
      {FALL_STEPS.map((st, i) => (
        <div key={i} class="pond-fall" data-step={i} aria-hidden="true" style={{ ...box, clipPath: `polygon(${st.pts.map(pct).join(', ')})` }}>
          {layers.map(([t, o]) => (
            <i key={t} class={`fall-flow fall-${t} pond-fade`} style={{ opacity: o, transform: `skewX(${st.skew}deg)`, animationDuration: `${st.s}s` }} />
          ))}
        </div>
      ))}
      {FALL_LIPS.map(([x, y, w], i) => (
        <i key={`l${i}`} class="fall-lip" style={{ ...pondAt(x + w / 2, y), width: `${w * k}px`, height: `${2.4 * k}px`, animationDelay: `${-i * 0.29}s` }} aria-hidden="true" />
      ))}
      {FOAM_PUFFS.map(([x, y, r], i) => (
        <i key={i} class="fall-foam" style={{ ...pondAt(x, y), '--r': `${r * k}px`, animationDelay: `${-i * 0.37}s` }} aria-hidden="true" />
      ))}
      {[0, 1, 2].map((i) => (
        <i key={`s${i}`} class="fall-spread" style={{ ...pondAt(389, 58), '--r': `${12 * k}px`, animationDelay: `${-i * 0.9}s` }} aria-hidden="true" />
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
  bot,
  children,
}: {
  phase: PondPhase;
  since?: number;
  /** The village clock and weather (pond-life-plan.ts: rain only, never ash). */
  time?: PondTime;
  weather?: PondWeather;
  /** Floating panels over the pond (grid boxes): the ducks do not swim under them. */
  avoid?: Box[];
  /** How much of the dusk / night pictures show (pondMix: cross-fade like the village). */
  mix?: { dusk: number; night: number };
  bot?: ComponentChildren;
  children?: ComponentChildren;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [k, setK] = useState(0);
  // TaniBot's scale: its 64 px sprite should be BOT_H image px tall, whatever the pond's width.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const fit = () => setK(el.clientWidth / POND_W);
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
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
  const pose = rodPose(phase, ms, still);
  // Seen from above, a flying float is drawn higher and bigger, its shadow stays on the water.
  const f = { x: pose.float.x, y: pose.float.y - pose.lift * 10 };
  const fs = 1 + pose.lift * 0.7;
  return (
    <div
      class={`pond pond-${phase} pond-${time}${weather === 'rain' ? ' pond-rain-on' : ''}`}
      data-time={time}
      data-dark={dark ? '1' : '0'}
      data-weather={weather}
      ref={host}
      data-critters={JSON.stringify(CRITTERS)}
      data-grid={`${POND_W}x${POND_H}`}
      data-tip={`${pose.tip.x.toFixed(2)},${pose.tip.y.toFixed(2)}`}
      data-bend={pose.bend.toFixed(1)}
      style={{ '--pk': String(k) }}
    >
      <img class="pond-img" src="/assets/bg/fishing-pond.png" alt="" width={POND_W} height={POND_H} draggable={false} />
      {/* Ardian's dusk and night pictures over the day one, faded in by the village clock. */}
      {/* Always there (loaded once), faded in and out by CSS: no popping when the time changes. */}
      <img class="pond-img pond-img-dusk pond-fade" src="/assets/bg/fishing-pond-dusk.png" alt="" style={{ opacity: mix.dusk }} draggable={false} />
      <img class="pond-img pond-img-night pond-fade" src="/assets/bg/fishing-pond-night.png" alt="" style={{ opacity: mix.night }} draggable={false} />
      <Waterfall mix={mix} k={k} />
      <PondLife mix={mix} time={time} weather={weather} still={still} zone={phase === 'casting' || phase === 'wait' || phase === 'bite' || phase === 'reeling' ? FISHING_ZONE : null} avoid={avoid} />
      <svg class="pond-svg" viewBox={`0 0 ${POND_W} ${POND_H}`} aria-hidden="true">
        {pose.inWater && (
          <g class="pond-rings" fill="none" stroke={C.ripple} stroke-width={1}>
            <circle class="ring ring-a" cx={FLOAT_AT.x} cy={FLOAT_AT.y} r={6} />
            <circle class="ring ring-b" cx={FLOAT_AT.x} cy={FLOAT_AT.y} r={10} />
          </g>
        )}
        {pose.lift > 0 && <ellipse class="pond-float-shadow" cx={pose.float.x} cy={pose.float.y + 1} rx={3} ry={1.6} fill={C.shadow} opacity={0.45} />}
      </svg>
      {bot && (
        <div class="pond-bot" style={{ ...pondAt(BOT_AT.x, BOT_AT.y), '--bot-k': String((k * BOT_H) / 64) }}>
          {/* An own box for the size and the facing: TaniBot's idle animation sets its own transform. */}
          <div class="pond-bot-in">{bot}</div>
        </div>
      )}
      <svg class="pond-svg pond-rod-layer" viewBox={`0 0 ${POND_W} ${POND_H}`} aria-hidden="true">
        {/* In front of TaniBot: the rod from its hands out over the water, then the line and the float. */}
        <g class="pond-fade" style={{ opacity: dark ? 1 : 0 }}>
          <LampStaff />
        </g>
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
      <svg class="pond-lights pond-fade" style={{ opacity: dark ? 1 : 0 }} viewBox={`0 0 ${POND_W} ${POND_H}`} aria-hidden="true">
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
          {/* The lamp's light around TaniBot on the dock, its halo, and the crystal itself. */}
          <ellipse class="lamp-pool" cx={LAMP.x + 6} cy={BOT_AT.y - 2} rx={30} ry={13} fill="url(#pond-glow-mint)" />
          <circle class="lamp-halo" cx={LAMP.x} cy={LAMP.y} r={12} fill="url(#pond-glow-mint)" />
          <g shape-rendering="crispEdges">
            <rect x={LAMP.x - 2} y={LAMP.y - 2} width={4} height={4} fill={C.crystal} />
            <rect x={LAMP.x - 1} y={LAMP.y - 3} width={2} height={6} fill={C.crystal} />
            <rect x={LAMP.x - 0.5} y={LAMP.y - 1.5} width={1} height={2} fill={C.crystalCore} />
          </g>
          {/* The float glows, and so does its reflection on the water. */}
          <ellipse class="float-reflect" cx={f.x} cy={f.y + 4} rx={4} ry={1.6} fill="url(#pond-glow-warm)" />
          <circle class="float-glow" cx={f.x} cy={f.y} r={8} fill="url(#pond-glow-warm)" />
          <circle cx={f.x} cy={f.y - 0.5} r={0.9} fill={C.crystalCore} />
        </svg>
      <PondMood time={time} weather={weather} />
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
 * TaniBot's night lamp (package 4; a SHORT torch since package 5, own design): held in its left hand
 * (the side away from the rod), a short bamboo grip with one node, a small dark lantern box with
 * rivets on its corners and a glowing mint crystal inside, a tiny leaf on top (solarpunk). The grip
 * and box are drawn with the rod (dimmed with TaniBot at night); the crystal and its light are in
 * `.pond-lights` (never dimmed). From the hand up to about head height.
 */
const LAMP = { x: BOT_AT.x - 17, y: BOT_AT.y - 33 };
function LampStaff() {
  const x = LAMP.x;
  const y = LAMP.y;
  return (
    <g class="pond-lamp" shape-rendering="crispEdges">
      {/* grip: from the box down to just below the hand */}
      <rect x={x - 1.5} y={y + 3.5} width={3} height={14} fill={C.rodDark} />
      <rect x={x - 0.75} y={y + 3.5} width={1.5} height={13.2} fill={C.bamboo} />
      <rect x={x - 1} y={y + 10} width={2} height={0.8} fill={C.node} />
      {/* the lantern box: dark frame, corner rivets (the crystal glows inside, .pond-lights) */}
      <rect x={x - 4} y={y - 4} width={8} height={8} fill={C.rodDark} />
      <rect x={x - 3} y={y - 3} width={6} height={6} fill={C.lampGlass} />
      {[
        [-4, -4],
        [3, -4],
        [-4, 3],
        [3, 3],
      ].map(([dx, dy]) => (
        <rect key={`${dx}${dy}`} x={x + dx} y={y + dy} width={1} height={1} fill={C.reel} />
      ))}
      <rect x={x - 2} y={y - 5} width={4} height={1} fill={C.rodDark} />
      {/* a tiny leaf on the cap */}
      <path d={`M${x} ${y - 5} q 1 -3 4 -3 q -1 3 -4 3 z`} fill={C.leaf} stroke={C.rodDark} stroke-width={0.35} />
    </g>
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
export const pondAt = (x: number, y: number) => ({ left: `${(x / POND_W) * 100}%`, top: `${(y / POND_H) * 100}%` });
