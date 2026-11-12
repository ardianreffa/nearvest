// The duel's background (Arena v2, Ardian 2026-11-11): the Tandur Arena, Ardian's ChatGPT images
// (docs/art-source/arena-*.png, converted with tools/pixelize, docs/ASSETS.md): the stone arena floor
// with its green ring, bamboo gate, lanterns and neon, the Arena building and Gunung Tandur behind.
// Day / dusk / night cross-fade from the same village clock as the garden. Small code animations on
// top: the volcano's smoke drifts, lanterns and neon glow softly, the ring pulses, the lava glows at
// night. Reduced motion: all still. The picture is scaled so the ring's middle row lies on the
// TaniBots' feet line (they stand left and right of the ring) and always covers the whole stage.

import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { skyMix } from './backdrop';

import { arenaFit, arenaFullFit, ARENA_PHONE, ARENA_WEB, type ArenaArt, type Box } from './arena-fit';

export { arenaFit, arenaFullFit, ARENA_PHONE, ARENA_WEB, FEET_ABOVE_DOCK, type ArenaArt } from './arena-fit';

const pct = (v: number, of: number) => `${(v / of) * 100}%`;
const place = (art: ArenaArt, [x, y, w, h]: Box) => ({ left: pct(x, art.w), top: pct(y, art.h), width: pct(w, art.w), height: pct(h, art.h) });

/**
 * `onFeet` (the full-screen duel): the picture reaches the stage's bottom under the floating dock
 * (`.match-dock-panel` in the same duel), and the duel is told where the feet line is (px from the
 * stage's top) so its TaniBots stand on the ring. Without it (the landing page) the picture follows
 * the fight floor as before.
 */
export function DuelBackdrop({ fraction, wide, onFeet, hold = false }: { fraction: number; wide: boolean; onFeet?: (feet: number) => void; /** Never move DOWN (the K.O. dock is shorter); only up for a taller panel. */ hold?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number; feet: number; dock: number } | null>(null);
  const full = !!onFeet;
  const holdRef = useRef(hold);
  holdRef.current = hold;
  useLayoutEffect(() => {
    const el = ref.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    const dockEl = () => (full ? (el.closest('.duel')?.querySelector<HTMLElement>('.match-dock-panel') ?? null) : null);
    const measure = () => {
      // The TaniBots stand 6 px above the bottom of the fight floor (.fighter { bottom: 6px }).
      const floor = stage.querySelector('.fight-floor');
      const s = el.getBoundingClientRect();
      const d = dockEl()?.getBoundingClientRect();
      const dock = d && d.height ? Math.round(d.top - s.top) : s.height;
      const feet = full ? 0 : floor ? floor.getBoundingClientRect().bottom - 6 - s.top : s.height * 0.85;
      setSize((o) => {
        // Held (K.O. / result): the dock's top may only move up, so nothing drops when the panel shrinks.
        const d = o && holdRef.current && o.w === s.width && o.h === s.height ? Math.min(o.dock, dock) : dock;
        return o && o.w === s.width && o.h === s.height && o.feet === feet && o.dock === d ? o : { w: s.width, h: s.height, feet, dock: d };
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The dock's own size (its content changes from the buttons to the result at the end).
    const d = dockEl();
    if (d) ro.observe(d);
    return () => ro.disconnect();
  }, [full]);
  const art = wide ? ARENA_WEB : ARENA_PHONE;
  const fitFull = size && full ? arenaFullFit(art, size.w, size.h, size.dock, wide) : null;
  const fit = fitFull ?? (size ? arenaFit(art, size.w, size.h, size.feet) : null);
  const feetPx = fitFull ? Math.round(fitFull.feet) : null;
  useLayoutEffect(() => {
    if (feetPx !== null) onFeet?.(feetPx);
  }, [feetPx]);
  const { night, dusk } = skyMix(fraction);
  const r = art.ring;
  return (
    <div class={`duel-bg arena-${art.key}`} ref={ref} aria-hidden="true" style={{ '--night': night.toFixed(3), '--dusk': dusk.toFixed(3) }}>
      {fit && (
        <div class="arena-art" style={{ left: `${fit.left}px`, top: `${fit.top}px`, width: `${art.w * fit.k}px`, height: `${art.h * fit.k}px` }}>
          <img class="arena-img" src={art.src('day')} alt="" />
          <img class="arena-img arena-dusk" src={art.src('dusk')} alt="" />
          <img class="arena-img arena-night" src={art.src('night')} alt="" />
          <i class="arena-lava" style={place(art, art.lava)} />
          {[0, 1, 2, 3].map((i) => (
            <i key={`p${i}`} class="arena-puff" style={{ left: pct(art.crater[0], art.w), top: pct(art.crater[1], art.h), animationDelay: `${i * 1.6}s` }} />
          ))}
          {art.lanterns.map((b, i) => (
            <i key={`l${i}`} class="arena-lamp" style={{ ...place(art, b), animationDelay: `${i * 0.9}s` }} />
          ))}
          {art.neon.map((b, i) => (
            <i key={`n${i}`} class="arena-neon" style={{ ...place(art, b), animationDelay: `${i * 0.55}s` }} />
          ))}
          <i class="arena-ring" style={place(art, [r.cx - r.rx, r.cy - r.ry, 2 * r.rx, 2 * r.ry])} />
        </div>
      )}
      {fitFull && fitFull.fill > 0 && <ArenaFloorFill art={art} fit={fitFull} />}
      <i class="duel-bg-top" />
    </div>
  );
}

/**
 * More arena floor below the picture (phones, tall laptop windows): the picture's own stone rows
 * (`floor.band`) repeated, then its front edge with the bushes at the very bottom, the same way the
 * garden's lawn repeats the village's bush rows. Day / dusk / night like the picture.
 */
function ArenaFloorFill({ art, fit }: { art: ArenaArt; fit: ReturnType<typeof arenaFullFit> }) {
  const { k, left, top, fill } = fit;
  const [b0, b1] = art.floor.band;
  const cut = art.floor.cut;
  const bandH = (b1 - b0) * k;
  const strips = Math.ceil(fill / bandH);
  const size = `${art.w * k}px ${art.h * k}px`;
  const rows = (from: number, y: number, h: number, key: string, light: 'day' | 'dusk' | 'night') => (
    <i
      key={key}
      style={{
        top: `${y}px`,
        height: `${h}px`,
        backgroundImage: `url(${art.src(light)})`,
        backgroundSize: size,
        backgroundPosition: `0 ${-from * k}px`,
      }}
    />
  );
  return (
    <div class="arena-fill" style={{ left: `${left}px`, top: `${top + cut * k}px`, width: `${art.w * k}px`, height: `${fill + (art.h - cut) * k}px` }}>
      {(['day', 'dusk', 'night'] as const).map((light) => (
        <div key={light} class={`arena-fill-layer${light === 'dusk' ? ' arena-dusk' : light === 'night' ? ' arena-night' : ''}`}>
          {/* Repeated floor rows; the last strip is cut by the box (its bushes cover the seam). */}
          {Array.from({ length: strips }, (_, i) => rows(b0, Math.floor(i * bandH), Math.ceil(bandH) + 1, `b${i}`, light))}
          {rows(cut, Math.round(fill), Math.ceil((art.h - cut) * k), 'edge', light)}
        </div>
      ))}
    </div>
  );
}
