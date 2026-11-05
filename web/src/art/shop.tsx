// The Village Shop stall with its guard robot (official design from Ardian's ChatGPT image,
// see shop-sprite.ts and docs/ASSETS.md). The robot floats a little and blinks.

import { Pixels } from '../sprites';
import { SHOP_PALETTE, SHOP_ROBOT, SHOP_ROBOT_AT, SHOP_ROBOT_EYES, SHOP_ROWS } from './shop-sprite';

export function ShopStall({ scale = 2 }: { scale?: number }) {
  return (
    <div class="shop-stall" style={{ width: SHOP_ROWS[0].length * scale, height: SHOP_ROWS.length * scale, '--s': `${scale}px` }}>
      <Pixels rows={SHOP_ROWS} palette={SHOP_PALETTE} scale={scale} title="Village Shop" />
      <div
        class="shop-robot"
        style={{ left: SHOP_ROBOT_AT.x * scale, top: SHOP_ROBOT_AT.y * scale, width: SHOP_ROBOT[0].length * scale, height: SHOP_ROBOT.length * scale }}
      >
        <Pixels rows={SHOP_ROBOT} palette={SHOP_PALETTE} scale={scale} />
        <Pixels rows={SHOP_ROBOT_EYES} palette={SHOP_PALETTE} scale={scale} class="shop-robot-eyes" />
      </div>
    </div>
  );
}
