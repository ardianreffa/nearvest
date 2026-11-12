# The fishing pond's waterfall animation (Fishing package 4, Ardian 2026-11-12, docs/PLAN-fishing.md
# section 12): the water flows with the picture's OWN waterfall colours, only where the waterfall is.
#  - mask: the falling water in the DAY picture (bright or cyan pixels in the waterfall box, specks
#    without water neighbours dropped); the dusk and night pictures line up with it.
#  - texture per picture: for each column, that column's waterfall colours repeated top to bottom, so
#    the strip can slide down endlessly (CSS) inside the mask.
# Usage: python3 -I tools/pixelize/pond_fall.py <day.png> <dusk.png> <night.png> <out dir> [X0 Y0 X1 Y1 name]
# Writes fishing-fall-mask.png and fishing-fall-<day|dusk|night>.png (58 x 56); with a box and a name
# (the phone pond, 2026-11-12) fishing-fall-<name>-mask.png and fishing-fall-<name>-<time>.png.
# Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

X0, Y0, X1, Y1 = 376, 0, 434, 56  # the waterfall box (pond grid px), exclusive end
day, dusk, night, out = sys.argv[1:5]
prefix = 'fishing-fall'
if len(sys.argv) > 9:
    X0, Y0, X1, Y1 = map(int, sys.argv[5:9])
    prefix = f'fishing-fall-{sys.argv[9]}'
W, H = X1 - X0, Y1 - Y0
_, _, dp = read_png(day)
wet = lambda p: (p[2] > p[0] + 30 and p[2] > 150) or min(p[:3]) > 180
m = [[wet(dp[Y0 + y][X0 + x]) for x in range(W)] for y in range(H)]
# drop lone specks (spray dots): keep a pixel with at least 3 wet neighbours
mask = [[m[y][x] and sum(m[y + dy][x + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1) if (dx or dy) and 0 <= y + dy < H and 0 <= x + dx < W) >= 3 for x in range(W)] for y in range(H)]
write_png(os.path.join(out, f'{prefix}-mask.png'), W, H, [[(255, 255, 255, 255) if mask[y][x] else (0, 0, 0, 0) for x in range(W)] for y in range(H)])

for name, path in (('day', day), ('dusk', dusk), ('night', night)):
    _, _, px = read_png(path)
    # Only the water's own light colours: in the dusk / night pictures some masked pixels are darker rock
    # (dark specks in the flow, package 5), so pixels darker than 80% of the waterfall's median are left out.
    lum = lambda p: 0.3 * p[0] + 0.59 * p[1] + 0.11 * p[2]
    wet_px = sorted(lum(px[Y0 + y][X0 + x]) for y in range(H) for x in range(W) if mask[y][x])
    floor = 0.8 * wet_px[len(wet_px) // 2]
    bright_all = [tuple(px[Y0 + y][X0 + x][:3]) for y in range(H) for x in range(W) if mask[y][x] and lum(px[Y0 + y][X0 + x]) >= floor]
    cols = []
    for x in range(W):
        seq = [tuple(px[Y0 + y][X0 + x][:3]) for y in range(H) if mask[y][x] and lum(px[Y0 + y][X0 + x]) >= floor]
        if not seq and any(mask[y][x] for y in range(H)):
            seq = bright_all[x::W] or bright_all[:1]
        cols.append(seq)
    rows = []
    for y in range(H):
        rows.append([(cols[x][y % len(cols[x])] + (255,)) if cols[x] else (0, 0, 0, 0) for x in range(W)])
    write_png(os.path.join(out, f'{prefix}-{name}.png'), W, H, rows)
print(f'waterfall mask + 3 textures ({W}x{H}) -> {out}')
