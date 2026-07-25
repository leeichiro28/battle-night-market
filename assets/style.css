/* ===== Design tokens =====
   主題:夜市博弈攤 — 深夜攤位燈牌氛圍
   bg      #14121C  深靛黑(攤位陰影)
   panel   #1E1B2A  面板底
   line    #34304A  分隔線
   gold    #F2B705  燈牌金(主要強調色)
   gold-d  #C99A04  金色深階
   red     #E5484D  傷害/警示
   green   #3DBE6C  治療/勝利
   ink     #EDEAE2  主要文字(暖白)
   ink-dim #9C97B0  次要文字
*/
:root{
  --bg:#14121C;
  --panel:#1E1B2A;
  --panel2:#242038;
  --line:#34304A;
  --gold:#F2B705;
  --gold-d:#C99A04;
  --red:#E5484D;
  --green:#3DBE6C;
  --ink:#EDEAE2;
  --ink-dim:#9C97B0;
  --radius:14px;
}

@font-face{
  font-family:'Display';
  src:local('Archivo Black');
}

*{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{
  background:
    radial-gradient(circle at 15% 0%, #241f38 0%, transparent 45%),
    radial-gradient(circle at 85% 10%, #2a1f2f 0%, transparent 40%),
    var(--bg);
  color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang TC","Noto Sans TC",sans-serif;
  min-height:100vh;
  line-height:1.55;
}

.mono{font-family:'Space Mono',ui-monospace,SFMono-Regular,Menlo,monospace;}

h1,h2,h3{
  font-family:'Archivo Black','PingFang TC','Noto Sans TC',sans-serif;
  letter-spacing:.01em;
  margin:0 0 .4em;
}

a{color:var(--gold);text-decoration:none;}

.wrap{
  max-width:920px;
  margin:0 auto;
  padding:28px 20px 80px;
}

/* 燈牌招牌標頭 */
.marquee{
  text-align:center;
  padding:38px 20px 30px;
  position:relative;
}
.marquee .eyebrow{
  display:inline-block;
  font-size:12px;
  letter-spacing:.28em;
  color:var(--gold);
  text-transform:uppercase;
  border:1px solid var(--gold-d);
  border-radius:999px;
  padding:4px 14px;
  margin-bottom:14px;
}
.marquee h1{
  font-size:clamp(30px,6vw,52px);
  color:var(--ink);
  text-shadow:0 0 18px rgba(242,183,5,.25);
}
.marquee h1 span{color:var(--gold);}
.marquee p{color:var(--ink-dim);font-size:15px;max-width:520px;margin:10px auto 0;}

/* 卡片 */
.card{
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:20px;
  margin-bottom:16px;
}
.card + .card{margin-top:16px;}

.event-card{
  display:flex;
  justify-content:space-between;
  align-items:center;
  gap:16px;
  flex-wrap:wrap;
}
.event-card .meta{flex:1;min-width:180px;}
.event-card h3{font-size:18px;margin-bottom:4px;}
.tag{
  display:inline-block;
  font-size:11px;
  letter-spacing:.06em;
  padding:3px 9px;
  border-radius:999px;
  background:var(--panel2);
  color:var(--ink-dim);
  border:1px solid var(--line);
  margin-right:6px;
}
.tag.open{color:var(--green);border-color:var(--green);}
.tag.closed{color:var(--red);border-color:var(--red);}
.tag.running{color:var(--gold);border-color:var(--gold-d);}

/* 按鈕 */
.btn{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  gap:6px;
  background:var(--gold);
  color:#1B1706;
  font-weight:700;
  border:none;
  border-radius:10px;
  padding:11px 20px;
  font-size:14px;
  cursor:pointer;
  transition:transform .12s ease, box-shadow .12s ease;
  box-shadow:0 0 0 rgba(242,183,5,0);
}
.btn:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(242,183,5,.25);}
.btn:active{transform:translateY(0);}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none;box-shadow:none;}
.btn.ghost{
  background:transparent;
  color:var(--ink);
  border:1px solid var(--line);
}
.btn.ghost:hover{border-color:var(--gold-d);box-shadow:none;}
.btn.danger{background:var(--red);color:#2A0B0C;}
.btn.block{width:100%;}
.btn.small{padding:7px 14px;font-size:13px;}

input,select,textarea{
  width:100%;
  background:var(--panel2);
  border:1px solid var(--line);
  color:var(--ink);
  border-radius:9px;
  padding:11px 13px;
  font-size:14px;
  font-family:inherit;
}
input:focus,select:focus,textarea:focus{
  outline:2px solid var(--gold-d);
  outline-offset:1px;
}
label{
  display:block;
  font-size:12px;
  color:var(--ink-dim);
  margin-bottom:6px;
  letter-spacing:.03em;
}
.field{margin-bottom:14px;}

.empty{
  text-align:center;
  color:var(--ink-dim);
  padding:40px 20px;
  border:1px dashed var(--line);
  border-radius:var(--radius);
  font-size:14px;
}

.footer-nav{
  text-align:center;
  margin-top:36px;
  font-size:13px;
  color:var(--ink-dim);
}

/* ===== HP 環形錶 (簽名元素) ===== */
.duel-stage{
  display:grid;
  grid-template-columns:1fr auto 1fr;
  gap:14px;
  align-items:center;
  margin:18px 0 26px;
}
.fighter{text-align:center;}
.fighter .name{font-size:14px;color:var(--ink-dim);margin-bottom:8px;}
.hp-dial{
  position:relative;
  width:108px;height:108px;
  margin:0 auto;
  border-radius:50%;
  display:flex;align-items:center;justify-content:center;
}
.hp-dial svg{position:absolute;top:0;left:0;transform:rotate(-90deg);}
.hp-dial .num{font-family:'Space Mono',monospace;font-size:22px;font-weight:700;}
.vs-badge{
  font-family:'Archivo Black';
  color:var(--gold);
  font-size:22px;
  text-align:center;
}

.log-panel{
  background:var(--panel2);
  border:1px solid var(--line);
  border-radius:10px;
  padding:12px 14px;
  height:120px;
  overflow-y:auto;
  font-size:13px;
  color:var(--ink-dim);
  font-family:'Space Mono',monospace;
}
.log-panel div{padding:2px 0;border-bottom:1px dashed var(--line);}
.log-panel div:last-child{border-bottom:none;color:var(--ink);}

.choice-row{
  display:grid;
  grid-template-columns:repeat(auto-fit,minmax(84px,1fr));
  gap:10px;
  margin-top:16px;
}
.choice-btn{
  background:var(--panel2);
  border:1px solid var(--line);
  border-radius:12px;
  padding:16px 8px;
  text-align:center;
  cursor:pointer;
  font-size:28px;
  transition:border-color .12s, transform .12s;
}
.choice-btn:hover{border-color:var(--gold-d);transform:translateY(-2px);}
.choice-btn.picked{border-color:var(--gold);box-shadow:0 0 0 2px rgba(242,183,5,.25) inset;}
.choice-btn .lbl{display:block;font-size:11px;color:var(--ink-dim);margin-top:6px;}
.choice-btn:disabled{opacity:.35;cursor:not-allowed;}

.timer-bar{
  height:6px;
  background:var(--panel2);
  border-radius:999px;
  overflow:hidden;
  margin:14px 0 4px;
}
.timer-bar > div{
  height:100%;
  background:var(--gold);
  transition:width .1s linear;
}

.reward-badge{
  display:inline-flex;
  align-items:center;
  gap:6px;
  background:rgba(242,183,5,.12);
  border:1px solid var(--gold-d);
  color:var(--gold);
  border-radius:999px;
  padding:3px 12px;
  font-size:12px;
}

.bracket-row{
  display:flex;
  justify-content:space-between;
  align-items:center;
  padding:10px 0;
  border-bottom:1px solid var(--line);
  font-size:14px;
}
.bracket-row:last-child{border-bottom:none;}
.bracket-row .win{color:var(--green);font-weight:700;}
.bracket-row .lose{color:var(--ink-dim);text-decoration:line-through;}

.status-msg{
  text-align:center;
  color:var(--ink-dim);
  font-size:13px;
  margin:10px 0;
}

.toast{
  position:fixed;
  bottom:24px;left:50%;
  transform:translateX(-50%);
  background:var(--panel2);
  border:1px solid var(--gold-d);
  color:var(--ink);
  padding:10px 18px;
  border-radius:10px;
  font-size:13px;
  z-index:99;
}

/* ===== 規則說明彈窗 ===== */
.rule-fab{
  position:fixed;
  bottom:22px;right:22px;
  z-index:80;
  border-radius:999px;
  box-shadow:0 6px 20px rgba(0,0,0,.4);
}
.modal-overlay{
  position:fixed;inset:0;
  background:rgba(10,9,15,.72);
  display:none;
  align-items:center;justify-content:center;
  z-index:200;
  padding:20px;
}
.modal-overlay.show{display:flex;}
.modal-card{
  background:var(--panel);
  border:1px solid var(--line);
  border-radius:var(--radius);
  padding:24px;
  max-width:480px;
  width:100%;
  max-height:78vh;
  overflow-y:auto;
}
.modal-card h3{font-size:18px;margin-bottom:12px;}
.modal-card h4{font-size:13px;color:var(--gold);margin:16px 0 6px;}
.modal-card p{font-size:13px;color:var(--ink-dim);margin:0 0 10px;line-height:1.7;}
.modal-card p:first-of-type{margin-top:0;}

/* ===== 大字即時公告 ===== */
.big-announce{
  text-align:center;
  font-family:'Archivo Black','PingFang TC','Noto Sans TC',sans-serif;
  font-size:clamp(18px,5vw,26px);
  color:var(--gold);
  min-height:36px;
  margin:6px 0 4px;
  text-shadow:0 0 18px rgba(242,183,5,.35);
  opacity:0;
  transform:translateY(4px);
  transition:opacity .25s ease, transform .25s ease;
}
.big-announce.show{opacity:1;transform:translateY(0);}

.spectator-tag{
  display:inline-block;
  font-size:12px;
  color:var(--ink-dim);
  border:1px solid var(--line);
  border-radius:999px;
  padding:3px 12px;
  margin-top:8px;
}
