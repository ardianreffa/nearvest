// Profile avatars: 8 square, front-facing, still (no animation) pixel portraits,
// drawn in code with the GDD palette. A different, flatter style than the
// garden sprites on purpose: they read as a "profile photo".
// The ids must match AVATARS in server/src/rules.ts.

import { Pixels } from '../sprites';

export type AvatarId = 'farmer_hat' | 'farmer_hijab' | 'solarpunk' | 'grandpa' | 'mango' | 'rambutan' | 'durian' | 'tanibot';

interface AvatarArt {
  name: string;
  rows: string[];
  /** 'b' = background; other letters extend the shared sprite palette. */
  palette: Record<string, string>;
}

export const AVATARS: Record<AvatarId, AvatarArt> = {
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

export const AVATAR_IDS = Object.keys(AVATARS) as AvatarId[];

/** A square, still avatar. `size` is the CSS width in px (a multiple of 16 keeps pixels crisp). */
export function Avatar({ id, size = 48 }: { id: string; size?: number }) {
  const art = AVATARS[(id in AVATARS ? id : 'farmer_hat') as AvatarId];
  return (
    <span class="avatar" style={{ width: size, height: size }}>
      <Pixels rows={art.rows} palette={art.palette} scale={size / 16} title={art.name} />
    </span>
  );
}
