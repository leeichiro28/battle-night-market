// 夜市拍賣・商品清單與排程規則
// 這份清單目前是固定的(來自企劃書),之後想讓主辦人自訂商品清單再擴充成後台可編輯。
// 每個商品是 [名稱, 底價財神幣]。分數 = 底價 / 10(四捨五入,最少 5 分),越稀有底價越高、分數也越高。
const AUCTION_CATALOG = {
  common: {
    label: "普通",
    note: "底價 50~150 財神幣",
    items: [
      ["撈金魚戰利品袋", 60], ["棉花糖幸運符", 70], ["彈珠台紀念幣", 80],
      ["套圈圈安慰獎小熊", 90], ["木瓜牛奶特調券", 100], ["彈珠汽水一瓶", 100],
      ["抓娃娃機三次券", 110], ["糖葫蘆一串", 120], ["蔥抓餅加蛋券", 130], ["剉冰配料加倍券", 140],
    ],
  },
  rare: {
    label: "稀有",
    note: "底價 300~500 財神幣",
    items: [
      ["老闆珍藏麻辣配方", 300], ["限量版套圈神器", 320], ["一夜好運符", 350],
      ["麻辣鴨血終極醬料包", 380], ["大腸包小腸豪華加料券", 400], ["士林大香腸雙倍肉券", 420],
      ["珍珠奶茶終身微糖權(限本場)", 450], ["胡椒餅剛出爐搶先取件權", 470], ["燒仙草加料吃到爽券", 500],
    ],
  },
  epic: {
    label: "史詩",
    note: "底價 600~900 財神幣",
    items: [
      ["夜市街頭傳說涼麵秘技", 600], ["老闆娘的招牌笑容加持券", 630], ["限量印刷版夜市地圖", 660],
      ["黃金脆皮雞排一世情緣券", 700], ["蚵仔煎主廚特製版", 750], ["棺材板隱藏內餡兌換券", 800],
      ["割包三兄弟套餐券", 850], ["花枝羹古早味秘傳版", 900],
    ],
  },
  legendary: {
    label: "傳說",
    note: "底價 1000 財神幣以上,整場限量供應",
    items: [
      ["夜市之王的金色炸雞桶", 1000], ["傳說中的隱藏攤位地圖", 1050], ["老闆親筆簽名招牌", 1100],
      ["鎮攤之寶・招財貓神像", 1150], ["藥燉排骨傳家秘方", 1200], ["米其林級蚵仔麵線終極套餐", 1300],
      ["整條夜市免費吃三攤兌換券", 1500],
    ],
  },
};

// 福袋箱:神秘箱,得標後才知道裡面是什麼,可能超值也可能是雷。
// 拍賣中顯示固定底價,實際分數是結標時用機率表現場開出來的,寫回這件商品的 points 欄位。
const AUCTION_MYSTERY_BOXES = [
  ["夜市福袋箱・招財", 350],
  ["夜市福袋箱・旺來", 350],
  ["夜市福袋箱・大吉", 400],
  ["夜市福袋箱・驚喜", 400],
];
const AUCTION_MYSTERY_MIN_INCREMENT = 30;
// weight 決定機率(總和不用是100,函式會自己算比例),points 是開出這個等級可以拿到的分數。
const AUCTION_BOX_OUTCOMES = [
  { tier: "bust", name: "只有一張參加感謝小卡(雷)", weight: 10, points: 5 },
  { tier: "common", name: "普通等級獎項", weight: 40, points: 15 },
  { tier: "rare", name: "稀有等級獎項", weight: 30, points: 40 },
  { tier: "epic", name: "史詩等級獎項", weight: 15, points: 75 },
  { tier: "legendary", name: "傳說等級大獎!", weight: 5, points: 150 },
];

function auctionRollMysteryBoxOutcome() {
  const total = AUCTION_BOX_OUTCOMES.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of AUCTION_BOX_OUTCOMES) {
    if (r < o.weight) return o;
    r -= o.weight;
  }
  return AUCTION_BOX_OUTCOMES[0];
}

// 組合包:一次多件小東西綁在一起賣,適合想快速湊分的人。分數比同價位單品略高一點,當作組合優惠。
const AUCTION_BUNDLE_ITEMS = [
  { name: "夜市小物組合包(彈珠汽水+套圈圈安慰獎小熊+抓娃娃機三次券)", basePrice: 220, points: 30 },
  { name: "銅板美食組合包(蔥抓餅加蛋券+木瓜牛奶特調券+剉冰配料加倍券)", basePrice: 260, points: 35 },
  { name: "遊戲戰利品組合包(彈珠台紀念幣+撈金魚戰利品袋+糖葫蘆一串)", basePrice: 200, points: 28 },
];
const AUCTION_BUNDLE_MIN_INCREMENT = 20;

// 特殊券:不算稀有度分數,而是給一個能影響拍賣本身的功能。固定價位、整場限量供應(各一張)。
// key 對應 db.js 結標時要加進 auction_participants.effects 的欄位名稱。
const AUCTION_SPECIAL_ITEMS = [
  { key: "intel", name: "搶先情報券", basePrice: 400, effectDesc: "使用後,你能提前看到全場剩餘的完整商品清單(其他人只能看到最近幾件)" },
  { key: "priority", name: "插隊優先權", basePrice: 350, effectDesc: "使用後預約下一波:那一波開拍時你有專屬優先出價時間,其他人要等時間到才能搶標" },
  { key: "refund", name: "退款保證券", basePrice: 450, effectDesc: "手上任一件已得標的商品,可以無條件退回一次,拿回一半財神幣" },
  { key: "boxDouble", name: "福袋箱翻倍券", basePrice: 400, effectDesc: "使用後,下一次你標到福袋箱時,開出的分數直接翻倍" },
  { key: "freeCommon", name: "老闆招待券", basePrice: 300, effectDesc: "免費兌換一件正在拍賣中的「普通」級商品,不用出財神幣" },
];
const AUCTION_TICKET_META = {
  intel: { name: "搶先情報券", icon: "eye" },
  priority: { name: "插隊優先權", icon: "fast-forward" },
  refund: { name: "退款保證券", icon: "undo-2" },
  boxDouble: { name: "福袋箱翻倍券", icon: "package-open" },
  freeCommon: { name: "老闆招待券", icon: "hand-platter" },
};

const AUCTION_TIER_ORDER = ["common", "rare", "epic", "legendary"];
const AUCTION_TIER_WEIGHT = { common: 0, rare: 1, epic: 2, legendary: 3, special: 2.5, mystery: 1.5, bundle: 0.5 };
const AUCTION_MIN_INCREMENT = { common: 10, rare: 20, epic: 30, legendary: 50, special: 20, mystery: 30, bundle: 20 };
const AUCTION_PRIORITY_WINDOW_SEC = 6; // 插隊優先權:專屬優先出價秒數
const AUCTION_INTEL_PREVIEW_DEFAULT = 4; // 沒有搶先情報券的人,商品預告預設只能看到幾件
const AUCTION_INTEL_PREVIEW_UNLOCKED = 24; // 用過搶先情報券之後,商品預告可以看到幾件

const AUCTION_LOT_DURATION_SEC = 30; // 每件商品開拍後的初始倒數秒數
const AUCTION_ANTI_SNIPE_WINDOW_SEC = 10; // 倒數剩多少秒內加價會觸發重新計時(防偷襲)
const AUCTION_ANTI_SNIPE_EXTEND_SEC = 15; // 觸發後重新計時到剩幾秒
const AUCTION_WORK_COOLDOWN_SEC = 75; // 打工按鈕冷卻秒數
const AUCTION_WORK_MIN = 20; // 打工最少拿到
const AUCTION_WORK_MAX = 60; // 打工最多拿到
const AUCTION_COIN_TO_SCORE = 0.5; // 剩餘財神幣折算分數的比例
const AUCTION_DEFAULT_BUDGET = 1000;
const AUCTION_DEFAULT_WAVE_INTERVAL_SEC = 90;
const AUCTION_DEFAULT_ITEMS_PER_WAVE = 1;
const AUCTION_PARTICIPATION_REFUND_MULT = 2; // 參與退補:出過價沒標到的人,退還「min_increment * 這個倍率」當參與獎勵

function auctionPointsForPrice(basePrice) {
  return Math.max(5, Math.round(basePrice / 10));
}

function auctionShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 產生整場拍賣的商品排程:先普通、中段稀有/史詩交錯、尾聲壓軸傳說,
// 組合包穿插在普通附近、福袋箱穿插在中段、特殊券穿插在中後段。
// 做法是每件商品依級距給一個基準權重,加一點隨機抖動讓相鄰級距互相穿插,
// 再依權重排序,不是死板地一級距拍完才拍下一個級距。
function buildAuctionItemSequence() {
  const pool = [];
  AUCTION_TIER_ORDER.forEach((tier) => {
    auctionShuffle(AUCTION_CATALOG[tier].items).forEach(([name, basePrice]) => {
      pool.push({
        itemName: name,
        itemTier: tier,
        basePrice,
        points: auctionPointsForPrice(basePrice),
        minIncrement: AUCTION_MIN_INCREMENT[tier],
        specialKey: null,
        sortKey: AUCTION_TIER_WEIGHT[tier] + Math.random() * 1.6,
      });
    });
  });
  auctionShuffle(AUCTION_BUNDLE_ITEMS).forEach((b) => {
    pool.push({
      itemName: b.name,
      itemTier: "bundle",
      basePrice: b.basePrice,
      points: b.points,
      minIncrement: AUCTION_MIN_INCREMENT.bundle,
      specialKey: null,
      sortKey: AUCTION_TIER_WEIGHT.bundle + Math.random() * 1.6,
    });
  });
  auctionShuffle(AUCTION_MYSTERY_BOXES).forEach(([name, basePrice]) => {
    pool.push({
      itemName: name,
      itemTier: "mystery",
      basePrice,
      points: 0, // 開箱前不知道分數,結標時 finalizeAuctionLot 會用機率表算出來寫回去
      minIncrement: AUCTION_MIN_INCREMENT.mystery,
      specialKey: null,
      sortKey: AUCTION_TIER_WEIGHT.mystery + Math.random() * 1.6,
    });
  });
  auctionShuffle(AUCTION_SPECIAL_ITEMS).forEach((sp) => {
    pool.push({
      itemName: sp.name,
      itemTier: "special",
      basePrice: sp.basePrice,
      points: 0, // 特殊券不計分,只給功能
      minIncrement: AUCTION_MIN_INCREMENT.special,
      specialKey: sp.key,
      sortKey: AUCTION_TIER_WEIGHT.special + Math.random() * 1.6,
    });
  });
  pool.sort((a, b) => a.sortKey - b.sortKey);
  return pool;
}

// 把商品序列切成一波一波(每波固定件數,最後一波可能不足額)
function buildAuctionWaves(itemsPerWave) {
  const seq = buildAuctionItemSequence();
  const perWave = Math.max(1, itemsPerWave || AUCTION_DEFAULT_ITEMS_PER_WAVE);
  const waves = [];
  for (let i = 0; i < seq.length; i += perWave) {
    waves.push(seq.slice(i, i + perWave));
  }
  return waves;
}

// ---------- 夜市任務(問答／猜謎) ----------
// 「找彩蛋」在 MVP 階段沿用同一套選擇題邏輯,只是題目風格/圖示不同,
// 之後如果要做真的畫面上藏一顆可以點的彩蛋,再另外擴充。
const AUCTION_TASK_DURATION_SEC = 45; // 每題開放作答的秒數
const AUCTION_TASK_MIN_REWARD = 30;
const AUCTION_TASK_MAX_REWARD = 80;
const AUCTION_TASK_INTERVAL_SEC = 240; // 大約每隔幾秒排一題(整場時長會依此估算題數)
const AUCTION_TASK_MIN_COUNT = 2;
const AUCTION_TASK_MAX_COUNT = 8;

const AUCTION_TASK_ICON = { quiz: "circle-question-mark", riddle: "sparkles", egg: "egg" };
const AUCTION_TASK_LABEL = { quiz: "夜市問答", riddle: "夜市猜謎", egg: "夜市彩蛋" };

// 題庫:一部分是拍賣規則本身(答對還能順便搞懂遊戲怎麼玩),一部分是原創的夜市主題猜謎。
const AUCTION_TASK_BANK = [
  { type: "quiz", q: "活動結束時,沒花完的財神幣 1 枚可以折算多少分?", options: ["0.5 分", "1 分", "2 分", "不能折算"], correct: 0 },
  { type: "quiz", q: "拍賣倒數剩最後幾秒內加價,會觸發防偷襲重新計時?", options: ["5 秒", "10 秒", "20 秒", "30 秒"], correct: 1 },
  { type: "quiz", q: "打工按鈕按一次之後,大約要等多久才能再按一次?", options: ["30 秒", "45 秒", "60 秒", "75 秒"], correct: 3 },
  { type: "quiz", q: "拍賣商品裡,哪個級距的底價通常最高?", options: ["普通", "稀有", "史詩", "傳說"], correct: 3 },
  { type: "quiz", q: "出價的時候,加價金額至少要達到多少才會成功?", options: ["任意金額都可以", "最小加價單位", "目前最高價的兩倍", "底價的一半"], correct: 1 },
  { type: "riddle", q: "謎面:全身金黃酥脆,是排隊天王,可以加辣加大,你猜是什麼?", options: ["雞排", "蚵仔煎", "大腸包小腸", "剉冰"], correct: 0 },
  { type: "riddle", q: "謎面:一鍋滾燙翻騰,加了藥材燉到骨肉分離,補身首選,你猜是什麼?", options: ["藥燉排骨", "麻辣鴨血", "燒仙草", "割包"], correct: 0 },
  { type: "riddle", q: "謎面:兩片吐司中間夾滿內餡,外型神秘像個小盒子,你猜是什麼?", options: ["棺材板", "胡椒餅", "花枝羹", "涼麵"], correct: 0 },
  { type: "riddle", q: "謎面:圓滾滾冰涼透心,配料任你選,是消暑聖品,你猜是什麼?", options: ["剉冰", "彈珠汽水", "木瓜牛奶", "珍珠奶茶"], correct: 0 },
  { type: "riddle", q: "謎面:白胖胖的身體裡包著滷肉跟酸菜,咬下去滿滿古早味,你猜是什麼?", options: ["割包", "蔥抓餅", "士林大香腸", "燒仙草"], correct: 0 },
  { type: "egg", q: "夜市彩蛋:如果想跟老闆多要一點「人情味」,通常要先做什麼?", options: ["笑著打招呼閒聊兩句", "板著臉一直殺價", "假裝沒帶錢包", "站在攤位前面滑手機"], correct: 0 },
  { type: "egg", q: "夜市彩蛋:排隊排最長的攤位,通常代表什麼?", options: ["東西大機率不錯吃", "老闆動作特別慢", "在辦活動抽獎", "純粹巧合而已"], correct: 0 },
];

function auctionTaskReward() {
  return AUCTION_TASK_MIN_REWARD + Math.floor(Math.random() * (AUCTION_TASK_MAX_REWARD - AUCTION_TASK_MIN_REWARD + 1));
}

// 依整場拍賣預估總時長抽出幾題(不重複),平均分散在時間軸上、加一點隨機抖動,
// 回傳每題距離拍賣開始的秒數(offsetSec),呼叫端(db.js的 startAuction)再換算成實際時間戳記寫進資料庫。
function buildAuctionTaskSchedule(totalDurationSec) {
  const count = Math.max(AUCTION_TASK_MIN_COUNT, Math.min(AUCTION_TASK_MAX_COUNT, Math.round(totalDurationSec / AUCTION_TASK_INTERVAL_SEC) || AUCTION_TASK_MIN_COUNT));
  const bank = auctionShuffle(AUCTION_TASK_BANK).slice(0, Math.min(count, AUCTION_TASK_BANK.length));
  const interval = totalDurationSec / (bank.length + 1);
  return bank.map((t, i) => {
    const jitter = (Math.random() - 0.5) * interval * 0.4;
    const offsetSec = Math.max(20, Math.round(interval * (i + 1) + jitter));
    return { type: t.type, q: t.q, options: t.options, correct: t.correct, reward: auctionTaskReward(), offsetSec };
  });
}

// ---------- 幸運攤位(快速小賭注) ----------
// 骰一顆六面骰:1~3 算「小」、4~6 算「大」(沒有平手情況)。
// 猜對:拿回雙倍下注(淨賺一個下注額);猜錯:拿回一半下注(淨虧一半下注額,無條件捨去)。
const AUCTION_LUCKY_COOLDOWN_SEC = 20; // 下注按鈕冷卻秒數,「快速」但不要讓人瘋狂連點洗財神幣
const AUCTION_LUCKY_MIN_BET = 20;
const AUCTION_LUCKY_MAX_BET = 300;

function auctionRollLuckyDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function auctionLuckyOutcome(die) {
  return die >= 4 ? "big" : "small";
}

// 純計算下注結果(不碰資料庫),db.js 的 placeAuctionLuckyBet 呼叫這個函式算出結果後再寫回財神幣。
function resolveAuctionLuckyBet(betAmount, guess) {
  const die = auctionRollLuckyDie();
  const outcome = auctionLuckyOutcome(die);
  const win = guess === outcome;
  const delta = win ? betAmount : -Math.ceil(betAmount / 2);
  return { die, outcome, win, delta };
}
