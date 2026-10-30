// 樓層詞條與稀有攤販測試:node tools/affixes-test.js
// 驗證 career-affixes.js(抽選、輪替、效果套用、攤販)、career-floors.js(掉落)、career-pve/engine(回合上限、術法倍率、反彈),
// 以及 db.js 的 _modFloorDef/_monsterSide/_withPlayerExtra 整合。
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..", "assets") + "/";
const tables = { events: [], career_progress: [], career_builds: [] };
const sb = { console: { log() {}, warn() {}, error() {} }, setTimeout, clearTimeout, Math, Date, JSON, Promise, Object, Array, Set, Map, String, Number, Error, AbortController,
  document: { getElementById: () => null, createElement: () => ({}), body: { appendChild() {} }, addEventListener() {} }, addEventListener() {}, localStorage: { getItem: () => null, setItem() {} } };
sb.window = sb; sb.SUPABASE_URL = "x"; sb.SUPABASE_ANON_KEY = "y";
sb.supabase = { createClient: () => ({ from: () => ({ select() { return this; }, eq() { return this; }, then(r) { return r({ data: [], error: null }); }, maybeSingle() { return Promise.resolve({ data: null, error: null }); } }), rpc: () => Promise.resolve({ data: null, error: null }) }) };
vm.createContext(sb);
["career-data.js", "career-spec.js", "career-engine.js", "career-floors.js", "career-events.js", "career-missions.js", "career-modifiers.js", "career-affixes.js", "career-story.js", "career-pve.js", "career-codex.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + f, "utf8"), sb, { filename: f }));
const src = fs.readFileSync(root + "db.js", "utf8");
vm.runInContext(src + "\n;window.db = db;", sb, { filename: "db.js" });
const AF = sb.CareerAffixes, CF = sb.CareerFloors, CD = sb.CareerData, E = sb.CareerEngine, PVE = sb.CareerPve;
function extract(name) { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (let k = j; k < src.length; k++) { if (src[k] === "{") d++; else if (src[k] === "}") { d--; if (d === 0) return src.slice(i, k + 1); } } }
const ctx = vm.createContext({ window: sb, console, Object, Math });
vm.runInContext(["_modFloorDef", "_monsterSide", "_withPlayerExtra"].map(extract).join("\n") + "\nthis.mod=_modFloorDef;this.mon=_monsterSide;this.pe=_withPlayerExtra;", ctx);
function seed(s) { Math.random = function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

const T0 = Date.parse("2026-10-24T12:00:00Z");
const rules = { activityEndsAt: new Date(T0 + 60 * 60000).toISOString() }; // 剛開始的一場 60 分鐘活動
const at = (min) => T0 + min * 60000;

// ---- 資料 ----
ok(AF.AFFIXES.length === 16 && new Set(AF.AFFIXES.map((a) => a.key)).size === 16, "共 16 個詞條、key 不重複");
const cnt = (t) => AF.AFFIXES.filter((a) => a.tier === t).length;
ok(cnt("common") === 7 && cnt("rare") === 5 && cnt("epic") === 3 && cnt("legendary") === 1, `階級數量 普通 ${cnt("common")}/稀有 ${cnt("rare")}/史詩 ${cnt("epic")}/傳說 ${cnt("legendary")}`);
ok(AF.AFFIXES.filter((a) => a.good).length === 5, "好詞條 5 個(對玩家有利)");
ok(AF.AFFIXES.every((a) => a.text && a.line && a.icon && a.name && a.mods), "每個詞條都有名稱、效果說明、氛圍句、圖示");
ok(AF.TIERS.common.weight > AF.TIERS.rare.weight && AF.TIERS.rare.weight > AF.TIERS.epic.weight && AF.TIERS.epic.weight > AF.TIERS.legendary.weight, "越高階越少見");

// ---- 抽選:決定性與範圍 ----
ok(AF.affixFor(rules, 33, at(1)) === AF.affixFor(rules, 33, at(9)), "同一個 10 分鐘時段內,同一層的詞條不變");
ok(AF.affixFor(rules, 33, at(5)).key === AF.affixFor(rules, 33, at(5)).key, "同樣輸入永遠同樣結果(所有玩家一致)");
let diffWin = 0; for (let f = 6; f < 60; f++) if (f % 10 && AF.affixFor(rules, f, at(5)).key !== AF.affixFor(rules, f, at(15)).key) diffWin++;
ok(diffWin > 30, `過了 10 分鐘會輪替(48 個樓層裡有 ${diffWin} 層換了詞條)`);
ok(AF.windowIndex(rules, at(0)) === 0 && AF.windowIndex(rules, at(9.9)) === 0 && AF.windowIndex(rules, at(10)) === 1 && AF.windowIndex(rules, at(59)) === 5, "時段編號 0~5 每 10 分鐘一個");
ok(AF.secondsToRotate(rules, at(3)) === 420 && AF.secondsToRotate(rules, at(9.5)) === 30, "距離下次輪替的秒數");
ok(AF.windowIndex({}, at(30)) === 0 && AF.secondsToRotate({}, at(30)) === null && AF.affixFor({}, 22, at(30)), "沒有活動時間資訊的舊活動:固定第 0 時段、有詞條但不倒數");
const rules2 = { activityEndsAt: new Date(T0 + 90 * 60000).toISOString() };
let diffEv = 0; for (let f = 6; f < 60; f++) if (f % 10 && AF.affixFor(rules, f, at(5)).key !== AF.affixFor({ activityEndsAt: new Date(T0 + 3600000 * 5).toISOString() }, f, T0 + 3600000 * 4 + 300000).key) diffEv++;
ok(diffEv > 25, "不同活動的詞條排列不同");
ok([1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 70, 0].every((f) => AF.affixFor(rules, f, at(5)) === null), "1~5 層與關主層(每滿 10 層)沒有詞條");
ok([6, 7, 9, 11, 59, 69].every((f) => AF.affixFor(rules, f, at(5))), "其他樓層都有詞條");
const dist = { common: 0, rare: 0, epic: 0, legendary: 0 }; let tot = 0;
for (let f = 6; f <= 69; f++) { if (f % 10 === 0) continue; for (let w = 0; w < 40; w++) { const a = AF.affixFor({ activityEndsAt: new Date(T0 + 3600000 * (1 + (w % 7))).toISOString() }, f, T0 + w * 600000 + 1000); dist[a.tier]++; tot++; } }
const pct = (k) => Math.round((dist[k] / tot) * 1000) / 10;
ok(Math.abs(pct("common") - 55) < 5 && Math.abs(pct("rare") - 28) < 5 && Math.abs(pct("epic") - 14) < 4 && Math.abs(pct("legendary") - 3) < 2, `階級出現比例 普通 ${pct("common")}%/稀有 ${pct("rare")}%/史詩 ${pct("epic")}%/傳說 ${pct("legendary")}%(目標 55/28/14/3)`);

// ---- 套用效果 ----
const f55 = CF.getFloor(55), by = (k) => AF.AFFIX_BY_KEY[k];
const crowd = AF.applyAffix(f55, by("crowd"));
ok(crowd.stats.hp === Math.round(f55.stats.hp * 1.08) && crowd.dropChance > f55.dropChance && crowd.affix.key === "crowd", "人潮擁擠:怪物 HP +8%、掉落率提高、帶出 affix 資訊");
ok(f55.stats.hp === CF.getFloor(55).stats.hp && !f55.affix, "不會改到原本的樓層資料");
const closing = AF.applyAffix(f55, by("closing"));
ok(closing.maxRounds === 8 && closing.expReward === Math.round(f55.expReward * 1.25) && closing.coinReward === Math.round(f55.coinReward * 1.25), "打烊倒數:回合上限 8、經驗與幣 +25%");
const patron = AF.applyAffix(f55, by("patron"));
ok(patron.playerExtra.critBonus === 0.12 && Math.abs(patron.playerExtra.dmgReduceRatio - 0.12) < 1e-9 && patron.stats.hp === f55.stats.hp, "貴人加持:只加在玩家身上,怪物數值不變");
const mirror = AF.applyAffix(f55, by("mirror"));
ok(mirror.monsterExtra.spec.reflect === 0.06 && mirror.rarityBoost === 0.25, "反彈招牌:怪物反彈 6%、稀有掉落偏移");
const rain = AF.applyAffix(f55, by("rain"));
ok(rain.monsterExtra.magicMult === 0.7 && rain.playerExtra.magicMult === 0.7, "雨天濕滑:雙方術法倍率 0.7");
const god = AF.applyAffix(f55, by("godpass"));
ok(god.expReward === f55.expReward * 2 && god.legendaryChance === 0.05, "夜市之神路過:經驗 ×2、傳說掉落率 5%");
const smoke = AF.applyAffix(f55, by("smoke"));
ok(smoke.monsterExtra.critBonus === -0.1 && smoke.playerExtra.critBonus === -0.1, "油煙瀰漫:雙方暴擊率 −10%");
const two = AF.applyAffix(AF.applyAffix(f55, by("patron")), by("passerby"));
ok(Math.abs(two.playerExtra.dmgReduceRatio - (1 - 0.88 * 0.9)) < 1e-9, "減傷是連乘(不是相加)");

// ---- 跟既有的今夜主題/時段事件疊加(db.js _modFloorDef)----
const modded = ctx.mod(rules, CF.getFloor(33));
ok(modded.floor === 33 && modded.affix && modded.stats.hp > 0, "_modFloorDef 會帶上詞條");
ok(ctx.mod(rules, CF.getFloor(10)).affix === undefined && ctx.mod(rules, CF.getFloor(3)).affix === undefined, "關主層、前 5 層沒有詞條");
const noAf = vm.createContext({ window: { CareerModifiers: sb.CareerModifiers }, console, Object, Math });
vm.runInContext(["_modFloorDef"].map(extract).join("\n") + "\nthis.mod=_modFloorDef;", noAf);
ok(noAf.mod(rules, CF.getFloor(33)).affix === undefined, "沒載入 career-affixes.js 的頁面不會有詞條(不會壞)");
const ms = ctx.mon(AF.applyAffix(f55, by("mirror")));
ok(ms.classKey === f55.classKey && ms.stats.hp === f55.stats.hp && ms.spec.reflect === 0.06, "_monsterSide 帶出怪物額外欄位");
const ps = ctx.pe({ classKey: "warrior", critBonus: 0.05, dmgReduceRatio: 0.1 }, AF.applyAffix(f55, by("patron")));
ok(Math.abs(ps.critBonus - 0.17) < 1e-9 && Math.abs(ps.dmgReduceRatio - (1 - 0.9 * 0.88)) < 1e-9, "_withPlayerExtra 與玩家原本的暴擊、減傷疊加");
const side0 = { classKey: "warrior" }; ok(ctx.pe(side0, CF.getFloor(55)) === side0, "沒有額外欄位時原樣回傳");

// ---- 稀有攤販 ----
seed(11); let hit = 0; const N = 20000; for (let i = 0; i < N; i++) if (AF.rollVendor(f55)) hit++;
ok(Math.abs(hit / N - AF.VENDOR_CHANCE) < 0.01, `遇到攤販的機率約 ${Math.round(AF.VENDOR_CHANCE * 100)}%(實測 ${(hit / N * 100).toFixed(1)}%)`);
ok(AF.rollVendor(CF.getFloor(60), () => 0) === null && AF.rollVendor(CF.getFloor(3), () => 0) === null && AF.rollVendor(CF.getFloor(5), () => 0) === null, "關主層與前 5 層不會有攤販");
ok(AF.rollVendor(f55, () => 0) && AF.rollVendor(f55, () => 0.99) === null, "機率判斷(0 → 出現、0.99 → 不出現)");
const seen = new Set(); seed(3); for (let i = 0; i < 4000; i++) { const v = AF.rollVendor(f55); if (v) seen.add(v.key); }
ok(seen.size === 3, "三種攤販都會出現");
AF.VENDORS.forEach((v) => {
  const m = AF.makeVendor(f55, v);
  ok(m.name === `【${v.title}】${f55.name}` && m.dropChance === 1 && m.forceRarityWeights && m.vendor.key === v.key && m.expReward === Math.round(f55.expReward * 1.5) && m.coinReward === Math.round(f55.coinReward * 1.5), `${v.title}:改名、必掉、經驗與幣 ×1.5`);
});
ok(AF.makeVendor(f55, AF.VENDORS[2]).stats.atk > f55.stats.atk && Math.abs(AF.makeVendor(f55, AF.VENDORS[0]).monsterExtra.dmgReduceRatio - 0.08) < 1e-9 && AF.makeVendor(f55, AF.VENDORS[1]).monsterExtra.spec.reflect === 0.05, "三種攤販的怪物效果(狂暴/護盾/反彈)");
const both = AF.makeVendor(AF.applyAffix(f55, by("crowd")), AF.VENDORS[0]);
ok(both.affix && both.vendor && both.stats.hp > Math.round(f55.stats.hp * 1.08), "詞條與攤販可以疊加");

// ---- 掉落 ----
seed(21); const vd = AF.makeVendor(f55, AF.VENDORS[0]); const vdrops = [];
for (let i = 0; i < 400; i++) { const d = CF.rollDrop(vd, "warrior", 0); vdrops.push(d); }
ok(vdrops.every((d) => d && ["rare", "epic"].includes(d.rarity)), "攤販必掉稀有或史詩");
ok(vdrops.filter((d) => d.rarity === "epic").length > 70 && vdrops.filter((d) => d.rarity === "rare").length > 200, "稀有約 7 成、史詩約 3 成");
seed(22); const mkGl = (floor) => ({ ...AF.applyAffix(CF.getFloor(floor), by("godpass")), legendaryChance: 1, dropChance: 1 });
const legAt = (floor, cls, n) => { const g = mkGl(floor), out = []; for (let i = 0; i < n; i++) out.push(CF.rollDrop(g, cls, 0)); return out; };
ok(CF.legendaryBossFloorFor(20) === null && CF.legendaryBossFloorFor(40) === 40 && CF.legendaryBossFloorFor(49) === 40 && CF.legendaryBossFloorFor(55) === 50 && CF.legendaryBossFloorFor(63) === 60 && CF.legendaryBossFloorFor(69) === 60, "依樓層決定傳說來源:40 層前沒有 Boss 套裝、之後是不超過這層的最高一個 Boss");
const l33 = legAt(33, "warrior", 40), l45 = legAt(45, "warrior", 60), l55 = legAt(55, "mage", 60), l63 = legAt(63, "healer", 60);
ok(l33.every((d) => d.rarity === "legendary" && d.fromAffix && !d.setKey), "33 層:還沒有 Boss 套裝,掉一般傳說");
ok(l45.every((d) => d.setKey === "boss40" && d.fromAffix && d.rarity === "legendary"), "45 層:掉 40 層 Boss 套裝(三件湊齊有套裝效果)");
ok(l55.every((d) => d.setKey === "boss50") && l63.every((d) => d.setKey === "boss60"), "55 層掉 50 層套裝、63 層掉 60 層套裝");
ok(l45.filter((d) => d.slot === "weapon").every((d) => d.name === CF.BOSS_WEAPON_NAMES[40].warrior) && l55.filter((d) => d.slot === "weapon").every((d) => d.statKey === "matk"), "武器名稱與主屬性依玩家職業");
ok(l45.every((d) => d.reqLevel === 45) && l63.every((d) => d.reqLevel === 63), "裝備等級門檻看掉在第幾層");
ok(l45.some((d) => d.slot === "weapon") && l45.some((d) => d.slot === "armor") && l45.some((d) => d.slot === "accessory"), "三個部位都有機會掉");
let base = 0, boosted = 0; seed(23);
const mir = { ...AF.applyAffix(f55, by("mirror")), dropChance: 1 }, plain = { ...f55, dropChance: 1 };
for (let i = 0; i < 3000; i++) { const a = CF.rollDrop(plain, "warrior", 0), b = CF.rollDrop(mir, "warrior", 0); if (a.rarity !== "common") base++; if (b.rarity !== "common") boosted++; }
ok(boosted > base * 1.2, `反彈招牌讓稀有以上掉落變多(${base} → ${boosted}/3000)`);

// ---- 戰鬥:回合上限、術法倍率、反彈 ----
function stats(c, lv, o) { const pts = Math.floor(lv * 1.2); const magic = CD.CLASS_INFO[c].path === "magic"; const a = { def: Math.round(pts * 0.25), hp: Math.round(pts * 0.15) }; a[magic ? "matk" : "atk"] = Math.round(pts * 0.5); const s = CD.applyProgress(c, a, null); Object.assign(s, o || {}); s.maxHp = s.hp; return s; }
const mkSide = (c, st, extra) => ({ classKey: c, stats: st, skillLevel: 1, skill2Level: 1, ultEffect: CD.resolveUltInfo(c, null, 1).effect, ultName: "x", critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0, ultCostReduce: 0, mastery: {}, lifestealOnHit: 0, dmgReduceRatio: 0, ...(extra || {}) });
const tank = stats("guardian", 100, { hp: 3000, def: 20 });
seed(31); const slow = PVE.simulateFloorBattle(mkSide("warrior", stats("warrior", 100)), { classKey: "guardian", stats: tank }, { maxRounds: 2 });
seed(31); const slow2 = PVE.simulateFloorBattle(mkSide("warrior", stats("warrior", 100)), { classKey: "guardian", stats: tank });
ok(!slow.won && slow.state.round <= 3, `回合上限 2:拖不贏的戰鬥只打 ${slow.state.round - 1} 回合就判輸`);
ok(slow2.state.round > 3, "沒有回合上限時照樣打下去");
const dmgDealt = (m) => { seed(41); const r = PVE.simulateFloorBattle(mkSide("mage", stats("mage", 100), { magicMult: m }), { classKey: "guardian", stats: stats("guardian", 100, { hp: 99999, atk: 0 }) }, { maxRounds: 3 }); return r.state.maxhp2 - r.state.hp2; };
ok(dmgDealt(0.5) < dmgDealt(null) * 0.7, `術法倍率只打折法術類職業(0.5 → ${dmgDealt(0.5)} vs ${dmgDealt(null)})`);
const warriorDmg = (m) => { seed(42); const r = PVE.simulateFloorBattle(mkSide("warrior", stats("warrior", 100), { magicMult: m }), { classKey: "guardian", stats: stats("guardian", 100, { hp: 99999, atk: 0 }) }, { maxRounds: 3 }); return r.state.maxhp2 - r.state.hp2; };
ok(warriorDmg(0.5) === warriorDmg(null), "戰士這類非術法職業不受術法倍率影響");
const dummy = stats("guardian", 100, { hp: 99999, atk: 0 });
seed(43); const r0 = PVE.simulateFloorBattle(mkSide("warrior", stats("warrior", 100)), { classKey: "guardian", stats: dummy }, { maxRounds: 3 });
seed(43); const r1 = PVE.simulateFloorBattle(mkSide("warrior", stats("warrior", 100)), { classKey: "guardian", stats: dummy, spec: { reflect: 0.2 } }, { maxRounds: 3 });
ok(r1.state.hp1 < r0.state.hp1, `怪物反彈會讓玩家受傷(HP ${r0.state.hp1} → ${r1.state.hp1})`);
seed(44); const cr0 = PVE.simulateFloorBattle(mkSide("warrior", stats("warrior", 100)), { classKey: "warrior", stats: stats("warrior", 100) });
ok(cr0.state && true, "戰鬥照常結算");

// ---- 圖鑑/UI 輔助 ----
global.ui = { esc: (s) => String(s), icon: (n) => `<i ${n}></i>` }; sb.ui = global.ui; vm.runInContext("var ui = this.ui;", sb);
const card = AF.cardHtml(rules, 33, at(2));
ok(card.includes("第 33 層詞條") && card.includes("後輪替"), "爬塔頁詞條卡:標題與輪替倒數");
ok(AF.cardHtml(rules, 10, at(2)) === "" && AF.cardHtml(rules, 3, at(2)) === "", "沒詞條的樓層不顯示卡片");
ok(AF.cardHtml({}, 33, at(2)).includes("第 33 層詞條") && !AF.cardHtml({}, 33, at(2)).includes("後輪替"), "沒有時間資訊時不顯示倒數");
console.log(process.exitCode ? "\n有失敗" : "\n全部通過");
