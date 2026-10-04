-- PVP 配對修復(在線心跳版)。在 Supabase SQL Editor 執行一次即可(可重複執行)。
-- 需要先執行過 migration-pvp-stale-match.sql(沒執行過也沒關係，這份不依賴它)。
--
-- 問題:玩家關掉頁面後，他在佇列裡的狀態還是 waiting，配對函式會把真人配給這個「幽靈」，
-- 對方永遠不會出招，這場就永遠卡住，之後該真人既配不到人、重進又回到死掉的對戰。
-- 修法:每個玩家頁面開著時每 3 秒回報一次「我還在」(last_seen_at)，
--   1) 配對只挑「最近 20 秒內有回報」的人(機器人例外)
--   2) 對戰中有真人超過 60 秒沒回報，這場就結束(不計勝負)並放人回閒置

alter table career_pvp_queue add column if not exists last_seen_at timestamptz not null default now();

create or replace function career_heartbeat(p_event_id uuid, p_player_id uuid)
returns void
language plpgsql
as $$
begin
  update career_pvp_queue set last_seen_at = now()
  where event_id = p_event_id and player_id = p_player_id;
end;
$$;

-- 配對:用 advisory lock 讓同一場活動同一時間只有一個人在配對。
-- 舊版的 for update skip locked，兩個分頁同時掃描時各鎖住一個人、都以為對方不在，兩邊都回傳 null。
create or replace function match_career_players(p_event_id uuid)
returns uuid
language plpgsql
as $$
declare
  p1 record;
  p2 record;
  new_match_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('match_career_players:' || p_event_id::text));

  select q.id as id, q.player_id as player_id into p1
  from career_pvp_queue q
  join players pl on pl.id = q.player_id
  where q.event_id = p_event_id
    and q.status = 'waiting'
    and (pl.is_bot or q.last_seen_at > now() - interval '20 seconds')
  order by q.last_matched_at
  limit 1;

  if p1.id is null then
    return null;
  end if;

  select q.id as id, q.player_id as player_id into p2
  from career_pvp_queue q
  join players pl on pl.id = q.player_id
  where q.event_id = p_event_id
    and q.status = 'waiting'
    and q.id <> p1.id
    and (pl.is_bot or q.last_seen_at > now() - interval '20 seconds')
  order by q.last_matched_at
  limit 1;

  if p2.id is null then
    return null; -- 目前佇列裡只有一個在線的人，等下一個人加入才能配對
  end if;

  insert into career_matches(event_id, player1_id, player2_id, status, state)
  values (p_event_id, p1.player_id, p2.player_id, 'active', '{"round":1,"log":[]}'::jsonb)
  returning id into new_match_id;

  update career_pvp_queue set status = 'matched' where id in (p1.id, p2.id);

  return new_match_id;
end;
$$;

-- 清理:有真人超過 p_stale_seconds 秒沒回報在線的進行中對戰 -> 結束(不判勝負、不計分)；
-- 沒有對應進行中對戰卻還卡在 matched 的人 -> 放回 idle。
create or replace function cleanup_stale_career_matches(p_event_id uuid, p_stale_seconds int default 60)
returns int
language plpgsql
as $$
declare
  n int;
begin
  update career_matches m
  set status = 'done'
  where m.event_id = p_event_id
    and m.status = 'active'
    and exists (
      select 1
      from career_pvp_queue q
      join players pl on pl.id = q.player_id
      where q.event_id = m.event_id
        and q.player_id in (m.player1_id, m.player2_id)
        and not pl.is_bot
        and q.last_seen_at < now() - make_interval(secs => p_stale_seconds)
    );

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
