const GAME_LABEL = { dice: "🎲 骰子對戰", rps5: "✂️ 五手勢對戰" };
const STATUS_LABEL = { open: "開放參加", running: "進行中", closed: "已結束" };

async function ensureName() {
  const local = db.getLocalPlayer();
  if (local.id && local.name) return local;
  document.getElementById("who-card").style.display = "block";
  return new Promise((resolve) => {
    document.getElementById("save-name-btn").onclick = async () => {
      const name = document.getElementById("name-input").value.trim();
      if (!name) return;
      const p = await db.ensurePlayer(name);
      document.getElementById("who-card").style.display = "none";
      resolve(p);
    };
  });
}

function formatDeadline(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function eventRow(ev) {
  const div = document.createElement("div");
  div.className = "card event-card";
  const deadlineTxt = formatDeadline(ev.registration_deadline);
  const deadlinePassed = ev.registration_deadline && new Date() > new Date(ev.registration_deadline);
  div.innerHTML = `
    <div class="meta">
      <h3>${ev.name}</h3>
      <span class="tag">${GAME_LABEL[ev.game_type] || ev.game_type}</span>
      <span class="tag ${ev.status}">${STATUS_LABEL[ev.status] || ev.status}</span>
      ${ev.losers_bracket ? '<span class="tag">🥈敗部復活賽</span>' : ""}
      ${deadlineTxt ? `<span class="tag ${deadlinePassed ? "closed" : ""}">⏰ 報名截止 ${deadlineTxt}</span>` : ""}
    </div>
  `;
  const btn = document.createElement("button");
  btn.className = "btn";
  if (ev.status === "closed") {
    btn.textContent = "查看結果";
    btn.onclick = async () => {
      await ensureName();
      location.href = `lobby.html?event=${ev.id}`;
    };
  } else if (ev.locked) {
    btn.textContent = "已開賽,查看戰況";
    btn.onclick = async () => {
      const local = await ensureName();
      location.href = `lobby.html?event=${ev.id}`;
    };
  } else if (deadlinePassed) {
    btn.textContent = "報名已截止";
    btn.disabled = true;
  } else {
    btn.textContent = "參加";
    btn.onclick = async () => {
      btn.disabled = true;
      btn.textContent = "報名中...";
      const local = await ensureName();
      await db.joinEvent(ev.id, local.id);
      location.href = `lobby.html?event=${ev.id}`;
    };
  }

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.flexWrap = "wrap";

  // 觀戰按鈕:不管活動是報名中/進行中/已結束都能點,不用等開賽,也不用先報名
  // 可以先開著這個頁面掛著,場次一開打賽程列表就會自動出現「👀 觀戰」連結
  if (ev.status !== "closed") {
    const watchBtn = document.createElement("button");
    watchBtn.className = "btn ghost";
    watchBtn.textContent = "👀 觀戰";
    watchBtn.onclick = () => window.open(`lobby.html?event=${ev.id}`, "_blank");
    actions.appendChild(watchBtn);
  }

  actions.appendChild(btn);
  div.appendChild(actions);
  return div;
}

async function renderEvents() {
  const list = document.getElementById("events-list");
  list.innerHTML = "";
  const events = await db.listEvents();
  if (!events.length) {
    list.innerHTML = `<div class="empty">目前還沒有活動,等主辦人開賽吧</div>`;
    return;
  }
  events.forEach((ev) => list.appendChild(eventRow(ev)));
}

(function init() {
  // 觀戰不需要先輸入暱稱,馬上就能看到活動列表跟觀戰按鈕
  // 暱稱只有在真的要「參加」比賽時才會跳出來問(見上面按鈕的 onclick)
  renderEvents();
})();
