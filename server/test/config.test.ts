// Server configuration defaults (Ardian 2026-11-12): new gardens start in demo mode unless
// DEMO_MODE_DEFAULT says otherwise; judges must not wait days.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../src/config.ts';

function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T): T {
  const old: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    old[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('config', () => {
  const base = { CHAIN_MODE: 'fake', MASTER_KEY: randomBytes(32).toString('base64') };
  it('new gardens default to demo mode when DEMO_MODE_DEFAULT is not set (or empty)', () => {
    assert.equal(withEnv({ ...base, DEMO_MODE_DEFAULT: undefined }, () => loadConfig().demoModeDefault), true);
    assert.equal(withEnv({ ...base, DEMO_MODE_DEFAULT: '' }, () => loadConfig().demoModeDefault), true);
  });
  it('DEMO_MODE_DEFAULT=false turns it back off', () => {
    assert.equal(withEnv({ ...base, DEMO_MODE_DEFAULT: 'false' }, () => loadConfig().demoModeDefault), false);
  });
});
