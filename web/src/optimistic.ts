// Optimistic updates: what the screen can show the moment a button is pressed, before the server
// answers (one or two network round trips, 0.1-2 s on phones). The server's answer always replaces
// this guess a moment later; if the action fails, the game reloads the real state.
// Only changes the game already knows for sure are predicted (no random results): watering,
// fertilizing, the harvested tree resetting, XP, Mr. Darto's sale total, Shop prices.
// Pure functions, unit-tested in web/test/optimistic.test.ts. The chain transactions are not
// affected: the server still queues them in the background.

import type { GameState, Quality, ServerConfig, Species } from './api.ts';
import { seasonPayout } from './qty.ts';

const clone = (s: GameState): GameState => structuredClone(s);

function addFruit(s: GameState, species: Species, quality: Quality, qty: number) {
  const f = s.fruits.find((x) => x.species === species && x.quality === quality);
  if (f) f.qty += qty;
  else if (qty > 0) s.fruits.push({ species, quality, qty });
  s.fruits = s.fruits.filter((x) => x.qty > 0);
}

function addItem(s: GameState, item: string, qty: number) {
  const it = s.items.find((x) => x.item === item);
  if (it) it.qty += qty;
  else if (qty > 0) s.items.push({ item, qty });
}

/** The most likely fruit quality of a harvest (the server rolls the real one). */
export function likelyQuality(odds: Record<Quality, number>): Quality {
  return (['gold', 'rare', 'common'] as Quality[]).reduce((best, q) => (odds[q] > odds[best] ? q : best), 'common');
}

/**
 * The state to show right away for `path` with `body`, or null when nothing can be predicted
 * (e.g. planting: the seed's quality is revealed by the server). Never mutates `state`.
 */
export function predict(path: string, body: Record<string, unknown>, state: GameState, config: ServerConfig | null): GameState | null {
  const plotIndex = typeof body.plot === 'number' ? body.plot : -1;
  const tree = plotIndex >= 0 ? state.plots[plotIndex]?.tree : null;
  switch (path) {
    case '/api/water': {
      if (!tree || tree.wateredToday) return null;
      const s = clone(state);
      const t = s.plots[plotIndex].tree!;
      t.wateredToday = true;
      t.isWatered = true;
      return s;
    }
    case '/api/fertilize': {
      const fert = state.items.find((i) => i.item === 'fertilizer')?.qty ?? 0;
      if (!tree || tree.isFertilized || fert < 1) return null;
      const s = clone(state);
      const t = s.plots[plotIndex].tree!;
      t.isFertilized = true;
      t.fertMsLeft = s.clock.dayLengthMs;
      addItem(s, 'fertilizer', -1);
      return s;
    }
    case '/api/harvest': {
      // Old trees drop a seed (and may ask what to do with it): wait for the server.
      if (!tree || !tree.ready || tree.stage === 'old') return null;
      const s = clone(state);
      const t = s.plots[plotIndex].tree!;
      t.ready = false;
      t.growthPercent = 0;
      t.harvestCount += 1;
      addFruit(s, t.species, likelyQuality(t.nextHarvestOdds), 1);
      const xp = (config?.species?.[t.species]?.xpPerHarvest ?? 0) * s.player.xpMultiplier;
      s.player.xp += xp;
      return s;
    }
    case '/api/shop/buy': {
      // Google gardens only (wallet gardens sign the burn first, in the wallet).
      const item = String(body.item ?? '');
      const qty = Number(body.qty ?? 1);
      const price = config?.shop?.[item]?.price;
      if (state.player.custody !== 'server' || !price || state.player.balance < price * qty) return null;
      const s = clone(state);
      s.player.balance = Math.round((s.player.balance - price * qty) * 1e6) / 1e6;
      if (item === 'fertilizer') addItem(s, 'fertilizer', qty);
      return s;
    }
    case '/api/sell': {
      const species = body.species as Species;
      const quality = body.quality as Quality;
      const qty = Number(body.qty ?? 0);
      const price = Number(body.expectedPrice ?? 0);
      const have = state.fruits.find((f) => f.species === species && f.quality === quality)?.qty ?? 0;
      if (qty < 1 || have < qty || !price) return null;
      const mult = { common: 1, rare: 2, gold: 5 }[quality] ?? 1;
      const s = clone(state);
      addFruit(s, species, quality, -qty);
      s.player.balance = Math.round((s.player.balance + seasonPayout(price * mult * qty, s.season.divisor)) * 1e6) / 1e6;
      return s;
    }
    default:
      return null;
  }
}
