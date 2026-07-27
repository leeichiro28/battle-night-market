const GAME_PAGE = { dice: "dice.html", rps5: "rps5.html" };

// 後台勾選用的進階規則說明(圖示與名稱共用 ui.RULE,這裡只補上說明文字)
const RULE_ROWS = [
  { key: "item_die", desc: "每3回合隨機爆擊/回血/必中/封印" },
  { key: "field_mod", desc: "開局隨機決定當場特殊規則,6選1" },
  { key: "dynamic_field", desc: "每回合都重新隨機,需先勾上面的戰場修飾骰", nested: true },
  { key: "free_bet", desc: "不限低血,整場限2次" },
  { key: "rage", desc: "連輸2場,下次獲勝+2傷害" },
  { key: "stance", desc: "每回合選猛攻/穩紮穩打" },
  { key: "combo", desc: "連勝疊加,滿3層永久+1傷害" },
  { key: "dice_gamble", desc: "隨時可拼2顆骰子,一般職業限2次" },
  { key: "sudden_death", desc: "雙方低血量時傷害固定雙倍" },
  { key: "classes", desc: "玩家報名時可選鬥士/守衛/賭徒/刺客" },
  { key: "betting", desc: "純娛樂,猜誰會贏" },
  { key: "reactions", desc: "觀戰/對戰中都能發表情互動" },
];

function renderRuleCheckboxes() {
  document.getElementById("dice-rules-list").innerHTML = RULE_ROWS.map((row) => {
    const meta = ui.RULE[row.key];
    return `
      <label class="check-item${row.nested ? " nested" : ""}">
        <input type="checkbox" class="rule-box" data-rule="${row.key}" />
        ${ui.icon(meta.icon)}
        <span>${meta.label}(${ui.esc(row.desc)})</span>
      </label>
    `;
  }).join("");
}
renderRuleCheckboxes();

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
      <label style="font-size:12px;">第 ${i} 名獎勵</label>
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
  row.className = "auto-reward-row";
  row.dataset.rowId = rowId;
  row.innerHTML = `
    <div>
      <label style="font-size:12px;">獎勵名稱</label>
      <input class="auto-reward-label" placeholder="例如:金幣" value="${ui.esc(label)}" />
    </div>
    <div>
      <label style="font-size:12px;">總數量(依名次分配,第1名分最多)</label>
      <input type="number" class="auto-reward-total" placeholder="例如:100" value="${ui.esc(total)}" />
    </div>
    <button type="button" class="btn ghost small outline-danger remove-auto-reward-btn">${ui.icon("trash-2")}刪除</button>
  `;
  row.querySelector(".remove-auto-reward-btn").onclick = () => {
    const rows = document.querySelectorAll("#auto-reward-list > .auto-reward-row");
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
  document.querySelectorAll("#auto-reward-list > .auto-reward-row").forEach((row) => {
    const label = row.querySelector(".auto-reward-label").value.trim();
    const total = parseInt(row.querySelector(".auto-reward-total").value);
    if (label && total) entries.push({ label, total });
  });
  return entries;
}

document.getElementById("add-auto-reward-btn").innerHTML = ui.icon("plus") + "新增一項獎勵";
document.getElementById("add-auto-reward-btn").onclick = () => addAutoRewardRow();
resetAutoRewardRows();

function setRewardMode(mode) {
  rewardMode = mode;
  document.getElementById("mode-manual-btn").classList.toggle("active-choice", mode === "manual");
  document.getElementById("mode-auto-btn").classList.toggle("active-choice", mode === "auto");
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
// 一列固定三欄:名字 / 獎勵輸入框 / 操作按鈕。欄寬由 CSS grid 固定,
// 名字長短不會影響輸入框的起訖位置,整批列的輸入框永遠對齊。
function participantRow(row, ev, onKicked) {
  const div = document.createElement("div");
  div.className = "admin-row";
  const rank = row.final_rank;
  const isTop3 = rank && rank <= 3;
  if (isTop3) div.classList.add("top3");

  const stateText =
    row.status === "champion"
      ? "冠軍"
      : rank
      ? `第 ${rank} 名`
      : row.status === "matched"
      ? "對戰中"
      : row.status === "pending"
      ? "待對手產生"
      : row.status;

  const name = document.createElement("div");
  name.className = "admin-row-name";
  name.innerHTML = `${ui.rankBadge(rank)}<span class="pname">${ui.esc(row.players.name)}</span><span class="pstate">${ui.esc(stateText)}</span>`;

  const input = document.createElement("input");
  input.placeholder = "輸入獎勵,例如:傳說之劍 x1";
  input.value = row.reward || "";
  input.style.fontSize = "13px";

  const actions = document.createElement("div");
  actions.className = "admin-row-actions";

  const saveBtn = document.createElement("button");
  saveBtn.className = "btn small";
  saveBtn.innerHTML = ui.icon("gift") + "儲存";
  saveBtn.onclick = async () => {
    saveBtn.disabled = true;
    saveBtn.innerHTML = ui.icon("loader-circle") + "儲存中";
    await db.setReward(row.id, input.value.trim());
    saveBtn.innerHTML = ui.icon("circle-check") + "已儲存";
    setTimeout(() => {
      saveBtn.innerHTML = ui.icon("gift") + "儲存";
      saveBtn.disabled = false;
    }, 1200);
  };
  actions.appendChild(saveBtn);

  // 賽程還沒鎖定前,才能踢出參加者(鎖定後名單已產生賽程,不能再改)
  if (!ev.locked) {
    const kickBtn = document.createElement("button");
    kickBtn.className = "btn ghost small outline-danger";
    kickBtn.innerHTML = ui.icon("user-x") + "踢出";
    kickBtn.onclick = async () => {
      const ok = await ui.confirm(`確定要把「${row.players.name}」踢出這場活動嗎?`, {
        title: "踢出參加者",
        confirmText: "踢出",
        tone: "danger",
      });
      if (!ok) return;
      kickBtn.disabled = true;
      kickBtn.innerHTML = ui.icon("loader-circle") + "踢出中...";
      try {
        await db.removeParticipant(row.id);
        onKicked();
      } catch (e) {
        await ui.alert("踢出失敗:" + (e.message || "未知錯誤"), { title: "操作失敗", tone: "danger" });
        kickBtn.disabled = false;
        kickBtn.innerHTML = ui.icon("user-x") + "踢出";
      }
    };
    actions.appendChild(kickBtn);
  }

  div.appendChild(name);
  div.appendChild(input);
  div.appendChild(actions);
  return div;
}

async function renderParticipants(container, ev) {
  container.innerHTML = "";
  const rows = await db.listParticipants(ev.id);
  if (!rows.length) {
    container.innerHTML = `<div class="empty">${ui.icon("users")}還沒有人參加</div>`;
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
  row.className = "match-row";
  const isLive = m.status === "active";
  if (isLive) row.classList.add("live");

  const n1 = m.p1?.name || (m.status === "done" ? "輪空" : "待定");
  const n2 = m.p2?.name || (m.status === "done" ? "輪空" : "待定");

  const top = document.createElement("div");
  top.className = "vs-row";
  top.innerHTML = `
    <span class="side left">${isLive ? ui.icon("radio", { cls: "live-dot" }) : ""}${ui.esc(n1)}</span>
    <span class="vs">vs</span>
    <span class="side right">${ui.esc(n2)}</span>
  `;
  row.appendChild(top);

  if (isLive) {
    const note = document.createElement("div");
    note.className = "row-note live";
    note.innerHTML = `<a href="${GAME_PAGE[ev.game_type]}?match=${m.id}&event=${ev.id}" target="_blank" class="footer-nav-link">${ui.icon("eye")}觀戰</a>`;
    row.appendChild(note);

    if (m.player1_id && m.player2_id) {
      const forceBox = document.createElement("div");
      forceBox.className = "force-box";
      forceBox.innerHTML = `<span class="hint">卡住了嗎?可以在這裡強制判定勝負(用於雙方棄權/連線異常時的緊急處理):</span>`;

      [
        [n1, m.player1_id, m.player2_id],
        [n2, m.player2_id, m.player1_id],
      ].forEach(([name, winnerId, loserId]) => {
        const b = document.createElement("button");
        b.className = "btn ghost small";
        b.innerHTML = ui.icon("scale") + `判 ${ui.esc(name)} 勝`;
        b.onclick = async () => {
          const ok = await ui.confirm(`確定要強制判定「${name}」獲勝、直接結束這場對戰嗎?`, {
            title: "強制判定勝負",
            confirmText: "判定獲勝",
            tone: "danger",
          });
          if (!ok) return;
          b.disabled = true;
          try {
            await db.advanceAfterMatch(m, winnerId, loserId);
            onResolved();
          } catch (e) {
            await ui.alert("處理失敗:" + (e.message || "未知錯誤"), { title: "操作失敗", tone: "danger" });
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

  const addHeader = (iconName, text, gold) => {
    const h = document.createElement("div");
    h.className = "section-title" + (gold ? " gold" : "");
    h.innerHTML = ui.icon(iconName) + text;
    container.appendChild(h);
  };

  addHeader("list-checks", "賽程總覽");

  for (let r = 1; r <= totalRounds; r++) {
    const rows = wb.filter((m) => m.round === r).sort((a, b) => a.slot - b.slot);
    const isFinal = r === totalRounds;
    const label = isFinal ? "決賽" : r === totalRounds - 1 ? "準決賽" : `第${r}輪`;
    addHeader(isFinal ? "trophy" : "swords", label, r >= totalRounds - 1);
    rows.forEach((m) => container.appendChild(matchRowEl(m, ev, onResolved)));
  }
  if (lb.length) {
    addHeader("medal", "敗部復活賽");
    lb.forEach((m) => container.appendChild(matchRowEl(m, ev, onResolved)));
  }
  if (final) {
    addHeader("trophy", "總冠軍賽", true);
    container.appendChild(matchRowEl(final, ev, onResolved));
  }
}

function eventAdminCard(ev) {
  const card = document.createElement("div");
  card.className = "card";
  const isClosed = ev.status === "closed";

  card.innerHTML = `
    <div class="event-card" style="margin-bottom:14px;">
      <div class="meta">
        <h3>${ui.esc(ev.name)}</h3>
        <div class="tag-row">
          ${ui.gameTag(ev.game_type)}
          ${ui.statusTag(ev.status)}
          ${ev.losers_bracket ? ui.losersTag() : ""}
          ${ui.deadlineTag(ev.registration_deadline)}
          ${ui.ruleTags(ev.rules)}
        </div>
      </div>
      <div class="action-row">
        ${!ev.locked && !isClosed ? `<button class="btn small" data-action="lock">${ui.icon("lock")}鎖定名單,產生賽程</button>` : ""}
        ${!isClosed ? `<button class="btn ghost small" data-action="close">${ui.icon("flag")}結束活動</button>` : ""}
        <button class="btn ghost small outline-danger" data-action="delete">${ui.icon("trash-2")}刪除活動</button>
      </div>
    </div>
    <div class="bracket-summary"></div>
    <div class="participants"></div>
  `;

  const closeBtn = card.querySelector('[data-action="close"]');
  if (closeBtn) {
    closeBtn.onclick = async () => {
      const ok = await ui.confirm(`確定要結束「${ev.name}」嗎?結束後就不能再進行對戰了。`, {
        title: "結束活動",
        confirmText: "結束活動",
      });
      if (!ok) return;
      await db.setEventStatus(ev.id, "closed");
      loadAll();
    };
  }
  const lockBtn = card.querySelector('[data-action="lock"]');
  if (lockBtn) {
    lockBtn.onclick = async () => {
      lockBtn.disabled = true;
      lockBtn.innerHTML = ui.icon("loader-circle") + "產生中...";
      try {
        await db.lockAndGenerateBracket(ev.id);
        loadAll();
      } catch (e) {
        await ui.alert(e.message || "產生賽程失敗", { title: "產生賽程失敗", tone: "danger" });
        lockBtn.disabled = false;
        lockBtn.innerHTML = ui.icon("lock") + "鎖定名單,產生賽程";
      }
    };
  }
  card.querySelector('[data-action="delete"]').onclick = async () => {
    const ok = await ui.confirm(
      `確定要刪除「${ev.name}」嗎?這個動作無法復原,所有報名與對戰紀錄都會一起刪除。`,
      { title: "刪除活動", confirmText: "永久刪除", tone: "danger" }
    );
    if (!ok) return;
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
    list.innerHTML = `<div class="empty">${ui.icon("calendar-clock")}還沒有活動,先在上面建立一個吧</div>`;
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
  if (!name) {
    await ui.alert("請先幫這場活動取一個名稱。", { title: "還缺活動名稱" });
    document.getElementById("new-name").focus();
    return;
  }
  const rewardPlan = buildRewardPlan();
  const btn = document.getElementById("create-btn");
  btn.disabled = true;
  btn.innerHTML = ui.icon("loader-circle") + "建立中...";
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
    await ui.alert(
      (e.message || "未知錯誤") +
        "\n\n請確認 Supabase 的 supabase-schema.sql 是否已更新到最新版(需要有 reward_plan 欄位)。",
      { title: "建立活動失敗", tone: "danger" }
    );
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
