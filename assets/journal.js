// 夜記頁面(世界觀第二階段)。
// 資料:db.getCareerJournal(playerId) 回傳玩家所有看過的條目;條目的文字目錄在 career-story.js 的 JOURNAL。
// 沒看過的條目一律顯示「？？？」，只給一句模糊的提示，不劇透。
// 夜記只記「看過什麼」:四個角色只標「疑似有關」、被救起只記次數，不寫救援者是誰。
(function () {
  const app = document.getElementById("journal-app");
  const J = CareerStory.JOURNAL;

  function entryCard({ icon, title, body, tags, seenCount, locked, hint, extraHtml }) {
    if (locked) {
      return `
        <div class="journal-entry locked">
          <div class="journal-ico">${ui.icon("lock")}</div>
          <div class="journal-body">
            <div class="journal-title">${ui.esc(J.LOCKED_TITLE)}</div>
            ${hint ? `<div class="journal-text">${ui.esc(hint)}</div>` : ""}
          </div>
        </div>`;
    }
    const tagHtml = (tags || []).map((t) => `<span class="tag">${ui.esc(t)}</span>`).join("");
    const countHtml = seenCount > 1 ? `<span class="tag">看過 ${seenCount} 次</span>` : "";
    return `
      <div class="journal-entry">
        <div class="journal-ico">${ui.icon(icon)}</div>
        <div class="journal-body">
          <div class="journal-title">${ui.esc(title)}</div>
          <div class="journal-text">${ui.esc(body)}</div>
          ${tagHtml || countHtml ? `<div class="tag-row journal-tags">${tagHtml}${countHtml}</div>` : ""}
          ${extraHtml || ""}
        </div>
      </div>`;
  }

  // 重看對話:打贏過的關主,展開就能依序重看戰前、戰後。沒打贏過的關主不會有這個按鈕(不劇透)。
  // 用原生 <details>,不需要額外的彈窗或 JS 狀態;對話內容直接讀 CareerFloors 的 story,不另存一份。
  function replayHtml(def) {
    const st = def.story;
    if (!st || (!st.pre && !st.post)) return "";
    const line = (label, text) =>
      text
        ? `<div class="journal-line"><span class="journal-line-label">${ui.esc(label)}</span><span>${ui.esc(text)}</span></div>`
        : "";
    return `
      <details class="journal-replay">
        <summary>${ui.icon("message-square-text")}重看對話</summary>
        <div class="journal-dialogue">
          <div class="journal-speaker">${ui.esc(def.name)}</div>
          ${line("戰前", st.pre)}
          ${line("戰後", st.post)}
        </div>
      </details>`;
  }

  function bossEntry(floor, seen) {
    const def = window.CareerFloors.getFloor(floor);
    const rec = seen["boss:" + floor];
    if (!rec || !def) {
      return entryCard({ locked: true, hint: `第 ${floor} 層。打贏這一層的關主就會記下來。` });
    }
    return entryCard({
      icon: floor >= 40 ? "crown" : "swords",
      title: `第 ${floor} 層 · ${def.name}`,
      body: (def.story && def.story.post) || "",
      seenCount: rec.times_seen,
      extraHtml: replayHtml(def),
    });
  }

  function personEntry(p, seen) {
    const rec = seen[p.key];
    if (!rec) return entryCard({ locked: true, hint: "夜市裡好像有這麼一個人。" });
    return entryCard({ icon: p.icon, title: p.name, body: p.note, tags: [J.PEOPLE_TAG], seenCount: rec.times_seen });
  }

  function clueEntry(c, seen) {
    const rec = seen[c.from];
    if (!rec) return entryCard({ locked: true, hint: c.hint });
    // 被救起的線索多顯示「被救起幾次」，但不寫是誰救的
    const body = c.from === "revive" ? `${c.text}(目前 ${rec.times_seen} 次)` : c.text;
    return entryCard({ icon: c.icon, title: c.title, body });
  }

  // 夜晚回顧:每個條目只算「第一次看到」那一晚,依時間排,同一晚的放在一起。
  function recapLabel(key) {
    if (key.startsWith("boss:")) {
      const f = Number(key.slice(5));
      const def = window.CareerFloors.getFloor(f);
      return def ? `打贏第 ${f} 層的關主「${def.name}」。` : "";
    }
    const person = J.people.find((p) => p.key === key);
    if (person) return `遇見了${person.name}。(${J.PEOPLE_TAG})`;
    return J.RECAP_LABELS[key] || "";
  }

  function recapHtml(data) {
    const rows = Object.keys(data.entries)
      .map((key) => ({ key, rec: data.entries[key], text: recapLabel(key) }))
      .filter((r) => r.text)
      .sort((a, b) => new Date(a.rec.first_seen_at) - new Date(b.rec.first_seen_at));
    if (!rows.length) return `<div class="empty">還沒有任何紀錄。去爬一次塔，夜記就會開始寫。</div>`;
    const nights = [];
    rows.forEach((r) => {
      const id = r.rec.first_event_id || "none";
      let night = nights.find((n) => n.id === id);
      if (!night) {
        night = { id, name: data.eventNames[id] || J.RECAP_NO_EVENT, at: r.rec.first_seen_at, items: [] };
        nights.push(night);
      }
      night.items.push(r.text);
    });
    return nights
      .map((n, i) => `
        <div class="journal-night">
          <div class="journal-night-head">${ui.icon("moon-star")}第 ${i + 1} 晚 · ${ui.esc(n.name)}
            <span class="journal-night-date">${ui.esc(new Date(n.at).toLocaleDateString("zh-TW"))}</span></div>
          <ul class="journal-night-list">${n.items.map((t) => `<li>${ui.esc(t)}</li>`).join("")}</ul>
        </div>`)
      .join("");
  }

  function render(data) {
    const seen = data.entries;
    const reviveCount = (seen.revive && seen.revive.times_seen) || 0;
    const total = J.bossFloors.length + J.people.length + J.clues.length;
    const found =
      J.bossFloors.filter((f) => seen["boss:" + f]).length +
      J.people.filter((p) => seen[p.key]).length +
      J.clues.filter((c) => seen[c.from]).length;

    app.innerHTML = `
      <div class="card">
        <div class="tag-row">
          <span class="tag">${ui.icon("moon-star")}過了 ${data.nights} 夜</span>
          <span class="tag">${ui.icon("mountain")}最高第 ${data.highestFloor} 層</span>
          <span class="tag">${ui.icon("heart-pulse")}被救起 ${reviveCount} 次</span>
          <span class="tag">${ui.icon("scroll-text")}已記下 ${found} / ${total}</span>
        </div>
      </div>
      <div class="card">
        <h3>${ui.icon("swords")}關主</h3>
        <div class="journal-list">${J.bossFloors.map((f) => bossEntry(f, seen)).join("")}</div>
      </div>
      <div class="card">
        <h3>${ui.icon("user-round")}夜市裡遇過的人</h3>
        <p class="journal-note">夜記只寫你看到的，不替你下結論。</p>
        <div class="journal-list">${J.people.map((p) => personEntry(p, seen)).join("")}</div>
      </div>
      <div class="card">
        <h3>${ui.icon("scroll-text")}線索</h3>
        <div class="journal-list">${J.clues.map((c) => clueEntry(c, seen)).join("")}</div>
      </div>
      <div class="card">
        <h3>${ui.icon("calendar-clock")}夜晚回顧</h3>
        <p class="journal-note">只記每件事「第一次」是在哪一晚看到的。</p>
        ${recapHtml(data)}
      </div>`;
  }

  async function init() {
    let session = null;
    try {
      session = await db.getSession();
    } catch (e) {}
    if (!session) {
      app.innerHTML = `<div class="empty">登入之後才看得到你的夜記。請從上方導覽列登入。</div>`;
      db.onAuthChange((s) => { if (s) init(); });
      return;
    }
    try {
      const player = await db.ensurePlayerFromSession(session);
      render(await db.getCareerJournal(player.id));
    } catch (e) {
      console.error(e);
      const missing = /career_journal|relation|schema cache/i.test((e && e.message) || "");
      app.innerHTML = `<div class="empty">${
        missing
          ? "夜記還沒啟用。請主辦人到 Supabase SQL Editor 重新執行一次 supabase-schema.sql。"
          : "夜記載入失敗，請稍後再試。"
      }</div>`;
    }
  }

  init();
})();
