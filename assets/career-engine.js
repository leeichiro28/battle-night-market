// 職業養成對決 · 戰鬥引擎(企劃書第七、十三節)
//
// 純函式,不碰 DOM、不碰資料庫,方便單獨測試。
// 判定順序照企劃書第十三節那張表:
//   1. 基礎傷害
//   2. (職業剋制加成 —— 目前 6 職業互不剋制,先跳過)
//   3. 全免疫型大招判定(守衛「銅牆鐵壁」放這裡)
//   4. (HP 門檻加成 —— 先不加)
//   5. 爆發型大招加成(戰士「怒吼衝鋒」/刺客「暗殺」/法師「魔力爆發」放這裡)
//   6. 被動疊加效果(破防打法/反擊姿態/連射訓練/致命節奏)
// 弓箭手「連環箭」不是加成,是整個攻擊流程多跑一次;巫醫「完全治癒」是平行分支,不搶傷害流程。
//
// 大招現在是「花魔力」而不是「整場限用一次」:魔力夠(見 CareerData.ULT_MANA_COST)就能用，
// 用了就扣魔力，每回合結束雙方各回一點魔力(CareerData.MANA_REGEN_PER_ROUND)，魔力不夠的話
// 就算選了大招也只會出普通攻擊(伺服器端這裡也會擋一次，不是只靠前端按鈕disable)。
//
// 技能樹 v2 Phase 4:大招不再是「這個職業固定就長這樣」，而是「裝備欄裡現在插的是哪一個節點」，
// 由呼叫端(db.js `_engineSide`)透過 CareerData.resolveUltInfo(classKey, equippedUltId) 算出
// { name, effect } 傳進來，這裡只認 effect.kind 是哪一種、不管是哪個職業——所以之後要加新職業、
// 新大招 kind，只要在 career-data.js 加資料，這個檔案幾乎不用動。
// 同理，主動技能欄從1個(戰技)擴充成2個(技能A/技能B)，兩個是完全平行的兩條資源(各自的等級、
// 各自的魔力判定)，用 slot 1/2 區分，不是誰比較強誰比較弱。
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

  // p1/p2 形狀(見 db.js `_engineSide`):
  //   { classKey, stats, skillLevel, skill2Level, ultEffect, ultName, critBonus, critDmgBonus,
  //     manaRegenBonus, ultCostReduce, mastery }
  // opts 可以帶 hp1/hp2/mp1/mp2 覆蓋起始值(爬塔用持續HP/MP，不帶的話(PVP預設)就是滿HP滿MP開打)。
  // skillLevel/skill2Level 是技能A/技能B的永久等級(0=沒解鎖，1~3=等級)，野怪不用帶(當作0)。
  // ultEffect 是目前裝備的大招效果(第22點更新第22.1段:大招也走「解鎖進池子→裝備」，
  // 沒帶就沒有大招可用，理論上不會發生，因為每個職業一定至少有預設大招)。
  function initialMatchState(p1, p2, opts) {
    opts = opts || {};
    const skillLevel1 = p1.skillLevel || 0;
    const skillLevel2 = p2.skillLevel || 0;
    const skill2Level1 = p1.skill2Level || 0;
    const skill2Level2 = p2.skill2Level || 0;
    return {
      round: 1,
      log: [],
      class1: p1.classKey,
      class2: p2.classKey,
      skillLevel1,
      skillLevel2,
      skillUnlocked1: skillLevel1 > 0, // 保留舊欄位給畫面判斷「技能A按鈕要不要顯示」用
      skillUnlocked2: skillLevel2 > 0,
      skill2Level1,
      skill2Level2,
      skill2Unlocked1: skill2Level1 > 0, // 技能B(第二主動技能)按鈕要不要顯示
      skill2Unlocked2: skill2Level2 > 0,
      ultEffect1: p1.ultEffect || { kind: "dmgMult", value: 1.3 },
      ultEffect2: p2.ultEffect || { kind: "dmgMult", value: 1.3 },
      ultName1: p1.ultName || (CD.CLASS_INFO[p1.classKey] && CD.CLASS_INFO[p1.classKey].ultName) || "大招",
      ultName2: p2.ultName || (CD.CLASS_INFO[p2.classKey] && CD.CLASS_INFO[p2.classKey].ultName) || "大招",
      critBonus1: p1.critBonus || 0,
      critBonus2: p2.critBonus || 0,
      critDmgBonus1: p1.critDmgBonus || 0, // 「爆擊強化」被動:暴擊傷害倍率額外加成(跟基礎x1.5疊加)
      critDmgBonus2: p2.critDmgBonus || 0,
      manaRegenBonus1: p1.manaRegenBonus || 0, // 「魔力充沛」被動:每回合結束多回幾點魔力
      manaRegenBonus2: p2.manaRegenBonus || 0,
      ultCostReduce1: p1.ultCostReduce || 0, // 「大招精修」被動:大招消耗魔力降低
      ultCostReduce2: p2.ultCostReduce || 0,
      mastery1: p1.mastery || {}, // 職業限定被動(第22點更新第二段):{ [effectKey]: 加成值 }
      mastery2: p2.mastery || {},
      atk1: p1.stats.atk,
      def1: p1.stats.def,
      spd1: p1.stats.spd,
      luck1: p1.stats.luck,
      matk1: p1.stats.matk || 0,
      maxhp1: p1.stats.maxHp,
      hp1: opts.hp1 != null ? Math.min(opts.hp1, p1.stats.maxHp) : p1.stats.maxHp,
      maxmp1: p1.stats.maxMp || 0,
      mp1: opts.mp1 != null ? Math.min(opts.mp1, p1.stats.maxMp || 0) : p1.stats.maxMp || 0,
      atk2: p2.stats.atk,
      def2: p2.stats.def,
      spd2: p2.stats.spd,
      luck2: p2.stats.luck,
      matk2: p2.stats.matk || 0,
      maxhp2: p2.stats.maxHp,
      hp2: opts.hp2 != null ? Math.min(opts.hp2, p2.stats.maxHp) : p2.stats.maxHp,
      maxmp2: p2.stats.maxMp || 0,
      mp2: opts.mp2 != null ? Math.min(opts.mp2, p2.stats.maxMp || 0) : p2.stats.maxMp || 0,
      m1: null,
      m2: null,
    };
  }

  // 對某一側算一次攻擊(普通攻擊 / 技能A / 技能B / 大招裡屬於「攻擊型」的那幾種)
  // 回傳 { dmg, crit }，defenderImmuneRatio > 0 時傷害按比例減免(守衛的兩種大招都是這個機制，
  // 只是減免比例不同:銅牆鐵壁90%、剛毅反擊50%)。
  // actionType: 'attack' | 'skill1' | 'skill2' | 'ult'。skillLevel 是這次用的技能等級(只有
  // isSkill 時有意義)，critBonus/critDmgBonus/mastery 意思跟以前一樣。
  // ultEffect 只有 actionType==='ult' 時有意義，是目前裝備的大招節點效果(見 initialMatchState 註解)。
  function computeAttackHit(atkStats, defStats, attackerClass, actionType, hpRatio, defenderImmuneRatio, skillLevel, critBonus, critDmgBonus, mastery, ultEffect) {
    mastery = mastery || {};
    const eff = CD.CLASS_EFFECTS[attackerClass];
    let ignoreDefRatio = (eff.ignoreDefRatio || 0) + (attackerClass === "warrior" ? mastery.ignoreDefRatio || 0 : 0); // 戰士線「破防打法」被動,普通攻擊也吃得到
    let dmgMult = 1;
    const isUlt = actionType === "ult";
    const isSkill = actionType === "skill1" || actionType === "skill2";
    let extraCrit = 0;
    let forceCrit = false;

    if (isUlt) {
      const kind = (ultEffect && ultEffect.kind) || "dmgMult";
      // 這幾種 kind 都是「這次攻擊傷害倍率怎麼算」，immune/heal 不會走到這裡(那兩種在
      // resolveRound 的 handleNonAttackUlt 處理，根本不會進攻擊流程)
      if (kind === "dmgMult") {
        dmgMult = (ultEffect && ultEffect.value) || 1;
        extraCrit = (ultEffect && ultEffect.extraCrit) || 0; // 例如法師「寒冰新星」順便加暴擊率
      } else if (kind === "ignoreDef") {
        dmgMult = 1;
        ignoreDefRatio = ultEffect && ultEffect.ignoreDefRatio != null ? ultEffect.ignoreDefRatio : 1;
      } else if (kind === "pierce") {
        dmgMult = (ultEffect && ultEffect.dmgMult) || 1;
        ignoreDefRatio = ultEffect && ultEffect.ignoreDefRatio != null ? ultEffect.ignoreDefRatio : ignoreDefRatio;
      } else if (kind === "lifesteal") {
        dmgMult = (ultEffect && ultEffect.dmgMult) || 1; // 回血的部分在 resolveRound 處理(這裡只算傷害)
      } else if (kind === "multiHit") {
        dmgMult = ultEffect && ultEffect.dmgMultPerHit != null ? ultEffect.dmgMultPerHit : 1; // 每一次的倍率(不是總倍率)
      } else if (kind === "guaranteedCritBelowHalf") {
        dmgMult = 1;
        forceCrit = typeof hpRatio === "number" && hpRatio <= 0.5; // 對方HP過半以下必定爆擊
      }
    } else if (isSkill) {
      dmgMult = CD.skillDmgMult ? CD.skillDmgMult(skillLevel) : CD.SKILL_DMG_MULT || 1.4; // 技能A/B:等級查表，等級越高倍率越高，兩個技能用同一張表
    }

    // 魔法系(法師/巫醫/還沒轉職的魔法系學徒)一律用魔攻算傷害，不是共用攻擊力
    const info = CD.CLASS_INFO[attackerClass];
    const isMagic = info && info.path === "magic";
    const primaryAtk = isMagic ? atkStats.matk : atkStats.atk;
    let dmg = baseDamage(primaryAtk, defStats.def, ignoreDefRatio);
    dmg *= dmgMult;
    if (isMagic && attackerClass === "mage") dmg *= 1 + (mastery.magicDmgBonus || 0); // 「法術精研」職業被動:只有正式轉職法師才有

    let crit = false;
    const critC = CD.critChance(atkStats, hpRatio, attackerClass, (critBonus || 0) + extraCrit, attackerClass === "assassin" ? mastery.lethalRhythmMax : 0);
    if (forceCrit) {
      crit = true;
    } else if (critC > 0 && Math.random() < critC) {
      crit = true;
    }
    if (crit) dmg *= CD.CRIT_DMG_MULT + (critDmgBonus || 0);

    if (defenderImmuneRatio > 0) dmg *= 1 - defenderImmuneRatio; // 銅牆鐵壁/剛毅反擊:這回合受到的傷害按比例減免

    dmg = Math.max(0, Math.round(dmg));
    return { dmg, crit };
  }

  // 主要進入點:雙方都送出這回合的動作(m1/m2 = { action: 'attack'|'skill1'|'skill2'|'ult' })後呼叫
  // 回傳新的 state(round+1、m1/m2 清空、魔力已回一點)以及這回合發生的事件陣列(給畫面播放大字用)
  function resolveRound(state) {
    const s = { ...state };
    const log = [...(s.log || [])];
    const m1 = s.m1 || { action: "attack" };
    const m2 = s.m2 || { action: "attack" };
    // 舊的行動指令可能還是 "skill"(切版前送出、或還沒重新整理的前端)，一律當成技能A
    if (m1.action === "skill") m1.action = "skill1";
    if (m2.action === "skill") m2.action = "skill1";
    const events = [];

    let hp1 = s.hp1;
    let hp2 = s.hp2;
    let mp1 = s.mp1 || 0;
    let mp2 = s.mp2 || 0;
    let immuneRatio1 = 0; // >0 表示這回合受到的傷害按比例減免(銅牆鐵壁0.9/剛毅反擊0.5)
    let immuneRatio2 = 0;
    let skip1 = false; // 這回合不出手攻擊(守衛「銅牆鐵壁」/巫醫「完全治癒」這種skipAttack:true的大招)
    let skip2 = false;

    const stats1 = { atk: s.atk1, def: s.def1, spd: s.spd1, luck: s.luck1, matk: s.matk1 || 0 };
    const stats2 = { atk: s.atk2, def: s.def2, spd: s.spd2, luck: s.luck2, matk: s.matk2 || 0 };

    // 這回合真的能不能用大招:選了 ult 而且魔力夠(伺服器端也擋一次，不是只靠前端disable按鈕)
    // 大招實際花費會被「大招精修」被動降低，但最低留1點魔力的門檻，不會被壓到0(不然大招變不用錢)
    function ultCost(side) {
      const reduce = side === 1 ? s.ultCostReduce1 : s.ultCostReduce2;
      return Math.max(1, CD.ULT_MANA_COST - (reduce || 0));
    }
    function canUlt(side) {
      const m = side === 1 ? m1 : m2;
      const mp = side === 1 ? mp1 : mp2;
      return m && m.action === "ult" && mp >= ultCost(side);
    }
    // slot: 1(技能A，沿用舊的"戰技") | 2(技能B，技能樹v2新開的第二個主動技能)
    function canSkillSlot(side, slot) {
      const m = side === 1 ? m1 : m2;
      const lvl = slot === 1 ? (side === 1 ? s.skillLevel1 : s.skillLevel2) : (side === 1 ? s.skill2Level1 : s.skill2Level2);
      const mp = side === 1 ? mp1 : mp2;
      return m && m.action === `skill${slot}` && lvl > 0 && mp >= CD.SKILL_MANA_COST;
    }
    function spendMana(side, amount) {
      if (side === 1) mp1 = Math.max(0, mp1 - amount);
      else mp2 = Math.max(0, mp2 - amount);
    }

    // ---- 位置3:非攻擊型大招(immune=全免疫/半免疫型、heal=治療型)。這兩種不是攻擊動作,先處理，
    // 免疫型如果 skipAttack!==false(預設大招都是)就不出手；skipAttack:false 的(例如守衛「剛毅反擊」)
    // 只拿防禦加成，這回合照樣輪到 performAttack 出手，只是這次不算大招傷害、就是一次普通攻擊。
    function handleNonAttackUlt(side) {
      if (!canUlt(side)) return;
      const ultEffect = side === 1 ? s.ultEffect1 : s.ultEffect2;
      const ultName = side === 1 ? s.ultName1 : s.ultName2;
      if (!ultEffect) return;
      if (ultEffect.kind === "immune") {
        spendMana(side, ultCost(side));
        const ratio = ultEffect.dmgReduceRatio != null ? ultEffect.dmgReduceRatio : 0.9;
        const willSkip = ultEffect.skipAttack !== false;
        if (side === 1) {
          immuneRatio1 = ratio;
          if (willSkip) skip1 = true;
        } else {
          immuneRatio2 = ratio;
          if (willSkip) skip2 = true;
        }
        events.push({
          side,
          type: "ult_shield",
          text: `${side === 1 ? "你" : "對方"}使出「${ultName}」,這回合受到的傷害-${Math.round(ratio * 100)}%${willSkip ? ",不出手" : ",但仍可攻擊"}!`,
        });
      } else if (ultEffect.kind === "heal") {
        spendMana(side, ultCost(side));
        const maxHp = side === 1 ? s.maxhp1 : s.maxhp2;
        const matk = side === 1 ? s.matk1 : s.matk2;
        const mastery = side === 1 ? s.mastery1 : s.mastery2;
        const healRatio = ultEffect.healRatio != null ? ultEffect.healRatio : 0.5;
        const heal = Math.round(maxHp * healRatio) + (CD.CLASS_EFFECTS.healer.healBonus || 0) + (mastery.healBonus || 0) + Math.round((matk || 0) * 1.5);
        const willSkip = ultEffect.skipAttack !== false;
        if (side === 1) {
          hp1 = Math.min(s.maxhp1, hp1 + heal);
          if (willSkip) skip1 = true;
        } else {
          hp2 = Math.min(s.maxhp2, hp2 + heal);
          if (willSkip) skip2 = true;
        }
        events.push({ side, type: "ult_heal", text: `${side === 1 ? "你" : "對方"}使出「${ultName}」,回復了 ${heal} 點 HP!` });
      }
    }
    handleNonAttackUlt(1);
    handleNonAttackUlt(2);

    // ---- 先攻順序:速度高的先手,同速 50/50 隨機決定(不是固定某一方永遠先手)
    let first = s.spd1 === s.spd2 ? (Math.random() < 0.5 ? 1 : 2) : s.spd1 > s.spd2 ? 1 : 2;
    const order = [first, first === 1 ? 2 : 1];

    function performAttack(side) {
      const skip = side === 1 ? skip1 : skip2;
      if (skip) return; // 這回合選了會跳過攻擊的大招(銅牆鐵壁/完全治癒這種)
      const defenderHp = side === 1 ? hp2 : hp1;
      if (defenderHp <= 0) return; // 對方已經陣亡,不用再打

      const cls = side === 1 ? s.class1 : s.class2;
      const atkStats = side === 1 ? stats1 : stats2;
      const defStats = side === 1 ? stats2 : stats1;
      const defenderImmuneRatio = side === 1 ? immuneRatio2 : immuneRatio1;
      const defMaxHp = side === 1 ? s.maxhp2 : s.maxhp1;
      const critBonus = side === 1 ? s.critBonus1 : s.critBonus2;
      const critDmgBonus = side === 1 ? s.critDmgBonus1 : s.critDmgBonus2;
      const mastery = side === 1 ? s.mastery1 : s.mastery2;
      const defenderMastery = side === 1 ? s.mastery2 : s.mastery1;
      const ultEffect = side === 1 ? s.ultEffect1 : s.ultEffect2;
      const ultName = side === 1 ? s.ultName1 : s.ultName2;

      // 這回合是不是真的要用大招當「攻擊型」動作:immune/heal 這兩種非攻擊型大招已經在
      // handleNonAttackUlt 處理過了(可能已經 spend 過魔力)，這裡不能重複觸發
      const isNonAttackUltKind = ultEffect && (ultEffect.kind === "immune" || ultEffect.kind === "heal");
      const wantsUlt = canUlt(side) && ultEffect && !isNonAttackUltKind;
      const wantsSkill1 = !wantsUlt && canSkillSlot(side, 1);
      const wantsSkill2 = !wantsUlt && !wantsSkill1 && canSkillSlot(side, 2);
      const actionType = wantsUlt ? "ult" : wantsSkill1 ? "skill1" : wantsSkill2 ? "skill2" : "attack";
      const skillLevel = actionType === "skill1" ? (side === 1 ? s.skillLevel1 : s.skillLevel2) : actionType === "skill2" ? (side === 1 ? s.skill2Level1 : s.skill2Level2) : 0;

      // 大招是「多打幾次」型(弓箭手「連環箭」預設2次、刺客「血影連斬」預設3次)才會跑多次迴圈,
      // 每次傷害倍率看 ultEffect.dmgMultPerHit(computeAttackHit 裡面會用到)
      const hits = wantsUlt && ultEffect.kind === "multiHit" ? ultEffect.hits || 1 : 1;
      if (wantsUlt) {
        spendMana(side, ultCost(side));
        events.push({ side, type: "ult_attack", text: `${side === 1 ? "你" : "對方"}使出「${ultName}」!` });
      } else if (wantsSkill1 || wantsSkill2) {
        spendMana(side, CD.SKILL_MANA_COST);
        const skillName = CD.skillSlotName ? CD.skillSlotName(cls, wantsSkill1 ? 1 : 2) : "戰技";
        events.push({ side, type: "skill_attack", text: `${side === 1 ? "你" : "對方"}使出技能「${skillName}」!` });
      }

      let lastDmg = 0;
      for (let i = 0; i < hits; i++) {
        const curDefHp = side === 1 ? hp2 : hp1;
        if (curDefHp <= 0) break;
        const curHpRatio = curDefHp / defMaxHp;
        const { dmg, crit } = computeAttackHit(atkStats, defStats, cls, actionType, curHpRatio, defenderImmuneRatio, skillLevel, critBonus, critDmgBonus, mastery, ultEffect);
        if (side === 1) hp2 = Math.max(0, hp2 - dmg);
        else hp1 = Math.max(0, hp1 - dmg);
        lastDmg = dmg;

        events.push({
          side,
          type: "attack",
          dmg,
          crit,
          multi: hits > 1 ? i + 1 : null,
          text: `${side === 1 ? "你" : "對方"}${crit ? "爆擊" : ""}造成 ${dmg} 點傷害!`,
        });

        // 敏捷系「連射訓練」被動:普通攻擊(非大招/技能)才有機會觸發追加一擊,跟連環箭是兩回事
        if (actionType === "attack" && cls === "archer" && Math.random() < (CD.CLASS_EFFECTS.archer.extraHitChance || 0) + (mastery.extraHitChance || 0)) {
          const curDefHp2 = side === 1 ? hp2 : hp1;
          if (curDefHp2 > 0) {
            const extra = computeAttackHit(atkStats, defStats, cls, "attack", curDefHp2 / defMaxHp, defenderImmuneRatio, skillLevel, critBonus, critDmgBonus, mastery, null);
            if (side === 1) hp2 = Math.max(0, hp2 - extra.dmg);
            else hp1 = Math.max(0, hp1 - extra.dmg);
            events.push({ side, type: "extra_hit", dmg: extra.dmg, text: `${side === 1 ? "你" : "對方"}的連射訓練觸發,追加造成 ${extra.dmg} 點傷害!` });
          }
        }
      }

      // 「血戰怒吼」(戰士大招2):吸血，用剛剛最後一次攻擊造成的傷害去算回血量
      if (wantsUlt && ultEffect.kind === "lifesteal" && lastDmg > 0) {
        const lifesteal = Math.round(lastDmg * (ultEffect.lifestealRatio || 0));
        if (lifesteal > 0) {
          if (side === 1) hp1 = Math.min(s.maxhp1, hp1 + lifesteal);
          else hp2 = Math.min(s.maxhp2, hp2 + lifesteal);
          events.push({ side, type: "lifesteal", dmg: lifesteal, text: `${side === 1 ? "你" : "對方"}吸取了 ${lifesteal} 點HP!` });
        }
      }

      // 力量系「反擊姿態」被動:守衛被普通攻擊命中時,15% 機率反傷(用剛剛造成的傷害量反打回去)。
      // 守衛這回合如果正在用大招防禦(immuneRatio>0，不管是銅牆鐵壁還是剛毅反擊)，這個被動這回合不觸發，
      // 算是「已經用了大招的防禦效果，反擊姿態這回合讓位」
      const defenderClass = side === 1 ? s.class2 : s.class1;
      const defenderOwnImmuneRatio = side === 1 ? immuneRatio2 : immuneRatio1;
      if (actionType === "attack" && defenderClass === "guardian" && !(defenderOwnImmuneRatio > 0)) {
        const lastEvent = events[events.length - 1];
        if (lastEvent && lastEvent.type === "attack" && lastEvent.dmg > 0 && Math.random() < (CD.CLASS_EFFECTS.guardian.counterChance || 0) + (defenderMastery.counterChance || 0)) {
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
    if (s.class1 === "healer" && hp1 > 0) hp1 = Math.min(s.maxhp1, hp1 + (CD.CLASS_EFFECTS.healer.regenPerRound || 0) + (s.mastery1.regenBonus || 0));
    if (s.class2 === "healer" && hp2 > 0) hp2 = Math.min(s.maxhp2, hp2 + (CD.CLASS_EFFECTS.healer.regenPerRound || 0) + (s.mastery2.regenBonus || 0));

    // 每回合結束雙方各回魔力(基礎值 + 各自「魔力充沛」被動的加成，不管這回合有沒有用大招)
    mp1 = Math.min(s.maxmp1 || 0, mp1 + (CD.MANA_REGEN_PER_ROUND || 0) + (s.manaRegenBonus1 || 0));
    mp2 = Math.min(s.maxmp2 || 0, mp2 + (CD.MANA_REGEN_PER_ROUND || 0) + (s.manaRegenBonus2 || 0));

    const entrySummary = `第${s.round}回合:` + events.map((e) => e.text).join(" ");
    log.push(entrySummary);

    const newState = {
      ...s,
      hp1,
      hp2,
      mp1,
      mp2,
      round: s.round + 1,
      m1: null,
      m2: null,
      log,
    };
    return { state: newState, events };
  }

  return { initialMatchState, resolveRound, baseDamage };
})();
