// Where TaniBot stands in the garden (Ardian 2026-11-12). It always stands in a GAP between two
// neighbouring plots in the row: gap g lies between plot g and plot g + 1. Each plot has an
// "own" spot (`homeGap`): to its right, the last plot to its left. When another plot is picked,
// TaniBot only walks when its gap is NOT next to that plot; otherwise it stays where it is and
// just turns to the plot (its actions also aim at that plot). Works for any number of plots in
// one row (3 today; 4-9 later).

/** TaniBot's spot: the gap it stands in, and the plot whose own spot it is (its exact place). */
export interface BotStand {
  gap: number;
  plot: number;
}

/** A plot's own gap: right of the plot, except the last plot (left of it). */
export function homeGap(plot: number, plots: number): number {
  return plots < 2 ? 0 : Math.max(0, Math.min(plot, plots - 2));
}

/** True when the plot touches the gap (the gap is right or left of it). */
export function besideGap(gap: number, plot: number): boolean {
  return plot === gap || plot === gap + 1;
}

/** The stand after `plot` is picked: unchanged when TaniBot already stands next to it. */
export function nextStand(prev: BotStand | null, plot: number, plots: number): BotStand {
  if (prev && prev.gap <= plots - 2 && besideGap(prev.gap, plot)) return prev;
  return { gap: homeGap(plot, plots), plot };
}

/** TaniBot turns toward the plot it works on: left when the plot is left of its gap. */
export function faceToward(gap: number, plot: number): 'left' | 'right' {
  return plot <= gap ? 'left' : 'right';
}
