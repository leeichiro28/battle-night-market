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
const GESTURE_ICON = { rock: "mountain", paper: "hand", scissors: "scissors", lizard: "bug", spock: "hand-metal", bomb: "bomb" };
const GESTURE_NAME = { rock: "石頭", paper: "布", scissors: "剪刀", lizard: "蜥蜴", spock: "史波克", bomb: "炸彈" };
const GESTURE_ORDER = ["rock", "paper", "scissors", "lizard", "spock"];

// 專屬戰報敘述:每種對決組合都有獨立描述文字,取代死板的「X勝過Y」
const FLAVOR = {
  rock: { scissors: "🪨 巨石狠狠壓扁了剪刀的刀刃!", lizard: "🪨 石塊精準砸中了蜥蜴的頭!" },
  paper: { rock: "📄 一張紙悄悄把石頭整個包住!", spock: "📄 報紙蓋住了史波克的臉,判定失格!" },
  scissors: { paper: "✂️ 剪刀俐落地剪碎了那張紙!", lizard: "✂️ 剪刀喀嚓一聲剪斷了蜥蜴的頭!" },
  lizard: { spock: "🦎 蜥蜴一口毒倒了史波克!", paper: "🦎 蜥蜴悄悄咬爛了那張紙!" },
  spock: { scissors: "🖖 史波克伸手捏碎了剪刀!", rock: "🖖 史波克用雷射把石頭蒸發了!" },
};

const FIELD_MODS_RPS = ["rock_boost", "ult_twice", "fast_timer"];
const FIELD_MOD_LABEL = {
  rock_boost: { icon: "mountain", text: "磐石戰場:石頭獲勝時傷害額外 +1" },
  ult_twice: { icon: "zap", text: "手速戰場:究極手勢這局可以用 2 次" },
  fast_timer: { icon: "wind", text: "疾風戰場:思考時間縮短到 20 秒" },
};

// 簡單的字串雜湊(FNV-1a),用來讓雙方client不用另外同步狀態,
// 也能各自算出同一個「這回合有沒有炸彈」「這局場地規則是什麼」的結果。
function hashStr(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rulesEnabled(key) {
  return !!(event && event.rules && event.rules[key]);
}

// 隱藏第六手勢:炸彈。第3回合起,約15%機率該回合額外開放
function bombAvailable(state) {
  if (!rulesEnabled("bomb")) return false;
  if ((state.round || 1) < 3) return false;
  const h = hashStr(`${matchId}|${state.game || 1}|${state.round}|bomb`);
  return h % 100 < 15;
}

// 場地規則:同一局內固定,開局隨機決定,3選1
function getFieldMod(state) {
  if (!rulesEnabled("field_mod")) return null;
  const h = hashStr(`${matchId}|${state.game || 1}|field`);
  return FIELD_MODS_RPS[h % FIELD_MODS_RPS.length];
}

let match = null;
let event = null;
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

// BO5:先取得3局勝利才算整場對戰結束,不是單局血量歸零就結束
function seriesDecided(state) {
  return (state.games1 || 0) >= 3 || (state.games2 || 0) >= 3;
}

function startTimer(state) {
  if (!mySlot) return;
  const roundKey = state.round + "-" + mySlot;
  if (currentRoundKey === roundKey) return;
  currentRoundKey = roundKey;
  clearInterval(timerInterval);
  if (submittedThisRound || seriesDecided(state)) return;

  let timeLeft = getFieldMod(state) === "fast_timer" ? 20000 : 30000;
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
  battleView.update(match, event, mySlot);
  lastSeenRound = state.round;

  if (roundChanged && mySlot && !submittedThisRound) {
    setTimeout(() => {
      if (!submittedThisRound) battleView.announce("輪到你了!", { icon: "swords" });
    }, 1600);
  }

  const statusEl = document.getElementById("game-status");
  const ultBtn = document.getElementById("ult-btn");

  renderSeriesDots(state);
  renderFieldModBanner(state);

  if (seriesDecided(state)) {
    document.getElementById("choice-row").style.display = "none";
    ultBtn.style.display = "none";
    document.getElementById("timer-fill").style.width = "0%";
    const winnerIsP1 = (state.games1 || 0) >= 3;
    const winnerName = winnerIsP1 ? p1Name : p2Name;
    const score = `${state.games1 || 0}:${state.games2 || 0}`;
    if (state.forfeitReason === "both_afk") {
      battleView.announce("雙方掛機,已自動棄權", { icon: "alert-triangle", holdMs: 4200 });
      statusEl.innerHTML = ui.icon("alert-triangle") + `雙方都太久沒有進場,系統自動判定 ${ui.esc(winnerName)} 晉級`;
    } else if (!mySlot) {
      statusEl.innerHTML = ui.icon("trophy") + `${ui.esc(winnerName)} 以 ${score} 拿下這場系列賽!`;
    } else {
      const iWon = (mySlot === 1 && winnerIsP1) || (mySlot === 2 && !winnerIsP1);
      statusEl.innerHTML = iWon
        ? ui.icon("trophy") + `你以 ${score} 贏了這場系列賽!回等候室看看下一步`
        : ui.icon("skull") + `你以 ${score} 落敗了,感謝參戰!`;
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

  renderAndBindChoiceButtons(state);
  document.getElementById("choice-row").style.display = "grid";
  const fieldMod = getFieldMod(state);
  const maxUlt = fieldMod === "ult_twice" ? 2 : 1;
  const myUltCount = (mySlot === 1 ? state.ult1 : state.ult2) || 0;
  const myUltUsed = myUltCount >= maxUlt;
  const ultLeft = maxUlt - myUltCount;
  ultBtn.style.display = "flex";
  ultBtn.innerHTML =
    ui.icon("zap") +
    (myUltUsed
      ? "究極手勢已用完"
      : useUlt
      ? `究極手勢:已啟動(選一個手勢送出即可保證獲勝,本局還可用 ${ultLeft} 次)`
      : `使出究極手勢(本局還可用 ${ultLeft} 次,保證獲勝該回合)`);
  ultBtn.classList.toggle("active-choice", useUlt && !myUltUsed);
  ultBtn.disabled = !!myUltUsed || submittedThisRound;

  document.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = submittedThisRound));
  statusEl.innerHTML = submittedThisRound
    ? ui.icon("hourglass") + "已送出,等待對方..."
    : ui.icon("timer") + "30 秒內選一個手勢!";
  startTimer(state);
}

function renderSeriesDots(state) {
  const box = document.getElementById("series-dots");
  if (!box) return;
  const [p1Name, p2Name] = names();
  const dots = (n) =>
    Array.from({ length: 3 }, (_, i) => `<span class="sd-dot${i < n ? " won" : ""}"></span>`).join("");
  box.innerHTML = `
    <span class="sd-label">${ui.esc(p1Name)}</span>
    <span class="sd-side">${dots(state.games1 || 0)}</span>
    <span class="sd-label">第${state.game || 1}局 · BO5</span>
    <span class="sd-side">${dots(state.games2 || 0)}</span>
    <span class="sd-label">${ui.esc(p2Name)}</span>
  `;
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
    let ult1 = state.ult1 || 0;
    let ult2 = state.ult2 || 0;
    const log = state.log ? [...state.log] : [];
    const m1 = state.m1;
    const m2 = state.m2;
    let lastEvent = null;
    const fieldMod = getFieldMod(state);

    if (m1.ult) ult1 += 1;
    if (m2.ult) ult2 += 1;

    let winnerSlot = null;
    let winGesture = null;
    const g1 = m1.gesture ? GESTURE_NAME[m1.gesture] : "逾時未出招";
    const g2 = m2.gesture ? GESTURE_NAME[m2.gesture] : "逾時未出招";
    let entry = `第${state.round}回合:${p1Name} 出了 ${g1},${p2Name} 出了 ${g2}。`;

    if (!m1.gesture && !m2.gesture) {
      entry += "雙方都逾時,平手,不掉血。";
      lastEvent = { type: "timeout_both" };
    } else if (!m1.gesture) {
      winnerSlot = 2;
      winGesture = m2.gesture;
      entry += `${p1Name}逾時未出招,${p2Name}直接獲勝。`;
    } else if (!m2.gesture) {
      winnerSlot = 1;
      winGesture = m1.gesture;
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
    } else if (m1.gesture === "bomb" && m2.gesture === "bomb") {
      entry += "💣💣 雙方都拿出炸彈,同歸於盡,平手不掉血。";
      lastEvent = { type: "tie" };
    } else if (m1.gesture === "bomb" || m2.gesture === "bomb") {
      const bomberSlot = m1.gesture === "bomb" ? 1 : 2;
      const otherGesture = bomberSlot === 1 ? m2.gesture : m1.gesture;
      const bomberName = bomberSlot === 1 ? p1Name : p2Name;
      if (otherGesture === "spock") {
        entry += "🖖 史波克冷靜拆彈,邏輯完勝,平手不掉血。";
        lastEvent = { type: "tie" };
      } else if (otherGesture === "paper" || otherGesture === "lizard") {
        winnerSlot = bomberSlot === 1 ? 2 : 1;
        winGesture = otherGesture;
        entry += `${GESTURE_NAME[otherGesture]}悶熄了${bomberName}的引信,炸彈失效,${winnerSlot === 1 ? p1Name : p2Name}獲勝。`;
      } else {
        winnerSlot = bomberSlot;
        winGesture = "bomb";
        entry += `💥 轟隆一聲,${bomberName}的炸彈炸爛了${GESTURE_NAME[otherGesture]},${bomberName}獲勝。`;
      }
    } else if (m1.gesture === m2.gesture) {
      entry += "出了相同的手勢,平手。";
      lastEvent = { type: "tie" };
    } else if (BEATS[m1.gesture].includes(m2.gesture)) {
      winnerSlot = 1;
      winGesture = m1.gesture;
      entry += `${FLAVOR[m1.gesture][m2.gesture]}${p1Name}獲勝。`;
    } else {
      winnerSlot = 2;
      winGesture = m2.gesture;
      entry += `${FLAVOR[m2.gesture][m1.gesture]}${p2Name}獲勝。`;
    }

    if (winnerSlot) {
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      const loserName = winnerSlot === 1 ? p2Name : p1Name;
      const winnerHp = winnerSlot === 1 ? hp1 : hp2;
      // HP 上限是 30,低血雙倍傷害的門檻等比例拉高到 9(原本 10 點血制是「≤3」,約剩三成血)
      let dmg = winnerHp <= 9 ? 2 : 1;
      // 場地規則「磐石戰場」:靠石頭贏的那一擊,傷害再 +1
      if (fieldMod === "rock_boost" && winGesture === "rock") dmg += 1;
      const hpBefore = winnerSlot === 1 ? hp2 : hp1;
      if (winnerSlot === 1) hp2 -= dmg;
      else hp1 -= dmg;
      const hpAfter = winnerSlot === 1 ? hp2 : hp1;
      entry += `${loserName}扣 ${dmg} 血${winnerHp <= 9 ? "(絕境反擊,傷害雙倍!)" : ""}(${hpBefore}→${Math.max(hpAfter, 0)})。`;
      lastEvent = { type: "hit", winnerSlot, loserSlot: winnerSlot === 1 ? 2 : 1, dmg };
    }
    log.push(entry);

    const gameOver = hp1 <= 0 || hp2 <= 0;

    if (!gameOver) {
      // 這局還沒分出勝負,正常進下一回合
      const newState = { ...state, hp1, hp2, ult1, ult2, log, lastEvent, round: state.round + 1, m1: null, m2: null };
      await db.updateMatchState(matchId, { state: newState });
    } else {
      // BO5:這局分出勝負了,但要先取得3局勝利才是整場對戰結束
      const gameWinnerSlot = hp1 <= 0 ? 2 : 1;
      const games1 = (state.games1 || 0) + (gameWinnerSlot === 1 ? 1 : 0);
      const games2 = (state.games2 || 0) + (gameWinnerSlot === 2 ? 1 : 0);
      const gameNum = state.game || 1;
      const gameWinnerName = gameWinnerSlot === 1 ? p1Name : p2Name;
      log.push(`🏆 第${gameNum}局結束,${gameWinnerName}拿下這局!系列賽比分 ${games1}:${games2}。`);

      const seriesOver = games1 >= 3 || games2 >= 3;
      const seriesEvent = { type: "series_game_over", winnerSlot: gameWinnerSlot, gameNum, games1, games2 };

      if (seriesOver) {
        const newState = { ...state, hp1, hp2, ult1, ult2, log, lastEvent: seriesEvent, round: state.round + 1, games1, games2, m1: null, m2: null };
        await db.updateMatchState(matchId, { state: newState });

        const finalWinnerSlot = games1 >= 3 ? 1 : 2;
        const winnerId = finalWinnerSlot === 1 ? match.player1_id : match.player2_id;
        const loserId = finalWinnerSlot === 1 ? match.player2_id : match.player1_id;
        await db.advanceAfterMatch(match, winnerId, loserId);
      } else {
        if (games1 === 2 && games2 === 2) log.push("🔥 賽末點!下一局就會分出整場對戰的勝負。");
        // 系列賽還沒結束,血量全部回滿,開下一局
        const newState = {
          ...state,
          hp1: 30,
          hp2: 30,
          ult1: 0,
          ult2: 0,
          log,
          lastEvent: seriesEvent,
          round: 1,
          game: gameNum + 1,
          games1,
          games2,
          m1: null,
          m2: null,
        };
        await db.updateMatchState(matchId, { state: newState });
      }
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
  if (!seriesDecided(state)) return;
  const winnerId = (state.games1 || 0) >= 3 ? match.player1_id : match.player2_id;
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
  if (!state || seriesDecided(state)) return;
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

function renderFieldModBanner(state) {
  const box = document.getElementById("field-mod-banner");
  if (!box) return;
  const mod = getFieldMod(state);
  const meta = mod && FIELD_MOD_LABEL[mod];
  if (!meta) {
    box.style.display = "none";
    return;
  }
  box.style.display = "flex";
  box.innerHTML = ui.icon(meta.icon) + `<span>本局場地規則:${meta.text}</span>`;
}

// 手勢按鈕每次 render 都重建:因為「炸彈這回合有沒有開放」是每回合可能變的
function renderAndBindChoiceButtons(state) {
  const gestures = GESTURE_ORDER.slice();
  if (bombAvailable(state)) gestures.push("bomb");
  document.getElementById("choice-row").innerHTML = gestures
    .map(
      (g) =>
        `<button class="choice-btn g-${g}${g === "bomb" ? " bomb" : ""}" data-g="${g}">${ui.icon(
          GESTURE_ICON[g]
        )}<span class="lbl">${GESTURE_NAME[g]}</span></button>`
    )
    .join("");
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

function bindControls() {
  document.getElementById("ult-btn").innerHTML = ui.icon("zap") + "使出究極手勢(保證獲勝該回合)";
  document.getElementById("ult-btn").onclick = () => {
    useUlt = !useUlt;
    if (useUlt) battleView.announce("你準備使出究極手勢!", { icon: "zap" });
    refresh();
  };
}

function renderRules() {
  const box = document.getElementById("rule-content");
  box.innerHTML = `
    <p>採 BO5 賽制:雙方各有 30 點 HP,先讓對方 HP 歸零的人拿下這一局;率先拿下 3 局的人贏得整場對戰(最多打到第 5 局)。每進入新一局,雙方 HP 會全部回滿。</p>
    <p>每回合 30 秒內選一個手勢:石頭 / 布 / 剪刀 / 蜥蜴 / 史波克。超時未選視為該回合落敗。</p>
    <p>石頭勝剪刀、蜥蜴;布勝石頭、史波克;剪刀勝布、蜥蜴;蜥蜴勝史波克、布;史波克勝剪刀、石頭。</p>
    <p>每人每一局都有 1 張「究極手勢」卡:出牌保證獲勝該回合,除非對方同一回合也出究極手勢,此時雙方抵銷、判定平手。</p>
    <p>當你的 HP ≤9 時,獲勝的那一擊傷害會翻倍,適合絕地反擊。系列賽打到 2:2 時會有「賽末點」提示。</p>
    <p>若主辦人開啟進階規則:第3回合起可能會隨機開放隱藏手勢「炸彈」(剋制石頭、剪刀;怕布、蜥蜴;對上史波克是平手);也可能開局隨機決定一項場地規則(石頭傷害加成 / 究極手勢可用2次 / 思考時間縮短到20秒)。</p>
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
  event = await db.getEventSafe(eventId);
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
