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
- **Sharper trees**: the leaf atlases are rendered at 2048 px with smaller, smooth-shaded, cupped leaves and soft antialiased edges (no more hard on/off alpha). The foliage shader keeps edges crisp at any distance (alpha-to-coverage), boosts alpha with the mip level so far leaves don't thin out, and fades cards seen edge-on so they don't smear. Vines and the great tree's crown use the new atlas; far firs have two tiers of cards, near firs a fuller upper crown.
- **Grown trees**: broadleaf trees in `build_trees.py` now branch for real (trunk with an S-curve and root flare, limbs, branches, twigs) with crossed leaf clumps at the twig ends; firs carry dense whorls of small sprays. Each tree gets a leaf tint from a painterly palette (greens, olive, sage, the odd gold or russet tree), shared by neighbours so forests read as patches (`leafTint` in `js/islands.js`).
- **Leaf translucency**: all foliage lets sunlight through: backlit leaves glow warmer and deeper, and the shaded side of a clump still picks up light (`foliageMaterial` in `js/gfx.js`).
- **The Worldtree** (`_worldtree` in `js/landmarks.js`): six stems braid into one column and flow without seams into sweeping limbs; forks peel off with collars; the crown is grown from ~700 branches carrying leaf clumps (no solid cores), pale silver-jade with lavender; roots crawl over the rim and hang hundreds of metres into the sky; cyan veins, glowing root tips, lantern-fruit and tendrils at night.
- **Dragon's air** (`DRAGON_WAKE_GLSL` in `js/gfx.js`, fed by `_dragonAir` in `js/game.js`): trees, vines and ground cover within ~100 m lean away from the dragon's path and are dragged along behind it, springing back a second after it passes; each wing downstroke rolls a ring of air outward that bows the canopy below and makes leaves flutter hard. It is a few extra shader operations per plant vertex in the existing wind shader (cost not yet measured), and plants more than ~300 m away skip it. The background breeze is lighter, with a quick shiver over the slow sway.
- **Blossoms** (`js/blossoms.js`): the near trees carry closed flowers on the outside of their crowns (read off each tree's leaf cards: 30 per broadleaf, 16 per fir). As the dragon comes within ~240 m they burst open in a staggered, overshooting pop, fully open within ~110 m, and fold away after it passes. Five-petalled flowers drawn into a canvas texture, coloured in the shader from a fantastical palette (magenta, coral, gold, violet, cyan, pearl), slightly self-lit by day and glowing at night. Closed flowers are zero-size, so they cost almost nothing.
- **Floating motes** (`js/motes.js`): pollen by day and glowing cyan spores by night drift around the camera near islands; one GPU-animated point cloud that wraps around the camera.
- **Island shadows**: the 16 nearest islands block the sun as soft discs (`ISLAND_SHADOW_GLSL` in `js/gfx.js`), shading the sea of clouds (flat deck and volumetric) and the dragon, which dims smoothly when it flies under an island. Hanging shards use a material with the direct sun taken away. Not applied to the land 12 km below, where the shadows blur out and cost ~2 ms.
- **Rock**: island cliffs get irregular noise-based rock beds (an earlier ruled-line version was removed), warm and cool patches, and a ragged grass line with darker soil where grass meets rock.

## Performance (smooth first, then pretty)
- **One full-screen pass**: clouds, haze, sun shafts, bloom, tone mapping and the grade are combined in `js/post.js`; the clouds, shafts and bloom are computed at reduced size.
- **Detail levels**: hanging vines have a light distant version and vanish far away; every island has a coarse copy for distance, also used for the horizon giants. Triangles per frame at the busiest view fell from about 24 million to 1.7 million.
- **Tuned during loading**: shaders are compiled and textures uploaded before play, then a short benchmark picks the best quality and resolution that leave room for 60 fps (`_calibrate` in `js/game.js`). In flight, dynamic resolution lowers or raises the render size to hold the frame rate, and only drops effects if that isn't enough.
- **Regular PCs and laptops (integrated graphics)**: measured on a Ryzen 5700G's built-in Radeon. The cost was triangles first, then pixels:
  - `buildParts` (`js/gfx.js`) keeps shared corners (indexed geometry), so the graphics card works each corner out once instead of 3 to 6 times.
  - The Worldtree (over a million triangles, once drawn in full from any distance) has three versions, picked by distance in `Landmarks.lod`: full, a middle one (half the leaf cards, larger; light wood) and a far one (a fifth of the cards as flat quads).
  - Skyling flocks, lantern-jellies and sky rays have simple far versions (`js/creatures.js`); a far flock fell from 450,000 triangles to about 13,000.
  - Detailed vines and rocks are built per cell near the camera (`NearSwap` in `js/islands.js`) instead of for a whole island at once, and the number of detailed trees is capped per quality level (nearest first).
  - The canvas has no anti-aliasing of its own (it cost about 40% of the frame on Low); Medium also goes without (about 25%). High and Ultra keep theirs.
  - The loading benchmark also times a forest close-up, the dearest view per pixel, and Low may now run at full resolution.
  - Result on that PC, 1025x768: Low went from 12-17 ms a frame (at 3/4 resolution) to 5-8 ms (at full resolution); the benchmark now picks Medium where it picked Low.
- **Smooth leaves without the cost (the tricks big games use)**:
  - Temporal anti-aliasing (`TAAPass` in `js/post.js`): the camera is nudged a fraction of a pixel each frame and frames are blended, so cut-out leaf edges and distant forest come out smooth. It replaces multisampling on every level but Ultra. Pixels near the dragon follow the dragon's own motion so it doesn't smear.
  - Sharpened upscale: the canvas stays at screen size; only the scene is drawn smaller (dynamic resolution), and the final pass stretches it up with a sharpening filter instead of the browser's blurry stretch.
  - Low now gets the same bloom, colour grade and haze as the rest (they cost little); distance haze is on at every level.
  - Painted depth: foliage is lighter on top of a crown and darker beneath (`foliageMaterial`), the ground under trees is darkened once at load (`shadeUnderTrees` in `js/islands.js`), far leaves are read from a blurrier copy of the texture, and neighbouring trees share colours more, so distant forest reads as masses rather than speckle.
  - Focus: the running average is read with a sharp (Catmull-Rom) filter and leans on the new frame when moving; textures are read from a sharper copy than usual (`uLodBias` in `js/gfx.js`), more so when the scene is drawn small; the benchmark gives up effects before resolution and dynamic resolution stops at 55%.
  - Half the trees, each about a quarter larger (`js/mesher.js`), with detailed trees reaching about 45% further and ground cover on Low.
  - Leaves stay crisp in the wind: foliage marks its pixels (alpha 0 in the scene image) and the frame blending keeps mostly the new frame there, since it only knows the camera's motion, not the wind's. Bad pixels (overflow, not-a-number) are kept out of the running average.
  - A quarter of the original trees, each about a third larger; detailed trees reach 320 m (Low) to 1000 m (Ultra).
  - Island rock and grass: triplanar projections that add under 5% are skipped (about a third of the texture lookups), anisotropy 4. The sky dome and the land far below are drawn after the islands, so hidden pixels of them are never shaded.
  - Not yet measured on a quiet machine: the last timings were taken while something else was using the graphics card.
- A browser drawing without the graphics card (software rendering) is detected and the player is told to turn on hardware acceleration.

## Next, in order
1. **Compress the models** (`dragon.glb` 2.6 MB, `creatures.glb` 1.7 MB) with meshopt or Draco. Needs a tool such as gltf-transform installed from npm.
2. **Physically based sky scattering**, replacing the colour-key sky dome.
3. **Island shadows on vines and creatures** under the islands, using the same disc test.
4. **Tree impostors** (pictures of each tree from many angles) for mid distance, if the far forest needs more depth; with the alpha fixes the card trees hold up well for now.

## Blender
Blender 5.2 is installed from the Microsoft Store. Store apps can't be run directly, so `tools/blender/run.ps1` starts it through the `blender-launcher` alias and reads the script's own log (`tools/blender/last.log`).
