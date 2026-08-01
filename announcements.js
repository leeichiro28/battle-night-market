// 遊戲公告頁面。跟首頁同一種卡片,每則預設收合,點「查看更多內容」才展開內文跟 CTA 按鈕。
const ANNOUNCE_TYPE_INFO = {
  event: { icon: "swords", label: "新活動" },
  update: { icon: "sparkles", label: "版本更新" },
  general: { icon: "megaphone", label: "公告" },
};

function formatAnnounceDate(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function announcePageCardHtml(a) {
  const info = ANNOUNCE_TYPE_INFO[a.type] || ANNOUNCE_TYPE_INFO.general;
  const imgArea = a.image_url ? `<img src="${ui.esc(a.image_url)}" alt="" />` : ui.icon(info.icon);
  const hasMore = !!(a.body || (a.cta_text && a.cta_link));
  const detailId = `announce-detail-${a.id}`;
  const cta =
    a.cta_text && a.cta_link
      ? `<a class="btn" href="${ui.esc(a.cta_link)}" style="text-decoration:none;">${ui.esc(a.cta_text)}${ui.icon("arrow-right")}</a>`
      : "";
  return `
    <div class="announce-hero">
      <div class="announce-hero-img">
        <span class="announce-badge">${ui.esc(info.label)}</span>
        ${imgArea}
      </div>
      <div class="announce-hero-body">
        <div class="announce-hero-sub">${formatAnnounceDate(a.created_at)}${a.subtitle ? " · " + ui.esc(a.subtitle) : ""}</div>
        <h3>${ui.esc(a.title)}</h3>
        ${
          hasMore
            ? `<button type="button" class="announce-hero-toggle" data-target="${detailId}">${ui.icon("chevron-down")}查看更多內容</button>
               <div class="announce-hero-detail" id="${detailId}" style="display:none;">
                 ${a.body ? `<p>${ui.esc(a.body).replace(/\n/g, "<br/>")}</p>` : ""}
                 ${cta}
               </div>`
            : ""
        }
      </div>
    </div>
  `;
}

function bindAnnounceToggles(root) {
  root.querySelectorAll(".announce-hero-toggle").forEach((btn) => {
    btn.onclick = () => {
      const target = document.getElementById(btn.dataset.target);
      if (!target) return;
      const open = target.style.display !== "none";
      target.style.display = open ? "none" : "block";
      btn.innerHTML = ui.icon(open ? "chevron-down" : "chevron-up") + "查看更多內容";
      ui.refreshIcons();
    };
  });
}

(async function loadAnnouncementsPage() {
  const box = document.getElementById("announce-page-list");
  let list = [];
  try {
    list = await db.listAnnouncements();
  } catch (e) {
    console.error(e);
    box.innerHTML = `<div class="empty">${ui.icon("triangle-alert")}公告讀取失敗</div>`;
    return;
  }
  if (!list.length) {
    box.innerHTML = `<div class="empty">${ui.icon("megaphone")}目前還沒有公告</div>`;
    return;
  }
  box.innerHTML = list.map(announcePageCardHtml).join("");
  bindAnnounceToggles(box);
})();
