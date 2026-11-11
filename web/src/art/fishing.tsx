// The fishing corner at the left-hand hut of the v3 village (village.ts `fishing`), a "Soon" place:
//   - the rod (Ardian's ChatGPT image, docs/art-source/fishing-props.png, cut with
//     tools/pixelize/cutout.py --alpha) leans on a hut post; its float is its own layer
//     (tools/pixelize/split.py) and sways one pixel left and right, slowly;
//   - the woven fish basket from the same image stands on the ground at the hut's front;
//   - a fish hologram drawn here in code, in the style of the image's holograms (the durian sign
//     by the Shop, the robot head at the Friends house): a see-through cyan panel with a pixel
//     fish, a soft glow, a slow blink and a scan line, floating beside the roof.
// The rod and basket follow the village clock (warmer at dusk, darker at night); the hologram
// stays lit. With prefers-reduced-motion nothing moves (CSS). The pin and the "coming soon"
// window are in hotspots.tsx / app.tsx.

import { boxIn, type FishingCorner, type Village } from './village';

/** The hologram's pixel fish (12 x 7): `#` = outline, `o` = eye, `-` = scales. */
const FISH = [
  '....####....',
  '..##----#..#',
  '.#o#-----##.',
  '#--------#..',
  '.#------###.',
  '..##----#..#',
  '....####....',
];

/** Fish hologram: panel 16 x 11 units with a 1-unit edge, the fish in the middle. */
function FishHologram({ style }: { style: Record<string, string> }) {
  const cells: preact.JSX.Element[] = [];
  FISH.forEach((row, y) =>
    [...row].forEach((c, x) => {
      if (c === '.') return;
      cells.push(<rect key={`${x}-${y}`} class={c === '-' ? 'fh-scale' : 'fh-line'} x={x + 2} y={y + 2} width={1} height={1} />);
    }),
  );
  return (
    <span class="fish-holo" style={style}>
      <svg viewBox="0 0 16 11" preserveAspectRatio="none" shape-rendering="crispEdges">
        <rect class="fh-panel" x={0} y={0} width={16} height={11} />
        <path class="fh-edge" d="M1 0h14v1H1zM1 10h14v1H1zM0 1h1v9H0zM15 1h1v9h-1z" />
        {cells}
      </svg>
    </span>
  );
}

export function FishingProps({ v, f }: { v: Village; f: FishingCorner }) {
  const at = (b: [number, number, number, number]) => boxIn(v, ...b);
  return (
    <>
      <span class={`fish-prop fish-rod${f.rodFlip ? ' flip' : ''}`} style={at(f.rod)}>
        <img src="/assets/fishing/rod.png" alt="" />
        <img class="fish-float" src="/assets/fishing/float.png" alt="" />
      </span>
      <span class="fish-prop fish-bucket" style={at(f.bucket)}>
        <img src="/assets/fishing/bucket.png" alt="" />
      </span>
      <FishHologram style={at(f.holo)} />
    </>
  );
}
