-- Minimal live upgrade of the two existing, locked start functions.
-- No policies/permissions, room rows, students or history are changed.
begin;
do $migration$
declare definition text; signature text;
begin
  foreach signature in array array[
    'public.prepare_battle_room_start(uuid)',
    'public.commit_battle_room_start(uuid,uuid,jsonb)'
  ] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if position('mod(player_count, 2) <> 0' in definition)=0 then
      if position('From 2 to 40 students' in definition)>0
         or position('The first round permits at most one bye.' in definition)>0 then
        continue;
      end if;
      raise exception 'Unrecognized start function %. Review before migration.', signature;
    end if;
    definition := replace(definition,' or mod(player_count, 2) <> 0','');
    definition := replace(definition,'An even number of students from 2 to 40 is required to start the battle.','From 2 to 40 students are required to start the battle.');
    definition := replace(definition,'frozen even roster','frozen roster');
    definition := replace(definition,'<> player_count / 2','<> (player_count + 1) / 2');
    definition := replace(definition,'Every student must play in a two-player first-round match.','The first round permits at most one bye.');
    definition := replace(definition,'jsonb_array_length(match_entry->''playerIds'') <> 2','jsonb_array_length(match_entry->''playerIds'') not in (1, 2)');
    definition := replace(definition,'or jsonb_typeof(match_entry->''playerIds''->1) is distinct from ''string'' then','or (jsonb_array_length(match_entry->''playerIds'') = 2 and jsonb_typeof(match_entry->''playerIds''->1) is distinct from ''string'') then');
    definition := replace(definition,'First-round byes are not allowed.','Each match must contain one or two players.');
    definition := replace(definition,'paired_player_ids := array_append(paired_player_ids, match_entry->''playerIds''->>1);','if jsonb_array_length(match_entry->''playerIds'') = 2 then paired_player_ids := array_append(paired_player_ids, match_entry->''playerIds''->>1); end if;');
    definition := replace(definition,'if unique_count <> player_count or not (paired_player_ids <@ roster_ids) then','if unique_count <> player_count or cardinality(paired_player_ids) <> player_count or not (paired_player_ids <@ roster_ids) then');
    execute definition;
  end loop;
end;
$migration$;
notify pgrst, 'reload schema';
commit;
