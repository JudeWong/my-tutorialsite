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
import { readTournament, buildTournamentView, MAX_BATTLE_PLAYERS } from "./battle-engine.js";

// The teacher's score dashboard never needs to download the 3D renderer.
class SceneErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return h("div", { className: "apocalypse-loading has-error", role: "status" },
      h("strong", null, "3D 场景暂时无法显示"),
      h("small", null, "你仍可继续作答。请检查网络或浏览器的 3D 支援。"),
      h("button", { className: "arena-primary-button", onClick: this.props.onRetry }, "重试 3D 场景")
    );
  }
}

function LazyArenaScene(props) {
  const [attempt, setAttempt] = useState(0);
  const Scene = useMemo(() => React.lazy(() => import(attempt ? `./arena-scene.js?retry=${attempt}` : "./arena-scene.js")
    .then((module) => ({ default: module.ApocalypseArena }))), [attempt]);
  return h(SceneErrorBoundary, { key: attempt, onRetry: () => setAttempt((value) => value + 1) },
    h(React.Suspense, { fallback: h("div", { className: "apocalypse-loading", role: "status" }, h("strong", null, "正在准备遗迹竞技场…")) }, h(Scene, props))
  );
}

const h = (type, props, ...children) => React.createElement(type, props, ...children.map((child) =>
  typeof child === "string" ? (globalThis.personalAITranslateText?.(child) ?? child) : child));
const ROOM_STORAGE_KEY = "personal-ai-battle-room";
const ROUND_SECONDS = 10;
const COMBAT_ACTION_MS = 1800;
const POWERUP_EFFECT_MS = 5000;
const DEBUFF_SECONDS = 4;
const battleNow = () => {
  const value = globalThis.personalAICloud?.battleNow?.();
  return Number.isFinite(value) ? value : Date.now();
};
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

function TeacherPlayerMetric({ player, stat, side, winner, bye = false, historical = false }) {
  const known = !bye && Number.isFinite(stat?.score) && Number.isFinite(stat?.hp);
  const hp = known ? Math.min(100, Math.max(0, stat.hp)) : null;
  const lowHealth = known && hp <= 30;
  const isWinner = winner?.id === player?.id;
  const item = POWERUPS[stat?.lastReward];
  return h("div", { className: `arena-monitor-player ${side}${isWinner ? " winner" : ""}` },
    h("div", { className: "arena-monitor-player-head" },
      h("span", { className: "arena-monitor-avatar" }, side === "left" ? "⚔" : "✦"),
      h("div", null,
        h("strong", null, player?.name || "等待玩家"),
        h("small", null, player?.className || "尚未加入")
      )
    ),
    h("div", { className: "arena-monitor-score", "aria-label": `${player?.name || "玩家"} ${historical ? "该轮" : "本轮"}得分 ${known ? stat.score : "未参赛或待同步"}` }, h("span", null, historical ? "该轮得分" : "本轮得分"), h("b", null, known ? stat.score : "—"), known ? h("span", null, "分") : null),
    h("div", { className: "arena-monitor-health-label" }, h("span", null, historical ? "该轮结束生命" : "本轮生命"), h("strong", null, known ? `${hp} / 100` : "—")),
    known ? h("div", { className: `arena-monitor-health ${side}${lowHealth ? " danger" : ""}`, role: "meter", "aria-label": `${player?.name || "玩家"}生命值`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": hp }, h("i", { style: { width: `${hp}%` } })) : null,
    h("small", { className: "arena-monitor-streak" }, bye ? "轮空不计分，不虚构血量" : !known ? "等待完整比分同步" : stat.shield > 0 ? `◈ 保护罩 × ${stat.shield}` : item ? `${item.icon} ${item.name} · 连对 ${stat.streak} 题` : stat.streak > 1 ? `连对 ${stat.streak} 题` : historical ? "本轮记录已保存" : "答对开始计分")
  );
}

function TeacherBattleDashboard({ players = [], events = [], timeLeft = 0, roomStatus, matchList, title = "全班对战总览", lastSynced, compact = false, historical = false }) {
  const matches = matchList || buildBattleMatches(players, events, timeLeft);
  const finishedCount = matches.filter((match) => match.finished).length;
  const totalAnswers = matches.reduce((sum, match) => sum + (Number(match.answerCount) || 0), 0);
  const actualMatches = matches.filter((match) => match.players.length === 2);
  return h("section", { className: "arena-teacher-dashboard" },
    !compact ? h("div", { className: "arena-monitor-summary" },
      h("article", null, h("span", null, "本轮对战组数"), h("strong", null, actualMatches.length), h("small", null, `${actualMatches.length * 2} 人参战 · ${matches.length - actualMatches.length} 人轮空`)),
      h("article", null, h("span", null, "正在进行"), h("strong", null, actualMatches.filter((match) => !match.finished && match.started !== false && roomStatus === "battle").length), h("small", null, roomStatus === "finished" ? "比赛结束" : roomStatus === "battle" ? "实时同步中" : "等待开始")),
      h("article", null, h("span", null, historical ? "该轮作答" : "本轮作答"), h("strong", null, totalAnswers), h("small", null, `已结束 ${actualMatches.filter((match) => match.finished).length} 场对战`)),
      h("article", { className: "arena-monitor-clock" }, h("span", null, "本轮剩余"), h("strong", null, matches.length > 0 && finishedCount === matches.length ? "END" : `${Math.floor(timeLeft / 60)}:${String(timeLeft % 60).padStart(2, "0")}`), h("small", null, matches.length > 0 && finishedCount === matches.length ? "本轮已结束" : "每轮重新计时"))
    ) : null,
    h("div", { className: "arena-monitor-heading" },
      h("div", null, h("span", { className: "arena-kicker" }, historical ? "SAVED ROUND" : "LIVE SCOREBOARD"), h("h3", null, title)),
      h("p", null, historical ? "已保存的该轮比分与结束血量，不随新轮次清零" : lastSynced ? `最近同步 ${new Date(lastSynced).toLocaleTimeString("zh-CN", { hour12: false })} · 本轮分数与血量` : "每组本轮得分与血量")
    ),
    h("div", { className: "arena-monitor-grid" }, matches.map((match) => h("article", { className: `arena-monitor-card${match.finished ? " finished" : ""}`, key: match.id || `match-${match.number}` },
      h("header", null,
        h("div", null, h("span", null, match.kind === "final" ? "冠军争夺战" : match.kind === "bronze" ? "季军争夺战" : `对战 ${String(match.number).padStart(2, "0")}`), h("small", null, match.players.length === 1 ? "抽签轮空" : match.currentRound > 0 ? `已进行 ${match.currentRound} 题` : "等待首次作答")),
        h("b", { className: match.finished ? "done" : "live", title: match.winner?.name }, match.finished ? (match.tied ? "平手" : `${match.winner?.name || ""}${match.players.length === 1 ? " 晋级" : " 获胜"}`) : match.started === false ? "即将开始" : "进行中")
      ),
      h("div", { className: "arena-monitor-versus" },
        h(TeacherPlayerMetric, { player: match.players[0], stat: match.stats?.[0], side: "left", winner: match.winner, bye: match.players.length === 1, historical }),
        h("div", { className: "arena-monitor-vs" }, h("span", null, "VS"), h("small", null, `${match.answerCount} 次作答`)),
        match.players[1] ? h(TeacherPlayerMetric, { player: match.players[1], stat: match.stats?.[1], side: "right", winner: match.winner, historical }) : h("p", { className: "arena-bye-label" }, "本轮轮空\n直接晋级")
      ),
      match.finished && match.players.length > 1 ? h("p", { className: "arena-match-reason" }, resultDescription(match.reason)) : null
    )))
  );
}

// Pure projection: keep live-round, saved-round and cumulative metrics separate.
// A bye/eliminated player has no current HP, not a fabricated 100 or zero.
function teacherRoundLabel(matches) {
  if (matches.some((match) => match.kind === "bronze")) return "决赛与季军赛";
  if (matches.some((match) => match.kind === "final")) return "决赛";
  const entrants = matches.reduce((sum, match) => sum + (match.players || match.playerIds || []).length, 0);
  if (entrants === 3) return "三人半决赛";
  if (entrants === 4) return "半决赛";
  return `${entrants} 强赛`;
}

export function projectTeacherStandings(state, view, selectedRound = "live") {
  const history = state?.history || [];
  const savedStage = selectedRound === "live" ? null : history.find((stage) => String(stage.stageIndex) === selectedRound);
  const matches = savedStage?.matches || view?.matches || [];
  const allMatches = new Map(history.flatMap((stage) => stage.matches.map((match) => [match.id, { match, stageIndex: stage.stageIndex }])));
  for (const match of view?.matches || []) {
    if (!allMatches.has(match.id)) allMatches.set(match.id, { match, stageIndex: state.stageIndex });
  }
  const totals = new Map((view?.standings || []).map((entry) => [entry.player.id, entry]));
  const round = savedStage ? savedStage.stageIndex + 1 : state?.status === "finished" ? history.length : (state?.stageIndex || 0) + 1;
  const rows = (state?.roster || []).map((player) => {
    const match = matches.find((entry) => entry.players.some((participant) => participant.id === player.id));
    const liveMatch = view?.matches?.find((entry) => entry.players.some((participant) => participant.id === player.id));
    const stat = match?.stats?.[match.players.findIndex((participant) => participant.id === player.id)];
    const played = match?.players.length === 2;
    const total = totals.get(player.id);
    const last = [...allMatches.values()].reverse().find((entry) => entry.match.players.length === 2 && entry.match.finished && entry.match.players.some((participant) => participant.id === player.id));
    const lastStat = last?.match.stats?.[last.match.players.findIndex((participant) => participant.id === player.id)];
    const placeLabel = ({ 1: "冠军", 2: "亚军", 3: "季军", 4: "第四名" })[total?.place];
    const status = placeLabel || (liveMatch?.players.length === 1 ? "本轮轮空晋级" : liveMatch
      ? !liveMatch.finished ? liveMatch.started === false ? "准备参战" : "正在对战"
        : liveMatch.winner?.id === player.id ? state.status === "finished" ? "已完成" : "获胜，等待下一轮"
          : view.label === "三人半决赛" ? "季军待确认" : view.label === "半决赛" ? "等待季军赛" : "已淘汰"
      : state?.status === "finished" ? "已完成" : "已淘汰 / 本轮未参赛");
    return { player, status, place: total?.place || null,
      score: played && Number.isFinite(stat?.score) ? stat.score : null,
      hp: played && Number.isFinite(stat?.hp) ? Math.max(0, Math.min(100, stat.hp)) : null,
      roundNote: match?.players.length === 1 ? "本轮轮空，不计分" : !match ? "该轮未参赛" : !stat ? "比分待同步" : match.finished ? "该轮已结束" : "本轮实时",
      total: Number.isFinite(total?.score) ? total.score : null,
      last: last && lastStat ? { round: last.stageIndex + 1, score: lastStat.score, hp: lastStat.hp } : null };
  });
  return { rows, matches, round, historical: Boolean(savedStage), title: matches.length ? teacherRoundLabel(matches) : "比分同步中" };
}

function TeacherTournamentDashboard({ state, view, lastSynced, syncing, syncError, clockSynchronized, onRetry }) {
  const [selectedRound, setSelectedRound] = useState("live");
  const projection = projectTeacherStandings(state, view, selectedRound);
  const stale = Boolean(lastSynced && Date.now() - lastSynced > 12000);
  const clockWarning = clockSynchronized === false;
  const syncLabel = syncError ? "同步失败：保留上次收到的数据，不代表实时比分" : clockWarning ? "云端时间尚未校准：请检查数据库升级，比赛计时可能不准确" : stale ? "数据更新延迟：当前显示上次同步结果" : syncing ? "正在同步比分…" : lastSynced ? "比分同步正常" : "正在读取完整比分…";
  return h("section", { className: "arena-teacher-tournament" },
    h("div", { className: `arena-score-sync${syncError || stale || clockWarning ? " is-stale" : ""}`, role: "status" },
      h("span", null, syncLabel), h("small", null, lastSynced ? `最近成功读取 ${new Date(lastSynced).toLocaleTimeString("zh-CN", { hour12: false })}` : "不会用 0 分替代缺失数据"),
      h("button", { className: "arena-ghost-button", type: "button", onClick: onRetry, disabled: syncing }, syncing ? "同步中…" : "立即同步")),
    h("div", { className: "arena-round-selector" },
      h("label", null, "查看比赛轮次", h("select", { value: selectedRound, onChange: (event) => setSelectedRound(event.target.value) },
        h("option", { value: "live" }, state.status === "finished" ? "最终轮赛果" : `当前第 ${state.stageIndex + 1} 轮 · 实时`),
        state.history.map((stage) => h("option", { key: stage.stageIndex, value: String(stage.stageIndex) }, `第 ${stage.stageIndex + 1} 轮 · ${teacherRoundLabel(stage.matches)} · 已保存`)))),
      h("p", null, "每轮得分及生命值独立计算；累计得分保留所有轮次。轮空与未参赛显示 —。")),
    h(TeacherBattleDashboard, { players: state.roster, timeLeft: projection.historical ? 0 : view.timeLeft, roomStatus: projection.historical ? "finished" : state.status,
      matchList: projection.matches, title: `第 ${projection.round} 轮 · ${projection.title}`, historical: projection.historical, lastSynced }),
    h("section", { className: "arena-roster-scores" },
      h("div", { className: "arena-monitor-heading" }, h("div", null, h("span", { className: "arena-kicker" }, "ALL STUDENTS"), h("h3", null, `全体学生战绩 · ${projection.rows.length} 人`)),
        h("p", null, `所选第 ${projection.round} 轮的数据与全赛程累计分数`)),
      h("div", { className: "arena-score-table-scroll", tabIndex: 0, "aria-label": "全体学生战绩，可横向滚动" },
        h("table", { className: "arena-score-table" },
          h("thead", null, h("tr", null, ["学生", `第 ${projection.round} 轮得分`, `第 ${projection.round} 轮生命`, "目前赛程状态", "累计得分"].map((label) => h("th", { key: label, scope: "col" }, label)))),
          h("tbody", null, projection.rows.map((row) => h("tr", { key: row.player.id },
            h("th", { scope: "row" }, row.player.name, h("small", null, row.player.className)),
            h("td", null, h("b", null, row.score ?? "—"), h("small", null, row.roundNote)),
            h("td", null, row.hp === null ? h("span", null, "—") : h(React.Fragment, null,
              h("span", null, `${row.hp} / 100`), h("div", { className: `arena-monitor-health${row.hp <= 30 ? " danger" : ""}`, role: "meter", "aria-label": `${row.player.name}第${projection.round}轮生命`, "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": row.hp }, h("i", { style: { width: `${row.hp}%` } })))),
            h("td", null, row.status, row.last ? h("small", null, `最近完赛：第 ${row.last.round} 轮 ${row.last.score} 分 / 生命 ${row.last.hp}`) : null),
            h("td", { className: "arena-cumulative-score" }, row.total ?? "待同步")))))))
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
  const [recentRooms, setRecentRooms] = useState([]);
  const [openingRoom, setOpeningRoom] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(battleNow);
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
    if (!data?.room) return false;
    const current = latestRoomData.current;
    if (current?.room.id === data.room.id) {
      const currentStage = readTournament(current.events)?.stageIndex ?? -1;
      const incomingStage = readTournament(data.events)?.stageIndex ?? -1;
      // A read started before a saved move/advancement may finish afterwards.
      // Append-only battle records must not make the displayed score go back.
      if (incomingStage < currentStage || (incomingStage === currentStage && data.events.length < current.events.length)) return false;
    }
    latestRoomData.current = data;
    if (context.role === "teacher") setRecentRooms((items) => [data.room, ...items.filter((item) => item.id !== data.room.id)].slice(0, 20));
    setRoomData(data); setRoom(data.room); setNow(battleNow()); setLastSynced(Date.now());
    return true;
  };
  const refreshRoom = async (roomId = room?.id) => {
    if (!cloud?.enabled || !roomId || !cloud.loadBattleRoom) return;
    if (pendingRefresh.current?.id === roomId) return pendingRefresh.current.promise;
    setSyncing(true);
    const promise = cloud.loadBattleRoom(roomId).then((data) => {
      if (activeRoomId.current !== roomId) return data;
      if (!data?.room) throw new Error("房间已不存在，或当前账号没有读取权限。");
      if (acceptRoomData(data)) setSyncError("");
      setLocalEvents((items) => items.filter((event) => !data.events.some((stored) => stored.id === event.id)));
      return data;
    }).catch((loadError) => {
      if (activeRoomId.current === roomId) setSyncError(loadError.message || "无法同步对战资料，请检查网络。");
      return null;
    }).finally(() => { if (pendingRefresh.current?.promise === promise) pendingRefresh.current = null; if (activeRoomId.current === roomId) setSyncing(false); });
    pendingRefresh.current = { id: roomId, promise };
    return promise;
  };
  useEffect(() => {
    const saved = localStorage.getItem(ROOM_STORAGE_KEY);
    if (context.role === "teacher" && cloud?.listTeacherBattleRooms) {
      cloud.listTeacherBattleRooms().then(setRecentRooms).catch((err) => setSyncError(err.message));
    }
    if (saved && cloud?.enabled) {
      activeRoomId.current = saved;
      void refreshRoom(saved);
    }
    const timer = setInterval(() => setNow(battleNow()), 1000);
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
  const awaitingBracket = room?.status !== "lobby" && room?.requiresTournament && !tournament;
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
  const pair = awaitingBracket ? [] : tournament ? myMatch?.players || [] : canonicalBattlePair(players, events, myPlayer, context.role);
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
  const stageStarted = !awaitingBracket && (tournamentView ? tournamentView.started && tournament.status !== "finished" : true);
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
    if (players.length < 2 || players.length > MAX_BATTLE_PLAYERS) {
      setError(`请等待 2–${MAX_BATTLE_PLAYERS} 名学生加入。`); return;
    }
    setError(""); setBusy(true);
    try { const data = await cloud.startBattleRoom(room.id); acceptRoomData(data); }
    catch (startError) { setError(startError.message || "至少需要两名学生才能开始。"); }
    finally { setBusy(false); }
  };
  const advanceRound = async () => {
    if (!tournamentView?.canAdvance || busy || syncError) return;
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
    const createdAt = Math.floor(battleNow());
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
    h("div", { className: "arena-scene-status" }, h("span", null, "ANCIENT RUINS // 02"), h("i"), h("small", null, "遗迹竞技场")),
    powerupIsVisible ? h("div", { className: `arena-powerup-notice ${latestPowerup.effect}` },
      h("span", null, POWERUPS[latestPowerup.effect].icon),
      h("div", null, h("strong", null, `${pair.find((player) => player.id === latestPowerup.playerId)?.name || "玩家"} 获得${POWERUPS[latestPowerup.effect].name}`), h("small", null, POWERUPS[latestPowerup.effect].description))
    ) : null,
    h(LazyArenaScene, { leftAction: actionFor(pair[0]?.id), rightAction: actionFor(pair[1]?.id), leftPowerup: powerupFor(pair[0]?.id), rightPowerup: powerupFor(pair[1]?.id), winner, winnerSide: winner?.id === pair[1]?.id ? "right" : "left" })
  );
  const roomPicker = context.role === "teacher" && recentRooms.length
    ? h("label", { className: "arena-form-card" }, "查看已有房间（不会重新开赛）",
      h("select", { value: room?.id || "", disabled: busy || syncing || openingRoom, onChange: async (event) => {
        const id = event.target.value;
        if (!id) return;
        setOpeningRoom(true); setError("");
        try {
          const data = await cloud.loadBattleRoom(id);
          if (!data?.room) throw new Error("找不到房间或没有读取权限。");
          activeRoomId.current = id;
          acceptRoomData(data); setLocalEvents([]); setSyncError("");
          localStorage.setItem(ROOM_STORAGE_KEY, id);
        } catch (err) { setError(err.message); } finally { setOpeningRoom(false); }
      } }, h("option", { value: "" }, "选择最近的房间"),
      recentRooms.map((item) => h("option", { key: item.id, value: item.id },
        `${item.code} · ${item.className || "所有班级"} · ${({lobby:"等待学生",battle:"进行中",finished:"已结束",cancelled:"已取消"})[item.status] || item.status}`))))
    : null;
  if (!room) return h("div", { className: "arena-lobby" },
    roomPicker,
    h("div", { className: "arena-intro" }, h("span", { className: "arena-kicker" }, "KNOCKOUT TOURNAMENT"), h("h2", null, "联机淘汰赛"), h("p", null, context.role === "teacher" ? "开设房间，让全班通过验证码加入。随机抽签，胜者逐轮晋级，决出冠亚季军。" : "输入老师提供的验证码。通过答题赢下对战，向冠军发起挑战！")),
    context.role === "teacher" ? h("div", { className: "arena-form-card" }, h("label", null, "选择班级", h("select", { value: className, onChange: (event) => setClassName(event.target.value) }, h("option", { value: "" }, "所有班级"), (context.classes || []).map((item) => h("option", { key: item, value: item }, item)))), h("label", null, "使用题目", h("select", { value: assignmentId, onChange: (event) => setAssignmentId(event.target.value) }, (context.assignments || []).map((item) => h("option", { key: item.id, value: item.id }, item.title)))), h("button", { className: "arena-primary-button", disabled: busy || !cloud?.enabled, onClick: createRoom }, busy ? "正在开设…" : "开设对战房间")) : h("div", { className: "arena-form-card" }, h("label", null, "房间验证码", h("input", { value: code, onChange: (event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6)), inputMode: "numeric", placeholder: "输入 6 位数字" })), h("button", { className: "arena-primary-button", disabled: busy || code.length !== 6 || !cloud?.enabled, onClick: joinRoom }, busy ? "正在加入…" : "加入竞技场")),
    context.role === "teacher"
      ? h("div", { className: "arena-teacher-intro-cards" },
        h("article", null, h("span", null, "01"), h("strong", null, "开设房间"), h("small", null, "选择班级和题目后生成验证码")),
        h("article", null, h("span", null, "02"), h("strong", null, "全员首轮参战"), h("small", null, `2–${MAX_BATTLE_PLAYERS} 人，奇数也能开始；每轮最多一人轮空`)),
        h("article", null, h("span", null, "03"), h("strong", null, "逐轮晋级"), h("small", null, "查看全班实时分数，决出冠亚季军"))
      )
      : h("div", { className: "arena-lobby-preview" }, scene),
    !cloud?.enabled ? h("p", { className: "arena-warning" }, "云端功能尚未连接，无法进行跨装置联机对战。") : null,
    error || syncError ? h("p", { className: "arena-error" }, error || syncError) : null
  );

  const readyToStart = players.length >= 2 && players.length <= MAX_BATTLE_PLAYERS;
  const answered = answeredRound === answerKey || myStats.lastRound >= round;
  const interrupted = freezeActive || maskActive;
  const inputLocked = answered || !myPlayer || gameEnded || interrupted || !stageStarted;
  const countdown = Math.max(0, Math.ceil((new Date(startTime).getTime() - now) / 1000));
  const questionStatus = !stageStarted ? `${countdown} 秒后开始作答` : gameEnded ? "对战已经结束" : freezeActive ? `被冻结 ${debuffSecondsLeft} 秒` : maskActive ? `遮罩剩余 ${debuffSecondsLeft} 秒` : answered ? "已作答，等待下一回合" : "答对即可攻击对手";
  const isFinalStage = tournament?.matches.some((match) => match.kind === "final");
  const completedTournament = tournament?.status === "finished";
  const hasDuel = !tournament || myMatch?.players.length === 2;
  return h("div", { className: "arena-battle-shell" },
    roomPicker,
    h("div", { className: "arena-room-bar" }, h("div", null,
      h("span", { className: "arena-kicker" }, completedTournament ? "TOURNAMENT COMPLETE" : room.status === "battle" ? "BATTLE LIVE" : "WAITING ROOM"), h("h2", null, `房间 ${room.code}`),
      h("p", null, `${room.className ? `${room.className} · ` : ""}${visiblePlayerCount} / ${MAX_BATTLE_PLAYERS} 名学生`),
      room.status === "lobby" ? h("p", { className: `arena-capacity${players.length > MAX_BATTLE_PLAYERS ? " is-full" : ""}` }, players.length > MAX_BATTLE_PLAYERS ? "人数超过上限，请重新分组开设房间。" : players.length % 2 ? "奇数也可开赛，本轮仅一人轮空，其余全部参战。" : "首轮全员 1 对 1，不安排轮空。") : null),
      h("div", { className: "arena-room-actions" }, room.status === "lobby" && context.role === "teacher" ? h("button", { className: "arena-primary-button", disabled: busy || !readyToStart || !questions.length, onClick: startRoom }, busy ? "正在抽签…" : players.length > MAX_BATTLE_PLAYERS ? `最多 ${MAX_BATTLE_PLAYERS} 人` : readyToStart ? "抽签并开始淘汰赛" : "至少需要 2 名学生") : null,
        h("button", { className: "arena-ghost-button", onClick: () => { localStorage.removeItem(ROOM_STORAGE_KEY); activeRoomId.current = null; latestRoomData.current = null; setRoom(null); setRoomData(null); setLocalEvents([]); setAnsweredRound(""); setLastSynced(null); setSyncing(false); setSyncError(""); } }, "离开房间"))),
    error || syncError ? h("p", { className: "arena-error", role: "alert" }, error || syncError, h("button", { className: "arena-ghost-button", onClick: () => { setError(""); setSyncError(""); void refreshRoom(room.id); } }, "重新同步")) : null,
    tournament ? h("section", { className: "arena-tournament-stage" },
      h("div", null, h("span", { className: "arena-kicker" }, `ROUND ${completedTournament ? tournament.history.length : tournament.stageIndex + 1}`), h("h3", null, completedTournament ? "比赛名次已揭晓" : tournamentView.label), h("p", null, completedTournament ? "本届淘汰赛结束，所有赛果已保存。" : !stageStarted ? `准备入场 · ${countdown} 秒后开始` : tournamentView.allFinished ? "本轮已结束，等待老师确认赛果。" : tournamentView.label === "三人半决赛" ? "一人轮空进决赛；另一场胜者晋级、败者获得季军。" : "胜者晋级 · 后续奇数轮最多一人轮空")),
      context.role === "teacher" && !completedTournament ? h("button", { className: "arena-primary-button", disabled: busy || Boolean(syncError) || !tournamentView.canAdvance, onClick: advanceRound }, busy ? "正在保存赛程…" : tournamentView.allFinished && !tournamentView.canAdvance ? "正在确认分数…" : isFinalStage ? "公布最终排名" : "开始下一轮") : null
    ) : null,
    completedTournament ? h(TournamentPodium, { standings: tournamentView.standings }) : null,
    room.status === "lobby" ? h("div", { className: "arena-waiting" }, h("div", { className: "arena-code-display" }, h("small", null, "学生加入验证码"), h("strong", null, room.code)), h("div", { className: "arena-player-list" }, players.map((player, index) => h("div", { className: "arena-player-chip", key: player.id }, h("span", null, index % 2 ? "♟" : "♞"), h("strong", null, player.name), h("small", null, "等待随机抽签")))), h("p", { className: "arena-hint" }, `最多 ${MAX_BATTLE_PLAYERS} 人，2–40 名学生均可开始，每轮奇数人数仅一人轮空。至少 3 人才能决出冠亚季军；2 人仅决出冠亚军。老师可切换每轮比分并查看所有学生累计分数。`))
      : awaitingBracket ? h("section", { className: "arena-round-waiting", role: "status" }, h("h3", null, "正在同步正式赛程"), h("p", null, "完整配对资料尚未收到，暂不显示临时对手或 0 分比分。"),
        context.role === "teacher" ? h("button", { className: "arena-primary-button", onClick: startRoom, disabled: busy }, busy ? "正在恢复赛程…" : "重试生成赛程") : h("p", null, "请留在房间，等待老师恢复赛程。"),
        h("button", { className: "arena-ghost-button", onClick: () => void refreshRoom(room.id), disabled: syncing }, "重新同步"))
      : context.role === "teacher" ? tournament
        ? h(TeacherTournamentDashboard, { key: tournament.id, state: tournament, view: tournamentView, lastSynced, syncing, syncError, clockSynchronized: roomData?.clockSynchronized, onRetry: () => void refreshRoom(room.id) })
        : h(TeacherBattleDashboard, { players, events: scoredEvents, timeLeft, roomStatus: room.status, lastSynced })
      : hasDuel ? h(React.Fragment, null,
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
        tournament && !completedTournament ? h("span", null, myMatch.kind === "final" || myMatch.kind === "bronze" ? "等待老师公布最终排名。" : winner?.id === myPlayer?.id ? "已晋级，等待老师开始下一轮。" : tournamentView.label === "三人半决赛" ? "你获得季军席位，等待老师确认赛果。" : tournamentView.label.includes("半决赛") ? "请留在房间，下一轮参加季军赛。" : "本次止步于此，可以继续查看赛程。") : null
      ) : null
    ) : h("section", { className: "arena-round-waiting" },
      h("span", { "aria-hidden": "true" }, myMatch?.players.length === 1 ? "✦" : "⚑"),
      h("h3", null, myMatch?.players.length === 1 ? "本轮轮空，已晋级" : tournament?.thirdPlacePlayerId === myPlayer?.id ? "你已获得季军" : "你的对战已完成"),
      h("p", null, myMatch?.players.length === 1 ? "请留在房间，等待老师开始下一轮。" : completedTournament ? "感谢参与！下方可以查看完整赛程与赛果。" : "你可以继续查看本轮比分，为同学加油。"),
      myLastMatch ? h("p", null, `上一场：${myLastMatch.players.map((player, index) => `${player.name} ${myLastMatch.stats[index].score} 分`).join(" · ")}`) : null,
      h(TeacherBattleDashboard, { compact: true, matchList: tournamentView?.matches || [], title: "本轮赛况" })
    ),
    tournament?.history?.length && context.role !== "teacher" ? h("details", { className: "arena-history" }, h("summary", null, "查看已完成赛程与比分"), tournament.history.map((stage) => h(TeacherBattleDashboard, { key: stage.stageIndex, compact: true, historical: true, matchList: stage.matches, title: `第 ${stage.stageIndex + 1} 轮 · ${stage.label}` }))) : null,
    tournament ? h("details", { className: "arena-tournament-rules" }, h("summary", null, "淘汰赛规则"), h("p", null, "每局最长 3 分钟；一方生命值归零，或时间结束，即结束该局。时间结束先比较得分，同分依次比较生命值、答对题数、累计答题用时；若完全相同，按赛前随机抽签顺序决定晋级。"), h("p", null, tournament.version >= 2 ? `最多 ${MAX_BATTLE_PLAYERS} 人，偶数人数全员参战，奇数人数每轮仅一人轮空，优先安排尚未轮空者。4 人半决赛败者参加季军赛；剩余 3 人时一人轮空入决赛，另一场败者直接获得季军。每轮由老师确认后开始，有 8 秒准备时间。` : "此房间保留原有赛程规则，不重新抽签。半决赛败者参加季军赛。每轮由老师确认后开始，有 8 秒准备时间。")) : null,
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
