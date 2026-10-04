-- PVP 卡死修復:對戰中途有人離開，那場對戰會永遠停在 active，雙方佇列狀態也永遠是 matched，
-- 之後既配不到人、重進去也回到那場死掉的對戰。在 Supabase SQL Editor 執行一次即可(可重複執行)。

alter table career_matches add column if not exists last_activity_at timestamptz not null default now();

create or replace function touch_career_match_activity() returns trigger as $$
begin
  new.last_activity_at := now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_touch_career_match_activity on career_matches;
create trigger trg_touch_career_match_activity
  before update on career_matches
  for each row execute function touch_career_match_activity();

-- 結束「太久沒有任何動作」的對戰(不判勝負、不計分)，並把沒有對應進行中對戰卻還卡在 matched 的人放回 idle。
create or replace function cleanup_stale_career_matches(p_event_id uuid, p_stale_seconds int default 120)
returns int
language plpgsql
as $$
declare
  n int;
begin
  update career_matches
  set status = 'done'
  where event_id = p_event_id
    and status = 'active'
    and last_activity_at < now() - make_interval(secs => p_stale_seconds);

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
