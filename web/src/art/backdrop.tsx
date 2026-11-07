// Garden backdrop: the Solarpunk village of Tandur from three AI images (ChatGPT,
// made at Ardian's request, see docs/ASSETS.md), pixelized to 240x135 with
// tools/pixelize. Day, dusk (the market square at sunset) and night are stacked and
// cross-faded from the village clock (dawn gets a warm tint); the living sky
// (sun, clouds, birds, stars, meteors, a rare UFO, fireflies) is in sky.tsx. Small code-drawn
// animations sit on top: passing drones, blinking drone LEDs, lanterns and
// holograms, shimmering waterfalls and moving volcano smoke.
// All overlay coordinates are in art pixels (the 240x135 image).

import { Sky } from './sky';
import { Drone } from './tanibot';
export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

const ART_W = 240;
const ART_H = 135;

function hourOf(fractionOfDay: number): number {
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
 * How much of the dusk and night images show (0..1) and the warm dawn tint.
 * Day -> dusk 16:00-17:00, dusk until 18:30, dusk -> night 18:30-19:30, night -> day 05:00-07:00.
 */
export function skyMix(fractionOfDay: number): { night: number; dusk: number; tint: number } {
  const hour = hourOf(fractionOfDay);
  const ramp = (from: number, to: number) => Math.min(1, Math.max(0, (hour - from) / (to - from)));
  if (hour >= 5 && hour < 7) {
    const t = ramp(5, 7);
    return { night: 1 - t, dusk: 0, tint: Math.sin(Math.PI * t) };
  }
  if (hour >= 16 && hour < 19.5) {
    const dusk = ramp(16, 17);
    return { night: ramp(18.5, 19.5), dusk, tint: 0.35 * Math.sin(Math.PI * dusk) };
  }
  return { night: hour >= 7 && hour < 16 ? 0 : 1, dusk: 0, tint: 0 };
}

/** Village fractions for ?time=day / dusk / night (dev builds: lock the clock for screenshots and video). */
export const TIME_LOCK: Record<string, number> = {
  day: (12 - 7) / 24,
  dusk: (17.75 - 7) / 24,
  night: (23 - 7) / 24,
};

export function lockedFraction(search: string): number | null {
  const t = new URLSearchParams(search).get('time');
  return t && t in TIME_LOCK ? TIME_LOCK[t] : null;
}

/** Absolute position of a box given in art pixels. */
function at(x: number, y: number, w: number, h: number) {
  return {
    left: `${(x / ART_W) * 100}%`,
    top: `${(y / ART_H) * 100}%`,
    width: `${(w / ART_W) * 100}%`,
    height: `${(h / ART_H) * 100}%`,
  };
}

// Drone LEDs, lanterns, holograms and waterfalls as they sit in the image.
const DRONE_LEDS = [
  [81, 17],
  [134, 15],
  [149, 11],
  [183, 11],
];
const LANTERNS = [
  [18, 56, 5, 6],
  [84, 75, 4, 5],
  [183, 69, 5, 5],
];
const HOLOGRAMS = [
  [21, 65, 9, 19],
  [171, 65, 9, 14],
  [220, 73, 16, 15],
];
const FALLS = [
  [115, 91, 5, 6],
  [138, 80, 6, 8],
  [157, 86, 7, 12],
  [207, 92, 8, 6],
];
const SMOKE = [
  { x: 108, y: 14, d: 0 },
  { x: 111, y: 14, d: 1.3 },
  { x: 106, y: 14, d: 2.6 },
  { x: 110, y: 14, d: 3.9 },
  { x: 119, y: 23, d: 0.6, small: true },
  { x: 124, y: 27, d: 2.1, small: true },
];
// A few stars for the extra sky above the image on phones.
const STARS = Array.from({ length: 14 }, (_, i) => ({ x: (i * 41 + 7) % 100, y: (i * 29) % 90, d: (i % 4) * 0.6 }));


/**
 * `hd` uses the 480x270 versions (laptop immersive mode, drawn at a whole or
 * half number of px per pixel); phones use the 240x135 ones.
 */
export function Backdrop({ fraction, blurFill = false, hd = false }: { fraction: number; blurFill?: boolean; hd?: boolean }) {
  const daySrc = hd ? '/assets/bg/bg-day-hd.png' : '/assets/bg/bg-day.png';
  const nightSrc = hd ? '/assets/bg/bg-night-hd.png' : '/assets/bg/bg-night.png';
  const duskSrc = hd ? '/assets/bg/bg-dusk-hd.png' : '/assets/bg/bg-dusk.png';
  const { night, dusk, tint } = skyMix(fraction);
  const vars = {
    '--night': night.toFixed(3),
    '--dusk': dusk.toFixed(3),
    '--day': Math.max(0, 1 - night - dusk).toFixed(3),
    // The village effects below sit on the day/night drawing: hidden while the dusk image shows.
    '--village': (1 - dusk * (1 - night)).toFixed(3),
    '--tint': tint.toFixed(3),
  };

  return (
    <div class="backdrop" style={vars} aria-hidden="true">
      <div class="bg-fill bg-fill-dusk" />
      <div class="bg-fill bg-fill-night" />
      {blurFill && (
        // Full-window layout: whatever the sharp art does not cover shows a blurred copy of it.
        <div class="bg-blur">
          <img src={daySrc} alt="" />
          <img class="bg-img-dusk" src={duskSrc} alt="" />
          <img class="bg-img-night" src={nightSrc} alt="" />
        </div>
      )}
      <div class="bg-stars">
        {STARS.map((s, i) => (
          <i key={i} style={{ left: `${s.x}%`, top: `${s.y}%`, animationDelay: `${s.d}s` }} />
        ))}
      </div>

      <div class="bg-art">
        <img class="bg-img" src={daySrc} alt="" />
        <img class="bg-img bg-img-dusk" src={duskSrc} alt="" />
        <img class="bg-img bg-img-night" src={nightSrc} alt="" />

        <div class="bg-fx bg-fx-village">
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
          {DRONE_LEDS.map(([x, y], i) => (
            <i key={i} class="led" style={{ ...at(x, y, 1, 1), animationDelay: `${i * 0.4}s` }} />
          ))}
        </div>
        <Sky />
        <div class="bg-fx">
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
        <div class="bg-night-shade" />
      </div>
      {blurFill && <div class="bg-soil-ext" />}

      <div class="bg-tint" />
    </div>
  );
}
