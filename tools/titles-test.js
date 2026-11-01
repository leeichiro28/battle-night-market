// 稱號測試(爬塔霸主 70 層、第一攤打烊人 100 層、12 個覺醒稱號、十二路歸一):node tools/titles-test.js
const fs = require("fs"), vm = require("vm");
const root = require("path").join(__dirname, "..", "assets") + "/";
const tables = { player_profiles: [] };
function qb(name) {
  const st = { filters: [], patch: null, insert: null };
  const run = () => {
    const rows = tables[name] || [];
    if (st.insert) { const row = { id: "r" + (rows.length + 1), ...st.insert }; rows.push(row); return { data: [row], error: null }; }
    const m = rows.filter((r) => st.filters.every(([k, v]) => r[k] === v));
    if (st.patch) m.forEach((r) => Object.assign(r, st.patch));
    return { data: m, error: null };
  };
  const api = {
    select() { return api; }, eq(k, v) { st.filters.push([k, v]); return api; }, in() { return api; },
    update(p) { st.patch = p; return api; }, insert(r) { st.insert = r; return api; },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
    single() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: r.data[0] ? null : { message: "no rows" } }); },
    then(res) { return res(run()); },
  };
  return api;
}
const client = { from: qb, rpc: () => Promise.resolve({ data: null, error: null }) };
const toasts = [];
const sb = { console: { log() {}, warn() {}, error: console.error }, setTimeout, clearTimeout, Math, Date, JSON, Promise, Object, Array, Set, Map, String, Number, Error, AbortController,
  document: { getElementById: () => null, createElement: () => ({}), body: { appendChild() {} }, addEventListener() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
sb.window = sb; sb.SUPABASE_URL = "x"; sb.SUPABASE_ANON_KEY = "y"; sb.supabase = { createClient: () => client };
vm.createContext(sb);
["career-data.js", "career-spec.js", "career-floors.js", "career-events.js", "career-missions.js", "career-story.js", "career-codex.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
sb.CareerCodex.titleToast = (n) => toasts.push(n); // 攔截「獲得稱號」提示
vm.runInContext(fs.readFileSync(root + "db.js", "utf8") + "\n;window.db = db;", sb, { filename: "db.js" });
const db = sb.db, SP = sb.CareerSpec;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const titlesOf = (pid) => ((tables.player_profiles.find((r) => r.player_id === pid) || {}).titles) || [];

(async () => {
  // ---- 目錄 ----
  const cat = db.TITLE_CATALOG, keys = cat.map((t) => t.key);
  ok(new Set(keys).size === keys.length, `稱號 key 不重複(共 ${keys.length} 個)`);
  ok(cat.find((t) => t.key === "tower_first_stall").name === "第一攤打烊人", "新稱號「第一攤打烊人」");
  ok(/70/.test(cat.find((t) => t.key === "tower_conqueror").desc), "「爬塔霸主」說明改成 70 層");
  ok(cat.filter((t) => /^awaken_(?!all)/.test(t.key)).length === 12 && keys.includes("awaken_all"), "覺醒稱號 12 個 + 十二路歸一");

  // 覺醒稱號表要跟 career-spec.js 的 AWAKEN 路線完全對得起來
  let match = true;
  Object.keys(SP.AWAKEN).forEach((cls) => ["a", "b"].forEach((br) => {
    const t = db.AWAKEN_TITLES[cls] && db.AWAKEN_TITLES[cls][br];
    if (!t || t.via !== SP.AWAKEN[cls][br].title) match = false;
    if (!keys.includes(`awaken_${cls}_${br}`)) match = false;
  }));
  ok(match && Object.keys(db.AWAKEN_TITLES).length === Object.keys(SP.AWAKEN).length, "稱號表與 AWAKEN 12 條路線一一對應(進階職業名也一致)");
  const names = cat.filter((t) => /^awaken_/.test(t.key)).map((t) => t.name);
  ok(names.every((n) => n.length >= 2 && n.length <= 6) || names.filter((n) => n.length > 6).length === 0, "覺醒稱號名稱 2～6 字");
  const skillNames = new Set(); Object.values(SP.AWAKEN).forEach((c) => Object.values(c).forEach((b) => { skillNames.add(b.skill.name); skillNames.add(b.ult.name); }));
  ok(!names.some((n) => skillNames.has(n)), "稱號名稱不跟覺醒技能／大招同名");
  ok(cat.filter((t) => t.group === "覺醒稱號").length === 13, "覺醒稱號分到同一組(選單分組顯示)");

  // ---- 樓層稱號 ----
  tables.player_profiles.push({ player_id: "p1", titles: [], lifetime_stats: {} });
  let r = await db.syncPlayerTitles("p1", { floor: 69 });
  ok(r.length === 0 && titlesOf("p1").length === 0, "69 層沒有任何樓層稱號");
  r = await db.syncPlayerTitles("p1", { floor: 70 });
  ok(titlesOf("p1").join() === "tower_conqueror" && r[0] === "爬塔霸主", "第一次到 70 層當下拿「爬塔霸主」(不等收攤)");
  r = await db.syncPlayerTitles("p1", { floor: 99 });
  ok(titlesOf("p1").length === 1, "99 層還沒有「第一攤打烊人」");
  r = await db.syncPlayerTitles("p1", { floor: 100 });
  ok(titlesOf("p1").includes("tower_first_stall") && titlesOf("p1").length === 2 && r[0] === "第一攤打烊人", "100 層拿「第一攤打烊人」,霸主稱號不會被收回");
  const before = toasts.length;
  await db.syncPlayerTitles("p1", { floor: 100 });
  ok(titlesOf("p1").length === 2 && toasts.length === before, "重複呼叫不重複發、不重複彈提示");

  // ---- 覺醒稱號 ----
  tables.player_profiles.push({ player_id: "p2", titles: [], lifetime_stats: {} });
  const awakenCtx = (cls, br, level) => ({ floor: 1, classKey: cls, activeSkills: { ult_1: 1, ["spec_" + br]: 1 }, level });
  r = await db.syncPlayerTitles("p2", awakenCtx("warrior", "a", 74));
  ok(titlesOf("p2").length === 0, "Lv.74 還沒覺醒,沒有覺醒稱號");
  r = await db.syncPlayerTitles("p2", { floor: 1, classKey: "warrior", activeSkills: { ult_1: 1 }, level: 80 });
  ok(titlesOf("p2").length === 0, "Lv.80 但沒選專精分支,不覺醒、沒稱號");
  r = await db.syncPlayerTitles("p2", awakenCtx("warrior", "a", 75));
  ok(titlesOf("p2").join() === "awaken_warrior_a" && r[0] === "陷陣先鋒", "Lv.75 + 專精 A → 破軍路線稱號「陷陣先鋒」");
  r = await db.syncPlayerTitles("p2", awakenCtx("warrior", "b", 75));
  ok(titlesOf("p2").includes("awaken_warrior_b") && titlesOf("p2").includes("awaken_warrior_a"), "下一場換 B 路線覺醒 → 再拿「血染夜市」,舊的保留");
  ok(!titlesOf("p2").includes("awaken_all"), "只覺醒 2 條路線不會拿到「十二路歸一」");

  // ---- 十二路歸一 ----
  tables.player_profiles.push({ player_id: "p3", titles: [], lifetime_stats: {} });
  const all = [];
  Object.keys(SP.AWAKEN).forEach((cls) => ["a", "b"].forEach((br) => all.push([cls, br])));
  for (let i = 0; i < all.length; i++) {
    r = await db.syncPlayerTitles("p3", awakenCtx(all[i][0], all[i][1], 75));
    if (i < all.length - 1 && titlesOf("p3").includes("awaken_all")) ok(false, `第 ${i + 1} 條就拿到十二路歸一`);
  }
  ok(titlesOf("p3").length === 13 && titlesOf("p3").includes("awaken_all"), "12 條路線都覺醒過 → 12 個路線稱號 + 「十二路歸一」");
  ok(r.includes("十二路歸一"), "最後一條覺醒時同時跳出「十二路歸一」");

  // ---- 程式檢查 ----
  const src = fs.readFileSync(root + "db.js", "utf8");
  ok(/row\.floor >= TOWER_CONQUEROR_FLOOR\) titleKeys\.push\("tower_conqueror"\)/.test(src) && /row\.floor >= FIRST_STALL_FLOOR\) titleKeys\.push\("tower_first_stall"\)/.test(src), "收攤結算(awardCareerTitles)也會發兩個樓層稱號(保險)");
  ok(/isAdvance && floorNumber >= TOWER_CONQUEROR_FLOOR\) syncPlayerTitles/.test(src), "通關當下呼叫發稱號");
  ok(/syncMyTitles\(\);/.test(fs.readFileSync(root + "tower.js", "utf8")), "爬塔頁每次重畫會補發(老玩家補拿)");
  ok(/title-pick-group/.test(fs.readFileSync(root + "header.js", "utf8")), "稱號選單有分組標題");
})();
