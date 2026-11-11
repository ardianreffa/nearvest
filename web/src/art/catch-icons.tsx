// Icons of everything the pond can give (fishing.tsx, docs/PLAN-fishing.md 3.4): original pixel art
// drawn in code, one grid per catch (fish face left, about 14 x 9). Pixel art keeps its own palette
// (CLAUDE.md Design system). Mango seed and Fertilizer reuse the game's own sprites so they look the
// same as in Storage.

import type { FishingCatchId } from '../api';
import { Pixels, Sprite } from '../sprites';
import { CATCH_GRIDS, FISH_PALETTE } from './catch-grids';

/** A catch's icon; `scale` = screen px per art pixel. */
export function CatchIcon({ id, scale = 3 }: { id: FishingCatchId; scale?: number }) {
  if (id === 'mango_seed') return <Sprite name="seedPacket" scale={scale + 1} />;
  if (id === 'fertilizer') return <Sprite name="fertilizer" scale={scale + 1} />;
  return <Pixels rows={CATCH_GRIDS[id]!} palette={FISH_PALETTE} scale={scale} title={undefined} />;
}

