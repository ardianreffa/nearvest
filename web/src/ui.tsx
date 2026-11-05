// Shared UI pieces: tree and fruit art, labels, formatting.

import type { ComponentChildren } from 'preact';
import type { Quality, Species, Stage } from './api';
import { useState } from 'preact/hooks';
import { clampQty, saleTotal, seasonPayout, stepQty } from './qty';
import { Sprite } from './sprites';

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

export function QualityTag({ quality }: { quality: Quality | null }) {
  if (!quality) return <span class="tag tag-unknown">Revealed when planted</span>;
  return <span class={`tag tag-${quality}`}>{QUALITY_NAME[quality]}</span>;
}

export interface SeedGroup {
  key: string;
  species: Species;
  quality: Quality | null;
  fromTree: boolean;
  ids: number[];
}

/** Stacks identical seeds ("Mango seed x7"). Seeds from old trees stay separate (lineage). */
export function groupSeeds(seeds: { id: number; species: Species; quality: Quality | null; parentTreeId: number | null }[]): SeedGroup[] {
  const groups = new Map<string, SeedGroup>();
  for (const s of seeds) {
    const fromTree = s.parentTreeId !== null;
    const key = `${s.species}|${s.quality ?? 'unknown'}|${fromTree ? 'tree' : 'plain'}`;
    const g = groups.get(key) ?? { key, species: s.species, quality: s.quality, fromTree, ids: [] };
    g.ids.push(s.id);
    groups.set(key, g);
  }
  const order: Record<Species, number> = { mango: 0, rambutan: 1, durian: 2 };
  return [...groups.values()].sort((a, b) => order[a.species] - order[b.species] || (a.quality ? -1 : 1));
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

export function Panel({ title, children, right, class: cls }: { title: string; children: ComponentChildren; right?: ComponentChildren; class?: string }) {
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

export function Coin({ scale = 2 }: { scale?: number }) {
  return <Sprite name="coin" scale={scale} title="PANEN" />;
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
  const [picked, setPicked] = useState(1);
  const qty = clampQty(picked, max);
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
