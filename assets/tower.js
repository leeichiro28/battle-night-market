// 職業養成對決 · 爬塔頁面控制(Phase2:爬塔骨架)
//
// 畫面規格照企劃書第十三節「爬塔畫面UI規格」:頂部職業/等級/樓層/幣、經驗條、HP條、
// 三顆行動按鈕(特訓/挑戰樓層/練功掛機)、戰報區。
//
// 簡化說明:每次挑戰樓層都是「重新滿血開打」，不會把上一場受的傷帶到下一場——企劃書只寫了
// 「打輸留在原樓層,馬上可以再試」，沒有規範持續HP要怎麼恢復/陣亡懲罰，所以先用最單純的
// 「每戰重置」，畫面上的 HP 條顯示的是你目前(加點+裝備後)的 HP 上限，不是會被戰鬥消耗的
// 持續數值。之後如果要做更硬核的「HP持續掉、要等回復」機制，建議先把回復規則定義出來再加。
(function () {
  const params = new URLSearchParams(location.search);
  const eventId = params.get("event");
  const app = document.getElementById("tower-app");

  let ev = null;
  let myId = null;
  let myBuild = null;
  let progress = null;
  let lastBattle = null; // { won, log, floorDef, coinGain, expGain, leveledUp, drop }
  let lastEvent = null; // { eventDef, text, drop } — instant事件(算命攤/扒手/機關/貴人/抽獎機)的結果
  let busy = false;
  let shopOpen = false;
  let scanTimer = null;
  let unsubProgress = null;
  let refreshQueued = false;

  function emptyMsg(text, icon) {
    return `<div class="empty">${ui.icon(icon || "info")}${ui.esc(text)}</div>`;
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(async () => {
      refreshQueued = false;
      try {
        await loadAndRender();
      } catch (e) {
        console.error(e);
      }
    }, 300);
  }

  async function init() {
    if (!eventId) {
      app.innerHTML = emptyMsg("請從活動首頁進入某一場「職業養成對決」的活動，網址需要帶 ?event=活動ID。");
      return;
    }
    ev = await db.getEventSafe(eventId);
    if (!ev) {
      app.innerHTML = emptyMsg("找不到這場活動，可能已經被刪除。");
      return;
    }
    document.getElementById("page-eyebrow").textContent = `${ev.name} · 訓練期`;
    const pvpLink = document.getElementById("to-pvp-link");
    if (pvpLink) pvpLink.href = `career.html?event=${eventId}`;

    const local = db.getLocalPlayer();
    myId = local && local.id;
    if (!myId) {
      app.innerHTML = emptyMsg("請先在右上角使用 Discord 登入，才能開始爬塔。", "log-in");
      return;
    }

    myBuild = await db.getOrCreateCareerBuild(eventId, myId);

    await loadAndRender();

    unsubProgress = db.onTableChange("career_progress", `event_id=eq.${eventId}`, scheduleRefresh);
    // 任何開著這頁的分頁都幫忙推進所有人的自動掛機(同一個原則:誰在場誰就幫忙推進)
    scanTimer = setInterval(async () => {
      try {
        await db.processCareerAutoFarmTicks(eventId);
        const advanced = await db.maybeAdvanceCareerPhase(eventId);
        if (advanced) ev = await db.getEventSafe(eventId); // 訓練期剛好在這個tick結束，重新讀一次活動拿到最新的 rules
        scheduleRefresh();
      } catch (e) {
        console.error(e);
      }
    }, 8000);

    setInterval(() => {
      if (!busy) render(); // 每秒重繪一次冷卻倒數文字，不用等資料庫事件
    }, 1000);
  }

  function trainingClosed() {
    return ev && ev.rules && ev.rules.careerPhase === "battle";
  }

  async function loadAndRender() {
    progress = await db.getOrCreateCareerProgress(eventId, myId);
    render();
  }

  function statBarRow(label, curText, ratio, kind) {
    const lowCls = kind === "hp" && ratio <= 0.4 ? " low" : "";
    return `
      <div class="stat-bar-row">
        <div class="stat-bar-label"><span>${ui.esc(label)}</span><span>${curText}</span></div>
        <div class="stat-bar ${kind === "hp" ? "hp" : ""}"><div class="stat-bar-fill ${kind}${lowCls}" style="width:${Math.max(0, Math.min(1, ratio)) * 100}%;"></div></div>
      </div>`;
  }

  function equipSummary(equipment) {
    const labels = { weapon: "武器", armor: "防具", accessory: "飾品" };
    return Object.keys(labels)
      .map((slot) => {
        const item = equipment[slot];
        return `<span class="cc-stat">${labels[slot]}:${item ? ui.esc(item.name) + (item.rarity === "rare" ? " ★稀有" : "") : "(無)"}</span>`;
      })
      .join("");
  }

  function renderTransferPicker() {
    const tree = CareerData.CAREER_TREE;
    let html = `
      <div style="background:var(--panel2);border:2px solid var(--gold);border-radius:var(--radius);padding:14px;margin:12px 0;">
        <p style="margin:0 0 10px;font-weight:700;color:var(--gold);display:flex;align-items:center;gap:6px;">
          ${ui.icon("sparkles")}可以轉職了!選一條路，定案你的最終職業(轉職後就不能再改)
        </p>`;
    Object.keys(tree).forEach((pathKey) => {
      const path = tree[pathKey];
      html += `<div class="career-path-block">
        <div class="career-path-title">${ui.icon(path.icon)}${ui.esc(path.label)}</div>
        <div class="career-class-grid">`;
      Object.keys(path.lines).forEach((lineKey) => {
        const line = path.lines[lineKey];
        const cls = line.final;
        html += `
          <div class="career-class-card" data-class="${cls.key}" data-path="${pathKey}">
            <div class="cc-head">${ui.icon(cls.icon)}${ui.esc(cls.name)}</div>
            <div class="cc-desc">
              ${ui.esc(line.tier1.name)}:${ui.esc(line.tier1.desc)}<br/>
              ${ui.esc(line.tier2.name)}:${ui.esc(line.tier2.desc)}
            </div>
            <div class="cc-ult"><b>大招 · ${ui.esc(cls.ultName)}</b><br/>${ui.esc(cls.ultDesc)}</div>
          </div>`;
      });
      html += `</div></div>`;
    });
    html += `</div>`;
    return html;
  }

  function autoFarmStatusHtml() {
    const r = progress.auto_farm_last_result;
    if (!r) {
      return `<p style="text-align:center;font-size:11px;color:var(--ink-dim);margin:8px 0 0;">${ui.icon("loader-circle")}掛機中，第一場戰鬥結果馬上出來...</p>`;
    }
    const secAgo = Math.max(0, Math.round((Date.now() - new Date(r.at).getTime()) / 1000));
    const nextInSec = Math.max(0, 15 - secAgo); // 對應 db.js 的 CAREER_AUTO_FARM_INTERVAL_SEC
    return `
      <p style="text-align:center;font-size:11.5px;margin:8px 0 0;color:${r.won ? "var(--green)" : "var(--ink-dim)"};">
        ${ui.icon(r.won ? "check" : "x")}${r.won ? `第${r.floor}層掛機戰鬥獲勝，+${r.coinGain}幣 +${r.expGain}經驗` : `第${r.floor}層掛機戰鬥落敗，沒有獎勵`}
        (${secAgo}秒前 · 下一場約${nextInSec}秒後)
      </p>`;
  }

  function renderShopPanel(locked) {
    const CF = CareerFloors;
    const statPrice = CF.statPointPrice(progress.stat_points_bought);
    const weaponTable = CF.WEAPON_TABLE[myBuild.final_class] || CF.WEAPON_TABLE.novice;

    function equipRow(slot, label, table) {
      const [min, max] = CF.EQUIPMENT_PRICE_RANGE.normal;
      const [rmin, rmax] = CF.EQUIPMENT_PRICE_RANGE.rare;
      const [lmin, lmax] = CF.EQUIPMENT_PRICE_RANGE.legendary;
      const legendaryDisabled = locked || progress.legendary_purchased;
      return `
        <div style="margin-bottom:10px;">
          <p style="font-size:11.5px;color:var(--ink-dim);margin:0 0 4px;">${label}</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn small" data-buy-equip="${slot}:normal" ${locked ? "disabled" : ""}>
              ${ui.esc(table.normal.name)}(${CF.describeItem(table.normal)})・${min}~${max}幣
            </button>
            <button class="btn small" data-buy-equip="${slot}:rare" ${locked ? "disabled" : ""}>
              ${ui.esc(table.rare.name)}(${CF.describeItem(table.rare)})・${rmin}~${rmax}幣
            </button>
            <button class="btn career-ult-btn small" data-buy-equip="${slot}:legendary" ${legendaryDisabled ? "disabled" : ""}>
              ${ui.esc(table.legendary.name)}(${CF.describeItem(table.legendary)})・${lmin}~${lmax}幣${progress.legendary_purchased ? "(已購買)" : ""}
            </button>
          </div>
        </div>`;
    }

    return `
      <div style="background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin:12px 0;">
        <p style="margin:0 0 4px;font-size:11px;color:var(--ink-dim);">價格會有一點浮動；傳說裝備整場只能買 1 件(商店買或抽獎機中都算)。</p>
        <div style="margin:12px 0;">
          <button class="btn small" id="buy-statpoint-btn" ${locked ? "disabled" : ""}>
            ${ui.icon("sparkles")}花 ${statPrice} 幣買 1 點自由數值點(下一次會更貴)
          </button>
        </div>
        ${equipRow("weapon", `武器(${ui.esc(CareerData.CLASS_INFO[myBuild.final_class].name)}專屬)`, weaponTable)}
        ${equipRow("armor", "防具", CF.EQUIPMENT_TABLE.armor)}
        ${equipRow("accessory", "飾品", CF.EQUIPMENT_TABLE.accessory)}
        <div style="margin:12px 0;">
          <button class="btn small" id="buy-gacha-btn" ${locked ? "disabled" : ""}>
            ${ui.icon("dices")}夜市抽獎機・${CF.GACHA_PRICE}幣/抽
          </button>
        </div>
        <div>
          <p style="font-size:11.5px;color:var(--ink-dim);margin:0 0 4px;">戰功勳章(純加排行分，不影響戰鬥數值)</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${CF.MEDAL_TIERS.map(
              (t) => `<button class="btn ghost small" data-buy-medal="${t.key}" ${locked ? "disabled" : ""}>${ui.esc(t.name)}+${t.scoreBonus}分・${t.price}幣</button>`
            ).join("")}
          </div>
        </div>
      </div>`;
  }

  function renderPendingEventCard(pending) {
    const def = CareerEvents.getEvent(pending.key);
    if (!def) return "";
    let choicesHtml = "";
    if (pending.key === "chest") {
      choicesHtml = `
        <button class="btn small" data-event-choice="open_now">${ui.icon("gift")}當場打開</button>
        <button class="btn ghost small" data-event-choice="save_later">${ui.icon("clock")}帶回去晚點開(賭一把)</button>`;
    } else if (pending.key === "merchant") {
      const item = pending.context && pending.context.item;
      const price = pending.context && pending.context.price;
      choicesHtml = `
        <button class="btn small" data-event-choice="buy">${ui.icon("coins")}花 ${price} 幣買下「${item ? ui.esc(item.name) : "?"}」</button>
        <button class="btn ghost small" data-event-choice="skip">${ui.icon("x")}不用了</button>`;
    } else if (pending.key === "reclass") {
      choicesHtml = `
        <button class="btn small" data-event-choice="pay">${ui.icon("coins")}花 30 幣收回 1 點數值點</button>
        <button class="btn ghost small" data-event-choice="skip">${ui.icon("x")}維持原狀</button>`;
    }
    return `
      <div style="background:var(--panel2);border:2px solid var(--gold);border-radius:var(--radius);padding:14px;margin:12px 0;">
        <p style="margin:0 0 6px;font-weight:700;color:var(--gold);display:flex;align-items:center;gap:6px;">
          ${ui.icon(def.icon)}${ui.esc(def.name)}
        </p>
        <p style="margin:0 0 10px;font-size:12.5px;color:var(--ink);">${ui.esc(def.desc)}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">${choicesHtml}</div>
      </div>`;
  }

  function render() {
    if (!progress) return;
    const info = CareerData.CLASS_INFO[myBuild.final_class];
    const stats = CareerData.applyProgress(myBuild.final_class, progress.stat_alloc, progress.equipment);
    const expNeed = CareerFloors.expToNextLevel(progress.level);
    const trainCooldownMs = new Date(progress.train_ready_at).getTime() - Date.now();
    const locked = trainingClosed();
    const hasPendingEvent = !!progress.pending_event;
    const canTrain = trainCooldownMs <= 0 && !locked && !hasPendingEvent;
    const nextFloor = progress.floor + 1;
    const nextFloorDef = CareerFloors.getFloor(nextFloor);
    const isAutoFarming = !!progress.auto_farm_floor;

    let html = "";
    if (locked) {
      html += `<div class="empty" style="margin-bottom:14px;">${ui.icon("flag")}訓練期已經結束，爬塔功能關閉了，你目前的加點跟裝備就是這場PVP要用的數值，前往下面的PVP對戰吧!</div>`;
    }
    html += `
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:14px;">
        <div style="display:flex;align-items:center;gap:8px;font-weight:700;font-size:15px;">
          ${ui.icon(info.icon)}${ui.esc(info.name)} Lv.${progress.level}
        </div>
        <div style="display:flex;gap:16px;align-items:center;font-size:13px;">
          <span style="color:var(--ink-dim);">第 ${progress.floor} 層</span>
          <span style="color:var(--gold);font-weight:700;display:inline-flex;align-items:center;gap:4px;">${ui.icon("coins")}${progress.coins}</span>
        </div>
      </div>
      ${statBarRow("經驗值", `${progress.exp} / ${expNeed}`, progress.exp / expNeed, "exp")}
      ${statBarRow("HP(上限)", `${stats.hp} / ${stats.maxHp}`, 1, "hp")}
      <div class="cc-stats" style="margin:10px 0 4px;">
        <span class="cc-stat">攻${stats.atk}</span>
        <span class="cc-stat">防${stats.def}</span>
        <span class="cc-stat">速${stats.spd}</span>
        <span class="cc-stat">幸運${stats.luck}</span>
        ${equipSummary(progress.equipment)}
      </div>`;

    if (hasPendingEvent) {
      html += renderPendingEventCard(progress.pending_event);
    }

    const eligibleForTransfer = myBuild.final_class === "novice" && progress.level >= CareerData.TRANSFER_LEVEL;
    if (myBuild.final_class === "novice" && !eligibleForTransfer) {
      html += `<div class="empty" style="margin:10px 0;font-size:12px;">${ui.icon("hourglass")}Lv.${CareerData.TRANSFER_LEVEL} 就可以轉職成正式職業了，繼續練功吧(目前 Lv.${progress.level})</div>`;
    }
    if (eligibleForTransfer && !locked) {
      html += renderTransferPicker();
    }

    if (progress.stat_points > 0 && !locked) {
      html += `
        <div style="background:var(--panel2);border:1px solid var(--gold-d);border-radius:var(--radius);padding:12px;margin:12px 0;">
          <p style="margin:0 0 8px;font-size:12.5px;color:var(--gold);font-weight:700;">
            ${ui.icon("sparkles")}你有 ${progress.stat_points} 點自由數值點可以分配!
          </p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            <button class="btn small" data-alloc="atk">攻擊+1</button>
            <button class="btn small" data-alloc="def">防禦+1</button>
            <button class="btn small" data-alloc="spd">速度+1</button>
            <button class="btn small" data-alloc="hp">HP+3</button>
            <button class="btn small" data-alloc="luck">幸運+1</button>
          </div>
        </div>`;
    }

    html += `
      <div class="career-action-row" style="flex-wrap:wrap;">
        <button class="btn" id="train-btn" style="flex:1 1 30%;" ${canTrain ? "" : "disabled"}>
          ${ui.icon("hand-coins")}特訓${!locked && !canTrain ? `(${Math.ceil(trainCooldownMs / 1000)}秒)` : ""}
        </button>
        <button class="btn" id="challenge-btn" style="flex:1 1 30%;" ${nextFloorDef && !locked && !hasPendingEvent ? "" : "disabled"}>
          ${ui.icon("swords")}挑戰第${nextFloor}層・無CD
        </button>
        <button class="btn ${isAutoFarming ? "career-ult-btn" : "ghost"}" id="autofarm-btn" style="flex:1 1 30%;" ${progress.floor <= 0 || locked || hasPendingEvent ? "disabled" : ""}>
          ${ui.icon("repeat")}練功掛機・${progress.floor <= 0 ? "已清樓層限定" : isAutoFarming ? "進行中(自動)" : "開始"}
        </button>
      </div>`;

    if (isAutoFarming) {
      html += autoFarmStatusHtml();
    }

    html += `
      <div style="margin-top:10px;">
        <button class="btn ghost small" id="toggle-shop-btn">${ui.icon("store")}${shopOpen ? "收起商店" : "打開商店(花幣買數值點/裝備/勳章)"}</button>
      </div>`;
    if (shopOpen) {
      html += renderShopPanel(locked || hasPendingEvent);
    }

    if (progress.floor > 0 && !locked) {
      const chips = [];
      for (let f = 1; f <= progress.floor; f++) chips.push(f);
      html += `
        <div style="margin-top:10px;">
          <p style="font-size:11px;color:var(--ink-dim);margin:0 0 6px;">已清樓層，可以重新挑戰穩定 farm:</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${chips
              .map((f) => `<button class="btn ghost small" data-retry-floor="${f}">第${f}層</button>`)
              .join("")}
          </div>
        </div>`;
    }

    if (lastEvent) {
      const def = lastEvent.eventDef;
      html += `
        <div style="margin-top:14px;padding:12px;border-radius:var(--radius);border:1px solid var(--gold-d);background:var(--panel2);">
          <p style="margin:0 0 6px;font-weight:700;color:var(--gold);display:flex;align-items:center;gap:6px;">
            ${ui.icon(def ? def.icon : "sparkles")}${def ? ui.esc(def.name) : "夜市事件"}
          </p>
          <p style="margin:0;font-size:12.5px;color:var(--ink);">${ui.esc(lastEvent.text || "")}</p>
        </div>`;
    }

    if (lastBattle) {
      const b = lastBattle;
      html += `
        <div style="margin-top:14px;padding:12px;border-radius:var(--radius);border:1px solid var(--line);background:var(--panel2);">
          <p style="margin:0 0 6px;font-weight:700;color:${b.won ? "var(--green)" : "var(--red)"};display:flex;align-items:center;gap:6px;">
            ${ui.icon(b.won ? "trophy" : "skull")}${b.won ? `打贏了 ${ui.esc(b.floorDef.name)}!` : `打輸給 ${ui.esc(b.floorDef.name)}了...`}
          </p>
          ${
            b.won
              ? `<p style="font-size:12px;color:var(--ink-dim);margin:0 0 6px;">
                  +${b.coinGain} 幣 · +${b.expGain} 經驗${b.leveledUp ? ` · 升到 Lv.${b.newLevel}! 獲得 2 數值點` : ""}
                  ${b.drop ? ` · 掉落並穿上「${ui.esc(b.drop.name)}」${b.drop.rarity === "rare" ? "★稀有" : ""}` : ""}
                </p>`
              : `<p style="font-size:12px;color:var(--ink-dim);margin:0 0 6px;">留在原樓層，沒有損失，可以馬上再試一次。</p>`
          }
        </div>`;
    }

    html += `<div class="log-panel career-log-panel" style="margin-top:12px;">${
      lastBattle && lastBattle.log && lastBattle.log.length
        ? lastBattle.log
            .slice()
            .reverse()
            .map((line) => `<div>${ui.esc(line)}</div>`)
            .join("")
        : `<div style="color:var(--ink-dim);">還沒有任何戰報，按下面的按鈕開始爬塔吧</div>`
    }</div>`;

    app.innerHTML = html;
    bindHandlers();
  }

  function bindHandlers() {
    const toggleShopBtn = document.getElementById("toggle-shop-btn");
    if (toggleShopBtn) {
      toggleShopBtn.onclick = () => {
        shopOpen = !shopOpen;
        render();
      };
    }
    const buyStatBtn = document.getElementById("buy-statpoint-btn");
    if (buyStatBtn && !buyStatBtn.disabled) {
      buyStatBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await db.buyCareerStatPoint(eventId, myId);
          progress = result.progress;
          lastEvent = { eventDef: { icon: "sparkles", name: "商店" }, text: `花 ${result.price} 幣買了 1 點自由數值點。` };
          lastBattle = null;
          render();
        } catch (e) {
          await ui.alert(e.message || "購買失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    }
    app.querySelectorAll("[data-buy-equip]").forEach((btn) => {
      if (btn.disabled) return;
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const [slot, rarity] = btn.dataset.buyEquip.split(":");
          const result = await db.buyCareerEquipment(eventId, myId, slot, rarity);
          progress = result.progress;
          lastEvent = { eventDef: { icon: "shopping-bag", name: "商店" }, text: `花 ${result.price} 幣買下並穿上了「${result.item.name}」。` };
          lastBattle = null;
          render();
        } catch (e) {
          await ui.alert(e.message || "購買失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });
    const buyGachaBtn = document.getElementById("buy-gacha-btn");
    if (buyGachaBtn && !buyGachaBtn.disabled) {
      buyGachaBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await db.buyCareerGachaPull(eventId, myId);
          progress = result.progress;
          lastEvent = { eventDef: { icon: "dices", name: "夜市抽獎機" }, text: result.text };
          lastBattle = null;
          render();
        } catch (e) {
          await ui.alert(e.message || "抽獎失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    }
    app.querySelectorAll("[data-buy-medal]").forEach((btn) => {
      if (btn.disabled) return;
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await db.buyCareerMedal(eventId, myId, btn.dataset.buyMedal);
          progress = result.progress;
          lastEvent = { eventDef: { icon: "medal", name: "戰功勳章" }, text: `花 ${result.tier.price} 幣買了「${result.tier.name}」，排行分 +${result.tier.scoreBonus}。` };
          lastBattle = null;
          render();
        } catch (e) {
          await ui.alert(e.message || "購買失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

    app.querySelectorAll("[data-event-choice]").forEach((btn) => {
      btn.onclick = () => resolveEventChoice(btn.dataset.eventChoice);
    });

    app.querySelectorAll(".career-class-card[data-class]").forEach((card) => {
      card.onclick = async () => {
        if (busy) return;
        busy = true;
        const key = card.dataset.class;
        const pathKey = card.dataset.path;
        const info = CareerData.CLASS_INFO[key];
        app.querySelectorAll(".career-class-card[data-class]").forEach((c) => (c.style.pointerEvents = "none"));
        card.style.opacity = "0.6";
        try {
          myBuild = await db.saveCareerBuild(eventId, myId, { path: pathKey, finalClass: key, skillKeys: info.skillKeys });
          render();
        } catch (e) {
          await ui.alert(e.message || "轉職失敗", { title: "操作失敗", tone: "danger" });
          render();
        } finally {
          busy = false;
        }
      };
    });

    const trainBtn = document.getElementById("train-btn");
    if (trainBtn && !trainBtn.disabled) {
      trainBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        trainBtn.disabled = true;
        trainBtn.innerHTML = ui.icon("loader-circle") + "特訓中...";
        try {
          const result = await db.trainForCareerCoins(eventId, myId);
          progress = result.progress;
          render();
        } catch (e) {
          await ui.alert(e.message || "特訓失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    }

    const challengeBtn = document.getElementById("challenge-btn");
    if (challengeBtn && !challengeBtn.disabled) {
      challengeBtn.onclick = () => doChallenge(progress.floor + 1);
    }
    app.querySelectorAll("[data-retry-floor]").forEach((btn) => {
      btn.onclick = () => doChallenge(parseInt(btn.dataset.retryFloor, 10));
    });

    const autofarmBtn = document.getElementById("autofarm-btn");
    if (autofarmBtn && !autofarmBtn.disabled) {
      autofarmBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const turningOn = !progress.auto_farm_floor;
          progress = await db.toggleCareerAutoFarm(eventId, myId, turningOn ? progress.floor : null);
          render();
        } catch (e) {
          await ui.alert(e.message || "操作失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    }

    app.querySelectorAll("[data-alloc]").forEach((btn) => {
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        btn.disabled = true;
        try {
          progress = await db.allocateCareerStatPoint(eventId, myId, btn.dataset.alloc);
          render();
        } catch (e) {
          await ui.alert(e.message || "分配失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });
  }

  async function doChallenge(floorNumber) {
    if (busy) return;
    busy = true;
    const challengeBtn = document.getElementById("challenge-btn");
    if (challengeBtn) {
      challengeBtn.disabled = true;
      challengeBtn.innerHTML = ui.icon("loader-circle") + "戰鬥中...";
    }
    try {
      const result = await db.challengeCareerFloor(eventId, myId, floorNumber);
      progress = result.progress || progress;
      if (result.pending) {
        // 觸發了神秘寶箱/路過商人/轉職邀請，要玩家先做選擇，畫面上會出現選項卡(見 render())
        lastBattle = null;
        lastEvent = null;
      } else if (result.event && result.sparring) {
        // 神秘人切磋:用跟一般樓層戰鬥一樣的戰報畫面呈現，只是換個名字
        lastEvent = null;
        lastBattle = { ...result, floorDef: { name: "神秘人切磋" } };
      } else if (result.event) {
        // 算命攤/扒手/機關/貴人/抽獎機:純文字結果，沒有戰報
        lastBattle = null;
        lastEvent = result;
      } else {
        lastEvent = null;
        lastBattle = result;
      }
      render();
    } catch (e) {
      await ui.alert(e.message || "挑戰失敗", { title: "操作失敗", tone: "danger" });
      await loadAndRender();
    } finally {
      busy = false;
    }
  }

  async function resolveEventChoice(choiceKey) {
    if (busy) return;
    busy = true;
    try {
      const result = await db.resolveCareerEvent(eventId, myId, choiceKey);
      progress = result.progress;
      lastEvent = result;
      lastBattle = null;
      render();
    } catch (e) {
      await ui.alert(e.message || "操作失敗", { title: "操作失敗", tone: "danger" });
      await loadAndRender();
    } finally {
      busy = false;
    }
  }

  window.addEventListener("beforeunload", () => {
    if (unsubProgress) unsubProgress();
    clearInterval(scanTimer);
  });

  init();
})();
