// The living sky BEHIND the village (art pixels of the 240x135 backdrop), drawn in code as
// crisp pixel art and animated with CSS only (light on phones, stops with prefers-reduced-motion):
//   pixel colour bands that follow the village clock (sky-colors.ts);
//   the sun and the moon on an arc (they set behind the village);
//   clouds drifting by, flocks of birds by day, birds flying home at dusk;
//   twinkling stars, a meteor now and then, a very rare UFO at night.
// Fireflies fly IN FRONT of the village (SkyFront). Layers fade with --day / --dusk / --night.

import { Pixels } from '../sprites';
import { celestial, skyBackground, skyBands } from './sky-colors';

export const ART_W = 240;
export const ART_H = 135;

/** Absolute box in art pixels (percent of the 240x135 art). */
export function at(x: number, y: number, w: number, h: number) {
  return { left: `${(x / ART_W) * 100}%`, top: `${(y / ART_H) * 100}%`, width: `${(w / ART_W) * 100}%`, height: `${(h / ART_H) * 100}%` };
}

/** A filled pixel disc of radius r. */
function disc(r: number, ch = 'y', rim = 'o'): string[] {
  const n = r * 2 + 1;
  return Array.from({ length: n }, (_, y) =>
    Array.from({ length: n }, (_, x) => {
      const d = Math.hypot(x - r, y - r);
      return d <= r - 0.6 ? ch : d <= r + 0.35 ? rim : '.';
    }).join(''),
  );
}

const SUN = disc(6);
const SUN_PAL = { y: '#FFF3B0', o: '#FFD166' };
const SUN_LOW_PAL = { y: '#FFC46B', o: '#FF8A3D' };
const MOON = disc(4, 'm', 'M').map((r, y) => [...r].map((c, x) => (c === 'm' && ((x === 3 && y === 3) || (x === 5 && y === 5) || (x === 4 && y === 6)) ? 'c' : c)).join(''));
const MOON_PAL = { m: '#F4F1D0', M: '#D9D3A6', c: '#CFC79A' };

const CLOUD_A = [
  '.....wwww.........',
  '...wwwwwwww.wwww..',
  '.wwwwwwwwwwwwwwwww',
  'wwwwwwwwwwwwwwwwww',
  '.ssssssssssssssss.',
];
const CLOUD_B = ['...wwww.....', '.wwwwwwwww..', 'wwwwwwwwwwww', '.ssssssssss.'];
const CLOUD_PAL = { w: '#FFFFFF', s: '#D6E8F5' };

const BIRD_UP = ['b...b', '.b.b.', '..b..'];
const BIRD_DOWN = ['.....', 'bb.bb', '..b..'];

const UFO = ['...ccc...', '..cCCCc..', 'mmmmmmmmm', '.mymmmym.'];
const UFO_PAL = { c: '#A5F3FC', C: '#E0FFFF', m: '#9CA3AF', y: '#F5C542' };

const STARS = [
  [8, 14], [22, 22], [36, 6], [52, 26], [64, 12], [80, 4], [94, 20], [126, 8], [140, 30], [150, 6],
  [188, 12], [200, 26], [212, 6], [226, 22], [234, 10], [16, 36], [44, 40], [72, 34], [196, 40], [180, 20],
].map(([x, y], i) => ({ x, y, d: (i * 0.37) % 3, big: i % 5 === 0 }));
const FIREFLIES = Array.from({ length: 9 }, (_, i) => ({ x: 14 + ((i * 53) % 212), y: 76 + ((i * 17) % 22), d: (i * 0.9) % 6 }));

function Flock({ cls, n, pal }: { cls: string; n: number; pal: string }) {
  return (
    <div class={`flock ${cls}`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class="bird" style={{ left: `${(i % 2 ? 1 : -1) * Math.ceil(i / 2) * 26 + 50}%`, top: `${Math.ceil(i / 2) * 30}%`, animationDelay: `${(i * 0.13).toFixed(2)}s` }}>
          <Pixels rows={BIRD_UP} palette={{ b: pal }} scale={1} class="wing up" />
          <Pixels rows={BIRD_DOWN} palette={{ b: pal }} scale={1} class="wing down" />
        </span>
      ))}
    </div>
  );
}

/** Sky bands only (also behind the blurred side fill on wide screens). */
export function SkyBands({ hour }: { hour: number }) {
  return <div class="sky-bands" style={{ background: skyBackground(skyBands(hour)) }} />;
}

/** Everything behind the village (`bands` = false: the colour bands are drawn by the scene). */
export function SkyBack({ hour, bands = true }: { hour: number; bands?: boolean }) {
  const { sun, moon } = celestial(hour);
  return (
    <div class="sky" aria-hidden="true">
      {bands && <SkyBands hour={hour} />}
      <div class="sky-night">
        {STARS.map((s, i) => (
          <i key={i} class={`star${s.big ? ' big' : ''}`} style={{ ...at(s.x, s.y, s.big ? 1.5 : 1, s.big ? 1.5 : 1), animationDelay: `${s.d}s` }} />
        ))}
        <span class="meteor" style={at(70, 12, 26, 1)} />
        <span class="ufo" style={at(0, 24, 9, 4)}>
          <Pixels rows={UFO} palette={UFO_PAL} scale={1} />
          <i class="ufo-beam" />
        </span>
      </div>
      {moon.show > 0 && (
        <span class="sky-moon" style={at(moon.x - 4.5, moon.y - 4.5, 9, 9)}>
          <Pixels rows={MOON} palette={MOON_PAL} scale={1} />
        </span>
      )}
      {sun.show > 0 && (
        <>
          <span class="sun-glow" style={{ ...at(sun.x - 16, sun.y - 16, 32, 32), opacity: (0.25 + 0.6 * sun.low).toFixed(2) }} />
          <span class="sky-sun" style={at(sun.x - 6.5, sun.y - 6.5, 13, 13)}>
            <Pixels rows={SUN} palette={SUN_PAL} scale={1} />
            <Pixels rows={SUN} palette={SUN_LOW_PAL} scale={1} class="sun-low" style={{ opacity: sun.low.toFixed(2) }} />
          </span>
        </>
      )}
      <span class="cloud c1" style={at(0, 6, 18, 5)}>
        <Pixels rows={CLOUD_A} palette={CLOUD_PAL} scale={1} />
      </span>
      <span class="cloud c2" style={at(0, 16, 12, 4)}>
        <Pixels rows={CLOUD_B} palette={CLOUD_PAL} scale={1} />
      </span>
      <span class="cloud c3" style={at(0, 2, 12, 4)}>
        <Pixels rows={CLOUD_B} palette={CLOUD_PAL} scale={1} />
      </span>
      <div class="sky-day">
        <div class="flock-lane" style={at(0, 10, 30, 8)}>
          <Flock cls="day-flock" n={5} pal="#1B1B2F" />
        </div>
      </div>
      <div class="sky-dusk">
        <div class="flock-lane" style={at(0, 22, 30, 8)}>
          <Flock cls="home-flock" n={5} pal="#3B1F2B" />
        </div>
      </div>
    </div>
  );
}

/** In front of the village: fireflies over the fields at night. */
export function SkyFront() {
  return (
    <div class="sky sky-front" aria-hidden="true">
      <div class="sky-night">
        {FIREFLIES.map((f, i) => (
          <i key={i} class="firefly" style={{ ...at(f.x, f.y, 1, 1), animationDelay: `${f.d}s, ${(f.d * 0.7).toFixed(2)}s` }} />
        ))}
      </div>
    </div>
  );
}
