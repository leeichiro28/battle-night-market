const GAME_LABEL = { dice: "🎲 骰子對戰", rps5: "✂️ 五手勢對戰" };
const STATUS_LABEL = { open: "開放參加", running: "進行中", closed: "已結束" };
const RULE_LABEL = { item_die: "🎁道具骰", field_mod: "🌪️戰場修飾", free_bet: "🎰自由加注", rage: "🔥怒氣值" };

document.getElementById("new-type").onchange = (e) => {
  document.getElementById("dice-rules-box").style.display = e.target.value === "dice" ? "block" : "none";
};

function participantRow(row, rankNumber) {
  const div = document.createElement("div");
  div.className = "bracket-row";
  div.style.flexWrap = "wrap";
  div.style.gap = "8px";

  const label = document.createElement("span");
  const tagText =
    row.status === "champion"
      ? "🏆 冠軍"
      : row.status === "eliminated"
      ? `第 ${rankNumber || "?"} 名`
      : row.status === "matched"
      ? "對戰中"
      : row.status === "pending"
      ? "待對手產生"
      : row.status;
  label.innerHTML = `<b>${row.players.name}</b> <span class="mono" style="font-size:11px;color:var(--ink-dim);">${tagText}</span>`;

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
  div.appendChild(label);
  div.appendChild(inputWrap);
  return div;
}

async function renderParticipants(container, eventId) {
  container.innerHTML = "";
  const rows = await db.listParticipants(eventId);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">還沒有人參加</div>`;
    return;
  }
  const champion = rows.find((r) => r.status === "champion");
  const eliminated = rows.filter((r) => r.status === "eliminated");
  const others = rows.filter((r) => r.status !== "eliminated" && r.status !== "champion");
  eliminated.sort((a, b) => new Date(b.eliminated_at) - new Date(a.eliminated_at));

  if (champion) container.appendChild(participantRow(champion, 1));
  others.forEach((r) => container.appendChild(participantRow(r, null)));

  let rank = champion ? 2 : 1;
  eliminated.forEach((r) => {
    const useRank = r.final_rank || rank;
    container.appendChild(participantRow(r, useRank));
    rank = useRank + 1;
  });
}

async function renderBracketSummary(container, eventId) {
  const matches = await db.listMatches(eventId);
  if (!matches.length) {
    container.innerHTML = "";
    return;
  }
  const wb = matches.filter((m) => m.bracket === "winners");
  const lb = matches.filter((m) => m.bracket === "losers");
  const final = matches.find((m) => m.bracket === "final");
  const totalRounds = wb.length ? Math.max(...wb.map((m) => m.round)) : 0;

  let html = `<h3 style="font-size:13px;color:var(--ink-dim);margin:14px 0 4px;">賽程總覽</h3>`;
  for (let r = 1; r <= totalRounds; r++) {
    const rows = wb.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
    const label = r === totalRounds ? "決賽" : r === totalRounds - 1 ? "準決賽" : `第${r}輪`;
    html += `<div style="font-size:11px;color:var(--ink-dim);margin:6px 0 2px;">${label}</div>`;
    rows.forEach((m) => {
      const n1 = m.p1?.name || "輪空/待定";
      const n2 = m.p2?.name || "輪空/待定";
      html += `<div class="bracket-row"><span>${n1}</span><span style="color:var(--ink-dim);">vs</span><span>${n2}</span></div>`;
    });
  }
  if (lb.length) {
    html += `<div style="font-size:11px;color:var(--ink-dim);margin:8px 0 2px;">敗部復活賽</div>`;
    lb.forEach((m) => {
      html += `<div class="bracket-row"><span>${m.p1?.name || "?"}</span><span style="color:var(--ink-dim);">vs</span><span>${m.p2?.name || "?"}</span></div>`;
    });
  }
  if (final) {
    html += `<div style="font-size:11px;color:var(--ink-dim);margin:8px 0 2px;">🏆 總冠軍賽</div>`;
    html += `<div class="bracket-row"><span>${final.p1?.name || "?"}</span><span style="color:var(--ink-dim);">vs</span><span>${final.p2?.name || "?"}</span></div>`;
  }
  container.innerHTML = html;
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
        ${!ev.locked ? '<button class="btn small" data-action="lock">鎖定名單,產生賽程</button>' : ""}
        <button class="btn ghost small" data-status="closed">結束活動</button>
      </div>
    </div>
    <div class="bracket-summary"></div>
    <div class="participants"></div>
  `;
  card.querySelector('[data-status="closed"]').onclick = async () => {
    await db.setEventStatus(ev.id, "closed");
    loadAll();
  };
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
  renderBracketSummary(card.querySelector(".bracket-summary"), ev.id);
  renderParticipants(card.querySelector(".participants"), ev.id);
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
  await db.createEvent(name, type, losers, type === "dice" ? rules : {}, deadline);
  document.getElementById("new-name").value = "";
  document.getElementById("new-deadline").value = "";
  document.getElementById("new-losers").checked = false;
  document.querySelectorAll(".rule-box").forEach((b) => (b.checked = false));
  loadAll();
};

loadAll();
