// Sound polish (2026-11-12): a bigger sale to Mr. Darto gets a few more coin "cring"s, never many.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sellCoinCount } from '../src/audio.ts';

describe('sell coins', () => {
  it('one coin for a single item, up to 4 for a big sale', () => {
    assert.equal(sellCoinCount(1), 1);
    assert.equal(sellCoinCount(2), 2);
    assert.equal(sellCoinCount(4), 2);
    assert.equal(sellCoinCount(5), 3);
    assert.equal(sellCoinCount(10), 4);
    assert.equal(sellCoinCount(500), 4);
  });
});
