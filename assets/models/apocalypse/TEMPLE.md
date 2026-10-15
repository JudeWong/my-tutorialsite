# Golden temple arena

The active website scene is `temple-arena.glb`, an original Blender-authored environment inspired by the arrangement, ruin architecture and autumn vegetation of [Battle Arena by serrage](https://sketchfab.com/3d-models/battle-arena-43407d63d82343bead4ce8972e5617c9). The reference model was viewed in its public viewer. Its geometry and textures were **not downloaded, extracted or redistributed**. This is an interpretation, not the original model or an exact replica.

## Editable scene and production export

`scripts/build-temple-arena.py` builds a new scene in Blender 5.2, preserving the existing scene. It was opened and executed through Blender's graphical Text Editor using computer-use. Repeated architectural elements and plants are generated with Blender Python; this is not a claim of individually hand-sculpting every stone.

The scene includes beveled/chipped courtyard slabs, segmented limestone borders, stairs on four sides, tapered carved pillars, a layered ruin gateway, irregular rock formations, branches, folded three-dimensional leaves, climbing ivy, grass and scattered debris. Static geometry is batched by semantic component and material to reduce browser draw calls.

The central combat lane is kept clear. The platform surface is Blender Z=0 (Three.js Y=0). The exported GLB is already in world-space alignment; do not recenter or automatically rescale it. Existing characters, animations and gameplay remain separate.

Open the script in Blender's Scripting workspace and choose **Run Script**. Local outputs are `.temp/research/temple-arena/temple-arena.blend`, the production GLB, and `build-result.json`. The `.blend` packs its textures. Use F12 for the showcase camera render. The script does not automatically render, quit Blender, or modify student data.

## Licensed surface and sky sources

The following photographic textures and panorama are from Poly Haven under [CC0 1.0](https://polyhaven.com/license). Original downloads were checked against hashes published by Poly Haven's metadata API on 2026-10-15.

| Use | Source | Author |
| --- | --- | --- |
| Stone diffuse, OpenGL normal and roughness | [Mossy Sandstone](https://polyhaven.com/a/mossy_sandstone) | Dimitrios Savva |
| Floor diffuse, OpenGL normal and roughness | [Monastery Stone Floor](https://polyhaven.com/a/monastery_stone_floor) | Amal Kumar |
| `temple-golden-hour.hdr`, `temple-sky.jpg` | [Autumn Park](https://polyhaven.com/a/autumn_park) | Sergej Majboroda |

The HDR filename is an art-direction label; its actual source is **Autumn Park**, an afternoon park panorama. Six optimized stone/floor maps total 1,078,745 bytes before GLB packaging: 1024-pixel color/normal and 512-pixel roughness. The HDR is 1,547,785 bytes; the 2048×1024 background JPEG is 256,739 bytes. Original files and metadata are retained under `.temp/research/temple-arena/textures/`.

Materials export real UVs, base-color textures, roughness and normal maps, plus vertex colors for architectural shading and foliage. The web renderer uses Three.js/React Three Fiber with dynamic shadows and HDR reflections. Browser lighting is real-time and is not pixel-identical to a Blender Cycles render. The former warehouse scene and its licenses remain in this folder for rollback but are not loaded by the new scene.
