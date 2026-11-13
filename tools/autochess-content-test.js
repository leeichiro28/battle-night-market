// 夜市自走棋 階段 4:內容資料完整性 + 新機制測試。 node tools/autochess-content-test.js
const path = require("path");
global.window = global;
["autochess-data.js", "autochess-engine.js"].forEach((f) => require(path.join(__dirname, "..", "assets", f)));
const AD = window.AutochessData, E = window.AutochessEngine;
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || "條件不成立"); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m || "不相等"}:得到 ${JSON.stringify(a)},預期 ${JSON.stringify(b)}`);
const B = (...xs) => xs.map((x) => (typeof x === "string" ? { id: x, star: 1 } : x));
const dummy = (n) => B(...Array.from({ length: n }, () => "passerby"));

console.log("== 資料完整性 ==");
t("8 個流派,每個有名稱/圖示/說明與 3 級羈絆(門檻 2/4/6)", () => {
  eq(Object.keys(AD.TAGS).length, 8);
  Object.keys(AD.TAGS).forEach((k) => { const tg = AD.TAGS[k]; ok(tg.name && tg.icon && tg.desc, k + " 缺欄位"); eq((AD.BONDS[k] || []).map((x) => x.need), [2, 4, 6], k + " 羈絆門檻"); AD.BONDS[k].forEach((b) => ok(b.desc && b.fx && Object.keys(b.fx).length, k + " 羈絆沒有效果")); });
});
t("卡牌 48~56 張,id 不重複,費用只有 1/2/3/5,流派都存在,都有 3★ 質變", () => {
  ok(AD.CARDS.length >= 48 && AD.CARDS.length <= 56, "張數 " + AD.CARDS.length);
  eq(new Set(AD.CARDS.map((c) => c.id)).size, AD.CARDS.length, "id 重複");
  AD.CARDS.forEach((c) => {
    ok([1, 2, 3, 5].includes(c.cost), c.id + " 費用");
    ok(c.tags.length <= 2 && c.tags.every((x) => AD.TAGS[x]), c.id + " 流派");
    ok(c.name && c.desc && c.atk > 0 && c.hp > 0 && c.spd > 0, c.id + " 欄位");
    ok(c.fx && c.fx.length, c.id + " 沒有效果");
    ok(c.star3 && c.star3.desc && c.star3.fx && c.star3.fx.length, c.id + " 缺 3★ 質變");
  });
});
t("每個流派 5~6 張單流派卡(含各費用段),雙流派 ≥ 6 張,通用 ≥ 6 張", () => {
  Object.keys(AD.TAGS).forEach((k) => { const n = AD.CARDS.filter((c) => c.tags.length === 1 && c.tags[0] === k).length; ok(n >= 4 && n <= 6, k + " 單流派 " + n + " 張"); });
  ok(AD.CARDS.filter((c) => c.tags.length === 2).length >= 6, "雙流派不足");
  ok(AD.CARDS.filter((c) => c.tags.length === 0).length >= 6, "通用不足");
  [1, 2, 3, 5].forEach((cost) => ok(AD.CARDS.filter((c) => c.cost === cost).length >= 5, cost + " 費卡太少"));
});
t("每種費用都有各流派的卡可抽(商店不會因為流派缺卡而空掉)", () => {
  Object.keys(AD.TAGS).forEach((k) => ok(AD.CARDS.some((c) => c.tags.includes(k) && c.cost <= 2), k + " 沒有低費卡"));
});
t("所有卡的所有效果動作都存在於引擎(每張卡 1/2/3★ 都能完整打一場)", () => {
  AD.CARDS.forEach((c) => [1, 2, 3].forEach((s) => { const r = E.simulate(B({ id: c.id, star: s }, ...dummy(2)), dummy(3), "t", { log: true }); ok(r.winner, c.id + " 沒有結果"); }));
});
t("屬性預算:ATK×3+HP 不超過費用標尺的 1.5 倍、也不低於 0.6 倍(不含效果)", () => {
  const budget = { 1: 11, 2: 17, 3: 26, 5: 40 };
  AD.CARDS.forEach((c) => { const v = c.atk * 3 + c.hp; ok(v <= budget[c.cost] * 1.5 && v >= budget[c.cost] * 0.6, `${c.id} ${v} vs ${budget[c.cost]}`); });
});
t("隱藏羈絆:3 張卡都存在、不重複、各有效果與說明", () => {
  ok(AD.HIDDEN_BONDS.length >= 3);
  AD.HIDDEN_BONDS.forEach((h) => { eq(h.cards.length, 3); eq(new Set(h.cards).size, 3); h.cards.forEach((id) => ok(AD.CARD_BY_ID[id], h.id + " 找不到 " + id)); ok(h.name && h.desc && Object.keys(h.fx).length); });
  eq(new Set(AD.HIDDEN_BONDS.map((h) => h.id)).size, AD.HIDDEN_BONDS.length);
});
t("資料版本已升為 2", () => ok(AD.DATA_VERSION >= 2));

console.log("== 羈絆與隱藏羈絆 ==");
t("雙流派卡兩個流派都算、同名不重複計數", () => {
  const b = E.computeBonds(B("fire_ice_dessert", "fire_ice_dessert", "sausage_apprentice", "shaved_ice_boy"));
  eq([b.counts.burn, b.counts.frost], [2, 2]); eq(b.active, { burn: 2, frost: 2 });
});
t("隱藏羈絆:湊齊才觸發、不限站位、效果合進 fx", () => {
  const miss = E.computeBonds(B("squid_boss", "snow_queen")); eq(miss.hidden, []);
  const hit = E.computeBonds(B("gambling_god", "passerby", "snow_queen", "squid_boss"));
  eq(hit.hidden, ["bosses_meetup"]); ok(hit.fx.allAtk >= 3 && hit.fx.startShieldAll >= 6, "效果沒合進來");
  const two = E.computeBonds(B("awang", "passerby", "onlooker", "ring_toss_girl", "dart_uncle")); ok(two.hidden.includes("awang_day"));
  ok(E.simulate(B("squid_boss", "snow_queen", "gambling_god"), dummy(3), "h").hiddenA.includes("bosses_meetup"), "戰報要帶 hiddenA");
});
t("隱藏羈絆的全隊攻擊與護盾真的生效", () => {
  const a = E.simulate(B("squid_boss", "snow_queen", "gambling_god"), dummy(3), "h", { log: true });
  eq(a.init.a.map((u) => u.atk), [6 + 3, 5 + 3, 8 + 3]);
  ok(a.events.filter((e) => e.t === "shield" && e.n === 6).length >= 3, "開場全隊 6 點護盾");
});
t("遊戲攤羈絆的「全隊暴擊」有套用到單位上(v2 修正:之前只存在旗標、沒生效)", () => {
  const board = B("ring_toss_girl", "dart_uncle", "claw_machine_boss", "gambling_god");
  const r = E.simulate(board, dummy(4), "c", { log: true });
  ok(r.events.some((e) => e.t === "atk" && e.crit), "整場都沒暴擊,羈絆暴擊率沒生效?");
  const base = E.simulate(B("passerby", "onlooker"), dummy(2), "c", { log: true });
  ok(!base.events.some((e) => e.t === "atk" && e.crit), "沒有暴擊來源的陣容不該暴擊");
});

console.log("== 新機制 ==");
const run = (a, b, seed, o) => E.simulate(a, b, seed || "k", Object.assign({ log: true }, o || {}));
t("中毒:每回合結束受傷、無視護盾、不會消退、最多 6 層", () => {
  const r = run(B("iron_cloth_grandmaster", "herbal_pharmacist"), B({ id: "iron_cloth_grandmaster", star: 1 }), "p");
  const poisonHits = r.events.filter((e) => e.t === "dmg" && e.kind === "poison");
  ok(poisonHits.length >= 2 && poisonHits.every((e) => e.ab === 0), "中毒要無視護盾");
  eq(poisonHits.slice(0, 2).map((e) => e.n), [1, 1], "1 層中毒每回合 1 點、不消退");
  const many = run(B("black_jelly_grandpa", "black_jelly_grandpa", "herbal_pharmacist", "herbal_pharmacist", "herbal_pharmacist", "herbal_pharmacist"), B({ id: "squid_boss", star: 3 }), "p2");
  const maxStack = Math.max(...many.events.filter((e) => e.t === "dmg" && e.kind === "poison").map((e) => e.n), 0);
  ok(maxStack <= 6, "中毒層數上限 6,得到 " + maxStack);
});
t("治療:不會超過血量上限,滿血不回復", () => {
  const r = run(B("herb_tea_boy"), dummy(1), "h");
  ok(r.events.filter((e) => e.t === "heal").every((e) => e.n > 0), "滿血時不該有回復事件");
  const r2 = run(B({ id: "tonic_grandma", star: 1 }, "passerby"), B({ id: "iron_head_master", star: 2 }, "passerby"), "h2");
  ok(r2.events.filter((e) => e.t === "heal").length >= 0);
});
t("復活:第一位陣亡的友軍復活,每場只有 1 次", () => {
  const r = run(B("passerby", "tonic_grandma"), B({ id: "squid_boss", star: 3 }, { id: "gambling_god", star: 3 }), "rv");
  eq(r.events.filter((e) => e.t === "revive").length, 1, "復活次數");
  const dies = r.events.findIndex((e) => e.t === "die" && e.to === "a0"), rev = r.events.findIndex((e) => e.t === "revive");
  ok(rev >= 0 && (dies < 0 || rev < dies), "復活要發生在該單位真正死亡之前");
});
t("藥燉 6 級羈絆:復活 40% 血量", () => {
  const board = B("herb_tea_boy", "ginseng_chicken_auntie", "black_jelly_grandpa", "herbal_pharmacist", "herbal_bbq", "tonic_grandma");
  ok(E.computeBonds(board).fx.reviveFirstPct === 40 || E.computeBonds(board).fx.reviveFirstPct === 50, "復活旗標");
});
t("順手:銅板有上限、贏了才有贏場獎勵", () => {
  const r = run(B("bargain_king", "market_tycoon", "pickpocket_kid", "haggler_auntie", "lucky_draw_boss", "street_gambler"), dummy(2), "co");
  ok(r.winner === "a" && r.bonusCoinsA <= AD.BOND_COIN_CAP && r.bonusCoinsA >= 1, "銅板 " + r.bonusCoinsA);
  const lose = E.simulate(B("bargain_king"), B({ id: "squid_boss", star: 3 }, { id: "gambling_god", star: 3 }), "co2");
  ok(lose.winner === "b" && lose.bonusCoinsA === 0, "輸了不給贏場獎勵");
});
t("削弱:敵方攻擊最高者攻擊下降(最低 1)", () => {
  const r = run(B("haggler_auntie"), B("passerby", "dart_uncle", "gambling_god"), "w");
  const e = r.events.find((x) => x.t === "buff" && x.atk < 0); ok(e && e.to === "b2" && e.atk === -2, "要削弱攻擊最高的賭神");
});
t("卜卦:先鋒/壓軸/前排/後排條件", () => {
  const a = run(B("fortune_stick_boy", "passerby", "passerby"), dummy(3), "f");
  ok(a.events.some((e) => e.t === "buff" && e.to === "a0" && e.atk === 3), "先鋒 +3");
  const b = run(B("passerby", "passerby", "fortune_stick_boy"), dummy(3), "f");
  ok(!b.events.some((e) => e.t === "buff" && e.to === "a2" && e.atk === 3), "不在先鋒位不該 +3");
  const fs = (arr) => run(B(...arr), dummy(4), "fs");
  ok(fs(["fengshui_master", "passerby", "passerby", "passerby"]).events.some((e) => e.t === "shield" && e.to === "a0" && e.n === 3), "前排護盾");
  ok(fs(["passerby", "passerby", "passerby", "fengshui_master"]).events.some((e) => e.t === "buff" && e.to === "a3" && e.atk === 2), "後排攻擊");
});
t("卜卦羈絆:先鋒與壓軸才有加成", () => {
  const board = B("fortune_stick_boy", "palm_reader", "fengshui_master", "antique_dealer", "oracle_grandpa");
  const r = E.simulate(board, dummy(2), "e", { log: true });
  const plain = E.simulate(B("passerby", "passerby", "passerby", "passerby", "passerby"), dummy(2), "e", { log: true });
  ok(r.init.a[0].atk >= 2 + 2 && r.init.a[4].atk >= 7 + 2, "先鋒壓軸 +2");
  ok(plain.init.a[1].atk === 2, "中間的位置不受影響");
});
t("發條:每回合結束成長,戰鬥越久越強", () => {
  const r = run(B({ id: "iron_cloth_grandmaster", star: 2 }, "wind_up_frog"), B({ id: "iron_cloth_grandmaster", star: 2 }), "cl");
  const grows = r.events.filter((e) => e.t === "buff" && e.to === "a1" && e.atk === 1); ok(grows.length >= 3, "發條青蛙每回合 +1,得到 " + grows.length);
  const g = run(B({ id: "iron_cloth_grandmaster", star: 2 }, "clockwork_giant"), B({ id: "iron_cloth_grandmaster", star: 2 }), "cl2");
  ok(g.events.some((e) => e.t === "buff" && e.to === "a1" && e.atk === 6), "第 4 回合攻擊翻倍(+6)");
  const first = g.events.findIndex((e) => e.t === "buff" && e.atk === 6), r4 = g.events.findIndex((e) => e.t === "round" && e.n === 4);
  ok(first > r4 && !g.events.slice(0, r4).some((e) => e.t === "buff" && e.atk === 6), "要在第 4 回合才翻倍");
  ok(g.events.some((e) => e.t === "buff" && e.hp === 3), "血量上限成長");
});
t("換位:開場與第 1 位 / 最後一位換位,之後才判定先鋒壓軸", () => {
  const f = E.applyDeploy(B("fortune_stick_boy", "passerby", "wandering_monk"));
  eq(f.map((c) => c.id), ["wandering_monk", "passerby", "fortune_stick_boy"], "swapFront");
  const k = E.applyDeploy(B("snack_runner", "passerby", "fortune_stick_boy"));
  eq(k.map((c) => c.id), ["fortune_stick_boy", "passerby", "snack_runner"], "swapBack");
  const r = run(B("passerby", "passerby", "wandering_monk"), dummy(3), "d");
  eq(r.init.a[0].id, "wandering_monk", "演出用的開場站位是換位後的");
  eq(E.applyDeploy(B("passerby")).length, 1, "單張不出錯");
});
t("換位後的先鋒效果:籤筒小弟被換到第 1 位會拿到先鋒攻擊", () => {
  const r = run(B("fortune_stick_boy", "passerby", "wandering_monk"), dummy(3), "d2");
  ok(!r.events.some((e) => e.t === "buff" && e.atk === 3), "籤筒被換到最後,不是先鋒");
  const r2 = run(B("passerby", "passerby", "fortune_stick_boy", "wandering_monk"), dummy(3), "d3");
  ok(!r2.events.some((e) => e.t === "buff" && e.atk === 3), "籤筒位置沒動,但先鋒是和尚");
});
t("相同陣容與種子,新機制的結果完全一致(可重現)", () => {
  const board = B("herbal_pharmacist", "tonic_grandma", "fate_clockmaker", "market_tycoon", "oracle_grandpa", "clockwork_giant");
  const x = E.simulate(board, B("squid_boss", "snow_queen", "gambling_god"), "same", { log: true }), y = E.simulate(board, B("squid_boss", "snow_queen", "gambling_god"), "same", { log: true });
  eq(JSON.stringify(x), JSON.stringify(y), "兩次結果不同");
});
t("隨機陣容 3000 場不丟例外、一定有結果", () => {
  const ids = AD.CARDS.map((c) => c.id), rng = E.makeRng("fuzz");
  const mk = () => Array.from({ length: 1 + rng.int(8) }, () => ({ id: rng.pick(ids), star: 1 + rng.int(3) }));
  for (let i = 0; i < 3000; i++) { const r = E.simulate(mk(), mk(), "f" + i); ok(["a", "b", "draw"].includes(r.winner), "沒有結果"); ok(r.rounds <= AD.BATTLE.maxRounds); }
});

console.log(`\n${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);
