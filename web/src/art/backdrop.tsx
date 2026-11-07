// Garden backdrop: the Solarpunk village of Tandur from two AI images (ChatGPT,
// made at Ardian's request, see docs/ASSETS.md), pixelized to 240x135 with
// tools/pixelize. The day and night versions are stacked and cross-faded from
// the village clock (dawn and dusk mix both with a warm tint). Small code-drawn
// animations sit on top: passing drones, blinking drone LEDs, lanterns and
// holograms, shimmering waterfalls and moving volcano smoke.
// All overlay coordinates are in art pixels (the 240x135 image).

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
  if (hour < 17) return 'day';
  if (hour < 19) return 'dusk';
  return 'night';
}

/** How much of the night image shows (0 = day, 1 = night) and the warm dawn/dusk tint. */
export function skyMix(fractionOfDay: number): { night: number; tint: number } {
  const hour = hourOf(fractionOfDay);
  if (hour >= 5 && hour < 7) {
    const t = (hour - 5) / 2; // dawn: night -> day
    return { night: 1 - t, tint: Math.sin(Math.PI * t) };
  }
  if (hour >= 17 && hour < 19) {
    const t = (hour - 17) / 2; // dusk: day -> night
    return { night: t, tint: Math.sin(Math.PI * t) };
  }
  return { night: hour >= 7 && hour < 17 ? 0 : 1, tint: 0 };
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

function MiniDrone() {
  return (
    <svg viewBox="0 0 9 4" shape-rendering="crispEdges" aria-hidden="true">
      <rect x={0} y={0} width={3} height={1} fill="#D1D5DB" />
      <rect x={6} y={0} width={3} height={1} fill="#D1D5DB" />
      <rect x={1} y={1} width={1} height={1} fill="#4B5563" />
      <rect x={7} y={1} width={1} height={1} fill="#4B5563" />
      <rect x={2} y={1} width={5} height={2} fill="#E5E7EB" />
      <rect x={3} y={2} width={3} height={1} fill="#1B1B2F" />
      <rect x={4} y={3} width={1} height={1} class="mini-led" />
    </svg>
  );
}

/**
 * `hd` uses the 480x270 versions (laptop immersive mode, drawn at a whole or
 * half number of px per pixel); phones use the 240x135 ones.
 */
export function Backdrop({ fraction, blurFill = false, hd = false }: { fraction: number; blurFill?: boolean; hd?: boolean }) {
  const daySrc = hd ? '/assets/bg/bg-day-hd.png' : '/assets/bg/bg-day.png';
  const nightSrc = hd ? '/assets/bg/bg-night-hd.png' : '/assets/bg/bg-night.png';
  const { night, tint } = skyMix(fraction);
  const vars = { '--night': night.toFixed(3), '--tint': tint.toFixed(3) };

  return (
    <div class="backdrop" style={vars} aria-hidden="true">
      <div class="bg-fill bg-fill-night" />
      {blurFill && (
        // Full-window layout: whatever the sharp art does not cover shows a blurred copy of it.
        <div class="bg-blur">
          <img src={daySrc} alt="" />
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
        <img class="bg-img bg-img-night" src={nightSrc} alt="" />

        <div class="bg-fx">
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
          <div class="flyby f1">
            <span style={at(0, 30, 9, 4)}>
              <MiniDrone />
            </span>
          </div>
          <div class="flyby f2">
            <span style={at(0, 22, 9, 4)}>
              <MiniDrone />
            </span>
          </div>
        </div>
        <div class="bg-night-shade" />
      </div>
      {blurFill && <div class="bg-soil-ext" />}

      <div class="bg-tint" />
    </div>
  );
}
