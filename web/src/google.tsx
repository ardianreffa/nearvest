// Google Identity Services button. Used on the login page ("Sign in with Google")
// and in the Profile of wallet gardens ("Link Google account"). It only hands the
// ID token to `onCredential`; the caller decides which server route gets it.

import { useEffect, useRef } from 'preact/hooks';
import { installPopupRescue, isIOS } from './popup-rescue';

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

// ---------- Full-page redirect sign-in (iPhone / iPad Safari) ----------
//
// Safari on iOS blocks Google's sign-in window (it is opened by Google's script after a message
// from its button iframe, outside the tap), and even a window opened inside the tap does not
// reach Google's script there. So on iPhone / iPad the sign-in button goes to Google in the same
// tab (OpenID Connect, response_type=id_token) and Google sends the player back to /play with the
// ID token in the address fragment. The server checks that token exactly like the button's one
// (POST /auth/google): same issuer, audience (Client ID) and verified email.
// Google Cloud Console must list <site>/play as an "Authorized redirect URI" of this Client ID.

const REDIRECT_KEY = 'nearvest.googleRedirect';

/** Where Google sends the player back: this site's /play page. */
export const googleRedirectUri = () => `${location.origin}/play`;

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Why the player went to Google: sign in, or link Google to the signed-in (wallet) garden. */
export type GoogleRedirectPurpose = 'login' | 'link';

/** The purpose of a pending Google return in the address, without consuming it. */
export function pendingGoogleRedirect(): GoogleRedirectPurpose | null {
  if (typeof location === 'undefined' || !location.hash) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('state') || (!h.has('id_token') && !h.has('error'))) return null;
  try {
    return JSON.parse(sessionStorage.getItem(REDIRECT_KEY) ?? '{}').purpose === 'link' ? 'link' : 'login';
  } catch {
    return 'login';
  }
}

/** Leaves for Google's sign-in page (same tab, no pop-up). */
export function startGoogleRedirect(clientId: string, purpose: GoogleRedirectPurpose = 'login'): void {
  const state = randomToken();
  const nonce = randomToken();
  try {
    sessionStorage.setItem(REDIRECT_KEY, JSON.stringify({ state, nonce, purpose }));
  } catch {
    // Storage blocked: the check on return fails safely with a clear message.
  }
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: googleRedirectUri(),
    response_type: 'id_token',
    scope: 'openid email profile',
    nonce,
    state,
    prompt: 'select_account',
  });
  location.assign(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
}

/**
 * Back from Google: the ID token from the address fragment (checked against the state and nonce
 * saved before leaving), or a message. Clears the fragment either way. null = not a Google return.
 */
export function takeGoogleRedirect(): { credential: string } | { error: string } | null {
  if (typeof location === 'undefined' || !location.hash) return null;
  const h = new URLSearchParams(location.hash.slice(1));
  if (!h.has('state') || (!h.has('id_token') && !h.has('error'))) return null;
  history.replaceState(null, '', location.pathname + location.search);
  let saved: { state?: string; nonce?: string } = {};
  try {
    saved = JSON.parse(sessionStorage.getItem(REDIRECT_KEY) ?? '{}');
    sessionStorage.removeItem(REDIRECT_KEY);
  } catch {
    // ignore
  }
  if (h.has('error')) return { error: h.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google sign-in failed (${h.get('error')}). Please try again.` };
  if (!saved.state || saved.state !== h.get('state')) return { error: 'Google sign-in could not be checked. Please try again.' };
  const token = h.get('id_token')!;
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (payload.nonce !== saved.nonce) return { error: 'Google sign-in could not be checked. Please try again.' };
  } catch {
    return { error: 'Google sign-in could not be checked. Please try again.' };
  }
  return { credential: token };
}

/** Shows a disabled placeholder until a Client ID is configured. */
export function GoogleButton({
  clientId,
  onCredential,
  onError,
  text = 'signin_with',
  width,
  redirectOnIOS = false,
}: {
  clientId: string | null;
  onCredential: (credential: string) => Promise<void>;
  onError: (message: string) => void;
  /** Google's button wording: 'signin_with' ("Sign in with Google") or 'continue_with' ("Continue with Google"). */
  text?: 'signin_with' | 'continue_with';
  /** Button width in px (Google allows 200-400), so it lines up with the game's buttons. */
  width?: number;
  /** iPhone / iPad: go to Google by a full-page redirect instead of Google's button ('login' or 'link'). */
  redirectOnIOS?: boolean | GoogleRedirectPurpose;
}) {
  if (redirectOnIOS && clientId && isIOS()) {
    const purpose: GoogleRedirectPurpose = redirectOnIOS === 'link' ? 'link' : 'login';
    return (
      <button type="button" class="btn btn-google-redirect" onClick={() => startGoogleRedirect(clientId, purpose)}>
        {text === 'continue_with' ? 'Continue with Google' : 'Sign in with Google'}
      </button>
    );
  }
  return <GisButton clientId={clientId} onCredential={onCredential} onError={onError} text={text} width={width} />;
}

/** Google's own button (Google Identity Services), used everywhere except iPhone / iPad sign-in. */
function GisButton({
  clientId,
  onCredential,
  onError,
  text = 'signin_with',
  width,
}: {
  clientId: string | null;
  onCredential: (credential: string) => Promise<void>;
  onError: (message: string) => void;
  text?: 'signin_with' | 'continue_with';
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
