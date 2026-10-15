# Armored arena characters

The Vanguard and Sentinel GLB files derive from **Sci-fi soldier** by **Irondust**.

- Creator/source: https://opengameart.org/content/sci-fi-soldier
- Original download: https://opengameart.org/sites/default/files/Sci-fi%20Soldiers.zip
- Source license: **CC0 1.0 Universal**, https://creativecommons.org/publicdomain/zero/1.0/
- Retrieved: 2026-10-15. The source page explicitly lists CC0; no account was required.

The original contains a skinned humanoid, three helmets, a modeled cannon hand,
and three PBR texture sets. Vanguard uses Head1 / FederalSoldierSkin; Sentinel
uses Head3 / MilitarySkin. Textures were resized to 1024 pixels and converted
in Blender 4.2 from the source Unity Specular/Gloss workflow to glTF
Metallic-Roughness. The packed ORM map keeps source Occlusion in red,
reconstructed Roughness in green, and per-pixel Metallic response in blue;
normal and emission maps remain lossless. This preserves matte fabric, painted
armor, and reflective cannon parts as different materials instead of assigning
one metallic value to the whole character. Unused heads/right-hand
alternatives were removed.

The original rig contains no animation clips. `Idle`, `Attack`, `Hit`, `Victory`,
`Walk`, and `Run` are new skeletal placeholder animations authored in
`scripts/prepare-arena-characters.py`. They articulate the existing rig and are
not claimed to be motion capture. The model faces +Z in glTF and its feet lie
at approximately y=0. Original standing height is approximately 2 meters.

The cannon is skinned to `forearm.R`. An empty node named `Muzzle` follows that
bone for muzzle flashes/projectile origin. GLBs embed all textures and require
no external model host. The character appearance, geometry and source textures
remain available under CC0; the project-authored conversion and animations are
also released under CC0 1.0.

## Runtime budget

The conversion is reproducible with `blender --background --factory-startup
--python scripts/prepare-arena-characters.py`; the script also renders an
AgX/Cycles material check against the burnt-warehouse HDR.

| Asset | Triangles | Embedded texture size | File size |
| --- | ---: | --- | ---: |
| Vanguard | 2,891 | Four embedded 1024 x 1024 maps | 2,523,228 bytes |
| Sentinel | 3,447 | Four embedded 1024 x 1024 maps | 2,846,500 bytes |

Normal and ORM PNGs use lossless adaptive filtering and retain 1024-pixel
detail; no palette quantization is used. All meshes export tangent vectors for
consistent normal mapping on mobile GPUs. Combined character download size is
5.12 MiB. The extra texture data is intentional: the previous three-map export
omitted source AO and specular/gloss response entirely.

Both assets have 63 bones and limit skinning to the four largest normalized
weights per vertex. Clip lengths: Idle 2.8s, Attack 1.333s, Hit 1s, Victory 2.4s,
Walk 1.2s, Run 0.733s. Attack reaches its firing pose approximately 0.5s in.
The exported GLBs were re-imported and rendered to verify skinning, all six
clips, heads, embedded materials, full-body framing and the cannon.
Material comparison renders used identical Blender 4.2 Cycles lighting,
48 samples with denoising, AgX Medium High Contrast, the warehouse HDR at
strength 0.45, and an 800 x 1000 camera. Both final GLBs pass Khronos glTF
validation with zero errors; informational rig hierarchy warnings remain for
the intentionally parented skinned meshes and the empty muzzle marker.
