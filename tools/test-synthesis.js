// 階段三驗證:掉落表、合成機率/保底/費用。執行:node tools/test-synthesis.js
global.window = {};
require("../assets/career-data.js");
require("../assets/career-floors.js");
const CF = window.CareerFloors;
let bad = 0;
const fail = (m) => { bad++; console.log("FAIL", m); };

// 1) 一般樓層(非關主)不掉傳說;40 層以前不掉史詩、40 層起掉史詩
CF.FLOORS.forEach((f) => {
  const keys = Object.keys(f.dropRarityWeights);
  if (!f.isMiniBoss && keys.includes("legendary")) fail(`第${f.floor}層一般樓層不該掉傳說:${keys}`);
  if (!f.isMiniBoss && f.floor < 40 && keys.includes("epic")) fail(`第${f.floor}層(40層以前)一般樓層不該掉史詩`);
  if (!f.isMiniBoss && f.floor >= 40 && !keys.includes("epic")) fail(`第${f.floor}層(40層起)一般樓層應該要掉史詩`);
  if (f.isMiniBoss && !keys.includes("epic")) fail(`第${f.floor}層關主沒有史詩掉落`);
  const sum = Object.values(f.dropRarityWeights).reduce((a, b) => a + b, 0);
  if (Math.abs(sum - 1) > 1e-6) fail(`第${f.floor}層掉落權重總和 ${sum}`);
});
console.log("掉落表檢查完成(50 層)");

// 2) 合成路徑與保底
if (CF.SYNTHESIS_PATH.epic !== "legendary") fail("史詩沒有開放合成傳說");
if (CF.SYNTHESIS_PATH.legendary) fail("傳說不該再往上合成");
const expect = [["rare", 0, 0.5], ["rare", 3, 0.8], ["rare", 9, 0.9], ["epic", 0, 0.2], ["epic", 1, 0.3], ["epic", 4, 0.6], ["epic", 20, 0.6]];
expect.forEach(([r, n, e]) => { const g = CF.synthesisRate(r, n); if (Math.abs(g - e) > 1e-9) fail(`${r} 連敗${n} 成功率 ${g} ≠ ${e}`); });

// 3) 蒙地卡羅:各階平均要失敗幾次、花多少幣、要消耗幾件
function trial(rarity) {
  let streak = 0, tries = 0;
  for (;;) {
    tries++;
    if (Math.random() < CF.synthesisRate(rarity, streak)) return tries;
    streak++;
  }
}
const N = 200000;
const avg = (r) => { let s = 0; for (let i = 0; i < N; i++) s += trial(r); return s / N; };
const aRare = avg("rare"), aEpic = avg("epic");
console.log(`\n稀有→史詩:平均 ${aRare.toFixed(2)} 次成功,花幣 ${Math.round(aRare * CF.SYNTHESIS_COIN_COST.rare)}`);
console.log(`史詩→傳說:平均 ${aEpic.toFixed(2)} 次成功,花幣 ${Math.round(aEpic * CF.SYNTHESIS_COIN_COST.epic)}`);
// 失敗會退回 1 件同稀有度,所以每次嘗試實際淨耗 2 件(成功那次淨耗 3 件)
const rareNeeded = (aRare - 1) * 2 + 3, epicNeeded = (aEpic - 1) * 2 + 3;
console.log(`\n合成 1 件史詩,平均淨耗 ${rareNeeded.toFixed(1)} 件稀有`);
console.log(`合成 1 件傳說,平均淨耗 ${epicNeeded.toFixed(1)} 件史詩`);
const rareForLegend = epicNeeded * rareNeeded; // 若史詩全靠合成
console.log(`若史詩全靠稀有合成,1 件傳說約需 ${rareForLegend.toFixed(0)} 件稀有、${Math.round((epicNeeded * aRare * CF.SYNTHESIS_COIN_COST.rare + aEpic * CF.SYNTHESIS_COIN_COST.epic))} 幣`);
console.log(bad ? `\n有 ${bad} 項失敗` : "\n全部通過");
process.exit(bad ? 1 : 0);
