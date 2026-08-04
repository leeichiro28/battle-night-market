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
    // BO5:games1/games2 是系列賽目前局數比分,先取得3局的一方贏得整場對戰;
    // game 是目前打到系列賽第幾局,round 則是「這一局」裡的回合數(每局重打會歸1)。
    // ult1/ult2 是這一局已經用掉幾次究極手勢(數字,不是布林值),
    // 一般情況上限1次,若開了「手速戰場」場地規則,該局上限會變成2次。
    return { hp1: 30, hp2: 30, round: 1, game: 1, games1: 0, games2: 0, ult1: 0, ult2: 0, log: [] };
  }

  function makeInitState(gameType) {
    return gameType === "dice" ? diceInitState() : rps5InitState();
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
  // 每次有對戰結束(或有新玩家掉入敗部候位區)就呼叫這個函式。
  // 實際的「查有沒有 active 場次→挑下一場→啟動」全部改放到 Postgres 的 activate_next_match RPC 裡原子執行
  // (見 supabase-schema.sql),不要在這裡用 select 再 update 兩步做,兩步中間沒有原子性保證,
  // 兩個玩家幾乎同時打完各自的對戰時會兩邊都查到「沒有 active」然後各自啟動一場,導致同時開兩場對戰的 bug。
  async function activateNextMatch(eventId) {
    const { error } = await client.rpc("activate_next_match", { p_event_id: eventId });
    if (error) throw error;
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

  // ---------- 夜市拍賣 ----------
  // 報名(等於「開局全自動」企劃裡的公平起跑):第一次報名時依活動設定的起始預算發財神幣,
  // 之後重複呼叫(例如重整頁面)不會重發,直接回傳原本那筆資料。
  async function joinAuctionEvent(eventId, playerId) {
    const existing = await getMyAuctionParticipant(eventId, playerId);
    if (existing) return existing;
    const ev = await getEvent(eventId);
    const startingBudget = (ev.rules && ev.rules.startingBudget) || AUCTION_DEFAULT_BUDGET;
    const { data, error } = await client
      .from("auction_participants")
      .upsert(
        { event_id: eventId, player_id: playerId, coins: startingBudget, work_ready_at: new Date().toISOString() },
        { onConflict: "event_id,player_id", ignoreDuplicates: false }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getMyAuctionParticipant(eventId, playerId) {
    const { data, error } = await client
      .from("auction_participants")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function listAuctionParticipants(eventId) {
    const { data, error } = await client
      .from("auction_participants")
      .select("*, players(name)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function listAuctionLots(eventId) {
    const { data, error } = await client
      .from("auction_lots")
      .select("*, bidder:current_bidder_id(name)")
      .eq("event_id", eventId)
      .order("wave_number", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  // 主辦人按下「開始拍賣」:把已報名的人鎖住(不能再中途加入拿預算),
  // 依商品排程算好每一波的開拍時間,整場一次寫進 auction_lots。
  async function startAuction(eventId, opts) {
    const waveIntervalSec = opts.waveIntervalSec || AUCTION_DEFAULT_WAVE_INTERVAL_SEC;
    const waves = opts.waves; // buildAuctionWaves() 產生的結果,呼叫端(admin.js)已經算好
    const now = Date.now();
    const rows = [];
    waves.forEach((wave, waveIdx) => {
      const scheduledAt = new Date(now + waveIdx * waveIntervalSec * 1000).toISOString();
      wave.forEach((item) => {
        rows.push({
          event_id: eventId,
          wave_number: waveIdx + 1,
          item_name: item.itemName,
          item_tier: item.itemTier,
          points: item.points,
          base_price: item.basePrice,
          min_increment: item.minIncrement,
          current_price: item.basePrice,
          status: "scheduled",
          scheduled_at: scheduledAt,
          special_key: item.specialKey || null,
          is_surprise: !!item.isSurprise,
        });
      });
    });
    if (rows.length) {
      const { error: insertErr } = await client.from("auction_lots").insert(rows);
      if (insertErr) throw insertErr;
    }
    // 順便排一批夜市任務(問答/猜謎),平均分散在整場預估時長內,自動開放作答。
    const totalDurationSec = Math.max(waves.length, 1) * waveIntervalSec;
    const tasks = buildAuctionTaskSchedule(totalDurationSec);
    if (tasks.length) {
      const taskRows = tasks.map((t) => ({
        event_id: eventId,
        question: t.q,
        options: t.options,
        correct_index: t.correct,
        task_type: t.type,
        reward: t.reward,
        status: "scheduled",
        scheduled_at: new Date(now + t.offsetSec * 1000).toISOString(),
      }));
      const { error: taskErr } = await client.from("auction_tasks").insert(taskRows);
      if (taskErr) throw taskErr;
    }
    const { error } = await client
      .from("events")
      .update({ locked: true, status: "running" })
      .eq("id", eventId);
    if (error) throw error;
  }

  // 每個看拍賣畫面的人,瀏覽器背景每秒都會呼叫這兩個函式來推進排程,
  // 用 status 當條件鎖(.eq status)確保就算好幾個人同時呼叫,同一件商品也只會被推進一次。
  async function activateDueAuctionLots(eventId) {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await client
      .from("auction_lots")
      .select("id, base_price, priority_holder_id")
      .eq("event_id", eventId)
      .eq("status", "scheduled")
      .lte("scheduled_at", nowIso);
    if (error) throw error;
    if (!due || !due.length) return;
    const now = Date.now();
    const endsAt = new Date(now + AUCTION_LOT_DURATION_SEC * 1000).toISOString();
    for (const lot of due) {
      const updates = { status: "live", current_price: lot.base_price, ends_at: endsAt };
      // 如果這一波有人用插隊優先權預約過,開拍時順便算出他的專屬優先出價時間窗
      if (lot.priority_holder_id) updates.priority_until = new Date(now + AUCTION_PRIORITY_WINDOW_SEC * 1000).toISOString();
      await client.from("auction_lots").update(updates).eq("id", lot.id).eq("status", "scheduled");
    }
  }

  // 共用結標邏輯:扣得標者的錢(招待券免費兌換時 finalPrice 是 0)、幫其他出過價但沒標到的人辦參與退補、
  // 如果是特殊券商品就把效果加進得標者的 auction_participants.effects、如果是福袋箱就現場開箱算分數、
  // 如果這一波有成立合夥競標就把價錢跟分數分一半給夥伴、幫猜價小遊戲猜中/最接近的人加分,最後標記 settled。
  // 呼叫端(settleExpiredAuctionLots / useAuctionFreeCommonTicket)都已經先用 status 條件鎖搶到這件商品的處理權。
  async function finalizeAuctionLot(lot, winnerId, finalPrice) {
    let lotUpdates = null;
    let partnerCredit = null; // { partnerId, coinsDelta, bonusPoints }
    if (winnerId) {
      const part = await getMyAuctionParticipant(lot.event_id, winnerId);
      if (part) {
        const effects = part.effects || {};
        let nextEffects = null;
        let points = lot.points;
        if (lot.special_key) {
          nextEffects = { ...effects, [lot.special_key]: (effects[lot.special_key] || 0) + 1 };
        }
        if (lot.item_tier === "mystery") {
          const outcome = auctionRollMysteryBoxOutcome();
          points = outcome.points;
          let doubled = false;
          if (effects.boxDoubleActive) {
            points *= 2;
            doubled = true;
            nextEffects = { ...(nextEffects || effects), boxDoubleActive: false };
          }
          lotUpdates = { ...(lotUpdates || {}), box_reveal_name: outcome.name, box_reveal_tier: outcome.tier, box_doubled: doubled };
        }

        // 合夥競標:這一波如果有成立合夥關係,得標者跟夥伴價錢、分數各分一半(尾數算得標者的)。
        let myPrice = finalPrice;
        let myPoints = points;
        const isPartnered = lot.partner_status === "accepted" && (lot.partner_a_id === winnerId || lot.partner_b_id === winnerId);
        if (isPartnered) {
          const partnerId = lot.partner_a_id === winnerId ? lot.partner_b_id : lot.partner_a_id;
          const myPriceShare = Math.ceil(finalPrice / 2);
          const myPointsShare = Math.ceil(points / 2);
          partnerCredit = { partnerId, coinsDelta: -(finalPrice - myPriceShare), bonusPoints: points - myPointsShare };
          myPrice = myPriceShare;
          myPoints = myPointsShare;
        }

        if (lot.item_tier !== "special") {
          lotUpdates = { ...(lotUpdates || {}), points: myPoints };
        }
        const updates = { coins: Math.max(0, part.coins - myPrice) };
        if (nextEffects) updates.effects = nextEffects;
        await client.from("auction_participants").update(updates).eq("id", part.id);
      }
    }
    if (partnerCredit) {
      const partnerPart = await getMyAuctionParticipant(lot.event_id, partnerCredit.partnerId);
      if (partnerPart) {
        await client
          .from("auction_participants")
          .update({
            coins: Math.max(0, partnerPart.coins + partnerCredit.coinsDelta),
            bonus_points: (partnerPart.bonus_points || 0) + partnerCredit.bonusPoints,
          })
          .eq("id", partnerPart.id);
      }
    }
    if (lotUpdates) {
      await client.from("auction_lots").update(lotUpdates).eq("id", lot.id);
    }

    // 猜價小遊戲:這件商品開拍中大家先猜的「最後會標到多少錢」,結標後跟實際成交價比對,
    // 猜中或最接近的人加 bonus_points(平手全部一起加)。沒人出價流標的話(finalPrice 是 0)就不結算。
    if (finalPrice > 0) {
      const { data: guesses, error: guessErr } = await client.from("auction_price_guesses").select("*").eq("lot_id", lot.id);
      if (guessErr) throw guessErr;
      if (guesses && guesses.length) {
        let bestDiff = Infinity;
        guesses.forEach((g) => {
          const diff = Math.abs(g.guess - finalPrice);
          if (diff < bestDiff) bestDiff = diff;
        });
        const winners = guesses.filter((g) => Math.abs(g.guess - finalPrice) === bestDiff);
        const bonus = bestDiff === 0 ? AUCTION_GUESS_BONUS_EXACT : AUCTION_GUESS_BONUS_CLOSE;
        for (const g of winners) {
          const guesserPart = await getMyAuctionParticipant(lot.event_id, g.player_id);
          if (guesserPart) {
            await client
              .from("auction_participants")
              .update({ bonus_points: (guesserPart.bonus_points || 0) + bonus })
              .eq("id", guesserPart.id);
          }
        }
      }
    }

    // 參與退補:這件商品有出過價、但最後沒標到的人,結標後每人退一小筆財神幣當參與獎勵,
    // 鼓勵大家踴躍出手而不是全場觀望。金額 = 這件商品的最小加價單位 * 倍率,越稀有的商品退越多。
    // 合夥的夥伴不算「沒標到」,不用再額外領一次參與退補。
    const { data: bidRows, error: bidErr } = await client.from("auction_bids").select("player_id").eq("lot_id", lot.id);
    if (bidErr) throw bidErr;
    const refund = lot.min_increment * AUCTION_PARTICIPATION_REFUND_MULT;
    const excludeIds = new Set([winnerId, partnerCredit ? partnerCredit.partnerId : null]);
    const losingBidderIds = Array.from(new Set((bidRows || []).map((b) => b.player_id))).filter((pid) => !excludeIds.has(pid));
    for (const pid of losingBidderIds) {
      const losingPart = await getMyAuctionParticipant(lot.event_id, pid);
      if (losingPart) {
        await client.from("auction_participants").update({ coins: losingPart.coins + refund }).eq("id", losingPart.id);
      }
    }
    await client.from("auction_lots").update({ settled: true }).eq("id", lot.id);
  }

  async function settleExpiredAuctionLots(eventId) {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await client
      .from("auction_lots")
      .select("*")
      .eq("event_id", eventId)
      .eq("status", "live")
      .lte("ends_at", nowIso);
    if (error) throw error;
    if (!due || !due.length) return;
    for (const lot of due) {
      // 用 status='live' 當鎖,先搶到才處理結算,沒搶到的人就跳過(已經有人處理過了)
      const { data: claimed, error: claimErr } = await client
        .from("auction_lots")
        .update({ status: "done" })
        .eq("id", lot.id)
        .eq("status", "live")
        .select();
      if (claimErr) throw claimErr;
      if (!claimed || !claimed.length) continue;
      await finalizeAuctionLot(lot, lot.current_bidder_id, lot.current_price);
    }
  }

  // 出價:用「目前最高價沒變」當樂觀鎖條件,避免兩個人同時搶標時其中一口價憑空消失。
  // 出價前會檢查:這位玩家手上財神幣扣掉他「目前正領先中的其他商品」的金額後,夠不夠付這一口價。
  // 如果這一波有人用插隊優先權預約過,專屬時間窗內只有那個人能出價,其他人要等時間到。
  async function placeAuctionBid(lot, playerId, amount) {
    if (lot.priority_holder_id && lot.priority_holder_id !== playerId && lot.priority_until && new Date(lot.priority_until).getTime() > Date.now()) {
      throw new Error("現在是別人的插隊優先權時間,請稍後再搶標");
    }
    const newPrice = lot.current_price + amount;
    const part = await getMyAuctionParticipant(lot.event_id, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const { data: myLiveLeads, error: leadErr } = await client
      .from("auction_lots")
      .select("id, current_price")
      .eq("event_id", lot.event_id)
      .eq("status", "live")
      .eq("current_bidder_id", playerId);
    if (leadErr) throw leadErr;
    const committed = (myLiveLeads || []).filter((l) => l.id !== lot.id).reduce((s, l) => s + l.current_price, 0);
    if (part.coins - committed < newPrice) {
      throw new Error("財神幣不夠喊這個價(要扣掉你目前其他領先中的商品)");
    }
    const now = new Date();
    let endsAt = lot.ends_at;
    const remainingMs = new Date(lot.ends_at).getTime() - now.getTime();
    if (remainingMs <= AUCTION_ANTI_SNIPE_WINDOW_SEC * 1000) {
      endsAt = new Date(now.getTime() + AUCTION_ANTI_SNIPE_EXTEND_SEC * 1000).toISOString();
    }
    const { data: updated, error } = await client
      .from("auction_lots")
      .update({ current_price: newPrice, current_bidder_id: playerId, ends_at: endsAt })
      .eq("id", lot.id)
      .eq("status", "live")
      .eq("current_price", lot.current_price)
      .select();
    if (error) throw error;
    if (!updated || !updated.length) throw new Error("手慢了,價格剛剛被別人改變了,請重新出價");
    await client.from("auction_bids").insert({ lot_id: lot.id, event_id: lot.event_id, player_id: playerId, amount: newPrice });
    return updated[0];
  }

  // 打工賺財神幣:用 work_ready_at<=now 當樂觀鎖,同一秒連點兩次也只會成功一次。
  async function workForAuctionCoins(eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const nowIso = new Date().toISOString();
    if (new Date(part.work_ready_at).getTime() > Date.now()) {
      throw new Error("還在冷卻中");
    }
    const gain = AUCTION_WORK_MIN + Math.floor(Math.random() * (AUCTION_WORK_MAX - AUCTION_WORK_MIN + 1));
    const nextReady = new Date(Date.now() + AUCTION_WORK_COOLDOWN_SEC * 1000).toISOString();
    const { data: updated, error } = await client
      .from("auction_participants")
      .update({ coins: part.coins + gain, work_ready_at: nextReady })
      .eq("id", part.id)
      .eq("work_ready_at", part.work_ready_at)
      .select();
    if (error) throw error;
    if (!updated || !updated.length) throw new Error("手慢了,請再按一次");
    return { gain, participant: updated[0] };
  }

  // ---------- 夜市任務(問答／猜謎) ----------
  async function listAuctionTasks(eventId) {
    const { data, error } = await client
      .from("auction_tasks")
      .select("*")
      .eq("event_id", eventId)
      .order("scheduled_at", { ascending: true });
    if (error) throw error;
    return data || [];
  }

  // 每個看拍賣畫面的人,瀏覽器背景每秒都會呼叫這兩個函式來推進任務,
  // 跟商品排程一樣用 status 當條件鎖,避免好幾個人同時呼叫時同一題被推進兩次。
  async function activateDueAuctionTasks(eventId) {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await client
      .from("auction_tasks")
      .select("id")
      .eq("event_id", eventId)
      .eq("status", "scheduled")
      .lte("scheduled_at", nowIso);
    if (error) throw error;
    if (!due || !due.length) return;
    const endsAt = new Date(Date.now() + AUCTION_TASK_DURATION_SEC * 1000).toISOString();
    for (const t of due) {
      await client.from("auction_tasks").update({ status: "live", ends_at: endsAt }).eq("id", t.id).eq("status", "scheduled");
    }
  }

  async function settleExpiredAuctionTasks(eventId) {
    const nowIso = new Date().toISOString();
    const { error } = await client
      .from("auction_tasks")
      .update({ status: "done" })
      .eq("event_id", eventId)
      .eq("status", "live")
      .lte("ends_at", nowIso);
    if (error) throw error;
  }

  // 玩家作答:靠 auction_task_answers 的 unique(task_id, player_id) 限制擋重複作答,
  // 答對才會發財神幣,答錯不倒扣、但這題也不能再猜第二次。
  async function answerAuctionTask(taskId, eventId, playerId, choiceIndex) {
    const { data: task, error: taskErr } = await client.from("auction_tasks").select("*").eq("id", taskId).single();
    if (taskErr) throw taskErr;
    if (task.status !== "live" || (task.ends_at && new Date(task.ends_at).getTime() < Date.now())) {
      throw new Error("這題已經結束了,晚了一步");
    }
    const correct = choiceIndex === task.correct_index;
    const { error: insErr } = await client
      .from("auction_task_answers")
      .insert({ task_id: taskId, event_id: eventId, player_id: playerId, correct });
    if (insErr) {
      if (insErr.code === "23505") throw new Error("這題你已經回答過了");
      throw insErr;
    }
    let gain = 0;
    let participant = null;
    if (correct) {
      const part = await getMyAuctionParticipant(eventId, playerId);
      if (part) {
        gain = task.reward;
        const { data: updated, error: updErr } = await client
          .from("auction_participants")
          .update({ coins: part.coins + gain })
          .eq("id", part.id)
          .select();
        if (updErr) throw updErr;
        participant = updated && updated[0];
      }
    }
    return { correct, gain, participant };
  }

  // 一次撈出這位玩家在這場活動裡「已經回答過的任務」,前端拿來判斷每題要顯示選項還是顯示結果。
  async function listMyAuctionTaskAnswers(eventId, playerId) {
    const { data, error } = await client
      .from("auction_task_answers")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId);
    if (error) throw error;
    return data || [];
  }

  // ---------- 幸運攤位(快速小賭注) ----------
  // 下注:先驗證金額跟冷卻,骰子結果用 resolveAuctionLuckyBet()(auction-catalog.js)純計算算出,
  // 寫回財神幣時用「coins 沒變 + 冷卻沒變」當樂觀鎖,避免跟打工/出價/任務同時發生時互相蓋掉。
  async function placeAuctionLuckyBet(eventId, playerId, betAmount, guess) {
    if (guess !== "big" && guess !== "small") throw new Error("請選大或小");
    const amount = Math.floor(betAmount);
    if (!amount || amount < AUCTION_LUCKY_MIN_BET) throw new Error(`下注至少要 ${AUCTION_LUCKY_MIN_BET} 財神幣`);
    if (amount > AUCTION_LUCKY_MAX_BET) throw new Error(`單次下注最多 ${AUCTION_LUCKY_MAX_BET} 財神幣`);
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    if (new Date(part.lucky_ready_at).getTime() > Date.now()) throw new Error("還在冷卻中");
    if (part.coins < amount) throw new Error("財神幣不夠下注這個金額");
    const { die, outcome, win, delta } = resolveAuctionLuckyBet(amount, guess);
    const nextReady = new Date(Date.now() + AUCTION_LUCKY_COOLDOWN_SEC * 1000).toISOString();
    const { data: updated, error } = await client
      .from("auction_participants")
      .update({ coins: Math.max(0, part.coins + delta), lucky_ready_at: nextReady })
      .eq("id", part.id)
      .eq("coins", part.coins)
      .eq("lucky_ready_at", part.lucky_ready_at)
      .select();
    if (error) throw error;
    if (!updated || !updated.length) throw new Error("手慢了,財神幣剛剛被別的動作改變了,請重新下注");
    return { die, outcome, win, delta, betAmount: amount, participant: updated[0] };
  }

  // 目前積分 = 得標商品分數總和 + 剩餘財神幣 * 折算比例(不管活動是否已結束都能算,用來做即時排行榜)
  async function computeAuctionStandings(eventId) {
    const [parts, lots] = await Promise.all([listAuctionParticipants(eventId), listAuctionLots(eventId)]);
    const wonByPlayer = {};
    lots
      .filter((l) => l.status === "done" && l.current_bidder_id)
      .forEach((l) => {
        wonByPlayer[l.current_bidder_id] = wonByPlayer[l.current_bidder_id] || [];
        wonByPlayer[l.current_bidder_id].push(l);
      });
    const rows = parts.map((p) => {
      const won = wonByPlayer[p.player_id] || [];
      const itemScore = won.filter((l) => !l.refunded).reduce((s, l) => s + l.points, 0) + (p.bonus_points || 0);
      const coinScore = Math.round(p.coins * AUCTION_COIN_TO_SCORE * 10) / 10;
      return { participant: p, wonLots: won, itemScore, coinScore, score: itemScore + coinScore };
    });
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  // ---------- 特殊券效果 ----------
  // 搶先情報券:一用永久生效(對這位玩家而言),商品預告從此能看到全場剩餘清單,不用每波重複使用。
  async function useAuctionIntelTicket(eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.intel || effects.intel < 1) throw new Error("你沒有搶先情報券");
    const nextEffects = { ...effects, intel: effects.intel - 1, intelActive: true };
    const { data: updated, error } = await client.from("auction_participants").update({ effects: nextEffects }).eq("id", part.id).select();
    if (error) throw error;
    return updated[0];
  }

  // 插隊優先權:預約「目前排隊中最早的下一波商品」,那一波開拍時這位玩家會拿到專屬優先出價時間窗
  // (實際時間窗是 activateDueAuctionLots 開拍那一刻才算出來,這裡只先把 priority_holder_id 卡在商品上)。
  async function useAuctionPriorityTicket(eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.priority || effects.priority < 1) throw new Error("你沒有插隊優先權");
    const { data: nextLot, error: nextErr } = await client
      .from("auction_lots")
      .select("*")
      .eq("event_id", eventId)
      .eq("status", "scheduled")
      .is("priority_holder_id", null)
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (nextErr) throw nextErr;
    if (!nextLot) throw new Error("目前沒有可以插隊的下一波商品了");
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ priority_holder_id: playerId })
      .eq("id", nextLot.id)
      .eq("status", "scheduled")
      .is("priority_holder_id", null)
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了,插隊名額剛剛被別人搶走,請再試一次");
    const nextEffects = { ...effects, priority: effects.priority - 1 };
    const { error: partErr } = await client.from("auction_participants").update({ effects: nextEffects }).eq("id", part.id);
    if (partErr) throw partErr;
    return claimed[0];
  }

  // 退款保證券:針對玩家自己「已得標、還沒退過」的某一件商品,無條件退回,拿回一半財神幣。
  async function useAuctionRefundTicket(lotId, eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.refund || effects.refund < 1) throw new Error("你沒有退款保證券");
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.status !== "done" || lot.current_bidder_id !== playerId) throw new Error("這不是你標到的商品");
    if (lot.refunded) throw new Error("這件商品已經退過了");
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ refunded: true })
      .eq("id", lotId)
      .eq("refunded", false)
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了,請重新整理再試一次");
    const refundCoins = Math.floor(lot.current_price / 2);
    const nextEffects = { ...effects, refund: effects.refund - 1 };
    const { data: updatedPart, error: partErr } = await client
      .from("auction_participants")
      .update({ coins: part.coins + refundCoins, effects: nextEffects })
      .eq("id", part.id)
      .select();
    if (partErr) throw partErr;
    return { refundCoins, participant: updatedPart[0] };
  }

  // 福袋箱翻倍券:設一個「下次開箱翻倍」的持續生效旗標,實際翻倍在 finalizeAuctionLot 開箱那一刻套用並消耗掉。
  async function useAuctionBoxDoubleTicket(eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.boxDouble || effects.boxDouble < 1) throw new Error("你沒有福袋箱翻倍券");
    if (effects.boxDoubleActive) throw new Error("已經啟用中了,等下一次開箱生效");
    const nextEffects = { ...effects, boxDouble: effects.boxDouble - 1, boxDoubleActive: true };
    const { data: updated, error } = await client.from("auction_participants").update({ effects: nextEffects }).eq("id", part.id).select();
    if (error) throw error;
    return updated[0];
  }

  // ---------- 合夥競標 ----------
  // 只能在還沒有人成立合夥關係(或對方剛婉拒過)的情況下邀請,一波同時只能有一組合夥關係。
  async function inviteAuctionPartner(lotId, eventId, inviterId, partnerId) {
    if (inviterId === partnerId) throw new Error("不能邀請自己合夥");
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.status !== "live") throw new Error("這件商品現在不是拍賣中");
    if (lot.partner_status === "pending" || lot.partner_status === "accepted") throw new Error("這一波已經有合夥關係在進行了");
    const partnerPart = await getMyAuctionParticipant(eventId, partnerId);
    if (!partnerPart) throw new Error("對方還沒報名這場拍賣");
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ partner_a_id: inviterId, partner_b_id: partnerId, partner_status: "pending" })
      .eq("id", lotId)
      .eq("status", "live")
      .or("partner_status.is.null,partner_status.eq.declined")
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了,請重新整理再試一次");
    return claimed[0];
  }

  async function respondAuctionPartner(lotId, playerId, accept) {
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.partner_status !== "pending" || lot.partner_b_id !== playerId) throw new Error("沒有邀請你合夥這一波");
    const { data: updated, error } = await client
      .from("auction_lots")
      .update({ partner_status: accept ? "accepted" : "declined" })
      .eq("id", lotId)
      .eq("partner_status", "pending")
      .select();
    if (error) throw error;
    if (!updated || !updated.length) throw new Error("手慢了,請重新整理再試一次");
    return updated[0];
  }

  async function cancelAuctionPartner(lotId, playerId) {
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.partner_status !== "pending" || (lot.partner_a_id !== playerId && lot.partner_b_id !== playerId)) {
      throw new Error("沒有可以取消的合夥邀請");
    }
    const { error } = await client
      .from("auction_lots")
      .update({ partner_status: null, partner_a_id: null, partner_b_id: null })
      .eq("id", lotId)
      .eq("partner_status", "pending");
    if (error) throw error;
  }

  // ---------- 猜價小遊戲 ----------
  async function submitAuctionPriceGuess(lotId, eventId, playerId, guess) {
    const amount = Math.floor(guess);
    if (!Number.isFinite(amount) || amount < 0) throw new Error("請輸入合理的金額");
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("status").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.status !== "live") throw new Error("這件商品現在不是拍賣中");
    const { error } = await client.from("auction_price_guesses").insert({ lot_id: lotId, event_id: eventId, player_id: playerId, guess: amount });
    if (error) {
      if (error.code === "23505") throw new Error("這件你已經猜過了");
      throw error;
    }
  }

  async function listMyAuctionPriceGuesses(eventId, playerId) {
    const { data, error } = await client.from("auction_price_guesses").select("*").eq("event_id", eventId).eq("player_id", playerId);
    if (error) throw error;
    return data || [];
  }

  // 老闆招待券:直接把一件「拍賣中的普通級商品」免費送給這位玩家,結標流程走跟一般結標同一套
  // finalizeAuctionLot(參與退補等邏輯都一致),只是 finalPrice 固定是 0。
  async function useAuctionFreeCommonTicket(lotId, eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.freeCommon || effects.freeCommon < 1) throw new Error("你沒有老闆招待券");
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.status !== "live") throw new Error("這件商品現在不是拍賣中");
    if (lot.item_tier !== "common") throw new Error("招待券只能兌換「普通」級商品");
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ status: "done", current_bidder_id: playerId, current_price: 0 })
      .eq("id", lotId)
      .eq("status", "live")
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了,這件商品剛結標了");
    const nextEffects = { ...effects, freeCommon: effects.freeCommon - 1 };
    const { error: partErr } = await client.from("auction_participants").update({ effects: nextEffects }).eq("id", part.id);
    if (partErr) throw partErr;
    await finalizeAuctionLot(claimed[0], playerId, 0);
    return claimed[0];
  }

  // 主辦人結束活動:結算名次,套用現有的獎勵設定(reward_plan)自動填獎勵。
  async function closeAuctionEvent(eventId) {
    const ev = await getEvent(eventId);
    const standings = await computeAuctionStandings(eventId);
    for (let i = 0; i < standings.length; i++) {
      const rank = i + 1;
      const row = standings[i];
      await client
        .from("auction_participants")
        .update({ final_rank: rank, reward: row.participant.reward || rewardForRank(ev, rank) })
        .eq("id", row.participant.id);
    }
    await setEventStatus(eventId, "closed");
    return standings;
  }

  // 主辦人手動覆蓋某位拍賣參加者的獎勵文字(結束活動時 closeAuctionEvent 已經自動套用一次,
  // 這個函式讓主辦人事後還能個別修改)
  async function setAuctionReward(participantId, reward) {
    const { error } = await client
      .from("auction_participants")
      .update({ reward })
      .eq("id", participantId);
    if (error) throw error;
  }

  function onTableChange(table, filter, cb) {
    const channel = client
      .channel(`${table}-${filter || "all"}-${Math.random()}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, cb)
      .subscribe();
    return () => client.removeChannel(channel);
  }

  // ---------- 贊助名單 ----------
  // 主辦人可以自己開好幾份獨立的「贊助名單」(跟活動 events 完全無關),每份名單自己取名字。
  // 贊助者(sponsors)底下掛的是一筆一筆的「贊助獎勵項目」(sponsor_rewards),
  // 同一位贊助者(同一份名單內、名字視為同一人)每次贊助都是新的一批 sponsor_rewards,
  // 用同一個 entry_id 分組,前台/後台顯示時把同一位贊助者底下所有項目依「獎勵名稱」加總,
  // 不會因為前台合併顯示就把原始紀錄刪掉。
  // listSponsorLists() 依建立時間新到舊排序,呼叫端把第一筆當「最新贊助名單」顯示,其餘當「歷史贊助名單」。
  // 注意:sponsor_rewards 是雙層巢狀(sponsor_lists → sponsors → sponsor_rewards),
  // PostgREST 對雙層巢狀資源的排序不支援用 foreignTable 直接指定,之前多加的那行排序
  // 會讓整個查詢直接失敗(前台/後台因此整份名單看起來像「消失了」,其實資料庫資料都還在)。
  // sponsor_rewards 的顯示順序改成抓回來後在前端排序(groupSponsorEntries 已經有做),這裡不用排。
  // onlyVisible = true 時只抓 visible = true 的名單(前台用,隱藏的名單完全不會出現);
  // 後台管理要看到全部名單(含隱藏的)才能切換顯示/隱藏,呼叫時不傳這個參數。
  async function listSponsorLists({ onlyVisible = false } = {}) {
    let query = client
      .from("sponsor_lists")
      .select("*, sponsors(*, sponsor_rewards(*))")
      .order("created_at", { ascending: false })
      .order("sort_order", { ascending: true, foreignTable: "sponsors" })
      .order("created_at", { ascending: true, foreignTable: "sponsors" });
    if (onlyVisible) query = query.eq("visible", true);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  // 新建立的名單預設「隱藏」,避免主辦人只是先開一份下一次活動的草稿名單,
  // 就因為建立時間比較新而立刻搶走前台「最新贊助名單/本次活動」的位置,把還在進行的活動名單推進歷史。
  // 準備好要公開時,後台手動切成「顯示於前台」即可。
  async function addSponsorList(name) {
    const { data, error } = await client.from("sponsor_lists").insert({ name, visible: false }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateSponsorList(id, name) {
    const { error } = await client.from("sponsor_lists").update({ name }).eq("id", id);
    if (error) throw error;
  }

  // 切換某份贊助名單是否顯示於前台;隱藏後只是前台不顯示,後台資料與統計都保留,不會刪除任何紀錄。
  async function setSponsorListVisible(id, visible) {
    const { error } = await client.from("sponsor_lists").update({ visible: !!visible }).eq("id", id);
    if (error) throw error;
  }

  async function deleteSponsorList(id) {
    const { error } = await client.from("sponsor_lists").delete().eq("id", id);
    if (error) throw error;
  }

  // 新增一筆贊助:rewards 是 [{ name, qty }, ...]。
  // 同一份名單內如果已經有同名贊助者(去頭尾空白、不分大小寫比對),就沿用同一個 sponsors 列,
  // 不會另外新增一筆重複顯示的贊助者;這次贊助的獎勵項目用新的 entry_id 分組寫進 sponsor_rewards。
  async function addSponsorEntry(listId, name, rewards) {
    const cleanName = (name || "").trim();
    const cleanRewards = (rewards || [])
      .map((r) => ({ name: (r.name || "").trim(), qty: Number(r.qty) }))
      .filter((r) => r.name && Number.isFinite(r.qty) && r.qty > 0);
    if (!cleanName) throw new Error("缺少贊助者名稱");
    if (!cleanRewards.length) throw new Error("至少要填一項獎勵名稱跟數量");

    const { data: existing, error: findErr } = await client
      .from("sponsors")
      .select("*")
      .eq("sponsor_list_id", listId)
      .ilike("name", cleanName);
    if (findErr) throw findErr;

    let sponsor = (existing || []).find((s) => s.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (!sponsor) {
      const { count, error: countErr } = await client
        .from("sponsors")
        .select("id", { count: "exact", head: true })
        .eq("sponsor_list_id", listId);
      if (countErr) throw countErr;
      const { data: created, error: insErr } = await client
        .from("sponsors")
        .insert({ sponsor_list_id: listId, name: cleanName, sort_order: count || 0 })
        .select()
        .single();
      if (insErr) throw insErr;
      sponsor = created;
    }

    const entryId = window.crypto && window.crypto.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
    const rows = cleanRewards.map((r) => ({
      sponsor_id: sponsor.id,
      entry_id: entryId,
      reward_name: r.name,
      qty: r.qty,
    }));
    const { error: rewardErr } = await client.from("sponsor_rewards").insert(rows);
    if (rewardErr) throw rewardErr;
    return sponsor;
  }

  // 刪除某位贊助者「這一次」的贊助紀錄(同一個 entry_id 底下的所有獎勵項目),不影響其他次紀錄。
  async function deleteSponsorEntry(entryId) {
    const { error } = await client.from("sponsor_rewards").delete().eq("entry_id", entryId);
    if (error) throw error;
  }

  // 整筆刪除這位贊助者(連同他底下所有次的贊助紀錄)。
  async function deleteSponsor(id) {
    const { error } = await client.from("sponsors").delete().eq("id", id);
    if (error) throw error;
  }

  // 改贊助者名稱。跟新增贊助時一樣,同一份名單內名字不分大小寫比對,
  // 避免改成跟同名單裡另一位贊助者一樣的名字,前台顯示時卻分不出是哪一位。
  async function updateSponsorName(id, name) {
    const cleanName = (name || "").trim();
    if (!cleanName) throw new Error("名稱不能空白");

    const { data: current, error: curErr } = await client.from("sponsors").select("sponsor_list_id").eq("id", id).single();
    if (curErr) throw curErr;

    const { data: existing, error: findErr } = await client
      .from("sponsors")
      .select("id, name")
      .eq("sponsor_list_id", current.sponsor_list_id)
      .ilike("name", cleanName);
    if (findErr) throw findErr;

    const dup = (existing || []).find((s) => s.id !== id && s.name.trim().toLowerCase() === cleanName.toLowerCase());
    if (dup) throw new Error(`這份名單裡已經有「${dup.name}」了,換一個名字,或直接把紀錄改到那位贊助者底下`);

    const { error } = await client.from("sponsors").update({ name: cleanName }).eq("id", id);
    if (error) throw error;
  }

  // 改單筆贊助紀錄裡的「一項獎勵」(reward_name + qty)。用 sponsor_rewards 的列 id 精準指定,
  // 只改這一列,同一次贊助(entry_id)底下其他獎勵項目、以及其他次贊助紀錄都不受影響。
  async function updateSponsorReward(rewardId, { name, qty }) {
    const cleanName = (name || "").trim();
    const cleanQty = Number(qty);
    if (!cleanName) throw new Error("獎勵名稱不能空白");
    if (!Number.isFinite(cleanQty) || cleanQty <= 0) throw new Error("數量要是大於 0 的數字");
    const { error } = await client.from("sponsor_rewards").update({ reward_name: cleanName, qty: cleanQty }).eq("id", rewardId);
    if (error) throw error;
  }

  // 把一群贊助者(sponsors,每個帶著自己的 sponsor_rewards)依「獎勵名稱」加總,
  // 回傳依第一次出現順序排列的 [{ name, qty }, ...]。用來算單一贊助者總額、
  // 單份名單總額、或跨所有名單的全部活動累積總額(呼叫端自己決定要傳哪個範圍的 sponsors)。
  function aggregateRewardTotals(sponsors) {
    const totals = new Map();
    const order = [];
    (sponsors || []).forEach((sp) => {
      (sp.sponsor_rewards || []).forEach((r) => {
        const key = r.reward_name;
        if (!totals.has(key)) {
          totals.set(key, 0);
          order.push(key);
        }
        totals.set(key, totals.get(key) + Number(r.qty || 0));
      });
    });
    return order.map((name) => ({ name, qty: totals.get(name) }));
  }

  // 把單一贊助者底下的 sponsor_rewards 依 entry_id(同一次贊助)分組,新到舊排序,
  // 回傳 [{ entryId, createdAt, items: [{ reward_name, qty }, ...] }, ...]。
  function groupSponsorEntries(sponsor) {
    const map = new Map();
    (sponsor.sponsor_rewards || []).forEach((r) => {
      if (!map.has(r.entry_id)) {
        map.set(r.entry_id, { entryId: r.entry_id, createdAt: r.created_at, items: [] });
      }
      map.get(r.entry_id).items.push(r);
    });
    return Array.from(map.values()).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
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

  // ---------- 公告 ----------
  // 首頁抓「最新一則」當精選公告(hero),其餘依時間新到舊排序丟進「更多公告」收合區。
  async function listAnnouncements() {
    const { data, error } = await client.from("announcements").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  async function addAnnouncement(fields) {
    const { data, error } = await client
      .from("announcements")
      .insert({
        type: fields.type,
        title: fields.title,
        subtitle: fields.subtitle || null,
        body: fields.body || null,
        image_url: fields.imageUrl || null,
        cta_text: fields.ctaText || null,
        cta_link: fields.ctaLink || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function updateAnnouncement(id, fields) {
    const { error } = await client
      .from("announcements")
      .update({
        type: fields.type,
        title: fields.title,
        subtitle: fields.subtitle || null,
        body: fields.body || null,
        image_url: fields.imageUrl || null,
        cta_text: fields.ctaText || null,
        cta_link: fields.ctaLink || null,
      })
      .eq("id", id);
    if (error) throw error;
  }

  async function deleteAnnouncement(id) {
    const { error } = await client.from("announcements").delete().eq("id", id);
    if (error) throw error;
  }

  // file 是 <input type="file"> 選出來的檔案,回傳可以直接存進 announcements.image_url 的公開網址
  async function uploadAnnouncementImage(file) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await client.storage.from("announcement-images").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = client.storage.from("announcement-images").getPublicUrl(path);
    return data.publicUrl;
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
    listSponsorLists,
    addSponsorList,
    updateSponsorList,
    setSponsorListVisible,
    deleteSponsorList,
    addSponsorEntry,
    deleteSponsorEntry,
    deleteSponsor,
    updateSponsorName,
    updateSponsorReward,
    aggregateRewardTotals,
    groupSponsorEntries,
    getSiteSetting,
    setSiteSetting,
    listAnnouncements,
    addAnnouncement,
    updateAnnouncement,
    deleteAnnouncement,
    uploadAnnouncementImage,
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
    joinAuctionEvent,
    getMyAuctionParticipant,
    listAuctionParticipants,
    listAuctionLots,
    startAuction,
    activateDueAuctionLots,
    settleExpiredAuctionLots,
    placeAuctionBid,
    workForAuctionCoins,
    listAuctionTasks,
    activateDueAuctionTasks,
    settleExpiredAuctionTasks,
    answerAuctionTask,
    listMyAuctionTaskAnswers,
    placeAuctionLuckyBet,
    useAuctionIntelTicket,
    useAuctionPriorityTicket,
    useAuctionRefundTicket,
    useAuctionBoxDoubleTicket,
    useAuctionFreeCommonTicket,
    inviteAuctionPartner,
    respondAuctionPartner,
    cancelAuctionPartner,
    submitAuctionPriceGuess,
    listMyAuctionPriceGuesses,
    computeAuctionStandings,
    closeAuctionEvent,
    setAuctionReward,
  };
})();
