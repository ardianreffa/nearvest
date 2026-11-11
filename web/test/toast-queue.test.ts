// The notice strip's rules (src/toast-queue.ts): important notices (a duel received, a sticker,
// errors) are never lost behind a window or under a newer notice (Ardian's iPhone test 2026-11-11:
// a duel notice could disappear unseen while a window covered the strip).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dueIn, EMPTY, ERROR_MS, hideToast, LIFE_MS, nextToast, pushToast, unhideToast, type Toast } from '../src/toast-queue.ts';

let n = 0;
const news = (text: string): Toast => ({ id: ++n, kind: 'success', long: true, text });
const normal = (text: string): Toast => ({ id: ++n, kind: 'success', text });
const shownText = (q: { shown: { toast: Toast } | null }) => q.shown?.toast.text ?? null;

describe('notice strip', () => {
  it('normal notices replace each other and count "+n more", as before', () => {
    let q = pushToast(EMPTY, normal('Watered!'), 0);
    q = pushToast(q, normal('Planted!'), 100);
    assert.equal(shownText(q), 'Planted!');
    assert.equal(q.shown!.more, 1);
    assert.equal(dueIn(q, 100), LIFE_MS);
  });

  it('a duel notice hidden behind a window keeps waiting and then shows its full time', () => {
    let q = pushToast(EMPTY, news('budi challenged you in the Arena and won 2-1. Rematch?'), 0);
    q = hideToast(q, 1000); // the Arena window covers the strip
    assert.equal(dueIn(q, 1000), null, 'no clock while hidden');
    // Long after its 6 s it is still there.
    q = pushToast(q, normal('Watered!'), 60_000);
    q = nextToast(q, 63_500); // the normal one ends
    assert.equal(shownText(q), 'budi challenged you in the Arena and won 2-1. Rematch?');
    q = unhideToast(q, 63_500);
    assert.equal(dueIn(q, 63_500), ERROR_MS);
  });

  it('a hidden notice that comes back on screen gets its full time again', () => {
    let q = pushToast(EMPTY, news('sari left you a sticker'), 0);
    q = hideToast(q, 5000);
    q = unhideToast(q, 90_000);
    assert.equal(dueIn(q, 90_000), ERROR_MS);
  });

  it('a normal notice shows at once but the important one comes back after it', () => {
    let q = pushToast(EMPTY, news('budi challenged you in the Arena'), 0);
    q = pushToast(q, { id: ++n, kind: 'chain', text: 'Tree NFT updated' }, 1000);
    assert.equal(shownText(q), 'Tree NFT updated');
    q = nextToast(q, 1000 + LIFE_MS);
    assert.equal(shownText(q), 'budi challenged you in the Arena');
    assert.equal(dueIn(q, 1000 + LIFE_MS), ERROR_MS);
  });

  it('two important notices show one after the other, none is lost', () => {
    let q = pushToast(EMPTY, news('a challenged you'), 0);
    q = pushToast(q, news('b left you a sticker'), 500);
    assert.equal(shownText(q), 'a challenged you');
    q = nextToast(q, ERROR_MS);
    assert.equal(shownText(q), 'b left you a sticker');
    q = nextToast(q, 2 * ERROR_MS);
    assert.equal(q.shown, null);
  });

  it('tapping a notice away shows the next waiting one', () => {
    let q = pushToast(EMPTY, { id: ++n, kind: 'error', text: 'Not enough PANEN' }, 0);
    q = pushToast(q, news('a challenged you'), 10);
    q = nextToast(q, 20); // tap
    assert.equal(shownText(q), 'a challenged you');
  });

  it('normal notices are not held back by a window (they are about what you just did)', () => {
    let q = pushToast(EMPTY, normal('Watered!'), 0);
    q = hideToast(q, 10);
    assert.equal(dueIn(q, 10), LIFE_MS - 10);
  });

  it('an expired normal notice is simply replaced', () => {
    let q = pushToast(EMPTY, normal('Watered!'), 0);
    q = pushToast(q, news('a challenged you'), LIFE_MS + 1);
    assert.equal(shownText(q), 'a challenged you');
    assert.equal(q.shown!.more, 0);
  });
});
