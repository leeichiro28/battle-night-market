// 職業養成對決 · 爬塔事件庫(企劃書第六節)
//
// 這批事件原本是 Phase2 爬塔骨架清單裡的項目(「5~6個事件」)，當時先把三個核心行動的骨架
// 做穩就沒跟著做，這裡補上。9 個事件都做了，比原本清單的 5~6 個還多一點。
//
// 觸發時機:挑戰樓層時，有 EVENT_TRIGGER_CHANCE 的機率不是打怪、而是觸發一個隨機事件，
// 穿插在樓層遭遇戰之間(企劃書原文的形容)。
//
// 兩種類型:
//   instant - 立刻算完效果，不需要玩家做選擇(算命攤/神秘人切磋/扒手/地雷/貴人/抽獎機)
//   choice  - 需要玩家二選一才會生效，先把選項存進 career_progress.pending_event，
//             等玩家選了才真正套用效果(神秘寶箱/路過商人/轉職邀請)。
window.CareerEvents = (function () {
  const EVENTS = [
    { key: "chest", icon: "gift", name: "神秘寶箱", type: "choice", weight: 14,
      desc: "路邊發現一個神秘寶箱，要當場打開，還是帶回去晚點開?" },
    { key: "merchant", icon: "shopping-bag", name: "路過商人", type: "choice", weight: 10,
      desc: "一個提著扁擔的商人吆喝著限時特價，要不要買?" },
    { key: "fortune", icon: "sparkles", name: "算命攤", type: "instant", weight: 12,
      desc: "路邊的算命攤幫你看了一卦" },
    { key: "sparring", icon: "swords", name: "神秘人切磋", type: "instant", weight: 14,
      desc: "一個戴斗笠的神秘人邀你切磋一下(練習賽，輸了不扣任何東西)" },
    { key: "reclass", icon: "rotate-ccw", name: "轉職邀請", type: "choice", weight: 8,
      desc: "一位老師傅表示可以幫你重新調整已經點過的數值點，但要收點手續費" },
    { key: "pickpocket", icon: "user-x", name: "扒手出沒", type: "instant", weight: 12,
      desc: "小心!剛剛好像被摸走了一點錢" },
    { key: "landmine", icon: "bomb", name: "彈珠台機關", type: "instant", weight: 12,
      desc: "不小心誤觸了路邊攤位的機關" },
    { key: "benefactor", icon: "hand-heart", name: "貴人相助", type: "instant", weight: 3,
      desc: "遇到一位樂於助人的路人(很稀有)" },
    { key: "gacha", icon: "dices", name: "夜市抽獎機", type: "instant", weight: 15,
      desc: "路過的抽獎機好像卡幣了，免費讓你抽一次" },
  ];

  const EVENT_TRIGGER_CHANCE = 0.25; // 挑戰樓層時,25%機率變事件、75%正常打怪

  function pickWeighted() {
    const total = EVENTS.reduce((s, e) => s + e.weight, 0);
    let r = Math.random() * total;
    for (const e of EVENTS) {
      r -= e.weight;
      if (r <= 0) return e;
    }
    return EVENTS[EVENTS.length - 1];
  }

  function getEvent(key) {
    return EVENTS.find((e) => e.key === key) || null;
  }

  return { EVENTS, EVENT_TRIGGER_CHANCE, pickWeighted, getEvent };
})();
