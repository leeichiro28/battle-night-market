// 夜市拍賣・即時拍賣畫面。
// 跟骰子/五手勢完全獨立，不走 lobby.html/matches，直接對 auction_participants / auction_lots 讀寫。
const qs = new URLSearchParams(location.search);
const eventId = qs.get("event");

let ev = null;
let myParticipant = null; // 還沒報名是 null
let lots = [];
let standings = [];
let tasks = [];
let myTaskAnswers = []; // 我在這場活動已經回答過的任務
let myPriceGuesses = []; // 我在這場活動已經猜過價的商品
let mySealedBids = []; // 我在暗標競標商品上已經盲出的價格(自己看得到自己的，別人的看不到)
let currentPlayer = null; // Discord 登入後的玩家 {id， name}，沒登入是 null
let pendingLoginResolvers = [];

let nextTickTimer = null;
let cooldownTickInterval = null; // 每秒重繪「打工/幸運攤位」冷卻倒數文字，不用等 Realtime 事件才更新
let countdownInterval = null;
let taskCountdownInterval = null;
let unsubLots = null;
let unsubParticipants = null;
let unsubTasks = null;
let ticking = false;
let refreshTimer = null; // 把短時間內連續多個 Realtime 變化事件合併成一次 refreshAll，不用每個事件都各自重抓一次
let laborFlashUntil = 0;
let luckyFlashUntil = 0;
let luckyFlashNote = "";

if (!eventId) location.href = "index.html";

// ---------- 登入(跟首頁同一套，只是縮小版:只在需要互動時才要求登入) ----------
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

let refreshAllGen = 0; // 跟 rps5.js/dice.js 一樣的過期回應防呆:比較慢回來的舊查詢不能蓋掉新的畫面

async function refreshAll() {
  const myGen = ++refreshAllGen;
  // standings 內部本來也要抓一次商品清單才能算分數，這裡先抓好 lots 直接傳進去，
  // 避免同一輪重複抓兩次 auction_lots(這是拍賣頁流量的大宗)。
  const [lotList, taskList] = await Promise.all([db.listAuctionLots(eventId), db.listAuctionTasks(eventId)]);
  const standingList = await db.computeAuctionStandings(eventId, { lots: lotList });
  if (myGen !== refreshAllGen) return; // 這段等待期間又有更新的一次refreshAll了，這次的結果已經過期
  lots = lotList;
  standings = standingList;
  tasks = taskList;
  if (currentPlayer) {
    const mine = standings.find((r) => r.participant.player_id === currentPlayer.id);
    if (mine) myParticipant = mine.participant;
    myTaskAnswers = await db.listMyAuctionTaskAnswers(eventId, currentPlayer.id).catch(() => []);
    myPriceGuesses = await db.listMyAuctionPriceGuesses(eventId, currentPlayer.id).catch(() => []);
    mySealedBids = await db.listMySealedBids(eventId, currentPlayer.id).catch(() => []);
    if (myGen !== refreshAllGen) return;
  } else {
    myTaskAnswers = [];
    myPriceGuesses = [];
    mySealedBids = [];
  }
  render();
  scheduleNextTick();
}

// 把短時間內連續發生的多個資料變化(例如同一秒裡商品開拍又結標)合併成一次 refreshAll，
// 避免每個 Realtime 事件都各自重抓一次完整清單。
function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    refreshAll();
  }, 400);
}

// 打工/幸運攤位的冷卻秒數只有在 refreshAll()(Realtime 事件觸發)時算一次就寫死在畫面上，
// 中間沒有東西會讓它自己跳動，玩家會看到數字卡住不動、以為要手動重新整理才會更新。
// 這兩個 render 函式本身很輕(只更新文字/disabled 狀態，不重建列表)，所以每秒重繪一次沒有效能疑慮。
function tickCooldownDisplays() {
  if (!myParticipant) return;
  renderBalance();
  renderLucky();
}

// ---------- 背景排程推進 ----------
// 商品開拍/結標、任務開放/結算這些「時間到了要自動發生」的事，沒辦法只靠 realtime 事件觸發
// (什麼都沒發生，本來就不會有資料異動事件)，所以還是需要背景計時器主動去檢查。
//
// 這裡原本設計成「只有被推選為隊長的那一台分頁負責跑」，其他分頁純被動接收更新，用意是避免
// 所有人的分頁都同時打資料庫。但實測發現一個嚴重問題:如果被選為隊長的那一台分頁被瀏覽器
// 切到背景(切到別的 App、鎖螢幕、切分頁)，瀏覽器會大幅延後甚至完全暫停背景分頁的 setTimeout，
// 導致隊長雖然還「連著」(Presence 沒有斷線，所以不會自動換人當隊長)，但實際上完全沒有在推進，
// 排程就會整個卡死在原地(玩家會看到商品卡在「0 秒後開拍」不會動，兩人以上一起玩時特別容易踩到，
// 因為只要輪到手機切出去看一下 Discord，那台如果剛好是隊長就會卡住)。
//
// 改成:不挑隊長，只要「分頁目前在前景(document.visibilityState === 'visible')」就會自己排程、
// 自己去檢查有沒有東西到期。多台分頁同時檢查也不會重複觸發，因為 activateDueAuctionLots /
// settleExpiredAuctionLots 底層的資料庫更新本來就有 .eq("status", "scheduled"/"live") 這種
// 條件式寫入當保護，同一筆資料只有第一個搶到的分頁會真的寫入成功，其他分頁的更新會直接生效 0 筆、
// 不會出錯也不會重複扣款/重複結算。分頁切回前景的當下也會立刻補跑一次，不用等下一個排定時間到。
async function tick() {
  if (document.visibilityState !== "visible" || ticking || !ev || !ev.locked || ev.status === "closed") return;
  ticking = true;
  try {
    await db.activateDueAuctionLots(eventId);
    await db.settleExpiredAuctionLots(eventId);
    await db.activateDueAuctionTasks(eventId);
    await db.settleExpiredAuctionTasks(eventId);
    await maybeAutoCloseAuction();
  } catch (e) {
    console.error(e);
  } finally {
    ticking = false;
    scheduleNextTick();
  }
}

// 原本 tick() 是每秒硬查一次「有沒有東西到期」，改成算出目前手上這批 lots/tasks 裡最早的
// 下一個時間點(開拍時間/截標時間/緩衝結束時間)，直接排一個精準對時的 setTimeout，時間到了才真的去查。
// 每次 refreshAll() 重新抓到 lots/tasks 後都要重排一次，因為新開的商品/被延長的截標時間
// 都可能讓「下一個到期時間」提前，不能只排一次就不管了。
function scheduleNextTick() {
  if (nextTickTimer) {
    clearTimeout(nextTickTimer);
    nextTickTimer = null;
  }
  if (document.visibilityState !== "visible" || !ev || !ev.locked || ev.status === "closed") return;
  const now = Date.now();
  const candidates = [];
  lots.forEach((l) => {
    if (l.status === "scheduled" && l.scheduled_at) candidates.push(new Date(l.scheduled_at).getTime());
    if (l.status === "live" && l.ends_at) candidates.push(new Date(l.ends_at).getTime());
  });
  tasks.forEach((t) => {
    if (t.status === "scheduled" && t.scheduled_at) candidates.push(new Date(t.scheduled_at).getTime());
    if (t.status === "live" && t.ends_at) candidates.push(new Date(t.ends_at).getTime());
  });
  if (lots.length && !lots.some((l) => l.status === "scheduled" || l.status === "live")) {
    const maxEndsAt = lots.reduce((max, l) => (l.ends_at ? Math.max(max, new Date(l.ends_at).getTime()) : max), 0);
    if (maxEndsAt) candidates.push(maxEndsAt + AUCTION_FINAL_CLOSE_DELAY_SEC * 1000);
  }
  // 保底:理論上手上有商品/任務時一定算得出下一個時間點，這個保底間隔只是防止萬一資料
  // 還沒載入完成、或有沒考慮到的邊界狀況時排程整個停住，不是主要機制。
  const FALLBACK_MS = 15000;
  const nextAt = candidates.length ? Math.min(...candidates) : null;
  const delay = Math.max(200, Math.min(nextAt !== null ? nextAt - now : FALLBACK_MS, FALLBACK_MS));
  nextTickTimer = setTimeout(tick, delay);
}

// 商品全部拍賣完畢後(沒有排隊中也沒有拍賣中的商品了)，留一段緩衝時間讓大家繼續打工/任務/下注花錢，
// 緩衝時間一到，系統自動結算活動(等同主辦人按下「結束活動」)，不用主辦人手動收尾。
// 緩衝的起算點是「最後一件商品實際截標的時間」(取全場所有商品 ends_at 的最大值)。
async function maybeAutoCloseAuction() {
  if (!lots.length) return;
  if (lots.some((l) => l.status === "scheduled" || l.status === "live")) return;
  const maxEndsAt = lots.reduce((max, l) => (l.ends_at ? Math.max(max, new Date(l.ends_at).getTime()) : max), 0);
  if (!maxEndsAt) return;
  if (Date.now() < maxEndsAt + AUCTION_FINAL_CLOSE_DELAY_SEC * 1000) return;
  await db.closeAuctionEvent(eventId);
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
    document.getElementById("labor-note").innerHTML = `${ui.icon("sparkles")}打工成功，拿到 ${result.gain} 財神幣！`;
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
      ? `${dieLabel} · ${ui.icon("circle-check")}猜對了！淨賺 ${result.delta} 財神幣`
      : `${dieLabel} · ${ui.icon("circle-x")}猜錯了，拿回一半，淨虧 ${Math.abs(result.delta)} 財神幣`;
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
  const value = await ui.prompt(`目前最高價 ${lot.current_price} 財神幣，最小加價單位 ${lot.min_increment}。輸入這次要「加多少」:`, {
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

// ---------- 暗標/密封競標:出價互不可見，時間到才一起結算，時間內可以改價 ----------
async function sealedBid(lot) {
  const player = await ensureLogin();
  const value = await ui.prompt(`底價 ${lot.base_price} 財神幣起，盲出你心中的最高價(時間到才會揭曉，可以在截標前修改):`, {
    title: "暗標出價",
    placeholder: String(lot.base_price),
    value: mySealedBidAmount(lot) ? String(mySealedBidAmount(lot)) : String(lot.base_price),
  });
  if (value === null) return;
  const amount = parseInt(value);
  if (!amount || amount < lot.base_price) {
    await ui.alert(`出價不能低於底價 ${lot.base_price}。`, { title: "金額太小", tone: "danger" });
    return;
  }
  try {
    await db.submitSealedBid(lot, player.id, amount);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "出價失敗", { title: "出價失敗", tone: "danger" });
    await refreshAll();
  }
}
function mySealedBidAmount(lot) {
  const mine = mySealedBids.find((b) => b.lot_id === lot.id);
  return mine ? mine.amount : null;
}

// ---------- 限時快閃攤:不用比價，固定價格先搶先贏 ----------
async function claimFlash(lot) {
  const player = await ensureLogin();
  try {
    await db.claimFlashLot(lot, player.id);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "搶購失敗", { title: "搶購失敗", tone: "danger" });
    await refreshAll();
  }
}

// ---------- 商品鑑定符:私下看福袋箱大概是哪個等級 ----------
async function appraise(lot) {
  const player = await ensureLogin();
  try {
    const tier = await db.useAppraisal(eventId, player.id, lot);
    await refreshAll();
    const tierLabel = { bust: "雷", common: "普通", rare: "稀有", epic: "史詩", legendary: "傳說" }[tier] || tier;
    await ui.alert(`這箱鑑定結果大概是「${tierLabel}」等級，只有你看得到，其他人不知道。`, { title: "鑑定結果", tone: "info" });
  } catch (e) {
    await ui.alert(e.message || "鑑定失敗", { title: "鑑定失敗", tone: "danger" });
    await refreshAll();
  }
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

// ---------- 合夥競標 ----------
async function invitePartner(lot, partnerId) {
  const player = await ensureLogin();
  if (!partnerId) return;
  try {
    await db.inviteAuctionPartner(lot.id, eventId, player.id, partnerId);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "邀請失敗", { title: "邀請失敗", tone: "danger" });
    await refreshAll();
  }
}

async function respondPartner(lot, accept) {
  const player = await ensureLogin();
  try {
    await db.respondAuctionPartner(lot.id, player.id, accept);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "操作失敗", { title: "操作失敗", tone: "danger" });
    await refreshAll();
  }
}

async function cancelPartner(lot) {
  const player = await ensureLogin();
  try {
    await db.cancelAuctionPartner(lot.id, player.id);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "取消失敗", { title: "取消失敗", tone: "danger" });
    await refreshAll();
  }
}

// ---------- 猜價小遊戲 ----------
async function submitGuess(lot, value) {
  const player = await ensureLogin();
  const amount = parseInt(value);
  if (!Number.isFinite(amount) || amount < 0) {
    await ui.alert("請輸入合理的金額。", { title: "金額不對", tone: "danger" });
    return;
  }
  try {
    await db.submitAuctionPriceGuess(lot.id, eventId, player.id, amount);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "送出失敗", { title: "送出失敗", tone: "danger" });
    await refreshAll();
  }
}

// ---------- 特殊券效果 ----------
async function useIntel() {
  const player = await ensureLogin();
  try {
    await db.useAuctionIntelTicket(eventId, player.id);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "使用失敗", { title: "使用失敗", tone: "danger" });
    await refreshAll();
  }
}

async function usePriority() {
  const player = await ensureLogin();
  try {
    await db.useAuctionPriorityTicket(eventId, player.id);
    await ui.alert("已經幫你預約下一波的插隊優先權，那一波開拍時你會有專屬優先出價時間。", { title: "預約成功", tone: "success" });
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "使用失敗", { title: "使用失敗", tone: "danger" });
    await refreshAll();
  }
}

async function useRefund(lotId) {
  const player = await ensureLogin();
  const ok = await ui.confirm("確定要退回這件商品嗎?退回後這件商品的分數會被拿掉，但可以拿回一半財神幣。", {
    title: "退款保證券",
    confirmText: "確定退回",
  });
  if (!ok) return;
  try {
    const result = await db.useAuctionRefundTicket(lotId, eventId, player.id);
    myParticipant = result.participant;
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "退回失敗", { title: "退回失敗", tone: "danger" });
    await refreshAll();
  }
}

async function useBoxDouble() {
  const player = await ensureLogin();
  try {
    await db.useAuctionBoxDoubleTicket(eventId, player.id);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "使用失敗", { title: "使用失敗", tone: "danger" });
    await refreshAll();
  }
}

async function redeemFreeCommon(lot) {
  const player = await ensureLogin();
  try {
    await db.useAuctionFreeCommonTicket(lot.id, eventId, player.id);
    await refreshAll();
  } catch (e) {
    await ui.alert(e.message || "兌換失敗", { title: "兌換失敗", tone: "danger" });
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
    // 剛打工成功的提示訊息還在顯示，先不要被下一次自動刷新蓋掉
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
    document.getElementById("join-note").textContent = "拍賣已經開始，報名已截止(全自動排程開拍中，不能中途加入拿完整預算)。";
    document.getElementById("join-btn").style.display = "none";
    return;
  }
  const deadlinePassed = ev.registration_deadline && new Date() > new Date(ev.registration_deadline);
  joinCard.style.display = "block";
  document.getElementById("join-btn").style.display = deadlinePassed ? "none" : "inline-flex";
  document.getElementById("join-note").textContent = deadlinePassed
    ? "報名已截止。"
    : `報名時會發一筆固定 ${(ev.rules && ev.rules.startingBudget) || AUCTION_DEFAULT_BUDGET} 財神幣，大家起跑點完全一樣。`;
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
  const totalSec = lot.is_flash ? AUCTION_FLASH_DURATION_SEC : AUCTION_LOT_DURATION_SEC;
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

function partnerSectionHtml(lot) {
  const myId = currentPlayer && currentPlayer.id;
  if (!myId || !myParticipant) return "";
  const status = lot.partner_status;
  const nameOf = (playerId) => {
    const row = standings.find((r) => r.participant.player_id === playerId);
    return row ? row.participant.players.name : "夥伴";
  };
  if (status === "pending" && lot.partner_b_id === myId) {
    return `
      <div class="partner-box">
        <div>${ui.icon("users")}<b>${ui.esc(nameOf(lot.partner_a_id))}</b> 邀你合夥搶這一波，標到後價錢跟分數各分一半</div>
        <div class="partner-actions">
          <button class="btn" id="partner-accept-btn">${ui.icon("circle-check")}接受</button>
          <button class="btn ghost" id="partner-decline-btn">${ui.icon("circle-x")}婉拒</button>
        </div>
      </div>
    `;
  }
  if (status === "pending" && lot.partner_a_id === myId) {
    return `
      <div class="partner-box">
        <div>${ui.icon("hourglass")}等待 ${ui.esc(nameOf(lot.partner_b_id))} 回應合夥邀請中...</div>
        <div class="partner-actions">
          <button class="btn ghost" id="partner-cancel-btn">${ui.icon("circle-x")}取消邀請</button>
        </div>
      </div>
    `;
  }
  if (status === "accepted" && (lot.partner_a_id === myId || lot.partner_b_id === myId)) {
    const otherId = lot.partner_a_id === myId ? lot.partner_b_id : lot.partner_a_id;
    return `<div class="partner-box accepted">${ui.icon("users")}合夥出價中(與 <b>${ui.esc(nameOf(otherId))}</b>)・標到後價錢跟分數各分一半</div>`;
  }
  if (!status || status === "declined") {
    if (lot.status !== "scheduled") {
      return `<div class="partner-box muted">${ui.icon("clock-x")}開拍前沒找到合夥人，這波已經沒辦法再邀請，只能自己單獨出價</div>`;
    }
    const others = standings.filter((r) => r.participant.player_id !== myId);
    if (!others.length) return "";
    const options = others.map((r) => `<option value="${r.participant.player_id}">${ui.esc(r.participant.players.name)}</option>`).join("");
    return `
      <div class="partner-box">
        <div>${ui.icon("users")}想找人一起合夥搶這一波嗎?標到後價錢跟分數各分一半</div>
        <div class="partner-actions">
          <select id="partner-select">${options}</select>
          <button class="btn ghost" id="partner-invite-btn">${ui.icon("send")}邀請合夥</button>
        </div>
      </div>
    `;
  }
  return `<div class="partner-box muted">${ui.icon("users")}這一波已經有其他人在合夥搶標了</div>`;
}

function guessSectionHtml(lot, myGuess) {
  if (!currentPlayer || !myParticipant) return "";
  if (myGuess) {
    return `<div class="guess-box">${ui.icon("target")}你猜這件會標到 <b>${myGuess.guess}</b> 財神幣，結標後看誰最接近就加分</div>`;
  }
  if (lot.status !== "scheduled") {
    return `<div class="guess-box muted">${ui.icon("clock-x")}開拍前沒有猜價，這波已經錯過猜價視窗了</div>`;
  }
  return `
    <div class="guess-box">
      <div>${ui.icon("target")}猜猜這件最後會標到多少錢?猜中或最接近可以加分，不用出價也能參加</div>
      <div class="guess-actions">
        <input type="number" id="guess-input" placeholder="輸入金額" />
        <button class="btn ghost" id="guess-submit-btn">${ui.icon("send")}送出猜測</button>
      </div>
    </div>
  `;
}

function priorityWindowActive(lot) {
  return !!(lot.priority_holder_id && lot.priority_until && new Date(lot.priority_until).getTime() > Date.now());
}

function lotStageHtml(lot, isFinalLot, myGuess) {
  const myId = currentPlayer && currentPlayer.id;
  const isMineLeading = lot.current_bidder_id && myId && lot.current_bidder_id === myId;
  const isSpecial = lot.item_tier === "special";
  const isMystery = lot.item_tier === "mystery";
  const specialInfo = isSpecial ? AUCTION_SPECIAL_ITEMS.find((s) => s.key === lot.special_key) : null;
  const priorityActive = priorityWindowActive(lot);
  const iAmPriorityHolder = priorityActive && myId && lot.priority_holder_id === myId;
  const priorityBlocked = priorityActive && !iAmPriorityHolder;

  let priorityBannerHtml = "";
  if (priorityActive) {
    const secLeft = Math.max(0, Math.ceil((new Date(lot.priority_until).getTime() - Date.now()) / 1000));
    priorityBannerHtml = iAmPriorityHolder
      ? `<div class="priority-banner mine">${ui.icon("fast-forward")}你的插隊優先權時間！還有 ${secLeft} 秒只有你能出價</div>`
      : `<div class="priority-banner">${ui.icon("fast-forward")}這波有人插隊優先，還有 ${secLeft} 秒後其他人才能搶標</div>`;
  }

  let flourishBannerHtml = "";
  if (lot.is_surprise) {
    flourishBannerHtml += `<div class="flourish-banner surprise">${ui.icon("gift")}隱藏驚喜商品！商品預告沒有預告到這件</div>`;
  }
  if (lot.is_sealed) {
    flourishBannerHtml += `<div class="flourish-banner surprise">${ui.icon("eye-off")}暗標競標！大家同時盲出價，時間到才一起揭曉，看不到別人出多少</div>`;
  }
  if (isFinalLot) {
    flourishBannerHtml += `<div class="flourish-banner sprint">${ui.icon("flag")}最後衝刺！這是本場最後一波，剩餘財神幣快點花掉，沒花完只值一半分數</div>`;
  }

  // 限時快閃攤:完全不同的介面，固定價格先搶先贏，不用比價、不用合夥/猜價這些搭配英式競標的功能
  if (lot.is_flash) {
    const flashPoints = auctionPointsForPrice(lot.current_price, lot.item_tier);
    const claimed = !!lot.current_bidder_id;
    const flashActionHtml = !myParticipant
      ? `<span class="section-note" style="margin:0;">${ui.icon("info")}先報名才能搶購</span>`
      : claimed
      ? `<span class="section-note" style="margin:0;">${ui.icon("check")}已經被搶走了</span>`
      : `<button class="btn" id="flash-claim-btn" style="width:100%;">${ui.icon("zap")}立刻搶購(固定價格，先搶先贏)</button>`;
    return `
      <div class="card auction-live flash">
        <span class="live-tag flash-tag"><span class="dot"></span>⚡ 限時快閃攤 · 手刀搶購</span>
        ${flourishBannerHtml}
        <div class="lot-stage">
          <div class="lot-info">
            ${ui.tierTag(lot.item_tier)}
            <h3 style="margin-top:10px;">${ui.esc(lot.item_name)}</h3>
            <div class="price-row">
              <span class="cur">${lot.current_price}</span>
              <span class="unit">財神幣(固定搶購價，得標可拿 ${flashPoints} 分)</span>
            </div>
            <div class="bid-row" id="bid-row">${flashActionHtml}</div>
          </div>
          <div class="countdown-dial">
            <svg width="96" height="96" viewBox="0 0 96 96">
              <circle cx="48" cy="48" r="40" fill="none" stroke="#34304A" stroke-width="8"/>
              <circle id="cd-ring" cx="48" cy="48" r="40" fill="none" stroke="#F2B705" stroke-width="8"
                stroke-linecap="round" stroke-dasharray="251.2" stroke-dashoffset="0"/>
            </svg>
            <div class="num" id="cd-num">--</div>
            <div class="lbl">秒後流標</div>
          </div>
        </div>
      </div>
    `;
  }

  let extraActionHtml = "";
  if (lot.item_tier === "common" && myParticipant && myParticipant.effects && myParticipant.effects.freeCommon > 0) {
    extraActionHtml = `<button class="btn ghost" id="bid-free-common" style="margin-top:10px;">${ui.icon(
      "hand-platter"
    )}用老闆招待券免費兌換</button>`;
  }
  // 商品鑑定符:只能用在福袋箱上，用過的話私下顯示鑑定結果(只有自己看得到)
  if (isMystery && myParticipant) {
    const appraisals = (myParticipant.effects && myParticipant.effects.appraisals) || {};
    const myAppraisal = appraisals[lot.id];
    const tierLabel = { bust: "雷", common: "普通", rare: "稀有", epic: "史詩", legendary: "傳說" };
    if (myAppraisal) {
      extraActionHtml += `<div class="section-note" style="margin-top:10px;">${ui.icon("search")}你鑑定過這箱，大概是「${
        tierLabel[myAppraisal] || myAppraisal
      }」等級(只有你看得到)</div>`;
    } else if (myParticipant.effects && myParticipant.effects.appraise > 0) {
      extraActionHtml += `<button class="btn ghost" id="bid-appraise" style="margin-top:10px;">${ui.icon("search")}使用商品鑑定符偷看等級</button>`;
    }
  }

  // 分數現在跟著成交價走，所以這裡不能用開拍前就寫死的 lot.points，要用目前最高價現算，
  // 讓大家出價的時候就能即時看到「如果現在標到，會拿多少分」，價格漲分數也跟著漲。
  const livePoints = lot.item_tier === "bundle" ? auctionPointsForBundlePrice(lot.current_price) : auctionPointsForPrice(lot.current_price, lot.item_tier);
  const priceUnitHtml = isSpecial
    ? `<span class="unit">財神幣(目前最高價，得標後可以使用一次「${ui.esc((specialInfo && specialInfo.name) || "特殊效果")}」)</span>`
    : isMystery
    ? `<span class="unit">財神幣(目前最高價，得標後現場開箱才知道多少分——可能超值也可能是雷)</span>`
    : `<span class="unit">財神幣(目前最高價，得標可拿 ${livePoints} 分)</span>`;

  const effectDescHtml = isSpecial && specialInfo ? `<div class="section-note" style="margin:6px 0 0;">${ui.esc(specialInfo.effectDesc)}</div>` : "";

  // 暗標競標:看不到別人出多少、也看不到目前價格/領先者(不然就不叫暗標了)，只顯示自己出過的價格
  let bidRowHtml;
  let priceRowHtml;
  let bidderRowHtml;
  if (lot.is_sealed) {
    const mine = mySealedBidAmount(lot);
    priceRowHtml = `<div class="price-row"><span class="cur">${lot.base_price}</span><span class="unit">財神幣起標(暗標中，看不到目前最高價)</span></div>`;
    bidderRowHtml = `<div class="bidder">${mine ? `你目前盲出的價格:<b>${mine}</b>(截標前都可以改)` : "你還沒出價"}</div>`;
    bidRowHtml = !myParticipant
      ? `<span class="section-note" style="margin:0;">${ui.icon("info")}先報名才能出價</span>`
      : `<button class="btn" id="sealed-bid-btn">${ui.icon("eye-off")}${mine ? "修改我的暗標" : "盲出一個價格"}</button>`;
  } else {
    priceRowHtml = `<div class="price-row"><span class="cur">${lot.current_price}</span>${priceUnitHtml}</div>`;
    bidderRowHtml = `<div class="bidder">目前領先:<b>${
      lot.current_bidder_id ? ui.esc(lot.bidder ? lot.bidder.name : "??") + (isMineLeading ? "(你)" : "") : "尚無人出價"
    }</b> ・ 最小加價 ${lot.min_increment} 枚</div>`;
    bidRowHtml = !myParticipant
      ? `<span class="section-note" style="margin:0;">${ui.icon("info")}先報名才能出價</span>`
      : priorityBlocked
      ? `<span class="section-note" style="margin:0;">${ui.icon("hourglass")}等插隊優先權時間結束才能搶標</span>`
      : `
      <button class="btn" id="bid-min">${ui.icon("gavel")}加價 ${lot.min_increment}</button>
      <button class="btn" id="bid-x5">${ui.icon("gavel")}加價 ${lot.min_increment * 5}</button>
      <button class="btn ghost" id="bid-custom">${ui.icon("pencil")}自訂金額</button>
    `;
  }

  return `
    <div class="card auction-live${isSpecial ? " special" : ""}${isMystery ? " mystery" : ""}${lot.is_sealed ? " sealed" : ""}">
      <span class="live-tag"><span class="dot"></span>LOT ${ui.esc(String(lot.wave_number))} · 本波拍賣進行中</span>
      ${flourishBannerHtml}
      ${priorityBannerHtml}
      <div class="lot-stage">
        <div class="lot-info">
          ${ui.tierTag(lot.item_tier)}
          <h3 style="margin-top:10px;">${ui.esc(lot.item_name)}</h3>
          ${priceRowHtml}
          ${effectDescHtml}
          ${bidderRowHtml}
          <div class="bid-row" id="bid-row">${bidRowHtml}</div>
          ${extraActionHtml}
          ${lot.is_sealed ? "" : partnerSectionHtml(lot)}
          ${lot.is_sealed ? "" : guessSectionHtml(lot, myGuess)}
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

function nextLotPreviewHtml(lot, myGuess) {
  const isSpecial = lot.item_tier === "special";
  const isMystery = lot.item_tier === "mystery";
  const specialInfo = isSpecial ? AUCTION_SPECIAL_ITEMS.find((s) => s.key === lot.special_key) : null;
  const estPoints =
    lot.item_tier === "bundle" ? auctionPointsForBundlePrice(lot.base_price) : auctionPointsForPrice(lot.base_price, lot.item_tier);
  const pointsNote = lot.is_flash
    ? `固定搶購價 ${lot.base_price} 枚，不用比價，先搶先贏，用底價估至少可拿 ${estPoints} 分`
    : isSpecial
    ? `得標後可以使用一次「${ui.esc((specialInfo && specialInfo.name) || "特殊效果")}」`
    : isMystery
    ? "得標後現場開箱才知道多少分"
    : `用底價得標至少可拿 ${estPoints} 分(實際成交價越高分數越高)`;
  const modeNote = lot.is_flash
    ? `<div class="section-note" style="margin:4px 0 0;">${ui.icon("zap")}限時快閃攤:開拍後手刀點「搶購」，不用出價比大小</div>`
    : lot.is_sealed
    ? `<div class="section-note" style="margin:4px 0 0;">${ui.icon("eye-off")}暗標競標:開拍後盲出一個價格，看不到別人出多少，時間到才揭曉</div>`
    : `<div class="section-note" style="margin:4px 0 0;">${ui.icon("lock")}猜價/合夥邀請只能在開拍前操作，一開拍就會鎖住</div>`;
  return `
    <div class="card auction-prebid">
      <span class="live-tag prebid"><span class="dot"></span>LOT ${ui.esc(String(lot.wave_number))} · 開拍前預告 · <span id="next-lot-cd">--</span> 秒後開拍</span>
      <div class="lot-info">
        ${ui.tierTag(lot.item_tier)}
        <h3 style="margin-top:10px;">${ui.esc(lot.item_name)}</h3>
        <div class="price-row">
          <span class="cur">${lot.base_price}</span>
          <span class="unit">財神幣${lot.is_flash ? "(固定搶購價)" : "起標"}</span>
        </div>
        <div class="section-note" style="margin:6px 0 0;">${ui.icon("info")}${pointsNote}</div>
        ${modeNote}
        ${lot.is_flash || lot.is_sealed ? "" : partnerSectionHtml(lot)}
        ${lot.is_flash ? "" : guessSectionHtml(lot, myGuess)}
      </div>
    </div>
  `;
}

function startNextLotCountdown(lot) {
  stopCountdown();
  const tick3 = () => {
    const remainingSec = Math.max(0, Math.ceil((new Date(lot.scheduled_at).getTime() - Date.now()) / 1000));
    const numEl = document.getElementById("next-lot-cd");
    if (!numEl) {
      stopCountdown();
      return;
    }
    numEl.textContent = remainingSec;
  };
  tick3();
  countdownInterval = setInterval(tick3, 1000);
}

function renderLotSection() {
  const box = document.getElementById("lot-section");
  if (!ev.locked) {
    stopCountdown();
    box.innerHTML = `<div class="card empty">${ui.icon("hourglass")}拍賣還沒開始，等主辦人按下「開始拍賣」後，系統會自動依排程開拍</div>`;
    return;
  }
  if (ev.status === "closed") {
    stopCountdown();
    box.innerHTML = `<div class="card empty">${ui.icon("flag")}這場拍賣已經結束了，結果請看下面的即時排行榜</div>`;
    return;
  }
  const liveLot = lots.find((l) => l.status === "live");
  if (liveLot) {
    const isFinalLot = !lots.some((l) => l.status === "scheduled");
    const myGuess = currentPlayer ? myPriceGuesses.find((g) => g.lot_id === liveLot.id) : null;
    box.innerHTML = lotStageHtml(liveLot, isFinalLot, myGuess);
    const bidMinBtn = document.getElementById("bid-min");
    const bidX5Btn = document.getElementById("bid-x5");
    const bidCustomBtn = document.getElementById("bid-custom");
    if (bidMinBtn) bidMinBtn.onclick = () => bid(liveLot, liveLot.min_increment);
    if (bidX5Btn) bidX5Btn.onclick = () => bid(liveLot, liveLot.min_increment * 5);
    if (bidCustomBtn) bidCustomBtn.onclick = () => customBid(liveLot);
    const flashClaimBtn = document.getElementById("flash-claim-btn");
    if (flashClaimBtn) flashClaimBtn.onclick = () => claimFlash(liveLot);
    const sealedBidBtn = document.getElementById("sealed-bid-btn");
    if (sealedBidBtn) sealedBidBtn.onclick = () => sealedBid(liveLot);
    const appraiseBtn = document.getElementById("bid-appraise");
    if (appraiseBtn) appraiseBtn.onclick = () => appraise(liveLot);
    const freeCommonBtn = document.getElementById("bid-free-common");
    if (freeCommonBtn) freeCommonBtn.onclick = () => redeemFreeCommon(liveLot);
    const partnerInviteBtn = document.getElementById("partner-invite-btn");
    if (partnerInviteBtn) {
      partnerInviteBtn.onclick = () => {
        const select = document.getElementById("partner-select");
        invitePartner(liveLot, select.value);
      };
    }
    const partnerAcceptBtn = document.getElementById("partner-accept-btn");
    if (partnerAcceptBtn) partnerAcceptBtn.onclick = () => respondPartner(liveLot, true);
    const partnerDeclineBtn = document.getElementById("partner-decline-btn");
    if (partnerDeclineBtn) partnerDeclineBtn.onclick = () => respondPartner(liveLot, false);
    const partnerCancelBtn = document.getElementById("partner-cancel-btn");
    if (partnerCancelBtn) partnerCancelBtn.onclick = () => cancelPartner(liveLot);
    const guessSubmitBtn = document.getElementById("guess-submit-btn");
    if (guessSubmitBtn) {
      guessSubmitBtn.onclick = () => {
        const input = document.getElementById("guess-input");
        submitGuess(liveLot, input.value);
      };
    }
    startCountdown(liveLot);
    return;
  }
  stopCountdown();
  const scheduled = lots.filter((l) => l.status === "scheduled").sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  if (scheduled.length) {
    const next = scheduled[0];
    if (next.is_surprise || !myParticipant) {
      const secLeft = Math.max(0, Math.ceil((new Date(next.scheduled_at).getTime() - Date.now()) / 1000));
      box.innerHTML = next.is_surprise
        ? `<div class="card empty">${ui.icon("gift")}下一波即將開始(${secLeft > 0 ? `約 ${secLeft} 秒後` : "馬上就好"})，這波是隱藏驚喜商品，開拍才知道是什麼！</div>`
        : `<div class="card empty">${ui.icon("hourglass")}下一波即將開始(${secLeft > 0 ? `約 ${secLeft} 秒後` : "馬上就好"})，先報名才能猜價/合夥</div>`;
      return;
    }
    const myGuess = currentPlayer ? myPriceGuesses.find((g) => g.lot_id === next.id) : null;
    box.innerHTML = nextLotPreviewHtml(next, myGuess);
    const partnerInviteBtn = document.getElementById("partner-invite-btn");
    if (partnerInviteBtn) {
      partnerInviteBtn.onclick = () => {
        const select = document.getElementById("partner-select");
        invitePartner(next, select.value);
      };
    }
    const partnerAcceptBtn = document.getElementById("partner-accept-btn");
    if (partnerAcceptBtn) partnerAcceptBtn.onclick = () => respondPartner(next, true);
    const partnerDeclineBtn = document.getElementById("partner-decline-btn");
    if (partnerDeclineBtn) partnerDeclineBtn.onclick = () => respondPartner(next, false);
    const partnerCancelBtn = document.getElementById("partner-cancel-btn");
    if (partnerCancelBtn) partnerCancelBtn.onclick = () => cancelPartner(next);
    const guessSubmitBtn = document.getElementById("guess-submit-btn");
    if (guessSubmitBtn) {
      guessSubmitBtn.onclick = () => {
        const input = document.getElementById("guess-input");
        submitGuess(next, input.value);
      };
    }
    startNextLotCountdown(next);
    return;
  }
  if (lots.length) {
    const maxEndsAt = lots.reduce((max, l) => (l.ends_at ? Math.max(max, new Date(l.ends_at).getTime()) : max), 0);
    const secLeft = maxEndsAt ? Math.max(0, Math.ceil((maxEndsAt + AUCTION_FINAL_CLOSE_DELAY_SEC * 1000 - Date.now()) / 1000)) : null;
    const closeNote =
      secLeft === null
        ? "等主辦人結算活動吧"
        : secLeft > 0
        ? `還可以繼續打工/夜市任務/幸運攤位 <b style="color:var(--gold);">${secLeft}</b> 秒，時間到系統會自動結算活動`
        : "正在自動結算活動，稍等一下...";
    box.innerHTML = `<div class="card empty">${ui.icon("party-popper")}本場商品已經全部拍賣完畢！${closeNote}</div>`;
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
    bodyHtml = `<div class="section-note" style="margin:10px 0 0;">${ui.icon("info")}先報名才能作答，但作答不用出財神幣</div>`;
  } else if (myAnswer) {
    bodyHtml = myAnswer.correct
      ? `<div class="task-result correct">${ui.icon("circle-check")}答對了！拿到 ${task.reward} 財神幣</div>`
      : `<div class="task-result wrong">${ui.icon("circle-x")}答錯了，這題只能猜一次，下一題再拚</div>`;
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
  const scheduled = lots
    .filter((l) => l.status === "scheduled" && !l.is_surprise)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  if (!scheduled.length) {
    card.style.display = "none";
    return;
  }
  card.style.display = "block";
  const hasIntel = !!(myParticipant && myParticipant.effects && myParticipant.effects.intelActive);
  const limit = hasIntel ? AUCTION_INTEL_PREVIEW_UNLOCKED : AUCTION_INTEL_PREVIEW_DEFAULT;
  document.getElementById("upnext-scroll").innerHTML = scheduled.slice(0, limit).map(upnextCardHtml).join("");
  const note = document.getElementById("upnext-note");
  if (hasIntel) {
    note.innerHTML = `${ui.icon("eye")}已使用搶先情報券，看到全場剩餘的完整清單`;
  } else if (scheduled.length > limit) {
    note.textContent = `目前只顯示最近 ${limit} 件，使用搶先情報券可以看到全場剩餘的完整清單`;
  } else {
    note.textContent = "";
  }
}

function renderBackpack() {
  const card = document.getElementById("backpack-card");
  card.style.display = myParticipant && currentPlayer ? "block" : "none";
}

function bindBackpackTabs() {
  document.querySelectorAll("#backpack-tabs .backpack-tab").forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll("#backpack-tabs .backpack-tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.getElementById("backpack-items-panel").style.display = tab.dataset.panel === "items" ? "block" : "none";
      document.getElementById("backpack-tickets-panel").style.display = tab.dataset.panel === "tickets" ? "block" : "none";
    };
  });
}

function renderBag() {
  const itemsCountEl = document.getElementById("backpack-items-count");
  if (!myParticipant || !currentPlayer) {
    if (itemsCountEl) itemsCountEl.textContent = "0";
    return;
  }
  const won = lots.filter(
    (l) =>
      l.status === "done" &&
      (l.current_bidder_id === currentPlayer.id ||
        (l.partner_status === "accepted" && (l.partner_a_id === currentPlayer.id || l.partner_b_id === currentPlayer.id)))
  );
  itemsCountEl.textContent = won.length;
  const box = document.getElementById("bag-list");
  if (!won.length) {
    box.innerHTML = `<div class="bag-empty">還沒有標到任何商品</div>`;
    return;
  }
  const canRefund = myParticipant.effects && myParticipant.effects.refund > 0;
  const ownedNames = won.filter((l) => !l.refunded).map((l) => l.item_name);
  const seriesHtml = AUCTION_ITEM_SERIES.map((series) => {
    const progress = auctionSeriesProgress(series, ownedNames);
    const itemsHtml = series.items
      .map((n) => `<span class="series-item${progress.have.includes(n) ? " got" : ""}">${ui.esc(n)}</span>`)
      .join("");
    return `<div class="series-row${progress.complete ? " complete" : ""}">
      <div class="series-head"><b>${ui.esc(series.name)}</b>${
      progress.complete ? `<span class="series-bonus">${ui.icon("sparkles")}已湊齊，加 ${series.bonus} 分</span>` : `<span class="series-bonus dim">湊齊全套加 ${series.bonus} 分</span>`
    }</div>
      <div class="series-items">${itemsHtml}</div>
    </div>`;
  }).join("");
  const seriesBlock = `<div class="series-list">${seriesHtml}</div>`;

  box.innerHTML =
    seriesBlock +
    won
    .map((l) => {
      const isPrimary = l.current_bidder_id === currentPlayer.id;
      if (!isPrimary) {
        // 我是這一波的合夥夥伴(不是主要出價者)，價錢跟分數已經各分一半算進我自己的排行分數裡，這裡不能退貨。
        return `
      <div class="bag-item-row">
        ${ui.tierTag(l.item_tier)}
        <span class="bag-name"><span class="n">${ui.esc(l.item_name)}</span></span>
        <span class="bag-paid">${ui.icon("users")}合夥得標・價錢分數各半</span>
      </div>
    `;
      }
      const isMysteryReveal = l.item_tier === "mystery" && l.box_reveal_name;
      const subHtml = isMysteryReveal
        ? `<span class="sub">開箱結果:${ui.esc(l.box_reveal_name)}${l.box_doubled ? "・翻倍！" : ""}</span>`
        : "";
      const priceLabel = `得標 ${l.current_price}`;
      let tailHtml;
      if (l.refunded) {
        tailHtml = `<span class="bag-paid">${ui.icon("undo-2")}已退貨</span>`;
      } else if (canRefund) {
        tailHtml = `<span class="bag-paid">${priceLabel}</span><button class="btn ghost bag-refund-btn" data-lot="${l.id}">${ui.icon(
          "undo-2"
        )}退貨</button>`;
      } else {
        tailHtml = `<span class="bag-paid">${priceLabel}</span>`;
      }
      return `
    <div class="bag-item-row">
      ${ui.tierTag(l.item_tier)}
      <span class="bag-name"><span class="n">${ui.esc(l.item_name)}</span>${subHtml}</span>
      ${tailHtml}
    </div>
  `;
    })
    .join("");
  box.querySelectorAll(".bag-refund-btn").forEach((btn) => {
    btn.onclick = () => useRefund(btn.dataset.lot);
  });
}

function renderTierList(tier) {
  if (tier === "special") {
    document.getElementById("tier-list").innerHTML = AUCTION_SPECIAL_ITEMS.map(
      (sp) => `
    <div class="item-row special-item-row">
      <span class="name">${ui.esc(sp.name)}</span>
      <span class="pts">底價 ${sp.basePrice}</span>
    </div>
    <div class="special-item-desc">${ui.esc(sp.effectDesc)}</div>
  `
    ).join("");
    document.getElementById("tier-note").textContent = "不計分，得標後可以使用一次對應的特殊效果，整場各限量一張";
    return;
  }
  if (tier === "mystery") {
    document.getElementById("tier-list").innerHTML = AUCTION_MYSTERY_BOXES.map(
      ([name, basePrice]) => `
    <div class="item-row">
      <span class="name">${ui.esc(name)}</span>
      <span class="pts">底價 ${basePrice}・分數開箱才知道</span>
    </div>
  `
    ).join("");
    document.getElementById("tier-note").textContent = "得標後現場開箱，大約 10% 機率是雷(5分)，也有機會開出傳說大獎(150分)";
    return;
  }
  if (tier === "bundle") {
    document.getElementById("tier-list").innerHTML = AUCTION_BUNDLE_ITEMS.map(
      (b) => `
    <div class="item-row">
      <span class="name">${ui.esc(b.name)}</span>
      <span class="pts">底價 ${b.basePrice}・${auctionPointsForBundlePrice(b.basePrice)} 分</span>
    </div>
  `
    ).join("");
    document.getElementById("tier-note").textContent = "一次多件小東西綁在一起賣，適合想快速湊分的人";
    return;
  }
  const data = AUCTION_CATALOG[tier];
  document.getElementById("tier-list").innerHTML = data.items
    .map(
      ([name, basePrice]) => `
    <div class="item-row">
      <span class="name">${ui.esc(name)}</span>
      <span class="pts">底價 ${basePrice}・${auctionPointsForPrice(basePrice, tier)} 分</span>
    </div>
  `
    )
    .join("");
  document.getElementById("tier-note").textContent = data.note;
}

function bindTierTabs() {
  document.querySelectorAll("#tier-tabs .folder-tab").forEach((tab) => {
    tab.onclick = () => {
      renderTierList(tab.dataset.tier);
      document.querySelectorAll("#tier-tabs .folder-tab").forEach((t) => t.classList.toggle("active", t === tab));
    };
  });
  renderTierList("common");
}

function renderTickets() {
  const ticketsCountEl = document.getElementById("backpack-tickets-count");
  if (!myParticipant) {
    if (ticketsCountEl) ticketsCountEl.textContent = "0";
    return;
  }
  const effects = myParticipant.effects || {};
  const keys = Object.keys(AUCTION_TICKET_META).filter(
    (k) => (effects[k] || 0) > 0 || (k === "intel" && effects.intelActive) || (k === "boxDouble" && effects.boxDoubleActive)
  );
  ticketsCountEl.textContent = keys.length;
  const box = document.getElementById("ticket-list");
  if (!keys.length) {
    box.innerHTML = `<div class="bag-empty">目前沒有持有的特殊道具</div>`;
    return;
  }
  const running = ev.locked && ev.status !== "closed";
  box.innerHTML = keys
    .map((key) => {
      const meta = AUCTION_TICKET_META[key];
      const count = effects[key] || 0;
      let actionHtml;
      if (key === "intel") {
        actionHtml = effects.intelActive
          ? `<span class="section-note" style="margin:0;">${ui.icon("circle-check")}已啟用</span>`
          : `<button class="btn ghost ticket-use-btn" data-key="intel" ${running ? "" : "disabled"}>${ui.icon("eye")}使用</button>`;
      } else if (key === "priority") {
        actionHtml = `<button class="btn ghost ticket-use-btn" data-key="priority" ${running ? "" : "disabled"}>${ui.icon(
          "fast-forward"
        )}預約下一波(x${count})</button>`;
      } else if (key === "boxDouble") {
        actionHtml = effects.boxDoubleActive
          ? `<span class="section-note" style="margin:0;">${ui.icon("circle-check")}已啟用，下次開福袋箱自動翻倍</span>`
          : `<button class="btn ghost ticket-use-btn" data-key="boxDouble" ${running ? "" : "disabled"}>${ui.icon("package-open")}使用</button>`;
      } else if (key === "refund") {
        actionHtml = `<span class="section-note" style="margin:0;">切換到「得標商品」分頁，對想退的商品按退貨(x${count})</span>`;
      } else if (key === "freeCommon") {
        actionHtml = `<span class="section-note" style="margin:0;">拍賣「普通」級商品時，拍賣卡片上會出現兌換按鈕(x${count})</span>`;
      } else {
        actionHtml = `<span class="section-note" style="margin:0;">x${count}</span>`;
      }
      const desc = (AUCTION_SPECIAL_ITEMS.find((sp) => sp.key === key) || {}).effectDesc || "";
      return `
      <div class="ticket-row">
        <div class="ticket-info">
          <div class="ticket-name">${ui.icon(meta.icon)}<b>${ui.esc(meta.name)}</b>${key !== "priority" ? ` <span class="ticket-count">x${count}</span>` : ""}</div>
          ${desc ? `<div class="ticket-desc">${ui.esc(desc)}</div>` : ""}
        </div>
        <div class="ticket-action">${actionHtml}</div>
      </div>
    `;
    })
    .join("");
  box.querySelectorAll('.ticket-use-btn[data-key="intel"]').forEach((btn) => (btn.onclick = useIntel));
  box.querySelectorAll('.ticket-use-btn[data-key="priority"]').forEach((btn) => (btn.onclick = usePriority));
  box.querySelectorAll('.ticket-use-btn[data-key="boxDouble"]').forEach((btn) => (btn.onclick = useBoxDouble));
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
  renderBackpack();
  renderBag();
  renderTickets();
  renderLeaderboard();
}

// ---------- 規則說明彈窗 ----------
function renderRules() {
  const box = document.getElementById("rule-content");
  const rules = (ev && ev.rules) || {};
  const budget = rules.startingBudget || AUCTION_DEFAULT_BUDGET;
  const waveInterval = rules.waveIntervalSec || AUCTION_DEFAULT_WAVE_INTERVAL_SEC;
  let html = `
    <p>報名時每人固定發放 <b style="color:var(--gold);">${budget}</b> 財神幣預算，不用打怪、不用對戰賺，大家起跑點完全一樣。</p>
    <p>主辦人按下「開始拍賣」後，系統會自動依排程開拍，大約每 ${waveInterval} 秒開新的一波，不用主辦人在旁邊一直操作，主辦人也可以下去跟大家一起搶標。</p>
    <p>拍賣採英式競標(價高者得):商品從底價起跳，大家即時喊價加碼，出價至少要比目前最高價高一個「最小加價單位」。倒數最後 ${AUCTION_ANTI_SNIPE_WINDOW_SEC} 秒內如果有人加價，倒數會重新計時到剩 ${AUCTION_ANTI_SNIPE_EXTEND_SEC} 秒，防止蹲點偷襲、最後一秒撿便宜。</p>
    <p>活動結束依「商品得分 + 剩餘財神幣折算分數」加總排行，剩餘財神幣 1 枚可以折算 ${AUCTION_COIN_TO_SCORE} 分，前五名套用活動設定的獎勵機制。</p>
    <p>商品全部拍賣完畢後，還會留 ${AUCTION_FINAL_CLOSE_DELAY_SEC / 60} 分鐘緩衝時間讓大家繼續打工、答任務、去幸運攤位下注，時間到系統會自動結算活動(主辦人也可以隨時提前手動結束)。</p>
  `;

  html += `<h4>${ui.icon("layers")} 商品分類</h4>`;
  html += `<p>${ui.tierTag("common")} 底價 50~150，分數最低。${ui.tierTag("rare")} 底價 300~500。${ui.tierTag("epic")} 底價 600~900。${ui.tierTag(
    "legendary"
  )} 底價 1000 以上，整場限量供應，分數最高。</p>`;
  html += `<p>${ui.tierTag("bundle")} 一次多件小東西綁在一起賣，分數比同價位單品略高一點，適合想快速湊分的人。</p>`;
  html += `<p>${ui.tierTag(
    "mystery"
  )} 神秘箱，底價固定，得標後現場開箱才知道多少分——大約 ${AUCTION_BOX_OUTCOMES.find((o) => o.tier === "bust").weight}% 機率是雷(只有 ${
    AUCTION_BOX_OUTCOMES.find((o) => o.tier === "bust").points
  } 分)，也有機會開出傳說大獎(${AUCTION_BOX_OUTCOMES.find((o) => o.tier === "legendary").points} 分)。</p>`;
  html += `<p>${ui.tierTag("special")} 不計分，而是給一個能影響拍賣本身的功能，整場限量供應各一張。</p>`;

  html += `<h4>${ui.icon("coins")} 途中賺財神幣</h4>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("hand-coins")} 打工賺財神幣</b><br/>每 ${AUCTION_WORK_COOLDOWN_SEC} 秒可以按一次，隨機拿到 ${AUCTION_WORK_MIN}~${AUCTION_WORK_MAX} 財神幣。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("puzzle")} 夜市任務</b><br/>拍賣過程中偶爾跳出問答／猜謎，答對現領財神幣，一題一人只能答一次。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("dice-5")} 幸運攤位</b><br/>花財神幣(${AUCTION_LUCKY_MIN_BET}~${AUCTION_LUCKY_MAX_BET})骰骰子猜大小，猜對雙倍拿回，猜錯拿回一半，每 ${AUCTION_LUCKY_COOLDOWN_SEC} 秒能下注一次。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("undo-2")} 參與退補</b><br/>某件商品你出過價、但最後沒標到，結標後會自動退還一小筆財神幣當參與獎勵。</p>`;

  html += `<h4>${ui.icon("ticket")} 特殊券效果</h4>`;
  AUCTION_SPECIAL_ITEMS.forEach((sp) => {
    html += `<p><b style="color:var(--red);">${ui.esc(sp.name)}</b><br/>${ui.esc(sp.effectDesc)}</p>`;
  });

  html += `<h4>${ui.icon("sparkles")} 更多玩法</h4>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("users")} 合夥競標</b><br/>拍賣進行中可以邀請另一位參加者合夥搶這一波，對方接受後，標到的話價錢跟分數兩人各分一半，適合朋友結伴來玩。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("target")} 猜價小遊戲</b><br/>每件商品拍賣中，大家都可以先猜「這件最後會標到多少錢」(一件只能猜一次，不用出價也能參加)，結標後猜中加 ${AUCTION_GUESS_BONUS_EXACT} 分、最接近的人加 ${AUCTION_GUESS_BONUS_CLOSE} 分(平手全部一起拿)。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("gift")} 隱藏驚喜商品</b><br/>整場會有 1~2 件商品不會出現在「商品預告」清單裡(連搶先情報券都看不到)，要等它自己開拍才知道，製造一點意外驚喜。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("flag")} 最後衝刺輪</b><br/>本場最後一波拍賣會特別標示出來，提醒大家把剩餘財神幣花光光——畢竟折算成分數只有一半效益。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("eye-off")} 暗標競標</b><br/>少數商品(標示「暗標競標」)是盲出價:大家同時默默出一個心中最高價，看不到別人出多少，時間到才一起揭曉，最高價得標、付的是自己出的價。截標前都可以修改自己的出價。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("zap")} 限時快閃攤</b><br/>偶爾會插進一件「⚡快閃搶購」商品，不用比價，固定折扣價、先搶先贏，上架後只有短短 ${AUCTION_FLASH_DURATION_SEC} 秒，手刀點下去才搶得到。</p>`;
  html += `<p><b style="color:var(--ink);">${ui.icon("trending-up")} 連標加成</b><br/>連續標到 ${AUCTION_WIN_STREAK_BONUS_START} 件以上商品(不含特殊券)，下一件標到的分數會多加 ${Math.round(
    AUCTION_WIN_STREAK_BONUS_RATIO * 100
  )}%，出過價卻沒標到會讓連續紀錄中斷歸零。</p>`;

  box.innerHTML = html;
}

function bindRuleModal() {
  document.getElementById("rule-fab-btn").innerHTML = ui.icon("book-open") + '<span class="fab-label">規則說明</span>';
  document.getElementById("rule-fab-btn").onclick = () => {
    renderRules();
    document.getElementById("rule-modal").classList.add("show");
  };
  document.getElementById("rule-close-btn").onclick = () => {
    document.getElementById("rule-modal").classList.remove("show");
  };
}

// ---------- 初始化 ----------
(async function init() {
  try {
    ev = await db.getEventSafe(eventId);
  } catch (e) {
    ev = null;
  }
  if (!ev) {
    await ui.alert("這場活動已經不存在了(可能已被主辦人刪除)，帶你回首頁。", { title: "找不到這場活動", tone: "danger" });
    location.href = "index.html";
    return;
  }
  if (ev.game_type !== "auction") {
    // 網址帶錯活動類型(例如手動改連結)，骰子/五手勢一律走 lobby.html
    location.href = ev.locked ? `lobby.html?event=${eventId}` : "index.html";
    return;
  }

  bindTierTabs();
  bindBackpackTabs();
  bindRuleModal();

  try {
    const session = await db.getSession();
    await handleAuthSession(session);
  } catch (e) {
    console.error(e);
  }
  db.onAuthChange((session) => handleAuthSession(session));

  await refreshAll();
  cooldownTickInterval = setInterval(tickCooldownDisplays, 1000);
  // 排程改成「分頁在前景就自己排」，不用再選隊長(見上面 tick() 註解說明原因)。
  scheduleNextTick();
  unsubLots = db.onTableChange("auction_lots", `event_id=eq.${eventId}`, () => scheduleRefresh());
  unsubParticipants = db.onTableChange("auction_participants", `event_id=eq.${eventId}`, () => scheduleRefresh());
  unsubTasks = db.onTableChange("auction_tasks", `event_id=eq.${eventId}`, () => scheduleRefresh());
})();

window.addEventListener("beforeunload", () => {
  db.cancelAllRequests();
  if (nextTickTimer) clearTimeout(nextTickTimer);
  if (cooldownTickInterval) clearInterval(cooldownTickInterval);
  if (refreshTimer) clearTimeout(refreshTimer);
  stopCountdown();
  stopTaskCountdown();
  if (unsubLots) unsubLots();
  if (unsubParticipants) unsubParticipants();
  if (unsubTasks) unsubTasks();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    // 切回前景:先補跑一次到期檢查(不用等下一個排定時間，切出去那段時間累積的到期項目立刻處理掉)，
    // 順便重新排程(分頁在背景時 scheduleNextTick 會直接跳過，回到前景要重新排一次)，
    // 也重抓一次最新資料以防背景時漏接了 realtime 事件。
    tick();
    scheduleNextTick();
    refreshAll();
  }
});
