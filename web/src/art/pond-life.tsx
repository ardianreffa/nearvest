// The fishing pond's life (Fishing package 2, Ardian 2026-11-12; rules in pond-life-plan.ts): the big
// tree's crown sways, light glints drift over the water, frogs hop on their lily pads (now and then
// to a neighbouring pad, facing a random side), ducks paddle around the right-hand side (asleep with
// "zzz" at night) anywhere on the lake but away from each other and the line, a few leaves fall (their colour follows the village clock), and in the rain drops
// fall and ring the water. One timer every 1.5 s moves the animals (CSS does the in-betweens), it
// stops while the tab is hidden; with reduced motion nothing moves and no timer runs.

import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  ducksAsleep,
  duckAt,
  JUMP_EVERY,
  mustFlee,
  pickJump,
  planDuck,
  type Jump,
  still,
  type Box,
  type DuckMove,
  type FishingZone,
  frogTick,
  LEAF_COLORS,
  LEAF_COUNT,
  startFrogs,
  type FrogState,
  type PondTime,
  type PondWeather,
  type Pt,
} from '../pond-life-plan';
import { PALETTE } from '../sprites';
import { WIDE, type PondLayout } from './pond-layouts';
import { playPondSplash } from '../audio';
import { CATCH_GRIDS, FISH_PALETTE } from './catch-grids';
import { FISH_BUCKET } from './pond-bucket';
import { DUCK_DRAKE, DUCK_DRAKE_ASLEEP, DUCK_HEN, DUCK_HEN_ASLEEP, FROG, POND_LIFE_PALETTE } from './pond-sprites';

const TICK_MS = 1500;

/** Pixel rows as SVG rects in grid units, centred on (0, 0). */
function Sprite({ rows, palette = POND_LIFE_PALETTE }: { rows: string[]; palette?: Record<string, string> }) {
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
      out.push(<rect key={`${x}-${y}`} x={x - w / 2} y={y - h / 2} width={e - x} height={1} fill={palette[ch]} />);
      x = e;
    }
  }
  return <g shape-rendering="crispEdges">{out}</g>;
}

interface Duck {
  m: DuckMove;
  right: boolean;
}

/** Waves leave the waterfall's foot one after another (animation delays, in loops). */
const WAVES = [0, -0.25, -0.5, -0.75];

/**
 * The fade of the rings' back half: a gradient along the line from the waterfall's middle through the
 * foot, hidden behind the foot (toward the fall), fully shown a little in front of it.
 */
export function ringFade(L: PondLayout): { x1: number; y1: number; x2: number; y2: number } {
  const [sx, sy] = L.fall.spread;
  const cx = L.fall.box.x + L.fall.box.w / 2;
  const cy = L.fall.box.y + L.fall.box.h / 2;
  const n = Math.hypot(sx - cx, sy - cy) || 1;
  const vx = (sx - cx) / n;
  const vy = (sy - cy) / n;
  return { x1: sx - vx * 4, y1: sy - vy * 4, x2: sx + vx * 18, y2: sy + vy * 18 };
}

const rand = () => Math.random();

const BUCKET_PALETTE = { ...PALETTE, ...FISH_PALETTE };

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
  layout: L = WIDE,
  mix = { dusk: 0, night: 0 },
  time,
  weather,
  still: stillMode,
  zone = null,
  avoid = [],
}: {
  /** Which pond (art/pond-layouts.ts). */
  layout?: PondLayout;
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
  const [frogs, setFrogs] = useState<FrogState[]>(() => startFrogs(rand, L));
  const [ducks, setDucks] = useState<Duck[]>(() => L.duckStarts.map((at, i) => ({ m: still(at, Date.now()), right: i === 1 })));
  const asleep = ducksAsleep(time);
  /** When each duck may paddle again (a short rest after each paddle). */
  const restUntil = useRef<number[]>(L.duckStarts.map(() => 0));
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
      const next = planDuck(moves, i, now, rand, { avoid: av, zone: z, flee, layout: L });
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
      setFrogs((fs) => fs.map((f, i) => frogTick(f, i, rand, L)));
      setDucks(moveDucks);
    };
    const id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stillMode]);
  // Now and then a fish jumps out of the water and back in (never near the line, ducks or pads).
  const [jump, setJump] = useState<(Jump & { id: number }) | null>(null);
  const ducksRef = useRef(ducks);
  ducksRef.current = ducks;
  useEffect(() => {
    if (stillMode) return;
    let t = 0;
    const next = () => {
      const [a, b] = JUMP_EVERY;
      t = window.setTimeout(() => {
        if (!document.hidden) {
          const now = Date.now();
          const j = pickJump(rand, { ducks: ducksRef.current.map((d) => duckAt(d.m, now)), zone: ctx.current.zone, avoid: ctx.current.avoid, layout: L });
          if (j) {
            setJump({ ...j, id: now });
            // Out of the water, and the bigger splash back in (package 7: louder).
            window.setTimeout(() => playPondSplash(0.7), 150);
            window.setTimeout(() => playPondSplash(1), 900);
            window.setTimeout(() => setJump((cur) => (cur?.id === now ? null : cur)), 1700);
          }
        }
        next();
      }, (a + rand() * (b - a)) * 1000);
    };
    next();
    return () => window.clearTimeout(t);
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
      <div
        class="pond-tree"
        style={{
          left: `${(L.tree.box[0] / L.w) * 100}%`,
          top: `${(L.tree.box[1] / L.h) * 100}%`,
          width: `${(L.tree.box[2] / L.w) * 100}%`,
          height: `${(L.tree.box[3] / L.h) * 100}%`,
        }}
      >
        <img src={L.tree.pics.day} alt="" draggable={false} />
        <img class="pond-fade" src={L.tree.pics.dusk} alt="" style={{ opacity: mix.dusk }} draggable={false} />
        <img class="pond-fade" src={L.tree.pics.night} alt="" style={{ opacity: mix.night }} draggable={false} />
      </div>
      <svg class="pond-svg pond-life" viewBox={`0 0 ${L.w} ${L.h}`} aria-hidden="true">
        <g class="pond-glints" fill="var(--paper-light)">
          {L.glints.map(([x, y, w], i) => (
            <rect key={i} class="pond-glint" x={x} y={y} width={w} height={1} style={{ animationDelay: `${-i * 1.3}s` }} />
          ))}
        </g>
        {/* Waves spreading from the waterfall's foot (only on the water). Package 7 (Ardian): their back
            half, toward the waterfall and its rocks, fades out, so no ring is ever drawn over a rock or
            the falling water; on phones they stay small and near the foot. */}
        <defs>
          <mask id={`pond-water-mask-${L.key}`} maskUnits="userSpaceOnUse" x={0} y={0} width={L.w} height={L.h}>
            <image href={L.waves.mask} x={0} y={0} width={L.w} height={L.h} preserveAspectRatio="none" />
          </mask>
          <linearGradient id={`pond-ring-fade-${L.key}`} gradientUnits="userSpaceOnUse" {...ringFade(L)}>
            <stop offset={0} style={{ stopColor: 'var(--paper-light)', stopOpacity: 0 }} />
            <stop offset={1} style={{ stopColor: 'var(--paper-light)', stopOpacity: 1 }} />
          </linearGradient>
          <mask id={`pond-front-mask-${L.key}`} maskUnits="userSpaceOnUse" x={0} y={0} width={L.w} height={L.h}>
            <rect x={0} y={0} width={L.w} height={L.h} fill={`url(#pond-ring-fade-${L.key})`} />
          </mask>
        </defs>
        <g class="pond-waves" mask={`url(#pond-water-mask-${L.key})`} fill="none" stroke="var(--paper-light)" style={{ '--wave-s': `${L.waves.s}s`, '--wave-peak': String(L.waves.peak) }}>
          <g mask={`url(#pond-front-mask-${L.key})`}>
            {WAVES.map((d, i) => (
              <ellipse key={i} class="lake-wave" cx={L.waves.x} cy={L.waves.y} rx={L.waves.rx} ry={L.waves.ry} vector-effect="non-scaling-stroke" style={{ animationDelay: `${d * L.waves.s}s` }} />
            ))}
            {/* Foam rings right at the foot (were HTML rings drawn over the rocks). */}
            {[0, 1, 2].map((i) => (
              <ellipse key={`s${i}`} class="fall-spread" cx={L.fall.spread[0]} cy={L.fall.spread[1]} rx={12} ry={6} style={{ animationDelay: `${-i * 1.15}s` }} />
            ))}
          </g>
        </g>
        {weather === 'rain' && (
          <g class="pond-rain-rings" fill="none" stroke="var(--cyan-300)" stroke-width={0.8}>
            {L.rainRings.map(([x, y], i) => (
              <ellipse key={i} class="rain-ring" cx={x} cy={y} rx={3} ry={1.6} style={{ animationDelay: `${(i * 0.37) % 1.4}s` }} />
            ))}
          </g>
        )}
        {/* The wooden fish bucket on the dock, behind TaniBot (package 4). */}
        <g class="pond-bucket" transform={`translate(${L.bucket.x} ${L.bucket.y}) scale(0.7)`}>
          <Sprite rows={FISH_BUCKET} palette={BUCKET_PALETTE} />
        </g>
        {frogs.map((f, i) => {
          const p = L.frogSpots[f.spot];
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
        {jump && (
          <g key={jump.id} class="pond-jump" data-fish={jump.fish} transform={`translate(${jump.x} ${jump.y})${jump.right ? '' : ' scale(-1 1)'}`}>
            <ellipse class="jump-ring" cx={-9} cy={1} rx={4} ry={1.6} />
            <ellipse class="jump-ring late" cx={9} cy={1} rx={4} ry={1.6} />
            <g class="jump-drops">
              {[-11, -8, -6].map((x, i) => (
                <rect key={i} class="jump-drop" x={x} y={-1} width={1} height={1} style={{ '--dx': String((i - 1) * 3), animationDelay: `${i * 40}ms` }} />
              ))}
              {[6, 8, 11].map((x, i) => (
                <rect key={`b${i}`} class="jump-drop late" x={x} y={-1} width={1} height={1} style={{ '--dx': String((i - 1) * 3), animationDelay: `${780 + i * 40}ms` }} />
              ))}
            </g>
            <g class="jump-fish">
              {/* Our catch icons face left: turned to face the way it jumps (right), half size. */}
              <g transform="scale(-0.5 0.5)">
                <Sprite rows={CATCH_GRIDS[jump.fish]!} palette={BUCKET_PALETTE} />
              </g>
            </g>
          </g>
        )}
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
          <span key={i} class="pond-zzz" style={{ left: `${((d.m.to.x + 2) / L.w) * 100}%`, top: `${((d.m.to.y - 8) / L.h) * 100}%`, animationDelay: `${-i * 0.7}s` }} aria-hidden="true">
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


/** The village clock and the rain over everything (above TaniBot and the rod, under the "!" and the catch). */
export function PondMood({
  time,
  weather,
  layout: L = WIDE,
  fireflies = true,
  rain = true,
}: {
  time: PondTime;
  weather: PondWeather;
  layout?: PondLayout;
  fireflies?: boolean;
  /** false = the rain is drawn elsewhere (the Fishing window: one screen-sized rain layer, PondRain). */
  rain?: boolean;
}) {
  return (
    <>
      {fireflies && time === 'night' && weather !== 'rain' && (
        <div class="pond-fireflies" aria-hidden="true">
          {L.fireflies.map(([x, y, dx, dy], i) => (
            <i
              key={i}
              class="pond-firefly"
              style={{ left: `${(x / L.w) * 100}%`, top: `${(y / L.h) * 100}%`, '--fx': String(dx), '--fy': String(dy), animationDelay: `${-i * 0.9}s, ${-i * 0.53}s` }}
            />
          ))}
        </div>
      )}
      {/* Dusk and night come from Ardian's pictures now (pond.tsx); only the morning light and rain are tints. */}
      <div class={`pond-tint tint-${time === 'dusk' || time === 'night' ? 'picture' : time}`} aria-hidden="true" />
      {rain && <PondRain on={weather === 'rain'} />}
    </>
  );
}

/**
 * The rain's falling drops; they fade in and out (package 6: it popped). Package 7b (Ardian's laptop
 * glitch in the rain): the Fishing window draws ONE of these over the whole screen (`screen`), never
 * inside the oversized pond picture: there each drop layer became a ~10000 x 5700 px GPU layer on a
 * Retina screen, and Chrome then dropped tiles of the pond picture (its top band went blank). Only
 * mounted while it rains or fades, so a clear pond keeps no moving layers.
 */
export function PondRain({ on, screen = false }: { on: boolean; screen?: boolean }) {
  const [shown, setShown] = useState(on);
  useEffect(() => {
    if (on) return setShown(true);
    const t = window.setTimeout(() => setShown(false), 4500);
    return () => window.clearTimeout(t);
  }, [on]);
  // Raining when the pond opens: there at once; it fades only when the weather changes.
  const [vis, setVis] = useState(on);
  useEffect(() => {
    // Mount at 0, then fade to 1 (the CSS transition needs one frame at 0).
    const id = requestAnimationFrame(() => setVis(on));
    return () => cancelAnimationFrame(id);
  }, [on, shown]);
  if (!shown) return null;
  return (
    <div class={`pond-rain pond-fade${screen ? ' pond-rain-screen' : ''}`} style={{ opacity: vis ? 1 : 0 }} aria-hidden="true">
      <i class="wx-rain-layer far" />
      <i class="wx-rain-layer near" />
    </div>
  );
}
