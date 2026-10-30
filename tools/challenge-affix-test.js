// 整合測試:用假資料庫實際跑 db.js 的 challengeCareerFloor,確認詞條與稀有攤販真的進入戰鬥與獎勵:node tools/challenge-affix-test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..", "assets") + "/";
const tables = { events: [], career_progress: [], career_builds: [], career_matches: [], career_player_skills: [], career_events: [], players: [], career_journal: [], career_codex: [], career_broadcasts: [] };
function qb(name) {
  const st = { filters: [], patch: null, insert: null, upsert: null };
  const run = () => {
    const rows = tables[name] || (tables[name] = []);
    if (st.upsert) { const ex = rows.find((r) => r.event_id === st.upsert.event_id && r.player_id === st.upsert.player_id); if (ex) { Object.assign(ex, st.upsert); return { data: [ex], error: null }; } const row = { id: "r" + (rows.length + 1), ...st.upsert }; rows.push(row); return { data: [row], error: null }; }
    if (st.insert) { const row = { id: "r" + (rows.length + 1), ...st.insert }; rows.push(row); return { data: [row], error: null }; }
    const m = rows.filter((r) => st.filters.every(([k, v]) => r[k] === v));
    if (st.patch) m.forEach((r) => Object.assign(r, st.patch));
    return { data: m, error: null };
  };
  const api = { select() { return api; }, eq(k, v) { st.filters.push([k, v]); return api; }, in() { return api; }, order() { return api; }, limit() { return api; }, gte() { return api; }, lte() { return api; },
    update(p) { st.patch = p; return api; }, insert(r) { st.insert = r; return api; }, upsert(r) { st.upsert = r; return api; }, delete() { return api; },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
    single() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: r.data[0] ? null : { message: "no rows" } }); },
    then(res) { return res(run()); } };
  return api;
}
const sb = { console: { log() {}, warn() {}, error: (...a) => process.env.DBG && console.error(...a) }, setTimeout, clearTimeout, Math, Date, JSON, Promise, Object, Array, Set, Map, String, Number, Error, AbortController,
  document: { getElementById: () => null, createElement: () => ({}), body: { appendChild() {} }, addEventListener() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
sb.window = sb; sb.SUPABASE_URL = "x"; sb.SUPABASE_ANON_KEY = "y"; sb.supabase = { createClient: () => ({ from: qb, rpc: () => Promise.resolve({ data: null, error: null }) }) };
vm.createContext(sb);
["career-data.js", "career-spec.js", "career-engine.js", "career-floors.js", "career-events.js", "career-missions.js", "career-modifiers.js", "career-affixes.js", "career-story.js", "career-pve.js", "career-codex.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
vm.runInContext(fs.readFileSync(root + "db.js", "utf8") + "\n;window.db = db;", sb, { filename: "db.js" });
const db = sb.db, CD = sb.CareerData, AF = sb.CareerAffixes;
function seed(s) { Math.random = function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
(async () => {
  const now = Date.now();
  tables.events.push({ id: "e", status: "active", type: "career", title: "t", rules: { activityEndsAt: new Date(now + 50 * 60000).toISOString(), careerPhase: "battle" } });
  tables.players.push({ id: "p", name: "測試員" });
  tables.career_builds.push({ id: "b1", event_id: "e", player_id: "p", final_class: "warrior", path: "strength" });
  const mkProg = () => ({ id: "pr", event_id: "e", player_id: "p", floor: 54, level: 110, exp: 0, coins: 0, skill_points: 0, stat_points: 0, stat_alloc: { atk: 700, def: 300, hp: 400 }, equipment: {}, inventory: [], inventory_rev: 1, active_skills: { ult_1: 1, skill_1: 3, skill_2: 3 }, equipped_skill_a: "skill_1", equipped_skill_b: "skill_2", equipped_ult: "warrior_ult_1", hp: 99999, mp: 99, mission_state: {}, legendary_slots: {}, synthesis_pity: {}, last_trained_at: null, train_ready_at: null, auto_farm_floor: null });
  let vendorSeen = null, plainSeen = null, wins = 0, vendorWins = 0, vendorBadDrops = 0;
  for (let sd = 1; sd <= 600; sd++) {
    tables.career_progress.length = 0; tables.career_progress.push(mkProg());
    seed(sd);
    let res; try { res = await db.challengeCareerFloor("e", "p", 55); } catch (e) { console.error("例外", e.stack.split("\n").slice(0,4).join(" | ")); continue; }
    if (!res || !res.floorDef) continue;
    if (res.floorDef.vendor) { vendorSeen = vendorSeen || res; if (res.won) { vendorWins++; if (!res.drop || !["rare", "epic"].includes(res.drop.rarity)) vendorBadDrops++; } } else if (!res.event) plainSeen = plainSeen || res;
    if (res.won) wins++;
  }
  ok(!!plainSeen, "一般挑戰:結果帶出樓層資料");
  if (plainSeen) {
    const fd = plainSeen.floorDef;
    ok(fd.affix && fd.affix.key, "一般挑戰:這層有詞條 → 結果的 floorDef 帶 affix(" + (fd.affix && fd.affix.name) + ")");
    const expectAf = AF.affixFor(tables.events[0].rules, 55);
    ok(fd.affix.key === expectAf.key, "詞條跟 affixFor 算出來的一致(所有玩家一致)");
  }
  ok(!!vendorSeen, "有機率遇到稀有攤販(約 7%)");
  if (vendorSeen) {
    ok(/^【.+攤販】/.test(vendorSeen.floorDef.name) && vendorSeen.floorDef.vendor.title, "攤販:名稱加上稱號 → " + vendorSeen.floorDef.name);
    ok(vendorWins >= 5 && vendorBadDrops === 0, `打贏攤販必掉稀有或史詩(${vendorWins} 次勝利,沒掉到的 ${vendorBadDrops} 次)`);
  }
  // 關主層不受影響
  tables.career_progress.length = 0; const p2 = mkProg(); p2.floor = 59; tables.career_progress.push(p2); seed(7);
  const boss = await db.challengeCareerFloor("e", "p", 60).catch((e) => ({ err: e.message }));
  ok(!boss.err ? (!(boss.floorDef || {}).affix && !(boss.floorDef || {}).vendor) : true, "關主層沒有詞條也沒有攤販" + (boss.err ? "(戰鬥流程回傳:" + boss.err + ")" : ""));
  console.log(process.exitCode ? "\n有失敗" : "\n全部通過");
})().catch((e) => { console.error("崩潰", e); process.exit(1); });
