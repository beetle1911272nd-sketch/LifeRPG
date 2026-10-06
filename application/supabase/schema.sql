-- LIFE RPG shared social data.
-- Run this in Supabase SQL Editor. The client only uses the publishable key and
-- anonymous auth; no service-role key is required.

create extension if not exists pgcrypto;

create table if not exists public.game_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  display_name text not null default 'PLAYER',
  real_name text,
  age smallint,
  public_profile boolean not null default false,
  show_age boolean not null default false,
  show_real_name boolean not null default false,
  show_stats boolean not null default false,
  show_achievements boolean not null default false,
  level integer not null default 1 check (level between 1 and 10000),
  exp integer not null default 0 check (exp >= 0),
  job_level integer not null default 1 check (job_level between 1 and 10000),
  job_name text not null default '未設定',
  job_icon text not null default 'A',
  guild_level integer not null default 0 check (guild_level >= 0),
  stats jsonb not null default '{}'::jsonb,
  achievements integer not null default 0 check (achievements >= 0),
  total_actions integer not null default 0 check (total_actions >= 0),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username) between 2 and 32)
);

create table if not exists public.open_world_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  level integer not null default 1 check (level between 1 and 10000),
  exp integer not null default 0 check (exp between 0 and 1000000),
  owned_equipment jsonb not null default '[]'::jsonb,
  equipment jsonb not null default '{"weapon":null,"armor":null,"accessory":null}'::jsonb,
  equipment_updated_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.open_world_progress
  add column if not exists equipment_updated_at timestamptz not null default now();

create table if not exists public.open_world_sync_pairings (
  code_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);

create table if not exists public.open_world_sync_devices (
  token_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now()
);

create unique index if not exists profiles_username_lower_idx
  on public.profiles (lower(username));

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references auth.users(id) on delete cascade,
  addressee_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint friend_requests_not_self check (requester_id <> addressee_id)
);

create unique index if not exists pending_friend_request_idx
  on public.friend_requests (least(requester_id, addressee_id), greatest(requester_id, addressee_id))
  where status = 'pending';

create table if not exists public.friendships (
  user_low uuid not null references auth.users(id) on delete cascade,
  user_high uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_low, user_high),
  constraint friendships_ordered check (user_low < user_high)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint messages_not_self check (sender_id <> recipient_id),
  constraint messages_body_length check (char_length(btrim(body)) between 1 and 2000)
);

create index if not exists messages_conversation_date_idx
  on public.messages (sender_id, recipient_id, created_at asc);
create index if not exists messages_recipient_unread_idx
  on public.messages (recipient_id, created_at desc)
  where read_at is null;

create table if not exists public.guilds (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  tag text not null,
  description text not null default '',
  icon text not null default '✦',
  level integer not null default 1 check (level >= 1),
  exp integer not null default 0 check (exp >= 0),
  total_level integer not null default 0 check (total_level >= 0),
  quest_progress integer not null default 0 check (quest_progress >= 0),
  created_at timestamptz not null default now(),
  constraint guild_name_length check (char_length(name) between 2 and 40),
  constraint guild_tag_length check (char_length(tag) between 2 and 8)
);

create unique index if not exists guilds_tag_lower_idx on public.guilds (lower(tag));

create table if not exists public.guild_members (
  guild_id uuid not null references public.guilds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'member')),
  contribution integer not null default 0 check (contribution >= 0),
  joined_at timestamptz not null default now(),
  primary key (guild_id, user_id)
);

create unique index if not exists one_guild_per_user_idx
  on public.guild_members (user_id);

create table if not exists public.action_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  guild_id uuid references public.guilds(id) on delete set null,
  action_id text not null,
  exp integer not null check (exp between 0 and 1000),
  stat_effects jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Completion metrics are additive so existing action events remain valid.
alter table public.action_events add column if not exists target numeric;
alter table public.action_events add column if not exists unit text;
alter table public.action_events add column if not exists estimated_time numeric;
alter table public.action_events add column if not exists actual_value numeric;
alter table public.action_events add column if not exists actual_time numeric;
alter table public.action_events add column if not exists result text not null default 'completed';

create index if not exists action_events_user_date_idx
  on public.action_events (user_id, created_at desc);
create index if not exists action_events_guild_date_idx
  on public.action_events (guild_id, created_at desc);

-- Public ranking contains only fields deliberately published by the profile.
create or replace view public.life_rpg_public_ranking
with (security_invoker = true) as
select
  id, username, display_name, level, exp, job_level, job_name, job_icon,
  guild_level, achievements, total_actions, updated_at
from public.profiles
where public_profile = true;

-- Period rankings aggregate private action events inside a view that only
-- exposes users who opted into public profiles.
create or replace view public.life_rpg_weekly_ranking
with (security_invoker = false) as
select
  p.id, p.username, p.display_name, p.level, p.exp, p.job_level, p.job_name,
  p.job_icon, p.guild_level, p.achievements, p.total_actions,
  coalesce(sum(a.exp), 0)::integer as period_exp,
  count(a.id)::integer as period_actions
from public.profiles p
left join public.action_events a
  on a.user_id = p.id
 and a.created_at >= now() - interval '7 days'
where p.public_profile = true
group by p.id;

create or replace view public.life_rpg_monthly_ranking
with (security_invoker = false) as
select
  p.id, p.username, p.display_name, p.level, p.exp, p.job_level, p.job_name,
  p.job_icon, p.guild_level, p.achievements, p.total_actions,
  coalesce(sum(a.exp), 0)::integer as period_exp,
  count(a.id)::integer as period_actions
from public.profiles p
left join public.action_events a
  on a.user_id = p.id
 and a.created_at >= now() - interval '30 days'
where p.public_profile = true
group by p.id;

revoke all on public.life_rpg_weekly_ranking from anon, authenticated;
revoke all on public.life_rpg_monthly_ranking from anon, authenticated;
grant select on public.life_rpg_weekly_ranking to authenticated;
grant select on public.life_rpg_monthly_ranking to authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.delete_my_account() from public;
grant execute on function public.delete_my_account() to authenticated;

-- Existing versions stored private state in this table. Lock it down rather
-- than leaving the old RLS policy capable of exposing the JSON state.
do $$
begin
  if to_regclass('public.life_rpg_profiles') is not null then
    alter table public.life_rpg_profiles enable row level security;
    revoke all on table public.life_rpg_profiles from anon, authenticated;
    execute 'drop policy if exists "Users can read public profiles" on public.life_rpg_profiles';
    execute 'drop policy if exists "Users can insert their own profile" on public.life_rpg_profiles';
    execute 'drop policy if exists "Users can update their own profile" on public.life_rpg_profiles';
  end if;
end $$;

alter table public.profiles enable row level security;
alter table public.game_states enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.messages enable row level security;
alter table public.guilds enable row level security;
alter table public.guild_members enable row level security;
alter table public.action_events enable row level security;

create or replace function public.can_view_profile(profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select profile_id = auth.uid()
    or exists (
      select 1 from public.friendships f
      where (f.user_low = auth.uid() and f.user_high = profile_id)
         or (f.user_high = auth.uid() and f.user_low = profile_id)
    );
$$;

create or replace view public.life_rpg_public_profiles
with (security_invoker = true) as
select
  id,
  username,
  display_name,
  case when show_real_name then real_name else null end as real_name,
  case when show_age then age else null end as age,
  public_profile,
  show_stats,
  show_achievements,
  level,
  exp,
  job_level,
  job_name,
  job_icon,
  guild_level,
  case when show_stats then stats else '{}'::jsonb end as stats,
  case when show_achievements then achievements else 0 end as achievements,
  total_actions,
  updated_at
from public.profiles
where public_profile or public.can_view_profile(id);

revoke all on public.life_rpg_public_profiles from anon, authenticated;
grant select on public.life_rpg_public_profiles to authenticated;

revoke all on function public.can_view_profile(uuid) from public;
grant execute on function public.can_view_profile(uuid) to authenticated;

create or replace function public.are_friends(user_a uuid, user_b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select user_a is not null
    and user_b is not null
    and user_a <> user_b
    and exists (
      select 1 from public.friendships f
      where f.user_low = least(user_a, user_b)
        and f.user_high = greatest(user_a, user_b)
    );
$$;

revoke all on function public.are_friends(uuid, uuid) from public;
grant execute on function public.are_friends(uuid, uuid) to authenticated;

drop policy if exists "profiles_select_public_or_related" on public.profiles;
drop policy if exists "profiles_insert_self" on public.profiles;
drop policy if exists "profiles_update_self" on public.profiles;
drop policy if exists "profiles_delete_self" on public.profiles;
create policy "profiles_select_public_or_related"
  on public.profiles for select to authenticated
  using (public_profile or public.can_view_profile(id));
create policy "profiles_insert_self"
  on public.profiles for insert to authenticated
  with check (auth.uid() = id);
create policy "profiles_update_self"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);
create policy "profiles_delete_self"
  on public.profiles for delete to authenticated
  using (auth.uid() = id);

drop policy if exists "game_states_select_self" on public.game_states;
drop policy if exists "game_states_insert_self" on public.game_states;
drop policy if exists "game_states_update_self" on public.game_states;
drop policy if exists "game_states_delete_self" on public.game_states;
create policy "game_states_select_self"
  on public.game_states for select to authenticated
  using (auth.uid() = user_id);
create policy "game_states_insert_self"
  on public.game_states for insert to authenticated
  with check (auth.uid() = user_id);
create policy "game_states_update_self"
  on public.game_states for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "game_states_delete_self"
  on public.game_states for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "friend_requests_select_participant" on public.friend_requests;
drop policy if exists "friend_requests_insert_requester" on public.friend_requests;
drop policy if exists "friend_requests_update_addressee" on public.friend_requests;
drop policy if exists "friend_requests_delete_participant" on public.friend_requests;
create policy "friend_requests_select_participant"
  on public.friend_requests for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));
create policy "friend_requests_insert_requester"
  on public.friend_requests for insert to authenticated
  with check (auth.uid() = requester_id and requester_id <> addressee_id);
create policy "friend_requests_update_addressee"
  on public.friend_requests for update to authenticated
  using (auth.uid() = addressee_id and status = 'pending')
  with check (auth.uid() = addressee_id and status in ('accepted', 'declined'));
create policy "friend_requests_delete_participant"
  on public.friend_requests for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

drop policy if exists "friendships_select_participant" on public.friendships;
drop policy if exists "friendships_delete_participant" on public.friendships;
create policy "friendships_select_participant"
  on public.friendships for select to authenticated
  using (auth.uid() in (user_low, user_high));
create policy "friendships_delete_participant"
  on public.friendships for delete to authenticated
  using (auth.uid() in (user_low, user_high));

drop policy if exists "messages_select_friends" on public.messages;
drop policy if exists "messages_insert_sender_friend" on public.messages;
drop policy if exists "messages_update_recipient_read" on public.messages;
create policy "messages_select_friends"
  on public.messages for select to authenticated
  using (
    auth.uid() in (sender_id, recipient_id)
    and public.are_friends(sender_id, recipient_id)
  );
create policy "messages_insert_sender_friend"
  on public.messages for insert to authenticated
  with check (
    auth.uid() = sender_id
    and public.are_friends(sender_id, recipient_id)
  );
create policy "messages_update_recipient_read"
  on public.messages for update to authenticated
  using (
    auth.uid() = recipient_id
    and public.are_friends(sender_id, recipient_id)
  )
  with check (
    auth.uid() = recipient_id
    and public.are_friends(sender_id, recipient_id)
  );

create or replace function public.validate_message_update()
returns trigger
language plpgsql
as $$
begin
  if new.sender_id <> old.sender_id
     or new.recipient_id <> old.recipient_id
     or new.body <> old.body
     or new.created_at <> old.created_at then
    raise exception 'only read_at may be updated';
  end if;
  return new;
end;
$$;

drop trigger if exists message_update_guard on public.messages;
create trigger message_update_guard
  before update on public.messages
  for each row execute function public.validate_message_update();

alter table public.open_world_progress enable row level security;
alter table public.open_world_sync_pairings enable row level security;
alter table public.open_world_sync_devices enable row level security;

revoke all on public.open_world_progress from anon, authenticated;
revoke all on public.open_world_sync_pairings from anon, authenticated;
revoke all on public.open_world_sync_devices from anon, authenticated;
grant select on public.open_world_progress to authenticated;

drop policy if exists "open_world_progress_select_self" on public.open_world_progress;
create policy "open_world_progress_select_self"
  on public.open_world_progress for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.save_open_world_progress_for_user(
  p_user_id uuid,
  p_level integer,
  p_exp integer,
  p_owned_equipment jsonb,
  p_equipment jsonb,
  p_update_equipment boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  normalized_owned jsonb;
  saved public.open_world_progress;
begin
  if p_user_id is null or p_level is null or p_level not between 1 and 10000
     or p_exp is null or p_exp not between 0 and 1000000
     or p_update_equipment is null then
    raise exception 'invalid progression';
  end if;
  if jsonb_typeof(p_owned_equipment) is distinct from 'array' then
    raise exception 'invalid equipment data';
  end if;
  if jsonb_array_length(p_owned_equipment) > 300 then
    raise exception 'invalid equipment data';
  end if;
  if p_update_equipment and jsonb_typeof(p_equipment) is distinct from 'object' then
    raise exception 'invalid equipment data';
  end if;
  if exists (
    select 1 from jsonb_array_elements_text(p_owned_equipment) as item(id)
    where item.id !~ '^[a-z0-9_]{1,64}$'
  ) then
    raise exception 'invalid equipment data';
  end if;
  if p_update_equipment and (exists (
    select 1 from jsonb_object_keys(p_equipment) as slot(name)
    where slot.name not in ('weapon', 'armor', 'accessory')
  ) or exists (
    select 1 from jsonb_each(p_equipment) as slot(name, item_id)
    where slot.item_id <> 'null'::jsonb
      and (jsonb_typeof(slot.item_id) <> 'string'
        or slot.item_id #>> '{}' !~ '^[a-z0-9_]{1,64}$')
  )) then
    raise exception 'invalid equipment data';
  end if;

  select coalesce(jsonb_agg(to_jsonb(item_id) order by item_id), '[]'::jsonb)
    into normalized_owned
    from (select distinct jsonb_array_elements_text(p_owned_equipment) as item_id) items;

  insert into public.open_world_progress (
    user_id, level, exp, owned_equipment, equipment, equipment_updated_at, updated_at
  ) values (
    p_user_id, p_level, p_exp, normalized_owned,
    case when p_update_equipment then p_equipment else '{"weapon":null,"armor":null,"accessory":null}'::jsonb end,
    now(), now()
  )
  on conflict (user_id) do update set
    level = greatest(public.open_world_progress.level, excluded.level),
    exp = case
      when excluded.level > public.open_world_progress.level then excluded.exp
      when excluded.level = public.open_world_progress.level
        then greatest(public.open_world_progress.exp, excluded.exp)
      else public.open_world_progress.exp
    end,
    owned_equipment = (
      select coalesce(jsonb_agg(to_jsonb(item_id) order by item_id), '[]'::jsonb)
      from (
        select distinct jsonb_array_elements_text(
          public.open_world_progress.owned_equipment || excluded.owned_equipment
        ) as item_id
      ) items
    ),
    equipment = case
      when p_update_equipment then excluded.equipment
      else public.open_world_progress.equipment
    end,
    equipment_updated_at = case
      when p_update_equipment then now()
      else public.open_world_progress.equipment_updated_at
    end,
    updated_at = now()
  returning * into saved;

  return jsonb_build_object(
    'level', saved.level,
    'exp', saved.exp,
    'owned_equipment', saved.owned_equipment,
    'equipment', saved.equipment,
    'equipment_updated_at', saved.equipment_updated_at,
    'updated_at', saved.updated_at
  );
end;
$$;

revoke all on function public.save_open_world_progress_for_user(uuid, integer, integer, jsonb, jsonb, boolean) from public, anon, authenticated;

create or replace function public.create_open_world_pairing()
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  pairing_code text;
  expires timestamptz := now() + interval '10 minutes';
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  if exists (
    select 1 from public.open_world_sync_pairings
    where user_id = auth.uid() and created_at > now() - interval '5 seconds'
      and used_at is null and expires_at > now()
  ) then
    raise exception 'please wait before requesting another pairing code';
  end if;
  delete from public.open_world_sync_pairings
    where expires_at < now() or used_at is not null;
  loop
    pairing_code := substring(replace(gen_random_uuid()::text, '-', '') from 1 for 16);
    insert into public.open_world_sync_pairings (code_hash, user_id, expires_at)
    values (encode(digest(pairing_code, 'sha256'), 'hex'), auth.uid(), expires)
    on conflict do nothing;
    exit when found;
  end loop;
  return jsonb_build_object('code', pairing_code, 'expires_at', expires);
end;
$$;

create or replace function public.claim_open_world_pairing(p_code text)
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  pairing public.open_world_sync_pairings;
  device_token text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if p_code !~ '^[0-9a-fA-F]{16}$' then
    raise exception 'invalid or expired pairing code';
  end if;
  select * into pairing
    from public.open_world_sync_pairings
    where code_hash = encode(digest(lower(p_code), 'sha256'), 'hex')
    for update;
  if not found or pairing.used_at is not null or pairing.expires_at <= now() then
    raise exception 'invalid or expired pairing code';
  end if;
  update public.open_world_sync_pairings set used_at = now()
    where code_hash = pairing.code_hash;
  insert into public.open_world_sync_devices (token_hash, user_id)
    values (encode(digest(device_token, 'sha256'), 'hex'), pairing.user_id);
  return device_token;
end;
$$;

create or replace function public.load_open_world_progress(p_device_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  device public.open_world_sync_devices;
  progress public.open_world_progress;
begin
  if p_device_token is null or p_device_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid sync device';
  end if;
  select * into device from public.open_world_sync_devices
    where token_hash = encode(digest(p_device_token, 'sha256'), 'hex')
    for update;
  if not found then
    raise exception 'invalid sync device';
  end if;
  update public.open_world_sync_devices set last_used_at = now()
    where token_hash = device.token_hash;
  select * into progress from public.open_world_progress where user_id = device.user_id;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'level', progress.level,
    'exp', progress.exp,
    'owned_equipment', progress.owned_equipment,
    'equipment', progress.equipment,
    'equipment_updated_at', progress.equipment_updated_at,
    'updated_at', progress.updated_at
  );
end;
$$;

create or replace function public.save_open_world_device_progress(
  p_device_token text,
  p_level integer,
  p_exp integer,
  p_owned_equipment jsonb,
  p_equipment jsonb,
  p_update_equipment boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  device public.open_world_sync_devices;
begin
  if p_device_token is null or p_device_token !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid sync device';
  end if;
  select * into device from public.open_world_sync_devices
    where token_hash = encode(digest(p_device_token, 'sha256'), 'hex')
    for update;
  if not found then
    raise exception 'invalid sync device';
  end if;
  update public.open_world_sync_devices set last_used_at = now()
    where token_hash = device.token_hash;
  return public.save_open_world_progress_for_user(
    device.user_id, p_level, p_exp, p_owned_equipment, p_equipment, p_update_equipment
  );
end;
$$;

create or replace function public.save_my_open_world_progress(
  p_level integer,
  p_exp integer,
  p_owned_equipment jsonb,
  p_equipment jsonb,
  p_update_equipment boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;
  return public.save_open_world_progress_for_user(
    auth.uid(), p_level, p_exp, p_owned_equipment, p_equipment, p_update_equipment
  );
end;
$$;

create or replace function public.revoke_open_world_device(p_device_token text)
returns boolean
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if p_device_token is null or p_device_token !~ '^[0-9a-f]{64}$' then
    return false;
  end if;
  delete from public.open_world_sync_devices
    where token_hash = encode(digest(p_device_token, 'sha256'), 'hex');
  return found;
end;
$$;

revoke all on function public.create_open_world_pairing() from public;
revoke all on function public.claim_open_world_pairing(text) from public, authenticated;
revoke all on function public.load_open_world_progress(text) from public, authenticated;
revoke all on function public.save_open_world_device_progress(text, integer, integer, jsonb, jsonb, boolean) from public, authenticated;
revoke all on function public.save_my_open_world_progress(integer, integer, jsonb, jsonb, boolean) from public, anon;
revoke all on function public.revoke_open_world_device(text) from public, authenticated;
grant execute on function public.create_open_world_pairing() to authenticated;
grant execute on function public.claim_open_world_pairing(text) to anon;
grant execute on function public.load_open_world_progress(text) to anon;
grant execute on function public.save_open_world_device_progress(text, integer, integer, jsonb, jsonb, boolean) to anon;
grant execute on function public.save_my_open_world_progress(integer, integer, jsonb, jsonb, boolean) to authenticated;
grant execute on function public.revoke_open_world_device(text) to anon;

drop policy if exists "guilds_select_authenticated" on public.guilds;
drop policy if exists "guilds_insert_owner" on public.guilds;
drop policy if exists "guilds_update_owner" on public.guilds;
drop policy if exists "guilds_delete_owner" on public.guilds;
create policy "guilds_select_authenticated"
  on public.guilds for select to authenticated
  using (true);
create policy "guilds_insert_owner"
  on public.guilds for insert to authenticated
  with check (auth.uid() = owner_id);
create policy "guilds_update_owner"
  on public.guilds for update to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);
create policy "guilds_delete_owner"
  on public.guilds for delete to authenticated
  using (auth.uid() = owner_id);

drop policy if exists "guild_members_select_authenticated" on public.guild_members;
drop policy if exists "guild_members_insert_self" on public.guild_members;
drop policy if exists "guild_members_delete_self_or_owner" on public.guild_members;
create policy "guild_members_select_authenticated"
  on public.guild_members for select to authenticated
  using (exists (select 1 from public.guilds g where g.id = guild_id));
create policy "guild_members_insert_self"
  on public.guild_members for insert to authenticated
  with check (auth.uid() = user_id and exists (select 1 from public.guilds g where g.id = guild_id));
create policy "guild_members_delete_self_or_owner"
  on public.guild_members for delete to authenticated
  using (auth.uid() = user_id or exists (select 1 from public.guilds g where g.id = guild_id and g.owner_id = auth.uid()));

drop policy if exists "action_events_insert_self" on public.action_events;
drop policy if exists "action_events_select_self" on public.action_events;
create policy "action_events_insert_self"
  on public.action_events for insert to authenticated
  with check (
    auth.uid() = user_id
    and (guild_id is null or exists (
      select 1 from public.guild_members m
      where m.guild_id = action_events.guild_id and m.user_id = auth.uid()
    ))
  );
create policy "action_events_select_self"
  on public.action_events for select to authenticated
  using (auth.uid() = user_id);

create or replace function public.apply_action_event_contribution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_exp integer;
  next_level integer;
begin
  if new.guild_id is not null then
    update public.guild_members
      set contribution = contribution + 1
      where guild_id = new.guild_id and user_id = new.user_id;

    select level, exp + new.exp
      into next_level, next_exp
      from public.guilds
      where id = new.guild_id
      for update;

    while next_exp >= next_level * 200 loop
      next_exp := next_exp - next_level * 200;
      next_level := next_level + 1;
    end loop;

    update public.guilds
      set exp = next_exp,
          level = next_level,
          quest_progress = quest_progress + 1
      where id = new.guild_id;
  end if;
  return new;
end;
$$;

drop trigger if exists action_event_contribution on public.action_events;
create trigger action_event_contribution
  after insert on public.action_events
  for each row execute function public.apply_action_event_contribution();

create or replace function public.accept_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'accepted' and old.status = 'pending' then
    insert into public.friendships (user_low, user_high)
    values (least(new.requester_id, new.addressee_id), greatest(new.requester_id, new.addressee_id))
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists friend_request_accepted on public.friend_requests;
create trigger friend_request_accepted
  after update of status on public.friend_requests
  for each row execute function public.accept_friend_request();

-- Keep direct updates from changing the participants or reopening a request.
create or replace function public.validate_friend_request_update()
returns trigger
language plpgsql
as $$
begin
  if new.requester_id <> old.requester_id
     or new.addressee_id <> old.addressee_id
     or old.status <> 'pending'
     or new.status not in ('accepted', 'declined') then
    raise exception 'invalid friend request update';
  end if;
  return new;
end;
$$;

drop trigger if exists friend_request_update_guard on public.friend_requests;
create trigger friend_request_update_guard
  before update on public.friend_requests
  for each row execute function public.validate_friend_request_update();
