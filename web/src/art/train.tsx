// The monorail train: three cars (locomotive, middle, rear) that follow the rail on their own,
// like a real articulated train. Nothing is rotated freely (that makes pixel art jagged): each
// car comes in a few pre-tilted pixel-art versions (0, 5, 10 and 15 degrees) made by shifting
// each pixel column up a whole number of pixels (a clean stair-step slope), and every car picks
// the version closest to the rail's slope where it is. Positions snap to the pixel grid.
// One run every 2 minutes, with a gentle start and stop (ease in and out).
// The first village (v1): left to right at one size. The v2 village: the train comes in from
// the right edge, gets a little smaller as it rolls away toward the middle (perspective) and
// fades out at the end of the rail; the next run comes from the right again.

import { useEffect, useRef, useState } from 'preact/hooks';
import { Pixels } from '../sprites';
import { TRAIN_CARS } from './train-sprite';
import type { Rail } from './village';

const ANGLES = [0, 5, 10, 15];
const CYCLE_MS = 120_000;
const RUN_MS = 18_000;
const FIRST_RUN_MS = 15_000;
/** v2: size at the far end of the rail, and the part of the rail where the train fades out. */
const FAR_SIZE = 0.6;
const FADE_FROM = 0.78;

function railAt(rail: [number, number][], x: number): { y: number; deg: number } {
  let i = 0;
  if (x >= rail[rail.length - 1][0]) i = rail.length - 2;
  else while (i < rail.length - 2 && rail[i + 1][0] < x) i++;
  const [x0, y0] = rail[i];
  const [x1, y1] = rail[i + 1];
  const slope = (y1 - y0) / (x1 - x0);
  return { y: y0 + slope * (x - x0), deg: (-Math.atan(slope) * 180) / Math.PI };
}

interface Tilted {
  rows: string[];
  /** Pixel row (from the top of the tilted sprite) of the car's bottom at its centre column. */
  base: number;
}

const tiltCache = new Map<string, Tilted>();

/** A car tilted up to the right by `deg`, in whole-pixel column steps (optionally mirrored first). */
function tilt(source: string[], deg: number, key: string, mirror = false): Tilted {
  const k = `${key}-${deg}-${mirror ? 'm' : ''}`;
  const hit = tiltCache.get(k);
  if (hit) return hit;
  const rows = mirror ? source.map((r) => [...r].reverse().join('')) : source;
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
function runTime(sinceMount: number, run = RUN_MS): number | null {
  if (import.meta.env.DEV && typeof window !== 'undefined' && typeof window.__trainT === 'number') return window.__trainT * 1000;
  const t = sinceMount - FIRST_RUN_MS;
  if (t < 0) return null;
  const inCycle = t % CYCLE_MS;
  return inCycle < run ? inCycle : null;
}

export function Train({ hd, rail }: { hd: boolean; rail: Rail }) {
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
  const clip = rail.clip;
  const res = hd ? 'hd' : 'sd';
  const day = TRAIN_CARS[`${res}_day`];
  const night = TRAIN_CARS[`${res}_night`];
  /** Pixels of the sprite per game pixel (hd sprites are twice as detailed). */
  const per = hd ? 2 : 1;
  const order = ['front', 'mid', 'rear'] as const;
  const lens = order.map((c) => day[c][0].length / per);
  const trainLen = lens.reduce((a, b) => a + b, 0);
  const u = ease(Math.min(1, t / RUN_MS));
  const leftward = rail.toward === 'left';
  const railStart = rail.points[0][0];
  const railEnd = rail.points[rail.points.length - 1][0];
  const snap = (v: number) => Math.round(v * per) / per;

  // v1: the head runs from the left edge of the clip until the whole train has left on the right.
  // v2: the head runs from just outside the right edge until the last car has faded out at the
  // far end of the rail.
  const leftEnd = railStart - trainLen * FAR_SIZE - 1;
  const head = leftward ? clip.x + clip.w + 1 - (clip.x + clip.w + 1 - leftEnd) * u : clip.x - 1 + (clip.w + trainLen + 2) * u;

  const cars = order.map((which, i) => {
    // How far along the rail (0 = near end, 1 = far end) and the size there.
    const along = leftward ? (railEnd - Math.max(head, railStart)) / (railEnd - railStart) : 0;
    const size = leftward ? 1 - (1 - FAR_SIZE) * Math.min(1, Math.max(0, along)) : 1;
    const behind = lens.slice(0, i).reduce((a, b) => a + b, 0) * size;
    const centre = leftward ? head + behind + (lens[i] * size) / 2 : head - behind - lens[i] / 2;
    const { y, deg } = railAt(rail.points, centre);
    const a = ANGLES.reduce((best, v) => (Math.abs(v - deg) < Math.abs(best - deg) ? v : best), 0);
    const d = tilt(day[which], a, `${res}-day-${which}`, leftward);
    const n = tilt(night[which], a, `${res}-night-${which}`, leftward);
    const w = (d.rows[0].length / per) * size;
    const h = (d.rows.length / per) * size;
    const left = snap(centre - w / 2) - clip.x;
    const top = snap(y - (d.base / per) * size) - clip.y;
    // v2: fades out over the last part of the rail (by where this car is).
    const carAlong = leftward ? (railEnd - centre) / (railEnd - railStart) : 0;
    const fade = leftward ? Math.min(1, Math.max(0, (1 - carAlong) / (1 - FADE_FROM))) : 1;
    const box = {
      left: `${(left / clip.w) * 100}%`,
      top: `${(top / clip.h) * 100}%`,
      width: `${(w / clip.w) * 100}%`,
      height: `${(h / clip.h) * 100}%`,
      opacity: fade < 1 ? fade.toFixed(2) : undefined,
    };
    if (fade <= 0) return null;
    return (
      <span key={which} class={`train-car car-${which}`} data-angle={a} style={box}>
        <Pixels rows={d.rows} palette={day.palette} scale={1} />
        <Pixels rows={n.rows} palette={night.palette} scale={1} class="train-night" />
      </span>
    );
  });
  return <>{cars}</>;
}

/**
 * v3: the ChatGPT train (docs/art-source/train-slope.png -> /assets/bg/train-slope.png, 244x83,
 * 3 image pixels per game pixel), drawn already leaning at the rail's slope (tools/pixelize/trim.py
 * --slope 0.246). It is never rotated and never faded: it comes in big from the right edge and
 * gets smaller step by step as it rolls away toward the far end of the rail (perspective), slowing
 * down like a real train in the distance; once it is tiny at the end of the rail it is gone. Its
 * bottom edge always sits on the rail. Sizes change in small steps and the width snaps to whole
 * screen pixels, drawn with sharp (pixelated) scaling, so it never looks blurry. One run every 2 min.
 */
const SLOPE_TRAIN = { src: '/assets/bg/train-slope.png', w: 244, h: 83, per: 3, bottomAtLeft: 82.4 };
const SLOPE_RUN_MS = 22_000;
import { SLOPE_GONE, slopeTrainAt } from './train-path';

export function SlopeTrain({ rail }: { rail: Rail }) {
  const [t, setT] = useState<number | null>(null);
  const mounted = useRef(performance.now());
  const box = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let raf = 0;
    let timer = 0;
    const tick = () => {
      const rt = runTime(performance.now() - mounted.current, SLOPE_RUN_MS);
      setT(rt);
      if (rt !== null) raf = requestAnimationFrame(tick);
      else timer = window.setTimeout(tick, 1000);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timer);
    };
  }, []);

  if (t === null) return null;
  const clip = rail.clip;
  const S = SLOPE_TRAIN;
  const farX = rail.points[0][0];
  const nearX = clip.x + clip.w + 1;
  const { left, size } = slopeTrainAt(t / SLOPE_RUN_MS, nearX, farX);
  if (size < SLOPE_GONE) return null;
  const w = (S.w / S.per) * size;
  const h = (S.h / S.per) * size;
  // Whole screen pixels for the width (sharp edges); the height follows the image's shape.
  const pxPerGame = box.current ? box.current.getBoundingClientRect().width / clip.w : 0;
  const wPx = pxPerGame ? Math.max(1, Math.round(w * pxPerGame)) : 0;
  const top = railAt(rail.points, left).y - (S.bottomAtLeft / S.per) * size;
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  return (
    <span class="slope-train-box" ref={box}>
      <img
        class="slope-train"
        data-size={size.toFixed(2)}
        src={S.src}
        alt=""
        draggable={false}
        style={{
          left: pct(left - clip.x, clip.w),
          top: pct(top - clip.y, clip.h),
          width: wPx ? `${wPx}px` : pct(w, clip.w),
          height: wPx ? `${Math.round((wPx * S.h) / S.w)}px` : pct(h, clip.h),
        }}
      />
    </span>
  );
}
