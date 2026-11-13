// Makes the Tree NFT images (web/public/nft/*.png, 512x512) from the game's own tree code
// (web/src/art/trees.tsx: treeRows + treePalette, the default look), so the NFT shows the same
// pixel tree as the garden. The pohon contract builds each token's media URL as
// `{media_base_url}{species}_{stage}.png` or `{species}_memorial.png` (contracts/pohon/src/lib.rs
// media_url), so there is one picture per species and stage (quality is in the NFT's title, not
// in the file name): 3 species x 5 stages + 3 Memorial = 18 files.
//
// Square, opaque background (day sky + grass + soil; Memorial = dusk sky with stars and a faded
// tree, like the grey Memorial Tree in the garden), whole-pixel scaling only (sharp edges).
// No new dependency: the tree code is loaded with the web's Vite (SSR module loader), the PNG is
// written with node:zlib.
//
// Usage (from the repo root): node tools/nft/make-nft-art.mjs [outDir]   (default web/public/nft)
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';

const ROOT = resolve(import.meta.dirname, '../..');
const WEB = join(ROOT, 'web');
const OUT = resolve(process.argv[2] ?? join(WEB, 'public/nft'));
const SIZE = 512;

const require = createRequire(join(WEB, 'package.json'));
const { createServer } = await import(require.resolve('vite'));
const vite = await createServer({ root: WEB, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom' });
const { treeRows, treePalette } = await vite.ssrLoadModule('/src/art/trees.tsx');
await vite.close();

const SPECIES = ['mango', 'rambutan', 'durian'];
const STAGES = ['seed', 'sprout', 'tree', 'fruiting', 'old'];

// Background colours (pixel art, not UI: see the Design system note in CLAUDE.md).
const DAY_SKY = ['#7FCBE6', '#8FD4EB', '#A0DDF0', '#B3E6F3', '#C7EEF5', '#DCF5F2'];
const DUSK_SKY = ['#2A1E5C', '#3A2A7A', '#4B3796', '#5B3DB8', '#7656D0', '#9A7FE0'];
const GRASS = ['#6FBF7F', '#4F9E62', '#2E7D4F'];
const DUSK_GRASS = ['#3E7A5A', '#2F6347', '#1E5A38'];
const SOIL = '#6B4A2F';
const SOIL_DARK = '#4F3420';
const STAR = '#FFF4C2';

/** Ground line (y in px): the tree's grid row 37 (roots / mound) stands on it. */
const GROUND_Y = 456;
const BAND = 8; // background drawn in 8 px blocks

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

/** The garden's Memorial look: CSS grayscale(0.55) brightness(0.95), per colour. */
function memorialTint([r, g, b]) {
  const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const mix = (c) => Math.round((c * 0.45 + l * 0.55) * 0.95);
  return [mix(r), mix(g), mix(b)];
}

function picture(species, stage, memorial) {
  const px = new Uint8Array(SIZE * SIZE * 3);
  const put = (x, y, rgb) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    const i = (y * SIZE + x) * 3;
    px[i] = rgb[0];
    px[i + 1] = rgb[1];
    px[i + 2] = rgb[2];
  };
  const rect = (x0, y0, w, h, rgb) => {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, rgb);
  };

  // Sky: stepped bands (no smooth gradient), in whole 8 px blocks.
  const sky = (memorial ? DUSK_SKY : DAY_SKY).map(hex);
  const bandH = Math.ceil(GROUND_Y / BAND / sky.length) * BAND;
  for (let i = 0; i < sky.length; i++) rect(0, i * bandH, SIZE, Math.min(bandH, GROUND_Y - i * bandH), sky[i]);
  // Dithered seam between two bands (a checker row of 8 px blocks).
  for (let i = 1; i < sky.length; i++)
    for (let x = 0; x < SIZE; x += BAND) if ((x / BAND) % 2 === 0) rect(x, i * bandH - BAND, BAND, BAND, sky[i]);
  if (memorial) {
    // A few fixed stars (8 px) in the upper sky.
    for (const [x, y] of [[48, 40], [120, 96], [208, 32], [312, 72], [400, 40], [456, 120], [72, 168], [440, 200]]) rect(x, y, BAND, BAND, hex(STAR));
  }

  // Ground: grass rows, then soil with darker specks.
  rect(0, GROUND_Y, SIZE, SIZE - GROUND_Y, hex(SOIL));
  const grass = memorial ? DUSK_GRASS : GRASS;
  grass.forEach((c, i) => rect(0, GROUND_Y + i * BAND, SIZE, BAND, hex(c)));
  for (let x = 0; x < SIZE; x += BAND) if ((x / BAND) % 3 === 1) rect(x, GROUND_Y - BAND, BAND, BAND, hex(grass[2])); // grass tufts
  for (const [x, y] of [[24, 488], [96, 496], [176, 488], [264, 504], [344, 488], [424, 496], [488, 504]]) rect(x, y, BAND, BAND, hex(SOIL_DARK));

  // The tree, from the game's code (default look), scaled by whole pixels.
  let rows = treeRows(species, memorial ? 'old' : stage);
  const palette = { ...treePalette(species, memorial ? 'old' : stage), ...FRUIT_EXTRA };
  if (!memorial && stage === 'fruiting') rows = biggerFruit(species, rows);
  // Seeds and sprouts are tiny: bigger whole pixels, and their soil mound (grid rows 37-39) sits ON
  // the grass so it does not melt into the soil. Grown trees stand with their roots (row 37) on it.
  const S = memorial ? 12 : stage === 'seed' ? 24 : stage === 'sprout' ? 16 : 12;
  const W = rows[0].length;
  const x0 = Math.round((SIZE - W * S) / 2);
  const y0 = !memorial && (stage === 'seed' || stage === 'sprout') ? GROUND_Y + BAND - 40 * S : GROUND_Y - 37 * S;
  rows.forEach((row, ty) =>
    [...row].forEach((c, tx) => {
      if (c === '.') return;
      const rgb = hex(palette[c]);
      rect(x0 + tx * S, y0 + ty * S, S, S, memorial ? memorialTint(rgb) : rgb);
    }),
  );
  return px;
}

// ---------- Bigger fruit (NFT pictures only; the garden keeps the game's small fruit) ----------
// At 512 px the game's fruit (mango / rambutan 2x2, durian 3x3 tree pixels) read as specks, so the
// fruiting pictures take the game's fruit out (its spots are kept) and hang bigger fruit there:
// mango and rambutan about 1.5x, durian about 2x with a jagged spiky edge and a green-yellow shine,
// plus a few more durians. Letters use the tree palette (+ FRUIT_EXTRA for the durian's shine).

const FRUIT_EXTRA = { L: '#D4E36A', w: '#FFF0A0' };
const FRUIT_CHARS = new Set(['y', 'O', 'Y', 'h', 'r', 'R', 'q', 'Q', 'z']);
const LEAF_CHARS = new Set(['G', 'g', 'd', 'o']);

const BIG_FRUIT = {
  mango: [
    '.d..',
    'wyy.',
    'yyOO',
    'yOOY',
    '.OYY',
    '..Y.',
  ],
  rambutan: [
    '.R.R.',
    'RhrrR',
    '.hrrR',
    'RrrrR',
    '.RrR.',
    '..R..',
  ],
  durian: [
    '....z....',
    '.z..z..z.',
    '..zLqQz..',
    'zzLqLqQzz',
    '.zqLqQQz.',
    'zzqQqQQzz',
    '.zQqQQQz.',
    'zzQQQQQzz',
    '..zQQQz..',
    '.z..z..z.',
  ],
};

/** Connected groups of fruit pixels in the game's fruiting picture (one per fruit). */
function fruitGroups(g) {
  const seen = new Set();
  const groups = [];
  for (let y = 0; y < g.length; y++)
    for (let x = 0; x < g[0].length; x++) {
      if (!FRUIT_CHARS.has(g[y][x]) || seen.has(y * 100 + x)) continue;
      const stack = [[x, y]];
      const cells = [];
      seen.add(y * 100 + x);
      while (stack.length) {
        const [cx, cy] = stack.pop();
        cells.push([cx, cy]);
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (FRUIT_CHARS.has(g[ny]?.[nx]) && !seen.has(ny * 100 + nx)) {
            seen.add(ny * 100 + nx);
            stack.push([nx, ny]);
          }
        }
      }
      groups.push(cells);
    }
  return groups;
}

function biggerFruit(species, rows) {
  const g = rows.map((r) => [...r]);
  const groups = fruitGroups(g);
  // Take the small fruit out: each fruit pixel becomes the leaf colour most common around it.
  for (let pass = 0; pass < 4; pass++)
    for (const cells of groups)
      for (const [x, y] of cells) {
        if (!FRUIT_CHARS.has(g[y][x])) continue;
        const count = {};
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c = g[y + dy]?.[x + dx];
          if (LEAF_CHARS.has(c) && c !== 'o') count[c] = (count[c] ?? 0) + 1;
        }
        const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
        if (best) g[y][x] = best[0];
        else if (pass === 3) g[y][x] = 'g';
      }
  // Hang the bigger fruit at the old spots (centre x, top a little above the old fruit).
  // Durian: fixed spots on the branch ends and under the crown (the game's 3 spots are too close
  // together for fruit twice the size). [centre x, top row] in tree pixels.
  const DURIAN_SPOTS = [[8, 20], [24, 20], [16, 24], [20, 10]];
  const spots = species === 'durian' ? DURIAN_SPOTS : groups.map((cells) => {
    const xs = cells.map((c) => c[0]);
    const ys = cells.map((c) => c[1]);
    return [Math.round((Math.min(...xs) + Math.max(...xs)) / 2), Math.min(...ys)];
  });
  const sprite = BIG_FRUIT[species];
  const w = sprite[0].length;
  const placed = [];
  for (const [cx, top] of spots.sort((a, b) => a[1] - b[1])) {
    const x0 = cx - Math.floor(w / 2);
    const y0 = top - 1;
    // Keep fruit apart: skip a spot that would cover most of another fruit.
    if (species !== 'durian' && placed.some(([px, py]) => Math.abs(px - x0) < w - 2 && Math.abs(py - y0) < sprite.length - 3)) continue;
    placed.push([x0, y0]);
    sprite.forEach((r, dy) =>
      [...r].forEach((c, dx) => {
        if (c === '.') return;
        const y = y0 + dy;
        const x = x0 + dx;
        if (y >= 0 && y < g.length && x >= 0 && x < g[0].length) g[y][x] = c;
      }),
    );
  }
  return g.map((r) => r.join(''));
}

function png(rgb) {
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB, opaque
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  for (let y = 0; y < SIZE; y++) {
    raw[y * (SIZE * 3 + 1)] = 0; // filter: none
    Buffer.from(rgb.buffer, y * SIZE * 3, SIZE * 3).copy(raw, y * (SIZE * 3 + 1) + 1);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

mkdirSync(OUT, { recursive: true });
const files = [];
for (const species of SPECIES) {
  for (const stage of STAGES) files.push([`${species}_${stage}.png`, picture(species, stage, false)]);
  files.push([`${species}_memorial.png`, picture(species, 'old', true)]);
}
for (const [name, rgb] of files) writeFileSync(join(OUT, name), png(rgb));
console.log(`wrote ${files.length} files to ${OUT}`);
