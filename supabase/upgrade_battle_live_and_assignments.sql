-- Run after upgrade_battle_40_players.sql. No student/progress/history removal.
begin;

-- One statement snapshot: roster, round metadata and answers cannot come
-- from different requests/rounds. SECURITY INVOKER retains existing RLS.
create or replace function public.battle_room_snapshot(target_room_id uuid)
returns jsonb language sql stable security invoker set search_path = public
as $$
  select jsonb_build_object(
    'room', to_jsonb(r),
    'players', coalesce((select jsonb_agg(to_jsonb(p) order by p.joined_at,p.id)
      from public.battle_players p where p.room_id=r.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.created_at,e.id)
      from public.battle_events e where e.room_id=r.id), '[]'::jsonb),
    'server_now', statement_timestamp())
  from public.battle_rooms r where r.id=target_room_id and public.can_view_battle_room(r.id);
$$;
revoke all on function public.battle_room_snapshot(uuid) from public, anon;
grant execute on function public.battle_room_snapshot(uuid) to authenticated;

-- Assignment records and their ordered questions commit together. Existing
-- assignment/link IDs and student submissions are preserved.
create or replace function public.save_assignment_batch(items jsonb)
returns integer language plpgsql security invoker set search_path = public
as $$
declare
  item jsonb;
  assignment_id_value uuid;
  question_ids uuid[];
  saved integer := 0;
begin
  if auth.uid() is null or not public.is_teacher() then
    raise exception using errcode='42501', message='Teacher access required.';
  end if;
  if jsonb_typeof(items) is distinct from 'array' then
    raise exception using errcode='22023', message='Assignments must be an array.';
  end if;
  for item in select value from jsonb_array_elements(items) order by value->>'id'
  loop
    assignment_id_value := (item->>'id')::uuid;
    if (item->>'teacher_id')::uuid is distinct from auth.uid() then
      raise exception using errcode='42501', message='Assignment teacher mismatch.';
    end if;
    if exists(select 1 from assignments where id=assignment_id_value and teacher_id<>auth.uid()) then
      raise exception using errcode='42501', message='Assignment belongs to another teacher.';
    end if;
    if nullif(item->>'class_id','') is not null and not exists(
      select 1 from classes where id=(item->>'class_id')::uuid and active) then
      raise exception using errcode='22023', message='Selected class no longer exists or is inactive.';
    end if;
    select coalesce(array_agg(qid order by first_position),array[]::uuid[]) into question_ids
      from (select value::uuid qid,min(ordinality) first_position
        from jsonb_array_elements_text(coalesce(item->'question_ids','[]'::jsonb)) with ordinality
        group by value::uuid) q;
    if exists(select 1 from unnest(question_ids) qid where not exists(select 1 from questions q where q.id=qid)) then
      raise exception using errcode='23503', message='An assignment question is missing or inaccessible. Save questions first.';
    end if;
    insert into assignments(id,teacher_id,material_id,class_id,title,title_en,description,description_en,icon,published,updated_at)
    values(assignment_id_value,auth.uid(),(item->>'material_id')::uuid,(item->>'class_id')::uuid,
      item->>'title',item->>'title_en',item->>'description',item->>'description_en',coalesce(item->>'icon','✦'),true,now())
    on conflict(id) do update set material_id=excluded.material_id,class_id=excluded.class_id,
      title=excluded.title,title_en=excluded.title_en,description=excluded.description,
      description_en=excluded.description_en,icon=excluded.icon,published=excluded.published,updated_at=excluded.updated_at;
    -- Upsert first. Never temporarily expose an empty question list.
    insert into assignment_questions(assignment_id,question_id,position)
      select assignment_id_value,qid,ordinality-1 from unnest(question_ids) with ordinality as ids(qid,ordinality)
      on conflict(assignment_id,question_id) do update set position=excluded.position;
    delete from assignment_questions where assignment_id=assignment_id_value and not(question_id=any(question_ids));
    saved := saved+1;
  end loop;
  return saved;
end;
$$;
revoke all on function public.save_assignment_batch(jsonb) from public, anon;
grant execute on function public.save_assignment_batch(jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
