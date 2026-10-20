// Shared, DOM-free battle rules. Tournament snapshots are persisted in the
// existing battle_events stream, so refreshing never reshuffles the bracket.
export const TOURNAMENT_PREFIX = "tournament:";
export const MAX_BATTLE_PLAYERS = 40;
const MATCH_PREFIX = "match:";
const POWERUPS = new Set(["shield", "heal", "freeze", "mask"]);
const QUESTION_SECONDS = 10;
const ADVANCE_GRACE_MS = 2000;

const timestamp = (value) => typeof value === "number" ? value : Date.parse(value || "");
const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const byEventTime = (a, b) => (timestamp(a.createdAt) || 0) - (timestamp(b.createdAt) || 0)
  || String(a.id || "").localeCompare(String(b.id || ""));
const isLocal = (event) => String(event.id || "").startsWith("local-");

export function encodeBattleEffect({ matchId, effect = "" }) {
  return matchId ? `${MATCH_PREFIX}${JSON.stringify({ matchId: String(matchId), effect: String(effect) })}` : String(effect);
}

export function decodeBattleEffect(raw) {
  const effect = String(raw || "");
  if (effect.startsWith(MATCH_PREFIX)) {
    try {
      const value = JSON.parse(effect.slice(MATCH_PREFIX.length));
      if (typeof value.matchId === "string" && value.matchId && typeof value.effect === "string") {
        return { matchId: value.matchId, effect: value.effect };
      }
    } catch { /* A malformed event must not prevent rendering the room. */ }
  }
  return { matchId: "", effect };
}

function normalizeEvent(event) {
  const decoded = decodeBattleEffect(event.effect);
  return { ...event, effect: decoded.effect, matchId: event.matchId || decoded.matchId };
}

function uniqueCombatEvents(events) {
  const unique = new Map();
  for (const event of (events || []).map(normalizeEvent).sort(byEventTime)) {
    if (event.type !== "answer" && !(event.type === "skill" && POWERUPS.has(event.effect))) continue;
    // A question allows one answer and at most one earned item per player.
    // Remote rows supersede optimistic rows, but retries cannot inflict damage twice.
    const key = [event.matchId || "", event.playerId, event.round, event.type].join("|");
    const existing = unique.get(key);
    if (!existing || (isLocal(existing) && !isLocal(event))) unique.set(key, event);
  }
  return [...unique.values()].sort(byEventTime);
}

function initialStats() {
  return { hp: 100, score: 0, streak: 0, shield: 0, frozenRound: -1, maskedRound: -1,
    lastReward: "", lastAction: "idle", lastRound: -1, correctCount: 0,
    answerCount: 0, responseMs: 0, lastAnswerAt: null };
}

export function battleStats(players, events) {
  const stats = new Map(players.map((player) => [player.id, initialStats()]));
  let healthEnded = false;
  for (const event of uniqueCombatEvents(events)) {
    if (healthEnded) break;
    const own = stats.get(event.playerId);
    if (!own) continue;
    const fallbackTarget = players.find((player) => player.id !== event.playerId);
    const targetId = event.targetPlayerId !== event.playerId && stats.has(event.targetPlayerId)
      ? event.targetPlayerId : fallbackTarget?.id;
    const target = stats.get(targetId);
    if (event.type === "skill") {
      own.lastReward = event.effect;
      if (event.effect === "shield") own.shield += 1;
      if (event.effect === "heal") own.hp = Math.min(100, own.hp + 20);
      if (event.effect === "freeze" && target) target.frozenRound = Math.max(target.frozenRound, finite(event.round) + 1);
      if (event.effect === "mask" && target) target.maskedRound = Math.max(target.maskedRound, finite(event.round) + 1);
      continue;
    }
    own.lastRound = Math.max(own.lastRound, finite(event.round));
    own.answerCount += 1;
    own.responseMs += Math.max(0, finite(event.responseMs));
    own.lastAnswerAt = Number.isFinite(timestamp(event.createdAt)) ? timestamp(event.createdAt) : own.lastAnswerAt;
    if (event.correct) {
      own.score += 100 + Math.max(0, own.streak) * 25;
      own.streak += 1;
      own.correctCount += 1;
      own.lastAction = "attack";
    } else {
      own.streak = 0;
      own.lastAction = "idle";
    }
    if (event.correct && target) {
      if (target.shield > 0) {
        target.shield -= 1;
        target.lastAction = "shield";
      } else {
        target.hp = Math.max(0, target.hp - Math.max(1, finite(event.damage, 20) || 20));
        target.lastAction = "hit";
        if (target.hp <= 0) healthEnded = true;
      }
    }
  }
  return stats;
}

// Legacy rooms can still end in a draw. Tournament matches add an explicit,
// deterministic tie-break below because a bracket needs exactly one winner.
export function resolveBattleResult(players, stats, timeLeft) {
  if (players.length < 2) return { ended: false, winner: null, tied: false, reason: "" };
  const left = stats.get(players[0].id) || initialStats();
  const right = stats.get(players[1].id) || initialStats();
  const healthEnded = left.hp <= 0 || right.hp <= 0;
  if (!healthEnded && timeLeft > 0) return { ended: false, winner: null, tied: false, reason: "" };
  let winner = null;
  if (left.hp <= 0 && right.hp > 0) winner = players[1];
  else if (right.hp <= 0 && left.hp > 0) winner = players[0];
  else if (left.score !== right.score) winner = left.score > right.score ? players[0] : players[1];
  return { ended: true, winner, tied: !winner, reason: healthEnded ? "health" : "time" };
}

function playerSnapshot(player) {
  return { id: String(player.id), studentId: player.studentId || "", name: player.name || "学生",
    className: player.className || "", roomId: player.roomId || "", status: player.status || "playing" };
}

function selectByePlayer(playerIds, history, roster) {
  const byeCounts = new Map(playerIds.map((id) => [id, 0]));
  let previousByes = new Set();
  for (const stage of history) {
    previousByes = new Set();
    for (const match of stage.matches) {
      if (match.kind !== "main" || match.playerIds?.length !== 1) continue;
      const id = match.playerIds[0];
      byeCounts.set(id, (byeCounts.get(id) || 0) + 1);
      previousByes.add(id);
    }
  }
  const seedOrder = new Map(roster.map((player, index) => [player.id, index]));
  return [...playerIds].sort((a, b) => byeCounts.get(a) - byeCounts.get(b)
    || Number(previousByes.has(a)) - Number(previousByes.has(b))
    || seedOrder.get(a) - seedOrder.get(b))[0];
}

function stageMatches(tournamentId, stageIndex, playerIds, { version = 1, firstStage = false, history = [], roster = [] } = {}) {
  const matches = [];
  const add = (ids) => matches.push({ id: `${tournamentId}:${stageIndex}:main:${matches.length + 1}`,
    kind: playerIds.length === 2 ? "final" : "main", playerIds: ids });
  if (version === 1 && firstStage && (playerIds.length & (playerIds.length - 1))) {
    // Preserve the old power-of-two bracket for saved version-1 tournaments.
    const nextSize = 2 ** Math.floor(Math.log2(playerIds.length));
    const preliminaryCount = playerIds.length - nextSize;
    let cursor = 0;
    for (let index = 0; index < preliminaryCount; index += 1) add(playerIds.slice(cursor, cursor += 2));
    while (cursor < playerIds.length) add([playerIds[cursor++]]);
  } else {
    // Version 2 lets every entrant play in the first (even-sized) round.
    // Later odd rounds need only one bye, not a power-of-two preliminary.
    // Choose it from persisted history/seed order, never a fresh random draw.
    const byeId = version === 2 && playerIds.length % 2
      ? selectByePlayer(playerIds, history, roster) : null;
    const pairedIds = byeId ? playerIds.filter((id) => id !== byeId) : playerIds;
    for (let index = 0; index < pairedIds.length; index += 2) add(pairedIds.slice(index, index + 2));
    if (byeId) add([byeId]);
  }
  return matches;
}

export function createTournament(players, { id, startedAt, durationSeconds = 180, random = Math.random } = {}) {
  if (!Array.isArray(players) || players.length < 2) throw new Error("至少需要两名学生。");
  if (players.length > MAX_BATTLE_PLAYERS) throw new Error(`每个房间最多允许 ${MAX_BATTLE_PLAYERS} 名学生参赛。`);
  if (players.some((player) => !player?.id) || new Set(players.map((player) => player.id)).size !== players.length) throw new Error("参赛学生资料重复或不完整。");
  if (!id || !Number.isFinite(timestamp(startedAt))) throw new Error("淘汰赛编号或开始时间无效。");
  const roster = players.map(playerSnapshot);
  for (let index = roster.length - 1; index > 0; index -= 1) {
    const chosen = Math.min(index, Math.max(0, Math.floor(finite(random()) * (index + 1))));
    [roster[index], roster[chosen]] = [roster[chosen], roster[index]];
  }
  return { version: 2, id: String(id), stageIndex: 0, startedAt: new Date(timestamp(startedAt)).toISOString(),
    durationSeconds: Math.max(1, finite(durationSeconds, 180)), roster,
    matches: stageMatches(String(id), 0, roster.map((player) => player.id), { version: 2, firstStage: true, roster }), history: [], status: "battle" };
}

function validState(state) {
  if (!state || ![1, 2].includes(state.version) || typeof state.id !== "string" || !state.id
    || !Number.isInteger(state.stageIndex) || state.stageIndex < 0
    || !Number.isFinite(timestamp(state.startedAt)) || !(state.durationSeconds > 0)
    || !["battle", "finished"].includes(state.status) || !Array.isArray(state.roster) || state.roster.length < 2
    || !Array.isArray(state.matches) || !state.matches.length || !Array.isArray(state.history)) return false;
  const ids = new Set(state.roster.map((player) => player?.id));
  return !ids.has(undefined) && ids.size === state.roster.length
    && (state.thirdPlacePlayerId === undefined || (state.version === 2 && ids.has(state.thirdPlacePlayerId)))
    && state.matches.every((match) => match?.id && ["main", "final", "bronze"].includes(match.kind)
      && Array.isArray(match.playerIds) && match.playerIds.length >= 1 && match.playerIds.length <= 2
      && new Set(match.playerIds).size === match.playerIds.length && match.playerIds.every((id) => ids.has(id)))
    && state.history.every((stage) => stage && Array.isArray(stage.matches));
}

export function readTournament(events) {
  const candidates = [];
  for (const event of [...(events || [])].sort(byEventTime)) {
    const effect = String(event.effect || "");
    if (!effect.startsWith(TOURNAMENT_PREFIX)) continue;
    try {
      const state = JSON.parse(effect.slice(TOURNAMENT_PREFIX.length));
      if (validState(state)) candidates.push({ state, event });
    } catch { /* Ignore incomplete or old metadata; keep the last valid stage. */ }
  }
  if (!candidates.length) return null;
  const latestId = candidates[candidates.length - 1].state.id;
  return candidates.filter(({ state }) => state.id === latestId)
    .sort((a, b) => a.state.stageIndex - b.state.stageIndex
      || Number(a.state.status === "finished") - Number(b.state.status === "finished")
      || byEventTime(a.event, b.event)).at(-1).state;
}

function tournamentLabel(state) {
  if (state.status === "finished") return "比赛结束";
  if (state.matches.some((match) => match.kind === "bronze")) return "决赛与季军赛";
  if (state.matches.some((match) => match.kind === "final")) return "决赛";
  if (state.version === 2) {
    const entrants = state.matches.reduce((count, match) => count + match.playerIds.length, 0);
    if (entrants === 3) return "三人半决赛";
    if (entrants === 4) return "半决赛";
    return `${entrants} 强赛`;
  }
  if (state.matches.some((match) => match.playerIds.length === 1)) return "预选赛";
  if (state.matches.length === 2) return "半决赛";
  return `${state.matches.length * 2} 强赛`;
}

function tieBreak(players, stats, roster) {
  const left = stats.get(players[0].id);
  const right = stats.get(players[1].id);
  for (const [key, reason, descending] of [["hp", "hp", true], ["correctCount", "correct", true], ["responseMs", "speed", false]]) {
    if (left[key] !== right[key]) {
      return { winner: (descending ? left[key] > right[key] : left[key] < right[key]) ? players[0] : players[1], reason };
    }
  }
  const seedOrder = new Map(roster.map((player, index) => [player.id, index]));
  return { winner: seedOrder.get(players[0].id) < seedOrder.get(players[1].id) ? players[0] : players[1], reason: "seed" };
}

function cumulativeScores(state, matches) {
  const allMatches = new Map();
  for (const stage of state.history || []) for (const match of stage.matches) allMatches.set(match.id, match);
  for (const match of matches) allMatches.set(match.id, match);
  const scores = new Map(state.roster.map((player) => [player.id, 0]));
  for (const match of allMatches.values()) {
    (match.players || []).forEach((player, index) => scores.set(player.id,
      (scores.get(player.id) || 0) + finite(match.stats?.[index]?.score)));
  }
  return scores;
}

function tournamentStandings(state, matches) {
  const scores = cumulativeScores(state, matches);
  const final = matches.find((match) => match.kind === "final" && match.finished);
  const bronze = matches.find((match) => match.kind === "bronze" && match.finished);
  const placements = new Map();
  if (final?.winner) placements.set(final.winner.id, 1);
  if (final?.loser) placements.set(final.loser.id, 2);
  if (bronze?.winner) placements.set(bronze.winner.id, 3);
  if (bronze?.loser) placements.set(bronze.loser.id, 4);
  // Three survivors yield one actual semifinal loser. That student is third,
  // not a fabricated one-player bronze fight and not an extra scored win.
  if (state.version === 2 && state.thirdPlacePlayerId && !placements.has(state.thirdPlacePlayerId)) {
    placements.set(state.thirdPlacePlayerId, 3);
  }
  return state.roster.map((player, seed) => ({ place: placements.get(player.id) || null, player,
    score: scores.get(player.id) || 0, seed }))
    .sort((a, b) => (a.place || Infinity) - (b.place || Infinity) || b.score - a.score || a.seed - b.seed)
    .map(({ seed, ...entry }) => entry);
}

export function buildTournamentView(state, events, now = Date.now()) {
  if (!validState(state)) throw new Error("淘汰赛资料不完整，请重新加载房间。");
  const currentTime = timestamp(now);
  const start = timestamp(state.startedAt);
  const deadline = start + state.durationSeconds * 1000;
  const started = currentTime >= start;
  const timeLeft = Math.max(0, Math.min(state.durationSeconds, Math.ceil((deadline - currentTime) / 1000)));
  const roster = new Map(state.roster.map((player) => [player.id, player]));
  const normalized = (events || []).map(normalizeEvent);
  const matches = state.matches.map((match, index) => {
    const players = match.playerIds.map((id) => roster.get(id));
    const playerIds = new Set(match.playerIds);
    // Once the teacher commits the final podium, replay its persisted result.
    // Delayed delivery or an incomplete event page cannot rewrite a finished cup.
    const committed = state.status === "finished"
      ? [...state.history].reverse().flatMap((stage) => stage.matches).find((entry) => entry.id === match.id)
      : null;
    if (committed?.finished && Array.isArray(committed.stats) && committed.stats.length === players.length) {
      const stats = committed.stats.map((stat) => ({ ...stat }));
      return { ...committed, players, stats, statsMap: new Map(players.map((player, playerIndex) => [player.id, stats[playerIndex]])),
        events: [], started: true };
    }
    const matchEvents = uniqueCombatEvents(normalized.filter((event) => {
      const createdAt = timestamp(event.createdAt);
      return event.matchId === match.id && playerIds.has(event.playerId)
        && Number.isInteger(Number(event.round)) && Number(event.round) >= 0
        && Number.isFinite(createdAt) && createdAt >= start && createdAt <= deadline && createdAt <= currentTime;
    }).map((event) => ({ ...event, responseMs: Number.isFinite(Number(event.responseMs))
      ? Math.max(0, Number(event.responseMs))
      : Math.max(0, Math.min(QUESTION_SECONDS * 1000, timestamp(event.createdAt) - start - Number(event.round) * QUESTION_SECONDS * 1000)) })));
    const statsMap = battleStats(players, matchEvents);
    const stats = players.map((player) => statsMap.get(player.id));
    const bye = players.length === 1;
    let result = bye ? { ended: true, winner: players[0], tied: false, reason: "bye" }
      : resolveBattleResult(players, statsMap, started ? timeLeft : 1);
    if (result.ended && result.tied) result = { ...result, ...tieBreak(players, statsMap, state.roster), tied: false };
    const loser = result.winner ? players.find((player) => player.id !== result.winner.id) || null : null;
    const finishedAt = !result.ended ? null : bye ? start : result.reason === "health"
      ? Math.max(start, ...stats.map((stat) => stat.lastAnswerAt || start)) : deadline;
    return { ...match, number: index + 1, players, events: matchEvents, stats, statsMap,
      answerCount: stats.reduce((sum, stat) => sum + stat.answerCount, 0),
      currentRound: Math.max(-1, ...stats.map((stat) => stat.lastRound)) + 1,
      timeLeft, started, finished: result.ended, winner: result.winner, loser,
      tied: result.tied, reason: result.reason, finishedAt };
  });
  const allFinished = matches.every((match) => match.finished);
  const actualMatches = matches.filter((match) => match.players.length === 2);
  const finishedAt = allFinished ? Math.max(start, ...actualMatches.map((match) => match.finishedAt || start)) : null;
  return { matches, allFinished, canAdvance: state.status === "battle" && allFinished
    && currentTime >= finishedAt + ADVANCE_GRACE_MS, finishedAt,
    standings: tournamentStandings(state, matches), label: tournamentLabel(state), timeLeft, started };
}

function completedSnapshot(match) {
  const { events, statsMap, ...snapshot } = match;
  return snapshot;
}

export function advanceTournament(state, events, now = Date.now()) {
  const view = buildTournamentView(state, events, now);
  if (!view.canAdvance) throw new Error("本轮尚未结束，或对战结果仍在同步，请稍候。");
  const history = [...state.history.filter((stage) => stage.stageIndex !== state.stageIndex), {
    stageIndex: state.stageIndex, label: view.label, startedAt: state.startedAt,
    durationSeconds: state.durationSeconds, matches: view.matches.map(completedSnapshot)
  }];
  if (view.matches.some((match) => match.kind === "final")) {
    return { ...state, stageIndex: state.stageIndex + 1, history, status: "finished", standings: view.standings };
  }
  const mainMatches = view.matches.filter((match) => match.kind === "main");
  const winners = mainMatches.map((match) => match.winner.id);
  const stageIndex = state.stageIndex + 1;
  const matches = stageMatches(state.id, stageIndex, winners, { version: state.version, history, roster: state.roster });
  const placement = {};
  if (winners.length === 2) {
    const semifinalLosers = mainMatches.map((match) => match.loser?.id).filter(Boolean);
    if (semifinalLosers.length === 2) matches.push({ id: `${state.id}:${stageIndex}:bronze:1`, kind: "bronze", playerIds: semifinalLosers });
    else if (state.version === 2 && semifinalLosers.length === 1
      && mainMatches.reduce((count, match) => count + match.players.length, 0) === 3) {
      placement.thirdPlacePlayerId = semifinalLosers[0];
    }
  }
  return { ...state, stageIndex, startedAt: new Date(timestamp(now) + 8000).toISOString(),
    matches, history, ...placement, status: "battle" };
}
