// 夜市自走棋 · 主辦人大螢幕總表(階段 5)。網址:autochess-board.html?event=活動ID
// 唯讀、不需要登入。每 3 秒更新一次;倒數用本機時間在兩次更新之間插補(伺服器的剩餘秒數是準的,只是平滑顯示)。
// 全部是純顯示:不會改資料,開在投影機或電視上不會干擾比賽。
(function () {
  const root = document.getElementById("ac-bd");
  const AD = window.AutochessData;
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const ic = (n) => `<i data-lucide="${n}" class="ico"></i>`;
  const eventId = new URLSearchParams(location.search).get("event");
  const PHASE = { countdown: "即將開打", prep: "準備階段", battle: "戰鬥中", result: "結算中" };
  const mmss = (s) => { s = Math.max(0, Math.round(s || 0)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  let ev = null, clk = null, rows = [], titles = {}, fetchedAt = 0, titleKey = "", busy = false;

  function sortRows(list) {
    return list.slice().sort((a, b) => {
      if (a.final_rank != null && b.final_rank != null) return a.final_rank - b.final_rank;
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.alive) return (b.hp - a.hp) || (b.wins - a.wins);
      return ((b.eliminated_round || 0) - (a.eliminated_round || 0)) || (b.wins - a.wins);
    });
  }
  const name = (r) => (r.players && r.players.name) || "玩家";
  const badge = (id) => (window.ui && ui.titleBadge && titles[id] ? ui.titleBadge(titles[id]) : "");

  function paint() {
    if (!ev) return;
    const ended = !!(clk && clk.endedAt), started = !!(clk && clk.started);
    const left = clk && !clk.paused && started && !ended ? Math.max(0, (clk.left || 0) - (Date.now() - fetchedAt) / 1000) : (clk && clk.left) || 0;
    const sorted = sortRows(rows), alive = sorted.filter((r) => r.alive).length;
    const status = !started ? "等待開始" : ended ? "比賽結束" : `第 ${clk.round} 輪 · ${PHASE[clk.phase] || ""}`;
    const rankLabel = (r, i) => (r.final_rank ? r.final_rank : r.alive ? i + 1 : "–");
    const list = sorted.map((r, i) => {
      const hp = Math.max(0, r.hp), pct = Math.min(100, Math.round(hp / (AD.START_HP || 100) * 100));
      return `<div class="ac-bd-row ${r.alive ? "" : "out"}${i < 3 && (ended || r.alive) ? " top" : ""}">
        <div class="rk">${rankLabel(r, i)}</div>
        <div class="nm">${esc(name(r))}${badge(r.player_id)}</div>
        <div class="hp"><i style="width:${pct}%"></i><span>${r.alive || ended ? hp : 0}</span></div>
        <div class="wl">${r.wins}勝 ${r.losses}敗${r.alive ? "" : ` · R${r.eliminated_round || "?"} 淘汰`}</div>
      </div>`;
    }).join("");
    root.innerHTML = `
      <div class="ac-bd-head">
        <div class="t">${ic("dices")}${esc(ev.title || "夜市自走棋")}</div>
        <div class="s">${clk && clk.paused && !ended ? `<span class="pause">${ic("pause")}已暫停</span>` : ""}<b>${status}</b>${started && !ended ? `<span class="tm">${mmss(left)}</span>` : ""}</div>
      </div>
      <div class="ac-bd-sub">${ic("users")}存活 <b>${alive}</b> / ${rows.length} 人${ended ? " · 最終名次" : ""}</div>
      <div class="ac-bd-list">${list || `<div class="ac-bd-msg">還沒有玩家</div>`}</div>`;
    if (window.lucide) lucide.createIcons();
  }

  async function refresh() {
    if (busy) return; busy = true;
    try {
      if (!ev) ev = await db.getEvent(eventId);
      [clk, rows] = await Promise.all([db.autochessClock(eventId), db.listAutochessPlayers(eventId)]);
      fetchedAt = Date.now();
      const key = rows.map((r) => r.player_id).sort().join(",");
      if (key !== titleKey) { // 玩家名單變動才重抓稱號
        titleKey = key;
        try { const prof = await db.getPlayerProfiles(rows.map((r) => r.player_id)); titles = {}; Object.keys(prof).forEach((id) => (titles[id] = prof[id].display_title)); } catch (e) { /* 沒稱號就不顯示 */ }
      }
      paint();
    } catch (e) {
      root.innerHTML = `<div class="ac-bd-msg">讀取失敗:${esc(e.message || "未知錯誤")}</div>`;
    } finally { busy = false; }
  }

  if (!eventId) { root.innerHTML = `<div class="ac-bd-msg">網址要帶活動 ID:autochess-board.html?event=活動ID(後台活動卡片有按鈕)</div>`; return; }
  refresh();
  setInterval(refresh, 3000);
  setInterval(() => { if (ev && clk) paint(); }, 1000); // 每秒只重畫倒數,不重新抓資料
})();
