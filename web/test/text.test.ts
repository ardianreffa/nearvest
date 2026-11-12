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

describe('Mr. Darto greeting', async () => {
  const { DARTO_INTRO, dartoGreeting, firstDartoMeeting } = await import('../src/text.ts');
  it('shows ONE greeting: the introduction the first time, then the daily line', () => {
    assert.equal(dartoGreeting(true, 'Good day, farmer!'), DARTO_INTRO);
    assert.equal(dartoGreeting(false, 'Good day, farmer!'), 'Good day, farmer!');
    assert.equal(dartoGreeting(false, ''), DARTO_INTRO);
  });
  it('remembers the first meeting per garden', () => {
    const m = new Map<string, string>();
    const store = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
    assert.equal(firstDartoMeeting('a.testnet', store), true);
    assert.equal(firstDartoMeeting('a.testnet', store), false);
    assert.equal(firstDartoMeeting('b.testnet', store), true);
  });
});
