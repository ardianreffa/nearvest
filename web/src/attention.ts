// "Look here" for a tab that was opened by its red dot (Ardian, 2026-11-10): the rows to act on
// glow for about 2 seconds (still, without animation, with reduced motion) and the first one is
// scrolled into view when it is not on screen.

import { useEffect, useState } from 'preact/hooks';

export const ATTENTION_MS = 2000;

/** The last `focus` value handled per screen (kept across remounts, so reopening a tab does not glow again). */
const handled: Record<string, number> = {};

/** True for ATTENTION_MS after `focus` grows (once per value); `onStart` runs right after the glow renders. */
export function useAttention(name: string, focus: number, onStart?: () => void): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (focus <= (handled[name] ?? 0)) return;
    handled[name] = focus;
    setOn(true);
    const raf = requestAnimationFrame(() => onStart?.());
    const t = window.setTimeout(() => setOn(false), ATTENTION_MS);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t);
    };
  }, [focus]);
  return on;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

function scrollBox(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    const y = getComputedStyle(p).overflowY;
    if ((y === 'auto' || y === 'scroll') && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** Scrolls `el` to the middle of its scroll box when it is not fully on screen (a margin for the HUD and the tabs). */
export function revealIfHidden(el: Element | null | undefined, margin = 64): void {
  if (!(el instanceof HTMLElement)) return;
  const r = el.getBoundingClientRect();
  const box = scrollBox(el)?.getBoundingClientRect();
  const top = Math.max(box?.top ?? 0, 0) + margin;
  const bottom = Math.min(box?.bottom ?? window.innerHeight, window.innerHeight) - margin;
  if (r.top >= top && r.bottom <= bottom) return;
  el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
}

/** Scrolls a section's top into view (the Market's "Seeds (17) ↓" link). */
export function jumpTo(el: Element | null | undefined): void {
  if (el instanceof HTMLElement) el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
}
