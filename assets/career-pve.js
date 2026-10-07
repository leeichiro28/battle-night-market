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

  // playerSide: { classKey, stats }，monsterSide: { classKey, stats }
  // opts: { startHp, startMp } — 爬塔用持續HP/MP起始值，不帶就是滿血滿魔開打(神秘人切磋用這個)
  function simulateFloorBattle(playerSide, monsterSide, opts) {
    opts = opts || {};
    let state = window.CareerEngine.initialMatchState(playerSide, monsterSide, { hp1: opts.startHp, mp1: opts.startMp });
    let rounds = 0;
    while (state.hp1 > 0 && state.hp2 > 0 && rounds < MAX_ROUNDS) {
      state.m1 = decideAction(state, 1);
      state.m2 = decideAction(state, 2);
      const result = window.CareerEngine.resolveRound(state);
      state = result.state;
      rounds += 1;
    }
    const won = state.hp2 <= 0 && state.hp1 > 0;
    return { won, state, log: state.log, endHp: state.hp1, endMp: state.mp1 };
  }

  return { simulateFloorBattle, decideAction };
})();
