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
  floatRed: '#e5484d',
  floatWhite: '#fffaf0',
  floatDark: '#1b1b2f',
  ripple: '#a8f1fb',
  foam: '#fffaf0',
  fallDark: '#22a8c8',
};

/**
 * The waterfall (Fishing package 3: the old thin pale streaks did not show on the white water).
 * Each falling sheet is clipped to its place in the picture and filled with columns of bright and
 * dark dashes; the whole group slides down one dash period per loop (seamless), so the water is
 * clearly seen flowing. Foam puffs flicker at the foot and rings spread out over the pool.
 */
const FALLS: { clip: [number, number, number, number]; x0: number; x1: number }[] = [
  { clip: [384, 16, 21, 39], x0: 384, x1: 405 },
  { clip: [411, 0, 18, 14], x0: 411, x1: 429 },
];
const FALL_PERIOD = 8;
const FOAM_PUFFS = [
  [382, 54, 3],
  [388, 57, 4],
  [395, 55, 3.5],
  [401, 58, 3],
  [392, 51, 2.5],
  [399, 52, 2],
];

function Waterfall() {
  return (
    <g class="pond-fall" aria-hidden="true">
      <defs>
        {FALLS.map((f, i) => (
          <clipPath key={i} id={`pond-fall-${i}`}>
            <rect x={f.clip[0]} y={f.clip[1]} width={f.clip[2]} height={f.clip[3]} />
          </clipPath>
        ))}
      </defs>
      {FALLS.map((f, i) => {
        const dashes = [];
        for (let x = f.x0; x < f.x1; x += 2)
          for (let y = f.clip[1] - FALL_PERIOD * 2; y < f.clip[1] + f.clip[3]; y += FALL_PERIOD) {
            const off = ((x * 5) % FALL_PERIOD) - FALL_PERIOD / 2;
            dashes.push(<rect key={`w${x}-${y}`} x={x} y={y + off} width={1.4} height={3} fill={C.foam} />);
            dashes.push(<rect key={`d${x}-${y}`} x={x + 1} y={y + off + 4} width={1} height={2} fill={C.fallDark} />);
          }
        return (
          <g key={i} clip-path={`url(#pond-fall-${i})`}>
            <g class="fall-flow" shape-rendering="crispEdges" style={{ animationDelay: `${-i * 0.2}s` }}>
              {dashes}
            </g>
          </g>
        );
      })}
      {FOAM_PUFFS.map(([x, y, r], i) => (
        <ellipse key={i} class="fall-foam" cx={x} cy={y} rx={r} ry={r * 0.6} fill={C.foam} style={{ animationDelay: `${-i * 0.17}s` }} />
      ))}
      <g fill="none" stroke={C.foam} stroke-width={0.9}>
        {[0, 1, 2].map((i) => (
          <ellipse key={i} class="fall-ring" cx={392} cy={63} rx={10} ry={3} style={{ animationDelay: `${-i * 0.8}s` }} />
        ))}
      </g>
    </g>
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
      data-weather={weather}
      ref={host}
      data-critters={JSON.stringify(CRITTERS)}
      data-grid={`${POND_W}x${POND_H}`}
      data-tip={`${pose.tip.x.toFixed(2)},${pose.tip.y.toFixed(2)}`}
      data-bend={pose.bend.toFixed(1)}
      style={{ '--pk': String(k) }}
    >
      <img class="pond-img" src="/assets/bg/fishing-pond.png" alt="" width={POND_W} height={POND_H} draggable={false} />
      <PondLife time={time} weather={weather} still={still} zone={phase === 'casting' || phase === 'wait' || phase === 'bite' || phase === 'reeling' ? FISHING_ZONE : null} avoid={avoid} />
      <svg class="pond-svg" viewBox={`0 0 ${POND_W} ${POND_H}`} aria-hidden="true">
        <Waterfall />
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
