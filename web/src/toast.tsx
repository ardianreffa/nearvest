// Notifications ("Watered!", "On NEAR: Tree NFT minted · view tx", errors) as ONE thin line at the
// top of the garden, just below the HUD. Only one shows at a time: notices that arrive while one is
// showing replace it and are counted ("+2 more"). It hides by itself after 3.5 s (errors 5 s), and a
// tap opens the transaction when there is one. It never covers TaniBot, the plots, the bottom
// panel, the tab bar or the side menu; while a window is open it moves to free room above or below
// the window, or waits hidden until the window closes.

import { useCallback, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sprite } from './sprites';

export interface Toast {
  id: number;
  kind: 'info' | 'error' | 'chain' | 'success';
  text: string;
  link?: string;
}

interface Shown {
  toast: Toast;
  /** Notices merged into this one (arrived while it was showing). */
  more: number;
  until: number;
}

const LIFE_MS = 3500;
const ERROR_MS = 5000;

/** The toast() function and the strip that shows it. */
export function useToasts() {
  const [shown, setShown] = useState<Shown | null>(null);
  const timer = useRef(0);
  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const life = t.kind === 'error' ? ERROR_MS : LIFE_MS;
    setShown((cur) => ({
      toast: { ...t, id: Math.random() },
      more: cur && cur.until > Date.now() ? cur.more + 1 : 0,
      until: Date.now() + life,
    }));
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setShown(null), life);
  }, []);
  return { toast, shown, dismiss: () => setShown(null) };
}

type Rect = { top: number; bottom: number; left: number; right: number; width: number };

/** Where the strip may go: below the HUD, left of an open side menu; around an open window. */
function placeStrip(h: number): { top: number; left: number; width: number } | null {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const safeTop = 6;
  let right = W;
  for (const el of document.querySelectorAll('.hud-drawer, .hud-rail')) {
    const r = el.getBoundingClientRect();
    if (r.width && r.left > W / 2) right = Math.min(right, r.left);
  }
  const width = Math.min(440, right - 24);
  const left = Math.round((right - width) / 2);
  const dialog = [...document.querySelectorAll('.dialog-backdrop > *')].map((e) => e.getBoundingClientRect() as Rect).filter((r) => r.width)[0];
  if (dialog) {
    if (dialog.top - safeTop - 6 >= h) return { top: Math.max(safeTop, dialog.top - h - 8), left: Math.round((W - Math.min(440, W - 24)) / 2), width: Math.min(440, W - 24) };
    if (H - dialog.bottom - 6 >= h + 6) return { top: dialog.bottom + 8, left: Math.round((W - Math.min(440, W - 24)) / 2), width: Math.min(440, W - 24) };
    return null;
  }
  // Below the top HUD (phone: the top bar and the chips row; laptop: the status capsules). If that
  // spot would cover TaniBot, a plot or a panel (short gardens, phones held sideways), the very top
  // of the screen over the HUD is used instead.
  let below = safeTop;
  for (const el of document.querySelectorAll('.topbar, .hud-chips, .hud-top .hud-capsule, .hud-sys, .notice')) {
    const r = el.getBoundingClientRect();
    if (r.height && r.top < H / 3) below = Math.max(below, r.bottom + 6);
  }
  const keepClear = [...document.querySelectorAll('.bot-spot .tanibot, .plot-art, .soil, .garden-sheet, .hud-bar, .tabs, .coach-float .coach')]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  const free = (top: number) => top + h <= H && !keepClear.some((r) => left < r.right && r.left < left + width && top < r.bottom && r.top < top + h);
  // Below the HUD; with the tutorial bubble there, just below the bubble; else the very top.
  const coach = [...document.querySelectorAll('.coach-float .coach')].map((e) => e.getBoundingClientRect()).find((r) => r.height);
  for (const top of [below, ...(coach ? [Math.round(coach.bottom + 6)] : [])]) if (free(top)) return { top, left, width };
  return { top: safeTop, left, width };
}

export function ToastStrip({ shown, dismiss }: { shown: Shown | null; dismiss: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    const update = () => setPos((p) => {
      const next = placeStrip(el.current?.offsetHeight || 30);
      return p && next && p.top === next.top && p.left === next.left && p.width === next.width ? p : next;
    });
    update();
    const t = window.setInterval(update, 300);
    window.addEventListener('resize', update);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('resize', update);
    };
  }, [shown]);
  if (!shown) return <div class="toasts" role="status" aria-live="polite" />;
  const t = shown.toast;
  const body = (
    <>
      {t.kind === 'chain' && <Sprite name="bolt" scale={1} />}
      {t.kind === 'success' && (
        <b class="toast-check" aria-hidden="true">
          ✓
        </b>
      )}
      <span class="toast-text">
        {t.kind === 'chain' ? 'On NEAR: ' : ''}
        {t.text}
      </span>
      {shown.more > 0 && <span class="toast-more">+{shown.more} more</span>}
      {t.link && <span class="toast-tx">view tx ›</span>}
    </>
  );
  const style = pos ? { top: `${pos.top}px`, left: `${pos.left}px`, width: `${pos.width}px` } : { visibility: 'hidden' as const, top: '0px', left: '0px' };
  return (
    <div class="toasts" role="status" aria-live="polite">
      {t.link ? (
        <a ref={el as never} key={t.id} class={`toast toast-${t.kind}`} style={style} href={t.link} target="_blank" rel="noreferrer" onClick={dismiss}>
          {body}
        </a>
      ) : (
        <div ref={el} key={t.id} class={`toast toast-${t.kind}`} style={style} onClick={dismiss}>
          {body}
        </div>
      )}
    </div>
  );
}
