// 共用導覽列。頁面裡放一個 <div id="site-header"></div> 就會自動渲染。
// 帳號相關的操作(顯示暱稱、改名、登出、Discord 登入)全部集中在這裡,頁面內容區不要再放一份。
(function () {
  const NAV_LINKS = [
    { href: "index.html", icon: "house", label: "活動首頁" },
    { href: "rules.html", icon: "book-open", label: "遊戲規則" },
    { href: "admin.html", icon: "wrench", label: "後台" },
  ];

  const NAME_MAX = 16;
  const RENAME_PROMPTED_KEY = "nickname_prompted_for";

  function currentPage() {
    const path = location.pathname.split("/").pop();
    return path || "index.html";
  }

  // 判斷這個帳號有沒有「好好取過名字」:
  // 空白、系統預設的「Discord玩家」,或是從沒改過、仍等於 Discord 帳號名稱,都算還沒取名。
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

  // Discord 登入後如果偵測到還沒取好名字,直接把改名視窗端到使用者面前。
  // 同一個帳號在這台裝置上只主動問一次,問過就不再打擾(之後仍可從導覽列的鉛筆按鈕改)。
  async function maybeAutoRename(player, session) {
    if (!needsNickname(player, session)) return false;
    if (localStorage.getItem(RENAME_PROMPTED_KEY) === player.id) return false;
    localStorage.setItem(RENAME_PROMPTED_KEY, player.id);
    const changed = await askRename(player, {
      title: "幫自己取個名字吧",
      message: "你目前用的是 Discord 預設名稱。取一個好記的暱稱,對戰畫面跟賽程表上就會顯示它(最多 16 字)。",
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
      <button type="button" class="icon-btn danger" id="header-logout-btn" title="登出" aria-label="登出">${ui.icon("log-out")}</button>
    `;

    document.getElementById("header-rename-btn").onclick = async () => {
      const changed = await askRename(player);
      if (changed) refreshAccount();
    };
    document.getElementById("header-logout-btn").onclick = async () => {
      const ok = await ui.confirm("登出後就不能報名活動,要重新用 Discord 登入才行。", {
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

  // 手機版把 3 個連結收進漢堡選單抽屜,帳號區(暱稱/改名/登出)固定留在第一列不會被收起來
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
