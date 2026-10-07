-- PVP 掛網判負 + 積分防刷。在 Supabase SQL Editor 執行一次即可(可重複執行)。
-- 內容也已附加在 supabase-schema.sql 最後面，重跑整份 schema 效果相同。
--
-- 1) cleanup_stale_career_matches:對戰中「有一方真人」超過 p_stale_seconds 秒沒回報在線，
--    且另一方還在線 -> 判在線的那一方獲勝(走 finish_career_match，積分/連勝/獎勵照正常計算)；
--    雙方都失聯、或對手是機器人 -> 單純結束，不判勝負不計分(避免被拿來刷分)。
-- 2) finish_career_match(v2 積分規則):對手積分加權、每小時上限、掛網判負打折；只要有機器人參與，這場就是「練習賽」，不給積分、幣、數值點、不動戰績。
-- 3) 移除「戰功勳章」(用幣買排行分)。已經買過的人的分數會保留在 current_score，如要歸零請看檔案最後的註解。

create or replace function cleanup_stale_career_matches(p_event_id uuid, p_stale_seconds int default 45)
returns int
language plpgsql
as $$
declare
  n int;
  m record;
  s1 timestamptz; s2 timestamptz;
  bot1 boolean; bot2 boolean;
  stale1 boolean; stale2 boolean;
begin
  for m in
    select * from career_matches where event_id = p_event_id and status = 'active'
  loop
    select q.last_seen_at, pl.is_bot into s1, bot1
      from career_pvp_queue q join players pl on pl.id = q.player_id
      where q.event_id = m.event_id and q.player_id = m.player1_id;
    select q.last_seen_at, pl.is_bot into s2, bot2
      from career_pvp_queue q join players pl on pl.id = q.player_id
      where q.event_id = m.event_id and q.player_id = m.player2_id;

    stale1 := coalesce(not bot1, false) and s1 is not null and s1 < now() - make_interval(secs => p_stale_seconds);
    stale2 := coalesce(not bot2, false) and s2 is not null and s2 < now() - make_interval(secs => p_stale_seconds);

    if stale1 and not stale2 and not coalesce(bot2, false) then
      perform finish_career_match(m.id, m.player2_id, m.player1_id, 'afk');   -- P1 掛網，P2 勝
    elsif stale2 and not stale1 and not coalesce(bot1, false) then
      perform finish_career_match(m.id, m.player1_id, m.player2_id, 'afk');   -- P2 掛網，P1 勝
    elsif stale1 or stale2 then
      update career_matches set status = 'done' where id = m.id and status = 'active';  -- 雙方失聯/對手是機器人
    end if;
  end loop;

  update career_pvp_queue q
  set status = 'idle', last_matched_at = now()
  where q.event_id = p_event_id
    and q.status = 'matched'
    and not exists (
      select 1 from career_matches m
      where m.event_id = p_event_id and m.status = 'active'
        and (m.player1_id = q.player_id or m.player2_id = q.player_id)
    );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ===== 積分規則(v2):對手積分加權、每小時 PVP 得分上限、掛網判負打折 =====
-- 可調整的數字都在下面這個函式最上面的「參數」區。
create table if not exists career_score_log (
  id bigserial primary key,
  event_id uuid not null,
  player_id uuid not null,
  points int not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists career_score_log_idx on career_score_log (event_id, player_id, created_at desc);
alter table career_score_log enable row level security;
drop policy if exists "anon all career_score_log" on career_score_log;
create policy "anon all career_score_log" on career_score_log for all using (true) with check (true);

drop function if exists finish_career_match(uuid, uuid, uuid);
drop function if exists finish_career_match(uuid, uuid, uuid, text);

create or replace function finish_career_match(p_match_id uuid, p_winner_id uuid, p_loser_id uuid, p_reason text default null)
returns void
language plpgsql
as $$
declare
  -- ===== 參數(想調整積分就改這裡) =====
  WIN_BASE        constant int := 10;   -- 贏的基本分
  WIN_MIN         constant int := 5;    -- 贏的分數下限(贏比自己積分低很多的人)
  WIN_MAX         constant int := 20;   -- 贏的分數上限(贏比自己積分高很多的人)
  RATING_STEP     constant int := 20;   -- 雙方總積分每差 20 分，贏的分數 ±1
  LOSS_POINTS     constant int := 2;    -- 輸的參加分
  HOURLY_CAP      constant int := 100;  -- 每人「最近 60 分鐘」PVP 最多能拿幾分(輸贏合計)
  AFK_WIN_POINTS  constant int := 3;    -- 對手掛網棄權時，在場玩家拿到的分(不加連勝加成)
  AFK_WIN_COINS   constant int := 5;
  -- ====================================
  m record;
  winner_streak int;
  streak_score_bonus int;
  win_coin_reward int;
  win_stat_point_bonus int;
  w_score int; l_score int;
  base_pts int; win_pts int; loss_pts int;
  w_recent int; l_recent int;
  reward jsonb;
  has_bot boolean;
  is_afk boolean := (p_reason = 'afk');
begin
  select * into m from career_matches where id = p_match_id and status = 'active';
  if m is null then
    return; -- 已經被結算過了
  end if;

  select exists(select 1 from players where id in (p_winner_id, p_loser_id) and is_bot) into has_bot;

  if has_bot then
    -- 練習賽(對手是機器人):不計分、不發獎勵、不動戰績。
    update career_matches
    set status = 'done', winner_id = p_winner_id,
        state = coalesce(state, '{}'::jsonb) || jsonb_build_object('pvpReward', jsonb_build_object('practice', true))
    where id = p_match_id;
    update career_pvp_queue set status = 'idle', last_matched_at = now()
    where event_id = m.event_id and player_id in (p_winner_id, p_loser_id);
    return;
  end if;

  -- 雙方目前總積分 = PVP 積分 + 爬塔積分(每層 1 分 + 每 10 層再 +5，要跟前端 CareerFloors 的設定一致)
  select coalesce(q.current_score, 0) + coalesce(p.floor, 0) + (coalesce(p.floor, 0) / 10) * 5 into w_score
    from career_pvp_queue q left join career_progress p on p.event_id = q.event_id and p.player_id = q.player_id
    where q.event_id = m.event_id and q.player_id = p_winner_id;
  select coalesce(q.current_score, 0) + coalesce(p.floor, 0) + (coalesce(p.floor, 0) / 10) * 5 into l_score
    from career_pvp_queue q left join career_progress p on p.event_id = q.event_id and p.player_id = q.player_id
    where q.event_id = m.event_id and q.player_id = p_loser_id;
  w_score := coalesce(w_score, 0);
  l_score := coalesce(l_score, 0);

  select coalesce(win_streak, 0) + 1 into winner_streak from career_pvp_queue where event_id = m.event_id and player_id = p_winner_id;
  winner_streak := coalesce(winner_streak, 1);

  if is_afk then
    win_pts := AFK_WIN_POINTS;
    streak_score_bonus := 0;
    win_coin_reward := AFK_WIN_COINS;
    win_stat_point_bonus := 0;
    loss_pts := 0;
  else
    base_pts := least(greatest(WIN_BASE + round((l_score - w_score)::numeric / RATING_STEP)::int, WIN_MIN), WIN_MAX);
    streak_score_bonus := least(winner_streak * 2, 10);
    win_pts := base_pts + streak_score_bonus;
    loss_pts := LOSS_POINTS;
    win_coin_reward := (15 + floor(random() * 11)::int) + least(winner_streak * 5, 25);
    win_stat_point_bonus := least(greatest((winner_streak - 1) / 2, 0), 3);
  end if;

  -- 每小時上限:最近 60 分鐘已經拿到的 PVP 分數 + 這次，不能超過 HOURLY_CAP
  select coalesce(sum(points), 0) into w_recent from career_score_log
    where event_id = m.event_id and player_id = p_winner_id and created_at > now() - interval '60 minutes';
  select coalesce(sum(points), 0) into l_recent from career_score_log
    where event_id = m.event_id and player_id = p_loser_id and created_at > now() - interval '60 minutes';
  win_pts := least(win_pts, greatest(HOURLY_CAP - w_recent, 0));
  loss_pts := least(loss_pts, greatest(HOURLY_CAP - l_recent, 0));

  reward := jsonb_build_object(
    'winStreak', case when is_afk then 0 else winner_streak end,
    'streakScoreBonus', streak_score_bonus,
    'coinReward', win_coin_reward,
    'statPointBonus', win_stat_point_bonus,
    'scoreGained', win_pts,
    'loserScoreGained', loss_pts,
    'afkForfeit', is_afk,
    'capped', (win_pts < case when is_afk then AFK_WIN_POINTS else coalesce(base_pts, 0) + streak_score_bonus end)
  );

  update career_matches
  set status = 'done', winner_id = p_winner_id, state = coalesce(state, '{}'::jsonb) || jsonb_build_object('pvpReward', reward)
  where id = p_match_id;

  update career_pvp_queue
  set status = 'idle',
      current_score = current_score + win_pts,
      wins = wins + 1,
      win_streak = case when is_afk then win_streak else winner_streak end,
      last_matched_at = now()
  where event_id = m.event_id and player_id = p_winner_id;

  update career_pvp_queue
  set status = 'idle', current_score = current_score + loss_pts, losses = losses + 1, win_streak = 0, last_matched_at = now()
  where event_id = m.event_id and player_id = p_loser_id;

  if win_pts > 0 then
    insert into career_score_log (event_id, player_id, points, reason) values (m.event_id, p_winner_id, win_pts, case when is_afk then 'afk_win' else 'win' end);
  end if;
  if loss_pts > 0 then
    insert into career_score_log (event_id, player_id, points, reason) values (m.event_id, p_loser_id, loss_pts, 'loss');
  end if;

  update career_progress
  set coins = coins + win_coin_reward,
      stat_points = stat_points + win_stat_point_bonus
  where event_id = m.event_id and player_id = p_winner_id;
end;
$$;

-- 4) submit_career_move:代打(auto=true)的出招不能蓋掉對手剛剛自己送出的真實出招；
--    場次已經結束(status<>'active')就不再接受出招。
create or replace function submit_career_move(p_match_id uuid, p_slot int, p_payload jsonb)
returns void
language plpgsql
as $$
begin
  update career_matches
  set state = state || jsonb_build_object('m' || p_slot, p_payload)
  where id = p_match_id
    and status = 'active'
    and not (coalesce(p_payload->>'auto', '') = 'true' and state ? ('m' || p_slot));
end;
$$;

-- 移除用幣買排行分的 RPC
drop function if exists buy_career_medal(uuid, uuid, int, int);

-- (選用)如果想把「已經用勳章買到的分數」歸零，要先知道每個人買了多少。目前沒有另外記錄，
-- 只能由主辦人手動調整 career_pvp_queue.current_score，或在活動開始前就先執行本檔。
