// 夜市自走棋 · 電腦玩家 AI(模擬器與單機試玩頁共用)
//
// 簡單貪心:買分數最高的卡(湊對子、專攻流派加分)、依固定節奏升級、錢夠就刷新,最後把最強的卡排上陣。
// 只用 AutochessData / AutochessEngine,不碰 DOM;任何隨機都走引擎的種子亂數,所以同樣種子結果固定。
window.AutochessBot = (function () {
  const AD = window.AutochessData, E = window.AutochessEngine;

const LEVEL_TARGET = [1, 1, 2, 3, 4, 4, 5, 5, 6, 6, 7, 7, 7, 8, 8, 8, 9, 9, 9, 10]; // 索引=輪次-1
const targetLevel = (round) => LEVEL_TARGET[Math.min(round, LEVEL_TARGET.length) - 1];
const cardOf = (c) => AD.CARD_BY_ID[c.id];
const power = (c) => { const d = cardOf(c); return (d.atk * 3 + d.hp) * AD.STAR.stat[c.star]; };

function newPlayer(id, strat) {
  return { id, strat, hp: AD.START_HP, gold: AD.START_GOLD, level: 1, xp: 0, streak: 0, wins: 0, losses: 0, board: [], bench: [], alive: true, elimRound: 0, overflow: 0, battles: [], goldHist: [], idleRounds: 0 };
}
function countOwned(p, id, star) { return p.board.concat(p.bench).filter((c) => c.id === id && c.star === star).length; }

// 把持有的卡排成上陣陣容:挑戰力最高的 slots 張(專攻流派加分);前排放血厚的,壓軸放有壓軸效果的
function arrange(p) {
  const all = p.board.concat(p.bench), slots = AD.slotsFor(p.level);
  const focus = p.strat.focus;
  const score = (c) => {
    const d = cardOf(c);
    let s = power(c) + (focus && d.tags.includes(focus) ? 8 : 0) + d.cost * 1.5;
    return s;
  };
  // 先挑出「不同名優先」讓羈絆有機會成立:依分數排序後,同名重複的往後放
  const sorted = all.slice().sort((x, y) => score(y) - score(x));
  const picked = [], rest = [], seen = {};
  sorted.forEach((c) => { if (picked.length < slots && !seen[c.id]) { picked.push(c); seen[c.id] = 1; } else rest.push(c); });
  while (picked.length < slots && rest.length) picked.push(rest.shift());
  const hasFinale = (c) => (cardOf(c).fx.concat([]).some((e) => e.when === "finale")) ;
  const finale = picked.filter(hasFinale), others = picked.filter((c) => !hasFinale(c)).sort((x, y) => cardOf(y).hp * AD.STAR.stat[y.star] - cardOf(x).hp * AD.STAR.stat[x.star]);
  p.board = others.concat(finale.slice(0, 1)).concat(finale.slice(1));
  p.bench = rest;
}

function playPrep(p, round, evSeed) {
  if (round > 1) { const r = AD.addXp(p.level, p.xp, AD.PASSIVE_XP); p.level = r.level; p.xp = r.xp; }
  const s = p.strat;
  const panic = s.panicHp && p.hp < s.panicHp;
  const reserve = panic ? 0 : s.reserve || 0;
  let refresh = 0;
  const base = `${evSeed}|${p.id}`;
  let shop = E.rollShop(base, round, refresh, p.level);
  let guard = 0;
  const maxRefresh = s.reserve ? 6 : round < 4 ? 1 : 3;
  const capacity = () => AD.slotsFor(p.level) + AD.BENCH_SLOTS;
  while (guard++ < 40) {
    // 1) 買經驗
    if (p.level < targetLevel(round) && p.gold - AD.BUY_XP.cost >= reserve) {
      p.gold -= AD.BUY_XP.cost; const r = AD.addXp(p.level, p.xp, AD.BUY_XP.xp); p.level = r.level; p.xp = r.xp; continue;
    }
    // 2) 買卡:分數最高且買得起
    let best = -1, bestScore = -1;
    shop.forEach((id, i) => {
      if (!id) return;
      const d = AD.CARD_BY_ID[id];
      if (p.gold - d.cost < reserve) return;
      const full = p.board.length + p.bench.length >= capacity();
      const pairs = countOwned(p, id, 1) >= 1 || countOwned(p, id, 2) >= 1;
      const need = AD.STAR.mergeNeed - 1; // 滿了還能買的前提:這張買下去能立刻合成(合成要 3 張,所以要已經有 2 張同星)
      if (full && !(countOwned(p, id, 1) >= need || countOwned(p, id, 2) >= need)) return;
      let sc = d.cost + (pairs ? 5 : 0) + (s.focus && d.tags.includes(s.focus) ? 3 : 0) + (!s.focus && d.tags.length ? 1 : 0);
      if (!pairs && d.tags.length === 0) sc -= 2; // 通用卡沒有羈絆,優先度低
      if (sc > bestScore) { bestScore = sc; best = i; }
    });
    if (best >= 0 && bestScore >= (round <= 2 ? 1 : 3)) {
      const id = shop[best]; shop[best] = null; p.gold -= AD.CARD_BY_ID[id].cost;
      p.bench.push({ id, star: 1 });
      const m = E.mergeCards(p.board, p.bench); p.board = m.board; p.bench = m.bench;
      arrange(p); continue;
    }
    // 3) 刷新
    if (refresh < maxRefresh && p.gold - 1 >= reserve + (round < 3 ? 99 : 0) && p.gold >= reserve + 2) {
      refresh++; p.gold -= 1; shop = E.rollShop(base, round, refresh, p.level); continue;
    }
    break;
  }
  arrange(p);
}


  return { newPlayer, arrange, playPrep, targetLevel, countOwned };
})();
