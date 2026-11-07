# Aligns an AI redraw of a backdrop (e.g. the dusk village) to the reference image (the day
# village) with one small stretch of the whole picture: nothing is cropped or pasted.
# The AI draws a redraw a few percent smaller or shifted; the stretch is found by comparing the
# edges of houses / towers / terraces in both images (see docs/ASSETS.md for the numbers used).
#
# Usage: python3 -I tools/pixelize/align.py SRC.png OUT.png AX BX AY BY [REFERENCE.png]
#   Output pixel (x, y) takes SRC at (AX * x + BX, AY * y + BY), bilinear, clamped at the edges;
#   the output has SRC's size. With REFERENCE.png it prints the remaining offset (dx, dy in px)
#   of houses and terraces, left / middle / right (0, 0 = aligned).
# Dusk backdrop (2026-11-07): AX 0.9783 BX 8.5 AY 0.9852 BY -15.1, reference bg-day-ai.png.
# Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png


def stretch(src, w, h, ax, bx, ay, by):
    out = []
    for y in range(h):
        sy = ay * y + by
        y0 = int(sy // 1)
        fy = sy - y0
        ya, yb = max(0, min(h - 1, y0)), max(0, min(h - 1, y0 + 1))
        row = []
        for x in range(w):
            sx = ax * x + bx
            x0 = int(sx // 1)
            fx = sx - x0
            xa, xb = max(0, min(w - 1, x0)), max(0, min(w - 1, x0 + 1))
            p00, p01, p10, p11 = src[ya][xa], src[ya][xb], src[yb][xa], src[yb][xb]
            row.append(tuple(int((p00[i] * (1 - fx) + p01[i] * fx) * (1 - fy) + (p10[i] * (1 - fx) + p11[i] * fx) * fy) for i in range(3)) + (255,))
        out.append(row)
    return out


def edges(px, w, h):
    lum = [[0.3 * px[y][x][0] + 0.59 * px[y][x][1] + 0.11 * px[y][x][2] for x in range(0, w, 2)] for y in range(0, h, 2)]
    return [[abs(lum[y][x + 1] - lum[y][x]) + abs(lum[y + 1][x] - lum[y][x]) for x in range(len(lum[0]) - 1)] for y in range(len(lum) - 1)]


def offset(ea, eb, y0, y1, x0, x1):
    h, w = len(ea), len(ea[0])
    best = None
    for dy in range(-6, 7):
        for dx in range(-6, 7):
            s = 0
            for y in range(y0, y1, 2):
                if not 0 <= y + dy < h:
                    continue
                ra, rb = ea[y], eb[y + dy]
                for x in range(x0, x1, 2):
                    if 0 <= x + dx < w:
                        s += ra[x] * rb[x + dx]
            if best is None or s > best[0]:
                best = (s, dx * 2, dy * 2)
    return best[1:]


def main():
    src_path, out_path = sys.argv[1], sys.argv[2]
    ax, bx, ay, by = (float(v) for v in sys.argv[3:7])
    w, h, src = read_png(src_path)
    out = stretch(src, w, h, ax, bx, ay, by)
    write_png(out_path, w, h, out)
    print(f'{out_path}: {w}x{h}, x_src = {ax} x + {bx}, y_src = {ay} y + {by}')
    if len(sys.argv) > 7:
        rw, rh, ref = read_png(sys.argv[7])
        assert (rw, rh) == (w, h), 'reference must have the same size'
        ea, eb = edges(ref, w, h), edges(out, w, h)
        cols = [(20, 280), (280, 560), (560, 820)]
        for name, (y0, y1) in {'houses': (150, 300), 'terraces': (250, 330)}.items():
            print(name, 'offset left / middle / right (dx, dy px):', [offset(ea, eb, y0, y1, x0, x1) for x0, x1 in cols])


main()
