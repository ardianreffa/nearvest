// TaniBot: the futuristic farmer robot with a caping (conical hat), a chest
// status screen and helper drones. Original pixel art drawn in code.
// v1 (Seedling, Farmhand): a bit rusty, bamboo hat, 1 drone.
// v2 (Pak Tani and up): shiny chrome, LED-lit hat, 2 drones.

import { only, Pixels } from '../sprites';

// Characters: H/h hat, L hat LED, k outline, m/M/x metal, v visor, e eyes,
// s screen, g screen glow, j thruster, a arm joint.
export const TANIBOT = [
  '..........HH..........',
  '........HhhhhH........',
  '......HhhLhhLhhH......',
  '....HhhhhhhhhhhhhH....',
  '..HhLhhhhLhhhhLhhhhH..',
  'HHHHHHHHHHHHHHHHHHHHHH',
  '......kmmmmmmmmmk.....',
  '......kvvvvvvvvvk.....',
  '......kvveevveevk.....',
  '......kvvvvvvvvvk.....',
  '......kmmmxmmmmmk.....',
  '.......kMMMMMMMk......',
  '....kkmmmmmmmmmmmkk...',
  '...kmmkssssssssskmmk..',
  '...kmxksgsggsgsskmxk..',
  '...kmmksggsggsgskmmk..',
  '..kaak.ksssssssk.kaak.',
  '..kmmk.kmmmmmmmk.kmmk.',
  '..kxmk.kmMmmmMmk.kmxk.',
  '..kkkk..kmmmmmk..kkkk.',
  '.........kMMMk........',
  '.........kjjjk........',
  '..........jjj.........',
  '...........j..........',
];

const V1: Record<string, string> = {
  H: '#9A7438',
  h: '#C9A35A',
  L: '#C9A35A', // plain bamboo, no LEDs yet
  k: '#1B1B2F',
  m: '#8C8F94',
  M: '#5C5F66',
  x: '#A45A2A', // rust
  v: '#1F2633',
  e: '#22D3EE',
  s: '#13221B',
  g: '#2E8B57',
  j: '#22D3EE',
  a: '#6B6E74',
};

const V2: Record<string, string> = {
  ...V1,
  H: '#2C3A44',
  h: '#E8EEF2',
  L: '#00EC97', // LED strip on the hat
  m: '#D7DEE5',
  M: '#8E9AA6',
  x: '#FFFFFF', // chrome shine
  g: '#00EC97',
  a: '#22D3EE',
};

export type BotVersion = 1 | 2;

export function botVersion(title: string): BotVersion {
  return title === 'Seedling' || title === 'Farmhand' ? 1 : 2;
}

/** TaniBot with separately animated layers: blinking eyes, LED hat, screen, thruster. */
export function TaniBot({ version, scale = 3, working = false }: { version: BotVersion; scale?: number; working?: boolean }) {
  const palette = version === 1 ? V1 : V2;
  return (
    <div class={`tanibot v${version}${working ? ' working' : ''}`} style={{ width: 22 * scale, height: 24 * scale }}>
      <Pixels rows={TANIBOT} palette={palette} scale={scale} class="bot-body" />
      <Pixels rows={only(TANIBOT, 'g')} palette={palette} scale={scale} class="bot-screen" />
      <Pixels rows={only(TANIBOT, 'e')} palette={palette} scale={scale} class="bot-eyes" />
      {version === 2 && <Pixels rows={only(TANIBOT, 'L')} palette={palette} scale={scale} class="bot-leds" />}
      <Pixels rows={only(TANIBOT, 'j')} palette={palette} scale={scale} class="bot-thruster" />
    </div>
  );
}

export const DRONE = [
  'kk.......kk',
  'ccc.....ccc',
  '..kmmmmmk..',
  '..kmeeemk..',
  '...kmmmk...',
  '....kjk....',
];

export function Drone({ version, scale = 2, class: className = '' }: { version: BotVersion; scale?: number; class?: string }) {
  const palette = { ...(version === 1 ? V1 : V2), c: '#9CA3AF' };
  return (
    <div class={`drone ${className}`}>
      <Pixels rows={DRONE} palette={palette} scale={scale} />
    </div>
  );
}

/** Small head-only TaniBot for the top bar. */
export const TANIBOT_HEAD = TANIBOT.slice(0, 12);

export function TaniBotHead({ version, scale = 2 }: { version: BotVersion; scale?: number }) {
  return <Pixels rows={TANIBOT_HEAD} palette={version === 1 ? V1 : V2} scale={scale} title="TaniBot" />;
}

export const BASKET = ['k.......k', 'kHhHhHhHk', 'kHhHhHhHk', '.kHhHhHk.', '..kkkkk..'];

export const HOE = ['....cc', '...cmc', '..kk..', '.kk...', 'kk....'];
