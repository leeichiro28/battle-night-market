const GAME_LABEL = { dice: "🎲 骰子對戰", rps5: "✂️ 五手勢對戰" };
const STATUS_LABEL = { open: "開放參加", running: "進行中", closed: "已結束" };

let currentPlayer = null; // 已用 Discord 登入的話是 {id, name},沒登入是 null
let pendingLoginResolvers = [];

function updateAuthUI() {
  const loggedInCard = document.getElementById("logged-in-card");
  if (currentPlayer) {
    document.getElementById("who-card").style.display = "none";
    loggedInCard.style.display = "flex";
    document.getElementById("logged-in-name").textContent = currentPlayer.name;
  } else {
    loggedInCard.style.display = "none";
    // who-card(登入卡片)只有在真的需要登入時才顯示,見 ensureLogin()
  }
}

// 需要登入才能繼續的地方(參加、查看自己的戰況)呼叫這個:
// 已登入就馬上回傳玩家資料;沒登入就跳出 Discord 登入卡片,等使用者登入完成後才繼續往下走
function ensureLogin() {
  if (currentPlayer) return Promise.resolve(currentPlayer);
  document.getElementById("who-card").style.display = "block";
  document.getElementById("who-card").scrollIntoView({ behavior: "smooth", block: "center" });
  return new Promise((resolve) => {
    pendingLoginResolvers.push(resolve);
  });
}

document.getElementById("discord-login-btn").onclick = async () => {
  const btn = document.getElementById("discord-login-btn");
  btn.disabled = true;
  btn.textContent = "跳轉到 Discord 授權中...";
  try {
    await db.signInWithDiscord();
    // 這裡會整頁導去 Discord 授權頁,不用再做其他事
  } catch (e) {
    alert("Discord 登入失敗:" + (e.message || "未知錯誤"));
    btn.disabled = false;
    btn.textContent = "💬 使用 Discord 登入";
  }
};

document.getElementById("logout-btn").onclick = async () => {
  await db.signOut();
  currentPlayer = null;
  updateAuthUI();
};

const CLASS_INFO = {
  fighter: { icon: "⚔️", name: "鬥士", desc: "猛攻姿態加成更高,大招:血怒(怒氣值全滿)" },
  guardian: { icon: "🛡️", name: "守衛", desc: "防禦骰基礎次數+1,大招:金鐘罩(完全免疫一次)" },
  gambler: { icon: "🎲", name: "賭徒", desc: "雙骰豪賭不限次數+1傷害,大招:孤注一擲(必定爆擊)" },
  assassin: { icon: "🗡️", name: "刺客", desc: "連擊值疊加x2,大招:背刺(對方穩紮穩打時x3傷害)" },
};

function pickClass() {
  const box = document.getElementById("class-options");
  box.innerHTML = "";
  Object.keys(CLASS_INFO).forEach((key) => {
    const info = CLASS_INFO[key];
    const card = document.createElement("div");
    card.className = "card";
    card.style.cssText = "margin:0;padding:12px;text-align:center;cursor:pointer;";
    card.innerHTML = `<div style="font-size:26px;">${info.icon}</div><div style="font-weight:700;margin:4px 0;">${info.name}</div><div style="font-size:10px;color:var(--ink-dim);line-height:1.5;">${info.desc}</div>`;
    card.onclick = () => finishPick(key);
    box.appendChild(card);
  });
  document.getElementById("class-modal").classList.add("show");
  return new Promise((resolve) => {
    window._classPickResolve = resolve;
  });
}
function finishPick(key) {
  document.getElementById("class-modal").classList.remove("show");
  if (window._classPickResolve) window._classPickResolve(key);
}
document.getElementById("class-skip-btn").onclick = () => finishPick(null);

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
      await ensureLogin();
      location.href = `lobby.html?event=${ev.id}`;
    };
  } else if (ev.locked) {
    btn.textContent = "已開賽,查看戰況";
    btn.onclick = async () => {
      await ensureLogin();
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
      const player = await ensureLogin();
      await db.joinEvent(ev.id, player.id);
      if (ev.game_type === "dice" && ev.rules && ev.rules.classes) {
        const chosen = await pickClass();
        if (chosen) await db.setPlayerClass(ev.id, player.id, chosen);
      }
      location.href = `lobby.html?event=${ev.id}`;
    };
  }

  const actions = document.createElement("div");
  actions.style.display = "flex";
  actions.style.gap = "8px";
  actions.style.flexWrap = "wrap";

  // 觀戰按鈕:不管活動是報名中/進行中/已結束都能點,不用等開賽,也不用先登入
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

// Discord 登入狀態一有變化(第一次載入偵測到已登入、或剛授權完成導回來)就會呼叫這裡
async function handleAuthSession(session) {
  if (session) {
    currentPlayer = await db.ensurePlayerFromSession(session);
  } else {
    currentPlayer = null;
  }
  updateAuthUI();
  // 如果剛好有人按了「參加」在等登入完成,登入好了就自動放行繼續原本的動作
  if (currentPlayer && pendingLoginResolvers.length) {
    const resolvers = pendingLoginResolvers;
    pendingLoginResolvers = [];
    resolvers.forEach((r) => r(currentPlayer));
  }
}

(async function init() {
  // 不用登入就能馬上看到活動列表跟觀戰按鈕;真的要參加比賽時才會跳出 Discord 登入
  renderEvents();
  try {
    const session = await db.getSession();
    await handleAuthSession(session);
  } catch (e) {
    console.error(e);
  }
  db.onAuthChange((session) => handleAuthSession(session));
})();
