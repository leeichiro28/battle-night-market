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
const GESTURE_ICON = { rock: "🪨", paper: "📄", scissors: "✂️", lizard: "🦎", spock: "🖖" };

let match = null;
let mySlot = null;
let submittedThisRound = false;
let useUlt = false;
let resolving = false;
let unsub = null;
let timerInterval = null;
let currentRoundKey = null;

const CIRC = 289;

function ringUpdate(el, hp, maxHp) {
  const ratio = Math.max(hp, 0) / maxHp;
  el.setAttribute("stroke-dashoffset", CIRC * (1 - ratio));
  el.setAttribute("stroke", hp <= maxHp * 0.25 ? "#E5484D" : hp <= maxHp * 0.5 ? "#F2B705" : "#3DBE6C");
}

function appendLogLines(log) {
  const box = document.getElementById("log");
  box.innerHTML = (log || []).map((l) => `<div>${l}</div>`).join("");
  box.scrollTop = box.scrollHeight;
}

function startTimer(state) {
  const roundKey = state.round + "-" + mySlot;
  if (currentRoundKey === roundKey) return; // 已經在跑這回合的計時器
  currentRoundKey = roundKey;
  clearInterval(timerInterval);
  if (submittedThisRound || state.hp1 <= 0 || state.hp2 <= 0) return;

  let timeLeft = 3000;
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
        await db.submitMove(matchId, mySlot, { gesture: null, ult: false, timeout: true });
      }
    }
  }, 60);
}

function render(state) {
  document.getElementById("p1-name").textContent = match.p1?.name || "玩家一";
  document.getElementById("p2-name").textContent = match.p2?.name || "玩家二";
  document.getElementById("p1-hp").textContent = Math.max(state.hp1, 0);
  document.getElementById("p2-hp").textContent = Math.max(state.hp2, 0);
  ringUpdate(document.getElementById("p1-ring"), state.hp1, 10);
  ringUpdate(document.getElementById("p2-ring"), state.hp2, 10);
  document.getElementById("round-num").textContent = "R" + state.round;
  appendLogLines(state.log);

  const myUltUsed = mySlot === 1 ? state.ult1 : state.ult2;
  const ultBtn = document.getElementById("ult-btn");
  ultBtn.textContent = myUltUsed
    ? "⚡ 究極手勢已使用"
    : useUlt
    ? "⚡ 究極手勢:已啟動(選一個手勢送出即可保證獲勝)"
    : "⚡ 使出究極手勢(尚未使用,保證獲勝該回合)";
  ultBtn.disabled = !!myUltUsed || submittedThisRound;

  const statusEl = document.getElementById("game-status");
  const choiceBtns = document.querySelectorAll(".choice-btn");

  if (state.hp1 <= 0 || state.hp2 <= 0) {
    document.getElementById("choice-row").style.display = "none";
    ultBtn.style.display = "none";
    document.getElementById("timer-fill").style.width = "0%";
    const iWon = (mySlot === 1 && state.hp2 <= 0) || (mySlot === 2 && state.hp1 <= 0);
    statusEl.innerHTML = iWon
      ? "🏆 你贏了這場對戰!回等候室看看有沒有下一位挑戰者"
      : "💀 你被擊敗了,感謝參戰!";
    document.getElementById("back-link").style.display = "block";
    document.getElementById("back-link").innerHTML = iWon
      ? `<a href="lobby.html?event=${eventId}">→ 回等候室,迎接下一位挑戰者</a>`
      : `<a href="lobby.html?event=${eventId}">← 查看戰況與獎勵</a>`;
    return;
  }

  choiceBtns.forEach((b) => (b.disabled = submittedThisRound));
  statusEl.textContent = submittedThisRound ? "已送出,等待對方..." : "3 秒內選一個手勢!";
  startTimer(state);
}

async function resolveRoundIfReady(state) {
  if (mySlot !== 1 || resolving) return;
  if (!state.m1 || !state.m2) return;
  resolving = true;
  try {
    let hp1 = state.hp1;
    let hp2 = state.hp2;
    let ult1 = state.ult1;
    let ult2 = state.ult2;
    const log = state.log ? [...state.log] : [];
    const m1 = state.m1;
    const m2 = state.m2;

    if (m1.ult) ult1 = true;
    if (m2.ult) ult2 = true;

    let winnerSlot = null; // null = tie
    const g1icon = m1.gesture ? GESTURE_ICON[m1.gesture] : "⌛逾時";
    const g2icon = m2.gesture ? GESTURE_ICON[m2.gesture] : "⌛逾時";
    let entry = `R${state.round}· P1${g1icon}　P2${g2icon}`;

    if (!m1.gesture && !m2.gesture) {
      entry += " → 雙方逾時,平手";
    } else if (!m1.gesture) {
      winnerSlot = 2;
      entry += " → P1逾時,P2獲勝";
    } else if (!m2.gesture) {
      winnerSlot = 1;
      entry += " → P2逾時,P1獲勝";
    } else if (m1.ult && m2.ult) {
      entry += " → 雙方都使出究極手勢,互相抵銷,平手";
    } else if (m1.ult) {
      winnerSlot = 1;
      entry += " → P1究極手勢,直接獲勝";
    } else if (m2.ult) {
      winnerSlot = 2;
      entry += " → P2究極手勢,直接獲勝";
    } else if (m1.gesture === m2.gesture) {
      entry += " → 平手";
    } else if (BEATS[m1.gesture].includes(m2.gesture)) {
      winnerSlot = 1;
      entry += " → P1獲勝";
    } else {
      winnerSlot = 2;
      entry += " → P2獲勝";
    }

    if (winnerSlot) {
      const winnerHp = winnerSlot === 1 ? hp1 : hp2;
      const dmg = winnerHp <= 3 ? 2 : 1;
      if (winnerSlot === 1) hp2 -= dmg;
      else hp1 -= dmg;
      entry += ` (扣${dmg}血${winnerHp <= 3 ? "・絕境雙倍!" : ""})`;
    }
    log.push(entry);

    const newState = {
      ...state,
      hp1,
      hp2,
      ult1,
      ult2,
      log,
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

async function refresh() {
  match = await db.getMatch(matchId);
  const local = db.getLocalPlayer();
  mySlot = match.player1_id === local.id ? 1 : 2;
  const state = match.state;
  const wasSubmitted = submittedThisRound;
  submittedThisRound = !!(mySlot === 1 ? state.m1 : state.m2);
  if (!submittedThisRound && wasSubmitted !== submittedThisRound) {
    // 進入新回合,重置究極手勢的暫存勾選(是否使用會在點擊手勢時決定)
    useUlt = false;
  }
  render(state);
  resolveRoundIfReady(state);
}

function bindControls() {
  document.getElementById("ult-btn").onclick = () => {
    useUlt = !useUlt;
    refresh();
  };
  document.querySelectorAll(".choice-btn").forEach((btn) => {
    btn.onclick = async () => {
      if (submittedThisRound) return;
      submittedThisRound = true;
      clearInterval(timerInterval);
      const gesture = btn.dataset.g;
      await db.submitMove(matchId, mySlot, { gesture, ult: useUlt, timeout: false });
      useUlt = false;
    };
  });
}

function renderRules() {
  const box = document.getElementById("rule-content");
  box.innerHTML = `
    <p>雙方各有 10 點 HP,3 秒內選一個手勢:石頭 🪨 / 布 📄 / 剪刀 ✂️ / 蜥蜴 🦎 / 史波克 🖖。超時未選視為該局落敗。</p>
    <p>石頭勝剪刀、蜥蜴;布勝石頭、史波克;剪刀勝布、蜥蜴;蜥蜴勝史波克、布;史波克勝剪刀、石頭。</p>
    <p>每人有 1 張「究極手勢」卡:出牌保證獲勝該局,除非對方同一局也出究極手勢,此時雙方抵銷、判定平手。</p>
    <p>當你的 HP ≤3 時,獲勝的那一擊傷害會翻倍,適合絕地反擊。血量先歸零者落敗。</p>
  `;
}

function bindRuleModal() {
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
  bindControls();
  bindRuleModal();
  await refresh();
  unsub = db.onTableChange("matches", `id=eq.${matchId}`, () => refresh());
})();

window.addEventListener("beforeunload", () => {
  if (unsub) unsub();
});
