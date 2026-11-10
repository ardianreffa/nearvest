import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clearRef, freshIds, inviteLink, keepRef, keepRefFromUrl, parseRef, readRef, REF_KEEP_MS, REF_KEY } from '../src/referral.ts';

function memory() {
  const m = new Map<string, string>();
  return {
    m,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('referral link keeping', () => {
  it('parses ?ref= (lower case, garden-name characters only)', () => {
    assert.equal(parseRef('?ref=Sari'), 'sari');
    assert.equal(parseRef('?judge=1&ref=budi-2'), 'budi-2');
    assert.equal(parseRef(''), null);
    assert.equal(parseRef('?ref='), null);
    assert.equal(parseRef('?ref=../x'), null);
    assert.equal(parseRef('?ref=a%20b'), null);
  });

  it('keeps the invite for 7 days, then drops it', () => {
    const s = memory();
    keepRefFromUrl('?ref=sari', s, 1000);
    assert.equal(readRef(s, 1000 + REF_KEEP_MS - 1), 'sari');
    assert.equal(readRef(s, 1000 + REF_KEEP_MS), null);
    assert.equal(s.m.has(REF_KEY), false, 'an expired invite is removed');
  });

  it('the newest link wins; no ref in the URL keeps the old one; clear removes it', () => {
    const s = memory();
    keepRef(s, 'sari', 0);
    keepRefFromUrl('?ref=budi', s, 10);
    keepRefFromUrl('?time=day', s, 20);
    assert.equal(readRef(s, 30), 'budi');
    clearRef(s);
    assert.equal(readRef(s, 40), null);
  });

  it('broken values and blocked storage never throw', () => {
    const s = memory();
    s.setItem(REF_KEY, '{nope');
    assert.equal(readRef(s, 0), null);
    s.setItem(REF_KEY, JSON.stringify({ ref: '<script>', at: 0 }));
    assert.equal(readRef(s, 0), null);
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => {
        throw new Error('blocked');
      },
    };
    keepRef(blocked, 'sari', 0);
    assert.equal(readRef(blocked, 0), null);
    clearRef(blocked);
  });

  it('matches the landing page script format ({ref, at})', () => {
    const s = memory();
    s.setItem(REF_KEY, JSON.stringify({ ref: 'sari', at: 5 }));
    assert.equal(readRef(s, 6), 'sari');
  });

  it('invite link = landing page with ?ref=', () => {
    assert.equal(inviteLink('https://nearvest-six.vercel.app/', 'sari'), 'https://nearvest-six.vercel.app/?ref=sari');
  });

  it('fresh ids for notices', () => {
    assert.deepEqual(freshIds([5, 4, 3], 3), { fresh: [5, 4], seen: 5 });
    assert.deepEqual(freshIds([], 7), { fresh: [], seen: 7 });
  });
});
