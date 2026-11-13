import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chosenQuality, clampQty, keepPick, saleTotal, seasonNote, seasonPayout, sortByQuality, stepQty } from '../src/qty.ts';

describe('quantity picker', () => {
  it('stays between 1 and the amount you have', () => {
    assert.equal(clampQty(5, 3), 3);
    assert.equal(clampQty(0, 3), 1);
    assert.equal(clampQty(-4, 3), 1);
    assert.equal(clampQty(2.6, 7), 3);
    assert.equal(clampQty(NaN, 7), 1);
  });

  it('is 0 when there is nothing to pick', () => {
    assert.equal(clampQty(1, 0), 0);
    assert.equal(stepQty(1, 1, 0), 0);
  });

  it('- and + move one step and stop at the ends', () => {
    assert.equal(stepQty(1, -1, 5), 1);
    assert.equal(stepQty(1, 1, 5), 2);
    assert.equal(stepQty(5, 1, 5), 5);
  });

  it('when the stock shrinks, the picked amount follows', () => {
    assert.equal(clampQty(8, 2), 2);
  });

  it('the total follows price, quality and amount', () => {
    assert.equal(saleTotal(10, 1, 3), 30);
    assert.equal(saleTotal(10, 5, 2), 100);
    assert.equal(saleTotal(13, 2, 0), 0);
  });

  it('the button shows what is really paid after the Season rule', () => {
    assert.equal(seasonPayout(saleTotal(8, 2, 1), 2), 8); // Rare Mango shown 16, paid 8
    assert.equal(seasonPayout(25, 4), 6.25);
    assert.equal(seasonPayout(30, 1), 30);
    assert.equal(seasonPayout(10, 0), 10);
  });
});

describe('Village Stats Season note', () => {
  it('says "lowest level" only at 12.5%', () => {
    assert.equal(seasonNote({ rewardDivisor: 1, nextSeasonAt: null }), 'Rewards halve as more PANEN is minted (never below 12.5%)');
    assert.equal(seasonNote({ rewardDivisor: 1, nextSeasonAt: 2000 }), 'Rewards halve when 2,000 PANEN have been minted (never below 12.5%)');
    assert.equal(seasonNote({ rewardDivisor: 4, nextSeasonAt: 10000 }), 'Rewards halve when 10,000 PANEN have been minted (never below 12.5%)');
    assert.equal(seasonNote({ rewardDivisor: 8, nextSeasonAt: null }), 'Lowest reward level reached (12.5%)');
  });
});

// Market bug 2026-11-13: with TaniBot ON the stock changes under the picker (harvests, sales, polls).
describe('the pick survives a changing stock', () => {
  it('more fruit arrives: the picked amount stays', () => {
    assert.equal(keepPick(3, 5), 3);
    assert.equal(keepPick(3, 9), 3);
  });

  it('the stock drops below the pick: it follows the stock down and is not reset to 1', () => {
    assert.equal(keepPick(7, 4), 4);
    assert.equal(keepPick(4, 6), 4); // and stays there when fruit comes back
  });

  it('an empty stock keeps the pick for later', () => {
    assert.equal(keepPick(3, 0), 3);
  });

  it('the chosen quality stays while it is in stock; a new quality never takes over', () => {
    const owned = [{ quality: 'common' }, { quality: 'rare' }];
    assert.equal(chosenQuality(owned, 'rare'), 'rare');
    assert.equal(chosenQuality([{ quality: 'common' }, { quality: 'rare' }, { quality: 'gold' }], 'rare'), 'rare');
    assert.equal(chosenQuality([{ quality: 'common' }], 'rare'), 'common'); // sold out: the first in stock
    assert.equal(chosenQuality([], 'rare'), null);
  });

  it('quality chips keep one order, whatever order the server sends', () => {
    const q = (list: string[]) => sortByQuality(list.map((quality) => ({ quality }))).map((x) => x.quality);
    assert.deepEqual(q(['gold', 'common', 'rare']), ['common', 'rare', 'gold']);
    assert.deepEqual(q(['rare', 'gold']), ['rare', 'gold']);
  });
});
