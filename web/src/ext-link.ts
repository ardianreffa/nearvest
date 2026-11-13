// Links to the block explorer (nearblocks: "view tx", "View on nearblocks", NFT and account links).
//
// iPhone / iPad Safari (also Private tabs) still blocked these as pop-ups after the 2026-11-12 fix
// (plain <a target="_blank"> tapped directly). Likely causes, both inside the same tap and before the
// link's own action: audio.ts listens to every click / touchend in the capture phase and calls
// music.play() / AudioContext.resume() there (WebKit can spend the tap's "user gesture" on that), and
// no-zoom.ts cancels a quick second touchend (iOS then drops the click). So on iPhone / iPad an
// explorer link never asks for a new tab at all: it opens in the SAME tab, and Back returns to the game
// (the session is a token in localStorage, so the player is still signed in). Laptops and Android keep
// a new tab.
//
// Two layers, so no link can slip through:
// - render: `<a href={url} {...explorerTarget()}>` gives no target on iOS;
// - tap: installSameTabLinks() removes a target="_blank" from any explorer link before the browser
//   acts on it (pointerdown / touchstart / click, capture phase), e.g. a link drawn by older code.

import { isIOS } from './popup-rescue.ts';

/** True for a block explorer address (testnet.nearblocks.io and friends). */
export function isExplorerUrl(href: string | null | undefined): boolean {
  if (!href) return false;
  try {
    const u = new URL(href, 'https://x.invalid');
    return /^https?:$/.test(u.protocol) && /(^|\.)nearblocks\.io$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** Props for an explorer link: a new tab on laptops / Android, the same tab on iPhone / iPad. */
export function explorerTarget(ios = isIOS()): { target?: '_blank'; rel?: 'noopener' } {
  return ios ? {} : { target: '_blank', rel: 'noopener' };
}

let installed = false;

/** iPhone / iPad only: explorer links never open a new tab (see the note at the top). */
export function installSameTabLinks(ios = isIOS()): void {
  if (installed || !ios || typeof document === 'undefined') return;
  installed = true;
  const fix = (e: Event) => {
    const el = e.target as Element | null;
    const a = el && typeof el.closest === 'function' ? (el.closest('a[href]') as HTMLAnchorElement | null) : null;
    if (a && a.hasAttribute('target') && isExplorerUrl(a.getAttribute('href'))) a.removeAttribute('target');
  };
  for (const ev of ['pointerdown', 'touchstart', 'click'] as const) document.addEventListener(ev, fix, { capture: true, passive: true });
}
