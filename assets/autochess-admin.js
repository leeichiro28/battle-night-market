// 夜市自走棋 · 後台(階段 3 第 4 段):主辦人控制台 + 平衡數據
//
// 純函式 + 回傳 HTML 字串,不碰資料庫、不碰 DOM 事件(接線在 admin.js)。
// 所以可以在 Node 直接測:node tools/autochess-admin-test.js
//
//  - aggregate(rows)      把 autochess_stats 的列統計成「卡牌 / 流派 / 加碼卡 / 星級」的出場與勝率
//  - liveRows(players,clk) 全場即時表:血量、狀態(連線/掛網/淘汰)、本輪進度
//  - panelHtml / balanceHtml  畫面字串(使用者輸入的名字一律 esc)
window.AutochessAdmin = (function () {
  const AD = window.AutochessData;
  const ESC = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const esc = (typeof window.ui === "object" && window.ui && window.ui.esc) ? (s) => window.ui.esc(s) : ESC;

  const ONLINE_SEC = 20;     // last_seen 在這個秒數內算「在線」
  const AFK_ROUNDS = 3;      // 連續幾輪沒存檔算掛網(同 SQL 封板判定)
  const BAND = [0.4, 0.6];   // 企劃的平衡驗收區間
  const MIN_SAMPLE = 20;     // 樣本少於這個數字不下結論

  // ---------- 統計 ----------
  const rate = (w, d, n) => (n ? (w + d * 0.5) / n : null);
  function bucket() { return { n: 0, w: 0, d: 0, l: 0 }; }
  function addRes(b, res) { b.n++; if (res === "win") b.w++; else if (res === "draw") b.d++; else b.l++; }
  function fin(b) { return { n: b.n, wins: b.w, draws: b.d, losses: b.l, winRate: rate(b.w, b.d, b.n) }; }
  function verdict(winRate, n) {
    if (winRate == null || n < MIN_SAMPLE) return "few";
    if (winRate > BAND[1]) return "high";
    if (winRate < BAND[0]) return "low";
    return "ok";
  }

  // rows: [{ event_id?, round, player_id, stat }];掛網的列不算(他們沒在操作,會拉低勝率)
  function aggregate(rows) {
    const cards = {}, tags = {}, perkAfter = {}, perkBase = {}, stars = { 1: bucket(), 2: bucket(), 3: bucket() };
    const lastByPlayer = {}, threeStarPlayers = new Set(), players = new Set();
    let used = 0, skippedAfk = 0, all = bucket();
    const list = (rows || []).filter((r) => r && r.stat && r.stat.res);
    const keyOf = (r) => (r.event_id || "") + "|" + r.player_id;
    for (const r of list) {
      const s = r.stat;
      if (s.afk) { skippedAfk++; continue; }
      used++; players.add(keyOf(r)); addRes(all, s.res);
      const prev = lastByPlayer[keyOf(r)];
      if (!prev || r.round >= prev.round) lastByPlayer[keyOf(r)] = r;

      const top = {}; // 同名卡取最高星級,同一副陣容只算一次出場
      for (const c of s.cards || []) {
        const [id, st] = String(c).split("★");
        const star = Math.max(1, Math.min(3, Number(st) || 1));
        addRes(stars[star], s.res);
        if (star === 3) threeStarPlayers.add(keyOf(r));
        top[id] = Math.max(top[id] || 1, star);
      }
      for (const id of Object.keys(top)) {
        (cards[id] = cards[id] || { all: bucket(), s2: 0, s3: 0 });
        addRes(cards[id].all, s.res);
        if (top[id] >= 2) cards[id].s2++;
        if (top[id] >= 3) cards[id].s3++;
      }
      for (const tag of Object.keys(s.bonds || {})) {
        const tier = s.bonds[tag];
        if (!tier) continue;
        const t = (tags[tag] = tags[tag] || { all: bucket(), tiers: {} });
        addRes(t.all, s.res);
        addRes((t.tiers[tier] = t.tiers[tier] || bucket()), s.res);
      }
      // 加碼卡:picks[i] 是第 i 次選的(R3/R6/R9)。有選的 vs 同一階段沒選它的人比較
      const picks = s.picks || [];
      picks.forEach((id, i) => addRes((perkAfter[id] = perkAfter[id] || bucket()), s.res));
      for (let i = 0; i < picks.length; i++) {
        // 同階段基準:第 i 次選了別的卡的人
        for (const p of AD.PERKS) { if (p.id !== picks[i]) addRes((perkBase[p.id + "#" + i] = perkBase[p.id + "#" + i] || bucket()), s.res); }
      }
    }

    // 加碼卡選取率:用每位玩家最後一列的 picks(= 完整選擇)
    const pickCount = {}, pickSlots = [0, 0, 0];
    Object.values(lastByPlayer).forEach((r) => (r.stat.picks || []).forEach((id, i) => { pickCount[id] = (pickCount[id] || 0) + 1; pickSlots[Math.min(i, 2)]++; }));
    const totalPicks = pickSlots.reduce((a, b) => a + b, 0);

    const cardList = Object.keys(cards).map((id) => {
      const d = AD.CARD_BY_ID[id]; const f = fin(cards[id].all);
      return Object.assign({ id, name: d ? d.name : id, cost: d ? d.cost : null, tags: d ? d.tags : [], star2: cards[id].s2, star3: cards[id].s3, verdict: verdict(f.winRate, f.n) }, f);
    }).sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
    const tagList = Object.keys(tags).map((tag) => {
      const f = fin(tags[tag].all);
      const tiers = Object.keys(tags[tag].tiers).map(Number).sort((a, b) => a - b).map((t) => Object.assign({ tier: t }, fin(tags[tag].tiers[t])));
      return Object.assign({ tag, name: AD.TAGS[tag] ? AD.TAGS[tag].name : tag, tiers, verdict: verdict(f.winRate, f.n) }, f);
    }).sort((a, b) => (b.winRate || 0) - (a.winRate || 0));
    const perkList = AD.PERKS.map((p) => {
      const f = fin(perkAfter[p.id] || bucket());
      const picked = pickCount[p.id] || 0;
      // 基準 = 其他人在同階段的平均勝率(各階段合併,簡化)
      const base = bucket();
      Object.keys(perkBase).filter((k) => k.indexOf(p.id + "#") === 0).forEach((k) => { base.n += perkBase[k].n; base.w += perkBase[k].w; base.d += perkBase[k].d; base.l += perkBase[k].l; });
      const bf = fin(base);
      return Object.assign({ id: p.id, name: p.name, cat: p.cat, picked, pickRate: totalPicks ? picked / totalPicks : null, baseline: bf.winRate, lift: f.winRate != null && bf.winRate != null ? f.winRate - bf.winRate : null }, f);
    }).sort((a, b) => b.picked - a.picked);
    const starList = [1, 2, 3].map((s) => Object.assign({ star: s }, fin(stars[s])));

    const nPlayers = players.size;
    return {
      samples: used, skippedAfk, players: nPlayers, overall: fin(all),
      threeStarRate: nPlayers ? threeStarPlayers.size / nPlayers : null,
      cards: cardList, tags: tagList, perks: perkList, stars: starList,
      flags: cardList.filter((c) => c.verdict === "high" || c.verdict === "low").map((c) => ({ kind: "card", id: c.id, name: c.name, verdict: c.verdict, winRate: c.winRate }))
        .concat(tagList.filter((t) => t.verdict === "high" || t.verdict === "low").map((t) => ({ kind: "tag", id: t.tag, name: t.name, verdict: t.verdict, winRate: t.winRate }))),
    };
  }

  // ---------- 全場即時表 ----------
  // players: autochess_players 列(含 players:{name,is_bot});clk: autochess_clock 回傳;nowMs 可注入方便測試
  function liveRows(players, clk, nowMs) {
    const now = nowMs != null ? nowMs : (clk && clk.now ? new Date(clk.now).getTime() : Date.now());
    const round = (clk && clk.round) || 0;
    return (players || []).map((p) => {
      const seenAgo = p.last_seen ? (now - new Date(p.last_seen).getTime()) / 1000 : Infinity;
      const isBot = !!(p.players && p.players.is_bot);
      const afkRounds = Math.max(0, round - (p.last_action_round || 0));
      let status = "online";
      if (!p.alive) status = "out";
      else if (isBot) status = "bot";
      else if (afkRounds >= AFK_ROUNDS) status = "afk";
      else if (seenAgo > ONLINE_SEC) status = "offline";
      return {
        id: p.player_id, name: (p.players && p.players.name) || "?", hp: Math.max(0, p.hp), alive: !!p.alive, wins: p.wins || 0, losses: p.losses || 0,
        status, seenAgo: isFinite(seenAgo) ? Math.round(seenAgo) : null, afkRounds, isBot, eliminatedRound: p.eliminated_round, rank: p.final_rank,
        gold: p.state && p.state.gold != null ? p.state.gold : null, level: p.state && p.state.level != null ? p.state.level : null,
        sealed: (p.sealed_round || 0) >= round && round > 0, settled: (p.settled_round || 0) >= round && round > 0,
      };
    }).sort((a, b) => (b.alive - a.alive) || (a.alive ? b.hp - a.hp : (b.eliminatedRound || 0) - (a.eliminatedRound || 0)) || b.wins - a.wins);
  }

  const STATUS = { online: ["在線", "green"], offline: ["連線中斷", "gold"], afk: ["掛網", "red"], out: ["已淘汰", "dim"], bot: ["機器人", "dim"] };
  const PHASE = { countdown: "開打倒數", prep: "準備階段", battle: "戰鬥演出", result: "結算" };
  const mmss = (sec) => { sec = Math.max(0, Math.round(sec || 0)); return Math.floor(sec / 60) + ":" + String(sec % 60).padStart(2, "0"); };

  function clockText(clk) {
    if (!clk || !clk.started) return "尚未開始";
    if (clk.endedAt) return "已結束";
    const base = `第 ${clk.round || 0} 輪 · ${PHASE[clk.phase] || clk.phase || "?"} · 剩 ${mmss(clk.left)}`;
    return (clk.paused ? "【已暫停】" : "") + base;
  }

  function panelHtml(clk, players, nowMs) {
    const icon = (n) => (window.ui && window.ui.icon ? window.ui.icon(n) : "");
    const rows = liveRows(players, clk, nowMs);
    const ended = !!(clk && clk.endedAt);
    const started = !!(clk && clk.started);
    const alive = rows.filter((r) => r.alive).length;
    const counts = { online: 0, offline: 0, afk: 0 };
    rows.forEach((r) => { if (counts[r.status] != null) counts[r.status]++; });
    const maxHp = (AD.START_HP || 100);
    const ctrl = started && !ended ? `
      <div class="action-row" style="margin-top:10px;">
        ${clk.paused
          ? `<button class="btn small" data-ac="resume">${icon("play")}繼續</button>`
          : `<button class="btn small" data-ac="pause">${icon("pause")}暫停</button>`}
        <button class="btn ghost small" data-ac="extend" data-sec="30"${clk.phase === "prep" ? "" : " disabled"}>${icon("timer")}本輪準備 +30 秒</button>
        <button class="btn ghost small" data-ac="extend" data-sec="60"${clk.phase === "prep" ? "" : " disabled"}>${icon("timer")}+60 秒</button>
        <button class="btn ghost small outline-danger" data-ac="finish">${icon("flag")}強制結束(算名次)</button>
      </div>
      ${clk.phase === "prep" ? "" : `<div class="ac-adm-note">加時只能在準備階段按。</div>`}` : "";
    const table = rows.length ? `<div class="ac-adm-table">${rows.map((r) => {
      const st = STATUS[r.status] || ["", "dim"];
      const pct = Math.round((r.hp / maxHp) * 100);
      const prog = !r.alive ? "" : r.settled ? "已結算" : r.sealed ? "已封板" : "";
      return `<div class="ac-adm-row ${r.alive ? "" : "out"}">
        <div class="nm" title="${esc(r.name)}">${r.rank ? `<b>#${r.rank}</b> ` : ""}${esc(r.name)}</div>
        <div class="hp"><i style="width:${Math.min(100, pct)}%"></i><span>${r.hp}</span></div>
        <div class="wl">${r.wins}勝${r.losses}敗${r.level != null ? ` · Lv${r.level}` : ""}${r.gold != null ? ` · ${r.gold}銅` : ""}</div>
        <div class="stt"><span class="ac-badge ${st[1]}">${st[0]}${r.status === "afk" ? `(${r.afkRounds}輪)` : ""}</span>${prog ? `<em>${prog}</em>` : ""}</div>
      </div>`;
    }).join("")}</div>` : `<div class="ac-adm-note">還沒有玩家資料。</div>`;
    return `
      <div class="ac-adm-head"><b>${icon("activity")}主辦人控制台</b><span class="ac-adm-clock">${esc(clockText(clk))}</span></div>
      <div class="ac-adm-note">存活 ${alive} / ${rows.length} 人${started ? ` · 在線 ${counts.online} · 中斷 ${counts.offline} · 掛網 ${counts.afk}` : ""}${clk && clk.limitSec ? ` · 活動上限 ${mmss(clk.limitSec)}` : ""}</div>
      ${ctrl}
      ${table}`;
  }

  // ---------- 平衡數據 ----------
  const pct = (x) => (x == null ? "–" : Math.round(x * 100) + "%");
  const VERDICT = { ok: ["正常", "green"], high: ["偏強", "red"], low: ["偏弱", "gold"], few: ["樣本少", "dim"] };
  const vb = (v) => `<span class="ac-badge ${VERDICT[v][1]}">${VERDICT[v][0]}</span>`;
  function cardCost(c) { return c.cost == null ? "" : c.cost + "費"; }

  function balanceHtml(agg, log) {
    if (!agg || !agg.samples) return `<div class="ac-adm-note">還沒有數據(要有人打完至少一輪;掛網的玩家不計入)。</div>`;
    const tagName = (k) => (AD.TAGS[k] ? AD.TAGS[k].name : k);
    const head = (cols) => `<div class="ac-bal-row head">${cols.map((c) => `<span>${c}</span>`).join("")}</div>`;
    const flags = agg.flags.length
      ? `<div class="ac-adm-note warn">超出 ${pct(BAND[0])}~${pct(BAND[1])}:${agg.flags.map((f) => `${esc(f.name)}(${pct(f.winRate)}${f.verdict === "high" ? "偏強" : "偏弱"})`).join("、")}</div>`
      : `<div class="ac-adm-note">沒有卡牌或流派超出 ${pct(BAND[0])}~${pct(BAND[1])}(樣本 ≥ ${MIN_SAMPLE} 才判斷)。</div>`;
    const tags = `<div class="ac-bal-tbl">${head(["流派(羈絆)", "場次", "勝率", "各級勝率", ""])}${agg.tags.map((t) => `<div class="ac-bal-row"><span>${esc(t.name)}</span><span>${t.n}</span><span>${pct(t.winRate)}</span><span class="sm">${t.tiers.map((x) => `${x.tier}級 ${pct(x.winRate)}(${x.n})`).join(" · ")}</span><span>${vb(t.verdict)}</span></div>`).join("")}</div>`;
    const cards = `<div class="ac-bal-tbl">${head(["卡牌", "出場", "勝率", "升2★ / 3★", ""])}${agg.cards.map((c) => `<div class="ac-bal-row"><span>${esc(c.name)} <em>${cardCost(c)}${c.tags.length ? " · " + c.tags.map(tagName).join("/") : ""}</em></span><span>${c.n}</span><span>${pct(c.winRate)}</span><span class="sm">${c.star2} / ${c.star3}</span><span>${vb(c.verdict)}</span></div>`).join("")}</div>`;
    const perks = `<div class="ac-bal-tbl">${head(["加碼卡", "選取", "選取率", "之後勝率(對照)", ""])}${agg.perks.filter((p) => p.picked || p.n).map((p) => `<div class="ac-bal-row"><span>${esc(p.name)} <em>${esc(AD.PERK_CATS[p.cat] || "")}</em></span><span>${p.picked}</span><span>${pct(p.pickRate)}</span><span class="sm">${pct(p.winRate)}${p.baseline != null ? `(對照 ${pct(p.baseline)},${p.lift >= 0 ? "+" : ""}${Math.round((p.lift || 0) * 100)})` : ""}</span><span></span></div>`).join("")}</div>`;
    const stars = agg.stars.map((s) => `${s.star}★ 勝率 ${pct(s.winRate)}(${s.n})`).join(" · ");
    const warn = log && log.length ? `<div class="ac-adm-note warn">警告紀錄 ${log.length} 筆:${Object.entries(log.reduce((m, x) => ((m[x.kind] = (m[x.kind] || 0) + 1), m), {})).map(([k, v]) => `${esc(k)}×${v}`).join("、")}(mismatch=雙方驗算不一致,多半是引擎 bug;gold_clamped=金額被截斷)</div>` : "";
    return `
      <div class="ac-adm-note">${agg.players} 位玩家、${agg.samples} 筆對局${agg.skippedAfk ? `(另有 ${agg.skippedAfk} 筆掛網不計)` : ""} · 整體勝率 ${pct(agg.overall.winRate)} · 3★ 達成率 ${pct(agg.threeStarRate)}</div>
      ${flags}${warn}
      <h4 class="ac-bal-h">流派</h4>${tags}
      <h4 class="ac-bal-h">卡牌</h4>${cards}
      <h4 class="ac-bal-h">攤位加碼</h4>${perks}
      <div class="ac-adm-note">${stars}(強的星級勝率高是正常的;只看有沒有離譜)</div>`;
  }

  return { aggregate, liveRows, clockText, panelHtml, balanceHtml, verdict, constants: { ONLINE_SEC, AFK_ROUNDS, BAND, MIN_SAMPLE } };
})();
