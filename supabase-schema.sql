-- ============================================
-- 擂台夜市 v2 資料庫結構
-- 若是全新 Supabase 專案:直接整段執行即可
-- 若是從 v1 升級:整段執行也沒關係,全部用 if not exists / add column if not exists,不會動到既有資料
-- ============================================

create extension if not exists pgcrypto;

-- 玩家
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

-- 活動場次
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  game_type text not null check (game_type in ('dice','rps5')),
  status text not null default 'open', -- open(開放報名) | running(賽程進行中) | closed(已結束)
  losers_bracket boolean not null default false, -- 是否開啟敗部復活賽
  locked boolean not null default false,          -- 是否已鎖定名單並產生賽程
  rules jsonb not null default '{}',              -- 骰子對戰可勾選的機制開關
  final_match_id uuid,                            -- 總冠軍賽的 match id
  created_at timestamptz default now()
);
alter table events add column if not exists losers_bracket boolean not null default false;
alter table events add column if not exists locked boolean not null default false;
alter table events add column if not exists rules jsonb not null default '{}';
alter table events add column if not exists final_match_id uuid;
alter table events add column if not exists registration_deadline timestamptz;
alter table events add column if not exists reward_plan jsonb not null default '{}';
alter table events add column if not exists reward_plan jsonb not null default '{}';

-- 參加者
create table if not exists event_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  bracket text not null default 'winners', -- winners(勝部) | losers(敗部)
  status text not null default 'waiting',  -- waiting(等配對) | pending(已排進賽程等對手產生) | matched(對戰中) | wb_champion | lb_champion | eliminated
  match_id uuid,
  eliminated_at timestamptz,
  final_rank int,
  reward text,
  created_at timestamptz default now(),
  unique(event_id, player_id)
);
alter table event_participants add column if not exists bracket text not null default 'winners';

-- 對戰場次
create table if not exists matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  player1_id uuid references players(id),
  player2_id uuid references players(id),
  bracket text not null default 'winners', -- winners | losers | final
  round int not null default 1,
  slot int,
  next_match_id uuid,
  next_slot int,
  status text not null default 'active', -- pending(等雙方都產生) | active(可開打) | done
  winner_id uuid,
  state jsonb not null default '{}',
  created_at timestamptz default now()
);
alter table matches add column if not exists bracket text not null default 'winners';
alter table matches add column if not exists round int not null default 1;
alter table matches add column if not exists slot int;
alter table matches add column if not exists next_match_id uuid;
alter table matches add column if not exists next_slot int;

-- 敗部動態配對函式:從敗部等待名單抓兩位玩家開新對戰(勝部賽程是預先產生的樹,不用這個)
create or replace function match_players(p_event_id uuid, p_game_type text, p_bracket text default 'losers')
returns uuid
language plpgsql
as $$
declare
  p1 record;
  p2 record;
  new_match_id uuid;
  init_state jsonb;
  ev record;
begin
  select * into ev from events where id = p_event_id;

  select id, player_id into p1
  from event_participants
  where event_id = p_event_id and status = 'waiting' and bracket = p_bracket
  order by created_at
  limit 1
  for update skip locked;

  if p1 is null then
    return null;
  end if;

  select id, player_id into p2
  from event_participants
  where event_id = p_event_id and status = 'waiting' and bracket = p_bracket and id <> p1.id
  order by created_at
  limit 1
  for update skip locked;

  if p2 is null then
    return null;
  end if;

  if ev.game_type = 'dice' then
    init_state := jsonb_build_object('hp1',12,'hp2',12,'round',1,'shield1',false,'shield2',false,
      'rage1',0,'rage2',0,'rageready1',false,'rageready2',false,'freebet1',0,'freebet2',0,'log','[]'::jsonb,
      'field_mod', case when ev.rules->>'field_mod' = 'true' then
        (array['crit','shield_plus'])[floor(random()*2+1)]
        else null end
      );
  else
    init_state := '{"hp1":10,"hp2":10,"round":1,"ult1":false,"ult2":false,"log":[]}'::jsonb;
  end if;

  insert into matches(event_id, player1_id, player2_id, bracket, round, state)
  values (p_event_id, p1.player_id, p2.player_id, p_bracket, 1, init_state)
  returning id into new_match_id;

  update event_participants set status='matched', match_id=new_match_id
    where id in (p1.id, p2.id);

  return new_match_id;
end;
$$;

-- 出招提交函式:原子化寫入,避免雙方同時送出時互相覆蓋
create or replace function submit_move(p_match_id uuid, p_slot int, p_payload jsonb)
returns void
language plpgsql
as $$
begin
  update matches
  set state = state || jsonb_build_object('m' || p_slot, p_payload)
  where id = p_match_id;
end;
$$;

-- 總冠軍賽產生函式:勝部冠軍 + 敗部冠軍都出爐後,原子化建立唯一一場總決賽
create or replace function create_grand_final(p_event_id uuid)
returns uuid
language plpgsql
as $$
declare
  ev record;
  wb_champ uuid;
  lb_champ uuid;
  new_id uuid;
  init_state jsonb;
begin
  select * into ev from events where id = p_event_id for update;

  if ev.final_match_id is not null then
    return ev.final_match_id;
  end if;

  select player_id into wb_champ from event_participants
    where event_id = p_event_id and status = 'wb_champion' limit 1;
  select player_id into lb_champ from event_participants
    where event_id = p_event_id and status = 'lb_champion' limit 1;

  if wb_champ is null or lb_champ is null then
    return null;
  end if;

  if ev.game_type = 'dice' then
    init_state := '{"hp1":12,"hp2":12,"round":1,"shield1":false,"shield2":false,"rage1":0,"rage2":0,"rageready1":false,"rageready2":false,"freebet1":0,"freebet2":0,"log":[]}'::jsonb;
  else
    init_state := '{"hp1":10,"hp2":10,"round":1,"ult1":false,"ult2":false,"log":[]}'::jsonb;
  end if;

  insert into matches(event_id, player1_id, player2_id, bracket, round, state, status)
  values (p_event_id, wb_champ, lb_champ, 'final', 1, init_state, 'active')
  returning id into new_id;

  update events set final_match_id = new_id where id = p_event_id;

  update event_participants set status='matched', match_id=new_id
    where event_id = p_event_id and player_id in (wb_champ, lb_champ);

  return new_id;
end;
$$;

-- 開放權限(小型私人活動,信任參加者,不做帳號驗證)
alter table players enable row level security;
alter table events enable row level security;
alter table event_participants enable row level security;
alter table matches enable row level security;

drop policy if exists "anon all players" on players;
create policy "anon all players" on players for all using (true) with check (true);

drop policy if exists "anon all events" on events;
create policy "anon all events" on events for all using (true) with check (true);

drop policy if exists "anon all participants" on event_participants;
create policy "anon all participants" on event_participants for all using (true) with check (true);

drop policy if exists "anon all matches" on matches;
create policy "anon all matches" on matches for all using (true) with check (true);

-- ============================================
-- 執行完以上內容後,記得手動開啟 Realtime:
-- 左側選單 Database → Replication →
-- 把 events / event_participants / matches 三張表的開關打開
-- (v1 升級上來的專案,這步應該已經開過,不用重做)
-- ============================================
