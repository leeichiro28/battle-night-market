// 職業養成對決 · 爬塔野怪戰鬥(企劃書第十三節:「AI對手直接算」，不用像PVP那樣等對方回合)
//
// 玩家固定是 side1、野怪固定是 side2，雙方動作都用簡單規則自動決定，整場一次算完，
// 回傳完整回合紀錄讓畫面用「戰報」方式播放，跟 PVP 共用同一套 CareerEngine.resolveRound。
//
// 爬塔的HP/MP是持續的(不會每場重置)，所以 simulateFloorBattle 可以帶入玩家目前剩多少
// HP/MP 當起始值(startHp/startMp)，打完不管輸贏都要把最終 HP/MP 存回 career_progress，
// 由呼叫端(db.js)負責讀寫，這支檔案只管算戰鬥本身。
window.CareerPve = (function () {
  const MAX_ROUNDS = 30; // 安全上限，理論上 5~8 回合內就會分出勝負(企劃書第七節)

  // 簡單 AI:
  //   1. 大招點滿、且魔力夠大招(算上「大招精修」減免)就放大招
  //   2. 否則如果有解鎖技能A/B、魔力夠，50%機率放技能(兩個都能用就隨機挑一個)
  //   3. 其餘普通攻擊
  // 野怪沒有技能等級(skillLevel/skill2Level 為0)，所以只會走 1 或 3。
  function decideAction(state, side) {
    const CD = window.CareerData;
    const mp = (side === 1 ? state.mp1 : state.mp2) || 0;
    const ultReduce = (side === 1 ? state.ultCostReduce1 : state.ultCostReduce2) || 0;
    const ultCost = Math.max(1, (CD.ULT_MANA_COST || 0) - ultReduce);
    const charge = (side === 1 ? state.ultCharge1 : state.ultCharge2) || 0;
    const chargeReady = charge >= (CD.ULT_CHARGE_MAX || 100);
    // 大招點滿 + 魔力夠才放;現在放大招受大招點限制，滿了就放(不再用機率拖著)
    if (chargeReady && mp >= ultCost) return { action: "ult" };
    if (mp >= (CD.SKILL_MANA_COST || 0)) {
      const options = [];
      if ((side === 1 ? state.skillLevel1 : state.skillLevel2) > 0) options.push("skill1");
      if ((side === 1 ? state.skill2Level1 : state.skill2Level2) > 0) options.push("skill2");
      if (options.length && Math.random() < 0.5) return { action: options[Math.floor(Math.random() * options.length)] };
    }
    return { action: "attack" };
  }

  // 玩家自動 AI(2026-11-10,項目 19 階段 1):只給玩家那一邊(side 1)用,怪物仍走上面的 decideAction。
  //   1. 大招點滿 + 魔力夠 → 放大招
  //   2. 否則魔力夠就放技能(不再 50% 隨機);兩個技能都付得起時挑花費較高的。
  //      例外:大招是治療型(巫醫)且大招點已 >= 85 時,放完技能會湊不出大招魔力就先普攻留魔力(模擬:這個職業不留魔反而變弱)
  //   3. 技能花費用「技能實際花費」(專精/覺醒技能 6~7 魔力),不是固定的 SKILL_MANA_COST
  //   4. 其餘普通攻擊
  function skillCostOf(state, slot) {
    const eff = slot === 1 ? state.skillEffectA1 : state.skillEffectB1;
    return (eff && eff.manaCost) || window.CareerData.SKILL_MANA_COST || 0;
  }
  // 技能的「總傷害倍率」(多段技能把每下加起來),跟普攻(1.0)比才知道值不值得花魔力
  const TUNE = { minMult: 0, healReserve: 60 };
  function skillValueOf(state, slot) {
    const CD = window.CareerData;
    const eff = slot === 1 ? state.skillEffectA1 : state.skillEffectB1;
    const lvl = slot === 1 ? state.skillLevel1 : state.skill2Level1;
    const base = eff && eff.mult != null ? eff.mult : CD.skillDmgMult ? CD.skillDmgMult(lvl) : CD.SKILL_DMG_MULT || 1.4;
    return base * ((eff && eff.hits) || 1);
  }
  function decidePlayerAction(state) {
    const CD = window.CareerData;
    const mp = state.mp1 || 0;
    const ultCost = Math.max(1, (CD.ULT_MANA_COST || 0) - (state.ultCostReduce1 || 0));
    const chargeReady = (state.ultCharge1 || 0) >= (CD.ULT_CHARGE_MAX || 100);
    const healUlt = state.ultEffect1 && state.ultEffect1.kind === "heal";
    if (chargeReady && mp >= ultCost) return { action: "ult" };
    const options = [];
    if (state.skillLevel1 > 0 && mp >= skillCostOf(state, 1)) options.push({ action: "skill1", cost: skillCostOf(state, 1), val: skillValueOf(state, 1) });
    if (state.skill2Level1 > 0 && mp >= skillCostOf(state, 2)) options.push({ action: "skill2", cost: skillCostOf(state, 2), val: skillValueOf(state, 2) });
    const worth = options.filter((o) => o.val >= TUNE.minMult);
    options.length = 0;
    worth.forEach((o) => options.push(o));
    if (options.length) {
      options.sort((a, b) => b.val - a.val);
      const pick = options[0];
      if (healUlt && (state.ultCharge1 || 0) >= TUNE.healReserve && mp - pick.cost < ultCost) return { action: "attack" };
      return { action: pick.action };
    }
    return { action: "attack" };
  }

  // playerSide: { classKey, stats }，monsterSide: { classKey, stats }
  // opts: { startHp, startMp, maxRounds } — 爬塔用持續HP/MP起始值，不帶就是滿血滿魔開打(神秘人切磋用這個);maxRounds = 回合上限(詞條用)
  function simulateFloorBattle(playerSide, monsterSide, opts) {
    opts = opts || {};
    let state = window.CareerEngine.initialMatchState(playerSide, monsterSide, { hp1: opts.startHp, mp1: opts.startMp });
    let rounds = 0;
    const limit = opts.maxRounds ? Math.min(opts.maxRounds, MAX_ROUNDS) : MAX_ROUNDS; // 詞條「打烊倒數」會把上限縮短,超過就算輸
    while (state.hp1 > 0 && state.hp2 > 0 && rounds < limit) {
      state.m1 = opts.legacyAi ? decideAction(state, 1) : decidePlayerAction(state);
      state.m2 = decideAction(state, 2);
      const result = window.CareerEngine.resolveRound(state);
      state = result.state;
      rounds += 1;
    }
    const won = state.hp2 <= 0 && state.hp1 > 0;
    return { won, state, log: state.log, endHp: state.hp1, endMp: state.mp1 };
  }

  return { simulateFloorBattle, decideAction, decidePlayerAction, skillCostOf, skillValueOf, TUNE };
})();
