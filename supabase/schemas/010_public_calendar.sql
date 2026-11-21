-- Anonymous access is limited to the published schedule in a single week.
create schema club_calendar_private;
revoke all on schema club_calendar_private from public, anon, authenticated, service_role;
grant usage on schema club_calendar_private to anon, authenticated;

create function club_calendar_private.week(p_week date)
returns table (club_name text, location text, starts_at timestamptz, ends_at timestamptz, cancelled boolean)
language sql stable security definer set search_path = ''
as $$
 select c.name, c.location, s.starts_at, s.ends_at, s.status = 'cancelled'
 from club_private.sessions s
 join club_private.clubs c on c.id = s.club_id
 join club_private.terms t on t.id = c.term_id
 where c.status = 'published' and t.status = 'active'
  and extract(isodow from p_week) = 1
  and s.starts_at >= (p_week::timestamp at time zone 'Asia/Taipei')
  and s.starts_at < ((p_week + 7)::timestamp at time zone 'Asia/Taipei')
 order by s.starts_at, c.name, c.location, s.ends_at
$$;

create function public.club_public_calendar(p_week date)
returns table (club_name text, location text, starts_at timestamptz, ends_at timestamptz, cancelled boolean)
language sql stable security invoker set search_path = ''
as $$ select * from club_calendar_private.week(p_week) $$;

revoke all on function club_calendar_private.week(date), public.club_public_calendar(date)
 from public, anon, authenticated, service_role;
grant execute on function club_calendar_private.week(date), public.club_public_calendar(date)
 to anon, authenticated;
