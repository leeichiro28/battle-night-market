const GAME_PAGE = { dice: "dice.html", rps5: "rps5.html", auction: "auction.html" };

// 後台勾選用的進階規則說明(圖示與名稱共用 ui.RULE，這裡只補上說明文字)
const RULE_ROWS = [
  { key: "item_die", desc: "每3回合隨機爆擊/回血/必中/封印" },
  { key: "field_mod", desc: "開局隨機決定當場特殊規則，6選1" },
  { key: "dynamic_field", desc: "每回合都重新隨機，需先勾上面的戰場修飾骰", nested: true },
  { key: "free_bet", desc: "不限低血，整場限2次" },
  { key: "rage", desc: "連輸2場，下次獲勝+2傷害" },
  { key: "stance", desc: "每回合選猛攻/穩紮穩打" },
  { key: "combo", desc: "連勝疊加，滿3層永久+1傷害" },
  { key: "dice_gamble", desc: "隨時可拼2顆骰子，一般職業限2次" },
  { key: "sudden_death", desc: "雙方低血量時傷害固定雙倍" },
  { key: "classes", desc: "玩家報名時可選鬥士/守衛/賭徒/刺客/法師/幸運兒" },
  { key: "betting", desc: "純娛樂，猜誰會贏" },
  { key: "reactions", desc: "觀戰/對戰中都能發表情互動" },
];

const RPS5_RULE_ROWS = [
  { key: "bomb", desc: "第3回合起，約15%機率額外開放隱藏手勢:炸彈" },
  { key: "field_mod", desc: "開局隨機決定當局特殊規則，3選1" },
  { key: "item_die", desc: "每3回合各自隨機拿到護盾符/增幅符/偵測符" },
  { key: "stance", desc: "出招前先宣告偏攻擊/偏防禦，純情報心理戰" },
  { key: "combo", desc: "連續3局同招獲勝，額外+2傷害" },
  { key: "mindread", desc: "剋中對方最常出的招並獲勝，額外+1傷害" },
  { key: "momentum", desc: "連勝2局+1傷害;連敗2局逆轉時傷害翻倍" },
  { key: "mutation", desc: "連續3回合出同招，下回合系統強制鎖住" },
  { key: "bo_mode", desc: "拋開HP累加，每回合定輸贏，先3分獲勝整場" },
  { key: "dual_hand", desc: "落後方整場限用1次，同時出兩招取其一", nested: true },
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

function renderRps5RuleCheckboxes() {
  document.getElementById("rps5-rules-list").innerHTML = RPS5_RULE_ROWS.map((row) => {
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
renderRps5RuleCheckboxes();

document.getElementById("new-type").onchange = (e) => {
  const type = e.target.value;
  document.getElementById("dice-rules-box").style.display = type === "dice" ? "block" : "none";
  document.getElementById("rps5-rules-box").style.display = type === "rps5" ? "block" : "none";
  document.getElementById("auction-settings-box").style.display = type === "auction" ? "block" : "none";
  // 夜市拍賣不是賽程對戰，沒有敗部復活賽這個概念
  document.getElementById("losers-field").style.display = type === "auction" ? "none" : "block";
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

// 自動分配可以有多項獎勵(例如:金幣 + 藥水)，每項各自依名次分配
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
      <label style="font-size:12px;">總數量(依名次分配，第1名分最多)</label>
      <input type="number" class="auto-reward-total" placeholder="例如:100" value="${ui.esc(total)}" />
    </div>
    <button type="button" class="btn ghost small outline-danger remove-auto-reward-btn">${ui.icon("trash-2")}刪除</button>
  `;
  row.querySelector(".remove-auto-reward-btn").onclick = () => {
    const rows = document.querySelectorAll("#auto-reward-list > .auto-reward-row");
    if (rows.length <= 1) {
      // 至少留一行，直接清空內容就好
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

// 依名次分配權重:名次越前面分越多(權重 N， N-1 ... 1)
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
    // 每一項獎勵各自依名次分配，再把同一名次的多項獎勵合併成一行文字
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
// 一列固定三欄:名字 / 獎勵輸入框 / 操作按鈕。欄寬由 CSS grid 固定，
// 名字長短不會影響輸入框的起訖位置，整批列的輸入框永遠對齊。
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
  input.placeholder = "輸入獎勵，例如:傳說之劍 x1";
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

  // 賽程還沒鎖定前，才能踢出參加者(鎖定後名單已產生賽程，不能再改)
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
function matchRowEl(m, ev, onResolved, classByPlayerId) {
  const row = document.createElement("div");
  row.className = "match-row";
  const isLive = m.status === "active";
  if (isLive) row.classList.add("live");

  const n1 = m.p1?.name || (m.status === "done" ? "輪空" : "待定");
  const n2 = m.p2?.name || (m.status === "done" ? "輪空" : "待定");
  const c1 = classByPlayerId && m.p1?.name ? ui.classTag(classByPlayerId[m.player1_id]) : "";
  const c2 = classByPlayerId && m.p2?.name ? ui.classTag(classByPlayerId[m.player2_id]) : "";

  const top = document.createElement("div");
  top.className = "vs-row";
  top.innerHTML = `
    <span class="side left">${isLive ? ui.icon("radio", { cls: "live-dot" }) : ""}${ui.esc(n1)}${c1}</span>
    <span class="vs">vs</span>
    <span class="side right">${c2}${ui.esc(n2)}</span>
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

  const showClass = ev.game_type === "dice" && !!(ev.rules && ev.rules.classes);
  let classByPlayerId = {};
  if (showClass) {
    const parts = await db.listParticipants(ev.id);
    parts.forEach((p) => (classByPlayerId[p.player_id] = p.class));
  }

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
    rows.forEach((m) => container.appendChild(matchRowEl(m, ev, onResolved, classByPlayerId)));
  }
  if (lb.length) {
    addHeader("medal", "敗部復活賽");
    lb.forEach((m) => container.appendChild(matchRowEl(m, ev, onResolved, classByPlayerId)));
  }
  if (final) {
    addHeader("trophy", "總冠軍賽", true);
    container.appendChild(matchRowEl(final, ev, onResolved, classByPlayerId));
  }
}

// ---------- 夜市拍賣・後台面板 ----------
function auctionParticipantRow(row, onSaved) {
  const div = document.createElement("div");
  div.className = "admin-row";
  const rank = row.final_rank;
  if (rank && rank <= 3) div.classList.add("top3");

  const name = document.createElement("div");
  name.className = "admin-row-name";
  name.innerHTML = `${ui.rankBadge(rank)}<span class="pname">${ui.esc(row.players.name)}</span><span class="pstate">${ui.tag("coins", row.coins + " 財神幣", "coin-tag")}</span>`;

  const input = document.createElement("input");
  input.placeholder = "輸入獎勵，例如:夜市之王的金色炸雞桶";
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
    await db.setAuctionReward(row.id, input.value.trim());
    saveBtn.innerHTML = ui.icon("circle-check") + "已儲存";
    setTimeout(() => {
      saveBtn.innerHTML = ui.icon("gift") + "儲存";
      saveBtn.disabled = false;
    }, 1200);
  };
  actions.appendChild(saveBtn);

  div.appendChild(name);
  div.appendChild(input);
  div.appendChild(actions);
  return div;
}

async function renderAuctionAdminPanel(container, ev) {
  container.innerHTML = "";
  let lots = [];
  let standings = [];
  try {
    [lots, standings] = await Promise.all([db.listAuctionLots(ev.id), db.computeAuctionStandings(ev.id)]);
  } catch (e) {
    container.innerHTML = `<div class="empty">${ui.icon("triangle-alert")}拍賣資料讀取失敗，請確認 supabase-schema.sql 是否已執行最新版</div>`;
    return;
  }

  if (lots.length) {
    const done = lots.filter((l) => l.status === "done").length;
    const liveLot = lots.find((l) => l.status === "live");
    const summary = document.createElement("div");
    summary.className = "section-note";
    summary.style.marginBottom = "14px";
    summary.innerHTML = liveLot
      ? `${ui.icon("gavel")}目前拍賣中:${ui.esc(liveLot.item_name)}(${done}/${lots.length} 件已結標)`
      : `${ui.icon("list-checks")}已結標 ${done}/${lots.length} 件`;
    container.appendChild(summary);
  }

  const title = document.createElement("div");
  title.className = "section-title";
  title.innerHTML = ui.icon("users") + "參加者(依目前積分排序)";
  container.appendChild(title);

  if (!standings.length) {
    container.innerHTML += `<div class="empty">${ui.icon("users")}還沒有人報名</div>`;
    return;
  }
  const onSaved = () => renderAuctionAdminPanel(container, ev);
  standings.forEach((row) => container.appendChild(auctionParticipantRow(row.participant, onSaved)));
}

function eventAdminCard(ev) {
  const card = document.createElement("div");
  card.className = "card";
  const isClosed = ev.status === "closed";
  const isAuction = ev.game_type === "auction";

  const primaryActionBtn = isAuction
    ? !ev.locked && !isClosed
      ? `<button class="btn small" data-action="start-auction">${ui.icon("gavel")}開始拍賣</button>`
      : ""
    : !ev.locked && !isClosed
    ? `<button class="btn small" data-action="lock">${ui.icon("lock")}鎖定名單，產生賽程</button>`
    : "";

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
        ${primaryActionBtn}
        ${ev.locked && !isClosed ? `<a class="btn ghost small" href="${GAME_PAGE[ev.game_type]}?event=${ev.id}" target="_blank">${ui.icon("eye")}前往頁面</a>` : ""}
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
      const ok = await ui.confirm(`確定要結束「${ev.name}」嗎?結束後就不能再進行${isAuction ? "拍賣" : "對戰"}了。`, {
        title: "結束活動",
        confirmText: "結束活動",
      });
      if (!ok) return;
      closeBtn.disabled = true;
      try {
        if (isAuction) {
          await db.closeAuctionEvent(ev.id); // 順便結算名次、套用獎勵設定
        } else {
          await db.setEventStatus(ev.id, "closed");
        }
        loadAll();
      } catch (e) {
        await ui.alert(e.message || "結束活動失敗", { title: "操作失敗", tone: "danger" });
        closeBtn.disabled = false;
      }
    };
  }
  const lockBtn = card.querySelector('[data-action="lock"]');
  if (lockBtn) {
    lockBtn.onclick = async () => {
      lockBtn.disabled = true;
      lockBtn.innerHTML = ui.icon("loader-circle") + "產生中...";
      try {
        const result = await db.lockAndGenerateBracket(ev.id);
        if (result && result.losersBracketDowngraded) {
          await ui.alert("報名人數不足 6 人，敗部復活賽效果不大，系統已自動關閉，改成單敗淘汰賽制。", {
            title: "已自動調整賽制",
            tone: "info",
          });
        }
        loadAll();
      } catch (e) {
        await ui.alert(e.message || "產生賽程失敗", { title: "產生賽程失敗", tone: "danger" });
        lockBtn.disabled = false;
        lockBtn.innerHTML = ui.icon("lock") + "鎖定名單，產生賽程";
      }
    };
  }
  const startAuctionBtn = card.querySelector('[data-action="start-auction"]');
  if (startAuctionBtn) {
    startAuctionBtn.onclick = async () => {
      const ok = await ui.confirm(
        "確定要開始拍賣嗎?開始後就不能再讓新玩家用完整預算加入，系統會立刻依設定自動排好整場商品排程並開拍第一波。",
        { title: "開始拍賣", confirmText: "開始拍賣" }
      );
      if (!ok) return;
      startAuctionBtn.disabled = true;
      startAuctionBtn.innerHTML = ui.icon("loader-circle") + "排程產生中...";
      try {
        const itemsPerWave = (ev.rules && ev.rules.itemsPerWave) || AUCTION_DEFAULT_ITEMS_PER_WAVE;
        const waveIntervalSec = (ev.rules && ev.rules.waveIntervalSec) || AUCTION_DEFAULT_WAVE_INTERVAL_SEC;
        const waves = buildAuctionWaves(itemsPerWave);
        await db.startAuction(ev.id, { waveIntervalSec, waves });
        loadAll();
      } catch (e) {
        await ui.alert(e.message || "開始拍賣失敗", { title: "開始拍賣失敗", tone: "danger" });
        startAuctionBtn.disabled = false;
        startAuctionBtn.innerHTML = ui.icon("gavel") + "開始拍賣";
      }
    };
  }
  card.querySelector('[data-action="delete"]').onclick = async () => {
    const ok = await ui.confirm(
      `確定要刪除「${ev.name}」嗎?這個動作無法復原，所有報名與${isAuction ? "拍賣" : "對戰"}紀錄都會一起刪除。`,
      { title: "刪除活動", confirmText: "永久刪除", tone: "danger" }
    );
    if (!ok) return;
    await db.deleteEvent(ev.id);
    loadAll();
  };

  if (isAuction) {
    renderAuctionAdminPanel(card.querySelector(".participants"), ev);
  } else {
    renderBracketSummary(card.querySelector(".bracket-summary"), ev);
    renderParticipants(card.querySelector(".participants"), ev);
  }
  return card;
}

let archiveOpen = false;

// 後台列表跟首頁一樣，已結束的活動收進下面可展開的「活動已結束」區，避免舊活動一直往下堆
async function loadAll() {
  const list = document.getElementById("events-admin-list");
  list.innerHTML = "";
  const events = await db.listEvents();
  const live = events.filter((ev) => ev.status !== "closed");
  const archived = events.filter((ev) => ev.status === "closed");

  if (!events.length) {
    list.innerHTML = `<div class="empty">${ui.icon("calendar-clock")}還沒有活動，先在上面建立一個吧</div>`;
  } else if (!live.length) {
    list.innerHTML = `<div class="empty">${ui.icon("calendar-clock")}目前沒有報名中或進行中的活動</div>`;
  } else {
    live.forEach((ev) => list.appendChild(eventAdminCard(ev)));
  }

  const archiveBox = document.getElementById("archive-box");
  const archiveToggle = document.getElementById("archive-toggle");
  const archiveList = document.getElementById("archive-list");
  if (!archived.length) {
    archiveBox.style.display = "none";
    archiveOpen = false;
    return;
  }
  archiveBox.style.display = "block";
  archiveToggle.innerHTML = ui.icon(archiveOpen ? "chevron-up" : "chevron-down") + `活動已結束(${archived.length})`;
  archiveToggle.onclick = () => {
    archiveOpen = !archiveOpen;
    loadAll();
  };
  archiveList.style.display = archiveOpen ? "block" : "none";
  archiveList.innerHTML = "";
  if (archiveOpen) {
    archived.forEach((ev) => archiveList.appendChild(eventAdminCard(ev)));
  }
}

document.getElementById("create-btn").onclick = async () => {
  const name = document.getElementById("new-name").value.trim();
  const type = document.getElementById("new-type").value;
  const losers = document.getElementById("new-losers").checked;
  const deadlineVal = document.getElementById("new-deadline").value;
  const deadline = deadlineVal ? new Date(deadlineVal).toISOString() : null;
  const rules = {};
  const activeRulesListId = type === "dice" ? "dice-rules-list" : type === "rps5" ? "rps5-rules-list" : null;
  if (activeRulesListId) {
    document.querySelectorAll(`#${activeRulesListId} .rule-box`).forEach((box) => {
      if (box.checked) rules[box.dataset.rule] = true;
    });
  }
  if (type === "auction") {
    rules.startingBudget = Math.max(1, parseInt(document.getElementById("auction-budget").value) || AUCTION_DEFAULT_BUDGET);
    rules.waveIntervalSec = Math.max(10, parseInt(document.getElementById("auction-wave-interval").value) || AUCTION_DEFAULT_WAVE_INTERVAL_SEC);
    rules.itemsPerWave = Math.max(1, Math.min(3, parseInt(document.getElementById("auction-items-per-wave").value) || AUCTION_DEFAULT_ITEMS_PER_WAVE));
  }
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
      rules,
      registrationDeadline: deadline,
      rewardPlan,
    });
    document.getElementById("new-name").value = "";
    document.getElementById("new-deadline").value = "";
    document.getElementById("new-losers").checked = false;
    document.getElementById("auction-budget").value = AUCTION_DEFAULT_BUDGET;
    document.getElementById("auction-wave-interval").value = AUCTION_DEFAULT_WAVE_INTERVAL_SEC;
    document.getElementById("auction-items-per-wave").value = AUCTION_DEFAULT_ITEMS_PER_WAVE;
    resetAutoRewardRows();
    document.querySelectorAll("#dice-rules-list .rule-box, #rps5-rules-list .rule-box").forEach((b) => (b.checked = false));
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

(async function initAdmin() {
  const ADMIN_ALLOWLIST = ["5466d3fd-501e-402a-8e49-7bed3b8f0058"];
  const local = db.getLocalPlayer();
  const session = await db.getSession().catch(() => null);
  const myId = (session && session.user && session.user.id) || local.id;
  if (!myId || !ADMIN_ALLOWLIST.includes(myId)) {
    document.getElementById("admin-blocked").style.display = "block";
    return;
  }
  document.getElementById("admin-content").style.display = "block";

  loadAll();

  // 背景巡邏:每 5 秒檢查一次所有進行中的活動，叫號排下一場、偵測卡住太久沒人進場的對戰。
  // 這樣只要有人開著後台頁面，就算沒人開著對戰畫面本身，賽程也不會卡死。
  setInterval(async () => {
    try {
      const events = await db.listEvents();
      for (const ev of events) {
        if (ev.locked && ev.status !== "closed" && ev.game_type !== "auction") {
          await db.activateNextMatch(ev.id);
          await db.watchdogActiveMatch(ev.id);
        }
      }
    } catch (e) {}
  }, 5000);

  await loadSponsorSettings();
})();

// ---------- 贊助名單管理 ----------
// 主辦人可以自己開好幾份獨立的「贊助名單」，跟活動 events 完全無關。
// 新建立的名單預設隱藏(草稿)，不會搶走前台正在顯示的「最新贊助名單」。
// db.listSponsorLists() 依建立時間新到舊排序;後台把名單分三區:
//   1) 有顯示於前台的名單裡最新一份 → 「最新贊助名單」直接顯示、可編輯
//   2) 隱藏中的名單(草稿，或先收起來的舊名單)→ 獨立一區直接展開列出，不用額外點開
//   3) 有顯示於前台、但不是最新的那些 → 收進「歷史贊助名單」收合區
// 樣式跟開新活動分頁的「活動已結束」收合一致，展開後每份名單各自是一張可收合卡片
// (跟規則頁「依遊戲分組」同款)。
//
// 贊助內容改成「獎勵名稱 + 數量」(例如朋友 Discord 遊戲道具:嗶幣/鑽石/黑玫瑰)，
// 同一位贊助者(同一份名單內、名字不分大小寫比對)再次贊助時會自動沿用同一個人、
// 把數量加總顯示，不會在列表多一筆重複的人名;每一次原始紀錄都保留在資料庫，
// 後台可以展開查看、個別刪除某一次紀錄。
async function loadSponsorSettings() {
  const contact = await db.getSiteSetting("discord_contact");
  document.getElementById("contact-input").value = contact || "";
  await renderSponsorLists();
}

document.getElementById("save-settings-btn").onclick = async () => {
  const btn = document.getElementById("save-settings-btn");
  btn.disabled = true;
  try {
    await db.setSiteSetting("discord_contact", document.getElementById("contact-input").value.trim());
    await ui.alert("已儲存", { tone: "success" });
  } catch (e) {
    await ui.alert(e.message || "儲存失敗", { title: "儲存失敗", tone: "danger" });
  } finally {
    btn.disabled = false;
  }
};

document.getElementById("add-sponsor-list-btn").onclick = async () => {
  const name = await ui.prompt("幫這份贊助名單取個名字(例如活動場次、月份都可以)", {
    title: "新增贊助名單",
    placeholder: "例如:擂台夜市 第 13 屆",
    confirmText: "建立",
  });
  if (!name || !name.trim()) return;
  try {
    await db.addSponsorList(name.trim());
    await renderSponsorLists();
    await ui.alert("新名單已建立在下面「草稿贊助名單」區，目前前台還不會顯示;等準備好要公開時，再點名單裡的「顯示於前台」。", {
      title: "已建立(草稿)",
      tone: "success",
    });
  } catch (e) {
    await ui.alert(e.message || "建立失敗", { title: "建立失敗", tone: "danger" });
  }
};

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// 新增贊助表單裡的一行「獎勵名稱 + 數量」，跟開新活動分頁的自動分配獎勵輸入列同款。
function addRewardInputRow(container) {
  const row = document.createElement("div");
  row.className = "auto-reward-row";
  row.innerHTML = `
    <div>
      <label style="font-size:12px;">獎勵名稱</label>
      <input class="reward-name-input" placeholder="例如:嗶幣 / 鑽石 / 黑玫瑰" />
    </div>
    <div>
      <label style="font-size:12px;">數量</label>
      <input type="number" class="reward-qty-input" placeholder="例如:900000" />
    </div>
    <button type="button" class="btn ghost small outline-danger remove-reward-row-btn">${ui.icon("trash-2")}刪除</button>
  `;
  row.querySelector(".remove-reward-row-btn").onclick = () => {
    const rows = container.querySelectorAll(":scope > .auto-reward-row");
    if (rows.length <= 1) {
      row.querySelector(".reward-name-input").value = "";
      row.querySelector(".reward-qty-input").value = "";
      return;
    }
    row.remove();
  };
  container.appendChild(row);
  return row;
}

function collectRewardRows(container) {
  const rewards = [];
  container.querySelectorAll(":scope > .auto-reward-row").forEach((row) => {
    const name = row.querySelector(".reward-name-input").value.trim();
    const qty = Number(row.querySelector(".reward-qty-input").value);
    if (name && Number.isFinite(qty) && qty > 0) rewards.push({ name, qty });
  });
  return rewards;
}

// 一位贊助者一列:上排是名字(可編輯) + 加總後的獎勵標籤 + 次數，展開才看得到每一次原始紀錄，
// 每一次紀錄裡的每一項獎勵(名稱/數量)都能各自編輯，改完重新整份名單就會自動重算所有加總跟前台顯示。
function sponsorRowEl(s, onChanged) {
  const row = document.createElement("div");
  row.className = "sponsor-admin-row";
  const totals = db.aggregateRewardTotals([s]);
  const entries = db.groupSponsorEntries(s);
  row.innerHTML = `
    <div class="sar-top">
      <div class="sar-main">
        <div class="sar-name-view">
          <b>${ui.esc(s.name)}</b>
          <button type="button" class="sei-icon-btn" data-action="edit-name" title="編輯名稱">${ui.icon("pencil")}</button>
        </div>
        <div class="sar-name-edit" style="display:none;">
          <input class="sar-name-input" value="${ui.esc(s.name)}" />
          <button type="button" class="btn ghost small" data-action="save-name">${ui.icon("save")}儲存</button>
          <button type="button" class="btn ghost small" data-action="cancel-name">取消</button>
        </div>
        ${entries.length > 1 ? `<div class="sar-count">共 ${entries.length} 次贊助</div>` : ""}
      </div>
      <div class="sar-totals">
        <div class="tag-row">
          ${totals.map((r) => `<span class="tag">${ui.esc(r.name)} ${r.qty.toLocaleString()}</span>`).join("") || `<span class="tag">尚無獎勵項目</span>`}
        </div>
      </div>
    </div>
    <div class="action-row">
      ${entries.length ? `<button type="button" class="sar-history-toggle" data-action="toggle-history">${ui.icon("chevron-down")}展開全部紀錄</button>` : ""}
      <button type="button" class="btn ghost small outline-danger" data-action="delete-sponsor" style="margin-left:auto;">${ui.icon("trash-2")}整筆刪除這位贊助者</button>
    </div>
    <div class="sar-entries" data-role="entries" style="display:none;"></div>
  `;

  // 編輯贊助者名稱:改名後同一位贊助者底下所有次的紀錄都還是同一筆，
  // 前台累積金額、統計都是即時從資料庫算出來的，重新整份名單就會用新名字顯示。
  const nameView = row.querySelector(".sar-name-view");
  const nameEdit = row.querySelector(".sar-name-edit");
  const nameInput = row.querySelector(".sar-name-input");
  row.querySelector('[data-action="edit-name"]').onclick = () => {
    nameView.style.display = "none";
    nameEdit.style.display = "flex";
    nameInput.value = s.name;
    nameInput.focus();
    nameInput.select();
  };
  row.querySelector('[data-action="cancel-name"]').onclick = () => {
    nameEdit.style.display = "none";
    nameView.style.display = "flex";
  };
  row.querySelector('[data-action="save-name"]').onclick = async () => {
    const newName = nameInput.value.trim();
    if (!newName) {
      await ui.alert("名稱不能空白", { title: "缺少資料", tone: "danger" });
      return;
    }
    if (newName === s.name) {
      nameEdit.style.display = "none";
      nameView.style.display = "flex";
      return;
    }
    const btn = row.querySelector('[data-action="save-name"]');
    btn.disabled = true;
    try {
      await db.updateSponsorName(s.id, newName);
      onChanged();
    } catch (e) {
      await ui.alert(e.message || "改名失敗", { title: "改名失敗", tone: "danger" });
      btn.disabled = false;
    }
  };

  // 一筆贊助紀錄(entry)底下的每一項獎勵各自可以編輯名稱/數量，或整筆刪除這一次紀錄。
  function entryItemEl(item, entry) {
    const wrap = document.createElement("div");
    wrap.className = "sar-entry-item";
    wrap.innerHTML = `
      <div class="sei-view">
        <b>${ui.esc(item.reward_name)}</b><span>${Number(item.qty).toLocaleString()}</span>
        <button type="button" class="sei-icon-btn" data-action="edit-item" title="編輯這項獎勵">${ui.icon("pencil")}</button>
      </div>
      <div class="sei-edit" style="display:none;">
        <input class="sei-name-input" value="${ui.esc(item.reward_name)}" placeholder="獎勵名稱" />
        <input type="number" class="sei-qty-input" value="${Number(item.qty)}" placeholder="數量" />
        <button type="button" class="btn ghost small" data-action="save-item">${ui.icon("save")}儲存</button>
        <button type="button" class="btn ghost small" data-action="cancel-item">取消</button>
      </div>
    `;
    const view = wrap.querySelector(".sei-view");
    const edit = wrap.querySelector(".sei-edit");
    const nameInput = wrap.querySelector(".sei-name-input");
    const qtyInput = wrap.querySelector(".sei-qty-input");
    wrap.querySelector('[data-action="edit-item"]').onclick = () => {
      nameInput.value = item.reward_name;
      qtyInput.value = Number(item.qty);
      view.style.display = "none";
      edit.style.display = "flex";
      nameInput.focus();
    };
    wrap.querySelector('[data-action="cancel-item"]').onclick = () => {
      edit.style.display = "none";
      view.style.display = "flex";
    };
    wrap.querySelector('[data-action="save-item"]').onclick = async () => {
      const name = nameInput.value.trim();
      const qty = Number(qtyInput.value);
      if (!name || !Number.isFinite(qty) || qty <= 0) {
        await ui.alert("請填寫獎勵名稱，數量要是大於 0 的數字", { title: "缺少資料", tone: "danger" });
        return;
      }
      const btn = wrap.querySelector('[data-action="save-item"]');
      btn.disabled = true;
      try {
        await db.updateSponsorReward(item.id, { name, qty });
        onChanged();
      } catch (e) {
        await ui.alert(e.message || "修改失敗", { title: "修改失敗", tone: "danger" });
        btn.disabled = false;
      }
    };
    return wrap;
  }

  const entriesBox = row.querySelector('[data-role="entries"]');
  const toggleBtn = row.querySelector('[data-action="toggle-history"]');
  if (toggleBtn) {
    toggleBtn.onclick = () => {
      const open = entriesBox.style.display !== "none";
      entriesBox.style.display = open ? "none" : "block";
      toggleBtn.innerHTML = ui.icon(open ? "chevron-down" : "chevron-up") + (open ? "展開全部紀錄" : "收合紀錄");
      if (!open && !entriesBox.dataset.filled) {
        entriesBox.dataset.filled = "1";
        entries.forEach((entry) => {
          const line = document.createElement("div");
          line.className = "sar-entry";
          line.innerHTML = `
            <div class="sar-entry-top">
              <div class="sar-entry-date">${formatDate(entry.createdAt)}</div>
            </div>
            <div class="sar-entry-items-row">
              <div class="sar-entry-items-list" data-role="items-list"></div>
              <button type="button" class="btn ghost small outline-danger" data-action="delete-entry" style="flex-shrink:0;">${ui.icon("trash-2")}刪除這筆紀錄</button>
            </div>
          `;
          const itemsList = line.querySelector('[data-role="items-list"]');
          entry.items.forEach((it) => itemsList.appendChild(entryItemEl(it, entry)));
          line.querySelector('[data-action="delete-entry"]').onclick = async () => {
            const ok = await ui.confirm("確定要刪除這一次的贊助紀錄嗎?", { title: "刪除贊助紀錄", tone: "danger" });
            if (!ok) return;
            await db.deleteSponsorEntry(entry.entryId);
            onChanged();
          };
          entriesBox.appendChild(line);
        });
      }
      ui.refreshIcons();
    };
  }

  row.querySelector('[data-action="delete-sponsor"]').onclick = async () => {
    const ok = await ui.confirm(`確定要整筆刪除贊助者「${s.name}」嗎?他底下所有次的贊助紀錄都會一起刪除。`, {
      title: "刪除贊助者",
      confirmText: "永久刪除",
      tone: "danger",
    });
    if (!ok) return;
    await db.deleteSponsor(s.id);
    onChanged();
  };

  return row;
}

// 產生一份贊助名單的完整編輯區塊(名稱/新增贊助/贊助者清單)，
// isLatest 只影響標題列要不要加「最新贊助名單」標籤。
function sponsorListCard(sl, isLatest) {
  const card = document.createElement("div");
  card.className = "card";
  const listTotals = db.aggregateRewardTotals(sl.sponsors);
  card.innerHTML = `
    <div class="event-card" style="margin-bottom:14px;">
      <div class="meta">
        <h3>${ui.esc(sl.name)}</h3>
        <div class="tag-row">
          ${isLatest ? `<span class="tag open">${ui.icon("sparkles")}最新贊助名單</span>` : ""}
          <span class="tag">${ui.icon("gem")}${sl.sponsors.length} 位贊助者</span>
          ${sl.visible === false ? `<span class="tag closed">${ui.icon("eye-off")}前台已隱藏</span>` : `<span class="tag open">${ui.icon("eye")}前台顯示中</span>`}
        </div>
      </div>
      <div class="action-row">
        <button type="button" class="btn ghost small" data-action="toggle-visible">${
          sl.visible === false ? ui.icon("eye") + "顯示於前台" : ui.icon("eye-off") + "隱藏於前台"
        }</button>
        <button type="button" class="btn ghost small outline-danger" data-action="delete-list">${ui.icon("trash-2")}刪除這份名單</button>
      </div>
    </div>

    <div class="field-group">
      <label>名單名稱</label>
      <div class="action-row" style="align-items:flex-start;">
        <input class="list-name-input" value="${ui.esc(sl.name)}" style="flex:1;min-width:160px;" />
        <button type="button" class="btn ghost small" data-action="save-list">${ui.icon("save")}儲存</button>
      </div>
    </div>

    <div class="reward-total-box">
      <span>${ui.icon("calculator")}這份名單贊助總額(自動加總，不用手動填)</span>
      ${ui.rewardTotalsHtml(listTotals, { align: "right", emptyText: "尚無紀錄" })}
    </div>

    <div class="field-group" style="margin-top:18px;">
      <label>新增一筆贊助</label>
      <div class="field">
        <input class="sp-name-input" placeholder="贊助者名稱" />
        <div style="font-size:12px;color:var(--ink-dim);margin-top:4px;">
          ${ui.icon("info")}同一位贊助者再次贊助時，名字打一樣就會自動累加，不會多一筆重複的人名。
        </div>
      </div>
      <div class="reward-rows"></div>
      <div class="action-row">
        <button type="button" class="btn ghost small" data-action="add-reward-row">${ui.icon("plus")}新增一項獎勵</button>
      </div>
      <button type="button" class="btn small" style="margin-top:12px;" data-action="add-sponsor">${ui.icon("plus")}新增贊助紀錄</button>
    </div>

    <div class="sponsor-admin-list"></div>
  `;

  const rewardRowsBox = card.querySelector(".reward-rows");
  addRewardInputRow(rewardRowsBox);
  card.querySelector('[data-action="add-reward-row"]').onclick = () => addRewardInputRow(rewardRowsBox);

  const listBox = card.querySelector(".sponsor-admin-list");
  if (!sl.sponsors.length) {
    listBox.innerHTML = `<div class="empty">${ui.icon("gem")}這份名單還沒有贊助紀錄</div>`;
  } else {
    sl.sponsors.forEach((s) => listBox.appendChild(sponsorRowEl(s, () => renderSponsorLists())));
  }

  card.querySelector('[data-action="save-list"]').onclick = async () => {
    const name = card.querySelector(".list-name-input").value.trim();
    if (!name) {
      await ui.alert("名單名稱不能空白", { title: "缺少資料", tone: "danger" });
      return;
    }
    await db.updateSponsorList(sl.id, name);
    await renderSponsorLists();
  };

  card.querySelector('[data-action="toggle-visible"]').onclick = async () => {
    const nextVisible = sl.visible === false;
    const btn = card.querySelector('[data-action="toggle-visible"]');
    btn.disabled = true;
    try {
      await db.setSponsorListVisible(sl.id, nextVisible);
      await renderSponsorLists();
    } catch (e) {
      await ui.alert(e.message || "切換失敗", { title: "切換失敗", tone: "danger" });
      btn.disabled = false;
    }
  };

  card.querySelector('[data-action="delete-list"]').onclick = async () => {
    const ok = await ui.confirm(`確定要刪除「${sl.name}」這份贊助名單嗎?裡面的贊助紀錄會一起刪除。`, {
      title: "刪除贊助名單",
      confirmText: "永久刪除",
      tone: "danger",
    });
    if (!ok) return;
    await db.deleteSponsorList(sl.id);
    await renderSponsorLists();
  };

  card.querySelector('[data-action="add-sponsor"]').onclick = async () => {
    const nameInput = card.querySelector(".sp-name-input");
    const name = nameInput.value.trim();
    const rewards = collectRewardRows(rewardRowsBox);
    if (!name || !rewards.length) {
      await ui.alert("請填寫贊助者名稱，並至少填一項獎勵名稱跟數量", { title: "缺少資料", tone: "danger" });
      return;
    }
    const btn = card.querySelector('[data-action="add-sponsor"]');
    btn.disabled = true;
    try {
      await db.addSponsorEntry(sl.id, name, rewards);
      await renderSponsorLists();
    } catch (e) {
      await ui.alert(e.message || "新增失敗", { title: "新增失敗", tone: "danger" });
    } finally {
      btn.disabled = false;
    }
  };

  return card;
}

// 歷史名單用跟「遊戲規則」分組收合一樣的 .game-group，標題列先看到名稱/總額/筆數，展開才是編輯區
const sponsorHistoryOpenIds = new Set();
let sponsorHistoryOpen = false;

function sponsorHistoryGroup(sl) {
  const group = document.createElement("div");
  const open = sponsorHistoryOpenIds.has(sl.id);
  group.className = "game-group" + (open ? " open" : "");
  group.innerHTML = `
    <button type="button" class="game-toggle">
      <i data-lucide="gem" class="ico"></i>
      <span class="game-toggle-label">${ui.esc(sl.name)}</span>
      ${sl.visible === false ? `<i data-lucide="eye-off" class="ico" title="前台已隱藏"></i>` : ""}
      <span class="game-toggle-count">${sl.sponsors.length} 位贊助者</span>
      <i data-lucide="chevron-down" class="ico chev"></i>
    </button>
    <div class="game-body" ${open ? "" : "hidden"}></div>
  `;
  const toggle = group.querySelector(".game-toggle");
  const body = group.querySelector(".game-body");
  if (open) body.appendChild(sponsorListCard(sl, false));
  toggle.onclick = () => {
    const nowOpen = !group.classList.contains("open");
    group.classList.toggle("open", nowOpen);
    body.hidden = !nowOpen;
    if (nowOpen) {
      sponsorHistoryOpenIds.add(sl.id);
      body.innerHTML = "";
      body.appendChild(sponsorListCard(sl, false));
    } else {
      sponsorHistoryOpenIds.delete(sl.id);
    }
    ui.refreshIcons();
  };
  return group;
}

async function renderSponsorLists() {
  let lists;
  try {
    lists = await db.listSponsorLists();
  } catch (e) {
    console.error(e);
    document.getElementById("sponsor-latest").innerHTML = `<div class="empty">${ui.icon("triangle-alert")}贊助名單載入失敗:${ui.esc(e.message || "未知錯誤")}(請確認 supabase-schema.sql 已重新執行)</div>`;
    document.getElementById("sponsor-draft-box").style.display = "none";
    document.getElementById("sponsor-archive-box").style.display = "none";
    document.getElementById("sponsor-cumulative-total").style.display = "none";
    ui.refreshIcons();
    return;
  }

  // 「最新贊助名單」跟前台邏輯一致，只從「有顯示於前台」的名單裡挑最新一份;
  // 隱藏中的名單(不管是新開的草稿、還是舊活動先收起來的)另外獨立一區顯示，
  // 不會因為建立時間比較新就搶走前台正在顯示的「最新贊助名單/本次活動」位置，
  // 也不會被誤收進「歷史贊助名單」收合區裡要多點一次才看得到。
  const visibleLists = lists.filter((sl) => sl.visible !== false);
  const draftLists = lists.filter((sl) => sl.visible === false);
  const latest = visibleLists[0] || null;
  const history = visibleLists.slice(1);

  const cumulativeBox = document.getElementById("sponsor-cumulative-total");
  if (!lists.length) {
    cumulativeBox.style.display = "none";
  } else {
    cumulativeBox.style.display = "flex";
    const allSponsors = lists.flatMap((sl) => sl.sponsors || []);
    const cumulativeTotals = db.aggregateRewardTotals(allSponsors);
    const label = cumulativeBox.querySelector("span");
    cumulativeBox.innerHTML = "";
    cumulativeBox.appendChild(label);
    cumulativeBox.insertAdjacentHTML("beforeend", ui.rewardTotalsHtml(cumulativeTotals, { align: "right", emptyText: "尚無紀錄" }));
  }

  const latestBox = document.getElementById("sponsor-latest");
  latestBox.innerHTML = "";
  if (!latest) {
    latestBox.innerHTML = `<div class="empty">${ui.icon("gem")}目前沒有顯示於前台的贊助名單，點上面「新增贊助名單」開始建立，或到下面把某份草稿切成顯示</div>`;
  } else {
    latestBox.appendChild(sponsorListCard(latest, true));
  }

  const draftBox = document.getElementById("sponsor-draft-box");
  const draftTitle = document.getElementById("sponsor-draft-title");
  const draftList = document.getElementById("sponsor-draft-list");
  if (!draftLists.length) {
    draftBox.style.display = "none";
  } else {
    draftBox.style.display = "block";
    draftTitle.textContent = `草稿贊助名單，前台隱藏中(${draftLists.length})`;
    draftList.innerHTML = "";
    draftLists.forEach((sl) => draftList.appendChild(sponsorListCard(sl, false)));
  }

  const archiveBox = document.getElementById("sponsor-archive-box");
  const archiveToggle = document.getElementById("sponsor-archive-toggle");
  const archiveList = document.getElementById("sponsor-archive-list");
  if (!history.length) {
    archiveBox.style.display = "none";
    sponsorHistoryOpen = false;
  } else {
    archiveBox.style.display = "block";
    archiveToggle.innerHTML = ui.icon(sponsorHistoryOpen ? "chevron-up" : "chevron-down") + `歷史贊助名單(${history.length})`;
    archiveToggle.onclick = () => {
      sponsorHistoryOpen = !sponsorHistoryOpen;
      renderSponsorLists();
    };
    archiveList.style.display = sponsorHistoryOpen ? "block" : "none";
    archiveList.innerHTML = "";
    if (sponsorHistoryOpen) {
      history.forEach((sl) => archiveList.appendChild(sponsorHistoryGroup(sl)));
    }
  }

  ui.refreshIcons();
}

// ---------- 公告管理 ----------
const ANNOUNCE_TYPE_INFO_ADMIN = {
  event: { icon: "swords", label: "新活動" },
  update: { icon: "sparkles", label: "版本更新" },
  general: { icon: "megaphone", label: "一般公告" },
};

let editingAnnouncementId = null;
let pendingAnnouncementImage = null; // { file， url } 選好但還沒上傳/送出的圖片

function resetAnnounceForm() {
  editingAnnouncementId = null;
  pendingAnnouncementImage = null;
  document.getElementById("announce-type").value = "event";
  document.getElementById("announce-title").value = "";
  document.getElementById("announce-subtitle").value = "";
  document.getElementById("announce-body").value = "";
  document.getElementById("announce-cta-text").value = "";
  document.getElementById("announce-cta-link").value = "";
  document.getElementById("announce-image-input").value = "";
  document.getElementById("announce-image-preview").innerHTML = ui.icon("image");
  document.getElementById("announce-submit-btn").innerHTML = ui.icon("send") + "發布公告";
}

document.getElementById("announce-image-input").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  pendingAnnouncementImage = { file, url: URL.createObjectURL(file) };
  document.getElementById("announce-image-preview").innerHTML = `<img src="${pendingAnnouncementImage.url}" alt="" />`;
});

function fillAnnounceForm(a) {
  editingAnnouncementId = a.id;
  pendingAnnouncementImage = null;
  document.getElementById("announce-type").value = a.type;
  document.getElementById("announce-title").value = a.title || "";
  document.getElementById("announce-subtitle").value = a.subtitle || "";
  document.getElementById("announce-body").value = a.body || "";
  document.getElementById("announce-cta-text").value = a.cta_text || "";
  document.getElementById("announce-cta-link").value = a.cta_link || "";
  document.getElementById("announce-image-input").value = "";
  document.getElementById("announce-image-preview").innerHTML = a.image_url
    ? `<img src="${ui.esc(a.image_url)}" alt="" />`
    : ui.icon("image");
  document.getElementById("announce-submit-btn").innerHTML = ui.icon("check") + "儲存修改";
  document.querySelector('[data-tab-panel="announce"].folder-tab-card').scrollIntoView({ behavior: "smooth", block: "start" });
}

document.getElementById("announce-submit-btn").onclick = async () => {
  const title = document.getElementById("announce-title").value.trim();
  if (!title) {
    await ui.alert("請填標題", { title: "缺少標題", tone: "danger" });
    return;
  }
  const btn = document.getElementById("announce-submit-btn");
  btn.disabled = true;
  btn.innerHTML = ui.icon("loader-circle") + "處理中...";
  try {
    let imageUrl = editingAnnouncementId ? undefined : null;
    if (editingAnnouncementId) {
      const existingImg = document.getElementById("announce-image-preview").querySelector("img");
      imageUrl = existingImg ? existingImg.getAttribute("src") : null;
    }
    if (pendingAnnouncementImage) {
      imageUrl = await db.uploadAnnouncementImage(pendingAnnouncementImage.file);
    }
    const fields = {
      type: document.getElementById("announce-type").value,
      title,
      subtitle: document.getElementById("announce-subtitle").value.trim(),
      body: document.getElementById("announce-body").value.trim(),
      ctaText: document.getElementById("announce-cta-text").value.trim(),
      ctaLink: document.getElementById("announce-cta-link").value.trim(),
      imageUrl,
    };
    if (editingAnnouncementId) {
      await db.updateAnnouncement(editingAnnouncementId, fields);
    } else {
      await db.addAnnouncement(fields);
    }
    resetAnnounceForm();
    await renderAnnounceAdminList();
  } catch (e) {
    console.error(e);
    await ui.alert(e.message || "發布失敗", { title: "發布失敗", tone: "danger" });
  } finally {
    btn.disabled = false;
    if (!editingAnnouncementId) btn.innerHTML = ui.icon("send") + "發布公告";
  }
};

async function renderAnnounceAdminList() {
  const box = document.getElementById("announce-admin-list");
  box.innerHTML = "";
  let list = [];
  try {
    list = await db.listAnnouncements();
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="empty">${ui.icon("triangle-alert")}公告讀取失敗，請確認 supabase-schema.sql 是否已執行最新版</div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty">${ui.icon("megaphone")}還沒有公告，上面新增一則吧</div>`;
    return;
  }
  list.forEach((a, idx) => {
    const info = ANNOUNCE_TYPE_INFO_ADMIN[a.type] || ANNOUNCE_TYPE_INFO_ADMIN.general;
    const d = new Date(a.created_at);
    const row = document.createElement("div");
    row.className = "announce-admin-row";
    row.innerHTML = `
      <div class="aar-thumb">${a.image_url ? `<img src="${ui.esc(a.image_url)}" alt="" />` : ui.icon(info.icon)}</div>
      <div class="aar-main">
        <b>${ui.esc(a.title)}</b>
        <div class="aar-meta">${ui.esc(info.label)} · ${d.getMonth() + 1}/${d.getDate()}${idx === 0 ? " · 目前首頁精選公告" : ""}</div>
      </div>
      <button type="button" class="btn ghost small announce-edit-btn">${ui.icon("pencil")}編輯</button>
      <button type="button" class="btn ghost small outline-danger announce-delete-btn">${ui.icon("trash-2")}刪除</button>
    `;
    row.querySelector(".announce-edit-btn").onclick = () => fillAnnounceForm(a);
    row.querySelector(".announce-delete-btn").onclick = async () => {
      const ok = await ui.confirm(`確定要刪除「${a.title}」這則公告嗎?`, { title: "刪除公告", tone: "danger", confirmText: "刪除" });
      if (!ok) return;
      try {
        await db.deleteAnnouncement(a.id);
        if (editingAnnouncementId === a.id) resetAnnounceForm();
        await renderAnnounceAdminList();
      } catch (e) {
        await ui.alert(e.message || "刪除失敗", { title: "刪除失敗", tone: "danger" });
      }
    };
    box.appendChild(row);
  });
}

resetAnnounceForm();
renderAnnounceAdminList();
