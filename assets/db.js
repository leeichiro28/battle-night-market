// 共用資料庫工具。所有頁面都會載入這個檔案。
const db = (function () {
  const client = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  // ---------- 玩家身份 ----------
  function getLocalPlayer() {
    return {
      id: localStorage.getItem("player_id") || null,
      name: localStorage.getItem("player_name") || "",
    };
  }

  async function ensurePlayer(name) {
    const local = getLocalPlayer();
    if (local.id) {
      if (name && name !== local.name) {
        await client.from("players").update({ name }).eq("id", local.id);
        localStorage.setItem("player_name", name);
      }
      return { id: local.id, name: name || local.name };
    }
    const { data, error } = await client
      .from("players")
      .insert({ name })
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

  async function createEvent(name, gameType, losersBracket, rules, registrationDeadline) {
    const { data, error } = await client
      .from("events")
      .insert({
        name,
        game_type: gameType,
        losers_bracket: !!losersBracket,
        rules: rules || {},
        registration_deadline: registrationDeadline || null,
      })
      .select()
      .single();
    if (error) throw error;
    return data;
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

  function diceInitState(fieldMod) {
    return {
      hp1: 12,
      hp2: 12,
      round: 1,
      shield1: 1,
      shield2: 1,
      rage1: 0,
      rage2: 0,
      rageready1: false,
      rageready2: false,
      freebet1: 0,
      freebet2: 0,
      field_mod: fieldMod || null,
      log: [],
    };
  }

  function rps5InitState() {
    return { hp1: 10, hp2: 10, round: 1, ult1: false, ult2: false, log: [] };
  }

  function makeInitState(gameType, rules) {
    let fieldMod = null;
    if (gameType === "dice" && rules && rules.field_mod) {
      fieldMod = Math.random() < 0.5 ? "crit" : "shield_plus";
    }
    const state = gameType === "dice" ? diceInitState(fieldMod) : rps5InitState();
    if (gameType === "dice" && fieldMod === "shield_plus") {
      state.shield1 = 2;
      state.shield2 = 2;
    }
    return state;
  }

  async function lockAndGenerateBracket(eventId) {
    const ev = await getEvent(eventId);
    const parts = await listParticipants(eventId);
    const entrants = parts.filter((p) => p.status !== "eliminated");
    if (entrants.length < 2) throw new Error("至少需要 2 人才能開賽");

    const size = nextPow2(entrants.length);
    const seeded = shuffle(entrants);
    while (seeded.length < size) seeded.push(null);

    const rounds = Math.log2(size);
    const allMatches = [];
    let prevRound = [];

    for (let i = 0; i < size / 2; i++) {
      const a = seeded[i * 2];
      const b = seeded[i * 2 + 1];
      const m = {
        id: crypto.randomUUID(),
        event_id: eventId,
        bracket: "winners",
        round: 1,
        slot: i,
        player1_id: a ? a.player_id : null,
        player2_id: b ? b.player_id : null,
        status: "active",
        state: makeInitState(ev.game_type, ev.rules),
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
          status: "pending",
          state: makeInitState(ev.game_type, ev.rules),
        };
        if (m.player1_id && m.player2_id) m.status = "active";
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
        if (m.status === "active") {
          await client
            .from("event_participants")
            .update({ status: "matched", match_id: m.id })
            .eq("id", side.id);
        } else {
          const nm = findById(m.next_match_id);
          await client
            .from("event_participants")
            .update({
              status: nm && nm.status === "active" ? "matched" : "pending",
              match_id: m.next_match_id || null,
            })
            .eq("id", side.id);
        }
      }
    }

    await client
      .from("events")
      .update({ locked: true, status: "running" })
      .eq("id", eventId);
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

  // 一場對戰結束後的晉級/淘汰/敗部/總冠軍賽路由邏輯
  async function advanceAfterMatch(match, winnerId, loserId) {
    await client
      .from("matches")
      .update({ status: "done", winner_id: winnerId })
      .eq("id", match.id);

    const eventId = match.event_id;
    const ev = await getEvent(eventId);
    const winnerPart = await getMyParticipant(eventId, winnerId);
    const loserPart = await getMyParticipant(eventId, loserId);
    const now = new Date().toISOString();

    if (match.bracket === "final") {
      await client
        .from("event_participants")
        .update({ status: "eliminated", eliminated_at: now, final_rank: 2 })
        .eq("id", loserPart.id);
      await client
        .from("event_participants")
        .update({ status: "champion", final_rank: 1 })
        .eq("id", winnerPart.id);
      await setEventStatus(eventId, "closed");
      return;
    }

    if (match.bracket === "winners") {
      if (match.next_match_id) {
        const slotField = match.next_slot === 1 ? "player1_id" : "player2_id";
        const { data: nm, error } = await client
          .from("matches")
          .update({ [slotField]: winnerId })
          .eq("id", match.next_match_id)
          .select()
          .single();
        if (error) throw error;
        const bothFilled = !!(nm.player1_id && nm.player2_id);
        if (bothFilled) {
          await client.from("matches").update({ status: "active" }).eq("id", nm.id);
        }
        await client
          .from("event_participants")
          .update({ status: bothFilled ? "matched" : "pending", match_id: nm.id })
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
          .update({ status: "champion", final_rank: 1, match_id: null })
          .eq("id", winnerPart.id);
        await setEventStatus(eventId, "closed");
      }

      if (ev.losers_bracket) {
        await client
          .from("event_participants")
          .update({ status: "waiting", bracket: "losers", match_id: null })
          .eq("id", loserPart.id);
        await tryMatch(eventId, ev.game_type, "losers");
      } else {
        await client
          .from("event_participants")
          .update({ status: "eliminated", eliminated_at: now })
          .eq("id", loserPart.id);
      }
      return;
    }

    if (match.bracket === "losers") {
      await client
        .from("event_participants")
        .update({ status: "eliminated", eliminated_at: now })
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
        await tryMatch(eventId, ev.game_type, "losers");
      }
    }
  }

  function onTableChange(table, filter, cb) {
    const channel = client
      .channel(`${table}-${filter || "all"}-${Math.random()}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, cb)
      .subscribe();
    return () => client.removeChannel(channel);
  }

  return {
    client,
    getLocalPlayer,
    ensurePlayer,
    listEvents,
    getEvent,
    createEvent,
    setEventStatus,
    joinEvent,
    getMyParticipant,
    listParticipants,
    listMatches,
    setReward,
    lockAndGenerateBracket,
    tryMatch,
    getMatch,
    updateMatchState,
    submitMove,
    tryCreateGrandFinal,
    advanceAfterMatch,
    onTableChange,
  };
})();
