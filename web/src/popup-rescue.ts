// Safari on iPhone (with "Block Pop-ups" on, the default) only opens a new window or a wallet app
// when it happens right inside the player's tap. near-connect runs each wallet in a sandboxed
// iframe: the tap ("Meteor Web" / "Meteor Mobile") happens in that iframe, which then asks this
// page by postMessage to open the window, so Safari sees no tap and blocks it silently; app deep
// links go through a hidden iframe, which iOS ignores.
//
// Google's sign-in button works the same way (its iframe asks the page to open the Google window),
// so the same rescue shows "Continue to Google" there.
//
// This module rescues both without changing near-connect or Google's script:
// - window.open returning null (blocked): near-connect gets a stand-in window at once, and the
//   page shows "Continue to <wallet>". That tap opens the real window (allowed: it is a tap on
//   this page) and the stand-in passes everything on to it (closed, focus, postMessage, close).
// - a hidden iframe with an app link (e.g. meteorwallet://...) on iOS: the page shows
//   "Open <wallet> app", whose tap opens the link directly.
// Cancel closes the stand-in, so the wallet sign-in ends with the usual "cancelled" message.

const ALLOWED_SCHEMES = ['http:', 'https:', 'about:', 'blob:', 'data:', 'javascript:', 'file:'];

let installed = false;

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** A readable wallet name from a URL ("Meteor" for wallet.meteorwallet.app or meteorwallet://). */
function walletName(href: string): string {
  try {
    const u = new URL(href);
    // Web wallets: the host name; app links: the scheme (meteorwallet://b?... -> "meteorwallet").
    const where = (/^https?:$/.test(u.protocol) ? u.hostname : u.protocol.replace(':', '')).toLowerCase();
    if (where.includes('google')) return 'Google';
    if (where.includes('meteor')) return 'Meteor';
    if (where.includes('intear')) return 'Intear';
    if (where.includes('nightly')) return 'Nightly';
    if (where.includes('hot')) return 'HOT';
    return /^https?:$/.test(u.protocol) ? u.hostname : 'the wallet';
  } catch {
    return 'the wallet';
  }
}

function isAppLink(href: string): boolean {
  try {
    return !ALLOWED_SCHEMES.includes(new URL(href).protocol);
  } catch {
    return false;
  }
}

let current: HTMLElement | null = null;

/** The small "Continue" window (only one at a time). */
function ask(text: string, label: string, onGo: () => void, onCancel: () => void): () => void {
  current?.remove();
  const box = document.createElement('div');
  box.className = 'popup-rescue';
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-label', label);
  const card = document.createElement('div');
  card.className = 'popup-rescue-card';
  const p = document.createElement('p');
  p.textContent = text;
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'btn btn-mint popup-rescue-go';
  go.textContent = label;
  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'link-btn popup-rescue-cancel';
  cancel.textContent = 'Cancel';
  card.append(p, go, cancel);
  box.append(card);
  document.body.append(box);
  current = box;
  const hide = () => {
    box.remove();
    if (current === box) current = null;
  };
  // Must stay synchronous inside the tap: Safari allows the window / app only here.
  go.addEventListener('click', () => {
    hide();
    onGo();
  });
  cancel.addEventListener('click', () => {
    hide();
    onCancel();
  });
  return hide;
}

/** A window that does not exist yet: near-connect uses it until the player taps "Continue". */
function standIn(href: string, target: string | undefined, features: string | undefined, open: typeof window.open): Window {
  let real: Window | null = null;
  let cancelled = false;
  let appOpened = false;
  const queue: [unknown, string][] = [];
  const app = isAppLink(href);
  const name = walletName(href);
  const hide = ask(
    app ? `Tap to open the ${name} app and approve the sign-in.` : `Your browser stopped the ${name} window from opening. Tap to continue.`,
    app ? `Open ${name} app` : `Continue to ${name}`,
    () => {
      if (app) {
        appOpened = true;
        window.location.href = href;
        return;
      }
      real = open(href, target ?? '_blank', features);
      if (!real) return; // still blocked: the stand-in stays open and the wallet can retry
      for (const [data, origin] of queue.splice(0)) real.postMessage(data, origin);
    },
    () => (cancelled = true),
  );
  const stub = {
    get closed() {
      return cancelled || (real ? real.closed : false);
    },
    focus() {
      real?.focus();
    },
    blur() {
      real?.blur();
    },
    close() {
      cancelled = true;
      hide();
      real?.close();
    },
    postMessage(data: unknown, origin = '*') {
      if (real) real.postMessage(data, origin);
      else if (!appOpened) queue.push([data, origin]);
    },
  };
  return stub as unknown as Window;
}

/** Installs the rescue once (before near-connect opens anything). */
export function installPopupRescue(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  const open = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const w = open(url, target, features);
    if (w || url === undefined || url === null || String(url) === '' || String(url) === 'about:blank') return w;
    return standIn(String(url), target, features, open);
  }) as typeof window.open;

  // iOS ignores app links in hidden iframes (near-connect's "open native app"): offer a button.
  if (!isIOS()) return;
  new MutationObserver((records) => {
    for (const r of records)
      for (const node of r.addedNodes) {
        if (!(node instanceof HTMLIFrameElement)) continue;
        const src = node.getAttribute('src') ?? '';
        if (!src || !isAppLink(src) || node.style.display !== 'none') continue;
        const name = walletName(src);
        ask(`Tap to open the ${name} app and approve the sign-in.`, `Open ${name} app`, () => (window.location.href = src), () => undefined);
      }
  }).observe(document.body, { childList: true });
}
