// 夜市自走棋 階段 5:自動排站位、賽後獎項、MVP、音效模組。 node tools/autochess-polish-test.js
const path = require("path");
global.window = global;
["autochess-data.js", "autochess-engine.js", "autochess-bot.js", "autochess-game.js", "autochess-awards.js", "autochess-sfx.js"].forEach((f) => require(path.join(__dirname, "..", "assets", f)));
const AD = window.AutochessData, E = window.AutochessEngine, G = window.AutochessGame, AW = window.AutochessAwards, SFX = window.AutochessSfx;
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } };
const ok = (c, m) => { if (!c) throw new Error(m || "條件不成立"); };
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m || "不相等"}:得到 ${JSON.stringify(a)},預期 ${JSON.stringify(b)}`);
const B = (...xs) => xs.map((x) => (typeof x === "string" ? { id: x, star: 1 } : x));
const ids = (b) => b.map((c) => c.id);

console.log("== 自動排站位 ==");
t("少於 2 張原樣回傳(也不是同一個物件)", () => { const b = B("passerby"); const r = E.autoArrange(b); eq(ids(r), ["passerby"]); ok(r[0] !== b[0]); eq(E.autoArrange([]), []); });
t("不增不減:結果是原陣容的排列", () => {
  const b = B("sausage_apprentice", "fortune_stick_boy", "dart_uncle", "ice_wall_master", "palm_reader", "stall_cat");
  const r = E.autoArrange(b); eq(ids(r).slice().sort(), ids(b).slice().sort());
});
t("壓軸效果的卡排最後、先鋒效果的卡排最前", () => {
  const r = E.autoArrange(B("passerby", "dart_uncle", "street_strongman", "onlooker"));
  eq(r[0].id, "street_strongman", "先鋒"); eq(r[r.length - 1].id, "dart_uncle", "壓軸");
});
t("鄰接效果的卡不排在兩端", () => {
  const r = E.autoArrange(B("wooden_dummy_man", "passerby", "onlooker", "passerby"));
  const i = ids(r).indexOf("wooden_dummy_man"); ok(i > 0 && i < 3, "鄰接卡被排在兩端,位置 " + i);
});
t("換位卡:排完之後換位的結果仍然合理(先鋒效果的卡沒有被換到最後)", () => {
  const r = E.autoArrange(B("street_strongman", "wandering_monk", "passerby"));
  ok(E.applyDeploy(r)[0].id === "street_strongman" || E.applyDeploy(r)[0].id === "wandering_monk", "第 1 位是先鋒卡或換位的和尚");
});
t("決定性:同樣輸入每次排出同樣結果", () => {
  const b = B("sausage_apprentice", "fortune_stick_boy", "dart_uncle", "ice_wall_master", "palm_reader", "stall_cat", "claw_machine_boss", "passerby");
  eq(ids(E.autoArrange(b)), ids(E.autoArrange(b)));
});
t("已經是最佳排法就不動", () => { const b = B("street_strongman", "passerby", "dart_uncle"); const r = E.autoArrange(b); eq(ids(E.autoArrange(r)), ids(r)); });
t("8 張的運算在 1 秒內完成", () => {
  const b = B("a1", "a2").length && B("sausage_apprentice", "fortune_stick_boy", "dart_uncle", "ice_wall_master", "palm_reader", "stall_cat", "claw_machine_boss", "passerby");
  const t0 = Date.now(); E.autoArrange(b); ok(Date.now() - t0 < 1000, "太慢:" + (Date.now() - t0) + "ms");
});
t("自動排站位不輸給亂排(模擬:對固定對手,排完的勝率 ≥ 原本)", () => {
  const board = B("passerby", "dart_uncle", "street_strongman", "fengshui_master", "palm_reader", "wooden_dummy_man");
  const foe = B("squid_boss", "snow_queen", "iron_head_master", "popsicle_vendor", "passerby");
  const wins = (b) => { let w = 0; for (let i = 0; i < 60; i++) if (E.simulate(b, foe, "ar" + i).winner === "a") w++; return w; };
  ok(wins(E.autoArrange(board)) >= wins(board) - 6, "排完反而明顯變差");
});
t("G.autoArrange:只在準備階段、至少 2 張、不動待命席與銅板", () => {
  const g = G.create({ seed: "aa", name: "你" }); G.startRound(g);
  const me = g.me; me.board = B("passerby", "dart_uncle", "street_strongman"); me.bench = B("onlooker"); const gold = me.gold;
  const r = G.autoArrange(g); ok(r.ok && r.changed, "應該有變動");
  eq(ids(me.board)[0], "street_strongman"); eq(ids(me.bench), ["onlooker"]); eq(me.gold, gold);
  me.board = B("passerby"); ok(!G.autoArrange(g).ok, "1 張不用排");
  g.phase = "battle"; me.board = B("passerby", "onlooker"); ok(!G.autoArrange(g).ok, "非準備階段要拒絕");
});

console.log("== MVP 與趣味獎項 ==");
t("MVP:戰力最高的卡(含星級倍率)", () => {
  eq(AW.mvpCard(B("passerby", "gambling_god", "onlooker")).id, "gambling_god");
  eq(AW.mvpCard(B("passerby", { id: "street_strongman", star: 3 })).id, "street_strongman", "3★ 小卡可以勝過 1★ 大卡嗎?只要戰力較高");
  eq(AW.mvpCard([]), null); eq(AW.mvpCard(null), null);
});
const P = (id, rank, board, o) => ({ player_id: id, players: { name: id }, final_rank: rank, state: { board, bench: [], bestStreak: 0, ...(o || {}) } });
t("最會混搭:至少 3 個羈絆才頒,取最多者", () => {
  const mix = B("sausage_apprentice", "charcoal_uncle", "shaved_ice_boy", "popsicle_vendor", "street_strongman", "iron_head_master");
  const out = AW.awards([P("a", 1, mix), P("b", 2, B("passerby", "onlooker"))]);
  const m = out.find((x) => x.key === "mixer"); ok(m && m.player_id === "a" && /3/.test(m.detail), JSON.stringify(m));
  ok(!AW.awards([P("a", 1, B("sausage_apprentice", "charcoal_uncle"))]).some((x) => x.key === "mixer"), "只有 1 個羈絆不該頒");
});
t("最長連勝:至少 4 連勝", () => {
  const o = AW.awards([P("a", 1, [], { bestStreak: 6 }), P("b", 2, [], { bestStreak: 3 })]).find((x) => x.key === "streak");
  ok(o && o.player_id === "a" && o.detail === "6 連勝"); ok(!AW.awards([P("a", 1, [], { bestStreak: 3 })]).some((x) => x.key === "streak"));
});
t("最高星卡:至少 2★;同星取費用高者", () => {
  const o = AW.awards([P("a", 1, B({ id: "sausage_apprentice", star: 3 })), P("b", 2, B({ id: "squid_boss", star: 3 }))]).find((x) => x.key === "star");
  ok(o && o.player_id === "b", "同 3★ 取費用高的 " + JSON.stringify(o)); ok(!AW.awards([P("a", 1, B("squid_boss"))]).some((x) => x.key === "star"));
});
t("翻盤王:冠軍整場血量曾 ≤ 30;沒有紀錄或沒那麼慘就不頒", () => {
  const rows = (pid, ds) => ds.map((d, i) => ({ player_id: pid, round: i + 1, stat: { dmg: d } }));
  const pl = [P("a", 1, []), P("b", 2, [])];
  const o = AW.awards(pl, rows("a", [20, 25, 30, 0, 0])).find((x) => x.key === "comeback");
  ok(o && o.player_id === "a" && /25/.test(o.detail), JSON.stringify(o));
  ok(!AW.awards(pl, rows("a", [10, 10])).some((x) => x.key === "comeback"), "沒掉到 30 以下");
  ok(!AW.awards(pl, null).some((x) => x.key === "comeback"), "沒有紀錄");
  ok(!AW.awards(pl, rows("b", [90])).some((x) => x.key === "comeback"), "亞軍掉很低也不算");
});
t("minHp:依輪次排序累計,最低 0", () => { eq(AW.minHp([{ round: 2, stat: { dmg: 50 } }, { round: 1, stat: { dmg: 30 } }, { round: 3, stat: { dmg: 40 } }]), 0); eq(AW.minHp([]), 100); });
t("機器人不參與趣味獎項", () => {
  const bot = P("bot", 1, [], { bestStreak: 9 }); bot.players.is_bot = true;
  ok(!AW.awards([bot]).some((x) => x.key === "streak"));
});

console.log("== 音效模組 ==");
t("沒有 AudioContext 的環境(Node)播放不會丟例外", () => { SFX.kinds.forEach((k) => SFX.play(k)); SFX.play("不存在的音效"); });
t("靜音開關", () => { SFX.setMuted(true); ok(SFX.isMuted()); SFX.play("bell"); SFX.setMuted(false); ok(!SFX.isMuted()); });
t("有 bell / seal / win / lose / out / champ 這些音效", () => ["bell", "seal", "win", "lose", "out", "champ", "tick"].forEach((k) => ok(SFX.kinds.includes(k), k)));

console.log(`\n${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);
