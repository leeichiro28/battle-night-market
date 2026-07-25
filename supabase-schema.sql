<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>五手勢對戰 · 擂台夜市</title>
<link rel="stylesheet" href="assets/style.css" />
</head>
<body>
  <div class="wrap">
    <div class="marquee">
      <span class="eyebrow">✂️ 五手勢對戰</span>
      <h1>石頭剪刀布蜥蜴史波克</h1>
    </div>

    <div class="card">
      <div class="duel-stage">
        <div class="fighter">
          <div class="name" id="p1-name">玩家一</div>
          <div class="hp-dial" id="p1-dial">
            <svg width="108" height="108" viewBox="0 0 108 108">
              <circle cx="54" cy="54" r="46" fill="none" stroke="#34304A" stroke-width="10"/>
              <circle id="p1-ring" cx="54" cy="54" r="46" fill="none" stroke="#3DBE6C" stroke-width="10" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="0"/>
            </svg>
            <div class="num" id="p1-hp">10</div>
          </div>
        </div>
        <div class="vs-badge">VS<br/><span id="round-num" style="font-size:12px;color:var(--ink-dim);">R1</span></div>
        <div class="fighter">
          <div class="name" id="p2-name">玩家二</div>
          <div class="hp-dial" id="p2-dial">
            <svg width="108" height="108" viewBox="0 0 108 108">
              <circle cx="54" cy="54" r="46" fill="none" stroke="#34304A" stroke-width="10"/>
              <circle id="p2-ring" cx="54" cy="54" r="46" fill="none" stroke="#3DBE6C" stroke-width="10" stroke-linecap="round" stroke-dasharray="289" stroke-dashoffset="0"/>
            </svg>
            <div class="num" id="p2-hp">10</div>
          </div>
        </div>
      </div>

      <div class="big-announce" id="big-announce"></div>
      <div class="log-panel" id="log"></div>

      <div class="timer-bar"><div id="timer-fill" style="width:100%"></div></div>

      <div class="choice-row" id="choice-row">
        <button class="choice-btn" data-g="rock">🪨<span class="lbl">石頭</span></button>
        <button class="choice-btn" data-g="paper">📄<span class="lbl">布</span></button>
        <button class="choice-btn" data-g="scissors">✂️<span class="lbl">剪刀</span></button>
        <button class="choice-btn" data-g="lizard">🦎<span class="lbl">蜥蜴</span></button>
        <button class="choice-btn" data-g="spock">🖖<span class="lbl">史波克</span></button>
      </div>
      <button class="btn ghost block" id="ult-btn" style="margin-top:10px;">⚡ 使出究極手勢(尚未使用,保證獲勝該回合)</button>

      <div class="status-msg" id="game-status">選擇你的手勢!</div>
    </div>

    <div class="footer-nav" id="back-link" style="display:none;"><a href="index.html">← 回活動列表</a></div>
  </div>

  <button class="btn ghost rule-fab" id="rule-fab-btn">📖 規則說明</button>
  <div class="modal-overlay" id="rule-modal">
    <div class="modal-card">
      <h3>✂️ 五手勢對戰規則</h3>
      <div id="rule-content"></div>
      <button class="btn ghost block" id="rule-close-btn">關閉</button>
    </div>
  </div>

  <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js"></script>
  <script src="assets/supabase-config.js"></script>
  <script src="assets/db.js"></script>
  <script src="assets/rps5.js"></script>
</body>
</html>
