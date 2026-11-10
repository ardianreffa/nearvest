// Referral on the web (docs/PLAN-social.md section 3): an invite link `<site>/?ref=<garden name>`
// is kept in localStorage for 7 days (the landing page's inline script in index.html stores the
// same JSON), then sent with the NEW garden (POST /api/player). The server checks every rule and
// pays after the friend's first harvest. Pure helpers here (tested in web/test/referral.test.ts).

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

/** The invite link of a garden: the landing page with ?ref=<name>. */
export function inviteLink(origin: string, name: string): string {
  return `${origin.replace(/\/+$/, '')}/?ref=${encodeURIComponent(name)}`;
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
