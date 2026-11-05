// Offline support: cache the game shell and the three.js modules it loads.
// Bump CACHE whenever files change so installed copies update.

const CACHE = "highwake-v10";
const SHELL = [
    "./", "index.html", "css/style.css", "manifest.webmanifest",
    "js/main.js", "js/game.js", "js/world.js", "js/noise.js", "js/gfx.js", "js/sky.js", "js/islands.js",
    "js/mesher.js", "js/mesher.worker.js", "js/landmarks.js", "js/creatures.js", "js/vessel.js", "js/audio.js",
    "js/dragon.js", "js/land.js", "js/landgen.js", "js/land.worker.js", "js/cinematic.js", "js/dragonModel.js", "models/dragon.glb", "models/creatures.glb",
    "tex/cliff_c.jpg", "tex/cliff_n.jpg", "tex/rock_c.jpg", "tex/grass_c.jpg", "tex/grass_n.jpg", "tex/bark_c.jpg", "tex/tree_atlas.png",
    "icons/icon-192.png", "icons/icon-512.png", "icons/icon-maskable-512.png", "icons/apple-touch-icon.png",
];
const THREE_BASE = "https://cdn.jsdelivr.net/npm/three@0.170.0/";
const THREE_FILES = [
    "build/three.module.js", "build/three.core.js",
    "examples/jsm/postprocessing/EffectComposer.js", "examples/jsm/postprocessing/RenderPass.js",
    "examples/jsm/postprocessing/UnrealBloomPass.js", "examples/jsm/postprocessing/OutputPass.js",
    "examples/jsm/postprocessing/Pass.js", "examples/jsm/postprocessing/ShaderPass.js", "examples/jsm/postprocessing/MaskPass.js",
    "examples/jsm/shaders/CopyShader.js", "examples/jsm/shaders/LuminosityHighPassShader.js", "examples/jsm/shaders/OutputShader.js",
].map((f) => THREE_BASE + f);

self.addEventListener("install", (e) => {
    e.waitUntil(caches.open(CACHE).then(async (c) => {
        await c.addAll(SHELL);
        // three.js files: best effort (some paths differ between releases)
        await Promise.all(THREE_FILES.map((u) => c.add(u).catch(() => {})));
    }));
    self.skipWaiting();
});

self.addEventListener("activate", (e) => {
    e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
    self.clients.claim();
});

self.addEventListener("fetch", (e) => {
    const url = new URL(e.request.url);
    if (e.request.method !== "GET") return;
    // never cache analytics; let it fail quietly offline
    if (url.hostname.includes("googletagmanager.com") || url.hostname.includes("google-analytics.com")) return;
    const cacheable = url.origin === location.origin || url.href.startsWith(THREE_BASE) || url.hostname.includes("fonts.g");
    if (!cacheable) return;
    e.respondWith(
        caches.match(e.request).then((hit) => {
            const net = fetch(e.request).then((res) => {
                if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
                return res;
            }).catch(() => hit || new Response("Offline", { status: 503, statusText: "Offline" }));
            return hit || net;
        }),
    );
});
