// 升級速度模擬(BUG md 28-1、29-3 驗證用)。執行:node tools/sim-exp.js
// 只驗證經驗曲線、首通/重複倍率與數值遞減，不跑戰鬥。
const need = (lv) => 20 + lv * 8; // 同 career-floors.js expToNextLevel
const gives = (lv) => lv <= 100 || (lv - 100) % 3 === 0;

function levelAfter(totalExp, diminish) {
  let lv = 1, exp = totalExp, stat = 0, skill = 0;
  while (exp >= need(lv)) {
    exp -= need(lv); lv++;
    if (!diminish || gives(lv)) { stat += 2; if (lv > 5) skill += 1; }
  }
  return { lv, stat, skill };
}

// 50 層一般怪經驗 38(BUG md 28-0);狂刷情境:3600 場連點
const REPEAT = 38, CLICKS = 3600;
const oldExp = REPEAT * CLICKS * 1;      // 舊:連點無倍率
const newExp = REPEAT * CLICKS * 0.5;    // 新:重複挑戰 ×0.5
console.log("連點 3600 場(50層一般怪,每場 38 經驗)");
console.log("  舊:總經驗", oldExp, "→", levelAfter(oldExp, false));
console.log("  新:總經驗", newExp, "→", levelAfter(newExp, true));

console.log("\n掛機一小時(240 場):");
console.log("  舊 ×0.7 =", Math.round(REPEAT * 0.7 * 240), "經驗;新 ×0.35 =", Math.round(REPEAT * 0.35 * 240), "經驗");

console.log("\nLv.100→170 的點數:");
const a = levelAfter(1e9, false); // 只為了取函式;改手算
let oldStat = 0, newStat = 0, oldSk = 0, newSk = 0;
for (let lv = 101; lv <= 170; lv++) { oldStat += 2; oldSk += 1; if (gives(lv)) { newStat += 2; newSk += 1; } }
console.log("  自由數值點 舊", oldStat, "新", newStat, "(文件預估約 46)");
console.log("  技能點     舊", oldSk, "新", newSk, "(文件預估約 23)");

console.log("\n累積經驗對照(文件 28-0):");
for (const L of [100, 139, 150, 160, 170]) {
  let sum = 0; for (let l = 1; l < L; l++) sum += need(l);
  console.log("  Lv." + L, sum);
}

console.log("\n首通加倍:1～70 層首通基礎經驗總和(8+0.6n 取整,不含關主倍率)≈",
  Math.round(Array.from({ length: 70 }, (_, i) => 8 + 0.6 * (i + 1)).reduce((x, y) => x + y, 0)));

// 以「實際回報的 Lv.139 玩家(累積 79,488 經驗)」為基準:同樣的連點量,新規則會到幾級?
console.log("\n同樣操作量(舊規則剛好 Lv.139 = 79,488 經驗),新規則減半後:", levelAfter(79488 * 0.5, true));
