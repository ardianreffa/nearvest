// Referral on the web (docs/PLAN-social.md section 3): an invite link `<site>/?ref=<garden name>`
// is kept in localStorage for 7 days (the landing page's inline script in index.html stores the
// same JSON), then sent with the NEW garden (POST /api/player). The server checks every rule and
// pays after the friend's first harvest. Pure helpers here (tested in web/test/referral.test.ts).
// The invite must survive the whole way to a new garden: the landing page carries it in its links to
// /play (withRef), /play keeps it and takes it out of the address bar, and Google (also the iPhone
// full-page redirect) and wallet sign-in leave localStorage alone, so the create screen still reads it.

export const REF_KEY = 'nearvest.ref';
/** An invite link is remembered this long. */
export const REF_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** A garden name from a query string (`?ref=Sari` -> 'sari'), or null. */
export function parseRef(search: string): string | null {
  const r = new URLSearchParams(search).get('ref')?.trim().toLowerCase() ?? '';
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(r) ? r : null;
}

/** Remembers the invite of a link (the newest link wins). */
export function keepRef(store: Store, ref: string, now: number): void {
  try {
    store.setItem(REF_KEY, JSON.stringify({ ref, at: now }));
  } catch {
    // Storage blocked: the invite works only if the garden is made in this page view.
  }
}

/** The kept invite, if it is younger than 7 days (older ones are dropped). */
export function readRef(store: Store, now: number): string | null {
  try {
    const raw = store.getItem(REF_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { ref?: unknown; at?: unknown };
    const ref = typeof v.ref === 'string' ? parseRef(`?ref=${encodeURIComponent(v.ref)}`) : null;
    if (ref && typeof v.at === 'number' && now - v.at >= 0 && now - v.at < REF_KEEP_MS) return ref;
    store.removeItem(REF_KEY);
  } catch {
    // Broken value or storage blocked: no invite.
  }
  return null;
}

export function clearRef(store: Store): void {
  try {
    store.removeItem(REF_KEY);
  } catch {
    // Storage blocked.
  }
}

/** Keeps `?ref=` of the current page (call once at start). */
export function keepRefFromUrl(search: string, store: Store, now: number): void {
  const ref = parseRef(search);
  if (ref) keepRef(store, ref, now);
}

/** The public site: invite links of production builds always point here (not a Vercel preview URL). */
export const PUBLIC_SITE = 'https://nearvest-six.vercel.app';

/** Where invite links point: the public site, or this page's origin in dev builds. */
export function inviteOrigin(dev: boolean, origin: string): string {
  return dev ? origin : PUBLIC_SITE;
}

/** The invite link of a garden: the landing page with ?ref=<name>. */
export function inviteLink(origin: string, name: string): string {
  return `${origin.replace(/\/+$/, '')}/?ref=${encodeURIComponent(name)}`;
}

/** A link (`/play`, `/play?judge=1`) with the invite added, so it still works where storage is blocked. */
export function withRef(href: string, ref: string | null): string {
  if (!ref) return href;
  const hashAt = href.indexOf('#');
  const base = hashAt < 0 ? href : href.slice(0, hashAt);
  const hash = hashAt < 0 ? '' : href.slice(hashAt);
  const [path, query = ''] = base.split('?');
  const q = new URLSearchParams(query);
  q.set('ref', ref);
  return `${path}?${q}${hash}`;
}

/** A query string without `ref` ('' when nothing is left), for cleaning the address bar. */
export function withoutRef(search: string): string {
  const q = new URLSearchParams(search);
  q.delete('ref');
  const s = q.toString();
  return s ? `?${s}` : '';
}

/** The post text for "Share on X" (the link goes in the url field). */
export function invitePost(name: string): string {
  return `Come farm with me in NEARvest, a pixel farming game on NEAR: your tree is a living NFT. Join from my link and we both get PANEN after your first harvest. Garden: ${name} @NEARProtocol #NEARHackathon`;
}

/** Ids not seen yet (notices for new stickers / paid referrals), and the new "seen" value to store. */
export function freshIds(ids: number[], seen: number): { fresh: number[]; seen: number } {
  const fresh = ids.filter((id) => id > seen);
  return { fresh, seen: Math.max(seen, ...ids) };
}

/** Farmer search: the name starts with the query (any case, spaces around ignored), like the server. */
export function matchesPrefix(name: string, q: string): boolean {
  return name.toLowerCase().startsWith(q.trim().toLowerCase());
}

/**
 * The visit panel's sticker button: "Sticker", "Sticker 1/3", "Wait 4 s" (5 s between stickers),
 * "Sent 3/3 today" (older servers allow 1 a day: "Sent").
 */
export function stickerButtonLabel(sent: number, max: number, waitS: number): string {
  if (sent >= max) return max > 1 ? `Sent ${max}/${max} today` : 'Sent';
  if (waitS > 0) return `Wait ${waitS} s`;
  return sent ? `Sticker ${sent}/${max}` : 'Sticker';
}
