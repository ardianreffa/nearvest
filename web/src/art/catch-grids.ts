// Pixel grids of the pond's catches (catch-icons.tsx draws them; web/test/fishing.test.ts checks
// them). Original pixel art drawn in code; its own palette (CLAUDE.md Design system).

import type { FishingCatchId } from '../api';

/** Extra colours for the catches (the base PALETTE in sprites.tsx covers outline, white, gold...). */
export const FISH_PALETTE: Record<string, string> = {
  // tilapia: grey-green with darker stripes
  a: '#8a9a7b',
  A: '#5c6b50',
  // catfish: muddy brown, pale belly
  b: '#8a6a48',
  B: '#5a4330',
  i: '#d9c7a5',
  // carp: orange-red koi with white patches
  n: '#e8743b',
  N: '#a9461e',
  // gourami: blue-silver
  v: '#9cc3d3',
  V: '#5a8ca3',
  // golden arowana: gold shades (y / Y from PALETTE) + bright highlight
  z: '#fff1a8',
  // junk
  t: '#8d8f94', // stone
  T: '#5f6166',
  f: '#9b7b55', // driftwood
  F: '#6a5137',
  q: '#efe8d6', // bone
  Q: '#b8ae96',
  x: '#5b3a24', // boot leather
  X: '#3a2416',
  // bottle glass
  j: '#7fd6c8',
  J: '#3f9c8f',
  // chest wood
  h: '#a0703f',
  H: '#6b4a2f',
};

export const CATCH_GRIDS: Partial<Record<FishingCatchId, string[]>> = {
  tilapia: [
    '....kkkkk.....',
    '..kkaAaAakk..k',
    '.kwkaAaAaaakkk',
    'kaaaAaAaAaaaak',
    'kaaaAaAaAaaaak',
    '.kaaAaAaAaakkk',
    '..kkaaaaakk..k',
    '....kkkkk.....',
  ],
  catfish: [
    '....kkkkkk....',
    '..kkbbbBbbkk.k',
    '.kwkbbbbBbbbkk',
    'kbbbbbbbbbbbbk',
    'kBiiiiiiiibbbk',
    'kkkiiiiiiibkkk',
    'B.kkkkkkkkk..k',
    'B.............',
  ],
  carp: [
    '....kkkkk.....',
    '..kknnwwnkk..k',
    '.kwknnwwnnnkkk',
    'knnnnnnnwwnnnk',
    'knnNnnnnwwnnnk',
    '.kNNNnnnnnnkkk',
    '..kkNNNNnkk..k',
    '....kkkkk.....',
  ],
  gourami: [
    '.....kkk......',
    '...kkvvvkk....',
    '..kvvvvvvvk..k',
    '.kwkvVvVvvvkkk',
    'kvvvvvvvvvvvvk',
    'kvvVvVvVvvvvvk',
    '.kvvvvvvvvvkkk',
    '..kkVVVVVkk..k',
    '....kkkkk.....',
  ],
  golden_arowana: [
    '.....kkkkkk......',
    '...kkyzyyzykk...k',
    '..kwkyyzyyzyyk.kk',
    '.kkyyyyyyyyyyykyk',
    'kyyyyyzyyzyyyyyyk',
    'kYyyyyyyyyyyyykyk',
    '.kYYYYyyyyyyykkkk',
    '..kkYYYYYYYkk...k',
    '....kkkkkkk......',
  ],
  stone: [
    '...kkkkk...',
    '.kktttttkk.',
    'kttwtttttTk',
    'ktttttTtttk',
    'kTtttttttTk',
    '.kTTttTTTk.',
    '..kkkkkkk..',
  ],
  driftwood: [
    '..........kk..',
    'kkkkkkkkkkfk..',
    'kffFfffffFffkk',
    'kfFffffFfffffk',
    '.kkfffFfffkkk.',
    '...kkkkkkk....',
  ],
  fish_bone: [
    'kk.k.k.k.k..kk',
    'kqk.q.q.q.qkqk',
    'kqqqqqqqqqqqqk',
    'kqk.q.q.q.qkqk',
    'kk.k.k.k.k..kk',
  ],
  old_boot: [
    '..kkkkk.....',
    '..kxXxk.....',
    '..kxxxk.....',
    '..kxXxk.....',
    '..kxxxkkkk..',
    '.kxxxxxxxxk.',
    '.kxxxxxxXxxk',
    '.kXXXXXXXXXk',
    '.kkkkkkkkkkk',
  ],
  bottle: [
    '...kkk...',
    '...khk...',
    '..kjjjk..',
    '.kjjwjjk.',
    'kjjqqqjjk',
    'kjjqQqjjk',
    'kjjqqqjjk',
    'kjjjjjwjk',
    'kJJJJJJJk',
    '.kkkkkkk.',
  ],
  chest: [
    '.kkkkkkkkkk.',
    'khhhhhhhhhhk',
    'kHHHHyyHHHHk',
    'kkkkkyYkkkkk',
    'khhhhyyhhhhk',
    'khhhhhhhhhhk',
    'kHHHHHHHHHHk',
    'kkkkkkkkkkkk',
  ],
};

