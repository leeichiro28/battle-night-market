const params = new URLSearchParams(location.search);
const eventId = params.get("event");
let myParticipant = null;
let pollTimer = null;
let unsub1 = null;
let unsub2 = null;

const GAME_LABEL = { dice: "🎲 骰子對戰", rps5: "✂️ 五手勢對戰" };
const GAME_PAGE = { dice: "dice.html", rps5: "rps5.html" };

function pulse() {
  const bar = document.getElementById("pulse-bar");
  let w = 0;
  clearInterval(window._pulseTimer);
  window._pulseTimer = setInterval(() => {
    w = (w + 4) % 100;
    bar.style.width = w + "%";
  }, 80);
}

async function loadEvent() {
  const ev = await db.getEvent(eventId);
  document.getElementById("event-title").textContent = ev.name;
  document.getElementById("event-game-tag").textContent = GAME_LABEL[ev.game_type] || ev.game_type;
  return ev;
}

function roundLabel(round, totalRounds) {
  if (round === totalRounds) return "決賽";
  if (round === totalRounds - 1) return "準決賽";
  return `第 ${round} 輪`;
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
    html += `<div class="bracket-row"><span class="win">🏆 冠軍・${champion.players.name}</span><span></span></div>`;
  }

  html += `<h3 style="font-size:13px;color:var(--ink-dim);margin-top:14px;">勝部賽程</h3>`;
  for (let r = 1; r <= totalRounds; r++) {
    const rows = wbMatches.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
    html += `<div style="font-size:11px;color:var(--ink-dim);margin:8px 0 4px;">${roundLabel(r, totalRounds)}</div>`;
    rows.forEach((m) => {
      const n1 = m.p1?.name || (m.status === "pending" ? "待定" : "輪空");
      const n2 = m.p2?.name || (m.status === "pending" ? "待定" : "輪空");
      const w1 = m.winner_id && m.winner_id === m.player1_id;
      const w2 = m.winner_id && m.winner_id === m.player2_id;
      html += `<div class="bracket-row"><span class="${w1 ? "win" : m.winner_id ? "lose" : ""}">${n1}</span><span style="color:var(--ink-dim);">vs</span><span class="${w2 ? "win" : m.winner_id ? "lose" : ""}">${n2}</span></div>`;
    });
  }

  if (ev.losers_bracket) {
    html += `<h3 style="font-size:13px;color:var(--ink-dim);margin-top:16px;">敗部復活賽戰況</h3>`;
    if (!lbMatches.length) {
      html += `<div class="status-msg" style="margin:4px 0;">還沒有人掉入敗部</div>`;
    } else {
      lbMatches
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .forEach((m) => {
          const n1 = m.p1?.name || "?";
          const n2 = m.p2?.name || "?";
          const w1 = m.winner_id && m.winner_id === m.player1_id;
          const w2 = m.winner_id && m.winner_id === m.player2_id;
          html += `<div class="bracket-row"><span class="${w1 ? "win" : m.winner_id ? "lose" : ""}">${n1}</span><span style="color:var(--ink-dim);">vs</span><span class="${w2 ? "win" : m.winner_id ? "lose" : ""}">${n2}</span></div>`;
        });
    }
  }

  if (finalMatch) {
    html += `<h3 style="font-size:13px;color:var(--ink-dim);margin-top:16px;">🏆 總冠軍賽</h3>`;
    const n1 = finalMatch.p1?.name || "?";
    const n2 = finalMatch.p2?.name || "?";
    const w1 = finalMatch.winner_id && finalMatch.winner_id === finalMatch.player1_id;
    const w2 = finalMatch.winner_id && finalMatch.winner_id === finalMatch.player2_id;
    html += `<div class="bracket-row"><span class="${w1 ? "win" : finalMatch.winner_id ? "lose" : ""}">${n1}</span><span style="color:var(--ink-dim);">vs</span><span class="${w2 ? "win" : finalMatch.winner_id ? "lose" : ""}">${n2}</span></div>`;
  }

  const eliminated = parts.filter((p) => p.status === "eliminated").sort((a, b) => new Date(b.eliminated_at) - new Date(a.eliminated_at));
  if (eliminated.length) {
    html += `<h3 style="font-size:13px;color:var(--ink-dim);margin-top:16px;">已出局</h3>`;
    eliminated.forEach((p) => {
      html += `<div class="bracket-row"><span class="lose">${p.players.name}</span><span class="mono" style="font-size:12px;">${p.final_rank ? "第" + p.final_rank + "名 " : ""}${p.reward ? "🎁 " + p.reward : ""}</span></div>`;
    });
  }

  box.innerHTML = html;
}

const STATUS_TEXT = {
  waiting: "等待配對中,找到對手會自動帶你進場",
  pending: "已排進賽程,等待對手產生中...",
  matched: "配對成功!進入對戰...",
  wb_champion: "🏆 你打進了總冠軍賽!等待敗部冠軍產生...",
  lb_champion: "🏆 你從敗部殺出重圍!等待總冠軍賽開打...",
  champion: "🏆 恭喜你是本場活動冠軍!",
};

async function checkMyStatus(ev) {
  const local = db.getLocalPlayer();
  if (!local.id) {
    location.href = "index.html";
    return;
  }
  myParticipant = await db.getMyParticipant(eventId, local.id);
  if (!myParticipant) {
    location.href = "index.html";
    return;
  }

  const statusEl = document.getElementById("my-status");

  if (!ev.locked) {
    statusEl.textContent = "已報名,等主辦人鎖定名單開賽";
    pulse();
    return;
  }

  if (myParticipant.status === "matched" && myParticipant.match_id) {
    clearInterval(pollTimer);
    clearInterval(window._pulseTimer);
    statusEl.textContent = STATUS_TEXT.matched;
    location.href = `${GAME_PAGE[ev.game_type]}?match=${myParticipant.match_id}&event=${eventId}`;
    return;
  }

  if (myParticipant.status === "eliminated") {
    clearInterval(pollTimer);
    clearInterval(window._pulseTimer);
    statusEl.innerHTML = myParticipant.reward
      ? `你已出局(${myParticipant.final_rank ? "第" + myParticipant.final_rank + "名" : ""})。獲得獎勵 🎁 <b style="color:var(--gold)">${myParticipant.reward}</b>`
      : "你已出局,感謝參加!獎勵確認後會顯示在這裡";
    return;
  }

  if (myParticipant.status === "champion") {
    clearInterval(pollTimer);
    clearInterval(window._pulseTimer);
    statusEl.innerHTML = myParticipant.reward
      ? `🏆 恭喜奪冠!獎勵 🎁 <b style="color:var(--gold)">${myParticipant.reward}</b>`
      : STATUS_TEXT.champion;
    return;
  }

  statusEl.textContent = STATUS_TEXT[myParticipant.status] || "狀態確認中...";
  pulse();
}

async function poll(ev) {
  if (myParticipant && myParticipant.status === "waiting" && ev.locked) {
    try {
      await db.tryMatch(eventId, ev.game_type, "losers");
    } catch (e) {}
  }
  await checkMyStatus(ev);
  await renderBracket(ev);
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
  bindRuleModal(ev);
  await checkMyStatus(ev);
  await renderBracket(ev);

  pollTimer = setInterval(() => poll(ev), 2500);

  unsub1 = db.onTableChange("event_participants", `event_id=eq.${eventId}`, () => {
    checkMyStatus(ev);
    renderBracket(ev);
  });
  unsub2 = db.onTableChange("matches", `event_id=eq.${eventId}`, () => {
    renderBracket(ev);
  });
})();

window.addEventListener("beforeunload", () => {
  if (unsub1) unsub1();
  if (unsub2) unsub2();
});
