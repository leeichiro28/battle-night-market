// 夜市自走棋 數值模擬器(Node 執行,不需要資料庫)。
//   node tools/autochess-sim.js game     整場長度:8 人混合策略完整對局,輪數/淘汰分布/打烊鐘與回合上限觸發率(--n 200 --players 8)
//   node tools/autochess-sim.js tags     流派勝率:8 人場每個流派各 2 位專攻玩家,看名次與對戰勝率;另列「實際上陣主流派」的對戰勝率
//   node tools/autochess-sim.js saver    金庫風險:「存錢」vs「正常買」對照(--reserve 30 最少留幾個銅板不花;--panic 40 讓存錢玩家血量低於 40 就開始花)
//   node tools/autochess-sim.js econ     經濟曲線:正常玩家每輪銅板/等級/上陣張數/金庫利息
//   node tools/autochess-sim.js matrix   流派兩兩對打勝率矩陣(純戰鬥,不含經濟,單流派陣容;--level 6 --star 1 --n 300)
// 直接載入 assets/ 底下真正的 autochess-*.js,戰鬥結果跟遊戲裡用的是同一套引擎。
//
// 已知限制(解讀結果時要記得):
//  - 玩家 AI 是簡單貪心(買分數最高的卡、湊對子、固定升級節奏),真人會更會取捨;絕對勝率只看相對關係
//  - 不含攤位加碼、怪物輪、機器人以外的任何策略;配對為純隨機(沒有避免連續遇到同一人)
//  - 選項:--tweak 檔案.json 可覆蓋 AutochessData 數值,例如 {"INTEREST.max":2,"INTEREST.startRound":4}
const path = require("path"), fs = require("fs");
global.window = global;
const A = (f) => require(path.join(__dirname, "..", "assets", f));
A("autochess-data.js"); A("autochess-engine.js");
const AD = window.AutochessData, E = window.AutochessEngine;

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k, d) => { const i = args.indexOf("--" + k); return i < 0 ? d : isNaN(Number(args[i + 1])) ? args[i + 1] : Number(args[i + 1]); };
const tw = opt("tweak", null);
if (tw) {
  const o = JSON.parse(fs.readFileSync(tw, "utf8"));
  Object.keys(o).forEach((k) => { const ps = k.split("."); let t = AD; for (let i = 0; i < ps.length - 1; i++) t = t[ps[i]]; t[ps[ps.length - 1]] = o[k]; });
}
const pct = (x) => (x * 100).toFixed(1) + "%";
const avg = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);
const pad = (s, n) => { s = String(s); let w = 0; for (const ch of s) w += ch.charCodeAt(0) > 255 ? 2 : 1; return s + " ".repeat(Math.max(0, n - w)); };
const TAGS = Object.keys(AD.TAGS);

// ---------------- 玩家 AI ----------------
const LEVEL_TARGET = [1, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10]; // 索引=輪次-1
const targetLevel = (round) => LEVEL_TARGET[Math.min(round, LEVEL_TARGET.length) - 1];
const cardOf = (c) => AD.CARD_BY_ID[c.id];
const power = (c) => { const d = cardOf(c); return (d.atk * 3 + d.hp) * AD.STAR.stat[c.star]; };

function newPlayer(id, strat) {
  return { id, strat, hp: AD.START_HP, gold: AD.START_GOLD, level: 1, xp: 0, streak: 0, wins: 0, losses: 0, board: [], bench: [], alive: true, elimRound: 0, overflow: 0, battles: [], goldHist: [], idleRounds: 0 };
}
function countOwned(p, id, star) { return p.board.concat(p.bench).filter((c) => c.id === id && c.star === star).length; }

// 把持有的卡排成上陣陣容:挑戰力最高的 slots 張(專攻流派加分);前排放血厚的,壓軸放有壓軸效果的
function arrange(p) {
  const all = p.board.concat(p.bench), slots = AD.slotsFor(p.level);
  const focus = p.strat.focus;
  const score = (c) => {
    const d = cardOf(c);
    let s = power(c) + (focus && d.tags.includes(focus) ? 8 : 0) + d.cost * 1.5;
    return s;
  };
  // 先挑出「不同名優先」讓羈絆有機會成立:依分數排序後,同名重複的往後放
  const sorted = all.slice().sort((x, y) => score(y) - score(x));
  const picked = [], rest = [], seen = {};
  sorted.forEach((c) => { if (picked.length < slots && !seen[c.id]) { picked.push(c); seen[c.id] = 1; } else rest.push(c); });
  while (picked.length < slots && rest.length) picked.push(rest.shift());
  const hasFinale = (c) => (cardOf(c).fx.concat([]).some((e) => e.when === "finale")) ;
  const finale = picked.filter(hasFinale), others = picked.filter((c) => !hasFinale(c)).sort((x, y) => cardOf(y).hp * AD.STAR.stat[y.star] - cardOf(x).hp * AD.STAR.stat[x.star]);
  p.board = others.concat(finale.slice(0, 1)).concat(finale.slice(1));
  p.bench = rest;
}

function playPrep(p, round, evSeed) {
  if (round > 1) { const r = AD.addXp(p.level, p.xp, AD.PASSIVE_XP); p.level = r.level; p.xp = r.xp; }
  const s = p.strat;
  const panic = s.panicHp && p.hp < s.panicHp;
  const reserve = panic ? 0 : s.reserve || 0;
  let refresh = 0;
  const base = `${evSeed}|${p.id}`;
  let shop = E.rollShop(base, round, refresh, p.level);
  let guard = 0;
  const maxRefresh = s.reserve ? 6 : round < 4 ? 1 : 3;
  const capacity = () => AD.slotsFor(p.level) + AD.BENCH_SLOTS;
  while (guard++ < 40) {
    // 1) 買經驗
    if (p.level < targetLevel(round) && p.gold - AD.BUY_XP.cost >= reserve) {
      p.gold -= AD.BUY_XP.cost; const r = AD.addXp(p.level, p.xp, AD.BUY_XP.xp); p.level = r.level; p.xp = r.xp; continue;
    }
    // 2) 買卡:分數最高且買得起
    let best = -1, bestScore = -1;
    shop.forEach((id, i) => {
      if (!id) return;
      const d = AD.CARD_BY_ID[id];
      if (p.gold - d.cost < reserve) return;
      const full = p.board.length + p.bench.length >= capacity();
      const pairs = countOwned(p, id, 1) >= 1 || countOwned(p, id, 2) >= 1;
      if (full && !pairs) return;
      let sc = d.cost + (pairs ? 5 : 0) + (s.focus && d.tags.includes(s.focus) ? 3 : 0) + (!s.focus && d.tags.length ? 1 : 0);
      if (!pairs && d.tags.length === 0) sc -= 2; // 通用卡沒有羈絆,優先度低
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    if (best >= 0 && bestScore >= (round <= 2 ? 1 : 3)) {
      const id = shop[best]; shop[best] = null; p.gold -= AD.CARD_BY_ID[id].cost;
      p.bench.push({ id, star: 1 });
      const m = E.mergeCards(p.board, p.bench); p.board = m.board; p.bench = m.bench;
      arrange(p); continue;
    }
    // 3) 刷新
    if (refresh < maxRefresh && p.gold - 1 >= reserve + (round < 3 ? 99 : 0) && p.gold >= reserve + 2) {
      refresh++; p.gold -= 1; shop = E.rollShop(base, round, refresh, p.level); continue;
    }
    break;
  }
  arrange(p);
}

// ---------------- 對局 ----------------
function playGame(strats, seed) {
  const rng = E.makeRng("g|" + seed);
  const ps = strats.map((s, i) => newPlayer("p" + i, s));
  const evSeed = "ev" + seed;
  let round = 0, bellHits = 0, limitHits = 0, battles = 0, battleRounds = 0, elimCount = 0;
  const log = [];
  while (ps.filter((p) => p.alive).length > 1 && round < 40) {
    round++;
    const live = ps.filter((p) => p.alive);
    live.forEach((p) => playPrep(p, round, evSeed));
    const snap = {}; live.forEach((p) => (snap[p.id] = p.board.map((c) => ({ ...c }))));
    const order = rng.shuffle(live);
    const pairs = [];
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1], false]);
    if (order.length % 2) { const lone = order[order.length - 1]; const ghost = rng.pick(live.filter((x) => x !== lone)); pairs.push([lone, ghost, true]); }
    const outcomes = [];
    pairs.forEach(([a, b, ghost], k) => {
      const r = E.simulate(snap[a.id], snap[b.id], `${evSeed}|${round}|${k}`);
      battles++; battleRounds += r.rounds; if (r.bellRounds) bellHits++; if (r.endedBy === "limit") limitHits++;
      const ta = E.pickMainTag(snap[a.id]), tb = E.pickMainTag(snap[b.id]);
      outcomes.push({ p: a, res: r.winner === "a" ? "win" : r.winner === "b" ? "lose" : "draw", dmg: r.winner === "b" ? E.loseDamage(round, r.starsB) : 0, coins: r.bonusCoinsA, tag: ta, foe: tb });
      if (!ghost) outcomes.push({ p: b, res: r.winner === "b" ? "win" : r.winner === "a" ? "lose" : "draw", dmg: r.winner === "a" ? E.loseDamage(round, r.starsA) : 0, coins: r.bonusCoinsB, tag: tb, foe: ta });
    });
    outcomes.forEach((o) => {
      const p = o.p;
      const s = E.settleEconomy({ result: o.res, round, gold: p.gold, streak: p.streak, level: p.level, bonusCoins: o.coins });
      p.gold = s.gold; p.streak = s.streak;
      if (o.res === "win") p.wins++; else if (o.res === "lose") p.losses++;
      p.hp -= o.dmg; p.battles.push({ round, res: o.res, tag: o.tag });
      p.goldHist.push({ round, gold: s.gold - s.gain, interest: s.interest, level: p.level, units: p.board.length, hp: p.hp });
    });
    outcomes.forEach((o) => { if (o.p.hp <= 0 && o.p.alive) { o.p.alive = false; o.p.elimRound = round; o.p.overflow = -o.p.hp; elimCount++; } });
  }
  // 名次:存活者(剩 1 人 = 冠軍);淘汰者依淘汰輪次(晚者佳)、溢出傷害(小者佳)、勝場
  const ranked = ps.slice().sort((x, y) => (y.alive - x.alive) || (y.elimRound - x.elimRound) || (x.overflow - y.overflow) || (y.wins - x.wins));
  ranked.forEach((p, i) => (p.rank = i + 1));
  return { ps, rounds: round, bellHits, limitHits, battles, battleRounds };
}

// ---------------- 策略 ----------------
const S = {
  normal: (focus) => ({ name: "正常" + (focus ? "-" + AD.TAGS[focus].name : ""), focus: focus || null, reserve: 0 }),
  saver: (panic, reserve) => ({ name: "存錢" + reserve, focus: null, reserve: reserve == null ? 30 : reserve, panicHp: panic || 0 }),
};
function mixed(n) { const a = []; for (let i = 0; i < n; i++) a.push(S.normal(i % 3 === 2 ? null : TAGS[i % TAGS.length])); return a; }

// ---------------- 指令 ----------------
const N = opt("n", 200), PL = opt("players", 8);
function header(t) { console.log("\n=== " + t + " ==="); }

if (cmd === "game") {
  header(`整場長度:${PL} 人混合策略 × ${N} 場`);
  const rounds = [], bell = [], lim = [], br = [], elim = {};
  const first = [], hpAtEnd = [];
  for (let g = 0; g < N; g++) {
    const r = playGame(mixed(PL), g);
    rounds.push(r.rounds); bell.push(r.bellHits / r.battles); lim.push(r.limitHits / r.battles); br.push(r.battleRounds / r.battles);
    r.ps.forEach((p) => { if (!p.alive) elim[p.elimRound] = (elim[p.elimRound] || 0) + 1; });
    hpAtEnd.push(r.ps.filter((p) => p.alive).map((p) => p.hp)[0] || 0);
  }
  rounds.sort((a, b) => a - b);
  console.log(`全場輪數:平均 ${avg(rounds).toFixed(1)},最短 ${rounds[0]},中位 ${rounds[rounds.length >> 1]},最長 ${rounds[rounds.length - 1]}(目標 15~22)`);
  const inRange = rounds.filter((x) => x >= 15 && x <= 22).length / rounds.length; console.log(`落在 15~22 輪的比例:${pct(inRange)}`);
  console.log(`單場戰鬥平均 ${avg(br).toFixed(1)} 回合;打到打烊鐘(≥20 回合)的戰鬥 ${pct(avg(bell))};打滿 30 回合比血量的戰鬥 ${pct(avg(lim))}`);
  console.log(`冠軍結束時平均剩 ${avg(hpAtEnd).toFixed(0)} 血`);
  console.log("淘汰輪次分布(每場 " + (PL - 1) + " 人被淘汰):");
  Object.keys(elim).map(Number).sort((a, b) => a - b).forEach((k) => console.log("  R" + pad(k, 3) + " " + "#".repeat(Math.round(elim[k] / N / (PL - 1) * 100)) + " " + pct(elim[k] / N / (PL - 1))));
} else if (cmd === "tags") {
  header(`流派勝率:8 人場(每流派 2 位專攻)× ${N} 場`);
  const strats = []; TAGS.forEach((t) => { strats.push(S.normal(t)); strats.push(S.normal(t)); });
  const byFocus = {}, byMain = {};
  for (let g = 0; g < N; g++) {
    const r = playGame(strats, g);
    r.ps.forEach((p) => {
      const f = p.strat.focus; const o = byFocus[f] || (byFocus[f] = { rank: [], w: 0, l: 0, first: 0 });
      o.rank.push(p.rank); if (p.rank === 1) o.first++;
      p.battles.forEach((b) => { if (b.res === "win") o.w++; else if (b.res === "lose") o.l++; const k = b.tag || "none"; const m = byMain[k] || (byMain[k] = { w: 0, l: 0 }); if (b.res === "win") m.w++; else if (b.res === "lose") m.l++; });
    });
  }
  console.log("專攻流派       平均名次   冠軍率    對戰勝率(不含平手)");
  TAGS.forEach((t) => { const o = byFocus[t]; console.log(pad(AD.TAGS[t].name, 14) + pad(avg(o.rank).toFixed(2), 11) + pad(pct(o.first / (N * 2)), 10) + pct(o.w / (o.w + o.l))); });
  console.log("\n實際上陣主流派(不同名張數最多且 ≥2)的對戰勝率:");
  Object.keys(byMain).forEach((k) => { const m = byMain[k]; console.log(pad(k === "none" ? "無羈絆主流派" : AD.TAGS[k].name, 14) + pad(pct(m.w / (m.w + m.l)), 9) + `(${m.w + m.l} 場)`); });
  console.log("目標:各流派勝率 40%~60%");
} else if (cmd === "saver") {
  const panic = opt("panic", 0), reserve = opt("reserve", 30);
  header(`金庫風險:4 位「正常買」vs 4 位「存錢(至少留 ${reserve}${panic ? ",血<" + panic + " 就花" : ""})」× ${N} 場`);
  const strats = []; for (let i = 0; i < 4; i++) { strats.push(S.normal(TAGS[i])); strats.push(S.saver(panic, reserve)); }
  const agg = {};
  for (let g = 0; g < N; g++) {
    const r = playGame(strats, g);
    r.ps.forEach((p) => { const k = p.strat.reserve ? "存錢" : "正常買"; const o = agg[k] || (agg[k] = { rank: [], w: 0, l: 0, first: 0, early: { w: 0, l: 0 }, elim: [] }); o.rank.push(p.rank); if (p.rank === 1) o.first++; p.battles.forEach((b) => { if (b.res === "win") o.w++; else if (b.res === "lose") o.l++; if (b.round <= 4) { if (b.res === "win") o.early.w++; else if (b.res === "lose") o.early.l++; } }); });
  }
  console.log("策略      平均名次   冠軍率   對戰勝率   前 4 輪勝率");
  Object.keys(agg).forEach((k) => { const o = agg[k]; console.log(pad(k, 10) + pad(avg(o.rank).toFixed(2), 11) + pad(pct(o.first / (N * 4)), 9) + pad(pct(o.w / (o.w + o.l)), 11) + pct(o.early.w / (o.early.w + o.early.l))); });
  const a = avg(agg["存錢"].rank), b = avg(agg["正常買"].rank);
  console.log(a < b - 0.3 ? "!! 存錢策略明顯更強(名次領先 " + (b - a).toFixed(2) + "):依序調整 (1) INTEREST.max→2 (2) INTEREST.startRound→4 (3) 提高前期扣血" : "存錢策略沒有明顯優勢(名次差 " + (b - a).toFixed(2) + ")。");
} else if (cmd === "econ") {
  header(`經濟曲線:8 人混合場 × ${N} 場,只看「正常買」玩家`);
  const rows = {};
  for (let g = 0; g < N; g++) {
    const r = playGame(mixed(PL), g);
    r.ps.forEach((p) => p.goldHist.forEach((h) => { const o = rows[h.round] || (rows[h.round] = { gold: [], interest: [], level: [], units: [], hp: [] }); o.gold.push(h.gold); o.interest.push(h.interest); o.level.push(h.level); o.units.push(h.units); o.hp.push(h.hp); }));
  }
  console.log("輪次  存活樣本  結算前銅板  利息   等級   上陣張數  血量");
  Object.keys(rows).map(Number).sort((a, b) => a - b).forEach((k) => { const o = rows[k]; if (o.gold.length < N) return; console.log(pad("R" + k, 6) + pad(o.gold.length, 10) + pad(avg(o.gold).toFixed(1), 12) + pad(avg(o.interest).toFixed(2), 7) + pad(avg(o.level).toFixed(1), 7) + pad(avg(o.units).toFixed(1), 10) + avg(o.hp).toFixed(0)); });
} else if (cmd === "matrix") {
  const lv = opt("level", 6), star = opt("star", 1), n = opt("n", 300);
  header(`流派兩兩對打(純戰鬥):Lv${lv}(${AD.slotsFor(lv)} 格),卡牌 ${star}★,各 ${n} 場`);
  const slots = AD.slotsFor(lv);
  const mkBoard = (tag) => {
    // 單流派陣容:該流派(含雙流派)的卡依費用由高到低輪流填滿格數,同名可重複(重複不增加羈絆計數)
    const mine = AD.CARDS.filter((c) => c.tags.includes(tag)).sort((x, y) => y.cost - x.cost).map((c) => c.id);
    const ids = []; for (let i = 0; i < slots; i++) ids.push(mine[i % mine.length]);
    const fin = (id) => AD.CARD_BY_ID[id].fx.some((e) => e.when === "finale");
    const front = ids.filter((id) => !fin(id)).sort((x, y) => AD.CARD_BY_ID[y].hp - AD.CARD_BY_ID[x].hp), back = ids.filter(fin);
    return front.concat(back).map((id) => ({ id, star }));
  };
  const boards = TAGS.map(mkBoard);
  console.log(pad("", 10) + TAGS.map((t) => pad(AD.TAGS[t].name, 9)).join("") + "平均");
  const tot = TAGS.map(() => []);
  TAGS.forEach((ta, i) => {
    let line = pad(AD.TAGS[ta].name, 10);
    TAGS.forEach((tb, j) => {
      if (i === j) { line += pad("--", 9); return; }
      let w = 0, l = 0; for (let k = 0; k < n; k++) { const r = E.simulate(boards[i], boards[j], `m${i}${j}${k}`); if (r.winner === "a") w++; else if (r.winner === "b") l++; }
      const wr = w / (w + l || 1); tot[i].push(wr); line += pad(pct(wr), 9);
    });
    console.log(line + pct(avg(tot[i])));
  });
  console.log("(列 vs 欄:列方勝率。目標各流派平均 40%~60%)");
} else {
  console.log("用法:node tools/autochess-sim.js <game|tags|saver|econ|matrix> [--n 200] [--players 8] [--panic 40] [--level 6 --star 1] [--tweak 檔案.json]");
}
