// The monorail train: three cars (locomotive, middle, rear) that follow the curved rail on their own, like a real
// articulated train. Nothing is rotated freely (that makes pixel art jagged): each car comes
// in a few pre-tilted pixel-art versions (0, 5, 10 and 15 degrees) made by shifting each pixel
// column up a whole number of pixels (a clean stair-step slope), and every car picks the
// version closest to the rail's slope where it is. Positions snap to the pixel grid.
// One run every 2 minutes, with a gentle start and stop (ease in and out).

import { useEffect, useRef, useState } from 'preact/hooks';
import { Pixels } from '../sprites';
import { TRAIN_CARS } from './train-sprite';

/** Top of the rail (where the wheels run), art px, from its left end to behind the palm. */
const RAIL: [number, number][] = [
  [123.5, 63.5],
  [145, 58.5],
  [165, 55],
  [185, 51.5],
  [200, 49],
  [215, 47.5],
  [228, 46.8],
];
/** The train shows only on the rail: from its left end to the palm on the right. */
export const TRAIN_CLIP = { x: 122, y: 28, w: 103, h: 40 };

const ANGLES = [0, 5, 10, 15];
const CYCLE_MS = 120_000;
const RUN_MS = 18_000;
const FIRST_RUN_MS = 15_000;

function railAt(x: number): { y: number; deg: number } {
  let i = 0;
  if (x >= RAIL[RAIL.length - 1][0]) i = RAIL.length - 2;
  else while (i < RAIL.length - 2 && RAIL[i + 1][0] < x) i++;
  const [x0, y0] = RAIL[i];
  const [x1, y1] = RAIL[i + 1];
  const slope = (y1 - y0) / (x1 - x0);
  return { y: y0 + slope * (x - x0), deg: (-Math.atan(slope) * 180) / Math.PI };
}

interface Tilted {
  rows: string[];
  /** Pixel row (from the top of the tilted sprite) of the car's bottom at its centre column. */
  base: number;
}

const tiltCache = new Map<string, Tilted>();

/** A car tilted up to the right by `deg`, in whole-pixel column steps. */
function tilt(rows: string[], deg: number, key: string): Tilted {
  const k = `${key}-${deg}`;
  const hit = tiltCache.get(k);
  if (hit) return hit;
  const h = rows.length;
  const w = rows[0].length;
  const t = Math.tan((deg * Math.PI) / 180);
  const shift = (c: number) => Math.round(c * t);
  const s = shift(w - 1);
  const out: string[] = [];
  for (let r = 0; r < h + s; r++) {
    let line = '';
    for (let c = 0; c < w; c++) {
      const src = r - (s - shift(c));
      line += src >= 0 && src < h ? rows[src][c] : '.';
    }
    out.push(line);
  }
  const res = { rows: out, base: h + s - shift(Math.floor(w / 2)) };
  tiltCache.set(k, res);
  return res;
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

/** Dev builds: window.__trainT = seconds into a run freezes the train there (screenshots). */
declare global {
  interface Window {
    __trainT?: number;
  }
}

/** Milliseconds into the current run, or null while no train is on the rail. */
function runTime(sinceMount: number): number | null {
  if (import.meta.env.DEV && typeof window !== 'undefined' && typeof window.__trainT === 'number') return window.__trainT * 1000;
  const t = sinceMount - FIRST_RUN_MS;
  if (t < 0) return null;
  const inCycle = t % CYCLE_MS;
  return inCycle < RUN_MS ? inCycle : null;
}

export function Train({ hd }: { hd: boolean }) {
  const [t, setT] = useState<number | null>(null);
  const mounted = useRef(performance.now());

  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let timer = 0;
    const tick = () => {
      const rt = runTime(performance.now() - mounted.current);
      setT(rt);
      if (rt !== null) raf = requestAnimationFrame(tick);
      // Between runs: check again in a second (no animation frames while the rail is empty).
      else timer = window.setTimeout(tick, 1000);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  if (t === null) return null;
  const res = hd ? 'hd' : 'sd';
  const day = TRAIN_CARS[`${res}_day`];
  const night = TRAIN_CARS[`${res}_night`];
  /** Pixels of the sprite per game pixel (hd sprites are twice as detailed). */
  const per = hd ? 2 : 1;
  const order = ['front', 'mid', 'rear'] as const;
  const lens = order.map((c) => day[c][0].length / per);
  const trainLen = lens.reduce((a, b) => a + b, 0);
  const start = TRAIN_CLIP.x - 1;
  const end = TRAIN_CLIP.x + TRAIN_CLIP.w + trainLen + 1;
  const head = start + (end - start) * ease(Math.min(1, t / RUN_MS));
  const snap = (v: number) => Math.round(v * per) / per;

  const cars = order.map((which, i) => {
    const centre = head - lens.slice(0, i).reduce((a, b) => a + b, 0) - lens[i] / 2;
    const { y, deg } = railAt(centre);
    const a = ANGLES.reduce((best, v) => (Math.abs(v - deg) < Math.abs(best - deg) ? v : best), 0);
    const d = tilt(day[which], a, `${res}-day-${which}`);
    const n = tilt(night[which], a, `${res}-night-${which}`);
    const w = d.rows[0].length / per;
    const h = d.rows.length / per;
    const left = snap(centre - w / 2) - TRAIN_CLIP.x;
    const top = snap(y - d.base / per) - TRAIN_CLIP.y;
    const box = {
      left: `${(left / TRAIN_CLIP.w) * 100}%`,
      top: `${(top / TRAIN_CLIP.h) * 100}%`,
      width: `${(w / TRAIN_CLIP.w) * 100}%`,
      height: `${(h / TRAIN_CLIP.h) * 100}%`,
    };
    return (
      <span key={which} class={`train-car car-${which}`} data-angle={a} style={box}>
        <Pixels rows={d.rows} palette={day.palette} scale={1} />
        <Pixels rows={n.rows} palette={night.palette} scale={1} class="train-night" />
      </span>
    );
  });
  return <>{cars}</>;
}
