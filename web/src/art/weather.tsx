// The village weather on the garden backdrop (art/backdrop.tsx draws it inside the art, under the
// place pins, the plots, TaniBot and the HUD). Pixel style, palette colours only:
//   rain     grey sky tint, pixel rain streaks, the sun dimmed
//   drought  a warm gold haze over the sky
//   warning  thick smoke from Mount Tandur's crater, a small shake now and then
//   eruption red sky, lava glow at the crater, ash falling, a small shake
//   volcanic a faint warm glow over the fields (Volcanic soil)
// Particles are few (phones fewer) and placed with a fixed pattern (no random per frame). With
// prefers-reduced-motion nothing moves or shakes: only the still tints stay (CSS).

import type { WeatherLook } from '../weather';
import { boxIn, type Village } from './village';

const RAIN = { phone: 26, wide: 48 };
const ASH = { phone: 16, wide: 30 };

/** Spread `n` particles evenly but not in lines (golden-ratio steps). */
function spots(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    left: ((i * 61.8) % 100).toFixed(1),
    delay: ((i * 0.37) % 1.6).toFixed(2),
    speed: (0.7 + ((i * 7) % 5) * 0.08).toFixed(2),
  }));
}

export function WeatherFx({ look, v, phone }: { look: WeatherLook; v: Village; phone: boolean }) {
  if (look === 'clear') return null;
  // The crater: the first big smoke puff (the phone village only has small ones: take the first).
  const crater = v.smoke.find((s) => !s.small) ?? v.smoke[0];
  const volcano = look === 'warning' || look === 'eruption';
  const n = look === 'rain' ? (phone ? RAIN.phone : RAIN.wide) : look === 'eruption' ? (phone ? ASH.phone : ASH.wide) : 0;
  return (
    <div class={`wx wx-${look}`} aria-hidden="true">
      <div class="wx-tint" />
      {volcano && crater && (
        <>
          {look === 'eruption' && <i class="wx-lava" style={boxIn(v, crater.x - 6, crater.y - 3, 12, 8)} />}
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <i
              key={i}
              class="wx-smoke"
              style={{ ...boxIn(v, crater.x - 3 + (i % 3) * 2, crater.y - 2, 5, 5), animationDelay: `${(i * 0.7).toFixed(1)}s` }}
            />
          ))}
        </>
      )}
      {n > 0 && (
        <div class={`wx-particles ${look === 'rain' ? 'rain' : 'ash'}`}>
          {spots(n).map((s, i) => (
            <i key={i} style={{ left: `${s.left}%`, animationDelay: `-${s.delay}s`, animationDuration: `${look === 'rain' ? s.speed : (Number(s.speed) * 4).toFixed(2)}s` }} />
          ))}
        </div>
      )}
    </div>
  );
}
