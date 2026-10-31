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

  // P1-11修改(玩家回饋:裝備表格式要統一、數值欄位右對齊、不要每個項目排版都不一樣)：
  // 固定10欄：裝備/類型/稀有度/等級/HP/攻擊/防禦/速度/幸運/特殊效果，不管武器/防具/飾品/
  // Boss限定哪一類都套同一組欄位，沒有的數值顯示「—」，不是每種裝備各自排不同欄位。
  function numCell(value, suffix) {
    if (value == null) return `<td class="num is-empty">—</td>`;
    return `<td class="num">+${value}${suffix || ""}</td>`;
  }

  function rowHtml(item, typeLabel, rarity, levelNum) {
    const hp = item.extraHp || null;
    const isAtkLike = item.statKey === "atk" || item.statKey === "matk";
    const atk = isAtkLike ? item.statValue : null;
    const atkSuffix = item.statKey === "matk" ? "(魔)" : "";
    const def = item.statKey === "def" ? item.statValue : null;
    const spd = item.statKey === "spd" ? item.statValue : null;
    const luck = item.statKey === "luck" ? item.statValue : null;
    return `
      <tr>
        <td>${ui.esc(item.name)}</td>
        <td>${ui.esc(typeLabel)}</td>
        <td><span class="tier-tag ${rarity}">${CF.RARITY_LABEL[rarity]}</span></td>
        <td class="num">${levelNum}</td>
        ${numCell(hp)}
        ${numCell(atk, atkSuffix)}
        ${numCell(def)}
        ${numCell(spd)}
        ${numCell(luck)}
        <td>${item.specialEffect ? "★" + ui.esc(item.specialEffect.desc) : "—"}</td>
      </tr>`;
  }

  function weaponRows() {
    const rows = [];
    Object.keys(CF.WEAPON_TABLE).forEach((cls) => {
      const clsName = (CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].name) || cls;
      CF.RARITIES.forEach((rarity) => {
        (CF.WEAPON_TABLE[cls][rarity] || []).forEach((item) => {
          rows.push(rowHtml(item, `武器(${clsName})`, rarity, CF.RARITY_REQ_LEVEL[rarity]));
        });
      });
    });
    // 51 層以後的階級裝備(招牌階 51~60 層掉、塔心階 61~70 層掉;稀有度只有普通/稀有/史詩)
    [2, 3].forEach((tier) => {
      Object.keys(CF.WEAPON_TABLE_TIER[tier]).forEach((cls) => {
        const clsName = (CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].name) || cls;
        CF.RARITIES.forEach((rarity) => {
          (CF.WEAPON_TABLE_TIER[tier][cls][rarity] || []).forEach((item) => rows.push(rowHtml(item, `武器(${clsName}・${CF.TIER_LABEL[tier]})`, rarity, tier === 2 ? "51~60層" : "61~70層")));
        });
      });
    });
    return rows.join("");
  }

  function equipmentSlotRows(slot, label) {
    const rows = [];
    CF.RARITIES.forEach((rarity) => {
      (CF.EQUIPMENT_TABLE[slot][rarity] || []).forEach((item) => {
        rows.push(rowHtml(item, label, rarity, CF.RARITY_REQ_LEVEL[rarity]));
      });
    });
    [2, 3].forEach((tier) => {
      CF.RARITIES.forEach((rarity) => {
        ((CF.EQUIPMENT_TABLE_TIER[tier][slot] || {})[rarity] || []).forEach((item) => rows.push(rowHtml(item, `${label}・${CF.TIER_LABEL[tier]}`, rarity, tier === 2 ? "51~60層" : "61~70層")));
      });
    });
    return rows.join("");
  }

  function bossRows() {
    const rows = [];
    const slotLabel = { weapon: "武器", armor: "防具", accessory: "飾品" };
    [40, 50, 60, 70].forEach((floor) => {
      const set = CF.BOSS_LEGENDARY_ITEMS[floor];
      const setBonus = CF.SET_BONUSES["boss" + floor];
      Object.keys(set).forEach((slot) => {
        const base = set[slot];
        if (slot === "weapon") {
          // P2-10追加修改:Boss限定武器依職業各自命名(跟statKey一樣依職業決定)，
          // 規則表要把7個職業的款式都列出來，不是只列一種泛用名字。
          const names = CF.BOSS_WEAPON_NAMES[floor] || {};
          Object.keys(names).forEach((cls) => {
            const clsName = (CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].name) || cls;
            const isMagic = CD.CLASS_INFO[cls] && CD.CLASS_INFO[cls].path === "magic";
            const item = {
              name: names[cls],
              statKey: isMagic ? "matk" : "atk",
              statValue: base.statValue,
              specialEffect: { desc: base.specialEffect.desc + (setBonus ? `；集滿「${setBonus.name}」全套再${setBonus.desc}` : "") },
            };
            rows.push(rowHtml(item, `武器(${clsName}，限定)`, "legendary", floor));
          });
          return;
        }
        const item = {
          name: base.name,
          statKey: base.statKey,
          statValue: base.statValue,
          extraHp: base.extraHp,
          specialEffect: { desc: base.specialEffect.desc + (setBonus ? `；集滿「${setBonus.name}」全套再${setBonus.desc}` : "") },
        };
        rows.push(rowHtml(item, `${slotLabel[slot]}(限定)`, "legendary", floor));
      });
    });
    return rows.join("");
  }

  function render(tab) {
    const rowsHtml = tab === "weapon" ? weaponRows() : tab === "armor" ? equipmentSlotRows("armor", "防具") : tab === "accessory" ? equipmentSlotRows("accessory", "飾品") : bossRows();
    listEl.innerHTML = `
      <div class="rule-table-wrap">
        <table class="rule-table equipment-table">
          <thead><tr>
            <th>裝備</th><th>類型</th><th>稀有度</th>
            <th class="num">等級</th><th class="num">HP</th><th class="num">攻擊</th>
            <th class="num">防禦</th><th class="num">速度</th><th class="num">幸運</th>
            <th>特殊效果</th>
          </tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
      </div>
      ${tab === "boss" ? `<p style="font-size:11px;color:var(--ink-dim);margin-top:6px;">※ Boss限定裝備只有打贏對應樓層的Boss才會機率掉落(40/50/60/70層)，「等級」欄位就是樓層數，也是要穿上的最低等級。</p>` : ""}`;
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

// 每個遊戲分組(骰子/五手勢/拍賣/職業養成對決)的小節太多、整頁捲動太長，一律改成分頁籤切換，
// 一次只顯示一個小節(職業養成對決先做過，玩家回饋好，現在全部統一成同一種操作)。
// 不用改動各小節本身的HTML:直接讀每個 <h4> 當分頁籤標題，新增小節時會自動出現在分頁籤列。
//   - 分頁籤標題太長時，在 <h4 data-tab-label="短標題"> 指定;沒指定就取「:」或「(」前面那段
//   - 每個小節底下有「上一節／下一節」，讀完不用捲回上面找分頁籤
//   - 「展開全部」可以把整組小節一次攤開(要用瀏覽器 Ctrl+F 搜尋整份規則時用)
(function () {
  document.querySelectorAll(".game-group").forEach((group) => {
    const body = group.querySelector(".game-body");
    if (!body) return;
    const sections = Array.from(body.querySelectorAll(":scope > .game-section"));
    if (sections.length < 2) return;

    // 小節數量文字是寫死的(\"8 個小節\")，之後增減很容易忘記同步，改成直接照實際小節數算
    const countEl = group.querySelector(".game-toggle-count");
    if (countEl) countEl.textContent = `${sections.length} 個小節`;

    const labels = sections.map((sec, idx) => {
      const h4 = sec.querySelector("h4");
      const full = h4 ? h4.textContent.trim() : `小節${idx + 1}`;
      const short = (h4 && h4.dataset.tabLabel) || full.split(/[:：(（]/)[0].trim() || full;
      const iconEl = h4 && h4.querySelector(".ico, svg");
      const iconName = iconEl ? iconEl.getAttribute("data-lucide") : null;
      return { short, iconName };
    });

    const bar = document.createElement("div");
    bar.className = "rule-tabbar";
    const tabBar = document.createElement("div");
    tabBar.className = "rule-tabs";
    const allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "rule-expand-all";
    allBtn.textContent = "展開全部";
    bar.appendChild(tabBar);
    bar.appendChild(allBtn);

    let current = 0;
    let showAll = false;

    function apply() {
      sections.forEach((sec, i) => {
        sec.hidden = !showAll && i !== current;
      });
      tabBar.querySelectorAll(".rule-tab").forEach((t, i) => t.classList.toggle("active", !showAll && i === current));
      body.classList.toggle("show-all", showAll);
      allBtn.textContent = showAll ? "分頁顯示" : "展開全部";
    }
    function go(idx, scroll) {
      current = Math.max(0, Math.min(sections.length - 1, idx));
      showAll = false;
      apply();
      // 捲到分頁籤列(不是小節本身),這樣切換後分頁籤還看得到,也不會被上方內容擋住
      if (scroll) bar.scrollIntoView({ block: "start", behavior: "smooth" });
    }

    labels.forEach((l, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "rule-tab";
      btn.innerHTML = (l.iconName ? `<i data-lucide="${l.iconName}" class="ico"></i>` : "") + l.short.replace(/</g, "&lt;");
      btn.onclick = () => go(idx, true);
      tabBar.appendChild(btn);

      // 小節底部的上一節/下一節
      const pager = document.createElement("div");
      pager.className = "rule-pager";
      pager.innerHTML =
        (idx > 0 ? `<button type="button" class="btn ghost small" data-go="${idx - 1}">← ${labels[idx - 1].short.replace(/</g, "&lt;")}</button>` : "<span></span>") +
        (idx < sections.length - 1 ? `<button type="button" class="btn ghost small" data-go="${idx + 1}">${labels[idx + 1].short.replace(/</g, "&lt;")} →</button>` : "<span></span>");
      pager.querySelectorAll("[data-go]").forEach((b) => (b.onclick = () => go(Number(b.dataset.go), true)));
      sections[idx].appendChild(pager);
    });
    allBtn.onclick = () => {
      showAll = !showAll;
      apply();
    };

    body.insertBefore(bar, sections[0]); // 圖示是動態插入的<i data-lucide>，ui.js已經有全域MutationObserver會自動轉成svg
    apply();
  });
})();

// 職業養成對決:職業表(玩家回饋「職業也要細分」，力量/敏捷/魔法三條路線、每條線2個最終職業，
// 一次表格列出主要數值、被動特色、大招、代表武器，不要整段文字擠在一起)
(function () {
  const el = document.getElementById("career-class-table");
  if (!el || !window.CareerData || !window.CareerFloors) return;
  const CD = window.CareerData;
  const CF = window.CareerFloors;

  const PATH_LABEL = { strength: "力量系", agility: "敏捷系", magic: "魔法系" };
  // CLASS_EFFECTS 裡的機制(忽視防禦/反擊/連射/連擊率/治療加成)是數值代號，玩家看不懂，
  // 這裡手動配一句白話說明，跟 statBonus 的固定加值合併顯示在「被動特色」欄。
  const PASSIVE_NOTE = {
    warrior: "攻擊無視對方20%防禦",
    guardian: "受擊30%機率反擊",
    archer: "攻擊10%機率追加一次普攻",
    assassin: "殘血對手時暴擊率大幅提升",
    mage: "—",
    healer: "大招治療量加成，回合開始自動回一點HP",
  };
  const CLASS_ORDER = ["warrior", "guardian", "archer", "assassin", "mage", "healer"];

  function rowHtml(cls) {
    const info = CD.CLASS_INFO[cls];
    const eff = CD.CLASS_EFFECTS[cls] || {};
    const bonusText = Object.keys(eff.statBonus || {})
      .map((k) => `${CF.STAT_LABEL[k] || k}+${eff.statBonus[k]}`)
      .join("、") || "—";
    const weapon = (CF.WEAPON_TABLE[cls] && CF.WEAPON_TABLE[cls].common && CF.WEAPON_TABLE[cls].common[0]) || null;
    return `
      <tr>
        <td>${PATH_LABEL[info.path] || info.pathLabel || "-"}</td>
        <td><span class="row-label">${ui.icon(info.icon || "user")}${ui.esc(info.name)}</span></td>
        <td>${ui.esc(bonusText)}</td>
        <td>${ui.esc(PASSIVE_NOTE[cls] || "—")}</td>
        <td>${ui.esc(info.ultName || "-")}<span class="hint" style="display:block;font-size:11px;color:var(--ink-dim);">${ui.esc(info.ultDesc || "")}</span></td>
        <td>${weapon ? ui.esc(weapon.name) : "-"}</td>
      </tr>`;
  }

  el.innerHTML = `
    <div class="rule-table-wrap">
      <table class="rule-table">
        <thead><tr><th>路線</th><th>最終職業</th><th>固定加值</th><th>被動特色</th><th>大招</th><th>代表武器(普通)</th></tr></thead>
        <tbody>${CLASS_ORDER.map(rowHtml).join("")}</tbody>
      </table>
    </div>`;
})();

// 職業養成對決:事件表(玩家回饋「事件也要細分」，15個事件一次表格列出類型跟效果，
// 不要整段文字擠成一大串逗號分隔)
(function () {
  const el = document.getElementById("career-event-table");
  if (!el || !window.CareerEvents) return;
  const CE = window.CareerEvents;

  // EVENTS 資料本身只有 desc(情境文字)，沒有「效果」的精簡白話版，這裡手動配一句，
  // 跟 db.js 的 _resolveInstantEvent / _computeEventChoicePatch 實際邏輯保持一致。
  const EFFECT_NOTE = {
    chest: "當場開穩拿小獎，或帶回去賭一把(可能更好也可能更差)",
    merchant: "花幣買下限時特價的普通裝備，或不買",
    fortune: "小機率拿到額外數值點，大多時候是小獎勵",
    sparring: "練習賽形式的小型戰鬥，輸了不扣任何東西",
    reclass: "付30幣把已經點過的1點數值點收回來，變成自由數值點重分配",
    pickpocket: "損失一點幣",
    landmine: "下次特訓要多等10秒",
    benefactor: "直接送1點自由數值點(很稀有)",
    gacha: "免費抽一次夜市抽獎機",
    healing: "回復30%最大HP跟MP",
    mentor: "直接送15~30點經驗值",
    lost_child: "70%機率拿到8~20幣謝禮，其餘沒事發生",
    try_on: "免費送一件普通裝備(隨機部位)",
    spirit_blessing: "50%送1點自由數值點，50%拿走5~15幣",
    blind_boxes: "三選一開箱，獎勵從摃龜到稀有裝備都有可能",
  };

  function rowHtml(def) {
    return `
      <tr>
        <td><span class="row-label">${ui.icon(def.icon)}${ui.esc(def.name)}</span></td>
        <td>${def.type === "choice" ? "需要選擇" : "立即生效"}</td>
        <td>${ui.esc(def.desc)}</td>
        <td>${ui.esc(EFFECT_NOTE[def.key] || "-")}</td>
      </tr>`;
  }

  el.innerHTML = `
    <div class="rule-table-wrap">
      <table class="rule-table">
        <thead><tr><th>事件</th><th>類型</th><th>情境</th><th>效果</th></tr></thead>
        <tbody>${CE.EVENTS.map(rowHtml).join("")}</tbody>
      </table>
    </div>`;
})();

// 樓層詞條與稀有攤販表(來源:assets/career-affixes.js,資料直接讀,改了那邊這裡自動跟著變)
(function () {
  const el = document.getElementById("career-affix-table");
  if (!el || !window.CareerAffixes) return;
  const AF = CareerAffixes;
  const tierRows = AF.TIER_ORDER.map((t) =>
    AF.AFFIXES.filter((a) => a.tier === t)
      .map(
        (a) => `
      <tr>
        <td><span style="color:${AF.TIERS[t].color};font-weight:700;">${ui.esc(AF.TIERS[t].label)}</span></td>
        <td>${ui.icon(a.icon, { size: "13px" })}${ui.esc(a.name)}${a.good ? ' <span style="color:var(--green);font-size:11px;">(好詞條)</span>' : ""}</td>
        <td>${ui.esc(a.text)}</td>
      </tr>`
      )
      .join("")
  ).join("");
  const vendorRows = AF.VENDORS.map(
    (v) => `<tr><td>${ui.icon(v.icon, { size: "13px" })}${ui.esc(v.title)}</td><td>${ui.esc(v.text)}</td><td>打贏必掉稀有(70%)或史詩(30%)，幣與經驗 ×${AF.VENDOR_REWARD.expMult}</td></tr>`
  ).join("");
  el.innerHTML = `
    <div class="rule-table-wrap">
      <table class="rule-table">
        <thead><tr><th>階級</th><th>詞條</th><th>效果</th></tr></thead>
        <tbody>${tierRows}</tbody>
      </table>
    </div>
    <div class="rule-table-wrap" style="margin-top:12px;">
      <table class="rule-table">
        <thead><tr><th>稀有攤販</th><th>怪物變化</th><th>獎勵</th></tr></thead>
        <tbody>${vendorRows}</tbody>
      </table>
    </div>`;
})();
