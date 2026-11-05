# Builds Highwake's rock kit in Blender: models/rocks.glb
#   boulder1, boulder2  rounded, chiselled boulders for the island tops (moss on top)
#   slab                a flat, layered ledge that juts out of cliff faces
#   shard               a tall splintered spike for cliff faces and undersides
# Each shape comes as <name>_hi (~1.3k triangles) and <name>_lo (~80), displaced by the
# same function so the two match. Unit size (about 1 m radius); the game scales them.
# Colour is linear rock with moss (green, which the island shader turns into its grass
# texture) on upward faces; _glow is zero. The island material shades them with the
# same triplanar cliff detail as the islands, so they sit in the rock.
#
# Run: powershell -NoProfile -File tools/blender/run.ps1 tools/blender/build_rocks.py [--render]
# Game space is +y up; Blender gets (x, -z, y), which the glTF exporter turns back.

import bpy, bmesh, math, sys, os, random, traceback
from mathutils import Vector, noise

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
ROOT = argv[0] if argv else os.getcwd()
LOG = open(argv[1] if len(argv) > 1 else os.path.join(ROOT, "tools", "blender", "last.log"), "w", encoding="utf-8")
RENDER = "--render" in argv


def log(*a):
    print(*a, file=LOG, flush=True)


def lin(c):
    return tuple(x ** 2.2 for x in c)


# per shape: stretch (x, y, z in game space), number of chisel planes, terrace strength, moss
SHAPES = {
    "boulder1": dict(seed=3, scale=(1.0, 0.72, 0.9), planes=7, terrace=0.05, moss=1.0, flat_bottom=-0.35),
    "boulder2": dict(seed=8, scale=(1.0, 0.85, 0.8), planes=9, terrace=0.03, moss=1.0, flat_bottom=-0.3),
    "slab": dict(seed=5, scale=(1.0, 0.32, 0.75), planes=6, terrace=0.12, moss=0.6, flat_bottom=None),
    "shard": dict(seed=11, scale=(0.38, 1.0, 0.34), planes=8, terrace=0.04, moss=0.0, flat_bottom=None, taper=True),
}


def shape_fn(cfg):
    rnd = random.Random(cfg["seed"])
    planes = []
    for _ in range(cfg["planes"]):
        n = Vector((rnd.gauss(0, 1), rnd.gauss(0, 1), rnd.gauss(0, 1))).normalized()
        planes.append((n, rnd.uniform(0.55, 0.85)))
    off = Vector((rnd.uniform(0, 100), rnd.uniform(0, 100), rnd.uniform(0, 100)))
    sx, sy, sz = cfg["scale"]

    def f(p):
        # p: point on the unit sphere, game space (y up)
        q = p.copy()
        # chisel: cut the sphere with planes, leaving flat facets and sharp edges
        for n, d in planes:
            k = q.dot(n) - d
            if k > 0:
                q -= n * k * 0.9
        # lumpy fBm, then terraces (bedding) along y
        r = 1.0 + 0.16 * noise.fractal(q * 1.7 + off, 0.55, 2.0, 4) + 0.05 * noise.noise(q * 6.0 + off)
        q *= r
        q.y += cfg["terrace"] * math.sin(q.y * 11.0 + noise.noise(q * 2 + off) * 2.0)
        if cfg.get("taper"):
            t = (q.y + 1) * 0.5
            q.x *= 1.15 - 0.85 * t
            q.z *= 1.15 - 0.85 * t
        fb = cfg.get("flat_bottom")
        if fb is not None and q.y < fb:
            q.y = fb + (q.y - fb) * 0.15
        return Vector((q.x * sx, q.y * sy, q.z * sz))
    return f


def build(name, cfg, subdiv):
    f = shape_fn(cfg)
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=1.0)
    # bmesh is Blender space; move each vert through the game-space shape function
    for v in bm.verts:
        g = Vector((v.co.x, v.co.z, -v.co.y))
        q = f(g)
        v.co = Vector((q.x, -q.z, q.y))
    bm.normal_update()
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = subdiv >= 4
    rnd = random.Random(cfg["seed"] * 7 + subdiv)
    # vertex colours (linear): warm grey-brown rock with mottling, darker underneath,
    # moss on the faces that look up
    nrm = [Vector() for _ in me.vertices]
    for poly in me.polygons:
        for vi in poly.vertices:
            nrm[vi] += poly.normal * poly.area
    cols = []
    for v, n in zip(me.vertices, nrm):
        n = n.normalized() if n.length > 0 else Vector((0, 0, 1))
        up = n.z                      # Blender z = game y
        mott = noise.noise(v.co * 2.3 + Vector((cfg["seed"], 0, 0)))
        base = Vector(lin((0.6 + 0.05 * mott, 0.55 + 0.045 * mott, 0.49 + 0.04 * mott)))
        shade = 0.55 + 0.45 * max(0.0, min(1.0, (v.co.z + 1.0) * 0.6))
        c = base * shade
        moss = cfg["moss"] * max(0.0, min(1.0, (up - 0.55) / 0.3)) * max(0.0, min(1.0, 0.6 + noise.noise(v.co * 1.4) * 1.2))
        mc = Vector(lin((0.16, 0.36, 0.14)))
        c = c.lerp(mc, moss)
        cols.append((c.x, c.y, c.z, 1.0))
    ca = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    ca.data.foreach_set("color", [x for c in cols for x in c])
    me.color_attributes.active_color = ca
    me.attributes.new("_glow", "FLOAT", "POINT").data.foreach_set("value", [0.0] * len(me.vertices))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    cen = sum((v.co for v in me.vertices), Vector()) / len(me.vertices)
    out = sum(1 for p in me.polygons if p.normal.dot(p.center - cen) > 0)
    log("%-14s %5d verts %5d tris  %d%% facing out" % (name, len(me.vertices), len(me.polygons), 100 * out // len(me.polygons)))
    return ob


def render_previews(objs):
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"; sc.cycles.device = "CPU"; sc.cycles.samples = 24; sc.cycles.use_denoising = True
    sc.render.resolution_x, sc.render.resolution_y = 1000, 420
    sc.view_settings.view_transform = "AgX"
    world = bpy.data.worlds.new("Sky"); world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.55, 0.68, 0.9, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.6
    sc.world = world
    mat = bpy.data.materials.new("rock"); mat.use_nodes = True
    nt = mat.node_tree; vc = nt.nodes.new("ShaderNodeVertexColor"); vc.layer_name = "Col"
    nt.links.new(vc.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN")); sun.data.energy = 4
    sun.rotation_euler = (math.radians(45), 0, math.radians(40)); sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("Cam", bpy.data.cameras.new("Cam")); sc.collection.objects.link(cam); sc.camera = cam
    for i, ob in enumerate(o for o in objs if o.name.endswith("_hi")):
        ob.data.materials.append(mat); ob.location = ((i - 1.5) * 2.6, 0, 0)
    for i, ob in enumerate(o for o in objs if o.name.endswith("_lo")):
        ob.data.materials.append(mat); ob.location = ((i - 1.5) * 2.6, 3.5, 0)
    cam.location = (0, -10, 3.2); cam.rotation_euler = (math.radians(75), 0, 0); cam.data.lens = 40
    sc.render.filepath = os.path.join(ROOT, "tools", "blender", "renders", "rocks.png")
    bpy.ops.render.render(write_still=True)
    log("rendered", sc.render.filepath)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    objs = []
    for name, cfg in SHAPES.items():
        objs.append(build(name + "_hi", cfg, 4))
        objs.append(build(name + "_lo", cfg, 2))
    out = os.path.join(ROOT, "models", "rocks.glb")
    for o in objs:
        o.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out, export_format="GLB", export_yup=True, export_attributes=True, use_selection=True,
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
