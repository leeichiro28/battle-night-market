let currentPlayer = null; // 已用 Discord 登入的話是 {id, name},沒登入是 null
let pendingLoginResolvers = [];

function updateAuthUI() {
  // 帳號名稱/登出都放在導覽列(header.js),這裡只負責「還沒登入時的登入提示卡」
  if (currentPlayer) document.getElementById("who-card").style.display = "none";
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

const LOGIN_BTN_HTML = ui.icon("message-circle") + "使用 Discord 登入";

document.getElementById("discord-login-btn").onclick = async () => {
  const btn = document.getElementById("discord-login-btn");
  btn.disabled = true;
  btn.innerHTML = ui.icon("loader-circle") + "跳轉到 Discord 授權中...";
  try {
    await db.signInWithDiscord();
    // 這裡會整頁導去 Discord 授權頁,不用再做其他事
  } catch (e) {
    await ui.alert("Discord 登入失敗:" + (e.message || "未知錯誤"), { title: "登入失敗", tone: "danger" });
    btn.disabled = false;
    btn.innerHTML = LOGIN_BTN_HTML;
  }
};
document.getElementById("discord-login-btn").innerHTML = LOGIN_BTN_HTML;

const CLASS_INFO = {
  fighter: { icon: "swords", name: "鬥士", desc: "猛攻姿態加成更高(HP低於40%再更高),大招:血怒(怒氣值全滿)" },
  guardian: { icon: "shield", name: "守衛", desc: "防禦骰+1次,所有受傷固定-1,擋下2次攻擊後下次命中+3傷害,大招:金鐘罩(完全免疫一次)" },
  gambler: { icon: "dice-5", name: "賭徒", desc: "雙骰豪賭不限次數+1傷害,但每次有25%機率凸槌自傷1點,大招:孤注一擲(必定爆擊)" },
  assassin: { icon: "sword", name: "刺客", desc: "連擊值疊加x2,大招:背刺(無視對方防禦骰,對方穩紮穩打時再x3傷害)" },
  mage: { icon: "sparkles", name: "法師", desc: "道具骰效果加強,大招:法術反射(受到的傷害反彈一半給對方)" },
  luckster: { icon: "clover", name: "幸運兒", desc: "平手直接判定自己獲勝,大招:命運骰(讓雙方這局重新擲骰)" },
};

function pickClass() {
  const box = document.getElementById("class-options");
  box.innerHTML = "";
  Object.keys(CLASS_INFO).forEach((key) => {
    const info = CLASS_INFO[key];
    const card = document.createElement("div");
    card.className = "card";
    card.style.cssText = "margin:0;padding:14px 12px;text-align:center;cursor:pointer;";
    card.innerHTML = `
      <div style="color:var(--gold);">${ui.icon(info.icon, { size: "26px" })}</div>
      <div style="font-weight:700;margin:8px 0 6px;">${info.name}</div>
      <div style="font-size:10px;color:var(--ink-dim);line-height:1.6;">${ui.esc(info.desc)}</div>
    `;
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

function eventRow(ev) {
  const div = document.createElement("div");
  div.className = "card event-card";
  const deadlinePassed = ev.registration_deadline && new Date() > new Date(ev.registration_deadline);
  div.innerHTML = `
    <div class="meta">
      <h3>${ui.esc(ev.name)}</h3>
      <div class="tag-row">
        ${ui.gameTag(ev.game_type)}
        ${ui.statusTag(ev.status)}
        ${ev.losers_bracket ? ui.losersTag() : ""}
        ${ui.deadlineTag(ev.registration_deadline, "報名截止")}
      </div>
    </div>
  `;

  const btn = document.createElement("button");
  btn.className = "btn";
  if (ev.status === "closed") {
    btn.innerHTML = ui.icon("list-ordered") + "查看結果";
    btn.onclick = async () => {
      await ensureLogin();
      location.href = `lobby.html?event=${ev.id}`;
    };
  } else if (ev.locked) {
    btn.innerHTML = ui.icon("swords") + "已開賽,查看戰況";
    btn.onclick = async () => {
      await ensureLogin();
      location.href = `lobby.html?event=${ev.id}`;
    };
  } else if (deadlinePassed) {
    btn.innerHTML = ui.icon("ban") + "報名已截止";
    btn.disabled = true;
  } else {
    btn.innerHTML = ui.icon("ticket") + "參加";
    btn.onclick = async () => {
      btn.disabled = true;
      btn.innerHTML = ui.icon("loader-circle") + "報名中...";
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
  actions.className = "action-row";

  // 觀戰按鈕:不管活動是報名中/進行中/已結束都能點,不用等開賽,也不用先登入
  // 可以先開著這個頁面掛著,場次一開打賽程列表就會自動出現觀戰連結
  if (ev.status !== "closed") {
    const watchBtn = document.createElement("button");
    watchBtn.className = "btn ghost";
    watchBtn.innerHTML = ui.icon("eye") + "觀戰";
    watchBtn.onclick = () => window.open(`lobby.html?event=${ev.id}`, "_blank");
    actions.appendChild(watchBtn);
  }

  actions.appendChild(btn);
  div.appendChild(actions);
  return div;
}

let archiveOpen = false;

// 首頁只留報名中/進行中的活動,已結束的收進下面可展開的「活動已結束」區,避免舊活動一直往下堆
// 公告卡類型對應的圖示跟徽章文字,首頁精選公告(hero)跟後台管理共用同一份對照表(admin.js 也有一份)
const ANNOUNCE_TYPE_INFO = {
  event: { icon: "swords", label: "新活動" },
  update: { icon: "sparkles", label: "版本更新" },
  general: { icon: "megaphone", label: "公告" },
};

function announceHeroHtml(a) {
  const info = ANNOUNCE_TYPE_INFO[a.type] || ANNOUNCE_TYPE_INFO.general;
  const imgArea = a.image_url
    ? `<img src="${ui.esc(a.image_url)}" alt="" />`
    : ui.icon(info.icon);
  const hasMore = !!(a.body || (a.cta_text && a.cta_link));
  const detailId = "announce-hero-detail";
  const cta =
    a.cta_text && a.cta_link
      ? `<a class="btn" href="${ui.esc(a.cta_link)}" style="text-decoration:none;">${ui.esc(a.cta_text)}${ui.icon("arrow-right")}</a>`
      : "";
  return `
    <div class="announce-hero">
      <div class="announce-hero-img">
        <span class="announce-badge">${ui.esc(info.label)}</span>
        ${imgArea}
      </div>
      <div class="announce-hero-body">
        ${a.subtitle ? `<div class="announce-hero-sub">${ui.esc(a.subtitle)}</div>` : ""}
        <h3>${ui.esc(a.title)}</h3>
        ${
          hasMore
            ? `<button type="button" class="announce-hero-toggle" data-target="${detailId}">${ui.icon("chevron-down")}查看更多內容</button>
               <div class="announce-hero-detail" id="${detailId}" style="display:none;">
                 ${a.body ? `<p>${ui.esc(a.body).replace(/\n/g, "<br/>")}</p>` : ""}
                 ${cta}
               </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function bindAnnounceHeroToggle(root) {
  root.querySelectorAll(".announce-hero-toggle").forEach((btn) => {
    btn.onclick = () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const open = target.style.display !== "none";
      target.style.display = open ? "none" : "block";
      btn.innerHTML = ui.icon(open ? "chevron-down" : "chevron-up") + "查看更多內容";
      ui.refreshIcons();
    };
  });
}

async function renderAnnouncements() {
  const heroBox = document.getElementById("announce-hero-box");
  const moreBox = document.getElementById("announce-more-box");

  let list = [];
  try {
    list = await db.listAnnouncements();
  } catch (e) {
    console.error(e);
    return;
  }

  if (!list.length) {
    heroBox.innerHTML = "";
    moreBox.style.display = "none";
    return;
  }

  const [latest, ...rest] = list;
  heroBox.innerHTML = announceHeroHtml(latest);
  bindAnnounceHeroToggle(heroBox);
  moreBox.style.display = rest.length ? "block" : "none";
}

async function renderEvents() {
  const list = document.getElementById("events-list");
  list.innerHTML = "";
  const events = await db.listEvents();
  const live = events.filter((ev) => ev.status !== "closed");
  const archived = events.filter((ev) => ev.status === "closed");

  if (!live.length) {
    list.innerHTML = `<div class="empty">${ui.icon("calendar-clock")}目前沒有報名中或進行中的活動,等主辦人開賽吧</div>`;
  } else {
    live.forEach((ev) => list.appendChild(eventRow(ev)));
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
    renderEvents();
  };
  archiveList.style.display = archiveOpen ? "block" : "none";
  if (archiveOpen) {
    archiveList.innerHTML = "";
    archived.forEach((ev) => archiveList.appendChild(eventRow(ev)));
  } else {
    archiveList.innerHTML = "";
  }
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
  renderAnnouncements();
  try {
    const session = await db.getSession();
    await handleAuthSession(session);
  } catch (e) {
    console.error(e);
  }
  db.onAuthChange((session) => handleAuthSession(session));
})();
