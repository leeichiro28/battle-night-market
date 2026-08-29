// 職業養成對決 · 戰鬥引擎(企劃書第七、十三節)
//
// 純函式,不碰 DOM、不碰資料庫,方便 Phase1「驗證引擎」單獨測試。
// 判定順序照企劃書第十三節那張表:
//   1. 基礎傷害
//   2. (職業剋制加成 —— 目前 6 職業互不剋制,先跳過)
//   3. 全免疫型大招判定(守衛「銅牆鐵壁」放這裡)
//   4. (HP 門檻加成 —— Phase1 先不加)
//   5. 爆發型大招加成(戰士「怒吼衝鋒」/刺客「暗殺」/法師「魔力爆發」放這裡)
//   6. 被動疊加效果(破防打法/反擊姿態/連射訓練/致命節奏)
// 弓箭手「連環箭」不是加成,是整個攻擊流程多跑一次;巫醫「完全治癒」是平行分支,不搶傷害流程。
window.CareerEngine = (function () {
  const CD = window.CareerData;

  function randFloat() {
    return 1 + Math.floor(Math.random() * 3); // 隨機浮動 1~3
  }

  // 普通攻擊傷害 = max(1, 攻擊力 − 防禦力/2) + 隨機浮動(1~3)(企劃書第七節)
  function baseDamage(atk, def, ignoreDefRatio) {
    const effDef = ignoreDefRatio ? def * (1 - ignoreDefRatio) : def;
    return Math.max(1, atk - effDef / 2) + randFloat();
  }

  function initialMatchState(p1, p2) {
    // p1/p2: { classKey, stats }
    const c1 = CD.CLASS_INFO[p1.classKey];
    const c2 = CD.CLASS_INFO[p2.classKey];
    return {
      round: 1,
      log: [],
      class1: p1.classKey,
      class2: p2.classKey,
      atk1: p1.stats.atk,
      def1: p1.stats.def,
      spd1: p1.stats.spd,
      luck1: p1.stats.luck,
      maxhp1: p1.stats.maxHp,
      hp1: p1.stats.maxHp,
      atk2: p2.stats.atk,
      def2: p2.stats.def,
      spd2: p2.stats.spd,
      luck2: p2.stats.luck,
      maxhp2: p2.stats.maxHp,
      hp2: p2.stats.maxHp,
      ultUsed1: false,
      ultUsed2: false,
      m1: null,
      m2: null,
    };
  }

  // 對某一側算一次攻擊(普通攻擊 或 大招裡屬於「攻擊型」的那幾種:戰士/刺客/法師/弓箭手)
  // 回傳 { dmg, crit, log }，defenderImmune 為 true 時傷害直接打 9 折減免(守衛銅牆鐵壁)
  function computeAttackHit(attackerName, defenderName, atkStats, defStats, attackerClass, isUlt, hpRatio, defenderImmune) {
    const eff = CD.CLASS_EFFECTS[attackerClass];
    let ignoreDefRatio = eff.ignoreDefRatio || 0; // 戰士線「破防打法」被動,普通攻擊也吃得到
    let dmgMult = 1;

    if (isUlt) {
      if (attackerClass === "warrior") dmgMult = 2; // 怒吼衝鋒:本回合傷害x2
      else if (attackerClass === "mage") ignoreDefRatio = 1; // 魔力爆發:無視防禦
      else if (attackerClass === "novice") dmgMult = CD.CLASS_EFFECTS.novice.ultDamageMult || 1.3; // 拼盡全力:還沒轉職，大招比較弱
      // assassin(暗殺)、archer(連環箭)的大招效果在呼叫端另外處理(必爆/多打一次)
    }

    let dmg = baseDamage(atkStats.atk, defStats.def, ignoreDefRatio);
    if (attackerClass === "mage" && isUlt) dmg += CD.CLASS_EFFECTS.mage.skillDmgBonus || 0;
    dmg *= dmgMult;

    let crit = false;
    if (isUlt && attackerClass === "assassin" && hpRatio <= 0.5) {
      crit = true; // 暗殺:對方HP過半以下必定爆擊
    } else if (CD.critChance(atkStats, hpRatio, attackerClass) > 0 && Math.random() < CD.critChance(atkStats, hpRatio, attackerClass)) {
      crit = true;
    }
    if (crit) dmg *= CD.CRIT_DMG_MULT;

    if (defenderImmune) dmg *= 0.1; // 銅牆鐵壁:這回合受到的傷害 -90%

    dmg = Math.max(0, Math.round(dmg));
    return { dmg, crit };
  }

  // 主要進入點:雙方都送出這回合的動作(m1/m2 = { action: 'attack' | 'ult' })後呼叫
  // 回傳新的 state(round+1、m1/m2 清空)以及這回合發生的事件陣列(給畫面播放大字用)
  function resolveRound(state) {
    const s = { ...state };
    const log = [...(s.log || [])];
    const m1 = s.m1 || { action: "attack" };
    const m2 = s.m2 || { action: "attack" };
    const events = [];

    let hp1 = s.hp1;
    let hp2 = s.hp2;
    let ultUsed1 = !!s.ultUsed1;
    let ultUsed2 = !!s.ultUsed2;
    let immune1 = false;
    let immune2 = false;
    let skip1 = false; // 這回合不出手攻擊(守衛防禦型大招 / 巫醫治療型大招)
    let skip2 = false;

    const stats1 = { atk: s.atk1, def: s.def1, spd: s.spd1, luck: s.luck1 };
    const stats2 = { atk: s.atk2, def: s.def2, spd: s.spd2, luck: s.luck2 };

    // ---- 位置3:全免疫型大招(守衛) + 平行分支:治療型大招(巫醫)。兩者都不是攻擊動作,先處理。
    function handleNonAttackUlt(side) {
      const m = side === 1 ? m1 : m2;
      const cls = side === 1 ? s.class1 : s.class2;
      const used = side === 1 ? ultUsed1 : ultUsed2;
      if (!m || m.action !== "ult" || used) return;
      if (cls === "guardian") {
        if (side === 1) {
          ultUsed1 = true;
          immune1 = true;
          skip1 = true;
        } else {
          ultUsed2 = true;
          immune2 = true;
          skip2 = true;
        }
        events.push({ side, type: "ult_shield", text: `${side === 1 ? "你" : "對方"}使出「銅牆鐵壁」,這回合幾乎不受傷!` });
      } else if (cls === "healer") {
        const maxHp = side === 1 ? s.maxhp1 : s.maxhp2;
        const heal = Math.round(maxHp * 0.5) + (CD.CLASS_EFFECTS.healer.healBonus || 0);
        if (side === 1) {
          hp1 = Math.min(s.maxhp1, hp1 + heal);
          ultUsed1 = true;
          skip1 = true;
        } else {
          hp2 = Math.min(s.maxhp2, hp2 + heal);
          ultUsed2 = true;
          skip2 = true;
        }
        events.push({ side, type: "ult_heal", text: `${side === 1 ? "你" : "對方"}使出「完全治癒」,回復了 ${heal} 點 HP!` });
      }
    }
    handleNonAttackUlt(1);
    handleNonAttackUlt(2);

    // ---- 先攻順序:速度高的先手,同速 50/50 隨機決定(不是固定某一方永遠先手)
    let first = s.spd1 === s.spd2 ? (Math.random() < 0.5 ? 1 : 2) : s.spd1 > s.spd2 ? 1 : 2;
    const order = [first, first === 1 ? 2 : 1];

    function performAttack(side) {
      const skip = side === 1 ? skip1 : skip2;
      if (skip) return; // 這回合選了防禦/治療型大招,不出手攻擊
      const defenderHp = side === 1 ? hp2 : hp1;
      if (defenderHp <= 0) return; // 對方已經陣亡,不用再打

      const m = side === 1 ? m1 : m2;
      const cls = side === 1 ? s.class1 : s.class2;
      const used = side === 1 ? ultUsed1 : ultUsed2;
      const atkStats = side === 1 ? stats1 : stats2;
      const defStats = side === 1 ? stats2 : stats1;
      const defenderImmune = side === 1 ? immune2 : immune1;
      const defMaxHp = side === 1 ? s.maxhp2 : s.maxhp1;
      const defHpNow = side === 1 ? hp2 : hp1;
      const hpRatio = defHpNow / defMaxHp;

      const wantsUlt = m && m.action === "ult" && !used && ["warrior", "assassin", "mage", "archer", "novice"].includes(cls);

      // 弓箭手「連環箭」獨立處理:整個攻擊流程多跑一次(不是傷害加成),
      // 第二次攻擊前要重新確認對方是不是已經被第一次打死了
      const hits = wantsUlt && cls === "archer" ? 2 : 1;
      if (wantsUlt) {
        if (side === 1) ultUsed1 = true;
        else ultUsed2 = true;
        events.push({ side, type: "ult_attack", text: `${side === 1 ? "你" : "對方"}使出「${CD.CLASS_INFO[cls].ultName}」!` });
      }

      for (let i = 0; i < hits; i++) {
        const curDefHp = side === 1 ? hp2 : hp1;
        if (curDefHp <= 0) break;
        const curHpRatio = curDefHp / defMaxHp;
        const { dmg, crit } = computeAttackHit(null, null, atkStats, defStats, cls, wantsUlt, curHpRatio, defenderImmune);
        if (side === 1) hp2 = Math.max(0, hp2 - dmg);
        else hp1 = Math.max(0, hp1 - dmg);

        events.push({
          side,
          type: "attack",
          dmg,
          crit,
          multi: hits > 1 ? i + 1 : null,
          text: `${side === 1 ? "你" : "對方"}${crit ? "爆擊" : ""}造成 ${dmg} 點傷害!`,
        });

        // 敏捷系「連射訓練」被動:普通攻擊(非大招)才有機會觸發追加一擊,跟連環箭是兩回事
        if (!wantsUlt && cls === "archer" && Math.random() < (CD.CLASS_EFFECTS.archer.extraHitChance || 0)) {
          const curDefHp2 = side === 1 ? hp2 : hp1;
          if (curDefHp2 > 0) {
            const extra = computeAttackHit(null, null, atkStats, defStats, cls, false, curDefHp2 / defMaxHp, defenderImmune);
            if (side === 1) hp2 = Math.max(0, hp2 - extra.dmg);
            else hp1 = Math.max(0, hp1 - extra.dmg);
            events.push({ side, type: "extra_hit", dmg: extra.dmg, text: `${side === 1 ? "你" : "對方"}的連射訓練觸發,追加造成 ${extra.dmg} 點傷害!` });
          }
        }
      }

      // 力量系「反擊姿態」被動:守衛被普通攻擊命中時,15% 機率反傷(用剛剛造成的傷害量反打回去)
      const defenderClass = side === 1 ? s.class2 : s.class1;
      if (!wantsUlt && defenderClass === "guardian" && !defenderImmune) {
        const lastEvent = events[events.length - 1];
        if (lastEvent && lastEvent.type === "attack" && lastEvent.dmg > 0 && Math.random() < (CD.CLASS_EFFECTS.guardian.counterChance || 0)) {
          const counterDmg = lastEvent.dmg;
          if (side === 1) hp1 = Math.max(0, hp1 - counterDmg);
          else hp2 = Math.max(0, hp2 - counterDmg);
          events.push({ side: side === 1 ? 2 : 1, type: "counter", dmg: counterDmg, text: `${side === 1 ? "對方" : "你"}觸發反擊姿態,反彈了 ${counterDmg} 點傷害!` });
        }
      }
    }

    performAttack(order[0]);
    performAttack(order[1]);

    // 魔法系「延壽術」被動:巫醫每回合結束小量回血(即使這回合沒用大招也生效)
    if (s.class1 === "healer" && hp1 > 0) hp1 = Math.min(s.maxhp1, hp1 + (CD.CLASS_EFFECTS.healer.regenPerRound || 0));
    if (s.class2 === "healer" && hp2 > 0) hp2 = Math.min(s.maxhp2, hp2 + (CD.CLASS_EFFECTS.healer.regenPerRound || 0));

    const entrySummary = `第${s.round}回合:` + events.map((e) => e.text).join(" ");
    log.push(entrySummary);

    const newState = {
      ...s,
      hp1,
      hp2,
      ultUsed1,
      ultUsed2,
      round: s.round + 1,
      m1: null,
      m2: null,
      log,
    };
    return { state: newState, events };
  }

  return { initialMatchState, resolveRound, baseDamage };
})();
