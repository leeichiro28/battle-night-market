-- ============================================
-- 全服 Boss「打烊鐘」(夜市大戰,見 docs 項目 17)
-- ============================================
-- 活動第 30 分鐘出現,存在 15 分鐘,被打倒就提早結束。全場共用一條血量。
-- 兩個人同時打:deal_career_world_boss 先 for update 鎖住 Boss 那一列再加傷害,不會互相覆蓋。
-- 領獎:claim_career_world_boss 先把 reward_claimed 翻成 true 再發獎,同一人不會領兩次。
-- 傷害數字由前端回報(整個專案的資料庫都是任何人可讀寫,只適合信任圈內的活動),
-- 資料庫端只做:單次傷害上限、冷卻秒數、Boss 存活期間才收。
create table if not exists career_world_boss (
  event_id uuid primary key references events(id) on delete cascade,
  max_hp bigint not null,
  damage_total bigint not null default 0,
  participants int not null default 0,
  spawned_at timestamptz not null default now(),
  ends_at timestamptz not null,
  defeated_at timestamptz
);
alter table career_world_boss enable row level security;
drop policy if exists "anon all career_world_boss" on career_world_boss;
create policy "anon all career_world_boss" on career_world_boss for all using (true) with check (true);

create table if not exists career_world_boss_damage (
  event_id uuid not null references events(id) on delete cascade,
  player_id uuid not null references players(id) on delete cascade,
  damage bigint not null default 0,
  hits int not null default 0,
  last_hit_at timestamptz,
  reward_claimed boolean not null default false,
  primary key (event_id, player_id)
);
alter table career_world_boss_damage enable row level security;
drop policy if exists "anon all career_world_boss_damage" on career_world_boss_damage;
create policy "anon all career_world_boss_damage" on career_world_boss_damage for all using (true) with check (true);

-- Boss 出現(第一個發現時間到了的人呼叫;已經有就什麼都不做)。血量 = 參加人數 × 每人血量,有下限。
create or replace function spawn_career_world_boss(p_event_id uuid, p_participants int, p_ends_at timestamptz)
returns jsonb
language plpgsql
as $$
declare
  HP_PER_PLAYER constant int := 15000;
  HP_MIN        constant int := 30000;
  b career_world_boss%rowtype;
  v_new boolean := false;
  v_cnt int;
begin
  insert into career_world_boss(event_id, max_hp, participants, ends_at)
  values (p_event_id, greatest(HP_MIN, greatest(p_participants, 1) * HP_PER_PLAYER), greatest(p_participants, 1), p_ends_at)
  on conflict (event_id) do nothing;
  get diagnostics v_cnt = row_count;
  v_new := v_cnt > 0;
  select * into b from career_world_boss where event_id = p_event_id;
  if v_new then
    insert into career_broadcasts(event_id, icon, message) values (p_event_id, 'bell-ring', '逼——。有東西來了。');
  end if;
  return jsonb_build_object('maxHp', b.max_hp, 'damageTotal', b.damage_total, 'endsAt', b.ends_at, 'defeatedAt', b.defeated_at, 'spawned', v_new);
end;
$$;

-- 回報一次出擊的傷害
create or replace function deal_career_world_boss(p_event_id uuid, p_player_id uuid, p_damage bigint)
returns jsonb
language plpgsql
as $$
declare
  MAX_HIT      constant bigint := 20000; -- 單次出擊傷害上限(模擬:Lv.100 約 2,300,留很大的空間給高裝備玩家)
  COOLDOWN_SEC constant int := 20;       -- 同一個人兩次出擊的最短間隔(前端顯示 30 秒,這裡留一點網路誤差)
  b career_world_boss%rowtype;
  d career_world_boss_damage%rowtype;
  v_dmg bigint;
  v_applied bigint;
  v_defeated boolean := false;
begin
  select * into b from career_world_boss where event_id = p_event_id for update;
  if b is null then
    return jsonb_build_object('accepted', false, 'reason', 'no_boss');
  end if;
  if b.defeated_at is not null or now() > b.ends_at then
    return jsonb_build_object('accepted', false, 'reason', 'ended', 'maxHp', b.max_hp, 'damageTotal', b.damage_total);
  end if;
  select * into d from career_world_boss_damage where event_id = p_event_id and player_id = p_player_id;
  if d.last_hit_at is not null and now() - d.last_hit_at < make_interval(secs => COOLDOWN_SEC) then
    return jsonb_build_object('accepted', false, 'reason', 'cooldown', 'maxHp', b.max_hp, 'damageTotal', b.damage_total);
  end if;
  v_dmg := greatest(0, least(coalesce(p_damage, 0), MAX_HIT));
  v_applied := least(v_dmg, b.max_hp - b.damage_total);
  update career_world_boss set damage_total = damage_total + v_applied,
    defeated_at = case when damage_total + v_applied >= max_hp then now() else defeated_at end
  where event_id = p_event_id
  returning * into b;
  v_defeated := b.defeated_at is not null;
  insert into career_world_boss_damage(event_id, player_id, damage, hits, last_hit_at)
  values (p_event_id, p_player_id, v_applied, 1, now())
  on conflict (event_id, player_id) do update
    set damage = career_world_boss_damage.damage + v_applied, hits = career_world_boss_damage.hits + 1, last_hit_at = now()
  returning * into d;
  if v_defeated then
    insert into career_broadcasts(event_id, icon, message)
    values (p_event_id, 'bell', '逼……(聲音變小了)老闆廣播:「欸，它不是壞的。它只是想叫人下班。」');
  end if;
  return jsonb_build_object('accepted', true, 'applied', v_applied, 'maxHp', b.max_hp, 'damageTotal', b.damage_total,
    'defeated', v_defeated, 'myDamage', d.damage, 'myHits', d.hits);
end;
$$;

-- 領獎:Boss 結束(被打倒或時間到)後,打過至少一次的人各領一次。
--   打倒:每人 50,000 幣 + 5 數值點 + 3 技能點;沒打倒:參加獎 10,000 幣。
--   貢獻排名(傷害高→低,同傷害先打完的在前):第 1 名 +100,000 幣(並由前端發稱號)、第 2 名 +50,000、第 3 名 +30,000。
create or replace function claim_career_world_boss(p_event_id uuid, p_player_id uuid)
returns jsonb
language plpgsql
as $$
declare
  WIN_COINS constant int := 50000;
  WIN_STAT_POINTS constant int := 5;
  WIN_SKILL_POINTS constant int := 3;
  JOIN_COINS constant int := 10000;
  RANK_COINS constant int[] := array[100000, 50000, 30000];
  b career_world_boss%rowtype;
  d career_world_boss_damage%rowtype;
  v_rank int;
  v_coins int := 0;
  v_stat int := 0;
  v_skill int := 0;
  v_win boolean;
begin
  select * into b from career_world_boss where event_id = p_event_id;
  if b is null then raise exception '這場活動沒有出現過打烊鐘'; end if;
  if b.defeated_at is null and now() <= b.ends_at then raise exception '打烊鐘還在，打完才能領獎'; end if;
  select * into d from career_world_boss_damage where event_id = p_event_id and player_id = p_player_id for update;
  if d is null or d.hits < 1 then raise exception '你沒有參加這一場夜市大戰'; end if;
  if d.reward_claimed then raise exception '這份獎勵已經領過了'; end if;
  update career_world_boss_damage set reward_claimed = true where event_id = p_event_id and player_id = p_player_id;

  select r into v_rank from (
    select player_id, row_number() over (order by damage desc, last_hit_at asc) as r
    from career_world_boss_damage where event_id = p_event_id and hits >= 1
  ) x where player_id = p_player_id;

  v_win := b.defeated_at is not null;
  if v_win then
    v_coins := WIN_COINS; v_stat := WIN_STAT_POINTS; v_skill := WIN_SKILL_POINTS;
  else
    v_coins := JOIN_COINS;
  end if;
  if v_rank between 1 and 3 then
    v_coins := v_coins + RANK_COINS[v_rank];
  end if;

  update career_progress set coins = coins + v_coins, stat_points = stat_points + v_stat, skill_points = skill_points + v_skill
  where event_id = p_event_id and player_id = p_player_id;

  return jsonb_build_object('defeated', v_win, 'rank', v_rank, 'myDamage', d.damage, 'coins', v_coins, 'statPoints', v_stat, 'skillPoints', v_skill);
end;
$$;
