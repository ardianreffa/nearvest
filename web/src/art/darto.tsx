// Mr. Darto, the village fruit buyer of the future: hologram glasses, batik
// shirt, digital scale and a hovering cart. Original pixel art drawn in code.

import { only, Pixels } from '../sprites';

export const DARTO = [
  '......kkkkkk......',
  '.....kllllllk.....',
  '....kllllllllk....',
  '....lccccccccl....',
  '....lcwcllcwcl....',
  '....llllLLllll....',
  '....llkkkkkkll....',
  '.....llkllkll.....',
  '......llllll......',
  '.......LLLL.......',
  '....uuuuuuuuuu....',
  '...uuyuuuuuuyuu...',
  '..luuuuyuuyuuuul..',
  '..luuyuuuuuuyuul..',
  '..luuuuyuuyuuuul..',
  '..ll.uuuuuuuu.ll..',
  '.....uuyuuyuu.....',
  '.....nnnnnnnn.....',
  '.....nnn..nnn.....',
  '.....nnn..nnn.....',
  '.....nnn..nnn.....',
  '....kkkk..kkkk....',
];

const DARTO_PALETTE = {
  l: '#E0B48A',
  L: '#B9875E',
  k: '#1B1B2F',
  c: '#22D3EE',
  w: '#E0FBFF',
  u: '#1E40AF',
  y: '#F5C542',
  n: '#3A3A4A',
};

export const CART = [
  '..AwAwAwAwAwAwAwAwAwAwAw..',
  '..AwAwAwAwAwAwAwAwAwAwAw..',
  '...k...................k..',
  '...k..oO.rR.qQ.oO.rR...k..',
  '...k.oOOrRRqQQoOOrRR...k..',
  '.bbbbbbbbbbbbbbbbbbbbbbbbb',
  '.bBBBBBBBBBBBBBBBBBBBBBBBb',
  '.bBsssssBBBByyyyBBBBBBBBBb',
  '.bBsgggsBBBByYYyBBBBBBBBBb',
  '.bBsssssBBBByyyyBBBBBBBBBb',
  '.bbbbbbbbbbbbbbbbbbbbbbbbb',
  '...kkkk..........kkkk.....',
  '...cccc..........cccc.....',
  '....cc............cc......',
];

const CART_PALETTE = {
  A: '#00EC97',
  w: '#F4FFF9',
  k: '#1B1B2F',
  o: '#FFD84A',
  O: '#F59E0B',
  r: '#EF4444',
  R: '#991B1B',
  q: '#A3C94A',
  Q: '#6B8E23',
  b: '#6B4A2F',
  B: '#8A6342',
  s: '#13221B',
  g: '#00EC97',
  y: '#F5C542',
  Y: '#C9971F',
  c: '#22D3EE',
};

export function DartoFigure({ scale = 4 }: { scale?: number }) {
  return (
    <div class="darto-figure" style={{ width: 18 * scale, height: 22 * scale }}>
      <Pixels rows={DARTO} palette={DARTO_PALETTE} scale={scale} title="Mr. Darto" />
      <Pixels rows={only(DARTO, 'cw')} palette={DARTO_PALETTE} scale={scale} class="holo" />
    </div>
  );
}

export function HoverCart({ scale = 3 }: { scale?: number }) {
  return (
    <div class="hover-cart" style={{ width: 26 * scale, height: 14 * scale }}>
      <Pixels rows={CART} palette={CART_PALETTE} scale={scale} />
      <Pixels rows={only(CART, 'c')} palette={CART_PALETTE} scale={scale} class="cart-jets" />
    </div>
  );
}

export const DARTO_FACE = DARTO.slice(0, 10);
export function DartoFace({ scale = 2 }: { scale?: number }) {
  return <Pixels rows={DARTO_FACE} palette={DARTO_PALETTE} scale={scale} title="Mr. Darto" />;
}
