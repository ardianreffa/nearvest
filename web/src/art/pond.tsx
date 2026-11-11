// The fishing pond scene at the top of the Fishing window (fishing.tsx, docs/PLAN-fishing.md).
//
// TEMPORARY backdrop drawn in code (PondBackdrop) until Ardian's ChatGPT pond image arrives: the
// image will replace PondBackdrop only; the overlay (rod, line, float, ripples, the bite "!", the
// catch jumping out) stays code and sits on top of whatever backdrop is used.
// Pixel art: its own palette (not UI tokens, CLAUDE.md Design system). Grid 160 x 90 game px,
// scaled up with crisp edges. With prefers-reduced-motion nothing bobs or flies (CSS).

import type { ComponentChildren } from 'preact';

/** Pond grid (game px). */
export const POND_W = 160;
export const POND_H = 90;
/** Where the float sits on the water, and the rod's tip. */
export const FLOAT_AT = { x: 104, y: 60 };
export const ROD_TIP = { x: 66, y: 22 };

const C = {
  sky: '#9fd8e8',
  skyHi: '#c4ecf2',
  cloud: '#fffaf0',
  volcano: '#7d8fa3',
  volcanoHi: '#9aabbc',
  bank: '#3f8f4f',
  bankDark: '#2e6e3c',
  palm: '#2e7d4f',
  trunk: '#7a5a3a',
  hut: '#a07a52',
  roof: '#6b4a2f',
  solar: '#22d3ee',
  holo: '#a8f1fb',
  water: '#2f8fa0',
  waterDeep: '#257585',
  waterHi: '#6cc3cf',
  lily: '#4caf6a',
  lilyDark: '#2e7d4f',
  flower: '#f6a6c1',
  reed: '#5f8f3f',
  dock: '#8a6239',
  dockDark: '#5e4026',
  post: "#4a321f",
  float: "#e5484d",
};

/** Stepped (pixel) rectangle helper. */
const R = ({ x, y, w, h, f, cls }: { x: number; y: number; w: number; h: number; f: string; cls?: string }) => <rect x={x} y={y} width={w} height={h} fill={f} class={cls} />;

function Palm({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <R x={x} y={y} w={1} h={10} f={C.trunk} />
      <R x={x - 4} y={y - 1} w={9} h={1} f={C.palm} />
      <R x={x - 5} y={y} w={3} h={1} f={C.palm} />
      <R x={x + 3} y={y} w={3} h={1} f={C.palm} />
      <R x={x - 2} y={y - 2} w={5} h={1} f={C.palm} />
      <R x={x - 6} y={y + 1} w={2} h={1} f={C.palm} />
      <R x={x + 5} y={y + 1} w={2} h={1} f={C.palm} />
    </g>
  );
}

/** The temporary code-drawn pond (replaced by the ChatGPT image later). */
export function PondBackdrop() {
  const lilies = [
    [20, 72],
    [128, 52],
    [142, 76],
    [70, 82],
  ];
  return (
    <g class="pond-bg">
      <R x={0} y={0} w={POND_W} h={34} f={C.sky} />
      <R x={0} y={0} w={POND_W} h={8} f={C.skyHi} />
      {/* clouds */}
      <R x={18} y={9} w={14} h={2} f={C.cloud} />
      <R x={22} y={7} w={7} h={2} f={C.cloud} />
      <R x={112} y={12} w={12} h={2} f={C.cloud} />
      <R x={115} y={10} w={5} h={2} f={C.cloud} />
      {/* Mount Tandur, far away */}
      {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
        <R key={i} x={120 - i * 3} y={14 + i * 2} w={8 + i * 6} h={2} f={i < 2 ? C.volcanoHi : C.volcano} />
      ))}
      {/* far bank */}
      <R x={0} y={32} w={POND_W} h={5} f={C.bank} />
      <R x={0} y={36} w={POND_W} h={2} f={C.bankDark} />
      <Palm x={12} y={23} />
      <Palm x={40} y={25} />
      <Palm x={146} y={22} />
      {/* bamboo hut with solar panels and a fish hologram */}
      <R x={80} y={26} w={18} h={8} f={C.hut} />
      <R x={78} y={23} w={22} h={3} f={C.roof} />
      <R x={82} y={21} w={14} h={2} f={C.solar} />
      <R x={87} y={28} w={4} h={6} f={C.roof} />
      <R x={101} y={20} w={6} h={4} f={C.holo} cls="pond-holo" />
      {/* water */}
      <R x={0} y={38} w={POND_W} h={52} f={C.water} />
      <R x={0} y={74} w={POND_W} h={16} f={C.waterDeep} />
      <g class="pond-ripples">
        {[
          [8, 44, 10],
          [60, 48, 8],
          [130, 44, 12],
          [36, 58, 9],
          [140, 64, 7],
          [94, 72, 10],
          [24, 84, 12],
          [118, 86, 9],
        ].map(([x, y, w]) => (
          <R key={`${x}-${y}`} x={x} y={y} w={w} h={1} f={C.waterHi} />
        ))}
      </g>
      {lilies.map(([x, y]) => (
        <g key={`${x}-${y}`}>
          <R x={x} y={y} w={7} h={2} f={C.lily} />
          <R x={x + 1} y={y + 2} w={5} h={1} f={C.lilyDark} />
          <R x={x + 3} y={y - 1} w={2} h={1} f={C.flower} />
        </g>
      ))}
      {/* reeds on the right */}
      {[148, 151, 154, 157].map((x, i) => (
        <R key={x} x={x} y={46 + (i % 2) * 3} w={1} h={24} f={C.reed} />
      ))}
      {/* the dock on the left */}
      <R x={0} y={60} w={40} h={4} f={C.dock} />
      <R x={0} y={64} w={40} h={1} f={C.dockDark} />
      {[4, 18, 32].map((x) => (
        <R key={x} x={x} y={65} w={3} h={12} f={C.post} />
      ))}
    </g>
  );
}

export type PondPhase = 'ready' | 'casting' | 'wait' | 'bite' | 'reeling' | 'result';

/**
 * The scene: backdrop + rod, line, float. `children` = HTML on top (TaniBot, "!" bubble, the catch),
 * placed with `pondAt` in percent of the scene.
 */
export function PondScene({ phase, children }: { phase: PondPhase; children?: ComponentChildren }) {
  const inWater = phase === 'wait' || phase === 'bite' || phase === 'reeling';
  const fx = FLOAT_AT.x;
  const fy = FLOAT_AT.y;
  return (
    <div class={`pond pond-${phase}`}>
      <svg class="pond-svg" viewBox={`0 0 ${POND_W} ${POND_H}`} shape-rendering="crispEdges" aria-hidden="true">
        <PondBackdrop />
        {/* the rod: from TaniBot's hands on the dock up to its tip */}
        <line class="pond-rod" x1={30} y1={54} x2={ROD_TIP.x} y2={ROD_TIP.y} stroke={C.dockDark} stroke-width={1.6} shape-rendering="auto" />
        {inWater ? (
          <>
            <line class="pond-line" x1={ROD_TIP.x} y1={ROD_TIP.y} x2={fx} y2={fy - 2} stroke={C.cloud} stroke-width={0.5} shape-rendering="auto" />
            <g class="pond-rings">
              <R x={fx - 6} y={fy + 2} w={13} h={1} f={C.waterHi} cls="ring ring-a" />
              <R x={fx - 9} y={fy + 3} w={19} h={1} f={C.waterHi} cls="ring ring-b" />
            </g>
            <g class="pond-float">
              <R x={fx} y={fy - 3} w={1} h={1} f={C.dockDark} />
              <R x={fx - 1} y={fy - 2} w={3} h={2} f={C.float} />
              <R x={fx - 1} y={fy} w={3} h={1} f={C.cloud} />
            </g>
          </>
        ) : (
          <line class="pond-line" x1={ROD_TIP.x} y1={ROD_TIP.y} x2={ROD_TIP.x + 1} y2={ROD_TIP.y + 12} stroke={C.cloud} stroke-width={0.5} shape-rendering="auto" />
        )}
      </svg>
      {children}
    </div>
  );
}

/** CSS position (percent of the scene) of a pond grid point. */
export const pondAt = (x: number, y: number) => ({ left: `${(x / POND_W) * 100}%`, top: `${(y / POND_H) * 100}%` });
