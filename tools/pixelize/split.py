# Splits a sprite into two PNGs of the same size: the box X0 Y0 X1 Y1 (sprite pixels, X1/Y1
# exclusive) goes to out_part.png, everything else to out_rest.png. Used for the fishing rod: the
# float (and the bottom of its line) is its own layer so it can sway while the rod stays still.
# Usage: python3 -I tools/pixelize/split.py sprite.png X0 Y0 X1 Y1 out_rest.png out_part.png
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

src, x0, y0, x1, y1, rest_out, part_out = sys.argv[1], *map(int, sys.argv[2:6]), sys.argv[6], sys.argv[7]
w, h, px = read_png(src, alpha=True)
inside = lambda x, y: x0 <= x < x1 and y0 <= y < y1
clear = (0, 0, 0, 0)
write_png(rest_out, w, h, [[clear if inside(x, y) else px[y][x] for x in range(w)] for y in range(h)])
write_png(part_out, w, h, [[px[y][x] if inside(x, y) else clear for x in range(w)] for y in range(h)])
print(f'{w}x{h}: box {x0},{y0}-{x1},{y1} -> {rest_out} + {part_out}')
