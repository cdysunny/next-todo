begin;

alter table public.schedule_terms add column reminders_from timestamptz not null default '-infinity';

create schema if not exists schedule_private;
revoke all on schema schedule_private from public, anon, authenticated;
grant usage on schema schedule_private to authenticated;

create function schedule_private.calibrate_week(p_term text, p_week integer) returns date
language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  previous_monday date;
  new_monday date;
  shift_days integer;
  course_week integer;
begin
  if owner_id is null then raise exception 'Sign in required' using errcode = '42501'; end if;
  if p_week is null or p_week not between 1 and 30 then
    raise exception 'Week must be between 1 and 30' using errcode = '22023';
  end if;

  select monday into previous_monday from public.schedule_terms
  where user_id = owner_id and term = p_term for update;
  if not found then raise exception 'Schedule not found' using errcode = '22023'; end if;
  new_monday := date_trunc('week', statement_timestamp() at time zone 'Asia/Shanghai')::date - (p_week - 1) * 7;
  shift_days := new_monday - previous_monday;
  if shift_days = 0 then return new_monday; end if;

  -- Move the far end first so adjacent recurring classes cannot collide on the timestamp key.
  for course_week in select w.week from (
    select distinct week from public.schedule_classes where user_id = owner_id and term = p_term
  ) w order by case when shift_days > 0 then -w.week else w.week end
  loop
    update public.schedule_classes
    set starts_at = ((starts_at at time zone 'Asia/Shanghai') + shift_days * interval '1 day') at time zone 'Asia/Shanghai'
    where user_id = owner_id and term = p_term
      and week = course_week;
  end loop;

  update public.schedule_terms set monday = new_monday, reminders_from = clock_timestamp()
  where user_id = owner_id and term = p_term;
  return new_monday;
end;
$$;

revoke all on function schedule_private.calibrate_week(text,integer) from public, anon, authenticated;
grant execute on function schedule_private.calibrate_week(text,integer) to authenticated;

create function public.set_schedule_current_week(p_term text, p_week integer) returns date
language sql security invoker set search_path = '' as $$
  select schedule_private.calibrate_week(p_term, p_week);
$$;
revoke all on function public.set_schedule_current_week(text,integer) from public, anon, authenticated;
grant execute on function public.set_schedule_current_week(text,integer) to authenticated;

create or replace function public.claim_class_reminders() returns table (
  device_id uuid, endpoint text, p256dh text, auth text, term text, starts_at timestamptz, periods text, title text, place text
) language sql security invoker set search_path = '' as $$
  with due as materialized (
    select distinct on (d.id, c.term, c.starts_at, c.periods, c.title)
      d.id, d.endpoint, d.p256dh, d.auth, c.term, c.starts_at, c.periods, c.title, c.place
    from public.schedule_classes c
    join public.schedule_terms t on (t.user_id,t.term) = (c.user_id,c.term)
    join public.schedule_devices d on d.user_id = c.user_id
    where c.starts_at <= now() and c.starts_at > now() - interval '5 minutes' and c.starts_at >= t.reminders_from
      and not exists (select 1 from public.schedule_deliveries l
        where (l.device_id,l.term,l.starts_at,l.periods,l.title) = (d.id,c.term,c.starts_at,c.periods,c.title))
    order by d.id, c.term, c.starts_at, c.periods, c.title, c.place
    limit 100
  ), claimed as (
    insert into public.schedule_deliveries (device_id, term, starts_at, periods, title)
      select id, due.term, due.starts_at, due.periods, due.title from due
    on conflict do nothing returning *
  ) select d.id,d.endpoint,d.p256dh,d.auth,d.term,d.starts_at,d.periods,d.title,d.place
  from due d join claimed l on (l.device_id,l.term,l.starts_at,l.periods,l.title) = (d.id,d.term,d.starts_at,d.periods,d.title);
$$;

commit;
