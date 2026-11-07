# TaniBot evolutions: turns Ardian's ChatGPT images (docs/art-source/tanibot-<title>.png)
# into sprites on EXACTLY the grid of the original TaniBot (58x64, web/src/art/tanibot-sprite.ts),
# so the animated layers (eyes, hat LEDs, chest screen) line up in every version.
#
# 1. Registration: the two cyan eyes (identical in every version) and the visor width are
#    found in the original and in each new image; the original's pixel grid is moved and
#    scaled onto the new image by them.
# 2. Body only: the background is flood-filled from the edges; everything not connected
#    to the body (drones, halo ring, sparkles) is dropped; with --aura the pale cyan glow
#    outside the dark outline counts as background too (Legend).
# 3. Each cell takes the dominant palette color (same palette as pixelize.py).
# 4. Layers: the original's eye / LED / screen positions are checked in the new sprite
#    (match rate, best shift); matching cells get the layer letters (e/E, L/l, g/G).
#
# Usage: python3 -I tools/pixelize/evolve.py ORIGINAL.png ORIGINAL_SPRITE.ts OUT_DIR NAME=IMAGE.png[:aura] ... [--factor N]
# --factor N samples an N times finer grid (for comparing detail); layers are only matched at N = 1.
# Writes OUT_DIR/evolutions.json and OUT_DIR/<name>-x8.png. Standard library only.
import sys, os, json, re, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

PAL = {
  'k': (0x1B, 0x1B, 0x2F), 'v': (0x0B, 0x12, 0x20), 'D': (0x4B, 0x55, 0x63), 'm': (0x9C, 0xA3, 0xAF),
  'n': (0xD1, 0xD5, 0xDB), 'w': (0xF3, 0xF4, 0xF6), 'g': (0x00, 0xEC, 0x97), 'G': (0x0B, 0x8F, 0x5F),
  'f': (0x2E, 0x7D, 0x4F), 'F': (0x1E, 0x5A, 0x38), 'c': (0x22, 0xD3, 0xEE), 'C': (0xA5, 0xF3, 0xFC),
  'h': (0xE9, 0xB8, 0x62), 'H': (0xC9, 0x8E, 0x3E), 'b': (0x9A, 0x63, 0x2A), 's': (0x6B, 0x4A, 0x2F),
  'S': (0x4A, 0x32, 0x1F), 'o': (0xC8, 0x74, 0x2C), 'y': (0xF5, 0xC5, 0x42), 'l': (0xE0, 0xB4, 0x8A),
  'u': (0x1E, 0x40, 0xAF), 'U': (0x7F, 0xD3, 0xF2), 'p': (0x8B, 0x5C, 0xF6), 'r': (0xE5, 0x48, 0x4D),
}
# 'l' (skin) is never used by TaniBot; it is the LED highlight letter in the original sprite.
SPRITE_PAL = {k: v for k, v in PAL.items() if k != 'l'}

def dist(a, b):
    dr, dg, db = a[0]-b[0], a[1]-b[1], a[2]-b[2]
    return 2*dr*dr + 4*dg*dg + 3*db*db

_cache = {}
def nearest(c):
    key = (c[0] >> 2, c[1] >> 2, c[2] >> 2)
    if key not in _cache:
        _cache[key] = min(SPRITE_PAL, key=lambda k: dist(c, SPRITE_PAL[k]))
    return _cache[key]

def white(p): return p[0] > 228 and p[1] > 228 and p[2] > 228
def dark(p): return p[0] < 48 and p[1] < 56 and p[2] < 80
def aura(p):  # pale / bright cyan glow (Legend), never the dark outline
    return p[2] > 190 and p[1] > 185 and p[0] < 215 and not white(p)

def visor_box(w, h, px):
    """Rows whose longest run of dark pixels is long are visor rows (the outline is thin)."""
    rows = []
    for y in range(0, int(h * 0.7), 2):
        best, run, start, best_start = 0, 0, 0, 0
        for x in range(w):
            if dark(px[y][x]):
                if run == 0: start = x
                run += 1
                if run > best: best, best_start = run, start
            else:
                run = 0
        if best > w * 0.2:
            rows.append((y, best_start, best_start + best))
    ys = [r[0] for r in rows]
    lefts = sorted(r[1] for r in rows); rights = sorted(r[2] for r in rows)
    return min(ys), max(ys), lefts[len(lefts) // 2], rights[len(rights) // 2]

def eye_box(w, h, px, visor):
    """Bounding box of the bright cyan eye pixels inside the visor."""
    t, b, l, r = visor
    xs, ys = [], []
    # The eyes sit in the upper part of the visor; its lower edge is not reliable, so use the width.
    for y in range(max(0, t), min(h, t + int(0.5 * (r - l))), 2):
        for x in range(l, r, 2):
            p = px[y][x]
            if p[0] < 140 and p[1] > 170 and p[2] > 200:
                xs.append(x); ys.append(y)
    return min(xs), min(ys), max(xs), max(ys)

def original_grid(w, h, px, rows_n):
    """The mapping pixelize.py used for the original (bounding box of non-white pixels)."""
    xs = [x for y in range(0, h, 3) for x in range(0, w, 3) if not white(px[y][x])]
    ys = [y for y in range(0, h, 3) for x in range(0, w, 3) if not white(px[y][x])]
    x0, y0, y1 = min(xs), min(ys), max(ys)
    return x0, y0, (y1 - y0 + 1) / rows_n

def body_mask(w, h, px, use_aura, seed, step=2):
    W, H = w // step, h // step
    bg = [[False] * W for _ in range(H)]
    def is_bg(x, y):
        p = px[y * step][x * step]
        return white(p) or (use_aura and aura(p))
    stack = [(x, y) for x in range(W) for y in (0, H - 1)] + [(x, y) for y in range(H) for x in (0, W - 1)]
    while stack:
        x, y = stack.pop()
        if not (0 <= x < W and 0 <= y < H) or bg[y][x] or not is_bg(x, y): continue
        bg[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    # Keep only the part connected to the body (the visor seed): drops drones, halo, sparkles.
    body = [[False] * W for _ in range(H)]
    sx, sy = seed[0] // step, seed[1] // step
    stack = [(sx, sy)]
    while stack:
        x, y = stack.pop()
        if not (0 <= x < W and 0 <= y < H) or body[y][x] or bg[y][x]: continue
        body[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    return body, step

def sample(w, h, px, x0, y0, cell, cols, rows_n, mask=None, step=2):
    grid = []
    for r in range(rows_n):
        line = ''
        for q in range(cols):
            cx0, cy0 = x0 + q * cell, y0 + r * cell
            counts, keep, total = collections.Counter(), 0, 0
            for yy in range(int(cy0 + cell * 0.15), int(cy0 + cell * 0.85) + 1, 2):
                for xx in range(int(cx0 + cell * 0.15), int(cx0 + cell * 0.85) + 1, 2):
                    if not (0 <= yy < h and 0 <= xx < w): continue
                    total += 1
                    inside = mask[yy // step][xx // step] if mask else not white(px[yy][xx])
                    if inside and not white(px[yy][xx]):
                        keep += 1
                        counts[nearest(px[yy][xx])] += 1
            line += counts.most_common(1)[0][0] if total and keep > total * 0.5 else '.'
        grid.append(line)
    return grid

def outside_count(mask, step, x0, y0, cell, cols, rows_n):
    n = 0
    for y, row in enumerate(mask):
        for x, v in enumerate(row):
            if not v: continue
            gx, gy = (x * step - x0) / cell, (y * step - y0) / cell
            if not (0 <= gx < cols and 0 <= gy < rows_n): n += 1
    return n

LAYERS = {'eyes': ('eE', set('cC')), 'leds': ('Ll', set('gCwnG')), 'screen': ('gG', set('gGf'))}

def layer_positions(rows, letters):
    return [(r, q, ch) for r, row in enumerate(rows) for q, ch in enumerate(row) if ch in letters]

def shift(rows, dx, dy):
    H, W = len(rows), len(rows[0])
    return [''.join(rows[r - dy][q - dx] if 0 <= r - dy < H and 0 <= q - dx < W else '.' for q in range(W)) for r in range(H)]

def score(rows, orig):
    total, hit = 0, 0
    for name, (letters, ok) in LAYERS.items():
        for r, q, _ in layer_positions(orig, letters):
            total += 1
            hit += rows[r][q] in ok
    return hit / total

def main():
    orig_png, orig_ts, out = sys.argv[1], sys.argv[2], sys.argv[3]
    jobs = []
    factor = 1
    args = sys.argv[4:]
    if '--factor' in args:
        i = args.index('--factor'); factor = int(args[i + 1]); args = args[:i] + args[i + 2:]
    for arg in args:
        name, rest = arg.split('=', 1)
        path, _, flag = rest.partition(':')
        jobs.append((name, path, flag == 'aura'))
    os.makedirs(out, exist_ok=True)
    orig_rows = json.loads(re.search(r'TANIBOT_ROWS: string\[\] = (\[.*?\]);', open(orig_ts).read(), re.S).group(1))
    rows_n, cols = len(orig_rows), len(orig_rows[0])

    w, h, px = read_png(orig_png)
    gx0, gy0, cell0 = original_grid(w, h, px, rows_n)
    vt, vb, vl, vr = visor_box(w, h, px)
    ex0, ey0, ex1, ey1 = eye_box(w, h, px, (vt, vb, vl, vr))
    # Check: re-sampling the original with this mapping must reproduce the original sprite.
    again = sample(w, h, px, gx0, gy0, cell0, cols, rows_n)
    base = lambda ch: {'e': 'v', 'E': 'v', 'L': 'g', 'l': 'C'}.get(ch, ch)
    same = sum(a == '.' and b == '.' or (a != '.' and b != '.') for ra, rb in zip(again, orig_rows) for a, b in zip(ra, rb))
    print(f'original: grid {cols}x{rows_n}, cell {cell0:.2f}px, visor x{vl}-{vr} y{vt}-{vb}, silhouette match {100 * same / (cols * rows_n):.1f}%')

    result = {}
    for name, path, use_aura in jobs:
        w, h, px = read_png(path)
        t, b, l, r = visor_box(w, h, px)
        a0, b0, a1, b1 = eye_box(w, h, px, (t, b, l, r))
        # Scale: eye span and visor width (both identical in every version); position: the eyes' center.
        s = ((a1 - a0) / (ex1 - ex0) + (r - l) / (vr - vl)) / 2
        cell = cell0 * s
        x0 = (a0 + a1) / 2 - ((ex0 + ex1) / 2 - gx0) * s
        y0 = (b0 + b1) / 2 - ((ey0 + ey1) / 2 - gy0) * s
        mask, step = body_mask(w, h, px, use_aura, ((l + r) // 2, t + 4))
        if factor > 1:
            rows = sample(w, h, px, x0, y0, cell / factor, cols * factor, rows_n * factor, mask, step)
            result[name] = rows
            print(f'{name}: {cols * factor}x{rows_n * factor} grid (no layer matching)')
            continue
        rows = sample(w, h, px, x0, y0, cell, cols, rows_n, mask, step)
        outside = outside_count(mask, step, x0, y0, cell, cols, rows_n)
        before = score(rows, orig_rows)
        best = max(((dx, dy) for dx in range(-2, 3) for dy in range(-2, 3)), key=lambda d: (score(shift(rows, *d), orig_rows), -abs(d[0]) - abs(d[1])))
        if best != (0, 0):
            rows = shift(rows, *best)
        # Put the layer letters where the original has them (if the color agrees).
        grid = [list(row) for row in rows]
        report = {}
        for lname, (letters, ok) in LAYERS.items():
            pos = layer_positions(orig_rows, letters)
            hit = 0
            for rr, qq, ch in pos:
                if grid[rr][qq] in ok:
                    grid[rr][qq] = ch
                    hit += 1
            report[lname] = f'{hit}/{len(pos)}'
        rows = [''.join(row) for row in grid]
        result[name] = rows
        print(f'{name}: scale {s:.3f}, eyes x{a0}-{a1} y{b0}-{b1}, layer match {100 * before:.0f}% -> shift {best} -> eyes {report["eyes"]}, LEDs {report["leds"]}, screen {report["screen"]}; body pixels outside the 58x64 grid: {outside}')

        Z = 8
        colors = dict(SPRITE_PAL, e=PAL['c'], E=PAL['C'], L=PAL['g'], l=(0xB9, 0xFF, 0xE3))
        img = []
        for row in rows:
            line = []
            for c in row:
                line += [(0, 0, 0, 0) if c == '.' else colors[c] + (255,)] * Z
            img += [line] * Z
        write_png(f'{out}/{name}-x8.png', cols * Z, rows_n * Z, img)
    json.dump(result, open(f'{out}/evolutions.json', 'w'))

main()
