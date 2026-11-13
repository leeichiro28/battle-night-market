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
      perks: { freeRefresh: 0, goodRapport: 0, xpCoupon: 0, expandRounds: 0, preorder: null, regular: false, stallPlus: 0, tagAssist: {}, streakGuard: false },
      perkPicks: [], pendingPerk: null, bestStreak: 0, threeStar: 0,
    });
    const bots = BOT_NAMES.slice(0, (opts.players || 8) - 1).map((n, i) => {
      const b = Bot.newPlayer("b" + i, { name: "正常", focus: i % 3 === 2 ? null : TAG_KEYS[i % TAG_KEYS.length], reserve: 0 });
      b.name = n; b.human = false; return b;
    });
    return { seed, evSeed: "ev" + seed, round: 0, phase: "idle", me, bots, players: [me].concat(bots), over: false, rank: null, report: null, timer: opts.timer !== false, autoFill: opts.autoFill !== false, dataVersion: AD.DATA_VERSION };
  }

  const slotsOf = (me) => AD.slotsFor(me.level) + me.perks.stallPlus;
  const prepSeconds = (round) => AD.prepSeconds(round);
  const capacityOf = (me) => slotsOf(me) + AD.BENCH_SLOTS;
  const cardsOf = (me) => me.board.concat(me.bench);
  const fail = (msg) => ({ ok: false, msg });
  const okr = (extra) => Object.assign({ ok: true }, extra || {});

  // ---------------- 商店 ----------------
  function rollShopFor(g) {
    const me = g.me;
    return E.rollShop(`${g.evSeed}|me`, g.round, me.refreshCount, me.level, me.roundOpts);
  }

  // ---------------- 回合開始(準備階段)----------------
  function startRound(g) {
    g.round++; g.phase = "prep"; g.report = null;
    const me = g.me;
    if (g.round > 1) { const r = AD.addXp(me.level, me.xp, AD.PASSIVE_XP); me.level = r.level; me.xp = r.xp; }
    g.bots.filter((b) => b.alive).forEach((b) => Bot.playPrep(b, g.round, g.evSeed)); // 電腦玩家的被動 XP 在 playPrep 裡面算
    // 本輪商店選項(攤位加碼的持續效果在這裡結算一次)
    const p = me.perks;
    me.roundOpts = {};
    if (p.expandRounds > 0) { me.roundOpts.extraSlots = 1; p.expandRounds--; }
    if (p.preorder && p.preorder.rounds > 0) { me.roundOpts.tagBoost = { tag: p.preorder.tag, mult: AD.PERK_BY_ID.preorder.mult }; p.preorder.rounds--; if (!p.preorder.rounds) p.preorder = null; }
    if (p.regular) { me.roundOpts.guaranteeEpic = true; p.regular = false; }
    me.refreshCount = 0; me.freeFirstUsed = false; me.undo = null;
    if (me.shopLocked) me.shopLocked = false; // 鎖定只保留到下一輪:商店原封不動(買走的格子留空),不免費刷新
    else me.shop = rollShopFor(g);
    me.pendingPerk = null;
    const pi = AD.PERK_ROUNDS.indexOf(g.round);
    if (pi >= 0) me.pendingPerk = { n: pi + 1, candidates: genCandidates(g, pi + 1) };
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
    const cost = AD.CARD_BY_ID[id].cost;
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
    const v = AD.sellValue(AD.CARD_BY_ID[c.id], c.star);
    arr.splice(idx, 1); me.gold += v; me.undo = null;
    return okr({ value: v });
  }
  // 移動:from / to = { zone: 'board'|'bench', idx }。目標有卡 → 交換;目標是空位 → 放到該區最後
  function move(g, from, to) {
    const me = g.me;
    if (g.phase !== "prep") return fail("現在不是準備階段");
    const src = from.zone === "board" ? me.board : me.bench, dst = to.zone === "board" ? me.board : me.bench;
    const c = src[from.idx];
    if (!c) return fail("找不到這張卡");
    const limit = to.zone === "board" ? slotsOf(me) : AD.BENCH_SLOTS;
    if (from.zone === to.zone) {
      if (to.idx < dst.length) { if (to.idx !== from.idx) { const t = dst[to.idx]; dst[to.idx] = c; dst[from.idx] = t; } }
      else { src.splice(from.idx, 1); src.push(c); }
      return okr();
    }
    if (to.idx < dst.length) { const t = dst[to.idx]; dst[to.idx] = c; src[from.idx] = t; return okr(); } // 跨區交換
    if (dst.length >= limit) return fail(to.zone === "board" ? "上陣位置已滿,點一張場上的卡交換" : "待命席已滿");
    src.splice(from.idx, 1); dst.push(c);
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
    const round = g.round, rng = E.makeRng(`g|${g.evSeed}|${round}`);
    const live = g.players.filter((p) => p.alive);
    const snap = {}; live.forEach((p) => (snap[p.id] = p.board.map(copy)));
    const order = rng.shuffle(live), pairs = [];
    for (let i = 0; i + 1 < order.length; i += 2) pairs.push([order[i], order[i + 1], false]);
    if (order.length % 2) { const lone = order[order.length - 1]; pairs.push([lone, rng.pick(live.filter((x) => x !== lone)), true]); }
    const outcomes = [];
    pairs.forEach(([a, b, ghost], k) => {
      const isMine = mineLog && (a.human || (b.human && !ghost));
      const r = E.simulate(snap[a.id], snap[b.id], `${g.evSeed}|${round}|${k}`, { log: !!isMine, extraA: a.human ? extraFor(a) : null, extraB: b.human && !ghost ? extraFor(b) : null });
      const oa = { p: a, foe: b, ghost, side: "a", r, res: r.winner === "a" ? "win" : r.winner === "b" ? "lose" : "draw", dmg: r.winner === "b" ? E.loseDamage(round, r.starsB) : 0, coins: r.bonusCoinsA, board: snap[a.id], foeBoard: snap[b.id] };
      outcomes.push(oa);
      if (!ghost) outcomes.push({ p: b, foe: a, ghost: false, side: "b", r, res: r.winner === "b" ? "win" : r.winner === "a" ? "lose" : "draw", dmg: r.winner === "a" ? E.loseDamage(round, r.starsA) : 0, coins: r.bonusCoinsB, board: snap[b.id], foeBoard: snap[a.id] });
    });
    outcomes.forEach((o) => {
      const p = o.p;
      const rapport = p.human && p.perks.goodRapport > 0 ? AD.PERK_BY_ID.good_rapport.n : 0;
      const prevStreak = p.streak;
      const s = E.settleEconomy({ result: o.res, round, gold: p.gold, streak: p.streak, level: p.level, bonusCoins: (o.coins || 0) + rapport });
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
        me.board.push(me.bench.splice(bi, 1)[0]); filled++;
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
    g.report = { round: g.round, mine, outcomes, autoPicked, filled, over: g.over };
    return okr({ report: g.report });
  }
  // 玩家淘汰或全場剩 1 人:快轉到結束算出名次
  function finish(g) {
    let guard = 0;
    while (g.players.filter((p) => p.alive).length > 1 && guard++ < 40) {
      g.round++;
      g.bots.filter((b) => b.alive).forEach((b) => Bot.playPrep(b, g.round, g.evSeed));
      roundCore(g, false);
    }
    g.over = true;
    const rk = ranking(g);
    g.rank = rk.indexOf(g.me) + 1;
    g.finalRanking = rk.map((p) => ({ name: p.name, human: !!p.human, hp: Math.max(0, p.hp), elimRound: p.elimRound, wins: p.wins }));
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
  const STATE_KEYS = ["gold", "level", "xp", "streak", "board", "bench", "shop", "shopLocked", "refreshCount", "freeFirstUsed", "roundOpts", "perks", "perkPicks", "pendingPerk", "bestStreak", "threeStar"];
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const newPerks = () => ({ freeRefresh: 0, goodRapport: 0, xpCoupon: 0, expandRounds: 0, preorder: null, regular: false, stallPlus: 0, tagAssist: {}, streakGuard: false });

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
    const g = create({ seed: opts.seed, name: opts.name, players: 1 }); // 1 人 = 沒有電腦玩家
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
    if (s.gold == null) s.gold = AD.START_GOLD;
    s.level = s.level || 1; s.xp = s.xp || 0; s.streak = s.streak || 0; s.bestStreak = s.bestStreak || 0;
    s.perks = Object.assign(newPerks(), s.perks || {}); s.perkPicks = s.perkPicks || [];
    return s;
  }
  // 一場對戰:snapA / snapB 是資料庫的封板快照({player_id, hp, afk, state}),ghost = B 是幽靈(只有 A 有結算)。
  // 回傳 { r(模擬結果,含演出事件), outcomes:[{player_id,res,dmg,eco,insured,hpBefore,goldBefore,afk,side,patch,stat}] }
  function battleOnline(round, snapA, snapB, ghost, seed, wantLog) {
    const A = normState(snapA.state), B = normState(snapB.state);
    const r = E.simulate(A.board.map(copy), B.board.map(copy), seed, { log: !!wantLog, extraA: extraFor(A), extraB: ghost ? null : extraFor(B) });
    const mk = (S, snap, side) => {
      const other = side === "a" ? "b" : "a";
      const res = r.winner === side ? "win" : r.winner === other ? "lose" : "draw";
      const dmg = res === "lose" ? E.loseDamage(round, side === "a" ? r.starsB : r.starsA) : 0;
      const coins = side === "a" ? r.bonusCoinsA : r.bonusCoinsB;
      const rapport = S.perks.goodRapport > 0 ? AD.PERK_BY_ID.good_rapport.n : 0;
      const eco = E.settleEconomy({ result: res, round, gold: S.gold, streak: S.streak, level: S.level, bonusCoins: (coins || 0) + rapport });
      const perks = clone(S.perks); let insured = false;
      if (res === "lose" && perks.streakGuard) { eco.streak = S.streak; perks.streakGuard = false; insured = true; }
      if (rapport) perks.goodRapport--;
      if (snap.afk && eco.streakBonus) { eco.gold -= eco.streakBonus; eco.gain -= eco.streakBonus; eco.streakBonus = 0; } // 掛網:照打,不發連勝加成
      return {
        player_id: snap.player_id, res, dmg, eco, insured, side, afk: !!snap.afk, hpBefore: snap.hp, goldBefore: S.gold,
        patch: { gold: eco.gold, streak: eco.streak, bestStreak: Math.max(S.bestStreak || 0, eco.streak), perks },
        stat: { round, res, dmg, level: S.level, gold: S.gold, refresh: S.refreshCount || 0, afk: !!snap.afk, cards: S.board.map((c) => c.id + "★" + c.star), bonds: clone(side === "a" ? r.bondsA : r.bondsB), picks: S.perkPicks.slice(), hidden: clone((side === "a" ? r.hiddenA : r.hiddenB) || []), mono: monoCount(S.board), three: S.board.filter((c) => c.star >= 3).length, bookend: bookendOf(S.board) },
      };
    };
    const outcomes = [mk(A, snapA, "a")];
    if (!ghost) outcomes.push(mk(B, snapB, "b"));
    return { r, outcomes };
  }

  return { createOnline, serialize, restore, catchUp, normState, battleOnline, sealPrep, create, startRound, buy, undo, sell, move, buyXp, refresh, refreshCost, toggleLock, pickPerk, targetsFor, seal, nextRound, bondsPreview, slotsOf, capacityOf, prepSeconds, stats, ranking, extraFor };
})();
