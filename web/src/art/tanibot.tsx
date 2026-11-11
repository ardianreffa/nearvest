// TaniBot, the farmer robot. One look per title (Seedling = the original design;
// Farmhand, Farmer, Orchard Master, Durian King and Legend = Ardian's ChatGPT
// evolutions, see tanibot-evolutions.ts and docs/ASSETS.md). Phones draw the
// 58x64 sprite (`sd`); bigger sizes the 116x128 one (`hd`, same size, twice the detail).
//
// Each sprite is split into layers that animate on their own (all CSS, so it is
// light on phones and stops with prefers-reduced-motion):
//   eyes (blink), hat LEDs (pulse), glow (screen and joints),
//   prop (watering can, swings while flying), leaf (shoulder leaves, sway),
//   cape (Durian King's solar cape: light sweep; Legend's batik: two halves glow in turn).
// Tier effects (auras, halo, sweep, sparkles, bubbles, drones) are drawn around it in code.

import type { ComponentChildren } from 'preact';
import { Pixels } from '../sprites';
import { TANIBOT_ROWS, TANIBOT_V1 } from './tanibot-sprite';
import { EVOLUTION_PALETTE, TANIBOT_EVOLUTIONS } from './tanibot-evolutions';

export const TANIBOT_W = 58;
export const TANIBOT_H = 64;

export { TIERS, TIER_TITLE, droneCount, tierOf, tierRank, type Tier } from './tiers';
import { TIER_TITLE, droneCount, tierRank, type Tier } from './tiers';

const PALETTE: Record<string, string> = { ...EVOLUTION_PALETTE, ...TANIBOT_V1 };

// ---------- layers ----------

interface Layers {
  w: number;
  h: number;
  base: string[];
  eyes: string[];
  leds: string[];
  glow: string[];
  prop: string[] | null;
  leaf: string[] | null;
  cape: string[] | null;
  capeA: string[] | null;
  capeB: string[] | null;
  /** Gold studs on the hat (sparkle spots), in cells. */
  studs: [number, number][];
  /** Center of the seed tank (bubbles), in cells. */
  tank: [number, number] | null;
}

const empty = (h: number, w: number) => Array.from({ length: h }, () => Array<string>(w).fill('.'));
const join = (grid: string[][]) => grid.map((r) => r.join(''));

function rawRows(tier: Tier, hd: boolean): string[] {
  if (tier === 'seedling' && !hd) return TANIBOT_ROWS;
  return TANIBOT_EVOLUTIONS[tier][hd ? 'hd' : 'sd'];
}

/** The complete sprite (all layers in place) for pictures such as share cards. */
export function botSprite(tier: Tier, hd: boolean): { rows: string[]; palette: Record<string, string> } {
  return { rows: rawRows(tier, hd), palette: PALETTE };
}

const cache = new Map<string, Layers>();

/**
 * Splits a sprite into its animated layers by color and position (positions in
 * 58x64 cells, doubled for hd). The eyes and the hat sit in the same place in
 * every version (the sprites are registered on the eyes).
 */
export function layersOf(tier: Tier, hd: boolean): Layers {
  const key = `${tier}-${hd}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const f = hd ? 2 : 1;
  // The original keeps its hand-made layer letters; the others are normalized first.
  const src = rawRows(tier, hd).map((r) => (tier === 'seedling' && !hd ? r : r.replace(/e/g, 'c').replace(/E/g, 'C').replace(/L/g, 'g').replace(/l/g, 'C')));
  const h = src.length;
  const w = src[0].length;
  const base = src.map((r) => [...r]);
  const eyes = empty(h, w);
  const leds = empty(h, w);
  const glow = empty(h, w);
  const has = (t: Tier) => tierRank(tier) >= tierRank(t);
  const prop = has('farmhand') ? empty(h, w) : null;
  const leaf = has('orchard_master') ? empty(h, w) : null;
  const cape = tier === 'durian_king' || tier === 'legend' ? empty(h, w) : null;
  const capeA = tier === 'legend' ? empty(h, w) : null;
  const capeB = tier === 'legend' ? empty(h, w) : null;
  const studs: [number, number][] = [];
  const tankCells: [number, number][] = [];
  const inBox = (r: number, q: number, r0: number, r1: number, q0: number, q1: number) => r >= r0 * f && r < r1 * f && q >= q0 * f && q < q1 * f;

  for (let r = 0; r < h; r++) {
    for (let q = 0; q < w; q++) {
      const c = base[r][q];
      if (c === '.') continue;
      // Eyes: cyan inside the visor. In the base they become visor, so hiding the layer = a blink.
      if ('eEcC'.includes(c) && inBox(r, q, 21, 29, 14, 39)) {
        eyes[r][q] = c === 'C' || c === 'E' ? 'E' : 'e';
        base[r][q] = 'v';
        continue;
      }
      // Hat LED band: the glowing mint ring above the visor.
      if ('LlgCU'.includes(c) && r >= 9 * f && r < 18 * f) {
        leds[r][q] = c === 'g' || c === 'L' ? 'L' : 'l';
        continue;
      }
      if (tier !== 'seedling' && c === 'y' && r >= 9 * f && r < 19 * f) studs.push([r, q]);
      // Watering can (left hand): its own layer so it can swing.
      if (prop && inBox(r, q, 48, 56, 12, 21) && !'gG'.includes(c)) {
        prop[r][q] = c;
        base[r][q] = '.';
        continue;
      }
      // Shoulder leaves.
      if (leaf && 'fFgG'.includes(c) && (inBox(r, q, 34, 41, 9, 20) || inBox(r, q, 34, 41, 33, 44))) {
        leaf[r][q] = c;
        base[r][q] = '.';
        continue;
      }
      if (has('orchard_master') && 'CUc'.includes(c) && inBox(r, q, 36, 46, 43, 49)) tankCells.push([r, q]);
      // Capes: Durian King's blue solar panels; Legend's batik sides.
      if (cape && ((tier === 'durian_king' && 'uU'.includes(c)) || (tier === 'legend' && (inBox(r, q, 43, 64, 0, 12) || inBox(r, q, 43, 64, 46, 58))))) {
        cape[r][q] = c;
        if (capeA && capeB && 'ygGf'.includes(c)) ((Math.floor(r / (2 * f)) + Math.floor(q / (2 * f))) % 2 ? capeA : capeB)[r][q] = c;
      }
      // Screen and joints glow.
      if ('gG'.includes(c) && r >= 18 * f) glow[r][q] = c;
    }
  }
  // A few studs spread along the brim.
  const picked: [number, number][] = [];
  for (const s of studs.sort((a, b) => a[1] - b[1])) if (!picked.some((p) => Math.abs(p[1] - s[1]) < 7 * f)) picked.push(s);
  const tank: [number, number] | null = tankCells.length
    ? [tankCells.reduce((n, c) => n + c[0], 0) / tankCells.length, tankCells.reduce((n, c) => n + c[1], 0) / tankCells.length]
    : null;
  const layers: Layers = {
    w,
    h,
    base: join(base),
    eyes: join(eyes),
    leds: join(leds),
    glow: join(glow),
    prop: prop && join(prop),
    leaf: leaf && join(leaf),
    cape: cape && join(cape),
    capeA: capeA && join(capeA),
    capeB: capeB && join(capeB),
    studs: picked.slice(0, 7),
    tank,
  };
  cache.set(key, layers);
  return layers;
}

/** A sprite as a PNG data URL (used as a CSS mask for light sweeps). */
const maskCache = new Map<string, string>();
function maskUrl(rows: string[], key: string): string {
  const hit = maskCache.get(key);
  if (hit !== undefined) return hit;
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = rows[0].length;
    c.height = rows.length;
    const ctx = c.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      rows.forEach((row, y) => [...row].forEach((ch, x) => ch !== '.' && ctx.fillRect(x, y, 1, 1)));
      url = c.toDataURL();
    }
  } catch {
    url = '';
  }
  maskCache.set(key, url);
  return url;
}

// ---------- components ----------

function Layer({ rows, scale, cls, style }: { rows: string[] | null; scale: number; cls: string; style?: Record<string, string> }) {
  if (!rows) return null;
  return <Pixels rows={rows} palette={PALETTE} scale={scale} class={cls} style={style} />;
}

/**
 * TaniBot. `scale` = CSS px per pixel of the 58x64 grid (1 on phones); from 2 up
 * the detailed hd sprite is drawn at half that per pixel.
 */
export function TaniBot({ tier, scale = 1, working = false, effects = true }: { tier: Tier; scale?: number; working?: boolean; effects?: boolean }) {
  const hd = scale >= 2;
  const L = layersOf(tier, hd);
  const px = hd ? scale / 2 : scale;
  const W = TANIBOT_W * scale;
  const H = TANIBOT_H * scale;
  const base = { ...PALETTE, e: PALETTE.v, E: PALETTE.v };
  const at = (r: number, q: number, extra: Record<string, string | number> = {}) => ({ left: `${((q + 0.5) / L.w) * 100}%`, top: `${((r + 0.5) / L.h) * 100}%`, ...extra });
  const bodyMask = tier === 'farmer' || tier === 'legend' ? maskUrl(L.base, `${tier}-${hd}-body`) : '';
  const capeMask = tier === 'durian_king' && L.cape ? maskUrl(L.cape, `${tier}-${hd}-cape`) : '';
  return (
    <div class={`tanibot tier-${tier}${working ? ' working' : ''}`} style={{ width: W, height: H }}>
      {effects && tier === 'durian_king' && <span class="bot-aura aura-durian" aria-hidden="true" />}
      {effects && tier === 'legend' && (
        <>
          <span class="bot-aura aura-legend" aria-hidden="true" />
          <span class="bot-halo" aria-hidden="true" />
        </>
      )}
      <Pixels rows={L.base} palette={base} scale={px} class="bot-body" title={`TaniBot (${TIER_TITLE[tier]})`} />
      <Layer rows={L.cape} scale={px} cls="bot-cape" />
      <Layer rows={L.capeA} scale={px} cls="bot-batik a" />
      <Layer rows={L.capeB} scale={px} cls="bot-batik b" />
      <Layer rows={L.glow} scale={px} cls="bot-screen" />
      <Layer rows={L.leds} scale={px} cls="bot-leds" />
      <Layer rows={L.eyes} scale={px} cls="bot-eyes" />
      <Layer rows={L.leaf} scale={px} cls="bot-leaf" />
      <Layer rows={L.prop} scale={px} cls="bot-prop" />
      {effects && bodyMask && tier === 'farmer' && <span class="bot-sweep" style={{ maskImage: `url(${bodyMask})`, WebkitMaskImage: `url(${bodyMask})` }} aria-hidden="true" />}
      {effects && bodyMask && tier === 'legend' && <span class="bot-scan" style={{ maskImage: `url(${bodyMask})`, WebkitMaskImage: `url(${bodyMask})` }} aria-hidden="true" />}
      {effects && capeMask && <span class="bot-sweep cape" style={{ maskImage: `url(${capeMask})`, WebkitMaskImage: `url(${capeMask})` }} aria-hidden="true" />}
      {effects && L.studs.map(([r, q], i) => <i key={i} class="bot-twinkle" style={at(r, q, { animationDelay: `${(i * 0.7) % 3}s` })} aria-hidden="true" />)}
      {effects && L.tank && (
        <span class="bot-bubbles" style={at(L.tank[0], L.tank[1])} aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      )}
      {effects && tier === 'orchard_master' && <i class="bot-falling-leaf" aria-hidden="true" />}
      {effects && tier === 'legend' && (
        <span class="bot-stars" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
      )}
    </div>
  );
}

/** Head and hat only (top bar, icons, avatars). */
const HEAD_ROWS = 33;
export function TaniBotHead({ tier, scale = 1, still = false }: { tier: Tier; scale?: number; still?: boolean }) {
  const hd = scale >= 2;
  const L = layersOf(tier, hd);
  const f = hd ? 2 : 1;
  const px = hd ? scale / 2 : scale;
  const cut = (rows: string[]) => rows.slice(0, HEAD_ROWS * f);
  return (
    <div class={`tanibot-head tier-${tier}${still ? ' still' : ''}`} style={{ width: TANIBOT_W * scale, height: HEAD_ROWS * scale }}>
      <Pixels rows={cut(L.base)} palette={{ ...PALETTE, e: PALETTE.v, E: PALETTE.v }} scale={px} title="TaniBot" />
      <Pixels rows={cut(L.leds)} palette={PALETTE} scale={px} class="bot-leds" />
      <Pixels rows={cut(L.eyes)} palette={PALETTE} scale={px} class="bot-eyes" />
    </div>
  );
}

// ---------- Drones: a body, four arms with spinning propellers, a blinking LED ----------

/** Side view of a quadcopter (the two back rotors sit a little higher and darker). */
const DRONE_BODY = [
  '..k...k.......k...k..',
  '.kmk.kDk.....kDk.kmk.',
  '..kmmmkDDDDDDDkmmmk..',
  '....kkmmmmmmmmmkk....',
  '.....kmnnnnnnnmk.....',
  '.....kmmcccccmmk.....',
  '......kmmmmmmmk......',
  '.......k.....k.......',
  '......kk.....kk......',
];
/** Two propeller frames: blades out, blades edge-on (shown in turn = spinning). */
const PROP_A = [
  'nnnnn.D.......D.nnnnn',
  '.....................',
];
const PROP_B = [
  '..n..DDD.....DDD..n..',
  '.....................',
];
const DRONE_PAL = { k: '#1B1B2F', m: '#9CA3AF', n: '#E5E7EB', D: '#4B5563', c: '#22D3EE' };

/**
 * The drones that fly with TaniBot (1 from Farmer, 2 for the Legend), orbiting its shoulders; asleep
 * (`parked`) they rest and dim. The garden and the Arena duel use the same ones (one look everywhere).
 */
export function BotDrones({ tier, scale, shadow, parked = false }: { tier: Tier; scale: number; shadow: number; parked?: boolean }) {
  const n = droneCount(tier);
  if (n === 0) return null;
  return (
    <div class={`bot-drones${parked ? ' parked' : ''}`} aria-hidden="true">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} class={`orbit o${i + 1}`}>
          <Drone scale={scale} shadow={shadow} />
        </span>
      ))}
    </div>
  );
}

export function Drone({ scale = 2, class: className = '', shadow = 0, children }: { scale?: number; class?: string; shadow?: number; children?: ComponentChildren }) {
  return (
    <div class={`drone ${className}`} style={{ width: 21 * scale, height: 11 * scale }}>
      <Pixels rows={['.....................', ...DRONE_BODY, '.']} palette={DRONE_PAL} scale={scale} class="drone-body" />
      <Pixels rows={PROP_A} palette={DRONE_PAL} scale={scale} class="drone-prop a" />
      <Pixels rows={PROP_B} palette={DRONE_PAL} scale={scale} class="drone-prop b" />
      <i class="drone-led" style={{ left: `${(10 / 21) * 100}%`, top: `${(7 / 11) * 100}%`, width: scale, height: scale }} />
      {shadow > 0 && <i class="drone-shadow" style={{ top: `calc(100% + ${shadow}px)` }} />}
      {children}
    </div>
  );
}

export const BASKET = ['k.......k', 'kHhHhHhHk', 'kHhHhHhHk', '.kHhHhHk.', '..kkkkk..'];

export const HOE = ['....cc', '...cmc', '..kk..', '.kk...', 'kk....'];
