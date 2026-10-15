/*
 * Live 1v1 quiz arena.
 *
 * The shell remains vanilla HTML so it works inside the existing website and
 * APK. The battle canvas itself is intentionally isolated in React Three
 * Fiber, loaded from ESM CDN URLs, and uses the project's GLB characters.
 */
import React, { useEffect, useMemo, useRef, useState } from "https://esm.sh/react@18.3.1";
import { createRoot } from "https://esm.sh/react-dom@18.3.1/client";
import { Canvas, useFrame, useThree } from "https://esm.sh/@react-three/fiber@8.17.10?deps=react@18.3.1,react-dom@18.3.1,three@0.160.0";
import * as THREE from "https://esm.sh/three@0.160.0";
import { GLTFLoader } from "https://esm.sh/three@0.160.0/examples/jsm/loaders/GLTFLoader.js?deps=three@0.160.0";

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
    h("mesh", { position: [0, 1.65, -3.65], receiveShadow: true }, h("boxGeometry", { args: [12, 3.5, 0.45] }), h("meshStandardMaterial", { color: "#292b2d", roughness: 0.97 })),
    STONE_BLOCKS.map((stone, index) => h("mesh", { key: `stone-${index}`, position: [stone.x, stone.y, -3.38], scale: [stone.scale, 1, 1], castShadow: true, receiveShadow: true }, h("boxGeometry", { args: [1.92, 0.72, 0.38] }), h("meshStandardMaterial", { color: index % 2 ? "#4b4a46" : "#55534d", roughness: 0.96 }))),
    [-4.75, 4.75].map((x) => h("group", { key: `pillar-${x}`, position: [x, 0, -2.95] },
      h("mesh", { position: [0, 1.4, 0], castShadow: true, receiveShadow: true }, h("cylinderGeometry", { args: [0.4, 0.52, 2.8, 12] }), h("meshStandardMaterial", { color: "#4a4945", roughness: 0.93 })),
      h("mesh", { position: [0, 2.88, 0], castShadow: true }, h("boxGeometry", { args: [1.05, 0.24, 0.9] }), h("meshStandardMaterial", { color: "#5d5a53", roughness: 0.9 }))
    )),
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

function ArenaScene({ leftAction, rightAction, winner }) {
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
    h(StoneArena),
    h("group", { position: [-2.15, 0, 0.1], rotation: [0, 0.3, 0] }, h(GlbCharacter, { path: MODEL_PATHS.warrior, color: "#5ee7c1", action: leftAction, direction: 1, weapon: "sword" })),
    h("group", { position: [2.15, 0, 0.1], rotation: [0, -0.3, 0] }, h(GlbCharacter, { path: MODEL_PATHS.mage, color: "#a88bff", action: rightAction, direction: -1, weapon: "staff" })),
    h(AttackEffect, { side: "left", action: leftAction, kind: "slash" }),
    h(AttackEffect, { side: "right", action: rightAction, kind: "magic" }),
    h(ImpactEffect, { side: "left", action: leftAction, color: "#b79cff" }),
    h(ImpactEffect, { side: "right", action: rightAction, color: "#ffd27a" }),
    winner ? h("group", { position: [0, 3.05, 0.2] },
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
  const stats = new Map(players.map((player) => [player.id, { hp: 100, score: 0, streak: 0, lastAction: "idle", lastRound: -1 }]));
  const shields = new Map();
  [...events].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)).forEach((event) => {
    const own = stats.get(event.playerId);
    if (!own) return;
    if (event.type === "skill" && event.effect === "shield") { shields.set(event.playerId, (shields.get(event.playerId) || 0) + 1); return; }
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
      const shield = shields.get(targetId) || 0;
      if (shield) shields.set(targetId, shield - 1);
      else {
        const damage = Math.max(1, Number(event.damage) || 20);
        stats.get(targetId).hp = Math.max(0, stats.get(targetId).hp - damage);
        stats.get(targetId).lastAction = "hit";
      }
    }
  });
  return stats;
}

function mergeBattleEvents(remoteEvents, localEvents) {
  const merged = new Map();
  [...(remoteEvents || []), ...(localEvents || [])].forEach((event) => {
    // One optimistic local answer and its later Supabase row represent the
    // same move. De-duplicate them before calculating damage.
    const key = [event.roomId || "", event.playerId || "", event.round ?? "", event.type || "", event.questionId || "", event.effect || ""].join("|");
    const current = merged.get(key);
    // Prefer the server copy when the optimistic event has already arrived.
    if (!current || (!String(event.id || "").startsWith("local-") && String(current.id || "").startsWith("local-"))) merged.set(key, event);
  });
  return [...merged.values()].sort((a, b) => new Date(a.createdAt || 0) - new Date(b.createdAt || 0));
}

function opponentFromPairing(events, myPlayer) {
  if (!myPlayer) return null;
  const pairing = [...(events || [])].reverse().find((event) => event.playerId === myPlayer.id && event.type === "skill" && String(event.effect || "").startsWith("pairing:"));
  if (!pairing) return null;
  try {
    const stored = JSON.parse(String(pairing.effect).slice("pairing:".length));
    if (!stored.opponentId || !stored.opponentName) return null;
    return {
      id: stored.opponentId,
      studentId: stored.opponentStudentId || "",
      name: stored.opponentName,
      className: stored.opponentClassName || "",
      roomId: myPlayer.roomId,
      status: "playing",
      virtual: true
    };
  } catch {
    return null;
  }
}

function ArenaApp() {
  const context = globalThis.personalAIAppContext?.() || {};
  const [room, setRoom] = useState(null);
  const [code, setCode] = useState("");
  const [className, setClassName] = useState(context.classes?.[0] || "");
  const [assignmentId, setAssignmentId] = useState(context.assignments?.[0]?.id || "");
  const [roomData, setRoomData] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [answeredRound, setAnsweredRound] = useState(-1);
  const [localEvents, setLocalEvents] = useState([]);
  const stopSubscription = useRef(null);

  const cloud = globalThis.personalAICloud;
  const profile = context.profile || {};
  const assignment = context.assignments?.find((item) => item.id === (room?.assignmentId || assignmentId)) || context.assignments?.[0];
  const questions = useMemo(() => {
    const ids = assignment?.questionIds || [];
    return (ids.length ? ids.map((id) => context.questions?.find((question) => question.id === id)).filter(Boolean) : context.questions || []).slice(0, 30);
  }, [assignment, context.questions]);

  const refreshRoom = async (roomId = room?.id) => {
    if (!cloud?.enabled || !roomId || !cloud.loadBattleRoom) return;
    try { setRoomData(await cloud.loadBattleRoom(roomId)); } catch (loadError) { setError(loadError.message || "无法读取对战房间。请先执行 Supabase 对战资料表 SQL。"); }
  };
  useEffect(() => {
    const saved = localStorage.getItem(ROOM_STORAGE_KEY);
    if (saved && cloud?.enabled) {
      cloud.loadBattleRoom(saved).then((data) => { if (data) { setRoom(data.room); setRoomData(data); } }).catch(() => {});
    }
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(timer); stopSubscription.current?.(); };
  }, []);
  useEffect(() => {
    if (!room?.id || !cloud?.subscribeToBattleRoom) return undefined;
    stopSubscription.current?.();
    stopSubscription.current = cloud.subscribeToBattleRoom(room.id, () => refreshRoom(room.id));
    void refreshRoom(room.id);
    return () => stopSubscription.current?.();
  }, [room?.id]);
  useEffect(() => { if (roomData?.room) setRoom(roomData.room); }, [roomData?.room?.status, roomData?.room?.startedAt]);

  const players = roomData?.players || [];
  const events = mergeBattleEvents(roomData?.events, localEvents);
  const myPlayer = players.find((player) => player.studentId === profile.id);
  const pair = useMemo(() => {
    if (!players.length) return [];
    if (context.role === "student" && myPlayer) {
      const index = players.findIndex((player) => player.id === myPlayer.id);
      const visibleOpponent = players[index % 2 === 0 ? index + 1 : index - 1];
      return [myPlayer, visibleOpponent || opponentFromPairing(events, myPlayer)].filter(Boolean);
    }
    return players.slice(0, 2);
  }, [players, events, myPlayer, context.role]);
  const pairEvents = events.filter((event) => pair.some((player) => player.id === event.playerId));
  const visiblePlayerCount = context.role === "student" ? Math.max(players.length, pair.length) : players.length;
  const stats = battleStats(pair, pairEvents);
  const leftStats = stats.get(pair[0]?.id) || { hp: 100, score: 0, streak: 0, lastAction: "idle" };
  const rightStats = stats.get(pair[1]?.id) || { hp: 100, score: 0, streak: 0, lastAction: "idle" };
  const elapsed = room?.startedAt ? Math.max(0, now - new Date(room.startedAt).getTime()) : 0;
  const timeLeft = room?.status === "battle" ? Math.max(0, (room.durationSeconds || 180) - Math.floor(elapsed / 1000)) : room?.durationSeconds || 180;
  const round = room?.status === "battle" ? Math.floor(elapsed / (ROUND_SECONDS * 1000)) : 0;
  const question = questions.length ? questions[round % questions.length] : null;
  const winner = leftStats.hp <= 0 ? pair[0] : rightStats.hp <= 0 ? pair[1] : timeLeft <= 0 ? (leftStats.score >= rightStats.score ? pair[0] : pair[1]) : null;

  const createRoom = async () => {
    setError(""); setBusy(true);
    try {
      const data = await cloud.createBattleRoom({ className, assignmentId });
      setRoomData(data); setRoom(data.room); setLocalEvents([]); localStorage.setItem(ROOM_STORAGE_KEY, data.room.id);
    } catch (createError) { setError(createError.message || "无法开设房间。请确认已执行对战资料表 SQL。"); }
    finally { setBusy(false); }
  };
  const joinRoom = async () => {
    setError(""); setBusy(true);
    try {
      const data = await cloud.joinBattleRoom(code);
      setRoomData(data); setRoom(data.room); setLocalEvents([]); localStorage.setItem(ROOM_STORAGE_KEY, data.room.id);
    } catch (joinError) { setError(joinError.message || "验证码不正确或房间已开始。"); }
    finally { setBusy(false); }
  };
  const startRoom = async () => {
    setError(""); setBusy(true);
    try { const data = await cloud.startBattleRoom(room.id); setRoomData(data); setRoom(data.room); }
    catch (startError) { setError(startError.message || "必须有偶数名学生才能开始。"); }
    finally { setBusy(false); }
  };
  const submitAnswer = async (answer) => {
    if (!myPlayer || !question || answeredRound === round || room?.status !== "battle" || winner) return;
    const correct = isCorrect(question, answer);
    const current = stats.get(myPlayer.id) || { streak: 0 };
    const nextStreak = correct ? current.streak + 1 : 0;
    const target = pair.find((player) => player.id !== myPlayer.id);
    const event = { id: `local-${Date.now()}`, roomId: room.id, playerId: myPlayer.id, targetPlayerId: target?.id || "", round, type: "answer", questionId: question.id, correct, damage: correct ? 20 + Math.min(20, current.streak * 5) : 0, effect: nextStreak > 0 && nextStreak % 3 === 0 ? "shield" : "", createdAt: new Date().toISOString() };
    setAnsweredRound(round); setLocalEvents((items) => [...items, event]);
    try { await cloud.submitBattleEvent({ roomId: room.id, playerId: myPlayer.id, targetPlayerId: target?.id || "", round, questionId: question.id, correct, damage: event.damage, effect: event.effect }); await refreshRoom(room.id); setLocalEvents([]); }
    catch (answerError) { setError(answerError.message || "答案无法同步，请检查网络。"); }
    if (target && nextStreak > 0 && nextStreak % 3 === 0) {
      try { await cloud.submitBattleEvent({ roomId: room.id, playerId: myPlayer.id, round, type: "skill", effect: "shield" }); } catch { /* answer event is still preserved */ }
    }
  };

  const actionFor = (playerId) => {
    if (winner && winner.id === playerId) return "victory";
    const recent = [...pairEvents].reverse().find((event) => event.type === "answer");
    if (!recent || now - new Date(recent.createdAt || 0).getTime() > COMBAT_ACTION_MS) return "idle";
    if (!recent.correct) return "idle";
    if (recent.playerId === playerId) return "attack";
    const targetId = recent.targetPlayerId || pair.find((player) => player.id !== recent.playerId)?.id;
    return targetId === playerId ? "hit" : "idle";
  };
  const scene = h("div", { className: "arena-scene" }, h(ArenaScene, { leftAction: actionFor(pair[0]?.id), rightAction: actionFor(pair[1]?.id), winner }));
  if (!room) return h("div", { className: "arena-lobby" },
    h("div", { className: "arena-intro" }, h("span", { className: "arena-kicker" }, "LIVE 1V1"), h("h2", null, "联机对战竞技场"), h("p", null, context.role === "teacher" ? "老师先开设房间，学生使用验证码加入。系统只会在人数为偶数时开始配对。" : "输入老师提供的房间验证码，等待系统把你和另一名同学配对。")),
    context.role === "teacher" ? h("div", { className: "arena-form-card" }, h("label", null, "选择班级", h("select", { value: className, onChange: (event) => setClassName(event.target.value) }, h("option", { value: "" }, "所有班级"), (context.classes || []).map((item) => h("option", { key: item, value: item }, item)))), h("label", null, "使用题目", h("select", { value: assignmentId, onChange: (event) => setAssignmentId(event.target.value) }, (context.assignments || []).map((item) => h("option", { key: item.id, value: item.id }, item.title)))), h("button", { className: "arena-primary-button", disabled: busy || !cloud?.enabled, onClick: createRoom }, busy ? "正在开设…" : "开设对战房间")) : h("div", { className: "arena-form-card" }, h("label", null, "房间验证码", h("input", { value: code, onChange: (event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6)), inputMode: "numeric", placeholder: "输入 6 位数字" })), h("button", { className: "arena-primary-button", disabled: busy || code.length !== 6 || !cloud?.enabled, onClick: joinRoom }, busy ? "正在加入…" : "加入竞技场")),
    h("div", { className: "arena-lobby-preview" }, scene),
    !cloud?.enabled ? h("p", { className: "arena-warning" }, "云端功能尚未连接，无法进行跨装置联机对战。") : null,
    error ? h("p", { className: "arena-error" }, error) : null
  );

  const readyToStart = players.length >= 2 && players.length % 2 === 0;
  const answered = answeredRound === round;
  return h("div", { className: "arena-battle-shell" },
    h("div", { className: "arena-room-bar" }, h("div", null, h("span", { className: "arena-kicker" }, room.status === "battle" ? "BATTLE LIVE" : "WAITING ROOM"), h("h2", null, `房间 ${room.code}`), h("p", null, room.className ? `${room.className} · ${visiblePlayerCount} 人在线` : `${visiblePlayerCount} 人在线`)), h("div", { className: "arena-room-actions" }, room.status === "lobby" && context.role === "teacher" ? h("button", { className: "arena-primary-button", disabled: busy || !readyToStart, onClick: startRoom }, readyToStart ? "开始战斗" : "需要偶数人数") : null, h("button", { className: "arena-ghost-button", onClick: () => { localStorage.removeItem(ROOM_STORAGE_KEY); setRoom(null); setRoomData(null); } }, "离开房间"))),
    room.status === "lobby" ? h("div", { className: "arena-waiting" }, h("div", { className: "arena-code-display" }, h("small", null, "学生加入验证码"), h("strong", null, room.code)), h("div", { className: "arena-player-list" }, players.map((player, index) => h("div", { className: "arena-player-chip", key: player.id }, h("span", null, index % 2 ? "♟" : "♞"), h("strong", null, player.name), h("small", null, index % 2 ? "等待配对" : "已加入")))), h("p", { className: "arena-hint" }, "配对规则：按照加入顺序每两人一组；人数必须是 2、4、6……才能开始。")) : h(React.Fragment, null,
      scene,
      h("div", { className: "arena-hud" }, h("div", { className: "arena-fighter-card left" }, h("strong", null, pair[0]?.name || "玩家 A"), h("div", { className: "arena-health" }, h("i", { style: { width: `${leftStats.hp}%` } })), h("span", null, `生命 ${leftStats.hp} · 得分 ${leftStats.score}`)), h("div", { className: "arena-timer" }, h("strong", null, `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`), h("small", null, `第 ${round + 1} 回合`)), h("div", { className: "arena-fighter-card right" }, h("strong", null, pair[1]?.name || "玩家 B"), h("div", { className: "arena-health purple" }, h("i", { style: { width: `${rightStats.hp}%` } })), h("span", null, `生命 ${rightStats.hp} · 得分 ${rightStats.score}`))),
      h("div", { className: "arena-question-card" }, h("div", { className: "arena-question-head" }, h("span", null, "快速答题攻击"), h("small", null, answered ? "已作答，等待下一回合" : "答对即可攻击对手")), h("h3", null, question?.title || "老师尚未准备题目"), question?.type === "fill" ? h("div", { className: "arena-fill-row" }, h("input", { id: "arena-fill-answer", disabled: answered || !myPlayer || Boolean(winner), placeholder: "输入答案" }), h("button", { className: "arena-primary-button", disabled: answered || !myPlayer || Boolean(winner), onClick: () => submitAnswer(document.querySelector("#arena-fill-answer")?.value || "") }, "出招")) : h("div", { className: "arena-options" }, (question?.options || []).map((option, index) => h("button", { key: `${question.id}-${index}`, disabled: answered || !myPlayer || Boolean(winner), className: "arena-option", onClick: () => submitAnswer(index) }, h("b", null, String.fromCharCode(65 + index)), option))), h("p", { className: "arena-skill-note" }, "连对 3 题：触发保护盾；答错不会攻击。")),
      winner ? h("div", { className: "arena-result-banner" }, h("strong", null, `${winner.name} 获胜！`), h("span", null, timeLeft <= 0 ? "时间结束，分数较高者胜出。" : "对手生命值已归零。")) : null
    ),
    error ? h("p", { className: "arena-error" }, error) : null
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
globalThis.personalAIArena = Object.freeze({
  mount(selector) {
    const node = document.querySelector(selector);
    if (!node) return;
    let root = roots.get(node);
    if (!root) { root = createRoot(node); roots.set(node, root); }
    root.render(h(ArenaErrorBoundary, null, h(ArenaApp)));
  }
});
if (document.querySelector("#arena-root")) globalThis.personalAIArena.mount("#arena-root");
