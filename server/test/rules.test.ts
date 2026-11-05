import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { dayIndex, msUntilNextDay } from '../src/clock.ts';
import { decryptSecret, encryptSecret } from '../src/crypto.ts';
import { dailyPrice, priceBounds } from '../src/darto.ts';
import { nameError } from '../src/game.ts';
import { advance, isReady, rollQuality, stageOf, SPECIES_LIST, type TreeGrowth } from '../src/rules.ts';

describe('village clock', () => {
  it('starts a new day at 07:00 WIB (00:00 UTC)', () => {
    const before = Date.UTC(2026, 10, 7, 23, 59, 59); // 06:59:59 WIB on 8 Nov
    const after = Date.UTC(2026, 10, 8, 0, 0, 0); // 07:00 WIB on 8 Nov
    assert.equal(dayIndex(after, false), dayIndex(before, false) + 1);
    assert.equal(msUntilNextDay(before, false), 1000);
  });

  it('demo mode: one day lasts one minute', () => {
    const t = Date.UTC(2026, 10, 7, 1, 0, 0);
    assert.equal(dayIndex(t + 60_000, true), dayIndex(t, true) + 1);
    assert.equal(dayIndex(t + 59_999, true), dayIndex(t, true));
  });
});

describe('Mr. Darto prices', () => {
  it('stay between the seed price and base + 30% on every day', () => {
    for (const species of SPECIES_LIST) {
      const { min, max } = priceBounds(species);
      for (let day = 20_000; day < 20_400; day++) {
        for (const sold of [0, 50, 10_000]) {
          const p = dailyPrice(species, day, sold);
          assert.ok(p.price >= min && p.price <= max, `${species} day ${day}: ${p.price}`);
        }
      }
    }
  });

  it('pay less when many fruits were sold yesterday', () => {
    const calm = dailyPrice('durian', 20_500, 0).price;
    const flooded = dailyPrice('durian', 20_500, 1_000).price;
    assert.ok(flooded <= calm);
  });

  it('are the same for everyone on the same day', () => {
    assert.deepEqual(dailyPrice('mango', 20_123, 3), dailyPrice('mango', 20_123, 3));
  });
});

describe('tree growth', () => {
  const day = 1000;
  const base: TreeGrowth = {
    growth: 0,
    target: 1,
    lastTickMs: 0,
    waterUntilMs: 0,
    fertUntilMs: 0,
    harvestCount: 0,
    maxHarvests: 3,
  };

  it('does not grow without water', () => {
    const g = advance(base, 5 * day, day);
    assert.equal(g.growth, 0);
    assert.equal(stageOf(g), 'seed');
  });

  it('grows while watered and becomes ready', () => {
    let g = advance({ ...base, waterUntilMs: day }, 0.5 * day, day);
    assert.equal(stageOf(g), 'sprout');
    g = advance(g, 2 * day, day); // water ran out at 1 day
    assert.ok(isReady(g));
    assert.equal(stageOf(g), 'fruiting');
  });

  it('fertilizer adds 50% speed', () => {
    const g = advance({ ...base, target: 10, waterUntilMs: day, fertUntilMs: day }, day, day);
    assert.equal(g.growth, 1.5);
  });

  it('is old after the last harvest', () => {
    assert.equal(stageOf({ ...base, harvestCount: 3 }), 'old');
  });
});

describe('seed quality', () => {
  it('follows 80/17/3 odds', () => {
    assert.equal(rollQuality(0.01, null), 'gold');
    assert.equal(rollQuality(0.1, null), 'rare');
    assert.equal(rollQuality(0.5, null), 'common');
  });
  it('a Gold parent raises the Gold chance to 10%', () => {
    assert.equal(rollQuality(0.08, 'gold'), 'gold');
    assert.equal(rollQuality(0.08, null), 'rare');
  });
});

describe('player names', () => {
  it('match the factory contract rules', () => {
    assert.equal(nameError('ardian'), null);
    assert.equal(nameError('budi-99'), null);
    assert.ok(nameError('A'));
    assert.ok(nameError('Ardian'));
    assert.ok(nameError('ar.dian'));
    assert.ok(nameError('ar--dian'));
    assert.ok(nameError('game'));
  });
});

describe('key encryption', () => {
  const key = randomBytes(32).toString('base64');
  it('round-trips', () => {
    const enc = encryptSecret('ed25519:secret', key);
    assert.ok(!enc.includes('secret'));
    assert.equal(decryptSecret(enc, key), 'ed25519:secret');
  });
  it('fails with the wrong master key or tampered data', () => {
    const enc = encryptSecret('ed25519:secret', key);
    assert.throws(() => decryptSecret(enc, randomBytes(32).toString('base64')));
    const parts = enc.split(':');
    parts[3] = Buffer.from('tampered').toString('base64');
    assert.throws(() => decryptSecret(parts.join(':'), key));
  });
});

describe('dev login safety', async () => {
  const { devLoginAllowed, isLocalOnly } = await import('../src/config.ts');
  it('works only with DEV_LOGIN=true on a local-only server', () => {
    assert.equal(devLoginAllowed(true, ['http://localhost:5173']), true);
    assert.equal(devLoginAllowed(true, ['http://127.0.0.1:5173', 'http://localhost:4173']), true);
    assert.equal(devLoginAllowed(false, ['http://localhost:5173']), false);
  });

  it('is switched off automatically as soon as a public site is allowed', () => {
    assert.equal(devLoginAllowed(true, ['http://localhost:5173', 'https://nearvest.vercel.app']), false);
    assert.equal(devLoginAllowed(true, ['https://150-109-24-35.sslip.io']), false);
    assert.equal(isLocalOnly([]), false);
    assert.equal(isLocalOnly(['http://localhost.evil.com']), false);
  });
});
