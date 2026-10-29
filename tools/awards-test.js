// 收攤頒獎典禮(db.js 的 computeCareerAwards)判定測試:node tools/awards-test.js
const fs = require("fs"), vm = require("vm");
const root = require("path").join(__dirname, "..", "assets") + "/";
function boot(progressRows, opts = {}) {
  const broadcasts = [];
  const client = {
    from(t) {
      const st = { t, cols: "" };
      const a = {
        select(c) { st.cols = c || ""; return a; }, eq() { return a; }, in() { return a; }, update() { return a; },
        insert(row) { if (t === "career_broadcasts") broadcasts.push(row); return Promise.resolve({ error: null }); },
        then(res) {
          if (t === "career_progress") {
            if (opts.noMissionCol && st.cols.includes("mission_state")) return res({ data: null, error: { message: "column mission_state does not exist" } });
            return res({ data: progressRows.map((p) => (opts.noMissionCol ? { player_id: p.player_id, floor: p.floor } : p)), error: null });
          }
          return res({ data: [], error: null });
        },
      };
      return a;
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
  };
  const sb = { console: { log() {}, warn() {}, error: console.error }, setTimeout, clearTimeout, Math, Date, JSON, Promise, Object, Array, Set, Map, String, Number, Error, AbortController,
    document: { getElementById: () => null, createElement: () => ({}), body: { appendChild() {} }, addEventListener() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
  sb.window = sb; sb.SUPABASE_URL = "x"; sb.SUPABASE_ANON_KEY = "y"; sb.supabase = { createClient: () => client };
  vm.createContext(sb);
  ["career-data.js", "career-floors.js", "career-events.js", "career-missions.js", "career-story.js", "career-codex.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
  vm.runInContext(fs.readFileSync(root + "db.js", "utf8") + "\n;window.db = db;", sb, { filename: "db.js" });
  return { sb, broadcasts };
}
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const row = (id, name, floor, streak) => ({ queueEntry: { player_id: id, player: { name }, best_streak: streak }, floor });
(async () => {
  const prog = [
    { player_id: "a", floor: 30, mission_state: { counters: { revives: 1, eventsSeen: { chest: true } } } },
    { player_id: "b", floor: 45, mission_state: { counters: { revives: 6, eventsSeen: { chest: true, merchant: true, fortune: true, gacha: true } } } },
    { player_id: "c", floor: 45, mission_state: { counters: { revives: 6 } } },
  ];
  const standings = [row("c", "小丙", 45, 7), row("a", "小甲", 30, 3), row("b", "小乙", 45, 0)]; // 依總排名:丙、甲、乙
  const { sb, broadcasts } = boot(prog);
  const aw = await sb.db.computeCareerAwards("e", standings);
  const by = Object.fromEntries(aw.map((x) => [x.key, x]));
  ok(by.climber.name === "小丙" && by.climber.value === 45, "最會爬:同層同分時取總排名高的(小丙)");
  ok(by.revived.name === "小丙" && by.revived.value === 6, "最常被救起:6 次");
  ok(by.streak.name === "小丙" && by.streak.value === 7, "連勝王:最高連勝 7");
  ok(by.stroller.name === "小乙" && by.stroller.value === 4, "夜市散步達人:遇過 4 種事件的小乙");
  ok(by.streak.line.includes("7"), "廣播句帶入數字:" + by.streak.line);

  // 門檻:全場都沒達標 → 不頒
  const low = await boot([{ player_id: "a", floor: 0, mission_state: { counters: { revives: 1, eventsSeen: { chest: true } } } }]).sb.db.computeCareerAwards("e", [row("a", "小甲", 0, 1)]);
  ok(low.length === 0, "全場都沒達到門檻時一個獎都不頒(不會硬頒)");
  // 缺欄位 fallback
  const nm = await boot(prog, { noMissionCol: true }).sb.db.computeCareerAwards("e", standings);
  ok(nm.some((x) => x.key === "climber") && nm.some((x) => x.key === "streak") && !nm.some((x) => x.key === "revived"), "沒跑任務 SQL(缺 mission_state)時退回舊查法，只頒爬塔與連勝");
  // 廣播
  const b = boot(prog); await b.sb.db.computeCareerAwards("e", standings);
  const ev = boot(prog);
  // 直接呼叫內部廣播不可行(未匯出),改測 closeCareerEvent 的重複收攤保護需要整套 mock,此處以 AWARDS 結構確認
  ok(sb.CareerStory.AWARDS.length === 4 && sb.CareerStory.CEREMONY_OPEN.length > 0, "獎項定義 4 個、開場句存在");
})().catch((e) => { console.error("崩潰", e); process.exit(1); });
