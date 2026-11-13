// The sign-in page's background (Ardian 2026-11-12): the Fishing pond instead of the village, without
// TaniBot fishing and without the Fishing panel. Laptops: the 16:9 pond covering the screen; upright
// phones: the phone pond across the width with its own ground below (pond_ground.py). It follows the
// village clock (before sign-in = the WIB clock: the village day starts at 07:00 WIB and lasts 24
// hours; dev builds: ?time=day|dusk|night|<hour>) with the pond's calm cross-fades, and keeps its
// light life (waterfall, ducks, frogs, leaves, fireflies at night). GPU-friendly like the Fishing
// window after package 7c: the pictures are screen-sized canvases, no blur filters. Reduced motion:
// still (pond CSS).

import { useEffect, useState } from 'preact/hooks';
import { lockedFraction, hourOf } from './art/backdrop';
import { PondScene } from './art/pond';
import { layoutFor } from './art/pond-layouts';
import { PondPictures } from './art/pond-pictures';
import { pondMix, pondSounds, pondTime } from './pond-life-plan';
import { LOGIN_POND_LEVEL, setPondAmbience } from './audio';

/** The village hour before sign-in: the WIB clock (dev builds may lock it with ?time=). */
export function loginHour(now = Date.now(), search = typeof location === 'undefined' ? '' : location.search): number {
  const locked = import.meta.env?.DEV ? lockedFraction(search) : null;
  if (locked !== null) return hourOf(locked);
  return (((now / 3_600_000 + 7) % 24) + 24) % 24;
}

/** Where the pond goes: phones = across the width from the top; laptops = covering the screen. */
export function loginPondFit(W: number, H: number, phone: boolean, gw: number, gh: number): { left: number; top: number; w: number; h: number } {
  if (phone) return { left: 0, top: 0, w: W, h: (gh * W) / gw };
  const k = Math.max(W / gw, H / gh);
  return { left: (W - gw * k) / 2, top: (H - gh * k) / 2, w: gw * k, h: gh * k };
}

export function LoginPond() {
  const [size, setSize] = useState(() => [window.innerWidth, window.innerHeight]);
  const [hour, setHour] = useState(() => loginHour());
  useEffect(() => {
    const onResize = () => setSize([window.innerWidth, window.innerHeight]);
    window.addEventListener('resize', onResize);
    const id = window.setInterval(() => setHour(loginHour()), 30_000);
    return () => {
      window.removeEventListener('resize', onResize);
      window.clearInterval(id);
    };
  }, []);
  const [W, H] = size;
  const L = layoutFor(W, H);
  const phone = L.key === 'phone';
  const fit = loginPondFit(W, H, phone, L.w, L.h);
  const mix = pondMix(hour);
  const time = pondTime(hour);
  // The pond's sounds as a soft background (Sound switch; after the first tap, like every sound).
  useEffect(() => {
    setPondAmbience(pondSounds(time, 'clear'), LOGIN_POND_LEVEL);
  }, [time]);
  useEffect(() => () => setPondAmbience(null), []);
  return (
    <div class={`login-pond pond-time-${time}`} aria-hidden="true">
      <PondPictures L={L} fit={fit} mix={mix} />
      {/* Phones: the picture's own ground below it, drawn over its last rows (its wavy seam). */}
      {phone &&
        L.ground &&
        (['day', 'dusk', 'night'] as const).map((t) => (
          <img
            key={t}
            class="pond-ground pond-fade"
            src={L.ground!.pics[t]}
            style={{
              left: '0px',
              top: `${fit.h - L.ground!.over * (fit.w / 480)}px`,
              width: `${fit.w}px`,
              height: `${L.ground!.h * (fit.w / 480)}px`,
              opacity: t === 'day' ? 1 : t === 'dusk' ? mix.dusk : mix.night,
              visibility: t === 'day' || (t === 'dusk' ? mix.dusk : mix.night) > 0 ? 'visible' : 'hidden',
            }}
            alt=""
            draggable={false}
          />
        ))}
      <div class="pond-stage" style={{ left: `${fit.left}px`, top: `${fit.top}px`, width: `${fit.w}px`, height: `${fit.h}px` }}>
        <PondScene phase="ready" time={time} weather="clear" mix={mix} layout={L} rain={false} pictures={false} angler={false} />
      </div>
      {/* A soft ink shade at the top (the title) and the bottom (the note), so the text reads well. */}
      <div class="login-pond-shade" />
    </div>
  );
}
