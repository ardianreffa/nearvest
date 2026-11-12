# Pixel-art mouse cursors for laptops / PCs (2026-11-12, Ardian): an arrow and a pointing hand, drawn
# here from text rows (original pixel art: dark outline = --ink #1B1B2F, light fill = --paper-light
# #FFFAF0; pixel art keeps its own palette, CLAUDE.md Design system). Each art pixel becomes 2x2 px in
# the 1x file (32x32) and 4x4 px in the @2x file (64x64, Retina), so they stay sharp.
# Hotspots (CSS, in 1x px): arrow 1 1 (its tip), hand 11 1 (the fingertip).
# Usage: python3 -I tools/pixelize/cursors.py web/public/assets/cursor
# Standard library only.
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from png import write_png

ARROW = [
    'k...............',
    'kk..............',
    'kwk.............',
    'kwwk............',
    'kwwwk...........',
    'kwwwwk..........',
    'kwwwwwk.........',
    'kwwwwwwk........',
    'kwwwwwwwk.......',
    'kwwwwwwwwk......',
    'kwwwwwkkkkk.....',
    'kwwkwwk.........',
    'kwk.kwwk........',
    'kk..kwwk........',
    'k....kwwk.......',
    '.....kkk........',
]
HAND = [
    '.....kk.........',
    '....kwwk........',
    '....kwwk........',
    '....kwwk........',
    '....kwwkkk......',
    '....kwwkwwkk....',
    '.kk.kwwkwwkwkk..',
    'kwwkkwwwwwkwwwk.',
    'kwwwkwwwwwwwwwk.',
    '.kwwwwwwwwwwwwk.',
    '..kwwwwwwwwwwwk.',
    '..kwwwwwwwwwwk..',
    '...kwwwwwwwwwk..',
    '...kwwwwwwwwk...',
    '....kwwwwwwwk...',
    '....kkkkkkkkk...',
]
COL = {'k': (0x1B, 0x1B, 0x2F, 255), 'w': (0xFF, 0xFA, 0xF0, 255), '.': (0, 0, 0, 0)}

out = sys.argv[1]
for name, rows in (('arrow', ARROW), ('hand', HAND)):
    for suffix, s in (('', 2), ('@2x', 4)):
        img = [[COL[rows[y // s][x // s]] for x in range(16 * s)] for y in range(16 * s)]
        write_png(os.path.join(out, f'{name}{suffix}.png'), 16 * s, 16 * s, img)
        print(f'{out}/{name}{suffix}.png {16 * s}x{16 * s}')
