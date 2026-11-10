import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { dartoFreshLine, withArticle } from '../src/text.ts';

describe('share texts', () => {
  it('use "an" before a vowel sound and "a" otherwise', () => {
    assert.equal(withArticle('Orchard Master'), 'an Orchard Master');
    assert.equal(withArticle('Farmer'), 'a Farmer');
    assert.equal(withArticle('Farmhand'), 'a Farmhand');
    assert.equal(withArticle('Durian King'), 'a Durian King');
    assert.equal(withArticle('Legend'), 'a Legend');
    assert.equal(withArticle('Seedling'), 'a Seedling');
    assert.equal(withArticle('Rare Mango'), 'a Rare Mango');
    assert.equal(withArticle('Mango'), 'a Mango');
  });
});

describe("Mr. Darto's red-dot line", () => {
  it('names the fruit count, singular for one', () => {
    assert.equal(dartoFreshLine(15), "Fresh fruit! I'll buy your 15 fruits. Tap Sell!");
    assert.equal(dartoFreshLine(1), "Fresh fruit! I'll buy your 1 fruit. Tap Sell!");
  });
});
