-- ============================================
-- v58 夜市自走棋:「完成準備」提早開始
-- 在 Supabase SQL Editor 執行一次即可(可重複執行)。沒跑這份的話,前端的「完成準備」按鈕會提示尚未更新資料庫,
-- 其餘功能(時間到自動封板)不受影響。
-- 規則:準備階段內,所有「還活著的真人」都按下「完成準備」→ 伺服器把這一輪準備時間縮短到「現在 + 2 秒」,提早進入戰鬥。
--       機器人(is_bot)不用按;任何人在準備階段內修改陣容,前端會自動取消他的「已準備」。
-- ============================================
alter table autochess_players add column if not exists ready_round int not null default 0; -- 已按「完成準備」的輪次(= 目前輪次才算數)

create or replace function autochess_ready(p_event_id uuid, p_player_id uuid, p_round int, p_ready boolean)
returns jsonb
language plpgsql
as $$
declare
  clk jsonb;
  run jsonb;
  pl autochess_players%rowtype;
  v_total int;
  v_ready int;
  v_cur_prep int;
  v_new_prep int;
  v_extra int;
  v_early boolean := false;
begin
  perform pg_advisory_xact_lock(hashtext('autochess:' || p_event_id::text));
  clk := autochess_clock(p_event_id);
  if not coalesce((clk->>'started')::boolean, false) or clk->>'endedAt' is not null then
    return jsonb_build_object('ok', false, 'reason', 'not_running');
  end if;
  if clk->>'phase' <> 'prep' or (clk->>'round')::int <> p_round then
    return jsonb_build_object('ok', false, 'reason', 'not_prep');
  end if;
  select * into pl from autochess_players where event_id = p_event_id and player_id = p_player_id for update;
  if not found then return jsonb_build_object('ok', false, 'reason', 'no_player'); end if;
  if not pl.alive then return jsonb_build_object('ok', false, 'reason', 'dead'); end if;
  if pl.sealed_round >= p_round then return jsonb_build_object('ok', false, 'reason', 'sealed'); end if;

  update autochess_players set ready_round = case when p_ready then p_round else 0 end
  where event_id = p_event_id and player_id = p_player_id;

  -- 還活著的真人:全部都準備好了嗎?
  select count(*), count(*) filter (where a.ready_round = p_round) into v_total, v_ready
  from autochess_players a join players pp on pp.id = a.player_id
  where a.event_id = p_event_id and a.alive and not coalesce(pp.is_bot, false);

  if p_ready and v_total > 0 and v_ready = v_total
     and not coalesce((clk->>'paused')::boolean, false) and (clk->>'left')::numeric > 3 then
    select rules->'autochess'->'run' into run from events where id = p_event_id;
    v_cur_prep := (clk->>'prepSec')::int;
    v_new_prep := ceil((clk->>'phaseElapsed')::numeric)::int + 2; -- 留 2 秒讓最後的存檔(自動補位)進得來
    if v_new_prep < v_cur_prep then
      v_extra := coalesce((run->'extra'->>(p_round::text))::int, 0) + (v_new_prep - v_cur_prep);
      perform autochess_set_run(p_event_id, jsonb_build_object(
        'extra', coalesce(run->'extra', '{}'::jsonb) || jsonb_build_object(p_round::text, v_extra)
      ));
      v_early := true;
    end if;
  end if;
  return jsonb_build_object('ok', true, 'ready', v_ready, 'total', v_total, 'early', v_early);
end;
$$;
