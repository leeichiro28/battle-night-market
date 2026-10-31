-- 遺物(攤位小物):這場活動撿到的護符,最多裝 3 個,每場活動重來(存在 career_progress,跟著活動走)
-- 形狀:{ "owned": ["old_number_tag", ...], "equipped": ["old_number_tag", ...] }
-- 可重複執行(add column if not exists),不會動到既有資料。
-- 還沒執行這份 SQL 時,爬塔頁「遺物」分頁會提示要先更新資料庫,其他功能不受影響(不會掉遺物)。
alter table career_progress add column if not exists relics jsonb not null default '{"owned":[],"equipped":[]}'::jsonb;
