// Clickable places in the village backdrop (art pixels of the 240x135 image).
// Laptop (a mouse): hovering draws a thin line of light around the place and shows its name;
// a click opens it. Phone (touch): a tap shows a bubble with an "Open" button.
// Places that are not built yet (garden visits, the Arena) say "coming soon".
// They sit under the plots and TaniBot, so they never take a click meant for the garden.

import { useEffect, useState } from 'preact/hooks';
import { HoverCart } from './darto';
import { at } from './sky';

export type Place = 'shop' | 'market' | 'village';
type Spot = 'shop' | 'market' | 'village' | 'friends' | 'arena';

interface SpotInfo {
  box: [number, number, number, number];
  name: string;
  /** Opens this panel; null = coming soon. */
  open: Place | null;
  soon?: string;
}

const SPOTS: Record<Spot, SpotInfo> = {
  shop: { box: [28, 63, 26, 27], name: 'Village Shop', open: 'shop' },
  market: { box: [170, 68, 23, 21], name: "Mr. Darto's Market", open: 'market' },
  village: { box: [155, 11, 24, 40], name: 'Farm tower: Village Stats', open: 'village' },
  friends: { box: [196, 56, 42, 37], name: "A friend's garden", open: null, soon: 'Visit friends: coming soon' },
  arena: { box: [99, 51, 35, 18], name: 'Arena', open: null, soon: 'Arena: 1v1 duels for PANEN: coming soon' },
};

const canHover = () => typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;

export function Hotspots({ onPlace }: { onPlace: (p: Place) => void }) {
  const [bubble, setBubble] = useState<Spot | null>(null);

  // A bubble closes by itself after a while.
  useEffect(() => {
    if (!bubble) return;
    const t = setTimeout(() => setBubble(null), 5000);
    return () => clearTimeout(t);
  }, [bubble]);

  const tap = (id: Spot) => {
    const s = SPOTS[id];
    if (s.open && canHover()) {
      setBubble(null);
      onPlace(s.open);
    } else setBubble(bubble === id ? null : id);
  };

  const b = bubble ? SPOTS[bubble] : null;
  const [bx, by, bw, bh] = b?.box ?? [0, 0, 0, 0];
  const below = by < 30;
  return (
    <div class="hotspots">
      <span class="hs-cart" style={at(...SPOTS.market.box)} aria-hidden="true">
        <HoverCart scale={1} />
      </span>
      {(Object.keys(SPOTS) as Spot[]).map((id) => {
        const s = SPOTS[id];
        return (
          <button key={id} class={`hotspot hs-${id}${bubble === id ? ' active' : ''}`} style={at(...s.box)} onClick={() => tap(id)} aria-label={s.open ? `Open ${s.name}` : s.soon}>
            <span class="hs-label">{s.open ? s.name : s.soon}</span>
          </button>
        );
      })}
      {b && bubble && (
        <div
          class={`hs-bubble${below ? ' below' : ''}`}
          role="dialog"
          aria-label={b.name}
          style={{ left: `${((bx + bw / 2) / 240) * 100}%`, top: `${(((below ? by + bh : by) / 135) * 100).toFixed(2)}%` }}
        >
          <b>{b.open ? b.name : b.soon}</b>
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
