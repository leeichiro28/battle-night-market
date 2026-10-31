// 輪替擂台規則測試:node tools/arena-test.js
// 驗證 career-modifiers.js 的 ARENA_RULES(時程、倒數)、compressStats(數值壓縮),
// 以及 career-engine.js 對 state.arenaRule 的招式限制(noult 禁大招、limited 只剩普攻+技能A)。
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..", "assets") + "/";
const sb = { console: { log() {}, warn() {}, error() {} }, Math, Date, JSON, Object, Array, Set, Map, String, Number, Error };
sb.window = sb;
vm.createContext(sb);
["career-data.js", "career-spec.js", "career-engine.js", "career-modifiers.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
const M = sb.CareerModifiers, E = sb.CareerEngine, CD = sb.CareerData;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const T0 = Date.parse("2026-10-31T12:00:00Z");
const rules = { activityEndsAt: new Date(T0 + 60 * 60000).toISOString() };
const at = (min) => T0 + min * 60000;
const keyAt = (min) => M.arenaRuleAt(rules, at(min)).key;

// ---- 時程:15 分鐘 PVP 開放,之後每 10 分鐘換一個,四個規則循環 ----
ok(M.ARENA_RULES.length === 4 && new Set(M.ARENA_RULES.map((r) => r.key)).size === 4, "共 4 個規則、key 不重複");
ok(M.ARENA_RULES.every((r) => r.label && r.text && r.line && r.icon), "每個規則都有名稱、說明、氛圍句、圖示");
ok(keyAt(0) === "standard" && keyAt(14.9) === "standard", "準備期(PVP 還沒開放)一律標準擂台");
ok(keyAt(15) === "standard" && keyAt(24.9) === "standard", "15~25 分:標準擂台");
ok(keyAt(25) === "noult" && keyAt(34.9) === "noult", "25~35 分:禁大招");
ok(keyAt(35) === "compress" && keyAt(44.9) === "compress", "35~45 分:數值壓縮");
ok(keyAt(45) === "limited" && keyAt(54.9) === "limited", "45~55 分:限定技能");
ok(keyAt(55) === "standard" && keyAt(59.9) === "standard", "55 分起循環回標準擂台");
ok(M.arenaRuleAt(null, at(30)).key === "standard" && M.arenaRuleAt({}, at(30)).key === "standard", "沒有活動時間(舊活動)當標準擂台");
ok(M.arenaRuleByKey("nope").key === "standard" && M.arenaRuleByKey("limited").key === "limited", "不認得的 key 當標準擂台");
const info = M.arenaInfo(rules, at(28));
ok(info.rule.key === "noult" && info.next.key === "compress" && info.changeInSec === 420, "距離下次換規則 7 分鐘(420 秒)、下一個是數值壓縮");
ok(M.arenaInfo(rules, at(5)).changeInSec === 1200 && M.arenaInfo(rules, at(5)).rule.key === "standard" && M.arenaInfo(rules, at(5)).next.key === "noult", "準備期:目前標準擂台,第 25 分(20 分鐘後)換成禁大招");

// ---- 數值壓縮 ----
const a = { maxHp: 1000, atk: 200, matk: 0, def: 100, spd: 50, luck: 10, maxMp: 40 };
const b = { maxHp: 400, atk: 100, matk: 80, def: 40, spd: 90, luck: 20, maxMp: 60 };
const [ca, cb] = M.compressStats(a, b);
ok(ca.maxHp === 850 && cb.maxHp === 550, `HP 往平均(700)靠一半:${ca.maxHp}/${cb.maxHp}`);
ok(ca.atk === 175 && cb.atk === 125, `攻擊往平均(150)靠一半:${ca.atk}/${cb.atk}`);
ok(ca.matk === 0 && cb.matk === 80, "只有一邊有的魔攻不動(法師不會憑空長物攻、戰士不會憑空長魔攻)");
ok(ca.def === 85 && cb.def === 55 && ca.spd === 60 && cb.spd === 80, "防禦、速度也各自壓縮");
ok(ca.luck === 10 && cb.luck === 20 && ca.maxMp === 40 && cb.maxMp === 60, "幸運、魔力上限不壓縮");
ok(a.maxHp === 1000 && b.maxHp === 400, "不會改到傳進來的原物件");
const [za, zb] = M.compressStats(a, b, 0);
ok(za.maxHp === 700 && zb.maxHp === 700, "壓縮比 0 = 完全拉平");
ok(Math.abs(ca.maxHp - cb.maxHp) < Math.abs(a.maxHp - b.maxHp), "壓縮後差距比較小,而且誰比較強的順序不變");
ok(ca.maxHp > cb.maxHp && ca.atk > cb.atk, "原本比較強的那一方壓縮後仍然比較強");

// ---- 引擎:被禁的招式當普通攻擊 ----
function fighter(cls) {
  const stats = CD.computeStats(cls);
  return { classKey: cls, stats, skillLevel: 3, skill2Level: 3, critBonus: 0 };
}
function run(rule, action1) {
  const cls = Object.keys(CD.CLASS_INFO).find((k) => !/^novice/.test(k) && CD.CLASS_INFO[k].ultName) || "warrior";
  const s = E.initialMatchState(fighter(cls), fighter(cls));
  s.ultCharge1 = CD.ULT_CHARGE_MAX || 100; s.ultCharge2 = 0;
  s.mp1 = s.maxmp1 = Math.max(s.maxmp1, 100);
  if (rule) s.arenaRule = rule;
  s.m1 = { action: action1 }; s.m2 = { action: "attack" };
  const r = E.resolveRound(s).state;
  return { mpSpentOnUlt: s.mp1 - r.mp1, chargeAfter: r.ultCharge1 };
}
sb.Math.random = () => 0.5;
const std = run(null, "ult"), noult = run("noult", "ult"), lim = run("limited", "ult");
ok(std.chargeAfter < 100, `標準擂台:放大招後大招點歸零(${std.chargeAfter})`);
ok(noult.chargeAfter >= 100, `禁大招:大招被當普攻,大招點沒被用掉(${noult.chargeAfter})`);
ok(lim.chargeAfter >= 100, `限定技能:大招也被禁(${lim.chargeAfter})`);
const sk2std = run(null, "skill2"), sk2lim = run("limited", "skill2"), sk2noult = run("noult", "skill2");
ok(sk2std.mpSpentOnUlt > 0 || sk2std.mpSpentOnUlt === 0, "技能B 在標準擂台可執行(不報錯)");
ok(sk2lim.mpSpentOnUlt <= sk2std.mpSpentOnUlt, `限定技能:技能B 被當普攻,魔力花費不會比標準多(${sk2lim.mpSpentOnUlt} ≤ ${sk2std.mpSpentOnUlt})`);
ok(sk2noult.mpSpentOnUlt === sk2std.mpSpentOnUlt, "禁大招擂台:技能B 不受影響,跟標準擂台一樣");
const sk1lim = run("limited", "skill1"), sk1std = run(null, "skill1");
ok(sk1lim.mpSpentOnUlt === sk1std.mpSpentOnUlt, "限定技能:技能A 照常可用,花費跟標準擂台一樣");
