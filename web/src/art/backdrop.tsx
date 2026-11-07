// Garden backdrop, in layers (back to front):
//   1. the sky, drawn in code (sky.tsx): pixel colour bands, sun, moon, clouds, birds, stars...
//   2. the village of Tandur: three AI images (ChatGPT, made at Ardian's request, see
//      docs/ASSETS.md) with the sky cut out: day, dusk and night, the same drawing, cross-faded
//      from the village clock;
//   3. moving parts: the monorail train along its rail, the two wind turbine rotors;
//   4. code effects: volcano smoke, geothermal steam, waterfalls, lanterns, holograms, the
//      Arena's mint ring, passing delivery drones, fireflies;
//   5. hotspots with always-visible pins (hotspots.tsx): Shop stall, Market (the small house in
//      the middle), the farm tower, a friend's house, the Arena.
// All coordinates are art pixels of the 240x135 phone image (the laptop image is 480x270).

import { Drone } from './tanibot';
import { Animals } from './animals';
import { Train, TRAIN_CLIP } from './train';
import { Hotspots, type Place } from './hotspots';
import { at, SkyBack, SkyBands, SkyFront } from './sky';
import { skyBands } from './sky-colors';

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

export function hourOf(fractionOfDay: number): number {
  return (7 + fractionOfDay * 24) % 24;
}

/** Phase of the village day. The game day starts at 07:00 WIB. */
export function phaseOf(fractionOfDay: number): Phase {
  const hour = hourOf(fractionOfDay);
  if (hour < 5) return 'night';
  if (hour < 7) return 'dawn';
  if (hour < 16.5) return 'day';
  if (hour < 19) return 'dusk';
  return 'night';
}

/**
 * How much of the dusk and night villages show (0..1, stacked: day, dusk, night) and the warm tint.
 * Day -> dusk 16:00-17:00, dusk -> night 18:30-19:30; at dawn night -> dusk 05:00-06:00 and
 * dusk -> day 06:00-07:00 (the warm village is the sunrise too).
 */
export function skyMix(fractionOfDay: number): { night: number; dusk: number; tint: number } {
  const hour = hourOf(fractionOfDay);
  const ramp = (from: number, to: number) => Math.min(1, Math.max(0, (hour - from) / (to - from)));
  if (hour >= 5 && hour < 7) return { night: 1 - ramp(5, 6), dusk: 1 - ramp(6, 7), tint: 0 };
  if (hour >= 16 && hour < 19.5) return { night: ramp(18.5, 19.5), dusk: ramp(16, 17), tint: 0 };
  return { night: hour >= 7 && hour < 16 ? 0 : 1, dusk: 0, tint: 0 };
}

/** Village fractions for ?time=day / dusk / night (dev builds: lock the clock for screenshots and video). */
export const TIME_LOCK: Record<string, number> = {
  day: (12 - 7) / 24,
  dusk: (17.75 - 7) / 24,
  night: (23 - 7) / 24,
};

/** ?time=day / dusk / night, or a village hour such as ?time=16.5 (mid fade from day to dusk). */
export function lockedFraction(search: string): number | null {
  const t = new URLSearchParams(search).get('time');
  if (!t) return null;
  if (t in TIME_LOCK) return TIME_LOCK[t];
  const hour = Number(t);
  return Number.isFinite(hour) && hour >= 0 && hour < 24 ? ((hour - 7 + 24) % 24) / 24 : null;
}

// Effects as they sit in the new village image.
const LANTERNS = [
  [19, 56, 5, 6],
  [83, 77, 4, 5],
  [184, 69, 5, 6],
];
const HOLOGRAMS = [
  [20, 71, 9, 13],
  [172, 67, 8, 13],
  [223, 74, 11, 14],
];
const FALLS = [
  [115, 91, 5, 6],
  [142, 82, 4, 5],
  [158, 88, 5, 9],
  [209, 94, 6, 3],
];
/** Volcano smoke (big puffs) and the geothermal station's steam (small). */
const SMOKE = [
  { x: 108, y: 13, d: 0 },
  { x: 111, y: 13, d: 1.3 },
  { x: 106, y: 13, d: 2.6 },
  { x: 110, y: 13, d: 3.9 },
  { x: 117, y: 31, d: 0.6, small: true },
  { x: 117, y: 31, d: 2.4, small: true },
  { x: 124, y: 33, d: 1.5, small: true },
  { x: 124, y: 33, d: 3.3, small: true },
];

/** Wind turbine rotors on the two poles on the right (hub positions), turning at their own pace. */
const ROTORS = [
  { x: 207.5, y: 25, size: 15, speed: 7 },
  { x: 228, y: 33, size: 13, speed: 9.5 },
];

/**
 * `hd` uses the 480x270 versions (laptop immersive mode, drawn at a whole or half number of
 * px per pixel); phones use the 240x135 ones. `onPlace` opens a panel from a hotspot.
 */
export function Backdrop({ fraction, blurFill = false, hd = false, onPlace, account }: { fraction: number; blurFill?: boolean; hd?: boolean; onPlace?: (p: Place) => void; account?: string }) {
  const suf = hd ? '-hd' : '';
  const src = (v: string) => `/assets/bg/village-${v}${suf}.png`;
  const hour = hourOf(fraction);
  const { night, dusk, tint } = skyMix(fraction);
  const vars = {
    '--night': night.toFixed(3),
    '--dusk': dusk.toFixed(3),
    '--day': ((1 - dusk) * (1 - night)).toFixed(3),
    '--tint': tint.toFixed(3),
  };

  return (
    <div class="backdrop" style={vars} aria-hidden={onPlace ? undefined : 'true'}>
      {blurFill && (
        // Full-window layout: whatever the sharp art does not cover shows a blurred copy of it.
        <div class="bg-blur">
          <SkyBands hour={hour} />
          <img src={src('day')} alt="" />
          <img class="bg-img-dusk" src={src('dusk')} alt="" />
          <img class="bg-img-night" src={src('night')} alt="" />
        </div>
      )}
      {/* Above the art on phones: the top band of the sky. */}
      <div class="bg-sky-fill" style={{ background: skyBands(hour)[0] }} />

      <div class="bg-art">
        <SkyBack hour={hour} />
        <img class="bg-img" src={src('day')} alt="" />
        <img class="bg-img bg-img-dusk" src={src('dusk')} alt="" />
        <img class="bg-img bg-img-night" src={src('night')} alt="" />

        <div class="bg-fx">
          {ROTORS.map((r, i) => (
            <span key={i} class="rotor" style={{ ...at(r.x - r.size / 2, r.y - r.size / 2, r.size, r.size), animationDuration: `${r.speed}s` }}>
              <img src={`/assets/bg/rotor${suf}.png`} alt="" />
            </span>
          ))}
          <div class="train-clip" style={at(TRAIN_CLIP.x, TRAIN_CLIP.y, TRAIN_CLIP.w, TRAIN_CLIP.h)}>
            <Train hd={hd} />
          </div>
          {SMOKE.map((s, i) => (
            <i key={i} class={`puff${s.small ? ' small' : ''}`} style={{ ...at(s.x, s.y, s.small ? 2 : 4, s.small ? 2 : 4), animationDelay: `${s.d}s` }} />
          ))}
          {FALLS.map(([x, y, w, h], i) => (
            <i key={i} class="fall" style={{ ...at(x, y, w, h), animationDelay: `${i * 0.15}s` }} />
          ))}
          {HOLOGRAMS.map(([x, y, w, h], i) => (
            <i key={i} class="holo" style={{ ...at(x, y, w, h), animationDelay: `${i * 0.9}s` }} />
          ))}
          {LANTERNS.map(([x, y, w, h], i) => (
            <i key={i} class="lamp" style={{ ...at(x - 2, y - 2, w + 4, h + 4), animationDelay: `${i * 0.7}s` }} />
          ))}
          <i class="arena-ring" style={at(100, 54, 33, 6)} />
          {/* Quadcopters crossing the sky, each with a small shadow sliding over the fields. */}
          <div class="flyby f1">
            <span style={at(0, 30, 10, 5)}>
              <Drone scale={1} class="mini" />
            </span>
            <i class="flyby-shadow" style={at(2, 102, 6, 1.5)} />
          </div>
          <div class="flyby f2">
            <span style={at(0, 22, 10, 5)}>
              <Drone scale={1} class="mini" />
            </span>
            <i class="flyby-shadow" style={at(2, 99, 6, 1.5)} />
          </div>
        </div>
        <Animals />
        <SkyFront />
        <div class="bg-night-shade" />
        {onPlace && <Hotspots onPlace={onPlace} account={account} />}
      </div>
      {blurFill && <div class="bg-soil-ext" />}

      <div class="bg-tint" />
    </div>
  );
}
