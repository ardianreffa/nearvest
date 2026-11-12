# Fishing pond, package 2 (2026-11-12, docs/PLAN-fishing.md section 9): the frogs and ducks of the
# pixelized ChatGPT pond move in code, so they are taken OUT of the background here:
#  - each duck is painted over with a patch of water next to it;
#  - each frog is painted over with its lily pad's green (inside the pad) or water (outside).
# New ducks (awake / asleep, drake and hen) and a frog seen from above are drawn here from simple
# shapes (like the catch icons, tools/pixelize/catch_icons.py) into web/src/art/pond-sprites.ts; they
# swim and hop in code (art/pond-life.tsx).
# The big tree's leaves (top left) are copied to their own see-through layer that sways in CSS.
# Usage: python3 -I tools/pixelize/pond_clean.py <pixelized bg.png> <out.png> <out pond-sprites.ts> <out tree.png>
# (bg.png = pixelize.py docs/art-source/fishing-pond.png 270 <dir> --keep-bg --hq --colors 96).
# Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png

# Ducks: box (x0, y0, x1, y1) inclusive and where the water patch comes from (dx).
DUCKS = [((430, 111, 447, 125), -26), ((406, 130, 424, 144), -26), ((444, 146, 462, 160), -30)]
# Frogs: box, lily pad ellipse (cx, cy, rx, ry), dx of the water patch for pixels outside the pad.
FROGS = [
    ((144, 68, 156, 79), (149, 76, 12.5, 6.5), -22),
    ((303, 46, 312, 57), (307.5, 55, 12, 5.5), 22),
    ((442, 78, 451, 88), (446.5, 86.5, 12, 5.5), -22),
    ((102, 186, 111, 196), (104, 195, 12, 6), 22),
]
PAD = (0x69, 0xCA, 0x2A)


def is_water(p):
    r, g, b = p[:3]
    return b >= 0x60 and b > r + 40


src, out_png, out_ts, out_tree = sys.argv[1:5]
# The big tree's crown (image px, inclusive).
TREE = (0, 0, 79, 40)
w, h, px = read_png(src)
img = [[tuple(p[:3]) for p in row] for row in px]
orig = [row[:] for row in img]

for (x0, y0, x1, y1), dx in DUCKS:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            img[y][x] = orig[y][x + dx]

for (x0, y0, x1, y1), (cx, cy, rx, ry), dx in FROGS:
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            inside = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1
            img[y][x] = PAD if inside else orig[y][x + dx]

write_png(out_png, w, h, [[p + (255,) for p in row] for row in img])

tx0, ty0, tx1, ty1 = TREE
leafy = lambda p: p[1] >= p[0] and p[1] > p[2] + 10
write_png(out_tree, tx1 - tx0 + 1, ty1 - ty0 + 1,
          [[img[y][x] + (255,) if leafy(img[y][x]) else (0, 0, 0, 0) for x in range(tx0, tx1 + 1)] for y in range(ty0, ty1 + 1)])

# Where a duck may swim: a grid of 4 px cells; '#' = a duck (19 x 12 px plus a small margin) centred
# there covers only water (or white foam / ripple highlights): never land, the dock, rocks or lily pads.
CELL = 4
HALF_W, HALF_H = 11, 7
passable = [[is_water(p) or min(p) > 0xC8 for p in row] for row in img]
pre = [[0] * (w + 1) for _ in range(h + 1)]
for y in range(h):
    for x in range(w):
        pre[y + 1][x + 1] = pre[y][x + 1] + pre[y + 1][x] - pre[y][x] + (0 if passable[y][x] else 1)
def solid_in(x0, y0, x1, y1):
    if x0 < 0 or y0 < 0 or x1 > w or y1 > h:
        return 1
    return pre[y1][x1] - pre[y0][x1] - pre[y1][x0] + pre[y0][x0]
mask = []
for cy in range(h // CELL):
    row = ''
    for cx in range(w // CELL):
        x, y = cx * CELL + CELL // 2, cy * CELL + CELL // 2
        row += '#' if solid_in(x - HALF_W, y - HALF_H, x + HALF_W + 1, y + HALF_H + 1) == 0 else '.'
    mask.append(row)

from catch_icons import G

PALETTE = {
    'k': '#22180f', 'w': '#fffaf0', 'o': '#f2a33a', 'O': '#c46a17',
    'g': '#2f8f5a', 'G': '#56b86f',            # drake head
    'e': '#c9c2b3', 'E': '#9c9585',            # drake grey body
    'c': '#8a4a2a',                            # drake chestnut breast
    'b': '#a8743f', 'B': '#d4a167',            # hen browns
    'n': '#6b4a2f', 'u': '#3f6fd0',            # wing, blue speculum
    'f': '#6fc23a', 'F': '#2f7a22', 'l': '#b6e35a',  # frog
}


def duck(drake, asleep):
    g = G(22, 15)
    body, light = ('e', 'E') if drake else ('b', 'B')
    g.poly([(15, 7), (19, 5), (18.5, 8.5)], 'k' if drake else 'n')   # tail up
    g.ellipse(10.5, 9, 6.8, 3.1, body)
    g.ellipse(6, 8.6, 2.8, 2.6, 'c' if drake else light)            # breast
    g.poly([(8, 7.6), (16, 7.4), (15, 9.6), (9, 10)], 'n')           # wing
    g.put(13, 8, 'u'); g.put(14, 8, 'u')                             # speculum
    if asleep:
        g.ellipse(10, 6.4, 2.6, 2.1, 'g' if drake else 'b')         # head tucked onto the back
        g.poly([(11.8, 6.2), (13.6, 6.6), (11.8, 7.2)], 'o')
    else:
        g.ellipse(5, 4.6, 2.5, 2.3, 'g' if drake else 'b')
        g.poly([(4.2, 6.2), (6.2, 6.2), (6.2, 7.6), (4.2, 7.6)], 'g' if drake else 'b')  # neck
        g.poly([(0.6, 4.8), (3, 4.2), (3, 6), (0.8, 5.8)], 'o')      # beak
        if drake:
            g.line(4, 7, 6, 7, 'w')                                  # white neck ring
    g.recolor(lambda x, y, ch: light if ch == body and y >= 11 else None)
    g.outline()
    if asleep:
        g.line(9, 6, 10, 6, 'k')                                     # closed eye
    else:
        g.put(4, 4, 'k')                                             # eye
        if not drake:
            g.put(5, 4, 'n')                                         # hen's eye stripe
    return g.rows()


def frog():
    """A frog seen from above, head up (it is turned in 90 degree steps in code)."""
    g = G(14, 15)
    for sx in (2.2, 10.8):
        g.ellipse(sx, 10.5, 1.7, 2.6, 'F')                          # folded back legs
    g.line(3, 6, 1, 4, 'F'); g.line(10, 6, 12, 4, 'F')              # front legs
    g.line(1, 4, 1, 3, 'F'); g.line(12, 4, 12, 3, 'F')
    g.ellipse(6.5, 8, 3.8, 4.6, 'f')                                # body
    g.ellipse(4.4, 3.8, 1.5, 1.5, 'f'); g.ellipse(8.6, 3.8, 1.5, 1.5, 'f')  # eye bumps
    g.line(6, 7, 6, 11, 'l', only_on='f'); g.line(7, 7, 7, 11, 'l', only_on='f')  # pale stripe
    g.outline()
    g.put(4, 3, 'w'); g.put(4, 4, 'k'); g.put(8, 3, 'w'); g.put(8, 4, 'k')  # eyes
    g.put(5, 9, 'F'); g.put(9, 10, 'F')                             # spots
    return g.rows()


grids = {
    'DUCK_DRAKE': duck(True, False), 'DUCK_DRAKE_ASLEEP': duck(True, True),
    'DUCK_HEN': duck(False, False), 'DUCK_HEN_ASLEEP': duck(False, True),
    'FROG': frog(),
}
used = set(''.join(''.join(r) for r in grids.values())) - {'.'}
lines = [
    '// Generated by tools/pixelize/pond_clean.py (original pixel art from simple shapes, Fishing package 2,',
    '// 2026-11-12): the ducks (drake and hen, awake and asleep, facing left) and a frog seen from above',
    '// (head up), drawn over the cleaned pond picture by art/pond-life.tsx. Pixel art keeps its own',
    '// palette (CLAUDE.md Design system).',
    '',
    'export const POND_LIFE_PALETTE: Record<string, string> = {',
]
for k_, v in PALETTE.items():
    if k_ in used:
        lines.append(f"  {k_}: '{v}',")
lines.append('};')
for name, rows in grids.items():
    lines.append('')
    lines.append(f'export const {name}: string[] = [')
    lines += [f"  '{r}'," for r in rows]
    lines.append('];')
lines.append('')
lines.append(f'/** Where a duck\'s middle may be: {CELL} px cells, \'#\' = only water under the whole duck. */')
lines.append(f'export const WATER_CELL = {CELL};')
lines.append('export const WATER_MASK: string[] = [')
lines += [f"  '{r}'," for r in mask]
lines.append('];')
open(out_ts, 'w').write('\n'.join(lines) + '\n')
print(f'{len(DUCKS)} ducks and {len(FROGS)} frogs removed -> {out_png}; sprites -> {out_ts}')
