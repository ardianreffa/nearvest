// Order of the Memorial Trees list in the Village tab (panels.tsx MemorialList).

import type { MemorialView } from './api';

/** Memorial Trees still standing on a plot first, then the newest (latest death first). */
export function sortMemorials(list: MemorialView[]): MemorialView[] {
  return [...list].sort((a, b) => {
    const standing = Number(b.plot !== null) - Number(a.plot !== null);
    if (standing) return standing;
    const died = (b.diedAt ?? 0) - (a.diedAt ?? 0);
    return died || b.id - a.id;
  });
}
