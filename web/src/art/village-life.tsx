// Small signs of life in the v2 village (in the backdrop, never clickable):
//   Mr. Darto in front of his fruit stand: the Market's own sprite, shrunk to the village's
//   pixel size, standing idle and now and then waving;
//   a little round robot near the Friends house (cut from the first village image with
//   tools/pixelize/cutout.py and cleaned by hand): it floats, blinks and waves now and then.
//   v2: at night it drifts home to the house's door and dims. v3 (`robot.stay`): Ardian's ChatGPT
//   robot (robot-sprite.ts) stays in front of the Friends house day and night, hovering, blinking,
//   its antenna orb glowing.
// Both stand still with prefers-reduced-motion. Sizes are image pixels (half a game pixel).

import { Pixels } from '../sprites';
import { DARTO_ANCHOR, DARTO_IDLE, DARTO_PALETTE, DARTO_WAVE } from './darto-sprite';
import { ROBOT_V3, ROBOT_V3_EYES, ROBOT_V3_ORB, ROBOT_V3_PALETTE, ROBOT_V3_PER } from './robot-sprite';
import { boxIn, type Village } from './village';

const shrinkCache = new Map<string, string[]>();

/** A sprite made `f` times smaller: each block takes its most common colour (or stays empty). */
export function shrink(rows: string[], f: number, key: string): string[] {
  const hit = shrinkCache.get(`${key}-${f}`);
  if (hit) return hit;
  const h = Math.ceil(rows.length / f);
  const w = Math.ceil(Math.max(...rows.map((r) => r.length)) / f);
  const out: string[] = [];
  for (let by = 0; by < h; by++) {
    let line = '';
    for (let bx = 0; bx < w; bx++) {
      const count = new Map<string, number>();
      let filled = 0;
      for (let y = by * f; y < Math.min(rows.length, (by + 1) * f); y++) {
        for (let x = bx * f; x < (bx + 1) * f; x++) {
          const c = rows[y][x];
          if (!c || c === '.') continue;
          filled++;
          count.set(c, (count.get(c) ?? 0) + 1);
        }
      }
      if (filled * 2.5 < f * f) {
        line += '.';
        continue;
      }
      line += [...count.entries()].sort((a, b) => b[1] - a[1])[0][0];
    }
    out.push(line);
  }
  shrinkCache.set(`${key}-${f}`, out);
  return out;
}

/** Mr. Darto, small, in front of his stand: idle, with a short wave every few seconds. */
export function VillageDarto({ v }: { v: Village }) {
  if (!v.darto) return null;
  const { x, y, shrink: f } = v.darto;
  const idle = shrink(DARTO_IDLE, f, 'idle');
  const wave = shrink(DARTO_WAVE, f, 'wave');
  // Image pixels -> game pixels (the images are twice as detailed).
  const w = idle[0].length / 2;
  const h = idle.length / 2;
  const waveW = wave[0].length / 2;
  const waveH = wave.length / 2;
  const waveLeft = (DARTO_ANCHOR.idle - DARTO_ANCHOR.wave) / f / 2;
  return (
    <div class="village-darto" style={boxIn(v, x - w / 2, y - h, w, h)} aria-hidden="true">
      <Pixels rows={idle} palette={DARTO_PALETTE} scale={1} class="vd-idle" />
      <Pixels
        rows={wave}
        palette={DARTO_PALETTE}
        scale={1}
        class="vd-wave"
        style={{ left: `${(waveLeft / w) * 100}%`, width: `${(waveW / w) * 100}%`, height: `${(waveH / h) * 100}%`, bottom: 0 }}
      />
    </div>
  );
}

const ROBOT = [
  '....aaaaa....',
  '..aagggggfa..',
  '.agggggggffa.',
  '.aggggggggfa.',
  'aaaaaaaaaaaaa',
  'aaakaaaaakaaa',
  'aaakaaaaakaaa',
  '.aaaaaaaaaaa.',
  '.ahhhfffhhha.',
  '..aiiiiiiia..',
];
const ROBOT_SHUT = ['.............', '.............', '.............', '.............', '.............', '...a.....a...'];
const ARM_UP = ['.h', 'hh', 'h.'];
const ARM_DOWN = ['..', 'h.', 'hh'];
const JETS = ['....l...l....'];
const ROBOT_PAL = { a: '#0B1620', g: '#F2F2EC', f: '#B3CCD5', h: '#89A8B2', i: '#5E90A8', k: '#22D3EE', l: '#69BDCF' };

/** The little robot near the Friends house. */
export function VillageRobot({ v }: { v: Village }) {
  if (!v.robot) return null;
  const { x, y, homeX, stay } = v.robot;
  if (stay) {
    // v3: Ardian's ChatGPT robot (robot-sprite.ts). It stays in front of the Friends house day and
    // night: hovers gently, blinks, its antenna orb glows (brighter at night).
    const w = ROBOT_V3[0].length / ROBOT_V3_PER;
    const h = ROBOT_V3.length / ROBOT_V3_PER;
    return (
      <div class="village-robot stay v3" style={boxIn(v, x - w / 2, y - h, w, h)} aria-hidden="true">
        <div class="vr-body">
          <Pixels rows={ROBOT_V3} palette={ROBOT_V3_PALETTE} scale={1} class="vr-v3" />
          <Pixels rows={ROBOT_V3_EYES} palette={ROBOT_V3_PALETTE} scale={1} class="vr-v3 vr-eyes" />
          <Pixels rows={ROBOT_V3_ORB} palette={ROBOT_V3_PALETTE} scale={1} class="vr-v3 vr-orb" />
        </div>
        <i class="vr-shadow" />
      </div>
    );
  }
  const w = ROBOT[0].length / 2;
  const h = (ROBOT.length + 1) / 2;
  const cell = (n: number, of: number) => `${(n / of) * 100}%`;
  return (
    <div class={`village-robot${stay ? ' stay' : ''}`} style={{ ...boxIn(v, x - w / 2, y - h, w, h), '--home-dx': `${((homeX - x) / w) * 100}%` }} aria-hidden="true">
      <div class="vr-body">
        <Pixels rows={ROBOT} palette={ROBOT_PAL} scale={1} class="vr-main" style={{ height: cell(ROBOT.length, ROBOT.length + 1) }} />
        <Pixels rows={ROBOT_SHUT} palette={ROBOT_PAL} scale={1} class="vr-shut" style={{ height: cell(ROBOT_SHUT.length, ROBOT.length + 1) }} />
        <Pixels rows={JETS} palette={ROBOT_PAL} scale={1} class="vr-jets" style={{ top: cell(ROBOT.length, ROBOT.length + 1), height: cell(1, ROBOT.length + 1) }} />
        <span class="vr-arm" style={{ left: '100%', top: cell(3, ROBOT.length + 1), width: cell(2, ROBOT[0].length), height: cell(3, ROBOT.length + 1) }}>
          <Pixels rows={ARM_DOWN} palette={ROBOT_PAL} scale={1} class="vr-arm-down" />
          <Pixels rows={ARM_UP} palette={ROBOT_PAL} scale={1} class="vr-arm-up" />
        </span>
      </div>
    </div>
  );
}
