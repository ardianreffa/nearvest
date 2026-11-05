// Backdrops for the Market (floating market on the canal) and the Shop (village
// square with the big banyan tree). AI images (ChatGPT) made at Ardian's request,
// pixelized to 240x120 with tools/pixelize (see docs/ASSETS.md). Light overlays:
// canal ripples, bobbing boats, a passing drone, blinking lanterns and signs,
// fountain shimmer and twinkling string lights. Coordinates are in art pixels.

import type { ComponentChildren } from 'preact';

const W = 240;
const H = 120;

function at(x: number, y: number, w: number, h: number) {
  return { left: `${(x / W) * 100}%`, top: `${(y / H) * 100}%`, width: `${(w / W) * 100}%`, height: `${(h / H) * 100}%` };
}

type Box = [number, number, number, number];

function Art({ src, children, class: cls }: { src: string; children: ComponentChildren; class: string }) {
  return (
    <div class={`scene-bg ${cls}`} aria-hidden="true">
      <div class="scene-art">
        <img class="bg-img" src={src} alt="" />
        <div class="bg-fx">{children}</div>
      </div>
      <div class="scene-dim" />
    </div>
  );
}

function Lamps({ list }: { list: [number, number][] }) {
  return (
    <>
      {list.map(([x, y], i) => (
        <i key={`l${i}`} class="lamp scene-lamp" style={{ ...at(x - 3, y - 3, 7, 7), animationDelay: `${(i * 0.45) % 2.6}s` }} />
      ))}
    </>
  );
}

function FlyBy({ y }: { y: number }) {
  return (
    <div class="flyby f1">
      <span style={at(0, y, 9, 4)}>
        <svg viewBox="0 0 9 4" shape-rendering="crispEdges">
          <rect x={0} y={0} width={3} height={1} fill="#D1D5DB" />
          <rect x={6} y={0} width={3} height={1} fill="#D1D5DB" />
          <rect x={2} y={1} width={5} height={2} fill="#E5E7EB" />
          <rect x={3} y={2} width={3} height={1} fill="#1B1B2F" />
          <rect x={4} y={3} width={1} height={1} class="mini-led" />
        </svg>
      </span>
    </div>
  );
}

// ---------- Market: floating market ----------

const MARKET_BOATS: Box[] = [
  [79, 48, 69, 37], // the big boat in the middle
  [56, 61, 28, 12],
  [147, 61, 27, 14],
  [166, 67, 34, 13],
];
const MARKET_LAMPS: [number, number][] = [
  [7, 35],
  [30, 42],
  [61, 37],
  [104, 44],
  [131, 37],
  [181, 41],
  [192, 30],
  [233, 35],
];
const MARKET_SIGNS: Box[] = [
  [69, 56, 8, 8],
  [102, 58, 8, 8],
  [120, 64, 8, 8],
  [149, 55, 8, 8],
  [178, 61, 9, 9],
];
const MARKET_DRONE_LEDS: [number, number][] = [
  [76, 12],
  [105, 18],
  [145, 7],
];

export function MarketBackdrop() {
  const src = '/assets/bg/bg-market.png';
  return (
    <Art src={src} class="market-bg">
      {/* Canal ripples: light bands drifting over the water. */}
      <i class="ripples" style={at(0, 74, 240, 46)} />
      {/* Boats bob: a clipped copy of the image moves 1 art pixel up and down. */}
      {MARKET_BOATS.map(([x, y, w, h], i) => (
        <span key={`b${i}`} class="boat" style={{ ...at(x, y, w, h), animationDelay: `${i * 0.55}s` }}>
          <img
            src={src}
            alt=""
            style={{ width: `${(W / w) * 100}%`, height: `${(H / h) * 100}%`, left: `${(-x / w) * 100}%`, top: `${(-y / h) * 100}%` }}
          />
        </span>
      ))}
      {MARKET_SIGNS.map((b, i) => (
        <i key={`s${i}`} class="holo scene-holo" style={{ ...at(...b), animationDelay: `${i * 0.7}s` }} />
      ))}
      <Lamps list={MARKET_LAMPS} />
      {MARKET_DRONE_LEDS.map(([x, y], i) => (
        <i key={`d${i}`} class="led" style={{ ...at(x, y, 1, 1), animationDelay: `${i * 0.4}s` }} />
      ))}
      <FlyBy y={22} />
    </Art>
  );
}

// ---------- Shop: village square ----------

const SHOP_LAMPS: [number, number][] = [
  [17, 56],
  [53, 60],
  [79, 52],
  [92, 64],
  [165, 64],
  [190, 60],
  [227, 59],
];
// String lights wound around the banyan tree.
const TREE_LIGHTS: [number, number][] = [
  [86, 16], [98, 21], [112, 24], [126, 22], [140, 18], [152, 12],
  [92, 34], [106, 38], [121, 40], [136, 37], [149, 31],
  [104, 47], [118, 50], [132, 48],
];

export function ShopBackdrop() {
  return (
    <Art src="/assets/bg/bg-shop.png" class="shop-bg">
      <i class="fall fountain" style={at(112, 50, 20, 18)} />
      <Lamps list={SHOP_LAMPS} />
      {TREE_LIGHTS.map(([x, y], i) => (
        <i key={`t${i}`} class="led tree-light" style={{ ...at(x, y, 1, 1), animationDelay: `${(i * 0.37) % 1.4}s` }} />
      ))}
      <i class="led" style={at(47, 18, 1, 1)} />
      <i class="led" style={{ ...at(195, 14, 1, 1), animationDelay: '0.5s' }} />
      <FlyBy y={8} />
    </Art>
  );
}
