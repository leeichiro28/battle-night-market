// 職業養成對決:成就與圖鑑。清單、條件、稱號門檻都集中在這個檔案,之後要加/調只改這裡。
//
// 規則(2026-10-24 定案):成就與圖鑑都是「永久」的,記在玩家帳號上(資料表 career_codex),跨活動累積,
// 不是每場重來。成就不加排行分、不給幣;獎勵是「累計到某個數量給稱號」(見 COUNT_TITLES)。
//
// 資料怎麼存(資料表 career_codex,kind 欄位):
//   ach 成就  mon 怪物(key=樓層數,times=打贏幾次)  item 裝備(key=名稱)  event 夜市事件(key=事件 key)
//   stat 永久累計數字(pveWins/pvpWins/synthSuccess/synthLegend/revive)
// 成就條件讀 ctx:
//   ctx.p     目前這場活動的 career_progress(樓層、等級、裝備、已擁有傳說、任務領取狀態)
//   ctx.stat  永久累計數字   ctx.set  圖鑑已收集的數量 { mon, item, event }   ctx.cat 圖鑑總數
//   ctx.ev    已遇過的事件 key 集合   ctx.pvp  剛打完的那場 PVP { won, winStreak }(平常是 null)
(function () {
  const RARE_UP = ["rare", "epic", "legendary"];
  const eqRarities = (p) => ["weapon", "armor", "accessory"].map((s) => p.equipment && p.equipment[s] && p.equipment[s].rarity);
  const allSlots = (p, rarities) => eqRarities(p).every((r) => r && rarities.includes(r));
  const setWorn = (p, setKey) => ["weapon", "armor", "accessory"].every((s) => p.equipment && p.equipment[s] && p.equipment[s].setKey === setKey);
  const floor = (p) => p.floor || 0;
  const stat = (c, k) => (c.stat && c.stat[k]) || 0;

  const GROUPS = {
    climb: { label: "爬塔", icon: "mountain" },
    pvp: { label: "PVP 擂台", icon: "swords" },
    craft: { label: "養成與裝備", icon: "hammer" },
    explore: { label: "探索與圖鑑", icon: "compass" },
    secret: { label: "隱藏", icon: "eye-off" },
  };
  const GROUP_ORDER = ["climb", "pvp", "craft", "explore", "secret"];

  // hidden = true 的成就達成前顯示「？？？」,連條件都不說。
  const ACHIEVEMENTS = [
    // ---- 爬塔 ----
    { key: "floor10", group: "climb", icon: "ticket", name: "逛到第十攤", desc: "清到 10 層", test: (c) => floor(c.p) >= 10 },
    { key: "floor20", group: "climb", icon: "ticket", name: "走進深處", desc: "清到 20 層", test: (c) => floor(c.p) >= 20 },
    { key: "floor30", group: "climb", icon: "ticket", name: "廟口熟客", desc: "清到 30 層", test: (c) => floor(c.p) >= 30 },
    { key: "floor40", group: "climb", icon: "crown", name: "見過夜市之王", desc: "清到 40 層", test: (c) => floor(c.p) >= 40 },
    { key: "floor50", group: "climb", icon: "mountain", name: "站到夜市之神面前", desc: "清到 50 層", test: (c) => floor(c.p) >= 50 },
    { key: "floor60", group: "climb", icon: "image", name: "拼起來的照片", desc: "清到 60 層", test: (c) => floor(c.p) >= 60 },
    { key: "floor70", group: "climb", icon: "mountain", name: "摸到塔頂", desc: "清到 70 層", test: (c) => floor(c.p) >= 70 },
    { key: "pve100", group: "climb", icon: "swords", name: "打到手軟", desc: "累計打贏 100 場樓層戰鬥(含掛機，跨活動)", test: (c) => stat(c, "pveWins") >= 100, progress: (c) => stat(c, "pveWins"), target: 100 },
    { key: "pve1000", group: "climb", icon: "swords", name: "樓層常客", desc: "累計打贏 1,000 場樓層戰鬥", test: (c) => stat(c, "pveWins") >= 1000, progress: (c) => stat(c, "pveWins"), target: 1000 },
    { key: "pve5000", group: "climb", icon: "house", name: "塔裡的住戶", desc: "累計打贏 5,000 場樓層戰鬥", test: (c) => stat(c, "pveWins") >= 5000, progress: (c) => stat(c, "pveWins"), target: 5000 },
    // ---- PVP ----
    { key: "pvp1", group: "pvp", icon: "swords", name: "第一場擂台", desc: "贏 1 場對真人的 PVP", test: (c) => stat(c, "pvpWins") >= 1 },
    { key: "pvp10", group: "pvp", icon: "swords", name: "擂台熟面孔", desc: "累計贏 10 場對真人的 PVP", test: (c) => stat(c, "pvpWins") >= 10, progress: (c) => stat(c, "pvpWins"), target: 10 },
    { key: "pvp50", group: "pvp", icon: "trophy", name: "擂台老油條", desc: "累計贏 50 場對真人的 PVP", test: (c) => stat(c, "pvpWins") >= 50, progress: (c) => stat(c, "pvpWins"), target: 50 },
    { key: "streak5", group: "pvp", icon: "flame", name: "五連勝", desc: "PVP 連勝 5 場", test: (c) => !!(c.pvp && c.pvp.won && c.pvp.winStreak >= 5) },
    { key: "streak10", group: "pvp", icon: "flame", name: "連贏十場", desc: "PVP 連勝 10 場", test: (c) => !!(c.pvp && c.pvp.won && c.pvp.winStreak >= 10) },
    // ---- 養成與裝備 ----
    { key: "synth1", group: "craft", icon: "hammer", name: "敲敲打打", desc: "合成成功 1 次", test: (c) => stat(c, "synthSuccess") >= 1 },
    { key: "synth10", group: "craft", icon: "hammer", name: "合成老手", desc: "累計合成成功 10 次", test: (c) => stat(c, "synthSuccess") >= 10, progress: (c) => stat(c, "synthSuccess"), target: 10 },
    { key: "synthLegend", group: "craft", icon: "sparkles", name: "點石成金", desc: "合成出 1 件傳說裝備", test: (c) => stat(c, "synthLegend") >= 1 },
    { key: "lv30", group: "craft", icon: "chevrons-up", name: "小有資歷", desc: "任何一場活動升到 Lv.30", test: (c) => (c.p.level || 1) >= 30 },
    { key: "lv50", group: "craft", icon: "chevrons-up", name: "半百夜客", desc: "任何一場活動升到 Lv.50", test: (c) => (c.p.level || 1) >= 50 },
    { key: "lv100", group: "craft", icon: "chevrons-up", name: "百級之上", desc: "任何一場活動升到 Lv.100", test: (c) => (c.p.level || 1) >= 100 },
    { key: "gearRare", group: "craft", icon: "shirt", name: "行頭整齊", desc: "三個部位同時穿稀有以上的裝備", test: (c) => allSlots(c.p, RARE_UP) },
    { key: "gearEpic", group: "craft", icon: "shirt", name: "一身史詩", desc: "三個部位同時穿史詩以上的裝備", test: (c) => allSlots(c.p, ["epic", "legendary"]) },
    { key: "legend1", group: "craft", icon: "crown", name: "傳說在手", desc: "擁有過 1 件傳說裝備", test: (c) => Object.keys(c.p.legendary_slots || {}).length >= 1 },
    { key: "set40", group: "craft", icon: "crown", name: "夜市之王的全套行頭", desc: "同時穿上夜市之王套裝三件", test: (c) => setWorn(c.p, "boss40") },
    { key: "set50", group: "craft", icon: "crown", name: "終極隱藏關主的全套行頭", desc: "同時穿上終極隱藏關主套裝三件", test: (c) => setWorn(c.p, "boss50") },
    // ---- 探索與圖鑑 ----
    { key: "event10", group: "explore", icon: "compass", name: "老饕", desc: "遇過 10 種夜市事件(跨活動累計)", test: (c) => c.set.event >= 10, progress: (c) => c.set.event, target: 10 },
    { key: "eventAll", group: "explore", icon: "map", name: "夜市百事通", desc: "遇過全部夜市事件", test: (c) => c.cat.event > 0 && c.set.event >= c.cat.event, progress: (c) => c.set.event, target: (c) => c.cat.event },
    { key: "monHalf", group: "explore", icon: "book-open", name: "怪物愛好者", desc: "怪物圖鑑收集過半", test: (c) => c.cat.mon > 0 && c.set.mon * 2 >= c.cat.mon, progress: (c) => c.set.mon, target: (c) => Math.ceil(c.cat.mon / 2) },
    { key: "monAll", group: "explore", icon: "book-marked", name: "怪物博士", desc: "怪物圖鑑全部收集", test: (c) => c.cat.mon > 0 && c.set.mon >= c.cat.mon, progress: (c) => c.set.mon, target: (c) => c.cat.mon },
    { key: "itemHalf", group: "explore", icon: "package-open", name: "裝備收藏家", desc: "裝備圖鑑收集過半", test: (c) => c.cat.item > 0 && c.set.item * 2 >= c.cat.item, progress: (c) => c.set.item, target: (c) => Math.ceil(c.cat.item / 2) },
    // ---- 隱藏 ----
    { key: "revive1", group: "secret", hidden: true, icon: "heart-pulse", name: "有人在看著", desc: "第一次倒下又被救起", test: (c) => stat(c, "revive") >= 1 },
    { key: "revive10", group: "secret", hidden: true, icon: "heart-pulse", name: "老是被救起", desc: "累計被救起 10 次", test: (c) => stat(c, "revive") >= 10, progress: (c) => stat(c, "revive"), target: 10 },
    { key: "fourPeople", group: "secret", hidden: true, icon: "hat-glasses", name: "疑似有關", desc: "遇過斗笠人、老師傅、貴人與走失小孩", test: (c) => ["sparring", "reclass", "benefactor", "lost_child"].every((k) => c.ev[k]) },
    { key: "allMissions", group: "secret", hidden: true, icon: "list-checks", name: "全勤", desc: "一場活動內領完所有開放的任務獎勵", test: (c) => !!c.missionsAllClaimed },
    { key: "rich", group: "secret", hidden: true, icon: "coins", name: "財神爺", desc: "一場活動內同時持有 10,000 幣", test: (c) => (c.p.coins || 0) >= 10000 },
    { key: "allDone", group: "secret", hidden: true, icon: "award", name: "集滿的人", desc: "達成其他所有成就", test: (c) => c.achDoneOthers },
  ];

  // 獎勵:累計到某個數量給稱號。稱號資料在 db.js 的 TITLE_CATALOG(key 要一致)。
  // achievements = 已達成的成就數;codex = 圖鑑已收集的條目數(怪物+裝備+事件)。
  const COUNT_TITLES = [
    { type: "ach", need: 10, title: "codex_ach10" },
    { type: "ach", need: 20, title: "codex_ach20" },
    { type: "ach", need: "all", title: "codex_ach_all" },
    { type: "codex", need: "half", title: "codex_half" },
    { type: "codex", need: "all", title: "codex_all" },
  ];

  // ---- 圖鑑目錄(直接讀遊戲本體,新增樓層/裝備時自動跟著變多) ----
  function monsterCatalog() {
    const CF = window.CareerFloors;
    return CF.FLOORS.map((f) => ({ key: String(f.floor), floor: f.floor, name: f.name, isBoss: !!f.isMiniBoss }));
  }
  // 裝備:每個名字一筆。group = 職業 key(武器依職業)或 "all"(防具/飾品)
  function itemCatalog() {
    const CF = window.CareerFloors;
    const seen = {};
    const out = [];
    const add = (name, rarity, slot, group, extra) => {
      if (!name || seen[name]) return;
      seen[name] = true;
      out.push({ key: name, name, rarity, slot, group, ...extra });
    };
    Object.keys(CF.WEAPON_TABLE).forEach((cls) => {
      CF.RARITIES.forEach((r) => (CF.WEAPON_TABLE[cls][r] || []).forEach((it) => add(it.name, r, "weapon", cls)));
    });
    Object.keys(CF.EQUIPMENT_TABLE).forEach((slot) => {
      CF.RARITIES.forEach((r) => (CF.EQUIPMENT_TABLE[slot][r] || []).forEach((it) => add(it.name, r, slot, "all")));
    });
    // 51 層以後的階級裝備(招牌階/塔心階)
    [2, 3].forEach((tier) => {
      Object.keys(CF.WEAPON_TABLE_TIER[tier]).forEach((cls) => CF.RARITIES.forEach((r) => (CF.WEAPON_TABLE_TIER[tier][cls][r] || []).forEach((it) => add(it.name, r, "weapon", cls, { tier }))));
      Object.keys(CF.EQUIPMENT_TABLE_TIER[tier]).forEach((slot) => CF.RARITIES.forEach((r) => (CF.EQUIPMENT_TABLE_TIER[tier][slot][r] || []).forEach((it) => add(it.name, r, slot, "all", { tier }))));
    });
    Object.keys(CF.BOSS_LEGENDARY_ITEMS).forEach((fl) => {
      const set = CF.BOSS_LEGENDARY_ITEMS[fl];
      Object.keys(set).forEach((slot) => {
        if (slot === "weapon") {
          Object.keys((CF.BOSS_WEAPON_NAMES[fl] || {})).forEach((cls) => add(CF.BOSS_WEAPON_NAMES[fl][cls], "legendary", "weapon", cls, { bossFloor: Number(fl) }));
        } else {
          add(set[slot].name, "legendary", slot, "all", { bossFloor: Number(fl) });
        }
      });
    });
    return out;
  }
  function eventCatalog() {
    return (window.CareerEvents ? window.CareerEvents.EVENTS : []).map((e) => ({ key: e.key, name: e.name, icon: e.icon }));
  }
  let _cat = null;
  function catalog() {
    if (!_cat) _cat = { mon: monsterCatalog(), item: itemCatalog(), event: eventCatalog() };
    return _cat;
  }
  function totals() {
    const c = catalog();
    return { mon: c.mon.length, item: c.item.length, event: c.event.length };
  }

  function get(key) {
    return ACHIEVEMENTS.find((a) => a.key === key) || null;
  }

  // 輕量提示(右下角浮出幾秒)。需要 ui.esc / ui.icon;沒有就略過,不影響遊戲。
  function toast(html) {
    try {
      let box = document.getElementById("codex-toasts");
      if (!box) {
        box = document.createElement("div");
        box.id = "codex-toasts";
        box.className = "codex-toasts";
        document.body.appendChild(box);
      }
      const el = document.createElement("div");
      el.className = "codex-toast";
      el.innerHTML = html;
      box.appendChild(el);
      setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 400); }, 5000);
    } catch (e) {}
  }
  function unlockToast(a) {
    const u = typeof ui !== "undefined" ? ui : null;
    if (!u) return;
    toast(`${u.icon("award")}<div><b>成就達成</b><br/>${u.esc(a.name)}<div class="codex-toast-sub">${u.esc(a.desc)}</div></div>`);
  }
  function titleToast(name) {
    const u = typeof ui !== "undefined" ? ui : null;
    if (!u) return;
    toast(`${u.icon("crown")}<div><b>獲得稱號</b><br/>${u.esc(name)}</div>`);
  }

  window.CareerCodex = { GROUPS, GROUP_ORDER, ACHIEVEMENTS, COUNT_TITLES, get, catalog, totals, unlockToast, titleToast };
})();
