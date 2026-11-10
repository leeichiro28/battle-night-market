// 項目 19 階段 3:刷層自動喝藥水測試(假資料庫跑真正的 db.js):node tools/auto-potion-test.js
const fs = require("fs"), vm = require("vm");
const root = require("path").join(__dirname, "..", "assets") + "/";
// ---- 假資料庫:in-memory 表 + 簡易查詢器 ----
const tables = { career_progress: [], career_builds: [], career_player_skills: [], events: [{ id: "e1", status: "open", rules: {} }] };
function qb(name) {
  const st = { name, filters: [], patch: null, insert: null, single: false };
  const run = () => {
    const rows = tables[name] || [];
    if (st.upsert) { const ex = rows.find((r) => r.event_id === st.upsert.event_id && r.player_id === st.upsert.player_id); if (ex) { Object.assign(ex, st.upsert); return { data: [ex], error: null }; } const row = { id: "r" + (rows.length + 1), ...st.upsert }; rows.push(row); return { data: [row], error: null }; }
    if (st.insert) { const row = { id: "r" + (rows.length + 1), ...st.insert }; rows.push(row); return { data: [row], error: null }; }
    let m = rows.filter((r) => st.filters.every(([k, v]) => r[k] === v));
    if (st.patch) { m.forEach((r) => Object.assign(r, st.patch)); }
    return { data: m, error: null };
  };
  const api = {
    select() { return api; }, eq(k, v) { st.filters.push([k, v]); return api; }, in() { return api; }, order() { return api; }, limit() { return api; },
    update(p) { st.patch = p; return api; }, insert(r) { st.insert = r; return api; }, upsert(r) { st.upsert = r; return api; },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
    single() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: r.data[0] ? null : { message: "no rows" } }); },
    then(res) { return res(run()); },
  };
  return api;
}
const client = { from: qb, rpc: () => Promise.resolve({ data: null, error: null }) };
const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Math, Date, JSON, Promise, Object, Array, Set, Map, String, Number, Error, AbortController,
  document: { getElementById: () => null, createElement: () => ({}), body: { appendChild() {} }, addEventListener() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
sb.window = sb; sb.SUPABASE_URL = "x"; sb.SUPABASE_ANON_KEY = "y"; sb.supabase = { createClient: () => client };
vm.createContext(sb);
["career-data.js", "career-spec.js", "career-floors.js", "career-events.js", "career-missions.js", "career-story.js", "career-codex.js", "career-engine.js", "career-pve.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
const src = fs.readFileSync(root + "db.js", "utf8");
vm.runInContext(src + "\n;window.db = db;", sb, { filename: "db.js" });
const db = sb.db, SP = sb.CareerSpec, CD = sb.CareerData;
// 抽出內部函式 _engineSide 以便直接測(用括號配對取出函式本體)
function extract(name) { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } } }
const ctx2 = vm.createContext({ window: sb, console, Object, Math });
vm.runInContext(extract("_equipEffectBonus") + "\n" + extract("_engineSide") + "\nthis.f=_engineSide;", ctx2);
const engineSide = ctx2.f;



const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const CF = sb.CareerFloors;
Math.random = () => 0.99; // 不觸發隨機事件
(async () => {
  const stats = CD.applyProgress("warrior", {}, null);
  const maxHp = stats.maxHp, maxMp = stats.maxMp;
  function setup(over) {
    tables.career_progress.length = 0; tables.career_builds.length = 0;
    tables.career_builds.push({ id: "b1", event_id: "e1", player_id: "p1", final_class: "warrior" });
    tables.career_progress.push({ id: "pr1", event_id: "e1", player_id: "p1", level: 10, stat_alloc: {}, equipment: {}, inventory: [], potions: { hp: 5, mp: 5 }, coins: 0, exp: 0, stat_points: 0, skill_points: 0, floor: 5, current_hp: 2, current_mp: 1, auto_potion: {}, mission_state: {}, ...over });
    return tables.career_progress[0];
  }
  let row;
  // 1. 設定函式
  row = setup({});
  await db.setCareerAutoPotion("e1", "p1", { hp: true, mp: false });
  ok(row.auto_potion.hp === true && row.auto_potion.mp === false, "設定:開血藥、關魔藥存進 auto_potion");
  await db.setCareerAutoPotion("e1", "p1", { hp: true, mp: true });
  ok(row.auto_potion.mp === true, "設定:再開魔藥");
  row = setup({}); delete row.auto_potion;
  let e = null; try { await db.setCareerAutoPotion("e1", "p1", { hp: true }); } catch (x) { e = x.message; }
  ok(e && e.includes("migration-auto-potion.sql"), "資料庫沒有欄位:丟出請跑 migration 的清楚訊息");

  // 2. 掛機:預設關 → 不喝藥水
  row = setup({ current_hp: 2, current_mp: 1 });
  await db.toggleCareerAutoFarm("e1", "p1", 5);
  ok(row.potions.hp === 5 && row.potions.mp === 5, "掛機、開關預設關:一瓶都不喝");
  ok(row.auto_farm_last_result && row.auto_farm_last_result.potionsTotal === 0, "掛機、開關關:累計喝藥 0 瓶");

  // 3. 掛機:開血藥 → 喝血藥,魔藥沒開不動
  row = setup({ current_hp: 2, current_mp: 1, auto_potion: { hp: true, mp: false } });
  await db.toggleCareerAutoFarm("e1", "p1", 5);
  const usedHp = 5 - row.potions.hp;
  ok(usedHp >= 1 && usedHp <= 3, `掛機、開血藥、HP 很低:喝了 ${usedHp} 瓶(每場最多 3 瓶)`);
  ok(row.potions.mp === 5, "掛機、只開血藥:魔藥沒動");
  ok(row.auto_farm_last_result.potionsUsed.hp === usedHp && row.auto_farm_last_result.potionsTotal === usedHp, "掛機結果記下這場與累計喝了幾瓶");

  // 4. 掛機:開魔藥,魔力低 → 喝魔藥
  row = setup({ current_hp: maxHp, current_mp: 1, auto_potion: { hp: false, mp: true } });
  await db.toggleCareerAutoFarm("e1", "p1", 5);
  ok(5 - row.potions.mp >= 1 && row.potions.hp === 5, "掛機、開魔藥、魔力低:喝魔藥,血藥沒動");

  // 5. 沒藥水、血量夠:不喝
  row = setup({ current_hp: maxHp, current_mp: maxMp, auto_potion: { hp: true, mp: true } });
  await db.toggleCareerAutoFarm("e1", "p1", 5);
  ok(row.potions.hp === 5 && row.potions.mp === 5, "HP/魔力都夠:不浪費藥水");
  row = setup({ current_hp: 2, current_mp: 1, potions: { hp: 0, mp: 0 }, auto_potion: { hp: true, mp: true } });
  await db.toggleCareerAutoFarm("e1", "p1", 5);
  ok(row.potions.hp === 0 && row.potions.mp === 0 && row.auto_farm_last_result.potionsTotal === 0, "沒有藥水:不會變負數、也不自動買");

  // 6. 手動重複挑戰已通關樓層:套用;挑戰新樓層(首通):不套用
  row = setup({ current_hp: 2, current_mp: 1, floor: 5, auto_potion: { hp: true, mp: true } });
  let res = await db.challengeCareerFloor("e1", "p1", 3);
  ok(5 - row.potions.hp >= 1 && res.potionsUsed && res.potionsUsed.hp >= 1, "重複挑戰已通關的第 3 層:自動喝藥水,結果回報瓶數");
  row = setup({ current_hp: 2, current_mp: 1, floor: 5, auto_potion: { hp: true, mp: true } });
  res = await db.challengeCareerFloor("e1", "p1", 6);
  ok(row.potions.hp === 5 && row.potions.mp === 5 && !res.potionsUsed, "挑戰沒通關過的新樓層(首通):不自動喝");
  row = setup({ current_hp: 2, current_mp: 1, floor: 5, auto_potion: {} });
  await db.challengeCareerFloor("e1", "p1", 3);
  ok(row.potions.hp === 5 && row.potions.mp === 5, "重複挑戰、開關關:不喝");
  // 7. 畫面:設定分頁區塊 + 掛機狀態列提示
  const mk = (prog) => { const c = vm.createContext({ progress: prog, CareerFloors: CF, busy: false, ui: { esc: (x) => String(x), icon: (n) => `<i ${n}></i>` } }); vm.runInContext(extract2("renderAutoPotionSection") + extract2("autoPotionNote") + "\nthis.sec=renderAutoPotionSection;this.note=autoPotionNote;", c); return c; };
  let c = mk({ potions: { hp: 3, mp: 0 }, auto_potion: { hp: true, mp: false } });
  let h = c.sec();
  ok(/data-auto-potion="hp" aria-pressed="true"\s*>/.test(h) && h.includes("已開啟") && /data-auto-potion="mp" aria-pressed="false"/.test(h), "畫面:血藥開、魔藥關,兩顆按鈕狀態正確");
  ok(!h.includes("migration-auto-potion.sql"), "畫面:欄位存在時不顯示 SQL 提示");
  c = mk({ potions: { hp: 3, mp: 0 } }); h = c.sec();
  ok(h.includes("migration-auto-potion.sql") && /data-auto-potion="hp"[^>]*disabled/.test(h), "畫面:沒有欄位時按鈕停用並提示要跑 SQL");
  c = mk({ potions: { hp: 0, mp: 2 }, auto_potion: { hp: true, mp: true } });
  h = c.note({ potionsTotal: 4 });
  ok(h.includes("已自動喝了 4 瓶") && h.includes("恢復藥水用完了") && !h.includes("魔力藥水用完了"), "掛機狀態列:顯示累計瓶數與哪種藥水用完了");
  ok(mk({ potions: { hp: 1, mp: 1 }, auto_potion: {} }).note({ potionsTotal: 0 }) === "", "開關關且沒喝過:狀態列不多加字");
  console.log(process.exitCode ? "\n有失敗" : "\n全部通過");
})().catch((e) => { console.error(e); process.exit(1); });

function extract2(name) { const t = fs.readFileSync(root + "tower.js", "utf8"); const i = t.indexOf("function " + name + "("); let d = 0, j = t.indexOf("{", i); for (let k = j; k < t.length; k++) { if (t[k] === "{") d++; else if (t[k] === "}") { d--; if (d === 0) return t.slice(i, k + 1) + "\n"; } } }
