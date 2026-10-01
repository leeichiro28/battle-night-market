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

// 職業養成對決:裝備表(來源：assets/career-floors.js，資料直接讀遊戲本體，
// 武器/防具/飾品/Boss限定裝備分頁籤切換，跟上面「商品清單分頁」同一種UI)
(function () {
  const tabsEl = document.getElementById("career-equipment-tabs");
  const listEl = document.getElementById("career-equipment-table");
  if (!tabsEl || !listEl || !window.CareerFloors || !window.CareerData) return;
  const CF = window.CareerFloors;
  const CD = window.CareerData;

  function rowHtml(name, typeLabel, rarity, statText, effectText, slotText, condText) {
    return `
      <tr>
        <td>${ui.esc(name)}</td>
        <td>${ui.esc(typeLabel)}</td>
        <td><span class="tier-tag ${rarity}">${CF.RARITY_LABEL[rarity]}</span></td>
        <td>${ui.esc(statText)}</td>
        <td>${effectText ? "★" + ui.esc(effectText) : "-"}</td>
        <td>${ui.esc(slotText)}</td>
        <td>${ui.esc(condText)}</td>
      </tr>`;
  }

  function statText(item) {
    const parts = [];
    if (item.statKey) parts.push(`${CF.STAT_LABEL[item.statKey]}+${item.statValue}`);
    if (item.extraHp) parts.push(`HP+${item.extraHp}`);
    return parts.join("、");
  }

  function weaponRows() {
    const rows = [];
    Object.keys(CF.WEAPON_TABLE).forEach((cls) => {
      const clsName = (CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].name) || cls;
      CF.RARITIES.forEach((rarity) => {
        (CF.WEAPON_TABLE[cls][rarity] || []).forEach((item) => {
          rows.push(
            rowHtml(
              item.name,
              `武器(${clsName}專用)`,
              rarity,
              statText(item),
              item.specialEffect ? item.specialEffect.desc : "",
              "武器",
              `要 Lv.${CF.RARITY_REQ_LEVEL[rarity]} 才穿得動`
            )
          );
        });
      });
    });
    return rows.join("");
  }

  function equipmentSlotRows(slot, label) {
    const rows = [];
    CF.RARITIES.forEach((rarity) => {
      (CF.EQUIPMENT_TABLE[slot][rarity] || []).forEach((item) => {
        rows.push(
          rowHtml(item.name, label, rarity, statText(item), item.specialEffect ? item.specialEffect.desc : "", label, `要 Lv.${CF.RARITY_REQ_LEVEL[rarity]} 才穿得動`)
        );
      });
    });
    return rows.join("");
  }

  function bossRows() {
    const rows = [];
    const slotLabel = { weapon: "武器", armor: "防具", accessory: "飾品" };
    [40, 50].forEach((floor) => {
      const set = CF.BOSS_LEGENDARY_ITEMS[floor];
      const setBonus = CF.SET_BONUSES["boss" + floor];
      Object.keys(set).forEach((slot) => {
        const item = set[slot];
        if (slot === "weapon") {
          // P2-10追加修改:Boss限定武器現在依職業各自命名(跟statKey一樣依職業決定)，
          // 規則表要把7個職業的款式都列出來，不是只列一種泛用名字。
          const names = CF.BOSS_WEAPON_NAMES[floor] || {};
          Object.keys(names).forEach((cls) => {
            const clsName = (CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].name) || cls;
            const isMagic = CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].path === "magic";
            const statKey = isMagic ? "matk" : "atk";
            rows.push(
              rowHtml(
                names[cls],
                `武器(${clsName}專用，Boss限定)`,
                "legendary",
                `${CF.STAT_LABEL[statKey]}+${item.statValue}`,
                item.specialEffect.desc + (setBonus ? `；集齊「${setBonus.name}」全套再+${setBonus.desc}` : ""),
                "武器",
                `只有第${floor}層Boss掉落，要 Lv.${floor} 才穿得動`
              )
            );
          });
          return;
        }
        const statPart = `${CF.STAT_LABEL[item.statKey]}+${item.statValue}`;
        const extraHpPart = item.extraHp ? `、HP+${item.extraHp}` : "";
        rows.push(
          rowHtml(
            item.name,
            `${slotLabel[slot]}(Boss限定)`,
            "legendary",
            statPart + extraHpPart,
            item.specialEffect.desc + (setBonus ? `；集齊「${setBonus.name}」全套再+${setBonus.desc}` : ""),
            slotLabel[slot],
            `只有第${floor}層Boss掉落，要 Lv.${floor} 才穿得動`
          )
        );
      });
    });
    return rows.join("");
  }

  function render(tab) {
    const rowsHtml = tab === "weapon" ? weaponRows() : tab === "armor" ? equipmentSlotRows("armor", "防具") : tab === "accessory" ? equipmentSlotRows("accessory", "飾品") : bossRows();
    listEl.innerHTML = `
      <div class="rule-table-wrap">
        <table class="rule-table">
          <thead><tr><th>裝備名稱</th><th>裝備類型</th><th>稀有度</th><th>基礎數值</th><th>特殊效果</th><th>裝備位置</th><th>其他條件</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>`;
  }

  tabsEl.querySelectorAll("[data-eq-tab]").forEach((tab) => {
    tab.onclick = () => {
      render(tab.dataset.eqTab);
      tabsEl.querySelectorAll("[data-eq-tab]").forEach((t) => t.classList.toggle("active", t === tab));
    };
  });
  render("weapon");
})();

// 職業養成對決:樓層怪物/掉落表(來源：assets/career-floors.js，資料是算出來的不是手key的，
// 樓層公式改了這裡自動跟著變，不用回來同步維護兩份)
(function () {
  const el = document.getElementById("career-floor-table");
  if (!el || !window.CareerFloors) return;
  function rarityText(weights) {
    return Object.keys(weights)
      .map((k) => `${CareerFloors.RARITY_LABEL[k]}${Math.round(weights[k] * 100)}%`)
      .join("、");
  }
  const rows = CareerFloors.FLOORS.map(
    (f) => `
      <tr${f.isMiniBoss ? ' style="background:rgba(242,183,5,.06);"' : ""}>
        <td>${f.isMiniBoss ? `<b style="color:var(--gold);">第${f.floor}層(關主)</b>` : `第${f.floor}層`}</td>
        <td>${ui.esc(f.name)}</td>
        <td>${f.stats.hp}</td>
        <td>${f.stats.atk} / ${f.stats.def}</td>
        <td>+${f.coinReward}幣 · +${f.expReward}經驗</td>
        <td>${Math.round(f.dropChance * 100)}%(${rarityText(f.dropRarityWeights)})</td>
      </tr>`
  ).join("");
  el.innerHTML = `
    <div class="rule-table-wrap">
      <table class="rule-table">
        <thead><tr><th>樓層</th><th>怪物</th><th>HP</th><th>攻/防</th><th>贏了獎勵</th><th>掉落機率(稀有度)</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
})();

// 職業養成對決小節太多、整頁捲動太長(玩家回饋)，改成分頁籤切換，一次只顯示一個小節，
// 不用改動上面每個小節本身的HTML，直接讀現有的 <h4> 當分頁籤標題，新增小節時也會自動出現
// 在分頁籤列，不用回來另外維護一份清單。
(function () {
  const body = document.querySelector('.game-group[data-group="career"] .game-body');
  if (!body) return;
  const sections = Array.from(body.querySelectorAll(":scope > .game-section"));
  if (sections.length < 2) return;

  const tabBar = document.createElement("div");
  tabBar.className = "folder-tabs";
  tabBar.style.marginBottom = "14px";

  sections.forEach((sec, idx) => {
    const h4 = sec.querySelector("h4");
    const fullLabel = h4 ? h4.textContent.trim() : `小節${idx + 1}`;
    const shortLabel = fullLabel.split(/[:：]/)[0]; // 標題常常是「XX:說明」，分頁籤只取冒號前面那段，比較不會擠
    const iconEl = h4 && h4.querySelector(".ico");
    const iconName = iconEl ? iconEl.getAttribute("data-lucide") : null;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "folder-tab" + (idx === 0 ? " active" : "");
    btn.innerHTML = (iconName ? `<i data-lucide="${iconName}" class="ico"></i>` : "") + shortLabel;
    btn.onclick = () => {
      sections.forEach((s, i) => {
        s.hidden = i !== idx;
      });
      tabBar.querySelectorAll(".folder-tab").forEach((t, i) => t.classList.toggle("active", i === idx));
      sec.scrollIntoView({ block: "start", behavior: "smooth" });
    };
    tabBar.appendChild(btn);
    sec.hidden = idx !== 0;
  });

  body.insertBefore(tabBar, sections[0]); // 圖示是動態插入的<i data-lucide>，ui.js已經有全域MutationObserver會自動轉成svg，這裡不用手動呼叫
})();
