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

  // 專精(第二轉職,見 career-spec.js)被動合併:把 spec.masteryAdd 疊進職業被動 mastery(逐欄位相加)
  function mergeMastery(base, add) {
    const out = { ...(base || {}) };
    Object.keys(add || {}).forEach((k) => (out[k] = (out[k] || 0) + add[k]));
    return out;
  }
  function combineReduce(a, b) {
    return 1 - (1 - (a || 0)) * (1 - (b || 0));
  }

  // 遺物「半截筷子」反擊時反彈的傷害比例(見下面 resolveRound 的反擊段;數值要跟 career-relics.js 的說明一致)
  const RELIC_COUNTER_RATIO = 0.35;

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
      // 技能A/B現在可能裝備任何一個候選技能(不是固定1號2號)，顯示名稱由呼叫端(db.js `_engineSide`)
      // 從目前裝備的節點算好傳進來；沒帶到就退回舊的 CD.SKILL_NAME(給野怪/沒有裝備欄概念的情況用)
      skillAName1: p1.skillAName || CD.SKILL_NAME[p1.classKey] || "戰技",
      skillAName2: p2.skillAName || CD.SKILL_NAME[p2.classKey] || "戰技",
      skillBName1: p1.skillBName || "技能B",
      skillBName2: p2.skillBName || "技能B",
      // 專精(第二轉職,見 career-spec.js):p.spec = 已解析的專精被動、p.skillEffectA/B = 專精技能的效果。
      // 被動裡能直接併進現有欄位的(mastery/暴擊/減傷)在這裡合併,不用在每個計算點各寫一次;
      // 其餘(berserk/reflect/中毒加成...)留在 spec1/spec2 給回合結算讀。沒帶專精就跟以前完全一樣。
      spec1: p1.spec || null,
      spec2: p2.spec || null,
      // 套裝效果(60/70 層 Boss 套裝,見 career-floors.js SET_BONUSES):舊相片套裝「致命傷害保留 1 點 HP(每場一次)」、
      // 第零攤套裝「第一回合必定暴擊」。surviveUsed = 這場是否已經用掉保命機會。
      // 術法傷害倍率(樓層詞條「雨天濕滑」,見 career-affixes.js):只乘在「法術類」職業的攻擊上,沒帶就是 null
      magicMult1: p1.magicMult == null ? null : p1.magicMult,
      magicMult2: p2.magicMult == null ? null : p2.magicMult,
      surviveOnce1: !!p1.surviveOnce,
      surviveOnce2: !!p2.surviveOnce,
      surviveUsed1: false,
      surviveUsed2: false,
      firstRoundCrit1: !!p1.firstRoundCrit,
      firstRoundCrit2: !!p2.firstRoundCrit,
      // 遺物(見 career-relics.js):第一回合必定先手 / 暴擊時回魔 / 被普攻命中時機率反擊(任何職業)。沒帶就是 0,跟以前完全一樣。
      firstStrike1: !!p1.firstStrike,
      firstStrike2: !!p2.firstStrike,
      manaOnCrit1: p1.manaOnCrit || 0,
      manaOnCrit2: p2.manaOnCrit || 0,
      relicCounter1: p1.relicCounter || 0,
      relicCounter2: p2.relicCounter || 0,
      skillEffectA1: p1.skillEffectA || null,
      skillEffectA2: p2.skillEffectA || null,
      skillEffectB1: p1.skillEffectB || null,
      skillEffectB2: p2.skillEffectB || null,
      poison1: null, // 中毒:{ dmg, rounds },施加在被打的那一側,每回合結束扣血
      poison2: null,
      debuffs1: [], // 減益:[{ stat:'atk'|'def', ratio, rounds, fresh }],下一回合開始生效
      debuffs2: [],
      critBonus1: (p1.critBonus || 0) + ((p1.spec && p1.spec.critBonus) || 0),
      critBonus2: (p2.critBonus || 0) + ((p2.spec && p2.spec.critBonus) || 0),
      critDmgBonus1: (p1.critDmgBonus || 0) + ((p1.spec && p1.spec.critDmgBonus) || 0), // 「爆擊強化」被動:暴擊傷害倍率額外加成(跟基礎x1.5疊加)
      critDmgBonus2: (p2.critDmgBonus || 0) + ((p2.spec && p2.spec.critDmgBonus) || 0),
      // P2-2/P2-3新增:傳說裝備特殊效果統一走這兩個通用管道，不分職業都吃得到(跟上面
      // critBonus/critDmgBonus同一種設計，不像 mastery 是特定職業才會讀取的專屬被動)。
      // lifestealOnHit:每次攻擊命中(不管普攻/技能/大招)都按造成傷害的比例回血。
      // dmgReduceRatio:被打的時候固定按比例減傷，見 computeAttackHit 的 defenderDmgReduceRatio。
      lifestealOnHit1: p1.lifestealOnHit || 0,
      lifestealOnHit2: p2.lifestealOnHit || 0,
      dmgReduceRatio1: combineReduce(p1.dmgReduceRatio, p1.spec && p1.spec.dmgReduce),
      dmgReduceRatio2: combineReduce(p2.dmgReduceRatio, p2.spec && p2.spec.dmgReduce),
      manaRegenBonus1: p1.manaRegenBonus || 0, // 「魔力充沛」被動:每回合結束多回幾點魔力
      manaRegenBonus2: p2.manaRegenBonus || 0,
      ultCostReduce1: p1.ultCostReduce || 0, // 「大招精修」被動:大招消耗魔力降低
      ultCostReduce2: p2.ultCostReduce || 0,
      mastery1: mergeMastery(p1.mastery, p1.spec && p1.spec.masteryAdd), // 職業限定被動(第22點更新第二段):{ [effectKey]: 加成值 }
      mastery2: mergeMastery(p2.mastery, p2.spec && p2.spec.masteryAdd),
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
      ultCharge1: opts.ultCharge1 || 0, // 大招點(怒氣):滿了才能放大招，每場戰鬥從0開始
      ultCharge2: opts.ultCharge2 || 0,
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
  function computeAttackHit(atkStats, defStats, attackerClass, actionType, hpRatio, defenderImmuneRatio, skillLevel, critBonus, critDmgBonus, mastery, ultEffect, defenderDmgReduceRatio, extra) {
    mastery = mastery || {};
    extra = extra || {};
    const skillEff = extra.skillEffect || null; // 專精技能的附帶效果(沒帶就是舊行為)
    const spec = extra.spec || null;
    // 第零攤套裝:第一回合的每一次攻擊(普攻/技能/大招)必定暴擊
    const eff = CD.CLASS_EFFECTS[attackerClass];
    let ignoreDefRatio = (eff.ignoreDefRatio || 0) + (attackerClass === "warrior" ? mastery.ignoreDefRatio || 0 : 0); // 戰士線「破防打法」被動,普通攻擊也吃得到
    let dmgMult = 1;
    const isUlt = actionType === "ult";
    const isSkill = actionType === "skill1" || actionType === "skill2";
    let extraCrit = 0;
    let forceCrit = !!extra.forceCrit; // 第零攤套裝:第一回合必定暴擊(其他情況由各技能自己決定)

    if (isUlt) {
      const kind = (ultEffect && ultEffect.kind) || "dmgMult";
      // 這幾種 kind 都是「這次攻擊傷害倍率怎麼算」，immune/heal 不會走到這裡(那兩種在
      // resolveRound 的 handleNonAttackUlt 處理，根本不會進攻擊流程)
      if (kind === "dmgMult") {
        dmgMult = (ultEffect && ultEffect.value) || 1;
        extraCrit = (ultEffect && ultEffect.extraCrit) || 0; // 例如法師「寒冰新星」順便加暴擊率
      } else if (kind === "ignoreDef") {
        dmgMult = ultEffect && ultEffect.value != null ? ultEffect.value : 1; // 無視防禦本身固定100%，升級後這裡會>1(額外傷害倍率)
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
    } else if (isSkill && skillEff) {
      // 專精技能:倍率已經依技能等級算好(career-spec.js resolveSkill),這裡處理附帶效果
      dmgMult = skillEff.mult || 1;
      if (skillEff.ignoreDef) ignoreDefRatio = Math.min(1, ignoreDefRatio + skillEff.ignoreDef);
      if (skillEff.extraCrit) extraCrit += skillEff.extraCrit;
      if (skillEff.forceCritBelow && typeof hpRatio === "number" && hpRatio <= skillEff.forceCritBelow) forceCrit = true;
      if (skillEff.lowHp && typeof hpRatio === "number" && hpRatio <= skillEff.lowHp.below) dmgMult = skillEff.lowHp.mult;
      if (skillEff.missingHpBonusMax) dmgMult *= 1 + skillEff.missingHpBonusMax * (1 - (extra.selfHpRatio == null ? 1 : extra.selfHpRatio));
    } else if (isSkill) {
      dmgMult = CD.skillDmgMult ? CD.skillDmgMult(skillLevel) : CD.SKILL_DMG_MULT || 1.4; // 技能A/B:等級查表，等級越高倍率越高，兩個技能用同一張表
    }

    // 魔法系(法師/巫醫/還沒轉職的魔法系學徒)一律用魔攻算傷害，不是共用攻擊力
    const info = CD.CLASS_INFO[attackerClass];
    const isMagic = info && info.path === "magic";
    const primaryAtk = isMagic ? atkStats.matk : atkStats.atk;
    let dmg = baseDamage(primaryAtk, defStats.def, ignoreDefRatio);
    dmg *= dmgMult;
    if (spec) {
      // 專精被動(只有選了對應分支才會有這些欄位)
      if (spec.berserk && extra.selfHpRatio != null) dmg *= 1 + Math.min(spec.berserk.max, Math.floor((1 - extra.selfHpRatio) * 10) * spec.berserk.perTen); // 狂戰:越痛越強
      if (spec.singleSkillBonus && isSkill && (extra.hits || 1) === 1) dmg *= 1 + spec.singleSkillBonus; // 爆裂:單次技能
      if (spec.multiHitBonus && ((isSkill && (extra.hits || 1) > 1) || (isUlt && ultEffect && ultEffect.kind === "multiHit"))) dmg *= 1 + spec.multiHitBonus; // 連鎖:多段
    }
    if (isMagic && extra.magicMult != null) dmg *= extra.magicMult; // 詞條「雨天濕滑」:法術類職業(雙方)傷害打折
    if (isMagic && attackerClass === "mage") dmg *= 1 + (mastery.magicDmgBonus || 0); // 「法術精研」職業被動:只有正式轉職法師才有

    let crit = false;
    const critC = CD.critChance(atkStats, hpRatio, attackerClass, (critBonus || 0) + extraCrit, attackerClass === "assassin" ? mastery.lethalRhythmMax : 0);
    if (forceCrit) {
      crit = true;
    } else if (critC > 0 && Math.random() < critC) {
      crit = true;
    }
    // guaranteedCritBelowHalf(暗殺)升級後機率不會變(本來就保證觸發)，改成疊加額外爆擊傷害倍率(ultEffect.critDmgBonus)
    const ultCritDmgBonus = isUlt && ultEffect && ultEffect.critDmgBonus ? ultEffect.critDmgBonus : 0;
    if (crit) dmg *= CD.CRIT_DMG_MULT + (critDmgBonus || 0) + ultCritDmgBonus;

    if (defenderImmuneRatio > 0) dmg *= 1 - defenderImmuneRatio; // 銅牆鐵壁/剛毅反擊:這回合受到的傷害按比例減免
    // P2-3新增:傳說防具的「傷害減免」特殊效果，跟大招免傷是分開的兩件事——大招免傷只有那個回合
    // 有效，這個是被動的、每次挨打都固定減免，兩者可以疊加(公式上是連乘，不是相加，數值都不大
    // 所以差異很小，這樣寫比較單純)。
    if (defenderDmgReduceRatio > 0) dmg *= 1 - defenderDmgReduceRatio;

    dmg = Math.max(0, Math.round(dmg));
    return { dmg, crit };
  }

  // 主要進入點:雙方都送出這回合的動作(m1/m2 = { action: 'attack'|'skill1'|'skill2'|'ult' })後呼叫
  // 回傳新的 state(round+1、m1/m2 清空、魔力已回一點)以及這回合發生的事件陣列(給畫面播放大字用)
  function resolveRound(state) {
    const s = { ...state };
    const log = [...(s.log || [])];
    // 複製一份再改，不要動到傳進來的 state.m1/m2(B4)
    const m1 = { ...(s.m1 || { action: "attack" }) };
    const m2 = { ...(s.m2 || { action: "attack" }) };
    // 舊的行動指令可能還是 "skill"(切版前送出、或還沒重新整理的前端)，一律當成技能A
    if (m1.action === "skill") m1.action = "skill1";
    if (m2.action === "skill") m2.action = "skill1";
    // 輪替擂台規則(見 career-modifiers.js ARENA_RULES,存在 state.arenaRule,整場固定):
    // noult 禁大招;limited 只能用普攻與技能A(技能B、大招都禁)。被禁的招式當普通攻擊處理
    // (畫面會把按鈕灰掉,這裡是保險,也擋掉代打與還沒重新整理的舊分頁)。沒有 arenaRule 就跟以前完全一樣。
    if (s.arenaRule === "noult" || s.arenaRule === "limited") {
      if (m1.action === "ult") m1.action = "attack";
      if (m2.action === "ult") m2.action = "attack";
    }
    if (s.arenaRule === "limited") {
      if (m1.action === "skill2") m1.action = "attack";
      if (m2.action === "skill2") m2.action = "attack";
    }
    const events = [];

    let hp1 = s.hp1;
    let hp2 = s.hp2;
    // 保命:套裝「致命傷害保留 1 點 HP(每場一次)」。每個扣血的地方之後都要呼叫,這樣「被打到 0 就不能出手」之類的
    // 判斷看到的已經是撐住之後的 HP。沒有這個套裝(或已經用過)就什麼都不做,跟以前完全一樣。
    let surviveUsed1 = !!s.surviveUsed1;
    let surviveUsed2 = !!s.surviveUsed2;
    function lethalGuard() {
      if (hp1 <= 0 && s.surviveOnce1 && !surviveUsed1) {
        hp1 = 1;
        surviveUsed1 = true;
        events.push({ side: 1, type: "survive", text: "致命一擊!舊相片替你擋住了,你只剩 1 點HP!" });
      }
      if (hp2 <= 0 && s.surviveOnce2 && !surviveUsed2) {
        hp2 = 1;
        surviveUsed2 = true;
        events.push({ side: 2, type: "survive", text: "致命一擊!對方被舊相片擋住了,只剩 1 點HP!" });
      }
    }
    let mp1 = s.mp1 || 0;
    let mp2 = s.mp2 || 0;
    let immuneRatio1 = 0; // >0 表示這回合受到的傷害按比例減免(銅牆鐵壁0.9/剛毅反擊0.5)
    let immuneRatio2 = 0;
    let skip1 = false; // 這回合不出手攻擊(守衛「銅牆鐵壁」/巫醫「完全治癒」這種skipAttack:true的大招)
    let skip2 = false;
    const startMp1 = mp1;
    const startMp2 = mp2;
    let spent1 = 0; // 這回合實際花掉的魔力(有花才不回魔，見回合結束段)
    let spent2 = 0;
    let ultUsed1 = false; // 這回合有放大招 -> 回合結束大招點歸零
    let ultUsed2 = false;
    let dealt1 = false; // 這回合有造成傷害 / 被打到 -> 大招點加成
    let dealt2 = false;
    let took1 = false;
    let took2 = false;

    // 減益(詛咒):已經生效的(不是這回合剛施加的 fresh)才會降低這回合的攻擊/防禦
    const activeDebuff = (side, stat) => ((side === 1 ? s.debuffs1 : s.debuffs2) || []).filter((d) => d.stat === stat && !d.fresh && d.rounds > 0).reduce((m, d) => Math.max(m, d.ratio), 0);
    const atkMul1 = 1 - activeDebuff(1, "atk");
    const atkMul2 = 1 - activeDebuff(2, "atk");
    const stats1 = { atk: s.atk1 * atkMul1, def: s.def1 * (1 - activeDebuff(1, "def")), spd: s.spd1, luck: s.luck1, matk: (s.matk1 || 0) * atkMul1 };
    const stats2 = { atk: s.atk2 * atkMul2, def: s.def2 * (1 - activeDebuff(2, "def")), spd: s.spd2, luck: s.luck2, matk: (s.matk2 || 0) * atkMul2 };
    let poisonNew1 = s.poison1 ? { ...s.poison1 } : null; // 對方施加給自己的中毒(這回合可能被新的覆蓋)
    let poisonNew2 = s.poison2 ? { ...s.poison2 } : null;
    const debuffsNew1 = ((s.debuffs1 || []).map((d) => ({ ...d })));
    const debuffsNew2 = ((s.debuffs2 || []).map((d) => ({ ...d })));
    const skillEffectOf = (side, slot) => (slot === 1 ? (side === 1 ? s.skillEffectA1 : s.skillEffectA2) : side === 1 ? s.skillEffectB1 : s.skillEffectB2) || null;
    const skillCost = (side, slot) => (skillEffectOf(side, slot) && skillEffectOf(side, slot).manaCost) || CD.SKILL_MANA_COST;

    // 這回合真的能不能用大招:選了 ult 而且魔力夠(伺服器端也擋一次，不是只靠前端disable按鈕)
    // 大招實際花費會被「大招精修」被動降低，但最低留1點魔力的門檻，不會被壓到0(不然大招變不用錢)
    function ultCost(side) {
      const reduce = side === 1 ? s.ultCostReduce1 : s.ultCostReduce2;
      return Math.max(1, CD.ULT_MANA_COST - (reduce || 0));
    }
    // 大招要「大招點滿 + 魔力夠」兩個條件都符合(舊的進行中對戰沒有 ultCharge 欄位，當作0)
    function canUlt(side) {
      const m = side === 1 ? m1 : m2;
      const mp = side === 1 ? mp1 : mp2;
      const charge = (side === 1 ? s.ultCharge1 : s.ultCharge2) || 0;
      return m && m.action === "ult" && mp >= ultCost(side) && charge >= (CD.ULT_CHARGE_MAX || 100);
    }
    // slot: 1(技能A，沿用舊的"戰技") | 2(技能B，技能樹v2新開的第二個主動技能)
    function canSkillSlot(side, slot) {
      const m = side === 1 ? m1 : m2;
      const lvl = slot === 1 ? (side === 1 ? s.skillLevel1 : s.skillLevel2) : (side === 1 ? s.skill2Level1 : s.skill2Level2);
      const mp = side === 1 ? mp1 : mp2;
      return m && m.action === `skill${slot}` && lvl > 0 && mp >= skillCost(side, slot);
    }
    function spendMana(side, amount) {
      if (side === 1) {
        spent1 += Math.min(amount, mp1);
        mp1 = Math.max(0, mp1 - amount);
      } else {
        spent2 += Math.min(amount, mp2);
        mp2 = Math.max(0, mp2 - amount);
      }
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
        if (side === 1) ultUsed1 = true;
        else ultUsed2 = true;
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
        if (side === 1) ultUsed1 = true;
        else ultUsed2 = true;
        const maxHp = side === 1 ? s.maxhp1 : s.maxhp2;
        const matk = side === 1 ? s.matk1 : s.matk2;
        const mastery = side === 1 ? s.mastery1 : s.mastery2;
        const healRatio = ultEffect.healRatio != null ? ultEffect.healRatio : 0.5;
        const healSpec = (side === 1 ? s.spec1 : s.spec2) || null;
        const heal = Math.round((Math.round(maxHp * healRatio) + (CD.CLASS_EFFECTS.healer.healBonus || 0) + (mastery.healBonus || 0) + Math.round((matk || 0) * 1.5)) * (1 + ((healSpec && healSpec.healPct) || 0)));
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

    // 專精技能的「這回合」防禦類效果:選了這個技能而且魔力夠,整回合都有效(跟先攻順序無關)
    const roundReduce = { 1: 0, 2: 0 }; // 固守/聖盾術:這回合受到傷害減免
    const roundReflectBonus = { 1: 0, 2: 0 }; // 震盪盾擊
    const roundCounterBonus = { 1: 0, 2: 0 }; // 怒目反擊
    [1, 2].forEach((side) => {
      [1, 2].forEach((slot) => {
        if (!canSkillSlot(side, slot)) return;
        const m = side === 1 ? m1 : m2;
        if (m.action !== `skill${slot}`) return;
        const eff = skillEffectOf(side, slot);
        if (!eff) return;
        roundReduce[side] = combineReduce(roundReduce[side], eff.selfReduce);
        roundReflectBonus[side] += eff.reflectBonus || 0;
        roundCounterBonus[side] += eff.counterBonus || 0;
      });
    });

    // ---- 先攻順序:速度高的先手,同速 50/50 隨機決定(不是固定某一方永遠先手)
    let first = s.spd1 === s.spd2 ? (Math.random() < 0.5 ? 1 : 2) : s.spd1 > s.spd2 ? 1 : 2;
    // 遺物「舊號碼牌」:第一回合必定先手。只有一方有的話強制先手,雙方都有就照速度(跟沒有一樣)。
    if (s.round === 1 && !!s.firstStrike1 !== !!s.firstStrike2) {
      first = s.firstStrike1 ? 1 : 2;
      events.push({ side: first, type: "first_strike", text: `${first === 1 ? "你" : "對方"}的舊號碼牌讓${first === 1 ? "你" : "對方"}搶到先手!` });
    }
    const order = [first, first === 1 ? 2 : 1];

    function performAttack(side) {
      const skip = side === 1 ? skip1 : skip2;
      if (skip) return; // 這回合選了會跳過攻擊的大招(銅牆鐵壁/完全治癒這種)
      if ((side === 1 ? hp1 : hp2) <= 0) return; // 自己已經在這回合先被打倒了，不能再出手
      const defenderHp = side === 1 ? hp2 : hp1;
      if (defenderHp <= 0) return; // 對方已經陣亡,不用再打

      const cls = side === 1 ? s.class1 : s.class2;
      const atkStats = side === 1 ? stats1 : stats2;
      const defStats = side === 1 ? stats2 : stats1;
      const defenderImmuneRatio = side === 1 ? immuneRatio2 : immuneRatio1;
      const defMaxHp = side === 1 ? s.maxhp2 : s.maxhp1;
      const critBonus = side === 1 ? s.critBonus1 : s.critBonus2;
      const critDmgBonus = side === 1 ? s.critDmgBonus1 : s.critDmgBonus2;
      const lifestealOnHit = side === 1 ? s.lifestealOnHit1 : s.lifestealOnHit2;
      const defSide = side === 1 ? 2 : 1;
      // 被打的那一側:裝備/專精的固定減傷 + 這回合技能(固守/聖盾術)的減傷,連乘
      const defenderDmgReduceRatio = combineReduce(side === 1 ? s.dmgReduceRatio2 : s.dmgReduceRatio1, roundReduce[defSide]);
      const attackerSpec = (side === 1 ? s.spec1 : s.spec2) || null;
      const defenderSpec = (side === 1 ? s.spec2 : s.spec1) || null;
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
      const slotUsed = actionType === "skill1" ? 1 : actionType === "skill2" ? 2 : 0;
      const skillEff = slotUsed ? skillEffectOf(side, slotUsed) : null;
      const hits = wantsUlt && ultEffect.kind === "multiHit" ? ultEffect.hits || 1 : skillEff && skillEff.hits ? skillEff.hits : 1;
      if (wantsUlt) {
        spendMana(side, ultCost(side));
        if (side === 1) ultUsed1 = true;
        else ultUsed2 = true;
        events.push({ side, type: "ult_attack", text: `${side === 1 ? "你" : "對方"}使出「${ultName}」!` });
      } else if (wantsSkill1 || wantsSkill2) {
        spendMana(side, skillCost(side, wantsSkill1 ? 1 : 2));
        const skillName = wantsSkill1 ? (side === 1 ? s.skillAName1 : s.skillAName2) : side === 1 ? s.skillBName1 : s.skillBName2;
        events.push({ side, type: "skill_attack", text: `${side === 1 ? "你" : "對方"}使出技能「${skillName}」!` });
      }

      let lastDmg = 0;
      let totalDmgThisAction = 0;
      for (let i = 0; i < hits; i++) {
        const curDefHp = side === 1 ? hp2 : hp1;
        if (curDefHp <= 0) break;
        const curHpRatio = curDefHp / defMaxHp;
        const selfHpRatio = (side === 1 ? hp1 / s.maxhp1 : hp2 / s.maxhp2);
        const { dmg, crit } = computeAttackHit(atkStats, defStats, cls, actionType, curHpRatio, defenderImmuneRatio, skillLevel, critBonus, critDmgBonus, mastery, ultEffect, defenderDmgReduceRatio, { skillEffect: skillEff, spec: attackerSpec, selfHpRatio, hits, forceCrit: s.round === 1 && !!(side === 1 ? s.firstRoundCrit1 : s.firstRoundCrit2), magicMult: side === 1 ? s.magicMult1 : s.magicMult2 });
        if (side === 1) hp2 = Math.max(0, hp2 - dmg);
        else hp1 = Math.max(0, hp1 - dmg);
        lastDmg = dmg;
        totalDmgThisAction += dmg;
        // 雷暴:每下命中回魔
        if (skillEff && skillEff.manaPerHit && dmg > 0) {
          if (side === 1) mp1 = Math.min(s.maxmp1 || 0, mp1 + skillEff.manaPerHit);
          else mp2 = Math.min(s.maxmp2 || 0, mp2 + skillEff.manaPerHit);
        }
        // 遺物「不滅的燈泡」:自己暴擊時回魔
        const bulb = side === 1 ? s.manaOnCrit1 : s.manaOnCrit2;
        if (crit && dmg > 0 && bulb > 0) {
          if (side === 1) mp1 = Math.min(s.maxmp1 || 0, mp1 + bulb);
          else mp2 = Math.min(s.maxmp2 || 0, mp2 + bulb);
        }
        // 反震:被打的人(有反震被動/這回合用了震盪盾擊)把一部分傷害反彈回來
        const reflectRatio = ((defenderSpec && defenderSpec.reflect) || 0) + roundReflectBonus[defSide];
        if (reflectRatio > 0 && dmg > 0) {
          const back = Math.max(1, Math.round(dmg * reflectRatio));
          if (side === 1) hp1 = Math.max(0, hp1 - back);
          else hp2 = Math.max(0, hp2 - back);
          events.push({ side: defSide, type: "reflect", dmg: back, text: `${side === 1 ? "對方" : "你"}反震,把 ${back} 點傷害彈了回去!` });
        }

        events.push({
          side,
          type: "attack",
          dmg,
          crit,
          multi: hits > 1 ? i + 1 : null,
          text: `${side === 1 ? "你" : "對方"}${crit ? "爆擊" : ""}造成 ${dmg} 點傷害!`,
        });
        lethalGuard(); // 保命要放在「造成傷害」的事件之後,對戰紀錄的順序才會是「被打 → 撐住了」

        // 敏捷系「連射訓練」被動:普通攻擊(非大招/技能)才有機會觸發追加一擊,跟連環箭是兩回事
        if (actionType === "attack" && cls === "archer" && Math.random() < (CD.CLASS_EFFECTS.archer.extraHitChance || 0) + (mastery.extraHitChance || 0)) {
          const curDefHp2 = side === 1 ? hp2 : hp1;
          if (curDefHp2 > 0) {
            const extra = computeAttackHit(atkStats, defStats, cls, "attack", curDefHp2 / defMaxHp, defenderImmuneRatio, skillLevel, critBonus, critDmgBonus, mastery, null, defenderDmgReduceRatio);
            if (side === 1) hp2 = Math.max(0, hp2 - extra.dmg);
            else hp1 = Math.max(0, hp1 - extra.dmg);
            totalDmgThisAction += extra.dmg;
            events.push({ side, type: "extra_hit", dmg: extra.dmg, text: `${side === 1 ? "你" : "對方"}的連射訓練觸發,追加造成 ${extra.dmg} 點傷害!` });
            lethalGuard();
          }
        }
      }

      if (totalDmgThisAction > 0) {
        if (side === 1) {
          dealt1 = true;
          took2 = true;
        } else {
          dealt2 = true;
          took1 = true;
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

      // 專精技能的附帶效果(只有專精技能才有 skillEff)
      if (skillEff && totalDmgThisAction > 0) {
        const selfMax = side === 1 ? s.maxhp1 : s.maxhp2;
        const healPct = 1 + ((attackerSpec && attackerSpec.healPct) || 0);
        let healed = 0;
        if (skillEff.lifesteal) healed += Math.round(totalDmgThisAction * skillEff.lifesteal);
        if (skillEff.healMaxHp) healed += Math.round(selfMax * skillEff.healMaxHp * healPct);
        if (healed > 0) {
          if (side === 1) hp1 = Math.min(s.maxhp1, hp1 + healed);
          else hp2 = Math.min(s.maxhp2, hp2 + healed);
          events.push({ side, type: "skill_heal", dmg: healed, text: `${side === 1 ? "你" : "對方"}回復了 ${healed} 點HP!` });
        }
      }
      if (skillEff && (side === 1 ? hp2 : hp1) > 0) {
        if (skillEff.poison) {
          const mainAtk = (CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].path === "magic") ? atkStats.matk : atkStats.atk;
          const pdmg = Math.max(1, Math.round(mainAtk * skillEff.poison.atkRatio * (1 + ((attackerSpec && attackerSpec.poisonBonus) || 0))));
          const np = { dmg: pdmg, rounds: skillEff.poison.rounds };
          if (side === 1) poisonNew2 = np;
          else poisonNew1 = np;
          events.push({ side, type: "poison", text: `${side === 1 ? "對方" : "你"}中毒了!每回合損失 ${pdmg} 點HP,持續 ${np.rounds} 回合。` });
        }
        if (skillEff.debuff) {
          const rounds = skillEff.debuff.rounds + ((attackerSpec && attackerSpec.debuffRoundsAdd) || 0);
          const list = side === 1 ? debuffsNew2 : debuffsNew1;
          const keep = list.filter((d) => d.stat !== skillEff.debuff.stat);
          keep.push({ stat: skillEff.debuff.stat, ratio: skillEff.debuff.ratio, rounds, fresh: true });
          list.length = 0;
          keep.forEach((d) => list.push(d));
          events.push({ side, type: "debuff", text: `${side === 1 ? "對方" : "你"}的${skillEff.debuff.stat === "atk" ? "攻擊力" : "防禦力"}被削弱了 ${Math.round(skillEff.debuff.ratio * 100)}%,持續 ${rounds} 回合!` });
        }
      }

      // P2-2/P2-3新增:傳說裝備的吸血特殊效果，不管這次出的是普攻/技能/大招都算(用這次動作
      // 造成的總傷害去算)，跟上面戰士大招的吸血是兩件獨立的事，可以疊加。
      if (lifestealOnHit > 0 && totalDmgThisAction > 0) {
        const equipLifesteal = Math.round(totalDmgThisAction * lifestealOnHit);
        if (equipLifesteal > 0) {
          if (side === 1) hp1 = Math.min(s.maxhp1, hp1 + equipLifesteal);
          else hp2 = Math.min(s.maxhp2, hp2 + equipLifesteal);
          events.push({ side, type: "equip_lifesteal", dmg: equipLifesteal, text: `${side === 1 ? "你" : "對方"}的傳說裝備效果觸發，吸取了 ${equipLifesteal} 點HP!` });
        }
      }

      // 力量系「反擊姿態」被動:守衛被普通攻擊命中時,15% 機率反傷(用剛剛造成的傷害量反打回去)。
      // 守衛這回合如果正在用大招防禦(immuneRatio>0，不管是銅牆鐵壁還是剛毅反擊)，這個被動這回合不觸發，
      // 算是「已經用了大招的防禦效果，反擊姿態這回合讓位」
      const defenderClass = side === 1 ? s.class2 : s.class1;
      const defenderOwnImmuneRatio = side === 1 ? immuneRatio2 : immuneRatio1;
      const defenderAliveNow = (side === 1 ? hp2 : hp1) > 0; // 守衛已經被這一擊打倒就不能反擊
      // 遺物「半截筷子」讓任何職業都有機率反擊,但只反彈 RELIC_COUNTER_RATIO 的傷害(守衛的反擊姿態是反彈全部,
      // 兩個各擲各的:先擲守衛的,沒觸發才擲遺物的)。實測全額反彈的遺物會讓鏡像勝率衝到 90% 以上,所以打折。
      const relicCounter = (side === 1 ? s.relicCounter2 : s.relicCounter1) || 0;
      const guardianChance = defenderClass === "guardian" ? (CD.CLASS_EFFECTS.guardian.counterChance || 0) + (defenderMastery.counterChance || 0) + roundCounterBonus[defSide] : 0;
      if (actionType === "attack" && (guardianChance > 0 || relicCounter > 0) && defenderAliveNow && !(defenderOwnImmuneRatio > 0)) {
        const lastEvent = events[events.length - 1];
        if (lastEvent && lastEvent.type === "attack" && lastEvent.dmg > 0) {
          let counterDmg = 0;
          let counterName = "";
          if (guardianChance > 0 && Math.random() < guardianChance) {
            counterDmg = lastEvent.dmg;
            counterName = "反擊姿態";
          } else if (relicCounter > 0 && Math.random() < relicCounter) {
            counterDmg = Math.max(1, Math.round(lastEvent.dmg * RELIC_COUNTER_RATIO));
            counterName = "反擊";
          }
          if (counterDmg > 0) {
            if (side === 1) {
              hp1 = Math.max(0, hp1 - counterDmg);
              dealt2 = true;
              took1 = true;
            } else {
              hp2 = Math.max(0, hp2 - counterDmg);
              dealt1 = true;
              took2 = true;
            }
            events.push({ side: side === 1 ? 2 : 1, type: "counter", dmg: counterDmg, text: `${side === 1 ? "對方" : "你"}觸發${counterName},反彈了 ${counterDmg} 點傷害!` });
            lethalGuard();
          }
        }
      }
    }

    performAttack(order[0]);
    performAttack(order[1]);

    // 中毒:回合結束扣血(固定傷害,不吃防禦),扣完回合數 -1,歸零就消失
    [1, 2].forEach((side) => {
      const p = side === 1 ? poisonNew1 : poisonNew2;
      if (!p) return;
      const alive = (side === 1 ? hp1 : hp2) > 0;
      if (alive) {
        if (side === 1) hp1 = Math.max(0, hp1 - p.dmg);
        else hp2 = Math.max(0, hp2 - p.dmg);
        events.push({ side, type: "poison_tick", dmg: p.dmg, text: `${side === 1 ? "你" : "對方"}受到毒傷,損失 ${p.dmg} 點HP!` });
        lethalGuard();
      }
      p.rounds -= 1;
      if (side === 1) poisonNew1 = p.rounds > 0 ? p : null;
      else poisonNew2 = p.rounds > 0 ? p : null;
    });
    // 減益倒數:已經生效的回合數 -1,歸零移除;這回合剛施加的(fresh)從下一回合開始生效
    function tickDebuffs(list) {
      return list
        .map((d) => (d.fresh ? { ...d, fresh: false } : { ...d, rounds: d.rounds - 1 }))
        .filter((d) => d.rounds > 0);
    }
    const debuffsOut1 = tickDebuffs(debuffsNew1);
    const debuffsOut2 = tickDebuffs(debuffsNew2);

    // 魔法系「延壽術」被動:巫醫每回合結束小量回血(即使這回合沒用大招也生效)
    if (s.class1 === "healer" && hp1 > 0) hp1 = Math.min(s.maxhp1, hp1 + (CD.CLASS_EFFECTS.healer.regenPerRound || 0) + (s.mastery1.regenBonus || 0));
    if (s.class2 === "healer" && hp2 > 0) hp2 = Math.min(s.maxhp2, hp2 + (CD.CLASS_EFFECTS.healer.regenPerRound || 0) + (s.mastery2.regenBonus || 0));

    // 每回合結束雙方各回魔力(基礎值 + 各自「魔力充沛」被動的加成，不管這回合有沒有用大招)
    // 基礎回魔:這回合花了魔力(技能/大招)的一方不回，沒花的才回，這樣花多少就是真的少多少。
    // 「魔力充沛」被動的加成不受這個限制，不管有沒有花魔力每回合都會回。
    mp1 = Math.min(s.maxmp1 || 0, mp1 + (spent1 === 0 ? CD.MANA_REGEN_PER_ROUND || 0 : 0) + (s.manaRegenBonus1 || 0));
    mp2 = Math.min(s.maxmp2 || 0, mp2 + (spent2 === 0 ? CD.MANA_REGEN_PER_ROUND || 0 : 0) + (s.manaRegenBonus2 || 0));
    // 戰報加上魔力變化，玩家看得到這回合花了多少、回了多少
    [[1, startMp1, mp1, spent1], [2, startMp2, mp2, spent2]].forEach(([side, from, to, spent]) => {
      if (from === to && spent === 0) return;
      const who = side === 1 ? "你" : "對方";
      const text = spent > 0 ? `${who}花了 ${spent} 點魔力(剩 ${to})。` : `${who}回復魔力 ${from}→${to}。`;
      events.push({ side, type: "mana", text });
    });

    // 大招點:放了大招的一方歸零，其他人每回合 +15、造成傷害 +10、被打到 +10(上限100)
    const chargeMax = CD.ULT_CHARGE_MAX || 100;
    function nextCharge(side, used, dealt, took) {
      const before = (side === 1 ? s.ultCharge1 : s.ultCharge2) || 0;
      if (used) return 0;
      const gain = (CD.ULT_CHARGE_PER_ROUND || 0) + (dealt ? CD.ULT_CHARGE_ON_DEAL || 0 : 0) + (took ? CD.ULT_CHARGE_ON_HIT || 0 : 0);
      const after = Math.min(chargeMax, before + gain);
      if (before < chargeMax && after >= chargeMax) {
        events.push({ side, type: "ult_ready", text: `${side === 1 ? "你" : "對方"}的大招點已滿，可以放大招了!` });
      }
      return after;
    }
    const ultCharge1 = hp1 > 0 ? nextCharge(1, ultUsed1, dealt1, took1) : (s.ultCharge1 || 0);
    const ultCharge2 = hp2 > 0 ? nextCharge(2, ultUsed2, dealt2, took2) : (s.ultCharge2 || 0);

    const entrySummary = `第${s.round}回合:` + events.map((e) => e.text).join(" ");
    log.push(entrySummary);

    const newState = {
      ...s,
      hp1,
      hp2,
      mp1,
      mp2,
      ultCharge1,
      ultCharge2,
      surviveUsed1,
      surviveUsed2,
      poison1: poisonNew1,
      poison2: poisonNew2,
      debuffs1: debuffsOut1,
      debuffs2: debuffsOut2,
      round: s.round + 1,
      m1: null,
      m2: null,
      log,
    };
    return { state: newState, events };
  }

  return { initialMatchState, resolveRound, baseDamage };
})();
