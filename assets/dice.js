const qs = new URLSearchParams(location.search);
const matchId = qs.get("match");
const eventId = qs.get("event");

let match = null;
let ev = null;
let mySlot = null; // 1 | 2 | null(觀戰)
let selectedShield = false;
let selectedAllin = false;
let selectedFreebet = false;
let submittedThisRound = false;
let resolving = false;
let unsub = null;
let unsubParticipants = null;
let lastSeenRound = null;
let announceTimer = null;
let timerInterval = null;
let currentRoundKey = null;
let autoFollowTriggered = false;
let enteredMarked = false;
let autopilotSlot = null; // 對手超過1分鐘沒入場時,代替他自動出招的slot
let autopilotAnnounced = false;
let entryWatchdog = null;

const ENTRY_TIMEOUT_MS = 60000; // 超過1分鐘對手沒入場,自動開始幫他出招

const CIRC = 289;
const ROLL_TIME = 30000;
const ITEM_LABEL = { crit: "⚡爆擊", heal: "💚回血", truehit: "🎯必中", seal: "🔒封印" };
const FIELD_LABEL = { crit: "🌪️ 戰場:全場傷害+1", shield_plus: "🌪️ 戰場:防禦骰x2次" };

function announce(text, holdMs) {
  const el = document.getElementById("big-announce");
  el.textContent = text;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => el.classList.remove("show"), holdMs || 2200);
}

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

function names() {
  return [match.p1?.name || "玩家一", match.p2?.name || "玩家二"];
}

function buildHeadline(evt) {
  if (!evt) return "";
  const [p1Name, p2Name] = names();
  if (evt.type === "tie") return "⚖️ 平手!雙方各扣 1 血";
  const winnerName = evt.winnerSlot === 1 ? p1Name : p2Name;
  const loserName = evt.winnerSlot === 1 ? p2Name : p1Name;
  if (evt.shieldBlocked) {
    if (mySlot === evt.loserSlot) return `🛡️ 你觸發防禦骰,完全擋下攻擊!`;
    if (mySlot === evt.winnerSlot) return `🛡️ ${loserName} 擋下了你的攻擊!`;
    return `🛡️ ${loserName} 觸發防禦骰,擋下攻擊!`;
  }
  if (mySlot === evt.loserSlot) return `😖 你扣了 ${evt.dmg} 點血!`;
  if (mySlot === evt.winnerSlot) return `🔥 你獲勝了這回合!${loserName} 扣 ${evt.dmg} 血`;
  return `${winnerName} 獲勝!${loserName} 扣 ${evt.dmg} 血`;
}

function startTimer(state) {
  if (!mySlot || submittedThisRound || state.hp1 <= 0 || state.hp2 <= 0) return;
  const roundKey = state.round + "-" + mySlot;
  if (currentRoundKey === roundKey) return;
  currentRoundKey = roundKey;
  clearInterval(timerInterval);

  const started = Date.now();
  const fill = document.getElementById("timer-fill");
  timerInterval = setInterval(async () => {
    const elapsed = Date.now() - started;
    const pct = Math.max(0, 100 - (elapsed / ROLL_TIME) * 100);
    fill.style.width = pct + "%";
    if (elapsed >= ROLL_TIME) {
      clearInterval(timerInterval);
      if (!submittedThisRound) {
        submittedThisRound = true;
        const roll = 1 + Math.floor(Math.random() * 6);
        announce(`⌛ 思考時間到,系統幫你擲出了 ${roll} 點!`);
        await db.submitMove(matchId, mySlot, { roll, defend: false, allin: false, freebet: false });
        selectedShield = false;
        selectedAllin = false;
        selectedFreebet = false;
      }
    }
  }, 80);
}

function render(state) {
  const [p1Name, p2Name] = names();
  document.getElementById("p1-name").textContent = p1Name;
  document.getElementById("p2-name").textContent = p2Name;
  document.getElementById("p1-hp").textContent = Math.max(state.hp1, 0);
  document.getElementById("p2-hp").textContent = Math.max(state.hp2, 0);
  ringUpdate(document.getElementById("p1-ring"), state.hp1, 12);
  ringUpdate(document.getElementById("p2-ring"), state.hp2, 12);
  document.getElementById("round-num").textContent = "R" + state.round;
  appendLogLines(state.log);

  const fieldTag = document.getElementById("field-mod-tag");
  if (state.field_mod) {
    fieldTag.style.display = "inline-block";
    fieldTag.textContent = FIELD_LABEL[state.field_mod] || state.field_mod;
  } else {
    fieldTag.style.display = "none";
  }

  if (lastSeenRound !== null && state.round !== lastSeenRound) {
    const headline = buildHeadline(state.lastEvent);
    if (headline) announce(headline);
    if (mySlot && !submittedThisRound) {
      setTimeout(() => {
        if (!submittedThisRound) announce("⚔️ 輪到你了!");
      }, 2000);
    }
  }
  lastSeenRound = state.round;

  const statusEl = document.getElementById("game-status");
  const rollBtn = document.getElementById("roll-btn");
  const preRollBox = document.getElementById("pre-roll-options");

  if (state.hp1 <= 0 || state.hp2 <= 0) {
    clearInterval(timerInterval);
    document.getElementById("timer-fill").style.width = "0%";
    rollBtn.style.display = "none";
    preRollBox.style.display = "none";
    document.getElementById("rage-tag").style.display = "none";
    const winnerName = state.hp1 <= 0 ? p2Name : p1Name;
    if (!mySlot) {
      statusEl.innerHTML = `🏆 ${winnerName} 獲勝了這場對戰!`;
    } else {
      const iWon = (mySlot === 1 && state.hp2 <= 0) || (mySlot === 2 && state.hp1 <= 0);
      statusEl.innerHTML = iWon ? "🏆 你贏了這場對戰!回等候室看看下一步" : "💀 你被擊敗了,感謝參戰!";
    }
    document.getElementById("back-link").style.display = "block";
    document.getElementById("back-link").innerHTML = `<a href="lobby.html?event=${eventId}">← 回等候室查看賽況</a>`;
    return;
  }

  if (!mySlot) {
    // 觀戰模式
    preRollBox.style.display = "none";
    rollBtn.style.display = "none";
    document.getElementById("rage-tag").style.display = "none";
    document.getElementById("timer-fill").style.width = "0%";
    statusEl.innerHTML = `👀 觀戰模式・對戰進行中`;
    return;
  }

  const myShield = mySlot === 1 ? state.shield1 : state.shield2;
  const myHp = mySlot === 1 ? state.hp1 : state.hp2;
  const myFreebet = mySlot === 1 ? state.freebet1 : state.freebet2;
  const myRageReady = mySlot === 1 ? state.rageready1 : state.rageready2;

  preRollBox.style.display = "flex";
  const shieldBtn = document.getElementById("shield-toggle");
  shieldBtn.textContent =
    myShield <= 0
      ? "🛡️ 防禦骰已用完"
      : selectedShield
      ? `🛡️ 防禦骰:已啟動(剩 ${myShield} 次)`
      : `🛡️ 使用防禦骰(剩 ${myShield} 次)`;
  shieldBtn.disabled = myShield <= 0 || submittedThisRound;

  const allinBtn = document.getElementById("allin-toggle");
  if (myHp <= 5 && myHp > 0) {
    allinBtn.style.display = "inline-flex";
    allinBtn.textContent = selectedAllin ? "🔥 背水一戰:已啟動" : "🔥 背水一戰(傷害x2)";
    allinBtn.disabled = submittedThisRound;
  } else {
    allinBtn.style.display = "none";
  }

  const freebetBtn = document.getElementById("freebet-toggle");
  if (ev.rules && ev.rules.free_bet) {
    const left = 2 - (myFreebet || 0);
    freebetBtn.style.display = "inline-flex";
    freebetBtn.textContent =
      left <= 0
        ? "🎰 自由加注已用完"
        : selectedFreebet
        ? `🎰 自由加注:已啟動(剩${left}次)`
        : `🎰 自由加注(傷害x2,剩${left}次)`;
    freebetBtn.disabled = left <= 0 || submittedThisRound;
  } else {
    freebetBtn.style.display = "none";
  }

  const rageTag = document.getElementById("rage-tag");
  if (ev.rules && ev.rules.rage && myRageReady) {
    rageTag.style.display = "inline-block";
    rageTag.textContent = "🔥 怒氣已滿,下次獲勝額外+2傷害";
  } else {
    rageTag.style.display = "none";
  }

  if (submittedThisRound) {
    statusEl.textContent = "已擲出,等待對方出手...";
    rollBtn.style.display = "block";
    rollBtn.disabled = true;
    document.getElementById("timer-fill").style.width = "0%";
  } else {
    statusEl.textContent = "輪到你了,選好策略後擲骰(30秒內動作)";
    rollBtn.style.display = "block";
    rollBtn.disabled = false;
    startTimer(state);
  }
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
    let shield1 = state.shield1;
    let shield2 = state.shield2;
    let rage1 = state.rage1 || 0;
    let rage2 = state.rage2 || 0;
    let rageready1 = !!state.rageready1;
    let rageready2 = !!state.rageready2;
    let freebet1 = state.freebet1 || 0;
    let freebet2 = state.freebet2 || 0;
    const log = state.log ? [...state.log] : [];
    const m1 = state.m1;
    const m2 = state.m2;
    const rules = ev.rules || {};
    let lastEvent = null;

    let entry = `第${state.round}回合:${p1Name} 擲出 ${m1.roll} 點,${p2Name} 擲出 ${m2.roll} 點。`;

    let item1 = null;
    let item2 = null;
    if (rules.item_die && state.round % 3 === 0) {
      const items = ["crit", "heal", "truehit", "seal"];
      item1 = items[Math.floor(Math.random() * 4)];
      item2 = items[Math.floor(Math.random() * 4)];
      entry += `道具骰觸發!${p1Name}獲得${ITEM_LABEL[item1]},${p2Name}獲得${ITEM_LABEL[item2]}。`;
      if (item1 === "heal") hp1 = Math.min(12, hp1 + 2);
      if (item2 === "heal") hp2 = Math.min(12, hp2 + 2);
    }

    const diff = Math.abs(m1.roll - m2.roll);
    let loserSlot;
    if (diff === 0) {
      if (item1 === "truehit" && item2 !== "truehit") loserSlot = 2;
      else if (item2 === "truehit" && item1 !== "truehit") loserSlot = 1;
      else loserSlot = "tie";
    } else {
      loserSlot = m1.roll > m2.roll ? 2 : 1;
      if (loserSlot === 1 && item1 === "truehit") loserSlot = 2;
      else if (loserSlot === 2 && item2 === "truehit") loserSlot = 1;
    }

    if (loserSlot === "tie") {
      hp1 -= 1;
      hp2 -= 1;
      entry += `點數相同,雙方戰成平手,各扣 1 點血(${p1Name} ${state.hp1}→${hp1},${p2Name} ${state.hp2}→${hp2})。`;
      lastEvent = { type: "tie" };
    } else {
      const winnerSlot = loserSlot === 1 ? 2 : 1;
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      const loserName = loserSlot === 1 ? p1Name : p2Name;
      const allinActive = m1.allin || m2.allin;
      let dmg = diff === 0 ? 2 : diff;
      if (allinActive) dmg *= 2;
      if (state.field_mod === "crit") dmg += 1;

      const winnerItem = winnerSlot === 1 ? item1 : item2;
      if (winnerItem === "crit") dmg += 2;
      const loserItem = loserSlot === 1 ? item1 : item2;
      if (loserItem === "seal") dmg = Math.max(0, dmg - 1);

      const winnerRageReady = winnerSlot === 1 ? rageready1 : rageready2;
      if (rules.rage && winnerRageReady) {
        dmg += 2;
        entry += `${winnerName}的怒氣值爆發,追加 2 點傷害!`;
        if (winnerSlot === 1) {
          rageready1 = false;
          rage1 = 0;
        } else {
          rageready2 = false;
          rage2 = 0;
        }
      }

      const loserDefend = loserSlot === 1 ? m1.defend : m2.defend;
      const loserShield = loserSlot === 1 ? shield1 : shield2;
      const hpBefore = loserSlot === 1 ? hp1 : hp2;

      if (loserDefend && loserShield > 0) {
        if (loserSlot === 1) shield1--;
        else shield2--;
        entry += `${loserName}觸發防禦骰,完全擋下了本應承受的 ${dmg} 點傷害!`;
        lastEvent = { type: "hit", winnerSlot, loserSlot, dmg, shieldBlocked: true };
      } else {
        if (loserSlot === 1) hp1 -= dmg;
        else hp2 -= dmg;
        const hpAfter = loserSlot === 1 ? hp1 : hp2;
        entry += `${winnerName}技高一籌,${loserName}扣了 ${dmg} 點血${allinActive ? "(加注雙倍!)" : ""}(${hpBefore}→${Math.max(hpAfter, 0)})。`;
        lastEvent = { type: "hit", winnerSlot, loserSlot, dmg, shieldBlocked: false };
      }

      if (rules.rage) {
        if (loserSlot === 1) {
          rage1++;
          rage2 = 0;
          if (rage1 >= 2) {
            rageready1 = true;
            entry += `${p1Name}連輸2場,怒氣值滿了!`;
          }
        } else {
          rage2++;
          rage1 = 0;
          if (rage2 >= 2) {
            rageready2 = true;
            entry += `${p2Name}連輸2場,怒氣值滿了!`;
          }
        }
      }
    }

    if (m1.freebet) freebet1++;
    if (m2.freebet) freebet2++;

    log.push(entry);
    hp1 = Math.max(hp1, 0);
    hp2 = Math.max(hp2, 0);

    const newState = {
      ...state,
      hp1,
      hp2,
      shield1,
      shield2,
      rage1,
      rage2,
      rageready1,
      rageready2,
      freebet1,
      freebet2,
      log,
      lastEvent,
      round: state.round + 1,
      m1: null,
      m2: null,
    };
    await db.updateMatchState(matchId, { state: newState });

    if (hp1 <= 0 || hp2 <= 0) {
      const winnerSlot = hp1 <= 0 ? 2 : 1;
      const winnerId = winnerSlot === 1 ? match.player1_id : match.player2_id;
      const loserId = winnerSlot === 1 ? match.player2_id : match.player1_id;
      await db.advanceAfterMatch(match, winnerId, loserId);
    }
  } finally {
    resolving = false;
  }
}

// 對戰結束後,不管你是剛贏的選手還是純觀戰,自動帶你去看贏家的下一場,不用手動點觀戰
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
      if (hint) hint.innerHTML = mySlot ? "🏆 你贏了!正在前往下一場..." : "👀 這場結束了,正在前往下一場...";
      setTimeout(() => {
        location.href = `dice.html?match=${winnerPart.match_id}&event=${eventId}`;
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
      .appendMatchLog(matchId, `⌛ ${oppName || "對手"} 超過1分鐘沒有進入對戰畫面,系統開始自動幫他出招(不會用防禦骰/加注等技能),他隨時進場都能接手。`)
      .catch(() => {});
  }
}

// 代打:輪到被代打的那位時,幫他擲一個普通骰子(不觸發防禦骰/加注等主動技能)
async function maybeAutopilotSubmit() {
  if (!autopilotSlot || !match) return;
  if (match.status !== "active") return;
  const state = match.state;
  if (!state || state.hp1 <= 0 || state.hp2 <= 0) return;
  const already = autopilotSlot === 1 ? state.m1 : state.m2;
  if (already) return;
  const roll = 1 + Math.floor(Math.random() * 6);
  try {
    await db.submitMove(matchId, autopilotSlot, { roll, defend: false, allin: false, freebet: false });
  } catch (e) {}
}

async function refresh() {
  match = await db.getMatch(matchId);
  if (!ev) ev = await db.getEvent(match.event_id);
  const local = db.getLocalPlayer();
  mySlot = match.player1_id === local.id ? 1 : match.player2_id === local.id ? 2 : null;
  if (mySlot && !enteredMarked) {
    enteredMarked = true;
    db.markEntered(matchId, mySlot).catch(() => {});
  }
  const state = match.state;
  submittedThisRound = mySlot ? !!(mySlot === 1 ? state.m1 : state.m2) : false;
  render(state);
  resolveRoundIfReady(state);
  maybeAutoAdvance(state);
  maybeAutopilotSubmit();
}

function bindControls() {
  document.getElementById("shield-toggle").onclick = () => {
    selectedShield = !selectedShield;
    if (selectedShield) announce("🛡️ 你準備使用防禦骰!");
    refresh();
  };
  document.getElementById("allin-toggle").onclick = () => {
    selectedAllin = !selectedAllin;
    if (selectedAllin) announce("🔥 你決定背水一戰!");
    refresh();
  };
  document.getElementById("freebet-toggle").onclick = () => {
    selectedFreebet = !selectedFreebet;
    if (selectedFreebet) announce("🎰 你使出了自由加注!");
    refresh();
  };
  document.getElementById("roll-btn").onclick = async () => {
    const roll = 1 + Math.floor(Math.random() * 6);
    document.getElementById("roll-btn").disabled = true;
    clearInterval(timerInterval);
    announce(`🎲 你擲出了 ${roll} 點!`);
    await db.submitMove(matchId, mySlot, {
      roll,
      defend: selectedShield,
      allin: selectedAllin || selectedFreebet,
      freebet: selectedFreebet,
    });
    selectedShield = false;
    selectedAllin = false;
    selectedFreebet = false;
  };
}

const RULE_EXPLAIN = {
  item_die: ["🎁 道具骰", "每逢第 3 回合,雙方會各自隨機獲得一個道具效果:爆擊(該局傷害+2)、回血(+2HP)、必中(平手時你直接獲勝)、封印(讓對方那局少受 1 點傷害)。"],
  field_mod: ["🌪️ 戰場修飾骰", "開局時隨機決定這場對戰的場地效果:全場傷害 +1,或是防禦骰次數變成 2 次,整場比賽固定不變。"],
  free_bet: ["🎰 自由加注", "不限血量都能加倍賭注(該局傷害x2),但整場最多使用 2 次。"],
  rage: ["🔥 怒氣值", "連續輸 2 局會讓你下一次獲勝時額外多 +2 傷害,是低血量時的逆轉機會。"],
};

function renderRules() {
  const box = document.getElementById("rule-content");
  let html = `
    <p>雙方各有 12 點 HP,輪流擲一顆骰子(1~6點)。每回合限時 30 秒。</p>
    <p>點數高的一方讓對方扣「點數差」的血;點數相同則平手,雙方各扣 1 血。</p>
    <p>每人有 1 次防禦骰:出招前先啟動,若那一局你會輸,傷害完全免疫(只能觸發一次)。</p>
    <p>HP ≤5 時可開啟「背水一戰」,該局傷害雙倍賭一把。血量先歸零者落敗。</p>
  `;
  const rules = (ev && ev.rules) || {};
  const active = Object.keys(rules).filter((k) => rules[k]);
  if (active.length) {
    html += `<h4>本場活動額外開啟的機制</h4>`;
    active.forEach((k) => {
      const item = RULE_EXPLAIN[k];
      if (item) html += `<p><b style="color:var(--ink);">${item[0]}</b><br/>${item[1]}</p>`;
    });
  }
  box.innerHTML = html;
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
  unsubParticipants = db.onTableChange("event_participants", `event_id=eq.${eventId}`, () => refresh());
  entryWatchdog = setInterval(() => {
    checkEntryTimeout();
    maybeAutopilotSubmit();
  }, 5000);
})();

window.addEventListener("beforeunload", () => {
  if (unsub) unsub();
  if (unsubParticipants) unsubParticipants();
  if (entryWatchdog) clearInterval(entryWatchdog);
});
