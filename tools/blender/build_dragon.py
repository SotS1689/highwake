# Builds Highwake's sky-dragon in Blender: a sculpted body lofted from the same
# profile as the in-game dragon, horns, teeth, dorsal spines, eyes, hind legs and
# membrane wings on finger bones, all skinned to one armature, with glide, flap
# and brake animations. Exports models/dragon.glb and renders preview images.
#
# Run headless: powershell -File tools/blender/run.ps1 tools/blender/build_dragon.py [--render]
#
# Dragon space (as in js/dragon.js): +x left, +y up, +z forward. Blender is Z-up
# with the dragon facing -Y, so a point (x, y, z) becomes (x, -z, y); the glTF
# exporter turns that back into the game's frame.
#
# Per-vertex data the game's skin shader reads (exported as custom attributes):
#   colour (linear RGB), _glow (bioluminescence), _skin (kind, thinness, scale size)
# and UVs in metres (around, along) so the procedural scales have a real size.

import bpy, bmesh, math, sys, os, traceback
from mathutils import Vector, Quaternion, Matrix

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = argv[0] if argv else os.getcwd()
LOG = open(argv[1] if len(argv) > 1 else os.path.join(ROOT, "tools", "blender", "last.log"), "w", encoding="utf-8")
RENDER = "--render" in argv


def log(*a):
    print(*a, file=LOG, flush=True)


TAU = math.pi * 2
SCALES, PLATES, HORN, MEMBRANE = 0, 1, 2, 3


def smooth(a, b, x):
    t = min(1.0, max(0.0, (x - a) / (b - a)))
    return t * t * (3 - 2 * t)


def gauss(x, w):
    return math.exp(-(x * x) / (w * w))


def mix3(a, b, t):
    return [a[i] + (b[i] - a[i]) * t for i in range(3)]


COL = dict(
    top=[0.010, 0.033, 0.062], flank=[0.02, 0.15, 0.27], belly=[0.5, 0.41, 0.27], stripe=[0.78, 0.3, 0.05],
    face=[0.09, 0.2, 0.28], mask=[0.004, 0.012, 0.025], mouth=[0.05, 0.008, 0.012], leg=[0.025, 0.12, 0.21],
    bone=[0.72, 0.64, 0.48], horn=[0.05, 0.06, 0.07], claw=[0.03, 0.028, 0.025], tooth=[0.85, 0.82, 0.72],
    wingIn=[0.012, 0.04, 0.075], wingMid=[0.03, 0.12, 0.21], wingEdge=[0.42, 0.15, 0.035], arm=[0.035, 0.14, 0.25],
)

PROF = [
    [7.8, 0.05, 0.04, 0], [7.55, 0.19, 0.14, 0], [7.1, 0.29, 0.23, 0], [6.6, 0.37, 0.29, 0],
    [6.15, 0.49, 0.39, 0], [5.75, 0.55, 0.45, 0], [5.35, 0.43, 0.41, 0], [4.9, 0.33, 0.37, 0.1],
    [3.9, 0.4, 0.46, 0.2], [2.7, 0.66, 0.74, 0.3], [1.5, 1.05, 1.08, 0.36], [0.4, 1.18, 1.18, 0.38],
    [-0.9, 1.06, 1.02, 0.36], [-2.3, 0.86, 0.8, 0.32], [-4.1, 0.6, 0.56, 0.28], [-6.6, 0.38, 0.36, 0.22],
    [-9.2, 0.22, 0.21, 0.15], [-11.4, 0.13, 0.11, 0.08], [-12.4, 0.42, 0.06, 0], [-13.4, 0.52, 0.045, 0],
    [-14.3, 0.3, 0.035, 0], [-15.0, 0.02, 0.02, 0],
]
Z0, Z1 = PROF[0][0], PROF[-1][0]
HEAD_Z = 5.3


def prof_at(z):
    for a, b in zip(PROF, PROF[1:]):
        if b[0] <= z <= a[0]:
            t = (a[0] - z) / (a[0] - b[0])
            t = t * t * (3 - 2 * t)
            return [a[k] + (b[k] - a[k]) * t for k in (1, 2, 3)]
    return [0.02, 0.02, 0]


def mouth_angle(z):
    return 2.0 - 0.3 * smooth(7.6, 5.7, z)


def spine_y(z):
    return 0.55 * smooth(2, 5.6, z)


def section(z, th):
    """Offset (x, y) of the skin at z and angle th (0 = spine, pi = belly, + = left)."""
    hw, hh, crest = prof_at(z)
    head = smooth(5.1, 5.6, z)
    s, c = math.sin(th), math.cos(th)
    n = 2 + head * 0.9
    x = math.copysign(abs(s) ** (2 / n), s) * hw
    y = math.copysign(abs(c) ** (2 / n), c) * hh
    y = y * 0.85 if y < 0 else y * (1 - 0.18 * head)
    a = abs(th % TAU)
    if a > math.pi:
        a = TAU - a
    dr = crest * 0.3 * gauss(a, 0.13)
    if z > 5.2:
        dr += 0.09 * gauss(z - 6.15, 0.28) * gauss(a - 0.8, 0.3)
        dr -= 0.05 * gauss(z - 6.38, 0.14) * gauss(a - 1.12, 0.16)
        dr += 0.07 * gauss(z - 5.75, 0.3) * gauss(a - 1.65, 0.35)
        dr += 0.035 * gauss(z - 7.42, 0.1) * gauss(a - 0.5, 0.18)
        mA, lip = mouth_angle(z), smooth(5.55, 5.9, z)
        dr -= 0.035 * gauss(a - mA, 0.06) * lip
        if a > mA:
            x *= 1 - 0.08 * lip
        # extra sculpting the CPU dragon can't afford: cheekbones, a nasal ridge, a heavier jaw
        dr += 0.04 * gauss(z - 6.7, 0.35) * gauss(a - 1.35, 0.2)
        dr += 0.025 * gauss(a, 0.18) * smooth(6.3, 6.8, z) * smooth(7.6, 7.2, z)
        dr += 0.03 * gauss(z - 5.6, 0.25) * gauss(a - 2.4, 0.3)
    dr += 0.17 * gauss(z - 1.4, 0.9) * gauss(a - 0.9, 0.45)
    dr += 0.12 * gauss(z - 1.9, 0.8) * gauss(a - math.pi, 0.6)
    dr += 0.14 * gauss(z + 2.5, 0.7) * gauss(a - 1.95, 0.45)
    dr += 0.016 * math.sin(z * 9) * smooth(-1.4, -0.6, z) * smooth(2.4, 1.6, z) * gauss(a - 1.6, 0.5)
    # muscle bands down the neck and tail, so the long tube isn't a plain sausage
    dr += 0.02 * math.sin(z * 3.1) * gauss(a - 1.2, 0.5) * smooth(-12, -4, z) * smooth(5.0, 3.0, z)
    r = math.hypot(x, y) or 1
    return x + x / r * dr, y + y / r * dr


def surf(z, th, lift=0.0):
    sx, sy = section(z, th)
    r = math.hypot(sx, sy) or 1
    k = 1 + lift / r
    return Vector((sx * k, spine_y(z) + sy * k, z))


# ---- bones (dragon space) -------------------------------------------------------------------
# name, head, tail, parent
SPINE = [
    ("chest", 0.5, 2.6, None), ("neck1", 2.6, 3.9, "chest"), ("neck2", 3.9, HEAD_Z, "neck1"), ("head", HEAD_Z, 7.8, "neck2"),
    ("hips", 0.5, -2.0, "chest"), ("tail1", -2.0, -4.6, "hips"), ("tail2", -4.6, -7.2, "tail1"),
    ("tail3", -7.2, -9.6, "tail2"), ("tail4", -9.6, -11.8, "tail3"), ("tail5", -11.8, -15.0, "tail4"),
]
SPINE_P = lambda z: Vector((0, spine_y(z), z))


def body_weights(z):
    """Skin weights for a point on the body at z: each spine bone owns its span,
    blending with its neighbour across each joint. The skull is rigid."""
    out = {}
    for name, a, b, _ in SPINE:
        lo, hi = min(a, b), max(a, b)
        d = lo - z if z < lo else z - hi if z > hi else 0.0
        width = 0.15 if name in ("head", "neck2") and z > HEAD_Z - 0.1 else 0.7
        if z > HEAD_Z + 0.05 and name != "head":
            continue
        w = max(0.0, 1 - d / width)
        if w > 0:
            out[name] = w
    return out


# ---- wing layout in the glide (rest) pose ----------------------------------------------------
def wing_points(s):
    phi1, phi2 = 0.08, 0.02
    Xa = Vector((s * math.cos(phi1), math.sin(phi1), 0))
    Xb = Vector((s * math.cos(phi2), math.sin(phi2), 0))
    Z = Vector((0, 0, 1))
    S = surf(1.5, s * 0.72, 0.01)
    E = S + Xa * 2.7 + Z * -1.3
    W = E + Xa * 3.5 + Z * 1.9
    F = [W + Xb * a + Z * c for a, c in [(6.0, -1.5), (4.8, -3.7), (3.1, -5.0), (1.3, -5.5)]]
    # fingers bow down and back a little, like a bat's
    Fm = [(W + f) / 2 + Vector((0, -0.12, -0.15)) for f in F]
    B = surf(-3.6, s * 1.12, 0.01)
    return dict(S=S, E=E, W=W, F=F, Fm=Fm, B=B)


def leg_points(s):
    H = surf(-2.5, s * 1.9, -0.25)
    K = H + Vector((s * 0.12, -0.55, 0.45))
    A = K + Vector((s * 0.05, -0.12, -1.55))
    toes = [A + Vector((s * dx, -0.12, -0.75)) for dx in (-0.14, 0.02, 0.18)]
    return H, K, A, toes


def bone_list():
    bones = [(n, SPINE_P(a), SPINE_P(b), p) for n, a, b, p in SPINE]
    for s, sfx in ((1, ".L"), (-1, ".R")):
        w = wing_points(s)
        bones += [("upperarm" + sfx, w["S"], w["E"], "chest"), ("forearm" + sfx, w["E"], w["W"], "upperarm" + sfx)]
        for i in range(4):
            bones += [("finger%d%s" % (i, sfx), w["W"], w["Fm"][i], "forearm" + sfx),
                      ("finger%dtip%s" % (i, sfx), w["Fm"][i], w["F"][i], "finger%d%s" % (i, sfx))]
        H, K, A, _ = leg_points(s)
        bones += [("thigh" + sfx, H, K, "hips"), ("shin" + sfx, K, A, "thigh" + sfx)]
    return bones


BONES = bone_list()
SEG = {n: (h, t) for n, h, t, _ in BONES}


def seg_dist(p, a, b):
    ab = b - a
    t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
    return (a + ab * t - p).length


def nearest_weights(p, names, falloff=0.25, keep=3):
    ws = sorted(((1 / (seg_dist(p, *SEG[n]) + falloff) ** 4, n) for n in names), reverse=True)[:keep]
    tot = sum(w for w, _ in ws)
    return {n: w / tot for w, n in ws}


# ---- mesh builder -----------------------------------------------------------------------------
class Builder:
    def __init__(self):
        self.v, self.col, self.glow, self.skin, self.w = [], [], [], [], []
        self.f, self.mat, self.uv = [], [], []

    def vert(self, p, col, glow, skin, weights):
        self.v.append(Vector(p)); self.col.append(col); self.glow.append(glow); self.skin.append(skin); self.w.append(weights)
        return len(self.v) - 1

    def face(self, idx, mat, uvs):
        self.f.append(idx); self.mat.append(mat); self.uv.append(uvs)


MAT_SKIN, MAT_MEMBRANE, MAT_EYE = 0, 1, 2
bld = Builder()


def build_body():
    SIDES = 56
    zs, z = [], Z0
    while z > Z1:
        zs.append(z)
        z -= 0.028 if z > 5 else 0.07 if z > -4 else 0.11
    zs.append(Z1)
    rings = []
    for z in zs:
        hw, hh, _ = prof_at(z)
        perim = math.pi * (hw + hh)
        head = smooth(5.1, 5.6, z)
        thin = 1 - smooth(0.04, 0.6, min(hw, hh))
        wts = body_weights(z)
        ring = []
        for j in range(SIDES):
            th = math.pi + j / SIDES * TAU          # seam along the belly
            p = surf(z, th)
            up = math.cos(th)
            a = abs(th % TAU)
            if a > math.pi:
                a = TAU - a
            c = mix3(COL["top"], COL["flank"], 1 - up) if up > 0 else mix3(COL["flank"], COL["belly"], smooth(-0.1, -0.7, up))
            u = Z0 - z - a * 0.45
            sv = math.sin(u * 2.1 + math.sin(u * 0.6) * 1.5)
            if -12.2 < z < 5.0:
                c = mix3(c, COL["stripe"], smooth(0.74, 0.9, sv) * smooth(0.0, 0.45, up) * 0.9)
            if z > 5.2:
                c = mix3(c, COL["face"], 0.55 * smooth(5.6, 7.4, z) * smooth(-0.2, 0.5, up))
                c = mix3(c, COL["mask"], 0.85 * gauss(z - 6.3, 0.4) * gauss(a - 1.0, 0.35))
                c = mix3(c, COL["mouth"], gauss(a - mouth_angle(z), 0.05) * smooth(5.55, 5.9, z))
                c = mix3(c, COL["mask"], gauss(z - 7.47, 0.05) * gauss(a - 0.5, 0.09))
            dot = abs(((Z0 - z) * 1.6) % 1 - 0.5) < 0.18
            glow = ((1 if abs(a - 1.45) < 0.07 and dot and -12 < z < 4.8 else 0)
                    + (0.35 if a < 0.06 and dot and -12 < z < 4.6 else 0)
                    + gauss(a - 1.32, 0.05) * smooth(5.3, 5.6, z) * smooth(6.9, 6.5, z) * 0.8)
            plate = smooth(-0.55, -0.8, up) * (1 if z < 7.2 else 0) * smooth(-12.2, -11, z)
            size = (0.75 + 0.45 * smooth(-0.2, 0.8, up)) * (1 - head * 0.45) * (0.8 if z < -6 else 1)
            ring.append((bld.vert(p, c, glow, [plate, thin * 0.9 + 0.05, size], wts), perim))
        rings.append((z, ring))
    for (za, ra), (zb, rb) in zip(rings, rings[1:]):
        for j in range(SIDES):
            j2 = (j + 1) % SIDES
            u0, u1 = j / SIDES, (j + 1) / SIDES
            pa, pb = ra[0][1], rb[0][1]
            # Blender V is flipped on export, so store 1 - along to get "along" in the game
            # wound so the normals face outward
            bld.face([ra[j2][0], rb[j2][0], rb[j][0], ra[j][0]], MAT_SKIN,
                     [(u1 * pa, 1 - (Z0 - za)), (u1 * pb, 1 - (Z0 - zb)), (u0 * pb, 1 - (Z0 - zb)), (u0 * pa, 1 - (Z0 - za))])
    # close the snout and the tail tip
    for (z, ring), out in ((rings[0], 0.03), (rings[-1], -0.03)):
        tip = bld.vert(Vector((0, spine_y(z), z + out)), bld.col[ring[0][0]], 0, [0, 0.9, 0.5], body_weights(z))
        for j in range(SIDES):
            a, b = ring[j][0], ring[(j + 1) % SIDES][0]
            idx = [b, a, tip] if out < 0 else [a, b, tip]
            bld.face(idx, MAT_SKIN, [(0, 1 - (Z0 - z))] * 3)
    log("body: %d rings x %d" % (len(rings), SIDES))


def tube(pts, radii, sides, colfn, skin, weightfn, glowfn=lambda t: 0.0, flat=1.0, ridges=0.0, mat=MAT_SKIN, cap=True):
    """Tapered tube along a polyline, with parallel-transport frames. flat < 1 squashes
    it sideways into a blade; ridges adds growth rings."""
    n = len(pts)
    T = [(pts[min(n - 1, i + 1)] - pts[max(0, i - 1)]).normalized() for i in range(n)]
    ref = Vector((0, 1, 0)) if abs(T[0].y) < 0.9 else Vector((1, 0, 0))
    X = T[0].cross(ref).normalized()
    total = sum((pts[i + 1] - pts[i]).length for i in range(n - 1))
    acc, rings = 0.0, []
    for i in range(n):
        if i:
            acc += (pts[i] - pts[i - 1]).length
            X = (X - T[i] * X.dot(T[i])).normalized()
        U = T[i].cross(X)
        t = acc / total if total else 0
        r = radii[i] * (1 + ridges * math.sin(acc * 38) * (1 - t))
        ring = []
        for j in range(sides):
            a = j / sides * TAU
            p = pts[i] + X * (math.cos(a) * r * flat) + U * (math.sin(a) * r)
            ring.append(bld.vert(p, colfn(t), glowfn(t), skin, weightfn(pts[i], t)))
        rings.append((acc, ring, r))
    for (aa, ra, rr), (ab, rb, _) in zip(rings, rings[1:]):
        circ = TAU * max(rr, 0.02)
        for j in range(sides):
            j2 = (j + 1) % sides
            u0, u1 = j / sides * circ, (j + 1) / sides * circ
            bld.face([ra[j], ra[j2], rb[j2], rb[j]], mat, [(u0, 1 - aa), (u1, 1 - aa), (u1, 1 - ab), (u0, 1 - ab)])
    if cap:
        ring0 = rings[0][1]
        root = bld.vert(pts[0] - T[0] * radii[0] * 0.3, colfn(0.0), glowfn(0.0), skin, weightfn(pts[0], 0.0))
        for j in range(sides):
            bld.face([ring0[(j + 1) % sides], ring0[j], root], mat, [(0, 1)] * 3)
        acc, ring, _ = rings[-1]
        tip = bld.vert(pts[-1] + T[-1] * radii[-1], colfn(1.0), glowfn(1.0), skin, weightfn(pts[-1], 1.0))
        for j in range(sides):
            bld.face([ring[j], ring[(j + 1) % sides], tip], mat, [(0, 1 - acc)] * 3)


def curve(ctrl, n):
    """Catmull-Rom through control points."""
    out = []
    P = [ctrl[0]] + ctrl + [ctrl[-1]]
    for seg in range(len(ctrl) - 1):
        p0, p1, p2, p3 = P[seg:seg + 4]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(ctrl[-1])
    return out


def head_w(p, t):
    return {"head": 1.0}


def grad(a, b, t0=0.0, t1=1.0):
    return lambda t: mix3(a, b, smooth(t0, t1, t))


def build_head_details():
    for s in (1, -1):
        # main horns sweep back and up, then hook down; growth-ring ridges near the root
        base = surf(5.55, s * 0.55, -0.1)
        ctrl = [base, base + Vector((s * 0.15, 0.35, -0.55)), base + Vector((s * 0.38, 0.6, -1.35)),
                base + Vector((s * 0.5, 0.55, -2.1)), base + Vector((s * 0.55, 0.32, -2.65))]
        pts = curve(ctrl, 6)
        radii = [0.115 * (1 - i / len(pts)) ** 0.9 + 0.006 for i in range(len(pts))]
        tube(pts, radii, 14, grad(COL["horn"], COL["bone"], 0.1, 1), [HORN, 0.35, 1], head_w, ridges=0.12)
        base = surf(5.45, s * 1.0, -0.08)
        ctrl = [base, base + Vector((s * 0.25, 0.15, -0.45)), base + Vector((s * 0.42, 0.18, -1.0)), base + Vector((s * 0.5, 0.05, -1.3))]
        pts = curve(ctrl, 5)
        tube(pts, [0.06 * (1 - i / len(pts)) + 0.005 for i in range(len(pts))], 10, grad(COL["horn"], COL["bone"], 0.2, 1), [HORN, 0.35, 1], head_w, ridges=0.08)
        # cheek spikes
        for k, z in enumerate((5.75, 5.95, 6.15)):
            b = surf(z, s * 1.55, -0.02)
            tip = b + Vector((s * 0.22, -0.05 - 0.04 * k, -0.25))
            tube([b, (b + tip) / 2, tip], [0.045, 0.025, 0.005], 6, grad(COL["horn"], COL["bone"]), [HORN, 0.35, 1], head_w)
        # teeth along the upper jaw
        z = 5.95
        while z < 7.35:
            a = mouth_angle(z) - 0.06
            b = surf(z, s * a, -0.02)
            ln = 0.07 + 0.06 * gauss(z - 6.9, 0.15) + 0.03 * (1 if abs(z - 6.45) < 0.05 else 0)
            tube([b, b + Vector((0, -ln, 0.015))], [0.022, 0.003], 5, lambda t: COL["tooth"], [HORN, 0.5, 1], head_w)
            z += 0.13
        # eyes: lens-shaped caps in the sockets, with UVs centred on the pupil
        c = surf(6.38, s * 1.12, -0.04)
        nrm = Vector((s * 0.9, 0.35, 0.25)).normalized()
        side = Vector((0, 0, 1)).cross(nrm).normalized()
        upv = nrm.cross(side).normalized()
        rings, NR, NS = [], 8, 20
        for i in range(NR + 1):
            a = i / NR * 1.25          # cap, not a full sphere
            ring = []
            for j in range(NS if i else 1):
                b = j / NS * TAU
                d = nrm * math.cos(a) + (side * math.cos(b) * 1.35 + upv * math.sin(b) * 0.72) * math.sin(a)
                p = c + d * 0.1
                ring.append((bld.vert(p, [0, 0, 0], 0, [HORN, 0, 1], {"head": 1.0}),
                             (0.5 + 0.5 * math.sin(a) / math.sin(1.25) * math.cos(b), 0.5 + 0.5 * math.sin(a) / math.sin(1.25) * math.sin(b))))
            rings.append(ring)
        for i in range(NR):
            for j in range(NS):
                j2 = (j + 1) % NS
                if i == 0:
                    q = [rings[0][0], rings[1][j], rings[1][j2]]
                else:
                    q = [rings[i][j], rings[i + 1][j], rings[i + 1][j2], rings[i][j2]]
                bld.face([v for v, _ in q], MAT_EYE, [uv for _, uv in q])
    # dorsal spines: thin blades from the back of the skull to the tail fin
    z = 5.0
    while z > -11.6:
        crest = prof_at(z)[2]
        h = 0.12 + crest * 1.25
        b = surf(z, 0.0, -0.03)
        tip = b + Vector((0, h, -h * 0.55))
        wz = body_weights(z)
        tube([b, b + (tip - b) * 0.5 + Vector((0, 0, 0.04)), tip], [0.07 + h * 0.08, 0.04, 0.004], 8,
             grad(COL["top"], COL["bone"], 0.2, 1), [HORN, 0.7, 1], lambda p, t, wz=wz: wz, glowfn=lambda t: t * t * 0.45, flat=0.35)
        z -= 0.32 if z > 3.6 else 0.48


def build_legs():
    for s, sfx in ((1, ".L"), (-1, ".R")):
        H, K, A, toes = leg_points(s)
        names = ["thigh" + sfx, "shin" + sfx]
        wf = lambda p, t: nearest_weights(p, names, 0.3, 2)
        pts = curve([H + Vector((0, 0.15, 0)), K, A], 5)
        radii = [0.34 - 0.24 * (i / (len(pts) - 1)) + 0.08 * gauss(i / (len(pts) - 1) - 0.45, 0.15) for i in range(len(pts))]
        tube(pts, radii, 12, lambda t: COL["leg"], [SCALES, 0.3, 0.55], wf)
        for tp in toes:
            tube(curve([A, (A + tp) / 2 + Vector((0, -0.05, 0)), tp], 3), [0.07, 0.06, 0.05, 0.035, 0.025, 0.02, 0.008],
                 6, grad(COL["leg"], COL["claw"], 0.55, 0.7), [SCALES, 0.3, 0.35], lambda p, t, sfx=sfx: {"shin" + sfx: 1.0})


def build_wings():
    for s, sfx in ((1, ".L"), (-1, ".R")):
        w = wing_points(s)
        S, E, W, F, Fm, B = w["S"], w["E"], w["W"], w["F"], w["Fm"], w["B"]
        arm = ["upperarm" + sfx, "forearm" + sfx]
        fing = [["finger%d%s" % (i, sfx), "finger%dtip%s" % (i, sfx)] for i in range(4)]
        allw = arm + sum(fing, []) + ["chest", "hips"]
        wfn = lambda p, t, names=allw: nearest_weights(p, names, 0.25, 3)
        # arm bones along the leading edge, then each finger
        pts = curve([S, E, W], 6)
        tube(pts, [0.2 - 0.11 * i / (len(pts) - 1) + 0.05 * gauss(i / (len(pts) - 1) - 0.5, 0.08) for i in range(len(pts))], 10, grad(COL["top"], COL["arm"], 0.1, 1),
             [SCALES, 0.25, 0.55], lambda p, t, n=arm: nearest_weights(p, n, 0.2, 2))
        for i in range(4):
            pts = curve([W, Fm[i], F[i]], 5)
            tube(pts, [0.09 - 0.075 * k / (len(pts) - 1) for k in range(len(pts))], 7,
                 grad(COL["arm"], COL["bone"] if i == 0 else COL["wingIn"], 0.6, 1), [SCALES, 0.4, 0.4],
                 lambda p, t, n=fing[i] + arm[1:]: nearest_weights(p, n, 0.15, 2))
        # thumb claw at the wrist
        tube([W, W + Vector((s * 0.05, 0.2, 0.35))], [0.06, 0.005], 6, lambda t: COL["claw"], [HORN, 0.35, 1],
             lambda p, t: {"forearm" + sfx: 1.0})

        def ray(i, u):
            # along finger i from the wrist, following its bow
            return curve([W, Fm[i], F[i]], 16)[round(u * 32)]

        def mem_vert(p, u_span, v, uv):
            tEdge = smooth(0.84, 0.99, v)
            c = mix3(COL["wingIn"], COL["wingMid"], smooth(0.0, 0.6, v) * (0.5 + u_span * 0.5))
            c = mix3(c, COL["wingEdge"], tEdge * 0.75)
            thick = smooth(0.35, 0, v)
            return bld.vert(p, c, 0.35, [MEMBRANE, 0.25 + 0.75 * (1 - thick) * (0.7 + 0.3 * v), v], wfn(p, 0)), uv

        grids = []
        # outer panels between neighbouring fingers, with scalloped trailing edges
        NU, NV = 33, 14
        for i in range(3):
            g = []
            for a in range(NU):
                u = a / (NU - 1)
                pa, pb = ray(i, u), ray(i + 1, u)
                row = []
                for b in range(NV):
                    v = b / (NV - 1)
                    p = pa.lerp(pb, v)
                    p = p.lerp(W, 0.16 * math.sin(math.pi * v) * u ** 3)        # scallop
                    p += Vector((0, -0.18 * math.sin(math.pi * v) * u, 0))        # billow under load
                    span = 0.4 + (i + u) / 3 * 0.6
                    row.append(mem_vert(p, span, v, ((i + u) * 5, 1 - v * 5)))
                g.append(row)
            grids.append(g)
        # inner panel: a Coons patch between the arm, finger 3, the trailing edge and the body
        NU2, NV2 = 26, 22
        lead = curve([S, E, W], 20)
        trail_end = F[3]
        g = []
        for a in range(NU2):
            sP = a / (NU2 - 1)                         # 0 at the body, 1 at finger 3
            Cl = lead[round(sP * (len(lead) - 1))]
            Ct = B.lerp(trail_end, sP)
            Ct = Ct.lerp((S + W) / 2, 0.14 * math.sin(math.pi * sP))     # scallop
            row = []
            for b in range(NV2):
                t = b / (NV2 - 1)                      # 0 leading edge, 1 trailing edge
                Dr, Do = S.lerp(B, t), ray(3, t)
                p = (Cl * (1 - t) + Ct * t + Dr * (1 - sP) + Do * sP
                     - (S * (1 - sP) * (1 - t) + W * sP * (1 - t) + B * (1 - sP) * t + trail_end * sP * t))
                p += Vector((0, -0.25 * math.sin(math.pi * t) * math.sin(math.pi * sP), 0))
                row.append(mem_vert(p, sP * 0.4, t, (sP * 6, 1 - t * 5)))
            g.append(row)
        grids.append(g)
        for g in grids:
            for a in range(len(g) - 1):
                for b in range(len(g[0]) - 1):
                    q = [g[a][b], g[a + 1][b], g[a + 1][b + 1], g[a][b + 1]]
                    # keep the top face pointing up on both wings
                    if s < 0:
                        q = q[::-1]
                    bld.face([v for v, _ in q], MAT_MEMBRANE, [uv for _, uv in q])
    log("wings built")


# ---- scene ----------------------------------------------------------------------------------------
def to_bl(p):
    return Vector((p.x, -p.z, p.y))


def make_materials():
    def mat(name, rough, coat, emit=None, trans=0.0):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        bsdf = nt.nodes["Principled BSDF"]
        attr = nt.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = "Col"
        nt.links.new(attr.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = rough
        bsdf.inputs["Coat Weight"].default_value = coat
        if trans:
            bsdf.inputs["Subsurface Weight"].default_value = trans
        if emit:
            bsdf.inputs["Emission Color"].default_value = (*emit, 1)
            bsdf.inputs["Emission Strength"].default_value = 3.0
        return m
    skin = mat("skin", 0.46, 0.35, trans=0.15)
    mem = mat("membrane", 0.68, 0.12, trans=0.4)
    mem.use_backface_culling = False
    eye = mat("eye", 0.15, 0.6, emit=(1.0, 0.45, 0.05))
    return [skin, mem, eye]


def build_mesh(mats):
    me = bpy.data.meshes.new("Dragon")
    me.from_pydata([to_bl(v) for v in bld.v], [], bld.f)
    for m in mats:
        me.materials.append(m)
    for poly, mi in zip(me.polygons, bld.mat):
        poly.material_index = mi
        poly.use_smooth = True
    uvl = me.uv_layers.new(name="UVMap")
    for poly, uvs in zip(me.polygons, bld.uv):
        for li, uv in zip(poly.loop_indices, uvs):
            uvl.data[li].uv = uv
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", [c for col in bld.col for c in (*col, 1.0)])
    g = me.attributes.new("_glow", "FLOAT", "POINT")
    g.data.foreach_set("value", bld.glow)
    sk = me.attributes.new("_skin", "FLOAT_VECTOR", "POINT")
    sk.data.foreach_set("vector", [c for s in bld.skin for c in s])
    me.color_attributes.active_color = ca
    me.validate()
    ob = bpy.data.objects.new("Dragon", me)
    bpy.context.scene.collection.objects.link(ob)
    log("mesh: %d verts, %d faces" % (len(me.vertices), len(me.polygons)))
    # every closed part should face outward: normals pointing away from the spine,
    # and the wings' top faces pointing up
    out = inward = up = down = 0
    for poly, mi in zip(me.polygons, bld.mat):
        c = poly.center
        if mi == MAT_MEMBRANE:
            if poly.normal.z > 0: up += 1
            else: down += 1
        elif mi == MAT_SKIN:
            axis = Vector((0, c.y, spine_y(-c.y)))
            if poly.normal.dot(c - axis) >= 0: out += 1
            else: inward += 1
    log("winding: skin %d out / %d in, membrane %d up / %d down" % (out, inward, up, down))
    return ob


def build_armature():
    arm = bpy.data.armatures.new("DragonRig")
    rig = bpy.data.objects.new("DragonRig", arm)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode="EDIT")
    for name, h, t, parent in BONES:
        b = arm.edit_bones.new(name)
        b.head, b.tail = to_bl(h), to_bl(t)
        b.align_roll(Vector((0, 0, 1)) if abs((t - h).normalized().y) < 0.9 else Vector((0, -1, 0)))
        if parent:
            b.parent = arm.edit_bones[parent]
    bpy.ops.object.mode_set(mode="OBJECT")
    return rig


def skin_mesh(ob, rig):
    for name, *_ in BONES:
        ob.vertex_groups.new(name=name)
    for vi, ws in enumerate(bld.w):
        for name, w in ws.items():
            if w > 0.001:
                ob.vertex_groups[name].add([vi], w, "REPLACE")
    ob.parent = rig
    mod = ob.modifiers.new("Armature", "ARMATURE")
    mod.object = rig


# ---- animation ----------------------------------------------------------------------------------
FPS = 24


def set_rel(rig, name, R):
    """Pose a bone by a rotation given in the rig's rest axes, relative to its parent."""
    pb = rig.pose.bones[name]
    B = rig.data.bones[name].matrix_local.to_quaternion()
    pb.rotation_mode = "QUATERNION"
    pb.rotation_quaternion = B.inverted() @ R @ B


def rot(axis, ang):
    return Quaternion(Vector(axis).normalized(), ang)


def wing_pose(rig, s, sfx, phi1, phi2, fold, aoa):
    # in Blender axes: forward is -Y, up is +Z, left is +X
    flap = rot((0, -s, 0), phi1 - 0.08)
    pitch = rot((-1, 0, 0), aoa)
    set_rel(rig, "upperarm" + sfx, flap @ pitch)
    set_rel(rig, "forearm" + sfx, rot((0, 0, s), fold * 0.55))
    lag = rot((0, -s, 0), (phi2 - phi1) + 0.06)
    for i in range(4):
        sweep = rot((0, 0, s), fold * 0.9 * (0.6 + 0.2 * i) - fold * 0.35)
        set_rel(rig, "finger%d%s" % (i, sfx), lag @ sweep)
        # fingers curl down on the downstroke as the membrane loads up
        set_rel(rig, "finger%dtip%s" % (i, sfx), rot((0, -s, 0), -0.12 * max(0.0, phi1 - phi2)))


def key_all(rig, frame):
    for pb in rig.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.keyframe_insert("rotation_quaternion", frame=frame)


def clear_pose(rig):
    for pb in rig.pose.bones:
        pb.rotation_quaternion = Quaternion()


def make_action(rig, name, frames, posefn):
    ad = rig.animation_data or rig.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    for f in frames:
        clear_pose(rig)
        posefn(f)
        key_all(rig, f)
    log("action %s: %d keys" % (name, len(frames)))
    return act


def build_actions(rig):
    acts = {}
    # glide: wings held out, drifting gently on the air (one 7 s loop)
    G = 168
    def glide(f):
        for s, sfx in ((1, ".L"), (-1, ".R")):
            phi1 = 0.08 + math.sin(TAU * (f - 1) / G + s) * 0.03
            wing_pose(rig, s, sfx, phi1, phi1 - 0.06, 0.0, 0.0)
    acts["glide"] = make_action(rig, "glide", range(1, G + 2, 6), glide)

    # flap: one wingbeat over 24 frames; frame 1 = wings at the top
    N = 24
    def flap(f):
        ph = (f - 1) / N * TAU
        phi1 = 0.18 + 0.8 * math.cos(ph)
        phi2 = phi1 + 0.4 * math.cos(ph - 1.0)
        fold = max(0.0, -math.sin(ph)) * 0.75
        aoa = 0.25 * math.sin(ph)
        for s, sfx in ((1, ".L"), (-1, ".R")):
            wing_pose(rig, s, sfx, phi1, phi2, fold, aoa)
    acts["flap"] = make_action(rig, "flap", range(1, N + 2), flap)

    # brake: wings flared up and pitched into the wind, legs reaching forward
    def brake(f):
        for s, sfx in ((1, ".L"), (-1, ".R")):
            wing_pose(rig, s, sfx, 0.43, 0.37, 0.2, 0.55)
            set_rel(rig, "thigh" + sfx, rot((1, 0, 0), -0.9))
            set_rel(rig, "shin" + sfx, rot((1, 0, 0), 0.7))
    acts["brake"] = make_action(rig, "brake", (1, 2), brake)
    rig.animation_data.action = None
    clear_pose(rig)
    return acts


# ---- preview renders --------------------------------------------------------------------------------
def render_previews(rig, acts):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 40
    sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1280, 720
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("Sky")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.45, 0.6, 0.85, 1)
    bg.inputs["Strength"].default_value = 0.6
    sc.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.5
    sun.data.color = (1.0, 0.9, 0.78)
    sun.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.lens = 45
    sc.collection.objects.link(cam)
    sc.camera = cam
    out_dir = os.path.join(ROOT, "tools", "blender", "renders")
    os.makedirs(out_dir, exist_ok=True)
    shots = [
        ("glide_front34", "glide", 1, (14, -18, 9), (0, -1, 0.5)),
        ("flap_down", "flap", 7, (-16, -10, 5), (0, -1, 0.5)),
        ("flap_up_top", "flap", 19, (0, 6, 26), (0, -1, 0)),
        ("head_closeup", "glide", 1, (3.2, -10.5, 1.6), (0, -6.5, 0.8)),
    ]
    for name, act, frame, loc, target in shots:
        rig.animation_data.action = acts[act]
        sc.frame_set(frame)
        cam.location = loc
        d = Vector(target) - Vector(loc)
        cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
        if name == "head_closeup":
            cam.data.lens = 70
        sc.render.filepath = os.path.join(out_dir, name + ".png")
        bpy.ops.render.render(write_still=True)
        log("rendered", sc.render.filepath)
    rig.animation_data.action = None


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = FPS
    build_body()
    build_head_details()
    build_legs()
    build_wings()
    mats = make_materials()
    ob = build_mesh(mats)
    rig = build_armature()
    skin_mesh(ob, rig)
    acts = build_actions(rig)
    out = os.path.join(ROOT, "models", "dragon.glb")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_apply=False,
        export_attributes=True, export_vertex_color="ACTIVE", export_skins=True,
        export_animations=True, export_animation_mode="ACTIONS", export_force_sampling=True,
        export_lights=False, export_cameras=False, export_materials="EXPORT",
    )
    log("exported", out, os.path.getsize(out) // 1024, "KB")
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(ROOT, "tools", "blender", "dragon.blend"))
    if RENDER:
        render_previews(rig, acts)


try:
    main()
    log("== DONE")
except Exception:
    log(traceback.format_exc())
    log("== FAILED")
finally:
    LOG.close()
