// Garden layouts: the full-window (immersive) garden on laptops and PCs, and the phone garden.
// Pure math, unit-tested in web/test/layout.test.ts.

import { V1, V2_PHONE, V2_WEB, V3_PHONE, V3_WEB, type BgVersion, type Village } from './art/village.ts';

export const ART_W = 240;
export const ART_H = 135;

export interface Immersive {
  /**
   * CSS px per game pixel (trees, plots and TaniBot use it). The backdrop images are twice as
   * detailed and drawn at k / 2 px per image pixel (a whole or half step).
   */
  k: number;
  artLeft: number;
  artBottom: number;
  stageLeft: number;
  stageRight: number;
  stageBottom: number;
  /** The village art drawn (grid size and positions of everything in it). */
  village: Village;
}

/** Room the side menu leaves on the right: its width plus its margin and a small gap. */
const sideRoom = (drawerWidth: number) => drawerWidth + 16;

/**
 * Picks the pixel scale for a full-window garden.
 *
 * v2 (the symmetric village): the biggest whole-number scale at which the whole village (Shop
 * to the Friends house) fits left of the side menu (open drawer or icon rail) and the towers
 * fit under the top of the window, with the plots above the action bar. The art is placed so
 * the village sits in the free room; any spare room shows the sky or a blurred copy.
 *
 * v1 (the first village, ?bg=v1): cover the window when that crops at most 20% of the width,
 * otherwise fit it (the rest is filled with a blurred copy of the backdrop). The HD backdrop
 * (480x270) scales in half steps (3, 3.5, 4 ...), so k is always a whole number; on retina
 * screens a half step is still pixel-exact.
 */
export function immersiveLayout(width: number, height: number, drawerWidth: number, barHeight: number, village: Village = V1): Immersive {
  const v = village;
  const bedBottomRows = v.h - v.bedRow;
  const lift = (k: number) => Math.max(0, barHeight + 16 - bedBottomRows * k);

  if (v.focus) {
    const f = v.focus;
    const freeLeft = 0;
    const freeRight = width - sideRoom(drawerWidth);
    let k = 2;
    for (let t = 2; t <= 16; t++) {
      const fitsW = (f.x1 - f.x0) * t <= freeRight - freeLeft;
      const fitsH = (v.h - f.top) * t + lift(t) <= height - 24;
      if (fitsW && fitsH) k = t;
    }
    const artW = v.w * k;
    const lo = freeLeft - f.x0 * k;
    const hi = freeRight - f.x1 * k;
    // The village in the middle of the free room, then nudged so the art covers the window's
    // left edge and reaches the side menu (an open drawer hides everything behind it).
    const coverRight = drawerWidth > 100 ? freeRight : width;
    let artLeft = Math.round(Math.min(hi, Math.max(lo, (freeLeft + freeRight) / 2 - ((f.x0 + f.x1) / 2) * k)));
    if (artLeft > 0) artLeft = Math.max(lo, 0);
    if (artLeft + artW < coverRight && artLeft < 0) artLeft = Math.min(hi, 0, coverRight - artW);
    const artBottom = lift(k);
    return {
      k,
      artLeft,
      artBottom,
      stageLeft: artLeft + v.stage[0] * k,
      stageRight: width - (artLeft + v.stage[1] * k),
      stageBottom: artBottom + bedBottomRows * k,
      village: v,
    };
  }

  const hdW = v.w * 2;
  const hdH = v.h * 2;
  const half = (n: number) => n / 2;
  const cover = half(Math.ceil(2 * Math.max(width / hdW, height / hdH)));
  const fit = Math.max(1, half(Math.floor(2 * Math.min(width / hdW, height / hdH))));
  const hdScale = (hdW * cover - width) / width <= 0.2 ? cover : fit;
  const k = hdScale * 2;
  const artW = v.w * k;
  const artLeft = Math.round((width - artW) / 2);
  const bedBottom = bedBottomRows * k;
  // Lift the art if the action bar would cover the beds (the soil continues below).
  const artBottom = lift(k);
  const margin = Math.round(artW * 0.11);
  const stageLeft = Math.max(24, artLeft + margin);
  const stageRight = Math.max(drawerWidth > 0 ? drawerWidth + 36 : 24, width - (artLeft + artW) + margin);
  return { k, artLeft, artBottom, stageLeft, stageRight, stageBottom: artBottom + bedBottom, village: v };
}

/** The laptop layout of the village version in use. */
export function laptopLayout(width: number, height: number, drawerWidth: number, barHeight: number, version: BgVersion): Immersive {
  return immersiveLayout(width, height, drawerWidth, barHeight, version === 'v1' ? V1 : version === 'v2' ? V2_WEB : V3_WEB);
}

/** Phone garden: the scene box (as wide as the screen) and the upright art inside it. */
export interface PhoneZoom extends Immersive {
  sceneW: number;
  sceneH: number;
  /** Whole-number pixel size for the trees and the lock (v3: k is not a whole number). */
  spritePx: number;
}

/** Game rows the v2 phone scene always shows: from just above the towers to the bottom. */
export const PHONE_SHOWN_FROM = 66;
/** The plot sheet takes at most this part of a phone screen. */
export const PHONE_SHEET_MAX = 0.2;
/** Room above and below the phone scene: top HUD, the plot sheet, the tab bar. */
const phoneRoom = (height: number, sheet: number) => height - 130 - Math.round(height * sheet) - 68 - 16;

/** Room for the phone scene between the top HUD, the plot sheet (at most 20%) and the tabs. */
export function phoneSceneRoom(height: number): number {
  return phoneRoom(height, PHONE_SHEET_MAX);
}

/**
 * Phones (below 1024 px), v3: see below. v2: the upright village fits the screen's width at a whole-number scale
 * (3 px per game pixel on 360 - 440 px phones), with the whole village and all three plots in
 * view at once (no panning). The art sits on the scene's bottom edge; the scene grows to fill
 * the room above the sheet, showing more sky.
 */
export function phoneLayout(width: number, height: number, village: Village = V3_PHONE): PhoneZoom {
  const v = village;
  if (v.shownFrom !== undefined) {
    // v3: the village fills the screen's width exactly (no blurred sides, no panning); the
    // scene shows the art from `shownFrom` down, so most of the empty sky is cut away.
    const k = width / v.w;
    return {
      k,
      artLeft: 0,
      artBottom: 0,
      stageLeft: v.stage[0] * k,
      stageRight: width - v.stage[1] * k,
      stageBottom: (v.h - v.bedRow) * k,
      village: v,
      sceneW: Math.round(width),
      sceneH: Math.round((v.h - v.shownFrom) * k),
      spritePx: Math.max(2, Math.round(k)),
    };
  }
  const shown = v.h - PHONE_SHOWN_FROM;
  const k = Math.min(6, Math.max(2, Math.min(Math.floor(width / v.w), Math.floor(phoneRoom(height, 0.25) / shown))));
  const artW = v.w * k;
  const artLeft = Math.round((width - artW) / 2);
  return {
    k,
    artLeft,
    artBottom: 0,
    stageLeft: artLeft + v.stage[0] * k,
    stageRight: width - (artLeft + v.stage[1] * k),
    stageBottom: (v.h - v.bedRow) * k,
    village: v,
    sceneW: Math.round(width),
    sceneH: shown * k,
    spritePx: k,
  };
}
