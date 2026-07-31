// 贊助名單頁面。db.listSponsorLists() 依建立時間新到舊排序:
// 第一筆當「最新贊助名單」直接顯示,其餘收進「歷史贊助名單」收合區,每份各自可展開查看。

function sponsorCardsHtml(sponsors) {
  if (!sponsors.length) {
    return `<div class="sponsor-empty">${ui.icon("gem")}目前還沒有贊助紀錄</div>`;
  }
  return sponsors
    .map(
      (s) => `
    <div class="sponsor-card">
      <div class="sname">${ui.icon("crown")}${ui.esc(s.name)}</div>
      <div class="sitems">${ui.esc(s.items)}</div>
    </div>
  `
    )
    .join("");
}

let raisedView = "current"; // "current":最新這份名單的總額 / "total":全部活動累積總額
let historyOpen = false;
const historyOpenIds = new Set(); // 記住哪些歷史名單被展開過,收合外層時不要重置

function renderRaised(latest, cumulative) {
  const label = document.getElementById("raised-label");
  const value = document.getElementById("raised-value");
  if (raisedView === "current") {
    label.textContent = "本次活動贊助總額";
    value.textContent = latest && latest.raised && latest.raised.trim() ? latest.raised : "尚未公布";
  } else {
    label.textContent = "全部活動累積贊助總額";
    value.textContent = cumulative && cumulative.trim() ? cumulative : "尚未公布";
  }
  document.querySelectorAll("#raised-view-toggle .view-toggle-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === raisedView);
  });
}

function renderHistory(historyLists) {
  const box = document.getElementById("history-box");
  const toggle = document.getElementById("history-toggle");
  const list = document.getElementById("history-list");

  if (!historyLists.length) {
    box.style.display = "none";
    return;
  }
  box.style.display = "block";
  toggle.innerHTML = ui.icon(historyOpen ? "chevron-up" : "chevron-down") + `歷史贊助名單(${historyLists.length})`;
  toggle.onclick = () => {
    historyOpen = !historyOpen;
    renderHistory(historyLists);
  };
  list.style.display = historyOpen ? "block" : "none";

  if (!historyOpen) {
    list.innerHTML = "";
    return;
  }

  list.innerHTML = historyLists
    .map((sl) => {
      const open = historyOpenIds.has(sl.id);
      return `
      <div class="game-group${open ? " open" : ""}" data-id="${sl.id}">
        <button type="button" class="game-toggle">
          <i data-lucide="trophy" class="ico"></i>
          <span class="game-toggle-label">${ui.esc(sl.name)}</span>
          <span class="game-toggle-count">${sl.sponsors.length} 筆</span>
          <i data-lucide="chevron-down" class="ico chev"></i>
        </button>
        <div class="game-body" ${open ? "" : "hidden"}>
          <div class="game-section">
            ${sponsorCardsHtml(sl.sponsors)}
          </div>
          <div class="history-list-total">
            ${ui.icon("sparkles")}本份名單贊助總額<b>${ui.esc(sl.raised && sl.raised.trim() ? sl.raised : "尚未公布")}</b>
          </div>
        </div>
      </div>
    `;
    })
    .join("");

  list.querySelectorAll(".game-group").forEach((group) => {
    const id = group.dataset.id;
    const t = group.querySelector(".game-toggle");
    const body = group.querySelector(".game-body");
    t.onclick = () => {
      const nowOpen = !group.classList.contains("open");
      group.classList.toggle("open", nowOpen);
      body.hidden = !nowOpen;
      if (nowOpen) historyOpenIds.add(id);
      else historyOpenIds.delete(id);
    };
  });

  ui.refreshIcons();
}

async function loadSponsorsPage() {
  const [sponsorLists, cumulative, contact] = await Promise.all([
    db.listSponsorLists(),
    db.getSiteSetting("total_raised"),
    db.getSiteSetting("discord_contact"),
  ]);

  const latest = sponsorLists[0] || null;
  const history = sponsorLists.slice(1);

  document.getElementById("raised-view-toggle").querySelectorAll(".view-toggle-btn").forEach((btn) => {
    btn.onclick = () => {
      raisedView = btn.dataset.view;
      renderRaised(latest, cumulative);
    };
  });
  renderRaised(latest, cumulative);

  const listEl = document.getElementById("sponsor-list");
  listEl.innerHTML = latest ? sponsorCardsHtml(latest.sponsors) : `<div class="sponsor-empty">${ui.icon("gem")}目前還沒有贊助紀錄</div>`;

  renderHistory(history);

  const ctaEl = document.getElementById("sponsor-cta");
  ctaEl.innerHTML = contact && contact.trim()
    ? `${ui.icon("heart-handshake")}活動募資贊助請 @主辦 <b>${ui.esc(contact)}</b>`
    : `${ui.icon("heart-handshake")}想贊助這個活動嗎?請洽主辦人`;

  ui.refreshIcons();
}

loadSponsorsPage();
