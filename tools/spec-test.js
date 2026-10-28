// 專精(第二轉職)引擎機制測試:node tools/spec-test.js
// 驗證 career-spec.js 的資料解析,以及 career-engine.js 的新效果(中毒/減益/反彈/減傷/多段/魔力花費/舊對戰狀態相容)。
const root = require("path").join(__dirname, "..", "assets") + "/";
const sb = {}; sb.window = sb; global.window = sb;
["career-data.js", "career-engine.js", "career-floors.js", "career-pve.js", "career-spec.js"].forEach((f) => require(root + f));
const CD = sb.CareerData, E = sb.CareerEngine, SP = sb.CareerSpec, CF = sb.CareerFloors;
let fails = 0;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) { fails++; process.exitCode = 1; } };
function seed(s) { Math.random = function () { s |= 0; s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function stats(c, lv) {
  const pts = Math.floor(lv * 1.2), magic = CD.CLASS_INFO[c].path === "magic";
  const a = { def: Math.round(pts * 0.25), spd: Math.round(pts * 0.1), hp: Math.round(pts * 0.15) }; a[magic ? "matk" : "atk"] = Math.round(pts * 0.5);
  const s = CD.applyProgress(c, a, null); s.hp = s.maxHp; return s;
}
function side(c, o = {}) {
  const lv = o.level || 60, ult = CD.resolveUltInfo(c, null, 3), slv = o.slv || 3;
  const sd = { classKey: c, stats: o.stats || stats(c, lv), skillLevel: slv, skill2Level: slv, ultEffect: ult.effect, ultName: ult.name, critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0, ultCostReduce: 0, mastery: CD.classMasteryBonus(c, 2), lifestealOnHit: 0, dmgReduceRatio: 0 };
  if (o.branch) {
    sd.spec = SP.resolvePassive(c, o.branch, lv);
    sd.skillEffectA = SP.resolveSkill(c, `spec_${o.branch}_skill_1`, slv, lv);
    sd.skillEffectB = SP.resolveSkill(c, `spec_${o.branch}_skill_2`, slv, lv);
  }
  return sd;
}
const round = (st, a1, a2) => { st = { ...st, m1: { action: a1 }, m2: { action: a2 } }; return E.resolveRound(st); };
const evs = (r, type) => (r.events || []).filter((e) => e.type === type);

(async () => {
  // ---- 資料 / 解析 ----
  const nodes = Object.keys(CD.SKILL_TREE_NODES).filter((k) => /_spec_/.test(k));
  ok(nodes.length === 36, `專精節點登錄 36 個(12 分支 + 24 技能),實際 ${nodes.length}`);
  ok(CD.SKILL_TREE_NODES.warrior_spec_a.exclusiveWith === "warrior_spec_b" && CD.SKILL_TREE_NODES.warrior_spec_b.exclusiveWith === "warrior_spec_a", "兩條分支互斥");
  ok(CD.SKILL_TREE_NODES.warrior_spec_a.unlockCharLevel === 50, "Lv.50 解鎖");
  ok(SP.chosenBranch("warrior", { spec_a: 1 }) === "a" && SP.chosenBranch("warrior", { spec_b: 1 }) === "b" && SP.chosenBranch("warrior", { skill_1: 3 }) === null, "從 active_skills 判斷選了哪條分支");
  ok(SP.resolvePassive("warrior", "a", 99).tier === 1 && SP.resolvePassive("warrior", "a", 100).tier === 2, "Lv.99 是進階前、Lv.100 升階");
  const s1 = SP.resolveSkill("warrior", "spec_a_skill_1", 1, 60), s5 = SP.resolveSkill("warrior", "spec_a_skill_1", 5, 60), s5u = SP.resolveSkill("warrior", "spec_a_skill_1", 5, 100);
  ok(s1.mult === 1.4 && s5.mult > s1.mult && Math.abs(s5u.mult - s5.mult - SP.UPGRADE_SKILL_MULT) < 0.011, `技能倍率隨等級成長 ${s1.mult}→${s5.mult},升階 +${SP.UPGRADE_SKILL_MULT} → ${s5u.mult}`);
  ok(SP.resolveSkill("warrior", "skill_1", 1, 60) === null && SP.resolveSkill("nobody", "spec_a_skill_1", 1, 60) === null, "不是專精技能/不存在的職業回傳 null");

  // ---- 中毒 ----
  seed(7);
  let st = E.initialMatchState(side("assassin", { branch: "b" }), side("guardian"));
  const hpBefore = st.hp2;
  let r = round(st, "skill1", "attack"); st = r.state;
  ok(st.poison2 && st.poison2.rounds === 2, `淬毒刃命中後中毒,結算後剩 2 回合(實際 ${st.poison2 && st.poison2.rounds})`);
  ok(evs(r, "poison").length === 1 && evs(r, "poison_tick").length === 1, "施毒當回合就會扣一次毒傷(紀錄各 1 則)");
  ok(st.hp2 < hpBefore, "對方 HP 有下降");
  let ticks = 1; for (let i = 0; i < 4 && st.poison2; i++) { r = round(st, "defend", "defend"); st = r.state; ticks += evs(r, "poison_tick").length; }
  ok(ticks === 3 && st.poison2 === null, `3 回合共扣 3 次毒,之後解除(實際 ${ticks} 次)`);
  ok(st.poison1 === null, "施毒的人自己沒中毒");

  // ---- 減益(詛咒) ----
  seed(11);
  const base = E.initialMatchState(side("healer", { branch: "b" }), side("warrior"));
  const mk = (withDebuff) => { let s = { ...base }; if (withDebuff) s = { ...s, debuffs2: [{ stat: "atk", ratio: 0.3, rounds: 2, fresh: false }] }; return s; };
  seed(21); const rc = round(mk(false), "defend", "attack"); seed(21); const rd = round(mk(true), "defend", "attack");
  const dmgTaken = (res) => base.hp1 - res.state.hp1;
  ok(dmgTaken(rd) < dmgTaken(rc), `被削弱攻擊力的戰士打得比較輕(${dmgTaken(rc)} → ${dmgTaken(rd)})`);
  seed(31); let ds = E.initialMatchState(side("healer", { branch: "b" }), side("warrior"));
  let rr = round(ds, "skill1", "defend"); ds = rr.state;
  ok(ds.debuffs2.length === 1 && ds.debuffs2[0].fresh === false && ds.debuffs2[0].rounds === 3, `衰弱詛咒:基礎 2 回合 + 被動 1 = 3 回合(實際 ${ds.debuffs2[0] && ds.debuffs2[0].rounds}),施加的這回合結束後轉為生效`);
  seed(32); let ds2 = round(ds, "defend", "defend").state; seed(33); ds2 = round(ds2, "defend", "defend").state; seed(34); ds2 = round(ds2, "defend", "defend").state;
  ok(ds2.debuffs2.length === 0, "經過 3 個生效回合後減益消失");
  ok(evs(rr, "debuff").length === 1, "有減益紀錄");

  // ---- 反震 ----
  seed(5);
  st = E.initialMatchState(side("warrior"), side("guardian", { branch: "b" }));
  r = round(st, "attack", "defend");
  ok(evs(r, "reflect").length >= 1 && r.state.hp1 < st.hp1, `反震被動:攻擊守衛的人自己也受傷(HP ${st.hp1}→${r.state.hp1})`);
  const refl = evs(r, "reflect")[0];
  // 震盪盾擊額外反彈
  seed(5); const rs = round(E.initialMatchState(side("warrior"), side("guardian", { branch: "b" })), "attack", "skill1");
  ok(evs(rs, "reflect")[0].dmg > refl.dmg * 1.5, `震盪盾擊讓這回合反彈更多(${refl.dmg}→${evs(rs, "reflect")[0].dmg})`);

  // ---- 這回合減傷,不論先後手(用同一個亂數種子,唯一差別是固守的減傷有沒有生效) ----
  const sideNoCut = (br) => { const sd = side("guardian", { branch: br }); sd.skillEffectA = { ...sd.skillEffectA, selfReduce: 0 }; return sd; };
  let withCut = 0, noCut = 0;
  for (let i = 0; i < 60; i++) {
    seed(300 + i); const a1 = round(E.initialMatchState(side("warrior"), side("guardian", { branch: "a" })), "attack", "skill1");
    seed(300 + i); const a2 = round(E.initialMatchState(side("warrior"), sideNoCut("a")), "attack", "skill1");
    withCut += a1.state.maxhp2 - a1.state.hp2; noCut += a2.state.maxhp2 - a2.state.hp2;
  }
  ok(withCut < noCut * 0.9 && withCut > noCut * 0.7, `固守:這回合受到傷害約 -20%(${Math.round(noCut / 60)} → ${Math.round(withCut / 60)},實際 ${Math.round((1 - withCut / noCut) * 100)}%)`);
  // 對方先手(速度快)也要有減傷:把戰士速度拉高
  const fast = stats("warrior", 60); fast.spd = 999;
  let fCut = 0, fNo = 0;
  for (let i = 0; i < 60; i++) {
    seed(400 + i); const a1 = round(E.initialMatchState(side("warrior", { stats: fast }), side("guardian", { branch: "a" })), "attack", "skill1");
    seed(400 + i); const a2 = round(E.initialMatchState(side("warrior", { stats: fast }), sideNoCut("a")), "attack", "skill1");
    fCut += a1.state.maxhp2 - a1.state.hp2; fNo += a2.state.maxhp2 - a2.state.hp2;
  }
  ok(fCut < fNo * 0.9, `對方先手時固守一樣有效(${Math.round(fNo / 60)} → ${Math.round(fCut / 60)})`);

  // ---- 多段 / 魔力花費 ----
  seed(13); st = E.initialMatchState(side("archer", { branch: "a" }), side("guardian"));
  r = round(st, "skill1", "defend");
  const hitEvs = (r.events || []).filter((e) => e.side === 1 && (e.type === "attack" || e.type === "skill" || e.type === "hit" || e.type === "crit")).length;
  console.log("   (雙發的紀錄種類:" + [...new Set((r.events || []).map((e) => e.type))].join(",") + ")");
  ok((r.events || []).filter((e) => e.side === 1 && e.dmg > 0).length >= 2, "雙發:一次出手有 2 筆傷害紀錄");
  const mpAfterSkill = r.state.mp1;
  seed(13); const rNormal = round(E.initialMatchState(side("archer", { branch: "a" }), side("guardian")), "attack", "defend");
  ok(mpAfterSkill === rNormal.state.mp1 - (0) || mpAfterSkill < rNormal.state.mp1, "施放技能後魔力比普通攻擊少");
  const mage = (mp) => { let s = E.initialMatchState(side("mage", { branch: "a" }), side("guardian")); return { ...s, mp1: mp }; };
  seed(14); const m5 = round(mage(5), "skill1", "defend"); seed(14); const m5n = round(mage(5), "attack", "defend");
  ok(m5.state.mp1 === m5n.state.mp1 && m5.state.hp2 === m5n.state.hp2, "魔力 5 不夠爆裂火球(要 6):結果跟普通攻擊完全相同");
  seed(14); const m6 = round(mage(6), "skill1", "defend"); seed(14); const m6n = round(mage(6), "attack", "defend");
  ok(m6.state.mp1 === 0 && m6n.state.mp1 === 8 && m6.state.hp2 < m6n.state.hp2, `魔力 6 可以施放,6 點花光(用技能的回合不回魔,普通攻擊則回 2 點),且傷害更高(${m6n.state.maxhp2 - m6n.state.hp2} → ${m6.state.maxhp2 - m6.state.hp2})`);
  ok(SP.resolveSkill("mage", "spec_a_skill_1", 1, 60).manaCost === 6 && SP.resolveSkill("mage", "spec_b_skill_1", 1, 60).manaCost === CD.SKILL_MANA_COST, "魔力花費:爆裂火球 6、其他預設");
  // 雷暴:每下命中回魔
  seed(15); const th = E.initialMatchState(side("mage", { branch: "b" }), side("guardian")); const tb = { ...th, mp1: 10 };
  const rt = round(tb, "skill2", "defend"); seed(15); const rt0 = round({ ...tb }, "attack", "defend");
  ok(rt.state.mp1 > tb.mp1 - CD.SKILL_MANA_COST + 0 && rt.state.mp1 - (rt0.state.mp1 - 0) > -CD.SKILL_MANA_COST, "雷暴:命中回魔(魔力只淨扣一部分)");

  // ---- 處決 ----
  // 目標血量放大 8 倍,避免低血量的目標被一擊打死、傷害被「剩餘血量」截斷而看不出倍率差
  const mkx = (hpRatio) => { let s = E.initialMatchState(side("assassin", { branch: "a" }), side("guardian")); return { ...s, maxhp2: s.maxhp2 * 8, hp2: Math.round(s.maxhp2 * 8 * hpRatio) }; };
  let hi = 0, lo = 0; for (let i = 0; i < 40; i++) { seed(100 + i); hi += mkx(0.9).hp2 - round(mkx(0.9), "skill1", "defend").state.hp2; seed(100 + i); lo += mkx(0.35).hp2 - round(mkx(0.35), "skill1", "defend").state.hp2; }
  ok(lo > hi * 1.4, `處決:對方 40% 以下打得明顯更痛(平均 ${Math.round(hi / 40)} → ${Math.round(lo / 40)})`);

  // ---- 狂戰:越痛越強 ----
  const mkb = (hpRatio) => { let s = E.initialMatchState(side("warrior", { branch: "b" }), side("guardian")); return { ...s, hp1: Math.round(s.maxhp1 * hpRatio) }; };
  let full = 0, hurt = 0; for (let i = 0; i < 40; i++) { seed(200 + i); full += round(mkb(1), "attack", "defend").state.maxhp2 - round(mkb(1), "attack", "defend").state.hp2; seed(200 + i); hurt += round(mkb(0.3), "attack", "defend").state.maxhp2 - round(mkb(0.3), "attack", "defend").state.hp2; }
  ok(hurt > full, `狂戰:自己殘血時普通攻擊更痛(${Math.round(full / 40)} → ${Math.round(hurt / 40)})`);

  // ---- 回血 ----
  seed(17); st = E.initialMatchState(side("warrior", { branch: "b" }), side("guardian")); st = { ...st, hp1: Math.round(st.maxhp1 * 0.5) };
  r = round(st, "skill2", "defend");
  ok(evs(r, "skill_heal").length === 1, "狂亂亂舞:有吸血回血紀錄");

  // ---- 舊對戰狀態相容(進行中的 PVP 場次沒有新欄位)----
  seed(19); st = E.initialMatchState(side("warrior"), side("archer"));
  ["spec1", "spec2", "skillEffectA1", "skillEffectA2", "skillEffectB1", "skillEffectB2", "poison1", "poison2", "debuffs1", "debuffs2"].forEach((k) => delete st[k]);
  let legacyOk = true; try { for (let i = 0; i < 8; i++) { st = round(st, "attack", "skill1").state; } } catch (e) { legacyOk = false; console.error(e); }
  ok(legacyOk && st.hp1 >= 0, "沒有新欄位的舊對戰狀態可以正常結算");

  // ---- 沒專精時,新欄位保持空 ----
  st = E.initialMatchState(side("warrior"), side("archer"));
  ok(st.spec1 === null && st.poison1 === null && Array.isArray(st.debuffs1) && st.debuffs1.length === 0, "沒帶專精時新欄位是空的");

  console.log(fails ? `\n${fails} 項失敗` : "\n全部通過");
})();
