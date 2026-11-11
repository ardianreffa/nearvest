// The keys of the chain flash and the duel screens in <main> (src/overlay-key.ts): never the same
// for different elements, also when their numbers are equal (the first flash and the first match
// were both 1 and Preact warned about two children with the key "1").
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { overlayKey, type OverlayKind } from '../src/overlay-key.ts';

describe('overlay keys in the game screen', () => {
  it('the flash, a duel and a match with the same number get different keys', () => {
    const kinds: OverlayKind[] = ['flash', 'duel', 'match'];
    for (const id of [0, 1, 2, 17]) assert.equal(new Set(kinds.map((k) => overlayKey(k, id))).size, 3);
    assert.equal(overlayKey('match', 1), 'match-1');
  });

  it('app.tsx keys these three elements with overlayKey, never with a bare number', () => {
    const app = readFileSync(new URL('../src/app.tsx', import.meta.url), 'utf8');
    assert.doesNotMatch(app, /key=\{(flash|duel\.id|match\.id)\}/);
    for (const k of ['flash', 'duel', 'match']) assert.match(app, new RegExp(`key=\\{overlayKey\\('${k}'`));
  });
});
