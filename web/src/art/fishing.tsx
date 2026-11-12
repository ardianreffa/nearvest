// The fishing corner at the left-hand hut of the v3 village (village.ts `fishing`):
//   - (removed 2026-11-13, Ardian) one small set on the grass in front of the porch: the woven fish basket with the rod standing
//     in it, tip to the right (away from the hut), the line and float hanging over the grass. Both
//     are Ardian's ChatGPT image (docs/art-source/fishing-props.png, cut with
//     tools/pixelize/cutout.py --alpha at the hut's own pixel size); the float is its own layer
//     (tools/pixelize/split.py) and sways one pixel left and right, slowly;
//   - a fish hologram drawn here in code, mounted on the roof near the ridge like a neon sign (two
//     small legs), in the style of the image's holograms (the durian sign by the Shop, the robot
//     head at the Friends house): a see-through cyan panel with a pixel fish, a soft glow, a slow
//     blink and a scan line.
// The set follows the village clock (warmer at dusk, darker at night); the sign stays lit. With
// prefers-reduced-motion nothing moves (CSS). The pin and the "coming soon" window are in
// hotspots.tsx / app.tsx.

import { boxIn, type FishingCorner, type Village } from './village';

/** The sign's pixel fish (12 x 7): `#` = outline, `o` = eye, `-` = scales. */
const FISH = [
  '....####....',
  '..##----#..#',
  '.#o#-----##.',
  '#--------#..',
  '.#------###.',
  '..##----#..#',
  '....####....',
];

/**
 * Roof sign: panel 22 x 11 units (about the shape of the Arena's "1 VS 1" screen) with a 1-unit
 * edge and the fish in the middle, on two legs (rows 11-12).
 */
function FishSign({ style }: { style: Record<string, string> }) {
  const cells: preact.JSX.Element[] = [];
  FISH.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '.') return;
      cells.push(<rect key={`${x}-${y}`} class={c === '-' ? 'fh-scale' : 'fh-line'} x={x + 5} y={y + 2} width={1} height={1} />);
    }),
  );
  return (
    <span class="fish-holo" style={style}>
      <svg viewBox="0 0 22 13" preserveAspectRatio="none" shape-rendering="crispEdges">
        <path class="fh-leg" d="M4 11h1v2H4zM17 11h1v2h-1z" />
        <g class="fh-glow">
          <rect class="fh-panel" x={0} y={0} width={22} height={11} />
          <path class="fh-edge" d="M1 0h20v1H1zM1 10h20v1H1zM0 1h1v9H0zM21 1h1v9h-1z" />
          {cells}
        </g>
      </svg>
      <i class="fh-scan" />
    </span>
  );
}

export function FishingProps({ v, f }: { v: Village; f: FishingCorner }) {
  const at = (b: [number, number, number, number]) => boxIn(v, ...b);
  return (
    <>
      {/* The rod-and-basket set on the grass was removed (Ardian 2026-11-13: at village size it read
          as a small dark object under the stairs); only the roof sign stays. */}
      <FishSign style={at(f.holo)} />
    </>
  );
}
