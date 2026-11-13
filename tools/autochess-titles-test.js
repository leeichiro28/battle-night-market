// 夜市自走棋稱號測試(階段 3 的 12 個):node tools/autochess-titles-test.js
// 涵蓋:key 不重複且 ac_ 前綴、名次門檻(≥4 人)、血量 80/10 邊界、連勝/利息/刷新/3★、累計冠軍與前三、
//       機器人與未結算不發、重複結算不重複發、練習模式(沒有資料庫列)不發。
const fs = require("fs"), vm = require("vm");
const root = require("path").join(__dirname, "..", "assets") + "/";
const tables = { player_profiles: [], autochess_players: [], autochess_stats: [] };
function qb(name) {
  const st = { filters: [], patch: null, insert: null };
  const run = () => {
    const rows = tables[name] || [];
    if (st.insert) { const row = { id: "r" + (rows.length + 1), ...st.insert }; rows.push(row); return { data: [row], error: null }; }
    const m = rows.filter((r) => st.filters.every(([k, v, isIn]) => (isIn ? v.includes(r[k]) : r[k] === v)));
    if (st.patch) m.forEach((r) => Object.assign(r, st.patch));
    return { data: m, error: null };
  };
  const api = {
    select() { return api; }, eq(k, v) { st.filters.push([k, v]); return api; }, in(k, v) { st.filters.push([k, v, true]); return api; },
    order() { return api; }, limit() { return api; }, update(p) { st.patch = p; return api; }, insert(r) { st.insert = r; return api; },
    maybeSingle() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: null }); },
    single() { const r = run(); return Promise.resolve({ data: r.data[0] || null, error: r.data[0] ? null : { message: "no rows" } }); },
    then(res) { return res(run()); },
  };
  return api;
}
const client = { from: qb, rpc: () => Promise.resolve({ data: null, error: null }) };
const sb = { console: { log() {}, warn() {}, error: console.error }, setTimeout, clearTimeout, Math, Date, JSON, Promise, Object, Array, Set, Map, String, Number, Error, AbortController,
  document: { getElementById: () => null, createElement: () => ({}), body: { appendChild() {} }, addEventListener() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
sb.window = sb; sb.SUPABASE_URL = "x"; sb.SUPABASE_ANON_KEY = "y"; sb.supabase = { createClient: () => client };
vm.createContext(sb);
["autochess-data.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
vm.runInContext(fs.readFileSync(root + "db.js", "utf8") + "\n;window.db = db;", sb, { filename: "db.js" });
const db = sb.db;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log("  ✗ " + m); } };
const titlesOf = (pid) => ((tables.player_profiles.find((r) => r.player_id === pid) || {}).titles) || [];

// 組一場活動:ranks = [{id, hp, state, bot, settled}] 依名次排好(第 1 名在最前)
let evSeq = 0;
function mkEvent(players) {
  const ev = "ev" + ++evSeq;
  players.forEach((p, i) => tables.autochess_players.push({ event_id: ev, player_id: p.id, hp: p.hp == null ? 50 : p.hp, wins: 2, losses: 1, alive: i === 0, final_rank: i + 1, eliminated_round: i === 0 ? null : 5,
    settled_round: p.settled === undefined ? 5 : p.settled, state: p.state || {}, players: { name: p.id, is_bot: !!p.bot } }));
  return ev;
}
const P = (id, o) => Object.assign({ id }, o || {});
const four = (champ) => [champ, P("b"), P("c"), P("d")];
const stat = (o) => Object.assign({ res: "win", afk: false, gold: 0, refresh: 0 }, o);

(async () => {
  const cat = db.TITLE_CATALOG.filter((t) => t.group === "夜市自走棋稱號"), keys = cat.map((t) => t.key);
  ok(cat.length === 27, "自走棋稱號共 27 個(階段 3:12、階段 4:14、階段 5:1),得到 " + cat.length);
  ok(cat.filter((t) => t.hidden).length === 1 && cat.find((t) => t.key === "ac_hidden_bond").hidden, "只有隱藏羈絆稱號是隱藏稱號");
  ok(new Set(db.TITLE_CATALOG.map((t) => t.key)).size === db.TITLE_CATALOG.length, "全部稱號 key 不重複");
  ok(keys.every((k) => /^ac_/.test(k)), "自走棋稱號 key 都是 ac_ 前綴");
  ok(cat.every((t) => t.name && t.desc && t.icon), "每個稱號都有名稱、說明、圖示");

  const K = db.autochessTitleKeys;
  const base = { rank: 1, nPlayers: 4, hp: 50, state: {}, stats: [], champs: 1, top3: 1 };
  ok(K({ ...base }).includes("ac_champion") && K({ ...base }).includes("ac_first_run"), "冠軍:棋王 + 初試攤位");
  ok(!K({ ...base, nPlayers: 3 }).includes("ac_champion") && K({ ...base, nPlayers: 3 }).includes("ac_first_run"), "3 人場不發冠軍,但初試攤位照發");
  ok(K({ ...base, hp: 80 }).includes("ac_flawless") && !K({ ...base, hp: 79 }).includes("ac_flawless"), "滴水不漏:血量 80 邊界");
  ok(K({ ...base, hp: 10 }).includes("ac_close_call") && !K({ ...base, hp: 11 }).includes("ac_close_call"), "一口氣的距離:血量 10 邊界");
  ok(K({ ...base, rank: 2 }).includes("ac_runner_up") && !K({ ...base, rank: 2 }).includes("ac_champion"), "亞軍:差一步打烊");
  ok(!K({ ...base, rank: 2, hp: 90 }).includes("ac_flawless"), "亞軍不給滴水不漏");
  ok(K({ ...base, champs: 3 }).includes("ac_triple_champion") && !K({ ...base, champs: 2 }).includes("ac_triple_champion"), "三屆棋王:累計 3");
  ok(K({ ...base, rank: 3, top3: 5 }).includes("ac_regular") && !K({ ...base, rank: 3, top3: 4 }).includes("ac_regular"), "棋桌常客:累計 5 次前三");
  ok(K({ ...base, state: { bestStreak: 5 } }).includes("ac_streak5") && !K({ ...base, state: { bestStreak: 4 } }).includes("ac_streak5"), "手氣正旺:連勝 5");
  ok(K({ ...base, state: { bestStreak: 8 } }).includes("ac_streak8") && !K({ ...base, state: { bestStreak: 7 } }).includes("ac_streak8"), "勢不可擋:連勝 8");
  const full = (n, o) => Array.from({ length: n }, () => stat({ gold: 30, ...(o || {}) }));
  ok(K({ ...base, stats: full(10) }).includes("ac_vault_full") && !K({ ...base, stats: full(9) }).includes("ac_vault_full"), "金庫大戶:10 輪利息拿滿(銅板 ≥ 30)");
  ok(!K({ ...base, stats: full(10).map((x) => ({ ...x, gold: 29 })) }).includes("ac_vault_full"), "29 銅板不算拿滿");
  ok(!K({ ...base, stats: full(10, { afk: true }) }).includes("ac_vault_full"), "掛網的輪次不算");
  ok(K({ ...base, stats: [stat({ refresh: 10 })] }).includes("ac_reroll_addict") && !K({ ...base, stats: [stat({ refresh: 9 })] }).includes("ac_reroll_addict"), "刷新狂人:單輪 10 次");
  ok(K({ ...base, state: { threeStar: 1 } }).includes("ac_three_star") && !K({ ...base, state: { threeStar: 0 } }).includes("ac_three_star"), "三星攤主");
  ok(K({ ...base }).every((k) => keys.includes(k)), "判定出來的 key 都在目錄裡");

  // ---- 階段 5:翻盤王 ----
  const dm = (...ds) => ds.map((d) => stat({ dmg: d }));
  ok(K({ ...base, stats: dm(30, 30, 20) }).includes("ac_comeback"), "翻盤王:冠軍,血量曾掉到 20(100-30-30-20)");
  ok(K({ ...base, stats: dm(30, 30, 10) }).includes("ac_comeback"), "翻盤王:剛好 30 算");
  ok(!K({ ...base, stats: dm(30, 30, 9) }).includes("ac_comeback"), "翻盤王:血量 31 不算(30+30+9=69,剩 31)") ;
  ok(!K({ ...base, rank: 2, stats: dm(80) }).includes("ac_comeback"), "亞軍不給翻盤王");
  ok(!K({ ...base, nPlayers: 3, stats: dm(80) }).includes("ac_comeback"), "3 人場不給翻盤王");
  ok(!K({ ...base, stats: dm(10, 10) }).includes("ac_comeback"), "沒掉到 30 以下不給");
  // ---- 走資料庫的完整流程 ----
  const ev1 = mkEvent(four(P("a", { hp: 85, state: { bestStreak: 5, threeStar: 1 } })));
  tables.autochess_stats.push(...Array.from({ length: 10 }, (_, r) => ({ event_id: ev1, round: r + 1, player_id: "a", stat: stat({ gold: 31, refresh: r === 3 ? 12 : 0 }) })));
  const rows1 = await db.listAutochessPlayers(ev1);
  let fresh = await db.awardAutochessTitlesFor(ev1, "a", { rows: rows1 });
  ok(["ac_first_run", "ac_champion", "ac_flawless", "ac_streak5", "ac_three_star"].every((k) => fresh.includes(k)), "A 拿到:初試/棋王/滴水不漏/連勝5/三星 → " + fresh.join(","));
  ok(fresh.includes("ac_vault_full") && fresh.includes("ac_reroll_addict"), "A 也拿到金庫大戶與刷新狂人");
  ok(titlesOf("a").includes("ac_champion"), "稱號寫進 player_profiles.titles");
  ok((tables.player_profiles[0] || {}).display_title === "ac_first_run", "第一次拿稱號會預設掛上");
  fresh = await db.awardAutochessTitlesFor(ev1, "a", { rows: rows1 });
  ok(fresh.length === 0 && titlesOf("a").length === new Set(titlesOf("a")).size, "重複結算:不會再發、不會重複");
  ok(titlesOf("b").length === 0, "沒呼叫到的玩家不受影響");
  const fb = await db.awardAutochessTitlesFor(ev1, "b");
  ok(fb.includes("ac_first_run") && fb.includes("ac_runner_up"), "B(亞軍)拿到初試攤位與差一步打烊,自己載入資料也行");

  // 累計冠軍:再贏兩場 ≥4 人場 → 三屆棋王;其間夾一場 3 人場不算
  const ev2 = mkEvent(four(P("a")));
  await db.awardAutochessTitlesFor(ev2, "a");
  ok(!titlesOf("a").includes("ac_triple_champion"), "2 次冠軍還沒有三屆棋王");
  const evSmall = mkEvent([P("a"), P("b"), P("c")]);
  await db.awardAutochessTitlesFor(evSmall, "a");
  ok(!titlesOf("a").includes("ac_triple_champion"), "3 人場的冠軍不計入累計");
  const ev3 = mkEvent(four(P("a")));
  await db.awardAutochessTitlesFor(ev3, "a");
  ok(titlesOf("a").includes("ac_triple_champion"), "第 3 次(≥4 人場)冠軍 → 三屆棋王");
  ok(titlesOf("a").includes("ac_regular") === false, "前三名只有 3 次,還不是棋桌常客");
  const ev4 = mkEvent([P("x"), P("y"), P("a"), P("z")]); const ev5 = mkEvent([P("x"), P("y"), P("a"), P("z")]);
  await db.awardAutochessTitlesFor(ev4, "a"); await db.awardAutochessTitlesFor(ev5, "a");
  ok(titlesOf("a").includes("ac_regular"), "累計 5 次前三(≥4 人場)→ 棋桌常客");


  // ---- 階段 4:搭配 / 流派 / 隱藏稱號(以跨場對局紀錄 hist 判定)----
  const W = (o) => stat({ res: "win", bonds: {}, ...o });
  const H = (hist) => K({ ...base, rank: 5, hist });
  ok(H([W({ mono: 6 })]).includes("ac_mono") && !H([W({ mono: 5 })]).includes("ac_mono") && !H([stat({ res: "lose", mono: 7 })]).includes("ac_mono"), "專一老闆:6 張同流派且贏");
  ok(H([W({ bonds: { burn: 2, frost: 2, game: 2 } })]).includes("ac_hodgepodge") && !H([W({ bonds: { burn: 2, frost: 2 } })]).includes("ac_hodgepodge"), "大雜燴:同時 3 個羈絆且贏");
  ok(H([W({ bookend: true })]).includes("ac_bookend") && !H([stat({ res: "lose", bookend: true })]).includes("ac_bookend"), "首尾呼應:要贏");
  ok(H([stat({ res: "lose", three: 3 })]).includes("ac_three_star_trio") && !H([stat({ three: 2 })]).includes("ac_three_star_trio"), "三星連線:3 張 3★(輸也算)");
  ok(H([W({ hidden: ["bosses_meetup"] })]).includes("ac_hidden_bond") && !H([W({ hidden: [] })]).includes("ac_hidden_bond"), "夜市祕密:隱藏羈絆且贏");
  const tenWins = (tag, tier) => Array.from({ length: 10 }, () => W({ bonds: { [tag]: tier } }));
  ok(H(tenWins("potion", 4)).includes("ac_tag_potion") && !H(tenWins("potion", 2)).includes("ac_tag_potion") && !H(tenWins("potion", 4).slice(1)).includes("ac_tag_potion"), "藥燉名醫:累計 10 場贏且 4 級以上");
  ok(!H(tenWins("potion", 4)).includes("ac_tag_clock"), "流派稱號只看該流派");
  const all8 = Object.keys(sb.AutochessData.TAGS).map((t) => stat({ res: "lose", bonds: { [t]: 4 } }));
  ok(H(all8).includes("ac_all_bonds") && !H(all8.slice(1)).includes("ac_all_bonds"), "八方來財:8 流派都達過 4 級(輸也算)");
  ok(K({ ...base, hist: undefined }).every((k) => keys.includes(k)), "沒有 hist 也能判定");
  // 走資料庫:跨場紀錄真的被讀進來
  const evH = mkEvent(four(P("h1", { hp: 50 })));
  tables.autochess_stats.push({ event_id: evH, round: 1, player_id: "h1", stat: W({ mono: 6, bookend: true, three: 3, hidden: ["awang_day"], bonds: { burn: 4, frost: 2, game: 2 } }) });
  const fh = await db.awardAutochessTitlesFor(evH, "h1");
  ok(["ac_mono", "ac_hodgepodge", "ac_bookend", "ac_three_star_trio", "ac_hidden_bond"].every((k) => fh.includes(k)), "h1 從 autochess_stats 拿到搭配類稱號 → " + fh.join(","));

  // 不該發的情況
  const evBot = mkEvent([P("bot1", { bot: true }), P("m"), P("n"), P("o")]);
  ok((await db.awardAutochessTitlesFor(evBot, "bot1")).length === 0 && titlesOf("bot1").length === 0, "機器人不發稱號");
  ok((await db.awardAutochessTitlesFor(evBot, "nobody")).length === 0, "不在這場的玩家不發");
  const evNoRank = mkEvent([P("q")]); tables.autochess_players.find((r) => r.event_id === evNoRank).final_rank = null;
  ok((await db.awardAutochessTitlesFor(evNoRank, "q")).length === 0, "還沒算名次(活動未結束)不發");
  const evFew = mkEvent([P("f1"), P("f2", { settled: 0 }), P("f3", { settled: 0 }), P("f4", { settled: 0 })]);
  const ff = await db.awardAutochessTitlesFor(evFew, "f1");
  ok(!ff.includes("ac_champion") && ff.includes("ac_first_run"), "報名 4 人但只有 1 人真的打過 → 不發冠軍");

  console.log(`\n${pass} 通過,${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
