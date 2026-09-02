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

  // 簡單 AI:魔力夠、且(對方HP已經過半以下 或 隨機機率命中)就放大招，否則普通攻擊
  function decideAction(state, side) {
    const mp = side === 1 ? state.mp1 : state.mp2;
    if ((mp || 0) < (window.CareerData.ULT_MANA_COST || 0)) return { action: "attack" };
    const defHp = side === 1 ? state.hp2 : state.hp1;
    const defMaxHp = side === 1 ? state.maxhp2 : state.maxhp1;
    const hpRatio = defMaxHp > 0 ? defHp / defMaxHp : 1;
    if (hpRatio <= 0.5 || Math.random() < 0.3) return { action: "ult" };
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
