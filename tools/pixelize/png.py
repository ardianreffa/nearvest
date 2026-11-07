# Minimal PNG reader/writer (8-bit RGB/RGBA, non-interlaced) using only the standard library.
import struct, zlib

def read_png(path, alpha=False):
    """Pixels as (r, g, b) tuples, or (r, g, b, a) with alpha=True (a = 255 for RGB files)."""
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n'
    pos, idat, w = 8, b'', None
    while pos < len(data):
        length, = struct.unpack('>I', data[pos:pos+4]); ctype = data[pos+4:pos+8]
        chunk = data[pos+8:pos+8+length]; pos += 12 + length
        if ctype == b'IHDR':
            w, h, depth, color, comp, filt, inter = struct.unpack('>IIBBBBB', chunk)
            assert depth == 8 and inter == 0, (depth, inter)
            bpp = {2: 3, 6: 4}[color]
        elif ctype == b'IDAT':
            idat += chunk
    raw = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    i = 0
    for y in range(h):
        f = raw[i]; i += 1
        line = bytearray(raw[i:i+stride]); i += stride
        if f == 1:
            for x in range(bpp, stride): line[x] = (line[x] + line[x-bpp]) & 255
        elif f == 2:
            for x in range(stride): line[x] = (line[x] + prev[x]) & 255
        elif f == 3:
            for x in range(stride): line[x] = (line[x] + ((line[x-bpp] if x >= bpp else 0) + prev[x]) // 2) & 255
        elif f == 4:
            for x in range(stride):
                a = line[x-bpp] if x >= bpp else 0; b = prev[x]; c = prev[x-bpp] if x >= bpp else 0
                p = a + b - c; pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        out[y*stride:(y+1)*stride] = line; prev = line
    n = 4 if alpha and bpp == 4 else 3
    px = [[tuple(out[y*stride + x*bpp: y*stride + x*bpp + n]) for x in range(w)] for y in range(h)]
    if alpha and bpp == 3:
        px = [[p + (255,) for p in row] for row in px]
    return w, h, px

def write_png(path, w, h, rgba_rows):
    raw = b''.join(b'\x00' + bytes(v for p in row for v in p) for row in rgba_rows)
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b'')
    open(path, 'wb').write(png)
