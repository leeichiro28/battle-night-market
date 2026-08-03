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

const AUCTION_TIER_ORDER = ["common", "rare", "epic", "legendary"];
const AUCTION_TIER_WEIGHT = { common: 0, rare: 1, epic: 2, legendary: 3 };
const AUCTION_MIN_INCREMENT = { common: 10, rare: 20, epic: 30, legendary: 50 };

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

// 產生整場拍賣的商品排程:先普通、中段稀有/史詩交錯、尾聲壓軸傳說。
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
        sortKey: AUCTION_TIER_WEIGHT[tier] + Math.random() * 1.6,
      });
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
