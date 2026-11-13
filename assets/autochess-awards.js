// 夜市自走棋 · 賽後展示(階段 5):MVP 卡與趣味獎項。純函式,不碰 DOM / 資料庫,Node 可直接測。
//   mvpCard(cards)             最終陣容裡戰力最高的卡(攻擊×3+血量,乘星級倍率;同分取費用高者)
//   minHp(statRows)            某位玩家整場掉到過的最低血量(用每輪扣血累計回推)
//   awards(players, statRows)  趣味獎項:最會混搭 / 最長連勝 / 最高星卡 / 翻盤王
// players: autochess_players 的列(player_id、players.name、final_rank、state.{board,bench,bestStreak});
// statRows: autochess_stats 的列 [{ player_id, round, stat }](可省略,省略就沒有翻盤王)
window.AutochessAwards = (function () {
  const AD = window.AutochessData, E = window.AutochessEngine;
  const nameOf = (p) => (p.players && p.players.name) || p.name || "玩家";
  const power = (c) => { const d = AD.CARD_BY_ID[c.id]; return d ? (d.atk * 3 + d.hp) * AD.STAR.stat[c.star || 1] : 0; };

  function mvpCard(cards) {
    let best = null, bp = -1;
    (cards || []).forEach((c) => {
      const d = AD.CARD_BY_ID[c.id]; if (!d) return;
      const p = power(c) + d.cost * 0.01; // 同分時費用高者
      if (p > bp) { bp = p; best = c; }
    });
    return best;
  }

  function minHp(rows) {
    let hp = AD.START_HP, low = hp;
    (rows || []).slice().sort((a, b) => a.round - b.round).forEach((r) => { hp -= (r.stat && r.stat.dmg) || 0; if (hp < low) low = hp; });
    return Math.max(0, low);
  }

  function awards(players, statRows) {
    const out = [];
    const ps = (players || []).filter((p) => p.state && !(p.players && p.players.is_bot));
    const all = (p) => ((p.state.board || []).concat(p.state.bench || []));
    // 最會混搭:最終陣容同時啟動最多羈絆(含隱藏羈絆);至少 3 個才頒
    let best = null, bn = 2;
    ps.forEach((p) => { const b = E.computeBonds(p.state.board || []); const n = Object.keys(b.active).length + b.hidden.length; if (n > bn) { bn = n; best = p; } });
    if (best) out.push({ key: "mixer", name: "最會混搭", icon: "blend", player_id: best.player_id, who: nameOf(best), detail: `同時啟動 ${bn} 個羈絆` });
    // 最長連勝:至少 4 連勝
    best = null; bn = 3;
    ps.forEach((p) => { const n = p.state.bestStreak || 0; if (n > bn) { bn = n; best = p; } });
    if (best) out.push({ key: "streak", name: "最長連勝", icon: "flame", player_id: best.player_id, who: nameOf(best), detail: `${bn} 連勝` });
    // 最高星卡:至少 2★;同星取費用高者
    best = null; let bs = 1, bc = 0, bcard = null;
    ps.forEach((p) => all(p).forEach((c) => { const d = AD.CARD_BY_ID[c.id]; if (!d) return; if (c.star > bs || (c.star === bs && c.star > 1 && d.cost > bc)) { bs = c.star; bc = d.cost; best = p; bcard = c; } }));
    if (best) out.push({ key: "star", name: "最高星卡", icon: "star", player_id: best.player_id, who: nameOf(best), detail: `${AD.CARD_BY_ID[bcard.id].name} ${bs}★` });
    // 翻盤王:冠軍,且整場血量曾掉到 30 以下
    const champ = ps.find((p) => p.final_rank === 1);
    if (champ && statRows) {
      const low = minHp(statRows.filter((r) => r.player_id === champ.player_id));
      if (low <= 30) out.push({ key: "comeback", name: "翻盤王", icon: "trending-up", player_id: champ.player_id, who: nameOf(champ), detail: `血量一度只剩 ${low}` });
    }
    return out;
  }

  return { mvpCard, minHp, awards, power };
})();
