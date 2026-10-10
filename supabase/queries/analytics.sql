-- Handy questions to ask the analytics. Paste one into the SQL Editor and Run.

-- 1. The daily summary.
select * from analytics_daily limit 30;

-- 2. Do people come back? Players seen on more than one day, out of all players.
select
  count(*) filter (where days > 1) as returning_players,
  count(*)                          as all_players
from (
  select player, count(distinct (at at time zone 'America/New_York')::date) as days
  from analytics_events
  where name = 'player_joined'
  group by player
) p;

-- 3. Funnel: of the tables created, how many got a second player, and how many actually dealt?
select
  count(*)                                                              as tables,
  count(*) filter (where (props ->> 'players')::int >= 2)               as with_2_plus_players,
  count(*) filter (where (props ->> 'started')::boolean)                as played
from analytics_events
where name = 'room_ended';

-- 4. Busiest hours (Eastern), to know when not to deploy.
select extract(hour from at at time zone 'America/New_York') as hour, count(*) as joins
from analytics_events
where name = 'player_joined'
group by 1
order by 1;
