// 夜市拍賣・即時拍賣畫面。
// 跟骰子/五手勢完全獨立,不走 lobby.html/matches,直接對 auction_participants / auction_lots 讀寫。
const qs = new URLSearchParams(location.search);
const eventId = qs.get("event");

let ev = null;
let myParticipant = null; // 還沒報名是 null
let lots = [];
let standings = [];
let tasks = [];
let myTaskAnswers = []; // 我在這場活動已經回答過的任務
let currentPlayer = null; // Discord 登入後的玩家 {id, name},沒登入是 null
let pendingLoginResolvers = [];

let tickInterval = null;
let countdownInterval = null;
let taskCountdownInterval = null;
let unsubLots = null;
let unsubParticipants = null;
let unsubTasks = null;
let ticking = false;
let laborFlashUntil = 0;
let luckyFlashUntil = 0;
let luckyFlashNote = "";

if (!eventId) location.href = "index.html";

// ---------- 登入(跟首頁同一套,只是縮小版:只在需要互動時才要求登入) ----------
function ensureLogin() {
  if (currentPlayer) return Promise.resolve(currentPlayer);
  document.getElementById("who-card").style.display = "block";
  document.getElementById("who-card").scrollIntoView({ behavior: "smooth", block: "center" });
  return new Promise((resolve) => {
    pendingLoginResolvers.push(resolve);
  });
}

const LOGIN_BTN_HTML = ui.icon("message-circle") + "使用 Discord 登入";
document.getElementById("discord-login-btn").innerHTML = LOGIN_BTN_HTML;
document.getElementById("discord-login-btn").onclick = async () => {
  const btn = document.getElementById("discord-login-btn");
  btn.disabled = true;
  btn.innerHTML = ui.icon("loader-circle") + "跳轉到 Discord 授權中...";
  try {
    await db.signInWithDiscord();
  } catch (e) {
    await ui.alert("Discord 登入失敗:" + (e.message || "未知錯誤"), { title: "登入失敗", tone: "danger" });
    btn.disabled = false;
    btn.innerHTML = LOGIN_BTN_HTML;
  }
};

async function handleAuthSession(session) {
  currentPlayer = session ? await db.ensurePlayerFromSession(session).catch(() => null) : null;
  if (currentPlayer) document.getElementById("who-card").style.display = "none";
  if (currentPlayer && pendingLoginResolvers.length) {
    const resolvers = pendingLoginResolvers;
    pendingLoginResolvers = [];
    resolvers.forEach((r) => r(currentPlayer));
  }
  await loadMyParticipant();
  render();
}

// ---------- 資料載入 ----------
async function loadMyParticipant() {
  if (!currentPlayer) {
    myParticipant = null;
    return;
  }
  try {
    myParticipant = await db.getMyAuctionParticipant(eventId, currentPlayer.id);
  } catch (e) {
    myParticipant = null;
  }
}

async function refreshAll() {
  const [lotList, standingList, taskList] = await Promise.all([db.listAuctionLots(eventId), db.computeAuctionStandings(eventId), db.listAuctionTasks(eventId)]);
  lots = lotList;
  standings = standingList;
  tasks = taskList;
  if (currentPlayer) {
    const mine = standings.find((r) => r.participant.player_id === currentPlayer.id);
    if (mine) myParticipant = mine.participant;
    myTaskAnswers = await db.listMyAuctionTaskAnswers(eventId, currentPlayer.id).catch(() => []);
  } else {
    myTaskAnswers = [];
  }
  render();
}

// ---------- 背景排程推進(每個開著這頁的人都會幫忙推進) ----------
async function tick() {
  if (ticking || !ev || !ev.locked || ev.status === "closed") return;
  ticking = true;
  try {
    await db.activateDueAuctionLots(eventId);
    await db.settleExpiredAuctionLots(eventId);
    await db.activateDueAuctionTasks(eventId);
    await db.settleExpiredAuctionTasks(eventId);
    await refreshAll();
  } catch (e) {
    console.error(e);
  } finally {
    ticking = false;
  }
}

// ---------- 報名 ----------
document.getElementById("join-btn").onclick = async () => {
  const btn = document.getElementById("join-btn");
  btn.disabled = true;
  btn.innerHTML = ui.icon("loader-circle") + "報名中...";
  try {
    const player = await ensureLogin();
    myParticipant = await db.joinAuctionEvent(eventId, player.id);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "報名失敗", { title: "報名失敗", tone: "danger" });
  } finally {
    btn.disabled = false;
    btn.innerHTML = ui.icon("ticket") + "參加這場拍賣";
  }
};

// ---------- 打工 ----------
document.getElementById("labor-btn").onclick = async () => {
  const player = await ensureLogin();
  const btn = document.getElementById("labor-btn");
  btn.disabled = true;
  try {
    const result = await db.workForAuctionCoins(eventId, player.id);
    myParticipant = result.participant;
    laborFlashUntil = Date.now() + 1600;
    document.getElementById("labor-note").innerHTML = `${ui.icon("sparkles")}打工成功,拿到 ${result.gain} 財神幣!`;
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "打工失敗", { title: "打工失敗", tone: "danger" });
    renderBalance();
  }
};

// ---------- 幸運攤位 ----------
async function placeLuckyBet(guess) {
  const player = await ensureLogin();
  const input = document.getElementById("lucky-bet");
  const amount = parseInt(input.value);
  if (!amount || amount < AUCTION_LUCKY_MIN_BET) {
    await ui.alert(`下注至少要 ${AUCTION_LUCKY_MIN_BET} 財神幣。`, { title: "金額太小", tone: "danger" });
    return;
  }
  if (amount > AUCTION_LUCKY_MAX_BET) {
    await ui.alert(`單次下注最多 ${AUCTION_LUCKY_MAX_BET} 財神幣。`, { title: "金額太大", tone: "danger" });
    return;
  }
  document.getElementById("lucky-big").disabled = true;
  document.getElementById("lucky-small").disabled = true;
  try {
    const result = await db.placeAuctionLuckyBet(eventId, player.id, amount, guess);
    myParticipant = result.participant;
    luckyFlashUntil = Date.now() + 2200;
    const dieLabel = `${ui.icon("dices")}骰出 ${result.die} 點(${result.outcome === "big" ? "大" : "小"})`;
    luckyFlashNote = result.win
      ? `${dieLabel} · ${ui.icon("circle-check")}猜對了!淨賺 ${result.delta} 財神幣`
      : `${dieLabel} · ${ui.icon("circle-x")}猜錯了,拿回一半,淨虧 ${Math.abs(result.delta)} 財神幣`;
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "下注失敗", { title: "下注失敗", tone: "danger" });
    await refreshAll();
  }
}
document.getElementById("lucky-big").onclick = () => placeLuckyBet("big");
document.getElementById("lucky-small").onclick = () => placeLuckyBet("small");

// ---------- 出價 ----------
async function bid(lot, amount) {
  const player = await ensureLogin();
  try {
    await db.placeAuctionBid(lot, player.id, amount);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "出價失敗", { title: "出價失敗", tone: "danger" });
    await refreshAll();
  }
}

async function customBid(lot) {
  const player = await ensureLogin();
  const value = await ui.prompt(`目前最高價 ${lot.current_price} 財神幣,最小加價單位 ${lot.min_increment}。輸入這次要「加多少」:`, {
    title: "自訂加價",
    placeholder: String(lot.min_increment),
    value: String(lot.min_increment),
  });
  if (value === null) return;
  const amount = parseInt(value);
  if (!amount || amount < lot.min_increment) {
    await ui.alert(`加價至少要 ${lot.min_increment} 財神幣。`, { title: "金額太小", tone: "danger" });
    return;
  }
  bid(lot, amount);
}

// ---------- 夜市任務作答 ----------
async function answerTask(task, idx) {
  const player = await ensureLogin();
  const box = document.getElementById("task-options");
  if (box) box.querySelectorAll(".task-opt").forEach((b) => (b.disabled = true));
  try {
    const result = await db.answerAuctionTask(task.id, eventId, player.id, idx);
    if (result.correct) {
      myParticipant = result.participant || myParticipant;
      laborFlashUntil = Date.now() + 1600;
    }
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "作答失敗", { title: "作答失敗", tone: "danger" });
    await refreshAll();
  }
}

// ---------- 畫面渲染 ----------
function renderBalance() {
  const box = document.getElementById("balance-card");
  if (!myParticipant) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  document.getElementById("event-status-tag").className = "tag " + (ev.status === "closed" ? "closed" : ev.locked ? "running" : "open");
  document.getElementById("event-status-tag").innerHTML =
    ev.status === "closed" ? ui.icon("flag") + "活動已結束" : ev.locked ? ui.icon("zap") + "拍賣進行中" : ui.icon("door-open") + "報名開放中";
  document.getElementById("my-balance").textContent = myParticipant.coins;
  const myRank = standings.findIndex((r) => r.participant.id === myParticipant.id) + 1;
  document.getElementById("my-rank-note").textContent = myRank ? `目前排名 第 ${myRank} 名` : "";

  const laborBtn = document.getElementById("labor-btn");
  const cooldownMs = new Date(myParticipant.work_ready_at).getTime() - Date.now();
  const canWork = ev.locked && ev.status !== "closed" && cooldownMs <= 0;
  laborBtn.disabled = !canWork;
  laborBtn.innerHTML = ui.icon("hand-coins") + "打工賺財神幣";
  const note = document.getElementById("labor-note");
  if (Date.now() < laborFlashUntil) {
    // 剛打工成功的提示訊息還在顯示,先不要被下一次自動刷新蓋掉
  } else if (ev.status === "closed") {
    note.textContent = "活動已結束";
  } else if (!ev.locked) {
    note.textContent = "拍賣開始後才能打工";
  } else if (cooldownMs > 0) {
    note.textContent = `冷卻中・${Math.ceil(cooldownMs / 1000)} 秒後可再按一次`;
  } else {
    note.textContent = "";
  }
}

function renderLucky() {
  const box = document.getElementById("lucky-card");
  if (!myParticipant) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  const input = document.getElementById("lucky-bet");
  if (!input.value) input.value = String(Math.min(AUCTION_LUCKY_MIN_BET * 2, myParticipant.coins || AUCTION_LUCKY_MIN_BET));
  input.min = String(AUCTION_LUCKY_MIN_BET);
  input.max = String(AUCTION_LUCKY_MAX_BET);

  const cooldownMs = new Date(myParticipant.lucky_ready_at).getTime() - Date.now();
  const canBet = ev.locked && ev.status !== "closed" && cooldownMs <= 0 && myParticipant.coins >= AUCTION_LUCKY_MIN_BET;
  document.getElementById("lucky-big").disabled = !canBet;
  document.getElementById("lucky-small").disabled = !canBet;
  document.getElementById("lucky-big").innerHTML = ui.icon("trending-up") + "大(4~6)";
  document.getElementById("lucky-small").innerHTML = ui.icon("trending-down") + "小(1~3)";

  const note = document.getElementById("lucky-note");
  if (Date.now() < luckyFlashUntil) {
    note.innerHTML = luckyFlashNote;
  } else if (ev.status === "closed") {
    note.textContent = "活動已結束";
  } else if (!ev.locked) {
    note.textContent = "拍賣開始後才能下注";
  } else if (myParticipant.coins < AUCTION_LUCKY_MIN_BET) {
    note.textContent = `財神幣不夠下注(至少要 ${AUCTION_LUCKY_MIN_BET})`;
  } else if (cooldownMs > 0) {
    note.textContent = `冷卻中・${Math.ceil(cooldownMs / 1000)} 秒後可再下注一次`;
  } else {
    note.textContent = "";
  }
}

function renderJoinGate() {
  const joinCard = document.getElementById("join-card");
  if (!currentPlayer) {
    joinCard.style.display = "none";
    return;
  }
  if (myParticipant) {
    joinCard.style.display = "none";
    return;
  }
  if (ev.status === "closed") {
    joinCard.style.display = "none";
    return;
  }
  if (ev.locked) {
    joinCard.style.display = "block";
    document.getElementById("join-note").textContent = "拍賣已經開始,報名已截止(全自動排程開拍中,不能中途加入拿完整預算)。";
    document.getElementById("join-btn").style.display = "none";
    return;
  }
  const deadlinePassed = ev.registration_deadline && new Date() > new Date(ev.registration_deadline);
  joinCard.style.display = "block";
  document.getElementById("join-btn").style.display = deadlinePassed ? "none" : "inline-flex";
  document.getElementById("join-note").textContent = deadlinePassed
    ? "報名已截止。"
    : `報名時會發一筆固定 ${(ev.rules && ev.rules.startingBudget) || AUCTION_DEFAULT_BUDGET} 財神幣,大家起跑點完全一樣。`;
}

function ringOffset(remainingSec, totalSec) {
  const circumference = 251.2;
  const ratio = Math.max(0, Math.min(1, remainingSec / totalSec));
  return (circumference * (1 - ratio)).toFixed(1);
}

function stopCountdown() {
  clearInterval(countdownInterval);
  countdownInterval = null;
}

function startCountdown(lot) {
  stopCountdown();
  const totalSec = AUCTION_LOT_DURATION_SEC;
  const tickDial = () => {
    const remainingMs = new Date(lot.ends_at).getTime() - Date.now();
    const remainingSec = Math.max(0, Math.ceil(remainingMs / 1000));
    const numEl = document.getElementById("cd-num");
    const ringEl = document.getElementById("cd-ring");
    if (!numEl || !ringEl) {
      stopCountdown();
      return;
    }
    numEl.textContent = remainingSec;
    ringEl.setAttribute("stroke-dashoffset", ringOffset(remainingSec, totalSec));
    if (remainingMs <= 0) tick();
  };
  tickDial();
  countdownInterval = setInterval(tickDial, 200);
}

function lotStageHtml(lot) {
  const myId = currentPlayer && currentPlayer.id;
  const isMineLeading = lot.current_bidder_id && myId && lot.current_bidder_id === myId;
  return `
    <div class="card auction-live">
      <span class="live-tag"><span class="dot"></span>LOT ${ui.esc(String(lot.wave_number))} · 本波拍賣進行中</span>
      <div class="lot-stage">
        <div class="lot-info">
          ${ui.tierTag(lot.item_tier)}
          <h3 style="margin-top:10px;">${ui.esc(lot.item_name)}</h3>
          <div class="price-row">
            <span class="cur">${lot.current_price}</span>
            <span class="unit">財神幣(目前最高價,得標可拿 ${lot.points} 分)</span>
          </div>
          <div class="bidder">
            目前領先:<b>${lot.current_bidder_id ? ui.esc(lot.bidder ? lot.bidder.name : "??") + (isMineLeading ? "(你)" : "") : "尚無人出價"}</b>
            ・ 最小加價 ${lot.min_increment} 枚
          </div>
          <div class="bid-row" id="bid-row">
            <button class="btn" id="bid-min">${ui.icon("gavel")}加價 ${lot.min_increment}</button>
            <button class="btn" id="bid-x5">${ui.icon("gavel")}加價 ${lot.min_increment * 5}</button>
            <button class="btn ghost" id="bid-custom">${ui.icon("pencil")}自訂金額</button>
          </div>
        </div>
        <div class="countdown-dial">
          <svg width="96" height="96" viewBox="0 0 96 96">
            <circle cx="48" cy="48" r="40" fill="none" stroke="#34304A" stroke-width="8"/>
            <circle id="cd-ring" cx="48" cy="48" r="40" fill="none" stroke="#F2B705" stroke-width="8"
              stroke-linecap="round" stroke-dasharray="251.2" stroke-dashoffset="0"/>
          </svg>
          <div class="num" id="cd-num">--</div>
          <div class="lbl">秒後截標</div>
        </div>
      </div>
    </div>
  `;
}

function renderLotSection() {
  const box = document.getElementById("lot-section");
  if (!ev.locked) {
    stopCountdown();
    box.innerHTML = `<div class="card empty">${ui.icon("hourglass")}拍賣還沒開始,等主辦人按下「開始拍賣」後,系統會自動依排程開拍</div>`;
    return;
  }
  if (ev.status === "closed") {
    stopCountdown();
    box.innerHTML = `<div class="card empty">${ui.icon("flag")}這場拍賣已經結束了,結果請看下面的即時排行榜</div>`;
    return;
  }
  const liveLot = lots.find((l) => l.status === "live");
  if (liveLot) {
    box.innerHTML = lotStageHtml(liveLot);
    document.getElementById("bid-min").onclick = () => bid(liveLot, liveLot.min_increment);
    document.getElementById("bid-x5").onclick = () => bid(liveLot, liveLot.min_increment * 5);
    document.getElementById("bid-custom").onclick = () => customBid(liveLot);
    if (!myParticipant) {
      document.getElementById("bid-row").innerHTML = `<span class="section-note" style="margin:0;">${ui.icon("info")}先報名才能出價</span>`;
    }
    startCountdown(liveLot);
    return;
  }
  stopCountdown();
  const scheduled = lots.filter((l) => l.status === "scheduled").sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  if (scheduled.length) {
    const next = scheduled[0];
    const secLeft = Math.max(0, Math.ceil((new Date(next.scheduled_at).getTime() - Date.now()) / 1000));
    box.innerHTML = `<div class="card empty">${ui.icon("hourglass")}下一波即將開始(${secLeft > 0 ? `約 ${secLeft} 秒後` : "馬上就好"}),先去下面「商品預告」看看有什麼</div>`;
    return;
  }
  if (lots.length) {
    box.innerHTML = `<div class="card empty">${ui.icon("party-popper")}本場商品已經全部拍賣完畢,等主辦人結算活動吧</div>`;
  } else {
    box.innerHTML = `<div class="card empty">${ui.icon("hourglass")}拍賣即將開始</div>`;
  }
}

function stopTaskCountdown() {
  clearInterval(taskCountdownInterval);
  taskCountdownInterval = null;
}

function taskStageHtml(task, myAnswer) {
  const icon = (typeof AUCTION_TASK_ICON !== "undefined" && AUCTION_TASK_ICON[task.task_type]) || "help-circle";
  const label = (typeof AUCTION_TASK_LABEL !== "undefined" && AUCTION_TASK_LABEL[task.task_type]) || "夜市任務";
  const secLeft = Math.max(0, Math.ceil((new Date(task.ends_at).getTime() - Date.now()) / 1000));
  let bodyHtml;
  if (!currentPlayer || !myParticipant) {
    bodyHtml = `<div class="section-note" style="margin:10px 0 0;">${ui.icon("info")}先報名才能作答,但作答不用出財神幣</div>`;
  } else if (myAnswer) {
    bodyHtml = myAnswer.correct
      ? `<div class="task-result correct">${ui.icon("circle-check")}答對了!拿到 ${task.reward} 財神幣</div>`
      : `<div class="task-result wrong">${ui.icon("circle-x")}答錯了,這題只能猜一次,下一題再拚</div>`;
  } else {
    bodyHtml = `<div class="task-options" id="task-options">
      ${task.options.map((opt, idx) => `<button class="btn ghost task-opt" data-idx="${idx}">${ui.esc(opt)}</button>`).join("")}
    </div>`;
  }
  return `
    <div class="card auction-task">
      <span class="live-tag task-tag"><span class="dot"></span>${ui.esc(label)} · 答對送 ${task.reward} 財神幣 · <span id="task-cd">${secLeft}</span> 秒後結束</span>
      <h3 class="task-question">${ui.icon(icon, { size: "18px" })}${ui.esc(task.question)}</h3>
      ${bodyHtml}
    </div>
  `;
}

function startTaskCountdown(task) {
  stopTaskCountdown();
  const tick2 = () => {
    const secLeft = Math.max(0, Math.ceil((new Date(task.ends_at).getTime() - Date.now()) / 1000));
    const el = document.getElementById("task-cd");
    if (el) el.textContent = secLeft;
    if (secLeft <= 0) stopTaskCountdown();
  };
  tick2();
  taskCountdownInterval = setInterval(tick2, 1000);
}

function renderTaskSection() {
  const box = document.getElementById("task-section");
  if (!box) return;
  const liveTask = tasks.find((t) => t.status === "live");
  if (!liveTask || !ev.locked || ev.status === "closed") {
    stopTaskCountdown();
    box.innerHTML = "";
    return;
  }
  const myAnswer = currentPlayer ? myTaskAnswers.find((a) => a.task_id === liveTask.id) : null;
  box.innerHTML = taskStageHtml(liveTask, myAnswer);
  if (currentPlayer && myParticipant && !myAnswer) {
    box.querySelectorAll(".task-opt").forEach((btn) => {
      btn.onclick = () => answerTask(liveTask, parseInt(btn.dataset.idx));
    });
  }
  startTaskCountdown(liveTask);
}

function upnextCardHtml(lot) {
  return `
    <div class="upnext-card">
      <div class="ico-wrap">${ui.icon(ui.TIER_ICON[lot.item_tier], { size: "18px" })}</div>
      <div class="name">${ui.esc(lot.item_name)}</div>
      ${ui.tierTag(lot.item_tier)}
    </div>
  `;
}

function renderUpnext() {
  const card = document.getElementById("upnext-card");
  const scheduled = lots.filter((l) => l.status === "scheduled").sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  if (!scheduled.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  document.getElementById("upnext-scroll").innerHTML = scheduled.slice(0, 8).map(upnextCardHtml).join("");
}

function renderBag() {
  const card = document.getElementById("bag-card");
  if (!myParticipant || !currentPlayer) {
    card.style.display = "none";
    return;
  }
  const won = lots.filter((l) => l.status === "done" && l.current_bidder_id === currentPlayer.id);
  card.style.display = "block";
  document.getElementById("bag-count-badge").textContent = won.length;
  const box = document.getElementById("bag-list");
  if (!won.length) {
    box.innerHTML = `<div class="bag-empty">還沒有標到任何商品</div>`;
    return;
  }
  box.innerHTML = won
    .map(
      (l) => `
    <div class="bag-item-row">
      ${ui.tierTag(l.item_tier)}
      <span class="bag-name"><span class="n">${ui.esc(l.item_name)}</span></span>
      <span class="bag-paid">得標 ${l.current_price}</span>
    </div>
  `
    )
    .join("");
}

function renderTierList(tier) {
  const data = AUCTION_CATALOG[tier];
  document.getElementById("tier-list").innerHTML = data.items
    .map(
      ([name, basePrice]) => `
    <div class="item-row">
      <span class="name">${ui.esc(name)}</span>
      <span class="pts">底價 ${basePrice}・${auctionPointsForPrice(basePrice)} 分</span>
    </div>
  `
    )
    .join("");
  document.getElementById("tier-note").textContent = data.note;
}

function bindTierTabs() {
  document.querySelectorAll("#tier-tabs .folder-tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll("#tier-tabs .folder-tab").forEach((t) => t.classList.toggle("active", t === tab));
      renderTierList(tab.dataset.tier);
    };
  });
  renderTierList("common");
}

function renderLeaderboard() {
  const box = document.getElementById("leaderboard-list");
  if (!standings.length) {
    box.innerHTML = `<div class="empty">${ui.icon("users")}還沒有人報名</div>`;
    return;
  }
  box.innerHTML = standings
    .map((row, idx) => {
      const rank = idx + 1;
      const isMe = currentPlayer && row.participant.player_id === currentPlayer.id;
      const rewardLine =
        ev.status === "closed" && row.participant.reward
          ? `<span class="reward-badge">${ui.icon("gift")}${ui.esc(row.participant.reward)}</span>`
          : "";
      return `
      <div class="lb-row${isMe ? " me" : ""}">
        ${ui.rankBadge(rank)}
        <span class="lb-name">${ui.esc(row.participant.players.name)}${isMe ? "(你)" : ""}${rewardLine}</span>
        <span class="lb-score">${row.score}</span>
      </div>
    `;
    })
    .join("");
}

function render() {
  if (!ev) return;
  document.getElementById("event-title").innerHTML = `${ui.esc(ev.name)}`;
  renderJoinGate();
  renderBalance();
  renderLucky();
  renderLotSection();
  renderTaskSection();
  renderUpnext();
  renderBag();
  renderLeaderboard();
}

// ---------- 初始化 ----------
(async function init() {
  try {
    ev = await db.getEventSafe(eventId);
  } catch (e) {
    ev = null;
  }
  if (!ev) {
    await ui.alert("這場活動已經不存在了(可能已被主辦人刪除),帶你回首頁。", { title: "找不到這場活動", tone: "danger" });
    location.href = "index.html";
    return;
  }
  if (ev.game_type !== "auction") {
    // 網址帶錯活動類型(例如手動改連結),骰子/五手勢一律走 lobby.html
    location.href = ev.locked ? `lobby.html?event=${eventId}` : "index.html";
    return;
  }

  bindTierTabs();

  try {
    const session = await db.getSession();
    await handleAuthSession(session);
  } catch (e) {
    console.error(e);
  }
  db.onAuthChange((session) => handleAuthSession(session));

  await refreshAll();
  tickInterval = setInterval(tick, 1000);
  unsubLots = db.onTableChange("auction_lots", `event_id=eq.${eventId}`, () => refreshAll());
  unsubParticipants = db.onTableChange("auction_participants", `event_id=eq.${eventId}`, () => refreshAll());
  unsubTasks = db.onTableChange("auction_tasks", `event_id=eq.${eventId}`, () => refreshAll());
})();

window.addEventListener("beforeunload", () => {
  if (tickInterval) clearInterval(tickInterval);
  stopCountdown();
  stopTaskCountdown();
  if (unsubLots) unsubLots();
  if (unsubParticipants) unsubParticipants();
  if (unsubTasks) unsubTasks();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refreshAll();
});
