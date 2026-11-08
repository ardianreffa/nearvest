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
  /** How many fruits hang in the crown when fruiting. */
  fruitCount: number;
  branches: [number, number, number, number][];
}

/**
 * Three crown shapes per species, each with its own silhouette:
 * mango = round and dense, rambutan = wide and lumpy, durian = tall and layered.
 * A tree keeps its shape for life (picked from its NFT / tree id, see variantOf).
 */
const SHAPES: Record<Species, Shape[]> = {
  mango: [
    // Wide, dense dome on a short thick trunk.
    { trunkTop: 22, trunkW: 4, fruitCount: 6, branches: [], canopy: [{ cx: 16, cy: 15, r: 9 }, { cx: 8.5, cy: 18, r: 6 }, { cx: 23.5, cy: 18, r: 6 }, { cx: 16, cy: 9, r: 6.5 }] },
    // Rounder and taller.
    { trunkTop: 21, trunkW: 4, fruitCount: 6, branches: [], canopy: [{ cx: 16, cy: 13, r: 9.5 }, { cx: 9, cy: 17, r: 6 }, { cx: 23, cy: 17, r: 6 }, { cx: 16, cy: 7, r: 5.5 }] },
    // Low and broad, two bumps on top.
    { trunkTop: 23, trunkW: 4, fruitCount: 7, branches: [], canopy: [{ cx: 16, cy: 16, r: 9 }, { cx: 7.5, cy: 19, r: 6 }, { cx: 24.5, cy: 19, r: 6 }, { cx: 12, cy: 11, r: 5.5 }, { cx: 20, cy: 11, r: 5.5 }] },
  ],
  rambutan: [
    // Wide, lumpy crown with many small bumps.
    { trunkTop: 24, trunkW: 3, fruitCount: 7, branches: [], canopy: [{ cx: 16, cy: 16, r: 7 }, { cx: 9, cy: 13, r: 5 }, { cx: 23, cy: 13, r: 5 }, { cx: 6.5, cy: 19, r: 4.5 }, { cx: 25.5, cy: 19, r: 4.5 }, { cx: 16, cy: 9.5, r: 4.5 }, { cx: 12, cy: 20, r: 4 }, { cx: 20, cy: 20, r: 4 }] },
    // Flat umbrella.
    { trunkTop: 23, trunkW: 3, fruitCount: 7, branches: [], canopy: [{ cx: 16, cy: 14, r: 6 }, { cx: 9, cy: 15, r: 5.5 }, { cx: 23, cy: 15, r: 5.5 }, { cx: 5.5, cy: 18, r: 4 }, { cx: 26.5, cy: 18, r: 4 }, { cx: 16, cy: 19, r: 5 }] },
    // Two lobes.
    { trunkTop: 24, trunkW: 3, fruitCount: 7, branches: [], canopy: [{ cx: 11, cy: 14, r: 6.5 }, { cx: 21, cy: 14, r: 6.5 }, { cx: 16, cy: 10, r: 5 }, { cx: 7, cy: 19, r: 4.5 }, { cx: 25, cy: 19, r: 4.5 }, { cx: 16, cy: 19, r: 5 }] },
  ],
  durian: [
    // Tall thin trunk, layered narrow crown, big spiky fruit on the branches.
    { trunkTop: 6, trunkW: 3, fruitCount: 3, branches: [[16, 18, 9, 24], [16, 18, 23, 24], [16, 12, 12, 16]], canopy: [{ cx: 16, cy: 7, r: 5.5 }, { cx: 11, cy: 14, r: 5 }, { cx: 21, cy: 14, r: 5 }, { cx: 9, cy: 21, r: 4 }, { cx: 23, cy: 21, r: 4 }] },
    // A pagoda of tiers, wider towards the bottom.
    { trunkTop: 4, trunkW: 3, fruitCount: 3, branches: [[16, 20, 9, 25], [16, 20, 23, 25]], canopy: [{ cx: 16, cy: 4.5, r: 3.5 }, { cx: 13, cy: 10.5, r: 3.8 }, { cx: 19, cy: 10.5, r: 3.8 }, { cx: 10.5, cy: 16.5, r: 4.2 }, { cx: 21.5, cy: 16.5, r: 4.2 }, { cx: 16, cy: 16, r: 3.5 }, { cx: 8, cy: 22.5, r: 4 }, { cx: 24, cy: 22.5, r: 4 }] },
    // Uneven tiers, a little lopsided.
    { trunkTop: 5, trunkW: 3, fruitCount: 3, branches: [[16, 18, 9, 24], [16, 17, 23, 23]], canopy: [{ cx: 17, cy: 5.5, r: 4 }, { cx: 12.5, cy: 11.5, r: 4 }, { cx: 20.5, cy: 11, r: 4.2 }, { cx: 9.5, cy: 18, r: 4.2 }, { cx: 22.5, cy: 17.5, r: 4.5 }, { cx: 16, cy: 17, r: 3.2 }, { cx: 8, cy: 23, r: 3.5 }] },
  ],
};

/** Per-tree look: crown shape, lean (top moves -1..1 px) and trunk height (-2..+1 px). */
export interface TreeLook {
  shape: number;
  lean: number;
  lift: number;
}

/** A stable look for a tree from its NFT token id (or tree id). 0 = the default look. */
export function variantOf(seed: string | number | null | undefined): TreeLook {
  if (seed === null || seed === undefined || seed === '') return { shape: 0, lean: 0, lift: 0 };
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h >>>= 0;
  return { shape: h % 3, lean: ((h >>> 4) % 3) - 1, lift: [-2, -1, 0, 1][(h >>> 8) % 4] };
}

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

function trunk(g: Grid, shape: Shape, top: number, lean: number) {
  const x0 = Math.round(16 - shape.trunkW / 2);
  const base = H - 4;
  for (let y = top; y < H - 3; y++) {
    // A leaning tree: the trunk shifts towards the top.
    const dx = Math.round((lean * (base - y)) / Math.max(1, base - top));
    for (let i = 0; i < shape.trunkW; i++) set(g, x0 + i + dx, y, i === 0 ? 'n' : i === shape.trunkW - 1 ? 'B' : 'b');
  }
  // roots
  set(g, x0 - 1, H - 4, 'B');
  set(g, x0 + shape.trunkW, H - 4, 'B');
  set(g, x0 - 2, H - 3, 'B');
  set(g, x0 + shape.trunkW + 1, H - 3, 'B');
}

/** Fills a canopy from overlapping circles with light from the top-left and a dark outline. */
function canopy(g: Grid, blobs: Blob[], scale: number, offsetY: number, sparse: boolean, dx = 0) {
  const inside = (x: number, y: number) =>
    blobs.some((b) => {
      const cx = 16 + (b.cx - 16) * scale + dx;
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

/** A tree in layers: trunk (still) and crown (sways in the wind, fruit included). */
export interface TreeLayers {
  trunk: string[];
  crown: string[];
  /** Row where the crown is split: the top part sways more than the bottom. */
  split: number;
}

/**
 * Fruit spots: one per column across the crown (so they spread left to right), at a height
 * that varies from column to column, in the lower part of the crown; stable for a shape.
 */
function fruitSpots(g: Grid, count: number, species: Species): [number, number][] {
  const inner = (x: number, y: number) => 'Ggd'.includes(g[y]?.[x] ?? '.') && 'Ggd'.includes(g[y + 1]?.[x + 1] ?? '.') && 'Ggd'.includes(g[y]?.[x - 1] ?? '.');
  let top = H;
  let bottom = 0;
  let left = W;
  let right = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if ('Ggd'.includes(g[y][x])) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
        left = Math.min(left, x);
        right = Math.max(right, x);
      }
  const from = Math.ceil(species === 'durian' ? top + (bottom - top) * 0.45 : top + (bottom - top) * 0.25);
  const picked: [number, number][] = [];
  const colW = (right - left - 2) / count;
  for (let i = 0; i < count; i++) {
    const cx = Math.round(left + 1 + colW * (i + 0.5));
    const options: [number, number][] = [];
    for (let y = from; y <= bottom - 2; y++) for (let dx = -1; dx <= 1; dx++) if (inner(cx + dx, y)) options.push([cx + dx, y]);
    if (!options.length) continue;
    // Alternate high and low spots, with a little per-column wobble.
    const want = i % 2 ? 0.75 : 0.3;
    options.sort((a, b) => Math.abs((a[1] - from) / Math.max(1, bottom - from) - want) - Math.abs((b[1] - from) / Math.max(1, bottom - from) - want));
    const pick = options[Math.min(options.length - 1, (i * 5) % 3)];
    if (picked.every((p) => Math.abs(p[0] - pick[0]) >= 2 || Math.abs(p[1] - pick[1]) >= 3)) picked.push(pick);
  }
  return picked;
}

export function treeLayers(species: Species, stage: Stage, look: TreeLook = { shape: 0, lean: 0, lift: 0 }): TreeLayers {
  const g = empty();
  const crown = empty();
  const shape = SHAPES[species][look.shape] ?? SHAPES[species][0];
  if (stage === 'seed') {
    mound(g, species === 'mango' ? 'y' : species === 'rambutan' ? 'r' : 'q');
    return { trunk: g.map((r) => r.join('')), crown: crown.map((r) => r.join('')), split: H };
  }
  if (stage === 'sprout') {
    sprout(g, species);
    return { trunk: g.map((r) => r.join('')), crown: crown.map((r) => r.join('')), split: H };
  }
  // A young tree is the same species shape, smaller and lower.
  const young = stage === 'tree';
  const scale = young ? 0.72 : 1;
  const offsetY = (young ? 11 : 0) - (young ? 0 : look.lift);
  trunk(g, shape, Math.round(shape.trunkTop * scale + offsetY), look.lean);
  const t = (v: number, isY: boolean) => (isY ? Math.round(v * scale + offsetY) : Math.round(16 + (v - 16) * scale) + look.lean);
  for (const [x0, y0, x1, y1] of shape.branches) line(crown, t(x0, false), t(y0, true), t(x1, false), t(y1, true), 'B');
  const blobs = young && species !== 'durian' ? shape.canopy.filter((b) => b.cy > 10) : shape.canopy;
  canopy(crown, blobs, scale, offsetY, stage === 'old', look.lean);
  if (stage === 'fruiting') for (const [x, y] of fruitSpots(crown, shape.fruitCount, species)) fruit(crown, species, x, y);
  if (stage === 'old') {
    // bare twigs poking out of the thinning crown
    line(crown, 16 + look.lean, 10 - look.lift, 11 + look.lean, 5 - look.lift, 'B');
    line(crown, 17 + look.lean, 9 - look.lift, 22 + look.lean, 4 - look.lift, 'B');
  }
  const rows = crown.map((r) => r.join(''));
  const filled = rows.map((r, i) => (/[^.]/.test(r) ? i : -1)).filter((i) => i >= 0);
  const split = filled.length ? Math.round((filled[0] + filled[filled.length - 1]) / 2) : H;
  return { trunk: g.map((r) => r.join('')), crown: rows, split };
}

/** The whole tree as one picture (share cards). */
export function treeRows(species: Species, stage: Stage, look?: TreeLook): string[] {
  const { trunk: tr, crown } = treeLayers(species, stage, look);
  return tr.map((r, y) => [...r].map((c, x) => (crown[y][x] !== '.' ? crown[y][x] : c)).join(''));
}

/** Colors for a tree's rows (species leaves, faded leaves when old). */
export function treePalette(species: Species, stage: Stage): Record<string, string> {
  return { ...TREE_PALETTE, ...(stage === 'old' ? OLD_LEAF : LEAF[species]) };
}

const cache = new Map<string, TreeLayers>();

/**
 * The first pixel row (from the top of the 32x40 canvas) that a tree actually fills: a sprout
 * only fills the bottom rows. Labels (Thirsty, timers) sit just above this row, close to the tree.
 */
export function treeTopRow(species: Species, stage: Stage, seed?: string | number | null): number {
  const look = variantOf(seed);
  const key = `${species}-${stage}-${look.shape}-${look.lean}-${look.lift}`;
  let layers = cache.get(key);
  if (!layers) {
    layers = treeLayers(species, stage, look);
    cache.set(key, layers);
  }
  const { trunk, crown } = layers;
  for (let y = 0; y < H; y++) if (/[^.]/.test(trunk[y]) || /[^.]/.test(crown[y])) return y;
  return H;
}

/**
 * A tree. `seed` (NFT token id or tree id) picks its own look for life. The crown sways in
 * the wind in whole pixels (top part a little more), fruit included; now and then a leaf falls.
 */
export function TreePixels({ species, stage, quality, scale = 2, seed }: { species: Species; stage: Stage; quality: Quality; scale?: number; seed?: string | number | null }) {
  const look = variantOf(seed);
  const key = `${species}-${stage}-${look.shape}-${look.lean}-${look.lift}`;
  let layers = cache.get(key);
  if (!layers) {
    layers = treeLayers(species, stage, look);
    cache.set(key, layers);
  }
  const palette = treePalette(species, stage);
  const { trunk: tr, crown, split } = layers;
  const hasCrown = split < H;
  const top = hasCrown ? crown.map((r, y) => (y < split ? r : '.'.repeat(W))) : null;
  const bottom = hasCrown ? crown.map((r, y) => (y >= split ? r : '.'.repeat(W))) : null;
  // Out of step per tree, so a row of trees does not sway in unison.
  const h = typeof seed === 'number' ? seed : String(seed ?? '').length * 7 + (String(seed ?? '').charCodeAt(0) || 0);
  const delay = `${-((h * 0.73) % 4).toFixed(2)}s`;
  const leafX = 30 + ((h * 37) % 40);
  return (
    <div class={`tree tree-${stage} q-${quality}`} style={{ '--tpx': `${scale}px`, '--sway-delay': delay, '--leaf': palette.G }}>
      <Pixels rows={tr} palette={palette} scale={scale} />
      {bottom && <Pixels rows={bottom} palette={palette} scale={scale} class="crown crown-low" />}
      {top && <Pixels rows={top} palette={palette} scale={scale} class="crown crown-top" />}
      {hasCrown && <i class="leaf-fall" style={{ left: `${leafX}%`, top: `${(split / H) * 100}%`, width: scale * 2, height: scale, animationDelay: `${(h * 1.7) % 11}s` }} aria-hidden="true" />}
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
