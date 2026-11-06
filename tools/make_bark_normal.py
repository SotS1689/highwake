# Makes tex/bark_n.jpg, a tiling tangent-space normal map for the tree bark, from the
# bark photo's light and shade: dark furrows read as deep, light plates as raised.
# Run: python tools/make_bark_normal.py   (needs Pillow and numpy)
import os
import numpy as np
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
src = Image.open(os.path.join(ROOT, "tex", "bark_c.jpg")).convert("L")
h = np.asarray(src, dtype=np.float32) / 255.0
# a broad height (plates) plus fine grain; blur on a 3x3 tiled copy so the edges wrap
big = np.tile(h, (3, 3))
def blur(a, r):
    im = Image.fromarray(np.clip(a * 255, 0, 255).astype(np.uint8))
    return np.asarray(im.filter(ImageFilter.GaussianBlur(r)), dtype=np.float32) / 255.0
H, W = h.shape
plates = blur(big, 3.0)[H:2 * H, W:2 * W]
fine = blur(big, 0.8)[H:2 * H, W:2 * W]
height = plates * 0.7 + fine * 0.3
# furrows: push the darkest third deeper so the cracks between plates read
height = height - 0.6 * np.clip(0.35 - height, 0, None)
dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
k = 9.0
n = np.stack([-dx * k, dy * k, np.ones_like(dx)], axis=-1)
n /= np.linalg.norm(n, axis=-1, keepdims=True)
rgb = ((n * 0.5 + 0.5) * 255).astype(np.uint8)
out = os.path.join(ROOT, "tex", "bark_n.jpg")
Image.fromarray(rgb, "RGB").save(out, quality=92)
print("wrote", out)
