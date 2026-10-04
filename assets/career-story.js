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

  // ---------------- 今夜主題(世界觀第一階段追加) ----------------
  // 主辦人建立活動時可以挑一個主題，存在 events.rules.storyTheme。主題「只換文案」，
  // 不改任何數值。沒選或選到不認得的值就當作 normal(一般夜)，舊活動不受影響。
  //   opening:開場廣播多插的句子(插在尾巴句之前)
  //   prep   :準備期額外的廣播 { atMin, text }，跟基本廣播合併、同時間點時主題優先
  //   battle :對戰期輪播多加的句子
  //   closing:收攤文案多插的句子
  const THEMES = {
    normal: { label: "一般夜", icon: "moon-star", desc: "預設文案", opening: [], prep: [], battle: [], closing: [], pvp: { wait: [], win: [], lose: [], found: [] } },
    rain: {
      label: "雨夜", icon: "cloud-rain", desc: "攤販擠在屋簷下，擂台比較滑",
      opening: ["今天下雨，攤販都擠在屋簷下，擂台比較滑。"],
      prep: [{ atMin: 5, text: "雨越下越大，烤香腸的攤位在排隊。" }],
      battle: ["有人撐著傘在擂台邊看戲，說這樣比較不會被濺到。", "擂台有點滑，老闆說不是他故意的。"],
      closing: ["雨停了，地上的水坑裡映著還沒熄的招牌。"],
      pvp: {
        wait: ["擂台邊的人都擠在屋簷下等你們，沒人想淋雨。"],
        win: ["你踩著濕滑的擂台站穩了，觀眾在屋簷下鼓掌。"],
        lose: ["你滑了一跤。老闆遞來一條乾毛巾，說這不算丟臉。"],
        found: ["擂台上積著一層薄薄的水，對方鞋底也在打滑。"],
      },
    },
    zhongyuan: {
      label: "中元夜", icon: "ghost", desc: "今晚有點多「客人」",
      opening: ["今晚有點多「客人」，請不要跟不認識的人搭話。"],
      prep: [{ atMin: 5, text: "攤位前多擺了一碗飯，沒人敢問是給誰的。" }],
      battle: ["觀眾席好像多了幾個位子，但你數不出來是誰坐的。", "老闆說今天的冬瓜茶要多準備幾杯。"],
      closing: ["攤位前那碗飯，不知不覺空了。"],
      pvp: {
        wait: ["觀眾席上有個位子一直空著，但有人在跟它說話。"],
        win: ["掌聲比平常多了一點，而且有幾聲你分不出來源。"],
        lose: ["有人在你背後輕輕拍了一下。回頭，沒有人。"],
        found: ["對手的影子看起來比他本人多了一個。"],
      },
    },
    newyear: {
      label: "跨年夜", icon: "party-popper", desc: "人很多，倒數時請勿爬塔",
      opening: ["人很多，倒數時請勿爬塔，會被擠下來。"],
      prep: [{ atMin: 5, text: "有人在問擂台有沒有跨年倒數特別節目。老闆說有，他現在才想到。" }],
      battle: ["全場都在等倒數，連擂台上的人都瞄了一眼時鐘。", "老闆說今天打贏的人，新年第一碗雞排他請。"],
      closing: ["遠處有人在放煙火，新的一年從收攤開始。"],
      pvp: {
        wait: ["觀眾邊看擂台邊看時鐘，說打完正好倒數。"],
        win: ["全場鼓掌，有人喊「新年快樂」，雖然還沒到。"],
        lose: ["老闆說：「新的一年再贏回來。」"],
        found: ["對手說：「打完一起去看煙火？」"],
      },
    },
    typhoon: {
      label: "颱風夜", icon: "wind", desc: "風太大，但活動照常",
      opening: ["老闆說風太大了，但活動照常。招牌請自己扶好。"],
      prep: [{ atMin: 5, text: "有攤販的遮雨棚飛走了，老闆說他已經派人去追。" }],
      battle: ["風把擂台旁的旗子吹歪了，裁判說這不影響判定。", "有人拿雞排當盾牌擋風，老闆說這樣算犯規。"],
      closing: ["風漸漸小了，攤販們開始找自己的招牌。"],
      pvp: {
        wait: ["風把擂台的布條吹得啪啪響，老闆扶著麥克風架在喊話。"],
        win: ["你在強風裡站穩了，連旗子都為你歪了一下。"],
        lose: ["你被風吹得踉蹌了一步。老闆說這算天氣因素。"],
        found: ["對手的頭髮被吹成了一個很有氣勢的造型。"],
      },
    },
  };
  const THEME_ORDER = ["normal", "rain", "zhongyuan", "newyear", "typhoon"];
  function getTheme(key) {
    return THEMES[key] || THEMES.normal;
  }

  // 回傳 { icon, title, lines:[...] }，lines 是要顯示的幾句話
  // opts: { phase('not_started'|'training'|'battle'), closed, eventName, eventId, theme,
  //         trainingEndsAt, trainingMinutes, activityEndsAt }
  function phaseBanner(opts) {
    const now = Date.now();
    const theme = getTheme(opts.theme);
    if (opts.closed) {
      const closing = CLOSING_LINES.slice();
      if (theme.closing.length) closing.splice(2, 0, pickStable(theme.closing, opts.eventId));
      return { icon: "sunrise", title: "天快亮了，收攤", lines: closing };
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
        theme.opening.forEach((l) => lines.push(l));
        lines.push(tail);
        return { icon: "megaphone", title: "開場廣播", lines };
      }
      if (remainSec <= 60) {
        return { icon: "megaphone", title: "夜市廣播", lines: [PREP_LAST_MINUTE] };
      }
      const elapsedMin = elapsedSec / 60;
      let line = PREP_BROADCAST[0].text;
      // 基本廣播跟主題廣播合併，依時間排序;同一個時間點時主題的排後面(所以主題優先)
      const merged = PREP_BROADCAST.concat(theme.prep).sort((a, b) => a.atMin - b.atMin);
      merged.forEach((b) => { if (elapsedMin >= b.atMin) line = b.text; });
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
    const pool = BATTLE_BROADCAST.concat(theme.battle);
    return { icon: "megaphone", title: "夜市廣播", lines: [pool[(bucket + stableIndex(opts.eventId, pool.length)) % pool.length]] };
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
  function themePvp(themeKey, kind) {
    const t = getTheme(themeKey);
    return (t.pvp && t.pvp[kind]) || [];
  }
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

  // ---------------- 夜記(世界觀第二階段) ----------------
  // 夜記只記「玩家看過什麼」，不替劇情下結論(已定案:四個角色只標「疑似有關」、救援者不揭曉)。
  // 資料表只存 entry_key 跟看過幾次(見 supabase-schema.sql 的 career_journal)，
  // 要顯示的文字全部在這裡，之後改文案、加條目都不用動資料庫。
  //
  // entry_key 對照(由 db.js 在爬塔/結算時寫入):
  //   boss:10/20/30/40/50  打贏該層關主    npc:cloak/master/benefactor/lost_child  遇到該事件
  //   revive               倒下被救起(只記次數)   closing_bell  活動結算收攤
  const JOURNAL = {
    // 關主的名字與戰後對話直接讀 career-floors.js(CareerFloors.getFloor(n)),不在這裡重複存一份
    bossFloors: [10, 20, 30, 40, 50],
    // 四個高伏筆角色。只標「疑似有關」，不說是不是同一批人。
    people: [
      { key: "npc:cloak", icon: "hat-glasses", name: "斗笠人", note: "他出招很熟練，像在回憶什麼。" },
      { key: "npc:master", icon: "graduation-cap", name: "老師傅", note: "手續費我也要吃飯啊。" },
      { key: "npc:benefactor", icon: "hand-heart", name: "貴人", note: "他把東西塞給你就走了，沒留名字。" },
      { key: "npc:lost_child", icon: "footprints", name: "走失小孩", note: "他說爸媽在上面。你問上面是哪，他指著天花板。" },
    ],
    PEOPLE_TAG: "疑似有關",
    // 線索。from = 要先看過哪個 entry_key 才會解鎖;text 是解鎖後顯示的話(刻意只說一半)。
    clues: [
      { key: "clue:number_tag", from: "boss:10", icon: "ticket", title: "刮掉的號碼牌", hint: "某位關主會給你一樣東西。",
        text: "號碼牌背面有被刮掉的舊數字。看起來不是第一次發出去。" },
      { key: "clue:photo_half", from: "boss:30", icon: "image", title: "半張舊照片", hint: "有人遞給你一樣被撕開的東西。",
        text: "照片被撕掉了一半。留下來的這一半，有人站在邊邊，旁邊的位置是空的。" },
      { key: "clue:cloak_style", from: "npc:cloak", icon: "sword", title: "斗笠人的刀法", hint: "有個人的出招，你好像看過。",
        text: "他的出招，你好像在哪裡看過。想不起來。" },
      { key: "clue:child_point", from: "npc:lost_child", icon: "footprints", title: "走失小孩的指向", hint: "有人指了一個方向。",
        text: "他說「上面」。你抬頭，只看到天花板。" },
      { key: "clue:salt_smell", from: "revive", icon: "drumstick", title: "鹽酥雞味", hint: "倒下之後，會有一點味道。",
        text: "每次倒下，醒來身邊都沒有人，只有一股淡淡的鹽酥雞味。" },
      { key: "clue:spirit", from: "event:spirit", icon: "wand-sparkles", title: "停在身上的東西", hint: "有什麼東西在你身上停了一下。",
        text: "有什麼東西在你身上停了一下，然後離開。你不確定它是在幫你，還是在看你。" },
      { key: "clue:bell", from: "closing_bell", icon: "bell", title: "「逼」聲", hint: "要撐到天亮收攤才聽得到。",
        text: "收攤那一聲長長的「逼——」。你說不上為什麼，覺得很遠的地方，也有一個一樣的聲音。" },
    ],
    LOCKED_TITLE: "？？？",
    // 夜晚回顧(時間軸)用的一句話。boss:N 與 npc:* 的名字直接讀上面的資料,不重複存。
    RECAP_LABELS: {
      revive: "倒下之後，醒來身邊沒有人，只有一股淡淡的鹽酥雞味。",
      closing_bell: "天亮收攤，你聽見長長的一聲「逼——」。",
      "event:spirit": "有什麼東西在你身上停了一下，然後離開。",
    },
    RECAP_NO_EVENT: "一個已經回不去的夜晚",
  };

  // ---------------- 轉職演出:Lv.5 選系 / Lv.15 出師(世界觀第三節) ----------------
  // 純文字。tower.js 轉職成功時把這句放在「轉職成功」卡片上,不影響任何數值。
  // 系的 key 沿用 career-data.js 的 CAREER_TREE(strength/agility/magic),職業 key 沿用 CLASS_INFO。
  const PATH_QUOTES = {
    strength: { place: "夜市後巷的打鐵舖與烤肉攤", quote: "老闆說:「光會揮棍子不行啦。後面三條街，自己挑一條走進去。」你走進了熱得冒煙的後巷。" },
    agility: { place: "夜市中段的射擊攤與飛刀攤", quote: "老闆說:「光會揮棍子不行啦。後面三條街，自己挑一條走進去。」你擠進了人最多、也最吵的那一段。" },
    magic: { place: "夜市深處的算命攤與廟口", quote: "老闆說:「光會揮棍子不行啦。後面三條街，自己挑一條走進去。」你往最安靜、味道最奇怪的那條街走去。" },
  };
  const MASTER_QUOTES = {
    warrior: { school: "烤肉叉／打鐵舖流", quote: "「火候到了。出去別說是我教的，丟臉。」" },
    guardian: { school: "巡守隊／撞球場流", quote: "「站穩，被打也要站著。這是規矩。」" },
    archer: { school: "射擊攤流", quote: "「槍歪了就修，人歪了沒救。」" },
    assassin: { school: "飛刀攤流", quote: "「你的刀很快。所以不要對朋友用。」" },
    mage: { school: "算命攤流", quote: "「我算過了，你會贏。……騙你的，我只是想收錢。」" },
    healer: { school: "廟口中藥流", quote: "「治得了別人，先別把自己熬死。」" },
  };
  // 找不到對應的 key 就回 null,畫面端不顯示,不會出錯
  function pathQuote(pathKey) {
    return PATH_QUOTES[pathKey] || null;
  }
  function masterQuote(classKey) {
    return MASTER_QUOTES[classKey] || null;
  }

  return {
    stableIndex,
    pickStable,
    phaseBanner,
    THEMES,
    THEME_ORDER,
    getTheme,
    pickRevive,
    JOURNAL,
    pathQuote,
    masterQuote,
    // 第二個參數是今夜主題 key(可省略)，主題的 PVP 句子會「加進」基本句子池一起挑
    queueWait: (seed, theme) => pickStable(QUEUE_WAIT_LINES.concat(themePvp(theme, "wait")), seed),
    queueIdle: (seed) => pickStable(QUEUE_IDLE_LINES, seed),
    pvpFound: (seed, theme) => pickStable(PVP_FOUND_LINES.concat(themePvp(theme, "found")), seed),
    pvpWin: (seed, theme) => pickStable(PVP_WIN_LINES.concat(themePvp(theme, "win")), seed),
    pvpLose: (seed, theme) => pickStable(PVP_LOSE_LINES.concat(themePvp(theme, "lose")), seed),
    streakTitle,
  };
})();
