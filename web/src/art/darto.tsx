// Mr. Darto, the village fruit buyer of the future, and his hover cart.
// Official design from Ardian's ChatGPT image (see darto-sprite.ts and docs/ASSETS.md).
// Poses: idle (default), wave (when the Market opens), hold (when the player sells:
// he lifts the fruit that was sold; the durian is his original drawing, mango and
// rambutan are drawn in code into the same hand).
// The sparkle lines of the original image are a small code-drawn animation here.

import type { Species } from '../api';
import { Pixels } from '../sprites';
import { CART, CART_CORE, CART_JETS, DARTO_ANCHOR, DARTO_DURIAN, DARTO_IDLE, DARTO_PALETTE, DARTO_WAVE } from './darto-sprite';

export type DartoPose = 'idle' | 'wave' | 'hold';

// The durian in his raised hand: everything above the fingers in this box is fruit.
const FRUIT_BOX = { x0: 27, y0: 6, x1: 44, fingersY: 22, fingersX: 38 };

/** The holding pose with the durian removed (the hand stays). */
const DARTO_HAND = DARTO_DURIAN.map((row, y) =>
  [...row]
    .map((c, x) => {
      if (x < FRUIT_BOX.x0 || x >= FRUIT_BOX.x1 || y < FRUIT_BOX.y0) return c;
      if (y < FRUIT_BOX.fingersY) return '.';
      return y <= FRUIT_BOX.fingersY + 2 && x < FRUIT_BOX.fingersX ? '.' : c;
    })
    .join(''),
);

const HELD_FRUIT: Record<Exclude<Species, 'durian'>, { rows: string[]; x: number; y: number }> = {
  mango: {
    x: 29,
    y: 9,
    rows: [
      '......gg......',
      '.....gGgk.....',
      '....kkkkkk....',
      '..kkyyyyyyk...',
      '.kyyWyyyyyOk..',
      '.kyWyyyyyyOk..',
      'kyyyyyyyyyOOk.',
      'kyyyyyyyyOOOk.',
      'kyyyyyyyOOOOk.',
      '.kyyyyyOOOOk..',
      '.kOyyOOOOOk...',
      '..kOOOOOOk....',
      '...kkkkkk.....',
    ],
  },
  rambutan: {
    x: 28,
    y: 9,
    rows: [
      '..q..q..q.....',
      '...r.r.r..q...',
      '.qkkkkkkkr....',
      '..kRrrrrRrk.q.',
      'qkrWrrrrrrRk..',
      '.krWrrrrrrRkq.',
      'qkrrrrrrrRRk..',
      '.krrrrrrRRRkq.',
      'qkrrrrrRRRRk..',
      '.kRrrrRRRRk.q.',
      '..kRRRRRRk....',
      '.q.kkkkkk.q...',
    ],
  },
};
const FRUIT_PALETTE = { k: '#1B1B2F', y: '#FFD84A', O: '#F59E0B', W: '#FFF6C9', g: '#2E7D4F', G: '#5FC27A', r: '#EF4444', R: '#991B1B', q: '#A3C94A' };

const POSES = { idle: DARTO_IDLE, wave: DARTO_WAVE, hold: DARTO_DURIAN };
const BOX_W = DARTO_IDLE[0].length;
const BOX_H = Math.max(DARTO_IDLE.length, DARTO_WAVE.length, DARTO_DURIAN.length);

// Where the sparkle lines go (art pixels, relative to the pose sprite).
const SPARKLE: Partial<Record<DartoPose, { x: number; y: number; flip?: boolean }>> = {
  wave: { x: -2, y: 12 },
  hold: { x: 38, y: 2, flip: true },
};

function Sparkle({ x, y, flip, scale }: { x: number; y: number; flip?: boolean; scale: number }) {
  return (
    <svg
      class="darto-sparkle"
      viewBox="0 0 8 8"
      width={8 * scale}
      height={8 * scale}
      shape-rendering="crispEdges"
      style={{ left: x * scale, top: y * scale, transform: flip ? 'scaleX(-1)' : undefined }}
      aria-hidden="true"
    >
      <g fill="#F5C542">
        <rect x={3} y={0} width={1} height={3} />
        <rect x={0} y={2} width={1} height={1} />
        <rect x={1} y={3} width={1} height={1} />
        <rect x={5} y={4} width={3} height={1} />
        <rect x={6} y={1} width={1} height={1} />
        <rect x={5} y={2} width={1} height={1} />
      </g>
    </svg>
  );
}

const ANCHOR = { idle: DARTO_ANCHOR.idle, wave: DARTO_ANCHOR.wave, hold: DARTO_ANCHOR.durian };

export function DartoFigure({ pose = 'idle', fruit = 'durian', scale = 2 }: { pose?: DartoPose; fruit?: Species; scale?: number }) {
  const held = pose === 'hold' && fruit !== 'durian' ? HELD_FRUIT[fruit] : null;
  const rows = held ? DARTO_HAND : POSES[pose];
  const left = Math.round(ANCHOR.idle - ANCHOR[pose]);
  const sparkle = SPARKLE[pose];
  return (
    <div class={`darto-figure pose-${pose}`} style={{ width: BOX_W * scale, height: BOX_H * scale }}>
      <div class="darto-pose" key={pose} style={{ left: left * scale, bottom: 0, width: rows[0].length * scale, height: rows.length * scale }}>
        <Pixels rows={rows} palette={DARTO_PALETTE} scale={scale} title="Mr. Darto" />
        {held && (
          <Pixels
            rows={held.rows}
            palette={FRUIT_PALETTE}
            scale={scale}
            class="darto-fruit"
            style={{ left: held.x * scale, top: held.y * scale }}
          />
        )}
        {sparkle && <Sparkle {...sparkle} scale={scale} />}
      </div>
    </div>
  );
}

export function HoverCart({ scale = 2 }: { scale?: number }) {
  return (
    <div class="hover-cart" style={{ width: CART[0].length * scale, height: CART.length * scale }}>
      <Pixels rows={CART} palette={DARTO_PALETTE} scale={scale} title="Mr. Darto's hover cart" />
      <Pixels rows={CART_CORE} palette={DARTO_PALETTE} scale={scale} class="cart-core" />
      <Pixels rows={CART_JETS} palette={DARTO_PALETTE} scale={scale} class="cart-jets" />
    </div>
  );
}

/** Mr. Darto's head (top rows of the idle pose), for small reactions. */
const FACE_ROWS = DARTO_IDLE.slice(0, 30);
export function DartoFace({ scale = 1 }: { scale?: number }) {
  return <Pixels rows={FACE_ROWS} palette={DARTO_PALETTE} scale={scale} title="Mr. Darto" />;
}
