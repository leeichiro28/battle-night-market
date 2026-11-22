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
  const DATA_VERSION = 8; // v8(階段 11):前排 / 後排(自選排別)、站位關鍵字、擊殺換位、自動排站位重做;v7(階段 10):怪物輪候選池與專屬卡、隱藏羈絆擴充;v6(階段 9):夜市事件、雜貨攤;v5(階段 8):待命席 8 格、上陣最多 10 格分兩排、連勝與利息上限 +5;v4(v59):商店不再出現已 3★ 的卡(企劃 11-8);v3(v58 修復):每流派 +4 張共 85 張卡、合成改 3 張;v2(階段 4):8 流派、53 張卡、隱藏羈絆、新機制

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

  // 星級倍率(企劃 3-7):屬性倍率 / 效果數值倍率;同名同星 3 張合成 1 張更高星(3★ 因此要 9 張 1★)
  const STAR = {
    stat: { 1: 1.0, 2: 1.8, 3: 3.5 },
    fx: { 1: 1.0, 2: 1.5, 3: 2.0 },
    mergeNeed: 3,
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
      star3: { desc: "3★:不用站第一位也有護盾;開場前排全體再獲得 2 點護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 4 }, { on: "start", do: "shieldRow", row: "front", flat: 2 }] } },
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
      star3: { desc: "3★:開場凍結一名隨機敵人,後排全體獲得 2 點護盾。", fx: [{ on: "start", do: "freezeRandom", n: 1 }, { on: "start", do: "shieldRow", row: "back", flat: 2 }] } },
    // ---- 把式 +1 ----
    { id: "wooden_dummy_man", name: "木樁武生", cost: 2, tags: ["guard"], atk: 3, hp: 9, spd: 2,
      desc: "鄰接:開場左右友軍各獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAdj", flat: 3 }],
      star3: { desc: "3★:自己也獲得 4 點護盾;前排全體也各獲得 2 點護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 4 }, { on: "start", do: "shieldRow", row: "front", flat: 2 }] } },
    // ---- 遊戲攤 +1 ----
    { id: "balloon_stall", name: "氣球射擊攤主", cost: 1, tags: ["game"], atk: 3, hp: 4, spd: 4,
      desc: "暴擊時,對隨機一名敵人造成 2 點傷害。", fx: [{ on: "crit", do: "dmgRandom", n: 2 }],
      star3: { desc: "3★:暴擊率 +15%;開場後排全體攻擊 +1。", fx: [{ on: "passive", do: "crit", pct: 15 }, { on: "start", do: "buffRowAtk", row: "back", n: 1 }] } },
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
      desc: "擊殺時,本場結算多 1 銅板(本場上限 5)。擊殺後與後排第一位換位(退到後排)。", fx: [{ on: "kill", do: "coin", n: 1 }, { on: "kill", do: "swapRow", to: "back" }],
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
    // ================= v58 修復批次:每流派 +4 張(1 / 2 / 3 / 5 費各一)=================
    // ---- 炭火 +4 ----
    { id: "sweet_potato_boy", name: "烤地瓜小弟", cost: 1, tags: ["burn"], atk: 2, hp: 5, spd: 3,
      desc: "擊殺時,全體敵人灼傷 1 層。", fx: [{ on: "kill", do: "burnAll", n: 1 }],
      star3: { desc: "3★:出手時,目標灼傷 1 層;開場後排全體攻擊 +1。", fx: [{ on: "attack", do: "burn", n: 1 }, { on: "start", do: "buffRowAtk", row: "back", n: 1 }] } },
    { id: "salty_chicken_vendor", name: "鹽酥雞攤主", cost: 2, tags: ["burn"], atk: 3, hp: 9, spd: 3,
      desc: "壓軸:每回合結束,全體敵人灼傷 1 層。", fx: [{ on: "roundEnd", when: "finale", do: "burnAll", n: 1 }],
      star3: { desc: "3★:開場全體敵人灼傷 1 層。", fx: [{ on: "start", do: "burnAll", n: 1 }] } },
    { id: "spicy_hotpot_chef", name: "麻辣燙大廚", cost: 3, tags: ["burn"], atk: 4, hp: 12, spd: 3,
      desc: "出手時,目標與後面那一位各灼傷 1 層。", fx: [{ on: "attack", do: "burn", n: 1 }, { on: "attack", do: "burnNext", n: 1 }],
      star3: { desc: "3★:開場全體敵人灼傷 1 層。", fx: [{ on: "start", do: "burnAll", n: 1 }] } },
    { id: "whole_lamb_boss", name: "炭烤全羊老闆", cost: 5, tags: ["burn"], atk: 7, hp: 23, spd: 2,
      desc: "開場:全體敵人灼傷 1 層;先鋒:全隊灼傷每層多受 2 點傷害。", fx: [{ on: "start", do: "burnAll", n: 1 }, { on: "passive", when: "vanguard", do: "burnFlat", n: 2 }],
      star3: { desc: "3★:擊殺時,全體敵人灼傷 2 層。", fx: [{ on: "kill", do: "burnAll", n: 2 }] } },
    // ---- 冰鎮 +4 ----
    { id: "aiyu_ice_sis", name: "愛玉冰姐", cost: 1, tags: ["frost"], atk: 3, hp: 4, spd: 4,
      desc: "擊殺時,凍結隨機一名敵人 1 回合。", fx: [{ on: "kill", do: "freezeRandom", n: 1 }],
      star3: { desc: "3★:開場凍結敵方速度最快者。", fx: [{ on: "start", do: "freezeFastest", n: 1 }] } },
    { id: "cold_drink_lady", name: "冷飲店老闆娘", cost: 2, tags: ["frost"], atk: 3, hp: 9, spd: 2,
      desc: "受傷時有 25% 機率凍結攻擊者 1 回合。", fx: [{ on: "hurt", do: "freezeSrc", chance: 25 }],
      star3: { desc: "3★:開場獲得 4 點護盾。", fx: [{ on: "start", do: "shieldSelf", flat: 4 }] } },
    { id: "polar_shave_ice", name: "北極熊刨冰攤", cost: 3, tags: ["frost"], atk: 4, hp: 10, spd: 3,
      desc: "開場:凍結敵方速度最快者;出手時有 30% 機率凍結目標。", fx: [{ on: "start", do: "freezeFastest", n: 1 }, { on: "attack", do: "freezeTarget", chance: 30 }],
      star3: { desc: "3★:開場凍結一名隨機敵人。", fx: [{ on: "start", do: "freezeRandom", n: 1 }] } },
    { id: "ice_sculptor", name: "冰雕藝術家", cost: 5, tags: ["frost"], atk: 5, hp: 24, spd: 3,
      desc: "開場:凍結敵方速度最快者;每回合結束,自己獲得 3 點護盾。", fx: [{ on: "start", do: "freezeFastest", n: 1 }, { on: "roundEnd", do: "shieldSelf", flat: 3 }],
      star3: { desc: "3★:開場再凍結一名隨機敵人。", fx: [{ on: "start", do: "freezeRandom", n: 1 }] } },
    // ---- 把式 +4 ----
    { id: "palanquin_bearer", name: "扛轎壯丁", cost: 1, tags: ["guard"], atk: 2, hp: 5, spd: 2,
      desc: "每回合結束,自己獲得 2 點護盾。", fx: [{ on: "roundEnd", do: "shieldSelf", flat: 2 }],
      star3: { desc: "3★:每回合結束,左右友軍各獲得 2 點護盾。", fx: [{ on: "roundEnd", do: "shieldAdj", flat: 2 }] } },
    { id: "lion_dance_captain", name: "舞獅隊長", cost: 2, tags: ["guard"], atk: 3, hp: 8, spd: 2,
      desc: "開場獲得 2 點護盾;先鋒:受傷時反彈 2 點傷害。", fx: [{ on: "start", do: "shieldSelf", flat: 2 }, { on: "hurt", when: "vanguard", do: "reflect", flat: 2 }],
      star3: { desc: "3★:開場我方全體獲得 2 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 2 }] } },
    { id: "iron_palm_boss", name: "鐵砂掌老闆", cost: 3, tags: ["guard"], atk: 4, hp: 13, spd: 2,
      desc: "開場獲得 3 點護盾;受傷時,反彈 2 點傷害。", fx: [{ on: "start", do: "shieldSelf", flat: 3 }, { on: "hurt", do: "reflect", flat: 2 }],
      star3: { desc: "3★:開場我方全體獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 3 }] } },
    { id: "golden_bell_master", name: "金鐘罩掌門", cost: 5, tags: ["guard"], atk: 5, hp: 30, spd: 2,
      desc: "開場:我方全體獲得 4 點護盾;每回合結束,我方全體獲得 2 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 4 }, { on: "roundEnd", do: "shieldAllies", flat: 2 }],
      star3: { desc: "3★:受傷時,反彈 3 點傷害。", fx: [{ on: "hurt", do: "reflect", flat: 3 }] } },
    // ---- 遊戲攤 +4 ----
    { id: "pinball_kid", name: "彈珠台小弟", cost: 1, tags: ["game"], atk: 3, hp: 4, spd: 3,
      desc: "暴擊率 +10%;暴擊時,自己獲得 2 點護盾。", fx: [{ on: "passive", do: "crit", pct: 10 }, { on: "crit", do: "shieldSelf", flat: 2 }],
      star3: { desc: "3★:暴擊率 +15%。", fx: [{ on: "passive", do: "crit", pct: 15 }] } },
    { id: "marble_grandpa", name: "打彈珠阿伯", cost: 2, tags: ["game"], atk: 4, hp: 7, spd: 3,
      desc: "暴擊率 +20%;暴擊時,對隨機一名敵人造成 2 點傷害。", fx: [{ on: "passive", do: "crit", pct: 20 }, { on: "crit", do: "dmgRandom", n: 2 }],
      star3: { desc: "3★:暴擊時追加一次隨機攻擊。", fx: [{ on: "crit", do: "extraAttack" }] } },
    { id: "mahjong_boss", name: "麻將桌老闆", cost: 3, tags: ["game"], atk: 5, hp: 11, spd: 3,
      desc: "暴擊率 +20%;暴擊時,全體敵人受到 1 點傷害。", fx: [{ on: "passive", do: "crit", pct: 20 }, { on: "crit", do: "dmgAll", n: 1 }],
      star3: { desc: "3★:暴擊率 +15%。", fx: [{ on: "passive", do: "crit", pct: 15 }] } },
    { id: "dice_king", name: "骰子王", cost: 5, tags: ["game"], atk: 7, hp: 15, spd: 3,
      desc: "暴擊率 +35%;暴擊時,全體敵人受到 2 點傷害,本場結算多 1 銅板(上限 5)。", fx: [{ on: "passive", do: "crit", pct: 35 }, { on: "crit", do: "dmgAll", n: 2 }, { on: "crit", do: "coin", n: 1 }],
      star3: { desc: "3★:暴擊時追加一次隨機攻擊。", fx: [{ on: "crit", do: "extraAttack" }] } },
    // ---- 藥燉 +4 ----
    { id: "ginseng_tea_apprentice", name: "蔘茶學徒", cost: 1, tags: ["potion"], atk: 2, hp: 6, spd: 2,
      desc: "出手時,自己回復 2 點血量。", fx: [{ on: "attack", do: "healSelf", flat: 2 }],
      star3: { desc: "3★:出手時,目標中毒 1 層。", fx: [{ on: "attack", do: "poison", n: 1 }] } },
    { id: "almond_tea_grandma", name: "杏仁茶阿嬤", cost: 2, tags: ["potion"], atk: 3, hp: 9, spd: 2,
      desc: "壓軸:每回合結束,全體敵人中毒 1 層。", fx: [{ on: "roundEnd", when: "finale", do: "poisonAll", n: 1 }],
      star3: { desc: "3★:開場全體敵人中毒 1 層。", fx: [{ on: "start", do: "poisonAll", n: 1 }] } },
    { id: "herbal_wine_brewer", name: "藥酒釀造師", cost: 3, tags: ["potion"], atk: 4, hp: 13, spd: 3,
      desc: "出手時,目標中毒 1 層;擊殺時,我方全體回復 3 點血量。", fx: [{ on: "attack", do: "poison", n: 1 }, { on: "kill", do: "healAllies", flat: 3 }],
      star3: { desc: "3★:出手時,目標後面那一位也中毒。", fx: [{ on: "attack", do: "poisonNext", n: 1 }] } },
    { id: "hua_tuo_heir", name: "華陀傳人", cost: 5, tags: ["potion"], atk: 6, hp: 28, spd: 2,
      desc: "開場:我方全體獲得 3 點護盾,全體敵人中毒 1 層;每回合結束,我方血量最低者回復 5 點。", fx: [{ on: "start", do: "shieldAllies", flat: 3 }, { on: "start", do: "poisonAll", n: 1 }, { on: "roundEnd", do: "healLowest", flat: 5 }],
      star3: { desc: "3★:每回合結束,我方全體回復 2 點血量。", fx: [{ on: "roundEnd", do: "healAllies", flat: 2 }] } },
    // ---- 順手 +4 ----
    { id: "sticky_fingers_guy", name: "順手牽羊客", cost: 1, tags: ["thief"], atk: 3, hp: 4, spd: 4,
      desc: "出手時,偷走目標 1 點攻擊給自己。", fx: [{ on: "attack", do: "stealAtk", n: 1 }],
      star3: { desc: "3★:擊殺時,本場結算多 1 銅板。", fx: [{ on: "kill", do: "coin", n: 1 }] } },
    { id: "wallet_snatcher", name: "扒錢包老手", cost: 2, tags: ["thief"], atk: 3, hp: 7, spd: 3,
      desc: "擊殺時,自己攻擊 +1,本場結算多 1 銅板(本場上限 5)。擊殺後與後排第一位換位(退到後排)。", fx: [{ on: "kill", do: "buffSelfAtk", n: 1 }, { on: "kill", do: "coin", n: 1 }, { on: "kill", do: "swapRow", to: "back" }],
      star3: { desc: "3★:開場敵方攻擊最高者攻擊 -2。", fx: [{ on: "start", do: "weakenTop", n: 2 }] } },
    { id: "pawn_shop_boss", name: "當鋪老闆", cost: 3, tags: ["thief"], atk: 4, hp: 11, spd: 3,
      desc: "開場:敵方攻擊最高者攻擊 -2;出手時,偷走目標 1 點攻擊給自己。", fx: [{ on: "start", do: "weakenTop", n: 2 }, { on: "attack", do: "stealAtk", n: 1 }],
      star3: { desc: "3★:我方贏得戰鬥時,本場結算多 2 銅板。", fx: [{ on: "passive", do: "winCoin", n: 2 }] } },
    { id: "night_market_thief", name: "夜市大盜", cost: 5, tags: ["thief"], atk: 7, hp: 20, spd: 4,
      desc: "開場:敵方攻擊最高者攻擊 -3;出手時偷走目標 1 點攻擊;擊殺時本場結算多 1 銅板。", fx: [{ on: "start", do: "weakenTop", n: 3 }, { on: "attack", do: "stealAtk", n: 1 }, { on: "kill", do: "coin", n: 1 }],
      star3: { desc: "3★:我方贏得戰鬥時,本場結算多 2 銅板。", fx: [{ on: "passive", do: "winCoin", n: 2 }] } },
    // ---- 卜卦 +4 ----
    { id: "fortune_girl", name: "求籤小妹", cost: 1, tags: ["fortune"], atk: 2, hp: 5, spd: 3,
      desc: "壓軸:開場攻擊 +3。", fx: [{ on: "start", when: "finale", do: "buffSelfAtk", n: 3 }],
      star3: { desc: "3★:先鋒時開場攻擊也 +3。", fx: [{ on: "start", when: "vanguard", do: "buffSelfAtk", n: 3 }] } },
    { id: "astrology_teacher", name: "星座老師", cost: 2, tags: ["fortune"], atk: 3, hp: 8, spd: 2,
      desc: "先鋒:開場我方全體獲得 2 點護盾。", fx: [{ on: "start", when: "vanguard", do: "shieldAllies", flat: 2 }],
      star3: { desc: "3★:壓軸時,開場我方全體攻擊 +1。", fx: [{ on: "start", when: "finale", do: "buffAllyAtk", n: 1 }] } },
    { id: "tarot_vendor", name: "塔羅牌攤主", cost: 3, tags: ["fortune"], atk: 4, hp: 11, spd: 3,
      desc: "先鋒:開場獲得 4 點護盾。壓軸:開場攻擊 +3。", fx: [{ on: "start", when: "vanguard", do: "shieldSelf", flat: 4 }, { on: "start", when: "finale", do: "buffSelfAtk", n: 3 }],
      star3: { desc: "3★:開場左右友軍攻擊 +1。", fx: [{ on: "start", do: "buffAdjAtk", n: 1 }] } },
    { id: "ziwei_master", name: "紫微斗數大師", cost: 5, tags: ["fortune"], atk: 6, hp: 24, spd: 3,
      desc: "先鋒:受傷時反彈 2 點傷害。壓軸:開場我方全體攻擊 +2。", fx: [{ on: "hurt", when: "vanguard", do: "reflect", flat: 2 }, { on: "start", when: "finale", do: "buffAllyAtk", n: 2 }],
      star3: { desc: "3★:開場我方全體獲得 4 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 4 }] } },
    // ---- 發條 +4 ----
    { id: "clockwork_bird", name: "發條小鳥", cost: 1, tags: ["clock"], atk: 2, hp: 5, spd: 3,
      desc: "每回合結束,血量上限與血量 +2。", fx: [{ on: "roundEnd", do: "growHp", n: 2 }],
      star3: { desc: "3★:每回合結束,攻擊也 +1。", fx: [{ on: "roundEnd", do: "growAtk", n: 1 }] } },
    { id: "music_box_boss", name: "八音盒老闆", cost: 2, tags: ["clock"], atk: 3, hp: 8, spd: 3,
      desc: "壓軸:每回合結束,我方全體攻擊 +1。", fx: [{ on: "roundEnd", when: "finale", do: "buffAllyAtk", n: 1 }],
      star3: { desc: "3★:先鋒時也有此效果。", fx: [{ on: "roundEnd", when: "vanguard", do: "buffAllyAtk", n: 1 }] } },
    { id: "old_watch_master", name: "老懷錶匠", cost: 3, tags: ["clock"], atk: 3, hp: 12, spd: 2,
      desc: "每回合結束,攻擊 +1;第 3 回合起攻擊翻倍。", fx: [{ on: "roundEnd", do: "growAtk", n: 1 }, { on: "roundStart", atRound: 3, do: "doubleAtk" }],
      star3: { desc: "3★:每回合結束,血量上限與血量 +2。", fx: [{ on: "roundEnd", do: "growHp", n: 2 }] } },
    { id: "clock_tower_ghost", name: "時空鐘樓怪人", cost: 5, tags: ["clock"], atk: 6, hp: 24, spd: 3,
      desc: "每回合開始,我方全體攻擊 +1;每回合結束,血量上限與血量 +3。", fx: [{ on: "roundStart", do: "buffAllyAtk", n: 1 }, { on: "roundEnd", do: "growHp", n: 3 }],
      star3: { desc: "3★:每回合結束,我方全體血量上限與血量 +2。", fx: [{ on: "roundEnd", do: "growAllyHp", n: 2 }] } },
    // ---- 怪物專屬卡(企劃 11-4):只能打贏怪物輪掉落,不進商店;沒有流派(不影響流派羈絆數量),靠自己的效果和宿敵隱藏羈絆 ----
    { id: "alley_kitten", name: "巷口小橘貓", cost: 2, tags: [], atk: 3, hp: 8, spd: 3, exclusive: true,
      desc: "開場:左右友軍攻擊 +2。(野貓幫掉落)", fx: [{ on: "start", do: "buffAdjAtk", n: 2 }],
      star3: { desc: "3★:陣亡時全體友軍獲得 4 點護盾。", fx: [{ on: "death", do: "shieldAllies", flat: 4 }] } },
    { id: "rascal_rookie", name: "跟班小混混", cost: 2, tags: [], atk: 4, hp: 6, spd: 4, exclusive: true,
      desc: "出手時偷取目標 1 點攻擊。(夜市搶攤團掉落)", fx: [{ on: "attack", do: "stealAtk", n: 1 }],
      star3: { desc: "3★:開場削弱敵方攻擊最高者 2 點。", fx: [{ on: "start", do: "weakenTop", n: 2 }] } },
    { id: "lucky_regular", name: "運氣常客", cost: 2, tags: [], atk: 3, hp: 7, spd: 3, exclusive: true,
      desc: "暴擊率 +20%;暴擊時隨機一名敵人受到 2 點傷害。(麻將桌常客掉落)", fx: [{ on: "passive", do: "crit", pct: 20 }, { on: "crit", do: "dmgRandom", n: 2 }],
      star3: { desc: "3★:暴擊時賺 1 銅板。", fx: [{ on: "crit", do: "coin", n: 1 }] } },
    { id: "awang_tripod", name: "阿旺的三腳架", cost: 3, tags: [], atk: 4, hp: 12, spd: 2, exclusive: true,
      desc: "開場:全體友軍獲得 3 點護盾;受傷時反彈 1 點。(相片攤老闆·阿旺掉落)", fx: [{ on: "start", do: "shieldAllies", flat: 3 }, { on: "hurt", do: "reflect", flat: 1 }],
      star3: { desc: "3★:開場全體友軍再獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 3 }] } },
    { id: "herb_cart_boss", name: "藥膳推車老闆", cost: 3, tags: [], atk: 4, hp: 12, spd: 2, exclusive: true,
      desc: "每回合結束治療血量最少的友軍 3 點;出手時目標中毒 1 層。(中藥鋪聯盟掉落)", fx: [{ on: "roundEnd", do: "healLowest", flat: 3 }, { on: "attack", do: "poison", n: 1 }],
      star3: { desc: "3★:開場全體敵人中毒 1 層。", fx: [{ on: "start", do: "poisonAll", n: 1 }] } },
    { id: "dojo_disciple", name: "武館入門弟子", cost: 3, tags: [], atk: 5, hp: 11, spd: 2, exclusive: true,
      desc: "開場:先鋒獲得 6 點護盾;受傷時反彈 1 點。(鐵拳武館聯隊掉落)", fx: [{ on: "start", do: "shieldVanguard", flat: 6 }, { on: "hurt", do: "reflect", flat: 1 }],
      star3: { desc: "3★:開場全體友軍獲得 3 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 3 }] } },
    { id: "king_heir", name: "夜市王儲", cost: 5, tags: [], atk: 6, hp: 20, spd: 3, exclusive: true,
      desc: "開場:其他友軍攻擊 +2;贏了這場多賺 2 銅板。(傳說夜市之王掉落)", fx: [{ on: "start", do: "buffAllyAtk", n: 2 }, { on: "passive", do: "winCoin", n: 2 }],
      star3: { desc: "3★:開場全體友軍獲得 6 點護盾。", fx: [{ on: "start", do: "shieldAllies", flat: 6 }] } },
    { id: "midnight_bellman", name: "午夜敲鐘人", cost: 5, tags: [], atk: 5, hp: 24, spd: 3, exclusive: true,
      desc: "每回合開始自己攻擊 +1;每回合結束全體友軍血量上限與血量 +2。(午夜鐘樓掉落)", fx: [{ on: "roundStart", do: "growAtk", n: 1 }, { on: "roundEnd", do: "growAllyHp", n: 2 }],
      star3: { desc: "3★:每回合結束自己血量再 +3。", fx: [{ on: "roundEnd", do: "growHp", n: 3 }] } },
    { id: "fire_ice_chef", name: "冰火總鋪師", cost: 5, tags: [], atk: 6, hp: 20, spd: 3, exclusive: true,
      desc: "開場:全體敵人灼傷 1 層,並凍結敵方速度最快者 1 回合。(冰火大廚團掉落)", fx: [{ on: "start", do: "burnAll", n: 1 }, { on: "start", do: "freezeFastest", n: 1 }],
      star3: { desc: "3★:每回合結束全體敵人再灼傷 1 層。", fx: [{ on: "roundEnd", do: "burnAll", n: 1 }] } },
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
    // ---- 階段 10 新增(企劃 11-3):宿敵(2 張)/ 大型(4~5 張)/ 反羈絆(2 張,有好有壞,anti = true)----
    { id: "cat_vs_thief", name: "貓與大盜", cards: ["stall_cat", "night_market_thief"], desc: "宿敵對視:全隊攻擊 +2,暴擊率 +10%", fx: { allAtk: 2, critPct: 10 } },
    { id: "patrol_chase", name: "警員追阿旺", cards: ["night_patrol", "awang"], desc: "追逐戰:全隊攻擊 +1,開場全隊護盾 +5", fx: { allAtk: 1, startShieldAll: 5 } },
    { id: "kitten_awang", name: "阿旺與小橘貓", cards: ["alley_kitten", "awang"], desc: "老朋友重逢:全隊攻擊 +2,每回合結束全隊回復 2 點血量", fx: { allAtk: 2, healAll: 2 } },
    { id: "heir_tycoon", name: "王儲與大亨", cards: ["king_heir", "market_tycoon"], desc: "繼承人與大亨聯手:全隊攻擊 +3,開場全隊護盾 +4", fx: { allAtk: 3, startShieldAll: 4 } },
    { id: "five_kings", name: "五大天王", cards: ["squid_boss", "snow_queen", "tonic_grandma", "market_tycoon", "oracle_grandpa"], desc: "五位傳說攤主同台:全隊攻擊 +5,開場全隊護盾 +10,每回合結束全隊回復 3 點血量", fx: { allAtk: 5, startShieldAll: 10, healAll: 3 } },
    { id: "martial_gathering", name: "武林大會", cards: ["dojo_master", "iron_palm_boss", "arm_wrestle_champ", "iron_head_master"], desc: "四位武館高手聚首:全隊攻擊 +3,開場全隊護盾 +6", fx: { allAtk: 3, startShieldAll: 6 } },
    { id: "thieves_quarrel", name: "搶地盤", anti: true, cards: ["pickpocket_kid", "sticky_fingers_guy"], desc: "同行是冤家(吵架):全隊攻擊 +4,但開場全隊血量 −4", fx: { allAtk: 4, allHp: -4 } },
    { id: "hot_cold_fight", name: "冰火不容", anti: true, cards: ["whole_lamb_boss", "ice_sculptor"], desc: "炭烤與冰雕互看不順眼(吵架):全隊暴擊率 +25%,但開場全隊血量 −5", fx: { critPct: 25, allHp: -5 } },
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
  const BENCH_SLOTS = 8; // v5:原 6
  const ROW_SIZE = 5; // 畫面一排最多幾格:上陣 / 待命席 / 戰場都是 5 格一排,超過換第二排(階段 8:目前只影響畫面與位置,戰鬥順序 = 第一排由左到右再接第二排)
  const SHOP_SLOTS = 5;
  const WIN_BONUS = 3; // v58:原 2
  const ROUND_BASE_DAMAGE = [[1, 2], [4, 4], [7, 6], [10, 9], [13, 12], [16, 16], [19, 20]]; // [起始輪次, 基礎傷害]
  const SURVIVOR_STAR_CAP = 10;
  const INTEREST = { per: 10, max: 5, startRound: 1 }; // 金庫:每 10 銅板 +1,上限 +5(v5:原 +3);startRound 是模擬器調平衡用的旋鈕
  const SELL_PENALTY = 1; // 2★、3★ 賣出少退 1 銅板

  // 升到該級需要的 XP(企劃 3-5)。每輪被動 +2,買經驗 4 銅板 = 4 XP
  const XP_TO_LEVEL = { 2: 2, 3: 3, 4: 5, 5: 8, 6: 12, 7: 17, 8: 23, 9: 30, 10: 38 };
  const PASSIVE_XP = 2;
  const BUY_XP = { cost: 4, xp: 4 };
  const MAX_LEVEL = 10;
  const SLOTS_BY_LEVEL = [0, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10]; // 索引=等級(v5:Lv8 起 9 格、Lv10 滿 10 格,原本 Lv7 起都是 8 格)
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
    return round <= 4 ? 5 : round <= 9 ? 6 : round <= 14 ? 7 : 8; // v58:每段 +1(原 4 / 5 / 6 / 7)
  }
  // 連勝加成(n = 本場贏完後的連勝數):2 勝 +1 / 3~4 勝 +2 / 5~6 勝 +3 / 7~8 勝 +4 / 9 勝以上 +5(v5:上限由 +3 提高到 +5)
  function streakBonus(n) {
    return n >= 9 ? 5 : n >= 7 ? 4 : n >= 5 ? 3 : n >= 3 ? 2 : n >= 2 ? 1 : 0;
  }
  // 金庫利息:依「當下持有」銅板,每 10 +1,上限 +5
  function interestOf(gold, round) {
    if (round != null && round < INTEREST.startRound) return 0;
    return Math.min(INTEREST.max, Math.floor(Math.max(0, gold) / INTEREST.per));
  }
  // ---------------- 怪物輪(PVE 輪)----------------
  // R5 / R10 / R15:全場不打玩家,改打同一個夜市怪物(陣容固定,全場公平)。不扣血、不計連勝、不中斷連勝;
  // 贏了 +3 銅板並掉落一張卡(下一輪準備階段進待命席)。輸了只拿基本收入與利息。
  // 強度用 tools/autochess-sim.js 的電腦玩家校準(`node tools/autochess-sim.js monster`):9 隻怪物對取樣玩家陣容的勝率約 63%~76%(目標「正常成長的玩家約 70% 打得贏」);階段 8 放寬格數與經濟後原本的怪物變太容易,所以連原本 3 隻一起重新調過。
  const MONSTER_ROUNDS = [5, 10, 15];
  const MONSTER_WIN_COINS = 3;
  // 階段 10(企劃 11-4):每個怪物輪有 3 個候選,由活動種子抽一個(全場抽到同一隻,公平、大螢幕好顯示);第 1 個是原本的怪物。
  // 打贏必掉該怪物的專屬卡(drop,只能這樣取得);如果玩家已經有那張卡的 3★,改掉落一般隨機卡。
  const MONSTER_POOLS = {
    5: [
      { id: "stray_cats", name: "野貓幫", title: "夜市野貓幫", intro: "一群覓食的野貓擋住了通道:「喵——這攤的魚是我們的!」", win: "野貓們叼著戰利品一溜煙跑了。", lose: "野貓幫大搖大擺地走過你的攤位。", drop: "alley_kitten",
        board: [ { id: "stall_cat", star: 2 }, { id: "dart_uncle", star: 1 }, { id: "street_strongman", star: 1 }, { id: "iron_head_master", star: 1 }, { id: "passerby", star: 1 } ] },
      { id: "snatch_gang", name: "搶攤團", title: "夜市搶攤團", intro: "幾個黑影擠到你的攤位前:「老闆,這攤今晚歸我們看!」", win: "搶攤團丟下贓物落荒而逃。", lose: "搶攤團把你的攤位翻了個底朝天。", drop: "rascal_rookie",
        board: [ { id: "pickpocket_kid", star: 2 }, { id: "wallet_snatcher", star: 1 }, { id: "sticky_fingers_guy", star: 1 }, { id: "street_gambler", star: 1 }, { id: "bargain_king", star: 1 } ] },
      { id: "mahjong_regulars", name: "麻將桌常客", title: "麻將桌常客團", intro: "麻將桌旁的老客人們一字排開:「來來來,三缺一,不打不能走!」", win: "常客們笑著推倒牌:「年輕人手氣不錯!」", lose: "常客們一胡牌,你的攤位就被圍得水洩不通。", drop: "lucky_regular",
        board: [ { id: "pinball_kid", star: 1 }, { id: "street_gambler", star: 1 }, { id: "ring_toss_girl", star: 2 }, { id: "balloon_stall", star: 1 }, { id: "dart_uncle", star: 1 } ] },
    ],
    10: [
      { id: "awang", name: "阿旺", title: "相片攤老闆·阿旺", intro: "阿旺舉起三腳架:「想過關?先讓我替你拍張定裝照!」", win: "阿旺放下相機大笑:「這張拍得好,送你一個紀念品!」", lose: "阿旺對著你按下快門:「很好,苦瓜臉也是一種風格。」", drop: "awang_tripod",
        board: [{ id: "awang", star: 1 }, { id: "chili_lady", star: 1 }, { id: "claw_machine_boss", star: 1 }, { id: "dojo_master", star: 1 }, { id: "arm_wrestle_champ", star: 1 }, { id: "wooden_dummy_man", star: 2 }] },
      { id: "herb_alliance", name: "中藥鋪聯盟", title: "中藥鋪聯盟", intro: "藥香飄過整條街,幾位老掌櫃並肩而立:「年輕人,火氣太旺,來帖藥?」", win: "掌櫃們捻鬚點頭:「底子不錯,這包送你。」", lose: "掌櫃們搖搖頭:「體質虛啊,回去補一補。」", drop: "herb_cart_boss",
        board: [ { id: "herbal_pharmacist", star: 1 }, { id: "ginseng_chicken_auntie", star: 2 }, { id: "almond_tea_grandma", star: 2 }, { id: "herbal_wine_brewer", star: 1 }, { id: "tonic_grandma", star: 1 }, { id: "herb_tea_boy", star: 1 } ] },
      { id: "dojo_squad", name: "鐵拳武館聯隊", title: "鐵拳武館聯隊", intro: "武館的大門轟然打開,弟子們列隊出場:「踢館的?先過我們這一關!」", win: "館主抱拳:「後生可畏,這個徒弟你帶走。」", lose: "弟子們齊聲喝道:「再練三年!」", drop: "dojo_disciple",
        board: [ { id: "dojo_master", star: 2 }, { id: "lion_dance_captain", star: 1 }, { id: "arm_wrestle_champ", star: 2 }, { id: "ice_wall_master", star: 1 }, { id: "palanquin_bearer", star: 1 } ] },
    ],
    15: [
      { id: "market_king", name: "夜市之王", title: "傳說夜市之王", intro: "人聲忽然安靜下來,夜市之王緩緩起身:「年輕人,讓我看看你的攤位。」", win: "夜市之王點點頭:「今晚的夜市,有你的位置。」", lose: "夜市之王搖頭:「再回去多磨練幾個夜晚。」", drop: "king_heir",
        board: [ { id: "awang", star: 2 }, { id: "market_tycoon", star: 1 }, { id: "snow_queen", star: 2 }, { id: "tonic_grandma", star: 2 }, { id: "dojo_master", star: 1 } ] },
      { id: "midnight_tower", name: "午夜鐘樓", title: "午夜鐘樓守護者", intro: "鐘聲在夜市上空迴盪,齒輪轉動的聲音越來越近:「午夜十二點,時間到了。」", win: "鐘聲停了:「你,趕上了時間。」", lose: "鐘聲再度響起:「太慢了,下次早點來。」", drop: "midnight_bellman",
        board: [ { id: "clockwork_giant", star: 2 }, { id: "old_watch_master", star: 2 }, { id: "gear_craftsman", star: 1 }, { id: "music_box_boss", star: 1 }, { id: "battery_toy_seller", star: 1 }, { id: "clock_tower_ghost", star: 1 } ] },
      { id: "fire_ice_kitchen", name: "冰火大廚團", title: "冰火大廚團", intro: "一邊烈焰沖天、一邊寒氣逼人,大廚們同時亮出鍋鏟:「今晚的主菜,是你!」", win: "大廚們收起鍋鏟:「這道菜,合格。」", lose: "大廚們冷笑:「火候不夠。」", drop: "fire_ice_chef",
        board: [ { id: "squid_boss", star: 2 }, { id: "snow_queen", star: 1 }, { id: "salty_chicken_vendor", star: 1 }, { id: "chili_lady", star: 1 }, { id: "fire_ice_dessert", star: 1 } ] },
    ],
  };
  const MONSTERS = { 5: MONSTER_POOLS[5][0], 10: MONSTER_POOLS[10][0], 15: MONSTER_POOLS[15][0] }; // 舊介面:預設(第 1 個)怪物
  // 這一輪的怪物:由種子決定(沒傳種子 = 預設怪物)。每個客戶端算出來都一樣
  function monsterFor(seed, round) {
    const pool = MONSTER_POOLS[round]; if (!pool) return null;
    if (seed == null) return pool[0];
    let h = 2166136261; const str = `${seed}|monster|${round}`;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    return pool[h % pool.length];
  }
  // ---- 隨機夜市事件(企劃 11-2)----
  // 從 R4 起每隔 4 輪(R4、R8、R12、R16……)全場同時套用同一個事件,只持續那一輪,避開怪物輪。
  // 事件由「事件種子 + 輪次」決定(E.nightEvent),每個客戶端算出來都一樣,不需要資料表。
  const NIGHT_EVENT_FIRST = 4, NIGHT_EVENT_EVERY = 4;
  const NIGHT_EVENTS = [
    { id: "rain", name: "雨夜", icon: "cloud-rain", desc: "冰鎮流派全隊攻擊 +2;炭火流派全隊攻擊 −2", tags: { frost: 2, burn: -2 } },
    { id: "crowd", name: "人潮", icon: "users", desc: "本輪商店多 1 格" },
    { id: "sale", name: "打烊特賣", icon: "tag", desc: "本輪買卡費用 −1(最低 1);本輪賣出也少 1 銅板" },
    { id: "jackpot", name: "發財時段", icon: "gem", desc: "本輪結算基本收入 +2" },
    { id: "typhoon", name: "颱風夜", icon: "wind", desc: "本輪結算不計利息,但贏了 +2 銅板" },
    { id: "extra_pick", name: "加碼回合", icon: "sparkles", desc: "本輪多一次攤位加碼三選一" },
    { id: "heavy", name: "重壓之夜", icon: "hammer", desc: "本輪輸家扣血 ×1.5" },
  ];
  const NIGHT_EVENT_BY_ID = {}; NIGHT_EVENTS.forEach((e) => (NIGHT_EVENT_BY_ID[e.id] = e));
  // ---- 雜貨攤(企劃 11-2):準備階段用銅板買一次性道具,買了立刻生效,沒有道具欄。每輪隨機提供 STORE_SLOTS 件 ----
  const STORE_SLOTS = 3;
  const STORE_ITEMS = [
    { id: "chili", name: "辣椒粉", icon: "flame", price: 3, desc: "本輪戰鬥我方全隊攻擊 +1", fx: { atk: 1 } },
    { id: "candy", name: "糖葫蘆", icon: "candy", price: 3, desc: "本輪戰鬥我方全隊血量 +3", fx: { hp: 3 } },
    { id: "spice", name: "調味料", icon: "chef-hat", price: 5, desc: "選一張卡永久 +1 攻擊 / +2 血量", target: "card", atk: 1, hp: 2 },
    { id: "coupon", name: "外送券", icon: "ticket", price: 2, desc: "商店免費刷新 2 次(沒用完會留著)", fx: { freeRefresh: 2 } },
  ];
  const STORE_BY_ID = {}; STORE_ITEMS.forEach((i) => (STORE_BY_ID[i.id] = i));
  // ---- 前排 / 後排(階段 11,企劃 11-5)----
  // 場上的卡可以帶 row:0 = 前排、1 = 後排(玩家自選);沒有 row 的卡(舊存檔、怪物陣容)照位置分:前 ROW_SIZE 張前排、其餘後排。
  // 每排最多 ROW_SIZE 張。戰鬥順序 = 前排由左到右、再接後排由左到右(陣列順序 = 排內由左到右)。
  const rowOfCard = (c, i) => (c.row === 0 || c.row === 1 ? c.row : i < ROW_SIZE ? 0 : 1);
  // board → { front: [原陣列索引...], back: [...] };前排一張都沒有時,後排視為前排(不會出現「沒有前排」)
  function rowsOf(board) {
    const front = [], back = [];
    board.forEach((c, i) => (rowOfCard(c, i) === 0 ? front : back).push(i));
    return front.length ? { front, back } : { front: back, back: [] };
  }
  // 戰鬥 / 評分用的順序:前排接後排,每張卡是帶正規化 row 的複本
  function layoutBoard(board) {
    const r = rowsOf(board);
    return r.front.map((i) => ({ ...board[i], row: 0 })).concat(r.back.map((i) => ({ ...board[i], row: 1 })));
  }
  const isMonsterRound = (round) => MONSTER_ROUNDS.indexOf(round) >= 0;
  const isEventRound = (round) => round >= NIGHT_EVENT_FIRST && (round - NIGHT_EVENT_FIRST) % NIGHT_EVENT_EVERY === 0 && !isMonsterRound(round);
  const monsterBoard = (round, mon) => { const m = mon || MONSTERS[round]; return m ? m.board.map((c) => ({ id: c.id, star: c.star })) : []; };

  function slotsFor(level) { return SLOTS_BY_LEVEL[Math.min(MAX_LEVEL, Math.max(1, level))]; }
  function shopSlotsFor(level) { return level >= LEVEL_PERKS.shopSlots6 ? SHOP_SLOTS + 1 : SHOP_SLOTS; }
  // 賣出退費:1★ 全額;2★ = 3 張費用 -1;3★ = 9 張費用 -1(升星花的錢只少退 1 銅板)
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
    START_HP, START_GOLD, BENCH_SLOTS, ROW_SIZE, SHOP_SLOTS, WIN_BONUS, ROUND_BASE_DAMAGE, SURVIVOR_STAR_CAP, INTEREST, SELL_PENALTY,
    XP_TO_LEVEL, PASSIVE_XP, BUY_XP, MAX_LEVEL, SLOTS_BY_LEVEL, LEVEL_PERKS, SHOP_ODDS, PERK_ROUNDS, PERK_CATS, PERKS, PERK_BY_ID,
    PREP_SECONDS, prepSeconds, roundBaseDamage, baseIncome, streakBonus, interestOf, slotsFor, shopSlotsFor, sellValue, addXp,
    MONSTER_ROUNDS, MONSTER_WIN_COINS, MONSTER_POOLS, MONSTERS, monsterFor, isMonsterRound, monsterBoard,
    rowOfCard, rowsOf, layoutBoard, NIGHT_EVENT_FIRST, NIGHT_EVENT_EVERY, NIGHT_EVENTS, NIGHT_EVENT_BY_ID, isEventRound, STORE_SLOTS, STORE_ITEMS, STORE_BY_ID,
  };
})();
