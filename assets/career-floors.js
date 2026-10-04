// 職業養成對決 · 爬塔樓層資料(企劃書第五、六、八節)
//
// Phase2 骨架先做 20 層(企劃書第十二節:「先做20~30層,樓層資料是純設定檔,之後要擴充只是加資料
// 不是架構改動」),全部落在「1~20層新手區」這個難度帶,每滿10層(這裡就是第10、20層)是小關主，
// 保底比較好的獎勵。21層以後(中階/高階/Boss)之後要擴充，直接在 FLOORS 陣列後面加資料就好，
// 不用動這支檔案以外的任何程式碼。
window.CareerFloors = (function () {
  const CD = window.CareerData;
  const CLASS_KEYS = ["warrior", "guardian", "archer", "assassin", "mage", "healer"];
  // 怪物名稱池，照樓層深度分幾批，風格越後面越兇一點，不會整場都遇到同一套。
  // P2-1新增(21~50層)：21~30中階、31~40高階、41~50頂階(逼近Boss的氣氛)。
  const MONSTER_NAMES_EARLY = ["烤香腸小惡魔", "彈珠台幽靈", "撈金魚精", "臭豆腐妖", "套圈圈小鬼", "棉花糖史萊姆"];
  const MONSTER_NAMES_LATE = ["夜市顧攤老怪", "鹽酥雞修羅", "麻辣鴨血鬼", "算命攤占卜靈", "夾娃娃機守護者", "炒泡麵劍豪"];
  const MONSTER_NAMES_MID = ["廟口八家將", "電子花車舞者", "牽亡魂法師", "紙紮人偶軍團", "乩童附身怪", "陣頭大鑼鼓精"];
  const MONSTER_NAMES_HIGH = ["地下賭場老千", "討債公司打手", "槍手教頭", "黑頭轎班轎夫", "夜市角頭大哥", "暗巷放高利貸鬼"];
  const MONSTER_NAMES_ELITE = ["失傳夜市傳說廚神", "百年老店鎮店妖", "深夜擺攤神秘人", "都市傳說計程車司機", "隱藏總舖師幽魂", "夜市之王親信"];
  function monsterNameFor(n) {
    const pool = n <= 10 ? MONSTER_NAMES_EARLY : n <= 20 ? MONSTER_NAMES_LATE : n <= 30 ? MONSTER_NAMES_MID : n <= 40 ? MONSTER_NAMES_HIGH : MONSTER_NAMES_ELITE;
    return pool[n % pool.length];
  }
  // P2-2新增:40層、50層的Boss不是普通關主，有獨立命名+機率掉「Boss限定傳說裝備」
  // (見下面 BOSS_LEGENDARY_ITEMS，跟商店/抽獎機那套傳說裝備是分開的資料，但一樣受
  // 「每個部位限購1件」的名額限制，不會超賣)。
  // 世界觀第一階段:10/20/30層關主也有自己的名字(原本是自動產生的「○○王(n層關主)」)，
  // 完整設定見「逼逼夜市_活動職業養成對決_世界觀與劇情.md」第五節。
  const SPECIAL_BOSS_NAME = { 10: "試吃攤大姐頭·阿霞姐", 20: "顧攤老怪·阿公", 30: "廟口總管·八爺", 40: "傳說夜市之王", 50: "終極隱藏關主·夜市之神" };
  // 關主戰前/戰後對話(1~3句短文字，純文字，畫面端自己 ui.esc)。只有關主層有，一般樓層沒有 story 欄位。
  const FLOOR_STORY = {
    10: {
      pre: "「小朋友，試吃吃三次了，今天是不是該買了?」",
      post: "「……又一個。今年第一個走到這的。拿著，這是你的號碼牌。」你低頭一看，牌子背面有被刮掉的舊數字。",
    },
    20: {
      pre: "「你是從夜市來的?難怪身上一股鹽酥雞味。」",
      post: "「你真的以為爬完這座塔，就能回去了?……算了，上去自己看。」",
    },
    30: {
      pre: "「夜市那個老闆，欠我三碗滷肉飯。你替他還。」",
      post: "「他以前爬得比你高多了。……他沒跟你說?那就不是我該說的。」他遞給你半張舊照片。",
    },
    40: {
      pre: "「來了啊。夜市的新面孔，我讓你三招。」",
      post: "「我不是王，我只是最早『收攤』的那個。……老闆沒告訴你吧?他當年是我手下的小弟。」",
    },
    50: {
      pre: "「又到收攤的時間了。」",
      post: "「這座塔，不是從夜市長出來的。」他頓了頓，「那你以為，夜市是你家附近那個夜市嗎?」",
    },
  };
  // P2-10新增:Boss限定裝備天生就是「同一套」(setKey相同)，三件(武器+防具+飾品)都裝備在身上
  // 會額外觸發套裝效果(見下面 SET_BONUSES)，比單件的效果更好一點，給玩家湊齊全套的動力。
  // P2-10追加修改(玩家回饋:「Boss限定武器也要根據職業改名稱」):原本Boss限定武器不分職業都是
  // 同一個名字，只有statKey(攻擊/魔攻)會依職業調整，玩家覺得名字也要跟職業對得上(像WEAPON_TABLE
  // 那樣)。改成武器名稱依職業各自命名(數值、特殊效果維持一樣，只有名字+對應的攻擊屬性換)；
  // 防具/飾品本來就不分職業(跟一般的EQUIPMENT_TABLE一樣共用)，維持不變。
  const BOSS_WEAPON_NAMES = {
    40: {
      novice: "夜市之王賜下的練習木劍",
      warrior: "夜市之王的無名巨斧",
      guardian: "夜市之王的鎮壓鐵拳套",
      archer: "夜市之王的獵殺長弓",
      assassin: "夜市之王的暗影雙刃",
      mage: "夜市之王的禁忌法杖",
      healer: "夜市之王的祝聖法球",
    },
    50: {
      novice: "終極隱藏關主賜下的木劍",
      warrior: "終極隱藏關主的滅世巨斧",
      guardian: "終極隱藏關主的毀滅拳套",
      archer: "終極隱藏關主的殞落長弓",
      assassin: "終極隱藏關主的黑暗雙刃",
      mage: "終極隱藏關主的禁咒法杖",
      healer: "終極隱藏關主的神聖法球",
    },
  };
  const BOSS_LEGENDARY_ITEMS = {
    40: {
      weapon: { rarity: "legendary", statValue: 6, setKey: "boss40",
        specialEffect: { key: "critDmgBonus", value: 0.25, desc: "暴擊傷害額外+25%" } },
      armor: { name: "夜市之王的鎮攤戰甲", rarity: "legendary", statKey: "def", statValue: 5, extraHp: 12, setKey: "boss40",
        specialEffect: { key: "dmgReduceRatio", value: 0.08, desc: "受到傷害減免8%" } },
      accessory: { name: "夜市之王的傳承令牌", rarity: "legendary", statKey: "luck", statValue: 6, setKey: "boss40",
        specialEffect: { key: "lifestealOnHit", value: 0.1, desc: "攻擊命中吸血10%" } },
    },
    50: {
      weapon: { rarity: "legendary", statValue: 8, setKey: "boss50",
        specialEffect: { key: "critBonus", value: 0.1, desc: "暴擊率+10%" } },
      armor: { name: "終極隱藏關主的不滅戰甲", rarity: "legendary", statKey: "def", statValue: 7, extraHp: 16, setKey: "boss50",
        specialEffect: { key: "dmgReduceRatio", value: 0.12, desc: "受到傷害減免12%" } },
      accessory: { name: "終極隱藏關主的神格徽記", rarity: "legendary", statKey: "luck", statValue: 8, setKey: "boss50",
        specialEffect: { key: "critDmgBonus", value: 0.3, desc: "暴擊傷害額外+30%" } },
    },
  };
  // 套裝效果:三件(武器+防具+飾品)的 setKey 都一樣、而且三個部位都真的裝備著，才會觸發。
  // 效果一樣走 career-engine.js 認得的通用管道(跟單件specialEffect同一套)，見 db.js 的
  // _equipEffectBonus 怎麼把這個疊加進去。
  const SET_BONUSES = {
    boss40: { key: "critBonus", value: 0.05, desc: "夜市之王套裝:暴擊率額外+5%", name: "夜市之王套裝" },
    boss50: { key: "critDmgBonus", value: 0.15, desc: "終極隱藏關主套裝:暴擊傷害額外+15%", name: "終極隱藏關主套裝" },
  };

  function buildFloor(n) {
    const isMiniBoss = n % 10 === 0; // 每滿10層是小關主(企劃書第五節「關主樓層」)
    const nameBase = monsterNameFor(n);
    const classKey = CLASS_KEYS[n % CLASS_KEYS.length];
    const growth = isMiniBoss ? 1.3 : 1;
    const atk = Math.round((2 + n * 0.5) * growth);
    const def = Math.round((1 + n * 0.4) * growth);
    const spd = Math.round(2 + n * 0.35);
    // 怪物HP要跟著玩家基礎HP(CareerData.BASE_STATS.hp)的量級走，不然玩家血量調高之後
    // 怪物血量沒跟著調，戰鬥會變得太快就結束(反過來變成怪物秒死，不是原本要修的那個方向)。
    // 玩家基礎HP從20調到100是為了不要感覺被一拳打死，但玩家自己的攻擊力沒有跟著調高，
    // 所以怪物HP不能跟著等比例放大，不然變成打不死人(這是上一版本調過頭的地方，這裡調回來)。
    const hp = Math.round((14 + n * 3) * growth);
    const luck = Math.floor(n * 0.2);
    const matk = atk; // 怪物的魔攻直接跟攻擊力同步，樓層資料不用另外調兩條成長曲線

    const coinBase = 5 + Math.floor(n * 0.3);
    const expBase = 8 + Math.floor(n * 0.6);

    // 掉落機率跟稀有度用一致的四級系統(跟夜市拍賣商品清單同一套 common/rare/epic/legendary)：
    // 一般樓層只掉得到 普通/稀有；小關主保底掉 稀有 或 史詩。
    // P2-2/P2-4新增:40層、50層Boss額外有機率掉「Boss限定傳說裝備」；40層開始，
    // 就算不是關主樓層，每一層也都開始有機率掉史詩(機率隨樓層往上小幅提高)。
    let dropChance = isMiniBoss ? 1 : 0.3;
    let dropRarityWeights;
    const isLegendaryBossFloor = n === 40 || n === 50;
    if (isLegendaryBossFloor) {
      dropRarityWeights = { epic: 0.5, legendary: 0.5 };
    } else if (isMiniBoss) {
      dropRarityWeights = { rare: 0.6, epic: 0.4 };
    } else if (n >= 40) {
      const epicChance = 0.05 + (n - 40) * 0.01; // 40層5%、49層14%，逐層微幅提高
      dropRarityWeights = { common: 0.5, rare: Math.round((0.5 - epicChance) * 1000) / 1000, epic: epicChance };
    } else {
      dropRarityWeights = { common: 0.85, rare: 0.15 };
    }

    return {
      floor: n,
      name: isMiniBoss ? SPECIAL_BOSS_NAME[n] || `${nameBase}王(${n}層關主)` : nameBase,
      isMiniBoss,
      classKey,
      stats: { atk, def, spd, hp, luck, matk, maxHp: hp },
      story: FLOOR_STORY[n] || null,
      coinReward: isMiniBoss ? coinBase * 2 : coinBase,
      expReward: isMiniBoss ? Math.round(expBase * 1.8) : expBase,
      dropChance,
      dropRarityWeights,
    };
  }

  const FLOORS = [];
  for (let n = 1; n <= 50; n++) FLOORS.push(buildFloor(n));

  function getFloor(n) {
    return FLOORS.find((f) => f.floor === n) || null;
  }

  // 裝備表(企劃書第四節，四個稀有度：普通/稀有/史詩/傳說，跟夜市拍賣商品清單同一套稱呼)。
  // 武器分職業(每個職業武器都不一樣，符合角色設定)，防具/飾品先共用，之後要細分也是照這個
  // 模式再加一層 classKey 就好，架構不用大改。
  // P2-3新增:所有傳說裝備都要有 specialEffect(不能只是數值比較高的普通裝備)，key 對應
  // career-engine.js 認得的通用效果管道(critBonus/critDmgBonus/lifestealOnHit/dmgReduceRatio，
  // 見 db.js 的 _equipEffectBonus)，不分職業都吃得到，不管哪個職業裝上這件都會生效。
  // P2-10修改(玩家二次回饋):每個職業每個稀有度原本只有1把武器，玩家覺得「不同職業武器太像，
  // 只是換數值」。改成每個職業每個稀有度有2把不同風格的武器可以拿(同一個職業裡，兩把武器
  // 走同一條路線的不同兵器類型，例如戰士是「大鐵叉」跟「巨斧」兩種力量系兵器)，取得時
  // (商店買/抽獎機/樓層掉落)隨機拿到其中一把，稀有度決定的數值一樣，但史詩/傳說這兩把
  // 各自有不同的特殊效果，讓同職業玩家之間也會因為拿到哪一把而有點差異，不是完全同質化。
  // 防具/飾品也比照辦理，各稀有度2款(不分職業，共用)。
  const WEAPON_TABLE = {
    novice: {
      common: [{ name: "學徒練習木棍", rarity: "common", statKey: "atk", statValue: 1 }],
      rare: [{ name: "學徒鐵棍", rarity: "rare", statKey: "atk", statValue: 2 }],
      epic: [{ name: "學徒鑄鐵劍", rarity: "epic", statKey: "atk", statValue: 3 }],
      legendary: [{
        name: "見習生的必勝木劍", rarity: "legendary", statKey: "atk", statValue: 4,
        specialEffect: { key: "critBonus", value: 0.04, desc: "暴擊率+4%" },
      }],
    },
    // 力量系·戰士:大鐵叉(刺擊系) vs 巨斧(劈砍系)
    warrior: {
      common: [
        { name: "夜市烤香腸叉", rarity: "common", statKey: "atk", statValue: 1 },
        { name: "路邊攤鐵鎚", rarity: "common", statKey: "atk", statValue: 1 },
      ],
      rare: [
        { name: "熱血烤肉大鐵叉", rarity: "rare", statKey: "atk", statValue: 3 },
        { name: "打鐵舖巨斧", rarity: "rare", statKey: "atk", statValue: 3 },
      ],
      epic: [
        { name: "限量版夜市烤肉神叉", rarity: "epic", statKey: "atk", statValue: 4 },
        { name: "限量版打鐵舖狂戰巨斧", rarity: "epic", statKey: "atk", statValue: 4 },
      ],
      legendary: [
        { name: "地表最強·雷神烤肉叉", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "critDmgBonus", value: 0.15, desc: "暴擊傷害額外+15%" } },
        { name: "夜市傳說·開山巨斧", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "lifestealOnHit", value: 0.08, desc: "攻擊命中吸血8%" } },
      ],
    },
    // 力量系·守衛:黃金拳套(格鬥系) vs 不倒鐵盾(防禦系)
    guardian: {
      common: [
        { name: "彈珠台鐵拳套", rarity: "common", statKey: "atk", statValue: 1 },
        { name: "夜市巡守鐵盾", rarity: "common", statKey: "atk", statValue: 1 },
      ],
      rare: [
        { name: "撞球場鎮店球桿", rarity: "rare", statKey: "atk", statValue: 3 },
        { name: "巡守隊強化鐵盾", rarity: "rare", statKey: "atk", statValue: 3 },
      ],
      epic: [
        { name: "限量版撞球場黃金球桿", rarity: "epic", statKey: "atk", statValue: 4 },
        { name: "限量版巡守隊守護巨盾", rarity: "epic", statKey: "atk", statValue: 4 },
      ],
      legendary: [
        { name: "夜市鎮店之寶·黃金拳套", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "lifestealOnHit", value: 0.08, desc: "攻擊命中吸血8%" } },
        { name: "夜市守護神·不倒鐵盾", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "dmgReduceRatio", value: 0.06, desc: "受到傷害減免6%" } },
      ],
    },
    // 敏捷系·射手:玩具神槍(速射系) vs 神射長弓(精準系)
    archer: {
      common: [
        { name: "打氣球玩具槍", rarity: "common", statKey: "atk", statValue: 1 },
        { name: "夜市射鏢玩具弓", rarity: "common", statKey: "atk", statValue: 1 },
      ],
      rare: [
        { name: "夜市射擊神槍", rarity: "rare", statKey: "atk", statValue: 3 },
        { name: "夜市神射手長弓", rarity: "rare", statKey: "atk", statValue: 3 },
      ],
      epic: [
        { name: "限量版夜市射擊神槍Ⅱ", rarity: "epic", statKey: "atk", statValue: 4 },
        { name: "限量版夜市神射手勁弓", rarity: "epic", statKey: "atk", statValue: 4 },
      ],
      legendary: [
        { name: "傳說神槍手的終極玩具槍", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "critBonus", value: 0.06, desc: "暴擊率+6%" } },
        { name: "傳說神射手的百步穿楊弓", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "critDmgBonus", value: 0.18, desc: "暴擊傷害額外+18%" } },
      ],
    },
    // 敏捷系·刺客:開山刀(單刀系) vs 雙飛刀(暗器系)
    assassin: {
      common: [
        { name: "水果削皮刀", rarity: "common", statKey: "atk", statValue: 1 },
        { name: "夜市甩牌飛鏢", rarity: "common", statKey: "atk", statValue: 1 },
      ],
      rare: [
        { name: "老闆珍藏開山刀", rarity: "rare", statKey: "atk", statValue: 3 },
        { name: "暗巷雙飛刀", rarity: "rare", statKey: "atk", statValue: 3 },
      ],
      epic: [
        { name: "限量版開山刀·夜襲", rarity: "epic", statKey: "atk", statValue: 4 },
        { name: "限量版暗影雙飛刀", rarity: "epic", statKey: "atk", statValue: 4 },
      ],
      legendary: [
        { name: "都市傳說開山刀王", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "critDmgBonus", value: 0.2, desc: "暴擊傷害額外+20%" } },
        { name: "夜影傳說·索命雙飛刀", rarity: "legendary", statKey: "atk", statValue: 5,
          specialEffect: { key: "critBonus", value: 0.07, desc: "暴擊率+7%" } },
      ],
    },
    // 魔法系·法師:鎮店法杖(法杖系) vs 秘傳魔導書(魔法書系)
    mage: {
      common: [
        { name: "棉花糖魔杖", rarity: "common", statKey: "matk", statValue: 1 },
        { name: "路邊攤菜單魔導書", rarity: "common", statKey: "matk", statValue: 1 },
      ],
      rare: [
        { name: "老闆特調法杖", rarity: "rare", statKey: "matk", statValue: 3 },
        { name: "夜市秘傳魔導書", rarity: "rare", statKey: "matk", statValue: 3 },
      ],
      epic: [
        { name: "限量版老闆秘藏法杖", rarity: "epic", statKey: "matk", statValue: 4 },
        { name: "限量版夜市禁忌魔導書", rarity: "epic", statKey: "matk", statValue: 4 },
      ],
      legendary: [
        { name: "老闆傳承三代的鎮店法杖", rarity: "legendary", statKey: "matk", statValue: 5,
          specialEffect: { key: "lifestealOnHit", value: 0.06, desc: "攻擊命中吸血6%" } },
        { name: "失傳夜市秘術魔導書", rarity: "legendary", statKey: "matk", statValue: 5,
          specialEffect: { key: "critDmgBonus", value: 0.22, desc: "暴擊傷害額外+22%" } },
      ],
    },
    // 魔法系·補師:回春糖葫蘆(祝福系) vs 祈福法球(守護系)
    healer: {
      common: [
        { name: "藥燉排骨勺", rarity: "common", statKey: "matk", statValue: 1 },
        { name: "夜市祈福水晶球", rarity: "common", statKey: "matk", statValue: 1 },
      ],
      rare: [
        { name: "回春糖葫蘆杖", rarity: "rare", statKey: "matk", statValue: 3 },
        { name: "夜市守護法球", rarity: "rare", statKey: "matk", statValue: 3 },
      ],
      epic: [
        { name: "限量版糖葫蘆聖杖", rarity: "epic", statKey: "matk", statValue: 4 },
        { name: "限量版夜市祈福聖球", rarity: "epic", statKey: "matk", statValue: 4 },
      ],
      legendary: [
        { name: "回春大師的傳說糖葫蘆", rarity: "legendary", statKey: "matk", statValue: 5,
          specialEffect: { key: "critBonus", value: 0.05, desc: "暴擊率+5%" } },
        { name: "夜市守護神·聖光法球", rarity: "legendary", statKey: "matk", statValue: 5,
          specialEffect: { key: "dmgReduceRatio", value: 0.05, desc: "受到傷害減免5%" } },
      ],
    },
  };
  const EQUIPMENT_TABLE = {
    armor: {
      common: [
        { name: "彈珠台鐵皮盾", rarity: "common", statKey: "def", statValue: 1, extraHp: 2 },
        { name: "夜市顧攤圍裙甲", rarity: "common", statKey: "def", statValue: 1, extraHp: 2 },
      ],
      rare: [
        { name: "臭豆腐限定重甲", rarity: "rare", statKey: "def", statValue: 2, extraHp: 5 },
        { name: "夜市戰袍", rarity: "rare", statKey: "def", statValue: 2, extraHp: 5 },
      ],
      epic: [
        { name: "夜市限定強化鎧甲", rarity: "epic", statKey: "def", statValue: 3, extraHp: 7 },
        { name: "限量版夜市戰甲", rarity: "epic", statKey: "def", statValue: 3, extraHp: 7 },
      ],
      legendary: [
        { name: "夜市限量傳說鎧甲", rarity: "legendary", statKey: "def", statValue: 4, extraHp: 8,
          specialEffect: { key: "dmgReduceRatio", value: 0.05, desc: "受到傷害減免5%" } },
        { name: "傳說夜市染血披風", rarity: "legendary", statKey: "def", statValue: 4, extraHp: 8,
          specialEffect: { key: "lifestealOnHit", value: 0.04, desc: "攻擊命中吸血4%" } },
      ],
    },
    accessory: {
      common: [
        { name: "夜市戰功手環", rarity: "common", statKey: "luck", statValue: 1 },
        { name: "夜市小福袋", rarity: "common", statKey: "luck", statValue: 1 },
      ],
      rare: [
        { name: "金光閃閃四葉草吊飾", rarity: "rare", statKey: "luck", statValue: 3 },
        { name: "夜市開運手鍊", rarity: "rare", statKey: "luck", statValue: 3 },
      ],
      epic: [
        { name: "夜市限定幸運吊飾", rarity: "epic", statKey: "luck", statValue: 4 },
        { name: "限量版夜市開運項鍊", rarity: "epic", statKey: "luck", statValue: 4 },
      ],
      legendary: [
        { name: "老闆珍藏傳說金牌", rarity: "legendary", statKey: "luck", statValue: 5,
          specialEffect: { key: "critBonus", value: 0.08, desc: "暴擊率+8%" } },
        { name: "傳說夜市守護符", rarity: "legendary", statKey: "luck", statValue: 5,
          specialEffect: { key: "dmgReduceRatio", value: 0.06, desc: "受到傷害減免6%" } },
      ],
    },
  };
  // 統一的「從這個稀有度的變化款裡面隨機挑一款」，取得裝備(商店買/抽獎機/樓層掉落)時都走
  // 這個函式，回傳的是單一一件裝備物件(不是陣列了)，後面的程式碼不用知道背後有幾種變化款。
  function pickVariant(list) {
    if (!list || !list.length) return null;
    return list[Math.floor(Math.random() * list.length)];
  }
  // 給商店列表用:列出這個稀有度全部可能拿到的變化款名字，讓玩家知道自己可能拿到哪幾款
  // (實際拿到哪一款是隨機的，這是夜市的「驚喜」，不是玩家自己選)。
  function variantNamePreview(list) {
    if (!list || !list.length) return "";
    return list.map((it) => it.name).join(" / ");
  }
  const SLOTS = ["weapon", "armor", "accessory"];
  const RARITIES = ["common", "rare", "epic", "legendary"];
  const RARITY_LABEL = { common: "普通", rare: "稀有", epic: "史詩", legendary: "傳說" };
  // 裝備等級限制:稀有度是「用商店/抽獎機買的東西」的等級門檻(這些不是從特定樓層掉的，
  // 沒有樓層可以參考，所以還是照稀有度分)。從樓層掉的裝備改成照「第幾層掉的」算等級門檻
  // (見 floorReqLevel)，這樣以後樓層開放到21層、30層...不用回頭改這張表，門檻會自動跟著長。
  const RARITY_REQ_LEVEL = { common: 1, rare: 5, epic: 15, legendary: 20 };
  const RARITY_ICON = { common: "package", rare: "gem", epic: "flame", legendary: "crown" };
  const STAT_LABEL = { atk: "攻擊", def: "防禦", spd: "速度", luck: "幸運", hp: "HP", matk: "魔攻", mp: "MP" };

  // 樓層掉落裝備的等級門檻:1~10層都要Lv.5才穿得動(貼著Lv5轉職那個里程碑，太早期沒必要卡)，
  // 11層以後門檻直接等於樓層數(11層掉的要Lv.11、20層掉的要Lv.20，以此類推，樓層開放到幾層
  // 這條公式就自動算到幾級，不用像稀有度那張表一樣手動維護)。
  function floorReqLevel(floorNumber) {
    return Math.max(5, floorNumber);
  }

  // 給裝備一句白話的加成說明，商店列表跟之後的背包介面都能直接用這個，不用另外存一份文字。
  function describeItem(item) {
    if (!item) return "";
    const parts = [];
    if (item.statKey) parts.push(`${STAT_LABEL[item.statKey]}+${item.statValue}`);
    if (item.extraHp) parts.push(`HP+${item.extraHp}`);
    if (item.specialEffect) parts.push(`★${item.specialEffect.desc}`);
    return parts.join("、");
  }

  // classKey:要掉武器的話，武器款式要照這位玩家目前的職業給(轉職前拿到的是見習武器，
  // 轉職後打出來的才會是對應職業的武器)。掉出來的東西會帶著 reqLevel(這層樓算出來的等級門檻)，
  // 跟稀有度是分開的兩件事——史詩不代表一定要Lv15，要看是幾層掉的。
  // luckBonus:「鑑定之眼」被動算出來的掉落機率加成(0~0.08)，直接加在樓層原本的掉落率上，最高封頂100%
  function rollDrop(floorDef, classKey, luckBonus) {
    const dropChance = Math.min(1, floorDef.dropChance + (luckBonus || 0));
    if (Math.random() > dropChance) return null;
    const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
    const weights = floorDef.dropRarityWeights;
    let r = Math.random();
    let rarity = "common";
    for (const key of Object.keys(weights)) {
      r -= weights[key];
      if (r <= 0) {
        rarity = key;
        break;
      }
    }
    // P2-2新增:40/50層Boss機率掉的傳說裝備是「Boss限定裝備」，用專屬的資料表，不是一般的
    // WEAPON_TABLE/EQUIPMENT_TABLE(那個傳說是商店/抽獎機專用的款式)。
    // P2-10追加修改:武器的名稱、statKey都要照玩家職業決定(名字見BOSS_WEAPON_NAMES，沒對應的
    // 職業退回novice款)，不是所有職業共用同一個名字。防具/飾品維持不分職業共用。
    if (rarity === "legendary" && BOSS_LEGENDARY_ITEMS[floorDef.floor]) {
      const base = { ...BOSS_LEGENDARY_ITEMS[floorDef.floor][slot] };
      if (slot === "weapon") {
        const info = CD.CLASS_INFO[classKey];
        base.statKey = info && info.path === "magic" ? "matk" : "atk";
        const names = BOSS_WEAPON_NAMES[floorDef.floor];
        base.name = (names && (names[classKey] || names.novice)) || "無名的Boss限定兵刃";
      }
      return { slot, ...base, reqLevel: floorReqLevel(floorDef.floor), bossExclusive: true };
    }
    const base = pickVariant(slot === "weapon" ? (WEAPON_TABLE[classKey] || WEAPON_TABLE.novice)[rarity] : EQUIPMENT_TABLE[slot][rarity]);
    return { slot, ...base, reqLevel: floorReqLevel(floorDef.floor) };
  }

  // 等級曲線:越後面需要越多經驗值(企劃書第三節)
  function expToNextLevel(level) {
    return 20 + level * 8;
  }

  // ---------- 商店定價(企劃書第八節) ----------

  // 直接加1點數值:50幣起，買一次漲一次價，抑制無腦堆數值
  function statPointPrice(boughtCount) {
    return 50 + boughtCount * 25;
  }

  const EQUIPMENT_PRICE_RANGE = {
    common: [100, 150],
    rare: [300, 400],
    epic: [500, 650],
    legendary: [800, 1000],
  };
  function equipmentPrice(rarity) {
    const [min, max] = EQUIPMENT_PRICE_RANGE[rarity];
    return min + Math.floor(Math.random() * (max - min + 1));
  }
  // P2-9新增:一鍵賣裝的賣出價，抓買價區間中間值的25%(賣裝備本來就不會回本，只是清背包換點幣)。
  function sellPrice(rarity) {
    const [min, max] = EQUIPMENT_PRICE_RANGE[rarity];
    return Math.round(((min + max) / 2) * 0.25);
  }

  const GACHA_PRICE = 50;
  // 顯示用的機率表，要跟 db.js 的 buyCareerGachaPull 那幾個 roll < X 的實際判斷式維持一致，
  // 改機率的話兩邊都要一起改(這裡只是給「抽獎機」分頁顯示機率表用，不是實際判定邏輯)。
  const GACHA_POOL = [
    { label: "小獎(退回一些幣)", chance: 0.55 },
    { label: "自由數值點 x1", chance: 0.2 },
    { label: "普通裝備", chance: 0.1 },
    { label: "稀有裝備", chance: 0.12 },
    { label: "史詩裝備", chance: 0.025 },
    { label: "傳說裝備(整場限量)", chance: 0.005 },
  ];

  // 藥水:恢復藥水補HP、魔力藥水補MP，都是消耗品，用掉一瓶少一瓶。
  const POTIONS = {
    hp: { name: "恢復藥水", price: 30, healRatio: 0.4, icon: "flask-round" },
    mp: { name: "魔力藥水", price: 25, healRatio: 0.5, icon: "flask-conical" },
  };

  // 裝備合成:同部位、同稀有度的裝備湊滿3件就能嘗試合成，成功機率固定，
  // 成功拿到下一個稀有度的裝備、失敗拿回1件隨機部位的普通裝備(等於虧了，賭運氣)。
  // 只做得到 普通->稀有->史詩，傳說要另外開放合成的話，以後把 SYNTHESIS_PATH.epic 補上就好，
  // 這裡先照要求不開放。
  const SYNTHESIS_PATH = { common: "rare", rare: "epic" };
  const SYNTHESIS_INPUT_COUNT = 3;
  const SYNTHESIS_SUCCESS_RATE = 0.5;

  // 戰功勳章:純加分，給不想拚戰鬥、只想衝排行分的人(企劃書第八、九節)
  const MEDAL_TIERS = [
    { key: "bronze", name: "銅牌功勳", price: 40, scoreBonus: 5 },
    { key: "silver", name: "銀牌功勳", price: 100, scoreBonus: 12 },
    { key: "gold", name: "金牌功勳", price: 220, scoreBonus: 25 },
  ];

  return {
    FLOORS,
    getFloor,
    WEAPON_TABLE,
    EQUIPMENT_TABLE,
    SLOTS,
    RARITIES,
    RARITY_LABEL,
    RARITY_REQ_LEVEL,
    floorReqLevel,
    RARITY_ICON,
    STAT_LABEL,
    describeItem,
    rollDrop,
    pickVariant,
    variantNamePreview,
    SET_BONUSES,
    BOSS_LEGENDARY_ITEMS,
    BOSS_WEAPON_NAMES,
    expToNextLevel,
    CLASS_KEYS,
    statPointPrice,
    EQUIPMENT_PRICE_RANGE,
    equipmentPrice,
    sellPrice,
    GACHA_PRICE,
    GACHA_POOL,
    POTIONS,
    MEDAL_TIERS,
    SYNTHESIS_PATH,
    SYNTHESIS_INPUT_COUNT,
    SYNTHESIS_SUCCESS_RATE,
  };
})();
