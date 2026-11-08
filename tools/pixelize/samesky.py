# Gives a converted night (or dusk) village exactly the same cut-out sky as the day village, so the
# day -> night cross-fade never flickers along the skyline (roofs, trees, the mountain's edge).
# Where the day is sky, the night becomes sky too; where the day has a pixel but the night is sky,
# the night takes the colour of its nearest opaque pixel.
# Usage: python3 -I tools/pixelize/samesky.py DAY.png NIGHT.png OUT.png   (standard library only)
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png


def main():
    day, night, out = sys.argv[1:4]
    w, h, D = read_png(day, alpha=True)
    wn, hn, N = read_png(night, alpha=True)
    assert (w, h) == (wn, hn), 'day and night must have the same size'
    img = [row[:] for row in N]
    cut = filled = 0
    for y in range(h):
        for x in range(w):
            if D[y][x][3] == 0:
                if img[y][x][3]:
                    cut += 1
                img[y][x] = (0, 0, 0, 0)
    for y in range(h):
        for x in range(w):
            if D[y][x][3] and not N[y][x][3]:
                best = None
                for r in range(1, 8):
                    for yy in range(max(0, y - r), min(h, y + r + 1)):
                        for xx in range(max(0, x - r), min(w, x + r + 1)):
                            if N[yy][xx][3] and D[yy][xx][3]:
                                d = (yy - y) ** 2 + (xx - x) ** 2
                                if best is None or d < best[0]:
                                    best = (d, N[yy][xx])
                    if best:
                        break
                img[y][x] = best[1] if best else D[y][x]
                filled += 1
    write_png(out, w, h, img)
    print(f'{out}: {cut} night pixels cut to sky, {filled} filled from their neighbours')


main()
