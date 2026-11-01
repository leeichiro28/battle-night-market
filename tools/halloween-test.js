// 萬聖夜測試:node tools/halloween-test.js
// 驗證限定事件只在萬聖夜抽得到、四種糖果機率、怪物/關主扮裝、稱號與圖鑑不受影響。
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..") + "/";
const sb = { console: { log() {}, warn() {}, error() {} }, Math, Date, JSON, Object, Array, Set, Map, String, Number, Error };
sb.window = sb; vm.createContext(sb);
["career-data.js", "career-engine.js", "career-floors.js", "career-events.js", "career-modifiers.js", "career-story.js", "career-codex.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + "assets/" + f, "utf8"), sb, { filename: f }));
const E = sb.CareerEvents, M = sb.CareerModifiers, F = sb.CareerFloors, S = sb.CareerStory, X = sb.CareerCodex;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// 事件只在萬聖夜出現
let hitsH = 0, hitsOther = 0;
for (let i = 0; i < 4000; i++) { if (E.pickWeighted("halloween").key === "trick_or_treat") hitsH++; if (E.pickWeighted("rain").key === "trick_or_treat" || E.pickWeighted().key === "trick_or_treat") hitsOther++; }
ok(hitsH > 0 && hitsOther === 0, `萬聖夜抽得到「不給糖就搗蛋」(${hitsH}/4000),其他主題與沒主題完全抽不到`);
ok(hitsH / 4000 > 0.2 && hitsH / 4000 < 0.45, `萬聖夜裡這個事件佔事件約三成(實際 ${(hitsH / 40).toFixed(1)}%)`);

// 糖果機率
ok(E.CANDIES.length === 4 && E.CANDIES.reduce((s, c) => s + c.weight, 0) === 100, "四種糖果,機率權重加起來 100");
const cnt = {}; for (let i = 0; i < 20000; i++) { const c = E.rollCandy().key; cnt[c] = (cnt[c] || 0) + 1; }
const pct = (k) => (cnt[k] / 200).toFixed(1);
ok(Math.abs(cnt.marshmallow / 200 - 50) < 2 && Math.abs(cnt.pumpkin / 200 - 30) < 2 && Math.abs(cnt.bat / 200 - 15) < 2 && Math.abs(cnt.ghost / 200 - 5) < 1.5, `糖果掉落約 50/30/15/5%(實際 ${pct("marshmallow")}/${pct("pumpkin")}/${pct("bat")}/${pct("ghost")})`);
ok(new Set(E.CANDIES.map((c) => c.name)).size === 4, "四種糖果名稱各不相同");

// 主題、扮裝
ok(S.THEME_ORDER.includes("halloween") && S.getTheme("halloween").label === "萬聖夜", "萬聖夜在主題清單裡");
const rules = { storyTheme: "halloween", activityEndsAt: new Date(Date.now() + 30 * 60000).toISOString() };
const act = M.activeFor(rules), none = M.activeFor({});
const mon = M.applyToFloor(F.getFloor(7), act), boss = M.applyToFloor(F.getFloor(10), act), boss70 = M.applyToFloor(F.getFloor(70), act);
ok(mon.name !== F.getFloor(7).name && mon.name.endsWith(F.getFloor(7).name), `一般怪換扮裝:${mon.name}`);
ok(boss.name !== F.getFloor(10).name && boss.name.endsWith(F.getFloor(10).name), `關主也換扮裝:${boss.name}`);
ok(boss70.name.endsWith("第零攤") && boss70.name !== "第零攤", `70 層關主:${boss70.name}`);
ok(M.applyToFloor(F.getFloor(7), none).name === F.getFloor(7).name && M.applyToFloor(F.getFloor(10), none).name === F.getFloor(10).name, "沒有萬聖夜時名稱不變");
ok(mon.stats.hp > F.getFloor(7).stats.hp && mon.dropChance > F.getFloor(7).dropChance, "萬聖夜數值規則:怪物更肥、掉落率更高");
ok(F.getFloor(7).name === "彈珠台幽靈", "扮裝不會改到原始樓層資料");

// 圖鑑不被限定事件拉高
ok(X.catalog().event.length === 15 && !X.catalog().event.some((e) => e.key === "trick_or_treat"), "圖鑑事件總數仍是 15(限定事件不算,不會讓「圖鑑館長」變得不可能)");

// 程式檢查:稱號與發獎
const db = fs.readFileSync(root + "assets/db.js", "utf8");
["halloween_trick", "halloween_collector", "halloween_king"].forEach((k) => ok(new RegExp(`key: "${k}"`).test(db), `稱號 ${k} 在 TITLE_CATALOG`));
ok(/pickWeighted\(openEvent\.rules && openEvent\.rules\.storyTheme\)/.test(db), "抽事件時有帶今夜主題");
ok(/Math\.min\(5, Math\.max\(0, M\.SCORE_CAP - now\)\)/.test(db), "排行分受 SCORE_CAP 上限限制");
