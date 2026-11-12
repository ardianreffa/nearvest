// The fishing pond's life (Fishing package 2, Ardian 2026-11-12; rules in pond-life-plan.ts): the big
// tree's crown sways, light glints drift over the water, frogs hop on their lily pads (now and then
// to a neighbouring pad, facing a random side), ducks paddle around the right-hand side (asleep with
// "zzz" at night), a few leaves fall (their colour follows the village clock), and in the rain drops
// fall and ring the water. One timer every 1.5 s moves the animals (CSS does the in-betweens), it
// stops while the tab is hidden; with reduced motion nothing moves and no timer runs.

import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  DUCK_STARTS,
  duckTarget,
  ducksAsleep,
  FROG_SPOTS,
  frogTick,
  LEAF_COLORS,
  LEAF_COUNT,
  startFrogs,
  swimSeconds,
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
  at: Pt;
  /** Seconds of the current paddle (CSS transition). */
  dur: number;
  right: boolean;
  /** When it may pick a new spot (ms). */
  restUntil: number;
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

export function PondLife({ time, weather, still }: { time: PondTime; weather: PondWeather; still: boolean }) {
  const [frogs, setFrogs] = useState<FrogState[]>(() => startFrogs(rand));
  const [ducks, setDucks] = useState<Duck[]>(() => DUCK_STARTS.map((at, i) => ({ at, dur: 0, right: i === 1, restUntil: 0 })));
  const asleep = ducksAsleep(time);

  useEffect(() => {
    if (still) return;
    let id = 0;
    const tick = () => {
      if (document.hidden) return;
      const now = Date.now();
      setFrogs((fs) => fs.map((f, i) => frogTick(f, i, rand)));
      if (!asleep)
        setDucks((ds) =>
          ds.map((d, i) => {
            if (now < d.restUntil) return d;
            const to = duckTarget(
              d.at,
              ds.filter((_, j) => j !== i).map((o) => o.at),
              rand,
            );
            const dur = swimSeconds(d.at, to);
            return { at: to, dur, right: to.x > d.at.x, restUntil: now + dur * 1000 + 1000 + rand() * 4000 };
          }),
        );
    };
    id = window.setInterval(tick, TICK_MS);
    return () => window.clearInterval(id);
  }, [still, asleep]);

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
      <img class="pond-tree" src="/assets/bg/fishing-pond-tree.png" alt="" draggable={false} />
      <svg class="pond-svg pond-life" viewBox="0 0 480 270" aria-hidden="true">
        <g class="pond-glints" fill="var(--paper-light)">
          {GLINTS.map(([x, y, w], i) => (
            <rect key={i} class="pond-glint" x={x} y={y} width={w} height={1} style={{ animationDelay: `${-i * 1.3}s` }} />
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
            style={{ transform: `translate(${d.at.x}px, ${d.at.y}px)`, transitionDuration: `${d.dur}s` }}
          >
            <g class="duck-bob" style={{ animationDelay: `${-i * 0.5}s` }}>
              <g transform={d.right ? 'scale(-1 1)' : undefined}>
                <Sprite rows={i === 1 ? (asleep ? DUCK_HEN_ASLEEP : DUCK_HEN) : asleep ? DUCK_DRAKE_ASLEEP : DUCK_DRAKE} />
              </g>
            </g>
          </g>
        ))}
      </svg>
      {asleep &&
        ducks.map((d, i) => (
          <span key={i} class="pond-zzz" style={{ left: `${((d.at.x + 2) / 480) * 100}%`, top: `${((d.at.y - 8) / 270) * 100}%`, animationDelay: `${-i * 0.7}s` }} aria-hidden="true">
            z<small>z</small>
          </span>
        ))}
      {!still && (
        <div class="pond-leaves" aria-hidden="true">
          {leaves.map((l, i) => (
            <i
              key={i}
              class="pond-leaf"
              style={{
                left: `${l.left}%`,
                animationDelay: `${l.delay}s`,
                animationDuration: `${l.dur}s`,
                '--drift': String(l.drift),
                background: `var(${i % 2 ? leafA : leafB})`,
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** The village clock and the rain over everything (above TaniBot and the rod, under the "!" and the catch). */
export function PondMood({ time, weather }: { time: PondTime; weather: PondWeather }) {
  return (
    <>
      <div class={`pond-tint tint-${time}`} aria-hidden="true" />
      {time === 'dusk' && <div class="pond-glow" aria-hidden="true" />}
      {weather === 'rain' && (
        <div class="pond-rain" aria-hidden="true">
          <i class="wx-rain-layer far" />
          <i class="wx-rain-layer near" />
        </div>
      )}
    </>
  );
}
