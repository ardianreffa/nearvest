// Notifications at the top of the garden, just below the HUD. Normal ones ("Watered!", "On NEAR:
// Tree NFT minted · view tx") are ONE thin line; errors (red) and warnings (gold) show their whole
// text on up to four lines, stay 6 s and close with a tap (×). Only one shows at a time: normal
// notices that arrive while one is showing replace it and are counted ("+2 more"); important ones
// (errors, warnings, news from other players) are never lost: they wait their turn and only count
// their time while on screen (toast-queue.ts). Normal ones hide after 3.5 s, and a tap opens the
// transaction when there is one. Nothing ever covers the top HUD, the
// bottom panel, the tab bar or the side menu (normal lines also keep clear of TaniBot and the
// plots); while a window is open it moves to free room above or below the window, or waits hidden.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Sprite } from './sprites';
import { dueIn, EMPTY, hideToast, isAlert, nextToast, pushToast, unhideToast, type Shown, type Toast, type ToastQueue } from './toast-queue';

export type { Toast } from './toast-queue';

/** The toast() function and the strip that shows it (rules: toast-queue.ts). */
export function useToasts() {
  const [q, setQ] = useState<ToastQueue>(EMPTY);
  const toast = useCallback((t: Omit<Toast, 'id'>) => setQ((cur) => pushToast(cur, { ...t, id: Math.random() }, Date.now())), []);
  // One timer for whatever is due next (none while an important notice waits hidden).
  useEffect(() => {
    const ms = dueIn(q, Date.now());
    if (ms === null) return;
    const id = window.setTimeout(() => setQ((cur) => nextToast(cur, Date.now())), ms);
    return () => window.clearTimeout(id);
  }, [q]);
  const dismiss = useCallback(() => setQ((cur) => nextToast(cur, Date.now())), []);
  /** The strip reports whether it found room on screen. */
  const setHidden = useCallback((hidden: boolean) => setQ((cur) => (hidden ? hideToast(cur, Date.now()) : unhideToast(cur, Date.now()))), []);
  return { toast, shown: q.shown, dismiss, setHidden };
}

type Rect = { top: number; bottom: number; left: number; right: number; width: number };

/** Where the strip may go: below the HUD, left of an open side menu; around an open window. */
function placeStrip(h: number, alert = false): { top: number; left: number; width: number } | null {
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
  // Alerts may cover the village scene (they must be read) but never the panels.
  const keepClear = [...document.querySelectorAll(alert ? '.garden-sheet, .hud-bar, .tabs, .coach-float .coach' : '.bot-spot .tanibot, .plot-art, .soil, .garden-sheet, .hud-bar, .tabs, .coach-float .coach')]
    .map((e) => e.getBoundingClientRect())
    .filter((r) => r.width && r.height);
  const free = (top: number) => top + h <= H && !keepClear.some((r) => left < r.right && r.left < left + width && top < r.bottom && r.top < top + h);
  // Below the HUD; with the tutorial bubble there, just below the bubble; else the very top.
  const coach = [...document.querySelectorAll('.coach-float .coach')].map((e) => e.getBoundingClientRect()).find((r) => r.height);
  for (const top of [below, ...(coach ? [Math.round(coach.bottom + 6)] : [])]) if (free(top)) return { top, left, width };
  // An alert never goes over the top HUD: just below it, even when that covers part of the scene.
  return { top: alert ? below : safeTop, left, width };
}

export function ToastStrip({ shown, dismiss, setHidden }: { shown: Shown | null; dismiss: () => void; setHidden: (hidden: boolean) => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    const update = () => setPos((p) => {
      const next = placeStrip(el.current?.offsetHeight || 30, !!shown && (isAlert(shown.toast.kind) || !!shown.toast.actions?.length));
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
  // No room (a window covers the strip): important notices stop their clock until there is room.
  const hidden = !!shown && !pos;
  useEffect(() => {
    if (shown) setHidden(hidden);
  }, [hidden, shown?.toast.id, setHidden]);
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
      {isAlert(t.kind) && (
        <span class="toast-x" aria-hidden="true">
          ×
        </span>
      )}
      {t.actions?.length ? (
        <span class="toast-actions">
          {t.actions.map((a) => (
            <button
              key={a.label}
              class="btn btn-small toast-action"
              onClick={(e) => {
                e.stopPropagation();
                dismiss();
                a.run();
              }}
            >
              {a.label}
            </button>
          ))}
        </span>
      ) : null}
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
        <div
          ref={el}
          key={t.id}
          class={`toast toast-${t.kind}${isAlert(t.kind) ? ' toast-alert' : ''}${t.actions?.length ? ' toast-with-actions' : ''}`}
          style={style}
          onClick={dismiss}
          role={isAlert(t.kind) ? 'alert' : undefined}
          title={isAlert(t.kind) ? 'Tap to close' : undefined}
        >
          {body}
        </div>
      )}
    </div>
  );
}
