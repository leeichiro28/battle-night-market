// 夜市拍賣・商品清單與排程規則
// 這份清單目前是固定的(來自企劃書)，之後想讓主辦人自訂商品清單再擴充成後台可編輯。
// 分數規則(2026/08 調整):改成「得標當下實際成交價」現算分數，不是開拍前用底價就寫死，
// 這樣搶標搶得越貴、分數也跟著漲，不會出現「越競爭越虧」的狀況。auctionPointsForPrice()
// 在商品預告清單用底價估一個「最低可能分數」，finalizeAuctionLot() 結標時會用實際成交價重算一次。
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
    note: "底價 1000 財神幣以上，整場限量供應",
    items: [
      ["夜市之王的金色炸雞桶", 1000], ["傳說中的隱藏攤位地圖", 1050], ["老闆親筆簽名招牌", 1100],
      ["鎮攤之寶・招財貓神像", 1150], ["藥燉排骨傳家秘方", 1200], ["米其林級蚵仔麵線終極套餐", 1300],
      ["整條夜市免費吃三攤兌換券", 1500],
    ],
  },
};

// 舊制:分數只跟開拍前的底價有關，得標當下不管實際成交價多少都用這個數字，是拍賣分數
// 不合理的根源(搶標搶得越貴、CP值越差)。新制改成用「實際成交價」(finalPrice)算分數，
// 底價只在商品預告清單拿來估一個最低分數用。比例從 0.1(底價/10) 調高到 0.35，並把
// AUCTION_COIN_TO_SCORE 從 0.5 降到 0.25——這樣「用底價得標」的分數(價格*0.35)已經比
// 「同樣的幣留著不花」(價格*0.25)更划算，越競爭搶到熱門商品，分數也跟著等比例往上漲，
// 不會再出現「標到就虧」的狀況。
// 品級加乘(2026/08新增):稀有度越高，同樣一塊錢換到的分數再多一點點，讓「拚傳說級」
// 比「同樣的錢拆成好幾件普通級」更有成就感，不是只有絕對分數高(本來價格就比較貴)。
const AUCTION_ITEM_SCORE_RATIO = 0.35;
const AUCTION_TIER_SCORE_MULTIPLIER = { common: 1, rare: 1.05, epic: 1.15, legendary: 1.3 };
function auctionPointsForPrice(price, tier) {
  const mult = AUCTION_TIER_SCORE_MULTIPLIER[tier] || 1;
  return Math.max(5, Math.round(price * AUCTION_ITEM_SCORE_RATIO * mult));
}

// 福袋箱:神秘箱，得標後才知道裡面是什麼，可能超值也可能是雷。
// 拍賣中顯示固定底價，實際分數是結標時用機率表現場開出來的，寫回這件商品的 points 欄位。
const AUCTION_MYSTERY_BOXES = [
  ["夜市福袋箱・招財", 350],
  ["夜市福袋箱・旺來", 350],
  ["夜市福袋箱・大吉", 400],
  ["夜市福袋箱・驚喜", 400],
];
const AUCTION_MYSTERY_MIN_INCREMENT = 30;
// weight 決定機率(總和不用是100，函式會自己算比例)，points 是開出這個等級可以拿到的分數。
// names:開出這個等級時，實際顯示的具體獎品名稱池(隨機抽一個)，取代原本只顯示「XX等級獎項」
// 這種看不出開了什麼的籠統文字。
const AUCTION_BOX_OUTCOMES = [
  { tier: "bust", name: "只有一張參加感謝小卡(雷)", weight: 10, points: 5, names: ["只有一張參加感謝小卡(雷)"] },
  {
    tier: "common",
    name: "普通等級獎項",
    weight: 40,
    points: 15,
    names: ["彈珠汽水任選一瓶", "套圈圈紀念小熊", "抓娃娃機兩次券", "棉花糖一份"],
  },
  {
    tier: "rare",
    name: "稀有等級獎項",
    weight: 30,
    points: 40,
    names: ["麻辣鴨血中份兌換券", "珍珠奶茶微糖兌換券", "限量版套圈神器", "士林大香腸一支兌換券"],
  },
  {
    tier: "epic",
    name: "史詩等級獎項",
    weight: 15,
    points: 75,
    names: ["黃金脆皮雞排兌換券", "蚵仔煎主廚特製版兌換券", "夜市街頭傳說涼麵秘技"],
  },
  {
    tier: "legendary",
    name: "傳說等級大獎！",
    weight: 5,
    points: 150,
    names: ["夜市之王的金色炸雞桶", "整條夜市免費吃三攤兌換券", "鎮攤之寶・招財貓神像"],
  },
];

function auctionRollMysteryBoxOutcome() {
  const total = AUCTION_BOX_OUTCOMES.reduce((s, o) => s + o.weight, 0);
  let r = Math.random() * total;
  for (const o of AUCTION_BOX_OUTCOMES) {
    if (r < o.weight) {
      const pool = o.names && o.names.length ? o.names : [o.name];
      const revealName = pool[Math.floor(Math.random() * pool.length)];
      return { ...o, revealName };
    }
    r -= o.weight;
  }
  const fallback = AUCTION_BOX_OUTCOMES[0];
  return { ...fallback, revealName: fallback.names[0] };
}

// 商品鑑定符要用的:福袋箱在「排程當下」就先偷偷開好結果(不是結標當下才開)，
// 這樣鑑定符才有東西可以偷看——結標時直接讀這個預先開好的結果，不是重新開一次，
// 統計上完全一樣(還是同一張機率表隨機抽)，只是把「開獎」的時間點提前而已。
function auctionPreRollMysteryBox() {
  const outcome = auctionRollMysteryBoxOutcome();
  return { tier: outcome.tier, name: outcome.revealName, points: outcome.points };
}
// 結標時如果拿得到 lot.box_pre_roll_tier(新排程的商品都會有)，就照這個 tier 去查對應分數，
// 不用整包 outcome 物件也能還原分數，用來配合「讀預先開好的結果」而不是重新 roll。
function auctionBoxOutcomeByTier(tier) {
  return AUCTION_BOX_OUTCOMES.find((o) => o.tier === tier) || AUCTION_BOX_OUTCOMES[0];
}

// 組合包:一次多件小東西綁在一起賣，適合想快速湊分的人。分數比同價位單品略高一點，當作組合優惠。
// 分數一樣改成用成交價現算(見 auctionPointsForBundlePrice)，這裡的 basePrice 只用來排底價/預告清單。
const AUCTION_BUNDLE_ITEMS = [
  { name: "夜市小物組合包(彈珠汽水+套圈圈安慰獎小熊+抓娃娃機三次券)", basePrice: 220 },
  { name: "銅板美食組合包(蔥抓餅加蛋券+木瓜牛奶特調券+剉冰配料加倍券)", basePrice: 260 },
  { name: "遊戲戰利品組合包(彈珠台紀念幣+撈金魚戰利品袋+糖葫蘆一串)", basePrice: 200 },
  { name: "消暑冰品組合包(剉冰配料加倍券+木瓜牛奶特調券+燒仙草加料吃到爽券)", basePrice: 240 },
  { name: "熱血遊戲控組合包(彈珠台紀念幣+套圈圈安慰獎小熊+抓娃娃機三次券+糖葫蘆一串)", basePrice: 380 },
  { name: "重口味鹹食組合包(蔥抓餅加蛋券+士林大香腸雙倍肉券+割包三兄弟套餐券)", basePrice: 520 },
  { name: "傳說夜市饗宴組合包(黃金脆皮雞排一世情緣券+蚵仔煎主廚特製版+棺材板隱藏內餡兌換券)", basePrice: 950 },
];
const AUCTION_BUNDLE_MIN_INCREMENT = 20;
const AUCTION_BUNDLE_BONUS = 1.25; // 組合包分數比照一般商品公式再加成，維持「組合優惠」的味道
function auctionPointsForBundlePrice(price) {
  return Math.max(5, Math.round(price * AUCTION_ITEM_SCORE_RATIO * AUCTION_BUNDLE_BONUS));
}

// 組合系列加成:湊齊一組指定的單品(横跨不同分級，故意讓玩家不能只顧著搶同一級距)，
// 結算時額外加一筆固定獎勵分數，跟「這幾件單品各自的得標分數」是分開疊加、不互相取代。
// 這跟上面的「組合包」是兩回事:組合包是單一件商品直接打包賣，這裡是要分開標到好幾件單品湊成一組。
const AUCTION_ITEM_SERIES = [
  { key: "midnight_snack", name: "宵夜控套餐", items: ["蔥抓餅加蛋券", "大腸包小腸豪華加料券", "割包三兄弟套餐券"], bonus: 150 },
  { key: "sweet_tooth", name: "甜點控套餐", items: ["糖葫蘆一串", "胡椒餅剛出爐搶先取件權", "花枝羹古早味秘傳版"], bonus: 150 },
  { key: "night_market_legend", name: "傳奇夜市迷", items: ["老闆珍藏麻辣配方", "夜市街頭傳說涼麵秘技", "老闆親筆簽名招牌"], bonus: 200 },
];
// ownedNames:某玩家目前所有得標商品(還沒退貨的)的 item_name 陣列。
// 回傳 { total, completed }:completed 是湊齊的系列清單(給UI顯示用)，total 是加總獎勵分數。
function auctionSeriesBonusForNames(ownedNames) {
  const ownedSet = new Set(ownedNames || []);
  const completed = AUCTION_ITEM_SERIES.filter((series) => series.items.every((n) => ownedSet.has(n)));
  const total = completed.reduce((s, series) => s + series.bonus, 0);
  return { total, completed };
}
// 給UI顯示「還差哪些」用:某個系列裡，這個玩家已經有的/還缺的品項名稱。
function auctionSeriesProgress(series, ownedNames) {
  const ownedSet = new Set(ownedNames || []);
  const have = series.items.filter((n) => ownedSet.has(n));
  const missing = series.items.filter((n) => !ownedSet.has(n));
  return { have, missing, complete: missing.length === 0 };
}

// 特殊券:不算稀有度分數，而是給一個能影響拍賣本身的功能。固定價位、整場限量供應(各一張)。
// key 對應 db.js 結標時要加進 auction_participants.effects 的欄位名稱。
const AUCTION_SPECIAL_ITEMS = [
  { key: "intel", name: "搶先情報券", basePrice: 400, effectDesc: "使用後永久生效:提前看到全場剩餘的完整商品清單(其他人只能看到最近幾件，連隱藏驚喜商品都不會顯示)" },
  { key: "priority", name: "插隊優先權", basePrice: 350, effectDesc: "使用後預約下一波:那一波開拍時你有 6 秒專屬優先出價時間，其他人要等時間到才能搶標" },
  { key: "refund", name: "退款保證券", basePrice: 450, effectDesc: "手上任一件已得標的商品，可以無條件退回一次，拿回一半財神幣(分數也會一起扣掉)" },
  { key: "boxDouble", name: "福袋箱翻倍券", basePrice: 400, effectDesc: "使用後，下一次你標到福袋箱時，開出的分數直接翻倍" },
  { key: "freeCommon", name: "老闆招待券", basePrice: 300, effectDesc: "免費兌換一件正在拍賣中的「普通」級商品，不用出財神幣" },
  { key: "appraise", name: "商品鑑定符", basePrice: 380, effectDesc: "使用在正在拍賣中的福袋箱上，私下看到這箱大概是哪個等級(雷/普通/稀有/史詩/傳說)，只有你自己看得到，可以再決定要不要搶標" },
];
const AUCTION_TICKET_META = {
  intel: { name: "搶先情報券", icon: "eye" },
  priority: { name: "插隊優先權", icon: "fast-forward" },
  refund: { name: "退款保證券", icon: "undo-2" },
  boxDouble: { name: "福袋箱翻倍券", icon: "package-open" },
  freeCommon: { name: "老闆招待券", icon: "hand-platter" },
  appraise: { name: "商品鑑定符", icon: "search" },
};

const AUCTION_TIER_ORDER = ["common", "rare", "epic", "legendary"];
const AUCTION_TIER_WEIGHT = { common: 0, rare: 1, epic: 2, legendary: 3, special: 2.5, mystery: 1.5, bundle: 0.5 };
const AUCTION_MIN_INCREMENT = { common: 10, rare: 20, epic: 30, legendary: 50, special: 20, mystery: 30, bundle: 20 };
const AUCTION_PRIORITY_WINDOW_SEC = 6; // 插隊優先權:專屬優先出價秒數
const AUCTION_INTEL_PREVIEW_DEFAULT = 4; // 沒有搶先情報券的人，商品預告預設只能看到幾件
const AUCTION_INTEL_PREVIEW_UNLOCKED = 24; // 用過搶先情報券之後，商品預告可以看到幾件
const AUCTION_GUESS_BONUS_CLOSE = 10; // 猜價小遊戲:猜最接近的人加幾分
const AUCTION_GUESS_BONUS_EXACT = 25; // 猜價小遊戲:剛好猜中的人加幾分
const AUCTION_SURPRISE_CHANCE = 0.05; // 隱藏驚喜商品:每件普通/稀有/史詩/傳說商品被抽中當驚喜商品的機率
const AUCTION_SURPRISE_MAX_COUNT = 2; // 隱藏驚喜商品:整場最多幾件(太多就不驚喜了)
const AUCTION_FINAL_CLOSE_DELAY_SEC = 180; // 商品全部拍賣完畢後，留幾秒緩衝(讓大家繼續打工/任務/下注花錢)，時間到系統會自動結算活動

const AUCTION_LOT_DURATION_SEC = 30; // 每件商品開拍後的初始倒數秒數
const AUCTION_ANTI_SNIPE_WINDOW_SEC = 10; // 倒數剩多少秒內加價會觸發重新計時(防偷襲)
const AUCTION_ANTI_SNIPE_EXTEND_SEC = 15; // 觸發後重新計時到剩幾秒
const AUCTION_WORK_COOLDOWN_SEC = 75; // 打工按鈕冷卻秒數
const AUCTION_WORK_MIN = 20; // 打工最少拿到
const AUCTION_WORK_MAX = 60; // 打工最多拿到
const AUCTION_COIN_TO_SCORE = 0.25; // 剩餘財神幣折算分數的比例(調低，避免「留著不花」比「參與競標」還划算)
const AUCTION_DEFAULT_BUDGET = 1000;
const AUCTION_DEFAULT_WAVE_INTERVAL_SEC = 90;
const AUCTION_DEFAULT_ITEMS_PER_WAVE = 1;
const AUCTION_PARTICIPATION_REFUND_MULT = 2; // 參與退補:出過價沒標到的人，退還「min_increment * 這個倍率」當參與獎勵

// 暗標/密封競標:一般分級商品(普通/稀有/史詩/傳說)裡，每件大約這個機率被抽成暗標——
// 大家同時盲出一個心中最高價，時間到才一起揭曉，最高價得標、付的是自己出的價(不是別人的價)，
// 拍賣進行中看不到別人出多少、只看得到「已經有幾人出價」，跟英式競標的節奏刻意做出區隔。
const AUCTION_SEALED_CHANCE = 0.15;

// 限時快閃攤:額外插進拍賣序列的商品，不佔商品上限、不用比價，用打折後的固定價格「先搶先贏」，
// 上架後很短時間內沒人搶就直接流標，穿插在正式拍賣中間製造突發的搶購感。
const AUCTION_FLASH_MIN_COUNT = 1;
const AUCTION_FLASH_MAX_COUNT = 3;
const AUCTION_FLASH_DISCOUNT = 0.6; // 搶購價 = 正常底價的這個比例
const AUCTION_FLASH_DURATION_SEC = 15; // 上架後這麼多秒沒人搶，自動流標
const AUCTION_WIN_STREAK_BONUS_START = 3; // 連續標到幾件(不含特殊券)起，下一件加成分數
const AUCTION_WIN_STREAK_BONUS_RATIO = 0.1; // 加成比例(對這件商品的分數而言)

const AUCTION_DEFAULT_ITEM_LIMIT = 28; // 本場商品上限(不含特殊券，特殊券固定全出)，用來控制活動總時長

function auctionShuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 依商品上限，從各分級/組合包/福袋箱池子「按池子大小比例」抽出一批商品，不是整包出清。
// groups:[{ key, pool }]，pool.length 當作這組的權重。回傳 { key: 抽幾件 }。
// 規則:budget 夠的話每組至少抽到1件(不會出現某個分級整場都抽不到)，剩下名額按比例分配，
// 無條件捨去後有剩的名額，依小數部分大到小、還有名額的組別依序補1件湊滿。
function auctionPickProportional(groups, budget) {
  const nonEmpty = groups.filter((g) => g.pool.length > 0);
  if (!nonEmpty.length || budget <= 0) return {};
  const totalPoolSize = nonEmpty.reduce((s, g) => s + g.pool.length, 0);
  const cappedBudget = Math.min(budget, totalPoolSize);
  const picks = {};
  const cap = {};
  nonEmpty.forEach((g) => {
    picks[g.key] = 0;
    cap[g.key] = g.pool.length;
  });
  let remaining = cappedBudget;
  auctionShuffle(nonEmpty).forEach((g) => {
    if (remaining > 0 && picks[g.key] < cap[g.key]) {
      picks[g.key] += 1;
      remaining -= 1;
    }
  });
  let guard = 0;
  while (remaining > 0 && guard < 50) {
    guard++;
    const totalPool = nonEmpty.reduce((s, g) => s + g.pool.length, 0);
    const capacity = nonEmpty.filter((g) => picks[g.key] < cap[g.key]);
    if (!capacity.length) break;
    const shares = capacity.map((g) => {
      const raw = (remaining * g.pool.length) / totalPool;
      return { key: g.key, base: Math.min(Math.floor(raw), cap[g.key] - picks[g.key]), frac: raw - Math.floor(raw) };
    });
    let addedAny = false;
    shares.forEach((s) => {
      if (s.base > 0) {
        picks[s.key] += s.base;
        remaining -= s.base;
        addedAny = true;
      }
    });
    if (remaining > 0) {
      shares.sort((a, b) => b.frac - a.frac);
      for (const s of shares) {
        if (remaining <= 0) break;
        if (picks[s.key] < cap[s.key]) {
          picks[s.key] += 1;
          remaining -= 1;
          addedAny = true;
        }
      }
    }
    if (!addedAny) break;
  }
  return picks;
}

// 產生整場拍賣的商品排程:先按商品上限「按比例」從各分級/組合包/福袋箱池子抽出這場實際會出現的商品，
// 再排序成先普通、中段稀有/史詩交錯、尾聲壓軸傳說，組合包穿插在普通附近、福袋箱穿插在中段、
// 特殊券穿插在中後段。做法是每件商品依級距給一個基準權重，加一點隨機抖動讓相鄰級距互相穿插，
// 再依權重排序，不是死板地一級距拍完才拍下一個級距。
// limit:本場商品上限(不含特殊券)，不傳或傳 0/負數就是沿用舊行為、全部商品都上場。
function buildAuctionItemSequence(limit) {
  const groups = [
    { key: "common", tier: "common", pool: auctionShuffle(AUCTION_CATALOG.common.items) },
    { key: "rare", tier: "rare", pool: auctionShuffle(AUCTION_CATALOG.rare.items) },
    { key: "epic", tier: "epic", pool: auctionShuffle(AUCTION_CATALOG.epic.items) },
    { key: "legendary", tier: "legendary", pool: auctionShuffle(AUCTION_CATALOG.legendary.items) },
    { key: "bundle", tier: "bundle", pool: auctionShuffle(AUCTION_BUNDLE_ITEMS) },
    { key: "mystery", tier: "mystery", pool: auctionShuffle(AUCTION_MYSTERY_BOXES) },
  ];
  const hasLimit = typeof limit === "number" && limit > 0;
  let picks = null;
  if (hasLimit) {
    const budget = Math.max(0, limit - AUCTION_SPECIAL_ITEMS.length);
    picks = auctionPickProportional(groups, budget);
  }
  const pickedPool = (g) => (picks ? g.pool.slice(0, picks[g.key] || 0) : g.pool);

  const pool = [];
  AUCTION_TIER_ORDER.forEach((tier) => {
    const g = groups.find((gg) => gg.tier === tier);
    pickedPool(g).forEach(([name, basePrice]) => {
      pool.push({
        itemName: name,
        itemTier: tier,
        basePrice,
        points: auctionPointsForPrice(basePrice, tier),
        minIncrement: AUCTION_MIN_INCREMENT[tier],
        specialKey: null,
        isSurprise: false,
        isSealed: Math.random() < AUCTION_SEALED_CHANCE,
        sortKey: AUCTION_TIER_WEIGHT[tier] + Math.random() * 1.6,
      });
    });
  });
  // 隱藏驚喜商品:隨機從一般分級商品裡抽幾件標記，這些不會出現在「商品預告」清單，開拍才知道
  let surpriseCount = 0;
  auctionShuffle(pool).forEach((item) => {
    if (surpriseCount >= AUCTION_SURPRISE_MAX_COUNT) return;
    if (Math.random() < AUCTION_SURPRISE_CHANCE) {
      item.isSurprise = true;
      surpriseCount++;
    }
  });
  pickedPool(groups.find((g) => g.key === "bundle")).forEach((b) => {
    pool.push({
      itemName: b.name,
      itemTier: "bundle",
      basePrice: b.basePrice,
      points: auctionPointsForBundlePrice(b.basePrice),
      minIncrement: AUCTION_MIN_INCREMENT.bundle,
      specialKey: null,
      isSurprise: false,
      sortKey: AUCTION_TIER_WEIGHT.bundle + Math.random() * 1.6,
    });
  });
  pickedPool(groups.find((g) => g.key === "mystery")).forEach(([name, basePrice]) => {
    pool.push({
      itemName: name,
      itemTier: "mystery",
      basePrice,
      points: 0, // 開箱前不知道分數，結標時 finalizeAuctionLot 會用機率表算出來寫回去
      minIncrement: AUCTION_MIN_INCREMENT.mystery,
      specialKey: null,
      isSurprise: false,
      boxPreRoll: auctionPreRollMysteryBox(), // 排程當下就先偷偷開好，給商品鑑定符看用
      sortKey: AUCTION_TIER_WEIGHT.mystery + Math.random() * 1.6,
    });
  });
  // 限時快閃攤:從普通/稀有池子「額外」多抽幾件(不佔商品上限、不跟主序列搶名額)，
  // 用打折價格＋先搶先贏的方式插進序列，穿插在中後段，製造突發的搶購感。
  const flashSourcePool = auctionShuffle([...AUCTION_CATALOG.common.items, ...AUCTION_CATALOG.rare.items]);
  const flashCount = Math.min(
    flashSourcePool.length,
    AUCTION_FLASH_MIN_COUNT + Math.floor(Math.random() * (AUCTION_FLASH_MAX_COUNT - AUCTION_FLASH_MIN_COUNT + 1))
  );
  const commonNames = new Set(AUCTION_CATALOG.common.items.map(([n]) => n));
  flashSourcePool.slice(0, flashCount).forEach(([name, basePrice]) => {
    const tier = commonNames.has(name) ? "common" : "rare";
    const flashPrice = Math.max(30, Math.round(basePrice * AUCTION_FLASH_DISCOUNT));
    pool.push({
      itemName: `⚡快閃搶購・${name}`,
      itemTier: tier,
      basePrice: flashPrice,
      points: auctionPointsForPrice(basePrice, tier), // 分數照「原價」算，價格打折，划算感才出得來
      minIncrement: AUCTION_MIN_INCREMENT[tier],
      specialKey: null,
      isSurprise: false,
      isFlash: true,
      sortKey: 1.2 + Math.random() * 1.8, // 讓快閃攤散落在中後段，不要一開場就出現
    });
  });
  // 特殊券(道具類)不參與商品上限抽選，固定全部出現
  auctionShuffle(AUCTION_SPECIAL_ITEMS).forEach((sp) => {
    pool.push({
      itemName: sp.name,
      itemTier: "special",
      basePrice: sp.basePrice,
      points: 0, // 特殊券不計分，只給功能
      minIncrement: AUCTION_MIN_INCREMENT.special,
      specialKey: sp.key,
      isSurprise: false,
      sortKey: AUCTION_TIER_WEIGHT.special + Math.random() * 1.6,
    });
  });
  pool.sort((a, b) => a.sortKey - b.sortKey);
  return pool;
}

// 把商品序列切成一波一波(每波固定件數，最後一波可能不足額)
function buildAuctionWaves(itemsPerWave, itemLimit) {
  const seq = buildAuctionItemSequence(itemLimit);
  const perWave = Math.max(1, itemsPerWave || AUCTION_DEFAULT_ITEMS_PER_WAVE);
  const waves = [];
  for (let i = 0; i < seq.length; i += perWave) {
    waves.push(seq.slice(i, i + perWave));
  }
  return waves;
}

// ---------- 夜市任務(問答／猜謎) ----------
// 「找彩蛋」在 MVP 階段沿用同一套選擇題邏輯，只是題目風格/圖示不同，
// 之後如果要做真的畫面上藏一顆可以點的彩蛋，再另外擴充。
const AUCTION_TASK_DURATION_SEC = 45; // 每題開放作答的秒數
const AUCTION_TASK_MIN_REWARD = 30;
const AUCTION_TASK_MAX_REWARD = 80;
const AUCTION_TASK_INTERVAL_SEC = 240; // 大約每隔幾秒排一題(整場時長會依此估算題數)
const AUCTION_TASK_MIN_COUNT = 2;
const AUCTION_TASK_MAX_COUNT = 8;

const AUCTION_TASK_ICON = { quiz: "circle-question-mark", riddle: "sparkles", egg: "egg" };
const AUCTION_TASK_LABEL = { quiz: "夜市問答", riddle: "夜市猜謎", egg: "夜市彩蛋" };

// 題庫:一部分是拍賣規則本身(答對還能順便搞懂遊戲怎麼玩)，一部分是原創的夜市主題猜謎。
const AUCTION_TASK_BANK = [
  { type: "quiz", q: "活動結束時，沒花完的財神幣 1 枚可以折算多少分?", options: ["0.5 分", "1 分", "2 分", "不能折算"], correct: 0 },
  { type: "quiz", q: "拍賣倒數剩最後幾秒內加價，會觸發防偷襲重新計時?", options: ["5 秒", "10 秒", "20 秒", "30 秒"], correct: 1 },
  { type: "quiz", q: "打工按鈕按一次之後，大約要等多久才能再按一次?", options: ["30 秒", "45 秒", "60 秒", "75 秒"], correct: 3 },
  { type: "quiz", q: "拍賣商品裡，哪個級距的底價通常最高?", options: ["普通", "稀有", "史詩", "傳說"], correct: 3 },
  { type: "quiz", q: "出價的時候，加價金額至少要達到多少才會成功?", options: ["任意金額都可以", "最小加價單位", "目前最高價的兩倍", "底價的一半"], correct: 1 },
  { type: "riddle", q: "謎面:全身金黃酥脆，是排隊天王，可以加辣加大，你猜是什麼?", options: ["雞排", "蚵仔煎", "大腸包小腸", "剉冰"], correct: 0 },
  { type: "riddle", q: "謎面:一鍋滾燙翻騰，加了藥材燉到骨肉分離，補身首選，你猜是什麼?", options: ["藥燉排骨", "麻辣鴨血", "燒仙草", "割包"], correct: 0 },
  { type: "riddle", q: "謎面:兩片吐司中間夾滿內餡，外型神秘像個小盒子，你猜是什麼?", options: ["棺材板", "胡椒餅", "花枝羹", "涼麵"], correct: 0 },
  { type: "riddle", q: "謎面:圓滾滾冰涼透心，配料任你選，是消暑聖品，你猜是什麼?", options: ["剉冰", "彈珠汽水", "木瓜牛奶", "珍珠奶茶"], correct: 0 },
  { type: "riddle", q: "謎面:白胖胖的身體裡包著滷肉跟酸菜，咬下去滿滿古早味，你猜是什麼?", options: ["割包", "蔥抓餅", "士林大香腸", "燒仙草"], correct: 0 },
  { type: "egg", q: "夜市彩蛋:如果想跟老闆多要一點「人情味」，通常要先做什麼?", options: ["笑著打招呼閒聊兩句", "板著臉一直殺價", "假裝沒帶錢包", "站在攤位前面滑手機"], correct: 0 },
  { type: "egg", q: "夜市彩蛋:排隊排最長的攤位，通常代表什麼?", options: ["東西大機率不錯吃", "老闆動作特別慢", "在辦活動抽獎", "純粹巧合而已"], correct: 0 },
];

function auctionTaskReward() {
  return AUCTION_TASK_MIN_REWARD + Math.floor(Math.random() * (AUCTION_TASK_MAX_REWARD - AUCTION_TASK_MIN_REWARD + 1));
}

// 依整場拍賣預估總時長抽出幾題(不重複)，平均分散在時間軸上、加一點隨機抖動，
// 回傳每題距離拍賣開始的秒數(offsetSec)，呼叫端(db.js的 startAuction)再換算成實際時間戳記寫進資料庫。
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
// 猜對:拿回雙倍下注(淨賺一個下注額);猜錯:拿回一半下注(淨虧一半下注額，無條件捨去)。
const AUCTION_LUCKY_COOLDOWN_SEC = 20; // 下注按鈕冷卻秒數，「快速」但不要讓人瘋狂連點洗財神幣
const AUCTION_LUCKY_MIN_BET = 20;
const AUCTION_LUCKY_MAX_BET = 300;

function auctionRollLuckyDie() {
  return 1 + Math.floor(Math.random() * 6);
}

function auctionLuckyOutcome(die) {
  return die >= 4 ? "big" : "small";
}

// 純計算下注結果(不碰資料庫)，db.js 的 placeAuctionLuckyBet 呼叫這個函式算出結果後再寫回財神幣。
function resolveAuctionLuckyBet(betAmount, guess) {
  const die = auctionRollLuckyDie();
  const outcome = auctionLuckyOutcome(die);
  const win = guess === outcome;
  const delta = win ? betAmount : -Math.ceil(betAmount / 2);
  return { die, outcome, win, delta };
}
