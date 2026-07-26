const GAME_LABEL = { dice: "🎲 骰子對戰", rps5: "✂️ 五手勢對戰" };
const GAME_PAGE = { dice: "dice.html", rps5: "rps5.html" };
const STATUS_LABEL = { open: "開放參加", running: "進行中", closed: "已結束" };
const RULE_LABEL = { item_die: "🎁道具骰", field_mod: "🌪️戰場修飾", free_bet: "🎰自由加注", rage: "🔥怒氣值" };
const MEDAL = { 1: "🥇", 2: "🥈", 3: "🥉" };

document.getElementById("new-type").onchange = (e) => {
  document.getElementById("dice-rules-box").style.display = e.target.value === "dice" ? "block" : "none";
};

// ---------- 獎勵設定區 ----------
let rewardMode = "manual";

function renderManualRewardInputs() {
  const n = Math.max(1, Math.min(5, parseInt(document.getElementById("new-ranks").value) || 1));
  const box = document.getElementById("manual-reward-box");
  box.innerHTML = "";
  for (let i = 1; i <= n; i++) {
    const field = document.createElement("div");
    field.className = "field";
    field.innerHTML = `
      <label style="font-size:12px;">${MEDAL[i] || "🎖️"} 第 ${i} 名獎勵</label>
      <input class="manual-reward-input" data-rank="${i}" placeholder="例如:傳說之劍 x1" />
    `;
    box.appendChild(field);
  }
}

// 自動分配可以有多項獎勵(例如:金幣 + 藥水),每項各自依名次分配
let autoRewardRowSeq = 0;

function addAutoRewardRow(label = "", total = "") {
  const list = document.getElementById("auto-reward-list");
  const rowId = `auto-reward-row-${autoRewardRowSeq++}`;
  const row = document.createElement("div");
  row.className = "field";
  row.dataset.rowId = rowId;
  row.style.display = "flex";
  row.style.gap = "6px";
  row.style.alignItems = "flex-end";
  row.innerHTML = `
    <div style="flex:1;">
      <label style="font-size:12px;">獎勵名稱</label>
      <input class="auto-reward-label" placeholder="例如:金幣" value="${label}" />
    </div>
    <div style="flex:1;">
      <label style="font-size:12px;">總數量(依名次分配,第1名分最多)</label>
      <input type="number" class="auto-reward-total" placeholder="例如:100" value="${total}" />
    </div>
    <button type="button" class="btn ghost small remove-auto-reward-btn" style="color:var(--red);border-color:var(--red);">刪除</button>
  `;
  row.querySelector(".remove-auto-reward-btn").onclick = () => {
    const rows = document.querySelectorAll("#auto-reward-list > div");
    if (rows.length <= 1) {
      // 至少留一行,直接清空內容就好
      row.querySelector(".auto-reward-label").value = "";
      row.querySelector(".auto-reward-total").value = "";
      return;
    }
    row.remove();
  };
  list.appendChild(row);
}

function resetAutoRewardRows() {
  document.getElementById("auto-reward-list").innerHTML = "";
  addAutoRewardRow();
}

function collectAutoRewardEntries() {
  const entries = [];
  document.querySelectorAll("#auto-reward-list > div").forEach((row) => {
    const label = row.querySelector(".auto-reward-label").value.trim();
    const total = parseInt(row.querySelector(".auto-reward-total").value);
    if (label && total) entries.push({ label, total });
  });
  return entries;
}

document.getElementById("add-auto-reward-btn").onclick = () => addAutoRewardRow();
resetAutoRewardRows();

function setRewardMode(mode) {
  rewardMode = mode;
  document.getElementById("mode-manual-btn").style.background = mode === "manual" ? "var(--gold)" : "";
  document.getElementById("mode-manual-btn").style.color = mode === "manual" ? "#1B1706" : "";
  document.getElementById("mode-auto-btn").style.background = mode === "auto" ? "var(--gold)" : "";
  document.getElementById("mode-auto-btn").style.color = mode === "auto" ? "#1B1706" : "";
  document.getElementById("manual-reward-box").style.display = mode === "manual" ? "block" : "none";
  document.getElementById("auto-reward-box").style.display = mode === "auto" ? "block" : "none";
}
document.getElementById("mode-manual-btn").onclick = () => setRewardMode("manual");
document.getElementById("mode-auto-btn").onclick = () => setRewardMode("auto");
document.getElementById("new-ranks").onchange = renderManualRewardInputs;
renderManualRewardInputs();
setRewardMode("manual");

// 依名次分配權重:名次越前面分越多(權重 N, N-1 ... 1)
function distributeRewards(total, ranks) {
  const weights = [];
  for (let i = ranks; i >= 1; i--) weights.push(i);
  const sum = weights.reduce((a, b) => a + b, 0);
  const amounts = weights.map((w) => Math.round((total * w) / sum));
  const diff = total - amounts.reduce((a, b) => a + b, 0);
  amounts[0] += diff;
  return amounts;
}

function buildRewardPlan() {
  const ranks = Math.max(1, Math.min(5, parseInt(document.getElementById("new-ranks").value) || 1));
  if (rewardMode === "auto") {
    const entries = collectAutoRewardEntries();
    if (!entries.length) return {};
    // 每一項獎勵各自依名次分配,再把同一名次的多項獎勵合併成一行文字
    const perEntryAmounts = entries.map((e) => distributeRewards(e.total, ranks));
    const items = [];
    for (let i = 0; i < ranks; i++) {
      const parts = entries
        .map((e, idx) => ({ label: e.label, amount: perEntryAmounts[idx][i] }))
        .filter((p) => p.amount > 0)
        .map((p) => `${p.label} x${p.amount}`);
      items[i] = parts.length ? parts.join("、") : null;
    }
    return items.some((x) => x) ? { items } : {};
  }
  const items = [];
  document.querySelectorAll(".manual-reward-input").forEach((inp) => {
    const rank = parseInt(inp.dataset.rank);
    items[rank - 1] = inp.value.trim() || null;
  });
  return items.some((x) => x) ? { items } : {};
}

// ---------- 參加者列表 ----------
function participantRow(row, ev, onKicked) {
  const div = document.createElement("div");
  div.className = "bracket-row";
  div.style.flexWrap = "wrap";
  div.style.gap = "8px";
  const rank = row.final_rank;
  const isTop3 = rank && rank <= 3;
  if (isTop3) {
    div.style.background = "rgba(242,183,5,.08)";
    div.style.borderRadius = "8px";
    div.style.padding = "8px 10px";
    div.style.border = "1px solid var(--gold-d)";
  }

  const label = document.createElement("span");
  const tagText =
    row.status === "champion"
      ? "冠軍"
      : rank
      ? `第 ${rank} 名`
      : row.status === "matched"
      ? "對戰中"
      : row.status === "pending"
      ? "待對手產生"
      : row.status;
  const medal = rank && MEDAL[rank] ? MEDAL[rank] + " " : "";
  const nameSize = isTop3 ? "16px" : "14px";
  label.innerHTML = `${medal}<b style="font-size:${nameSize};">${row.players.name}</b> <span class="mono" style="font-size:11px;color:${isTop3 ? "var(--gold)" : "var(--ink-dim)"};">${tagText}</span>`;

  const inputWrap = document.createElement("div");
  inputWrap.style.display = "flex";
  inputWrap.style.gap = "6px";
  inputWrap.style.flex = "1";
  inputWrap.style.minWidth = "220px";

  const input = document.createElement("input");
  input.placeholder = "輸入獎勵,例如:傳說之劍 x1";
  input.value = row.reward || "";
  input.style.fontSize = "13px";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn small";
  saveBtn.textContent = "儲存";
  saveBtn.onclick = async () => {
    saveBtn.textContent = "儲存中";
    await db.setReward(row.id, input.value.trim());
    saveBtn.textContent = "已儲存";
    setTimeout(() => (saveBtn.textContent = "儲存"), 1200);
  };

  inputWrap.appendChild(input);
  inputWrap.appendChild(saveBtn);

  // 賽程還沒鎖定前,才能踢出參加者(鎖定後名單已產生賽程,不能再改)
  if (!ev.locked) {
    const kickBtn = document.createElement("button");
    kickBtn.className = "btn ghost small";
    kickBtn.textContent = "踢出";
    kickBtn.style.color = "var(--red)";
    kickBtn.style.borderColor = "var(--red)";
    kickBtn.onclick = async () => {
      if (!confirm(`確定要把「${row.players.name}」踢出這場活動嗎?`)) return;
      kickBtn.disabled = true;
      kickBtn.textContent = "踢出中...";
      try {
        await db.removeParticipant(row.id);
        onKicked();
      } catch (e) {
        alert("踢出失敗:" + (e.message || "未知錯誤"));
        kickBtn.disabled = false;
        kickBtn.textContent = "踢出";
      }
    };
    inputWrap.appendChild(kickBtn);
  }

  div.appendChild(label);
  div.appendChild(inputWrap);
  return div;
}

async function renderParticipants(container, ev) {
  container.innerHTML = "";
  const rows = await db.listParticipants(ev.id);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">還沒有人參加</div>`;
    return;
  }
  const champion = rows.find((r) => r.status === "champion");
  const eliminated = rows.filter((r) => r.status === "eliminated").sort((a, b) => (a.final_rank || 99) - (b.final_rank || 99));
  const others = rows.filter((r) => r.status !== "eliminated" && r.status !== "champion");

  const onKicked = () => renderParticipants(container, ev);
  if (champion) container.appendChild(participantRow(champion, ev, onKicked));
  eliminated.forEach((r) => container.appendChild(participantRow(r, ev, onKicked)));
  others.forEach((r) => container.appendChild(participantRow(r, ev, onKicked)));
}

// ---------- 賽程總覽(含觀戰連結、卡住時可強制判定) ----------
function matchRowEl(m, ev, onResolved) {
  const row = document.createElement("div");
  row.className = "bracket-row";
  row.style.flexWrap = "wrap";
  row.style.gap = "6px";
  if (m.status === "active") {
    row.style.background = "rgba(229,72,77,.08)";
    row.style.border = "1px solid var(--red)";
    row.style.borderRadius = "8px";
    row.style.padding = "8px 10px";
  }

  const n1 = m.p1?.name || (m.status === "done" ? "輪空" : "待定");
  const n2 = m.p2?.name || (m.status === "done" ? "輪空" : "待定");
  const top = document.createElement("div");
  top.style.cssText = "display:flex;justify-content:space-between;align-items:center;width:100%;gap:8px;";
  top.innerHTML = `<span>${m.status === "active" ? "🔴 " : ""}${n1}</span><span style="color:var(--ink-dim);">vs</span><span>${n2}</span>`;
  row.appendChild(top);

  if (m.status === "active") {
    const watchA = document.createElement("a");
    watchA.href = `${GAME_PAGE[ev.game_type]}?match=${m.id}&event=${ev.id}`;
    watchA.target = "_blank";
    watchA.style.fontSize = "11px";
    watchA.textContent = "👀 觀戰";
    top.appendChild(watchA);

    if (m.player1_id && m.player2_id) {
      const forceBox = document.createElement("div");
      forceBox.style.cssText = "display:flex;gap:6px;width:100%;margin-top:6px;flex-wrap:wrap;";
      const hint = document.createElement("span");
      hint.style.cssText = "font-size:11px;color:var(--ink-dim);width:100%;";
      hint.textContent = "卡住了嗎?可以在這裡強制判定勝負(用於雙方棄權/連線異常時的緊急處理):";
      forceBox.appendChild(hint);

      [
        [n1, m.player1_id, m.player2_id],
        [n2, m.player2_id, m.player1_id],
      ].forEach(([name, winnerId, loserId]) => {
        const b = document.createElement("button");
        b.className = "btn ghost small";
        b.style.fontSize = "11px";
        b.textContent = `⚖️ 判 ${name} 勝`;
        b.onclick = async () => {
          if (!confirm(`確定要強制判定「${name}」獲勝、直接結束這場對戰嗎?`)) return;
          b.disabled = true;
          try {
            await db.advanceAfterMatch(m, winnerId, loserId);
            onResolved();
          } catch (e) {
            alert("處理失敗:" + (e.message || "未知錯誤"));
            b.disabled = false;
          }
        };
        forceBox.appendChild(b);
      });
      row.appendChild(forceBox);
    }
  }
  return row;
}

async function renderBracketSummary(container, ev) {
  container.innerHTML = "";
  const matches = await db.listMatches(ev.id);
  if (!matches.length) return;

  const onResolved = () => renderBracketSummary(container, ev);
  const wb = matches.filter((m) => m.bracket === "winners");
  const lb = matches.filter((m) => m.bracket === "losers");
  const final = matches.find((m) => m.bracket === "final");
  const totalRounds = wb.length ? Math.max(...wb.map((m) => m.round)) : 0;

  const addHeader = (text, color) => {
    const h = document.createElement("div");
    h.style.cssText = `font-size:11px;color:${color || "var(--ink-dim)"};margin:8px 0 2px;`;
    h.textContent = text;
    container.appendChild(h);
  };

  const title = document.createElement("h3");
  title.style.cssText = "font-size:13px;color:var(--ink-dim);margin:14px 0 4px;";
  title.textContent = "賽程總覽";
  container.appendChild(title);

  for (let r = 1; r <= totalRounds; r++) {
    const rows = wb.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
    const label = r === totalRounds ? "🏆 決賽" : r === totalRounds - 1 ? "準決賽" : `第${r}輪`;
    addHeader(label, r >= totalRounds - 1 ? "var(--gold)" : null);
    rows.forEach((m) => container.appendChild(matchRowEl(m, ev, onResolved)));
  }
  if (lb.length) {
    addHeader("敗部復活賽");
    lb.forEach((m) => container.appendChild(matchRowEl(m, ev, onResolved)));
  }
  if (final) {
    addHeader("🏆 總冠軍賽", "var(--gold)");
    container.appendChild(matchRowEl(final, ev, onResolved));
  }
}

function formatDeadline(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function eventAdminCard(ev) {
  const card = document.createElement("div");
  card.className = "card";
  const ruleTags = Object.keys(ev.rules || {})
    .filter((k) => ev.rules[k])
    .map((k) => `<span class="tag">${RULE_LABEL[k] || k}</span>`)
    .join("");
  const deadlineTxt = formatDeadline(ev.registration_deadline);
  const deadlinePassed = ev.registration_deadline && new Date() > new Date(ev.registration_deadline);
  const isClosed = ev.status === "closed";

  card.innerHTML = `
    <div class="event-card" style="margin-bottom:12px;">
      <div class="meta">
        <h3>${ev.name}</h3>
        <span class="tag">${GAME_LABEL[ev.game_type]}</span>
        <span class="tag ${ev.status}">${STATUS_LABEL[ev.status]}</span>
        ${ev.losers_bracket ? '<span class="tag">🥈敗部復活賽</span>' : ""}
        ${deadlineTxt ? `<span class="tag ${deadlinePassed ? "closed" : ""}">⏰ 截止 ${deadlineTxt}</span>` : ""}
        ${ruleTags}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;">
        ${!ev.locked && !isClosed ? '<button class="btn small" data-action="lock">鎖定名單,產生賽程</button>' : ""}
        ${!isClosed ? '<button class="btn ghost small" data-action="close">結束活動</button>' : ""}
        <button class="btn ghost small" data-action="delete" style="color:var(--red);border-color:var(--red);">刪除活動</button>
      </div>
    </div>
    <div class="bracket-summary"></div>
    <div class="participants"></div>
  `;

  const closeBtn = card.querySelector('[data-action="close"]');
  if (closeBtn) {
    closeBtn.onclick = async () => {
      await db.setEventStatus(ev.id, "closed");
      loadAll();
    };
  }
  const lockBtn = card.querySelector('[data-action="lock"]');
  if (lockBtn) {
    lockBtn.onclick = async () => {
      lockBtn.disabled = true;
      lockBtn.textContent = "產生中...";
      try {
        await db.lockAndGenerateBracket(ev.id);
        loadAll();
      } catch (e) {
        alert(e.message || "產生賽程失敗");
        lockBtn.disabled = false;
        lockBtn.textContent = "鎖定名單,產生賽程";
      }
    };
  }
  card.querySelector('[data-action="delete"]').onclick = async () => {
    if (!confirm(`確定要刪除「${ev.name}」嗎?這個動作無法復原,所有報名與對戰紀錄都會一起刪除。`)) return;
    await db.deleteEvent(ev.id);
    loadAll();
  };

  renderBracketSummary(card.querySelector(".bracket-summary"), ev);
  renderParticipants(card.querySelector(".participants"), ev);
  return card;
}

async function loadAll() {
  const list = document.getElementById("events-admin-list");
  list.innerHTML = "";
  const events = await db.listEvents();
  if (!events.length) {
    list.innerHTML = `<div class="empty">還沒有活動,先在上面建立一個吧</div>`;
    return;
  }
  events.forEach((ev) => list.appendChild(eventAdminCard(ev)));
}

document.getElementById("create-btn").onclick = async () => {
  const name = document.getElementById("new-name").value.trim();
  const type = document.getElementById("new-type").value;
  const losers = document.getElementById("new-losers").checked;
  const deadlineVal = document.getElementById("new-deadline").value;
  const deadline = deadlineVal ? new Date(deadlineVal).toISOString() : null;
  const rules = {};
  document.querySelectorAll(".rule-box").forEach((box) => {
    if (box.checked) rules[box.dataset.rule] = true;
  });
  if (!name) return;
  const rewardPlan = buildRewardPlan();
  const btn = document.getElementById("create-btn");
  btn.disabled = true;
  btn.textContent = "建立中...";
  try {
    await db.createEvent({
      name,
      gameType: type,
      losersBracket: losers,
      rules: type === "dice" ? rules : {},
      registrationDeadline: deadline,
      rewardPlan,
    });
    document.getElementById("new-name").value = "";
    document.getElementById("new-deadline").value = "";
    document.getElementById("new-losers").checked = false;
    resetAutoRewardRows();
    document.querySelectorAll(".rule-box").forEach((b) => (b.checked = false));
    renderManualRewardInputs();
    loadAll();
  } catch (e) {
    console.error(e);
    alert("建立活動失敗:" + (e.message || "未知錯誤") + "\n\n請確認 Supabase 的 supabase-schema.sql 是否已更新到最新版(需要有 reward_plan 欄位)。");
  } finally {
    btn.disabled = false;
    btn.textContent = "建立活動";
  }
};

loadAll();

// 背景巡邏:每 5 秒檢查一次所有進行中的活動,叫號排下一場、偵測卡住太久沒人進場的對戰。
// 這樣只要有人開著後台頁面,就算沒人開著對戰畫面本身,賽程也不會卡死。
setInterval(async () => {
  try {
    const events = await db.listEvents();
    for (const ev of events) {
      if (ev.locked && ev.status !== "closed") {
        await db.activateNextMatch(ev.id);
        await db.watchdogActiveMatch(ev.id);
      }
    }
  } catch (e) {}
}, 5000);
