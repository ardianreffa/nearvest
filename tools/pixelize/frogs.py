# Draws small, crisp pixel frogs over the blurry frogs of a pixelized background (the fishing pond,
# docs/PLAN-fishing.md): at phone size the pixelized ChatGPT frogs were green blobs without eyes.
# Each frog is an 11 x 9 grid with a dark outline, white eyes with pupils and a pale belly, centred
# on the given grid point (the frog's middle in the pixelized image). Standard library only.
# Usage: python3 -I tools/pixelize/frogs.py in.png out.png X,Y [X,Y ...]
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

FROG = [
    '.kkk...kkk.',
    'kwkwkkkwkwk',
    'kwwwGGGwwwk',
    'kGGGGGGGGGk',
    'kGkkkkkkkGk',
    'kGGyyyyyGGk',
    '.kGyyyyyGk.',
    'kGGkGGGkGGk',
    '.kk.kkk.kk.',
]
COL = {'k': (0x1D, 0x3A, 0x1A), 'w': (0xFF, 0xFA, 0xF0), 'G': (0x6F, 0xC2, 0x3A), 'y': (0xD8, 0xF0, 0x7A)}

src, out = sys.argv[1], sys.argv[2]
w, h, px = read_png(src)
rows = [[tuple(p[:3]) + (255,) for p in row] for row in px]
for spec in sys.argv[3:]:
    cx, cy = (int(v) for v in spec.split(','))
    x0, y0 = cx - len(FROG[0]) // 2, cy - len(FROG) // 2
    for r, line in enumerate(FROG):
        for c, ch in enumerate(line):
            if ch != '.' and 0 <= y0 + r < h and 0 <= x0 + c < w:
                rows[y0 + r][x0 + c] = COL[ch] + (255,)
write_png(out, w, h, rows)
print(f'{len(sys.argv) - 3} frogs -> {out}')
