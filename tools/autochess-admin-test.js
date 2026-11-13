// 夜市自走棋 階段 3 第 4 段:後台統計與控制台純函式測試。 node tools/autochess-admin-test.js
const path = require("path");
global.window = global;
["autochess-data.js", "autochess-admin.js"].forEach((f) => require(path.join(__dirname, "..", "assets", f)));
const AD = window.AutochessData, AA = window.AutochessAdmin;
let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "不相等") + `:得到 ${JSON.stringify(a)},預期 ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "條件不成立"); };
const near = (a, b) => ok(Math.abs(a - b) < 1e-9, `${a} ≠ ${b}`);

const ids = Object.keys(AD.CARD_BY_ID), c0 = ids[0], c1 = ids[1];
const row = (p, round, stat, ev) => ({ event_id: ev || "e1", round, player_id: p, stat: Object.assign({ res: "win", afk: false, cards: [], bonds: {}, picks: [] }, stat) });

console.log("== aggregate ==");
t("空資料不爆", () => { eq(AA.aggregate([]).samples, 0); eq(AA.aggregate(null).samples, 0); });
t("卡牌出場與勝率(同名兩張只算一次出場)", () => {
  const a = AA.aggregate([row("p1", 1, { res: "win", cards: [c0 + "★1", c0 + "★2", c1 + "★1"] }), row("p2", 1, { res: "lose", cards: [c0 + "★1"] })]);
  const x = a.cards.find((c) => c.id === c0), y = a.cards.find((c) => c.id === c1);
  eq([x.n, x.wins, x.losses, x.star2], [2, 1, 1, 1]); near(x.winRate, 0.5); eq([y.n, y.wins], [1, 1]);
});
t("平手算 0.5", () => { const a = AA.aggregate([row("p1", 1, { res: "draw", cards: [c0 + "★1"] }), row("p2", 1, { res: "win", cards: [c0 + "★1"] })]); near(a.cards[0].winRate, 0.75); });
t("掛網的列不計入", () => { const a = AA.aggregate([row("p1", 1, { afk: true, cards: [c0 + "★1"] }), row("p2", 1, { cards: [c0 + "★1"] })]); eq([a.samples, a.skippedAfk, a.cards[0].n], [1, 1, 1]); });
t("流派:各級勝率分開算", () => {
  const a = AA.aggregate([row("p1", 1, { res: "win", bonds: { burn: 2 } }), row("p2", 1, { res: "lose", bonds: { burn: 4 } }), row("p3", 1, { res: "win", bonds: { burn: 2 } })]);
  const b = a.tags[0]; eq([b.tag, b.n, b.tiers.map((x) => [x.tier, x.n, x.wins])], ["burn", 3, [[2, 2, 2], [4, 1, 0]]]);
});
t("星級與 3★ 達成率(以玩家計,跨輪只算一次)", () => {
  const a = AA.aggregate([row("p1", 1, { cards: [c0 + "★1"] }), row("p1", 2, { cards: [c0 + "★3"] }), row("p1", 3, { cards: [c0 + "★3"] }), row("p2", 1, { cards: [c1 + "★2"] })]);
  near(a.threeStarRate, 0.5); eq(a.stars[2].n, 2);
});
t("相同 player_id 在不同活動視為不同玩家", () => { const a = AA.aggregate([row("p1", 1, {}, "e1"), row("p1", 1, {}, "e2")]); eq(a.players, 2); });
t("加碼卡選取率用每人最後一列、勝率有對照組", () => {
  const A = AD.PERKS[0].id, B = AD.PERKS[1].id;
  const a = AA.aggregate([row("p1", 3, { res: "win", picks: [A] }), row("p1", 4, { res: "win", picks: [A] }), row("p2", 3, { res: "lose", picks: [B] }), row("p2", 4, { res: "lose", picks: [B] })]);
  const pa = a.perks.find((p) => p.id === A), pb = a.perks.find((p) => p.id === B);
  eq([pa.picked, pb.picked], [1, 1]); near(pa.pickRate, 0.5); near(pa.winRate, 1); near(pa.baseline, 0); near(pa.lift, 1); near(pb.lift, -1);
});
t("判定:樣本不足→few,超出 40~60%→偏強/偏弱", () => {
  eq(AA.verdict(0.9, 5), "few"); eq(AA.verdict(0.7, 30), "high"); eq(AA.verdict(0.3, 30), "low"); eq(AA.verdict(0.5, 30), "ok");
  const rows = []; for (let i = 0; i < 25; i++) rows.push(row("p" + i, 1, { res: "win", cards: [c0 + "★1"] }));
  const a = AA.aggregate(rows); eq(a.flags.length, 1); eq(a.flags[0].verdict, "high");
});
t("沒有 res 的壞資料被略過", () => { eq(AA.aggregate([{ round: 1, player_id: "p", stat: {} }, { round: 1, player_id: "p" }]).samples, 0); });

console.log("== liveRows / 畫面字串 ==");
const NOW = Date.parse("2026-11-13T10:00:00Z");
const pl = (id, o) => Object.assign({ player_id: id, hp: 50, wins: 1, losses: 1, alive: true, last_action_round: 5, last_seen: "2026-11-13T09:59:55Z", sealed_round: 0, settled_round: 0, state: { gold: 7, level: 3 }, players: { name: id, is_bot: false } }, o || {});
t("狀態:在線 / 中斷 / 掛網 / 淘汰 / 機器人", () => {
  const r = AA.liveRows([pl("a"), pl("b", { last_seen: "2026-11-13T09:58:00Z" }), pl("c", { last_action_round: 1 }), pl("d", { alive: false, hp: -9, eliminated_round: 4 }), pl("e", { players: { name: "e", is_bot: true } })], { round: 5 }, NOW);
  const by = {}; r.forEach((x) => (by[x.id] = x));
  eq([by.a.status, by.b.status, by.c.status, by.d.status, by.e.status], ["online", "offline", "afk", "out", "bot"]); eq(by.d.hp, 0);
});
t("排序:存活者血量高→低,淘汰者晚淘汰在前", () => {
  const r = AA.liveRows([pl("a", { hp: 20 }), pl("b", { hp: 80 }), pl("x", { alive: false, eliminated_round: 2 }), pl("y", { alive: false, eliminated_round: 6 })], { round: 7 }, NOW);
  eq(r.map((x) => x.id), ["b", "a", "y", "x"]);
});
t("控制台:進行中有暫停與加時;暫停中顯示繼續;結束後沒有按鈕", () => {
  const live = { started: true, round: 3, phase: "prep", left: 61 };
  const h = AA.panelHtml(live, [pl("a")], NOW);
  ok(h.includes('data-ac="pause"') && h.includes('data-ac="extend"') && h.includes('data-ac="finish"'), "缺按鈕"); ok(h.includes("第 3 輪") && h.includes("1:01"));
  ok(AA.panelHtml(Object.assign({}, live, { paused: true }), [], NOW).includes('data-ac="resume"'));
  ok(!AA.panelHtml(Object.assign({}, live, { endedAt: "x" }), [], NOW).includes("data-ac="), "結束後不該有按鈕");
  ok(AA.panelHtml({ started: true, round: 1, phase: "battle", left: 9 }, [], NOW).includes("disabled"), "戰鬥階段加時要停用");
});
t("名字會被跳脫(防 XSS)", () => { const h = AA.panelHtml({ started: true, round: 1, phase: "prep", left: 5 }, [pl("<img src=x onerror=1>", { players: { name: "<img src=x onerror=1>" } })], NOW); ok(!h.includes("<img"), "未跳脫"); });
t("平衡畫面:無資料有提示;有資料有流派/卡牌/加碼", () => {
  ok(AA.balanceHtml(AA.aggregate([]), []).includes("還沒有數據"));
  const h = AA.balanceHtml(AA.aggregate([row("p1", 3, { cards: [c0 + "★1"], bonds: { burn: 2 }, picks: [AD.PERKS[0].id] })]), [{ kind: "mismatch" }]);
  ok(h.includes("流派") && h.includes("卡牌") && h.includes("攤位加碼") && h.includes("mismatch×1"));
});

console.log(`\n${pass} 通過,${fail} 失敗`);
process.exit(fail ? 1 : 0);
