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
  rock: { scissors: "巨石狠狠壓扁了剪刀的刀刃!", lizard: "石塊精準砸中了蜥蜴的頭!" },
  paper: { rock: "一張紙悄悄把石頭整個包住!", spock: "報紙蓋住了史波克的臉,判定失格!" },
  scissors: { paper: "剪刀俐落地剪碎了那張紙!", lizard: "剪刀喀嚓一聲剪斷了蜥蜴的頭!" },
  lizard: { spock: "蜥蜴一口毒倒了史波克!", paper: "蜥蜴悄悄咬爛了那張紙!" },
  spock: { scissors: "史波克伸手捏碎了剪刀!", rock: "史波克用雷射把石頭蒸發了!" },
};

const FIELD_MODS_RPS = ["rock_boost", "ult_twice", "fast_timer"];
const FIELD_MOD_LABEL = {
  rock_boost: { icon: "mountain", text: "磐石戰場:石頭獲勝時傷害額外 +1" },
  ult_twice: { icon: "zap", text: "手速戰場:究極手勢這局可以用 2 次" },
  fast_timer: { icon: "wind", text: "疾風戰場:思考時間縮短到 20 秒" },
};

// 道具符(進階規則):每 3 回合各自隨機拿到一個,持有到觸發時機才消耗
const ITEM_LABEL = {
  shield: { icon: "shield", text: "護盾符" },
  amp: { icon: "zap", text: "增幅符" },
  detect: { icon: "eye", text: "偵測符" },
};
const ITEM_TYPES = ["shield", "amp", "detect"];

// 出招姿態宣告(假動作用):跟骰子對戰共用 stance 這個規則鍵,但五手勢版本純粹是心理戰情報,不直接影響傷害
const STANCE_LABEL = { attack: { icon: "sword", text: "偏攻擊" }, defense: { icon: "shield", text: "偏防禦" } };

const MOMENTUM_STREAK_BONUS = 2; // 連勝達到這個局數起,下一擊額外 +1 傷害
const MOMENTUM_COMEBACK = 2; // 連敗達到這個局數,靠這次獲勝翻身時傷害直接翻倍
const COMBO_STREAK_TRIGGER = 3; // 連續用同一手勢獲勝達到這個局數起,額外 +2 傷害
const MUTATE_AFTER = 3; // 連續出同一手勢達到這個回合數,下一回合系統會把那個手勢從選項中拿掉
const DUAL_HAND_HP_THRESHOLD = 15; // HP制下,HP≤這個門檻才能使用雙手符(30血制,原案10血制的≤5等比例放大3倍)

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

// 兩個手勢單獨對決的結果,炸彈/平手都在這裡處理,雙手出招會拿這個函式去跑好幾組配對
// 回傳 { result:"A"|"B"|"tie", winGesture, ...炸彈相關旗標 }
function judgeGesturePair(a, b) {
  if (a === b) return { result: "tie" };
  if (a === "bomb" || b === "bomb") {
    const bomberIsA = a === "bomb";
    const other = bomberIsA ? b : a;
    if (other === "spock") return { result: "tie", bombDefused: true };
    if (other === "paper" || other === "lizard") {
      return { result: bomberIsA ? "B" : "A", winGesture: other, bombFizzled: true, bomberGesture: "bomb" };
    }
    return { result: bomberIsA ? "A" : "B", winGesture: "bomb", bombExploded: true, loserGesture: other };
  }
  if (BEATS[a].includes(b)) return { result: "A", winGesture: a };
  return { result: "B", winGesture: b };
}

// 炸彈相關對決的敘述文字(一般手勢對決不會走到這裡,直接用 FLAVOR 對照表拼字串就好)
function flavorFor(pair, winnerName) {
  if (pair.bombDefused) return "史波克冷靜拆彈,邏輯完勝,平手不掉血。";
  if (pair.bombFizzled) return `${GESTURE_NAME[pair.winGesture]}悶熄了炸彈的引信,炸彈失效,${winnerName}獲勝。`;
  if (pair.bombExploded) return `轟隆一聲,${winnerName}的炸彈炸爛了${GESTURE_NAME[pair.loserGesture]},${winnerName}獲勝。`;
  return "";
}

// 判斷整回合的結果(排除逾時/究極手勢,那兩種在呼叫端就先短路處理掉了)
// 支援雙手出招:m1/m2 各自可能有 1~2 個候選手勢,任一個候選贏過對方任一候選就算贏
function judgeRound(m1, m2) {
  const listA = m1.dual && m1.gesture2 ? [m1.gesture, m1.gesture2] : [m1.gesture];
  const listB = m2.dual && m2.gesture2 ? [m2.gesture, m2.gesture2] : [m2.gesture];
  let bestA = null;
  let bestB = null;
  let anyTie = null;
  for (const a of listA) {
    for (const b of listB) {
      const pair = judgeGesturePair(a, b);
      if (pair.result === "A" && !bestA) bestA = { ...pair, gestureUsed: a, oppGesture: b };
      if (pair.result === "B" && !bestB) bestB = { ...pair, gestureUsed: b, oppGesture: a };
      if (pair.result === "tie" && !anyTie) anyTie = pair;
    }
  }
  if (bestA) return { winnerSlot: 1, ...bestA };
  if (bestB) return { winnerSlot: 2, ...bestB };
  return { winnerSlot: null, ...(anyTie || { result: "tie" }) };
}

function itemEligibleRound(round) {
  return round > 0 && round % 3 === 0;
}

function mostFrequentGesture(counts) {
  if (!counts) return null;
  let best = null;
  let bestN = 0;
  for (const g of GESTURE_ORDER) {
    const n = counts[g] || 0;
    if (n > bestN) {
      best = g;
      bestN = n;
    }
  }
  return bestN > 0 ? best : null;
}

function bumpCount(counts, gesture) {
  const next = { ...(counts || {}) };
  if (gesture && GESTURE_NAME[gesture]) next[gesture] = (next[gesture] || 0) + 1;
  return next;
}

function dualEligible(state, slot) {
  if (!rulesEnabled("dual_hand")) return false;
  const used = slot === 1 ? state.dualUsed1 : state.dualUsed2;
  if (used) return false;
  if (seriesDecided(state)) return false;
  if (rulesEnabled("bo_mode")) {
    const mine = slot === 1 ? state.games1 || 0 : state.games2 || 0;
    const theirs = slot === 1 ? state.games2 || 0 : state.games1 || 0;
    return theirs > mine;
  }
  const hp = slot === 1 ? state.hp1 : state.hp2;
  return hp <= DUAL_HAND_HP_THRESHOLD;
}

function mutationBlockedGesture(state, slot) {
  if (!rulesEnabled("mutation")) return null;
  const repeat = slot === 1 ? state.repeatCount1 || 0 : state.repeatCount2 || 0;
  const recent = slot === 1 ? state.recentGesture1 : state.recentGesture2;
  return repeat >= MUTATE_AFTER ? recent : null;
}

let match = null;
let event = null;
let mySlot = null;
let submittedThisRound = false;
let useUlt = false;
let feintStance = null;
let dualActive = false;
let dualPicks = [];
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

// BO5(或進階規則的BO制):先取得3局/3分勝利才算整場對戰結束,不是單局血量歸零就結束
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
        await db.submitMove(matchId, mySlot, { gesture: null, ult: false, timeout: true, stance: feintStance });
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
  renderMindreadPanel(state);

  if (seriesDecided(state)) {
    document.getElementById("choice-row").style.display = "none";
    ultBtn.style.display = "none";
    hideFeintRow();
    hideDualButton();
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
    hideFeintRow();
    hideDualButton();
    document.getElementById("timer-fill").style.width = "0%";
    statusEl.innerHTML = ui.icon("eye") + "觀戰模式・對戰進行中";
    return;
  }

  renderFeintRow(state);
  renderDualButton(state);
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
  ultBtn.disabled = !!myUltUsed || submittedThisRound || dualActive;

  document.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = submittedThisRound));
  statusEl.innerHTML = submittedThisRound
    ? ui.icon("hourglass") + "已送出,等待對方..."
    : dualActive
    ? ui.icon("split") + `雙手符啟動中,選 2 個不同的手勢(已選 ${dualPicks.length}/2)`
    : ui.icon("timer") + "30 秒內選一個手勢!";
  startTimer(state);
}

function renderSeriesDots(state) {
  const box = document.getElementById("series-dots");
  if (!box) return;
  const [p1Name, p2Name] = names();
  const dots = (n) =>
    Array.from({ length: 3 }, (_, i) => `<span class="sd-dot${i < n ? " won" : ""}"></span>`).join("");
  const boMode = rulesEnabled("bo_mode");
  box.innerHTML = `
    <span class="sd-label">${ui.esc(p1Name)}</span>
    <span class="sd-side">${dots(state.games1 || 0)}</span>
    <span class="sd-label">${boMode ? "BO3" : `第${state.game || 1}局 · BO5`}</span>
    <span class="sd-side">${dots(state.games2 || 0)}</span>
    <span class="sd-label">${ui.esc(p2Name)}</span>
  `;
}

// 讀心值(進階規則):把雙方目前的出招習慣分布秀給大家看,並不只是給自己看
function renderMindreadPanel(state) {
  const box = document.getElementById("mindread-panel");
  if (!box) return;
  if (!rulesEnabled("mindread")) {
    box.style.display = "none";
    return;
  }
  // 對戰中的玩家只看得到「對方」的傾向分析(讀心才有意義);純觀眾兩邊都能看
  const [p1Name, p2Name] = names();
  const panels = [];
  if (!mySlot || mySlot === 1) panels.push({ name: p2Name, counts: state.gestureCount2, tag: "read2" });
  if (!mySlot || mySlot === 2) panels.push({ name: p1Name, counts: state.gestureCount1, tag: "read1" });
  const hasAny = panels.some((p) => p.counts && Object.values(p.counts).some((n) => n > 0));
  if (!hasAny) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  box.innerHTML = panels
    .map((p) => {
      const counts = p.counts || {};
      const total = GESTURE_ORDER.reduce((sum, g) => sum + (counts[g] || 0), 0) || 1;
      const top = mostFrequentGesture(counts);
      const rows = GESTURE_ORDER.map((g) => {
        const n = counts[g] || 0;
        const pct = Math.round((n / total) * 100);
        return `
          <div class="stat-row${g === top ? " top" : ""}">
            <span class="lbl">${ui.icon(GESTURE_ICON[g])}${GESTURE_NAME[g]}</span>
            <div class="stat-bar"><div style="width:${pct}%"></div></div>
            <span class="pct">${pct}%</span>
          </div>`;
      }).join("");
      return `
        <div class="mindread-block">
          <div class="mindread-title">${ui.icon("brain")}${ui.esc(p.name)}的出招傾向</div>
          ${rows}
        </div>`;
    })
    .join("");
}

function hideFeintRow() {
  const box = document.getElementById("feint-row");
  if (box) box.style.display = "none";
}

// 假動作(進階規則):出招前先宣告「偏攻擊」或「偏防禦」,純情報,不直接影響傷害,
// 但每一回合宣告完後會跟手勢一起揭曉,唬多了容易被〈讀心值〉或對方肉眼抓到規律。
function renderFeintRow(state) {
  const box = document.getElementById("feint-row");
  if (!box) return;
  if (!rulesEnabled("stance") || submittedThisRound) {
    box.style.display = "none";
    return;
  }
  box.style.display = "flex";
  box.innerHTML = `
    <button class="feint-btn${feintStance === "attack" ? " picked" : ""}" type="button" data-s="attack">${ui.icon(
    "sword"
  )}宣告:偏攻擊</button>
    <button class="feint-btn${feintStance === "defense" ? " picked" : ""}" type="button" data-s="defense">${ui.icon(
    "shield"
  )}宣告:偏防禦</button>
  `;
  box.querySelectorAll(".feint-btn").forEach((btn) => {
    btn.onclick = () => {
      feintStance = feintStance === btn.dataset.s ? null : btn.dataset.s;
      renderFeintRow(state);
    };
  });
}

function hideDualButton() {
  const box = document.getElementById("dual-btn");
  if (box) box.style.display = "none";
}

// 雙手出招(結構性改版):落後方整場限用1次,同時出兩個手勢,其中一個贏過對方的招就算贏
function renderDualButton(state) {
  const box = document.getElementById("dual-btn");
  if (!box) return;
  if (submittedThisRound || !dualEligible(state, mySlot)) {
    box.style.display = "none";
    if (!dualEligible(state, mySlot)) {
      dualActive = false;
      dualPicks = [];
    }
    return;
  }
  box.style.display = "flex";
  box.innerHTML = ui.icon("split") + (dualActive ? "取消雙手符(整場限用1次)" : "使用雙手符:同時出兩個手勢(整場限用1次)");
  box.classList.toggle("active-choice", dualActive);
  box.onclick = () => {
    dualActive = !dualActive;
    dualPicks = [];
    useUlt = false;
    render(match.state);
  };
}

async function resolveRoundIfReady(state) {
  const iAmResolver = mySlot === 1 || (mySlot === 2 && autopilotSlot === 1);
  if (!iAmResolver || resolving) return;
  if (!state.m1 || !state.m2) return;
  resolving = true;
  try {
    const [p1Name, p2Name] = names();
    const rules = (event && event.rules) || {};
    const boMode = !!rules.bo_mode;
    let hp1 = state.hp1;
    let hp2 = state.hp2;
    let ult1 = state.ult1 || 0;
    let ult2 = state.ult2 || 0;
    let games1 = state.games1 || 0;
    let games2 = state.games2 || 0;
    let streak1 = state.streak1 || 0;
    let streak2 = state.streak2 || 0;
    let lastWinGesture1 = state.lastWinGesture1 || null;
    let lastWinGesture2 = state.lastWinGesture2 || null;
    let winGestureStreak1 = state.winGestureStreak1 || 0;
    let winGestureStreak2 = state.winGestureStreak2 || 0;
    let recentGesture1 = state.recentGesture1 || null;
    let recentGesture2 = state.recentGesture2 || null;
    let repeatCount1 = state.repeatCount1 || 0;
    let repeatCount2 = state.repeatCount2 || 0;
    let gestureCount1 = state.gestureCount1 || {};
    let gestureCount2 = state.gestureCount2 || {};
    let lastGesture1 = state.lastGesture1 || null;
    let lastGesture2 = state.lastGesture2 || null;
    let rpsitem1 = state.rpsitem1 || null;
    let rpsitem2 = state.rpsitem2 || null;
    let dualUsed1 = !!state.dualUsed1;
    let dualUsed2 = !!state.dualUsed2;
    const log = state.log ? [...state.log] : [];
    const m1 = state.m1;
    const m2 = state.m2;
    let lastEvent = null;
    const fieldMod = getFieldMod(state);

    if (m1.ult) ult1 += 1;
    if (m2.ult) ult2 += 1;
    if (m1.dual) dualUsed1 = true;
    if (m2.dual) dualUsed2 = true;

    let winnerSlot = null;
    let winGesture = null;
    let judgement = null;
    const g1Text = m1.dual && m1.gesture2 ? `${GESTURE_NAME[m1.gesture]}+${GESTURE_NAME[m1.gesture2]}(雙手符)` : m1.gesture ? GESTURE_NAME[m1.gesture] : "逾時未出招";
    const g2Text = m2.dual && m2.gesture2 ? `${GESTURE_NAME[m2.gesture]}+${GESTURE_NAME[m2.gesture2]}(雙手符)` : m2.gesture ? GESTURE_NAME[m2.gesture] : "逾時未出招";
    let entry = `第${state.round}回合:${p1Name} 出了 ${g1Text},${p2Name} 出了 ${g2Text}。`;

    if (m1.stance || m2.stance) {
      const parts = [];
      if (m1.stance && STANCE_LABEL[m1.stance]) parts.push(`${p1Name}宣告「${STANCE_LABEL[m1.stance].text}」`);
      if (m2.stance && STANCE_LABEL[m2.stance]) parts.push(`${p2Name}宣告「${STANCE_LABEL[m2.stance].text}」`);
      if (parts.length) entry += parts.join(",") + "。";
    }

    if (!m1.gesture && !m2.gesture) {
      entry += "雙方都逾時,平手,不掉血。";
      lastEvent = { type: "timeout_both" };
      streak1 = 0;
      streak2 = 0;
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
      winGesture = m1.gesture;
      entry += `${p1Name}使出究極手勢,直接獲勝!`;
    } else if (m2.ult) {
      winnerSlot = 2;
      winGesture = m2.gesture;
      entry += `${p2Name}使出究極手勢,直接獲勝!`;
    } else {
      judgement = judgeRound(m1, m2);
      if (judgement.winnerSlot === null) {
        entry += judgement.bombDefused ? flavorFor(judgement, "") : "出了相同的手勢,平手。";
        lastEvent = { type: "tie" };
      } else {
        winnerSlot = judgement.winnerSlot;
        winGesture = judgement.winGesture;
        const winnerName = winnerSlot === 1 ? p1Name : p2Name;
        if (judgement.bombFizzled || judgement.bombExploded) {
          entry += flavorFor(judgement, winnerName);
        } else {
          entry += `${FLAVOR[judgement.winGesture][judgement.oppGesture]}${winnerName}獲勝。`;
        }
      }
    }

    // 手勢突變 / 讀心值 / 偵測符 用的統計資料,不管這回合誰贏都要更新(逾時的那一方不算數)
    if (rules.mutation) {
      if (m1.gesture) {
        repeatCount1 = m1.gesture === state.recentGesture1 ? repeatCount1 + 1 : 1;
      } else {
        repeatCount1 = 0;
      }
      if (m2.gesture) {
        repeatCount2 = m2.gesture === state.recentGesture2 ? repeatCount2 + 1 : 1;
      } else {
        repeatCount2 = 0;
      }
    }
    recentGesture1 = m1.gesture || recentGesture1;
    recentGesture2 = m2.gesture || recentGesture2;

    // 讀心值:用「這回合開始前」的舊統計去判斷輸家這回合是不是又出了他最常出的那招,
    // 猜中才加分,所以要在把這回合的手勢計入統計「之前」先判斷完
    let mindreadBonus = 0;
    if (rules.mindread && winnerSlot) {
      const loserSlot = winnerSlot === 1 ? 2 : 1;
      const loserGesture = loserSlot === 1 ? m1.gesture : m2.gesture;
      const loserPreCounts = loserSlot === 1 ? gestureCount1 : gestureCount2;
      const topGesture = mostFrequentGesture(loserPreCounts);
      if (topGesture && loserGesture === topGesture) {
        entry += ` ${winnerSlot === 1 ? p1Name : p2Name}剋中了對方最常出的${GESTURE_NAME[topGesture]},讀心成功!`;
        mindreadBonus = 1;
      }
    }
    if (rules.mindread) {
      if (m1.gesture) gestureCount1 = bumpCount(gestureCount1, m1.gesture);
      if (m2.gesture) gestureCount2 = bumpCount(gestureCount2, m2.gesture);
    }

    // 道具符(每3回合各自隨機拿一個新的,還握著沒用掉的話不會被換掉)。
    // 護盾符/增幅符是靠傷害運作的,BO制沒有傷害概念,所以BO制底下不發放這兩種道具。
    if (rules.item_die && !boMode && itemEligibleRound(state.round)) {
      if (!rpsitem1) {
        rpsitem1 = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
        if (rpsitem1 === "detect") {
          entry += lastGesture2
            ? ` ${p1Name}的偵測符發動,看到${p2Name}上一手是${GESTURE_NAME[lastGesture2]}。`
            : ` ${p1Name}拿到偵測符,但對方還沒出過手,先留著。`;
          if (lastGesture2) rpsitem1 = null;
        } else {
          entry += ` ${p1Name}獲得${ITEM_LABEL[rpsitem1].text}。`;
        }
      }
      if (!rpsitem2) {
        rpsitem2 = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
        if (rpsitem2 === "detect") {
          entry += lastGesture1
            ? ` ${p2Name}的偵測符發動,看到${p1Name}上一手是${GESTURE_NAME[lastGesture1]}。`
            : ` ${p2Name}拿到偵測符,但對方還沒出過手,先留著。`;
          if (lastGesture1) rpsitem2 = null;
        } else {
          entry += ` ${p2Name}獲得${ITEM_LABEL[rpsitem2].text}。`;
        }
      }
    }
    if (m1.gesture) lastGesture1 = m1.gesture;
    if (m2.gesture) lastGesture2 = m2.gesture;

    if (winnerSlot && !boMode) {
      const loserSlot = winnerSlot === 1 ? 2 : 1;
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      const loserName = winnerSlot === 1 ? p2Name : p1Name;
      const winnerHp = winnerSlot === 1 ? hp1 : hp2;
      // HP 上限是 30,低血雙倍傷害的門檻等比例拉高到 9(原本 10 點血制是「≤3」,約剩三成血)
      let dmg = winnerHp <= 9 ? 2 : 1;
      let doubled = winnerHp <= 9;
      // 場地規則「磐石戰場」:靠石頭贏的那一擊,傷害再 +1
      if (fieldMod === "rock_boost" && winGesture === "rock") dmg += 1;

      // 氣勢系統:連勝續航加成 / 背水一戰翻盤加倍(用這回合開始前的連勝連敗數字判斷)
      const prevWinnerStreak = winnerSlot === 1 ? streak1 : streak2;
      const prevLoserStreak = loserSlot === 1 ? streak1 : streak2;
      if (rules.momentum) {
        if (prevWinnerStreak >= MOMENTUM_STREAK_BONUS) {
          dmg += 1;
          entry += ` ${winnerName}氣勢正旺(連勝${prevWinnerStreak}局),追加 1 點傷害。`;
        }
        if (prevWinnerStreak <= -MOMENTUM_COMEBACK) {
          dmg *= 2;
          doubled = true;
          entry += ` ${winnerName}背水一戰(連敗${-prevWinnerStreak}局後逆轉),傷害直接翻倍!`;
        }
      }

      // 連段技:連續用同一手勢獲勝滿3局,額外+2傷害
      if (rules.combo) {
        const myLastWinGesture = winnerSlot === 1 ? lastWinGesture1 : lastWinGesture2;
        const myWinStreak = winnerSlot === 1 ? winGestureStreak1 : winGestureStreak2;
        const continuedStreak = winGesture === myLastWinGesture ? myWinStreak + 1 : 1;
        if (winnerSlot === 1) {
          lastWinGesture1 = winGesture;
          winGestureStreak1 = continuedStreak;
        } else {
          lastWinGesture2 = winGesture;
          winGestureStreak2 = continuedStreak;
        }
        if (continuedStreak >= COMBO_STREAK_TRIGGER) {
          dmg += 2;
          entry += ` 連段技發動!連續${continuedStreak}局用${GESTURE_NAME[winGesture]}獲勝,額外 +2 傷害。`;
        }
      }

      // 讀心值加成(上面已經判斷過是否命中,這裡只補傷害數字)
      if (mindreadBonus) dmg += mindreadBonus;

      // 道具符:增幅符(獲勝方持有時)/ 護盾符(落敗方持有時,直接免傷)
      let shieldBlocked = false;
      const loserItem = loserSlot === 1 ? rpsitem1 : rpsitem2;
      const winnerItem = winnerSlot === 1 ? rpsitem1 : rpsitem2;
      if (rules.item_die && winnerItem === "amp") {
        dmg += 2;
        entry += ` ${winnerName}的增幅符發動,追加 2 點傷害!`;
        if (winnerSlot === 1) rpsitem1 = null;
        else rpsitem2 = null;
      }
      if (rules.item_die && loserItem === "shield") {
        shieldBlocked = true;
        dmg = 0;
        entry += ` ${loserName}的護盾符擋下了這次攻擊,毫髮無傷!`;
        if (loserSlot === 1) rpsitem1 = null;
        else rpsitem2 = null;
      }

      const hpBefore = loserSlot === 1 ? hp1 : hp2;
      if (loserSlot === 1) hp1 -= dmg;
      else hp2 -= dmg;
      const hpAfter = loserSlot === 1 ? hp1 : hp2;
      if (!shieldBlocked) {
        entry += `${loserName}扣 ${dmg} 血${doubled && dmg > 0 ? "(傷害加倍!)" : ""}(${hpBefore}→${Math.max(hpAfter, 0)})。`;
      }
      lastEvent = { type: "hit", winnerSlot, loserSlot, dmg, shieldBlocked };

      if (rules.momentum) {
        const nextWinnerStreak = prevWinnerStreak > 0 ? prevWinnerStreak + 1 : 1;
        const nextLoserStreak = prevLoserStreak < 0 ? prevLoserStreak - 1 : -1;
        if (winnerSlot === 1) {
          streak1 = nextWinnerStreak;
          streak2 = nextLoserStreak;
        } else {
          streak2 = nextWinnerStreak;
          streak1 = nextLoserStreak;
        }
      }
    } else if (winnerSlot && boMode) {
      // BO制:不算傷害,直接把這回合算一分,拿到3分的一方贏得整場對戰
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      if (winnerSlot === 1) games1 += 1;
      else games2 += 1;
      entry += `${winnerName}拿下這一分!比分 ${games1}:${games2}。`;
      lastEvent = { type: "bo_point", winnerSlot, games1, games2 };
      if (games1 === 2 && games2 === 2) {
        entry += " 賽末點!";
      }
    }
    log.push(entry);

    if (boMode) {
      // BO制沒有「單局血量歸零」這一層,round每算完一分就直接檢查整場賽果
      const seriesOver = games1 >= 3 || games2 >= 3;
      const newState = {
        ...state,
        games1,
        games2,
        ult1,
        ult2,
        log,
        lastEvent,
        round: state.round + 1,
        m1: null,
        m2: null,
        recentGesture1,
        recentGesture2,
        repeatCount1,
        repeatCount2,
        gestureCount1,
        gestureCount2,
        lastGesture1,
        lastGesture2,
        dualUsed1,
        dualUsed2,
      };
      await db.updateMatchState(matchId, { state: newState });
      if (seriesOver) {
        const finalWinnerSlot = games1 >= 3 ? 1 : 2;
        const winnerId = finalWinnerSlot === 1 ? match.player1_id : match.player2_id;
        const loserId = finalWinnerSlot === 1 ? match.player2_id : match.player1_id;
        await db.advanceAfterMatch(match, winnerId, loserId);
      }
      return;
    }

    const gameOver = hp1 <= 0 || hp2 <= 0;

    const commonFields = {
      streak1,
      streak2,
      lastWinGesture1,
      lastWinGesture2,
      winGestureStreak1,
      winGestureStreak2,
      recentGesture1,
      recentGesture2,
      repeatCount1,
      repeatCount2,
      gestureCount1,
      gestureCount2,
      lastGesture1,
      lastGesture2,
      rpsitem1,
      rpsitem2,
      dualUsed1,
      dualUsed2,
    };

    if (!gameOver) {
      // 這局還沒分出勝負,正常進下一回合
      const newState = { ...state, hp1, hp2, ult1, ult2, log, lastEvent, round: state.round + 1, m1: null, m2: null, ...commonFields };
      await db.updateMatchState(matchId, { state: newState });
    } else {
      // BO5:這局分出勝負了,但要先取得3局勝利才是整場對戰結束
      const gameWinnerSlot = hp1 <= 0 ? 2 : 1;
      games1 = games1 + (gameWinnerSlot === 1 ? 1 : 0);
      games2 = games2 + (gameWinnerSlot === 2 ? 1 : 0);
      const gameNum = state.game || 1;
      const gameWinnerName = gameWinnerSlot === 1 ? p1Name : p2Name;
      log.push(`第${gameNum}局結束,${gameWinnerName}拿下這局!系列賽比分 ${games1}:${games2}。`);

      const seriesOver = games1 >= 3 || games2 >= 3;
      const seriesEvent = { type: "series_game_over", winnerSlot: gameWinnerSlot, gameNum, games1, games2 };

      if (seriesOver) {
        const newState = { ...state, hp1, hp2, ult1, ult2, log, lastEvent: seriesEvent, round: state.round + 1, games1, games2, m1: null, m2: null, ...commonFields };
        await db.updateMatchState(matchId, { state: newState });

        const finalWinnerSlot = games1 >= 3 ? 1 : 2;
        const winnerId = finalWinnerSlot === 1 ? match.player1_id : match.player2_id;
        const loserId = finalWinnerSlot === 1 ? match.player2_id : match.player1_id;
        await db.advanceAfterMatch(match, winnerId, loserId);
      } else {
        if (games1 === 2 && games2 === 2) log.push("賽末點!下一局就會分出整場對戰的勝負。");
        // 系列賽還沒結束,血量全部回滿,開下一局(道具/連段/氣勢/雙手符額度也跟著這一局重新開始,
        // 但手勢突變、讀心值統計、逾時代打這些是看整場對戰習慣,所以不用重置)
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
          streak1: 0,
          streak2: 0,
          lastWinGesture1,
          lastWinGesture2,
          winGestureStreak1,
          winGestureStreak2,
          rpsitem1: null,
          rpsitem2: null,
          recentGesture1,
          recentGesture2,
          repeatCount1,
          repeatCount2,
          gestureCount1,
          gestureCount2,
          lastGesture1,
          lastGesture2,
          dualUsed1,
          dualUsed2,
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
    feintStance = null;
    dualActive = false;
    dualPicks = [];
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

// 手勢按鈕每次 render 都重建:因為「炸彈這回合有沒有開放」「手勢突變擋掉哪一招」是每回合可能變的
function renderAndBindChoiceButtons(state) {
  let gestures = GESTURE_ORDER.slice();
  if (bombAvailable(state)) gestures.push("bomb");
  const blocked = mutationBlockedGesture(state, mySlot);

  document.getElementById("choice-row").innerHTML = gestures
    .map((g) => {
      const isBlocked = g === blocked;
      const isPicked = dualActive ? dualPicks.includes(g) : false;
      return `<button class="choice-btn g-${g}${g === "bomb" ? " bomb" : ""}${isPicked ? " picked" : ""}" data-g="${g}" ${
        isBlocked ? "disabled title=\"連續出太多次同一招,這回合系統把它鎖住了\"" : ""
      }>${ui.icon(GESTURE_ICON[g])}<span class="lbl">${GESTURE_NAME[g]}</span></button>`;
    })
    .join("");

  const mutationHint = document.getElementById("mutation-hint");
  if (mutationHint) {
    if (blocked) {
      mutationHint.style.display = "block";
      mutationHint.innerHTML = ui.icon("shuffle") + `連續出太多次${GESTURE_NAME[blocked]}了,這回合系統把它鎖住,逼你換一招!`;
    } else {
      mutationHint.style.display = "none";
    }
  }

  document.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (submittedThisRound || btn.disabled) return;
      const gesture = btn.dataset.g;

      if (dualActive) {
        if (dualPicks.includes(gesture)) {
          dualPicks = dualPicks.filter((g) => g !== gesture);
        } else if (dualPicks.length < 2) {
          dualPicks.push(gesture);
        }
        if (dualPicks.length === 2) {
          submittedThisRound = true;
          clearInterval(timerInterval);
          battleView.announce(`你同時使出了${GESTURE_NAME[dualPicks[0]]}與${GESTURE_NAME[dualPicks[1]]}!`, { icon: "split" });
          await db.submitMove(matchId, mySlot, {
            gesture: dualPicks[0],
            gesture2: dualPicks[1],
            dual: true,
            ult: false,
            timeout: false,
            stance: feintStance,
          });
        } else {
          render(state);
        }
        return;
      }

      submittedThisRound = true;
      clearInterval(timerInterval);
      battleView.announce(`你使出了${GESTURE_NAME[gesture]}!`, { icon: GESTURE_ICON[gesture] });
      await db.submitMove(matchId, mySlot, { gesture, ult: useUlt, timeout: false, stance: feintStance });
      useUlt = false;
    };
  });
}

function bindControls() {
  document.getElementById("ult-btn").innerHTML = ui.icon("zap") + "使出究極手勢(保證獲勝該回合)";
  document.getElementById("ult-btn").onclick = () => {
    if (dualActive) return;
    useUlt = !useUlt;
    if (useUlt) battleView.announce("你準備使出究極手勢!", { icon: "zap" });
    refresh();
  };
}

// 跟 dice.js 共用同一套「基礎規則 + 本場額外開啟的機制」呈現方式,說明文字盡量跟 rules.html 的用詞一致
const RULE_EXPLAIN = {
  bomb: "第 3 回合起,每回合約有 15% 機率額外開放隱藏手勢「炸彈」。炸彈 勝 石頭、剪刀;炸彈 敗 布、蜥蜴;炸彈 對 史波克 是特殊平局,雙方不掉血。",
  field_mod: "開局隨機決定這一局固定生效的特殊效果,3 選 1:磐石戰場(靠石頭獲勝時傷害+1)、手速戰場(究極手勢這局可用2次)、疾風戰場(思考時間縮短到20秒)。",
  item_die: "每 3 回合雙方各自隨機拿到一個道具,持有到觸發時機才消耗:護盾符(下次落敗免傷)、增幅符(下次獲勝+2傷害)、偵測符(立刻看到對方上一手出了什麼)。開啟「BO制」時,護盾符/增幅符不會發放(靠傷害運作,BO制沒有傷害概念)。",
  stance: "出招前可以先公開宣告這局「偏攻擊」或「偏防禦」,純粹是情報,不會直接影響傷害,對方看得到但不知道真假;宣告會跟手勢一起在戰報揭曉,唬多了容易被〈讀心值〉或對方肉眼抓到規律。",
  combo: "系統會記錄你最近用哪個手勢獲勝。連續 3 局都用同一手勢獲勝,額外 +2 傷害,並跳出「連段技發動!」;之後繼續用同一招連勝下去,每一局都會持續拿到加成。要不要賭一把繼續出同一招,風險自負。",
  mindread: "系統偷偷統計對方整場出招的習慣分布,如果你選中「剋制對方最常出的那招」並獲勝,額外 +1 傷害,並跳出「讀心成功!」。開啟這項規則時,對戰畫面也會顯示對方的即時出招傾向統計,觀眾也看得到同一份統計。",
  momentum: "連勝 2 局起,下一擊額外 +1 傷害,氣勢會一直維持到輸掉一局為止;連續落敗 2 局後,如果靠獲勝逆轉,那一擊的傷害會直接翻倍(背水一戰)。",
  mutation: "連續 3 回合都出同一個手勢,下一回合系統會把那個手勢從選項裡鎖住,逼你換一招,防止靠「無腦一直出同一招」硬撐。",
  bo_mode: "整場對戰拋開 HP 累加機制,改成每回合直接分出這一分的勝負,率先取得 3 分的一方贏得整場;打到 2:2 時觸發「賽末點!」提示。以下基礎規則裡跟 HP / BO5 相關的敘述,本場一律不適用。",
  dual_hand: "落後的一方整場限用 1 次「雙手符」,可以同時出兩個手勢,只要其中一個贏過對方的招就算贏。觸發資格:HP 制下自己 HP ≤15 才能使用;BO制下自己的局分落後對方才能使用。限用 1 次,是殘局翻盤手段,不會變成必勝招。",
};

function renderRules() {
  const box = document.getElementById("rule-content");
  const rules = (event && event.rules) || {};
  let html = `
    <p>採 BO5 賽制:雙方各有 30 點 HP,先讓對方 HP 歸零的人拿下這一局;率先拿下 3 局的人贏得整場對戰(最多打到第 5 局)。每進入新一局,雙方 HP 會全部回滿。</p>
    <p>每回合 30 秒內選一個手勢:石頭 / 布 / 剪刀 / 蜥蜴 / 史波克。超時未選視為該回合落敗,雙方都超時則平手不掉血。</p>
    <p>石頭勝剪刀、蜥蜴;布勝石頭、史波克;剪刀勝布、蜥蜴;蜥蜴勝史波克、布;史波克勝剪刀、石頭。出了相同的手勢就是平手。</p>
    <p>每人每一局都有 1 張「究極手勢」卡:出牌保證獲勝該回合,除非對方同一回合也出究極手勢,此時雙方抵銷、判定平手。</p>
    <p>當你的 HP ≤9 時,獲勝的那一擊傷害會翻倍,適合絕地反擊。系列賽打到 2:2 時會有「賽末點」提示。</p>
    <p>每一場對決,系統都會依照實際出的手勢組合寫出對應的戰報敘述,不是死板的「X勝過Y」。</p>
  `;
  const active = Object.keys(rules).filter((k) => rules[k] && RULE_EXPLAIN[k]);
  if (active.length) {
    html += `<h4>本場活動額外開啟的機制</h4>`;
    active.forEach((k) => {
      const meta = ui.RULE[k];
      if (meta) {
        html += `<p><b style="color:var(--ink);">${ui.icon(meta.icon)} ${meta.label}</b><br/>${RULE_EXPLAIN[k]}</p>`;
      }
    });
  }
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
