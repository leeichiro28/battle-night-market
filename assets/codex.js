// 成就與圖鑑頁。資料:db.getCareerCodex(playerId)(永久記錄)+ db.getCareerJournal(playerId)(關主與人物沿用夜記)。
// 清單與條件在 career-codex.js。沒達成的隱藏成就、沒遇過的條目一律顯示「？？？」。
(function () {
  const app = document.getElementById("codex-app");
  const C = CareerCodex;
  const CF = CareerFloors;
  const J = CareerStory.JOURNAL;
  const TABS = [
    { key: "ach", icon: "award", label: "成就" },
    { key: "mon", icon: "skull", label: "怪物" },
    { key: "item", icon: "package-open", label: "裝備" },
    { key: "event", icon: "compass", label: "事件" },
    { key: "people", icon: "user-round", label: "關主與人物" },
  ];
  let activeTab = "ach";
  let data = null;
  let journal = null;

  function card({ icon, title, text, tags, locked, done, extra }) {
    return `
      <div class="journal-entry${locked ? " locked" : ""}${done ? " codex-done" : ""}">
        <div class="journal-ico">${ui.icon(locked ? "lock" : icon)}</div>
        <div class="journal-body">
          <div class="journal-title">${ui.esc(title)}</div>
          ${text ? `<div class="journal-text">${ui.esc(text)}</div>` : ""}
          ${tags && tags.length ? `<div class="tag-row journal-tags">${tags.map((t) => `<span class="tag">${ui.esc(t)}</span>`).join("")}</div>` : ""}
          ${extra || ""}
        </div>
      </div>`;
  }
  const bar = (v, t) => `<div class="stat-bar" style="margin-top:6px;"><div class="stat-bar-fill exp" style="width:${Math.min(100, Math.round((v / Math.max(1, t)) * 100))}%;"></div></div>`;

  // 圖鑑與稱號用的「目前總覽」
  function counts() {
    const tot = C.totals();
    const set = { mon: Object.keys(data.mon).length, item: Object.keys(data.item).length, event: Object.keys(data.event).length };
    return { tot, set, ach: Object.keys(data.ach).length };
  }
  function ctxForProgress() {
    const { tot, set } = counts();
    const ev = {};
    Object.keys(data.event).forEach((k) => (ev[k] = true));
    const stat = {};
    Object.keys(data.stat).forEach((k) => (stat[k] = data.stat[k].times));
    return { p: {}, stat, set, cat: tot, ev, pvp: null };
  }

  function achTab() {
    const done = (k) => !!data.ach[k];
    const ctx = ctxForProgress();
    return C.GROUP_ORDER.map((g) => {
      const items = C.ACHIEVEMENTS.filter((a) => a.group === g);
      if (!items.length) return "";
      const body = items
        .map((a) => {
          if (!done(a.key) && a.hidden) return card({ locked: true, title: "？？？", text: "隱藏成就。" });
          let extra = "";
          if (!done(a.key) && a.progress) {
            const v = a.progress(ctx), t = typeof a.target === "function" ? a.target(ctx) : a.target;
            extra = bar(v, t) + `<div class="journal-text" style="margin-top:3px;">${v} / ${t}</div>`;
          }
          return card({ icon: a.icon, title: a.name, text: a.desc, done: done(a.key), tags: done(a.key) ? ["已達成"] : [], extra });
        })
        .join("");
      return `<div class="card"><h3>${ui.icon(C.GROUPS[g].icon)}${ui.esc(C.GROUPS[g].label)}</h3><div class="journal-list">${body}</div></div>`;
    }).join("");
  }

  function monTab() {
    const list = C.catalog().mon;
    const body = list
      .map((m) => {
        const rec = data.mon[m.key];
        if (!rec) return card({ locked: true, title: "？？？", text: `第 ${m.floor} 層。打贏這一層就會記下來。` });
        return card({ icon: m.isBoss ? "swords" : "skull", title: m.name, text: `第 ${m.floor} 層`, tags: [`打贏 ${rec.times} 次`] });
      })
      .join("");
    return `<div class="card"><div class="journal-list">${body}</div></div>`;
  }

  const SLOT_LABEL = { weapon: "武器", armor: "防具", accessory: "飾品" };
  function itemTab() {
    const list = C.catalog().item;
    const rank = { legendary: 0, epic: 1, rare: 2, common: 3 };
    const sorted = [...list].sort((a, b) => rank[a.rarity] - rank[b.rarity] || a.slot.localeCompare(b.slot));
    const byRarity = CF.RARITIES.slice().reverse();
    return byRarity
      .map((r) => {
        const items = sorted.filter((it) => it.rarity === r);
        if (!items.length) return "";
        const got = items.filter((it) => data.item[it.key]).length;
        const body = items
          .map((it) => {
            if (!data.item[it.key]) return card({ locked: true, title: "？？？", text: `${CF.RARITY_LABEL[r]}・${SLOT_LABEL[it.slot]}${it.group !== "all" && CareerData.CLASS_INFO[it.group] ? "・" + CareerData.CLASS_INFO[it.group].name + "專用" : ""}` });
            const tags = [CF.RARITY_LABEL[r], SLOT_LABEL[it.slot]];
            if (it.group !== "all" && CareerData.CLASS_INFO[it.group]) tags.push(CareerData.CLASS_INFO[it.group].name);
            if (it.bossFloor) tags.push(`${it.bossFloor} 層 Boss`);
            return card({ icon: CF.RARITY_ICON[r], title: it.name, tags });
          })
          .join("");
        return `<div class="card"><h3>${ui.icon(CF.RARITY_ICON[r])}${ui.esc(CF.RARITY_LABEL[r])} <span class="tag">${got} / ${items.length}</span></h3><div class="journal-list">${body}</div></div>`;
      })
      .join("");
  }

  function eventTab() {
    const body = C.catalog().event
      .map((e) => (data.event[e.key] ? card({ icon: e.icon, title: e.name, tags: ["遇過"] }) : card({ locked: true, title: "？？？", text: "在爬塔時有機會遇到。" })))
      .join("");
    return `<div class="card"><div class="journal-list">${body}</div></div>`;
  }

  // 關主與人物:直接讀夜記,不另存一份
  function peopleTab() {
    const seen = (journal && journal.entries) || {};
    const bosses = J.bossFloors
      .map((f) => {
        const def = CF.getFloor(f);
        return seen["boss:" + f] && def ? card({ icon: "swords", title: def.name, text: `第 ${f} 層關主`, tags: ["打贏過"] }) : card({ locked: true, title: "？？？", text: `第 ${f} 層。打贏這一層的關主就會記下來。` });
      })
      .join("");
    const people = J.people
      .map((p) => (seen[p.key] ? card({ icon: p.icon, title: p.name, text: p.note, tags: [J.PEOPLE_TAG] }) : card({ locked: true, title: "？？？", text: "夜市裡有人在走動。" })))
      .join("");
    return `
      <div class="card"><h3>${ui.icon("swords")}關主</h3><div class="journal-list">${bosses}</div></div>
      <div class="card"><h3>${ui.icon("user-round")}夜市裡遇過的人</h3><div class="journal-list">${people}</div>
      <p class="journal-note" style="margin-top:10px;">更完整的線索與重看對話，請到<a href="journal.html">夜記</a>。</p></div>`;
  }

  function summaryHtml() {
    const { tot, set, ach } = counts();
    const codexDone = set.mon + set.item + set.event;
    const codexAll = tot.mon + tot.item + tot.event;
    const next = [];
    C.COUNT_TITLES.forEach((t) => {
      const meta = db.TITLE_CATALOG.find((x) => x.key === t.title);
      if (!meta) return;
      const have = t.type === "ach" ? ach : codexDone;
      const full = t.type === "ach" ? C.ACHIEVEMENTS.length : codexAll;
      const need = t.need === "all" ? full : t.need === "half" ? Math.ceil(full / 2) : t.need;
      next.push(`<span class="tag${have >= need ? " codex-got" : ""}">${ui.icon(have >= need ? "check" : "lock")}${ui.esc(meta.name)}(${t.type === "ach" ? "成就" : "圖鑑"} ${Math.min(have, need)}/${need})</span>`);
    });
    return `
      <div class="card">
        <div class="tag-row">
          <span class="tag">${ui.icon("award")}成就 ${ach} / ${C.ACHIEVEMENTS.length}</span>
          <span class="tag">${ui.icon("skull")}怪物 ${set.mon} / ${tot.mon}</span>
          <span class="tag">${ui.icon("package-open")}裝備 ${set.item} / ${tot.item}</span>
          <span class="tag">${ui.icon("compass")}事件 ${set.event} / ${tot.event}</span>
        </div>
        <p class="journal-note" style="margin:10px 0 6px;">累計到門檻會自動獲得稱號：</p>
        <div class="tag-row">${next.join("")}</div>
      </div>`;
  }

  function render() {
    const tabs = `<div class="rule-tabs">${TABS.map((t) => `<div class="rule-tab${activeTab === t.key ? " active" : ""}" data-tab="${t.key}">${ui.icon(t.icon)}${ui.esc(t.label)}</div>`).join("")}</div>`;
    const body = { ach: achTab, mon: monTab, item: itemTab, event: eventTab, people: peopleTab }[activeTab]();
    app.innerHTML = summaryHtml() + tabs + body;
    app.querySelectorAll("[data-tab]").forEach((el) => el.addEventListener("click", () => { activeTab = el.dataset.tab; render(); }));
  }

  async function init() {
    let session = null;
    try { session = await db.getSession(); } catch (e) {}
    if (!session) {
      app.innerHTML = `<div class="empty">登入之後才看得到你的成就與圖鑑。請從上方導覽列登入。</div>`;
      db.onAuthChange((s) => { if (s) init(); });
      return;
    }
    try {
      const player = await db.ensurePlayerFromSession(session);
      [data, journal] = await Promise.all([db.getCareerCodex(player.id), db.getCareerJournal(player.id).catch(() => null)]);
      render();
    } catch (e) {
      console.error(e);
      const missing = /career_codex|relation|schema cache/i.test((e && e.message) || "");
      app.innerHTML = `<div class="empty">${missing ? "成就與圖鑑還沒啟用。請主辦人到 Supabase SQL Editor 執行 migration-codex.sql(或重跑整份 supabase-schema.sql)。" : "載入失敗，請稍後再試。"}</div>`;
    }
  }
  init();
})();
