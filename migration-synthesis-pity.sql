-- 合成保底:在 Supabase SQL Editor 執行一次即可(可重複執行，內容也已附加在 supabase-schema.sql 最後面)。
-- 合成失敗累積保底次數(依稀有度分開記，例如 {"rare": 2, "epic": 1})，成功後該稀有度歸零。
alter table career_progress add column if not exists synthesis_pity jsonb not null default '{}'::jsonb;
