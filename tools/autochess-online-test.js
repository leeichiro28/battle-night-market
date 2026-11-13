// 夜市自走棋 階段 3:連線版純函式測試。 node tools/autochess-online-test.js
// 涵蓋:存檔序列化/還原、補跑錯過的輪次、對戰結算的決定性與對稱、幽靈戰、空狀態、掛網、連勝保險。
const path = require("path");
global.window = global;
["autochess-data.js", "autochess-engine.js", "autochess-bot.js", "autochess-game.js"].forEach((f) => require(path.join(__dirname, "..", "assets", f)));
const AD = window.AutochessData, E = window.AutochessEngine, G = window.AutochessGame;

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "不相等") + `:得到 ${JSON.stringify(a)},預期 ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "條件不成立"); };
const J = (x) => JSON.parse(JSON.stringify(x));
const mkG = (seed) => G.createOnline({ seed: seed || "ev1:p1", name: "小明" });
const snap = (pid, state, extra) => Object.assign({ player_id: pid, hp: 100, wins: 0, losses: 0, afk: false, state }, extra || {});
// 給玩家一副像樣的陣容(直接塞卡,不依賴商店亂數)
const withBoard = (state, ids) => Object.assign({}, state, { board: ids.map((id) => ({ id, star: 1 })) });
const cards = Object.keys(AD.CARD_BY_ID);

console.log("== 存檔 / 還原 / 補跑 ==");
t("開局:round 0、沒有電腦玩家、只有自己", () => { const g = mkG(); eq([g.round, g.bots.length, g.players.length], [0, 0, 1]); });
t("補跑到第 1 輪:商店有 5 格、stateRound=1", () => { const g = mkG(); G.catchUp(g, 1); eq(g.round, 1); eq(g.me.shop.length, 5); eq(G.serialize(g).stateRound, 1); });
t("序列化→JSON→還原:所有狀態一致", () => {
  const g = mkG(); G.catchUp(g, 1); g.me.gold = 9; G.buy(g, 0);
  const st = J(G.serialize(g)), g2 = mkG(); G.restore(g2, st, { hp: 77, wins: 2, losses: 1, alive: true });
  eq(G.serialize(g2), st); eq([g2.me.hp, g2.me.wins, g2.me.losses, g2.round], [77, 2, 1, 1]);
});
t("還原後不用再補跑(同一輪重新整理,商店不會被重骰)", () => {
  const g = mkG(); G.catchUp(g, 2); const shop = g.me.shop.slice();
  const g2 = mkG(); G.restore(g2, J(G.serialize(g)), { hp: 100, wins: 0, losses: 0, alive: true }); G.catchUp(g2, 2); eq(g2.me.shop, shop); eq(g2.round, 2);
});
t("補跑是決定性的:一次補到第 5 輪 = 兩個分頁各補一次", () => {
  const a = mkG(); G.catchUp(a, 5); const b = mkG(); G.catchUp(b, 3); G.catchUp(b, 5); eq(G.serialize(a), G.serialize(b));
});
t("離線錯過的輪次補被動經驗:第 4 輪補跑後經驗比第 1 輪多", () => { const a = mkG(); G.catchUp(a, 1); const xp1 = a.me.level * 100 + a.me.xp; G.catchUp(a, 4); ok(a.me.level * 100 + a.me.xp > xp1); });
t("不同玩家(不同種子)商店不一樣", () => { const a = mkG("ev1:p1"), b = mkG("ev1:p2"); G.catchUp(a, 1); G.catchUp(b, 1); ok(JSON.stringify(a.me.shop) !== JSON.stringify(b.me.shop), "兩人商店完全一樣"); });
t("加碼輪(R3)補跑後有待選加碼;還原後仍在", () => {
  const a = mkG(); G.catchUp(a, 3); ok(a.me.pendingPerk && a.me.pendingPerk.candidates.length === 3);
  const b = mkG(); G.restore(b, J(G.serialize(a)), { hp: 100, wins: 0, losses: 0, alive: true }); eq(b.me.pendingPerk, a.me.pendingPerk);
});
t("sealPrep:沒選加碼會替選、上陣沒滿會補位", () => {
  const g = mkG(); G.catchUp(g, 3); g.me.bench.push({ id: cards[0], star: 1 }, { id: cards[1], star: 1 });
  const r = G.sealPrep(g); ok(r.autoPicked, "沒有替選加碼"); eq(g.me.pendingPerk, null); ok(g.me.board.length >= 1 && r.filled >= 1, "沒有補位");
});

console.log("== 對戰結算 ==");
const base = (ids) => withBoard(G.normState({}), ids);
const A0 = base(cards.slice(0, 2)), B0 = base(cards.slice(2, 4));
t("同一組快照+種子,結果完全一樣(誰算都一樣)", () => {
  const x = G.battleOnline(5, snap("a", A0), snap("b", B0), false, "seed-1", false), y = G.battleOnline(5, snap("a", J(A0)), snap("b", J(B0)), false, "seed-1", true);
  eq(x.outcomes, y.outcomes); eq(x.r.winner, y.r.winner);
});
t("開不開戰報(log)不影響結果", () => { const x = G.battleOnline(7, snap("a", A0), snap("b", B0), false, "s2", false), y = G.battleOnline(7, snap("a", A0), snap("b", B0), false, "s2", true); eq(x.outcomes.map((o) => [o.res, o.dmg, o.patch.gold]), y.outcomes.map((o) => [o.res, o.dmg, o.patch.gold])); });
t("雙方對稱:一方贏另一方輸;只有輸家扣血;平手都不扣", () => {
  for (let i = 0; i < 40; i++) {
    const a = base([cards[i % cards.length], cards[(i * 3 + 1) % cards.length]]), b = base([cards[(i * 5 + 2) % cards.length], cards[(i * 7 + 3) % cards.length]]);
    const { outcomes: [oa, ob] } = G.battleOnline(1 + (i % 10), snap("a", a), snap("b", b), false, "sym" + i, false);
    if (oa.res === "win") { eq(ob.res, "lose"); ok(ob.dmg > 0 && oa.dmg === 0, "輸家要扣血"); }
    else if (oa.res === "lose") { eq(ob.res, "win"); ok(oa.dmg > 0 && ob.dmg === 0); }
    else { eq(ob.res, "draw"); eq([oa.dmg, ob.dmg], [0, 0]); }
  }
});
t("幽靈戰:只有 A 一筆結算,幽靈本尊不受影響", () => { const x = G.battleOnline(3, snap("a", A0), snap("g", B0), true, "gh", false); eq(x.outcomes.length, 1); eq(x.outcomes[0].player_id, "a"); });
t("結算 patch 只含白名單欄位", () => { const { outcomes: [o] } = G.battleOnline(3, snap("a", A0), snap("b", B0), false, "wl", false); eq(Object.keys(o.patch).sort(), ["bestStreak", "gold", "perks", "streak"]); });
t("贏:連勝+1、銅板增加;輸:連勝歸零", () => {
  const strong = base(["passerby"]), weak = G.normState({});
  const w = G.battleOnline(2, snap("a", Object.assign({}, strong, { streak: 2, gold: 10 })), snap("b", weak), false, "w", false).outcomes[0];
  eq(w.res, "win"); eq(w.patch.streak, 3); ok(w.patch.gold > 10); eq(w.patch.bestStreak, 3);
  const l = G.battleOnline(2, snap("a", Object.assign({}, weak, { streak: 4, gold: 10 })), snap("b", strong), false, "w", false).outcomes[0];
  eq(l.res, "lose"); eq(l.patch.streak, 0); ok(l.dmg > 0);
});
t("連勝保險:輸了連勝不中斷、保險用掉", () => {
  const strong = base(["passerby"]), weak = G.normState({ streak: 4, perks: { streakGuard: true } });
  const l = G.battleOnline(2, snap("a", weak), snap("b", strong), false, "sg", false).outcomes[0];
  eq(l.res, "lose"); eq(l.patch.streak, 4); eq(l.patch.perks.streakGuard, false); ok(l.insured);
});
t("好人緣:每輪 +N 銅板、次數 -1", () => {
  const st = Object.assign(base(["passerby"]), { perks: { goodRapport: 2 } });
  const o = G.battleOnline(2, snap("a", st), snap("b", G.normState({})), false, "gr", false).outcomes[0];
  eq(o.patch.perks.goodRapport, 1); ok(o.eco.bonusCoins >= AD.PERK_BY_ID.good_rapport.n);
});
t("掛網:照打,連勝照算但不發連勝加成", () => {
  const strong = base(["passerby"]), mk = (afk) => G.battleOnline(2, snap("a", Object.assign({}, strong, { streak: 5, gold: 0 }), { afk }), snap("b", G.normState({})), false, "afk", false).outcomes[0];
  const n = mk(false), a = mk(true);
  ok(n.eco.streakBonus > 0, "測試前提:正常玩家要有連勝加成"); eq(a.eco.streakBonus, 0); eq(a.patch.streak, n.patch.streak); eq(n.patch.gold - a.patch.gold, n.eco.streakBonus);
});
t("空狀態(沒進過頁面/測試機器人)雙方都能打:平手或勝負都不丟例外", () => {
  const x = G.battleOnline(1, snap("a", {}), snap("b", {}), false, "empty", false); eq(x.outcomes.length, 2);
  const y = G.battleOnline(1, snap("a", base(["passerby"])), snap("b", {}), false, "empty", false); eq(y.outcomes[0].res, "win");
});
t("扣血跟單機規則一致:輪次基礎傷害 + 贏家存活星數", () => {
  const strong = base(["passerby", "onlooker"]);
  const { r, outcomes: [, loser] } = G.battleOnline(6, snap("a", strong), snap("b", G.normState({})), false, "dmg", false);
  eq(loser.dmg, E.loseDamage(6, r.starsA));
});
t("一整場模擬:6 人場跑到只剩 1 人,名次不重複(模擬伺服器 settle/淘汰/finish)", () => {
  const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const P = {}; ids.forEach((id, i) => { const g = G.createOnline({ seed: "sim:" + id, name: id }); P[id] = { hp: 100, wins: 0, losses: 0, alive: true, elim: 0, overflow: 0, state: null, g }; });
  let round = 0;
  while (ids.filter((i) => P[i].alive).length > 1 && round < 60) {
    round++;
    const alive = ids.filter((i) => P[i].alive);
    alive.forEach((id) => { const p = P[id]; p.g = G.createOnline({ seed: "sim:" + id, name: id }); G.restore(p.g, p.state || {}, { hp: p.hp, wins: p.wins, losses: p.losses, alive: true }); G.catchUp(p.g, round);
      // 簡單策略:能買就買、全上陣
      for (let i = 0; i < 5; i++) { if (G.buy(p.g, i).ok) {} } G.sealPrep(p.g); p.g.me.board.push(...p.g.me.bench.splice(0, Math.max(0, G.slotsOf(p.g.me) - p.g.me.board.length))); p.state = G.serialize(p.g); });
    const order = alive.slice(); const pairs = []; for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1], false]); if (order.length % 2) pairs.push([order[order.length - 1], order[0], true]);
    pairs.forEach(([a, b, ghost], k) => {
      const { outcomes } = G.battleOnline(round, snap(a, P[a].state, { hp: P[a].hp }), snap(b, P[b].state, { hp: P[b].hp }), ghost, `sim|${round}|${k}`, false);
      outcomes.forEach((o) => { const p = P[o.player_id]; p.hp -= o.dmg; if (o.res === "win") p.wins++; if (o.res === "lose") p.losses++; p.state = Object.assign({}, p.state, o.patch); });
    });
    alive.forEach((id) => { const p = P[id]; if (p.hp <= 0) { p.alive = false; p.elim = round; p.overflow = -p.hp; } });
  }
  ok(round < 60, "跑太久沒結束(扣血可能有問題)");
  const rk = ids.slice().sort((x, y) => (P[y].alive - P[x].alive) || (P[y].alive ? P[y].hp - P[x].hp : 0) || (P[y].elim - P[x].elim) || (P[x].overflow - P[y].overflow) || (P[y].wins - P[x].wins));
  eq(new Set(rk).size, 6); ok(ids.filter((i) => P[i].alive).length <= 1);
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
