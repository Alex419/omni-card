-- Game analytics written by the server (apps/server/src/analytics/analytics.ts).
-- Run once in the Supabase dashboard: SQL Editor -> paste -> Run.
--
-- What's stored: event name, time, room code, a pseudonymous player id (an HMAC of the
-- browser's random token; it can't be turned back into the token) and a few numbers.
-- Never stored: names, IP addresses, cookies, or anything players typed.

create table if not exists public.analytics_events (
  id      bigint generated always as identity primary key,
  at      timestamptz not null default now(),
  name    text not null check (name in ('room_created', 'player_joined', 'game_started', 'room_ended', 'feedback_sent')),
  room    text,
  player  text,
  props   jsonb not null default '{}'
);

-- Same lock-down as feedback: RLS on with no policies, and only the server's secret key may insert.
alter table public.analytics_events enable row level security;
grant insert on table public.analytics_events to service_role;

create index if not exists analytics_events_at_idx on public.analytics_events (at desc);
create index if not exists analytics_events_name_at_idx on public.analytics_events (name, at desc);

-- One row per day (US Eastern), newest first. Open it in the Table Editor, or `select * from analytics_daily;`.
-- security_invoker: the view runs with the permissions of whoever queries it, so it can't be used
-- to read around the table's lock-down.
create or replace view public.analytics_daily with (security_invoker = true) as
select
  (at at time zone 'America/New_York')::date                                   as day,
  count(*) filter (where name = 'room_created')                                 as tables_created,
  count(distinct player) filter (where name = 'player_joined')                  as unique_players,
  count(*) filter (where name = 'game_started')                                 as games_started,
  round(avg((props ->> 'minutes')::numeric)
        filter (where name = 'room_ended' and (props ->> 'started')::boolean), 1) as avg_game_minutes,
  max((props ->> 'peakSeated')::int) filter (where name = 'room_ended')         as biggest_table,
  count(*) filter (where name = 'feedback_sent')                                as feedback
from public.analytics_events
group by 1
order by 1 desc;

revoke all on public.analytics_daily from anon, authenticated;
