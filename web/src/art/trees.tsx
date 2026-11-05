// Procedural pixel trees: a different silhouette per species and stage.
// Everything here is original art generated in code (no external images).

import type { Quality, Species, Stage } from '../api';
import { Pixels } from '../sprites';

const W = 32;
const H = 40;

type Grid = string[][];

const TREE_PALETTE: Record<string, string> = {
  // trunk
  b: '#7A5230',
  B: '#4F3420',
  n: '#9B6B3E',
  // leaves (per species, overridden below)
  G: '#5FC27A',
  g: '#2E8B57',
  d: '#1D5E3B',
  o: '#123B26',
  // fruit
  y: '#FFD84A',
  O: '#F59E0B',
  Y: '#C9711A',
  r: '#EF4444',
  R: '#991B1B',
  h: '#FCA5A5',
  q: '#A3C94A',
  Q: '#6B8E23',
  z: '#3F5A1A',
  // soil
  s: '#6B4A2F',
  S: '#4A321F',
  k: '#1B1B2F',
};

const LEAF: Record<Species, Record<string, string>> = {
  mango: { G: '#4FBF6E', g: '#24804A', d: '#165A33', o: '#0D3A21' },
  rambutan: { G: '#8BD66B', g: '#4AA54A', d: '#2F7A36', o: '#1C4D22' },
  durian: { G: '#5DAA6A', g: '#2F7550', d: '#1F5139', o: '#123224' },
};
const OLD_LEAF = { G: '#B5A86A', g: '#8C7F4A', d: '#655A33', o: '#3E3720' };

interface Blob {
  cx: number;
  cy: number;
  r: number;
}

interface Shape {
  trunkTop: number;
  trunkW: number;
  canopy: Blob[];
  fruits: [number, number][];
  branches: [number, number, number, number][];
}

const SHAPES: Record<Species, Shape> = {
  // Wide, dense dome on a short thick trunk.
  mango: {
    trunkTop: 22,
    trunkW: 4,
    canopy: [
      { cx: 16, cy: 15, r: 9 },
      { cx: 8.5, cy: 18, r: 6 },
      { cx: 23.5, cy: 18, r: 6 },
      { cx: 16, cy: 9, r: 6.5 },
    ],
    fruits: [[9, 22], [14, 21], [21, 22], [24, 17], [12, 16], [19, 14]],
    branches: [],
  },
  // Bushy, lumpy round crown, lighter green, red clusters.
  rambutan: {
    trunkTop: 24,
    trunkW: 3,
    canopy: [
      { cx: 16, cy: 16, r: 7.5 },
      { cx: 10, cy: 12, r: 5 },
      { cx: 22, cy: 12, r: 5 },
      { cx: 8, cy: 19, r: 5 },
      { cx: 24, cy: 19, r: 5 },
      { cx: 16, cy: 9, r: 4.5 },
    ],
    fruits: [[8, 21], [13, 22], [20, 22], [24, 21], [11, 14], [21, 13], [16, 18]],
    branches: [],
  },
  // Tall thin trunk, layered narrow crown, big spiky fruit on the branches.
  durian: {
    trunkTop: 6,
    trunkW: 3,
    canopy: [
      { cx: 16, cy: 7, r: 5.5 },
      { cx: 11, cy: 14, r: 5 },
      { cx: 21, cy: 14, r: 5 },
      { cx: 9, cy: 21, r: 4 },
      { cx: 23, cy: 21, r: 4 },
    ],
    fruits: [[10, 25], [21, 25], [14, 19]],
    branches: [[16, 18, 9, 24], [16, 18, 23, 24], [16, 12, 12, 16]],
  },
};

function empty(): Grid {
  return Array.from({ length: H }, () => Array.from({ length: W }, () => '.'));
}

function set(g: Grid, x: number, y: number, c: string) {
  if (x >= 0 && x < W && y >= 0 && y < H) g[y][x] = c;
}

function line(g: Grid, x0: number, y0: number, x1: number, y1: number, c: string) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    set(g, Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t), c);
  }
}

function trunk(g: Grid, shape: Shape, top: number) {
  const x0 = Math.round(16 - shape.trunkW / 2);
  for (let y = top; y < H - 3; y++) {
    for (let i = 0; i < shape.trunkW; i++) set(g, x0 + i, y, i === 0 ? 'n' : i === shape.trunkW - 1 ? 'B' : 'b');
  }
  // roots
  set(g, x0 - 1, H - 4, 'B');
  set(g, x0 + shape.trunkW, H - 4, 'B');
  set(g, x0 - 2, H - 3, 'B');
  set(g, x0 + shape.trunkW + 1, H - 3, 'B');
}

/** Fills a canopy from overlapping circles with light from the top-left and a dark outline. */
function canopy(g: Grid, blobs: Blob[], scale: number, offsetY: number, sparse: boolean) {
  const inside = (x: number, y: number) =>
    blobs.some((b) => {
      const cx = 16 + (b.cx - 16) * scale;
      const cy = b.cy * scale + offsetY;
      return (x - cx) ** 2 + (y - cy) ** 2 <= (b.r * scale) ** 2;
    });
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!inside(x + 0.5, y + 0.5)) continue;
      if (sparse && (x * 7 + y * 13) % 5 === 0) continue; // old trees lose leaves
      const edge = !inside(x - 0.5, y + 0.5) || !inside(x + 1.5, y + 0.5) || !inside(x + 0.5, y - 0.5) || !inside(x + 0.5, y + 1.5);
      if (edge) {
        g[y][x] = 'o';
        continue;
      }
      // light from top-left, with a little dithering between tones
      const light = (x - 10) * 0.6 + (y - 6);
      const dither = (x + y) % 2 === 0;
      if (light < -2 || (light < 1 && dither)) g[y][x] = 'G';
      else if (light > 14 || (light > 11 && dither)) g[y][x] = 'd';
      else g[y][x] = 'g';
    }
  }
}

function fruit(g: Grid, species: Species, x: number, y: number) {
  if (species === 'mango') {
    set(g, x, y - 1, 'd');
    set(g, x, y, 'y');
    set(g, x + 1, y, 'O');
    set(g, x, y + 1, 'O');
    set(g, x + 1, y + 1, 'Y');
  } else if (species === 'rambutan') {
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) set(g, x + dx, y + dy, dx + dy === 0 ? 'h' : 'r');
    set(g, x - 1, y, 'R');
    set(g, x + 2, y + 1, 'R');
    set(g, x + 1, y - 1, 'R');
  } else {
    set(g, x + 1, y - 1, 'z');
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++) set(g, x + dx, y + dy, (dx + dy) % 2 === 0 ? 'q' : 'Q');
    set(g, x - 1, y + 1, 'z');
    set(g, x + 3, y + 1, 'z');
    set(g, x + 1, y + 3, 'z');
  }
}

function mound(g: Grid, seedColor: string) {
  const rows = ['....ssssssss....', '..ssSsssssSsss..', '.ssssssssssssss.'];
  rows.forEach((r, i) => [...r].forEach((c, x) => c !== '.' && set(g, x + 8, H - 3 + i, c)));
  set(g, 15, H - 4, seedColor);
  set(g, 16, H - 4, seedColor);
}

function sprout(g: Grid, species: Species) {
  if (species === 'durian') {
    line(g, 16, H - 4, 16, H - 16, 'd');
    for (const [x, y] of [[13, H - 15], [14, H - 16], [15, H - 16], [17, H - 13], [18, H - 13], [19, H - 12]]) set(g, x, y, 'g');
    set(g, 13, H - 14, 'G');
    set(g, 19, H - 13, 'G');
  } else if (species === 'rambutan') {
    line(g, 16, H - 4, 16, H - 11, 'd');
    for (const [cx, cy] of [[13, H - 11], [19, H - 11], [16, H - 13]]) {
      set(g, cx, cy, 'g');
      set(g, cx + 1, cy, 'G');
      set(g, cx, cy + 1, 'g');
    }
  } else {
    line(g, 16, H - 4, 16, H - 10, 'd');
    for (const [x, y, c] of [[12, H - 11, 'G'], [13, H - 11, 'g'], [14, H - 10, 'g'], [13, H - 10, 'G'], [18, H - 10, 'g'], [19, H - 11, 'g'], [20, H - 11, 'G'], [19, H - 10, 'G']] as const) set(g, x, y, c);
  }
  mound(g, 's');
}

export function treeRows(species: Species, stage: Stage): string[] {
  const g = empty();
  const shape = SHAPES[species];
  if (stage === 'seed') {
    mound(g, species === 'mango' ? 'y' : species === 'rambutan' ? 'r' : 'q');
  } else if (stage === 'sprout') {
    sprout(g, species);
  } else {
    // A young tree is the same species shape, smaller and lower.
    const young = stage === 'tree';
    const scale = young ? 0.72 : 1;
    const offsetY = young ? 11 : 0;
    trunk(g, shape, Math.round(shape.trunkTop * scale + offsetY));
    for (const [x0, y0, x1, y1] of shape.branches) {
      const t = (v: number, isY: boolean) => (isY ? Math.round(v * scale + offsetY) : Math.round(16 + (v - 16) * scale));
      line(g, t(x0, false), t(y0, true), t(x1, false), t(y1, true), 'B');
    }
    const blobs = young && species !== 'durian' ? shape.canopy.filter((b) => b.cy > 10) : shape.canopy;
    canopy(g, blobs, scale, offsetY, stage === 'old');
    if (stage === 'fruiting') for (const [x, y] of shape.fruits) fruit(g, species, x, y);
    if (stage === 'old') {
      // bare twigs poking out of the thinning crown
      line(g, 16, 10, 11, 5, 'B');
      line(g, 17, 9, 22, 4, 'B');
    }
  }
  return g.map((r) => r.join(''));
}

const cache = new Map<string, string[]>();

export function TreePixels({ species, stage, quality, scale = 2 }: { species: Species; stage: Stage; quality: Quality; scale?: number }) {
  const key = `${species}-${stage}`;
  let rows = cache.get(key);
  if (!rows) {
    rows = treeRows(species, stage);
    cache.set(key, rows);
  }
  const palette = { ...TREE_PALETTE, ...(stage === 'old' ? OLD_LEAF : LEAF[species]) };
  return (
    <div class={`tree tree-${stage} q-${quality}`}>
      <Pixels rows={rows} palette={palette} scale={scale} />
      {quality !== 'common' && stage !== 'seed' && (
        <div class="twinkles" aria-hidden="true">
          <i style="left:18%;top:20%" />
          <i style="left:72%;top:30%;animation-delay:.6s" />
          <i style="left:45%;top:8%;animation-delay:1.2s" />
        </div>
      )}
    </div>
  );
}
