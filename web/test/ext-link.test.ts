// Explorer links (src/ext-link.ts): the same tab on iPhone / iPad, a new tab elsewhere; every
// nearblocks link in the web goes through explorerTarget (no hard-coded target="_blank" left).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { explorerTarget, isExplorerUrl } from '../src/ext-link.ts';

describe('explorer links', () => {
  it('knows nearblocks addresses', () => {
    assert.equal(isExplorerUrl('https://testnet.nearblocks.io/txns/abc'), true);
    assert.equal(isExplorerUrl('https://nearblocks.io/address/x.near'), true);
    assert.equal(isExplorerUrl('https://x.com/intent/post?text=hi'), false);
    assert.equal(isExplorerUrl('https://nearblocks.io.evil.example/'), false);
    assert.equal(isExplorerUrl(null), false);
  });

  it('iPhone / iPad: no target (same tab); others: a new tab', () => {
    assert.deepEqual(explorerTarget(true), {});
    assert.deepEqual(explorerTarget(false), { target: '_blank', rel: 'noopener' });
  });

  it('no hard-coded target="_blank" on a link that is not a Post on X link', () => {
    const dir = new URL('../src/', import.meta.url);
    const bad: string[] = [];
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.tsx')) continue;
      readFileSync(new URL(f, dir), 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.includes('target="_blank"') && !/postUrl|x\.com/.test(line)) bad.push(`${f}:${i + 1}`);
        });
    }
    assert.deepEqual(bad, []);
  });
});
