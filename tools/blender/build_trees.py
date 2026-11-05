# Builds Highwake's tree kit in Blender:
#   tex/leaves.png      a 2x2 atlas of leaf clusters rendered from modelled leaves
#                       (0 broadleaf, 1 conifer spray, 2 weeping frond, 3 bark patch)
#   tex/undergrowth.png a 2x2 atlas for ground cover (0 grass tuft, 1 fern, 2 flowers, 3 bush)
#   models/trees.glb    two species x two variants, each as
#                       <name>_bark   (near: bark tubes, tiling bark texture)
#                       <name>_leaves (near: leaf-cluster cards on the leaves atlas)
#                       <name>_lo     (far: a few cards + a stub trunk, all on the atlas)
#
# Every mesh carries colour (crown shading baked in), _glow and _nrm (game-space normals:
# leaf cards point away from the crown centre, so the crown shades as one soft mass).
# Sizes match the old code-built trees: canopy ~48 m tall, ~34 m across; spire ~54 m.
#
# Run: powershell -NoProfile -File tools/blender/run.ps1 tools/blender/build_trees.py [--render]
# Game space is +y up; Blender gets (x, -z, y), which the glTF exporter turns back.

import bpy, math, sys, os, random, traceback
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = argv[0] if argv else os.getcwd()
LOG = open(argv[1] if len(argv) > 1 else os.path.join(ROOT, "tools", "blender", "last.log"), "w", encoding="utf-8")
RENDER = "--render" in argv
TAU = math.pi * 2
UP = Vector((0, 1, 0))


def log(*a):
    print(*a, file=LOG, flush=True)


def clamp(x, a=0.0, b=1.0):
    return min(b, max(a, x))


# ---------------------------------------------------------------------------------
# Leaf atlas: modelled leaves laid out in a 2x2 grid, rendered top-down.
# Render space: x, y in [-1, 1]; cell (cx, cy), cy = 0 the top row, spans
# x in [cx - 1, cx], y in [-cy, 1 - cy]. Each cluster hangs from the bottom centre
# of its cell, which is where the game's cards attach to their branch.

def cell_origin(c):
    cx, cy = c % 2, c // 2
    return Vector((cx - 0.5, -cy + 0.04, 0))   # bottom centre (a little inset)


class RMesh:
    def __init__(self):
        self.v, self.f, self.c = [], [], []

    def vert(self, p, col):
        self.v.append(Vector(p)); self.c.append(col)
        return len(self.v) - 1


def leaf(m, base, d, length, width, col, droop=0.0, cup=0.02, n=6, shape=0.8):
    """A blade from base along d (2D direction in the render plane)."""
    d = Vector((d.x, d.y, 0)).normalized()
    side = Vector((-d.y, d.x, 0))
    rows = []
    for i in range(n + 1):
        t = i / n
        w = width * math.sin(math.pi * min(1.0, t ** shape)) * (1 - 0.15 * t)
        c = base + d * (length * t) + Vector((0, 0, cup * 3 - droop * t * t))
        tip = [1.0 + 0.35 * t, 1.0 + 0.4 * t, 1.0 + 0.1 * t]
        cc = tuple(col[k] * tip[k] for k in range(3))
        if i == n:
            rows.append([m.vert(c, cc)])
        else:
            rows.append([m.vert(c - side * w + Vector((0, 0, -cup)), tuple(x * 0.82 for x in cc)), m.vert(c, cc), m.vert(c + side * w + Vector((0, 0, -cup)), tuple(x * 0.82 for x in cc))])
    for a, b in zip(rows, rows[1:]):
        if len(b) == 1:
            m.f += [[a[0], a[1], b[0]], [a[1], a[2], b[0]]]
        else:
            m.f += [[a[0], a[1], b[1], b[0]], [a[1], a[2], b[2], b[1]]]


def twig(m, pts, r, col):
    """A thin stem in the render plane, as a flat ribbon."""
    for a, b in zip(pts, pts[1:]):
        d = (b - a).normalized()
        s = Vector((-d.y, d.x, 0)) * r
        i = [m.vert(a - s, col), m.vert(a + s, col), m.vert(b + s, col), m.vert(b - s, col)]
        m.f.append(i)


def jitter_col(rnd, base, amt=0.18):
    k = 1 + (rnd.random() - 0.5) * amt * 2
    h = (rnd.random() - 0.5) * amt
    return (base[0] * k * (1 + h), base[1] * k, base[2] * k * (1 - h))


def cluster_broadleaf(m, rnd, c=0):
    o = cell_origin(c)
    stem = (0.03, 0.025, 0.015)
    greens = [(0.07, 0.17, 0.035), (0.09, 0.2, 0.04), (0.11, 0.21, 0.035), (0.06, 0.15, 0.045)]
    # a fan of twigs from the attach point, leaves alternating along each
    for k in range(9):
        a = math.radians(90 + (k - 4) * 16 + rnd.uniform(-6, 6))
        L = 0.62 + rnd.uniform(-0.12, 0.1) - abs(k - 4) * 0.035
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [o + d * (L * t) + Vector((math.sin(t * 3 + k) * 0.03, 0, 0)) for t in (0, 0.33, 0.66, 1.0)]
        twig(m, pts, 0.006, stem)
        nl = 9
        for i in range(nl):
            t = 0.22 + 0.78 * i / (nl - 1)
            p = o + d * (L * t)
            side = 1 if i % 2 else -1
            la = a + side * math.radians(rnd.uniform(35, 60))
            ld = Vector((math.cos(la), math.sin(la), 0))
            sz = 0.12 + 0.05 * rnd.random()
            leaf(m, p, ld, sz, sz * 0.36, jitter_col(rnd, rnd.choice(greens)))
        leaf(m, o + d * L, d, 0.13, 0.05, jitter_col(rnd, greens[2]))


def cluster_conifer(m, rnd, c=1):
    o = cell_origin(c)
    stem = (0.04, 0.03, 0.02)
    cols = [(0.03, 0.09, 0.06), (0.04, 0.11, 0.07), (0.05, 0.12, 0.06)]
    def spray(base, d, L, depth):
        pts = [base + d * (L * t) for t in (0, 0.5, 1.0)]
        twig(m, pts, 0.008 if depth == 0 else 0.005, stem)
        n = int(L * 70)
        side = Vector((-d.y, d.x, 0))
        for i in range(n):
            t = 0.08 + 0.92 * i / n
            p = base + d * (L * t)
            for sgn in (-1, 1):
                for q in range(2):
                    nd = (d * (0.45 + 0.35 * q) + side * sgn).normalized()
                    nl = 0.085 * (1 - 0.5 * t) + 0.025
                    leaf(m, p + Vector((0, 0, 0.004 * q)), nd, nl, 0.009, jitter_col(rnd, rnd.choice(cols), 0.25), n=2, shape=0.5)
        if depth == 0:
            for i in range(7):
                t = 0.12 + i * 0.12
                for sgn in (-1, 1):
                    a2 = math.atan2(d.y, d.x) + sgn * math.radians(52)
                    spray(base + d * (L * t), Vector((math.cos(a2), math.sin(a2), 0)), L * (0.5 - i * 0.055), 1)
    spray(o, Vector((0, 1, 0)), 0.86, 0)


def cluster_weeper(m, rnd, c=2):
    # long fronds that arc up and out from the attach point and fall back down,
    # hung with narrow leaves: willow-like, teal for the glowing islands
    o = cell_origin(c)
    stem = (0.04, 0.05, 0.03)
    cols = [(0.04, 0.14, 0.1), (0.05, 0.17, 0.11), (0.06, 0.16, 0.08)]
    for k in range(7):
        a = math.radians(90 + (k - 3) * 22)
        pts = []
        for i in range(10):
            t = i / 9
            pts.append(o + Vector((math.cos(a) * 0.45 * t, math.sin(a) * 0.85 * math.sin(t * 2.4) * (1 - 0.15 * abs(k - 3)), 0)))
        twig(m, pts, 0.005, stem)
        for i in range(2, 10):
            p = pts[i]
            for sgn in (-1, 1):
                d = (pts[i] - pts[i - 1]).normalized()
                ld = (d + Vector((-d.y, d.x, 0)) * sgn * 0.5 + Vector((0, -0.5, 0))).normalized()
                leaf(m, p, ld, 0.1 + 0.03 * rnd.random(), 0.018, jitter_col(rnd, rnd.choice(cols)))


# --- undergrowth clusters (tex/undergrowth.png) -----------------------------------

def blade(m, base, a, L, w, col, bend, rnd):
    """A grass blade rising from base at angle a (radians from +x), arching over."""
    pts = []
    for i in range(6):
        t = i / 5
        ang = a - bend * t * t * (1 if math.cos(a) >= 0 else -1)
        pts.append(base + Vector((math.cos(a) * L * t * 0.6 + math.cos(ang) * L * t * 0.4, math.sin(a) * L * t * 0.75 + math.sin(ang) * L * t * 0.25, 0)))
    rows = []
    for i, p in enumerate(pts):
        t = i / 5
        d = (pts[min(i + 1, 5)] - pts[max(i - 1, 0)]).normalized()
        s = Vector((-d.y, d.x, 0)) * w * (1 - t) ** 0.7
        tip = (1 + 0.6 * t, 1 + 0.45 * t, 1 + 0.1 * t)
        c = tuple(col[k] * tip[k] for k in range(3))
        rows.append((m.vert(p - s, tuple(x * 0.8 for x in c)), m.vert(p + s, c)))
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        m.f.append([a0, a1, b1, b0])


def cluster_grass(m, rnd, c):
    o = cell_origin(c)
    cols = [(0.13, 0.24, 0.05), (0.17, 0.27, 0.06), (0.11, 0.2, 0.06), (0.22, 0.27, 0.08)]
    for k in range(70):
        a = math.radians(90 + rnd.gauss(0, 26))
        base = o + Vector((rnd.uniform(-0.08, 0.08), 0, rnd.uniform(0, 0.01)))
        blade(m, base, a, rnd.uniform(0.45, 0.9), rnd.uniform(0.016, 0.026), jitter_col(rnd, rnd.choice(cols)), rnd.uniform(0.2, 0.9), rnd)


def cluster_fern(m, rnd, c):
    o = cell_origin(c)
    stem = (0.06, 0.08, 0.03)
    cols = [(0.06, 0.17, 0.05), (0.08, 0.2, 0.05), (0.05, 0.15, 0.06)]
    for k in range(7):
        a = math.radians(90 + (k - 3) * 21 + rnd.uniform(-5, 5))
        L = 0.85 - abs(k - 3) * 0.08
        pts = []
        for i in range(12):
            t = i / 11
            ang = a - 0.9 * t * t * (1 if k >= 3 else -1) * (abs(k - 3) / 3 + 0.25)
            pts.append(o + Vector((math.cos(ang) * L * t, math.sin(ang) * L * t, 0)))
        twig(m, pts, 0.006, stem)
        col = rnd.choice(cols)
        for i in range(1, 11):
            t = i / 11
            d = (pts[i + 1] - pts[i - 1]).normalized()
            side = Vector((-d.y, d.x, 0))
            pl = 0.13 * math.sin(math.pi * min(1, t * 1.15)) + 0.02
            for sgn in (-1, 1):
                leaf(m, pts[i], (side * sgn + d * 0.35).normalized(), pl, pl * 0.28, jitter_col(rnd, col, 0.12), n=4)


def cluster_flowers(m, rnd, c):
    o = cell_origin(c)
    gcols = [(0.12, 0.23, 0.05), (0.15, 0.25, 0.06)]
    for k in range(40):
        a = math.radians(90 + rnd.gauss(0, 30))
        blade(m, o + Vector((rnd.uniform(-0.08, 0.08), 0, 0)), a, rnd.uniform(0.3, 0.6), 0.014, jitter_col(rnd, rnd.choice(gcols)), rnd.uniform(0.3, 0.9), rnd)
    petals = [(0.9, 0.88, 0.8), (0.95, 0.75, 0.15), (0.85, 0.35, 0.55), (0.55, 0.45, 0.9), (0.95, 0.55, 0.25)]
    for k in range(16):
        a = math.radians(90 + rnd.gauss(0, 24))
        L = rnd.uniform(0.45, 0.85)
        tip = o + Vector((math.cos(a) * L, math.sin(a) * L, 0.02))
        twig(m, [o + Vector((rnd.uniform(-0.05, 0.05), 0, 0)), tip], 0.005, (0.08, 0.15, 0.04))
        pc = jitter_col(rnd, rnd.choice(petals), 0.08)
        r = rnd.uniform(0.035, 0.06)
        for p in range(6):
            pa = p * TAU / 6 + rnd.uniform(-0.1, 0.1)
            leaf(m, tip, Vector((math.cos(pa), math.sin(pa), 0)), r, r * 0.55, pc, n=3, cup=0.01)
        leaf(m, tip + Vector((-0.012, 0, 0.012)), Vector((1, 0, 0)), 0.024, 0.014, (0.9, 0.7, 0.1), n=2)


def cluster_bush(m, rnd, c):
    o = cell_origin(c)
    stem = (0.04, 0.03, 0.02)
    greens = [(0.06, 0.15, 0.04), (0.08, 0.18, 0.04), (0.1, 0.17, 0.03), (0.05, 0.13, 0.05)]
    for k in range(13):
        a = math.radians(90 + (k - 6) * 13 + rnd.uniform(-5, 5))
        L = 0.62 - abs(k - 6) * 0.03 + rnd.uniform(-0.06, 0.04)
        d = Vector((math.cos(a), math.sin(a), 0))
        twig(m, [o + d * (L * t) for t in (0, 0.5, 1.0)], 0.005, stem)
        for i in range(12):
            t = 0.15 + 0.85 * i / 11
            la = a + (1 if i % 2 else -1) * math.radians(rnd.uniform(30, 65))
            sz = 0.07 + 0.03 * rnd.random()
            leaf(m, o + d * (L * t), Vector((math.cos(la), math.sin(la), 0)), sz, sz * 0.5, jitter_col(rnd, rnd.choice(greens)))


def fit_cell(m, start, c, margin=0.03):
    """Scale the verts added since start about the cell's attach point so they fit the cell."""
    o = cell_origin(c)
    cx, cy = c % 2, c // 2
    x0, x1, y0, y1 = cx - 1 + margin, cx - margin, -cy + margin * 0.5, 1 - cy - margin
    k = 1.0
    for v in m.v[start:]:
        dx, dy = v.x - o.x, v.y - o.y
        if dx > 1e-6: k = min(k, (x1 - o.x) / dx)
        if dx < -1e-6: k = min(k, (x0 - o.x) / dx)
        if dy > 1e-6: k = min(k, (y1 - o.y) / dy)
        if dy < -1e-6: k = min(k, (y0 - o.y) / dy)
    for v in m.v[start:]:
        v.x = o.x + (v.x - o.x) * k; v.y = o.y + (v.y - o.y) * k
    log("cell %d fit scale %.2f" % (c, k))


def build_atlas(fns, name, bark=False, seed=7):
    """Render up to four clusters into tex/<name>.png; bark=True puts the bark patch in cell 3."""
    rnd = random.Random(seed)
    m = RMesh()
    for c, fn in enumerate(fns):
        n0 = len(m.v)
        fn(m, rnd, c)
        fit_cell(m, n0, c)
    me = bpy.data.meshes.new("leafatlas")
    me.from_pydata([tuple(v) for v in m.v], [], m.f)
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", [x for c in m.c for x in (*c, 1.0)])
    ob = bpy.data.objects.new("leafatlas", me)
    bpy.context.scene.collection.objects.link(ob)
    mat = bpy.data.materials.new("leafmat")
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.7
    me.materials.append(mat)
    log("leaf atlas: %d verts, %d faces" % (len(m.v), len(m.f)))

    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 24
    sc.cycles.use_denoising = False
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = 1024
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGBA"
    sc.view_settings.view_transform = "Standard"
    world = bpy.data.worlds.new("W"); world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (1, 1, 1, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.9
    sc.world = world
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 2.2
    sun.rotation_euler = (math.radians(25), math.radians(-20), 0)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam"))
    cam.data.type = "ORTHO"; cam.data.ortho_scale = 2.0
    cam.location = (0, 0, 5)
    sc.collection.objects.link(cam); sc.camera = cam
    path = os.path.join(ROOT, "tools", "blender", "renders", name + "_raw.png")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sc.render.filepath = path
    bpy.ops.render.render(write_still=True)

    # finish in numpy: bark patch into cell 3, then bleed leaf colour into the
    # transparent texels so mipmaps don't get dark fringes
    import numpy as np
    img = bpy.data.images.load(path)
    W = img.size[0]
    px = np.array(img.pixels[:], dtype=np.float32).reshape(W, W, 4)  # rows bottom-up
    bark_img = bpy.data.images.load(os.path.join(ROOT, "tex", "bark_c.jpg"))
    bw, bh = bark_img.size
    bp = np.array(bark_img.pixels[:], dtype=np.float32).reshape(bh, bw, 4)
    H = W // 2
    ys = (np.arange(H) * bh // H); xs = (np.arange(H) * bw // H)
    # cell 3: bottom-right (rows 0..H in bottom-up order, columns H..W)
    if bark:
        px[0:H, H:W, :3] = bp[ys][:, xs, :3]
        px[0:H, H:W, 3] = 1.0
    for cx, cy in ((0, 0), (1, 0), (0, 1), (1, 1))[:len(fns)]:
        r0 = (1 - cy) * H
        cell = px[r0:r0 + H, cx * H:(cx + 1) * H]
        # thin blades and needles are antialiased below the game's 50% alpha cut:
        # thicken the coverage so they survive (and survive mipmapping)
        a = np.clip(cell[..., 3] * 1.7, 0, 1)
        solid = a > 0.5
        mean = cell[..., :3][solid].mean(axis=0) if solid.any() else np.array([0.1, 0.2, 0.05])
        # Blender writes straight alpha; fill the empty texels with a blurred bleed
        rgb = cell[..., :3].copy()
        rgb[~solid] = 0
        acc = rgb.copy(); wsum = solid.astype(np.float32)
        cur, cw = acc, wsum
        for _ in range(6):
            pad = np.pad(cur * cw[..., None], ((1, 1), (1, 1), (0, 0)), mode="edge"); pw = np.pad(cw, 1, mode="edge")
            s = sum(pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + H] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
            sw = sum(pw[1 + dy:1 + dy + H, 1 + dx:1 + dx + H] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
            cur = np.where(sw[..., None] > 0, s / np.maximum(sw[..., None], 1e-6), mean)
            cw = (sw > 0).astype(np.float32)
        out_rgb = np.where(solid[..., None], rgb, cur)
        cell[..., :3] = np.clip(out_rgb, 0, 1)
        cell[..., 3] = np.where(a > 0.5, 1.0, a)
        px[r0:r0 + H, cx * H:(cx + 1) * H] = cell
        log("cell", cx, cy, "coverage %.2f mean %s" % (solid.mean(), np.round(mean, 3)))
    out = bpy.data.images.new(name, W, W, alpha=True)
    out.pixels.foreach_set(px.ravel())
    out.filepath_raw = os.path.join(ROOT, "tex", name + ".png")
    out.file_format = "PNG"
    out.save()
    log("wrote", out.filepath_raw)
    bpy.data.objects.remove(ob); bpy.data.objects.remove(sun); bpy.data.objects.remove(cam)


def uv_in_cell(c, u, v):
    cx, cy = c % 2, c // 2
    u = clamp(u, 0.004, 0.996); v = clamp(v, 0.004, 0.996)
    vb = 0.5 if cy == 0 else 0.0   # bottom of the cell in Blender v (v up): top row 0.5, bottom row 0
    return ((cx + u) * 0.5, vb + v * 0.5)


# ---------------------------------------------------------------------------------
# Trees (game space, metres)

class Mesh:
    def __init__(self, name):
        self.name = name
        self.v, self.f = [], []
        self.col, self.glow, self.nrm, self.uv = [], [], [], []

    def vert(self, p, n, uv, col=(1, 1, 1), glow=0.0):
        self.v.append(Vector(p)); self.nrm.append(Vector(n).normalized()); self.uv.append(uv)
        self.col.append(col); self.glow.append(glow)
        return len(self.v) - 1

    def tri_count(self):
        return sum(len(f) - 2 for f in self.f)


def frames_along(pts):
    """Parallel-transport frames along a polyline."""
    T = [(pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized() for i in range(len(pts))]
    a = Vector((1, 0, 0)) if abs(T[0].x) < 0.9 else Vector((0, 0, 1))
    N = [T[0].cross(a).normalized()]
    for i in range(1, len(pts)):
        n = N[-1] - T[i] * N[-1].dot(T[i])
        N.append(n.normalized() if n.length > 1e-6 else N[-1])
    return T, N


def tube(m, pts, radii, sides, col=(1, 1, 1), tile=3.2, cell=None, shade=None):
    """Bark tube. cell=None: tiling bark uv; cell=3: inside the atlas bark patch."""
    T, N = frames_along(pts)
    circ = TAU * max(radii[0], 0.2)
    urep = max(1, round(circ / tile)) if cell is None else 1
    acc, rings = 0.0, []
    for i, p in enumerate(pts):
        if i: acc += (pts[i] - pts[i - 1]).length
        B = T[i].cross(N[i])
        ring = []
        for j in range(sides + 1):
            a = TAU * j / sides
            d = N[i] * math.cos(a) + B * math.sin(a)
            u = j / sides
            if cell is None:
                uv = (u * urep, acc / tile)
            else:
                uv = uv_in_cell(cell, u, (acc / max(1.0, sum((pts[k] - pts[k - 1]).length for k in range(1, len(pts))))))
            c = col if shade is None else shade(p, col)
            ring.append(m.vert(p + d * radii[i], d, uv, c))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for j in range(sides):
            q = [a[j], a[j + 1], b[j + 1], b[j]]
            P = [m.v[k] for k in q]
            n = (P[1] - P[0]).cross(P[3] - P[0])
            if n.dot(m.nrm[a[j]]) < 0:
                q = q[::-1]
            m.f.append(q)


def card(m, attach, up, out, w, h, cell, crown, ao_fn, glow=0.0, bend=0.25, nmix=0.75):
    """A leaf-cluster card hanging from attach, extending along up, facing out.
    Two rows, bent slightly back toward the branch so it reads as a cupped clump."""
    up = up.normalized()
    right = up.cross(out).normalized()
    nrm = right.cross(up).normalized()
    if nrm.dot(out) < 0:
        nrm = -nrm
    rows = []
    for k, t in enumerate((0.0, 0.55, 1.0)):
        c = attach + up * (h * t) - nrm * (bend * h * t * t)
        row = []
        for s in (-1, 1):
            p = c + right * (w * 0.5 * s * (0.85 + 0.15 * t))
            radial = (p - crown).normalized() if (p - crown).length > 1e-3 else nrm
            n = (nrm * (1 - nmix) + radial * nmix).normalized()
            row.append(m.vert(p, n, uv_in_cell(cell, 0.5 + 0.5 * s * 0.98, t * 0.96), ao_fn(p), glow))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        m.f.append([a[0], a[1], b[1], b[0]])


def grow(start, d, length, segs, rnd, up_pull=0.0, droop=0.0, wobble=0.08):
    pts = [start.copy()]
    d = d.normalized()
    for i in range(segs):
        d = (d + Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * wobble + UP * up_pull - UP * droop * (i + 1) / segs).normalized()
        pts.append(pts[-1] + d * (length / segs))
    return pts


def ao_crown(center, rx, ry, base=0.55):
    def f(p):
        q = p - center
        r = math.sqrt((q.x / rx) ** 2 + (q.y / ry) ** 2 + (q.z / rx) ** 2)
        k = clamp(base + (1 - base) * clamp(r, 0, 1.1) ** 1.5)
        k *= 0.8 + 0.2 * clamp((p.y - (center.y - ry)) / (2 * ry))
        return (k, k, k)
    return f


def canopy(seed):
    """Broad-crowned tree: buttress roots, a leaning trunk, limbs that fork out into
    a wide, layered crown of broadleaf clusters."""
    rnd = random.Random(seed)
    bark, leaves, lo = Mesh("canopy%d_bark" % seed), Mesh("canopy%d_leaves" % seed), Mesh("canopy%d_lo" % seed)
    H = 48.0
    lean = Vector((rnd.uniform(-1, 1), 0, rnd.uniform(-1, 1))) * 0.06
    trunk = grow(Vector((0, -3, 0)), UP + lean, H * 0.62 + 3, 7, rnd, up_pull=0.05, wobble=0.04)
    tr = [2.6 - 1.5 * (i / 7) ** 0.7 for i in range(8)]
    bark_col = (0.95, 0.9, 0.85)
    tube(bark, trunk, tr, 10, bark_col)
    # buttress roots
    for k in range(5):
        a = TAU * k / 5 + rnd.uniform(-0.3, 0.3)
        d = Vector((math.cos(a), -0.55, math.sin(a)))
        pts = grow(Vector((0, 2.5, 0)) + Vector((math.cos(a), 0, math.sin(a))) * 1.2, d, 7, 3, rnd, wobble=0.05)
        tube(bark, pts, [1.4, 1.0, 0.6, 0.25], 5, bark_col)
    crown_c = Vector((0, H * 0.78, 0)) + lean * H * 0.6
    ao = ao_crown(crown_c, 18, 9)
    tips = []
    nl = rnd.randint(5, 7)
    for k in range(nl):
        a = TAU * k / nl + rnd.uniform(-0.25, 0.25)
        i0 = rnd.randint(4, 6)
        start = trunk[i0]
        elev = math.radians(rnd.uniform(28, 48))
        d = Vector((math.cos(a) * math.cos(elev), math.sin(elev), math.sin(a) * math.cos(elev)))
        L = rnd.uniform(14, 19)
        limb = grow(start, d, L, 4, rnd, up_pull=0.04, wobble=0.1)
        tube(bark, limb, [tr[i0] * 0.62 * (1 - 0.8 * t / 4) + 0.12 for t in range(5)], 6, bark_col)
        tips.append((limb[-1], d))
        # forks off the limb
        for f in range(rnd.randint(2, 3)):
            j = rnd.randint(2, 3)
            fa = a + rnd.choice((-1, 1)) * rnd.uniform(0.5, 1.0)
            fe = math.radians(rnd.uniform(20, 45))
            fd = Vector((math.cos(fa) * math.cos(fe), math.sin(fe), math.sin(fa) * math.cos(fe)))
            fork = grow(limb[j], fd, rnd.uniform(6, 10), 2, rnd, wobble=0.12)
            tube(bark, fork, [0.45, 0.28, 0.1], 4, bark_col)
            tips.append((fork[-1], fd))
    # crown: clusters at every tip, plus a layer filling in between them
    glow_k = lambda: 0.0
    clusters = []
    for p, d in tips:
        clusters.append(p)
        for _ in range(2):
            clusters.append(p + Vector((rnd.uniform(-3, 3), rnd.uniform(-1, 2.5), rnd.uniform(-3, 3))))
    for _ in range(10):
        a = rnd.uniform(0, TAU); r = rnd.uniform(3, 12)
        clusters.append(crown_c + Vector((math.cos(a) * r, rnd.uniform(1, 5), math.sin(a) * r)))
    for i, p in enumerate(clusters):
        out = p - crown_c
        out.y *= 0.4
        out = out.normalized() if out.length > 0.5 else UP
        hz = Vector((out.x, 0, out.z)).normalized() if Vector((out.x, 0, out.z)).length > 0.1 else Vector((1, 0, 0))
        s = rnd.uniform(9.0, 12.5)
        g = glow_k()
        # a low, near-flat card spreading outward, and an upright one facing out
        side = hz.cross(UP)
        up1 = (hz + UP * rnd.uniform(0.5, 1.0) + side * rnd.uniform(-0.4, 0.4)).normalized()
        n1 = (UP * 0.7 + hz * 0.6 + side * rnd.uniform(-0.5, 0.5)).normalized()
        card(leaves, p - hz * s * 0.25 - UP * 1.0, up1, n1, s, s * 0.9, 0, crown_c, ao, g)
        up2 = (UP + hz * 0.3 + side * rnd.uniform(-0.5, 0.5)).normalized()
        card(leaves, p - UP * s * 0.35, up2, (hz + side * rnd.uniform(-0.6, 0.6)).normalized(), s * 0.95, s * 0.95, 0, crown_c, ao, g)
        if i % 3 == 0:
            # far version: every third cluster, double size
            card(lo, p - hz * s * 0.4 - UP * 2.0, up1, (UP + hz * 0.4).normalized(), s * 2.0, s * 1.7, 0, crown_c, ao, g, nmix=0.85)
    # lo trunk: a stub tube on the atlas bark patch
    tube(lo, [trunk[0], trunk[3], trunk[6]], [2.4, 1.6, 1.0], 5, bark_col, cell=3)
    return [bark, leaves, lo]


def spire(seed):
    """Tall fir-like tree: a straight, tapering trunk with whorls of drooping limbs
    clothed in conifer sprays, short at the top and long at the base."""
    rnd = random.Random(seed)
    bark, leaves, lo = Mesh("spire%d_bark" % seed), Mesh("spire%d_leaves" % seed), Mesh("spire%d_lo" % seed)
    H = 54.0
    trunk = grow(Vector((0, -3, 0)), UP, H + 3, 8, rnd, wobble=0.02)
    tr = [1.7 * (1 - i / 8) ** 0.9 + 0.08 for i in range(9)]
    col = (0.92, 0.86, 0.8)
    tube(bark, trunk, tr, 8, col)
    crown_c = Vector((0, H * 0.55, 0))
    ao = ao_crown(Vector((0, H * 0.5, 0)), 11, 26, base=0.5)
    y = 9.0
    w = 0
    while y < H - 2:
        t = (y - 9) / (H - 11)
        L = 13.5 * (1 - t) ** 1.1 + 2.0
        n = 6 if t < 0.6 else 4
        for k in range(n):
            a = TAU * (k + 0.5 * (w % 2)) / n + rnd.uniform(-0.2, 0.2)
            hz = Vector((math.cos(a), 0, math.sin(a)))
            d = (hz + UP * 0.25).normalized()
            limb = grow(Vector((0, y, 0)), d, L, 3, rnd, droop=0.55, wobble=0.06)
            if L > 5:
                tube(bark, limb, [0.32 * (1 - t) + 0.1, 0.18, 0.1, 0.04], 3, col)
            # sprays along the limb, lying roughly flat, a little tilted
            ns = max(1, int(L / 4))
            for s in range(ns):
                j = min(3, 1 + s * 3 // max(ns, 1))
                p = limb[j - 1].lerp(limb[j], 0.3)
                seg = (limb[j] - limb[j - 1]).normalized()
                sz = min(10.5, L * 0.85 + 2.2)
                for tilt in (rnd.uniform(-0.6, -0.2), rnd.uniform(0.2, 0.6)):
                    out = (UP + hz.cross(UP) * tilt + hz * 0.3).normalized()
                    card(leaves, p, seg, out, sz * 0.85, sz, 1, crown_c, ao, 0.0, bend=-0.12, nmix=0.6)
        y += 3.6 + 1.2 * t
        w += 1
    # tip
    for k in range(2):
        a = k * math.pi / 2
        hz = Vector((math.cos(a), 0, math.sin(a)))
        card(leaves, Vector((0, H - 6, 0)), UP, hz, 4.5, 9, 1, crown_c, ao, 0.0, bend=0.0, nmix=0.5)
    # far version: the conifer spray is itself a fir silhouette, so three crossed
    # cards the height of the crown read as the whole tree
    for k in range(3):
        a = k * math.pi / 3 + 0.3
        hz = Vector((math.cos(a), 0, math.sin(a)))
        card(lo, Vector((0, 4.0, 0)), UP, hz, 31, H - 2, 1, crown_c, ao, 0.0, bend=0.0, nmix=0.8)
    tube(lo, [trunk[0], trunk[4], trunk[8]], [1.6, 0.9, 0.1], 4, col, cell=3)
    return [bark, leaves, lo]


def to_bl(p):
    return Vector((p.x, -p.z, p.y))


def make_object(m):
    me = bpy.data.meshes.new(m.name)
    me.from_pydata([to_bl(v) for v in m.v], [], m.f)
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", [x for c in m.col for x in (*c, 1.0)])
    me.color_attributes.active_color = ca
    me.attributes.new("_glow", "FLOAT", "POINT").data.foreach_set("value", m.glow)
    me.attributes.new("_nrm", "FLOAT_VECTOR", "POINT").data.foreach_set("vector", [x for n in m.nrm for x in n])
    uvl = me.uv_layers.new(name="UVMap")
    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            uvl.data[li].uv = m.uv[vi]
    me.validate()
    ob = bpy.data.objects.new(m.name, me)
    bpy.context.scene.collection.objects.link(ob)
    log("%-16s %6d verts %6d tris" % (m.name, len(m.v), m.tri_count()))
    return ob


def render_previews(objs):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.samples = 24; sc.cycles.use_denoising = True
    sc.render.film_transparent = False
    sc.render.resolution_x, sc.render.resolution_y = 1100, 560
    sc.view_settings.view_transform = "AgX"
    sc.world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.9, 1)
    leaves_img = bpy.data.images.load(os.path.join(ROOT, "tex", "leaves.png"))
    bark_img = bpy.data.images.load(os.path.join(ROOT, "tex", "bark_c.jpg"))
    def tex_mat(img, alpha):
        mat = bpy.data.materials.new(img.name); mat.use_nodes = True
        nt = mat.node_tree; b = nt.nodes["Principled BSDF"]
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = img
        vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix"); mix.data_type = "RGBA"; mix.blend_type = "MULTIPLY"; mix.inputs[0].default_value = 1
        nt.links.new(t.outputs["Color"], mix.inputs[6]); nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], b.inputs["Base Color"])
        if alpha: nt.links.new(t.outputs["Alpha"], b.inputs["Alpha"])
        return mat
    lm, bm = tex_mat(leaves_img, True), tex_mat(bark_img, False)
    for ob in objs:
        ob.data.materials.append(bm if ob.name.endswith("_bark") else lm)
    sun = bpy.data.objects.new("Sun2", bpy.data.lights.new("Sun2", "SUN"))
    sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam2", bpy.data.cameras.new("Cam2")); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.lens = 50
    # line the variants up: near versions in front, far versions behind
    names = sorted({o.name.rsplit("_", 1)[0] for o in objs})
    for i, nm in enumerate(names):
        for o in objs:
            if o.name.startswith(nm + "_"):
                o.location = ((i - 1.5) * 45, 60 if o.name.endswith("_lo") else 0, 0)
    cam.location = (0, -190, 40)
    cam.rotation_euler = (math.radians(82), 0, 0)
    sc.render.filepath = os.path.join(ROOT, "tools", "blender", "renders", "trees.png")
    bpy.ops.render.render(write_still=True)
    log("rendered", sc.render.filepath)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_atlas((cluster_broadleaf, cluster_conifer, cluster_weeper), "leaves", bark=True)
    build_atlas((cluster_grass, cluster_fern, cluster_flowers, cluster_bush), "undergrowth", seed=11)
    objs = []
    for build, seeds in ((canopy, (1, 2)), (spire, (1, 2))):
        for s in seeds:
            for m in build(s):
                objs.append(make_object(m))
    out = os.path.join(ROOT, "models", "trees.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_attributes=True, use_selection=True,
        export_vertex_color="ACTIVE", export_materials="NONE", export_animations=False,
        export_lights=False, export_cameras=False, export_texcoords=True, export_normals=False,
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
