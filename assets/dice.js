const qs = new URLSearchParams(location.search);
const matchId = qs.get("match");
const eventId = qs.get("event");

let match = null;
let ev = null;
let mySlot = null; // 1 | 2 | null(觀戰)
let selectedShield = false;
let selectedAllin = false;
let selectedFreebet = false;
let selectedGamble = false;
let selectedUlt = false;
let selectedStance = null; // 'attack' | 'defense' | null
let submittedThisRound = false;
let resolving = false;
let unsub = null;
let unsubParticipants = null;
let unsubBets = null;
let lastSeenRound = null;
let timerInterval = null;
let currentRoundKey = null;
let autoFollowTriggered = false;
let enteredMarked = false;
let goneAway = false;
let autopilotSlot = null;
let autopilotAnnounced = false;
let entryWatchdog = null;
let battleView = null;

const ENTRY_TIMEOUT_MS = 60000;
const MAX_HP = 30;
const SUDDEN_DEATH_HP = 6;

const ITEM_LABEL = { crit: "爆擊", heal: "回血", truehit: "必中", seal: "封印" };
const CLASS_INFO = {
  fighter: { icon: "swords", name: "鬥士", ultName: "血怒" },
  guardian: { icon: "shield", name: "守衛", ultName: "金鐘罩" },
  gambler: { icon: "dice-5", name: "賭徒", ultName: "孤注一擲" },
  assassin: { icon: "sword", name: "刺客", ultName: "背刺" },
  mage: { icon: "sparkles", name: "法師", ultName: "法術反射" },
  luckster: { icon: "clover", name: "幸運兒", ultName: "命運骰" },
};
const CLASS_COUNTER = {
  fighter: "gambler",
  gambler: "assassin",
  assassin: "guardian",
  guardian: "mage",
  mage: "luckster",
  luckster: "fighter",
};
const FIELD_MODS = ["crit", "shield_plus", "lifesteal", "chaos_tie", "fast_timer", "shadow"];

function rollTimeFor(state) {
  return state.field_mod === "fast_timer" ? 15000 : 30000;
}

function names() {
  return [match.p1?.name || "玩家一", match.p2?.name || "玩家二"];
}

function d6() {
  return 1 + Math.floor(Math.random() * 6);
}

function startTimer(state) {
  if (!mySlot || submittedThisRound || state.hp1 <= 0 || state.hp2 <= 0) return;
  const roundKey = state.round + "-" + mySlot;
  if (currentRoundKey === roundKey) return;
  currentRoundKey = roundKey;
  clearInterval(timerInterval);

  const rollTime = rollTimeFor(state);
  const started = Date.now();
  const fill = document.getElementById("timer-fill");
  timerInterval = setInterval(async () => {
    const elapsed = Date.now() - started;
    const pct = Math.max(0, 100 - (elapsed / rollTime) * 100);
    fill.style.width = pct + "%";
    if (elapsed >= rollTime) {
      clearInterval(timerInterval);
      if (!submittedThisRound) {
        submittedThisRound = true;
        const roll = d6();
        battleView.announce(`思考時間到,系統幫你擲出了 ${roll} 點!`, { icon: "hourglass" });
        await db.submitMove(matchId, mySlot, { roll, defend: false, allin: false, freebet: false, gamble: false, stance: null, ult: false });
        resetSelections();
      }
    }
  }, 80);
}

function resetSelections() {
  selectedShield = false;
  selectedAllin = false;
  selectedFreebet = false;
  selectedGamble = false;
  selectedUlt = false;
  selectedStance = null;
}

function render(state) {
  const [p1Name, p2Name] = names();
  const wasFirstRender = lastSeenRound === null;
  const roundChanged = !wasFirstRender && state.round !== lastSeenRound;
  battleView.update(match, ev, mySlot);
  lastSeenRound = state.round;

  if (roundChanged && mySlot && !submittedThisRound) {
    setTimeout(() => {
      if (!submittedThisRound) battleView.announce("輪到你了!", { icon: "swords" });
    }, 2000);
  }

  const statusEl = document.getElementById("game-status");
  const rollBtn = document.getElementById("roll-btn");
  const preRollBox = document.getElementById("pre-roll-options");
  const stanceRow = document.getElementById("stance-row");

  if (state.hp1 <= 0 || state.hp2 <= 0) {
    clearInterval(timerInterval);
    document.getElementById("timer-fill").style.width = "0%";
    rollBtn.style.display = "none";
    preRollBox.style.display = "none";
    stanceRow.style.display = "none";
    document.getElementById("rage-tag").style.display = "none";
    document.getElementById("guard-tag").style.display = "none";
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
    preRollBox.style.display = "none";
    stanceRow.style.display = "none";
    rollBtn.style.display = "none";
    document.getElementById("rage-tag").style.display = "none";
    document.getElementById("guard-tag").style.display = "none";
    document.getElementById("timer-fill").style.width = "0%";
    statusEl.innerHTML = ui.icon("eye") + "觀戰模式・對戰進行中";
    return;
  }

  const rules = ev.rules || {};
  const myClass = mySlot === 1 ? state.class1 : state.class2;
  const myShield = mySlot === 1 ? state.shield1 : state.shield2;
  const myHp = mySlot === 1 ? state.hp1 : state.hp2;
  const myFreebet = mySlot === 1 ? state.freebet1 : state.freebet2;
  const myGamble = mySlot === 1 ? state.gamble1 : state.gamble2;
  const myRageReady = mySlot === 1 ? state.rageready1 : state.rageready2;
  const myUltUsed = mySlot === 1 ? state.classult1 : state.classult2;

  if (rules.stance) {
    stanceRow.style.display = "flex";
    const atkBtn = document.getElementById("stance-attack");
    const defBtn = document.getElementById("stance-defense");
    atkBtn.innerHTML = ui.icon("sword") + "猛攻";
    defBtn.innerHTML = ui.icon("shield") + "穩紮穩打";
    atkBtn.classList.toggle("active-choice", selectedStance === "attack");
    defBtn.classList.toggle("active-choice", selectedStance === "defense");
    atkBtn.disabled = submittedThisRound;
    defBtn.disabled = submittedThisRound;
  } else {
    stanceRow.style.display = "none";
  }

  preRollBox.style.display = "flex";
  const shieldBtn = document.getElementById("shield-toggle");
  shieldBtn.innerHTML =
    ui.icon("shield") +
    (myShield <= 0
      ? "防禦骰已用完"
      : selectedShield
      ? `防禦骰:已啟動(剩 ${myShield} 次)`
      : `使用防禦骰(剩 ${myShield} 次)`);
  shieldBtn.classList.toggle("active-choice", selectedShield && myShield > 0);
  shieldBtn.disabled = myShield <= 0 || submittedThisRound;

  const allinBtn = document.getElementById("allin-toggle");
  if (myHp <= MAX_HP * 0.4 && myHp > 0) {
    allinBtn.style.display = "inline-flex";
    allinBtn.innerHTML = ui.icon("flame") + (selectedAllin ? "背水一戰:已啟動" : "背水一戰(傷害x2)");
    allinBtn.classList.toggle("active-choice", selectedAllin);
    allinBtn.disabled = submittedThisRound;
  } else {
    allinBtn.style.display = "none";
  }

  const freebetBtn = document.getElementById("freebet-toggle");
  if (rules.free_bet) {
    const left = 2 - (myFreebet || 0);
    freebetBtn.style.display = "inline-flex";
    freebetBtn.innerHTML =
      ui.icon("coins") +
      (left <= 0 ? "自由加注已用完" : selectedFreebet ? `自由加注:已啟動(剩${left}次)` : `自由加注(傷害x2,剩${left}次)`);
    freebetBtn.classList.toggle("active-choice", selectedFreebet && left > 0);
    freebetBtn.disabled = left <= 0 || submittedThisRound;
  } else {
    freebetBtn.style.display = "none";
  }

  const gambleBtn = document.getElementById("gamble-toggle");
  if (rules.dice_gamble) {
    const unlimited = myClass === "gambler";
    const left = 2 - (myGamble || 0);
    gambleBtn.style.display = "inline-flex";
    if (unlimited) {
      gambleBtn.innerHTML = ui.icon("dice-5") + (selectedGamble ? "雙骰豪賭:已啟動" : "雙骰豪賭(不限次數)");
      gambleBtn.disabled = submittedThisRound;
    } else {
      gambleBtn.innerHTML =
        ui.icon("dice-5") +
        (left <= 0 ? "雙骰豪賭已用完" : selectedGamble ? `雙骰豪賭:已啟動(剩${left}次)` : `雙骰豪賭(剩${left}次)`);
      gambleBtn.disabled = left <= 0 || submittedThisRound;
    }
    gambleBtn.classList.toggle("active-choice", selectedGamble && (unlimited || left > 0));
  } else {
    gambleBtn.style.display = "none";
  }

  const ultBtn = document.getElementById("ult-toggle");
  if (rules.classes && myClass && CLASS_INFO[myClass]) {
    const info = CLASS_INFO[myClass];
    ultBtn.style.display = "inline-flex";
    ultBtn.innerHTML =
      ui.icon("zap") +
      (myUltUsed ? "大招已使用" : selectedUlt ? `大招:${info.ultName}(已啟動)` : `使出大招:${info.ultName}`);
    ultBtn.disabled = !!myUltUsed || submittedThisRound;
  } else {
    ultBtn.style.display = "none";
  }

  const rageTag = document.getElementById("rage-tag");
  if (rules.rage && myRageReady) {
    rageTag.style.display = "inline-flex";
    rageTag.innerHTML = ui.icon("flame") + "怒氣已滿,下次獲勝額外+2傷害";
  } else {
    rageTag.style.display = "none";
  }

  const guardTag = document.getElementById("guard-tag");
  const myGuardStack = mySlot === 1 ? state.guardstack1 : state.guardstack2;
  if (rules.classes && myClass === "guardian" && myGuardStack > 0) {
    guardTag.style.display = "inline-flex";
    guardTag.innerHTML = ui.icon("shield-check") + `蓄力 ${myGuardStack}/2,滿了下次命中+3傷害`;
  } else {
    guardTag.style.display = "none";
  }

  if (submittedThisRound) {
    statusEl.innerHTML = ui.icon("hourglass") + "已擲出,等待對方出手...";
    rollBtn.style.display = "flex";
    rollBtn.disabled = true;
    document.getElementById("timer-fill").style.width = "0%";
  } else {
    const secs = Math.round(rollTimeFor(state) / 1000);
    statusEl.innerHTML = ui.icon("timer") + `輪到你了,選好策略後擲骰(${secs}秒內動作)`;
    rollBtn.style.display = "flex";
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
    let gamble1 = state.gamble1 || 0;
    let gamble2 = state.gamble2 || 0;
    let combo1 = state.combo1 || 0;
    let combo2 = state.combo2 || 0;
    let combobonus1 = state.combobonus1 || 0;
    let combobonus2 = state.combobonus2 || 0;
    let classult1 = !!state.classult1;
    let classult2 = !!state.classult2;
    let guardstack1 = state.guardstack1 || 0;
    let guardstack2 = state.guardstack2 || 0;
    const class1 = state.class1;
    const class2 = state.class2;
    const log = state.log ? [...state.log] : [];
    const m1 = state.m1;
    const m2 = state.m2;
    const rules = ev.rules || {};
    let lastEvent = null;

    let entry = `第${state.round}回合:`;

    if (rules.classes && m1.ult && class1 === "fighter" && !classult1) {
      rageready1 = true;
      classult1 = true;
      entry += `${p1Name}使出大招「血怒」!`;
    }
    if (rules.classes && m2.ult && class2 === "fighter" && !classult2) {
      rageready2 = true;
      classult2 = true;
      entry += `${p2Name}使出大招「血怒」!`;
    }
    if (rules.classes && m1.ult && class1 !== "fighter" && !classult1) classult1 = true;
    if (rules.classes && m2.ult && class2 !== "fighter" && !classult2) classult2 = true;

    // 幸運兒大招:命運骰,雙方這一局重新擲骰(在判定勝負之前生效)
    let roll1 = m1.roll;
    let roll2 = m2.roll;
    const luckReroll =
      rules.classes &&
      ((m1.ult && class1 === "luckster") || (m2.ult && class2 === "luckster"));
    if (luckReroll) {
      roll1 = 1 + Math.floor(Math.random() * 6);
      roll2 = 1 + Math.floor(Math.random() * 6);
      const caster = m1.ult && class1 === "luckster" ? p1Name : p2Name;
      entry += `${caster}使出大招「命運骰」,雙方重新擲骰!`;
    }
    entry += `${p1Name} 擲出 ${roll1} 點,${p2Name} 擲出 ${roll2} 點。`;

    let item1 = null;
    let item2 = null;
    if (rules.item_die && state.round % 3 === 0) {
      const items = ["crit", "heal", "truehit", "seal"];
      item1 = items[Math.floor(Math.random() * 4)];
      item2 = items[Math.floor(Math.random() * 4)];
      entry += `道具骰觸發!${p1Name}獲得${ITEM_LABEL[item1]},${p2Name}獲得${ITEM_LABEL[item2]}。`;
      const heal1 = class1 === "mage" ? 3 : 2;
      const heal2 = class2 === "mage" ? 3 : 2;
      if (item1 === "heal") hp1 = Math.min(MAX_HP, hp1 + heal1);
      if (item2 === "heal") hp2 = Math.min(MAX_HP, hp2 + heal2);
    }

    const diff = Math.abs(roll1 - roll2);
    let loserSlot;
    if (diff === 0) {
      if (item1 === "truehit" && item2 !== "truehit") loserSlot = 2;
      else if (item2 === "truehit" && item1 !== "truehit") loserSlot = 1;
      else if (rules.classes && class1 === "luckster" && class2 !== "luckster") loserSlot = 2;
      else if (rules.classes && class2 === "luckster" && class1 !== "luckster") loserSlot = 1;
      else loserSlot = "tie";
    } else {
      loserSlot = roll1 > roll2 ? 2 : 1;
      if (loserSlot === 1 && item1 === "truehit") loserSlot = 2;
      else if (loserSlot === 2 && item2 === "truehit") loserSlot = 1;
    }

    if (loserSlot === "tie") {
      const tieDmg = state.field_mod === "chaos_tie" ? 2 : 1;
      hp1 -= tieDmg;
      hp2 -= tieDmg;
      combo1 = 0;
      combo2 = 0;
      entry += `點數相同,雙方戰成平手,各扣 ${tieDmg} 點血。`;
      lastEvent = { type: "tie" };
    } else {
      const winnerSlot = loserSlot === 1 ? 2 : 1;
      const winnerName = winnerSlot === 1 ? p1Name : p2Name;
      const loserName = loserSlot === 1 ? p1Name : p2Name;
      const winnerClass = winnerSlot === 1 ? class1 : class2;
      const loserClass = loserSlot === 1 ? class1 : class2;
      const winnerStance = winnerSlot === 1 ? m1.stance : m2.stance;
      const loserStance = loserSlot === 1 ? m1.stance : m2.stance;
      const winnerUltThis = winnerSlot === 1 ? m1.ult : m2.ult;
      const loserUltThis = loserSlot === 1 ? m1.ult : m2.ult;
      const winnerGambleThis = winnerSlot === 1 ? m1.gamble : m2.gamble;

      const allinActive = m1.allin || m2.allin;
      let dmg = diff === 0 ? 2 : diff;
      if (allinActive) dmg *= 2;
      if (state.field_mod === "crit") dmg += 1;

      const winnerItem = winnerSlot === 1 ? item1 : item2;
      const shadowBoost = state.field_mod === "shadow";
      const mageBonus = winnerClass === "mage" ? 1 : 0;
      if (winnerItem === "crit") dmg += (shadowBoost ? 4 : 2) + mageBonus;
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

      const winnerComboBonus = winnerSlot === 1 ? combobonus1 : combobonus2;
      if (rules.combo && winnerComboBonus) dmg += winnerComboBonus;

      if (rules.classes && winnerClass && CLASS_COUNTER[winnerClass] === loserClass) {
        dmg += 1;
        entry += `${winnerName}的職業克制${loserName}!`;
      }

      // 守衛:每擋下2次攻擊,下一次自己命中額外+3傷害(消耗蓄力)
      if (rules.classes && winnerClass === "guardian") {
        const winnerStack = winnerSlot === 1 ? guardstack1 : guardstack2;
        if (winnerStack >= 2) {
          dmg += 3;
          entry += `${winnerName}蓄力反擊,追加 3 點傷害!`;
          if (winnerSlot === 1) guardstack1 = 0;
          else guardstack2 = 0;
        }
      }

      const winnerHpPct = (winnerSlot === 1 ? hp1 : hp2) / MAX_HP;
      if (rules.stance && winnerStance === "attack") {
        dmg += winnerClass === "fighter" ? (winnerHpPct <= 0.4 ? 3 : 2) : 1;
      } else if (rules.stance && winnerStance === "defense") {
        dmg = Math.floor(dmg / 2);
      }
      if (rules.stance && loserStance === "attack") {
        dmg += 1;
      } else if (rules.stance && loserStance === "defense") {
        dmg = Math.floor(dmg / 2);
      }

      if (rules.dice_gamble && winnerClass === "gambler" && winnerGambleThis) dmg += 1;

      if (rules.classes && winnerUltThis && winnerClass === "assassin" && loserStance === "defense") {
        dmg *= 3;
        entry += `${winnerName}使出大招「背刺」,傷害x3!`;
      }
      if (rules.classes && winnerUltThis && winnerClass === "gambler") {
        dmg += 2;
        entry += `${winnerName}使出大招「孤注一擲」,必定爆擊!`;
      }

      // 守衛被動:所有受到的傷害固定-1(最低0),但完全被擋下的0傷害不受影響
      const loserClassForReduction = loserSlot === 1 ? class1 : class2;
      if (rules.classes && loserClassForReduction === "guardian" && dmg > 0) {
        dmg = Math.max(0, dmg - 1);
      }

      const suddenDeath = rules.sudden_death && state.hp1 <= SUDDEN_DEATH_HP && state.hp2 <= SUDDEN_DEATH_HP;
      if (suddenDeath) dmg *= 2;

      // 法師大招用:記下防禦骰/金鐘罩擋下來「之前」的原始傷害,反射永遠照這個算,
      // 不管這局實際上有沒有被防禦骰擋下(以前只有在傷害真的打進來才會反彈,導致同時按防禦+大招時反射直接失效)。
      const dmgBeforeBlock = dmg;

      let guardianUltBlocked = false;
      if (rules.classes && loserUltThis && loserClass === "guardian") {
        guardianUltBlocked = true;
        dmg = 0;
        entry += `${loserName}使出大招「金鐘罩」,完全免疫傷害!`;
      }

      // 刺客大招:背刺無視對方的防禦骰(守衛的金鐘罩大招除外,上面已經處理過)
      const assassinIgnoreShield = rules.classes && winnerUltThis && winnerClass === "assassin";

      const loserDefend = loserSlot === 1 ? m1.defend : m2.defend;
      const loserShield = loserSlot === 1 ? shield1 : shield2;
      const hpBefore = loserSlot === 1 ? hp1 : hp2;

      if (guardianUltBlocked) {
        lastEvent = { type: "hit", winnerSlot, loserSlot, dmg: 0, shieldBlocked: true };
      } else if (loserDefend && loserShield > 0 && !assassinIgnoreShield) {
        if (loserSlot === 1) shield1--;
        else shield2--;
        // 守衛被動:成功擋下攻擊累積蓄力,滿2層時下次命中額外+3傷害
        if (rules.classes && loserClass === "guardian") {
          if (loserSlot === 1) guardstack1 = Math.min(2, guardstack1 + 1);
          else guardstack2 = Math.min(2, guardstack2 + 1);
        }
        entry += `${loserName}觸發防禦骰,完全擋下了本應承受的 ${dmg} 點傷害!`;
        lastEvent = { type: "hit", winnerSlot, loserSlot, dmg, shieldBlocked: true };
      } else {
        if (loserDefend && loserShield > 0 && assassinIgnoreShield) {
          entry += `${loserName}的防禦骰被「背刺」無視了!`;
        }
        if (loserSlot === 1) hp1 -= dmg;
        else hp2 -= dmg;
        const hpAfter = loserSlot === 1 ? hp1 : hp2;
        entry += `${winnerName}技高一籌,${loserName}扣了 ${dmg} 點血${allinActive ? "(加注雙倍!)" : ""}${suddenDeath ? "生死局雙倍!" : ""}(${hpBefore}→${Math.max(hpAfter, 0)})。`;
        lastEvent = { type: "hit", winnerSlot, loserSlot, dmg, shieldBlocked: false };
        if (state.field_mod === "lifesteal" && dmg > 0) {
          if (winnerSlot === 1) hp1 = Math.min(MAX_HP, hp1 + 1);
          else hp2 = Math.min(MAX_HP, hp2 + 1);
          entry += `${winnerName}嗜血戰場回血1點。`;
        }
      }

      // 法師大招:法術反射,不看這局傷害有沒有被防禦骰/金鐘罩擋下,一律照對方原本要打出的傷害 100% 反彈回去,
      // 這樣防禦骰(擋自己)跟反射(彈對方)可以同時生效,大招才不會因為剛好防到就直接白開。
      if (rules.classes && loserUltThis && loserClass === "mage" && dmgBeforeBlock > 0) {
        const reflectDmg = dmgBeforeBlock;
        if (reflectDmg > 0) {
          if (winnerSlot === 1) hp1 = Math.max(0, hp1 - reflectDmg);
          else hp2 = Math.max(0, hp2 - reflectDmg);
          entry += `${loserName}使出大招「法術反射」,反彈 ${reflectDmg} 點傷害給${winnerName}!`;
        }
      }

      if (rules.combo) {
        const step = winnerClass === "assassin" ? 2 : 1;
        if (winnerSlot === 1) {
          const prev = combo1;
          combo1 += step;
          combo2 = 0;
          if (Math.floor(combo1 / 3) > Math.floor(prev / 3)) {
            combobonus1 += 1;
            entry += `${winnerName}連擊升級!永久+1傷害。`;
          }
        } else {
          const prev = combo2;
          combo2 += step;
          combo1 = 0;
          if (Math.floor(combo2 / 3) > Math.floor(prev / 3)) {
            combobonus2 += 1;
            entry += `${winnerName}連擊升級!永久+1傷害。`;
          }
        }
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
    if (m1.gamble) gamble1++;
    if (m2.gamble) gamble2++;

    // 賭徒被動風險:雙骰豪賭不限次數,但每次都有 35% 機率「凸槌」自傷2點(原本 25%/1點回饋太低,玩家覺得賭徒幾乎沒下檔風險)
    if (rules.classes && rules.dice_gamble && m1.gamble && class1 === "gambler" && Math.random() < 0.35) {
      hp1 = Math.max(0, hp1 - 2);
      entry += `${p1Name}雙骰豪賭凸槌,自傷 2 點!`;
    }
    if (rules.classes && rules.dice_gamble && m2.gamble && class2 === "gambler" && Math.random() < 0.35) {
      hp2 = Math.max(0, hp2 - 2);
      entry += `${p2Name}雙骰豪賭凸槌,自傷 2 點!`;
    }

    log.push(entry);
    hp1 = Math.max(hp1, 0);
    hp2 = Math.max(hp2, 0);

    let nextFieldMod = state.field_mod;
    if (rules.field_mod && rules.dynamic_field) {
      nextFieldMod = FIELD_MODS[Math.floor(Math.random() * FIELD_MODS.length)];
    }

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
      gamble1,
      gamble2,
      combo1,
      combo2,
      combobonus1,
      combobonus2,
      classult1,
      classult2,
      guardstack1,
      guardstack2,
      field_mod: nextFieldMod,
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
        location.href = `dice.html?match=${winnerPart.match_id}&event=${eventId}`;
      }, 2500);
    }
  } catch (e) {}
}

async function checkEntryTimeout() {
  if (!mySlot || !match) return;
  if (match.status !== "active" || !match.activated_at) return;
  const meEntered = mySlot === 1 ? match.p1_entered_at : match.p2_entered_at;
  if (!meEntered) return;
  const oppSlot = mySlot === 1 ? 2 : 1;
  const oppEntered = mySlot === 1 ? match.p2_entered_at : match.p1_entered_at;
  if (oppEntered) {
    if (autopilotSlot === oppSlot) autopilotSlot = null;
    return;
  }
  if (autopilotSlot === oppSlot) return;
  const elapsed = Date.now() - new Date(match.activated_at).getTime();
  if (elapsed < ENTRY_TIMEOUT_MS) return;
  autopilotSlot = oppSlot;
  if (!autopilotAnnounced) {
    autopilotAnnounced = true;
    const oppName = oppSlot === 1 ? match.p1?.name : match.p2?.name;
    db
      .appendMatchLog(matchId, `${oppName || "對手"} 超過1分鐘沒有進入對戰畫面,系統開始自動幫他出招(不會用防禦骰/加注/大招等技能),他隨時進場都能接手。`)
      .catch(() => {});
  }
}

async function maybeAutopilotSubmit() {
  if (!autopilotSlot || !match) return;
  if (match.status !== "active") return;
  const state = match.state;
  if (!state || state.hp1 <= 0 || state.hp2 <= 0) return;
  const already = autopilotSlot === 1 ? state.m1 : state.m2;
  if (already) return;
  const roll = d6();
  try {
    await db.submitMove(matchId, autopilotSlot, { roll, defend: false, allin: false, freebet: false, gamble: false, stance: null, ult: false });
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
  if (!ev) {
    ev = await db.getEventSafe(match.event_id);
    if (!ev) {
      if (!goneAway) {
        goneAway = true;
        await ui.alert("這場活動已經不存在了(可能已被主辦人刪除),帶你回首頁。", {
          title: "找不到這場活動",
          tone: "danger",
        });
        location.href = "index.html";
      }
      return;
    }
  }
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
  document.getElementById("roll-btn").innerHTML = ui.icon("dices") + "擲骰";
  document.getElementById("shield-toggle").onclick = () => {
    selectedShield = !selectedShield;
    if (selectedShield) battleView.announce("你準備使用防禦骰!", { icon: "shield" });
    refresh();
  };
  document.getElementById("allin-toggle").onclick = () => {
    selectedAllin = !selectedAllin;
    if (selectedAllin) battleView.announce("你決定背水一戰!", { icon: "flame" });
    refresh();
  };
  document.getElementById("freebet-toggle").onclick = () => {
    selectedFreebet = !selectedFreebet;
    if (selectedFreebet) battleView.announce("你使出了自由加注!", { icon: "coins" });
    refresh();
  };
  document.getElementById("gamble-toggle").onclick = () => {
    selectedGamble = !selectedGamble;
    if (selectedGamble) battleView.announce("你決定雙骰豪賭!", { icon: "dice-5" });
    refresh();
  };
  document.getElementById("ult-toggle").onclick = () => {
    selectedUlt = !selectedUlt;
    if (selectedUlt) battleView.announce("大招蓄力中!", { icon: "zap" });
    refresh();
  };
  document.getElementById("stance-attack").onclick = () => {
    selectedStance = selectedStance === "attack" ? null : "attack";
    if (selectedStance === "attack") battleView.announce("你選擇了猛攻姿態!", { icon: "sword" });
    refresh();
  };
  document.getElementById("stance-defense").onclick = () => {
    selectedStance = selectedStance === "defense" ? null : "defense";
    if (selectedStance === "defense") battleView.announce("你選擇了穩紮穩打!", { icon: "shield" });
    refresh();
  };
  document.getElementById("roll-btn").onclick = async () => {
    const myClass = mySlot === 1 ? match.state.class1 : match.state.class2;
    let roll;
    if (selectedUlt && myClass === "gambler") {
      roll = Math.max(d6(), d6());
    } else if (selectedGamble) {
      roll = d6() + d6();
    } else {
      roll = d6();
    }
    document.getElementById("roll-btn").disabled = true;
    clearInterval(timerInterval);
    battleView.announce(`你擲出了 ${roll} 點!`, { icon: "dices" });
    await db.submitMove(matchId, mySlot, {
      roll,
      defend: selectedShield,
      allin: selectedAllin || selectedFreebet,
      freebet: selectedFreebet,
      gamble: selectedGamble,
      stance: selectedStance,
      ult: selectedUlt,
    });
    resetSelections();
  };
}

const RULE_EXPLAIN = {
  item_die: "每逢第 3 回合,雙方會各自隨機獲得一個道具效果:爆擊(該局傷害+2,法師是+3)、回血(+2HP,法師是+3)、必中(平手時你直接獲勝)、封印(讓對方那局少受 1 點傷害)。",
  field_mod: "開局隨機決定這場對戰的場地效果,6 選 1:熾熱(全場傷害+1)、堅盾(防禦骰+1次)、嗜血(擊中回血1)、混沌(平手傷害變2點)、疾風(思考時間縮短到15秒)、暗影(道具骰爆擊加成翻倍但防禦骰次數-1)。",
  dynamic_field: "戰場特性每回合都重新隨機一次,而不是整場固定一種。",
  free_bet: "不限血量都能加倍賭注(該局傷害x2),整場最多使用 2 次;跟「背水一戰」是不同的資源,各自獨立計算。",
  rage: "連續輸 2 局會讓你下一次獲勝時額外多 +2 傷害,是低血量時的逆轉機會。",
  stance: "每回合出招前可選「猛攻」(獲勝多+1傷害,鬥士是+2,HP低於40%時再更高;落敗多扣1血)或「穩紮穩打」(獲勝落敗的傷害都減半)。刺客的大招「背刺」專門針對對方選穩紮穩打設計,猜對了傷害更高。",
  combo: "連續獲勝會累積連擊層數(每贏一局+1層,刺客是+2層),每滿 3 層算升級,永久 +1 傷害;斷連(平手或落敗)會讓層數歸零,但已拿到的永久加成不受影響。",
  dice_gamble: "出招前可以選擇改擲 2 顆骰子取總和(2~12點),波動更大,一般職業整場限 2 次,賭徒職業不限次數。",
  sudden_death: "當雙方 HP 都低於 20%(30血時是6血以下)時自動啟動,該回合傷害固定雙倍。",
  classes:
    "報名時必須選擇一個職業:鬥士、守衛、賭徒、刺客、法師、幸運兒,各自有被動加成跟一次性大招。職業克制循環:鬥士克賭徒、賭徒克刺客、刺客克守衛、守衛克法師、法師克幸運兒、幸運兒克鬥士,克制對象時額外+1傷害。",
  betting: "觀戰的人可以投票猜誰會贏,純娛樂不影響勝負。",
  reactions: "觀戰或對戰中都可以發送表情圖示互動。",
};

function renderRules() {
  const box = document.getElementById("rule-content");
  let html = `
    <p>雙方各有 30 點 HP,輪流擲一顆骰子(1~6點)。</p>
    <p>點數高的一方讓對方扣「點數差」的血;點數相同則平手,雙方各扣 1 血。</p>
    <p>每人基礎有 2 次防禦骰:出招前先啟動,若那一局你會輸,傷害完全免疫,一次只能擋一局。</p>
    <p>HP ≤40%(30血時是12血以下)時可開啟「背水一戰」,該局傷害雙倍賭一把,不限次數。</p>
    <p>血量先歸零者落敗。每回合有時間限制(通常30秒,戰場特性「疾風」時縮短到15秒),超時系統會自動幫你出一個普通招式(不會用防禦骰、加注等技能)。</p>
  `;
  const rules = (ev && ev.rules) || {};
  const active = Object.keys(rules).filter((k) => rules[k]);
  if (active.length) {
    html += `<h4>本場活動額外開啟的機制</h4>`;
    active.forEach((k) => {
      const desc = RULE_EXPLAIN[k];
      const meta = ui.RULE[k];
      if (desc && meta) {
        html += `<p><b style="color:var(--ink);">${ui.icon(meta.icon)} ${meta.label}</b><br/>${desc}</p>`;
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
  document.getElementById("page-eyebrow").innerHTML = ui.icon("dices") + "骰子對戰";
  battleView = BattleView.mount(document.getElementById("battle-stage"), document.getElementById("battle-watch"), {
    gameType: "dice",
    matchId,
    showStatus: false, // 這頁自己的 #game-status 已經處理狀態文字,不要顯示兩份
  });
  bindControls();
  bindRuleModal();
  await refresh();
  unsub = db.onTableChange("matches", `id=eq.${matchId}`, () => refresh());
  unsubParticipants = db.onTableChange("event_participants", `event_id=eq.${eventId}`, () => refresh());
  unsubBets = db.onTableChange("match_bets", `match_id=eq.${matchId}`, () => {
    if (match) battleView.update(match, ev, mySlot);
  });
  entryWatchdog = setInterval(() => {
    checkEntryTimeout();
    maybeAutopilotSubmit();
  }, 5000);
})();

window.addEventListener("beforeunload", () => {
  if (unsub) unsub();
  if (unsubParticipants) unsubParticipants();
  if (unsubBets) unsubBets();
  if (battleView) battleView.destroy();
  if (entryWatchdog) clearInterval(entryWatchdog);
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") refresh();
});
