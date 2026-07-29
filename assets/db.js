// 共用資料庫工具。所有頁面都會載入這個檔案。
const db = (function () {
  const client = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  // ---------- 玩家身份(Discord 登入) ----------
  function getLocalPlayer() {
    return {
      id: localStorage.getItem("player_id") || null,
      name: localStorage.getItem("player_name") || "",
    };
  }

  async function getSession() {
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session;
  }

  // 頁面上任何地方偵測到登入狀態改變(登入完成/登出)都會呼叫 cb,回傳值是取消訂閱用的函式
  function onAuthChange(cb) {
    const { data } = client.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  }

  // 導去 Discord 授權頁,授權完成後會被導回同一頁(帶著登入狀態)
  async function signInWithDiscord() {
    const { error } = await client.auth.signInWithOAuth({
      provider: "discord",
      options: { redirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  async function signOut() {
    const { error } = await client.auth.signOut();
    if (error) throw error;
    localStorage.removeItem("player_id");
    localStorage.removeItem("player_name");
  }

  // 用 Discord 使用者名稱當暱稱,player 的 id 直接用 Discord 登入的 auth user id(每個 Discord 帳號對應唯一一筆 players 資料)
  function discordNameFromSession(session) {
    const meta = session.user.user_metadata || {};
    return (
      meta.full_name ||
      meta.custom_claims?.global_name ||
      meta.name ||
      meta.preferred_username ||
      meta.user_name ||
      "Discord玩家"
    );
  }

  async function ensurePlayerFromSession(session) {
    if (!session) return null;
    const { data: existing, error: readErr } = await client
      .from("players")
      .select("*")
      .eq("id", session.user.id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (existing) {
      localStorage.setItem("player_id", existing.id);
      localStorage.setItem("player_name", existing.name);
      return existing;
    }
    const name = discordNameFromSession(session);
    const { data, error } = await client
      .from("players")
      .insert({ id: session.user.id, name })
      .select()
      .single();
    if (error) throw error;
    localStorage.setItem("player_id", data.id);
    localStorage.setItem("player_name", data.name);
    return data;
  }

  // ---------- 活動 ----------
  async function listEvents() {
    const { data, error } = await client
      .from("events")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data;
  }

  async function getEvent(eventId) {
    const { data, error } = await client
      .from("events")
      .select("*")
      .eq("id", eventId)
      .single();
    if (error) throw error;
    return data;
  }

  // 讀取活動,活動不存在(例如已被刪除)時回傳 null 而不是丟出錯誤,方便頁面顯示友善訊息
  async function getEventSafe(eventId) {
    const { data, error } = await client
      .from("events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // 讀取對戰,對戰不存在(例如所屬活動已被刪除)時回傳 null 而不是丟出錯誤
  async function getMatchSafe(matchId) {
    const { data, error } = await client
      .from("matches")
      .select("*, p1:player1_id(name), p2:player2_id(name)")
      .eq("id", matchId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function createEvent(opts) {
    const { data, error } = await client
      .from("events")
      .insert({
        name: opts.name,
        game_type: opts.gameType,
        losers_bracket: !!opts.losersBracket,
        rules: opts.rules || {},
        registration_deadline: opts.registrationDeadline || null,
        reward_plan: opts.rewardPlan || {},
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function deleteEvent(eventId) {
    const { error } = await client.from("events").delete().eq("id", eventId);
    if (error) throw error;
  }

  async function setEventStatus(eventId, status) {
    const { error } = await client
      .from("events")
      .update({ status })
      .eq("id", eventId);
    if (error) throw error;
  }

  // ---------- 報名 ----------
  async function joinEvent(eventId, playerId) {
    const { data, error } = await client
      .from("event_participants")
      .upsert(
        { event_id: eventId, player_id: playerId, status: "waiting", bracket: "winners" },
        { onConflict: "event_id,player_id", ignoreDuplicates: false }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getMyParticipant(eventId, playerId) {
    const { data, error } = await client
      .from("event_participants")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function listParticipants(eventId) {
    const { data, error } = await client
      .from("event_participants")
      .select("*, players(name)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function listMatches(eventId) {
    const { data, error } = await client
      .from("matches")
      .select("*, p1:player1_id(name), p2:player2_id(name)")
      .eq("event_id", eventId)
      .order("round", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function removeParticipant(participantId) {
    const { error } = await client
      .from("event_participants")
      .delete()
      .eq("id", participantId);
    if (error) throw error;
  }

  // ---------- 入場逾時自動判定棄權 ----------
  // 場次一開打(status變成active)就會記錄 activated_at;玩家自己的對戰畫面一載入就會呼叫這個標記入場時間。
  async function markEntered(matchId, slot) {
    const field = slot === 1 ? "p1_entered_at" : "p2_entered_at";
    const { data: m, error: readErr } = await client
      .from("matches")
      .select(field)
      .eq("id", matchId)
      .single();
    if (readErr) throw readErr;
    if (m && !m[field]) {
      const { error } = await client
        .from("matches")
        .update({ [field]: new Date().toISOString() })
        .eq("id", matchId);
      if (error) throw error;
    }
  }

  // 對手超過1分鐘沒有進入對戰畫面時,在戰報加一行系統公告(用來提示接下來會自動幫對手出招)
  async function appendMatchLog(matchId, line) {
    const { data: m, error: readErr } = await client
      .from("matches")
      .select("state")
      .eq("id", matchId)
      .single();
    if (readErr) throw readErr;
    const newState = { ...m.state, log: [...(m.state.log || []), line] };
    const { error } = await client.from("matches").update({ state: newState }).eq("id", matchId);
    if (error) throw error;
  }

  async function setReward(participantId, reward, finalRank) {
    const patch = { reward };
    if (finalRank !== undefined && finalRank !== null) patch.final_rank = finalRank;
    const { error } = await client
      .from("event_participants")
      .update(patch)
      .eq("id", participantId);
    if (error) throw error;
  }

  // ---------- 賽程樹產生(勝部,依人數自動算輪空) ----------
  function nextPow2(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function diceInitState() {
    return {
      hp1: 30,
      hp2: 30,
      round: 1,
      shield1: 2,
      shield2: 2,
      rage1: 0,
      rage2: 0,
      rageready1: false,
      rageready2: false,
      freebet1: 0,
      freebet2: 0,
      combo1: 0,
      combo2: 0,
      combobonus1: 0,
      combobonus2: 0,
      gamble1: 0,
      gamble2: 0,
      classult1: false,
      classult2: false,
      guardstack1: 0,
      guardstack2: 0,
      class1: null,
      class2: null,
      field_mod: null,
      log: [],
    };
  }

  function rps5InitState() {
    return { hp1: 10, hp2: 10, round: 1, ult1: false, ult2: false, log: [] };
  }

  function makeInitState(gameType) {
    return gameType === "dice" ? diceInitState() : rps5InitState();
  }

  const FIELD_MODS = ["crit", "shield_plus", "lifesteal", "chaos_tie", "fast_timer", "shadow"];

  // 對戰真正要開打前(狀態轉為 active 那一刻),依實際上場的兩位玩家職業重新計算
  // 防禦骰次數、戰場特性等資料。放到這一刻才算,才能正確反映勝部賽程樹裡「事先不知道是誰」的後面幾輪對戰。
  async function finalizeDiceState(eventId, gameType, rules, state, player1Id, player2Id) {
    if (gameType !== "dice") return state;
    const { data: rows } = await client
      .from("event_participants")
      .select("player_id, class")
      .eq("event_id", eventId)
      .in("player_id", [player1Id, player2Id]);
    const class1 = rows?.find((r) => r.player_id === player1Id)?.class || null;
    const class2 = rows?.find((r) => r.player_id === player2Id)?.class || null;
    let fieldMod = null;
    if (rules && rules.field_mod) {
      fieldMod = FIELD_MODS[Math.floor(Math.random() * FIELD_MODS.length)];
    }
    const shield1 = Math.max(
      0,
      2 + (class1 === "guardian" ? 1 : 0) + (fieldMod === "shield_plus" ? 1 : 0) - (fieldMod === "shadow" ? 1 : 0)
    );
    const shield2 = Math.max(
      0,
      2 + (class2 === "guardian" ? 1 : 0) + (fieldMod === "shield_plus" ? 1 : 0) - (fieldMod === "shadow" ? 1 : 0)
    );
    return { ...state, class1, class2, shield1, shield2, field_mod: fieldMod };
  }

  async function lockAndGenerateBracket(eventId) {
    const ev = await getEvent(eventId);
    const parts = await listParticipants(eventId);
    const entrants = parts.filter((p) => p.status !== "eliminated");
    if (entrants.length < 2) throw new Error("至少需要 2 人才能開賽");

    // 人數太少時敗部復活賽意義不大,自動關閉,單敗淘汰就好
    let losersBracketDowngraded = false;
    if (ev.losers_bracket && entrants.length < 6) {
      losersBracketDowngraded = true;
      await client.from("events").update({ losers_bracket: false }).eq("id", eventId);
      ev.losers_bracket = false;
    }

    const size = nextPow2(entrants.length);
    const byes = size - entrants.length;
    const shuffled = shuffle(entrants);

    // 把輪空平均分散配對,每個輪空都各自配一位真人,絕對不會出現「輪空 vs 輪空」
    // (以前的寫法是輪空全部塞在陣列最後面,只要輪空數 >=2 一定會湊出一組雙輪空,導致該場沒有勝負、後面卡死)
    const seededPairs = [];
    let idx = 0;
    for (let i = 0; i < byes; i++) {
      seededPairs.push([shuffled[idx], null]);
      idx++;
    }
    while (idx < shuffled.length) {
      seededPairs.push([shuffled[idx], shuffled[idx + 1]]);
      idx += 2;
    }

    const rounds = Math.log2(size);
    const allMatches = [];
    let prevRound = [];

    for (let i = 0; i < seededPairs.length; i++) {
      const [a, b] = seededPairs[i];
      const m = {
        id: crypto.randomUUID(),
        event_id: eventId,
        bracket: "winners",
        round: 1,
        slot: i,
        player1_id: a ? a.player_id : null,
        player2_id: b ? b.player_id : null,
        status: "pending", // 不立刻開打,交給 activateNextMatch 一場一場排隊啟動
        state: makeInitState(ev.game_type),
        _pa: a,
        _pb: b,
      };
      if (!a || !b) {
        const winner = a || b;
        m.status = "done";
        m.winner_id = winner ? winner.player_id : null;
      }
      allMatches.push(m);
      prevRound.push(m);
    }

    for (let r = 2; r <= rounds; r++) {
      const thisRound = [];
      for (let i = 0; i < prevRound.length / 2; i++) {
        const feederA = prevRound[i * 2];
        const feederB = prevRound[i * 2 + 1];
        const m = {
          id: crypto.randomUUID(),
          event_id: eventId,
          bracket: "winners",
          round: r,
          slot: i,
          player1_id: feederA.status === "done" ? feederA.winner_id : null,
          player2_id: feederB.status === "done" ? feederB.winner_id : null,
          status: "pending", // 不立刻開打,交給 activateNextMatch 一場一場排隊啟動
          state: makeInitState(ev.game_type),
        };
        feederA.next_match_id = m.id;
        feederA.next_slot = 1;
        feederB.next_match_id = m.id;
        feederB.next_slot = 2;
        thisRound.push(m);
        allMatches.push(m);
      }
      prevRound = thisRound;
    }

    const rows = allMatches.map(({ _pa, _pb, ...rest }) => rest);
    const { error: insErr } = await client.from("matches").insert(rows);
    if (insErr) throw insErr;

    function findById(id) {
      return allMatches.find((x) => x.id === id);
    }

    for (const m of allMatches.filter((m) => m.round === 1)) {
      for (const side of [m._pa, m._pb]) {
        if (!side) continue;
        if (m.status === "done") {
          // 輪空:直接晉級到下一場,但一樣要排隊等 activateNextMatch 叫到才開打
          await client
            .from("event_participants")
            .update({ status: "pending", match_id: m.next_match_id || null })
            .eq("id", side.id);
        } else {
          await client
            .from("event_participants")
            .update({ status: "pending", match_id: m.id })
            .eq("id", side.id);
        }
      }
    }

    await client
      .from("events")
      .update({ locked: true, status: "running" })
      .eq("id", eventId);

    // 排好整個賽程後,只啟動第一場對戰,其他人在等候室排隊等叫號
    await activateNextMatch(eventId);

    return { losersBracketDowngraded };
  }

  // 一場一場來:整個活動同一時間只讓一場對戰進行中。
  // 每次有對戰結束(或有新玩家掉入敗部候位區)就呼叫這個函式,
  // 它會找出目前沒有對戰進行中,才從排隊名單挑下一場開打。
  const BRACKET_ORDER = { winners: 0, losers: 1, final: 2 };

  async function activateNextMatch(eventId) {
    const { data: actives, error: activeErr } = await client
      .from("matches")
      .select("id")
      .eq("event_id", eventId)
      .eq("status", "active")
      .limit(1);
    if (activeErr) throw activeErr;
    if (actives && actives.length) return; // 已經有一場在打,先不排下一場

    const ev = await getEvent(eventId);

    const { data: pending, error: pendErr } = await client
      .from("matches")
      .select("*")
      .eq("event_id", eventId)
      .eq("status", "pending")
      .not("player1_id", "is", null)
      .not("player2_id", "is", null);
    if (pendErr) throw pendErr;

    if (pending && pending.length) {
      const preferBracket = ev.last_match_bracket === "winners" ? "losers" : ev.last_match_bracket === "losers" ? "winners" : null;
      pending.sort((a, b) => {
        if (preferBracket) {
          const pa = a.bracket === preferBracket ? 0 : 1;
          const pb = b.bracket === preferBracket ? 0 : 1;
          if (pa !== pb) return pa - pb;
        }
        const br = (BRACKET_ORDER[a.bracket] ?? 9) - (BRACKET_ORDER[b.bracket] ?? 9);
        if (br) return br;
        const rr = (a.round || 0) - (b.round || 0);
        if (rr) return rr;
        const sr = (a.slot ?? 999) - (b.slot ?? 999);
        if (sr) return sr;
        return new Date(a.created_at) - new Date(b.created_at);
      });
      const next = pending[0];
      const finalState = await finalizeDiceState(eventId, ev.game_type, ev.rules, next.state, next.player1_id, next.player2_id);
      await client.from("matches").update({ status: "active", state: finalState }).eq("id", next.id);
      await client
        .from("event_participants")
        .update({ status: "matched", match_id: next.id })
        .eq("event_id", eventId)
        .in("player_id", [next.player1_id, next.player2_id]);
      return;
    }

    // 沒有排隊中的對戰,看看敗部候位區有沒有兩人可以配對開新的一場
    if (ev.losers_bracket && ev.status !== "closed") {
      let newMatchId = null;
      try {
        newMatchId = await tryMatch(eventId, ev.game_type, "losers");
      } catch (e) {
        // 候位人數不足時 RPC 會回傳 null,忽略即可
      }
      if (newMatchId) {
        // 已經確認過此刻沒有其他場次在進行,直接啟動這場敗部對戰
        await client.from("matches").update({ status: "active" }).eq("id", newMatchId).eq("status", "pending");
        await client
          .from("event_participants")
          .update({ status: "matched" })
          .eq("match_id", newMatchId);
      }
    }
  }

  // ---------- 對戰 ----------
  async function tryMatch(eventId, gameType, bracket) {
    const { data, error } = await client.rpc("match_players", {
      p_event_id: eventId,
      p_game_type: gameType,
      p_bracket: bracket || "losers",
    });
    if (error) throw error;
    return data;
  }

  async function getMatch(matchId) {
    const { data, error } = await client
      .from("matches")
      .select("*, p1:player1_id(name), p2:player2_id(name)")
      .eq("id", matchId)
      .single();
    if (error) throw error;
    return data;
  }

  async function updateMatchState(matchId, patch) {
    const { error } = await client
      .from("matches")
      .update(patch)
      .eq("id", matchId);
    if (error) throw error;
  }

  async function submitMove(matchId, slot, payload) {
    const { error } = await client.rpc("submit_move", {
      p_match_id: matchId,
      p_slot: slot,
      p_payload: payload,
    });
    if (error) throw error;
  }

  async function tryCreateGrandFinal(eventId) {
    const { data, error } = await client.rpc("create_grand_final", {
      p_event_id: eventId,
    });
    if (error) throw error;
    return data;
  }

  async function activeRemainingCount(eventId) {
    const rows = await listParticipants(eventId);
    return rows.filter((r) =>
      ["waiting", "pending", "matched", "wb_champion", "lb_champion"].includes(r.status)
    ).length;
  }

  function rewardForRank(ev, rank) {
    const items = (ev.reward_plan && ev.reward_plan.items) || [];
    return items[rank - 1] || null;
  }

  // 一場對戰結束後的晉級/淘汰/敗部/總冠軍賽路由邏輯
  async function advanceAfterMatch(match, winnerId, loserId) {
    // 用 status='active' 當條件鎖,避免兩個瀏覽器同時把同一場對戰結算兩次
    const { data: claimed, error: claimErr } = await client
      .from("matches")
      .update({ status: "done", winner_id: winnerId })
      .eq("id", match.id)
      .eq("status", "active")
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) return; // 已經被結算過了,不重複處理

    const eventId = match.event_id;
    await client.from("events").update({ last_match_bracket: match.bracket }).eq("id", eventId);
    const ev = await getEvent(eventId);
    const winnerPart = await getMyParticipant(eventId, winnerId);
    const loserPart = await getMyParticipant(eventId, loserId);
    const now = new Date().toISOString();
    const preCount = await activeRemainingCount(eventId);

    if (match.bracket === "final") {
      await client
        .from("event_participants")
        .update({ status: "eliminated", eliminated_at: now, final_rank: 2, reward: loserPart.reward || rewardForRank(ev, 2) })
        .eq("id", loserPart.id);
      await client
        .from("event_participants")
        .update({ status: "champion", final_rank: 1, reward: winnerPart.reward || rewardForRank(ev, 1) })
        .eq("id", winnerPart.id);
      await setEventStatus(eventId, "closed");
    } else if (match.bracket === "winners") {
      if (match.next_match_id) {
        const slotField = match.next_slot === 1 ? "player1_id" : "player2_id";
        const { data: nm, error } = await client
          .from("matches")
          .update({ [slotField]: winnerId })
          .eq("id", match.next_match_id)
          .select()
          .single();
        if (error) throw error;
        // 不在這裡直接開打,一律排隊等 activateNextMatch 叫號,確保同一時間只有一場在進行
        await client
          .from("event_participants")
          .update({ status: "pending", match_id: nm.id })
          .eq("id", winnerPart.id);
      } else if (ev.losers_bracket) {
        await client
          .from("event_participants")
          .update({ status: "wb_champion", match_id: null })
          .eq("id", winnerPart.id);
        await tryCreateGrandFinal(eventId);
      } else {
        await client
          .from("event_participants")
          .update({ status: "champion", final_rank: 1, match_id: null, reward: winnerPart.reward || rewardForRank(ev, 1) })
          .eq("id", winnerPart.id);
        await setEventStatus(eventId, "closed");
      }

      if (ev.losers_bracket) {
        await client
          .from("event_participants")
          .update({ status: "waiting", bracket: "losers", match_id: null })
          .eq("id", loserPart.id);
      } else {
        await client
          .from("event_participants")
          .update({
            status: "eliminated",
            eliminated_at: now,
            final_rank: preCount,
            reward: loserPart.reward || rewardForRank(ev, preCount),
          })
          .eq("id", loserPart.id);
      }
    } else if (match.bracket === "losers") {
      await client
        .from("event_participants")
        .update({
          status: "eliminated",
          eliminated_at: now,
          final_rank: preCount,
          reward: loserPart.reward || rewardForRank(ev, preCount),
        })
        .eq("id", loserPart.id);

      const rows = await listParticipants(eventId);
      const lbAlive = rows.filter((r) => r.bracket === "losers" && r.status !== "eliminated");
      const wbActive = rows.filter(
        (r) => r.bracket === "winners" && ["waiting", "pending", "matched"].includes(r.status)
      );

      if (lbAlive.length <= 1 && wbActive.length === 0) {
        await client
          .from("event_participants")
          .update({ status: "lb_champion", match_id: null })
          .eq("id", winnerPart.id);
        await tryCreateGrandFinal(eventId);
      } else {
        await client
          .from("event_participants")
          .update({ status: "waiting", match_id: null })
          .eq("id", winnerPart.id);
      }
    }

    // 這場結束了(不管是勝部/敗部/總冠軍賽哪一種),都要看看有沒有下一場可以開打
    // 這一行以前只有敗部分支會執行到,勝部分支會提早return跳過,是造成賽程卡住的主因,現在修正為一定會執行
    await activateNextMatch(eventId);
  }

  const ENTER_GRACE_MS = 60 * 1000; // 一方超過這麼久沒進場,系統開始自動幫他出招(不棄權)
  const BOTH_NO_SHOW_MS = 180 * 1000; // 雙方都超過這麼久沒進場,才會強制判定,避免整個賽程卡死

  function neutralAutoMove(gameType) {
    if (gameType === "dice") {
      return { roll: 1 + Math.floor(Math.random() * 6), defend: false, allin: false, freebet: false, gamble: false, stance: null, ult: false };
    }
    return { gesture: null, ult: false, timeout: true };
  }

  // 巡邏檢查目前進行中的那一場對戰,有沒有人遲遲不進場。
  // 不需要對戰畫面本身開啟也能運作,只要有人開著等候室或後台頁面,定期呼叫這個就會生效。
  // 規則:單方缺席 → 系統自動幫他出招(不棄權)。雙方都缺席太久 → 強制判定,並標記 forfeitReason 讓對戰畫面顯示大字公告。
  async function watchdogActiveMatch(eventId) {
    const { data: actives, error } = await client
      .from("matches")
      .select("*")
      .eq("event_id", eventId)
      .eq("status", "active")
      .limit(1);
    if (error) throw error;
    if (!actives || !actives.length) return;
    const m = actives[0];
    if (m.bracket === "final") return; // 總冠軍賽先不自動判,交給主辦人手動處理比較保險
    if (!m.activated_at) return;
    if (m.state && (m.state.hp1 <= 0 || m.state.hp2 <= 0)) return; // 已經分出勝負,等待正常結算

    const elapsed = Date.now() - new Date(m.activated_at).getTime();
    const p1In = !!m.p1_entered_at;
    const p2In = !!m.p2_entered_at;

    if (!p1In && !p2In) {
      if (elapsed < BOTH_NO_SHOW_MS) return;
      const winnerId = Math.random() < 0.5 ? m.player1_id : m.player2_id;
      const loserId = winnerId === m.player1_id ? m.player2_id : m.player1_id;
      const loserIsP1 = loserId === m.player1_id;
      const newState = {
        ...m.state,
        hp1: loserIsP1 ? 0 : m.state.hp1,
        hp2: loserIsP1 ? m.state.hp2 : 0,
        forfeitReason: "both_afk",
        log: [...(m.state.log || []), "雙方都太久沒有進場對戰,系統自動判定一方直接晉級。"],
      };
      await client.from("matches").update({ state: newState }).eq("id", m.id);
      await advanceAfterMatch({ ...m, state: newState }, winnerId, loserId);
      return;
    }

    if (elapsed < ENTER_GRACE_MS) return;
    if (p1In && p2In) return; // 雙方都進場了,交給對戰畫面自己的代打機制處理即時出招

    const ev = await getEvent(eventId);
    const absentSlot = !p1In ? 1 : 2;
    const already = absentSlot === 1 ? m.state.m1 : m.state.m2;
    if (already) return; // 這回合已經出過招了,等對方出招或下一輪再說
    await submitMove(m.id, absentSlot, neutralAutoMove(ev.game_type));
  }

  // 玩家自行退出比賽(例如要換帳號)。還沒開打就直接移除報名;如果正在對戰中,視同棄權,對手直接獲勝晉級。
  async function quitEvent(eventId, playerId) {
    const part = await getMyParticipant(eventId, playerId);
    if (!part) return;
    if (part.status === "matched" && part.match_id) {
      const { data: m, error } = await client.from("matches").select("*").eq("id", part.match_id).single();
      if (error) throw error;
      if (m.status === "active") {
        const winnerId = m.player1_id === playerId ? m.player2_id : m.player1_id;
        const newState = { ...m.state, log: [...(m.state.log || []), "一方主動退賽,對手直接獲勝"] };
        await client.from("matches").update({ state: newState }).eq("id", m.id);
        await advanceAfterMatch(m, winnerId, playerId);
        return;
      }
    }
    await removeParticipant(part.id);
  }

  // 改名(登入後可以自訂暱稱,不會被下次登入時的 Discord 名稱蓋掉)
  async function updatePlayerName(playerId, name) {
    const { data, error } = await client
      .from("players")
      .update({ name })
      .eq("id", playerId)
      .select()
      .single();
    if (error) throw error;
    localStorage.setItem("player_name", data.name);
    return data;
  }

  async function getActiveMatch(eventId) {
    const { data, error } = await client
      .from("matches")
      .select("*, p1:player1_id(name), p2:player2_id(name)")
      .eq("event_id", eventId)
      .eq("status", "active")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // 設定/更新玩家在這場活動的職業(報名時或開賽前都可以改)
  async function setPlayerClass(eventId, playerId, klass) {
    const { error } = await client
      .from("event_participants")
      .update({ class: klass || null })
      .eq("event_id", eventId)
      .eq("player_id", playerId);
    if (error) throw error;
  }

  // ---------- 觀眾下注(純娛樂) ----------
  async function placeBet(matchId, playerId, betOn) {
    const { error } = await client
      .from("match_bets")
      .upsert({ match_id: matchId, player_id: playerId, bet_on: betOn }, { onConflict: "match_id,player_id" });
    if (error) throw error;
  }

  async function getBets(matchId) {
    const { data, error } = await client.from("match_bets").select("*").eq("match_id", matchId);
    if (error) throw error;
    return data || [];
  }

  // ---------- 觀眾即時表情彈幕(不存資料庫,純即時廣播) ----------
  function openReactionChannel(matchId, onReaction) {
    const channel = client.channel(`reactions-${matchId}`);
    if (onReaction) {
      channel.on("broadcast", { event: "emoji" }, (msg) => onReaction(msg.payload.emoji));
    }
    channel.subscribe();
    return {
      send(emoji) {
        channel.send({ type: "broadcast", event: "emoji", payload: { emoji } });
      },
      close() {
        client.removeChannel(channel);
      },
    };
  }

  function onTableChange(table, filter, cb) {
    const channel = client
      .channel(`${table}-${filter || "all"}-${Math.random()}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, cb)
      .subscribe();
    return () => client.removeChannel(channel);
  }

  // ---------- 贊助名單(整站共用一份) ----------
  async function listSponsors() {
    const { data, error } = await client.from("sponsors").select("*").order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async function addSponsor(name, items) {
    const { data, error } = await client.from("sponsors").insert({ name, items }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateSponsor(id, name, items) {
    const { error } = await client.from("sponsors").update({ name, items }).eq("id", id);
    if (error) throw error;
  }

  async function deleteSponsor(id) {
    const { error } = await client.from("sponsors").delete().eq("id", id);
    if (error) throw error;
  }

  async function getSiteSetting(key) {
    const { data, error } = await client.from("site_settings").select("value").eq("key", key).maybeSingle();
    if (error) throw error;
    return data ? data.value : "";
  }

  async function setSiteSetting(key, value) {
    const { error } = await client.from("site_settings").upsert({ key, value }, { onConflict: "key" });
    if (error) throw error;
  }

  return {
    client,
    getLocalPlayer,
    getSession,
    onAuthChange,
    signInWithDiscord,
    signOut,
    ensurePlayerFromSession,
    discordNameFromSession,
    updatePlayerName,
    quitEvent,
    watchdogActiveMatch,
    listSponsors,
    addSponsor,
    updateSponsor,
    deleteSponsor,
    getSiteSetting,
    setSiteSetting,
    listEvents,
    getEvent,
    getEventSafe,
    getMatchSafe,
    createEvent,
    deleteEvent,
    setEventStatus,
    joinEvent,
    getMyParticipant,
    listParticipants,
    listMatches,
    getActiveMatch,
    setReward,
    setPlayerClass,
    placeBet,
    getBets,
    openReactionChannel,
    removeParticipant,
    markEntered,
    appendMatchLog,
    lockAndGenerateBracket,
    activateNextMatch,
    tryMatch,
    getMatch,
    updateMatchState,
    submitMove,
    tryCreateGrandFinal,
    advanceAfterMatch,
    onTableChange,
  };
})();
