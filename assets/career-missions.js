// 職業養成對決:每場任務。任務清單、完成條件、獎勵都集中在這個檔案,之後要加/調任務只改這裡。
//
// 進度怎麼算:
//   - 樓層、PVP 勝場等「本來就有紀錄」的直接讀 career_progress / career_pvp_queue
//   - 打贏場數、合成成功次數、遇過幾種事件這類沒有紀錄的,存在 career_progress.mission_state.counters
//   - 已經領過的存在 mission_state.claimed;領到的任務積分存在 career_progress.mission_score
// 任務積分總上限 SCORE_CAP,避免任務分壓過 PVP 與爬塔(各任務加起來約 47)。
// 防洗分:對機器人的對戰不會增加 PVP 勝場(資料庫結算時略過);對手掛網棄權的勝利不算連勝、不算「不速之客」。
(function () {
  const SCORE_CAP = 50;
  const GROUPS = {
    climb: { label: "爬塔", icon: "mountain" },
    pvp: { label: "PVP 擂台", icon: "swords" },
    craft: { label: "養成", icon: "hammer" },
    explore: { label: "探索", icon: "compass" },
  };
  const GROUP_ORDER = ["climb", "pvp", "craft", "explore"];

  const counter = (name) => (c) => (c.counters && c.counters[name]) || 0;
  const MISSIONS = [
    { key: "floor10", group: "climb", name: "初出茅廬", desc: "清到 10 層", target: 10, value: (c) => c.progress.floor || 0, reward: { coins: 50 } },
    { key: "floor30", group: "climb", name: "小有名氣", desc: "清到 30 層", target: 30, value: (c) => c.progress.floor || 0, reward: { statPoints: 1, score: 3 } },
    { key: "floor50", group: "climb", name: "登高望遠", desc: "清到 50 層", target: 50, value: (c) => c.progress.floor || 0, reward: { score: 8 } },
    { key: "floor70", group: "climb", name: "塔心", desc: "清到 70 層", target: 70, value: (c) => c.progress.floor || 0, reward: { score: 12 }, available: () => !!(window.CareerFloors && window.CareerFloors.FLOORS.length >= 70) },
    { key: "pve100", group: "climb", name: "百戰百勝", desc: "累計打贏 100 場樓層戰鬥(含掛機)", target: 100, value: counter("pveWins"), reward: { score: 3 } },
    { key: "pvp1", group: "pvp", name: "擂台新人", desc: "贏 1 場對真人的 PVP", target: 1, value: (c) => c.queue.wins || 0, reward: { score: 2 } },
    { key: "streak3", group: "pvp", name: "連戰連勝", desc: "PVP 連勝 3 場", target: 3, value: (c) => c.queue.best_streak || 0, reward: { score: 5 } },
    { key: "beatHigher", group: "pvp", name: "不速之客", desc: "贏過總積分比自己高的對手", target: 1, value: (c) => c.queue.beat_higher || 0, reward: { score: 4 } },
    { key: "pvp7", group: "pvp", name: "七戰七捷", desc: "累計 PVP 勝 7 場", target: 7, value: (c) => c.queue.wins || 0, reward: { score: 6 } },
    { key: "synth1", group: "craft", name: "手藝人", desc: "合成成功 1 次", target: 1, value: counter("synthSuccess"), reward: { coins: 300 } },
    {
      key: "fullGear", group: "craft", name: "裝備齊全", desc: "三個部位都穿上稀有以上的裝備", target: 3,
      value: (c) => ["weapon", "armor", "accessory"].filter((s) => { const it = c.progress.equipment && c.progress.equipment[s]; return it && ["rare", "epic", "legendary"].includes(it.rarity); }).length,
      reward: { score: 2 },
    },
    { key: "events5", group: "explore", name: "夜市散步", desc: "遇到 5 種不同的夜市事件", target: 5, value: (c) => Object.keys((c.counters && c.counters.eventsSeen) || {}).length, reward: { skillPoints: 1, score: 2 } },
  ];

  function get(key) {
    return MISSIONS.find((m) => m.key === key) || null;
  }
  function ctxFrom(progress, queue) {
    const state = (progress && progress.mission_state) || {};
    return { progress: progress || {}, queue: queue || {}, counters: state.counters || {}, claimed: state.claimed || {} };
  }
  function status(mission, ctx) {
    const value = Math.min(mission.target, Math.max(0, mission.value(ctx) || 0));
    return { value, target: mission.target, done: value >= mission.target, claimed: !!ctx.claimed[mission.key] };
  }
  function visible(ctx) {
    return MISSIONS.filter((m) => !m.available || m.available(ctx));
  }
  function claimableCount(ctx) {
    return visible(ctx).filter((m) => { const s = status(m, ctx); return s.done && !s.claimed; }).length;
  }
  function rewardText(m) {
    const r = m.reward || {};
    const parts = [];
    if (r.coins) parts.push(`${r.coins} 幣`);
    if (r.statPoints) parts.push(`${r.statPoints} 數值點`);
    if (r.skillPoints) parts.push(`${r.skillPoints} 技能點`);
    if (r.score) parts.push(`+${r.score} 排行分`);
    return parts.join("、");
  }

  // ---- 進度計數(回傳新的 mission_state,不改原物件) ----
  function bump(state, name, n) {
    const s = state || {};
    const counters = { ...(s.counters || {}) };
    counters[name] = (counters[name] || 0) + (n || 1);
    return { ...s, counters };
  }
  function noteSeen(state, setName, key) {
    const s = state || {};
    const counters = { ...(s.counters || {}) };
    const set = { ...(counters[setName] || {}) };
    if (set[key]) return s; // 已經記過,不用寫資料庫
    set[key] = true;
    counters[setName] = set;
    return { ...s, counters };
  }

  window.CareerMissions = { SCORE_CAP, GROUPS, GROUP_ORDER, MISSIONS, get, ctxFrom, status, visible, claimableCount, rewardText, bump, noteSeen };
})();
