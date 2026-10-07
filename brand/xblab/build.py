"""Build the XBLab logo files (SVG, text outlined) into this folder.

The mark: a solid figure eight (two loops, each a circle and the two tangents
from the crossing), a counter in each loop, cut down the middle by a mirror.
The left half (the person) is drawn as it is; the right half (the computer)
is the same shape sampled on a grid of square pixels. The name is "XBLab":
X and Lab in TeX Gyre Pagella (a Palatino), the B in the mark's pixels.

    python3 build.py        # writes the .svg files and xblab-logo.zip
    (run motion.py first to put the animations in the zip too)
"""
import math
import zipfile
from pathlib import Path

from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.pointInsidePen import PointInsidePen
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont

HERE = Path(__file__).resolve().parent
PAGELLA = "/usr/share/texmf/fonts/opentype/public/tex-gyre/texgyrepagella-{}.otf"
INTER = "/usr/share/fonts/opentype/inter/Inter-SemiBold.otf"

INK, PAPER = "#111111", "#faf8f3"
ACCENTS = {"green": "#25915f", "red": "#d6452b"}

# ---- the mark's geometry (as on the preview page)
R, HEAD, ANGLE, CUT, COUNTER, PX = 60.0, 0.8, 50.0, 0.14, 0.46, 6
A = math.radians(ANGLE)
R1, R2 = R * HEAD, R
D1, D2 = R1 / math.sin(A), R2 / math.sin(A)
C, P = R * CUT, R / PX
TOP, BOTTOM = -(D1 + R1), D2 + R2

# ---- the lockups (as on the preview page)
SPACE = 4 * P          # mark to name
LEAD = 0.36            # name to descriptor, in name capitals
TRACK = 0.2            # descriptor letter spacing, in em
PRIMARY_CAP = 0.55     # name capitals, in mark heights
STACKED_CAP = 0.42
DESCRIPTOR = "HUMAN–COMPUTER INTERACTION"


# everything drawn into the current file widens this box: the files are cut to
# what is really there (ascenders, the last row of pixels), not to the layout
INK_BOX = []


def ink(x0, y0, x1, y1):
    INK_BOX.append((x0, y0, x1, y1))


def ink_box(pad=1.0):
    x0 = min(b[0] for b in INK_BOX) - pad
    y0 = min(b[1] for b in INK_BOX) - pad
    x1 = max(b[2] for b in INK_BOX) + pad
    y1 = max(b[3] for b in INK_BOX) + pad
    return x0, y0, x1 - x0, y1 - y0


def n(v):
    return f"{v:.2f}".rstrip("0").rstrip(".")


# ---------- the mark
def inside_loop(x, y, up):
    r, d = (R1, D1) if up else (R2, D2)
    yy = -y if up else y  # distance away from the crossing
    if yy < 0:
        return False
    if x * x + (yy - d) ** 2 <= r * r:
        return True
    reach = d - r * math.sin(A)  # where the tangents meet the circle
    return yy <= reach and abs(x) <= yy * math.tan(A)


def inside_mark(x, y):
    for up, (r, cy) in ((True, (R1, -D1)), (False, (R2, D2))):
        if x * x + (y - cy) ** 2 <= (r * COUNTER) ** 2:
            return False
    return inside_loop(x, y, True) or inside_loop(x, y, False)


def person_path(dx):
    """The left half: two half loops and the two half counters."""
    parts = []
    for up in (True, False):
        r, d = (R1, D1) if up else (R2, D2)
        s = -1 if up else 1
        tx, ty = r * math.cos(A), s * (d - r * math.sin(A))
        far = s * (d + r)
        sweep = 1 if up else 0
        parts.append(f"M{n(dx)} 0 L{n(dx - tx)} {n(ty)} A{n(r)} {n(r)} 0 0 {sweep} {n(dx)} {n(far)} Z")
        rc, cy = r * COUNTER, s * d
        parts.append(f"M{n(dx)} {n(cy - rc)} A{n(rc)} {n(rc)} 0 0 0 {n(dx)} {n(cy + rc)} Z")
    return " ".join(parts)


def mark_cells():
    """The computer's half: the pixels whose centres fall inside the eight."""
    cells = set()
    for j in range(math.floor(TOP / P), math.ceil(BOTTOM / P)):
        i = 0
        while i * P < R2 + P:
            if inside_mark(i * P + P / 2, j * P + P / 2):
                cells.add((i, j))
            i += 1
    return cells


def cells_path(cells, ox, oy, p):
    """One outline round a set of grid cells (no seams between pixels)."""
    if cells:
        ink(ox + min(i for i, _ in cells) * p, oy + min(j for _, j in cells) * p,
            ox + (max(i for i, _ in cells) + 1) * p, oy + (max(j for _, j in cells) + 1) * p)
    edges = {}
    for i, j in cells:
        # clockwise round each cell; an edge shared by two cells cancels out
        for a, b in (((i, j), (i + 1, j)), ((i + 1, j), (i + 1, j + 1)), ((i + 1, j + 1), (i, j + 1)), ((i, j + 1), (i, j))):
            if (b, a) in edges:
                del edges[(b, a)]
            else:
                edges[(a, b)] = True
    nxt = {}
    for a, b in edges:
        nxt.setdefault(a, []).append(b)
    out = []
    while nxt:
        start = next(iter(nxt))
        loop, cur = [start], start
        while True:
            b = nxt[cur].pop()
            if not nxt[cur]:
                del nxt[cur]
            if b == start:
                break
            loop.append(b)
            cur = b
        # drop points in the middle of straight runs
        pts = [q for k, q in enumerate(loop)
               if not ((loop[k - 1][0] == q[0] == loop[(k + 1) % len(loop)][0]) or (loop[k - 1][1] == q[1] == loop[(k + 1) % len(loop)][1]))]
        out.append("M" + " L".join(f"{n(ox + x * p)} {n(oy + y * p)}" for x, y in pts) + " Z")
    return " ".join(out)


MARK_BOX = None


def mark(person, computer):
    cells = mark_cells()
    xs = [i for i, _ in cells]
    right = C / 2 + (max(xs) + 1) * P
    box = (-C / 2 - R2, TOP, right + C / 2 + R2, BOTTOM - TOP)
    ink(-C / 2 - R2, TOP, -C / 2, BOTTOM)
    svg = (f'<path fill="{person}" fill-rule="evenodd" d="{person_path(-C / 2)}"/>'
           f'<path fill="{computer}" d="{cells_path(cells, C / 2, 0, P)}"/>')
    return svg, (box[0], box[1], right - box[0], box[3])


# ---------- type
class Face:
    def __init__(self, path):
        self.font = TTFont(path)
        self.gs = self.font.getGlyphSet()
        self.cmap = self.font.getBestCmap()
        self.upm = self.font["head"].unitsPerEm

    def glyph(self, ch):
        return self.cmap[ord(ch)]

    def advance(self, ch):
        return self.font["hmtx"][self.glyph(ch)][0] / self.upm

    def cap(self):
        pen = BoundsPen(self.gs)
        self.gs[self.glyph("H")].draw(pen)
        return pen.bounds[3] / self.upm

    def path(self, text, x, base, size, track=0.0):
        k = size / self.upm
        out = []
        for ch in text:
            pen = SVGPathPen(self.gs, ntos=n)
            self.gs[self.glyph(ch)].draw(TransformPen(pen, (k, 0, 0, -k, x, base)))
            out.append(pen.getCommands())
            bp = BoundsPen(self.gs)
            self.gs[self.glyph(ch)].draw(bp)
            if bp.bounds:
                gx0, gy0, gx1, gy1 = bp.bounds
                ink(x + gx0 * k, base - gy1 * k, x + gx1 * k, base - gy0 * k)
            x += self.advance(ch) * size + track * size
        return " ".join(out), x

    def width(self, text, size, track=0.0):
        return sum(self.advance(ch) for ch in text) * size + track * size * (len(text) - 1)

    def raster(self, ch, size, p):
        """The glyph sampled on p-sized cells on the baseline: (i, j) with j < 0 above it."""
        g, k = self.gs[self.glyph(ch)], self.upm / size
        cells, sub = set(), 4
        rows, cols = math.ceil(size * self.cap() / p) + 1, math.ceil(self.advance(ch) * size / p) + 1
        for j in range(rows):
            for i in range(cols):
                hit = 0
                for u in range(sub):
                    for v in range(sub):
                        x = (i * p + (u + 0.5) * p / sub) * k
                        y = ((j + 1) * p - (v + 0.5) * p / sub) * k
                        pen = PointInsidePen(self.gs, (x, y))
                        g.draw(pen)
                        hit += pen.getResult()
                if hit / sub ** 2 >= 0.3:
                    cells.add((i, -(j + 1)))
        return cells


ROMAN, ITALIC, SANS = Face(PAGELLA.format("regular")), Face(PAGELLA.format("italic")), Face(INTER)
CAP, CAP_UI = ROMAN.cap(), SANS.cap()


def wordmark(x0, base, size, ink, accent):
    """X and Lab in type, the B in the mark's pixels; returns (svg, width)."""
    xd, x = ROMAN.path("X", x0, base, size)
    bcells = ROMAN.raster("B", size, P)
    bd = cells_path(bcells, x, base, P)
    x += ROMAN.advance("B") * size
    ld, x = ITALIC.path("Lab", x, base, size)
    return f'<path fill="{ink}" d="{xd} {ld}"/><path fill="{accent}" d="{bd}"/>', x - x0


def name_width(size):
    return (ROMAN.advance("X") + ROMAN.advance("B")) * size + ITALIC.width("Lab", size)


def descriptor(x, base, size, fill, opacity):
    """The descriptor and where its last letter ends."""
    d, _ = SANS.path(DESCRIPTOR, x, base, size, TRACK)
    end = x + SANS.width(DESCRIPTOR, size, TRACK)
    return f'<path fill="{fill}" fill-opacity="{opacity}" d="{d}"/>', end


# ---------- lockups
def lockup(kind, accent, dark):
    ink = PAPER if dark else INK
    faint, faint_op = (PAPER, 0.55) if dark else (INK, 0.45)
    m, (bx, by, bw, bh) = mark(ink, accent)
    if kind == "symbol":
        return m, (bx, by, bw, bh)
    tag_per_name = name_width(1) / SANS.width(DESCRIPTOR, 1, TRACK)
    if kind == "primary":
        cap = bh * PRIMARY_CAP
        size = cap / CAP
        base = by + bh / 2 + cap / 2
        w, width = wordmark(bx + bw + SPACE, base, size, ink, accent)
        return m + w, (bx, by, bw + SPACE + width, bh)
    if kind == "institutional":
        size = bh / (CAP * (1 + LEAD) + CAP_UI * tag_per_name)
        x0 = bx + bw + SPACE
        w, width = wordmark(x0, by + size * CAP, size, ink, accent)
        t, end = descriptor(x0 + size * 0.02, by + bh, size * tag_per_name, faint, faint_op)
        return m + w + t, (bx, by, max(x0 + width, end) - bx, bh)
    if kind == "stacked":
        cap = bh * STACKED_CAP
        size = cap / CAP
        width = name_width(size)
        cx = bx + bw / 2
        base = by + bh + SPACE + cap
        w, _ = wordmark(cx - width / 2, base, size, ink, accent)
        tsize = size * tag_per_name
        tbase = base + LEAD * cap + tsize * CAP_UI
        t, end = descriptor(cx - width / 2 + size * 0.02, tbase, tsize, faint, faint_op)
        half = max(bw / 2, width / 2, end - cx)
        return m + w + t, (cx - half, by, 2 * half, tbase - by)
    raise ValueError(kind)


def write(path, body, box, ground=None, pad=0.0):
    x, y, w, h = box
    x, y, w, h = x - pad, y - pad, w + 2 * pad, h + 2 * pad
    bg = f'<rect x="{n(x)}" y="{n(y)}" width="{n(w)}" height="{n(h)}" fill="{ground}"/>' if ground else ""
    path.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{n(x)} {n(y)} {n(w)} {n(h)}" '
                    f'width="{n(w)}" height="{n(h)}">{bg}{body}</svg>\n')


def main():
    files = []
    for colour, accent in ACCENTS.items():
        for kind in ("symbol", "primary", "institutional", "stacked"):
            for dark in (False, True):
                INK_BOX.clear()
                body, _ = lockup(kind, accent, dark)
                f = HERE / f"xblab-{kind}-{colour}{'-on-dark' if dark else ''}.svg"
                write(f, body, ink_box())
                files.append(f)
        # the app icon: the mark reversed on an ink square
        INK_BOX.clear()
        body, _ = lockup("symbol", accent, True)
        x, y, w, h = ink_box(0)
        side = h + 8 * P
        cx, cy = x + w / 2, y + h / 2
        f = HERE / f"xblab-app-icon-{colour}.svg"
        write(f, body, (cx - side / 2, cy - side / 2, side, side), ground=INK)
        files.append(f)
    with zipfile.ZipFile(HERE / "xblab-logo.zip", "w", zipfile.ZIP_DEFLATED) as z:
        for f in files + sorted(HERE.glob("xblab-motion-*.svg")) + sorted(HERE.glob("xblab-motion-*.gif")) + [HERE / "README.md"]:
            z.write(f, f.name)
    print("\n".join(f.name for f in files))


if __name__ == "__main__":
    main()
