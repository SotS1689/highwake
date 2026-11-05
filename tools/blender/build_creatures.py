# Builds Highwake's sky creatures in Blender and exports models/creatures.glb with
# one mesh each: whale, manta (sky ray), skyling (bird) and jelly (lantern-jelly bell
# and oral arms). They replace the code-built shapes in js/creatures.js.
#
# The game animates these in its vertex shaders (whales undulate, rays ripple their
# wings, skylings flap, all instanced), so each mesh carries the attributes those
# shaders read, in the same units as the old geometry:
#   whale:   unit length, +z forward; colour, _glow, _flex (tail flex, fin flex)
#   manta:   unit span;   _mp (planform x, planform z, skin: 1 top, -1 belly, 0 tail)
#   skyling: ~5 m span;   _fp (part 0 body / 1 wing / 2 tail, u, w across the part)
#   jelly:   unit radius, bell on top, arms hanging below
#
# Run headless: powershell -File tools/blender/run.ps1 tools/blender/build_creatures.py [--render]
# Game space is +x left, +y up, +z forward; Blender gets (x, -z, y), which the glTF
# exporter turns back.

import bpy, math, sys, os, traceback
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = argv[0] if argv else os.getcwd()
LOG = open(argv[1] if len(argv) > 1 else os.path.join(ROOT, "tools", "blender", "last.log"), "w", encoding="utf-8")
RENDER = "--render" in argv
TAU = math.pi * 2


def log(*a):
    print(*a, file=LOG, flush=True)


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def gauss(x, w):
    return math.exp(-(x * x) / (w * w))


def clamp(x, a=0.0, b=1.0):
    return min(b, max(a, x))


def lerp_prof(prof, z):
    """Smoothly interpolate rows [z, a, b, ...] sorted by descending z."""
    if z >= prof[0][0]:
        return prof[0][1:]
    for a, b in zip(prof, prof[1:]):
        if b[0] <= z <= a[0]:
            t = (a[0] - z) / (a[0] - b[0])
            t = t * t * (3 - 2 * t)
            return [a[k] + (b[k] - a[k]) * t for k in range(1, len(a))]
    return prof[-1][1:]


class Mesh:
    """Vertices with per-vertex attributes, faces that orient themselves outward."""

    def __init__(self, name, defaults):
        self.name, self.defaults = name, defaults
        self.v, self.f = [], []
        self.a = {k: [] for k in defaults}

    def vert(self, p, **attrs):
        self.v.append(Vector(p))
        for k, d in self.defaults.items():
            self.a[k].append(attrs.get(k, d))
        return len(self.v) - 1

    def face(self, idx, outward=None, inside=None):
        """outward: direction the face should point; inside: a point it should face away from."""
        if outward is not None or inside is not None:
            P = [self.v[i] for i in idx]
            n = (P[1] - P[0]).cross(P[-1] - P[0]) if len(P) == 3 else (P[2] - P[0]).cross(P[3] - P[1])
            c = sum(P, Vector()) / len(P)
            want = outward if outward is not None else c - inside
            if n.dot(want) < 0:
                idx = idx[::-1]
        self.f.append(list(idx))


def loft(m, loops, centers, attr=lambda i, j: {}, cap_start=True, cap_end=True, tip_start=None, tip_end=None):
    """Closed tube through loops of equal size; faces point away from each ring's centre."""
    n = len(loops[0])
    ids = [[m.vert(p, **attr(i, j)) for j, p in enumerate(loop)] for i, loop in enumerate(loops)]
    for i in range(len(loops) - 1):
        c = (centers[i] + centers[i + 1]) / 2
        for j in range(n):
            j2 = (j + 1) % n
            m.face([ids[i][j], ids[i + 1][j], ids[i + 1][j2], ids[i][j2]], inside=c)
    for flag, k, k2, tip in ((cap_start, 0, 1, tip_start), (cap_end, -1, -2, tip_end)):
        if not flag:
            continue
        t = tip if tip is not None else centers[k]
        ti = m.vert(t, **attr(0 if k == 0 else len(loops) - 1, 0))
        for j in range(n):
            m.face([ids[k][j], ids[k][(j + 1) % n], ti], inside=centers[k2])
    return ids


def airfoil(le, chord_dir, normal, chord, thick, n=14):
    """Closed loop around an airfoil section, leading edge first."""
    pts = []
    for k in range(n):
        a = k / n * TAU
        x = (1 - math.cos(a)) / 2
        yt = 5 * thick * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        yt = max(yt, 0.0015 * chord / 0.1) * (1 if math.sin(a) >= 0 else -1)
        pts.append(le + chord_dir * (chord * x) + normal * (yt * chord))
    return pts


def fin(m, root, span_dir, sweep_dir, length, chord_fn, thick, attr_fn, n_span=18, n_ar=14, droop=Vector()):
    """A lofted fin: airfoil sections from root to tip."""
    span_dir = span_dir.normalized()
    ch = (sweep_dir - span_dir * sweep_dir.dot(span_dir)).normalized()
    nrm = span_dir.cross(ch).normalized()
    loops, centers, meta = [], [], []
    for i in range(n_span + 1):
        s = i / n_span
        le = root + span_dir * (length * s) + droop * (s * s)
        c, back = chord_fn(s)
        le = le + ch * back
        loops.append(airfoil(le, ch, nrm, c, thick, n_ar))
        centers.append(le + ch * c * 0.4)
        meta.append(s)
    # top: whether this vertex is on the upper face of the fin
    up_side = nrm.y >= 0
    return loft(m, loops, centers, lambda i, j: attr_fn(meta[i], loops[i][j], (j < n_ar / 2) == up_side), cap_start=True, cap_end=True)


# ================================================================================================
# Whale
def build_whale():
    m = Mesh("whale", {"col": (0.5, 0.5, 0.5), "glow": 0.0, "flex": (0.0, 0.0)})
    # z, half width, half height
    PROF = [
        [0.5, 0.004, 0.004], [0.495, 0.03, 0.022], [0.48, 0.05, 0.042], [0.45, 0.068, 0.06], [0.4, 0.085, 0.076],
        [0.3, 0.102, 0.092], [0.15, 0.112, 0.1], [0.0, 0.108, 0.098], [-0.15, 0.09, 0.086], [-0.28, 0.062, 0.068],
        [-0.38, 0.036, 0.05], [-0.45, 0.02, 0.032], [-0.49, 0.012, 0.018], [-0.5, 0.004, 0.006],
    ]
    rng = [noise.random() for _ in range(1)]
    knobs = []
    noise.seed_set(7)
    for k in range(26):
        z = 0.38 + noise.random() * 0.105
        th = (noise.random() - 0.5) * 1.5
        knobs.append((z, th, 0.0015 + noise.random() * 0.0015))
    N = 96
    zs = [0.5 - i / 150 for i in range(151)]
    loops, centers = [], []
    for z in zs:
        w, h = lerp_prof(PROF, z)
        cy = 0.008 * smooth(0.25, 0.48, z)          # the head rides a little high
        loop = []
        for j in range(N):
            th = j / N * TAU                          # 0 = top, + toward the left
            s, c = math.sin(th), math.cos(th)
            x, y = s * w, c * h
            if y < 0:
                y *= 0.93 + 0.1 * smooth(0.2, 0.45, z)   # the lower jaw fills out the front
            a = abs(math.atan2(s, c))                    # 0 top .. pi belly
            dr = 0.0
            dr -= 0.0045 * gauss(a - (1.95 - 0.25 * smooth(0.3, 0.49, z)), 0.045) * smooth(0.26, 0.33, z)   # mouth line
            dr += 0.006 * gauss(z - 0.33, 0.012) * gauss(a - 1.62, 0.09)          # eye ridge
            dr -= 0.003 * gauss(z - 0.36, 0.012) * gauss(a, 0.08)                  # blowhole
            for kz, kth, kr in knobs:                                              # tubercles on the head
                dr += kr * gauss(z - kz, 0.008) * gauss(th - kth if th < math.pi else th - TAU - kth, 0.06)
            pleat = (0.5 + 0.5 * math.cos(a * 46)) * smooth(2.2, 2.6, a) * smooth(-0.05, 0.08, z) * smooth(0.44, 0.36, z)
            dr -= 0.0022 * pleat                                                   # throat pleats
            dr += 0.0035 * gauss(a, 0.18) * (0.5 + 0.5 * math.cos(z * 140)) * smooth(-0.05, -0.15, z) * smooth(-0.45, -0.35, z)  # spine knuckles
            dr += 0.01 * gauss(a, 0.2) * smooth(-0.3, -0.42, z) + 0.008 * gauss(a - math.pi, 0.2) * smooth(-0.32, -0.44, z)  # tail keels
            r = math.hypot(x, y) or 1
            loop.append(Vector((x + x / r * dr, cy + y + y / r * dr, z)))
        loops.append(loop)
        centers.append(Vector((0, cy, z)))

    def body_attr(i, j):
        p = loops[i][j]
        z = p.z
        d = Vector((p.x, p.y - centers[i].y, 0)).normalized() if (p.x or p.y) else Vector((0, 1, 0))
        up = clamp(d.y * 1.6 + 0.5)
        mt = noise.noise(p * 12) * 0.07 + noise.noise(p * 40) * 0.03
        back = (0.14 + mt, 0.22 + mt, 0.36 + mt)
        belly = (0.86, 0.88, 0.88)
        col = tuple(belly[k] + (back[k] - belly[k]) * up for k in range(3))
        th = math.atan2(d.y, abs(d.x))
        gl = 1.0 if abs(th - 0.35) < 0.12 and ((z * 34) % 1) < 0.38 and -0.35 < z < 0.4 else 0.0
        tail = clamp((0.15 - z) / 0.65) ** 1.6
        return dict(col=col, glow=gl, flex=(tail, 0.0))

    loft(m, loops, centers, body_attr, tip_start=Vector((0, 0, 0.502)), tip_end=Vector((0, 0, -0.502)))

    def fin_attr(kind):
        def f(s, p, top=True):
            mt = noise.noise(p * 30) * 0.05
            # dark above, pale below, with a pale leading edge on the pectorals like a humpback
            dark = (0.14 + mt, 0.22 + mt, 0.36 + mt)
            pale = (0.78, 0.82, 0.84)
            col = dark if top or kind == "dorsal" else pale
            if kind == "pec" and not top:
                col = pale
            gl = 0.7 if kind == "pec" and s > 0.55 else 0.0
            tail = clamp((0.15 - p.z) / 0.65) ** 1.6
            fx = {"pec": 1.0, "rear": 0.6}.get(kind, 0.0) * max(0.0, abs(p.x) - 0.07)
            return dict(col=col, glow=gl, flex=(tail, fx))
        return f

    for sx in (1, -1):
        # long pectorals with a knobbly leading edge
        fin(m, Vector((sx * 0.085, -0.035, 0.2)), Vector((sx * 1, -0.42, -0.5)), Vector((0, 0, -1)), 0.33,
            lambda s: (0.085 * (1 - s) ** 0.55 + 0.03 * (1 - smooth(0.0, 0.15, s)) + 0.012 + 0.006 * (0.5 + 0.5 * math.sin(s * 42)) * smooth(0.15, 0.3, s) * (1 - s), 0.0),
            0.16, fin_attr("pec"), n_span=26, droop=Vector((0, -0.03, -0.03)))
        # smaller rear fins
        fin(m, Vector((sx * 0.07, -0.03, -0.08)), Vector((sx * 1, -0.35, -0.6)), Vector((0, 0, -1)), 0.2,
            lambda s: (0.06 * (1 - s) ** 0.6 + 0.01, 0.0), 0.15, fin_attr("rear"))
    # dorsal fin
    fin(m, Vector((0, 0.07, -0.19)), Vector((0, 1, -0.9)), Vector((0, 0, -1)), 0.045,
        lambda s: (0.075 * (1 - s) + 0.008, 0.02 * s), 0.18, fin_attr("dorsal"), n_span=8)
    # flukes: one wing across the tail, swept back, with a notch and a ragged trailing edge
    loops, centers, meta = [], [], []
    for i in range(41):
        u = i / 40 * 2 - 1
        s = abs(u)
        le = Vector((u * 0.21, 0.0, -0.462 - 0.07 * s ** 1.6 + 0.004 * (1 - s)))
        chord = (0.075 * (1 - s ** 2.2) + 0.006) * (0.62 + 0.38 * smooth(0.0, 0.14, s)) * (1 - 0.05 * math.sin(s * 34) * smooth(0.2, 0.4, s))
        lp = airfoil(le, Vector((0, 0, -1)), Vector((0, 1, 0)), chord, 0.14 + 0.1 * (1 - s), 14)
        loops.append(lp)
        centers.append(le + Vector((0, 0, -chord * 0.4)))
        meta.append(s)
    fa = fin_attr("fluke")
    loft(m, loops, centers, lambda i, j: fa(meta[i], loops[i][j], j < 7))
    return m


# ================================================================================================
# Manta
def build_manta():
    m = Mesh("manta", {"mp": (0.0, 0.0, 0.0)})
    NU, NV = 96, 40
    front = lambda a: 0.36 * (1 - a) ** 1.25 - 0.06 * a + 0.1 * gauss(a - 0.075, 0.03) - 0.035 * gauss(a, 0.035)
    back = lambda a: -0.4 + 0.3 * a ** 0.6

    def thick(u, v, side):
        a = abs(u)
        sv = math.sin(math.pi * v)
        # thick body and head, thin wings, a raised spine and shoulder muscles
        body = 0.062 * max(0.0, 1 - a * 1.6) ** 2 * sv ** 0.6
        wing = 0.013 * (1 - a) * (v ** 0.35 * (1 - v)) * 2.2
        musc = 0.008 * gauss(a - 0.13, 0.05) * sv * smooth(0.0, 0.3, v) * (1 if side > 0 else 0.4)
        spine = 0.006 * gauss(a, 0.02) * smooth(0.2, 0.6, v) if side > 0 else 0.0
        eye = 0.01 * gauss(a - 0.12, 0.02) * gauss(front(a) - 0.27 + (v * 0) , 0.03) * gauss(v, 0.12) if side > 0 else 0.0
        camber = 0.015 * (1 - a * a) * sv - 0.02 * a * a - 0.035 * a ** 3       # wingtips droop
        return camber + (body + wing + musc + spine + eye if side > 0 else -(body * 0.55 + wing * 0.7 + musc))

    grid = {}
    for side in (1, -1):
        for i in range(NU + 1):
            s = i / NU * 2 - 1
            u = math.copysign(abs(s) ** 1.35, s)
            a = abs(u)
            for j in range(NV + 1):
                v = j / NV
                rim = j in (0, NV) or i in (0, NU)
                if side < 0 and rim:
                    grid[(side, i, j)] = grid[(1, i, j)]
                    continue
                z = front(a) + (back(a) - front(a)) * v
                y = thick(u, v, 1 if rim else side)
                grid[(side, i, j)] = m.vert((u * 0.5, y, z), mp=(u * 0.5, z, 1.0 if rim else float(side)))
        for i in range(NU):
            for j in range(NV):
                q = [grid[(side, i, j)], grid[(side, i + 1, j)], grid[(side, i + 1, j + 1)], grid[(side, i, j + 1)]]
                m.face(q, outward=Vector((0, side, 0)))
    # cephalic fins: rolled lobes either side of the mouth, curling down
    for sx in (1, -1):
        loops, centers = [], []
        for k in range(13):
            t = k / 12
            c = Vector((sx * (0.068 + 0.012 * t), 0.004 - 0.03 * t * t, 0.33 + 0.11 * t))
            r = 0.016 * (1 - 0.6 * t) + 0.003
            loop = [c + Vector((math.cos(q / 10 * TAU) * r * 0.45, math.sin(q / 10 * TAU) * r, 0)) for q in range(10)]
            loops.append(loop)
            centers.append(c)
        loft(m, loops, centers, lambda i, j, lp=loops: {"mp": (lp[i][j].x, lp[i][j].z, 1.0)}, cap_start=False)
    # whip tail with a small dorsal fin at its root
    loops, centers = [], []
    for k in range(25):
        t = k / 24
        c = Vector((0, 0.004 - 0.01 * t, -0.36 - 0.66 * t))
        r = 0.013 * (1 - t) ** 1.2 + 0.0015
        loops.append([c + Vector((math.cos(q / 8 * TAU) * r, math.sin(q / 8 * TAU) * r * 0.8, 0)) for q in range(8)])
        centers.append(c)
    loft(m, loops, centers, lambda i, j: {"mp": (loops[i][j].x, loops[i][j].z, 0.0)}, cap_start=False)
    fin(m, Vector((0, 0.012, -0.34)), Vector((0, 1, -1.2)), Vector((0, 0, -1)), 0.03,
        lambda s: (0.04 * (1 - s) + 0.004, 0.0), 0.2, lambda s, p, top=True: {"mp": (p.x, p.z, 1.0)}, n_span=6)
    return m


# ================================================================================================
# Skyling
def build_skyling():
    m = Mesh("skyling", {"fp": (0.0, 0.0, 0.0)})
    # z, radius
    PROF = [[1.78, 0.004], [1.62, 0.03], [1.48, 0.06], [1.4, 0.12], [1.3, 0.17], [1.16, 0.19], [1.02, 0.15],
            [0.85, 0.2], [0.6, 0.28], [0.3, 0.31], [-0.1, 0.27], [-0.45, 0.17], [-0.7, 0.08], [-0.78, 0.02]]
    loops, centers, NB = [], [], 24
    zs = [1.78 - i / 70 * 2.56 for i in range(71)]
    for z in zs:
        (r,) = lerp_prof(PROF, z)
        beak = smooth(1.42, 1.6, z)
        cy = 0.06 * smooth(0.8, 1.2, z) - 0.03 * beak
        loop = []
        for q in range(NB):
            a = q / NB * TAU
            x, y = math.sin(a) * r, math.cos(a) * r * (0.85 - 0.25 * beak)
            # feather tufts: a slightly ruffled surface on the body
            y += 0.006 * math.sin(a * 9 + z * 30) * (1 - beak)
            loop.append(Vector((x, y + cy, z)))
        loops.append(loop)
        centers.append(Vector((0, cy, z)))
    loft(m, loops, centers, lambda i, j: {"fp": (0.0, i / 70, j / NB)},
         tip_start=Vector((0, centers[0].y - 0.01, 1.8)), tip_end=Vector((0, 0.0, -0.8)))

    def wing_attr(x, w):
        return {"fp": (1.0, clamp((abs(x) - 0.18) / 2.45), clamp(w))}

    for s in (1, -1):
        # arm and hand: a thin cambered airfoil from the body out to the wrist
        loops, centers, meta = [], [], []
        for i in range(31):
            u = i / 30 * 0.7
            x = 0.18 + u * 2.45
            le = 0.5 - 0.28 * u ** 1.4
            te = -0.42 + 0.05 * u
            chord = (le - te) * (1 - 0.45 * u ** 1.5) * (1 - 0.35 * smooth(0.5, 0.7, u))
            L = Vector((s * x, 0.06 * (1 - u) + 0.03 * u + 0.02 * math.sin(math.pi * u), le))
            lp = airfoil(L, Vector((0, -0.04, -1)).normalized(), Vector((0, 1, 0)), chord, 0.1 - 0.06 * u, 12)
            loops.append(lp)
            centers.append(L + Vector((0, 0, -chord * 0.4)))
            meta.append((le, chord))
        loft(m, loops, centers, lambda i, j, lp=loops, mt=meta: wing_attr(lp[i][j].x, (mt[i][0] - lp[i][j].z) / max(mt[i][1], 1e-3) * 0.75))
        # primaries: six long feathers fanning from the hand, splitting at the tip
        for k in range(6):
            t = k / 5
            base = Vector((s * (0.18 + 2.45 * (0.5 + 0.18 * t)), 0.05, 0.28 - 0.42 * t))
            ang = -0.08 - 0.42 * t                      # fan backward
            dirv = Vector((s * math.cos(ang), 0.01, math.sin(ang)))
            length = 0.95 - 0.3 * t
            loops, centers = [], []
            for i in range(11):
                f = i / 10
                p = base + dirv * (length * f) + Vector((0, -0.04 * f * f, 0))
                wdt = 0.19 * math.sqrt(max(0.0, 1 - f ** 2.5)) + 0.01
                side = Vector((0, 0, 1)).cross(dirv).normalized() if False else Vector((-dirv.z, 0, dirv.x)) * s
                loops.append([p + side * (wdt * 0.5), p + Vector((0, 0.008 * (1 - f), 0)), p - side * (wdt * 0.5), p - Vector((0, 0.006 * (1 - f), 0))])
                centers.append(p)
            loft(m, loops, centers, lambda i, j, lp=loops, kk=k: wing_attr(lp[i][j].x, 0.5 + 0.5 * kk / 5 + 0.1 * (i / 10)), cap_start=False)
    # forked tail: eight feathers in a fan, the outer ones longest
    for k in range(8):
        u = k / 7
        a = (u - 0.5) * 1.0
        length = 0.9 + 0.5 * abs(u - 0.5) * 2
        base = Vector(((u - 0.5) * 0.14, 0.03, -0.55))
        dirv = Vector((math.sin(a) * 0.8, -0.02, -math.cos(a))).normalized()
        loops, centers = [], []
        for i in range(9):
            f = i / 8
            p = base + dirv * (length * f)
            wdt = 0.13 * math.sin(math.pi * (0.15 + 0.85 * f)) ** 0.5 * (1 - 0.6 * f) + 0.02
            side = Vector((-dirv.z, 0, dirv.x))
            loops.append([p + side * (wdt * 0.5), p + Vector((0, 0.008, 0)), p - side * (wdt * 0.5), p - Vector((0, 0.006, 0))])
            centers.append(p)
        loft(m, loops, centers, lambda i, j, uu=u: {"fp": (2.0, uu, i / 8)}, cap_start=False)
    return m


# ================================================================================================
# Lantern-jelly
def build_jelly():
    m = Mesh("jelly", {})
    NT, NP = 96, 26
    LOBES = 16

    def rim(th):
        return 0.56 * math.pi + 0.07 * abs(math.sin(th * LOBES / 2))     # scalloped margin

    def shell(r, th, phi_t, inner):
        phi = phi_t * rim(th)
        rib = 0.022 * math.cos(th * LOBES) * math.sin(phi) * (0 if inner else 1)
        rr = r * (1 + rib)
        sq = 0.92 if not inner else 0.9
        return Vector((math.sin(phi) * math.cos(th) * rr, math.cos(phi) * rr * sq + (0.05 if inner else 0), math.sin(phi) * math.sin(th) * rr))

    # a single skin (the game draws it additively, so extra layers only wash it out):
    # the dome from just off the pole down to the scalloped margin, then a lip rolling inward
    rows = []
    for k in range(1, NP + 1):
        rows.append([shell(1.0, q / NT * TAU, k / NP, False) for q in range(NT)])
    for k in range(1, 4):
        t = k / 4
        rows.append([shell(1.0 - 0.07 * t, q / NT * TAU, 1.0 + 0.03 * math.sin(math.pi * t), False) for q in range(NT)])
    ids = [[m.vert(p) for p in row] for row in rows]
    for i in range(len(rows) - 1):
        for q in range(NT):
            q2 = (q + 1) % NT
            m.face([ids[i][q], ids[i + 1][q], ids[i + 1][q2], ids[i][q2]], inside=Vector((0, 0.1, 0)))
    top = m.vert((0, 0.92, 0))
    for q in range(NT):
        m.face([top, ids[0][q], ids[0][(q + 1) % NT]], outward=Vector((0, 1, 0)))
    # manubrium and four ruffled oral arms
    loops, centers = [], []
    for k in range(9):
        t = k / 8
        c = Vector((0, 0.75 - 1.15 * t, 0))
        r = 0.14 * (1 - 0.55 * t)
        loops.append([c + Vector((math.cos(q / 12 * TAU) * r, 0, math.sin(q / 12 * TAU) * r)) for q in range(12)])
        centers.append(c)
    loft(m, loops, centers, cap_start=False, cap_end=False)
    for arm in range(4):
        th = arm / 4 * TAU + 0.4
        dirv = Vector((math.cos(th), 0, math.sin(th)))
        side = Vector((-dirv.z, 0, dirv.x))
        loops, centers = [], []
        for k in range(41):
            t = k / 40
            c = Vector((0, -0.35 - 1.5 * t, 0)) + dirv * (0.08 + 0.12 * t + 0.05 * math.sin(t * 9 + arm))
            wdt = 0.16 * (1 - t) ** 0.7 + 0.02
            ruff = 0.05 * math.sin(t * 60 + arm) * (1 - t)
            loops.append([c + dirv * (wdt * 0.5) + side * ruff, c + side * 0.012, c - dirv * (wdt * 0.3) - side * ruff, c - side * 0.012])
            centers.append(c)
        loft(m, loops, centers, cap_start=False)
    return m


# ================================================================================================
def to_bl(p):
    return Vector((p.x, -p.z, p.y))


def make_object(m, preview_mat):
    me = bpy.data.meshes.new(m.name)
    me.from_pydata([to_bl(v) for v in m.v], [], m.f)
    for poly in me.polygons:
        poly.use_smooth = True
    for k, vals in m.a.items():
        if k == "col":
            ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
            ca.data.foreach_set("color", [c for v in vals for c in (*v, 1.0)])
            me.color_attributes.active_color = ca
        elif k == "glow":
            me.attributes.new("_glow", "FLOAT", "POINT").data.foreach_set("value", vals)
        elif k == "flex":
            me.attributes.new("_flex", "FLOAT2", "POINT").data.foreach_set("vector", [c for v in vals for c in v])
        else:
            me.attributes.new("_" + k, "FLOAT_VECTOR", "POINT").data.foreach_set("vector", [c for v in vals for c in v])
    me.validate()
    me.materials.append(preview_mat)
    ob = bpy.data.objects.new(m.name, me)
    bpy.context.scene.collection.objects.link(ob)
    # outward check: fraction of faces whose normal points away from the mesh centre
    cen = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
    out = sum(1 for p in me.polygons if p.normal.dot(p.center - cen) > 0)
    log("%s: %d verts, %d faces, %d%% facing out" % (m.name, len(me.vertices), len(me.polygons), 100 * out // len(me.polygons)))
    return ob


def preview_material():
    mat = bpy.data.materials.new("preview")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    bsdf.inputs["Roughness"].default_value = 0.55
    bsdf.inputs["Base Color"].default_value = (0.35, 0.45, 0.6, 1)
    return mat, nt, vc, bsdf


def render_previews(objs):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 32
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 960, 600
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.45, 0.6, 0.85, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.7
    sc.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(-30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    out_dir = os.path.join(ROOT, "tools", "blender", "renders")
    os.makedirs(out_dir, exist_ok=True)
    views = {"whale": ((0.9, -0.5, 0.35), 1.0), "manta": ((0.25, -0.9, 0.9), 1.6), "skyling": ((3.2, -4.0, 2.4), 6.0), "jelly": ((2.4, -3.2, 0.6), 4.5)}
    for ob in objs:
        for o in objs:
            o.hide_render = o is not ob
        loc, size = views[ob.name]
        cen = sum((Vector(c) for c in ob.bound_box), Vector()) / 8
        cam.location = cen + Vector(loc) * (size / max(Vector(loc).length, 1e-3)) * 1.3
        cam.rotation_euler = (cen - cam.location).to_track_quat("-Z", "Y").to_euler()
        cam.data.lens = 40
        sc.render.filepath = os.path.join(out_dir, "creature_" + ob.name + ".png")
        bpy.ops.render.render(write_still=True)
        log("rendered", sc.render.filepath)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mat, nt, vc, bsdf = preview_material()
    objs = []
    for build in (build_whale, build_manta, build_skyling, build_jelly):
        m = build()
        objs.append(make_object(m, mat))
    # whales use their vertex colours in the preview; the others a flat tint
    whale_mat = mat.copy()
    whale_mat.node_tree.links.new(whale_mat.node_tree.nodes["Color Attribute"].outputs["Color"], whale_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    objs[0].data.materials[0] = whale_mat
    out = os.path.join(ROOT, "models", "creatures.glb")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_attributes=True,
        export_vertex_color="ACTIVE", export_materials="NONE", export_animations=False,
        export_lights=False, export_cameras=False, export_texcoords=False,
    )
    log("exported", out, os.path.getsize(out) // 1024, "KB")
    if RENDER:
        render_previews(objs)


try:
    main()
    log("== DONE")
except Exception:
    log(traceback.format_exc())
    log("== FAILED")
finally:
    LOG.close()
