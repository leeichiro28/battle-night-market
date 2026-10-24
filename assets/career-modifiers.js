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

  window.CareerModifiers = { bannerHtml, THEME_MODS, WINDOWS, currentWindow, nextWindow, activeFor, applyToFloor, describe, themeRuleText, fmtClock };
})();
