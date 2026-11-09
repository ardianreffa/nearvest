import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { MemorialView } from '../src/api.ts';
import { sortMemorials } from '../src/memorials.ts';

const m = (id: number, diedAt: number | null, plot: number | null): MemorialView => ({
  id,
  tokenId: String(id),
  species: 'mango',
  quality: 'common',
  harvestCount: 3,
  maxHarvests: 3,
  plantedAt: 0,
  diedAt,
  plot,
});

describe('Memorial Trees list order', () => {
  it('standing on a plot first, then the newest', () => {
    const list = [m(1, 100, null), m(2, 300, null), m(3, 50, 0), m(4, 200, null), m(5, null, null)];
    assert.deepEqual(sortMemorials(list).map((x) => x.id), [3, 2, 4, 1, 5]);
  });

  it('does not change the list it was given', () => {
    const list = [m(1, 100, null), m(2, 300, null)];
    sortMemorials(list);
    assert.deepEqual(list.map((x) => x.id), [1, 2]);
  });
});
