import assert from "node:assert/strict";
import {
  TOURNAMENT_PREFIX, MAX_BATTLE_PLAYERS, advanceTournament, battleStats, buildTournamentView,
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
  assert.equal(state.version, 2);
  assert.throws(() => create(1), /偶数/);
  assert.throws(() => create(3), /偶数/);
  assert.equal(MAX_BATTLE_PLAYERS, 40);
  assert.equal(create(40).roster.length, 40);
  assert.throws(() => create(42), /40/);
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

test("six players all play first, then a three-player semifinal awards a real third place", () => {
  let state = create(6);
  assert.equal(state.matches.length, 3);
  assert.equal(state.matches.filter((match) => match.playerIds.length === 1).length, 0);
  const initialView = buildTournamentView(state, [], BASE);
  assert.equal(initialView.label, "6 强赛");
  assert.equal(initialView.allFinished, false);
  assert.equal(initialView.matches.filter((match) => match.reason === "bye").length, 0);
  let events = knockoutStage(state);
  state = advanceTournament(state, events, at(state, 3000));
  assert.equal(state.matches.length, 2);
  assert.equal(buildTournamentView(state, events, at(state, 0)).label, "三人半决赛");
  assert.equal(state.matches.filter((match) => match.playerIds.length === 1).length, 1);
  events.push(...knockoutStage(state));
  const semifinalLoser = buildTournamentView(state, events, at(state, 3000)).matches.find((match) => match.loser).loser.id;
  state = advanceTournament(state, events, at(state, 3000));
  assert.equal(state.matches[0].kind, "final");
  assert.equal(state.matches.length, 1, "no fictitious bronze game or awarded score");
  assert.equal(state.thirdPlacePlayerId, semifinalLoser);
  events.push(...knockoutStage(state));
  state = advanceTournament(state, events, at(state, 3000));
  assert.equal(state.status, "finished");
  assert.deepEqual(state.standings.slice(0, 3).map((entry) => entry.place), [1, 2, 3]);
  assert.equal(new Set(state.standings.slice(0, 3).map((entry) => entry.player.id)).size, 3);
  assert.equal(state.standings.find((entry) => entry.place === 3).player.id, semifinalLoser);
  assert.equal(state.standings.find((entry) => entry.place === 3).score, 100);
  assert.equal(state.history.length, 3);
  assert.deepEqual(buildTournamentView(JSON.parse(JSON.stringify(state)), [], at(state, 4000)).standings, state.standings);
});

test("every even roster from 2 through 40 plays round one and completes with unique correct medals and scores", () => {
  for (let count = 2; count <= MAX_BATTLE_PLAYERS; count += 2) {
    for (const winnerOffset of [0, 1]) {
      let state = create(count);
      const events = [];
      const expectedScores = new Map(state.roster.map((player) => [player.id, 0]));
      const byeCounts = new Map(state.roster.map((player) => [player.id, 0]));
      const seedOrder = new Map(state.roster.map((player, index) => [player.id, index]));
      let previousByes = new Set();
      let expectedEntrants = new Set(state.roster.map((player) => player.id));
      let stages = 0;
      assert.equal(state.matches.length, count / 2);
      while (state.status !== "finished") {
        const ids = state.matches.flatMap((match) => match.playerIds);
        assert.equal(new Set(ids).size, ids.length, `no duplicate entrant: ${count}, stage ${stages}`);
        assert.deepEqual(new Set(ids), expectedEntrants, `no skipped or revived entrant: ${count}, stage ${stages}`);
        const byes = state.matches.filter((match) => match.playerIds.length === 1);
        assert.equal(byes.length, stages === 0 ? 0 : ids.length % 2);
        if (byes.length) {
          const eligible = [...ids].sort((a, b) => byeCounts.get(a) - byeCounts.get(b)
            || Number(previousByes.has(a)) - Number(previousByes.has(b))
            || seedOrder.get(a) - seedOrder.get(b));
          assert.equal(byes[0].playerIds[0], eligible[0], "bye uses fewest prior byes, previous-round avoidance, then fixed seed");
          const id = byes[0].playerIds[0];
          byeCounts.set(id, byeCounts.get(id) + 1);
        }
        previousByes = new Set(byes.flatMap((match) => match.playerIds));
        const winnerSide = (stages + winnerOffset) % 2;
        for (const match of state.matches.filter((entry) => entry.playerIds.length === 2)) {
          for (const side of [0, 1]) {
            events.push(answer(state, match, side, { damage: 10, createdAt: new Date(at(state, 1000 + side * 1000)).toISOString() }));
            const id = match.playerIds[side];
            expectedScores.set(id, expectedScores.get(id) + 100);
          }
          events.push(answer(state, match, winnerSide, { round: 1, damage: 100, createdAt: new Date(at(state, 3000)).toISOString() }));
          const winnerId = match.playerIds[winnerSide];
          expectedScores.set(winnerId, expectedScores.get(winnerId) + 125);
        }
        const view = buildTournamentView(state, events, at(state, 5000));
        for (const entry of view.standings) assert.equal(entry.score, expectedScores.get(entry.player.id));
        const mainMatches = view.matches.filter((match) => match.kind === "main");
        const nextMainIds = mainMatches.map((match) => match.winner.id);
        const semifinalLosers = mainMatches.map((match) => match.loser?.id).filter(Boolean);
        expectedEntrants = new Set(nextMainIds);
        if (nextMainIds.length === 2 && semifinalLosers.length === 2) {
          for (const id of semifinalLosers) expectedEntrants.add(id);
        }
        const beforeAdvance = JSON.stringify(state);
        const now = at(state, 5000);
        const next = advanceTournament(state, events, now);
        assert.equal(JSON.stringify(state), beforeAdvance, "advancement never mutates the saved stage");
        const restored = JSON.parse(beforeAdvance);
        assert.deepEqual(advanceTournament(restored, events, now), next, "reload cannot redraw pairings/byes");
        state = readTournament([{ id: `stage-${stages}`, createdAt: new Date(now).toISOString(), effect: TOURNAMENT_PREFIX + JSON.stringify(next) }]);
        assert.ok(state);
        assert.ok(++stages <= 6);
      }
      assert.equal(state.standings.length, count);
      assert.deepEqual(state.standings.filter((entry) => entry.place && entry.place <= 3).map((entry) => entry.place), count === 2 ? [1, 2] : [1, 2, 3]);
      assert.equal(new Set(state.standings.filter((entry) => entry.place).map((entry) => entry.player.id)).size, count === 2 ? 2 : state.thirdPlacePlayerId ? 3 : 4);
      for (const entry of state.standings) {
        assert.equal(entry.score, expectedScores.get(entry.player.id));
        assert.ok(entry.score > 0, "every original entrant answered in the first round");
      }
      assert.deepEqual(buildTournamentView(state, [], at(state, 10000)).standings, state.standings, "persisted scores survive missing event pages after completion");
    }
  }
});

test("34 and 40 students get 17 and 20 real first-round matches, no preliminary byes", () => {
  for (const count of [34, 40]) {
    const state = create(count);
    const view = buildTournamentView(state, [], BASE);
    assert.equal(view.matches.length, count / 2);
    assert.ok(view.matches.every((match) => match.players.length === 2 && !match.finished));
    assert.equal(view.label, `${count} 强赛`);
  }
});

test("saved version-1 brackets remain readable and retain old byes and history", () => {
  for (const count of [6, 34]) {
    const initial = create(count);
    initial.version = 1;
    initial.matches = [];
    const nextSize = 2 ** Math.floor(Math.log2(count));
    let cursor = 0;
    const add = (playerIds) => initial.matches.push({ id: `${initial.id}:0:main:${initial.matches.length + 1}`, kind: "main", playerIds });
    for (let index = 0; index < count - nextSize; index += 1) add(initial.roster.slice(cursor, cursor += 2).map((player) => player.id));
    while (cursor < count) add([initial.roster[cursor++].id]);
    const original = JSON.stringify(initial);
    let state = readTournament([{ id: "legacy", createdAt: new Date(BASE).toISOString(), effect: TOURNAMENT_PREFIX + original }]);
    const firstView = buildTournamentView(state, [], BASE);
    assert.equal(firstView.label, "预选赛");
    assert.equal(firstView.matches.filter((match) => match.reason === "bye").length, count === 34 ? 30 : 2);
    const events = [];
    let stage = 0;
    while (state.status !== "finished") {
      events.push(...knockoutStage(state));
      state = advanceTournament(state, events, at(state, 3000));
      assert.equal(state.version, 1);
      assert.equal(state.thirdPlacePlayerId, undefined);
      assert.ok(++stage <= 6);
    }
    assert.equal(JSON.stringify(initial), original);
    assert.deepEqual(state.history[0].matches.map((match) => match.playerIds), initial.matches.map((match) => match.playerIds));
    assert.deepEqual(state.standings.slice(0, 3).map((entry) => entry.place), [1, 2, 3]);
    assert.deepEqual(buildTournamentView(JSON.parse(JSON.stringify(state)), [], at(state, 10000)).standings, state.standings);
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
