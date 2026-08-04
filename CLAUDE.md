# CLAUDE.md — 擂台夜市開發規範

純靜態網站(HTML + CSS + 原生 JS)，沒有 build step。所有頁面共用 `assets/style.css`、
`assets/db.js`(資料庫)、`assets/ui.js`(圖示 / 對話框 / 標籤)、`assets/header.js`(導覽列)。

## 圖示:一律使用 lucide

**規則:全站不使用 emoji 當圖示，一律使用 [lucide](https://lucide.dev) 圖示。**

- 每個頁面都要在其他 script 之前載入 lucide:
  ```html
  <script src="https://cdn.jsdelivr.net/npm/lucide@1.27.0/dist/umd/lucide.min.js"></script>
  ```
  版本要固定，不要用 `@latest`。
- JS 裡產生圖示用 `ui.icon(name)`，回傳的是 HTML 字串:
  ```js
  btn.innerHTML = ui.icon("trophy") + "查看結果";
  box.innerHTML = `<span class="tag">${ui.icon("flame")}怒氣值</span>`;
  ```
- 靜態 HTML 裡直接寫 `<i data-lucide="dices" class="ico"></i>`。
- `assets/ui.js` 有一個 MutationObserver，會自動把新塞進畫面的 `<i data-lucide>` 換成 `<svg>`，
  **不需要**自己呼叫 `lucide.createIcons()`。
- 圖示名稱必須是 lucide 真的有的名字(例如 `house` 不是 `home`、`circle-question-mark` 不是 `circle-help`)，
  名稱打錯 lucide 只會在 console 警告，畫面上什麼都不會出現。
- 圖示大小靠 CSS 控制(`.ico { width:1em; height:1em }`)，需要特定尺寸時用 `ui.icon(name， { size: "26px" })`。
- 遊戲類型 / 活動狀態 / 進階規則 / 職業的圖示對應表統一放在 `assets/ui.js` 的
  `GAME`、`STATUS_ICON`、`RULE`、`CLASS_ICON`，新增規則時在那裡加一筆，不要在各頁面自己寫一份。
- 寫進資料庫的戰報字串(match state 的 `log`)保持純文字，不要塞圖示或 HTML。

## 對話框:不要用瀏覽器原生彈窗

**規則:不要使用 `alert()` / `confirm()` / `prompt()`，一律用 `assets/ui.js` 的對話框。**

```js
await ui.alert("訊息", { title: "標題", tone: "danger" });
const ok = await ui.confirm("確定要刪除嗎?", { title: "刪除活動", confirmText: "永久刪除", tone: "danger" });
const name = await ui.prompt("輸入新的暱稱", { title: "修改暱稱", value: 舊名字, maxLength: 16 });
```

- `ui.confirm` 回傳 boolean;`ui.prompt` 回傳字串，使用者取消時回傳 `null`。
- `tone` 可用 `info`(預設)/ `question` / `danger` / `success`，會換掉左上角圖示與顏色。
- 三個都是 Promise，呼叫端要 `await`(callback 記得宣告成 `async`)。

## 版面規則

- **按鈕文字不換行**:`.btn` 已設定 `white-space:nowrap; flex-shrink:0`。
  不要為了塞進窄容器而讓中文被擠成一字一行;整行寬的 `.btn.block` 才允許換行。
- **輸入框要對齊**:同一批列表裡的輸入框必須切齊。後台參加者列用 `.admin-row`
  (grid `名字欄 / 輸入框 / 按鈕`)，欄寬固定，名字長短不影響輸入框位置。
- **對戰列的 vs 要置中**:用 `.match-row > .vs-row`(grid `1fr auto 1fr`)，
  左右選手各自靠邊，`vs` 永遠在正中央。不要用 `justify-content:space-between` 排三個元素。
- **元件之間要有間距**:一排標籤用 `.tag-row`、一排按鈕用 `.action-row`(都有 `gap`)，
  不要靠 `margin-right` 或讓元素黏在一起。
- **RWD 不能跑版**:手機上不允許出現橫向捲軸。
  - flex / grid 的子項要能被壓縮(`min-width:0`)，長字串用 `overflow-wrap:anywhere`。
  - 新增寬元件(表格、iframe、圖表)時要自己處理溢出，並在 375px 寬度下確認過。

## 帳號相關 UI

- 帳號名稱、改名、登出、Discord 登入按鈕**只放在導覽列**(`assets/header.js`)，
  頁面內容區不要再放一份。
- Discord 登入後若偵測到使用者還沒取好名字(空白、`Discord玩家`、或仍等於 Discord 帳號名稱)，
  `header.js` 會自動打開改名對話框;同一個帳號在同一台裝置只會主動問一次
  (記在 localStorage 的 `nickname_prompted_for`)。

## 其他

- 把使用者輸入(玩家暱稱、活動名稱、獎勵文字)插進 `innerHTML` 前要先 `ui.esc()`。
- favicon 是 `assets/favicon.svg`(lucide dice-5)，每個頁面都要有
  `<link rel="icon" type="image/svg+xml" href="assets/favicon.svg" />`。
- 註解與畫面文案使用繁體中文。
