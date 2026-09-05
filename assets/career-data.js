// 職業養成對決 · 職業樹資料(企劃書第二、十三節)
//
// Phase1 簡化說明:正式版技能樹是 tier1(2選1)+tier2(2選1)各自獨立點，兩層點法一致的「線」
// 才決定最終職業。Phase1 驗證引擎階段還沒有塔爬(沒有技能點的取得管道)，所以先讓玩家直接選一條
// 完整的線(等於 tier1+tier2 一起選好)，資料結構仍然照企劃書的 CAREER_TREE 巢狀格式存，Phase2
// 塔爬上線、技能點變成真的可以一點一點拿之後，career.js 的建置流程再改成兩層分開選，
// 這份資料表本身不用大改。
window.CareerData = (function () {
  // matk(魔攻/魔力):魔法系(法師/巫醫)專用的傷害數值，物理系職業用不到、平常也不會顯示。
  // 加了這個之後法師才是「靠魔攻打」而不是共用攻擊力，武器/加點/裝備都會分開算。
  // mp(魔力值):任何職業都有，不是魔法系專屬——大招要花魔力才能用(見 career-engine.js)，
  // 魔力不夠就只能普通攻擊，回合結束會回一點魔力，也可以用魔力藥水補。
  const BASE_STATS = { atk: 3, def: 2, spd: 3, hp: 100, luck: 0, matk: 2, mp: 10 };
  const ULT_MANA_COST = 6; // 大招固定花費(先不分職業，簡單版)
  const MANA_REGEN_PER_ROUND = 2;

  // 5% 基礎爆擊 + 幸運力 x2%(企劃書第七節)
  const BASE_CRIT = 0.05;
  const LUCK_CRIT_MULT = 0.02;
  const CRIT_DMG_MULT = 1.5;

  const CAREER_TREE = {
    strength: {
      label: "力量系",
      icon: "dumbbell",
      lines: {
        attack: {
          tier1: { key: "power_strike", name: "猛力揮擊", desc: "攻擊+2" },
          tier2: { key: "armor_break", name: "破防打法", desc: "普通攻擊無視 30% 防禦" },
          final: { key: "warrior", name: "戰士", icon: "swords", ultName: "怒吼衝鋒", ultDesc: "這回合傷害 x2" },
        },
        defense: {
          tier1: { key: "iron_body", name: "鐵皮肉身", desc: "HP+3" },
          tier2: { key: "counter_stance", name: "反擊姿態", desc: "被普通攻擊命中有 15% 機率反傷" },
          final: { key: "guardian", name: "守衛", icon: "shield", ultName: "銅牆鐵壁", ultDesc: "這回合受到的傷害 -90%,但這回合不出手攻擊" },
        },
      },
    },
    agility: {
      label: "敏捷系",
      icon: "wind",
      lines: {
        speed: {
          tier1: { key: "swift_step", name: "疾風步", desc: "速度+2" },
          tier2: { key: "rapid_fire", name: "連射訓練", desc: "普通攻擊有 20% 機率追加一擊" },
          final: { key: "archer", name: "弓箭手", icon: "target", ultName: "連環箭", ultDesc: "連續攻擊 2 次(第二次攻擊前會先確認對方是否已陣亡)" },
        },
        crit: {
          tier1: { key: "deft_hands", name: "巧手", desc: "爆擊率+10%(幸運+5)" },
          tier2: { key: "lethal_rhythm", name: "致命節奏", desc: "HP 越低,爆擊率越高(最多再+30%)" },
          final: { key: "assassin", name: "刺客", icon: "sword", ultName: "暗殺", ultDesc: "對方 HP 過半以下時,這一擊必定爆擊" },
        },
      },
    },
    magic: {
      label: "魔法系",
      icon: "sparkles",
      lines: {
        damage: {
          tier1: { key: "mana_infusion", name: "魔力灌注", desc: "技能傷害+2" },
          tier2: { key: "arcane_breach", name: "破魔法陣", desc: "大招額外無視防禦(本來就無視,這是加成保底)" },
          final: { key: "mage", name: "法師", icon: "flame", ultName: "魔力爆發", ultDesc: "無視防禦,造成大量傷害" },
        },
        heal: {
          tier1: { key: "healing_heart", name: "治療之心", desc: "回血技能效果+2" },
          tier2: { key: "life_extension", name: "延壽術", desc: "每回合結束小量回血(+1 HP)" },
          final: { key: "healer", name: "巫醫", icon: "heart-pulse", ultName: "完全治癒", ultDesc: "回滿一半 HP 並清除異常狀態" },
        },
      },
    },
  };

  // final class key -> { path, lineKey, statBonus, passives }
  const CLASS_INFO = {};
  Object.keys(CAREER_TREE).forEach((pathKey) => {
    const path = CAREER_TREE[pathKey];
    Object.keys(path.lines).forEach((lineKey) => {
      const line = path.lines[lineKey];
      CLASS_INFO[line.final.key] = {
        path: pathKey,
        pathLabel: path.label,
        lineKey,
        name: line.final.name,
        icon: line.final.icon,
        ultName: line.final.ultName,
        ultDesc: line.final.ultDesc,
        tier1: line.tier1,
        tier2: line.tier2,
        skillKeys: [line.tier1.key, line.tier2.key],
      };
    });
  });

  // 每個最終職業的數值加成與被動效果(對應企劃書第二、三節的加點回報 + 第十三節判定順序表)
  const CLASS_EFFECTS = {
    warrior: { statBonus: { atk: 2 }, ignoreDefRatio: 0.3 },
    guardian: { statBonus: { hp: 3 }, counterChance: 0.15 },
    archer: { statBonus: { spd: 2 }, extraHitChance: 0.2 },
    assassin: { statBonus: { luck: 5 }, lethalRhythmMax: 0.3 },
    mage: { statBonus: { matk: 3 } },
    healer: { statBonus: { matk: 2 }, healBonus: 2, regenPerRound: 1 },
    novice: { statBonus: {}, ultDamageMult: 1.3 },
    novice_strength: { statBonus: { atk: 1, hp: 2 }, ultDamageMult: 1.35 },
    novice_agility: { statBonus: { spd: 1, luck: 1 }, ultDamageMult: 1.35 },
    novice_magic: { statBonus: { matk: 2 }, ultDamageMult: 1.35 },
  };

  // 三段式轉職(企劃書):
  //   Lv1~4  見習學徒，還沒選路，數值最單純，PVP也打得動只是比較吃虧
  //   Lv5    選一個「系」(力量/敏捷/魔法三選一) -> 變成該系的學徒，數值/大招都比 Lv1 好一點，
  //          但還沒定案最終職業
  //   Lv15   在 Lv5 選的那個系裡面，選一條線 -> 正式轉職成 6 個最終職業之一(戰士/守衛/...)
  // Lv5 選了力量系，Lv15 就只能在「戰士/守衛」裡面選，不能臨時跳去選敏捷系或魔法系的職業。
  CLASS_INFO.novice = {
    path: "novice",
    pathLabel: "見習",
    lineKey: "novice",
    name: "見習學徒",
    icon: "user",
    ultName: "拼盡全力",
    ultDesc: "這回合傷害 x1.3(還沒選路，大招比較弱)",
    tier1: null,
    tier2: null,
    skillKeys: [],
  };
  CLASS_INFO.novice_strength = {
    path: "strength",
    pathLabel: "力量系(未定final)",
    lineKey: "novice",
    name: "力量系學徒",
    icon: "dumbbell",
    ultName: "力量爆發",
    ultDesc: "這回合傷害 x1.35(還沒轉正式職業，大招比較弱)",
    tier1: null,
    tier2: null,
    skillKeys: [],
  };
  CLASS_INFO.novice_agility = {
    path: "agility",
    pathLabel: "敏捷系(未定final)",
    lineKey: "novice",
    name: "敏捷系學徒",
    icon: "wind",
    ultName: "疾風連擊",
    ultDesc: "這回合傷害 x1.35(還沒轉正式職業，大招比較弱)",
    tier1: null,
    tier2: null,
    skillKeys: [],
  };
  CLASS_INFO.novice_magic = {
    path: "magic",
    pathLabel: "魔法系(未定final)",
    lineKey: "novice",
    name: "魔法系學徒",
    icon: "sparkles",
    ultName: "魔力乍現",
    ultDesc: "這回合傷害 x1.35(還沒轉正式職業，大招比較弱)",
    tier1: null,
    tier2: null,
    skillKeys: [],
  };

  // 技能樹 v1:每個職業(含見習系列)都有一招「戰技」，比大招便宜(魔力3點 vs 大招6點)、
  // 效果也比較單純(固定倍率的攻擊，沒有大招那些特殊效果:不會無視防禦、不會必爆、不會多打一次)。
  // 要花1技能點解鎖才能用(見 unlocked_skill)，技能點是每升一級送1點，跟自由數值點是分開的資源。
  // 守衛/巫醫平常沒有主動輸出手段(大招是防禦/治療型，不會攻擊)，解鎖戰技之後才多一個「打人」的選項，
  // build多樣性主要就是靠這個。
  const SKILL_MANA_COST = 3;
  const SKILL_DMG_MULT = 1.4;
  const SKILL_NAME = {
    warrior: "連擊",
    guardian: "盾擊",
    archer: "精準射擊",
    assassin: "突刺",
    mage: "魔彈",
    healer: "聖光斬",
    novice: "猛力一擊",
    novice_strength: "猛力一擊",
    novice_agility: "猛力一擊",
    novice_magic: "猛力一擊",
  };
  function skillDesc() {
    return `花 ${SKILL_MANA_COST} 魔力，造成 x${SKILL_DMG_MULT} 傷害的攻擊(比大招便宜、效果單純)`;
  }

  const TRANSFER_LEVEL_PATH = 5; // 到這個等級可以選一個系(力量/敏捷/魔法)
  const TRANSFER_LEVEL_FINAL = 15; // 到這個等級可以在選好的系裡定案最終職業

  // 轉職要有感覺:每次轉職都直接送一筆固定的數值加點(疊加進 stat_alloc，永久生效，
  // 跟被動的 CLASS_EFFECTS.statBonus 是兩件事)，職業不同送的數值也不同，對應角色定位。
  // Lv15 定案最終職業送的比 Lv5 選系送的多，畢竟是真正的職業成形。
  const PATH_TRANSFER_BONUS = {
    strength: { atk: 2, hp: 1 },
    agility: { spd: 2, luck: 1 },
    magic: { matk: 2, mp: 1 },
  };
  const FINAL_TRANSFER_BONUS = {
    warrior: { atk: 3 },
    guardian: { def: 2, hp: 1 },
    archer: { spd: 3 },
    assassin: { luck: 3 },
    mage: { matk: 3 },
    healer: { matk: 2, mp: 1 },
  };

  // Lv5 選系那一刻，除了轉職加點之外，順便送一份新手禮包(藥水)，讓玩家一開始就有點
  // 應急資源，不用馬上就要煩惱HP/MP見底怎麼辦。
  const STARTER_PACK_POTIONS = { hp: 2, mp: 1 };

  function computeStats(finalClassKey) {
    const info = CLASS_INFO[finalClassKey];
    const effects = CLASS_EFFECTS[finalClassKey];
    if (!info || !effects) return null;
    const stats = { ...BASE_STATS };
    Object.keys(effects.statBonus || {}).forEach((k) => {
      stats[k] = (stats[k] || 0) + effects.statBonus[k];
    });
    return { ...stats, maxHp: stats.hp, maxMp: stats.mp };
  }

  function critChance(stats, hpRatio, finalClassKey) {
    let c = BASE_CRIT + (stats.luck || 0) * LUCK_CRIT_MULT;
    if (finalClassKey === "assassin" && typeof hpRatio === "number") {
      c += (1 - hpRatio) * (CLASS_EFFECTS.assassin.lethalRhythmMax || 0);
    }
    return Math.min(0.95, c);
  }

  // listClasses() 給「Lv15定案最終職業」用，不包含 novice 系列(那些是還沒定案的過渡狀態，
  // 不是可以選的目標)。可傳 pathKey 只列出某一系底下的兩個職業(Lv5選了哪一系，Lv15就只能
  // 在那系裡選)。
  function listClasses(pathKey) {
    return Object.keys(CLASS_INFO)
      .filter((key) => !key.startsWith("novice"))
      .filter((key) => !pathKey || CLASS_INFO[key].path === pathKey)
      .map((key) => ({ key, ...CLASS_INFO[key] }));
  }

  // Phase2:職業基礎值 + 自由數值點分配 + 裝備加成,算出目前實際戰鬥數值。
  // 1點數值點 = 攻擊+1/防禦+1/速度+1/HP+3/幸運+1(企劃書第三節)
  function applyProgress(finalClassKey, statAlloc, equipment) {
    const base = computeStats(finalClassKey);
    if (!base) return null;
    const alloc = statAlloc || {};
    const out = { ...base };
    out.atk += alloc.atk || 0;
    out.def += alloc.def || 0;
    out.spd += alloc.spd || 0;
    out.luck += alloc.luck || 0;
    out.matk += alloc.matk || 0;
    out.hp += (alloc.hp || 0) * 3;
    out.mp += (alloc.mp || 0) * 2;
    if (equipment) {
      ["weapon", "armor", "accessory"].forEach((slot) => {
        const item = equipment[slot];
        if (!item) return;
        if (item.statKey) out[item.statKey] += item.statValue || 0;
        if (item.extraHp) out.hp += item.extraHp;
      });
    }
    out.maxHp = out.hp;
    out.maxMp = out.mp;
    return out;
  }

  return {
    BASE_STATS,
    BASE_CRIT,
    LUCK_CRIT_MULT,
    CRIT_DMG_MULT,
    CAREER_TREE,
    CLASS_INFO,
    CLASS_EFFECTS,
    TRANSFER_LEVEL_PATH,
    TRANSFER_LEVEL_FINAL,
    PATH_TRANSFER_BONUS,
    FINAL_TRANSFER_BONUS,
    STARTER_PACK_POTIONS,
    ULT_MANA_COST,
    MANA_REGEN_PER_ROUND,
    SKILL_MANA_COST,
    SKILL_DMG_MULT,
    SKILL_NAME,
    skillDesc,
    computeStats,
    applyProgress,
    critChance,
    listClasses,
  };
})();
