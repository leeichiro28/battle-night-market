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
