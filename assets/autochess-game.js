// 夜市自走棋 · 單機遊戲流程(階段 2:練習模式用)
//
// 純邏輯,不碰 DOM、不碰資料庫:一位真人玩家(me)+ 7 位電腦玩家(同模擬器的 AI)組成 8 人場。
// 畫面(autochess.js)只負責呼叫這裡的函式並把結果畫出來,所以整個流程可以在 Node 直接測試。
// 所有隨機都走種子(同一個 seed 的整場對局完全可重現);不使用 Math.random / Date.now。
//
// 流程:create → startRound(準備階段)→ buy/sell/move/buyXp/refresh/toggleLock/undo/pickPerk … → seal(封板、全場配對戰鬥結算,回傳 report)
//       → 畫面演出 report → nextRound → … 直到 g.over。
window.AutochessGame = (function () {
  const AD = window.AutochessData, E = window.AutochessEngine, Bot = window.AutochessBot;
  const BOT_NAMES = ["阿旺嬸", "夜市常客", "烤魷魚阿伯", "剉冰妹", "路過的大叔", "遊戲攤老闆", "把式阿嬤"];
  const TAG_KEYS = Object.keys(AD.TAGS);
  const copy = (c) => ({ ...c });

  function create(opts) {
    opts = opts || {};
    const seed = String(opts.seed != null ? opts.seed : "practice");
    const me = Bot.newPlayer("me", { name: "玩家", focus: null, reserve: 0 });
    Object.assign(me, {
      name: opts.name || "你", human: true, shop: [], shopLocked: false, refreshCount: 0, freeFirstUsed: false, roundOpts: {}, undo: null,
      perks: { freeRefresh: 0, goodRapport: 0, xpCoupon: 0, expandRounds: 0, preorder: null, regular: false, stallPlus: 0, tagAssist: {}, streakGuard: false, drop: null },
      perkPicks: [], pendingPerk: null, bestStreak: 0, threeStar: 0, store: [], roundFx: { atk: 0, hp: 0 },
    });
    const bots = BOT_NAMES.slice(0, (opts.players || 8) - 1).map((n, i) => {
      const b = Bot.newPlayer("b" + i, { name: "正常", focus: i % 3 === 2 ? null : TAG_KEYS[i % TAG_KEYS.length], reserve: 0 });
      b.name = n; b.human = false; return b;
    });
    return { seed, evSeed: "ev" + seed, round: 0, phase: "idle", me, bots, players: [me].concat(bots), over: false, rank: null, report: null, timer: opts.timer !== false, autoFill: opts.autoFill !== false, dataVersion: AD.DATA_VERSION, nightEvents: opts.nightEvents !== false, eventSeed: opts.eventSeed != null ? String(opts.eventSeed) : "ne" + seed };
  }

  const slotsOf = (me) => AD.slotsFor(me.level) + me.perks.stallPlus;
  const prepSeconds = (round) => AD.prepSeconds(round);
  const capacityOf = (me) => slotsOf(me) + AD.BENCH_SLOTS;
  const cardsOf = (me) => me.board.concat(me.bench);
  const fail = (msg) => ({ ok: false, msg });
  const okr = (extra) => Object.assign({ ok: true }, extra || {});

  // ---------------- 商店 ----------------
  // ---------------- 夜市事件 / 雜貨攤(企劃 11-2)----------------
  // 這一輪的事件 id(沒有或沒開事件就是 null)。純粹由「事件種子 + 輪次」決定,不存進存檔
  const eventIdOf = (g, round) => { if (!g.nightEvents) return null; const e = E.nightEvent(g.eventSeed, round == null ? g.round : round); return e ? e.id : null; };
  // 買卡實際要付的銅板(打烊特賣 −1,最低 1);賣出價也少 1(不然「特價買、原價賣」就能賺錢)
  const costOf = (g, id) => { const c = AD.CARD_BY_ID[id].cost; return eventIdOf(g) === "sale" ? Math.max(1, c - 1) : c; };
  const sellValueOf = (g, card) => { const v = AD.sellValue(AD.CARD_BY_ID[card.id], card.star); return eventIdOf(g) === "sale" ? Math.max(0, v - 1) : v; };
  // 戰鬥用的陣容:疊上「本輪才有」的加成(雜貨攤的辣椒粉 / 糖葫蘆、夜市事件的流派加減),不動玩家真正的卡。攻擊最低保留 1
  function fightBoard(S, board, evId) {
    const fx = (S && S.roundFx) || {}, ev = evId && AD.NIGHT_EVENT_BY_ID[evId], tagMod = (ev && ev.tags) || null;
    return board.map((c) => {
      const n = copy(c); let da = fx.atk || 0; const dh = fx.hp || 0;
      const def = AD.CARD_BY_ID[c.id];
      if (tagMod && def) def.tags.forEach((t) => { if (tagMod[t]) da += tagMod[t]; });
      if (da) { const base = Math.round(def.atk * AD.STAR.stat[c.star || 1]); n.bonusAtk = Math.max(1 - base, (c.bonusAtk || 0) + da); }
      if (dh) n.bonusHp = (c.bonusHp || 0) + dh;
      return n;
    });
  }
  function rollStore(g) {
    const rng = E.makeRng(`${g.evSeed}|me|store|${g.round}`);
    return rng.shuffle(AD.STORE_ITEMS.map((i) => i.id)).slice(0, AD.STORE_SLOTS);
  }
  const storeTargets = (g) => { const out = []; g.me.board.forEach((c, i) => out.push({ zone: "board", idx: i, card: c })); g.me.bench.forEach((c, i) => out.push({ zone: "bench", idx: i, card: c })); return out; };
  function buyStore(g, i, target) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    const id = (me.store || [])[i];
    if (!id) return fail("這件已經賣完了");
    const it = AD.STORE_BY_ID[id];
    if (me.gold < it.price) return fail("銅板不夠");
    if (it.target === "card") {
      const arr = target && (target.zone === "board" ? me.board : me.bench), c = arr && arr[target.idx];
      if (!c) return fail("請先選擇一張卡");
      c.bonusAtk = (c.bonusAtk || 0) + it.atk; c.bonusHp = (c.bonusHp || 0) + it.hp;
    } else {
      if (it.fx.atk) me.roundFx.atk += it.fx.atk;
      if (it.fx.hp) me.roundFx.hp += it.fx.hp;
      if (it.fx.freeRefresh) me.perks.freeRefresh += it.fx.freeRefresh;
    }
    me.gold -= it.price; me.store[i] = null; me.undo = null;
    return okr({ item: it });
  }

  // 場上 + 待命席已經是滿級(3★)的卡 id:這些卡不會再出現在商店(企劃 11-8);賣掉之後下一次抽商店又會出現
  const maxedIds = (cards) => { const out = []; (cards || []).forEach((c) => { if (c && c.star >= AD.STAR.max && out.indexOf(c.id) < 0) out.push(c.id); }); return out; };
  function rollShopFor(g) {
    const me = g.me;
    return E.rollShop(`${g.evSeed}|me`, g.round, me.refreshCount, me.level, Object.assign({}, me.roundOpts, { exclude: maxedIds(cardsOf(me)) }));
  }
  // 商店卡片的「已擁有」標示用:n = 場上 + 待命席同名卡的張數(不分星級);up = 現在買下去會合成到幾星(0 = 不會合成)
  // 合成會連鎖(例如有 2 張 1★ 與 2 張 2★,買 1 張 1★ 會一路合成到 3★),所以直接用引擎的合成模擬一次,不另外寫規則
  function ownedInfo(me, id) {
    const have = cardsOf(me).filter((c) => c.id === id);
    if (!have.length) return { n: 0, up: 0 };
    const m = E.mergeCards(me.board, me.bench.concat([{ id, star: 1 }]));
    const up = m.merged.filter((x) => x.id === id).reduce((mx, x) => Math.max(mx, x.star), 0);
    return { n: have.length, up };
  }

  // ---------------- 怪物輪 ----------------
  // 怪物輪掉落:結算時只把卡片 id 記在 perks.drop(連線版結算只收 gold / streak / perks 這幾個欄位),
  // 下一輪準備階段開始時才真的進待命席(能合成就合成;格子滿了就直接折成銅板)。
  function giveDrop(me) {
    const id = me.perks && me.perks.drop;
    if (!id) return null;
    me.perks.drop = null;
    const card = AD.CARD_BY_ID[id]; if (!card) return null;
    const m = E.mergeCards(me.board, me.bench.concat([{ id, star: 1 }]));
    if (m.bench.length > AD.BENCH_SLOTS) { me.gold += AD.sellValue(card, 1); return { id, sold: true }; }
    me.board = m.board; me.bench = m.bench; m.merged.forEach((x) => { if (x.star === 3) me.threeStar = (me.threeStar || 0) + 1; });
    return { id, sold: false };
  }
  // 一個人打怪物:回傳結果(單機與連線版共用)。res 是真實勝負(win / lose / draw);結算一律按「平手」算
  // (基本收入 + 利息,不扣血、連勝不變、不計勝敗場),贏了另加 MONSTER_WIN_COINS 銅板與一張掉落卡。
  // mon = 這一輪的怪物(AD.monsterFor(種子, 輪次));沒傳就用預設怪物。贏了掉該怪物的專屬卡,已經有它的 3★ 才改掉一般隨機卡
  function monsterFight(round, S, board, key, wantLog, mon) {
    mon = mon || AD.monsterFor(null, round);
    const r = E.simulate(fightBoard(S, board, null), AD.monsterBoard(round, mon), `${key}|mon`, { log: !!wantLog, extraA: extraFor(S), extraB: null });
    const res = r.winner === "a" ? "win" : r.winner === "b" ? "lose" : "draw";
    const eco = E.settleEconomy({ result: "draw", round, gold: S.gold, streak: S.streak, level: S.level, bonusCoins: r.bonusCoinsA || 0 });
    let drop = null;
    if (res === "win") {
      eco.gold += AD.MONSTER_WIN_COINS; eco.gain += AD.MONSTER_WIN_COINS; eco.monsterCoins = AD.MONSTER_WIN_COINS;
      const owned = maxedIds((S.board || []).concat(S.bench || []));
      if (mon && mon.drop && AD.CARD_BY_ID[mon.drop] && owned.indexOf(mon.drop) < 0) drop = mon.drop;
      else { const shop = E.rollShop(`drop|${key}`, round, 7, S.level, { exclude: owned }).filter(Boolean); drop = shop.length ? shop[0] : null; }
    }
    return { r, res, eco, drop };
  }

  // ---------------- 回合開始(準備階段)----------------
  function startRound(g) {
    g.round++; g.phase = "prep"; g.report = null;
    const me = g.me;
    if (g.round > 1) { const r = AD.addXp(me.level, me.xp, AD.PASSIVE_XP); me.level = r.level; me.xp = r.xp; }
    giveDrop(me); // 上一輪怪物輪的掉落卡
    const evId = eventIdOf(g);
    g.bots.filter((b) => b.alive).forEach((b) => Bot.playPrep(b, g.round, g.evSeed, evId)); // 電腦玩家的被動 XP 在 playPrep 裡面算
    // 本輪商店選項(攤位加碼的持續效果在這裡結算一次)
    const p = me.perks;
    me.roundOpts = {};
    me.roundFx = { atk: 0, hp: 0 }; me.store = rollStore(g); // 雜貨攤每輪重進貨;辣椒粉 / 糖葫蘆只管一輪
    if (evId === "crowd") me.roundOpts.extraSlots = 1; // 夜市事件:人潮
    if (p.expandRounds > 0) { me.roundOpts.extraSlots = (me.roundOpts.extraSlots || 0) + 1; p.expandRounds--; }
    if (p.preorder && p.preorder.rounds > 0) { me.roundOpts.tagBoost = { tag: p.preorder.tag, mult: AD.PERK_BY_ID.preorder.mult }; p.preorder.rounds--; if (!p.preorder.rounds) p.preorder = null; }
    if (p.regular) { me.roundOpts.guaranteeEpic = true; p.regular = false; }
    me.refreshCount = 0; me.freeFirstUsed = false; me.undo = null;
    if (me.shopLocked) me.shopLocked = false; // 鎖定只保留到下一輪:商店原封不動(買走的格子留空),不免費刷新
    else me.shop = rollShopFor(g);
    me.pendingPerk = null;
    const pi = AD.PERK_ROUNDS.indexOf(g.round);
    if (pi >= 0) me.pendingPerk = { n: pi + 1, candidates: genCandidates(g, pi + 1) };
    else if (evId === "extra_pick") me.pendingPerk = { n: 100 + g.round, extra: true, candidates: genCandidates(g, 100 + g.round) }; // 夜市事件:加碼回合(onlyPick 的強力選項不會出現)
    return okr();
  }

  // ---------------- 攤位加碼 ----------------
  function targetsFor(g, perkId) {
    const me = g.me, pk = AD.PERK_BY_ID[perkId];
    if (!pk || !pk.target) return [];
    if (pk.target === "tag") return TAG_KEYS.map((t) => ({ tag: t }));
    const out = [];
    me.board.forEach((c, i) => out.push({ zone: "board", idx: i, card: c }));
    me.bench.forEach((c, i) => out.push({ zone: "bench", idx: i, card: c }));
    if (perkId === "free_star") return out.filter((x) => x.card.star === 1 && AD.CARD_BY_ID[x.card.id].cost <= 2);
    return out;
  }
  function genCandidates(g, n) {
    const rng = E.makeRng(`${g.evSeed}|me|perk|${n}`);
    const avail = {};
    AD.PERKS.forEach((pk) => {
      if (pk.onlyPick && pk.onlyPick !== n) return;
      if (pk.target && !targetsFor(g, pk.id).length) return;
      (avail[pk.cat] = avail[pk.cat] || []).push(pk.id);
    });
    const cats = rng.shuffle(Object.keys(AD.PERK_CATS).filter((c) => avail[c] && avail[c].length)).slice(0, 3);
    return cats.map((c) => rng.pick(avail[c]));
  }
  function pickPerk(g, perkId, target) {
    const me = g.me, pp = me.pendingPerk;
    if (g.phase !== "prep" || !pp) return fail("現在沒有可以選的加碼");
    if (!pp.candidates.includes(perkId)) return fail("這張不在候選裡");
    const pk = AD.PERK_BY_ID[perkId], p = me.perks;
    if (pk.target && !target) return fail("請先選擇對象");
    switch (perkId) {
      case "free_refresh": p.freeRefresh += pk.n; break;
      case "petty_cash": me.gold += pk.n; break;
      case "good_rapport": p.goodRapport = pk.rounds; break;
      case "regular": p.regular = true; break;
      case "preorder": p.preorder = { tag: target.tag, rounds: pk.rounds }; break;
      case "expand": p.expandRounds = pk.rounds; break;
      case "xp_coupon": p.xpCoupon += pk.n; break;
      case "tutoring": { const r = AD.addXp(me.level, me.xp, pk.n); me.level = r.level; me.xp = r.xp; break; }
      case "stall_plus": p.stallPlus += 1; break;
      case "free_star": { const arr = target.zone === "board" ? me.board : me.bench; const c = arr[target.idx]; if (!c || c.star !== 1) return fail("對象不合法"); c.star = 2; mergeAll(me); break; }
      case "seasoning": { const arr = target.zone === "board" ? me.board : me.bench; const c = arr[target.idx]; if (!c) return fail("對象不合法"); c.bonusAtk = (c.bonusAtk || 0) + pk.atk; c.bonusHp = (c.bonusHp || 0) + pk.hp; break; }
      case "tag_assist": p.tagAssist[target.tag] = (p.tagAssist[target.tag] || 0) + 1; break;
      case "streak_guard": p.streakGuard = true; break;
    }
    me.perkPicks.push(perkId); me.pendingPerk = null; me.undo = null;
    return okr({ perk: pk });
  }
  // 封板前沒選 → 系統隨機替選一張(對象取第一個合法的)
  function autoPickPerk(g) {
    const pp = g.me.pendingPerk;
    if (!pp) return null;
    const rng = E.makeRng(`${g.evSeed}|me|autopick|${pp.n}`);
    const id = rng.pick(pp.candidates), t = targetsFor(g, id);
    const r = pickPerk(g, id, t.length ? rng.pick(t) : null);
    return r.ok ? AD.PERK_BY_ID[id] : null;
  }

  // ---------------- 合成 ----------------
  function mergeAll(me) {
    const m = E.mergeCards(me.board, me.bench);
    me.board = m.board; me.bench = m.bench;
    m.merged.forEach((x) => { if (x.star === 3) me.threeStar++; });
    return m.merged;
  }

  // ---------------- 準備階段操作 ----------------
  function snapshot(me) { return { gold: me.gold, board: me.board.map(copy), bench: me.bench.map(copy), shop: me.shop.slice(), threeStar: me.threeStar }; }
  function buy(g, i) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    const id = me.shop[i];
    if (!id) return fail("這格已經空了");
    const cost = costOf(g, id);
    if (me.gold < cost) return fail("銅板不夠");
    const snap = snapshot(me);
    me.bench.push({ id, star: 1 });
    const merged = mergeAll(me);
    if (me.bench.length > AD.BENCH_SLOTS) { me.board = snap.board; me.bench = snap.bench; me.threeStar = snap.threeStar; return fail("待命席已滿,先賣掉或上陣一張"); }
    me.gold -= cost; me.shop[i] = null; me.undo = snap;
    return okr({ merged, cost });
  }
  // 撤銷上一次購買(同一輪、還沒刷新前),全額退費
  function undo(g) {
    const me = g.me;
    if (g.phase !== "prep" || !me.undo) return fail("沒有可以撤銷的購買");
    Object.assign(me, { gold: me.undo.gold, board: me.undo.board, bench: me.undo.bench, shop: me.undo.shop, threeStar: me.undo.threeStar });
    me.undo = null; return okr();
  }
  function sell(g, zone, idx) {
    const me = g.me, arr = zone === "board" ? me.board : me.bench, c = arr[idx];
    if (g.phase !== "prep" || !c) return fail("找不到這張卡");
    const v = sellValueOf(g, c);
    arr.splice(idx, 1); me.gold += v; me.undo = null;
    return okr({ value: v });
  }
  // 移動:from / to = { zone: 'board'|'bench', idx }。目標有卡 → 交換;目標是空位 → 放到該區最後
  // 自動排站位:只重排上陣的卡(不動待命席、不花銅板);已經是最佳排法就回報沒有變動
  function autoArrange(g) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    if (me.board.length < 2) return fail("上陣的卡不到 2 張,不需要排站位");
    normalizeRows(me); const next = E.autoArrange(me.board);
    const changed = next.some((c, i) => c.id !== me.board[i].id || c.star !== me.board[i].star || c.row !== me.board[i].row);
    me.board = next;
    return okr({ changed });
  }
  // ---- 前排 / 後排(階段 11)----
  // 場上每張卡的排別 row(0 前排 / 1 後排);舊存檔沒有 row 的卡照位置補上(前 ROW_SIZE 張前排)。動場上的卡之前先呼叫
  const normalizeRows = (me) => { me.board.forEach((c, i) => { c.row = AD.rowOfCard(c, i); }); };
  const rowCount = (board, row) => board.filter((c, i) => AD.rowOfCard(c, i) === row).length;
  // 新上陣的卡預設排別:前排還沒滿就放前排,滿了放後排
  const defaultRow = (board) => (rowCount(board, 0) < AD.ROW_SIZE ? 0 : 1);
  // to = { zone, idx?, row? }:idx 指到有卡的格子 = 交換;沒有 idx(或超出張數)= 放到空格,board 的空格要帶 row(0 / 1),沒帶就用預設排別
  function move(g, from, to) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    const src = from.zone === "board" ? me.board : me.bench, dst = to.zone === "board" ? me.board : me.bench;
    const c = src[from.idx];
    if (!c) return fail("找不到這張卡");
    const occupied = to.idx != null && to.idx < dst.length;
    if (from.zone === "board" || to.zone === "board") normalizeRows(me);
    if (from.zone === to.zone) {
      if (from.zone === "bench") { // 待命席內:交換 / 移到最後(跟以前一樣)
        if (occupied) { if (to.idx !== from.idx) { const t = dst[to.idx]; dst[to.idx] = c; dst[from.idx] = t; } } else { src.splice(from.idx, 1); src.push(c); }
        return okr();
      }
      if (occupied) { // 場上交換:位置與排別一起換
        if (to.idx !== from.idx) { const t = dst[to.idx]; dst[to.idx] = c; dst[from.idx] = t; const r = c.row; c.row = t.row; t.row = r; }
        return okr();
      }
      const row = to.row === 0 || to.row === 1 ? to.row : c.row; // 移到某一排最後面
      if (row !== c.row && rowCount(me.board, row) >= AD.ROW_SIZE) return fail("這一排已滿(每排最多 " + AD.ROW_SIZE + " 張)");
      src.splice(from.idx, 1); c.row = row; src.push(c);
      return okr();
    }
    if (to.zone === "board") { // 待命席 → 場上
      if (occupied) { const t = dst[to.idx]; c.row = t.row; dst[to.idx] = c; src[from.idx] = t; delete t.row; return okr(); } // 跨區交換:上場的卡接手那個位置與排別
      if (dst.length >= slotsOf(me)) return fail("上陣位置已滿,點一張場上的卡交換");
      const row = to.row === 0 || to.row === 1 ? to.row : defaultRow(me.board);
      if (rowCount(me.board, row) >= AD.ROW_SIZE) return fail("這一排已滿(每排最多 " + AD.ROW_SIZE + " 張)");
      src.splice(from.idx, 1); c.row = row; dst.push(c);
      return okr();
    }
    // 場上 → 待命席
    if (occupied) { const t = dst[to.idx]; t.row = c.row; src[from.idx] = t; dst[to.idx] = c; delete c.row; return okr(); }
    if (dst.length >= AD.BENCH_SLOTS) return fail("待命席已滿");
    src.splice(from.idx, 1); delete c.row; dst.push(c);
    return okr();
  }
  function buyXp(g) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    if (me.level >= AD.MAX_LEVEL) return fail("已經是最高等級");
    const disc = me.perks.xpCoupon > 0 ? AD.PERK_BY_ID.xp_coupon.off : 0, cost = Math.max(0, AD.BUY_XP.cost - disc);
    if (me.gold < cost) return fail("銅板不夠");
    me.gold -= cost; if (disc) me.perks.xpCoupon--;
    const r = AD.addXp(me.level, me.xp, AD.BUY_XP.xp); me.level = r.level; me.xp = r.xp;
    return okr({ cost });
  }
  function refreshCost(me) {
    if (me.level >= AD.LEVEL_PERKS.freeFirstRefresh && !me.freeFirstUsed) return 0;
    if (me.perks.freeRefresh > 0) return 0;
    return 1;
  }
  function refresh(g) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    const cost = refreshCost(me);
    if (me.gold < cost) return fail("銅板不夠");
    if (cost === 0) { if (me.level >= AD.LEVEL_PERKS.freeFirstRefresh && !me.freeFirstUsed) me.freeFirstUsed = true; else me.perks.freeRefresh--; }
    me.gold -= cost; me.refreshCount++; me.shop = rollShopFor(g); me.undo = null;
    return okr({ cost });
  }
  function toggleLock(g) { if (g.phase !== "prep") return fail("現在不是準備階段"); g.me.shopLocked = !g.me.shopLocked; return okr({ locked: g.me.shopLocked }); }

  // ---------------- 羈絆 / 預覽 ----------------
  function extraFor(p) {
    const ta = p.perks && p.perks.tagAssist;
    if (!ta) return null;
    const counts = E.countTags(p.board), out = {};
    Object.keys(ta).forEach((t) => { if ((counts[t] || 0) + ta[t] <= AD.PERK_BY_ID.tag_assist.cap) out[t] = ta[t]; });
    return Object.keys(out).length ? out : null;
  }
  function bondsPreview(g) { return E.computeBonds(g.me.board, extraFor(g.me)); }

  // ---------------- 一輪:配對、戰鬥、結算 ----------------
  function roundCore(g, mineLog) {
    const round = g.round, rng = E.makeRng(`g|${g.evSeed}|${round}`), evId = eventIdOf(g);
    const live = g.players.filter((p) => p.alive);
    const snap = {}, fbd = {}; live.forEach((p) => { snap[p.id] = p.board.map(copy); fbd[p.id] = fightBoard(p, snap[p.id], evId); }); // snap = 畫面顯示用的原樣陣容;fbd = 實際戰鬥用(疊上本輪加成)
    if (AD.isMonsterRound(round)) { // 怪物輪:每個人各打一次同一隻怪物,不配對、不扣血、不計勝敗與連勝
      return live.map((p) => {
        const mon = AD.monsterFor(g.eventSeed, round), f = monsterFight(round, p, snap[p.id], `${g.evSeed}|${round}|${p.id}`, !!mineLog && !!p.human, mon);
        const o = { p, foe: { name: mon.name }, monster: true, ghost: false, side: "a", r: f.r, res: f.res, dmg: 0, coins: f.r.bonusCoinsA, board: snap[p.id], foeBoard: AD.monsterBoard(round, mon), eco: f.eco, hpBefore: p.hp, goldBefore: p.gold, drop: f.drop, pve: true };
        p.gold = f.eco.gold; // 連勝、血量、勝敗場都不動
        if (f.drop) { if (p.human) p.perks.drop = f.drop; else p.gold += AD.CARD_BY_ID[f.drop].cost; } // 電腦玩家沒有待命席掉落,折成銅板
        return o;
      });
    }
    const order = rng.shuffle(live), pairs = [];
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1], false]);
    if (order.length % 2) { const lone = order[order.length - 1]; pairs.push([lone, rng.pick(live.filter((x) => x !== lone)), true]); }
    const outcomes = [];
    pairs.forEach(([a, b, ghost], k) => {
      const isMine = mineLog && (a.human || (b.human && !ghost));
      const r = E.simulate(fbd[a.id], fbd[b.id], `${g.evSeed}|${round}|${k}`, { log: !!isMine, extraA: a.human ? extraFor(a) : null, extraB: b.human && !ghost ? extraFor(b) : null });
      const oa = { p: a, foe: b, ghost, side: "a", r, res: r.winner === "a" ? "win" : r.winner === "b" ? "lose" : "draw", dmg: r.winner === "b" ? E.loseDamage(round, r.starsB, evId) : 0, coins: r.bonusCoinsA, board: snap[a.id], foeBoard: snap[b.id] };
      outcomes.push(oa);
      if (!ghost) outcomes.push({ p: b, foe: a, ghost: false, side: "b", r, res: r.winner === "b" ? "win" : r.winner === "a" ? "lose" : "draw", dmg: r.winner === "a" ? E.loseDamage(round, r.starsA, evId) : 0, coins: r.bonusCoinsB, board: snap[b.id], foeBoard: snap[a.id] });
    });
    outcomes.forEach((o) => {
      const p = o.p;
      const rapport = p.human && p.perks.goodRapport > 0 ? AD.PERK_BY_ID.good_rapport.n : 0;
      const prevStreak = p.streak;
      const s = E.settleEconomy({ result: o.res, round, gold: p.gold, streak: p.streak, level: p.level, bonusCoins: (o.coins || 0) + rapport, event: evId });
      o.eco = s; o.hpBefore = p.hp; o.goldBefore = p.gold;
      if (p.human && o.res === "lose" && p.perks.streakGuard) { s.streak = prevStreak; p.perks.streakGuard = false; o.insured = true; }
      if (rapport) p.perks.goodRapport--;
      p.gold = s.gold; p.streak = s.streak;
      if (o.res === "win") p.wins++; else if (o.res === "lose") p.losses++;
      if (p.human) p.bestStreak = Math.max(p.bestStreak, p.streak);
      p.hp -= o.dmg;
    });
    outcomes.forEach((o) => { if (o.p.hp <= 0 && o.p.alive) { o.p.alive = false; o.p.elimRound = round; o.p.overflow = -o.p.hp; o.eliminated = true; } });
    return outcomes;
  }
  function ranking(g) {
    return g.players.slice().sort((x, y) => (y.alive - x.alive) || (y.elimRound - x.elimRound) || (x.overflow - y.overflow) || (y.wins - x.wins));
  }
  // 封板前的收尾:沒選的加碼系統替選、上陣位置沒滿就把待命席最強的補上去(單機與連線版共用)
  function sealPrep(g) {
    const me = g.me;
    const autoPicked = autoPickPerk(g);
    let filled = 0;
    if (g.autoFill) {
      while (me.board.length < slotsOf(me) && me.bench.length) {
        const pw = (c) => (AD.CARD_BY_ID[c.id].atk * 3 + AD.CARD_BY_ID[c.id].hp) * AD.STAR.stat[c.star];
        let bi = 0; me.bench.forEach((c, i) => { if (pw(c) > pw(me.bench[bi])) bi = i; });
        normalizeRows(me); const c = me.bench.splice(bi, 1)[0]; c.row = defaultRow(me.board); me.board.push(c); filled++;
      }
    }
    me.undo = null;
    return { autoPicked, filled };
  }
  // 封板:自動補位 → 全場配對戰鬥結算 → 回傳 report(畫面拿去演出)
  function seal(g) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    const { autoPicked, filled } = sealPrep(g);
    const outcomes = roundCore(g, true);
    const mine = outcomes.find((o) => o.p === me);
    g.phase = "result";
    const aliveCount = g.players.filter((p) => p.alive).length;
    if (!me.alive || aliveCount <= 1) finish(g);
    g.report = { round: g.round, mine, outcomes, autoPicked, filled, over: g.over, event: eventIdOf(g) };
    return okr({ report: g.report });
  }
  // 玩家淘汰或全場剩 1 人:快轉到結束算出名次
  function finish(g) {
    let guard = 0;
    while (g.players.filter((p) => p.alive).length > 1 && guard++ < 40) {
      g.round++;
      g.bots.filter((b) => b.alive).forEach((b) => Bot.playPrep(b, g.round, g.evSeed, eventIdOf(g)));
      roundCore(g, false);
    }
    g.over = true;
    const rk = ranking(g);
    g.rank = rk.indexOf(g.me) + 1;
    g.finalRanking = rk.map((p, i) => ({ name: p.name, human: !!p.human, hp: Math.max(0, p.hp), elimRound: p.elimRound, wins: p.wins, rank: i + 1, bestStreak: p.bestStreak || 0, board: (p.board || []).map((c) => ({ id: c.id, star: c.star })), bench: (p.bench || []).map((c) => ({ id: c.id, star: c.star })) }));
  }
  function nextRound(g) {
    if (g.over) return fail("對局已經結束");
    if (g.phase !== "result") return fail("還沒封板");
    return startRound(g);
  }
  function stats(g) { const me = g.me; return { rank: g.rank, wins: me.wins, losses: me.losses, bestStreak: me.bestStreak, level: me.level, threeStar: me.threeStar, rounds: me.alive ? g.round : me.elimRound, perks: me.perkPicks.slice() }; }

  // ================= 多人(正式場)用的純函式 =================
  // 單機版整局狀態在記憶體裡;連線版的「事實」存在資料庫(autochess_players.state),這裡負責:
  //   存檔序列化 / 還原 / 補跑錯過的輪次 / 用「雙方封板快照 + 種子」算出決定性的戰鬥與結算(誰算都一樣)。
  const STATE_KEYS = ["gold", "level", "xp", "streak", "board", "bench", "shop", "shopLocked", "refreshCount", "freeFirstUsed", "roundOpts", "perks", "perkPicks", "pendingPerk", "bestStreak", "threeStar", "store", "roundFx"];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const newPerks = () => ({ freeRefresh: 0, goodRapport: 0, xpCoupon: 0, expandRounds: 0, preorder: null, regular: false, stallPlus: 0, tagAssist: {}, streakGuard: false, drop: null });

  // 統計用(稱號):陣容裡同一流派的卡張數(同名重複也算,最多的那個流派);首尾是否各有先鋒/壓軸效果
  function monoCount(board) {
    const n = {}; let best = 0;
    board.forEach((c) => (AD.CARD_BY_ID[c.id].tags || []).forEach((t) => { n[t] = (n[t] || 0) + 1; if (n[t] > best) best = n[t]; }));
    return best;
  }
  function bookendOf(board) {
    if (board.length < 2) return false;
    const has = (c, when) => { const d = AD.CARD_BY_ID[c.id]; return d.fx.concat(c.star >= 3 && d.star3 ? d.star3.fx : []).some((e) => e.when === when); };
    return has(board[0], "vanguard") && has(board[board.length - 1], "finale");
  }
  function createOnline(opts) {
    const g = create({ seed: opts.seed, name: opts.name, players: 1, nightEvents: !!opts.nightEvents, eventSeed: opts.eventSeed }); // 1 人 = 沒有電腦玩家;夜市事件要活動有開才有
    g.online = true; g.round = 0; g.phase = "prep";
    return g;
  }
  // 要寫進資料庫的狀態(不含血量與勝敗:那些是伺服器欄位;不含 undo:重新整理後撤銷就失效,可接受)
  function serialize(g) {
    const me = g.me, st = {};
    STATE_KEYS.forEach((k) => { st[k] = me[k] === undefined ? null : clone(me[k]); });
    st.stateRound = g.round; st.name = me.name;
    return st;
  }
  // 把資料庫裡的狀態套回 g(沒有的欄位保留開局預設;空物件 = 還沒初始化)
  function restore(g, state, row) {
    const me = g.me; state = state || {};
    STATE_KEYS.forEach((k) => { if (state[k] !== undefined && state[k] !== null) me[k] = clone(state[k]); });
    if (!state.pendingPerk) me.pendingPerk = null;
    me.perks = Object.assign(newPerks(), me.perks);
    if (!Array.isArray(me.store)) me.store = []; if (!me.roundFx) me.roundFx = { atk: 0, hp: 0 };
    me.undo = null; me.phase = null;
    g.round = state.stateRound || 0; g.phase = "prep"; g.report = null;
    if (row) { me.hp = row.hp; me.wins = row.wins; me.losses = row.losses; me.alive = row.alive; if (row.players && row.players.name) me.name = row.players.name; }
    return g;
  }
  // 錯過的輪次(離線、斷線、晚進場)補跑 startRound:被動經驗、加碼持續效果、商店都照規則走
  function catchUp(g, round) {
    let guard = 0;
    while (g.round < round && guard++ < 300) startRound(g);
    return g;
  }
  // 快照裡的狀態可能是空的(沒進過頁面的人、測試機器人)或缺欄位(結算只補了部分):補成完整的
  function normState(st) {
    const s = clone(st || {});
    s.board = s.board || []; s.bench = s.bench || [];
    s.board.forEach((c) => { if (c.row !== 0 && c.row !== 1) delete c.row; }); s.bench.forEach((c) => { delete c.row; }); // 排別只有場上的卡有
    if (s.gold == null) s.gold = AD.START_GOLD;
    s.level = s.level || 1; s.xp = s.xp || 0; s.streak = s.streak || 0; s.bestStreak = s.bestStreak || 0;
    s.perks = Object.assign(newPerks(), s.perks || {}); s.perkPicks = s.perkPicks || [];
    s.store = Array.isArray(s.store) ? s.store : []; s.roundFx = Object.assign({ atk: 0, hp: 0 }, s.roundFx || {});
    return s;
  }
  // 一場對戰:snapA / snapB 是資料庫的封板快照({player_id, hp, afk, state}),ghost = B 是幽靈(只有 A 有結算)。
  // 回傳 { r(模擬結果,含演出事件), outcomes:[{player_id,res,dmg,eco,insured,hpBefore,goldBefore,afk,side,patch,stat}] }
  // evId = 這一輪的夜市事件 id(沒有就不傳 / null);呼叫的人用 AutochessEngine.nightEvent(事件種子, round) 算,每個客戶端結果一樣
  function battleOnline(round, snapA, snapB, ghost, seed, wantLog, evId, monSeed) {
    evId = evId || null;
    if (AD.isMonsterRound(round)) return battleMonsterOnline(round, snapA, snapB, ghost, seed, wantLog, monSeed);
    const A = normState(snapA.state), B = normState(snapB.state);
    const r = E.simulate(fightBoard(A, A.board, evId), fightBoard(B, B.board, evId), seed, { log: !!wantLog, extraA: extraFor(A), extraB: ghost ? null : extraFor(B) });
    const mk = (S, snap, side) => {
      const other = side === "a" ? "b" : "a";
      const res = r.winner === side ? "win" : r.winner === other ? "lose" : "draw";
      const dmg = res === "lose" ? E.loseDamage(round, side === "a" ? r.starsB : r.starsA, evId) : 0;
      const coins = side === "a" ? r.bonusCoinsA : r.bonusCoinsB;
      const rapport = S.perks.goodRapport > 0 ? AD.PERK_BY_ID.good_rapport.n : 0;
      const eco = E.settleEconomy({ result: res, round, gold: S.gold, streak: S.streak, level: S.level, bonusCoins: (coins || 0) + rapport, event: evId });
      const perks = clone(S.perks); let insured = false;
      if (res === "lose" && perks.streakGuard) { eco.streak = S.streak; perks.streakGuard = false; insured = true; }
      if (rapport) perks.goodRapport--;
      if (snap.afk && eco.streakBonus) { eco.gold -= eco.streakBonus; eco.gain -= eco.streakBonus; eco.streakBonus = 0; } // 掛網:照打,不發連勝加成
      return {
        player_id: snap.player_id, res, dmg, eco, insured, side, afk: !!snap.afk, hpBefore: snap.hp, goldBefore: S.gold,
        patch: { gold: eco.gold, streak: eco.streak, bestStreak: Math.max(S.bestStreak || 0, eco.streak), perks },
        stat: { round, res, dmg, event: evId, level: S.level, gold: S.gold, refresh: S.refreshCount || 0, afk: !!snap.afk, cards: S.board.map((c) => c.id + "★" + c.star), bonds: clone(side === "a" ? r.bondsA : r.bondsB), picks: S.perkPicks.slice(), hidden: clone((side === "a" ? r.hiddenA : r.hiddenB) || []), mono: monoCount(S.board), three: S.board.filter((c) => c.star >= 3).length, bookend: bookendOf(S.board) },
      };
    };
    const outcomes = [mk(A, snapA, "a")];
    if (!ghost) outcomes.push(mk(B, snapB, "b"));
    return { r, outcomes };
  }

  // 怪物輪的連線版對戰:配對照舊(資料庫不用改),但雙方各自打怪物,互相沒有關係。
  // 送給資料庫的結算一律是 res = draw、dmg = 0(不扣血、不計勝敗、連勝不變);真實勝負放在 pve 欄位,畫面與稱號才看得到。
  // rBy = { player_id: 該玩家打怪物的模擬結果 },畫面演出用(每個人自己都是 A 方)。
  // monSeed = 怪物種子(活動 id 推出來的事件種子);沒傳就是預設怪物
  function battleMonsterOnline(round, snapA, snapB, ghost, seed, wantLog, monSeed) {
    const rBy = {}, outcomes = [], mon = AD.monsterFor(monSeed, round);
    [snapA].concat(ghost ? [] : [snapB]).forEach((snap) => {
      const S = normState(snap.state), f = monsterFight(round, S, S.board, `${seed}|${snap.player_id}`, wantLog, mon);
      rBy[snap.player_id] = f.r;
      const perks = clone(S.perks); if (f.drop) perks.drop = f.drop;
      outcomes.push({
        player_id: snap.player_id, res: "draw", dmg: 0, eco: f.eco, insured: false, side: "a", afk: !!snap.afk, hpBefore: snap.hp, goldBefore: S.gold,
        patch: { gold: f.eco.gold, streak: S.streak, bestStreak: S.bestStreak || 0, perks },
        pve: { won: f.res === "win", res: f.res, drop: f.drop, mon: mon.id },
        stat: { round, res: "draw", dmg: 0, pve: true, mon: mon.id, won: f.res === "win", level: S.level, gold: S.gold, refresh: S.refreshCount || 0, afk: !!snap.afk, cards: S.board.map((c) => c.id + "★" + c.star), bonds: clone(f.r.bondsA), picks: S.perkPicks.slice() },
      });
    });
    return { r: rBy[snapA.player_id], rBy, monster: true, outcomes };
  }

  // ---- 連線版:測試機器人 / 補位機器人的準備階段 ----
  // 機器人沒有人在操作,所以由在線的客戶端「代打」:把它存在資料庫的 state 讀出來,用單機版同一套電腦 AI(autochess-bot.js)
  // 買卡、升級、排陣,再存回去。全部由 botId + 種子決定,誰代打結果都一樣(多個客戶端同時代打,只有第一個存得進去,其餘被版本鎖擋掉)。
  const botHash = (id) => { let h = 0; String(id).split("").forEach((ch) => { h = (h * 31 + ch.charCodeAt(0)) >>> 0; }); return h; };
  function botStrategy(botId) {
    const h = botHash(botId), n = TAG_KEYS.length;
    return { name: "正常", focus: h % (n + 2) >= n ? null : TAG_KEYS[h % (n + 2)], reserve: 0 }; // 約 8/10 專攻一個流派,2/10 雜牌
  }
  // state = 資料庫目前的狀態(可以是空物件);round = 現在是第幾輪。回傳要存回去的新 state(已經是這一輪就原樣回傳 null)
  // nightSeed = 夜市事件種子(活動沒開夜市事件就不傳):電腦玩家也要照事件買卡(人潮商店 +1 格、打烊特賣 −1)
  function botPrepOnline(state, round, botId, evSeed, hp, nightSeed) {
    const st = normState(state);
    const done = st.stateRound || 0;
    if (done >= round) return null;
    if (st.perks && st.perks.drop) { // 怪物輪的掉落:電腦玩家直接放進待命席(買卡時會自己合成);放不下就折成銅板
      const id = st.perks.drop, m = E.mergeCards(st.board, st.bench.concat([{ id, star: 1 }]));
      st.perks.drop = null;
      if (m.bench.length <= AD.BENCH_SLOTS) { st.board = m.board; st.bench = m.bench; } else if (AD.CARD_BY_ID[id]) st.gold += AD.CARD_BY_ID[id].cost;
    }
    const p = Bot.newPlayer(botId, botStrategy(botId));
    Object.assign(p, { gold: st.gold, level: st.level, xp: st.xp, streak: st.streak, board: st.board.map(copy), bench: st.bench.map(copy), hp: hp == null ? AD.START_HP : hp });
    for (let r = done + 1; r <= round; r++) { const ne = nightSeed ? E.nightEvent(nightSeed, r) : null; Bot.playPrep(p, r, evSeed, ne ? ne.id : null); } // 被動經驗在 playPrep 裡面算;漏掉的輪次補跑
    // 保險:待命席不能超過格數,多出來的賣掉最弱的(電腦 AI 偶爾會在滿位時買進)
    const pw = (c) => (AD.CARD_BY_ID[c.id].atk * 3 + AD.CARD_BY_ID[c.id].hp) * AD.STAR.stat[c.star];
    while (p.bench.length > AD.BENCH_SLOTS) {
      let wi = 0; p.bench.forEach((c, i) => { if (pw(c) < pw(p.bench[wi])) wi = i; });
      const c = p.bench.splice(wi, 1)[0]; p.gold += AD.sellValue(AD.CARD_BY_ID[c.id], c.star);
    }
    st.gold = p.gold; st.level = p.level; st.xp = p.xp; st.board = p.board.map(copy); st.bench = p.bench.map(copy);
    st.shop = []; st.shopLocked = false; st.refreshCount = 0; st.stateRound = round;
    return st;
  }

  return { monsterFight, giveDrop, createOnline, botPrepOnline, botStrategy, serialize, restore, catchUp, normState, battleOnline, sealPrep, create, startRound, buy, undo, sell, move, buyXp, autoArrange, refresh, refreshCost, toggleLock, pickPerk, targetsFor, seal, nextRound, bondsPreview, slotsOf, capacityOf, prepSeconds, stats, ranking, extraFor, ownedInfo, maxedIds, rowCount, eventIdOf, costOf, sellValueOf, fightBoard, buyStore, storeTargets };
})();
