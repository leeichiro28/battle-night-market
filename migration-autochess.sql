-- ============================================
-- 夜市自走棋(autochess)・階段 3:多人與活動整合
-- 可重複執行(全部用 if not exists / create or replace)。
-- 設計見 docs/autochess-design.md 的 3-1、3-11、5-2、5-3。
-- ============================================

-- 1) 活動類型
alter table events drop constraint if exists events_game_type_check;
alter table events add constraint events_game_type_check
  check (game_type in ('dice','rps5','auction','career','autochess'));

-- 2) 玩家(每人每場一列)
--    銅板、等級、經驗、連勝、卡牌、商店、加碼等「會隨版本改欄位」的東西全放在 state(整批一次寫入);
--    伺服器自己要判斷的(血量、勝敗場、淘汰、名次、封板/結算進度)才獨立成欄位。
create table if not exists autochess_players (
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  hp int not null default 100,               -- 淘汰當輪可能為負數(溢出量用來比名次),畫面要顯示 max(0, hp)
  wins int not null default 0,
  losses int not null default 0,
  state jsonb not null default '{}'::jsonb,  -- { gold, level, xp, streak, board, bench, shop, shopLocked, refreshCount, perks, perkPicks, ... };空物件 = 還沒初始化
  state_rev int not null default 0,          -- 樂觀鎖:同一帳號開兩個分頁時,後寫的會失敗
  alive boolean not null default true,
  eliminated_round int,
  overflow int not null default 0,           -- 淘汰時血量低於 0 的部分
  final_rank int,
  reward text,
  sealed_round int not null default 0,       -- 最近一次被封板配對的輪次
  settled_round int not null default 0,      -- 最近一次結算完的輪次(sealed_round > settled_round = 有一場還沒結算)
  last_action_round int not null default 0,  -- 最近一次有存檔(操作)的輪次,用來判斷掛網
  last_seen timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (event_id, player_id)
);
alter table autochess_players enable row level security;
drop policy if exists "anon all autochess_players" on autochess_players;
create policy "anon all autochess_players" on autochess_players for all using (true) with check (true);

-- 3) 每輪每場對戰(p2 為空 = 幽靈戰)
create table if not exists autochess_rounds (
  event_id uuid not null references events(id) on delete cascade,
  round int not null,
  k int not null,                            -- 這一輪的第幾場
  p1 uuid not null,
  p2 uuid,
  ghost_of uuid,                             -- 幽靈複製的是誰(p2 為空時才有)
  seed text not null,                        -- 這場戰鬥的亂數種子
  board1 jsonb not null,                     -- 封板快照(含 hp、afk 旗標、整份 state);戰鬥只用這份,不再讀玩家目前狀態
  board2 jsonb not null,
  result jsonb,                              -- 結算時寫入(outcomes 陣列)
  resolved boolean not null default false,   -- 防重複結算
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (event_id, round, k)
);
alter table autochess_rounds enable row level security;
drop policy if exists "anon all autochess_rounds" on autochess_rounds;
create policy "anon all autochess_rounds" on autochess_rounds for all using (true) with check (true);
create index if not exists autochess_rounds_unresolved_idx on autochess_rounds (event_id, round) where resolved = false;

-- 4) 平衡數據(每輪每人一筆:陣容、主流派、勝負、這輪選的加碼卡…,由結算的客戶端附上;後台頁在階段 4 才做)
create table if not exists autochess_stats (
  event_id uuid not null references events(id) on delete cascade,
  round int not null,
  player_id uuid not null,
  stat jsonb not null default '{}'::jsonb,
  primary key (event_id, round, player_id)
);
alter table autochess_stats enable row level security;
drop policy if exists "anon all autochess_stats" on autochess_stats;
create policy "anon all autochess_stats" on autochess_stats for all using (true) with check (true);

-- 5) 警告紀錄(雙方驗算結果不一致、數值被截斷等;方便事後查是引擎 bug 還是有人作弊)
create table if not exists autochess_log (
  id bigserial primary key,
  event_id uuid not null references events(id) on delete cascade,
  round int,
  kind text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table autochess_log enable row level security;
drop policy if exists "anon all autochess_log" on autochess_log;
create policy "anon all autochess_log" on autochess_log for all using (true) with check (true);

-- ============================================
-- 時鐘:第幾輪、哪個階段,全由「伺服器現在時間 − startedAt − 暫停累計秒數」推算(企劃 3-1)。
-- events.rules.autochess.run = {
--   startedAt, prepSec:[每輪準備秒數,最後一個數字往後沿用], battleSec, resultSec,
--   limitSec(活動總時間上限,可為 null), pausedAt, pausedTotal, extra:{"輪次":加時秒數}, endedAt, endReason }
-- 客戶端一律用這個函式回傳的 now 校正本機時鐘(手機時間不準也沒關係)。
-- ============================================
create or replace function autochess_clock(p_event_id uuid)
returns jsonb
language plpgsql
stable
as $$
declare
  run jsonb;
  started timestamptz;
  paused timestamptz;
  elapsed numeric;
  prep_arr jsonb;
  n int;
  battle int;
  res int;
  r int := 0;
  t numeric;
  prep int := 0;
  len int := 0;
  v_phase text;
  v_left numeric;
  v_limit numeric;
  v_pe numeric;
begin
  select rules->'autochess'->'run' into run from events where id = p_event_id;
  if run is null or jsonb_typeof(run) <> 'object' then
    return jsonb_build_object('now', now(), 'started', false);
  end if;
  started := (run->>'startedAt')::timestamptz;
  paused := nullif(run->>'pausedAt', '')::timestamptz;
  elapsed := extract(epoch from (coalesce(paused, now()) - started)) - coalesce((run->>'pausedTotal')::numeric, 0);
  battle := coalesce((run->>'battleSec')::int, 25);
  res := coalesce((run->>'resultSec')::int, 5);
  prep_arr := coalesce(run->'prepSec', '[90]'::jsonb);
  n := greatest(jsonb_array_length(prep_arr), 1);
  v_limit := nullif(run->>'limitSec', '')::numeric;

  if elapsed < 0 then
    return jsonb_build_object(
      'now', now(), 'started', true, 'phase', 'countdown', 'round', 0, 'left', ceil(-elapsed),
      'elapsed', elapsed, 'paused', paused is not null, 'over', false, 'phaseElapsed', 0,
      'endedAt', run->>'endedAt', 'limitSec', v_limit
    );
  end if;

  t := elapsed;
  loop
    r := r + 1;
    prep := coalesce((prep_arr->>(least(r, n) - 1))::int, 90) + coalesce((run->'extra'->>(r::text))::int, 0);
    len := prep + battle + res;
    exit when t < len or r >= 300;
    t := t - len;
  end loop;

  if t < prep then
    v_phase := 'prep'; v_left := prep - t; v_pe := t;
  elsif t < prep + battle then
    v_phase := 'battle'; v_left := prep + battle - t; v_pe := t - prep;
  else
    v_phase := 'result'; v_left := len - t; v_pe := t - prep - battle;
  end if;

  return jsonb_build_object(
    'now', now(), 'started', true, 'phase', v_phase, 'round', r, 'left', ceil(v_left),
    'prepSec', prep, 'phaseElapsed', round(v_pe, 2), 'elapsed', elapsed, 'paused', paused is not null,
    'over', (v_limit is not null and elapsed >= v_limit),
    'endedAt', run->>'endedAt', 'limitSec', v_limit
  );
end;
$$;

-- 把 patch 合併進 events.rules.autochess.run(呼叫端自己先拿好 advisory lock)
create or replace function autochess_set_run(p_event_id uuid, p_patch jsonb)
returns void
language plpgsql
as $$
begin
  update events
  set rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
    'autochess',
    coalesce(rules->'autochess', '{}'::jsonb) || jsonb_build_object(
      'run', coalesce(rules->'autochess'->'run', '{}'::jsonb) || p_patch
    )
  )
  where id = p_event_id;
end;
$$;

-- ============================================
-- 開始活動(後台按下去才呼叫)。開打後不能新加入:這裡一次把所有報名的人建成玩家列。
-- p_run = { leadSec(倒數秒數,預設 15), prepSec:[...], battleSec, resultSec, limitSec, startHp, dataVersion }
-- 少於 2 人會丟出例外(整個 transaction 回滾);建議 4 人以上(企劃 8-10)。
-- ============================================
create or replace function autochess_start(p_event_id uuid, p_run jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
as $$
declare
  ev events%rowtype;
  v_cnt int;
  v_run jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('autochess:' || p_event_id::text));
  select * into ev from events where id = p_event_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_event'); end if;
  if ev.game_type <> 'autochess' then return jsonb_build_object('ok', false, 'reason', 'not_autochess'); end if;
  if ev.rules->'autochess'->'run' is not null then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into autochess_players (event_id, player_id, hp)
  select p_event_id, ep.player_id, coalesce((p_run->>'startHp')::int, 100)
  from event_participants ep
  where ep.event_id = p_event_id
  on conflict (event_id, player_id) do nothing;
  select count(*) into v_cnt from autochess_players where event_id = p_event_id;
  if v_cnt < 2 then
    raise exception 'autochess_need_2_players';
  end if;

  v_run := jsonb_build_object(
    'startedAt', now() + make_interval(secs => coalesce((p_run->>'leadSec')::int, 15)),
    'prepSec', coalesce(p_run->'prepSec', '[90]'::jsonb),
    'battleSec', coalesce((p_run->>'battleSec')::int, 25),
    'resultSec', coalesce((p_run->>'resultSec')::int, 5),
    'limitSec', p_run->'limitSec',
    'pausedTotal', 0,
    'extra', '{}'::jsonb,
    'players', v_cnt,
    'dataVersion', p_run->'dataVersion'
  );
  update events
  set locked = true,
      status = 'running',
      rules = coalesce(rules, '{}'::jsonb) || jsonb_build_object(
        'autochess', coalesce(rules->'autochess', '{}'::jsonb) || jsonb_build_object('run', v_run)
      )
  where id = p_event_id;
  return jsonb_build_object('ok', true, 'players', v_cnt, 'startedAt', v_run->>'startedAt');
end;
$$;

-- ============================================
-- 主辦人控制台:pause / resume / extend(目前這輪準備階段加時)/ finish(強制結束)
-- ============================================
create or replace function autochess_control(p_event_id uuid, p_action text, p_sec int default 0)
returns jsonb
language plpgsql
as $$
declare
  run jsonb;
  clk jsonb;
  v_paused timestamptz;
  v_total numeric;
  v_round int;
  v_cur int;
begin
  perform pg_advisory_xact_lock(hashtext('autochess:' || p_event_id::text));
  select rules->'autochess'->'run' into run from events where id = p_event_id;
  if run is null then return jsonb_build_object('ok', false, 'reason', 'not_started'); end if;
  if run->>'endedAt' is not null then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;

  if p_action = 'pause' then
    if nullif(run->>'pausedAt', '') is null then
      perform autochess_set_run(p_event_id, jsonb_build_object('pausedAt', now()));
    end if;
  elsif p_action = 'resume' then
    v_paused := nullif(run->>'pausedAt', '')::timestamptz;
    if v_paused is not null then
      v_total := coalesce((run->>'pausedTotal')::numeric, 0) + extract(epoch from (now() - v_paused));
      perform autochess_set_run(p_event_id, jsonb_build_object('pausedAt', null, 'pausedTotal', v_total));
    end if;
  elsif p_action = 'extend' then
    clk := autochess_clock(p_event_id);
    if clk->>'phase' <> 'prep' then return jsonb_build_object('ok', false, 'reason', 'not_prep'); end if;
    v_round := (clk->>'round')::int;
    v_cur := coalesce((run->'extra'->>(v_round::text))::int, 0);
    perform autochess_set_run(p_event_id, jsonb_build_object(
      'extra', coalesce(run->'extra', '{}'::jsonb) || jsonb_build_object(v_round::text, least(v_cur + greatest(p_sec, 0), 600))
    ));
  elsif p_action = 'finish' then
    return autochess_finish(p_event_id, 'admin');
  else
    return jsonb_build_object('ok', false, 'reason', 'bad_action');
  end if;
  return jsonb_build_object('ok', true, 'clock', autochess_clock(p_event_id));
end;
$$;

-- ============================================
-- 存檔(準備階段每次操作都整批寫入)。擋掉:非準備階段、已封板、前一場還沒結算、版本號不符、已淘汰。
-- ============================================
create or replace function autochess_save_state(p_event_id uuid, p_player_id uuid, p_rev int, p_state jsonb, p_round int)
returns jsonb
language plpgsql
as $$
declare
  pl autochess_players%rowtype;
  clk jsonb;
  v_phase text;
begin
  select * into pl from autochess_players where event_id = p_event_id and player_id = p_player_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_player'); end if;
  if not pl.alive then return jsonb_build_object('ok', false, 'reason', 'dead'); end if;
  if pl.state_rev <> p_rev then return jsonb_build_object('ok', false, 'reason', 'rev', 'rev', pl.state_rev); end if;
  if pg_column_size(p_state) > 100000 then return jsonb_build_object('ok', false, 'reason', 'too_big'); end if;

  clk := autochess_clock(p_event_id);
  if not coalesce((clk->>'started')::boolean, false) or clk->>'endedAt' is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_running');
  end if;
  v_phase := clk->>'phase';
  -- 倒數期間允許存「第 1 輪」的初始狀態;其餘只能在「目前這一輪」的準備階段存。
  -- 準備結束後 2 秒內(還沒被封板配對前)仍收,讓最後一刻的操作與「時間到自動補位」不會因網路延遲遺失。
  if not ((v_phase = 'prep' and (clk->>'round')::int = p_round)
       or (v_phase = 'countdown' and p_round = 1)
       or (v_phase = 'battle' and (clk->>'round')::int = p_round and (clk->>'phaseElapsed')::numeric < 2)) then
    return jsonb_build_object('ok', false, 'reason', 'not_prep');
  end if;
  if pl.sealed_round >= p_round then return jsonb_build_object('ok', false, 'reason', 'sealed'); end if;
  if pl.settled_round < pl.sealed_round then return jsonb_build_object('ok', false, 'reason', 'unsettled'); end if;

  update autochess_players
  set state = p_state, state_rev = state_rev + 1, last_action_round = p_round, last_seen = now()
  where event_id = p_event_id and player_id = p_player_id;
  return jsonb_build_object('ok', true, 'rev', pl.state_rev + 1);
end;
$$;

create or replace function autochess_heartbeat(p_event_id uuid, p_player_id uuid)
returns void
language plpgsql
as $$
begin
  update autochess_players set last_seen = now() where event_id = p_event_id and player_id = p_player_id;
end;
$$;

-- 封板快照:雙方「當下」的整份狀態(含 hp、掛網旗標)
create or replace function autochess_snapshot(p_event_id uuid, p_player_id uuid, p_round int)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'player_id', player_id, 'hp', hp, 'wins', wins, 'losses', losses,
    'afk', (p_round - last_action_round) >= 3,   -- 連續 3 輪沒有任何操作:照打,但不發連勝加成
    'state', state
  )
  from autochess_players where event_id = p_event_id and player_id = p_player_id;
$$;

-- ============================================
-- 封板 + 配對(任何客戶端都能呼叫;advisory lock + 「這一輪是否已配對」確保只執行一次)
-- 回傳 { ok, already?, reason?, matches? }
-- ============================================
create or replace function autochess_pair_round(p_event_id uuid, p_round int)
returns jsonb
language plpgsql
as $$
declare
  clk jsonb;
  cand uuid[];
  best uuid[];
  best_rep int := 1000000;
  rep int;
  attempt int;
  n int;
  i int;
  k int := 0;
  lone uuid;
  v_ghost uuid;
begin
  perform pg_advisory_xact_lock(hashtext('autochess:' || p_event_id::text));

  if exists (select 1 from autochess_rounds where event_id = p_event_id and round = p_round) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  clk := autochess_clock(p_event_id);
  if not coalesce((clk->>'started')::boolean, false) then return jsonb_build_object('ok', false, 'reason', 'not_started'); end if;
  if clk->>'endedAt' is not null then return jsonb_build_object('ok', false, 'reason', 'ended'); end if;
  -- 只能配對「準備階段已經結束、且存檔緩衝(2 秒)也過了」的輪次
  if p_round > (clk->>'round')::int
     or (p_round = (clk->>'round')::int and (clk->>'phase' in ('prep', 'countdown')
         or (clk->>'phase' = 'battle' and (clk->>'phaseElapsed')::numeric < 2))) then
    return jsonb_build_object('ok', false, 'reason', 'too_early');
  end if;
  -- 一輪一輪來,前一輪要全部結算完
  if p_round <> coalesce((select max(round) from autochess_rounds where event_id = p_event_id), 0) + 1 then
    return jsonb_build_object('ok', false, 'reason', 'out_of_order');
  end if;
  if exists (select 1 from autochess_rounds where event_id = p_event_id and resolved = false) then
    return jsonb_build_object('ok', false, 'reason', 'prev_unsettled');
  end if;
  -- 活動時間到:前一輪都結算完了就直接結束,不再開新的一輪
  if coalesce((clk->>'over')::boolean, false) and p_round > 1 then
    return autochess_finish(p_event_id, 'timeout');
  end if;

  select count(*) into n from autochess_players where event_id = p_event_id and alive;
  if n <= 1 then
    return autochess_finish(p_event_id, 'last_one');
  end if;

  -- 隨機洗牌,盡量避免跟上一輪同一組(試 12 次取重複最少的)
  for attempt in 1..12 loop
    select array_agg(player_id order by random()) into cand
    from autochess_players where event_id = p_event_id and alive;
    rep := 0;
    for i in 1..(n / 2) loop
      if exists (
        select 1 from autochess_rounds
        where event_id = p_event_id and round = p_round - 1 and p2 is not null
          and ((p1 = cand[2 * i - 1] and p2 = cand[2 * i]) or (p1 = cand[2 * i] and p2 = cand[2 * i - 1]))
      ) then
        rep := rep + 1;
      end if;
    end loop;
    if rep < best_rep then best := cand; best_rep := rep; end if;
    exit when best_rep = 0;
  end loop;

  for i in 1..(n / 2) loop
    k := k + 1;
    insert into autochess_rounds (event_id, round, k, p1, p2, seed, board1, board2)
    values (
      p_event_id, p_round, k, best[2 * i - 1], best[2 * i],
      md5(p_event_id::text || '|' || p_round::text || '|' || k::text || '|' || random()::text),
      autochess_snapshot(p_event_id, best[2 * i - 1], p_round),
      autochess_snapshot(p_event_id, best[2 * i], p_round)
    );
  end loop;

  -- 奇數人:落單的人打「幽靈」= 隨機一位其他存活玩家這一輪的封板快照(幽靈本尊不受影響)
  if n % 2 = 1 then
    lone := best[n];
    select player_id into v_ghost from autochess_players
    where event_id = p_event_id and alive and player_id <> lone
    order by random() limit 1;
    k := k + 1;
    insert into autochess_rounds (event_id, round, k, p1, p2, ghost_of, seed, board1, board2)
    values (
      p_event_id, p_round, k, lone, null, v_ghost,
      md5(p_event_id::text || '|' || p_round::text || '|' || k::text || '|' || random()::text),
      autochess_snapshot(p_event_id, lone, p_round),
      autochess_snapshot(p_event_id, v_ghost, p_round)
    );
  end if;

  update autochess_players set sealed_round = p_round where event_id = p_event_id and alive;
  return jsonb_build_object('ok', true, 'matches', k);
end;
$$;

-- ============================================
-- 結算一場對戰(任何客戶端都可以送;結果是「快照 + 種子」的決定性函式,誰算都一樣,p1 預設負責送)
-- p_outcomes = [ { player_id, res:'win'|'lose'|'draw', dmg:int, patch:{gold,streak,bestStreak,perks}, stat:{...} } ]
-- 一般對戰要有 p1、p2 各一筆;幽靈戰只有 p1 一筆(幽靈本尊不受影響)。
-- 一輪最後一場結算完 → 淘汰歸零的人;只剩 1 人或活動時間到 → 結束並算名次。
-- ============================================
create or replace function autochess_settle_round(p_event_id uuid, p_round int, p_k int, p_by uuid, p_outcomes jsonb)
returns jsonb
language plpgsql
as $$
declare
  m autochess_rounds%rowtype;
  o jsonb;
  v_pid uuid;
  v_seen uuid[] := '{}';
  v_res text;
  v_dmg int;
  v_patch jsonb;
  v_old jsonb;
  v_gold_old numeric;
  v_gold_new numeric;
  v_alive int;
  v_need int;
  clk jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('autochess:' || p_event_id::text));

  select * into m from autochess_rounds where event_id = p_event_id and round = p_round and k = p_k for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_match'); end if;
  if m.resolved then return jsonb_build_object('ok', true, 'already', true); end if;

  v_need := case when m.p2 is null then 1 else 2 end;
  if jsonb_typeof(p_outcomes) <> 'array' or jsonb_array_length(p_outcomes) <> v_need then
    return jsonb_build_object('ok', false, 'reason', 'bad_outcomes');
  end if;

  for o in select * from jsonb_array_elements(p_outcomes) loop
    v_pid := (o->>'player_id')::uuid;
    if v_pid is distinct from m.p1 and v_pid is distinct from m.p2 then
      raise exception 'autochess_outcome_player_not_in_match';
    end if;
    if v_pid = any(v_seen) then raise exception 'autochess_outcome_duplicate_player'; end if;
    v_seen := v_seen || v_pid;
    v_res := o->>'res';
    if v_res is null or v_res not in ('win', 'lose', 'draw') then raise exception 'autochess_bad_res'; end if;
    v_dmg := greatest(0, least(coalesce((o->>'dmg')::int, 0), 999));
    if v_res <> 'lose' then v_dmg := 0; end if;

    -- 只收白名單欄位,不讓客戶端整包覆蓋 state(卡牌、商店等不在結算時改動)
    select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_patch
    from jsonb_each(coalesce(o->'patch', '{}'::jsonb))
    where key in ('gold', 'streak', 'bestStreak', 'perks');

    select state into v_old from autochess_players where event_id = p_event_id and player_id = v_pid;
    v_gold_old := coalesce((v_old->>'gold')::numeric, 0);
    v_gold_new := (v_patch->>'gold')::numeric;
    if v_gold_new is not null and (v_gold_new < 0 or v_gold_new > v_gold_old + 80) then
      -- 一輪收入不可能這麼多:記警告並把數字夾在合理範圍
      insert into autochess_log (event_id, round, kind, detail)
      values (p_event_id, p_round, 'gold_clamped', jsonb_build_object('player_id', v_pid, 'old', v_gold_old, 'new', v_gold_new, 'by', p_by));
      v_patch := v_patch || jsonb_build_object('gold', greatest(0, least(v_gold_new, v_gold_old + 80)));
    end if;

    update autochess_players
    set hp = hp - v_dmg,
        wins = wins + (case when v_res = 'win' then 1 else 0 end),
        losses = losses + (case when v_res = 'lose' then 1 else 0 end),
        state = state || v_patch,
        state_rev = state_rev + 1,
        settled_round = greatest(settled_round, p_round)
    where event_id = p_event_id and player_id = v_pid;

    if o->'stat' is not null and jsonb_typeof(o->'stat') = 'object' then
      insert into autochess_stats (event_id, round, player_id, stat)
      values (p_event_id, p_round, v_pid, o->'stat')
      on conflict (event_id, round, player_id) do update set stat = excluded.stat;
    end if;
  end loop;

  update autochess_rounds
  set result = jsonb_build_object('outcomes', p_outcomes), resolved = true, resolved_by = p_by, resolved_at = now()
  where event_id = p_event_id and round = p_round and k = p_k;

  -- 這一輪全部結算完:淘汰歸零的人(當輪結算完才生效),再看是否結束
  if not exists (select 1 from autochess_rounds where event_id = p_event_id and round = p_round and resolved = false) then
    update autochess_players
    set alive = false, eliminated_round = p_round, overflow = greatest(-hp, 0)
    where event_id = p_event_id and alive and hp <= 0;
    select count(*) into v_alive from autochess_players where event_id = p_event_id and alive;
    clk := autochess_clock(p_event_id);
    if v_alive <= 1 then
      perform autochess_finish(p_event_id, 'last_one');
    elsif coalesce((clk->>'over')::boolean, false) then
      perform autochess_finish(p_event_id, 'timeout');
    end if;
    return jsonb_build_object('ok', true, 'roundDone', true, 'alive', v_alive);
  end if;
  return jsonb_build_object('ok', true, 'roundDone', false);
end;
$$;

-- 雙方驗算結果不一致時,由另一方的客戶端回報(只記警告,不改任何數字)
create or replace function autochess_report_mismatch(p_event_id uuid, p_round int, p_k int, p_by uuid, p_mine jsonb)
returns void
language plpgsql
as $$
begin
  insert into autochess_log (event_id, round, kind, detail)
  values (p_event_id, p_round, 'mismatch', jsonb_build_object('k', p_k, 'by', p_by, 'mine', p_mine));
end;
$$;

-- ============================================
-- 結束並算名次:存活者在前(多人存活 = 時間到或主辦人強制結束,依剩餘血量、再比勝場);
-- 其餘依淘汰輪次(越晚越高)、同輪比血量溢出(越少越高)、再比累積勝場。
-- 名次寫進 autochess_players.final_rank,也同步到 event_participants.final_rank。
-- 頒獎(reward_plan / 贊助獎勵)與把活動設成 closed 由前端沿用既有流程處理。
-- ============================================
create or replace function autochess_finish(p_event_id uuid, p_reason text default 'last_one')
returns jsonb
language plpgsql
as $$
declare
  run jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('autochess:' || p_event_id::text));
  select rules->'autochess'->'run' into run from events where id = p_event_id;
  if run is null then return jsonb_build_object('ok', false, 'reason', 'not_started'); end if;
  if run->>'endedAt' is not null then return jsonb_build_object('ok', true, 'already', true); end if;

  with ranked as (
    select player_id,
           row_number() over (
             order by alive desc,
                      (case when alive then hp end) desc nulls last,
                      eliminated_round desc nulls last,
                      overflow asc,
                      wins desc,
                      player_id
           ) as rk
    from autochess_players
    where event_id = p_event_id
  )
  update autochess_players p
  set final_rank = r.rk
  from ranked r
  where p.event_id = p_event_id and p.player_id = r.player_id;

  update event_participants ep
  set final_rank = p.final_rank
  from autochess_players p
  where ep.event_id = p_event_id and p.event_id = p_event_id and ep.player_id = p.player_id;

  perform autochess_set_run(p_event_id, jsonb_build_object('endedAt', now(), 'endReason', p_reason, 'pausedAt', null));
  return jsonb_build_object('ok', true, 'reason', p_reason);
end;
$$;
