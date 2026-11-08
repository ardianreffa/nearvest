# Makes temporary DUSK and NIGHT versions of a converted village (bg.png from pixelize.py
# --keep-bg) from its DAY version, pixel for pixel, so they line up exactly:
#   dusk  = warm orange light, a little darker;
#   night = dark blue, except the "lit" pixels: teal / cyan / mint neon (roof trim, tower glass,
#           holograms), yellow / orange windows and lanterns inside the --warm boxes (house walls,
#           the Shop, the lanterns: elsewhere yellow is bamboo or fruit) and the volcano's lava
#           keep their colour.
# Transparent pixels (the sky) stay transparent. Only pixels above GROUND (the flat grass where
# the plots sit) can be lit, so flowers in the grass stay dark.
# When the real ChatGPT dusk / night images arrive, convert them with pixelize.py to the same
# file names instead (see docs/ASSETS.md): the game code does not change.
# Usage: python3 -I tools/pixelize/relight.py day.png dusk.png night.png --ground ROW [--lava X0 Y0 X1 Y1]
#        [--warm X0 Y0 X1 Y1]... (pixels of day.png; the commands used are in docs/ASSETS.md)
# Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import read_png, write_png


def arg(name, n=1):
    if name not in sys.argv:
        return None
    i = sys.argv.index(name)
    vals = [int(v) for v in sys.argv[i + 1:i + 1 + n]]
    return vals if n > 1 else vals[0]


def warm_light(p):
    """Window and lantern yellow or orange glow."""
    r, g, b = p
    return (r > 200 and g > 185 and b < 140) or (r > 200 and 110 < g < 200 and b < 95)


def neon(p):
    """Teal / cyan / mint neon and lit glass."""
    r, g, b = p
    return (g > 195 and b > 195 and r < 175) or (g > 200 and r < 70 and b > 110)


def lava(p):
    r, g, b = p
    return r > 180 and g < 170 and b < 90 and r - g > 60


def clamp(v):
    return max(0, min(255, int(round(v))))


def dusk_of(p):
    r, g, b = p
    return (clamp(r * 0.9 + 22), clamp(g * 0.7 + 6), clamp(b * 0.52 + 4))


def night_of(p):
    r, g, b = p
    lum = 0.3 * r + 0.59 * g + 0.11 * b
    return (clamp(0.17 * r + 0.05 * lum + 8), clamp(0.21 * g + 0.06 * lum + 14), clamp(0.33 * b + 0.17 * lum + 40))


def main():
    src, out_dusk, out_night = sys.argv[1], sys.argv[2], sys.argv[3]
    ground = arg('--ground')
    lava_box = arg('--lava', 4)
    warm = [tuple(int(v) for v in sys.argv[i + 1:i + 5]) for i, a in enumerate(sys.argv) if a == '--warm']
    in_warm = lambda x, y: any(x0 <= x < x1 and y0 <= y < y1 for x0, y0, x1, y1 in warm)
    w, h, px = read_png(src, alpha=True)
    dusk_rows, night_rows, lit = [], [], 0
    for y in range(h):
        drow, nrow = [], []
        for x in range(w):
            p = px[y][x]
            if not p[3]:
                drow.append((0, 0, 0, 0))
                nrow.append((0, 0, 0, 0))
                continue
            c = p[:3]
            in_lava = lava_box and lava_box[0] <= x < lava_box[2] and lava_box[1] <= y < lava_box[3] and lava(c)
            is_lit = y < ground and (neon(c) or (warm_light(c) and in_warm(x, y))) or in_lava
            lit += is_lit
            drow.append((c if is_lit else dusk_of(c)) + (255,))
            nrow.append((c if is_lit else night_of(c)) + (255,))
        dusk_rows.append(drow)
        night_rows.append(nrow)
    write_png(out_dusk, w, h, dusk_rows)
    write_png(out_night, w, h, night_rows)
    print(f'{w}x{h}: dusk -> {out_dusk}, night -> {out_night} ({lit} lit pixels)')


main()
