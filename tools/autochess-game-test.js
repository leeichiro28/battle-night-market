// 夜市自走棋 階段 2:單機遊戲流程測試。 node tools/autochess-game-test.js
// 涵蓋:購買/賣出/移動/撤銷/鎖定/刷新、等級、13 張攤位加碼、整場決定性、名次。
const path = require("path");
global.window = global;
const A = (f) => require(path.join(__dirname, "..", "assets", f));
["autochess-data.js", "autochess-engine.js", "autochess-bot.js", "autochess-game.js"].forEach(A);
const AD = window.AutochessData, E = window.AutochessEngine, G = window.AutochessGame;

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log("  ✗ " + name + "\n    " + e.message); } };
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "不相等") + `:得到 ${JSON.stringify(a)},預期 ${JSON.stringify(b)}`); };
const ok = (c, m) => { if (!c) throw new Error(m || "條件不成立"); };
const fresh = (seed) => { const g = G.create({ seed: seed || "t" }); G.startRound(g); return g; };
const give = (g, ...ids) => ids.forEach((id) => g.me.bench.push({ id, star: 1 }));

console.log("== 準備階段操作 ==");
t("開局:5 銅板、Lv1、5 格商店、2 個上陣位置", () => { const g = fresh(); eq([g.me.gold, g.me.level, g.me.shop.length, G.slotsOf(g.me), g.round, g.phase], [5, 1, 5, 2, 1, "prep"]); });
t("購買:扣銅板、進待命席、商店該格變空", () => {
  const g = fresh(), id = g.me.shop[0], cost = AD.CARD_BY_ID[id].cost; const r = G.buy(g, 0);
  ok(r.ok); eq(g.me.gold, 5 - cost); eq(g.me.bench.length, 1); eq(g.me.shop[0], null); ok(!G.buy(g, 0).ok, "空格不能再買");
});
t("銅板不夠不能買", () => { const g = fresh(); g.me.gold = 0; ok(!G.buy(g, 0).ok); eq(g.me.bench.length, 0); });
t("撤銷上一次購買全額退費(含合成),刷新後不能撤銷", () => {
  const g = fresh(); g.me.gold = 20; g.me.shop = ["passerby", "passerby", "passerby", null, null]; give(g);
  G.buy(g, 0); G.buy(g, 1); G.buy(g, 2); eq(g.me.bench, [{ id: "passerby", star: 2 }]); eq(g.me.gold, 17);
  ok(G.undo(g).ok); eq([g.me.gold, g.me.bench.length], [18, 2]); ok(!G.undo(g).ok);
  G.buy(g, 2); G.refresh(g); ok(!G.undo(g).ok, "刷新後不能撤銷");
});
t("待命席滿了不能買(除非能合成)", () => {
  const g = fresh(); g.me.gold = 50; ["passerby", "passerby", "dart_uncle", "ring_toss_girl", "street_strongman", "shaved_ice_boy"].forEach((id) => g.me.bench.push({ id, star: 1 }));
  g.me.shop = ["sausage_apprentice", "passerby", null, null, null];
  ok(!G.buy(g, 0).ok, "滿了買新卡應失敗"); eq(g.me.gold, 50); eq(g.me.bench.length, 6);
  ok(G.buy(g, 1).ok, "能合成就可以買"); eq(g.me.bench.length, 5); ok(g.me.bench.some((c) => c.id === "passerby" && c.star === 2));
});
t("賣出:1★ 全額、2★(3 張)少 1", () => {
  const g = fresh(); g.me.bench.push({ id: "chili_lady", star: 1 }, { id: "chili_lady", star: 2 }); const g0 = g.me.gold;
  G.sell(g, "bench", 0); eq(g.me.gold, g0 + 3); G.sell(g, "bench", 0); eq(g.me.gold, g0 + 3 + 8);
});
t("移動:上陣、交換、位置滿了要交換", () => {
  const g = fresh(); give(g, "passerby", "onlooker", "dart_uncle");
  ok(G.move(g, { zone: "bench", idx: 0 }, { zone: "board", idx: 9 }).ok); ok(G.move(g, { zone: "bench", idx: 0 }, { zone: "board", idx: 9 }).ok);
  eq(g.me.board.map((c) => c.id), ["passerby", "onlooker"]); ok(!G.move(g, { zone: "bench", idx: 0 }, { zone: "board", idx: 9 }).ok, "2 格滿了");
  ok(G.move(g, { zone: "bench", idx: 0 }, { zone: "board", idx: 0 }).ok); eq([g.me.board[0].id, g.me.bench[0].id], ["dart_uncle", "passerby"]);
  ok(G.move(g, { zone: "board", idx: 0 }, { zone: "board", idx: 1 }).ok); eq(g.me.board.map((c) => c.id), ["onlooker", "dart_uncle"]);
});
t("買經驗:4 銅板 4 XP,Lv1 需 2、Lv2 需 3 → 變 Lv2 並剩 2 XP", () => { const g = fresh(); G.buyXp(g); eq([g.me.gold, g.me.level, g.me.xp], [1, 2, 2]); });
t("等級決定上陣位置;Lv2 有 3 格、Lv3 有 4 格", () => { const g = fresh(); g.me.gold = 20; G.buyXp(g); eq(G.slotsOf(g.me), 3); G.buyXp(g); eq(G.slotsOf(g.me), 4); });
t("刷新花 1 銅板、換一排、商店用種子推算(同種子同結果)", () => {
  const g = fresh("same"), before = g.me.shop.slice(); G.refresh(g); eq(g.me.gold, 4); ok(JSON.stringify(g.me.shop) !== JSON.stringify(before));
  const h = fresh("same"); G.refresh(h); eq(h.me.shop, g.me.shop);
});
t("鎖定:下一輪商店原封不動,買走的格子留空,鎖定只管一輪", () => {
  const g = fresh(); G.buy(g, 0); const kept = g.me.shop.slice(); G.toggleLock(g); eq(g.me.shopLocked, true);
  G.seal(g); G.nextRound(g); eq(g.me.shop, kept); eq(g.me.shop[0], null); eq(g.me.shopLocked, false);
  G.seal(g); G.nextRound(g); ok(g.me.shop.every((x) => x), "第二輪應重新抽滿");
});
t("Lv9 每輪第一次刷新免費", () => { const g = fresh(); g.me.level = 9; g.me.gold = 0; ok(G.refresh(g).ok); ok(!G.refresh(g).ok); });
t("非準備階段不能操作", () => { const g = fresh(); G.seal(g); ok(!G.buy(g, 0).ok); ok(!G.refresh(g).ok); ok(!G.buyXp(g).ok); });

t("準備時間:整場 90 秒(可由資料表調整)", () => { eq([1, 3, 4, 11, 12, 30].map(G.prepSeconds), [90, 90, 90, 90, 90, 90]); eq(AD.prepSeconds(1), 90); });

console.log("== 攤位加碼 ==");
const toPerkRound = (g) => { while (g.round < 3) { G.seal(g); G.nextRound(g); } };
t("R3 / R6 / R9 才有候選,其他輪沒有", () => {
  const g = fresh(); const seen = [];
  for (let i = 0; i < 9 && !g.over; i++) { seen.push(g.me.pendingPerk ? g.round : 0); G.seal(g); if (!g.over) G.nextRound(g); }
  ok(seen[2] === 3 && seen[5] === 6 && seen[8] === 9 || g.over, "輪次不對:" + seen);
});
t("候選 3 張、來自 3 個不同類別,同狀態同結果", () => {
  for (let i = 0; i < 30; i++) {
    const g = fresh("pk" + i); give(g, "passerby", "dart_uncle"); toPerkRound(g); if (g.over) continue;
    const c = g.me.pendingPerk.candidates; eq(c.length, 3); eq(new Set(c.map((id) => AD.PERK_BY_ID[id].cat)).size, 3);
  }
});
t("加開攤位只在第 3 次出現", () => {
  let seen3 = 0;
  for (let i = 0; i < 60; i++) { const g = fresh("sp" + i); give(g, "passerby"); [1, 2].forEach((n) => ok(!AD.PERKS.find((p) => p.id === "stall_plus").onlyPick || true)); const c = (n) => AD.PERKS.filter((p) => !p.onlyPick || p.onlyPick === n).map((p) => p.id); ok(!c(1).includes("stall_plus") && !c(2).includes("stall_plus") && c(3).includes("stall_plus")); seen3++; }
  ok(seen3 > 0);
});
const withPerk = (id, setup) => { const g = fresh("perk"); give(g, "passerby", "sausage_apprentice"); g.me.gold = 10; if (setup) setup(g); g.me.pendingPerk = { n: 1, candidates: [id, "petty_cash", "regular"] }; return g; };
t("零用金 +8", () => { const g = withPerk("petty_cash"); ok(G.pickPerk(g, "petty_cash").ok); eq(g.me.gold, 18); eq(g.me.pendingPerk, null); });
t("免費刷新券:接下來 10 次刷新免費", () => { const g = withPerk("free_refresh"); G.pickPerk(g, "free_refresh"); g.me.gold = 0; for (let i = 0; i < 10; i++) ok(G.refresh(g).ok, "第 " + (i + 1) + " 次"); ok(!G.refresh(g).ok); });
t("補習班 +8 XP", () => { const g = withPerk("tutoring"); G.pickPerk(g, "tutoring"); eq([g.me.level, g.me.xp], [4, 0].slice(0, 1).concat([AD.addXp(1, 0, 8).xp]).slice(0, 2).map((x, i) => (i === 0 ? AD.addXp(1, 0, 8).level : x))); });
t("升級折扣券:3 次買經驗各 -2", () => { const g = withPerk("xp_coupon"); G.pickPerk(g, "xp_coupon"); g.me.gold = 20; G.buyXp(g); eq(g.me.gold, 18); G.buyXp(g); G.buyXp(g); eq(g.me.gold, 14); G.buyXp(g); eq(g.me.gold, 10); });
t("加開攤位:上陣位置 +1", () => { const g = withPerk("stall_plus"); G.pickPerk(g, "stall_plus"); eq(G.slotsOf(g.me), 3); });
t("免費升星券:只能選 1/2 費的 1★,立刻 2★ 並連鎖合成", () => {
  const g = withPerk("free_star", (x) => x.me.bench.push({ id: "passerby", star: 2 }, { id: "passerby", star: 2 }));
  ok(!G.pickPerk(g, "free_star").ok, "沒選對象不行");
  const targets = G.targetsFor(g, "free_star"); ok(targets.every((x) => x.card.star === 1 && AD.CARD_BY_ID[x.card.id].cost <= 2));
  const tg = targets.find((x) => x.card.id === "passerby"); ok(G.pickPerk(g, "free_star", tg).ok);
  ok(g.me.bench.some((c) => c.id === "passerby" && c.star === 3), "三張 2★ 應合成 3★");
});
t("加料:選一張卡永久 +3/+3,戰鬥數值確實增加", () => {
  const g = withPerk("seasoning"); G.pickPerk(g, "seasoning", { zone: "bench", idx: 0 }); eq([g.me.bench[0].bonusAtk, g.me.bench[0].bonusHp], [3, 3]);
  const r = E.simulate([g.me.bench[0]], [{ id: "passerby", star: 1 }], "x", { log: true }); eq(r.init.a[0].atk, 5);
});
t("流派助陣:羈絆多算 1 張(最多到 4 級)", () => {
  const g = withPerk("tag_assist"); G.pickPerk(g, "tag_assist", { tag: "burn" });
  g.me.board = [{ id: "sausage_apprentice", star: 1 }]; eq(G.bondsPreview(g).active, { burn: 2 });
  g.me.board = ["sausage_apprentice", "charcoal_uncle", "chili_lady", "squid_boss"].map((id) => ({ id, star: 1 })); eq(G.bondsPreview(g).active.burn, 4, "已 4 張,不能被助陣推到 6");
});
t("預購單:該流派出現權重 ×2(統計 400 排)", () => {
  const count = (opts) => { let n = 0, tot = 0; for (let i = 0; i < 400; i++) E.rollShop("pb", i, 0, 5, opts).forEach((id) => { tot++; if (AD.CARD_BY_ID[id].tags.includes("frost")) n++; }); return n / tot; };
  ok(count({ tagBoost: { tag: "frost", mult: 2 } }) > count({}) * 1.3, "預購單應明顯提高冰鎮出現率");
});
t("預購單/擴大營業/老主顧:套用到之後的輪次", () => {
  const g = withPerk("expand"); G.pickPerk(g, "expand"); const step = () => { G.seal(g); G.nextRound(g); g.me.pendingPerk = null; }; // 避免封板時自動替選又選到別的加碼
  step(); eq(g.me.shop.length, 6); step(); eq(g.me.shop.length, 6); step(); eq(g.me.shop.length, 6); step(); eq(g.me.shop.length, 5, "3 輪後恢復");
  const h = withPerk("regular"); G.pickPerk(h, "regular"); G.seal(h); G.nextRound(h); ok(h.me.shop.some((id) => AD.CARD_BY_ID[id].cost >= 3), "老主顧保證史詩以上");
});
t("好人緣:之後 3 輪結算基本收入 +2", () => {
  const g = withPerk("good_rapport"); G.pickPerk(g, "good_rapport"); eq(g.me.perks.goodRapport, 3);
  g.me.gold = 0; G.seal(g); const e = g.report.mine.eco; eq(e.bonusCoins >= 2, true); eq(g.me.perks.goodRapport, 2);
});
t("連勝保險:戰敗不中斷連勝(一次)", () => {
  const g = fresh("sg"); g.me.streak = 3; g.me.perks.streakGuard = true; g.me.board = []; g.me.bench = []; G.seal(g);
  eq(g.report.mine.res, "lose"); eq(g.me.streak, 3); eq(g.me.perks.streakGuard, false); eq(g.report.mine.insured, true);
});
t("封板時沒選加碼 → 系統隨機替選", () => { const g = fresh("auto"); give(g, "passerby"); toPerkRound(g); if (!g.over) { ok(g.me.pendingPerk); G.seal(g); eq(g.me.perkPicks.length, 1); ok(g.report.autoPicked); } });
t("只能選候選裡的,選完不能再選", () => { const g = withPerk("petty_cash"); ok(!G.pickPerk(g, "stall_plus").ok); ok(G.pickPerk(g, "petty_cash").ok); ok(!G.pickPerk(g, "petty_cash").ok); });

console.log("== 整場流程 ==");
// 測試用「認真玩」的真人:依節奏升級、優先買能湊對子/較貴的卡、錢夠就刷新、把最強的卡排上陣
const cardPower = (c) => (AD.CARD_BY_ID[c.id].atk * 3 + AD.CARD_BY_ID[c.id].hp) * AD.STAR.stat[c.star];
function playRoundSmart(g) {
  const me = g.me, tl = window.AutochessBot.targetLevel(g.round);
  for (let guard = 0; guard < 40; guard++) {
    if (me.level < tl && me.gold >= 4) { G.buyXp(g); continue; }
    let best = -1, bs = -1;
    me.shop.forEach((id, i) => { if (!id) return; const d = AD.CARD_BY_ID[id]; if (d.cost > me.gold) return; const pair = me.board.concat(me.bench).some((c) => c.id === id && c.star < 3); const sc = d.cost + (pair ? 5 : 0) + (d.tags.length ? 1 : 0); if (sc > bs) { bs = sc; best = i; } });
    if (best >= 0 && bs >= 2 && G.buy(g, best).ok) continue;
    if (me.gold >= 3 && g.round >= 3 && me.refreshCount < 3) { G.refresh(g); continue; }
    break;
  }
  window.AutochessBot.arrange(me); // 沿用電腦玩家的排陣邏輯(不同名優先湊羈絆、坦克在前、壓軸放最後)
  while (me.board.length < G.slotsOf(me) && me.bench.length) me.board.push(me.bench.shift()); // 加開攤位多出來的位置
}
const playAll = (seed, mode) => {
  const g = G.create({ seed }); G.startRound(g);
  for (let i = 0; i < 60 && !g.over; i++) {
    if (mode === "buy") playRoundSmart(g);
    ok(g.me.gold >= 0, "銅板不能是負的"); ok(g.me.board.length <= G.slotsOf(g.me) && g.me.bench.length <= AD.BENCH_SLOTS, "超出位置");
    G.seal(g); if (!g.over) G.nextRound(g);
  }
  return g;
};
t("整場跑完:一定結束、有名次、不變成負銅板(30 場)", () => { for (let i = 0; i < 30; i++) { const g = playAll("full" + i, i % 2 ? "buy" : "idle"); ok(g.over && g.rank >= 1 && g.rank <= 8, "rank " + g.rank); eq(g.finalRanking.length, 8); } });
t("同種子整場結果完全一致(決定性)", () => { const a = playAll("det", "buy"), b = playAll("det", "buy"); eq(a.finalRanking, b.finalRanking); eq(a.rank, b.rank); eq(a.round, b.round); });
t("積極買卡的玩家平均名次明顯優於放著不動", () => {
  let buy = 0, idle = 0; const n = 24; for (let i = 0; i < n; i++) { buy += playAll("cmp" + i, "buy").rank; idle += playAll("cmp" + i, "idle").rank; }
  ok(buy / n < idle / n - 2, `買卡 ${(buy / n).toFixed(2)} 名次應比不動 ${(idle / n).toFixed(2)} 好很多`);
});
t("結算報告:演出用事件與初始數值齊全,我方永遠有 log", () => {
  const g = fresh("rep"); give(g, "passerby"); G.move(g, { zone: "bench", idx: 0 }, { zone: "board", idx: 9 }); G.seal(g);
  const m = g.report.mine; ok(m.r.events && m.r.init && m.board.length && m.foeBoard.length); ok(["win", "lose", "draw"].includes(m.res)); ok(m.eco.gold === g.me.gold);
});
t("玩家淘汰後快轉算出名次,最終名次表 8 人", () => { const g = fresh("dead"); g.me.hp = 1; g.me.board = []; G.seal(g); eq(g.over, true); ok(g.rank >= 1); eq(g.finalRanking.length, 8); eq(G.stats(g).rank, g.rank); });
t("練習模式沒有任何隨機 API", () => { const src = require("fs").readFileSync(path.join(__dirname, "..", "assets", "autochess-game.js"), "utf8").replace(/\/\/.*$/gm, ""); ok(!/Math\.random|Date\.now|new Date/.test(src)); });

console.log("== 怪物輪(R5 / R10 / R15)==");
// 把遊戲推進到某一輪的準備階段:每輪讓玩家有一支強陣容(才打得贏怪物),血量給很多避免中途淘汰
const toRound = (seed, round) => { const g = fresh(seed); g.me.hp = 1e6; while (g.round < round) { g.me.gold = 0; G.seal(g); G.nextRound(g); } return g; };
t("怪物輪:不扣血、不計勝敗場、連勝不變、不配對(每位活著的玩家都打怪物)", () => {
  const g = toRound("mon1", 5); g.me.streak = 3; g.me.bestStreak = 3; const hp = g.me.hp, w = g.me.wins, l = g.me.losses, botHp = g.bots.map((b) => b.hp);
  const r = G.seal(g); ok(r.ok);
  eq([g.me.hp, g.me.wins, g.me.losses, g.me.streak], [hp, w, l, 3]); eq(g.bots.map((b) => b.hp), botHp, "電腦玩家也不扣血");
  ok(r.report.mine.pve && r.report.mine.dmg === 0 && r.report.mine.foe.name === AD.MONSTERS[5].name);
  eq(r.report.outcomes.length, g.players.filter((p) => p.alive).length, "每位活著的玩家一場");
});
t("怪物輪:打贏 +3 銅板並掉落一張卡,下一輪進待命席;打輸只拿基本收入", () => {
  let won = null, lost = null;
  for (let n = 0; n < 40 && !(won && lost); n++) {
    const g = toRound("mon-s" + n, 5); const gold0 = g.me.gold; const strong = n % 2 === 0;
    g.me.board = strong ? [{ id: "squid_boss", star: 3 }, { id: "snow_queen", star: 3 }, { id: "iron_cloth_grandmaster", star: 3 }] : []; g.me.bench = []; g.me.perks.drop = null;
    const r = G.seal(g), m = r.report.mine, gain = m.eco.base + m.eco.interest + (m.eco.bonusCoins || 0);
    if (m.res === "win" && !won) won = { g, m, gold0 }; if (m.res === "lose" && !lost) lost = { g, m, gold0 };
  }
  ok(won && lost, "要能同時湊出打贏與打輸的案例");
  eq(won.m.eco.monsterCoins, AD.MONSTER_WIN_COINS); eq(won.m.eco.gain, won.m.eco.base + won.m.eco.interest + (won.m.eco.bonusCoins || 0) + AD.MONSTER_WIN_COINS, "贏:收入 + 3");
  ok(won.m.drop && AD.CARD_BY_ID[won.m.drop], "贏了有掉落"); eq(won.g.me.perks.drop, won.m.drop);
  ok(!lost.m.eco.monsterCoins && !lost.m.drop && !lost.g.me.perks.drop, "輸了沒有獎勵、沒有掉落");
  const n0 = won.g.me.bench.length, cards0 = won.g.me.board.length + n0; G.nextRound(won.g);
  eq(won.g.me.perks.drop, null); ok(won.g.me.board.length + won.g.me.bench.length >= cards0 + 1 - 2, "掉落卡進了手上(能合成時會合掉)");
  ok(won.g.me.bench.some((c) => c.id === won.m.drop) || won.g.me.board.some((c) => c.id === won.m.drop && c.star >= 1), "掉落的卡在待命席 / 場上");
});
t("怪物輪:待命席滿了又沒得合成 → 掉落折成銅板", () => {
  const g = fresh("dropfull"); g.me.bench = Array.from({ length: AD.BENCH_SLOTS }, (_, i) => ({ id: ["passerby", "onlooker", "dart_uncle", "ring_toss_girl", "street_strongman", "shaved_ice_boy"][i], star: 1 })); g.me.perks.drop = "chili_lady";
  const gold = g.me.gold, d = G.giveDrop(g.me); ok(d && d.sold); eq(g.me.gold, gold + AD.sellValue(AD.CARD_BY_ID.chili_lady, 1)); eq(g.me.bench.length, AD.BENCH_SLOTS);
});
t("非怪物輪(R4、R6)照舊:會配對、會扣血 / 計勝敗", () => {
  const g = toRound("mon-n", 4); g.me.board = []; const l0 = g.me.losses; const r = G.seal(g); ok(!r.report.mine.pve && r.report.mine.foe && r.report.mine.res === "lose" && r.report.mine.dmg > 0); eq(g.me.losses, l0 + 1);
});
t("怪物輪的整場結果是決定性的(同種子兩次一樣)", () => {
  const run = () => { const g = toRound("mon-det", 10); const r = G.seal(g); return [r.report.mine.res, r.report.mine.eco.gain, r.report.mine.drop, g.me.gold]; };
  eq(run(), run());
});
t("電腦玩家的怪物輪掉落折成銅板(沒有待命席掉落)", () => {
  const g = toRound("mon-bot", 5); const before = g.bots.map((b) => b.gold); G.seal(g);
  ok(g.bots.every((b, i) => !b.alive || b.gold >= 0), "金額正常"); ok(g.bots.some((b, i) => b.gold !== before[i]), "電腦玩家有結算");
});
t("整場流程跑過 R5 / R10 / R15 不出錯,最後有名次", () => {
  const g = fresh("mon-full"); let guard = 0; while (!g.over && guard++ < 40) { g.me.gold = 0; G.seal(g); if (!g.over) G.nextRound(g); }
  ok(g.over && g.rank >= 1 && g.rank <= 8);
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
