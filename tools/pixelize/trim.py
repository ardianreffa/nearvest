# Cuts the empty (transparent) border off a converted sprite. With --slope S it also leans the
# sprite so its bottom edge climbs exactly S pixels per pixel to the right (e.g. the v3 train,
# drawn at about 0.213, on a rail of 0.246): each pixel column moves up or down a whole number of
# pixels (a clean stair-step, never a blurry rotation).
# Usage: python3 -I tools/pixelize/trim.py IN.png OUT.png [--slope S]   (standard library only)
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png


def trim(P, w, h):
    ys = [y for y in range(h) if any(P[y][x][3] for x in range(w))]
    xs = [x for x in range(w) if any(P[y][x][3] for y in range(h))]
    return [row[xs[0]:xs[-1] + 1] for row in P[ys[0]:ys[-1] + 1]]


def bottom_slope(P):
    """Least-squares slope of the lowest opaque pixel per column (middle 80% of the columns)."""
    h, w = len(P), len(P[0])
    pts = []
    for x in range(int(w * 0.1), int(w * 0.9)):
        ys = [y for y in range(h) if P[y][x][3]]
        if ys:
            pts.append((x, ys[-1]))
    n = len(pts)
    mx = sum(p[0] for p in pts) / n
    my = sum(p[1] for p in pts) / n
    return -sum((p[0] - mx) * (p[1] - my) for p in pts) / sum((p[0] - mx) ** 2 for p in pts)


def main():
    src, out = sys.argv[1], sys.argv[2]
    w, h, P = read_png(src, alpha=True)
    P = trim(P, w, h)
    if '--slope' in sys.argv:
        want = float(sys.argv[sys.argv.index('--slope') + 1])
        have = bottom_slope(P)
        extra = want - have
        h, w = len(P), len(P[0])
        shift = [round(extra * x) for x in range(w)]  # pixels to move each column up
        lo, hi = min(shift), max(shift)
        H = h + hi - lo
        img = [[(0, 0, 0, 0)] * w for _ in range(H)]
        for x in range(w):
            for y in range(h):
                img[y + hi - shift[x]][x] = P[y][x]
        P = img
        print(f'bottom slope {have:.3f} -> {bottom_slope(P):.3f} (wanted {want})')
    write_png(out, len(P[0]), len(P), P)
    print(f'{out}: {len(P[0])}x{len(P)}')


main()
