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
- **Cloud flicker fixed**: the cloud raymarch is blended with the previous frame (reprojected and clamped to stop ghosting), so its dither no longer shimmers. Frame-to-frame change in a still view fell about 12 times.
- **Blender tree kit**: `tools/blender/build_trees.py` models broadleaf and fir trees (two variants each) with buttress roots, forking limbs and leaf-cluster cards, and renders `tex/leaves.png` from modelled leaves (broadleaf, conifer spray, weeping frond, bark patch). Forest patches near the camera use the full trees; the rest use a light far version. `?trees=classic` brings back the old trees.
- **Rock de-tiling**: the cliff texture lookups are warped by low-frequency noise, the large layer is rotated against the small one and their mix wanders, so the repeat grid no longer shows.
- **Ground cover**: `build_trees.py` also renders `tex/undergrowth.png` (grass tufts, ferns, flowers, low bushes). Clumps are scattered over grassy level ground, built per patch near the camera, and shrink into the ground at the edge of their range (Medium 220 m, High 320 m, Ultra 480 m, none on Low).
- **Rock kit**: `tools/blender/build_rocks.py` makes chiselled boulders and hanging shards (`models/rocks.glb`, near and far versions). Mossy boulders sit half-sunk on island tops; dark crags hang from the undersides. They use the island material and take the island's colour where they sit.
- **Island shadows**: the 16 nearest islands block the sun as soft discs (`ISLAND_SHADOW_GLSL` in `js/gfx.js`), shading the sea of clouds (flat deck and volumetric) and the dragon, which dims smoothly when it flies under an island. Hanging shards use a material with the direct sun taken away. Not applied to the land 12 km below, where the shadows blur out and cost ~2 ms.
- **Rock**: island cliffs get irregular noise-based rock beds (an earlier ruled-line version was removed), warm and cool patches, and a ragged grass line with darker soil where grass meets rock.

## Performance (smooth first, then pretty)
- **One full-screen pass**: clouds, haze, sun shafts, bloom, tone mapping and the grade are combined in `js/post.js`; the clouds, shafts and bloom are computed at reduced size.
- **Detail levels**: hanging vines have a light distant version and vanish far away; every island has a coarse copy for distance, also used for the horizon giants. Triangles per frame at the busiest view fell from about 24 million to 1.7 million.
- **Tuned during loading**: shaders are compiled and textures uploaded before play, then a short benchmark picks the best quality and resolution that leave room for 60 fps (`_calibrate` in `js/game.js`). In flight, dynamic resolution lowers or raises the render size to hold the frame rate, and only drops effects if that isn't enough.
- A browser drawing without the graphics card (software rendering) is detected and the player is told to turn on hardware acceleration.

## Next, in order
1. **Compress the models** (`dragon.glb` 2.6 MB, `creatures.glb` 1.7 MB) with meshopt or Draco. Needs a tool such as gltf-transform installed from npm.
2. **Physically based sky scattering**, replacing the colour-key sky dome.
3. **Island shadows on vines and creatures** under the islands, using the same disc test.

## Blender
Blender 5.2 is installed from the Microsoft Store. Store apps can't be run directly, so `tools/blender/run.ps1` starts it through the `blender-launcher` alias and reads the script's own log (`tools/blender/last.log`).
