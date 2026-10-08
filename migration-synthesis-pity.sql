-- 階段三:合成保底。記錄每個稀有度連續失敗幾次，例如 {"rare":2,"epic":1}。
-- 要先執行這份(內容同時附加在 supabase-schema.sql 最後面)，再上傳前端檔案。
alter table career_progress add column if not exists synthesis_pity jsonb not null default '{}'::jsonb;
