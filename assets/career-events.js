// 職業養成對決 · 爬塔事件庫(企劃書第六節)
//
// Phase2 骨架先做了 10 個事件，P2階段(玩家回饋覺得事件太少、希望多點變化)又加了 5 個，
// 現在總共 15 個。
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
    { key: "healing", icon: "heart-pulse", name: "路邊小吃攤", type: "instant", weight: 16,
      desc: "香噴噴的路邊攤，吃一輪順便回一下血跟魔力" },
    // P2-7新增(玩家回饋:事件太少、希望多一點變化)，以下5個是新加的：
    { key: "mentor", icon: "graduation-cap", name: "職業前輩客串教學", type: "instant", weight: 10,
      desc: "同職業路線的前輩剛好擺攤在旁邊，順手指點你幾招" },
    { key: "lost_child", icon: "footprints", name: "夜市走失小孩", type: "instant", weight: 9,
      desc: "一個小孩哭著說找不到爸媽，要不要幫忙找找看?" },
    { key: "try_on", icon: "shirt", name: "路邊試穿攤位", type: "instant", weight: 8,
      desc: "攤位老闆說可以免費試用一件展示品，順手就給你了" },
    { key: "spirit_blessing", icon: "wand-sparkles", name: "數值精靈眷顧", type: "instant", weight: 7,
      desc: "感覺有股神秘力量在打量你" },
    { key: "blind_boxes", icon: "package-search", name: "夜市矇眼摸彩", type: "choice", weight: 9,
      desc: "老闆擺出三個一模一樣的箱子，說隨便挑一個，裡面是什麼只有打開才知道" },
  ];

  // 世界觀第一階段:每個事件一句 flavor text(純文字)，顯示在事件卡片/事件結果上，不影響任何效果。
  // 斗笠人(sparring)、老師傅(reclass)、貴人(benefactor)、走失小孩(lost_child)、
  // 數值精靈(spirit_blessing)是世界觀裡的「高伏筆」事件，文案刻意留白。
  const FLAVOR = {
    chest: "寶箱上貼著便利貼:「別人的，請勿開啟。」",
    merchant: "你問他為什麼在這。他說:「人潮在哪，我在哪。」",
    fortune: "算命的說:「你今晚會贏。」然後收錢，不讓你問怎麼贏。",
    sparring: "他出招很熟練，像在回憶什麼。",
    reclass: "老師傅嘆氣:「手續費我也要吃飯啊。」",
    pickpocket: "小偷留下一張字條:「下次再來。」",
    landmine: "彈珠台上寫著:「本機台由 ○ 層維修。」",
    benefactor: "他把東西塞給你就走了，沒留名字。",
    gacha: "機器在冒煙，吐出來的東西有點眼熟，又有點陌生。",
    healing: "老闆說:「看你可憐。」",
    mentor: "前輩教完，說:「我以前也這樣。」然後轉身消失。",
    lost_child: "小孩說:「我爸媽在上面。」你問上面是哪，他指著天花板。",
    try_on: "這件是展示品，我不收錢。……因為沒人敢穿。",
    spirit_blessing: "有什麼東西在你身上停了一下，然後離開。",
    blind_boxes: "老闆說:「每個都是獎，只是有些是獎中的獎。」",
  };
  EVENTS.forEach((e) => { e.flavor = FLAVOR[e.key] || ""; });

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
