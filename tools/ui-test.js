// 爬塔頁專精區塊(renderSpecSection)在各狀態下的輸出測試:node tools/ui-test.js
const fs = require("fs"), vm = require("vm");
const root = require("path").join(__dirname, "..", "assets") + "/";
const sb = {}; sb.window = sb; global.window = sb;
["career-data.js", "career-spec.js"].forEach((f) => require(root + f));
const src = fs.readFileSync(root + "tower.js", "utf8");
function extract(name) { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } } }
const ui = { esc: (s) => String(s).replace(/</g, "&lt;"), icon: (n) => `<i ${n}></i>` };
const ctx = { window: sb, CareerSpec: sb.CareerSpec, CareerData: sb.CareerData, ui, progress: { level: 49 }, console };
vm.createContext(ctx);
vm.runInContext(extract("renderSpecSection") + "\nthis.f=renderSpecSection;", ctx);
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
const strip = (h) => h.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
let h;
ctx.progress.level = 49; h = ctx.f("warrior", {}, true);
ok(h.includes("需角色 Lv.50") && !h.includes("data-choose-spec"), "Lv.49:顯示鎖定,沒有選擇按鈕");
ctx.progress.level = 50; h = ctx.f("warrior", { ult_1: 1 }, true);
ok((h.match(/data-choose-spec/g) || []).length === 2 && h.includes("破防") && h.includes("狂戰"), "Lv.50 有技能點:兩條都能選");
h = ctx.f("warrior", {}, false);
ok(h.includes("沒有技能點") && h.includes("disabled"), "沒有技能點:按鈕停用並說明");
h = ctx.f("warrior", { spec_a: 1 }, true);
ok(h.includes("本場已選擇") && h.includes("本場已選另一條，不能改選") && !h.includes("data-choose-spec"), "選了 A:A 顯示已選、B 顯示不能改選");
ctx.progress.level = 100; h = ctx.f("warrior", { spec_b: 1 }, true);
ok(h.includes("(已升階)"), "Lv.100:顯示已升階");
let all = true; Object.keys(sb.CareerSpec.SPECS).forEach((c) => { [49, 50, 100].forEach((lv) => { ctx.progress.level = lv; try { const x = ctx.f(c, c === "mage" ? { spec_a: 1 } : {}, true); if (!x.includes(sb.CareerSpec.SPECS[c].a.skills[0].name)) all = false; } catch (e) { all = false; console.error(c, lv, e.message); } }); });
ok(all, "6 個職業 × 3 種等級都能正常產生畫面,且列出技能名稱");
ok(ctx.f("novice", {}, true) === "", "見習(沒有專精的職業)不顯示專精區塊");
console.log("\n--- Lv.50 戰士畫面文字 ---\n" + strip((ctx.progress.level = 50, ctx.f("warrior", {}, true))));

// ---- 階段 2:覺醒區塊、玩家卡、覺醒框 ----
console.log("\n--- 覺醒 UI ---");
const ctx2 = { window: sb, CareerSpec: sb.CareerSpec, CareerData: sb.CareerData, ui, console, progress: { level: 74 }, myBuild: { final_class: "warrior" }, act: {},
  _activeSkills: () => ctx2.act, skillTreeKitCard: (n) => `<card ${n.id}>`, eventId: "e", myId: "p" };
vm.createContext(ctx2);
vm.runInContext(["awakenCtx", "awakenStyle", "awakenFrame", "playerTitleHtml", "renderAwakenSection"].map(extract).join("\n") + "\nthis.t=playerTitleHtml;this.sec=renderAwakenSection;this.ctx=awakenCtx;", ctx2);
const info = sb.CareerData.CLASS_INFO.warrior;
ctx2.act = {}; h = ctx2.t(info);
ok(!h.includes("awk") && h.includes("Lv.74"), "未選分支:新版型玩家卡,沒有覺醒框");
ctx2.act = { spec_b: 1 }; h = ctx2.t(info);
ok(!h.includes("awk") && !h.includes("覺醒"), "Lv.74 已選分支:還沒覺醒,沒有框、沒有星標");
h = ctx2.sec("warrior", { spec_b: 1 }, true, "warrior_ult_1", "skill_1", "skill_2");
ok(h.includes("修羅血祭") && h.includes("Lv.75") && !h.includes("<card"), "Lv.74:覺醒區塊灰色鎖定,顯示技能名與解鎖等級");
ok(ctx2.sec("warrior", {}, true, "u", "a", "b").includes("先選一條專精分支"), "沒選分支:說明要先選分支");
ctx2.progress.level = 75; ctx2.act = { spec_b: 1 }; h = ctx2.t(info);
ok(h.includes("awk") && h.includes("修羅・戰士") && h.includes("--c1:#f2c14e") && h.includes("#e0533d"), "Lv.75 狂戰戰士:覺醒框 + 修羅・戰士 + 赤金配色");
h = ctx2.sec("warrior", { spec_b: 1 }, true, "u", "a", "b");
ok(h.includes("awk") && h.includes("<card warrior_spec_b_skill_3>"), "Lv.75:覺醒區塊用覺醒框並放出覺醒技能卡");
const pal = { warrior: "#e0533d", archer: "#1fb5a3", mage: "#9a5cf0" };
let palOk = true; Object.keys(pal).forEach((c) => { ctx2.myBuild = { final_class: c }; ctx2.act = { spec_a: 1 }; if (!ctx2.t(sb.CareerData.CLASS_INFO[c]).includes(pal[c])) palOk = false; });
ok(palOk, "三個系配色:力量赤金、敏捷青金、魔法金紫");

// ---- 技能列統一版型 ----
const ctx3 = { window: sb, CareerData: sb.CareerData, ui, console, skillLevels: {}, levelGate: () => false, gateLabel: () => "" };
vm.createContext(ctx3);
vm.runInContext(["skRowHtml", "skillTreeKitCard"].map(extract).join("\n") + "\nthis.k=skillTreeKitCard;", ctx3);
const CDx = sb.CareerData, sk = CDx.SKILL_TREE_NODES.warrior_skill_1, ul = CDx.SKILL_TREE_NODES.warrior_ult_2;
h = ctx3.k(sk, "warrior", { skill_1: 2 }, true, "warrior_ult_1", "skill_1", "skill_2", true);
ok(h.includes("sk-row2 on") && h.includes("裝備中 A") && !h.includes("st-card") && !h.includes("awk"), "技能列:裝備中有金邊與標籤,沒有彩框");
h = ctx3.k(ul, "warrior", {}, true, "warrior_ult_1", "skill_1", "skill_2", true);
ok(h.includes("sk-row2") && h.includes("花1點解鎖"), "大招列:未解鎖顯示花1點解鎖");
h = ctx3.k(sk, "warrior", {}, false, "x", "skill_1", "skill_2", false);
ok(h.includes("sk-row2 dim") && h.includes("尚未解鎖"), "預覽(未定案職業):灰色列");
