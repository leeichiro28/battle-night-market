// 共用的「戰鬥畫面唯讀渲染 + 觀眾互動」元件。
// dice.html / rps5.html(整頁對戰)跟 lobby.html(等候室內嵌直播)共用同一份，
// 不要各自維護一套重複的渲染邏輯。用法:
//   const battleView = BattleView.mount(stageRoot, watchRoot, { gameType, matchId });
//   battleView.update(match, ev, mySlot);
//   battleView.announce("你擲出了 5 點！"， { icon: "dices" });
//   battleView.destroy();
// stageRoot 放 HP圓環/戰報/戰場修飾等畫面，watchRoot 放下注/表情觀眾互動區;
// watchRoot 沒給就自動掛在 stageRoot 最後面(整塊一起呈現，等候室內嵌直播用這個)。
// opts.watch === false 時完全不建立觀眾互動區(五手勢目前沒有下注/表情功能)。
// opts.showStatus === false 時不顯示內建的一行狀態文字，交給呼叫端自己的狀態列處理
// (dice.html / rps5.html 本身有更完整的狀態文字跟操作按鈕，不要顯示兩份)。
window.BattleView = (function () {
  const CIRC = 289;
  const MAX_HP = { dice: 30, rps5: 30 };
  const SUDDEN_DEATH_HP = 6;

  const CLASS_INFO = {
    fighter: { icon: "swords", name: "鬥士" },
    guardian: { icon: "shield", name: "守衛" },
    gambler: { icon: "dice-5", name: "賭徒" },
    assassin: { icon: "sword", name: "刺客" },
    mage: { icon: "sparkles", name: "法師" },
    luckster: { icon: "clover", name: "幸運兒" },
  };
  const FIELD_LABEL = {
    crit: { icon: "flame", text: "熾熱戰場(全場傷害+1)" },
    shield_plus: { icon: "shield-check", text: "堅盾戰場(防禦骰+1次)" },
    lifesteal: { icon: "droplet", text: "嗜血戰場(擊中回血1)" },
    chaos_tie: { icon: "dice-5", text: "混沌戰場(平手傷害變2點)" },
    fast_timer: { icon: "wind", text: "疾風戰場(思考時間縮短)" },
    shadow: { icon: "moon", text: "暗影戰場(爆擊傷害加倍・防禦骰-1)" },
  };
  // 觀眾表情彈幕:一律用 lucide 圖示，不用 emoji
  const REACTIONS = { cheer: "party-popper", fire: "flame", love: "heart", laugh: "laugh" };

  function ringUpdate(el, hp, maxHp) {
    const ratio = Math.max(hp, 0) / maxHp;
    el.setAttribute("stroke-dashoffset", CIRC * (1 - ratio));
    el.setAttribute("stroke", hp <= maxHp * 0.25 ? "#E5484D" : hp <= maxHp * 0.5 ? "#F2B705" : "#3DBE6C");
  }

  function fighterHtml(slot) {
    return `
      <div class="fighter">
        <div class="cicon" data-el="p${slot}-class-icon"></div>
        <div class="name" data-el="p${slot}-name">玩家${slot === 1 ? "一" : "二"}</div>
        <div class="hp-dial" data-el="p${slot}-dial">
          <svg width="108" height="108" viewBox="0 0 108 108">
            <circle cx="54" cy="54" r="46" fill="none" stroke="#34304A" stroke-width="10"/>
            <circle data-el="p${slot}-ring" cx="54" cy="54" r="46" fill="none" stroke="#3DBE6C" stroke-width="10" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="0"/>
          </svg>
          <div class="num" data-el="p${slot}-hp">-</div>
        </div>
        <div class="badges-row" data-el="p${slot}-badges" style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:8px;"></div>
      </div>
    `;
  }

  function stageHtml() {
    return `
      <span class="tag" data-el="field-mod-tag" style="display:none;margin-bottom:10px;"></span>
      <div class="sudden-death" data-el="sudden-death-banner" style="display:none;">${ui.icon("skull")}生死局啟動！雙方傷害固定雙倍</div>
      <div class="duel-stage">
        ${fighterHtml(1)}
        <div class="vs-badge">VS<br/><span data-el="round-num" style="font-size:12px;color:var(--ink-dim);">R1</span></div>
        ${fighterHtml(2)}
      </div>
      <div class="big-announce" data-el="big-announce"></div>
      <div class="log-panel" data-el="log"></div>
      <div class="status-msg" data-el="watch-status" style="display:none;"></div>
    `;
  }

  function watchHtml() {
    return `
      <div class="card" data-el="watch-panel" style="display:none;">
        <div style="text-align:center;font-size:12px;color:var(--ink-dim);margin-bottom:12px;">觀眾互動(純娛樂，不影響勝負)</div>
        <div data-el="bet-row" style="display:none;"></div>
        <div class="reaction-bar action-row" data-el="emoji-bar" style="justify-content:center;margin-top:12px;"></div>
        <div data-el="floaties" style="position:relative;height:50px;"></div>
      </div>
    `;
  }

  function mount(stageRoot, watchRoot, opts) {
    const o = opts || {};
    const gameType = o.gameType || "dice";
    const maxHp = MAX_HP[gameType] || 30;
    const matchId = o.matchId;
    const showStatus = o.showStatus !== false;
    const showWatch = o.watch !== false;

    stageRoot.innerHTML = stageHtml();

    let watchHost = watchRoot || null;
    if (showWatch) {
      if (watchHost) {
        watchHost.innerHTML = watchHtml();
      } else {
        const wrap = document.createElement("div");
        wrap.innerHTML = watchHtml();
        stageRoot.appendChild(wrap.firstElementChild);
        watchHost = stageRoot;
      }
    }

    function $(sel) {
      const inStage = stageRoot.querySelector(`[data-el="${sel}"]`);
      if (inStage) return inStage;
      return watchHost ? watchHost.querySelector(`[data-el="${sel}"]`) : null;
    }

    let lastSeenRound = null;
    let announceTimer = null;
    let myBet = null;
    let reactionChannel = null;
    let destroyed = false;

    if (matchId && showWatch) {
      reactionChannel = db.openReactionChannel(matchId, (key) => spawnFloaty(key));
    }
    if (showWatch) bindWatchPanel();

    function names(match) {
      return [match.p1?.name || "玩家一", match.p2?.name || "玩家二"];
    }

    function announce(text, opts2) {
      if (destroyed) return;
      const oo = typeof opts2 === "number" ? { holdMs: opts2 } : opts2 || {};
      const el = $("big-announce");
      if (!el) return;
      el.innerHTML = (oo.icon ? ui.icon(oo.icon) : "") + ui.esc(text);
      el.classList.remove("show");
      void el.offsetWidth;
      el.classList.add("show");
      clearTimeout(announceTimer);
      announceTimer = setTimeout(() => el.classList.remove("show"), oo.holdMs || 2200);
    }

    // 回傳 { text， icon }，交給 announce 去顯示
    function buildHeadline(evt, mySlot, match) {
      if (!evt) return null;
      const [p1Name, p2Name] = names(match);
      if (evt.type === "tie") return { icon: "scale", text: "平手，雙方不掉血" };
      if (evt.type === "timeout_both") return { icon: "hourglass", text: "雙方都逾時，平手" };
      if (evt.type === "match_point") return { icon: "flame", text: "賽末點！下一局就能分出勝負" };
      if (evt.type === "series_game_over") {
        const gWinner = evt.winnerSlot === 1 ? p1Name : p2Name;
        return { icon: "trophy", text: `${gWinner} 拿下第${evt.gameNum}局！比分 ${evt.games1}:${evt.games2}` };
      }
      if (evt.type === "bo_point") {
        const gWinner = evt.winnerSlot === 1 ? p1Name : p2Name;
        return { icon: "flag", text: `${gWinner} 拿下一分！比分 ${evt.games1}:${evt.games2}` };
      }
      const winnerName = evt.winnerSlot === 1 ? p1Name : p2Name;
      const loserName = evt.winnerSlot === 1 ? p2Name : p1Name;
      if (evt.shieldBlocked) {
        if (mySlot === evt.loserSlot) return { icon: "shield-check", text: "你擋下了攻擊，毫髮無傷！" };
        if (mySlot === evt.winnerSlot) return { icon: "shield", text: `${loserName} 擋下了你的攻擊！` };
        return { icon: "shield", text: `${loserName} 擋下攻擊！` };
      }
      if (mySlot === evt.loserSlot) return { icon: "heart-pulse", text: `你扣了 ${evt.dmg} 點血！` };
      if (mySlot === evt.winnerSlot) return { icon: "flame", text: `你獲勝了這回合！${loserName} 扣 ${evt.dmg} 血` };
      return { icon: "swords", text: `${winnerName} 獲勝！${loserName} 扣 ${evt.dmg} 血` };
    }

    function renderBadges(slot, state, rules) {
      const box = $(`p${slot}-badges`);
      if (!box) return;
      const badges = [];
      const combo = slot === 1 ? state.combo1 : state.combo2;
      const comboBonus = slot === 1 ? state.combobonus1 : state.combobonus2;
      const rageready = slot === 1 ? state.rageready1 : state.rageready2;
      if (rules.combo && combo > 0) {
        badges.push(
          `<span class="mini-badge combo">${ui.icon("zap")}連擊x${combo}${comboBonus ? "(+" + comboBonus + ")" : ""}</span>`
        );
      }
      if (rules.rage && rageready) badges.push(`<span class="mini-badge rage">${ui.icon("flame")}怒氣滿</span>`);

      // 五手勢對戰:連段技(連續同招獲勝)、道具符、氣勢系統的徽章
      const winGestureStreak = slot === 1 ? state.winGestureStreak1 : state.winGestureStreak2;
      if (rules.combo && winGestureStreak >= 2) {
        badges.push(`<span class="mini-badge combo">${ui.icon("zap")}連段 x${winGestureStreak}</span>`);
      }
      const item = slot === 1 ? state.rpsitem1 : state.rpsitem2;
      const itemLabels = { shield: { icon: "shield", text: "護盾符" }, amp: { icon: "zap", text: "增幅符" } };
      if (rules.item_die && item && itemLabels[item]) {
        badges.push(`<span class="mini-badge item">${ui.icon(itemLabels[item].icon)}${itemLabels[item].text}</span>`);
      }
      const streak = slot === 1 ? state.streak1 : state.streak2;
      if (rules.momentum && streak >= 2) {
        badges.push(`<span class="mini-badge momentum-up">${ui.icon("trending-up")}連勝 x${streak}</span>`);
      }
      if (rules.momentum && streak <= -2) {
        badges.push(`<span class="mini-badge momentum-down">${ui.icon("trending-down")}背水 x${-streak}</span>`);
      }
      box.innerHTML = badges.join("");
    }

    function update(match, ev, mySlot) {
      if (destroyed || !match || !match.state) return;
      const state = match.state;
      const rules = (ev && ev.rules) || {};
      const [p1Name, p2Name] = names(match);

      $("p1-name").textContent = p1Name;
      $("p2-name").textContent = p2Name;
      $("p1-hp").textContent = Math.max(state.hp1, 0);
      $("p2-hp").textContent = Math.max(state.hp2, 0);
      ringUpdate($("p1-ring"), state.hp1, maxHp);
      ringUpdate($("p2-ring"), state.hp2, maxHp);
      $("round-num").textContent = "R" + state.round;

      const logBox = $("log");
      logBox.innerHTML = (state.log || []).map((l) => `<div>${l}</div>`).join("");
      logBox.scrollTop = logBox.scrollHeight;

      renderBadges(1, state, rules);
      renderBadges(2, state, rules);

      const c1 = CLASS_INFO[state.class1];
      const c2 = CLASS_INFO[state.class2];
      const p1Icon = $("p1-class-icon");
      const p2Icon = $("p2-class-icon");
      // 沒有職業系統(例如五手勢對戰)時整個隱藏，不要留一格空白佔位
      if (p1Icon) {
        p1Icon.style.display = c1 ? "flex" : "none";
        p1Icon.innerHTML = c1 ? ui.icon(c1.icon) + c1.name : "";
      }
      if (p2Icon) {
        p2Icon.style.display = c2 ? "flex" : "none";
        p2Icon.innerHTML = c2 ? ui.icon(c2.icon) + c2.name : "";
      }

      const fieldTag = $("field-mod-tag");
      if (fieldTag) {
        const field = FIELD_LABEL[state.field_mod];
        if (state.field_mod) {
          fieldTag.style.display = "inline-flex";
          fieldTag.innerHTML = field ? ui.icon(field.icon) + `<span>${field.text}</span>` : ui.esc(state.field_mod);
        } else {
          fieldTag.style.display = "none";
        }
      }

      const sdOn =
        rules.sudden_death && state.hp1 <= SUDDEN_DEATH_HP && state.hp2 <= SUDDEN_DEATH_HP && state.hp1 > 0 && state.hp2 > 0;
      const sdBanner = $("sudden-death-banner");
      if (sdBanner) sdBanner.style.display = sdOn ? "block" : "none";

      if (lastSeenRound !== null && state.round !== lastSeenRound) {
        const headline = buildHeadline(state.lastEvent, mySlot, match);
        if (headline) announce(headline.text, { icon: headline.icon });
      }
      lastSeenRound = state.round;

      const over = state.hp1 <= 0 || state.hp2 <= 0;
      if (showStatus) {
        const statusEl = $("watch-status");
        if (statusEl) {
          statusEl.style.display = "block";
          if (over) {
            const winnerName = state.hp1 <= 0 ? p2Name : p1Name;
            statusEl.innerHTML =
              state.forfeitReason === "both_afk"
                ? ui.icon("alert-triangle") + `雙方都太久沒有進場，系統自動判定 ${ui.esc(winnerName)} 晉級`
                : ui.icon("trophy") + `${ui.esc(winnerName)} 獲勝了這場對戰！`;
          } else {
            statusEl.innerHTML = ui.icon("eye") + "觀戰模式・對戰進行中";
          }
        }
      }

      updateWatch(match, ev, mySlot);
    }

    function updateWatch(match, ev, mySlot) {
      if (destroyed || !showWatch) return;
      const rules = (ev && ev.rules) || {};
      const panel = $("watch-panel");
      if (!panel) return;
      const showBetting = rules.betting && !mySlot;
      const showEmoji = rules.reactions;
      if (!showBetting && !showEmoji) {
        panel.style.display = "none";
        return;
      }
      panel.style.display = "block";
      $("bet-row").style.display = showBetting ? "flex" : "none";
      $("emoji-bar").style.display = showEmoji ? "flex" : "none";
      if (showBetting) refreshBets(match, ev);
    }

    async function refreshBets(match, ev) {
      const rules = (ev && ev.rules) || {};
      if (!rules.betting) return;
      const box = $("bet-row");
      if (!box) return;
      const state = match.state;
      const bets = await db.getBets(matchId);
      if (destroyed) return;
      const n1 = bets.filter((b) => b.bet_on === 1).length;
      const n2 = bets.filter((b) => b.bet_on === 2).length;
      const total = n1 + n2;
      const hasBets = total > 0;
      const pct1 = hasBets ? Math.round((n1 / total) * 100) : 0;
      const pct2 = hasBets ? 100 - pct1 : 0;
      const local = db.getLocalPlayer();
      if (local.id) {
        const mine = bets.find((b) => b.player_id === local.id);
        myBet = mine ? mine.bet_on : null;
      }
      const over = state.hp1 <= 0 || state.hp2 <= 0;
      const winnerSlot = over ? (state.hp1 <= 0 ? 2 : 1) : null;
      const [p1Name, p2Name] = names(match);
      const crown = (slot) => (over && winnerSlot === slot ? " " + ui.icon("crown") : "");
      // 沒有人下注時不要顯示百分比跟進度條(避免看起來像已經選了一邊)，只留人數
      const pctBlock = (pct, n) =>
        hasBets
          ? `<div class="pct">${pct}%</div><div class="bar"><div style="width:${pct}%;"></div></div><div style="font-size:10px;color:var(--ink-dim);margin-top:5px;">${n}人下注</div>`
          : `<div style="font-size:10px;color:var(--ink-dim);margin-top:5px;">${n}人下注</div>`;
      box.style.display = "flex";
      box.style.gap = "8px";
      box.style.flexWrap = "wrap";
      box.innerHTML = `
        <div class="bet-btn" data-bet="1" style="${myBet === 1 ? "border-color:var(--gold);" : ""}">
          <div>${ui.esc(p1Name)}${crown(1)}</div>
          ${pctBlock(pct1, n1)}
        </div>
        <div class="bet-btn" data-bet="2" style="${myBet === 2 ? "border-color:var(--gold);" : ""}">
          <div>${ui.esc(p2Name)}${crown(2)}</div>
          ${pctBlock(pct2, n2)}
        </div>
      `;
      if (!hasBets) {
        const hint = document.createElement("div");
        hint.style.cssText = "width:100%;text-align:center;font-size:11px;color:var(--ink-dim);margin-top:8px;";
        hint.textContent = "還沒有人下注，先來投一票";
        box.appendChild(hint);
      }
      if (!over && !myBet) {
        box.querySelectorAll(".bet-btn").forEach((b) => {
          b.style.cursor = "pointer";
          b.onclick = async () => {
            const local2 = await ensureLocalForBet();
            if (!local2) return;
            await db.placeBet(matchId, local2.id, parseInt(b.dataset.bet, 10));
            refreshBets(match, ev);
          };
        });
      }
      if (over && myBet) {
        const guessedRight = myBet === winnerSlot;
        const hint = document.createElement("div");
        hint.style.cssText =
          "width:100%;display:flex;align-items:center;justify-content:center;gap:6px;font-size:12px;color:" +
          (guessedRight ? "var(--green)" : "var(--ink-dim)") +
          ";margin-top:8px;";
        hint.innerHTML = guessedRight ? ui.icon("party-popper") + "你猜對了！" : ui.icon("smile") + "猜錯了，下次加油";
        box.appendChild(hint);
      }
    }

    async function ensureLocalForBet() {
      const local = db.getLocalPlayer();
      if (local.id) return local;
      // 身分一律走 Discord 登入(導覽列也有同一顆按鈕)，這裡不再另外要使用者手打暱稱
      const go = await ui.confirm("下注前要先用 Discord 登入，登入後就能參加投票。", {
        title: "還沒登入",
        icon: "log-in",
        confirmText: "用 Discord 登入",
      });
      if (go) await db.signInWithDiscord();
      return null;
    }

    // 表情彈幕:key 是 REACTIONS 的鍵值，舊版本傳來的 emoji 字串也照樣顯示
    function spawnFloaty(key) {
      const box = $("floaties");
      if (!box) return;
      const span = document.createElement("span");
      span.className = "floaty";
      if (REACTIONS[key]) span.innerHTML = ui.icon(REACTIONS[key]);
      else span.textContent = key;
      span.style.left = 20 + Math.random() * 60 + "%";
      box.appendChild(span);
      setTimeout(() => span.remove(), 2500);
    }

    function bindWatchPanel() {
      const bar = $("emoji-bar");
      if (!bar) return;
      bar.innerHTML = Object.keys(REACTIONS)
        .map((key) => `<button type="button" class="btn ghost small" data-reaction="${key}">${ui.icon(REACTIONS[key])}</button>`)
        .join("");
      bar.querySelectorAll("button").forEach((btn) => {
        btn.onclick = () => {
          const key = btn.dataset.reaction;
          spawnFloaty(key);
          if (reactionChannel) reactionChannel.send(key);
        };
      });
    }

    function destroy() {
      if (destroyed) return;
      destroyed = true;
      clearTimeout(announceTimer);
      if (reactionChannel) {
        reactionChannel.close();
        reactionChannel = null;
      }
      stageRoot.innerHTML = "";
      if (watchRoot) watchRoot.innerHTML = "";
    }

    return { update, announce, destroy };
  }

  return { mount };
})();
