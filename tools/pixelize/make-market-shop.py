# Builds the Mr. Darto and Shop sprite modules from the sheet.py outputs.
#   python3 -I tools/pixelize/sheet.py docs/art-source/darto-ai.png <darto_dir> --cell 8 --colors 40 --holes 6 --main-only 0,1,2
#   python3 -I tools/pixelize/sheet.py docs/art-source/shop-ai.png <shop_dir> --cell 8 --colors 62 --holes 2000
#   python3 -I tools/pixelize/make-market-shop.py <darto_dir> <shop_dir>
# Writes web/src/art/darto-sprite.ts and web/src/art/shop-sprite.ts.
# - Darto: 3 poses (sparkle lines already dropped by --main-only), the hover cart
#   plus animation layers (thruster jets, glowing core).
# - Shop: the guard robot is cut out into its own layer (so it can float) with
#   foliage filled in behind it, its eyes are a separate layer (blink), and the
#   tomato / eggplant / carrot seed packets are redrawn as rambutan / mango / durian.
import sys, os, json

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
darto = json.load(open(os.path.join(sys.argv[1], 'sheet.json')))
shop = json.load(open(os.path.join(sys.argv[2], 'sheet.json')))


def rgb(hexstr):
    return tuple(int(hexstr[i:i + 2], 16) for i in (1, 3, 5))


def layer(rows, keep):
    """Rows with only the cells where keep(x, y, ch) is true."""
    return [''.join(c if c != '.' and keep(x, y, c) else '.' for x, c in enumerate(r)) for y, r in enumerate(rows)]


def ts_rows(name, rows):
    return f'export const {name}: string[] = [\n' + ''.join(f'  {json.dumps(r)},\n' for r in rows) + '];\n'


def is_cyan(c):
    r, g, b = c
    return b > 180 and g > 170 and b - r > 80


def is_mint(c):
    r, g, b = c
    return g > 200 and r < 140


# ---------- Mr. Darto ----------
pal = darto['palette']
idle, wave, durian, cart = [s['rows'] for s in darto['sprites']]


def feet_anchor(rows):
    xs = [x for r in rows[-6:] for x, c in enumerate(r) if c != '.']
    return (min(xs) + max(xs)) / 2


jets = layer(cart, lambda x, y, c: y >= len(cart) - 7 and is_cyan(rgb(pal[c])))
core = layer(cart, lambda x, y, c: len(cart) - 18 <= y < len(cart) - 8 and 30 <= x <= 52 and (is_cyan(rgb(pal[c])) or is_mint(rgb(pal[c]))))
out = [
    '// Mr. Darto (3 poses) and his hover cart, official design: made with ChatGPT (AI image)',
    "// at Ardian's request (docs/art-source/darto-ai.png), converted with tools/pixelize",
    '// (sheet.py + make-market-shop.py): 8 px cells, shared palette snapped to the GDD colors,',
    '// white background removed, sparkle lines dropped (they are an animation now).',
    '// Generated file: do not edit by hand.',
    '',
    f'export const DARTO_PALETTE: Record<string, string> = {json.dumps(pal)};',
    '',
    ts_rows('DARTO_IDLE', idle),
    ts_rows('DARTO_WAVE', wave),
    ts_rows('DARTO_DURIAN', durian),
    '/** Horizontal center of the feet in each pose, used to keep the poses lined up. */',
    f'export const DARTO_ANCHOR = {{ idle: {feet_anchor(idle)}, wave: {feet_anchor(wave)}, durian: {feet_anchor(durian)} }};',
    '',
    ts_rows('CART', cart),
    '/** Thruster glow under the cart (flickers). */',
    ts_rows('CART_JETS', jets),
    '/** Glowing core in the cart base (pulses). */',
    ts_rows('CART_CORE', core),
]
open(os.path.join(ROOT, 'web/src/art/darto-sprite.ts'), 'w').write('\n'.join(out))

# ---------- Shop ----------
spal = dict(shop['palette'])
rows = [list(r) for r in shop['sprites'][0]['rows']]
H, W = len(rows), len(rows[0])

# Extra colors for the redrawn seed packets (same colors as the game's fruit icons).
EXTRA = {'!': '#FFD84A', '#': '#F59E0B', '$': '#2E7D4F', '%': '#EF4444', '&': '#991B1B',
         '*': '#FCA5A5', '+': '#A3C94A', '=': '#6B8E23', '?': '#7A5230'}
spal.update(EXTRA)
FRUITS = {
    'mango': ['..$..', '.!!#.', '!!!!#', '!!!##', '.###.'],
    'rambutan': ['%.%.%', '.&&&.', '%&*&%', '.&&&.', '%.%.%'],
    'durian': ['..?..', '+.+.+', '.+=+.', '+=+=+', '.+=+.'],
}
# Packet picture areas (sprite cells): tomato -> rambutan, eggplant -> mango, carrot -> durian.
PACKETS = [('rambutan', 42, 58), ('mango', 34, 69), ('durian', 50, 69)]
for fruit, x0, y0 in PACKETS:
    paper = rows[y0][x0 - 1] if rows[y0][x0 - 1] != '.' else rows[y0][x0]
    for y in range(y0 - 1, y0 + 6):
        for x in range(x0 - 1, x0 + 6):
            rows[y][x] = paper
    for dy, line in enumerate(FRUITS[fruit]):
        for dx, c in enumerate(line):
            if c != '.':
                rows[y0 + dy][x0 + dx] = c


def greenish(ch):
    if ch in EXTRA or ch == '.':
        return False
    r, g, b = rgb(spal[ch])
    return g > r + 25 and g > b + 15 and not is_cyan((r, g, b)) and not (g > 200 and r < 30)


# Guard robot: box around it; robot = non-foliage cells plus whatever they enclose.
BX0, BY0, BX1, BY1 = 62, 59, 90, 84  # x1/y1 exclusive; y1 = top of the counter
robot = [[not greenish(rows[y][x]) for x in range(BX0, BX1)] for y in range(BY0, BY1)]
bw, bh = BX1 - BX0, BY1 - BY0
# Cells reachable from the box's left, right and top edges through non-robot or
# wall-colored cells are background (the robot's outline is closed on those sides).
outside = [[False] * bw for _ in range(bh)]
stack = [(y, x) for y in range(bh) for x in (0, bw - 1)] + [(0, x) for x in range(bw)]
while stack:
    y, x = stack.pop()
    if not (0 <= y < bh and 0 <= x < bw) or outside[y][x] or robot[y][x]:
        continue
    outside[y][x] = True
    stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
mask = [[not outside[y][x] for x in range(bw)] for y in range(bh)]
# Drop thin bits on the box border that belong to the shelves (dark posts left/right).
for y in range(bh):
    for x in (0, 1, bw - 2, bw - 1):
        mask[y][x] = mask[y][x] and robot[y][x] and x not in (0, bw - 1)

robot_rows, eyes_rows = [], []
screen = None
for y in range(bh):
    line, eyes = '', ''
    for x in range(bw):
        ch = rows[BY0 + y][BX0 + x]
        if mask[y][x]:
            c = rgb(spal[ch])
            if y < 14 and is_cyan(c):
                eyes += ch
                line += 'SCREEN'
            else:
                eyes += '.'
                line += ch
        else:
            line += '.'
            eyes += '.'
    robot_rows.append(line)
    eyes_rows.append(eyes)
# Screen color = the most common dark cell inside the head.
from collections import Counter
head = Counter(c for r in robot_rows[3:12] for c in r.replace('SCREEN', '') if c != '.' and sum(rgb(spal[c])) < 160)
screen = head.most_common(1)[0][0]
robot_rows = [r.replace('SCREEN', screen) for r in robot_rows]

# Fill behind the robot with the foliage of the same row (nearest wall cell).
for y in range(bh):
    for x in range(bw):
        if mask[y][x]:
            fill = None
            for d in range(1, bw):
                for xx in (x - d, x + d):
                    if 0 <= xx < bw and not mask[y][xx] and (greenish(rows[BY0 + y][BX0 + xx]) or d > 3):
                        fill = rows[BY0 + y][BX0 + xx]
                        break
                if fill:
                    break
            rows[BY0 + y][BX0 + x] = fill or rows[BY0 + y][BX0 + x]

out = [
    "// Village Shop stall with its guard robot, official design: made with ChatGPT (AI image) at",
    "// Ardian's request (docs/art-source/shop-ai.png), converted with tools/pixelize (sheet.py +",
    '// make-market-shop.py): 8 px cells, palette snapped to the GDD colors, white background removed.',
    '// The robot is a separate layer (it floats), its eyes another (they blink); the seed packets show',
    '// mango, rambutan and durian. Generated file: do not edit by hand.',
    '',
    f'export const SHOP_PALETTE: Record<string, string> = {json.dumps(spal)};',
    '',
    ts_rows('SHOP_ROWS', [''.join(r) for r in rows]),
    '/** Where the robot layers sit on the stall (top-left cell). */',
    f'export const SHOP_ROBOT_AT = {{ x: {BX0}, y: {BY0} }};',
    '',
    ts_rows('SHOP_ROBOT', robot_rows),
    ts_rows('SHOP_ROBOT_EYES', eyes_rows),
]
open(os.path.join(ROOT, 'web/src/art/shop-sprite.ts'), 'w').write('\n'.join(out))
print('darto poses', [(len(r[0]), len(r)) for r in (idle, wave, durian)], 'cart', (len(cart[0]), len(cart)),
      'jets', sum(c != '.' for r in jets for c in r), 'core', sum(c != '.' for r in core for c in r))
print('shop', (W, H), 'robot cells', sum(map(sum, mask)), 'eyes', sum(c != '.' for r in eyes_rows for c in r), 'screen', screen)
