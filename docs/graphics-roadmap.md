# Highwake graphics roadmap

Direction: painterly-cinematic, 60 fps on desktops and good laptops, with lower tiers for weaker machines.

## Done
- `js/cinematic.js`: sun shafts (high/ultra) and a time-of-day colour grade with split toning, vignette, grain and speed fringing (medium and up).
- **Blender dragon**: `tools/blender/build_dragon.py` builds the dragon (26k vertices, 34-bone rig, glide/flap/brake clips) into `models/dragon.glb`, loaded by `js/dragonModel.js`. It reuses the game's scale/membrane shader through per-vertex `_glow`/`_skin` attributes. The spine bends procedurally into turns. `?dragon=classic` brings back the code-built dragon.
  Rebuild: `powershell -File tools/blender/run.ps1 tools/blender/build_dragon.py --render` (previews land in `tools/blender/renders/`).

- **Blender creatures**: `tools/blender/build_creatures.py` sculpts the sky whale (head tubercles, throat pleats, long knobbly pectorals, notched flukes), the sky ray, the skyling and the lantern-jelly into `models/creatures.glb` (1.7 MB). The meshes carry the attributes the existing creature shaders animate, so the swimming, flapping, glow and instancing are unchanged. `?dragon=classic` also brings back the code-built creatures.

## Next, in order
1. **More Blender assets**: a rock-and-root kit for island undersides. Compress `dragon.glb` (2.6 MB) and `creatures.glb` with meshopt/Draco.
2. **Volumetric clouds**: raymarched cloud deck at quarter resolution, replacing the billboard puffs (high/ultra only).
3. **Atmosphere**: physically based sky scattering with aerial perspective, so distant islands haze toward the sky colour correctly.
4. **Foliage**: wind-animated grass cards and instanced Blender trees with LODs.
5. **Water and falls**: flow-mapped waterfalls with mist particles.

## Blender
Blender 5.2 is installed from the Microsoft Store. Store apps can't be run directly, so `tools/blender/run.ps1` starts it through the `blender-launcher` alias and reads the script's own log (`tools/blender/last.log`).
