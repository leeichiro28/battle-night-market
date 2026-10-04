// 職業養成對決 · 劇情文案(世界觀第一階段)
//
// 對應文件:逼逼夜市_活動職業養成對決_世界觀與劇情.md
// 這支檔案只放「文字」，不碰任何數值或戰鬥邏輯。畫面要用的時候呼叫下面的函式，回傳的都是
// 純文字(插進 innerHTML 前呼叫端要自己 ui.esc())。
//
// 為什麼大部分選句子的函式是「穩定挑選」(stableIndex)而不是 Math.random():
// tower.js / career.js 每秒會重繪，如果每次重繪都重新隨機，畫面上的句子會一直跳來跳去，
// 還會害 tower.js 的「內容跟上次一樣就不重繪」判斷失效。所以用種子(活動ID、場次ID……)
// 算出一個固定的索引，同一個種子永遠挑到同一句。只有「事件發生當下」那種只會做一次的
// 地方(例如倒下的復活提示)才直接用隨機。
window.CareerStory = (function () {
  function stableIndex(seed, length) {
    const s = String(seed == null ? "" : seed);
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
    return length > 0 ? h % length : 0;
  }
  function pickStable(list, seed) {
    return list.length ? list[stableIndex(seed, list.length)] : "";
  }
  function pickRandom(list) {
    return list.length ? list[Math.floor(Math.random() * list.length)] : "";
  }

  // ---------------- 活動層級:開場 / 收攤 ----------------

  const OPENING_LINES = [
    "「逼——逼——」",
    "各位朋友大家好，這裡是逼逼夜市。",
    "如果你現在站在一個你不認得的地方，請不要驚慌，因為大家都是。",
    "告示牌寫了「閒人勿進」，你當然沒聽。沒關係，今晚的人都沒聽。",
    "擂台晚點才開張，在那之前，建議你先去爬一下塔，不然等一下會很難看。",
    "另外，三樓雞排今天比較便宜。",
  ];
  const OPENING_TAILS = [
    "提醒一下，真的會死。……應該啦。",
    "今天的鹽酥雞限量，賣完就沒了。",
    "如果看到戴斗笠的人，不要跟他搭話。……好吧，要搭也可以。",
  ];

  const NOT_STARTED_LINE = "夜市還沒開市，攤販們正在排攤位。等主辦人按下「開始活動」就會響鈴。";

  // 準備期廣播:依「已經過幾分鐘」換句，取已經達到的最後一句
  const PREP_BROADCAST = [
    { atMin: 0, text: "現在是準備時間，各位請自行暖身，受傷請找藥水攤。" },
    { atMin: 3, text: "剛剛有人問我怎麼出去。我也想知道。" },
    { atMin: 7, text: "擂台正在搭，鐵槌聲有點吵，不好意思。" },
    { atMin: 11, text: "擂台快搭好了，要買東西的趁現在。" },
  ];
  const PREP_LAST_MINUTE = "最後一分鐘!要買東西的趕快買，賣完不補貨喔。";

  const ARENA_OPEN_LINES = [
    "「逼逼逼——」",
    "舞台升起來了。老闆握著麥克風:「各位觀眾，今晚的特別節目開始!」",
    "規則很簡單:打贏的人，名字上牆;打輸的人，回去再練。",
    "還有，投降不丟臉，丟臉的是站著被打還不認輸。",
  ];
  const BATTLE_BROADCAST = [
    "觀眾席有人在小聲賭今天誰贏。",
    "老闆在擂台邊喝冬瓜茶，說他什麼都沒看到。",
    "有人在塔裡賣飲料，你要不要順便買一杯?",
    "輸了沒關係，輸了才知道哪裡該練。",
    "聽說三樓雞排還沒賣完。",
  ];
  const BATTLE_LAST_MINUTES = "剩最後幾分鐘!想上牆的趕快打，想回家的趕快想辦法。";

  const CLOSING_LINES = [
    "「逼————」長長的一聲。",
    "天邊有一點點亮，攤販們開始收東西。",
    "你手上的招式像煙一樣散掉。可是你的手臂記得怎麼出力，你的腳記得怎麼閃。",
    "老闆在擂台邊掃地，嘴裡哼著歌。他沒有看你，但你知道他知道你今晚爬了幾層。",
    "「明天見。」他說。你還沒問過他到底是誰。",
  ];

  // 回傳 { icon, title, lines:[...] }，lines 是要顯示的幾句話
  // opts: { phase('not_started'|'training'|'battle'), closed, eventName, eventId,
  //         trainingEndsAt, trainingMinutes, activityEndsAt }
  function phaseBanner(opts) {
    const now = Date.now();
    if (opts.closed) {
      return { icon: "sunrise", title: "天快亮了，收攤", lines: CLOSING_LINES };
    }
    if (opts.phase === "not_started") {
      return { icon: "store", title: "逼逼夜市・還沒開市", lines: [NOT_STARTED_LINE] };
    }
    const trainEnd = opts.trainingEndsAt ? new Date(opts.trainingEndsAt).getTime() : null;
    const actEnd = opts.activityEndsAt ? new Date(opts.activityEndsAt).getTime() : null;

    if (opts.phase === "training") {
      const minutes = opts.trainingMinutes || 15;
      const startMs = trainEnd != null ? trainEnd - minutes * 60000 : now;
      const elapsedSec = Math.max(0, (now - startMs) / 1000);
      const remainSec = trainEnd != null ? (trainEnd - now) / 1000 : Infinity;
      if (elapsedSec < 90) {
        const name = opts.eventName ? `今晚是「${opts.eventName}」。` : "";
        const tail = pickStable(OPENING_TAILS, opts.eventId);
        const lines = OPENING_LINES.slice();
        if (name) lines.splice(2, 0, name);
        lines.push(tail);
        return { icon: "megaphone", title: "開場廣播", lines };
      }
      if (remainSec <= 60) {
        return { icon: "megaphone", title: "夜市廣播", lines: [PREP_LAST_MINUTE] };
      }
      const elapsedMin = elapsedSec / 60;
      let line = PREP_BROADCAST[0].text;
      PREP_BROADCAST.forEach((b) => { if (elapsedMin >= b.atMin) line = b.text; });
      return { icon: "megaphone", title: "夜市廣播", lines: [line] };
    }

    // 對戰期
    const battleStartMs = trainEnd != null ? trainEnd : now;
    const sinceBattleSec = Math.max(0, (now - battleStartMs) / 1000);
    if (sinceBattleSec < 90) {
      return { icon: "swords", title: "擂台開張", lines: ARENA_OPEN_LINES };
    }
    const remainSec = actEnd != null ? (actEnd - now) / 1000 : Infinity;
    if (remainSec <= 300) {
      return { icon: "megaphone", title: "夜市廣播", lines: [BATTLE_LAST_MINUTES] };
    }
    // 每 3 分鐘換一句(同一個 3 分鐘區間內固定)
    const bucket = Math.floor(sinceBattleSec / 180);
    return { icon: "megaphone", title: "夜市廣播", lines: [BATTLE_BROADCAST[(bucket + stableIndex(opts.eventId, BATTLE_BROADCAST.length)) % BATTLE_BROADCAST.length]] };
  }

  // ---------------- 爬塔:倒下被救起 ----------------
  // 刻意不說是誰救的(世界觀長期伏筆)
  const REVIVE_LINES = [
    "你眼前一黑。再睜開眼時，身上多了一件不是你的外套。",
    "好像有人拍了拍你的背說:「還不行，起來。」",
    "醒來時嘴裡有一股滷肉飯的味道。你確定你沒吃過。",
    "你被什麼東西拉了一把。回頭看，什麼都沒有。",
    "醒來時身邊沒有人，只有一股淡淡的鹽酥雞味。",
  ];
  function pickRevive() {
    return pickRandom(REVIVE_LINES);
  }

  // ---------------- PVP 擂台 ----------------
  const QUEUE_WAIT_LINES = [
    "觀眾席有人喊:「押那個戴帽子的!」",
    "老闆在麥克風裡說:「對手馬上到，請稍等。」",
    "你在擂台邊暖身，旁邊有人遞來一串烤香腸。",
  ];
  const QUEUE_IDLE_LINES = [
    "對手跟你一樣，都是今晚誤闖的人。打完記得握手。",
    "擂台下有人一邊吃雞排一邊下注。",
  ];
  const PVP_WIN_LINES = [
    "觀眾席爆出掌聲，有人把雞排扔上擂台。",
    "老闆在麥克風裡說:「這個可以。」",
  ];
  const PVP_LOSE_LINES = [
    "你坐在擂台邊，有人遞給你一杯冬瓜茶。",
    "老闆:「輸了沒關係，輸了才知道哪裡該練。」",
  ];
  const PVP_FOUND_LINES = [
    "對手:一位剛才還在買雞排的人。",
    "對方緊張地搓了搓手，看起來比你還緊張。",
  ];
  // 連勝稱號(有達標才有，只用在顯示文字)
  const STREAK_TITLES = [
    { min: 10, title: "請不要再贏了" },
    { min: 7, title: "夜市話題人物" },
    { min: 5, title: "擂台常客" },
    { min: 3, title: "今晚的黑馬" },
  ];
  function streakTitle(streak) {
    const hit = STREAK_TITLES.find((t) => (streak || 0) >= t.min);
    return hit ? hit.title : "";
  }

  return {
    stableIndex,
    pickStable,
    phaseBanner,
    pickRevive,
    queueWait: (seed) => pickStable(QUEUE_WAIT_LINES, seed),
    queueIdle: (seed) => pickStable(QUEUE_IDLE_LINES, seed),
    pvpFound: (seed) => pickStable(PVP_FOUND_LINES, seed),
    pvpWin: (seed) => pickStable(PVP_WIN_LINES, seed),
    pvpLose: (seed) => pickStable(PVP_LOSE_LINES, seed),
    streakTitle,
  };
})();
