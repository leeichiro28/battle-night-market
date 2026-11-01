// 階段 4:PVP／排行榜覺醒徽章測試:node tools/awaken-pvp-test.js
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..", "assets") + "/";
const sb = {}; sb.window = sb; global.window = sb;
["career-data.js", "career-spec.js"].forEach((f) => require(root + f));
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };
function extract(src, name) { const i = src.indexOf("function " + name + "("); if (i < 0) return ""; let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } } }
const dbSrc = fs.readFileSync(root + "db.js", "utf8"), uiSrc = fs.readFileSync(root + "ui.js", "utf8");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const ctx = { window: sb, esc, icon: (n) => `<i ${n}></i>`, console };
vm.createContext(ctx);
vm.runInContext(extract(dbSrc, "_awakenTagFor") + "\n" + extract(uiSrc, "awakenBadge") + "\nthis.tag=_awakenTagFor;this.badge=awakenBadge;", ctx);

// 推算:沒選分支、等級不夠都不覺醒
ok(ctx.tag("warrior", {}, 100) === null, "沒選專精分支:不覺醒(Lv.100 也一樣)");
ok(ctx.tag("warrior", { spec_a: 1 }, 74) === null, "Lv.74:不覺醒");
ok(ctx.tag("novice", { spec_a: 1 }, 100) === null, "見習系列(沒有專精):不覺醒");
ok(ctx.tag(null, {}, 80) === null, "沒有職業:不報錯");
ok(ctx.tag("warrior", null, 80) === null, "active_skills 是 null:不報錯");
// 12 條路線 × 配色
const pal = { power: "#e0533d", agile: null, magic: "#9a5cf0" };
let n = 0, titles = new Set(), colorOk = true;
Object.keys(sb.CareerSpec.AWAKEN).forEach((c) => ["a", "b"].forEach((br) => {
  const t = ctx.tag(c, { ["spec_" + br]: 1 }, 75); n++;
  if (!t || !t.title || !t.fullName.includes("・") || !t.c1 || !t.c2) colorOk = false; else titles.add(t.title);
}));
ok(n === 12 && colorOk && titles.size === 12, "12 條路線都推得出覺醒標記(12 個不同的進階職業名)");
const w = ctx.tag("warrior", { spec_b: 1 }, 75);
ok(w.title === "修羅" && w.fullName === "修羅・戰士" && w.c2 === "#e0533d", "狂戰戰士:修羅・戰士,赤金配色");
// 徽章
ok(ctx.badge(null) === "" && ctx.badge(undefined) === "", "沒覺醒:不產生任何標籤");
const b = ctx.badge(w);
ok(b.includes("awk-badge") && b.includes("修羅") && b.includes("--c1:#f2c14e"), "覺醒徽章:顯示進階職業名並帶配色");
ok(!ctx.badge({ title: "<b>", fullName: "x", c1: "#fff", c2: "#000" }).includes("<b>"), "徽章內容有跳脫");
// 接線檢查(靜態)
ok(/initState\.awaken1\s*=/.test(dbSrc) && /initState\.awaken2\s*=/.test(dbSrc), "db.js 配對時把覺醒標記寫進 state.awaken1/awaken2");
ok(/active_skills/.test(dbSrc.slice(dbSrc.indexOf("async function _getCareerPlayerSummaries"), dbSrc.indexOf("async function listWaitingCareerQueue"))), "排行榜摘要有撈 active_skills");
const careerSrc = fs.readFileSync(root + "career.js", "utf8"), towerSrc = fs.readFileSync(root + "tower.js", "utf8"), bvSrc = fs.readFileSync(root + "battle-view.js", "utf8");
ok((careerSrc.match(/awakenBadge/g) || []).length >= 5, "career.js:排行榜(進行中／結束後)、排隊名單、PVP 名牌都有徽章");
ok(/awakenBadge/.test(towerSrc), "tower.js:爬塔頁排行榜有徽章");
ok(/state\.awaken1/.test(bvSrc) && /state\.awaken2/.test(bvSrc), "battle-view.js:旁觀對戰畫面有徽章");
ok(!/awaken1|awaken2/.test(fs.readFileSync(root + "career-engine.js", "utf8")), "引擎不讀覺醒標記(純顯示,不影響戰鬥)");
console.log(process.exitCode ? "\n有失敗項目" : "\n全部通過");
