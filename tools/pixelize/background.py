# Background mode for pixelize.py (--keep-bg): turns a full AI "pixel art" scene
# into a sharp 1x pixel image.
# 1. Each cell takes its dominant color (mode of coarse color bins, averaged).
# 2. A median-cut palette of N colors is built from the cell colors.
# 3. For each GDD color, the closest palette color (if close) is snapped to it exactly.
# 4. Writes out_dir/bg.png (1 px per cell), out_dir/preview-x4.png and palette.json.
# With a key colour (--key FF00FF, a magenta sky to cut out): key pixels and the magenta
# fringe that the AI paints on the edges of trees and roofs are left out of every cell;
# a cell that is mostly key becomes transparent, the others take the dominant non-key colour.
# High quality mode (hq=True, pixelize.py --hq, used from village v3 on):
# - smooth first: each cell takes the per-channel median of its dominant colour group (no noise);
# - pink fringe: soft magenta-ish pixels within 3 px of the key are cut out too, and pinkish
#   edge cells next to the cut-out sky are dropped;
# - palette: median cut, then the cell colours furthest from the palette are added (small bright
#   details such as red fruit keep their colour) and refined with a few k-means steps;
# - no dithering; single stray pixels that are close to the colour around them are cleaned up.
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


def keyish(p, key):
    """The key colour or its fringe: magenta-like (red and blue high, green far below both)."""
    if key is None:
        return False
    r, g, b = p[0], p[1], p[2]
    return dist(p, key) < 9000 or (r > 120 and b > 110 and g < 0.6 * min(r, b) and abs(r - b) < 110)


def pinkish(p):
    """Soft magenta fringe (anti-aliased sky edge): red and blue clearly above green and close to each
    other (pink), or a dark outline mixed with magenta (violet: blue far above green, red not below it)."""
    r, g, b = p[0], p[1], p[2]
    return (r - g > 35 and b - g > 35 and abs(r - b) < 80) or (b - g > 60 and r >= g - 10 and b > r)


def fringe_mask(w, h, px, key, ox=0, oy=0, sky_until=None):
    """Key pixels plus pinkish pixels within 3 px of them (source coordinates of the crop).
    `sky_until` (source row): below it nothing is cut (pink flowers in the grass stay)."""
    lim = h if sky_until is None else max(0, min(h, sky_until - oy))
    strong = [[y < lim and keyish(px[oy + y][ox + x], key) for x in range(w)] for y in range(h)]
    near = [[False] * w for _ in range(h)]
    R = 3
    for y in range(h):
        row = strong[y]
        for x in range(w):
            if row[x]:
                for yy in range(max(0, y - R), min(h, y + R + 1)):
                    nr = near[yy]
                    for xx in range(max(0, x - R), min(w, x + R + 1)):
                        nr[xx] = True
    full = [[False] * (ox + w) for _ in range(oy + h)]
    for y in range(h):
        for x in range(w):
            if strong[y][x] or (y < lim and near[y][x] and pinkish(px[oy + y][ox + x])):
                full[oy + y][ox + x] = True
    return full


def dominant_hq(px, x0, y0, x1, y1, mask=None):
    """Median colour of the dominant coarse colour group (smooths the AI noise before quantizing)."""
    bins = collections.defaultdict(list)
    masked = total = 0
    for y in range(y0, y1):
        row = px[y]
        mrow = mask[y] if mask is not None else None
        for x in range(x0, x1):
            total += 1
            if mrow is not None and mrow[x]:
                masked += 1
                continue
            p = row[x]
            bins[(p[0] >> 4, p[1] >> 4, p[2] >> 4)].append(p)
    if mask is not None and (masked * 2 >= total or not bins):
        return None
    best = max(bins.values(), key=len)
    # merge neighbouring bins that are nearly as big (a colour on a bin border)
    k0 = next(k for k, v in bins.items() if v is best)
    group = list(best)
    for k, v in bins.items():
        if v is not best and max(abs(k[i] - k0[i]) for i in range(3)) == 1 and len(v) * 2 >= len(best):
            group += v
    n = len(group)
    return tuple(sorted(p[i] for p in group)[n // 2] for i in range(3))


def palette_hq(cells, n):
    """Median cut + furthest colours + k-means, on a histogram of the cell colours."""
    hist = collections.Counter(c for line in cells for c in line if c is not None)
    cols = list(hist)
    extra = max(8, n // 6)
    pal = median_cut(list(hist.elements()), n - extra)
    near = {c: min(dist(c, p) for p in pal) for c in cols}
    for _ in range(extra):
        # the colour worst served by the palette, weighted a little by how often it occurs
        c = max(cols, key=lambda c: near[c] * min(hist[c], 12))
        if near[c] < 900:
            break
        pal.append(c)
        for k in cols:
            d = dist(k, c)
            if d < near[k]:
                near[k] = d
    for _ in range(5):
        sums = [[0, 0, 0, 0] for _ in pal]
        for c in cols:
            i = min(range(len(pal)), key=lambda j: dist(c, pal[j]))
            m = hist[c]
            s = sums[i]
            s[0] += c[0] * m; s[1] += c[1] * m; s[2] += c[2] * m; s[3] += m
        pal = [tuple(round(s[i] / s[3]) for i in range(3)) if s[3] else pal[j] for j, s in enumerate(sums)]
    return list(dict.fromkeys(pal))


def despeckle(img, w, h, limit=5600):
    """A pixel unlike all 8 neighbours, close to the colour most of them share, takes that colour."""
    out = [line[:] for line in img]
    fixed = 0
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            p = img[y][x]
            if p[3] == 0:
                continue
            nb = [img[y + dy][x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if dy or dx]
            if any(q[3] == 0 for q in nb) or p in nb:
                continue
            m, k = collections.Counter(nb).most_common(1)[0]
            if k >= 5 and dist(p, m) < limit:
                out[y][x] = m
                fixed += 1
    return out, fixed


def dominant(px, x0, y0, x1, y1, key=None, mask=None):
    bins = collections.defaultdict(list)
    keyed = total = 0
    for y in range(y0, y1):
        row = px[y]
        for x in range(x0, x1):
            p = row[x]
            total += 1
            if keyish(p, key) or (mask is not None and mask[y][x]):
                keyed += 1
                continue
            bins[(p[0] >> 4, p[1] >> 4, p[2] >> 4)].append(p)
    if (key is not None or mask is not None) and (keyed * 2 >= total or not bins):
        return None
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


def pixelize_background(w, h, px, rows, ncolors, out, key=None, mask=None, crop=None, cols=None, hq=False, sky_until=None):
    """`mask[y][x]` = True for background pixels (cut out); `crop` = (x0, y0, x1, y1) source box."""
    ox, oy = (crop[0], crop[1]) if crop else (0, 0)
    if crop:
        w, h = crop[2] - crop[0], crop[3] - crop[1]
    if hq and key is not None:
        fm = fringe_mask(w, h, px, key, ox, oy, sky_until)
        if mask is None:
            mask = fm
        else:
            mask = [[mask[y][x] or fm[y][x] for x in range(len(mask[0]))] for y in range(len(mask))]
        key = None
    cell = h / rows
    cols = cols or int(round(w / cell))
    cellw = w / cols
    cells = []
    for r in range(rows):
        line = []
        for q in range(cols):
            x0, y0 = ox + q * cellw, oy + r * cell
            box = (int(x0 + cellw * 0.2), int(y0 + cell * 0.2),
                   max(int(x0 + cellw * 0.8), int(x0 + cellw * 0.2) + 1),
                   max(int(y0 + cell * 0.8), int(y0 + cell * 0.2) + 1))
            line.append(dominant_hq(px, *box, mask) if hq else dominant(px, *box, key, mask))
        cells.append(line)

    if hq:
        # pinkish cells on the edge of the cut-out sky are fringe as well
        last = rows if sky_until is None else int((sky_until - oy) / cell)
        for r in range(min(rows, last)):
            for q in range(cols):
                c = cells[r][q]
                if c is not None and pinkish(c) and any(
                        0 <= r + dr < rows and 0 <= q + dq < cols and cells[r + dr][q + dq] is None
                        for dr, dq in ((-1, 0), (1, 0), (0, -1), (0, 1))):
                    cells[r][q] = None
        pal = palette_hq(cells, ncolors)
    else:
        pal = median_cut([c for line in cells for c in line if c is not None], ncolors)
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

    img = [[(0, 0, 0, 0) if c is None else near(c) + (255,) for c in line] for line in cells]
    if hq:
        img, fixed = despeckle(img, cols, rows)
        print(f'cleaned {fixed} stray pixels')
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
