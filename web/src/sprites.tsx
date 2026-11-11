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
      // Design-system colours (`var(--token)`) only work as CSS, not as the fill attribute.
      const c = colors[ch];
      const paint = c.startsWith('var(') ? { style: `fill:${c}` } : { fill: c };
      rects.push(<rect key={`${x}-${y}`} x={x} y={y} width={end - x} height={1} {...paint} />);
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

/** UI icons (16x16, one CSS px per pixel) coloured with design-system tokens only. */
const UI_ICON_PALETTE: Record<string, string> = {
  K: 'var(--ink)',
  P: 'var(--paper-light)',
  F: 'var(--paper)',
  H: 'var(--red-500)',
  M: 'var(--mint-700)',
  C: 'var(--cyan-300)',
  // Rock (pixel art, own colours): light, mid and dark stone grey.
  '1': '#C3C8CE',
  '2': '#8A9098',
  '3': '#555B63',
  // Paper (pixel art, own colours): the blue writing lines and the soft grey shadow under the roll.
  '6': '#3D74D6',
  '5': '#B7BCC3',
};

export const UI_ICONS = {
  // A square sticker with a small heart; its bottom-right corner is peeled back.
  sticker: [
    '................',
    '.KKKKKKKKKKKKKK.',
    '.KPPPPPPPPPPPPK.',
    '.KPPPPPPPPPPPPK.',
    '.KPPPHHPPHHPPPK.',
    '.KPPHHHHHHHHPPK.',
    '.KPPHHHHHHHHPPK.',
    '.KPPPHHHHHHPPPK.',
    '.KPPPPHHHHPPPPK.',
    '.KPPPPPHHPPPPPK.',
    '.KPPPPPPPPKKKKK.',
    '.KPPPPPPPPKFFK..',
    '.KPPPPPPPPKFK...',
    '.KPPPPPPPPKK....',
    '.KKKKKKKKKK.....',
    '................',
  ],
  // Add friend: a farmer's head and shoulders (paper face, ink outline) and a mint "+" at the top right.
  friendAdd: [
    '................',
    '...........MM...',
    '....KKKK...MM...',
    '...KPPPPK.MMMMM.',
    '..KPPPPPPKMMMMM.',
    '..KPKPPKPK.MM...',
    '..KPPPPPPK.MM...',
    '..KPPKKPPK......',
    '...KPPPPK.......',
    '....KKKK........',
    '..KKCCCCKK......',
    '.KCCCCCCCCK.....',
    '.KCCCCCCCCK.....',
    '.KCCCCCCCCK.....',
    '.KKKKKKKKKK.....',
    '................',
  ],
  // A check mark ("Sent").
  check: [
    '................',
    '................',
    '................',
    '.............MM.',
    '............MMM.',
    '...........MMM..',
    '..........MMM...',
    '.MM......MMM....',
    '.MMM....MMM.....',
    '..MMM..MMM......',
    '...MMMMMM.......',
    '....MMMM........',
    '.....MM.........',
    '................',
    '................',
    '................',
  ],
  // Arena v2: Rock (Rock / Paper / Scissors buttons and the picks above the TaniBots): an angular grey
  // stone with flat sides, light top-left, dark bottom-right, and one crack (K) from the top edge.
  rock: [
    '................',
    '................',
    '......KKKKK.....',
    '.....K1111KK....',
    '....K111112KK...',
    '...K11K11222K...',
    '..K1111K12222K..',
    '..K11112K22223K.',
    '.K1111222K22233K',
    '.K1112222222333K',
    '.K1122222223333K',
    '.K2222222233333K',
    '..K22222333333K.',
    '...KKKKKKKKKKK..',
    '................',
    '................',
  ],
  // Arena v2: Paper (Rock / Paper / Scissors buttons and the picks above the TaniBots), an original
  // pixel drawing in the style of a paper scroll: an upright white sheet, its top-right corner slightly
  // curled (grey underside), the bottom rolled up into a grey roll (spiral ends), four short blue lines
  // of different lengths as writing, a black outline and a soft grey shadow underneath.
  paper: [
    '..KKKKKKKKKK....',
    '..KPPPPPPPP2KK..',
    '..KPPPPPPPP12K..',
    '..KP666666PPPK..',
    '..KPPPPPPPPPPK..',
    '..KP6666PPPPPK..',
    '..KPPPPPPPPPPK..',
    '..KP6666666PPK..',
    '..KPPPPPPPPPPK..',
    '..KP666PPPPPPK..',
    '..KPPPPPPPPPPK..',
    '.KKKKKKKKKKKKKK.',
    '.K311111111112K.',
    '.K322222222223K.',
    '..KKKKKKKKKKKK..',
    '...5555555555...',
  ],
  // Arena v2: Scissors (Rock / Paper / Scissors buttons and the picks above the TaniBots).
  scissors: [
    '................',
    '.KK..........KK.',
    '.KCK........KCK.',
    '..KCK......KCK..',
    '...KCK....KCK...',
    '....KCK..KCK....',
    '.....KCKKCK.....',
    '......KCCK......',
    '......KCCK......',
    '.....KHKKHK.....',
    '...KKHK..KHKK...',
    '..KHHHK..KHHHK..',
    '..KH.HK..KH.HK..',
    '..KHHHK..KHHHK..',
    '...KKK....KKK...',
    '................',
  ],
} satisfies Record<string, string[]>;

export function UiIcon({ name, scale = 1, class: className }: { name: keyof typeof UI_ICONS; scale?: number; class?: string }) {
  return <Pixels rows={UI_ICONS[name]} palette={UI_ICON_PALETTE} scale={scale} class={className} />;
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

/** Arena v2: the Gold Durian (the durian's pixels in the gold tokens). */
const GOLD_DURIAN_PALETTE: Record<string, string> = { g: 'var(--gold-500)', G: 'var(--gold-300)', d: 'var(--gold-700)' };
export function GoldDurian({ scale = 2, class: className }: { scale?: number; class?: string }) {
  return <Pixels rows={SPRITES.durian} palette={GOLD_DURIAN_PALETTE} scale={scale} class={className} />;
}

export function Sprite({ name, scale = 3, class: className, title }: Props) {
  return <Pixels rows={SPRITES[name]} scale={scale} class={className} title={title} />;
}
