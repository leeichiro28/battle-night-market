// 職業養成對決 · 頁面控制(PVP對戰頁面)
//
// 兩種畫面狀態:
//   1. 沒在對戰中 -> renderLobby()(職業狀態/佇列/測試機器人/排行榜)
//   2. 配對成功 -> renderBattle()(PVP 對戰畫面)
//
// 職業建置(career_builds)一進來就自動是「見習學徒」(db.getOrCreateCareerBuild)，
// 真正選路線轉職是在 tower.html 練到 CareerData.TRANSFER_LEVEL_PATH/TRANSFER_LEVEL_FINAL
// 等級之後才做的事，
// 這支檔案不再負責選職業。
//
// 配對推進(match_career_players)、初始化戰鬥數值(initializeCareerMatch)、回合結算
// (CareerEngine.resolveRound)都是「誰的分頁先偵測到就誰做」，資料庫那端的條件寫入
// (status='waiting' / initialized=false / status='active')本身就是鎖，不用額外協調。
(function () {
  const params = new URLSearchParams(location.search);
  const eventId = params.get("event");
  const app = document.getElementById("career-app");

  let ev = null;
  let myId = null;
  let myBuild = null;
  let activeMatch = null;
  let mySlot = null;
  let resolving = false;
  let submittedThisRound = false;
  let seenRound = null;
  let roundTimer = null;
  let scanTimer = null;
  let unsubQueue = null;
  let unsubMatches = null;
  let refreshQueued = false;
  let broadcasts = [];

  function emptyMsg(text, icon) {
    return `<div class="empty">${ui.icon(icon || "info")}${ui.esc(text)}</div>`;
  }

  function scheduleRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    setTimeout(async () => {
      refreshQueued = false;
      try {
        await refreshAll();
      } catch (e) {
        console.error(e);
      }
    }, 250);
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
    document.getElementById("page-eyebrow").textContent = ev.name;
    const towerLink = document.getElementById("to-tower-link");
    if (towerLink) towerLink.href = `tower.html?event=${eventId}`;
    const local = db.getLocalPlayer();
    myId = local && local.id;

    if (ev.status === "closed") {
      await renderClosedSummary();
      return;
    }
    if (!myId) {
      app.innerHTML = emptyMsg("請先在右上角使用 Discord 登入，才能選職業、加入配對。", "log-in");
      return;
    }

    broadcasts = await db.listCareerBroadcasts(eventId).catch(() => []);
    await refreshAll();

    unsubQueue = db.onTableChange("career_pvp_queue", `event_id=eq.${eventId}`, scheduleRefresh);
    unsubMatches = db.onTableChange("career_matches", `event_id=eq.${eventId}`, scheduleRefresh);
    db.onTableChange("career_broadcasts", `event_id=eq.${eventId}`, async () => {
      broadcasts = await db.listCareerBroadcasts(eventId).catch(() => broadcasts);
      if (!activeMatch) scheduleRefresh();
    });
    // 任何開著這頁的分頁都幫忙推進配對、也幫忙檢查訓練期時間到了沒(誰先掃到都一樣，
    // match_career_players/maybeAdvanceCareerPhase 本身都是安全可以重複呼叫的)
    scanTimer = setInterval(async () => {
      try {
        const advanced = await db.maybeAdvanceCareerPhase(eventId);
        if (advanced) ev = await db.getEventSafe(eventId);
        if (!activeMatch) {
          await db.scanCareerMatchmaking(eventId);
        }
        await refreshAll();
      } catch (e) {
        console.error(e);
      }
    }, 3000);
  }

  // 跟 tower.js 同一套三態判斷:沒設定過 -> 活動還沒開始; 'training' -> 訓練期中(PVP鎖住，
  // 去爬塔); 'battle' -> PVP開放。
  function getCareerPhase() {
    return (ev && ev.rules && ev.rules.careerPhase) || "not_started";
  }
  function pvpAllowed() {
    return getCareerPhase() === "battle";
  }

  // ---------------- 活動已結束:排行榜 + 賽後小傳 ----------------
  async function renderClosedSummary() {
    const standings = await db.computeCareerStandings(eventId);
    const playerIds = standings.map((r) => r.queueEntry.player_id);
    const profiles = await db.getPlayerProfiles(playerIds).catch(() => ({}));

    let bioHtml = "";
    if (myId) {
      const mine = standings.find((r) => r.queueEntry.player_id === myId);
      const build = await db.getMyCareerBuild(eventId, myId).catch(() => null);
      if (mine && build) {
        const info = CareerData.CLASS_INFO[build.final_class];
        const rank = standings.indexOf(mine) + 1;
        const winRate = mine.queueEntry.wins + mine.queueEntry.losses > 0
          ? Math.round((mine.queueEntry.wins / (mine.queueEntry.wins + mine.queueEntry.losses)) * 100)
          : 0;
        bioHtml = `
          <div style="background:var(--panel2);border:1px solid var(--gold-d);border-radius:var(--radius);padding:14px;margin-bottom:16px;">
            <p style="margin:0 0 8px;font-weight:700;color:var(--gold);display:flex;align-items:center;gap:6px;">
              ${ui.icon(info.icon)}你的賽後小傳
            </p>
            <p style="margin:0;font-size:13px;line-height:1.9;color:var(--ink);">
              這一場你選擇了<b>${ui.esc(info.name)}</b>之路，一路爬到了<b>第 ${mine.floor} 層</b>，
              PVP 打了 ${mine.queueEntry.wins + mine.queueEntry.losses} 場、${mine.queueEntry.wins} 勝 ${mine.queueEntry.losses} 敗(勝率 ${winRate}%)，
              最終積分 <b style="color:var(--gold);">${mine.score}</b> 分，排名第 <b>${rank}</b> 名。
              ${mine.queueEntry.reward ? `獲得獎勵:<b style="color:var(--gold);">${ui.esc(mine.queueEntry.reward)}</b>。` : ""}
            </p>
          </div>`;
      }
    }

    const rows = standings
      .map((row, idx) => {
        const rank = idx + 1;
        const isMe = myId && row.queueEntry.player_id === myId;
        const name = (row.queueEntry.player && row.queueEntry.player.name) || "?";
        const profile = profiles[row.queueEntry.player_id];
        const titleLine = profile ? ui.titleBadge(profile.display_title) : "";
        const rewardLine = row.queueEntry.reward
          ? `<span class="reward-badge">${ui.icon("gift")}${ui.esc(row.queueEntry.reward)}</span>`
          : "";
        return `
          <div class="lb-row${isMe ? " me" : ""}">
            ${ui.rankBadge(rank)}
            <span class="lb-name">${ui.esc(name)}${isMe ? "(你)" : ""}${titleLine}${rewardLine}
              <span style="color:var(--ink-dim);font-size:11px;"> · 第${row.floor}層 · ${row.queueEntry.wins}勝${row.queueEntry.losses}敗</span>
            </span>
            <span class="lb-score">${row.score}</span>
          </div>`;
      })
      .join("");

    app.innerHTML = `
      ${emptyMsg("這場活動已經結束了，以下是最終排行榜。", "flag")}
      ${bioHtml}
      <div style="margin-top:10px;">${rows || emptyMsg("還沒有人排隊過。", "users")}</div>`;
  }

  async function refreshAll() {
    if (!myId) return;
    const match = await db.getMyActiveCareerMatch(eventId, myId);
    if (match) {
      activeMatch = match;
      await enterBattle(match);
      return;
    }
    if (activeMatch) {
      activeMatch = null;
      seenRound = null;
      submittedThisRound = false;
      clearInterval(roundTimer);
    }
    myBuild = await db.getOrCreateCareerBuild(eventId, myId);
    await renderLobby();
  }

  // ---------------- 畫面 2:佇列/等待 ----------------
  async function renderLobby() {
    const info = CareerData.CLASS_INFO[myBuild.final_class];
    const progress = await db.getCareerProgressFor(eventId, myId).catch(() => null);
    const stats = progress
      ? CareerData.applyProgress(myBuild.final_class, progress.stat_alloc, progress.equipment)
      : CareerData.computeStats(myBuild.final_class);
    const isNovice = myBuild.final_class === "novice" || myBuild.final_class.startsWith("novice_");
    const queueEntry = await db.getMyCareerQueueEntry(eventId, myId);
    const inQueue = queueEntry && queueEntry.status === "waiting";

    let html = "";
    if (broadcasts.length) {
      const latest = broadcasts[0];
      const secAgo = Math.max(0, Math.round((Date.now() - new Date(latest.created_at).getTime()) / 1000));
      const timeText = secAgo < 60 ? `${secAgo}秒前` : `${Math.round(secAgo / 60)}分鐘前`;
      html += `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;margin-bottom:14px;border-radius:999px;background:var(--panel2);border:1px solid var(--line);font-size:12px;overflow:hidden;">
          ${ui.icon(latest.icon || "megaphone")}
          <span style="flex:1;min-width:0;overflow-wrap:anywhere;">${ui.esc(latest.message)}</span>
          <span style="color:var(--ink-dim);flex-shrink:0;font-size:10.5px;">${timeText}</span>
        </div>`;
    }
    html += `
      <div class="career-class-card selected" style="cursor:default;margin-bottom:16px;">
        <div class="cc-head">${ui.icon(info.icon)}${ui.esc(info.name)}
          <span style="margin-left:auto;font-size:11px;color:var(--ink-dim);font-weight:400;">${ui.esc(info.pathLabel)}</span>
        </div>
        <div class="cc-stats">
          ${info.path === "magic" ? `<span class="cc-stat">魔攻${stats.matk}</span>` : `<span class="cc-stat">攻${stats.atk}</span>`}
          <span class="cc-stat">防${stats.def}</span>
          <span class="cc-stat">速${stats.spd}</span>
          <span class="cc-stat">HP${stats.hp}</span>
          <span class="cc-stat">幸運${stats.luck}</span>
        </div>
        <div class="cc-ult"><b>大招 · ${ui.esc(info.ultName)}</b><br/>${ui.esc(info.ultDesc)}</div>
      </div>
      ${
        isNovice
          ? `<div class="empty" style="text-align:left;font-size:11.5px;margin:-8px 0 14px;">${ui.icon("info")}你還沒轉職完成，PVP數值會比較弱。去爬塔練到 Lv.${CareerData.TRANSFER_LEVEL_PATH} 選一個系，練到 Lv.${CareerData.TRANSFER_LEVEL_FINAL} 定案最終職業。</div>`
          : ""
      }
      <div style="text-align:right;margin:-10px 0 14px;display:flex;justify-content:flex-end;gap:8px;">
        <button class="btn ghost small" id="show-leaderboard-btn">${ui.icon("list-ordered")}目前排行榜</button>
      </div>
      <div id="inline-leaderboard"></div>`;

    const phase = getCareerPhase();
    if (!pvpAllowed()) {
      const endsAt = ev.rules && ev.rules.trainingEndsAt;
      const remainMin = endsAt ? Math.max(0, Math.ceil((new Date(endsAt).getTime() - Date.now()) / 60000)) : null;
      const notStarted = phase === "not_started";
      html += `
        <div class="career-queue-box">
          ${ui.icon("hourglass")}
          <p style="margin:10px 0 4px;font-weight:700;">${notStarted ? "活動還沒開始" : `訓練期進行中${remainMin != null ? `，還剩約 ${remainMin} 分鐘` : ""}`}</p>
          <p style="font-size:11.5px;color:var(--ink-dim);">${
            notStarted ? "請等主辦人在後台按下「開始訓練期」。" : "PVP 對戰要等訓練期結束才會開放，先去爬塔練功、加點、拚裝備吧!(上面有「前往爬塔」的連結)"
          }</p>
        </div>`;
    } else if (inQueue) {
      const waitedSec = Math.max(0, Math.round((Date.now() - new Date(queueEntry.last_matched_at).getTime()) / 1000));
      html += `
        <div class="career-queue-box">
          ${ui.icon("loader-circle")}
          <p style="margin:10px 0 4px;font-weight:700;">配對中...(已等待約 ${waitedSec} 秒)</p>
          <p style="font-size:11.5px;color:var(--ink-dim);">戰績:${queueEntry.wins} 勝 ${queueEntry.losses} 敗,積分 ${queueEntry.current_score}</p>
        </div>
        <div style="text-align:center;margin-top:10px;">
          <button class="btn small" id="test-bot-btn">${ui.icon("bot")}沒人可配對?拉一隻機器人來打</button>
        </div>`;
    } else {
      const score = queueEntry ? `戰績:${queueEntry.wins} 勝 ${queueEntry.losses} 敗,積分 ${queueEntry.current_score}` : "還沒打過任何一場";
      html += `
        <div class="career-queue-box">
          ${ui.icon("swords")}
          <p style="margin:10px 0 4px;font-weight:700;">準備好就加入配對佇列吧</p>
          <p style="font-size:11.5px;color:var(--ink-dim);">${ui.esc(score)}</p>
          <div style="margin-top:14px;display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">
            <button class="btn" id="join-queue-btn">${ui.icon("swords")}加入配對佇列</button>
            <button class="btn ghost" id="test-bot-btn">${ui.icon("bot")}拉一隻機器人來打</button>
          </div>
        </div>`;
    }

    app.innerHTML = html;

    const lbBtn = document.getElementById("show-leaderboard-btn");
    if (lbBtn) {
      lbBtn.onclick = async () => {
        const box = document.getElementById("inline-leaderboard");
        if (box.dataset.shown === "1") {
          box.innerHTML = "";
          box.dataset.shown = "0";
          lbBtn.innerHTML = ui.icon("list-ordered") + "目前排行榜";
          return;
        }
        box.innerHTML = emptyMsg("載入中...", "loader-circle");
        try {
          const standings = await db.computeCareerStandings(eventId);
          box.innerHTML = standings.length
            ? standings
                .map((row, idx) => {
                  const isMe = row.queueEntry.player_id === myId;
                  const name = (row.queueEntry.player && row.queueEntry.player.name) || "?";
                  return `<div class="lb-row${isMe ? " me" : ""}">
                    ${ui.rankBadge(idx + 1)}
                    <span class="lb-name">${ui.esc(name)}${isMe ? "(你)" : ""}
                      <span style="color:var(--ink-dim);font-size:11px;"> · 第${row.floor}層 · ${row.queueEntry.wins}勝${row.queueEntry.losses}敗</span>
                    </span>
                    <span class="lb-score">${row.score}</span>
                  </div>`;
                })
                .join("")
            : emptyMsg("還沒有人排隊過。", "users");
          box.dataset.shown = "1";
          lbBtn.innerHTML = ui.icon("chevron-up") + "收起排行榜";
        } catch (e) {
          box.innerHTML = emptyMsg("排行榜載入失敗", "triangle-alert");
        }
      };
    }
    const joinBtn = document.getElementById("join-queue-btn");
    if (joinBtn) {
      joinBtn.onclick = async () => {
        joinBtn.disabled = true;
        joinBtn.innerHTML = ui.icon("loader-circle") + "加入中...";
        try {
          await db.joinCareerQueue(eventId, myId);
          await db.scanCareerMatchmaking(eventId);
          await refreshAll();
        } catch (e) {
          await ui.alert("加入配對失敗:" + (e.message || "未知錯誤"), { title: "操作失敗", tone: "danger" });
          await refreshAll();
        }
      };
    }
    const botBtn = document.getElementById("test-bot-btn");
    if (botBtn) {
      botBtn.onclick = async () => {
        botBtn.disabled = true;
        botBtn.innerHTML = ui.icon("loader-circle") + "呼叫機器人中...";
        try {
          if (!inQueue) await db.joinCareerQueue(eventId, myId);
          await db.addCareerTestBot(eventId);
          await db.scanCareerMatchmaking(eventId);
          await refreshAll();
        } catch (e) {
          await ui.alert("呼叫機器人失敗:" + (e.message || "未知錯誤"), { title: "操作失敗", tone: "danger" });
          await refreshAll();
        }
      };
    }
  }

  // ---------------- 畫面 3:PVP 對戰 ----------------
  function opponentIsBot(match) {
    return mySlot === 1 ? match.p2 && match.p2.is_bot : match.p1 && match.p1.is_bot;
  }
  function iAmResolver(match) {
    return mySlot === 1 || opponentIsBot(match);
  }

  async function enterBattle(match) {
    mySlot = match.player1_id === myId ? 1 : 2;

    if (!match.initialized) {
      const initialized = await db.initializeCareerMatch(match);
      match = initialized || (await db.getCareerMatch(match.id));
      activeMatch = match;
    }

    if (!match.initialized) {
      app.innerHTML = emptyMsg("配對成功!正在準備雙方的戰鬥數值...", "loader-circle");
      return;
    }

    renderBattle(match);

    if (match.status === "active") {
      await maybeAutoSubmitForBot(match);
      await maybeResolveRound(match);
    }
  }

  async function maybeAutoSubmitForBot(match) {
    if (!opponentIsBot(match)) return;
    const oppSlot = mySlot === 1 ? 2 : 1;
    const state = match.state || {};
    if (state[`m${oppSlot}`]) return;
    const canUlt = !state[`ultUsed${oppSlot}`];
    const action = canUlt && Math.random() < 0.35 ? "ult" : "attack";
    try {
      await db.submitCareerMove(match.id, oppSlot, { action });
    } catch (e) {
      console.error(e);
    }
  }

  async function maybeResolveRound(match) {
    const state = match.state || {};
    if (!state.m1 || !state.m2) return;
    if (!iAmResolver(match)) return;
    if (resolving) return;
    resolving = true;
    try {
      const { state: newState } = CareerEngine.resolveRound(state);
      const p1Dead = newState.hp1 <= 0;
      const p2Dead = newState.hp2 <= 0;
      if (p1Dead || p2Dead) {
        let winnerId;
        if (p1Dead && p2Dead) {
          // 雙方同歸於盡的極端情況:隨機定勝負，避免場次卡住配不了下一場
          winnerId = Math.random() < 0.5 ? match.player1_id : match.player2_id;
        } else {
          winnerId = p1Dead ? match.player2_id : match.player1_id;
        }
        const loserId = winnerId === match.player1_id ? match.player2_id : match.player1_id;
        await db.updateCareerMatchState(match.id, { state: newState });
        await db.finishCareerMatch(match.id, winnerId, loserId);
        // 連勝3場以上順手廣播一下，讓大家知道場上有人在連勝
        try {
          const winnerQueue = await db.getMyCareerQueueEntry(eventId, winnerId);
          if (winnerQueue && winnerQueue.win_streak >= 3) {
            const winnerName = winnerId === match.player1_id ? match.p1?.name : match.p2?.name;
            await db.broadcastCareerEvent(eventId, "flame", `🔥 ${winnerName || "神秘玩家"} 在PVP擂台連勝 ${winnerQueue.win_streak} 場!`);
          }
        } catch (e) {
          console.error(e);
        }
      } else {
        await db.updateCareerMatchState(match.id, { state: newState });
      }
    } catch (e) {
      console.error(e);
    } finally {
      resolving = false;
    }
  }

  function statBarHtml(label, cur, max, kind) {
    const ratio = max > 0 ? Math.max(0, Math.min(1, cur / max)) : 0;
    const lowCls = kind === "hp" && ratio <= 0.3 ? " low" : "";
    return `
      <div class="stat-bar-row">
        <div class="stat-bar-label"><span>${ui.esc(label)}</span><span>${Math.max(0, Math.round(cur))} / ${max}</span></div>
        <div class="stat-bar ${kind}"><div class="stat-bar-fill ${kind}${lowCls}" style="width:${ratio * 100}%;"></div></div>
      </div>`;
  }

  function renderBattle(match) {
    const s = match.state || {};
    const myName = mySlot === 1 ? match.p1?.name : match.p2?.name;
    const oppName = mySlot === 1 ? match.p2?.name : match.p1?.name;
    const myClass = mySlot === 1 ? s.class1 : s.class2;
    const oppClass = mySlot === 1 ? s.class2 : s.class1;
    const myHp = mySlot === 1 ? s.hp1 : s.hp2;
    const oppHp = mySlot === 1 ? s.hp2 : s.hp1;
    const myMaxHp = mySlot === 1 ? s.maxhp1 : s.maxhp2;
    const oppMaxHp = mySlot === 1 ? s.maxhp2 : s.maxhp1;
    const mySpd = mySlot === 1 ? s.spd1 : s.spd2;
    const oppSpd = mySlot === 1 ? s.spd2 : s.spd1;
    const myUltUsed = mySlot === 1 ? s.ultUsed1 : s.ultUsed2;
    const myInfo = CareerData.CLASS_INFO[myClass];
    const oppInfo = CareerData.CLASS_INFO[oppClass];
    const isDone = match.status === "done";
    const iWon = isDone && match.winner_id === myId;

    if (s.round !== seenRound) {
      seenRound = s.round;
      submittedThisRound = false;
    }
    const myMoveIn = !!s[`m${mySlot}`];
    if (myMoveIn) submittedThisRound = true;

    let html = `
      <div class="career-vs-row">
        <div class="career-side">
          <div class="cs-name">${ui.icon(myInfo.icon)}${ui.esc(myName || "你")}</div>
          <div class="cs-sub">${ui.esc(myInfo.name)} · 速度 ${mySpd}</div>
          ${statBarHtml("HP", myHp, myMaxHp, "hp")}
        </div>
        <div class="career-vs-mid">VS</div>
        <div class="career-side right">
          <div class="cs-name">${ui.esc(oppName || "對手")}${ui.icon(oppInfo.icon)}</div>
          <div class="cs-sub">${ui.esc(oppInfo.name)} · 速度 ${oppSpd}</div>
          ${statBarHtml("HP", oppHp, oppMaxHp, "hp")}
        </div>
      </div>`;

    if (isDone) {
      html += `
        <div class="career-queue-box" style="background:var(--panel2);border-radius:var(--radius);border:1px solid var(--line);">
          ${ui.icon(iWon ? "trophy" : "skull")}
          <p style="margin:10px 0 4px;font-weight:700;color:${iWon ? "var(--gold)" : "var(--ink)"};">
            ${iWon ? "獲勝!+10 分" : "戰敗...+2 分"}
          </p>
          <p style="font-size:11.5px;color:var(--ink-dim);">正在回到配對佇列，準備下一場...</p>
        </div>`;
    } else {
      const iActed = submittedThisRound;
      html += `
        <div class="career-action-row">
          <button class="btn" id="atk-btn" ${iActed ? "disabled" : ""}>${ui.icon("sword")}普通攻擊</button>
          <button class="btn career-ult-btn" id="ult-btn" ${iActed || myUltUsed ? "disabled" : ""}>
            ${ui.icon("flame")}${ui.esc(myInfo.ultName)}${myUltUsed ? "(已使用)" : ""}
          </button>
        </div>
        <p id="round-status" style="text-align:center;font-size:11.5px;color:var(--ink-dim);margin:10px 0 0;">
          ${iActed ? "已送出這回合的動作，等待對手..." : `第 ${s.round} 回合，剩餘 <span id="round-timer">30</span> 秒`}
        </p>`;
    }

    html += `<div class="log-panel career-log-panel">${
      (s.log || [])
        .slice()
        .reverse()
        .slice(0, 12)
        .map((line) => `<div>${ui.esc(line)}</div>`)
        .join("") || `<div style="color:var(--ink-dim);">還沒有任何回合紀錄</div>`
    }</div>`;

    app.innerHTML = html;

    if (!isDone) {
      const atkBtn = document.getElementById("atk-btn");
      const ultBtn = document.getElementById("ult-btn");
      if (atkBtn) atkBtn.onclick = () => submitMyMove(match, "attack");
      if (ultBtn) ultBtn.onclick = () => submitMyMove(match, "ult");
      startRoundTimer(match);
    }
  }

  async function submitMyMove(match, action) {
    if (submittedThisRound) return;
    submittedThisRound = true;
    clearInterval(roundTimer);
    const atkBtn = document.getElementById("atk-btn");
    const ultBtn = document.getElementById("ult-btn");
    if (atkBtn) atkBtn.disabled = true;
    if (ultBtn) ultBtn.disabled = true;
    try {
      await db.submitCareerMove(match.id, mySlot, { action });
      await refreshAll();
    } catch (e) {
      submittedThisRound = false;
      await ui.alert("送出動作失敗:" + (e.message || "未知錯誤"), { title: "操作失敗", tone: "danger" });
      await refreshAll();
    }
  }

  // 30 秒沒動作就自動幫自己送出普通攻擊(避免忘記回來看畫面卡住對手一直等)
  function startRoundTimer(match) {
    clearInterval(roundTimer);
    if (submittedThisRound) return;
    let remain = 30;
    const label = document.getElementById("round-timer");
    if (label) label.textContent = String(remain);
    roundTimer = setInterval(async () => {
      remain -= 1;
      const el = document.getElementById("round-timer");
      if (el) el.textContent = String(Math.max(0, remain));
      if (remain <= 0) {
        clearInterval(roundTimer);
        if (!submittedThisRound) await submitMyMove(match, "attack");
      }
    }, 1000);
  }

  window.addEventListener("beforeunload", () => {
    if (unsubQueue) unsubQueue();
    if (unsubMatches) unsubMatches();
    clearInterval(scanTimer);
    clearInterval(roundTimer);
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
