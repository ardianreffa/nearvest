import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clampQty, saleTotal, stepQty } from '../src/qty.ts';

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
});
