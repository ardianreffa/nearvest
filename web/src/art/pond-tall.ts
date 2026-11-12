// The upright (9:16) fishing pond for phones (Fishing package 6, Ardian 2026-11-12): Ardian's ChatGPT
// picture is the 16:9 pond extended up and down, its middle EXACTLY the 16:9 picture. So the whole
// 16:9 scene (dock, lily pads, frogs, ducks, float, waterfall...) is simply drawn in a band at `band`
// px from the top of the taller picture; the extra land above and below holds the floating controls.
// Install: tools/pixelize/pond_tall.py measures `band` on the pixelized picture and prints this config.
// null = no upright picture yet: phones keep the 16:9 pond across the width (pond-life-plan.ts pondFit).

export interface TallPond {
  /** Height of the upright picture in pond grid px (its width is 480, like the 16:9 one). */
  h: number;
  /** Where the 16:9 picture's top row sits in it (grid px). */
  band: number;
  /** The pictures (dusk / night optional: without them the day one is used, with the code dimming). */
  src: { day: string; dusk?: string; night?: string };
}

/** The installed upright pond (set by tools/pixelize/pond_tall.py when Ardian's picture is added). */
export const TALL_POND: TallPond | null = null;

/** Dev builds only: ?tallpond=test uses a stand-in picture to try the layout (never committed). */
const TEST: TallPond = { h: 853, band: 292, src: { day: '/assets/bg/fishing-pond-tall-test.png' } };

export function tallPond(search = typeof location !== 'undefined' ? location.search : ''): TallPond | null {
  if (import.meta.env?.DEV && new URLSearchParams(search).get('tallpond') === 'test') return TEST;
  return TALL_POND;
}
