create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 120 and title ~ '[^[:space:]]'),
  notes text check (char_length(notes) <= 2000),
  is_important boolean not null default false,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index tasks_owner_id on public.tasks (user_id, id);
alter table public.tasks enable row level security;

revoke all on public.tasks from public, anon, authenticated;
grant select, delete on public.tasks to authenticated;
grant insert (user_id, title, notes, is_important, due_at) on public.tasks to authenticated;
grant update (title, notes, is_important, due_at, completed_at) on public.tasks to authenticated;

create policy tasks_read on public.tasks for select to authenticated using ((select auth.uid()) = user_id);
create policy tasks_add on public.tasks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy tasks_edit on public.tasks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy tasks_delete on public.tasks for delete to authenticated using ((select auth.uid()) = user_id);
