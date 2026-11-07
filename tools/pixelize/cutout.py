# Turns an AI pixel-art object on a white background (a train, a turbine rotor) into a sharp
# sprite PNG with a transparent background, the same way the backdrops are converted
# (background.py: dominant colour per cell, median-cut palette).
# The background is the white connected to the image edges (flood fill), so white parts of
# the object itself (the train's body, highlights) stay.
# Usage: python3 -I tools/pixelize/cutout.py input.png ROWS out_dir [--colors N] [--cols N]
# --cols forces the width (e.g. the night train exactly as long as the day train).
# Writes out_dir/bg.png (the sprite, 1 px per cell) and out_dir/preview-x4.png.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png
from background import pixelize_background


def whiteish(p):
    return p[0] > 222 and p[1] > 222 and p[2] > 222


def main():
    src, rows, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    n = int(sys.argv[sys.argv.index('--colors') + 1]) if '--colors' in sys.argv else 24
    os.makedirs(out, exist_ok=True)
    w, h, px = read_png(src)
    bg = [[False] * w for _ in range(h)]
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h) or bg[y][x] or not whiteish(px[y][x]):
            continue
        bg[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    xs = [x for y in range(0, h, 2) for x in range(0, w, 2) if not bg[y][x]]
    ys = [y for y in range(0, h, 2) for x in range(0, w, 2) if not bg[y][x]]
    box = (min(xs), min(ys), max(xs) + 2, max(ys) + 2)
    cols = int(sys.argv[sys.argv.index('--cols') + 1]) if '--cols' in sys.argv else None
    pixelize_background(w, h, px, rows, n, out, mask=bg, crop=box, cols=cols)


main()
