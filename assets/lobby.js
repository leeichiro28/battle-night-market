const params = new URLSearchParams(location.search);
const eventId = params.get("event");
let myParticipant = null;
let advanceInterval = null;
let unsubLeaderAdvance = null;
let isAdvanceLeader = false;
let unsub1 = null;
let unsub2 = null;
let currentEv = null;
let classByPlayerId = {}; // 每次 renderBracket 重新整理，matchRowHtml/bracketCardInnerHtml 讀這份來畫職業小標籤

const GAME_PAGE = { dice: "dice.html", rps5: "rps5.html" };
const BRACKET_ORDER = { winners: 0, losers: 1, final: 2 };

let pulseActive = false;
function pulse() {
  if (pulseActive) return; // 已經在跑了，不要每次輪詢都重新歸零重跑，避免畫面一直跳動
  pulseActive = true;
  const bar = document.getElementById("pulse-bar");
  let w = 0;
  clearInterval(window._pulseTimer);
  window._pulseTimer = setInterval(() => {
    w = (w + 4) % 100;
    bar.style.width = w + "%";
  }, 80);
}
function stopPulse() {
  pulseActive = false;
  clearInterval(window._pulseTimer);
}

function rankBadge(rank) {
  const badge = ui.rankBadge(rank);
  return badge ? badge + " " : "";
}

async function loadEvent() {
  const ev = await db.getEventSafe(eventId);
  if (!ev) return null;
  document.getElementById("event-title").textContent = ev.name;
  document.getElementById("event-game-tag").innerHTML = ui.icon(ui.gameIcon(ev.game_type)) + ui.gameLabel(ev.game_type);
  return ev;
}

function roundLabel(round, totalRounds, losersBracketOn) {
  if (round === totalRounds) return { icon: "trophy", text: losersBracketOn ? "勝部決賽" : "決賽" };
  if (round === totalRounds - 1) return { icon: "swords", text: "準決賽" };
  return { icon: "swords", text: `第 ${round} 輪` };
}

// 一列對戰:左選手 / vs / 右選手。vs 用 grid 固定在正中央，不會被名字長度推歪。
function matchRowHtml(m, ev, fallbackDoneText) {
  const n1 = m.p1?.name || (m.status === "pending" ? "待定" : fallbackDoneText || "?");
  const n2 = m.p2?.name || (m.status === "pending" ? "待定" : fallbackDoneText || "?");
  const w1 = m.winner_id && m.winner_id === m.player1_id;
  const w2 = m.winner_id && m.winner_id === m.player2_id;
  const cls = (win) => (win ? "win" : m.winner_id ? "lose" : "");
  const isLive = m.status === "active";
  const showClass = classesEnabled(ev);
  const c1 = showClass && m.p1?.name ? ui.classTag(classByPlayerId[m.player1_id]) : "";
  const c2 = showClass && m.p2?.name ? ui.classTag(classByPlayerId[m.player2_id]) : "";
  return `
    <div class="match-row${isLive ? " live" : ""}">
      <div class="vs-row">
        <span class="side left ${cls(w1)}">${isLive ? ui.icon("radio", { cls: "live-dot" }) : ""}${ui.esc(n1)}${c1}</span>
        <span class="vs">vs</span>
        <span class="side right ${cls(w2)}">${c2}${ui.esc(n2)}</span>
      </div>
      ${isLive ? `<div class="row-note live">${ui.icon("radio")}直播中，往上看即時戰況</div>` : ""}
    </div>`;
}

function sectionTitle(iconName, text, gold) {
  return `<div class="section-title${gold ? " gold" : ""}">${ui.icon(iconName)}${text}</div>`;
}

// 已出局名單，列表 / 賽制圖兩種檢視都會用到
function eliminatedListHtml(parts) {
  const eliminated = parts.filter((p) => p.status === "eliminated").sort((a, b) => (a.final_rank || 99) - (b.final_rank || 99));
  if (!eliminated.length) return "";
  let html = sectionTitle("skull", "已出局");
  eliminated.forEach((p) => {
    html += `<div class="bracket-row"><span class="lose">${rankBadge(p.final_rank)}${ui.esc(p.players.name)}</span><span class="mono" style="font-size:12px;">${
      p.reward ? ui.icon("gift") + " " + ui.esc(p.reward) : ""
    }</span></div>`;
  });
  return html;
}

let bracketView = localStorage.getItem("bracket_view") === "tree" ? "tree" : "list";
document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
  btn.classList.toggle("active", btn.dataset.view === bracketView);
});

function renderBracketListView(ev, parts, matches) {
  const wbMatches = matches.filter((m) => m.bracket === "winners");
  const lbMatches = matches.filter((m) => m.bracket === "losers");
  const finalMatch = matches.find((m) => m.bracket === "final");
  const totalRounds = wbMatches.length ? Math.max(...wbMatches.map((m) => m.round)) : 0;

  let html = "";

  const champion = parts.find((p) => p.status === "champion");
  if (champion) {
    html += `<div class="bracket-row" style="background:rgba(242,183,5,.1);border-radius:10px;padding:12px 14px;border:1px solid var(--gold-d);margin-bottom:8px;"><span class="win">${ui.icon("crown")} 冠軍・${ui.esc(champion.players.name)}</span><span></span></div>`;
  }

  html += sectionTitle("swords", "勝部賽程");
  for (let r = 1; r <= totalRounds; r++) {
    const rows = wbMatches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
    const label = roundLabel(r, totalRounds, ev.losers_bracket);
    html += sectionTitle(label.icon, label.text, r >= totalRounds - 1);
    rows.forEach((m) => (html += matchRowHtml(m, ev, "輪空")));
  }

  if (ev.losers_bracket) {
    html += sectionTitle("medal", "敗部復活賽戰況");
    if (!lbMatches.length) {
      html += `<div class="status-msg" style="margin:4px 0;">還沒有人掉入敗部</div>`;
    } else {
      lbMatches
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .forEach((m) => (html += matchRowHtml(m, ev)));
    }

    // 總冠軍賽從一開始就顯示佔位，不會等敗部打完才突然冒出來
    html += sectionTitle("trophy", "總冠軍賽", true);
    if (finalMatch) {
      html += matchRowHtml(finalMatch, ev);
    } else {
      const wbChamp = parts.find((p) => p.status === "wb_champion");
      const lbChamp = parts.find((p) => p.status === "lb_champion");
      const n1 = wbChamp ? ui.esc(wbChamp.players.name) : "待定(等勝部決賽結果)";
      const n2 = lbChamp ? ui.esc(lbChamp.players.name) : "待定(等敗部打完)";
      html += `<div class="bracket-row"><div class="vs-row"><span class="side left">${n1}</span><span class="vs">vs</span><span class="side right">${n2}</span></div></div>`;
    }
  }

  html += eliminatedListHtml(parts);
  return html;
}

// 樹狀對戰卡:同一張卡上下兩位選手，贏家打勾、輸家灰底刪除線
function bracketCardInnerHtml(m, ev) {
  const n1 = m.p1?.name || (m.status === "pending" ? "待定" : "輪空");
  const n2 = m.p2?.name || (m.status === "pending" ? "待定" : "輪空");
  const w1 = m.winner_id && m.winner_id === m.player1_id;
  const w2 = m.winner_id && m.winner_id === m.player2_id;
  const cls = (win) => (win ? "win" : m.winner_id ? "lose" : "");
  const isLive = m.status === "active";
  const showClass = ev && classesEnabled(ev);
  const c1 = showClass && m.p1?.name ? ui.classTag(classByPlayerId[m.player1_id]) : "";
  const c2 = showClass && m.p2?.name ? ui.classTag(classByPlayerId[m.player2_id]) : "";
  return `
    <div class="bt-row ${cls(w1)}">${w1 ? ui.icon("check") : ""}<span>${ui.esc(n1)}</span>${c1}</div>
    <div class="bt-row ${cls(w2)}">${w2 ? ui.icon("check") : ""}<span>${ui.esc(n2)}</span>${c2}</div>
    ${isLive ? `<div class="bt-live-tag">${ui.icon("radio")}直播中</div>` : ""}`;
}

// 敗部復活賽是即時候位配對(誰先打完誰先上，贏的人也是直接回候位池等下一場)，
// 不是預先排好的樹狀賽程，沒有「輪次」也沒有固定的晉級關係，所以不能比照勝部畫分支樹。
// 這裡改用時間軸梯子:照對戰發生的先後順序，一場接一場往下排，單純把清單畫得更有賽制圖的感覺，
// 不去假裝場次之間有晉級線(那條線畫出來會是假的)。
function losersLadderHtml(lbMatches, ev) {
  if (!lbMatches.length) {
    return `<div class="status-msg" style="margin:4px 0;">還沒有人掉入敗部</div>`;
  }
  const sorted = [...lbMatches].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return `<div class="bt-ladder">
    ${sorted
      .map(
        (m, i) => `
      <div class="bt-ladder-item">
        <div class="bt-ladder-dot-col"><div class="bt-ladder-dot${m.status === "active" ? " live" : ""}"></div></div>
        <div class="bt-ladder-card">
          <div class="bt-ladder-label">第 ${i + 1} 場</div>
          <div class="bt-match${m.status === "active" ? " live" : ""}">${bracketCardInnerHtml(m, ev)}</div>
        </div>
      </div>`
      )
      .join("")}
  </div>`;
}

// 賽制圖:只有勝部賽程是固定成形的二元樹(每輪 slot i 由上一輪 slot 2i / 2i+1 晉級而來)，
// 才能用「欄位 = 輪次、SVG 連線」畫出真正的賽制圖。敗部復活賽是動態配對(誰先打完誰先上)，
// 沒有固定賽程樹，改用時間軸梯子呈現(見 losersLadderHtml)。
function renderBracketTreeView(ev, parts, matches) {
  const wbMatches = matches.filter((m) => m.bracket === "winners");
  const finalMatch = matches.find((m) => m.bracket === "final");
  const totalRounds = wbMatches.length ? Math.max(...wbMatches.map((m) => m.round)) : 0;
  const champion = parts.find((p) => p.status === "champion");

  if (!totalRounds) {
    return `<div class="empty">${ui.icon("hourglass")}賽程還沒排出來</div>`;
  }

  let cols = "";
  for (let r = 1; r <= totalRounds; r++) {
    const rows = wbMatches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
    const label = roundLabel(r, totalRounds, ev.losers_bracket);
    cols += `<div class="bt-col">
      <div class="bt-col-title${r >= totalRounds - 1 ? " gold" : ""}">${ui.icon(label.icon)}${label.text}</div>
      <div class="bt-col-matches">
        ${rows
          .map(
            (m) =>
              `<div class="bt-match${m.status === "active" ? " live" : ""}" data-round="${m.round}" data-slot="${m.slot}">${bracketCardInnerHtml(m, ev)}</div>`
          )
          .join("")}
      </div>
    </div>`;
  }

  let extraRound = totalRounds + 1;
  if (ev.losers_bracket) {
    // 總冠軍賽欄位從一開始就顯示(待定佔位)，不會等敗部打完才突然冒出來，
    // 才不會讓大家誤以為「勝部決賽」打完整場活動就結束了。
    const wbChamp = parts.find((p) => p.status === "wb_champion");
    const lbChamp = parts.find((p) => p.status === "lb_champion");
    const finalInner = finalMatch
      ? bracketCardInnerHtml(finalMatch, ev)
      : `<div class="bt-row">${ui.icon("hourglass")}<span>${wbChamp ? ui.esc(wbChamp.players.name) : "待定(等勝部決賽)"}</span></div><div class="bt-row">${ui.icon(
          "hourglass"
        )}<span>${lbChamp ? ui.esc(lbChamp.players.name) : "待定(等敗部打完)"}</span></div>`;
    cols += `<div class="bt-col">
      <div class="bt-col-title gold">${ui.icon("trophy")}總冠軍賽</div>
      <div class="bt-col-matches">
        <div class="bt-match${finalMatch && finalMatch.status === "active" ? " live" : ""}" data-round="${extraRound}" data-slot="0">${finalInner}</div>
      </div>
    </div>`;
    extraRound++;
  }
  if (champion) {
    cols += `<div class="bt-col">
      <div class="bt-col-title gold">${ui.icon("crown")}冠軍</div>
      <div class="bt-col-matches">
        <div class="bt-match champion-card" data-round="${extraRound}" data-slot="0">
          <div class="bt-row win">${ui.icon("crown")}<span>${ui.esc(champion.players.name)}</span></div>
        </div>
      </div>
    </div>`;
  }

  let html = `<div class="bracket-tree-wrap" id="bt-wrap"><div class="bracket-tree" id="bt-tree">${cols}<svg class="bt-lines"></svg></div></div>`;

  if (ev.losers_bracket) {
    const lbMatches = matches.filter((m) => m.bracket === "losers");
    html += sectionTitle("medal", "敗部復活賽戰況");
    html += losersLadderHtml(lbMatches, ev);
  }

  html += eliminatedListHtml(parts);
  return html;
}

// 賽制圖連線:量測每張對戰卡實際渲染的位置，畫出「本場 -> 下一輪對應場次」的 L 形連線。
// 用實際量測而不是純 CSS 算位置，是因為名字長度不同會讓卡片高度不一，純 CSS 沒辦法算準連線落點。
function drawBracketConnectors() {
  const tree = document.getElementById("bt-tree");
  if (!tree) return;
  const svg = tree.querySelector(".bt-lines");
  if (!svg) return;
  const matchEls = [...tree.querySelectorAll(".bt-match[data-round]")];
  if (!matchEls.length) return;

  const treeRect = tree.getBoundingClientRect();
  svg.setAttribute("width", tree.scrollWidth);
  svg.setAttribute("height", tree.scrollHeight);
  svg.innerHTML = "";

  const byRound = {};
  matchEls.forEach((el) => {
    const r = +el.dataset.round,
      s = +el.dataset.slot;
    (byRound[r] = byRound[r] || {})[s] = el;
  });
  const rounds = Object.keys(byRound)
    .map(Number)
    .sort((a, b) => a - b);

  for (let i = 0; i < rounds.length - 1; i++) {
    const r = rounds[i],
      rNext = rounds[i + 1];
    Object.keys(byRound[r]).forEach((sKey) => {
      const s = +sKey;
      const toEl = byRound[rNext] && byRound[rNext][Math.floor(s / 2)];
      if (!toEl) return;
      const a = byRound[r][s].getBoundingClientRect();
      const b = toEl.getBoundingClientRect();
      const x1 = a.right - treeRect.left;
      const y1 = a.top + a.height / 2 - treeRect.top;
      const x2 = b.left - treeRect.left;
      const y2 = b.top + b.height / 2 - treeRect.top;
      const midX = x1 + (x2 - x1) / 2;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", `M${x1},${y1} H${midX} V${y2} H${x2}`);
      path.setAttribute("class", "bt-line");
      svg.appendChild(path);
    });
  }
}

function setBracketView(view) {
  bracketView = view;
  localStorage.setItem("bracket_view", view);
  document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === view);
  });
  if (currentEv) renderBracket(currentEv);
}

document.querySelectorAll(".view-toggle-btn").forEach((btn) => {
  btn.onclick = () => setBracketView(btn.dataset.view);
});

window.addEventListener("resize", () => {
  if (bracketView === "tree") drawBracketConnectors();
});

// 是否要在賽程/賽制圖上顯示職業標籤:只有骰子對戰而且主辦人開了職業系統規則才有意義
function classesEnabled(ev) {
  return ev.game_type === "dice" && !!(ev.rules && ev.rules.classes);
}

async function renderBracket(ev) {
  const box = document.getElementById("bracket-list");
  const parts = await db.listParticipants(eventId);

  if (!parts.length) {
    box.innerHTML = `<div class="empty">${ui.icon("users")}還沒有人參加</div>`;
    return;
  }

  classByPlayerId = {};
  parts.forEach((p) => (classByPlayerId[p.player_id] = p.class));

  if (!ev.locked) {
    const showClass = classesEnabled(ev);
    box.innerHTML =
      `<div class="empty">${ui.icon("users")}報名中，已有 ${parts.length} 人參加，等主辦人鎖定名單開賽</div>` +
      parts
        .map(
          (p) =>
            `<div class="bracket-row"><span>${ui.icon("user")} ${ui.esc(p.players.name)}</span>${
              showClass && p.class ? `<span>${ui.classTag(p.class)}</span>` : "<span></span>"
            }</div>`
        )
        .join("");
    return;
  }

  const matches = await db.listMatches(eventId);
  box.innerHTML = bracketView === "tree" ? renderBracketTreeView(ev, parts, matches) : renderBracketListView(ev, parts, matches);
  if (bracketView === "tree") drawBracketConnectors();
}

// ---------- 內嵌直播面板:不用另外開分頁就能看到目前這場對戰的即時比分 ----------
// 以前這裡是塞一個 <iframe src="dice.html?..."> 把整頁對戰畫面嵌進來，會多出第二層導覽列/標題/規則按鈕，
// 看起來像網站自己嵌自己。現在改成跟 dice.html / rps5.html 共用同一份 assets/battle-view.js，
// 直接在等候室頁面裡渲染同一個 DOM，下注/表情互動也是同一份邏輯，不是唯讀截圖。
let currentLiveMatchId = null;
let liveBattleView = null;
let liveBetsUnsub = null;
let liveMatchRef = null;
let liveEvRef = null;

function teardownLivePanel() {
  if (liveBattleView) liveBattleView.destroy();
  if (liveBetsUnsub) liveBetsUnsub();
  liveBattleView = null;
  liveBetsUnsub = null;
  liveMatchRef = null;
  liveEvRef = null;
}

function renderLivePanel(ev, m) {
  const box = document.getElementById("live-panel-box");
  if (!m) {
    if (currentLiveMatchId !== null) {
      teardownLivePanel();
      box.innerHTML = "";
    }
    currentLiveMatchId = null;
    return;
  }

  liveMatchRef = m;
  liveEvRef = ev;

  if (currentLiveMatchId === m.id) {
    liveBattleView.update(m, ev, null); // 同一場對戰，只更新畫面內容，不要重建 DOM(會閃爍)
    return;
  }

  teardownLivePanel();
  currentLiveMatchId = m.id;
  box.innerHTML = `
    <div class="live-panel">
      <div class="live-tag"><span class="dot"></span>直播中・${ui.gameLabel(
        ev.game_type
      )}・不用開新分頁，直接在這裡看完整對戰</div>
      <div id="live-battle-stage"></div>
    </div>
  `;
  liveBattleView = BattleView.mount(document.getElementById("live-battle-stage"), null, {
    gameType: ev.game_type,
    matchId: m.id,
  });
  liveBattleView.update(m, ev, null);
  liveBetsUnsub = db.onTableChange("match_bets", `match_id=eq.${m.id}`, () => {
    if (liveBattleView && liveMatchRef) liveBattleView.update(liveMatchRef, liveEvRef, null);
  });
}

function computeQueuePosition(matches, myMatchId) {
  const pending = matches
    .filter((m) => m.status === "pending" && m.player1_id && m.player2_id)
    .sort((a, b) => {
      const br = (BRACKET_ORDER[a.bracket] ?? 9) - (BRACKET_ORDER[b.bracket] ?? 9);
      if (br) return br;
      const rr = (a.round || 0) - (b.round || 0);
      if (rr) return rr;
      const sr = (a.slot ?? 999) - (b.slot ?? 999);
      if (sr) return sr;
      return new Date(a.created_at) - new Date(b.created_at);
    });
  const idx = pending.findIndex((m) => m.id === myMatchId);
  return idx === -1 ? null : idx + 1;
}

async function renderStatusBanner(ev, activeMatch) {
  const box = document.getElementById("status-banner");
  if (!ev.locked || ev.status === "closed") {
    box.innerHTML = "";
    return;
  }
  if (!activeMatch) {
    box.innerHTML = `<div class="status-banner idle">${ui.icon("hourglass")}目前沒有對戰進行中，系統排程中...</div>`;
    return;
  }
  const n1 = ui.esc(activeMatch.p1?.name || "?");
  const n2 = ui.esc(activeMatch.p2?.name || "?");
  const amPlaying = myParticipant && myParticipant.match_id === activeMatch.id && myParticipant.status === "matched";
  const text = amPlaying ? `輪到你了！正在對戰:${n1} vs ${n2}` : `正在進行中:${n1} vs ${n2}`;
  box.innerHTML = `<div class="status-banner live">${ui.icon("radio", { cls: "live-dot" })}${text}</div>`;
}

const STATUS_TEXT = {
  waiting: { icon: "loader-circle", text: "等待配對中，找到對手會自動帶你進場" },
  pending: { icon: "hourglass", text: "已排進賽程，前面的對戰結束後會自動帶你進場..." },
  matched: { icon: "swords", text: "配對成功！進入對戰..." },
  wb_champion: { icon: "trophy", text: "你打進了總冠軍賽！等待敗部冠軍產生..." },
  lb_champion: { icon: "trophy", text: "你從敗部殺出重圍！等待總冠軍賽開打..." },
  champion: { icon: "crown", text: "恭喜你是本場活動冠軍！" },
};

function statusHtml(key, fallbackText) {
  const item = STATUS_TEXT[key];
  if (!item) return ui.icon("loader-circle") + (fallbackText || "狀態確認中...");
  return ui.icon(item.icon) + item.text;
}

let redirecting = false;

async function checkMyStatus(ev, matches) {
  const local = db.getLocalPlayer();
  const statusEl = document.getElementById("my-status");
  const quitBtn = document.getElementById("quit-btn");
  const classBtn = document.getElementById("class-btn");

  const spectatorHtml = ui.icon("eye") + "觀戰模式，你目前沒有報名這場活動";

  if (!local.id) {
    statusEl.innerHTML = spectatorHtml;
    quitBtn.style.display = "none";
    classBtn.style.display = "none";
    stopPulse();
    return;
  }

  myParticipant = await db.getMyParticipant(eventId, local.id);
  if (!myParticipant) {
    statusEl.innerHTML = spectatorHtml;
    quitBtn.style.display = "none";
    classBtn.style.display = "none";
    stopPulse();
    return;
  }

  if (!ev.locked) {
    statusEl.innerHTML = ui.icon("circle-check") + "已報名，等主辦人鎖定名單開賽";
    quitBtn.style.display = "inline-flex";
    classBtn.style.display = classesEnabled(ev) ? "inline-flex" : "none";
    pulse();
    return;
  }

  if (myParticipant.status === "matched" && myParticipant.match_id) {
    if (redirecting) return;
    redirecting = true;
    stopBackgroundSync();
    stopPulse();
    quitBtn.style.display = "none";
    classBtn.style.display = "none";
    statusEl.innerHTML = statusHtml("matched");
    location.href = `${GAME_PAGE[ev.game_type]}?match=${myParticipant.match_id}&event=${eventId}`;
    return;
  }

  if (myParticipant.status === "eliminated") {
    stopBackgroundSync();
    stopPulse();
    quitBtn.style.display = "none";
    classBtn.style.display = "none";
    statusEl.innerHTML = myParticipant.reward
      ? `${rankBadge(myParticipant.final_rank)}你已出局。獲得獎勵 ${ui.icon("gift")} <b style="color:var(--gold)">${ui.esc(
          myParticipant.reward
        )}</b>`
      : `${rankBadge(myParticipant.final_rank)}你已出局，感謝參加！獎勵確認後會顯示在這裡`;
    return;
  }

  if (myParticipant.status === "champion") {
    stopBackgroundSync();
    stopPulse();
    quitBtn.style.display = "none";
    classBtn.style.display = "none";
    statusEl.innerHTML = myParticipant.reward
      ? `${ui.icon("crown")}恭喜奪冠！獎勵 ${ui.icon("gift")} <b style="color:var(--gold)">${ui.esc(myParticipant.reward)}</b>`
      : statusHtml("champion");
    return;
  }

  if (myParticipant.status === "pending" && matches) {
    const pos = computeQueuePosition(matches, myParticipant.match_id);
    statusEl.innerHTML = pos ? ui.icon("target") + `排隊中，你是第 ${pos} 位等待上場` : statusHtml("pending");
  } else {
    statusEl.innerHTML = statusHtml(myParticipant.status);
  }
  // 只在這裡設定一次，不要先在函式開頭藏起來又在這裡顯示，兩次設定中間如果剛好碰到 await 讓瀏覽器畫面重繪，
  // 就會真的看到按鈕閃一下消失又出現。整個函式改成每個分支各自只設定一次最終結果。
  // waiting/pending 都還沒進到自己的對戰(還沒 finalizeDiceState 算防禦骰次數)，這時候換職業都還來得及。
  const stillBeforeOwnMatch = ["waiting", "pending"].includes(myParticipant.status);
  quitBtn.style.display = stillBeforeOwnMatch ? "inline-flex" : "none";
  classBtn.style.display = stillBeforeOwnMatch && classesEnabled(ev) ? "inline-flex" : "none";
  pulse();
}

// 報名後想換職業:跟首頁 pickClass() 同一份 ui.CLASS_NAME/CLASS_ICON/CLASS_DESC，只是這裡開賽前隨時可以再叫出來
function pickClassLobby() {
  const box = document.getElementById("class-options");
  box.innerHTML = "";
  Object.keys(ui.CLASS_NAME).forEach((key) => {
    const card = document.createElement("div");
    card.className = "card";
    card.style.cssText = "margin:0;padding:14px 12px;text-align:center;cursor:pointer;";
    card.innerHTML = `
      <div style="color:var(--gold);">${ui.icon(ui.CLASS_ICON[key], { size: "26px" })}</div>
      <div style="font-weight:700;margin:8px 0 6px;">${ui.CLASS_NAME[key]}</div>
      <div style="font-size:10px;color:var(--ink-dim);line-height:1.6;">${ui.esc(ui.CLASS_DESC[key])}</div>
    `;
    card.onclick = () => {
      document.getElementById("class-modal").classList.remove("show");
      if (window._lobbyClassResolve) window._lobbyClassResolve(key);
    };
    box.appendChild(card);
  });
  document.getElementById("class-modal").classList.add("show");
  return new Promise((resolve) => {
    window._lobbyClassResolve = resolve;
  });
}

document.getElementById("class-btn").innerHTML = ui.icon("refresh-ccw") + "更換職業";
document.getElementById("class-btn").onclick = async () => {
  const local = db.getLocalPlayer();
  if (!local.id) return;
  const chosen = await pickClassLobby();
  if (!chosen) return;
  const btn = document.getElementById("class-btn");
  btn.disabled = true;
  try {
    await db.setPlayerClass(eventId, local.id, chosen);
    if (myParticipant) myParticipant.class = chosen;
  } catch (e) {
    await ui.alert("更換失敗:" + (e.message || "未知錯誤"), { title: "操作失敗", tone: "danger" });
  } finally {
    btn.disabled = false;
  }
};
document.getElementById("class-modal-close-btn").onclick = () => {
  document.getElementById("class-modal").classList.remove("show");
  if (window._lobbyClassResolve) window._lobbyClassResolve(null);
};

document.getElementById("quit-btn").innerHTML = ui.icon("door-open") + "退出比賽";
document.getElementById("quit-btn").onclick = async () => {
  const local = db.getLocalPlayer();
  if (!local.id) return;
  const ok = await ui.confirm("退出後如果想再參加，要重新報名一次。", {
    title: "確定要退出這場比賽嗎?",
    confirmText: "退出比賽",
    tone: "danger",
  });
  if (!ok) return;
  const btn = document.getElementById("quit-btn");
  btn.disabled = true;
  try {
    await db.quitEvent(eventId, local.id);
    location.href = "index.html";
  } catch (e) {
    await ui.alert("退出失敗:" + (e.message || "未知錯誤"), { title: "操作失敗", tone: "danger" });
    btn.disabled = false;
  }
};

function stopBackgroundSync() {
  if (advanceInterval) clearInterval(advanceInterval);
  advanceInterval = null;
  if (unsubLeaderAdvance) unsubLeaderAdvance();
  unsubLeaderAdvance = null;
  if (pollDebounceTimer) clearTimeout(pollDebounceTimer);
  pollDebounceTimer = null;
}

let pollBusy = false;
let pollDebounceTimer = null;

// realtime事件密集連續觸發時(例如好幾個人幾乎同時完成報名/對戰同時結束)，
// 把短時間內的好幾次通知合併成一次真正的poll，不要每筆變化都各自觸發一次重新抓取+重新render。
function schedulePoll(ev) {
  if (pollDebounceTimer) clearTimeout(pollDebounceTimer);
  pollDebounceTimer = setTimeout(() => {
    pollDebounceTimer = null;
    poll(ev);
  }, 120);
}

// 賽程推進/看門狗:這兩個本質上是「多久沒人動就要自動處理」的時間判定，沒辦法只靠realtime事件觸發
// (「什麼都沒發生」本來就不會有資料變化事件)，所以還是需要一個背景計時器。但不需要每個開著這頁的
// 分頁都各自跑一份——用跟拍賣頁一樣的 electLeader，同一場賽事只有1個分頁真的在跑，其他分頁被動接收
// matches/event_participants 的 realtime 更新就好，不用重複輪詢。
async function advanceTick(ev) {
  if (!isAdvanceLeader || !ev.locked || ev.status === "closed") return;
  try {
    await db.activateNextMatch(eventId);
  } catch (e) {}
  try {
    await db.watchdogActiveMatch(eventId);
  } catch (e) {}
}

// 純粹的「重新抓資料+重render」，不再夾帶推進賽程的副作用，也不再靠固定週期觸發——
// 改成只在 realtime 通知資料真的變了，或分頁切回前景時才呼叫。
async function poll(ev) {
  if (pollBusy) return; // 避免 realtime callback 跟切分頁同時觸發，互相干擾造成畫面閃爍或漏掉導向
  pollBusy = true;
  try {
    const matches = ev.locked ? await db.listMatches(eventId) : [];
    const activeMatch = matches.find((m) => m.status === "active") || null;
    await checkMyStatus(ev, matches);
    await renderStatusBanner(ev, activeMatch);
    renderLivePanel(ev, activeMatch);
    await renderBracket(ev);
  } finally {
    pollBusy = false;
  }
}

const RULE_EXPLAIN = {
  item_die: ["道具骰", "每逢第 3 回合，雙方各自隨機獲得一個道具:爆擊(+2傷害，法師+3)、回血(+2HP，法師+3)、必中(平手你贏)、封印(對方少受1傷)。"],
  field_mod: ["戰場修飾骰", "開局隨機決定場地效果，6選1:熾熱(全場傷害+1)、堅盾(防禦骰+1次)、嗜血(擊中回血1)、混沌(平手傷害變2點)、疾風(思考時間縮短到15秒)、暗影(道具骰爆擊加成翻倍但防禦骰-1)，整場固定，除非同時開動態戰場。"],
  dynamic_field: ["動態戰場", "戰場特性每回合都重新隨機一次，而不是整場固定一種(需同時開啟戰場修飾骰)。"],
  free_bet: ["自由加注", "不限血量都能加倍賭注，整場最多使用 2 次(跟背水一戰是不同資源，各自獨立計算)。"],
  rage: ["怒氣值", "連續輸 2 局，下次獲勝額外多 +2 傷害。"],
  stance: ["出招姿態", "每回合可選猛攻(獲勝多+1傷害，鬥士+2，HP低於40%再更高;落敗多扣1血)或穩紮穩打(獲勝落敗傷害都減半)。"],
  combo: ["連擊值", "連續獲勝累積連擊層數(每贏1局+1層，刺客+2層)，每滿3層永久+1傷害，斷連只歸零層數，永久加成不受影響。"],
  dice_gamble: ["雙骰豪賭", "出招前可選擇改擲2顆骰子取總和(2~12點)，一般職業整場限2次，賭徒不限次數。"],
  sudden_death: ["生死局", "雙方 HP 都低於 20% 時自動啟動，該回合傷害固定雙倍。"],
  classes: ["職業系統", "報名時需選一個職業:鬥士、守衛、賭徒、刺客、法師、幸運兒，各有被動與大招，克制循環額外+1傷害。"],
  betting: ["觀眾下注", "觀戰的人可以投票猜誰會贏，純娛樂不影響勝負。"],
  reactions: ["表情彈幕", "對戰中或觀戰時都能發送表情圖示。"],
};

function renderRules(ev) {
  const box = document.getElementById("rule-content");
  let html = `<h4>賽制</h4>`;
  html += `<p>依報名人數自動排出勝部賽程，一路淘汰晉級。</p>`;
  html += ev.losers_bracket
    ? `<p>本場活動有開啟敗部復活賽:勝部輸一場會先掉進敗部繼續打，敗部再輸一場才真的淘汰。最後勝部冠軍會和敗部冠軍打一場總冠軍賽，單場定生死。</p>`
    : `<p>本場活動是單敗淘汰制:輸一場就直接出局。</p>`;

  html += `<h4>玩法</h4>`;
  if (ev.game_type === "dice") {
    html += `<p>雙方各 30 點 HP，輪流擲骰(1~6)，點數高扣對方「點差」血;平手雙方各扣1血。每人2次防禦骰(一次只能擋一局，若那局你會輸則傷害完全免疫);HP≤40%(12血以下)可開背水一戰，該局傷害雙倍，不限次數。每回合有時間限制(通常30秒，戰場「疾風」時15秒)，超時系統自動幫你出普通招式。</p>`;
    const rules = ev.rules || {};
    Object.keys(rules)
      .filter((k) => rules[k])
      .forEach((k) => {
        const item = RULE_EXPLAIN[k];
        const meta = ui.RULE[k];
        if (item) {
          html += `<p><b style="color:var(--ink);">${meta ? ui.icon(meta.icon) + " " : ""}${item[0]}</b><br/>${item[1]}</p>`;
        }
      });
  } else {
    html += `<p>雙方各 10 點 HP，3秒內選手勢(石頭/布/剪刀/蜥蜴/史波克)，超時判負。每人1張究極手勢卡，出牌保證獲勝該局(除非雙方同局都用則平手)。HP≤3時，獲勝的那一擊傷害雙倍。</p>`;
  }
  box.innerHTML = html;
}

function bindRuleModal(ev) {
  document.getElementById("rule-fab-btn").innerHTML = ui.icon("book-open") + '<span class="fab-label">規則說明</span>';
  document.getElementById("rule-fab-btn").onclick = () => {
    renderRules(ev);
    document.getElementById("rule-modal").classList.add("show");
  };
  document.getElementById("rule-close-btn").onclick = () => {
    document.getElementById("rule-modal").classList.remove("show");
  };
}

(async function init() {
  if (!eventId) {
    location.href = "index.html";
    return;
  }
  const ev = await loadEvent();
  if (!ev) {
    await ui.alert("這場活動已經不存在了(可能已被主辦人刪除)，帶你回首頁。", {
      title: "找不到這場活動",
      tone: "danger",
    });
    location.href = "index.html";
    return;
  }
  currentEv = ev;
  bindRuleModal(ev);
  await poll(ev);

  unsubLeaderAdvance = db.electLeader(`lobby-advance-${eventId}`, (leader) => {
    isAdvanceLeader = leader;
  });
  advanceInterval = setInterval(() => advanceTick(ev), 4000);
  advanceTick(ev); // 不用等第一次計時器才推進，選出隊長後馬上跑一次

  unsub1 = db.onTableChange("event_participants", `event_id=eq.${eventId}`, () => schedulePoll(ev));
  unsub2 = db.onTableChange("matches", `event_id=eq.${eventId}`, () => schedulePoll(ev));

  // 分頁從背景切回前景時，馬上補一次資料+推進判定，避免手機瀏覽器把背景分頁的
  // 計時器/realtime連線凍結導致畫面卡在舊狀態(realtime重連後漏掉的變化也靠這個補回來)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      poll(ev);
      advanceTick(ev);
    }
  });
})();

window.addEventListener("beforeunload", () => {
  db.cancelAllRequests();
  if (unsub1) unsub1();
  if (unsub2) unsub2();
  stopBackgroundSync();
  teardownLivePanel();
});
