// 職業養成對決 數值模擬器(Node 執行,不需要資料庫)。
//   node tools/sim.js leveling   升級速度:比較「舊規則」與「新規則」在不同玩法下,60 分鐘後的等級與樓層
//   node tools/sim.js winrate    勝率表:各等級的玩家(配點、無裝備)打各樓層的勝率
// 直接載入 assets/ 底下真正的 career-*.js,所以戰鬥結果跟遊戲裡用的是同一套引擎。
//
// 已知限制(解讀結果時要記得):
//  - 玩家沒有裝備、沒有技能點與被動加成;可用 --gear 0.2 粗略模擬「裝備讓攻/魔攻/防/HP 多 20%」
//  - 每場都從滿血開打(實際有 HP 持續與藥水)
//  - 配點是固定比例(主屬性 50%、防禦 25%、速度 10%、HP 15%),真人配點會不一樣
//  - 51 層以後的怪物還不存在,這個腳本目前只能驗證 1~50 層
const path = require("path");
global.window = global;
const A = (f) => require(path.join(__dirname, "..", "assets", f));
A("career-data.js");
A("career-engine.js");
A("career-floors.js");
A("career-pve.js");
const CD = window.CareerData, CF = window.CareerFloors, PVE = window.CareerPve;

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
const GEAR = opt("gear", 0);
const MINUTES = opt("minutes", 45); // 扣掉準備期,實際能打的分鐘數(總長 60)

function pointsAtLevel(level, rules) {
  let pts = 0;
  for (let L = 2; L <= level; L++) if (rules === "old" || CF.levelUpGivesPoints(L)) pts += 2;
  return pts;
}
function buildStats(classKey, level, rules) {
  const pts = pointsAtLevel(level, rules);
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
function fight(classKey, stats, floorDef) {
  return PVE.simulateFloorBattle(sideFor(classKey, stats), { classKey: floorDef.classKey, stats: floorDef.stats });
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
({ leveling, winrate })[cmd]();
