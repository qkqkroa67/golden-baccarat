-- One private save row per authenticated user.
create table if not exists public.game_saves (
  user_id uuid primary key references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.game_saves enable row level security;
revoke all on table public.game_saves from anon, authenticated;
grant select, insert, update on table public.game_saves to authenticated;

drop policy if exists "Users can read their own game save" on public.game_saves;
create policy "Users can read their own game save"
  on public.game_saves for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can create their own game save" on public.game_saves;
create policy "Users can create their own game save"
  on public.game_saves for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

drop policy if exists "Users can update their own game save" on public.game_saves;
create policy "Users can update their own game save"
  on public.game_saves for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

