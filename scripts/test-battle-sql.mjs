// Actual PostgreSQL/PLpgSQL/RLS checks in an isolated in-memory PGlite instance.
// Install only in .temp/battle-sql-check; never point this test at Supabase.
// This is a single-connection runtime check, NOT a concurrent-load test.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createTournament } from "../battle-engine.js";
import { PGlite } from "../.temp/battle-sql-check/node_modules/@electric-sql/pglite/dist/index.js";

const db = new PGlite();
const uuid = (index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
const teacher = uuid(1), otherTeacher = uuid(2), outsiders = [uuid(999), uuid(998)];
const students = Array.from({ length: 41 }, (_, index) => uuid(100 + index));
const roomId = uuid(2000), directRoom = uuid(2001), recoverRoom = uuid(2002);
let passed = 0;
async function test(name, fn) { await fn(); passed += 1; console.log(`PASS ${name}`); }
async function as(user, sql, params = []) {
  await db.exec("set role authenticated");
  try {
    await db.query("select set_config('request.jwt.claim.sub', $1, false)", [user || ""]);
    return await db.query(sql, params);
  } finally { await db.exec("reset role"); }
}
const rpc = async (user, name, args = []) => (await as(user,
  `select public.${name}(${args.map((_, index) => `$${index + 1}`).join(",")}) as value`, args)).rows[0].value;
async function reject(fn, pattern) {
  await assert.rejects(fn, (error) => { assert.match(error.message, pattern); return true; });
}
async function bootstrap() {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    create table public.profiles (id uuid primary key, full_name text, class_name text, role text, status text default 'active');
    create function public.is_teacher() returns boolean language sql stable security definer set search_path=public as
      $$ select exists(select 1 from profiles where id=auth.uid() and role='teacher' and status='active') $$;
    create table public.battle_rooms (
      id uuid primary key default gen_random_uuid(), room_code text not null unique,
      teacher_id uuid not null, class_name text, assignment_id uuid,
      status text not null default 'lobby' check(status in ('lobby','battle','finished','cancelled')),
      started_at timestamptz, duration_seconds int not null default 180,
      created_at timestamptz not null default now(), updated_at timestamptz not null default now());
    create table public.battle_players (
      id uuid primary key default gen_random_uuid(), room_id uuid not null references battle_rooms(id),
      student_id uuid not null, display_name text not null, class_name text, status text not null default 'ready',
      joined_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique(room_id,student_id));
    create table public.battle_events (
      id uuid primary key default gen_random_uuid(), room_id uuid not null references battle_rooms(id),
      player_id uuid not null references battle_players(id), target_player_id uuid references battle_players(id),
      round_number int not null default 0, event_type text not null default 'answer', question_id uuid,
      is_correct boolean not null default false, damage int not null default 0, effect text, created_at timestamptz not null default now());
    alter table battle_rooms enable row level security;
    alter table battle_players enable row level security;
    alter table battle_events enable row level security;
    grant select,insert,update on battle_rooms,battle_players,battle_events to authenticated;
    create policy battle_rooms_read on battle_rooms for select to authenticated using
      (teacher_id=auth.uid() or exists(select 1 from profiles where id=auth.uid() and role='student' and (battle_rooms.class_name is null or class_name=battle_rooms.class_name)));
    create policy battle_rooms_teacher_write on battle_rooms for all to authenticated
      using (teacher_id=auth.uid() or is_teacher()) with check (teacher_id=auth.uid() or is_teacher());
    create policy battle_players_write on battle_players for all to authenticated
      using (student_id=auth.uid() or is_teacher()) with check (student_id=auth.uid() or is_teacher());
    create policy battle_events_insert on battle_events for insert to authenticated with check
      (exists(select 1 from battle_players bp where bp.id=battle_events.player_id and (bp.student_id=auth.uid() or is_teacher())));
    grant select on profiles to authenticated;
  `);
  for (const [id, name, role, className] of [
    [teacher, "Teacher Jude", "teacher", null], [otherTeacher, "Other Teacher", "teacher", null],
    ...students.map((id, index) => [id, `学生${index + 1}`, "student", "高一甲"]),
    [outsiders[0], "同班未入房学生", "student", "高一甲"], [outsiders[1], "其他班学生", "student", "高二乙"]
  ]) await db.query("insert into profiles(id,full_name,role,class_name) values ($1,$2,$3,$4)", [id, name, role, className]);
  for (const [id, code] of [[roomId, "123456"], [directRoom, "234567"], [recoverRoom, "345678"]])
    await db.query("insert into battle_rooms(id,room_code,teacher_id,class_name) values ($1,$2,$3,'高一甲')", [id, code, teacher]);
}

try {
  await bootstrap();
  const migration = await readFile(new URL("../supabase/upgrade_battle_40_players.sql", import.meta.url), "utf8");
  await test("actual migration applies twice without erasing existing rooms", async () => {
    await db.exec(migration);
    await db.exec(migration);
    assert.equal((await db.query("select count(*)::int n from battle_rooms")).rows[0].n, 3);
  });
  await test("authenticated server clock works; missing identity is rejected", async () => {
    const clock = await rpc(teacher, "battle_server_time");
    assert.ok(Number.isFinite(Date.parse(clock)));
    await reject(() => rpc(null, "battle_server_time"), /sign in/i);
  });
  await test("40 real student joins succeed and student 41 is rejected", async () => {
    for (const student of students.slice(0, 40)) assert.equal(await rpc(student, "join_battle_room", ["123456"]), roomId);
    await reject(() => rpc(students[40], "join_battle_room", ["123456"]), /full.*40/i);
    assert.equal((await as(teacher, "select count(*)::int n from battle_players where room_id=$1", [roomId])).rows[0].n, 40);
    await reject(() => rpc(outsiders[1], "join_battle_room", ["234567"]), /selected class/i);
  });
  await test("room teacher and joined student read every player/event; outsiders do not", async () => {
    const players = (await as(teacher, "select * from battle_players where room_id=$1 order by student_id", [roomId])).rows;
    await as(students[0], "insert into battle_events(room_id,player_id,is_correct,damage,effect) values ($1,$2,true,20,'fixture-answer')", [roomId, players[0].id]);
    for (const viewer of [teacher, students[1]]) {
      assert.equal((await as(viewer, "select count(*)::int n from battle_players where room_id=$1", [roomId])).rows[0].n, 40);
      assert.equal((await as(viewer, "select count(*)::int n from battle_events where room_id=$1", [roomId])).rows[0].n, 1);
    }
    for (const viewer of [otherTeacher, ...outsiders]) {
      assert.equal((await as(viewer, "select count(*)::int n from battle_players where room_id=$1", [roomId])).rows[0].n, 0);
      assert.equal((await as(viewer, "select count(*)::int n from battle_events where room_id=$1", [roomId])).rows[0].n, 0);
    }
    await db.query("update profiles set status='disabled' where id=$1", [students[1]]);
    assert.equal((await as(students[1], "select count(*)::int n from battle_events where room_id=$1", [roomId])).rows[0].n, 0);
    await db.query("update profiles set status='active' where id=$1", [students[1]]);
  });
  await test("legacy direct inserts cannot bypass capacity or forge profile identity", async () => {
    for (const student of students.slice(0, 40)) await as(student,
      "insert into battle_players(room_id,student_id,display_name,class_name) values ($1,$2,'forged name','forged class')", [directRoom, student]);
    await reject(() => as(students[40], "insert into battle_players(room_id,student_id,display_name) values ($1,$2,'overflow')", [directRoom, students[40]]), /full.*40/i);
    const actual = (await as(teacher, "select display_name,class_name from battle_players where room_id=$1 and student_id=$2", [directRoom, students[0]])).rows[0];
    assert.equal(actual.display_name, "学生1"); assert.equal(actual.class_name, "高一甲");
  });
  await test("updates cannot move membership or change student identity", async () => {
    await reject(() => as(students[0], "update battle_players set room_id=$1 where room_id=$2 and student_id=$3", [recoverRoom, roomId, students[0]]), /identity.*cannot be changed/i);
    await reject(() => as(students[0], "update battle_players set student_id=$1 where room_id=$2 and student_id=$3", [outsiders[0], roomId, students[0]]), /identity.*cannot be changed/i);
  });
  let frozen;
  await test("only owning teacher can freeze an even roster; newcomers are blocked after freeze", async () => {
    await rpc(students[0], "join_battle_room", ["345678"]);
    await reject(() => rpc(teacher, "prepare_battle_room_start", [recoverRoom]), /even.*2.*40/i);
    await rpc(students[1], "join_battle_room", ["345678"]);
    await reject(() => rpc(otherTeacher, "prepare_battle_room_start", [recoverRoom]), /teacher who created/i);
    await reject(() => rpc(students[0], "prepare_battle_room_start", [recoverRoom]), /teacher account/i);
    frozen = await rpc(teacher, "prepare_battle_room_start", [recoverRoom]);
    assert.equal(frozen.players.length, 2);
    await reject(() => rpc(students[2], "join_battle_room", ["345678"]), /already started/i);
    await reject(() => as(students[2], "insert into battle_players(room_id,student_id,display_name) values ($1,$2,'late')", [recoverRoom, students[2]]), /already started/i);
    assert.equal(await rpc(students[0], "join_battle_room", ["345678"]), recoverRoom);
  });
  await test("delayed atomic first commit gets a fresh countdown; exact retries preserve committed bracket", async () => {
    // Simulate >188 seconds lost between roster freeze and bracket creation,
    // without sleeping or changing any external clock/database.
    await db.query("update battle_rooms set started_at=clock_timestamp()-interval '4 minutes' where id=$1", [recoverRoom]);
    const players = frozen.players.map((player) => ({ id: player.id, studentId: player.student_id, name: player.display_name, className: player.class_name, roomId: recoverRoom }));
    const input = createTournament(players, { id: recoverRoom, startedAt: Date.now() - 240000, durationSeconds: 999, random: () => 0.9 });
    const eventId = uuid(3000);
    const before = Date.now();
    const committed = await rpc(teacher, "commit_battle_room_start", [recoverRoom, eventId, JSON.stringify(input)]);
    assert.equal(committed.durationSeconds, 180);
    assert.ok(Date.parse(committed.startedAt) > before + 6500, "countdown must be stamped at metadata commit, not at stale freeze");
    const retry = await rpc(teacher, "commit_battle_room_start", [recoverRoom, eventId, JSON.stringify({ ...input, startedAt: new Date(0).toISOString() })]);
    assert.deepEqual(retry, committed);
    const room = (await as(teacher, "select * from battle_rooms where id=$1", [recoverRoom])).rows[0];
    assert.equal(new Date(room.started_at).getTime(), Date.parse(committed.startedAt));
    assert.equal((await as(teacher, "select count(*)::int n from battle_events where room_id=$1 and effect like 'tournament:%'", [recoverRoom])).rows[0].n, 1);
    await reject(() => rpc(students[0], "commit_battle_room_start", [recoverRoom, eventId, JSON.stringify(input)]), /teacher/i);
    await reject(() => rpc(otherTeacher, "commit_battle_room_start", [recoverRoom, eventId, JSON.stringify(input)]), /teacher/i);
    await db.query("update battle_rooms set status='finished' where id=$1", [recoverRoom]);
    assert.deepEqual(await rpc(teacher, "commit_battle_room_start", [recoverRoom, eventId, JSON.stringify(input)]), committed);
    assert.equal((await as(teacher, "select status from battle_rooms where id=$1", [recoverRoom])).rows[0].status, "finished");
  });
  await test("atomic commit rejects wrong rosters/byes/duplicate pairings and canonicalizes all 40 identities", async () => {
    const prepared = await rpc(teacher, "prepare_battle_room_start", [roomId]);
    const players = prepared.players.map((player) => ({ id: player.id, studentId: outsiders[0], name: "FAKE", className: "FAKE", roomId: directRoom }));
    const input = createTournament(players, { id: roomId, startedAt: Date.now(), random: () => 0.9 });
    const eventId = uuid(3001);
    const variants = [
      [{ ...input, roster: [{ ...input.roster[0], id: uuid(88888) }, ...input.roster.slice(1)] }, /roster differs/i],
      [{ ...input, matches: [{ ...input.matches[0], playerIds: [input.matches[0].playerIds[0]] }, ...input.matches.slice(1)] }, /byes/i],
      [{ ...input, matches: [{ ...input.matches[0], playerIds: [input.matches[0].playerIds[0], input.matches[0].playerIds[0]] }, ...input.matches.slice(1)] }, /exactly one/i],
      [{ ...input, history: [{ stageIndex: 1 }] }, /previous rounds/i],
      [{ ...input, version: 1 }, /version-2/i]
    ];
    for (const [invalid, pattern] of variants)
      await reject(() => rpc(teacher, "commit_battle_room_start", [roomId, eventId, JSON.stringify(invalid)]), pattern);
    assert.equal((await as(teacher, "select count(*)::int n from battle_events where room_id=$1 and effect like 'tournament:%'", [roomId])).rows[0].n, 0);
    const saved = await rpc(teacher, "commit_battle_room_start", [roomId, eventId, JSON.stringify(input)]);
    assert.equal(saved.roster.length, 40);
    assert.equal(saved.matches.length, 20);
    assert.ok(saved.roster.every((player) => player.name !== "FAKE" && player.className === "高一甲" && player.roomId === roomId && students.includes(player.studentId)));
    await reject(() => rpc(teacher, "commit_battle_room_start", [roomId, uuid(3002), JSON.stringify(input)]), /already has bracket/i);
    assert.equal((await as(teacher, "select count(*)::int n from battle_events where room_id=$1 and effect like 'tournament:%'", [roomId])).rows[0].n, 1);
  });
  await test("anonymous database role cannot execute admission/start/time RPCs", async () => {
    await db.exec("set role anon");
    try {
      await reject(() => db.query("select battle_server_time()"), /permission denied/i);
      await reject(() => db.query("select join_battle_room('123456')"), /permission denied/i);
      await reject(() => db.query("select prepare_battle_room_start($1)", [roomId]), /permission denied/i);
    } finally { await db.exec("reset role"); }
  });
  console.log(`${passed} PostgreSQL/RLS runtime checks passed. Single connection only; concurrent load was not tested.`);
} finally { await db.close(); }
