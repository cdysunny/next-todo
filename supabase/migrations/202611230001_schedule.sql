begin;

create table public.schedule_terms (
  user_id uuid not null references auth.users(id) on delete cascade,
  term text not null check (term ~ '^20[0-9]{2}-20[0-9]{2}-[12]$'),
  monday date not null check (extract(isodow from monday) = 1),
  primary key (user_id, term)
);
create table public.schedule_classes (
  user_id uuid not null,
  term text not null,
  week integer not null check (week between 1 and 30),
  day integer not null check (day between 1 and 7),
  periods text not null check (periods ~ '^[0-9]{1,2}(-[0-9]{1,2}){0,29}$'),
  title text not null check (char_length(title) between 1 and 160 and title not like '%智慧树%'),
  teacher text not null check (char_length(teacher) between 1 and 120),
  place text not null check (char_length(place) between 1 and 160 and place not like '%智慧树%'),
  starts_at timestamptz not null,
  primary key (user_id, term, starts_at, periods, title, place, teacher),
  foreign key (user_id, term) references public.schedule_terms(user_id, term) on delete cascade
);
create index schedule_classes_due on public.schedule_classes (starts_at);

create table public.schedule_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null check (length(endpoint) between 9 and 2048 and endpoint like 'https://%'),
  p256dh text not null check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  auth text not null check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  last_test_at timestamptz,
  unique (endpoint),
  unique (user_id, endpoint)
);
create table public.schedule_deliveries (
  device_id uuid not null references public.schedule_devices(id) on delete cascade,
  term text not null,
  starts_at timestamptz not null,
  periods text not null,
  title text not null,
  claimed_at timestamptz not null default now(),
  primary key (device_id, term, starts_at, periods, title)
);

alter table public.schedule_terms enable row level security;
alter table public.schedule_classes enable row level security;
alter table public.schedule_devices enable row level security;
alter table public.schedule_deliveries enable row level security;
revoke all on public.schedule_terms, public.schedule_classes, public.schedule_devices, public.schedule_deliveries from public, anon, authenticated;
grant select on public.schedule_terms, public.schedule_classes to authenticated;
grant select, delete on public.schedule_devices to authenticated;
grant insert (user_id, endpoint, p256dh, auth), update (user_id, endpoint, p256dh, auth) on public.schedule_devices to authenticated;
grant select on public.schedule_terms, public.schedule_classes to service_role;
grant select, delete on public.schedule_devices to service_role;
grant update (last_test_at) on public.schedule_devices to service_role;
grant select, insert, delete on public.schedule_deliveries to service_role;
create policy schedule_terms_own on public.schedule_terms for select to authenticated using (user_id = (select auth.uid()));
create policy schedule_classes_own on public.schedule_classes for select to authenticated using (user_id = (select auth.uid()));
create policy schedule_devices_own on public.schedule_devices for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create function public.replace_schedule(p_term text, p_monday date, p_courses jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null or jsonb_typeof(p_courses) is distinct from 'array' or jsonb_array_length(p_courses) > 1000 then
    raise exception 'Invalid schedule';
  end if;
  insert into public.schedule_terms(user_id, term, monday) values(owner_id, p_term, p_monday)
  on conflict (user_id, term) do update set monday = excluded.monday;
  delete from public.schedule_classes where user_id = owner_id and term = p_term;
  insert into public.schedule_classes(user_id, term, week, day, periods, title, teacher, place, starts_at)
    select distinct owner_id, p_term, c.week, c.day, c.periods, c.title, c.teacher, c.place,
      ((p_monday + ((c.week - 1) * 7 + c.day - 1)) + c.time) at time zone 'Asia/Shanghai'
    from jsonb_to_recordset(p_courses) as c(week int, day int, periods text, title text, teacher text, place text, time time);
end;
$$;
revoke all on function public.replace_schedule(text,date,jsonb) from public, anon, authenticated;
grant execute on function public.replace_schedule(text,date,jsonb) to authenticated;

create function public.claim_class_reminders() returns table (
  device_id uuid, endpoint text, p256dh text, auth text, term text, starts_at timestamptz, periods text, title text, place text
) language sql security invoker set search_path = '' as $$
  with due as materialized (
    select distinct on (d.id, c.term, c.starts_at, c.periods, c.title)
      d.id, d.endpoint, d.p256dh, d.auth, c.term, c.starts_at, c.periods, c.title, c.place
    from public.schedule_classes c join public.schedule_devices d on d.user_id = c.user_id
    where c.starts_at <= now() and c.starts_at > now() - interval '5 minutes'
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
revoke all on function public.claim_class_reminders() from public, anon, authenticated;
grant execute on function public.claim_class_reminders() to service_role;

commit;
