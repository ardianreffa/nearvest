# Fishing package 7 (Ardian 2026-11-12): the upright phone pond fills the WHOLE screen, no blurred copy.
# A phone taller than the picture gets more of the picture's own ground below it: the bottom rows
# (bushes, path, flowers) repeated downward like a quilt. Each new copy overlaps the rows above it by
# OV rows and is joined along a wavy cut that follows where the two look most alike (the cheapest
# left-to-right path through the overlap, moving at most one row per column), so no straight seam
# shows. The repeat length P is the one with the cheapest cut. Day / dusk / night share P and the cuts
# (one layout). The strip starts OV rows ABOVE the picture's bottom (drawn over it there: identical
# pixels above the first cut). Writes <name>-ground.png per picture.
# Usage: python3 -I tools/pixelize/pond_ground.py <out height px> <picture.png>...
# Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

OV = 16
out_h = int(sys.argv[1])
pics = sys.argv[2:]
imgs = [read_png(p)[2] for p in pics]
w = len(imgs[0][0])
h = len(imgs[0])
rgb = [[[tuple(p[:3]) for p in r] for r in px] for px in imgs]


def err_grid(cur_rows, tile_rows):
    """Overlap error per (row, column), summed over the three pictures."""
    return [[sum(sum(abs(a[x][c] - b[x][c]) for c in range(3)) for a, b in zip(ca, tb)) for x in range(w)]
            for ca, tb in zip(zip(*cur_rows), zip(*tile_rows))]


def best_cut(E):
    """The cheapest left-to-right path through E (rows x columns), one row step per column at most."""
    rows = len(E)
    cost = [E[r][0] for r in range(rows)]
    back = []
    for x in range(1, w):
        nc, bk = [], []
        for r in range(rows):
            c, rr = min((cost[q], q) for q in (r - 1, r, r + 1) if 0 <= q < rows)
            nc.append(c + E[r][x])
            bk.append(rr)
        cost = nc
        back.append(bk)
    r = min(range(rows), key=lambda q: cost[q])
    total = cost[r]
    path = [r]
    for bk in reversed(back):
        r = bk[r]
        path.append(r)
    return total, path[::-1]


def tile(P):
    return [px[h - P - OV:h] for px in rgb]


# Pick P by the cut against the picture's own last rows.
best = None
for P in range(100, 200, 2):
    E = err_grid([px[h - OV:h] for px in rgb], [t[:OV] for t in tile(P)])
    total, path = best_cut(E)
    if best is None or total < best[0]:
        best = (total, P)
P = best[1]

# Build: start with the picture's last OV rows, add tiles until tall enough.
out = [px[h - OV:h] for px in rgb]
while len(out[0]) < out_h + OV:
    t = tile(P)
    cur = [o[-OV:] for o in out]
    _, path = best_cut(err_grid(cur, [x[:OV] for x in t]))
    for k in range(len(out)):
        for r in range(OV):
            row = list(out[k][len(out[k]) - OV + r])
            for x in range(w):
                if r >= path[x]:
                    row[x] = t[k][r][x]
            out[k][len(out[k]) - OV + r] = row
        out[k] = out[k] + t[k][OV:]
for path_, o in zip(pics, out):
    o = o[:out_h + OV]
    dst = path_[:-4] + '-ground.png'
    write_png(dst, w, len(o), [[p + (255,) for p in r] for r in o])
    print(f'{dst}: {w}x{len(o)} (starts {OV} rows above the picture bottom), repeat {P} rows')
