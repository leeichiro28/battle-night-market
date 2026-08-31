// 職業養成對決 · 爬塔樓層資料(企劃書第五、六、八節)
//
// Phase2 骨架先做 20 層(企劃書第十二節:「先做20~30層,樓層資料是純設定檔,之後要擴充只是加資料
// 不是架構改動」),全部落在「1~20層新手區」這個難度帶,每滿10層(這裡就是第10、20層)是小關主，
// 保底比較好的獎勵。21層以後(中階/高階/Boss)之後要擴充，直接在 FLOORS 陣列後面加資料就好，
// 不用動這支檔案以外的任何程式碼。
window.CareerFloors = (function () {
  const CD = window.CareerData;
  const CLASS_KEYS = ["warrior", "guardian", "archer", "assassin", "mage", "healer"];
  const MONSTER_NAMES = ["烤香腸小惡魔", "彈珠台幽靈", "撈金魚精"];

  function buildFloor(n) {
    const isMiniBoss = n % 10 === 0; // 每滿10層是小關主(企劃書第五節「關主樓層」)
    const nameBase = MONSTER_NAMES[n % MONSTER_NAMES.length];
    const classKey = CLASS_KEYS[n % CLASS_KEYS.length];
    const growth = isMiniBoss ? 1.3 : 1;
    const atk = Math.round((2 + n * 0.5) * growth);
    const def = Math.round((1 + n * 0.4) * growth);
    const spd = Math.round(2 + n * 0.35);
    const hp = Math.round((14 + n * 3) * growth);
    const luck = Math.floor(n * 0.2);
    const matk = atk; // 怪物的魔攻直接跟攻擊力同步，樓層資料不用另外調兩條成長曲線

    const coinBase = 5 + Math.floor(n * 0.3);
    const expBase = 8 + Math.floor(n * 0.6);

    return {
      floor: n,
      name: isMiniBoss ? `${nameBase}王(${n}層關主)` : nameBase,
      isMiniBoss,
      classKey,
      stats: { atk, def, spd, hp, luck, matk, maxHp: hp },
      coinReward: isMiniBoss ? coinBase * 2 : coinBase,
      expReward: isMiniBoss ? Math.round(expBase * 1.8) : expBase,
      // 掉落機率跟稀有度用一致的四級系統(跟夜市拍賣商品清單同一套 common/rare/epic/legendary)：
      // 一般樓層只掉得到 普通/稀有；小關主保底掉 稀有 或 史詩，傳說裝備完全不會從樓層掉，
      // 只有商店/抽獎機拿得到(整場限購1件，保持稀有感)。
      dropChance: isMiniBoss ? 1 : 0.3,
      dropRarityWeights: isMiniBoss ? { rare: 0.6, epic: 0.4 } : { common: 0.85, rare: 0.15 },
    };
  }

  const FLOORS = [];
  for (let n = 1; n <= 20; n++) FLOORS.push(buildFloor(n));

  function getFloor(n) {
    return FLOORS.find((f) => f.floor === n) || null;
  }

  // 裝備表(企劃書第四節，四個稀有度：普通/稀有/史詩/傳說，跟夜市拍賣商品清單同一套稱呼)。
  // 武器分職業(每個職業武器都不一樣，符合角色設定)，防具/飾品先共用，之後要細分也是照這個
  // 模式再加一層 classKey 就好，架構不用大改。
  const WEAPON_TABLE = {
    novice: {
      common: { name: "學徒練習木棍", rarity: "common", statKey: "atk", statValue: 1 },
      rare: { name: "學徒鐵棍", rarity: "rare", statKey: "atk", statValue: 2 },
      epic: { name: "學徒鑄鐵劍", rarity: "epic", statKey: "atk", statValue: 3 },
      legendary: { name: "見習生的必勝木劍", rarity: "legendary", statKey: "atk", statValue: 4 },
    },
    warrior: {
      common: { name: "夜市烤香腸叉", rarity: "common", statKey: "atk", statValue: 1 },
      rare: { name: "熱血烤肉大鐵叉", rarity: "rare", statKey: "atk", statValue: 3 },
      epic: { name: "限量版夜市烤肉神叉", rarity: "epic", statKey: "atk", statValue: 4 },
      legendary: { name: "地表最強·雷神烤肉叉", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    guardian: {
      common: { name: "彈珠台鐵拳套", rarity: "common", statKey: "atk", statValue: 1 },
      rare: { name: "撞球場鎮店球桿", rarity: "rare", statKey: "atk", statValue: 3 },
      epic: { name: "限量版撞球場黃金球桿", rarity: "epic", statKey: "atk", statValue: 4 },
      legendary: { name: "夜市鎮店之寶·黃金拳套", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    archer: {
      common: { name: "打氣球玩具槍", rarity: "common", statKey: "atk", statValue: 1 },
      rare: { name: "夜市射擊神槍", rarity: "rare", statKey: "atk", statValue: 3 },
      epic: { name: "限量版夜市射擊神槍Ⅱ", rarity: "epic", statKey: "atk", statValue: 4 },
      legendary: { name: "傳說神槍手的終極玩具槍", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    assassin: {
      common: { name: "水果削皮刀", rarity: "common", statKey: "atk", statValue: 1 },
      rare: { name: "老闆珍藏開山刀", rarity: "rare", statKey: "atk", statValue: 3 },
      epic: { name: "限量版開山刀·夜襲", rarity: "epic", statKey: "atk", statValue: 4 },
      legendary: { name: "都市傳說開山刀王", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    mage: {
      common: { name: "棉花糖魔杖", rarity: "common", statKey: "matk", statValue: 1 },
      rare: { name: "老闆特調法杖", rarity: "rare", statKey: "matk", statValue: 3 },
      epic: { name: "限量版老闆秘藏法杖", rarity: "epic", statKey: "matk", statValue: 4 },
      legendary: { name: "老闆傳承三代的鎮店法杖", rarity: "legendary", statKey: "matk", statValue: 5 },
    },
    healer: {
      common: { name: "藥燉排骨勺", rarity: "common", statKey: "matk", statValue: 1 },
      rare: { name: "回春糖葫蘆杖", rarity: "rare", statKey: "matk", statValue: 3 },
      epic: { name: "限量版糖葫蘆聖杖", rarity: "epic", statKey: "matk", statValue: 4 },
      legendary: { name: "回春大師的傳說糖葫蘆", rarity: "legendary", statKey: "matk", statValue: 5 },
    },
  };
  const EQUIPMENT_TABLE = {
    armor: {
      common: { name: "彈珠台鐵皮盾", rarity: "common", statKey: "def", statValue: 1, extraHp: 2 },
      rare: { name: "臭豆腐限定重甲", rarity: "rare", statKey: "def", statValue: 2, extraHp: 5 },
      epic: { name: "夜市限定強化鎧甲", rarity: "epic", statKey: "def", statValue: 3, extraHp: 7 },
      legendary: { name: "夜市限量傳說鎧甲", rarity: "legendary", statKey: "def", statValue: 4, extraHp: 8 },
    },
    accessory: {
      common: { name: "夜市戰功手環", rarity: "common", statKey: "luck", statValue: 1 },
      rare: { name: "金光閃閃四葉草吊飾", rarity: "rare", statKey: "luck", statValue: 3 },
      epic: { name: "夜市限定幸運吊飾", rarity: "epic", statKey: "luck", statValue: 4 },
      legendary: { name: "老闆珍藏傳說金牌", rarity: "legendary", statKey: "luck", statValue: 5 },
    },
  };
  const SLOTS = ["weapon", "armor", "accessory"];
  const RARITIES = ["common", "rare", "epic", "legendary"];
  const RARITY_LABEL = { common: "普通", rare: "稀有", epic: "史詩", legendary: "傳說" };
  const RARITY_ICON = { common: "package", rare: "gem", epic: "flame", legendary: "crown" };
  const STAT_LABEL = { atk: "攻擊", def: "防禦", spd: "速度", luck: "幸運", hp: "HP", matk: "魔攻" };

  // 給裝備一句白話的加成說明，商店列表跟之後的背包介面都能直接用這個，不用另外存一份文字。
  function describeItem(item) {
    if (!item) return "";
    const parts = [];
    if (item.statKey) parts.push(`${STAT_LABEL[item.statKey]}+${item.statValue}`);
    if (item.extraHp) parts.push(`HP+${item.extraHp}`);
    return parts.join("、");
  }

  // classKey:要掉武器的話，武器款式要照這位玩家目前的職業給(轉職前拿到的是見習武器，
  // 轉職後打出來的才會是對應職業的武器)。
  function rollDrop(floorDef, classKey) {
    if (Math.random() > floorDef.dropChance) return null;
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
    if (slot === "weapon") {
      const table = WEAPON_TABLE[classKey] || WEAPON_TABLE.novice;
      return { slot, ...table[rarity] };
    }
    return { slot, ...EQUIPMENT_TABLE[slot][rarity] };
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
    RARITY_ICON,
    STAT_LABEL,
    describeItem,
    rollDrop,
    expToNextLevel,
    CLASS_KEYS,
    statPointPrice,
    EQUIPMENT_PRICE_RANGE,
    equipmentPrice,
    GACHA_PRICE,
    GACHA_POOL,
    MEDAL_TIERS,
    SYNTHESIS_PATH,
    SYNTHESIS_INPUT_COUNT,
    SYNTHESIS_SUCCESS_RATE,
  };
})();
