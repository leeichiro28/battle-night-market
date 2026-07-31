const qs = new URLSearchParams(location.search);
const matchId = qs.get("match");
const eventId = qs.get("event");

const BEATS = {
  rock: ["scissors", "lizard"],
  paper: ["rock", "spock"],
  scissors: ["paper", "lizard"],
  lizard: ["spock", "paper"],
  spock: ["scissors", "rock"],
};
// 手勢圖示一律用 lucide,不用 emoji
const GESTURE_ICON = { rock: "mountain", paper: "hand", scissors: "scissors", lizard: "bug", spock: "hand-metal" };
const GESTURE_NAME = { rock: "石頭", paper: "布", scissors: "剪刀", lizard: "蜥蜴", spock: "史波克" };
const GESTURE_ORDER = ["rock", "paper", "scissors", "lizard", "spock"];

let match = null;
let mySlot = null;
let submittedThisRound = false;
let useUlt = false;
let resolving = false;
let unsub = null;
let unsubParticipants = null;
let timerInterval = null;
let currentRoundKey = null;
let lastSeenRound = null;
let autoFollowTriggered = false;
let enteredMarked = false;
let autopilotSlot = null; // 對手超過1分鐘沒入場時,代替他自動出招的slot
let autopilotAnnounced = false;
let entryWatchdog = null;
let goneAway = false;
let battleView = null;

const ENTRY_TIMEOUT_MS = 60000; // 超過1分鐘對手沒入場,自動開始幫他出招

function names() {
  return [match.p1?.name || "玩家一", match.p2?.name || "玩家二"];
}

function startTimer(state) {
  if (!mySlot) return;
  const roundKey = state.round + "-" + mySlot;
  if (currentRoundKey === roundKey) return;
  currentRoundKey = roundKey;
  clearInterval(timerInterval);
  if (submittedThisRound || state.hp1 <= 0 || state.hp2 <= 0) return;

  let timeLeft = 30000;
  const fill = document.getElementById("timer-fill");
  const started = Date.now();
  timerInterval = setInterval(async () => {
    const elapsed = Date.now() - started;
    const pct = Math.max(0, 100 - (elapsed / timeLeft) * 100);
    fill.style.width = pct + "%";
    if (elapsed >= timeLeft) {
      clearInterval(timerInterval);
      if (!submittedThisRound) {
        submittedThisRound = true;
        battleView.announce("思考時間到,判定逾時...", { icon: "hourglass" });
        await db.submitMove(matchId, mySlot, { gesture: null, ult: false, timeout: true });
      }
    }
  }, 60);
}

function render(state) {
  const [p1Name, p2Name] = names();
  const roundChanged = lastSeenRound !== null && state.round !== lastSeenRound;
  battleView.update(match, null, mySlot);
  lastSeenRound = state.round;

  if (roundChanged && mySlot && !submittedThisRound) {
    setTimeout(() => {
      if (!submittedThisRound) battleView.announce("輪到你了!", { icon: "swords" });
    }, 1600);
  }

  const statusEl = document.getElementById("game-status");
  const choiceBtns = document.querySelectorAll(".choice-btn");
  const ultBtn = document.getElementById("ult-btn");

  if (state.hp1 <= 0 || state.hp2 <= 0) {
    document.getElementById("choice-row").style.display = "none";
    ultBtn.style.display = "none";
    document.getElementById("timer-fill").style.width = "0%";
    const winnerName = state.hp1 <= 0 ? p2Name : p1Name;
    if (state.forfeitReason === "both_afk") {
      announce("雙方掛機,已自動棄權", { icon: "alert-triangle", holdMs: 4200 });
      statusEl.innerHTML = ui.icon("alert-triangle") + `雙方都太久沒有進場,系統自動判定 ${ui.esc(winnerName)} 晉級`;
    } else if (!mySlot) {
      statusEl.innerHTML = ui.icon("trophy") + `${ui.esc(winnerName)} 獲勝了這場對戰!`;
    } else {
      const iWon = (mySlot === 1 && state.hp2 <= 0) || (mySlot === 2 && state.hp1 <= 0);
      statusEl.innerHTML = iWon
        ? ui.icon("trophy") + "你贏了這場對戰!回等候室看看下一步"
        : ui.icon("skull") + "你被擊敗了,感謝參戰!";
    }
    document.getElementById("back-link").style.display = "block";
    document.getElementById("back-link").innerHTML = `<a href="lobby.html?event=${eventId}">${ui.icon(
      "arrow-left"
    )}回等候室查看賽況</a>`;
    scheduleReturnToLobby();
    return;
  }

  if (!mySlot) {
    document.getElementById("choice-row").style.display = "none";
    ultBtn.style.display = "none";
    document.getElementById("timer-fill").style.width = "0%";
    statusEl.innerHTML = ui.icon("eye") + "觀戰模式・對戰進行中";
    return;
  }

  document.getElementById("choice-row").style.display = "grid";
  const myUltUsed = mySlot === 1 ? state.ult1 : state.ult2;
  ultBtn.style.display = "flex";
  ultBtn.innerHTML =
    ui.icon("zap") +
    (myUltUsed
      ? "究極手勢已使用"
      : useUlt
      ? "究極手勢:已啟動(選一個手勢送出即可保證獲勝)"
      : "使出究極手勢(尚未使用,保證獲勝該回合)");
  ultBtn.classList.toggle("active-choice", useUlt && !myUltUsed);
  ultBtn.disabled = !!myUltUsed || submittedThisRound;

  choiceBtns.forEach((b) => (b.disabled = submittedThisRound));
  statusEl.innerHTML = submittedThisRound
    ? ui.icon("hourglass") + "已送出,等待對方..."
    : ui.icon("timer") + "30 秒內選一個手勢!";
  startTimer(state);
}

async function resolveRoundIfReady(state) {
  const iAmResolver = mySlot === 1 || (mySlot === 2 && autopilotSlot === 1);
  if (!iAmResolver || resolving) return;
  if (!state.m1 || !state.m2) return;
  resolving = true;
  try {
    const [p1Name, p2Name] = names();
    let hp1 = state.hp1;
    let hp2 = state.hp2;
    let ult1 = state.ult1;
    let ult2 = state.ult2;
    const log = state.log ? [...state.log] : [];
    const m1 = state.m1;
    const m2 = state.m2;
    let lastEvent = null;

    if (m1.ult) ult1 = true;
    if (m2.ult) ult2 = true;

    let winnerSlot = null;
    const g1 = m1.gesture ? GESTURE_NAME[m1.gesture] : "逾時未出招";
    const g2 = m2.gesture ? GESTURE_NAME[m2.gesture] : "逾時未出招";
    let entry = `第${state.round}回合:${p1Name} 出了 ${g1},${p2Name} 出了 ${g2}。`;

    if (!m1.gesture && !m2.gesture) {
      entry += "雙方都逾時,平手,不掉血。";
      lastEvent = { type: "timeout_both" };
    } else if (!m1.gesture) {
      winnerSlot = 2;
      entry += `${p1Name}逾時未出招,${p2Name}直接獲勝。`;
    } else if (!m2.gesture) {
      winnerSlot = 1;
      entry += `${p2Name}逾時未出招,${p1Name}直接獲勝。`;
    } else if (m1.ult && m2.ult) {
      entry += "雙方都使出究極手勢,強強相抵,平手。";
      lastEvent = { type: "tie" };
    } else if (m1.ult) {
      winnerSlot = 1;
      entry += `${p1Name}使出究極手勢,直接獲勝!`;
    } else if (m2.ult) {
      winnerSlot = 2;
      entry += `${p2Name}使出究極手勢,直接獲勝!`;
    } else if (m1.gesture === m2.gesture) {
      entry += "出了相同的手勢,平手。";
      lastEvent = { type: "tie" };
    } else if (BEATS[m1.gesture].includes(m2.gesture)) {
      winnerSlot = 1;
      entry += `${GESTURE_NAME[m1.gesture]}勝過${GESTURE_NAME[m2.gesture]},${p1Name}獲勝。`;
    } else {
      winnerSlot = 2;
      entry += `${GESTURE_NAME[m2.gesture]}勝過${GESTURE_NAME[m1.gesture]},${p2Name}獲勝。`;
    }

    if (winnerSlot) {
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      const loserName = winnerSlot === 1 ? p2Name : p1Name;
      const winnerHp = winnerSlot === 1 ? hp1 : hp2;
      const dmg = winnerHp <= 3 ? 2 : 1;
      const hpBefore = winnerSlot === 1 ? hp2 : hp1;
      if (winnerSlot === 1) hp2 -= dmg;
      else hp1 -= dmg;
      const hpAfter = winnerSlot === 1 ? hp2 : hp1;
      entry += `${loserName}扣 ${dmg} 血${winnerHp <= 3 ? "(絕境反擊,傷害雙倍!)" : ""}(${hpBefore}→${Math.max(hpAfter, 0)})。`;
      lastEvent = { type: "hit", winnerSlot, loserSlot: winnerSlot === 1 ? 2 : 1, dmg };
    }
    log.push(entry);

    const newState = {
      ...state,
      hp1,
      hp2,
      ult1,
      ult2,
      log,
      lastEvent,
      round: state.round + 1,
      m1: null,
      m2: null,
    };
    await db.updateMatchState(matchId, { state: newState });

    if (hp1 <= 0 || hp2 <= 0) {
      const finalWinnerSlot = hp1 <= 0 ? 2 : 1;
      const winnerId = finalWinnerSlot === 1 ? match.player1_id : match.player2_id;
      const loserId = finalWinnerSlot === 1 ? match.player2_id : match.player1_id;
      await db.advanceAfterMatch(match, winnerId, loserId);
    }
  } finally {
    resolving = false;
  }
}

// 對戰結束後,不管你是剛贏的選手還是純觀戰,自動帶你去看贏家的下一場,不用手動點觀戰
let returnScheduled = false;
function scheduleReturnToLobby() {
  if (returnScheduled) return;
  returnScheduled = true;
  setTimeout(() => {
    if (!autoFollowTriggered) {
      location.href = `lobby.html?event=${eventId}`;
    }
  }, 4500);
}

async function maybeAutoAdvance(state) {
  if (autoFollowTriggered) return;
  if (!(state.hp1 <= 0 || state.hp2 <= 0)) return;
  const winnerId = state.hp1 <= 0 ? match.player2_id : match.player1_id;
  if (!winnerId) return;
  try {
    const winnerPart = await db.getMyParticipant(eventId, winnerId);
    if (winnerPart && winnerPart.status === "matched" && winnerPart.match_id && winnerPart.match_id !== matchId) {
      autoFollowTriggered = true;
      const hint = document.getElementById("game-status");
      if (hint) {
        hint.innerHTML = mySlot
          ? ui.icon("trophy") + "你贏了!正在前往下一場..."
          : ui.icon("eye") + "這場結束了,正在前往下一場...";
      }
      setTimeout(() => {
        location.href = `rps5.html?match=${winnerPart.match_id}&event=${eventId}`;
      }, 2500);
    }
  } catch (e) {}
}

// 我自己一進到這個對戰畫面,超過1分鐘對手還沒入場的話,就由我這邊自動幫對手出招,讓對戰照樣打下去
// 對手之後如果自己進場了,會偵測到並把控制權交還給他自己
async function checkEntryTimeout() {
  if (!mySlot || !match) return;
  if (match.status !== "active" || !match.activated_at) return;
  const meEntered = mySlot === 1 ? match.p1_entered_at : match.p2_entered_at;
  if (!meEntered) return;
  const oppSlot = mySlot === 1 ? 2 : 1;
  const oppEntered = mySlot === 1 ? match.p2_entered_at : match.p1_entered_at;
  if (oppEntered) {
    if (autopilotSlot === oppSlot) autopilotSlot = null; // 對手自己進場了,交還控制權
    return;
  }
  if (autopilotSlot === oppSlot) return; // 已經在幫他代打了
  const elapsed = Date.now() - new Date(match.activated_at).getTime();
  if (elapsed < ENTRY_TIMEOUT_MS) return;
  autopilotSlot = oppSlot;
  if (!autopilotAnnounced) {
    autopilotAnnounced = true;
    const oppName = oppSlot === 1 ? match.p1?.name : match.p2?.name;
    db
      .appendMatchLog(matchId, `${oppName || "對手"} 超過1分鐘沒有進入對戰畫面,系統開始自動幫他出招(逾時判定,不會使用究極手勢),他隨時進場都能接手。`)
      .catch(() => {});
  }
}

// 代打:輪到被代打的那位時,幫他判定逾時(等同沒出手勢,直接輸掉該局)
async function maybeAutopilotSubmit() {
  if (!autopilotSlot || !match) return;
  if (match.status !== "active") return;
  const state = match.state;
  if (!state || state.hp1 <= 0 || state.hp2 <= 0) return;
  const already = autopilotSlot === 1 ? state.m1 : state.m2;
  if (already) return;
  try {
    await db.submitMove(matchId, autopilotSlot, { gesture: null, ult: false, timeout: true });
  } catch (e) {}
}

async function refresh() {
  const m = await db.getMatchSafe(matchId);
  if (!m) {
    if (!goneAway) {
      goneAway = true;
      await ui.alert("這場對戰已經不存在了(活動可能已被刪除),帶你回首頁。", {
        title: "找不到這場對戰",
        tone: "danger",
      });
      location.href = "index.html";
    }
    return;
  }
  match = m;
  const local = db.getLocalPlayer();
  mySlot = match.player1_id === local.id ? 1 : match.player2_id === local.id ? 2 : null;
  if (mySlot && !enteredMarked) {
    enteredMarked = true;
    db.markEntered(matchId, mySlot).catch(() => {});
  }
  const state = match.state;
  const wasSubmitted = submittedThisRound;
  submittedThisRound = mySlot ? !!(mySlot === 1 ? state.m1 : state.m2) : false;
  if (!submittedThisRound && wasSubmitted !== submittedThisRound) {
    useUlt = false;
  }
  render(state);
  resolveRoundIfReady(state);
  maybeAutoAdvance(state);
  maybeAutopilotSubmit();
}

function renderChoiceButtons() {
  document.getElementById("choice-row").innerHTML = GESTURE_ORDER.map(
    (g) => `<button class="choice-btn" data-g="${g}">${ui.icon(GESTURE_ICON[g])}<span class="lbl">${GESTURE_NAME[g]}</span></button>`
  ).join("");
}

function bindControls() {
  renderChoiceButtons();
  document.getElementById("ult-btn").innerHTML = ui.icon("zap") + "使出究極手勢(尚未使用,保證獲勝該回合)";
  document.getElementById("ult-btn").onclick = () => {
    useUlt = !useUlt;
    if (useUlt) battleView.announce("你準備使出究極手勢!", { icon: "zap" });
    refresh();
  };
  document.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (submittedThisRound) return;
      submittedThisRound = true;
      clearInterval(timerInterval);
      const gesture = btn.dataset.g;
      battleView.announce(`你使出了${GESTURE_NAME[gesture]}!`, { icon: GESTURE_ICON[gesture] });
      await db.submitMove(matchId, mySlot, { gesture, ult: useUlt, timeout: false });
      useUlt = false;
    };
  });
}

function renderRules() {
  const box = document.getElementById("rule-content");
  box.innerHTML = `
    <p>雙方各有 10 點 HP,30 秒內選一個手勢:石頭 / 布 / 剪刀 / 蜥蜴 / 史波克。超時未選視為該局落敗。</p>
    <p>石頭勝剪刀、蜥蜴;布勝石頭、史波克;剪刀勝布、蜥蜴;蜥蜴勝史波克、布;史波克勝剪刀、石頭。</p>
    <p>每人有 1 張「究極手勢」卡:出牌保證獲勝該局,除非對方同一局也出究極手勢,此時雙方抵銷、判定平手。</p>
    <p>當你的 HP ≤3 時,獲勝的那一擊傷害會翻倍,適合絕地反擊。血量先歸零者落敗。</p>
  `;
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

(async function init() {
  if (!matchId || !eventId) {
    location.href = "index.html";
    return;
  }
  document.getElementById("page-eyebrow").innerHTML = ui.icon("scissors") + "五手勢對戰";
  battleView = BattleView.mount(document.getElementById("battle-stage"), null, {
    gameType: "rps5",
    matchId,
    watch: false, // 五手勢目前沒有下注/表情功能
    showStatus: false, // 這頁自己的 #game-status 已經處理狀態文字,不要顯示兩份
  });
  bindControls();
  bindRuleModal();
  await refresh();
  unsub = db.onTableChange("matches", `id=eq.${matchId}`, () => refresh());
  unsubParticipants = db.onTableChange("event_participants", `event_id=eq.${eventId}`, () => refresh());
  entryWatchdog = setInterval(() => {
    checkEntryTimeout();
    maybeAutopilotSubmit();
  }, 5000);
})();

window.addEventListener("beforeunload", () => {
  if (unsub) unsub();
  if (unsubParticipants) unsubParticipants();
  if (battleView) battleView.destroy();
  if (entryWatchdog) clearInterval(entryWatchdog);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});
