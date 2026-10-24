-- 每場任務:在 Supabase SQL Editor 執行一次即可(可重複執行)。
-- 也要重新執行 migration-pvp-afk-and-score.sql(finish_career_match 會記錄最高連勝與「贏過積分比自己高的對手」次數)。
-- 任務進度/已領紀錄、任務積分，以及任務要用到的兩個 PVP 統計(最高連勝、贏過積分比自己高的次數)。
alter table career_progress add column if not exists mission_state jsonb not null default '{}'::jsonb;
alter table career_progress add column if not exists mission_score int not null default 0;
alter table career_pvp_queue add column if not exists best_streak int not null default 0;
alter table career_pvp_queue add column if not exists beat_higher int not null default 0;
