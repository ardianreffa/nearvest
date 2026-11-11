// After a new Vercel deploy, a page that was opened before it still asks for the old JS files
// (their names carry a hash), which no longer exist. Safari then says "Importing a module script
// failed.", Chrome "Failed to fetch dynamically imported module". The player must never see that:
// such an error reloads the page ONCE (the new page loads the new files). A second failure within
// RELOAD_GUARD_MS does not reload again (no loop); the player gets a plain "refresh" line instead.

export const RELOAD_KEY = 'nearvest.chunkReload';
export const RELOAD_GUARD_MS = 60_000;
export const UPDATED_TEXT = 'NEARvest was just updated. Please refresh the page.';

const CHUNK_PATTERNS = [
  'importing a module script failed', // Safari
  'failed to fetch dynamically imported module', // Chrome
  'error loading dynamically imported module', // Firefox
  'unable to preload css', // Vite
  'failed to load module script', // a module answered with HTML (a missing file)
];

/** True for the "a JS / CSS file of this build is gone" errors. */
export function isChunkLoadError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : typeof err === 'string' ? err : String((err as { message?: unknown })?.message ?? '')).toLowerCase();
  return CHUNK_PATTERNS.some((p) => msg.includes(p));
}

interface Env {
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  reload: () => void;
  now: () => number;
}

function browserEnv(): Env {
  let storage: Env['storage'] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    // Storage blocked: never reload (a loop could not be stopped).
  }
  return { storage, reload: () => window.location.reload(), now: () => Date.now() };
}

/** Reloads the page unless it already did so in the last minute. true = a reload is on its way. */
export function reloadOnce(env: Env = browserEnv()): boolean {
  if (!env.storage) return false;
  try {
    const last = Number(env.storage.getItem(RELOAD_KEY) || 0);
    if (last && env.now() - last < RELOAD_GUARD_MS) return false;
    env.storage.setItem(RELOAD_KEY, String(env.now()));
  } catch {
    return false;
  }
  env.reload();
  return true;
}

/**
 * A dynamic import that survives a new deploy: a missing file reloads the page once (the promise
 * then never settles, so no error shows); after that a plain "please refresh" error.
 */
export function loadChunk<T>(load: () => Promise<T>, env?: Env): Promise<T> {
  return load().catch((err: unknown) => {
    if (!isChunkLoadError(err)) throw err;
    if (reloadOnce(env)) return new Promise<T>(() => {});
    throw new Error(UPDATED_TEXT);
  });
}

/** Catches Vite's preload errors and unhandled chunk errors on this page (main.tsx, landing.tsx). */
export function installChunkReload(): void {
  window.addEventListener('vite:preloadError', (e) => {
    e.preventDefault(); // stops Vite from throwing the error
    reloadOnce();
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (!isChunkLoadError(e.reason)) return;
    e.preventDefault();
    reloadOnce();
  });
  window.addEventListener('error', (e) => {
    if (!isChunkLoadError(e.error ?? e.message)) return;
    e.preventDefault();
    reloadOnce();
  });
}
