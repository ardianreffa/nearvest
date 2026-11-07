// Full-window (immersive) garden layout for laptops and PCs. Pure math, unit-tested in web/test/layout.test.ts.

export const ART_W = 240;
export const ART_H = 135;
/** Art rows: grass ends at 103, the beds sit on rows 104-110. */
const SOIL_TOP_ROW = 104;
const BED_ROWS = 7;

export interface Immersive {
  /**
   * CSS px per pixel of the 240x135 art grid (trees and plots use it). The
   * laptop backdrop is the 480x270 HD image at k / 2 px per pixel (a whole or half step).
   */
  k: number;
  artLeft: number;
  artBottom: number;
  stageLeft: number;
  stageRight: number;
  stageBottom: number;
}

/**
 * Picks the pixel scale for a full-window garden: cover the window when that
 * crops at most 20% of the width, otherwise fit it (the rest is filled with a
 * blurred copy of the backdrop). The plots get a stage that avoids the open
 * drawer and the action bar.
 *
 * The HD backdrop (480x270) scales in half steps (3, 3.5, 4 ...), so k (the
 * 240-grid scale of trees, plots and TaniBot) is always a whole number. Half
 * steps let 16:10 screens such as 1440x900 (fullscreen) be covered at 3.5x
 * instead of shrinking to 3x with blurred bars; on retina screens (2 device
 * pixels per CSS pixel) a half step is still pixel-exact.
 */
export function immersiveLayout(width: number, height: number, drawerWidth: number, barHeight: number): Immersive {
  const hdW = ART_W * 2;
  const hdH = ART_H * 2;
  const half = (n: number) => n / 2;
  const cover = half(Math.ceil(2 * Math.max(width / hdW, height / hdH)));
  const fit = Math.max(1, half(Math.floor(2 * Math.min(width / hdW, height / hdH))));
  const hdScale = (hdW * cover - width) / width <= 0.2 ? cover : fit;
  const k = hdScale * 2;
  const artW = ART_W * k;
  const artLeft = Math.round((width - artW) / 2);
  const bedBottom = (ART_H - SOIL_TOP_ROW - BED_ROWS) * k;
  // Lift the art if the action bar would cover the beds (the soil continues below).
  const artBottom = Math.max(0, barHeight + 16 - bedBottom);
  const margin = Math.round(artW * 0.11);
  const stageLeft = Math.max(24, artLeft + margin);
  const stageRight = Math.max(drawerWidth > 0 ? drawerWidth + 36 : 24, width - (artLeft + artW) + margin);
  return { k, artLeft, artBottom, stageLeft, stageRight, stageBottom: artBottom + bedBottom };
}
