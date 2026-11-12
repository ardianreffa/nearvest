// The pond's pictures drawn GPU-friendly (Fishing package 7c, Ardian's full-screen Retina rain
// glitch): screen-sized canvases instead of upscaled <img> layers, and a tiny stretched canvas instead
// of CSS blur for the soft copy around a fitted pond. Used by the Fishing window and (2026-11-12) the
// sign-in page's pond (login-pond.tsx).

import { useEffect, useRef } from 'preact/hooks';
import { token } from '../tokens';
import type { PondLayout } from './pond-layouts';

/**
 * The laptop pond's day / dusk / night pictures (package 7c): each one a canvas exactly as big as the
 * visible part of the pond (the screen), in device pixels, drawn once with whole picture pixels (no
 * smoothing) and redrawn only when the screen size changes. Ardian's full-screen Retina laptop
 * dropped GPU tiles of the upscaled 4156 x 2338 px picture layer in the rain (the top band went
 * blank); a canvas is one texture, the same size as the screen, and is never re-rastered.
 */
export function PondPictures({ L, fit, mix }: { L: PondLayout; fit: { left: number; top: number; w: number; h: number }; mix: { dusk: number; night: number } }) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const x0 = Math.max(0, fit.left);
  const y0 = Math.max(0, fit.top);
  const rect: [number, number, number, number] = [x0, y0, Math.min(W, fit.left + fit.w) - x0, Math.min(H, fit.top + fit.h) - y0];
  return (
    <>
      {(['day', 'dusk', 'night'] as const).map((t) => (
        <PictureCanvas key={t} name={t} src={L.pics[t]} rect={rect} fit={fit} opacity={t === 'day' ? 1 : t === 'dusk' ? mix.dusk : mix.night} />
      ))}
    </>
  );
}

function PictureCanvas({
  name,
  src,
  rect,
  fit,
  opacity,
}: {
  name: string;
  src: string;
  rect: [number, number, number, number];
  fit: { left: number; top: number; w: number; h: number };
  opacity: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [x, y, w, h] = rect;
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.src = src;
    img
      .decode()
      .then(() => {
        const c = ref.current;
        if (!live || !c) return;
        const dpr = window.devicePixelRatio || 1;
        c.width = Math.max(1, Math.round(w * dpr));
        c.height = Math.max(1, Math.round(h * dpr));
        const g = c.getContext('2d');
        if (!g) return;
        g.imageSmoothingEnabled = false;
        const s = img.naturalWidth / fit.w;
        g.drawImage(img, (x - fit.left) * s, (y - fit.top) * s, w * s, h * s, 0, 0, c.width, c.height);
        c.dataset.ready = '1';
      })
      .catch(() => undefined);
    return () => void (live = false);
  }, [src, x, y, w, h, fit.left, fit.top, fit.w]);
  return <canvas ref={ref} class={`pond-pic pond-pic-${name} pond-fade`} style={{ left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px`, opacity, visibility: opacity > 0 ? 'visible' : 'hidden' }} aria-hidden="true" />;
}

/**
 * The soft copy of the pond around it (package 7c): the picture drawn to cover the screen in a canvas
 * 12 times smaller than the screen and a little darker; the browser stretches it smoothly, so it
 * looks blurred without any filter (one tiny texture).
 */
export function BackfillCanvas({ name, src, opacity }: { name: string; src: string; opacity: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const W = window.innerWidth;
  const H = window.innerHeight;
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.src = src;
    img
      .decode()
      .then(() => {
        const c = ref.current;
        if (!live || !c) return;
        c.width = Math.max(2, Math.ceil(W / 12));
        c.height = Math.max(2, Math.ceil(H / 12));
        const g = c.getContext('2d');
        if (!g) return;
        const k = Math.max(c.width / img.naturalWidth, c.height / img.naturalHeight);
        const dw = img.naturalWidth * k;
        const dh = img.naturalHeight * k;
        g.imageSmoothingEnabled = true;
        g.drawImage(img, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh);
        g.globalAlpha = 0.35;
        g.fillStyle = token('--ink');
        g.fillRect(0, 0, c.width, c.height);
        c.dataset.ready = '1';
      })
      .catch(() => undefined);
    return () => void (live = false);
  }, [src, W, H]);
  return <canvas ref={ref} class={`pond-backfill pond-backfill-${name} pond-fade`} style={{ opacity, visibility: opacity > 0 ? 'visible' : 'hidden' }} aria-hidden="true" />;
}

