// Clickable places in the village backdrop (art pixels of the 240x135 image), each with a
// small pin that is always visible (icon + short name, gently bobbing), so players know
// which buildings can be opened.
// Laptop (a mouse): hovering a place or its pin lights the building's outline, enlarges the
// pin and shows the full label; a click opens it. Phone (touch): the first tap shows a bubble
// with an "Open" button. Places that are not built yet (garden visits, the Arena) say "Soon".
// Pins and bubbles slide inside the visible part of the scene and away from the HUD, the
// side menu, TaniBot, bubbles, tree timers and plots. The hotspots sit under the plots and
// TaniBot, so they never take a click meant for the garden.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sprite, type SpriteName } from '../sprites';
import { at } from './sky';

export type Place = 'shop' | 'market' | 'village';
type Spot = 'shop' | 'market' | 'village' | 'friends' | 'arena';

interface SpotInfo {
  box: [number, number, number, number];
  /** Pin name (laptop) and its short form (phones). */
  name: string;
  short: string;
  /** Full label on hover / tap. */
  label: string;
  icon: SpriteName;
  /** Opens this panel; null = coming soon. */
  open: Place | null;
}

const SPOTS: Record<Spot, SpotInfo> = {
  shop: { box: [28, 63, 26, 27], name: 'Shop', short: 'Shop', label: 'Village Shop: seeds and fertilizer', icon: 'seedPacket', open: 'shop' },
  market: { box: [107, 67, 24, 14], name: 'Market', short: 'Market', label: "Mr. Darto's Market", icon: 'darto', open: 'market' },
  village: { box: [155, 11, 24, 40], name: 'Village Stats', short: 'Stats', label: 'Farm tower: Village Stats', icon: 'bolt', open: 'village' },
  friends: { box: [196, 56, 42, 37], name: 'Friends', short: 'Friends', label: 'Visit friends: coming soon', icon: 'sprout', open: null },
  arena: { box: [99, 51, 35, 16], name: 'Arena', short: 'Arena', label: 'Arena: 1v1 duels for PANEN, coming soon', icon: 'sparkle', open: null },
};
const IDS = Object.keys(SPOTS) as Spot[];

/** Things a pin or bubble must never cover or hide under. */
const OBSTACLES =
  '.hud-capsule, .hud-chips, .hud-drawer, .hud-rail, .hud-bar, .coach-hud, .topbar, .toasts, .bot-spot .tanibot, .bot-hint, .badge, .plot-art, .soil';

const canHover = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

type Rect = { left: number; top: number; right: number; bottom: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The visible part of the scene: on screen, left of an open side menu. */
function visibleArea(host: HTMLElement): Rect {
  const scene = (host.closest('.scene') ?? host).getBoundingClientRect();
  let right = Math.min(scene.right, window.innerWidth);
  for (const el of document.querySelectorAll('.hud-drawer, .hud-rail')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.left < right && r.right > scene.left && r.left > scene.left + scene.width / 2) right = Math.min(right, r.left);
  }
  return { left: Math.max(scene.left, 0) + 4, top: Math.max(scene.top, 0) + 4, right: right - 4, bottom: Math.min(scene.bottom, window.innerHeight) - 4 };
}

function obstacleRects(): Rect[] {
  return [...document.querySelectorAll(OBSTACLES)].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
}

/**
 * Places `el` (absolutely positioned in `host`) near the art point (x, y): above it first, then
 * nudged sideways or a little lower, so it is fully visible and covers nothing important.
 */
function place(el: HTMLElement, host: HTMLElement, x: number, y: number, area: Rect, obstacles: Rect[], below = false) {
  const hr = host.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const ax = hr.left + (x / 240) * hr.width;
  const ay = hr.top + (y / 135) * hr.height;
  const dxs = [0, -16, 16, -32, 32, -56, 56, -88, 88, -128, 128];
  const dys = below ? [6, 24, 44] : [-h - 4, -h - 18, 2, 18];
  let best: { l: number; t: number } | null = null;
  for (const dy of dys) {
    for (const dx of dxs) {
      let l = ax - w / 2 + dx;
      let t = ay + dy;
      l = Math.min(Math.max(l, area.left), area.right - w);
      t = Math.min(Math.max(t, area.top), area.bottom - h);
      const r = { left: l, top: t, right: l + w, bottom: t + h };
      if (!obstacles.some((o) => overlaps(r, o))) {
        best = { l, t };
        break;
      }
      best ??= { l, t };
    }
    if (best && !obstacles.some((o) => overlaps({ left: best!.l, top: best!.t, right: best!.l + w, bottom: best!.t + h }, o))) break;
  }
  el.style.left = `${best!.l - hr.left}px`;
  el.style.top = `${best!.t - hr.top}px`;
}

export function Hotspots({ onPlace, account }: { onPlace: (p: Place) => void; account?: string }) {
  const [bubble, setBubble] = useState<Spot | null>(null);
  const [hover, setHover] = useState<Spot | null>(null);
  const [hint, setHint] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const pins = useRef<Partial<Record<Spot, HTMLElement | null>>>({});
  const bubbleEl = useRef<HTMLDivElement>(null);

  // The first visit (once per account): every pin blinks softly twice.
  useEffect(() => {
    const key = `nearvest.placePins.${account ?? 'guest'}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, '1');
    } catch {
      return;
    }
    setHint(true);
    const t = setTimeout(() => setHint(false), 3200);
    return () => clearTimeout(t);
  }, [account]);

  // A bubble closes by itself after a while.
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 6000);
    return () => clearTimeout(t);
  }, [bubble]);

  // Lay the pins (and the bubble) out now, on resize, and every second (TaniBot and bubbles move).
  useLayoutEffect(() => {
    const layout = () => {
      const h = host.current;
      if (!h) return;
      const area = visibleArea(h);
      const obstacles = obstacleRects();
      const placed: Rect[] = [];
      for (const id of IDS) {
        const el = pins.current[id];
        if (!el) continue;
        const [x, y, w] = SPOTS[id].box;
        place(el, h, x + w / 2, y, area, [...obstacles, ...placed]);
        placed.push(el.getBoundingClientRect());
      }
      if (bubble && bubbleEl.current) {
        const [x, y, w, bh] = SPOTS[bubble].box;
        const below = y < 30;
        place(bubbleEl.current, h, x + w / 2, below ? y + bh : y, area, obstacles.filter((o) => !bubbleEl.current!.contains(document.elementFromPoint(o.left + 1, o.top + 1))), below);
      }
    };
    layout();
    window.addEventListener('resize', layout);
    const t = setInterval(layout, 1000);
    return () => {
      window.removeEventListener('resize', layout);
      clearInterval(t);
    };
  }, [bubble, hover]);

  const tap = (id: Spot) => {
    const s = SPOTS[id];
    if (s.open && canHover()) {
      setBubble(null);
      onPlace(s.open);
    } else setBubble(bubble === id ? null : id);
  };

  const b = bubble ? SPOTS[bubble] : null;
  return (
    <div class={`hotspots${hint ? ' pins-hint' : ''}`} ref={host}>
      {IDS.map((id) => {
        const s = SPOTS[id];
        const lit = hover === id || bubble === id;
        return (
          <button
            key={id}
            class={`hotspot hs-${id}${lit ? ' active' : ''}`}
            style={at(...s.box)}
            onClick={() => tap(id)}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover((h) => (h === id ? null : h))}
            aria-label={s.open ? `Open ${s.label}` : s.label}
          />
        );
      })}
      {IDS.map((id, i) => {
        const s = SPOTS[id];
        const lit = hover === id || bubble === id;
        return (
          <button
            key={`pin-${id}`}
            ref={(el) => {
              pins.current[id] = el;
            }}
            class={`place-pin pin-${id}${lit ? ' lit' : ''}${s.open ? '' : ' soon'}`}
            style={{ animationDelay: `${-(i * 0.6).toFixed(1)}s` }}
            onClick={() => tap(id)}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover((h) => (h === id ? null : h))}
            tabIndex={-1}
            aria-hidden="true"
          >
            <span class="pin-icon">
              <Sprite name={s.icon} scale={1} />
            </span>
            <span class="pin-name">{lit && canHover() ? s.label : s.name}</span>
            <span class="pin-short">{s.short}</span>
            {!s.open && !lit && <span class="pin-soon">Soon</span>}
          </button>
        );
      })}
      {b && bubble && (
        <div class="hs-bubble" role="dialog" aria-label={b.label} ref={bubbleEl}>
          <b>{b.label}</b>
          {b.open ? (
            <button class="btn btn-small btn-mint" onClick={() => (setBubble(null), onPlace(b.open!))}>
              Open
            </button>
          ) : (
            <span class="small">We are building it this week.</span>
          )}
        </div>
      )}
    </div>
  );
}
