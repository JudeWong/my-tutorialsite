import assert from "node:assert/strict";
import {
  TOURNAMENT_PREFIX, advanceTournament, battleStats, buildTournamentView,
  createTournament, decodeBattleEffect, encodeBattleEffect, readTournament,
  resolveBattleResult
} from "../battle-engine.js";

const BASE = Date.parse("2026-10-15T08:00:00.000Z");
const roster = (count) => Array.from({ length: count }, (_, index) => ({
  id: `player-${index + 1}`, studentId: `student-${index + 1}`,
  name: `学生${index + 1}`, className: "高一甲", roomId: "room-1"
}));
const create = (count, extra = {}) => createTournament(roster(count), {
  id: `cup-${count}`, startedAt: BASE, durationSeconds: 30, random: () => 0.999999, ...extra
});
let serial = 0;
function answer(state, match, side = 0, extra = {}) {
  return { id: `answer-${++serial}`, roomId: "room-1", matchId: match.id,
    playerId: match.playerIds[side], targetPlayerId: match.playerIds[1 - side],
    type: "answer", round: 0, correct: true, damage: 100, effect: "",
    createdAt: new Date(Date.parse(state.startedAt) + 1000).toISOString(), ...extra };
}
const knockoutStage = (state, side = 0) => state.matches.filter((match) => match.playerIds.length === 2)
  .map((match) => answer(state, match, side));
const at = (state, offset) => Date.parse(state.startedAt) + offset;
const test = (name, fn) => { fn(); console.log(`PASS ${name}`); };

test("creation shuffles once without mutating the roster and validates entrants", () => {
  const players = roster(8);
  const original = JSON.stringify(players);
  const state = createTournament(players, { id: "shuffle", startedAt: BASE, random: () => 0 });
  assert.equal(JSON.stringify(players), original);
  assert.notDeepEqual(state.roster.map((player) => player.id), players.map((player) => player.id));
  assert.equal(new Set(state.roster.map((player) => player.id)).size, 8);
  assert.throws(() => create(1), /偶数/);
  assert.throws(() => create(3), /偶数/);
  assert.throws(() => createTournament([players[0], players[0]], { id: "dup", startedAt: BASE }), /重复/);
});

test("two players produce champion and runner-up with no invented bronze", () => {
  const state = create(2);
  assert.equal(state.matches[0].kind, "final");
  const events = knockoutStage(state, 1);
  assert.equal(buildTournamentView(state, events, BASE + 1500).canAdvance, false);
  assert.throws(() => advanceTournament(state, events, BASE + 1500), /同步/);
  const finished = advanceTournament(state, events, BASE + 3000);
  assert.equal(finished.status, "finished");
  assert.equal(finished.stageIndex, state.stageIndex + 1);
  assert.equal(finished.standings.find((entry) => entry.place === 1).player.id, "player-2");
  assert.equal(finished.standings.find((entry) => entry.place === 2).player.id, "player-1");
  assert.equal(finished.standings.some((entry) => entry.place === 3), false);
  assert.equal(finished.history.length, 1);
  assert.equal(state.history.length, 0);
  assert.equal(state.status, "battle");
  assert.equal(buildTournamentView(finished, events, BASE + 3000).canAdvance, false);
});

test("four players advance winners to final and semifinal losers to bronze", () => {
  const state = create(4);
  assert.equal(buildTournamentView(state, [], BASE).label, "半决赛");
  const firstEvents = knockoutStage(state);
  const final = advanceTournament(state, firstEvents, BASE + 3000);
  assert.equal(Date.parse(final.startedAt), BASE + 11000);
  assert.equal(final.stageIndex, 1);
  assert.deepEqual(final.matches.find((match) => match.kind === "final").playerIds, ["player-1", "player-3"]);
  assert.deepEqual(final.matches.find((match) => match.kind === "bronze").playerIds, ["player-2", "player-4"]);
  assert.equal(buildTournamentView(final, firstEvents, BASE + 4000).started, false);
  assert.equal(buildTournamentView(final, firstEvents, at(final, 0)).matches[0].stats[0].hp, 100);
  assert.equal(buildTournamentView(final, firstEvents, at(final, 0)).matches[0].stats[0].score, 0);
  const finalEvents = [...firstEvents, ...knockoutStage(final, 1)];
  const finished = advanceTournament(final, finalEvents, at(final, 3000));
  assert.deepEqual(finished.standings.map((entry) => [entry.place, entry.player.id, entry.score]), [
    [1, "player-3", 200], [2, "player-1", 100], [3, "player-4", 100], [4, "player-2", 0]
  ]);
  assert.equal(finished.history.length, 2);
  assert.equal(finished.history[0].matches[0].statsMap, undefined);
  assert.equal(finished.history[0].matches[0].events, undefined);
  assert.deepEqual(buildTournamentView(finished, finalEvents, at(final, 4000)).standings, finished.standings);
  const restored = JSON.parse(JSON.stringify(finished));
  assert.deepEqual(buildTournamentView(restored, [], at(final, 5000)).standings, finished.standings);
  assert.equal(buildTournamentView(restored, [], at(final, 5000)).matches[0].stats[1].score, 100);
});

test("six players receive persisted byes and still produce a valid top three", () => {
  let state = create(6);
  assert.equal(state.matches.length, 4);
  assert.equal(state.matches.filter((match) => match.playerIds.length === 1).length, 2);
  const initialView = buildTournamentView(state, [], BASE);
  assert.equal(initialView.label, "预选赛");
  assert.equal(initialView.allFinished, false);
  assert.equal(initialView.matches.filter((match) => match.reason === "bye").length, 2);
  let events = knockoutStage(state);
  state = advanceTournament(state, events, at(state, 3000));
  assert.equal(state.matches.length, 2);
  assert.equal(buildTournamentView(state, events, at(state, 0)).label, "半决赛");
  events.push(...knockoutStage(state));
  state = advanceTournament(state, events, at(state, 3000));
  assert.equal(state.matches[0].kind, "final");
  assert.equal(state.matches[1].kind, "bronze");
  events.push(...knockoutStage(state));
  state = advanceTournament(state, events, at(state, 3000));
  assert.equal(state.status, "finished");
  assert.deepEqual(state.standings.slice(0, 3).map((entry) => entry.place), [1, 2, 3]);
  assert.equal(new Set(state.standings.slice(0, 3).map((entry) => entry.player.id)).size, 3);
  assert.equal(state.history.length, 3);
});

test("eight, ten, and sixteen players advance every entrant at most once per stage", () => {
  for (const count of [8, 10, 16]) {
    let state = create(count);
    const events = [];
    let stages = 0;
    while (state.status !== "finished") {
      const ids = state.matches.flatMap((match) => match.playerIds);
      assert.equal(new Set(ids).size, ids.length);
      events.push(...knockoutStage(state));
      state = advanceTournament(state, events, at(state, 3000));
      assert.ok(++stages <= 5);
    }
    assert.equal(state.standings.length, count);
    assert.equal(state.standings.filter((entry) => entry.place === 3).length, 1);
  }
});

test("a knockout ends immediately; later answers cannot score or revive the loser", () => {
  const state = create(2);
  const match = state.matches[0];
  const events = [answer(state, match), answer(state, match, 1, {
    round: 1, createdAt: new Date(BASE + 2000).toISOString()
  }), answer(state, match, 1, {
    id: "late-heal", type: "skill", effect: "heal", round: 2,
    createdAt: new Date(BASE + 2500).toISOString()
  })];
  const result = buildTournamentView(state, events, BASE + 3000).matches[0];
  assert.equal(result.winner.id, "player-1");
  assert.equal(result.reason, "health");
  assert.equal(result.finishedAt, BASE + 1000);
  assert.equal(result.stats[1].hp, 0);
  assert.equal(result.stats[1].score, 0);
  assert.equal(result.answerCount, 1);
});

test("combat scoring, shields, healing, freeze and mask preserve their semantics", () => {
  const players = roster(2);
  const event = (id, playerId, round, type, effect, correct, damage = 20) => ({
    id, playerId, round, type, effect, correct, damage,
    createdAt: new Date(BASE + Number(id.slice(1)) * 100).toISOString(), responseMs: 250
  });
  const stats = battleStats(players, [
    event("e1", "player-1", 0, "skill", "shield"),
    event("e2", "player-2", 0, "answer", "", true),
    event("e3", "player-2", 1, "answer", "", true),
    event("e4", "player-1", 1, "skill", "heal"),
    event("e5", "player-1", 2, "answer", "", true),
    event("e6", "player-1", 2, "skill", "freeze"),
    event("e7", "player-1", 3, "answer", "", true),
    event("e8", "player-1", 3, "skill", "mask"),
    event("e9", "player-1", 4, "answer", "", false)
  ]);
  assert.equal(stats.get("player-1").hp, 100);
  assert.equal(stats.get("player-1").shield, 0);
  assert.equal(stats.get("player-1").score, 225);
  assert.equal(stats.get("player-1").streak, 0);
  assert.equal(stats.get("player-1").responseMs, 750);
  assert.equal(stats.get("player-2").hp, 60);
  assert.equal(stats.get("player-2").frozenRound, 3);
  assert.equal(stats.get("player-2").maskedRound, 4);
});

test("legacy timeout draws are preserved while tournament ties use fixed seeds", () => {
  const players = roster(2);
  const stats = battleStats(players, []);
  assert.equal(resolveBattleResult(players, stats, 0).tied, true);
  const state = create(2);
  const before = buildTournamentView(state, [], BASE + 29999);
  assert.equal(before.allFinished, false);
  const expired = buildTournamentView(state, [], BASE + 30000);
  assert.equal(expired.matches[0].winner.id, state.roster[0].id);
  assert.equal(expired.matches[0].reason, "seed");
  assert.equal(expired.canAdvance, false);
  assert.equal(buildTournamentView(state, [], BASE + 32000).canAdvance, true);
  assert.equal(buildTournamentView(state, [], BASE + 50000).matches[0].winner.id, expired.matches[0].winner.id);
});

test("timeout ranking prioritizes score, health, correct count, then response speed", () => {
  const state = create(2);
  const match = state.matches[0];
  let events = [answer(state, match, 1, { damage: 20 })];
  let result = buildTournamentView(state, events, BASE + 30000).matches[0];
  assert.equal(result.winner.id, "player-2");
  assert.equal(result.reason, "time");
  events = [answer(state, match, 0, { damage: 10 }), answer(state, match, 1, {
    damage: 30, createdAt: new Date(BASE + 2000).toISOString()
  })];
  result = buildTournamentView(state, events, BASE + 30000).matches[0];
  assert.equal(result.winner.id, "player-2");
  assert.equal(result.reason, "hp");
  events = [answer(state, match, 0, { damage: 20, responseMs: 2000 }), answer(state, match, 1, {
    damage: 20, responseMs: 1000, createdAt: new Date(BASE + 2000).toISOString()
  })];
  result = buildTournamentView(state, events, BASE + 30000).matches[0];
  assert.equal(result.winner.id, "player-2");
  assert.equal(result.reason, "speed");
  const longState = create(2, { durationSeconds: 100 });
  const longMatch = longState.matches[0];
  const correctEvents = [];
  for (let round = 0; round < 7; round += 1) {
    if (round < 4) correctEvents.push(answer(longState, longMatch, 0, { round,
      damage: round === 0 ? 2 : 1, createdAt: new Date(BASE + round * 10000 + 1000).toISOString() }));
    correctEvents.push(answer(longState, longMatch, 1, { round, damage: 1,
      correct: round !== 2 && round !== 5, createdAt: new Date(BASE + round * 10000 + 2000).toISOString() }));
  }
  result = buildTournamentView(longState, correctEvents, BASE + 100000).matches[0];
  assert.equal(result.stats[0].score, result.stats[1].score);
  assert.equal(result.stats[0].hp, result.stats[1].hp);
  assert.equal(result.winner.id, "player-2");
  assert.equal(result.reason, "correct");
});

test("event namespaces and stage windows isolate scores, including late submissions", () => {
  const state = create(4);
  const [first, second] = state.matches;
  const events = [
    answer(state, first, 0, { damage: 10 }),
    answer(state, first, 1, { createdAt: new Date(BASE - 1).toISOString() }),
    answer(state, first, 1, { round: 1, createdAt: new Date(BASE + 30001).toISOString() }),
    answer(state, first, 1, { matchId: "other-stage" }),
    answer(state, first, 1, { matchId: "" }),
    answer(state, second, 0, { playerId: first.playerIds[0] })
  ];
  const view = buildTournamentView(state, events, BASE + 32000);
  assert.equal(view.matches[0].stats[0].score, 100);
  assert.equal(view.matches[0].stats[1].score, 0);
  assert.equal(view.matches[1].answerCount, 0);
  assert.equal(view.matches[0].answerCount, 1);
  assert.equal(buildTournamentView(state, events, BASE + 500).matches[0].answerCount, 0);
});

test("optimistic rows and retried remote answers cannot inflict duplicate damage", () => {
  const state = create(2);
  const match = state.matches[0];
  const local = answer(state, match, 0, { id: "local-one", damage: 20 });
  const remote = { ...local, id: "server-one", createdAt: new Date(BASE + 1100).toISOString() };
  const retry = { ...remote, id: "server-two", damage: 99, createdAt: new Date(BASE + 1200).toISOString() };
  const view = buildTournamentView(state, [retry, remote, local], BASE + 1500);
  assert.equal(view.matches[0].stats[0].score, 100);
  assert.equal(view.matches[0].stats[1].hp, 80);
  assert.equal(view.matches[0].answerCount, 1);
  assert.equal(view.matches[0].events[0].id, "server-one");
});

test("metadata and match effects survive serialization, old rows and malformed rows", () => {
  const state = create(4);
  const events = knockoutStage(state);
  const next = advanceTournament(state, events, BASE + 3000);
  const metadata = [
    { id: "meta-0", createdAt: new Date(BASE).toISOString(), effect: TOURNAMENT_PREFIX + JSON.stringify(state) },
    { id: "meta-1", createdAt: new Date(BASE + 3000).toISOString(), effect: TOURNAMENT_PREFIX + JSON.stringify(next) },
    { id: "meta-bad", createdAt: new Date(BASE + 4000).toISOString(), effect: TOURNAMENT_PREFIX + "{bad" },
    { id: "meta-stale", createdAt: new Date(BASE + 5000).toISOString(), effect: TOURNAMENT_PREFIX + JSON.stringify(state) }
  ];
  assert.deepEqual(readTournament(JSON.parse(JSON.stringify(metadata))), next);
  assert.equal(readTournament([{ effect: "pairing:{}" }]), null);
  const encoded = encodeBattleEffect({ matchId: state.matches[0].id, effect: "shield" });
  assert.deepEqual(decodeBattleEffect(encoded), { matchId: state.matches[0].id, effect: "shield" });
  assert.deepEqual(decodeBattleEffect("heal"), { matchId: "", effect: "heal" });
  assert.deepEqual(decodeBattleEffect(metadata[0].effect), { matchId: "", effect: metadata[0].effect });
  assert.equal(decodeBattleEffect("match:{broken").matchId, "");
  const encodedAnswer = { ...events[0], matchId: undefined,
    effect: encodeBattleEffect({ matchId: events[0].matchId }) };
  assert.equal(buildTournamentView(state, [encodedAnswer], BASE + 2000).matches[0].stats[0].score, 100);
});

test("final cannot finish while the bronze match is still running", () => {
  const state = create(4);
  const events = knockoutStage(state);
  const final = advanceTournament(state, events, BASE + 3000);
  events.push(answer(final, final.matches.find((match) => match.kind === "final")));
  assert.equal(buildTournamentView(final, events, at(final, 3000)).allFinished, false);
  assert.throws(() => advanceTournament(final, events, at(final, 3000)), /尚未结束/);
  const finished = advanceTournament(final, events, at(final, 32000));
  assert.equal(finished.status, "finished");
  assert.equal(finished.standings.find((entry) => entry.place === 3).player.id, "player-2");
});

console.log("Battle engine checks passed.");
