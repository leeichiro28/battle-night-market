// 夜市自走棋 · 單機練習頁(階段 2)
// 純前端:你 + 7 位電腦玩家的 8 人場,流程與數值全在 autochess-game.js / autochess-engine.js,這裡只負責畫面。
// 練習模式:不用登入、不寫資料庫、不計名次、不給稱號,關掉頁面就沒了。
(function () {
  const AD = window.AutochessData, E = window.AutochessEngine, G = window.AutochessGame;
  const root = document.getElementById("ac-root");
  const esc = ui.esc, ic = (n, o) => ui.icon(n, o);
  const TAG_ICON = { burn: "flame", frost: "snowflake", guard: "shield", game: "dices" };
  const pad2 = (n) => String(n).padStart(2, "0");

  let g = null, sel = null, view = "intro", timerOn = true, deadline = 0, timerId = null, msg = null, msgTimer = null, bondInfo = null;
  let battleToken = 0, battleSpeed = 1;

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

  function cardHtml(c, o) {
    o = o || {};
    const d = cardDef(c), st = unitStats(c), t0 = d.tags[0] || "none";
    const icon = TAG_ICON[t0] || "store";
    const cls = `ac-card ${o.mode || "mini"} t-${t0}${d.tags.length > 1 ? " dual" : ""} r-${d.cost} s-${c.star}${o.sel ? " sel" : ""}${o.dim ? " dim" : ""}`;
    const data = o.data || "";
    const badge = o.pos ? `<i class="ac-pos">${o.pos}</i>` : "";
    if (o.mode === "shop") {
      return `<button class="${cls}" ${data}><span class="ac-cost">${ic("coins")}${d.cost}</span>${ic(icon, { cls: "ac-ticon" })}<b class="ac-name">${esc(d.name)}</b><span class="ac-st">${st.atk}/${st.hp}</span></button>`;
    }
    return `<button class="${cls}" ${data}><span class="ac-cost">${d.cost}</span><span class="ac-stars">${stars(c.star)}</span>${ic(icon, { cls: "ac-ticon" })}<b class="ac-name">${esc(d.name.slice(0, 2))}</b><span class="ac-st">${st.atk}/${st.hp}</span>${badge}</button>`;
  }

  // ---------------- 計時 ----------------
  function startTimer() {
    stopTimer();
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
    const total = G.prepSeconds(g.round) * 1000, left = Math.max(0, deadline - Date.now());
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
    if (view === "result") return renderResult();
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
        <label class="ac-check"><input type="checkbox" id="ac-timer-on" ${timerOn ? "checked" : ""} /> 準備階段倒數計時(R1～3 30 秒、R4～11 40 秒、之後 45 秒)</label>
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
    g = G.create({ seed, name: "你" });
    G.startRound(g);
    sel = null; bondInfo = null; view = "prep";
    render(); startTimer(); openPerkIfAny();
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
  function bondChips(board, extra) {
    const b = E.computeBonds(board, extra), items = [];
    Object.keys(AD.TAGS).forEach((t) => {
      const n = b.counts[t] || 0; if (!n) return;
      const reached = b.active[t] || 0, nxt = AD.BOND_TIERS.find((x) => x > n) || AD.BOND_TIERS[AD.BOND_TIERS.length - 1];
      items.push(`<button class="ac-bond t-${t}${reached ? " on" : ""}${bondInfo === t ? " sel" : ""}" data-act="bond" data-tag="${t}">${ic(TAG_ICON[t])}${tagName(t)} ${n}/${reached && n >= 6 ? 6 : nxt}</button>`);
    });
    return items.join("") || `<span class="ac-dim">上陣同流派的卡就會啟動羈絆</span>`;
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
          <span class="tag running">${ic("flask-conical")}練習模式</span>
          <span class="ac-round">R${g.round} 準備</span>
          <span class="ac-timer" id="ac-timer">--</span>
          <button class="btn ghost ac-mini-btn" id="ac-restart">${ic("rotate-ccw")}重來</button>
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
        <div class="ac-sec">${ic("swords")}上陣 <em>${me.board.length}/${slots}</em><span class="ac-hint">第 1 位先鋒・最後一位壓軸</span></div>
        <div class="ac-grid" style="--cols:${slots}">${boardCells.join("")}</div>
        <div class="ac-bonds">${bondChips(me.board, G.extraFor(me))}</div>
        <div class="ac-sec">${ic("archive")}待命席 <em>${me.bench.length}/${AD.BENCH_SLOTS}</em></div>
        <div class="ac-grid" style="--cols:${AD.BENCH_SLOTS}">${benchCells.join("")}</div>
        <div id="ac-detail" class="ac-detail"></div>
      </div>
      <div class="card ac-shop-card">
        <div class="ac-sec">${ic("store")}商店${me.shopLocked ? ` <span class="tag running">${ic("lock")}已鎖定</span>` : ""}</div>
        <div class="ac-grid shop" style="--cols:${me.shop.length}">${shopCells}</div>
        <div class="ac-actions">
          <button class="btn ghost" data-act="refresh">${ic("refresh-cw")}刷新 ${cost ? cost : "免費"}</button>
          <button class="btn ghost" data-act="lock">${ic(me.shopLocked ? "lock-open" : "lock")}${me.shopLocked ? "解鎖" : "鎖定"}</button>
          <button class="btn ghost" data-act="xp"${me.level >= AD.MAX_LEVEL ? " disabled" : ""}>${ic("chevrons-up")}買經驗 ${xpCost}</button>
          <button class="btn ghost" data-act="undo"${me.undo ? "" : " disabled"}>${ic("undo-2")}撤銷購買</button>
        </div>
      </div>
      <div class="action-row ac-seal"><button class="btn block" id="ac-seal">${ic("swords")}完成準備,開始對戰</button></div>`;
    renderDetail();
    paintTimer();
    if (msg) setMsg(msg.text, msg.tone);
    document.getElementById("ac-restart").onclick = restart;
    document.getElementById("ac-seal").onclick = () => doSeal(false);
    const po = document.getElementById("ac-perk-open"); if (po) po.onclick = openPerkIfAny;
  }

  function renderDetail() {
    const el = document.getElementById("ac-detail"); if (!el) return;
    const me = g.me;
    if (bondInfo && !sel) {
      const rows = AD.BONDS[bondInfo].map((t) => `<li class="${(E.computeBonds(me.board, G.extraFor(me)).active[bondInfo] || 0) >= t.need ? "on" : ""}"><b>${t.need} 張</b> ${esc(t.desc)}</li>`).join("");
      el.innerHTML = `<div class="ac-dhead">${ic(TAG_ICON[bondInfo])}<b>${tagName(bondInfo)}羈絆</b><span class="ac-dim">${esc(AD.TAGS[bondInfo].desc)}</span></div><ul class="ac-blist">${rows}</ul><div class="ac-dim">只算不同名的卡;雙流派卡兩個流派都算。</div>`;
      return;
    }
    if (!sel) { el.innerHTML = `<div class="ac-dim">點一張卡看說明;再點另一格就能移動 / 交換位置。點商店的卡直接購買。</div>`; return; }
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
        <button class="btn ghost danger" data-act="sell">${ic("trash-2")}賣出 +${sellV}</button>
        <button class="btn ghost" data-act="desel">${ic("x")}取消</button>
      </div>`;
  }

  // ---------------- 準備階段的點擊 ----------------
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]"); if (!b || view !== "prep") return;
    const act = b.dataset.act, me = g.me, i = Number(b.dataset.i), zone = b.dataset.zone;
    let r = null;
    if (act === "shop") { r = G.buy(g, i); if (r.ok) { sel = null; bondInfo = null; if (r.merged.length) setMsg("合成!" + r.merged.map((m) => `${cardDef(m).name} ${m.star}★`).join("、"), "good"); } }
    else if (act === "own") {
      bondInfo = null;
      if (sel && !(sel.zone === zone && sel.idx === i)) { r = G.move(g, sel, { zone, idx: i }); if (r.ok) sel = null; }
      else sel = sel && sel.zone === zone && sel.idx === i ? null : { zone, idx: i };
    }
    else if (act === "slot") { if (sel) { r = G.move(g, sel, { zone, idx: i }); if (r.ok) sel = null; } }
    else if (act === "bond") { sel = null; bondInfo = bondInfo === b.dataset.tag ? null : b.dataset.tag; }
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
    if (r && !r.ok) setMsg(r.msg, "bad");
    renderPrep();
  });

  async function restart() {
    const ok = await ui.confirm("重新開始會放棄目前的對局,確定嗎?", { title: "重新開始", confirmText: "重新開始", tone: "question" });
    if (ok) newGame();
  }

  // ---------------- 攤位加碼(彈窗)----------------
  const modal = document.getElementById("ac-modal"), modalCard = document.getElementById("ac-modal-card");
  function closeModal() { modal.classList.remove("show"); }
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
    closeModal(); sel = null; setMsg(`選了「${r.perk.name}」`, "good"); renderPrep();
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
    const mk = (u) => ({ ...u, shield: 0, burn: 0, frozen: 0, dead: false, flash: "" });
    return { a: init.a.map(mk), b: init.b.map(mk) };
  }
  function battleRowHtml(units, isMe) {
    return units.map((u) => {
      const d = AD.CARD_BY_ID[u.id], t0 = d.tags[0] || "none", pct = Math.max(0, u.hp / u.maxHp * 100);
      const stat = (u.burn ? `<span class="bs burn">${ic("flame")}${u.burn}</span>` : "") + (u.frozen ? `<span class="bs frost">${ic("snowflake")}</span>` : "") + (u.shield ? `<span class="bs guard">${ic("shield")}${u.shield}</span>` : "");
      return `<div class="ac-bunit ${u.dead ? "dead" : ""} ${u.flash}"><div class="ac-card mini t-${t0} r-${d.cost} s-${u.star}"><span class="ac-cost">${d.cost}</span><span class="ac-stars">${stars(u.star)}</span>${ic(TAG_ICON[t0] || "store", { cls: "ac-ticon" })}<b class="ac-name">${esc(d.name.slice(0, 2))}</b><span class="ac-st">${u.atk}</span></div><div class="ac-hpbar"><i style="width:${pct}%"></i></div><div class="ac-hpnum">${Math.max(0, u.hp)}</div><div class="ac-bstat">${stat}</div></div>`;
    }).join("");
  }

  async function playBattle(rep, auto) {
    const token = ++battleToken, mine = rep.mine, mySide = mine.side, foeSide = mySide === "a" ? "b" : "a";
    const init = mine.r.init, bs = bstateFrom(init), events = mine.r.events || [];
    const foeName = mine.ghost ? `幽靈(${mine.foe.name} 的陣容)` : mine.foe.name;
    const nameOf = (tag) => { const u = bs[tag[0]][Number(tag.slice(1))]; return (tag[0] === mySide ? "我方" : "敵方") + AD.CARD_BY_ID[u.id].name; };
    let log = auto ? "時間到,自動封板!" : "對戰開始";
    const bondLine = (side) => { const b = side === mySide ? (mySide === "a" ? mine.r.bondsA : mine.r.bondsB) : (mySide === "a" ? mine.r.bondsB : mine.r.bondsA); return Object.keys(b).map((t) => `<span class="ac-bond on t-${t}">${ic(TAG_ICON[t])}${tagName(t)} ${b[t]}</span>`).join("") || `<span class="ac-dim">沒有羈絆</span>`; };
    let skipped = false;
    const draw = (round) => {
      if (token !== battleToken) return;
      root.innerHTML = `
        <div class="ac-top"><div class="ac-top-row"><span class="tag running">${ic("flask-conical")}練習模式</span><span class="ac-round">R${rep.round} 戰鬥</span><span class="ac-timer">第 ${round || 1} 回合</span>
          <span class="ac-speed"><button class="btn ghost ac-mini-btn" id="ac-x2">${ic("fast-forward")}x${battleSpeed === 1 ? 2 : 1} 速</button><button class="btn ghost ac-mini-btn" id="ac-skip">${ic("skip-forward")}跳過</button></span></div></div>
        <div class="card ac-battle">
          <div class="ac-bname">${ic("user")}${esc(foeName)}</div>
          <div class="ac-bonds">${bondLine(foeSide)}</div>
          <div class="ac-brow" style="--cols:${bs[foeSide].length}">${battleRowHtml(bs[foeSide], false)}</div>
          <div class="ac-blog" id="ac-blog">${esc(log)}</div>
          <div class="ac-brow" style="--cols:${bs[mySide].length}">${battleRowHtml(bs[mySide], true)}</div>
          <div class="ac-bonds">${bondLine(mySide)}</div>
          <div class="ac-bname me">${ic("user-round")}你</div>
        </div>`;
      document.getElementById("ac-x2").onclick = () => { battleSpeed = battleSpeed === 1 ? 2 : 1; document.getElementById("ac-x2").innerHTML = ic("fast-forward") + `x${battleSpeed === 1 ? 2 : 1} 速`; };
      document.getElementById("ac-skip").onclick = () => { skipped = true; };
    };
    let round = 1; draw(round);
    await sleep(700 / battleSpeed);
    for (const ev of events) {
      if (token !== battleToken) return;
      let delay = 250, text = null, flashTag = null, flash = "";
      const u = (tag) => bs[tag[0]][Number(tag.slice(1))];
      switch (ev.t) {
        case "round": round = ev.n; text = `第 ${ev.n} 回合`; delay = 350; break;
        case "atk": text = `${nameOf(ev.from)} 攻擊 ${nameOf(ev.to)}${ev.crit ? "(暴擊!)" : ""}`; flashTag = ev.from; flash = "atk"; delay = 450; break;
        case "dmg": {
          const t = u(ev.to); t.shield = Math.max(0, t.shield - (ev.ab || 0)); t.hp -= ev.n;
          if (ev.kind === "burn") t.burn = Math.max(0, t.burn - 1);
          text = ev.kind === "burn" ? `${nameOf(ev.to)} 灼傷 -${ev.n}` : ev.kind === "bell" ? `打烊鐘!${nameOf(ev.to)} -${ev.n}` : ev.kind === "reflect" ? `${nameOf(ev.to)} 受到反彈 -${ev.n}` : `${nameOf(ev.to)} -${ev.n}${ev.ab ? `(護盾吸收 ${ev.ab})` : ""}`;
          flashTag = ev.to; flash = "hit"; delay = 380; break;
        }
        case "die": u(ev.to).dead = true; text = `${nameOf(ev.to)} 被擊敗`; delay = 480; break;
        case "burn": u(ev.to).burn += ev.n; text = `${nameOf(ev.to)} 灼傷 +${ev.n} 層`; delay = 220; break;
        case "freeze": u(ev.to).frozen = 1; text = `${nameOf(ev.to)} 被凍結`; delay = 300; break;
        case "skip": u(ev.from).frozen = 0; text = `${nameOf(ev.from)} 凍結中,跳過行動`; delay = 300; break;
        case "shield": u(ev.to).shield += ev.n; text = `${nameOf(ev.to)} 獲得 ${ev.n} 點護盾`; delay = 200; break;
        case "buff": u(ev.to).atk += ev.atk; text = `${nameOf(ev.to)} 攻擊 +${ev.atk}`; delay = 200; break;
        case "bell": text = `打烊鐘響起:全體受到遞增傷害`; delay = 350; break;
        default: break;
      }
      if (skipped) continue;
      if (text != null) log = text;
      if (flashTag) u(flashTag).flash = flash;
      draw(round);
      await sleep(delay / battleSpeed);
      if (flashTag) u(flashTag).flash = "";
    }
    if (token !== battleToken) return;
    // 最終畫面
    const res = mine.res;
    log = res === "win" ? "你贏了!" : res === "lose" ? "你輸了…" : "平手";
    draw(round);
    await sleep(skipped ? 300 : 900 / battleSpeed);
    if (token !== battleToken) return;
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
        <div class="ac-sec">${ic("users")}全場血量</div>
        <ul class="ac-rank">${ranking}</ul>
        <div class="action-row"><button class="btn block" id="ac-next">${ic(g.over ? "trophy" : "arrow-right")}${g.over ? "查看總結" : `進入 R${g.round + 1}`}</button></div>
      </div>`;
    document.getElementById("ac-next").onclick = () => {
      if (g.over) { view = "over"; render(); return; }
      G.nextRound(g); sel = null; bondInfo = null; view = "prep"; render(); startTimer(); openPerkIfAny();
    };
  }

  // ---------------- 總結 ----------------
  function renderOver() {
    const s = G.stats(g), top = s.rank === 1;
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
        <div class="ac-sec">${ic("list-ordered")}最終名次</div>
        <ol class="ac-rank final">${g.finalRanking.map((p) => `<li class="${p.human ? "me" : ""}"><span>${esc(p.name)}</span><b>${p.elimRound ? "R" + p.elimRound + " 淘汰" : "存活"}</b></li>`).join("")}</ol>
        <div class="action-row"><button class="btn" id="ac-again">${ic("rotate-ccw")}再玩一場</button><a class="btn ghost" href="index.html">${ic("arrow-left")}回活動列表</a></div>
      </div>`;
    document.getElementById("ac-again").onclick = newGame;
  }

  render();
})();
