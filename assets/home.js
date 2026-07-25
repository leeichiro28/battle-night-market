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
  div.appendChild(btn);
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

(async function init() {
  await ensureName();
  renderEvents();
})();
