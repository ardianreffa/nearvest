// Icons of everything the pond can give (fishing.tsx). Part 1: stand-ins from the existing sprites;
// the real fish / junk / item icons come next (docs/PLAN-fishing.md 3.4).

import type { FishingCatchId } from '../api';
import { Sprite, type SpriteName } from '../sprites';

const STAND_IN: Record<FishingCatchId, SpriteName> = {
  tilapia: 'fish',
  catfish: 'fish',
  carp: 'fish',
  gourami: 'fish',
  golden_arowana: 'fish',
  stone: 'lock',
  driftwood: 'lock',
  fish_bone: 'lock',
  old_boot: 'lock',
  mango_seed: 'seedPacket',
  fertilizer: 'fertilizer',
  bottle: 'droplet',
  chest: 'coin',
};

export function CatchIcon({ id, scale = 3 }: { id: FishingCatchId; scale?: number }) {
  return <Sprite name={STAND_IN[id]} scale={scale} />;
}
