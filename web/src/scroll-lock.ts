// While any window or popup is open (share card, info popup, Judge tour, TaniBot, a confirm,
// the Arena, the fishing pond ...), the page behind it must not scroll: on Android Chrome and
// iOS Safari a swipe on the dark backdrop moved the page under the window.
//
// One watcher for the whole game instead of a hook in every window: every window is a
// `.dialog-backdrop` (or the full-screen `.pond-screen`), so the page is locked while at least
// one of them is in the document and unlocked when the last one is gone.
//
// The lock pins the body in place (`position: fixed` at minus the scroll position). That is the
// only way that holds on iOS Safari, where `overflow: hidden` alone does not stop the page.
// Closing the last window puts the page back at exactly the same scroll position.

/** Every window and popup of the game. */
export const WINDOW_SELECTOR = '.dialog-backdrop, .pond-screen';

/** The few things the lock needs from the page (the real window, or a fake one in tests). */
export interface LockPage {
  scrollY(): number;
  scrollTo(y: number): void;
  /** The body's inline style. */
  body: { position: string; top: string; left: string; right: string; width: string };
  /** Adds or removes `window-open` on <html>. */
  mark(on: boolean): void;
  /** The page is already one fixed screen (phones, Garden tab: `page-locked`). */
  fixedScreen(): boolean;
}

export interface ScrollLock {
  /** Call with "is any window open now?"; locks on the first one, unlocks after the last. */
  sync(open: boolean): void;
  locked(): boolean;
}

export function createScrollLock(page: LockPage): ScrollLock {
  let savedY: number | null = null;
  let before: LockPage['body'] | null = null;
  return {
    locked: () => savedY !== null,
    sync(open) {
      if (open && savedY === null) {
        savedY = page.scrollY();
        const b = page.body;
        before = { position: b.position, top: b.top, left: b.left, right: b.right, width: b.width };
        b.position = 'fixed';
        b.top = `${-savedY}px`;
        b.left = '0';
        b.right = '0';
        b.width = '100%';
        page.mark(true);
      } else if (!open && savedY !== null) {
        const y = savedY;
        savedY = null;
        Object.assign(page.body, before);
        before = null;
        page.mark(false);
        // A page that became one fixed screen meanwhile (another tab was opened from the window)
        // starts at its top; everywhere else: back to where the player was.
        if (!page.fixedScreen()) page.scrollTo(y);
      }
    },
  };
}

/** Starts the watcher (once, from main.tsx). */
export function installScrollLock(): void {
  if (typeof document === 'undefined' || typeof MutationObserver !== 'function') return;
  const html = document.documentElement;
  const lock = createScrollLock({
    scrollY: () => window.scrollY,
    scrollTo: (y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' }),
    body: document.body.style,
    mark: (on) => html.classList.toggle('window-open', on),
    fixedScreen: () => html.classList.contains('page-locked'),
  });
  let queued = false;
  const check = () => {
    queued = false;
    lock.sync(document.querySelector(WINDOW_SELECTOR) !== null);
  };
  // Windows are added and removed as elements; many changes in one frame = one check.
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(check);
  }).observe(document.body, { childList: true, subtree: true });
  check();
}
