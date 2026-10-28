// 職業養成對決 · 第二轉職／專精(玩法擴充階段三項目 9,設計見 docs/bug-optimization-requirements.md「項目 9」)
//
// 規則:
//   - 角色 Lv.50 起,每個最終職業可以從兩條分支(A/B)擇一,**互斥**,每場活動重選(資料存在 career_progress.active_skills,
//     跟現有技能一樣每場歸零,不用新增資料表欄位)。
//   - 每條分支 = 1 個被動(選了分支就生效)+ 2 個專精技能(各花 1 技能點,可升到 Lv.5,進技能池,跟原本 3 個技能一起挑 2 個裝備)。
//   - 角色 Lv.100 自動「升階」:被動換成進階數值(t2),專精技能傷害倍率 +0.05。
//   - 節點 id:<classKey>_spec_a / _spec_b(分支)、<classKey>_spec_a_skill_1 / _skill_2(技能);
//     存在 active_skills 的 key 是節點後綴:spec_a、spec_a_skill_1 ...
// 所有數字都是估算(待模擬確認),調整只需要改這個檔案。
//
// 被動(passive)欄位,t1 = Lv.50 數值、t2 = Lv.100 升階數值。引擎在建立對戰時把它們合併進現有欄位:
//   masteryAdd    疊加到職業被動 mastery(ignoreDefRatio/lethalRhythmMax/extraHitChance/counterChance/regenBonus/healBonus)
//   critBonus / critDmgBonus   暴擊率、暴擊傷害加成
//   dmgReduce     受到傷害減免   reflect  被打時反彈傷害比例
//   berserk       {perTen, max} 每損失 10% HP 傷害 +perTen,最多 +max
//   singleSkillBonus 單次攻擊技能傷害加成   multiHitBonus 多段攻擊(技能/大招)每下傷害加成
//   poisonBonus   中毒傷害加成   healPct 治療量加成   debuffRoundsAdd 減益持續回合數加成
// 技能效果(effect,數字是 Lv.1 的基礎值,傷害倍率會隨技能等級按 skillDmgMult 成長):
//   mult 傷害倍率(多段時是每一下)  hits 打幾下  manaCost 魔力花費(預設 4)
//   ignoreDef 這招額外無視防禦比例   extraCrit 這招暴擊率加成   forceCritBelow 對方 HP 比例以下必爆
//   lowHp {below, mult} 對方 HP 低於 below 時倍率改成 mult   missingHpBonusMax 依自己損失的 HP 最多加成
//   lifesteal 傷害吸血比例   healMaxHp 回復自己最大 HP 比例   selfReduce 這回合自己受到傷害減免
//   reflectBonus 這回合額外反彈比例   counterBonus 這回合反擊機率加成   manaPerHit 每下命中回魔
//   poison {rounds, atkRatio} 中毒(每回合結束扣 攻擊力×atkRatio)   debuff {stat:'atk'|'def', ratio, rounds} 減益
window.CareerSpec = (function () {
  const CD = window.CareerData;
  const SPEC_LEVEL = 50; // 選分支需要的角色等級
  const SPEC_UPGRADE_LEVEL = 100; // 升階需要的角色等級
  const UPGRADE_SKILL_MULT = 0.05; // 升階後專精技能的傷害倍率加成

  const SPECS = {
    warrior: {
      a: {
        name: "破防", icon: "axe", desc: "把防禦當紙糊:普通攻擊與技能額外無視防禦",
        passive: { name: "破防專精", desc: "普通攻擊與技能額外無視防禦", t1: { masteryAdd: { ignoreDefRatio: 0.12 } }, t2: { masteryAdd: { ignoreDefRatio: 0.14 } }, fmt: (t) => `額外無視防禦 +${Math.round(t.masteryAdd.ignoreDefRatio * 100)}%` },
        skills: [
          { name: "碎甲重擊", icon: "axe", desc: "傷害高，並無視對方 30% 防禦", effect: { mult: 1.4, ignoreDef: 0.3 } },
          { name: "破陣連斬", icon: "swords", desc: "連續 2 下，每下各無視 20% 防禦", effect: { mult: 0.7, hits: 2, ignoreDef: 0.2 } },
        ],
      },
      b: {
        name: "狂戰", icon: "flame", desc: "越痛越強,血越少打得越痛",
        passive: { name: "越痛越強", desc: "每損失 10% HP,傷害提升", t1: { berserk: { perTen: 0.02, max: 0.2 } }, t2: { berserk: { perTen: 0.03, max: 0.3 } }, fmt: (t) => `每損失10%HP傷害+${Math.round(t.berserk.perTen * 100)}%(最多+${Math.round(t.berserk.max * 100)}%)` },
        skills: [
          { name: "血怒斬", icon: "flame", desc: "自己損失的 HP 越多,傷害越高(最多再 +40%)", effect: { mult: 1.3, missingHpBonusMax: 0.4 } },
          { name: "狂亂亂舞", icon: "heart", desc: "回復造成傷害的 12%", effect: { mult: 1.2, lifesteal: 0.12 } },
        ],
      },
    },
    guardian: {
      a: {
        name: "鐵壁", icon: "shield", desc: "硬到打不動:被動減傷,技能自帶防禦",
        passive: { name: "鐵壁", desc: "受到的傷害減免", t1: { dmgReduce: 0.05 }, t2: { dmgReduce: 0.08 }, fmt: (t) => `受到傷害 -${Math.round(t.dmgReduce * 100)}%` },
        skills: [
          { name: "固守", icon: "shield", desc: "這回合受到的傷害 -20%", effect: { mult: 1.1, selfReduce: 0.2 } },
          { name: "盾牆衝撞", icon: "shield-half", desc: "回復自己最大 HP 的 5%", effect: { mult: 1.3, healMaxHp: 0.05 } },
        ],
      },
      b: {
        name: "反震", icon: "zap", desc: "你打我多痛,我就還你多痛",
        passive: { name: "反震", desc: "被攻擊時反彈部分傷害", t1: { reflect: 0.08 }, t2: { reflect: 0.1 }, fmt: (t) => `被攻擊時反彈 ${Math.round(t.reflect * 100)}% 傷害` },
        skills: [
          { name: "震盪盾擊", icon: "zap", desc: "這回合反彈傷害額外 +15%", effect: { mult: 1.2, reflectBonus: 0.15 } },
          { name: "怒目反擊", icon: "eye", desc: "這回合反擊機率 +20%", effect: { mult: 1.2, counterBonus: 0.2 } },
        ],
      },
    },
    archer: {
      a: {
        name: "連射", icon: "target", desc: "箭多就是正義:普通攻擊更常追加一擊,技能打多下",
        passive: { name: "連射專精", desc: "普通攻擊追加一擊的機率提升", t1: { masteryAdd: { extraHitChance: 0.04 } }, t2: { masteryAdd: { extraHitChance: 0.06 } }, fmt: (t) => `追加一擊機率 +${Math.round(t.masteryAdd.extraHitChance * 100)}%` },
        skills: [
          { name: "雙發", icon: "target", desc: "連續射 2 下", effect: { mult: 0.65, hits: 2 } },
          { name: "箭雨", icon: "cloud-rain", desc: "連續射 3 下,每下較輕", effect: { mult: 0.45, hits: 3 } },
        ],
      },
      b: {
        name: "狙擊", icon: "crosshair", desc: "一發入魂:暴擊率與暴擊傷害提升",
        passive: { name: "狙擊專精", desc: "暴擊率與暴擊傷害提升", t1: { critBonus: 0.04, critDmgBonus: 0.1 }, t2: { critBonus: 0.05, critDmgBonus: 0.12 }, fmt: (t) => `暴擊率 +${Math.round(t.critBonus * 100)}%、暴擊傷害 +${Math.round(t.critDmgBonus * 100)}%` },
        skills: [
          { name: "瞄準射擊", icon: "crosshair", desc: "這招暴擊率 +20%", effect: { mult: 1.4, extraCrit: 0.2 } },
          { name: "致命一箭", icon: "skull", desc: "對方 HP 一半以下必定暴擊", effect: { mult: 1.3, forceCritBelow: 0.5 } },
        ],
      },
    },
    assassin: {
      a: {
        name: "暗殺", icon: "crosshair", desc: "抓準節奏:處決殘血、追擊爆擊",
        passive: { name: "暗殺專精", desc: "致命節奏的暴擊率上限提升", t1: { masteryAdd: { lethalRhythmMax: 0.12 } }, t2: { masteryAdd: { lethalRhythmMax: 0.15 } }, fmt: (t) => `致命節奏上限 +${Math.round(t.masteryAdd.lethalRhythmMax * 100)}%` },
        skills: [
          { name: "處決", icon: "skull", desc: "對方 HP 40% 以下,傷害大增", effect: { mult: 1.4, lowHp: { below: 0.4, mult: 2.3 } } },
          { name: "追魂", icon: "moon", desc: "這招暴擊率 +35%", effect: { mult: 1.5, extraCrit: 0.35 } },
        ],
      },
      b: {
        name: "毒刃", icon: "flask-conical", desc: "細水長流:讓對方一直扣血",
        passive: { name: "毒刃專精", desc: "中毒傷害提升", t1: { poisonBonus: 0.15 }, t2: { poisonBonus: 0.25 }, fmt: (t) => `中毒傷害 +${Math.round(t.poisonBonus * 100)}%` },
        skills: [
          { name: "淬毒刃", icon: "flask-conical", desc: "中毒 3 回合,每回合 攻擊力 ×0.25", effect: { mult: 1.0, poison: { rounds: 3, atkRatio: 0.25 } } },
          { name: "蝕骨毒", icon: "biohazard", desc: "中毒 4 回合,每回合 攻擊力 ×0.2", effect: { mult: 0.9, poison: { rounds: 4, atkRatio: 0.2 } } },
        ],
      },
    },
    mage: {
      a: {
        name: "爆裂", icon: "flame", desc: "單點爆破:一發打得最痛",
        passive: { name: "爆裂專精", desc: "單次攻擊的技能傷害提升", t1: { singleSkillBonus: 0.05 }, t2: { singleSkillBonus: 0.1 }, fmt: (t) => `單次技能傷害 +${Math.round(t.singleSkillBonus * 100)}%` },
        skills: [
          { name: "爆裂火球", icon: "flame", desc: "傷害極高,魔力花費 6", effect: { mult: 1.65, manaCost: 6 } },
          { name: "聚能轟擊", icon: "sparkles", desc: "無視對方 30% 防禦", effect: { mult: 1.2, ignoreDef: 0.3 } },
        ],
      },
      b: {
        name: "連鎖", icon: "zap", desc: "雷電亂竄:多段攻擊與回魔",
        passive: { name: "連鎖專精", desc: "多段攻擊每一下傷害提升", t1: { multiHitBonus: 0.05 }, t2: { multiHitBonus: 0.08 }, fmt: (t) => `多段攻擊每下傷害 +${Math.round(t.multiHitBonus * 100)}%` },
        skills: [
          { name: "連鎖閃電", icon: "zap", desc: "連續 3 下", effect: { mult: 0.5, hits: 3 } },
          { name: "雷暴", icon: "cloud-lightning", desc: "連續 2 下,每下命中回復 1 點魔力", effect: { mult: 0.65, hits: 2, manaPerHit: 1 } },
        ],
      },
    },
    healer: {
      a: {
        name: "續命", icon: "heart-pulse", desc: "打不死的人:持續回血、治療更強",
        passive: { name: "續命專精", desc: "每回合回血與治療量提升", t1: { masteryAdd: { regenBonus: 1 }, healPct: 0.1 }, t2: { masteryAdd: { regenBonus: 5 }, healPct: 0.35 }, fmt: (t) => `每回合回血 +${t.masteryAdd.regenBonus}、治療量 +${Math.round(t.healPct * 100)}%` },
        skills: [
          { name: "回春", icon: "heart-pulse", desc: "回復自己最大 HP 的 8%", effect: { mult: 1.0, healMaxHp: 0.08 } },
          { name: "聖盾術", icon: "shield-plus", desc: "這回合受到的傷害 -30%", effect: { mult: 1.1, selfReduce: 0.3 } },
        ],
      },
      b: {
        name: "詛咒", icon: "skull", desc: "讓對方變弱:降低攻擊與防禦",
        passive: { name: "詛咒專精", desc: "減益持續更久", t1: { debuffRoundsAdd: 1 }, t2: { debuffRoundsAdd: 3 }, fmt: (t) => `減益持續 +${t.debuffRoundsAdd} 回合` },
        skills: [
          { name: "衰弱詛咒", icon: "skull", desc: "對方攻擊力 -25%,持續 2 回合", effect: { mult: 1.0, debuff: { stat: "atk", ratio: 0.25, rounds: 2 } } },
          { name: "破防詛咒", icon: "shield-off", desc: "對方防禦力 -30%,持續 2 回合", effect: { mult: 1.0, debuff: { stat: "def", ratio: 0.3, rounds: 2 } } },
        ],
      },
    },
  };

  // ---- 把專精節點登錄進技能樹(跟既有 SKILL_TREE_NODES 同一份資料) ----
  // 分支節點 type = "spec_branch"(跟 Lv.5 選系、Lv.15 選職業的 "branch" 分開,舊畫面不會誤把它當成一般分支);
  // exclusiveWith = 互斥的另一條,買了其中一條就不能買另一條。
  Object.keys(SPECS).forEach((classKey) => {
    ["a", "b"].forEach((br) => {
      const sp = SPECS[classKey][br];
      const other = br === "a" ? "b" : "a";
      const branchId = `${classKey}_spec_${br}`;
      CD.SKILL_TREE_NODES[branchId] = {
        id: branchId, type: "spec_branch", requires: `class_${classKey}`, unlockCharLevel: SPEC_LEVEL, cost: 1, maxLevel: 1,
        name: sp.name, icon: sp.icon, exclusiveWith: `${classKey}_spec_${other}`, effect: { desc: sp.desc, specKey: br },
      };
      sp.skills.forEach((sk, i) => {
        const id = `${branchId}_skill_${i + 1}`;
        CD.SKILL_TREE_NODES[id] = {
          id, type: "active_skill", requires: branchId, unlockCharLevel: SPEC_LEVEL, cost: 1, maxLevel: CD.MAX_SKILL_LEVEL,
          name: sk.name, icon: sk.icon, effect: { desc: sk.desc, manaCost: sk.effect.manaCost || CD.SKILL_MANA_COST, specSkill: true },
        };
      });
    });
  });

  // 這場活動選了哪條分支?從 active_skills(節點後綴 -> 等級)判斷:有 spec_a 就是 a,有 spec_b 就是 b。
  function chosenBranch(classKey, activeSkills) {
    const a = activeSkills || {};
    if (!SPECS[classKey]) return null;
    if (a.spec_a > 0) return "a";
    if (a.spec_b > 0) return "b";
    return null;
  }
  // 被動:選了分支就有;角色 Lv.100 以上用進階數值。回傳 null 代表沒選或這個職業沒有專精(見習系列)。
  function resolvePassive(classKey, branch, charLevel) {
    const sp = SPECS[classKey] && SPECS[classKey][branch];
    if (!sp) return null;
    const tier = (charLevel || 0) >= SPEC_UPGRADE_LEVEL ? 2 : 1;
    return { ...sp.passive[tier === 2 ? "t2" : "t1"], tier, branch, name: sp.passive.name };
  }
  // 專精技能的實際效果:傷害倍率照技能等級成長(用現有 skillDmgMult 的比例),Lv.100 升階再 +0.1。
  // suffix 例如 "spec_a_skill_1";level = 這個技能目前等級(1~5)。找不到回傳 null。
  function resolveSkill(classKey, suffix, level, charLevel) {
    const m = /^spec_(a|b)_skill_(1|2)$/.exec(suffix || "");
    if (!m || !SPECS[classKey]) return null;
    const sk = SPECS[classKey][m[1]].skills[Number(m[2]) - 1];
    if (!sk) return null;
    const lv = Math.max(1, Math.min(CD.MAX_SKILL_LEVEL, level || 1));
    const scale = CD.skillDmgMult(lv) / CD.skillDmgMult(1);
    const bonus = (charLevel || 0) >= SPEC_UPGRADE_LEVEL ? UPGRADE_SKILL_MULT : 0;
    const e = JSON.parse(JSON.stringify(sk.effect));
    const r2 = (n) => Math.round(n * 100) / 100;
    e.mult = r2(e.mult * scale + bonus);
    if (e.lowHp) e.lowHp.mult = r2(e.lowHp.mult * scale + bonus);
    if (e.poison) e.poison.atkRatio = r2(e.poison.atkRatio * scale);
    e.manaCost = e.manaCost || CD.SKILL_MANA_COST;
    e.name = sk.name;
    return e;
  }
  function getBranches(classKey) {
    return SPECS[classKey] || null;
  }

  return { SPECS, SPEC_LEVEL, SPEC_UPGRADE_LEVEL, UPGRADE_SKILL_MULT, chosenBranch, resolvePassive, resolveSkill, getBranches };
})();
