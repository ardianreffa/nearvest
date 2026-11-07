// Village animals, drawn in code as tiny pixel sprites (2 frames each) and moved with CSS only,
// so they are light on phones and still with prefers-reduced-motion:
//   a water buffalo (kerbau) grazing slowly at the edge of the rice terraces;
//   paddy ducks (bebek sawah) walking in a line along a terrace dyke;
//   chickens (ayam) pecking near the houses;
//   a mouse-deer (kancil) that very rarely peeks out of a bush and hides again.
// They walk on the grass and terraces BEHIND the plots, sometimes slip behind a bush, never
// take a click (pointer-events: none) and go home at night (the layer fades with --night).
// Coordinates are art pixels of the 240x135 backdrop.

import { Pixels } from '../sprites';
import { at } from './sky';

const BUFFALO_PAL = { k: '#43424D', d: '#2B2A33', h: '#E8E0C8', n: '#7A6464', e: '#0B0B10' };
const BUFFALO_UP = [
  '........h..h',
  '........kkkk',
  '.kkkkkkkkkek',
  'kkkkkkkkkkkn',
  '.kkkkkkkkkk.',
  '.k.k....k.k.',
  '.d.d....d.d.',
];
const BUFFALO_GRAZE = [
  '............',
  '............',
  '.kkkkkkkh..h',
  'kkkkkkkkkkkk',
  '.kkkkkkkkkek',
  '.k.k....k.kn',
  '.d.d....d.d.',
];

const DUCK_PAL = { w: '#F5F5EC', s: '#D3CFBF', o: '#F59E0B' };
const DUCK_A = ['...w.', '...wo', 'swww.', '.o.o.'];
const DUCK_B = ['...w.', '...wo', 'swww.', '..o..'];

const HEN_PAL = { b: '#A0522D', B: '#7A3E22', r: '#E5484D', y: '#F5C542' };
const HEN_UP = ['...r.', '..bby', 'Bbbb.', '.y.y.'];
const HEN_PECK = ['.....', '...r.', 'Bbbby', '.y.y.'];

const DEER_PAL = { b: '#9A632A', B: '#6B4A2F', w: '#F3E6D0', e: '#1B1B2F' };
const DEER_A = ['....b.', '...bbe', 'Bbbbw.', '.b..b.'];
const DEER_B = ['....b.', '...bbe', 'Bbbbw.', 'b..b..'];

interface Walker {
  cls: string;
  rows: [string[], string[]];
  palette: Record<string, string>;
  /** Lane: from x0 to x1 (art px, left edge of the sprite), feet at y. */
  x0: number;
  x1: number;
  y: number;
  /** Seconds for one walk there and back; frame flip speed. */
  walk: number;
  step: number;
  delay: number;
}

const WALKERS: Walker[] = [
  // The buffalo grazes along the foot of the terraces.
  { cls: 'buffalo', rows: [BUFFALO_UP, BUFFALO_GRAZE], palette: BUFFALO_PAL, x0: 76, x1: 100, y: 93, walk: 90, step: 1.6, delay: -20 },
  // Three ducks in a line on a terrace dyke.
  { cls: 'duck', rows: [DUCK_A, DUCK_B], palette: DUCK_PAL, x0: 166, x1: 196, y: 82, walk: 40, step: 0.36, delay: 0 },
  { cls: 'duck', rows: [DUCK_A, DUCK_B], palette: DUCK_PAL, x0: 166, x1: 196, y: 82, walk: 40, step: 0.36, delay: -4.5 },
  { cls: 'duck', rows: [DUCK_A, DUCK_B], palette: DUCK_PAL, x0: 166, x1: 196, y: 82, walk: 40, step: 0.36, delay: -9 },
  // Chickens near the houses (left: by the stall, right: by the friend's fence).
  { cls: 'hen', rows: [HEN_UP, HEN_PECK], palette: HEN_PAL, x0: 6, x1: 22, y: 98, walk: 26, step: 0.7, delay: -5 },
  { cls: 'hen', rows: [HEN_UP, HEN_PECK], palette: HEN_PAL, x0: 212, x1: 230, y: 98, walk: 31, step: 0.8, delay: -14 },
];

export function Animals() {
  return (
    <div class="animals" aria-hidden="true">
      {WALKERS.map((a, i) => {
        const w = a.rows[0][0].length;
        const h = a.rows[0].length;
        return (
          <span
            key={i}
            class={`animal ${a.cls}`}
            style={{
              ...at(a.x0, a.y - h, w, h),
              '--x0': `${(a.x0 / 240) * 100}%`,
              '--x1': `${(a.x1 / 240) * 100}%`,
              animationDuration: `${a.walk}s`,
              animationDelay: `${a.delay}s`,
            }}
          >
            <Pixels rows={a.rows[0]} palette={a.palette} scale={1} class="frame f1" style={{ animationDuration: `${a.step}s` }} />
            <Pixels rows={a.rows[1]} palette={a.palette} scale={1} class="frame f2" style={{ animationDuration: `${a.step}s` }} />
          </span>
        );
      })}
      {/* The mouse-deer: peeks out of the bush on the right now and then, then hides again. */}
      <span class="animal kancil" style={at(229, 96, 6, 4)}>
        <Pixels rows={DEER_A} palette={DEER_PAL} scale={1} class="frame f1" />
        <Pixels rows={DEER_B} palette={DEER_PAL} scale={1} class="frame f2" />
      </span>
    </div>
  );
}
