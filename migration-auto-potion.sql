-- 刷層自動喝藥水:在 Supabase SQL Editor 執行一次即可(可重複執行，內容也已附加在 supabase-schema.sql 最後面)。
-- 設定存成 {"hp": true/false, "mp": true/false},預設都關;爬塔頁「設定」分頁有開關。
alter table career_progress add column if not exists auto_potion jsonb not null default '{}'::jsonb;
