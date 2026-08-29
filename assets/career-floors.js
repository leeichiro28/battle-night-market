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

    const coinBase = 5 + Math.floor(n * 0.3);
    const expBase = 8 + Math.floor(n * 0.6);

    return {
      floor: n,
      name: isMiniBoss ? `${nameBase}王(${n}層關主)` : nameBase,
      isMiniBoss,
      classKey,
      stats: { atk, def, spd, hp, luck, maxHp: hp },
      coinReward: isMiniBoss ? coinBase * 2 : coinBase,
      expReward: isMiniBoss ? Math.round(expBase * 1.8) : expBase,
      dropChance: isMiniBoss ? 1 : 0.3,
      dropRareWeight: isMiniBoss ? 1 : 0.15, // 掉落時抽中稀有的機率,普通裝備是 1-此值
    };
  }

  const FLOORS = [];
  for (let n = 1; n <= 20; n++) FLOORS.push(buildFloor(n));

  function getFloor(n) {
    return FLOORS.find((f) => f.floor === n) || null;
  }

  // 裝備表(企劃書第四節,先做普通/稀有兩級,數值是單純加成，特殊效果留給 Phase4)。
  // 武器分職業(每個職業武器都不一樣，符合角色設定)，防具/飾品先共用，之後要細分也是照這個
  // 模式再加一層 classKey 就好，架構不用大改。
  const WEAPON_TABLE = {
    novice: {
      normal: { name: "學徒練習木棍", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "學徒鐵棍", rarity: "rare", statKey: "atk", statValue: 2 },
      legendary: { name: "見習生的必勝木劍", rarity: "legendary", statKey: "atk", statValue: 3 },
    },
    warrior: {
      normal: { name: "夜市烤香腸叉", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "熱血烤肉大鐵叉", rarity: "rare", statKey: "atk", statValue: 3 },
      legendary: { name: "地表最強·雷神烤肉叉", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    guardian: {
      normal: { name: "彈珠台鐵拳套", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "撞球場鎮店球桿", rarity: "rare", statKey: "atk", statValue: 3 },
      legendary: { name: "夜市鎮店之寶·黃金拳套", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    archer: {
      normal: { name: "打氣球玩具槍", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "夜市射擊神槍", rarity: "rare", statKey: "atk", statValue: 3 },
      legendary: { name: "傳說神槍手的終極玩具槍", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    assassin: {
      normal: { name: "水果削皮刀", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "老闆珍藏開山刀", rarity: "rare", statKey: "atk", statValue: 3 },
      legendary: { name: "都市傳說開山刀王", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    mage: {
      normal: { name: "棉花糖魔杖", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "老闆特調法杖", rarity: "rare", statKey: "atk", statValue: 3 },
      legendary: { name: "老闆傳承三代的鎮店法杖", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
    healer: {
      normal: { name: "藥燉排骨勺", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "回春糖葫蘆杖", rarity: "rare", statKey: "atk", statValue: 3 },
      legendary: { name: "回春大師的傳說糖葫蘆", rarity: "legendary", statKey: "atk", statValue: 5 },
    },
  };
  const EQUIPMENT_TABLE = {
    armor: {
      normal: { name: "彈珠台鐵皮盾", rarity: "normal", statKey: "def", statValue: 1, extraHp: 2 },
      rare: { name: "臭豆腐限定重甲", rarity: "rare", statKey: "def", statValue: 2, extraHp: 5 },
      legendary: { name: "夜市限量傳說鎧甲", rarity: "legendary", statKey: "def", statValue: 4, extraHp: 8 },
    },
    accessory: {
      normal: { name: "夜市戰功手環", rarity: "normal", statKey: "luck", statValue: 1 },
      rare: { name: "金光閃閃四葉草吊飾", rarity: "rare", statKey: "luck", statValue: 3 },
      legendary: { name: "老闆珍藏傳說金牌", rarity: "legendary", statKey: "luck", statValue: 5 },
    },
  };
  const SLOTS = ["weapon", "armor", "accessory"];
  const RARITY_LABEL = { normal: "普通", rare: "稀有", legendary: "傳說" };
  const STAT_LABEL = { atk: "攻擊", def: "防禦", spd: "速度", luck: "幸運", hp: "HP" };

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
    const rarity = Math.random() < floorDef.dropRareWeight ? "rare" : "normal";
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
    normal: [100, 150],
    rare: [300, 400],
    legendary: [800, 1000],
  };
  function equipmentPrice(rarity) {
    const [min, max] = EQUIPMENT_PRICE_RANGE[rarity];
    return min + Math.floor(Math.random() * (max - min + 1));
  }

  const GACHA_PRICE = 50;

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
    RARITY_LABEL,
    STAT_LABEL,
    describeItem,
    rollDrop,
    expToNextLevel,
    CLASS_KEYS,
    statPointPrice,
    EQUIPMENT_PRICE_RANGE,
    equipmentPrice,
    GACHA_PRICE,
    MEDAL_TIERS,
  };
})();
