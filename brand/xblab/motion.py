"""Build the XBLab motion as animated SVG (SMIL, no script).

The same sequence as the preview page: an X is crossed; its arms run on into
∞; it stands up; the line settles onto the loops, fills, and its counters
open; the mirror opens; a scan line runs down the right half and turns it to
pixels; the name comes out from behind the mark, and its B is scanned into
pixels too.

    python3 motion.py       # writes xblab-motion-*.svg
"""
import math

import build as B

NP = 240
W, H = 640, 360
# the timeline, in ms
T = dict(x=420, grow=900, stand=600, fill=650, part=350, scan=900, name=800, bscan=520)
AT = dict(grow=T["x"])
AT["stand"] = AT["grow"] + T["grow"]
AT["fill"] = AT["stand"] + T["stand"]
AT["part"] = AT["fill"] + T["fill"]
AT["scan"] = AT["part"] + T["part"] * 0.6
AT["name"] = AT["scan"] + T["scan"] + 80
AT["bscan"] = AT["name"] + T["name"] * 0.55
END = max(AT["name"] + T["name"], AT["bscan"] + T["bscan"]) + 200


def ease(t):
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def out(t):
    return 1 - (1 - t) ** 3


def clamp(v):
    return max(0.0, min(1.0, v))


n = B.n


# ---------- shapes as lists of points from the crossing
def resample(pts, count):
    d = [0.0]
    for i in range(1, len(pts)):
        d.append(d[-1] + math.dist(pts[i], pts[i - 1]))
    res, j, L = [], 1, d[-1]
    for k in range(count):
        s = k / (count - 1) * L
        while j < len(d) - 1 and d[j] < s:
            j += 1
        t = (s - d[j - 1]) / ((d[j] - d[j - 1]) or 1)
        res.append((pts[j - 1][0] + (pts[j][0] - pts[j - 1][0]) * t, pts[j - 1][1] + (pts[j][1] - pts[j - 1][1]) * t))
    return res


def eight(up):
    A, wide = (B.BOTTOM - B.TOP) / 2, 2 * B.R2
    t0 = math.pi if up else 0.0
    pts = [(wide * math.sin(t) * math.cos(t), A * math.sin(t)) for t in (t0 + i / 2000 * math.pi for i in range(2001))]
    return resample(pts, NP)


def loop(up):
    """The loop's true outline: out along the right tangent, round the circle, back along the left."""
    r, d = (B.R1, B.D1) if up else (B.R2, B.D2)
    a = B.A
    if up:
        cy, phis = -d, [a - (math.pi + 2 * a) * i / 400 for i in range(401)]
    else:
        cy, phis = d, [-a + (math.pi + 2 * a) * i / 400 for i in range(401)]
    arc = [(r * math.cos(p), cy + r * math.sin(p)) for p in phis]
    pts = [(0.0, 0.0)] + [(arc[0][0] * k / 50, arc[0][1] * k / 50) for k in range(1, 50)] + arc + \
          [(arc[-1][0] * (1 - k / 50), arc[-1][1] * (1 - k / 50)) for k in range(1, 51)]
    return resample(pts, NP)


def poly(pts):
    return "M" + " L".join(f"{n(x)} {n(y)}" for x, y in pts) + " Z"


# ---------- SMIL helpers: one animation over the whole timeline, sampled
def anim(attr, fn, times, total, loop_it, fmt=lambda v: n(v)):
    times = sorted(set([0.0] + list(times) + [total]))
    vals = ";".join(fmt(fn(t)) for t in times)
    kt = ";".join(f"{t / total:.4f}" for t in times)
    rep = 'repeatCount="indefinite"' if loop_it else 'fill="freeze"'
    return f'<animate attributeName="{attr}" dur="{total / 1000:.3f}s" keyTimes="{kt}" values="{vals}" calcMode="linear" {rep}/>'


def anim_t(kind, fn, times, total, loop_it, additive=True):
    times = sorted(set([0.0] + list(times) + [total]))
    vals = ";".join(fn(t) for t in times)
    kt = ";".join(f"{t / total:.4f}" for t in times)
    rep = 'repeatCount="indefinite"' if loop_it else 'fill="freeze"'
    add = ' additive="sum"' if additive else ""
    return f'<animateTransform attributeName="transform" type="{kind}" dur="{total / 1000:.3f}s" keyTimes="{kt}" values="{vals}" calcMode="linear"{add} {rep}/>'


def span(start, length, steps=24):
    return [start + length * i / steps for i in range(steps + 1)]


def build(accent, loop_it, total):
    E, P, C = B.INK, B.P, B.C
    ev, sp, ab = [], [], []
    # the line's reach, its turn, its fill
    def reach(t):
        return 0.05 * out(clamp(t / T["x"])) + 0.45 * ease(clamp((t - AT["grow"]) / T["grow"]))

    def u(t):
        return clamp((t - AT["fill"]) / T["fill"])

    reach_t = span(0, AT["grow"], 8) + span(AT["grow"], T["grow"], 24)
    fill_t = span(AT["fill"], T["fill"], 26)
    dash = lambda t: f"{reach(t):.4f} {max(0.0, 1 - 2 * reach(t)):.4f} {reach(t):.4f} 1"

    shapes = {}
    for which, up in (("top", True), ("bottom", False)):
        e8, lp = eight(up), loop(up)
        def d_at(t, e8=e8, lp=lp):
            m = ease(clamp(u(t) / 0.6))
            return poly([(a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m) for a, b in zip(e8, lp)])
        times = [0.0] + span(AT["fill"], T["fill"] * 0.6, 14)
        vals = ";".join(d_at(t) for t in sorted(set(times + [total])))
        kt = ";".join(f"{t / total:.4f}" for t in sorted(set(times + [total])))
        rep = 'repeatCount="indefinite"' if loop_it else 'fill="freeze"'
        shapes[which] = (
            f'<path id="{which}" d="{d_at(0)}" pathLength="1" fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round">'
            f'<animate attributeName="d" dur="{total / 1000:.3f}s" keyTimes="{kt}" values="{vals}" calcMode="linear" {rep}/>'
            + anim("stroke-dasharray", lambda t: 0, reach_t, total, loop_it, fmt=lambda _v, _f=None: "").replace('values=""', "")
            + "</path>")
    # (dasharray needs string values; built separately)
    def with_dash(path_xml):
        times = sorted(set([0.0] + reach_t + [total]))
        vals = ";".join(dash(t) for t in times)
        kt = ";".join(f"{t / total:.4f}" for t in times)
        rep = 'repeatCount="indefinite"' if loop_it else 'fill="freeze"'
        a = f'<animate attributeName="stroke-dasharray" dur="{total / 1000:.3f}s" keyTimes="{kt}" values="{vals}" calcMode="linear" {rep}/>'
        start = path_xml.index("<animate attributeName=\"stroke-dasharray\"")
        stop = path_xml.index("/>", start) + 2
        return path_xml[:start] + a + path_xml[stop:]
    for k in shapes:
        shapes[k] = with_dash(shapes[k])
    fill_op = anim("fill-opacity", lambda t: ease(clamp((u(t) - 0.15) / 0.5)), fill_t, total, loop_it)
    stroke_w = anim("stroke-width", lambda t: B.R * 0.09 * (1 - ease(clamp((u(t) - 0.45) / 0.55))), fill_t, total, loop_it)
    hole = lambda t: out(clamp((u(t) - 0.45) / 0.55))

    def rotate(t):
        return f"{-90 * (1 - ease(clamp((t - AT['stand']) / T['stand']))):.3f}"
    rot = anim_t("rotate", rotate, span(AT["stand"], T["stand"], 20), total, loop_it, additive=False)
    part = lambda t: C / 2 * ease(clamp((t - AT["part"]) / T["part"]))
    part_t = span(AT["part"], T["part"], 12)
    # counters, opening in a mask
    mask = (f'<mask id="holes" maskUnits="userSpaceOnUse" x="-500" y="-500" width="1000" height="1000">'
            f'<rect x="-500" y="-500" width="1000" height="1000" fill="#fff"/>'
            f'<circle cx="0" cy="{n(-B.D1)}" r="0" fill="#000">{anim("r", lambda t: B.R1 * B.COUNTER * hole(t), fill_t, total, loop_it)}</circle>'
            f'<circle cx="0" cy="{n(B.D2)}" r="0" fill="#000">{anim("r", lambda t: B.R2 * B.COUNTER * hole(t), fill_t, total, loop_it)}</circle>'
            f'</mask>')
    # scan line on the right half
    sc = lambda t: clamp((t - AT["scan"]) / T["scan"])
    scan_y = lambda t: B.TOP + (B.BOTTOM - B.TOP) * ease(sc(t))
    scan_t = span(AT["scan"], T["scan"], 30)
    cells = sorted(B.mark_cells(), key=lambda q: q[1])
    rows = {}
    for i, j in cells:
        rows.setdefault(j, []).append((i, j))
    pix = []
    for j, cs in rows.items():
        y = j * P
        op = lambda t, y=y: 1.0 if sc(t) >= 1 else clamp((scan_y(t) - y) / (P * 3))
        pix.append(f'<path d="{B.cells_path(cs, C / 2, 0, P)}" opacity="0">{anim("opacity", op, scan_t, total, loop_it)}</path>')
    whole_pix = f'<path d="{B.cells_path(set(cells), C / 2, 0, P)}" opacity="0">{anim("opacity", lambda t: 1.0 if sc(t) >= 1 else 0.0, [AT["scan"] + T["scan"] - 1, AT["scan"] + T["scan"]], total, loop_it)}</path>'
    scan_line = (f'<line x1="{n(C / 2)}" x2="{n(C / 2 + B.R2 + 1.5 * P)}" y1="{n(B.TOP)}" y2="{n(B.TOP)}" stroke="{accent}" stroke-width="1.4" opacity="0">'
                 + anim("y1", scan_y, scan_t, total, loop_it) + anim("y2", scan_y, scan_t, total, loop_it)
                 + anim("opacity", lambda t: 1.0 if 0 < sc(t) < 1 else 0.0, [AT["scan"] - 1, AT["scan"] + 1, AT["scan"] + T["scan"] - 1, AT["scan"] + T["scan"]], total, loop_it)
                 + "</line>")
    # the name (institutional): laid out as in build.py
    _, (bx, by, bw, bh) = B.mark(E, accent)
    tag_per_name = B.name_width(1) / B.SANS.width(B.DESCRIPTOR, 1, B.TRACK)
    size = bh / (B.CAP * (1 + B.LEAD) + B.CAP_UI * tag_per_name)
    x0, base = bx + bw + B.SPACE, by + size * B.CAP
    xd, x = B.ROMAN.path("X", x0, base, size)
    bcells = B.ROMAN.raster("B", size, P)
    smooth_b, _ = B.ROMAN.path("B", x, base, size)
    bx0 = x
    x += B.ROMAN.advance("B") * size
    ld, x = B.ITALIC.path("Lab", x, base, size)
    width = x - x0
    tag, tag_end = B.descriptor(x0 + size * 0.02, by + bh, size * tag_per_name, E, 0.45)
    lock_w = max(x0 + width, tag_end) - bx
    k = min(1.0, 440 / lock_w, 230 / bh)
    end = (W / 2 - (bx + lock_w / 2) * k, H / 2 - (by + bh / 2) * k)
    nm = lambda t: ease(clamp((t - AT["name"]) / T["name"]))
    name_t = span(AT["name"], T["name"], 24)
    move = anim_t("translate", lambda t: f"{n(W / 2 + (end[0] - W / 2) * nm(t))} {n(H / 2 + (end[1] - H / 2) * nm(t))}", name_t, total, loop_it, additive=False)
    zoom = anim_t("scale", lambda t: f"{1 + (k - 1) * nm(t):.4f}", name_t, total, loop_it)
    slide = lambda t: -(lock_w - bw) * 0.45 * (1 - out(clamp((t - AT["name"] - 60) / T["name"])))
    slide_a = anim_t("translate", lambda t: f"{n(slide(t))} 0", span(AT["name"], T["name"] + 60, 24), total, loop_it, additive=False)
    name_op = anim("opacity", lambda t: clamp((t - AT["name"]) / (T["name"] * 0.6)), span(AT["name"], T["name"] * 0.6, 10), total, loop_it)
    bs = lambda t: clamp((t - AT["bscan"]) / T["bscan"])
    b_top, b_bottom = base - size * B.CAP - P, base + P
    by_ = lambda t: b_top + (b_bottom - b_top) * ease(bs(t))
    bscan_t = span(AT["bscan"], T["bscan"], 20)
    brows = {}
    for i, j in bcells:
        brows.setdefault(j, []).append((i, j))
    bpix = []
    for j, cs in brows.items():
        yabs = base + j * P
        op = lambda t, yabs=yabs: 1.0 if bs(t) >= 1 else clamp((by_(t) - yabs) / (P * 2.5))
        bpix.append(f'<path d="{B.cells_path(cs, bx0, base, P)}" opacity="0">{anim("opacity", op, bscan_t, total, loop_it)}</path>')

    rep = 'repeatCount="indefinite"' if loop_it else 'fill="freeze"'
    use_attrs = lambda col: f'fill="{col}" stroke="{col}" mask="url(#holes)"'
    # nothing at the very start (round caps would leave a dot at the crossing)
    start_op = anim("stroke-opacity", lambda t: 1.0 if t >= 1 else 0.0, [1.0], total, loop_it)
    defs = (f'<defs>{shapes["top"].replace("</path>", fill_op + stroke_w + start_op + "</path>")}'
            f'{shapes["bottom"].replace("</path>", fill_op + stroke_w + start_op + "</path>")}{mask}'
            f'<clipPath id="L"><rect x="-500" y="-500" width="500" height="1000"/></clipPath>'
            f'<clipPath id="R"><rect x="0" y="-500" width="500" height="1000"/></clipPath>'
            f'<clipPath id="S"><rect x="-500" y="{n(B.TOP - 10)}" width="1000" height="1000">{anim("y", scan_y, scan_t, total, loop_it)}</rect></clipPath>'
            f'<clipPath id="N"><rect x="{n(bx + bw)}" y="-500" width="3000" height="1000"/></clipPath>'
            f'<clipPath id="BS"><rect x="-500" y="{n(b_top)}" width="3000" height="1000">{anim("y", by_, bscan_t, total, loop_it)}</rect></clipPath>'
            f'</defs>')
    half = lambda clip, col, sign, inner_clip="": (
        f'<g clip-path="url(#{clip})"><g transform="translate(0 0)">'
        + anim_t("translate", lambda t: f"{n(sign * part(t))} 0", part_t, total, loop_it, additive=False)
        + (f'<g clip-path="url(#{inner_clip})">' if inner_clip else "<g>")
        + f'<g>{rot}<use xlink:href="#top" {use_attrs(col)}/><use xlink:href="#bottom" {use_attrs(col)}/></g></g></g></g>')
    body = (defs
            + f'<g>{move}{zoom}'
            + half("L", E, -1)
            + half("R", accent, 1, "S")
            + f'<g fill="{accent}" shape-rendering="crispEdges">{"".join(pix)}{whole_pix}</g>'
            + scan_line
            + f'<g clip-path="url(#N)"><g opacity="0">{name_op}<g>{slide_a}'
            + f'<path fill="{E}" d="{xd} {ld}"/>'
            + f'<path fill="{E}" d="{smooth_b}" clip-path="url(#BS)"/>'
            + f'<g fill="{accent}" shape-rendering="crispEdges">{"".join(bpix)}</g>'
            + tag
            + "</g></g></g></g>")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {W} {H}" width="{W}" height="{H}">'
            f'<rect width="{W}" height="{H}" fill="{B.PAPER}"/>{body}</svg>\n')


def main():
    for colour, accent in B.ACCENTS.items():
        once = build(accent, False, END)
        (B.HERE / f"xblab-motion-{colour}.svg").write_text(once)
        looped = build(accent, True, END + 1800)  # holds the lockup, then starts again
        (B.HERE / f"xblab-motion-{colour}-loop.svg").write_text(looped)
        print(colour, len(once) // 1024, "KB")


if __name__ == "__main__":
    main()
