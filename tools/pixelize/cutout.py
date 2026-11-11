# Turns an AI pixel-art object on a white background (a train, a turbine rotor) into a sharp
# sprite PNG with a transparent background, the same way the backdrops are converted
# (background.py: dominant colour per cell, median-cut palette).
# The background is the white connected to the image edges (flood fill), so white parts of
# the object itself (the train's body, highlights) stay.
# Usage: python3 -I tools/pixelize/cutout.py input.png ROWS out_dir [--colors N] [--cols N] [--crop X0 Y0 X1 Y1 --scene] [--alpha]
# --cols forces the width (e.g. the night train exactly as long as the day train).
# --crop cuts a small object out of a full scene (e.g. the little robot of the old village);
# with --scene the background is every colourful (green, orange, brown, yellow) pixel connected
# to the crop's edges, so a white, grey, dark or cyan object stays (--sat N: how colourful, default 45).
# --alpha: the image already has a see-through background (e.g. the fishing props): the background
# is every pixel less than half opaque (no flood fill: enclosed gaps, e.g. between rod and line, too).
# Writes out_dir/bg.png (the sprite, 1 px per cell) and out_dir/preview-x4.png.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png
from background import pixelize_background


def whiteish(p):
    return p[0] > 222 and p[1] > 222 and p[2] > 222


SAT = int(sys.argv[sys.argv.index('--sat') + 1]) if '--sat' in sys.argv else 45


def colourful(p):
    """Scene background around a small robot: saturated and not cyan (greens, oranges, browns)."""
    r, g, b = p[0], p[1], p[2]
    hi, lo = max(r, g, b), min(r, g, b)
    cyan = b > 150 and g > 150 and r < 0.75 * min(g, b)
    return hi - lo > SAT and not cyan


def main():
    src, rows, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
    n = int(sys.argv[sys.argv.index('--colors') + 1]) if '--colors' in sys.argv else 24
    os.makedirs(out, exist_ok=True)
    alpha = '--alpha' in sys.argv
    w, h, px = read_png(src, alpha=alpha)
    if alpha:
        # Remember which pixels are see-through, then hand plain RGB on (pixelize_background).
        clear = [[p[3] < 128 for p in row] for row in px]
        px = [[p[:3] for p in row] for row in px]
    if '--crop' in sys.argv:
        i = sys.argv.index('--crop')
        cx0, cy0, cx1, cy1 = (int(v) for v in sys.argv[i + 1:i + 5])
        px = [row[cx0:cx1] for row in px[cy0:cy1]]
        if alpha:
            clear = [row[cx0:cx1] for row in clear[cy0:cy1]]
        w, h = cx1 - cx0, cy1 - cy0
    is_bg = colourful if '--scene' in sys.argv else whiteish
    if alpha:
        is_bg = None
    bg = [[False] * w for _ in range(h)]
    stack = [(x, y) for x in range(w) for y in (0, h - 1)] + [(x, y) for y in range(h) for x in (0, w - 1)]
    if alpha:
        # Every see-through pixel is background, also the gaps enclosed by the object (rod and line).
        bg, stack = [row[:] for row in clear], []
    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h) or bg[y][x] or not (clear[y][x] if alpha else is_bg(px[y][x])):
            continue
        bg[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    xs = [x for y in range(0, h, 2) for x in range(0, w, 2) if not bg[y][x]]
    ys = [y for y in range(0, h, 2) for x in range(0, w, 2) if not bg[y][x]]
    box = (min(xs), min(ys), max(xs) + 2, max(ys) + 2)
    cols = int(sys.argv[sys.argv.index('--cols') + 1]) if '--cols' in sys.argv else None
    pixelize_background(w, h, px, rows, n, out, mask=bg, crop=box, cols=cols)


main()
