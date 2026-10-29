// 成就與圖鑑核心(db.js 的 codexSyncProgress 等)邏輯測試:node tools/codex-test.js
// 用假的 supabase client 載入真正的 db.js 與 career-*.js,測成就/圖鑑核心邏輯
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = require("path").join(__dirname, "..", "assets") + "/";
const store = []; // 假資料庫 career_codex
let titlesGranted = [];
const toasts = [];
function makeClient() {
  const q = (table) => {
    const state = { table, filters: {} };
    const api = {
      select() { return api; }, eq() { return api; }, in() { return api; },
      then(res) {
        if (state.table === "career_codex") return res({ data: store.map((r) => ({ kind: r.kind, entry_key: r.entry_key, times: r.times })), error: null });
        return res({ data: [], error: null });
      },
      maybeSingle() { return Promise.resolve({ data: { player_id: "p1", titles: titlesGranted, lifetime_stats: {} }, error: null }); },
      single() { return Promise.resolve({ data: { player_id: "p1", titles: titlesGranted, lifetime_stats: {} }, error: null }); },
      update(patch) { if (patch.titles) titlesGranted = patch.titles; return api; },
      insert() { return api; },
    };
    return api;
  };
  return {
    from: q,
    rpc(name, args) {
      rpcCalls.push(args.p_items);
      const out = args.p_items.map((it) => {
        let r = store.find((x) => x.kind === it.kind && x.entry_key === it.key);
        const isNew = !r;
        if (!r) { r = { kind: it.kind, entry_key: it.key, times: it.inc || 1 }; store.push(r); }
        else if (!it.once) r.times += it.inc || 1;
        return { kind: it.kind, key: it.key, times: r.times, is_new: isNew };
      });
      return Promise.resolve({ data: out, error: null });
    },
  };
}
const rpcCalls = [];
const sandbox = { console, setTimeout, clearTimeout, Math, Date, JSON, Promise, Object, Array, Set, Map, String, Number, Error, AbortController,
  document: { getElementById: () => null, createElement: () => ({ classList: { add() {} }, remove() {}, appendChild() {} }), body: { appendChild() {} }, addEventListener() {} },
  addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
sandbox.window = sandbox;
sandbox.SUPABASE_URL = "x"; sandbox.SUPABASE_ANON_KEY = "y";
sandbox.supabase = { createClient: () => makeClient() };
vm.createContext(sandbox);
const load = (f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sandbox, { filename: f });
["career-data.js", "career-floors.js", "career-events.js", "career-missions.js", "career-codex.js"].forEach(load);
vm.runInContext(fs.readFileSync(root + "db.js", "utf8") + "\n;window.db = db;", sandbox, { filename: "db.js" });
const C = sandbox.CareerCodex, db = sandbox.db;
// 讓 toast 可觀察
C.unlockToast = (a) => toasts.push("ach:" + a.key);
C.titleToast = (n) => toasts.push("title:" + n);

const assert = (c, m) => { if (!c) { console.error("FAIL:", m); process.exitCode = 1; } else console.log("ok  ", m); };
(async () => {
  const tot = C.totals();
  assert(tot.mon === 70 && tot.event === 15 && tot.item > 100, `圖鑑總數 怪物${tot.mon} 事件${tot.event} 裝備${tot.item}`);
  const keys = C.ACHIEVEMENTS.map((a) => a.key);
  assert(new Set(keys).size === keys.length, `成就 key 不重複(共 ${keys.length} 個)`);
  assert(C.ACHIEVEMENTS.every((a) => C.GROUPS[a.group]), "每個成就的分類都存在");
  const titleKeys = db.TITLE_CATALOG.map((t) => t.key);
  assert(C.COUNT_TITLES.every((t) => titleKeys.includes(t.title)), "稱號門檻都有對應的稱號定義");

  const progress = { id: "pr1", floor: 10, level: 12, coins: 50, inventory_rev: 1, legendary_slots: {}, equipment: { weapon: { name: "學徒鐵棍", rarity: "rare" } },
    inventory: [{ id: "i1", name: "彈珠台鐵皮盾", rarity: "common" }], mission_state: { counters: { eventsSeen: { chest: true, merchant: true } } } };
  await db.codexSyncProgress("e1", "p1", progress);
  assert(toasts.includes("ach:floor10"), "清到 10 層 → 解鎖「逛到第十攤」");
  assert(store.some((r) => r.kind === "item" && r.entry_key === "學徒鐵棍"), "身上裝備記進裝備圖鑑");
  assert(store.some((r) => r.kind === "item" && r.entry_key === "彈珠台鐵皮盾"), "背包裝備記進裝備圖鑑");
  assert(store.some((r) => r.kind === "event" && r.entry_key === "chest"), "遇過的事件記進事件圖鑑");
  assert(!toasts.includes("ach:floor20"), "沒到 20 層不會誤解鎖");

  const n = toasts.length;
  await db.codexSyncProgress("e1", "p1", progress);
  assert(toasts.length === n, "同一份進度重複同步不會重複提示");

  // 打贏樓層:怪物 +1、累計 +1;連打 100 場
  for (let i = 0; i < 100; i++) await db.codexNoteFloorWin("e1", "p1", 5, { ...progress, inventory_rev: 2 + i });
  const mon = store.find((r) => r.kind === "mon" && r.entry_key === "5");
  await new Promise((r) => setTimeout(r, 8200)); // 等批次寫入
  assert(store.find((r) => r.kind === "mon" && r.entry_key === "5").times === 100, `怪物第 5 層累計打贏 100 次(資料庫=${store.find((r) => r.kind === "mon" && r.entry_key === "5").times})`);
  assert(store.find((r) => r.kind === "stat" && r.entry_key === "pveWins").times === 100, "永久累計打贏場數 100");
  assert(toasts.includes("ach:pve100"), "累計 100 場 → 解鎖「打到手軟」");
  assert(rpcCalls.length < 40, `批次寫入有合併(RPC 呼叫 ${rpcCalls.length} 次，不是每場 1 次)`);
  assert(toasts.filter((t) => t === "ach:pve100").length === 1, "成就只提示一次");

  // PVP:同一場結果呼叫多次只算一次;練習賽不算
  await db.noteCareerPvpResult("e1", "p1", "m1", { winStreak: 5, practice: false }, true);
  await db.noteCareerPvpResult("e1", "p1", "m1", { winStreak: 5 }, true);
  await db.noteCareerPvpResult("e1", "p1", "m2", { practice: true }, true);
  assert(store.find((r) => r.kind === "stat" && r.entry_key === "pvpWins").times === 1, "同一場重複呼叫、練習賽都只算 1 場勝利");
  assert(toasts.includes("ach:pvp1") && toasts.includes("ach:streak5"), "PVP 首勝與 5 連勝解鎖");

  // 資料表不存在時:不丟錯
  const before = toasts.length;
  console.log("--- 完成 ---", toasts.join(", "));
  process.exit(process.exitCode || 0);
})().catch((e) => { console.error("測試崩潰", e); process.exit(1); });
