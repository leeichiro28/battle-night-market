// 專精的解鎖、互斥、裝備、換職業與對戰 side 測試(用假資料庫跑真正的 db.js):node tools/spec-db-test.js
const fs = require("fs"), vm = require("vm");
const root = require("path").join(__dirname, "..", "assets") + "/";
// ---- 假資料庫:in-memory 表 + 簡易查詢器 ----
const tables = { career_progress: [], career_builds: [], career_player_skills: [] };
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
["career-data.js", "career-spec.js", "career-floors.js", "career-events.js", "career-missions.js", "career-story.js", "career-codex.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
const src = fs.readFileSync(root + "db.js", "utf8");
vm.runInContext(src + "\n;window.db = db;", sb, { filename: "db.js" });
const db = sb.db, SP = sb.CareerSpec, CD = sb.CareerData;
// 抽出內部函式 _engineSide 以便直接測(用括號配對取出函式本體)
function extract(name) { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } } }
const ctx2 = vm.createContext({ window: sb, console, Object, Math });
vm.runInContext(extract("_equipEffectBonus") + "\n" + extract("_engineSide") + "\nthis.f=_engineSide;", ctx2);
const engineSide = ctx2.f;

const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const fails = async (fn, re, m) => { try { await fn(); ok(false, m + "(應該要失敗卻成功了)"); } catch (e) { ok(re.test(e.message), `${m} → ${e.message}`); } };
(async () => {
  tables.career_builds.push({ id: "b1", event_id: "e", player_id: "p", final_class: "warrior", path: "strength" });
  const prog = { id: "pr1", event_id: "e", player_id: "p", level: 49, skill_points: 10, active_skills: { ult_1: 1 }, equipped_skill_a: "skill_1", equipped_skill_b: "skill_2", floor: 5, equipment: {} };
  tables.career_progress.push(prog);
  // getCareerBuildFor / getOrCreateCareerProgress 可能多查其他東西,先確認能取到
  await fails(() => db.upgradeActiveSkill("e", "p", "spec_a"), /Lv\.50/, "Lv.49 不能選專精");
  prog.level = 50;
  let r = await db.upgradeActiveSkill("e", "p", "spec_a");
  ok(prog.active_skills.spec_a === 1 && prog.skill_points === 9, `Lv.50 可以選專精 A,花 1 點(剩 ${prog.skill_points})`);
  await fails(() => db.upgradeActiveSkill("e", "p", "spec_a"), /已經選過/, "同一條不能重複選");
  await fails(() => db.upgradeActiveSkill("e", "p", "spec_b"), /不能改選|另一條/, "另一條互斥,不能改選");
  await db.upgradeActiveSkill("e", "p", "spec_a_skill_1");
  ok(prog.active_skills.spec_a_skill_1 === 1, "選了分支後可以學專精技能");
  await fails(() => db.upgradeActiveSkill("e", "p", "spec_b_skill_1"), /先選擇|不能/, "沒選的那條分支技能不能學");
  await db.upgradeActiveSkill("e", "p", "spec_a_skill_1"); await db.upgradeActiveSkill("e", "p", "spec_a_skill_1");
  ok(prog.active_skills.spec_a_skill_1 === 3, "專精技能可以升級");
  prog.skill_points = 0; await fails(() => db.upgradeActiveSkill("e", "p", "spec_a_skill_2"), /沒有可以花的技能點/, "沒技能點不能學");
  prog.skill_points = 20;
  await db.upgradeActiveSkill("e", "p", "spec_a_skill_1"); // Lv.4 需要角色 Lv.50(已達成)
  ok(prog.active_skills.spec_a_skill_1 === 4, "專精技能 Lv.4(角色 Lv.50 夠)");
  await fails(() => db.upgradeActiveSkill("e", "p", "spec_a_skill_1"), /角色等級/, "專精技能 Lv.5 需要角色 Lv." + CD.skillLevelCharReq(5) + ",Lv.50 不夠");
  await fails(() => db.upgradeActiveSkill("e", "p", "spec_c"), /不認識/, "亂寫的後綴會被擋");
  // 戰士以外:守衛沒選過
  // 換職業:專精要清掉、技能點退還、裝備欄換回預設
  prog.skill_points = 3; prog.equipped_skill_b = "spec_a_skill_1"; prog.stat_alloc = {};
  const refundExpect = 3 + prog.active_skills.spec_a + prog.active_skills.spec_a_skill_1;
  await db.transferCareerFinalClass("e", "p", "guardian", "strength", []);
  ok(!Object.keys(prog.active_skills).some((k) => /^spec_/.test(k)), "換職業後專精全部清掉");
  ok(prog.skill_points === refundExpect, `已花的技能點退還(3 + 1 分支 + 4 技能等級 = ${refundExpect},實際 ${prog.skill_points})`);
  ok(prog.equipped_skill_b === "skill_2", "裝備欄的專精技能換回預設技能");
  ok(prog.active_skills.ult_1 === 1, "其他技能等級不受影響");
  tables.career_builds[0].final_class = "warrior";
  prog.active_skills = { ult_1: 1, skill_1: 1, skill_2: 1, spec_a: 1, spec_a_skill_1: 2 }; prog.skill_points = 20; prog.equipped_skill_b = "skill_2";
  // 見習(沒有專精)
  tables.career_builds[0].final_class = "novice_strength";
  await fails(() => db.upgradeActiveSkill("e", "p", "spec_b"), /還沒有專精/, "見習階段沒有專精");
  tables.career_builds[0].final_class = "warrior";

  // ---- 裝備專精技能 ----
  prog.active_skills = { ult_1: 1, skill_1: 1, skill_2: 1, spec_a: 1, spec_a_skill_1: 2 }; prog.equipped_skill_a = "skill_1"; prog.equipped_skill_b = "skill_2";
  await db.setEquippedSkill("e", "p", "b", "spec_a_skill_1");
  ok(prog.equipped_skill_b === "spec_a_skill_1", "可以把專精技能裝到 B 欄");
  await fails(() => db.setEquippedSkill("e", "p", "a", "spec_a_skill_2"), /先花技能點|解鎖/, "沒學過的專精技能不能裝");
  await fails(() => db.setEquippedSkill("e", "p", "a", "spec_b_skill_1"), /先花技能點|不是你目前職業/, "沒選的那條分支的技能不能裝");
  await fails(() => db.setEquippedSkill("e", "p", "a", "spec_a_skill_1"), /同一個|另一個欄位/, "同一個技能不能同時裝兩欄");

  // ---- 組出對戰用的 side ----
  const stats = CD.applyProgress("warrior", { atk: 10 }, null);
  const active = { ult_1: 1, skill_1: 2, skill_2: 1, spec_a: 1, spec_a_skill_1: 2 };
  let side = engineSide("warrior", stats, {}, active, "skill_1", "spec_a_skill_1", "warrior_ult_1", {}, 60);
  ok(side.spec && side.spec.branch === "a" && side.spec.tier === 1, "side 帶出專精被動(Lv.60 未升階)");
  ok(side.skillEffectB && side.skillEffectB.name === "碎甲重擊" && side.skillEffectA === null, "裝在 B 欄的專精技能帶出效果,A 欄(一般技能)沒有");
  ok(side.skillLevel === 2 && side.skill2Level === 2 && side.skillBName === "碎甲重擊", "技能等級與名稱正確");
  side = engineSide("warrior", stats, {}, active, "skill_1", "spec_a_skill_1", "warrior_ult_1", {}, 100);
  ok(side.spec.tier === 2 && side.skillEffectB.mult > 0, "Lv.100 升階");
  side = engineSide("warrior", stats, {}, { ult_1: 1, skill_1: 1, skill_2: 1 }, "skill_1", "skill_2", "warrior_ult_1", {}, 80);
  ok(side.spec === null && side.skillEffectA === null && side.skillEffectB === null, "沒選專精:side 沒有專精欄位(跟以前完全一樣)");
  side = engineSide("novice", stats, {}, {}, null, null, null, {}, 10);
  ok(side.spec === null, "見習階段沒有專精");
  // 沒載入 CareerSpec 的頁面
  const ctx3 = vm.createContext({ window: { CareerData: CD }, console, Object, Math });
  vm.runInContext(extract("_equipEffectBonus") + "\n" + extract("_engineSide") + "\nthis.f=_engineSide;", ctx3);
  side = ctx3.f("warrior", stats, {}, active, "skill_1", "spec_a_skill_1", "warrior_ult_1", {}, 60);
  ok(side.spec === null && side.skillEffectB === null, "頁面沒載入 career-spec.js 時不會壞(當作沒專精)");
  console.log(process.exitCode ? "\n有失敗" : "\n全部通過");
})().catch((e) => { console.error("測試崩潰", e); process.exit(1); });
