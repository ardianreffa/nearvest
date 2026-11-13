// The player's IP address, for every per-IP limit (new gardens, judge gardens, welcome packs,
// referrals, Arena duels, fishing, TaniBot activations, requests per minute).
//
// The server listens only on 127.0.0.1; on the VPS the only way in is Caddy (deploy/Caddyfile).
// Caddy's reverse_proxy (default settings, no `trusted_proxies`) ignores any X-Forwarded-For
// the visitor sent and writes its own with the address of the connection it received. If
// `trusted_proxies` were ever set, Caddy would keep the incoming list and APPEND that address.
// Either way the RIGHTMOST entry is the one Caddy wrote, so that is the only one we use;
// anything a visitor puts in front of it is ignored.
//
// There is no Cloudflare in front of the game (the web calls the VPS directly), so a
// CF-Connecting-IP header can only come from the visitor: it is ignored unless TRUST_CF_IP=on.

import { isIP } from 'node:net';

export function clientIpFrom(header: (name: string) => string | undefined, opts: { trustCfIp?: boolean } = {}): string | null {
  if (opts.trustCfIp) {
    const cf = header('CF-Connecting-IP')?.trim();
    if (cf && isIP(cf)) return cf;
  }
  // Several X-Forwarded-For headers arrive joined with ", "; the last entry is Caddy's.
  const last = header('X-Forwarded-For')?.split(',').at(-1)?.trim();
  return last && isIP(last) ? last : null;
}
