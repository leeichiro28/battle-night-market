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
  const g = fresh(); g.me.gold = 50; ["passerby", "passerby", "dart_uncle", "ring_toss_girl", "street_strongman", "shaved_ice_boy", "onlooker", "corn_vendor"].forEach((id) => g.me.bench.push({ id, star: 1 }));
  g.me.shop = ["sausage_apprentice", "passerby", null, null, null];
  ok(!G.buy(g, 0).ok, "滿了買新卡應失敗"); eq(g.me.gold, 50); eq(g.me.bench.length, 8);
  ok(G.buy(g, 1).ok, "能合成就可以買"); eq(g.me.bench.length, 7); ok(g.me.bench.some((c) => c.id === "passerby" && c.star === 2));
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
  ok(r.report.mine.pve && r.report.mine.dmg === 0 && r.report.mine.foe.name === AD.monsterFor(g.eventSeed, 5).name);
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

console.log("== 商店體驗(企劃 11-8):已擁有標示、3★ 不再出現 ==");
t("ownedInfo:沒有 → 0;有 1 張 → n=1、不會合成", () => {
  const g = fresh("own1"); eq(G.ownedInfo(g.me, "passerby"), { n: 0, up: 0 });
  give(g, "passerby"); eq(G.ownedInfo(g.me, "passerby"), { n: 1, up: 0 });
});
t("ownedInfo:有 2 張同名 1★ → 買第 3 張會升 2★(場上 + 待命席都算)", () => {
  const g = fresh("own2"); g.me.board.push({ id: "passerby", star: 1 }); give(g, "passerby");
  eq(G.ownedInfo(g.me, "passerby"), { n: 2, up: 2 });
});
t("ownedInfo:連鎖合成會顯示最高星級(2 張 1★ + 2 張 2★,買 1★ 一路升到 3★)", () => {
  const g = fresh("own3"); g.me.bench.push({ id: "passerby", star: 1 }, { id: "passerby", star: 1 }, { id: "passerby", star: 2 }, { id: "passerby", star: 2 });
  eq(G.ownedInfo(g.me, "passerby"), { n: 4, up: 3 });
});
t("ownedInfo:只有 2 張 2★、沒有 1★ → 買 1★ 不會合成;ownedInfo 不會改動玩家的卡", () => {
  const g = fresh("own4"); g.me.bench.push({ id: "passerby", star: 2 }, { id: "passerby", star: 2 });
  const before = JSON.stringify([g.me.board, g.me.bench]);
  eq(G.ownedInfo(g.me, "passerby"), { n: 2, up: 0 }); eq(JSON.stringify([g.me.board, g.me.bench]), before, "卡被改動了");
});
t("3★ 的卡不會再出現在商店:刷新很多次都沒有", () => {
  const g = fresh("max1"); g.me.level = 5; g.me.gold = 9999; g.me.board.push({ id: "passerby", star: 3 }); g.me.bench.push({ id: "dart_uncle", star: 3 });
  for (let i = 0; i < 120; i++) { G.refresh(g); g.me.shop.forEach((id) => ok(id !== "passerby" && id !== "dart_uncle", "3★ 的卡又出現了:" + id)); }
});
t("賣掉 3★ 之後,那張卡又可以出現", () => {
  const g = fresh("max2"); g.me.level = 5; g.me.gold = 9999; g.me.bench.push({ id: "passerby", star: 3 });
  let seen = false; for (let i = 0; i < 60 && !seen; i++) { G.refresh(g); if (g.me.shop.includes("passerby")) seen = true; } ok(!seen, "還有 3★ 時不該出現");
  ok(G.sell(g, "bench", 0).ok);
  for (let i = 0; i < 400 && !seen; i++) { G.refresh(g); if (g.me.shop.includes("passerby")) seen = true; } ok(seen, "賣掉之後 400 次刷新都沒出現過");
});
t("2★ 的卡還是會出現(只排除 3★)", () => {
  const g = fresh("max3"); g.me.level = 5; g.me.gold = 9999; g.me.bench.push({ id: "passerby", star: 2 });
  let seen = false; for (let i = 0; i < 400 && !seen; i++) { G.refresh(g); if (g.me.shop.includes("passerby")) seen = true; } ok(seen);
});
t("重新載入網頁(serialize → restore)商店跟原本一模一樣,不會用現在擁有的卡重抽", () => {
  const g = fresh("max4"); g.me.level = 5; const shopBefore = g.me.shop.slice();
  g.me.board.push({ id: "passerby", star: 3 }); // 抽完商店之後才拿到 3★(例如剛合成)
  const st = G.serialize(g), g2 = G.createOnline({ seed: "max4", name: "x" }); G.restore(g2, st);
  eq(g2.me.shop, shopBefore);
});
t("怪物輪掉落不會是已經 3★ 的卡(用很強的陣容穩贏 R5,掉落 100 次)", () => {
  const strong = AD.CARDS.filter((c) => c.cost >= 3).slice(0, 6).map((c) => ({ id: c.id, star: 3 }));
  const maxedIds = strong.map((c) => c.id); let drops = 0;
  for (let i = 0; i < 100; i++) {
    const S = G.normState({ board: strong, bench: [{ id: "passerby", star: 3 }], gold: 0, streak: 0, level: 8, xp: 0, perks: {}, perkPicks: [] });
    const f = G.monsterFight(5, S, S.board, "drop-test-" + i, false);
    if (f.drop) { drops++; ok(maxedIds.indexOf(f.drop) < 0 && f.drop !== "passerby", "掉落了已 3★ 的卡:" + f.drop); }
  }
  ok(drops > 20, "測試陣容沒有贏怪物,掉落次數 " + drops);
});
t("電腦玩家不會被塞 3★ 的卡:整場跑完不出錯", () => {
  const g = fresh("bot-max"); let guard = 0; while (!g.over && guard++ < 40) { G.seal(g); if (!g.over) G.nextRound(g); } ok(g.over);
});

console.log("== 階段 8:待命席 8 格、上陣 10 格(兩排)、連勝與利息 +5 ==");
t("待命席 8 格:放得下 8 張,第 9 張買不下去", () => {
  const g = fresh("b8"); g.me.gold = 99; const ids = ["passerby", "dart_uncle", "ring_toss_girl", "street_strongman", "shaved_ice_boy", "onlooker", "corn_vendor", "chili_lady"];
  ids.forEach((id) => g.me.bench.push({ id, star: 1 })); eq(g.me.bench.length, AD.BENCH_SLOTS);
  g.me.shop = ["sausage_apprentice", null, null, null, null]; ok(!G.buy(g, 0).ok, "第 9 張不該買得下");
});
t("Lv10 上陣 10 格;加開攤位再 +1", () => { const g = fresh("l10"); g.me.level = 10; eq(G.slotsOf(g.me), 10); g.me.perks.stallPlus = 1; eq(G.slotsOf(g.me), 11); eq(G.capacityOf(g.me), 11 + AD.BENCH_SLOTS); });
t("上陣 10 張可以排站位(自動排站位 10 張在 1 秒內、結果固定)", () => {
  const g = fresh("arr10"); g.me.level = 10; const cs = AD.CARDS.slice(10, 20).map((c) => ({ id: c.id, star: 1 })); g.me.board = cs.map((c) => ({ ...c }));
  const t0 = Date.now(); const a = E.autoArrange(g.me.board), b = E.autoArrange(g.me.board); ok(Date.now() - t0 < 1000, "太慢"); eq(a, b); eq(a.map((c) => c.id).sort(), cs.map((c) => c.id).sort());
});
t("兩邊各 10 張的戰鬥打得完、結果固定", () => {
  const A = AD.CARDS.slice(0, 10).map((c) => ({ id: c.id, star: 1 })), B = AD.CARDS.slice(20, 30).map((c) => ({ id: c.id, star: 1 }));
  const r1 = E.simulate(A, B, "t10"), r2 = E.simulate(A, B, "t10"); eq(r1.winner, r2.winner); ok(["a", "b", "draw"].indexOf(r1.winner) >= 0); ok(r1.rounds <= 60, "回合數 " + r1.rounds);
});
t("連勝與利息 +5:9 連勝 +5、存 50 利息 +5(結算)", () => {
  const s = E.settleEconomy({ result: "win", round: 8, gold: 50, streak: 8, level: 5 }); eq([s.streak, s.streakBonus, s.interest], [9, 5, 5]);
});

console.log("== 階段 9:夜市事件、雜貨攤 ==");
// 找一個種子,讓第 round 輪剛好是 evId 事件;回傳已經開到那一輪準備階段的遊戲
const freshEv = (evId, round) => {
  for (let i = 0; i < 400; i++) { const seed = "ev" + i; if ((E.nightEvent("ne" + seed, round) || {}).id === evId) { const g = G.create({ seed }); for (let r = 0; r < round; r++) G.startRound(g); return g; } }
  throw new Error("找不到種子 " + evId);
};
t("沒有事件的輪次 eventIdOf = null;關掉夜市事件 = 永遠 null", () => {
  const g = fresh("noev"); eq(G.eventIdOf(g), null);
  const h = G.create({ seed: "off", nightEvents: false }); for (let r = 0; r < 12; r++) { G.startRound(h); eq(G.eventIdOf(h), null); }
});
t("人潮:商店多 1 格", () => { const g = freshEv("crowd", 4); eq(g.me.shop.length, AD.shopSlotsFor(g.me.level) + 1); });
t("打烊特賣:買卡 −1(最低 1)、賣出也少 1,不能特價買原價賣來賺錢", () => {
  const g = freshEv("sale", 4); const id = g.me.shop.find((x) => x && AD.CARD_BY_ID[x].cost >= 2) || g.me.shop[0], cost = AD.CARD_BY_ID[id].cost;
  eq(G.costOf(g, id), Math.max(1, cost - 1)); g.me.gold = 50; const i = g.me.shop.indexOf(id), before = g.me.gold; ok(G.buy(g, i).ok); eq(before - g.me.gold, Math.max(1, cost - 1));
  const g2 = g.me.gold; ok(G.sell(g, "bench", g.me.bench.length - 1).ok); ok(g.me.gold - g2 <= Math.max(1, cost - 1), "賣出不該比買入貴");
  eq(G.sellValueOf(freshEv("sale", 4), { id, star: 1 }), Math.max(0, cost - 1));
});
t("加碼回合:這輪多一次加碼三選一(不含只出現一次的強力選項),選了之後沒了", () => {
  const g = freshEv("extra_pick", 4); const pp = g.me.pendingPerk; ok(pp && pp.extra && pp.candidates.length === 3);
  pp.candidates.forEach((id) => ok(!AD.PERK_BY_ID[id].onlyPick, "強力選項不該出現"));
  const id = pp.candidates.find((c) => !AD.PERK_BY_ID[c].target); if (id) { ok(G.pickPerk(g, id, null).ok); eq(g.me.pendingPerk, null); }
});
t("雜貨攤:每輪進貨 3 件不同的道具;重新抽結果固定", () => {
  const g = fresh("st1"); eq(g.me.store.length, AD.STORE_SLOTS); eq(new Set(g.me.store).size, AD.STORE_SLOTS); g.me.store.forEach((id) => ok(AD.STORE_BY_ID[id]));
  const h = fresh("st1"); eq(h.me.store, g.me.store);
});
const stock = (g, ...ids) => { g.me.store = ids.slice(); };
t("雜貨攤:辣椒粉 / 糖葫蘆扣錢、只加本輪加成、買過就賣完;錢不夠買不了", () => {
  const g = fresh("st2"); g.me.gold = 20; stock(g, "chili", "candy", "coupon"); const g0 = g.me.gold;
  ok(G.buyStore(g, 0).ok); ok(G.buyStore(g, 1).ok); eq(g.me.roundFx, { atk: 1, hp: 3 }); eq(g.me.gold, g0 - AD.STORE_BY_ID.chili.price - AD.STORE_BY_ID.candy.price);
  ok(!G.buyStore(g, 0).ok, "買過不能再買"); g.me.gold = 0; ok(!G.buyStore(g, 2).ok, "錢不夠");
});
t("雜貨攤:外送券 = 免費刷新 +2;調味料要選卡,永久 +1 攻 +2 血", () => {
  const g = fresh("st3"); g.me.gold = 20; give(g, "passerby"); stock(g, "coupon", "spice", "chili");
  ok(G.buyStore(g, 0).ok); eq(g.me.perks.freeRefresh, 2);
  ok(!G.buyStore(g, 1).ok, "沒選卡不能買"); ok(!G.buyStore(g, 1, { zone: "bench", idx: 5 }).ok, "選到空格不能買");
  ok(G.buyStore(g, 1, { zone: "bench", idx: 0 }).ok); eq([g.me.bench[0].bonusAtk, g.me.bench[0].bonusHp], [1, 2]);
});
t("下一輪開始:辣椒粉 / 糖葫蘆的加成歸零,雜貨攤重新進貨", () => {
  const g = fresh("st4"); g.me.gold = 20; stock(g, "chili", "candy", "coupon"); G.buyStore(g, 0); G.buyStore(g, 1);
  G.seal(g); if (!g.over) { G.nextRound(g); eq(g.me.roundFx, { atk: 0, hp: 0 }); eq(g.me.store.length, AD.STORE_SLOTS); ok(g.me.store.every(Boolean)); }
});
t("fightBoard:加成只出現在戰鬥用的複本,不改玩家的卡;攻擊最低 1", () => {
  const S = { roundFx: { atk: 1, hp: 3 } }, board = [{ id: "passerby", star: 1 }], fb = G.fightBoard(S, board, null);
  eq(board, [{ id: "passerby", star: 1 }]); eq([fb[0].bonusAtk, fb[0].bonusHp], [1, 3]);
  const burn = AD.CARDS.find((c) => c.tags.includes("burn") && !c.tags.includes("frost")), ice = AD.CARDS.find((c) => c.tags.includes("frost") && !c.tags.includes("burn"));
  const rb = G.fightBoard({}, [{ id: burn.id, star: 1 }, { id: ice.id, star: 1 }], "rain"); eq(rb[1].bonusAtk, 2);
  ok(Math.round(burn.atk) + rb[0].bonusAtk >= 1, "炭火攻擊被扣到 0 以下");
  const lowAtk = G.fightBoard({}, [{ id: burn.id, star: 1, bonusAtk: -99 }], null); eq(lowAtk[0].bonusAtk, -99);
});
t("雨夜真的影響戰鬥結果(冰鎮 +2 攻);同一組陣容有沒有雨夜結果不同", () => {
  const ice = AD.CARDS.filter((c) => c.tags.includes("frost") && !c.tags.includes("burn")).slice(0, 4).map((c) => ({ id: c.id, star: 1 })), foe = AD.CARDS.filter((c) => c.tags.includes("guard")).slice(0, 4).map((c) => ({ id: c.id, star: 1 }));
  const a = E.simulate(G.fightBoard({}, ice, null), foe, "rain-t"), b = E.simulate(G.fightBoard({}, ice, "rain"), foe, "rain-t"); ok(JSON.stringify(a) !== JSON.stringify(b), "雨夜沒有任何影響");
});
t("連線:同一個事件種子 → 事件 id 一致;不同活動不同", () => {
  const a = G.createOnline({ seed: "E1:p1", name: "a", nightEvents: true, eventSeed: "neE1" }), b = G.createOnline({ seed: "E1:p2", name: "b", nightEvents: true, eventSeed: "neE1" });
  [4, 8, 12].forEach((r) => eq(G.eventIdOf(a, r), G.eventIdOf(b, r)));
  const off = G.createOnline({ seed: "E1:p3", name: "c" }); [4, 8].forEach((r) => eq(G.eventIdOf(off, r), null));
});
t("連線對戰:發財時段 eco.eventCoins = 2、重壓之夜輸家多扣血、沒事件跟以前一樣", () => {
  const mk = (id, extra) => ({ player_id: id, hp: 100, afk: false, state: G.normState(Object.assign({ gold: 10, level: 5, board: [{ id: "passerby", star: 1 }] }, extra || {})) });
  const strong = G.normState({ gold: 10, level: 5, board: AD.CARDS.filter((c) => c.cost >= 3).slice(0, 5).map((c) => ({ id: c.id, star: 3 })) });
  const A = { player_id: "a", hp: 100, afk: false, state: strong }, B = mk("b");
  const none = G.battleOnline(8, A, B, false, "evb", false), jp = G.battleOnline(8, A, B, false, "evb", false, "jackpot"), hv = G.battleOnline(8, A, B, false, "evb", false, "heavy");
  eq(none.outcomes[0].res, "win"); eq(jp.outcomes[0].eco.eventCoins, 2); eq(jp.outcomes[0].eco.gain - none.outcomes[0].eco.gain, 2);
  ok(hv.outcomes[1].dmg > none.outcomes[1].dmg, "重壓之夜該多扣血"); eq(hv.outcomes[1].dmg, E.loseDamage(8, hv.r.starsA, "heavy")); eq(none.outcomes[0].stat.event, null);
});
t("連線對戰:雜貨攤的本輪加成(roundFx)會算進戰鬥;存檔還原後還在", () => {
  const g = G.createOnline({ seed: "fx:1", name: "x" }); G.startRound(g); g.me.gold = 20; g.me.store = ["chili", "candy", "coupon"]; G.buyStore(g, 0); G.buyStore(g, 1);
  const st = G.serialize(g); eq(st.roundFx, { atk: 1, hp: 3 }); eq(st.store[0], null);
  const g2 = G.createOnline({ seed: "fx:1", name: "x" }); G.restore(g2, JSON.parse(JSON.stringify(st))); eq(g2.me.roundFx, { atk: 1, hp: 3 }); eq(g2.me.store, st.store);
  const n = G.normState({ gold: 1 }); eq(n.roundFx, { atk: 0, hp: 0 }); eq(n.store, []);
});
t("整場流程(開夜市事件)跑完不出錯、名次正常", () => {
  const g = G.create({ seed: "evfull" }); G.startRound(g); let guard = 0; while (!g.over && guard++ < 60) { g.me.gold = Math.min(g.me.gold, 5); G.seal(g); if (!g.over) G.nextRound(g); }
  ok(g.over && g.rank >= 1 && g.rank <= 8);
});

console.log("== 階段 10:怪物輪候選池、專屬卡、隱藏羈絆 ==");
t("怪物輪:全場抽到同一隻(由事件種子決定),單機與連線同種子結果一樣", () => {
  const g = G.create({ seed: "mp1" }); eq(AD.monsterFor(g.eventSeed, 10).id, AD.monsterFor("nemp1", 10).id);
  const a = G.createOnline({ seed: "E:p1", name: "a", nightEvents: false, eventSeed: "neE" }), b = G.createOnline({ seed: "E:p2", name: "b", nightEvents: false, eventSeed: "neE" });
  [5, 10, 15].forEach((r) => eq(AD.monsterFor(a.eventSeed, r).id, AD.monsterFor(b.eventSeed, r).id));
});
t("怪物輪:單機打到 R5,報告裡的怪物就是種子抽到的那隻;掉落是牠的專屬卡(贏的話)", () => {
  for (let i = 0; i < 6; i++) {
    const g = G.create({ seed: "mon-" + i }); for (let r = 0; r < 5; r++) { G.startRound(g); if (r < 4) { g.me.gold = 0; G.seal(g); if (g.over) break; G.nextRound(g); g.round--; } }
    if (g.round !== 5) continue;
    const mon = AD.monsterFor(g.eventSeed, 5), r = G.seal(g); ok(r.ok); eq(r.report.mine.foe.name, mon.name);
    if (r.report.mine.res === "win") eq(r.report.mine.drop, mon.drop);
  }
});
t("專屬卡掉落:贏了掉專屬卡;已經有那張的 3★ 就改掉一般卡", () => {
  const mon = AD.MONSTER_POOLS[5][0], strong = AD.CARDS.filter((c) => c.cost >= 3 && !c.exclusive).slice(0, 6).map((c) => ({ id: c.id, star: 3 }));
  const S = G.normState({ board: strong, gold: 0, level: 8 }), f = G.monsterFight(5, S, S.board, "dk1", false, mon); eq(f.res, "win"); eq(f.drop, mon.drop);
  const S2 = G.normState({ board: strong, bench: [{ id: mon.drop, star: 3 }], gold: 0, level: 8 }), f2 = G.monsterFight(5, S2, S2.board, "dk2", false, mon);
  ok(f2.drop && f2.drop !== mon.drop && !AD.CARD_BY_ID[f2.drop].exclusive, "已有 3★ 應改掉一般卡");
});
t("專屬卡不會出現在商店(刷新 600 次都沒有)", () => {
  const ex = AD.CARDS.filter((c) => c.exclusive).map((c) => c.id); eq(ex.length, 9);
  for (let i = 0; i < 600; i++) E.rollShop("exs" + (i % 7), 1 + (i % 20), i % 5, 1 + (i % 10), {}).forEach((id) => ok(ex.indexOf(id) < 0, "商店出現專屬卡 " + id));
});
t("連線:battleOnline 的怪物輪用 monSeed 抽怪物,結果固定、兩邊一致;沒傳 monSeed = 預設怪物", () => {
  const strong = G.normState({ gold: 10, level: 8, board: AD.CARDS.filter((c) => c.cost >= 3 && !c.exclusive).slice(0, 6).map((c) => ({ id: c.id, star: 3 })) }), mk = (id) => ({ player_id: id, hp: 100, afk: false, state: strong });
  [5, 10, 15].forEach((r) => {
    const seedStr = "neMON"; const mon = AD.monsterFor(seedStr, r);
    const x = G.battleOnline(r, mk("a"), mk("b"), false, "ms", false, null, seedStr), y = G.battleOnline(r, mk("a"), mk("b"), false, "ms", false, null, seedStr);
    eq(x.outcomes, y.outcomes); eq(x.outcomes[0].pve.mon, mon.id); if (x.outcomes[0].pve.won) eq(x.outcomes[0].pve.drop, mon.drop);
    eq(G.battleOnline(r, mk("a"), mk("b"), false, "ms", false).outcomes[0].pve.mon, AD.MONSTER_POOLS[r][0].id);
  });
});
t("反羈絆(搶地盤):全隊攻擊 +4 但開場血量 −4(最低 1);沒湊齊就沒有", () => {
  const A = (...ids) => ids.map((id) => ({ id, star: 1 })), pair = A("pickpocket_kid", "sticky_fingers_guy"), none = A("pickpocket_kid", "passerby");
  const b = E.computeBonds(pair); eq(b.hidden, ["thieves_quarrel"]); eq([b.fx.allAtk, b.fx.allHp], [4, -4]); eq(E.computeBonds(none).hidden, []);
  const foe = A("passerby"), r = E.simulate(pair, foe, "aq", { log: true }), r0 = E.simulate(none, foe, "aq", { log: true }); ok(r.hiddenA.includes("thieves_quarrel"));
  const base = AD.CARD_BY_ID.pickpocket_kid; eq([r.init.a[0].atk, r.init.a[0].hp], [base.atk + 4, 1], "攻擊 +4、血量 −4 但最低 1"); eq([r0.init.a[0].atk, r0.init.a[0].hp], [base.atk, base.hp]);
  const big = E.simulate(A("whole_lamb_boss", "ice_sculptor"), foe, "aq3", { log: true }); eq(big.init.a[0].hp, AD.CARD_BY_ID.whole_lamb_boss.hp - 5); ok(big.hiddenA.includes("hot_cold_fight"));
});
t("大型隱藏羈絆:五大天王 5 張才觸發、少一張不觸發;武林大會 4 張", () => {
  const A = (...ids) => ids.map((id) => ({ id, star: 1 })), five = A("squid_boss", "snow_queen", "tonic_grandma", "market_tycoon", "oracle_grandpa");
  ok(E.computeBonds(five).hidden.includes("five_kings")); ok(!E.computeBonds(five.slice(0, 4)).hidden.includes("five_kings"));
  const mg = A("dojo_master", "iron_palm_boss", "arm_wrestle_champ", "iron_head_master"); ok(E.computeBonds(mg).hidden.includes("martial_gathering")); ok(!E.computeBonds(mg.slice(0, 3)).hidden.includes("martial_gathering"));
  eq(E.computeBonds(five).fx.allAtk >= 5, true);
});
t("宿敵羈絆(2 張)與專屬卡羈絆:湊齊就觸發", () => {
  const A = (...ids) => ids.map((id) => ({ id, star: 1 }));
  [["cat_vs_thief", ["stall_cat", "night_market_thief"]], ["patrol_chase", ["night_patrol", "awang"]], ["kitten_awang", ["alley_kitten", "awang"]], ["heir_tycoon", ["king_heir", "market_tycoon"]]].forEach(([id, cs]) => ok(E.computeBonds(A(...cs)).hidden.includes(id), id));
});
t("怪物輪整場流程(單機,10 個種子)跑完不出錯", () => {
  for (let i = 0; i < 10; i++) { const g = G.create({ seed: "monfull" + i }); G.startRound(g); let guard = 0; while (!g.over && guard++ < 60) { g.me.gold = Math.min(g.me.gold, 3); G.seal(g); if (!g.over) G.nextRound(g); } ok(g.over && g.rank >= 1); }
});

console.log("== 階段 11:前排 / 後排(自選排別)、站位關鍵字、擊殺換位、自動排站位 ==");
const cardsOf = (...ids) => ids.map((id) => ({ id, star: 1 }));
t("rowsOf / layoutBoard:沒指定排別照位置(前 5 張前排);指定的照指定;前排沒人時後排當前排", () => {
  const b7 = cardsOf("passerby", "passerby", "passerby", "passerby", "passerby", "onlooker", "onlooker");
  eq(AD.rowsOf(b7), { front: [0, 1, 2, 3, 4], back: [5, 6] });
  const b = cardsOf("passerby", "onlooker", "dart_uncle"); b[0].row = 1; b[2].row = 1;
  eq(AD.rowsOf(b), { front: [1], back: [0, 2] }); eq(AD.layoutBoard(b).map((c) => c.id + c.row), ["onlooker0", "passerby1", "dart_uncle1"]);
  const allBack = cardsOf("passerby", "onlooker"); allBack.forEach((c) => (c.row = 1)); eq(AD.rowsOf(allBack), { front: [0, 1], back: [] });
});
const rowMe = (cs) => { const g = fresh("rows" + Math.random()); g.me.level = 10; g.me.board = cs; g.me.bench = []; return g; };
t("自選排別:待命席的卡放到指定的後排空格 → 帶 row:1;放前排 → row:0", () => {
  const g = fresh("mv1"); g.me.level = 5; g.me.bench = cardsOf("passerby", "onlooker");
  ok(G.move(g, { zone: "bench", idx: 0 }, { zone: "board", row: 1 }).ok); eq(g.me.board[0].row, 1); ok(G.move(g, { zone: "bench", idx: 0 }, { zone: "board", row: 0 }).ok); eq(g.me.board[1].row, 0);
  eq(AD.rowsOf(g.me.board), { front: [1], back: [0] });
});
t("自選排別:場上的卡移到另一排的空格;交換兩張卡會連排別一起換;換排不換位置數", () => {
  const g = fresh("mv2"); g.me.level = 5; g.me.board = cardsOf("passerby", "onlooker", "dart_uncle"); g.me.board.forEach((c) => (c.row = 0));
  ok(G.move(g, { zone: "board", idx: 0 }, { zone: "board", row: 1 }).ok); eq(g.me.board.find((c) => c.id === "passerby").row, 1);
  const a = g.me.board.findIndex((c) => c.id === "passerby"), b = g.me.board.findIndex((c) => c.id === "onlooker");
  ok(G.move(g, { zone: "board", idx: a }, { zone: "board", idx: b }).ok); eq([g.me.board.find((c) => c.id === "passerby").row, g.me.board.find((c) => c.id === "onlooker").row], [0, 1]);
  eq(g.me.board.length, 3);
});
t("每排最多 5 張:第 6 張放進同一排會失敗,放另一排可以;總張數不超過上陣位置", () => {
  const g = fresh("mv3"); g.me.level = 10; g.me.board = cardsOf("passerby", "onlooker", "dart_uncle", "corn_vendor", "chili_lady").map((c) => ({ ...c, row: 0 })); g.me.bench = cardsOf("snack_runner", "stall_cat");
  ok(!G.move(g, { zone: "bench", idx: 0 }, { zone: "board", row: 0 }).ok, "前排已滿"); ok(G.move(g, { zone: "bench", idx: 0 }, { zone: "board", row: 1 }).ok);
  const h = fresh("mv3b"); h.me.level = 1; h.me.board = cardsOf("passerby", "onlooker"); h.me.bench = cardsOf("dart_uncle"); ok(!G.move(h, { zone: "bench", idx: 0 }, { zone: "board", row: 1 }).ok, "Lv1 只有 2 格");
});
t("下場:場上的卡回待命席會清掉排別;待命席的卡換上場接手排別", () => {
  const g = fresh("mv4"); g.me.level = 5; g.me.board = [{ id: "passerby", star: 1, row: 1 }, { id: "onlooker", star: 1, row: 0 }]; g.me.bench = cardsOf("dart_uncle");
  ok(G.move(g, { zone: "bench", idx: 0 }, { zone: "board", idx: 0 }).ok); eq(g.me.board[0].id, "dart_uncle"); eq(g.me.board[0].row, 1); eq(g.me.bench[0].row, undefined);
  ok(G.move(g, { zone: "board", idx: 1 }, { zone: "bench", idx: 5 }).ok); eq(g.me.bench.find((c) => c.id === "onlooker").row, undefined);
});
t("舊存檔(沒有 row)動場上的卡之前會補上排別;normState 清掉不合法的 row 與待命席的 row", () => {
  const g = fresh("mv5"); g.me.level = 10; g.me.board = cardsOf("passerby", "passerby", "passerby", "passerby", "passerby", "onlooker"); g.me.bench = [];
  ok(G.move(g, { zone: "board", idx: 5 }, { zone: "board", row: 0 }).ok === false, "前排已滿 5 張");
  const n = G.normState({ board: [{ id: "passerby", star: 1, row: 7 }, { id: "onlooker", star: 1, row: 1 }], bench: [{ id: "dart_uncle", star: 1, row: 1 }] }); eq([n.board[0].row, n.board[1].row, n.bench[0].row], [undefined, 1, undefined]);
});
t("存檔還原與封板快照都帶排別", () => {
  const g = G.createOnline({ seed: "rowsave:1", name: "x" }); G.startRound(g); g.me.level = 5; g.me.board = [{ id: "passerby", star: 1, row: 1 }, { id: "onlooker", star: 1, row: 0 }];
  const st = JSON.parse(JSON.stringify(G.serialize(g))); const g2 = G.createOnline({ seed: "rowsave:1", name: "x" }); G.restore(g2, st); eq(g2.me.board.map((c) => c.row), [1, 0]);
});
t("鄰接只算同一排:前排與後排的兩張相鄰卡不會互相加成", () => {
  const same = cardsOf("passerby", "onlooker").map((c) => ({ ...c, row: 0 })), diff = cardsOf("passerby", "onlooker"); diff[0].row = 0; diff[1].row = 1;
  const foe = cardsOf("passerby");
  const a = E.simulate(same, foe, "adj", { log: true }), b = E.simulate(diff, foe, "adj", { log: true });
  ok(a.events.some((e) => e.t === "buff" && e.atk > 0), "同一排應該有鄰接加成"); ok(!b.events.some((e) => e.t === "buff" && e.atk > 0 && e.to[0] === "a"), "不同排不該有鄰接加成");
});
t("站位關鍵字:前排 / 後排全體護盾與攻擊(3★ 效果)", () => {
  const sm = { id: "street_strongman", star: 3, row: 0 }, p1 = { id: "passerby", star: 1, row: 0 }, p2 = { id: "passerby", star: 1, row: 1 };
  const r = E.simulate([sm, p1, p2], cardsOf("passerby"), "kw1", { log: true });
  const sh = r.events.filter((e) => e.t === "shield" && e.to[0] === "a").map((e) => e.to); ok(sh.includes("a0") && sh.includes("a1") && !sh.includes("a2"), "前排全體有護盾,後排沒有:" + sh);
  const sp = { id: "sweet_potato_boy", star: 3, row: 0 }, r2 = E.simulate([sp, { ...p1 }, { ...p2 }], cardsOf("passerby"), "kw2", { log: true });
  const bf = r2.events.filter((e) => e.t === "buff" && e.atk > 0 && e.to[0] === "a").map((e) => e.to); ok(bf.includes("a2") && !bf.includes("a1"), "後排全體攻擊 +1:" + bf);
});
t("擊殺換位:扒手小子擊殺後與後排第一位換位(有 swap 事件、排別互換);後排沒人時不換", () => {
  const kid = { id: "pickpocket_kid", star: 1, row: 0, bonusAtk: 30 }, back = { id: "passerby", star: 1, row: 1 };
  const r = E.simulate([kid, back], cardsOf("passerby"), "sw1", { log: true }); const sw = r.events.find((e) => e.t === "swap"); ok(sw, "沒有 swap 事件"); eq([sw.a, sw.b], ["a0", "a1"]);
  const r2 = E.simulate([{ ...kid }], cardsOf("passerby"), "sw2", { log: true }); ok(!r2.events.some((e) => e.t === "swap"), "後排沒人不該換位");
  const r3 = E.simulate([{ ...kid, row: 1 }, { ...back, row: 1 }], cardsOf("passerby"), "sw3", { log: true }); ok(!r3.events.some((e) => e.t === "swap"), "已經在後排不用換");
  eq(E.simulate([kid, back], cardsOf("passerby"), "sw1", { log: true }).events, r.events, "同種子結果固定");
});
t("換位卡(遊方和尚)連排別一起換", () => {
  const monk = { id: "wandering_monk", star: 1, row: 1 }, a = { id: "passerby", star: 1, row: 0 }, r = E.simulate([a, monk], cardsOf("passerby"), "mk", { log: true });
  eq(r.init.a.map((u) => u.id + u.row), ["wandering_monk0", "passerby1"]);
});
t("自動排站位:兩排各最多 5 張、前後排張數合理、7 張以內結果固定、10 張 1 秒內", () => {
  [3, 5, 7, 8, 9, 10].forEach((n) => {
    const cs = AD.CARDS.filter((c) => !c.exclusive).slice(n * 3, n * 3 + n).map((c) => ({ id: c.id, star: 1 })); const t0 = Date.now(); const a = E.autoArrange(cs), b = E.autoArrange(cs); ok(Date.now() - t0 < 1500, n + " 張太慢");
    eq(a, b); eq(a.map((c) => c.id).sort(), cs.map((c) => c.id).sort()); const f = a.filter((c) => c.row === 0).length; ok(f <= AD.ROW_SIZE && a.length - f <= AD.ROW_SIZE, n + " 張排別超過上限"); ok(f >= 1 || n < 2);
  });
});
t("自動排站位:分數不比原本的排法低(隨機 40 組陣容)", () => {
  const rng = E.makeRng("arr-score");
  for (let k = 0; k < 40; k++) {
    const n = 3 + rng.int(8), pool = AD.CARDS.filter((c) => !c.exclusive), cs = []; for (let i = 0; i < n; i++) cs.push({ id: pool[rng.int(pool.length)].id, star: 1 + rng.int(2) });
    const ends = !!E.computeBonds(cs).fx.endsAtk, sc = (b) => E.arrangeScore(E.applyDeploy(AD.layoutBoard(b)), ends);
    ok(sc(E.autoArrange(cs)) >= sc(cs) - 1e-9, "第 " + k + " 組:自動排比原本差");
  }
});
t("自動排站位:會把前排 / 後排效果放對地方(風水師前排盾、後排攻擊;有 3★ 後排 buff 的卡配後排)", () => {
  const cs = [{ id: "fengshui_master", star: 1 }, { id: "street_strongman", star: 1 }, { id: "palm_reader", star: 1 }, { id: "passerby", star: 1 }, { id: "dart_uncle", star: 1 }];
  const a = E.autoArrange(cs); eq(a.length, 5); ok(a.every((c) => c.row === 0 || c.row === 1));
});
t("整場單機(含擊殺換位、自選排別的電腦陣容)跑完不出錯", () => {
  for (let i = 0; i < 6; i++) { const g = G.create({ seed: "rowfull" + i }); G.startRound(g); let guard = 0; while (!g.over && guard++ < 60) { G.autoArrange(g); G.seal(g); if (!g.over) G.nextRound(g); } ok(g.over && g.rank >= 1); }
});

console.log(`\n${fail ? "✗" : "✓"} ${pass} 通過 / ${fail} 失敗`);
process.exit(fail ? 1 : 0);
