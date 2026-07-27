const params = new URLSearchParams(location.search);
const eventId = params.get("event");
let myParticipant = null;
let pollTimer = null;
let unsub1 = null;
let unsub2 = null;
let currentEv = null;

const GAME_LABEL = { dice: "🎲 骰子對戰", rps5: "✂️ 五手勢對戰" };
const GAME_PAGE = { dice: "dice.html", rps5: "rps5.html" };
const BRACKET_ORDER = { winners: 0, losers: 1, final: 2 };
const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

let pulseActive = false;
function pulse() {
  if (pulseActive) return; // 已經在跑了,不要每次輪詢都重新歸零重跑,避免畫面一直跳動
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
  if (!rank) return "";
  if (MEDAL[rank]) return `<span class="rank-badge top3">${MEDAL[rank]}</span> `;
  return `<span class="rank-badge">第${rank}名</span> `;
}

async function loadEvent() {
  const ev = await db.getEventSafe(eventId);
  if (!ev) return null;
  document.getElementById("event-title").textContent = ev.name;
  document.getElementById("event-game-tag").textContent = GAME_LABEL[ev.game_type] || ev.game_type;
  return ev;
}

function roundLabel(round, totalRounds) {
  if (round === totalRounds) return "🏆 決賽";
  if (round === totalRounds - 1) return "準決賽";
  return `第 ${round} 輪`;
}

function matchRowHtml(m, ev, fallbackDoneText) {
  const n1 = m.p1?.name || (m.status === "pending" ? "待定" : fallbackDoneText || "?");
  const n2 = m.p2?.name || (m.status === "pending" ? "待定" : fallbackDoneText || "?");
  const w1 = m.winner_id && m.winner_id === m.player1_id;
  const w2 = m.winner_id && m.winner_id === m.player2_id;
  const isLive = m.status === "active";
  return `<div class="bracket-row${isLive ? " live" : ""}">${isLive ? "🔴 " : ""}<span class="${w1 ? "win" : m.winner_id ? "lose" : ""}">${n1}</span><span style="color:var(--ink-dim);">vs</span><span class="${w2 ? "win" : m.winner_id ? "lose" : ""}">${n2}</span>${isLive ? '<span style="font-size:11px;color:var(--red);">直播中↑</span>' : ""}</div>`;
}

async function renderBracket(ev) {
  const box = document.getElementById("bracket-list");
  const parts = await db.listParticipants(eventId);

  if (!parts.length) {
    box.innerHTML = `<div class="empty">還沒有人參加</div>`;
    return;
  }

  if (!ev.locked) {
    box.innerHTML =
      `<div class="empty">報名中,已有 ${parts.length} 人參加,等主辦人鎖定名單開賽</div>` +
      parts.map((p) => `<div class="bracket-row"><span>${p.players.name}</span></div>`).join("");
    return;
  }

  const matches = await db.listMatches(eventId);
  const wbMatches = matches.filter((m) => m.bracket === "winners");
  const lbMatches = matches.filter((m) => m.bracket === "losers");
  const finalMatch = matches.find((m) => m.bracket === "final");
  const totalRounds = wbMatches.length ? Math.max(...wbMatches.map((m) => m.round)) : 0;

  let html = "";

  const champion = parts.find((p) => p.status === "champion");
  if (champion) {
    html += `<div class="bracket-row" style="background:rgba(242,183,5,.1);border-radius:8px;padding:8px 10px;border:1px solid var(--gold-d);"><span class="win">🥇 冠軍・${champion.players.name}</span><span></span></div>`;
  }

  html += `<h3 style="font-size:13px;color:var(--ink-dim);margin-top:14px;">勝部賽程</h3>`;
  for (let r = 1; r <= totalRounds; r++) {
    const rows = wbMatches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
    const big = r >= totalRounds - 1;
    html += `<div style="font-size:${big ? "13px" : "11px"};color:${big ? "var(--gold)" : "var(--ink-dim)"};font-weight:${big ? "700" : "400"};margin:10px 0 4px;">${roundLabel(r, totalRounds)}</div>`;
    rows.forEach((m) => (html += matchRowHtml(m, ev, "輪空")));
  }

  if (ev.losers_bracket) {
    html += `<h3 style="font-size:13px;color:var(--ink-dim);margin-top:16px;">敗部復活賽戰況</h3>`;
    if (!lbMatches.length) {
      html += `<div class="status-msg" style="margin:4px 0;">還沒有人掉入敗部</div>`;
    } else {
      lbMatches
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .forEach((m) => (html += matchRowHtml(m, ev)));
    }
  }

  if (finalMatch) {
    html += `<h3 style="font-size:13px;color:var(--gold);margin-top:16px;">🏆 總冠軍賽</h3>`;
    html += matchRowHtml(finalMatch, ev);
  }

  const eliminated = parts.filter((p) => p.status === "eliminated").sort((a, b) => (a.final_rank || 99) - (b.final_rank || 99));
  if (eliminated.length) {
    html += `<h3 style="font-size:13px;color:var(--ink-dim);margin-top:16px;">已出局</h3>`;
    eliminated.forEach((p) => {
      html += `<div class="bracket-row"><span class="lose">${rankBadge(p.final_rank)}${p.players.name}</span><span class="mono" style="font-size:12px;">${p.reward ? "🎁 " + p.reward : ""}</span></div>`;
    });
  }

  box.innerHTML = html;
}

// ---------- 內嵌直播面板:不用另外開分頁就能看到目前這場對戰的即時比分 ----------
let currentLiveMatchId = null;

function renderLivePanel(ev, m) {
  const box = document.getElementById("live-panel-box");
  if (!m) {
    if (currentLiveMatchId !== null) box.innerHTML = "";
    currentLiveMatchId = null;
    return;
  }
  if (currentLiveMatchId === m.id) return; // 同一場對戰,iframe內部自己會即時更新,不要重建它(重建會閃爍/重新連線)
  currentLiveMatchId = m.id;
  const page = GAME_PAGE[ev.game_type];
  box.innerHTML = `
    <div class="live-panel" style="padding:0;overflow:hidden;">
      <div class="live-tag" style="margin:12px 12px 0;"><span class="dot"></span>直播中・${GAME_LABEL[ev.game_type]}・不用開新分頁,直接在這裡看完整對戰</div>
      <iframe src="${page}?match=${m.id}&event=${eventId}" style="width:100%;height:840px;border:0;display:block;margin-top:6px;background:transparent;" title="live-match"></iframe>
    </div>
  `;
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
    box.innerHTML = `<div class="status-banner idle">⏳ 目前沒有對戰進行中,系統排程中...</div>`;
    return;
  }
  const n1 = activeMatch.p1?.name || "?";
  const n2 = activeMatch.p2?.name || "?";
  const amPlaying = myParticipant && myParticipant.match_id === activeMatch.id && myParticipant.status === "matched";
  if (amPlaying) {
    box.innerHTML = `<div class="status-banner live">🔴 輪到你了!正在對戰:${n1} vs ${n2}</div>`;
  } else {
    box.innerHTML = `<div class="status-banner live">🔴 正在進行中:${n1} vs ${n2}</div>`;
  }
}

const STATUS_TEXT = {
  waiting: "等待配對中,找到對手會自動帶你進場",
  pending: "已排進賽程,前面的對戰結束後會自動帶你進場...",
  matched: "配對成功!進入對戰...",
  wb_champion: "🏆 你打進了總冠軍賽!等待敗部冠軍產生...",
  lb_champion: "🏆 你從敗部殺出重圍!等待總冠軍賽開打...",
  champion: "🏆 恭喜你是本場活動冠軍!",
};

let redirecting = false;

async function checkMyStatus(ev, matches) {
  const local = db.getLocalPlayer();
  const statusEl = document.getElementById("my-status");
  const quitBtn = document.getElementById("quit-btn");

  if (!local.id) {
    statusEl.innerHTML = `👀 觀戰模式,你目前沒有報名這場活動`;
    quitBtn.style.display = "none";
    stopPulse();
    return;
  }

  myParticipant = await db.getMyParticipant(eventId, local.id);
  if (!myParticipant) {
    statusEl.innerHTML = `👀 觀戰模式,你目前沒有報名這場活動`;
    quitBtn.style.display = "none";
    stopPulse();
    return;
  }

  if (!ev.locked) {
    statusEl.textContent = "已報名,等主辦人鎖定名單開賽";
    quitBtn.style.display = "inline-block";
    pulse();
    return;
  }

  if (myParticipant.status === "matched" && myParticipant.match_id) {
    if (redirecting) return;
    redirecting = true;
    clearInterval(pollTimer);
    stopPulse();
    quitBtn.style.display = "none";
    statusEl.textContent = STATUS_TEXT.matched;
    location.href = `${GAME_PAGE[ev.game_type]}?match=${myParticipant.match_id}&event=${eventId}`;
    return;
  }

  if (myParticipant.status === "eliminated") {
    clearInterval(pollTimer);
    stopPulse();
    quitBtn.style.display = "none";
    statusEl.innerHTML = myParticipant.reward
      ? `${rankBadge(myParticipant.final_rank)}你已出局。獲得獎勵 🎁 <b style="color:var(--gold)">${myParticipant.reward}</b>`
      : `${rankBadge(myParticipant.final_rank)}你已出局,感謝參加!獎勵確認後會顯示在這裡`;
    return;
  }

  if (myParticipant.status === "champion") {
    clearInterval(pollTimer);
    stopPulse();
    quitBtn.style.display = "none";
    statusEl.innerHTML = myParticipant.reward
      ? `🥇 恭喜奪冠!獎勵 🎁 <b style="color:var(--gold)">${myParticipant.reward}</b>`
      : STATUS_TEXT.champion;
    return;
  }

  if (myParticipant.status === "pending" && matches) {
    const pos = computeQueuePosition(matches, myParticipant.match_id);
    statusEl.textContent = pos ? `🎯 排隊中,你是第 ${pos} 位等待上場` : STATUS_TEXT.pending;
  } else {
    statusEl.textContent = STATUS_TEXT[myParticipant.status] || "狀態確認中...";
  }
  // 只在這裡設定一次,不要先在函式開頭藏起來又在這裡顯示,兩次設定中間如果剛好碰到 await 讓瀏覽器畫面重繪,
  // 就會真的看到按鈕閃一下消失又出現。整個函式改成每個分支各自只設定一次最終結果。
  quitBtn.style.display = ["waiting", "pending"].includes(myParticipant.status) ? "inline-block" : "none";
  pulse();
}

document.getElementById("quit-btn").onclick = async () => {
  const local = db.getLocalPlayer();
  if (!local.id) return;
  if (!confirm("確定要退出這場比賽嗎?退出後如果想再參加要重新報名。")) return;
  const btn = document.getElementById("quit-btn");
  btn.disabled = true;
  try {
    await db.quitEvent(eventId, local.id);
    location.href = "index.html";
  } catch (e) {
    alert("退出失敗:" + (e.message || "未知錯誤"));
    btn.disabled = false;
  }
};

let pollBusy = false;

async function poll(ev) {
  if (pollBusy) return; // 避免計時器/即時訂閱/切分頁同時觸發,互相干擾造成畫面閃爍或漏掉導向
  pollBusy = true;
  try {
    if (ev.locked && ev.status !== "closed") {
      try {
        await db.activateNextMatch(eventId);
      } catch (e) {}
      try {
        await db.watchdogActiveMatch(eventId);
      } catch (e) {}
    }
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
  item_die: ["🎁 道具骰", "每逢第 3 回合,雙方各自隨機獲得一個道具:爆擊(+2傷害)、回血(+2HP)、必中(平手你贏)、封印(對方少受1傷)。"],
  field_mod: ["🌪️ 戰場修飾骰", "開局隨機決定場地效果:全場傷害+1,或防禦骰次數變2次,整場固定不變。"],
  free_bet: ["🎰 自由加注", "不限血量都能加倍賭注,整場最多使用 2 次。"],
  rage: ["🔥 怒氣值", "連續輸 2 局,下次獲勝額外多 +2 傷害。"],
};

function renderRules(ev) {
  const box = document.getElementById("rule-content");
  let html = `<h4>賽制</h4>`;
  html += `<p>依報名人數自動排出勝部賽程,一路淘汰晉級。</p>`;
  html += ev.losers_bracket
    ? `<p>本場活動有開啟🥈敗部復活賽:勝部輸一場會先掉進敗部繼續打,敗部再輸一場才真的淘汰。最後勝部冠軍會和敗部冠軍打一場總冠軍賽,單場定生死。</p>`
    : `<p>本場活動是單敗淘汰制:輸一場就直接出局。</p>`;

  html += `<h4>玩法</h4>`;
  if (ev.game_type === "dice") {
    html += `<p>雙方各 12 點 HP,輪流擲骰(1~6),點數高扣對方「點差」血;平手雙方各扣1血。每人1次防禦骰(可完全擋一次傷害);HP≤5可背水一戰,該局傷害雙倍。</p>`;
    const rules = ev.rules || {};
    Object.keys(rules).filter((k) => rules[k]).forEach((k) => {
      const item = RULE_EXPLAIN[k];
      if (item) html += `<p><b style="color:var(--ink);">${item[0]}</b><br/>${item[1]}</p>`;
    });
  } else {
    html += `<p>雙方各 10 點 HP,3秒內選手勢(石頭/布/剪刀/蜥蜴/史波克),超時判負。每人1張究極手勢卡,出牌保證獲勝該局(除非雙方同局都用則平手)。HP≤3時,獲勝的那一擊傷害雙倍。</p>`;
  }
  box.innerHTML = html;
}

function bindRuleModal(ev) {
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
    alert("這場活動已經不存在了(可能已被主辦人刪除),帶你回首頁。");
    location.href = "index.html";
    return;
  }
  currentEv = ev;
  bindRuleModal(ev);
  await poll(ev);

  pollTimer = setInterval(() => poll(ev), 2500);

  unsub1 = db.onTableChange("event_participants", `event_id=eq.${eventId}`, () => poll(ev));
  unsub2 = db.onTableChange("matches", `event_id=eq.${eventId}`, () => poll(ev));

  // 分頁從背景切回前景時,馬上刷新一次,避免手機瀏覽器把背景分頁的計時器/連線凍結導致畫面卡在舊狀態
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") poll(ev);
  });
})();

window.addEventListener("beforeunload", () => {
  if (unsub1) unsub1();
  if (unsub2) unsub2();
});
