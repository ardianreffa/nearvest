import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { clearRef, freshIds, inviteLink, inviteOrigin, keepRef, keepRefFromUrl, parseRef, PUBLIC_SITE, readRef, REF_KEEP_MS, REF_KEY, withoutRef, withRef } from '../src/referral.ts';

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

/** Runs the landing page's inline script (web/index.html) with a fake page. */
function runLandingScript(url: string, store: ReturnType<typeof memory>) {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  const u = new URL(url);
  let replacedWith: string | null = null;
  const location = { search: u.search, hash: u.hash, replace: (to: string) => void (replacedWith = to) };
  // The chunk-reload guard in the same page only adds an error listener.
  runInNewContext(code, { location, localStorage: store, URLSearchParams, Date, JSON, window: { addEventListener: () => undefined } });
  return replacedWith;
}

describe('the invite survives the way to a new garden', () => {
  it('production invite links point at the public site', () => {
    assert.equal(PUBLIC_SITE, 'https://nearvest-six.vercel.app');
    assert.equal(inviteLink(inviteOrigin(false, 'https://nearvest-git-abc.vercel.app'), 'sari'), 'https://nearvest-six.vercel.app/?ref=sari');
    assert.equal(inviteLink(inviteOrigin(true, 'http://localhost:5173'), 'sari'), 'http://localhost:5173/?ref=sari');
  });

  it('landing links to /play carry the invite (Play for free, floating button, Try as Judge)', () => {
    assert.equal(withRef('/play', 'sari'), '/play?ref=sari');
    assert.equal(withRef('/play?judge=1', 'sari'), '/play?judge=1&ref=sari');
    assert.equal(withRef('/play#x', 'sari'), '/play?ref=sari#x');
    assert.equal(withRef('/play', null), '/play');
    assert.equal(withRef('/play?judge=1', null), '/play?judge=1');
  });

  it('the address bar is cleaned without losing other options', () => {
    assert.equal(withoutRef('?ref=sari'), '');
    assert.equal(withoutRef('?judge=1&ref=sari'), '?judge=1');
    assert.equal(withoutRef(''), '');
  });

  it("landing script keeps ?ref= (index.html), also when it sends a signed-in player to /play", () => {
    const s = memory();
    assert.equal(runLandingScript('https://nearvest-six.vercel.app/?ref=Sari', s), null);
    assert.equal(readRef(s, Date.now()), 'sari');
    const s2 = memory();
    s2.setItem('nearvest.token', 't');
    assert.equal(runLandingScript('https://nearvest-six.vercel.app/?ref=budi', s2), '/play?ref=budi');
    assert.equal(readRef(s2, Date.now()), 'budi');
    const s3 = memory();
    runLandingScript('https://nearvest-six.vercel.app/?ref=../evil', s3);
    assert.equal(s3.getItem(REF_KEY), null);
  });

  it('whole journey: landing -> /play -> Google redirect or wallet -> create screen', () => {
    const s = memory();
    const t0 = 1_000_000;
    // 1. Landing page with the invite link.
    runLandingScript('https://nearvest-six.vercel.app/?ref=sari', s);
    // 2. "Play for free" (or the floating button, or Try as Judge) opens /play with the invite.
    const play = new URL(withRef('/play', readRef(s, t0) ?? parseRef('?ref=sari')), PUBLIC_SITE);
    assert.equal(play.search, '?ref=sari');
    // 3. /play boot keeps it and cleans the address bar.
    keepRefFromUrl(play.search, s, t0);
    assert.equal(withoutRef(play.search), '');
    // 4. Google's iPhone redirect comes back to /play#id_token=... (no query): storage still has it.
    keepRefFromUrl('', s, t0 + 60_000);
    // 5. Wallet sign-in does not touch it either; the create screen reads it a few minutes later.
    assert.equal(readRef(s, t0 + 5 * 60_000), 'sari');
    // 6. After the garden is made it is cleared.
    clearRef(s);
    assert.equal(readRef(s, t0 + 6 * 60_000), null);
  });

  it('storage blocked: the invite still rides in the /play link', () => {
    assert.equal(withRef('/play', parseRef('?ref=sari')), '/play?ref=sari');
  });
});

describe('farmer search and sticker button', async () => {
  const { matchesPrefix, stickerButtonLabel } = await import('../src/referral.ts');
  it('matches the start of a name, any case', () => {
    assert.equal(matchesPrefix('sariwangi', ' SAR '), true);
    assert.equal(matchesPrefix('budi', 'udi'), false);
    assert.equal(matchesPrefix('budi', ''), true);
  });
  it('shows the count, the countdown and the daily limit', () => {
    assert.equal(stickerButtonLabel(0, 3, 0), 'Sticker');
    assert.equal(stickerButtonLabel(1, 3, 4), 'Wait 4 s');
    assert.equal(stickerButtonLabel(2, 3, 0), 'Sticker 2/3');
    assert.equal(stickerButtonLabel(3, 3, 0), 'Sent 3/3 today');
    assert.equal(stickerButtonLabel(1, 1, 0), 'Sent');
  });
});

describe('Set up Shop window', async () => {
  const { nearFromYocto, shopSetupText } = await import('../src/shop-setup.ts');
  it('shows the allowance from the server in NEAR and Ardian\'s wording', () => {
    assert.equal(nearFromYocto('10000000000000000000000'), '0.01');
    assert.equal(nearFromYocto('1000000000000000000000000'), '1');
    assert.equal(nearFromYocto('not a number'), '0.01');
    const t = shopSetupText('10000000000000000000000').join(' ');
    assert.equal(
      t,
      'Your wallet will ask to add a limited game key. It can only spend PANEN in the Shop (burn) and uses at most 0.01 testnet NEAR for gas. Your NEAR and NFTs stay safe. Your wallet may show a red warning; this is expected.',
    );
  });
});
