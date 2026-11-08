// A plot's bed: a pixel-art mound of soil sitting on the grass (v2 village), drawn in code.
// Two layers: the whole mound behind the tree, and its front half in front of it, so the trunk
// grows out of the soil. States: dry, wet (watered: darker soil with a damp sheen) and locked
// (grey stone). Selected and fertilized plots glow (CSS, see .soil.mound in styles.css).

import { Pixels } from '../sprites';

export interface MoundSize {
  /** Game pixels. */
  w: number;
  h: number;
}

export const MOUND: Record<'web' | 'phone', MoundSize> = {
  web: { w: 34, h: 7 },
  phone: { w: 30, h: 7 },
};

type Kind = 'dry' | 'wet' | 'locked';

const PALETTES: Record<Kind, Record<string, string>> = {
  dry: { k: '#2A190C', t: '#9A7049', b: '#7D5636', d: '#5A3C24', c: '#6B4A2F', g: '#2DA53E', G: '#1AAE23' },
  wet: { k: '#1E1208', t: '#6E4C2E', b: '#553822', d: '#3B2616', c: '#4A321F', s: '#7FA8B8', g: '#2DA53E', G: '#1AAE23' },
  locked: { k: '#24221F', t: '#8A847C', b: '#6B655E', d: '#4A453F', c: '#5A5148', g: '#2DA53E', G: '#1AAE23' },
};

const cache = new Map<string, string[]>();

/** The mound's pixel rows (2 columns of grass tufts on each side). */
function moundRows({ w, h }: MoundSize, wet: boolean): string[] {
  const key = `${w}x${h}-${wet}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const W = w + 4;
  const mid = W / 2;
  const rows: string[] = [];
  for (let r = 0; r < h; r++) {
    const half = Math.round((w / 2) * (0.66 + 0.34 * Math.sqrt((r + 1) / h)));
    const from = Math.round(mid - half);
    const to = Math.round(mid + half) - 1;
    let line = '';
    for (let x = 0; x < W; x++) {
      let c = '.';
      if (x >= from && x <= to) {
        if (r === 0 || x === from || x === to) c = 'k';
        else if (r === h - 1) c = 'd';
        else if (r === 1) c = (x + r) % 7 === 0 ? 'b' : 't';
        else if ((x * 3 + r * 5) % 11 === 0) c = 'c';
        else if ((x + r * 2) % 9 === 0 && r > 2) c = 'd';
        else c = 'b';
        if (wet && r >= 1 && r <= 2 && (x + r) % 5 === 0 && c !== 'k') c = 's';
      } else if (r === h - 1 && (x === from - 1 || x === to + 1)) c = 'g';
      else if (r === h - 2 && (x === from - 1 || x === to + 1)) c = 'G';
      line += c;
    }
    rows.push(line);
  }
  cache.set(key, rows);
  return rows;
}

export function Mound({ size, scale, kind }: { size: MoundSize; scale: number; kind: Kind }) {
  const rows = moundRows(size, kind === 'wet');
  // The trunk ends 3.5 rows under the mound top (see .plot-art): rows 2+ hide its base.
  const front = rows.map((r, i) => (i >= 2 ? r : '.'.repeat(r.length)));
  const pal = PALETTES[kind];
  return (
    <>
      <Pixels rows={rows} palette={pal} scale={scale} class="mound-back" />
      <Pixels rows={front} palette={pal} scale={scale} class="mound-front" />
    </>
  );
}
