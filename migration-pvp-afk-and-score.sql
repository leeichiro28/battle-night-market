-- PVP 掛網判負 + 積分防刷。在 Supabase SQL Editor 執行一次即可(可重複執行)。
-- 內容也已附加在 supabase-schema.sql 最後面，重跑整份 schema 效果相同。
--
alter table career_pvp_queue add column if not exists best_streak int not null default 0;
alter table career_pvp_queue add column if not exists beat_higher int not null default 0;

-- 1) cleanup_stale_career_matches:對戰中「有一方真人」超過 p_stale_seconds 秒沒回報在線，
--    且另一方還在線 -> 判在線的那一方獲勝(走 finish_career_match，積分/連勝/獎勵照正常計算)；
--    雙方都失聯、或對手是機器人 -> 單純結束，不判勝負不計分(避免被拿來刷分)。
-- 2) finish_career_match(v2 積分規則):對手積分加權、掛網判負打折；只要有機器人參與，這場就是「練習賽」，不給積分、幣、數值點、不動戰績。
-- 3) 移除「戰功勳章」(用幣買排行分)。已經買過的人的分數會保留在 current_score，如要歸零請看檔案最後的註解。

create or replace function cleanup_stale_career_matches(p_event_id uuid, p_stale_seconds int default 45)
returns int
language plpgsql
as $$
declare
  n int;
  mt record;
  s1 timestamptz; s2 timestamptz;
  bot1 boolean; bot2 boolean;
  stale1 boolean; stale2 boolean;
begin
  for mt in
    select * from career_matches where event_id = p_event_id and status = 'active'
  loop
    select q.last_seen_at, pl.is_bot into s1, bot1
      from career_pvp_queue q join players pl on pl.id = q.player_id
      where q.event_id = mt.event_id and q.player_id = mt.player1_id;
    select q.last_seen_at, pl.is_bot into s2, bot2
      from career_pvp_queue q join players pl on pl.id = q.player_id
      where q.event_id = mt.event_id and q.player_id = mt.player2_id;

    stale1 := coalesce(not bot1, false) and s1 is not null and s1 < now() - make_interval(secs => p_stale_seconds);
    stale2 := coalesce(not bot2, false) and s2 is not null and s2 < now() - make_interval(secs => p_stale_seconds);

    if stale1 and not stale2 and not coalesce(bot2, false) then
      perform finish_career_match(mt.id, mt.player2_id, mt.player1_id, 'afk');   -- P1 掛網，P2 勝
    elsif stale2 and not stale1 and not coalesce(bot1, false) then
      perform finish_career_match(mt.id, mt.player1_id, mt.player2_id, 'afk');   -- P2 掛網，P1 勝
    elsif stale1 or stale2 then
      update career_matches set status = 'done' where id = mt.id and status = 'active';  -- 雙方失聯/對手是機器人
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

-- ===== 積分規則(v2):對手積分加權、掛網判負打折 =====
-- 可調整的數字都在下面這個函式最上面的「參數」區。
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
  AFK_WIN_POINTS  constant int := 3;    -- 對手掛網棄權時，在場玩家拿到的分(不加連勝加成)
  AFK_WIN_COINS   constant int := 5;
  -- 懸賞榜:對手連勝滿 BOUNTY_MIN_STREAK 場就有懸賞，打倒他的人額外拿幣。
  -- 要跟前端 assets/db.js 的 careerBountyFor 一起改。
  BOUNTY_MIN_STREAK constant int := 3;
  BOUNTY_BASE     constant int := 100;  -- 連勝剛滿門檻時的懸賞幣
  BOUNTY_PER_WIN  constant int := 100;  -- 之後每多連勝 1 場 +100 幣
  BOUNTY_MAX      constant int := 1000; -- 懸賞幣上限(連勝 12 場封頂)
  BOUNTY_SCORE_BASE    constant int := 5;   -- 連勝剛滿門檻時額外加的排行積分
  BOUNTY_SCORE_PER_WIN constant int := 2;   -- 之後每多連勝 1 場 +2 分
  BOUNTY_SCORE_MAX     constant int := 25;  -- 懸賞積分上限
  -- 時段事件「擂台加碼」:活動開始後第 33～41 分鐘內結算的 PVP 積分 ×1.5。
  -- 要跟前端 assets/career-modifiers.js 的 WINDOWS(key = arena)一起改。
  ARENA_START_MIN constant numeric := 33;
  ARENA_END_MIN   constant numeric := 41;
  ARENA_BONUS_X   constant numeric := 1.5;
  -- ====================================
  m record;
  winner_streak int;
  streak_score_bonus int;
  win_coin_reward int;
  win_stat_point_bonus int;
  loser_streak int := 0;  -- 輸家這場之前的連勝數(懸賞榜用)
  bounty_coins int := 0;  -- 打倒連勝者的懸賞幣
  bounty_score int := 0;  -- 打倒連勝者的懸賞積分
  w_score int; l_score int;
  base_pts int; win_pts int; loss_pts int;
  reward jsonb;
  has_bot boolean;
  is_afk boolean := coalesce(p_reason = 'afk', false); -- p_reason 沒傳時是 NULL,NULL = 'afk' 會是 NULL 而不是 false,所以一定要 coalesce
  ev_rules jsonb;
  mins numeric;
  arena_mult numeric := 1;
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
    -- 懸賞榜:掛網棄權、機器人練習賽都不算(練習賽前面已經 return)
    select coalesce(win_streak, 0) into loser_streak from career_pvp_queue where event_id = m.event_id and player_id = p_loser_id;
    if loser_streak >= BOUNTY_MIN_STREAK then
      bounty_coins := least(BOUNTY_BASE + (loser_streak - BOUNTY_MIN_STREAK) * BOUNTY_PER_WIN, BOUNTY_MAX);
      win_coin_reward := win_coin_reward + bounty_coins;
      bounty_score := least(BOUNTY_SCORE_BASE + (loser_streak - BOUNTY_MIN_STREAK) * BOUNTY_SCORE_PER_WIN, BOUNTY_SCORE_MAX);
      win_pts := win_pts + bounty_score;
    end if;
  end if;

  -- 擂台加碼:依活動經過的分鐘數判斷(activityEndsAt 往前推 60 分鐘 = 活動開始)
  select rules into ev_rules from events where id = m.event_id;
  if ev_rules is not null and ev_rules ? 'activityEndsAt' then
    mins := extract(epoch from (now() - ((ev_rules->>'activityEndsAt')::timestamptz - interval '60 minutes'))) / 60;
    if mins >= ARENA_START_MIN and mins < ARENA_END_MIN then
      arena_mult := ARENA_BONUS_X;
    end if;
  end if;
  if arena_mult > 1 then
    win_pts := round(win_pts * arena_mult)::int;
    loss_pts := round(loss_pts * arena_mult)::int;
  end if;

  reward := jsonb_build_object(
    'winStreak', case when is_afk then 0 else winner_streak end,
    'streakScoreBonus', streak_score_bonus,
    'coinReward', win_coin_reward,
    'statPointBonus', win_stat_point_bonus,
    'scoreGained', win_pts,
    'loserScoreGained', loss_pts,
    'afkForfeit', is_afk,
    'bounty', case when bounty_coins > 0 then bounty_coins else null end,
    'bountyScore', case when bounty_coins > 0 then bounty_score else null end,
    'bountyStreak', case when bounty_coins > 0 then loser_streak else null end,
    'arenaBonus', case when arena_mult > 1 then arena_mult else null end
  );

  update career_matches
  set status = 'done', winner_id = p_winner_id, state = coalesce(state, '{}'::jsonb) || jsonb_build_object('pvpReward', reward)
  where id = p_match_id;

  -- best_streak / beat_higher 給「每場任務」用:掛網棄權的勝利不算連勝、不算贏過積分比自己高的人
  update career_pvp_queue
  set status = 'idle',
      current_score = current_score + win_pts,
      wins = wins + 1,
      win_streak = case when is_afk then win_streak else winner_streak end,
      best_streak = greatest(coalesce(best_streak, 0), case when is_afk then 0 else winner_streak end),
      beat_higher = coalesce(beat_higher, 0) + case when not is_afk and l_score > w_score then 1 else 0 end,
      last_matched_at = now()
  where event_id = m.event_id and player_id = p_winner_id;

  update career_pvp_queue
  set status = 'idle', current_score = current_score + loss_pts, losses = losses + 1, win_streak = 0, last_matched_at = now()
  where event_id = m.event_id and player_id = p_loser_id;

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
