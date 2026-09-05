// 職業養成對決 · 爬塔頁面控制
//
// 畫面是文件式分頁(跟後台/夜市拍賣商品清單同一套 .folder-tabs/.folder-tab-card)：
// 「爬塔」「商店」「合成」「背包」，合成/背包目前是敬請期待的預留分頁，之後有東西了
// 直接在 render() 裡加一個 case 就好，不用動分頁切換的架構。
//
// 轉職是兩段式(企劃書):
//   Lv1~4  見習學徒，還沒選路
//   Lv5    選一個系(力量/敏捷/魔法) -> 該系學徒，數值/大招都比 Lv1 好一點，但還沒定final
//   Lv15   在 Lv5 選的那個系裡面選一條線 -> 正式轉職成 6 個最終職業之一，選了就不能再改
// Lv5 選了力量系，Lv15 就只能在戰士/守衛裡選，不能臨時跳去別系。
//
// 簡化說明:每次挑戰樓層都是「重新滿血開打」，不會把上一場受的傷帶到下一場——企劃書只寫了
// 「打輸留在原樓層,馬上可以再試」，沒有規範持續HP要怎麼恢復/陣亡懲罰，所以先用最單純的
// 「每戰重置」，畫面上的 HP 條顯示的是你目前(加點+裝備後)的 HP 上限，不是會被戰鬥消耗的
// 持續數值。之後如果要做更硬核的「HP持續掉、要等回復」機制，建議先把回復規則定義出來再加。
(function () {
  const params = new URLSearchParams(location.search);
  const eventId = params.get("event");
  const app = document.getElementById("tower-app");

  const TABS = [
    { key: "tower", icon: "mountain", label: "爬塔" },
    { key: "shop", icon: "store", label: "商店" },
    { key: "gacha", icon: "dices", label: "抽獎機" },
    { key: "synthesis", icon: "flask-conical", label: "合成" },
    { key: "backpack", icon: "backpack", label: "背包" },
  ];

  let ev = null;
  let myId = null;
  let myBuild = null;
  let progress = null;
  let lastBattle = null; // { won, log, floorDef, coinGain, expGain, leveledUp, drop }
  let lastEvent = null; // { eventDef, text, drop } — instant事件/商店購買結果(顯示在爬塔分頁)
  let lastGachaResult = null; // 抽獎結果(顯示在抽獎機分頁，不會跳走)
  let lastSynthesisResult = null; // 合成結果(顯示在合成分頁，不會跳走)
  let bossSubmitted = false; // 王戰:這回合是否已經送出動作
  let bossSeenRound = null;
  let bossRoundTimer = null;
  let broadcasts = [];
  let highlight = null; // { icon, title, text } — 傳說裝備/爬完樓層之類的精彩時刻，顯示大卡片
  let busy = false;
  let activeTab = "tower";
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
    broadcasts = await db.listCareerBroadcasts(eventId).catch(() => []);

    await loadAndRender();

    unsubProgress = db.onTableChange("career_progress", `event_id=eq.${eventId}`, scheduleRefresh);
    let unsubBroadcasts = db.onTableChange("career_broadcasts", `event_id=eq.${eventId}`, async () => {
      broadcasts = await db.listCareerBroadcasts(eventId).catch(() => broadcasts);
      render();
    });
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
      // 每秒重繪一次冷卻倒數文字，不用等資料庫事件——但如果玩家正在跟 <select>/<input>
      // 互動(例如合成分頁的下拉選單開著)，這時候整頁重繪會把瀏覽器原生的下拉選單元素
      // 整個換掉，選單會被強制收合、選不到東西，所以互動中的時候先跳過這一次重繪。
      // 王戰進行中也跳過:王戰自己有一顆獨立的每秒倒數計時器(startBossRoundTimer)，
      // 如果這裡也每秒整頁重繪，會把那顆計時器重新啟動、永遠倒數不完。
      const activeTag = document.activeElement && document.activeElement.tagName;
      const interacting = activeTag === "SELECT" || activeTag === "INPUT" || activeTag === "TEXTAREA";
      const inBossBattle = progress && progress.active_boss_battle;
      if (!busy && !interacting && !inBossBattle) render();
    }, 1000);

    window.addEventListener("beforeunload", () => {
      if (unsubBroadcasts) unsubBroadcasts();
    });
  }

  // 活動的「相」放在 events.rules.careerPhase(跟 dice 規則、auction 設定同一個 jsonb 欄位)：
  //   還沒設定過(undefined) -> 主辦人還沒按「開始訓練期」，爬塔動作全部鎖住
  //   'training' -> 訓練期進行中，爬塔開放
  //   'battle'   -> 訓練期結束，爬塔鎖住，PVP開放
  function getCareerPhase() {
    return (ev && ev.rules && ev.rules.careerPhase) || "not_started";
  }

  async function loadAndRender() {
    progress = await db.getOrCreateCareerProgress(eventId, myId);
    render();
  }

  // ---------------- 共用小元件 ----------------

  function statBarRow(label, curText, ratio, kind) {
    const lowCls = kind === "hp" && ratio <= 0.4 ? " low" : "";
    return `
      <div class="stat-bar-row">
        <div class="stat-bar-label"><span>${ui.esc(label)}</span><span>${curText}</span></div>
        <div class="stat-bar ${kind === "hp" || kind === "mp" ? kind : ""}"><div class="stat-bar-fill ${kind}${lowCls}" style="width:${Math.max(0, Math.min(1, ratio)) * 100}%;"></div></div>
      </div>`;
  }

  function rarityTag(rarity) {
    if (!rarity) return "";
    return `<span class="tier-tag ${rarity}">${ui.icon(CareerFloors.RARITY_ICON[rarity], { size: "12px" })}${CareerFloors.RARITY_LABEL[rarity]}</span>`;
  }

  function potionQuickBarHtml(disabled) {
    const potions = progress.potions || { hp: 0, mp: 0 };
    if (!potions.hp && !potions.mp) return "";
    const CF = CareerFloors;
    let html = `<div style="display:flex;gap:8px;margin:6px 0 10px;flex-wrap:wrap;">`;
    if (potions.hp > 0) {
      html += `<button class="btn ghost small" data-use-potion="hp" ${disabled ? "disabled" : ""}>${ui.icon(CF.POTIONS.hp.icon)}喝${ui.esc(CF.POTIONS.hp.name)}(x${potions.hp})</button>`;
    }
    if (potions.mp > 0) {
      html += `<button class="btn ghost small" data-use-potion="mp" ${disabled ? "disabled" : ""}>${ui.icon(CF.POTIONS.mp.icon)}喝${ui.esc(CF.POTIONS.mp.name)}(x${potions.mp})</button>`;
    }
    html += `</div>`;
    return html;
  }

  function equipSummary(equipment) {
    const labels = { weapon: "武器", armor: "防具", accessory: "飾品" };
    return Object.keys(labels)
      .map((slot) => {
        const item = equipment[slot];
        return `<span class="cc-stat">${labels[slot]}:${item ? ui.esc(item.name) : "(無)"}${item && item.rarity !== "common" ? rarityTag(item.rarity) : ""}</span>`;
      })
      .join("");
  }

  // ---------------- 分頁籤列 ----------------

  function renderTabsBar() {
    return `
      <div class="folder-tabs" id="tower-tabs">
        ${TABS.map(
          (t) => `<div class="folder-tab${activeTab === t.key ? " active" : ""}" data-tab="${t.key}">${ui.icon(t.icon)}${ui.esc(t.label)}</div>`
        ).join("")}
      </div>`;
  }

  // ---------------- 分頁1:爬塔 ----------------

  function hourglassHint(text) {
    return `<div class="empty" style="margin:10px 0;font-size:12px;">${ui.icon("hourglass")}${ui.esc(text)}</div>`;
  }

  function renderPathPicker() {
    const tree = CareerData.CAREER_TREE;
    let html = `
      <div style="background:var(--panel2);border:2px solid var(--gold);border-radius:var(--radius);padding:14px;margin:12px 0;">
        <p style="margin:0 0 10px;font-weight:700;color:var(--gold);display:flex;align-items:center;gap:6px;">
          ${ui.icon("sparkles")}可以選系了!力量/敏捷/魔法選一個(選了這系，以後最終職業只能在這系裡選,不能臨時跳去別系)
        </p>
        <div class="career-class-grid">`;
    Object.keys(tree).forEach((pathKey) => {
      const path = tree[pathKey];
      const finalNames = Object.keys(path.lines)
        .map((lk) => path.lines[lk].final.name)
        .join(" / ");
      html += `
        <div class="career-class-card" data-path-pick="${pathKey}">
          <div class="cc-head">${ui.icon(path.icon)}${ui.esc(path.label)}</div>
          <div class="cc-desc">最終可以走向:${ui.esc(finalNames)}(Lv.${CareerData.TRANSFER_LEVEL_FINAL} 才會決定是哪一個)</div>
        </div>`;
    });
    html += `</div></div>`;
    return html;
  }

  function renderFinalPicker(pathKey) {
    const path = CareerData.CAREER_TREE[pathKey];
    if (!path) return "";
    let html = `
      <div style="background:var(--panel2);border:2px solid var(--gold);border-radius:var(--radius);padding:14px;margin:12px 0;">
        <p style="margin:0 0 10px;font-weight:700;color:var(--gold);display:flex;align-items:center;gap:6px;">
          ${ui.icon("sparkles")}可以定案最終職業了!在${ui.esc(path.label)}裡選一條線(轉職後就不能再改)
        </p>
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

  function renderBossBattleUi() {
    const active = progress.active_boss_battle;
    const s = active.state;
    const floorDef = CareerFloors.getFloor(active.floor) || { name: "關主" };
    const myInfo = CareerData.CLASS_INFO[s.class1];
    const monsterInfo = CareerData.CLASS_INFO[s.class2];
    const ultAffordable = (s.mp1 || 0) >= (CareerData.ULT_MANA_COST || 0);
    const skillAffordable = s.skillUnlocked1 && (s.mp1 || 0) >= (CareerData.SKILL_MANA_COST || 0);

    if (s.round !== bossSeenRound) {
      bossSeenRound = s.round;
      bossSubmitted = false;
    }
    if (s.m1) bossSubmitted = true;

    let html = `
      <div class="empty" style="margin-bottom:14px;">${ui.icon("swords")}王戰進行中:${ui.esc(floorDef.name)}(第${active.floor}層)</div>
      <div class="career-vs-row">
        <div class="career-side">
          <div class="cs-name">${ui.icon(myInfo.icon)}${ui.esc(myInfo.name)}</div>
          <div class="cs-sub">速度 ${s.spd1}</div>
          ${statBarRow("HP", `${s.hp1} / ${s.maxhp1}`, s.hp1 / s.maxhp1, "hp")}
          ${statBarRow("MP", `${s.mp1} / ${s.maxmp1}`, s.maxmp1 > 0 ? s.mp1 / s.maxmp1 : 0, "mp")}
        </div>
        <div class="career-vs-mid">VS</div>
        <div class="career-side right">
          <div class="cs-name">${ui.esc(floorDef.name)}${ui.icon(monsterInfo.icon)}</div>
          <div class="cs-sub">速度 ${s.spd2}</div>
          ${statBarRow("HP", `${s.hp2} / ${s.maxhp2}`, s.hp2 / s.maxhp2, "hp")}
          ${statBarRow("MP", `${s.mp2} / ${s.maxmp2}`, s.maxmp2 > 0 ? s.mp2 / s.maxmp2 : 0, "mp")}
        </div>
      </div>
      <div class="career-action-row" style="flex-wrap:wrap;">
        <button class="btn" id="boss-atk-btn" style="flex:1 1 28%;" ${bossSubmitted ? "disabled" : ""}>${ui.icon("sword")}普通攻擊</button>
        ${
          s.skillUnlocked1
            ? `<button class="btn ghost" id="boss-skill-btn" style="flex:1 1 28%;" ${bossSubmitted || !skillAffordable ? "disabled" : ""}>
                ${ui.icon("wand-sparkles")}${ui.esc(CareerData.SKILL_NAME[s.class1] || "戰技")}(${CareerData.SKILL_MANA_COST || 0}魔力)
              </button>`
            : ""
        }
        <button class="btn career-ult-btn" id="boss-ult-btn" style="flex:1 1 28%;" ${bossSubmitted || !ultAffordable ? "disabled" : ""}>
          ${ui.icon("flame")}${ui.esc(myInfo.ultName)}(${CareerData.ULT_MANA_COST || 0}魔力)${!ultAffordable ? "(魔力不足)" : ""}
        </button>
      </div>
      <p style="text-align:center;font-size:11.5px;color:var(--ink-dim);margin:10px 0 0;">
        ${bossSubmitted ? "已送出這回合的動作，結算中..." : `第 ${s.round} 回合，剩餘 <span id="boss-round-timer">30</span> 秒`}
      </p>
      <div style="text-align:center;margin-top:10px;">
        <button class="btn ghost small" id="boss-retreat-btn">${ui.icon("flag")}撤退(保留目前HP/MP，不算輸)</button>
      </div>
      <div class="log-panel career-log-panel" style="margin-top:12px;">${
        (s.log || [])
          .slice()
          .reverse()
          .map((line) => `<div>${ui.esc(line)}</div>`)
          .join("") || `<div style="color:var(--ink-dim);">還沒有任何回合紀錄</div>`
      }</div>`;
    return html;
  }

  function renderTowerTab(ctx) {
    if (progress.active_boss_battle) return renderBossBattleUi();
    const { locked, hasPendingEvent, canTrain, trainCooldownMs, nextFloor, nextFloorDef, isAutoFarming } = ctx;
    let html = "";

    if (hasPendingEvent) html += renderPendingEventCard(progress.pending_event);

    const cls = myBuild.final_class;
    const isBaseNovice = cls === "novice";
    const isPathNovice = cls.startsWith("novice_");

    if (isBaseNovice && progress.level < CareerData.TRANSFER_LEVEL_PATH) {
      html += hourglassHint(`Lv.${CareerData.TRANSFER_LEVEL_PATH} 就可以選一個系了，繼續練功吧(目前 Lv.${progress.level})`);
    } else if (isBaseNovice && !locked) {
      html += renderPathPicker();
    } else if (isPathNovice && progress.level < CareerData.TRANSFER_LEVEL_FINAL) {
      html += hourglassHint(
        `Lv.${CareerData.TRANSFER_LEVEL_FINAL} 就可以在${CareerData.CLASS_INFO[cls].pathLabel}定案最終職業了，繼續練功吧(目前 Lv.${progress.level})`
      );
    } else if (isPathNovice && !locked) {
      html += renderFinalPicker(myBuild.path);
    }

    if (progress.stat_points > 0 && !locked) {
      const isMagic = CareerData.CLASS_INFO[cls].path === "magic";
      html += `
        <div style="background:var(--panel2);border:1px solid var(--gold-d);border-radius:var(--radius);padding:12px;margin:12px 0;">
          <p style="margin:0 0 8px;font-size:12.5px;color:var(--gold);font-weight:700;">
            ${ui.icon("sparkles")}你有 ${progress.stat_points} 點自由數值點可以分配!
          </p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${isMagic ? `<button class="btn small" data-alloc="matk">魔攻+1</button>` : `<button class="btn small" data-alloc="atk">攻擊+1</button>`}
            <button class="btn small" data-alloc="def">防禦+1</button>
            <button class="btn small" data-alloc="spd">速度+1</button>
            <button class="btn small" data-alloc="hp">HP+3</button>
            <button class="btn small" data-alloc="luck">幸運+1</button>
          </div>
        </div>`;
    }

    if (progress.skill_points > 0 && !progress.unlocked_skill && !locked) {
      const skillName = CareerData.SKILL_NAME[cls] || "戰技";
      html += `
        <div style="background:var(--panel2);border:1px solid var(--gold-d);border-radius:var(--radius);padding:12px;margin:12px 0;">
          <p style="margin:0 0 8px;font-size:12.5px;color:var(--gold);font-weight:700;">
            ${ui.icon("wand-sparkles")}你有 ${progress.skill_points} 點技能點!花1點解鎖戰技「${ui.esc(skillName)}」
          </p>
          <p style="margin:0 0 8px;font-size:11px;color:var(--ink-dim);">${ui.esc(CareerData.skillDesc())}。對戰/王戰裡多一個選項，比大招便宜、效果單純，守衛/巫醫解鎖後終於有主動輸出手段了。</p>
          <button class="btn small" id="unlock-skill-btn">${ui.icon("wand-sparkles")}解鎖戰技(消耗1技能點)</button>
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

    if (isAutoFarming) html += autoFarmStatusHtml();

    if (progress.floor > 0 && !locked) {
      const chips = [];
      for (let f = 1; f <= progress.floor; f++) chips.push(f);
      html += `
        <div style="margin-top:10px;">
          <p style="font-size:11px;color:var(--ink-dim);margin:0 0 6px;">已清樓層，可以重新挑戰穩定 farm:</p>
          <div style="display:flex;gap:6px;flex-wrap:wrap;">
            ${chips.map((f) => `<button class="btn ghost small" data-retry-floor="${f}">第${f}層</button>`).join("")}
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
                  ${b.drop ? ` · 掉落「${ui.esc(b.drop.name)}」${rarityTag(b.drop.rarity)}放進背包了` : ""}
                  <br/>剩餘 HP ${effHp}/${stats.maxHp}，MP ${effMp}/${stats.maxMp}
                </p>`
              : `<p style="font-size:12px;color:var(--ink-dim);margin:0 0 6px;">留在原樓層，沒有拿到獎勵，可以馬上再試一次。<br/>剩餘 HP ${effHp}/${stats.maxHp}，MP ${effMp}/${stats.maxMp}${effHp <= Math.round(stats.maxHp * 0.35) ? "，HP剩不多了，先喝藥水或休息一下比較保險" : ""}</p>`
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
        : `<div style="color:var(--ink-dim);">還沒有任何戰報，按上面的按鈕開始爬塔吧</div>`
    }</div>`;

    return html;
  }

  // ---------------- 分頁2:商店 ----------------

  function renderShopTab(locked) {
    const CF = CareerFloors;
    const statPrice = CF.statPointPrice(progress.stat_points_bought);
    const weaponTable = CF.WEAPON_TABLE[myBuild.final_class] || CF.WEAPON_TABLE.novice;

    function equipRow(slot, label, table) {
      const rows = CF.RARITIES.map((rarity) => {
        const [min, max] = CF.EQUIPMENT_PRICE_RANGE[rarity];
        const item = table[rarity];
        const isLegendary = rarity === "legendary";
        const disabled = locked || (isLegendary && progress.legendary_purchased);
        const reqLevel = CF.RARITY_REQ_LEVEL[rarity] || 1;
        return `
          <div class="shop-row">
            ${rarityTag(rarity)}
            <div class="shop-row-name">${ui.esc(item.name)}<span class="shop-row-desc">${CF.describeItem(item)}${reqLevel > 1 ? ` · 要 Lv.${reqLevel} 才穿得動` : ""}</span></div>
            <button class="btn small" data-buy-equip="${slot}:${rarity}" ${disabled ? "disabled" : ""}>
              ${min}~${max}幣${isLegendary && progress.legendary_purchased ? "(已購買)" : ""}
            </button>
          </div>`;
      }).join("");
      return `
        <div style="margin-bottom:14px;">
          <p class="shop-section-title">${label}</p>
          ${rows}
        </div>`;
    }

    return `
      <p style="margin:0 0 12px;font-size:11px;color:var(--ink-dim);">價格會有一點浮動；傳說裝備整場只能買 1 件(商店買或抽獎機中都算)。</p>

      <div class="shop-row" style="margin-bottom:14px;">
        ${ui.icon("sparkles")}
        <div class="shop-row-name">自由數值點<span class="shop-row-desc">下一次會更貴</span></div>
        <button class="btn small" id="buy-statpoint-btn" ${locked ? "disabled" : ""}>花 ${statPrice} 幣買 1 點</button>
      </div>

      <div style="margin-bottom:14px;">
        <p class="shop-section-title">藥水(消耗品，喝掉才生效)</p>
        <div class="shop-row">
          ${ui.icon(CF.POTIONS.hp.icon)}
          <div class="shop-row-name">${ui.esc(CF.POTIONS.hp.name)}<span class="shop-row-desc">恢復 ${Math.round(CF.POTIONS.hp.healRatio * 100)}% HP上限 · 目前 ${(progress.potions && progress.potions.hp) || 0} 瓶</span></div>
          <button class="btn small" data-buy-potion="hp" ${locked ? "disabled" : ""}>${CF.POTIONS.hp.price}幣</button>
        </div>
        <div class="shop-row">
          ${ui.icon(CF.POTIONS.mp.icon)}
          <div class="shop-row-name">${ui.esc(CF.POTIONS.mp.name)}<span class="shop-row-desc">恢復 ${Math.round(CF.POTIONS.mp.healRatio * 100)}% MP上限 · 目前 ${(progress.potions && progress.potions.mp) || 0} 瓶</span></div>
          <button class="btn small" data-buy-potion="mp" ${locked ? "disabled" : ""}>${CF.POTIONS.mp.price}幣</button>
        </div>
      </div>

      ${equipRow("weapon", `武器(${ui.esc(CareerData.CLASS_INFO[myBuild.final_class].name)}專屬)`, weaponTable)}
      ${equipRow("armor", "防具", CF.EQUIPMENT_TABLE.armor)}
      ${equipRow("accessory", "飾品", CF.EQUIPMENT_TABLE.accessory)}

      <div>
        <p class="shop-section-title">戰功勳章(純加排行分，不影響戰鬥數值)</p>
        ${CF.MEDAL_TIERS.map(
          (t) => `
          <div class="shop-row">
            ${ui.icon("medal")}
            <div class="shop-row-name">${ui.esc(t.name)}<span class="shop-row-desc">排行分 +${t.scoreBonus}</span></div>
            <button class="btn ghost small" data-buy-medal="${t.key}" ${locked ? "disabled" : ""}>${t.price}幣</button>
          </div>`
        ).join("")}
      </div>
      <p style="margin:12px 0 0;font-size:11px;color:var(--ink-dim);text-align:center;">想抽獎嗎?抽獎機獨立在隔壁「抽獎機」分頁。</p>`;
  }

  // ---------------- 分頁3:抽獎機 ----------------

  function renderGachaTab(locked) {
    const CF = CareerFloors;
    const poolRows = CF.GACHA_POOL.map(
      (p) => `
        <div class="shop-row">
          <span style="flex-shrink:0;font-weight:700;color:var(--gold);width:44px;">${Math.round(p.chance * 1000) / 10}%</span>
          <div class="shop-row-name">${ui.esc(p.label)}</div>
        </div>`
    ).join("");

    let resultHtml = "";
    if (lastGachaResult) {
      resultHtml = `
        <div style="margin-top:16px;padding:12px;border-radius:var(--radius);border:1px solid var(--gold-d);background:var(--panel2);text-align:center;">
          ${ui.icon("dices")}
          <p style="margin:6px 0 0;font-size:12.5px;color:var(--ink);">${ui.esc(lastGachaResult.text)}</p>
        </div>`;
    }

    return `
      <div style="text-align:center;">
        ${ui.icon("dices", { size: "32px" })}
        <p style="margin:10px 0 4px;font-weight:700;font-size:15px;">夜市抽獎機</p>
        <p style="margin:0 0 16px;font-size:11.5px;color:var(--ink-dim);">${CF.GACHA_PRICE} 幣抽一次，機率如下:</p>
      </div>
      ${poolRows}
      <div style="text-align:center;margin-top:16px;">
        <button class="btn" id="buy-gacha-btn" ${locked ? "disabled" : ""}>${ui.icon("dices")}抽一次(${CF.GACHA_PRICE}幣)</button>
      </div>
      ${resultHtml}`;
  }

  // ---------------- 分頁3:合成 ----------------

  function slotLabel(slot) {
    return { weapon: "武器", armor: "防具", accessory: "飾品" }[slot];
  }

  // 背包裡同一部位+同稀有度的東西通通長得一樣(武器是綁職業的，同職業同稀有度只有一款；
  // 防具/飾品本來就每個稀有度只有一款)，所以用 slot:rarity 分組、顯示一列+數量就夠，
  // 不用把10件一模一樣的東西列10行。
  function _itemReqLevel(item) {
    return item.reqLevel != null ? item.reqLevel : CareerFloors.RARITY_REQ_LEVEL[item.rarity] || 1;
  }

  function groupInventory() {
    const groups = {};
    (progress.inventory || []).forEach((item) => {
      const key = `${item.slot}:${item.rarity}`;
      const reqLevel = _itemReqLevel(item);
      if (!groups[key]) groups[key] = { ...item, count: 0, ids: [], minReq: reqLevel, maxReq: reqLevel };
      groups[key].count += 1;
      groups[key].ids.push(item.id);
      groups[key].minReq = Math.min(groups[key].minReq, reqLevel);
      groups[key].maxReq = Math.max(groups[key].maxReq, reqLevel);
    });
    // 每組把等級門檻最低的排最前面，穿裝時預設挑最容易穿的那件(equip用 ids[0])
    Object.values(groups).forEach((g) => {
      g.ids.sort((a, b) => {
        const itemA = (progress.inventory || []).find((it) => it.id === a);
        const itemB = (progress.inventory || []).find((it) => it.id === b);
        return _itemReqLevel(itemA) - _itemReqLevel(itemB);
      });
    });
    return groups;
  }

  function renderSynthesisTab(locked) {
    const CF = CareerFloors;
    const groups = groupInventory();
    const need = CF.SYNTHESIS_INPUT_COUNT;
    const options = [];
    ["weapon", "armor", "accessory"].forEach((slot) => {
      ["common", "rare"].forEach((rarity) => {
        const count = (groups[`${slot}:${rarity}`] || { count: 0 }).count;
        const nextRarity = CF.SYNTHESIS_PATH[rarity];
        options.push(
          `<option value="${slot}:${rarity}">${slotLabel(slot)} · ${CF.RARITY_LABEL[rarity]}(你有${count}件) → ${CF.RARITY_LABEL[nextRarity]}</option>`
        );
      });
    });

    let resultHtml = "";
    if (lastSynthesisResult) {
      const r = lastSynthesisResult;
      resultHtml = `
        <div style="margin-top:16px;padding:12px;border-radius:var(--radius);border:1px solid ${r.success ? "var(--gold-d)" : "var(--line)"};background:var(--panel2);text-align:center;">
          ${ui.icon(r.success ? "arrow-big-up" : "circle-x")}
          <p style="margin:6px 0 0;font-size:12.5px;color:${r.success ? "var(--gold)" : "var(--ink)"};">${ui.esc(r.text)}</p>
        </div>`;
    }

    return `
      <div style="text-align:center;">
        ${ui.icon("flask-conical", { size: "32px" })}
        <p style="margin:10px 0 4px;font-weight:700;font-size:15px;">裝備合成</p>
        <p style="margin:0 0 16px;font-size:11.5px;color:var(--ink-dim);line-height:1.7;">
          同部位、同稀有度的裝備湊滿 ${need} 件就能合成一次。<br/>
          成功機率 ${Math.round(CF.SYNTHESIS_SUCCESS_RATE * 100)}%，成功變成下一個稀有度；<br/>
          失敗只拿回 1 件隨機部位的普通裝備(等於虧了，賭運氣)。
        </p>
        <select id="synthesis-select" style="max-width:320px;width:100%;">
          ${options.join("")}
        </select>
        <div style="margin-top:14px;">
          <button class="btn" id="synthesize-btn" ${locked ? "disabled" : ""}>${ui.icon("arrow-big-up")}合成(消耗${need}件)</button>
        </div>
        ${resultHtml}
      </div>`;
  }

  // ---------------- 分頁4:背包 ----------------

  function renderBackpackTab() {
    const groups = groupInventory();
    let html = `<p class="shop-section-title">目前裝備</p>`;
    ["weapon", "armor", "accessory"].forEach((slot) => {
      const item = progress.equipment[slot];
      html += `
        <div class="shop-row">
          ${item ? rarityTag(item.rarity) : ui.icon("circle-slash")}
          <div class="shop-row-name">
            ${slotLabel(slot)}:${item ? ui.esc(item.name) : "(尚未裝備)"}
            ${item ? `<span class="shop-row-desc">${CareerFloors.describeItem(item)}</span>` : `<span class="shop-row-desc">去挑戰樓層、開商店或抽獎機都有機會拿到，拿到後要在下面手動穿上</span>`}
          </div>
          ${item ? `<button class="btn ghost small" data-unequip="${slot}">${ui.icon("shirt")}卸下</button>` : ""}
        </div>`;
    });

    const invRows = Object.keys(groups)
      .map((key) => {
        const g = groups[key];
        const reqLevel = g.minReq; // 挑最容易穿的那件當代表(equip按鈕預設也是穿它)
        const reqLevelText = g.minReq === g.maxReq ? `Lv.${g.minReq}` : `Lv.${g.minReq}~${g.maxReq}`;
        const canWear = progress.level >= reqLevel;
        return `
          <div class="shop-row">
            ${rarityTag(g.rarity)}
            <div class="shop-row-name">${ui.esc(g.name)}<span class="shop-row-desc">${CareerFloors.describeItem(g)} · 背包裡 ${g.count} 件 · 需要 ${reqLevelText}</span></div>
            <button class="btn small" data-equip-item="${g.ids[0]}" ${canWear ? "" : "disabled"}>${ui.icon("shirt")}${canWear ? "穿上" : `Lv.${reqLevel}才能穿`}</button>
          </div>`;
      })
      .join("");

    html += `<p class="shop-section-title" style="margin-top:16px;">背包(${(progress.inventory || []).length} 件)</p>`;
    html += invRows || `<div class="empty" style="font-size:12px;">${ui.icon("package-open")}背包是空的，去挑戰樓層、開商店或抽獎機拿裝備吧</div>`;
    return html;
  }

  // ---------------- 全服事件廣播 ----------------

  function highlightCardHtml() {
    if (!highlight) return "";
    return `
      <div style="text-align:center;padding:20px 16px;margin-bottom:14px;border-radius:var(--radius);border:2px solid var(--gold);background:radial-gradient(circle at 50% 0%, rgba(242,183,5,.15), var(--panel2));">
        ${ui.icon(highlight.icon, { size: "32px" })}
        <p style="margin:10px 0 4px;font-family:'Display',sans-serif;font-size:16px;color:var(--gold);letter-spacing:.05em;">${ui.esc(highlight.title)}</p>
        <p style="margin:0 0 14px;font-size:13px;color:var(--ink);">${ui.esc(highlight.text)}</p>
        <div style="display:flex;gap:8px;justify-content:center;">
          <button class="btn small" id="highlight-share-btn">${ui.icon("copy")}複製分享文字</button>
          <button class="btn ghost small" id="highlight-close-btn">${ui.icon("x")}關閉</button>
        </div>
      </div>`;
  }

  function broadcastTickerHtml() {
    if (!broadcasts.length) return "";
    const latest = broadcasts[0];
    const secAgo = Math.max(0, Math.round((Date.now() - new Date(latest.created_at).getTime()) / 1000));
    const timeText = secAgo < 60 ? `${secAgo}秒前` : `${Math.round(secAgo / 60)}分鐘前`;
    return `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:12px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);font-size:12px;overflow:hidden;">
        ${ui.icon(latest.icon || "megaphone")}
        <span style="flex:1;min-width:0;overflow-wrap:anywhere;">${ui.esc(latest.message)}</span>
        <span style="color:var(--ink-dim);flex-shrink:0;font-size:10.5px;">${timeText}</span>
      </div>`;
  }

  // ---------------- 主 render ----------------

  function render() {
    if (!progress) return;
    const info = CareerData.CLASS_INFO[myBuild.final_class];
    const stats = CareerData.applyProgress(myBuild.final_class, progress.stat_alloc, progress.equipment);
    // 王戰進行中的話，頂部這條HP/MP要顯示戰鬥當下的即時數值(active_boss_battle.state)，
    // 不是還沒結算的persisted current_hp/current_mp，不然畫面上會同時出現兩個對不上的HP。
    const liveBossState = progress.active_boss_battle && progress.active_boss_battle.state;
    const effHp = liveBossState ? liveBossState.hp1 : progress.current_hp != null ? Math.max(0, Math.min(progress.current_hp, stats.maxHp)) : stats.maxHp;
    const effMp = liveBossState ? liveBossState.mp1 : progress.current_mp != null ? Math.max(0, Math.min(progress.current_mp, stats.maxMp)) : stats.maxMp;
    const expNeed = CareerFloors.expToNextLevel(progress.level);
    const trainCooldownMs = new Date(progress.train_ready_at).getTime() - Date.now();
    const phase = getCareerPhase();
    const locked = phase !== "training"; // 只有訓練期才能做爬塔動作(還沒開始/已經結束都鎖)
    const hasPendingEvent = !!progress.pending_event;
    const canTrain = trainCooldownMs <= 0 && !locked && !hasPendingEvent;
    const nextFloor = progress.floor + 1;
    const nextFloorDef = CareerFloors.getFloor(nextFloor);
    const isAutoFarming = !!progress.auto_farm_floor;

    let html = "";
    if (locked) {
      const msg =
        phase === "not_started"
          ? "訓練期還沒開始，請等主辦人在後台按下「開始訓練期」，開始之後才能特訓/挑戰樓層/掛機。"
          : "訓練期已經結束，爬塔功能關閉了，你目前的加點跟裝備就是這場PVP要用的數值，前往上面的PVP對戰吧!";
      html += `<div class="empty" style="margin-bottom:14px;">${ui.icon(phase === "not_started" ? "hourglass" : "flag")}${ui.esc(msg)}</div>`;
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
      ${statBarRow("HP", `${effHp} / ${stats.maxHp}`, effHp / stats.maxHp, "hp")}
      ${statBarRow("MP", `${effMp} / ${stats.maxMp}`, stats.maxMp > 0 ? effMp / stats.maxMp : 0, "mp")}
      ${potionQuickBarHtml(locked || hasPendingEvent || !!progress.active_boss_battle)}
      <div class="cc-stats" style="margin:10px 0 4px;">
        ${info.path === "magic" ? `<span class="cc-stat">魔攻${stats.matk}</span>` : `<span class="cc-stat">攻${stats.atk}</span>`}
        <span class="cc-stat">防${stats.def}</span>
        <span class="cc-stat">速${stats.spd}</span>
        <span class="cc-stat">幸運${stats.luck}</span>
        ${equipSummary(progress.equipment)}
      </div>`;

    html += broadcastTickerHtml();
    html += highlightCardHtml();
    html += renderTabsBar();
    html += `<div class="card folder-tab-card" style="margin-top:0;">`;
    if (activeTab === "tower") {
      html += renderTowerTab({ locked, hasPendingEvent, canTrain, trainCooldownMs, nextFloor, nextFloorDef, isAutoFarming });
    } else if (activeTab === "shop") {
      html += renderShopTab(locked || hasPendingEvent);
    } else if (activeTab === "gacha") {
      html += renderGachaTab(locked || hasPendingEvent);
    } else if (activeTab === "synthesis") {
      html += renderSynthesisTab(locked || hasPendingEvent);
    } else if (activeTab === "backpack") {
      html += renderBackpackTab();
    }
    html += `</div>`;

    app.innerHTML = html;
    bindHandlers();
  }

  // ---------------- 事件綁定 ----------------

  function bindHandlers() {
    const bossAtkBtn = document.getElementById("boss-atk-btn");
    if (bossAtkBtn && !bossAtkBtn.disabled) bossAtkBtn.onclick = () => submitBossMove("attack");
    const bossUltBtn = document.getElementById("boss-ult-btn");
    if (bossUltBtn && !bossUltBtn.disabled) bossUltBtn.onclick = () => submitBossMove("ult");
    const bossSkillBtn = document.getElementById("boss-skill-btn");
    if (bossSkillBtn && !bossSkillBtn.disabled) bossSkillBtn.onclick = () => submitBossMove("skill");
    const bossRetreatBtn = document.getElementById("boss-retreat-btn");
    if (bossRetreatBtn) {
      bossRetreatBtn.onclick = async () => {
        const ok = await ui.confirm("確定要撤退嗎?保留目前的HP/MP，不算輸也不算贏，這場王戰結束。", { title: "撤退" });
        if (!ok) return;
        if (busy) return;
        busy = true;
        try {
          const result = await db.retreatCareerBossBattle(eventId, myId);
          progress = result.progress;
          bossSeenRound = null;
          bossSubmitted = false;
          clearInterval(bossRoundTimer);
          render();
        } catch (e) {
          await ui.alert(e.message || "撤退失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    }
    if (document.getElementById("boss-round-timer")) startBossRoundTimer();

    app.querySelectorAll("[data-use-potion]").forEach((btn) => {
      if (btn.disabled) return;
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await db.useCareerPotion(eventId, myId, btn.dataset.usePotion);
          progress = result.progress;
          lastEvent = {
            eventDef: { icon: result.potionDef.icon, name: result.potionDef.name },
            text: `喝下${result.potionDef.name}，恢復了 ${result.healed} 點${btn.dataset.usePotion === "hp" ? "HP" : "MP"}。`,
          };
          lastBattle = null;
          activeTab = "tower";
          render();
        } catch (e) {
          await ui.alert(e.message || "使用失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

    app.querySelectorAll("[data-tab]").forEach((tab) => {
      tab.onclick = () => {
        activeTab = tab.dataset.tab;
        render();
      };
    });

    app.querySelectorAll("[data-path-pick]").forEach((card) => {
      card.onclick = async () => {
        if (busy) return;
        busy = true;
        const pathKey = card.dataset.pathPick;
        app.querySelectorAll("[data-path-pick]").forEach((c) => (c.style.pointerEvents = "none"));
        card.style.opacity = "0.6";
        try {
          const result = await db.transferCareerPath(eventId, myId, pathKey);
          myBuild = result.build;
          progress = result.progress;
          const bonusText = Object.keys(result.bonus)
            .map((k) => `${CareerFloors.STAT_LABEL[k] || k}+${k === "hp" ? result.bonus[k] * 3 : k === "mp" ? result.bonus[k] * 2 : result.bonus[k]}`)
            .join("、");
          const packText = result.starterPack ? `，還送了 ${result.starterPack.hp || 0} 瓶恢復藥水、${result.starterPack.mp || 0} 瓶魔力藥水` : "";
          highlight = { icon: CareerData.CAREER_TREE[pathKey].icon, title: "轉職成功!", text: `數值提升:${bonusText}${packText}!` };
          activeTab = "tower";
          render();
        } catch (e) {
          await ui.alert(e.message || "選系失敗", { title: "操作失敗", tone: "danger" });
          render();
        } finally {
          busy = false;
        }
      };
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
          const result = await db.transferCareerFinalClass(eventId, myId, key, pathKey, info.skillKeys);
          myBuild = result.build;
          progress = result.progress;
          const bonusText = Object.keys(result.bonus)
            .map((k) => `${CareerFloors.STAT_LABEL[k] || k}+${k === "hp" ? result.bonus[k] * 3 : k === "mp" ? result.bonus[k] * 2 : result.bonus[k]}`)
            .join("、");
          highlight = { icon: info.icon, title: `轉職成${info.name}!`, text: `數值提升:${bonusText}!從今以後你就是${info.name}了。` };
          activeTab = "tower";
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

    const unlockSkillBtn = document.getElementById("unlock-skill-btn");
    if (unlockSkillBtn) {
      unlockSkillBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        unlockSkillBtn.disabled = true;
        try {
          progress = await db.unlockCareerSkill(eventId, myId);
          const skillName = CareerData.SKILL_NAME[myBuild.final_class] || "戰技";
          highlight = { icon: "wand-sparkles", title: "戰技解鎖!", text: `解鎖了「${skillName}」，對戰時多一個選項了。` };
          render();
        } catch (e) {
          await ui.alert(e.message || "解鎖失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    }

    app.querySelectorAll("[data-event-choice]").forEach((btn) => {
      btn.onclick = () => resolveEventChoice(btn.dataset.eventChoice);
    });

    app.querySelectorAll("[data-buy-potion]").forEach((btn) => {
      if (btn.disabled) return;
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await db.buyCareerPotion(eventId, myId, btn.dataset.buyPotion);
          progress = result.progress;
          lastEvent = { eventDef: { icon: result.potionDef.icon, name: "商店" }, text: `花 ${result.potionDef.price} 幣買了 1 瓶${result.potionDef.name}。` };
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
          activeTab = "tower";
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
          lastEvent = { eventDef: { icon: "shopping-bag", name: "商店" }, text: `花 ${result.price} 幣買下「${result.item.name}」，放進背包了，去「背包」分頁穿上。` };
          lastBattle = null;
          if (rarity === "legendary") {
            highlight = { icon: "crown", title: "傳說降臨!", text: `你在商店買到了傳說裝備「${result.item.name}」!` };
          }
          activeTab = "tower";
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
          lastGachaResult = result;
          if (result.drop && result.drop.rarity === "legendary") {
            highlight = { icon: "crown", title: "頭獎!", text: `抽獎機給了你傳說裝備「${result.drop.name}」!` };
          }
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
          activeTab = "tower";
          render();
        } catch (e) {
          await ui.alert(e.message || "購買失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

    const synthesizeBtn = document.getElementById("synthesize-btn");
    if (synthesizeBtn && !synthesizeBtn.disabled) {
      synthesizeBtn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const select = document.getElementById("synthesis-select");
          const [slot, rarity] = select.value.split(":");
          const result = await db.synthesizeCareerEquipment(eventId, myId, slot, rarity);
          progress = result.progress;
          lastSynthesisResult = {
            success: result.success,
            text: result.success ? `合成成功!升級成「${result.item.name}」了!` : `合成失敗，只拿回 1 件「${result.item.name}」，運氣不好，再試一次吧。`,
          };
          render();
        } catch (e) {
          await ui.alert(e.message || "合成失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    }

    app.querySelectorAll("[data-equip-item]").forEach((btn) => {
      if (btn.disabled) return;
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await db.equipCareerItem(eventId, myId, btn.dataset.equipItem);
          progress = result.progress;
          render();
        } catch (e) {
          await ui.alert(e.message || "穿上失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });
    app.querySelectorAll("[data-unequip]").forEach((btn) => {
      btn.onclick = async () => {
        if (busy) return;
        busy = true;
        try {
          const result = await db.unequipCareerItem(eventId, myId, btn.dataset.unequip);
          progress = result.progress;
          render();
        } catch (e) {
          await ui.alert(e.message || "卸下失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

    const highlightCloseBtn = document.getElementById("highlight-close-btn");
    if (highlightCloseBtn) {
      highlightCloseBtn.onclick = () => {
        highlight = null;
        render();
      };
    }
    const highlightShareBtn = document.getElementById("highlight-share-btn");
    if (highlightShareBtn) {
      highlightShareBtn.onclick = async () => {
        const text = `${highlight.title} ${highlight.text}(擂台夜市 · ${ev.name})`;
        try {
          await navigator.clipboard.writeText(text);
          highlightShareBtn.innerHTML = ui.icon("check") + "已複製!";
        } catch (e) {
          await ui.alert("複製失敗，請手動選取文字複製。", { title: "複製失敗" });
        }
      };
    }
  }

  async function submitBossMove(action) {
    if (bossSubmitted) return;
    bossSubmitted = true;
    clearInterval(bossRoundTimer);
    const atkBtn = document.getElementById("boss-atk-btn");
    const ultBtn = document.getElementById("boss-ult-btn");
    const skillBtn = document.getElementById("boss-skill-btn");
    if (atkBtn) atkBtn.disabled = true;
    if (ultBtn) ultBtn.disabled = true;
    if (skillBtn) skillBtn.disabled = true;
    try {
      const result = await db.submitCareerBossMove(eventId, myId, action);
      progress = result.progress;
      if (result.done) {
        bossSeenRound = null;
        bossSubmitted = false;
        if (result.won) {
          lastBattle = { ...result, log: result.log };
          if (result.topFloorCleared) {
            highlight = { icon: "mountain", title: "爬塔完賽!", text: `你爬完了目前開放的所有樓層(第${result.floorDef.floor}層)!` };
          } else {
            highlight = { icon: "swords", title: "王戰勝利!", text: `打贏了第${result.floorDef.floor}層的關主「${result.floorDef.name}」!` };
          }
        } else {
          lastBattle = { won: false, log: result.log, floorDef: result.floorDef };
        }
      }
      render();
    } catch (e) {
      bossSubmitted = false;
      await ui.alert(e.message || "出招失敗", { title: "操作失敗", tone: "danger" });
      await loadAndRender();
    } finally {
      busy = false;
    }
  }

  function startBossRoundTimer() {
    clearInterval(bossRoundTimer);
    if (bossSubmitted) return;
    let remain = 30;
    const label = document.getElementById("boss-round-timer");
    if (label) label.textContent = String(remain);
    bossRoundTimer = setInterval(() => {
      remain -= 1;
      const el = document.getElementById("boss-round-timer");
      if (el) el.textContent = String(Math.max(0, remain));
      if (remain <= 0) {
        clearInterval(bossRoundTimer);
        if (!bossSubmitted) {
          busy = true;
          submitBossMove("attack");
        }
      }
    }, 1000);
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
      if (result.bossBattle) {
        // 王戰開打，畫面切到即時對戰UI(見 renderBossBattleUi())，不是戰報
        bossSeenRound = null;
        bossSubmitted = false;
        lastBattle = null;
        lastEvent = null;
      } else if (result.pending) {
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
        if (result.topFloorCleared) {
          highlight = { icon: "mountain", title: "爬塔完賽!", text: `你爬完了目前開放的所有樓層(第${result.floorDef.floor}層)!` };
        }
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

  function bindRuleModal() {
    const fabBtn = document.getElementById("rule-fab-btn");
    const modal = document.getElementById("rule-modal");
    const closeBtn = document.getElementById("rule-close-btn");
    if (!fabBtn || !modal) return;
    fabBtn.onclick = () => {
      document.getElementById("rule-content").innerHTML = CareerRules.html();
      modal.classList.add("show");
    };
    if (closeBtn) closeBtn.onclick = () => modal.classList.remove("show");
  }
  bindRuleModal();

  init();
})();
