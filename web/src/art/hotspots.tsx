// Clickable places in the village backdrop (game pixels of the village's grid, village.ts),
// each with a small pin that is always visible (icon + short name, gently bobbing), so players
// know which buildings can be opened.
// Laptop (a mouse): hovering a place or its pin lights the building's outline, enlarges the
// pin and shows the full label; a click opens it. Phone (touch): the first tap shows a bubble
// with an "Open" button. Places a server does not have yet (garden visits, the Arena) say "Soon".
// Fishing (v3 villages) says "Soon" too, and a tap opens its small "coming soon" window.
// Pins and bubbles slide inside the visible part of the scene and away from the HUD, the
// side menu, TaniBot, bubbles, tree timers and plots. The hotspots sit under the plots and
// TaniBot, so they never take a click meant for the garden.

import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sprite, type SpriteName } from '../sprites';
import { DartoHead } from './darto';
import { boxIn, V1, type Box, type Spot, type Village } from './village';

export type Place = 'shop' | 'market' | 'village' | 'friends' | 'arena' | 'fishing';
/** The five places of every village, plus Fishing where the village has a fishing corner (v3). */
type PinId = Spot | 'fishing';

interface SpotInfo {
  /** Pin name (laptop) and its short form (phones). */
  name: string;
  short: string;
  /** Full label on hover / tap. */
  label: string;
  /** A sprite, or Mr. Darto's head (cut from his official sprite). */
  icon: SpriteName | 'dartoHead';
  /** Opens this panel; null = coming soon. */
  open: Place | null;
  /** Says "Soon" although it opens something (Fishing opens its small "coming soon" window). */
  soon?: boolean;
}

const SPOTS: Record<Spot, SpotInfo> = {
  shop: { name: 'Shop', short: 'Shop', label: 'Village Shop: seeds and fertilizer', icon: 'seedPacket', open: 'shop' },
  market: { name: 'Market', short: 'Market', label: "Mr. Darto's Market", icon: 'dartoHead', open: 'market' },
  village: { name: 'Village Stats', short: 'Stats', label: 'Farm towers: Village Stats', icon: 'bolt', open: 'village' },
  friends: { name: 'Friends', short: 'Friends', label: 'Visit friends: coming soon', icon: 'sprout', open: null },
  arena: { name: 'Arena', short: 'Arena', label: 'Arena: 1v1 duels for PANEN, coming soon', icon: 'sparkle', open: null },
};
const IDS = Object.keys(SPOTS) as Spot[];
/** The Fishing pin (village.ts `fishing`): a tap opens the "Fishing pond coming soon!" window. */
const FISHING: SpotInfo = { name: 'Fishing', short: 'Fishing', label: 'Fishing pond: coming soon', icon: 'fish', open: 'fishing', soon: true };
/** The Fishing pin once the server has fishing (`state.fishing`, FISHING=on; docs/PLAN-fishing.md). */
const FISHING_LIVE: SpotInfo = { name: 'Fishing', short: 'Fishing', label: 'Fishing pond: 5 casts a day', icon: 'fish', open: 'fishing' };
/** The Friends pin once garden visits are live (the server sends `helps`). */
const FRIENDS_LIVE: SpotInfo = { name: 'Friends', short: 'Friends', label: 'Visit farmers and help water a tree', icon: 'sprout', open: 'friends' };
/** The Arena pin once the server has the Arena (`state.arena`; docs/PLAN-arena.md). */
const ARENA_LIVE: SpotInfo = { name: 'Arena', short: 'Arena', label: 'Arena: 1 VS 1 duels, the winner gets PANEN', icon: 'sparkle', open: 'arena' };
/** Whole-number scales so every pin icon fits its 16 px box and stays sharp (Mr. Darto: his small head, 15 x 14). */
const ICON_SCALE: Partial<Record<SpriteName, number>> = { seedPacket: 2, bolt: 2, sparkle: 2, sprout: 1, fish: 2 };

/**
 * Things a pin or bubble must never cover or hide under. Mr. Darto stays fully visible in front
 * of his kiosk. TaniBot's speech bubble is not listed: the pins stay put and the bubble moves
 * out of their way (useHintPlacement in scene.tsx).
 */
const OBSTACLES =
  '.hud-capsule, .hud-chips, .hud-drawer, .hud-rail, .hud-bar, .coach-hud, .coach-float, .topbar, .toasts, .bot-spot .tanibot, .bot-status, .badge, .plot-art, .soil, .garden-sheet, .village-darto';

/** Where the first village's train runs (boxes just above the rail): pins stay clear of it. */
const RAIL_BAND_V1: Box[] = [
  [118, 54, 27, 11],
  [145, 50, 20, 10],
  [165, 46, 20, 10],
  [185, 43, 15, 9],
  [200, 41, 15, 8],
  [215, 40, 12, 8],
];

/** Boxes just above a village's rail (where the train runs). */
function railBand(v: Village): Box[] {
  if (v.key === 'v1') return RAIL_BAND_V1;
  if (!v.rail) return [];
  const [[x0, y0], [x1, y1]] = [v.rail.points[0], v.rail.points[v.rail.points.length - 1]];
  const boxes: Box[] = [];
  for (let x = Math.max(x0, v.rail.clip.x); x < x1; x += 12) {
    const top = Math.min(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0), y0 + ((y1 - y0) * (x + 12 - x0)) / (x1 - x0));
    boxes.push([x, top - 6, 12, 7]);
  }
  return boxes;
}

const canHover = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

type Rect = { left: number; top: number; right: number; bottom: number; /** How bad covering it is (default 1). */ weight?: number };
const overlaps = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** The phone's safe area at the top (notch / status bar), in px. */
let safeProbe: HTMLElement | null = null;
function safeAreaTop(): number {
  if (!safeProbe) {
    safeProbe = document.createElement('div');
    safeProbe.style.cssText = 'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top, 0px)';
    document.body.appendChild(safeProbe);
  }
  return parseFloat(getComputedStyle(safeProbe).paddingTop) || 0;
}

/**
 * The visible part of the scene: on screen, left of an open side menu, and below the safe line
 * at the top (under the top HUD and the phone's safe area).
 */
function visibleArea(host: HTMLElement): Rect {
  const scene = (host.closest('.scene') ?? host).getBoundingClientRect();
  const safeTop = safeAreaTop();
  let top = Math.max(scene.top, safeTop);
  for (const el of document.querySelectorAll('.hud-top .hud-capsule, .hud-top .hud-chips, .hud-sys, .coach-float')) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > top && r.top < scene.top + scene.height / 3) top = Math.max(top, r.bottom);
  }
  top += 8;
  let right = Math.min(scene.right, window.innerWidth);
  for (const el of document.querySelectorAll('.hud-drawer, .hud-rail')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.left < right && r.right > scene.left && r.left > scene.left + scene.width / 2) right = Math.min(right, r.left);
  }
  return { left: Math.max(scene.left, 0) + 4, top, right: right - 4, bottom: Math.min(scene.bottom, window.innerHeight) - 4 };
}

function obstacleRects(host: HTMLElement, v: Village): Rect[] {
  const hr = host.getBoundingClientRect();
  const rail = railBand(v).map(([x, y, w, h]) => ({
    left: hr.left + (x / v.w) * hr.width,
    top: hr.top + (y / v.h) * hr.height,
    right: hr.left + ((x + w) / v.w) * hr.width,
    bottom: hr.top + ((y + h) / v.h) * hr.height,
  }));
  const rects = [...document.querySelectorAll(OBSTACLES)].map((e) => {
    const r = e.getBoundingClientRect();
    if (!e.classList.contains('village-darto')) return r;
    // Mr. Darto: a little room around him (his waving hand reaches past his box).
    const pad = Math.max(3, r.width * 0.4);
    return { left: r.left - pad, top: r.top - 6, right: r.right + pad, bottom: r.bottom, width: r.width + 2 * pad, height: r.height + 6, weight: 20 };
  });
  return [...rects.filter((r) => r.width > 0 && r.height > 0), ...rail];
}

/**
 * Places `el` (absolutely positioned in `host`) near the art point (x, y): above it first, then
 * nudged sideways or a little lower, so it is fully visible and covers nothing important.
 */
function place(el: HTMLElement, host: HTMLElement, v: Village, x: number, y: number, area: Rect, obstacles: Rect[], below = false, onBody = false) {
  const hr = host.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const ax = hr.left + (x / v.w) * hr.width;
  const ay = hr.top + (y / v.h) * hr.height;
  const dxs = [0, -16, 16, -32, 32, -56, 56, -88, 88, -128, 128];
  const dys = below ? [6, 24, 44] : onBody ? [-h / 2, -h / 2 - 16, -h / 2 + 16, -h / 2 + 32] : [-h - 4, -h - 18, 2, 18];
  // The first spot (in this order) that covers nothing; with no free spot, the one that covers
  // the least (weighted: covering Mr. Darto counts much more than a roof or a tree).
  const cost = (r: Rect) =>
    obstacles.reduce((sum, o) => {
      if (!overlaps(r, o)) return sum;
      const area = (Math.min(r.right, o.right) - Math.max(r.left, o.left)) * (Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top));
      return sum + area * (o.weight ?? 1);
    }, 0);
  let best: { l: number; t: number; c: number } | null = null;
  search: for (const dy of dys) {
    for (const dx of dxs) {
      let l = ax - w / 2 + dx;
      let t = ay + dy;
      l = Math.min(Math.max(l, area.left), area.right - w);
      t = Math.min(Math.max(t, area.top), area.bottom - h);
      const c = cost({ left: l, top: t, right: l + w, bottom: t + h });
      if (!best || c < best.c) best = { l, t, c };
      if (c === 0) break search;
    }
  }
  el.style.left = `${best!.l - hr.left}px`;
  el.style.top = `${best!.t - hr.top}px`;
}

/**
 * What a pin may never cover: the player's trees and their labels (the only reason a pin moves),
 * Mr. Darto (weighted a lot) and the HUD panels. Other pins are added by the caller.
 */
const PIN_OBSTACLES = '.plot-art, .badge, .village-darto, .hud-capsule, .hud-chips, .hud-drawer, .hud-rail, .hud-bar, .coach-hud, .coach-float, .topbar, .toasts, .garden-sheet';
function pinObstacleRects(): Rect[] {
  return [...document.querySelectorAll(PIN_OBSTACLES)]
    .map((e) => {
      const r = e.getBoundingClientRect();
      const darto = e.classList.contains('village-darto');
      const pad = darto ? Math.max(3, r.width * 0.4) : 0;
      return { left: r.left - pad, top: r.top - (darto ? 6 : 0), right: r.right + pad, bottom: r.bottom, weight: darto ? 20 : 1, w: r.width };
    })
    .filter((r) => r.w > 0 && r.bottom > r.top);
}

/**
 * A place pin sits at a FIXED point just above its own building's roof (village.ts `pin`): its
 * bottom middle on that point. It only moves a little (at most 24 px sideways or 16 px up) when it
 * would cover a tree, a label, Mr. Darto, another pin or the HUD; never to a far-away free spot.
 */
function placePin(el: HTMLElement, host: HTMLElement, v: Village, x: number, y: number, area: Rect, obstacles: Rect[]) {
  const hr = host.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const ax = hr.left + (x / v.w) * hr.width;
  const ay = hr.top + (y / v.h) * hr.height;
  const cost = (r: Rect) =>
    obstacles.reduce((sum, o) => {
      if (!overlaps(r, o)) return sum;
      const a = (Math.min(r.right, o.right) - Math.max(r.left, o.left)) * (Math.min(r.bottom, o.bottom) - Math.max(r.top, o.top));
      return sum + a * (o.weight ?? 1);
    }, 0);
  let best: { l: number; t: number; c: number } | null = null;
  search: for (const dy of [0, -8, -16]) {
    for (const dx of [0, -8, 8, -16, 16, -24, 24]) {
      const l = Math.min(Math.max(ax - w / 2 + dx, area.left), area.right - w);
      const t = Math.min(Math.max(ay - h - 2 + dy, area.top), area.bottom - h);
      const c = cost({ left: l, top: t, right: l + w, bottom: t + h });
      if (!best || c < best.c) best = { l, t, c };
      if (c === 0) break search;
    }
  }
  el.style.left = `${best!.l - hr.left}px`;
  el.style.top = `${best!.t - hr.top}px`;
}

export function Hotspots({
  onPlace,
  account,
  village = V1,
  friends = false,
  friendsDot = false,
  arena = false,
  fishing = false,
}: {
  onPlace: (p: Place) => void;
  account?: string;
  village?: Village;
  friends?: boolean;
  /** The Arena is live on this server (else its pin says "Soon"). */
  arena?: boolean;
  /** Fishing is live on this server (else its pin says "Soon" and opens the coming-soon window). */
  fishing?: boolean;
  /** A red dot on the Friends pin (a new wave back, dots.ts). */
  friendsDot?: boolean;
}) {
  const v = village;
  const ids: PinId[] = v.fishing ? [...IDS, 'fishing'] : IDS;
  const spot = (id: PinId): SpotInfo => (id === 'fishing' ? (fishing ? FISHING_LIVE : FISHING) : id === 'friends' && friends ? FRIENDS_LIVE : id === 'arena' && arena ? ARENA_LIVE : SPOTS[id]);
  const where = (id: PinId) => (id === 'fishing' ? v.fishing!.spot : v.spots[id]);
  const [bubble, setBubble] = useState<PinId | null>(null);
  const [hover, setHover] = useState<PinId | null>(null);
  const [hint, setHint] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const pins = useRef<Partial<Record<PinId, HTMLElement | null>>>({});
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
      const obstacles = obstacleRects(h, v);
      const placed: Rect[] = [];
      const pinObstacles = pinObstacleRects();
      for (const id of ids) {
        const el = pins.current[id];
        if (!el) continue;
        const { pin: [x, y] } = where(id);
        placePin(el, h, v, x, y, area, [...pinObstacles, ...placed.map((r) => ({ ...r, weight: 10 }))]);
        placed.push(el.getBoundingClientRect());
      }
      if (bubble && bubbleEl.current) {
        const [x, y, w, bh] = where(bubble).box;
        const below = y < v.h * 0.22;
        place(bubbleEl.current, h, v, x + w / 2, below ? y + bh : y, area, obstacles.filter((o) => !bubbleEl.current!.contains(document.elementFromPoint(o.left + 1, o.top + 1))), below);
      }
    };
    layout();
    window.addEventListener('resize', layout);
    const t = setInterval(layout, 1000);
    return () => {
      window.removeEventListener('resize', layout);
      clearInterval(t);
    };
  }, [bubble, hover, v]);

  const tap = (id: PinId) => {
    const s = spot(id);
    // Fishing opens its window right away, also on phones (live or "Soon": nothing to choose first).
    if (s.open && (canHover() || s.soon || id === 'fishing')) {
      setBubble(null);
      onPlace(s.open);
    } else setBubble(bubble === id ? null : id);
  };

  const b = bubble ? spot(bubble) : null;
  return (
    <div class={`hotspots${hint ? ' pins-hint' : ''}`} ref={host}>
      {ids.map((id) => {
        const s = spot(id);
        const lit = hover === id || bubble === id;
        return (
          <button
            key={id}
            class={`hotspot hs-${id}${lit ? ' active' : ''}`}
            style={boxIn(v, ...where(id).box)}
            onClick={() => tap(id)}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover((h) => (h === id ? null : h))}
            aria-label={s.open && !s.soon ? `Open ${s.label}` : s.label}
          />
        );
      })}
      {ids.map((id, i) => {
        const s = spot(id);
        const lit = hover === id || bubble === id;
        return (
          <button
            key={`pin-${id}`}
            ref={(el) => {
              pins.current[id] = el;
            }}
            class={`place-pin pin-${id}${lit ? ' lit' : ''}${s.open && !s.soon ? '' : ' soon'}`}
            style={{ animationDelay: `${-(i * 0.6).toFixed(1)}s` }}
            onClick={() => tap(id)}
            onMouseEnter={() => setHover(id)}
            onMouseLeave={() => setHover((h) => (h === id ? null : h))}
            tabIndex={-1}
            aria-hidden="true"
          >
            {/* The frame (stepped pixel corners) is an inner box so the neon glow on the pin
                itself is not cut off by the corner clip. */}
            <span class="pin-frame">
              <span class="pin-icon">
                {s.icon === 'dartoHead' ? <DartoHead small /> : <Sprite name={s.icon} scale={ICON_SCALE[s.icon] ?? 1} />}
              </span>
              <span class="pin-name">{lit && canHover() ? s.label : s.name}</span>
              <span class="pin-short">{s.short}</span>
              {(!s.open || s.soon) && !lit && <span class="pin-soon">Soon</span>}
            </span>
            {/* Outside the frame: its stepped-corner clip would cut the dot. */}
            {id === 'friends' && friends && friendsDot && <i class="pin-dot" />}
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
