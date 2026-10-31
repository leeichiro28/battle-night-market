// 職業養成對決:今夜主題的「真規則」與「時段事件」。
// 以前「主題只換文案、不改任何數值」,現在每個主題帶一條實際規則;另外整場 60 分鐘內固定有幾個
// 限時的全場加成(時段事件),用夜市廣播風格宣布。全部是「依活動經過的時間算」,不用新增資料表。
//
// 可以調整的數字都在這個檔案最上面。注意:「擂台加碼」的時間與倍率在資料庫函式 finish_career_match
// (migration-pvp-afk-and-score.sql)裡也有一份,改的時候兩邊要一起改。
//
// 效果欄位(mods):
//   expMult / coinMult   經驗、幣的倍率
//   dropChanceAdd        掉落機率直接加(例如 0.1 = +10%)
//   monsterHpMult / monsterAtkMult  怪物 HP、攻擊(含魔攻)的倍率
//   pvpScoreMult         PVP 積分倍率(由資料庫結算時套用)
(function () {
  const ACTIVITY_MINUTES = 60; // 整場活動長度,要跟 db.js 的 CAREER_ACTIVITY_TOTAL_MINUTES 一致

  // ---- 今夜主題的規則(存在 events.rules.storyTheme,沒選或一般夜 = 沒有任何加成) ----
  const THEME_MODS = {
    rain: { mods: { dropChanceAdd: 0.1, monsterHpMult: 1.1 }, text: "掉落率 +10%、怪物 HP +10%", line: "擂台很滑，怪物也站不穩，但躲雨的人都在地上撿東西。" },
    zhongyuan: { mods: { monsterHpMult: 1.15, monsterAtkMult: 1.15, dropChanceAdd: 0.15, coinMult: 1.1 }, text: "怪物 HP/攻擊 +15%、掉落率 +15%、幣 +10%", line: "今晚的「客人」特別多，打起來很痛，但他們出手大方。" },
    newyear: { mods: { coinMult: 1.5 }, text: "幣 ×1.5", line: "人潮多、紅包也多，今晚賺錢特別快。" },
    typhoon: { mods: { expMult: 1.2, monsterAtkMult: 1.1 }, text: "經驗 ×1.2、怪物攻擊 +10%", line: "風大浪大，打得辛苦，但練起來特別快。" },
  };

  // ---- 時段事件:從活動開始(activityEndsAt 往前推 60 分鐘)算起的第幾分鐘 ----
  const WINDOWS = [
    { key: "fortune", label: "發財時段", icon: "coins", startMin: 20, endMin: 28, mods: { coinMult: 2 }, text: "幣 ×2", open: "老闆說這幾分鐘不收攤位費，錢隨便賺。", close: "發財時段結束了，老闆說攤位費從現在開始照收。" },
    { key: "arena", label: "擂台加碼", icon: "swords", startMin: 33, endMin: 41, mods: { pvpScoreMult: 1.5 }, text: "PVP 積分 ×1.5", open: "擂台的燈全開了，這幾分鐘打贏的人分數加碼。", close: "擂台的燈關了一半，加碼時間結束。" },
    { key: "riot", label: "怪物暴動", icon: "flame", startMin: 46, endMin: 54, mods: { monsterHpMult: 1.2, monsterAtkMult: 1.2, dropChanceAdd: 0.2 }, text: "怪物 HP/攻擊 +20%、掉落率 +20%", open: "塔裡有東西吵醒了，打起來很痛，但他們身上掉的東西更好。", close: "塔裡安靜下來了，剛剛那群東西好像回去睡了。" },
  ];

  // ---- 輪替擂台規則:PVP 開放後(第 PVP_START_MIN 分鐘起)每 ARENA_ROTATE_MIN 分鐘換一個規則,照順序循環 ----
  // 規則是「配對成立那一刻」依活動經過時間決定,寫進這場對戰的 state.arenaRule,整場固定
  // (兩邊玩家看到的規則一定一樣,打到一半換時段也不會變)。要新增規則:加一筆 ARENA_RULES,
  // 並在 career-engine.js(招式限制)或 db.js initializeCareerMatch(數值)實作效果。
  const PVP_START_MIN = 15; // 要跟 db.js 的準備時間(15 分鐘)一致
  const ARENA_ROTATE_MIN = 10;
  const COMPRESS_RATIO = 0.5; // 雙方數值差距縮小到一半(往兩人平均靠攏)
  const ARENA_RULES = [
    { key: "standard", label: "標準擂台", icon: "swords", text: "沒有特殊限制", line: "今天的擂台照老規矩打。" },
    { key: "noult", label: "禁大招擂台", icon: "flame-kindling", text: "這一場不能放大招", line: "擂台中央貼了張紙:「本場禁止大招，違者罰站。」" },
    { key: "compress", label: "勢均力敵擂台", icon: "scale", text: "雙方 HP/攻/防/速差距縮小一半", line: "裁判拿著天秤站在中間，把兩邊的差距都削掉一半。" },
    { key: "limited", label: "限定技能擂台", icon: "lock", text: "只能用普攻和技能A(技能B、大招封印)", line: "擂台邊的櫃子上了鎖，裡面的招式今天不開放。" },
  ];
  function arenaRuleAt(rules, now) {
    const m = elapsedMin(rules, now);
    if (m == null || m < PVP_START_MIN) return ARENA_RULES[0];
    const idx = Math.floor((m - PVP_START_MIN) / ARENA_ROTATE_MIN) % ARENA_RULES.length;
    return ARENA_RULES[idx];
  }
  function arenaRuleByKey(key) {
    return ARENA_RULES.find((r) => r.key === key) || ARENA_RULES[0];
  }
  // 目前規則 + 距離下次換規則的秒數
  function arenaInfo(rules, now) {
    const m = elapsedMin(rules, now);
    const cur = arenaRuleAt(rules, now);
    if (m == null) return { rule: cur, next: ARENA_RULES[0], changeInSec: null };
    const t = Math.max(m, PVP_START_MIN);
    const slot = Math.floor((t - PVP_START_MIN) / ARENA_ROTATE_MIN);
    const changeInSec = Math.max(0, Math.round((PVP_START_MIN + (slot + 1) * ARENA_ROTATE_MIN - m) * 60));
    return { rule: cur, next: ARENA_RULES[(slot + 1) % ARENA_RULES.length], changeInSec };
  }
  // 雙方數值壓縮:往兩人平均靠攏。只壓雙方都有的數值(例如攻擊力,只有一邊是 0 時不動,避免法師憑空長出物攻)
  function compressStats(s1, s2, ratio) {
    const r = ratio == null ? COMPRESS_RATIO : ratio;
    const out1 = { ...s1 }, out2 = { ...s2 };
    ["maxHp", "atk", "matk", "def", "spd"].forEach((k) => {
      const a = s1[k] || 0, b = s2[k] || 0;
      if (a <= 0 || b <= 0) return;
      const mean = (a + b) / 2;
      out1[k] = Math.max(1, Math.round(mean + (a - mean) * r));
      out2[k] = Math.max(1, Math.round(mean + (b - mean) * r));
    });
    return [out1, out2];
  }
  // PVP 頁用的橫幅:目前擂台規則(含倒數)與下一個規則
  function arenaBannerHtml(rules, now) {
    const u = typeof ui !== "undefined" ? ui : null;
    if (!u || !rules || !rules.activityEndsAt) return "";
    const info = arenaInfo(rules, now);
    const sec = info.changeInSec;
    return `<div style="padding:8px 12px;margin-bottom:12px;border-radius:var(--radius);background:var(--panel2);border:1px dashed var(--gold-d);">
      <p style="margin:0 0 3px;font-size:12px;overflow-wrap:anywhere;">${u.icon(info.rule.icon, { size: "14px" })}<b style="color:var(--gold);">目前擂台:${u.esc(info.rule.label)}</b>・${u.esc(info.rule.text)}${sec != null ? `(${fmtClock(sec)} 後換成${u.esc(info.next.label)})` : ""}</p>
      <p style="margin:0;font-size:12px;color:var(--ink-dim);font-style:italic;overflow-wrap:anywhere;">${u.esc(info.rule.line)}配對成立當下的規則，整場固定。</p>
    </div>`;
  }

  // ---- 全服 Boss「打烊鐘」(夜市大戰):活動第 30 分鐘出現,存在 15 分鐘,被打倒就提早結束 ----
  // 血量、冷卻、獎勵在資料庫(spawn/deal/claim_career_world_boss);這裡只放時程與 Boss 的戰鬥屬性。
  // 屬性用 tools/sim.js worldboss 校準:攻擊 = 70 層 Boss ×0.2、防禦 ×0.4,讓各等級玩家都能撐滿 15 回合左右,
  // 傷害才反映玩家強度(單次出擊約 Lv.10:170、Lv.50:1,200、Lv.100:2,300)。血量無限大,只量傷害。
  const WORLD_BOSS = {
    startMin: 30, durationMin: 15, rounds: 15, cooldownSec: 30, name: "打烊鐘",
    stats: { atk: 28, matk: 28, def: 28, spd: 21, luck: 14, hp: 1e9, maxHp: 1e9 },
    classKey: "warrior",
  };
  // 目前處在哪個階段:before(還沒出現)/ active(可以打)/ after(已經結束);endsAt 是 Boss 消失的時間(ISO)
  function worldBossWindow(rules, now) {
    const s = startMs(rules);
    if (s == null) return { phase: "none" };
    const t = now == null ? Date.now() : now;
    const spawnAt = s + WORLD_BOSS.startMin * 60000;
    const endAt = spawnAt + WORLD_BOSS.durationMin * 60000;
    const phase = t < spawnAt ? "before" : t < endAt ? "active" : "after";
    return {
      phase, spawnAt, endAt, endsAtIso: new Date(endAt).toISOString(),
      startsInSec: Math.max(0, Math.round((spawnAt - t) / 1000)), remainSec: Math.max(0, Math.round((endAt - t) / 1000)),
    };
  }

  function startMs(rules) {
    if (!rules || !rules.activityEndsAt) return null;
    return new Date(rules.activityEndsAt).getTime() - ACTIVITY_MINUTES * 60000;
  }
  function elapsedMin(rules, now) {
    const s = startMs(rules);
    return s == null ? null : ((now == null ? Date.now() : now) - s) / 60000;
  }
  // 目前正在進行的時段事件:{ window, remainSec } 或 null
  function currentWindow(rules, now) {
    const m = elapsedMin(rules, now);
    if (m == null) return null;
    const w = WINDOWS.find((x) => m >= x.startMin && m < x.endMin);
    return w ? { window: w, remainSec: Math.max(0, Math.round((w.endMin - m) * 60)) } : null;
  }
  // 下一個還沒開始的時段事件:{ window, startInSec } 或 null
  function nextWindow(rules, now) {
    const m = elapsedMin(rules, now);
    if (m == null) return null;
    const w = WINDOWS.find((x) => m < x.startMin);
    return w ? { window: w, startInSec: Math.max(0, Math.round((w.startMin - m) * 60)) } : null;
  }

  function mergeInto(total, mods) {
    Object.keys(mods || {}).forEach((k) => {
      if (k === "dropChanceAdd") total[k] = (total[k] || 0) + mods[k];
      else total[k] = (total[k] == null ? 1 : total[k]) * mods[k]; // 倍率類相乘
    });
  }
  // 目前生效的所有加成(主題 + 時段事件)合併成一份
  function activeFor(rules, now) {
    const total = {};
    const sources = [];
    const theme = rules && THEME_MODS[rules.storyTheme];
    if (theme) { mergeInto(total, theme.mods); sources.push("主題"); }
    const cur = currentWindow(rules, now);
    if (cur) { mergeInto(total, cur.window.mods); sources.push(cur.window.label); }
    total.sources = sources;
    return total;
  }

  // 把加成套到樓層資料上,回傳一份新的(不改原本的)。所有戰鬥/獎勵程式都讀 floorDef,所以只要在
  // 取得 floorDef 的地方換成這一份就好。
  function applyToFloor(floorDef, mods) {
    if (!floorDef || !mods) return floorDef;
    const hasMonster = mods.monsterHpMult || mods.monsterAtkMult;
    if (!hasMonster && !mods.expMult && !mods.coinMult && !mods.dropChanceAdd) return floorDef;
    const hpM = mods.monsterHpMult || 1, atkM = mods.monsterAtkMult || 1;
    const st = floorDef.stats;
    return {
      ...floorDef,
      stats: hasMonster ? { ...st, hp: Math.round(st.hp * hpM), maxHp: Math.round((st.maxHp || st.hp) * hpM), atk: Math.round(st.atk * atkM), matk: Math.round((st.matk || 0) * atkM) } : st,
      expReward: Math.round(floorDef.expReward * (mods.expMult || 1)),
      coinReward: Math.round(floorDef.coinReward * (mods.coinMult || 1)),
      dropChance: Math.min(1, floorDef.dropChance + (mods.dropChanceAdd || 0)),
    };
  }

  // 給畫面用:主題規則一行、目前時段事件、下一個時段事件
  function describe(rules, now) {
    const theme = rules && THEME_MODS[rules.storyTheme];
    return { themeText: theme ? theme.text : "", themeLine: theme ? theme.line : "", current: currentWindow(rules, now), next: nextWindow(rules, now) };
  }
  function themeRuleText(key) {
    return THEME_MODS[key] ? THEME_MODS[key].text : "";
  }
  function fmtClock(sec) {
    const s = Math.max(0, Math.round(sec));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  // 給爬塔頁/PVP 頁共用的小橫幅:目前的時段事件(含倒數)、下一個時段事件、今夜主題規則。
  // 需要全域的 ui(ui.icon / ui.esc)。沒有任何加成資訊(舊活動、沒開始)就回傳空字串。
  function bannerHtml(rules, now) {
    // ui.js 用頂層 const 宣告 ui,不是 window 的屬性,所以要用 typeof 判斷,不能寫 window.ui
    const u = typeof ui !== "undefined" ? ui : null;
    if (!u) return "";
    const d = describe(rules, now);
    if (!d.themeText && !d.current && !d.next) return "";
    const p = (inner, extra) => `<p style="margin:0 0 3px;font-size:12px;overflow-wrap:anywhere;${extra || ""}">${inner}</p>`;
    let rows = "";
    if (d.current) {
      const w = d.current.window;
      rows += p(`${u.icon(w.icon, { size: "14px" })}<b style="color:var(--gold);">${u.esc(w.label)}進行中</b>(剩 ${fmtClock(d.current.remainSec)})・${u.esc(w.text)}`);
      rows += p(u.esc(w.open), "color:var(--ink-dim);font-style:italic;");
    } else if (d.next) {
      const w = d.next.window;
      rows += p(`下一個時段事件:<b style="color:var(--gold);">${u.esc(w.label)}</b>(${fmtClock(d.next.startInSec)} 後)・${u.esc(w.text)}`, "color:var(--ink-dim);");
    }
    if (d.themeText) rows += p(`今夜主題規則:${u.esc(d.themeText)}`, "color:var(--ink-dim);");
    return `<div style="padding:8px 12px;margin-bottom:12px;border-radius:var(--radius);background:var(--panel2);border:1px dashed var(--gold-d);">${rows}</div>`;
  }

  window.CareerModifiers = { WORLD_BOSS, worldBossWindow, arenaBannerHtml, arenaInfo, arenaRuleAt, arenaRuleByKey, compressStats, ARENA_RULES, bannerHtml, THEME_MODS, WINDOWS, currentWindow, nextWindow, activeFor, applyToFloor, describe, themeRuleText, fmtClock };
})();
