# The swaying tree crown of the fishing pond at dusk / night (Fishing, 2026-11-12, docs/ASSETS.md):
# the same pixels as the day layer (tools/pixelize/pond_clean.py TREE box and leaf mask, taken from the
# DAY picture, because at night the leaves are not green), coloured from the dusk / night picture.
# Usage: python3 -I tools/pixelize/pond_tree.py <day bg.png> <dusk-or-night bg.png> <out tree.png>
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

TREE = (0, 0, 79, 40)  # same box as pond_clean.py
day, other, out = sys.argv[1:4]
_, _, dp = read_png(day)
_, _, op = read_png(other)
x0, y0, x1, y1 = TREE
leafy = lambda p: p[1] >= p[0] and p[1] > p[2] + 10
write_png(out, x1 - x0 + 1, y1 - y0 + 1,
          [[tuple(op[y][x][:3]) + (255,) if leafy(dp[y][x][:3]) else (0, 0, 0, 0) for x in range(x0, x1 + 1)] for y in range(y0, y1 + 1)])
print(out)
