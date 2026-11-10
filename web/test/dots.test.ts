// Red dots on the tabs and the Friends pin (src/dots.ts) and the sticker countdown (one per visit,
// from the server's wait: src/referral.ts stickerReadyAt / stickerWaitS).
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GameState } from '../src/api.ts';
import { dotsFor, markSeen, villageNews } from '../src/dots.ts';
import { stickerButtonLabel, stickerReadyAt, stickerWaitS } from '../src/referral.ts';

type Tree = NonNullable<GameState['plots'][number]['tree']>;
const tree = (t: Partial<Tree> = {}) => ({ ready: false, isWatered: true, wateredToday: true, waterNeed: 1, wilting: false, ...t }) as Tree;

function state(over: Partial<GameState> = {}): GameState {
  return {
    plots: [
      { plot: 0, locked: false, tree: tree() },
      { plot: 1, locked: false, tree: tree() },
      { plot: 2, locked: true, tree: null },
    ],
    seeds: [{ id: 1, species: 'mango', quality: null, parentTreeId: null, source: 'checkin' }],
    fruits: [],
    items: [{ item: 'fertilizer', qty: 0 }],
    ...over,
  } as unknown as GameState;
}

describe('red dots', () => {
  it('nothing to do: no dot anywhere (fertilizer never gets a dot)', () => {
    const d = dotsFor(state(), 'storage', false);
    assert.deepEqual(d, { tabs: { garden: false, storage: false, shop: false, market: false, village: false }, friends: false });
  });

  it('Market: fruit to sell; gone when the fruit is gone', () => {
    assert.equal(dotsFor(state({ fruits: [{ species: 'mango', quality: 'common', qty: 2 }] }), 'garden', false).tabs.market, true);
    assert.equal(dotsFor(state({ fruits: [{ species: 'mango', quality: 'common', qty: 0 }] }), 'garden', false).tabs.market, false);
  });

  it('Shop: no seeds AND an empty plot (a locked plot does not count)', () => {
    const empty = state({ seeds: [], plots: [{ plot: 0, locked: false, tree: null }, { plot: 1, locked: true, tree: null }] } as Partial<GameState>);
    assert.equal(dotsFor(empty, 'garden', false).tabs.shop, true);
    assert.equal(dotsFor(state({ seeds: [] }), 'garden', false).tabs.shop, false, 'no seeds but every open plot has a tree');
    assert.equal(dotsFor(state({ plots: empty.plots }), 'garden', false).tabs.shop, false, 'an empty plot but a seed in Storage');
  });

  it('Garden: a ripe or thirsty tree, only while another tab is open', () => {
    const ripe = state({ plots: [{ plot: 0, locked: false, tree: tree({ ready: true }) }] } as Partial<GameState>);
    const thirsty = state({ plots: [{ plot: 0, locked: false, tree: tree({ isWatered: false }) }] } as Partial<GameState>);
    const drought = state({ plots: [{ plot: 0, locked: false, tree: tree({ waterNeed: 2, wateredToday: false }) }] } as Partial<GameState>);
    assert.equal(dotsFor(ripe, 'market', false).tabs.garden, true);
    assert.equal(dotsFor(thirsty, 'village', false).tabs.garden, true);
    assert.equal(dotsFor(drought, 'shop', false).tabs.garden, true);
    assert.equal(dotsFor(ripe, 'garden', false).tabs.garden, false, 'not on the open tab');
    assert.equal(dotsFor(state(), 'market', false).tabs.garden, false);
  });

  it('Village and Friends pin: unseen news from the server; none on old servers', () => {
    assert.equal(villageNews(state()), false, 'no `news` (live server before this release): no dot');
    const s = state({ news: { latestAt: 200, waveAt: 150, seenAt: 100 } });
    const d = dotsFor(s, 'garden', false);
    assert.deepEqual([d.tabs.village, d.friends], [true, true]);
    assert.deepEqual([dotsFor(state({ news: { latestAt: 200, waveAt: 50, seenAt: 100 } }), 'garden', false).friends], [false], 'an old wave back');
    const seen = markSeen(s);
    assert.deepEqual(seen.news, { latestAt: 200, waveAt: 150, seenAt: 200 });
    assert.deepEqual([dotsFor(seen, 'garden', false).tabs.village, dotsFor(seen, 'garden', false).friends], [false, false]);
    assert.equal(markSeen(seen), seen, 'nothing new: same state');
  });

  it('never while visiting a friend\'s garden', () => {
    const busy = state({ fruits: [{ species: 'mango', quality: 'common', qty: 2 }], news: { latestAt: 2, waveAt: 2, seenAt: 0 } });
    const d = dotsFor(busy, null, true);
    assert.equal(Object.values(d.tabs).some(Boolean) || d.friends, false);
  });
});

describe('sticker countdown (one per visit)', () => {
  it('counts from when the server answered, so reopening the window does not restart it', () => {
    const readyAt = stickerReadyAt(5000, 1_000_000);
    assert.equal(stickerWaitS(readyAt, 1_000_000), 5);
    // The window is closed and opened 2 s later: the same readyAt, 3 s left (the old code showed 5 again).
    assert.equal(stickerWaitS(readyAt, 1_002_000), 3);
    assert.equal(stickerButtonLabel(1, 3, stickerWaitS(readyAt, 1_002_000)), 'Wait 3 s');
    assert.equal(stickerWaitS(readyAt, 1_005_000), 0);
    assert.equal(stickerButtonLabel(1, 3, stickerWaitS(readyAt, 1_005_000)), 'Sticker 1/3');
  });

  it('after a refresh the server sends the time still left (here 2.2 s -> 3 s shown, then 2...)', () => {
    const readyAt = stickerReadyAt(2200, 50_000);
    assert.equal(stickerWaitS(readyAt, 50_000), 3);
    assert.equal(stickerWaitS(readyAt, 51_300), 1);
    assert.equal(stickerWaitS(stickerReadyAt(undefined, 9), 9), 0, 'older servers: no wait');
    assert.equal(stickerWaitS(stickerReadyAt(-40, 9), 9), 0);
  });
});
