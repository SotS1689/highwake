# Highwake graphics roadmap

Direction: painterly-cinematic, 60 fps on desktops and good laptops, with lower tiers for weaker machines.

## Done
- `js/cinematic.js`: sun shafts (high/ultra) and a time-of-day colour grade with split toning, vignette, grain and speed fringing (medium and up).
- **Blender dragon**: `tools/blender/build_dragon.py` builds the dragon (26k vertices, 34-bone rig, glide/flap/brake clips) into `models/dragon.glb`, loaded by `js/dragonModel.js`. It reuses the game's scale/membrane shader through per-vertex `_glow`/`_skin` attributes. The spine bends procedurally into turns. `?dragon=classic` brings back the code-built dragon.
  Rebuild: `powershell -File tools/blender/run.ps1 tools/blender/build_dragon.py --render` (previews land in `tools/blender/renders/`).

- **Blender creatures**: `tools/blender/build_creatures.py` sculpts the sky whale (head tubercles, throat pleats, long knobbly pectorals, notched flukes), the sky ray, the skyling and the lantern-jelly into `models/creatures.glb` (1.7 MB). The meshes carry the attributes the existing creature shaders animate, so the swimming, flapping, glow and instancing are unchanged. `?dragon=classic` also brings back the code-built creatures.

- **Volumetric clouds and haze** (`js/volclouds.js`, high/ultra): the sea of clouds is raymarched as a real slab from the same cloud field as before, using the scene's depth, so you can skim it, fly through it and look up at it from below. The same pass adds low-lying haze that thickens toward the deck and warms toward the sun. Medium and low keep the flat deck.
- **Waterfalls**: streaks that stretch as the water accelerates, a glassy lip, foam, sun glints, ragged edges tearing into strands, and spray particles peeling off each fall.
- **Wind**: trees, vines and glow-plants sway in rolling gusts, and leaves flutter (`addWind` in `js/gfx.js`).

## Next, in order
1. **Compress the models** (`dragon.glb` 2.6 MB, `creatures.glb` 1.7 MB) with meshopt or Draco. Needs a tool such as gltf-transform installed from npm.
2. **A rock-and-root kit** from Blender for island undersides.
3. **Physically based sky scattering**, replacing the colour-key sky dome.
4. **Temporal smoothing** for the cloud raymarch, to remove the fine dither when flying inside clouds.

## Blender
Blender 5.2 is installed from the Microsoft Store. Store apps can't be run directly, so `tools/blender/run.ps1` starts it through the `blender-launcher` alias and reads the script's own log (`tools/blender/last.log`).
