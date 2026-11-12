// The fishing pond's two layouts (Ardian 2026-11-12, docs/PLAN-fishing.md section 15):
//  - WIDE: the 16:9 ChatGPT pond (laptops, and phones held sideways), a 480 x 270 grid;
//  - PHONE: Ardian's ChatGPT phone pictures (upright phones), a NEW composition. Things in it are about
//    1.4 times bigger than in the 16:9 picture, so its grid is the picture / 1.4 (343 x 609): TaniBot,
//    frogs, ducks, the rod and the bucket keep their size in grid px; only the places differ.
// Every place below is measured on the pixelized pictures (picture px for the phone, divided by 1.4).
// Pixel art keeps its own palette (CLAUDE.md Design system).

import { PHONE_LAKE_BOTTOM_PX, PHONE_WATER_CELL, PHONE_WATER_MASK } from './pond-phone-data.ts';
import { WATER_CELL, WATER_MASK } from './pond-sprites.ts';

export type Pt = { x: number; y: number };
export type Box = [number, number, number, number];

export interface PondLayout {
  key: 'wide' | 'phone';
  /** Scene grid size. */
  w: number;
  h: number;
  pics: { day: string; dusk: string; night: string };
  /**
   * Phones only (package 7): more of the picture's own ground for screens taller than the picture
   * (tools/pixelize/pond_ground.py): picture px tall, starting `over` px above the picture's bottom.
   */
  ground?: { pics: { day: string; dusk: string; night: string }; h: number; over: number };
  /** The big tree's crown layer (grid box) and its pictures. */
  tree: { box: Box; pics: { day: string; dusk: string; night: string } };
  /** The waterfall: box (grid), mask + textures, the steps (grid polygons, slant, loop s), lips, foam. */
  fall: {
    box: { x: number; y: number; w: number; h: number };
    mask: string;
    tex: { day: string; dusk: string; night: string };
    steps: { pts: [number, number][]; skew: number; s: number }[];
    lips: [number, number, number][];
    foam: [number, number, number][];
    spread: [number, number];
  };
  /** Where ducks never swim (the waterfall's foot). */
  waterfallFoot: Box;
  /**
   * Waves spread from here over the lake (grid), as big as this, masked to the water picture; one wave
   * takes `s` seconds and is at most `peak` opaque. Their back half (toward the waterfall and its rocks)
   * fades out (package 7).
   */
  waves: { x: number; y: number; rx: number; ry: number; mask: string; s: number; peak: number };
  /** TaniBot's feet, its hands, the float, the rod's length and its angles (degrees). */
  bot: Pt;
  hands: Pt;
  float: Pt;
  rodLen: number;
  angles: { rest: number; back: number; forward: number; wait: number; reel: number };
  bucket: Pt;
  frogSpots: Pt[];
  frogs: { start: number; pads: number[] }[];
  duckStarts: Pt[];
  water: { cell: number; mask: string[] };
  fireflies: [number, number, number, number][];
  glints: [number, number, number][];
  rainRings: [number, number][];
  /** The lake's lowest row (grid): the controls stay below it. */
  lakeBottom: number;
}

export const WIDE: PondLayout = {
  key: 'wide',
  w: 480,
  h: 270,
  pics: { day: '/assets/bg/fishing-pond.png', dusk: '/assets/bg/fishing-pond-dusk.png', night: '/assets/bg/fishing-pond-night.png' },
  tree: {
    box: [0, 0, 80, 41],
    pics: { day: '/assets/bg/fishing-pond-tree.png', dusk: '/assets/bg/fishing-pond-tree-dusk.png', night: '/assets/bg/fishing-pond-tree-night.png' },
  },
  fall: {
    box: { x: 376, y: 0, w: 58, h: 56 },
    mask: '/assets/bg/fishing-fall-mask.png',
    tex: { day: '/assets/bg/fishing-fall-day.png', dusk: '/assets/bg/fishing-fall-dusk.png', night: '/assets/bg/fishing-fall-night.png' },
    steps: [
      { pts: [[415, 0], [434, 0], [424, 17], [405, 17]], skew: -27, s: 1.05 },
      { pts: [[397, 12], [413, 12], [407, 31], [380, 31]], skew: -14, s: 0.95 },
      { pts: [[376, 30], [410, 30], [408, 45], [379, 45]], skew: -5, s: 0.85 },
      { pts: [[376, 44], [403, 44], [401, 56], [376, 56]], skew: 0, s: 0.75 },
    ],
    lips: [
      [406, 15, 12],
      [383, 31, 22],
      [381, 40, 20],
    ],
    foam: [
      [382, 54, 6],
      [389, 56, 8],
      [396, 54, 6],
    ],
    spread: [389, 58],
  },
  waterfallFoot: [366, 44, 54, 30],
  waves: { x: 392, y: 64, rx: 300, ry: 130, mask: '/assets/bg/fishing-pond-water.png', s: 16, peak: 0.45 },
  bot: { x: 62, y: 130 },
  hands: { x: 75, y: 107 },
  float: { x: 250, y: 142 },
  rodLen: 62,
  angles: { rest: 52, back: 118, forward: 12, wait: 20, reel: 26 },
  bucket: { x: 35, y: 120 },
  frogSpots: [
    { x: 149, y: 74 },
    { x: 176, y: 73 },
    { x: 307, y: 53 },
    { x: 446, y: 85 },
    { x: 104, y: 192 },
    { x: 89, y: 178 },
    { x: 127, y: 189 },
  ],
  frogs: [
    { start: 0, pads: [0, 1] },
    { start: 2, pads: [2] },
    { start: 3, pads: [3] },
    { start: 4, pads: [4, 5, 6] },
  ],
  duckStarts: [
    { x: 430, y: 118 },
    { x: 404, y: 150 },
    { x: 446, y: 176 },
  ],
  water: { cell: WATER_CELL, mask: WATER_MASK },
  fireflies: [
    [24, 160, 6, -4],
    [50, 206, -5, -6],
    [94, 238, 7, -3],
    [150, 236, -6, -5],
    [178, 30, 5, 4],
    [238, 24, -7, 3],
    [348, 22, 6, 5],
    [464, 112, -5, 6],
    [468, 196, -6, -4],
    [118, 48, 4, 6],
  ],
  glints: [
    [200, 182, 5],
    [292, 206, 4],
    [338, 118, 5],
    [236, 236, 4],
    [372, 196, 5],
    [196, 112, 4],
    [318, 160, 3],
  ],
  rainRings: [
    [214, 120],
    [300, 108],
    [356, 168],
    [270, 196],
    [190, 160],
    [330, 232],
    [232, 250],
    [380, 120],
  ],
  lakeBottom: 270,
};

/** Picture px of the phone pictures -> phone scene grid px. */
const R = 1.4;
const g = (v: number) => Math.round((v / R) * 10) / 10;
const gp = (x: number, y: number): [number, number] => [g(x), g(y)];

export const PHONE: PondLayout = {
  key: 'phone',
  w: 343,
  h: 609,
  pics: { day: '/assets/bg/fishing-pond-phone.png', dusk: '/assets/bg/fishing-pond-phone-dusk.png', night: '/assets/bg/fishing-pond-phone-night.png' },
  ground: {
    pics: { day: '/assets/bg/fishing-pond-phone-ground.png', dusk: '/assets/bg/fishing-pond-phone-dusk-ground.png', night: '/assets/bg/fishing-pond-phone-night-ground.png' },
    h: 336,
    over: 16,
  },
  tree: {
    box: [0, g(86), g(113), g(121)],
    pics: { day: '/assets/bg/fishing-pond-phone-tree.png', dusk: '/assets/bg/fishing-pond-phone-tree-dusk.png', night: '/assets/bg/fishing-pond-phone-tree-night.png' },
  },
  fall: {
    // Picture px 370..480 x 118..266 (tools/pixelize/pond_fall.py ... 370 118 480 266 phone).
    box: { x: g(370), y: g(118), w: g(110), h: g(148) },
    mask: '/assets/bg/fishing-fall-phone-mask.png',
    tex: { day: '/assets/bg/fishing-fall-phone-day.png', dusk: '/assets/bg/fishing-fall-phone-dusk.png', night: '/assets/bg/fishing-fall-phone-night.png' },
    // The phone fall comes in steeply from the top right, then three steps, more upright lower down.
    steps: [
      { pts: [gp(450, 118), gp(480, 118), gp(458, 160), gp(424, 160)], skew: -40, s: 1.05 },
      { pts: [gp(424, 154), gp(460, 154), gp(442, 194), gp(394, 194)], skew: -34, s: 0.95 },
      { pts: [gp(388, 190), gp(434, 190), gp(420, 224), gp(380, 224)], skew: -17, s: 0.85 },
      { pts: [gp(372, 220), gp(420, 220), gp(418, 266), gp(370, 266)], skew: -5, s: 0.75 },
    ],
    lips: [
      [g(426), g(158), g(30)],
      [g(396), g(192), g(44)],
      [g(384), g(222), g(36)],
    ],
    foam: [
      [g(382), g(258), g(10)],
      [g(395), g(262), g(12)],
      [g(408), g(258), g(10)],
    ],
    spread: gp(395, 268),
  },
  waterfallFoot: [g(360), g(240), g(70), g(40)],
  // Package 7 (Ardian): the big oval crossing the whole lake was ugly; small, faint, quick rings near
  // the waterfall's foot only.
  waves: { x: g(395), y: g(270), rx: 46, ry: 22, mask: '/assets/bg/fishing-pond-phone-water.png', s: 5, peak: 0.3 },
  // The dock reaches x 92, rows 330..365 (picture px): TaniBot stands near its end.
  bot: { x: 53, y: 255 },
  hands: { x: 66, y: 232 },
  float: { x: 215, y: 330 },
  rodLen: 62,
  // Package 7 (Ardian): the same rod swing as on laptops (raised at rest, back over the shoulder, a
  // forward cast, the line curving out, plunk, a soft sag). The lily pad just up-right of the dock's
  // end is in the rod's reach, so no frog sits on it any more (frogs[0] stays on the pad next to it):
  // the rod may pass over that empty pad, never over a frog (web/test/rod-pose.test.ts).
  angles: WIDE.angles,
  bucket: { x: 26, y: 245 },
  frogSpots: [
    { x: g(158), y: g(293) },
    { x: g(196), y: g(290) },
    { x: g(322), y: g(260) },
    { x: g(461), y: g(296) },
    { x: g(112), y: g(560) },
    { x: g(145), y: g(554) },
    { x: g(91), y: g(537) },
  ],
  frogs: [
    { start: 1, pads: [1] },
    { start: 2, pads: [2] },
    { start: 3, pads: [3] },
    { start: 4, pads: [4, 5, 6] },
  ],
  duckStarts: [
    { x: 250, y: 260 },
    { x: 290, y: 300 },
    { x: 270, y: 420 },
  ],
  water: { cell: PHONE_WATER_CELL, mask: PHONE_WATER_MASK },
  fireflies: [
    [20, 190, 6, -4],
    [40, 300, -5, -6],
    [26, 420, 7, -3],
    [70, 470, -6, -5],
    [130, 482, 5, 4],
    [170, 160, -7, 3],
    [230, 150, 6, 5],
    [334, 250, -5, 6],
    [336, 470, -6, -4],
    [250, 530, 4, 6],
  ],
  glints: [
    [120, 262, 5],
    [200, 300, 4],
    [262, 262, 5],
    [150, 350, 4],
    [240, 400, 5],
    [300, 340, 3],
    [190, 455, 4],
  ],
  rainRings: [
    [110, 285],
    [180, 255],
    [250, 300],
    [140, 370],
    [225, 365],
    [300, 290],
    [200, 432],
    [272, 420],
  ],
  lakeBottom: g(PHONE_LAKE_BOTTOM_PX),
};

/** The layout for a screen: upright phones get the phone pictures, everything else the 16:9 pond. */
export const layoutFor = (W: number, H: number): PondLayout => (W < H && W < 1024 ? PHONE : WIDE);
