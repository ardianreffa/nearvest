# Draws the NEARvest favicon: TaniBot's head with its straw hat (caping), as 16x16 pixel art, and
# writes it at whole-number scales (sharp at 16 and 32 px) plus the home-screen icons.
# Usage: python3 -I tools/icons/make-icons.py web/public   (standard library only)
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pixelize'))
from png import write_png

ROWS = [
    '......kkkk......',
    '.....khhhHk.....',
    '....khhhhhHk....',
    '...khhhhhhhHk...',
    '..khhhhhhhhhHk..',
    '.kmmmmmmmmmmmmk.',
    'kkkkkkkkkkkkkkkk',
    '..kggggggggggk..',
    '.kgkkkkkkkkkkgk.',
    '.kgkcckkkkcckgk.',
    '.kgkcckkkkcckgk.',
    '.kgkkkkkkkkkkgk.',
    '.kggggggggggggk.',
    '..kggggggggggk..',
    '...kkkkkkkkkk...',
    '................',
]
PAL = {'k': '#1B1B2F', 'h': '#E9B862', 'H': '#C98E3E', 'm': '#00EC97', 'g': '#E3EBED', 'c': '#22D3EE'}
BG = (15, 42, 30)  # #0F2A1E, the game's dark green


def rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def image(scale, pad=0, bg=None):
    n = 16 * scale + 2 * pad
    img = [[(bg + (255,)) if bg else (0, 0, 0, 0) for _ in range(n)] for _ in range(n)]
    for y, row in enumerate(ROWS):
        for x, c in enumerate(row):
            if c == '.':
                continue
            for yy in range(scale):
                for xx in range(scale):
                    img[pad + y * scale + yy][pad + x * scale + xx] = rgb(PAL[c]) + (255,)
    return n, img


def svg():
    rects = []
    for y, row in enumerate(ROWS):
        x = 0
        while x < 16:
            c = row[x]
            if c == '.':
                x += 1
                continue
            e = x
            while e < 16 and row[e] == c:
                e += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{e - x}" height="1" fill="{PAL[c]}"/>')
            x = e
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges">{"".join(rects)}</svg>\n'


def main():
    out = sys.argv[1]
    assert all(len(r) == 16 for r in ROWS) and len(ROWS) == 16
    open(os.path.join(out, 'favicon.svg'), 'w').write(svg())
    for name, scale, pad, bg in (('favicon-16.png', 1, 0, None), ('favicon-32.png', 2, 0, None),
                                 ('apple-touch-icon.png', 10, 10, BG), ('icon-192.png', 10, 16, BG), ('icon-512.png', 28, 32, BG)):
        n, img = image(scale, pad, bg)
        write_png(os.path.join(out, name), n, n, img)
        print(name, f'{n}x{n}')


main()
