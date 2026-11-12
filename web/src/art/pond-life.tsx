// The fishing pond's life (Fishing package 2, Ardian 2026-11-12; rules in pond-life-plan.ts): the big
// tree's crown sways, light glints drift over the water, frogs hop on their lily pads (now and then
// to a neighbouring pad, facing a random side), ducks paddle around the right-hand side (asleep with
// "zzz" at night) anywhere on the lake but away from each other and the line, a few leaves fall (their colour follows the village clock), and in the rain drops
// fall and ring the water. One timer every 1.5 s moves the animals (CSS does the in-betweens), it
// stops while the tab is hidden; with reduced motion nothing moves and no timer runs.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  DUCK_STARTS,
  ducksAsleep,
  mustFlee,
  planDuck,
  still,
  type Box,
  type DuckMove,
  type FishingZone,
  FROG_SPOTS,
  frogTick,
  LEAF_COLORS,
  LEAF_COUNT,
  startFrogs,
  type FrogState,
  type PondTime,
  type PondWeather,
  type Pt,
} from '../pond-life-plan';
import { DUCK_DRAKE, DUCK_DRAKE_ASLEEP, DUCK_HEN, DUCK_HEN_ASLEEP, FROG, POND_LIFE_PALETTE } from './pond-sprites';

const TICK_MS = 1500;

/** Pixel rows as SVG rects in grid units, centred on (0, 0). */
function Sprite({ rows }: { rows: string[] }) {
  const w = rows[0].length;
  const h = rows.length;
  const out = [];
  for (let y = 0; y < h; y++) {
    const r = rows[y];
    let x = 0;
    while (x < w) {
      const ch = r[x];
      if (ch === '.') {
        x++;
        continue;
      }
      let e = x + 1;
      while (e < w && r[e] === ch) e++;
      out.push(<rect key={`${x}-${y}`} x={x - w / 2} y={y - h / 2} width={e - x} height={1} fill={POND_LIFE_PALETTE[ch]} />);
      x = e;
    }
  }
  return <g shape-rendering="crispEdges">{out}</g>;
}

interface Duck {
  m: DuckMove;
  right: boolean;
}

/** Light glints drifting over the open water (grid px: x, y, width), away from the frogs and ducks. */
const GLINTS = [
  [200, 182, 5],
  [292, 206, 4],
  [338, 118, 5],
  [236, 236, 4],
  [372, 196, 5],
  [196, 112, 4],
  [318, 160, 3],
];
/** Waves leave the waterfall's foot one after another (seconds: animation delays of a 16 s loop). */
const WAVES = [0, -4, -8, -12];
/** Where rain drops ring the water (grid px). */
const RAIN_RINGS = [
  [214, 120],
  [300, 108],
  [356, 168],
  [270, 196],
  [190, 160],
  [330, 232],
  [232, 250],
  [380, 120],
];

const rand = () => Math.random();

/**
 * Falling leaves as small pixel leaves (package 3: they were plain squares): `b` = blade (the time's
 * colour), `v` = vein and `s` = stem (the same colour, darker). Three shapes.
 */
const LEAF_ART = [
  ['...bbb.', '.bbbbbb', 'svvvvvb', '.bbbbbb', '...bbb.'],
  ['..bbbb', '.bbbvb', '.bbvbb', 'bbvbb.', '.vbb..', 's.....'],
  ['..b..', '.bbb.', '.bvb.', 'bbvbb', '.bvb.', '..s..'],
];
function LeafArt({ rows, color }: { rows: string[]; color: string }) {
  const w = rows[0].length;
  const h = rows.length;
  const dark = `color-mix(in srgb, var(${color}) 55%, var(--ink))`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: `calc(${w} * var(--pk, 1) * 1px)`, height: `calc(${h} * var(--pk, 1) * 1px)` }} shape-rendering="crispEdges">
      {rows.flatMap((r, y) =>
        [...r].map((ch, x) => (ch === '.' ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} style={{ fill: ch === 'b' ? `var(${color})` : dark }} />)),
      )}
    </svg>
  );
}

export function PondLife({
  mix = { dusk: 0, night: 0 },
  time,
  weather,
  still: stillMode,
  zone = null,
  avoid = [],
}: {
  /** The dusk / night pictures' share (the tree crown follows them). */
  mix?: { dusk: number; night: number };
  time: PondTime;
  weather: PondWeather;
  still: boolean;
  /** While fishing: the float and the line (ducks keep away). */
  zone?: FishingZone | null;
  /** Floating panels over the pond (grid boxes): ducks do not swim under them. */
  avoid?: Box[];
}) {
  const [frogs, setFrogs] = useState<FrogState[]>(() => startFrogs(rand));
  const [ducks, setDucks] = useState<Duck[]>(() => DUCK_STARTS.map((at, i) => ({ m: still(at, Date.now()), right: i === 1 })));
  const asleep = ducksAsleep(time);
  /** When each duck may paddle again (a short rest after each paddle). */
  const restUntil = useRef<number[]>(DUCK_STARTS.map(() => 0));
  const ctx = useRef({ zone, avoid, asleep });
  ctx.current = { zone, avoid, asleep };

  /** Plans ducks one after the other (each new path sees the others' latest paths). */
  const moveDucks = (ds: Duck[]): Duck[] => {
    const now = Date.now();
    const { zone: z, avoid: av, asleep: sleeping } = ctx.current;
    const moves = ds.map((d) => d.m);
    let changed = false;
    for (let i = 0; i < moves.length; i++) {
      const flee = mustFlee(moves[i], now, z);
      if (!flee && (sleeping || now < Math.max(restUntil.current[i], moves[i].start + moves[i].dur))) continue;
      const next = planDuck(moves, i, now, rand, { avoid: av, zone: z, flee });
      if (!next) continue;
      moves[i] = next;
      restUntil.current[i] = next.start + next.dur + 1000 + rand() * 4000;
      changed = true;
    }
    return changed ? moves.map((m, i) => ({ m, right: m.to.x === m.from.x ? ds[i].right : m.to.x > m.from.x })) : ds;
  };

  useEffect(() => {
    if (stillMode) return;
    const tick = () => {
      if (document.hidden) return;
      setFrogs((fs) => fs.map((f, i) => frogTick(f, i, rand)));
      setDucks(moveDucks);
    };
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillMode]);
  // Fishing starts (or a panel moves): ducks in the way leave at once.
  useEffect(() => {
    if (!stillMode) setDucks(moveDucks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillMode, zone?.float.x, zone?.tip.x, avoid.map((b) => b.join(',')).join(';')]);

  const leaves = useMemo(
    () =>
      Array.from({ length: LEAF_COUNT }, (_, i) => ({
        left: 4 + ((i * 37) % 70),
        delay: -i * 2.7,
        dur: 11 + (i % 3) * 2.5,
        drift: 18 + (i % 4) * 6,
      })),
    [],
  );
  const [leafA, leafB] = LEAF_COLORS[time];

  return (
    <>
      <div class="pond-tree">
        <img src="/assets/bg/fishing-pond-tree.png" alt="" draggable={false} />
        {mix.dusk > 0 && <img src="/assets/bg/fishing-pond-tree-dusk.png" alt="" style={{ opacity: mix.dusk }} draggable={false} />}
        {mix.night > 0 && <img src="/assets/bg/fishing-pond-tree-night.png" alt="" style={{ opacity: mix.night }} draggable={false} />}
      </div>
      <svg class="pond-svg pond-life" viewBox="0 0 480 270" aria-hidden="true">
        <g class="pond-glints" fill="var(--paper-light)">
          {GLINTS.map(([x, y, w], i) => (
            <rect key={i} class="pond-glint" x={x} y={y} width={w} height={1} style={{ animationDelay: `${-i * 1.3}s` }} />
          ))}
        </g>
        {/* Small waves spreading slowly from the waterfall over the whole lake (only on the water). */}
        <defs>
          <mask id="pond-water-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={480} height={270}>
            <image href="/assets/bg/fishing-pond-water.png" x={0} y={0} width={480} height={270} preserveAspectRatio="none" />
          </mask>
        </defs>
        <g class="pond-waves" mask="url(#pond-water-mask)" fill="none" stroke="var(--paper-light)">
          {WAVES.map((d, i) => (
            <ellipse key={i} class="lake-wave" cx={392} cy={64} rx={300} ry={130} vector-effect="non-scaling-stroke" style={{ animationDelay: `${d}s` }} />
          ))}
        </g>
        {weather === 'rain' && (
          <g class="pond-rain-rings" fill="none" stroke="var(--cyan-300)" stroke-width={0.8}>
            {RAIN_RINGS.map(([x, y], i) => (
              <ellipse key={i} class="rain-ring" cx={x} cy={y} rx={3} ry={1.6} style={{ animationDelay: `${(i * 0.37) % 1.4}s` }} />
            ))}
          </g>
        )}
        {frogs.map((f, i) => {
          const p = FROG_SPOTS[f.spot];
          return (
            <g key={i} class="pond-frog" data-spot={f.spot} style={{ transform: `translate(${p.x}px, ${p.y}px)` }}>
              <g key={f.hops} class={f.hops ? 'frog-hop' : undefined}>
                <g transform={`rotate(${f.dir * 90})`}>
                  <Sprite rows={FROG} />
                </g>
              </g>
            </g>
          );
        })}
        {ducks.map((d, i) => (
          <g
            key={i}
            class={`pond-duck${asleep ? ' asleep' : ''}`}
            data-x={d.m.to.x}
            data-y={d.m.to.y}
            style={{ transform: `translate(${d.m.to.x}px, ${d.m.to.y}px)`, transitionDuration: `${d.m.dur / 1000}s` }}
          >
            {/* Floating, not pasted on: a soft shadow in the water and a ripple ring at the waterline. */}
            <ellipse class="duck-shadow" cx={1} cy={5.5} rx={9} ry={2.6} />
            <ellipse class="duck-ripple" cx={0} cy={4.5} rx={10.5} ry={3} style={{ animationDelay: `${-i * 0.9}s` }} />
            <g class="duck-bob" style={{ animationDelay: `${-i * 0.5}s` }}>
              <g transform={d.right ? 'scale(-1 1)' : undefined}>
                <Sprite rows={i === 1 ? (asleep ? DUCK_HEN_ASLEEP : DUCK_HEN) : asleep ? DUCK_DRAKE_ASLEEP : DUCK_DRAKE} />
              </g>
              {/* The bottom of the body sits in the water. */}
              <rect class="duck-waterline" x={-8} y={3.5} width={16} height={2} />
            </g>
          </g>
        ))}
      </svg>
      {asleep &&
        ducks.map((d, i) => (
          <span key={i} class="pond-zzz" style={{ left: `${((d.m.to.x + 2) / 480) * 100}%`, top: `${((d.m.to.y - 8) / 270) * 100}%`, animationDelay: `${-i * 0.7}s` }} aria-hidden="true">
            z<small>z</small>
          </span>
        ))}
      {!stillMode && (
        <div class="pond-leaves" aria-hidden="true">
          {leaves.map((l, i) => (
            <span
              key={i}
              class="pond-leaf"
              style={{
                left: `${l.left}%`,
                animationDelay: `${l.delay}s`,
                animationDuration: `${l.dur}s`,
                '--drift': String(l.drift),
              }}
            >
              <LeafArt rows={LEAF_ART[i % LEAF_ART.length]} color={i % 2 ? leafA : leafB} />
            </span>
          ))}
        </div>
      )}
    </>
  );
}

/** Fireflies at night (not in the rain): near the bushes and the banks, grid px + their drift. */
const FIREFLIES = [
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
];

/** The village clock and the rain over everything (above TaniBot and the rod, under the "!" and the catch). */
export function PondMood({ time, weather }: { time: PondTime; weather: PondWeather }) {
  return (
    <>
      {time === 'night' && weather !== 'rain' && (
        <div class="pond-fireflies" aria-hidden="true">
          {FIREFLIES.map(([x, y, dx, dy], i) => (
            <i
              key={i}
              class="pond-firefly"
              style={{ left: `${(x / 480) * 100}%`, top: `${(y / 270) * 100}%`, '--fx': String(dx), '--fy': String(dy), animationDelay: `${-i * 0.9}s, ${-i * 0.53}s` }}
            />
          ))}
        </div>
      )}
      {/* Dusk and night come from Ardian's pictures now (pond.tsx); only the morning light and rain are tints. */}
      <div class={`pond-tint tint-${time === 'dusk' || time === 'night' ? 'picture' : time}`} aria-hidden="true" />
      {weather === 'rain' && (
        <div class="pond-rain" aria-hidden="true">
          <i class="wx-rain-layer far" />
          <i class="wx-rain-layer near" />
        </div>
      )}
    </>
  );
}
