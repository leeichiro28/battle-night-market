// 夜市自走棋 · 戰鬥引擎(企劃書 docs/autochess-design.md 第三章、第五章)
//
// 純函式,不碰 DOM、不碰資料庫。最重要的要求:同一組(陣容 + 種子)在任何瀏覽器都算出一模一樣的結果。
// 所以:不使用 Math.random() 與 Date.now(),所有隨機一律走 makeRng(種子);
//       抽籤的順序固定(先 a 隊後 b 隊、依站位由前到後),不依賴物件鍵順序。
//
// 陣容(board)是 [{ id, star, bonusAtk?, bonusHp? }],依站位由左到右(第 1 位 = 先鋒,最後一張 = 壓軸)。
// 對外:simulate / computeBonds / makeRng / rollShop / mergeCards / settleEconomy / loseDamage / pickMainTag
window.AutochessEngine = (function () {
  const AD = window.AutochessData;
  const B = AD.BATTLE;

  // ---------------- 種子亂數 ----------------
  function hashSeed(str) { // xmur3
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) { h = Math.imul(h ^ str.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }
  function makeRng(seed) { // mulberry32
    let a = typeof seed === "number" ? seed >>> 0 : hashSeed(String(seed));
    const rng = {
      next() {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      },
      int(n) { return Math.floor(rng.next() * n); },
      pick(arr) { return arr[rng.int(arr.length)]; },
      shuffle(arr) { const o = arr.slice(); for (let i = o.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = o[i]; o[i] = o[j]; o[j] = t; } return o; },
    };
    return rng;
  }

  // ---------------- 羈絆 ----------------
  // 只算「不同名」的卡;雙流派卡兩個流派都算;extra = { 流派: 額外張數 }(給之後的「流派助陣」加碼卡用)
  function countTags(board, extra) {
    const seen = {}, counts = {};
    board.forEach((c) => {
      if (seen[c.id]) return;
      seen[c.id] = true;
      (AD.CARD_BY_ID[c.id].tags || []).forEach((t) => (counts[t] = (counts[t] || 0) + 1));
    });
    if (extra) Object.keys(extra).forEach((t) => (counts[t] = (counts[t] || 0) + extra[t]));
    return counts;
  }
  // 回傳 { counts, active: { 流派: 目前達到的門檻 }, fx: 合併後的羈絆效果旗標 }
  // hidden:湊齊的隱藏羈絆 id 清單;hiddenFx 的數值效果合進 fx(同名旗標以隱藏羈絆為準,加成類旗標用累加)
  function computeBonds(board, extra) {
    const counts = countTags(board, extra), active = {}, fx = {};
    Object.keys(AD.BONDS).forEach((tag) => {
      let reached = 0;
      AD.BONDS[tag].forEach((tier) => {
        if ((counts[tag] || 0) >= tier.need) { reached = tier.need; Object.assign(fx, tier.fx); }
      });
      if (reached) active[tag] = reached;
    });
    const ids = {}; board.forEach((c) => (ids[c.id] = true));
    const hidden = [];
    (AD.HIDDEN_BONDS || []).forEach((h) => {
      if (!h.cards.every((id) => ids[id])) return;
      hidden.push(h.id);
      Object.keys(h.fx).forEach((k) => { fx[k] = typeof h.fx[k] === "number" && typeof fx[k] === "number" ? fx[k] + h.fx[k] : h.fx[k]; });
    });
    return { counts, active, fx, hidden };
  }
  // 換位(企劃 3-9「換位」):依序處理有 deploy 的卡(由左到右),換位後才判定先鋒/壓軸與站位效果
  function applyDeploy(board) {
    const out = board.map((c) => ({ ...c }));
    for (let i = 0; i < out.length; i++) {
      const def = AD.CARD_BY_ID[out[i].id];
      const mode = def.deploy || (def.star3 && out[i].star >= 3 && def.star3.deploy);
      if (!mode) continue;
      const j = mode === "swapFront" ? 0 : out.length - 1;
      if (j !== i) { const t = out[i]; out[i] = out[j]; out[j] = t; }
    }
    return out;
  }
  // 主流派:不同名張數最多的流派(至少 2 張才算,同數取 DATA 順序前者),沒有則 null
  function pickMainTag(board) {
    const counts = countTags(board);
    let best = null, bn = 1;
    Object.keys(AD.TAGS).forEach((t) => { if ((counts[t] || 0) > bn) { best = t; bn = counts[t]; } });
    return best;
  }


  // ---------------- 自動排站位(企劃點子 17;給新手用的按鈕)----------------
  // 依「先鋒 / 壓軸 / 前排 / 後排 / 鄰接」效果、血厚的放前面、卜卦羈絆的兩端加成,替上陣的卡找一個分數最高的排法。
  // 最多 8 張 → 全排列 40320 種,純算分數不跑戰鬥,幾十毫秒內完成。分數相同維持原本的順序;回傳「換位前」的新順序。
  const ADJ_ACTIONS = { buffAdjAtk: 1, shieldAdj: 1, healAdj: 1 };
  function arrangeScore(d, ends) {
    const n = d.length; let sc = 0;
    d.forEach((c, i) => {
      const def = AD.CARD_BY_ID[c.id], sm = AD.STAR.stat[c.star || 1];
      const effects = def.fx.concat((c.star || 1) >= 3 && def.star3 ? def.star3.fx : []);
      const front = i < Math.ceil(n / 2);
      effects.forEach((e) => {
        if (e.when === "vanguard" && i === 0) sc += 4;
        else if (e.when === "finale" && i === n - 1) sc += 4;
        else if (e.when === "front" && front) sc += 3;
        else if (e.when === "back" && !front) sc += 3;
        if (ADJ_ACTIONS[e.do]) sc += (i > 0 ? 1.5 : 0) + (i < n - 1 ? 1.5 : 0);
      });
      sc += def.hp * sm * (n - 1 - i) / Math.max(1, n) * 0.04;      // 血厚的站前面
      sc += def.atk * sm * i / Math.max(1, n) * 0.05;               // 輸出放後面比較活得久
      if (ends && (i === 0 || i === n - 1)) sc += def.atk * sm * 0.15; // 卜卦羈絆:先鋒與壓軸有加成,放強的
    });
    return sc;
  }
  function autoArrange(board) {
    const n = board.length;
    if (n < 2) return board.map((c) => ({ ...c }));
    const ends = !!computeBonds(board).fx.endsAtk;
    let best = board.map((c, i) => i), bestSc = arrangeScore(applyDeploy(best.map((i) => board[i])), ends);
    const idx = best.slice(), c = new Array(n).fill(0);
    const test = () => { const sc = arrangeScore(applyDeploy(idx.map((i) => board[i])), ends); if (sc > bestSc + 1e-9) { bestSc = sc; best = idx.slice(); } };
    for (let i = 0; i < n;) { // Heap's algorithm(非遞迴)
      if (c[i] < i) { const k = i % 2 === 0 ? 0 : c[i]; const t = idx[k]; idx[k] = idx[i]; idx[i] = t; test(); c[i]++; i = 0; } else { c[i] = 0; i++; }
    }
    return best.map((i) => ({ ...board[i] }));
  }

  // ---------------- 建立戰鬥單位 ----------------
  const scale = (v, m) => Math.max(1, Math.round(v * m));
  function buildUnit(side, card, idx, total, rng) {
    const def = AD.CARD_BY_ID[card.id];
    const star = card.star || 1;
    const sm = AD.STAR.stat[star], fm = AD.STAR.fx[star];
    const u = {
      side, idx, id: def.id, name: def.name, star,
      atk: Math.round(def.atk * sm) + (card.bonusAtk || 0),
      hp: Math.round(def.hp * sm * B.hpMult) + (card.bonusHp || 0),
      spd: def.spd,
      shield: 0, burn: 0, burnSrc: null, poison: 0, dr: 0, frozen: 0, critPct: 0, attackLast: false,
      tie: rng.next(), // 同速度時的先後,由種子決定
      isVanguard: idx === 0, isFinale: idx === total - 1, isFront: idx < Math.ceil(total / 2),
      fx: { start: [], roundStart: [], attack: [], hurt: [], kill: [], death: [], roundEnd: [], crit: [] },
      passives: [],
    };
    u.maxHp = u.hp;
    const effects = (def.fx || []).concat(star >= 3 && def.star3 ? def.star3.fx : []);
    effects.forEach((e) => {
      if (e.when === "vanguard" && !u.isVanguard) return;
      if (e.when === "finale" && !u.isFinale) return;
      if (e.when === "front" && !u.isFront) return;
      if (e.when === "back" && u.isFront) return;
      const eff = { ...e };
      ["n", "flat", "pct", "chance"].forEach((k) => { if (eff[k] != null) eff[k] = scale(eff[k], fm); });
      if (e.on === "passive") u.passives.push(eff); else u.fx[e.on].push(eff);
    });
    return u;
  }
  function makeTeam(side, board, rng, extra) {
    const bonds = computeBonds(board, extra);
    const t = { side, bonds, flags: { burnMult: 1, burnFlat: 0, dmgReduction: 0, critPct: 0, frozenDmgPct: 0, winCoin: 0, ...bonds.fx }, bonusCoins: 0, reviveLeft: 0, units: [] };
    t.units = board.map((c, i) => buildUnit(side, c, i, board.length, rng));
    t.units.forEach((u) => u.passives.forEach((p) => {
      if (p.do === "crit") u.critPct += p.pct;
      else if (p.do === "attackLast") u.attackLast = true;
      else if (p.do === "burnFlat") t.flags.burnFlat += p.n;
      else if (p.do === "winCoin") t.flags.winCoin += p.n;
      else if (p.do === "reviveFirst") t.flags.reviveFirstPct = Math.max(t.flags.reviveFirstPct || 0, p.pct);
    }));
    const f = t.flags;
    t.reviveLeft = f.reviveFirstPct ? 1 : 0;
    // 羈絆的全隊加成:全隊暴擊率(遊戲攤等)、隱藏羈絆的全隊攻擊
    t.units.forEach((u) => { if (f.critPct) u.critPct += f.critPct; if (f.allAtk) u.atk += f.allAtk; });
    // 卜卦:先鋒與壓軸(只有 1 張時算一次)
    const ends = t.units.length ? (t.units.length > 1 ? [t.units[0], t.units[t.units.length - 1]] : [t.units[0]]) : [];
    ends.forEach((u) => {
      if (f.endsAtk) u.atk += f.endsAtk;
      if (f.endsMult) u.atk = Math.round(u.atk * (1 + f.endsMult / 100));
      if (f.endsCrit) u.critPct += f.endsCrit;
      if (f.endsDef) u.dr += f.endsDef;
    });
    return t;
  }

  const unitView = (u) => ({ id: u.id, star: u.star, atk: u.atk, hp: u.hp, maxHp: u.maxHp, spd: u.spd });

  // ---------------- 戰鬥 ----------------
  // opts.log = true 時回傳 events(演出/回放用的簡短事件,不影響結果)
  function simulate(boardA, boardB, seed, opts) {
    opts = opts || {};
    const rng = makeRng(seed);
    const ta = makeTeam("a", applyDeploy(boardA), rng, opts.extraA), tb = makeTeam("b", applyDeploy(boardB), rng, opts.extraB);
    const teams = { a: ta, b: tb };
    const foe = (side) => (side === "a" ? tb : ta);
    const events = opts.log ? [] : null;
    // 演出用:開場時各單位的數值(opts.log 才附上,不影響結果)
    const initStats = opts.log ? { a: ta.units.map(unitView), b: tb.units.map(unitView) } : null;
    const ev = (e) => { if (events) events.push(e); };
    const aliveOf = (t) => t.units.filter((u) => u.hp > 0);
    const tag = (u) => u.side + u.idx;

    function addBurn(tgt, n, srcSide) { if (!tgt || tgt.hp <= 0 || n <= 0) return; tgt.burn += n; tgt.burnSrc = srcSide; ev({ t: "burn", to: tag(tgt), n }); }
    function addPoison(tgt, n, srcSide) { if (!tgt || tgt.hp <= 0 || n <= 0) return; tgt.poison = Math.min(6, tgt.poison + n); ev({ t: "poison", to: tag(tgt), n }); }
    function heal(u, n) { if (!u || u.hp <= 0 || n <= 0 || u.hp >= u.maxHp) return; const g = Math.min(n, u.maxHp - u.hp); u.hp += g; ev({ t: "heal", to: tag(u), n: g }); }
    function buffAtk(u, n) { if (!u || u.hp <= 0 || !n) return; u.atk = Math.max(1, u.atk + n); ev({ t: "buff", to: tag(u), atk: n }); }
    function growHp(u, n) { if (!u || u.hp <= 0 || n <= 0) return; u.maxHp += n; u.hp += n; ev({ t: "buff", to: tag(u), atk: 0, hp: n }); }
    function addCoins(side, n) { const t = teams[side]; t.bonusCoins = Math.min(AD.BOND_COIN_CAP, t.bonusCoins + n); }
    function addShield(u, n) { if (u.hp > 0 && n > 0) { u.shield += n; ev({ t: "shield", to: tag(u), n }); } }
    function freeze(u, n) { if (u && u.hp > 0) { u.frozen = Math.max(u.frozen, n); ev({ t: "freeze", to: tag(u) }); } }
    function fastest(list) { return list.slice().sort((x, y) => y.spd - x.spd || x.idx - y.idx)[0]; }
    function adjacent(u) { return teams[u.side].units.filter((v) => v.hp > 0 && Math.abs(v.idx - u.idx) === 1); }

    // 效果動作表:fire(u, 鉤子, ctx) 逐一呼叫
    const ACTIONS = {
      burn: (u, e, c) => addBurn(c.target, e.n, u.side),
      burnNext: (u, e, c) => {
        if (!c.target) return;
        const list = aliveOf(foe(u.side)), i = list.indexOf(c.target);
        if (i >= 0 && list[i + 1]) addBurn(list[i + 1], e.n, u.side);
      },
      burnAll: (u, e) => aliveOf(foe(u.side)).forEach((x) => addBurn(x, e.n, u.side)),
      freezeFastest: (u, e) => { const l = aliveOf(foe(u.side)); if (l.length) freeze(fastest(l), e.n); },
      freezeRandom: (u, e) => { const l = aliveOf(foe(u.side)); if (l.length) freeze(rng.pick(l), e.n); },
      freezeTarget: (u, e, c) => { if (c.target && rng.next() * 100 < e.chance) freeze(c.target, 1); },
      shieldSelf: (u, e) => addShield(u, e.flat),
      shieldAllies: (u, e) => aliveOf(teams[u.side]).forEach((x) => addShield(x, e.flat)),
      reflect: (u, e, c) => { if (c.src && c.src.hp > 0) hit(u, c.src, e.flat, "reflect"); },
      buffAdjAtk: (u, e) => adjacent(u).forEach((x) => { x.atk += e.n; ev({ t: "buff", to: tag(x), atk: e.n }); }),
      coin: (u, e) => addCoins(u.side, e.n),
      poison: (u, e, c) => addPoison(c.target, e.n, u.side),
      poisonNext: (u, e, c) => {
        if (!c.target) return;
        const list = aliveOf(foe(u.side)), i = list.indexOf(c.target);
        if (i >= 0 && list[i + 1]) addPoison(list[i + 1], e.n, u.side);
      },
      poisonAll: (u, e) => aliveOf(foe(u.side)).forEach((x) => addPoison(x, e.n, u.side)),
      freezeSrc: (u, e, c) => { if (c.src && c.src.hp > 0 && rng.next() * 100 < e.chance) freeze(c.src, 1); },
      burnIfFrozen: (u, e, c) => { if (c.target && c.target.hp > 0 && c.target.frozen > 0) addBurn(c.target, e.n, u.side); },
      healSelf: (u, e) => heal(u, e.flat),
      healAllies: (u, e) => aliveOf(teams[u.side]).forEach((x) => heal(x, e.flat)),
      healAdj: (u, e) => adjacent(u).forEach((x) => heal(x, e.flat)),
      healLowest: (u, e) => { const l = aliveOf(teams[u.side]).filter((x) => x.hp < x.maxHp).sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp || x.idx - y.idx); if (l.length) heal(l[0], e.flat); },
      growAtk: (u, e) => buffAtk(u, e.n),
      growHp: (u, e) => growHp(u, e.n),
      growAllyHp: (u, e) => aliveOf(teams[u.side]).forEach((x) => growHp(x, e.n)),
      buffSelfAtk: (u, e) => buffAtk(u, e.n),
      buffAllyAtk: (u, e) => aliveOf(teams[u.side]).forEach((x) => buffAtk(x, e.n)),
      buffFinaleAtk: (u, e) => { const l = aliveOf(teams[u.side]); if (l.length) buffAtk(l[l.length - 1], e.n); },
      doubleAtk: (u) => buffAtk(u, u.atk),
      shieldAdj: (u, e) => adjacent(u).forEach((x) => addShield(x, e.flat)),
      shieldVanguard: (u, e) => { const l = aliveOf(teams[u.side]); if (l.length) addShield(l[0], e.flat); },
      dmgAll: (u, e) => aliveOf(foe(u.side)).forEach((x) => hit(u, x, e.n, "fx")),
      dmgRandom: (u, e) => { const l = aliveOf(foe(u.side)); if (l.length) hit(u, rng.pick(l), e.n, "fx"); },
      weakenTop: (u, e) => weaken(foe(u.side), e.n),
      stealAtk: (u, e, c) => { const t = c.target; if (t && t.hp > 0 && t.atk > 1) { const g = Math.min(e.n, t.atk - 1); buffAtk(t, -g); buffAtk(u, g); } },
      extraAttack: (u, e, c) => { if (!c.extra) attack(u, true); },
    };
    // 敵方攻擊最高者(同攻擊取站位靠前)攻擊 -n
    function weaken(team, n) {
      const l = aliveOf(team).sort((x, y) => y.atk - x.atk || x.idx - y.idx);
      if (l.length) buffAtk(l[0], -n);
    }
    function fire(u, hook, ctx) {
      u.fx[hook].forEach((e) => {
        if (e.atRound && (!ctx || ctx.round !== e.atRound)) return;
        if (u.hp > 0 || hook === "death") ACTIONS[e.do](u, e, ctx || {});
      });
    }

    // kind:attack / burn / bell / reflect。回傳實際造成(未被護盾吸收)的傷害
    function hit(src, tgt, amt, kind) {
      if (tgt.hp <= 0) return 0;
      const tt = teams[tgt.side], st = src ? teams[src.side] : null;
      if (kind === "attack") {
        if (tgt.frozen > 0 && st && st.flags.frozenDmgPct) amt = Math.floor(amt * (1 + st.flags.frozenDmgPct / 100));
        amt = Math.max(1, amt - tt.flags.dmgReduction - (tgt.dr || 0));
      }
      const raw = amt;
      const ab = kind === "poison" ? 0 : Math.min(tgt.shield, amt); tgt.shield -= ab; amt -= ab; // 中毒無視護盾
      tgt.hp -= amt;
      ev({ t: "dmg", from: src ? tag(src) : kind, to: tag(tgt), n: amt, ab, kind }); // n = 實際扣血、ab = 護盾吸收量(演出用)
      if (kind === "attack" && tgt.hp > 0) {
        fire(tgt, "hurt", { src });
        if (tt.flags.frontReflectPct && aliveOf(tt)[0] === tgt && src && src.hp > 0) hit(tgt, src, Math.floor(raw * tt.flags.frontReflectPct / 100), "reflect");
      }
      if (tgt.hp <= 0 && tt.reviveLeft > 0) { // 復活:每隊每場 1 次,第一位陣亡的友軍
        tt.reviveLeft--;
        tgt.hp = Math.max(1, Math.round(tgt.maxHp * tt.flags.reviveFirstPct / 100)); tgt.burn = 0; tgt.poison = 0; tgt.frozen = 0;
        ev({ t: "revive", to: tag(tgt), n: tgt.hp });
        return amt;
      }
      if (tgt.hp <= 0) {
        tgt.hp = 0;
        ev({ t: "die", to: tag(tgt) });
        if (kind === "attack" && src && src.hp > 0 && st && st.flags.killCoin) addCoins(src.side, st.flags.killCoin);
        if (kind === "attack" && src && src.hp > 0) fire(src, "kill", { target: tgt });
        fire(tgt, "death", {});
      }
      return amt;
    }

    function attack(u, extra) {
      const enemies = aliveOf(foe(u.side));
      if (!enemies.length) return;
      const tgt = extra ? rng.pick(enemies) : u.attackLast ? enemies[enemies.length - 1] : enemies[0];
      let dmg = u.atk;
      const crit = u.critPct > 0 && rng.next() * 100 < Math.min(100, u.critPct);
      if (crit) dmg = Math.floor(dmg * B.critMult);
      ev({ t: "atk", from: tag(u), to: tag(tgt), crit });
      hit(u, tgt, dmg, "attack");
      if (u.hp <= 0) return;
      const t = teams[u.side];
      const ctx = { target: tgt, extra };
      if (t.flags.burnOnAttack) addBurn(tgt, t.flags.burnOnAttack, u.side);
      if (t.flags.poisonOnAttack) addPoison(tgt, t.flags.poisonOnAttack, u.side);
      fire(u, "attack", ctx);
      if (crit) {
        fire(u, "crit", ctx);
        if (t.flags.critCoin) t.bonusCoins = Math.min(AD.BOND_COIN_CAP, t.bonusCoins + t.flags.critCoin);
        if (t.flags.critExtraAttack && !extra) attack(u, true);
      }
    }

    // ---- 開場 ----
    [ta, tb].forEach((t) => {
      const f = t.flags;
      if (f.vanguardShieldPct && t.units[0]) addShield(t.units[0], Math.floor(t.units[0].maxHp * f.vanguardShieldPct / 100));
      if (f.startBurnAll) aliveOf(foe(t.side)).forEach((x) => addBurn(x, f.startBurnAll, t.side));
      if (f.startFreezeFastest) { const l = aliveOf(foe(t.side)); if (l.length) freeze(fastest(l), f.startFreezeFastest); }
      if (f.startWeakenTop) weaken(foe(t.side), f.startWeakenTop);
      if (f.startShieldAll) aliveOf(t).forEach((x) => addShield(x, f.startShieldAll));
    });
    [ta, tb].forEach((t) => t.units.forEach((u) => fire(u, "start")));

    let round = 0, endedBy = null, bellRounds = 0;
    const result = () => {
      const la = aliveOf(ta), lb = aliveOf(tb);
      return la.length === 0 || lb.length === 0 ? { la, lb } : null;
    };
    for (round = 1; round <= B.maxRounds && !endedBy; round++) {
      ev({ t: "round", n: round });
      // 回合開始:效果 + 冰鎮羈絆 4 級的機率凍結
      [ta, tb].forEach((t) => {
        t.units.forEach((u) => fire(u, "roundStart", { round }));
        if (t.flags.roundFreezeChance && rng.next() * 100 < t.flags.roundFreezeChance) { const l = aliveOf(foe(t.side)); if (l.length) freeze(rng.pick(l), 1); }
      });
      // 行動順序:速度快的先,同速由種子決定
      const order = aliveOf(ta).concat(aliveOf(tb)).sort((x, y) => y.spd - x.spd || x.tie - y.tie);
      for (const u of order) {
        if (u.hp <= 0) continue;
        if (u.frozen > 0) { u.frozen--; ev({ t: "skip", from: tag(u) }); continue; }
        attack(u, false);
        if (result()) break;
      }
      if (result()) { endedBy = "wipe"; break; }
      // 回合結束:效果 → 灼傷 → 打烊鐘
      [ta, tb].forEach((t) => t.units.forEach((u) => fire(u, "roundEnd", { round })));
      [ta, tb].forEach((t) => {
        const f = t.flags;
        if (f.healAll) aliveOf(t).forEach((x) => heal(x, f.healAll));
        if (f.tickAtk) aliveOf(t).forEach((x) => buffAtk(x, f.tickAtk));
        if (f.tickHp) aliveOf(t).forEach((x) => growHp(x, f.tickHp));
      });
      [ta, tb].forEach((t) => t.units.forEach((u) => {
        if (u.hp > 0 && u.poison > 0) hit(null, u, u.poison, "poison"); // 中毒:不消退
      }));
      [ta, tb].forEach((t) => t.units.forEach((u) => {
        if (u.hp > 0 && u.burn > 0) {
          const sf = teams[u.burnSrc || (u.side === "a" ? "b" : "a")].flags;
          hit(null, u, u.burn * (1 + sf.burnFlat) * sf.burnMult, "burn");
          u.burn = Math.max(0, u.burn - 1);
        }
      }));
      if (round >= B.bellFrom) {
        bellRounds++;
        const d = (round - B.bellFrom + 1) * B.bellStep;
        ev({ t: "bell", n: d });
        [ta, tb].forEach((t) => t.units.forEach((u) => hit(null, u, d, "bell")));
      }
      if (result()) { endedBy = "wipe"; break; }
    }
    const la = aliveOf(ta), lb = aliveOf(tb);
    const hpA = la.reduce((s, u) => s + u.hp, 0), hpB = lb.reduce((s, u) => s + u.hp, 0);
    let winner;
    if (la.length === 0 && lb.length === 0) winner = "draw";
    else if (lb.length === 0) winner = "a";
    else if (la.length === 0) winner = "b";
    else { endedBy = "limit"; winner = hpA > hpB ? "a" : hpB > hpA ? "b" : "draw"; }
    if (winner === "a" && ta.flags.winCoin) addCoins("a", ta.flags.winCoin);
    if (winner === "b" && tb.flags.winCoin) addCoins("b", tb.flags.winCoin);
    const surv = (l) => l.map((u) => ({ id: u.id, star: u.star }));
    const stars = (l) => l.reduce((s, u) => s + u.star, 0);
    return {
      winner, rounds: Math.min(round, B.maxRounds), endedBy, bellRounds,
      survivorsA: surv(la), survivorsB: surv(lb), starsA: stars(la), starsB: stars(lb), hpA, hpB,
      bonusCoinsA: ta.bonusCoins, bonusCoinsB: tb.bonusCoins,
      bondsA: ta.bonds.active, bondsB: tb.bonds.active, hiddenA: ta.bonds.hidden, hiddenB: tb.bonds.hidden,
      events, init: initStats,
    };
  }

  // ---------------- 商店(用種子推算,不另外存;企劃 3-4)----------------
  // baseSeed 建議傳 `${活動種子}|${玩家id}`;同樣的(輪次、本輪刷新次數)永遠抽到同一排,重新整理網頁刷不出新卡
  // opts:extraSlots 多幾格 / tagBoost { tag, mult } 該流派出現權重倍數(預購單) / guaranteeEpic 保證至少 1 張史詩以上(老主顧)
  function rollShop(baseSeed, round, refreshCount, level, opts) {
    opts = opts || {};
    const rng = makeRng(`${baseSeed}|shop|${round}|${refreshCount}`);
    const odds = AD.SHOP_ODDS[Math.min(AD.MAX_LEVEL, Math.max(1, level))];
    const slots = AD.shopSlotsFor(level) + (opts.extraSlots || 0);
    const pools = AD.RARITY.map((r) => AD.CARDS.filter((c) => AD.COST_TO_RARITY[c.cost] === AD.RARITY.indexOf(r)));
    const boost = opts.tagBoost;
    const pickFrom = (pool) => {
      if (!boost) return rng.pick(pool);
      const w = pool.map((c) => (c.tags.includes(boost.tag) ? boost.mult : 1));
      let x = rng.next() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < pool.length; i++) { x -= w[i]; if (x < 0) return pool[i]; }
      return pool[pool.length - 1];
    };
    const out = [];
    for (let i = 0; i < slots; i++) {
      let r = rng.next() * 100, k = 0, acc = 0;
      for (k = 0; k < odds.length; k++) { acc += odds[k]; if (r < acc) break; }
      k = Math.min(k, odds.length - 1);
      while (k > 0 && !pools[k].length) k--;
      out.push(pickFrom(pools[k]).id);
    }
    if (opts.guaranteeEpic && !out.some((id) => AD.CARD_BY_ID[id].cost >= 3)) {
      const pool = pools[2].concat(rng.next() < 0.25 ? pools[3] : []);
      out[rng.int(out.length)] = rng.pick(pool).id;
    }
    return out;
  }

  // ---------------- 合成 ----------------
  // 待命席 + 上陣加起來,同名同星有 2 張 → 合成 1 張高 1 星(優先保留在上陣的位置)。3★ 因此需要 4 張 1★。
  function mergeCards(board, bench) {
    board = board.map((c) => ({ ...c })); bench = bench.map((c) => ({ ...c }));
    const merged = [];
    for (let guard = 0; guard < 50; guard++) {
      let done = true;
      const all = board.map((c, i) => ({ c, where: "board", i })).concat(bench.map((c, i) => ({ c, where: "bench", i })));
      const groups = {};
      for (const x of all) {
        if (x.c.star >= AD.STAR.max) continue;
        const k = x.c.id + "#" + x.c.star;
        (groups[k] = groups[k] || []).push(x);
      }
      const key = Object.keys(groups).find((k) => groups[k].length >= AD.STAR.mergeNeed);
      if (key) {
        const g = groups[key].slice(0, AD.STAR.mergeNeed);
        const keep = g.find((x) => x.where === "board") || g[0];
        const drop = g.filter((x) => x !== keep);
        keep.c.star++;
        const bonusAtk = g.reduce((s, x) => s + (x.c.bonusAtk || 0), 0), bonusHp = g.reduce((s, x) => s + (x.c.bonusHp || 0), 0);
        if (bonusAtk) keep.c.bonusAtk = bonusAtk;
        if (bonusHp) keep.c.bonusHp = bonusHp;
        drop.sort((x, y) => (x.where === y.where ? y.i - x.i : x.where === "bench" ? -1 : 1)); // 先刪 bench、索引大的先刪,避免位移
        drop.forEach((x) => (x.where === "board" ? board : bench).splice(x.i, 1));
        merged.push({ id: keep.c.id, star: keep.c.star });
        done = false;
      }
      if (done) break;
    }
    return { board, bench, merged };
  }

  // ---------------- 結算:銅板與扣血(企劃 3-2、3-3)----------------
  // 輸入本輪結果,回傳新銅板、連勝與各項明細。利息以「結算當下持有的銅板」計算(尚未加入本輪收入)。
  function settleEconomy(o) {
    const base = AD.baseIncome(o.round) + (o.level >= AD.LEVEL_PERKS.extraIncome ? AD.LEVEL_PERKS.extraIncomeAmount : 0);
    const interest = AD.interestOf(o.gold, o.round);
    let streak = o.streak, win = 0, streakBonus = 0;
    if (o.result === "win") { streak += 1; win = AD.WIN_BONUS; streakBonus = AD.streakBonus(streak); }
    else if (o.result === "lose") streak = 0; // 平手:連勝不增加也不中斷
    const gain = base + win + streakBonus + interest + (o.bonusCoins || 0);
    return { base, win, streakBonus, interest, bonusCoins: o.bonusCoins || 0, gain, gold: o.gold + gain, streak };
  }
  // 輸家扣血 = 輪次基礎傷害 + 贏家存活單位星級總和(上限 10)
  function loseDamage(round, winnerSurvivorStars) {
    return AD.roundBaseDamage(round) + Math.min(AD.SURVIVOR_STAR_CAP, winnerSurvivorStars);
  }

  return { makeRng, hashSeed, computeBonds, applyDeploy, autoArrange, countTags, pickMainTag, simulate, rollShop, mergeCards, settleEconomy, loseDamage };
})();
