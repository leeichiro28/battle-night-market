// 規則頁的「依遊戲分組」收合區塊。
// 每個 .game-group 裡有一個 .game-toggle 按鈕跟一個 .game-body 內容區，
// 預設收合(.game-body 有 hidden)，點按鈕展開/收合，跟首頁「活動已結束」清單同一種互動。
(function () {
  document.querySelectorAll(".game-group").forEach((group) => {
    const toggle = group.querySelector(".game-toggle");
    const body = group.querySelector(".game-body");
    if (!toggle || !body) return;
    toggle.addEventListener("click", () => {
      const open = !group.classList.contains("open");
      group.classList.toggle("open", open);
      body.hidden = !open;
    });
  });

  // 支援網址帶 #auction / #dice / #rps5 這種錨點，直接展開對應的遊戲分組並捲過去，
  // 方便公告文案的「查看規則」按鈕可以直接連到特定遊戲，不用使用者自己找、自己點開。
  function openGroupFromHash() {
    const key = location.hash.replace("#", "").trim();
    if (!key) return;
    const group = document.querySelector(`.game-group[data-group="${key}"]`);
    const body = group && group.querySelector(".game-body");
    if (!group || !body) return;
    group.classList.add("open");
    body.hidden = false;
    setTimeout(() => group.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }
  openGroupFromHash();
  window.addEventListener("hashchange", openGroupFromHash);
})();

// 商品清單分頁(跟夜市拍賣頁面同一套分級圖示與資料，來源：assets/auction-catalog.js)
(function () {
  const tabsEl = document.getElementById("rules-tier-tabs");
  const listEl = document.getElementById("rules-tier-list");
  const noteEl = document.getElementById("rules-tier-note");
  if (!tabsEl || !listEl) return;

  function renderTier(tier) {
    if (tier === "special") {
      listEl.innerHTML = AUCTION_SPECIAL_ITEMS.map(
        (sp) => `
      <div class="item-row special-item-row">
        <span class="name">${ui.esc(sp.name)}</span>
        <span class="pts">底價 ${sp.basePrice}</span>
      </div>
      <div class="special-item-desc">${ui.esc(sp.effectDesc)}</div>
    `
      ).join("");
      noteEl.textContent = "不計分，得標後可以使用一次對應的特殊效果，整場各限量一張";
      return;
    }
    if (tier === "mystery") {
      listEl.innerHTML = AUCTION_MYSTERY_BOXES.map(
        ([name, basePrice]) => `
      <div class="item-row">
        <span class="name">${ui.esc(name)}</span>
        <span class="pts">底價 ${basePrice}・分數開箱才知道</span>
      </div>
    `
      ).join("");
      noteEl.textContent = "得標後現場開箱，大約 10% 機率是雷(5分)，也有機會開出傳說大獎(150分)";
      return;
    }
    if (tier === "bundle") {
      listEl.innerHTML = AUCTION_BUNDLE_ITEMS.map(
        (b) => `
      <div class="item-row">
        <span class="name">${ui.esc(b.name)}</span>
        <span class="pts">底價 ${b.basePrice}・${auctionPointsForBundlePrice(b.basePrice)} 分</span>
      </div>
    `
      ).join("");
      noteEl.textContent = "一次多件小東西綁在一起賣，適合想快速湊分的人";
      return;
    }
    const data = AUCTION_CATALOG[tier];
    listEl.innerHTML = data.items
      .map(
        ([name, basePrice]) => `
      <div class="item-row">
        <span class="name">${ui.esc(name)}</span>
        <span class="pts">底價 ${basePrice}・${auctionPointsForPrice(basePrice, tier)} 分</span>
      </div>
    `
      )
      .join("");
    noteEl.textContent = data.note;
  }

  tabsEl.querySelectorAll(".folder-tab").forEach((tab) => {
    tab.onclick = () => {
      renderTier(tab.dataset.tier);
      tabsEl.querySelectorAll(".folder-tab").forEach((t) => t.classList.toggle("active", t === tab));
    };
  });
  renderTier("common");
})();
