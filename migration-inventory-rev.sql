-- 背包樂觀鎖:改用版本號比對，不再拿整個 inventory jsonb 當篩選條件。
-- 在 Supabase SQL Editor 執行一次即可(可重複執行)。

alter table career_progress add column if not exists inventory_rev int not null default 0;

create or replace function bump_inventory_rev() returns trigger as $$
begin
  if new.inventory is distinct from old.inventory then
    new.inventory_rev := old.inventory_rev + 1;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_bump_inventory_rev on career_progress;
create trigger trg_bump_inventory_rev
  before update on career_progress
  for each row execute function bump_inventory_rev();
