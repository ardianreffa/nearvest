// Google Identity Services button. Used on the login page ("Sign in with Google")
// and in the Profile of wallet gardens ("Link Google account"). It only hands the
// ID token to `onCredential`; the caller decides which server route gets it.

import { useEffect, useRef } from 'preact/hooks';

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

function loadScript(): Promise<void> {
  if (window.google) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client?hl=en';
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Could not load Google sign-in'));
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
}: {
  clientId: string | null;
  onCredential: (credential: string) => Promise<void>;
  onError: (message: string) => void;
  /** Google's button wording: 'signin_with' ("Sign in with Google") or 'continue_with' ("Continue with Google"). */
  text?: 'signin_with' | 'continue_with';
}) {
  const ref = useRef<HTMLDivElement>(null);
  // The latest handlers: Google keeps the callback given at initialize time.
  const handlers = useRef({ onCredential, onError });
  handlers.current = { onCredential, onError };

  useEffect(() => {
    if (!clientId || !ref.current) return;
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
        window.google!.accounts.id.renderButton(ref.current, { theme: 'filled_black', size: 'large', shape: 'pill', text, locale: 'en' });
      })
      .catch((e: Error) => handlers.current.onError(e.message));
    return () => {
      alive = false;
    };
  }, [clientId, text]);

  if (!clientId) {
    return (
      <button class="btn btn-google" disabled title="Google login is being set up">
        Sign in with Google (coming soon)
      </button>
    );
  }
  return <div class="google-slot" ref={ref} />;
}
