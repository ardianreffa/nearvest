# Draws the pond's fish and junk icons (web/src/art/catch-grids.ts) as character grids: original
# pixel art built from simple shapes (ellipses, polygons, lines), not traced from any photo
# (Ardian's fishing test, package 1, 2026-11-12; docs/PLAN-fishing.md section 8).
# Each shape is filled with a colour letter, then a dark outline ('k') is added around it; thin
# details (whiskers, threads) are drawn after the outline. Letters = FISH_PALETTE in catch-grids.ts.
# Usage: python3 -I tools/pixelize/catch_icons.py            -> prints the TypeScript grids
#        python3 -I tools/pixelize/catch_icons.py sheet.png  -> also writes a preview sheet
# Standard library only.
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


class G:
    def __init__(self, w, h):
        self.w, self.h = w, h
        self.c = [['.'] * w for _ in range(h)]

    def put(self, x, y, ch):
        if 0 <= x < self.w and 0 <= y < self.h:
            self.c[y][x] = ch

    def get(self, x, y):
        return self.c[y][x] if 0 <= x < self.w and 0 <= y < self.h else '.'

    def ellipse(self, cx, cy, rx, ry, ch):
        for y in range(self.h):
            for x in range(self.w):
                if ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1:
                    self.put(x, y, ch)

    def poly(self, pts, ch):
        """Fills a polygon (pixel centres inside)."""
        for y in range(self.h):
            for x in range(self.w):
                px, py, inside = x + 0.5, y + 0.5, False
                j = len(pts) - 1
                for i in range(len(pts)):
                    xi, yi = pts[i]; xj, yj = pts[j]
                    if (yi > py) != (yj > py) and px < (xj - xi) * (py - yi) / (yj - yi) + xi:
                        inside = not inside
                    j = i
                if inside:
                    self.put(x, y, ch)

    def line(self, x0, y0, x1, y1, ch, only_on=None):
        n = max(abs(x1 - x0), abs(y1 - y0), 1)
        for i in range(n + 1):
            x = round(x0 + (x1 - x0) * i / n); y = round(y0 + (y1 - y0) * i / n)
            if only_on is None or self.get(x, y) in only_on:
                self.put(x, y, ch)

    def thick(self, pts, r, ch):
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            n = int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 1
            for i in range(n + 1):
                cx = x0 + (x1 - x0) * i / n; cy = y0 + (y1 - y0) * i / n
                self.ellipse(cx, cy, r, r, ch)

    def recolor(self, fn):
        for y in range(self.h):
            for x in range(self.w):
                ch = fn(x, y, self.c[y][x])
                if ch:
                    self.c[y][x] = ch

    def outline(self):
        add = []
        for y in range(self.h):
            for x in range(self.w):
                if self.c[y][x] == '.' and any(self.get(x + dx, y + dy) not in '.k' for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1))):
                    add.append((x, y))
        for x, y in add:
            self.c[y][x] = 'k'

    def rows(self):
        """The grid without empty rows / columns at its edges."""
        rows = [''.join(r) for r in self.c]
        rows = [r for r in rows if r.strip('.')] if any(r.strip('.') for r in rows) else rows
        lo = min(len(r) - len(r.lstrip('.')) for r in rows)
        hi = max(len(r.rstrip('.')) for r in rows)
        return [r[lo:hi] for r in rows]


def scales(g, base, edge, shine, x0, x1, y0, y1):
    """Big scales in offset rows: each scale a 4 x 2 cup (dark lower edge) with a bright dot."""
    def f(x, y, ch):
        if ch != base or not (x0 <= x <= x1 and y0 <= y <= y1):
            return None
        band = (y - y0) // 2
        lx, ly = (x + band * 2) % 4, (y - y0) % 2
        if (ly == 1 and lx in (1, 2)) or (ly == 0 and lx in (0, 3)):
            return edge
        if shine and lx == 1 and ly == 0:
            return shine
        return None
    g.recolor(f)


def tilapia():
    g = G(27, 17)
    # spiny dorsal fin: a membrane along the back, spines every other column
    for x in range(5, 16):
        g.put(x, 3, 'D')
        if x % 2 == 0:
            g.put(x, 2, 'D')
    g.poly([(11, 11), (16, 10), (16, 13)], 'D')       # anal fin
    g.poly([(16, 7.5), (23, 2.5), (23.6, 7.5), (23, 12.5)], 'a')  # fan tail
    # deep body, narrow just before the tail
    g.poly([(1, 7.5), (3, 4.5), (7, 2.8), (12, 3.2), (16, 5.8), (17.5, 6.2), (17.5, 8.8), (16, 9.2), (12, 11.8), (7, 12.2), (3, 10.5)], 'a')
    g.recolor(lambda x, y, ch: 'O' if ch == 'a' and x >= 21 else None)  # reddish tail tip
    g.recolor(lambda x, y, ch: 'i' if ch == 'a' and y >= 10 and x < 18 else None)  # pale belly
    for sx in (7, 10, 13):                            # dark vertical stripes
        g.line(sx, 3, sx - 1, 11, 'A', only_on='ai')
    g.line(16, 6, 16, 9, 'A', only_on='a')            # tail base
    g.outline()
    g.put(4, 6, 'w'); g.put(4, 7, 'k')                # eye with pupil
    g.put(5, 6, 'w')
    g.put(2, 8, 'k')                                  # mouth
    g.line(8, 9, 10, 10, 'D')                         # pectoral fin
    return g.rows()


def catfish():
    g = G(31, 15)
    g.poly([(10, 4.2), (20, 3.4), (21, 5), (11, 5)], 'B')    # long soft fin along the back
    g.poly([(11, 8.6), (21, 7.6), (22, 9.4), (11, 10)], 'B')  # long fin along the belly
    g.poly([(21, 6), (26.5, 2.5), (27.5, 6.5), (26.5, 10.5)], 'B')  # tail fin
    g.poly([(4, 4.5), (9, 4), (21, 5.2), (22.5, 6.5), (21, 7.8), (9, 9), (4, 8.5)], 'b')  # long body, thinner to the tail
    g.ellipse(6.5, 6.5, 4.2, 2.5, 'b')                 # flat, wide head
    g.recolor(lambda x, y, ch: 'C' if ch == 'b' and y >= 8 else None)  # pale belly
    g.recolor(lambda x, y, ch: 'C' if ch == 'b' and y == 5 and 7 <= x <= 18 else None)  # smooth shine, no scales
    g.outline()
    g.put(5, 5, 'w'); g.put(6, 5, 'k')                 # small eye on top of the flat head
    # long whiskers (barbels)
    g.line(2, 5, 0, 1, 'k'); g.line(2, 7, 0, 11, 'k'); g.line(4, 9, 3, 12, 'k'); g.line(2, 6, 0, 4, 'k')
    return g.rows()


def carp():
    g = G(26, 16)
    g.poly([(6, 3.5), (9, 0.5), (15, 1.8), (15, 3.5)], 'N')   # dorsal fin
    g.poly([(16, 6.5), (22.5, 1), (20.5, 7), (22.5, 13), (16, 7.5)], 'n')  # forked tail
    g.ellipse(10, 7, 8.4, 4.3, 'n')                    # body
    # big visible scales: a diamond lattice of darker scale edges, a light shine on top
    scales(g, 'n', 'N', 'z', 6, 16, 4, 9)
    g.recolor(lambda x, y, ch: 'N' if ch == 'n' and x >= 20 else None)
    g.outline()
    g.put(4, 6, 'w'); g.put(4, 7, 'k')                 # eye
    g.put(1, 8, 'k'); g.line(2, 9, 1, 11, 'k')          # mouth + small whisker
    return g.rows()


def gourami():
    g = G(27, 17)
    g.poly([(7, 3.5), (12, 0.5), (18, 2.5), (18, 4)], 'M')   # blue dorsal fin
    g.ellipse(21, 7, 3.0, 4.2, 'v')                    # rounded tail
    g.ellipse(10.5, 6.5, 9.0, 4.4, 'v')                # deep oval body
    g.recolor(lambda x, y, ch: 'V' if ch == 'v' and (y >= 9 or x >= 22) else None)
    for sx in (7, 10, 13, 16, 19):                     # bright blue vertical stripes
        g.line(sx, 2, sx, 11, 'U', only_on='vV')
    g.outline()
    g.put(4, 5, 'w'); g.put(4, 6, 'k')                 # eye
    g.put(1, 7, 'k')                                   # mouth
    g.line(6, 11, 16, 14, 'U')                         # long thread-like belly fin
    return g.rows()


def golden_arowana():
    g = G(35, 15)
    g.poly([(19, 4.2), (25, 1.2), (27, 2.5), (26, 4.6)], 'Z')    # dorsal fin near the tail
    g.poly([(17, 9.4), (26, 9), (27, 12), (19, 11.5)], 'Z')      # anal fin near the tail
    g.poly([(26, 6.8), (32, 2.5), (33.5, 6.8), (32, 11)], 'Z')   # tail fan
    # long slender body; flat back, the lower jaw rises steeply to the snout (mouth faces up)
    g.poly([(2, 3.2), (9, 3.4), (25, 4.4), (28, 6.8), (25, 9.2), (10, 10.2), (6, 8.8)], 'y')
    scales(g, 'y', 'K', 'z', 10, 25, 4, 9)
    g.recolor(lambda x, y, ch: 'Y' if ch == 'y' and (y >= 9 or x <= 8 and y >= 7) else None)
    g.recolor(lambda x, y, ch: 'K' if ch == 'Z' and (x >= 32 or y in (2, 12)) else None)  # fin edges
    g.outline()
    g.line(9, 4, 9, 8, 'K', only_on='yYz')             # gill cover
    g.put(5, 4, 'w'); g.put(6, 4, 'w'); g.put(6, 5, 'k'); g.put(5, 5, 'w')  # big eye
    g.line(2, 4, 6, 8, 'K', only_on='yY')              # the long up-turned mouth line
    g.line(1, 3, 0, 1, 'Z'); g.line(2, 3, 2, 1, 'Z')   # 2 small barbels at the chin tip, pointing up
    return g.rows()


def driftwood():
    g = G(27, 15)
    g.thick([(3, 10), (9, 8.5), (15, 9), (22, 5)], 1.6, 'f')   # crooked log
    g.thick([(11, 8), (13, 4.5), (16, 2)], 1.0, 'f')            # branch
    g.thick([(18, 7), (20, 9.5)], 0.8, 'f')                     # short twig
    # grain: darker lines along the wood, a knot
    g.recolor(lambda x, y, ch: 'F' if ch == 'f' and (x * 2 + y * 5) % 7 == 0 else None)
    g.put(8, 9, 'F'); g.put(9, 9, 'F')
    g.outline()
    g.put(2, 10, 'W'); g.put(2, 11, 'W'); g.put(23, 4, 'W')     # light cut ends
    return g.rows()


def fish_bone():
    g = G(27, 15)
    g.poly([(1, 6.5), (6, 2), (8, 3), (8, 10), (6, 11)], 'q')   # head (skull)
    g.line(8, 6, 18, 6, 'q')                                    # backbone
    for rx in (10, 13, 16):                                     # ribs
        g.line(rx, 3, rx, 9, 'q')
    g.poly([(18, 6.5), (23, 2), (22.5, 6.5), (23, 11)], 'q')    # tail
    g.recolor(lambda x, y, ch: 'Q' if ch == 'q' and (y >= 9 or (x >= 21)) else None)
    g.outline()
    g.put(4, 5, 'k'); g.put(5, 5, 'k')                          # empty eye
    g.line(2, 7, 4, 7, 'Q')                                     # jaw line
    return g.rows()


def rusty_can():
    g = G(17, 18)
    g.ellipse(7, 13, 5.2, 1.8, 'G')                   # bottom rim
    g.poly([(1.8, 3), (12.2, 3), (12.2, 13), (1.8, 13)], 'g')   # tin body
    g.ellipse(7, 3, 5.2, 1.8, 't')                    # open top, grey metal
    g.ellipse(7, 3, 3.6, 0.9, 'T')                    # inside
    g.recolor(lambda x, y, ch: 'x' if ch == 'g' and 6 <= y <= 9 else None)   # faded label band
    g.recolor(lambda x, y, ch: 'G' if ch in 'gx' and (x >= 11 or (x * 3 + y * 2) % 9 == 0) else None)  # rust spots, shade
    g.outline()
    g.put(3, 5, 'w')                                  # glint
    g.put(4, 8, 'k'); g.put(5, 8, 'G')                # dent
    return g.rows()


ICONS = {
    'tilapia': tilapia, 'catfish': catfish, 'carp': carp, 'gourami': gourami,
    'golden_arowana': golden_arowana, 'driftwood': driftwood, 'fish_bone': fish_bone, 'rusty_can': rusty_can,
}

if __name__ == '__main__':
    out = {k: f() for k, f in ICONS.items()}
    for k, rows in out.items():
        print(f'  {k}: [')
        for r in rows:
            print(f"    '{r}',")
        print('  ],')
    if len(sys.argv) > 1:
        from png import write_png
        pal = {}
        ts = open(os.path.join(os.path.dirname(__file__), '../../web/src/art/catch-grids.ts')).read()
        import re
        base = open(os.path.join(os.path.dirname(__file__), '../../web/src/sprites.tsx')).read()
        for src in (base.split('export type SpriteName')[0], ts.split('export const CATCH_GRIDS')[0]):
            for m in re.finditer(r"^\s+(\w): '#([0-9a-fA-F]{6})'", src, re.M):
                pal[m.group(1)] = tuple(int(m.group(2)[i:i + 2], 16) for i in (0, 2, 4))
        bg = (0xF6, 0xEF, 0xD9)
        S = 6
        W = sum(max(len(r) for r in rows) * S + 16 for rows in out.values()) + 16
        H = max(len(rows) for rows in out.values()) * S + 32 + 16 * 3
        img = [[bg + (255,) for _ in range(W)] for _ in range(H)]
        x0 = 16
        for rows in out.values():
            for scale, oy in ((S, 16), (3, 16 + 17 * S)):
                for y, r in enumerate(rows):
                    for x, ch in enumerate(r):
                        if ch != '.':
                            for dy in range(scale):
                                for dx in range(scale):
                                    yy, xx = oy + y * scale + dy, x0 + x * scale + dx
                                    if yy < H and xx < W:
                                        img[yy][xx] = pal.get(ch, (255, 0, 255)) + (255,)
            x0 += max(len(r) for r in rows) * S + 16
        write_png(sys.argv[1], W, H, img)
