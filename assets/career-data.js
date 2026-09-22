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
  const SKILL_DMG_MULT = 1.4; // 保留給沒有等級資訊的舊呼叫端當預設值(= Lv.1)

  // 第22點更新:技能／被動不再只有「解鎖／沒解鎖」，改成 Lv.1 → Lv.2 → Lv.3(先開放到這裡，
  // 之後要開 Lv.4、Lv.5 只要在這幾張表多加一格，不用把玩家進度重新歸零)。
  // 這個等級是「永久繼承」的:存在 career_player_skills，只綁 player_id、不綁 event_id，
  // 所以跨活動、跨賽季都是同一份進度(見 db.js 的 getPlayerSkillLevels / upgradePlayerSkill)。
  const MAX_SKILL_LEVEL = 3;

  // 「戰技」(主動技能)等級 -> 傷害倍率
  const SKILL_LEVEL_DMG_MULT = { 1: 1.4, 2: 1.55, 3: 1.7 };
  function skillDmgMult(level) {
    const lv = Math.max(1, Math.min(MAX_SKILL_LEVEL, level || 1));
    return SKILL_LEVEL_DMG_MULT[lv] || SKILL_DMG_MULT;
  }

  // 被動技能(不綁最終職業，任何人都能點，永久繼承)。這裡先放企劃書第22點更新給的三個範例，
  // 之後要加新被動只要在這裡多一筆、並在對應的計算式(critChance / 特訓經驗 / 掛機CD)加進去讀就好。
  const PASSIVE_DEFS = {
    crit_boost: {
      name: "暴擊精研",
      icon: "crosshair",
      desc: "提升暴擊率(跟幸運力的暴擊加成疊加)",
      format: "percent",
      levels: { 1: 0.03, 2: 0.04, 3: 0.05 }, // 暴擊率 +3% / +4% / +5%
    },
    exp_boost: {
      name: "博學被動",
      icon: "book-open",
      desc: "特訓／爬塔拿到的經驗值提升",
      format: "percent",
      levels: { 1: 0.05, 2: 0.08, 3: 0.1 }, // 經驗 +5% / +8% / +10%
    },
    idle_cd: {
      name: "勤奮掛機",
      icon: "timer",
      desc: "特訓冷卻時間縮短",
      format: "seconds",
      levels: { 1: 1, 2: 2, 3: 3 }, // CD -1秒 / -2秒 / -3秒
    },
    coin_boost: {
      name: "財運被動",
      icon: "coins",
      desc: "特訓／爬塔拿到的金幣提升",
      format: "percent",
      levels: { 1: 0.05, 2: 0.08, 3: 0.1 }, // 金幣 +5% / +8% / +10%
    },
    mana_regen: {
      name: "魔力充沛",
      icon: "droplets",
      desc: "對戰／爬塔每回合額外回復魔力",
      format: "flat",
      levels: { 1: 1, 2: 2, 3: 3 }, // 每回合多回 +1 / +2 / +3 魔力
    },
    crit_dmg_boost: {
      name: "爆擊強化",
      icon: "zap",
      desc: "暴擊時的額外傷害倍率提升(跟基礎的x1.5爆擊倍率疊加)",
      format: "percent",
      levels: { 1: 0.1, 2: 0.15, 3: 0.2 }, // 爆擊倍率額外 +10% / +15% / +20%(基礎x1.5 -> 最高x1.7)
    },
    drop_luck: {
      name: "鑑定之眼",
      icon: "gem",
      desc: "樓層戰勝利時，取得裝備掉落的機率提升",
      format: "percent",
      levels: { 1: 0.03, 2: 0.05, 3: 0.08 }, // 掉落機率 +3% / +5% / +8%(直接加在樓層原本的掉落率上)
    },
    ult_cost: {
      name: "大招精修",
      icon: "flame",
      desc: "大招消耗的魔力降低(最低會留1點魔力的門檻，不會被降到0)",
      format: "flat",
      levels: { 1: 1, 2: 2, 3: 3 }, // 大招消耗 -1 / -2 / -3 魔力(基礎 CareerData.ULT_MANA_COST = 6)
    },
  };
  const PASSIVE_KEYS = Object.keys(PASSIVE_DEFS);

  function passiveValue(skillKey, level) {
    const def = PASSIVE_DEFS[skillKey];
    if (!def || !level) return 0;
    const lv = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
    return def.levels[lv] || 0;
  }

  function passiveLevelDesc(skillKey, level) {
    const def = PASSIVE_DEFS[skillKey];
    if (!def) return "";
    const lv = Math.max(1, Math.min(MAX_SKILL_LEVEL, level || 1));
    const v = def.levels[lv];
    if (def.format === "seconds") return `${def.desc} -${v}秒`;
    if (def.format === "flat") return `${def.desc} +${v}`;
    return `${def.desc} +${Math.round(v * 100)}%`; // 預設當百分比處理
  }

  // 職業限定被動(第22點更新的第二段:職業原本就有的固定被動，也做成可升級 Lv.1~3)。
  // 跟 PASSIVE_DEFS 不一樣的地方:這些不是「任何人都能點」的通用被動，只有轉職成對應的
  // 最終職業才看得到、才能點。key 是 final_class，effectKey 對應 CLASS_EFFECTS 裡本來就有的
  // 那個欄位(mage 沒有現成欄位，額外開一個 magicDmgBonus)。永久儲存時 skill_key 會存成
  // "class_mastery:<classKey>"，所以即使之後轉職到別的職業，原本那個職業點過的等級還在，
  // 哪天轉回去馬上就接回來，不會歸零。
  const CLASS_MASTERY_DEFS = {
    warrior: {
      name: "破防精研",
      icon: "sword",
      effectKey: "ignoreDefRatio",
      desc: "「破防打法」無視防禦比例提升(基礎30%)",
      format: "percent",
      levels: { 1: 0.05, 2: 0.08, 3: 0.12 },
    },
    guardian: {
      name: "反擊精研",
      icon: "shield",
      effectKey: "counterChance",
      desc: "「反擊姿態」觸發機率提升(基礎15%)",
      format: "percent",
      levels: { 1: 0.05, 2: 0.08, 3: 0.12 },
    },
    archer: {
      name: "連射精研",
      icon: "target",
      effectKey: "extraHitChance",
      desc: "「連射訓練」追加一擊機率提升(基礎20%)",
      format: "percent",
      levels: { 1: 0.05, 2: 0.08, 3: 0.12 },
    },
    assassin: {
      name: "暗殺精研",
      icon: "crosshair",
      effectKey: "lethalRhythmMax",
      desc: "「致命節奏」暴擊率加成上限提升(基礎30%)",
      format: "percent",
      levels: { 1: 0.05, 2: 0.08, 3: 0.12 },
    },
    mage: {
      name: "法術精研",
      icon: "sparkles",
      effectKey: "magicDmgBonus",
      desc: "所有魔法傷害額外提升",
      format: "percent",
      levels: { 1: 0.05, 2: 0.08, 3: 0.12 },
    },
    healer: {
      name: "治療精研",
      icon: "heart",
      effectKey: "healBonus",
      desc: "「完全治癒」跟每回合回血量提升",
      format: "flat",
      levels: { 1: 1, 2: 2, 3: 3 },
    },
  };

  function classMasteryDesc(classKey, level) {
    const def = CLASS_MASTERY_DEFS[classKey];
    if (!def) return "";
    const lv = Math.max(1, Math.min(MAX_SKILL_LEVEL, level || 1));
    const v = def.levels[lv];
    if (def.format === "flat") return `${def.desc} +${v}`;
    return `${def.desc} +${Math.round(v * 100)}%`;
  }

  // 把某職業的職業限定被動等級，組成戰鬥引擎要用的 { [effectKey]: 加成值 } 形狀。
  // healer 比較特別，healBonus 這個加成同時套用在「完全治癒」跟「每回合回血」兩個地方，
  // 所以順便多塞一個 regenBonus 給每回合回血用(數值跟 healBonus 共用同一份等級表，只是欄位名不同)。
  function classMasteryBonus(classKey, level) {
    const def = CLASS_MASTERY_DEFS[classKey];
    if (!def || !level) return {};
    const lv = Math.max(0, Math.min(MAX_SKILL_LEVEL, level));
    const v = def.levels[lv] || 0;
    const bonus = { [def.effectKey]: v };
    if (classKey === "healer") bonus.regenBonus = v;
    return bonus;
  }

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
  // 技能樹 v2 Phase 2:Lv.1~4 不核發技能點，選系(Lv.5)那一刻一次補發
  // 「目前等級 × SKILL_POINTS_PER_LEVEL」，之後每升一級照舊送這個數量(見 db.js _applyExpGain
  // / transferCareerPath)。
  const SKILL_POINTS_PER_LEVEL = 1;
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

  // extraCrit:暴擊精研被動算出來的加成(passiveValue("crit_boost", level))，跟幸運力的
  // 暴擊加成疊加,不是取代。assassinBonus:「暗殺精研」職業被動，疊加在暗殺本身的致命節奏上限上
  function critChance(stats, hpRatio, finalClassKey, extraCrit, assassinBonus) {
    let c = BASE_CRIT + (stats.luck || 0) * LUCK_CRIT_MULT + (extraCrit || 0);
    if (finalClassKey === "assassin" && typeof hpRatio === "number") {
      c += (1 - hpRatio) * ((CLASS_EFFECTS.assassin.lethalRhythmMax || 0) + (assassinBonus || 0));
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
  // 1點數值點 = 攻擊+1/防禦+1/速度+1/HP+10/魔力+2/幸運+1
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
    out.hp += (alloc.hp || 0) * 10;
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

  // ============================================================
  // 技能樹 v2 — Phase 1:節點圖資料結構(草案，尚未啟用)
  // ============================================================
  // 對應 docs/skill-tree-v2-design.md。這裡只放「資料」，完全沒有接進任何戰鬥/畫面邏輯，
  // 不會影響現有玩家跟現有系統(unlockCareerSkill / class_mastery / PASSIVE_DEFS 這些照舊運作)。
  // 之後 Phase 2~6 才會逐步把這份資料接進轉職流程、戰鬥引擎、技能樹畫面。
  //
  // 已確認的規則(2026-09):
  //   1. Lv.1~4 不核發技能點，只有「普攻」+「拼盡全力」，沒有技能樹頁面。
  //   2. Lv.5 選系那一刻，技能樹解鎖，並一次補發「目前等級 × 每級技能點數」的技能點
  //      (不是 Lv.1~4 每級小額累積)。
  //   3. 裝備欄(要用哪 2 個主動技能 + 用哪個大招)免費隨時換，沒有冷卻、沒有花費。
  //   4. 大招現在也走「解鎖進池子 -> 裝備」的模式，不是選了就永久鎖死；每個最終職業
  //      預留 2 個大招可選，效果不同，靠裝備欄切換。
  //   5. 這次上線不補償舊玩家技能點；舊玩家原本點過的「戰技」跟「職業限定被動」等級，
  //      migration 時原封不動接到對應的新節點id，見 §6 的 mapping。
  //
  // 節點型別(type):
  //   "branch"        分支節點(選系/選最終職業)，maxLevel固定1，解鎖後才能繼續點底下的節點
  //   "stat"          數值加成節點，解鎖就直接生效，不用裝備
  //   "passive"       被動節點，解鎖就直接生效，不用裝備(等級表用法跟 PASSIVE_DEFS 一樣)
  //   "active_skill"  主動技能節點，解鎖後進入技能池，要裝備到 equipped_loadout.skill1/skill2 才會出現在對戰選項
  //   "ultimate"      大招節點，解鎖後進入大招池，要裝備到 equipped_loadout.ultimate 才會生效

  const SKILL_TREE_NODES = {};

  function _addNode(node) {
    SKILL_TREE_NODES[node.id] = node;
  }

  // ---- Lv.5 選系:三個根分支節點 ----
  _addNode({ id: "path_strength", type: "branch", requires: null, unlockCharLevel: 5, cost: 1, maxLevel: 1, name: "力量系", icon: "dumbbell", effect: { unlocksPathKey: "strength" } });
  _addNode({ id: "path_agility", type: "branch", requires: null, unlockCharLevel: 5, cost: 1, maxLevel: 1, name: "敏捷系", icon: "wind", effect: { unlocksPathKey: "agility" } });
  _addNode({ id: "path_magic", type: "branch", requires: null, unlockCharLevel: 5, cost: 1, maxLevel: 1, name: "魔法系", icon: "sparkles", effect: { unlocksPathKey: "magic" } });

  // ---- Lv.15 選最終職業:掛在對應系底下的分支節點 ----
  _addNode({ id: "class_warrior", type: "branch", requires: "path_strength", unlockCharLevel: 15, cost: 1, maxLevel: 1, name: "戰士", icon: "swords", effect: { unlocksClassKey: "warrior" } });
  _addNode({ id: "class_guardian", type: "branch", requires: "path_strength", unlockCharLevel: 15, cost: 1, maxLevel: 1, name: "守衛", icon: "shield", effect: { unlocksClassKey: "guardian" } });
  _addNode({ id: "class_archer", type: "branch", requires: "path_agility", unlockCharLevel: 15, cost: 1, maxLevel: 1, name: "弓箭手", icon: "target", effect: { unlocksClassKey: "archer" } });
  _addNode({ id: "class_assassin", type: "branch", requires: "path_agility", unlockCharLevel: 15, cost: 1, maxLevel: 1, name: "刺客", icon: "sword", effect: { unlocksClassKey: "assassin" } });
  _addNode({ id: "class_mage", type: "branch", requires: "path_magic", unlockCharLevel: 15, cost: 1, maxLevel: 1, name: "法師", icon: "flame", effect: { unlocksClassKey: "mage" } });
  _addNode({ id: "class_healer", type: "branch", requires: "path_magic", unlockCharLevel: 15, cost: 1, maxLevel: 1, name: "巫醫", icon: "heart-pulse", effect: { unlocksClassKey: "healer" } });

  // ---- 每個最終職業底下:2個主動技能節點 + 2個大招節點(擇一裝備) + 1個職業被動節點 ----
  // dmgMultByLevel 沿用現有 SKILL_LEVEL_DMG_MULT 的級距(1.4/1.55/1.7)，之後平衡再個別微調。
  const DEFAULT_SKILL_DMG = { 1: 1.4, 2: 1.55, 3: 1.7 };
  function _addClassKit(classKey, requires, kit) {
    _addNode({ id: `${classKey}_skill_1`, type: "active_skill", requires, unlockCharLevel: 15, cost: 1, maxLevel: 3, name: kit.skill1.name, icon: kit.skill1.icon, effect: { dmgMultByLevel: DEFAULT_SKILL_DMG, manaCost: SKILL_MANA_COST, desc: kit.skill1.desc } });
    _addNode({ id: `${classKey}_skill_2`, type: "active_skill", requires, unlockCharLevel: 15, cost: 1, maxLevel: 3, name: kit.skill2.name, icon: kit.skill2.icon, effect: { dmgMultByLevel: DEFAULT_SKILL_DMG, manaCost: SKILL_MANA_COST, desc: kit.skill2.desc } });
    _addNode({ id: `${classKey}_ult_1`, type: "ultimate", requires, unlockCharLevel: 15, cost: 1, maxLevel: 1, name: kit.ult1.name, icon: kit.ult1.icon, effect: kit.ult1.effect });
    _addNode({ id: `${classKey}_ult_2`, type: "ultimate", requires, unlockCharLevel: 15, cost: 1, maxLevel: 1, name: kit.ult2.name, icon: kit.ult2.icon, effect: kit.ult2.effect });
    _addNode({ id: `${classKey}_mastery`, type: "passive", requires, unlockCharLevel: 15, cost: 1, maxLevel: 3, name: kit.mastery.name, icon: kit.mastery.icon, effect: { levels: kit.mastery.levels, desc: kit.mastery.desc } });
  }

  _addClassKit("warrior", "class_warrior", {
    skill1: { name: "連擊", icon: "sword", desc: "沿用現有戰技效果" },
    skill2: { name: "破甲斬", icon: "axe", desc: "新技能:比連擊多一點無視防禦比例" },
    ult1: { name: "怒吼衝鋒", icon: "flame", effect: { kind: "dmgMult", value: 2, desc: "這回合傷害 x2(沿用現有大招)" } },
    ult2: { name: "血戰怒吼", icon: "heart", effect: { kind: "lifesteal", dmgMult: 1.5, lifestealRatio: 0.3, desc: "新大招:傷害 x1.5，並回復造成傷害30%的HP" } },
    mastery: { name: "破防精研", icon: "sword", levels: { 1: 0.05, 2: 0.08, 3: 0.12 }, desc: "沿用現有職業被動(破防打法無視防禦比例提升)" },
  });
  _addClassKit("guardian", "class_guardian", {
    skill1: { name: "盾擊", icon: "shield", desc: "沿用現有戰技效果" },
    skill2: { name: "嘲諷打擊", icon: "megaphone", desc: "新技能:命中後這回合反擊機率額外提升" },
    ult1: { name: "銅牆鐵壁", icon: "shield", effect: { kind: "immune", dmgReduceRatio: 0.9, skipAttack: true, desc: "沿用現有大招(受到傷害-90%，本回合不出手)" } },
    ult2: { name: "剛毅反擊", icon: "shield-alert", effect: { kind: "counterStance", dmgReduceRatio: 0.5, guaranteedCounter: true, desc: "新大招:受到傷害-50%，但本回合仍可出手，且必定反擊一次" } },
    mastery: { name: "反擊精研", icon: "shield", levels: { 1: 0.05, 2: 0.08, 3: 0.12 }, desc: "沿用現有職業被動(反擊姿態觸發機率提升)" },
  });
  _addClassKit("archer", "class_archer", {
    skill1: { name: "精準射擊", icon: "target", desc: "沿用現有戰技效果" },
    skill2: { name: "毒箭", icon: "flask-conical", desc: "新技能:額外附加小量無視防禦傷害" },
    ult1: { name: "連環箭", icon: "target", effect: { kind: "multiHit", hits: 2, desc: "沿用現有大招(連續攻擊2次)" } },
    ult2: { name: "貫穿射擊", icon: "crosshair", effect: { kind: "pierce", dmgMult: 2.2, ignoreDefRatio: 1, desc: "新大招:單次無視防禦，造成 x2.2 傷害" } },
    mastery: { name: "連射精研", icon: "target", levels: { 1: 0.05, 2: 0.08, 3: 0.12 }, desc: "沿用現有職業被動(連射訓練追加一擊機率提升)" },
  });
  _addClassKit("assassin", "class_assassin", {
    skill1: { name: "突刺", icon: "sword", desc: "沿用現有戰技效果" },
    skill2: { name: "影襲", icon: "moon", desc: "新技能:對方HP越低，這招傷害越高" },
    ult1: { name: "暗殺", icon: "crosshair", effect: { kind: "guaranteedCritBelowHalf", desc: "沿用現有大招(對方HP過半以下必爆擊)" } },
    ult2: { name: "血影連斬", icon: "swords", effect: { kind: "multiHit", hits: 3, dmgMultPerHit: 0.6, desc: "新大招:連續攻擊3次，每次傷害x0.6" } },
    mastery: { name: "暗殺精研", icon: "crosshair", levels: { 1: 0.05, 2: 0.08, 3: 0.12 }, desc: "沿用現有職業被動(致命節奏暴擊率上限提升)" },
  });
  _addClassKit("mage", "class_mage", {
    skill1: { name: "魔彈", icon: "sparkles", desc: "沿用現有戰技效果" },
    skill2: { name: "烈焰波動", icon: "flame", desc: "新技能:魔攻導向，額外附加小量無視防禦傷害" },
    ult1: { name: "魔力爆發", icon: "flame", effect: { kind: "ignoreDef", ignoreDefRatio: 1, desc: "沿用現有大招(無視防禦，造成大量傷害)" } },
    ult2: { name: "寒冰新星", icon: "snowflake", effect: { kind: "dmgMult", value: 1.8, extraCrit: 0.15, desc: "新大招:傷害 x1.8，且這回合暴擊率額外+15%" } },
    mastery: { name: "法術精研", icon: "sparkles", levels: { 1: 0.05, 2: 0.08, 3: 0.12 }, desc: "沿用現有職業被動(魔法傷害額外提升)" },
  });
  _addClassKit("healer", "class_healer", {
    skill1: { name: "聖光斬", icon: "heart-pulse", desc: "沿用現有戰技效果" },
    skill2: { name: "祝福打擊", icon: "heart", desc: "新技能:造成傷害的同時，順便回復自己一點HP" },
    ult1: { name: "完全治癒", icon: "heart-pulse", effect: { kind: "heal", healRatio: 0.5, skipAttack: true, desc: "沿用現有大招(回滿一半HP)" } },
    ult2: { name: "神聖新星", icon: "sun", effect: { kind: "dmgMult", value: 1.6, desc: "新大招:改走攻擊路線，傷害 x1.6(不回血)" } },
    mastery: { name: "治療精研", icon: "heart", levels: { 1: 1, 2: 2, 3: 3 }, desc: "沿用現有職業被動(完全治癒/每回合回血量提升)" },
  });

  // ---- 通用被動:不綁系別/職業，Lv.5 技能樹一解鎖就能點(跟現有 PASSIVE_DEFS 8個對應) ----
  Object.keys(PASSIVE_DEFS).forEach((key) => {
    const def = PASSIVE_DEFS[key];
    _addNode({ id: `generic_${key}`, type: "passive", requires: null, unlockCharLevel: 5, cost: 1, maxLevel: MAX_SKILL_LEVEL, name: def.name, icon: def.icon, effect: { levels: def.levels, format: def.format, desc: def.desc } });
  });

  // ---- 查詢用的小工具(純資料查詢，不吃玩家進度，Phase 3 以後才會用到) ----
  function getSkillTreeNode(id) {
    return SKILL_TREE_NODES[id] || null;
  }
  function getSkillTreeChildren(id) {
    return Object.values(SKILL_TREE_NODES).filter((n) => n.requires === id);
  }
  function getSkillTreeRoots() {
    return Object.values(SKILL_TREE_NODES).filter((n) => n.requires === null);
  }

  // ---- §6 Migration mapping:舊 skill_key -> 新節點id(Phase 1 只定義對照表，不執行) ----
  // "active_skill" 沒辦法只靠這張表決定要對應到 <classKey>_skill_1 還是 _skill_2，因為舊系統
  // 一個職業只有1個戰技，等於直接對應新系統的「技能1」，新開的「技能2」留給玩家之後重新點。
  // "class_mastery:<classKey>" 直接對應 "<classKey>_mastery"，等級數字原封不動搬過去。
  // 8個通用被動 key 直接對應 "generic_<key>"。
  function migrationTargetNodeId(oldSkillKey, finalClassKey) {
    if (oldSkillKey === "active_skill") return finalClassKey ? `${finalClassKey}_skill_1` : null;
    if (oldSkillKey.startsWith("class_mastery:")) return `${oldSkillKey.slice("class_mastery:".length)}_mastery`;
    if (PASSIVE_DEFS[oldSkillKey]) return `generic_${oldSkillKey}`;
    return null;
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
    SKILL_POINTS_PER_LEVEL,
    TRANSFER_LEVEL_FINAL,
    PATH_TRANSFER_BONUS,
    FINAL_TRANSFER_BONUS,
    STARTER_PACK_POTIONS,
    ULT_MANA_COST,
    MANA_REGEN_PER_ROUND,
    SKILL_MANA_COST,
    SKILL_DMG_MULT,
    MAX_SKILL_LEVEL,
    SKILL_LEVEL_DMG_MULT,
    skillDmgMult,
    PASSIVE_DEFS,
    PASSIVE_KEYS,
    passiveValue,
    passiveLevelDesc,
    CLASS_MASTERY_DEFS,
    classMasteryDesc,
    classMasteryBonus,
    // 技能樹 v2 — Phase 1(草案，尚未接進任何遊戲邏輯，見上方大段註解)
    SKILL_TREE_NODES,
    getSkillTreeNode,
    getSkillTreeChildren,
    getSkillTreeRoots,
    migrationTargetNodeId,
    SKILL_NAME,
    skillDesc,
    computeStats,
    applyProgress,
    critChance,
    listClasses,
  };
})();
