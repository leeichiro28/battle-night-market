-- ============================================
-- v58 夜市自走棋:補位機器人場「真人全部淘汰就結束」
-- 在 Supabase SQL Editor 執行一次即可(可重複執行)。只是 create or replace 一個函式(autochess_settle_round),不動資料表。
-- 沒跑這份的話,補位機器人場在真人都被淘汰後,會讓機器人繼續互打到只剩一隻(或時間到)才結束,其他功能不受影響。
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
  v_humans int;
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
    -- 補位機器人場:真人全部淘汰就直接結束(不必讓機器人互打到只剩一隻);場內本來就沒有真人(純機器人)則照舊
    select count(*) into v_humans from autochess_players a join players pp on pp.id = a.player_id
    where a.event_id = p_event_id and a.alive and not coalesce(pp.is_bot, false);
    clk := autochess_clock(p_event_id);
    if v_alive <= 1 then
      perform autochess_finish(p_event_id, 'last_one');
    elsif v_humans = 0 and exists (select 1 from autochess_players a join players pp on pp.id = a.player_id where a.event_id = p_event_id and not coalesce(pp.is_bot, false)) then
      perform autochess_finish(p_event_id, 'no_humans');
    elsif coalesce((clk->>'over')::boolean, false) then
      perform autochess_finish(p_event_id, 'timeout');
    end if;
    return jsonb_build_object('ok', true, 'roundDone', true, 'alive', v_alive);
  end if;
  return jsonb_build_object('ok', true, 'roundDone', false);
end;
$$;
