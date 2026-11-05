// Layered Solarpunk Nusantara backdrop for the garden: sky (day/dusk/night),
// stars, sun/moon, drifting clouds, volcanoes, a future village (joglo roofs
// with solar panels, a windmill, a bamboo greenhouse, mint lanterns), rice
// terraces and coconut palms. Original vector pixel art drawn in code, plus
// the CC0 palms by fryhet. Layers shift slightly with the pointer (parallax).

import { useEffect, useRef } from 'preact/hooks';

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

/** Phase of the village day. The game day starts at 07:00 WIB. */
export function phaseOf(fractionOfDay: number): Phase {
  const hour = (7 + fractionOfDay * 24) % 24;
  if (hour < 5) return 'night';
  if (hour < 7) return 'dawn';
  if (hour < 17) return 'day';
  if (hour < 19) return 'dusk';
  return 'night';
}

const VB = '0 0 160 100';

function Svg({ class: cls, children }: { class: string; children: preact.ComponentChildren }) {
  return (
    <svg class={`layer ${cls}`} viewBox={VB} preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges" aria-hidden="true">
      {children}
    </svg>
  );
}

const STARS = Array.from({ length: 34 }, (_, i) => ({ x: (i * 37) % 158, y: (i * 23) % 38, big: i % 7 === 0, d: (i % 5) * 0.7 }));

function Joglo({ x, y, w }: { x: number; y: number; w: number }) {
  // Javanese joglo: tall stepped roof, wide eaves, solar panels on the roof.
  const mid = x + w / 2;
  return (
    <g>
      <rect x={x + 2} y={y} width={w - 4} height={7} fill="var(--wall)" />
      <rect x={x + 4} y={y + 2} width={2} height={2} class="window" />
      <rect x={x + w - 6} y={y + 2} width={2} height={2} class="window" />
      <rect x={mid - 1} y={y + 3} width={2} height={4} fill="var(--door)" />
      <polygon points={`${x - 2},${y} ${x + w + 2},${y} ${mid + 3},${y - 5} ${mid - 3},${y - 5}`} fill="var(--roof)" />
      <polygon points={`${mid - 3},${y - 5} ${mid + 3},${y - 5} ${mid + 1},${y - 10} ${mid - 1},${y - 10}`} fill="var(--roof-dark)" />
      <rect x={x + 1} y={y - 3} width={5} height={2} fill="#1E3A5F" />
      <rect x={x + w - 6} y={y - 3} width={5} height={2} fill="#1E3A5F" />
      <rect x={x + 1} y={y - 3} width={5} height={1} class="panel-shine" />
      <rect x={x + w - 6} y={y - 3} width={5} height={1} class="panel-shine" />
    </g>
  );
}

function Lantern({ x, y }: { x: number; y: number }) {
  return (
    <g>
      <rect x={x} y={y} width={1} height={6} fill="var(--pole)" />
      <rect x={x - 1} y={y - 2} width={3} height={2} class="lantern" />
    </g>
  );
}

export function Backdrop({ phase }: { phase: Phase }) {
  const ref = useRef<HTMLDivElement>(null);

  // Gentle pointer parallax on devices with a mouse.
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer: fine)').matches) return;
    const scene = el.parentElement!;
    const move = (e: PointerEvent) => {
      const r = scene.getBoundingClientRect();
      el.style.setProperty('--pan', String(((e.clientX - r.left) / r.width - 0.5) * 2));
    };
    const leave = () => el.style.setProperty('--pan', '0');
    scene.addEventListener('pointermove', move);
    scene.addEventListener('pointerleave', leave);
    return () => {
      scene.removeEventListener('pointermove', move);
      scene.removeEventListener('pointerleave', leave);
    };
  }, []);

  return (
    <div class={`backdrop phase-${phase}`} ref={ref} aria-hidden="true">
      <div class="sky sky-day" />
      <div class="sky sky-dusk" />
      <div class="sky sky-night" />

      <Svg class="layer-stars">
        {STARS.map((s, i) => (
          <rect key={i} x={s.x} y={s.y} width={s.big ? 1.5 : 1} height={s.big ? 1.5 : 1} fill="#E8F7FF" style={{ animationDelay: `${s.d}s` }} />
        ))}
      </Svg>

      <Svg class="layer-sun">
        <g class="sun">
          <rect x={128} y={8} width={10} height={10} fill="#FFE27A" />
          <rect x={126} y={10} width={14} height={6} fill="#FFE27A" />
          <rect x={130} y={6} width={6} height={14} fill="#FFE27A" />
          <rect x={130} y={10} width={4} height={3} fill="#FFF6C9" />
        </g>
        <g class="moon">
          <rect x={20} y={8} width={9} height={9} fill="#E6F0FF" />
          <rect x={18} y={10} width={13} height={5} fill="#E6F0FF" />
          <rect x={24} y={9} width={5} height={6} fill="#B9C8E6" />
        </g>
      </Svg>

      <Svg class="layer-clouds">
        <g fill="var(--cloud)">
          <rect x={10} y={20} width={18} height={3} />
          <rect x={14} y={18} width={9} height={2} />
          <rect x={70} y={14} width={22} height={3} />
          <rect x={75} y={12} width={10} height={2} />
          <rect x={118} y={24} width={16} height={3} />
          <rect x={122} y={22} width={7} height={2} />
        </g>
      </Svg>

      <Svg class="layer-mountains">
        <polygon points="0,60 18,40 26,44 44,26 50,28 70,52 90,44 104,30 112,34 132,48 160,40 160,70 0,70" fill="var(--mountain)" />
        <polygon points="44,26 50,28 47,30 43,29" fill="var(--snow)" />
        <rect x={45} y={22} width={2} height={3} class="smoke" />
      </Svg>

      <Svg class="layer-village">
        <polygon points="0,64 30,56 70,58 110,54 160,60 160,70 0,70" fill="var(--ridge)" />
        <Joglo x={14} y={52} w={18} />
        <Joglo x={58} y={54} w={14} />
        <Joglo x={118} y={51} w={20} />
        {/* bamboo greenhouse */}
        <g>
          <path d="M88 58 V52 Q96 44 104 52 V58 Z" fill="var(--glass)" />
          <path d="M88 52 Q96 44 104 52" fill="none" stroke="var(--bamboo)" stroke-width="1" />
          {[90, 93, 96, 99, 102].map((x) => (
            <rect key={x} x={x} y={49} width={0.6} height={9} fill="var(--bamboo)" />
          ))}
        </g>
        {/* windmill */}
        <rect x={43} y={42} width={2} height={14} fill="var(--pole)" />
        <g class="blades">
          <rect x={43.5} y={34} width={1} height={8} fill="var(--blade)" />
          <rect x={43.5} y={42} width={1} height={8} fill="var(--blade)" />
          <rect x={36} y={41.5} width={8} height={1} fill="var(--blade)" />
          <rect x={44} y={41.5} width={8} height={1} fill="var(--blade)" />
        </g>
        <Lantern x={36} y={52} />
        <Lantern x={80} y={53} />
        <Lantern x={112} y={51} />
        <Lantern x={146} y={53} />
      </Svg>

      <Svg class="layer-terraces">
        {[0, 1, 2, 3].map((i) => {
          const y = 61 + i * 4.5;
          return (
            <g key={i}>
              <polygon points={`0,${y} 50,${y + 1.5} 104,${y + 0.5} 160,${y - 1} 160,${y + 5} 0,${y + 5.5}`} fill={i % 2 ? 'var(--terrace-a)' : 'var(--terrace-b)'} />
              <polygon points={`0,${y} 50,${y + 1.5} 104,${y + 0.5} 160,${y - 1} 160,${y - 0.2} 104,${y + 1.3} 50,${y + 2.3} 0,${y + 0.8}`} fill="var(--terrace-edge)" />
              <rect x={6 + i * 13} y={y + 2.6} width={22} height={0.7} class="water" />
              <rect x={96 - i * 9} y={y + 2.2} width={26} height={0.7} class="water" />
              {[14, 40, 70, 120, 146].map((x) => (
                <rect key={x} x={x + i * 3} y={y + 1.4} width={0.8} height={1.2} fill="var(--rice)" />
              ))}
            </g>
          );
        })}
      </Svg>

      <img class="palm palm-left" src="/assets/cc0/palm-fryhet-1.png" alt="" />
      <img class="palm palm-right" src="/assets/cc0/palm-fryhet-2.png" alt="" />
      <div class="ground" />
    </div>
  );
}
