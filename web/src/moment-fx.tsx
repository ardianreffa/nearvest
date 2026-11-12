// The big moments' own animation and sound (BACKLOG item 5), played just before the share popup
// (share.tsx opens it POPUP_AFTER_FX_MS after the animation ends). Pixel shapes and palette tokens
// only, CSS transform / opacity animations (styles.css "Moment animations"), never taking a click.
//   first harvest   basket pops up, fruits bounce in                     cheerful 8-bit jingle
//   first Gold tree the Gold tree (its species) gilded, a golden shine + sparkles   steel-drum chime
//   Rare durian     a durian drops with a heavy bounce, dust puff         heavy punch
//   Golden Arowana  the fish leaps in an arc, golden shine + sparkles      steel-drum chime
//   new title       banner rises with the title + confetti               level-up
//   TaniBot evolved scan-line glow sweeps down + banner                  robot beeps
//   7-day streak    calendar page flips to 7 + coin rain                 coins
//   Legend          pixel fireworks + banner                             8-bit victory fanfare (C major, up an octave)
//   eruption        (the weather is already on screen) banner            level-up
// With prefers-reduced-motion nothing moves: a still banner for a moment, the sound stays.

import { useEffect, useState } from 'preact/hooks';
import { playSound, type SoundName } from './audio';
import { confetti } from './fx';
import type { Moment, MomentKind } from './moments';
import { Sprite } from './sprites';
import { TreePixels } from './art/trees';
import { CatchIcon } from './art/catch-icons';

/** How long each moment's animation runs (ms); the popup waits for it. */
export const MOMENT_FX_MS: Record<MomentKind, number> = {
  first_harvest: 1600,
  first_gold: 1600,
  big_durian: 1400,
  golden_arowana: 1800,
  title: 1800,
  evolved: 1800,
  streak7: 1800,
  legend: 2200,
  eruption: 1200,
  profile: 0,
};

const SOUND: Record<MomentKind, SoundName | null> = {
  first_harvest: 'momentHarvest',
  first_gold: 'momentGold',
  big_durian: 'momentDurian',
  golden_arowana: 'momentGold',
  title: 'levelup',
  evolved: 'momentEvolve',
  streak7: 'coins',
  legend: 'momentLegend',
  eruption: 'levelup',
  profile: null,
};

/** Banner text per moment (the share card's own words come later in the popup). */
function banner(m: Moment): { top: string; main: string } | null {
  switch (m.kind) {
    case 'title':
      return { top: 'New title', main: m.title ?? '' };
    case 'evolved':
      return { top: 'TaniBot evolved', main: m.title ?? '' };
    case 'legend':
      return { top: 'You are a', main: 'Legend' };
    case 'eruption':
      return { top: 'You survived', main: 'the eruption' };
    case 'golden_arowana':
      return { top: 'You caught the', main: 'Golden Arowana' };
    case 'streak7':
      return { top: 'Check-in', main: '7 days in a row' };
    default:
      return null;
  }
}

const REDUCED_MS = 900;
const reduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface Playing {
  id: number;
  m: Moment;
  still: boolean;
}

let nextId = 1;
const listeners = new Set<(p: Playing | null) => void>();

/**
 * Plays a moment's animation and sound; returns how long it runs (ms). One at a time: a new one
 * replaces the one on screen.
 */
export function playMomentFx(m: Moment): number {
  const still = reduced();
  const ms = MOMENT_FX_MS[m.kind];
  if (ms === 0) return 0;
  const sound = SOUND[m.kind];
  if (sound) playSound(sound);
  if (!still && (m.kind === 'title' || m.kind === 'legend')) confetti(m.kind === 'legend' ? 72 : 48);
  const p: Playing = { id: nextId++, m, still };
  for (const l of listeners) l(p);
  const runs = still ? REDUCED_MS : ms;
  window.setTimeout(() => {
    for (const l of listeners) l(null);
  }, runs);
  return runs;
}

const SPARKLES = [
  [18, 30],
  [72, 22],
  [44, 14],
  [84, 58],
  [12, 66],
  [58, 72],
  [30, 48],
  [66, 40],
];
const COINS = Array.from({ length: 14 }, (_, i) => ({ left: (i * 61.8 + 7) % 100, delay: (i * 97) % 700 }));
const BURSTS = [
  { x: 24, y: 28, delay: 0, tone: 'gold' },
  { x: 72, y: 22, delay: 350, tone: 'mint' },
  { x: 50, y: 40, delay: 700, tone: 'cyan' },
  { x: 82, y: 50, delay: 1050, tone: 'purple' },
  { x: 16, y: 54, delay: 1300, tone: 'gold' },
];
const RAYS = 12;

/** The moment animations, above the garden and under every window. */
export function MomentFxLayer() {
  const [p, setP] = useState<Playing | null>(null);
  useEffect(() => {
    listeners.add(setP);
    return () => void listeners.delete(setP);
  }, []);
  if (!p) return null;
  const { m, still } = p;
  const b = banner(m);
  return (
    <div key={p.id} class={`mfx mfx-${m.kind}${still ? ' still' : ''}`} aria-hidden="true">
      {(m.kind === 'first_gold' || m.kind === 'golden_arowana') && !still && <i class="mfx-shine" />}
      {m.kind === 'evolved' && !still && <i class="mfx-scan" />}
      {(m.kind === 'first_gold' || m.kind === 'evolved' || m.kind === 'golden_arowana') &&
        !still &&
        SPARKLES.map(([x, y], i) => (
          <span key={i} class="mfx-sparkle" style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${300 + i * 110}ms` }}>
            <Sprite name="sparkle" scale={3} />
          </span>
        ))}
      {m.kind === 'first_harvest' && (
        <div class="mfx-center mfx-basket">
          {!still &&
            [0, 1, 2].map((i) => (
              <span key={i} class="mfx-fruit" style={{ '--x': `${(i - 1) * 34}px`, animationDelay: `${450 + i * 180}ms` }}>
                <Sprite name={m.species ?? 'mango'} scale={3} />
              </span>
            ))}
          <span class="mfx-basket-body">
            <i />
          </span>
        </div>
      )}
      {m.kind === 'first_gold' && (
        <div class="mfx-center mfx-goldtree">
          {/* The player's Gold tree itself (its species, with fruit), gilded. */}
          <span class="mfx-gilded">
            <TreePixels species={m.species ?? 'mango'} stage="fruiting" quality="gold" scale={4} seed={1} />
          </span>
        </div>
      )}
      {m.kind === 'golden_arowana' && (
        <div class="mfx-center mfx-arowana">
          <span class="mfx-leap">
            <CatchIcon id="golden_arowana" scale={6} />
          </span>
        </div>
      )}
      {m.kind === 'big_durian' && (
        <div class="mfx-center mfx-durian">
          <span class="mfx-drop">
            <Sprite name="durian" scale={7} />
          </span>
          {!still && (
            <span class="mfx-dust">
              {[-3, -2, -1, 1, 2, 3].map((d) => (
                <i key={d} style={{ '--d': d }} />
              ))}
            </span>
          )}
        </div>
      )}
      {m.kind === 'streak7' && (
        <>
          <div class="mfx-center mfx-calendar">
            <span class="mfx-page">
              <b>7</b>
            </span>
          </div>
          {!still &&
            COINS.map((c, i) => (
              <span key={i} class="mfx-coin" style={{ left: `${c.left}%`, animationDelay: `${300 + c.delay}ms` }}>
                <Sprite name="coin" scale={3} />
              </span>
            ))}
        </>
      )}
      {m.kind === 'legend' &&
        !still &&
        BURSTS.map((f, i) => (
          <span key={i} class={`mfx-burst tone-${f.tone}`} style={{ left: `${f.x}%`, top: `${f.y}%`, '--delay': `${f.delay}ms` }}>
            {Array.from({ length: RAYS }, (_, r) => (
              <i key={r} style={{ '--a': `${(360 / RAYS) * r}deg` }} />
            ))}
          </span>
        ))}
      {b && (
        <div class="mfx-banner">
          <span class="mfx-banner-top">{b.top}</span>
          <span class="mfx-banner-main">{b.main}</span>
        </div>
      )}
    </div>
  );
}
