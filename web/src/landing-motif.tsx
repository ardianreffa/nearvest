// The landing page's section borders (2026-11-12): Indonesian textile motifs as pixel art, drawn in
// code (original, nothing copied): tumpal (the row of triangles on a sarong's edge), kawung (four
// palm-fruit ovals around a centre), mega mendung (the layered clouds of Cirebon batik) and parang
// (the diagonal bands of Javanese batik). Each border is a band at the bottom of a section: the
// motif in the NEXT section's colour (with an accent colour) over the current one, then a solid
// strip, so the next section grows out of the pattern. Colours are design tokens.

/** One tile of a motif: a 2D grid of '.', 'm' (main = next section) or 'a' (accent). */
type Cell = '.' | 'm' | 'a';
export type MotifKind = 'tumpal' | 'kawung' | 'mendung' | 'parang';

/** Band height in motif units (one unit = 4 CSS px); the last 3 rows are always solid. */
const H = 12;
const UNIT = 4;

function tile(kind: MotifKind): Cell[][] {
  const w = kind === 'mendung' ? 16 : 12;
  const rows: Cell[][] = [];
  for (let y = 0; y < H; y++) {
    const row: Cell[] = [];
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      let c: Cell = '.';
      if (y >= H - 3) c = 'm';
      else if (kind === 'tumpal') {
        // A row of triangles pointing up, a small accent triangle inside each.
        const half = (py / (H - 3)) * 6;
        if (Math.abs(px - 6) < half) c = Math.abs(px - 6) < half - 3 && py > 4 ? 'a' : 'm';
      } else if (kind === 'kawung') {
        // Four round petals around a centre, a dot in the middle.
        const cx = 6;
        const cy = 4.5;
        const petals = [
          [cx - 2.6, cy - 2.2],
          [cx + 2.6, cy - 2.2],
          [cx - 2.6, cy + 2.2],
          [cx + 2.6, cy + 2.2],
        ];
        if (Math.hypot(px - cx, py - cy) < 1) c = 'a';
        else if (petals.some(([a, b]) => Math.hypot((px - a) * 0.85, py - b) < 2.1)) c = 'm';
      } else if (kind === 'mendung') {
        // Layered cloud bumps: concentric half rings, alternating main and accent.
        const d = Math.hypot(px - 8, py - (H - 3));
        if (d < 8) c = Math.floor(d) % 3 === 1 ? 'a' : 'm';
      } else {
        // Parang: diagonal bands with a small accent notch.
        const k = (((x - y) % 12) + 12) % 12;
        if (k < 4) c = 'm';
        else if (k === 5 && y % 3 === 1) c = 'a';
      }
      row.push(c);
    }
    rows.push(row);
  }
  return rows;
}

export function Motif({ kind, to, accent = '--gold-500', id }: { kind: MotifKind; to: `--${string}`; accent?: `--${string}`; id: string }) {
  const cells = tile(kind);
  const w = cells[0].length;
  const rects = [];
  for (let y = 0; y < H; y++) {
    let x = 0;
    while (x < w) {
      const c = cells[y][x];
      if (c === '.') {
        x++;
        continue;
      }
      let e = x + 1;
      while (e < w && cells[y][e] === c) e++;
      rects.push(<rect key={`${x}-${y}`} x={x * UNIT} y={y * UNIT} width={(e - x) * UNIT} height={UNIT} style={{ fill: `var(${c === 'm' ? to : accent})` }} />);
      x = e;
    }
  }
  return (
    <svg class={`lp-motif motif-${kind}`} aria-hidden="true" height={H * UNIT} preserveAspectRatio="none" shape-rendering="crispEdges">
      <defs>
        <pattern id={id} width={w * UNIT} height={H * UNIT} patternUnits="userSpaceOnUse">
          {rects}
        </pattern>
      </defs>
      <rect width="100%" height={H * UNIT} fill={`url(#${id})`} />
    </svg>
  );
}
