-- Run once in Supabase SQL Editor for an existing project.
-- It lets a student read every battle_players row in a room they joined,
-- without exposing players from unrelated rooms.

begin;

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

drop policy if exists battle_players_read on public.battle_players;
create policy battle_players_read on public.battle_players for select to authenticated
using (public.can_view_battle_room(battle_players.room_id));

drop policy if exists battle_events_read on public.battle_events;
create policy battle_events_read on public.battle_events for select to authenticated
using (public.can_view_battle_room(battle_events.room_id));

commit;
