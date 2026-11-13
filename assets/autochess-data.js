// 夜市自走棋 · 資料檔(企劃書 docs/autochess-design.md 第三、四章)
//
// 純資料 + 幾個純函式(經濟/升級/機率表),不碰 DOM、不碰資料庫,Node 與瀏覽器都能載入。
// 新增卡牌只改這個檔案,引擎(autochess-engine.js)不用動:效果用「事件鉤子 + 參數」描述。
//
// 效果寫法:{ on: 鉤子, when?: 'vanguard'|'finale'(站位條件), do: 動作, ...參數 }
//   鉤子 on:passive(戰鬥全程)/ start(開場)/ roundStart / attack(出手後)/ hurt(受傷後)/
//          kill(擊殺時)/ death(死亡時)/ roundEnd / crit(暴擊時)
//   站位條件 when:vanguard(第 1 位)/ finale(最後一位)/ front(前半)/ back(後半);atRound:只在第 N 回合觸發(roundStart / roundEnd 用)
//   換位 deploy(卡牌或 star3 上的欄位):'swapFront' 開場與第 1 位換位 / 'swapBack' 開場與最後一位換位(換位後才判定先鋒/壓軸)
//   動作 do 與參數見 autochess-engine.js 的 ACTIONS。
//   數值參數(n / flat / pct)會依星級放大:1★×1.0、2★×1.5、3★×2.0(見 STAR.fx)。
window.AutochessData = (function () {
  // 資料版本:每場活動開始時記進 events.rules.autochess.dataVersion,之後調數值不影響進行中的場次(企劃點子 10)
  const DATA_VERSION = 2; // v2(階段 4):8 流派、53 張卡、隱藏羈絆、新機制

  // 流派(icon 為 lucide 名稱,動工階段 2 做畫面時再確認名稱)
  const TAGS = {
    burn: { name: "炭火", icon: "flame", desc: "灼傷:持續傷害、可疊層" },
    frost: { name: "冰鎮", icon: "snowflake", desc: "凍結:讓敵人跳過行動" },
    guard: { name: "把式", icon: "shield", desc: "護盾與減傷:前排坦克" },
    game: { name: "遊戲攤", icon: "dices", desc: "暴擊與運氣:爆發輸出" },
    potion: { name: "藥燉", icon: "soup", desc: "治療、中毒、復活:耐打又耗人" },
    thief: { name: "順手", icon: "hand-coins", desc: "經濟與削弱:戰鬥中賺銅板、偷敵人攻擊" },
    fortune: { name: "卜卦", icon: "scroll", desc: "站位預言:先鋒與壓軸的位置獎勵" },
    clock: { name: "發條", icon: "cog", desc: "疊層成長:越打越強的慢熱流" },
  };

  // 稀有度:費用 1 / 2 / 3 / 5 銅板(企劃 3-6)
  const RARITY = [
    { key: "common", name: "普通", cost: 1 },
    { key: "rare", name: "稀有", cost: 2 },
    { key: "epic", name: "史詩", cost: 3 },
    { key: "legend", name: "傳說", cost: 5 },
  ];
  const COST_TO_RARITY = { 1: 0, 2: 1, 3: 2, 5: 3 };

  // 星級倍率(企劃 3-7):屬性倍率 / 效果數值倍率;同名同星 2 張合成 1 張更高星(3★ 因此要 4 張 1★)
  const STAR = {
    stat: { 1: 1.0, 2: 1.8, 3: 3.5 },
    fx: { 1: 1.0, 2: 1.5, 3: 2.0 },
    mergeNeed: 2,
    max: 3,
  };

  // 卡牌:atk / hp / spd 是 1★ 數值;star3 是 3★ 質變(額外多一組效果,企劃 3-7)
  // 屬性預算標尺 ATK×3+HP ≈ 1 費 11 / 2 費 17 / 3 費 26 / 5 費 40(效果另計)
  const CARDS = [
    // ---- 炭火 ----
    { id: "sausage_apprentice", name: "烤香腸學徒", cost: 1, tags: ["burn"], atk: 2, hp: 5, spd: 3,
      desc: "出手時,目標灼傷 1 層。", fx: [{ on: "attack", do: "burn", n: 1 }],
      star3: { desc: "3★:灼傷會擴散到目標後面那一位。", fx: [{ on: "attack", do: "burnNext", n: 1 }] } },
    { id: "charcoal_uncle", name: "炭爐阿伯", cost: 2, tags: ["burn"], atk: 3, hp: 8, spd: 2,
      desc: "先鋒:全隊灼傷每層多受 1 點傷害。", fx: [{ on: "passive", when: "vanguard", do: "burnFlat", n: 1 }],
      star3: { desc: "3★:開場全體敵人灼傷 1 層。", fx: [{ on: "start", do: "burnAll", n: 1 }] } },
    { id: "chili_lady", name: "辣椒醬娘", cost: 3, tags: ["burn"], atk: 4, hp: 10, spd: 3,
      desc: "開場:全體敵人灼傷 1 層。", fx: [{ on: "start", do: "burnAll", n: 1 }],
      star3: { desc: "3★:出手時目標也灼傷。", fx: [{ on: "attack", do: "burn", n: 1 }] } },
    { id: "squid_boss", name: "烤魷魚霸王", cost: 5, tags: ["burn"], atk: 6, hp: 22, spd: 3,
      desc: "開場:全體敵人灼傷 2 層;出手時目標灼傷 1 層。",
      fx: [{ on: "start", do: "burnAll", n: 2 }, { on: "attack", do: "burn", n: 1 }],
      star3: { desc: "3★:每回合結束,全體敵人再灼傷 1 層。", fx: [{ on: "roundEnd", do: "burnAll", n: 1 }] } },
    // ---- 冰鎮 ----
    { id: "shaved_ice_boy", name: "剉冰小弟", cost: 1, tags: ["frost"], atk: 2, hp: 5, spd: 4,
      desc: "開場:凍結敵方速度最快者 1 回合。", fx: [{ on: "start", do: "freezeFastest", n: 1 }],
      star3: { desc: "3★:開場再凍結一名隨機敵人。", fx: [{ on: "start", do: "freezeRandom", n: 1 }] } },
    { id: "popsicle_vendor", name: "冰棒小販", cost: 2, tags: ["frost"], atk: 3, hp: 8, spd: 3,
      desc: "出手時有 20% 機率凍結目標 1 回合。", fx: [{ on: "attack", do: "freezeTarget", chance: 20 }],
      star3: { desc: "3★:開場凍結敵方速度最快者。", fx: [{ on: "start", do: "freezeFastest", n: 1 }] } },
    { id: "grass_jelly_sis", name: "仙草凍姊", cost: 3, tags: ["frost"], atk: 3, hp: 11, spd: 3,
      desc: "壓軸:每回合開始,凍結隨機一名敵人。", fx: [{ on: "roundStart", when: "finale", do: "freezeRandom", n: 1 }],
      star3: { desc: "3★:不用站最後也會凍結。", fx: [{ on: "roundStart", do: "freezeRandom", n: 1 }] } },
    { id: "snow_queen", name: "雪花冰女王", cost: 5, tags: ["frost"], atk: 5, hp: 25, spd: 3,
      desc: "開場獲得 6 點護盾;壓軸:每回合開始凍結隨機一名敵人。",
      fx: [{ on: "start", do: "shieldSelf", flat: 6 }, { on: "roundStart", when: "finale", do: "freezeRandom", n: 1 }],
      star3: { desc: "3★:每回合開始再凍結一名隨機敵人。", fx: [{ on: "roundStart", do: "freezeRandom", n: 1 }] } },
    // ---- 把式 ----
    { id: "street_strongman", name: "賣藝壯漢", cost: 1, tags: ["guard"], atk: 2, hp: 6, spd: 2,
      desc: "先鋒:開場獲得 4 點護盾。", fx: [{ on: "start", when: "vanguard", do: "shieldSelf", flat: 4 }],
      star3: { desc: "3★:不用站第一位也有護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 4 }] } },
    { id: "iron_head_master", name: "鐵頭功師傅", cost: 2, tags: ["guard"], atk: 3, hp: 9, spd: 2,
      desc: "受傷時,反彈 1 點傷害。", fx: [{ on: "hurt", do: "reflect", flat: 1 }],
      star3: { desc: "3★:開場獲得 5 點護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 5 }] } },
    { id: "iron_cloth_grandmaster", name: "鐵布衫宗師", cost: 5, tags: ["guard"], atk: 4, hp: 28, spd: 2,
      desc: "開場:我方全體獲得 5 點護盾;先鋒:受傷時反彈 2 點傷害。",
      fx: [{ on: "start", do: "shieldAllies", flat: 5 }, { on: "hurt", when: "vanguard", do: "reflect", flat: 2 }],
      star3: { desc: "3★:每回合結束,自己獲得 4 點護盾。", fx: [{ on: "roundEnd", do: "shieldSelf", flat: 4 }] } },
    { id: "dojo_master", name: "武館館主", cost: 3, tags: ["guard"], atk: 3, hp: 14, spd: 2,
      desc: "開場:我方全體獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 3 }],
      star3: { desc: "3★:受傷時反彈 2 點傷害。", fx: [{ on: "hurt", do: "reflect", flat: 2 }] } },
    // ---- 遊戲攤 ----
    { id: "ring_toss_girl", name: "套圈圈小妹", cost: 1, tags: ["game"], atk: 3, hp: 4, spd: 3,
      desc: "暴擊率 +20%。", fx: [{ on: "passive", do: "crit", pct: 20 }],
      star3: { desc: "3★:每次暴擊,本場結算多 1 銅板(上限 5)。", fx: [{ on: "crit", do: "coin", n: 1 }] } },
    { id: "dart_uncle", name: "射飛鏢大叔", cost: 2, tags: ["game"], atk: 4, hp: 7, spd: 3,
      desc: "壓軸:改為攻擊敵方最後一位。", fx: [{ on: "passive", when: "finale", do: "attackLast" }],
      star3: { desc: "3★:暴擊率 +15%。", fx: [{ on: "passive", do: "crit", pct: 15 }] } },
    { id: "gambling_god", name: "夜市賭神", cost: 5, tags: ["game"], atk: 8, hp: 16, spd: 3,
      desc: "暴擊率 +30%;暴擊時追加一次隨機攻擊。",
      fx: [{ on: "passive", do: "crit", pct: 30 }, { on: "crit", do: "extraAttack" }],
      star3: { desc: "3★:每次暴擊,本場結算多 1 銅板(上限 5)。", fx: [{ on: "crit", do: "coin", n: 1 }] } },
    { id: "claw_machine_boss", name: "夾娃娃店長", cost: 3, tags: ["game"], atk: 5, hp: 11, spd: 3,
      desc: "暴擊率 +25%。", fx: [{ on: "passive", do: "crit", pct: 25 }],
      star3: { desc: "3★:暴擊時追加一次隨機攻擊。", fx: [{ on: "crit", do: "extraAttack" }] } },
    // ---- 通用(無流派)----
    { id: "passerby", name: "路過的客人", cost: 1, tags: [], atk: 2, hp: 6, spd: 2,
      desc: "鄰接:被擊敗時,左右友軍 +1 攻擊。", fx: [{ on: "death", do: "buffAdjAtk", n: 1 }],
      star3: { desc: "3★:開場左右友軍就 +1 攻擊。", fx: [{ on: "start", do: "buffAdjAtk", n: 1 }] } },
    { id: "onlooker", name: "看熱鬧的路人", cost: 2, tags: [], atk: 2, hp: 11, spd: 2,
      desc: "鄰接:開場左右友軍 +1 攻擊。", fx: [{ on: "start", do: "buffAdjAtk", n: 1 }],
      star3: { desc: "3★:被擊敗時左右友軍再 +1 攻擊。", fx: [{ on: "death", do: "buffAdjAtk", n: 1 }] } },
    // ---- 雙流派(橋樑卡;企劃範例的「阿旺」是 4 費,但稀有度只有 1/2/3/5 費,先放 3 費史詩)----
    { id: "awang", name: "阿旺", cost: 3, tags: ["burn", "game"], atk: 5, hp: 12, spd: 3,
      desc: "雙流派(炭火+遊戲攤)。暴擊時,目標灼傷 2 層。", fx: [{ on: "crit", do: "burn", n: 2 }],
      star3: { desc: "3★:暴擊率 +15%。", fx: [{ on: "passive", do: "crit", pct: 15 }] } },
    // ================= 階段 4 新增(v2)=================
    // ---- 炭火 +1 ----
    { id: "corn_vendor", name: "烤玉米小販", cost: 2, tags: ["burn"], atk: 4, hp: 6, spd: 3,
      desc: "壓軸:出手時,目標灼傷 2 層。", fx: [{ on: "attack", when: "finale", do: "burn", n: 2 }],
      star3: { desc: "3★:擊殺時,全體敵人灼傷 1 層。", fx: [{ on: "kill", do: "burnAll", n: 1 }] } },
    // ---- 冰鎮 +1 ----
    { id: "plum_ice_girl", name: "梅子冰妹", cost: 1, tags: ["frost"], atk: 2, hp: 5, spd: 3,
      desc: "受傷時有 25% 機率凍結攻擊者 1 回合。", fx: [{ on: "hurt", do: "freezeSrc", chance: 25 }],
      star3: { desc: "3★:開場凍結一名隨機敵人。", fx: [{ on: "start", do: "freezeRandom", n: 1 }] } },
    // ---- 把式 +1 ----
    { id: "wooden_dummy_man", name: "木樁武生", cost: 2, tags: ["guard"], atk: 3, hp: 9, spd: 2,
      desc: "鄰接:開場左右友軍各獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAdj", flat: 3 }],
      star3: { desc: "3★:自己也獲得 4 點護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 4 }] } },
    // ---- 遊戲攤 +1 ----
    { id: "balloon_stall", name: "氣球射擊攤主", cost: 1, tags: ["game"], atk: 3, hp: 4, spd: 4,
      desc: "暴擊時,對隨機一名敵人造成 2 點傷害。", fx: [{ on: "crit", do: "dmgRandom", n: 2 }],
      star3: { desc: "3★:暴擊率 +15%。", fx: [{ on: "passive", do: "crit", pct: 15 }] } },
    // ---- 藥燉 ----
    { id: "herb_tea_boy", name: "青草茶小弟", cost: 1, tags: ["potion"], atk: 2, hp: 6, spd: 2,
      desc: "每回合結束,回復自己 2 點血量。", fx: [{ on: "roundEnd", do: "healSelf", flat: 2 }],
      star3: { desc: "3★:每回合結束,我方全體回復 1 點血量。", fx: [{ on: "roundEnd", do: "healAllies", flat: 1 }] } },
    { id: "ginseng_chicken_auntie", name: "人蔘雞阿姨", cost: 2, tags: ["potion"], atk: 3, hp: 9, spd: 2,
      desc: "每回合結束,回復我方血量最低者 3 點。", fx: [{ on: "roundEnd", do: "healLowest", flat: 3 }],
      star3: { desc: "3★:開場我方全體獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 3 }] } },
    { id: "black_jelly_grandpa", name: "燒仙草阿公", cost: 2, tags: ["potion"], atk: 4, hp: 7, spd: 3,
      desc: "出手時,目標中毒 1 層(中毒每回合結束受傷、無視護盾、不會消退,最多 6 層)。", fx: [{ on: "attack", do: "poison", n: 1 }],
      star3: { desc: "3★:出手時,目標後面那一位也中毒。", fx: [{ on: "attack", do: "poisonNext", n: 1 }] } },
    { id: "herbal_pharmacist", name: "中藥鋪掌櫃", cost: 3, tags: ["potion"], atk: 4, hp: 12, spd: 2,
      desc: "開場:全體敵人中毒 1 層。", fx: [{ on: "start", do: "poisonAll", n: 1 }],
      star3: { desc: "3★:每回合結束,全體敵人再中毒 1 層。", fx: [{ on: "roundEnd", do: "poisonAll", n: 1 }] } },
    { id: "tonic_grandma", name: "十全大補阿嬤", cost: 5, tags: ["potion"], atk: 5, hp: 26, spd: 2,
      desc: "我方第一位陣亡的友軍以 50% 血量復活(每場 1 次);每回合結束,我方全體回復 2 點血量。",
      fx: [{ on: "passive", do: "reviveFirst", pct: 50 }, { on: "roundEnd", do: "healAllies", flat: 2 }],
      star3: { desc: "3★:開場我方全體獲得 4 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 4 }] } },
    // ---- 順手 ----
    { id: "pickpocket_kid", name: "扒手小子", cost: 1, tags: ["thief"], atk: 3, hp: 4, spd: 4,
      desc: "擊殺時,本場結算多 1 銅板(本場上限 5)。", fx: [{ on: "kill", do: "coin", n: 1 }],
      star3: { desc: "3★:開場本場結算多 1 銅板。", fx: [{ on: "start", do: "coin", n: 1 }] } },
    { id: "haggler_auntie", name: "殺價阿姨", cost: 2, tags: ["thief"], atk: 3, hp: 8, spd: 3,
      desc: "開場:敵方攻擊最高者攻擊 -2。", fx: [{ on: "start", do: "weakenTop", n: 2 }],
      star3: { desc: "3★:開場本場結算多 1 銅板。", fx: [{ on: "start", do: "coin", n: 1 }] } },
    { id: "lucky_draw_boss", name: "抽抽樂老闆", cost: 2, tags: ["thief"], atk: 4, hp: 7, spd: 3,
      desc: "暴擊率 +15%;暴擊時,本場結算多 1 銅板。", fx: [{ on: "passive", do: "crit", pct: 15 }, { on: "crit", do: "coin", n: 1 }],
      star3: { desc: "3★:暴擊時,對隨機一名敵人造成 3 點傷害。", fx: [{ on: "crit", do: "dmgRandom", n: 3 }] } },
    { id: "bargain_king", name: "跳樓大拍賣王", cost: 3, tags: ["thief"], atk: 4, hp: 11, spd: 3,
      desc: "我方贏得這場戰鬥時,本場結算多 2 銅板。", fx: [{ on: "passive", do: "winCoin", n: 2 }],
      star3: { desc: "3★:出手時,偷走目標 1 點攻擊給自己。", fx: [{ on: "attack", do: "stealAtk", n: 1 }] } },
    { id: "market_tycoon", name: "夜市大亨", cost: 5, tags: ["thief"], atk: 6, hp: 22, spd: 3,
      desc: "開場:敵方攻擊最高者攻擊 -3,我方全體攻擊 +1;擊殺時本場結算多 1 銅板。",
      fx: [{ on: "start", do: "weakenTop", n: 3 }, { on: "start", do: "buffAllyAtk", n: 1 }, { on: "kill", do: "coin", n: 1 }],
      star3: { desc: "3★:我方贏得戰鬥時,本場結算多 2 銅板。", fx: [{ on: "passive", do: "winCoin", n: 2 }] } },
    // ---- 卜卦 ----
    { id: "fortune_stick_boy", name: "籤筒小弟", cost: 1, tags: ["fortune"], atk: 2, hp: 5, spd: 3,
      desc: "先鋒:開場攻擊 +3。", fx: [{ on: "start", when: "vanguard", do: "buffSelfAtk", n: 3 }],
      star3: { desc: "3★:壓軸時開場攻擊也 +3。", fx: [{ on: "start", when: "finale", do: "buffSelfAtk", n: 3 }] } },
    { id: "palm_reader", name: "看手相阿婆", cost: 2, tags: ["fortune"], atk: 3, hp: 8, spd: 2,
      desc: "壓軸:開場我方全體攻擊 +1。", fx: [{ on: "start", when: "finale", do: "buffAllyAtk", n: 1 }],
      star3: { desc: "3★:先鋒時,開場我方全體獲得 3 點護盾。", fx: [{ on: "start", when: "vanguard", do: "shieldAllies", flat: 3 }] } },
    { id: "fengshui_master", name: "風水師", cost: 2, tags: ["fortune"], atk: 3, hp: 8, spd: 3,
      desc: "前排:開場獲得 3 點護盾。後排:開場攻擊 +2。",
      fx: [{ on: "start", when: "front", do: "shieldSelf", flat: 3 }, { on: "start", when: "back", do: "buffSelfAtk", n: 2 }],
      star3: { desc: "3★:開場左右友軍攻擊 +1。", fx: [{ on: "start", do: "buffAdjAtk", n: 1 }] } },
    { id: "antique_dealer", name: "古董攤老闆", cost: 3, tags: ["fortune"], atk: 4, hp: 11, spd: 2,
      desc: "先鋒:每回合結束,自己獲得 2 點護盾。", fx: [{ on: "roundEnd", when: "vanguard", do: "shieldSelf", flat: 2 }],
      star3: { desc: "3★:壓軸時也有此效果。", fx: [{ on: "roundEnd", when: "finale", do: "shieldSelf", flat: 2 }] } },
    { id: "oracle_grandpa", name: "神算子", cost: 5, tags: ["fortune"], atk: 7, hp: 22, spd: 3,
      desc: "開場:先鋒獲得 8 點護盾,壓軸攻擊 +3。", fx: [{ on: "start", do: "shieldVanguard", flat: 8 }, { on: "start", do: "buffFinaleAtk", n: 3 }],
      star3: { desc: "3★:每回合結束,我方血量最低者回復 3 點。", fx: [{ on: "roundEnd", do: "healLowest", flat: 3 }] } },
    // ---- 發條 ----
    { id: "wind_up_frog", name: "發條青蛙", cost: 1, tags: ["clock"], atk: 2, hp: 5, spd: 3,
      desc: "每回合結束,攻擊 +1。", fx: [{ on: "roundEnd", do: "growAtk", n: 1 }],
      star3: { desc: "3★:每回合結束,血量上限與血量也 +2。", fx: [{ on: "roundEnd", do: "growHp", n: 2 }] } },
    { id: "tin_robot", name: "鐵皮機器人", cost: 2, tags: ["clock"], atk: 3, hp: 7, spd: 3,
      desc: "鄰接:每回合結束,左右友軍攻擊 +1。", fx: [{ on: "roundEnd", do: "buffAdjAtk", n: 1 }],
      star3: { desc: "3★:開場左右友軍攻擊 +1。", fx: [{ on: "start", do: "buffAdjAtk", n: 1 }] } },
    { id: "battery_toy_seller", name: "電動玩具攤販", cost: 2, tags: ["clock"], atk: 3, hp: 9, spd: 2,
      desc: "每回合結束,我方全體血量上限與血量 +2。", fx: [{ on: "roundEnd", do: "growAllyHp", n: 2 }],
      star3: { desc: "3★:每回合結束,我方全體攻擊 +1。", fx: [{ on: "roundEnd", do: "buffAllyAtk", n: 1 }] } },
    { id: "gear_craftsman", name: "齒輪師傅", cost: 3, tags: ["clock"], atk: 4, hp: 11, spd: 3,
      desc: "每回合開始,攻擊 +1。", fx: [{ on: "roundStart", do: "growAtk", n: 1 }],
      star3: { desc: "3★:每回合結束,我方全體攻擊 +1。", fx: [{ on: "roundEnd", do: "buffAllyAtk", n: 1 }] } },
    { id: "clockwork_giant", name: "發條巨人", cost: 5, tags: ["clock"], atk: 6, hp: 26, spd: 2,
      desc: "第 4 回合起攻擊翻倍;每回合結束,血量上限與血量 +3。",
      fx: [{ on: "roundStart", atRound: 4, do: "doubleAtk" }, { on: "roundEnd", do: "growHp", n: 3 }],
      star3: { desc: "3★:每回合結束,我方全體攻擊 +1。", fx: [{ on: "roundEnd", do: "buffAllyAtk", n: 1 }] } },
    // ---- 雙流派 +6 ----
    { id: "fire_ice_dessert", name: "冰火九重天", cost: 3, tags: ["burn", "frost"], atk: 4, hp: 12, spd: 3,
      desc: "雙流派(炭火+冰鎮)。出手時,目標灼傷 1 層;目標凍結中則再灼傷 2 層。",
      fx: [{ on: "attack", do: "burn", n: 1 }, { on: "attack", do: "burnIfFrozen", n: 2 }],
      star3: { desc: "3★:開場凍結敵方速度最快者。", fx: [{ on: "start", do: "freezeFastest", n: 1 }] } },
    { id: "arm_wrestle_champ", name: "比腕力冠軍", cost: 3, tags: ["guard", "game"], atk: 5, hp: 13, spd: 2,
      desc: "雙流派(把式+遊戲攤)。暴擊率 +20%;先鋒:受傷時反彈 2 點傷害。",
      fx: [{ on: "passive", do: "crit", pct: 20 }, { on: "hurt", when: "vanguard", do: "reflect", flat: 2 }],
      star3: { desc: "3★:暴擊時獲得 4 點護盾。", fx: [{ on: "crit", do: "shieldSelf", flat: 4 }] } },
    { id: "ice_wall_master", name: "冰牆師傅", cost: 2, tags: ["frost", "guard"], atk: 3, hp: 10, spd: 2,
      desc: "雙流派(冰鎮+把式)。開場獲得 4 點護盾;受傷時 20% 機率凍結攻擊者。",
      fx: [{ on: "start", do: "shieldSelf", flat: 4 }, { on: "hurt", do: "freezeSrc", chance: 20 }],
      star3: { desc: "3★:開場我方全體獲得 2 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 2 }] } },
    { id: "herbal_bbq", name: "藥膳烤肉攤", cost: 3, tags: ["potion", "burn"], atk: 5, hp: 12, spd: 3,
      desc: "雙流派(藥燉+炭火)。出手時,目標灼傷 1 層、自己回復 2 點血量。",
      fx: [{ on: "attack", do: "burn", n: 1 }, { on: "attack", do: "healSelf", flat: 2 }],
      star3: { desc: "3★:擊殺時,我方全體回復 3 點血量。", fx: [{ on: "kill", do: "healAllies", flat: 3 }] } },
    { id: "street_gambler", name: "街頭賭客", cost: 2, tags: ["thief", "game"], atk: 4, hp: 6, spd: 4,
      desc: "雙流派(順手+遊戲攤)。暴擊率 +15%;暴擊時,本場結算多 1 銅板。",
      fx: [{ on: "passive", do: "crit", pct: 15 }, { on: "crit", do: "coin", n: 1 }],
      star3: { desc: "3★:暴擊時,偷走目標 2 點攻擊給自己。", fx: [{ on: "crit", do: "stealAtk", n: 1 }] } },
    { id: "fate_clockmaker", name: "命運鐘錶匠", cost: 5, tags: ["fortune", "clock"], atk: 6, hp: 22, spd: 3,
      desc: "雙流派(卜卦+發條)。先鋒:每回合結束攻擊 +2;壓軸:每回合結束我方全體攻擊 +1。",
      fx: [{ on: "roundEnd", when: "vanguard", do: "growAtk", n: 2 }, { on: "roundEnd", when: "finale", do: "buffAllyAtk", n: 1 }],
      star3: { desc: "3★:開場先鋒獲得 8 點護盾。", fx: [{ on: "start", do: "shieldVanguard", flat: 8 }] } },
    // ---- 通用 +4(換位、補洞)----
    { id: "wandering_monk", name: "遊方和尚", cost: 1, tags: [], atk: 2, hp: 6, spd: 2, deploy: "swapFront",
      desc: "換位:開場與第 1 位換位(換位後才判定先鋒);開場自己獲得 2 點護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 2 }],
      star3: { desc: "3★:開場左右友軍攻擊 +1。", fx: [{ on: "start", do: "buffAdjAtk", n: 1 }] } },
    { id: "snack_runner", name: "跑腿小弟", cost: 2, tags: [], atk: 4, hp: 7, spd: 4, deploy: "swapBack",
      desc: "換位:開場與最後一位換位(換位後才判定壓軸);擊殺時攻擊 +1。", fx: [{ on: "kill", do: "buffSelfAtk", n: 1 }],
      star3: { desc: "3★:出手時 20% 機率凍結目標。", fx: [{ on: "attack", do: "freezeTarget", chance: 20 }] } },
    { id: "stall_cat", name: "攤位招財貓", cost: 3, tags: [], atk: 4, hp: 14, spd: 2,
      desc: "鄰接:每回合結束,左右友軍回復 2 點血量。", fx: [{ on: "roundEnd", do: "healAdj", flat: 2 }],
      star3: { desc: "3★:開場左右友軍各獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAdj", flat: 3 }] } },
    { id: "night_patrol", name: "巡邏的警員", cost: 3, tags: [], atk: 5, hp: 15, spd: 3,
      desc: "先鋒:受傷時反彈 1 點傷害,開場獲得 4 點護盾。", fx: [{ on: "hurt", when: "vanguard", do: "reflect", flat: 1 }, { on: "start", when: "vanguard", do: "shieldSelf", flat: 4 }],
      star3: { desc: "3★:不用站第一位也有護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 4 }] } },
  ];
  const CARD_BY_ID = {};
  CARDS.forEach((c) => (CARD_BY_ID[c.id] = c));

  // 羈絆(企劃 3-8、4-2):門檻 2 / 4 / 6,「只算不同名」的卡;雙流派卡兩個流派都算。
  // 每個門檻的 fx 會「累加」:同一個 key 後面的門檻覆蓋前面,不同 key 全部保留(高等級包含低等級)。
  //   burnOnAttack 我方出手附加灼傷層數 / burnMult 灼傷傷害倍率 / startBurnAll 開場全體敵人灼傷層數
  //   startFreezeFastest 開場凍結最快敵人回合數 / roundFreezeChance 每回合凍結隨機敵人的機率% / frozenDmgPct 凍結中敵人受傷加成%
  //   vanguardShieldPct 先鋒護盾(最大血量%) / dmgReduction 全隊受傷減免(至少受 1) / frontReflectPct 前排受傷反彈%
  //   (v1 調整:炭火 4 級由 +100% 改 +50%、把式 2 級由 15% 改 25%,依模擬器流派勝率)
  //   critPct 全隊暴擊率% / critExtraAttack 暴擊追加隨機攻擊 / critCoin 每次暴擊多得銅板(上限 BOND_COIN_CAP)
  const BOND_TIERS = [2, 4, 6];
  const BOND_COIN_CAP = 5;
  const BONDS = {
    burn: [
      { need: 2, desc: "我方攻擊附加 1 層灼傷", fx: { burnOnAttack: 1 } },
      { need: 4, desc: "灼傷傷害 +50%", fx: { burnMult: 1.5 } },
      { need: 6, desc: "開場全體敵人灼傷 3 層", fx: { startBurnAll: 3 } },
    ],
    frost: [
      { need: 2, desc: "開場凍結敵方速度最快者 1 回合", fx: { startFreezeFastest: 1 } },
      { need: 4, desc: "每回合 25% 凍結隨機敵人", fx: { roundFreezeChance: 25 } },
      { need: 6, desc: "凍結中的敵人受到傷害 +50%", fx: { frozenDmgPct: 50 } },
    ],
    guard: [
      { need: 2, desc: "先鋒獲得 25% 最大血量護盾", fx: { vanguardShieldPct: 25 } },
      { need: 4, desc: "全隊受傷 -2", fx: { dmgReduction: 2 } },
      { need: 6, desc: "前排受傷時反彈 30%", fx: { frontReflectPct: 30 } },
    ],
    game: [
      { need: 2, desc: "全隊 15% 暴擊", fx: { critPct: 15 } },
      { need: 4, desc: "暴擊率 25%,暴擊時追加一次隨機攻擊", fx: { critPct: 25, critExtraAttack: true } },
      { need: 6, desc: "每次暴擊,本場結算多 +1 銅板(上限 5)", fx: { critCoin: 1 } },
    ],
    potion: [
      { need: 2, desc: "每回合結束,我方全體回復 2 點血量", fx: { healAll: 2 } },
      { need: 4, desc: "我方出手附加 1 層中毒", fx: { poisonOnAttack: 1 } },
      { need: 6, desc: "我方第一位陣亡者以 40% 血量復活(每場 1 次)", fx: { reviveFirstPct: 40 } },
    ],
    thief: [
      { need: 2, desc: "開場:敵方攻擊最高者攻擊 -2", fx: { startWeakenTop: 2 } },
      { need: 4, desc: "我方擊殺時,本場結算多 1 銅板(本場上限 5)", fx: { killCoin: 1 } },
      { need: 6, desc: "我方贏得戰鬥時,本場結算多 2 銅板", fx: { winCoin: 2 } },
    ],
    fortune: [
      { need: 2, desc: "先鋒與壓軸攻擊 +2", fx: { endsAtk: 2 } },
      { need: 4, desc: "先鋒與壓軸受傷 -2", fx: { endsDef: 2 } },
      { need: 6, desc: "先鋒與壓軸攻擊再 +30%、暴擊率 +25%", fx: { endsMult: 30, endsCrit: 25 } },
    ],
    clock: [
      { need: 2, desc: "每回合結束,我方全體攻擊 +1", fx: { tickAtk: 1 } },
      { need: 4, desc: "每回合結束,我方全體血量上限與血量 +3", fx: { tickHp: 3 } },
      { need: 6, desc: "每回合結束,我方全體攻擊再 +1(共 +2)", fx: { tickAtk: 2 } },
    ],
  };

  // 隱藏羈絆(企劃點子 15):指定 3 張卡同時上陣(不限站位)就觸發;未觸發前圖鑑與羈絆列只顯示「？？？」。
  // fx 用法同上;另有 allAtk(開場全隊攻擊 +N)、startShieldAll(開場全隊護盾 +N)。
  const HIDDEN_BONDS = [
    { id: "bosses_meetup", name: "老闆們的聚會", cards: ["squid_boss", "snow_queen", "gambling_god"], desc: "三位攤主同台:全隊攻擊 +3,開場全隊護盾 +6", fx: { allAtk: 3, startShieldAll: 6 } },
    { id: "awang_day", name: "阿旺的一天", cards: ["awang", "passerby", "onlooker"], desc: "阿旺與路人們:全隊暴擊率 +15%,開場全隊護盾 +3", fx: { critPct: 15, startShieldAll: 3 } },
    { id: "closing_time", name: "打烊前的一碗", cards: ["sausage_apprentice", "shaved_ice_boy", "ring_toss_girl"], desc: "收攤前的三位小幫手:全隊攻擊 +2,每回合結束全隊回復 2 點血量", fx: { allAtk: 2, healAll: 2 } },
  ];

  // ---- 戰鬥常數(企劃 3-10)----
  const BATTLE = {
    maxRounds: 30, // 超過 30 回合比總剩餘血量
    bellFrom: 20, // 打烊鐘:第 20 回合起每回合結束全體額外受傷 (回合-19)×2
    bellStep: 2,
    critMult: 1.5,
    hpMult: 1, // 全體單位生命倍率:數值調平衡用的旋鈕(戰鬥太短、先手方太佔便宜時調高)
  };

  // 準備階段秒數:[起始輪次, 秒數](v53 起整場都是 90 秒;之後想前短後長改這裡就好)
  const PREP_SECONDS = [[1, 90], [4, 90], [12, 90]];

  // ---- 經濟 / 血量(企劃 3-2、3-3)----
  const START_HP = 100;
  const START_GOLD = 5;
  const BENCH_SLOTS = 6;
  const SHOP_SLOTS = 5;
  const WIN_BONUS = 2;
  const ROUND_BASE_DAMAGE = [[1, 2], [4, 4], [7, 6], [10, 9], [13, 12], [16, 16], [19, 20]]; // [起始輪次, 基礎傷害]
  const SURVIVOR_STAR_CAP = 10;
  const INTEREST = { per: 10, max: 3, startRound: 1 }; // 金庫:每 10 銅板 +1,上限 +3;startRound 是模擬器調平衡用的旋鈕
  const SELL_PENALTY = 1; // 2★、3★ 賣出少退 1 銅板

  // 升到該級需要的 XP(企劃 3-5)。每輪被動 +2,買經驗 4 銅板 = 4 XP
  const XP_TO_LEVEL = { 2: 2, 3: 3, 4: 5, 5: 8, 6: 12, 7: 17, 8: 23, 9: 30, 10: 38 };
  const PASSIVE_XP = 2;
  const BUY_XP = { cost: 4, xp: 4 };
  const MAX_LEVEL = 10;
  const SLOTS_BY_LEVEL = [0, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8]; // 索引=等級
  // Lv8 商店 6 格 / Lv9 每輪第一次刷新免費 / Lv10 每輪額外 +2 銅板(數值待模擬)
  const LEVEL_PERKS = { shopSlots6: 8, freeFirstRefresh: 9, extraIncome: 10, extraIncomeAmount: 2 };

  // 商店各稀有度機率%(企劃 3-6):索引=等級,四欄=普通/稀有/史詩/傳說
  const SHOP_ODDS = [
    null,
    [100, 0, 0, 0], [90, 10, 0, 0], [75, 25, 0, 0], [55, 35, 10, 0], [40, 40, 18, 2],
    [30, 40, 25, 5], [20, 35, 35, 10], [15, 25, 40, 20], [10, 20, 40, 30], [5, 10, 35, 50],
  ];


  // ---- 攤位加碼(企劃 3-12):R3 / R6 / R9 準備階段開始時三選一 ----
  // 候選:從 4 個類別(econ 經濟 / shop 商店 / growth 成長 / power 戰力)抽 3 個類別各出 1 張;onlyPick 限定第幾次才會出現。
  // target:選了之後還要指定對象('card' 一張卡 / 'tag' 一個流派)。value 為約略銅板等值(平衡標尺:第 1 次≈10、第 2 次≈12、第 3 次≈15)。
  const PERK_ROUNDS = [3, 6, 9];
  const PERK_CATS = { econ: "經濟", shop: "商店", growth: "成長", power: "戰力" };
  const PERKS = [
    { id: "free_refresh", cat: "econ", name: "免費刷新券", icon: "ticket", desc: "接下來 10 次刷新免費(不限輪次,用完為止)。", value: 10, n: 10 },
    { id: "petty_cash", cat: "econ", name: "零用金", icon: "coins", desc: "立刻 +8 銅板。", value: 8, n: 8 },
    { id: "good_rapport", cat: "econ", name: "好人緣", icon: "heart-handshake", desc: "之後 3 輪,每輪結算基本收入 +2。", value: 8, n: 2, rounds: 3 },
    { id: "regular", cat: "shop", name: "老主顧", icon: "star", desc: "下一輪商店保證出現 1 張史詩以上。", value: 10 },
    { id: "preorder", cat: "shop", name: "預購單", icon: "clipboard-list", desc: "選 1 個流派,接下來 3 輪商店該流派出現機率 ×2。", value: 10, target: "tag", mult: 2, rounds: 3 },
    { id: "expand", cat: "shop", name: "擴大營業", icon: "store", desc: "接下來 3 輪商店多 1 格。", value: 8, rounds: 3 },
    { id: "xp_coupon", cat: "growth", name: "升級折扣券", icon: "ticket-percent", desc: "接下來 3 次買經驗各 -2 銅板。", value: 6, n: 3, off: 2 },
    { id: "tutoring", cat: "growth", name: "補習班", icon: "graduation-cap", desc: "立刻獲得 8 點經驗值。", value: 8, n: 8 },
    { id: "stall_plus", cat: "growth", name: "加開攤位", icon: "layout-grid", desc: "上陣位置 +1(永久)。強力選項,只在第 3 次出現。", value: 15, onlyPick: 3 },
    { id: "free_star", cat: "power", name: "免費升星券", icon: "sparkles", desc: "選 1 張 1 費或 2 費的 1★ 卡,立刻升 2★。", value: 10, target: "card" },
    { id: "seasoning", cat: "power", name: "加料", icon: "chef-hat", desc: "選 1 張卡永久 +3 攻擊 / +3 血量。", value: 8, target: "card", atk: 3, hp: 3 },
    { id: "tag_assist", cat: "power", name: "流派助陣", icon: "users", desc: "選 1 個流派,該流派羈絆視為多 1 張(永久,最多算到 4 級)。", value: 12, target: "tag", cap: 4 },
    { id: "streak_guard", cat: "power", name: "連勝保險", icon: "shield-check", desc: "下一次戰敗不中斷連勝(一次性)。", value: 8 },
  ];
  const PERK_BY_ID = {};
  PERKS.forEach((p) => (PERK_BY_ID[p.id] = p));

  // ---- 純函式 ----
  function roundBaseDamage(round) {
    let d = ROUND_BASE_DAMAGE[0][1];
    ROUND_BASE_DAMAGE.forEach(([from, dmg]) => { if (round >= from) d = dmg; });
    return d;
  }
  function prepSeconds(round) {
    let s = PREP_SECONDS[0][1];
    PREP_SECONDS.forEach(([from, sec]) => { if (round >= from) s = sec; });
    return s;
  }
  // 基本收入 I(R)
  function baseIncome(round) {
    return round <= 4 ? 4 : round <= 9 ? 5 : round <= 14 ? 6 : 7;
  }
  // 連勝加成(n = 本場贏完後的連勝數):2 勝 +1 / 3~4 勝 +2 / 5 勝以上 +3
  function streakBonus(n) {
    return n >= 5 ? 3 : n >= 3 ? 2 : n >= 2 ? 1 : 0;
  }
  // 金庫利息:依「當下持有」銅板,每 10 +1,上限 +3
  function interestOf(gold, round) {
    if (round != null && round < INTEREST.startRound) return 0;
    return Math.min(INTEREST.max, Math.floor(Math.max(0, gold) / INTEREST.per));
  }
  function slotsFor(level) { return SLOTS_BY_LEVEL[Math.min(MAX_LEVEL, Math.max(1, level))]; }
  function shopSlotsFor(level) { return level >= LEVEL_PERKS.shopSlots6 ? SHOP_SLOTS + 1 : SHOP_SLOTS; }
  // 賣出退費:1★ 全額;2★ = 2 張費用 -1;3★ = 4 張費用 -1
  function sellValue(card, star) {
    const copies = Math.pow(STAR.mergeNeed, star - 1);
    return card.cost * copies - (star > 1 ? SELL_PENALTY : 0);
  }
  // 加經驗:回傳新的 { level, xp }(xp 為升級後剩餘)
  function addXp(level, xp, amount) {
    xp += amount;
    while (level < MAX_LEVEL && xp >= XP_TO_LEVEL[level + 1]) { xp -= XP_TO_LEVEL[level + 1]; level++; }
    if (level >= MAX_LEVEL) xp = 0;
    return { level, xp };
  }

  return {
    DATA_VERSION, TAGS, RARITY, COST_TO_RARITY, STAR, CARDS, CARD_BY_ID, BOND_TIERS, BOND_COIN_CAP, BONDS, HIDDEN_BONDS, BATTLE,
    START_HP, START_GOLD, BENCH_SLOTS, SHOP_SLOTS, WIN_BONUS, ROUND_BASE_DAMAGE, SURVIVOR_STAR_CAP, INTEREST, SELL_PENALTY,
    XP_TO_LEVEL, PASSIVE_XP, BUY_XP, MAX_LEVEL, SLOTS_BY_LEVEL, LEVEL_PERKS, SHOP_ODDS, PERK_ROUNDS, PERK_CATS, PERKS, PERK_BY_ID,
    PREP_SECONDS, prepSeconds, roundBaseDamage, baseIncome, streakBonus, interestOf, slotsFor, shopSlotsFor, sellValue, addXp,
  };
})();
