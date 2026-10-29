// 51~70 層與階級裝備、60/70 層套裝效果測試:node tools/floors-test.js
// 驗證 career-floors.js(樓層、掉落、階級裝備)、career-engine.js(保命/首回合必爆)、db.js(套裝效果帶進對戰、合成保留階級)。
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..", "assets") + "/";
// ---- 假資料庫(跟 spec 測試同一種) ----
const tables = { career_progress: [], career_builds: [], events: [{ id: "e", status: "active", type: "career", end_time: null, rules: {} }] };
function qb(name) {
  const st = { filters: [], patch: null, insert: null, upsert: null };
  const run = () => {
    const rows = tables[name] || [];
    if (st.upsert) { const ex = rows.find((r) => r.event_id === st.upsert.event_id && r.player_id === st.upsert.player_id); if (ex) { Object.assign(ex, st.upsert); return { data: [ex], error: null }; } const row = { id: "r" + (rows.length + 1), ...st.upsert }; rows.push(row); return { data: [row], error: null }; }
    if (st.insert) { const row = { id: "r" + (rows.length + 1), ...st.insert }; rows.push(row); return { data: [row], error: null }; }
    const m = rows.filter((r) => st.filters.every(([k, v]) => r[k] === v));
    if (st.patch) m.forEach((r) => Object.assign(r, st.patch));
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
["career-data.js", "career-spec.js", "career-engine.js", "career-floors.js", "career-events.js", "career-missions.js", "career-story.js", "career-pve.js", "career-codex.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
const src = fs.readFileSync(root + "db.js", "utf8");
vm.runInContext(src + "\n;window.db = db;", sb, { filename: "db.js" });
const CF = sb.CareerFloors, CD = sb.CareerData, E = sb.CareerEngine, db = sb.db;
function extract(name) { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } } }
const ctx2 = vm.createContext({ window: sb, console, Object, Math });
vm.runInContext(extract("_equipEffectBonus") + "\nthis.f=_equipEffectBonus;", ctx2);
const equipBonus = ctx2.f;
function seed(s) { Math.random = function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const fails = async (fn, re, m) => { try { await fn(); ok(false, m + "(應該失敗)"); } catch (e) { ok(re.test(e.message), `${m} → ${e.message}`); } };

(async () => {
  // ---- 樓層資料 ----
  ok(CF.FLOORS.length === 70 && CF.getFloor(70) && !CF.getFloor(71), "樓層共 70 層");
  ok(CF.getFloor(60).name === "相片攤老闆·阿旺" && CF.getFloor(70).name === "第零攤", "60/70 層關主名字");
  ok(CF.getFloor(60).isMiniBoss && CF.getFloor(70).isMiniBoss && !CF.getFloor(65).isMiniBoss, "60/70 是關主層");
  ok(CF.getFloor(60).story && CF.getFloor(60).story.pre && CF.getFloor(60).story.post && CF.getFloor(70).story.post.includes("下一位"), "60/70 層有戰前戰後對話");
  const names = new Set(); for (let n = 51; n <= 69; n++) if (n % 10) names.add(CF.getFloor(n).name);
  ok(names.size === 12 && [...names].every((x) => !/\(\d+層關主\)/.test(x)), `51~69 層一般怪名稱(${names.size} 種)`);
  const mono = (a, b, k) => CF.getFloor(b).stats[k] >= CF.getFloor(a).stats[k];
  ok(mono(50, 51, "atk") && mono(51, 55, "atk") && mono(55, 59, "hp") && mono(61, 65, "hp") && mono(65, 69, "atk"), "怪物強度隨樓層上升(含 50→51 沒有倒退)");
  ok(CF.getFloor(51).stats.hp > CF.getFloor(50).stats.hp * 2.5, `51 層比 50 層明顯變難(HP ${CF.getFloor(50).stats.hp} → ${CF.getFloor(51).stats.hp})`);
  ok(CF.floorScore(70) === 105, "爬到 70 層的爬塔分 = 105");

  // ---- 階級裝備 ----
  ok(CF.floorTier(50) === 1 && CF.floorTier(51) === 2 && CF.floorTier(60) === 2 && CF.floorTier(61) === 3 && CF.floorTier(70) === 3, "階級對照:≤50 夜市階、51~60 招牌階、61~70 塔心階");
  const allNames = []; [2, 3].forEach((t) => { Object.values(CF.WEAPON_TABLE_TIER[t]).forEach((cl) => Object.values(cl).forEach((l) => l.forEach((i) => allNames.push(i.name)))); ["armor", "accessory"].forEach((sl) => Object.values(CF.EQUIPMENT_TABLE_TIER[t][sl]).forEach((l) => l.forEach((i) => allNames.push(i.name)))); });
  ok(allNames.length === 60 && new Set(allNames).size === 60, `階級裝備共 ${allNames.length} 款、名稱不重複`);
  const baseNames = new Set(); Object.values(CF.WEAPON_TABLE).forEach((cl) => Object.values(cl).forEach((l) => l.forEach((i) => baseNames.add(i.name)))); ["armor", "accessory"].forEach((sl) => Object.values(CF.EQUIPMENT_TABLE[sl]).forEach((l) => l.forEach((i) => baseNames.add(i.name))));
  ok(allNames.every((n) => !baseNames.has(n)), "階級裝備的名字不跟夜市階撞名(圖鑑用名字當 key)");
  const t1 = CF.WEAPON_TABLE.warrior.epic[0].statValue, t2 = CF.WEAPON_TABLE_TIER[2].warrior.epic[0].statValue, t3 = CF.WEAPON_TABLE_TIER[3].warrior.epic[0].statValue;
  ok(t1 < t2 && t2 < t3, `史詩武器數值逐階提高(${t1} → ${t2} → ${t3})`);
  ok(CF.WEAPON_TABLE_TIER[2].mage.rare[0].statKey === "matk" && CF.WEAPON_TABLE_TIER[2].warrior.rare[0].statKey === "atk", "法師武器是魔攻、戰士是攻擊");

  // ---- 掉落 ----
  const drops = (floor, cls, n) => { const out = []; for (let i = 0; i < n; i++) { const d = CF.rollDrop({ ...CF.getFloor(floor), dropChance: 1 }, cls, 0); if (d) out.push(d); } return out; };
  seed(1); let d55 = drops(55, "warrior", 300), d65 = drops(65, "mage", 300), d50 = drops(49, "warrior", 100);
  ok(d55.every((d) => d.tier === 2) && d55.every((d) => ["common", "rare"].includes(d.rarity)), "55 層掉招牌階普通/稀有");
  ok(d65.every((d) => d.tier === 3) && d65.some((d) => d.slot === "weapon" && d.statKey === "matk"), "65 層掉塔心階,法師拿到魔攻武器");
  ok(d50.every((d) => !d.tier), "49 層掉的還是夜市階(沒有 tier)");
  ok(d55.every((d) => d.reqLevel === 55) && d65.every((d) => d.reqLevel === 65), "等級門檻 = 樓層數");
  seed(2); const d60 = drops(60, "warrior", 400), d70 = drops(70, "healer", 400);
  const leg60 = d60.filter((d) => d.rarity === "legendary"), leg70 = d70.filter((d) => d.rarity === "legendary");
  ok(leg60.length > 100 && leg60.every((d) => d.setKey === "boss60" && d.bossExclusive), `60 層 Boss 掉舊相片套裝(${leg60.length}/400 件傳說)`);
  ok(leg70.length > 100 && leg70.every((d) => d.setKey === "boss70"), "70 層 Boss 掉第零攤套裝");
  ok(leg60.filter((d) => d.slot === "weapon").every((d) => d.name === "阿旺的三腳架巨斧") && leg70.filter((d) => d.slot === "weapon").every((d) => d.name === "第零攤的點亮法球"), "Boss 武器名稱依職業(戰士/巫醫)");
  ok(d60.filter((d) => d.rarity === "epic").every((d) => d.tier === 2) && d70.filter((d) => d.rarity === "epic").every((d) => d.tier === 3), "Boss 層的史詩是對應階級");
  ok(CF.describeItem(d55[0]).startsWith("招牌階"), "裝備說明會標示階級:" + CF.describeItem(d55[0]));

  // ---- 套裝效果進對戰資料 ----
  const bset = (key, extra) => { const L = CF.BOSS_LEGENDARY_ITEMS[key]; return { weapon: { ...L.weapon, ...(extra || {}) }, armor: L.armor, accessory: L.accessory }; };
  const b60 = equipBonus(bset(60)), b70 = equipBonus(bset(70)), b40 = equipBonus(bset(40));
  ok(b60.surviveOnce > 0 && b60.firstRoundCrit === 0 && b70.firstRoundCrit > 0 && b70.surviveOnce === 0, "湊齊 60 層套裝 → 保命;70 層套裝 → 首回合必爆");
  ok(!(b40.surviveOnce > 0) && !(b40.firstRoundCrit > 0), "40 層套裝沒有這兩個效果");
  const mixed = bset(60); mixed.accessory = CF.BOSS_LEGENDARY_ITEMS[70].accessory;
  ok(equipBonus(mixed).surviveOnce === 0, "只湊兩件、或混搭不同套,不會觸發套裝效果");
  ok(b60.dmgReduceRatio > 0.1 && b70.critDmgBonus > 0.3, "單件效果照常累加");

  // ---- 引擎:保命 ----
  function stats(c, lv, o) { const pts = Math.floor(lv * 1.2); const a = { atk: pts, def: 0, hp: 0 }; const s = CD.applyProgress(c, a, null); Object.assign(s, o || {}); s.maxHp = s.hp; return s; }
  const mkSide = (c, st, extra) => ({ classKey: c, stats: st, skillLevel: 1, skill2Level: 1, ultEffect: CD.resolveUltInfo(c, null, 1).effect, ultName: "x", critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0, ultCostReduce: 0, mastery: {}, lifestealOnHit: 0, dmgReduceRatio: 0, ...(extra || {}) });
  const killer = stats("warrior", 100, { atk: 9999, spd: 99, hp: 99999 }), fragile = stats("warrior", 100, { hp: 50, spd: 1 });
  const round = (st, a1, a2) => E.resolveRound({ ...st, m1: { action: a1 }, m2: { action: a2 } });
  seed(3); let st = E.initialMatchState(mkSide("warrior", fragile, { surviveOnce: true }), mkSide("warrior", killer));
  let r = round(st, "defend", "attack");
  ok(r.state.hp1 === 1 && r.events.some((e) => e.type === "survive") && r.state.surviveUsed1 === true, "致命傷害 → 保留 1 點 HP,並記錄用掉了");
  const evTypes = r.events.map((e) => e.type); const iSurvive = evTypes.indexOf("survive");
  ok(iSurvive > 0 && r.events[iSurvive - 1].type === "attack" && r.events[iSurvive - 1].dmg > 1000, "紀錄順序:先被打、再「撐住了」");
  r = round(r.state, "defend", "attack");
  ok(r.state.hp1 <= 0, "第二次致命傷害就真的倒下(每場一次)");
  seed(3); st = E.initialMatchState(mkSide("warrior", fragile), mkSide("warrior", killer)); r = round(st, "defend", "attack");
  ok(r.state.hp1 <= 0 && !r.events.some((e) => e.type === "survive"), "沒有套裝時行為不變(直接倒下)");
  // 保命也要擋反震/毒傷之類的致命傷害(任何扣血處)
  const harmless = stats("warrior", 100, { atk: 0, hp: 99999 }); // 不會造成致命傷害的對手,這樣保命只會被毒傷觸發
  seed(4); st = E.initialMatchState(mkSide("warrior", { ...fragile, hp: 80, maxHp: 80 }, { surviveOnce: true }), mkSide("warrior", harmless));
  st = { ...st, poison1: { dmg: 999, rounds: 2 } }; r = round(st, "defend", "defend");
  ok(r.state.hp1 === 1 && r.state.surviveUsed1, `毒傷造成的致命傷害也能撐住(hp ${r.state.hp1}, used ${r.state.surviveUsed1}, 事件 ${JSON.stringify(r.events)} 初始hp1 ${st.hp1})`);

  // ---- 引擎:第一回合必定暴擊 ----
  const evenStats = () => stats("warrior", 100, { luck: 0 });
  let crit1 = 0, critNo = 0, later = 0, laterNo = 0;
  for (let i = 0; i < 60; i++) {
    seed(500 + i); let a = E.initialMatchState(mkSide("warrior", evenStats(), { firstRoundCrit: true }), mkSide("warrior", stats("warrior", 100, { def: 0, hp: 99999, spd: 1 })));
    let ra = round(a, "attack", "defend"); crit1 += ra.events.filter((e) => e.side === 1 && e.type === "attack" && e.crit).length;
    seed(500 + i); let b = E.initialMatchState(mkSide("warrior", evenStats()), mkSide("warrior", stats("warrior", 100, { def: 0, hp: 99999, spd: 1 })));
    let rb = round(b, "attack", "defend"); critNo += rb.events.filter((e) => e.side === 1 && e.type === "attack" && e.crit).length;
    const ra2 = round(ra.state, "attack", "defend"); later += ra2.events.filter((e) => e.side === 1 && e.type === "attack" && e.crit).length;
    const rb2 = round(rb.state, "attack", "defend"); laterNo += rb2.events.filter((e) => e.side === 1 && e.type === "attack" && e.crit).length;
  }
  ok(crit1 === 60 && critNo < 60, `第一回合每次攻擊都暴擊(${crit1}/60),沒套裝只有 ${critNo}/60`);
  ok(later < 60 && Math.abs(later - laterNo) < 15, `第二回合起恢復正常暴擊率(${later}/60 vs 無套裝 ${laterNo}/60)`);

  // ---- 資料庫:對戰 side 帶出套裝效果 ----
  vm.runInContext(extract("_engineSide") + "\nthis.g=_engineSide;", ctx2);
  const side60 = ctx2.g("warrior", CD.applyProgress("warrior", {}, null), {}, { ult_1: 1 }, "skill_1", "skill_2", "warrior_ult_1", bset(60), 100);
  const side70 = ctx2.g("warrior", CD.applyProgress("warrior", {}, null), {}, { ult_1: 1 }, "skill_1", "skill_2", "warrior_ult_1", bset(70), 100);
  ok(side60.surviveOnce === true && side60.firstRoundCrit === false && side70.firstRoundCrit === true, "_engineSide 帶出 surviveOnce / firstRoundCrit");
  const sideNone = ctx2.g("warrior", CD.applyProgress("warrior", {}, null), {}, { ult_1: 1 }, "skill_1", "skill_2", "warrior_ult_1", {}, 100);
  ok(sideNone.surviveOnce === false && sideNone.firstRoundCrit === false, "沒裝備時兩個效果都是 false");

  // ---- 合成保留階級 ----
  tables.career_builds.push({ id: "b1", event_id: "e", player_id: "p", final_class: "warrior", path: "strength" });
  const inv = (tier, n, p) => Array.from({ length: n }, (_, i) => ({ id: `${p}${i}`, slot: "weapon", rarity: "rare", ...(tier > 1 ? { tier } : {}), name: "x" + tier }));
  const prog = { id: "pr", event_id: "e", player_id: "p", coins: 9999, level: 100, inventory: [...inv(1, 2, "a"), ...inv(3, 3, "c")], inventory_rev: 1, synthesis_pity: {}, mission_state: {}, legendary_slots: {}, floor: 1 };
  tables.career_progress.push(prog);
  Math.random = () => 0; // 一定成功
  let res = await db.synthesizeCareerEquipment("e", "p", "weapon", "rare");
  ok(res.success && res.item.rarity === "epic" && res.item.tier === 3, `2 件夜市階 + 1 件塔心階 → 結果是塔心階史詩(${res.item.name},tier ${res.item.tier})`);
  ok(prog.inventory.filter((i) => i.tier === 3 && i.rarity === "rare").length === 2 && prog.inventory.filter((i) => !i.tier && i.rarity === "rare").length === 0, "先用掉了階級最低的材料(2 件夜市階全用掉,塔心階剩 2 件)");
  prog.inventory = inv(2, 3, "d"); prog.inventory_rev = 2;
  Math.random = () => 0.9999; // 一定失敗(合成成功率不是 100%)
  res = await db.synthesizeCareerEquipment("e", "p", "weapon", "rare");
  ok(!res.success && res.item.rarity === "rare" && res.item.tier === 2, "失敗退回的裝備也保持階級(招牌階)");
  prog.inventory = inv(2, 3, "e").map((i) => ({ ...i, rarity: "epic" })); prog.inventory_rev = 3; prog.legendary_slots = {};
  Math.random = () => 0;
  res = await db.synthesizeCareerEquipment("e", "p", "weapon", "epic");
  ok(res.success && res.item.rarity === "legendary" && !res.item.tier, "合成傳說走原本的傳說款(不分階)");

  // ---- 圖鑑目錄 ----
  const cat = sb.CareerCodex.catalog();
  ok(cat.mon.length === 70, "怪物圖鑑 70 筆");
  ok(cat.item.length >= 86 + 60 + 6 + 6, `裝備圖鑑含階級裝備與 60/70 層套裝(${cat.item.length} 款)`);
  ok(cat.item.some((i) => i.name === "第零攤的點亮法球" && i.bossFloor === 70) && cat.item.some((i) => i.tier === 2) && cat.item.some((i) => i.tier === 3), "圖鑑含 Boss 套裝與兩個階級");
  const ach = sb.CareerCodex.ACHIEVEMENTS;
  ok(ach.length === 37 && ach.some((a) => a.key === "floor60") && ach.some((a) => a.key === "floor70"), "成就 37 個(新增 60/70 層)");
  console.log(process.exitCode ? "\n有失敗" : "\n全部通過");
})().catch((e) => { console.error("測試崩潰", e); process.exit(1); });
