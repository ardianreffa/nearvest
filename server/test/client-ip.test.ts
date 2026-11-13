// The player's IP (client-ip.ts): only the last X-Forwarded-For entry (the one Caddy writes)
// counts; a visitor's own CF-Connecting-IP or X-Forwarded-For entries never change it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { clientIpFrom } from '../src/client-ip.ts';
import { GARDENS_PER_IP_PER_DAY } from '../src/rules.ts';
import { makeWorld } from './helpers.ts';

const from = (h: Record<string, string>, trustCfIp = false) =>
  clientIpFrom((name) => Object.entries(h).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1], { trustCfIp });

describe('client IP', () => {
  it('uses the last X-Forwarded-For entry; faked entries in front and CF-Connecting-IP are ignored', () => {
    assert.equal(from({ 'X-Forwarded-For': '203.0.113.7' }), '203.0.113.7');
    assert.equal(from({ 'X-Forwarded-For': '1.1.1.1, 2.2.2.2, 203.0.113.7' }), '203.0.113.7');
    assert.equal(from({ 'X-Forwarded-For': '203.0.113.7', 'CF-Connecting-IP': '9.9.9.9' }), '203.0.113.7');
    assert.equal(from({ 'CF-Connecting-IP': '9.9.9.9' }), null);
    assert.equal(from({ 'X-Forwarded-For': '2001:db8::1' }), '2001:db8::1');
    assert.equal(from({ 'X-Forwarded-For': '1.2.3.4, not-an-ip' }), null);
    assert.equal(from({}), null);
  });

  it('TRUST_CF_IP=on reads CF-Connecting-IP first (only behind Cloudflare)', () => {
    assert.equal(from({ 'X-Forwarded-For': '203.0.113.7', 'CF-Connecting-IP': '9.9.9.9' }, true), '9.9.9.9');
    assert.equal(from({ 'X-Forwarded-For': '203.0.113.7', 'CF-Connecting-IP': 'junk' }, true), '203.0.113.7');
  });

  it('HTTP: a visitor faking CF-Connecting-IP or X-Forwarded-For still counts as the IP Caddy saw', async () => {
    const w = makeWorld();
    const caddy = '198.51.100.20';
    for (let i = 0; i < GARDENS_PER_IP_PER_DAY; i++) {
      const fake = `10.9.${i}.1`;
      // As Caddy would forward it with trusted_proxies set: the visitor's fake entry, then the real address.
      const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': fake, 'X-Forwarded-For': `${fake}, ${caddy}` };
      const login = await w.app.request('/auth/dev', { method: 'POST', headers, body: JSON.stringify({ username: `u${i}` }) });
      const { token } = (await login.json()) as { token: string };
      const res = await w.app.request('/api/player', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: `farm${i}` }) });
      assert.equal(res.status, 201);
    }
    const ips = w.db.prepare('SELECT DISTINCT created_ip AS ip FROM players').all() as { ip: string }[];
    assert.deepEqual(ips.map((r) => r.ip), [caddy]);

    // The next garden from the same real address is refused, whatever the visitor fakes.
    const headers = { 'Content-Type': 'application/json', 'CF-Connecting-IP': '10.99.0.1', 'X-Forwarded-For': `10.99.0.1, ${caddy}` };
    const login = await w.app.request('/auth/dev', { method: 'POST', headers, body: JSON.stringify({ username: 'late' }) });
    const { token } = (await login.json()) as { token: string };
    const res = await w.app.request('/api/player', { method: 'POST', headers: { ...headers, Authorization: `Bearer ${token}` }, body: JSON.stringify({ name: 'farmlate' }) });
    assert.equal(res.status, 429);
    assert.equal(((await res.json()) as { code: string }).code, 'gardens_limit');
  });
});
