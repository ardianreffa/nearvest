# Background mode for pixelize.py (--keep-bg): turns a full AI "pixel art" scene
# into a sharp 1x pixel image.
# 1. Each cell takes its dominant color (mode of coarse color bins, averaged).
# 2. A median-cut palette of N colors is built from the cell colors.
# 3. For each GDD color, the closest palette color (if close) is snapped to it exactly.
# 4. Writes out_dir/bg.png (1 px per cell), out_dir/preview-x4.png and palette.json.
import collections, json
from png import write_png

GDD = {  # GDD colors (docs/NEARvest-Game-Design-Document.pdf)
    'leaf': (0x2E, 0x7D, 0x4F), 'soil': (0x6B, 0x4A, 0x2F), 'mint': (0x00, 0xEC, 0x97),
    'cyan': (0x22, 0xD3, 0xEE), 'gold': (0xF5, 0xC5, 0x42), 'purple': (0x8B, 0x5C, 0xF6),
}
SNAP = 2600  # weighted squared distance (about 15 per channel)


def dist(a, b):
    dr, dg, db = a[0] - b[0], a[1] - b[1], a[2] - b[2]
    return 2 * dr * dr + 4 * dg * dg + 3 * db * db


def dominant(px, x0, y0, x1, y1):
    bins = collections.defaultdict(list)
    for y in range(y0, y1):
        row = px[y]
        for x in range(x0, x1):
            p = row[x]
            bins[(p[0] >> 4, p[1] >> 4, p[2] >> 4)].append(p)
    best = max(bins.values(), key=len)
    n = len(best)
    return tuple(sum(p[i] for p in best) // n for i in range(3))


def median_cut(colors, n):
    boxes = [colors]
    while len(boxes) < n:
        # split the box with the widest channel range (weighted by size)
        def score(b):
            return max(max(c[i] for c in b) - min(c[i] for c in b) for i in range(3)) * (len(b) ** 0.5)
        boxes.sort(key=score)
        b = boxes.pop()
        if len(b) < 2:
            boxes.append(b)
            break
        ch = max(range(3), key=lambda i: max(c[i] for c in b) - min(c[i] for c in b))
        b.sort(key=lambda c: c[ch])
        mid = len(b) // 2
        boxes += [b[:mid], b[mid:]]
    return [tuple(sum(c[i] for c in b) // len(b) for i in range(3)) for b in boxes if b]


def pixelize_background(w, h, px, rows, ncolors, out):
    cell = h / rows
    cols = int(round(w / cell))
    cellw = w / cols
    cells = []
    for r in range(rows):
        line = []
        for q in range(cols):
            x0, y0 = q * cellw, r * cell
            line.append(dominant(px, int(x0 + cellw * 0.2), int(y0 + cell * 0.2),
                                 max(int(x0 + cellw * 0.8), int(x0 + cellw * 0.2) + 1),
                                 max(int(y0 + cell * 0.8), int(y0 + cell * 0.2) + 1)))
        cells.append(line)

    pal = median_cut([c for line in cells for c in line], ncolors)
    # Snap only the single closest palette color to each GDD color, so shades
    # (sky gradient, foliage) are kept and the GDD colors appear exactly.
    snapped = {}
    for name, g in GDD.items():
        i = min(range(len(pal)), key=lambda k: dist(pal[k], g))
        if dist(pal[i], g) < SNAP and pal[i] not in GDD.values():
            pal[i] = g
            snapped[name] = True
    pal = list(dict.fromkeys(pal))
    cache = {}

    def near(c):
        if c not in cache:
            cache[c] = min(pal, key=lambda p: dist(c, p))
        return cache[c]

    img = [[near(c) + (255,) for c in line] for line in cells]
    write_png(f'{out}/bg.png', cols, rows, img)
    Z = 4
    big = []
    for line in img:
        wide = [p for p in line for _ in range(Z)]
        big += [wide] * Z
    write_png(f'{out}/preview-x4.png', cols * Z, rows * Z, big)
    json.dump({'size': [cols, rows], 'palette': ['#%02X%02X%02X' % c for c in pal], 'snapped_to_gdd': snapped},
              open(f'{out}/palette.json', 'w'), indent=1)
    print(f'{cols}x{rows} background, cell {cell:.2f}px, {len(pal)} colors, GDD snaps {snapped} ->', out)
