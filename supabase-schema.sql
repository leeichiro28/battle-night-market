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
alter table events add column if not exists last_match_bracket text;

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
alter table event_participants add column if not exists class text; -- fighter | guardian | gambler | assassin | null(素體)

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
alter table matches add column if not exists activated_at timestamptz;
alter table matches add column if not exists p1_entered_at timestamptz;
alter table matches add column if not exists p2_entered_at timestamptz;

-- 對戰下注(觀眾用,純娛樂不影響勝負)。放在 matches 表之後,因為外鍵要參照 matches。
create table if not exists match_bets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  bet_on int not null, -- 1 或 2,對應player1/player2
  created_at timestamptz default now(),
  unique(match_id, player_id)
);
alter table match_bets enable row level security;
drop policy if exists "anon all bets" on match_bets;
create policy "anon all bets" on match_bets for all using (true) with check (true);

-- 場次一變成「可開打」狀態,自動記錄開打時間、重置雙方入場記錄。
-- 前端用這個時間點來判斷「超過1分鐘沒入場」要不要自動判定棄權。
create or replace function set_match_activated_at()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'active' then
    if TG_OP = 'INSERT' or (TG_OP = 'UPDATE' and old.status is distinct from 'active') then
      new.activated_at := now();
      new.p1_entered_at := null;
      new.p2_entered_at := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_set_match_activated_at on matches;
create trigger trg_set_match_activated_at
before insert or update on matches
for each row execute function set_match_activated_at();

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
  field_val text;
  shield1_n int;
  shield2_n int;
begin
  select * into ev from events where id = p_event_id;

  select id, player_id, class into p1
  from event_participants
  where event_id = p_event_id and status = 'waiting' and bracket = p_bracket
  order by created_at
  limit 1
  for update skip locked;

  if p1 is null then
    return null;
  end if;

  select id, player_id, class into p2
  from event_participants
  where event_id = p_event_id and status = 'waiting' and bracket = p_bracket and id <> p1.id
  order by created_at
  limit 1
  for update skip locked;

  if p2 is null then
    return null;
  end if;

  if ev.game_type = 'dice' then
    if ev.rules->>'field_mod' = 'true' then
      field_val := (array['crit','shield_plus','lifesteal','chaos_tie','fast_timer','shadow'])[floor(random()*6+1)];
    else
      field_val := null;
    end if;
    shield1_n := 2 + (case when p1.class='guardian' then 1 else 0 end) + (case when field_val='shield_plus' then 1 else 0 end) - (case when field_val='shadow' then 1 else 0 end);
    shield2_n := 2 + (case when p2.class='guardian' then 1 else 0 end) + (case when field_val='shield_plus' then 1 else 0 end) - (case when field_val='shadow' then 1 else 0 end);
    init_state := jsonb_build_object(
      'hp1',30,'hp2',30,'round',1,
      'shield1',greatest(shield1_n,0),'shield2',greatest(shield2_n,0),
      'rage1',0,'rage2',0,'rageready1',false,'rageready2',false,
      'freebet1',0,'freebet2',0,
      'combo1',0,'combo2',0,'combobonus1',0,'combobonus2',0,
      'gamble1',0,'gamble2',0,
      'classult1',false,'classult2',false,
      'class1',p1.class,'class2',p2.class,
      'field_mod',field_val,
      'log','[]'::jsonb
    );
  else
    init_state := '{"hp1":30,"hp2":30,"round":1,"game":1,"games1":0,"games2":0,"ult1":0,"ult2":0,"log":[]}'::jsonb;
  end if;

  insert into matches(event_id, player1_id, player2_id, bracket, round, state, status)
  values (p_event_id, p1.player_id, p2.player_id, p_bracket, 1, init_state, 'pending')
  returning id into new_match_id;

  update event_participants set status='pending', match_id=new_match_id
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
  wb_class text;
  lb_class text;
  new_id uuid;
  init_state jsonb;
  field_val text;
  shield1_n int;
  shield2_n int;
begin
  select * into ev from events where id = p_event_id for update;

  if ev.final_match_id is not null then
    return ev.final_match_id;
  end if;

  select player_id, class into wb_champ, wb_class from event_participants
    where event_id = p_event_id and status = 'wb_champion' limit 1;
  select player_id, class into lb_champ, lb_class from event_participants
    where event_id = p_event_id and status = 'lb_champion' limit 1;

  if wb_champ is null or lb_champ is null then
    return null;
  end if;

  if ev.game_type = 'dice' then
    if ev.rules->>'field_mod' = 'true' then
      field_val := (array['crit','shield_plus','lifesteal','chaos_tie','fast_timer','shadow'])[floor(random()*6+1)];
    else
      field_val := null;
    end if;
    shield1_n := 2 + (case when wb_class='guardian' then 1 else 0 end) + (case when field_val='shield_plus' then 1 else 0 end) - (case when field_val='shadow' then 1 else 0 end);
    shield2_n := 2 + (case when lb_class='guardian' then 1 else 0 end) + (case when field_val='shield_plus' then 1 else 0 end) - (case when field_val='shadow' then 1 else 0 end);
    init_state := jsonb_build_object(
      'hp1',30,'hp2',30,'round',1,
      'shield1',greatest(shield1_n,0),'shield2',greatest(shield2_n,0),
      'rage1',0,'rage2',0,'rageready1',false,'rageready2',false,
      'freebet1',0,'freebet2',0,
      'combo1',0,'combo2',0,'combobonus1',0,'combobonus2',0,
      'gamble1',0,'gamble2',0,
      'classult1',false,'classult2',false,
      'class1',wb_class,'class2',lb_class,
      'field_mod',field_val,
      'log','[]'::jsonb
    );
  else
    init_state := '{"hp1":30,"hp2":30,"round":1,"game":1,"games1":0,"games2":0,"ult1":0,"ult2":0,"log":[]}'::jsonb;
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

-- 贊助名單:主辦人可以自己開好幾份獨立的名單(跟活動 events 完全無關,自己取名字管理)
create table if not exists sponsor_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- 名單名稱,例如「擂台夜市 第 12 屆」,自己取
  raised text, -- 這份名單的贊助總額,自己填文字,例如「NT$ 18,600」
  visible boolean not null default true, -- 是否顯示於前台;關閉後前台完全不顯示這份名單,但後台資料與統計仍保留
  created_at timestamptz default now()
);

-- 升級既有資料庫用:幫 sponsor_lists 補上 visible 欄位,舊資料預設為顯示,不影響既有前台畫面。
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'sponsor_lists' and column_name = 'visible'
  ) then
    alter table sponsor_lists add column visible boolean not null default true;
  end if;
end $$;

-- 贊助者,每筆歸屬到某一份 sponsor_lists
create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  items text not null, -- 贊助了什麼,可以多行文字列好幾樣
  sort_order int not null default 0,
  created_at timestamptz default now()
);

-- 升級既有資料庫用:幫 sponsors 補上 sponsor_list_id 欄位,
-- 如果表裡已經有舊資料(改版前不分名單的贊助紀錄),先開一份「既有贊助名單」把舊資料收進去。
do $$
declare
  default_list_id uuid;
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'sponsors' and column_name = 'sponsor_list_id'
  ) then
    alter table sponsors add column sponsor_list_id uuid references sponsor_lists(id) on delete cascade;

    if exists (select 1 from sponsors where sponsor_list_id is null) then
      insert into sponsor_lists (name) values ('既有贊助名單') returning id into default_list_id;
      update sponsors set sponsor_list_id = default_list_id where sponsor_list_id is null;
    end if;

    alter table sponsors alter column sponsor_list_id set not null;
  end if;
end $$;

-- 升級既有資料庫用:sponsors.items 原本是必填的自由文字欄位,
-- 改版後贊助內容改成「獎勵名稱 + 數量」存進 sponsor_rewards,items 不再需要必填。
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'sponsors' and column_name = 'items' and is_nullable = 'NO'
  ) then
    alter table sponsors alter column items drop not null;
  end if;
end $$;

-- 贊助獎勵項目:每筆歸屬到某一位贊助者(sponsors)。
-- 同一次「新增贊助」如果填了好幾種獎勵(例如嗶幣+鑽石+黑玫瑰),會共用同一個 entry_id,
-- 方便後台把同一次贊助的項目分在同一組顯示;同一位贊助者不同次贊助各自是獨立的 entry_id,
-- 紀錄永遠保留,前台顯示時再依「獎勵名稱」加總成累積總額。
create table if not exists sponsor_rewards (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references sponsors(id) on delete cascade,
  entry_id uuid not null default gen_random_uuid(),
  reward_name text not null, -- 獎勵名稱,例如「嗶幣」「鑽石」「黑玫瑰」
  qty numeric not null default 0, -- 數量
  created_at timestamptz default now()
);

-- 舊資料轉移:把改版前 sponsors.items 裡的自由文字,轉成一筆「獎勵名稱=原本的文字、數量=1」的紀錄,
-- 避免升級後舊贊助紀錄憑空消失(只跑一次,已經轉過的贊助者不會重複轉)。
do $$
begin
  if exists (select 1 from information_schema.columns where table_name = 'sponsors' and column_name = 'items') then
    insert into sponsor_rewards (sponsor_id, reward_name, qty, entry_id)
    select s.id, s.items, 1, gen_random_uuid()
    from sponsors s
    where s.items is not null
      and trim(s.items) <> ''
      and not exists (select 1 from sponsor_rewards r where r.sponsor_id = s.id);
  end if;
end $$;

-- 網站設定(目前用來放募資總額文字、主辦人 Discord 聯絡方式)
create table if not exists site_settings (
  key text primary key,
  value text
);

-- 公告:首頁用來顯示「新活動 / 版本更新 / 一般公告」的精選卡片,後台可以新增/編輯/刪除、上傳一張封面圖。
-- 首頁固定抓「最新一則」當精選公告(hero),其餘依建立時間收進「更多公告」收合區(跟贊助名單、活動列表同一套邏輯:最新一則+歷史收合)。
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'general', -- 'event'新活動 / 'update'版本更新 / 'general'一般公告,對應首頁徽章顏色跟圖示
  title text not null,
  subtitle text, -- 圖片上面那行小字,例如「報名開放中 · 8/03 開賽」「v2.0」,選填
  body text, -- 內文說明
  image_url text, -- 封面圖網址,選填(沒有的話首頁用該類型的預設圖示墊底)
  cta_text text, -- 按鈕文字,例如「立即報名」「查看玩法說明」,選填
  cta_link text, -- 按鈕連結,可以是站內錨點(例如 #events-list)或外部網址,選填
  created_at timestamptz default now()
);

-- 公告封面圖存放的 Storage bucket,設成公開讀取(圖片網址不含機密資訊)
insert into storage.buckets (id, name, public)
values ('announcement-images', 'announcement-images', true)
on conflict (id) do nothing;

drop policy if exists "anon read announcement images" on storage.objects;
create policy "anon read announcement images" on storage.objects
  for select using (bucket_id = 'announcement-images');

drop policy if exists "anon write announcement images" on storage.objects;
create policy "anon write announcement images" on storage.objects
  for all using (bucket_id = 'announcement-images') with check (bucket_id = 'announcement-images');

-- 開放權限(小型私人活動,信任參加者,不做帳號驗證)
alter table players enable row level security;
alter table events enable row level security;
alter table event_participants enable row level security;
alter table matches enable row level security;
alter table sponsors enable row level security;
alter table sponsor_lists enable row level security;
alter table sponsor_rewards enable row level security;
alter table site_settings enable row level security;
alter table announcements enable row level security;

drop policy if exists "anon all players" on players;
create policy "anon all players" on players for all using (true) with check (true);

drop policy if exists "anon all events" on events;
create policy "anon all events" on events for all using (true) with check (true);

drop policy if exists "anon all participants" on event_participants;
create policy "anon all participants" on event_participants for all using (true) with check (true);

drop policy if exists "anon all matches" on matches;
create policy "anon all matches" on matches for all using (true) with check (true);

drop policy if exists "anon all sponsors" on sponsors;
create policy "anon all sponsors" on sponsors for all using (true) with check (true);

drop policy if exists "anon all sponsor_lists" on sponsor_lists;
create policy "anon all sponsor_lists" on sponsor_lists for all using (true) with check (true);

drop policy if exists "anon all sponsor_rewards" on sponsor_rewards;
create policy "anon all sponsor_rewards" on sponsor_rewards for all using (true) with check (true);

drop policy if exists "anon all site_settings" on site_settings;
create policy "anon all site_settings" on site_settings for all using (true) with check (true);

drop policy if exists "anon all announcements" on announcements;
create policy "anon all announcements" on announcements for all using (true) with check (true);

-- ============================================
-- 執行完以上內容後,記得手動開啟 Realtime:
-- 左側選單 Database → Replication →
-- 把 events / event_participants / matches / match_bets 四張表的開關打開
-- (舊專案升級上來,前三張應該已經開過,這次新增的 match_bets 記得也要開)
-- 或是直接在 SQL Editor 執行下面這行也可以:
-- alter publication supabase_realtime add table match_bets;
-- ============================================
