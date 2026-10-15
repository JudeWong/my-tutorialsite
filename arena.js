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
  // These are full GLB character assets, rather than the old primitive
  // capsule placeholder. Soldier includes a rig and animation clips; the
  // expressive robot has a detailed mesh plus punch/death/victory clips.
  warrior: "./assets/models/soldier.glb",
  mage: "./assets/models/personal-ai-robot.glb"
};
const ROOM_STORAGE_KEY = "personal-ai-battle-room";
const ROUND_SECONDS = 10;

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

function GlbCharacter({ path, color, action }) {
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
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.65 / Math.max(size.y, 0.01);
    setFit({ scale, position: [-center.x * scale, -box.min.y * scale, -center.z * scale] });
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
  useFrame((_, delta) => {
    mixer.current?.update(delta);
    if (!group.current) return;
    const target = action === "attack" ? 0.28 : action === "hit" ? -0.15 : 0;
    group.current.rotation.z = THREE.MathUtils.damp(group.current.rotation.z, target, 7, delta);
    group.current.position.y = THREE.MathUtils.damp(group.current.position.y, action === "hit" ? 0.1 : 0, 7, delta);
  });
  if (failed || !gltf?.scene) return h(ModelLoadingMarker, { color, failed });
  return h("group", { ref: group }, h("primitive", { object: gltf.scene, scale: fit.scale, position: fit.position, dispose: null }));
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
  return h(Canvas, { shadows: true, camera: { position: [0, 4.3, 8.2], fov: 36 }, dpr: [1, 1.4], className: "arena-canvas" },
    h(ArenaCamera),
    h("color", { attach: "background", args: ["#111525"] }),
    h("ambientLight", { intensity: 1.3 }),
    h("directionalLight", { position: [0, 6, 4], intensity: 2.4, castShadow: true }),
    h("pointLight", { position: [-4, 2, 2], intensity: 18, distance: 12, color: "#5ee7c1" }),
    h("pointLight", { position: [4, 2, 2], intensity: 18, distance: 12, color: "#a88bff" }),
    h("mesh", { rotation: [-Math.PI / 2, 0, 0], receiveShadow: true }, h("planeGeometry", { args: [14, 7] }), h("meshStandardMaterial", { color: "#1a2034", roughness: 0.8 })),
    h("mesh", { position: [0, 0.02, -1.3], rotation: [-Math.PI / 2, 0, 0] }, h("ringGeometry", { args: [2.3, 2.55, 64] }), h("meshBasicMaterial", { color: "#4c65b9", transparent: true, opacity: 0.55 })),
    h("mesh", { position: [0, 2.35, -0.8] }, h("boxGeometry", { args: [7, 0.06, 0.06] }), h("meshBasicMaterial", { color: "#65dfc2" })),
    h("group", { position: [-2.25, 0, 0], rotation: [0, 0.32, 0] }, h(GlbCharacter, { path: MODEL_PATHS.warrior, color: "#5ee7c1", action: leftAction })),
    h("group", { position: [2.25, 0, 0], rotation: [0, -0.32, 0] }, h(GlbCharacter, { path: MODEL_PATHS.mage, color: "#a88bff", action: rightAction })),
    winner ? h("mesh", { position: [0, 3, 0] }, h("torusGeometry", { args: [0.75, 0.04, 8, 40] }), h("meshBasicMaterial", { color: "#ffd166" })) : null
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
      const shield = shields.get(opponent.id) || 0;
      if (shield) shields.set(opponent.id, shield - 1);
      else {
        stats.get(opponent.id).hp = Math.max(0, stats.get(opponent.id).hp - (event.damage || 20));
        stats.get(opponent.id).lastAction = "hit";
      }
    }
  });
  return stats;
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
  const events = [...(roomData?.events || []), ...localEvents];
  const myPlayer = players.find((player) => player.studentId === profile.id);
  const pair = useMemo(() => {
    if (!players.length) return [];
    if (context.role === "student" && myPlayer) {
      const index = players.findIndex((player) => player.id === myPlayer.id);
      return [myPlayer, players[index % 2 === 0 ? index + 1 : index - 1]].filter(Boolean);
    }
    return players.slice(0, 2);
  }, [players, myPlayer, context.role]);
  const pairEvents = events.filter((event) => pair.some((player) => player.id === event.playerId));
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
    const event = { id: `local-${Date.now()}`, roomId: room.id, playerId: myPlayer.id, round, type: "answer", questionId: question.id, correct, damage: correct ? 20 + Math.min(20, current.streak * 5) : 0, effect: nextStreak > 0 && nextStreak % 3 === 0 ? "shield" : "", createdAt: new Date().toISOString() };
    setAnsweredRound(round); setLocalEvents((items) => [...items, event]);
    try { await cloud.submitBattleEvent({ roomId: room.id, playerId: myPlayer.id, round, questionId: question.id, correct, damage: event.damage, effect: event.effect }); await refreshRoom(room.id); setLocalEvents([]); }
    catch (answerError) { setError(answerError.message || "答案无法同步，请检查网络。"); }
    if (target && nextStreak > 0 && nextStreak % 3 === 0) {
      try { await cloud.submitBattleEvent({ roomId: room.id, playerId: myPlayer.id, round, type: "skill", effect: "shield" }); } catch { /* answer event is still preserved */ }
    }
  };

  const actionFor = (playerId) => {
    if (winner && winner.id === playerId) return "victory";
    const recent = [...pairEvents].reverse().find((event) => event.type === "answer");
    if (!recent || now - new Date(recent.createdAt || 0).getTime() > 1100) return "idle";
    if (!recent.correct) return "idle";
    return recent.playerId === playerId ? "attack" : "hit";
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
    h("div", { className: "arena-room-bar" }, h("div", null, h("span", { className: "arena-kicker" }, room.status === "battle" ? "BATTLE LIVE" : "WAITING ROOM"), h("h2", null, `房间 ${room.code}`), h("p", null, room.className ? `${room.className} · ${players.length} 人在线` : `${players.length} 人在线`)), h("div", { className: "arena-room-actions" }, room.status === "lobby" && context.role === "teacher" ? h("button", { className: "arena-primary-button", disabled: busy || !readyToStart, onClick: startRoom }, readyToStart ? "开始战斗" : "需要偶数人数") : null, h("button", { className: "arena-ghost-button", onClick: () => { localStorage.removeItem(ROOM_STORAGE_KEY); setRoom(null); setRoomData(null); } }, "离开房间"))),
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
