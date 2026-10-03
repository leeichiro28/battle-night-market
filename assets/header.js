// 共用導覽列。頁面裡放一個 <div id="site-header"></div> 就會自動渲染。
// 帳號相關的操作(顯示暱稱、改名、登出、Discord 登入)全部集中在這裡，頁面內容區不要再放一份。
(function () {
  const NAV_LINKS = [
    { href: "index.html", icon: "house", label: "活動首頁" },
    { href: "rules.html", icon: "book-open", label: "遊戲規則" },
    { href: "announcements.html", icon: "megaphone", label: "遊戲公告" },
    { href: "sponsors.html", icon: "gem", label: "贊助名單" },
    { href: "admin.html", icon: "wrench", label: "後台" },
  ];

  const NAME_MAX = 16;
  const RENAME_PROMPTED_KEY = "nickname_prompted_for";

  function currentPage() {
    const path = location.pathname.split("/").pop();
    return path || "index.html";
  }

  // 判斷這個帳號有沒有「好好取過名字」:
  // 空白、系統預設的「Discord玩家」，或是從沒改過、仍等於 Discord 帳號名稱，都算還沒取名。
  function needsNickname(player, session) {
    if (!player || !session) return false;
    const name = (player.name || "").trim();
    if (!name) return true;
    if (name === "Discord玩家") return true;
    try {
      return name === (db.discordNameFromSession(session) || "").trim();
    } catch (e) {
      return false;
    }
  }

  // 跨場永久系統(Phase 0):選要掛在名字旁邊的稱號。跟現有 ui.prompt/ui.confirm 那套單一輸入框
  // 不太合(這裡要顯示一整排單選清單)，所以自己另外組一個對話框，但沿用同樣的 .dialog-overlay/
  // .dialog-card 樣式，看起來還是同一套系統，不會像另外做了一個風格不一致的彈窗。
  async function openTitlePicker(player) {
    let profile = null;
    try {
      profile = await db.getPlayerProfile(player.id);
    } catch (e) {}
    const unlocked = (profile && profile.titles) || [];
    let selected = (profile && profile.display_title) || "";

    // P1-12修復(玩家回饋):原本只列出「已解鎖」的稱號，完全沒解鎖過任何稱號的人點了只會看到
    // 一段提示文字、看不到有哪些稱號可以追求；已解鎖的那些也只顯示圖示，看不出名字。
    // 改成：不管解不解鎖都列出全部稱號，已解鎖的正常可點選，未解鎖的名字照樣顯示、
    // 整列降低亮度、掛🔒圖示、不能點選，玩家可以清楚知道「有哪些稱號、我拿到了哪些」。
    // 二次修復(玩家回饋:部分列會顯示成一個超大的空白方塊，裡面只有一顆小圓點):原本用
    // <label>包<input type="radio">，不同瀏覽器/手機對「裸的radio加沒有固定高度的label」
    // 渲染不一致，容易被撐得很高、看起來就是空方塊裡一顆點(就是沒套樣式的原生radio)。
    // 改成完全不用原生radio/checkbox，純粹用按鈕+JS記錄目前選了哪個、重繪整個清單標記
    // 選中狀態，不依賴任何表單元件的原生外觀，不會再有渲染不一致的問題。
    function rowHtml(key, name, desc, icon, locked) {
      if (locked) {
        return `
          <div class="title-pick-row locked" aria-disabled="true">
            <span class="title-pick-lock">${ui.icon("lock")}</span>
            ${ui.icon(icon || "crown")}
            <span><b>${ui.esc(name)}</b>${desc ? `<span class="hint">${ui.esc(desc)}</span>` : ""}</span>
            <span class="title-pick-status locked">${ui.icon("lock")}未取得</span>
          </div>`;
      }
      const isSelected = selected === key;
      return `
        <button type="button" class="title-pick-row${isSelected ? " selected" : ""}" data-title-key="${ui.esc(key)}">
          ${icon ? ui.icon(icon) : `<span class="title-pick-lock"></span>`}
          <span><b>${ui.esc(name)}</b>${desc ? `<span class="hint">${ui.esc(desc)}</span>` : ""}</span>
          <span class="title-pick-status unlocked">${ui.icon(isSelected ? "circle-check" : "check")}${isSelected ? "使用中" : "已取得"}</span>
        </button>`;
    }

    function bodyHtml() {
      let html = rowHtml("", "不顯示任何稱號", "", null, false);
      (db.TITLE_CATALOG || []).forEach((meta) => {
        html += rowHtml(meta.key, meta.name, meta.desc, meta.icon, !unlocked.includes(meta.key));
      });
      return html;
    }

    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay show";
    overlay.innerHTML = `
      <div class="dialog-card" role="dialog" aria-modal="true">
        <div class="dialog-head">
          <span class="dialog-icon tone-info">${ui.icon("crown")}</span>
          <h3 class="dialog-title">選擇要顯示的稱號</h3>
        </div>
        <div class="dialog-body" id="title-pick-body">${bodyHtml()}</div>
        <div class="dialog-actions">
          <button type="button" class="btn ghost" id="title-pick-cancel">取消</button>
          <button type="button" class="btn" id="title-pick-ok">儲存</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    document.body.classList.add("dialog-open");

    const bodyEl = overlay.querySelector("#title-pick-body");
    function wireRows() {
      bodyEl.querySelectorAll("[data-title-key]").forEach((btn) => {
        btn.onclick = () => {
          selected = btn.dataset.titleKey;
          bodyEl.innerHTML = bodyHtml();
          wireRows();
        };
      });
    }
    wireRows();

    return new Promise((resolve) => {
      function close() {
        overlay.remove();
        document.body.classList.remove("dialog-open");
        resolve();
      }
      overlay.querySelector("#title-pick-cancel").onclick = close;
      overlay.querySelector("#title-pick-ok").onclick = async () => {
        try {
          await db.setDisplayTitle(player.id, selected || null);
        } catch (e) {
          await ui.alert(e.message || "儲存失敗", { title: "儲存失敗", tone: "danger" });
        }
        close();
      };
      overlay.onclick = (e) => {
        if (e.target === overlay) close();
      };
    });
  }

  async function askRename(player, opts) {
    const o = opts || {};
    const next = await ui.prompt(o.message || "取一個在擂台上顯示的暱稱(最多 16 字)", {
      title: o.title || "修改暱稱",
      value: o.clearValue ? "" : player.name,
      placeholder: "例如:夜市之王",
      maxLength: NAME_MAX,
      confirmText: "儲存暱稱",
      cancelText: o.cancelText || "取消",
    });
    if (next === null) return null;
    const trimmed = next.trim().slice(0, NAME_MAX);
    if (!trimmed || trimmed === player.name) return null;
    await db.updatePlayerName(player.id, trimmed);
    return trimmed;
  }

  // Discord 登入後如果偵測到還沒取好名字，直接把改名視窗端到使用者面前。
  // 同一個帳號在這台裝置上只主動問一次，問過就不再打擾(之後仍可從導覽列的鉛筆按鈕改)。
  async function maybeAutoRename(player, session) {
    if (!needsNickname(player, session)) return false;
    if (localStorage.getItem(RENAME_PROMPTED_KEY) === player.id) return false;
    localStorage.setItem(RENAME_PROMPTED_KEY, player.id);
    const changed = await askRename(player, {
      title: "幫自己取個名字吧",
      message: "你目前用的是 Discord 預設名稱。取一個好記的暱稱，對戰畫面跟賽程表上就會顯示它(最多 16 字)。",
      clearValue: false,
      cancelText: "先用現在的名字",
    });
    return !!changed;
  }

  async function refreshAccount() {
    const box = document.getElementById("header-account");
    if (!box) return;

    let session = null;
    try {
      session = await db.getSession();
    } catch (e) {}

    if (!session) {
      box.innerHTML = `<button class="btn small" id="header-login-btn">${ui.icon("log-in")}Discord 登入</button>`;
      const btn = document.getElementById("header-login-btn");
      if (btn) btn.onclick = () => db.signInWithDiscord();
      return;
    }

    let player = null;
    try {
      player = await db.ensurePlayerFromSession(session);
    } catch (e) {}
    if (!player) return;

    box.innerHTML = `
      <span class="header-user" title="${ui.esc(player.name)}">
        ${ui.icon("user")}<span class="header-name">${ui.esc(player.name)}</span>
      </span>
      <button type="button" class="icon-btn" id="header-rename-btn" title="修改暱稱" aria-label="修改暱稱">${ui.icon("pencil")}</button>
      <button type="button" class="icon-btn" id="header-title-btn" title="選擇稱號" aria-label="選擇稱號">${ui.icon("crown")}</button>
      <button type="button" class="icon-btn danger" id="header-logout-btn" title="登出" aria-label="登出">${ui.icon("log-out")}</button>
    `;

    document.getElementById("header-title-btn").onclick = () => openTitlePicker(player);
    document.getElementById("header-rename-btn").onclick = async () => {
      const changed = await askRename(player);
      if (changed) refreshAccount();
    };
    document.getElementById("header-logout-btn").onclick = async () => {
      const ok = await ui.confirm("登出後就不能報名活動，要重新用 Discord 登入才行。", {
        title: "確定要登出嗎?",
        confirmText: "登出",
        tone: "danger",
      });
      if (!ok) return;
      await db.signOut();
      location.href = "index.html";
    };

    if (await maybeAutoRename(player, session)) refreshAccount();
  }

  // 手機版把 3 個連結收進漢堡選單抽屜，帳號區(暱稱/改名/登出)固定留在第一列不會被收起來
  function setNavOpen(nav, toggle, open) {
    nav.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    toggle.setAttribute("aria-label", open ? "關閉選單" : "開啟選單");
    toggle.innerHTML = ui.icon(open ? "x" : "menu");
  }

  function renderHeader() {
    const el = document.getElementById("site-header");
    if (!el) return;
    const page = currentPage();
    el.innerHTML = `
      <div class="site-header">
        <a href="index.html" class="site-header-brand">${ui.icon("dices")}擂台夜市</a>
        <nav class="site-header-nav" id="site-header-nav">
          ${NAV_LINKS.map(
            (l) =>
              `<a href="${l.href}" class="nav-link${page === l.href ? " active" : ""}">${ui.icon(l.icon)}${l.label}</a>`
          ).join("")}
        </nav>
        <span class="header-account" id="header-account"></span>
        <button type="button" class="icon-btn nav-toggle" id="nav-toggle" aria-controls="site-header-nav" aria-expanded="false" aria-label="開啟選單"></button>
      </div>
    `;
    refreshAccount();
    db.onAuthChange(() => refreshAccount());

    const nav = document.getElementById("site-header-nav");
    const toggle = document.getElementById("nav-toggle");
    setNavOpen(nav, toggle, false);
    toggle.onclick = () => setNavOpen(nav, toggle, !nav.classList.contains("open"));
    nav.querySelectorAll(".nav-link").forEach((a) => {
      a.onclick = () => setNavOpen(nav, toggle, false);
    });
    document.addEventListener("click", (e) => {
      if (!nav.classList.contains("open")) return;
      if (nav.contains(e.target) || toggle.contains(e.target)) return;
      setNavOpen(nav, toggle, false);
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && nav.classList.contains("open")) setNavOpen(nav, toggle, false);
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 640 && nav.classList.contains("open")) setNavOpen(nav, toggle, false);
    });
  }

  renderHeader();
})();
