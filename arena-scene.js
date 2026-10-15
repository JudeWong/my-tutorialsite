/* Real scanned scenery and CC0 rigged characters. Source credits are bundled
 * beside the assets. Geometry generated below is limited to terrain and VFX. */
import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { Canvas, useFrame, useThree } from "https://esm.sh/@react-three/fiber@8.17.10?deps=react@18.3.1,react-dom@18.3.1,three@0.160.0";
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?deps=three@0.160.0";
import { RGBELoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/RGBELoader.js?deps=three@0.160.0";
import { clone as cloneSkeleton } from "https://esm.sh/three@0.160.0/examples/jsm/utils/SkeletonUtils.js?deps=three@0.160.0";

const h = React.createElement;
const BASE = "./assets/models/apocalypse/";
const ASSETS = {
  vanguard: "vanguard.glb", sentinel: "sentinel.glb",
  barrier: "barrier.glb", car: "covered-car.glb", tyre: "tyre.glb", barrel: "barrel.glb", fence: "fence.glb", gate: "fence-gate.glb",
  sky: "burnt-warehouse.hdr", background: "warehouse-background.jpg", floor: "ground-diffuse.jpg", normal: "ground-normal.jpg", roughness: "ground-roughness.jpg"
};
const modelCache = new Map();
function getModel(file) {
  if (!modelCache.has(file)) {
    modelCache.set(file, new GLTFLoader().loadAsync(BASE + file).catch((error) => { modelCache.delete(file); throw error; }));
  }
  return modelCache.get(file);
}

function useModel(file, report) {
  const [asset, setAsset] = useState(null);
  useEffect(() => {
    let alive = true;
    getModel(file).then((loaded) => {
      if (!alive) return;
      const scene = cloneSkeleton(loaded.scene);
      scene.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = true;
        object.receiveShadow = true;
        object.frustumCulled = !object.isSkinnedMesh;
      });
      setAsset({ scene, animations: loaded.animations });
      report?.(file, "ready");
    }).catch(() => { if (alive) report?.(file, "error"); });
    return () => { alive = false; };
  }, [file, report]);
  return asset;
}

function ScannedProp({ file, position, rotation = [0, 0, 0], width, height, report }) {
  const asset = useModel(file, report);
  const fit = useMemo(() => {
    if (!asset) return null;
    asset.scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(asset.scene);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = height ? height / size.y : width / Math.max(size.x, size.z);
    return { scale, offset: [-center.x * scale, -bounds.min.y * scale, -center.z * scale] };
  }, [asset, width, height]);
  if (!fit) return null;
  return h("group", { position, rotation }, h("primitive", { object: asset.scene, scale: fit.scale, position: fit.offset, dispose: null }));
}

function Fighter({ file, position, facing, action, report, muzzle }) {
  const asset = useModel(file, report);
  const root = useRef();
  const [visibleAction, setVisibleAction] = useState(action);
  const mixer = useRef(null);
  const clips = useRef({});
  const current = useRef(null);
  useEffect(() => {
    if (action !== "hit") { setVisibleAction(action); return; }
    setVisibleAction("idle");
    const contact = setTimeout(() => setVisibleAction("hit"), 800);
    return () => clearTimeout(contact);
  }, [action]);
  const fit = useMemo(() => {
    if (!asset) return null;
    asset.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(asset.scene);
    const center = box.getCenter(new THREE.Vector3());
    const height = box.getSize(new THREE.Vector3()).y;
    const scale = 2.65 / Math.max(.01, height);
    return { scale, offset: [-center.x * scale, -box.min.y * scale, -center.z * scale] };
  }, [asset]);
  useEffect(() => {
    if (!asset) return;
    const animationMixer = new THREE.AnimationMixer(asset.scene);
    mixer.current = animationMixer;
    muzzle.current = asset.scene.getObjectByName("Muzzle");
    clips.current = Object.fromEntries(asset.animations.map((clip) => [clip.name.toLowerCase(), animationMixer.clipAction(clip)]));
    current.current = null;
    return () => { muzzle.current = null; animationMixer.stopAllAction(); animationMixer.uncacheRoot(asset.scene); };
  }, [asset]);
  useEffect(() => {
    const name = visibleAction === "hit" ? "hit" : visibleAction === "attack" ? "attack" : visibleAction === "victory" ? "victory" : "idle";
    const next = clips.current[name] || clips.current.idle;
    if (!next || current.current === next) return;
    const previous = current.current;
    next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
    if (name === "attack" || name === "hit") { next.setLoop(THREE.LoopOnce, 1); next.clampWhenFinished = true; }
    else { next.setLoop(THREE.LoopRepeat, Infinity); next.clampWhenFinished = false; }
    next.play();
    if (previous) next.crossFadeFrom(previous, .18, false);
    current.current = next;
  }, [asset, visibleAction]);
  useFrame((_, delta) => {
    mixer.current?.update(Math.min(delta, .05));
    if (root.current) {
      const target = action === "attack" ? Math.sign(facing) * 1.48 : action === "victory" ? .12 * Math.sign(facing) : facing;
      root.current.rotation.y = THREE.MathUtils.damp(root.current.rotation.y, target, 9, delta);
    }
  });
  if (!asset || !fit) return null;
  return h("group", { ref: root, position, rotation: [0, facing, 0] },
    h("primitive", { object: asset.scene, scale: fit.scale, position: fit.offset, dispose: null })
  );
}

function WorldLighting({ report }) {
  const { gl, scene } = useThree();
  useEffect(() => {
    let alive = true;
    let environment;
    let panorama;
    let lighting;
    const generator = new THREE.PMREMGenerator(gl);
    new RGBELoader().load(BASE + ASSETS.sky, (texture) => {
      if (!alive) { texture.dispose(); return; }
      lighting = texture;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      environment = generator.fromEquirectangular(texture);
      scene.environment = environment.texture;
      report(ASSETS.sky, "ready");
    }, undefined, () => { if (alive) report(ASSETS.sky, "error"); });
    new THREE.TextureLoader().load(BASE + ASSETS.background, (texture) => {
      if (!alive) { texture.dispose(); return; }
      panorama = texture;
      texture.mapping = THREE.EquirectangularReflectionMapping;
      texture.colorSpace = THREE.SRGBColorSpace;
      scene.background = texture;
      scene.backgroundBlurriness = 0;
      scene.backgroundIntensity = .72;
      report(ASSETS.background, "ready");
    }, undefined, () => { if (alive) report(ASSETS.background, "error"); });
    return () => {
      alive = false;
      scene.environment = null; scene.background = null;
      environment?.dispose(); lighting?.dispose(); panorama?.dispose(); generator.dispose();
    };
  }, [gl, scene, report]);
  return h(React.Fragment, null,
    h("fog", { attach: "fog", args: ["#373d40", 12, 38] }),
    h("hemisphereLight", { intensity: .75, color: "#c5d7dc", groundColor: "#5e4835" }),
    h("directionalLight", { position: [-4, 7, 5], intensity: 3.1, color: "#ffdfb2", castShadow: true,
      "shadow-mapSize-width": 1024, "shadow-mapSize-height": 1024, "shadow-camera-left": -8, "shadow-camera-right": 8,
      "shadow-camera-top": 8, "shadow-camera-bottom": -6, "shadow-normalBias": .04 }),
    h("directionalLight", { position: [4, 4, -5], intensity: 2, color: "#b5d2e4" }),
    h("pointLight", { position: [-5, 1.3, -3], color: "#f19950", intensity: 14, distance: 8 }),
    h("pointLight", { position: [5, 1.3, -2], color: "#76a9b6", intensity: 9, distance: 8 })
  );
}

function Terrain({ report }) {
  const [maps, setMaps] = useState(null);
  useEffect(() => {
    let alive = true;
    const loader = new THREE.TextureLoader();
    const textures = [];
    Promise.all([ASSETS.floor, ASSETS.normal, ASSETS.roughness].map((file, index) => loader.loadAsync(BASE + file).then((texture) => {
      textures.push(texture);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(8, 8);
      texture.anisotropy = 4;
      if (index === 0) texture.colorSpace = THREE.SRGBColorSpace;
      if (alive) report(file, "ready");
      return texture;
    }).catch(() => { if (alive) report(file, "error"); return null; }))).then((loaded) => {
      if (alive) setMaps(loaded);
      else textures.forEach((texture) => texture.dispose());
    });
    return () => { alive = false; textures.forEach((texture) => texture.dispose()); };
  }, [report]);
  return h("mesh", { rotation: [-Math.PI / 2, 0, .16], position: [0, -.035, -2], receiveShadow: true },
    h("planeGeometry", { args: [45, 45] }),
    h("meshStandardMaterial", { color: maps?.[0] ? "#b7aaa0" : "#555550", map: maps?.[0], normalMap: maps?.[1], roughnessMap: maps?.[2], roughness: .93, metalness: .04, normalScale: [.65, .65] })
  );
}

function Wasteland({ report }) {
  return h("group", null,
    h(Terrain, { report }),
    h(ScannedProp, { file: ASSETS.car, position: [-5.6, 0, -3.7], rotation: [0, .48, 0], width: 4.4, report }),
    h(ScannedProp, { file: ASSETS.barrier, position: [-3.2, 0, -3.9], rotation: [0, -.12, 0], width: 2.15, report }),
    h(ScannedProp, { file: ASSETS.barrier, position: [3.5, 0, -4.2], rotation: [0, .22, 0], width: 2.15, report }),
    h(ScannedProp, { file: ASSETS.barrier, position: [5.8, 0, -.7], rotation: [0, 1.35, 0], width: 2.15, report }),
    [-5, -2.5, 2.5, 5].map((x) => h(ScannedProp, { key: x, file: ASSETS.fence, position: [x, 0, -6], rotation: [0, x > 0 ? -.05 : .05, 0], width: 2.5, report })),
    h(ScannedProp, { file: ASSETS.gate, position: [0, 0, -6], width: 2.5, report }),
    h(ScannedProp, { file: ASSETS.barrel, position: [-4.3, .39, -1.5], rotation: [0, .35, Math.PI / 2], height: 1.15, report }),
    h(ScannedProp, { file: ASSETS.barrel, position: [4.3, 0, -2.7], rotation: [0, 1.6, 0], height: 1.15, report }),
    h(ScannedProp, { file: ASSETS.barrel, position: [5.1, 0, -3.6], rotation: [0, .8, 0], height: 1.05, report }),
    h(ScannedProp, { file: ASSETS.tyre, position: [-3.6, .12, 1], rotation: [Math.PI / 2, 0, -.7], width: .86, report }),
    h(ScannedProp, { file: ASSETS.tyre, position: [4.4, 0, .3], rotation: [0, .35, 0], width: .84, report }),
    h(ScannedProp, { file: ASSETS.tyre, position: [-4.8, .13, -.6], rotation: [Math.PI / 2, 0, 1.8], width: .9, report })
  );
}

function Dust() {
  const points = useRef();
  const positions = useMemo(() => {
    let seed = 21;
    const random = () => ((seed = seed * 16807 % 2147483647) - 1) / 2147483646;
    return Float32Array.from({ length: 80 * 3 }, (_, i) => i % 3 === 1 ? .3 + random() * 5 : (random() - .5) * 17);
  }, []);
  useFrame(({ clock }) => { if (points.current) { points.current.rotation.y = clock.elapsedTime * .012; points.current.position.y = Math.sin(clock.elapsedTime * .3) * .2; } });
  return h("points", { ref: points }, h("bufferGeometry", null, h("bufferAttribute", { attach: "attributes-position", args: [positions, 3] })), h("pointsMaterial", { color: "#d4c8ab", size: .035, opacity: .4, transparent: true, depthWrite: false }));
}

function CombatEffects({ side, action, powerup, x, muzzle }) {
  const shot = useRef();
  const impact = useRef();
  const power = useRef();
  const elapsed = useRef(99);
  const origin = useMemo(() => new THREE.Vector3(), []);
  const target = useMemo(() => new THREE.Vector3(), []);
  const direction = side === "left" ? 1 : -1;
  const color = side === "left" ? "#ffc16f" : "#8ed9e8";
  useEffect(() => { elapsed.current = 0; }, [action]);
  useFrame(({ clock }, delta) => {
    elapsed.current += Math.min(delta, .05);
    const time = elapsed.current;
    if (shot.current) {
      shot.current.visible = action === "attack" && time > .48 && time < .88;
      const flight = THREE.MathUtils.clamp((time - .48) / .4, 0, 1);
      if (muzzle.current) muzzle.current.getWorldPosition(origin);
      else origin.set(-direction * (x - .6), 1.65, .3);
      target.set(direction * x, 1.55, 0);
      shot.current.position.lerpVectors(origin, target, flight);
      shot.current.scale.set(1.2, .08 + Math.sin(flight * Math.PI) * .07, .08);
    }
    if (impact.current) {
      const contact = time - .8;
      impact.current.visible = action === "hit" && contact >= 0 && contact < .9;
      impact.current.scale.setScalar(.3 + Math.max(0, contact) * .65);
      impact.current.rotation.z = Math.max(0, contact) * 2;
      impact.current.children.forEach((child) => { if (child.material) child.material.opacity = Math.max(0, .9 - Math.max(0, contact)); });
    }
    if (power.current) {
      power.current.rotation.y = clock.elapsedTime * .7;
      power.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 5) * .04);
    }
  });
  const powerColors = { shield: "#78e0d0", heal: "#89f5ae", freeze: "#8bdaff", mask: "#c3a6ef" };
  return h("group", null,
    h("mesh", { ref: shot, visible: false, position: [0, 1.65, .3] }, h("sphereGeometry", { args: [.36, 12, 8] }), h("meshBasicMaterial", { color, transparent: true, opacity: .9, blending: THREE.AdditiveBlending })),
    h("group", { ref: impact, visible: false, position: [-direction * x, 1.55, .35] },
      Array.from({ length: 12 }, (_, index) => h("mesh", { key: index, position: [Math.sin(index * 2.4) * .6, Math.cos(index * 2.4) * .6, 0], rotation: [0, 0, index * 2.4] }, h("planeGeometry", { args: [.025, .25] }), h("meshBasicMaterial", { color: "#ffe9bc", transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending })))
    ),
    powerup ? h("group", { ref: power, position: [-direction * x, 1.35, 0] },
      h("mesh", null, h("sphereGeometry", { args: [1, 24, 16] }), h("meshBasicMaterial", { color: powerColors[powerup], transparent: true, opacity: powerup === "mask" ? .18 : .09, depthWrite: false, blending: THREE.AdditiveBlending, wireframe: powerup === "freeze" })),
      [.35, .75, 1.12].map((radius, index) => h("mesh", { key: radius, rotation: [Math.PI / 2, 0, index], position: [0, index * .45 - .7, 0] }, h("torusGeometry", { args: [radius, .018, 5, 40] }), h("meshBasicMaterial", { color: powerColors[powerup], transparent: true, opacity: .8, blending: THREE.AdditiveBlending })))
    ) : null
  );
}

function Composition({ leftAction, rightAction, leftPowerup, rightPowerup, winner, winnerSide, report }) {
  const { camera, size } = useThree();
  const mobile = size.width / size.height < 1.4;
  const x = mobile ? 1.55 : 2.05;
  const leftMuzzle = useRef(null);
  const rightMuzzle = useRef(null);
  useEffect(() => {
    const aspect = Math.max(.4, size.width / size.height);
    const horizontalFit = 5.2 / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * aspect);
    const distance = Math.max(mobile ? 8.3 : 8, horizontalFit);
    camera.position.set(0, 3.25, distance);
    camera.lookAt(0, 1.25, -.35);
    camera.updateProjectionMatrix();
  }, [camera, mobile, size.width, size.height]);
  return h(React.Fragment, null,
    h(WorldLighting, { report }), h(Wasteland, { report }), h(Dust),
    h(Fighter, { file: ASSETS.vanguard, position: [-x, 0, 0], facing: .95, action: leftAction, report, muzzle: leftMuzzle }),
    h(Fighter, { file: ASSETS.sentinel, position: [x, 0, 0], facing: -.95, action: rightAction, report, muzzle: rightMuzzle }),
    h(CombatEffects, { side: "left", action: leftAction, powerup: leftPowerup, x, muzzle: leftMuzzle }),
    h(CombatEffects, { side: "right", action: rightAction, powerup: rightPowerup, x, muzzle: rightMuzzle }),
    winner ? h("pointLight", { position: [winnerSide === "right" ? x : -x, 3.5, 1], color: "#ffe2a4", intensity: 12, distance: 5 }) : null
  );
}

export function ApocalypseArena(props) {
  const [assets, setAssets] = useState({});
  const [attempt, setAttempt] = useState(0);
  const report = useMemo(() => (file, status) => setAssets((current) => current[file] === status ? current : { ...current, [file]: status }), [attempt]);
  const expected = Object.values(ASSETS);
  const readyCount = expected.filter((file) => assets[file] === "ready").length;
  const failed = expected.filter((file) => assets[file] === "error");
  const ready = readyCount === expected.length;
  const progress = Math.round(readyCount / expected.length * 100);
  return h("div", { className: "apocalypse-renderer" },
    h(Canvas, { key: attempt, shadows: true, camera: { position: [0, 3.25, 8], fov: 40, near: .1, far: 80 },
      dpr: [1, 1.35], gl: { antialias: true, powerPreference: "high-performance" }, className: "arena-canvas",
      onCreated: ({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.12; gl.shadowMap.type = THREE.PCFSoftShadowMap; }
    }, h(Composition, { ...props, report })),
    h("div", { className: "apocalypse-vignette", "aria-hidden": "true" }),
    !ready ? h("div", { className: `apocalypse-loading${failed.length ? " has-error" : ""}`, role: "status" },
      h("span", { className: "apocalypse-loading-symbol", "aria-hidden": "true" }, "◈"),
      h("strong", null, failed.length ? "部分场景资源未能加载" : "正在进入废土竞技场"),
      h("small", null, failed.length ? "请检查网络后重试，比赛分数不会被重置。" : `装甲战士与扫描场景 · ${progress}%`),
      h("div", { className: "apocalypse-loading-track" }, h("i", { style: { width: `${progress}%` } })),
      failed.length ? h("button", { className: "arena-primary-button", onClick: () => { setAssets({}); setAttempt((value) => value + 1); } }, "重新加载场景") : null
    ) : null
  );
}
