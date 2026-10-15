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

create policy battle_players_read on public.battle_players for select to authenticated
using (student_id = auth.uid() or public.is_teacher() or exists (select 1 from public.battle_rooms r where r.id = battle_players.room_id and r.teacher_id = auth.uid()));
create policy battle_players_write on public.battle_players for all to authenticated
using (student_id = auth.uid() or public.is_teacher())
with check (student_id = auth.uid() or public.is_teacher());

create policy battle_events_read on public.battle_events for select to authenticated
using (
  public.is_teacher()
  or exists (
    select 1 from public.battle_players viewer
    where viewer.room_id = battle_events.room_id and viewer.student_id = auth.uid()
  )
);
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
