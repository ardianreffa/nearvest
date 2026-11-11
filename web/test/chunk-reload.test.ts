// A page opened before a new deploy reloads once when a JS file is gone (src/chunk-reload.ts).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isChunkLoadError, loadChunk, reloadOnce, RELOAD_GUARD_MS, RELOAD_KEY, UPDATED_TEXT } from '../src/chunk-reload.ts';

function env(start = 1_000_000) {
  const data = new Map<string, string>();
  const e = {
    t: start,
    reloads: 0,
    storage: { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) },
    reload: () => void e.reloads++,
    now: () => e.t,
  };
  return e;
}

describe('chunk reload', () => {
  it('knows the browsers\' "file is gone" errors and nothing else', () => {
    assert.ok(isChunkLoadError(new TypeError('Importing a module script failed.')));
    assert.ok(isChunkLoadError(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js')));
    assert.ok(isChunkLoadError(new TypeError('error loading dynamically imported module')));
    assert.ok(isChunkLoadError(new Error('Unable to preload CSS for /assets/a.css')));
    assert.ok(!isChunkLoadError(new Error('Network error')));
    assert.ok(!isChunkLoadError(undefined));
  });

  it('reloads once, then not again within the guard (no loop); again after it', () => {
    const e = env();
    assert.equal(reloadOnce(e), true);
    assert.equal(e.reloads, 1);
    assert.equal(e.storage.getItem(RELOAD_KEY), String(e.t));
    e.t += 5_000;
    assert.equal(reloadOnce(e), false);
    assert.equal(e.reloads, 1);
    e.t += RELOAD_GUARD_MS;
    assert.equal(reloadOnce(e), true);
    assert.equal(e.reloads, 2);
  });

  it('no storage = never reloads', () => {
    const e = { ...env(), storage: null };
    assert.equal(reloadOnce(e), false);
  });

  it('loadChunk: a gone file reloads and never shows the error; the second time a plain line', async () => {
    const e = env();
    let settled = false;
    void loadChunk(() => Promise.reject(new TypeError('Importing a module script failed.')), e).then(
      () => (settled = true),
      () => (settled = true),
    );
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(e.reloads, 1);
    assert.equal(settled, false);
    await assert.rejects(loadChunk(() => Promise.reject(new TypeError('Importing a module script failed.')), e), { message: UPDATED_TEXT });
    await assert.rejects(loadChunk(() => Promise.reject(new Error('boom')), e), { message: 'boom' });
    assert.equal(await loadChunk(() => Promise.resolve(7), e), 7);
    assert.equal(e.reloads, 1);
  });
});
