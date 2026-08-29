// 職業養成對決 · 爬塔野怪戰鬥(企劃書第十三節:「AI對手直接算」，不用像PVP那樣等對方回合)
//
// 玩家固定是 side1、野怪固定是 side2，雙方動作都用簡單規則自動決定，整場一次算完，
// 回傳完整回合紀錄讓畫面用「戰報」方式播放，跟 PVP 共用同一套 CareerEngine.resolveRound。
window.CareerPve = (function () {
  const MAX_ROUNDS = 30; // 安全上限，理論上 5~8 回合內就會分出勝負(企劃書第七節)

  // 簡單 AI:有大招可用、且(對方HP已經過半以下 或 隨機機率命中)就放大招，否則普通攻擊
  function decideAction(state, side) {
    const used = side === 1 ? state.ultUsed1 : state.ultUsed2;
    if (used) return { action: "attack" };
    const defHp = side === 1 ? state.hp2 : state.hp1;
    const defMaxHp = side === 1 ? state.maxhp2 : state.maxhp1;
    const hpRatio = defMaxHp > 0 ? defHp / defMaxHp : 1;
    if (hpRatio <= 0.5 || Math.random() < 0.3) return { action: "ult" };
    return { action: "attack" };
  }

  // playerSide: { classKey, stats }，monsterSide: { classKey, stats }
  function simulateFloorBattle(playerSide, monsterSide) {
    let state = window.CareerEngine.initialMatchState(playerSide, monsterSide);
    let rounds = 0;
    while (state.hp1 > 0 && state.hp2 > 0 && rounds < MAX_ROUNDS) {
      state.m1 = decideAction(state, 1);
      state.m2 = decideAction(state, 2);
      const result = window.CareerEngine.resolveRound(state);
      state = result.state;
      rounds += 1;
    }
    const won = state.hp2 <= 0 && state.hp1 > 0;
    return { won, state, log: state.log };
  }

  return { simulateFloorBattle };
})();
