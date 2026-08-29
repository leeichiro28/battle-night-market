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
  let busy = false;
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

    myBuild = await db.getMyCareerBuild(eventId, myId);
    if (!myBuild) {
      app.innerHTML = emptyMsg("請先到 PVP 對戰頁面選一個職業，爬塔的戰鬥數值是照那邊選的職業算的。", "swords");
      return;
    }

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

  function render() {
    if (!progress) return;
    const info = CareerData.CLASS_INFO[myBuild.final_class];
    const stats = CareerData.applyProgress(myBuild.final_class, progress.stat_alloc, progress.equipment);
    const expNeed = CareerFloors.expToNextLevel(progress.level);
    const trainCooldownMs = new Date(progress.train_ready_at).getTime() - Date.now();
    const locked = trainingClosed();
    const canTrain = trainCooldownMs <= 0 && !locked;
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
        <button class="btn" id="challenge-btn" style="flex:1 1 30%;" ${nextFloorDef && !locked ? "" : "disabled"}>
          ${ui.icon("swords")}挑戰第${nextFloor}層・無CD
        </button>
        <button class="btn ${isAutoFarming ? "career-ult-btn" : "ghost"}" id="autofarm-btn" style="flex:1 1 30%;" ${progress.floor <= 0 || locked ? "disabled" : ""}>
          ${ui.icon("repeat")}練功掛機・${progress.floor <= 0 ? "已清樓層限定" : isAutoFarming ? "進行中(自動)" : "開始"}
        </button>
      </div>`;

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
      lastBattle = result;
      progress = result.progress || progress;
      render();
    } catch (e) {
      await ui.alert(e.message || "挑戰失敗", { title: "操作失敗", tone: "danger" });
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
