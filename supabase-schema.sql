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
create policy "Users can read their own game save" on public.game_saves for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Users can create their own game save" on public.game_saves;
create policy "Users can create their own game save" on public.game_saves for insert to authenticated
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);
drop policy if exists "Users can update their own game save" on public.game_saves;
create policy "Users can update their own game save" on public.game_saves for update to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
  with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

-- Private login-ID mapping; normal clients can read only their own row.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on table public.profiles from anon, authenticated;
grant select on table public.profiles to authenticated;
drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles for select to authenticated
  using ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare requested_username text;
begin
  requested_username := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
  if requested_username !~ '^[a-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 lowercase letters, numbers, or underscores';
  end if;
  insert into public.profiles (user_id, username) values (new.id, requested_username);
  return new;
end;
$$;
revoke all on function public.create_profile_for_new_user() from public, anon, authenticated;
drop trigger if exists create_profile_for_new_user on auth.users;
create trigger create_profile_for_new_user after insert on auth.users
for each row execute function public.create_profile_for_new_user();

-- Shared live rooms. Each room has a host, member list, and latest baccarat round.
create table if not exists public.game_rooms (
  code text primary key check (code ~ '^[A-Z0-9]{5}$'),
  host_user_id uuid not null references auth.users (id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.game_room_members (
  room_code text not null references public.game_rooms (code) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 16),
  joined_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (room_code, user_id)
);
alter table public.game_room_members add column if not exists last_seen_at timestamptz not null default now();
create index if not exists game_room_members_user_id_idx on public.game_room_members (user_id);
alter table public.game_rooms enable row level security;
alter table public.game_room_members enable row level security;
revoke all on table public.game_rooms, public.game_room_members from anon, authenticated;
grant select on table public.game_rooms, public.game_room_members to authenticated;

create or replace function public.is_game_room_member(p_code text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.game_room_members m
    where m.room_code = p_code and m.user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_game_room_member(text) from public, anon;
grant execute on function public.is_game_room_member(text) to authenticated;

drop policy if exists "Room members can read their room" on public.game_rooms;
create policy "Room members can read their room" on public.game_rooms for select to authenticated
  using ((select public.is_game_room_member(code)));
drop policy if exists "Room members can read their member list" on public.game_room_members;
create policy "Room members can read their member list" on public.game_room_members for select to authenticated
  using ((select public.is_game_room_member(room_code)));

create or replace function public.get_game_room(p_code text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if (select auth.uid()) is null or not public.is_game_room_member(p_code) then
    raise exception 'Room not found';
  end if;
  select jsonb_build_object(
    'code', r.code,
    'host_user_id', r.host_user_id,
    'state', r.state,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', m.user_id, 'nickname', m.nickname)
                       order by m.joined_at)
      from public.game_room_members m where m.room_code = r.code
    ), '[]'::jsonb)
  ) into result
  from public.game_rooms r where r.code = p_code;
  return result;
end;
$$;

create or replace function public.create_game_room(p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare new_code text;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if p_nickname is null or char_length(trim(p_nickname)) not between 1 and 16 then
    raise exception 'Nickname must be 1-16 characters';
  end if;
  loop
    new_code := substr(upper(md5(random()::text || clock_timestamp()::text)), 1, 5);
    exit when not exists (select 1 from public.game_rooms r where r.code = new_code);
  end loop;
  insert into public.game_rooms (code, host_user_id) values (new_code, (select auth.uid()));
  insert into public.game_room_members (room_code, user_id, nickname)
    values (new_code, (select auth.uid()), trim(p_nickname));
  return public.get_game_room(new_code);
end;
$$;

create or replace function public.join_game_room(p_code text, p_nickname text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare member_count integer;
declare current_host uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if p_code is null or p_code !~ '^[A-Z0-9]{5}$' then raise exception 'Invalid room code'; end if;
  if p_nickname is null or char_length(trim(p_nickname)) not between 1 and 16 then
    raise exception 'Nickname must be 1-16 characters';
  end if;
  perform 1 from public.game_rooms r where r.code = p_code for update;
  if not found then raise exception 'Room not found'; end if;
  delete from public.game_room_members m
   where m.room_code = p_code and m.last_seen_at < now() - interval '2 minutes';
  select r.host_user_id into current_host from public.game_rooms r where r.code = p_code;
  if not exists (select 1 from public.game_room_members m where m.room_code = p_code and m.user_id = current_host) then
    select m.user_id into current_host from public.game_room_members m where m.room_code = p_code order by m.joined_at limit 1;
    if current_host is not null then update public.game_rooms r set host_user_id = current_host where r.code = p_code; end if;
  end if;
  select count(*) into member_count from public.game_room_members m where m.room_code = p_code;
  if member_count >= 6 and not exists (
    select 1 from public.game_room_members m where m.room_code = p_code and m.user_id = (select auth.uid())
  ) then raise exception 'Room is full'; end if;
  insert into public.game_room_members (room_code, user_id, nickname)
    values (p_code, (select auth.uid()), trim(p_nickname))
    on conflict (room_code, user_id) do update set nickname = excluded.nickname, last_seen_at = now();
  return public.get_game_room(p_code);
end;
$$;

create or replace function public.sync_game_room_round(p_code text, p_round jsonb)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  if p_round is null or jsonb_typeof(p_round) <> 'object'
     or p_round->>'hostUserId' <> (select auth.uid())::text then
    raise exception 'Invalid round';
  end if;
  update public.game_rooms r
     set state = jsonb_set(coalesce(r.state, '{}'::jsonb), '{round}', p_round, true),
         updated_at = now()
   where r.code = p_code and r.host_user_id = (select auth.uid());
  if not found then raise exception 'Only the room host can publish a round'; end if;
end;
$$;

create or replace function public.leave_game_room(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
declare next_host uuid;
begin
  if (select auth.uid()) is null then raise exception 'Sign in required'; end if;
  perform 1 from public.game_rooms r where r.code = p_code for update;
  delete from public.game_room_members m where m.room_code = p_code and m.user_id = (select auth.uid());
  if exists (select 1 from public.game_rooms r where r.code = p_code and r.host_user_id = (select auth.uid())) then
    select m.user_id into next_host from public.game_room_members m where m.room_code = p_code order by m.joined_at limit 1;
    if next_host is null then
      delete from public.game_rooms r where r.code = p_code;
    else
      update public.game_rooms r set host_user_id = next_host, updated_at = now() where r.code = p_code;
    end if;
  end if;
end;
$$;

create or replace function public.heartbeat_game_room(p_code text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.game_room_members m set last_seen_at = now()
   where m.room_code = p_code and m.user_id = (select auth.uid());
  if not found then raise exception 'Room membership expired'; end if;
end;
$$;

revoke all on function public.get_game_room(text) from public, anon;
revoke all on function public.create_game_room(text) from public, anon;
revoke all on function public.join_game_room(text, text) from public, anon;
revoke all on function public.sync_game_room_round(text, jsonb) from public, anon;
revoke all on function public.leave_game_room(text) from public, anon;
revoke all on function public.heartbeat_game_room(text) from public, anon;
grant execute on function public.get_game_room(text) to authenticated;
grant execute on function public.create_game_room(text) to authenticated;
grant execute on function public.join_game_room(text, text) to authenticated;
grant execute on function public.sync_game_room_round(text, jsonb) to authenticated;
grant execute on function public.leave_game_room(text) to authenticated;
grant execute on function public.heartbeat_game_room(text) to authenticated;

-- Deliver only rows the caller is authorized to read through the policies above.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_rooms') then
    alter publication supabase_realtime add table public.game_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_room_members') then
    alter publication supabase_realtime add table public.game_room_members;
  end if;
end $$;

