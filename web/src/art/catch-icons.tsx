// Icons of everything the pond can give (fishing.tsx, docs/PLAN-fishing.md 3.4): original pixel art
// drawn in code, one grid per catch (fish face left, about 14 x 9). Pixel art keeps its own palette
// (CLAUDE.md Design system). Mango seed and Fertilizer reuse the game's own sprites so they look the
// same as in Storage.

import type { FishingCatchId } from '../api';
import { Pixels, Sprite } from '../sprites';
import { CATCH_GRIDS, FISH_PALETTE } from './catch-grids';

/**
 * A catch's icon; `scale` = screen px per art pixel. `fitW` (screen px): long fish (Golden Arowana,
 * Catfish) step down to a smaller whole scale so they stay inside that width.
 */
export function CatchIcon({ id, scale = 3, fitW }: { id: FishingCatchId; scale?: number; fitW?: number }) {
  if (id === 'mango_seed') return <Sprite name="seedPacket" scale={scale + 1} />;
  if (id === 'fertilizer') return <Sprite name="fertilizer" scale={scale + 1} />;
  const rows = CATCH_GRIDS[id]!;
  const k = fitW ? Math.min(scale, Math.max(1, Math.floor(fitW / rows[0].length))) : scale;
  return <Pixels rows={rows} palette={FISH_PALETTE} scale={k} title={undefined} />;
}

