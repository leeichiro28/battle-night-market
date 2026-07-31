// 贊助名單頁面。db.listSponsorLists() 依建立時間新到舊排序:
// 第一筆當「最新贊助名單」直接顯示,其餘收進「歷史贊助名單」收合區,每份各自可展開查看。
// 每位贊助者可能贊助過好幾次,卡片上顯示的是依「獎勵名稱」加總後的數量,
// 點「查看贊助紀錄」才會展開看每一次原始紀錄(不會因為合併顯示就看不到舊紀錄)。

function formatDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function rewardListHtml(totals) {
  if (!totals.length) return `<div style="color:var(--ink-dim);font-size:13px;">尚未填寫獎勵項目</div>`;
  return `<div class="sponsor-reward-list">${totals
    .map((r) => `<div class="sponsor-reward-line"><span>${ui.esc(r.name)}</span><span class="r-qty">${r.qty.toLocaleString()}</span></div>`)
    .join("")}</div>`;
}

function sponsorCardsHtml(sponsors) {
  if (!sponsors.length) {
    return `<div class="sponsor-empty">${ui.icon("gem")}目前還沒有贊助紀錄</div>`;
  }
  return sponsors
    .map((s) => {
      const totals = db.aggregateRewardTotals([s]);
      const entries = db.groupSponsorEntries(s);
      const historyId = `sp-hist-${s.id}`;
      return `
    <div class="sponsor-card">
      <div class="sponsor-card-top">
        <div class="sname">${ui.icon("crown")}${ui.esc(s.name)}</div>
        ${entries.length > 1 ? `<div class="scount">共 ${entries.length} 次贊助</div>` : ""}
      </div>
      ${rewardListHtml(totals)}
      ${
        entries.length > 1
          ? `<button type="button" class="sponsor-history-toggle" data-target="${historyId}">${ui.icon("chevron-down")}查看 ${entries.length} 筆贊助紀錄</button>
             <div class="sponsor-record-list" id="${historyId}" style="display:none;">
               ${entries
                 .map(
                   (e) => `
                 <div class="sponsor-record-entry">
                   <div class="sr-date">${formatDate(e.createdAt)}</div>
                   ${e.items
                     .map((it) => `<div class="sr-line"><span>${ui.esc(it.reward_name)}</span><span class="r-qty">${Number(it.qty).toLocaleString()}</span></div>`)
                     .join("")}
                 </div>
               `
                 )
                 .join("")}
             </div>`
          : ""
      }
    </div>
  `;
    })
    .join("");
}

let raisedView = "current"; // "current":最新這份名單的加總 / "total":全部活動累積加總
let historyOpen = false;
const historyOpenIds = new Set(); // 記住哪些歷史名單被展開過,收合外層時不要重置

function renderRaised(latestSponsors, allSponsors) {
  const label = document.getElementById("raised-label");
  const value = document.getElementById("raised-value");
  const totals = raisedView === "current" ? db.aggregateRewardTotals(latestSponsors) : db.aggregateRewardTotals(allSponsors);
  if (label) label.textContent = raisedView === "current" ? "本次活動贊助總額" : "全部活動累積贊助總額";
  if (value) {
    value.innerHTML = totals.length
      ? totals.map((r) => `<div class="hero-reward-line"><span>${r.qty.toLocaleString()}</span><span class="hr-name">${ui.esc(r.name)}</span></div>`).join("")
      : `<div style="font-size:14px;color:var(--ink-dim);">尚未公布</div>`;
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
      const listTotals = db.aggregateRewardTotals(sl.sponsors);
      return `
      <div class="game-group${open ? " open" : ""}" data-id="${sl.id}">
        <button type="button" class="game-toggle">
          <i data-lucide="trophy" class="ico"></i>
          <span class="game-toggle-label">${ui.esc(sl.name)}</span>
          <span class="game-toggle-count">${sl.sponsors.length} 位贊助者</span>
          <i data-lucide="chevron-down" class="ico chev"></i>
        </button>
        <div class="game-body" ${open ? "" : "hidden"}>
          <div class="game-section">
            ${sponsorCardsHtml(sl.sponsors)}
          </div>
          <div class="history-list-total">
            ${ui.icon("sparkles")}本份名單贊助總額
            ${
              listTotals.length
                ? listTotals.map((r) => `<b>${ui.esc(r.name)} ${r.qty.toLocaleString()}</b>`).join("&nbsp;&nbsp;")
                : "<b>尚未公布</b>"
            }
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

  bindRecordToggles(list);
  ui.refreshIcons();
}

function bindRecordToggles(root) {
  root.querySelectorAll(".sponsor-history-toggle").forEach((btn) => {
    btn.onclick = () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const open = target.style.display !== "none";
      target.style.display = open ? "none" : "block";
      btn.innerHTML = ui.icon(open ? "chevron-down" : "chevron-up") + btn.textContent.trim();
      ui.refreshIcons();
    };
  });
}

async function loadSponsorsPage() {
  let sponsorLists, contact;
  try {
    [sponsorLists, contact] = await Promise.all([db.listSponsorLists(), db.getSiteSetting("discord_contact")]);
  } catch (e) {
    console.error(e);
    document.getElementById("sponsor-list").innerHTML = `<div class="sponsor-empty">${ui.icon("triangle-alert")}贊助名單載入失敗:${ui.esc(e.message || "未知錯誤")}</div>`;
    ui.refreshIcons();
    return;
  }

  const latest = sponsorLists[0] || null;
  const history = sponsorLists.slice(1);
  const allSponsors = sponsorLists.flatMap((sl) => sl.sponsors || []);

  document
    .getElementById("raised-view-toggle")
    .querySelectorAll(".view-toggle-btn")
    .forEach((btn) => {
      btn.onclick = () => {
        raisedView = btn.dataset.view;
        renderRaised(latest ? latest.sponsors : [], allSponsors);
      };
    });
  renderRaised(latest ? latest.sponsors : [], allSponsors);

  const listEl = document.getElementById("sponsor-list");
  listEl.innerHTML = latest ? sponsorCardsHtml(latest.sponsors) : `<div class="sponsor-empty">${ui.icon("gem")}目前還沒有贊助紀錄</div>`;
  bindRecordToggles(listEl);

  renderHistory(history);

  const ctaEl = document.getElementById("sponsor-cta");
  ctaEl.innerHTML =
    contact && contact.trim()
      ? `${ui.icon("heart-handshake")}活動募資贊助請 @主辦 <b>${ui.esc(contact)}</b>`
      : `${ui.icon("heart-handshake")}想贊助這個活動嗎?請洽主辦人`;

  ui.refreshIcons();
}

loadSponsorsPage();
