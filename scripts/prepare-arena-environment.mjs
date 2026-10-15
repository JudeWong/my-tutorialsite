/**
 * Rebuild the arena's CC0 Poly Haven assets without adding runtime dependencies.
 *
 * Usage:
 *   node scripts/prepare-arena-environment.mjs --tools <tool-package-directory>
 *
 * The tool directory must contain, or resolve, these optional build packages:
 * @gltf-transform/core, @gltf-transform/extensions, @gltf-transform/functions,
 * meshoptimizer, sharp. The original build used 4.5.1, 4.5.1, 4.5.1, 1.3.0,
 * and 0.35.5 respectively. Do not add these to the website's dependencies.
 *
 * Optional: --sources <download-cache-directory> --output <output-directory>
 * Source licenses and authors: assets/models/apocalypse/ENVIRONMENT.md.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? '' : args[index + 1] || '';
};
if (!option('--tools')) {
  throw new Error('Specify --tools with the directory containing the optional asset-build packages.');
}
const requireTool = createRequire(path.join(path.resolve(option('--tools')), 'package.json'));
const importTool = (name) => import(pathToFileURL(requireTool.resolve(name)).href);
const [{ NodeIO }, { ALL_EXTENSIONS }, { dedup, prune, weld, simplify, getBounds }, { MeshoptSimplifier }, sharpModule] = await Promise.all([
  importTool('@gltf-transform/core'),
  importTool('@gltf-transform/extensions'),
  importTool('@gltf-transform/functions'),
  importTool('meshoptimizer'),
  importTool('sharp'),
]);
const sharp = sharpModule.default;
const sourceRoot = path.resolve(option('--sources') || path.join(repoRoot, '.temp/arena-environment-source'));
const outputRoot = path.resolve(option('--output') || path.join(repoRoot, 'assets/models/apocalypse'));
await fs.mkdir(sourceRoot, { recursive: true });
await fs.mkdir(outputRoot, { recursive: true });

async function fetchResponse(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`Asset download failed (${response.status}): ${url}`);
  return response;
}

async function download(asset, filename) {
  const digest = (buffer) => createHash('md5').update(buffer).digest('hex');
  try {
    const cached = await fs.readFile(filename);
    if (asset.md5 && digest(cached) === asset.md5) return;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const bytes = Buffer.from(await (await fetchResponse(asset.url)).arrayBuffer());
  if (asset.md5 && digest(bytes) !== asset.md5) throw new Error(`Source checksum mismatch: ${asset.url}`);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, bytes);
}

const apiCache = new Map();
async function filesFor(id) {
  if (!apiCache.has(id)) apiCache.set(id, (await fetchResponse(`https://api.polyhaven.com/files/${id}`)).json());
  return apiCache.get(id);
}

const specs = [
  { id: 'concrete_road_barrier_02', output: 'barrier', ratio: 0.3 },
  { id: 'covered_car', output: 'covered-car', ratio: 0.8 },
  { id: 'old_tyre', output: 'tyre' },
  { id: 'Barrel_01', output: 'barrel' },
  { id: 'modular_chainlink_fence', output: 'fence', keep: ['modular_chainlink_fence_double'] },
  {
    id: 'modular_chainlink_fence', output: 'fence-gate', ratio: 0.4,
    keep: ['modular_chainlink_fence_door_latch', 'modular_chainlink_fence_door_gate', 'modular_chainlink_fence_door_frame'],
  },
];

await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const spec of specs) {
  const asset = (await filesFor(spec.id)).gltf['1k'].gltf;
  const sourceFolder = path.join(sourceRoot, spec.id);
  const sourceGltf = path.join(sourceFolder, `${spec.id}.gltf`);
  await download(asset, sourceGltf);
  await Promise.all(Object.entries(asset.include).map(([relative, file]) => {
    const filename = path.resolve(sourceFolder, relative);
    if (!filename.startsWith(`${sourceFolder}${path.sep}`)) throw new Error('Unexpected asset path.');
    return download(file, filename);
  }));

  const document = await io.read(sourceGltf);
  // Poly Haven's JPEG glTF export omits the wire's alpha channel. Restore it
  // from the separately published opacity map so fences have visible holes.
  if (spec.id === 'modular_chainlink_fence') {
    const opacityFile = path.join(sourceFolder, 'wire-opacity.png');
    await download((await filesFor(spec.id)).wire_opacity['1k'].png, opacityFile);
    const opacity = await sharp(opacityFile).extractChannel(0).png().toBuffer();
    for (const material of document.getRoot().listMaterials()) {
      if (material.getName() !== 'modular_chainlink_fence_wire') continue;
      const texture = material.getBaseColorTexture();
      texture.setImage(await sharp(texture.getImage()).joinChannel(opacity).png().toBuffer())
        .setMimeType('image/png');
      material.setAlphaMode('MASK').setAlphaCutoff(0.45);
    }
  }
  if (spec.keep) {
    for (const node of document.getRoot().listNodes()) {
      if (!spec.keep.includes(node.getName())) node.dispose();
    }
  }
  await document.transform(prune(), dedup(), weld());
  if (spec.ratio) {
    await document.transform(simplify({ simplifier: MeshoptSimplifier, ratio: spec.ratio, error: 0.001 }));
  }
  for (const texture of document.getRoot().listTextures()) {
    const alpha = (await sharp(texture.getImage()).metadata()).hasAlpha;
    const resized = sharp(texture.getImage())
      .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true });
    const bytes = await (alpha ? resized.png({ compressionLevel: 9 }) : resized.jpeg({ quality: 82, mozjpeg: true })).toBuffer();
    texture.setImage(bytes).setMimeType(alpha ? 'image/png' : 'image/jpeg');
  }
  const scene = document.getRoot().getDefaultScene() || document.getRoot().listScenes()[0];
  const bounds = getBounds(scene);
  const center = [(bounds.min[0] + bounds.max[0]) / 2, bounds.min[1], (bounds.min[2] + bounds.max[2]) / 2];
  const wrapper = document.createNode('GroundedAsset').setTranslation(center.map((n) => -n));
  for (const node of scene.listChildren()) wrapper.addChild(node);
  scene.addChild(wrapper);
  await document.transform(prune(), dedup());
  const filename = path.join(outputRoot, `${spec.output}.glb`);
  await io.write(filename, document);
  let triangles = 0;
  for (const mesh of document.getRoot().listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      triangles += (primitive.getIndices()?.getCount() || primitive.getAttribute('POSITION').getCount()) / 3;
    }
  }
  console.log(JSON.stringify({
    file: path.basename(filename), bytes: (await fs.stat(filename)).size, triangles,
    dimensions: bounds.max.map((n, index) => Number((n - bounds.min[index]).toFixed(3))),
  }));
}

await download((await filesFor('burnt_warehouse')).hdri['1k'].hdr, path.join(outputRoot, 'burnt-warehouse.hdr'));
const backgroundSource = path.join(sourceRoot, 'burnt-warehouse-tonemapped-source.jpg');
await download((await filesFor('burnt_warehouse')).tonemapped, backgroundSource);
await sharp(backgroundSource).resize(4096, 2048, { fit: 'fill' }).jpeg({ quality: 60, mozjpeg: true })
  .toFile(path.join(outputRoot, 'warehouse-background.jpg'));
const groundFiles = await filesFor('damaged_concrete_floor');
for (const [name, sourceName] of [['diffuse', 'Diffuse'], ['normal', 'nor_gl'], ['roughness', 'Rough']]) {
  const sourceFile = path.join(sourceRoot, `ground-${name}-source.jpg`);
  await download(groundFiles[sourceName]['1k'].jpg, sourceFile);
  await sharp(sourceFile).jpeg({ quality: name === 'normal' ? 90 : 82, mozjpeg: true })
    .toFile(path.join(outputRoot, `ground-${name}.jpg`));
}
console.log(`Prepared CC0 environment assets in ${outputRoot}`);
