# Installs Ardian's upright (9:16) fishing pond (Fishing package 6, docs/PLAN-fishing.md section 14):
# the picture is the 16:9 pond extended up and down. This finds where the 16:9 picture sits in it
# (the row where they match best, and how well every part lines up), so the game draws the whole
# 16:9 scene in that band (web/src/art/pond-tall.ts), and prints the config to paste there.
# Steps:
#   python3 -I tools/pixelize/pixelize.py docs/art-source/fishing-pond-tall.png <rows> <dir> --keep-bg --hq --colors 96
#     (<rows> = 480 * height / width of the picture, e.g. 853 for 1080x1920)
#   python3 -I tools/pixelize/pond_tall.py <dir>/bg.png web/public/assets/bg/fishing-pond.png
#     -> band row + per-part check; copy <dir>/bg.png to web/public/assets/bg/fishing-pond-tall.png
# STOP if a part is off by more than 1 px (the picture's middle is not the same as the 16:9 pond).
# Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png

tall, day = sys.argv[1:3]
tw, th, tp = read_png(tall)
dw, dh, dp = read_png(day)
assert tw == dw == 480, f'both pictures must be 480 px wide ({tw}, {dw})'


def grad(px, w, h):
    L = [[sum(q[:3]) / 3 for q in r] for r in px]
    return [[abs(L[y][x + 1] - L[y][x - 1]) + abs(L[y + 1][x] - L[y - 1][x]) if 0 < x < w - 1 and 0 < y < h - 1 else 0 for x in range(w)] for y in range(h)]


gt, gd = grad(tp, tw, th), grad(dp, dw, dh)
# 1) the band: the row offset where the whole 16:9 picture matches best
best = None
for off in range(0, th - dh + 1):
    s = 0
    for y in range(4, dh - 4, 3):
        rt, rd = gt[off + y], gd[y]
        for x in range(4, dw - 4, 3):
            s += (rt[x] - rd[x]) ** 2
    if best is None or s < best[0]:
        best = (s, off)
band = best[1]
# 2) every part at that band: best local shift (should be 0)
parts = {
    'dock': (0, 100, 80, 140), 'lily pads left': (75, 165, 145, 205), 'lily pads top': (130, 60, 195, 90),
    'rocks top bank': (150, 20, 300, 55), 'waterfall': (350, 0, 480, 70), 'rocks bottom bank': (130, 200, 270, 262),
}
worst = 0
for name, (x0, y0, x1, y1) in parts.items():
    b = None
    for dy in range(-3, 4):
        for dx in range(-3, 4):
            s = 0
            for y in range(max(y0, 4), min(y1, dh - 4)):
                for x in range(max(x0, 4), min(x1, dw - 4)):
                    yy, xx = band + y + dy, x + dx
                    if 0 <= yy < th and 0 <= xx < tw:
                        s += (gd[y][x] - gt[yy][xx]) ** 2
            if b is None or s < b[0]:
                b = (s, dx, dy)
    worst = max(worst, abs(b[1]), abs(b[2]))
    print(f'  {name:18s} shift dx={b[1]:+d} dy={b[2]:+d}')
print(f'band: the 16:9 pond starts at row {band} of {th}')
print('OK: lines up' if worst <= 1 else 'STOP: a part is off by more than 1 px')
print(f"\nexport const TALL_POND: TallPond | null = {{ h: {th}, band: {band}, src: {{ day: '/assets/bg/fishing-pond-tall.png' }} }};")
