-- Battle admission/start upgrade. Run once in the Supabase SQL editor.
-- Safe to rerun: no players, events, scores or saved brackets are deleted.
-- Existing rooms remain version 0; only newly prepared rooms become version 2.
begin;

alter table public.battle_rooms
  add column if not exists tournament_version integer not null default 0;

-- Reinstall the room-scoped read policies as well: older projects sometimes
-- expose only a student's own events, leaving the teacher monitor at zero.
-- A SECURITY DEFINER membership lookup avoids recursive player-table RLS.
create or replace function public.can_view_battle_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and coalesce(p.status, 'active') = 'active'
      and (
        (p.role = 'teacher' and exists (
          select 1 from public.battle_rooms room
          where room.id = target_room_id and room.teacher_id = auth.uid()
        ))
        or (p.role = 'student' and exists (
          select 1 from public.battle_players viewer
          where viewer.room_id = target_room_id and viewer.student_id = auth.uid()
        ))
      )
  );
$$;
revoke all on function public.can_view_battle_room(uuid) from public, anon;
grant execute on function public.can_view_battle_room(uuid) to authenticated;
alter table public.battle_players enable row level security;
alter table public.battle_events enable row level security;
grant select on public.battle_players, public.battle_events to authenticated;
drop policy if exists battle_players_read on public.battle_players;
create policy battle_players_read on public.battle_players for select to authenticated
  using (public.can_view_battle_room(room_id));
drop policy if exists battle_events_read on public.battle_events;
create policy battle_events_read on public.battle_events for select to authenticated
  using (public.can_view_battle_room(room_id));

-- A legacy FOR ALL write policy also acts as a SELECT policy. Split it so
-- it cannot silently bypass the room-scoped read policy for other teachers.
drop policy if exists battle_players_write on public.battle_players;
drop policy if exists battle_players_insert on public.battle_players;
drop policy if exists battle_players_update on public.battle_players;
create policy battle_players_insert on public.battle_players for insert to authenticated
  with check (student_id = auth.uid());
create policy battle_players_update on public.battle_players for update to authenticated
  using (
    public.can_view_battle_room(room_id)
    and (student_id = auth.uid() or (public.is_teacher() and exists (
      select 1 from public.battle_rooms room where room.id = battle_players.room_id and room.teacher_id = auth.uid()
    )))
  )
  with check (
    public.can_view_battle_room(room_id)
    and (student_id = auth.uid() or (public.is_teacher() and exists (
      select 1 from public.battle_rooms room where room.id = battle_players.room_id and room.teacher_id = auth.uid()
    )))
  );

create or replace function public.battle_server_time()
returns timestamptz
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in before reading battle time.';
  end if;
  return clock_timestamp();
end;
$$;

-- Also protects older clients which still INSERT directly instead of using
-- join_battle_room. Admission and starting share the SAME parent-row lock.
create or replace function public.guard_battle_player_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  room_row public.battle_rooms%rowtype;
  student_name text;
  student_class text;
  player_count integer;
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id
      or new.room_id is distinct from old.room_id
      or new.student_id is distinct from old.student_id then
      raise exception using errcode = '23514', message = 'Battle player identity and room membership cannot be changed.';
    end if;
    return new;
  end if;

  if auth.uid() is null or new.student_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Students may only join using their own account.';
  end if;
  select p.full_name, p.class_name into student_name, student_class
    from public.profiles p
    where p.id = auth.uid() and p.role = 'student'
      and coalesce(p.status, 'active') = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'An active student account is required to join a battle.';
  end if;

  select r.* into room_row from public.battle_rooms r
    where r.id = new.room_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Battle room not found.';
  end if;

  -- Use profile identity, never a caller-supplied name/class for new players.
  new.display_name := coalesce(nullif(btrim(student_name), ''), '学生');
  new.class_name := student_class;
  if exists (select 1 from public.battle_players bp
    where bp.room_id = new.room_id and bp.student_id = new.student_id) then
    -- An ordinary duplicate still hits UNIQUE(room_id, student_id). An old
    -- client's idempotent upsert cannot create a new roster entry after start.
    return new;
  end if;
  if room_row.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'This battle has already started or is closed.';
  end if;
  if nullif(btrim(room_row.class_name), '') is not null
    and student_class is distinct from room_row.class_name then
    raise exception using errcode = '42501', message = 'This room is only open to the selected class.';
  end if;
  select count(*) into player_count from public.battle_players bp where bp.room_id = room_row.id;
  if player_count >= 40 then
    raise exception using errcode = 'P0001', message = 'This battle room is full (maximum 40 students).';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_battle_player_membership on public.battle_players;
create trigger guard_battle_player_membership
  before insert or update on public.battle_players
  for each row execute function public.guard_battle_player_membership();

create or replace function public.join_battle_room(room_code_input text)
returns uuid
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  room_row public.battle_rooms%rowtype;
  student_name text;
  student_class text;
  player_count integer;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Please sign in before joining a battle room.';
  end if;
  select p.full_name, p.class_name into student_name, student_class
    from public.profiles p
    where p.id = auth.uid() and p.role = 'student'
      and coalesce(p.status, 'active') = 'active';
  if not found then
    raise exception using errcode = '42501', message = 'An active student account is required to join a battle.';
  end if;
  select r.* into room_row from public.battle_rooms r
    where r.room_code = btrim(room_code_input) for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Battle room not found.';
  end if;
  if exists (select 1 from public.battle_players bp
    where bp.room_id = room_row.id and bp.student_id = auth.uid()) then
    -- Refresh/rejoin preserves the same participant, even after play starts.
    return room_row.id;
  end if;
  if room_row.status <> 'lobby' then
    raise exception using errcode = 'P0001', message = 'This battle has already started or is closed.';
  end if;
  if nullif(btrim(room_row.class_name), '') is not null
    and student_class is distinct from room_row.class_name then
    raise exception using errcode = '42501', message = 'This room is only open to the selected class.';
  end if;
  select count(*) into player_count from public.battle_players bp where bp.room_id = room_row.id;
  if player_count >= 40 then
    raise exception using errcode = 'P0001', message = 'This battle room is full (maximum 40 students).';
  end if;
  insert into public.battle_players (room_id, student_id, display_name, class_name, status)
    values (room_row.id, auth.uid(), coalesce(nullif(btrim(student_name), ''), '学生'), student_class, 'ready');
  return room_row.id;
end;
$$;

create or replace function public.prepare_battle_room_start(target_room_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  room_row public.battle_rooms%rowtype;
  player_count integer;
  frozen_players jsonb;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'teacher' and coalesce(p.status, 'active') = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active teacher account is required to start a battle.';
  end if;
  select r.* into room_row from public.battle_rooms r
    where r.id = target_room_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Battle room not found.';
  end if;
  if room_row.teacher_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Only the teacher who created this room can start it.';
  end if;
  if room_row.status <> 'lobby'
    and not (room_row.status = 'battle' and room_row.tournament_version = 2 and room_row.started_at is not null) then
    raise exception using errcode = 'P0001', message = 'This room is closed or is an existing legacy battle; it cannot be restarted.';
  end if;

  select count(*), coalesce(jsonb_agg(to_jsonb(bp) order by bp.joined_at, bp.id), '[]'::jsonb)
    into player_count, frozen_players
    from public.battle_players bp where bp.room_id = room_row.id;
  if player_count < 2 or player_count > 40 or mod(player_count, 2) <> 0 then
    raise exception using errcode = 'P0001', message = 'An even number of students from 2 to 40 is required to start the battle.';
  end if;
  if room_row.status = 'lobby' then
    update public.battle_rooms
      set status = 'battle', tournament_version = 2,
        started_at = clock_timestamp() + interval '8 seconds', updated_at = clock_timestamp()
      where id = room_row.id
      returning * into room_row;
  end if;
  -- This start time is provisional while metadata is absent. Membership is
  -- frozen here; commit_battle_room_start atomically allocates the real
  -- countdown together with its bracket, even after a delayed retry.
  return jsonb_build_object('started_at', room_row.started_at, 'players', frozen_players);
end;
$$;

-- Commit the initial bracket and its countdown in ONE transaction. Preparing
-- freezes membership only; a failed/slow metadata request must not consume the
-- first round's clock. A retry returns the saved snapshot without resetting it.
create or replace function public.commit_battle_room_start(
  target_room_id uuid, event_id uuid, tournament_input jsonb
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  room_row public.battle_rooms%rowtype;
  event_row public.battle_events%rowtype;
  snapshot jsonb;
  roster_member jsonb;
  match_entry jsonb;
  frozen_roster jsonb;
  player_count integer;
  roster_count integer;
  unique_count integer;
  matching_count integer;
  roster_ids text[] := array[]::text[];
  paired_player_ids text[] := array[]::text[];
  match_ids text[] := array[]::text[];
  start_time timestamptz;
begin
  if auth.uid() is null or not exists (
    select 1 from public.profiles p where p.id = auth.uid()
      and p.role = 'teacher' and coalesce(p.status, 'active') = 'active'
  ) then
    raise exception using errcode = '42501', message = 'An active teacher account is required to start a battle.';
  end if;
  if event_id is null then
    raise exception using errcode = '22023', message = 'The initial bracket event ID is required.';
  end if;
  select r.* into room_row from public.battle_rooms r
    where r.id = target_room_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Battle room not found.';
  end if;
  if room_row.teacher_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'Only the teacher who created this room can start it.';
  end if;
  if room_row.tournament_version <> 2 then
    raise exception using errcode = 'P0001', message = 'A legacy battle cannot be replaced with a new bracket.';
  end if;

  select e.* into event_row from public.battle_events e where e.id = event_id;
  if found then
    if event_row.room_id is distinct from target_room_id
      or event_row.event_type <> 'skill'
      or left(coalesce(event_row.effect, ''), 11) <> 'tournament:' then
      raise exception using errcode = '23505', message = 'This event ID is already used by an unrelated event.';
    end if;
    begin
      snapshot := substring(event_row.effect from 12)::jsonb;
    exception when invalid_text_representation then
      raise exception using errcode = '22023', message = 'The saved bracket metadata is invalid; it was not overwritten.';
    end;
    if snapshot->'version' is distinct from '2'::jsonb
      or snapshot->'stageIndex' is distinct from '0'::jsonb
      or snapshot->>'id' is distinct from target_room_id::text then
      raise exception using errcode = '23505', message = 'This event ID belongs to another bracket stage.';
    end if;
    -- Check the saved event before status: retries remain safe after the room
    -- has advanced or finished, and never restart the first round.
    return snapshot;
  end if;
  if room_row.status <> 'battle' then
    raise exception using errcode = 'P0001', message = 'Prepare this room before committing its initial bracket.';
  end if;
  if exists (select 1 from public.battle_events e
    where e.room_id = target_room_id and left(coalesce(e.effect, ''), 11) = 'tournament:') then
    raise exception using errcode = '23505', message = 'This room already has bracket metadata; it was not overwritten.';
  end if;

  if jsonb_typeof(tournament_input) is distinct from 'object'
    or tournament_input->'version' is distinct from '2'::jsonb
    or tournament_input->'stageIndex' is distinct from '0'::jsonb
    or tournament_input->>'id' is distinct from target_room_id::text
    or tournament_input->>'status' is distinct from 'battle'
    or tournament_input ? 'thirdPlacePlayerId' then
    raise exception using errcode = '22023', message = 'The initial version-2 bracket is invalid.';
  end if;
  if jsonb_typeof(tournament_input->'roster') is distinct from 'array'
    or jsonb_typeof(tournament_input->'matches') is distinct from 'array'
    or jsonb_typeof(tournament_input->'history') is distinct from 'array' then
    raise exception using errcode = '22023', message = 'The bracket roster, matches and history must be arrays.';
  end if;
  if jsonb_array_length(tournament_input->'history') <> 0 then
    raise exception using errcode = '22023', message = 'An initial bracket cannot contain previous rounds.';
  end if;
  select count(*) into player_count from public.battle_players bp where bp.room_id = target_room_id;
  roster_count := jsonb_array_length(tournament_input->'roster');
  if player_count < 2 or player_count > 40 or mod(player_count, 2) <> 0 or roster_count <> player_count then
    raise exception using errcode = '22023', message = 'The bracket must contain the frozen even roster of 2 to 40 students.';
  end if;
  for roster_member in select value from jsonb_array_elements(tournament_input->'roster')
  loop
    if jsonb_typeof(roster_member) is distinct from 'object'
      or jsonb_typeof(roster_member->'id') is distinct from 'string' then
      raise exception using errcode = '22023', message = 'Every roster member must have a player ID.';
    end if;
    roster_ids := array_append(roster_ids, roster_member->>'id');
  end loop;
  select count(distinct participant_id) into unique_count from unnest(roster_ids) as ids(participant_id);
  select count(*) into matching_count from public.battle_players bp
    where bp.room_id = target_room_id and bp.id::text = any(roster_ids);
  if unique_count <> player_count or matching_count <> player_count then
    raise exception using errcode = '22023', message = 'The bracket roster differs from the frozen room membership.';
  end if;
  if jsonb_array_length(tournament_input->'matches') <> player_count / 2 then
    raise exception using errcode = '22023', message = 'Every student must play in a two-player first-round match.';
  end if;
  for match_entry in select value from jsonb_array_elements(tournament_input->'matches')
  loop
    if jsonb_typeof(match_entry) is distinct from 'object'
      or jsonb_typeof(match_entry->'id') is distinct from 'string'
      or nullif(btrim(match_entry->>'id'), '') is null
      or match_entry->>'kind' is distinct from (case when player_count = 2 then 'final' else 'main' end)
      or jsonb_typeof(match_entry->'playerIds') is distinct from 'array' then
      raise exception using errcode = '22023', message = 'A first-round match is malformed.';
    end if;
    if jsonb_array_length(match_entry->'playerIds') <> 2
      or jsonb_typeof(match_entry->'playerIds'->0) is distinct from 'string'
      or jsonb_typeof(match_entry->'playerIds'->1) is distinct from 'string' then
      raise exception using errcode = '22023', message = 'First-round byes are not allowed.';
    end if;
    match_ids := array_append(match_ids, match_entry->>'id');
    paired_player_ids := array_append(paired_player_ids, match_entry->'playerIds'->>0);
    paired_player_ids := array_append(paired_player_ids, match_entry->'playerIds'->>1);
  end loop;
  select count(distinct match_id) into unique_count from unnest(match_ids) as ids(match_id);
  if unique_count <> player_count / 2 then
    raise exception using errcode = '22023', message = 'Match IDs must be unique.';
  end if;
  select count(distinct participant_id) into unique_count from unnest(paired_player_ids) as ids(participant_id);
  if unique_count <> player_count or not (paired_player_ids <@ roster_ids) then
    raise exception using errcode = '22023', message = 'Each frozen player must appear in exactly one first-round match.';
  end if;

  -- Preserve the teacher's persisted shuffle, but use authoritative identities
  -- and display names rather than trusting client-supplied student IDs.
  select jsonb_agg(jsonb_build_object(
    'id', bp.id, 'studentId', bp.student_id, 'name', bp.display_name,
    'className', coalesce(bp.class_name, ''), 'roomId', bp.room_id, 'status', bp.status
  ) order by participant.ordinality) into frozen_roster
    from jsonb_array_elements(tournament_input->'roster') with ordinality as participant(value, ordinality)
    join public.battle_players bp on bp.room_id = target_room_id and bp.id::text = participant.value->>'id';
  start_time := clock_timestamp() + interval '8 seconds';
  snapshot := tournament_input || jsonb_build_object(
    'startedAt', start_time, 'durationSeconds', room_row.duration_seconds, 'roster', frozen_roster
  );
  insert into public.battle_events (
    id, room_id, player_id, round_number, event_type, question_id, is_correct, damage, effect, created_at
  ) values (
    event_id, target_room_id, (roster_ids[1])::uuid, 0, 'skill', null, false, 0,
    'tournament:' || snapshot::text, clock_timestamp()
  );
  update public.battle_rooms set started_at = start_time, updated_at = clock_timestamp()
    where id = target_room_id;
  return snapshot;
end;
$$;

revoke all on function public.battle_server_time() from public, anon;
revoke all on function public.join_battle_room(text) from public, anon;
revoke all on function public.prepare_battle_room_start(uuid) from public, anon;
revoke all on function public.commit_battle_room_start(uuid, uuid, jsonb) from public, anon;
revoke all on function public.guard_battle_player_membership() from public, anon, authenticated;
grant execute on function public.battle_server_time() to authenticated;
grant execute on function public.join_battle_room(text) to authenticated;
grant execute on function public.prepare_battle_room_start(uuid) to authenticated;
grant execute on function public.commit_battle_room_start(uuid, uuid, jsonb) to authenticated;

-- Realtime publications are optional in local/test databases. Add only missing
-- memberships in Supabase; do not replace or remove an existing publication.
do $$
declare battle_table text;
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach battle_table in array array['battle_rooms', 'battle_players', 'battle_events']
    loop
      if not exists (
        select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = battle_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', battle_table);
      end if;
    end loop;
  end if;
end;
$$;

commit;
