# Turns an AI "pixel art" image (white or flat background) into a clean pixel sprite.
# - removes the background with a flood fill from the edges (inner whites stay)
# - downsamples to ROWS rows using the dominant color of each cell
# - snaps colors to the game palette (GDD colors + metal/straw/skin tones)
# Usage: python3 -I tools/pixelize/pixelize.py input.png ROWS out_dir [--keep-bg [--colors N] [--key RRGGBB]]
# Writes out_dir/sprite.json (rows + palette) and out_dir/preview-x8.png.
# --keep-bg is for full backgrounds: no background removal, an adaptive palette
# (median cut, N colors, default 48) whose colors close to the GDD colors are
# snapped to them exactly, and out_dir/bg.png at 1 pixel per cell.
# Used for the official TaniBot and the garden backdrop (docs/ASSETS.md). Standard library only.
import sys, os, json, collections
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

src, ROWS, out = sys.argv[1], int(sys.argv[2]), sys.argv[3]
keep_bg = '--keep-bg' in sys.argv
os.makedirs(out, exist_ok=True)
w, h, px = read_png(src)

def white(p): return p[0] > 228 and p[1] > 228 and p[2] > 228

PAL = {
  'k': (0x1B, 0x1B, 0x2F), 'v': (0x0B, 0x12, 0x20), 'D': (0x4B, 0x55, 0x63), 'm': (0x9C, 0xA3, 0xAF),
  'n': (0xD1, 0xD5, 0xDB), 'w': (0xF3, 0xF4, 0xF6), 'g': (0x00, 0xEC, 0x97), 'G': (0x0B, 0x8F, 0x5F),
  'f': (0x2E, 0x7D, 0x4F), 'F': (0x1E, 0x5A, 0x38), 'c': (0x22, 0xD3, 0xEE), 'C': (0xA5, 0xF3, 0xFC),
  'h': (0xE9, 0xB8, 0x62), 'H': (0xC9, 0x8E, 0x3E), 'b': (0x9A, 0x63, 0x2A), 's': (0x6B, 0x4A, 0x2F),
  'S': (0x4A, 0x32, 0x1F), 'o': (0xC8, 0x74, 0x2C), 'y': (0xF5, 0xC5, 0x42), 'l': (0xE0, 0xB4, 0x8A),
  'u': (0x1E, 0x40, 0xAF), 'U': (0x7F, 0xD3, 0xF2), 'p': (0x8B, 0x5C, 0xF6), 'r': (0xE5, 0x48, 0x4D),
}
def dist(a, b):
    dr, dg, db = a[0]-b[0], a[1]-b[1], a[2]-b[2]
    return 2*dr*dr + 4*dg*dg + 3*db*db
def nearest(c): return min(PAL, key=lambda k: dist(c, PAL[k]))

if keep_bg:
    from background import pixelize_background
    n = int(sys.argv[sys.argv.index('--colors') + 1]) if '--colors' in sys.argv else 48
    key = sys.argv[sys.argv.index('--key') + 1] if '--key' in sys.argv else None
    pixelize_background(w, h, px, ROWS, n, out, tuple(int(key[i:i + 2], 16) for i in (0, 2, 4)) if key else None)
    sys.exit(0)
else:
    xs = [x for y in range(0, h, 3) for x in range(0, w, 3) if not white(px[y][x])]
    ys = [y for y in range(0, h, 3) for x in range(0, w, 3) if not white(px[y][x])]
    x0, y0, x1, y1 = min(xs), min(ys), max(xs), max(ys)
cell = (y1 - y0 + 1) / ROWS
cols = int(round((x1 - x0 + 1) / cell))

grid, whiteish = [], []
for r in range(ROWS):
    row, wrow = '', []
    for q in range(cols):
        cx0, cy0 = x0 + q * cell, y0 + r * cell
        counts, whites, total = collections.Counter(), 0, 0
        for yy in range(int(cy0 + cell * 0.15), int(cy0 + cell * 0.85) + 1):
            for xx in range(int(cx0 + cell * 0.15), int(cx0 + cell * 0.85) + 1):
                if yy >= h or xx >= w: continue
                p = px[yy][xx]; total += 1
                if white(p) and not keep_bg: whites += 1
                else: counts[nearest(p)] += 1
        is_white = total == 0 or whites > total * 0.5
        wrow.append(is_white)
        row += 'w' if is_white else counts.most_common(1)[0][0]
    grid.append(row); whiteish.append(wrow)

if not keep_bg:
    bg = [[False] * cols for _ in range(ROWS)]
    stack = [(r, q) for r in range(ROWS) for q in (0, cols - 1)] + [(r, q) for q in range(cols) for r in (0, ROWS - 1)]
    while stack:
        r, q = stack.pop()
        if not (0 <= r < ROWS and 0 <= q < cols) or bg[r][q] or not whiteish[r][q]: continue
        bg[r][q] = True
        stack += [(r + 1, q), (r - 1, q), (r, q + 1), (r, q - 1)]
    grid = [''.join('.' if bg[r][q] else grid[r][q] for q in range(cols)) for r in range(ROWS)]

json.dump({'rows': grid, 'palette': {k: '#%02X%02X%02X' % v for k, v in PAL.items()}}, open(f'{out}/sprite.json', 'w'))
Z = 8
rows_rgba = []
for row in grid:
    line = []
    for c in row: line += [(0, 0, 0, 0) if c == '.' else PAL[c] + (255,)] * Z
    rows_rgba += [line] * Z
write_png(f'{out}/preview-x8.png', cols * Z, ROWS * Z, rows_rgba)
print(f'{cols}x{ROWS} sprite, cell {cell:.2f}px ->', out)
