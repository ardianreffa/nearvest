// Profile avatars: 8 square, front-facing, still (no animation) pixel portraits,
// drawn in code with the GDD palette. A different, flatter style than the
// garden sprites on purpose: they read as a "profile photo".
// The ids must match AVATARS in server/src/rules.ts.

import { Pixels } from '../sprites';
import { botSprite, TIER_TITLE, TIERS, type Tier } from './tanibot';

export type BasicAvatarId = 'farmer_hat' | 'farmer_hijab' | 'solarpunk' | 'grandpa' | 'mango' | 'rambutan' | 'durian' | 'tanibot';
/** TaniBot heads per title (unlock with the title; the server checks it too). */
export type BotAvatarId = `bot_${Tier}`;
export type AvatarId = BasicAvatarId | BotAvatarId;

interface AvatarArt {
  name: string;
  rows: string[];
  /** 'b' = background; other letters extend the shared sprite palette. */
  palette: Record<string, string>;
  /** TaniBot avatars: twice the detail for big sizes, and the tier (background and aura in CSS). */
  hdRows?: string[];
  tier?: Tier;
}

const BASIC: Record<BasicAvatarId, AvatarArt> = {
  farmer_hat: {
    name: 'Farmer',
    palette: { b: '#BDE8F5' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbHHbbbbbbb',
      'bbbbbbhhhhbbbbbb',
      'bbbbbhhHhhhbbbbb',
      'bbbbhhhhhhHhbbbb',
      'bbbhhHhhhhhhhbbb',
      'bHHHHHHHHHHHHHHb',
      'bbbbLllllllLbbbb',
      'bbbbllkllkllbbbb',
      'bbbbllllllllbbbb',
      'bbbbllLkkLllbbbb',
      'bbbbbllllllbbbbb',
      'bbbbbbLllLbbbbbb',
      'bbbuuuuuuuuuubbb',
      'bbuuuuwuuwuuuubb',
      'buuuuuuuuuuuuuub',
    ],
  },
  farmer_hijab: {
    name: 'Farmer (hijab)',
    palette: { b: '#F8E7C0', j: '#0F766E', J: '#115E59' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbbbjjjjjjbbbbb',
      'bbbbjjjjjjjjbbbb',
      'bbbjjjjjjjjjjbbb',
      'bbbjjLllllLjjbbb',
      'bbjjllllllllljbb',
      'bbjjllkllklljjbb',
      'bbjjlllllllljjbb',
      'bbjjllLkkLlljjbb',
      'bbjjjlllllljjjbb',
      'bbjjjjLllLjjjjbb',
      'bbjjjjjjjjjjjjbb',
      'bjjjjjjjjjjjjjjb',
      'bjjJjjjjjjjjJjjb',
      'jjjJjjjjjjjjJjjj',
      'jjjJjjjjjjjjJjjj',
    ],
  },
  solarpunk: {
    name: 'Solarpunk youth',
    palette: { b: '#3B2A6B', n: '#2B1D14' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbbbnnnnnnbbbbb',
      'bbbbnnnnnnnnbbbb',
      'bbbnnnnnnnnnnbbb',
      'bbbkcckkkkcckbbb',
      'bbbnLllllllLnbbb',
      'bbbbllkllkllbbbb',
      'bbbbllllllllbbbb',
      'bbbbllLkkLllbbbb',
      'bbbbbllllllbbbbb',
      'bbbbbbLllLbbbbbb',
      'bbbmmmmmmmmmmbbb',
      'bbmmmEmmmmEmmmbb',
      'bmmmmEmmmmEmmmmb',
      'bmmmmmmyymmmmmmb',
      'bmmmmmmyymmmmmmb',
    ],
  },
  grandpa: {
    name: 'Grandpa farmer',
    palette: { b: '#E8D5A8', q: '#262626' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbbbb',
      'bbbbbqqqqqqbbbbb',
      'bbbbqqqqqqqqbbbb',
      'bbbbqqqqqqqqbbbb',
      'bbbwLllllllLwbbb',
      'bbbwllllllllwbbb',
      'bbbbekeeeekebbbb',
      'bbbbllllllllbbbb',
      'bbbbwwwwwwwwbbbb',
      'bbbbblwwwwlbbbbb',
      'bbbbbbwwwwbbbbbb',
      'bbbbbbbLLbbbbbbb',
      'bbbssssssssssbbb',
      'bbsssssSSsssssbb',
      'bsssssSSSSsssssb',
    ],
  },
  mango: {
    name: 'Mango',
    palette: { b: '#FFF3C4', O: '#D97706' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbbdgGbbbbb',
      'bbbbbbbdgggGbbbb',
      'bbbbbbbdbbbbbbbb',
      'bbbbbooooooobbbb',
      'bbbbooyyoooooObb',
      'bbbooyoooooooObb',
      'bbbooookoookoObb',
      'bbooooooooooooOb',
      'bbooroooooooroOb',
      'bbooooookkoooOOb',
      'bbboooooooooOObb',
      'bbbboooooooOObbb',
      'bbbbbOOOOOOObbbb',
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbbbb',
    ],
  },
  rambutan: {
    name: 'Rambutan',
    palette: { b: '#E3F6E8' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbbGbbGbbGbbbbb',
      'bbGbbrrrrrrbbGbb',
      'bbbrrrRrrRrrrbbb',
      'bGrrrrrrrrrrrrGb',
      'bbrRrrrrrrrrRrbb',
      'Grrrrkrrrrkrrrrb',
      'bbrrrkrrrrkrrrbG',
      'Grrrrrrrrrrrrrrb',
      'bbrRrrrwwrrrRrbb',
      'bGrrrrrrrrrrrrGb',
      'bbbrrRrrrrRrrbbb',
      'bbGbbrrrrrrbbGbb',
      'bbbbGbbGbbGbbbbb',
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbbbb',
    ],
  },
  durian: {
    name: 'Durian',
    palette: { b: '#F3E8FF' },
    rows: [
      'bbbbbbbbdbbbbbbb',
      'bbbbbbbbdbbbbbbb',
      'bbbbGbbgggbbGbbb',
      'bbbbgGgGgGgGgbbb',
      'bbGgGgGgGgGgGgbb',
      'bbgGgGgGgGgGgGbb',
      'bGgGgkgGgGkgGgGb',
      'bgGgGkGgGgkGgGgb',
      'bGgGgGgGgGgGgGgb',
      'bgGgGgGkkGgGgGgb',
      'bbGgGgGgGgGgGgbb',
      'bbgGgGgGgGgGgGbb',
      'bbbbGgGgGgGgbbbb',
      'bbbbbGbbbbGbbbbb',
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbbbbbbbbbb',
    ],
  },
  tanibot: {
    name: 'TaniBot',
    palette: { b: '#0B3B2E' },
    rows: [
      'bbbbbbbbbbbbbbbb',
      'bbbbbbbhhbbbbbbb',
      'bbbbbbhhhhbbbbbb',
      'bbbbbhhhhhhbbbbb',
      'bbbhhhhhhhhhhbbb',
      'bmmmmmmmmmmmmmmb',
      'bbbeeeeeeeeeebbb',
      'bbbekkkkkkkkebbb',
      'bbbekcckkcckebbb',
      'bbbekkkkkkkkebbb',
      'bbbekkmmmmkkebbb',
      'bbbeeeeeeeeeebbb',
      'bbbbbbEEEEbbbbbb',
      'bbbeeeeeeeeeebbb',
      'bbeeeemmmmeeeebb',
      'beeeeeeeeeeeeeeb',
    ],
  },
};

/** Soft background of each TaniBot avatar (matches its frame), brighter with each title. */
const BOT_BG: Record<Tier, string> = {
  seedling: '#BDE8F5',
  farmhand: '#C8F0D8',
  farmer: '#B9F7DD',
  orchard_master: '#D6F5C2',
  durian_king: '#FCE7A8',
  legend: '#CFFAFE',
};

/** The whole TaniBot of a tier, trimmed to its body and centred in a square (transparent around it). */
function botFull(tier: Tier, hd: boolean): string[] {
  // Tiers with an aura get more room around the body; Legend also room above the hat for its halo.
  const margin = tier === 'legend' ? 1.3 : tier === 'durian_king' ? 1.2 : 1.06;
  const rows = botSprite(tier, hd).rows;
  const filled = (r: string) => /[^.]/.test(r);
  const top = rows.findIndex(filled);
  const bottom = rows.length - 1 - [...rows].reverse().findIndex(filled);
  let left = Infinity;
  let right = -1;
  for (const r of rows) {
    const i = r.search(/[^.]/);
    if (i < 0) continue;
    left = Math.min(left, i);
    right = Math.max(right, r.length - 1 - [...r].reverse().findIndex((c) => c !== '.'));
  }
  const body = rows.slice(top, bottom + 1).map((r) => r.slice(left, right + 1));
  const h = body.length;
  const w = body[0].length;
  const side = Math.ceil(Math.max(w, h) * margin);
  const padX = Math.floor((side - w) / 2);
  const padTop = tier === 'legend' ? side - h - Math.floor((side - h) * 0.15) : Math.floor((side - h) / 2);
  const blank = '.'.repeat(side);
  return [
    ...Array.from({ length: padTop }, () => blank),
    ...body.map((r) => '.'.repeat(padX) + r + '.'.repeat(side - w - padX)),
    ...Array.from({ length: side - h - padTop }, () => blank),
  ];
}

function botAvatar(tier: Tier): AvatarArt {
  return { name: `TaniBot ${TIER_TITLE[tier]}`, rows: botFull(tier, false), hdRows: botFull(tier, true), palette: botSprite(tier, false).palette, tier };
}

export const AVATARS: Record<AvatarId, AvatarArt> = {
  ...BASIC,
  ...(Object.fromEntries(TIERS.map((t) => [`bot_${t}`, botAvatar(t)])) as Record<BotAvatarId, AvatarArt>),
};

export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

/** The title a TaniBot head avatar needs (none for the others and for Seedling). */
export function avatarTitle(id: AvatarId): string | null {
  return id.startsWith('bot_') && id !== 'bot_seedling' ? TIER_TITLE[id.slice(4) as Tier] : null;
}

/**
 * A square, still avatar. `size` is the CSS width in px. `locked` = a dark silhouette.
 * TaniBot avatars show the whole robot of that title, facing front, on a soft background;
 * Durian King adds a still golden durian glow, Legend a white-cyan circle of light and a halo.
 */
export function Avatar({ id, size = 48, locked = false }: { id: string; size?: number; locked?: boolean }) {
  const art = AVATARS[(id in AVATARS ? id : 'farmer_hat') as AvatarId];
  if (art.tier) {
    const rows = size >= 64 && art.hdRows ? art.hdRows : art.rows;
    const palette = locked ? Object.fromEntries(Object.keys(art.palette).map((k) => [k, '#1b1b2f'])) : art.palette;
    return (
      <span class={`avatar avatar-bot bot-bg-${art.tier}${locked ? ' locked' : ''}`} style={{ width: size, height: size, '--bot-bg': BOT_BG[art.tier] }}>
        <Pixels rows={rows} palette={palette} scale={size / rows[0].length} title={art.name} />
      </span>
    );
  }
  const grid = art.rows[0].length;
  const palette = locked ? Object.fromEntries(Object.keys(art.palette).map((k) => [k, k === 'b' ? '#3a3f4b' : '#1b1b2f'])) : art.palette;
  return (
    <span class={`avatar${locked ? ' locked' : ''}`} style={{ width: size, height: size }}>
      <Pixels rows={art.rows} palette={palette} scale={size / grid} title={art.name} />
    </span>
  );
}
