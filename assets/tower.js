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
    { key: "skilltree", icon: "wand-sparkles", label: "技能樹" },
    { key: "backpack", icon: "backpack", label: "背包" },
  ];

  let ev = null;
  let myId = null;
  let myBuild = null;
  let progress = null;
  let skillLevels = {}; // 第22點更新:永久被動等級(通用被動+職業被動，只綁player_id，跨活動/跨賽季都不會重置)
  let skillTreeSubTab = "skills"; // 技能樹分頁裡的子分頁:"path"(轉職路線) | "skills"(技能・大招) | "passives"(被動)

  // 2026-09玩家回饋確認:技能A/B、大招1/2 不永久，是「這場活動自己的」，存在 progress.active_skills。
  function _activeSkills() {
    return (progress && progress.active_skills) || { ult_1: 1 };
  }
  let lastBattle = null; // { won, log, floorDef, coinGain, expGain, leveledUp, drop }
  let lastEvent = null; // { eventDef, text, drop } — instant事件/商店購買結果(顯示在爬塔分頁)
  let lastGachaResult = null; // 抽獎結果(顯示在抽獎機分頁，不會跳走)
  let lastSynthesisResult = null; // 合成結果(顯示在合成分頁，不會跳走)
  let bossSubmitted = false; // 王戰:這回合是否已經送出動作
  let bossSeenRound = null;
  let bossRoundTimer = null;
  let broadcasts = [];
  let standings = []; // 目前排行榜，顯示在頁面最下面，每次背景掃描順便刷新一次
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
    standings = await db.computeCareerStandings(eventId).catch(() => []);

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
        standings = await db.computeCareerStandings(eventId).catch(() => standings);
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
    skillLevels = await db.getPlayerSkillLevels(myId).catch(() => skillLevels || {});
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

  // 技能樹 v2 Phase 2:Lv.1~4(final_class還是"novice"，還沒選系)不顯示「技能樹」分頁，
  // 那時候只有普攻+拼盡全力，沒有技能可以點，秀出一個空分頁只會讓人疑惑。選系之後
  // (final_class變成"novice_xxx"或更後面)分頁就會出現。
  function visibleTabs() {
    const isBaseNovice = myBuild && myBuild.final_class === "novice";
    if (!isBaseNovice) return TABS;
    return TABS.filter((t) => t.key !== "skilltree");
  }

  function renderTabsBar() {
    const tabs = visibleTabs();
    return `
      <div class="folder-tabs" id="tower-tabs">
        ${tabs.map(
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
    const skill2Affordable = s.skill2Unlocked1 && (s.mp1 || 0) >= (CareerData.SKILL_MANA_COST || 0);
    const ultDisplayName = s.ultName1 || myInfo.ultName; // Phase 4:大招可能被換成大招2，用state裡實際裝備的名字，不是職業固定的預設名字

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
                ${ui.icon("wand-sparkles")}${ui.esc(s.skillAName1 || CareerData.SKILL_NAME[s.class1] || "戰技")}(${CareerData.SKILL_MANA_COST || 0}魔力)
              </button>`
            : ""
        }
        ${
          s.skill2Unlocked1
            ? `<button class="btn ghost" id="boss-skill2-btn" style="flex:1 1 28%;" ${bossSubmitted || !skill2Affordable ? "disabled" : ""}>
                ${ui.icon("sparkles")}${ui.esc(s.skillBName1 || "技能B")}(${CareerData.SKILL_MANA_COST || 0}魔力)
              </button>`
            : ""
        }
        <button class="btn career-ult-btn" id="boss-ult-btn" style="flex:1 1 28%;" ${bossSubmitted || !ultAffordable ? "disabled" : ""}>
          ${ui.icon("flame")}${ui.esc(ultDisplayName)}(${CareerData.ULT_MANA_COST || 0}魔力)${!ultAffordable ? "(魔力不足)" : ""}
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
    // 戰報要顯示戰鬥後剩餘的HP/MP，這兩個數字在主 render() 裡已經算過一次，但那邊的區域變數
    // 沒辦法被這支獨立的函式讀到(不是巢狀函式，沒有共用closure)，這裡重新算一次同樣的東西。
    const battleStats = CareerData.applyStatBoostPassives(CareerData.applyProgress(myBuild.final_class, progress.stat_alloc, progress.equipment), skillLevels);
    const effHp = progress.current_hp != null ? Math.max(0, Math.min(progress.current_hp, battleStats.maxHp)) : battleStats.maxHp;
    const effMp = progress.current_mp != null ? Math.max(0, Math.min(progress.current_mp, battleStats.maxMp)) : battleStats.maxMp;
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
            <button class="btn small" data-alloc="hp">HP+10</button>
            <button class="btn small" data-alloc="mp">MP+2</button>
            <button class="btn small" data-alloc="luck">幸運+1</button>
          </div>
        </div>`;
    }

    if (progress.skill_points > 0 && !locked) {
      html += `<div class="empty" style="margin:10px 0;font-size:12px;">${ui.icon("wand-sparkles")}你有 ${progress.skill_points} 點技能點可以花，去「技能樹」分頁升級戰技或被動(永久保留，不會歸零)!</div>`;
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
                  <br/>剩餘 HP ${effHp}/${battleStats.maxHp}，MP ${effMp}/${battleStats.maxMp}
                </p>`
              : `<p style="font-size:12px;color:var(--ink-dim);margin:0 0 6px;">留在原樓層，沒有拿到獎勵，可以馬上再試一次。<br/>剩餘 HP ${effHp}/${battleStats.maxHp}，MP ${effMp}/${battleStats.maxMp}${effHp <= Math.round(battleStats.maxHp * 0.35) ? "，HP剩不多了，先喝藥水或休息一下比較保險" : ""}</p>`
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

  // ---------------- 分頁:技能樹 ----------------
  // 玩家實測回饋(2026-09)後重做過一次:
  //   1. 以前上面有一份「現況」卡片(普攻/戰技/大招)、下面又有一份「路線圖」卡片，同樣的技能A/大招
  //      重複出現兩次，很亂。現在合併成一份，用子分頁分類(轉職路線／技能・大招／被動)，不用整頁滾動。
  //   2. 以前職業限定的節點(技能A/B、大招1/2、職業被動)要等 Lv.15 定案職業才會出現，其他時候完全看不到。
  //      現在只要選過系(Lv.5)，就會把「該系底下兩個候選職業」的整組節點都預覽出來(灰色、不能點)，
  //      定案之後才會變成單一職業、可以真的升級/裝備。
  function renderSkillTreeTab(locked) {
    const cls = myBuild.final_class;
    const CD = CareerData;
    const isNoviceStage = cls === "novice" || cls.startsWith("novice_");
    const chosenPath = myBuild && myBuild.path; // "strength" | "agility" | "magic"(這個分頁本來就只有選過系才看得到)
    const chosenClass = isNoviceStage ? null : cls; // 只有定案最終職業才有值
    const canSpend = progress.skill_points > 0 && !locked;

    const subTabs = [
      { key: "path", label: "轉職路線", icon: "git-branch" },
      { key: "skills", label: "技能・大招", icon: "wand-sparkles" },
      { key: "passives", label: "被動", icon: "sparkles" },
    ];
    let html = `
      <div style="text-align:center;margin-bottom:14px;">
        <p style="margin:0;font-size:11.5px;color:var(--ink-dim);">
          目前有 ${progress.skill_points} 點技能點可以花(每升1級送1點)，升級/解鎖結果永久保留，換下一場活動、下一個賽季也不會歸零。
        </p>
      </div>
      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-bottom:16px;">
        ${subTabs
          .map(
            (t) =>
              `<button class="btn ${skillTreeSubTab === t.key ? "" : "ghost"} small" data-skilltree-subtab="${t.key}">${ui.icon(t.icon, { size: "14px" })}${t.label}</button>`
          )
          .join("")}
      </div>`;

    if (skillTreeSubTab === "path") {
      html += renderSkillTreePathSection(chosenPath, chosenClass);
    } else if (skillTreeSubTab === "skills") {
      html += renderSkillTreeSkillsSection(chosenPath, chosenClass, canSpend);
      if (isNoviceStage) {
        html += `<p style="text-align:center;margin-top:12px;font-size:11px;color:var(--ink-dim);">還沒轉職完成，普通攻擊、大招現在都還是「${ui.esc(CD.CLASS_INFO[cls].name)}」這個過渡階段的內容，轉職後會自動換成正式職業的。</p>`;
      }
    } else {
      html += renderSkillTreePassivesSection(chosenPath, chosenClass, canSpend);
    }

    return html;
  }

  // 子分頁1:轉職路線(選系→選職業的樹狀路線圖，走過的是金線，其他是灰線)
  function renderSkillTreePathSection(chosenPath, chosenClass) {
    const CD = CareerData;

    function branchNode(node, chosen) {
      return `
        <div style="position:relative;flex:1;min-width:100px;max-width:150px;background:${chosen ? "var(--panel2)" : "transparent"};border:1px solid ${chosen ? "var(--gold)" : "var(--line)"};border-radius:var(--radius);padding:10px;text-align:center;opacity:${chosen ? "1" : "0.5"};">
          <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:${chosen ? "var(--gold)" : "var(--line)"};"></div>
          ${ui.icon(node.icon, { size: "18px" })}
          <p style="margin:6px 0 0;font-weight:700;font-size:12px;">${ui.esc(node.name)}</p>
          <span style="font-size:10px;color:${chosen ? "var(--green)" : "var(--ink-dim)"};">${chosen ? "已選擇" : "未選擇"}</span>
        </div>`;
    }
    // 每一層中間畫一條置中的直線接到下一層，簡化畫法(整排中點接整排中點)，不是每張卡片精準連線
    function connector(chosenColor) {
      return `<div style="width:2px;height:18px;margin:0 auto;background:${chosenColor ? "var(--gold)" : "var(--line)"};"></div>`;
    }

    const pathNodes = CD.getSkillTreeRoots().filter((n) => n.type === "branch");
    let html = `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">${pathNodes.map((n) => branchNode(n, n.effect.unlocksPathKey === chosenPath)).join("")}</div>`;
    html += connector(true); // 這個分頁本來就只有選過系才看得到，這條線一定是走過的
    const classNodes = CD.getSkillTreeChildren(`path_${chosenPath}`);
    html += `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">${classNodes.map((n) => branchNode(n, n.effect.unlocksClassKey === chosenClass)).join("")}</div>`;
    if (!chosenClass) {
      html += connector(false);
      html += `<p style="text-align:center;font-size:11px;color:var(--ink-dim);margin-top:-4px;">Lv.15 選定最終職業後，「技能・大招」「被動」分頁會從預覽變成可以實際升級</p>`;
    }
    return html;
  }

  // 子分頁2:技能・大招(技能A/B + 大招1/2)。有定案職業就是真的能升級/裝備的內容；
  // 只選了系、還沒定案職業的話，把該系底下兩個候選職業的整組內容都預覽出來(灰色，不能點)。
  // 玩家回饋(2026-09):分不清楚哪個是技能、哪個是大招，所以這裡拆成「主動技能」跟「大招」
  // 兩個小標題分開列，不要混在一起。
  function renderSkillTreeSkillsSection(chosenPath, chosenClass, canSpend) {
    const CD = CareerData;
    const atkCard = `
      <div style="display:flex;flex-direction:column;flex:1;min-width:130px;max-width:160px;background:var(--panel2);border:1px solid var(--line);border-radius:var(--radius);padding:10px;text-align:center;">
        ${ui.icon("sword", { size: "18px" })}
        <p style="margin:6px 0 0;font-weight:700;font-size:12px;">普通攻擊</p>
        <p style="margin:2px 0 6px;font-size:10px;color:var(--ink-dim);">基礎攻擊，不用學，隨時可用</p>
        <div style="margin-top:auto;"><span style="font-size:10px;color:var(--green);font-weight:700;">${ui.icon("check", { size: "12px" })}已學會</span></div>
      </div>`;

    function group(title, icon, cardsHtml) {
      return `<p style="text-align:center;margin:16px 0 8px;font-size:12px;font-weight:700;color:var(--ink-dim);">${ui.icon(icon, { size: "13px" })}${title}</p><div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">${cardsHtml}</div>`;
    }

    if (chosenClass) {
      const kitNodes = CD.getSkillTreeChildren(`class_${chosenClass}`);
      const skillNodes = kitNodes.filter((n) => n.type === "active_skill");
      const ultNodes = kitNodes.filter((n) => n.type === "ultimate");
      const activeSkills = _activeSkills();
      const equippedUltId = progress.equipped_ult || `${chosenClass}_ult_1`;
      const equippedSkillA = progress.equipped_skill_a || "skill_1";
      const equippedSkillB = progress.equipped_skill_b || "skill_2";
      let html = group(
        "主動技能・3選2自由裝備(這場活動自己的等級，換下一場活動會重新歸零)",
        "wand-sparkles",
        atkCard + skillNodes.map((n) => skillTreeKitCard(n, chosenClass, activeSkills, canSpend, equippedUltId, equippedSkillA, equippedSkillB, true)).join("")
      );
      html += group("大招・2選1自由裝備(免費隨時換裝，但等級一樣是這場活動自己的)", "flame", ultNodes.map((n) => skillTreeKitCard(n, chosenClass, activeSkills, canSpend, equippedUltId, equippedSkillA, equippedSkillB, true)).join(""));
      return html;
    }

    // 還沒定案職業:把候選職業都預覽出來，一次一個職業一組灰卡
    const classBranches = CD.getSkillTreeChildren(`path_${chosenPath}`);
    let html = group("主動技能", "wand-sparkles", atkCard);
    classBranches.forEach((branch) => {
      const previewClass = branch.effect.unlocksClassKey;
      const info = CD.CLASS_INFO[previewClass];
      const skillNodes = CD.getSkillTreeChildren(`class_${previewClass}`).filter((n) => n.type === "active_skill");
      const ultNodes = CD.getSkillTreeChildren(`class_${previewClass}`).filter((n) => n.type === "ultimate");
      html += `<p style="text-align:center;margin:10px 0 4px;font-size:11px;color:var(--ink-dim);">${ui.icon(info.icon, { size: "13px" })}如果選「${ui.esc(info.name)}」(預覽)</p>`;
      html += `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">${skillNodes.map((n) => skillTreeKitCard(n, previewClass, {}, false, `${previewClass}_ult_1`, "skill_1", "skill_2", false)).join("")}</div>`;
      html += `<p style="text-align:center;margin:14px 0 4px;font-size:12px;font-weight:700;color:var(--ink-dim);">${ui.icon("flame", { size: "13px" })}大招(預覽)</p>`;
      html += `<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;">${ultNodes.map((n) => skillTreeKitCard(n, previewClass, {}, false, `${previewClass}_ult_1`, "skill_1", "skill_2", false)).join("")}</div>`;
    });
    return html;
  }

  // 子分頁3:被動(通用被動8個 + 職業被動)。職業被動的預覽規則跟技能・大招分頁一樣。
  function renderSkillTreePassivesSection(chosenPath, chosenClass, canSpend) {
    const CD = CareerData;
    // 把「數值精研」那7個(固定加數值的)跟其他8個(功能型效果)分成兩組顯示，不要混在一起，
    // 不然玩家很難一眼分辨「這個被動是加數值還是加效果」。STAT_BOOST_KEYS 的 key 就是7個數值精研。
    const statKeys = CD.PASSIVE_KEYS.filter((key) => CD.STAT_BOOST_KEYS[key]);
    const otherKeys = CD.PASSIVE_KEYS.filter((key) => !CD.STAT_BOOST_KEYS[key]);
    let html = `
      <p style="text-align:center;margin:0 0 12px;font-weight:700;font-size:14px;">
        ${ui.icon("sparkles")}永久被動<span style="font-weight:400;color:var(--ink-dim);font-size:11.5px;"> · 跨活動、跨賽季永久繼承</span>
      </p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
        ${otherKeys.map((key) => passiveCard(key, skillLevels[key] || 0, canSpend)).join("")}
      </div>`;

    html += `<p style="text-align:center;margin:20px 0 12px;font-weight:700;font-size:14px;">${ui.icon("gem")}數值精研<span style="font-weight:400;color:var(--ink-dim);font-size:11.5px;"> · 固定加數值，一樣永久繼承</span></p>`;
    html += `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">${statKeys.map((key) => passiveCard(key, skillLevels[key] || 0, canSpend)).join("")}</div>`;

    html += `<p style="text-align:center;margin:20px 0 12px;font-weight:700;font-size:14px;">${ui.icon("shield")}職業被動<span style="font-weight:400;color:var(--ink-dim);font-size:11.5px;"> · 只能點目前的職業，但等級永久保留</span></p>`;
    if (chosenClass) {
      const masteryDef = CD.CLASS_MASTERY_DEFS[chosenClass];
      html += `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">${classMasteryCard(chosenClass, masteryDef, skillLevels[`class_mastery:${chosenClass}`] || 0, canSpend)}</div>`;
    } else {
      const classBranches = CD.getSkillTreeChildren(`path_${chosenPath}`);
      html += `<div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">`;
      classBranches.forEach((branch) => {
        const previewClass = branch.effect.unlocksClassKey;
        const masteryDef = CD.CLASS_MASTERY_DEFS[previewClass];
        html += classMasteryCard(previewClass, masteryDef, 0, false, true);
      });
      html += `</div><p style="text-align:center;font-size:11px;color:var(--ink-dim);margin-top:8px;">Lv.15 選定最終職業後，這裡會只剩該職業的那一個，可以實際升級</p>`;
    }
    return html;
  }

  // class_xxx底下的節點(技能候選/大招1/大招2/職業被動)各自要長什麼樣子。
  // activeSkills:這場活動自己的技能/大招投資等級(key是節點後綴)，interactive=false時傳{}就好。
  // equippedSkillA/B:目前裝在技能A、技能B欄位的是哪個節點後綴。
  // interactive=false 時是「候選職業預覽」，強制灰色、不顯示按鈕，不管背後資料實際上是什麼等級。
  function skillTreeKitCard(node, chosenClass, activeSkills, canSpend, equippedUltId, equippedSkillA, equippedSkillB, interactive) {
    const CD = CareerData;
    const MAX_LV = node.maxLevel || CD.MAX_SKILL_LEVEL;
    const active = activeSkills || {};

    if (node.type === "active_skill") {
      const nodeSuffix = CD.nodeSuffix(chosenClass, node.id); // "skill_1"/"skill_2"/"skill_3"
      const lv = interactive ? active[nodeSuffix] || 0 : 0;
      const atMax = interactive && lv >= MAX_LV;
      const unlocked = interactive && lv > 0;
      const equippedSlot = !interactive ? null : equippedSkillA === nodeSuffix ? "A" : equippedSkillB === nodeSuffix ? "B" : null;
      let actionHtml;
      if (!interactive) {
        actionHtml = `<span style="font-size:10px;color:var(--ink-dim);">尚未解鎖</span>`;
      } else if (!unlocked) {
        actionHtml = `<button class="btn ghost small" data-upgrade-active-skill="${nodeSuffix}" ${canSpend ? "" : "disabled"}>${ui.icon("arrow-big-up", { size: "13px" })}花1點解鎖</button>`;
      } else if (equippedSlot) {
        actionHtml =
          (atMax
            ? `<span style="font-size:10px;color:var(--green);font-weight:700;">${ui.icon("check", { size: "12px" })}裝備中(${equippedSlot})・已達最高等級</span>`
            : `<button class="btn ghost small" data-upgrade-active-skill="${nodeSuffix}" ${canSpend ? "" : "disabled"}>${ui.icon("arrow-big-up", { size: "13px" })}裝備中(${equippedSlot})・升到 Lv.${lv + 1}</button>`) +
          `<div style="margin-top:4px;"><button class="btn ghost small" data-equip-skill="${equippedSlot === "A" ? "b" : "a"}:${nodeSuffix}">${ui.icon("refresh-cw", { size: "12px" })}改裝到${equippedSlot === "A" ? "B" : "A"}欄</button></div>`;
      } else {
        actionHtml = `
          ${!atMax ? `<button class="btn ghost small" data-upgrade-active-skill="${nodeSuffix}" ${canSpend ? "" : "disabled"}>${ui.icon("arrow-big-up", { size: "13px" })}升到 Lv.${lv + 1}</button>` : ""}
          <div style="margin-top:4px;display:flex;gap:4px;justify-content:center;">
            <button class="btn ghost small" data-equip-skill="a:${nodeSuffix}">${ui.icon("wand-sparkles", { size: "12px" })}裝到A欄</button>
            <button class="btn ghost small" data-equip-skill="b:${nodeSuffix}">${ui.icon("wand-sparkles", { size: "12px" })}裝到B欄</button>
          </div>`;
      }
      return `
        <div style="display:flex;flex-direction:column;position:relative;flex:1;min-width:140px;max-width:170px;background:var(--panel2);border:1px solid ${equippedSlot ? "var(--gold)" : "var(--line)"};border-radius:var(--radius);padding:10px;text-align:center;${interactive ? "" : "opacity:0.55;"}">
          <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:${equippedSlot ? "var(--gold)" : "var(--line)"};"></div>
          ${ui.icon(node.icon, { size: "18px" })}
          <p style="margin:6px 0 0;font-weight:700;font-size:12px;">${ui.esc(node.name)}${lv > 0 ? ` Lv.${lv}` : ""}</p>
          <p style="margin:2px 0 6px;font-size:9.5px;color:var(--ink-dim);">${ui.esc(node.effect.desc || "")}</p>
          <div style="margin-top:auto;">${actionHtml}</div>
        </div>`;
    }

    if (node.type === "ultimate") {
      const nodeSuffix = CD.nodeSuffix(chosenClass, node.id); // "ult_1"/"ult_2"
      const isDefault = nodeSuffix === "ult_1";
      const lv = interactive ? active[nodeSuffix] || (isDefault ? 1 : 0) : 0; // 大招1沒點過也當Lv.1(免費基礎強度)
      const atMax = interactive && lv >= MAX_LV;
      const unlocked = interactive && (isDefault || lv > 0);
      const isEquipped = interactive && equippedUltId === node.id;
      let actionHtml;
      if (!interactive) {
        actionHtml = `<span style="font-size:10px;color:var(--ink-dim);">尚未解鎖</span>`;
      } else if (!unlocked) {
        actionHtml = `<button class="btn ghost small" data-upgrade-active-skill="${nodeSuffix}" ${canSpend ? "" : "disabled"}>${ui.icon("arrow-big-up", { size: "13px" })}花1點解鎖</button>`;
      } else if (!isEquipped) {
        actionHtml = `<button class="btn ghost small" data-equip-ult="${node.id}">${ui.icon("refresh-cw", { size: "13px" })}裝備這個(免費隨時換)</button>`;
      } else if (atMax) {
        actionHtml = `<span style="font-size:10px;color:var(--green);font-weight:700;">${ui.icon("check", { size: "12px" })}裝備中・已達最高等級</span>`;
      } else {
        actionHtml = `<button class="btn ghost small" data-upgrade-active-skill="${nodeSuffix}" ${canSpend ? "" : "disabled"}>${ui.icon("arrow-big-up", { size: "13px" })}裝備中・升到 Lv.${lv + 1}</button>`;
      }
      return `
        <div style="display:flex;flex-direction:column;position:relative;flex:1;min-width:130px;max-width:170px;background:var(--panel2);border:1px solid ${isEquipped ? "var(--gold)" : "var(--line)"};border-radius:var(--radius);padding:10px;text-align:center;${interactive ? "" : "opacity:0.55;"}">
          <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:${isEquipped ? "var(--gold)" : "var(--line)"};"></div>
          ${ui.icon(node.icon, { size: "18px" })}
          <p style="margin:6px 0 0;font-weight:700;font-size:12px;">${ui.esc(node.name)}${lv > 0 ? ` Lv.${lv}` : ""}</p>
          <p style="margin:2px 0 6px;font-size:9.5px;color:var(--ink-dim);">${ui.esc(node.effect.desc || "")}</p>
          <div style="margin-top:auto;">${actionHtml}</div>
        </div>`;
    }

    // passive(職業被動):跟上面「職業被動」卡片是同一份資料，這裡只是路線圖裡再顯示一次現況
    const lv = skillLevels[`class_mastery:${chosenClass}`] || 0;
    const atMax = lv >= (CD.MAX_SKILL_LEVEL || 3);
    return `
      <div style="position:relative;flex:1;min-width:130px;max-width:160px;background:var(--panel2);border:1px dashed var(--line);border-radius:var(--radius);padding:10px;text-align:center;opacity:0.85;">
        <div style="position:absolute;top:-5px;left:50%;transform:translateX(-50%);width:8px;height:8px;border-radius:50%;background:${lv > 0 ? "var(--gold)" : "var(--line)"};"></div>
        ${ui.icon(node.icon, { size: "18px" })}
        <p style="margin:6px 0 0;font-weight:700;font-size:12px;">${ui.esc(node.name)}${lv > 0 ? ` Lv.${lv}` : ""}</p>
        <p style="margin:2px 0 0;font-size:9.5px;color:var(--ink-dim);">已經在用(就是上面的職業被動卡)</p>
        <span style="font-size:9.5px;color:${lv > 0 ? "var(--green)" : "var(--gold)"};font-weight:700;">${atMax ? "已達最高等級" : lv > 0 ? `Lv.${lv}` : "可升級"}</span>
      </div>`;
  }

  // Bug修正(玩家回報):以前把「升級後的效果說明」塞在按鈕文字裡，按鈕不會換行，
  // 說明一長就整排字衝出卡片外框。現在把說明拆成獨立一行(放在名字下面、狀態文字上面，
  // 字體大小跟狀態文字一樣)，按鈕只留「升到 Lv.X」這種短文字，不會再爆版。
  function passiveCard(key, lv, canSpend) {
    const CD = CareerData;
    const def = CD.PASSIVE_DEFS[key];
    const MAX_LV = CD.MAX_SKILL_LEVEL;
    const atMax = lv >= MAX_LV;
    const previewDesc = CD.passiveLevelDesc(key, atMax ? lv : lv + 1); // 沒解鎖時預覽「升上去會變怎樣」，已經最高等級就顯示目前效果
    const statusText = atMax ? "已達最高等級" : lv > 0 ? `目前 Lv.${lv}` : "尚未解鎖";
    return `
      <div style="display:flex;flex-direction:column;flex:1;min-width:160px;background:var(--panel2);border:1px solid ${!atMax && canSpend ? "var(--gold)" : "var(--line)"};border-radius:var(--radius);padding:12px;text-align:center;">
        ${ui.icon(def.icon, { size: "22px" })}
        <p style="margin:8px 0 2px;font-weight:700;font-size:13px;">${ui.esc(def.name)}${lv > 0 ? ` Lv.${lv}` : ""}</p>
        <p style="margin:0 0 4px;font-size:11px;color:var(--ink-dim);overflow-wrap:break-word;">${ui.esc(previewDesc)}</p>
        <p style="margin:0 0 8px;font-size:11px;color:${atMax ? "var(--green)" : lv > 0 ? "var(--gold)" : "var(--ink-dim)"};font-weight:700;">${statusText}</p>
        <div style="margin-top:auto;">
          ${
            atMax
              ? `<span style="font-size:10.5px;color:var(--green);font-weight:700;">${ui.icon("check", { size: "12px" })}已解鎖到頂</span>`
              : `<button class="btn ghost small" data-upgrade-skill="${key}" ${canSpend ? "" : "disabled"}>${ui.icon("arrow-big-up", { size: "14px" })}升到 Lv.${lv + 1}</button>`
          }
        </div>
      </div>`;
  }

  // 跟 passiveCard 幾乎一樣，只是資料來源是 CLASS_MASTERY_DEFS(職業限定被動)而不是 PASSIVE_DEFS。
  // forcePreview=true 時是「候選職業預覽」(還沒定案職業，先讓玩家看兩個候選職業的職業被動長怎樣)，
  // 強制顯示成「尚未解鎖」、不給按鈕，不管lv實際傳進來是多少。
  function classMasteryCard(classKey, def, lv, canSpend, forcePreview) {
    const CD = CareerData;
    const MAX_LV = CD.MAX_SKILL_LEVEL;
    const effLv = forcePreview ? 0 : lv;
    const atMax = effLv >= MAX_LV;
    const previewDesc = CD.classMasteryDesc(classKey, atMax ? effLv : effLv + 1);
    const statusText = atMax ? "已達最高等級" : effLv > 0 ? `目前 Lv.${effLv}` : "尚未解鎖";
    const key = `class_mastery:${classKey}`;
    return `
      <div style="display:flex;flex-direction:column;flex:1;min-width:160px;max-width:260px;background:var(--panel2);border:1px solid ${!atMax && canSpend && !forcePreview ? "var(--gold)" : "var(--line)"};border-radius:var(--radius);padding:12px;text-align:center;${forcePreview ? "opacity:0.55;" : ""}">
        ${ui.icon(def.icon, { size: "22px" })}
        <p style="margin:8px 0 2px;font-weight:700;font-size:13px;">${ui.esc(def.name)}${effLv > 0 ? ` Lv.${effLv}` : ""}</p>
        <p style="margin:0 0 4px;font-size:11px;color:var(--ink-dim);overflow-wrap:break-word;">${ui.esc(previewDesc)}</p>
        <p style="margin:0 0 8px;font-size:11px;color:${atMax ? "var(--green)" : effLv > 0 ? "var(--gold)" : "var(--ink-dim)"};font-weight:700;">${statusText}</p>
        <div style="margin-top:auto;">
          ${
            forcePreview
              ? `<span style="font-size:10.5px;color:var(--ink-dim);">選這個職業後才能點</span>`
              : atMax
                ? `<span style="font-size:10.5px;color:var(--green);font-weight:700;">${ui.icon("check", { size: "12px" })}已解鎖到頂</span>`
                : `<button class="btn ghost small" data-upgrade-skill="${key}" ${canSpend ? "" : "disabled"}>${ui.icon("arrow-big-up", { size: "14px" })}升到 Lv.${effLv + 1}</button>`
          }
        </div>
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

  function renderLeaderboardSection() {
    if (!standings.length) return "";
    const rows = standings
      .slice(0, 10)
      .map((row, idx) => {
        const isMe = row.queueEntry.player_id === myId;
        const name = (row.queueEntry.player && row.queueEntry.player.name) || "?";
        return `
          <div class="lb-row${isMe ? " me" : ""}">
            ${ui.rankBadge(idx + 1)}
            <span class="lb-name">${ui.esc(name)}${isMe ? "(你)" : ""}
              <span style="color:var(--ink-dim);font-size:11px;"> · 第${row.floor}層 · ${row.queueEntry.wins}勝${row.queueEntry.losses}敗</span>
            </span>
            <span class="lb-score">${row.score}</span>
          </div>`;
      })
      .join("");
    return `
      <div class="card" style="margin-top:16px;">
        <h3>${ui.icon("list-ordered")}目前排行榜</h3>
        ${rows}
      </div>`;
  }

  // ---------------- 主 render ----------------

  function render() {
    if (!progress) return;
    const info = CareerData.CLASS_INFO[myBuild.final_class];
    const stats = CareerData.applyStatBoostPassives(CareerData.applyProgress(myBuild.final_class, progress.stat_alloc, progress.equipment), skillLevels);
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
    } else if (activeTab === "skilltree") {
      if (myBuild && myBuild.final_class === "novice") {
        // Phase 2:理論上分頁按鈕已經藏起來了，這裡是防手動改網址/舊分頁殘留state的最後防線
        activeTab = "tower";
        html += renderTowerTab({ locked, hasPendingEvent, canTrain, trainCooldownMs, nextFloor, nextFloorDef, isAutoFarming });
      } else {
        html += renderSkillTreeTab(locked || hasPendingEvent);
      }
    } else if (activeTab === "backpack") {
      html += renderBackpackTab();
    }
    html += `</div>`;

    html += renderLeaderboardSection();

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
    if (bossSkillBtn && !bossSkillBtn.disabled) bossSkillBtn.onclick = () => submitBossMove("skill1");
    const bossSkill2Btn = document.getElementById("boss-skill2-btn");
    if (bossSkill2Btn && !bossSkill2Btn.disabled) bossSkill2Btn.onclick = () => submitBossMove("skill2");
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

    app.querySelectorAll("[data-skilltree-subtab]").forEach((btn) => {
      btn.onclick = () => {
        skillTreeSubTab = btn.dataset.skilltreeSubtab;
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
            .map((k) => `${CareerFloors.STAT_LABEL[k] || k}+${k === "hp" ? result.bonus[k] * 10 : k === "mp" ? result.bonus[k] * 2 : result.bonus[k]}`)
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
            .map((k) => `${CareerFloors.STAT_LABEL[k] || k}+${k === "hp" ? result.bonus[k] * 10 : k === "mp" ? result.bonus[k] * 2 : result.bonus[k]}`)
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

    app.querySelectorAll("[data-upgrade-skill]").forEach((btn) => {
      btn.onclick = async () => {
        if (busy) return;
        const skillKey = btn.dataset.upgradeSkill;
        busy = true;
        btn.disabled = true;
        try {
          const result = await db.upgradePlayerSkill(eventId, myId, skillKey);
          progress = result.progress;
          skillLevels = { ...skillLevels, [skillKey]: result.level };
          const masteryClassKey = skillKey.startsWith("class_mastery:") ? skillKey.slice("class_mastery:".length) : null;
          const def = masteryClassKey ? CareerData.CLASS_MASTERY_DEFS[masteryClassKey] : CareerData.PASSIVE_DEFS[skillKey];
          highlight = {
            icon: def.icon,
            title: `「${def.name}」升到 Lv.${result.level}!`,
            text: "這個等級會永久保留，之後的活動、下一個賽季都不會重置。",
          };
          render();
        } catch (e) {
          await ui.alert(e.message || "升級失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

    // 技能A/B、大招1/2:這場活動自己的東西，不是永久的(2026-09確認)，走 upgradeActiveSkill，
    // 不寫進永久表；換下一場活動會自動重新從0開始。
    app.querySelectorAll("[data-upgrade-active-skill]").forEach((btn) => {
      btn.onclick = async () => {
        if (busy) return;
        const nodeSuffix = btn.dataset.upgradeActiveSkill;
        busy = true;
        btn.disabled = true;
        try {
          const result = await db.upgradeActiveSkill(eventId, myId, nodeSuffix);
          progress = result.progress;
          const node = CareerData.SKILL_TREE_NODES[`${myBuild.final_class}_${nodeSuffix}`];
          const label = node ? node.name : nodeSuffix;
          highlight = {
            icon: nodeSuffix.startsWith("ult") ? "flame" : "wand-sparkles",
            title: `「${label}」升到 Lv.${result.level}!`,
            text: "這個等級只在這場活動有效，換下一場活動、下一個賽季會重新歸零。",
          };
          render();
        } catch (e) {
          await ui.alert(e.message || "升級失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

    app.querySelectorAll("[data-equip-ult]").forEach((btn) => {
      btn.onclick = async () => {
        if (busy) return;
        const ultId = btn.dataset.equipUlt;
        busy = true;
        btn.disabled = true;
        try {
          progress = await db.setEquippedUlt(eventId, myId, ultId);
          const node = CareerData.SKILL_TREE_NODES[ultId];
          highlight = { icon: (node && node.icon) || "flame", title: `大招換成「${node ? node.name : ultId}」了!`, text: "免費隨時換，不用花技能點，也不會影響剛剛升過的等級。" };
          render();
        } catch (e) {
          await ui.alert(e.message || "裝備失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

    // data-equip-skill 的值是 "a:skill_3" 這種「欄位:節點後綴」格式，一次解析出兩個資訊
    app.querySelectorAll("[data-equip-skill]").forEach((btn) => {
      btn.onclick = async () => {
        if (busy) return;
        const [slot, nodeSuffix] = (btn.dataset.equipSkill || "").split(":");
        busy = true;
        btn.disabled = true;
        try {
          progress = await db.setEquippedSkill(eventId, myId, slot, nodeSuffix);
          const node = CareerData.SKILL_TREE_NODES[`${myBuild.final_class}_${nodeSuffix}`];
          highlight = {
            icon: (node && node.icon) || "wand-sparkles",
            title: `技能${slot.toUpperCase()}換成「${node ? node.name : nodeSuffix}」了!`,
            text: "免費隨時換，不用花技能點，也不會影響剛剛升過的等級。",
          };
          render();
        } catch (e) {
          await ui.alert(e.message || "裝備失敗", { title: "操作失敗", tone: "danger" });
          await loadAndRender();
        } finally {
          busy = false;
        }
      };
    });

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
    const skill2Btn = document.getElementById("boss-skill2-btn");
    if (atkBtn) atkBtn.disabled = true;
    if (ultBtn) ultBtn.disabled = true;
    if (skillBtn) skillBtn.disabled = true;
    if (skill2Btn) skill2Btn.disabled = true;
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
