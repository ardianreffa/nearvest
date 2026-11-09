// Google Identity Services button. Used on the login page ("Sign in with Google")
// and in the Profile of wallet gardens ("Link Google account"). It only hands the
// ID token to `onCredential`; the caller decides which server route gets it.

import { useEffect, useRef } from 'preact/hooks';
import { installPopupRescue } from './popup-rescue';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

let scriptPromise: Promise<void> | null = null;

/** Shown when Google's script or button cannot load (often a content blocker or Private Relay). */
export const GOOGLE_BLOCKED =
  'The Google button could not load. A content blocker or iCloud Private Relay can block it: turn it off and reload, or use a NEAR wallet or Try as Judge.';
/** Shown on phones when a tap on the Google button opened nothing. */
export const GOOGLE_NO_WINDOW =
  'Google sign-in did not open. Allow pop-ups for this site (Settings > Apps > Safari > Block Pop-ups: off), turn off a content blocker, then try again. Or use Try as Judge.';

const isTouchPhone = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function loadScript(): Promise<void> {
  if (window.google) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client?hl=en';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      scriptPromise = null; // allow a retry after a reload of the button
      reject(new Error(GOOGLE_BLOCKED));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/** Shows a disabled placeholder until a Client ID is configured. */
export function GoogleButton({
  clientId,
  onCredential,
  onError,
  text = 'signin_with',
  width,
}: {
  clientId: string | null;
  onCredential: (credential: string) => Promise<void>;
  onError: (message: string) => void;
  /** Google's button wording: 'signin_with' ("Sign in with Google") or 'continue_with' ("Continue with Google"). */
  text?: 'signin_with' | 'continue_with';
  /** Button width in px (Google allows 200-400), so it lines up with the game's buttons. */
  width?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest handlers: Google keeps the callback given at initialize time.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    if (!clientId || !ref.current) return;
    // Safari on iPhone blocks the Google window (opened by Google's script after a message from
    // its button iframe, not inside the tap): offer "Continue to Google" instead (popup-rescue.ts).
    installPopupRescue();
    let alive = true;
    loadScript()
      .then(() => {
        if (!alive || !ref.current) return;
        window.google!.accounts.id.initialize({
          client_id: clientId,
          callback: ({ credential }) => {
            handlers.current.onCredential(credential).catch((e) => handlers.current.onError(e instanceof Error ? e.message : String(e)));
          },
        });
        window.google!.accounts.id.renderButton(ref.current, {
          theme: 'filled_black',
          size: 'large',
          shape: width ? 'rectangular' : 'pill',
          text,
          locale: 'en',
          ...(width ? { width, logo_alignment: 'center' } : {}),
        });
      })
      .catch((e: Error) => handlers.current.onError(e.message));
    // The button never appeared (script blocked or very slow): say so instead of an empty slot.
    const noButton = window.setTimeout(() => {
      if (alive && ref.current && !ref.current.querySelector('iframe')) handlers.current.onError(GOOGLE_BLOCKED);
    }, 10_000);
    // Phones: Google opens its sign-in page in a new tab, so this page is hidden right after the
    // tap. If the page stays visible, the tab was blocked: explain it (the tap itself happens
    // inside Google's iframe, which this page only notices as losing focus).
    let check = 0;
    let opened = false;
    const onHide = () => {
      if (document.visibilityState === 'hidden') opened = true;
    };
    const onBlur = () => {
      if (!isTouchPhone() || !ref.current) return;
      const active = document.activeElement;
      if (!active || active.tagName !== 'IFRAME' || !ref.current.contains(active)) return;
      opened = false;
      window.clearTimeout(check);
      check = window.setTimeout(() => {
        // Not while the "Continue to Google" box is waiting for a tap.
        if (alive && !opened && document.visibilityState === 'visible' && !document.querySelector('.popup-rescue')) handlers.current.onError(GOOGLE_NO_WINDOW);
      }, 4000);
    };
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      alive = false;
      window.clearTimeout(noButton);
      window.clearTimeout(check);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [clientId, text, width]);

  if (!clientId) {
    return (
      <button class="btn btn-google" disabled title="Google login is being set up">
        Sign in with Google (coming soon)
      </button>
    );
  }
  return <div class="google-slot" ref={ref} />;
}
