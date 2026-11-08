// Original pixel art drawn in code (no external assets needed).
// Each sprite is a grid of characters; each character maps to a palette color.

export const PALETTE: Record<string, string> = {
  g: '#2E7D4F', // leaf
  G: '#4CAF6A', // light leaf
  d: '#1E5A38', // dark leaf / stem
  s: '#6B4A2F', // soil
  S: '#4A321F', // dark soil
  m: '#00EC97', // NEAR mint
  c: '#22D3EE', // tech cyan
  y: '#F5C542', // gold
  Y: '#C9971F', // dark gold
  p: '#8B5CF6', // purple
  o: '#F59E0B', // mango orange
  r: '#E5484D', // rambutan red
  R: '#A3262A', // dark red
  k: '#1B1B2F', // outline
  w: '#FFFFFF',
  e: '#9CA3AF', // grey metal
  E: '#4B5563', // dark metal
  l: '#E0B48A', // skin
  L: '#B9875E', // skin shadow
  h: '#D9B26F', // straw
  H: '#A9813F', // dark straw
  u: '#2563EB', // blue shirt
};

export type SpriteName = keyof typeof SPRITES;

export const SPRITES = {
  seedMound: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '................',
    '.......yY.......',
    '.....ssssss.....',
    '....ssSsssSs....',
    '...ssssssssss...',
    '................',
  ],
  sprout: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....GG....GG....',
    '...GggG..GggG...',
    '...gggg..gggg...',
    '....gggddggg....',
    '.......dd.......',
    '.......dd.......',
    '.......dd.......',
    '.....ssssss.....',
    '....ssSsssSs....',
    '...ssssssssss...',
    '................',
  ],
  mango: [
    '....g...',
    '...gd...',
    '..oooo..',
    '.oyyooo.',
    '.oyoooo.',
    '.ooooYo.',
    '..oooo..',
    '........',
  ],
  rambutan: [
    '..r..r..',
    '.rrrrrr.',
    'rRrrrrRr',
    '.rrwrrr.',
    'rrrrrrrr',
    '.rRrrRr.',
    '..rrrr..',
    '..r..r..',
  ],
  durian: [
    '...d....',
    '..GgGg..',
    '.GgGgGg.',
    'GgGgGgGg',
    'gGgGgGgG',
    '.gGgGgG.',
    '..gGgG..',
    '...dd...',
  ],
  coin: [
    '..yyyy..',
    '.yYYYYy.',
    'yYyggyYy',
    'yYygGyYy',
    'yYyyGyYy',
    'yYyyyyYy',
    '.yYYYYy.',
    '..yyyy..',
  ],
  droplet: [
    '...c....',
    '...cc...',
    '..cccc..',
    '.ccwccc.',
    '.cwcccc.',
    '.cccccc.',
    '..cccc..',
    '........',
  ],
  sparkle: [
    '...y...',
    '...y...',
    '..yyy..',
    'yyywyyy',
    '..yyy..',
    '...y...',
    '...y...',
  ],
  lock: [
    '..eeee..',
    '.e....e.',
    '.e....e.',
    'EEEEEEEE',
    'EyyyyyyE',
    'EyyEEyyE',
    'EyyyyyyE',
    'EEEEEEEE',
  ],
  fertilizer: [
    '.hhhhhh.',
    '..HhhH..',
    '.hhhhhh.',
    'hhmmmmhh',
    'hhmGGmhh',
    'hhmmmmhh',
    'hhhhhhhh',
    '.HHHHHH.',
  ],
  seedPacket: [
    '........',
    '.hhhhhh.',
    '.HHHHHH.',
    '.hhhhhh.',
    '.hhyyhh.',
    '.hyYYyh.',
    '.hhyyhh.',
    '.hhhhhh.',
  ],
  bolt: [
    '....mm.',
    '...mm..',
    '..mm...',
    '.mmmmm.',
    '...mm..',
    '..mm...',
    '.mm....',
  ],
  fire: [
    '...r....',
    '..rr..r.',
    '..rorrr.',
    '.rooyorr',
    '.royyyor',
    '.roywyor',
    '..ryyyr.',
    '...rrr..',
  ],
  speaker: [
    '...e....',
    '..ee..w.',
    'eewe.w..',
    'ewwe.w.w',
    'ewwe.w.w',
    'eewe.w..',
    '..ee..w.',
    '...e....',
  ],
  music: [
    '....eeee',
    '....eeee',
    '....e..e',
    '....e..e',
    '....e..e',
    '..eee.ee',
    '.eeeeeee',
    '..ee..e.',
  ],
  musicOff: [
    'r...eeee',
    '.r..eeee',
    '..r.e..e',
    '...re..e',
    '....r..e',
    '..eeeree',
    '.eeeeere',
    '..ee..er',
  ],
  fullscreen: [
    'www..www',
    'w......w',
    'w......w',
    '........',
    '........',
    'w......w',
    'w......w',
    'www..www',
  ],
  fullscreenExit: [
    '..w..w..',
    '..w..w..',
    'www..www',
    '........',
    '........',
    'www..www',
    '..w..w..',
    '..w..w..',
  ],
  speakerOff: [
    '...e....',
    '..ee....',
    'eewe.r.r',
    'ewwe..r.',
    'ewwe..r.',
    'eewe.r.r',
    '..ee....',
    '...e....',
  ],
  darto: [
    '................',
    '.....kkkkkk.....',
    '....kllllllk....',
    '...kllllllllk...',
    '...lccccccccl...',
    '...lcwcllcwcl...',
    '...llllLLllll...',
    '...llkkkkkkll...',
    '....llkllkll....',
    '.....llllll.....',
    '......LLLL......',
    '...uuuuuuuuuu...',
    '..uuuuyuuyuuuu..',
    '..uuuuuuuuuuuu..',
    '..uuuuuuuuuuuu..',
    '................',
  ],
} satisfies Record<string, string[]>;

export const BASE_PALETTE = PALETTE;

interface PixelsProps {
  rows: string[];
  /** Overrides or extends the base palette. */
  palette?: Record<string, string>;
  /** Size of one pixel in CSS px. */
  scale?: number;
  class?: string;
  title?: string;
  style?: string | Record<string, string | number>;
}

/** Renders any character grid as a crisp SVG (merges horizontal runs into one rect). */
export function Pixels({ rows, palette, scale = 3, class: className, title, style }: PixelsProps) {
  const colors = palette ? { ...PALETTE, ...palette } : PALETTE;
  const width = Math.max(...rows.map((r) => r.length));
  const rects = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      if (ch === '.' || !colors[ch]) {
        x++;
        continue;
      }
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={end - x} height={1} fill={colors[ch]} />);
      x = end;
    }
  }
  return (
    <svg
      class={className}
      style={style}
      width={width * scale}
      height={rows.length * scale}
      viewBox={`0 0 ${width} ${rows.length}`}
      shape-rendering="crispEdges"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      {title && <title>{title}</title>}
      {rects}
    </svg>
  );
}

/** Keeps only the given characters of a grid (for animated overlay layers). */
export function only(rows: string[], chars: string): string[] {
  return rows.map((r) => [...r].map((c) => (chars.includes(c) ? c : '.')).join(''));
}

interface Props {
  name: SpriteName;
  scale?: number;
  class?: string;
  title?: string;
}

export function Sprite({ name, scale = 3, class: className, title }: Props) {
  return <Pixels rows={SPRITES[name]} scale={scale} class={className} title={title} />;
}
