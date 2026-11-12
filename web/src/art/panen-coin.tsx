// The PANEN coin (Fishing package 6, Ardian 2026-11-12): a round gold coin with a "P" and a vertical
// stroke through it, like a dollar sign. Original pixel art drawn in code (its own palette, CLAUDE.md
// Design system). Used for the PANEN balance in the village HUD and at the fishing pond.

import { Pixels } from '../sprites';

export const PANEN_COIN_ROWS = [
  '....kkkkk....',
  '..kkYYYYYkk..',
  '.kYzyyKyyyYk.',
  '.kYzKKKKKyYk.',
  'kYzyKyKyyKyYk',
  'kYyyKyKyyKyYk',
  'kYyyKKKKKyyYk',
  'kYyyKyKyyyyYk',
  'kYyyKyKyyyyYk',
  '.kYyKyKyyyYk.',
  '.kYyyyKyyyYk.',
  '..kkYYYYYkk..',
  '....kkkkk....',
];
export const PANEN_COIN_PALETTE = { k: '#1b1b2f', Y: '#c9971f', y: '#f5c542', K: '#7a4f12', z: '#fff1a8' };

/** `scale` = screen px per art pixel (the coin is 13 x 13). */
export function PanenCoin({ scale = 2 }: { scale?: number }) {
  return <Pixels rows={PANEN_COIN_ROWS} palette={PANEN_COIN_PALETTE} scale={scale} class="panen-coin" title="PANEN" />;
}
