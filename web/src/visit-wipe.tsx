// The pixel-leaf wipe between gardens (Ardian 2026-11-11; rules and timing in visit-wipe-plan.ts).
// One <canvas> over the whole screen: green pixel squares (leaf / mint tokens) sweep in until the
// screen is covered, "VISITING BUDI’S GARDEN" (or "BACK TO MY GARDEN") shows in the middle, the swap
// happens under the cover (and waits for the friend's garden to load), then the squares leave in
// the same order. Squares sit on whole device pixels (sharp, never blurred); each frame only paints
// the squares that changed, so it stays light on phones. Reduced motion: a short fade, no squares.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { playWhoosh } from './audio';
import { token } from './tokens';
import {
  cellsBy,
  easeOut,
  seededRandom,
  WIPE_COLORS,
  WIPE_COVER_MS,
  WIPE_FADE_MS,
  WIPE_HOLD_MS,
  WIPE_REVEAL_MS,
  WIPE_WAIT_MAX_MS,
  wipeCellPx,
  wipeCells,
} from './visit-wipe-plan';

interface Job {
  id: number;
  label: string;
  /** Runs under the cover; the wipe opens when it settles (at most WIPE_WAIT_MAX_MS). */
  swap: () => unknown;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The wipe and a function to run one: `run(label, swap)`. A second run while one plays just swaps. */
export function useVisitWipe() {
  const [job, setJob] = useState<Job | null>(null);
  const busy = useRef(false);
  const run = useCallback((label: string, swap: () => unknown) => {
    if (busy.current) {
      void swap();
      return;
    }
    busy.current = true;
    setJob({ id: Date.now(), label, swap });
  }, []);
  const done = useCallback(() => {
    busy.current = false;
    setJob(null);
  }, []);
  return { node: job ? <PixelWipe key={job.id} job={job} onDone={done} /> : null, run, active: !!job };
}

function PixelWipe({ job, onDone }: { job: Job; onDone: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [text, setText] = useState(false);
  const reduced = useRef(reducedMotion());

  useEffect(() => {
    const cv = canvas.current!;
    const box = root.current!;
    const dpr = Math.max(1, Math.round(window.devicePixelRatio || 1));
    const W = window.innerWidth;
    const H = window.innerHeight;
    cv.width = W * dpr;
    cv.height = H * dpr;
    const g = cv.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    // One square = a whole number of device pixels.
    const cell = wipeCellPx(W) * dpr;
    const cols = Math.ceil(cv.width / cell);
    const rows = Math.ceil(cv.height / cell);
    const cells = wipeCells(cols, rows, seededRandom(job.id));
    const colors = WIPE_COLORS.map((c) => token(c.token));
    const fadeMs = WIPE_FADE_MS;

    let raf = 0;
    let alive = true;
    let phase: 'cover' | 'hold' | 'reveal' = 'cover';
    let phaseAt = performance.now();
    let drawn = 0;
    let settled = false;
    let textOn = false;
    const showText = (on: boolean) => {
      if (on !== textOn) setText((textOn = on));
    };
    if (reduced.current) {
      g.fillStyle = colors[0];
      g.fillRect(0, 0, cv.width, cv.height);
      box.style.opacity = '0';
    } else playWhoosh();

    const startSwap = () => {
      let r: unknown;
      try {
        r = job.swap();
      } catch {
        r = undefined;
      }
      const wait = Promise.race([Promise.resolve(r), new Promise((ok) => setTimeout(ok, WIPE_WAIT_MAX_MS))]);
      wait.then(
        () => (settled = true),
        () => (settled = true),
      );
    };

    const frame = (now: number) => {
      if (!alive) return;
      const el = now - phaseAt;
      // Dev builds only (browser screenshots): window.__wipeFreeze = { phase, p } holds the wipe there.
      const fz = import.meta.env.DEV ? (window as unknown as { __wipeFreeze?: { phase: string; p?: number } }).__wipeFreeze : undefined;
      if (phase === 'cover') {
        const p = fz?.phase === 'cover' ? (fz.p ?? 0.5) : reduced.current ? el / fadeMs : easeOut(el / WIPE_COVER_MS);
        if (reduced.current) box.style.opacity = String(Math.min(1, p));
        else {
          const n = cellsBy(cells, p);
          for (; drawn < n; drawn++) {
            const c = cells[drawn];
            g.fillStyle = colors[c.color];
            g.fillRect(c.col * cell, c.row * cell, cell, cell);
          }
        }
        showText(p >= 0.6);
        if (p >= 1 && fz?.phase !== 'cover') {
          phase = 'hold';
          phaseAt = now;
          startSwap();
        }
      } else if (phase === 'hold') {
        if (settled && el >= (reduced.current ? 60 : WIPE_HOLD_MS) && fz?.phase !== 'hold') {
          phase = 'reveal';
          phaseAt = now;
          drawn = 0;
          if (!reduced.current) playWhoosh(true);
        }
      } else {
        const p = fz?.phase === 'reveal' ? (fz.p ?? 0.5) : reduced.current ? el / fadeMs : easeOut(el / WIPE_REVEAL_MS);
        if (reduced.current) box.style.opacity = String(Math.max(0, 1 - p));
        else {
          const n = cellsBy(cells, p);
          for (; drawn < n; drawn++) {
            const c = cells[drawn];
            g.clearRect(c.col * cell, c.row * cell, cell, cell);
          }
        }
        showText(p < 0.4);
        if (p >= 1 && fz?.phase !== 'reveal') {
          alive = false;
          onDone();
          return;
        }
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={root} class={`visit-wipe${reduced.current ? ' reduced' : ''}`} role="status" aria-live="polite">
      <canvas ref={canvas} class="visit-wipe-canvas" aria-hidden="true" />
      <div class={`visit-wipe-text${text ? ' on' : ''}`}>{job.label}</div>
    </div>
  );
}
