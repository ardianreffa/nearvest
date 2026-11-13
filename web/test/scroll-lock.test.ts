import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createScrollLock, type LockPage } from '../src/scroll-lock.ts';

function fakePage(y: number) {
  const state = { y, marked: false, fixed: false, scrolls: [] as number[] };
  const page: LockPage = {
    scrollY: () => state.y,
    scrollTo: (to) => {
      state.y = to;
      state.scrolls.push(to);
    },
    body: { position: '', top: '', left: '', right: '', width: '' },
    mark: (on) => {
      state.marked = on;
    },
    fixedScreen: () => state.fixed,
  };
  return { page, state };
}

describe('page scroll lock while a window is open', () => {
  test('the first window pins the page where it is; closing puts it back at the same place', () => {
    const { page, state } = fakePage(420);
    const lock = createScrollLock(page);
    lock.sync(true);
    assert.equal(lock.locked(), true);
    assert.equal(page.body.position, 'fixed');
    assert.equal(page.body.top, '-420px');
    assert.equal(state.marked, true);
    // A pinned body reports scroll 0 in a browser.
    state.y = 0;
    lock.sync(false);
    assert.equal(lock.locked(), false);
    assert.deepEqual(page.body, { position: '', top: '', left: '', right: '', width: '' });
    assert.equal(state.marked, false);
    assert.deepEqual(state.scrolls, [420]);
  });

  test('a second window over the first keeps the first position; only the last close unlocks', () => {
    const { page, state } = fakePage(300);
    const lock = createScrollLock(page);
    lock.sync(true);
    state.y = 0;
    lock.sync(true); // a popup over the window
    assert.equal(page.body.top, '-300px');
    lock.sync(true); // the popup closed, the window is still open
    assert.equal(lock.locked(), true);
    assert.deepEqual(state.scrolls, []);
    lock.sync(false);
    assert.deepEqual(state.scrolls, [300]);
  });

  test('nothing happens while no window is open', () => {
    const { page, state } = fakePage(50);
    const lock = createScrollLock(page);
    lock.sync(false);
    lock.sync(false);
    assert.equal(page.body.position, '');
    assert.deepEqual(state.scrolls, []);
    assert.equal(state.marked, false);
  });

  test("the body's own inline style comes back as it was", () => {
    const { page } = fakePage(10);
    page.body.width = '50%';
    const lock = createScrollLock(page);
    lock.sync(true);
    assert.equal(page.body.width, '100%');
    lock.sync(false);
    assert.equal(page.body.width, '50%');
  });

  test('a page that became one fixed screen meanwhile is not scrolled (phones, Garden tab)', () => {
    const { page, state } = fakePage(600);
    const lock = createScrollLock(page);
    lock.sync(true);
    state.fixed = true;
    lock.sync(false);
    assert.deepEqual(state.scrolls, []);
    assert.equal(page.body.position, '');
  });
});
