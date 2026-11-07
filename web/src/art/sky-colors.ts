// Sky colours for the village clock, as pixel bands (no smooth gradient): each band is one
// flat colour between the zenith and the horizon colour of the hour. The hours in between
// are blended, so morning -> day -> dusk -> night changes smoothly band by band.
// The day colours are also baked into bg-day.png (login page, share cards, Profile):
// keep tools/pixelize notes in docs/ASSETS.md in sync if they change.

/** Bands from the top of the art (each SKY_BAND art px high); below them the horizon colour. */
export const SKY_BANDS = 9;
export const SKY_BAND = 8;

type Rgb = [number, number, number];

const hex = (s: string): Rgb => [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];

/** [village hour, zenith, horizon]. */
const STOPS: [number, Rgb, Rgb][] = [
  [0, hex('#0A0F2C'), hex('#1B2A5C')],
  [4.8, hex('#0A0F2C'), hex('#1B2A5C')],
  [5.8, hex('#2A2F6B'), hex('#C26A7A')],
  [6.6, hex('#4E7FCF'), hex('#F6B07A')],
  [7.5, hex('#3B8FE3'), hex('#B5E3F7')],
  [15.8, hex('#3B8FE3'), hex('#B5E3F7')],
  [16.8, hex('#5B6FC4'), hex('#F8B26A')],
  [17.8, hex('#4B3A8C'), hex('#FF8A5B')],
  [18.7, hex('#2A2560'), hex('#B4506E')],
  [19.6, hex('#0A0F2C'), hex('#1B2A5C')],
  [24, hex('#0A0F2C'), hex('#1B2A5C')],
];

const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as Rgb;
const css = (c: Rgb) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`;

/** The band colours (top to bottom) for a village hour (0-24). */
export function skyBands(hour: number): string[] {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < STOPS.length - 2 && STOPS[i + 1][0] <= h) i++;
  const [h0, z0, o0] = STOPS[i];
  const [h1, z1, o1] = STOPS[i + 1];
  const t = h1 > h0 ? (h - h0) / (h1 - h0) : 0;
  const zenith = mix(z0, z1, t);
  const horizon = mix(o0, o1, t);
  return Array.from({ length: SKY_BANDS }, (_, b) => css(mix(zenith, horizon, b / (SKY_BANDS - 1))));
}

/** CSS background for the bands: hard stops, one flat colour per band (art height 135 px). */
export function skyBackground(bands: string[], artH = 135): string {
  const stops: string[] = [];
  bands.forEach((c, i) => {
    const from = ((i * SKY_BAND) / artH) * 100;
    const to = (((i + 1) * SKY_BAND) / artH) * 100;
    stops.push(`${c} ${from.toFixed(3)}%`, `${c} ${i === bands.length - 1 ? 100 : to.toFixed(3)}%`);
  });
  return `linear-gradient(180deg, ${stops.join(', ')})`;
}

/** Sun and moon positions (art px, centre) and how much they show, from the village hour. */
export function celestial(hour: number): { sun: { x: number; y: number; show: number; low: number }; moon: { x: number; y: number; show: number } } {
  const h = ((hour % 24) + 24) % 24;
  const sunT = (h - 6) / 12.5; // 06:00 -> 18:30
  const sunUp = sunT >= -0.06 && sunT <= 1.06;
  const st = Math.min(1.06, Math.max(-0.06, sunT));
  const sun = { x: 12 + st * 216, y: 50 - Math.sin(Math.PI * Math.min(1, Math.max(0, st))) * 42, show: sunUp ? 1 : 0, low: 0 };
  sun.low = Math.min(1, Math.max(0, (sun.y - 18) / 26));
  const nightLen = 11; // 18:45 -> 05:45
  const mt = (((h - 18.75) % 24) + 24) % 24 / nightLen;
  const moonUp = mt <= 1;
  const m = Math.min(1, mt);
  const moon = { x: 226 - m * 206, y: 46 - Math.sin(Math.PI * m) * 36, show: moonUp ? 1 : 0 };
  return { sun, moon };
}
