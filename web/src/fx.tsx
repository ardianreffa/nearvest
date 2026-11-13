// "Juice" effects layer: floating numbers, coins flying to the balance,
// burn flames, leaf bursts and level-up confetti. Pure CSS animations
// (transform/opacity only) so they stay smooth on phones.

import { useEffect, useState } from 'preact/hooks';
import { Sprite, type SpriteName } from './sprites';
import { PanenCoin } from './art/panen-coin';

type Effect =
  | { id: number; kind: 'text'; x: number; y: number; text: string; tone: 'gold' | 'mint' | 'burn' | 'xp' }
  | { id: number; kind: 'coin'; x: number; y: number; dx: number; dy: number; delay: number }
  | { id: number; kind: 'fruit'; x: number; y: number; dx: number; dy: number; delay: number; sprite: SpriteName; scale: number }
  | { id: number; kind: 'fire'; x: number; y: number }
  | { id: number; kind: 'leaf'; x: number; y: number; dx: number; dy: number; rot: number; delay: number }
  | { id: number; kind: 'confetti'; x: number; dx: number; color: string; delay: number; rot: number };

const LIFETIME: Record<Effect['kind'], number> = { text: 1400, coin: 1100, fruit: 1000, fire: 1000, leaf: 1100, confetti: 2400 };

let nextId = 1;
const listeners = new Set<(e: Effect[]) => void>();
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function emit(effects: Effect[]) {
  for (const l of listeners) l(effects);
}

/** Last pointer position, used as the origin of effects for button actions. */
export const pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
window.addEventListener('pointerdown', (e) => {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
});

export function floatText(text: string, tone: 'gold' | 'mint' | 'burn' | 'xp' = 'gold', x = pointer.x, y = pointer.y) {
  emit([{ id: nextId++, kind: 'text', x, y: y - 10, text, tone }]);
}

export function coinsToBalance(count = 6, x = pointer.x, y = pointer.y) {
  if (reduced()) return;
  // Into the round PANEN coin inside the profile box.
  const target = (document.querySelector('.hud-panen .panen-coin') ?? document.querySelector('.hud-panen'))?.getBoundingClientRect();
  if (!target) return;
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  emit(
    Array.from({ length: Math.min(count, 10) }, (_, i) => ({
      id: nextId++,
      kind: 'coin' as const,
      x: x + (Math.random() - 0.5) * 30,
      y: y + (Math.random() - 0.5) * 20,
      dx: tx - x,
      dy: ty - y,
      delay: i * 60,
    })),
  );
}

/** Where harvested fruit goes: the Storage tab (phones), the Storage drawer tab or rail icon (laptops). */
function storageTarget(): DOMRect | null {
  for (const sel of ['.tabs .tab-storage .tab-icon', '.side-tabs .tab-storage', '.rail-storage']) {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    if (r && r.width > 0 && r.height > 0) return r;
  }
  return null;
}

/**
 * Harvest: the fruit jumps off the tree and flies into the Storage icon / tab (Ardian 2026-11-13: no
 * basket any more; it stayed behind at the tree's foot on iPhone). Lives in the effects layer, which
 * removes each element by a timer, and the flight ends invisible, so nothing is ever left in the garden.
 * No Storage icon on screen: the fruit rises a little and fades. Reduced motion: none.
 */
export function fruitsToStorage(sprite: SpriteName, x: number, y: number, count = 3, scale = 2) {
  if (reduced()) return;
  const t = storageTarget();
  const tx = t ? t.left + t.width / 2 : x;
  const ty = t ? t.top + t.height / 2 : y - 70;
  emit(
    Array.from({ length: Math.min(count, 5) }, (_, i) => {
      const sx = x + (i - (count - 1) / 2) * 12;
      return { id: nextId++, kind: 'fruit' as const, x: sx, y, dx: tx - sx, dy: ty - y, delay: 200 + i * 110, sprite, scale };
    }),
  );
}

export function burnAt(x = pointer.x, y = pointer.y) {
  if (reduced()) return;
  emit([{ id: nextId++, kind: 'fire', x, y }]);
}

export function leafBurst(x: number, y: number, count = 10) {
  if (reduced()) return;
  emit(
    Array.from({ length: count }, (_, i) => ({
      id: nextId++,
      kind: 'leaf' as const,
      x,
      y,
      dx: (Math.random() - 0.5) * 120,
      dy: -30 - Math.random() * 60,
      rot: (Math.random() - 0.5) * 360,
      delay: i * 25,
    })),
  );
}

/** Palette tokens (styles.css): mint, cyan, gold, purple, red, paper-light. */
const CONFETTI_COLORS = ['var(--mint-500)', 'var(--cyan-500)', 'var(--gold-500)', 'var(--purple-500)', 'var(--red-500)', 'var(--paper-light)'];
export function confetti(count = 48) {
  if (reduced()) return;
  emit(
    Array.from({ length: count }, (_, i) => ({
      id: nextId++,
      kind: 'confetti' as const,
      x: Math.random() * window.innerWidth,
      dx: (Math.random() - 0.5) * 80,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      delay: Math.random() * 400,
      rot: Math.random() * 720,
    })),
  );
}

export function FxLayer() {
  const [effects, setEffects] = useState<Effect[]>([]);
  useEffect(() => {
    const add = (list: Effect[]) => {
      setEffects((cur) => [...cur, ...list].slice(-80));
      const maxLife = Math.max(...list.map((e) => LIFETIME[e.kind] + ('delay' in e ? e.delay : 0)));
      const ids = new Set(list.map((e) => e.id));
      setTimeout(() => setEffects((cur) => cur.filter((e) => !ids.has(e.id))), maxLife + 50);
    };
    listeners.add(add);
    return () => listeners.delete(add);
  }, []);

  return (
    <div class="fx-layer" aria-hidden="true">
      {effects.map((e) => {
        switch (e.kind) {
          case 'text':
            return (
              <span key={e.id} class={`fx-text tone-${e.tone}`} style={{ left: e.x, top: e.y }}>
                {e.text}
              </span>
            );
          case 'coin':
            return (
              <span
                key={e.id}
                class="fx-coin"
                style={{ left: e.x, top: e.y, '--dx': `${e.dx}px`, '--dy': `${e.dy}px`, animationDelay: `${e.delay}ms` }}
              >
                <PanenCoin scale={1} />
              </span>
            );
          case 'fruit':
            return (
              <span
                key={e.id}
                class="fx-fruit"
                style={{ left: e.x, top: e.y, '--dx': `${e.dx}px`, '--dy': `${e.dy}px`, animationDelay: `${e.delay}ms` }}
              >
                <Sprite name={e.sprite} scale={e.scale} />
              </span>
            );
          case 'fire':
            return (
              <span key={e.id} class="fx-fire" style={{ left: e.x, top: e.y }}>
                <Sprite name="fire" scale={4} />
              </span>
            );
          case 'leaf':
            return (
              <span
                key={e.id}
                class="fx-leaf"
                style={{ left: e.x, top: e.y, '--dx': `${e.dx}px`, '--dy': `${e.dy}px`, '--rot': `${e.rot}deg`, animationDelay: `${e.delay}ms` }}
              />
            );
          case 'confetti':
            return (
              <span
                key={e.id}
                class="fx-confetti"
                style={{ left: e.x, background: e.color, '--dx': `${e.dx}px`, '--rot': `${e.rot}deg`, animationDelay: `${e.delay}ms` }}
              />
            );
        }
      })}
    </div>
  );
}
