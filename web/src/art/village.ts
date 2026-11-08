// The village backdrops and where everything sits in them, per version and screen:
//   v1       - the first layered village (240x135, laptop and phone), kept for comparison (?bg=v1);
//   v2-web   - the symmetric village for laptops (wide image, 240x135 game pixels);
//   v2-phone - the same village drawn upright for phones (120x180 game pixels);
//   v3-web / v3-phone - the default since 2026-11-08: the same layout redrawn by ChatGPT with a
//                billboard on the Arena gazebo, a hologram robot head at the Friends house, no
//                turbine pole on laptops, and ChatGPT day, dusk and night images (cross-faded
//                day -> dusk -> night from the village clock). Dev builds compare with ?bg=v1 / ?bg=v2.
// Coordinates are game pixels (the grid trees, plots and TaniBot use); the images are more
// detailed: twice (480x270 laptop images, v2 phone 240x360) or four times (v3 phone 480x720).
// Each image comes in day / (dusk) / night versions that line up pixel for pixel and are
// cross-faded from the village clock. The v2 dusk and night files are made from the day image
// (tools/pixelize/relight.py). Commands for every file: docs/ASSETS.md.

export type BgVersion = 'v1' | 'v2' | 'v3';
export type Light = 'day' | 'dusk' | 'night';
export type Box = [number, number, number, number];
export type Spot = 'shop' | 'market' | 'village' | 'friends' | 'arena';

export interface SpotPlace {
  box: Box;
  /** Where the pin points: above the building, or on its body (`onBody`). */
  pin: [number, number];
  onBody?: boolean;
}

export interface Rail {
  /** Top of the rail (where the wheels run), from its far (left) end to its near (right) end. */
  points: [number, number][];
  /** The train shows only inside this box. */
  clip: { x: number; y: number; w: number; h: number };
  /** v1: runs left to right at one size. v2: comes from the right edge, gets smaller toward the middle and fades out. */
  toward: 'right' | 'left';
  /**
   * 'cars' (v1, v2): three code-drawn cars that tilt with the rail. 'slope' (v3): the ChatGPT
   * train, already drawn on the rail's slope (train-slope.png), slides along it unrotated at
   * one size and fades out at the far end of the rail (`fadeTo`..`fadeFrom`, game x).
   */
  sprite?: 'cars' | 'slope';
  fade?: [number, number];
}

export interface Village {
  key: 'v1' | 'v2-web' | 'v2-phone' | 'v3-web' | 'v3-phone';
  /** Art grid in game pixels. */
  w: number;
  h: number;
  src: (light: Light, hd: boolean) => string;
  /** Bottom edge of the plots' soil mounds (game row). */
  bedRow: number;
  /** Plots stand between these two x positions (game px). */
  stage: [number, number];
  /** Laptop: the part that must stay in view (x from / to, top row). */
  focus?: { x0: number; x1: number; top: number };
  /** Colour under the art when the art is lifted above the action bar. */
  groundExt: string;
  /** Soil mounds (pixel art) instead of the old wooden beds. */
  mounds: boolean;
  /** v3: the mounds are the ChatGPT mound (mound.png) instead of the code-drawn one. */
  moundArt?: boolean;
  /** v3: the holograms are drawn in the image; the code adds a slow glow and a soft scan line. */
  softHolograms?: boolean;
  /** v3: the empty screen of the Arena gazebo, where "1 VS 1" glows (game px). */
  billboard?: Box;
  /**
   * The lowest game row where the art is see-through (its sky, gaps in the palm leaves). The blurred
   * side fill (laptops) is only drawn below it, so it never shows behind the village's own sky.
   */
  skyBottom?: number;
  /** Phones: the scene always shows the art from this game row down. */
  shownFrom?: number;
  /** v3 phones: the top row of the open grass; tree labels never go above it (they stay off the village). */
  grassRow?: number;
  lanterns: Box[];
  holograms: Box[];
  falls: Box[];
  smoke: { x: number; y: number; d: number; small?: boolean }[];
  rotors: { x: number; y: number; size: number; speed: number }[];
  arenaRing: Box | null;
  /** Passing drones: their height in the sky and their shadow's row on the fields. */
  flyby: [number, number][];
  rail: Rail | null;
  spots: Record<Spot, SpotPlace>;
  /** Mr. Darto in front of his fruit stand: feet position and how much the sprite is shrunk. */
  darto: { x: number; y: number; shrink: number } | null;
  /**
   * The little village robot near the Friends house (day spot, night spot at the door).
   * `stay` (v3): it never goes home and never fades at night; it hovers in place.
   */
  robot: { x: number; y: number; homeX: number; stay?: boolean } | null;
}

const v1Src = (light: Light, hd: boolean) => `/assets/bg/village-${light}${hd ? '-hd' : ''}.png`;

/** The first layered village (2026-11-07). */
export const V1: Village = {
  key: 'v1',
  w: 240,
  h: 135,
  src: v1Src,
  bedRow: 111,
  stage: [26.4, 213.6],
  groundExt: 'linear-gradient(#6b4a2f, #4a321f)',
  mounds: false,
  lanterns: [
    [19, 56, 5, 6],
    [83, 77, 4, 5],
    [184, 69, 5, 6],
  ],
  holograms: [
    [20, 71, 9, 13],
    [172, 67, 8, 13],
    [223, 74, 11, 14],
  ],
  falls: [
    [115, 91, 5, 6],
    [142, 82, 4, 5],
    [158, 88, 5, 9],
    [209, 94, 6, 3],
  ],
  smoke: [
    { x: 108, y: 13, d: 0 },
    { x: 111, y: 13, d: 1.3 },
    { x: 106, y: 13, d: 2.6 },
    { x: 110, y: 13, d: 3.9 },
    { x: 117, y: 31, d: 0.6, small: true },
    { x: 117, y: 31, d: 2.4, small: true },
    { x: 124, y: 33, d: 1.5, small: true },
    { x: 124, y: 33, d: 3.3, small: true },
  ],
  rotors: [
    { x: 207.5, y: 25, size: 15, speed: 7 },
    { x: 228, y: 33, size: 13, speed: 9.5 },
  ],
  arenaRing: [100, 54, 33, 6],
  flyby: [
    [30, 102],
    [22, 99],
  ],
  rail: {
    points: [
      [123.5, 63.5],
      [145, 58.5],
      [165, 55],
      [185, 51.5],
      [200, 49],
      [215, 47.5],
      [228, 46.8],
    ],
    clip: { x: 122, y: 28, w: 103, h: 40 },
    toward: 'right',
  },
  spots: {
    shop: { box: [28, 63, 26, 27], pin: [41, 63] },
    market: { box: [76, 58, 21, 16], pin: [86.5, 58] },
    village: { box: [155, 11, 24, 40], pin: [167, 30], onBody: true },
    friends: { box: [196, 56, 42, 37], pin: [217, 56] },
    arena: { box: [99, 51, 35, 16], pin: [116.5, 51] },
  },
  darto: null,
  robot: null,
};

const v2Src = (form: 'web' | 'phone') => (light: Light) => `/assets/bg/village2-${form}-${light}.png`;

/** Rail top of the v2 laptop village: measured on the image (slope about 0.236). */
const railY = (x: number) => 62.5 + (167 - x) * 0.236;

/** The symmetric village, wide (laptops). */
export const V2_WEB: Village = {
  key: 'v2-web',
  w: 240,
  h: 135,
  skyBottom: 62,
  src: v2Src('web'),
  bedRow: 120,
  stage: [30, 210],
  // From the Shop's lantern to the Friends house's banner; the towers' tops.
  focus: { x0: 16, x1: 220, top: 29 },
  groundExt: 'linear-gradient(#0a5a2b, #06301a)',
  mounds: true,
  lanterns: [
    [17.5, 65, 5.5, 5],
    [62.5, 80, 5, 4.5],
    [147, 75, 3.5, 3.5],
    [176, 76.5, 5, 5.5],
  ],
  holograms: [
    [16, 77.5, 7.5, 13.5],
    [210, 80, 10, 12.5],
  ],
  falls: [
    [103.5, 82.5, 3.5, 3],
    [132, 86.5, 4.5, 3.5],
    [115.5, 94.5, 5.5, 5.5],
  ],
  smoke: [
    { x: 114.5, y: 26, d: 0 },
    { x: 117, y: 26, d: 1.3 },
    { x: 112.5, y: 26, d: 2.6 },
    { x: 116, y: 26, d: 3.9 },
  ],
  // The tall pole with the orb on the right.
  rotors: [{ x: 205, y: 38, size: 14, speed: 8 }],
  arenaRing: [102, 66, 34, 4],
  flyby: [
    [24, 112],
    [16, 108],
  ],
  rail: {
    points: [
      [136, railY(136)],
      [240, railY(240)],
    ],
    clip: { x: 138, y: 26, w: 102, h: 46 },
    toward: 'left',
  },
  spots: {
    shop: { box: [15, 64, 36, 33], pin: [33, 69] },
    market: { box: [146, 69, 30, 20], pin: [161, 74], onBody: true },
    village: { box: [149, 29, 37, 45], pin: [167, 47], onBody: true },
    friends: { box: [184, 63, 37, 28], pin: [202, 63] },
    arena: { box: [102, 66, 34, 12], pin: [118.5, 66] },
  },
  darto: { x: 151, y: 93, shrink: 3 },
  robot: { x: 225, y: 88, homeX: 203 },
};

/** The same village drawn upright (phones): everything fits the width, no panning. */
export const V2_PHONE: Village = {
  key: 'v2-phone',
  w: 120,
  h: 180,
  skyBottom: 92,
  src: v2Src('phone'),
  bedRow: 158,
  stage: [4, 116],
  groundExt: 'linear-gradient(#0a5a2b, #06301a)',
  mounds: true,
  lanterns: [
    [8.5, 101.5, 4.5, 4.5],
    [70.5, 108.5, 3, 4],
  ],
  holograms: [
    [8, 110, 5.5, 10.5],
    [108, 112, 7, 10.5],
  ],
  falls: [
    [52.5, 111, 2.5, 3.5],
    [65, 110.5, 2.5, 3.5],
    [57.5, 122.5, 5, 5.5],
  ],
  smoke: [
    { x: 59, y: 70, d: 0, small: true },
    { x: 60.5, y: 70, d: 1.3, small: true },
    { x: 58, y: 70, d: 2.6, small: true },
    { x: 60, y: 70, d: 3.9, small: true },
  ],
  rotors: [{ x: 105.5, y: 81.5, size: 8, speed: 8 }],
  arenaRing: [49.5, 100, 21.5, 3],
  flyby: [
    [60, 150],
    [66, 146],
  ],
  // The rail is too short on phones for a three-car train: no train there.
  rail: null,
  spots: {
    shop: { box: [8, 101, 22, 23], pin: [20, 105] },
    market: { box: [70.5, 105, 20, 13], pin: [80.5, 104] },
    village: { box: [77.5, 73.5, 22.5, 26.5], pin: [89, 84], onBody: true },
    friends: { box: [93.5, 101, 22, 21], pin: [104, 101] },
    arena: { box: [49.5, 99, 21.5, 8], pin: [60, 99] },
  },
  darto: { x: 73.5, y: 119.5, shrink: 4 },
  robot: { x: 113, y: 124, homeX: 101 },
};

const v3Src = (form: 'web' | 'phone') => (light: Light) => `/assets/bg/village3-${form}-${light}.png`;

/** Rail top of the v3 laptop village, measured on the image (tools: see docs/ASSETS.md). */
const railY3 = (x: number) => 68.5 - (x - 140) * 0.246;

/** Village v3, wide (laptops). Measured on web/public/assets/bg/village3-web-day.png (480x270). */
export const V3_WEB: Village = {
  key: 'v3-web',
  w: 240,
  h: 135,
  skyBottom: 61,
  src: v3Src('web'),
  bedRow: 121,
  stage: [30, 210],
  // From the Shop's lantern to the robot hologram at the Friends house; the towers' tops.
  focus: { x0: 16, x1: 220, top: 28 },
  groundExt: 'linear-gradient(#3f9a1c, #24600f)',
  mounds: true,
  moundArt: true,
  softHolograms: true,
  lanterns: [
    [17, 63.5, 4, 6],
    [63.3, 79.6, 5, 6.2],
    [146.7, 74, 4, 5],
    [178, 76.5, 3.5, 5],
  ],
  holograms: [
    [16.25, 77, 8.75, 14.75],
    [210.4, 79.6, 9.2, 15],
  ],
  falls: [
    [104.8, 81.8, 3.6, 3.6],
    [126.3, 79.7, 3.6, 2.8],
    [131.3, 86.1, 5.1, 3.6],
    [114.8, 94.7, 5.8, 6.3],
    [157.2, 96.2, 5.7, 5],
  ],
  smoke: [
    { x: 114.5, y: 27, d: 0 },
    { x: 117, y: 27, d: 1.3 },
    { x: 112.5, y: 27, d: 2.6 },
    { x: 116, y: 27, d: 3.9 },
  ],
  // No turbine pole in the v3 laptop village.
  rotors: [],
  arenaRing: null,
  billboard: [111.5, 70, 13, 5],
  flyby: [
    [24, 114],
    [16, 110],
  ],
  rail: {
    points: [
      [135, railY3(135)],
      [240, railY3(240)],
    ],
    clip: { x: 135, y: 8, w: 105, h: 66 },
    toward: 'left',
    sprite: 'slope',
    fade: [136, 160],
  },
  spots: {
    shop: { box: [14, 62, 37, 36], pin: [33, 69] },
    market: { box: [146, 67, 30, 21], pin: [161, 74], onBody: true },
    village: { box: [149, 29, 37, 46], pin: [167, 47], onBody: true },
    friends: { box: [184, 62, 38, 34], pin: [203, 62] },
    arena: { box: [101, 64, 36, 14], pin: [119, 64] },
  },
  darto: { x: 151, y: 94, shrink: 3 },
  // In front of the Friends house, on the grass (left of the side menu on every laptop).
  robot: { x: 196, y: 101, homeX: 196, stay: true },
};

/** Village v3 upright (phones). Measured on village3-phone-day.png (480x720, 4 px per game px). */
export const V3_PHONE: Village = {
  key: 'v3-phone',
  w: 120,
  h: 180,
  skyBottom: 88,
  src: v3Src('phone'),
  bedRow: 149,
  stage: [4, 116],
  shownFrom: 58,
  grassRow: 130,
  groundExt: 'linear-gradient(#3f9a1c, #24600f)',
  mounds: true,
  moundArt: true,
  softHolograms: true,
  lanterns: [
    [8.3, 98.3, 4.2, 5.5],
    [31.25, 108.75, 3.4, 4.6],
    [71.25, 105.4, 3, 4.6],
  ],
  holograms: [
    [7.9, 107.5, 5.9, 10],
    [107.9, 108.75, 6.3, 10.9],
  ],
  falls: [
    [51.5, 109.5, 2.5, 3.5],
    [65.6, 108, 3, 3.5],
    [57.5, 118.3, 5.8, 7.5],
  ],
  smoke: [
    { x: 59.5, y: 62.5, d: 0, small: true },
    { x: 61, y: 62.5, d: 1.3, small: true },
    { x: 58.5, y: 62.5, d: 2.6, small: true },
    { x: 60.5, y: 62.5, d: 3.9, small: true },
  ],
  // The pole with the orb right of the towers.
  rotors: [{ x: 104.6, y: 77.2, size: 8, speed: 8 }],
  arenaRing: null,
  billboard: [55.75, 95.75, 8.75, 3.75],
  flyby: [
    [62, 140],
    [68, 136],
  ],
  // The rail is only about 48 game px long on phones (40% of the screen): too short for the big train.
  rail: null,
  spots: {
    shop: { box: [7, 100, 22, 23], pin: [20, 104] },
    market: { box: [70, 101, 23, 15], pin: [81, 108], onBody: true },
    village: { box: [77, 66, 21, 33], pin: [88, 80], onBody: true },
    friends: { box: [93, 97, 24, 23], pin: [105, 97] },
    arena: { box: [49, 92, 23, 10], pin: [60.5, 92] },
  },
  darto: { x: 74, y: 120.5, shrink: 4 },
  robot: { x: 100.5, y: 128.5, homeX: 100.5, stay: true },
};

/** Dev builds: ?bg=v1 / ?bg=v2 show the earlier villages to compare. Production always uses v3. */
export function bgVersion(search = typeof location !== 'undefined' ? location.search : ''): BgVersion {
  if (!import.meta.env?.DEV) return 'v3';
  const v = new URLSearchParams(search).get('bg');
  return v === 'v1' || v === 'v2' ? v : 'v3';
}

export function villageFor(version: BgVersion, phone: boolean): Village {
  if (version === 'v1') return V1;
  if (version === 'v2') return phone ? V2_PHONE : V2_WEB;
  return phone ? V3_PHONE : V3_WEB;
}

/** Absolute box in game pixels of a village (percent of its art). */
export function boxIn(v: { w: number; h: number }, x: number, y: number, w: number, h: number) {
  return { left: `${(x / v.w) * 100}%`, top: `${(y / v.h) * 100}%`, width: `${(w / v.w) * 100}%`, height: `${(h / v.h) * 100}%` };
}
