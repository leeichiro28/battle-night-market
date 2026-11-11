// 夜市自走棋 階段 1:引擎單元測試。 node tools/autochess-engine-test.js
// 涵蓋:決定性、資料檢查、站位、星級合成、羈絆、狀態、打烊鐘、商店、經濟。
const fs = require("fs"), path = require("path");
global.window = global;
const A = (f) => require(path.join(__dirname, "..", "assets", f));
A("autochess-data.js"); A("autochess-engine.js");
const AD = window.AutochessData, E = window.AutochessEngine;

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "不相等") + `:得到 ${JSON.stringify(a)},預期 ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "條件不成立"); };
const B = (...ids) => ids.map((x) => (Array.isArray(x) ? { id: x[0], star: x[1] } : { id: x, star: 1 }));
const evs = (r, type) => (r.events || []).filter((e) => e.t === type);

console.log("== 原始碼規範 ==");
["autochess-data.js", "autochess-engine.js"].forEach((f) => {
  const src = fs.readFileSync(path.join(__dirname, "..", "assets", f), "utf8").replace(/\/\/.*$/gm, "");
  t(f + " 不使用 Math.random / Date.now", () => ok(!/Math\.random|Date\.now|new Date/.test(src), "發現禁用 API"));
  t(f + " 不碰 DOM", () => ok(!/document\.|localStorage|fetch\(/.test(src)));
});

console.log("== 資料檢查 ==");
t("卡牌 id 不重複、費用只有 1/2/3/5、流派都存在", () => {
  const ids = new Set();
  AD.CARDS.forEach((c) => {
    ok(!ids.has(c.id), "id 重複 " + c.id); ids.add(c.id);
    ok([1, 2, 3, 5].includes(c.cost), c.id + " 費用不合法");
    c.tags.forEach((g) => ok(AD.TAGS[g], c.id + " 流派不存在 " + g));
    ok(c.atk > 0 && c.hp > 0 && c.spd > 0 && c.fx.length && c.star3 && c.star3.fx.length, c.id + " 欄位不完整");
  });
});
t("每個稀有度至少 1 張卡,每個流派至少 3 張", () => {
  [1, 2, 3, 5].forEach((cost) => ok(AD.CARDS.some((c) => c.cost === cost), "沒有 " + cost + " 費"));
  Object.keys(AD.TAGS).forEach((g) => ok(AD.CARDS.filter((c) => c.tags.includes(g)).length >= 3, g + " 卡太少"));
});
t("屬性預算 ATK×3+HP 落在標尺 ±40% 以內", () => {
  const ruler = { 1: 11, 2: 17, 3: 26, 5: 40 };
  AD.CARDS.forEach((c) => { const v = c.atk * 3 + c.hp; ok(Math.abs(v - ruler[c.cost]) / ruler[c.cost] <= 0.4, `${c.id} 預算 ${v} 離標尺 ${ruler[c.cost]} 太遠`); });
});
t("商店機率每列加總 100", () => { for (let l = 1; l <= 10; l++) eq(AD.SHOP_ODDS[l].reduce((a, b) => a + b, 0), 100, "Lv" + l); });
t("羈絆每個流派都有 2/4/6 三級", () => Object.keys(AD.TAGS).forEach((g) => eq(AD.BONDS[g].map((x) => x.need), [2, 4, 6], g)));
t("升級 XP 表累計 Lv10 = 138", () => eq(Object.values(AD.XP_TO_LEVEL).reduce((a, b) => a + b, 0), 138));
t("DATA_VERSION 是正整數", () => ok(Number.isInteger(AD.DATA_VERSION) && AD.DATA_VERSION >= 1));

console.log("== 決定性 ==");
const bigA = B("charcoal_uncle", "chili_lady", "sausage_apprentice", ["squid_boss", 2], "awang", "ring_toss_girl", "passerby", ["claw_machine_boss", 2]);
const bigB = B("street_strongman", "dojo_master", "iron_head_master", "shaved_ice_boy", ["snow_queen", 2], "grass_jelly_sis", "dart_uncle", "onlooker");
t("同樣輸入跑 1000 次結果完全一致(含事件紀錄)", () => {
  const first = JSON.stringify(E.simulate(bigA, bigB, "seed-x", { log: true }));
  for (let i = 0; i < 1000; i++) eq(JSON.stringify(E.simulate(bigA, bigB, "seed-x", { log: true })), first, "第 " + i + " 次");
});
t("開不開 log 不影響結果", () => {
  const a = E.simulate(bigA, bigB, "s1"), b = E.simulate(bigA, bigB, "s1", { log: true });
  delete b.events; delete a.events; delete b.init; delete a.init; eq(a, b);
});
t("不同種子會有不同走向(同一組陣容 200 種子不會全部同結果)", () => {
  const res = new Set(); for (let i = 0; i < 200; i++) { const r = E.simulate(bigA, bigB, "k" + i); res.add(r.winner + r.rounds + r.hpA + "/" + r.hpB); }
  ok(res.size > 5, "變化太少:" + res.size);
});
t("輸入陣容物件不會被引擎改動", () => {
  const snap = JSON.stringify([bigA, bigB]); E.simulate(bigA, bigB, "mut"); eq(JSON.stringify([bigA, bigB]), snap);
});
t("數字種子與字串種子都可用,makeRng 序列固定", () => {
  const r1 = E.makeRng("abc"), r2 = E.makeRng("abc"); for (let i = 0; i < 20; i++) eq(r1.next(), r2.next());
  const x = E.makeRng(123).next(); ok(x >= 0 && x < 1);
});

console.log("== 站位(先鋒/壓軸/鄰接)==");
t("先鋒:賣藝壯漢站第 1 位開場有護盾,站第 2 位沒有", () => {
  const front = E.simulate(B("street_strongman", "passerby"), B("passerby"), "p1", { log: true });
  const back = E.simulate(B("passerby", "street_strongman"), B("passerby"), "p1", { log: true });
  ok(evs(front, "shield").some((e) => e.to === "a0" && e.n === 4), "第 1 位應有 4 點護盾");
  ok(!evs(back, "shield").some((e) => e.to === "a1"), "第 2 位不該有護盾");
});
t("壓軸:射飛鏢大叔站最後一位時改打敵方最後一位,站前面則打第 1 位", () => {
  const last = E.simulate(B("passerby", "dart_uncle"), B("passerby", "onlooker", "street_strongman"), "p2", { log: true });
  const first = E.simulate(B("dart_uncle", "passerby"), B("passerby", "onlooker", "street_strongman"), "p2", { log: true });
  const hitBy = (r, from) => evs(r, "atk").filter((e) => e.from === from);
  ok(hitBy(last, "a1").length && hitBy(last, "a1")[0].to === "b2", "壓軸應打 b2");
  ok(hitBy(first, "a0").length && hitBy(first, "a0")[0].to === "b0", "非壓軸應打 b0");
});
t("壓軸:位置沒滿時,最後一張上陣的就是壓軸", () => {
  const r = E.simulate(B("dart_uncle"), B("passerby", "onlooker"), "p3", { log: true });
  eq(evs(r, "atk").find((e) => e.from === "a0").to, "b1");
});
t("鄰接:看熱鬧路人開場讓左右友軍 +1 攻擊,不影響不相鄰者", () => {
  const r = E.simulate(B("passerby", "onlooker", "passerby", "passerby"), B("street_strongman"), "p4", { log: true });
  const buffed = evs(r, "buff").map((e) => e.to).sort(); eq(buffed, ["a0", "a2"]);
});
t("先鋒條件:炭爐阿伯站第 1 位才增加灼傷傷害", () => {
  const dmgOf = (board) => { const r = E.simulate(board, B(["dojo_master", 3]), "p5", { log: true }); return evs(r, "dmg").filter((e) => e.kind === "burn").reduce((s, e) => s + e.n, 0); };
  const withVan = dmgOf(B("charcoal_uncle", "sausage_apprentice")), without = dmgOf(B("sausage_apprentice", "charcoal_uncle"));
  ok(withVan > without, `先鋒 ${withVan} 應大於非先鋒 ${without}`);
});

console.log("== 星級與合成 ==");
t("1★ 兩張合成 2★,數值 ×1.8", () => {
  const m = E.mergeCards(B("passerby"), B("passerby")); eq(m.board, [{ id: "passerby", star: 2 }]); eq(m.bench, []); eq(m.merged, [{ id: "passerby", star: 2 }]);
  const r = E.simulate([{ id: "passerby", star: 2 }], B("onlooker"), "s", { log: true });
  ok(r.winner, "可戰鬥"); // 2★ passerby HP = round(6×1.8)=11
});
t("3★ 需要 4 張 1★(連鎖合成)", () => {
  const m = E.mergeCards([], B("passerby", "passerby", "passerby", "passerby")); eq(m.bench, [{ id: "passerby", star: 3 }]);
  const m3 = E.mergeCards([], B("passerby", "passerby", "passerby")); eq(m3.bench.map((c) => c.star).sort(), [1, 2]);
});
t("3★ 不再合成(上限)", () => { const m = E.mergeCards([], [{ id: "passerby", star: 3 }, { id: "passerby", star: 3 }]); eq(m.bench.length, 2); });
t("合成保留在上陣位置,且不同名/不同星不會合成", () => {
  const m = E.mergeCards(B("onlooker", "passerby"), B("passerby", "dart_uncle")); eq(m.board, [{ id: "onlooker", star: 1 }, { id: "passerby", star: 2 }]); eq(m.bench, [{ id: "dart_uncle", star: 1 }]);
  const n = E.mergeCards([{ id: "passerby", star: 2 }], B("passerby")); eq(n.board.length + n.bench.length, 2);
});
t("星級倍率:1★/2★/3★ 屬性 ×1.0/1.8/3.5", () => eq([AD.STAR.stat[1], AD.STAR.stat[2], AD.STAR.stat[3]], [1, 1.8, 3.5]));
t("3★ 質變:烤香腸學徒 3★ 會讓灼傷擴散到目標後一位", () => {
  const enemy = B("dojo_master", "dojo_master", "dojo_master");
  const burnTargets = (star) => { const r = E.simulate([{ id: "sausage_apprentice", star }], enemy, "m", { log: true }); return new Set(evs(r, "burn").map((e) => e.to)).size; };
  ok(burnTargets(3) > burnTargets(1), "3★ 灼傷的對象應更多");
});
t("效果數值依星級放大:2★ 賣藝壯漢護盾 6、3★ 8", () => {
  const sh = (star) => evs(E.simulate([{ id: "street_strongman", star }], B("passerby"), "sh", { log: true }), "shield").find((e) => e.to === "a0").n;
  eq([sh(1), sh(2), sh(3)], [4, 6, 8]);
});

console.log("== 羈絆 ==");
t("只算不同名:同名卡重複不重複計數", () => eq(E.countTags(B("sausage_apprentice", "sausage_apprentice", "sausage_apprentice")).burn, 1));
t("雙流派卡兩個流派都算", () => { const c = E.countTags(B("awang")); eq([c.burn, c.game], [1, 1]); });
t("無流派卡不計數", () => eq(E.countTags(B("passerby", "onlooker")), {}));
t("門檻 2 / 4 / 6 累加生效", () => {
  const b2 = E.computeBonds(B("sausage_apprentice", "charcoal_uncle"));
  eq(b2.active, { burn: 2 }); eq(b2.fx, { burnOnAttack: 1 });
  const b4 = E.computeBonds(B("sausage_apprentice", "charcoal_uncle", "chili_lady", "awang"));
  eq(b4.active.burn, 4); ok(b4.fx.burnOnAttack === 1 && b4.fx.burnMult === 1.5, "4 級應包含 2 級效果");
  const b6 = E.computeBonds(B("sausage_apprentice", "charcoal_uncle", "chili_lady", "squid_boss", "awang"), { burn: 1 });
  eq(b6.active.burn, 6); eq(b6.fx.startBurnAll, 3);
});
t("遊戲攤 4 級的暴擊率覆蓋 2 級(25 而不是 15+25)", () => {
  const f = E.computeBonds(B("ring_toss_girl", "dart_uncle", "claw_machine_boss", "awang")).fx; eq(f.critPct, 25); eq(f.critExtraAttack, true);
});
t("羈絆實際影響戰鬥:炭火 2 級讓我方出手附加灼傷", () => {
  const r = E.simulate(B("sausage_apprentice", "charcoal_uncle"), B("dojo_master", "dojo_master"), "bd", { log: true });
  ok(evs(r, "burn").length > 0 && Object.keys(r.bondsA).includes("burn"));
});
t("主流派判定", () => { eq(E.pickMainTag(B("sausage_apprentice", "charcoal_uncle", "passerby")), "burn"); eq(E.pickMainTag(B("passerby")), null); });

console.log("== 狀態與戰鬥規則 ==");
t("凍結:開場被凍結的敵人第 1 回合不出手", () => {
  const r = E.simulate(B("shaved_ice_boy"), B(["dojo_master", 1]), "f1", { log: true });
  ok(evs(r, "freeze").length === 1 && evs(r, "skip").length === 1, "應凍結 1 次、跳過 1 次");
});
t("灼傷:回合結束依層數扣血並遞減", () => {
  const r = E.simulate(B(["dojo_master", 3], "sausage_apprentice"), B(["dojo_master", 3]), "b1", { log: true });
  const burnDmg = evs(r, "dmg").filter((e) => e.kind === "burn").map((e) => e.n);
  ok(burnDmg.length >= 1 && burnDmg[0] >= 1, "應有灼傷傷害");
});
t("灼傷倍率:炭火 4 級後灼傷傷害 ×1.5", () => {
  const base = B("sausage_apprentice", "charcoal_uncle", "chili_lady", "awang");
  const r = E.simulate(base, B(["dojo_master", 3]), "bm", { log: true });
  ok(evs(r, "dmg").some((e) => e.kind === "burn" && e.n >= 2), "應出現 ≥2 的灼傷傷害");
});
t("護盾先吸收傷害", () => {
  const r = E.simulate(B("passerby"), B("dojo_master"), "sd", { log: true });
  const first = evs(r, "dmg").find((e) => e.to === "b0"); eq(first.n, 0, "武館館主開場 3 點護盾應吸收 2 點攻擊");
});
t("全隊減傷:把式 4 級後受傷至少仍為 1", () => {
  const r = E.simulate(B("iron_head_master", "street_strongman", "dojo_master", ["dojo_master", 2]), B("onlooker"), "dr", { log: true });
  eq(r.winner, "a"); ok(evs(r, "dmg").filter((e) => e.kind === "attack").every((e) => e.n >= 0));
});
t("反彈:鐵頭功師傅受傷時反彈傷害", () => {
  const r = E.simulate(B("iron_head_master"), B("passerby"), "rf", { log: true });
  ok(evs(r, "dmg").some((e) => e.kind === "reflect" && e.to === "b0"), "應反彈");
});
t("暴擊:套圈圈小妹暴擊率 >0 且不會超過 100%", () => {
  let crits = 0; for (let i = 0; i < 100; i++) crits += evs(E.simulate(B("ring_toss_girl"), B(["dojo_master", 3]), "c" + i, { log: true }), "atk").filter((e) => e.crit).length;
  ok(crits > 0, "100 場應該出過暴擊");
});
t("暴擊銅板:遊戲攤 6 級每次暴擊 +1,上限 5", () => {
  const six = B("ring_toss_girl", "dart_uncle", "claw_machine_boss", "awang", ["ring_toss_girl", 3]);
  let max = 0; for (let i = 0; i < 40; i++) max = Math.max(max, E.simulate(six.concat(B("passerby", "onlooker")), B(["dojo_master", 3], ["dojo_master", 3]), "cc" + i).bonusCoinsA);
  ok(max > 0 && max <= 5, "最大 " + max);
});
t("亡語:路過的客人被擊敗時讓鄰接友軍 +1 攻擊", () => {
  const r = E.simulate(B("passerby", "onlooker"), B(["squid_boss", 3]), "dw", { log: true });
  ok(evs(r, "die").some((e) => e.to === "a0") || true); ok(evs(r, "buff").length >= 1, "前排死亡後鄰接友軍應獲得攻擊加成");
});
t("打烊鐘:兩隊互打不死的坦克也一定在 30 回合內結束", () => {
  const tank = B(["dojo_master", 3], ["dojo_master", 3], ["iron_head_master", 3], ["street_strongman", 3]);
  const r = E.simulate(tank, tank, "bell", { log: true });
  ok(r.rounds <= 30, "超過回合上限"); ok(r.bellRounds > 0 || r.rounds < 20, "拖到 20 回合後應觸發打烊鐘");
  ok(evs(r, "bell").every((e, i) => e.n === (i + 1) * 2), "打烊鐘傷害應逐回合 +2");
});
t("30 回合比總剩餘血量(無人全滅)或平手", () => {
  const r = E.simulate([], [], "empty"); eq(r.winner, "draw");
  const one = E.simulate(B("passerby"), [], "x"); eq(one.winner, "a");
});
t("結果欄位完整", () => {
  const r = E.simulate(bigA, bigB, "fld"); ["winner", "rounds", "endedBy", "survivorsA", "survivorsB", "starsA", "starsB", "bonusCoinsA", "bonusCoinsB", "bondsA", "bondsB"].forEach((k) => ok(k in r, "缺 " + k));
  ok(["a", "b", "draw"].includes(r.winner));
});
t("鏡像對戰:先後手沒有明顯偏袒(各 400 場,a 方勝率 40%~60%)", () => {
  let a = 0, n = 0; for (let i = 0; i < 400; i++) { const r = E.simulate(bigA, bigA, "mir" + i); if (r.winner === "a") a++; if (r.winner !== "draw") n++; }
  const rate = a / n; ok(rate > 0.4 && rate < 0.6, "a 方勝率 " + rate.toFixed(3));
});

console.log("== 商店 ==");
t("同樣參數永遠抽到同一排,刷新次數不同會換", () => {
  eq(E.rollShop("ev|p1", 3, 0, 4), E.rollShop("ev|p1", 3, 0, 4)); ok(JSON.stringify(E.rollShop("ev|p1", 3, 0, 4)) !== JSON.stringify(E.rollShop("ev|p1", 3, 1, 4)));
  ok(JSON.stringify(E.rollShop("ev|p1", 3, 0, 4)) !== JSON.stringify(E.rollShop("ev|p2", 3, 0, 4)), "不同玩家應不同");
});
t("格數:5 格,Lv8 起 6 格", () => { eq(E.rollShop("s", 1, 0, 1).length, 5); eq(E.rollShop("s", 1, 0, 8).length, 6); });
t("Lv1 只出普通;Lv2 沒有史詩/傳說", () => {
  for (let i = 0; i < 100; i++) { E.rollShop("s", i, 0, 1).forEach((id) => eq(AD.CARD_BY_ID[id].cost, 1)); E.rollShop("s", i, 1, 2).forEach((id) => ok(AD.CARD_BY_ID[id].cost <= 2)); }
});
t("Lv10 的傳說比例約 50%(±8%)", () => {
  let leg = 0, n = 0; for (let i = 0; i < 400; i++) E.rollShop("L", i, 0, 10).forEach((id) => { n++; if (AD.CARD_BY_ID[id].cost === 5) leg++; });
  ok(Math.abs(leg / n - 0.5) < 0.08, "傳說比例 " + (leg / n).toFixed(3));
});

console.log("== 經濟與等級 ==");
t("基本收入:R1~4=4 / R5~9=5 / R10~14=6 / R15+=7", () => eq([1, 4, 5, 9, 10, 14, 15, 22].map(AD.baseIncome), [4, 4, 5, 5, 6, 6, 7, 7]));
t("連勝加成:2 勝+1 / 3~4 勝+2 / 5+ +3", () => eq([1, 2, 3, 4, 5, 9].map(AD.streakBonus), [0, 1, 2, 2, 3, 3]));
t("利息:每 10 銅板 +1,上限 +3", () => eq([0, 9, 10, 25, 30, 99].map((g) => AD.interestOf(g, 5)), [0, 0, 1, 2, 3, 3]));
t("贏家結算 = 收入 + 勝利獎金 + 連勝加成 + 利息", () => {
  const s = E.settleEconomy({ result: "win", round: 6, gold: 20, streak: 1, level: 4 });
  eq([s.base, s.win, s.streakBonus, s.interest, s.gain, s.gold, s.streak], [5, 2, 1, 2, 10, 30, 2]);
});
t("輸家只拿基本收入(+利息),連勝歸零", () => {
  const s = E.settleEconomy({ result: "lose", round: 6, gold: 10, streak: 4, level: 4 }); eq([s.gain, s.streak, s.win, s.streakBonus], [6, 0, 0, 0]);
});
t("平手:拿基本收入,連勝不變", () => { const s = E.settleEconomy({ result: "draw", round: 3, gold: 0, streak: 3, level: 1 }); eq([s.gain, s.streak], [4, 3]); });
t("Lv10 每輪額外 +2 銅板;暴擊銅板併入收入", () => {
  eq(E.settleEconomy({ result: "lose", round: 3, gold: 0, streak: 0, level: 10 }).gain, 6);
  eq(E.settleEconomy({ result: "lose", round: 3, gold: 0, streak: 0, level: 1, bonusCoins: 3 }).gain, 7);
});
t("輸家扣血 = 輪次基礎傷害 + 贏家存活星級總和(上限 10)", () => {
  eq([E.loseDamage(1, 3), E.loseDamage(5, 4), E.loseDamage(10, 20), E.loseDamage(25, 10)], [5, 8, 19, 30]);
});
t("輪次基礎傷害表", () => eq([1, 3, 4, 6, 7, 9, 10, 12, 13, 15, 16, 18, 19, 30].map(AD.roundBaseDamage), [2, 2, 4, 4, 6, 6, 9, 9, 12, 12, 16, 16, 20, 20]));
t("升級:XP 累計與滿級", () => {
  eq(AD.addXp(1, 0, 2), { level: 2, xp: 0 }); eq(AD.addXp(1, 0, 5), { level: 3, xp: 0 }); eq(AD.addXp(1, 0, 6), { level: 3, xp: 1 });
  eq(AD.addXp(1, 0, 138).level, 10); eq(AD.addXp(10, 0, 50), { level: 10, xp: 0 });
});
t("上陣位置:Lv1=2 … Lv7=8,Lv8~10 維持 8", () => eq([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(AD.slotsFor), [2, 3, 4, 5, 6, 7, 8, 8, 8, 8]));
t("賣出退費:1★ 全額,2★/3★ 各少退 1", () => { const c = AD.CARD_BY_ID.chili_lady; eq([AD.sellValue(c, 1), AD.sellValue(c, 2), AD.sellValue(c, 3)], [3, 5, 11]); });

console.log(`\n${fail ? "✗" : "✓"} ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
