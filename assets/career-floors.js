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

  // 裝備表(企劃書第四節,先做普通/稀有兩級,數值是單純加成，特殊效果留給 Phase4)
  const EQUIPMENT_TABLE = {
    weapon: {
      normal: { name: "夜市烤香腸叉", rarity: "normal", statKey: "atk", statValue: 1 },
      rare: { name: "老闆特製撈魚網", rarity: "rare", statKey: "atk", statValue: 3 },
    },
    armor: {
      normal: { name: "彈珠台鐵皮盾", rarity: "normal", statKey: "def", statValue: 1, extraHp: 2 },
      rare: { name: "臭豆腐限定重甲", rarity: "rare", statKey: "def", statValue: 2, extraHp: 5 },
    },
    accessory: {
      normal: { name: "夜市戰功手環", rarity: "normal", statKey: "luck", statValue: 1 },
      rare: { name: "金光閃閃四葉草吊飾", rarity: "rare", statKey: "luck", statValue: 3 },
    },
  };
  const SLOTS = ["weapon", "armor", "accessory"];

  function rollDrop(floorDef) {
    if (Math.random() > floorDef.dropChance) return null;
    const slot = SLOTS[Math.floor(Math.random() * SLOTS.length)];
    const rarity = Math.random() < floorDef.dropRareWeight ? "rare" : "normal";
    return { slot, ...EQUIPMENT_TABLE[slot][rarity] };
  }

  // 等級曲線:越後面需要越多經驗值(企劃書第三節)
  function expToNextLevel(level) {
    return 20 + level * 8;
  }

  return { FLOORS, getFloor, EQUIPMENT_TABLE, SLOTS, rollDrop, expToNextLevel, CLASS_KEYS };
})();
