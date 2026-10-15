import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const scene = await readFile(resolve(root, "arena-scene.js"), "utf8");
const files = [...scene.match(/const ASSETS = \{([\s\S]+?)\n\};/)[1].matchAll(/:\s*"([^"]+)"/g)].map((match) => match[1]);
let total = 0;
for (const name of files) {
  const path = resolve(root, "assets/models/apocalypse", name);
  const bytes = await readFile(path);
  total += (await stat(path)).size;
  if (!name.endsWith(".glb")) continue;
  assert.equal(bytes.toString("ascii", 0, 4), "glTF", `${name}: GLB magic`);
  assert.equal(bytes.readUInt32LE(4), 2, `${name}: GLB version`);
  assert.equal(bytes.readUInt32LE(8), bytes.length, `${name}: complete GLB download`);
  const json = JSON.parse(bytes.toString("utf8", 20, 20 + bytes.readUInt32LE(12)));
  assert.ok(json.meshes.length > 0 && json.materials.length > 0, `${name}: modeled/materialled asset`);
  assert.ok(json.images.length > 0, `${name}: embedded source texture maps`);
  assert.ok(json.images.every((image) => image.bufferView !== undefined && !image.uri), `${name}: no remote texture dependency`);
  assert.ok(json.buffers.every((buffer) => !buffer.uri), `${name}: no missing external mesh buffer`);
  assert.ok(!json.extensionsRequired?.some((extension) => /compression|meshopt/i.test(extension)), `${name}: no runtime decoder dependency`);
  if (["vanguard.glb", "sentinel.glb"].includes(name)) {
    assert.ok(json.skins[0].joints.length > 20, `${name}: articulated character skeleton`);
    for (const clip of ["Idle", "Attack", "Hit", "Victory", "Walk", "Run"]) {
      const animation = json.animations.find((entry) => entry.name === clip);
      assert.ok(animation?.channels.length > 5, `${name}: skeletal ${clip} animation`);
    }
    assert.ok(json.nodes.some((node) => node.name === "Muzzle"), `${name}: weapon muzzle attached to skeleton`);
    assert.ok(json.materials.every((material) => material.pbrMetallicRoughness?.metallicRoughnessTexture && material.occlusionTexture && material.normalTexture), `${name}: Blender PBR/occlusion/normal maps preserved`);
    assert.ok(json.meshes.every((mesh) => mesh.primitives.every((primitive) => primitive.attributes.TANGENT !== undefined)), `${name}: baked tangent vectors for normal maps`);
  }
  if (name === "temple-arena.glb") {
    assert.match(json.asset.generator, /Blender/, "environment exported by Blender");
    assert.equal(json.scenes?.length, 1, "temple exported as a single active scene");
    assert.ok(!json.nodes.some((node) => /^Cube(?:\.\d+)?$/.test(node.name ?? "")), "template startup cube is not bundled");
    for (const prefix of ["Temple_Central_Floor", "Temple_Carved_Pillars", "Temple_Ruined_Gateway", "Temple_Stone_Stairs", "Temple_Cliff", "Temple_Golden_Foliage"]) {
      assert.ok(json.meshes.some((mesh) => mesh.name?.startsWith(prefix)), `${prefix}: modeled temple component included`);
    }
    const floors = json.meshes.filter((mesh) => mesh.name?.startsWith("Temple_Central_Floor"));
    for (const floor of floors) {
      for (const primitive of floor.primitives) {
        assert.ok(primitive.attributes.TEXCOORD_0 !== undefined, `${floor.name}: tiled floor UVs preserved`);
        const material = json.materials[primitive.material];
        assert.ok(material.pbrMetallicRoughness?.baseColorTexture && material.pbrMetallicRoughness?.metallicRoughnessTexture && material.normalTexture, `${floor.name}: textured PBR floor, not a flat-color placeholder`);
      }
    }
    let triangles = 0;
    for (const mesh of json.meshes) {
      for (const primitive of mesh.primitives) {
        assert.equal(primitive.mode ?? 4, 4, `${mesh.name}: triangle geometry`);
        const positions = json.accessors[primitive.attributes.POSITION];
        assert.ok(positions.count > 0 && positions.min?.every(Number.isFinite) && positions.max?.every(Number.isFinite), `${mesh.name}: finite nonempty geometry bounds`);
        assert.ok(primitive.attributes.NORMAL !== undefined, `${mesh.name}: surface normals preserved`);
        const count = json.accessors[primitive.indices ?? primitive.attributes.POSITION].count;
        assert.equal(count % 3, 0, `${mesh.name}: complete triangles`);
        triangles += count / 3;
      }
    }
    assert.ok(triangles >= 1000, "temple includes modeled architectural and landscape detail");
    assert.ok(triangles <= 200000, `temple ${triangles} triangles exceeds mobile geometry budget`);
    console.log(`PASS temple geometry: ${triangles.toLocaleString()} triangles`);
  }
  if (name.startsWith("fence")) {
    assert.ok(json.materials.some((material) => material.alphaMode === "MASK"), `${name}: chainlink transparency preserved`);
  }
  console.log(`PASS ${name}: complete textured GLB`);
}
assert.ok(total < 16 * 1024 * 1024, `arena payload ${total} exceeds mobile budget`);
assert.ok(!scene.includes("kaykit"), "old cartoon character paths removed");
const webCopy = await readFile(resolve(root, "scripts/sync-web.mjs"), "utf8");
assert.ok(webCopy.includes('"arena-scene.js"'), "scene module included in site/APK builds");
console.log(`PASS ${files.length} assets, ${(total / 1024 / 1024).toFixed(2)} MiB total`);
