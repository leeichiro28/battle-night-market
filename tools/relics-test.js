// 遺物測試:node tools/relics-test.js
// 驗證 career-relics.js(資料、裝備上限、掉落、效果加總)與 career-engine.js 的三個新效果
// (舊號碼牌先手 / 不滅的燈泡暴擊回魔 / 半截筷子反擊),以及「沒有遺物時跟以前完全一樣」。
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..") + "/";
const sb = { console: { log() {}, warn() {}, error() {} }, Math, Date, JSON, Object, Array, Set, Map, String, Number, Error };
sb.window = sb;
vm.createContext(sb);
["career-data.js", "career-spec.js", "career-engine.js", "career-relics.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + "assets/" + f, "utf8"), sb, { filename: f }));
const R = sb.CareerRelics, E = sb.CareerEngine, CD = sb.CareerData;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- 資料 ----
const keys = R.RELICS.map((r) => r.key);
ok(new Set(keys).size === keys.length, "遺物 key 不重複");
ok(R.RELICS.every((r) => r.name && r.desc && r.flavor && r.icon && r.effect && r.effect.key && r.effect.value > 0), "每個遺物都有名稱、說明、flavor、圖示、效果");
ok(R.get("old_number_tag").name === "舊號碼牌" && R.get("undying_bulb").name === "不滅的燈泡" && R.get("half_chopstick").name === "半截筷子", "文件範例的三個遺物都在");

// ---- normalize / 缺欄位 ----
ok(!R.supported(undefined) && R.supported({}) && R.supported({ owned: [], equipped: [] }), "沒有 relics 欄位(undefined)= 不支援,空物件 = 支援");
const bad = R.normalize({ owned: ["old_number_tag", "not_a_relic", "old_number_tag"], equipped: ["undying_bulb", "old_number_tag", "x"] });
ok(bad.owned.length === 1 && bad.equipped.length === 1 && bad.equipped[0] === "old_number_tag", "壞資料:未知 key、重複、沒擁有卻裝備都被濾掉");
ok(R.normalize(null).owned.length === 0 && R.normalize("abc").equipped.length === 0, "null / 字串不會壞");

// ---- 拿到 / 裝備上限 ----
let st = { owned: [], equipped: [] };
["old_number_tag", "undying_bulb", "half_chopstick", "grease_apron"].forEach((k) => (st = R.add(st, k)));
ok(st.owned.length === 4 && st.equipped.length === 3 && !st.equipped.includes("grease_apron"), "撿到的前 3 個自動裝上,第 4 個先放著");
ok(R.add(st, "old_number_tag").owned.length === 4, "重複撿到不會多一個");
ok(!R.equip(st, "grease_apron").ok, "滿 3 個再裝會被擋");
ok(R.equip(st, "bamboo_skewer").ok === false && R.equip(st, "bamboo_skewer").reason.includes("還沒拿到"), "沒擁有的不能裝");
const swapped = R.equip(R.unequip(st, "old_number_tag"), "grease_apron");
ok(swapped.ok && swapped.relics.equipped.length === 3 && swapped.relics.equipped.includes("grease_apron"), "卸下一個之後可以換裝");

// ---- 掉落 ----
let all = { owned: [], equipped: [] };
const seen = new Set();
for (let i = 0; i < keys.length; i++) { const d = R.pickDrop(all, () => 0); seen.add(d.key); all = R.add(all, d.key); }
ok(seen.size === keys.length && R.pickDrop(all) === null, "掉落只會抽沒拿過的,全拿完回傳 null");
ok(R.pickDrop({ owned: keys.slice(1), equipped: [] }, () => 0.999).key === keys[0], "只剩一個時一定是那個(rng 邊界不會越界)");

// ---- 效果加總 ----
const b = R.effectBonus({ owned: ["old_number_tag", "undying_bulb", "bamboo_skewer", "red_envelope"], equipped: ["undying_bulb", "bamboo_skewer", "red_envelope"] });
ok(b.manaOnCrit === 3 && b.critBonus === 0.06 && b.critDmgBonus === 0.25 && b.firstStrike === 0, "只算已裝備的效果(沒裝的舊號碼牌不算)");
ok(R.effectBonus(undefined).critBonus === 0 && R.effectBonus({}).counter === 0, "沒有遺物 = 全部 0");

// ---- 引擎 ----
function side(cls, extra) {
  const ult = CD.resolveUltInfo(cls, null, 1);
  const stats = CD.applyProgress(cls, {}, null);
  return { classKey: cls, stats: CD.applyStatBoostPassives(stats, {}), skillLevel: 0, skill2Level: 0, ultEffect: ult.effect, ultName: ult.name, critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0, ultCostReduce: 0, mastery: CD.classMasteryBonus(cls, 0), lifestealOnHit: 0, dmgReduceRatio: 0, ...(extra || {}) };
}
const realRandom = Math.random;
function withRandom(fn, r) { sb.Math = Object.create(Math); sb.Math.random = typeof r === "function" ? r : () => r; try { return fn(); } finally { sb.Math = Math; } }

// 舊號碼牌:自己比較慢也能第一回合先手
{
  const slow = side("warrior", { stats: { ...side("warrior").stats, spd: 1 }, firstStrike: true });
  const fast = side("warrior", { stats: { ...side("warrior").stats, spd: 99 } });
  const s0 = E.initialMatchState(slow, fast);
  const r = E.resolveRound({ ...s0, m1: { action: "attack" }, m2: { action: "attack" } });
  const firstAtk = r.events.find((e) => e.type === "attack");
  ok(r.events[0].type === "first_strike" && firstAtk.side === 1, "舊號碼牌:速度慢 99 點也第一回合先手");
  // 第二回合就沒有效果了
  const r2 = E.resolveRound({ ...r.state, m1: { action: "attack" }, m2: { action: "attack" } });
  ok(r2.events.find((e) => e.type === "attack").side === 2 && !r2.events.some((e) => e.type === "first_strike"), "第二回合起照速度,不再先手");
  // 雙方都有 = 跟沒有一樣(照速度)
  const both = E.initialMatchState(slow, { ...fast, firstStrike: true });
  const rb = E.resolveRound({ ...both, m1: { action: "attack" }, m2: { action: "attack" } });
  ok(rb.events.find((e) => e.type === "attack").side === 2 && !rb.events.some((e) => e.type === "first_strike"), "雙方都有舊號碼牌:照速度,不亂搶");
  // 沒有 = 跟以前一樣
  const none = E.initialMatchState(side("warrior", { stats: { ...side("warrior").stats, spd: 1 } }), fast);
  const rn = E.resolveRound({ ...none, m1: { action: "attack" }, m2: { action: "attack" } });
  ok(rn.events.find((e) => e.type === "attack").side === 2, "沒有遺物:速度快的先手(跟以前一樣)");
}

// 不滅的燈泡:暴擊回魔
{
  const mk = (extra) => E.initialMatchState(side("warrior", { critBonus: 5, ...extra }), side("guardian"), { mp1: 0, mp2: 0 });
  const run = (extra) => withRandom(() => E.resolveRound({ ...mk(extra), m1: { action: "attack" }, m2: { action: "attack" } }), 0.001);
  const withBulb = run({ manaOnCrit: 3 }), without = run({});
  ok(withBulb.events.some((e) => e.type === "attack" && e.side === 1 && e.crit), "測試前提:這一擊真的暴擊");
  ok(withBulb.state.mp1 === without.state.mp1 + 3, `暴擊回 3 魔(有燈泡 ${withBulb.state.mp1} vs 沒有 ${without.state.mp1})`);
  const noCrit = withRandom(() => E.resolveRound({ ...E.initialMatchState(side("warrior", { manaOnCrit: 3 }), side("guardian"), { mp1: 0, mp2: 0 }), m1: { action: "attack" }, m2: { action: "attack" } }), 0.999);
  ok(!noCrit.events.some((e) => e.side === 1 && e.crit) && noCrit.state.mp1 === without.state.mp1, "沒暴擊就不回魔");
}

// 半截筷子:非守衛也能反擊
{
  const mk = (extra) => E.initialMatchState(side("warrior"), side("warrior", extra));
  const run = (extra, r) => withRandom(() => E.resolveRound({ ...mk(extra), m1: { action: "attack" }, m2: { action: "attack" } }), r);
  const hit = run({ relicCounter: 0.2 }, 0.1); // 0.1 < 0.2:反擊
  ok(hit.events.some((e) => e.type === "counter" && e.side === 2), "半截筷子:被普攻命中、擲骰在機率內 → 反擊");
  const hitDmg = hit.events.find((e) => e.type === "attack" && e.side === 1).dmg, cDmg = hit.events.find((e) => e.type === "counter").dmg;
  ok(cDmg === Math.max(1, Math.round(hitDmg * 0.35)), `遺物反擊只反彈 35% 傷害(被打 ${hitDmg} → 反彈 ${cDmg}),不像守衛反彈全部`);
  ok(!run({ relicCounter: 0.2 }, 0.5).events.some((e) => e.type === "counter"), "擲骰在機率外 → 不反擊");
  ok(!run({}, 0.1).events.some((e) => e.type === "counter"), "沒有遺物的戰士不會反擊(跟以前一樣)");
  const g = withRandom(() => E.resolveRound({ ...E.initialMatchState(side("warrior"), side("guardian")), m1: { action: "attack" }, m2: { action: "attack" } }), 0.01);
  ok(g.events.some((e) => e.type === "counter" && /反擊姿態/.test(e.text)), "守衛原本的反擊姿態文字不變");
}

// 整場:有遺物的人不會變得無敵(三個遺物全裝的戰士打同級戰士,勝率有優勢但不是碾壓)
{
  function duel(extraA, n) {
    let win = 0;
    for (let i = 0; i < n; i++) {
      let s = E.initialMatchState(side("warrior", extraA), side("warrior"));
      for (let r = 0; r < 60 && s.hp1 > 0 && s.hp2 > 0; r++) s = E.resolveRound({ ...s, m1: { action: "attack" }, m2: { action: "attack" } }).state;
      if (s.hp1 > 0 && s.hp2 <= 0) win++; else if (s.hp1 > 0 && s.hp2 > 0 && s.hp1 > s.hp2) win++;
    }
    return win / n;
  }
  const rate0 = duel({}, 400);
  const b3 = R.effectBonus({ owned: ["old_number_tag", "undying_bulb", "half_chopstick"], equipped: ["old_number_tag", "undying_bulb", "half_chopstick"] });
  const rate3 = duel({ firstStrike: true, manaOnCrit: b3.manaOnCrit, relicCounter: b3.counter }, 400);
  const bd = R.effectBonus({ owned: ["bamboo_skewer", "red_envelope", "grease_apron"], equipped: ["bamboo_skewer", "red_envelope", "grease_apron"] });
  const rateD = duel({ critBonus: bd.critBonus, critDmgBonus: bd.critDmgBonus, dmgReduceRatio: bd.dmgReduceRatio }, 400);
  console.log(`     同級戰士鏡像:沒遺物 ${(rate0 * 100).toFixed(0)}%、先手+燈泡+筷子 ${(rate3 * 100).toFixed(0)}%、竹籤+紅包+圍裙 ${(rateD * 100).toFixed(0)}%`);
  ok(rate0 > 0.4 && rate0 < 0.6, "鏡像對戰沒遺物約五五開(驗證測試方法)");
  ok(rate3 < 0.8 && rateD < 0.8, "三個遺物全裝也不會碾壓(勝率 < 80%)");
}
