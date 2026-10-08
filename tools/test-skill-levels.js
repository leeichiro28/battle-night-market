// 階段二驗證:技能/被動等級表是否 1~5 都有值、是否遞增。執行:node tools/test-skill-levels.js
global.window = {};
require("../assets/career-data.js");
const CD = window.CareerData;
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };
const mono = (name, tbl) => {
  for (let lv = 1; lv <= CD.MAX_SKILL_LEVEL; lv++) if (typeof tbl[lv] !== "number") fail(`${name} 缺 Lv.${lv}`);
  for (let lv = 2; lv <= CD.MAX_SKILL_LEVEL; lv++) if (!(tbl[lv] > tbl[lv - 1])) fail(`${name} Lv.${lv} 沒有比 Lv.${lv - 1} 強`);
};
console.log("MAX_SKILL_LEVEL =", CD.MAX_SKILL_LEVEL, "；等級門檻 =", JSON.stringify(CD.SKILL_LEVEL_CHAR_REQ));
Object.entries(CD.PASSIVE_DEFS).forEach(([k, d]) => mono("被動 " + k, d.levels));
Object.entries(CD.CLASS_MASTERY_DEFS).forEach(([k, d]) => mono("職業被動 " + k, d.levels));
mono("戰技傷害倍率", CD.SKILL_LEVEL_DMG_MULT);
// 大招縮放
const kinds = [
  { kind: "dmgMult", value: 2 }, { kind: "pierce", dmgMult: 1.5 }, { kind: "lifesteal", dmgMult: 1.5 },
  { kind: "multiHit", dmgMultPerHit: 0.8 }, { kind: "immune", dmgReduceRatio: 0.7 }, { kind: "heal", healRatio: 0.5 },
  { kind: "ignoreDef" }, { kind: "guaranteedCritBelowHalf" },
];
kinds.forEach((e) => {
  const out = [1, 2, 3, 4, 5].map((lv) => JSON.stringify(CD.scaleUltEffect(e, lv)));
  console.log(e.kind.padEnd(24), out[0], "→", out[4]);
  if (e.kind === "immune" && JSON.parse(out[4]).dmgReduceRatio > 0.95) fail("immune 超過 0.95 上限");
});
// 超過上限會被夾住
if (CD.passiveValue("atk_boost", 9) !== CD.PASSIVE_DEFS.atk_boost.levels[5]) fail("passiveValue 沒有夾在 Lv.5");
// 節點 maxLevel
Object.values(CD.SKILL_TREE_NODES || {}).forEach(() => {});
console.log("Lv.4 需角色", CD.skillLevelCharReq(4), "Lv.5 需角色", CD.skillLevelCharReq(5), "Lv.3 需角色", CD.skillLevelCharReq(3));
console.log(bad ? `\n有 ${bad} 項失敗` : "\n全部通過");
process.exit(bad ? 1 : 0);
