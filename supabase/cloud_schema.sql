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
