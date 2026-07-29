async function loadSponsorsPage() {
  const [sponsors, raised, contact] = await Promise.all([
    db.listSponsors(),
    db.getSiteSetting("total_raised"),
    db.getSiteSetting("discord_contact"),
  ]);

  const raisedEl = document.getElementById("raised-value");
  raisedEl.textContent = raised && raised.trim() ? raised : "尚未公布";

  const listEl = document.getElementById("sponsor-list");
  if (!sponsors.length) {
    listEl.innerHTML = `<div class="sponsor-empty">${ui.icon("gem")}目前還沒有贊助紀錄</div>`;
  } else {
    listEl.innerHTML = sponsors
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

  const ctaEl = document.getElementById("sponsor-cta");
  ctaEl.innerHTML = contact && contact.trim()
    ? `${ui.icon("heart-handshake")}活動募資贊助請 @主辦 <b>${ui.esc(contact)}</b>`
    : `${ui.icon("heart-handshake")}想贊助這個活動嗎?請洽主辦人`;

  ui.refreshIcons();
}

loadSponsorsPage();
