// 職業養成對決 · 規則彈窗內容(career.html / tower.html 共用，跟其他遊戲同一套
// rule-fab + #rule-modal 彈窗機制，完整版規則在 rules.html#career)
window.CareerRules = (function () {
  function html() {
    return `
      <h4>${ui.icon("user")} 職業與轉職</h4>
      <p>一開始是<b style="color:var(--ink);">見習學徒</b>。<b style="color:var(--gold);">Lv.5</b> 選一個系(力量/敏捷/魔法)；<b style="color:var(--gold);">Lv.15</b> 在選定的系裡定案最終職業(戰士/守衛、弓箭手/刺客、法師/巫醫)，選了就不能再改，每次轉職都會直接送一筆永久加點。法師、巫醫是用<b style="color:var(--epic);">魔攻</b>而不是攻擊力打人。</p>

      <h4>${ui.icon("heart-pulse")} HP / 魔力值</h4>
      <p>爬塔的HP、魔力值是<b style="color:var(--ink);">持續的</b>，打輸不會補滿，要靠藥水、事件或休息恢復；HP見底也不會卡關，會自動保留三成復活，馬上能再挑戰。任何職業都有魔力值，大招要花魔力才能用(不是限用一次)，每回合會回一點。</p>

      <h4>${ui.icon("wand-sparkles")} 技能樹</h4>
      <p>每升一級送1技能點，花1點可以解鎖「戰技」——比大招便宜、效果單純的第二個主動技能，守衛、巫醫解鎖後終於有主動輸出手段。</p>

      <h4>${ui.icon("mountain")} 訓練期:爬塔</h4>
      <p>時間到自動切換到對戰期(主辦人也能提前手動結束)。<b style="color:var(--ink);">特訓</b>每90秒領一次穩定收入；<b style="color:var(--ink);">挑戰樓層</b>無CD，一般樓層AI直接算完整場，每滿10層的關主要手動即時對戰(可以撤退)；<b style="color:var(--ink);">練功掛機</b>只能掛已清過的樓層，效率七折。挑戰樓層有 25% 機率遇到隨機事件。</p>

      <h4>${ui.icon("store")} 商店 / 抽獎機 / 合成 / 背包</h4>
      <p>裝備四級稀有度:${ui.tierTag("common")}${ui.tierTag("rare")}${ui.tierTag("epic")}${ui.tierTag("legendary")}，武器分職業，${ui.tierTag("legendary")}整場限購1件。裝備等級門檻是「第幾層掉的」決定，樓層越高門檻越高。撿到/買到的裝備都先進背包，要自己選要不要穿上。同部位同稀有度湊滿3件可以在「合成」分頁賭一把升級。</p>

      <h4>${ui.icon("flame")} 對戰期:PVP</h4>
      <p>訓練期結束後開放，先進先配的持續配對池，打完立刻回佇列排下一場(PVP永遠滿血滿魔開打，跟爬塔的持續HP是兩件事)。每回合選普通攻擊、戰技或大招，速度快的先手，30秒沒動作自動出普通攻擊。PVP數值就是爬塔練出來的基礎值+加點+裝備。</p>

      <h4>${ui.icon("trophy")} 積分</h4>
      <p>PVP戰績分(贏+10、連勝加成最高+10、輸+2) + 爬塔高度加成(每10層+5分)，活動結束依總分排行、套用主辦人設定的獎勵。</p>

      <p style="text-align:center;margin-top:14px;"><a href="rules.html#career" target="_blank" style="color:var(--gold);font-size:12.5px;">${ui.icon("book-open", { size: "14px" })}查看完整規則(含樓層怪物/掉落表) →</a></p>
    `;
  }
  return { html };
})();
