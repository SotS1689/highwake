# Builds Highwake's tree kit in Blender:
#   tex/leaves.png      a 2x2 atlas of leaf clusters rendered from modelled leaves
#                       (0 broadleaf, 1 conifer spray, 2 weeping frond, 3 bark patch)
#   tex/undergrowth.png a 2x2 atlas for ground cover (0 grass tuft, 1 fern, 2 flowers, 3 bush)
#   tex/alien.png       the otherworldly atlas (fan, plume, filament curtain, bark patch)
#   models/trees.glb    the otherworldly suite (see SPECIES below: Parasol, Veilwillow,
#                       Cloudpad as canopy1-3; Corkscrew, Lantern fir, Bellcap as spire1-3), each as
#   (leaves.png and undergrowth.png are only rebuilt with --all-atlases)
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
    """A blade from base along d (2D direction in the render plane): five verts across
    (edge, half, midrib, half, edge) so it can cup and arch smoothly, a lighter midrib,
    a darker base and a sunlit tip."""
    d = Vector((d.x, d.y, 0)).normalized()
    side = Vector((-d.y, d.x, 0))
    n = max(n, 4)
    cols = (-1.0, -0.5, 0.0, 0.5, 1.0) if width > 0.012 else (-1.0, 0.0, 1.0)
    rows = []
    for i in range(n + 1):
        t = i / n
        w = width * math.sin(math.pi * min(1.0, t ** shape)) * (1 - 0.15 * t)
        arch = math.sin(math.pi * t) * cup * 2.0 - droop * t * t
        c = base + d * (length * t) + Vector((0, 0, arch))
        shade = (0.72 + 0.28 * min(1.0, t * 2.5)) * (1.0 + 0.3 * t)
        if i == n:
            rows.append([m.vert(c, tuple(x * shade for x in col))])
            continue
        row = []
        for k in cols:
            z = cup * (1.0 - k * k) * math.sin(math.pi * t)          # cupped across
            rib = 1.12 if k == 0.0 else (0.8 if abs(k) == 1.0 else 0.95)
            row.append(m.vert(c + side * (w * k) + Vector((0, 0, z)), tuple(x * shade * rib for x in col)))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        if len(rb) == 1:
            for j in range(len(ra) - 1):
                m.f.append([ra[j], ra[j + 1], rb[0]])
        else:
            for j in range(len(ra) - 1):
                m.f.append([ra[j], ra[j + 1], rb[j + 1], rb[j]])


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
    greens = [(0.07, 0.17, 0.035), (0.09, 0.2, 0.04), (0.11, 0.21, 0.035), (0.06, 0.15, 0.045), (0.12, 0.19, 0.04)]
    # a fan of twigs from the attach point, each forking once, leaves alternating along both
    for k in range(13):
        a = math.radians(90 + (k - 6) * 11.5 + rnd.uniform(-5, 5))
        L = 0.62 + rnd.uniform(-0.1, 0.08) - abs(k - 6) * 0.025
        d = Vector((math.cos(a), math.sin(a), 0))
        pts = [o + d * (L * t) + Vector((math.sin(t * 3 + k) * 0.025, 0, 0)) for t in (0, 0.33, 0.66, 1.0)]
        twig(m, pts, 0.005, stem)
        branches = [(o, d, L, 0.18)]
        fa = a + rnd.choice((-1, 1)) * math.radians(rnd.uniform(25, 40))
        fp = o + d * (L * 0.45)
        fd = Vector((math.cos(fa), math.sin(fa), 0))
        twig(m, [fp, fp + fd * (L * 0.45)], 0.004, stem)
        branches.append((fp, fd, L * 0.45, 0.1))
        for bo, bd, bl, t0 in branches:
            ba = math.atan2(bd.y, bd.x)
            nl = int(18 * bl / 0.62) + 3
            for i in range(nl):
                t = t0 + (1 - t0) * i / max(nl - 1, 1)
                side = 1 if i % 2 else -1
                la = ba + side * math.radians(rnd.uniform(30, 62))
                sz = (0.075 + 0.03 * rnd.random()) * (1.0 - 0.25 * t)
                col = jitter_col(rnd, rnd.choice(greens), 0.22)
                leaf(m, bo + bd * (bl * t), Vector((math.cos(la), math.sin(la), 0)), sz, sz * 0.42, col, cup=0.006, n=6)
            leaf(m, bo + bd * bl, bd, 0.085, 0.034, jitter_col(rnd, greens[2]), cup=0.006, n=6)


def cluster_conifer(m, rnd, c=1):
    o = cell_origin(c)
    stem = (0.04, 0.03, 0.02)
    cols = [(0.05, 0.14, 0.08), (0.07, 0.17, 0.09), (0.09, 0.19, 0.08)]
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
                    leaf(m, p + Vector((0, 0, 0.004 * q)), nd, nl, 0.011, jitter_col(rnd, rnd.choice(cols), 0.25), n=4, shape=0.5)
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
                leaf(m, p, ld, 0.1 + 0.03 * rnd.random(), 0.02, jitter_col(rnd, rnd.choice(cols)), cup=0.006, n=6)


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


def fit_cell(m, start, c, margin=0.03, origin=None):
    """Scale the verts added since start about the cell's attach point so they fit the cell."""
    o = origin if origin is not None else cell_origin(c)
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
        o = fn(m, rnd, c)   # a cluster may return its own attach point (hanging ones: top edge)
        fit_cell(m, n0, c, origin=o if isinstance(o, Vector) else None)
    me = bpy.data.meshes.new("leafatlas")
    me.from_pydata([tuple(v) for v in m.v], [], m.f)
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", [x for c in m.c for x in (*c, 1.0)])
    for poly in me.polygons:
        poly.use_smooth = True
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
    sc.render.resolution_x = sc.render.resolution_y = 2048
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
        a = np.clip(cell[..., 3] * 1.4, 0, 1)
        solid = a > 0.2
        mean = cell[..., :3][solid].mean(axis=0) if solid.any() else np.array([0.1, 0.2, 0.05])
        # Blender writes straight alpha; fill the empty texels with a blurred bleed
        rgb = cell[..., :3].copy()
        rgb[~solid] = 0
        acc = rgb.copy(); wsum = solid.astype(np.float32)
        cur, cw = acc, wsum
        for _ in range(10):
            pad = np.pad(cur * cw[..., None], ((1, 1), (1, 1), (0, 0)), mode="edge"); pw = np.pad(cw, 1, mode="edge")
            s = sum(pad[1 + dy:1 + dy + H, 1 + dx:1 + dx + H] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
            sw = sum(pw[1 + dy:1 + dy + H, 1 + dx:1 + dx + H] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
            cur = np.where(sw[..., None] > 0, s / np.maximum(sw[..., None], 1e-6), mean)
            cw = (sw > 0).astype(np.float32)
        out_rgb = np.where(solid[..., None], rgb, cur)
        cell[..., :3] = np.clip(out_rgb, 0, 1)
        # keep the soft, antialiased edge: the game turns it into a crisp edge at any scale
        cell[..., 3] = a
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


def tube(m, pts, radii, sides, col=(1, 1, 1), tile=3.2, cell=None, shade=None, glow=None):
    """Bark tube. cell=None: tiling bark uv; cell=3: inside the atlas bark patch.
    glow: optional f(point, angle, distance along) -> night-glow mask for each vertex."""
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
            q = p + d * radii[i]
            ring.append(m.vert(q, d, uv, c, glow(q, a, acc) if glow else 0.0))
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


def smooth_path(ctrl, n):
    """Catmull-Rom through control points, n samples."""
    P = [ctrl[0]] + list(ctrl) + [ctrl[-1]]
    out = []
    segs = len(ctrl) - 1
    for k in range(n):
        u = k / (n - 1) * segs
        i = min(int(u), segs - 1)
        t = u - i
        p0, p1, p2, p3 = P[i], P[i + 1], P[i + 2], P[i + 3]
        t2, t3 = t * t, t * t * t
        out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    return out


def rand_unit(rnd):
    while True:
        v = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1)))
        if 0.05 < v.length <= 1:
            return v.normalized()


def deflect(d, rnd, ang_lo, ang_hi, up=0.0):
    """Turn direction d away from itself by a random angle, around a random axis; then pull up."""
    side = d.cross(rand_unit(rnd))
    if side.length < 1e-3:
        side = d.cross(Vector((1, 0, 0)))
    side.normalize()
    a = math.radians(rnd.uniform(ang_lo, ang_hi))
    n = (d * math.cos(a) + side * math.sin(a) + UP * up).normalized()
    return n


def clump(leaves, rnd, p, crown_c, ao, s, cell=0, n=3, glow=0.0):
    """A leaf clump: n crossed cards at varied angles, facing broadly out of the crown."""
    out = p - crown_c
    out.y *= 0.6
    out = out.normalized() if out.length > 0.5 else UP
    for _ in range(n):
        up = (rand_unit(rnd) * 0.8 + out * 0.6 + UP * 0.55).normalized()
        face = (out + rand_unit(rnd) * 0.7).normalized()
        if abs(face.dot(up)) > 0.95:
            face = (face + rand_unit(rnd)).normalized()
        w = s * rnd.uniform(0.85, 1.15)
        card(leaves, p + rand_unit(rnd) * s * 0.25 - up * w * 0.35, up, face, w, w * 0.95, cell, crown_c, ao, glow, bend=0.3, nmix=0.7)


def canopy(seed):
    """Broad-crowned tree grown as a real branching structure: a curving trunk that flares
    into roots arching down into the ground, limbs that split into branches and twigs,
    and leaf clumps at the twig ends, so the crown is lumpy and airy with wood showing
    through it."""
    rnd = random.Random(seed)
    bark, leaves, lo = Mesh("canopy%d_bark" % seed), Mesh("canopy%d_leaves" % seed), Mesh("canopy%d_lo" % seed)
    H = 48.0
    bark_col = (0.95, 0.9, 0.85)
    lean = Vector((rnd.uniform(-1, 1), 0, rnd.uniform(-1, 1))) * 0.07
    # trunk: a gentle S-curve with a swelling base
    sway = Vector((rnd.uniform(-1, 1), 0, rnd.uniform(-1, 1))) * 1.6
    ctrl = [Vector((0, -3, 0)), Vector((0, 6, 0)) + sway * 0.4, Vector((0, H * 0.3, 0)) - sway * 0.5 + lean * 10,
            Vector((0, H * 0.48, 0)) + sway * 0.3 + lean * 18, Vector((0, H * 0.6, 0)) + lean * 26]
    trunk = smooth_path(ctrl, 12)
    tr = [2.5 * (1 - 0.5 * (i / 11) ** 0.9) + 1.5 * max(0.0, 1 - i / 2.5) ** 2 for i in range(12)]
    tube(bark, trunk, tr, 10, bark_col)
    # roots: lobes leaving the trunk's flare, arching out and down into the ground
    nr = rnd.randint(7, 9)
    for k in range(nr):
        a = TAU * k / nr + rnd.uniform(-0.25, 0.25)
        o = Vector((math.cos(a), 0, math.sin(a)))
        L = rnd.uniform(5.0, 9.0)
        pts = smooth_path([Vector((0, 3.0, 0)) + o * 1.2, Vector((0, 1.2, 0)) + o * (L * 0.38), Vector((0, -0.2, 0)) + o * (L * 0.72),
                           Vector((0, -1.0, 0)) + o * L], 5)
        tube(bark, pts, [1.25, 1.0, 0.7, 0.38, 0.1], 5, bark_col)

    crown_c = Vector((0, H * 0.74, 0)) + lean * H * 0.6
    tips = []

    def branch(start, d, L, r0, depth):
        nseg = (4, 3, 2)[depth]
        pts = grow(start, d, L, nseg, rnd, up_pull=0.05 + 0.03 * depth, wobble=0.14)
        radii = [r0 * (1 - 0.72 * (i / nseg) ** 0.9) + 0.05 for i in range(nseg + 1)]
        tube(bark, pts, radii, (6, 4, 3)[depth], bark_col)
        if depth == 2:
            tips.append(pts[-1])
            return
        kids = rnd.randint(2, 3)
        for c in range(kids):
            j = min(nseg, max(1, round(nseg * rnd.uniform(0.45, 1.0))))
            cd = deflect(d, rnd, 25, 50, up=0.25)
            branch(pts[j], cd, L * rnd.uniform(0.5, 0.68), radii[j] * 0.72, depth + 1)
        tips.append(pts[-1])

    nl = rnd.randint(5, 6)
    for k in range(nl):
        a = TAU * k / nl + rnd.uniform(-0.3, 0.3)
        i0 = rnd.randint(6, 10)
        elev = math.radians(rnd.uniform(22, 50))
        d = Vector((math.cos(a) * math.cos(elev), math.sin(elev), math.sin(a) * math.cos(elev)))
        branch(trunk[i0], d, rnd.uniform(13, 18), tr[i0] * 0.6, 0)
    branch(trunk[-1], (UP + lean * 3).normalized(), 10, tr[-1], 1)

    # crown: a clump at every twig end and part-way along, plus a few filling the middle
    ext = max(((p - crown_c) * Vector((1, 0, 1))).length for p in tips) + 4
    ao = ao_crown(crown_c, ext, ext * 0.5, base=0.6)
    clusters = []
    for p in tips:
        clusters.append(p)
        if rnd.random() < 0.6:
            clusters.append(p + rand_unit(rnd) * 3.0 + UP * 1.0)
    for _ in range(8):
        a = rnd.uniform(0, TAU); r = rnd.uniform(2, ext * 0.6)
        clusters.append(crown_c + Vector((math.cos(a) * r, rnd.uniform(0, 5), math.sin(a) * r)))
    for i, p in enumerate(clusters):
        s = rnd.uniform(6.0, 8.5)
        clump(leaves, rnd, p, crown_c, ao, s, 0, 3)
        if i % 3 == 0:
            out = p - crown_c
            out.y *= 0.4
            out = out.normalized() if out.length > 0.5 else UP
            hz = Vector((out.x, 0, out.z)).normalized() if Vector((out.x, 0, out.z)).length > 0.1 else Vector((1, 0, 0))
            up1 = (hz + UP * 0.8).normalized()
            card(lo, p - hz * s * 0.6 - UP * 2.0, up1, (UP + hz * 0.4).normalized(), s * 2.4, s * 2.0, 0, crown_c, ao, 0.0, nmix=0.85)
    tube(lo, [trunk[0], trunk[5], trunk[11]], [2.6, 1.8, 1.2], 5, bark_col, cell=3)
    return [bark, leaves, lo]


def spire(seed):
    """Tall fir: a straight, tapering trunk with dense whorls of drooping limbs, each
    clothed in many small sprays, so the silhouette is ragged and layered."""
    rnd = random.Random(seed)
    bark, leaves, lo = Mesh("spire%d_bark" % seed), Mesh("spire%d_leaves" % seed), Mesh("spire%d_lo" % seed)
    H = 54.0
    trunk = grow(Vector((0, -3, 0)), UP, H + 3, 9, rnd, wobble=0.02)
    tr = [1.8 * (1 - i / 9) ** 0.9 + 0.08 + 0.9 * max(0.0, 1 - i / 1.5) ** 2 for i in range(10)]
    col = (0.92, 0.86, 0.8)
    tube(bark, trunk, tr, 9, col)
    crown_c = Vector((0, H * 0.55, 0))
    ao = ao_crown(Vector((0, H * 0.5, 0)), 11, 26, base=0.68)
    y = 8.0
    w = 0
    while y < H - 3:
        t = (y - 8) / (H - 11)
        L = 13.0 * (1 - t) ** 1.05 + 2.2
        n = 6 if t < 0.55 else 5
        for k in range(n):
            a = TAU * (k + 0.5 * (w % 2)) / n + rnd.uniform(-0.3, 0.3)
            hz = Vector((math.cos(a), 0, math.sin(a)))
            d = (hz + UP * rnd.uniform(0.1, 0.35)).normalized()
            Lk = L * rnd.uniform(0.8, 1.1)
            limb = grow(Vector((0, y, 0)), d, Lk, 3, rnd, droop=0.6, wobble=0.08)
            if Lk > 4 and (k + w) % 2 == 0:
                tube(bark, limb, [0.3 * (1 - t) + 0.1, 0.17, 0.09, 0.03], 3, col)
            # small sprays all along the limb, lying flat-ish and alternating left/right
            ns = max(2, int(Lk / 3.7))
            for s in range(ns):
                f = (s + 0.5) / ns
                j = min(3, int(f * 3) + 1)
                p = limb[j - 1].lerp(limb[j], f * 3 - (j - 1))
                seg = (limb[j] - limb[j - 1]).normalized()
                sz = min(9.5, Lk * 0.75 + 3.0) * (1.0 - 0.3 * f)
                for sgn in (-1, 1):
                    tilt = rnd.uniform(0.25, 0.65) * sgn
                    out = (UP + hz.cross(UP) * tilt + hz * 0.25).normalized()
                    card(leaves, p, (seg + UP * rnd.uniform(-0.15, 0.1)).normalized(), out, sz * 0.85, sz, 1, crown_c, ao, 0.0, bend=-0.15, nmix=0.6)
        y += 2.9 + 1.1 * t + rnd.uniform(-0.3, 0.3)
        w += 1
    # a narrow core of crossed sprays so the crown has no hollow middle
    for k in range(3):
        a = k * math.pi / 3 + 0.5
        hz = Vector((math.cos(a), 0, math.sin(a)))
        card(leaves, Vector((0, H * 0.35, 0)), UP, hz, 9, H * 0.6, 1, crown_c, ao, 0.0, bend=0.0, nmix=0.7)
    for k in range(3):
        a = k * math.pi / 3
        hz = Vector((math.cos(a), 0, math.sin(a)))
        card(leaves, Vector((0, H - 7, 0)), UP, hz, 4.0, 9, 1, crown_c, ao, 0.0, bend=0.0, nmix=0.5)
    # far version: crossed cards the height of the crown in two tiers
    for k in range(3):
        a = k * math.pi / 3 + 0.3
        hz = Vector((math.cos(a), 0, math.sin(a)))
        card(lo, Vector((0, 3.0, 0)), UP, hz, 34, H * 0.72, 1, crown_c, ao, 0.0, bend=0.0, nmix=0.8)
        b = a + math.pi / 6
        hb = Vector((math.cos(b), 0, math.sin(b)))
        card(lo, Vector((0, H * 0.42, 0)), UP, hb, 19, H * 0.6, 1, crown_c, ao, 0.0, bend=0.0, nmix=0.8)
    tube(lo, [trunk[0], trunk[4], trunk[9]], [1.7, 0.9, 0.1], 4, col, cell=3)
    return [bark, leaves, lo]


# =================================================================================
# The otherworldly suite: tex/alien.png + six species (models/trees.glb)
#   alien atlas cells: 0 sword-leaf fan (dragon-blood rosette, jade to moon-silver)
#                      1 plume (feathered frond, indigo through cyan to rose)
#                      2 filament curtain (glowing strands and beads, hanging from the TOP edge)
#                      3 bark patch (for the far versions' trunks)
#   canopy1 Parasol     dragon-blood umbrella: forking limbs, a dense flat crown, a fringe of glowing filaments
#   canopy2 Veilwillow  arching limbs hung with luminous curtains almost to the ground
#   canopy3 Cloudpad    a twisted two-stem trunk holding floating bonsai pads, lanterns underneath
#   spire1  Corkscrew   a spiralling trunk wound with a staircase of plumes, a glowing bud on top
#   spire2  Lantern fir tiers of drooping plume-limbs, glowing seed-lanterns at the tips
#   spire3  Bellcap     a slender stalk carrying three jellyfish bells trailing filaments
# =================================================================================

def leafg(m, base, d, length, width, c0, c1, n=6, shape=0.8, cup=0.006, curve=0.0):
    """A blade whose colour runs from c0 at its base to c1 at its tip; curve bends it sideways."""
    d = Vector((d.x, d.y, 0)).normalized()
    rows, c, dd = [], base.copy(), d.copy()
    for i in range(n + 1):
        t = i / n
        if i:
            dd = (dd + Vector((-dd.y, dd.x, 0)) * (curve / n)).normalized()
            c = c + dd * (length / n)
        w = width * math.sin(math.pi * min(1.0, max(t, 1e-3) ** shape)) * (1 - 0.15 * t)
        col = tuple(c0[k] + (c1[k] - c0[k]) * t for k in range(3))
        sd = Vector((-dd.y, dd.x, 0))
        if i == n:
            rows.append([m.vert(c, col)])
            continue
        row = []
        for k in (-1.0, 0.0, 1.0):
            rib = 1.15 if k == 0.0 else 0.85
            z = cup * (1 - k * k) * math.sin(math.pi * t)
            row.append(m.vert(c + sd * (w * k) + Vector((0, 0, z)), tuple(x * rib for x in col)))
        rows.append(row)
    for ra, rb in zip(rows, rows[1:]):
        if len(rb) == 1:
            for j in range(len(ra) - 1):
                m.f.append([ra[j], ra[j + 1], rb[0]])
        else:
            for j in range(len(ra) - 1):
                m.f.append([ra[j], ra[j + 1], rb[j + 1], rb[j]])


def lerp3(a, b, t):
    return tuple(a[k] + (b[k] - a[k]) * t for k in range(3))


def cluster_fan(m, rnd, c=0):
    o = cell_origin(c)
    bases = [(0.015, 0.06, 0.06), (0.02, 0.07, 0.08), (0.02, 0.05, 0.09)]
    tips = [(0.3, 0.5, 0.42), (0.38, 0.5, 0.47), (0.44, 0.4, 0.55), (0.27, 0.45, 0.5), (0.5, 0.52, 0.48)]
    for layer in range(3):
        n = 26 - layer * 6
        for k in range(n):
            f = (k + rnd.random() * 0.7) / n
            a = math.radians(14 + 152 * f)
            L = (0.84 - layer * 0.16) * (0.72 + 0.28 * math.sin(math.pi * f)) * rnd.uniform(0.86, 1.05)
            d = Vector((math.cos(a), math.sin(a), 0))
            leafg(m, o + d * 0.025 + Vector((0, 0, 0.012 * layer)), d, L, L * 0.075,
                  rnd.choice(bases), jitter_col(rnd, rnd.choice(tips), 0.12), n=8, shape=0.5, curve=rnd.uniform(-0.3, 0.3))


def cluster_plume(m, rnd, c=1):
    o = cell_origin(c)
    for k in range(5):
        a = math.radians(90 + (k - 2) * 23 + rnd.uniform(-4, 4))
        L = 0.88 - abs(k - 2) * 0.1
        bend = (2 - k) * 0.11 + rnd.uniform(-0.05, 0.05)
        pts, p, d = [], o.copy(), Vector((math.cos(a), math.sin(a), 0))
        for i in range(14):
            pts.append(p.copy())
            d = (d + Vector((-d.y, d.x, 0)) * bend / 13).normalized()
            p = p + d * (L / 13)
        twig(m, pts, 0.005, (0.1, 0.06, 0.22))
        for i in range(1, 13):
            t = i / 13
            dseg = (pts[i + 1] - pts[i - 1]).normalized()
            side = Vector((-dseg.y, dseg.x, 0))
            bl = 0.15 * math.sin(math.pi * min(1.0, t * 1.08)) + 0.025
            c1 = lerp3((0.12, 0.5, 0.68), (0.85, 0.42, 0.7), t ** 1.4)
            for sgn in (-1, 1):
                leafg(m, pts[i], (side * sgn + dseg * 0.6).normalized(), bl, 0.008, (0.06, 0.04, 0.2),
                      jitter_col(rnd, tuple(x * 0.65 for x in c1), 0.1), n=4, shape=0.5, curve=-sgn * 0.4)


def cluster_filaments(m, rnd, c=2):
    """Strands falling from the top centre of the cell, beaded, brightening toward the tips."""
    cx, cy = c % 2, c // 2
    top = Vector((cx - 0.5, 1 - cy - 0.08, 0))
    for k in range(5):   # a little tuft hiding where the strands hang from
        a = math.radians(200 + k * 35)
        leafg(m, top, Vector((math.cos(a), math.sin(a), 0)), 0.09, 0.012, (0.03, 0.1, 0.12), (0.2, 0.45, 0.45), n=4)
    for k in range(19):
        x0 = (k - 9) / 9 * 0.42 + rnd.uniform(-0.015, 0.015)
        L = rnd.uniform(0.7, 0.9) * (1 - 0.2 * abs(x0) / 0.42)
        ph, amp = rnd.uniform(0, TAU), rnd.uniform(0.01, 0.03)
        pts = []
        for i in range(22):
            t = i / 21
            pts.append(top + Vector((x0 * (0.15 + 0.85 * t ** 0.7) + amp * math.sin(t * 7 + ph) * t, -L * t, 0.002 * k)))
        for i in range(21):
            t = i / 21
            a, b = pts[i], pts[i + 1]
            dd = (b - a).normalized()
            s = Vector((-dd.y, dd.x, 0)) * (0.0028 * (1 - 0.5 * t))
            ca = lerp3((0.1, 0.22, 0.3), (0.42, 0.55, 0.68), t)
            cb = lerp3((0.1, 0.22, 0.3), (0.42, 0.55, 0.68), (i + 1) / 21)
            m.f.append([m.vert(a - s, ca), m.vert(a + s, ca), m.vert(b + s, cb), m.vert(b - s, cb)])
        tint = rnd.choice([(0.6, 0.7, 0.8), (0.7, 0.55, 0.8), (0.5, 0.75, 0.68)])
        for i in list(range(5, 21, rnd.randint(3, 5))) + [21]:
            r = 0.013 if i == 21 else 0.007
            p = pts[i] + Vector((0, 0, 0.003))
            q = [m.vert(p + Vector((0, r * 1.4, 0)), tint), m.vert(p + Vector((r, 0, 0)), tint),
                 m.vert(p + Vector((0, -r * 1.4, 0)), tint), m.vert(p + Vector((-r, 0, 0)), tint)]
            m.f.append(q)
    return top


def hang(m, attach, L, w, face, cell, crown, ao, glow=1.0, sway=0.0):
    """A card hanging straight down from attach (filament curtains): four rows so the wind
    can bend it, the texture's top edge at the attach point, glowing more toward the tip."""
    face = Vector((face.x, 0, face.z))
    face = face.normalized() if face.length > 1e-3 else Vector((1, 0, 0))
    right = UP.cross(face).normalized()
    rows = []
    for t in (0.0, 0.33, 0.66, 1.0):
        c = attach - UP * (L * t) + face * (sway * L * t * t)
        row = []
        for s in (-1, 1):
            p = c + right * (w * 0.5 * s * (1.0 + 0.3 * t))
            radial = (p - crown).normalized() if (p - crown).length > 1e-3 else face
            n = (face * 0.45 + radial * 0.55).normalized()
            row.append(m.vert(p, n, uv_in_cell(cell, 0.5 + 0.49 * s, 0.995 - 0.99 * t), ao(p), glow * (0.08 + 0.62 * t ** 1.5)))
        rows.append(row)
    for a, b in zip(rows, rows[1:]):
        m.f.append([a[0], a[1], b[1], b[0]])


def octa(m, c, r, col, glow, stretch=1.4):
    """A small glowing seed-lantern (bark mesh; uv in a flat corner of the bark texture)."""
    ax = [Vector((r, 0, 0)), Vector((-r, 0, 0)), Vector((0, r * stretch, 0)), Vector((0, -r * stretch, 0)), Vector((0, 0, r)), Vector((0, 0, -r))]
    idx = [m.vert(c + v, v, (0.02, 0.02), col, glow) for v in ax]
    for a, b, cc in ((0, 2, 4), (4, 2, 1), (1, 2, 5), (5, 2, 0), (4, 3, 0), (1, 3, 4), (5, 3, 1), (0, 3, 5)):
        m.f.append([idx[a], idx[b], idx[cc]])


def lantern(bark, rnd, p, drop, r, col=(1.0, 0.95, 0.85)):
    q = p - UP * drop
    tube(bark, [p, p.lerp(q, 0.5) + rand_unit(rnd) * 0.15, q], [0.06, 0.05, 0.04], 3, (0.5, 0.5, 0.55))
    octa(bark, q - UP * r * 1.2, r, col, 1.0)


def roots_ring(bark, rnd, col, n, r0, L0, L1, y0=3.0, glow=None):
    for k in range(n):
        a = TAU * k / n + rnd.uniform(-0.25, 0.25)
        o = Vector((math.cos(a), 0, math.sin(a)))
        L = rnd.uniform(L0, L1)
        pts = smooth_path([Vector((0, y0, 0)) + o * r0 * 0.5, Vector((0, y0 * 0.4, 0)) + o * (L * 0.38),
                           Vector((0, -0.2, 0)) + o * (L * 0.72), Vector((0, -1.0, 0)) + o * L], 5)
        tube(bark, pts, [r0 * 0.5, r0 * 0.4, r0 * 0.28, r0 * 0.15, 0.08], 5, col, glow=glow)


def spiral_glow(freq, turns, width=0.92, amp=0.7, fade=None):
    """Glowing veins winding up a trunk: a mask from the vertex's angle and height."""
    def f(q, a, s):
        v = math.sin(a * turns + q.y * freq)
        g = amp * clamp((v - width) / (1 - width))
        return g * (fade(q) if fade else 1.0)
    return f


def V(x, y, z):
    return Vector((x, y, z))


def parasol(idx, seed):
    rnd = random.Random(seed)
    nm = "canopy%d" % idx
    bark, leaves, lo = Mesh(nm + "_bark"), Mesh(nm + "_leaves"), Mesh(nm + "_lo")
    col = (0.96, 0.9, 0.82)
    H = 23.0
    sway = V(rnd.uniform(-1, 1), 0, rnd.uniform(-1, 1)) * 1.4
    trunk = smooth_path([V(0, -3, 0), V(0, 6, 0) + sway * 0.4, V(0, 15, 0) - sway * 0.3, V(0, H, 0) + sway * 0.2], 10)
    tr = [3.1 * (1 - 0.3 * (i / 9)) + 1.8 * max(0.0, 1 - i / 2.2) ** 2 for i in range(10)]
    vg = spiral_glow(0.35, 3, 0.9, 0.55, fade=lambda q: clamp(1 - q.y / 30))
    tube(bark, trunk, tr, 12, col, glow=vg)
    roots_ring(bark, rnd, col, 8, 2.6, 6, 10, glow=vg)
    tips = []

    def fork(p, d, L, r, depth):
        pts = grow(p, d, L, 3, rnd, up_pull=0.0, wobble=0.05)
        radii = [r * (1 - 0.3 * i / 3) for i in range(4)]
        tube(bark, pts, radii, (8, 6, 4, 3)[depth], col, glow=vg if depth < 2 else None)
        if depth == 3:
            tips.append((pts[-1], d))
            return
        side = d.cross(UP)
        side = side.normalized() if side.length > 1e-3 else V(1, 0, 0)
        side = (side * math.cos(rnd.uniform(-0.6, 0.6)) + d.cross(side).normalized() * math.sin(rnd.uniform(-0.6, 0.6))).normalized()
        out = V(d.x, 0, d.z)
        out = out.normalized() if out.length > 1e-3 else side
        for s in (-1, 1):
            a = math.radians(rnd.uniform(24, 34))
            nd = (d * math.cos(a) + side * s * math.sin(a) + out * 0.12 * depth).normalized()
            fork(pts[-1], nd, L * rnd.uniform(0.68, 0.76), radii[-1] * 0.8, depth + 1)

    n0 = 5
    for k in range(n0):
        a = TAU * k / n0 + rnd.uniform(-0.2, 0.2)
        e = math.radians(rnd.uniform(46, 60))
        fork(trunk[-1] - UP * 0.8, V(math.cos(a) * math.cos(e), math.sin(e), math.sin(a) * math.cos(e)), 9.0, tr[-1] * 0.62, 0)
    top_y = sum(p.y for p, _ in tips) / len(tips)
    crown = V(0, top_y - 3.0, 0)
    ext = max(V(p.x, 0, p.z).length for p, _ in tips) + 4
    ao = ao_crown(crown, ext, 6.0, base=0.55)
    pts = [p for p, _ in tips]
    # fill the umbrella between the tips so the top is one dense, flat-domed mass
    for _ in range(40):
        a = rnd.uniform(0, TAU); r = ext * math.sqrt(rnd.uniform(0.0, 0.85))
        pts.append(V(math.cos(a) * r, top_y + 2.0 - 5.0 * (r / ext) ** 2 + rnd.uniform(-1.2, 1.2), math.sin(a) * r))
    for p in pts:
        rad = V(p.x, 0, p.z)
        rad = rad.normalized() if rad.length > 0.5 else rand_unit(rnd)
        rad.y = 0; rad.normalize()
        for k in range(3):
            ang = (k - 1) * 0.9 + rnd.uniform(-0.3, 0.3)
            dirh = (rad * math.cos(ang) + UP.cross(rad) * math.sin(ang)).normalized()
            up = (dirh + UP * rnd.uniform(0.2, 0.45)).normalized()
            face = (UP + rad * 0.35 + rand_unit(rnd) * 0.15).normalized()
            s = rnd.uniform(7.5, 10.0)
            card(leaves, p - dirh * s * 0.25, up, face, s, s * 0.9, 0, crown, ao, 0.08, bend=-0.12, nmix=0.65)
    # glowing filaments under the rim of the umbrella
    for k in range(34):
        a = TAU * k / 34 + rnd.uniform(-0.08, 0.08)
        r = ext * rnd.uniform(0.62, 0.95)
        p = V(math.cos(a) * r, top_y - 1.5 - 3.5 * (r / ext) ** 2, math.sin(a) * r)
        hang(leaves, p, rnd.uniform(7, 15), rnd.uniform(3.0, 4.2), V(math.cos(a), 0, math.sin(a)), 2, crown, ao, 0.9)
    # far version: six big fans on the dome, a few curtains, a stub trunk
    for k in range(6):
        a = TAU * k / 6 + 0.3
        rad = V(math.cos(a), 0, math.sin(a))
        card(lo, V(0, top_y - 1.0, 0) + rad * 1.0, (rad + UP * 0.22).normalized(), (UP + rad * 0.3).normalized(), ext * 1.05, ext * 1.08, 0, crown, ao, 0.08, bend=-0.08, nmix=0.8)
    for k in range(5):
        a = TAU * k / 5
        hang(lo, V(math.cos(a), 0, math.sin(a)) * ext * 0.7 + UP * (top_y - 4), 11, 12, V(math.cos(a), 0, math.sin(a)), 2, crown, ao, 0.9)
    tube(lo, [trunk[0], trunk[5], trunk[9]], [3.2, 2.5, 2.0], 5, col, cell=3)
    return [bark, leaves, lo]


def veilwillow(idx, seed):
    rnd = random.Random(seed)
    nm = "canopy%d" % idx
    bark, leaves, lo = Mesh(nm + "_bark"), Mesh(nm + "_leaves"), Mesh(nm + "_lo")
    col = (0.74, 0.8, 0.9)
    H = 19.0
    lean = V(rnd.uniform(-1, 1), 0, rnd.uniform(-1, 1)).normalized() * 2.5
    trunk = smooth_path([V(0, -3, 0), V(0, 5, 0) + lean * 0.2, V(0, 12, 0) + lean * 0.7, V(0, H, 0) + lean], 10)
    tr = [2.4 * (1 - 0.4 * (i / 9)) + 1.4 * max(0.0, 1 - i / 2.2) ** 2 for i in range(10)]
    vg = spiral_glow(0.5, 4, 0.9, 0.5)
    tube(bark, trunk, tr, 10, col, glow=vg)
    roots_ring(bark, rnd, col, 7, 2.0, 5, 8)
    crown = trunk[-1] + V(0, 2, 0)
    ao = ao_crown(crown, 20, 10, base=0.6)
    arcs = []
    nl = 7
    for k in range(nl):
        a = TAU * k / nl + rnd.uniform(-0.25, 0.25)
        o = V(math.cos(a), 0, math.sin(a))
        reach = rnd.uniform(13, 19)
        p0 = trunk[rnd.randint(7, 9)]
        ctrl = [p0, p0 + o * reach * 0.3 + UP * 7, p0 + o * reach * 0.65 + UP * 8.5, p0 + o * reach - UP * 1.5]
        path = smooth_path(ctrl, 9)
        tube(bark, path, [tr[8] * 0.55 * (1 - 0.8 * i / 8) + 0.08 for i in range(9)], 6, col, glow=vg)
        arcs.append(path)
        # two side arches off each limb
        for s in (-1, 1):
            q = path[3]
            sd = (o.cross(UP) * s + o * 0.6).normalized()
            sub = smooth_path([q, q + sd * 4 + UP * 3.5, q + sd * 8 + UP * 2, q + sd * 10 - UP * 2], 6)
            tube(bark, sub, [0.35 * (1 - 0.8 * i / 5) + 0.05 for i in range(6)], 4, col)
            arcs.append(sub)
    for path in arcs:
        for i in range(1, len(path)):
            for _ in range(2):
                p = path[i - 1].lerp(path[i], rnd.random())
                out = V(p.x - crown.x, 0, p.z - crown.z)
                # curtains fall almost to the ground
                L = max(4.0, (p.y + 1.0) * rnd.uniform(0.6, 0.92))
                hang(leaves, p, L, rnd.uniform(2.8, 3.8), out, 2, crown, ao, 1.0, sway=rnd.uniform(-0.05, 0.05))
            if i % 2 == 0:
                p = path[i]
                out = V(p.x - crown.x, 0, p.z - crown.z).normalized()
                dirp = (path[i] - path[i - 1]).normalized()
                card(leaves, p, (dirp + UP * 0.4).normalized(), (UP + out * 0.5).normalized(), 6.0, 5.5, 1, crown, ao, 0.12, bend=-0.1, nmix=0.6)
    for k in range(6):
        a = TAU * k / 6 + 0.2
        o = V(math.cos(a), 0, math.sin(a))
        hang(lo, trunk[-1] + o * 9 + UP * 6, 21, 15, o, 2, crown, ao, 1.0)
    card(lo, trunk[-1] - UP * 2, UP, V(1, 0, 0), 30, 14, 1, crown, ao, 0.1, bend=0, nmix=0.8)
    card(lo, trunk[-1] - UP * 2, UP, V(0, 0, 1), 30, 14, 1, crown, ao, 0.1, bend=0, nmix=0.8)
    tube(lo, [trunk[0], trunk[5], trunk[9]], [2.4, 1.8, 1.3], 5, col, cell=3)
    return [bark, leaves, lo]


def cloudpad(idx, seed):
    rnd = random.Random(seed)
    nm = "canopy%d" % idx
    bark, leaves, lo = Mesh(nm + "_bark"), Mesh(nm + "_leaves"), Mesh(nm + "_lo")
    col = (0.62, 0.52, 0.5)
    H = 17.0
    vg = spiral_glow(0.6, 2, 0.88, 0.75)
    # two stems braided round each other
    for s in range(2):
        pts = []
        for i in range(14):
            t = i / 13
            a = s * math.pi + t * TAU * 0.9
            r = 1.5 + 1.2 * (1 - t) ** 3
            pts.append(V(math.cos(a) * r, -3 + t * (H + 3), math.sin(a) * r))
        tube(bark, pts, [2.0 * (1 - 0.35 * i / 13) + 1.0 * max(0, 1 - i / 2.5) ** 2 for i in range(14)], 9, col, glow=vg)
    roots_ring(bark, rnd, col, 8, 2.2, 5, 9, glow=vg)
    top = V(0, H, 0)
    pads = [(top + V(0, 10, 0), 9.0)]
    np_ = 5
    for k in range(np_):
        a = TAU * k / np_ + rnd.uniform(-0.25, 0.25)
        o = V(math.cos(a), 0, math.sin(a))
        reach, lift = rnd.uniform(10, 16), rnd.uniform(-2, 9)
        end = top + o * reach + UP * lift
        limb = smooth_path([top - UP * 2, top + o * reach * 0.35 + UP * (lift + 4), end], 8)
        tube(bark, limb, [1.4 * (1 - 0.7 * i / 7) + 0.2 for i in range(8)], 6, col, glow=vg)
        pads.append((end + UP * 1.0, rnd.uniform(7.0, 9.5)))
    crown = top + V(0, 5, 0)
    ao = ao_crown(crown, 20, 9, base=0.62)
    for c, R in pads:
        # a flattened dome of fans, normals from just under its middle (a soft cushion)
        ctr = c - UP * 1.2
        for k in range(int(R * 3.2)):
            a = rnd.uniform(0, TAU); rr = R * math.sqrt(rnd.uniform(0.05, 1.0))
            p = c + V(math.cos(a) * rr, 1.6 * (1 - (rr / R) ** 2) + rnd.uniform(-0.3, 0.3), math.sin(a) * rr)
            rad = V(math.cos(a), 0, math.sin(a))
            up = (rad + UP * 0.35 + rand_unit(rnd) * 0.3).normalized()
            face = (UP * (1.2 - rr / R) + rad * (rr / R) + rand_unit(rnd) * 0.2).normalized()
            s = rnd.uniform(6.0, 8.0)
            card(leaves, p - up * s * 0.3, up, face, s, s * 0.9, 0, ctr, ao, 0.1, bend=-0.15, nmix=0.75)
        for k in range(rnd.randint(4, 6)):
            a = rnd.uniform(0, TAU); rr = R * rnd.uniform(0.3, 0.8)
            lantern(bark, rnd, c + V(math.cos(a) * rr, -0.6, math.sin(a) * rr), rnd.uniform(1.2, 3.0), rnd.uniform(0.32, 0.5))
        card(lo, c - V(R, 0.2, 0), V(1, 0.05, 0), UP, R * 2.0, R * 2.3, 0, ctr, ao, 0.1, bend=0, nmix=0.85)
        card(lo, c - V(0, 0.2, R), V(0, 0.05, 1), UP, R * 2.0, R * 2.3, 0, ctr, ao, 0.1, bend=0, nmix=0.85)
    tube(lo, [V(0, -3, 0), V(0, H * 0.5, 0), top], [2.8, 2.0, 1.6], 5, col, cell=3)
    return [bark, leaves, lo]


def corkscrew(idx, seed):
    rnd = random.Random(seed)
    nm = "spire%d" % idx
    bark, leaves, lo = Mesh(nm + "_bark"), Mesh(nm + "_leaves"), Mesh(nm + "_lo")
    col = (0.85, 0.82, 0.92)
    H = 58.0
    ph = rnd.uniform(0, TAU)
    trunk = []
    for i in range(30):
        t = i / 29
        a = ph + t * TAU * 1.6
        r = 1.8 * (1 - t) + 0.25
        trunk.append(V(math.cos(a) * r, -3 + t * (H + 3), math.sin(a) * r))
    tr = [2.1 * (1 - i / 29) ** 0.9 + 0.12 + 1.2 * max(0.0, 1 - i / 3) ** 2 for i in range(30)]
    vg = spiral_glow(0.42, 5, 0.86, 0.8)
    tube(bark, trunk, tr, 9, col, glow=vg)
    roots_ring(bark, rnd, col, 6, 2.0, 4, 6.5)
    crown = V(0, H * 0.45, 0)
    ao = ao_crown(V(0, H * 0.45, 0), 12, 27, base=0.66)
    # a spiral staircase of plumes winding three and a half times up the trunk
    n = 96
    for k in range(n):
        s = 0.12 + 0.86 * k / n
        a = ph + s * TAU * 3.5
        y = -3 + s * (H + 3)
        R = 12.5 * (1 - s) ** 0.85 + 1.8
        hz = V(math.cos(a), 0, math.sin(a))
        tang = UP.cross(hz).normalized()
        base = V(0, y, 0)
        tip = base + hz * R + UP * (0.6 - 1.6 * (1 - s))
        if k % 2 == 0 and R > 3:
            tube(bark, [base, base.lerp(tip, 0.5) + UP * 0.6, tip], [0.32 * (1 - s) + 0.08, 0.16, 0.05], 3, col)
        for j, f in enumerate((0.45, 0.85)):
            p = base.lerp(tip, f)
            sz = (R * 0.7 + 4.0) * (0.8 + 0.2 * j)
            up = (hz * 0.8 + tang * 0.55 + UP * 0.25).normalized()
            face = (UP * 0.8 + hz * 0.4 - tang * 0.3).normalized()
            card(leaves, p, up, face, sz * 0.8, sz, 1, crown, ao, 0.05 + 0.08 * s, bend=-0.15, nmix=0.55)
    # the bud: a cluster of glowing seeds at the very top
    for k in range(5):
        octa(bark, trunk[-1] + UP * (0.8 + k * 0.7) + rand_unit(rnd) * 0.5, 0.55 - 0.07 * k, (0.95, 0.9, 1.0), 1.0, 1.6)
    for k in range(4):
        a = ph + k * TAU / 4
        hz = V(math.cos(a), 0, math.sin(a))
        card(lo, V(0, 1.0, 0), UP, hz, 26, H * 0.95, 1, crown, ao, 0.15, bend=0, nmix=0.8)
    tube(lo, [trunk[0], trunk[14], trunk[29]], [2.0, 1.0, 0.15], 4, col, cell=3)
    return [bark, leaves, lo]


def lanternfir(idx, seed):
    rnd = random.Random(seed)
    nm = "spire%d" % idx
    bark, leaves, lo = Mesh(nm + "_bark"), Mesh(nm + "_leaves"), Mesh(nm + "_lo")
    H = 55.0
    trunk = grow(V(0, -3, 0), UP, H + 3, 10, rnd, wobble=0.025)
    tr = [1.9 * (1 - i / 10) ** 0.9 + 0.08 + 1.0 * max(0.0, 1 - i / 1.5) ** 2 for i in range(11)]
    col = (0.55, 0.5, 0.62)
    vg = spiral_glow(0.3, 3, 0.9, 0.6)
    tube(bark, trunk, tr, 9, col, glow=vg)
    roots_ring(bark, rnd, col, 6, 1.9, 4, 6)
    crown = V(0, H * 0.55, 0)
    ao = ao_crown(V(0, H * 0.5, 0), 12, 26, base=0.66)
    y, w = 7.0, 0
    while y < H - 3:
        t = (y - 7) / (H - 10)
        L = 14.0 * (1 - t) ** 1.05 + 2.2
        n = 6 if t < 0.55 else 5
        for k in range(n):
            a = TAU * (k + 0.5 * (w % 2)) / n + rnd.uniform(-0.3, 0.3)
            hz = V(math.cos(a), 0, math.sin(a))
            d = (hz + UP * rnd.uniform(0.15, 0.4)).normalized()
            Lk = L * rnd.uniform(0.85, 1.1)
            limb = grow(V(0, y, 0), d, Lk, 3, rnd, droop=0.9, wobble=0.06)
            if Lk > 4 and (k + w) % 2 == 0:
                tube(bark, limb, [0.3 * (1 - t) + 0.1, 0.17, 0.09, 0.03], 3, col)
            ns = max(2, int(Lk / 3.5))
            for s in range(ns):
                f = (s + 0.5) / ns
                j = min(3, int(f * 3) + 1)
                p = limb[j - 1].lerp(limb[j], f * 3 - (j - 1))
                seg = (limb[j] - limb[j - 1]).normalized()
                sz = min(9.5, Lk * 0.7 + 3.0) * (1.0 - 0.3 * f)
                for sgn in (-1, 1):
                    out = (UP + hz.cross(UP) * rnd.uniform(0.25, 0.6) * sgn + hz * 0.25).normalized()
                    card(leaves, p, (seg + UP * rnd.uniform(-0.15, 0.1)).normalized(), out, sz * 0.8, sz, 1, crown, ao, 0.1, bend=-0.15, nmix=0.6)
            if (k + w) % 2 == 1 and Lk > 3:
                lantern(bark, rnd, limb[-1], rnd.uniform(0.8, 2.2), 0.42 + 0.25 * (1 - t), rnd.choice([(1.0, 0.9, 0.7), (0.85, 0.95, 1.0)]))
        y += 3.1 + 1.2 * t + rnd.uniform(-0.3, 0.3)
        w += 1
    for k in range(3):
        a = k * math.pi / 3 + 0.5
        card(leaves, V(0, H * 0.35, 0), UP, V(math.cos(a), 0, math.sin(a)), 9, H * 0.6, 1, crown, ao, 0.1, bend=0.0, nmix=0.7)
    octa(bark, V(0, H + 1.5, 0), 0.9, (0.9, 0.95, 1.0), 1.0, 1.8)
    for k in range(3):
        a = k * math.pi / 3 + 0.3
        card(lo, V(0, 3.0, 0), UP, V(math.cos(a), 0, math.sin(a)), 34, H * 0.74, 1, crown, ao, 0.12, bend=0.0, nmix=0.8)
        b = a + math.pi / 6
        card(lo, V(0, H * 0.42, 0), UP, V(math.cos(b), 0, math.sin(b)), 19, H * 0.6, 1, crown, ao, 0.12, bend=0.0, nmix=0.8)
    tube(lo, [trunk[0], trunk[5], trunk[10]], [1.8, 0.9, 0.1], 4, col, cell=3)
    return [bark, leaves, lo]


def bellcap(idx, seed):
    rnd = random.Random(seed)
    nm = "spire%d" % idx
    bark, leaves, lo = Mesh(nm + "_bark"), Mesh(nm + "_leaves"), Mesh(nm + "_lo")
    col = (0.9, 0.86, 0.8)
    H = 60.0
    bendv = V(rnd.uniform(-1, 1), 0, rnd.uniform(-1, 1)).normalized()
    trunk = smooth_path([V(0, -3, 0), V(0, 15, 0) + bendv * 1.2, V(0, 35, 0) - bendv * 1.0, V(0, H, 0) + bendv * 0.8], 16)
    tr = [1.5 * (1 - 0.6 * i / 15) + 1.0 * max(0.0, 1 - i / 2.5) ** 2 for i in range(16)]
    vg = spiral_glow(0.25, 6, 0.85, 0.9)
    tube(bark, trunk, tr, 8, col, glow=vg)
    roots_ring(bark, rnd, col, 7, 1.8, 4, 7, glow=vg)
    ao = ao_crown(V(0, H * 0.65, 0), 16, 25, base=0.65)
    bells = [(H, 9.0), (H * 0.72, 12.5), (H * 0.47, 15.5)]
    for bi, (y, R) in enumerate(bells):
        i = min(15, round((y + 3) / (H + 3) * 15))
        c = trunk[i] + UP * 2.5
        crown = c - UP * 3.0
        # ribs, like an umbrella's, from the stalk out to the rim
        nr = 7
        for k in range(nr):
            a = TAU * k / nr + bi
            rim = c + V(math.cos(a) * R, -R * 0.45, math.sin(a) * R)
            rib = smooth_path([c - UP * 0.5, c + V(math.cos(a) * R * 0.5, 0.2, math.sin(a) * R * 0.5), rim], 6)
            tube(bark, rib, [0.45, 0.35, 0.25, 0.18, 0.12, 0.08], 3, col, glow=vg)
        # the bell: rings of fans on a dome, facing out
        for ring, th in enumerate((0.25, 0.6, 0.95, 1.25)):
            nk = int(5 + R * (0.55 + ring * 0.25))
            for k in range(nk):
                a = TAU * (k + 0.5 * (ring % 2)) / nk + rnd.uniform(-0.1, 0.1)
                nrm = V(math.cos(a) * math.sin(th), math.cos(th), math.sin(a) * math.sin(th))
                p = c + V(nrm.x * R, (nrm.y - 1) * R * 0.5 + 0.3, nrm.z * R) * 0.95
                tang = V(-math.sin(a), 0, math.cos(a))
                down = nrm.cross(tang).normalized()
                s = rnd.uniform(4.5, 6.0) * (0.8 + R / 30)
                card(leaves, p + down * s * 0.4, -down, (nrm + rand_unit(rnd) * 0.15).normalized(), s, s * 0.95, 0, crown, ao, 0.03 + 0.05 * ring, bend=-0.1, nmix=0.7)
        # the trailing fringe
        nf = int(R * 1.6)
        for k in range(nf):
            a = TAU * k / nf + rnd.uniform(-0.1, 0.1)
            rr = R * rnd.uniform(0.85, 1.0)
            p = c + V(math.cos(a) * rr, -R * 0.45 * (rr / R) ** 2 - 0.5, math.sin(a) * rr)
            hang(leaves, p, rnd.uniform(5, 9) + R * 0.35, rnd.uniform(2.6, 3.6), V(math.cos(a), 0, math.sin(a)), 2, crown, ao, 1.0)
        for k in range(3):
            a = k * math.pi / 3 + bi
            o = V(math.cos(a), 0, math.sin(a))
            card(lo, c - o * R + UP * 1.0, o, -UP * 0.2 + V(-o.z, 0, o.x), R * 2.1, R * 0.9, 0, crown, ao, 0.2, bend=0, nmix=0.85)
        for k in range(4):
            a = TAU * k / 4 + bi
            o = V(math.cos(a), 0, math.sin(a))
            hang(lo, c + o * R * 0.6 - UP * R * 0.25, R * 1.0, R * 1.3, o, 2, crown, ao, 1.0)
    tube(lo, [trunk[0], trunk[8], trunk[15]], [1.6, 1.0, 0.6], 4, col, cell=3)
    return [bark, leaves, lo]


SPECIES = [(parasol, 1, 11), (veilwillow, 2, 23), (cloudpad, 3, 31), (corkscrew, 1, 41), (lanternfir, 2, 53), (bellcap, 3, 61)]


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
    leaves_img = bpy.data.images.load(os.path.join(ROOT, "tex", "alien.png"))
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
                o.location = ((i - (len(names) - 1) / 2) * 55, 70 if o.name.endswith("_lo") else 0, 0)
    sc.render.resolution_x, sc.render.resolution_y = 1600, 600
    cam.location = (0, -430, 28)
    cam.rotation_euler = (math.radians(90), 0, 0)
    sc.render.filepath = os.path.join(ROOT, "tools", "blender", "renders", "trees.png")
    bpy.ops.render.render(write_still=True)
    log("rendered", sc.render.filepath)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # the green atlases (vines, the Worldtree's old crown, ground cover) only on request
    if "--all-atlases" in argv:
        build_atlas((cluster_broadleaf, cluster_conifer, cluster_weeper), "leaves", bark=True)
        build_atlas((cluster_grass, cluster_fern, cluster_flowers, cluster_bush), "undergrowth", seed=11)
    if "--no-atlas" not in argv:
        build_atlas((cluster_fan, cluster_plume, cluster_filaments), "alien", bark=True, seed=5)
    objs = []
    for build, idx, seed in SPECIES:
        for m in build(idx, seed):
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
