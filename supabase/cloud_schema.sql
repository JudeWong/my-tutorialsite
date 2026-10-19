-- Personal AI Assistant cloud schema upgrade
-- Run this complete file once in Supabase Dashboard -> SQL Editor.
-- It keeps existing rows, adds the columns used by the web app, replaces public
-- policies with role-based policies, and creates a private material bucket.

create extension if not exists pgcrypto;

-- Ensure every client-created or server-created record can use UUIDs safely.
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.classes alter column id set default gen_random_uuid();
alter table public.registration_codes alter column id set default gen_random_uuid();
alter table public.materials alter column id set default gen_random_uuid();
alter table public.questions alter column id set default gen_random_uuid();
alter table public.notes alter column id set default gen_random_uuid();
alter table public.assignments alter column id set default gen_random_uuid();
alter table public.assignment_questions alter column id set default gen_random_uuid();
alter table public.submissions alter column id set default gen_random_uuid();
alter table public.student_answers alter column id set default gen_random_uuid();
alter table public.chat_threads alter column id set default gen_random_uuid();
alter table public.chat_messages alter column id set default gen_random_uuid();

alter table public.profiles add column if not exists class_id uuid references public.classes(id) on delete set null;
alter table public.profiles add column if not exists updated_at timestamptz not null default now();

alter table public.classes add column if not exists class_name text;
alter table public.classes add column if not exists year integer;
alter table public.classes add column if not exists active boolean not null default true;
alter table public.classes add column if not exists updated_at timestamptz not null default now();
create unique index if not exists classes_class_name_key on public.classes(class_name);

alter table public.registration_codes add column if not exists created_by uuid references auth.users(id) on delete cascade;
alter table public.registration_codes add column if not exists updated_at timestamptz not null default now();
-- Existing projects may require a class_name for every registration code.
-- The current code is shared by all classes, so use a safe school-wide label.
alter table public.registration_codes alter column class_name set default '全校';

alter table public.materials add column if not exists title_en text;
alter table public.materials add column if not exists year integer;
alter table public.materials add column if not exists topic text;
alter table public.materials add column if not exists topic_en text;
alter table public.materials add column if not exists file_name text;
alter table public.materials add column if not exists file_size bigint not null default 0;
alter table public.materials add column if not exists storage_path text;
alter table public.materials add column if not exists source_type text;
alter table public.materials add column if not exists material_type text not null default 'past-paper';
alter table public.materials add column if not exists requested_question_count integer not null default 0;
alter table public.materials add column if not exists status_en text;
alter table public.materials add column if not exists generation_mode text;
alter table public.materials add column if not exists updated_at timestamptz not null default now();

alter table public.questions add column if not exists created_by uuid references auth.users(id) on delete set null;
alter table public.questions add column if not exists position integer not null default 0;
alter table public.questions add column if not exists question_type text not null default 'mcq';
alter table public.questions add column if not exists topic text;
alter table public.questions add column if not exists difficulty text;
alter table public.questions add column if not exists title_en text;
alter table public.questions add column if not exists code text;
alter table public.questions add column if not exists options_en jsonb not null default '[]'::jsonb;
alter table public.questions add column if not exists correct_index integer;
alter table public.questions add column if not exists accepted_answers jsonb not null default '[]'::jsonb;
alter table public.questions add column if not exists explanation_en text;
alter table public.questions add column if not exists common_mistakes_en text;
alter table public.questions add column if not exists image_path text;
alter table public.questions add column if not exists image_alt text;
alter table public.questions add column if not exists updated_at timestamptz not null default now();

alter table public.notes add column if not exists updated_at timestamptz not null default now();

alter table public.assignments add column if not exists material_id uuid references public.materials(id) on delete cascade;
alter table public.assignments add column if not exists title_en text;
alter table public.assignments add column if not exists description text;
alter table public.assignments add column if not exists description_en text;
alter table public.assignments add column if not exists icon text not null default '✦';
alter table public.assignments add column if not exists published boolean not null default true;
alter table public.assignments add column if not exists updated_at timestamptz not null default now();
alter table public.assignments alter column class_id drop not null;

alter table public.assignment_questions add column if not exists position integer not null default 0;
alter table public.assignment_questions add column if not exists created_at timestamptz not null default now();
create unique index if not exists assignment_question_unique on public.assignment_questions(assignment_id, question_id);

alter table public.submissions add column if not exists total_questions integer not null default 0;
alter table public.submissions add column if not exists status text not null default 'completed';
alter table public.submissions add column if not exists started_at timestamptz;
alter table public.submissions add column if not exists created_at timestamptz not null default now();
alter table public.submissions add column if not exists updated_at timestamptz not null default now();

alter table public.student_answers add column if not exists created_at timestamptz not null default now();

-- Realtime is used by the teacher dashboard. These guarded statements are
-- safe when the tables are already part of the Supabase realtime publication.
do $$
begin
  begin
    alter publication supabase_realtime add table public.submissions;
  exception when duplicate_object or undefined_object then null;
  end;
end $$;

-- Chat tables are kept compatible with the existing database names used by
-- the application. Existing projects may already have these columns; the
-- guards make this safe to run again.
alter table public.chat_threads add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.chat_threads add column if not exists title text not null default 'AI 对话';
alter table public.chat_threads add column if not exists created_at timestamptz not null default now();
alter table public.chat_messages add column if not exists thread_id uuid references public.chat_threads(id) on delete cascade;
alter table public.chat_messages add column if not exists sender text not null default 'user';
alter table public.chat_messages add column if not exists message text not null default '';
alter table public.chat_messages add column if not exists created_at timestamptz not null default now();

create or replace function public.is_teacher()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher' and coalesce(status, 'active') = 'active'
  );
$$;

revoke all on function public.is_teacher() from public;
grant execute on function public.is_teacher() to authenticated;

-- GitHub Pages cannot execute /api/student-register. This auth trigger lets
-- the static site register students safely through Supabase Auth while still
-- requiring a current teacher-generated code and an active class.
create or replace function public.student_registration_ready()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select true;
$$;

revoke all on function public.student_registration_ready() from public;
grant execute on function public.student_registration_ready() to anon, authenticated;

create or replace function public.validate_student_auth_signup()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  student_name text := btrim(coalesce(new.raw_user_meta_data ->> 'full_name', ''));
  student_class text := btrim(coalesce(new.raw_user_meta_data ->> 'class_name', ''));
  registration_code text := btrim(coalesce(new.raw_user_meta_data ->> 'registration_code', ''));
  student_year integer;
begin
  if coalesce(new.raw_user_meta_data ->> 'role', '') <> 'student' then
    return new;
  end if;

  begin
    student_year := (new.raw_user_meta_data ->> 'year')::integer;
  exception when others then
    raise exception 'Student year is invalid.';
  end;

  if char_length(student_name) < 2 or char_length(student_name) > 12
     or char_length(student_class) < 2
     or student_year < 2000 or student_year > 2100
     or registration_code !~ '^[0-9]{6}$'
     or lower(coalesce(new.email, '')) !~ '^student\+[0-9a-f]{32}@chms3\.edu\.my$' then
    raise exception 'Student registration details are invalid.';
  end if;

  if not exists (
    select 1 from public.classes
    where class_name = student_class and active = true
  ) then
    raise exception 'The selected class is unavailable.';
  end if;

  if not exists (
    select 1 from public.registration_codes
    where code::text = registration_code and expires_at > now()
  ) then
    raise exception 'The registration code is incorrect or expired.';
  end if;

  -- Student accounts use generated school-local addresses, so they cannot
  -- receive confirmation mail. The valid hourly code is the confirmation.
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  new.raw_user_meta_data := coalesce(new.raw_user_meta_data, '{}'::jsonb) || jsonb_build_object(
    'role', 'student',
    'full_name', student_name,
    'class_name', student_class,
    'year', student_year
  );
  return new;
end;
$$;

create or replace function public.complete_student_registration(
  student_name text,
  student_class text,
  student_year integer,
  registration_code text
)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  selected_class_id uuid;
  current_metadata jsonb;
begin
  if auth.uid() is null then
    raise exception 'Student authentication is required.';
  end if;

  select raw_user_meta_data into current_metadata from auth.users where id = auth.uid();
  student_name := btrim(coalesce(student_name, ''));
  student_class := btrim(coalesce(student_class, ''));
  registration_code := btrim(coalesce(registration_code, ''));

  if coalesce(current_metadata ->> 'role', '') <> 'student'
     or current_metadata ->> 'full_name' <> student_name
     or current_metadata ->> 'class_name' <> student_class
     or (current_metadata ->> 'year')::integer <> student_year then
    raise exception 'Student registration details do not match the authenticated account.';
  end if;

  select id into selected_class_id
  from public.classes
  where class_name = student_class and active = true
  limit 1;

  if selected_class_id is null or not exists (
    select 1 from public.registration_codes
    where code::text = registration_code and expires_at > now()
  ) then
    raise exception 'The registration code is incorrect or expired, or the class is unavailable.';
  end if;

  insert into public.profiles (id, full_name, role, class_id, class_name, year, status)
  values (auth.uid(), student_name, 'student', selected_class_id, student_class, student_year, 'active')
  on conflict (id) do update
  set full_name = excluded.full_name,
      role = 'student',
      class_id = excluded.class_id,
      class_name = excluded.class_name,
      year = excluded.year,
      status = 'active',
      updated_at = now();

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) - 'registration_code'
  where id = auth.uid();
end;
$$;

revoke all on function public.validate_student_auth_signup() from public;
revoke all on function public.complete_student_registration(text, text, integer, text) from public;
grant execute on function public.complete_student_registration(text, text, integer, text) to authenticated;

drop trigger if exists validate_student_auth_signup on auth.users;
create trigger validate_student_auth_signup
before insert on auth.users
for each row execute function public.validate_student_auth_signup();

drop trigger if exists create_student_profile_after_signup on auth.users;
drop function if exists public.create_student_profile_after_signup();

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','classes','registration_codes','materials','questions','notes','assignments','assignment_questions','submissions','student_answers','chat_threads','chat_messages']
  loop
    execute format('alter table public.%I enable row level security', table_name);
  end loop;
end $$;

-- Anonymous visitors must not be able to read school or account records.
revoke all on table public.profiles, public.classes, public.registration_codes,
  public.materials, public.questions, public.notes, public.assignments,
  public.assignment_questions, public.submissions, public.student_answers,
  public.chat_threads, public.chat_messages from anon;

-- Class names are intentionally readable before sign-in so the registration
-- form can provide a teacher-managed dropdown. No teacher or student data is exposed.
grant select (class_name) on public.classes to anon;

grant select, insert, update, delete on table public.profiles, public.classes,
  public.registration_codes, public.materials, public.questions, public.notes,
  public.assignments, public.assignment_questions, public.submissions,
  public.student_answers, public.chat_threads, public.chat_messages to authenticated;

-- Replace earlier prototype policies, including any policy that exposed profiles publicly.
do $$
declare policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname from pg_policies
    where schemaname = 'public' and tablename = any(array['profiles','classes','registration_codes','materials','questions','notes','assignments','assignment_questions','submissions','student_answers','chat_threads','chat_messages'])
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

create policy profiles_read on public.profiles for select to authenticated
using (id = auth.uid() or public.is_teacher());
create policy profiles_teacher_write on public.profiles for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy classes_read on public.classes for select to authenticated
using (active or public.is_teacher());
create policy classes_public_names on public.classes for select to anon
using (active);
create policy classes_teacher_write on public.classes for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy registration_codes_teacher_only on public.registration_codes for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy materials_read on public.materials for select to authenticated
using (public.is_teacher() or status in ('已整理', 'ready', 'published', 'Organized'));
create policy materials_teacher_write on public.materials for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy questions_read on public.questions for select to authenticated
using (
  public.is_teacher() or exists (
    select 1 from public.materials m
    where m.id = questions.material_id and m.status in ('已整理', 'ready', 'published', 'Organized')
  ) or exists (
    select 1
    from public.assignment_questions aq
    join public.assignments a on a.id = aq.assignment_id
    where aq.question_id = questions.id
      and a.published
      and (
        a.class_id is null
        or a.class_id = (select class_id from public.profiles where id = auth.uid())
      )
  )
);
create policy questions_teacher_write on public.questions for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy notes_read on public.notes for select to authenticated using (true);
create policy notes_teacher_write on public.notes for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy assignments_read on public.assignments for select to authenticated
using (
  public.is_teacher() or (
    published and (
      class_id is null or class_id = (select class_id from public.profiles where id = auth.uid())
    )
  )
);
create policy assignments_teacher_write on public.assignments for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy assignment_questions_read on public.assignment_questions for select to authenticated
using (exists (select 1 from public.assignments a where a.id = assignment_questions.assignment_id));
create policy assignment_questions_teacher_write on public.assignment_questions for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy submissions_read on public.submissions for select to authenticated
using (student_id = auth.uid() or public.is_teacher());
create policy submissions_student_insert on public.submissions for insert to authenticated
with check (student_id = auth.uid());
create policy submissions_student_update on public.submissions for update to authenticated
using (student_id = auth.uid()) with check (student_id = auth.uid());
create policy submissions_teacher_write on public.submissions for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy student_answers_read on public.student_answers for select to authenticated
using (
  public.is_teacher() or exists (
    select 1 from public.submissions s
    where s.id = student_answers.submission_id and s.student_id = auth.uid()
  )
);
create policy student_answers_student_insert on public.student_answers for insert to authenticated
with check (
  exists (select 1 from public.submissions s where s.id = student_answers.submission_id and s.student_id = auth.uid())
);
create policy student_answers_teacher_write on public.student_answers for all to authenticated
using (public.is_teacher()) with check (public.is_teacher());

create policy chat_threads_owner on public.chat_threads for all to authenticated
using (user_id = auth.uid() or public.is_teacher())
with check (user_id = auth.uid() or public.is_teacher());
create policy chat_messages_owner on public.chat_messages for all to authenticated
using (
  exists (select 1 from public.chat_threads t where t.id = chat_messages.thread_id and (t.user_id = auth.uid() or public.is_teacher()))
)
with check (
  exists (select 1 from public.chat_threads t where t.id = chat_messages.thread_id and (t.user_id = auth.uid() or public.is_teacher()))
);

-- Live 1v1 quiz battle rooms. The game is event-based so every answer,
-- attack, combo and skill remains auditable and can be replayed after refresh.
create table if not exists public.battle_rooms (
  id uuid primary key default gen_random_uuid(),
  room_code text not null unique,
  teacher_id uuid not null references auth.users(id) on delete cascade,
  class_name text,
  assignment_id uuid references public.assignments(id) on delete set null,
  status text not null default 'lobby' check (status in ('lobby','battle','finished','cancelled')),
  started_at timestamptz,
  duration_seconds integer not null default 180,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.battle_players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.battle_rooms(id) on delete cascade,
  student_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  class_name text,
  status text not null default 'ready' check (status in ('ready','playing','left','finished')),
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(room_id, student_id)
);

create table if not exists public.battle_events (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.battle_rooms(id) on delete cascade,
  player_id uuid not null references public.battle_players(id) on delete cascade,
  round_number integer not null default 0,
  event_type text not null default 'answer',
  question_id uuid references public.questions(id) on delete set null,
  is_correct boolean not null default false,
  damage integer not null default 0,
  effect text,
  created_at timestamptz not null default now()
);

create index if not exists battle_rooms_code_idx on public.battle_rooms(room_code);
create index if not exists battle_players_room_idx on public.battle_players(room_id, joined_at);
create index if not exists battle_events_room_idx on public.battle_events(room_id, created_at);

-- The target is stored explicitly so a correct answer can only damage the
-- opponent in that pair. This migration is safe to run on existing projects.
alter table public.battle_events
  add column if not exists target_player_id uuid references public.battle_players(id) on delete cascade;
create index if not exists battle_events_target_idx on public.battle_events(target_player_id, created_at);

alter table public.battle_rooms enable row level security;
alter table public.battle_players enable row level security;
alter table public.battle_events enable row level security;
grant select, insert, update on public.battle_rooms, public.battle_players, public.battle_events to authenticated;

drop policy if exists battle_rooms_read on public.battle_rooms;
drop policy if exists battle_rooms_teacher_write on public.battle_rooms;
drop policy if exists battle_players_read on public.battle_players;
drop policy if exists battle_players_write on public.battle_players;
drop policy if exists battle_events_read on public.battle_events;
drop policy if exists battle_events_insert on public.battle_events;

create policy battle_rooms_read on public.battle_rooms for select to authenticated
using (
  teacher_id = auth.uid()
  or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'student' and (battle_rooms.class_name is null or p.class_name = battle_rooms.class_name))
);
create policy battle_rooms_teacher_write on public.battle_rooms for all to authenticated
using (teacher_id = auth.uid() or public.is_teacher())
with check (teacher_id = auth.uid() or public.is_teacher());

-- SECURITY DEFINER avoids a recursive RLS lookup when a student needs to see
-- the other player in the same room. It only returns a boolean membership
-- result and never exposes unrelated rooms.
create or replace function public.can_view_battle_room(target_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_teacher()
    or exists (
      select 1 from public.battle_rooms room
      where room.id = target_room_id and room.teacher_id = auth.uid()
    )
    or exists (
      select 1 from public.battle_players viewer
      where viewer.room_id = target_room_id and viewer.student_id = auth.uid()
    );
$$;
grant execute on function public.can_view_battle_room(uuid) to authenticated;

create policy battle_players_read on public.battle_players for select to authenticated
using (public.can_view_battle_room(battle_players.room_id));
create policy battle_players_write on public.battle_players for all to authenticated
using (student_id = auth.uid() or public.is_teacher())
with check (student_id = auth.uid() or public.is_teacher());

create policy battle_events_read on public.battle_events for select to authenticated
using (public.can_view_battle_room(battle_events.room_id));
create policy battle_events_insert on public.battle_events for insert to authenticated
with check (exists (select 1 from public.battle_players bp where bp.id = battle_events.player_id and (bp.student_id = auth.uid() or public.is_teacher())));

do $$ begin
  alter publication supabase_realtime add table public.battle_rooms;
exception when duplicate_object or undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.battle_players;
exception when duplicate_object or undefined_object then null;
end $$;
do $$ begin
  alter publication supabase_realtime add table public.battle_events;
exception when duplicate_object or undefined_object then null;
end $$;

insert into storage.buckets (id, name, public)
values ('learning-materials', 'learning-materials', false)
on conflict (id) do update set public = false;

drop policy if exists material_files_teacher_read on storage.objects;
drop policy if exists material_files_teacher_insert on storage.objects;
drop policy if exists material_files_teacher_update on storage.objects;
drop policy if exists material_files_teacher_delete on storage.objects;
create policy material_files_teacher_read on storage.objects for select to authenticated
using (bucket_id = 'learning-materials' and public.is_teacher());
create policy material_files_teacher_insert on storage.objects for insert to authenticated
with check (bucket_id = 'learning-materials' and public.is_teacher());
create policy material_files_teacher_update on storage.objects for update to authenticated
using (bucket_id = 'learning-materials' and public.is_teacher())
with check (bucket_id = 'learning-materials' and public.is_teacher());
create policy material_files_teacher_delete on storage.objects for delete to authenticated
using (bucket_id = 'learning-materials' and public.is_teacher());

drop policy if exists question_images_authenticated_read on storage.objects;
drop policy if exists question_images_teacher_insert on storage.objects;
drop policy if exists question_images_teacher_update on storage.objects;
drop policy if exists question_images_teacher_delete on storage.objects;
create policy question_images_authenticated_read on storage.objects for select to authenticated
using (bucket_id = 'learning-materials' and name like 'question-images/%');
create policy question_images_teacher_insert on storage.objects for insert to authenticated
with check (bucket_id = 'learning-materials' and name like 'question-images/%' and public.is_teacher());
create policy question_images_teacher_update on storage.objects for update to authenticated
using (bucket_id = 'learning-materials' and name like 'question-images/%' and public.is_teacher())
with check (bucket_id = 'learning-materials' and name like 'question-images/%' and public.is_teacher());
create policy question_images_teacher_delete on storage.objects for delete to authenticated
using (bucket_id = 'learning-materials' and name like 'question-images/%' and public.is_teacher());

-- Keep the requested superadmin profile available after Auth account creation.
-- Some existing projects make profiles.year NOT NULL, so provide a safe
-- current-year value and a teacher class label during the bootstrap upsert.
insert into public.profiles (id, full_name, role, class_name, year, status)
select
  u.id,
  'Teacher Jude',
  'teacher',
  '教师',
  extract(year from current_date)::integer,
  'active'
from auth.users u
where lower(u.email) = 'wsl@chms3.edu.my'
on conflict (id) do update
set full_name = 'Teacher Jude',
    role = 'teacher',
    class_name = coalesce(public.profiles.class_name, excluded.class_name),
    year = coalesce(public.profiles.year, excluded.year),
    status = 'active',
    updated_at = now();

do $$
declare table_name text;
begin
  foreach table_name in array array['profiles','classes','materials','questions','notes','assignments','submissions']
  loop
    execute format('drop trigger if exists set_%I_updated_at on public.%I', table_name, table_name);
    execute format('create trigger set_%I_updated_at before update on public.%I for each row execute function public.set_updated_at()', table_name, table_name);
  end loop;
end $$;

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
