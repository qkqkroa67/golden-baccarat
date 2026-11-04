-- Live lobby presence is handled by Supabase Realtime Presence.
-- This table stores the current per-player bets for each private room.
create table if not exists public.game_room_bets (
  room_code text not null references public.game_rooms(code) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 16),
  side text not null check (side in ('P','B','T')),
  amount bigint not null check (amount > 0 and amount <= 100000000000),
  updated_at timestamptz not null default now(),
  primary key (room_code, user_id, side)
);

alter table public.game_room_bets enable row level security;
revoke all on table public.game_room_bets from anon, authenticated;
grant select on table public.game_room_bets to authenticated;

drop policy if exists "Room members can read live bets" on public.game_room_bets;
create policy "Room members can read live bets"
  on public.game_room_bets for select to authenticated
  using ((select public.is_game_room_member(room_code)));

create or replace function public.sync_game_room_bets(p_code text, p_bets jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  player_nickname text;
  item record;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in required';
  end if;
  if p_bets is null or jsonb_typeof(p_bets) <> 'object' then
    raise exception 'Invalid bets';
  end if;
  if not public.is_game_room_member(p_code) then
    raise exception 'Room membership required';
  end if;

  for item in select key, value from jsonb_each_text(p_bets) loop
    if item.key not in ('P','B','T')
       or item.value !~ '^[0-9]{1,12}$'
       or item.value::bigint > 100000000000 then
      raise exception 'Invalid bet amount';
    end if;
  end loop;

  select m.nickname into player_nickname
    from public.game_room_members m
   where m.room_code = p_code and m.user_id = (select auth.uid());

  delete from public.game_room_bets
   where room_code = p_code and user_id = (select auth.uid());

  insert into public.game_room_bets (room_code, user_id, nickname, side, amount, updated_at)
  select p_code, (select auth.uid()), player_nickname, item.key, item.value::bigint, now()
    from jsonb_each_text(p_bets) item
   where item.key in ('P','B','T') and item.value::bigint > 0;
end;
$$;

revoke all on function public.sync_game_room_bets(text, jsonb) from public, anon;
grant execute on function public.sync_game_room_bets(text, jsonb) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'game_room_bets'
  ) then
    alter publication supabase_realtime add table public.game_room_bets;
  end if;
end $$;
