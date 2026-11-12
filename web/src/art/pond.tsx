// The fishing pond scene at the top of the Fishing window (fishing.tsx, docs/PLAN-fishing.md).
//
// Backdrop: Ardian's ChatGPT pond, seen from ABOVE (docs/art-source/fishing-pond.png), pixelized to
// 480 x 270 (`/assets/bg/fishing-pond.png`, commands in docs/ASSETS.md; the four frogs redrawn
// crisp with tools/pixelize/frogs.py so they read on phones). On top, drawn in code in the same
// 480 x 270 grid and the same top-down view: TaniBot on the end of the dock, the rod, the line with a
// slight sag, the float seen from above (a red / white disc) with round ripples, the bite, a small
// waterfall animation (falling streaks + foam) and the catch popping up out of the water.
// Nothing ever covers the frogs or the ducks (CRITTERS; checked in tools/fishing-test.mjs).
// Overlay colours: pixel art, its own palette (CLAUDE.md Design system). With prefers-reduced-motion
// nothing moves (CSS).

import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/** Pond grid (image px). */
export const POND_W = 480;
export const POND_H = 270;
/** The float on the open water in the middle (well away from the frogs and the ducks). */
export const FLOAT_AT = { x: 250, y: 142 };
/** TaniBot's feet on the end of the dock, and the rod's tip over the water. */
export const BOT_AT = { x: 62, y: 130 };
export const ROD_TIP = { x: 122, y: 92 };
/** TaniBot's height in the pond grid (its sprite is scaled to it). */
const BOT_H = 58;

/** Frogs (on their lily pads) and ducks in the image: boxes [x, y, w, h] the overlay must stay clear of. */
export const CRITTERS: [number, number, number, number][] = [
  [141, 67, 15, 13],
  [300, 45, 15, 13],
  [439, 76, 15, 13],
  [99, 184, 15, 13],
  [427, 108, 24, 16],
  [404, 129, 24, 16],
  [441, 144, 24, 16],
];

const C = {
  rod: '#5e4026',
  line: '#fffaf0',
  floatRed: '#e5484d',
  floatWhite: '#fffaf0',
  floatDark: '#1b1b2f',
  ripple: '#a8f1fb',
  foam: '#fffaf0',
  fall: '#d9f8ff',
};

/** Streaks running down the waterfall and the foam at its foot (image grid). */
const FALL_STREAKS = [
  [388, 20],
  [393, 28],
  [398, 18],
  [402, 30],
  [416, 2],
  [421, 6],
];
const FOAM = [
  [384, 52, 3],
  [390, 55, 4],
  [397, 51, 3],
  [403, 56, 3],
  [393, 59, 2],
];

export type PondPhase = 'ready' | 'casting' | 'wait' | 'bite' | 'reeling' | 'result';

/**
 * The scene. `bot` = TaniBot (any element), placed on the dock and sized to the pond; `children` =
 * HTML on top (the "!" bubble, the catch), placed with `pondAt`.
 */
export function PondScene({ phase, bot, children }: { phase: PondPhase; bot?: ComponentChildren; children?: ComponentChildren }) {
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
  const inWater = phase === 'wait' || phase === 'bite' || phase === 'reeling';
  // Out of the water the float hangs just below the rod's tip.
  const f = inWater ? FLOAT_AT : { x: ROD_TIP.x + 2, y: ROD_TIP.y + 8 };
  const sag = inWater ? 14 : 2;
  const mid = { x: (ROD_TIP.x + f.x) / 2, y: (ROD_TIP.y + f.y) / 2 + sag };
  return (
    <div class={`pond pond-${phase}`} ref={host} data-critters={JSON.stringify(CRITTERS)} data-grid={`${POND_W}x${POND_H}`}>
      <img class="pond-img" src="/assets/bg/fishing-pond.png" alt="" width={POND_W} height={POND_H} draggable={false} />
      <svg class="pond-svg" viewBox={`0 0 ${POND_W} ${POND_H}`} aria-hidden="true">
        <g class="pond-fall" shape-rendering="crispEdges">
          {FALL_STREAKS.map(([x, y], i) => (
            <rect key={i} class="fall-streak" x={x} y={y} width={1} height={5} fill={C.fall} style={{ animationDelay: `${-i * 0.23}s` }} />
          ))}
          {FOAM.map(([x, y, w], i) => (
            <rect key={i} class="fall-foam" x={x} y={y} width={w} height={1} fill={C.foam} style={{ animationDelay: `${-i * 0.31}s` }} />
          ))}
        </g>
        {inWater && (
          <g class="pond-rings" fill="none" stroke={C.ripple} stroke-width={1}>
            <circle class="ring ring-a" cx={FLOAT_AT.x} cy={FLOAT_AT.y} r={6} />
            <circle class="ring ring-b" cx={FLOAT_AT.x} cy={FLOAT_AT.y} r={10} />
          </g>
        )}
        <path class="pond-line" d={`M${ROD_TIP.x} ${ROD_TIP.y} Q${mid.x} ${mid.y} ${f.x} ${f.y}`} fill="none" stroke={C.line} stroke-width={0.8} />
        <g class="pond-float" style={{ transformOrigin: `${f.x}px ${f.y}px` }} shape-rendering="crispEdges">
          {/* The float from above: a red cap with a white band and a dark tip. */}
          <rect x={f.x - 2} y={f.y - 3} width={4} height={6} fill={C.floatWhite} />
          <rect x={f.x - 3} y={f.y - 2} width={6} height={4} fill={C.floatWhite} />
          <rect x={f.x - 2} y={f.y - 2} width={4} height={3} fill={C.floatRed} />
          <rect x={f.x - 1} y={f.y - 1} width={2} height={1} fill={C.floatDark} />
        </g>
      </svg>
      {bot && (
        <div class="pond-bot" style={{ ...pondAt(BOT_AT.x, BOT_AT.y), '--bot-k': String((k * BOT_H) / 64) }}>
          {/* An own box for the size: TaniBot's idle animation sets its own transform. */}
          <div class="pond-bot-in">{bot}</div>
        </div>
      )}
      <svg class="pond-svg pond-rod-layer" viewBox={`0 0 ${POND_W} ${POND_H}`} aria-hidden="true">
        {/* The rod in front of TaniBot: from its hands out over the water. */}
        <line x1={BOT_AT.x + 12} y1={BOT_AT.y - 24} x2={ROD_TIP.x} y2={ROD_TIP.y} stroke={C.rod} stroke-width={2.2} stroke-linecap="square" />
      </svg>
      {children}
    </div>
  );
}

/** CSS position (percent of the scene) of a pond grid point. */
export const pondAt = (x: number, y: number) => ({ left: `${(x / POND_W) * 100}%`, top: `${(y / POND_H) * 100}%` });
