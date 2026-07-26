// 共用導覽列。頁面裡放一個 <div id="site-header"></div> 就會自動渲染。
(function () {
  async function refreshAccount() {
    const box = document.getElementById("header-account");
    if (!box) return;
    let session = null;
    try {
      session = await db.getSession();
    } catch (e) {}

    if (!session) {
      box.innerHTML = `<button class="btn small" id="header-login-btn">💬 Discord 登入</button>`;
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
      <span class="header-name">${player.name}</span>
      <a href="#" id="header-rename-link" title="改名">✏️</a>
      <a href="#" id="header-logout-link" title="登出">🚪</a>
    `;
    document.getElementById("header-rename-link").onclick = async (e) => {
      e.preventDefault();
      const next = prompt("輸入新的暱稱(1~16字)", player.name);
      if (!next) return;
      const trimmed = next.trim().slice(0, 16);
      if (!trimmed) return;
      await db.updatePlayerName(player.id, trimmed);
      refreshAccount();
    };
    document.getElementById("header-logout-link").onclick = async (e) => {
      e.preventDefault();
      if (!confirm("確定要登出嗎?")) return;
      await db.signOut();
      location.href = "index.html";
    };
  }

  function renderHeader() {
    const el = document.getElementById("site-header");
    if (!el) return;
    el.innerHTML = `
      <div class="site-header">
        <a href="index.html" class="site-header-brand">🎲 擂台夜市</a>
        <div class="site-header-nav">
          <a href="index.html">🏠 活動首頁</a>
          <a href="rules.html">📖 遊戲規則</a>
          <a href="admin.html">🛠️ 後台</a>
          <span class="header-account" id="header-account"></span>
        </div>
      </div>
    `;
    refreshAccount();
    db.onAuthChange(() => refreshAccount());
  }

  renderHeader();
})();
