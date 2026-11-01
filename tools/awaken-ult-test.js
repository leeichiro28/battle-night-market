// Lv.75 覺醒大招測試:node tools/awaken-ult-test.js(階段 3:12 個覺醒大招的資料、選擇規則、引擎效果)
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..") + "/";
const sb = { console: { log() {}, warn() {}, error() {} }, Math, Date, JSON, Object, Array, Set, Map, String, Number, Error, RegExp };
sb.window = sb; vm.createContext(sb);
["career-data.js", "career-engine.js", "career-floors.js", "career-pve.js", "career-spec.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + "assets/" + f, "utf8"), sb, { filename: f }));
const CD = sb.CareerData, SP = sb.CareerSpec, E = sb.CareerEngine;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const six = ["warrior", "guardian", "archer", "assassin", "mage", "healer"];

// ---- 資料 ----
const names = new Set();
six.forEach((c) => ["a", "b"].forEach((b) => {
  const u = SP.AWAKEN[c][b].ult; names.add(u && u.name);
  const n = CD.SKILL_TREE_NODES[`${c}_spec_${b}_ult`];
  ok(u && [...u.name].length === 4 && n && n.type === "ultimate" && n.unlockCharLevel === 75 && n.requires === `${c}_spec_${b}` && n.awakenUlt === true && n.maxLevel === CD.MAX_SKILL_LEVEL, `${c} ${b} ${u && u.name}:覺醒大招節點(Lv.75、掛在分支下、4 字名)`);
  ok(!CD.getSkillTreeChildren(`class_${c}`).some((x) => x.id === n.id), `${c} ${b}:不會混進職業原本的大招清單`);
}));
ok(names.size === 12, "12 個覺醒大招名字不重複");

// ---- 選擇規則(沒學、沒到 Lv.75、換了分支都退回預設大招1) ----
const id = (c, b) => `${c}_spec_${b}_ult`;
let r = SP.ultSelection("warrior", id("warrior", "b"), { spec_b: 1, spec_b_ult: 3 }, 75);
ok(r.id === id("warrior", "b") && r.level === 3, "Lv.75 + 已學 + 同分支:用覺醒大招,帶等級");
r = SP.ultSelection("warrior", id("warrior", "b"), { spec_b: 1, spec_b_ult: 3 }, 74);
ok(r.id === "warrior_ult_1", "Lv.74:退回預設大招1");
r = SP.ultSelection("warrior", id("warrior", "b"), { spec_b: 1 }, 80);
ok(r.id === "warrior_ult_1", "還沒學(等級 0):退回預設大招1");
r = SP.ultSelection("warrior", id("warrior", "b"), { spec_a: 1, spec_b_ult: 2 }, 80);
ok(r.id === "warrior_ult_1", "這場選的是另一條分支:退回預設大招1");
r = SP.ultSelection("warrior", "warrior_ult_2", { ult_2: 2 }, 80);
ok(r.id === "warrior_ult_2" && r.level === 2, "一般大招2:行為不變");
r = SP.ultSelection("warrior", "warrior_ult_1", {}, 80);
ok(r.id === "warrior_ult_1" && r.level === 1, "預設大招1沒點過:當 Lv.1");
const info = CD.resolveUltInfo("warrior", id("warrior", "b"), 1);
ok(info.name === "修羅降世" && info.effect.kind === "lifesteal", "resolveUltInfo 認得覺醒大招");
ok(CD.resolveUltInfo("warrior", id("mage", "a"), 1).name === "怒吼衝鋒", "別的職業的覺醒大招 id 不會被誤用");
ok(SP.awakenInfo("mage", "a", 75).ult.name === "焚天滅地" && SP.awakenInfo("mage", "a", 74).awakened === false, "awakenInfo 帶出覺醒大招");

// ---- 引擎:每個覺醒大招都能實際打出來 ----
const dummyStats = { atk: 40, matk: 40, def: 20, spd: 1, hp: 3000, maxHp: 3000, luck: 0 };
function mk(cls, ult, level) {
  const stats = { ...CD.applyProgress(cls, { atk: 40, def: 20, hp: 30 }, null) }; stats.hp = stats.maxHp; stats.spd = 99;
  const info = CD.resolveUltInfo(cls, ult, level || 1);
  const p1 = { classKey: cls, stats, skillLevel: 0, ultEffect: info.effect, ultName: info.name, critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0, ultCostReduce: 0, mastery: CD.classMasteryBonus(cls, 1), lifestealOnHit: 0, dmgReduceRatio: 0 };
  const st = E.initialMatchState(p1, { classKey: "warrior", stats: { ...dummyStats } });
  st.ultCharge1 = 100; st.mp1 = 99; st.hp2 = 3000; st.maxhp2 = 3000;
  return st;
}
function run(st, patch) { st = { ...st, ...(patch || {}), m1: { action: "ult" }, m2: { action: "attack" } }; return E.resolveRound(st); }
const by = (ev, t) => (ev || []).filter((e) => e.type === t);
six.forEach((c) => ["a", "b"].forEach((b) => {
  const u = SP.AWAKEN[c][b].ult, st = mk(c, id(c, b));
  const res = run(st);
  const used = (res.events || []).some((e) => e.side === 1 && /ult_/.test(e.type) && e.text.includes(u.name));
  const k = u.effect.kind;
  const dealt = k === "heal" || (k === "immune" && !u.effect.skipAttack === false) ? true : res.state.hp2 < 3000;
  ok(used && (dealt || k === "heal"), `${c} ${b} ${u.name}:實際打得出來(${k})`);
}));
// 效果細節
let res = run(mk("archer", id("archer", "a")));
ok(by(res.events, "attack").filter((e) => e.side === 1).length === 4, "流星 天河落星:連續 4 下");
res = run(mk("mage", id("mage", "b")));
ok(by(res.events, "attack").filter((e) => e.side === 1).length === 5, "雷樞 萬雷歸一:連續 5 下");
res = run(mk("assassin", id("assassin", "a")));
ok(by(res.events, "attack").filter((e) => e.side === 1).length === 3, "無聲 殺意無聲:連續 3 下");
let allCrit = true; for (let i = 0; i < 20; i++) { const x = run(mk("archer", id("archer", "b"))); if (!by(x.events, "attack").some((e) => e.side === 1 && e.crit)) allCrit = false; }
ok(allCrit, "天眼 千里一擊:20 次全部必爆");
res = run(mk("assassin", id("assassin", "b")));
ok(res.state.poison2 && res.state.poison2.rounds > 0 && res.state.hp2 < 3000, "蝕心 萬毒歸心:打出傷害並施加中毒");
res = run(mk("healer", id("healer", "b")));
ok(res.state.debuffs2.some((d) => d.stat === "atk") && res.state.debuffs2.some((d) => d.stat === "def"), "陰燭 燭滅影消:同時降攻擊與防禦");
res = run(mk("warrior", id("warrior", "b")), { hp1: 1000 });
ok(by(res.events, "lifesteal").length === 1, "修羅 修羅降世:吸血觸發");
const pierceMax = (() => { let m = 0; for (let i = 0; i < 10; i++) m = Math.max(m, run(mk("warrior", id("warrior", "a"))).state.maxhp2 - run(mk("warrior", id("warrior", "a"))).state.hp2); return m; })();
const plain = (() => { const st = mk("warrior", "warrior_ult_1"); return 3000 - E.resolveRound({ ...st, m1: { action: "attack" }, m2: { action: "attack" } }).state.hp2; })();
ok(pierceMax > plain, "破軍 斷軍破陣:比普通攻擊痛");
// 巫醫 不夜之光:清除中毒與減益
let st = mk("healer", id("healer", "a")); st.hp1 = 100; st.poison1 = { dmg: 20, rounds: 3 }; st.debuffs1 = [{ stat: "atk", ratio: 0.3, rounds: 2, fresh: false }];
res = run(st);
ok(by(res.events, "ult_heal").length === 1 && by(res.events, "cleanse").length === 1 && !res.state.poison1 && res.state.debuffs1.length === 0 && res.state.hp1 > 100, "不夜 不夜之光:回血並清除中毒與減益");
// 守衛:仍可攻擊 + 減傷;震嶽有反彈
res = run(mk("guardian", id("guardian", "a")));
ok(by(res.events, "ult_shield").length === 1 && by(res.events, "attack").some((e) => e.side === 1), "磐石 萬象不動:減傷且仍出手");
res = run(mk("guardian", id("guardian", "b")));
ok(by(res.events, "ult_shield").length === 1 && by(res.events, "reflect").length > 0 && by(res.events, "attack").some((e) => e.side === 1), "震嶽 山河反照:減傷、仍出手、並反彈對方傷害");
// 等級成長
const lv = (c, b, l) => CD.resolveUltInfo(c, id(c, b), l).effect;
ok(lv("mage", "a", 5).value > lv("mage", "a", 1).value && lv("archer", "a", 5).dmgMultPerHit > lv("archer", "a", 1).dmgMultPerHit && lv("healer", "a", 5).healRatio <= 0.95, "覺醒大招隨等級成長(治療比例封頂 95%)");
console.log(process.exitCode ? "\n有測試失敗" : "\n全部通過");
