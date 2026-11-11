// The village weather on the garden backdrop (art/backdrop.tsx draws it inside the art, under the
// place pins, the plots, TaniBot and the HUD). Pixel style, palette colours only:
//   rain     grey sky tint, two layers of thin slanted pixel drops falling (far + near), the sun,
//            moon and stars dimmed, darker clouds, the passing drones fade out
//   drought  a warm gold haze over the sky
//   warning  thick smoke from Mount Tandur's crater, a small shake now and then
//   eruption red sky, lava glow at the crater, ash falling, a small shake
//   volcanic a faint warm glow over the fields (Volcanic soil)
// One layer covers the WHOLE screen, not only the village art: on a laptop window the art does not
// reach the top edge (the code sky shows above it) or the bottom (the lawn), so the layer reaches
// past the art on every side (.bg-art > .wx in styles.css). The tint follows the art (darkest at
// its sky) and continues above / below it in its own top / bottom colour, so there is no seam.
// Rain and ash are not single elements: each is one tiled CSS mask (palette colour) that slides
// down and a little to the left by exactly whole tiles, so it loops without a seam and only moves
// on the GPU (cheap on phones). With prefers-reduced-motion nothing moves or shakes: the tints,
// the drops and the ash stay, still (CSS).

import type { WeatherLook } from '../weather';
import { boxIn, type Village } from './village';

export function WeatherFx({ look, v }: { look: WeatherLook; v: Village; phone?: boolean }) {
  if (look === 'clear') return null;
  // The crater: the first big smoke puff (the phone village only has small ones: take the first).
  const crater = v.smoke.find((s) => !s.small) ?? v.smoke[0];
  const volcano = look === 'warning' || look === 'eruption';
  return (
    <div class={`wx wx-${look}`} aria-hidden="true">
      {/* Exactly over the art: the tint (it continues above, below and beside the art) and the
          crater's smoke and lava, placed in art pixels. */}
      <div class="wx-art">
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
      </div>
      {look === 'rain' && (
        <>
          <i class="wx-rain-layer far" />
          <i class="wx-rain-layer near" />
        </>
      )}
      {look === 'eruption' && <i class="wx-ash-layer" />}
    </div>
  );
}
