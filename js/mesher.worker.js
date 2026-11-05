// Worker wrapper around the island mesher.

import { buildWorld } from "./world.js";
import { meshEntity } from "./mesher.js";

let entities = null;

self.onmessage = (ev) => {
    if (!entities) entities = buildWorld();
    // scale > 1 builds a coarser copy for distant viewing (cells that much bigger)
    const base = entities[ev.data.index];
    const scale = ev.data.scale || 1;
    const e = scale === 1 ? base : { ...base, cell: base.cell * scale, trees: 0 };
    const out = meshEntity(e);
    self.postMessage({ ...out, entity: ev.data.index, scale }, [
        out.position.buffer, out.normal.buffer, out.color.buffer, out.glow.buffer, out.index.buffer,
        out.trees.buffer, out.vines.buffer,
    ]);
};
