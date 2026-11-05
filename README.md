# Highwake

A 3D flying adventure for the web. You ride a sleek sky-dragon through a world of colossal floating islands, alongside sky whales, giant rays and drifting lantern-jellies. Through gaps in the cloud deck, 12 km below, lies a whole world of mountains, rivers, lakes and a coastline. Fly anywhere, on every axis: loops, rolls, dives through tunnels in the rock and climbs into thin air.

Find the four **Sky Keys** to wake the Crown that sleeps above the Heartspire:

- **Key of Needles**: thread all six great arches (tunnels through the Heartspire, Hollowspine, Verdance, Ironroot and Gullwing, and the gap under the Skybridge).
- **Key of the Spine**: fly the 17-ring run through Hollowspine's tunnels and its vertical shaft.
- **Key of Song**: listen to the bell on Bellstone, then fly through its five crystals in the order of its song.
- **Key of Kinship**: fly beside the golden-glowing Matriarch whale until she trusts you.

With all four, a beam rises from the Heartspire. Fly up through the Crown for the ending (and an aurora that stays). There are 8 wonders to discover (Titan's Rest, the Worldtree, the Rising Falls, the Listening Stone, Lantern Hollow, the Stormeye, the Skybridge, the Crown) and 18 achievements, including flying feats like loops, rolls, cloud-skimming and rock-skimming. Hold Space and the dragon beats its wings for speed; rising air and whale wakes restore its wing strength. Nothing can hurt your dragon; rock just bounces you off. There's a full day and night cycle, and the islands glow at night.

## Controls

| Input | Action |
|---|---|
| Mouse | Steer (up/down pitches, left/right banks and turns) |
| A / D | Roll |
| Q / E | Rudder |
| Arrow keys | Steer without a mouse |
| W / S | Throttle |
| Space | Beat wings for speed |
| Shift | Air brake |
| C | Camera |
| J / M | Journal / map |
| Esc | Pause |

Gamepads work too: left stick steers, bumpers roll, right stick X is rudder, triggers throttle and brake, A beats the wings, Y changes camera, Start pauses.

## Run locally

Plain HTML, CSS and JavaScript modules, no build step. three.js 0.170.0 loads from jsDelivr. Serve the folder with any static server:

```
python -m http.server 8000
```

then open http://localhost:8000. The service worker only registers on a real host, or on localhost with `?sw=1`. Needs WebGL 2. Graphics quality auto-lowers once if the first seconds of flight run under ~42 fps; it can be set by hand in Settings.

`?shot=start|arch|whales|tree|storm|under|crown|below|vista&time=day|golden|night` jumps straight to a fixed viewpoint with the UI hidden (used for testing and for `og.png`).

## Deploy

Push the folder to a GitHub repo under SotS1689 and turn on GitHub Pages. The link-preview tags in `index.html` assume `https://sots1689.github.io/highwake/`; update `og:url` and `og:image` if it lives elsewhere. Bump `CACHE` in `sw.js` whenever files change so installed copies update.

## Code map

- `js/world.js`: the whole world layout (islands, tunnels, the Skybridge, wonders, puzzle sites, thermals) and the signed-distance functions that shape the islands. Moving or adding an island is a data change here.
- `js/mesher.js` + `js/mesher.worker.js`: turns each island's distance field into a mesh (surface nets) in web workers, with colours, ambient occlusion and spots for trees and vines.
- `js/islands.js`: island meshes, forests, hanging vines and waterfalls.
- `js/landmarks.js`: the Crown, Worldtree, Titan's Rest, Listening Stone, Stormeye, Bellstone, rings, arch markers, thermals, and their colliders.
- `js/creatures.js`: sky whales, skylings, lantern-jellies, sky rays and the Worldtree's seed wisps.
- `js/vessel.js`: input (mouse, keys, gamepad), flight model, trails and chase camera.
- `js/dragon.js`: the dragon you ride, rebuilt on the CPU each frame so its spine sways and its wings glide, beat and fold.
- `js/landgen.js` + `js/land.worker.js`: generates the land far below (mountains, flood-filled lakes, rivers routed downhill, a coast) into a heightmap in a worker.
- `js/land.js`: draws that land with water glints, cloud shadows and haze.
- `js/sky.js`: sky dome, sun, moon, stars, aurora, the broken cloud deck, billboard clouds, horizon giants and the day/night cycle.
- `js/volclouds.js`: the volumetric sea of clouds and low haze (a post pass that raymarches the deck using the scene's depth).
- `js/cinematic.js`: sun shafts and the time-of-day colour grade.
- `js/dragonModel.js`: loads the Blender-built dragon (`models/dragon.glb`) and drives its animations; `js/dragon.js` is the code-built fallback and owns the skin shader.
- `tools/blender/`: Blender scripts that build `models/dragon.glb` and `models/creatures.glb` (see `docs/graphics-roadmap.md`). `?dragon=classic` uses the code-built dragon and creatures.
- `js/game.js`: renderer and bloom, the frame loop, collisions, puzzles, achievements and saving.
- `js/audio.js`: synthesized wind, score, whale song, chimes, bell and thunder (no audio files).
- `js/main.js`: title screen, HUD, journal and map, settings, theme, install, analytics and the support callout.

## Credits

Rock, cliff, grass, bark and leaf photo textures are from [ambientCG](https://ambientcg.com) (Rock051, Rock030, Grass004, Bark014, LeafSet009), released under CC0. They live in `tex/`; the tree atlas combines the bark with leaf clumps built from LeafSet009. Everything else (models, terrain, sound) is generated in code.

Includes Google Analytics (G-YW31K785WW) with events for game start, achievements, keys, wonders, the ending and installs; a privacy note under the ⓘ button; and the Reformed Retrieval support heart.
