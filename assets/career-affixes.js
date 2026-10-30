// 職業養成對決 · 樓層詞條與稀有攤販(玩法擴充階段四項目 11,見 docs/bug-optimization-requirements.md「項目 11」)
//
// 【樓層詞條】每個非關主樓層(第 6 層起)在每個「10 分鐘時段」有一個固定的詞條:
//   同一場活動、同一層、同一個時段,所有玩家看到的詞條都一樣(用活動結束時間+樓層+時段編號算出來的,不用新增資料表);
//   每過 10 分鐘整場活動重新輪替。關主層(每滿 10 層)與 1~5 層沒有詞條。
//   詞條分四階:普通 / 稀有 / 史詩 / 傳說,越高階越少見、效果越強(抽中機率見 TIERS)。
//   有些是對玩家有利的「好詞條」(good = true),多數是「更難但報酬更好」的取捨。
//   效果分四類:怪物(HP/攻擊/防禦/速度/暴擊/減傷/反彈)、玩家(暴擊/減傷)、規則(回合上限/術法倍率)、
//   報酬(經驗/幣/掉落率/稀有掉落偏移/傳說掉落)。數字都在這個檔案,調整只改這裡。
//
// 【稀有攤販】打非關主樓層時有小機率(VENDOR_CHANCE)遇到的特殊攤販:護盾/反彈/狂暴三種,比平常難打,
//   打贏必掉稀有或史詩裝備,再加中量的幣與經驗。每次挑戰各自抽(不是固定的),掛機不會遇到。
(function () {
  const WINDOW_MIN = 10; // 詞條輪替間隔(分鐘)
  const ACTIVITY_MINUTES = 60; // 整場活動長度,要跟 career-modifiers.js / db.js 一致
  const FIRST_AFFIX_FLOOR = 6; // 第幾層起有詞條(前 5 層是新手教學層,保持單純)
  const VENDOR_CHANCE = 0.07; // 非關主樓層每次挑戰遇到稀有攤販的機率

  const TIERS = {
    common: { label: "普通", weight: 55, color: "var(--ink-dim)", icon: "circle" },
    rare: { label: "稀有", weight: 28, color: "#4aa3ff", icon: "diamond" },
    epic: { label: "史詩", weight: 14, color: "#b46bff", icon: "gem" },
    legendary: { label: "傳說", weight: 3, color: "var(--gold)", icon: "crown" },
  };
  const TIER_ORDER = ["common", "rare", "epic", "legendary"];

  // mods 欄位:
  //   怪物  monsterHpMult / monsterAtkMult / monsterDefMult / monsterSpdMult  倍率
  //         monsterCritBonus 暴擊率加成  monsterDmgReduce 受到傷害減免  monsterReflect 反彈傷害比例
  //   玩家  playerCritBonus 暴擊率加成  playerDmgReduce 受到傷害減免
  //   規則  maxRounds 回合上限(超過算輸)  magicMult 術法傷害倍率(雙方都吃)
  //   報酬  expMult / coinMult 倍率  dropChanceAdd 掉落率直接加  rarityBoost 把普通掉落的比例轉成稀有/史詩(0.25 = 轉 25%)
  //         legendaryChance 掉落時變成「傳說裝備」的機率(依樓層:40 層以上是不超過這層的最高一個 Boss 套裝,更早是一般傳說)
  const AFFIXES = [
    // ---- 普通 ----
    { key: "crowd", tier: "common", icon: "users", name: "人潮擁擠", mods: { monsterHpMult: 1.08, dropChanceAdd: 0.1 }, text: "怪物 HP +8%、掉落率 +10%", line: "人太多，怪物也擠得很結實，不過路上掉的東西也多。" },
    { key: "closing", tier: "common", icon: "timer", name: "打烊倒數", mods: { maxRounds: 8, expMult: 1.25, coinMult: 1.25 }, text: "要在 8 回合內打贏(超時算輸)、經驗與幣 +25%", line: "老闆在敲鐵捲門了，快一點。" },
    { key: "smoke", tier: "common", icon: "cloud", name: "油煙瀰漫", mods: { monsterCritBonus: -0.1, playerCritBonus: -0.1, dropChanceAdd: 0.05 }, text: "雙方暴擊率 −10%、掉落率 +5%", line: "煙太濃，誰都看不清，打不太準。" },
    { key: "gourmet", tier: "common", icon: "utensils", name: "老饕客人", mods: { monsterAtkMult: 1.05, expMult: 1.2 }, text: "怪物攻擊 +5%、經驗 +20%", line: "這位客人很挑剔，出手也比較重。" },
    { key: "sale", tier: "common", icon: "badge-percent", good: true, name: "特價大放送", mods: { coinMult: 1.3 }, text: "幣 +30%", line: "今天全場特價，連怪物都在撒幣。" },
    { key: "passerby", tier: "common", icon: "hand-heart", good: true, name: "熱心路人", mods: { playerDmgReduce: 0.1 }, text: "你受到的傷害 −10%", line: "有路人在後面幫你擋了一下。" },
    { key: "rush", tier: "common", icon: "footprints", name: "趕時間", mods: { monsterSpdMult: 1.15, coinMult: 1.2 }, text: "怪物速度 +15%、幣 +20%", line: "對方趕著收攤，動作特別快。" },
    // ---- 稀有 ----
    { key: "rain", tier: "rare", icon: "cloud-rain", name: "雨天濕滑", mods: { magicMult: 0.7, dropChanceAdd: 0.1 }, text: "雙方術法傷害 ×0.7、掉落率 +10%", line: "下雨了，法術都受潮，屋簷下的東西倒是滿地。" },
    { key: "grab", tier: "rare", icon: "armchair", name: "搶位子", mods: { monsterSpdMult: 1.25, expMult: 1.3 }, text: "怪物速度 +25%、經驗 +30%", line: "每個人都想先下手，位子只有一個。" },
    { key: "luck", tier: "rare", icon: "clover", good: true, name: "好彩頭", mods: { playerCritBonus: 0.12, dropChanceAdd: 0.1 }, text: "你的暴擊率 +12%、掉落率 +10%", line: "今天手氣特別好。" },
    { key: "tough", tier: "rare", icon: "shield", name: "硬骨頭", mods: { monsterDefMult: 1.1, monsterHpMult: 1.03, coinMult: 1.3, dropChanceAdd: 0.1 }, text: "怪物防禦 +10%、HP +3%、幣 +30%、掉落率 +10%", line: "這攤的老闆很硬，但打下來很值。" },
    { key: "undercut", tier: "rare", icon: "hand-coins", name: "搶生意", mods: { monsterDmgReduce: 0.08, expMult: 1.4 }, text: "怪物受到傷害 −8%、經驗 +40%", line: "對手把價錢壓得很低，不好打，但學到不少。" },
    // ---- 史詩 ----
    { key: "brawl", tier: "epic", icon: "swords", name: "夜市大亂鬥", mods: { monsterHpMult: 1.06, monsterAtkMult: 1.05, expMult: 1.5, coinMult: 1.5, dropChanceAdd: 0.15 }, text: "怪物 HP +6%、攻擊 +5%;經驗 +50%、幣 +50%、掉落率 +15%", line: "整條街都在打，你只是剛好撞上一個。" },
    { key: "patron", tier: "epic", icon: "sparkles", good: true, name: "貴人加持", mods: { playerCritBonus: 0.12, playerDmgReduce: 0.12 }, text: "你的暴擊率 +12%、受到傷害 −12%", line: "後面站著一個看起來很有錢的人，一直在替你加油。" },
    { key: "mirror", tier: "epic", icon: "flip-horizontal-2", name: "反彈招牌", mods: { monsterReflect: 0.06, rarityBoost: 0.25 }, text: "怪物反彈 6% 傷害;掉落更容易是稀有以上", line: "招牌是鏡面的，打得越用力，彈得越痛。" },
    // ---- 傳說 ----
    { key: "godpass", tier: "legendary", icon: "crown", good: true, name: "夜市之神路過", mods: { expMult: 2, coinMult: 1.5, legendaryChance: 0.05, playerDmgReduce: 0.1 }, text: "經驗 ×2、幣 +50%、你受到傷害 −10%;這層提高傳說掉落率(掉落時有 5% 是傳說，依樓層:40 層以上是對應的 Boss 套裝)", line: "有人說，今晚夜市之神出來散步了。" },
  ];
  const AFFIX_BY_KEY = {};
  AFFIXES.forEach((a) => (AFFIX_BY_KEY[a.key] = a));

  // ---- 稀有攤販 ----
  const VENDORS = [
    { key: "shield", title: "護盾攤販", icon: "shield-half", text: "受到傷害 −8%、HP +5%", line: "這攤的鐵皮特別厚。", monster: { hpMult: 1.05, dmgReduce: 0.08 } },
    { key: "reflect", title: "反彈攤販", icon: "flip-horizontal-2", text: "反彈 5% 傷害、HP +5%", line: "這攤的招牌會把力道彈回去。", monster: { hpMult: 1.05, reflect: 0.05 } },
    { key: "rage", title: "狂暴攤販", icon: "flame", text: "攻擊 +15%、速度 +10%、暴擊率 +5%、HP −5%", line: "這攤的老闆今天心情很差。", monster: { hpMult: 0.95, atkMult: 1.15, spdMult: 1.1, critBonus: 0.05 } },
  ];
  const VENDOR_REWARD = { expMult: 1.5, coinMult: 1.5, dropChance: 1, rarityWeights: { rare: 0.7, epic: 0.3 } }; // 打贏必掉稀有以上,幣與經驗中量加成

  // ---- 時間與抽選 ----
  function startMs(rules) {
    if (!rules || !rules.activityEndsAt) return null;
    return new Date(rules.activityEndsAt).getTime() - ACTIVITY_MINUTES * 60000;
  }
  // 現在是第幾個 10 分鐘時段(從 0 開始);沒有活動時間資訊(舊活動)固定當作第 0 時段
  function windowIndex(rules, now) {
    const s = startMs(rules);
    if (s == null) return 0;
    const m = ((now == null ? Date.now() : now) - s) / 60000;
    return Math.max(0, Math.floor(m / WINDOW_MIN));
  }
  // 距離下一次輪替還有幾秒(沒有時間資訊回傳 null)
  function secondsToRotate(rules, now) {
    const s = startMs(rules);
    if (s == null) return null;
    const m = ((now == null ? Date.now() : now) - s) / 60000;
    const idx = Math.max(0, Math.floor(m / WINDOW_MIN));
    return Math.max(0, Math.round(((idx + 1) * WINDOW_MIN - m) * 60));
  }
  // 小型字串雜湊(FNV-1a) → 0~1 之間的數,同樣的輸入永遠得到同樣的數
  function hash01(str, salt) {
    let h = 2166136261 ^ (salt || 0);
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  // 這一層、這個時段的詞條(關主層/前 5 層回傳 null)。同一場活動所有玩家得到的結果一致。
  function affixFor(rules, floorNumber, now) {
    if (!floorNumber || floorNumber < FIRST_AFFIX_FLOOR || floorNumber % 10 === 0) return null;
    const seed = `${(rules && rules.activityEndsAt) || "x"}|${floorNumber}|${windowIndex(rules, now)}`;
    let r = hash01(seed, 1) * TIER_ORDER.reduce((n, t) => n + TIERS[t].weight, 0);
    let tier = "common";
    for (const t of TIER_ORDER) { r -= TIERS[t].weight; if (r < 0) { tier = t; break; } }
    const pool = AFFIXES.filter((a) => a.tier === tier);
    return pool[Math.min(pool.length - 1, Math.floor(hash01(seed, 2) * pool.length))];
  }

  // ---- 套到樓層資料上 ----
  // 回傳新的 floorDef(不改原本的)。帶出:stats(怪物數值)、expReward/coinReward/dropChance、
  //   monsterExtra(怪物那一側額外的 critBonus/dmgReduceRatio/spec/magicMult)、playerExtra(玩家那一側)、
  //   maxRounds、rarityBoost、legendaryChance、affix(給畫面顯示)。
  function applyMods(floorDef, mods, tag) {
    if (!floorDef || !mods) return floorDef;
    const st = floorDef.stats;
    const hpM = mods.monsterHpMult || 1, atkM = mods.monsterAtkMult || 1, defM = mods.monsterDefMult || 1, spdM = mods.monsterSpdMult || 1;
    const stats = { ...st, hp: Math.round(st.hp * hpM), maxHp: Math.round((st.maxHp || st.hp) * hpM), atk: Math.round(st.atk * atkM), matk: Math.round((st.matk || 0) * atkM), def: Math.round(st.def * defM), spd: Math.max(1, Math.round(st.spd * spdM)) };
    const monsterExtra = { ...(floorDef.monsterExtra || {}) };
    if (mods.monsterCritBonus) monsterExtra.critBonus = (monsterExtra.critBonus || 0) + mods.monsterCritBonus;
    if (mods.monsterDmgReduce) monsterExtra.dmgReduceRatio = 1 - (1 - (monsterExtra.dmgReduceRatio || 0)) * (1 - mods.monsterDmgReduce);
    if (mods.monsterReflect) monsterExtra.spec = { ...(monsterExtra.spec || {}), reflect: (((monsterExtra.spec || {}).reflect) || 0) + mods.monsterReflect };
    if (mods.magicMult != null) monsterExtra.magicMult = mods.magicMult;
    const playerExtra = { ...(floorDef.playerExtra || {}) };
    if (mods.playerCritBonus) playerExtra.critBonus = (playerExtra.critBonus || 0) + mods.playerCritBonus;
    if (mods.playerDmgReduce) playerExtra.dmgReduceRatio = 1 - (1 - (playerExtra.dmgReduceRatio || 0)) * (1 - mods.playerDmgReduce);
    if (mods.magicMult != null) playerExtra.magicMult = mods.magicMult;
    return {
      ...floorDef,
      stats,
      expReward: Math.round(floorDef.expReward * (mods.expMult || 1)),
      coinReward: Math.round(floorDef.coinReward * (mods.coinMult || 1)),
      dropChance: Math.min(1, floorDef.dropChance + (mods.dropChanceAdd || 0)),
      monsterExtra,
      playerExtra,
      maxRounds: mods.maxRounds ? Math.min(floorDef.maxRounds || 999, mods.maxRounds) : floorDef.maxRounds,
      rarityBoost: (floorDef.rarityBoost || 0) + (mods.rarityBoost || 0),
      legendaryChance: (floorDef.legendaryChance || 0) + (mods.legendaryChance || 0),
      ...tag,
    };
  }
  function applyAffix(floorDef, affix) {
    if (!affix) return floorDef;
    return applyMods(floorDef, affix.mods, { affix: { key: affix.key, tier: affix.tier, name: affix.name, text: affix.text, line: affix.line, icon: affix.icon, good: !!affix.good } });
  }
  // 依活動規則(時間)挑出這一層的詞條並套上;沒有詞條就原樣回傳
  function applyForRules(rules, floorDef, now) {
    if (!floorDef) return floorDef;
    return applyAffix(floorDef, affixFor(rules, floorDef.floor, now));
  }

  // ---- 稀有攤販 ----
  function vendorEligible(floorDef) {
    return !!floorDef && !floorDef.isMiniBoss && floorDef.floor >= FIRST_AFFIX_FLOOR;
  }
  // 機率判斷(random 可以傳入方便測試):回傳 VENDORS 的其中一個或 null
  function rollVendor(floorDef, random) {
    if (!vendorEligible(floorDef)) return null;
    const rnd = random || Math.random;
    if (rnd() >= VENDOR_CHANCE) return null;
    return VENDORS[Math.floor(rnd() * VENDORS.length)];
  }
  function makeVendor(floorDef, vendor) {
    if (!floorDef || !vendor) return floorDef;
    const m = vendor.monster;
    const base = applyMods(floorDef, { monsterHpMult: m.hpMult, monsterAtkMult: m.atkMult, monsterSpdMult: m.spdMult, monsterCritBonus: m.critBonus, monsterDmgReduce: m.dmgReduce, monsterReflect: m.reflect }, {});
    return {
      ...base,
      name: `【${vendor.title}】${floorDef.name}`,
      expReward: Math.round(base.expReward * VENDOR_REWARD.expMult),
      coinReward: Math.round(base.coinReward * VENDOR_REWARD.coinMult),
      dropChance: VENDOR_REWARD.dropChance,
      forceRarityWeights: VENDOR_REWARD.rarityWeights,
      vendor: { key: vendor.key, title: vendor.title, text: vendor.text, line: vendor.line, icon: vendor.icon },
    };
  }

  // ---- 給畫面用 ----
  function tierBadgeHtml(affix) {
    const u = typeof ui !== "undefined" ? ui : null;
    if (!u || !affix) return "";
    const t = TIERS[affix.tier];
    return `<span class="tag" style="border-color:${t.color};color:${t.color};">${u.icon(affix.icon, { size: "12px" })}${u.esc(t.label)}・${u.esc(affix.name)}</span>`;
  }
  function fmtClock(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }
  // 爬塔頁:「下一層」的詞條說明卡(含下次輪替倒數)。沒有詞條回傳空字串
  function cardHtml(rules, floorNumber, now) {
    const u = typeof ui !== "undefined" ? ui : null;
    const a = affixFor(rules, floorNumber, now);
    if (!u || !a) return "";
    const t = TIERS[a.tier];
    const rot = secondsToRotate(rules, now);
    return `
      <div style="margin:10px 0;padding:10px 12px;border-radius:var(--radius);background:var(--panel2);border:1px solid ${t.color};">
        <p style="margin:0 0 4px;font-size:12px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
          <b>第 ${floorNumber} 層詞條</b>${tierBadgeHtml(a)}${a.good ? `<span class="tag" style="color:var(--green);">${u.icon("thumbs-up", { size: "12px" })}好詞條</span>` : ""}
        </p>
        <p style="margin:0;font-size:12px;overflow-wrap:anywhere;">${u.esc(a.text)}</p>
        <p style="margin:3px 0 0;font-size:11px;color:var(--ink-dim);font-style:italic;overflow-wrap:anywhere;">${u.esc(a.line)}${rot != null ? `(${fmtClock(rot)} 後輪替)` : ""}</p>
      </div>`;
  }

  window.CareerAffixes = {
    TIERS, TIER_ORDER, AFFIXES, AFFIX_BY_KEY, VENDORS, VENDOR_CHANCE, VENDOR_REWARD, WINDOW_MIN, FIRST_AFFIX_FLOOR,
    windowIndex, secondsToRotate, affixFor, applyMods, applyAffix, applyForRules, vendorEligible, rollVendor, makeVendor, tierBadgeHtml, cardHtml,
  };
})();
