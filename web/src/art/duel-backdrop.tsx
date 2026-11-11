// The duel's background (Arena v2, Ardian 2026-11-11): the village around the Arena building, with
// Gunung Tandur behind it. It is the garden's own village v3 (the same images, the same sky drawn in
// code, smoke, waterfalls, lamps, train, weather, and day / dusk / night from the same village
// clock), cut out and enlarged on the Arena; nothing new is drawn. The TaniBots stand on a front
// floor made of the image's own grass rows. A soft dark layer at the top keeps the names, titles
// and bars readable by day and by night. The cut is computed from the stage's size so the Arena
// building and the mountain's peak always stay in view (phones 390x844, laptops 1280x800).

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { WeatherLook } from '../weather';
import { Backdrop, skyMix } from './backdrop';
import { V3_PHONE, V3_WEB, type Village } from './village';

/** What to show of each village, in game pixels (measured on village3-*-day.png). */
interface Cut {
  /** The Arena building's middle (the cut is centred on it). */
  cx: number;
  /** The widest and the narrowest cut (the stage's size decides within these). */
  maxW: number;
  /** The top row that must stay visible (just above the mountain's peak). */
  top: number;
  /** The art's row where the front floor starts (below the Arena and its terraces). */
  seam: number;
  /** The image's own grass rows used as the front floor (only grass, no buildings). */
  lawn: [number, number];
}

const CUT_WEB: Cut = { cx: 119.5, maxW: 170, top: 24, seam: 95, lawn: [106, 121] };
const CUT_PHONE: Cut = { cx: 60.5, maxW: 80, top: 55, seam: 105, lawn: [130, 148] };

/** The scale (CSS px per game px) and the offsets of the art for a stage of w x h CSS px. */
export function duelCut(v: Village, cut: Cut, w: number, h: number) {
  const lawnRows = cut.lawn[1] - cut.lawn[0];
  // As close as the width allows (the Arena centred), but never so close that the peak is cut off.
  const k = Math.min(w / Math.min(cut.maxW, v.w), h / (cut.seam - cut.top + lawnRows));
  const floorH = lawnRows * k;
  const floorTop = h - floorH;
  const left = Math.min(0, Math.max(w - v.w * k, w / 2 - cut.cx * k));
  return { k, left, top: floorTop - cut.seam * k, floorTop, floorH };
}

export function DuelBackdrop({ fraction, weather, wide }: { fraction: number; weather: WeatherLook; wide: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize((s) => (s && s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const v = wide ? V3_WEB : V3_PHONE;
  const cut = wide ? CUT_WEB : CUT_PHONE;
  const c = size ? duelCut(v, cut, size.w, size.h) : null;
  const { night, dusk } = skyMix(fraction);
  const lights = { '--night': night.toFixed(3), '--dusk': dusk.toFixed(3) };
  return (
    <div class="duel-bg" ref={ref} aria-hidden="true">
      {c && (
        <>
          <div class="duel-bg-art" style={{ left: `${c.left}px`, top: `${c.top}px`, width: `${v.w * c.k}px`, height: `${v.h * c.k}px` }}>
            {/* The sky's sun, moon and clouds start at the first row in view (phones' upright village). */}
            <Backdrop fraction={fraction} hd village={v} weather={weather} phone={!wide} skyTop={wide ? undefined : Math.max(0, -c.top / c.k)} />
          </div>
          {/* The front floor: the village's own grass rows, repeated sideways, day / dusk / night. */}
          <div class="duel-floor-lawn" style={{ ...lights, top: `${c.floorTop}px`, height: `${c.floorH}px` }}>
            {(['day', 'dusk', 'night'] as const).map((light) => (
              <i
                key={light}
                class={`duel-lawn duel-lawn-${light}`}
                style={{
                  backgroundImage: `url(${v.src(light, true)})`,
                  backgroundSize: `${v.w * c.k}px ${v.h * c.k}px`,
                  backgroundPosition: `${c.left}px ${-cut.lawn[0] * c.k}px`,
                }}
              />
            ))}
            <i class="duel-lawn-shade" />
          </div>
        </>
      )}
      <i class="duel-bg-top" />
    </div>
  );
}
