import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildTournamentView, readTournament } from "../battle-engine.js";

const teacherId = randomUUID();
const roomId = randomUUID();
let fixtureNumber = 0;

function playerRow(index) {
  return {
    id: randomUUID(), room_id: roomId, student_id: randomUUID(),
    display_name: `学生 ${index + 1}`, class_name: "高一甲",
    joined_at: new Date(1750000000000 + index * 1000).toISOString(), status: "ready"
  };
}

async function fixture({ playerCount = 4, userId = teacherId, status = "lobby", legacyTarget = false, serverSkew = 0, missingBattleRpc = false } = {}) {
  const tables = {
    battle_rooms: [{ id: roomId, room_code: "123456", teacher_id: teacherId, status, duration_seconds: 180 }],
    battle_players: Array.from({ length: playerCount }, (_, index) => playerRow(index)),
    battle_events: [],
    profiles: []
  };
  tables.profiles = [{ id: teacherId, role: "teacher", status: "active", full_name: "Teacher" },
    ...tables.battle_players.map((p) => ({ id: p.student_id, role: "student", status: "active", full_name: p.display_name, class_name: p.class_name }))];
  const requests = [];
  const failures = { roomUpdates: 0, initialCommits: 0 };
  const activeSession = { user: { id: userId } };
  const client = {
    auth: { onAuthStateChange: (callback) => callback("SIGNED_IN", activeSession), getSession: async () => ({ data: { session: activeSession } }) },
    async rpc(name, args = {}) {
      requests.push({ operation: "rpc", name, args });
      if (missingBattleRpc) return { error: { code: "PGRST202", message: "Function not found in schema cache" } };
      const serverTime = () => Date.now() + serverSkew;
      if (name === "battle_room_snapshot") return { data: structuredClone({
        room: tables.battle_rooms.find((r) => r.id === args.target_room_id),
        players: tables.battle_players.filter((p) => p.room_id === args.target_room_id),
        events: tables.battle_events.filter((e) => e.room_id === args.target_room_id),
        server_now: new Date(serverTime()).toISOString()
      }) };
      if (name === "battle_server_time") return { data: new Date(serverTime()).toISOString() };
      if (name === "join_battle_room") {
        const room = tables.battle_rooms.find((r) => r.room_code === args.room_code_input);
        const profile = tables.profiles.find((p) => p.id === activeSession.user.id);
        if (!room || profile?.role !== "student" || profile.status !== "active") return { error: { message: "Student access required" } };
        const existing = tables.battle_players.find((p) => p.room_id === room.id && p.student_id === profile.id);
        if (existing) return { data: room.id };
        if (room.status !== "lobby") return { error: { message: "比赛已经开始，不能再加入" } };
        if (room.class_name && room.class_name !== profile.class_name) return { error: { message: "班级不符" } };
        if (tables.battle_players.filter((p) => p.room_id === room.id).length >= 40) return { error: { message: "房间已满，最多40人" } };
        tables.battle_players.push({ ...playerRow(tables.battle_players.length), student_id: profile.id, display_name: profile.full_name, class_name: profile.class_name });
        return { data: room.id };
      }
      if (name === "prepare_battle_room_start") {
        const room = tables.battle_rooms.find((r) => r.id === args.target_room_id);
        if (room?.teacher_id !== activeSession.user.id) return { error: { message: "Only owning teacher may start" } };
        const players = tables.battle_players.filter((p) => p.room_id === room.id);
        if (players.length > 40 || players.length < 2) return { error: { message: "人数必须为2–40" } };
        if (room.status === "lobby") Object.assign(room, { status: "battle", tournament_version: 2, started_at: new Date(serverTime() + 8000).toISOString() });
        else if (room.status !== "battle" || room.tournament_version !== 2) return { error: { message: "房间无法开赛" } };
        return { data: { started_at: room.started_at, players: structuredClone(players) } };
      }
      if (name === "commit_battle_room_start") {
        const room = tables.battle_rooms.find((r) => r.id === args.target_room_id);
        if (room?.teacher_id !== activeSession.user.id) return { error: { message: "Only owning teacher may start" } };
        const existing = tables.battle_events.find((e) => e.id === args.event_id && e.room_id === room.id);
        if (existing) return { data: JSON.parse(existing.effect.slice("tournament:".length)) };
        if (failures.initialCommits > 0) {
          failures.initialCommits -= 1;
          return { error: { message: "Simulated interrupted initial commit" } };
        }
        const snapshot = { ...structuredClone(args.tournament_input), startedAt: new Date(serverTime() + 8000).toISOString() };
        room.started_at = snapshot.startedAt;
        tables.battle_events.push({ id: args.event_id, room_id: room.id, player_id: snapshot.roster[0].id,
          event_type: "skill", round_number: 0, is_correct: false, damage: 0, created_at: new Date(serverTime()).toISOString(),
          effect: `tournament:${JSON.stringify(snapshot)}` });
        return { data: snapshot };
      }
      throw new Error(`Unexpected RPC ${name}`);
    },
    from(table) {
      const query = {
        table, operation: "select", filters: [], orders: [], first: 0, last: 999, singular: false,
        select() { return this; },
        eq(column, value) { this.filters.push([column, value]); return this; },
        order(column, options) { this.orders.push([column, options.ascending]); return this; },
        range(first, last) { this.first = first; this.last = last; return this; },
        insert(payload) { this.operation = "insert"; this.payload = payload; return this; },
        update(payload) { this.operation = "update"; this.payload = payload; return this; },
        maybeSingle() { this.singular = true; return this; },
        single() { this.singular = true; return this; },
        then(resolve, reject) {
          return Promise.resolve().then(() => {
            requests.push({ table, operation: this.operation, first: this.first, last: this.last, orders: this.orders });
            const matches = (row) => this.filters.every(([column, value]) => row[column] === value);
            if (this.operation === "insert") {
              const input = Array.isArray(this.payload) ? this.payload : [this.payload];
              if (legacyTarget && input.some((row) => "target_player_id" in row)) return { error: { code: "PGRST204", message: "Could not find target_player_id column" } };
              if (input.some((row) => row.id && tables[table].some((existing) => existing.id === row.id))) return { error: { code: "23505", message: "Duplicate primary key" } };
              const saved = input.map((row) => ({ id: randomUUID(), created_at: new Date(Date.now() + serverSkew).toISOString(), ...structuredClone(row) }));
              tables[table].push(...saved);
              return { data: structuredClone(this.singular ? saved[0] : saved) };
            }
            if (this.operation === "update") {
              if (table === "battle_rooms" && failures.roomUpdates > 0) {
                failures.roomUpdates -= 1;
                return { error: { message: "Simulated interrupted room update" } };
              }
              const saved = tables[table].filter(matches);
              saved.forEach((row) => Object.assign(row, structuredClone(this.payload)));
              return { data: structuredClone(this.singular ? saved[0] || null : saved) };
            }
            const rows = tables[table].filter(matches).sort((a, b) => {
              for (const [column, ascending] of this.orders) {
                const comparison = String(a[column] || "").localeCompare(String(b[column] || ""));
                if (comparison) return ascending ? comparison : -comparison;
              }
              return 0;
            }).slice(this.first, Math.min(this.last + 1, this.first + 1000));
            return { data: structuredClone(this.singular ? rows[0] || null : rows) };
          }).then(resolve, reject);
        }
      };
      return query;
    }
  };
  globalThis.document = { documentElement: { dataset: {} } };
  globalThis.PERSONAL_AI_CONFIG = { cloudEnabled: true, supabaseUrl: "https://example.supabase.co", supabasePublishableKey: "test-key" };
  globalThis.supabase = { createClient: () => client };
  await import(`../cloud.js?battle-cloud-fixture=${fixtureNumber++}`);
  return { cloud: globalThis.personalAICloud, tables, requests, failures, session: activeSession };
}

async function withClock(callback) {
  const originalNow = Date.now;
  let now = Date.parse("2026-10-15T08:00:00.000Z");
  Date.now = () => now;
  try { return await callback((value) => { now = Number(value); }); }
  finally { Date.now = originalNow; }
}

async function winCurrentStage(cloud, state, setClock, side = 0) {
  setClock(Date.parse(state.startedAt) + 1000);
  for (const match of state.matches.filter((entry) => entry.playerIds.length === 2)) {
    await cloud.submitBattleEvent({ roomId, playerId: match.playerIds[side], targetPlayerId: match.playerIds[1 - side],
      matchId: match.id, round: 0, type: "answer", correct: true, damage: 100 });
  }
  setClock(Date.parse(state.startedAt) + 3000);
}

const checks = [
  ["40-seat admission is idempotent; overflow and late entrants are rejected", async () => {
    const { cloud, tables, session, requests } = await fixture({ playerCount: 39 });
    const lastStudent = { id: randomUUID(), role: "student", status: "active", full_name: "第40位学生", class_name: "高一甲" };
    tables.profiles.push(lastStudent);
    session.user.id = lastStudent.id;
    const joined = await cloud.joinBattleRoom(" 123456 ");
    assert.equal(joined.players.length, 40);
    assert.equal(joined.players.filter((p) => p.studentId === lastStudent.id).length, 1);
    await Promise.all([cloud.joinBattleRoom("123456"), cloud.joinBattleRoom("123456")]);
    assert.equal(tables.battle_players.length, 40);
    const overflow = { ...lastStudent, id: randomUUID(), full_name: "第41位学生" };
    tables.profiles.push(overflow);
    session.user.id = overflow.id;
    await assert.rejects(cloud.joinBattleRoom("123456"), /40/);
    session.user.id = teacherId;
    await cloud.startBattleRoom(roomId);
    session.user.id = overflow.id;
    await assert.rejects(cloud.joinBattleRoom("123456"), /已经开始/);
    session.user.id = lastStudent.id;
    assert.equal((await cloud.joinBattleRoom("123456")).players.length, 40, "existing students can rejoin a running room");
    assert.equal(requests.filter((r) => r.table === "battle_players" && r.operation === "insert").length, 0, "no unsafe client-side admission fallback");
  }],
  ["new joins enforce student account and selected class", async () => {
    const { cloud, tables, session } = await fixture();
    await assert.rejects(cloud.joinBattleRoom("123456"), /Student access/);
    tables.battle_rooms[0].class_name = "高一甲";
    const student = { id: randomUUID(), role: "student", status: "active", full_name: "学生", class_name: "高二甲" };
    tables.profiles.push(student);
    session.user.id = student.id;
    await assert.rejects(cloud.joinBattleRoom("123456"), /班级/);
    student.class_name = "高一甲";
    student.status = "suspended";
    await assert.rejects(cloud.joinBattleRoom("123456"), /Student access/);
    assert.equal(tables.battle_players.length, 4);
  }],
  ["oversized or undersized rosters cannot start a new bracket", async () => {
    for (const playerCount of [1, 41, 42]) {
      const { cloud, tables, requests } = await fixture({ playerCount });
      await assert.rejects(cloud.startBattleRoom(roomId), /40|two players/);
      assert.equal(tables.battle_events.length, 0);
      assert.equal(requests.filter((r) => r.name === "prepare_battle_room_start").length, 0);
      assert.equal(tables.battle_rooms[0].status, "lobby");
    }
  }],
  ["missing database upgrade is explicit; reads survive without inventing calibrated time", async () => {
    const { cloud, tables } = await fixture({ missingBattleRpc: true });
    await assert.rejects(cloud.loadBattleRoom(roomId), /Function not found/);
    await assert.rejects(cloud.joinBattleRoom("123456"), /upgrade_battle_40_players/);
    await assert.rejects(cloud.startBattleRoom(roomId), /Function not found/);
    await assert.rejects(cloud.createBattleRoom(), /upgrade_battle_40_players/);
    assert.equal(tables.battle_events.length, 0);
    assert.equal(tables.battle_rooms.length, 1);
  }],
  ["delayed start recovery commits a fresh countdown without admitting late students", async () => withClock(async (setClock) => {
    const { cloud, tables, failures, session } = await fixture({ playerCount: 34 });
    failures.initialCommits = 1;
    await assert.rejects(cloud.startBattleRoom(roomId), /interrupted initial commit/);
    const provisionalTime = Date.parse(tables.battle_rooms[0].started_at);
    assert.equal(tables.battle_rooms[0].status, "battle");
    assert.equal(tables.battle_events.length, 0);
    const data = await cloud.loadBattleRoom(roomId);
    assert.equal(data.room.requiresTournament, true);
    assert.equal(readTournament(data.events), null, "UI must wait, not generate provisional pairings");
    const late = { id: randomUUID(), role: "student", status: "active", full_name: "迟到学生" };
    tables.profiles.push(late);
    session.user.id = late.id;
    await assert.rejects(cloud.joinBattleRoom("123456"), /已经开始/);
    session.user.id = teacherId;
    setClock(provisionalTime + 300000);
    const recovered = readTournament((await cloud.startBattleRoom(roomId)).events);
    assert.equal(Date.parse(recovered.startedAt), Date.now() + 8000);
    assert.equal(recovered.matches.length, 17);
    assert.ok(recovered.matches.every((m) => m.playerIds.length === 2));
    setClock(Date.now() + 60000);
    const retried = readTournament((await cloud.startBattleRoom(roomId)).events);
    assert.equal(retried.startedAt, recovered.startedAt, "committed brackets never restart");
    assert.equal(tables.battle_events.length, 1);
  })],
  ["server-clock calibration keeps live scores and HP correct with five-minute device skew", async () => withClock(async (setClock) => {
    const localStart = Date.now();
    for (const serverSkew of [-300000, 300000]) {
      setClock(localStart);
      const { cloud } = await fixture({ playerCount: 40, serverSkew });
      const data = await cloud.startBattleRoom(roomId);
      const state = readTournament(data.events);
      assert.equal(Date.parse(state.startedAt), localStart + serverSkew + 8000);
      assert.equal(data.clockSynchronized, true);
      assert.equal(cloud.battleNow(), Date.now() + serverSkew);
      setClock(Date.parse(state.startedAt) - serverSkew + 1000);
      for (const match of state.matches) {
        await cloud.submitBattleEvent({ roomId, playerId: match.playerIds[0], targetPlayerId: match.playerIds[1],
          matchId: match.id, round: 0, type: "answer", correct: true, damage: 20 });
      }
      const loaded = await cloud.loadBattleRoom(roomId);
      const view = buildTournamentView(state, loaded.events, cloud.battleNow());
      assert.ok(view.matches.every((m) => m.stats[0].score === 100 && m.stats[1].hp === 80));
      assert.ok(view.matches.every((m) => !m.finished));
      assert.equal(readTournament((await cloud.advanceBattleTournament(roomId, 0)).events).stageIndex, 0, "device clock cannot prematurely finish the stage");
    }
  })],
  ["34 and 40 students all play first round and retain every round's score/HP after reload", async () => withClock(async (setClock) => {
    for (const playerCount of [3, 5, 33, 34, 39, 40]) {
      const { cloud } = await fixture({ playerCount });
      let data = await cloud.startBattleRoom(roomId);
      let state = readTournament(data.events);
      assert.equal(state.version, 2);
      assert.equal(state.matches.length, Math.ceil(playerCount / 2));
      assert.equal(state.matches.filter((match) => match.playerIds.length === 1).length, playerCount % 2);
      assert.equal(new Set(state.matches.flatMap((m) => m.playerIds)).size, playerCount);
      while (state.status !== "finished") {
        assert.ok(state.stageIndex < 8, "tournament must make progress");
        await winCurrentStage(cloud, state, setClock);
        data = await cloud.advanceBattleTournament(roomId, state.stageIndex);
        state = readTournament(data.events);
        assert.deepEqual(readTournament((await cloud.loadBattleRoom(roomId)).events), state);
      }
      assert.equal(state.standings.length, playerCount);
      assert.deepEqual(state.standings.filter((s) => s.place >= 1 && s.place <= 3).map((s) => s.place).sort(), [1, 2, 3]);
      assert.ok(state.history.every((round) => round.matches.filter((m) => m.players.length === 1).length <= 1));
      assert.ok(state.history[0].matches.filter((m)=>m.players.length===2).every((m) => m.stats[0].score === 100 && m.stats[1].hp === 0));
      assert.equal(state.history[0].matches.flatMap((m) => m.players).length, playerCount);
    }
  })],
  ["loads all event/player pages, including scores beyond Supabase's default limit", async () => {
    const { cloud, tables, requests } = await fixture({ playerCount: 1002 });
    tables.battle_events = Array.from({ length: 1205 }, (_, index) => ({
      id: randomUUID(), room_id: roomId, player_id: tables.battle_players[0].id,
      round_number: index, event_type: "answer", is_correct: true, damage: 20,
      created_at: new Date(1750000000000 + index * 1000).toISOString()
    }));
    const data = await cloud.loadBattleRoom(roomId);
    assert.equal(data.players.length, 1002);
    assert.equal(data.events.length, 1205);
    assert.equal(data.events.at(-1).round, 1204);
    assert.equal(requests.filter((r) => r.name === "battle_room_snapshot").length, 1);
    assert.equal(requests.filter((r) => ["battle_players", "battle_events"].includes(r.table)).length, 0);
  }],
  ["only the room's teacher can start a tournament", async () => {
    const { cloud, tables } = await fixture({ userId: randomUUID() });
    await assert.rejects(cloud.startBattleRoom(roomId), /Only the teacher/);
    assert.equal(tables.battle_events.length, 0);
  }],
  ["simultaneous starts save a single authoritative bracket", async () => {
    const { cloud, tables } = await fixture();
    const [first, second] = await Promise.all([cloud.startBattleRoom(roomId), cloud.startBattleRoom(roomId)]);
    const metadata = tables.battle_events.filter((event) => event.effect.startsWith("tournament:"));
    assert.equal(metadata.length, 1);
    assert.equal(first.room.status, "battle");
    assert.equal(second.room.status, "battle");
    assert.equal(first.events[0].effect, second.events[0].effect);
    const saved = JSON.parse(metadata[0].effect.slice("tournament:".length));
    assert.equal(saved.roster.length, 4);
    assert.ok(new Date(saved.startedAt).getTime() > Date.now());
  }],
  ["retrying an answer stores one event and preserves its match/powerup", async () => {
    const { cloud, tables } = await fixture();
    const event = { roomId, playerId: tables.battle_players[0].id, targetPlayerId: tables.battle_players[1].id, matchId: "stage-1-match-1", round: 2, type: "answer", correct: true, damage: 25, effect: "shield" };
    const [first, second] = await Promise.all([cloud.submitBattleEvent(event), cloud.submitBattleEvent(event)]);
    assert.equal(first.id, second.id);
    assert.equal(tables.battle_events.length, 1);
    assert.equal(first.matchId, event.matchId);
    assert.equal(first.effect, "shield");
    const reloaded = await cloud.loadBattleRoom(roomId);
    assert.equal(reloaded.events[0].matchId, event.matchId);
    assert.equal(reloaded.events[0].targetPlayerId, event.targetPlayerId);
    await cloud.submitBattleEvent({ ...event, matchId: "stage-2-match-1" });
    assert.equal(tables.battle_events.length, 2, "same question-round in a new match must remain a separate answer");
  }],
  ["old projects without target_player_id can still save idempotent answers", async () => {
    const { cloud, tables } = await fixture({ legacyTarget: true });
    const event = { roomId, playerId: tables.battle_players[0].id, targetPlayerId: tables.battle_players[1].id, matchId: "legacy-schema-match", correct: true };
    const first = await cloud.submitBattleEvent(event);
    const second = await cloud.submitBattleEvent(event);
    assert.equal(first.id, second.id);
    assert.equal(tables.battle_events.length, 1);
    assert.equal(first.matchId, event.matchId);
  }],
  ["saved bracket survives an interrupted room update and is repaired on retry", async () => {
    const { cloud, tables, failures } = await fixture();
    failures.roomUpdates = 1;
    await assert.rejects(cloud.startBattleRoom(roomId), /interrupted room update/);
    assert.equal(tables.battle_rooms[0].status, "battle", "membership remains frozen after bracket commit even if later room sync fails");
    assert.equal((await cloud.loadBattleRoom(roomId)).room.status, "battle");
    await cloud.startBattleRoom(roomId);
    assert.equal(tables.battle_rooms[0].status, "battle");
    assert.equal(tables.battle_events.length, 1);
  }],
  ["legacy running battles are never reset by start retries", async () => {
    const { cloud, tables } = await fixture({ status: "battle" });
    const data = await cloud.startBattleRoom(roomId);
    assert.equal(data.room.status, "battle");
    assert.equal(tables.battle_events.length, 0);
  }],
  ["four-player semifinal, final and bronze scores persist through cloud advancement and reload", async () => withClock(async (setClock) => {
    const { cloud, tables } = await fixture();
    const initial = await cloud.startBattleRoom(roomId);
    const semifinal = readTournament(initial.events);
    assert.equal(semifinal.stageIndex, 0);
    await winCurrentStage(cloud, semifinal, setClock);
    let loaded = await cloud.loadBattleRoom(roomId);
    const semifinalView = buildTournamentView(semifinal, loaded.events, Date.now());
    assert.ok(semifinalView.matches.every((match) => match.stats[0].score === 100 && match.stats[1].hp === 0));
    assert.ok(semifinalView.matches.every((match) => match.winner.name.startsWith("学生 ")));
    const advanced = await cloud.advanceBattleTournament(roomId, semifinal.stageIndex);
    const final = readTournament(advanced.events);
    assert.equal(final.stageIndex, 1);
    assert.equal(final.matches.find((match) => match.kind === "final").playerIds.length, 2);
    assert.deepEqual(final.matches.find((match) => match.kind === "bronze").playerIds,
      semifinalView.matches.map((match) => match.loser.id));
    assert.ok(buildTournamentView(final, advanced.events, Date.now()).matches.every((match) =>
      match.stats.every((stat) => stat.score === 0 && stat.hp === 100 && stat.lastRound === -1)));
    await winCurrentStage(cloud, final, setClock, 1);
    const completed = await cloud.advanceBattleTournament(roomId, final.stageIndex);
    const finished = readTournament(completed.events);
    assert.equal(finished.stageIndex, 2);
    assert.equal(finished.status, "finished");
    assert.equal(completed.room.status, "finished");
    assert.equal(tables.battle_rooms[0].status, "finished");
    const expectedChampion = final.matches.find((match) => match.kind === "final").playerIds[1];
    const expectedBronze = final.matches.find((match) => match.kind === "bronze").playerIds[1];
    assert.equal(finished.standings.find((entry) => entry.place === 1).player.id, expectedChampion);
    assert.equal(finished.standings.find((entry) => entry.place === 1).score, 200);
    assert.equal(finished.standings.find((entry) => entry.place === 3).player.id, expectedBronze);
    loaded = await cloud.loadBattleRoom(roomId);
    assert.deepEqual(readTournament(loaded.events), finished);
    assert.deepEqual(buildTournamentView(readTournament(loaded.events), loaded.events, Date.now()).standings, finished.standings);
    const metadata = tables.battle_events.filter((event) => event.effect.startsWith("tournament:"));
    assert.equal(metadata.length, 3);
    assert.equal(new Set(metadata.map((event) => event.id)).size, 3);
    assert.equal(finished.history.length, 2);
  })],
  ["simultaneous advances and stale retries commit one stage and cannot skip a round", async () => withClock(async (setClock) => {
    const { cloud, tables } = await fixture();
    const initial = await cloud.startBattleRoom(roomId);
    const semifinal = readTournament(initial.events);
    await winCurrentStage(cloud, semifinal, setClock);
    const [first, second] = await Promise.all([
      cloud.advanceBattleTournament(roomId, 0), cloud.advanceBattleTournament(roomId, 0)
    ]);
    const final = readTournament(first.events);
    assert.deepEqual(readTournament(second.events), final);
    assert.equal(final.stageIndex, 1);
    const stale = await cloud.advanceBattleTournament(roomId, 0);
    assert.deepEqual(readTournament(stale.events), final);
    const early = await cloud.advanceBattleTournament(roomId, 1);
    assert.deepEqual(readTournament(early.events), final);
    assert.equal(tables.battle_events.filter((event) => event.effect.startsWith("tournament:")).length, 2);
    await winCurrentStage(cloud, final, setClock);
    const [completedA, completedB] = await Promise.all([
      cloud.advanceBattleTournament(roomId, 1), cloud.advanceBattleTournament(roomId, 1)
    ]);
    assert.equal(readTournament(completedA.events).status, "finished");
    assert.deepEqual(readTournament(completedB.events), readTournament(completedA.events));
    const completedRetry = await cloud.advanceBattleTournament(roomId, 1);
    assert.deepEqual(readTournament(completedRetry.events), readTournament(completedA.events));
    assert.equal(tables.battle_events.filter((event) => event.effect.startsWith("tournament:")).length, 3);
  })],
  ["only the owning teacher can advance, including after all students finish", async () => withClock(async (setClock) => {
    const { cloud, tables, session } = await fixture();
    const initial = await cloud.startBattleRoom(roomId);
    const semifinal = readTournament(initial.events);
    await winCurrentStage(cloud, semifinal, setClock);
    const count = tables.battle_events.length;
    session.user.id = tables.battle_players[0].student_id;
    await assert.rejects(cloud.advanceBattleTournament(roomId, 0), /Only the teacher/);
    session.user.id = randomUUID();
    await assert.rejects(cloud.advanceBattleTournament(roomId, 0), /Only the teacher/);
    assert.equal(tables.battle_events.length, count);
    session.user.id = teacherId;
    assert.equal(readTournament((await cloud.advanceBattleTournament(roomId, 0)).events).stageIndex, 1);
  })],
  ["a saved terminal bracket recovers after the final room-status update fails", async () => withClock(async (setClock) => {
    const { cloud, tables, failures } = await fixture();
    let data = await cloud.startBattleRoom(roomId);
    let state = readTournament(data.events);
    await winCurrentStage(cloud, state, setClock);
    data = await cloud.advanceBattleTournament(roomId, state.stageIndex);
    state = readTournament(data.events);
    await winCurrentStage(cloud, state, setClock);
    failures.roomUpdates = 1;
    await assert.rejects(cloud.advanceBattleTournament(roomId, state.stageIndex), /interrupted room update/);
    assert.equal(tables.battle_rooms[0].status, "battle");
    const restored = await cloud.loadBattleRoom(roomId);
    assert.equal(restored.room.status, "finished");
    assert.equal(readTournament(restored.events).status, "finished");
    await cloud.advanceBattleTournament(roomId, state.stageIndex);
    assert.equal(tables.battle_rooms[0].status, "finished");
    assert.equal(tables.battle_events.filter((event) => event.effect.startsWith("tournament:")).length, 3);
  })]
];

for (const [name, check] of checks) {
  await check();
  console.log(`PASS ${name}`);
}
console.log(`${checks.length} cloud tournament regressions passed.`);
