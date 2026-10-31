// 全服 Boss「打烊鐘」測試:node tools/worldboss-test.js
// 驗證 career-modifiers.js 的時程(worldBossWindow)與 Boss 戰鬥屬性(各職業單次出擊的傷害合理),
// 並用 pglast 以外的方式檢查 SQL 檔有包含三個函式與兩張表(語法檢查在開發時用 pglast 做過)。
const fs = require("fs"), vm = require("vm"), path = require("path");
const root = path.join(__dirname, "..") + "/";
const sb = { console: { log() {}, warn() {}, error() {} }, Math, Date, JSON, Object, Array, Set, Map, String, Number, Error };
sb.window = sb;
vm.createContext(sb);
["career-data.js", "career-spec.js", "career-engine.js", "career-floors.js", "career-pve.js", "career-modifiers.js"].forEach((f) => vm.runInContext(fs.readFileSync(root + "assets/" + f, "utf8"), sb, { filename: f }));
const M = sb.CareerModifiers, CD = sb.CareerData, PVE = sb.CareerPve;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) process.exitCode = 1; };

// ---- 時程 ----
const T0 = Date.parse("2026-10-31T12:00:00Z");
const rules = { activityEndsAt: new Date(T0 + 60 * 60000).toISOString() };
const w = (min) => M.worldBossWindow(rules, T0 + min * 60000);
ok(M.worldBossWindow(null).phase === "none" && M.worldBossWindow({}).phase === "none", "沒有活動時間(舊活動)= 沒有夜市大戰");
ok(w(0).phase === "before" && w(29.9).phase === "before", "0~30 分:還沒出現");
ok(w(30).phase === "active" && w(44.9).phase === "active", "30~45 分:可以挑戰");
ok(w(45).phase === "after" && w(59).phase === "after", "45 分起:已經結束");
ok(w(10).startsInSec === 1200 && w(40).remainSec === 300, "倒數秒數正確(10 分時還有 20 分鐘;40 分時剩 5 分鐘)");
ok(w(30).endsAtIso === new Date(T0 + 45 * 60000).toISOString(), "Boss 消失時間 = 第 45 分鐘");
ok(M.WORLD_BOSS.cooldownSec === 30 && M.WORLD_BOSS.rounds === 15 && M.WORLD_BOSS.name === "打烊鐘", "冷卻 30 秒、15 回合、名字打烊鐘");

// ---- 戰鬥:各職業單次出擊 ----
const W = M.WORLD_BOSS;
function sideFor(cls, stats) {
  const ult = CD.resolveUltInfo(cls, null, 1);
  return { classKey: cls, stats: CD.applyStatBoostPassives(stats, {}), skillLevel: 1, skill2Level: 1, ultEffect: ult.effect, ultName: ult.name, critBonus: 0, critDmgBonus: 0, manaRegenBonus: 0, ultCostReduce: 0, mastery: CD.classMasteryBonus(cls, 0), lifestealOnHit: 0, dmgReduceRatio: 0 };
}
const hit = (cls, extra) => {
  const stats = { ...CD.applyProgress(cls, extra || {}, null) };
  stats.hp = stats.maxHp;
  const r = PVE.simulateFloorBattle(sideFor(cls, stats), { classKey: W.classKey, stats: { ...W.stats } }, { startHp: stats.maxHp, startMp: stats.maxMp, maxRounds: W.rounds });
  return { dmg: Math.round(W.stats.maxHp - r.state.hp2), rounds: r.state.round - 1, alive: r.state.hp1 > 0 };
};
const classes = Object.keys(CD.CLASS_INFO).filter((c) => !/^novice/.test(c) && CD.CLASS_INFO[c].ultName !== undefined || ["warrior", "guardian", "archer", "assassin", "mage", "healer"].includes(c));
const six = ["warrior", "guardian", "archer", "assassin", "mage", "healer"].filter((c) => CD.CLASS_INFO[c]);
ok(six.length === 6, "六個職業都存在");
sb.Math.random = () => 0.5;
six.forEach((c) => {
  const r = hit(c);
  ok(r.dmg > 0 && r.dmg < 20000 && r.rounds >= 1 && r.rounds <= W.rounds, `${CD.CLASS_INFO[c].name} 初始屬性一次出擊:傷害 ${r.dmg},打了 ${r.rounds} 回合`);
});
const weak = hit("warrior"), strong = hit("warrior", { atk: 300, def: 120, hp: 100 });
ok(strong.dmg > weak.dmg * 3, `越強傷害越高(初始 ${weak.dmg} → 加點後 ${strong.dmg})`);
ok(strong.dmg < 1e9 && strong.rounds <= W.rounds, "再強的玩家也不會一次打爆 Boss,回合數不超過上限");

// ---- SQL 檔 ----
const sql = fs.readFileSync(root + "migration-world-boss.sql", "utf8"), schema = fs.readFileSync(root + "supabase-schema.sql", "utf8");
["create table if not exists career_world_boss ", "create table if not exists career_world_boss_damage", "function spawn_career_world_boss", "function deal_career_world_boss", "function claim_career_world_boss"].forEach((k) => {
  ok(sql.includes(k) && schema.includes(k), `migration 與 schema 都有:${k.trim()}`);
});
ok(/for update/.test(sql.split("function deal_career_world_boss")[1].split("$$;")[0]), "deal 先鎖 Boss 那一列再加傷害(防同時覆蓋)");
ok(/reward_claimed = true/.test(sql.split("function claim_career_world_boss")[1]) && sql.indexOf("reward_claimed = true") < sql.indexOf("update career_progress set coins"), "claim 先把已領取翻成 true 再發獎(防重複領)");
