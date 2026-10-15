/*
 * Live 1v1 quiz arena.
 *
 * The shell remains vanilla HTML so it works inside the existing website and
 * APK. The battle canvas itself is intentionally isolated in React Three
 * Fiber, loaded from ESM CDN URLs, and uses the project's GLB characters.
 */
import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { createPortal } from "https://esm.sh/react-dom@18.3.1";
import { Canvas, useFrame, useThree } from "https://esm.sh/@react-three/fiber@8.17.10?deps=react@18.3.1,react-dom@18.3.1,three@0.160.0";
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?deps=three@0.160.0";
import { readTournament, buildTournamentView } from "./battle-engine.js";

const h = React.createElement;
const MODEL_PATHS = {
  // KayKit's CC0 Adventurers are complete, lightweight GLB characters (not
  // primitive placeholders). They have a consistent Rig_Medium skeleton and
  // read much better as a knight-versus-mage battle pair on mobile screens.
  warrior: "./assets/models/kaykit-knight.glb",
  mage: "./assets/models/kaykit-mage.glb"
};
const ROOM_STORAGE_KEY = "personal-ai-battle-room";
const ROUND_SECONDS = 10;
const COMBAT_ACTION_MS = 1800;
const POWERUP_EFFECT_MS = 5000;
const DEBUFF_SECONDS = 4;
const POWERUP_ORDER = ["shield", "heal", "freeze", "mask"];
const POWERUPS = Object.freeze({
  shield: { icon: "◈", name: "保护罩", description: "抵挡下一次攻击" },
  heal: { icon: "✚", name: "血包", description: "立即恢复 20 点生命" },
  freeze: { icon: "❄", name: "冻结", description: "对手下一回合冻结 4 秒" },
  mask: { icon: "◉", name: "遮罩", description: "对手下一回合视线受阻 4 秒" }
});

function rewardForStreak(streak) {
  return streak >= 3 ? POWERUP_ORDER[(streak - 3) % POWERUP_ORDER.length] : "";
}

function loadGlb(path, onLoad, onError) {
  const loader = new GLTFLoader();
  loader.load(path, (gltf) => onLoad(gltf), undefined, onError);
}

function ModelLoadingMarker({ color = "#63e6be", failed = false }) {
  const group = useRef();
  useFrame(({ clock }) => {
    if (!group.current) return;
    group.current.rotation.y = clock.elapsedTime * 1.7;
    group.current.position.y = 0.05 + Math.sin(clock.elapsedTime * 3) * 0.035;
  });
  return h("group", { ref: group },
    h("mesh", { position: [0, 0.08, 0], rotation: [-Math.PI / 2, 0, 0], receiveShadow: true }, h("ringGeometry", { args: [0.55, 0.68, 32] }), h("meshBasicMaterial", { color, transparent: true, opacity: 0.8 })),
    h("mesh", { position: [0, 0.55, 0], castShadow: true }, h("icosahedronGeometry", { args: [0.25, 1] }), h("meshStandardMaterial", { color: failed ? "#ff8b8b" : color, emissive: failed ? "#8c1d1d" : color, emissiveIntensity: 0.5 }))
  );
}

function FighterWeapon({ kind, direction, action }) {
  const weapon = useRef();
  const glow = kind === "staff" ? "#9b7bff" : "#ffc86b";
  useFrame(({ clock }, delta) => {
    if (!weapon.current) return;
    const attacking = action === "attack";
    const swing = attacking ? 1 + Math.sin(clock.elapsedTime * 15) * 0.16 : 0.25;
    weapon.current.rotation.z = THREE.MathUtils.damp(weapon.current.rotation.z, -direction * swing, 12, delta);
    weapon.current.position.y = THREE.MathUtils.damp(weapon.current.position.y, attacking ? 1.26 : 1.35, 10, delta);
  });
  const sword = h(React.Fragment, null,
    h("mesh", { position: [0, -0.2, 0], castShadow: true }, h("cylinderGeometry", { args: [0.055, 0.065, 0.38, 12] }), h("meshStandardMaterial", { color: "#4b2e1e", roughness: 0.65 })),
    h("mesh", { position: [0, 0.02, 0], castShadow: true }, h("boxGeometry", { args: [0.42, 0.07, 0.1] }), h("meshStandardMaterial", { color: "#c99b42", metalness: 0.8, roughness: 0.24 })),
    h("mesh", { position: [0, 0.56, 0], castShadow: true }, h("boxGeometry", { args: [0.13, 1.02, 0.065] }), h("meshStandardMaterial", { color: "#d9e0e8", metalness: 0.95, roughness: 0.16, emissive: "#37445a", emissiveIntensity: action === "attack" ? 0.85 : 0.1 })),
    h("mesh", { position: [0, 1.17, 0], rotation: [0, 0, Math.PI] }, h("coneGeometry", { args: [0.09, 0.25, 4] }), h("meshStandardMaterial", { color: "#edf3f8", metalness: 0.95, roughness: 0.12 }))
  );
  const staff = h(React.Fragment, null,
    h("mesh", { position: [0, 0.28, 0], castShadow: true }, h("cylinderGeometry", { args: [0.045, 0.065, 1.55, 12] }), h("meshStandardMaterial", { color: "#3b241b", roughness: 0.8 })),
    h("mesh", { position: [0, 1.12, 0], castShadow: true }, h("octahedronGeometry", { args: [0.22, 0] }), h("meshStandardMaterial", { color: "#bba8ff", emissive: glow, emissiveIntensity: action === "attack" ? 3.2 : 1.3, metalness: 0.1, roughness: 0.18 })),
    h("pointLight", { position: [0, 1.12, 0.15], color: glow, intensity: action === "attack" ? 7 : 2, distance: 3 })
  );
  return h("group", { ref: weapon, position: [direction * 0.72, 1.35, 0.18], rotation: [0.05, 0, -direction * 0.25] }, kind === "staff" ? staff : sword);
}

function GlbCharacter({ path, color, action, direction = 1, weapon = "sword" }) {
  const group = useRef();
  const [gltf, setGltf] = useState(null);
  const [failed, setFailed] = useState(false);
  const mixer = useRef(null);
  const actions = useRef([]);
  const [fit, setFit] = useState({ scale: 1, position: [0, 0, 0] });
  useEffect(() => {
    let alive = true;
    setFailed(false);
    setGltf(null);
    loadGlb(path, (loaded) => { if (alive) setGltf(loaded); }, () => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [path]);
  useEffect(() => {
    if (!gltf?.scene) return;
    gltf.scene.traverse((object) => {
      if (object.isMesh) {
        object.castShadow = true;
        object.receiveShadow = true;
      }
    });
    // GLB files often use different authoring scales. Fit the real model to
    // the same arena height and ground it so it cannot render off-camera.
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const height = Number.isFinite(size.y) && size.y > 0.01 ? size.y : 1.8;
    const scale = 2.65 / height;
    const position = [
      Number.isFinite(center.x) ? -center.x * scale : 0,
      Number.isFinite(box.min.y) ? -box.min.y * scale : 0,
      Number.isFinite(center.z) ? -center.z * scale : 0
    ];
    setFit({ scale, position });
  }, [gltf]);
  useEffect(() => {
    if (!gltf?.scene) return undefined;
    mixer.current = new THREE.AnimationMixer(gltf.scene);
    actions.current = (gltf.animations || []).map((clip) => mixer.current.clipAction(clip));
    if (actions.current[0]) actions.current[0].play();
    return () => mixer.current?.stopAllAction();
  }, [gltf]);
  useEffect(() => {
    if (!actions.current.length) return;
    const names = (gltf?.animations || []).map((clip) => clip.name.toLowerCase());
    const patterns = {
      idle: [/idle/, /standing/, /t-pose/],
      attack: [/punch/, /attack/, /run/, /walk/],
      hit: [/death/, /hurt/, /sad/, /no/, /t-pose/],
      victory: [/thumb/, /yes/, /victory/, /dance/, /idle/]
    }[action] || [/idle/];
    const preferred = patterns.map((pattern) => names.findIndex((name) => pattern.test(name))).find((index) => index >= 0);
    const selected = actions.current[preferred >= 0 ? preferred : 0] || actions.current[0];
    actions.current.forEach((item) => item.stop());
    selected.reset().fadeIn(0.12).play();
    return () => selected.fadeOut(0.16);
  }, [action, gltf]);
  useFrame(({ clock }, delta) => {
    mixer.current?.update(delta);
    if (!group.current) return;
    // KayKit's character meshes are intentionally lightweight and do not ship
    // with battle-specific clips. These short procedural moves are the
    // fallback animation: lunge for an attack, stagger/fall for a hit, and
    // settle back to idle without affecting the real GLB proportions.
    const pulse = Math.sin(clock.elapsedTime * 18) * 0.025;
    const rotationTarget = direction * (action === "attack" ? -0.22 : action === "hit" ? 1.05 : 0);
    const movementTarget = direction * (action === "attack" ? 0.22 + pulse : action === "hit" ? -0.16 : 0);
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, rotationTarget, 7, delta);
    group.current.position.x = THREE.MathUtils.damp(group.current.position.x, movementTarget, 9, delta);
    const heightTarget = action === "hit" ? -0.13 : action === "victory" ? 0.08 + Math.abs(Math.sin(clock.elapsedTime * 5)) * 0.05 : 0;
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, heightTarget, 7, delta);
  });
  if (failed || !gltf?.scene) return h(ModelLoadingMarker, { color, failed });
  return h("group", { ref: group },
    h("primitive", { object: gltf.scene, scale: fit.scale, position: fit.position, dispose: null }),
    h(FighterWeapon, { kind: weapon, direction, action })
  );
}

function AttackEffect({ side, action, kind }) {
  const effect = useRef();
  const material = useRef();
  const elapsed = useRef(99);
  useEffect(() => { if (action === "attack") elapsed.current = 0; }, [action]);
  useFrame((_, delta) => {
    if (!effect.current) return;
    elapsed.current += delta;
    const duration = kind === "magic" ? 0.85 : 0.65;
    const t = elapsed.current / duration;
    effect.current.visible = action === "attack" && t <= 1;
    if (!effect.current.visible) return;
    const direction = side === "left" ? 1 : -1;
    effect.current.position.x = direction * (-1.45 + Math.min(1, t) * 3.05);
    effect.current.position.y = 1.35 + Math.sin(Math.min(1, t) * Math.PI) * (kind === "magic" ? 0.42 : 0.18);
    effect.current.rotation.z += delta * direction * 8;
    const scale = 0.68 + Math.sin(Math.min(1, t) * Math.PI) * 0.45;
    effect.current.scale.setScalar(scale);
    if (material.current) material.current.opacity = Math.max(0, 1 - t);
  });
  const color = kind === "magic" ? "#a78bfa" : "#ffd27a";
  return h("group", { ref: effect, visible: false, position: [0, 1.35, 0.5] },
    kind === "magic"
      ? h("mesh", null, h("icosahedronGeometry", { args: [0.22, 1] }), h("meshStandardMaterial", { ref: material, color: "#e1d7ff", emissive: color, emissiveIntensity: 4.5, transparent: true, opacity: 1 }))
      : h("mesh", { rotation: [0.12, 0, 0.25] }, h("torusGeometry", { args: [0.42, 0.055, 8, 32, Math.PI * 1.45] }), h("meshBasicMaterial", { ref: material, color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending })),
    h("pointLight", { color, intensity: kind === "magic" ? 12 : 7, distance: 3.5 })
  );
}

function ImpactEffect({ side, action, color }) {
  const burst = useRef();
  const elapsed = useRef(99);
  useEffect(() => { if (action === "hit") elapsed.current = 0; }, [action]);
  useFrame((_, delta) => {
    if (!burst.current) return;
    elapsed.current += delta;
    const t = elapsed.current / 0.8;
    burst.current.visible = action === "hit" && t <= 1;
    if (!burst.current.visible) return;
    burst.current.rotation.z += delta * 4;
    burst.current.scale.setScalar(0.25 + t * 1.35);
    burst.current.traverse((object) => {
      if (object.material) object.material.opacity = Math.max(0, 1 - t);
    });
  });
  const fragments = Array.from({ length: 9 }, (_, index) => {
    const angle = (index / 9) * Math.PI * 2;
    return h("mesh", { key: index, position: [Math.cos(angle) * 0.42, Math.sin(angle) * 0.42, 0] }, h("sphereGeometry", { args: [0.055, 8, 8] }), h("meshBasicMaterial", { color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending }));
  });
  return h("group", { ref: burst, visible: false, position: [side === "left" ? -2.05 : 2.05, 1.35, 0.65] },
    h("mesh", null, h("ringGeometry", { args: [0.22, 0.3, 24] }), h("meshBasicMaterial", { color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending })),
    fragments
  );
}

function PowerupEffect({ side, effect }) {
  const group = useRef();
  const direction = side === "left" ? -1 : 1;
  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    group.current.rotation.y += delta * (effect === "mask" ? 1.8 : 0.9);
    const pulse = 1 + Math.sin(clock.elapsedTime * 7) * 0.08;
    group.current.scale.setScalar(pulse);
  });
  const position = [direction * 2.15, 1.35, 0.15];
  if (effect === "shield") return h("group", { ref: group, position },
    h("mesh", null, h("sphereGeometry", { args: [1.05, 24, 16] }), h("meshPhysicalMaterial", { color: "#71f2d0", emissive: "#2f9d87", emissiveIntensity: 1.2, transparent: true, opacity: 0.2, roughness: 0.15, metalness: 0.25, wireframe: true })),
    h("pointLight", { color: "#6ce9c3", intensity: 5, distance: 3.5 })
  );
  if (effect === "heal") return h("group", { ref: group, position },
    h("mesh", null, h("torusGeometry", { args: [0.68, 0.055, 8, 32] }), h("meshBasicMaterial", { color: "#72f3a4", transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending })),
    h("mesh", { scale: [0.18, 0.62, 0.12] }, h("boxGeometry"), h("meshStandardMaterial", { color: "#d7ffe5", emissive: "#43d67f", emissiveIntensity: 2.5 })),
    h("mesh", { scale: [0.62, 0.18, 0.12] }, h("boxGeometry"), h("meshStandardMaterial", { color: "#d7ffe5", emissive: "#43d67f", emissiveIntensity: 2.5 })),
    h("pointLight", { color: "#65ef9a", intensity: 6, distance: 3.5 })
  );
  if (effect === "freeze") return h("group", { ref: group, position },
    [0.48, 0.72, 0.94].map((radius, index) => h("mesh", { key: `ice-ring-${index}`, rotation: [Math.PI / 2 + index * 0.42, 0, index * 0.55] }, h("torusGeometry", { args: [radius, 0.035, 6, 28] }), h("meshBasicMaterial", { color: "#8be9ff", transparent: true, opacity: 0.82, blending: THREE.AdditiveBlending }))),
    Array.from({ length: 6 }, (_, index) => {
      const angle = (index / 6) * Math.PI * 2;
      return h("mesh", { key: `ice-${index}`, position: [Math.cos(angle) * 0.72, -0.55, Math.sin(angle) * 0.72], rotation: [0, 0, Math.PI] }, h("coneGeometry", { args: [0.11, 0.5, 6] }), h("meshStandardMaterial", { color: "#b9f3ff", emissive: "#4bbada", emissiveIntensity: 1.4, transparent: true, opacity: 0.88 }));
    }),
    h("pointLight", { color: "#75ddff", intensity: 7, distance: 4 })
  );
  return h("group", { ref: group, position },
    h("mesh", null, h("sphereGeometry", { args: [0.92, 20, 14] }), h("meshStandardMaterial", { color: "#1b102c", emissive: "#7f4fc9", emissiveIntensity: 1.1, transparent: true, opacity: 0.48, roughness: 0.85 })),
    [0.62, 0.88, 1.12].map((radius, index) => h("mesh", { key: `mask-ring-${index}`, rotation: [index * 0.52, index * 0.33, 0] }, h("torusGeometry", { args: [radius, 0.025, 6, 30] }), h("meshBasicMaterial", { color: "#bc83ff", transparent: true, opacity: 0.65, blending: THREE.AdditiveBlending }))),
    h("pointLight", { color: "#9a5de8", intensity: 5, distance: 3.5 })
  );
}

function Torch({ position }) {
  const flame = useRef();
  const light = useRef();
  useFrame(({ clock }) => {
    const flicker = 1 + Math.sin(clock.elapsedTime * 10 + position[0]) * 0.12 + Math.sin(clock.elapsedTime * 17) * 0.07;
    if (flame.current) flame.current.scale.set(0.75, flicker, 0.75);
    if (light.current) light.current.intensity = 7.5 * flicker;
  });
  return h("group", { position },
    h("mesh", { position: [0, -0.35, 0], castShadow: true }, h("cylinderGeometry", { args: [0.045, 0.06, 0.9, 10] }), h("meshStandardMaterial", { color: "#2f221d", metalness: 0.45, roughness: 0.55 })),
    h("mesh", { ref: flame, position: [0, 0.2, 0] }, h("coneGeometry", { args: [0.13, 0.42, 10] }), h("meshBasicMaterial", { color: "#ffb14a" })),
    h("pointLight", { ref: light, position: [0, 0.22, 0.3], color: "#ff9b4a", intensity: 8, distance: 7, decay: 2 })
  );
}

function ArenaBanner({ position, color, accent, phase = 0 }) {
  const banner = useRef();
  useFrame(({ clock }) => {
    if (!banner.current) return;
    banner.current.rotation.z = Math.sin(clock.elapsedTime * 0.85 + phase) * 0.018;
  });
  return h("group", { ref: banner, position },
    h("mesh", { position: [0, 0.72, -0.02], castShadow: true }, h("cylinderGeometry", { args: [0.035, 0.035, 1.15, 10] }), h("meshStandardMaterial", { color: "#b89352", metalness: 0.75, roughness: 0.3 })),
    h("mesh", { position: [0, 0, 0], castShadow: true }, h("planeGeometry", { args: [0.9, 1.55] }), h("meshStandardMaterial", { color, roughness: 0.72, metalness: 0.04, side: THREE.DoubleSide })),
    h("mesh", { position: [0, 0.12, 0.025] }, h("ringGeometry", { args: [0.21, 0.28, 6] }), h("meshStandardMaterial", { color: accent, emissive: accent, emissiveIntensity: 0.38, metalness: 0.5, roughness: 0.32, side: THREE.DoubleSide })),
    h("mesh", { position: [0, -0.72, 0] }, h("coneGeometry", { args: [0.46, 0.38, 3] }), h("meshStandardMaterial", { color, roughness: 0.72, side: THREE.DoubleSide }))
  );
}

const CROWD_MEMBERS = Array.from({ length: 30 }, (_, index) => ({
  x: -5.15 + (index % 10) * 1.14,
  y: 2.78 + Math.floor(index / 10) * 0.55,
  scale: 0.72 + (index % 4) * 0.055,
  color: ["#34415d", "#493958", "#304b49", "#5a4238", "#3f3c55"][index % 5]
}));

function ArenaCrowd() {
  const crowd = useRef();
  useFrame(({ clock }) => {
    if (crowd.current) crowd.current.position.y = Math.sin(clock.elapsedTime * 1.8) * 0.025;
  });
  return h("group", { ref: crowd }, CROWD_MEMBERS.map((member, index) => h("group", { key: `crowd-${index}`, position: [member.x, member.y, -3.05], scale: member.scale },
    h("mesh", { position: [0, 0.27, 0], castShadow: false }, h("sphereGeometry", { args: [0.13, 10, 8] }), h("meshStandardMaterial", { color: "#bba995", roughness: 0.92 })),
    h("mesh", null, h("coneGeometry", { args: [0.22, 0.46, 8] }), h("meshStandardMaterial", { color: member.color, roughness: 0.9, emissive: member.color, emissiveIntensity: 0.08 }))
  )));
}

function EmberField() {
  const particles = useRef();
  const positions = useMemo(() => {
    const values = new Float32Array(72 * 3);
    let seed = 19;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    };
    for (let index = 0; index < values.length; index += 3) {
      values[index] = (random() - 0.5) * 10.5;
      values[index + 1] = 0.25 + random() * 4.3;
      values[index + 2] = -3 + random() * 5.5;
    }
    return values;
  }, []);
  useFrame(({ clock }) => {
    if (!particles.current) return;
    particles.current.rotation.y = Math.sin(clock.elapsedTime * 0.12) * 0.08;
    particles.current.position.y = Math.sin(clock.elapsedTime * 0.55) * 0.12;
  });
  return h("points", { ref: particles },
    h("bufferGeometry", null, h("bufferAttribute", { attach: "attributes-position", args: [positions, 3] })),
    h("pointsMaterial", { color: "#ffb45c", size: 0.055, transparent: true, opacity: 0.62, depthWrite: false, blending: THREE.AdditiveBlending })
  );
}

const STONE_BLOCKS = Array.from({ length: 18 }, (_, index) => ({
  x: -5.3 + (index % 6) * 2.12,
  y: 0.55 + Math.floor(index / 6) * 0.88,
  scale: index % 3 === 0 ? 1.06 : 0.98
}));

function StoneArena() {
  return h("group", null,
    h("mesh", { position: [0, -0.28, -0.35], receiveShadow: true }, h("cylinderGeometry", { args: [5.5, 5.8, 0.5, 64] }), h("meshStandardMaterial", { color: "#3b3b3a", roughness: 0.94, metalness: 0.02 })),
    h("mesh", { position: [0, -0.015, -0.35], rotation: [-Math.PI / 2, 0, 0], receiveShadow: true }, h("circleGeometry", { args: [5.25, 64] }), h("meshStandardMaterial", { color: "#58544d", roughness: 0.92, metalness: 0.03 })),
    h("mesh", { position: [0, 0.005, -0.35], rotation: [-Math.PI / 2, 0, 0] }, h("ringGeometry", { args: [2.25, 2.34, 64] }), h("meshStandardMaterial", { color: "#b59456", metalness: 0.48, roughness: 0.38 })),
    h("mesh", { position: [0, 0.018, -0.35], rotation: [-Math.PI / 2, 0, 0] }, h("ringGeometry", { args: [1.15, 1.2, 48] }), h("meshStandardMaterial", { color: "#6ce9c3", emissive: "#257b70", emissiveIntensity: 1.15, transparent: true, opacity: 0.78 })),
    Array.from({ length: 12 }, (_, index) => {
      const angle = (index / 12) * Math.PI * 2;
      return h("mesh", { key: `rune-${index}`, position: [Math.cos(angle) * 1.72, 0.024, -0.35 + Math.sin(angle) * 1.72], rotation: [-Math.PI / 2, 0, -angle] }, h("boxGeometry", { args: [0.24, 0.055, 0.055] }), h("meshStandardMaterial", { color: index % 2 ? "#8d75ff" : "#6ce9c3", emissive: index % 2 ? "#624bd4" : "#247b68", emissiveIntensity: 1.6 }));
    }),
    h("mesh", { position: [0, 1.65, -3.65], receiveShadow: true }, h("boxGeometry", { args: [12, 3.5, 0.45] }), h("meshStandardMaterial", { color: "#292b2d", roughness: 0.97 })),
    STONE_BLOCKS.map((stone, index) => h("mesh", { key: `stone-${index}`, position: [stone.x, stone.y, -3.38], scale: [stone.scale, 1, 1], castShadow: true, receiveShadow: true }, h("boxGeometry", { args: [1.92, 0.72, 0.38] }), h("meshStandardMaterial", { color: index % 2 ? "#4b4a46" : "#55534d", roughness: 0.96 }))),
    [-4.75, 4.75].map((x) => h("group", { key: `pillar-${x}`, position: [x, 0, -2.95] },
      h("mesh", { position: [0, 1.4, 0], castShadow: true, receiveShadow: true }, h("cylinderGeometry", { args: [0.4, 0.52, 2.8, 12] }), h("meshStandardMaterial", { color: "#4a4945", roughness: 0.93 })),
      h("mesh", { position: [0, 2.88, 0], castShadow: true }, h("boxGeometry", { args: [1.05, 0.24, 0.9] }), h("meshStandardMaterial", { color: "#5d5a53", roughness: 0.9 }))
    )),
    [-3.75, -1.25, 1.25, 3.75].map((x, index) => h("mesh", { key: `arch-${x}`, position: [x, 2.25, -3.08], rotation: [0, 0, Math.PI] }, h("torusGeometry", { args: [0.72, 0.11, 8, 24, Math.PI] }), h("meshStandardMaterial", { color: "#777066", roughness: 0.88 }))),
    h(ArenaCrowd),
    h(ArenaBanner, { position: [-2.05, 2.2, -3.02], color: "#294f68", accent: "#6ce9c3", phase: 0 }),
    h(ArenaBanner, { position: [2.05, 2.2, -3.02], color: "#4a3470", accent: "#b79cff", phase: 1.7 }),
    h(Torch, { position: [-3.55, 2.05, -3] }),
    h(Torch, { position: [3.55, 2.05, -3] })
  );
}

function ArenaCamera() {
  const { camera } = useThree();
  useEffect(() => {
    // Three.js otherwise looks at the world origin (the fighters' feet),
    // which crops the upper body and makes the arena appear to show only
    // shoes. Keep the camera target at the model's chest height.
    camera.lookAt(0, 1.3, 0);
    camera.updateProjectionMatrix();
  }, [camera]);
  return null;
}

function ArenaScene({ leftAction, rightAction, leftPowerup, rightPowerup, winner, winnerSide }) {
  return h(Canvas, {
    shadows: true,
    camera: { position: [0, 4.05, 8.7], fov: 38 },
    dpr: [1, 1.45],
    gl: { antialias: true, powerPreference: "high-performance" },
    onCreated: ({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.08; },
    className: "arena-canvas"
  },
    h(ArenaCamera),
    h("color", { attach: "background", args: ["#080a0d"] }),
    h("fog", { attach: "fog", args: ["#080a0d", 7.5, 17] }),
    h("hemisphereLight", { intensity: 0.72, color: "#b9d4ff", groundColor: "#201713" }),
    h("directionalLight", { position: [-3, 7, 5], intensity: 2.3, color: "#d9e7ff", castShadow: true, "shadow-mapSize-width": 1024, "shadow-mapSize-height": 1024 }),
    h("spotLight", { position: [0, 7, 2], intensity: 16, angle: 0.65, penumbra: 0.75, distance: 16, color: "#dce7ff", castShadow: true }),
    h("spotLight", { position: [-5, 4.5, 1], intensity: 7, angle: 0.42, penumbra: 0.9, distance: 12, color: "#5ee7c1" }),
    h("spotLight", { position: [5, 4.5, 1], intensity: 7, angle: 0.42, penumbra: 0.9, distance: 12, color: "#a88bff" }),
    h(StoneArena),
    h(EmberField),
    h("group", { position: [-2.15, 0, 0.1], rotation: [0, 0.3, 0] }, h(GlbCharacter, { path: MODEL_PATHS.warrior, color: "#5ee7c1", action: leftAction, direction: 1, weapon: "sword" })),
    h("group", { position: [2.15, 0, 0.1], rotation: [0, -0.3, 0] }, h(GlbCharacter, { path: MODEL_PATHS.mage, color: "#a88bff", action: rightAction, direction: -1, weapon: "staff" })),
    h(AttackEffect, { side: "left", action: leftAction, kind: "slash" }),
    h(AttackEffect, { side: "right", action: rightAction, kind: "magic" }),
    h(ImpactEffect, { side: "left", action: leftAction, color: "#b79cff" }),
    h(ImpactEffect, { side: "right", action: rightAction, color: "#ffd27a" }),
    leftPowerup ? h(PowerupEffect, { side: "left", effect: leftPowerup }) : null,
    rightPowerup ? h(PowerupEffect, { side: "right", effect: rightPowerup }) : null,
    winner ? h("group", { position: [winnerSide === "right" ? 2.15 : -2.15, 3.05, 0.2] },
      h("mesh", null, h("torusGeometry", { args: [0.75, 0.045, 8, 40] }), h("meshBasicMaterial", { color: "#ffd166" })),
      h("pointLight", { color: "#ffd166", intensity: 7, distance: 5 })
    ) : null
  );
}

function isCorrect(question, answer) {
  if (!question) return false;
  if (question.type === "fill") {
    const normalize = (value) => String(value ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase();
    return (question.acceptedAnswers?.length ? question.acceptedAnswers : [question.correctAnswer]).some((candidate) => normalize(candidate) === normalize(answer));
  }
  return Number(answer) === Number(question.correct);
}

function battleStats(players, events) {
  const stats = new Map(players.map((player) => [player.id, { hp: 100, score: 0, streak: 0, shield: 0, frozenRound: -1, maskedRound: -1, lastReward: "", lastAction: "idle", lastRound: -1 }]));
  let healthEnded = false;
  [...events].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).forEach((event) => {
    if (healthEnded) return;
    const own = stats.get(event.playerId);
    if (!own) return;
    if (event.type === "skill") {
      if (!POWERUPS[event.effect]) return;
      own.lastReward = event.effect;
      if (event.effect === "shield") own.shield += 1;
      if (event.effect === "heal") own.hp = Math.min(100, own.hp + 20);
      if (event.effect === "freeze" || event.effect === "mask") {
        const fallbackTarget = players.find((player) => player.id !== event.playerId);
        const targetId = event.targetPlayerId && stats.has(event.targetPlayerId) ? event.targetPlayerId : fallbackTarget?.id;
        const target = stats.get(targetId);
        if (target) {
          if (event.effect === "freeze") target.frozenRound = Math.max(target.frozenRound, Number(event.round) + 1);
          if (event.effect === "mask") target.maskedRound = Math.max(target.maskedRound, Number(event.round) + 1);
        }
      }
      return;
    }
    if (event.type !== "answer") return;
    own.lastRound = Math.max(own.lastRound, event.round);
    if (event.correct) {
      own.score += 100 + Math.max(0, own.streak) * 25;
      own.streak += 1;
      own.lastAction = "attack";
    } else {
      own.streak = 0;
      own.lastAction = "idle";
    }
    const opponent = players.find((player) => player.id !== event.playerId);
    if (event.correct && opponent && stats.has(opponent.id)) {
      // New events carry the exact target. The fallback keeps old rows made
      // before this column was added compatible with the two-player pairing.
      const targetId = event.targetPlayerId && stats.has(event.targetPlayerId) ? event.targetPlayerId : opponent.id;
      const target = stats.get(targetId);
      if (target.shield > 0) {
        target.shield -= 1;
        target.lastAction = "shield";
      } else {
        const damage = Math.max(1, Number(event.damage) || 20);
        target.hp = Math.max(0, target.hp - damage);
        target.lastAction = "hit";
        if (target.hp <= 0) healthEnded = true;
      }
    }
  });
  return stats;
}

function resolveBattleResult(players, stats, timeLeft) {
  if (players.length < 2) return { ended: false, winner: null, tied: false, reason: "" };
  const left = stats.get(players[0]?.id) || { hp: 100, score: 0 };
  const right = stats.get(players[1]?.id) || { hp: 100, score: 0 };
  const healthEnded = left.hp <= 0 || right.hp <= 0;
  if (!healthEnded && timeLeft > 0) return { ended: false, winner: null, tied: false, reason: "" };

  let winner = null;
  let tied = false;
  if (left.hp <= 0 && right.hp > 0) winner = players[1];
  else if (right.hp <= 0 && left.hp > 0) winner = players[0];
  else if (left.score === right.score) tied = true;
  else winner = left.score > right.score ? players[0] : players[1];
  return { ended: true, winner, tied, reason: healthEnded ? "health" : "time" };
}

function mergeBattleEvents(remoteEvents, localEvents) {
  const merged = new Map();
  [...(remoteEvents || []), ...(localEvents || [])].forEach((event) => {
    // One optimistic local answer and its later Supabase row represent the
    // same move. De-duplicate them before calculating damage.
    const key = [event.roomId || "", event.matchId || "", event.playerId || "", event.round ?? "", event.type || "", event.questionId || "", event.effect || ""].join("|");
    const current = merged.get(key);
    // Prefer the server copy when the optimistic event has already arrived.
    if (!current || (!String(event.id || "").startsWith("local-") && String(current.id || "").startsWith("local-"))) merged.set(key, event);
  });
  return [...merged.values()].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function pairingFromEvents(events, myPlayer) {
  if (!myPlayer) return null;
  const pairing = [...(events || [])].reverse().find((event) => event.playerId === myPlayer.id && event.type === "skill" && String(event.effect || "").startsWith("pairing:"));
  if (!pairing) return null;
  try {
    const stored = JSON.parse(String(pairing.effect).slice("pairing:".length));
    if (!stored.opponentId || !stored.opponentName) return null;
    return {
      playerSide: stored.playerSide === "right" ? "right" : "left",
      opponent: {
        id: stored.opponentId,
        studentId: stored.opponentStudentId || "",
        name: stored.opponentName,
        className: stored.opponentClassName || "",
        roomId: myPlayer.roomId,
        status: "playing",
        virtual: true
      }
    };
  } catch {
    return null;
  }
}

function canonicalBattlePair(players, events, myPlayer, role) {
  if (!players.length) return [];
  if (role !== "student" || !myPlayer) return players.slice(0, 2);

  // battle_players is ordered by joined_at. Keep that order on every device so
  // player one is always the left fighter and player two is always the right.
  const playerIndex = players.findIndex((player) => player.id === myPlayer.id);
  if (players.length > 1 && playerIndex >= 0) {
    const pairStart = playerIndex - (playerIndex % 2);
    return players.slice(pairStart, pairStart + 2);
  }

  // Older Supabase policies may expose only the signed-in player's row. The
  // persisted pairing event supplies both the opponent and the canonical side.
  const pairing = pairingFromEvents(events, myPlayer);
  if (!pairing?.opponent) return [myPlayer];
  return pairing.playerSide === "right"
    ? [pairing.opponent, myPlayer]
    : [myPlayer, pairing.opponent];
}

function buildBattleMatches(players, events, timeLeft) {
  const matches = [];
  for (let index = 0; index < players.length; index += 2) {
    const matchPlayers = players.slice(index, index + 2);
    const playerIds = new Set(matchPlayers.map((player) => player.id));
    const matchEvents = events.filter((event) => playerIds.has(event.playerId));
    const matchStats = battleStats(matchPlayers, matchEvents);
    const left = matchStats.get(matchPlayers[0]?.id) || { hp: 100, score: 0, streak: 0, lastRound: -1 };
    const right = matchStats.get(matchPlayers[1]?.id) || { hp: 100, score: 0, streak: 0, lastRound: -1 };
    const result = resolveBattleResult(matchPlayers, matchStats, timeLeft);
    matches.push({
      number: Math.floor(index / 2) + 1,
      players: matchPlayers,
      stats: [left, right],
      answerCount: matchEvents.filter((event) => event.type === "answer").length,
      currentRound: Math.max(left.lastRound, right.lastRound) + 1,
      finished: result.ended,
      tied: result.tied,
      winner: result.winner,
      reason: result.reason
    });
  }
  return matches;
}

function TeacherPlayerMetric({ player, stat, side, winner }) {
  const lowHealth = stat.hp <= 30;
  const isWinner = winner?.id === player?.id;
  const item = POWERUPS[stat.lastReward];
  return h("div", { className: `arena-monitor-player ${side}${isWinner ? " winner" : ""}` },
    h("div", { className: "arena-monitor-player-head" },
      h("span", { className: "arena-monitor-avatar" }, side === "left" ? "⚔" : "✦"),
      h("div", null,
        h("strong", null, player?.name || "等待玩家"),
        h("small", null, player?.className || "尚未加入")
      )
    ),
    h("div", { className: "arena-monitor-score", "aria-label": `${player?.name || "玩家"} 得分 ${stat.score}` }, h("span", null, "得分"), h("b", null, stat.score), h("span", null, "分")),
    h("div", { className: "arena-monitor-health-label" }, h("span", null, "生命值"), h("strong", null, `${stat.hp}%`)),
    h("div", { className: `arena-monitor-health ${side}${lowHealth ? " danger" : ""}` }, h("i", { style: { width: `${stat.hp}%` } })),
    h("small", { className: "arena-monitor-streak" }, stat.shield > 0 ? `◈ 保护罩 × ${stat.shield}` : item ? `${item.icon} ${item.name} · 连对 ${stat.streak} 题` : stat.streak > 1 ? `连对 ${stat.streak} 题` : "等待连击")
  );
}

function TeacherBattleDashboard({ players = [], events = [], timeLeft = 0, roomStatus, matchList, title = "全班对战总览", lastSynced, compact = false }) {
  const matches = matchList || buildBattleMatches(players, events, timeLeft);
  const finishedCount = matches.filter((match) => match.finished).length;
  const totalAnswers = matches.reduce((sum, match) => sum + match.answerCount, 0);
  return h("section", { className: "arena-teacher-dashboard" },
    !compact ? h("div", { className: "arena-monitor-summary" },
      h("article", null, h("span", null, "对战组数"), h("strong", null, matches.length), h("small", null, `${players.length} 名学生`)),
      h("article", null, h("span", null, "正在进行"), h("strong", null, Math.max(0, matches.length - finishedCount)), h("small", null, roomStatus === "finished" ? "比赛结束" : roomStatus === "battle" ? "实时同步中" : "等待开始")),
      h("article", null, h("span", null, "全班作答"), h("strong", null, totalAnswers), h("small", null, `已完成 ${finishedCount} 组`)),
      h("article", { className: "arena-monitor-clock" }, h("span", null, "本轮剩余"), h("strong", null, finishedCount === matches.length ? "END" : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`), h("small", null, finishedCount === matches.length ? "本轮已结束" : "每轮重新计时"))
    ) : null,
    h("div", { className: "arena-monitor-heading" },
      h("div", null, h("span", { className: "arena-kicker" }, "LIVE SCOREBOARD"), h("h3", null, title)),
      h("p", { role: "status" }, lastSynced ? `最近同步 ${new Date(lastSynced).toLocaleTimeString("zh-CN", { hour12: false })} · 自动更新分数与血量` : "每组得分与血量")
    ),
    h("div", { className: "arena-monitor-grid" }, matches.map((match) => h("article", { className: `arena-monitor-card${match.finished ? " finished" : ""}`, key: match.id || `match-${match.number}` },
      h("header", null,
        h("div", null, h("span", null, match.kind === "final" ? "冠军争夺战" : match.kind === "bronze" ? "季军争夺战" : `对战 ${String(match.number).padStart(2, "0")}`), h("small", null, match.players.length === 1 ? "抽签轮空" : match.currentRound > 0 ? `已进行 ${match.currentRound} 题` : "等待首次作答")),
        h("b", { className: match.finished ? "done" : "live", title: match.winner?.name }, match.finished ? (match.tied ? "平手" : `${match.winner?.name || ""}${match.players.length === 1 ? " 晋级" : " 获胜"}`) : match.started === false ? "即将开始" : "进行中")
      ),
      h("div", { className: "arena-monitor-versus" },
        h(TeacherPlayerMetric, { player: match.players[0], stat: match.stats[0], side: "left", winner: match.winner }),
        h("div", { className: "arena-monitor-vs" }, h("span", null, "VS"), h("small", null, `${match.answerCount} 次作答`)),
        match.players[1] ? h(TeacherPlayerMetric, { player: match.players[1], stat: match.stats[1], side: "right", winner: match.winner }) : h("p", { className: "arena-bye-label" }, "本轮轮空\n直接晋级")
      ),
      match.finished && match.players.length > 1 ? h("p", { className: "arena-match-reason" }, resultDescription(match.reason)) : null
    )))
  );
}

function resultDescription(reason) {
  return ({ health: "生命值归零，本局结束。", time: "时间结束，得分较高者获胜。", hp: "时间结束且同分，以剩余生命值决定胜负。", correct: "同分、同生命值，以答对题数决定胜负。", speed: "同分时，以累计答题用时较短者获胜。", seed: "双方数据完全相同，按赛前随机抽签顺序决定晋级。", bye: "本轮轮空，直接晋级。" })[reason] || "本局已结束，赛果已保存。";
}

function TournamentPodium({ standings }) {
  if (!standings?.length) return null;
  return h("section", { className: "arena-podium", "aria-label": "比赛名次" }, standings.filter((entry) => entry.place >= 1 && entry.place <= 3).map((entry) => h("article", { key: entry.place, className: `place-${entry.place}` },
    h("span", null, ["", "🥇", "🥈", "🥉"][entry.place]),
    h("small", null, ["", "冠军", "亚军", "季军"][entry.place]),
    h("strong", null, entry.player.name),
    h("p", null, `累计得分 ${entry.score} 分`)
  )));
}

function AdvancementPopup({ match, onClose }) {
  const button = useRef(null);
  useEffect(() => {
    const previousFocus = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    button.current?.focus({ preventScroll: true });
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
      if (event.key === "Tab") { event.preventDefault(); button.current?.focus(); }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKey);
      if (previousFocus?.isConnected && previousFocus?.tagName !== "INPUT") previousFocus.focus({ preventScroll: true });
    };
  }, [match.id]);
  const isMedal = match.kind === "final" || match.kind === "bronze";
  return createPortal(h("div", { className: "arena-victory-backdrop" },
    h("section", { role: "dialog", "aria-modal": "true", "aria-labelledby": "arena-victory-title", className: "arena-victory-popup" },
      h("div", { className: "arena-victory-sparkles", "aria-hidden": "true" }, "✦ ✧ ✦"),
      h("span", { className: "arena-victory-medal", "aria-hidden": "true" }, match.kind === "bronze" ? "🥉" : "🏆"),
      h("small", null, isMedal ? "TOURNAMENT RESULT" : "NEXT ROUND UNLOCKED"),
      h("h2", { id: "arena-victory-title" }, match.players.length === 1 ? "恭喜，轮空晋级！" : "恭喜获胜！"),
      h("strong", null, match.winner.name),
      h("p", null, match.kind === "final" ? "你获得了本次淘汰赛的冠军！" : match.kind === "bronze" ? "你获得了本次淘汰赛的季军！" : "成功晋级下一轮！请留在房间，等待老师开始下一轮。"),
      match.players.length === 2 ? h("div", { className: "arena-victory-score" }, `${match.stats[0].score} : ${match.stats[1].score}`) : null,
      h("button", { ref: button, type: "button", className: "arena-primary-button", onClick: onClose }, isMedal ? "查看比赛结果" : "准备下一轮")
    )
  ), document.body);
}

function ArenaApp() {
  const context = globalThis.personalAIAppContext?.() || {};
  const [room, setRoom] = useState(null);
  const [code, setCode] = useState("");
  const [className, setClassName] = useState(context.classes?.[0] || "");
  const [assignmentId, setAssignmentId] = useState(context.assignments?.[0]?.id || "");
  const [roomData, setRoomData] = useState(null);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [answeredRound, setAnsweredRound] = useState("");
  const [localEvents, setLocalEvents] = useState([]);
  const [lastSynced, setLastSynced] = useState(null);
  const [dismissedVictory, setDismissedVictory] = useState("");
  const stopSubscription = useRef(null);
  const pendingRefresh = useRef(null);
  const activeRoomId = useRef(null);
  const sendingAnswer = useRef(false);
  const latestRoomData = useRef(null);

  const cloud = globalThis.personalAICloud;
  const profile = context.profile || {};
  const assignment = context.assignments?.find((item) => item.id === (room?.assignmentId || assignmentId)) || context.assignments?.[0];
  const questions = useMemo(() => {
    const ids = assignment?.questionIds || [];
    return ids.length ? ids.map((id) => context.questions?.find((question) => question.id === id)).filter(Boolean) : context.questions || [];
  }, [assignment, context.questions]);

  const acceptRoomData = (data) => {
    if (!data?.room) return;
    const current = latestRoomData.current;
    if (current?.room.id === data.room.id) {
      const currentStage = readTournament(current.events)?.stageIndex ?? -1;
      const incomingStage = readTournament(data.events)?.stageIndex ?? -1;
      // A read started before a saved move/advancement may finish afterwards.
      // Append-only battle records must not make the displayed score go back.
      if (incomingStage < currentStage || (incomingStage === currentStage && data.events.length < current.events.length)) return;
    }
    latestRoomData.current = data;
    setRoomData(data); setRoom(data.room); setNow(Date.now());
  };
  const refreshRoom = async (roomId = room?.id) => {
    if (!cloud?.enabled || !roomId || !cloud.loadBattleRoom) return;
    if (pendingRefresh.current?.id === roomId) return pendingRefresh.current.promise;
    const promise = cloud.loadBattleRoom(roomId).then((data) => {
      if (activeRoomId.current !== roomId) return data;
      if (!data?.room) throw new Error("房间已不存在，或当前账号没有读取权限。");
      acceptRoomData(data);
      setLastSynced(Date.now());
      setSyncError("");
      setLocalEvents((items) => items.filter((event) => !data.events.some((stored) => stored.id === event.id)));
      return data;
    }).catch((loadError) => {
      if (activeRoomId.current === roomId) setSyncError(loadError.message || "无法同步对战资料，请检查网络。");
      return null;
    }).finally(() => { if (pendingRefresh.current?.promise === promise) pendingRefresh.current = null; });
    pendingRefresh.current = { id: roomId, promise };
    return promise;
  };
  useEffect(() => {
    const saved = localStorage.getItem(ROOM_STORAGE_KEY);
    if (saved && cloud?.enabled) {
      activeRoomId.current = saved;
      void refreshRoom(saved);
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { activeRoomId.current = null; clearInterval(timer); stopSubscription.current?.(); };
  }, []);
  useEffect(() => {
    if (!room?.id) return undefined;
    activeRoomId.current = room.id;
    stopSubscription.current?.();
    stopSubscription.current = cloud.subscribeToBattleRoom?.(room.id, () => { void refreshRoom(room.id); });
    // Realtime may disconnect on mobile/background tabs. A periodic read also
    // catches a missed event and resumes the exact bracket after refresh.
    const poll = setInterval(() => { if (!document.hidden) void refreshRoom(room.id); }, 3000);
    const onFocus = () => { if (!document.hidden) void refreshRoom(room.id); };
    document.addEventListener("visibilitychange", onFocus);
    window.addEventListener("focus", onFocus);
    void refreshRoom(room.id);
    return () => { stopSubscription.current?.(); clearInterval(poll); document.removeEventListener("visibilitychange", onFocus); window.removeEventListener("focus", onFocus); };
  }, [room?.id]);

  const events = mergeBattleEvents(roomData?.events, localEvents);
  const tournament = readTournament(roomData?.events || []);
  const tournamentView = tournament ? buildTournamentView(tournament, events, now) : null;
  const players = tournament?.roster || roomData?.players || [];
  const myPlayer = players.find((player) => player.studentId === profile.id);
  const myMatch = tournamentView?.matches.find((match) => match.players.some((player) => player.id === myPlayer?.id));
  const previousMatches = tournament?.history?.flatMap((stage) => stage.matches) || [];
  const myLastMatch = [...previousMatches].reverse().find((match) => match.players.some((player) => player.id === myPlayer?.id));
  const startTime = tournament?.startedAt || room?.startedAt;
  const battleDeadline = startTime ? new Date(startTime).getTime() + (tournament?.durationSeconds || room?.durationSeconds || 180) * 1000 : 0;
  const scoredEvents = battleDeadline ? events.filter((event) => {
    const eventTime = new Date(event.createdAt || 0).getTime();
    return !eventTime || eventTime <= battleDeadline;
  }) : events;
  const pair = tournament ? myMatch?.players || [] : canonicalBattlePair(players, events, myPlayer, context.role);
  const pairEvents = tournament ? myMatch?.events || [] : scoredEvents.filter((event) => pair.some((player) => player.id === event.playerId));
  const visiblePlayerCount = context.role === "student" ? Math.max(players.length, pair.length) : players.length;
  const stats = myMatch?.statsMap || battleStats(pair, pairEvents);
  const leftStats = stats.get(pair[0]?.id) || { hp: 100, score: 0, streak: 0, lastAction: "idle" };
  const rightStats = stats.get(pair[1]?.id) || { hp: 100, score: 0, streak: 0, lastAction: "idle" };
  const elapsed = startTime ? Math.max(0, now - new Date(startTime).getTime()) : 0;
  const timeLeft = tournamentView ? tournamentView.timeLeft : room?.status === "battle" ? Math.max(0, (room.durationSeconds || 180) - Math.floor(elapsed / 1000)) : room?.durationSeconds || 180;
  const round = room?.status === "battle" ? Math.floor(elapsed / (ROUND_SECONDS * 1000)) : 0;
  const answerKey = `${myMatch?.id || room?.id || ""}:${round}`;
  const roundElapsedSeconds = room?.status === "battle" ? Math.floor(elapsed / 1000) % ROUND_SECONDS : 0;
  const question = questions.length ? questions[(round + (tournament?.stageIndex || 0) * Math.ceil((tournament?.durationSeconds || 180) / ROUND_SECONDS)) % questions.length] : null;
  const result = tournament ? { ended: myMatch?.finished || !myMatch, winner: myMatch?.winner, tied: myMatch?.tied, reason: myMatch?.reason } : resolveBattleResult(pair, stats, timeLeft);
  const winner = result.winner;
  const gameEnded = result.ended;
  const stageStarted = tournamentView ? tournamentView.started && tournament.status !== "finished" : true;
  const myStats = stats.get(myPlayer?.id) || { frozenRound: -1, maskedRound: -1 };
  const freezeActive = !gameEnded && myStats.frozenRound === round && roundElapsedSeconds < DEBUFF_SECONDS;
  const maskActive = !gameEnded && myStats.maskedRound === round && roundElapsedSeconds < DEBUFF_SECONDS;
  const debuffSecondsLeft = Math.max(1, DEBUFF_SECONDS - roundElapsedSeconds);
  const latestPowerup = [...pairEvents].reverse().find((event) => event.type === "skill" && POWERUPS[event.effect]);
  const powerupIsVisible = Boolean(latestPowerup && now - new Date(latestPowerup.createdAt || 0).getTime() <= POWERUP_EFFECT_MS);
  const powerupTargetId = latestPowerup?.targetPlayerId || pair.find((player) => player.id !== latestPowerup?.playerId)?.id;
  const powerupFor = (playerId) => {
    if (!powerupIsVisible || !playerId) return "";
    if (latestPowerup.playerId === playerId) return latestPowerup.effect;
    return ["freeze", "mask"].includes(latestPowerup.effect) && powerupTargetId === playerId ? latestPowerup.effect : "";
  };
  const latestFinishedMatch = [...previousMatches, ...(tournamentView?.matches || [])].filter((match) => match.finished && match.players.some((player) => player.id === myPlayer?.id)).at(-1);
  const latestWin = latestFinishedMatch?.winner?.id === myPlayer?.id ? latestFinishedMatch : null;
  const victoryKey = latestWin ? `${room?.id}:${latestWin.id}` : "";
  const showVictory = context.role === "student" && latestWin && dismissedVictory !== victoryKey
    && sessionStorage.getItem(`arena-victory:${victoryKey}`) !== "seen"
    && !localEvents.some((event) => event.matchId === latestWin.id);
  const closeVictory = () => { sessionStorage.setItem(`arena-victory:${victoryKey}`, "seen"); setDismissedVictory(victoryKey); };

  const createRoom = async () => {
    setError(""); setBusy(true);
    try {
      const data = await cloud.createBattleRoom({ className, assignmentId });
      activeRoomId.current = data.room.id;
      acceptRoomData(data); setLocalEvents([]); localStorage.setItem(ROOM_STORAGE_KEY, data.room.id);
    } catch (createError) { setError(createError.message || "无法开设房间。请确认已执行对战资料表 SQL。"); }
    finally { setBusy(false); }
  };
  const joinRoom = async () => {
    setError(""); setBusy(true);
    try {
      const data = await cloud.joinBattleRoom(code);
      activeRoomId.current = data.room.id;
      acceptRoomData(data); setLocalEvents([]); localStorage.setItem(ROOM_STORAGE_KEY, data.room.id);
    } catch (joinError) { setError(joinError.message || "验证码不正确或房间已开始。"); }
    finally { setBusy(false); }
  };
  const startRoom = async () => {
    setError(""); setBusy(true);
    try { const data = await cloud.startBattleRoom(room.id); acceptRoomData(data); }
    catch (startError) { setError(startError.message || "必须有偶数名学生才能开始。"); }
    finally { setBusy(false); }
  };
  const advanceRound = async () => {
    if (!tournamentView?.canAdvance || busy) return;
    setBusy(true); setError("");
    try {
      const data = await cloud.advanceBattleTournament(room.id, tournament.stageIndex);
      acceptRoomData(data); setLocalEvents([]); setAnsweredRound("");
    } catch (advanceError) { setError(advanceError.message || "无法开始下一轮，请重试。"); }
    finally { setBusy(false); }
  };
  const submitAnswer = async (answer) => {
    if (!myPlayer || !question || answeredRound === answerKey || myStats.lastRound >= round || sendingAnswer.current || room?.status !== "battle" || !stageStarted || gameEnded || freezeActive || maskActive) return;
    sendingAnswer.current = true;
    const correct = isCorrect(question, answer);
    const current = stats.get(myPlayer.id) || { streak: 0 };
    const nextStreak = correct ? current.streak + 1 : 0;
    const reward = correct ? rewardForStreak(nextStreak) : "";
    const target = pair.find((player) => player.id !== myPlayer.id);
    const createdAt = Date.now();
    const event = { id: `local-answer-${createdAt}`, matchId: myMatch?.id || "", roomId: room.id, playerId: myPlayer.id, targetPlayerId: target?.id || "", round, type: "answer", questionId: question.id, correct, damage: correct ? 20 + Math.min(20, current.streak * 5) : 0, effect: "", createdAt: new Date(createdAt).toISOString() };
    const rewardTargetId = ["freeze", "mask"].includes(reward) ? target?.id || "" : "";
    const skillEvent = reward ? { id: `local-skill-${createdAt}`, matchId: myMatch?.id || "", roomId: room.id, playerId: myPlayer.id, targetPlayerId: rewardTargetId, round, type: "skill", questionId: "", correct: false, damage: 0, effect: reward, createdAt: new Date(createdAt + 1).toISOString() } : null;
    setAnsweredRound(answerKey); setLocalEvents((items) => [...items, event, ...(skillEvent ? [skillEvent] : [])]);
    let answerSaved = false;
    try {
      const saved = await cloud.submitBattleEvent(event);
      if (!saved) throw new Error("答案未保存，请检查登入状态。");
      answerSaved = true;
      setLocalEvents((items) => items.map((item) => item.id === event.id ? saved : item));
      if (skillEvent) {
        const savedSkill = await cloud.submitBattleEvent(skillEvent);
        if (!savedSkill) throw new Error("道具未保存，请检查登入状态。");
        setLocalEvents((items) => items.map((item) => item.id === skillEvent.id ? savedSkill : item));
      }
      await refreshRoom(room.id);
    } catch (answerError) {
      setLocalEvents((items) => items.filter((item) => item.id !== event.id && item.id !== skillEvent?.id));
      if (!answerSaved) setAnsweredRound("");
      setError(answerError.message || "答案或道具无法同步，请检查网络。");
    } finally { sendingAnswer.current = false; }
  };

  const actionFor = (playerId) => {
    if (winner && winner.id === playerId) return "victory";
    if (gameEnded) return "idle";
    const recent = [...pairEvents].reverse().find((event) => event.type === "answer");
    if (!recent || now - new Date(recent.createdAt || 0).getTime() > COMBAT_ACTION_MS) return "idle";
    if (!recent.correct) return "idle";
    if (recent.playerId === playerId) return "attack";
    const targetId = recent.targetPlayerId || pair.find((player) => player.id !== recent.playerId)?.id;
    return targetId === playerId ? "hit" : "idle";
  };
  const scene = h("div", { className: "arena-scene" },
    h("div", { className: "arena-scene-status" }, h("span", null, "LIVE ARENA"), h("i"), h("small", null, "魔法遗迹竞技场")),
    powerupIsVisible ? h("div", { className: `arena-powerup-notice ${latestPowerup.effect}` },
      h("span", null, POWERUPS[latestPowerup.effect].icon),
      h("div", null, h("strong", null, `${pair.find((player) => player.id === latestPowerup.playerId)?.name || "玩家"} 获得${POWERUPS[latestPowerup.effect].name}`), h("small", null, POWERUPS[latestPowerup.effect].description))
    ) : null,
    h(ArenaScene, { leftAction: actionFor(pair[0]?.id), rightAction: actionFor(pair[1]?.id), leftPowerup: powerupFor(pair[0]?.id), rightPowerup: powerupFor(pair[1]?.id), winner, winnerSide: winner?.id === pair[1]?.id ? "right" : "left" })
  );
  if (!room) return h("div", { className: "arena-lobby" },
    h("div", { className: "arena-intro" }, h("span", { className: "arena-kicker" }, "KNOCKOUT TOURNAMENT"), h("h2", null, "联机淘汰赛"), h("p", null, context.role === "teacher" ? "开设房间，让全班通过验证码加入。随机抽签，胜者逐轮晋级，决出冠亚季军。" : "输入老师提供的验证码。通过答题赢下对战，向冠军发起挑战！")),
    context.role === "teacher" ? h("div", { className: "arena-form-card" }, h("label", null, "选择班级", h("select", { value: className, onChange: (event) => setClassName(event.target.value) }, h("option", { value: "" }, "所有班级"), (context.classes || []).map((item) => h("option", { key: item, value: item }, item)))), h("label", null, "使用题目", h("select", { value: assignmentId, onChange: (event) => setAssignmentId(event.target.value) }, (context.assignments || []).map((item) => h("option", { key: item.id, value: item.id }, item.title)))), h("button", { className: "arena-primary-button", disabled: busy || !cloud?.enabled, onClick: createRoom }, busy ? "正在开设…" : "开设对战房间")) : h("div", { className: "arena-form-card" }, h("label", null, "房间验证码", h("input", { value: code, onChange: (event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6)), inputMode: "numeric", placeholder: "输入 6 位数字" })), h("button", { className: "arena-primary-button", disabled: busy || code.length !== 6 || !cloud?.enabled, onClick: joinRoom }, busy ? "正在加入…" : "加入竞技场")),
    context.role === "teacher"
      ? h("div", { className: "arena-teacher-intro-cards" },
        h("article", null, h("span", null, "01"), h("strong", null, "开设房间"), h("small", null, "选择班级和题目后生成验证码")),
        h("article", null, h("span", null, "02"), h("strong", null, "随机抽签"), h("small", null, "偶数人数开始；非完整签表自动安排轮空")),
        h("article", null, h("span", null, "03"), h("strong", null, "逐轮晋级"), h("small", null, "查看全班实时分数，决出冠亚季军"))
      )
      : h("div", { className: "arena-lobby-preview" }, scene),
    !cloud?.enabled ? h("p", { className: "arena-warning" }, "云端功能尚未连接，无法进行跨装置联机对战。") : null,
    error || syncError ? h("p", { className: "arena-error" }, error || syncError) : null
  );

  const readyToStart = players.length >= 2 && players.length % 2 === 0;
  const answered = answeredRound === answerKey || myStats.lastRound >= round;
  const interrupted = freezeActive || maskActive;
  const inputLocked = answered || !myPlayer || gameEnded || interrupted || !stageStarted;
  const countdown = Math.max(0, Math.ceil((new Date(startTime).getTime() - now) / 1000));
  const questionStatus = !stageStarted ? `${countdown} 秒后开始作答` : gameEnded ? "对战已经结束" : freezeActive ? `被冻结 ${debuffSecondsLeft} 秒` : maskActive ? `遮罩剩余 ${debuffSecondsLeft} 秒` : answered ? "已作答，等待下一回合" : "答对即可攻击对手";
  const isFinalStage = tournament?.matches.some((match) => match.kind === "final");
  const completedTournament = tournament?.status === "finished";
  const hasDuel = !tournament || myMatch?.players.length === 2;
  return h("div", { className: "arena-battle-shell" },
    h("div", { className: "arena-room-bar" }, h("div", null, h("span", { className: "arena-kicker" }, completedTournament ? "TOURNAMENT COMPLETE" : room.status === "battle" ? "BATTLE LIVE" : "WAITING ROOM"), h("h2", null, `房间 ${room.code}`), h("p", null, room.className ? `${room.className} · ${visiblePlayerCount} 名参赛学生` : `${visiblePlayerCount} 名参赛学生`)), h("div", { className: "arena-room-actions" }, room.status === "lobby" && context.role === "teacher" ? h("button", { className: "arena-primary-button", disabled: busy || !readyToStart || !questions.length, onClick: startRoom }, busy ? "正在抽签…" : readyToStart ? "抽签并开始淘汰赛" : "需要偶数人数") : null, h("button", { className: "arena-ghost-button", onClick: () => { localStorage.removeItem(ROOM_STORAGE_KEY); activeRoomId.current = null; setRoom(null); setRoomData(null); setLocalEvents([]); setAnsweredRound(""); } }, "离开房间"))),
    error || syncError ? h("p", { className: "arena-error", role: "alert" }, error || syncError, h("button", { className: "arena-ghost-button", onClick: () => { setError(""); setSyncError(""); void refreshRoom(room.id); } }, "重新同步")) : null,
    tournament ? h("section", { className: "arena-tournament-stage" },
      h("div", null, h("span", { className: "arena-kicker" }, `ROUND ${completedTournament ? tournament.history.length : tournament.stageIndex + 1}`), h("h3", null, completedTournament ? "比赛名次已揭晓" : tournamentView.label), h("p", null, completedTournament ? "本届淘汰赛结束，所有赛果已保存。" : !stageStarted ? `准备入场 · ${countdown} 秒后开始` : tournamentView.allFinished ? "本轮已结束，等待老师确认赛果。" : "胜者晋级 · 半决赛败者参加季军赛")),
      context.role === "teacher" && !completedTournament ? h("button", { className: "arena-primary-button", disabled: busy || !tournamentView.canAdvance, onClick: advanceRound }, busy ? "正在保存赛程…" : tournamentView.allFinished && !tournamentView.canAdvance ? "正在确认分数…" : isFinalStage ? "公布最终排名" : "开始下一轮") : null
    ) : null,
    completedTournament ? h(TournamentPodium, { standings: tournamentView.standings }) : null,
    room.status === "lobby" ? h("div", { className: "arena-waiting" }, h("div", { className: "arena-code-display" }, h("small", null, "学生加入验证码"), h("strong", null, room.code)), h("div", { className: "arena-player-list" }, players.map((player, index) => h("div", { className: "arena-player-chip", key: player.id }, h("span", null, index % 2 ? "♟" : "♞"), h("strong", null, player.name), h("small", null, "等待随机抽签")))), h("p", { className: "arena-hint" }, "需要 2、4、6……名学生才能开始。至少 4 人才能决出冠亚季军；2 人只进行冠亚军决赛。每轮血量与得分重置，比赛结束后可查看累计分数。")) : context.role === "teacher" ? h(TeacherBattleDashboard, { players, events: scoredEvents, timeLeft, roomStatus: room.status, matchList: tournamentView?.matches, title: tournamentView?.label || "全班对战总览", lastSynced }) : hasDuel ? h(React.Fragment, null,
      scene,
      h("div", { className: "arena-hud" },
        h("div", { className: "arena-fighter-card left" }, h("strong", null, pair[0]?.name || "玩家 A"), h("div", { className: "arena-health" }, h("i", { style: { width: `${leftStats.hp}%` } })), h("span", null, `生命 ${leftStats.hp} · 得分 ${leftStats.score}`), leftStats.shield > 0 ? h("em", { className: "arena-equipped-item" }, `◈ 保护罩 × ${leftStats.shield}`) : null),
        h("div", { className: "arena-timer" }, h("strong", null, gameEnded ? "END" : !stageStarted ? countdown : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`), h("small", null, gameEnded ? "对战结束" : !stageStarted ? "准备开始" : `第 ${round + 1} 回合`)),
        h("div", { className: "arena-fighter-card right" }, h("strong", null, pair[1]?.name || "玩家 B"), h("div", { className: "arena-health purple" }, h("i", { style: { width: `${rightStats.hp}%` } })), h("span", null, `生命 ${rightStats.hp} · 得分 ${rightStats.score}`), rightStats.shield > 0 ? h("em", { className: "arena-equipped-item" }, `◈ 保护罩 × ${rightStats.shield}`) : null)
      ),
      !gameEnded && stageStarted ? h("div", { key: answerKey, className: `arena-question-card${maskActive ? " is-masked" : ""}${freezeActive ? " is-frozen" : ""}` },
        h("div", { className: "arena-question-head" }, h("span", null, gameEnded ? "本局结算" : "快速答题攻击"), h("small", null, questionStatus)),
        h("h3", null, question?.title || "老师尚未准备题目"),
        question?.type === "fill"
          ? h("div", { className: "arena-fill-row" }, h("input", { id: "arena-fill-answer", disabled: inputLocked, placeholder: "输入答案" }), h("button", { className: "arena-primary-button", disabled: inputLocked, onClick: () => submitAnswer(document.querySelector("#arena-fill-answer")?.value || "") }, "出招"))
          : h("div", { className: "arena-options" }, (question?.options || []).map((option, index) => h("button", { key: `${question.id}-${index}`, disabled: inputLocked, className: "arena-option", onClick: () => submitAnswer(index) }, h("b", null, String.fromCharCode(65 + index)), option))),
        h("p", { className: "arena-skill-note" }, "连续答对第 3 题起，每次可依序获得保护罩、血包、冻结或遮罩；答错会中断连击。"),
        interrupted ? h("div", { className: `arena-debuff-overlay ${freezeActive ? "freeze" : "mask"}` }, h("span", null, freezeActive ? "❄" : "◉"), h("strong", null, freezeActive ? "角色被冻结" : "视线受到遮罩"), h("small", null, `${debuffSecondsLeft} 秒后恢复作答`)) : null
      ) : null,
      gameEnded ? h("div", { className: `arena-result-banner${result.tied ? " tied" : ""}` },
        h("small", null, result.reason === "time" ? "TIME UP" : "BATTLE FINISHED"),
        h("strong", null, result.tied ? "本局平手" : `${winner?.name || "玩家"} 获胜！`),
        h("span", null, resultDescription(result.reason)),
        h("b", null, `${pair[0]?.name || "玩家 A"} ${leftStats.score} : ${rightStats.score} ${pair[1]?.name || "玩家 B"}`),
        tournament && !completedTournament ? h("span", null, myMatch.kind === "final" || myMatch.kind === "bronze" ? "等待老师公布最终排名。" : winner?.id === myPlayer?.id ? "已晋级，等待老师开始下一轮。" : tournamentView.label.includes("半决赛") ? "请留在房间，下一轮参加季军赛。" : "本次止步于此，可以继续查看赛程。") : null
      ) : null
    ) : h("section", { className: "arena-round-waiting" },
      h("span", { "aria-hidden": "true" }, myMatch?.players.length === 1 ? "✦" : "⚑"),
      h("h3", null, myMatch?.players.length === 1 ? "本轮轮空，已晋级" : "你的对战已完成"),
      h("p", null, myMatch?.players.length === 1 ? "请留在房间，等待老师开始下一轮。" : completedTournament ? "感谢参与！下方可以查看完整赛程与赛果。" : "你可以继续查看本轮比分，为同学加油。"),
      myLastMatch ? h("p", null, `上一场：${myLastMatch.players.map((player, index) => `${player.name} ${myLastMatch.stats[index].score} 分`).join(" · ")}`) : null,
      h(TeacherBattleDashboard, { compact: true, matchList: tournamentView?.matches || [], title: "本轮赛况" })
    ),
    tournament?.history?.length ? h("details", { className: "arena-history" }, h("summary", null, "查看已完成赛程与比分"), tournament.history.map((stage) => h(TeacherBattleDashboard, { key: stage.stageIndex, compact: true, matchList: stage.matches, title: stage.label }))) : null,
    tournament ? h("details", { className: "arena-tournament-rules" }, h("summary", null, "淘汰赛规则"), h("p", null, "每局最长 3 分钟；一方生命值归零，或时间结束，即结束该局。时间结束先比较得分，同分依次比较生命值、答对题数、累计答题用时；若完全相同，按赛前随机抽签顺序决定晋级。半决赛败者进入季军赛。每轮由老师确认后开始，并有 8 秒准备时间。")) : null,
    showVictory ? h(AdvancementPopup, { key: latestWin.id, match: latestWin, onClose: closeVictory }) : null
  );
}

class ArenaErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) return h("div", { className: "arena-error-screen" }, h("strong", null, "竞技场暂时无法显示"), h("p", null, "3D 模块加载失败，请重新整理页面；如果仍然没有画面，请检查网络或浏览器的 WebGL 支援。"));
    return this.props.children;
  }
}

const roots = new Map();
const rootsObserver = new MutationObserver(() => {
  for (const [node, root] of roots) {
    if (!node.isConnected) { root.unmount(); roots.delete(node); }
  }
  if (!roots.size) rootsObserver.disconnect();
});
globalThis.personalAIArena = Object.freeze({
  mount(selector) {
    const node = document.querySelector(selector);
    if (!node) return;
    let root = roots.get(node);
    if (!root) {
      root = createRoot(node); roots.set(node, root);
      rootsObserver.observe(document.body, { childList: true, subtree: true });
    }
    root.render(h(ArenaErrorBoundary, null, h(ArenaApp)));
  }
});
if (document.querySelector("#arena-root")) globalThis.personalAIArena.mount("#arena-root");
