-- 成就與圖鑑(永久、記在玩家帳號上，不屬於任何一場活動):在 Supabase SQL Editor 執行一次即可(可重複執行)。
-- 內容也已附加在 supabase-schema.sql 最後面，重跑整份 schema 效果相同。
--
-- kind 種類:
--   ach    成就(entry_key = 成就 key，times = 1，只記第一次達成)
--   mon    怪物圖鑑(entry_key = 樓層數，times = 打贏幾次)
--   item   裝備圖鑑(entry_key = 裝備名稱，times = 1)
--   event  夜市事件圖鑑(entry_key = 事件 key，times = 1)
--   stat   永久累計數字(entry_key = pveWins / pvpWins / synthSuccess / synthLegend / revive，times = 累計值)
--   pvpm   PVP 場次防重複(entry_key = 場次 id，只用來避免同一場結果被重複計入 stat)
-- 每個 key 的名稱與說明都放在前端 assets/career-codex.js，資料表不需要跟著改。
create table if not exists career_codex (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references players(id) on delete cascade,
  kind text not null,
  entry_key text not null,
  times int not null default 1,
  first_event_id uuid references events(id) on delete set null,
  first_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  unique (player_id, kind, entry_key)
);
alter table career_codex enable row level security;
drop policy if exists "anon all career_codex" on career_codex;
create policy "anon all career_codex" on career_codex for all using (true) with check (true);

-- 一次寫入多筆。p_items = [{"kind":"mon","key":"12","inc":3,"once":false}, ...]
--   once = true:已經有就不動(用在成就、裝備、事件、場次防重複);false:次數 += inc。
-- 回傳每筆的 {kind,key,times,is_new}。on conflict 一次完成，兩個分頁同時寫同一筆不會撞 unique 噴錯。
create or replace function record_career_codex(p_player_id uuid, p_event_id uuid, p_items jsonb)
returns jsonb
language plpgsql
as $$
declare
  it jsonb;
  v_kind text;
  v_key text;
  v_inc int;
  v_once boolean;
  v_new boolean;
  v_times int;
  v_out jsonb := '[]'::jsonb;
begin
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb))
  loop
    v_kind := it->>'kind';
    v_key := it->>'key';
    v_inc := greatest(1, coalesce((it->>'inc')::int, 1));
    v_once := coalesce((it->>'once')::boolean, false);
    if v_kind is null or v_key is null then
      continue;
    end if;
    insert into career_codex as cc (player_id, kind, entry_key, times, first_event_id)
    values (p_player_id, v_kind, v_key, v_inc, p_event_id)
    on conflict (player_id, kind, entry_key) do update
      set times = case when v_once then cc.times else cc.times + v_inc end,
          last_at = now()
    returning (xmax = 0), cc.times into v_new, v_times;
    v_out := v_out || jsonb_build_object('kind', v_kind, 'key', v_key, 'times', v_times, 'is_new', v_new);
  end loop;
  return v_out;
end;
$$;
