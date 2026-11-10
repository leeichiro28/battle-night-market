// 項目 19 階段 2:王戰喝藥水測試(假資料庫跑真正的 db.js + 引擎):node tools/boss-potion-test.js
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
const CE = sb.CareerEngine, CF = sb.CareerFloors;
(async () => {
  const stats = CD.applyProgress("warrior", {}, null);
  const pSide = { classKey: "warrior", stats: { ...stats }, skillLevel: 0, skill2Level: 0 };
  const floor = CF.getFloor(10);
  const mSide = { classKey: floor.classKey, stats: { ...floor.stats } };
  const mkState = (hp, mp) => CE.initialMatchState(pSide, mSide, { hp1: hp, mp1: mp });
  function setup(hp, mp, potions) {
    tables.career_progress.length = 0; tables.career_builds.length = 0;
    tables.career_builds.push({ id: "b1", event_id: "e1", player_id: "p1", final_class: "warrior" });
    const st = mkState(hp, mp);
    tables.career_progress.push({ id: "pr1", event_id: "e1", player_id: "p1", level: 10, stat_alloc: {}, equipment: {}, inventory: [], potions, coins: 0, current_hp: hp, current_mp: mp, highest_floor: 9, active_boss_battle: { floor: 10, state: st, started_at: new Date().toISOString() } });
    return st;
  }
  // 1. 引擎:item 動作 = 自己不出手,怪物照打
  let st = mkState(10, 5); st.m1 = { action: "item", text: "你喝下藥水" }; st.m2 = { action: "attack" };
  let r = CE.resolveRound(st).state;
  ok(r.hp2 === st.hp2, "引擎 item:玩家沒出手,怪物血量不變");
  ok(r.hp1 < 10, "引擎 item:怪物照常攻擊玩家");
  ok((r.log || []).some((l) => l.includes("你喝下藥水")), "引擎 item:戰報有喝藥水那行");
  // 2. 後端:喝血藥
  const before = setup(5, 5, { hp: 2, mp: 1 });
  let res = await db.submitCareerBossMove("e1", "p1", "potion:hp");
  const row = tables.career_progress[0];
  ok(row.potions.hp === 1, "喝血藥:扣掉一瓶(2→1)");
  ok(row.potions.mp === 1, "喝血藥:魔藥沒動");
  const ns = row.active_boss_battle && row.active_boss_battle.state;
  ok(ns && ns.hp2 === before.hp2, "喝血藥:怪物血量沒被打(玩家沒出手)");
  ok(ns && (ns.log || []).some((l) => l.includes("恢復了")), "喝血藥:戰報寫出恢復量");
  const healed = Math.round(before.maxhp1 * CF.POTIONS.hp.healRatio);
  ok(ns && ns.hp1 > 5 && ns.hp1 <= before.maxhp1, `喝血藥:HP 補到 ${ns && ns.hp1}(上限 ${before.maxhp1}，單瓶最多 +${healed}，扣掉關主這回合的傷害)`);
  // 3. 喝魔藥
  setup(before.maxhp1, 1, { hp: 0, mp: 1 });
  await db.submitCareerBossMove("e1", "p1", "potion:mp");
  const row2 = tables.career_progress[0];
  ok(row2.potions.mp === 0, "喝魔藥:扣掉一瓶");
  ok(row2.active_boss_battle.state.mp1 > 1, "喝魔藥:戰鬥中魔力增加");
  // 4. 錯誤情況
  setup(5, 5, { hp: 0, mp: 0 });
  let e = null; try { await db.submitCareerBossMove("e1", "p1", "potion:hp"); } catch (x) { e = x.message; }
  ok(e && e.includes("沒有"), "沒有藥水:丟錯,不會白送一回合");
  ok(tables.career_progress[0].active_boss_battle.state.round === 1, "沒有藥水:回合數沒動");
  setup(before.maxhp1, 5, { hp: 3, mp: 3 });
  e = null; try { await db.submitCareerBossMove("e1", "p1", "potion:hp"); } catch (x) { e = x.message; }
  ok(e && e.includes("滿"), "HP 已滿:不浪費藥水也不佔回合");
  ok(tables.career_progress[0].potions.hp === 3, "HP 已滿:藥水沒被扣");
  e = null; try { await db.submitCareerBossMove("e1", "p1", "potion:xx"); } catch (x) { e = x.message; }
  ok(!!e, "亂傳藥水種類:丟錯");
  // 5. 世界 Boss 不能喝
  setup(5, 5, { hp: 3, mp: 3 });
  tables.career_progress[0].active_boss_battle.worldBoss = true;
  e = null; try { await db.submitCareerBossMove("e1", "p1", "potion:hp"); } catch (x) { e = x.message; }
  ok(e && e.includes("打烊鐘"), "打烊鐘大戰:不能喝藥水");
  // 6. 畫面按鈕列
  const ctx3 = vm.createContext({ progress: { potions: { hp: 2, mp: 0 } }, CareerFloors: CF, bossSubmitted: false, ui: { esc: (s) => String(s), icon: (n) => `<i ${n}></i>` } });
  vm.runInContext(extract2("bossPotionRowHtml") + "\nthis.f=bossPotionRowHtml;", ctx3);
  let h = ctx3.f({ hp1: 5, maxhp1: 30, mp1: 3, maxmp1: 10 });
  ok(/id="boss-potion-hp"\s*>/.test(h) && /id="boss-potion-mp"\s+disabled/.test(h) && h.includes("沒有了"), "畫面:有血藥可按、沒魔藥停用並標示沒有了");
  h = ctx3.f({ hp1: 30, maxhp1: 30, mp1: 3, maxmp1: 10 });
  ok(/id="boss-potion-hp"\s+disabled/.test(h) && h.includes("HP 已滿"), "畫面:HP 已滿時血藥停用");
  console.log(process.exitCode ? "\n有失敗" : "\n全部通過");
})().catch((e) => { console.error(e); process.exit(1); });
function extract2(name) { const t = fs.readFileSync(root + "tower.js", "utf8"); const i = t.indexOf("function " + name + "("); let d = 0, j = t.indexOf("{", i); for (let k = j; k < t.length; k++) { if (t[k] === "{") d++; else if (t[k] === "}") { d--; if (d === 0) return t.slice(i, k + 1); } } }
