// Worker wrapper around the land generator.

import { generateLand } from "./landgen.js";

self.onmessage = (ev) => {
    const data = generateLand(ev.data.seed);
    self.postMessage({ data }, [data.buffer]);
};
