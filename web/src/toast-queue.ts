// The rules of the notice strip (toast.tsx), without any screen code so they can be tested.
//
// Important notices (`long`: news from other players such as a duel received, a sticker, a friend
// watering; and errors / warnings) must never get lost:
// - their time only runs while they are really on screen (a big window can hide the strip: then
//   the notice waits and shows its full time once there is room again);
// - a newer notice never wipes one out: a second important one waits in a queue, and a normal one
//   ("Watered!", "On NEAR: ...") may show at once, but the important one comes back after it.
// Normal notices behave as before: 3.5 s, replaced by the next one ("+1 more").

export interface Toast {
  id: number;
  kind: 'info' | 'warn' | 'error' | 'chain' | 'success';
  text: string;
  link?: string;
  /** Stays as long as an alert and is never lost (news the player should not miss). */
  long?: boolean;
  /** Buttons on the notice (e.g. "Add back" / "Visit"); a tap runs one and closes the notice. */
  actions?: { label: string; run: () => void }[];
}

export interface Shown {
  toast: Toast;
  /** Notices merged into this one (arrived while it was showing). */
  more: number;
  /** When it hides (ms), or null while it waits hidden (then `left` ms remain). */
  until: number | null;
  left: number;
}

export interface ToastQueue {
  shown: Shown | null;
  /** Important notices waiting for their turn (oldest first). */
  waiting: Toast[];
}

export const LIFE_MS = 3500;
/** Errors, warnings and important news: long enough to read two or three lines. */
export const ERROR_MS = 6000;
/** At most this many important notices wait; older ones beyond it are dropped. */
export const MAX_WAITING = 5;

export const isAlert = (kind: Toast['kind']) => kind === 'error' || kind === 'warn';
export const isImportant = (t: Toast) => isAlert(t.kind) || !!t.long;
const lifeOf = (t: Toast) => (isImportant(t) ? ERROR_MS : LIFE_MS);

export const EMPTY: ToastQueue = { shown: null, waiting: [] };

const show = (t: Toast, now: number, more = 0): Shown => ({ toast: t, more, until: now + lifeOf(t), left: lifeOf(t) });

/** Is the shown notice still within its time? (A hidden one that waits always is.) */
const alive = (s: Shown | null, now: number): s is Shown => !!s && (s.until === null || s.until > now);

/** A new notice arrives. */
export function pushToast(q: ToastQueue, t: Toast, now: number): ToastQueue {
  const cur = alive(q.shown, now) ? q.shown : null;
  if (!cur) return { shown: show(t, now), waiting: q.waiting };
  if (isImportant(cur.toast)) {
    // Another important one waits its turn; a normal one shows now and the important one comes back.
    if (isImportant(t)) return { shown: cur, waiting: [...q.waiting, t].slice(-MAX_WAITING) };
    return { shown: show(t, now), waiting: [cur.toast, ...q.waiting].slice(0, MAX_WAITING) };
  }
  // A normal notice on screen: replaced, counted as "+n more" (as before).
  return { shown: show(t, now, cur.more + 1), waiting: q.waiting };
}

/** Time is up (or the player tapped it away): the next waiting notice, if any. */
export function nextToast(q: ToastQueue, now: number): ToastQueue {
  const [t, ...rest] = q.waiting;
  return { shown: t ? show(t, now) : null, waiting: rest };
}

/** The strip could not find room (a window covers it): an important notice stops its clock. */
export function hideToast(q: ToastQueue, now: number): ToastQueue {
  const s = q.shown;
  if (!s || s.until === null || !isImportant(s.toast)) return q;
  return { ...q, shown: { ...s, until: null, left: Math.max(0, s.until - now) } };
}

/** There is room again: a waiting important notice shows its full time (it was never read). */
export function unhideToast(q: ToastQueue, now: number): ToastQueue {
  const s = q.shown;
  if (!s || s.until !== null) return q;
  return { ...q, shown: { ...s, until: now + lifeOf(s.toast), left: lifeOf(s.toast) } };
}

/** When the next change is due (ms from `now`), or null when nothing is timed. */
export function dueIn(q: ToastQueue, now: number): number | null {
  const s = q.shown;
  if (!s || s.until === null) return null;
  return Math.max(0, s.until - now);
}
