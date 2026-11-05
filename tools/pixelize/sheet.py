# Turns an AI "pixel art" sprite sheet (several figures on a white background)
# into clean pixel sprites that share one palette.
# - cell size is fixed (--cell PX), so every figure gets the same pixel size
# - each cell takes its dominant color (white pixels ignored)
# - background = white cells reached from the edges, plus enclosed white areas
#   bigger than --holes cells (small whites such as eye highlights stay)
# - adaptive palette (median cut, --colors N) shared by all figures, with the
#   closest colors snapped exactly to the GDD colors
# - figures are split where a full column is empty; --main-only 0,1 keeps only
#   the biggest shape of those figures (drops floating sparkles)
# Usage: python3 -I tools/pixelize/sheet.py input.png out_dir --cell 9.6 [--colors 40] [--holes 6] [--main-only 0,1,2]
# Writes out_dir/sheet.json ({palette, sprites: [{x, y, rows}]}) and out_dir/preview-x6.png.
# Standard library only.
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png
from background import GDD, SNAP, dist, median_cut
import collections


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


src, out = sys.argv[1], sys.argv[2]
cell = float(arg('--cell', '8'))
ncolors = int(arg('--colors', '40'))
holes = int(arg('--holes', '6'))
main_only = {int(i) for i in arg('--main-only', '').split(',') if i != ''}
os.makedirs(out, exist_ok=True)
w, h, px = read_png(src)


def white(p):
    return p[0] > 228 and p[1] > 228 and p[2] > 228


rows, cols = int(h // cell), int(w // cell)
color = [[None] * cols for _ in range(rows)]
for r in range(rows):
    for q in range(cols):
        bins, whites, total = collections.defaultdict(list), 0, 0
        for y in range(int(r * cell + cell * 0.2), int(r * cell + cell * 0.8) + 1):
            for x in range(int(q * cell + cell * 0.2), int(q * cell + cell * 0.8) + 1):
                if y >= h or x >= w:
                    continue
                p = px[y][x]
                total += 1
                if white(p):
                    whites += 1
                bins[(p[0] >> 4, p[1] >> 4, p[2] >> 4)].append(p)
        if total == 0 or whites > total * 0.5:
            continue  # white cell
        best = max((b for k, b in bins.items() if not white(b[0])), key=len, default=None)
        if best:
            color[r][q] = tuple(sum(p[i] for p in best) // len(best) for i in range(3))

# White areas: those touching the edge, and big enclosed ones, are background.
bg = [[False] * cols for _ in range(rows)]
seen = [[False] * cols for _ in range(rows)]
for r in range(rows):
    for q in range(cols):
        if color[r][q] is not None or seen[r][q]:
            continue
        comp, stack, edge = [], [(r, q)], False
        seen[r][q] = True
        while stack:
            a, b = stack.pop()
            comp.append((a, b))
            if a in (0, rows - 1) or b in (0, cols - 1):
                edge = True
            for n in ((a + 1, b), (a - 1, b), (a, b + 1), (a, b - 1)):
                if 0 <= n[0] < rows and 0 <= n[1] < cols and not seen[n[0]][n[1]] and color[n[0]][n[1]] is None:
                    seen[n[0]][n[1]] = True
                    stack.append(n)
        if edge or len(comp) > holes:
            for a, b in comp:
                bg[a][b] = True
WHITE = (0xF3, 0xF4, 0xF6)
for r in range(rows):
    for q in range(cols):
        if color[r][q] is None and not bg[r][q]:
            color[r][q] = WHITE

pal = median_cut([c for line in color for c in line if c is not None], ncolors)
for name, g in GDD.items():
    i = min(range(len(pal)), key=lambda k: dist(pal[k], g))
    if dist(pal[i], g) < SNAP and pal[i] not in GDD.values():
        pal[i] = g
pal = list(dict.fromkeys(pal))
CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
assert len(pal) <= len(CHARS)
cache = {}


def char(c):
    if c not in cache:
        cache[c] = CHARS[min(range(len(pal)), key=lambda i: dist(c, pal[i]))]
    return cache[c]


grid = [[char(c) if c is not None and not bg[r][q] else '.' for q, c in enumerate(line)] for r, line in enumerate(color)]

# Split into figures at empty columns.
used = [any(grid[r][q] != '.' for r in range(rows)) for q in range(cols)]
spans, q = [], 0
while q < cols:
    if used[q]:
        s = q
        while q < cols and used[q]:
            q += 1
        spans.append((s, q))
    q += 1

sprites = []
for idx, (c0, c1) in enumerate(spans):
    sub = [row[c0:c1] for row in grid]
    if idx in main_only:
        seen, comps = set(), []
        for r in range(rows):
            for q in range(c1 - c0):
                if sub[r][q] == '.' or (r, q) in seen:
                    continue
                comp, stack = [], [(r, q)]
                seen.add((r, q))
                while stack:
                    a, b = stack.pop()
                    comp.append((a, b))
                    for da in (-1, 0, 1):
                        for db in (-1, 0, 1):
                            n = (a + da, b + db)
                            if 0 <= n[0] < rows and 0 <= n[1] < c1 - c0 and n not in seen and sub[n[0]][n[1]] != '.':
                                seen.add(n)
                                stack.append(n)
                comps.append(comp)
        keep = set(max(comps, key=len))
        sub = [[c if (r, q) in keep else '.' for q, c in enumerate(row)] for r, row in enumerate(sub)]
    ys = [r for r in range(rows) if any(c != '.' for c in sub[r])]
    xs = [q for q in range(c1 - c0) if any(sub[r][q] != '.' for r in range(rows))]
    r0, r1, q0, q1 = min(ys), max(ys) + 1, min(xs), max(xs) + 1
    sprites.append({'x': c0 + q0, 'y': r0, 'rows': [''.join(sub[r][q0:q1]) for r in range(r0, r1)]})

palette = {CHARS[i]: '#%02X%02X%02X' % c for i, c in enumerate(pal)}
json.dump({'cell': cell, 'palette': palette, 'sprites': sprites}, open(f'{out}/sheet.json', 'w'), indent=1)

Z = 6
img = [[(150, 160, 150, 255)] * cols for _ in range(rows)]
for s in sprites:  # the kept sprites at their place on the sheet, on grey
    for r, row in enumerate(s['rows']):
        for q, c in enumerate(row):
            if c != '.':
                img[s['y'] + r][s['x'] + q] = pal[CHARS.index(c)] + (255,)
big = []
for line in img:
    l2 = [p for p in line for _ in range(Z)]
    big += [l2] * Z
write_png(f'{out}/preview-x6.png', cols * Z, rows * Z, big)
print(f'{cols}x{rows} cells, {len(pal)} colors, {len(sprites)} sprites:', [(len(s["rows"][0]), len(s["rows"])) for s in sprites])
