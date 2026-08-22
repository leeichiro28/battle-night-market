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
// 手勢圖示一律用 lucide，不用 emoji
const GESTURE_ICON = { rock: "mountain", paper: "hand", scissors: "scissors", lizard: "bug", spock: "hand-metal", bomb: "bomb" };
const GESTURE_NAME = { rock: "石頭", paper: "布", scissors: "剪刀", lizard: "蜥蜴", spock: "史波克", bomb: "炸彈" };
const GESTURE_ORDER = ["rock", "paper", "scissors", "lizard", "spock"];

// 手牌制(進階規則):真正的抽牌手感——整局開局把 18 張手勢牌洗好(石頭/布/剪刀各4、蜥蜴/史波克各3)，
// 固定發前 4 張當手牌，剩下的按洗好的順序疊成牌堆。出一張少一張，出的那張立刻補上牌堆最上面那張
// (不是重新隨機抽，是照牌堆固定順序發，才不會連續補到好幾張一樣的)。炸彈(隱藏第六手勢)不算在
// 手牌裡，機率隨機開放的邏輯不變;究極手勢底層仍然要選一個普通手勢，那張牌一樣算打出去、要補新的。
// 牌堆抽完之後，打出的牌不會再補新的，手牌會越打越少，等手牌也打完，那一局剩下的回合解除限制、
// 改回自由選擇，當作安全閥。
const HAND_SIZE = 4;
const HAND_LIMIT_COUNTS = { rock: 4, paper: 4, scissors: 4, lizard: 3, spock: 3 };
function freshDeal() {
  const cards = [];
  Object.entries(HAND_LIMIT_COUNTS).forEach(([g, n]) => {
    for (let i = 0; i < n; i++) cards.push(g);
  });
  for (let i = cards.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = cards[i];
    cards[i] = cards[j];
    cards[j] = tmp;
  }
  return { hand: cards.slice(0, HAND_SIZE), deck: cards.slice(HAND_SIZE) };
}
function getHandDeck(state, slot) {
  const hand = slot === 1 ? state.hand1 : state.hand2;
  const deck = slot === 1 ? state.deck1 : state.deck2;
  if (Array.isArray(hand)) return { hand, deck: Array.isArray(deck) ? deck : [] };
  return freshDeal();
}
function handExhausted(hand) {
  return !hand || hand.length === 0;
}
// 從手牌打出幾張牌(通常是1張，雙手符是2張)，每打一張就從牌堆最上面補一張進同一個位置，
// 牌堆空了就不補，手牌直接少一張。回傳新的 hand/deck，不會動到傳進來的原始陣列。
function playCardsFromHand(hand, deck, gesturesPlayed) {
  let newHand = hand.slice();
  let newDeck = deck.slice();
  gesturesPlayed.forEach((g) => {
    const idx = newHand.indexOf(g);
    if (idx === -1) return; // 理論上不會發生(按鈕已經擋住選不了手牌沒有的牌)，防呆用
    if (newDeck.length > 0) {
      newHand[idx] = newDeck.shift();
    } else {
      newHand.splice(idx, 1);
    }
  });
  return { hand: newHand, deck: newDeck };
}

// 專屬戰報敘述:每種對決組合都有獨立描述文字，取代死板的「X勝過Y」
const FLAVOR = {
  rock: { scissors: "巨石狠狠壓扁了剪刀的刀刃！", lizard: "石塊精準砸中了蜥蜴的頭！" },
  paper: { rock: "一張紙悄悄把石頭整個包住！", spock: "報紙蓋住了史波克的臉，判定失格！" },
  scissors: { paper: "剪刀俐落地剪碎了那張紙！", lizard: "剪刀喀嚓一聲剪斷了蜥蜴的頭！" },
  lizard: { spock: "蜥蜴一口毒倒了史波克！", paper: "蜥蜴悄悄咬爛了那張紙！" },
  spock: { scissors: "史波克伸手捏碎了剪刀！", rock: "史波克用雷射把石頭蒸發了！" },
};

const FIELD_MODS_RPS = ["rock_boost", "ult_twice", "fast_timer"];
const FIELD_MOD_LABEL = {
  rock_boost: { icon: "mountain", text: "磐石戰場:石頭獲勝時傷害額外 +1" },
  ult_twice: { icon: "zap", text: "手速戰場:究極手勢這局可以用 2 次" },
  fast_timer: { icon: "wind", text: "疾風戰場:思考時間縮短到 30 秒" },
};

// 道具符(進階規則):每 3 回合各自隨機拿到一個，持有到玩家自己選擇要不要在該回合啟動才會觸發/消耗。
// shield/amp 要賭這回合的輸贏才會生效，猜錯浪費;disrupt/insight/delay 啟動就一定成功(disrupt要對方那回合真的用究極手勢才擋得到)。
const ITEM_LABEL = {
  shield: { icon: "shield", text: "護盾符" },
  amp: { icon: "zap", text: "增幅符" },
  disrupt: { icon: "shield-off", text: "擾亂符" },
  insight: { icon: "eye", text: "洞悉符" },
  delay: { icon: "hourglass", text: "延時符" },
};
const ITEM_TYPES = ["shield", "amp", "disrupt", "insight", "delay"];

// 出招姿態宣告(假動作用):跟骰子對戰共用 stance 這個規則鍵，但五手勢版本純粹是心理戰情報，不直接影響傷害
const STANCE_LABEL = { attack: { icon: "sword", text: "偏攻擊" }, defense: { icon: "shield", text: "偏防禦" } };

const MOMENTUM_STREAK_BONUS = 2; // 連勝達到這個局數起，下一擊額外 +1 傷害
const MOMENTUM_COMEBACK = 2; // 連敗達到這個局數，靠這次獲勝翻身時傷害直接翻倍
const COMBO_STREAK_TRIGGER = 3; // 連續用同一手勢獲勝達到這個局數起，額外 +2 傷害
const MUTATE_AFTER = 3; // 連續出同一手勢達到這個回合數，下一回合系統會把那個手勢從選項中拿掉
const DUAL_HAND_HP_THRESHOLD = 8; // HP制下，HP≤這個門檻才能使用雙手符(15血制，約等於50%血量的門檻)

// 簡單的字串雜湊(FNV-1a)，用來讓雙方client不用另外同步狀態，
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

// 隱藏第六手勢:炸彈。第3回合起，約15%機率該回合額外開放
function bombAvailable(state) {
  if (!rulesEnabled("bomb")) return false;
  if ((state.round || 1) < 3) return false;
  const h = hashStr(`${matchId}|${state.game || 1}|${state.round}|bomb`);
  return h % 100 < 15;
}

// 場地規則:同一局內固定，開局隨機決定，3選1
function getFieldMod(state) {
  if (!rulesEnabled("field_mod")) return null;
  const h = hashStr(`${matchId}|${state.game || 1}|field`);
  return FIELD_MODS_RPS[h % FIELD_MODS_RPS.length];
}

// 兩個手勢單獨對決的結果，炸彈/平手都在這裡處理，雙手出招會拿這個函式去跑好幾組配對
// 回傳 { result:"A"|"B"|"tie"， winGesture， ...炸彈相關旗標 }
function judgeGesturePair(a, b) {
  if (a === b) return { result: "tie", bothBomb: a === "bomb" };
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

// 炸彈相關對決的敘述文字(一般手勢對決不會走到這裡，直接用 FLAVOR 對照表拼字串就好)
function flavorFor(pair, winnerName) {
  if (pair.bombDefused) return "史波克冷靜拆彈，邏輯完勝，平手不掉血。";
  if (pair.bombFizzled) return `${GESTURE_NAME[pair.winGesture]}悶熄了炸彈的引信，炸彈失效，${winnerName}獲勝。`;
  if (pair.bombExploded) return `轟隆一聲，${winnerName}的炸彈炸爛了${GESTURE_NAME[pair.loserGesture]},${winnerName}獲勝。`;
  return "";
}

// 判斷整回合的結果(排除逾時/究極手勢，那兩種在呼叫端就先短路處理掉了)
// 支援雙手出招:m1/m2 各自可能有 1~2 個候選手勢，任一個候選贏過對方任一候選就算贏
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
  // 手牌制開啟時自動停用手勢突變:手牌本身就限制了連續出同招最多幾次(最多4次)，
  // 兩個規則同時存在意義重疊、容易讓玩家搞不清楚是被哪個規則卡住，所以擇一。
  if (!rulesEnabled("mutation") || rulesEnabled("hand_limit")) return null;
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
let useItemThisRound = false;
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
let autopilotSlot = null; // 對手超過1分鐘沒入場時，代替他自動出招的slot
let autopilotAnnounced = false;
let entryWatchdog = null;
let goneAway = false;
let refreshGen = 0; // 每次真的呼叫 refresh() 就+1，回應回來時比對還是不是最新的一次，
// 避免realtime事件密集觸發時，比較舊的那次查詢比較慢回來反而蓋掉新的畫面(亂序/過期回應)
let refreshDebounceTimer = null;
let battleView = null;

const ENTRY_TIMEOUT_MS = 60000; // 超過1分鐘對手沒入場，自動開始幫他出招

function names() {
  return [match.p1?.name || "玩家一", match.p2?.name || "玩家二"];
}

// 一般對戰是 BO3(先取得2局勝利)，總冠軍賽(match.bracket === "final")維持 BO5(先取得3局勝利)，
// 賽程更長讓冠軍賽更有份量。進階規則的「BO制」(bo_mode，用分數取代HP)不在這次調整範圍內，維持先搶3分。
function gamesToWin(m) {
  return m && m.bracket === "final" ? 3 : 2;
}
function seriesWinsNeeded() {
  return rulesEnabled("bo_mode") ? 3 : gamesToWin(match);
}

// 先取得目標局數/分數勝利才算整場對戰結束，不是單局血量歸零就結束
function seriesDecided(state) {
  const need = seriesWinsNeeded();
  return (state.games1 || 0) >= need || (state.games2 || 0) >= need;
}

function startTimer(state) {
  if (!mySlot) return;
  const roundKey = state.round + "-" + mySlot;
  if (currentRoundKey === roundKey) return;
  currentRoundKey = roundKey;
  clearInterval(timerInterval);
  if (submittedThisRound || seriesDecided(state)) return;

  let timeLeft = getFieldMod(state) === "fast_timer" ? 30000 : 45000;
  // 延時符(道具符):上一回合有啟動的話，這一回合思考時間 +15 秒
  const myTimeBoost = (mySlot === 1 ? state.timeBoost1 : state.timeBoost2) || 0;
  timeLeft += myTimeBoost * 1000;
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
        battleView.announce("思考時間到，判定逾時...", { icon: "hourglass" });
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
      if (!submittedThisRound) battleView.announce("輪到你了！", { icon: "swords" });
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
    hideItemToggleBtn();
    document.getElementById("timer-fill").style.width = "0%";
    const winnerIsP1 = (state.games1 || 0) >= seriesWinsNeeded();
    const winnerName = winnerIsP1 ? p1Name : p2Name;
    const score = `${state.games1 || 0}:${state.games2 || 0}`;
    if (state.forfeitReason === "both_afk") {
      battleView.announce("雙方掛機，已自動棄權", { icon: "alert-triangle", holdMs: 4200 });
      statusEl.innerHTML = ui.icon("alert-triangle") + `雙方都太久沒有進場，系統自動判定 ${ui.esc(winnerName)} 晉級`;
    } else if (state.forfeitReason === "admin_forced") {
      battleView.announce("主辦人已強制判定勝負", { icon: "gavel", holdMs: 4200 });
      statusEl.innerHTML = ui.icon("gavel") + `主辦人已在後台強制判定，${ui.esc(winnerName)} 直接晉級`;
    } else if (state.forfeitReason === "opponent_quit") {
      battleView.announce("對方已退賽", { icon: "log-out", holdMs: 4200 });
      statusEl.innerHTML = ui.icon("log-out") + `對方已退出比賽，${ui.esc(winnerName)} 直接晉級`;
    } else if (!mySlot) {
      statusEl.innerHTML = ui.icon("trophy") + `${ui.esc(winnerName)} 以 ${score} 拿下這場系列賽！`;
    } else {
      const iWon = (mySlot === 1 && winnerIsP1) || (mySlot === 2 && !winnerIsP1);
      statusEl.innerHTML = iWon
        ? ui.icon("trophy") + `你以 ${score} 贏了這場系列賽！回等候室看看下一步`
        : ui.icon("skull") + `你以 ${score} 落敗了，感謝參戰！`;
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
    hideItemToggleBtn();
    document.getElementById("timer-fill").style.width = "0%";
    statusEl.innerHTML = ui.icon("eye") + "觀戰模式・對戰進行中";
    return;
  }

  renderFeintRow(state);
  renderDualButton(state);
  renderItemToggleBtn(state);
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
      ? `究極手勢:已啟動(選一個手勢送出即可保證獲勝，本局還可用 ${ultLeft} 次)`
      : `使出究極手勢(本局還可用 ${ultLeft} 次，保證獲勝該回合)`);
  ultBtn.classList.toggle("active-choice", useUlt && !myUltUsed);
  ultBtn.disabled = !!myUltUsed || submittedThisRound || dualActive;

  document.querySelectorAll(".choice-btn").forEach((b) => (b.disabled = submittedThisRound));
  statusEl.innerHTML = submittedThisRound
    ? ui.icon("hourglass") + "已送出，等待對方..."
    : dualActive
    ? ui.icon("split") + `雙手符啟動中，選 2 個不同的手勢(已選 ${dualPicks.length}/2)`
    : ui.icon("timer") + "45 秒內選一個手勢！";
  startTimer(state);
}

function renderSeriesDots(state) {
  const box = document.getElementById("series-dots");
  if (!box) return;
  const [p1Name, p2Name] = names();
  const boMode = rulesEnabled("bo_mode");
  const need = seriesWinsNeeded();
  const dots = (n) =>
    Array.from({ length: need }, (_, i) => `<span class="sd-dot${i < n ? " won" : ""}"></span>`).join("");
  const seriesLabel = boMode
    ? "BO5(分數制)"
    : `第${state.game || 1}局 · BO${need * 2 - 1}`;
  box.innerHTML = `
    <span class="sd-label">${ui.esc(p1Name)}</span>
    <span class="sd-side">${dots(state.games1 || 0)}</span>
    <span class="sd-label">${seriesLabel}</span>
    <span class="sd-side">${dots(state.games2 || 0)}</span>
    <span class="sd-label">${ui.esc(p2Name)}</span>
  `;
}

// 讀心值(進階規則):把雙方目前的出招習慣分布秀給大家看，並不只是給自己看
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

function hideItemToggleBtn() {
  const btn = document.getElementById("item-toggle-btn");
  if (btn) btn.style.display = "none";
}

// 道具符按鈕(進階規則):手上握著道具的時候才會顯示，玩家自己決定要不要在「這一回合」啟動——
// 啟動了才會真的消耗/生效，賭錯時機(例如啟動護盾符結果自己贏了)就等於浪費掉，詳見 resolveMatch() 裡的判定。
function renderItemToggleBtn(state) {
  const btn = document.getElementById("item-toggle-btn");
  if (!btn) return;
  const boMode = rulesEnabled("bo_mode");
  const myItem = mySlot === 1 ? state.rpsitem1 : state.rpsitem2;
  if (!rulesEnabled("item_die") || boMode || !myItem || submittedThisRound) {
    btn.style.display = "none";
    useItemThisRound = false;
    return;
  }
  const meta = ITEM_LABEL[myItem];
  btn.style.display = "flex";
  btn.innerHTML =
    ui.icon(meta.icon) +
    (useItemThisRound ? `${meta.text}:已啟動(這回合出招時會一併生效)` : `使用${meta.text}(這回合啟動，賭錯時機會浪費掉)`);
  btn.classList.toggle("active-choice", useItemThisRound);
  btn.onclick = () => {
    if (submittedThisRound) return;
    useItemThisRound = !useItemThisRound;
    render(state);
  };
}

// 假動作(進階規則):出招前先宣告「偏攻擊」或「偏防禦」，純情報，不直接影響傷害，
// 但每一回合宣告完後會跟手勢一起揭曉，唬多了容易被〈讀心值〉或對方肉眼抓到規律。
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

// 雙手出招(結構性改版):落後方整場限用1次，同時出兩個手勢，其中一個贏過對方的招就算贏
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
    const hd1 = getHandDeck(state, 1);
    const hd2 = getHandDeck(state, 2);
    let hand1 = hd1.hand;
    let deck1 = hd1.deck;
    let hand2 = hd2.hand;
    let deck2 = hd2.deck;
    let dualUsed1 = !!state.dualUsed1;
    let dualUsed2 = !!state.dualUsed2;
    const log = state.log ? [...state.log] : [];
    const m1 = state.m1;
    const m2 = state.m2;
    let lastEvent = null;
    const fieldMod = getFieldMod(state);

    // 手牌制:出過的牌從手上移除，牌堆最上面那張立刻補進同一個位置，雙手符同時出兩招要補兩張，
    // 逾時沒出招不動。炸彈不算在手牌裡。牌堆空了不會再補，手牌越打越少，等手牌也打完，
    // 那一局剩下的回合當作安全閥不再受手牌限制。
    if (rules.hand_limit) {
      if (!handExhausted(hand1)) {
        const played1 = [];
        if (m1.gesture && m1.gesture !== "bomb") played1.push(m1.gesture);
        if (m1.dual && m1.gesture2 && m1.gesture2 !== "bomb") played1.push(m1.gesture2);
        if (played1.length) {
          const result = playCardsFromHand(hand1, deck1, played1);
          hand1 = result.hand;
          deck1 = result.deck;
        }
      }
      if (!handExhausted(hand2)) {
        const played2 = [];
        if (m2.gesture && m2.gesture !== "bomb") played2.push(m2.gesture);
        if (m2.dual && m2.gesture2 && m2.gesture2 !== "bomb") played2.push(m2.gesture2);
        if (played2.length) {
          const result = playCardsFromHand(hand2, deck2, played2);
          hand2 = result.hand;
          deck2 = result.deck;
        }
      }
    }

    if (m1.ult) ult1 += 1;
    if (m2.ult) ult2 += 1;
    if (m1.dual) dualUsed1 = true;
    if (m2.dual) dualUsed2 = true;

    // 擾亂符/洞悉符/延時符:這三種是「啟動就一定生效」的道具(不像護盾符/增幅符要賭輸贏)，
    // 在回合判定之前先處理掉。擾亂符要對方那回合真的出究極手勢才擋得到，猜不中一樣浪費;
    // 洞悉符、延時符只要啟動就一定成功，用掉即消耗。
    let m1UltEffective = !!m1.ult;
    let m2UltEffective = !!m2.ult;
    let timeBoost1 = 0;
    let timeBoost2 = 0;
    let itemNote = "";
    if (rules.item_die && m2.useItem && rpsitem2 === "disrupt") {
      rpsitem2 = null;
      if (m1.ult) {
        m1UltEffective = false;
        itemNote += ` ${p2Name}的擾亂符發動，擋掉了${p1Name}的究極手勢！`;
      } else {
        itemNote += ` ${p2Name}的擾亂符撲空，對方這回合沒有用究極手勢。`;
      }
    }
    if (rules.item_die && m1.useItem && rpsitem1 === "disrupt") {
      rpsitem1 = null;
      if (m2.ult) {
        m2UltEffective = false;
        itemNote += ` ${p1Name}的擾亂符發動，擋掉了${p2Name}的究極手勢！`;
      } else {
        itemNote += ` ${p1Name}的擾亂符撲空，對方這回合沒有用究極手勢。`;
      }
    }
    if (rules.item_die && m1.useItem && rpsitem1 === "insight") {
      const theirs = rpsitem2; // 對方「這一刻」握著的道具，抓的是本回合他還沒重新抽之前的值
      rpsitem1 = null;
      itemNote += theirs
        ? ` ${p1Name}的洞悉符發動，看穿${p2Name}身上握著${ITEM_LABEL[theirs].text}！`
        : ` ${p1Name}的洞悉符發動，但${p2Name}身上目前沒有道具。`;
    }
    if (rules.item_die && m2.useItem && rpsitem2 === "insight") {
      const theirs = rpsitem1;
      rpsitem2 = null;
      itemNote += theirs
        ? ` ${p2Name}的洞悉符發動，看穿${p1Name}身上握著${ITEM_LABEL[theirs].text}！`
        : ` ${p2Name}的洞悉符發動，但${p1Name}身上目前沒有道具。`;
    }
    if (rules.item_die && m1.useItem && rpsitem1 === "delay") {
      rpsitem1 = null;
      timeBoost1 = 15;
      itemNote += ` ${p1Name}的延時符發動，下一回合思考時間 +15 秒。`;
    }
    if (rules.item_die && m2.useItem && rpsitem2 === "delay") {
      rpsitem2 = null;
      timeBoost2 = 15;
      itemNote += ` ${p2Name}的延時符發動，下一回合思考時間 +15 秒。`;
    }

    let winnerSlot = null;
    let winGesture = null;
    let judgement = null;
    const g1Text = m1.dual && m1.gesture2 ? `${GESTURE_NAME[m1.gesture]}+${GESTURE_NAME[m1.gesture2]}(雙手符)` : m1.gesture ? GESTURE_NAME[m1.gesture] : "逾時未出招";
    const g2Text = m2.dual && m2.gesture2 ? `${GESTURE_NAME[m2.gesture]}+${GESTURE_NAME[m2.gesture2]}(雙手符)` : m2.gesture ? GESTURE_NAME[m2.gesture] : "逾時未出招";
    let entry = `第${state.round}回合:${p1Name} 出了 ${g1Text},${p2Name} 出了 ${g2Text}。${itemNote}`;

    if (m1.stance || m2.stance) {
      const parts = [];
      if (m1.stance && STANCE_LABEL[m1.stance]) parts.push(`${p1Name}宣告「${STANCE_LABEL[m1.stance].text}」`);
      if (m2.stance && STANCE_LABEL[m2.stance]) parts.push(`${p2Name}宣告「${STANCE_LABEL[m2.stance].text}」`);
      if (parts.length) entry += parts.join(",") + "。";
    }

    if (!m1.gesture && !m2.gesture) {
      entry += "雙方都逾時，平手，不掉血。";
      lastEvent = { type: "timeout_both" };
      streak1 = 0;
      streak2 = 0;
    } else if (!m1.gesture) {
      winnerSlot = 2;
      winGesture = m2.gesture;
      entry += `${p1Name}逾時未出招，${p2Name}直接獲勝。`;
    } else if (!m2.gesture) {
      winnerSlot = 1;
      winGesture = m1.gesture;
      entry += `${p2Name}逾時未出招，${p1Name}直接獲勝。`;
    } else if (m1UltEffective && m2UltEffective) {
      entry += "雙方都使出究極手勢，強強相抵，平手。";
      lastEvent = { type: "tie" };
    } else if (m1UltEffective) {
      winnerSlot = 1;
      winGesture = m1.gesture;
      entry += `${p1Name}使出究極手勢，直接獲勝！`;
    } else if (m2UltEffective) {
      winnerSlot = 2;
      winGesture = m2.gesture;
      entry += `${p2Name}使出究極手勢，直接獲勝！`;
    } else {
      judgement = judgeRound(m1, m2);
      if (judgement.winnerSlot === null) {
        entry += judgement.bombDefused ? flavorFor(judgement, "") : judgement.bothBomb ? "雙方同時扔出炸彈，喀啦——兩顆一起被炸開，平手不掉血。" : "出了相同的手勢，平手。";
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

    // 這回合沒有分出勝負(平手/雙方究極手勢互抵/雙方同時扔炸彈)的話，這回合啟動的護盾符/增幅符沒有對象可以生效，直接浪費掉
    if (rules.item_die && !boMode && !winnerSlot) {
      if (m1.useItem && (rpsitem1 === "shield" || rpsitem1 === "amp")) {
        entry += ` ${p1Name}啟動了${ITEM_LABEL[rpsitem1].text}，但這回合沒有分出勝負，浪費掉了。`;
        rpsitem1 = null;
      }
      if (m2.useItem && (rpsitem2 === "shield" || rpsitem2 === "amp")) {
        entry += ` ${p2Name}啟動了${ITEM_LABEL[rpsitem2].text}，但這回合沒有分出勝負，浪費掉了。`;
        rpsitem2 = null;
      }
    }

    // 手勢突變 / 讀心值 用的統計資料，不管這回合誰贏都要更新(逾時的那一方不算數)
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

    // 讀心值:用「這回合開始前」的舊統計去判斷輸家這回合是不是又出了他最常出的那招，
    // 猜中才加分，所以要在把這回合的手勢計入統計「之前」先判斷完
    let mindreadBonus = 0;
    if (rules.mindread && winnerSlot) {
      const loserSlot = winnerSlot === 1 ? 2 : 1;
      const loserGesture = loserSlot === 1 ? m1.gesture : m2.gesture;
      const loserPreCounts = loserSlot === 1 ? gestureCount1 : gestureCount2;
      const topGesture = mostFrequentGesture(loserPreCounts);
      if (topGesture && loserGesture === topGesture) {
        entry += ` ${winnerSlot === 1 ? p1Name : p2Name}剋中了對方最常出的${GESTURE_NAME[topGesture]}，讀心成功！`;
        mindreadBonus = 1;
      }
    }
    if (rules.mindread) {
      if (m1.gesture) gestureCount1 = bumpCount(gestureCount1, m1.gesture);
      if (m2.gesture) gestureCount2 = bumpCount(gestureCount2, m2.gesture);
    }

    // 道具符(每3回合各自隨機拿一個新的，還握著沒用掉的話不會被換掉)。
    // 護盾符/增幅符是靠傷害運作的，BO制沒有傷害概念，所以BO制底下不發放這兩種道具。
    // 三種道具都要玩家自己選擇要不要在該回合啟動(出招時勾選「使用道具」)，不是像以前自動觸發:
    // 護盾符要在啟動的那回合輸了才擋傷害、增幅符要贏了才加傷害、擾亂符要對方那回合出究極手勢才擋得到——
    // 賭錯時機就等於白白浪費掉，沒啟動的話會一直留在手上，等你想用的時候再用。
    if (rules.item_die && !boMode && itemEligibleRound(state.round)) {
      if (!rpsitem1) {
        rpsitem1 = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
        entry += ` ${p1Name}獲得${ITEM_LABEL[rpsitem1].text}。`;
      }
      if (!rpsitem2) {
        rpsitem2 = ITEM_TYPES[Math.floor(Math.random() * ITEM_TYPES.length)];
        entry += ` ${p2Name}獲得${ITEM_LABEL[rpsitem2].text}。`;
      }
    }
    if (m1.gesture) lastGesture1 = m1.gesture;
    if (m2.gesture) lastGesture2 = m2.gesture;

    if (winnerSlot && !boMode) {
      const loserSlot = winnerSlot === 1 ? 2 : 1;
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      const loserName = winnerSlot === 1 ? p2Name : p1Name;
      const winnerHp = winnerSlot === 1 ? hp1 : hp2;
      // HP 上限調整為 15(2026/08，配合傷害數值一起調，讓一場對戰平均落在5~10回合結束，
      // 不用再打到30+回合)。低血雙倍傷害的門檻等比例(原本30血制的≤9，約三成血)換算成 ≤5。
      let dmg = winnerHp <= 5 ? 4 : 2;
      let doubled = winnerHp <= 5;
      // 場地規則「磐石戰場」:靠石頭贏的那一擊，傷害再 +1
      if (fieldMod === "rock_boost" && winGesture === "rock") dmg += 1;

      // 氣勢系統:連勝續航加成 / 背水一戰翻盤加倍(用這回合開始前的連勝連敗數字判斷)
      const prevWinnerStreak = winnerSlot === 1 ? streak1 : streak2;
      const prevLoserStreak = loserSlot === 1 ? streak1 : streak2;
      if (rules.momentum) {
        if (prevWinnerStreak >= MOMENTUM_STREAK_BONUS) {
          dmg += 1;
          entry += ` ${winnerName}氣勢正旺(連勝${prevWinnerStreak}局)，追加 1 點傷害。`;
        }
        if (prevWinnerStreak <= -MOMENTUM_COMEBACK) {
          dmg *= 2;
          doubled = true;
          entry += ` ${winnerName}背水一戰(連敗${-prevWinnerStreak}局後逆轉)，傷害直接翻倍！`;
        }
      }

      // 連段技:連續用同一手勢獲勝滿3局，額外+2傷害
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
          entry += ` 連段技發動！連續${continuedStreak}局用${GESTURE_NAME[winGesture]}獲勝，額外 +2 傷害。`;
        }
      }

      // 讀心值加成(上面已經判斷過是否命中，這裡只補傷害數字)
      if (mindreadBonus) dmg += mindreadBonus;

      // 道具符:增幅符(獲勝方這回合有啟動時)/ 護盾符(落敗方這回合有啟動時，直接免傷)。
      // 手上握著的道具類型跟這回合結果對不上(例如啟動了護盾符結果自己贏了)，一樣直接浪費掉，
      // 賭錯時機就是要付出代價，這樣才有意義去猜「這回合我會贏還是輸」再決定要不要啟動。
      let shieldBlocked = false;
      const loserItem = loserSlot === 1 ? rpsitem1 : rpsitem2;
      const winnerItem = winnerSlot === 1 ? rpsitem1 : rpsitem2;
      const winnerUsedItem = winnerSlot === 1 ? !!m1.useItem : !!m2.useItem;
      const loserUsedItem = loserSlot === 1 ? !!m1.useItem : !!m2.useItem;
      if (rules.item_die && winnerUsedItem && winnerItem === "amp") {
        dmg += 2;
        entry += ` ${winnerName}的增幅符發動，追加 2 點傷害！`;
        if (winnerSlot === 1) rpsitem1 = null;
        else rpsitem2 = null;
      } else if (rules.item_die && winnerUsedItem && winnerItem) {
        entry += ` ${winnerName}啟動了${ITEM_LABEL[winnerItem].text}，但這回合用不上，浪費掉了。`;
        if (winnerSlot === 1) rpsitem1 = null;
        else rpsitem2 = null;
      }
      if (rules.item_die && loserUsedItem && loserItem === "shield") {
        shieldBlocked = true;
        dmg = 0;
        entry += ` ${loserName}的護盾符擋下了這次攻擊，毫髮無傷！`;
        if (loserSlot === 1) rpsitem1 = null;
        else rpsitem2 = null;
      } else if (rules.item_die && loserUsedItem && loserItem) {
        entry += ` ${loserName}啟動了${ITEM_LABEL[loserItem].text}，但這回合用不上，浪費掉了。`;
        if (loserSlot === 1) rpsitem1 = null;
        else rpsitem2 = null;
      }

      const hpBefore = loserSlot === 1 ? hp1 : hp2;
      if (loserSlot === 1) hp1 -= dmg;
      else hp2 -= dmg;
      const hpAfter = loserSlot === 1 ? hp1 : hp2;
      if (!shieldBlocked) {
        entry += `${loserName}扣 ${dmg} 血${doubled && dmg > 0 ? "(傷害加倍！)" : ""}(${hpBefore}→${Math.max(hpAfter, 0)})。`;
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
      // BO制:不算傷害，直接把這回合算一分，拿到3分的一方贏得整場對戰
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      if (winnerSlot === 1) games1 += 1;
      else games2 += 1;
      entry += `${winnerName}拿下這一分！比分 ${games1}:${games2}。`;
      lastEvent = { type: "bo_point", winnerSlot, games1, games2 };
      if (games1 === 2 && games2 === 2) {
        entry += " 賽末點！";
      }
    }
    // 完整戰報(出了什麼手勢、對方出了什麼、發生了什麼)固定寫進 log，戰況小字看得到完整內容;
    // 大字戰況只顯示結果(battle-view.js 的 buildHeadline() 自己組簡短文字)，這裡不用再組一份。
    log.push(entry);

    if (boMode) {
      // BO制沒有「單局血量歸零」這一層，round每算完一分就直接檢查整場賽果
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
      timeBoost1,
      timeBoost2,
      hand1,
      hand2,
      deck1,
      deck2,
      dualUsed1,
      dualUsed2,
    };

    if (!gameOver) {
      // 這局還沒分出勝負，正常進下一回合
      const newState = { ...state, hp1, hp2, ult1, ult2, log, lastEvent, round: state.round + 1, m1: null, m2: null, ...commonFields };
      await db.updateMatchState(matchId, { state: newState });
    } else {
      // 一般場BO3(先取得2局勝利)、總冠軍賽BO5(先取得3局勝利)，這局分出勝負了，
      // 但要先取得目標局數勝利才是整場對戰結束
      const winsNeeded = gamesToWin(match);
      const gameWinnerSlot = hp1 <= 0 ? 2 : 1;
      games1 = games1 + (gameWinnerSlot === 1 ? 1 : 0);
      games2 = games2 + (gameWinnerSlot === 2 ? 1 : 0);
      const gameNum = state.game || 1;
      const gameWinnerName = gameWinnerSlot === 1 ? p1Name : p2Name;
      log.push(`第${gameNum}局結束，${gameWinnerName}拿下這局！系列賽比分 ${games1}:${games2}。`);

      const seriesOver = games1 >= winsNeeded || games2 >= winsNeeded;
      const seriesEvent = { type: "series_game_over", winnerSlot: gameWinnerSlot, gameNum, games1, games2 };

      if (seriesOver) {
        const newState = { ...state, hp1, hp2, ult1, ult2, log, lastEvent: seriesEvent, round: state.round + 1, games1, games2, m1: null, m2: null, ...commonFields };
        await db.updateMatchState(matchId, { state: newState });

        const finalWinnerSlot = games1 >= winsNeeded ? 1 : 2;
        const winnerId = finalWinnerSlot === 1 ? match.player1_id : match.player2_id;
        const loserId = finalWinnerSlot === 1 ? match.player2_id : match.player1_id;
        await db.advanceAfterMatch(match, winnerId, loserId);
      } else {
        if (games1 === winsNeeded - 1 && games2 === winsNeeded - 1) log.push("賽末點！下一局就會分出整場對戰的勝負。");
        // 系列賽還沒結束，血量全部回滿，開下一局(道具/連段/氣勢/雙手符額度也跟著這一局重新開始，
        // 但手勢突變、讀心值統計、逾時代打這些是看整場對戰習慣，所以不用重置)
        const newState = {
          ...state,
          hp1: 15,
          hp2: 15,
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
          timeBoost1: 0,
          timeBoost2: 0,
          hand1: null,
          hand2: null,
          deck1: null,
          deck2: null,
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

// 對戰結束後，不管你是剛贏的選手還是純觀戰，自動帶你去看贏家的下一場，不用手動點觀戰
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
  const winnerId = (state.games1 || 0) >= seriesWinsNeeded() ? match.player1_id : match.player2_id;
  if (!winnerId) return;
  try {
    const winnerPart = await db.getMyParticipant(eventId, winnerId);
    if (winnerPart && winnerPart.status === "matched" && winnerPart.match_id && winnerPart.match_id !== matchId) {
      autoFollowTriggered = true;
      const hint = document.getElementById("game-status");
      if (hint) {
        hint.innerHTML = mySlot
          ? ui.icon("trophy") + "你贏了！正在前往下一場..."
          : ui.icon("eye") + "這場結束了，正在前往下一場...";
      }
      setTimeout(() => {
        location.href = `rps5.html?match=${winnerPart.match_id}&event=${eventId}`;
      }, 2500);
    }
  } catch (e) {}
}

// 我自己一進到這個對戰畫面，超過1分鐘對手還沒入場的話，就由我這邊自動幫對手出招，讓對戰照樣打下去
// 對手之後如果自己進場了，會偵測到並把控制權交還給他自己
// 如果對手是主辦人自己加的測試機器人(is_bot)，不用等這1分鐘的猶豫期——機器人本來就不會真的
// 有人操作，等滿1分鐘只是讓主辦人一個人測試的時候白白多等，改成幾秒後就直接開始代打。
const BOT_ENTRY_TIMEOUT_MS = 3000;
async function checkEntryTimeout() {
  if (!mySlot || !match) return;
  if (match.status !== "active" || !match.activated_at) return;
  const meEntered = mySlot === 1 ? match.p1_entered_at : match.p2_entered_at;
  if (!meEntered) return;
  const oppSlot = mySlot === 1 ? 2 : 1;
  const oppEntered = mySlot === 1 ? match.p2_entered_at : match.p1_entered_at;
  if (oppEntered) {
    if (autopilotSlot === oppSlot) {
      autopilotSlot = null; // 對手自己進場了，交還控制權
      clearAutopilotTimer();
    }
    return;
  }
  if (autopilotSlot === oppSlot) return; // 已經在幫他代打了
  const oppIsBot = !!(oppSlot === 1 ? match.p1?.is_bot : match.p2?.is_bot);
  const timeoutMs = oppIsBot ? BOT_ENTRY_TIMEOUT_MS : ENTRY_TIMEOUT_MS;
  const elapsed = Date.now() - new Date(match.activated_at).getTime();
  if (elapsed < timeoutMs) return;
  autopilotSlot = oppSlot;
  if (!autopilotAnnounced) {
    autopilotAnnounced = true;
    const oppName = oppSlot === 1 ? match.p1?.name : match.p2?.name;
    const msg = oppIsBot
      ? `${oppName || "測試機器人"} 是測試用機器人，接下來每回合會隨機出手勢應戰(不會用究極手勢)。`
      : `${oppName || "對手"} 超過1分鐘沒有進入對戰畫面，系統開始自動幫他出招(逾時判定，不會使用究極手勢)，他隨時進場都能接手。`;
    db.appendMatchLog(matchId, msg).catch(() => {});
  }
}

// 代打:輪到被代打的那位時，幫他判定逾時(等同沒出手勢，直接輸掉該局)
// 注意:不能一偵測到「這回合還沒代打」就立刻送出逾時，否則等於跳過這回合原本該有的
// 30/45秒思考時間——玩家出招那瞬間觸發的 refresh 會馬上幫對手送出逾時，變成「秒贏」。
// 改成:每個新回合只排一次計時器，時間到了才真的送出，且送出前重新跟資料庫確認這回合
// 依然沒人代打過、也還沒結束，避免跟其他分頁重複送出或送到舊回合。
let autopilotTimer = null;
let autopilotTimerRoundKey = null;

function clearAutopilotTimer() {
  if (autopilotTimer) clearTimeout(autopilotTimer);
  autopilotTimer = null;
  autopilotTimerRoundKey = null;
}

function maybeAutopilotSubmit() {
  if (!autopilotSlot || !match) return;
  if (match.status !== "active") return;
  const state = match.state;
  if (!state || seriesDecided(state)) {
    clearAutopilotTimer();
    return;
  }
  const already = autopilotSlot === 1 ? state.m1 : state.m2;
  if (already) {
    clearAutopilotTimer();
    return;
  }

  const roundKey = `${state.game || 1}-${state.round}`;
  if (autopilotTimerRoundKey === roundKey) return; // 這回合已經排過計時器了，不要重排

  clearAutopilotTimer();
  autopilotTimerRoundKey = roundKey;
  // 對手是測試機器人的話，每回合也不用等滿30/45秒，縮短成幾秒，讓主辦人一個人測試時
  // 可以很快把整場BO5跑完，不用每回合都乾等對手根本不存在的思考時間。
  const oppIsBot = !!(autopilotSlot === 1 ? match.p1?.is_bot : match.p2?.is_bot);
  const myTimeBoost = (autopilotSlot === 1 ? state.timeBoost1 : state.timeBoost2) || 0;
  const roundTimeoutMs = oppIsBot ? BOT_ENTRY_TIMEOUT_MS : (getFieldMod(state) === "fast_timer" ? 30000 : 45000) + myTimeBoost * 1000;
  autopilotTimer = setTimeout(async () => {
    autopilotTimer = null;
    try {
      const latest = await db.getMatchSafe(matchId);
      if (!latest || latest.status !== "active") return;
      const st = latest.state;
      if (!st || seriesDecided(st)) return;
      const stillMissing = autopilotSlot === 1 ? !st.m1 : !st.m2;
      const sameRound = `${st.game || 1}-${st.round}` === roundKey;
      if (stillMissing && sameRound) {
        if (oppIsBot) {
          // 機器人要真的出手勢，不是每回合都判逾時輸掉——不然主辦人永遠贏、根本測不到
          // 手勢對戰、炸彈、連段這些真正的遊戲機制。隨機挑一個手勢(炸彈有開放時也有機率選到)，
          // 究極手勢不用，維持機器人「弱但會出招」的定位，讓對戰過程比較好測。
          const gestures = GESTURE_ORDER.slice();
          if (bombAvailable(st)) gestures.push("bomb");
          const gesture = gestures[Math.floor(Math.random() * gestures.length)];
          await db.submitMove(matchId, autopilotSlot, { gesture, ult: false, timeout: false });
        } else {
          await db.submitMove(matchId, autopilotSlot, { gesture: null, ult: false, timeout: true });
        }
      }
    } catch (e) {}
  }, roundTimeoutMs);
}

async function refresh() {
  const myGen = ++refreshGen;
  const m = await db.getMatchSafe(matchId);
  if (myGen !== refreshGen) return; // 這段等待期間又有更新的一次refresh了，這次的結果已經過期，不要套用
  if (!m) {
    if (!goneAway) {
      goneAway = true;
      await ui.alert("這場對戰已經不存在了(活動可能已被刪除)，帶你回首頁。", {
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
    useItemThisRound = false;
    dualActive = false;
    dualPicks = [];
  }
  render(state);
  resolveRoundIfReady(state);
  maybeAutoAdvance(state);
  maybeAutopilotSubmit();
}

// realtime事件密集連續觸發時(例如雙方幾乎同時出招、道具連鎖觸發)，把短時間內的好幾次通知
// 合併成一次真正的refresh，不要每筆變化都各自觸發一次重新抓取+重新render。
function scheduleRefresh() {
  if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
  refreshDebounceTimer = setTimeout(() => {
    refreshDebounceTimer = null;
    refresh();
  }, 120);
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

// 手勢按鈕每次 render 都重建:因為「炸彈這回合有沒有開放」「手勢突變擋掉哪一招」「手牌還剩幾張」是每回合可能變的
function renderAndBindChoiceButtons(state) {
  let gestures = GESTURE_ORDER.slice();
  if (bombAvailable(state)) gestures.push("bomb");
  const blocked = mutationBlockedGesture(state, mySlot);

  // 手牌制:出招按鈕改成顯示自己手上實際的幾張卡(不是5個手勢類型各一顆按鈕)，卡片式呈現，
  // 只看得到自己的手牌(跟道具符「對手看不到你持有什麼」是同一套隱藏資訊原則)。
  // 手牌整副打完的話(安全閥)不再受限，直接退回原本5選1(+炸彈)的按鈕呈現，自由選擇。
  const handLimitOn = rulesEnabled("hand_limit");
  const myHandInfo = handLimitOn ? getHandDeck(state, mySlot) : null;
  const cardMode = handLimitOn && myHandInfo && !handExhausted(myHandInfo.hand);

  const deckNote = document.getElementById("deck-note");
  if (deckNote) {
    if (cardMode) {
      deckNote.style.display = "flex";
      deckNote.innerHTML = ui.icon("layers", { size: "14px" }) + `牌堆剩 ${myHandInfo.deck.length} 張`;
    } else {
      deckNote.style.display = "none";
    }
  }

  const box = document.getElementById("choice-row");
  box.classList.toggle("card-mode", cardMode);

  const makeHtml = (g, i) => {
    const isBlocked = g === blocked;
    const isPicked = dualActive ? dualPicks.includes(g) : false;
    const cls = `choice-btn${cardMode ? " card" : ""} g-${g}${g === "bomb" ? " bomb" : ""}${isPicked ? " picked" : ""}`;
    return `<button class="${cls}" data-g="${g}" data-idx="${i}" ${
      isBlocked ? 'disabled title="連續出太多次同一招，這回合系統把它鎖住了"' : ""
    }>${ui.icon(GESTURE_ICON[g])}<span class="lbl">${GESTURE_NAME[g]}</span></button>`;
  };

  let html;
  if (cardMode) {
    const cardGestures = myHandInfo.hand.slice();
    if (bombAvailable(state)) cardGestures.push("bomb");
    html = cardGestures.map(makeHtml).join("");
  } else {
    html = gestures.map(makeHtml).join("");
  }

  // 完全沒有動畫了，所以整排重建不會有任何視覺跳動/閃爍的副作用。反過來說，只要
  // 內容跟現在畫面上的一模一樣，也不用白白重建一次(省一點事、不會打斷正在hover的滑鼠等)。
  // 直接拿這次要顯示的HTML內容整組比對，內容不同才整個換掉，不再做「同一格是不是同一張卡」
  // 這種逐格猜測——猜錯就會有卡片卡住不消失、或該出現的新卡沒出現的問題。
  const signature = (cardMode ? "card" : "plain") + "|" + html;
  if (box.dataset.sig !== signature) {
    box.dataset.sig = signature;
    box.innerHTML = html;
  }

  const mutationHint = document.getElementById("mutation-hint");
  if (mutationHint) {
    if (blocked) {
      mutationHint.style.display = "block";
      mutationHint.innerHTML = ui.icon("shuffle") + `連續出太多次${GESTURE_NAME[blocked]}了，這回合系統把它鎖住，逼你換一招！`;
    } else {
      mutationHint.style.display = "none";
    }
  }

  // .onclick只是重新指派JS屬性，不會動到DOM，所以每次都可以放心重新綁，
  // 確保綁定的是這次最新的state，不會有拿到舊資料的問題。
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
            useItem: useItemThisRound,
          });
        } else {
          render(state);
        }
        return;
      }

      submittedThisRound = true;
      clearInterval(timerInterval);
      battleView.announce(`你使出了${GESTURE_NAME[gesture]}!`, { icon: GESTURE_ICON[gesture] });
      await db.submitMove(matchId, mySlot, { gesture, ult: useUlt, timeout: false, stance: feintStance, useItem: useItemThisRound });
      useUlt = false;
    };
  });
}

function bindControls() {
  document.getElementById("ult-btn").innerHTML = ui.icon("zap") + "使出究極手勢(保證獲勝該回合)";
  document.getElementById("ult-btn").onclick = () => {
    if (dualActive) return;
    useUlt = !useUlt;
    if (useUlt) battleView.announce("你準備使出究極手勢！", { icon: "zap" });
    refresh();
  };
}

// 跟 dice.js 共用同一套「基礎規則 + 本場額外開啟的機制」呈現方式，說明文字盡量跟 rules.html 的用詞一致
const RULE_EXPLAIN = {
  // 剋制關係已經整合進 renderRules() 的基礎規則段落，這裡只保留「什麼時候會開放炸彈」的說明
  bomb: "第 3 回合起，每回合約有 15% 機率額外開放這隻隱藏手勢，開放時選擇列會多一個「炸彈」選項可以選。",
  field_mod: "開局隨機決定這一局固定生效的特殊效果，3 選 1:磐石戰場(靠石頭獲勝時傷害+1)、手速戰場(究極手勢這局可用2次)、疾風戰場(思考時間縮短到30秒)。",
  item_die:
    '每 3 回合雙方各自隨機拿到一個道具，只有自己看得到是哪一種(對手畫面上只會看到你「持有神秘道具」，不知道實際是什麼)。持有到你自己選擇要不要在某一回合啟動才會生效，猜錯時機一樣會浪費掉:' +
    '<ul class="rule-item-list">' +
    "<li><b>護盾符</b>:啟動的那回合輸了免傷</li>" +
    "<li><b>增幅符</b>:啟動的那回合贏了 +2 傷害</li>" +
    "<li><b>擾亂符</b>:啟動的那回合能擋掉對方那回合的究極手勢(對方沒用究極手勢就浪費掉)</li>" +
    "<li><b>洞悉符</b>:啟動當下立刻看穿對方目前握著的道具是什麼(一定成功)</li>" +
    "<li><b>延時符</b>:啟動後下一回合思考時間 +15 秒(一定成功)</li>" +
    "</ul>" +
    "開啟「BO制」時，這五種道具都不會發放(靠傷害/究極手勢/計時運作，BO制沒有這些概念)。",
  stance: "出招前可以先公開宣告這局「偏攻擊」或「偏防禦」，純粹是情報，不會直接影響傷害，對方看得到但不知道真假;宣告會跟手勢一起在戰報揭曉，唬多了容易被〈讀心值〉或對方肉眼抓到規律。",
  combo: "系統會記錄你最近用哪個手勢獲勝。連續 3 局都用同一手勢獲勝，額外 +2 傷害，並跳出「連段技發動！」;之後繼續用同一招連勝下去，每一局都會持續拿到加成。要不要賭一把繼續出同一招，風險自負。",
  mindread: "系統偷偷統計對方整場出招的習慣分布，如果你選中「剋制對方最常出的那招」並獲勝，額外 +1 傷害，並跳出「讀心成功！」。開啟這項規則時，對戰畫面也會顯示對方的即時出招傾向統計，觀眾也看得到同一份統計。",
  momentum: "連勝 2 局起，下一擊額外 +1 傷害，氣勢會一直維持到輸掉一局為止;連續落敗 2 局後，如果靠獲勝逆轉，那一擊的傷害會直接翻倍(背水一戰)。",
  mutation: "連續 3 回合都出同一個手勢，下一回合系統會把那個手勢從選項裡鎖住，逼你換一招，防止靠「無腦一直出同一招」硬撐。",
  hand_limit:
    "整局(每進新一局重新洗牌發牌)把 18 張手勢牌洗好:石頭/布/剪刀各 4 張、蜥蜴/史波克各 3 張，固定發前 4 張當手牌，出招畫面會用卡片方式呈現。出一張少一張，出的那張立刻從牌堆最上面補一張新的到手上(不是重新隨機抽，是照洗好的固定順序發，不會連續補到好幾張一樣的)，只看得到自己的手牌、看不到對方剩什麼。炸彈(隱藏第六手勢)不算在手牌裡，機率照常隨機開放;究極手勢底層還是要選一個普通手勢，那張牌一樣算打出去、要補新的。牌堆抽完之後，打出的牌不會再補新的，手牌會越打越少，等手牌也打完，那一局剩下的回合會解除限制、改回自由選擇。開啟這項規則時，手勢突變會自動停用(手牌本身就限制了連續出招次數，兩個規則同時存在意義重疊)。",
  bo_mode: "整場對戰拋開 HP 累加機制，改成每回合直接分出這一分的勝負，率先取得 3 分的一方贏得整場;打到 2:2 時觸發「賽末點！」提示。以下基礎規則裡跟 HP / 局數相關的敘述，本場一律不適用。",
  dual_hand: "落後的一方整場限用 1 次「雙手符」，可以同時出兩個手勢，只要其中一個贏過對方的招就算贏。觸發資格:HP 制下自己 HP ≤8 才能使用;BO制下自己的局分落後對方才能使用。限用 1 次，是殘局翻盤手段，不會變成必勝招。",
};

function renderRules() {
  const box = document.getElementById("rule-content");
  const rules = (event && event.rules) || {};
  const isFinal = match && match.bracket === "final";
  const need = gamesToWin(match); // 一般場 2(BO3)，總冠軍賽 3(BO5)
  const maxGame = need * 2 - 1;
  const bombOn = !!rules.bomb;
  let html = `
    <p>採 BO${maxGame} 賽制${isFinal ? "(總冠軍賽賽制較長，更有份量)" : ""}:雙方各有 15 點 HP，先讓對方 HP 歸零的人拿下這一局;率先拿下 ${need} 局的人贏得整場對戰(最多打到第 ${maxGame} 局)。每進入新一局，雙方 HP 會全部回滿。</p>
    <p>每回合 45 秒內選一個手勢:石頭 / 布 / 剪刀 / 蜥蜴 / 史波克${bombOn ? "(本場另有機率額外開放隱藏手勢「炸彈」，見下方說明)" : ""}。超時未選視為該回合落敗，雙方都超時則平手不掉血。</p>
    <p>石頭勝剪刀、蜥蜴;布勝石頭、史波克;剪刀勝布、蜥蜴;蜥蜴勝史波克、布;史波克勝剪刀、石頭。出了相同的手勢就是平手。${
      bombOn ? "本場額外開放的「炸彈」:炸彈 勝 石頭、剪刀;炸彈 敗 布、蜥蜴;炸彈 對 史波克 是特殊平局，雙方不掉血。" : ""
    }</p>
    <p>每人每一局都有 1 張「究極手勢」卡:出牌保證獲勝該回合，除非對方同一回合也出究極手勢，此時雙方抵銷、判定平手。</p>
    <p>當你的 HP ≤5 時，獲勝的那一擊傷害會翻倍，適合絕地反擊。系列賽打到 ${need - 1}:${need - 1} 時會有「賽末點」提示。</p>
    <p>每一場對決，系統都會依照實際出的手勢組合寫出對應的戰報敘述，不是死板的「X勝過Y」。</p>
  `;
  const active = Object.keys(rules).filter((k) => rules[k] && RULE_EXPLAIN[k]);
  if (active.length) {
    html += `<h4>本場活動額外開啟的機制</h4>`;
    active.forEach((k) => {
      const meta = ui.RULE[k];
      if (meta) {
        html += `<div class="rule-item"><b style="color:var(--ink);">${ui.icon(meta.icon)} ${meta.label}</b><div class="rule-item-body">${RULE_EXPLAIN[k]}</div></div>`;
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
    showStatus: false, // 這頁自己的 #game-status 已經處理狀態文字，不要顯示兩份
  });
  bindControls();
  bindRuleModal();
  await refresh();
  unsub = db.onTableChange("matches", `id=eq.${matchId}`, () => scheduleRefresh());
  unsubParticipants = db.onTableChange("event_participants", `event_id=eq.${eventId}`, () => scheduleRefresh());
  entryWatchdog = setInterval(() => {
    checkEntryTimeout();
    maybeAutopilotSubmit();
  }, 5000);
})();

window.addEventListener("beforeunload", () => {
  db.cancelAllRequests();
  if (refreshDebounceTimer) clearTimeout(refreshDebounceTimer);
  if (unsub) unsub();
  if (unsubParticipants) unsubParticipants();
  if (battleView) battleView.destroy();
  if (entryWatchdog) clearInterval(entryWatchdog);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});
