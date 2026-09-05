-- ============================================
-- 擂台夜市 v2 資料庫結構
-- 若是全新 Supabase 專案:直接整段執行即可
-- 若是從 v1 升級:整段執行也沒關係，全部用 if not exists / add column if not exists，不會動到既有資料
-- ============================================

create extension if not exists pgcrypto;

-- 玩家
create table if not exists players (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);
alter table players add column if not exists is_bot boolean not null default false; -- 主辦人測試用假玩家，跟真人區分開來

-- 跨場永久系統(Phase 0):稱號、歷史累計數據，獨立於任何一場 events，不會被任何一場活動的刪除/重辦影響，
-- 也不會反過來影響任何一場活動的起始數值——資料流是單向的(活動結果 → 寫進這裡)，
-- 純粹是顯示用的紀錄，跟排名獎勵、下一場的起始屬性完全無關，保證每場活動對新人老手都公平起跑。
create table if not exists player_profiles (
  player_id uuid primary key references players(id) on delete cascade,
  titles jsonb not null default '[]'::jsonb,          -- 已解鎖的稱號 key 陣列，例如 ["first_championship","high_roller"]
  lifetime_stats jsonb not null default '{}'::jsonb,   -- 跨場累計數字，例如 {"total_championships":2}
  display_title text,                                  -- 玩家自己選要掛在名字旁邊的稱號 key(解鎖多個也只能秀一個)
  updated_at timestamptz default now()
);
alter table player_profiles enable row level security;
drop policy if exists "anon all player_profiles" on player_profiles;
create policy "anon all player_profiles" on player_profiles for all using (true) with check (true);

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

-- 對戰下注(觀眾用，純娛樂不影響勝負)。放在 matches 表之後，因為外鍵要參照 matches。
create table if not exists match_bets (
  id uuid primary key default gen_random_uuid(),
  match_id uuid references matches(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  bet_on int not null, -- 1 或 2，對應player1/player2
  created_at timestamptz default now(),
  unique(match_id, player_id)
);
alter table match_bets enable row level security;
drop policy if exists "anon all bets" on match_bets;
create policy "anon all bets" on match_bets for all using (true) with check (true);

-- 場次一變成「可開打」狀態，自動記錄開打時間、重置雙方入場記錄。
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

-- 敗部動態配對函式:從敗部等待名單抓兩位玩家開新對戰(勝部賽程是預先產生的樹，不用這個)
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

-- 一場一場來:整個活動同一時間只讓一場對戰進行中。
-- 以前這段邏輯整個放在前端(db.js 的 activateNextMatch):先 SELECT 有沒有 active 場次，沒有的話才 UPDATE 下一場，
-- 這兩步中間沒有原子性保證，兩個玩家幾乎同時打完各自的對戰時，兩邊都會查到「沒有 active」然後各自啟動一場，
-- 造成同時開兩場的 bug。改成這個 RPC，靠 pg_advisory_xact_lock 讓同一場活動同時只有一個呼叫能真的往下跑，
-- 後面的呼叫會卡住等前面那個呼叫的交易 commit，再重新檢查一次「有沒有 active 場次」，徹底避免競態。
create or replace function activate_next_match(p_event_id uuid)
returns uuid
language plpgsql
as $$
declare
  ev record;
  next_match record;
  final_state jsonb;
  class1 text;
  class2 text;
  field_val text;
  shield1_n int;
  shield2_n int;
  prefer_bracket text;
  new_lb_match_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_event_id::text));

  if exists (select 1 from matches where event_id = p_event_id and status = 'active') then
    return null; -- 已經有一場在打，先不排下一場
  end if;

  select * into ev from events where id = p_event_id;

  prefer_bracket := case ev.last_match_bracket
    when 'winners' then 'losers'
    when 'losers' then 'winners'
    else null
  end;

  select * into next_match
  from matches
  where event_id = p_event_id and status = 'pending'
    and player1_id is not null and player2_id is not null
  order by
    case when prefer_bracket is not null and bracket = prefer_bracket then 0 else 1 end,
    case bracket when 'winners' then 0 when 'losers' then 1 when 'final' then 2 else 9 end,
    coalesce(round, 0),
    coalesce(slot, 999),
    created_at
  limit 1;

  if next_match.id is not null then
    -- 對戰真正要開打前才重新計算防禦骰次數/戰場特性，跟原本前端 finalizeDiceState 的時機、算法一致
    if ev.game_type = 'dice' then
      select class into class1 from event_participants where event_id = p_event_id and player_id = next_match.player1_id;
      select class into class2 from event_participants where event_id = p_event_id and player_id = next_match.player2_id;
      if ev.rules->>'field_mod' = 'true' then
        field_val := (array['crit','shield_plus','lifesteal','chaos_tie','fast_timer','shadow'])[floor(random()*6+1)];
      else
        field_val := null;
      end if;
      shield1_n := greatest(0, 2 + (case when class1='guardian' then 1 else 0 end) + (case when field_val='shield_plus' then 1 else 0 end) - (case when field_val='shadow' then 1 else 0 end));
      shield2_n := greatest(0, 2 + (case when class2='guardian' then 1 else 0 end) + (case when field_val='shield_plus' then 1 else 0 end) - (case when field_val='shadow' then 1 else 0 end));
      final_state := next_match.state || jsonb_build_object(
        'class1', class1, 'class2', class2,
        'shield1', shield1_n, 'shield2', shield2_n,
        'field_mod', field_val
      );
    else
      final_state := next_match.state;
    end if;

    update matches set status = 'active', state = final_state where id = next_match.id;
    update event_participants set status = 'matched', match_id = next_match.id
      where event_id = p_event_id and player_id in (next_match.player1_id, next_match.player2_id);

    return next_match.id;
  end if;

  -- 沒有排隊中的對戰，看看敗部候位區有沒有兩人可以配對開新的一場
  if ev.losers_bracket and ev.status <> 'closed' then
    new_lb_match_id := match_players(p_event_id, ev.game_type, 'losers');
    if new_lb_match_id is not null then
      update matches set status = 'active' where id = new_lb_match_id and status = 'pending';
      update event_participants set status = 'matched' where match_id = new_lb_match_id;
      return new_lb_match_id;
    end if;
  end if;

  return null;
end;
$$;

-- 出招提交函式:原子化寫入，避免雙方同時送出時互相覆蓋
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

-- 夜市拍賣:財神幣/分數/道具券的統一異動函式(原子化，取代前端「先讀出來算一算再整包寫回去」的舊寫法)。
--
-- 舊寫法(auction_participants.update({coins: part.coins - price, ...}))在多個異動同時發生時(例如結標
-- 扣錢的同時又有人打工賺錢、或合夥分潤跟參與退補同時觸發)，會互相蓋掉對方剛寫入的值，等於憑空少一筆錢/
-- 加成，這是玩家回報「錢對不上帳」的根因。改成這個函式後，coins/bonus_points 一律用「相對增減」而不是
-- 「絕對值覆蓋」，而且整個異動包在單一 UPDATE 陳述式裡，靠 Postgres 對同一列的更新天生序列化來保證不會
-- 互相蓋掉——不管幾件事同時打進來，最後結果都是「所有增減值都有被正確加總」，不會有任何一筆遺失。
--
-- 參數:
--   p_coins_delta        財神幣要加多少(負數就是扣)，預設 0
--   p_bonus_points_delta 額外分數(猜價小遊戲/合夥分潤用)要加多少，預設 0
--   p_win_streak         連標加成的連續紀錄，直接設成這個絕對值，null 表示不動
--   p_effect_key         要異動數量的道具券 key(例如 'intel'、'refund')，null 表示不動
--   p_effect_delta       上面那個道具券數量要加多少(通常是 -1 消耗、+1 得到)
--   p_effect_flag_key    要設定的布林旗標 key(例如 'intelActive'、'boxDoubleActive')，null 表示不動
--   p_effect_flag_value  上面那個旗標要設成什麼
--   p_appraisal_lot_id   商品鑑定符用:要寫進 effects.appraisals 這個巢狀物件的商品 id，null 表示不動
--   p_appraisal_tier     上面那個商品鑑定出來的等級文字
create or replace function adjust_auction_participant(
  p_participant_id uuid,
  p_coins_delta int default 0,
  p_bonus_points_delta numeric default 0,
  p_win_streak int default null,
  p_effect_key text default null,
  p_effect_delta int default 0,
  p_effect_flag_key text default null,
  p_effect_flag_value boolean default null,
  p_appraisal_lot_id uuid default null,
  p_appraisal_tier text default null
)
returns auction_participants
language plpgsql
as $$
declare
  result auction_participants;
  cur_effects jsonb;
begin
  -- for update 鎖住這一列，直到這個函式(單一交易)結束才釋放，確保下面讀到的 effects 是
  -- 「這個異動輪到自己處理的那一刻」最新的值，不會跟其他同時發生的異動互相蓋掉。
  select effects into cur_effects from auction_participants where id = p_participant_id for update;
  if cur_effects is null then cur_effects := '{}'::jsonb; end if;

  if p_effect_key is not null then
    cur_effects := jsonb_set(cur_effects, array[p_effect_key], to_jsonb(coalesce((cur_effects->>p_effect_key)::int, 0) + p_effect_delta));
  end if;
  if p_effect_flag_key is not null then
    cur_effects := jsonb_set(cur_effects, array[p_effect_flag_key], to_jsonb(p_effect_flag_value));
  end if;
  if p_appraisal_lot_id is not null then
    cur_effects := jsonb_set(cur_effects, array['appraisals', p_appraisal_lot_id::text], to_jsonb(p_appraisal_tier), true);
  end if;

  update auction_participants
  set
    coins = greatest(0, coins + p_coins_delta),
    bonus_points = coalesce(bonus_points, 0) + p_bonus_points_delta,
    win_streak = coalesce(p_win_streak, win_streak),
    effects = cur_effects
  where id = p_participant_id
  returning * into result;

  return result;
end;
$$;

-- 總冠軍賽產生函式:勝部冠軍 + 敗部冠軍都出爐後，原子化建立唯一一場總決賽
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

-- 贊助名單:主辦人可以自己開好幾份獨立的名單(跟活動 events 完全無關，自己取名字管理)
create table if not exists sponsor_lists (
  id uuid primary key default gen_random_uuid(),
  name text not null, -- 名單名稱，例如「擂台夜市 第 12 屆」，自己取
  raised text, -- 這份名單的贊助總額，自己填文字，例如「NT$ 18，600」
  visible boolean not null default true, -- 是否顯示於前台;關閉後前台完全不顯示這份名單，但後台資料與統計仍保留
  created_at timestamptz default now()
);

-- 升級既有資料庫用:幫 sponsor_lists 補上 visible 欄位，舊資料預設為顯示，不影響既有前台畫面。
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'sponsor_lists' and column_name = 'visible'
  ) then
    alter table sponsor_lists add column visible boolean not null default true;
  end if;
end $$;

-- 贊助者，每筆歸屬到某一份 sponsor_lists
create table if not exists sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  items text not null, -- 贊助了什麼，可以多行文字列好幾樣
  sort_order int not null default 0,
  created_at timestamptz default now()
);

-- 升級既有資料庫用:幫 sponsors 補上 sponsor_list_id 欄位，
-- 如果表裡已經有舊資料(改版前不分名單的贊助紀錄)，先開一份「既有贊助名單」把舊資料收進去。
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

-- 升級既有資料庫用:sponsors.items 原本是必填的自由文字欄位，
-- 改版後贊助內容改成「獎勵名稱 + 數量」存進 sponsor_rewards，items 不再需要必填。
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
-- 同一次「新增贊助」如果填了好幾種獎勵(例如嗶幣+鑽石+黑玫瑰)，會共用同一個 entry_id，
-- 方便後台把同一次贊助的項目分在同一組顯示;同一位贊助者不同次贊助各自是獨立的 entry_id，
-- 紀錄永遠保留，前台顯示時再依「獎勵名稱」加總成累積總額。
create table if not exists sponsor_rewards (
  id uuid primary key default gen_random_uuid(),
  sponsor_id uuid not null references sponsors(id) on delete cascade,
  entry_id uuid not null default gen_random_uuid(),
  reward_name text not null, -- 獎勵名稱，例如「嗶幣」「鑽石」「黑玫瑰」
  qty numeric not null default 0, -- 數量
  created_at timestamptz default now()
);

-- 舊資料轉移:把改版前 sponsors.items 裡的自由文字，轉成一筆「獎勵名稱=原本的文字、數量=1」的紀錄，
-- 避免升級後舊贊助紀錄憑空消失(只跑一次，已經轉過的贊助者不會重複轉)。
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

-- 公告:首頁用來顯示「新活動 / 版本更新 / 一般公告」的精選卡片，後台可以新增/編輯/刪除、上傳一張封面圖。
-- 首頁固定抓「最新一則」當精選公告(hero)，其餘依建立時間收進「更多公告」收合區(跟贊助名單、活動列表同一套邏輯:最新一則+歷史收合)。
create table if not exists announcements (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'general', -- 'event'新活動 / 'update'版本更新 / 'general'一般公告，對應首頁徽章顏色跟圖示
  title text not null,
  subtitle text, -- 圖片上面那行小字，例如「報名開放中 · 8/03 開賽」「v2.0」，選填
  body text, -- 內文說明
  image_url text, -- 封面圖網址，選填(沒有的話首頁用該類型的預設圖示墊底)
  cta_text text, -- 按鈕文字，例如「立即報名」「查看玩法說明」，選填
  cta_link text, -- 按鈕連結，可以是站內錨點(例如 #events-list)或外部網址，選填
  created_at timestamptz default now()
);

-- 公告封面圖存放的 Storage bucket，設成公開讀取(圖片網址不含機密資訊)
insert into storage.buckets (id, name, public)
values ('announcement-images', 'announcement-images', true)
on conflict (id) do nothing;

drop policy if exists "anon read announcement images" on storage.objects;
create policy "anon read announcement images" on storage.objects
  for select using (bucket_id = 'announcement-images');

drop policy if exists "anon write announcement images" on storage.objects;
create policy "anon write announcement images" on storage.objects
  for all using (bucket_id = 'announcement-images') with check (bucket_id = 'announcement-images');

-- 開放權限(小型私人活動，信任參加者，不做帳號驗證)
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
-- 夜市拍賣(auction):跟骰子/五手勢完全獨立的活動類型，不走賽程/晉級，
-- 所以不共用 matches 表，獨立開三張表:
--   auction_participants — 每位玩家的財神幣/分數/打工冷卻
--   auction_lots         — 每一件排定要拍賣的商品(含底價、目前最高價、狀態、時間)
--   auction_bids         — 出價紀錄(目前只用來留歷史，排行/得標都是看 auction_lots/auction_participants)
-- ============================================

-- 開放 events.game_type 多一個 'auction' 選項
alter table events drop constraint if exists events_game_type_check;
alter table events add constraint events_game_type_check check (game_type in ('dice','rps5','auction'));

create table if not exists auction_participants (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  coins int not null default 0,          -- 目前手上財神幣
  work_ready_at timestamptz not null default now(), -- 打工按鈕的冷卻到期時間
  final_rank int,
  reward text,
  created_at timestamptz default now(),
  unique(event_id, player_id)
);
alter table auction_participants add column if not exists lucky_ready_at timestamptz not null default now(); -- 幸運攤位下注的冷卻到期時間
alter table auction_participants add column if not exists effects jsonb not null default '{}'; -- 特殊券效果庫存，例如 {"intel":1，"priority":0，"refund":2，"boxDouble":1，"freeCommon":0，"intelActive":true}

create table if not exists auction_lots (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  wave_number int not null default 1,
  item_name text not null,
  item_tier text not null, -- common | rare | epic | legendary | special | mystery | bundle
  points int not null default 0,          -- 得標可以拿到的分數(特殊券固定是 0，不計分)
  base_price int not null default 0,      -- 起標價
  min_increment int not null default 10,  -- 最小加價單位
  current_price int not null default 0,   -- 目前最高價(還沒開拍時等於 base_price)
  current_bidder_id uuid references players(id),
  status text not null default 'scheduled', -- scheduled(排隊等開拍) | live(拍賣中) | done(已結標)
  scheduled_at timestamptz not null,      -- 預計開拍時間
  ends_at timestamptz,                    -- 目前這波倒數的截標時間(進入 live 才會有值，加價可能延後)
  settled boolean not null default false, -- 是否已經把得標結果算進得標者的分數(避免重複結算)
  created_at timestamptz default now()
);
alter table auction_lots add column if not exists special_key text;              -- 特殊券效果代號(intel/priority/refund/boxDouble/freeCommon)，一般商品是 null
alter table auction_lots add column if not exists refunded boolean not null default false; -- 是否已經用退款保證券退貨過
alter table auction_lots add column if not exists priority_holder_id uuid references players(id); -- 插隊優先權預約在這一波的人
alter table auction_lots add column if not exists priority_until timestamptz;    -- 插隊優先權的專屬出價時間到什麼時候
alter table auction_lots add column if not exists box_reveal_name text;         -- 福袋箱開出的獎項名稱(結標才會有值)
alter table auction_lots add column if not exists box_reveal_tier text;         -- 福袋箱開出的獎項等級(common/rare/epic/legendary/bust)
alter table auction_lots add column if not exists box_doubled boolean not null default false; -- 是否套用了福袋箱翻倍券
alter table auction_lots add column if not exists partner_a_id uuid references players(id); -- 合夥競標:發起邀請的人
alter table auction_lots add column if not exists partner_b_id uuid references players(id); -- 合夥競標:被邀請的人
alter table auction_lots add column if not exists partner_status text;          -- 合夥競標狀態:null(沒有合夥) | pending(等對方回應) | accepted(合夥中) | declined(對方婉拒)
alter table auction_lots add column if not exists is_surprise boolean not null default false; -- 隱藏驚喜商品:true 的話「商品預告」不會顯示這件，開拍才會知道
alter table auction_participants add column if not exists bonus_points numeric not null default 0; -- 合夥競標分到的分數 + 猜價小遊戲贏得的分數，加總進排行榜分數
alter table auction_participants add column if not exists win_streak int not null default 0; -- 連續標到幾件商品(不含特殊券)，斷了(出過價卻沒標到)就歸零，連續3件起下一件加10%分數
alter table auction_lots add column if not exists box_pre_roll_tier text;   -- 福袋箱在「排程當下」就先偷偷開好的等級，給商品鑑定符看用，真正結標拿分數還是用這個值(不是重新開一次)
alter table auction_lots add column if not exists box_pre_roll_name text;   -- 同上，偷偷開好的獎項名稱
alter table auction_lots add column if not exists is_sealed boolean not null default false; -- 暗標/密封競標:true 的話出價是盲出，看不到別人出多少，時間到才一起揭曉
alter table auction_lots add column if not exists is_flash boolean not null default false;  -- 限時快閃攤:true 的話不用比價，固定價格先搶先贏，搶到當下就直接結標

-- 猜價小遊戲:每件商品開拍中，大家可以先猜「這件最後會標到多少錢」，不用出價也能參與，
-- 結標時猜中或最接近的人加一點 bonus_points。一人一件商品只能猜一次。
create table if not exists auction_price_guesses (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid references auction_lots(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  guess int not null,
  created_at timestamptz default now(),
  unique(lot_id, player_id)
);
alter table auction_price_guesses enable row level security;
drop policy if exists "anon all auction_price_guesses" on auction_price_guesses;
create policy "anon all auction_price_guesses" on auction_price_guesses for all using (true) with check (true);

create table if not exists auction_bids (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid references auction_lots(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount int not null,
  created_at timestamptz default now()
);

-- 商品鑑定符(暗標競標同理，出價要盲出，所以不用共用 auction_bids 這張大家都看得到目前最高價的表，
-- 另外開一張各自出價互不可見的表。真正結標時直接查這張表算最高價，跟英式競標的 current_price/current_bidder_id 是兩條平行邏輯)
create table if not exists auction_sealed_bids (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid references auction_lots(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  amount int not null,
  created_at timestamptz default now(),
  unique(lot_id, player_id) -- 同一人同一件可以改價(用 upsert)，但只留最後一次出的
);
alter table auction_sealed_bids enable row level security;
drop policy if exists "anon all auction_sealed_bids" on auction_sealed_bids;
create policy "anon all auction_sealed_bids" on auction_sealed_bids for all using (true) with check (true);

alter table auction_participants enable row level security;
drop policy if exists "anon all auction_participants" on auction_participants;
create policy "anon all auction_participants" on auction_participants for all using (true) with check (true);

alter table auction_lots enable row level security;
drop policy if exists "anon all auction_lots" on auction_lots;
create policy "anon all auction_lots" on auction_lots for all using (true) with check (true);

alter table auction_bids enable row level security;
drop policy if exists "anon all auction_bids" on auction_bids;
create policy "anon all auction_bids" on auction_bids for all using (true) with check (true);

-- ============================================
-- 夜市任務(auction_tasks):開始拍賣時系統會順便排一批問答/猜謎題，
-- 平均分散在整場時間內自動開放作答，答對現領財神幣，不用主辦人手動操作。
--   auction_tasks         — 每一題排定要開放的任務(題目、選項、正解、獎金、狀態、時間)
--   auction_task_answers  — 每位玩家對每一題的作答紀錄(靠 unique 限制一人一題只能答一次)
-- ============================================

create table if not exists auction_tasks (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  question text not null,
  options jsonb not null,                 -- ["選項A"，"選項B"，"選項C"，"選項D"]
  correct_index int not null,             -- options 裡正確答案的索引(從 0 開始)
  task_type text not null default 'quiz', -- quiz(問答) | riddle(猜謎) | egg(彩蛋題)，目前邏輯相同、只是顯示用圖示/文案不同
  reward int not null default 0,          -- 答對可以拿到的財神幣
  status text not null default 'scheduled', -- scheduled(排隊等開放) | live(開放作答中) | done(已結束)
  scheduled_at timestamptz not null,      -- 預計開放時間
  ends_at timestamptz,                    -- 這題的作答截止時間(進入 live 才會有值)
  created_at timestamptz default now()
);

create table if not exists auction_task_answers (
  id uuid primary key default gen_random_uuid(),
  task_id uuid references auction_tasks(id) on delete cascade,
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  correct boolean not null,
  created_at timestamptz default now(),
  unique(task_id, player_id)
);

alter table auction_tasks enable row level security;
drop policy if exists "anon all auction_tasks" on auction_tasks;
create policy "anon all auction_tasks" on auction_tasks for all using (true) with check (true);

alter table auction_task_answers enable row level security;
drop policy if exists "anon all auction_task_answers" on auction_task_answers;
create policy "anon all auction_task_answers" on auction_task_answers for all using (true) with check (true);

-- ============================================
-- 職業養成對決(獨立第三種遊戲類型，走 career.html，自己的資料表，不跟骰子/五手勢共用賽程晉級架構，
-- 不跟夜市拍賣共用商品/波次結構)——Phase 1:戰鬥引擎驗證
-- ============================================

-- 開放 events.game_type 多一個 'career' 選項
alter table events drop constraint if exists events_game_type_check;
alter table events add constraint events_game_type_check check (game_type in ('dice','rps5','auction','career'));

-- 玩家在某場活動裡選的職業建置。Phase1 簡化版:玩家直接選一條「線」(例如力量系攻擊線)，
-- 對應的 tier1+tier2 技能節點跟最終職業會一起自動代入，不用像正式版 Phase2 塔爬完成後那樣
-- 兩層分開點——真正的技能樹節點資料仍然共用 assets/career-data.js 的 CAREER_TREE(跟企劃書
-- 第十三節的資料結構完全一致)，這裡只是 Phase1 先固定「整條線一起選」，Phase2 接上塔爬與自由
-- 數值點之後，skill_keys 才會允許玩家分開勾選 tier1/tier2。
create table if not exists career_builds (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  path text not null,          -- strength | agility | magic
  final_class text not null,   -- warrior | guardian | archer | assassin | mage | healer
  skill_keys jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  unique(event_id, player_id)
);
alter table career_builds enable row level security;
drop policy if exists "anon all career_builds" on career_builds;
create policy "anon all career_builds" on career_builds for all using (true) with check (true);

-- PVP 配對佇列。Phase1 只做「最陽春的先進先配」(企劃書十三節):誰等最久誰先配對，
-- 不做分數排位邏輯，也先不做賽程式的「輪空(bye)」——這是一個持續在跑的配對池(打完自動回到
-- waiting 再排下一場)，不是每輪都要湊滿對數的賽程制，落單的人單純留在佇列裡等下一個人加入就好，
-- 不會有「這一輪配不到人要吃 bye」的情境，所以企劃書原稿裡 bye_count 那段先不做，等 Phase3
-- 接上真正的排行榜/積分排位邏輯時再一起考慮。
create table if not exists career_pvp_queue (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  status text not null default 'waiting', -- waiting | matched
  current_score int not null default 0,
  wins int not null default 0,
  losses int not null default 0,
  win_streak int not null default 0,     -- 目前連勝數，輸一場歸零(企劃書第九節「連勝加成」)
  final_rank int,                         -- 活動結束結算時填入(見 finish_career_match/closeCareerEvent)
  reward text,
  last_matched_at timestamptz default now(),
  created_at timestamptz default now(),
  unique(event_id, player_id)
);
alter table career_pvp_queue enable row level security;
drop policy if exists "anon all career_pvp_queue" on career_pvp_queue;
create policy "anon all career_pvp_queue" on career_pvp_queue for all using (true) with check (true);
-- PVP 對戰場次。獨立於 matches 表之外，state 的欄位結構(hp1/hp2/atk1.../m1/m2/log)自己一套，
-- 不會跟骰子/五手勢的 state 混在一起。initialized 是給「配對成功後才把雙方完整戰鬥數值寫進 state」
-- 這一步用的旗標(見 assets/career.js initializeCareerMatch)，兩個分頁同時偵測到新場次也只有一個
-- 能真的寫入(update ... where initialized=false 這個條件本身就是原子鎖)。
create table if not exists career_matches (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  player1_id uuid references players(id),
  player2_id uuid references players(id),
  status text not null default 'active', -- active | done
  winner_id uuid,
  initialized boolean not null default false,
  state jsonb not null default '{"round":1,"log":[]}'::jsonb,
  created_at timestamptz default now()
);
alter table career_matches enable row level security;
drop policy if exists "anon all career_matches" on career_matches;
create policy "anon all career_matches" on career_matches for all using (true) with check (true);

-- 回合出招合併寫入,跟 submit_move 同一套原子合併寫法(state = state || 新的一小塊)，
-- 避免兩人幾乎同時出招，後送到的那個把先送到的蓋掉。
create or replace function submit_career_move(p_match_id uuid, p_slot int, p_payload jsonb)
returns void
language plpgsql
as $$
begin
  update career_matches
  set state = state || jsonb_build_object('m' || p_slot, p_payload)
  where id = p_match_id;
end;
$$;

-- 配對(先進先配):撈佇列裡等最久的兩人配對成一場新的 career_matches。
-- 用 for update skip locked 讓兩個分頁同時掃描也不會搶到同一個人(比企劃書原稿描述的
-- 「client端讀到waiting再UPDATE、失敗就退回重試」的樂觀鎖版本更穩，這裡直接用 Postgres
-- 原生的悲觀鎖做掉，邏輯更短也不會有兩個分頁互相重試的空窗期)。
create or replace function match_career_players(p_event_id uuid)
returns uuid
language plpgsql
as $$
declare
  p1 record;
  p2 record;
  new_match_id uuid;
begin
  select id, player_id into p1
  from career_pvp_queue
  where event_id = p_event_id and status = 'waiting'
  order by last_matched_at
  limit 1
  for update skip locked;

  if p1 is null then
    return null;
  end if;

  select id, player_id into p2
  from career_pvp_queue
  where event_id = p_event_id and status = 'waiting' and id <> p1.id
  order by last_matched_at
  limit 1
  for update skip locked;

  if p2 is null then
    return null; -- 目前佇列裡只有一個人，等下一個人加入才能配對
  end if;

  insert into career_matches(event_id, player1_id, player2_id, status, state)
  values (p_event_id, p1.player_id, p2.player_id, 'active', '{"round":1,"log":[]}'::jsonb)
  returning id into new_match_id;

  update career_pvp_queue set status = 'matched' where id in (p1.id, p2.id);

  return new_match_id;
end;
$$;

-- 一場 PVP 打完呼叫:贏家 +10 分再疊加連勝加成(每連勝+2分，最高再+10分封頂)、輸家 +2 分且連勝歸零
-- (企劃書第九節)，然後兩人的佇列狀態都退回 waiting、last_matched_at 更新成現在，可以馬上排下一場。
-- 用 status='matched' 當條件鎖，兩個分頁同時判定同一場結束也只有一次會真的加到分。
create or replace function finish_career_match(p_match_id uuid, p_winner_id uuid, p_loser_id uuid)
returns void
language plpgsql
as $$
declare
  m record;
  winner_streak int;
  streak_bonus int;
begin
  select * into m from career_matches where id = p_match_id and status = 'active';
  if m is null then
    return; -- 已經被結算過了
  end if;

  update career_matches set status = 'done', winner_id = p_winner_id where id = p_match_id;

  select win_streak + 1 into winner_streak from career_pvp_queue where event_id = m.event_id and player_id = p_winner_id;
  streak_bonus := least(coalesce(winner_streak, 1) * 2, 10);

  update career_pvp_queue
  set status = 'waiting',
      current_score = current_score + 10 + streak_bonus,
      wins = wins + 1,
      win_streak = coalesce(winner_streak, 1),
      last_matched_at = now()
  where event_id = m.event_id and player_id = p_winner_id;

  update career_pvp_queue
  set status = 'waiting', current_score = current_score + 2, losses = losses + 1, win_streak = 0, last_matched_at = now()
  where event_id = m.event_id and player_id = p_loser_id;
end;
$$;

-- ============================================
-- 職業養成對決 Phase 2:爬塔骨架(企劃書第十二、十三節)
-- ============================================

-- 每個玩家在這場活動裡的爬塔進度。跟 career_builds(選的最終職業)是分開的兩張表——
-- 職業是 Phase1 就定案的「你是誰」，這張表是「你爬塔爬得怎麼樣」，Phase3 把訓練期/對戰期接起來
-- 之後，PVP 的戰鬥數值才會改成讀這張表(職業基礎值 + stat_alloc + equipment)而不是 Phase1
-- 那個寫死的 CareerData.computeStats()。
create table if not exists career_progress (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  player_id uuid references players(id) on delete cascade,
  floor int not null default 0,          -- 已清到第幾層(0=還沒清過任何一層)
  level int not null default 1,
  exp int not null default 0,
  coins int not null default 0,
  stat_points int not null default 0,    -- 還沒花的自由數值點
  stat_alloc jsonb not null default '{"atk":0,"def":0,"spd":0,"hp":0,"luck":0,"matk":0,"mp":0}'::jsonb,
  equipment jsonb not null default '{"weapon":null,"armor":null,"accessory":null}'::jsonb,
  train_ready_at timestamptz not null default now(),
  auto_farm_floor int,                    -- 目前開著自動掛機的樓層,null=沒開
  auto_farm_last_at timestamptz not null default now(),
  auto_farm_last_result jsonb,            -- 最近一次背景自動戰鬥的結果,給畫面顯示「掛機真的有在動」用
  pending_event jsonb,                    -- 觸發了需要玩家二選一的事件(神秘寶箱/路過商人/轉職邀請)，
                                           -- 存在這裡等玩家選完才清空(見 career-events.js)
  stat_points_bought int not null default 0, -- 商店買過幾次「直接加1點數值」，價格會越買越貴
  legendary_purchased boolean not null default false, -- 傳說裝備整場限購1件(商店買或抽獎機中都算)
  fragments int not null default 0, -- (已被背包系統取代，保留欄位不刪避免破壞舊資料，新邏輯不再使用)
  inventory jsonb not null default '[]'::jsonb, -- 背包:撿到/買到但還沒穿上的裝備，每件都有自己的 id
  current_hp int, -- 爬塔用的持續HP，null表示還沒受過傷(視為滿血)。每次挑戰樓層不會自動補滿，
                   -- 要靠休息/藥水/事件恢復。PVP對戰不用這個欄位，PVP永遠滿血滿魔開打。
  current_mp int, -- 同上，持續魔力值
  potions jsonb not null default '{"hp":0,"mp":0}'::jsonb, -- 消耗品:恢復藥水/魔力藥水，用掉就少一瓶
  active_boss_battle jsonb, -- 王戰(小關主)進行中的回合狀態，null表示目前沒有王戰在打。
                             -- 王戰是玩家自己一個人跟AI野怪即時互動(選攻擊/大招)，不像PVP要等
                             -- 對方回合，所以不需要另外開一張表，狀態直接存在自己的進度列就好。
  skill_points int not null default 0, -- 還沒花的技能點(每升一級送1點，跟自由數值點是分開的資源)
  unlocked_skill boolean not null default false, -- 有沒有花1技能點解鎖「戰技」(見 career-data.js SKILL_MANA_COST)
  created_at timestamptz default now(),
  unique(event_id, player_id)
);
alter table career_progress enable row level security;
drop policy if exists "anon all career_progress" on career_progress;
create policy "anon all career_progress" on career_progress for all using (true) with check (true);
-- 如果是舊版本已經跑過一次上面的 create table(那時候還沒有這個欄位)，這行補上去，
-- 已經是新版本、欄位本來就存在的話這行不會出錯也不會做任何事。
alter table career_progress add column if not exists auto_farm_last_result jsonb;
alter table career_progress add column if not exists pending_event jsonb;
alter table career_progress add column if not exists stat_points_bought int not null default 0;
alter table career_progress add column if not exists legendary_purchased boolean not null default false;
alter table career_progress add column if not exists fragments int not null default 0;
alter table career_progress add column if not exists inventory jsonb not null default '[]'::jsonb;
alter table career_progress add column if not exists current_hp int;
alter table career_progress add column if not exists current_mp int;
alter table career_progress add column if not exists potions jsonb not null default '{"hp":0,"mp":0}'::jsonb;
alter table career_progress add column if not exists active_boss_battle jsonb;
alter table career_progress add column if not exists skill_points int not null default 0;
alter table career_progress add column if not exists unlocked_skill boolean not null default false;

-- 全服事件廣播:誰抽到傳說裝備、誰爬完所有樓層之類的大事，讓整場活動的人都看得到，
-- 不用另外做訂閱/推播機制，前端用 onTableChange 訂閱 + 讀最近幾筆就好。
create table if not exists career_broadcasts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  icon text not null default 'megaphone',
  message text not null,
  created_at timestamptz default now()
);
alter table career_broadcasts enable row level security;
drop policy if exists "anon all career_broadcasts" on career_broadcasts;
create policy "anon all career_broadcasts" on career_broadcasts for all using (true) with check (true);

-- 買戰功勳章:扣幣 + 加排行分數，兩個表要一起改，包在同一個交易裡才不會出現
-- 「幣扣了但分沒加到」或反過來的半吊子狀態。用 for update 鎖住那一列，
-- 兩個分頁同時搶著買也不會用到同一份舊的coins數字算兩次。
create or replace function buy_career_medal(p_event_id uuid, p_player_id uuid, p_price int, p_score_bonus int)
returns void
language plpgsql
as $$
declare
  prog record;
begin
  select * into prog from career_progress where event_id = p_event_id and player_id = p_player_id for update;
  if prog is null then
    raise exception '找不到爬塔進度，請先進爬塔頁面';
  end if;
  if prog.coins < p_price then
    raise exception '幣不夠';
  end if;

  update career_progress set coins = coins - p_price where id = prog.id;

  insert into career_pvp_queue(event_id, player_id, current_score)
  values (p_event_id, p_player_id, p_score_bonus)
  on conflict (event_id, player_id) do update set current_score = career_pvp_queue.current_score + p_score_bonus;
end;
$$;

-- ============================================
-- Realtime(Database Publications):以下這段可以整份跟著上面一起貼到 SQL Editor 執行，
-- 不用再手動去 Database → Replication 一張一張打開開關。用 pg_publication_tables 先檢查
-- 這張表是不是已經在 supabase_realtime 這個發布清單裡，不在才加，所以整份重跑也不會出錯
-- (ALTER PUBLICATION ADD TABLE 對已經加過的表格重複執行會直接報錯，這裡用迴圈避開)。
do $$
declare
  t text;
begin
  foreach t in array array[
    'events', 'event_participants', 'matches', 'match_bets',
    'auction_participants', 'auction_lots', 'auction_bids',
    'auction_tasks', 'auction_task_answers', 'auction_price_guesses',
    'career_pvp_queue', 'career_matches', 'career_progress', 'career_broadcasts'
  ]
  loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
-- ============================================
