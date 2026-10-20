# Battle live-sync and odd roster update

## Deployment

Existing installations from the 40-player release:

1. Run supabase/upgrade_battle_odd_rosters.sql.
2. Run supabase/upgrade_battle_live_and_assignments.sql.
3. Deploy the web bundle (cache version v86).

Fresh installations can use the updated cloud_schema.sql.
No existing students, submissions, room rosters or brackets are migrated/deleted.
New RPCs are SECURITY INVOKER and retain the existing room/class RLS boundary.

## Changes

Production UI verification exposed the central teacher display bug: the
vanilla translation pass cached a text node's first value and reapplied it
on background refresh. React's live room/count/round/score/timer text was
thus overwritten with stale values despite correct server data.
Arena nodes and the victory portal are now excluded from that DOM walker;
their labels are translated during React rendering instead.

- 2–40 entrants, odd counts permitted; at most one bye each round.
- Read the room, all participants and all events in one consistent snapshot.
- Do not cache Supabase/authenticated/API traffic in the service worker.
- Calibrate the countdown with the snapshot's database timestamp; expire stuck requests.
- Derive historical round labels from actual entrants; do not count countdown/bye as active combat.
- Teacher can reopen owned recent rooms without starting or reshuffling them.
- Save assignments and ordered question links transactionally, retaining existing IDs.
- Prevent background snapshots from overwriting a newer write and clone queued save payloads.
- Load every class/question/assignment page even when the API row cap is lower than the requested range.

## Verification

Run pnpm run test:battle and pnpm run test:battle:sql.
SQL tests run only in isolated PGlite and cover old-to-new migration,
all odd starting sizes 3–39, the 40-player cap, read permissions,
assignment rollback, stable question-link IDs and unauthorized writes.
Engine tests simulate all sizes 2–40 through final medals.
These are not a 40-device concurrent production load test.

Production checks used existing records, teacher-scoped reads, and an
assignment re-save inside a transaction that was rolled back.
No live tournament was started, advanced, reshuffled or populated with test students.
