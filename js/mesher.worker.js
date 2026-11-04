// Worker wrapper around the island mesher.

import { buildWorld } from "./world.js";
import { meshEntity } from "./mesher.js";

let entities = null;

self.onmessage = (ev) => {
    if (!entities) entities = buildWorld();
    const e = entities[ev.data.index];
    const out = meshEntity(e);
    self.postMessage({ ...out, entity: ev.data.index }, [
        out.position.buffer, out.normal.buffer, out.color.buffer, out.glow.buffer, out.index.buffer,
        out.trees.buffer, out.vines.buffer,
    ]);
};
