// 職業養成對決 數值模擬器(Node 執行,不需要資料庫)。
//   node tools/sim.js leveling   升級速度:比較「舊規則」與「新規則」在不同玩法下,60 分鐘後的等級與樓層
//   node tools/sim.js winrate    勝率表:各等級的玩家(配點、無裝備)打各樓層的勝率(可加 --mhp 1.38 --matk 1.38 模擬怪物更強)
//   node tools/sim.js classes    職業平衡:6 個職業(各用典型配點)兩兩對打的勝率矩陣,看職業之間強弱(--gear 0.3 --n 300;--alloc 1 改用各職業典型配點)
//   任何指令都可加 --tweak 檔案.json:不改遊戲檔,臨時覆蓋 CareerData 的數值來試調整,例如 {"CLASS_EFFECTS.healer.regenPerRound": 0}
//   node tools/sim.js towers     爬塔難度:建議等級的玩家(統一配點+對應階的裝備,含/不含專精)打指定樓層的勝率(--floors 51,60,70 --n 200)
//   node tools/sim.js calibrate  校準 51 層以後的怪物:找出讓建議等級玩家勝率 ≈ --target 的怪物強度倍率(--floors 51,60,70 --target 0.65)
//   node tools/sim.js spec       專精平衡:12 條專精分支 vs 6 個沒專精的基準,爬塔勝率與互打勝率(--level 60 --slv 3 --n 150 --gear 0.3)
// 直接載入 assets/ 底下真正的 career-*.js,所以戰鬥結果跟遊戲裡用的是同一套引擎。
//
// 已知限制(解讀結果時要記得):
//  - 玩家沒有裝備、沒有技能點與被動加成;可用 --gear 0.2 粗略模擬「裝備讓攻/魔攻/防/HP 多 20%」
//  - 每場都從滿血開打(實際有 HP 持續與藥水)
//  - 配點是固定比例(主屬性 50%、防禦 25%、速度 10%、HP 15%),真人配點會不一樣
//  - 51 層以後的怪物還不存在,這個腳本目前只能驗證 1~50 層
const path = require("path");
const fs = require("fs");
global.window = global;
const A = (f) => require(path.join(__dirname, "..", "assets", f));
A("career-data.js");
A("career-engine.js");
A("career-floors.js");
A("career-pve.js");
A("career-spec.js");
// --tweak:在載入資料之後、跑模擬之前覆蓋數值。key 是「CareerData 底下的路徑」,例如 SKILL_TREE_NODES.healer_ult_1.effect.healRatio
{
  const ti = process.argv.indexOf("--tweak");
  if (ti >= 0) {
    const tw = JSON.parse(fs.readFileSync(process.argv[ti + 1], "utf8"));
    Object.keys(tw).forEach((path) => {
      const parts = path.split("."); let o = window.CareerData;
      for (let i = 0; i < parts.length - 1; i++) { o = o[parts[i]]; if (o == null) throw new Error("tweak 路徑不存在: " + path); }
      o[parts[parts.length - 1]] = tw[path];
    });
    console.log("(已套用假設調整:" + Object.keys(tw).join(", ") + ")\n");
  }
}
const CD = window.CareerData, CF = window.CareerFloors, PVE = window.CareerPve, SP = window.CareerSpec;

// 可重現的亂數
function seed(s) {
  Math.random = function () {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const args = process.argv.slice(2);
const cmd = args[0] || "leveling";
const opt = (name, def) => { const i = args.indexOf("--" + name); return i >= 0 ? Number(args[i + 1]) : def; };
let GEAR = opt("gear", 0);
const MINUTES = opt("minutes", 45); // 扣掉準備期,實際能打的分鐘數(總長 60)

function pointsAtLevel(level, rules) {
  let pts = 0;
  for (let L = 2; L <= level; L++) if (rules === "old" || CF.levelUpGivesPoints(L)) pts += 2;
  return pts;
}
// 各職業「典型配點」比例(玩家實際會怎麼點的假設,不是強制):--alloc 0(預設)= 全職業同一套(主屬性/防/速/血 = 50/25/10/15),--alloc 1 = 依職業典型配點。
// 職業平衡要看典型玩法才準:守衛本來就該點防禦與血量、法師要點魔力,全部套同一組配點對它們不公平。
const ARCH = {
  warrior: { atk: 0.5, def: 0.2, hp: 0.2, spd: 0.1 },
  guardian: { def: 0.35, hp: 0.4, atk: 0.15, spd: 0.1 },
  archer: { atk: 0.45, spd: 0.3, hp: 0.15, def: 0.1 },
  assassin: { atk: 0.4, luck: 0.25, spd: 0.2, hp: 0.15 },
  mage: { matk: 0.5, hp: 0.2, def: 0.1, mp: 0.2 },
  healer: { matk: 0.3, hp: 0.35, def: 0.15, mp: 0.2 },
};
function buildStats(classKey, level, rules) {
  const pts = pointsAtLevel(level, rules);
  if (opt("alloc", 0) === 1 && ARCH[classKey]) {
    const alloc = {}; let used = 0;
    Object.keys(ARCH[classKey]).forEach((k) => { alloc[k] = Math.round(pts * ARCH[classKey][k]); used += alloc[k]; });
    alloc.hp = (alloc.hp || 0) + (pts - used); // 四捨五入的餘數補到血量
    const s = CD.applyProgress(classKey, alloc, null);
    if (GEAR) ["atk", "matk", "def", "maxHp"].forEach((k) => (s[k] = Math.round(s[k] * (1 + GEAR))));
    s.hp = s.maxHp;
    return s;
  }
  const magic = CD.CLASS_INFO[classKey].path === "magic";
  const main = Math.round(pts * 0.5), def = Math.round(pts * 0.25), spd = Math.round(pts * 0.1);
  const hp = pts - main - def - spd;
  const alloc = { def, spd, hp };
  alloc[magic ? "matk" : "atk"] = main;
  const s = CD.applyProgress(classKey, alloc, null);
  if (GEAR) ["atk", "matk", "def", "maxHp"].forEach((k) => (s[k] = Math.round(s[k] * (1 + GEAR))));
  s.hp = s.maxHp;
  return s;
}
function sideFor(classKey, stats) {
  const ult = CD.resolveUltInfo(classKey, null, 1);
  return {
    classKey, stats: CD.applyStatBoostPassives(stats, {}), skillLevel: 1, skill2Level: 1,
    ultEffect: ult.effect, ultName: ult.name, critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0,
    ultCostReduce: 0, mastery: CD.classMasteryBonus(classKey, 0), lifestealOnHit: 0, dmgReduceRatio: 0,
  };
}
// --mhp / --matk:怪物 HP、攻擊倍率(模擬今夜主題與「怪物暴動」,例如中元夜+暴動 = 兩者相乘約 1.38)
const MHP = opt("mhp", 1), MATK = opt("matk", 1);
function fight(classKey, stats, floorDef) {
  const st = floorDef.stats;
  const mon = MHP === 1 && MATK === 1 ? st : { ...st, hp: Math.round(st.hp * MHP), maxHp: Math.round((st.maxHp || st.hp) * MHP), atk: Math.round(st.atk * MATK), matk: Math.round((st.matk || 0) * MATK) };
  return PVE.simulateFloorBattle(sideFor(classKey, stats), { classKey: floorDef.classKey, stats: mon });
}

// ---------- 升級速度 ----------
function runLeveling(classKey, rules, fightsPerMin) {
  const total = Math.round(fightsPerMin * MINUTES);
  let level = 6, exp = 0, floor = 0, fails = 0, farmLeft = 0, firstFiftyAt = null;
  let stats = buildStats(classKey, level, rules);
  const cap = CF.FLOORS.length;
  for (let i = 1; i <= total; i++) {
    let target;
    if (farmLeft > 0 && floor > 0) { target = floor; farmLeft--; }
    else target = Math.min(floor + 1, cap);
    const fd = CF.getFloor(target);
    const won = fight(classKey, stats, fd).won;
    if (!won) { fails++; if (fails >= 3 && floor > 0) { farmLeft = 10; fails = 0; } continue; }
    fails = 0;
    const isAdvance = target === floor + 1;
    let ratio = 1;
    if (rules === "new") ratio = isAdvance ? CF.FIRST_CLEAR_EXP_MULT : target <= floor ? CF.REPEAT_EXP_MULT : 1;
    if (isAdvance) { floor = target; if (floor === cap && firstFiftyAt === null) firstFiftyAt = i; }
    exp += Math.round(fd.expReward * ratio);
    let up = false;
    while (exp >= CF.expToNextLevel(level)) { exp -= CF.expToNextLevel(level); level++; up = true; }
    if (up) stats = buildStats(classKey, level, rules);
  }
  return { level, floor, firstFiftyAt };
}
function leveling() {
  const custom = opt("fpm", 0);
  const profiles = custom ? [[`自訂(每分鐘${custom}場)`, custom]] : [["狂刷(每分鐘33場)", 33], ["積極(每分鐘15場)", 15], ["一般(每分鐘6場)", 6]];
  console.log(`模擬 ${MINUTES} 分鐘,6 個職業取平均,裝備加成 ${GEAR * 100}%\n`);
  console.log("玩法".padEnd(20) + "舊規則(等級/樓層)".padEnd(22) + "新規則(等級/樓層)");
  for (const [name, f] of profiles) {
    const row = {};
    for (const rules of ["old", "new"]) {
      let lv = 0, fl = 0;
      CF.CLASS_KEYS.forEach((c, i) => { seed(1000 + i); const r = runLeveling(c, rules, f); lv += r.level; fl += r.floor; });
      row[rules] = `Lv.${Math.round(lv / 6)} / ${Math.round(fl / 6)} 層`;
    }
    console.log(name.padEnd(20) + row.old.padEnd(22) + row.new);
  }
  console.log("\n對照:玩家回報最新一場「狂刷」約 Lv.139 / 50 層;未狂刷約 Lv.50~70。目標:50 層時狂刷約 Lv.100。");
}

// ---------- 勝率表 ----------
function winrate() {
  const levels = [20, 40, 60, 80, 100, 120, 140, 160];
  const floors = [10, 20, 30, 40, 45, 50];
  const N = opt("n", 40);
  console.log(`勝率表(新點數規則,裝備加成 ${GEAR * 100}%,每格 ${N} 場 × 6 職業)\n`);
  console.log("等級\\樓層".padEnd(10) + floors.map((f) => String(f).padStart(7)).join(""));
  for (const L of levels) {
    let line = ("Lv." + L).padEnd(10);
    for (const f of floors) {
      let w = 0, t = 0;
      CF.CLASS_KEYS.forEach((c, ci) => { seed(7 + ci * 31 + L + f); const st = buildStats(c, L, "new"); for (let i = 0; i < N; i++) { t++; if (fight(c, st, CF.getFloor(f)).won) w++; } });
      line += (Math.round((w / t) * 100) + "%").padStart(7);
    }
    console.log(line);
  }
}
// ---------- 專精平衡 ----------
// 把「沒專精的基準(技能1+技能2,同等級)」跟 12 條專精分支(兩個專精技能)放在一起比:
//   爬塔:對各樓層的勝率;互打:18 個參賽者(6 基準 + 12 專精)兩兩對打,看平均勝率。
// 已知限制:雙方都用 PVE.decideAction(大招點滿就放、有魔力 50% 機率放技能),不會依局勢選招,
// 所以「一回合定生死」型的招(處決)與「持續型」的招(中毒)比真人實際表現保守。
function specSide(classKey, stats, branch, charLevel, slv) {
  const side = sideFor(classKey, stats);
  side.skillLevel = slv; side.skill2Level = slv;
  const ultLv = charLevel >= 100 ? 3 : charLevel >= 60 ? 2 : 1; // 大招等級與職業精通等級跟著角色等級(粗略假設)
  const ult = CD.resolveUltInfo(classKey, null, ultLv);
  side.ultEffect = ult.effect; side.ultName = ult.name;
  side.mastery = CD.classMasteryBonus(classKey, Math.min(CD.MAX_SKILL_LEVEL, slv));
  if (branch) {
    side.spec = SP.resolvePassive(classKey, branch, charLevel);
    side.skillEffectA = SP.resolveSkill(classKey, `spec_${branch}_skill_1`, slv, charLevel);
    side.skillEffectB = SP.resolveSkill(classKey, `spec_${branch}_skill_2`, slv, charLevel);
  }
  return side;
}
function pvp(sa, sb, n) {
  let w = 0;
  for (let i = 0; i < n; i++) {
    let st = window.CareerEngine.initialMatchState(sa, sb), r = 0;
    while (st.hp1 > 0 && st.hp2 > 0 && r < 30) { st.m1 = PVE.decideAction(st, 1); st.m2 = PVE.decideAction(st, 2); st = window.CareerEngine.resolveRound(st).state; r++; }
    w += st.hp1 > 0 && st.hp2 <= 0 ? 1 : st.hp1 <= 0 && st.hp2 > 0 ? 0 : 0.5;
  }
  return w / n;
}
function spec() {
  GEAR = opt("gear", 0.3);
  // 專精從 Lv.50 開始,這個等級的玩家打一般樓層幾乎必勝,沒有鑑別度,所以爬塔測試把怪物 HP/攻擊放大(--smhp/--satk)
  const SMHP = opt("smhp", 1.8), SATK = opt("satk", 1.35);
  const L = opt("level", 60), SLV = opt("slv", L >= 100 ? 5 : 3), N = opt("n", 150);
  const stats = {}; CF.CLASS_KEYS.forEach((c) => (stats[c] = buildStats(c, L, "new")));
  const PG = GEAR; GEAR = opt("pgear", 0); // 爬塔用另一組(預設無裝備加成)才有鑑別度;互打用 --gear
  const pstats = {}; CF.CLASS_KEYS.forEach((c) => (pstats[c] = buildStats(c, L, "new")));
  GEAR = PG;
  const names = {}; const players = [];
  CF.CLASS_KEYS.forEach((c) => {
    const cn = CD.CLASS_INFO[c].name;
    players.push({ id: c, label: cn + " 基準", c, b: null });
    ["a", "b"].forEach((b) => players.push({ id: c + b, label: cn + " " + SP.SPECS[c][b].name, c, b }));
  });
  console.log(`專精平衡:Lv.${L}(${L >= 100 ? "已升階" : "未升階"}),技能 Lv.${SLV},互打裝備加成 ${Math.round(GEAR * 100)}%,爬塔怪物 HP×${SMHP}/攻擊×${SATK},每組 ${N} 場\n`);
  // 1. 爬塔勝率
  const floors = opt("f1", 45) ? [opt("f1", 45), opt("f2", 48), opt("f3", 50)] : [40, 45, 50];
  console.log("【爬塔勝率】".padEnd(14) + floors.map((f) => ("第" + f + "層").padStart(8)).join(""));
  players.forEach((p, pi) => {
    let line = p.label.padEnd(14);
    floors.forEach((f) => {
      let w = 0; seed(31 * pi + f);
      for (let i = 0; i < N; i++) { const fd = CF.getFloor(f), st = fd.stats, mon = { ...st, hp: Math.round(st.hp * SMHP), maxHp: Math.round((st.maxHp || st.hp) * SMHP), atk: Math.round(st.atk * SATK), matk: Math.round((st.matk || 0) * SATK) }; if (PVE.simulateFloorBattle(specSide(p.c, pstats[p.c], p.b, L, SLV), { classKey: fd.classKey, stats: mon }).won) w++; }
      line += (Math.round((w / N) * 100) + "%").padStart(8);
    });
    console.log(line);
  });
  // 2. 互打
  const res = {}; players.forEach((p) => (res[p.id] = { sum: 0, n: 0, vsBase: 0, nb: 0 }));
  for (let i = 0; i < players.length; i++) for (let j = i + 1; j < players.length; j++) {
    const a = players[i], b = players[j]; if (a.c === b.c && !a.b && !b.b) continue;
    seed(i * 131 + j);
    const w = pvp(specSide(a.c, stats[a.c], a.b, L, SLV), specSide(b.c, stats[b.c], b.b, L, SLV), N);
    res[a.id].sum += w; res[a.id].n++; res[b.id].sum += 1 - w; res[b.id].n++;
    if (!b.b) { res[a.id].vsBase += w; res[a.id].nb++; } if (!a.b) { res[b.id].vsBase += 1 - w; res[b.id].nb++; }
  }
  console.log("\n【互打平均勝率】(對所有其他參賽者;理想是各分支落在 45%~55%,基準職業會因為沒專精略低)");
  console.log("參賽者".padEnd(14) + "平均勝率".padStart(8) + "  對基準勝率".padStart(12) + "  比自家基準".padStart(12));
  players.forEach((p) => {
    const r = res[p.id], base = res[p.c];
    const gain = p.b ? Math.round((r.sum / r.n - base.sum / base.n) * 100) : null;
    console.log(p.label.padEnd(14) + (Math.round((r.sum / r.n) * 100) + "%").padStart(8) + (r.nb ? (Math.round((r.vsBase / r.nb) * 100) + "%") : "-").padStart(12) + (gain == null ? "-" : (gain >= 0 ? "+" : "") + gain + "點").padStart(12));
  });
  console.log("\n解讀:「比自家基準」= 這條分支的平均勝率 - 同職業沒專精的平均勝率。理想約 +5~+12 點(Lv.100 升階後可略高);差距太大代表太強或太弱。職業之間本來就有強弱差(例如法師基準本來就低),看這欄比看絕對勝率準。");
}
// ---------- 職業平衡 ----------
function classes() {
  GEAR = opt("gear", 0.3);
  const N = opt("n", 300), levels = args.includes("--level") ? [opt("level", 60)] : [30, 60, 100, 140];
  const keys = CF.CLASS_KEYS, name = (c) => CD.CLASS_INFO[c].name;
  const total = {}; keys.forEach((c) => (total[c] = 0));
  console.log(`職業平衡(沒有專精),配點 ${opt("alloc", 0) === 1 ? "各職業典型配點" : "全職業同一套"},裝備加成 ${Math.round(GEAR * 100)}%,每組 ${N} 場(先後手各半)\n`);
  levels.forEach((L) => {
    const slv = L >= 100 ? 5 : L >= 60 ? 3 : 1;
    const st = {}; keys.forEach((c) => (st[c] = buildStats(c, L, "new")));
    const m = {}; keys.forEach((a) => { m[a] = {}; });
    keys.forEach((a, i) => keys.forEach((b, j) => {
      if (j <= i) return;
      seed(i * 97 + j * 13 + L);
      const w1 = pvp(specSide(a, st[a], null, L, slv), specSide(b, st[b], null, L, slv), Math.floor(N / 2));
      const w2 = 1 - pvp(specSide(b, st[b], null, L, slv), specSide(a, st[a], null, L, slv), Math.ceil(N / 2));
      const w = (w1 + w2) / 2; m[a][b] = w; m[b][a] = 1 - w;
    }));
    console.log(`【Lv.${L}】`.padEnd(10) + keys.map((c) => name(c).padStart(7)).join("") + "    平均");
    keys.forEach((a) => {
      let sum = 0, n = 0;
      const row = keys.map((b) => { if (a === b) return "-".padStart(7); sum += m[a][b]; n++; return (Math.round(m[a][b] * 100) + "%").padStart(7); }).join("");
      total[a] += sum / n;
      console.log(name(a).padEnd(10 - (name(a).length - 1)) + row + `    ${Math.round((sum / n) * 100)}%`);
    });
    console.log("");
  });
  console.log("各等級平均:" + keys.map((c) => `${name(c)} ${Math.round((total[c] / levels.length) * 100)}%`).join("  "));
  console.log("理想:每個職業都落在 45%~55%(完全平衡是 50%);石頭剪刀布式的相剋沒問題,但整體平均不要偏離太多。");
}
// ---------- 爬塔難度(51 層以後) ----------
// 設計目標(docs 28-2):51 層建議約 Lv.90(Lv.50~70 的一般玩家過不去)、60 層約 Lv.120、70 層約 Lv.160。
// 玩家 = 統一配點 + 該樓層那一階的「史詩」裝備三件(實際數值,不是百分比加成)+ 大招 Lv.3 + 技能 Lv.5;
// 「含專精」= 12 條專精分支平均,「不含專精」= 沒選專精(Lv.50 以後大多數人會選,所以以含專精為主要目標)。
const TOWER_LEVEL = [[51, 90], [60, 120], [70, 160]]; // 樓層 -> 建議等級(中間線性內插)
function recLevel(f) {
  if (f <= 51) return 90 - (51 - f) * 3;
  for (let i = 1; i < TOWER_LEVEL.length; i++) if (f <= TOWER_LEVEL[i][0]) { const [f0, l0] = TOWER_LEVEL[i - 1], [f1, l1] = TOWER_LEVEL[i]; return Math.round(l0 + ((f - f0) / (f1 - f0)) * (l1 - l0)); }
  return 160;
}
const GEAR_BY_TIER = { 1: { w: 4, def: 3, hp: 7, luck: 4 }, 2: { w: 9, def: 8, hp: 18, luck: 8 }, 3: { w: 13, def: 12, hp: 26, luck: 12 } }; // 該階史詩三件(見 career-floors.js)
function towerSide(c, L, branch, floorN) {
  const g = GEAR_BY_TIER[opt("tier", 0) || (floorN >= 61 ? 3 : floorN >= 51 ? 2 : 1)]; // --tier 1 可以模擬「還沒換到新階裝備」
  const st = { ...buildStats(c, L, "new") };
  const magic = CD.CLASS_INFO[c].path === "magic";
  st[magic ? "matk" : "atk"] += g.w; st.def += g.def; st.maxHp += g.hp; st.hp = st.maxHp; st.luck += g.luck;
  return specSide(c, st, branch, L, 5);
}
function towerRates(f, monStats, N, L) {
  L = L || opt("level", 0) || recLevel(f); // --level 可以指定玩家等級(例如測 Lv.60 的人打 51 層)
  const per = { base: 0, spec: 0 }, perClass = {};
  CF.CLASS_KEYS.forEach((c, ci) => {
    const mc = CF.CLASS_KEYS[f % CF.CLASS_KEYS.length];
    const run = (br, seedN) => { let w = 0; seed(seedN); for (let i = 0; i < N; i++) if (PVE.simulateFloorBattle(towerSide(c, L, br, f), { classKey: mc, stats: { ...monStats } }).won) w++; return w / N; };
    const b = run(null, 11 + ci), a = run("a", 21 + ci), bb = run("b", 31 + ci);
    perClass[c] = { base: b, spec: (a + bb) / 2 };
    per.base += b / CF.CLASS_KEYS.length; per.spec += ((a + bb) / 2) / CF.CLASS_KEYS.length;
  });
  return { ...per, perClass, L };
}
function refStats(L) { // 這個等級玩家的平均「主屬性/防禦/速度/血量/幸運」,當怪物強度的基準
  const arr = CF.CLASS_KEYS.map((c) => buildStats(c, L, "new")), avg = (fn) => arr.reduce((n, x) => n + fn(x), 0) / arr.length;
  return { atk: avg((x) => (CD.CLASS_INFO[arr.indexOf(x) >= 0 ? CF.CLASS_KEYS[arr.indexOf(x)] : "warrior"].path === "magic" ? x.matk : x.atk)), def: avg((x) => x.def), spd: avg((x) => x.spd), hp: avg((x) => x.maxHp), luck: avg((x) => x.luck) };
}
function monsterFrom(ref, m) { // m = {atk,def,hp} 倍率
  const atk = Math.round(ref.atk * m.atk);
  return { atk, matk: atk, def: Math.round(ref.def * m.def), spd: Math.round(ref.spd * (m.spd || 0.8)), hp: Math.round(ref.hp * m.hp), maxHp: Math.round(ref.hp * m.hp), luck: Math.round(ref.luck * 0.5) };
}
function towers() {
  GEAR = 0;
  const N = opt("n", 200), floors = (args[args.indexOf("--floors") + 1] || "50,51,55,60,65,70").split(",").map(Number);
  console.log(`爬塔勝率(建議等級玩家,統一配點+該階史詩裝備,技能 Lv.5,每格 ${N} 場 × 6 職業 × 3 種專精設定)\n`);
  console.log("樓層".padEnd(8) + "建議Lv".padStart(7) + "不含專精".padStart(10) + "含專精".padStart(9) + "   各職業(含專精)");
  floors.forEach((f) => {
    const fd = CF.getFloor(f); if (!fd) { console.log(String(f).padEnd(8) + "  (這層還沒開放)"); return; }
    const r = towerRates(f, fd.stats, N);
    console.log(String(f).padEnd(8) + String(r.L).padStart(7) + (Math.round(r.base * 100) + "%").padStart(10) + (Math.round(r.spec * 100) + "%").padStart(9) + "   " + CF.CLASS_KEYS.map((c) => CD.CLASS_INFO[c].name + " " + Math.round(r.perClass[c].spec * 100) + "%").join("  "));
  });
  if (floors.some((f) => f > 50 && !CF.getFloor(f))) console.log("\n(提示:51 層以後還沒開放時,用 calibrate 指令找怪物強度)");
}
function calibrate() {
  GEAR = 0;
  const N = opt("n", 120), target = opt("target", 0.65), floors = (args[args.indexOf("--floors") + 1] || "51,60,70").split(",").map(Number);
  console.log(`校準:找出讓「含專精」勝率 ≈ ${Math.round(target * 100)}% 的怪物強度(相對於同等級玩家的倍率;HP/攻擊/防禦等比放大),每次 ${N} 場\n`);
  floors.forEach((f) => {
    const L = recLevel(f), ref = refStats(L), boss = f % 10 === 0;
    let lo = 0.2, hi = 6, best = null;
    for (let it = 0; it < 12; it++) {
      const mid = (lo + hi) / 2;
      const mon = monsterFrom(ref, { atk: mid, def: mid, hp: mid * 1.6 }); // 怪物血量比同等玩家多一點(玩家有技能/大招/專精,怪物只會普攻)
      if (boss) { mon.hp = Math.round(mon.hp / 1.3); mon.maxHp = mon.hp; } // 關主有 ×1.3 的成長,這裡先還原,實際值再乘回去
      const r = towerRates(f, boss ? { ...mon, atk: Math.round(mon.atk * 1.3), def: Math.round(mon.def * 1.3), hp: Math.round(mon.hp * 1.3), maxHp: Math.round(mon.hp * 1.3), matk: Math.round(mon.atk * 1.3) } : mon, N, L);
      best = { mid, mon, r };
      if (r.spec > target) lo = mid; else hi = mid;
    }
    console.log(`第 ${f} 層(建議 Lv.${L}):倍率 ×${best.mid.toFixed(2)} → 勝率 含專精 ${Math.round(best.r.spec * 100)}% / 不含 ${Math.round(best.r.base * 100)}%`);
    console.log(`   一般怪(非關主)建議數值:atk ${best.mon.atk}  def ${best.mon.def}  spd ${best.mon.spd}  hp ${best.mon.hp}  luck ${best.mon.luck}   (玩家參考:atk ${Math.round(ref.atk)} def ${Math.round(ref.def)} spd ${Math.round(ref.spd)} hp ${Math.round(ref.hp)})`);
  });
}
({ leveling, winrate, spec, classes, towers, calibrate })[cmd]();
