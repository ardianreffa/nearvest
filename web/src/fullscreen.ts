// Fullscreen (Fullscreen API) for laptops/PCs and Android. iPhone and iPad do not
// support it for web pages, so the button is hidden there and nothing changes.

import { useEffect, useState } from 'preact/hooks';

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPadOS reports itself as a Mac; a Mac with a touch screen is an iPad.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function canFullscreen(): boolean {
  return !isIOS() && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';
}

export function useFullscreen(): { supported: boolean; active: boolean; toggle: () => void } {
  // Dev only: ?fs=1 shows the fullscreen layout (headless test browsers cannot enter fullscreen).
  const forced = import.meta.env.DEV && new URLSearchParams(location.search).has('fs');
  const [active, setActive] = useState(() => forced || document.fullscreenElement !== null);
  useEffect(() => {
    const on = () => setActive(forced || document.fullscreenElement !== null);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggle = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => undefined);
  };
  return { supported: canFullscreen(), active, toggle };
}
