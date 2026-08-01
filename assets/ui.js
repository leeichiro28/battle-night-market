// 共用 UI 層。所有頁面都要在 db.js 之後、頁面腳本之前載入這個檔案。
//
// 這裡負責三件事:
//   1. 圖示:全站統一使用 lucide,不使用 emoji。用 ui.icon("dices") 產生標記。
//   2. 對話框:取代瀏覽器原生 alert / confirm / prompt。
//   3. 共用標籤:遊戲類型、活動狀態、進階規則、報名截止時間等有圖示的 tag。
const ui = (function () {
  // ---------- 小工具 ----------
  const ESC_MAP = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ESC_MAP[c]);
  }

  // ---------- lucide 圖示 ----------
  // 用法:container.innerHTML = ui.icon("trophy") + "冠軍"
  // 產生的 <i data-lucide> 會由下面的 MutationObserver 自動換成 <svg>,
  // 所以動態塞進畫面的內容不用自己再呼叫 lucide.createIcons()。
  function icon(name, opts) {
    const o = opts || {};
    const cls = o.cls ? " " + o.cls : "";
    const style = o.size ? ` style="width:${o.size};height:${o.size};"` : "";
    return `<i data-lucide="${esc(name)}" class="ico${cls}"${style} aria-hidden="true"></i>`;
  }

  function iconEl(name, opts) {
    const holder = document.createElement("span");
    holder.innerHTML = icon(name, opts);
    return holder.firstElementChild;
  }

  // ---------- 募資總額(獎勵名稱 + 數量)橫向顯示 ----------
  // 用在贊助頁的大總額、後台的「這份名單贊助總額」跟「全部活動累積贊助總額」。
  // totals: [{ name, qty }, ...],一律依數量由多到少排序後再輸出,
  // 不然同一批獎勵每次重新整理排列順序都不一樣,數量小的擠在最顯眼的位置很醜。
  function rewardTotalsHtml(totals, opts) {
    const o = opts || {};
    if (!totals || !totals.length) {
      return `<div class="raised-total-empty">${esc(o.emptyText || "尚未公布")}</div>`;
    }
    const sorted = totals.slice().sort((a, b) => b.qty - a.qty);
    const alignCls = o.align ? ` align-${o.align}` : "";
    const items = sorted
      .map(
        (r) =>
          `<span class="raised-total-item"><span class="rt-name">${esc(r.name)}</span><span class="rt-qty">${Number(r.qty).toLocaleString()}</span></span>`
      )
      .join("");
    return `<div class="raised-total-row${alignCls}">${items}</div>`;
  }

  let iconObserver = null;
  let refreshQueued = false;
  let refreshing = false;

  function refreshIcons() {
    if (!window.lucide || typeof window.lucide.createIcons !== "function") return;
    refreshing = true;
    try {
      window.lucide.createIcons();
      // lucide 換出來的 <svg> 仍留著 data-lucide,下次掃描會被重複替換一次,這裡直接拔掉
      document.querySelectorAll("svg[data-lucide]").forEach((el) => el.removeAttribute("data-lucide"));
    } catch (e) {
      /* lucide 沒載到就維持原樣,不要讓整頁壞掉 */
    }
    // createIcons 把 <i> 換成 <svg> 本身也會觸發 observer,這裡直接把這批紀錄丟掉避免無限迴圈
    if (iconObserver) iconObserver.takeRecords();
    refreshing = false;
  }

  function queueIconRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    requestAnimationFrame(() => {
      refreshQueued = false;
      refreshIcons();
    });
  }

  function startIconWatcher() {
    if (iconObserver) return;
    iconObserver = new MutationObserver(() => {
      if (!refreshing) queueIconRefresh();
    });
    iconObserver.observe(document.documentElement, { childList: true, subtree: true });
    queueIconRefresh();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", startIconWatcher);
  } else {
    startIconWatcher();
  }
  window.addEventListener("load", () => {
    // lucide 沒載入成功(離線/CDN 掛掉)就把佔位的 <i> 藏起來,版面不要留一格空白
    if (!window.lucide) document.documentElement.classList.add("no-lucide");
    queueIconRefresh();
  });

  // ---------- 共用資料:遊戲 / 狀態 / 規則 ----------
  const GAME = {
    dice: { icon: "dices", label: "骰子對戰" },
    rps5: { icon: "scissors", label: "五手勢對戰" },
  };
  const STATUS = { open: "開放參加", running: "進行中", closed: "已結束" };
  const STATUS_ICON = { open: "door-open", running: "swords", closed: "flag" };
  const RULE = {
    item_die: { icon: "gift", label: "道具骰" },
    field_mod: { icon: "tornado", label: "戰場修飾" },
    dynamic_field: { icon: "orbit", label: "動態戰場" },
    free_bet: { icon: "coins", label: "自由加注" },
    rage: { icon: "flame", label: "怒氣值" },
    stance: { icon: "sword", label: "出招姿態" },
    combo: { icon: "zap", label: "連擊值" },
    dice_gamble: { icon: "dice-5", label: "雙骰豪賭" },
    sudden_death: { icon: "skull", label: "生死局" },
    classes: { icon: "swords", label: "職業系統" },
    betting: { icon: "eye", label: "觀眾下注" },
    reactions: { icon: "message-circle", label: "表情彈幕" },
    bomb: { icon: "bomb", label: "隱藏第六手勢" },
    momentum: { icon: "trending-up", label: "氣勢系統" },
    mutation: { icon: "shuffle", label: "手勢突變" },
    mindread: { icon: "brain", label: "讀心值" },
    bo_mode: { icon: "list-ordered", label: "BO制" },
    dual_hand: { icon: "split", label: "雙手出招" },
  };
  const CLASS_ICON = { fighter: "swords", guardian: "shield", gambler: "dice-5", assassin: "sword", mage: "sparkles", luckster: "clover" };

  function gameLabel(type) {
    return (GAME[type] && GAME[type].label) || type;
  }
  function gameIcon(type) {
    return (GAME[type] && GAME[type].icon) || "gamepad-2";
  }
  function statusLabel(status) {
    return STATUS[status] || status;
  }

  // 有圖示的 pill 標籤
  function tag(iconName, text, cls) {
    return `<span class="tag${cls ? " " + cls : ""}">${icon(iconName)}<span>${esc(text)}</span></span>`;
  }
  function gameTag(type) {
    return tag(gameIcon(type), gameLabel(type));
  }
  function statusTag(status) {
    return tag(STATUS_ICON[status] || "circle-alert", statusLabel(status), status);
  }
  function losersTag() {
    return tag("medal", "敗部復活賽");
  }
  function ruleTags(rules) {
    return Object.keys(rules || {})
      .filter((k) => rules[k] && RULE[k])
      .map((k) => tag(RULE[k].icon, RULE[k].label))
      .join("");
  }

  function formatDeadline(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    return d.toLocaleString("zh-TW", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function deadlineTag(iso, prefix) {
    const text = formatDeadline(iso);
    if (!text) return "";
    const passed = new Date() > new Date(iso);
    return tag("alarm-clock", `${prefix || "截止"} ${text}`, passed ? "closed" : "");
  }

  // 名次徽章:第 1 名皇冠、2~3 名獎牌,其他就純數字
  function rankBadge(rank) {
    if (!rank) return "";
    if (rank === 1) return `<span class="rank-badge rank-1">${icon("crown")}</span>`;
    if (rank === 2 || rank === 3) return `<span class="rank-badge rank-${rank}">${icon("medal")}</span>`;
    return `<span class="rank-badge">第${rank}名</span>`;
  }

  // ---------- 對話框(取代原生 alert / confirm / prompt) ----------
  const TONE_ICON = {
    info: "circle-alert",
    question: "circle-question-mark",
    danger: "triangle-alert",
    success: "circle-check",
  };

  let openDialogs = 0;

  function openDialog(opts) {
    const o = opts || {};
    const tone = o.tone || "info";
    const hasInput = !!o.input;

    return new Promise((resolve) => {
      const overlay = document.createElement("div");
      overlay.className = "dialog-overlay";
      overlay.innerHTML = `
        <div class="dialog-card" role="dialog" aria-modal="true">
          <div class="dialog-head">
            <span class="dialog-icon tone-${esc(tone)}">${icon(o.icon || TONE_ICON[tone] || "circle-alert")}</span>
            <h3 class="dialog-title">${esc(o.title || "提醒")}</h3>
          </div>
          ${o.message ? `<div class="dialog-body">${o.html ? o.message : esc(o.message).replace(/\n/g, "<br/>")}</div>` : ""}
          ${
            hasInput
              ? `<div class="dialog-field">
                   ${o.input.label ? `<label for="dialog-input">${esc(o.input.label)}</label>` : ""}
                   <input id="dialog-input" class="dialog-input" type="text"
                          placeholder="${esc(o.input.placeholder || "")}"
                          maxlength="${o.input.maxLength || 200}" />
                 </div>`
              : ""
          }
          <div class="dialog-actions">
            ${o.cancelText === null ? "" : `<button type="button" class="btn ghost dialog-cancel">${esc(o.cancelText || "取消")}</button>`}
            <button type="button" class="btn${tone === "danger" ? " danger" : ""} dialog-ok">${esc(o.confirmText || "確定")}</button>
          </div>
        </div>
      `;

      const input = overlay.querySelector(".dialog-input");
      if (input && o.input.value != null) input.value = o.input.value;

      const lastFocused = document.activeElement;
      let closed = false;
      function close(result) {
        if (closed) return;
        closed = true;
        overlay.classList.remove("show");
        document.removeEventListener("keydown", onKey, true);
        openDialogs = Math.max(0, openDialogs - 1);
        if (!openDialogs) document.body.classList.remove("dialog-open");
        setTimeout(() => overlay.remove(), 160);
        if (lastFocused && lastFocused.focus) lastFocused.focus();
        resolve(result);
      }

      function submit() {
        if (!hasInput) return close(true);
        const value = (input.value || "").trim();
        if (o.input.required !== false && !value) {
          input.focus();
          overlay.querySelector(".dialog-card").classList.remove("shake");
          void overlay.offsetWidth;
          overlay.querySelector(".dialog-card").classList.add("shake");
          return;
        }
        close(value);
      }

      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          close(hasInput ? null : false);
        } else if (e.key === "Enter" && (hasInput || document.activeElement === overlay.querySelector(".dialog-ok"))) {
          e.preventDefault();
          submit();
        }
      }

      overlay.querySelector(".dialog-ok").onclick = submit;
      const cancelBtn = overlay.querySelector(".dialog-cancel");
      if (cancelBtn) cancelBtn.onclick = () => close(hasInput ? null : false);
      overlay.onclick = (e) => {
        if (e.target === overlay && o.dismissible !== false) close(hasInput ? null : false);
      };
      document.addEventListener("keydown", onKey, true);

      document.body.appendChild(overlay);
      openDialogs++;
      document.body.classList.add("dialog-open");
      requestAnimationFrame(() => {
        overlay.classList.add("show");
        if (input) {
          input.focus();
          input.select();
        } else {
          overlay.querySelector(".dialog-ok").focus();
        }
      });
    });
  }

  // ui.alert("訊息") -> Promise<void>
  function alertDialog(message, opts) {
    return openDialog({
      title: "提醒",
      tone: "info",
      confirmText: "知道了",
      cancelText: null,
      ...(opts || {}),
      message,
    }).then(() => undefined);
  }

  // ui.confirm("要刪除嗎?") -> Promise<boolean>
  function confirmDialog(message, opts) {
    return openDialog({
      title: "請確認",
      tone: "question",
      confirmText: "確定",
      cancelText: "取消",
      ...(opts || {}),
      message,
    }).then((r) => r === true);
  }

  // ui.prompt("輸入暱稱", { value, placeholder }) -> Promise<string|null>
  function promptDialog(message, opts) {
    const o = opts || {};
    return openDialog({
      title: o.title || "請輸入",
      tone: "question",
      icon: o.icon || "pencil",
      confirmText: o.confirmText || "確定",
      cancelText: o.cancelText === undefined ? "取消" : o.cancelText,
      dismissible: o.dismissible,
      message,
      input: {
        value: o.value || "",
        placeholder: o.placeholder || "",
        maxLength: o.maxLength || 200,
        label: o.label,
        required: o.required,
      },
    });
  }

  return {
    esc,
    icon,
    iconEl,
    refreshIcons,
    rewardTotalsHtml,
    GAME,
    RULE,
    CLASS_ICON,
    gameLabel,
    gameIcon,
    statusLabel,
    tag,
    gameTag,
    statusTag,
    losersTag,
    ruleTags,
    formatDeadline,
    deadlineTag,
    rankBadge,
    dialog: openDialog,
    alert: alertDialog,
    confirm: confirmDialog,
    prompt: promptDialog,
  };
})();
