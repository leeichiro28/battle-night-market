const qs = new URLSearchParams(location.search);
const matchId = qs.get("match");
const eventId = qs.get("event");

let match = null;
let ev = null;
let mySlot = null;
let selectedShield = false;
let selectedAllin = false;
let selectedFreebet = false;
let submittedThisRound = false;
let resolving = false;
let unsub = null;

const CIRC = 289;
const ITEM_LABEL = { crit: "⚡爆擊", heal: "💚回血", truehit: "🎯必中", seal: "🔒封印" };
const FIELD_LABEL = { crit: "🌪️ 戰場:全場傷害+1", shield_plus: "🌪️ 戰場:防禦骰x2次" };

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

function render(state) {
  document.getElementById("p1-name").textContent = match.p1?.name || "玩家一";
  document.getElementById("p2-name").textContent = match.p2?.name || "玩家二";
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

  const myShield = mySlot === 1 ? state.shield1 : state.shield2;
  const myHp = mySlot === 1 ? state.hp1 : state.hp2;
  const myFreebet = mySlot === 1 ? state.freebet1 : state.freebet2;
  const myRageReady = mySlot === 1 ? state.rageready1 : state.rageready2;

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

  const statusEl = document.getElementById("game-status");
  const rollBtn = document.getElementById("roll-btn");

  if (state.hp1 <= 0 || state.hp2 <= 0) {
    rollBtn.style.display = "none";
    document.getElementById("pre-roll-options").style.display = "none";
    const iWon = (mySlot === 1 && state.hp2 <= 0) || (mySlot === 2 && state.hp1 <= 0);
    statusEl.innerHTML = iWon
      ? "🏆 你贏了這場對戰!回等候室看看下一步"
      : "💀 你被擊敗了,感謝參戰!";
    document.getElementById("back-link").style.display = "block";
    document.getElementById("back-link").innerHTML = `<a href="lobby.html?event=${eventId}">← 回等候室查看賽況</a>`;
    return;
  }

  if (submittedThisRound) {
    statusEl.textContent = "已擲出,等待對方出手...";
    rollBtn.disabled = true;
  } else {
    statusEl.textContent = "輪到你了,選好策略後擲骰";
    rollBtn.disabled = false;
  }
}

async function resolveRoundIfReady(state) {
  if (mySlot !== 1 || resolving) return;
  if (!state.m1 || !state.m2) return;
  resolving = true;
  try {
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

    let entry = `R${state.round}· P1🎲${m1.roll}　P2🎲${m2.roll}`;

    let item1 = null;
    let item2 = null;
    if (rules.item_die && state.round % 3 === 0) {
      const items = ["crit", "heal", "truehit", "seal"];
      item1 = items[Math.floor(Math.random() * 4)];
      item2 = items[Math.floor(Math.random() * 4)];
      entry += ` ｜道具:P1${ITEM_LABEL[item1]} P2${ITEM_LABEL[item2]}`;
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
      entry += " → 平手,雙方各扣1";
    } else {
      const winnerSlot = loserSlot === 1 ? 2 : 1;
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
        entry += ` ｜P${winnerSlot}怒氣爆發`;
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
      if (loserDefend && loserShield > 0) {
        if (loserSlot === 1) shield1--;
        else shield2--;
        entry += ` → P${loserSlot}觸發防禦骰,擋下${dmg}傷害!`;
      } else {
        if (loserSlot === 1) hp1 -= dmg;
        else hp2 -= dmg;
        entry += ` → P${loserSlot}扣${dmg}血${allinActive ? "(加注雙倍!)" : ""}`;
      }

      if (rules.rage) {
        if (loserSlot === 1) {
          rage1++;
          rage2 = 0;
          if (rage1 >= 2) {
            rageready1 = true;
            entry += " ｜P1怒氣值滿!";
          }
        } else {
          rage2++;
          rage1 = 0;
          if (rage2 >= 2) {
            rageready2 = true;
            entry += " ｜P2怒氣值滿!";
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

async function refresh() {
  match = await db.getMatch(matchId);
  if (!ev) ev = await db.getEvent(match.event_id);
  const local = db.getLocalPlayer();
  mySlot = match.player1_id === local.id ? 1 : 2;
  const state = match.state;
  submittedThisRound = !!(mySlot === 1 ? state.m1 : state.m2);
  render(state);
  resolveRoundIfReady(state);
}

function bindControls() {
  document.getElementById("shield-toggle").onclick = () => {
    selectedShield = !selectedShield;
    refresh();
  };
  document.getElementById("allin-toggle").onclick = () => {
    selectedAllin = !selectedAllin;
    refresh();
  };
  document.getElementById("freebet-toggle").onclick = () => {
    selectedFreebet = !selectedFreebet;
    refresh();
  };
  document.getElementById("roll-btn").onclick = async () => {
    const roll = 1 + Math.floor(Math.random() * 6);
    document.getElementById("roll-btn").disabled = true;
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
    <p>雙方各有 12 點 HP,輪流擲一顆骰子(1~6點)。</p>
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
})();

window.addEventListener("beforeunload", () => {
  if (unsub) unsub();
});
