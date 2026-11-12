// Garden backdrop, in layers (back to front):
//   1. the sky, drawn in code (sky.tsx): pixel colour bands, sun, moon, clouds, birds, stars...
//   2. the village of Tandur (village.ts): AI images (ChatGPT, made at Ardian's request, see
//      docs/ASSETS.md) with the sky cut out, in day / dusk / night versions of the same drawing,
//      cross-faded from the village clock. v2 = the symmetric village (a wide image for laptops,
//      an upright one for phones); v1 = the first village (dev builds: ?bg=v1);
//   3. moving parts: the monorail train along its rail, the turbine rotors;
//   4. code effects: volcano smoke, waterfalls, lanterns, holograms, the Arena's mint ring,
//      passing delivery drones, fireflies; v2 also has Mr. Darto at his stand and a little robot;
//   5. hotspots with always-visible pins (hotspots.tsx): Shop, Market, Village Stats, Friends,
//      Arena, and (v3) Fishing (Soon; the fishing corner itself is art/fishing.tsx).
// All coordinates are game pixels of the village's grid (village.ts).

import { Drone } from './tanibot';
import { SlopeTrain, Train } from './train';
import { Hotspots, type Place } from './hotspots';
import { SkyBack, SkyBands, SkyFront } from './sky';
import { WeatherFx } from './weather';
import type { WeatherLook } from '../weather';
import { skyBands } from './sky-colors';
import { boxIn, V1, type Village } from './village';
import { VillageDarto, VillageRobot } from './village-life';
import { FishingProps } from './fishing';

export type Phase = 'dawn' | 'day' | 'dusk' | 'night';

/** 3x5 pixel letters for the Arena billboard. */
const GLYPHS: Record<string, string[]> = {
  '1': ['.#.', '##.', '.#.', '.#.', '###'],
  V: ['#.#', '#.#', '#.#', '#.#', '.#.'],
  S: ['###', '#..', '###', '..#', '###'],
};

/** "1 VS 1" in pixel letters on the Arena gazebo's empty screen, glowing softly (v3). */
export function Billboard({ style }: { style: Record<string, string> }) {
  const parts: [string, number][] = [
    ['1', 0],
    ['V', 6],
    ['S', 10],
    ['1', 16],
  ];
  const rects: preact.JSX.Element[] = [];
  for (const [ch, x0] of parts) {
    GLYPHS[ch].forEach((row, y) =>
      [...row].forEach((c, x) => {
        if (c === '#') rects.push(<rect key={`${x0}-${x}-${y}`} x={x0 + x + 1} y={y + 1} width={1} height={1} />);
      }),
    );
  }
  return (
    <span class="billboard" style={style} aria-hidden="true">
      <svg viewBox="0 0 21 7" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges">
        {rects}
      </svg>
    </span>
  );
}

export function hourOf(fractionOfDay: number): number {
  return (7 + fractionOfDay * 24) % 24;
}

/** Phase of the village day. The game day starts at 07:00 WIB. */
export function phaseOf(fractionOfDay: number): Phase {
  const hour = hourOf(fractionOfDay);
  if (hour < 5) return 'night';
  if (hour < 7) return 'dawn';
  if (hour < 16.5) return 'day';
  if (hour < 19) return 'dusk';
  return 'night';
}

/**
 * How much of the dusk and night villages show (0..1, stacked: day, dusk, night) and the warm tint.
 * Day -> dusk 16:00-17:00, dusk -> night 18:30-19:30; at dawn night -> dusk 05:00-06:00 and
 * dusk -> day 06:00-07:00 (the warm village is the sunrise too).
 */
export function skyMix(fractionOfDay: number): { night: number; dusk: number; tint: number } {
  const hour = hourOf(fractionOfDay);
  const ramp = (from: number, to: number) => Math.min(1, Math.max(0, (hour - from) / (to - from)));
  if (hour >= 5 && hour < 7) return { night: 1 - ramp(5, 6), dusk: 1 - ramp(6, 7), tint: 0 };
  if (hour >= 16 && hour < 19.5) return { night: ramp(18.5, 19.5), dusk: ramp(16, 17), tint: 0 };
  return { night: hour >= 7 && hour < 16 ? 0 : 1, dusk: 0, tint: 0 };
}

/** Village fractions for ?time=day / dusk / night (dev builds: lock the clock for screenshots and video). */
export const TIME_LOCK: Record<string, number> = {
  day: (12 - 7) / 24,
  dusk: (17.75 - 7) / 24,
  night: (23 - 7) / 24,
};

/** ?time=day / dusk / night, or a village hour such as ?time=16.5 (mid fade from day to dusk). */
export function lockedFraction(search: string): number | null {
  const t = new URLSearchParams(search).get('time');
  if (!t) return null;
  if (t in TIME_LOCK) return TIME_LOCK[t];
  const hour = Number(t);
  return Number.isFinite(hour) && hour >= 0 && hour < 24 ? ((hour - 7 + 24) % 24) / 24 : null;
}

/**
 * `hd` uses the twice-as-detailed images (laptops, and every v2 village); v1 phones use the
 * 240x135 ones. `onPlace` opens a panel from a hotspot. `skyTop` (phones): the game row at the
 * top of the visible scene, where the sky's sun, moon and clouds are drawn.
 */
export function Backdrop({
  fraction,
  blurFill = false,
  hd = false,
  onPlace,
  account,
  village = V1,
  skyTop,
  groundBelow = false,
  groundWide = false,
  weather = 'clear',
  phone = false,
  friends = false,
  friendsDot = false,
  arena = false,
  fishing = false,
}: {
  fraction: number;
  blurFill?: boolean;
  hd?: boolean;
  onPlace?: (p: Place) => void;
  /** The Friends pin opens the farmer list (garden visits are live on this server). */
  friends?: boolean;
  /** A red dot on the Friends pin: a new wave back (dots.ts). */
  friendsDot?: boolean;
  /** The Arena is live (state.arena): its pin opens the Arena instead of "Soon". */
  arena?: boolean;
  /** Fishing is live (state.fishing): its pin opens the fishing window instead of "Soon". */
  fishing?: boolean;
  account?: string;
  village?: Village;
  skyTop?: number;
  /**
   * Phones: the village's bottom bushes continue below the art (under the plot sheet and the tabs),
   * mirrored strip by strip so every seam matches.
   */
  groundBelow?: boolean;
  /** Laptops: a lawn of the art's own grass rows fills everything beside and below the art. */
  groundWide?: boolean;
  /** The village weather to draw (the landing page always passes nothing: a clear day). */
  weather?: WeatherLook;
  /** Phones: fewer weather particles. */
  phone?: boolean;
}) {
  const v = village;
  const v2 = v.key !== 'v1';
  const at = (x: number, y: number, w: number, h: number) => boxIn(v, x, y, w, h);
  const src = (light: 'day' | 'dusk' | 'night') => v.src(light, hd);
  const rotorSrc = hd || v2 ? '/assets/bg/rotor-hd.png' : '/assets/bg/rotor.png';
  const hour = hourOf(fraction);
  const { night, dusk, tint } = skyMix(fraction);
  const vars = {
    '--night': night.toFixed(3),
    '--dusk': dusk.toFixed(3),
    '--day': ((1 - dusk) * (1 - night)).toFixed(3),
    '--tint': tint.toFixed(3),
  };
  // The 240x135 sky (sun, moon, clouds, birds, stars) keeps its shape: on the upright phone
  // village it is drawn in a box from the top of the visible scene.
  const skyH = (v.w * 135) / 240;
  const skyBox = v.h > v.w ? at(0, skyTop ?? v.h - skyH * 1.6, v.w, skyH) : at(0, 0, v.w, v.h);

  return (
    <div class={`backdrop village-${v.key} wx-look-${weather}`} style={vars} aria-hidden={onPlace ? undefined : 'true'}>
      {/* v2: the sky's colour bands fill the whole scene, so the art (whose sky is transparent) never shows a seam. */}
      {v2 && <SkyBands hour={hour} />}
      {blurFill && (
        // Full-window layout: whatever the sharp art does not cover shows a blurred copy of it.
        // Villages with a see-through sky (v2, v3): the blurred copy only shows below the art's sky
        // (`skyBottom`), fading in over 6 rows of solid art, so it never appears behind the sky.
        <div class={`bg-blur${v.skyBottom !== undefined ? ' below-sky' : ''}`} style={v.skyBottom !== undefined ? { '--ground-rows': String(v.h - v.skyBottom) } : undefined}>
          {!v2 && <SkyBands hour={hour} />}
          <img src={src('day')} alt="" />
          <img class="bg-img-dusk" src={src('dusk')} alt="" />
          <img class="bg-img-night" src={src('night')} alt="" />
        </div>
      )}
      {/* Laptops: a lawn behind the art, filling everything left / right / below it from the
          village's grass row down: the art's own bottom rows (only grass and bushes, no
          buildings) repeated sideways, upright, in strips stacked downwards. */}
      {groundWide && (
        <div
          class="bg-lawn"
          style={{ '--art-w': String(v.w), '--art-h': String(v.h), '--lawn-row': String(v.lawnRow ?? v.h - 30), '--bush-row': String(v.bushRow ?? v.h - 15) }}
        >
          {(['day', 'dusk', 'night'] as const).map((light) => (
            <div key={light} class={`ground-layer ground-${light}`}>
              {/* First strip: grass + bushes, level with the art. Below the art: bushes only. */}
              {Array.from({ length: 10 }, (_, i) => (
                <i key={i} class={i === 0 ? undefined : 'bush'} style={{ backgroundImage: `url(${src(light)})` }} />
              ))}
            </div>
          ))}
          <div class="ground-shade" />
        </div>
      )}
      {/* v1 phones: above the art, the top band of the sky. */}
      {!v2 && <div class="bg-sky-fill" style={{ background: skyBands(hour)[0] }} />}

      <div class="bg-art" style={{ aspectRatio: `${v.w} / ${v.h}`, '--art-w': String(v.w) }}>
        <div class="sky-box" style={skyBox}>
          <SkyBack hour={hour} bands={!v2} />
        </div>
        <img class="bg-img" src={src('day')} alt="" />
        <img class="bg-img bg-img-dusk" src={src('dusk')} alt="" />
        <img class="bg-img bg-img-night" src={src('night')} alt="" />

        <div class="bg-fx">
          {v.rotors.map((r, i) => (
            <span key={i} class="rotor" style={{ ...at(r.x - r.size / 2, r.y - r.size / 2, r.size, r.size), animationDuration: `${r.speed}s` }}>
              <img src={rotorSrc} alt="" />
            </span>
          ))}
          {v.rail && (
            <div class="train-clip" style={at(v.rail.clip.x, v.rail.clip.y, v.rail.clip.w, v.rail.clip.h)}>
              {v.rail.sprite === 'slope' ? <SlopeTrain rail={v.rail} /> : <Train hd={hd} rail={v.rail} />}
            </div>
          )}
          {v.smoke.map((s, i) => (
            <i key={i} class={`puff${s.small ? ' small' : ''}`} style={{ ...at(s.x, s.y, s.small ? 2 : 4, s.small ? 2 : 4), animationDelay: `${s.d}s` }} />
          ))}
          {v.falls.map(([x, y, w, h], i) => (
            <i key={i} class="fall" style={{ ...at(x, y, w, h), animationDelay: `${i * 0.15}s` }} />
          ))}
          {v.holograms.map(([x, y, w, h], i) => (
            <i key={i} class={`holo${v.softHolograms ? ' soft' : ''}`} style={{ ...at(x, y, w, h), animationDelay: `${i * 1.7}s` }} />
          ))}
          {v.billboard && <Billboard style={at(...v.billboard)} />}
          {v.fishing && <FishingProps v={v} f={v.fishing} />}
          {v.lanterns.map(([x, y, w, h], i) => (
            <i key={i} class="lamp" style={{ ...at(x - 2, y - 2, w + 4, h + 4), animationDelay: `${i * 0.7}s` }} />
          ))}
          {v.arenaRing && <i class="arena-ring" style={at(...v.arenaRing)} />}
          <VillageDarto v={v} />
          <VillageRobot v={v} />
          {/* Quadcopters crossing the sky, each with a small shadow sliding over the fields. */}
          {v.flyby.map(([sky, field], i) => (
            <div key={i} class={`flyby f${i + 1}`}>
              <span style={at(0, sky, 10, 5)}>
                <Drone scale={1} class="mini" />
              </span>
              <i class="flyby-shadow" style={at(2, field, 6, 1.5)} />
            </div>
          ))}
        </div>
        <div class="sky-box" style={skyBox}>
          <SkyFront />
        </div>
        <div class="bg-night-shade" />
        {/* The weather: over the village AND past it on every side (the sky above the art on a
            laptop window, the lawn below), under the place pins (and the plots, TaniBot and HUD). */}
        <WeatherFx look={weather} v={v} phone={phone} />
        {onPlace && <Hotspots onPlace={onPlace} account={account} village={v} friends={friends} friendsDot={friendsDot} arena={arena} fishing={fishing} />}
      </div>
      {/* The plain ground colour below the art: only where there is no lawn (laptops have one). */}
      {blurFill && !groundWide && <div class="bg-soil-ext" style={{ background: v.groundExt }} />}
      {groundBelow && !groundWide && (
        <div class="bg-ground-below" style={{ '--art-w': String(v.w), '--art-h': String(v.h) }}>
          {(['day', 'dusk', 'night'] as const).map((light) => (
            <div key={light} class={`ground-layer ground-${light}`}>
              {Array.from({ length: 8 }, (_, i) => (
                <i key={i} class={i % 2 === 0 ? 'flip' : undefined} style={{ backgroundImage: `url(${src(light)})` }} />
              ))}
            </div>
          ))}
          <div class="ground-shade" />
        </div>
      )}

      <div class="bg-tint" />
    </div>
  );
}
