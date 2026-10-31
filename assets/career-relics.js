// 職業養成對決 · 遺物(攤位小物)
//
// 遺物是「這場活動」撿到的護符:從關主首通、貴人相助、夜市抽獎機拿到,最多同時裝 3 個。
// 跟裝備不同:每場活動重來、不跨活動(資料存在 career_progress.relics,跟著活動走),
// 也不能買賣、不能合成。命名一律用夜市會有的東西,不要像裝備(見世界觀文件第 7 節)。
//
// 資料形狀(career_progress.relics,jsonb):
//   { owned: ["old_number_tag", ...], equipped: ["old_number_tag", ...] }
//
// 效果欄位(effect.key)。前 6 個直接沿用戰鬥引擎已有的欄位(跟傳說裝備同一條管道),
// 後 3 個是遺物新增的引擎效果(career-engine.js 的 firstStrike / manaOnCrit / relicCounter):
//   critBonus        暴擊率直接加(0.05 = +5%)
//   critDmgBonus     暴擊傷害倍率加(基礎 ×1.5,加 0.25 變 ×1.75)
//   lifestealOnHit   每次命中按傷害比例回血
//   dmgReduceRatio   被打時固定減傷比例
//   manaRegenBonus   每回合結束多回幾點魔力
//   ultCostReduce    大招少花幾點魔力(最低仍留 1 點,見引擎 ultCost)
//   firstStrike      第一回合必定先手
//   manaOnCrit       自己暴擊時回幾點魔力
//   counter          被普通攻擊命中時,有這個機率反擊,反彈 35% 傷害(任何職業都能用;守衛本來的反擊姿態另外擲、反彈全部)
//
// 想新增遺物:在 RELICS 加一筆就好(key 不能重複、不要改舊 key,不然玩家已經撿到的會對不上)。
// 所有數字都【待模擬確認】,平衡看 tools/relics-test.js 與實機感受。
window.CareerRelics = (function () {
  const MAX_EQUIPPED = 3;

  // 關主首通掉遺物的機率(只有「第一次打贏」才算,重打不掉,避免刷)。
  const BOSS_DROP_CHANCE = 1.0;
  // 夜市抽獎機大獎區間(roll 0.9 ~ 0.9+這個值)拿到遺物,其餘大獎照舊掉裝備。
  const GACHA_RELIC_CHANCE = 0.05;

  const RELICS = [
    { key: "old_number_tag", icon: "ticket", name: "舊號碼牌",
      effect: { key: "firstStrike", value: 1 }, desc: "第一回合必定先手",
      flavor: "邊角被磨圓了,背面寫著「第 0 號」。" },
    { key: "undying_bulb", icon: "lightbulb", name: "不滅的燈泡",
      effect: { key: "manaOnCrit", value: 3 }, desc: "暴擊時回復 3 點魔力",
      flavor: "沒接電,但是一直亮著。" },
    { key: "half_chopstick", icon: "utensils", name: "半截筷子",
      effect: { key: "counter", value: 0.12 }, desc: "被普通攻擊命中時,12% 機率反彈 35% 的傷害",
      flavor: "另一半不知道夾過什麼。" },
    { key: "grease_apron", icon: "shirt", name: "油漬圍裙",
      effect: { key: "dmgReduceRatio", value: 0.06 }, desc: "受到的傷害 -6%",
      flavor: "洗不掉的油漬,擋刀特別好用。" },
    { key: "bamboo_skewer", icon: "pencil-line", name: "竹籤串",
      effect: { key: "critBonus", value: 0.06 }, desc: "暴擊率 +6%",
      flavor: "戳得準的人,串什麼都漂亮。" },
    { key: "red_envelope", icon: "mail", name: "皺掉的紅包",
      effect: { key: "critDmgBonus", value: 0.25 }, desc: "暴擊傷害 +25%",
      flavor: "裡面沒有錢,但打開的時候你特別有力氣。" },
    { key: "cracked_fan", icon: "wind", name: "破掉的紙扇",
      effect: { key: "manaRegenBonus", value: 1 }, desc: "每回合多回復 1 點魔力",
      flavor: "搧一下就涼,搧兩下就想再搧。" },
    { key: "thermos", icon: "cup-soda", name: "保溫杯",
      effect: { key: "lifestealOnHit", value: 0.06 }, desc: "每次命中回復傷害的 6% HP",
      flavor: "老闆娘說:「喝完再打。」" },
    { key: "coupon", icon: "scissors", name: "折角的折價券",
      effect: { key: "ultCostReduce", value: 1 }, desc: "大招少花 1 點魔力",
      flavor: "寫著「限當日使用」,日期被撕掉了。" },
  ];
  const BY_KEY = {};
  RELICS.forEach((r) => (BY_KEY[r.key] = r));

  function get(key) {
    return BY_KEY[key] || null;
  }

  // 把資料庫讀出來的值整理成乾淨的 { owned, equipped }:
  // 沒有欄位(舊活動/還沒跑 SQL)、壞資料、已經下架的遺物 key 都安全處理,不會讓爬塔壞掉。
  function normalize(raw) {
    const owned = [];
    const equipped = [];
    const src = raw && typeof raw === "object" ? raw : {};
    (Array.isArray(src.owned) ? src.owned : []).forEach((k) => {
      if (BY_KEY[k] && !owned.includes(k)) owned.push(k);
    });
    (Array.isArray(src.equipped) ? src.equipped : []).forEach((k) => {
      if (owned.includes(k) && !equipped.includes(k) && equipped.length < MAX_EQUIPPED) equipped.push(k);
    });
    return { owned, equipped };
  }

  // 這份資料有沒有「欄位」:undefined = 資料庫還沒有 relics 欄位(沒跑 SQL),這時不發遺物也不顯示,
  // 跟任務欄位缺少時的處理一樣,不能讓整個爬塔壞掉。
  function supported(raw) {
    return raw !== undefined;
  }

  function has(raw, key) {
    return normalize(raw).owned.includes(key);
  }

  // 拿到一個遺物:回傳新的資料。已經有就原樣回傳(不重複)。有空位時自動裝上去,
  // 這樣玩家撿到第一個就立刻有效果,不用特別去點裝備;滿 3 個之後要自己換。
  function add(raw, key) {
    const cur = normalize(raw);
    if (!BY_KEY[key] || cur.owned.includes(key)) return cur;
    const owned = [...cur.owned, key];
    const equipped = cur.equipped.length < MAX_EQUIPPED ? [...cur.equipped, key] : cur.equipped;
    return { owned, equipped };
  }

  // 裝備:一定要是已經擁有的,而且最多 3 個。回傳 { ok, relics, reason }。
  function equip(raw, key) {
    const cur = normalize(raw);
    if (!cur.owned.includes(key)) return { ok: false, relics: cur, reason: "你還沒拿到這個遺物" };
    if (cur.equipped.includes(key)) return { ok: true, relics: cur };
    if (cur.equipped.length >= MAX_EQUIPPED) return { ok: false, relics: cur, reason: `最多同時裝 ${MAX_EQUIPPED} 個遺物,請先卸下一個` };
    return { ok: true, relics: { owned: cur.owned, equipped: [...cur.equipped, key] } };
  }

  function unequip(raw, key) {
    const cur = normalize(raw);
    return { owned: cur.owned, equipped: cur.equipped.filter((k) => k !== key) };
  }

  // 還沒拿過的遺物裡隨機抽一個(rng 可以傳進來,方便測試);全拿過了回傳 null。
  function pickDrop(raw, rng) {
    const cur = normalize(raw);
    const left = RELICS.filter((r) => !cur.owned.includes(r.key));
    if (!left.length) return null;
    const r = (rng || Math.random)();
    return left[Math.min(left.length - 1, Math.floor(r * left.length))];
  }

  // 已裝備遺物的效果加總,形狀跟引擎需要的欄位一一對應(同一種效果疊加)。
  function effectBonus(raw) {
    const bonus = { critBonus: 0, critDmgBonus: 0, lifestealOnHit: 0, dmgReduceRatio: 0, manaRegenBonus: 0, ultCostReduce: 0, firstStrike: 0, manaOnCrit: 0, counter: 0 };
    normalize(raw).equipped.forEach((k) => {
      const e = BY_KEY[k].effect;
      if (bonus[e.key] != null) bonus[e.key] += e.value;
    });
    // 減傷是連乘上限的保險:三個都是減傷也不會超過 18%(目前只有一個減傷遺物,留著給之後新增)
    bonus.dmgReduceRatio = Math.min(bonus.dmgReduceRatio, 0.18);
    return bonus;
  }

  return { MAX_EQUIPPED, BOSS_DROP_CHANCE, GACHA_RELIC_CHANCE, RELICS, get, normalize, supported, has, add, equip, unequip, pickDrop, effectBonus };
})();
