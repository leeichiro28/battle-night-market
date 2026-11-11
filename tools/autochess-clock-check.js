// 與 migration-autochess.sql 的 autochess_clock 同一套推算(prep 90 / battle 25 / result 5,每輪 120 秒)
function clock(run, nowSec) {
  const started = run.startedAt, paused = run.pausedAt;
  let elapsed = (paused != null ? paused : nowSec) - started - (run.pausedTotal || 0);
  const battle = run.battleSec ?? 25, res = run.resultSec ?? 5, arr = run.prepSec || [90], n = arr.length;
  if (elapsed < 0) return { phase: "countdown", round: 0, left: Math.ceil(-elapsed) };
  let r = 0, t = elapsed, prep = 0, len = 0;
  for (;;) { r++; prep = (arr[Math.min(r, n) - 1] ?? 90) + ((run.extra || {})[r] || 0); len = prep + battle + res; if (t < len || r >= 300) break; t -= len; }
  const phase = t < prep ? "prep" : t < prep + battle ? "battle" : "result";
  const left = phase === "prep" ? prep - t : phase === "battle" ? prep + battle - t : len - t;
  return { phase, round: r, left: Math.ceil(left) };
}
const run = { startedAt: 1000, prepSec: [90], battleSec: 25, resultSec: 5, pausedTotal: 0, extra: {} };
const cases = [[990, "countdown", 0, 10], [1000, "prep", 1, 90], [1089, "prep", 1, 1], [1090, "battle", 1, 25], [1115, "result", 1, 5], [1120, "prep", 2, 90], [1000 + 120 * 21 + 95, "battle", 22, 20]];
let bad = 0;
for (const [now, ph, r, left] of cases) { const c = clock(run, now); const ok = c.phase === ph && c.round === r && c.left === left; if (!ok) bad++; console.log(ok ? "ok " : "BAD", now, JSON.stringify(c)); }
// 加時:第 2 輪準備 +30 → 第 3 輪晚 30 秒開始
const r2 = { ...run, extra: { 2: 30 } };
console.log("extend", JSON.stringify(clock(r2, 1000 + 120 + 100)), "(第 2 輪準備 120 秒,t=100 → 仍是 prep,剩 20)");
console.log("extend r3 start", JSON.stringify(clock(r2, 1000 + 120 + 150)));
// 暫停:在 t=50 暫停,15 秒後繼續(pausedTotal=15),繼續後 t=60 時應該是第 1 輪準備第 45 秒
const p = { ...run, pausedAt: 1050 }; console.log("paused", JSON.stringify(clock(p, 5000)));
const q = { ...run, pausedTotal: 15 }; console.log("resumed", JSON.stringify(clock(q, 1000 + 60 + 15)));
// 分段準備秒數 [[1,90],[4,90],[12,90]] 在資料表是同一個值;試試前短後長
const seg = { ...run, prepSec: [60, 60, 60, 90] }; console.log("seg r4", JSON.stringify(clock(seg, 1000 + 3 * 90)));
process.exit(bad ? 1 : 0);
