# The fishing pond's waterfall animation (Fishing package 4, Ardian 2026-11-12, docs/PLAN-fishing.md
# section 12): the water flows with the picture's OWN waterfall colours, only where the waterfall is.
#  - mask: the falling water in the DAY picture (bright or cyan pixels in the waterfall box, specks
#    without water neighbours dropped); the dusk and night pictures line up with it.
#  - texture per picture: for each column, that column's waterfall colours repeated top to bottom, so
#    the strip can slide down endlessly (CSS) inside the mask.
# Usage: python3 -I tools/pixelize/pond_fall.py <day.png> <dusk.png> <night.png> <out dir>
# Writes fishing-fall-mask.png and fishing-fall-<day|dusk|night>.png (58 x 56). Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

X0, Y0, X1, Y1 = 376, 0, 434, 56  # the waterfall box (pond grid px), exclusive end
W, H = X1 - X0, Y1 - Y0

day, dusk, night, out = sys.argv[1:5]
_, _, dp = read_png(day)
wet = lambda p: (p[2] > p[0] + 30 and p[2] > 150) or min(p[:3]) > 180
m = [[wet(dp[Y0 + y][X0 + x]) for x in range(W)] for y in range(H)]
# drop lone specks (spray dots): keep a pixel with at least 3 wet neighbours
mask = [[m[y][x] and sum(m[y + dy][x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx or dy) and 0 <= y + dy < H and 0 <= x + dx < W) >= 3 for x in range(W)] for y in range(H)]
write_png(os.path.join(out, 'fishing-fall-mask.png'), W, H, [[(255, 255, 255, 255) if mask[y][x] else (0, 0, 0, 0) for x in range(W)] for y in range(H)])

for name, path in (('day', day), ('dusk', dusk), ('night', night)):
    _, _, px = read_png(path)
    cols = []
    for x in range(W):
        seq = [tuple(px[Y0 + y][X0 + x][:3]) for y in range(H) if mask[y][x]]
        cols.append(seq)
    rows = []
    for y in range(H):
        rows.append([(cols[x][y % len(cols[x])] + (255,)) if cols[x] else (0, 0, 0, 0) for x in range(W)])
    write_png(os.path.join(out, f'fishing-fall-{name}.png'), W, H, rows)
print(f'waterfall mask + 3 textures ({W}x{H}) -> {out}')
