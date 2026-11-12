// A big, clear Golden Arowana for the share card (2026-11-12, Ardian: the small catch icon looked like
// a blob there). Original pixel art made here from simple shapes (no image copied): a long gold body
// with a row of large scales, an upturned mouth with two chin barbels, a big eye, the long back and
// belly fins near the tail and a fan tail; a dark outline all round. Faces left. Pixel art keeps its
// own palette (CLAUDE.md Design system).

export const AROWANA_PALETTE: Record<string, string> = {
  k: '#3a2408', // outline
  Y: '#c98b12', // dark gold (scale edges, fins)
  y: '#f5c542', // gold
  z: '#fff1a8', // light gold (belly, shine)
  r: '#e5484d', // fin tips
  w: '#fffaf0', // eye white
  e: '#1b1b2f', // eye
};

const W = 48;
const H = 20;

function draw(): string[] {
  const g: string[][] = Array.from({ length: H }, () => Array(W).fill('.'));
  const set = (x: number, y: number, c: string) => {
    if (x >= 0 && y >= 0 && x < W && y < H) g[y][x] = c;
  };
  // Body: a long ellipse, a little thinner toward the tail.
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const t = Math.min(1, Math.max(0, (px - 4) / 34));
      const ry = 5.6 - 2.2 * t * t;
      if (px > 3 && px < 39 && Math.abs(py - 10) <= ry * Math.sqrt(Math.max(0, 1 - ((px - 21) / 18.5) ** 2)) + 0.4) {
        const belly = py > 10 + ry * 0.35;
        set(x, y, belly ? 'z' : 'y');
      }
    }
  // Big scales: three rows of arcs.
  for (let sx = 12; sx < 36; sx += 4)
    for (const sy of [7, 10, 13]) {
      const off = sy === 10 ? 2 : 0;
      const cx = sx + off;
      if (g[sy]?.[cx] && g[sy][cx] !== '.') {
        set(cx, sy, 'Y');
        set(cx + 1, sy - 1, 'Y');
        set(cx + 1, sy + 1, 'Y');
      }
    }
  // Back and belly fins near the tail, long and soft.
  for (let x = 27; x <= 37; x++) {
    const h = Math.round(3 - Math.abs(x - 33) / 3);
    for (let k = 1; k <= h; k++) {
      set(x, 5 - k + Math.round((x - 27) / 6), k === h ? 'r' : 'Y');
      set(x, 15 + k - Math.round((x - 27) / 6), k === h ? 'r' : 'Y');
    }
  }
  // Fan tail.
  for (let x = 38; x <= 46; x++) {
    const spread = 1 + (x - 38) * 0.75;
    for (let y = Math.round(10 - spread); y <= Math.round(10 + spread); y++) set(x, y, x >= 45 ? 'r' : (y + x) % 3 === 0 ? 'Y' : 'y');
  }
  // Head: upturned mouth, a gill line, the eye; two barbels under the chin.
  set(3, 8, 'Y');
  set(4, 8, 'Y');
  for (let y = 7; y <= 13; y++) set(10, y, 'Y');
  set(6, 8, 'w');
  set(7, 8, 'w');
  set(6, 9, 'w');
  set(7, 9, 'e');
  for (let i = 0; i < 4; i++) {
    set(4 - i, 13 + Math.floor(i / 2), 'Y');
    set(6 - i, 14 + Math.floor(i / 2), 'Y');
  }
  // Shine along the back.
  for (let x = 12; x <= 30; x += 3) set(x, 6, 'z');
  // Outline: every empty cell next to the fish.
  const out = g.map((r) => [...r]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== '.') continue;
      const near = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].some(([dx, dy]) => g[y + dy]?.[x + dx] && g[y + dy][x + dx] !== '.');
      if (near) out[y][x] = 'k';
    }
  return out.map((r) => r.join(''));
}

/** 48 x 20 art px, facing left. */
export const AROWANA_BIG: string[] = draw();
