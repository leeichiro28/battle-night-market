// 夜市自走棋 階段 3:連線版整合測試。 node tools/autochess-online-flow-test.js
//
// 沒有真的資料庫、也沒有瀏覽器,所以用:
//   - 虛擬時鐘(所有 setTimeout / setInterval / Date.now 都走同一個假時間,120 秒一輪跑得很快)
//   - 一個照 migration-autochess.sql 邏輯寫的「假伺服器」(autochess_clock / save_state / pair_round / settle_round / finish)
//   - 每個玩家一個獨立的 JS 環境(vm),各自載入真正的 autochess.js,用極簡 DOM 假物件
// 然後讓 1 位旁觀者 + 5 位報名者(3 位正常操作、1 位中途斷線、1 位從不進頁面)從倒數一路打到結束。
//
// 注意:這驗證的是「前端流程」和「我對 SQL 行為的理解」,不是 SQL 本身 —— SQL 一定要在 Supabase 實跑過。
const fs = require("fs"), path = require("path"), vm = require("vm");
const ASSETS = path.join(__dirname, "..", "assets");

// ---------------- 虛擬時鐘 ----------------
const V = { now: Date.parse("2026-11-12T12:00:00Z"), timers: [], seq: 1 };
function addTimer(owner, fn, ms, every) { const t = { id: V.seq++, at: V.now + Math.max(0, ms || 0), fn, every: every || 0, owner }; V.timers.push(t); return t.id; }
function clearTimer(id) { const i = V.timers.findIndex((t) => t.id === id); if (i >= 0) V.timers.splice(i, 1); }
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
async function pump(untilMs, stop) {
  while (V.now < untilMs && !(stop && stop())) {
    let best = null; for (const t of V.timers) if (!best || t.at < best.at || (t.at === best.at && t.id < best.id)) best = t;
    if (!best) break;
    V.now = Math.max(V.now, best.at);
    if (best.every) best.at = V.now + best.every; else clearTimer(best.id);
    if (!best.owner || !best.owner.dead) { try { best.fn(); } catch (e) { errors.push("timer: " + e.stack); } }
    await flush();
  }
}

// ---------------- 假伺服器(照 SQL 邏輯)----------------
const clone = (x) => JSON.parse(JSON.stringify(x));
const S = { ev: { id: "EV1", name: "測試場", game_type: "autochess", status: "open", locked: false, rules: { autochess: { practice: true } }, reward_plan: { items: ["金", "銀", "銅"] } }, players: {}, rounds: [], stats: [], log: [], parts: [], calls: {} };
const count = (n) => { S.calls[n] = (S.calls[n] || 0) + 1; };
let rngState = 12345; const rnd = () => { rngState = (rngState * 1664525 + 1013904223) >>> 0; return rngState / 4294967296; };
const iso = () => new Date(V.now).toISOString();

function clockOf() {
  const run = S.ev.rules.autochess.run;
  if (!run) return { now: iso(), started: false };
  const paused = run.pausedAt ? Date.parse(run.pausedAt) : null;
  const elapsed = ((paused != null ? paused : V.now) - Date.parse(run.startedAt)) / 1000 - (run.pausedTotal || 0);
  const battle = run.battleSec ?? 25, res = run.resultSec ?? 5, arr = run.prepSec || [90], n = arr.length, limit = run.limitSec == null ? null : run.limitSec;
  if (elapsed < 0) return { now: iso(), started: true, phase: "countdown", round: 0, left: Math.ceil(-elapsed), elapsed, paused: paused != null, over: false, phaseElapsed: 0, endedAt: run.endedAt || null, limitSec: limit };
  let r = 0, t = elapsed, prep = 0, len = 0;
  for (;;) { r++; prep = (arr[Math.min(r, n) - 1] ?? 90) + ((run.extra || {})[r] || 0); len = prep + battle + res; if (t < len || r >= 300) break; t -= len; }
  let phase, left, pe;
  if (t < prep) { phase = "prep"; left = prep - t; pe = t; } else if (t < prep + battle) { phase = "battle"; left = prep + battle - t; pe = t - prep; } else { phase = "result"; left = len - t; pe = t - prep - battle; }
  return { now: iso(), started: true, phase, round: r, left: Math.ceil(left), prepSec: prep, phaseElapsed: Math.round(pe * 100) / 100, elapsed, paused: paused != null, over: limit != null && elapsed >= limit, endedAt: run.endedAt || null, limitSec: limit };
}
const rowsOf = () => Object.values(S.players);
function srvStart(run) {
  if (S.ev.rules.autochess.run) return { ok: true, already: true };
  S.parts.forEach((p) => { S.players[p.id] = { event_id: "EV1", player_id: p.id, hp: (run && run.startHp) || 100, wins: 0, losses: 0, state: {}, state_rev: 0, alive: true, eliminated_round: null, overflow: 0, final_rank: null, reward: null, sealed_round: 0, settled_round: 0, last_action_round: 0, players: { name: p.name } }; });
  if (rowsOf().length < 2) throw new Error("autochess_need_2_players");
  S.ev.rules.autochess.run = { startedAt: new Date(V.now + ((run && run.leadSec) ?? 15) * 1000).toISOString(), prepSec: (run && run.prepSec) || [90], battleSec: (run && run.battleSec) || 25, resultSec: (run && run.resultSec) || 5, limitSec: (run && run.limitSec) ?? null, pausedTotal: 0, extra: {} };
  S.ev.locked = true; S.ev.status = "running"; return { ok: true };
}
function srvSave(pid, rev, state, round) { const r = srvSave0(pid, rev, state, round); if (!r.ok) { S.rejects = S.rejects || {}; S.rejects[r.reason] = (S.rejects[r.reason] || 0) + 1; } return r; }
function srvSave0(pid, rev, state, round) {
  const pl = S.players[pid]; if (!pl) return { ok: false, reason: "no_player" };
  if (!pl.alive) return { ok: false, reason: "dead" };
  if (pl.state_rev !== rev) return { ok: false, reason: "rev", rev: pl.state_rev };
  const c = clockOf();
  if (!c.started || c.endedAt) return { ok: false, reason: "not_running" };
  if (!((c.phase === "prep" && c.round === round) || (c.phase === "countdown" && round === 1) || (c.phase === "battle" && c.round === round && c.phaseElapsed < 2))) return { ok: false, reason: "not_prep" };
  if (pl.sealed_round >= round) return { ok: false, reason: "sealed" };
  if (pl.settled_round < pl.sealed_round) return { ok: false, reason: "unsettled" };
  pl.state = clone(state); pl.state_rev++; pl.last_action_round = round; return { ok: true, rev: pl.state_rev };
}
const snapshotOf = (pid, round) => { const p = S.players[pid]; return { player_id: pid, hp: p.hp, wins: p.wins, losses: p.losses, afk: round - p.last_action_round >= 3, state: clone(p.state) }; };
function srvPair(round) {
  if (S.rounds.some((m) => m.round === round)) return { ok: true, already: true };
  const c = clockOf();
  if (!c.started) return { ok: false, reason: "not_started" }; if (c.endedAt) return { ok: false, reason: "ended" };
  if (round > c.round || (round === c.round && (["prep", "countdown"].includes(c.phase) || (c.phase === "battle" && c.phaseElapsed < 2)))) return { ok: false, reason: "too_early" };
  const maxR = S.rounds.reduce((a, m) => Math.max(a, m.round), 0);
  if (round !== maxR + 1) return { ok: false, reason: "out_of_order" };
  if (S.rounds.some((m) => !m.resolved)) return { ok: false, reason: "prev_unsettled" };
  if (c.over && round > 1) return srvFinish("timeout");
  const alive = rowsOf().filter((p) => p.alive).map((p) => p.player_id), n = alive.length;
  if (n <= 1) return srvFinish("last_one");
  let best = null, bestRep = 1e9;
  for (let a = 0; a < 12; a++) {
    const cand = alive.slice().sort(() => rnd() - 0.5); let rep = 0;
    for (let i = 0; i < Math.floor(n / 2); i++) if (S.rounds.some((m) => m.round === round - 1 && m.p2 && ((m.p1 === cand[2 * i] && m.p2 === cand[2 * i + 1]) || (m.p1 === cand[2 * i + 1] && m.p2 === cand[2 * i])))) rep++;
    if (rep < bestRep) { best = cand; bestRep = rep; } if (!bestRep) break;
  }
  let k = 0;
  for (let i = 0; i < Math.floor(n / 2); i++) { k++; S.rounds.push({ event_id: "EV1", round, k, p1: best[2 * i], p2: best[2 * i + 1], ghost_of: null, seed: `s${round}-${k}-${Math.floor(rnd() * 1e9)}`, board1: snapshotOf(best[2 * i], round), board2: snapshotOf(best[2 * i + 1], round), result: null, resolved: false, created_at: iso() }); }
  if (n % 2) { const lone = best[n - 1], others = alive.filter((x) => x !== lone), ghost = others[Math.floor(rnd() * others.length)]; k++; S.rounds.push({ event_id: "EV1", round, k, p1: lone, p2: null, ghost_of: ghost, seed: `s${round}-${k}-${Math.floor(rnd() * 1e9)}`, board1: snapshotOf(lone, round), board2: snapshotOf(ghost, round), result: null, resolved: false, created_at: iso() }); }
  alive.forEach((id) => (S.players[id].sealed_round = round));
  return { ok: true, matches: k };
}
function srvSettle(round, k, by, outcomes) {
  const m = S.rounds.find((x) => x.round === round && x.k === k); if (!m) return { ok: false, reason: "no_match" };
  if (m.resolved) return { ok: true, already: true };
  const need = m.p2 == null ? 1 : 2;
  if (!Array.isArray(outcomes) || outcomes.length !== need) return { ok: false, reason: "bad_outcomes" };
  const seen = new Set();
  for (const o of outcomes) {
    if (o.player_id !== m.p1 && o.player_id !== m.p2) throw new Error("autochess_outcome_player_not_in_match");
    if (seen.has(o.player_id)) throw new Error("autochess_outcome_duplicate_player"); seen.add(o.player_id);
    if (!["win", "lose", "draw"].includes(o.res)) throw new Error("autochess_bad_res");
    const dmg = o.res === "lose" ? Math.max(0, Math.min(999, o.dmg | 0)) : 0, pl = S.players[o.player_id];
    const patch = {}; ["gold", "streak", "bestStreak", "perks"].forEach((key) => { if (o.patch && o.patch[key] !== undefined) patch[key] = clone(o.patch[key]); });
    const oldGold = pl.state.gold == null ? 0 : pl.state.gold;
    if (patch.gold != null && (patch.gold < 0 || patch.gold > oldGold + 80)) { S.log.push({ round, kind: "gold_clamped", detail: { old: oldGold, new: patch.gold } }); patch.gold = Math.max(0, Math.min(patch.gold, oldGold + 80)); }
    pl.hp -= dmg; if (o.res === "win") pl.wins++; if (o.res === "lose") pl.losses++;
    pl.state = Object.assign({}, pl.state, patch); pl.state_rev++; pl.settled_round = Math.max(pl.settled_round, round);
    if (o.stat) S.stats.push({ round, player_id: o.player_id, stat: o.stat });
  }
  m.result = { outcomes: clone(outcomes) }; m.resolved = true; m.resolved_by = by;
  if (!S.rounds.some((x) => x.round === round && !x.resolved)) {
    rowsOf().forEach((p) => { if (p.alive && p.hp <= 0) { p.alive = false; p.eliminated_round = round; p.overflow = Math.max(-p.hp, 0); } });
    const aliveN = rowsOf().filter((p) => p.alive).length, c = clockOf();
    if (aliveN <= 1) srvFinish("last_one"); else if (c.over) srvFinish("timeout");
    return { ok: true, roundDone: true, alive: aliveN };
  }
  return { ok: true, roundDone: false };
}
function srvControl(action, sec) {
  const run = S.ev.rules.autochess.run; if (!run || run.endedAt) return { ok: false };
  if (action === "pause") { if (!run.pausedAt) run.pausedAt = iso(); }
  else if (action === "resume") { if (run.pausedAt) { run.pausedTotal += (V.now - Date.parse(run.pausedAt)) / 1000; run.pausedAt = null; } }
  else if (action === "extend") { const c = clockOf(); if (c.phase !== "prep") return { ok: false, reason: "not_prep" }; run.extra[c.round] = Math.min((run.extra[c.round] || 0) + sec, 600); }
  else if (action === "finish") return srvFinish("admin");
  return { ok: true };
}
function srvFinish(reason) {
  const run = S.ev.rules.autochess.run; if (!run) return { ok: false, reason: "not_started" }; if (run.endedAt) return { ok: true, already: true };
  const rk = rowsOf().slice().sort((a, b) => (b.alive - a.alive) || (a.alive && b.alive ? b.hp - a.hp : 0) || ((b.eliminated_round || 0) - (a.eliminated_round || 0)) || (a.overflow - b.overflow) || (b.wins - a.wins) || (a.player_id < b.player_id ? -1 : 1));
  rk.forEach((p, i) => (p.final_rank = i + 1)); run.endedAt = iso(); run.endReason = reason; run.pausedAt = null; return { ok: true, reason };
}

// ---------------- 每位玩家一個獨立環境 ----------------
const errors = [], warns = [];
const clients = [];
function makeClient(pid, name, { search } = {}) {
  const me = { pid, name, dead: false, offline: false, stats: { spectate: 0, battles: 0, results: 0, over: 0 }, handlers: {} };
  const ctx = vm.createContext({}); ctx.window = ctx; ctx.self = ctx; me.ctx = ctx;
  ctx.console = { log() {}, info() {}, warn: (...a) => warns.push(`[${name}] ` + a.map(String).join(" ").slice(0, 160)), error: (...a) => errors.push(`[${name}] ` + a.map(String).join(" ").slice(0, 300)) };
  ctx.setTimeout = (fn, ms) => (fn ? addTimer(me, () => fn(), ms) : 0); ctx.clearTimeout = (id) => { if (id) clearTimer(id); };
  ctx.setInterval = (fn, ms) => addTimer(me, () => fn(), ms, ms); ctx.clearInterval = ctx.clearTimeout;
  ctx.URLSearchParams = URLSearchParams; ctx.addEventListener = () => {}; ctx.__vnow = () => V.now; ctx.location = { search: search || "?event=EV1" }; ctx.matchMedia = () => ({ matches: false }); ctx.innerHeight = 800;
  // 極簡 DOM:root.innerHTML 就是畫面;getElementById 只回傳「畫面上真的有的」id
  const mkEl = (id) => ({ id, innerHTML: "", textContent: "", className: "", style: {}, dataset: {}, checked: true, scrollHeight: 0, scrollTop: 0, clientHeight: 0, offsetWidth: 0, offsetHeight: 0, onclick: null,
    classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, closest: () => null, getBoundingClientRect: () => ({ left: 0, top: 0, bottom: 0, right: 0, width: 0, height: 0 }) });
  let idCache = {}; const extra = {};
  const root = mkEl("ac-root"); let html = "";
  Object.defineProperty(root, "innerHTML", { get: () => html, set: (v) => { html = String(v); idCache = {}; } });
  root.addEventListener = (ev, fn) => { me.handlers[ev] = fn; }; root.parentNode = { insertBefore: (el) => { extra[el.id] = el; } };
  const fixed = { "ac-root": root, "ac-modal": mkEl("ac-modal"), "ac-modal-card": mkEl("ac-modal-card") };
  const h1 = mkEl("h1"); me.h1 = h1;
  ctx.document = {
    getElementById: (id) => fixed[id] || extra[id] || ((html.includes(`id="${id}"`) || String(fixed["ac-modal-card"].innerHTML).includes(`id="${id}"`)) ? (idCache[id] = idCache[id] || mkEl(id)) : null),
    createElement: () => mkEl(""), querySelector: (sel) => (sel === ".marquee h1" ? h1 : null), addEventListener() {}, body: { appendChild() {} }, documentElement: { clientWidth: 400, clientHeight: 800 }, hidden: false,
  };
  ctx.ui = { esc: (s) => String(s == null ? "" : s), icon: () => "", confirm: async () => true, alert: async () => {} };
  const lat = async () => { if (me.offline) throw new Error("network down"); await new Promise((r) => ctx.setTimeout(r, 60)); if (me.offline) throw new Error("network down"); };
  const wrap = (name, fn) => async (...a) => { await lat(); count(name); return fn(...a); };
  ctx.db = {
    getLocalPlayer: () => (pid ? { id: pid, name } : { id: null, name: "" }),
    getEvent: wrap("getEvent", async () => clone(S.ev)),
    listParticipants: wrap("listParticipants", async () => S.parts.map((p) => ({ player_id: p.id, players: { name: p.name, is_bot: false } }))),
    autochessClock: wrap("clock", async () => clockOf()),
    autochessSaveState: wrap("save", async (e, p, rev, st, r) => srvSave(p, rev, st, r)),
    autochessPairRound: wrap("pair", async (e, r) => srvPair(r)),
    autochessSettleRound: wrap("settle", async (e, r, k, by, o) => srvSettle(r, k, by, o)),
    autochessReportMismatch: wrap("mismatch", async (e, r, k, by, mine) => { S.log.push({ round: r, kind: "mismatch", detail: { k, by, mine } }); }),
    getAutochessPlayer: wrap("getPlayer", async (e, p) => (S.players[p] ? clone(S.players[p]) : null)),
    listAutochessPlayers: wrap("listPlayers", async () => rowsOf().map(clone)),
    getAutochessMatch: wrap("getMatch", async (e, r, p) => { const m = S.rounds.find((x) => x.round === r && (x.p1 === p || x.p2 === p)); return m ? clone(m) : null; }),
    listAutochessMatches: wrap("matches", async (e, r) => S.rounds.filter((m) => m.round === r).map(clone)),
    listAutochessUnresolved: wrap("unresolved", async () => S.rounds.filter((m) => !m.resolved).map(clone)),
    TITLE_CATALOG: [],
    getPlayerProfiles: wrap("profiles", async () => ({})),
    awardAutochessTitlesFor: wrap("award", async () => []),
    listAutochessStats: wrap("stats", async () => []),
    closeAutochessEvent: wrap("close", async () => {
      if (S.ev.status === "closed") return { already: true };
      rowsOf().filter((r) => r.final_rank != null).forEach((r) => { r.reward = (S.ev.reward_plan.items || [])[r.final_rank - 1] || null; }); S.ev.status = "closed"; return { already: false };
    }),
  };
  for (const f of ["autochess-data.js", "autochess-engine.js", "autochess-bot.js", "autochess-game.js", "autochess-awards.js", "autochess-sfx.js"]) vm.runInContext(fs.readFileSync(path.join(ASSETS, f), "utf8"), ctx, { filename: f });
  vm.runInContext("Date.now = () => __vnow();", ctx);
  me.root = root; me.html = () => html;
  me.load = () => vm.runInContext(fs.readFileSync(path.join(ASSETS, "autochess.js"), "utf8"), ctx, { filename: "autochess.js" });
  me.clickWatch = (k) => me.handlers.click && me.handlers.click({ target: { closest: (sel) => (sel === "[data-watch]" ? { dataset: { watch: String(k) } } : null) } });
  me.click = (dataset) => me.handlers.click && me.handlers.click({ target: { closest: (sel) => (sel === "[data-act]" ? { dataset } : null) } });
  clients.push(me); return me;
}
process.on("unhandledRejection", (e) => errors.push("unhandledRejection: " + (e && e.stack || e)));

// ---------------- 場景 B:兩個分頁、暫停、加時、中途重新載入、時間到結束 ----------------
async function scenarioB() {
  console.log("\n== 場景 B:同帳號兩個分頁 / 暫停 / 加時 / 重新載入 / 時間到 ==");
  V.timers = []; clients.length = 0; errors.length = 0; warns.length = 0;
  S.ev = { id: "EV1", name: "測試場B", game_type: "autochess", status: "open", locked: false, rules: { autochess: {} }, reward_plan: { items: ["金", "銀"] } };
  S.players = {}; S.rounds = []; S.stats = []; S.log = []; S.parts = []; S.calls = {}; S.rejects = {};
  ["p1", "p2", "p3", "p4"].forEach((id) => S.parts.push({ id, name: "B" + id }));
  const a1 = makeClient("p1", "B1"), a1b = makeClient("p1", "B1分頁2"), a2 = makeClient("p2", "B2"), a3 = makeClient("p3", "B3"), a4 = makeClient("p4", "B4");
  [a1, a1b, a2, a3, a4].forEach((c) => c.load());
  await pump(V.now + 3000);
  const t0 = V.now; srvStart({ leadSec: 10, prepSec: [60], limitSec: 560 });
  const buy = (c) => { const tick = () => { if (c.dead) return; if (c.html().includes("ac-seal-note")) { for (let i = 0; i < 5; i++) c.click({ act: "shop", i: String(i) }); c.click({ act: "own", zone: "bench", i: "0" }); c.click({ act: "toggle" }); } addTimer(c, tick, 4000); }; addTimer(c, tick, 4000); };
  [a1, a1b, a2, a3, a4].forEach(buy);
  let paused = false, resumed = false, extended = false, reloaded = false, a2r = null;
  const ctl = () => {
    const c = clockOf();
    if (c.started && !paused && c.round === 2 && c.phase === "prep" && c.left < 40) { paused = true; srvControl("pause"); addTimer(null, () => { srvControl("resume"); resumed = true; }, 30000); }
    if (resumed && !extended && c.round === 2 && c.phase === "prep") { extended = true; srvControl("extend", 20); }
    if (!reloaded && c.round === 3 && c.phase === "prep" && c.left < 30) { reloaded = true; a2.dead = true; a2.offline = true; a2r = makeClient("p2", "B2重新載入"); a2r.load(); buy(a2r); }
    addTimer(null, ctl, 1000);
  };
  addTimer(null, ctl, 1000);
  await pump(V.now + 100 * 90 * 1000, () => S.ev.rules.autochess.run.endedAt && S.ev.status === "closed");
  await pump(V.now + 15000);
  const run = S.ev.rules.autochess.run, lastRound = Math.max(...S.rounds.map((m) => m.round));
  console.log(`   (${Math.round((V.now - t0) / 1000)} 虛擬秒、${lastRound} 輪;存檔被拒:${JSON.stringify(S.rejects)};結束原因:${run.endReason})`);
  console.log("   名次:" + Object.values(S.players).sort((x, y) => x.final_rank - y.final_rank).map((p) => `${p.final_rank}.${p.players.name}(${p.alive ? "hp" + p.hp : "R" + p.eliminated_round + "淘汰"})`).join("  "));
  t("B:暫停有生效(伺服器累計暫停秒數約 30)", () => { ok(paused && resumed, "劇本沒觸發暫停"); ok(Math.abs(run.pausedTotal - 30) < 3, "pausedTotal=" + run.pausedTotal); });
  t("B:加時有生效(第 2 輪準備多 20 秒)", () => ok(extended && run.extra[2] === 20, JSON.stringify(run.extra)));
  t("B:時間到結束(timeout),名次依存活者血量排序", () => {
    eq(run.endReason, "timeout");
    const alive = Object.values(S.players).filter((p) => p.alive).sort((x, y) => x.final_rank - y.final_rank);
    for (let i = 1; i < alive.length; i++) ok(alive[i - 1].hp >= alive[i].hp, "存活者名次沒有照血量排");
  });
  t("B:名次 1..4 各一個", () => eq(Object.values(S.players).map((p) => p.final_rank).sort(), [1, 2, 3, 4]));
  t("B:兩個分頁同時操作同一帳號:有版本衝突被擋下、沒有例外、所有場次都結算", () => { ok((S.rejects.rev || 0) > 0, "沒有出現版本衝突,測試沒有覆蓋到兩分頁"); ok(S.rounds.every((m) => m.resolved)); eq(errors.slice(0, 3), []); });
  t("B:中途重新載入的玩家接得上(繼續被配對並結算到最後)", () => { ok(a2r && a2r.html().length > 0); const rows = S.rounds.filter((m) => m.round >= 4 && (m.p1 === "p2" || m.p2 === "p2")); ok(rows.length > 0 || !S.players.p2.alive, "重新載入後 p2 沒再打過"); });
  t("B:沒有結算不一致、沒有金額被夾住", () => eq(S.log.filter((l) => l.kind === "mismatch" || l.kind === "gold_clamped"), []));
  t("B:前端沒有吞掉的例外", () => eq(warns.filter((w) => /TypeError|ReferenceError|RangeError/.test(w)).slice(0, 3), []));
  t("B:活動關閉、獎勵發放", () => { eq(S.ev.status, "closed"); eq(Object.values(S.players).find((p) => p.final_rank === 1).reward, "金"); });
}

// ---------------- 測試劇本 ----------------
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; console.log("  ✓ " + name); } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || "條件不成立"); };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "不相等") + `:得到 ${JSON.stringify(a)},預期 ${JSON.stringify(b)}`); };

(async () => {
  const names = { p1: "阿明", p2: "小華", p3: "大雄", p4: "斷線仔", p5: "掛網王" };
  Object.keys(names).forEach((id) => S.parts.push({ id, name: names[id] }));

  // 玩家 5(掛網王)從不進頁面;玩家 4 中途斷線;旁觀者 spec 不是參賽者
  const c1 = makeClient("p1", "阿明"), c2 = makeClient("p2", "小華"), c3 = makeClient("p3", "大雄"), c4 = makeClient("p4", "斷線仔"), spec = makeClient("spec", "旁觀者");
  const nologin = makeClient(null, "未登入");

  console.log("== 載入與等待開始 ==");
  [c1, c2, c3, c4, spec].forEach((c) => c.load()); nologin.load();
  await pump(V.now + 4000);
  t("未登入:提示先登入,不會丟例外", () => ok(nologin.html().includes("請先登入")));
  t("活動還沒開始:顯示等待畫面與報名人數", () => { ok(c1.html().includes("等待開始") && c1.html().includes("5 人報名"), c1.html().slice(0, 200)); });
  t("標題換成活動名稱", () => ok(c1.h1.innerHTML.includes("測試場")));

  console.log("== 開始 → 倒數 ==");
  const t0 = V.now; srvStart({ leadSec: 15 });
  await pump(V.now + 6000);
  t("倒數畫面出現,每人的初始狀態已存檔(stateRound=0)", () => { ok(c1.html().includes("即將開始")); ["p1", "p2", "p3", "p4"].forEach((id) => eq(S.players[id].state.stateRound, 0, id)); });
  t("沒進頁面的人(p5)狀態還是空的", () => eq(S.players.p5.state, {}));

  console.log("== 整場對戰 ==");
  const seen = { prep: new Set(), battle: new Set(), result: new Set() };
  const buyer = (c) => { // 每 3 秒:在準備畫面買卡、整理上陣
    const tick = () => {
      if (c.dead) return; const h = c.html();
      if (h.includes("ac-seal-note") && h.includes('data-act="shop"') !== undefined) {
        for (let i = 0; i < 5; i++) c.click({ act: "shop", i: String(i) });
        c.click({ act: "own", zone: "bench", i: "0" }); c.click({ act: "toggle" });
        c.click({ act: "own", zone: "bench", i: "0" }); c.click({ act: "toggle" });
        if (Math.random() < 0.3) c.click({ act: "refresh" });
      }
      addTimer(c, tick, 3000);
    };
    addTimer(c, tick, 3000);
  };
  [c1, c2, c3].forEach(buyer);
  // p4 在第 3 輪準備中途斷線(整個環境停掉,不再送任何請求)
  let killed = false;
  let c4rounds = 0;
  const watcher = () => {
    const c = clockOf(); if (c.started && c.phase) { (seen[c.phase] || new Set()).add(c.round); }
    if (!killed && c.round >= 3 && c.phase === "prep") { killed = true; c4.dead = true; c4.offline = true; }
    addTimer(null, watcher, 1000);
  };
  addTimer(null, watcher, 1000);
  // 旁觀者與每個人的畫面統計
  const sampler = () => { clients.forEach((c) => { const h = c.html(); if (h.includes("觀戰中")) c.stats.spectate++; if (h.includes("戰報") && h.includes("ac-bfield")) c.stats.battles++; if (h.includes("本輪獲得")) c.stats.results++; if (h.includes("最終名次")) c.stats.over++; if (h.includes("看這場對戰") && h.includes("VS")) c.stats.matchList = (c.stats.matchList || 0) + 1; });
    // 旁觀者第一次看到對戰列表時,點「看這場對戰」,之後要能自己回到列表
    if (!spec.clickedWatch) { const m = /data-watch="(\d+)"/.exec(spec.html()); if (m) { spec.clickedWatch = true; spec.clickWatch(m[1]); spec.watchStartBattles = spec.stats.battles; } } addTimer(null, sampler, 2000); };
  addTimer(null, sampler, 2000);

  await pump(V.now + 200 * 120 * 1000, () => S.ev.rules.autochess.run.endedAt && S.ev.status === "closed");
  await pump(V.now + 20000);

  const run = S.ev.rules.autochess.run, lastRound = Math.max(...S.rounds.map((m) => m.round));
  console.log(`   (模擬了 ${Math.round((V.now - t0) / 1000)} 虛擬秒,共 ${lastRound} 輪,RPC 呼叫:${JSON.stringify(S.calls)})`);
  const ranks = rowsOf().map((p) => `${p.final_rank}.${p.players.name}(${p.alive ? "存活 hp" + p.hp : "R" + p.eliminated_round + "淘汰"} ${p.wins}勝${p.losses}敗)`).sort();
  console.log("   名次:" + ranks.join("  "));

  t("活動有結束(endedAt)而且沒有跑到上限", () => { ok(run.endedAt, "沒有結束"); ok(lastRound < 60, "輪數過多:" + lastRound); });
  t("名次 1..5 各一個、沒有重複", () => eq(rowsOf().map((p) => p.final_rank).sort(), [1, 2, 3, 4, 5]));
  t("只剩 1 人存活(或時間到),第 1 名存活", () => { eq(run.endReason, "last_one"); ok(rowsOf().find((p) => p.final_rank === 1).alive); });
  t("每一輪的每場都結算了;每位存活者每輪剛好打一場", () => {
    ok(S.rounds.every((m) => m.resolved), "有場次沒結算");
    for (let r = 1; r <= lastRound; r++) { const ids = S.rounds.filter((m) => m.round === r).flatMap((m) => [m.p1, m.p2].filter(Boolean)); eq(new Set(ids).size, ids.length, `R${r} 有人打兩場`); }
  });
  t("奇數人時有幽靈戰,幽靈戰只結算一方", () => { const gh = S.rounds.filter((m) => m.p2 == null); ok(gh.length > 0, "測試沒有出現幽靈戰"); ok(gh.every((m) => m.result.outcomes.length === 1)); });
  t("沒有結算不一致(各客戶端算的跟伺服器存的一樣)", () => eq(S.log.filter((l) => l.kind === "mismatch"), []));
  t("沒有金額被夾住(正常結算不會超過上限)", () => eq(S.log.filter((l) => l.kind === "gold_clamped"), []));
  t("沒進頁面的 p5(掛網)也被對戰、結算、淘汰,沒有卡住全場", () => { ok(S.players.p5.losses + S.players.p5.wins > 0); ok(S.players.p5.final_rank != null); });
  t("斷線的 p4 一樣被其他人幫忙結算(沒有卡在 unsettled)", () => { ok(S.players.p4.wins + S.players.p4.losses >= 3, "p4 只打了 " + (S.players.p4.wins + S.players.p4.losses) + " 場"); });
  t("活動被關閉、獎勵發放(第 1 名拿到「金」)", () => { eq(S.ev.status, "closed"); eq(rowsOf().find((p) => p.final_rank === 1).reward, "金"); });
  t("正常玩家看到了戰鬥演出與結算卡", () => { [c1, c2, c3].forEach((c) => { if (c.stats.battles + c.stats.results === 0) throw new Error(c.name + " 沒看到戰鬥或結算畫面"); }); });
  t("觀戰:旁觀者看得到本輪對戰列表、點了能看演出、演完回到列表", () => {
    ok((spec.stats.matchList || 0) >= 1, "旁觀者沒有看到對戰列表");
    ok(spec.clickedWatch, "沒有點到「看這場對戰」");
    ok(spec.stats.battles > (spec.watchStartBattles || 0), "點了之後沒有出現戰鬥演出");
    ok(spec.stats.spectate > 5 && spec.html().includes("最終名次"), "演完要回到觀戰、最後看到最終名次");
  });
  t("旁觀者全程在觀戰、最後看到最終名次", () => { ok(spec.stats.spectate > 5, "觀戰畫面次數:" + spec.stats.spectate); ok(spec.html().includes("最終名次")); });
  t("被淘汰的玩家轉成觀戰,最後看到最終名次", () => { const dead = [c1, c2, c3].filter((c) => !S.players[c.pid].alive); dead.forEach((c) => ok(c.html().includes("最終名次"), c.name + " 沒看到最終名次")); });
  t("獲勝的玩家看到「夜市棋王」", () => { const w = rowsOf().find((p) => p.final_rank === 1); const c = clients.find((x) => x.pid === w.player_id); if (c && !c.dead) ok(c.html().includes("夜市棋王"), "冠軍畫面:" + c.html().slice(0, 120)); });
  t("存檔被伺服器拒絕的次數很少(單一分頁的正常流程不該被拒)", () => { const n = Object.values(S.rejects || {}).reduce((a, b) => a + b, 0); console.log("   存檔被拒:" + JSON.stringify(S.rejects || {})); ok(n <= 6, "被拒 " + n + " 次"); });
  t("前端沒有吞掉的例外(console.warn 裡不該有 TypeError / ReferenceError)", () => eq(warns.filter((w) => /TypeError|ReferenceError|RangeError/.test(w)).slice(0, 3), []));
  t("沒有任何前端例外(timer / unhandledRejection / console.error)", () => { eq(errors.slice(0, 5), []); });

  await scenarioB();
  if (warns.length) console.log("   警告(前 5 筆):\n    " + warns.slice(0, 5).join("\n    "));
  console.log(`\n${fail ? "✗" : "✓"} ${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("測試程式本身出錯:", e); process.exit(2); });
