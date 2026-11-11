// The duel's background (Arena v2, Ardian 2026-11-11): the Tandur Arena, Ardian's ChatGPT images
// (docs/art-source/arena-*.png, converted with tools/pixelize, docs/ASSETS.md): the stone arena floor
// with its green ring, bamboo gate, lanterns and neon, the Arena building and Gunung Tandur behind.
// Day / dusk / night cross-fade from the same village clock as the garden. Small code animations on
// top: the volcano's smoke drifts, lanterns and neon glow softly, the ring pulses, the lava glows at
// night. Reduced motion: all still. The picture is scaled so the ring's middle row lies on the
// TaniBots' feet line (they stand left and right of the ring) and always covers the whole stage.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { skyMix } from './backdrop';

type Box = [number, number, number, number]; // x, y, w, h in image pixels

/** One arena picture: its size and the places the animations sit on (measured on arena-*-day.png). */
export interface ArenaArt {
  key: 'web' | 'phone';
  w: number;
  h: number;
  src: (light: 'day' | 'dusk' | 'night') => string;
  /** The ring's middle: the TaniBots' feet stand on this row. */
  ring: { cx: number; cy: number; rx: number; ry: number };
  crater: [number, number];
  lava: Box;
  lanterns: Box[];
  neon: Box[];
}

export const ARENA_WEB: ArenaArt = {
  key: 'web',
  w: 480,
  h: 270,
  src: (light) => `/assets/bg/arena-web-${light}.png`,
  ring: { cx: 240, cy: 206, rx: 158, ry: 16 },
  crater: [233, 37],
  lava: [200, 38, 71, 31],
  lanterns: [
    [56, 45, 39, 54],
    [387, 45, 36, 55],
  ],
  neon: [
    [51, 154, 10, 15],
    [143, 159, 10, 10],
    [327, 158, 11, 11],
    [420, 154, 9, 15],
  ],
};

export const ARENA_PHONE: ArenaArt = {
  key: 'phone',
  w: 480,
  h: 720,
  src: (light) => `/assets/bg/arena-phone-${light}.png`,
  ring: { cx: 240, cy: 465, rx: 210, ry: 38 },
  crater: [241, 134],
  lava: [181, 136, 128, 61],
  lanterns: [
    [45, 122, 47, 78],
    [390, 120, 49, 80],
  ],
  neon: [
    [47, 347, 14, 32],
    [131, 357, 18, 22],
    [330, 355, 19, 29],
    [423, 347, 15, 32],
  ],
};

/**
 * Scale and offset of the picture for a stage of w x h CSS px whose feet line is `feet` px from the
 * stage's top: the ring's middle row on the feet line, the picture covers the stage, centred.
 */
export function arenaFit(art: ArenaArt, w: number, h: number, feet: number) {
  const k = Math.max(w / art.w, feet / art.ring.cy, h / art.h);
  return { k, left: (w - art.w * k) / 2, top: feet - art.ring.cy * k };
}

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const place = (art: ArenaArt, [x, y, w, h]: Box) => ({ left: pct(x, art.w), top: pct(y, art.h), width: pct(w, art.w), height: pct(h, art.h) });

export function DuelBackdrop({ fraction, wide }: { fraction: number; wide: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; feet: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const measure = () => {
      // The TaniBots stand 6 px above the bottom of the fight floor (.fighter { bottom: 6px }).
      const floor = stage.querySelector('.fight-floor');
      const s = el.getBoundingClientRect();
      const feet = floor ? floor.getBoundingClientRect().bottom - 6 - s.top : s.height * 0.85;
      setSize((o) => (o && o.w === s.width && o.h === s.height && o.feet === feet ? o : { w: s.width, h: s.height, feet }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const art = wide ? ARENA_WEB : ARENA_PHONE;
  const fit = size ? arenaFit(art, size.w, size.h, size.feet) : null;
  const { night, dusk } = skyMix(fraction);
  const r = art.ring;
  return (
    <div class={`duel-bg arena-${art.key}`} ref={ref} aria-hidden="true" style={{ '--night': night.toFixed(3), '--dusk': dusk.toFixed(3) }}>
      {fit && (
        <div class="arena-art" style={{ left: `${fit.left}px`, top: `${fit.top}px`, width: `${art.w * fit.k}px`, height: `${art.h * fit.k}px` }}>
          <img class="arena-img" src={art.src('day')} alt="" />
          <img class="arena-img arena-dusk" src={art.src('dusk')} alt="" />
          <img class="arena-img arena-night" src={art.src('night')} alt="" />
          <i class="arena-lava" style={place(art, art.lava)} />
          {[0, 1, 2, 3].map((i) => (
            <i key={`p${i}`} class="arena-puff" style={{ left: pct(art.crater[0], art.w), top: pct(art.crater[1], art.h), animationDelay: `${i * 1.6}s` }} />
          ))}
          {art.lanterns.map((b, i) => (
            <i key={`l${i}`} class="arena-lamp" style={{ ...place(art, b), animationDelay: `${i * 0.9}s` }} />
          ))}
          {art.neon.map((b, i) => (
            <i key={`n${i}`} class="arena-neon" style={{ ...place(art, b), animationDelay: `${i * 0.55}s` }} />
          ))}
          <i class="arena-ring" style={place(art, [r.cx - r.rx, r.cy - r.ry, 2 * r.rx, 2 * r.ry])} />
        </div>
      )}
      <i class="duel-bg-top" />
    </div>
  );
}
