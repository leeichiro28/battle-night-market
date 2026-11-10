// 項目 19 階段 1:玩家自動 AI 測試(node tools/autoai-test.js)
global.window = global;
["career-data.js", "career-engine.js", "career-pve.js"].forEach((f) => require("../assets/" + f));
const PVE = window.CareerPve, CD = window.CareerData;
let fails = 0;
const ok = (c, m) => { if (c) console.log("ok   " + m); else { fails++; console.log("FAIL " + m); } };
const base = { mp1: 10, hp1: 100, maxhp1: 100, ultCharge1: 0, ultCostReduce1: 0, skillLevel1: 1, skill2Level1: 0, ultEffect1: { kind: "dmgMult", value: 1.3 } };

ok(PVE.decidePlayerAction({ ...base }).action === "skill1", "魔力夠、有技能:一定放技能(不再 50% 隨機)");
let allSkill = true; for (let i = 0; i < 50; i++) if (PVE.decidePlayerAction({ ...base }).action !== "skill1") allSkill = false;
ok(allSkill, "連續 50 次都放技能");
ok(PVE.decidePlayerAction({ ...base, mp: 0, mp1: 3 }).action === "attack", "魔力不夠:普通攻擊");
ok(PVE.decidePlayerAction({ ...base, skillEffectA1: { mult: 1.9, manaCost: 7 }, mp1: 6 }).action === "attack", "專精技能實際花費 7,魔力 6 不夠 → 普攻(不再誤判成夠)");
ok(PVE.decidePlayerAction({ ...base, skillEffectA1: { mult: 1.9, manaCost: 7 }, mp1: 7 }).action === "skill1", "魔力 7 夠 → 放專精技能");
ok(PVE.decidePlayerAction({ ...base, ultCharge1: 100 }).action === "ult", "大招點滿且魔力夠 → 放大招");
ok(PVE.decidePlayerAction({ ...base, ultCharge1: 100, mp1: 5 }).action !== "ult", "大招點滿但魔力不夠 → 不放大招");
const two = PVE.decidePlayerAction({ ...base, skill2Level1: 1, skillEffectA1: { mult: 0.4, hits: 2 }, skillEffectB1: { mult: 1.6 } });
ok(two.action === "skill2", "兩個技能都能放:挑總傷害倍率高的(1.6 > 0.8)");
ok(PVE.decidePlayerAction({ ...base, ultEffect1: { kind: "heal", healRatio: 0.5 }, ultCharge1: 70, mp1: 7 }).action === "attack", "治療型大招、大招點 >= 60 且放技能會湊不出大招魔力 → 先留魔力");
ok(PVE.decidePlayerAction({ ...base, ultEffect1: { kind: "heal", healRatio: 0.5 }, ultCharge1: 30, mp1: 7 }).action === "skill1", "治療型大招但大招點還低 → 照常放技能");
// 怪物那邊的規則不變:沒有技能等級,只會普攻或大招
const mon = { mp2: 10, ultCharge2: 0, skillLevel2: 0, skill2Level2: 0, ultCostReduce2: 0 };
let monOnlyAttack = true; for (let i = 0; i < 30; i++) if (PVE.decideAction(mon, 2).action !== "attack") monOnlyAttack = false;
ok(monOnlyAttack, "怪物(decideAction side 2)沒有技能就只普攻,行為沒變");
ok(PVE.decideAction({ ...mon, ultCharge2: 100 }, 2).action === "ult", "怪物大招滿了照樣放");
// 整場:legacyAi 旗標仍可用
const p = { classKey: "mage", stats: CD.applyProgress("mage", { matk: 10 }, null), skillLevel: 1, skill2Level: 0, ultEffect: { kind: "dmgMult", value: 1.3 }, ultName: "x" };
const m = { classKey: "warrior", stats: { atk: 5, matk: 5, def: 2, spd: 2, hp: 30, maxHp: 30, luck: 0 } };
ok(typeof PVE.simulateFloorBattle(p, m, {}).won === "boolean" && typeof PVE.simulateFloorBattle(p, m, { legacyAi: true }).won === "boolean", "simulateFloorBattle 新舊 AI 都能跑完一場");
console.log(fails ? `\n${fails} 項失敗` : "\n全部通過");
process.exit(fails ? 1 : 0);
