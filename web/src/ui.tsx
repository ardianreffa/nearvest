// Shared UI pieces: tree and fruit art, labels, formatting.

import type { ComponentChildren } from 'preact';
import type { Quality, Species, Stage } from './api';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { clampQty, keepPick, saleTotal, seasonPayout, stepQty } from './qty';
import { Sprite } from './sprites';
import { PanenCoin } from './art/panen-coin';

export const SPECIES_NAME: Record<Species, string> = { mango: 'Mango', rambutan: 'Rambutan', durian: 'Durian' };
export const QUALITY_NAME: Record<Quality, string> = { common: 'Common', rare: 'Rare', gold: 'Gold' };
export const STAGE_NAME: Record<Stage, string> = {
  seed: 'Seed',
  sprout: 'Sprout',
  tree: 'Tree',
  fruiting: 'Fruiting',
  old: 'Old',
};

export function FruitIcon({ species, scale = 3 }: { species: Species; scale?: number }) {
  return <Sprite name={species} scale={scale} title={SPECIES_NAME[species]} />;
}

export function QualityTag({ quality, short = false }: { quality: Quality | null; short?: boolean }) {
  if (!quality)
    return short ? (
      <span class="tag tag-unknown" title="Revealed when planted">
        Unknown
      </span>
    ) : (
      <span class="tag tag-unknown">Revealed when planted</span>
    );
  return <span class={`tag tag-${quality}`}>{QUALITY_NAME[quality]}</span>;
}

export interface SeedGroup {
  key: string;
  species: Species;
  quality: Quality | null;
  fromTree: boolean;
  /** Where the seeds came from (only when grouped by source). */
  source?: string;
  ids: number[];
}

/** Stacks identical seeds ("Mango seed x7"). Seeds from old trees stay separate (lineage). */
export function groupSeeds(
  seeds: { id: number; species: Species; quality: Quality | null; parentTreeId: number | null; source?: string }[],
  bySource = false,
): SeedGroup[] {
  const groups = new Map<string, SeedGroup>();
  for (const s of seeds) {
    const fromTree = s.parentTreeId !== null;
    const source = bySource ? (fromTree ? 'tree' : (s.source ?? 'shop')) : undefined;
    const key = `${s.species}|${s.quality ?? 'unknown'}|${fromTree ? 'tree' : 'plain'}|${source ?? ''}`;
    const g = groups.get(key) ?? { key, species: s.species, quality: s.quality, fromTree, source, ids: [] };
    g.ids.push(s.id);
    groups.set(key, g);
  }
  // One fixed order (species, then Gold / Rare / Common / unknown, then from-your-tree, then source),
  // so a row never changes place when seeds come and go.
  const order: Record<Species, number> = { mango: 0, rambutan: 1, durian: 2 };
  const rank = (q: Quality | null) => (q === 'gold' ? 0 : q === 'rare' ? 1 : q === 'common' ? 2 : 3);
  return [...groups.values()].sort(
    (a, b) =>
      order[a.species] - order[b.species] ||
      rank(a.quality) - rank(b.quality) ||
      Number(b.fromTree) - Number(a.fromTree) ||
      (a.source ?? '').localeCompare(b.source ?? ''),
  );
}

export function formatPanen(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

export function Panel({ title, children, right, class: cls }: { title: ComponentChildren; children: ComponentChildren; right?: ComponentChildren; class?: string }) {
  return (
    <section class={`panel${cls ? ` ${cls}` : ''}`}>
      <header class="panel-head">
        <h2>{title}</h2>
        {right}
      </header>
      {children}
    </section>
  );
}

/**
 * The PANEN token icon everywhere (Ardian 2026-11-13): the round gold "P" coin of the HUD's profile box
 * (art/panen-coin.tsx, 13 x 13 art px). `scale` keeps the old 8 px icon's sizes: the coin is drawn at
 * the nearest whole pixel size (1 / 2 -> 13 px, 3 -> 26 px, 5 -> 39 px). Not for the Shop tab icon.
 */
export function Coin({ scale = 2 }: { scale?: number }) {
  return <PanenCoin scale={coinScale(scale)} />;
}

/** Old 8 px icon scale -> whole-pixel scale of the 13 px PANEN coin (about the same size, never 0). */
export function coinScale(old: number): number {
  return Math.max(1, Math.round((old * 8) / 13));
}

/**
 * The amount picked in a quantity picker. It stays the player's while the stock changes (a poll,
 * TaniBot harvesting or selling); when the stock drops below it, it follows the stock down.
 */
export function usePicked(max: number): [number, (value: number) => void] {
  const [picked, setPicked] = useState(1);
  const kept = keepPick(picked, max);
  useEffect(() => {
    if (kept !== picked) setPicked(kept);
  }, [kept, picked]);
  return [clampQty(picked, max), setPicked];
}

/**
 * Quantity picker: - / + buttons, a slider and Max, with the total that follows.
 * The action button gets the chosen amount.
 */
export function QtyPicker({
  max,
  unitPrice,
  multiplier = 1,
  busy,
  actionLabel,
  actionClass = 'btn-gold',
  onAction,
  secondary,
  season,
}: {
  max: number;
  unitPrice: number;
  multiplier?: number;
  /** For sales to Mr. Darto: the total shown is what is really paid in this Season. */
  season?: { number: number; divisor: number; rewardPercent: number };
  busy: boolean;
  actionLabel: string;
  actionClass?: string;
  onAction: (qty: number) => void;
  /** Optional second action with the same amount (e.g. Discard). */
  secondary?: { label: string; onAction: (qty: number) => void };
}) {
  const [qty, setPicked] = usePicked(max);
  const base = saleTotal(unitPrice, multiplier, qty);
  const total = season ? seasonPayout(base, season.divisor) : base;
  return (
    <div class="qty">
      <div class="qty-row">
        <button class="btn btn-small qty-step" aria-label="One less" disabled={busy || qty <= 1} onClick={() => setPicked(stepQty(qty, -1, max))}>
          -
        </button>
        <input
          class="qty-slider"
          type="range"
          min={1}
          max={Math.max(1, max)}
          step={1}
          value={qty}
          disabled={busy || max <= 1}
          aria-label="Amount"
          onInput={(e) => setPicked(Number((e.target as HTMLInputElement).value))}
        />
        <button class="btn btn-small qty-step" aria-label="One more" disabled={busy || qty >= max} onClick={() => setPicked(stepQty(qty, 1, max))}>
          +
        </button>
        <button class="btn btn-small qty-max" disabled={busy || qty >= max} onClick={() => setPicked(max)}>
          Max
        </button>
      </div>
      <div class="qty-row">
        <span class="qty-count">
          x<b>{qty}</b>
        </span>
        {secondary && (
          <button class="btn btn-small" disabled={busy || qty < 1} onClick={() => secondary.onAction(qty)}>
            {secondary.label}
          </button>
        )}
        <button class={`btn btn-small ${actionClass} qty-go`} disabled={busy || qty < 1} onClick={() => onAction(qty)}>
          {actionLabel} · <Coin /> {formatPanen(total)}
        </button>
      </div>
      {season && season.divisor > 1 && (
        <p class="qty-season">
          Season {season.number}: harvest rewards {formatPanen(season.rewardPercent)}%
          {base !== total && <> (before: {formatPanen(base)})</>}
        </p>
      )}
    </div>
  );
}

const SEED_SOURCE: Record<string, string> = {
  tree: 'from your tree',
  checkin: 'check-in',
  welcome: 'welcome pack',
  shop: 'Shop',
  tanibot: 'bought by TaniBot',
};

export const SEED_ODDS_TEXT = 'Quality is revealed when planted: 80% Common, 17% Rare, 3% Gold.';

/** A seed card for planting: big fruit icon, name + amount, quality badge, where it came from. */
/** `compact` (phone plot sheet): a small button with the fruit icon and the count; Rare / Gold show as a coloured dot. */
export function SeedCard({ group, disabled, onPick, compact = false }: { group: SeedGroup; disabled: boolean; onPick: () => void; compact?: boolean }) {
  const q = group.quality;
  const label = `Plant ${q ? QUALITY_NAME[q] + ' ' : ''}${SPECIES_NAME[group.species]} seed (${group.ids.length} in storage)`;
  if (compact) {
    return (
      <button class={`seed-card compact seed-${q ?? 'unknown'}`} disabled={disabled} onClick={onPick} aria-label={label} title={label}>
        <span class="seed-card-icon">
          <FruitIcon species={group.species} scale={3} />
          {(q === 'rare' || q === 'gold') && <i class="seed-dot" aria-hidden="true" />}
        </span>
        <b class="seed-count">x{group.ids.length}</b>
      </button>
    );
  }
  return (
    <button class="seed-card" disabled={disabled} onClick={onPick} aria-label={`Plant ${q ? QUALITY_NAME[q] + ' ' : ''}${SPECIES_NAME[group.species]} seed (${group.ids.length} in storage)`}>
      <span class="seed-card-icon">
        <FruitIcon species={group.species} scale={4} />
      </span>
      <span class="seed-card-name">
        {SPECIES_NAME[group.species]} <b>x{group.ids.length}</b>
      </span>
      <span class={`seed-q seed-q-${q ?? 'unknown'}`} title={q ? undefined : SEED_ODDS_TEXT}>
        {q ? QUALITY_NAME[q] : 'Unknown'}
      </span>
      {group.source && <span class="seed-card-from">{SEED_SOURCE[group.source] ?? group.source}</span>}
    </button>
  );
}

/**
 * One line that never wraps (HUD title + XP, Ardian 2026-11-13): the text steps down through `steps`
 * (font-size tokens, biggest first) until it fits its box; measured again when the box's width changes.
 */
export function FitLine({ text, steps, class: cls }: { text: string; steps: readonly string[]; class?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState(0);
  useLayoutEffect(() => setStep(0), [text, steps.join()]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollWidth > el.clientWidth + 0.5 && step < steps.length - 1) setStep(step + 1);
  }, [step, text, steps.join()]);
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let w = el.clientWidth;
    const ro = new ResizeObserver(() => {
      if (Math.abs(el.clientWidth - w) < 1) return;
      w = el.clientWidth;
      setStep(0);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} class={cls} style={{ fontSize: `var(${steps[Math.min(step, steps.length - 1)]})` }} title={text}>
      {text}
    </div>
  );
}
