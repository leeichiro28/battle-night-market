// Lv.75 覺醒測試:node tools/awaken-test.js(階段 1:資料與解析、引擎能跑)
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..") + "/";
const sb = { console: { log() {}, warn() {}, error() {} }, Math, Date, JSON, Object, Array, Set, Map, String, Number, Error, RegExp };
sb.window = sb; vm.createContext(sb);
["career-data.js", "career-engine.js", "career-floors.js", "career-pve.js", "career-spec.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + "assets/" + f, "utf8"), sb, { filename: f }));
const CD = sb.CareerData, SP = sb.CareerSpec, E = sb.CareerEngine, PVE = sb.CareerPve;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const six = ["warrior", "guardian", "archer", "assassin", "mage", "healer"];

ok(SP.AWAKEN_LEVEL === 75, "覺醒等級 Lv.75");
let all = 0, titles = new Set(), names = new Set();
six.forEach((c) => ["a", "b"].forEach((b) => {
  const a = SP.AWAKEN[c] && SP.AWAKEN[c][b]; if (!a) return; all++;
  titles.add(a.title); names.add(a.skill.name);
}));
ok(all === 12 && titles.size === 12 && names.size === 12, "12 條覺醒路線,進階職業名與技能名各 12 個且不重複");
ok([...titles].every((t) => [...t].length === 2) && [...names].every((n) => [...n].length === 4), "進階職業名 2 字、覺醒技能名 4 字");

// 技能樹節點:Lv.75 才能學,掛在各自分支底下
six.forEach((c) => ["a", "b"].forEach((b) => {
  const n = CD.SKILL_TREE_NODES[`${c}_spec_${b}_skill_3`];
  ok(n && n.unlockCharLevel === 75 && n.requires === `${c}_spec_${b}` && n.type === "active_skill" && n.maxLevel === CD.MAX_SKILL_LEVEL, `${c} ${b}:覺醒技能節點(Lv.75、掛在分支下、可升到 Lv.${CD.MAX_SKILL_LEVEL})`);
}));
ok(CD.SKILL_TREE_NODES["warrior_spec_a_skill_1"].unlockCharLevel === 50, "原本的專精技能仍是 Lv.50 解鎖");

// 解析:沒到 Lv.75 不給,到了才給;Lv.100 升階不重複加成
six.forEach((c) => ["a", "b"].forEach((b) => {
  const k = `spec_${b}_skill_3`;
  ok(SP.resolveSkill(c, k, 5, 74) === null && SP.resolveSkill(c, k, 5, 75) && SP.resolveSkill(c, k, 5, 75).name === SP.AWAKEN[c][b].skill.name, `${c} ${b}:Lv.74 拿不到、Lv.75 拿得到`);
}));
ok(SP.resolveSkill("mage", "spec_a_skill_3", 5, 75).mult === SP.resolveSkill("mage", "spec_a_skill_3", 5, 100).mult, "覺醒技能不吃 Lv.100 升階加成");
ok(SP.resolveSkill("mage", "spec_a_skill_1", 5, 100).mult > SP.resolveSkill("mage", "spec_a_skill_1", 5, 99).mult, "原本專精技能的 Lv.100 加成不變");
ok(SP.resolveSkill("mage", "spec_a_skill_3", 5, 80).mult > SP.resolveSkill("mage", "spec_a_skill_3", 1, 80).mult, "覺醒技能傷害倍率隨技能等級成長");
ok(SP.resolveSkill("assassin", "spec_b_skill_3", 3, 75).poison.atkRatio > SP.AWAKEN.assassin.b.skill.effect.poison.atkRatio, "中毒傷害隨技能等級成長");

// 覺醒狀態與配色
ok(SP.awakenInfo("warrior", "b", 74).awakened === false && SP.awakenInfo("warrior", null, 90).awakened === false, "Lv.74 或沒選分支 → 沒覺醒");
const w = SP.awakenInfo("warrior", "b", 75);
ok(w.awakened && w.title === "修羅" && w.fullName === "修羅・戰士" && w.pathKey === "strength", "戰士狂戰 Lv.75:修羅・戰士、力量系");
ok(!("palette" in SP.awakenInfo("warrior", "b", 74)), "沒覺醒就沒有配色(顏色框只有覺醒才有)");
const pal = (c, b) => SP.awakenInfo(c, b, 75).palette.name;
ok(pal("warrior", "a") === "赤金" && pal("guardian", "b") === "赤金", "力量系(戰士、守衛)= 赤金");
ok(pal("archer", "a") === "青金" && pal("assassin", "b") === "青金", "敏捷系(弓箭手、刺客)= 青金");
ok(pal("mage", "a") === "金紫" && pal("healer", "b") === "金紫", "魔法系(法師、巫醫)= 金紫");

// 引擎:12 個覺醒技能都能實際打一場(不報錯、有造成傷害或對應效果)
function sideFor(cls, stats, effA) {
  const ult = CD.resolveUltInfo(cls, null, 1);
  return { classKey: cls, stats: CD.applyStatBoostPassives(stats, {}), skillLevel: 5, skill2Level: 5, ultEffect: ult.effect, ultName: ult.name, critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0, ultCostReduce: 0, mastery: CD.classMasteryBonus(cls, 1), lifestealOnHit: 0, dmgReduceRatio: 0, skillEffectA: effA, skillAName: effA && effA.name, spec: SP.resolvePassive(cls, "a", 75) };
}
const dummy = { classKey: "warrior", stats: { atk: 40, matk: 40, def: 20, spd: 10, hp: 900, maxHp: 900, luck: 5 } };
six.forEach((c) => ["a", "b"].forEach((b) => {
  const stats = { ...CD.applyProgress(c, { atk: 40, def: 20, hp: 30 }, null) }; stats.hp = stats.maxHp;
  const eff = SP.resolveSkill(c, `spec_${b}_skill_3`, 5, 75);
  let used = 0, st = E.initialMatchState(sideFor(c, stats, eff), { ...dummy, stats: { ...dummy.stats } });
  st.mp1 = 99;
  for (let i = 0; i < 6 && st.hp1 > 0 && st.hp2 > 0; i++) {
    st = { ...st, m1: { action: "skill1" }, m2: { action: "attack" } };
    const r = E.resolveRound(st); st = r.state;
    if ((r.events || []).some((e) => e && e.side === 1 && e.type === "skill_attack" && e.text.includes(SP.AWAKEN[c][b].skill.name))) used++;
  }
  ok(st.hp2 < dummy.stats.hp && used > 0, `${c} ${b} ${SP.AWAKEN[c][b].skill.name}:實際打得出來(對方 HP ${Math.round(dummy.stats.hp)}→${Math.round(st.hp2)})`);
}));
const asn = (() => { const stats = { ...CD.applyProgress("assassin", { atk: 40 }, null) }; stats.hp = stats.maxHp; const eff = SP.resolveSkill("assassin", "spec_b_skill_3", 5, 75); let st = E.initialMatchState(sideFor("assassin", stats, eff), { ...dummy, stats: { ...dummy.stats } }); st.mp1 = 99; st = { ...st, m1: { action: "skill1" }, m2: { action: "attack" } }; return E.resolveRound(st); })();
ok(asn.state.poison2 && asn.state.debuffs2.some((d) => d.stat === "def"), "蝕心劇毒:同時中毒與降防(兩種效果可疊在同一招)");
