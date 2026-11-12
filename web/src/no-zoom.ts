// The game page (/play) never zooms (2026-11-12, Ardian's iPhone test): a double tap or a pinch
// zoomed the garden / pond / duel and left an empty green strip at the side. The landing page and
// Privacy / Terms keep normal zoom (this file is only loaded by main.tsx, the /play entry).
// - viewport: maximum-scale=1, user-scalable=no (Android and most browsers);
// - CSS: touch-action: manipulation on the page (no double-tap zoom, scrolling still works);
// - iOS Safari ignores user-scalable=no: its gesture events are cancelled, and a second tap within
//   300 ms on the same spot does not zoom (preventDefault on that touchend, the tap's click still fires
//   from the first one).

export function installNoZoom(): void {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (meta) meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  document.documentElement.classList.add('no-zoom');
  const stop = (e: Event) => e.preventDefault();
  for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false });
  // Two fingers: no pinch zoom (scrolling with one finger is untouched).
  document.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches.length > 1) e.preventDefault();
    },
    { passive: false },
  );
  let last = 0;
  document.addEventListener(
    'touchend',
    (e) => {
      const now = Date.now();
      // A quick second tap that is not on a text field: no zoom.
      const t = e.target as HTMLElement | null;
      if (now - last < 300 && !t?.closest('input, textarea, select')) e.preventDefault();
      last = now;
    },
    { passive: false },
  );
  // If something zoomed anyway (an old iOS), snap back to the normal scale.
  window.visualViewport?.addEventListener('resize', () => {
    if ((window.visualViewport?.scale ?? 1) > 1.01 && meta) {
      meta.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
    }
  });
}
