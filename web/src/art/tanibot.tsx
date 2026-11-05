// TaniBot, the farmer robot. Official design: the ChatGPT image Ardian made,
// converted to a pixel sprite (see tanibot-sprite.ts and docs/ASSETS.md).
// v1 (Seedling, Farmhand): the original colors.
// v2 (Pak Tani and up): same sprite with shinier chrome, brighter LEDs, 2 drones.
// Layers are animated separately: hover, blinking eyes, LED hat band, glowing screen.

import { only, Pixels } from '../sprites';
import { TANIBOT_ROWS, TANIBOT_V1, TANIBOT_V2 } from './tanibot-sprite';

export const TANIBOT_W = 58;
export const TANIBOT_H = 64;

export type BotVersion = 1 | 2;

export function botVersion(title: string): BotVersion {
  return title === 'Seedling' || title === 'Farmhand' ? 1 : 2;
}

function palette(version: BotVersion) {
  return version === 1 ? TANIBOT_V1 : TANIBOT_V2;
}

/** The base layer draws the eyes as dark visor, so hiding the eye layer makes TaniBot blink. */
function basePalette(version: BotVersion) {
  const p = palette(version);
  return { ...p, e: p.v, E: p.v };
}

const EYES = only(TANIBOT_ROWS, 'eE');
const LEDS = only(TANIBOT_ROWS, 'Ll');
const SCREEN = only(TANIBOT_ROWS, 'gG');

export function TaniBot({ version, scale = 1, working = false }: { version: BotVersion; scale?: number; working?: boolean }) {
  const p = palette(version);
  return (
    <div class={`tanibot v${version}${working ? ' working' : ''}`} style={{ width: TANIBOT_W * scale, height: TANIBOT_H * scale }}>
      <Pixels rows={TANIBOT_ROWS} palette={basePalette(version)} scale={scale} class="bot-body" title="TaniBot" />
      <Pixels rows={SCREEN} palette={p} scale={scale} class="bot-screen" />
      <Pixels rows={LEDS} palette={p} scale={scale} class="bot-leds" />
      <Pixels rows={EYES} palette={p} scale={scale} class="bot-eyes" />
    </div>
  );
}

/** Head and hat only, for the top bar. */
const HEAD_ROWS = 33;
export function TaniBotHead({ version, scale = 1 }: { version: BotVersion; scale?: number }) {
  const p = palette(version);
  const rows = TANIBOT_ROWS.slice(0, HEAD_ROWS);
  return (
    <div class={`tanibot-head v${version}`} style={{ width: TANIBOT_W * scale, height: HEAD_ROWS * scale }}>
      <Pixels rows={rows} palette={basePalette(version)} scale={scale} title="TaniBot" />
      <Pixels rows={LEDS.slice(0, HEAD_ROWS)} palette={p} scale={scale} class="bot-leds" />
      <Pixels rows={EYES.slice(0, HEAD_ROWS)} palette={p} scale={scale} class="bot-eyes" />
    </div>
  );
}

// ---------- Drones and tools (original pixel art drawn in code) ----------

export const DRONE = [
  'kk.......kk',
  'ccc.....ccc',
  '..kmmmmmk..',
  '..kmeeemk..',
  '...kmmmk...',
  '....kjk....',
];

const DRONE_PALETTE: Record<BotVersion, Record<string, string>> = {
  1: { k: '#1B1B2F', c: '#9CA3AF', m: '#9CA3AF', e: '#22D3EE', j: '#00EC97' },
  2: { k: '#1B1B2F', c: '#D1D5DB', m: '#C7D2DC', e: '#22D3EE', j: '#5CFFC2' },
};

export function Drone({ version, scale = 2, class: className = '' }: { version: BotVersion; scale?: number; class?: string }) {
  return (
    <div class={`drone ${className}`}>
      <Pixels rows={DRONE} palette={DRONE_PALETTE[version]} scale={scale} />
    </div>
  );
}

export const BASKET = ['k.......k', 'kHhHhHhHk', 'kHhHhHhHk', '.kHhHhHk.', '..kkkkk..'];

export const HOE = ['....cc', '...cmc', '..kk..', '.kk...', 'kk....'];
