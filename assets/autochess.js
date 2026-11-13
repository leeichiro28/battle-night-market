// 夜市自走棋 · 單機練習頁(階段 2)
// 純前端:你 + 7 位電腦玩家的 8 人場,流程與數值全在 autochess-game.js / autochess-engine.js,這裡只負責畫面。
// 練習模式:不用登入、不寫資料庫、不計名次、不給稱號,關掉頁面就沒了。
(function () {
  const AD = window.AutochessData, E = window.AutochessEngine, G = window.AutochessGame;
  const root = document.getElementById("ac-root");
  const esc = ui.esc, ic = (n, o) => ui.icon(n, o);
  const TAG_ICON = {}; Object.keys(AD.TAGS).forEach((k) => (TAG_ICON[k] = AD.TAGS[k].icon));
  const sfx = (k) => { try { if (window.AutochessSfx) AutochessSfx.play(k); } catch (e) { /* 音效失敗不影響遊戲 */ } };
  let sfxRound = 0; // 每一輪的準備階段只響一次「逼——」
  const pad2 = (n) => String(n).padStart(2, "0");
  const fmtSecs = (n) => (n >= 60 ? `${Math.floor(n / 60)} 分${n % 60 ? ` ${n % 60} 秒` : ""}` : `${n} 秒`);

  let g = null, sel = null, view = "intro", timerOn = true, deadline = 0, timerId = null, msg = null, msgTimer = null;
  let battleToken = 0, battleSpeed = 1;
  let history = [], showLog = false, logRound = null; // 戰報:每場戰鬥的文字紀錄,準備階段可回頭看
  // 連線版(正式場):網址帶 ?event=活動ID 且不是 ?mode=practice。時間、配對、結算、名次都在伺服器(見 migration-autochess.sql)。
  const params = new URLSearchParams(location.search), EVENT_ID = params.get("event");
  const OL = EVENT_ID && params.get("mode") !== "practice"
    ? { eventId: EVENT_ID, playerId: null, ev: null, clk: null, clkAt: 0, offset: 0, row: null, rev: 0, prepRound: 0, pairedRound: 0, playingRound: 0, checkedRound: 0, outcome: null, sealInfo: null,
        names: {}, standings: [], deadline: 0, prepTotal: 90, sealing: false, saving: false, dirty: false, savePromise: null, saveSeq: 0, rowSeq: 0, busy: false, stopped: false, timer: null, err: 0, nextDelay: 1000, initDone: false, closing: false }
    : null;

  // ---------------- 小工具 ----------------
  const cardDef = (c) => AD.CARD_BY_ID[c.id];
  function unitStats(c) {
    const d = cardDef(c), sm = AD.STAR.stat[c.star];
    return { atk: Math.round(d.atk * sm) + (c.bonusAtk || 0), hp: Math.round(d.hp * sm * AD.BATTLE.hpMult) + (c.bonusHp || 0), spd: d.spd };
  }
  const tagName = (t) => AD.TAGS[t].name;
  const stars = (n) => ic("star", { cls: "ac-star" }).repeat(n);
  function setMsg(text, tone) {
    msg = text ? { text, tone: tone || "info" } : null;
    const el = document.getElementById("ac-msg");
    if (el) { el.textContent = msg ? msg.text : ""; el.className = "ac-msg" + (msg ? " " + msg.tone : ""); }
    clearTimeout(msgTimer);
    if (text) msgTimer = setTimeout(() => setMsg(null), 2600);
  }

  const rarName = (cost) => AD.RARITY[AD.COST_TO_RARITY[cost]].name;
  const tipAttrs = (c) => `data-tip="card" data-cid="${c.id}" data-star="${c.star}" data-ba="${c.bonusAtk || 0}" data-bh="${c.bonusHp || 0}"`;
  function cardHtml(c, o) {
    o = o || {};
    const d = cardDef(c), st = unitStats(c), t0 = d.tags[0] || "none";
    const icon = TAG_ICON[t0] || "store";
    const cls = `ac-card ${o.mode || "mini"} t-${t0}${d.tags.length > 1 ? " dual" : ""} r-${d.cost} rc-${d.cost} s-${c.star}${o.sel ? " sel" : ""}${o.dim ? " dim" : ""}`;
    const data = (o.data || "") + " " + (o.noTip ? "" : tipAttrs(c)) + (d.tags.length > 1 ? ` style="--c2:var(--ac-${d.tags[1]})"` : "");
    const badge = o.pos ? `<i class="ac-pos">${o.pos}</i>` : "";
    if (o.mode === "shop") {
      const tags = d.tags.length ? d.tags.map(tagName).join("・") : "通用";
      return `<button class="${cls}" ${data}><span class="ac-rowtop"><span class="ac-cost">${ic("coins")}${d.cost}</span><span class="ac-rar">${rarName(d.cost)}</span></span>${ic(icon, { cls: "ac-ticon" })}<b class="ac-name">${esc(d.name)}</b><span class="ac-ttag">${esc(tags)}</span><span class="ac-st">${st.atk}/${st.hp}</span></button>`;
    }
    return `<button class="${cls}" ${data}><span class="ac-cost">${d.cost}</span><span class="ac-stars">${stars(c.star)}</span>${ic(icon, { cls: "ac-ticon" })}<b class="ac-name">${esc(d.name.slice(0, 2))}</b><span class="ac-st">${st.atk}/${st.hp}</span>${badge}</button>`;
  }

  // ---------------- 說明浮窗(滑鼠移上去 / 長按 / 右鍵 / 羈絆點一下)----------------
  const tip = document.createElement("div");
  tip.id = "ac-tip"; tip.className = "ac-tip"; document.body.appendChild(tip);
  let tipTimer = null, pressTimer = null, suppressUntil = 0, tipAnchor = null;
  function bondTipHtml(tag) {
    const me = g.me, b = E.computeBonds(me.board, G.extraFor(me)), n = b.counts[tag] || 0, reached = b.active[tag] || 0;
    const nxt = AD.BOND_TIERS.find((x) => x > n), max = AD.BOND_TIERS[AD.BOND_TIERS.length - 1];
    const rows = AD.BONDS[tag].map((t) => `<li class="${reached >= t.need ? "on" : ""}">${ic(reached >= t.need ? "circle-check" : "circle")}<b>${t.need} 張</b> ${esc(t.desc)}</li>`).join("");
    return `<div class="ac-tip-h">${ic(TAG_ICON[tag])}<b>${tagName(tag)}羈絆</b><span class="ac-tip-cost">${n}/${nxt || max}${reached ? ` · 已觸發 ${reached} 張級` : " · 尚未觸發"}</span></div><div class="ac-dim">${esc(AD.TAGS[tag].desc)}。只算<b>不同名</b>的卡,雙流派卡兩邊都算。</div><ul class="ac-blist">${rows}</ul>`;
  }
  function hiddenTipHtml(id) {
    const h = AD.HIDDEN_BONDS.find((x) => x.id === id);
    const on = h && E.computeBonds(g.me.board, G.extraFor(g.me)).hidden.includes(id);
    if (!h) return "";
    if (!on) return `<div class="ac-tip-h">${ic("circle-help")}<b>？？？</b><span class="ac-tip-cost">隱藏羈絆</span></div><div class="ac-dim">場上有人的組合很特別……把對的幾位攤主一起放上陣試試看。</div>`;
    return `<div class="ac-tip-h">${ic("sparkles")}<b>${esc(h.name)}</b><span class="ac-tip-cost">隱藏羈絆 · 已觸發</span></div><div class="ac-dim">${esc(h.desc)}</div><div class="ac-dim">需要:${h.cards.map((c) => esc(AD.CARD_BY_ID[c].name)).join("、")}</div>`;
  }
  function cardTipHtml(a) {
    const c = { id: a.dataset.cid, star: Number(a.dataset.star), bonusAtk: Number(a.dataset.ba), bonusHp: Number(a.dataset.bh) };
    const d = cardDef(c), st = unitStats(c);
    const tags = d.tags.length ? d.tags.map((t) => `<span class="tag t-${t}">${ic(TAG_ICON[t])}${tagName(t)}</span>`).join("") : `<span class="tag">${ic("store")}通用</span>`;
    return `<div class="ac-tip-h"><b>${esc(d.name)}</b><span class="ac-stars big">${stars(c.star)}</span><span class="ac-tip-rar rc-${d.cost}">${rarName(d.cost)}</span><span class="ac-tip-cost">${ic("coins")}${d.cost}</span></div>
      <div class="tag-row">${tags}</div>
      <div class="ac-dstats"><span>${ic("sword")}攻 <b>${st.atk}</b></span><span>${ic("heart")}血 <b>${st.hp}</b></span><span>${ic("zap")}速 <b>${st.spd}</b></span></div>
      <div class="ac-dtext">${esc(d.desc)}</div><div class="ac-dtext dim${c.star === 3 ? " on" : ""}">${esc(d.star3.desc)}</div>`;
  }
  function showTip(a) {
    if (!a || !g) return;
    const html = a.dataset.tip === "bond" ? bondTipHtml(a.dataset.tag) : a.dataset.tip === "hidden" ? hiddenTipHtml(a.dataset.hid) : cardTipHtml(a);
    tip.innerHTML = html; tip.classList.add("show"); tipAnchor = a;
    const r = a.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    let top = r.bottom + 8; if (top + th > vh - 8) top = Math.max(8, r.top - th - 8);
    let left = Math.min(Math.max(8, r.left + r.width / 2 - tw / 2), vw - tw - 8);
    tip.style.top = top + "px"; tip.style.left = left + "px";
  }
  function hideTip() { clearTimeout(tipTimer); clearTimeout(pressTimer); tip.classList.remove("show"); tipAnchor = null; }
  const canHover = window.matchMedia && window.matchMedia("(hover: hover)").matches;
  root.addEventListener("mouseover", (e) => {
    if (!canHover) return;
    const a = e.target.closest("[data-tip]"); if (!a || a === tipAnchor) return;
    clearTimeout(tipTimer); tipTimer = setTimeout(() => showTip(a), 140);
  });
  root.addEventListener("mouseout", (e) => {
    if (!canHover) return;
    const a = e.target.closest("[data-tip]"); if (!a || (e.relatedTarget && a.contains(e.relatedTarget))) return;
    hideTip();
  });
  root.addEventListener("contextmenu", (e) => { const a = e.target.closest("[data-tip]"); if (!a) return; e.preventDefault(); suppressUntil = Date.now() + 800; showTip(a); });
  root.addEventListener("touchstart", (e) => {
    const a = e.target.closest("[data-tip]"); clearTimeout(pressTimer); if (!a) return;
    pressTimer = setTimeout(() => { suppressUntil = Date.now() + 900; showTip(a); }, 420);
  }, { passive: true });
  ["touchend", "touchmove", "touchcancel"].forEach((n) => root.addEventListener(n, () => clearTimeout(pressTimer), { passive: true }));
  document.addEventListener("pointerdown", (e) => { if (!e.target.closest("[data-tip]")) hideTip(); });

  // ---------------- 計時 ----------------
  function startTimer() {
    stopTimer();
    if (OL) { timerId = setInterval(olTimerTick, 250); paintTimer(); return; } // 連線版:時間以伺服器為準,不在這裡自己算
    if (!timerOn) { paintTimer(); return; }
    const secs = G.prepSeconds(g.round);
    deadline = Date.now() + secs * 1000;
    timerId = setInterval(() => {
      paintTimer();
      if (Date.now() >= deadline) { stopTimer(); if (view === "prep") doSeal(true); }
    }, 250);
    paintTimer();
  }
  function stopTimer() { if (timerId) clearInterval(timerId); timerId = null; }
  function paintTimer() {
    const el = document.getElementById("ac-timer"), bar = document.getElementById("ac-timer-fill");
    if (!el) return;
    if (!timerOn) { el.textContent = "不限時"; if (bar) bar.style.width = "100%"; return; }
    const total = (OL ? OL.prepTotal : G.prepSeconds(g.round)) * 1000, left = Math.max(0, (OL ? OL.deadline : deadline) - Date.now());
    const s = Math.ceil(left / 1000);
    el.textContent = `${Math.floor(s / 60)}:${pad2(s % 60)}`;
    el.classList.toggle("urgent", s <= 8);
    if (bar) bar.style.width = (left / total * 100).toFixed(1) + "%";
  }

  // ---------------- 畫面切換 ----------------
  function render() {
    if (view === "intro") return renderIntro();
    if (view === "prep") return renderPrep();
    if (view === "battle") return renderBattleShell();
    if (view === "result") return OL ? renderResultOnline() : renderResult();
    if (view === "over") return renderOver();
  }

  function renderIntro() {
    root.innerHTML = `
      <div class="card ac-intro">
        <div class="tag-row"><span class="tag running">${ic("flask-conical")}練習模式</span><span class="tag">${ic("users")}8 人場(你 + 7 位電腦)</span><span class="tag">${ic("save-off")}不計分、不存檔</span></div>
        <h3>怎麼玩</h3>
        <ul class="ac-rules">
          <li>${ic("coins")}每輪用<b>銅板</b>買卡、刷新、升級;準備時間到(或按「完成準備」)就自動對戰。</li>
          <li>${ic("swords")}戰鬥全自動:速度快的先出手,預設打對方<b>第 1 位</b>。站位有意義:<b>先鋒</b>(第 1 位)、<b>壓軸</b>(最後一位)、<b>鄰接</b>。</li>
          <li>${ic("layers")}同名同星 2 張合成更高星,<b>3★ 要 4 張 1★</b>。同流派不同名的卡湊 2 / 4 / 6 張觸發<b>羈絆</b>。</li>
          <li>${ic("heart")}每人 100 血,輸了扣血,越後面扣越多;血量歸零淘汰,最後存活者第 1。</li>
          <li>${ic("piggy-bank")}<b>金庫</b>:結算時每持有 10 銅板多拿 1 銅板(最多 +3)。</li>
          <li>${ic("sparkles")}<b>R3 / R6 / R9</b> 各有一次「攤位加碼」三選一。</li>
        </ul>
        <label class="ac-check"><input type="checkbox" id="ac-timer-on" ${timerOn ? "checked" : ""} /> 準備階段倒數計時(每輪 ${fmtSecs(AD.prepSeconds(1))},可提前按「完成準備」)</label>
        <div class="action-row"><button class="btn" id="ac-start">${ic("play")}開始練習</button></div>
      </div>`;
    document.getElementById("ac-start").onclick = () => {
      timerOn = document.getElementById("ac-timer-on").checked;
      newGame();
    };
  }

  function newGame() {
    stopTimer(); battleToken++;
    const seed = new URLSearchParams(location.search).get("seed") || String(Math.floor(Math.random() * 1e9));
    g = G.create({ seed, name: "你" }); history = []; showLog = false; logRound = null;
    G.startRound(g);
    sel = null; view = "prep";
    render(); startTimer(); openPerkIfAny(); maybeTutorial();
  }

  // ---------------- 賽後展示:前三名最終陣容、MVP 卡、趣味獎項(階段 5)----------------
  function lineupHtml(rank, name, cards, badge) {
    if (!cards || !cards.length) return "";
    const mvp = AutochessAwards.mvpCard(cards), mi = mvp ? cards.indexOf(mvp) : -1;
    const b = E.computeBonds(cards);
    const chips = Object.keys(b.active).map((t) => `<span class="ac-bond on t-${t}">${ic(TAG_ICON[t])}${tagName(t)} ${b.active[t]}</span>`).concat(b.hidden.map((id) => `<span class="ac-bond on hidden">${ic("sparkles")}${esc(AD.HIDDEN_BONDS.find((h) => h.id === id).name)}</span>`)).join("");
    return `<div class="ac-lineup"><div class="ac-lu-h">${ic(rank === 1 ? "crown" : "medal")}<b>第 ${rank} 名・${esc(name)}</b>${badge || ""}</div>
      <div class="ac-grid" style="--cols:${cards.length}">${cards.map((c, i) => cardHtml({ ...c, bonusAtk: 0, bonusHp: 0 }, { noTip: true, data: i === mi ? 'data-mvp="1"' : "" })).join("")}</div>
      ${chips ? `<div class="ac-bonds">${chips}</div>` : ""}${mvp ? `<div class="ac-dim">${ic("star")}MVP 卡:<b>${esc(cardDef(mvp).name)} ${mvp.star}★</b>(最終陣容戰力最高)</div>` : ""}</div>`;
  }
  function awardsHtml(list) {
    if (!list.length) return "";
    return `<div class="ac-sec">${ic("party-popper")}趣味獎項</div><div class="ac-awards">${list.map((a) => `<div class="ac-award">${ic(a.icon)}<b>${a.name}</b><span>${esc(a.who)}</span><em>${esc(a.detail)}</em></div>`).join("")}</div>`;
  }

  // ---------------- 準備階段 ----------------
  function vaultHtml(me) {
    const gold = me.gold, next = Math.min(AD.INTEREST.max * AD.INTEREST.per, (Math.floor(gold / AD.INTEREST.per) + 1) * AD.INTEREST.per);
    const full = gold >= AD.INTEREST.max * AD.INTEREST.per;
    const interest = AD.interestOf(gold, g.round);
    const pctFill = Math.min(100, gold / (AD.INTEREST.max * AD.INTEREST.per) * 100);
    return `<div class="ac-vault" title="結算時每持有 10 銅板 +1(最多 +3)">
      <div class="ac-vault-top">${ic("piggy-bank")}<span>金庫 利息 <b>+${interest}</b>${full ? "(已滿)" : ` · 再存 ${next - gold} 個多 +1`}</span></div>
      <div class="ac-vault-bar"><i style="width:${pctFill}%"></i><s style="left:33.3%"></s><s style="left:66.6%"></s></div></div>`;
  }
  // 羈絆列:四個流派永遠都在,已觸發的亮起來;只放圖示 + 名字,細節(目前張數、各級效果)用浮窗看
  function bondRow(board, extra) {
    const b = E.computeBonds(board, extra);
    const have = {}; board.forEach((c) => (have[c.id] = 1));
    // 隱藏羈絆:湊齊才顯示名字;場上已有其中 2 張時先露出一個「？？？」當線索
    const hid = AD.HIDDEN_BONDS.map((h) => {
      const n = h.cards.filter((id) => have[id]).length;
      if (n === h.cards.length) return `<button class="ac-bond on hidden" data-act="bond" data-tip="hidden" data-hid="${h.id}">${ic("sparkles")}${esc(h.name)}</button>`;
      if (n >= 2) return `<button class="ac-bond part hidden" data-act="bond" data-tip="hidden" data-hid="${h.id}">${ic("circle-help")}？？？</button>`;
      return "";
    }).join("");
    return hid + Object.keys(AD.TAGS).map((t) => {
      const n = b.counts[t] || 0, on = !!b.active[t];
      return `<button class="ac-bond t-${t}${on ? " on" : n ? " part" : ""}" data-act="bond" data-tip="bond" data-tag="${t}">${ic(TAG_ICON[t])}${tagName(t)}</button>`;
    }).join("");
  }
  const RARITY_COST = [1, 2, 3, 5];
  function oddsHtml(level) {
    const row = (lv) => AD.SHOP_ODDS[lv].map((p, i) => (p ? `<span class="ac-odd rc-${RARITY_COST[i]}">${AD.RARITY[i].name} ${p}%</span>` : "")).join("");
    const next = level < AD.MAX_LEVEL ? `<div class="ac-odds next"><span class="ac-dim">升到 Lv${level + 1}:</span>${row(level + 1)}</div>` : "";
    return `<div class="ac-odds"><span class="ac-dim">Lv${level} 出現機率:</span>${row(level)}</div>${next}`;
  }
  function logLinesHtml(lines) { return lines.map((l) => `<div class="ac-ll ${l.k}">${esc(l.text)}</div>`).join(""); }
  function logCardHtml() {
    if (!history.length) return "";
    const cur = history.find((h) => h.round === logRound) || history[history.length - 1];
    const tabs = history.map((h) => `<button class="ac-logtab${h === cur ? " on" : ""} ${h.res}" data-act="logsel" data-r="${h.round}">R${h.round}</button>`).join("");
    return `<div class="card ac-logcard"><div class="ac-sec">${ic("scroll-text")}戰報<button class="btn ghost ac-mini-btn" data-act="logtoggle" style="margin-left:auto;">${ic(showLog ? "chevron-up" : "chevron-down")}${showLog ? "收合" : "展開"}</button></div>
      ${showLog ? `<div class="ac-logtabs">${tabs}</div><div class="ac-loghead">R${cur.round} ${cur.res === "win" ? "勝利" : cur.res === "lose" ? "落敗" : "平手"} · 對手 ${esc(cur.foe)}</div><div class="ac-logbox">${logLinesHtml(cur.lines)}</div>` : `<div class="ac-dim">看回前幾輪的戰鬥過程(共 ${history.length} 場)</div>`}</div>`;
  }
  function perkChips(me) {
    const p = me.perks, out = me.perkPicks.map((id) => {
      const pk = AD.PERK_BY_ID[id]; let extra = "";
      if (id === "free_refresh") extra = ` ×${p.freeRefresh}`;
      if (id === "xp_coupon") extra = ` ×${p.xpCoupon}`;
      if (id === "good_rapport") extra = ` ×${p.goodRapport}`;
      if (id === "streak_guard") extra = p.streakGuard ? "" : "(已用)";
      return `<span class="tag">${ic(pk.icon)}${esc(pk.name)}${extra}</span>`;
    });
    return out.join("");
  }

  function renderPrep() {
    hideTip();
    if (sfxRound !== g.round) { sfxRound = g.round; sfx("bell"); }
    const me = g.me, slots = G.slotsOf(me), cost = G.refreshCost(me);
    const needXp = me.level < AD.MAX_LEVEL ? AD.XP_TO_LEVEL[me.level + 1] : 0;
    const xpCost = Math.max(0, AD.BUY_XP.cost - (me.perks.xpCoupon > 0 ? AD.PERK_BY_ID.xp_coupon.off : 0));
    const boardCells = [];
    for (let i = 0; i < slots; i++) {
      const c = me.board[i];
      if (c) boardCells.push(cardHtml(c, { sel: sel && sel.zone === "board" && sel.idx === i, data: `data-act="own" data-zone="board" data-i="${i}"`, pos: i === 0 ? "先" : i === me.board.length - 1 ? "壓" : "" }));
      else boardCells.push(`<button class="ac-slot" data-act="slot" data-zone="board" data-i="${i}">${i === 0 ? "先鋒" : ""}</button>`);
    }
    const benchCells = [];
    for (let i = 0; i < AD.BENCH_SLOTS; i++) {
      const c = me.bench[i];
      benchCells.push(c ? cardHtml(c, { sel: sel && sel.zone === "bench" && sel.idx === i, data: `data-act="own" data-zone="bench" data-i="${i}"` }) : `<button class="ac-slot" data-act="slot" data-zone="bench" data-i="${i}"></button>`);
    }
    const shopCells = me.shop.map((id, i) => (id ? cardHtml({ id, star: 1 }, { mode: "shop", data: `data-act="shop" data-i="${i}"`, dim: me.gold < AD.CARD_BY_ID[id].cost }) : `<div class="ac-slot empty"></div>`)).join("");
    const pp = me.pendingPerk;
    root.innerHTML = `
      <div class="ac-top">
        <div class="ac-top-row">
          <span class="tag running">${OL ? ic("swords") + "正式場" : ic("flask-conical") + "練習模式"}</span>
          <span class="ac-round">R${g.round} 準備</span>
          <span class="ac-timer" id="ac-timer">--</span>
          <button class="btn ghost ac-mini-btn" id="ac-help" title="新手教學">${ic("circle-help")}</button>
          <button class="btn ghost ac-mini-btn" id="ac-sound" title="音效開關">${ic(window.AutochessSfx && AutochessSfx.isMuted() ? "volume-x" : "volume-2")}</button>
          ${OL ? "" : `<button class="btn ghost ac-mini-btn" id="ac-restart">${ic("rotate-ccw")}重來</button>`}
        </div>
        <div class="timer-bar"><div id="ac-timer-fill" style="width:100%"></div></div>
        <div class="ac-stats">
          <span class="ac-stat">${ic("heart")}<b>${me.hp}</b></span>
          <span class="ac-stat gold">${ic("coins")}<b>${me.gold}</b></span>
          <span class="ac-stat">${ic("flame")}連勝 <b>${me.streak}</b></span>
          <span class="ac-stat">${ic("chevrons-up")}Lv<b>${me.level}</b>${me.level < AD.MAX_LEVEL ? ` <em>${me.xp}/${needXp}</em>` : " 滿級"}</span>
        </div>
        ${vaultHtml(me)}
      </div>
      <div class="ac-msg" id="ac-msg"></div>
      ${pp ? `<button class="btn ac-perk-btn" id="ac-perk-open">${ic("sparkles")}攤位加碼 第 ${pp.n} 次:選一張(封板前沒選會隨機替你選)</button>` : ""}
      ${me.perkPicks.length ? `<div class="tag-row ac-perks">${perkChips(me)}</div>` : ""}
      <div class="card ac-board-card">
        <div class="ac-bondrow">${bondRow(me.board, G.extraFor(me))}</div>
        <div class="ac-sec">${ic("swords")}上陣 <em>${me.board.length}/${slots}</em><span class="ac-hint">第 1 位先鋒・最後一位壓軸</span><button class="btn ghost ac-mini-btn" data-act="autoarrange" title="依先鋒/壓軸/鄰接效果自動排">${ic("wand-sparkles")}自動排站位</button></div>
        <div class="ac-grid" style="--cols:${slots}">${boardCells.join("")}</div>
        <div class="ac-sec">${ic("archive")}待命席 <em>${me.bench.length}/${AD.BENCH_SLOTS}</em></div>
        <div class="ac-grid" style="--cols:${AD.BENCH_SLOTS}">${benchCells.join("")}</div>
        <div id="ac-detail" class="ac-detail"></div>
      </div>
      <div class="card ac-shop-card">
        <div class="ac-sec">${ic("store")}商店${me.shopLocked ? ` <span class="tag running">${ic("lock")}已鎖定</span>` : ""}<span class="ac-hint">${canHover ? "滑鼠移到卡上看說明" : "長按卡片看說明"}・點一下購買</span></div>
        ${oddsHtml(me.level)}
        <div class="ac-grid shop" style="--cols:${me.shop.length}">${shopCells}</div>
        <div class="ac-actions">
          <button class="btn ghost" data-act="refresh">${ic("refresh-cw")}刷新 ${cost ? cost : "免費"}</button>
          <button class="btn ghost" data-act="lock">${ic(me.shopLocked ? "lock-open" : "lock")}${me.shopLocked ? "解鎖" : "鎖定"}</button>
          <button class="btn ghost" data-act="xp"${me.level >= AD.MAX_LEVEL ? " disabled" : ""}>${ic("chevrons-up")}買經驗 ${xpCost}</button>
          <button class="btn ghost" data-act="undo"${me.undo ? "" : " disabled"}>${ic("undo-2")}撤銷購買</button>
        </div>
      </div>
      ${logCardHtml()}
      ${OL ? `<div class="ac-dim ac-seal-note">${ic("clock")}時間到自動封板(沒選的加碼會替你選、空位會自動補上)</div>` : `<div class="action-row ac-seal"><button class="btn block" id="ac-seal">${ic("swords")}完成準備,開始對戰</button></div>`}`;
    renderDetail();
    paintTimer();
    if (msg) setMsg(msg.text, msg.tone);
    const rs = document.getElementById("ac-restart"); if (rs) rs.onclick = restart;
    const hp = document.getElementById("ac-help"); if (hp) hp.onclick = () => openTutorial(0);
    const sd = document.getElementById("ac-sound"); if (sd) sd.onclick = () => { AutochessSfx.setMuted(!AutochessSfx.isMuted()); sfx("bell"); renderPrep(); };
    const sl = document.getElementById("ac-seal"); if (sl) sl.onclick = () => doSeal(false);
    const po = document.getElementById("ac-perk-open"); if (po) po.onclick = openPerkIfAny;
  }

  function renderDetail() {
    const el = document.getElementById("ac-detail"); if (!el) return;
    const me = g.me;
    if (!sel) { el.innerHTML = `<div class="ac-dim">點一張卡看說明與賣出;再點另一格就能移動 / 交換位置。點商店的卡直接購買。</div>`; return; }
    const arr = sel.zone === "board" ? me.board : me.bench, c = arr[sel.idx];
    if (!c) { sel = null; el.innerHTML = ""; return; }
    const d = cardDef(c), st = unitStats(c), sellV = AD.sellValue(d, c.star);
    const tags = d.tags.length ? d.tags.map((t) => `<span class="tag t-${t}">${ic(TAG_ICON[t])}${tagName(t)}</span>`).join("") : `<span class="tag">${ic("store")}通用</span>`;
    el.innerHTML = `
      <div class="ac-dhead"><b>${esc(d.name)}</b> <span class="ac-stars big">${stars(c.star)}</span><span class="tag-row">${tags}<span class="tag">${ic("coins")}${d.cost} 費</span></span></div>
      <div class="ac-dstats"><span>${ic("sword")}攻 <b>${st.atk}</b></span><span>${ic("heart")}血 <b>${st.hp}</b></span><span>${ic("zap")}速 <b>${st.spd}</b></span>${c.bonusAtk ? `<span class="ac-dim">(加料 +${c.bonusAtk}/+${c.bonusHp})</span>` : ""}</div>
      <div class="ac-dtext">${esc(d.desc)}</div>
      <div class="ac-dtext dim${c.star === 3 ? " on" : ""}">${esc(d.star3.desc)}</div>
      <div class="ac-dim">效果數值:2★ ×1.5、3★ ×2;屬性:2★ ×1.8、3★ ×3.5</div>
      <div class="action-row">
        <button class="btn ghost" data-act="toggle">${ic(sel.zone === "board" ? "arrow-down" : "arrow-up")}${sel.zone === "board" ? "下場" : "上陣"}</button>
        <button class="btn ghost outline-danger" data-act="sell">${ic("trash-2")}賣出 +${sellV}</button>
        <button class="btn ghost" data-act="desel">${ic("x")}取消</button>
      </div>`;
  }

  // ---------------- 準備階段的點擊 ----------------
  root.addEventListener("click", async (e) => {
    if (Date.now() < suppressUntil) return; // 長按看說明放開手指時,不要當成點擊(不會誤買)
    const b = e.target.closest("[data-act]"); if (!b || view !== "prep") return;
    const act = b.dataset.act, me = g.me, i = Number(b.dataset.i), zone = b.dataset.zone;
    let r = null;
    if (act === "shop") { r = G.buy(g, i); if (r.ok) { sel = null; if (r.merged.length) setMsg("合成!" + r.merged.map((m) => `${cardDef(m).name} ${m.star}★`).join("、"), "good"); } }
    else if (act === "own") {
      if (sel && !(sel.zone === zone && sel.idx === i)) { r = G.move(g, sel, { zone, idx: i }); if (r.ok) sel = null; }
      else sel = sel && sel.zone === zone && sel.idx === i ? null : { zone, idx: i };
    }
    else if (act === "slot") { if (sel) { r = G.move(g, sel, { zone, idx: i }); if (r.ok) sel = null; } }
    else if (act === "bond") { if (tipAnchor === b) hideTip(); else showTip(b); return; }
    else if (act === "logtoggle") showLog = !showLog;
    else if (act === "logsel") logRound = Number(b.dataset.r);
    else if (act === "desel") sel = null;
    else if (act === "toggle" && sel) { r = G.move(g, sel, { zone: sel.zone === "board" ? "bench" : "board", idx: 99 }); if (r.ok) sel = null; }
    else if (act === "sell" && sel) {
      const c = (sel.zone === "board" ? me.board : me.bench)[sel.idx];
      if (c && c.star >= 3) { const ok = await ui.confirm(`「${cardDef(c).name}」是 3★(合了 4 張),確定要賣掉嗎?`, { title: "賣出 3★ 卡", confirmText: "賣出", tone: "danger" }); if (!ok) return; }
      r = G.sell(g, sel.zone, sel.idx); if (r.ok) { setMsg(`賣出,+${r.value} 銅板`); sel = null; }
    }
    else if (act === "refresh") r = G.refresh(g);
    else if (act === "lock") r = G.toggleLock(g);
    else if (act === "xp") r = G.buyXp(g);
    else if (act === "undo") { r = G.undo(g); if (r.ok) setMsg("已撤銷上一次購買,全額退費"); }
    else if (act === "autoarrange") { r = G.autoArrange(g); if (r.ok) { sel = null; setMsg(r.changed ? "已依先鋒/壓軸/鄰接效果重新排好(不滿意可以再手動調整)" : "現在的排法已經是最適合的了"); } }
    if (r && !r.ok) setMsg(r.msg, "bad");
    if (OL && r && r.ok) persist(); // 連線版:每次操作立刻整批存檔
    renderPrep();
  });

  async function restart() {
    const ok = await ui.confirm("重新開始會放棄目前的對局,確定嗎?", { title: "重新開始", confirmText: "重新開始", tone: "question" });
    if (ok) newGame();
  }

  // ---------------- 攤位加碼(彈窗)----------------
  const modal = document.getElementById("ac-modal"), modalCard = document.getElementById("ac-modal-card");
  function closeModal() { modal.classList.remove("show"); }
  // 新手教學:5 頁,練習模式第一次進來自動跳出,之後準備畫面的 ? 鈕可以重看
  const TUTORIAL = [
    { icon: "store", title: "1. 買卡", body: "每輪先有一段準備時間。點商店裡的卡就能買(花銅板),不喜歡可以「刷新」,喜歡的先「鎖定」留到下一輪。買到的卡先進待命席,點一下再點場上的位置就能上陣。" },
    { icon: "swords", title: "2. 站位很重要", body: "場上從左到右排成一排:第 1 位是「先鋒」,最先挨打;最後一位是「壓軸」。很多卡的效果看站位,例如「先鋒:獲得護盾」「鄰接:替左右友軍加攻擊」。不想自己想,按「自動排站位」。" },
    { icon: "flame", title: "3. 流派羈絆與升星", body: "同一個流派的卡湊到 2 / 4 / 6 張(要不同名字)會啟動羈絆,整隊變強。兩張同名同星會自動合成更高星,3★ 還會多一個質變效果。有些特定幾張卡湊在一起,會觸發隱藏羈絆……" },
    { icon: "piggy-bank", title: "4. 銅板與升級", body: "每輪結算有基本收入;贏了多拿、連勝再加。手上存的銅板每 10 個多 +1 利息(最多 +3)。買經驗可以升級,等級越高能上陣的卡越多、商店出好卡的機率也越高。" },
    { icon: "heart", title: "5. 對戰與淘汰", body: "時間到(或按「完成準備」)就會封板,雙方陣容自動對打,不用操作。輸了扣血,血量歸零就淘汰,最後留下的是棋王。第 3、6、9 輪有「攤位加碼」三選一,沒選會替你隨機選。" },
  ];
  function openTutorial(i) {
    const st = TUTORIAL[i];
    modalCard.innerHTML = `<div class="ac-tut"><div class="ac-tut-h">${ic(st.icon)}<b>${st.title}</b><span class="ac-dim">${i + 1}/${TUTORIAL.length}</span></div><p>${esc(st.body)}</p>
      <div class="action-row"><button class="btn ghost" id="ac-tut-skip">${i === TUTORIAL.length - 1 ? "關閉" : "跳過"}</button>${i > 0 ? `<button class="btn ghost" id="ac-tut-prev">上一頁</button>` : ""}${i < TUTORIAL.length - 1 ? `<button class="btn" id="ac-tut-next">下一頁</button>` : `<button class="btn" id="ac-tut-done">開始玩</button>`}</div></div>`;
    modal.classList.add("show");
    const done = () => { try { localStorage.setItem("ac_tutorial_done", "1"); } catch (e) { /* ignore */ } closeModal(); };
    document.getElementById("ac-tut-skip").onclick = done;
    const nx = document.getElementById("ac-tut-next"); if (nx) nx.onclick = () => openTutorial(i + 1);
    const pv = document.getElementById("ac-tut-prev"); if (pv) pv.onclick = () => openTutorial(i - 1);
    const dn = document.getElementById("ac-tut-done"); if (dn) dn.onclick = done;
  }
  function maybeTutorial() { try { if (!OL && !localStorage.getItem("ac_tutorial_done")) openTutorial(0); } catch (e) { /* ignore */ } }
  function openPerkIfAny() {
    const pp = g && g.me.pendingPerk;
    if (!pp || view !== "prep") return;
    const opts = pp.candidates.map((id) => {
      const pk = AD.PERK_BY_ID[id];
      return `<button class="ac-perk-opt" data-perk="${id}">${ic(pk.icon, { size: "22px" })}<span><b>${esc(pk.name)}</b><em class="tag">${AD.PERK_CATS[pk.cat]}</em><small>${esc(pk.desc)}</small></span></button>`;
    }).join("");
    modalCard.innerHTML = `<h3>${ic("sparkles")}攤位加碼 第 ${pp.n} 次(R${AD.PERK_ROUNDS[pp.n - 1]})</h3><p class="ac-dim">三選一。封板前沒選,系統會隨機替你選一張。</p><div class="ac-perk-list">${opts}</div><button class="btn ghost block" id="ac-perk-later">${ic("clock")}先看看棋盤,稍後再選</button>`;
    modal.classList.add("show");
    modalCard.querySelectorAll("[data-perk]").forEach((b) => (b.onclick = () => choosePerk(b.dataset.perk)));
    document.getElementById("ac-perk-later").onclick = closeModal;
  }
  function choosePerk(id) {
    const pk = AD.PERK_BY_ID[id];
    if (!pk.target) return applyPerk(id, null);
    const ts = G.targetsFor(g, id);
    let body;
    if (pk.target === "tag") body = `<div class="ac-target-tags">${ts.map((t) => `<button class="btn ghost" data-t="${t.tag}">${ic(TAG_ICON[t.tag])}${tagName(t.tag)}</button>`).join("")}</div>`;
    else body = `<div class="ac-grid" style="--cols:5">${ts.map((t, k) => cardHtml(t.card, { data: `data-t="${k}"` })).join("")}</div>`;
    modalCard.innerHTML = `<h3>${ic(pk.icon)}${esc(pk.name)}</h3><p class="ac-dim">${esc(pk.desc)}<br>${pk.target === "tag" ? "選擇流派:" : "選擇一張卡:"}</p>${body}<button class="btn ghost block" id="ac-perk-back" style="margin-top:12px;">${ic("arrow-left")}回上一步</button>`;
    modalCard.querySelectorAll("[data-t]").forEach((b) => (b.onclick = () => applyPerk(id, pk.target === "tag" ? { tag: b.dataset.t } : ts[Number(b.dataset.t)])));
    document.getElementById("ac-perk-back").onclick = openPerkIfAny;
  }
  function applyPerk(id, target) {
    const r = G.pickPerk(g, id, target);
    if (!r.ok) { setMsg(r.msg, "bad"); return; }
    closeModal(); sel = null; setMsg(`選了「${r.perk.name}」`, "good"); if (OL) persist(); renderPrep();
  }

  // ---------------- 封板與戰鬥演出 ----------------
  function doSeal(auto) {
    if (view !== "prep") return;
    stopTimer(); closeModal();
    const r = G.seal(g);
    if (!r.ok) { setMsg(r.msg, "bad"); return; }
    sel = null; view = "battle";
    playBattle(g.report, auto);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function renderBattleShell() { /* 由 playBattle 自己畫 */ }

  function bstateFrom(init) {
    const mk = (u) => ({ ...u, shield: 0, burn: 0, poison: 0, frozen: 0, dead: false, flash: "" });
    return { a: init.a.map(mk), b: init.b.map(mk) };
  }
  function battleRowHtml(units, isMe) {
    return units.map((u) => {
      const d = AD.CARD_BY_ID[u.id], t0 = d.tags[0] || "none", pct = Math.max(0, u.hp / u.maxHp * 100);
      const stat = (u.burn ? `<span class="bs burn">${ic("flame")}${u.burn}</span>` : "") + (u.frozen ? `<span class="bs frost">${ic("snowflake")}</span>` : "") + (u.poison ? `<span class="bs potion">${ic("skull")}${u.poison}</span>` : "") + (u.shield ? `<span class="bs guard">${ic("shield")}${u.shield}</span>` : "");
      return `<div class="ac-bunit ${u.dead ? "dead" : ""} ${u.flash}"><div class="ac-card mini t-${t0} r-${d.cost} s-${u.star}"><span class="ac-cost">${d.cost}</span><span class="ac-stars">${stars(u.star)}</span>${ic(TAG_ICON[t0] || "store", { cls: "ac-ticon" })}<b class="ac-name">${esc(d.name.slice(0, 2))}</b><span class="ac-st">${u.atk}</span></div><div class="ac-hpbar"><i style="width:${pct}%"></i></div><div class="ac-hpnum">${Math.max(0, u.hp)}</div><div class="ac-bstat">${stat}</div></div>`;
    }).join("");
  }

  // 把一個引擎事件套用到演出狀態 bs,回傳 { text, side, delay, flashTag, flash }(文字同時是戰報的一行)
  function applyEvent(ev, bs, nameOf, mySide) {
    const u = (tag) => bs[tag[0]][Number(tag.slice(1))], sideOf = (tag) => (tag[0] === mySide ? "my" : "foe");
    switch (ev.t) {
      case "round": return { text: `第 ${ev.n} 回合`, side: "round", delay: 350, round: ev.n };
      case "atk": return { text: `${nameOf(ev.from)} 攻擊 ${nameOf(ev.to)}${ev.crit ? "(暴擊!)" : ""}`, side: sideOf(ev.from), delay: 450, flashTag: ev.from, flash: "atk" };
      case "dmg": {
        const t = u(ev.to); t.shield = Math.max(0, t.shield - (ev.ab || 0)); t.hp -= ev.n;
        if (ev.kind === "burn") t.burn = Math.max(0, t.burn - 1);
        const text = ev.kind === "poison" ? `${nameOf(ev.to)} 中毒 -${ev.n}` : ev.kind === "fx" ? `${nameOf(ev.to)} 受到效果傷害 -${ev.n}` : ev.kind === "burn" ? `${nameOf(ev.to)} 灼傷 -${ev.n}` : ev.kind === "bell" ? `打烊鐘!${nameOf(ev.to)} -${ev.n}` : ev.kind === "reflect" ? `${nameOf(ev.to)} 受到反彈 -${ev.n}` : `${nameOf(ev.to)} -${ev.n}${ev.ab ? `(護盾吸收 ${ev.ab})` : ""}`;
        return { text, side: sideOf(ev.to), delay: 380, flashTag: ev.to, flash: "hit" };
      }
      case "die": u(ev.to).dead = true; return { text: `${nameOf(ev.to)} 被擊敗`, side: sideOf(ev.to), delay: 480 };
      case "burn": u(ev.to).burn += ev.n; return { text: `${nameOf(ev.to)} 灼傷 +${ev.n} 層`, side: sideOf(ev.to), delay: 220 };
      case "freeze": u(ev.to).frozen = 1; return { text: `${nameOf(ev.to)} 被凍結`, side: sideOf(ev.to), delay: 300 };
      case "skip": u(ev.from).frozen = 0; return { text: `${nameOf(ev.from)} 凍結中,跳過行動`, side: sideOf(ev.from), delay: 300 };
      case "shield": u(ev.to).shield += ev.n; return { text: `${nameOf(ev.to)} 獲得 ${ev.n} 點護盾`, side: sideOf(ev.to), delay: 200 };
      case "buff": {
        const t = u(ev.to); t.atk += ev.atk || 0; if (ev.hp) { t.maxHp += ev.hp; t.hp += ev.hp; }
        const bits = (ev.atk ? [`攻擊 ${ev.atk > 0 ? "+" : ""}${ev.atk}`] : []).concat(ev.hp ? [`血量上限 +${ev.hp}`] : []);
        return { text: `${nameOf(ev.to)} ${bits.join("、")}`, side: sideOf(ev.to), delay: 200 };
      }
      case "poison": u(ev.to).poison = Math.min(6, u(ev.to).poison + ev.n); return { text: `${nameOf(ev.to)} 中毒 +${ev.n} 層`, side: sideOf(ev.to), delay: 220 };
      case "heal": { const t = u(ev.to); t.hp = Math.min(t.maxHp, t.hp + ev.n); return { text: `${nameOf(ev.to)} 回復 ${ev.n} 點血量`, side: sideOf(ev.to), delay: 220 }; }
      case "revive": { const t = u(ev.to); t.hp = ev.n; t.burn = 0; t.poison = 0; t.frozen = 0; t.dead = false; return { text: `${nameOf(ev.to)} 復活!(${ev.n} 血)`, side: sideOf(ev.to), delay: 480 }; }
      case "bell": return { text: `打烊鐘響起:全體受到遞增傷害`, side: "round", delay: 350 };
      default: return null;
    }
  }

  async function playBattle(rep, auto, budgetMs, replay) {
    const token = ++battleToken, mine = rep.mine, mySide = mine.side, foeSide = mySide === "a" ? "b" : "a";
    const bs = bstateFrom(mine.r.init), events = mine.r.events || [];
    const foeName = mine.ghost ? `幽靈(${mine.foe.name} 的陣容)` : mine.foe.name;
    const mkNameOf = (b) => (tag) => (tag[0] === mySide ? "我方" : "敵方") + AD.CARD_BY_ID[b[tag[0]][Number(tag.slice(1))].id].name;
    const nameOf = mkNameOf(bs);
    // 連線版的戰鬥只有 25 秒:先空跑一遍算出總演出時間,太長就自動加速(玩家按的 x1/x2/x4 與跳過照常有效)
    let autoFactor = 1;
    if (budgetMs) {
      const dry = bstateFrom(mine.r.init), nd = mkNameOf(dry); let total = 1600;
      for (const ev of events) { const r = applyEvent(ev, dry, nd, mySide); if (r) total += r.delay; }
      autoFactor = Math.max(1, total / Math.max(4000, budgetMs - 1500));
    }
    const spd = () => battleSpeed * autoFactor;
    const stale = () => token !== battleToken || (replay && view !== "battle"); // 重播時,如果已經換到別的畫面(下一輪開始了)就停手
    if (replay) view = "battle"; else sfx("seal");
    const bondLine = (side) => { const b = side === mySide ? (mySide === "a" ? mine.r.bondsA : mine.r.bondsB) : (mySide === "a" ? mine.r.bondsB : mine.r.bondsA); return Object.keys(b).map((t) => `<span class="ac-bond on t-${t}">${ic(TAG_ICON[t])}${tagName(t)} ${b[t]}</span>`).join("") || `<span class="ac-dim">沒有羈絆</span>`; };
    const lines = [], entry = { round: rep.round, res: mine.res, foe: foeName, lines };
    history = history.filter((h) => h.round !== rep.round).concat(entry); logRound = rep.round;
    root.innerHTML = `
      <div class="ac-top"><div class="ac-top-row"><span class="tag running">${OL ? ic("swords") + "正式場" : ic("flask-conical") + "練習模式"}</span><span class="ac-round">R${rep.round} 戰鬥</span><span class="ac-timer" id="ac-bround">第 1 回合</span></div>
        <div class="ac-top-row" style="margin-top:8px;"><span class="ac-dim">演出速度</span><span class="ac-speed">${[1, 2, 4].map((n) => `<button class="btn ghost ac-mini-btn ac-sp" data-sp="${n}">x${n}</button>`).join("")}<button class="btn ghost ac-mini-btn" id="ac-skip">${ic("skip-forward")}跳過</button></span></div></div>
      <div class="card ac-battle">
        <div class="ac-bname">${ic("user")}${esc(foeName)}${mine.foe.badge || ""}</div><div class="ac-bonds">${bondLine(foeSide)}</div>
        <div id="ac-bfield"></div>
        <div class="ac-blog" id="ac-blog"></div>
        <div class="ac-bonds">${bondLine(mySide)}</div><div class="ac-bname me">${ic("user-round")}你</div>
      </div>
      <div class="card ac-logcard"><div class="ac-sec">${ic("scroll-text")}戰報<span class="ac-hint">可以往上捲回頭看</span></div><div class="ac-logbox" id="ac-logbox"></div></div>`;
    const fieldEl = document.getElementById("ac-bfield"), blogEl = document.getElementById("ac-blog"), boxEl = document.getElementById("ac-logbox"), roundEl = document.getElementById("ac-bround");
    let skipped = false;
    const paintSpeed = () => root.querySelectorAll(".ac-sp").forEach((b) => b.classList.toggle("active", Number(b.dataset.sp) === battleSpeed));
    root.querySelectorAll(".ac-sp").forEach((b) => (b.onclick = () => { battleSpeed = Number(b.dataset.sp); paintSpeed(); }));
    document.getElementById("ac-skip").onclick = () => { skipped = true; };
    paintSpeed();
    const draw = () => { // 只重畫戰場,速度鈕與戰報不會被洗掉
      fieldEl.innerHTML = `<div class="ac-brow" style="--cols:${bs[foeSide].length}">${battleRowHtml(bs[foeSide], false)}</div><div class="ac-gap"></div><div class="ac-brow" style="--cols:${bs[mySide].length}">${battleRowHtml(bs[mySide], true)}</div>`;
    };
    const addLine = (k, text) => {
      const l = { k, text }; lines.push(l);
      const atBottom = boxEl.scrollHeight - boxEl.scrollTop - boxEl.clientHeight < 40;
      const d = document.createElement("div"); d.className = "ac-ll " + k; d.textContent = text; boxEl.appendChild(d);
      if (atBottom) boxEl.scrollTop = boxEl.scrollHeight;
    };
    const say = (t) => { blogEl.textContent = t; };
    say(auto ? "時間到,自動封板!" : "對戰開始"); addLine("sys", auto ? "時間到,自動封板" : "對戰開始");
    draw();
    await sleep(700 / spd());
    for (const ev of events) {
      if (stale()) return;
      const r = applyEvent(ev, bs, nameOf, mySide);
      if (!r) continue;
      if (r.round) roundEl.textContent = `第 ${r.round} 回合`;
      addLine(r.side === "round" ? "round" : r.side, r.side === "round" ? `— ${r.text} —` : r.text);
      if (skipped) continue;
      say(r.text);
      if (r.flashTag) bs[r.flashTag[0]][Number(r.flashTag.slice(1))].flash = r.flash;
      draw();
      await sleep(r.delay / spd());
      if (r.flashTag) bs[r.flashTag[0]][Number(r.flashTag.slice(1))].flash = "";
    }
    if (stale()) return;
    const res = mine.res, endText = res === "win" ? "你贏了!" : res === "lose" ? "你輸了…" : "平手";
    say(endText); addLine("sys", `結果:${endText}`); draw();
    sfx(res === "win" ? "win" : res === "lose" ? "lose" : "seal");
    await sleep(skipped ? 300 : 900 / spd());
    if (stale()) return;
    view = "result"; render();
  }

  // ---------------- 結算卡 ----------------
  function renderResult() {
    const rep = g.report, m = rep.mine, me = g.me, e = m.eco;
    const res = m.res, title = res === "win" ? "勝利" : res === "lose" ? "落敗" : "平手";
    const tone = res === "win" ? "good" : res === "lose" ? "bad" : "info";
    const rows = [];
    rows.push(["基本收入", `+${e.base}`]);
    if (e.win) rows.push(["勝利獎金", `+${e.win}`]);
    if (e.streakBonus) rows.push([`連勝 ${e.streak} 場加成`, `+${e.streakBonus}`]);
    if (e.interest) rows.push(["金庫利息", `+${e.interest}`]);
    if (e.bonusCoins) rows.push(["暴擊 / 加碼獎勵", `+${e.bonusCoins}`]);
    const ranking = G.ranking(g).map((p) => `<li class="${p.human ? "me" : ""}${p.alive ? "" : " dead"}"><span>${esc(p.name)}</span><span class="ac-hpb"><i style="width:${Math.max(0, p.hp)}%"></i></span><b>${p.alive ? Math.max(0, p.hp) : "淘汰"}</b></li>`).join("");
    const notes = [];
    if (m.insured) notes.push("連勝保險生效,連勝沒有中斷");
    if (rep.autoPicked) notes.push(`時間到,系統替你選了加碼「${rep.autoPicked.name}」`);
    if (rep.filled) notes.push(`系統把待命席的 ${rep.filled} 張卡補上場`);
    root.innerHTML = `
      <div class="card ac-result ${tone}">
        <div class="ac-rtitle">${ic(res === "win" ? "trophy" : res === "lose" ? "swords" : "equal")}<b>R${rep.round} ${title}</b></div>
        ${res === "lose" ? `<div class="ac-rline bad">${ic("heart-crack")}扣血 -${m.dmg}(血量 ${m.hpBefore} → ${me.hp})</div>` : `<div class="ac-rline">${ic("heart")}血量 ${me.hp}</div>`}
        <table class="ac-eco">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}<tr class="sum"><td>本輪獲得</td><td>+${e.gain} 銅板</td></tr></table>
        <div class="ac-rline">${ic("coins")}銅板 ${m.goldBefore} → <b>${me.gold}</b> ${ic("flame")}連勝 <b>${me.streak}</b></div>
        ${m.eliminated ? `<div class="ac-rline bad">${ic("skull")}你被淘汰了</div>` : ""}
        ${notes.map((n) => `<div class="ac-rline dim">${ic("info")}${esc(n)}</div>`).join("")}
        <div class="ac-sec">${ic("scroll-text")}本輪戰報</div>
        <div class="ac-logbox">${logLinesHtml((history.find((h) => h.round === rep.round) || { lines: [] }).lines)}</div>
        <div class="ac-sec">${ic("users")}全場血量</div>
        <ul class="ac-rank">${ranking}</ul>
        <div class="action-row"><button class="btn ghost" id="ac-replay">${ic("rotate-ccw")}重播這場戰鬥</button><button class="btn block" id="ac-next">${ic(g.over ? "trophy" : "arrow-right")}${g.over ? "查看總結" : `進入 R${g.round + 1}`}</button></div>
      </div>`;
    document.getElementById("ac-replay").onclick = () => playBattle(rep, false, 0, true);
    document.getElementById("ac-next").onclick = () => {
      if (g.over) { view = "over"; render(); return; }
      G.nextRound(g); sel = null; view = "prep"; render(); startTimer(); openPerkIfAny();
    };
  }

  // ---------------- 總結 ----------------
  function renderOver() {
    const s = G.stats(g), top = s.rank === 1;
    if (!g.overSfx) { g.overSfx = true; sfx(top ? "champ" : "out"); }
    const lineups = g.finalRanking.slice(0, 3).map((p) => lineupHtml(p.rank, p.name + (p.human ? "(你)" : ""), p.board)).join("");
    const awards = awardsHtml(AutochessAwards.awards(g.finalRanking.map((p) => ({ player_id: p.name, name: p.name, final_rank: p.rank, state: { board: p.board, bench: p.bench, bestStreak: p.bestStreak } }))));
    root.innerHTML = `
      <div class="card ac-result ${top ? "good" : ""}">
        <div class="ac-rtitle">${ic(top ? "crown" : "flag")}<b>${top ? "你是夜市棋王!" : `第 ${s.rank} 名`}</b></div>
        <div class="tag-row"><span class="tag">${ic("flask-conical")}練習模式:不計分、不給稱號</span></div>
        <table class="ac-eco">
          <tr><td>撐到</td><td>R${s.rounds}</td></tr><tr><td>勝 / 敗</td><td>${s.wins} / ${s.losses}</td></tr>
          <tr><td>最長連勝</td><td>${s.bestStreak}</td></tr><tr><td>最高等級</td><td>Lv${s.level}</td></tr>
          <tr><td>合成出 3★</td><td>${s.threeStar} 次</td></tr>
          <tr><td>選過的加碼</td><td>${s.perks.length ? s.perks.map((id) => esc(AD.PERK_BY_ID[id].name)).join("、") : "沒有"}</td></tr>
        </table>
        <div class="ac-sec">${ic("trophy")}前三名最終陣容</div>${lineups}${awards}
        <div class="ac-sec">${ic("list-ordered")}最終名次</div>
        <ol class="ac-rank final">${g.finalRanking.map((p) => `<li class="${p.human ? "me" : ""}"><span>${esc(p.name)}</span><b>${p.elimRound ? "R" + p.elimRound + " 淘汰" : "存活"}</b></li>`).join("")}</ol>
        <div class="action-row"><button class="btn" id="ac-again">${ic("rotate-ccw")}再玩一場</button><a class="btn ghost" href="index.html">${ic("arrow-left")}回活動列表</a></div>
      </div>`;
    document.getElementById("ac-again").onclick = newGame;
  }

  // ======================================================================
  // 連線版(正式場)
  //   伺服器(autochess_clock)決定現在是第幾輪、哪個階段;這裡每秒問一次,再依階段做事:
  //   倒數 → 初始化存檔 / 準備 → 補跑輪次、存檔、時間到封板 / 戰鬥+結算 → 配對、算戰鬥、送結算、演出 / 結束 → 名次與獎勵
  //   淘汰者、非參賽者進「觀戰」。任何在線的人(含觀戰)都會幫忙推進配對與結算,所以個別玩家斷線不會卡住全場。
  // ======================================================================
  const PHASE_NAME = { countdown: "倒數", prep: "準備", battle: "戰鬥", result: "結算" };
  const olSortRows = (rows) => rows.slice().sort((a, b) => {
    if (a.final_rank != null && b.final_rank != null) return a.final_rank - b.final_rank;
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) return (b.hp - a.hp) || (b.wins - a.wins);
    return ((b.eliminated_round || 0) - (a.eliminated_round || 0)) || (a.overflow - b.overflow) || (b.wins - a.wins);
  });
  const olName = (r) => (r.players && r.players.name) || "玩家";
  function olStandingsHtml(rows) {
    return olSortRows(rows).map((r) => {
      const hp = Math.max(0, r.hp);
      return `<li class="${r.player_id === OL.playerId ? "me" : ""}${r.alive ? "" : " dead"}"><span>${esc(olName(r))}${olBadge(r.player_id)}</span><span class="ac-hpb"><i style="width:${hp}%"></i></span><b>${r.alive ? hp : "淘汰"}</b></li>`;
    }).join("");
  }
  // 稱號小徽章(對手介紹、全場血量、最終名次共用);拿不到就不顯示
  const olBadge = (pid) => (window.ui && ui.titleBadge && OL.titles ? ui.titleBadge(OL.titles[pid]) : "");
  async function olLoadTitles(rows) {
    const key = rows.map((r) => r.player_id).sort().join(",");
    if (OL.titleKey === key && !OL.reloadTitles) return;
    OL.titleKey = key; OL.reloadTitles = false;
    try {
      const prof = await db.getPlayerProfiles(rows.map((r) => r.player_id));
      OL.titles = {}; Object.keys(prof).forEach((id) => (OL.titles[id] = prof[id].display_title));
    } catch (e) { OL.titles = OL.titles || {}; }
  }
  async function olLoadStandings() {
    const rows = await db.listAutochessPlayers(OL.eventId);
    await olLoadTitles(rows);
    OL.standings = rows; OL.names = {}; rows.forEach((r) => (OL.names[r.player_id] = olName(r)));
    return rows;
  }
  function olNotice(title, body) {
    root.innerHTML = `<div class="card ac-intro"><h3>${esc(title)}</h3><p class="ac-dim">${body}</p><div class="action-row"><a class="btn ghost" href="index.html">${ic("arrow-left")}回活動列表</a></div></div>`;
  }
  function olBanner(text) {
    let el = document.getElementById("ac-banner");
    if (!el) { el = document.createElement("div"); el.id = "ac-banner"; el.className = "ac-banner"; root.parentNode.insertBefore(el, root); }
    el.textContent = text || ""; el.style.display = text ? "block" : "none";
  }

  // ---------- 啟動與主迴圈 ----------
  async function olStart() {
    const me = db.getLocalPlayer();
    if (!me.id) return olNotice("請先登入", "要先回首頁登入(取個名字)並報名這場活動,才能進正式場。想先熟悉玩法可以去<a href=\"autochess.html?mode=practice\">練習場</a>。");
    OL.playerId = me.id; OL.localName = me.name || "你";
    try { OL.ev = await db.getEvent(OL.eventId); } catch (e) { return olNotice("找不到這場活動", "活動可能已經被刪除,請回活動列表確認。"); }
    if (OL.ev.game_type !== "autochess") return olNotice("這不是夜市自走棋的活動", "請回活動列表,從活動卡片進入。");
    const h1 = document.querySelector(".marquee h1"); if (h1) h1.innerHTML = `${esc(OL.ev.name)} <span>正式場</span>`;
    document.addEventListener("visibilitychange", () => { if (!document.hidden) olKick(); }); // 切回分頁時馬上校時
    window.addEventListener("online", olKick);
    olTick();
  }
  function olKick() { if (!OL || OL.stopped) return; clearTimeout(OL.timer); OL.timer = setTimeout(olTick, 0); }
  async function olTick() {
    if (OL.stopped || OL.busy) return;
    OL.busy = true; OL.nextDelay = 1000;
    try {
      const t0 = Date.now(), clk = await db.autochessClock(OL.eventId), t1 = Date.now();
      OL.clk = clk; OL.clkAt = (t0 + t1) / 2; OL.offset = Date.parse(clk.now) - OL.clkAt; // 伺服器時間 = 本機時間 + offset
      OL.err = 0;
      await olReact(clk);
    } catch (e) {
      console.warn("[autochess]", e); OL.err++; olBanner("連線不穩,重試中…");
      OL.nextDelay = Math.min(5000, 1000 + OL.err * 1000);
    }
    OL.busy = false;
    if (!OL.stopped) OL.timer = setTimeout(olTick, OL.nextDelay);
  }
  async function olReact(clk) {
    olBanner(clk.paused ? "主辦人暫停中,計時已暫停" : null);
    if (!clk.started) return olWaiting();
    OL.rowSeq = OL.saveSeq; // 讀這份資料時的存檔序號:讀完之後如果又存過檔,這份就是舊的,不能拿來判斷「別人改了狀態」
    OL.row = await db.getAutochessPlayer(OL.eventId, OL.playerId);
    if (clk.endedAt) return olFinish();
    if (clk.phase === "countdown") return olCountdown(clk);
    if (!OL.row) return olSpectate(clk, "你不是這場的參賽者,目前觀戰中");
    // 自己這輪的對戰還在演出/看結算時,先不要切去觀戰畫面(淘汰在整輪結算完才生效)
    const showingMine = OL.playingRound === clk.round && clk.phase !== "prep";
    if (!OL.row.alive && !showingMine) return olSpectate(clk);
    if (clk.phase === "prep") return olPrep(clk);
    return olBattlePhase(clk);
  }

  // ---------- 還沒開始 / 倒數 ----------
  async function olWaiting() {
    stopTimer();
    OL.ev = await db.getEvent(OL.eventId);
    if (OL.ev.status === "closed") { olNotice("活動已結束", "這場夜市自走棋沒有開打就結束了。"); OL.stopped = true; return; }
    const ps = await db.listParticipants(OL.eventId), meIn = ps.some((p) => p.player_id === OL.playerId);
    root.innerHTML = `<div class="card ac-intro">
      <div class="tag-row"><span class="tag running">${ic("hourglass")}等待開始</span><span class="tag">${ic("users")}${ps.length} 人報名</span></div>
      <h3>${esc(OL.ev.name)}</h3>
      <p>主辦人按下開始後會有 15 秒倒數,這個頁面不用重新整理,時間到會自動進入遊戲。</p>
      ${meIn ? `<p class="ac-dim">${ic("check")}你已報名,先看看規則或去練習場熟悉一下。</p>` : `<p class="ac-dim">${ic("info")}你還沒報名這場活動,請回首頁按「參加」。</p>`}
      <ul class="ac-rank">${ps.map((p) => `<li class="${p.player_id === OL.playerId ? "me" : ""}"><span>${esc((p.players && p.players.name) || "玩家")}</span><span></span><b></b></li>`).join("")}</ul>
      <div class="action-row"><a class="btn ghost" href="autochess.html?mode=practice" target="_blank">${ic("flask-conical")}去練習場</a><a class="btn ghost" href="index.html">${ic("arrow-left")}回活動列表</a></div></div>`;
    OL.nextDelay = 3000;
  }
  async function olCountdown(clk) {
    stopTimer();
    if (!OL.row) return olSpectate(clk, "你不是這場的參賽者,目前觀戰中");
    const st = OL.row.state || {};
    if (st.stateRound === undefined && !OL.initDone) { // 第一次進來:建立初始狀態並存檔(失敗代表別的分頁已經建好了)
      OL.initDone = true;
      const g0 = G.createOnline({ seed: `${OL.eventId}:${OL.playerId}`, name: OL.localName });
      try { await db.autochessSaveState(OL.eventId, OL.playerId, OL.row.state_rev, G.serialize(g0), 1); } catch (e) { OL.initDone = false; throw e; }
    }
    root.innerHTML = `<div class="card ac-intro" style="text-align:center;">
      <div class="tag-row" style="justify-content:center;"><span class="tag running">${ic("timer")}即將開始</span></div>
      <div class="ac-count">${clk.left}</div><p>第 1 輪準備階段即將開始。開局 ${AD.START_GOLD} 銅板,每輪準備 ${fmtSecs(clk.prepSec || 90)}。</p>
      <p class="ac-dim">時間到會自動封板對戰,不用按任何按鈕。</p></div>`;
    OL.nextDelay = 500;
  }

  // ---------- 準備階段 ----------
  async function olEnterPrep(R) {
    battleToken++; closeModal(); hideTip(); stopTimer();
    let row = OL.row;
    if (row.sealed_round > row.settled_round) { // 上一場還沒結算:幫忙推進,結算完才能開始這一輪的準備
      await olSweep(true);
      row = OL.row = await db.getAutochessPlayer(OL.eventId, OL.playerId);
      if (row.sealed_round > row.settled_round) return false;
    }
    g = G.createOnline({ seed: `${OL.eventId}:${OL.playerId}`, name: OL.localName });
    G.restore(g, row.state, row); OL.rev = row.state_rev;
    const advanced = g.round < R;
    G.catchUp(g, R);
    OL.prepRound = R; OL.sealing = false; OL.sealInfo = null; sel = null; view = "prep";
    if (advanced) { persist(); await olFlush(); }
    render(); startTimer(); openPerkIfAny();
    const o = OL.outcome;
    if (o && o.round === R - 1) setMsg(`R${o.round} ${o.res === "win" ? "勝利" : o.res === "lose" ? `落敗,扣血 ${o.dmg}` : "平手"},銅板 +${o.eco.gain}`, o.res === "win" ? "good" : o.res === "lose" ? "bad" : "info");
    return true;
  }
  async function olPrep(clk) {
    const R = clk.round;
    if (OL.sealing && OL.prepRound === R && clk.left > 3) { OL.sealing = false; OL.prepRound = 0; } // 主辦人加時:本機提早封板了,重新回到準備
    if (OL.prepRound !== R) {
      if (!(await olEnterPrep(R))) { olBanner("等待上一輪結算…"); OL.nextDelay = 800; return; }
    }
    OL.prepTotal = clk.prepSec || 90;
    OL.deadline = (clk.paused ? Date.now() : OL.clkAt) + clk.left * 1000 - 500; // clk.left 是無條件進位的秒數,扣 0.5 秒取平均
    if (view === "prep" && !OL.saving && !OL.dirty && OL.rowSeq === OL.saveSeq && OL.row.state_rev > OL.rev) await olReload(R); // 另一個分頁改了狀態
    if (!timerId) startTimer();
  }
  function olTimerTick() {
    paintTimer();
    if (view === "prep" && !OL.sealing && OL.clk && !OL.clk.paused && Date.now() >= OL.deadline) { olSealLocal(); olKick(); }
  }
  // 存檔:每次操作整批寫入,排隊送出;被拒絕代表狀態已經不是我以為的樣子,重新載入
  function persist() {
    if (!OL) return null;
    OL.dirty = true; OL.saveSeq++;
    if (!OL.saving) OL.savePromise = olSaveLoop();
    return OL.savePromise;
  }
  async function olFlush() { if (OL.dirty || OL.saving) await (OL.savePromise || persist()); }
  async function olSaveLoop() {
    OL.saving = true; let tries = 0;
    try {
      while (OL.dirty) {
        OL.dirty = false;
        let r;
        try { r = await db.autochessSaveState(OL.eventId, OL.playerId, OL.rev, G.serialize(g), g.round); }
        catch (e) { if (++tries > 5) { olBanner("存檔失敗,請檢查網路"); break; } OL.dirty = true; await sleep(700); continue; }
        tries = 0;
        if (r && r.ok) { OL.rev = r.rev; OL.saveSeq++; }
        else { OL.dirty = false; await olSaveRejected(r || {}); break; }
      }
    } finally { OL.saving = false; }
  }
  async function olSaveRejected(r) {
    if (r.reason === "rev") setMsg("另一個分頁更新了你的棋盤,已重新載入", "bad");
    else if (r.reason === "dead" || r.reason === "not_running") return;
    else setMsg("這個操作太晚了(已封板),沒有生效", "bad");
    await olReload(g.round);
  }
  async function olReload(R) {
    const row = OL.row = await db.getAutochessPlayer(OL.eventId, OL.playerId);
    if (!row) return;
    g = G.createOnline({ seed: `${OL.eventId}:${OL.playerId}`, name: OL.localName });
    G.restore(g, row.state, row); OL.rev = row.state_rev; G.catchUp(g, R);
    sel = null; if (view === "prep") { render(); openPerkIfAny(); }
  }
  async function olSealLocal() {
    if (OL.sealing) return;
    OL.sealing = true; stopTimer(); closeModal(); hideTip(); sel = null;
    OL.sealInfo = G.sealPrep(g); // 沒選的加碼替選、空位補上
    persist(); await olFlush();
    view = "battle"; olWaitBattle();
  }
  function olWaitBattle() {
    root.innerHTML = `<div class="card ac-intro" style="text-align:center;"><div class="tag-row" style="justify-content:center;"><span class="tag running">${ic("lock")}已封板</span></div>
      <h3>${ic("loader-circle")}正在配對對手…</h3><p class="ac-dim">所有人封板後會自動開打。</p></div>`;
  }

  // ---------- 戰鬥與結算 ----------
  async function olBattlePhase(clk) {
    const R = clk.round;
    if (OL.prepRound === R && view === "prep" && !OL.sealing) await olSealLocal(); // 伺服器時鐘比本機計時先到
    await olEnsurePaired(R);
    await olSweep(false);
    if (OL.playingRound !== R) await olPlayMine(R, clk);
    if (view === "result") { await olRefreshRank(); await olCheckMine(R); }
    else if (view !== "battle") olWaitBattle();
  }
  async function olEnsurePaired(R) {
    if (OL.pairedRound >= R) return;
    const r = await db.autochessPairRound(OL.eventId, R);
    if (r && r.ok) OL.pairedRound = R;
    else if (r && r.reason === "prev_unsettled") await olSweep(true);
  }
  // 任何人都能幫忙結算:結果是「封板快照 + 種子」算出來的,誰算都一樣;自己是 p1 先送,其他人等一下再補
  async function olSweep(force) {
    const rows = await db.listAutochessUnresolved(OL.eventId);
    for (const m of rows) {
      const age = (Date.now() + OL.offset - Date.parse(m.created_at)) / 1000;
      const mineP1 = m.p1 === OL.playerId, mineP2 = m.p2 === OL.playerId;
      if (!(force || (mineP1 ? age > 3 : mineP2 ? age > 6 : age > 10))) continue;
      const res = G.battleOnline(m.round, m.board1, m.board2, m.p2 == null, m.seed, false);
      await db.autochessSettleRound(OL.eventId, m.round, m.k, OL.playerId, res.outcomes);
    }
  }
  async function olPlayMine(R, clk) {
    const m = await db.getAutochessMatch(OL.eventId, R, OL.playerId);
    if (!m) { if (OL.pairedRound >= R) { OL.playingRound = R; root.innerHTML = `<div class="card ac-intro"><h3>這一輪沒有你的對戰</h3><p class="ac-dim">等下一輪開始。</p></div>`; } return; }
    OL.playingRound = R;
    const ghost = m.p2 == null, meP1 = m.p1 === OL.playerId;
    const res = G.battleOnline(R, m.board1, m.board2, ghost, m.seed, true); // A = p1、B = p2(幽靈戰 B 是被複製者),固定次序
    const mine = res.outcomes.find((o) => o.player_id === OL.playerId);
    if (!mine) return;
    OL.outcome = Object.assign({ round: R, matchK: m.k }, mine);
    if (meP1) db.autochessSettleRound(OL.eventId, R, m.k, OL.playerId, res.outcomes).catch((e) => console.warn("結算送出失敗,稍後由補送處理", e));
    if (!OL.standings.length) await olLoadStandings();
    const foeId = ghost ? m.ghost_of : meP1 ? m.p2 : m.p1;
    const rep = { round: R, mine: { side: mine.side, r: res.r, res: mine.res, ghost, foe: { name: OL.names[foeId] || "對手", badge: ghost ? "" : olBadge(foeId) } } };
    OL.lastRep = rep;
    if (clk.phase === "battle") { view = "battle"; playBattle(rep, !!(OL.sealInfo && OL.sealInfo), clk.left * 1000 + 2000); }
    else { view = "result"; render(); }
  }
  async function olRefreshRank() {
    const rows = await olLoadStandings(), el = document.getElementById("ac-ranklist");
    if (el) el.innerHTML = olStandingsHtml(rows);
  }
  // 對方(或別的客戶端)送的結算跟我自己算的不一樣 → 只記警告,不改任何數字
  async function olCheckMine(R) {
    if (OL.checkedRound >= R || !OL.outcome || OL.outcome.round !== R) return;
    const m = await db.getAutochessMatch(OL.eventId, R, OL.playerId);
    if (!m || !m.resolved) return;
    OL.checkedRound = R;
    const theirs = ((m.result && m.result.outcomes) || []).find((o) => o.player_id === OL.playerId), o = OL.outcome;
    if (theirs && (theirs.res !== o.res || theirs.dmg !== o.dmg || (theirs.patch && theirs.patch.gold !== o.patch.gold))) {
      console.warn("[autochess] 結算與本機驗算不一致", theirs, o);
      db.autochessReportMismatch(OL.eventId, R, m.k, OL.playerId, { res: o.res, dmg: o.dmg, gold: o.patch.gold }).catch(() => {});
    }
  }
  function renderResultOnline() {
    const o = OL.outcome; if (!o) return;
    const e = o.eco, res = o.res, title = res === "win" ? "勝利" : res === "lose" ? "落敗" : "平手", tone = res === "win" ? "good" : res === "lose" ? "bad" : "info";
    const hpAfter = o.hpBefore - o.dmg;
    const rows = [["基本收入", `+${e.base}`]];
    if (e.win) rows.push(["勝利獎金", `+${e.win}`]);
    if (e.streakBonus) rows.push([`連勝 ${e.streak} 場加成`, `+${e.streakBonus}`]);
    if (e.interest) rows.push(["金庫利息", `+${e.interest}`]);
    if (e.bonusCoins) rows.push(["暴擊 / 加碼獎勵", `+${e.bonusCoins}`]);
    const notes = [];
    if (o.insured) notes.push("連勝保險生效,連勝沒有中斷");
    if (o.afk) notes.push("你已連續 3 輪沒有操作,這輪不發連勝加成");
    if (OL.sealInfo && OL.sealInfo.autoPicked) notes.push(`時間到,系統替你選了加碼「${OL.sealInfo.autoPicked.name}」`);
    if (OL.sealInfo && OL.sealInfo.filled) notes.push(`系統把待命席的 ${OL.sealInfo.filled} 張卡補上場`);
    root.innerHTML = `
      <div class="card ac-result ${tone}">
        <div class="ac-rtitle">${ic(res === "win" ? "trophy" : res === "lose" ? "swords" : "equal")}<b>R${o.round} ${title}</b></div>
        ${res === "lose" ? `<div class="ac-rline bad">${ic("heart-crack")}扣血 -${o.dmg}(血量 ${o.hpBefore} → ${Math.max(0, hpAfter)})</div>` : `<div class="ac-rline">${ic("heart")}血量 ${Math.max(0, hpAfter)}</div>`}
        <table class="ac-eco">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("")}<tr class="sum"><td>本輪獲得</td><td>+${e.gain} 銅板</td></tr></table>
        <div class="ac-rline">${ic("coins")}銅板 ${o.goldBefore} → <b>${o.patch.gold}</b> ${ic("flame")}連勝 <b>${o.patch.streak}</b></div>
        ${hpAfter <= 0 && !OL["outSfx" + o.round] && (OL["outSfx" + o.round] = 1) && (sfx("out"), true) ? "" : ""}${hpAfter <= 0 ? `<div class="ac-rline bad">${ic("skull")}你的血量歸零,這輪結算完就淘汰了</div>` : ""}
        ${notes.map((n) => `<div class="ac-rline dim">${ic("info")}${esc(n)}</div>`).join("")}
        <div class="ac-sec">${ic("scroll-text")}本輪戰報</div>
        <div class="ac-logbox">${logLinesHtml((history.find((h) => h.round === o.round) || { lines: [] }).lines)}</div>
        <div class="ac-sec">${ic("users")}全場血量</div>
        <ul class="ac-rank" id="ac-ranklist">${olStandingsHtml(OL.standings)}</ul>
        ${OL.lastRep ? `<div class="action-row"><button class="btn ghost" id="ac-replay">${ic("rotate-ccw")}重播這場戰鬥</button></div>` : ""}
        <div class="ac-dim ac-seal-note">${ic("clock")}下一輪的準備階段會自動開始</div>
      </div>`;
    const rp = document.getElementById("ac-replay"); if (rp) rp.onclick = () => playBattle(OL.lastRep, false, 0, true);
  }

  // ---------- 觀戰 / 結束 ----------
  async function olSpectate(clk, note) {
    stopTimer(); view = "spectate";
    const rows = olSortRows(await olLoadStandings()), mine = rows.find((r) => r.player_id === OL.playerId), idx = mine ? rows.indexOf(mine) + 1 : 0;
    const alive = rows.filter((r) => r.alive).length;
    root.innerHTML = `
      <div class="card ac-result">
        <div class="tag-row"><span class="tag running">${ic("eye")}觀戰中</span><span class="tag">R${clk.round} ${PHASE_NAME[clk.phase] || ""}</span><span class="tag">${ic("users")}存活 ${alive} 人</span></div>
        ${mine && !mine.alive ? `<div class="ac-rline bad">${ic("skull")}你在 R${mine.eliminated_round} 被淘汰,目前暫列第 ${idx} 名</div>` : ""}
        ${note ? `<div class="ac-rline dim">${ic("info")}${esc(note)}</div>` : ""}
        <div class="ac-sec">${ic("users")}全場血量</div>
        <ul class="ac-rank">${olStandingsHtml(rows)}</ul>
        <div class="ac-dim">名次依存活、血量與淘汰順序即時更新;結束後會公布最終名次與獎勵。</div>
        <div class="action-row"><a class="btn ghost" href="index.html">${ic("arrow-left")}回活動列表</a></div>
      </div>`;
    OL.nextDelay = 2000;
  }
  async function olFinish() {
    stopTimer(); battleToken++; closeModal(); olBanner(null);
    const rows = await olLoadStandings();
    if (!OL.awarding) { // 先發自己的稱號(冪等);新拿到的當場顯示
      OL.awarding = true;
      db.awardAutochessTitlesFor(OL.eventId, OL.playerId).then((fresh) => {
        if (fresh && fresh.length) { OL.newTitles = fresh; OL.reloadTitles = true; olLoadStandings().then(() => renderOverOnline()); }
      }).catch(() => {});
    }
    if (!OL.closing) { // 套用獎勵並關閉活動(冪等,多個客戶端同時做也沒關係)
      OL.closing = true;
      db.closeAutochessEvent(OL.eventId).then(() => olLoadStandings()).then(() => renderOverOnline()).catch((e) => console.warn("結算獎勵失敗(不影響名次)", e));
    }
    renderOverOnline();
    OL.stopped = true;
  }
  function renderOverOnline() {
    view = "over";
    if (!OL.statRows && !OL.statLoading) { // 翻盤王要看每輪扣血:讀一次對局紀錄,讀不到就沒有這個獎
      OL.statLoading = true;
      db.listAutochessStats(OL.eventId).then((r) => { OL.statRows = r; }).catch(() => { OL.statRows = []; }).then(() => { OL.statLoading = false; if (view === "over") renderOverOnline(); });
    }
    const rows = olSortRows(OL.standings), mine = rows.find((r) => r.player_id === OL.playerId), rank = mine && mine.final_rank;
    const st = (mine && mine.state) || {}, top = rank === 1;
    const reward = mine && (mine.reward || ((OL.ev.reward_plan && OL.ev.reward_plan.items) || [])[rank - 1]);
    const lastRound = mine && mine.eliminated_round ? mine.eliminated_round : (OL.clk && OL.clk.round) || 0;
    if (!OL.overSfx && mine) { OL.overSfx = true; sfx(top ? "champ" : "out"); }
    const lineups = rows.filter((r) => r.final_rank && r.final_rank <= 3 && r.state && !(r.players && r.players.is_bot)).slice(0, 3).map((r) => lineupHtml(r.final_rank, olName(r), (r.state.board || []).map((c) => ({ id: c.id, star: c.star })), olBadge(r.player_id))).join("");
    const awards = awardsHtml(AutochessAwards.awards(rows, OL.statRows || null));
    root.innerHTML = `
      <div class="card ac-result ${top ? "good" : ""}">
        <div class="ac-rtitle">${ic(top ? "crown" : "flag")}<b>${mine ? (top ? "你是夜市棋王!" : `第 ${rank} 名`) : "活動結束"}</b></div>
        ${reward ? `<div class="ac-rline">${ic("gift")}獎勵:<b>${esc(reward)}</b></div>` : ""}
        ${(OL.newTitles || []).length ? `<div class="ac-rline good">${ic("crown")}獲得稱號:${OL.newTitles.map((k) => { const m = (db.TITLE_CATALOG || []).find((t) => t.key === k); return `<b>${esc(m ? m.name : k)}</b>`; }).join("、")}</div>` : ""}
        ${mine ? `<table class="ac-eco">
          <tr><td>撐到</td><td>R${lastRound}</td></tr><tr><td>勝 / 敗</td><td>${mine.wins} / ${mine.losses}</td></tr>
          <tr><td>最長連勝</td><td>${st.bestStreak || 0}</td></tr><tr><td>最高等級</td><td>Lv${st.level || 1}</td></tr>
          <tr><td>合成出 3★</td><td>${st.threeStar || 0} 次</td></tr>
          <tr><td>選過的加碼</td><td>${(st.perkPicks || []).length ? st.perkPicks.map((id) => esc((AD.PERK_BY_ID[id] || { name: id }).name)).join("、") : "沒有"}</td></tr>
        </table>` : ""}
        ${lineups ? `<div class="ac-sec">${ic("trophy")}前三名最終陣容</div>${lineups}` : ""}${awards}
        <div class="ac-sec">${ic("list-ordered")}最終名次</div>
        <ol class="ac-rank final">${rows.map((r) => `<li class="${r.player_id === OL.playerId ? "me" : ""}"><span>${esc(olName(r))}${olBadge(r.player_id)}</span><b>${r.alive ? "存活" : "R" + r.eliminated_round + " 淘汰"}</b></li>`).join("")}</ol>
        <div class="action-row"><a class="btn" href="index.html">${ic("arrow-left")}回活動列表</a><a class="btn ghost" href="autochess.html?mode=practice">${ic("flask-conical")}去練習場</a></div>
      </div>`;
  }

  if (OL) olStart(); else render();
})();
