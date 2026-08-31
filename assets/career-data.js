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
  const BASE_STATS = { atk: 3, def: 2, spd: 3, hp: 20, luck: 0, matk: 2 };

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

  const TRANSFER_LEVEL_PATH = 5; // 到這個等級可以選一個系(力量/敏捷/魔法)
  const TRANSFER_LEVEL_FINAL = 15; // 到這個等級可以在選好的系裡定案最終職業

  function computeStats(finalClassKey) {
    const info = CLASS_INFO[finalClassKey];
    const effects = CLASS_EFFECTS[finalClassKey];
    if (!info || !effects) return null;
    const stats = { ...BASE_STATS };
    Object.keys(effects.statBonus || {}).forEach((k) => {
      stats[k] = (stats[k] || 0) + effects.statBonus[k];
    });
    return { ...stats, maxHp: stats.hp };
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
    if (equipment) {
      ["weapon", "armor", "accessory"].forEach((slot) => {
        const item = equipment[slot];
        if (!item) return;
        if (item.statKey) out[item.statKey] += item.statValue || 0;
        if (item.extraHp) out.hp += item.extraHp;
      });
    }
    out.maxHp = out.hp;
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
    computeStats,
    applyProgress,
    critChance,
    listClasses,
  };
})();
