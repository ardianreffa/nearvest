// Browser fullscreen (Fullscreen API): a small extra for laptops/PCs only. The
// app shows the button only on the wide (>= 1024px) layout and never on iPhone/iPad;
// phones keep the normal mobile layout.

import { useEffect, useState } from 'preact/hooks';

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

/** A phone: touch first and a small screen (also in landscape). */
export function isPhone(): boolean {
  return window.matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 600;
}

export function canFullscreen(): boolean {
  return !isIOS() && !isPhone() && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';
}

export function useFullscreen(): { supported: boolean; active: boolean; toggle: () => void } {
  const [active, setActive] = useState(() => document.fullscreenElement !== null);
  useEffect(() => {
    const on = () => setActive(document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  };
  return { supported: canFullscreen(), active, toggle };
}
