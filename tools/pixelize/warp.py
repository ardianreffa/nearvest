# Lines up an AI redraw (e.g. the night village) with the reference (the day village) when the AI
# moved things by different amounts in different places (the phone night v3 was drawn up to 70 px
# lower near the top and about 0 px lower at the bottom). One straight stretch (align.py) cannot
# fix that, so this measures the offset at many points and moves every part of the redraw by the
# smoothly interpolated offset of its neighbourhood.
#
# Measuring: edge strength (brightness gradient, so day and night colours do not matter) is
# compared in 40x40 blocks at half resolution (normalised cross-correlation); flat blocks (sky,
# plain grass) and poor matches are skipped, outliers (far from their neighbours) are dropped.
# Moving: nearest-pixel sampling (no blur, no new colours), the output has the reference's size.
#
# Usage: python3 -I tools/pixelize/warp.py REFERENCE.png REDRAW.png OUT.png [--top Y] [--range DY]
#   --top Y: measure from this source row down (skip the empty sky); --range DY: largest vertical
#   offset searched, in source px (default 100). Prints the offset field and the remaining
#   offset after warping (dx, dy per region, 0 = aligned). Standard library only.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png


def grad(px, w, h):
    L = [[0.3 * px[y][x][0] + 0.59 * px[y][x][1] + 0.11 * px[y][x][2] for x in range(0, w - 1, 2)] for y in range(0, h - 1, 2)]
    H, W = len(L), len(L[0])
    return [[abs(L[y][min(W - 1, x + 1)] - L[y][x]) + abs(L[min(H - 1, y + 1)][x] - L[y][x]) for x in range(W)] for y in range(H)]


def measure(A, B, top, lo, hi, step=24, r=20, xr=10):
    """`lo`..`hi`: vertical search range in half-resolution px."""
    # Offsets (x, y, dx, dy) in source px where block (x, y) of A is found in B.
    H, W = min(len(A), len(B)), min(len(A[0]), len(B[0]))
    pts = []
    for cy in range(max(r, top // 2), H - r, step):
        for cx in range(30, W - 30, 32):
            pa = [A[y][x] for y in range(cy - r, cy + r) for x in range(cx - r, cx + r)]
            ma = sum(pa) / len(pa)
            da = [p - ma for p in pa]
            na = math.sqrt(sum(d * d for d in da))
            if na < 400:
                continue
            best = None
            for dy in range(lo, hi + 1):
                if cy - r + dy < 0 or cy + r + dy > H:
                    continue
                for dx in range(-xr, xr + 1):
                    if cx - r + dx < 0 or cx + r + dx > W:
                        continue
                    pb = [B[y][x] for y in range(cy - r + dy, cy + r + dy) for x in range(cx - r + dx, cx + r + dx)]
                    mb = sum(pb) / len(pb)
                    nb = math.sqrt(sum((p - mb) ** 2 for p in pb)) or 1
                    s = sum(da[i] * (pb[i] - mb) for i in range(len(pa))) / (na * nb)
                    if best is None or s > best[0]:
                        best = (s, dx, dy)
            if best and best[0] > 0.35:
                pts.append((cx * 2, cy * 2, best[1] * 2, best[2] * 2))
    # drop outliers: far from the median of the points around them
    keep = []
    for p in pts:
        nb = [q for q in pts if q is not p and abs(q[0] - p[0]) <= 140 and abs(q[1] - p[1]) <= 100]
        if len(nb) >= 3:
            mdx = sorted(q[2] for q in nb)[len(nb) // 2]
            mdy = sorted(q[3] for q in nb)[len(nb) // 2]
            if abs(p[2] - mdx) > 12 or abs(p[3] - mdy) > 16:
                continue
        keep.append(p)
    return keep


def field(pts, w, h, cell=8, sigma=60.0):
    """Offset at every `cell` px: Gaussian-weighted mean of the measured points (nearest ones win)."""
    gw, gh = w // cell + 2, h // cell + 2
    F = []
    for gy in range(gh):
        y = gy * cell
        row = []
        for gx in range(gw):
            x = gx * cell
            ds = sorted(((x - p[0]) ** 2 + (y - p[1]) ** 2, p) for p in pts)[:8]
            sw = sx = sy = 0.0
            for d2, p in ds:
                wt = math.exp(-d2 / (2 * sigma * sigma)) + 1e-9
                sw += wt; sx += wt * p[2]; sy += wt * p[3]
            row.append((sx / sw, sy / sw))
        F.append(row)
    return F


def warp(B, wb, hb, F, w, h, cell=8):
    out = []
    for y in range(h):
        gy, fy = divmod(y, cell)
        fy /= cell
        row = []
        for x in range(w):
            gx, fx = divmod(x, cell)
            fx /= cell
            a, b, c, d = F[gy][gx], F[gy][gx + 1], F[gy + 1][gx], F[gy + 1][gx + 1]
            dx = (a[0] * (1 - fx) + b[0] * fx) * (1 - fy) + (c[0] * (1 - fx) + d[0] * fx) * fy
            dy = (a[1] * (1 - fx) + b[1] * fx) * (1 - fy) + (c[1] * (1 - fx) + d[1] * fx) * fy
            sx = min(wb - 1, max(0, int(round(x + dx))))
            sy = min(hb - 1, max(0, int(round(y + dy))))
            p = B[sy][sx]
            row.append((p[0], p[1], p[2], 255))
        out.append(row)
    return out


def main():
    ref, red, out = sys.argv[1:4]
    top = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else 0
    rng = int(sys.argv[sys.argv.index('--range') + 1]) if '--range' in sys.argv else 100
    w, h, A = read_png(ref)
    wb, hb, B = read_png(red)
    GA, GB = grad(A, w, h), grad(B, wb, hb)
    pts = measure(GA, GB, top, -rng // 8, rng // 2)
    print(len(pts), 'offset points (x, y, dx, dy):')
    for p in pts:
        print(' ', p)
    F = field(pts, w, h)
    img = warp(B, wb, hb, F, w, h)
    write_png(out, w, h, img)
    # check: remaining offset after warping
    G2 = grad(img, w, h)
    rest = measure(GA, G2, top, -8, 8, step=72)
    ds = [abs(p[2]) + abs(p[3]) for p in rest]
    print(f'{out}: {w}x{h}. Remaining offset at {len(rest)} points: max {max(ds) if ds else 0} px, '
          f'mean {sum(ds) / len(ds) if ds else 0:.1f} px (|dx| + |dy|, source px)')
    for p in rest:
        if abs(p[2]) + abs(p[3]) > 4:
            print('  still off:', p)


main()
