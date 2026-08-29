// 共用資料庫工具。所有頁面都會載入這個檔案。
const db = (function () {
  const client = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY
  );

  // ---------- 資料抓取層:in-flight 去重 + 短期快取 + 可取消 ----------
  // 只套用在「讀」的查詢函式，不套用在 insert/update/delete 這類寫入——寫入每次都必須真的送出，
  // 不能被去重或快取掉，語意上也不安全(例如兩次出價金額不同，不該被當成同一份請求)。
  // key 由呼叫端自己組(通常是「函式名:參數」)，同一個 key 在 ttlMs 內重複呼叫會直接複用結果，
  // 同一個 key 短時間內被平行呼叫多次(例如好幾個 realtime 事件幾乎同時觸發、debounce 還沒來得及合併)
  // 也只會真的發一次請求出去，其他呼叫端等同一個 promise。
  const _cacheStore = new Map(); // key -> { at, value }
  const _inflightStore = new Map(); // key -> Promise
  const _abortStore = new Map(); // key -> AbortController(給 fetcher 需要取消上一個請求時用)

  function _cachedFetch(key, ttlMs, fetcher) {
    const cached = _cacheStore.get(key);
    if (cached && Date.now() - cached.at < ttlMs) {
      return Promise.resolve(cached.value);
    }
    const existing = _inflightStore.get(key);
    if (existing) return existing;
    const controller = new AbortController();
    _abortStore.set(key, controller);
    const p = Promise.resolve()
      .then(() => fetcher(controller.signal))
      .then((value) => {
        _cacheStore.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        _inflightStore.delete(key);
        _abortStore.delete(key);
      });
    _inflightStore.set(key, p);
    return p;
  }

  // 寫入成功後呼叫，把跟這筆寫入相關的快取清掉，避免下一次讀到還沒更新的舊快取。
  // prefix 用「函式名:」這種前綴比對，例如 invalidateCache("listAuctionLots:") 會清掉所有
  // listAuctionLots 不管帶什麼參數的快取。不傳 prefix 就是全部清空(斷線重連補快照那種情境會用到)。
  function invalidateCache(prefix) {
    for (const k of _cacheStore.keys()) {
      if (!prefix || k.startsWith(prefix)) _cacheStore.delete(k);
    }
  }

  // 離開頁面(beforeunload)或要整個重新初始化時呼叫:把還在飛的請求全部取消掉，
  // 不然使用者可能已經切走頁面了，舊請求回來時又去更新一個沒人在看的畫面/寫入過期的快取。
  function cancelAllRequests() {
    for (const controller of _abortStore.values()) {
      try {
        controller.abort();
      } catch (e) {}
    }
    _abortStore.clear();
    _inflightStore.clear();
  }

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

  // 頁面上任何地方偵測到登入狀態改變(登入完成/登出)都會呼叫 cb，回傳值是取消訂閱用的函式
  function onAuthChange(cb) {
    const { data } = client.auth.onAuthStateChange((_event, session) => cb(session));
    return () => data.subscription.unsubscribe();
  }

  // 導去 Discord 授權頁，授權完成後會被導回同一頁(帶著登入狀態)
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

  // 用 Discord 使用者名稱當暱稱，player 的 id 直接用 Discord 登入的 auth user id(每個 Discord 帳號對應唯一一筆 players 資料)
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
    // 這個函式常常被同一個頁面上好幾個獨立模組同時呼叫(例如 header.js 的帳號區塊、
    // 加上頁面本身各自的登入流程)，實測發現同一個玩家會在幾百毫秒內被查兩三次。
    // 包進 _cachedFetch 讓這些同時發生的呼叫合併成一次真正的請求。
    return _cachedFetch(`ensurePlayerFromSession:${session.user.id}`, 3000, async (signal) => {
      const { data: existing, error: readErr } = await client
        .from("players")
        .select("*")
        .abortSignal(signal)
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
    });
  }

  // ---------- 活動 ----------
  async function listEvents() {
    return _cachedFetch("listEvents:", 800, async (signal) => {
      const { data, error } = await client
        .from("events")
        .select("*")
        .abortSignal(signal)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    });
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

  // 讀取活動，活動不存在(例如已被刪除)時回傳 null 而不是丟出錯誤，方便頁面顯示友善訊息
  async function getEventSafe(eventId) {
    const { data, error } = await client
      .from("events")
      .select("*")
      .eq("id", eventId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // 讀取對戰，對戰不存在(例如所屬活動已被刪除)時回傳 null 而不是丟出錯誤
  async function getMatchSafe(matchId) {
    const { data, error } = await client
      .from("matches")
      .select("*, p1:player1_id(name, is_bot), p2:player2_id(name, is_bot)")
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

  // ---------- 跨場永久系統(Phase 0):稱號與歷史統計 ----------
  // 這裡的東西全部只是「顯示用的紀錄」，不會讓下一場活動的起始數值有任何差異，
  // 有稱號的老手跟第一次參加的新人，下一場開局站在同一條起跑線。
  //
  // titles 的判定條件目前先接骰子/五手勢對戰(錦標賽制)、夜市拍賣這兩種現有玩法，
  // 之後職業養成對決上線後，直接往 lifetime_stats 這個 jsonb 加新的累計欄位、
  // TITLE_CATALOG 加新的稱號定義就好，不用改資料表結構。
  const TITLE_CATALOG = [
    { key: "first_championship", name: "初登王座", desc: "第一次拿下某場活動冠軍", icon: "crown" },
    { key: "triple_champion", name: "三連霸", desc: "累積拿下 3 次活動冠軍", icon: "crown" },
    { key: "flawless_champion", name: "不敗戰神", desc: "拿下冠軍的那場賽事，全程沒有輸掉任何一場對戰", icon: "shield-check" },
    { key: "high_roller", name: "散盡家財的賭徒", desc: "夜市拍賣結束時，財神幣幾乎花光", icon: "coins" },
    { key: "auction_tycoon", name: "夜市大戶", desc: "夜市拍賣拿下第一名", icon: "gem" },
    { key: "career_champion", name: "夜市擂台之王", desc: "職業養成對決積分排行拿下第一名", icon: "crown" },
    { key: "tower_conqueror", name: "爬塔霸主", desc: "本場已經爬完目前開放的所有樓層", icon: "mountain" },
  ];

  async function getOrCreatePlayerProfile(playerId) {
    const { data, error } = await client.from("player_profiles").select("*").eq("player_id", playerId).maybeSingle();
    if (error) throw error;
    if (data) return data;
    const { data: created, error: createErr } = await client
      .from("player_profiles")
      .insert({ player_id: playerId, titles: [], lifetime_stats: {} })
      .select()
      .single();
    if (createErr) throw createErr;
    return created;
  }

  async function getPlayerProfile(playerId) {
    const { data, error } = await client.from("player_profiles").select("*").eq("player_id", playerId).maybeSingle();
    if (error) throw error;
    return data;
  }

  // 批次查詢多個玩家的檔案(例如排行榜要一次顯示所有人的稱號)，比一列一列各自查快很多。
  // 回傳一個 { [playerId]: profile } 的物件方便查找，沒有檔案的玩家不會出現在物件裡。
  async function getPlayerProfiles(playerIds) {
    const ids = [...new Set(playerIds || [])].filter(Boolean);
    if (!ids.length) return {};
    const { data, error } = await client.from("player_profiles").select("*").in("player_id", ids);
    if (error) throw error;
    const map = {};
    (data || []).forEach((p) => (map[p.player_id] = p));
    return map;
  }

  // 幫玩家解鎖幾個稱號、疊加幾筆累計數字。一場活動結束只會呼叫這裡一次(不是高併發場景)，
  // 所以用普通的讀出來改一改寫回去就夠，不用比照夜市拍賣財神幣那樣特別做原子加減。
  async function grantTitleAndStats(playerId, titleKeys, statPatch) {
    const profile = await getOrCreatePlayerProfile(playerId);
    const titleSet = new Set(profile.titles || []);
    const hadNoTitlesBefore = titleSet.size === 0;
    let changed = false;
    (titleKeys || []).forEach((k) => {
      if (!titleSet.has(k)) {
        titleSet.add(k);
        changed = true;
      }
    });
    const stats = { ...(profile.lifetime_stats || {}) };
    Object.entries(statPatch || {}).forEach(([k, delta]) => {
      stats[k] = (stats[k] || 0) + delta;
      changed = true;
    });
    if (!changed) return profile;
    const updates = { titles: [...titleSet], lifetime_stats: stats, updated_at: new Date().toISOString() };
    // 人生第一次拿到稱號的話，順手幫他預設掛上，不用讓玩家一定要自己先手動去設定過一次
    // 才看得到稱號顯示在名字旁邊。
    if (!profile.display_title && hadNoTitlesBefore && titleSet.size > 0) {
      updates.display_title = [...titleSet][0];
    }
    const { data, error } = await client.from("player_profiles").update(updates).eq("player_id", playerId).select().single();
    if (error) throw error;
    return data;
  }

  async function setDisplayTitle(playerId, titleKey) {
    const profile = await getOrCreatePlayerProfile(playerId);
    if (titleKey && !(profile.titles || []).includes(titleKey)) throw new Error("這個稱號還沒解鎖");
    const { error } = await client.from("player_profiles").update({ display_title: titleKey || null }).eq("player_id", playerId);
    if (error) throw error;
  }

  // 錦標賽(骰子/五手勢對戰)拿到冠軍時呼叫:算這場有沒有全勝、累計奪冠次數、檢查稱號。
  async function awardTournamentChampionTitles(eventId, championPlayerId) {
    const { data: matches, error } = await client
      .from("matches")
      .select("player1_id, player2_id, winner_id")
      .eq("event_id", eventId)
      .or(`player1_id.eq.${championPlayerId},player2_id.eq.${championPlayerId}`);
    if (error) throw error;
    const playedAny = matches && matches.length > 0;
    const lostAny = (matches || []).some((m) => m.winner_id && m.winner_id !== championPlayerId);
    const profile = await getOrCreatePlayerProfile(championPlayerId);
    const totalChampionships = ((profile.lifetime_stats || {}).total_championships || 0) + 1;
    const titleKeys = ["first_championship"];
    if (totalChampionships >= 3) titleKeys.push("triple_champion");
    if (playedAny && !lostAny) titleKeys.push("flawless_champion");
    await grantTitleAndStats(championPlayerId, titleKeys, { total_championships: 1 });
  }

  // 夜市拍賣結束時呼叫:檢查散盡家財、拍賣大戶這兩個稱號。standings 直接沿用 closeAuctionEvent
  // 裡已經算好的那份，不用重算一次。
  async function awardAuctionTitles(eventId, standings) {
    if (!standings || !standings.length) return;
    const ev = await getEvent(eventId);
    const startingBudget = (ev.rules && ev.rules.startingBudget) || AUCTION_DEFAULT_BUDGET;
    for (let i = 0; i < standings.length; i++) {
      const row = standings[i];
      const titleKeys = [];
      if (row.participant.coins <= startingBudget * 0.05) titleKeys.push("high_roller");
      if (i === 0) titleKeys.push("auction_tycoon");
      if (titleKeys.length) await grantTitleAndStats(row.participant.player_id, titleKeys, {});
    }
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

  // 主辦人一個人測試對戰用:建一個標記成 is_bot 的假玩家、直接幫他報名這場活動。
  // 之後配對到真人時，對手那邊的 checkEntryTimeout 偵測到對面是機器人，會跳過原本給真人
  // 用的60秒等待猶豫期，改成幾秒後就直接開始代打，讓主辦人不用真的找第二個人也能跑完整場流程。
  async function addTestBot(eventId, name) {
    const botName = name || `🤖 測試機器人 ${Math.floor(Math.random() * 1000)}`;
    const { data: player, error: playerErr } = await client
      .from("players")
      .insert({ name: botName, is_bot: true })
      .select()
      .single();
    if (playerErr) throw playerErr;
    const participant = await joinEvent(eventId, player.id);
    return { player, participant };
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
      .select("*, players(name, is_bot)")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return data;
  }

  async function listMatches(eventId) {
    return _cachedFetch(`listMatches:${eventId}`, 500, async (signal) => {
      const { data, error } = await client
        .from("matches")
        .select("*, p1:player1_id(name, is_bot), p2:player2_id(name, is_bot)")
        .abortSignal(signal)
        .eq("event_id", eventId)
        .order("round", { ascending: true });
      if (error) throw error;
      return data;
    });
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

  // 對手超過1分鐘沒有進入對戰畫面時，在戰報加一行系統公告(用來提示接下來會自動幫對手出招)
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

  // ---------- 賽程樹產生(勝部，依人數自動算輪空) ----------
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
    // BO5:games1/games2 是系列賽目前局數比分，先取得3局的一方贏得整場對戰;
    // game 是目前打到系列賽第幾局，round 則是「這一局」裡的回合數(每局重打會歸1)。
    // ult1/ult2 是這一局已經用掉幾次究極手勢(數字，不是布林值)，
    // 一般情況上限1次，若開了「手速戰場」場地規則，該局上限會變成2次。
    return { hp1: 15, hp2: 15, round: 1, game: 1, games1: 0, games2: 0, ult1: 0, ult2: 0, log: [] };
  }

  function makeInitState(gameType) {
    return gameType === "dice" ? diceInitState() : rps5InitState();
  }


  async function lockAndGenerateBracket(eventId) {
    const ev = await getEvent(eventId);
    const parts = await listParticipants(eventId);
    const entrants = parts.filter((p) => p.status !== "eliminated");
    if (entrants.length < 2) throw new Error("至少需要 2 人才能開賽");

    // 人數太少時敗部復活賽意義不大，自動關閉，單敗淘汰就好
    let losersBracketDowngraded = false;
    if (ev.losers_bracket && entrants.length < 6) {
      losersBracketDowngraded = true;
      await client.from("events").update({ losers_bracket: false }).eq("id", eventId);
      ev.losers_bracket = false;
    }

    const size = nextPow2(entrants.length);
    const byes = size - entrants.length;
    const shuffled = shuffle(entrants);

    // 把輪空平均分散配對，每個輪空都各自配一位真人，絕對不會出現「輪空 vs 輪空」
    // (以前的寫法是輪空全部塞在陣列最後面，只要輪空數 >=2 一定會湊出一組雙輪空，導致該場沒有勝負、後面卡死)
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
        status: "pending", // 不立刻開打，交給 activateNextMatch 一場一場排隊啟動
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
          status: "pending", // 不立刻開打，交給 activateNextMatch 一場一場排隊啟動
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

    // 原本是每個參賽者各自發一次 update(N個人就N次來回)，改成先在記憶體組好整批要寫的內容，
    // 一次 upsert(用 id 當衝突鍵，效果等同「依 id 逐筆更新」，但只需要1次網路來回)。
    const participantUpdates = [];
    for (const m of allMatches.filter((m) => m.round === 1)) {
      for (const side of [m._pa, m._pb]) {
        if (!side) continue;
        // 輪空:直接晉級到下一場，但一樣要排隊等 activateNextMatch 叫到才開打
        const matchId = m.status === "done" ? m.next_match_id || null : m.id;
        participantUpdates.push({ id: side.id, status: "pending", match_id: matchId });
      }
    }
    if (participantUpdates.length) {
      const { error: partUpdErr } = await client.from("event_participants").upsert(participantUpdates, { onConflict: "id" });
      if (partUpdErr) throw partUpdErr;
    }

    await client
      .from("events")
      .update({ locked: true, status: "running" })
      .eq("id", eventId);

    // 排好整個賽程後，只啟動第一場對戰，其他人在等候室排隊等叫號
    await activateNextMatch(eventId);

    return { losersBracketDowngraded };
  }

  // 一場一場來:整個活動同一時間只讓一場對戰進行中。
  // 每次有對戰結束(或有新玩家掉入敗部候位區)就呼叫這個函式。
  // 實際的「查有沒有 active 場次→挑下一場→啟動」全部改放到 Postgres 的 activate_next_match RPC 裡原子執行
  // (見 supabase-schema.sql)，不要在這裡用 select 再 update 兩步做，兩步中間沒有原子性保證，
  // 兩個玩家幾乎同時打完各自的對戰時會兩邊都查到「沒有 active」然後各自啟動一場，導致同時開兩場對戰的 bug。
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
  // 依遊戲類型算出「直接判一方獲勝」該怎麼改 state:
  //  - dice 是純 HP 制單局對戰，把敗方 HP 打到 0，畫面本來就是看 hp<=0 判定結束。
  //  - rps5 是 BO3(一般場)/BO5(bracket==="final")系列賽制，畫面看的是 seriesDecided()，
  //    也就是 games1/games2 有沒有到達門檻——只把 HP 歸零不會被判定系列賽結束，
  //    畫面會停在對戰中卡住不跳轉，所以要直接把贏家的局數推到達標局數。
  //    門檻算法要跟 rps5.js 的 gamesToWin() 保持一致，改其中一邊記得同步改另一邊。
  function forfeitStatePatch(gameType, match, state, winnerIsP1, reason, logMessage) {
    const log = [...(state.log || []), logMessage];
    if (gameType === "dice") {
      return {
        ...state,
        hp1: winnerIsP1 ? state.hp1 : 0,
        hp2: winnerIsP1 ? 0 : state.hp2,
        forfeitReason: reason,
        log,
      };
    }
    const winsNeeded = match && match.bracket === "final" ? 3 : 2;
    return {
      ...state,
      games1: winnerIsP1 ? winsNeeded : state.games1 || 0,
      games2: winnerIsP1 ? state.games2 || 0 : winsNeeded,
      forfeitReason: reason,
      log,
    };
  }

  // 主辦後台「卡住了嗎?強制判定勝負」用的入口:先把 state 改成「已分出勝負」
  // (依遊戲類型走 forfeitStatePatch)，玩家畫面才會偵測到並自動跳轉，
  // 再呼叫 advanceAfterMatch 走正常的賽程晉級流程。
  async function forceMatchWin(match, winnerId, loserId) {
    const ev = await getEvent(match.event_id);
    const winnerIsP1 = winnerId === match.player1_id;
    const newState = forfeitStatePatch(ev.game_type, match, match.state || {}, winnerIsP1, "admin_forced", "主辦人已在後台強制判定這場對戰的勝負。");
    await client.from("matches").update({ state: newState }).eq("id", match.id);
    await advanceAfterMatch({ ...match, state: newState }, winnerId, loserId);
  }

  async function advanceAfterMatch(match, winnerId, loserId) {
    // 用 status='active' 當條件鎖，避免兩個瀏覽器同時把同一場對戰結算兩次
    const { data: claimed, error: claimErr } = await client
      .from("matches")
      .update({ status: "done", winner_id: winnerId })
      .eq("id", match.id)
      .eq("status", "active")
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) return; // 已經被結算過了，不重複處理

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
      await awardTournamentChampionTitles(eventId, winnerId);
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
        // 不在這裡直接開打，一律排隊等 activateNextMatch 叫號，確保同一時間只有一場在進行
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
        await awardTournamentChampionTitles(eventId, winnerId);
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

    // 這場結束了(不管是勝部/敗部/總冠軍賽哪一種)，都要看看有沒有下一場可以開打
    // 這一行以前只有敗部分支會執行到，勝部分支會提早return跳過，是造成賽程卡住的主因，現在修正為一定會執行
    await activateNextMatch(eventId);
  }

  const ENTER_GRACE_MS = 60 * 1000; // 一方超過這麼久沒進場，系統開始自動幫他出招(不棄權)
  const BOTH_NO_SHOW_MS = 180 * 1000; // 雙方都超過這麼久沒進場，才會強制判定，避免整個賽程卡死

  function neutralAutoMove(gameType) {
    if (gameType === "dice") {
      return { roll: 1 + Math.floor(Math.random() * 6), defend: false, allin: false, freebet: false, gamble: false, stance: null, ult: false };
    }
    return { gesture: null, ult: false, timeout: true };
  }

  // 巡邏檢查目前進行中的那一場對戰，有沒有人遲遲不進場。
  // 不需要對戰畫面本身開啟也能運作，只要有人開著等候室或後台頁面，定期呼叫這個就會生效。
  // 規則:單方缺席 → 系統自動幫他出招(不棄權)。雙方都缺席太久 → 強制判定，並標記 forfeitReason 讓對戰畫面顯示大字公告。
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
    if (m.bracket === "final") return; // 總冠軍賽先不自動判，交給主辦人手動處理比較保險
    if (!m.activated_at) return;
    if (m.state && (m.state.hp1 <= 0 || m.state.hp2 <= 0)) return; // 已經分出勝負，等待正常結算

    const elapsed = Date.now() - new Date(m.activated_at).getTime();
    const p1In = !!m.p1_entered_at;
    const p2In = !!m.p2_entered_at;
    const ev = await getEvent(eventId);

    if (!p1In && !p2In) {
      if (elapsed < BOTH_NO_SHOW_MS) return;
      const winnerId = Math.random() < 0.5 ? m.player1_id : m.player2_id;
      const loserId = winnerId === m.player1_id ? m.player2_id : m.player1_id;
      const winnerIsP1 = winnerId === m.player1_id;
      const newState = forfeitStatePatch(
        ev.game_type,
        m,
        m.state || {},
        winnerIsP1,
        "both_afk",
        "雙方都太久沒有進場對戰，系統自動判定一方直接晉級。"
      );
      await client.from("matches").update({ state: newState }).eq("id", m.id);
      await advanceAfterMatch({ ...m, state: newState }, winnerId, loserId);
      return;
    }

    if (elapsed < ENTER_GRACE_MS) return;
    if (p1In && p2In) return; // 雙方都進場了，交給對戰畫面自己的代打機制處理即時出招

    const absentSlot = !p1In ? 1 : 2;
    const already = absentSlot === 1 ? m.state.m1 : m.state.m2;
    if (already) return; // 這回合已經出過招了，等對方出招或下一輪再說
    await submitMove(m.id, absentSlot, neutralAutoMove(ev.game_type));
  }

  // 玩家自行退出比賽(例如要換帳號)。還沒開打就直接移除報名;如果正在對戰中，視同棄權，對手直接獲勝晉級。
  async function quitEvent(eventId, playerId) {
    const part = await getMyParticipant(eventId, playerId);
    if (!part) return;
    if (part.status === "matched" && part.match_id) {
      const { data: m, error } = await client.from("matches").select("*").eq("id", part.match_id).single();
      if (error) throw error;
      if (m.status === "active") {
        const winnerId = m.player1_id === playerId ? m.player2_id : m.player1_id;
        const winnerIsP1 = winnerId === m.player1_id;
        const ev = await getEvent(eventId);
        const newState = forfeitStatePatch(ev.game_type, m, m.state || {}, winnerIsP1, "opponent_quit", "一方主動退賽，對手直接獲勝。");
        await client.from("matches").update({ state: newState }).eq("id", m.id);
        await advanceAfterMatch({ ...m, state: newState }, winnerId, playerId);
        return;
      }
    }
    await removeParticipant(part.id);
  }

  // 改名(登入後可以自訂暱稱，不會被下次登入時的 Discord 名稱蓋掉)
  async function updatePlayerName(playerId, name) {
    const { data, error } = await client
      .from("players")
      .update({ name })
      .eq("id", playerId)
      .select()
      .single();
    if (error) throw error;
    localStorage.setItem("player_name", data.name);
    invalidateCache("ensurePlayerFromSession:"); // 改名後把快取清掉，不然短時間內其他模組還會拿到改名前的舊資料
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

  // ---------- 觀眾即時表情彈幕(不存資料庫，純即時廣播) ----------
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
  // 報名(等於「開局全自動」企劃裡的公平起跑):第一次報名時依活動設定的起始預算發財神幣，
  // 之後重複呼叫(例如重整頁面)不會重發，直接回傳原本那筆資料。
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
    return _cachedFetch(`listAuctionLots:${eventId}`, 300, async (signal) => {
      const { data, error } = await client
        .from("auction_lots")
        .select("*, bidder:current_bidder_id(name), partner_a:partner_a_id(name), partner_b:partner_b_id(name)")
        .abortSignal(signal)
        .eq("event_id", eventId)
        .order("wave_number", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data;
    });
  }

  // 主辦人按下「開始拍賣」:把已報名的人鎖住(不能再中途加入拿預算)，
  // 依商品排程算好每一波的開拍時間，整場一次寫進 auction_lots。
  async function startAuction(eventId, opts) {
    const waveIntervalSec = opts.waveIntervalSec || AUCTION_DEFAULT_WAVE_INTERVAL_SEC;
    const waves = opts.waves; // buildAuctionWaves() 產生的結果，呼叫端(admin.js)已經算好
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
          is_sealed: !!item.isSealed,
          is_flash: !!item.isFlash,
          box_pre_roll_tier: item.boxPreRoll ? item.boxPreRoll.tier : null,
          box_pre_roll_name: item.boxPreRoll ? item.boxPreRoll.name : null,
        });
      });
    });
    if (rows.length) {
      const { error: insertErr } = await client.from("auction_lots").insert(rows);
      if (insertErr) throw insertErr;
    }
    // 順便排一批夜市任務(問答/猜謎)，平均分散在整場預估時長內，自動開放作答。
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

  // 每個看拍賣畫面的人，瀏覽器背景每秒都會呼叫這兩個函式來推進排程，
  // 用 status 當條件鎖(.eq status)確保就算好幾個人同時呼叫，同一件商品也只會被推進一次。
  async function activateDueAuctionLots(eventId) {
    const nowIso = new Date().toISOString();
    const { data: due, error } = await client
      .from("auction_lots")
      .select("id, base_price, priority_holder_id, is_flash")
      .eq("event_id", eventId)
      .eq("status", "scheduled")
      .lte("scheduled_at", nowIso);
    if (error) throw error;
    if (!due || !due.length) return;
    const now = Date.now();
    for (const lot of due) {
      // 限時快閃攤上架時間短很多(先搶先贏，不用比價)，其餘商品維持原本的拍賣倒數秒數
      const durationSec = lot.is_flash ? AUCTION_FLASH_DURATION_SEC : AUCTION_LOT_DURATION_SEC;
      const endsAt = new Date(now + durationSec * 1000).toISOString();
      const updates = { status: "live", current_price: lot.base_price, ends_at: endsAt };
      // 如果這一波有人用插隊優先權預約過，開拍時順便算出他的專屬優先出價時間窗
      if (lot.priority_holder_id) updates.priority_until = new Date(now + AUCTION_PRIORITY_WINDOW_SEC * 1000).toISOString();
      await client.from("auction_lots").update(updates).eq("id", lot.id).eq("status", "scheduled");
    }
  }

  // 共用結標邏輯:扣得標者的錢(招待券免費兌換時 finalPrice 是 0)、幫其他出過價但沒標到的人辦參與獎勵、
  // 如果是特殊券商品就把效果加進得標者的 auction_participants.effects、如果是福袋箱就現場開箱算分數、
  // 如果這一波有成立合夥競標就把價錢跟分數分一半給夥伴、幫猜價小遊戲猜中/最接近的人加分，最後標記 settled。
  // 呼叫端(settleExpiredAuctionLots / useAuctionFreeCommonTicket)都已經先用 status 條件鎖搶到這件商品的處理權。
  async function finalizeAuctionLot(lot, winnerId, finalPrice) {
    let lotUpdates = null;
    let partnerCredit = null; // { partnerId, coinsDelta, bonusPoints }
    if (winnerId) {
      const part = await getMyAuctionParticipant(lot.event_id, winnerId);
      if (part) {
        const effects = part.effects || {};
        // 用來組 adjust_auction_participant 呼叫參數的道具券異動(最多同時一種數量異動+一種旗標異動，
        // 一件商品只會是「特殊券」或「福袋箱」其中一種，不會兩種同時成立，所以這樣就夠用)
        let effectKey = null;
        let effectDelta = 0;
        let effectFlagKey = null;
        let effectFlagValue = null;
        // 分數改用「實際成交價」現算，不是開拍前就寫死的 lot.points，搶標搶得越貴分數也跟著漲。
        // 用「老闆招待券」免費兌換時 finalPrice 是 0，這種情況退回用底價算(不然免費兌換只會拿到分數下限)。
        const pricingBasis = finalPrice > 0 ? finalPrice : lot.base_price;
        let points =
          lot.item_tier === "special"
            ? 0
            : lot.item_tier === "bundle"
            ? auctionPointsForBundlePrice(pricingBasis)
            : auctionPointsForPrice(pricingBasis, lot.item_tier);
        if (lot.special_key) {
          effectKey = lot.special_key;
          effectDelta = 1;
        }
        if (lot.item_tier === "mystery") {
          // 商品鑑定符要看得到「排程當下」就先開好的結果，所以結標這裡改成讀 box_pre_roll_tier/name，
          // 不是重新開一次——統計上跟原本重新 roll 完全一樣(還是同一張機率表)，只是提早決定而已。
          // 舊資料沒有 box_pre_roll_tier(升級前排的商品)才退回原本「結標當下重新開」的做法。
          const outcome = lot.box_pre_roll_tier
            ? { ...auctionBoxOutcomeByTier(lot.box_pre_roll_tier), revealName: lot.box_pre_roll_name }
            : auctionRollMysteryBoxOutcome();
          points = outcome.points;
          let doubled = false;
          if (effects.boxDoubleActive) {
            points *= 2;
            doubled = true;
            effectFlagKey = "boxDoubleActive";
            effectFlagValue = false;
          }
          lotUpdates = { ...(lotUpdates || {}), box_reveal_name: outcome.revealName, box_reveal_tier: outcome.tier, box_doubled: doubled };
        }

        // 連標加成:連續標到幾件(不含特殊券)商品，從第 N 件開始這件分數多加一點，鼓勵手氣正旺的人繼續投入，
        // 出過價卻沒標到的人(下面「參與獎勵」那段)會把對方的連續紀錄歸零。這裡要在「合夥分帳」之前先算好、
        // 先套用在整批 points 上，兩人才是各分「加成後」總分的一半;如果搬到分帳後面才加成，會變成只有
        // 主要出價者自己拿到的那一份被加成，夥伴那份沒加到，兩邊看到的 lot.points 數字就會對不上實際入帳。
        const newStreak = lot.item_tier === "special" ? part.win_streak || 0 : (part.win_streak || 0) + 1;
        if (lot.item_tier !== "special" && newStreak >= AUCTION_WIN_STREAK_BONUS_START) {
          points = Math.round(points * (1 + AUCTION_WIN_STREAK_BONUS_RATIO));
        }

        // 合夥競標:這一波如果有成立合夥關係，得標者跟夥伴價錢各分一半(尾數算主要出價者的)，分數雙方拿一樣的數字。
        let myPrice = finalPrice;
        let myPoints = points;
        const isPartnered = lot.partner_status === "accepted" && (lot.partner_a_id === winnerId || lot.partner_b_id === winnerId);
        if (isPartnered) {
          const partnerId = lot.partner_a_id === winnerId ? lot.partner_b_id : lot.partner_a_id;
          // 價錢用 ceil/剩下的方式分(主要出價者多扛一點尾數)，分數改成雙方都用 floor 取一樣的數字
          // (不是一個 ceil 一個 floor)，這樣「我的背包」才能直接把 lot.points 顯示給雙方看，
          // 兩邊看到的數字保證一致，不用另外存一份「夥伴分到多少」才能顯示——最多就是尾數的 1 分不發，可以接受。
          const myPriceShare = Math.ceil(finalPrice / 2);
          const myPointsShare = Math.floor(points / 2);
          partnerCredit = { partnerId, coinsDelta: -(finalPrice - myPriceShare), bonusPoints: myPointsShare };
          myPrice = myPriceShare;
          myPoints = myPointsShare;
        }
        if (lot.item_tier !== "special") {
          lotUpdates = { ...(lotUpdates || {}), points: myPoints };
        }
        await client.rpc("adjust_auction_participant", {
          p_participant_id: part.id,
          p_coins_delta: -myPrice,
          p_win_streak: newStreak,
          p_effect_key: effectKey,
          p_effect_delta: effectDelta,
          p_effect_flag_key: effectFlagKey,
          p_effect_flag_value: effectFlagValue,
        });
      }
    }
    if (partnerCredit) {
      const partnerPart = await getMyAuctionParticipant(lot.event_id, partnerCredit.partnerId);
      if (partnerPart) {
        await client.rpc("adjust_auction_participant", {
          p_participant_id: partnerPart.id,
          p_coins_delta: partnerCredit.coinsDelta,
          p_bonus_points_delta: partnerCredit.bonusPoints,
        });
      }
    }
    if (lotUpdates) {
      await client.from("auction_lots").update(lotUpdates).eq("id", lot.id);
    }

    // 猜價小遊戲:這件商品開拍中大家先猜的「最後會標到多少錢」，結標後跟實際成交價比對，
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
            await client.rpc("adjust_auction_participant", { p_participant_id: guesserPart.id, p_bonus_points_delta: bonus });
          }
        }
      }
    }

    // 參與獎勵:這件商品有出過價、但最後沒標到的人，結標後每人發一小筆財神幣鼓勵踴躍出手(不是退款，
    // 出價當下本來就沒有預先扣錢，得標才會真的扣)。金額 = 這件商品的最小加價單位 * 倍率，越稀有的商品給越多。
    // 合夥的夥伴不算「沒標到」，不用再額外領一次。
    const { data: bidRows, error: bidErr } = await client.from("auction_bids").select("player_id").eq("lot_id", lot.id);
    if (bidErr) throw bidErr;
    const refund = lot.min_increment * AUCTION_PARTICIPATION_REFUND_MULT;
    const excludeIds = new Set([winnerId, partnerCredit ? partnerCredit.partnerId : null]);
    const losingBidderIds = Array.from(new Set((bidRows || []).map((b) => b.player_id))).filter((pid) => !excludeIds.has(pid));
    for (const pid of losingBidderIds) {
      const losingPart = await getMyAuctionParticipant(lot.event_id, pid);
      if (losingPart) {
        // 連標加成:出過價卻沒標到，連續紀錄中斷歸零(特殊券不影響連續紀錄，不用重置)
        const shouldReset = lot.item_tier !== "special" && (losingPart.win_streak || 0) > 0;
        await client.rpc("adjust_auction_participant", {
          p_participant_id: losingPart.id,
          p_coins_delta: refund,
          p_win_streak: shouldReset ? 0 : null,
        });
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
      // 用 status='live' 當鎖，先搶到才處理結算，沒搶到的人就跳過(已經有人處理過了)
      const { data: claimed, error: claimErr } = await client
        .from("auction_lots")
        .update({ status: "done" })
        .eq("id", lot.id)
        .eq("status", "live")
        .select();
      if (claimErr) throw claimErr;
      if (!claimed || !claimed.length) continue;
      if (lot.is_sealed) {
        // 暗標競標:結算時才第一次去查大家盲出的價格，最高價得標、付自己出的價(不是別人的價)。
        // 順便把每筆暗標也寫一份進 auction_bids(共用表)，這樣參與獎勵/連標加成重置這些既有邏輯
        // 才抓得到「這件商品有誰出過價但沒標到」，不用另外重寫一套。
        const { data: sealedRows, error: sealedErr } = await client.from("auction_sealed_bids").select("*").eq("lot_id", lot.id);
        if (sealedErr) throw sealedErr;
        let winnerId = null;
        let finalPrice = 0;
        (sealedRows || []).forEach((b) => {
          if (b.amount > finalPrice) {
            finalPrice = b.amount;
            winnerId = b.player_id;
          }
        });
        if (sealedRows && sealedRows.length) {
          await client
            .from("auction_bids")
            .insert(sealedRows.map((b) => ({ lot_id: lot.id, event_id: lot.event_id, player_id: b.player_id, amount: b.amount })));
        }
        await finalizeAuctionLot(lot, winnerId, finalPrice);
      } else {
        await finalizeAuctionLot(lot, lot.current_bidder_id, lot.current_price);
      }
    }
  }

  // 暗標/密封競標:出價互不可見，時間到才一起結算。可以在時間內改價(upsert)，只留最後一次出的。
  async function submitSealedBid(lot, playerId, amount) {
    if (!lot.is_sealed) throw new Error("這件商品不是暗標競標");
    if (amount < lot.base_price) throw new Error(`出價不能低於底價 ${lot.base_price}`);
    const part = await getMyAuctionParticipant(lot.event_id, playerId);
    if (!part) throw new Error("找不到你的參賽資料");
    if (part.coins < amount) throw new Error("財神幣不夠出這個價");
    const { error } = await client
      .from("auction_sealed_bids")
      .upsert({ lot_id: lot.id, event_id: lot.event_id, player_id: playerId, amount }, { onConflict: "lot_id,player_id" });
    if (error) throw error;
  }

  // 限時快閃攤:先搶先贏，用「current_bidder_id 目前是 null」當條件鎖，
  // 誰先送出這個條件成立的更新誰就搶到，其他晚一步的人 update 會影響 0 筆知道自己搶輸了。
  // 搶到的當下直接把 ends_at 設成現在，讓正常的結算流程(settleExpiredAuctionLots)馬上把它收掉。
  async function claimFlashLot(lot, playerId) {
    if (!lot.is_flash) throw new Error("這件不是限時快閃攤");
    const part = await getMyAuctionParticipant(lot.event_id, playerId);
    if (!part) throw new Error("找不到你的參賽資料");
    if (part.coins < lot.base_price) throw new Error("財神幣不夠搶購這件");
    const { data, error } = await client
      .from("auction_lots")
      .update({ current_bidder_id: playerId, current_price: lot.base_price, ends_at: new Date().toISOString() })
      .eq("id", lot.id)
      .eq("status", "live")
      .is("current_bidder_id", null)
      .select();
    if (error) throw error;
    if (!data || !data.length) throw new Error("慢了一步，已經被別人搶走了");
  }

  // 商品鑑定符:使用在正在拍賣中的福袋箱上，私下看到「排程當下就先開好」的等級(不是即時算的)，
  // 只寫回自己的 auction_participants.effects，不會廣播給別人，所以其他人畫面上看不到你用了。
  async function useAppraisal(eventId, playerId, lot) {
    if (lot.item_tier !== "mystery") throw new Error("鑑定符只能用在福袋箱上");
    if (lot.status !== "live") throw new Error("這件商品目前不是拍賣中");
    if (!lot.box_pre_roll_tier) throw new Error("這件商品還沒有可以鑑定的資料，稍後再試");
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("找不到你的參賽資料");
    const effects = part.effects || {};
    if (!(effects.appraise > 0)) throw new Error("沒有商品鑑定符可以用");
    const { error } = await client.rpc("adjust_auction_participant", {
      p_participant_id: part.id,
      p_effect_key: "appraise",
      p_effect_delta: -1,
      p_appraisal_lot_id: lot.id,
      p_appraisal_tier: lot.box_pre_roll_tier,
    });
    if (error) throw error;
    return lot.box_pre_roll_tier;
  }

  // 出價:用「目前最高價沒變」當樂觀鎖條件，避免兩個人同時搶標時其中一口價憑空消失。
  // 出價前會檢查:這位玩家手上財神幣扣掉他「目前正領先中的其他商品」的金額後，夠不夠付這一口價。
  // 如果這一波有人用插隊優先權預約過，專屬時間窗內只有那個人能出價，其他人要等時間到。
  async function placeAuctionBid(lot, playerId, amount) {
    if (lot.priority_holder_id && lot.priority_holder_id !== playerId && lot.priority_until && new Date(lot.priority_until).getTime() > Date.now()) {
      throw new Error("現在是別人的插隊優先權時間，請稍後再搶標");
    }
    const part = await getMyAuctionParticipant(lot.event_id, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const { data: myLiveLeads, error: leadErr } = await client
      .from("auction_lots")
      .select("id, current_price")
      .eq("event_id", lot.event_id)
      .eq("status", "live")
      .eq("current_bidder_id", playerId);
    if (leadErr) throw leadErr;

    // 「加價 X 枚」這個操作本身是相對值(不是喊一個絕對金額)，所以價格被別人搶先改掉的話，
    // 直接拿最新的價格重算一次「加價後應該是多少」再試一次即可，玩家不用手動重新整理再點一次。
    // 大家同時點按鈕本來就很容易撞在一起，這裡自動重試 1 次，撞第二次才真的請玩家自己來。
    let workingLot = lot;
    for (let attempt = 0; attempt < 2; attempt++) {
      const newPrice = workingLot.current_price + amount;
      const committed = (myLiveLeads || []).filter((l) => l.id !== workingLot.id).reduce((s, l) => s + l.current_price, 0);
      if (part.coins - committed < newPrice) {
        throw new Error("財神幣不夠喊這個價(要扣掉你目前其他領先中的商品)");
      }
      const now = new Date();
      let endsAt = workingLot.ends_at;
      const remainingMs = new Date(workingLot.ends_at).getTime() - now.getTime();
      if (remainingMs <= AUCTION_ANTI_SNIPE_WINDOW_SEC * 1000) {
        endsAt = new Date(now.getTime() + AUCTION_ANTI_SNIPE_EXTEND_SEC * 1000).toISOString();
      }
      const { data: updated, error } = await client
        .from("auction_lots")
        .update({ current_price: newPrice, current_bidder_id: playerId, ends_at: endsAt })
        .eq("id", workingLot.id)
        .eq("status", "live")
        .eq("current_price", workingLot.current_price)
        .select();
      if (error) throw error;
      if (updated && updated.length) {
        await client.from("auction_bids").insert({ lot_id: workingLot.id, event_id: workingLot.event_id, player_id: playerId, amount: newPrice });
        return updated[0];
      }
      if (attempt === 0) {
        const { data: freshLot, error: freshErr } = await client.from("auction_lots").select("*").eq("id", lot.id).single();
        if (freshErr || !freshLot || freshLot.status !== "live") throw new Error("手慢了，價格剛剛被別人改變了，請重新出價");
        workingLot = freshLot;
      }
    }
    throw new Error("手慢了，價格剛剛被別人改變了，請重新出價");
  }

  // 打工賺財神幣:用 work_ready_at<=now 當樂觀鎖，同一秒連點兩次也只會成功一次。
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
    if (!updated || !updated.length) throw new Error("手慢了，請再按一次");
    return { gain, participant: updated[0] };
  }

  // ---------- 夜市任務(問答／猜謎) ----------
  async function listAuctionTasks(eventId) {
    return _cachedFetch(`listAuctionTasks:${eventId}`, 300, async (signal) => {
      const { data, error } = await client
        .from("auction_tasks")
        .select("*")
        .abortSignal(signal)
        .eq("event_id", eventId)
        .order("scheduled_at", { ascending: true });
      if (error) throw error;
      return data || [];
    });
  }

  // 每個看拍賣畫面的人，瀏覽器背景每秒都會呼叫這兩個函式來推進任務，
  // 跟商品排程一樣用 status 當條件鎖，避免好幾個人同時呼叫時同一題被推進兩次。
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

  // 玩家作答:靠 auction_task_answers 的 unique(task_id， player_id) 限制擋重複作答，
  // 答對才會發財神幣，答錯不倒扣、但這題也不能再猜第二次。
  async function answerAuctionTask(taskId, eventId, playerId, choiceIndex) {
    const { data: task, error: taskErr } = await client.from("auction_tasks").select("*").eq("id", taskId).single();
    if (taskErr) throw taskErr;
    if (task.status !== "live" || (task.ends_at && new Date(task.ends_at).getTime() < Date.now())) {
      throw new Error("這題已經結束了，晚了一步");
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
        const { data, error: updErr } = await client.rpc("adjust_auction_participant", { p_participant_id: part.id, p_coins_delta: gain });
        if (updErr) throw updErr;
        participant = data;
      }
    }
    return { correct, gain, participant };
  }

  // 一次撈出這位玩家在這場活動裡「已經回答過的任務」，前端拿來判斷每題要顯示選項還是顯示結果。
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
  // 下注:先驗證金額跟冷卻，骰子結果用 resolveAuctionLuckyBet()(auction-catalog.js)純計算算出，
  // 寫回財神幣時用「coins 沒變 + 冷卻沒變」當樂觀鎖，避免跟打工/出價/任務同時發生時互相蓋掉。
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
    if (!updated || !updated.length) throw new Error("手慢了，財神幣剛剛被別的動作改變了，請重新下注");
    return { die, outcome, win, delta, betAmount: amount, participant: updated[0] };
  }

  // 目前積分 = 得標商品分數總和 + 剩餘財神幣 * 折算比例(不管活動是否已結束都能算，用來做即時排行榜)
  // 第二參數可選傳入已經抓過的 lots(呼叫端如果同一輪已經抓過商品清單，就不用在這裡重抓一次，省一次 API/流量)。
  async function computeAuctionStandings(eventId, opts = {}) {
    const [parts, lots] = await Promise.all([
      listAuctionParticipants(eventId),
      opts.lots ? Promise.resolve(opts.lots) : listAuctionLots(eventId),
    ]);
    const wonByPlayer = {};
    lots
      .filter((l) => l.status === "done" && l.current_bidder_id)
      .forEach((l) => {
        wonByPlayer[l.current_bidder_id] = wonByPlayer[l.current_bidder_id] || [];
        wonByPlayer[l.current_bidder_id].push(l);
      });
    const rows = parts.map((p) => {
      const won = wonByPlayer[p.player_id] || [];
      const activeWon = won.filter((l) => !l.refunded);
      const baseItemScore = activeWon.reduce((s, l) => s + l.points, 0) + (p.bonus_points || 0);
      const seriesBonus = auctionSeriesBonusForNames(activeWon.map((l) => l.item_name));
      const itemScore = baseItemScore + seriesBonus.total;
      const coinScore = Math.round(p.coins * AUCTION_COIN_TO_SCORE * 10) / 10;
      return { participant: p, wonLots: won, itemScore, seriesBonus, coinScore, score: itemScore + coinScore };
    });
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  // ---------- 特殊券效果 ----------
  // 搶先情報券:一用永久生效(對這位玩家而言)，商品預告從此能看到全場剩餘清單，不用每波重複使用。
  async function useAuctionIntelTicket(eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.intel || effects.intel < 1) throw new Error("你沒有搶先情報券");
    const { data, error } = await client.rpc("adjust_auction_participant", {
      p_participant_id: part.id,
      p_effect_key: "intel",
      p_effect_delta: -1,
      p_effect_flag_key: "intelActive",
      p_effect_flag_value: true,
    });
    if (error) throw error;
    return data;
  }

  // 插隊優先權:預約「目前排隊中最早的下一波商品」，那一波開拍時這位玩家會拿到專屬優先出價時間窗
  // (實際時間窗是 activateDueAuctionLots 開拍那一刻才算出來，這裡只先把 priority_holder_id 卡在商品上)。
  // 限時快閃攤(先搶先贏，沒有「出價時間窗」可言)、暗標競標(盲出價，看不到別人搶標所以優先權沒有意義)
  // 這兩種商品排除在外，不然優先權卡到這種商品上會直接浪費掉、玩家還不知道為什麼沒效果。
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
      .eq("is_flash", false)
      .eq("is_sealed", false)
      .is("priority_holder_id", null)
      .order("scheduled_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (nextErr) throw nextErr;
    if (!nextLot) throw new Error("目前沒有可以插隊的下一波商品了(限時快閃攤/暗標競標不能插隊，用不上優先權)");
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ priority_holder_id: playerId })
      .eq("id", nextLot.id)
      .eq("status", "scheduled")
      .is("priority_holder_id", null)
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了，插隊名額剛剛被別人搶走，請再試一次");
    const { error: partErr } = await client.rpc("adjust_auction_participant", {
      p_participant_id: part.id,
      p_effect_key: "priority",
      p_effect_delta: -1,
    });
    if (partErr) throw partErr;
    return claimed[0];
  }

  // 退款保證券:針對玩家自己「已得標、還沒退過」的某一件商品，無條件退回，拿回一半財神幣。
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
    if (!claimed || !claimed.length) throw new Error("手慢了，請重新整理再試一次");
    const refundCoins = Math.floor(lot.current_price / 2);
    const { data: updatedPart, error: partErr } = await client.rpc("adjust_auction_participant", {
      p_participant_id: part.id,
      p_coins_delta: refundCoins,
      p_effect_key: "refund",
      p_effect_delta: -1,
    });
    if (partErr) throw partErr;
    return { refundCoins, participant: updatedPart };
  }

  // 福袋箱翻倍券:設一個「下次開箱翻倍」的持續生效旗標，實際翻倍在 finalizeAuctionLot 開箱那一刻套用並消耗掉。
  async function useAuctionBoxDoubleTicket(eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.boxDouble || effects.boxDouble < 1) throw new Error("你沒有福袋箱翻倍券");
    if (effects.boxDoubleActive) throw new Error("已經啟用中了，等下一次開箱生效");
    const { data, error } = await client.rpc("adjust_auction_participant", {
      p_participant_id: part.id,
      p_effect_key: "boxDouble",
      p_effect_delta: -1,
      p_effect_flag_key: "boxDoubleActive",
      p_effect_flag_value: true,
    });
    if (error) throw error;
    return data;
  }

  // ---------- 合夥競標 ----------
  // 只能在還沒有人成立合夥關係(或對方剛婉拒過)的情況下邀請，一波同時只能有一組合夥關係。
  async function inviteAuctionPartner(lotId, eventId, inviterId, partnerId) {
    if (inviterId === partnerId) throw new Error("不能邀請自己合夥");
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.status !== "scheduled") throw new Error("開拍前才能邀請合夥，這波已經開拍或已經結束了");
    if (lot.partner_status === "pending" || lot.partner_status === "accepted") throw new Error("這一波已經有合夥關係在進行了");
    const partnerPart = await getMyAuctionParticipant(eventId, partnerId);
    if (!partnerPart) throw new Error("對方還沒報名這場拍賣");
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ partner_a_id: inviterId, partner_b_id: partnerId, partner_status: "pending" })
      .eq("id", lotId)
      .eq("status", "scheduled")
      .or("partner_status.is.null,partner_status.eq.declined")
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了，請重新整理再試一次");
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
    if (!updated || !updated.length) throw new Error("手慢了，請重新整理再試一次");
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
    if (lot.status !== "scheduled") throw new Error("開拍前才能猜價，這波已經開拍或已經結束了");
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

  async function listMySealedBids(eventId, playerId) {
    const { data, error } = await client.from("auction_sealed_bids").select("*").eq("event_id", eventId).eq("player_id", playerId);
    if (error) throw error;
    return data || [];
  }

  // 老闆招待券:直接把一件「拍賣中的普通級商品」免費送給這位玩家，結標流程走跟一般結標同一套
  // finalizeAuctionLot(參與獎勵等邏輯都一致)，只是 finalPrice 固定是 0。
  async function useAuctionFreeCommonTicket(lotId, eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.freeCommon || effects.freeCommon < 1) throw new Error("你沒有老闆招待券");
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.status !== "live") throw new Error("這件商品現在不是拍賣中");
    if (lot.item_tier !== "common") throw new Error("招待券只能兌換「普通」級商品");
    if (lot.is_flash) throw new Error("招待券不能用在限時快閃攤上(那本來就是先搶先贏、沒有比價，用招待券等於搶在所有人前面白拿，不公平)");
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ status: "done", current_bidder_id: playerId, current_price: 0 })
      .eq("id", lotId)
      .eq("status", "live")
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了，這件商品剛結標了");
    const { error: partErr } = await client.rpc("adjust_auction_participant", {
      p_participant_id: part.id,
      p_effect_key: "freeCommon",
      p_effect_delta: -1,
    });
    if (partErr) throw partErr;
    await finalizeAuctionLot(claimed[0], playerId, 0);
    return claimed[0];
  }

  // 劫標券:直接用「目前最高價 x (1+溢價比例)」瞬間把商品搶下來，付溢價換穩贏，其他人來不及反應。
  // 不能用在暗標競標(沒有可見的「目前最高價」可以算)、限時快閃攤(本來就是先搶先贏，用不上)、特殊券
  // (道具券本身用溢價搶沒意義)上，其餘分級的商品都能用。
  async function useAuctionSnipeTicket(lotId, eventId, playerId) {
    const part = await getMyAuctionParticipant(eventId, playerId);
    if (!part) throw new Error("還沒報名這場拍賣");
    const effects = part.effects || {};
    if (!effects.snipe || effects.snipe < 1) throw new Error("你沒有劫標券");
    const { data: lot, error: lotErr } = await client.from("auction_lots").select("*").eq("id", lotId).single();
    if (lotErr) throw lotErr;
    if (lot.status !== "live") throw new Error("這件商品現在不是拍賣中");
    if (lot.is_sealed) throw new Error("劫標券不能用在暗標競標的商品上");
    if (lot.is_flash) throw new Error("這件已經是先搶先贏了，不需要用劫標券");
    if (lot.item_tier === "special") throw new Error("劫標券不能用在特殊券上");
    const snipePrice = Math.ceil(lot.current_price * (1 + AUCTION_SNIPE_PREMIUM));
    if (part.coins < snipePrice) throw new Error(`財神幣不夠付劫標的溢價(需要 ${snipePrice})`);
    const { data: claimed, error: claimErr } = await client
      .from("auction_lots")
      .update({ status: "done", current_bidder_id: playerId, current_price: snipePrice })
      .eq("id", lotId)
      .eq("status", "live")
      .eq("current_price", lot.current_price)
      .select();
    if (claimErr) throw claimErr;
    if (!claimed || !claimed.length) throw new Error("手慢了，價格剛剛變了，請重新確認金額再試一次");
    await client.from("auction_bids").insert({ lot_id: lotId, event_id: eventId, player_id: playerId, amount: snipePrice });
    const { error: partErr } = await client.rpc("adjust_auction_participant", {
      p_participant_id: part.id,
      p_effect_key: "snipe",
      p_effect_delta: -1,
    });
    if (partErr) throw partErr;
    await finalizeAuctionLot(claimed[0], playerId, snipePrice);
    return claimed[0];
  }

  // 主辦人結束活動:結算名次，套用現有的獎勵設定(reward_plan)自動填獎勵。
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
    await awardAuctionTitles(eventId, standings);
    return standings;
  }

  // 主辦人手動覆蓋某位拍賣參加者的獎勵文字(結束活動時 closeAuctionEvent 已經自動套用一次，
  // 這個函式讓主辦人事後還能個別修改)
  async function setAuctionReward(participantId, reward) {
    const { error } = await client
      .from("auction_participants")
      .update({ reward })
      .eq("id", participantId);
    if (error) throw error;
  }

  // event:"*" 訂閱本身沒有「補齊斷線期間漏掉的變化」這種機制——如果 websocket 斷線又自動重連，
  // 中間發生的異動不會補發，畫面會停在斷線前的舊狀態，只能等下一次剛好有新異動才會發現不對。
  // 這裡在重新訂閱成功(而且不是第一次訂閱，是斷線後重連)時，主動呼叫一次 cb 補一份快照——
  // cb 在這個專案裡一律是「重新抓一次資料」的處理函式(例如 refresh()/scheduleRefresh()/poll())，
  // 沒有依賴 postgres_changes 帶的 payload 內容，所以直接呼叫效果等同「收到了一次變化通知」。
  function onTableChange(table, filter, cb) {
    let hasSubscribedBefore = false;
    // 有資料真的異動了，短期快取要整批作廢，不然下一次讀可能還是拿到異動前的舊快取。
    // 用「整批清空」而不是精算哪個 key 該清，是因為快取 TTL 很短(通常抓幾百毫秒)，
    // 清空的成本可以忽略，換來邏輯簡單、不會漏清。
    const wrappedCb = (payload) => {
      invalidateCache();
      cb(payload);
    };
    const channel = client
      .channel(`${table}-${filter || "all"}-${Math.random()}`)
      .on("postgres_changes", { event: "*", schema: "public", table, filter }, wrappedCb)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          if (hasSubscribedBefore) wrappedCb();
          hasSubscribedBefore = true;
        }
      });
    return () => client.removeChannel(channel);
  }

  // 用 Supabase Realtime Presence 在同一個頻道(例如同一場拍賣)裡的所有分頁之間選出一個「隊長」——
  // 只有隊長那一台需要負責跑背景排程(每秒推進拍賣)，其他分頁純被動接收資料變化，省下大量重複流量。
  // 選法很單純:每個分頁進頻道時帶一個亂數 key，所有目前在線的 key 排序後，最小的那個當隊長。
  // 隊長分頁關掉/斷線後，presence 會自動把它移除，剩下的人裡最小的 key 自動變成新隊長，不用額外處理「隊長離線」。
  // 就算選舉過程中短暫「兩個人同時以為自己是隊長」也沒關係——實際推進排程的函式本來就是用資料庫的
  // status 條件鎖擋重複執行，多跑幾次是安全的，leader 選舉只是省流量的優化，不是正確性的必要條件。
  function electLeader(channelName, onChange) {
    const myKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const channel = client.channel(channelName, { config: { presence: { key: myKey } } });
    function notify() {
      const keys = Object.keys(channel.presenceState()).sort();
      onChange(!keys.length || keys[0] === myKey);
    }
    channel
      .on("presence", { event: "sync" }, notify)
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ at: Date.now() });
        }
      });
    return () => client.removeChannel(channel);
  }

  // ---------- 贊助名單 ----------
  // 主辦人可以自己開好幾份獨立的「贊助名單」(跟活動 events 完全無關)，每份名單自己取名字。
  // 贊助者(sponsors)底下掛的是一筆一筆的「贊助獎勵項目」(sponsor_rewards)，
  // 同一位贊助者(同一份名單內、名字視為同一人)每次贊助都是新的一批 sponsor_rewards，
  // 用同一個 entry_id 分組，前台/後台顯示時把同一位贊助者底下所有項目依「獎勵名稱」加總，
  // 不會因為前台合併顯示就把原始紀錄刪掉。
  // listSponsorLists() 依建立時間新到舊排序，呼叫端把第一筆當「最新贊助名單」顯示，其餘當「歷史贊助名單」。
  // 注意:sponsor_rewards 是雙層巢狀(sponsor_lists → sponsors → sponsor_rewards)，
  // PostgREST 對雙層巢狀資源的排序不支援用 foreignTable 直接指定，之前多加的那行排序
  // 會讓整個查詢直接失敗(前台/後台因此整份名單看起來像「消失了」，其實資料庫資料都還在)。
  // sponsor_rewards 的顯示順序改成抓回來後在前端排序(groupSponsorEntries 已經有做)，這裡不用排。
  // onlyVisible = true 時只抓 visible = true 的名單(前台用，隱藏的名單完全不會出現);
  // 後台管理要看到全部名單(含隱藏的)才能切換顯示/隱藏，呼叫時不傳這個參數。
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

  // 新建立的名單預設「隱藏」，避免主辦人只是先開一份下一次活動的草稿名單，
  // 就因為建立時間比較新而立刻搶走前台「最新贊助名單/本次活動」的位置，把還在進行的活動名單推進歷史。
  // 準備好要公開時，後台手動切成「顯示於前台」即可。
  async function addSponsorList(name) {
    const { data, error } = await client.from("sponsor_lists").insert({ name, visible: false }).select().single();
    if (error) throw error;
    return data;
  }

  async function updateSponsorList(id, name) {
    const { error } = await client.from("sponsor_lists").update({ name }).eq("id", id);
    if (error) throw error;
  }

  // 切換某份贊助名單是否顯示於前台;隱藏後只是前台不顯示，後台資料與統計都保留，不會刪除任何紀錄。
  async function setSponsorListVisible(id, visible) {
    const { error } = await client.from("sponsor_lists").update({ visible: !!visible }).eq("id", id);
    if (error) throw error;
  }

  async function deleteSponsorList(id) {
    const { error } = await client.from("sponsor_lists").delete().eq("id", id);
    if (error) throw error;
  }

  // 新增一筆贊助:rewards 是 [{ name， qty }， ...]。
  // 同一份名單內如果已經有同名贊助者(去頭尾空白、不分大小寫比對)，就沿用同一個 sponsors 列，
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

  // 刪除某位贊助者「這一次」的贊助紀錄(同一個 entry_id 底下的所有獎勵項目)，不影響其他次紀錄。
  async function deleteSponsorEntry(entryId) {
    const { error } = await client.from("sponsor_rewards").delete().eq("entry_id", entryId);
    if (error) throw error;
  }

  // 整筆刪除這位贊助者(連同他底下所有次的贊助紀錄)。
  async function deleteSponsor(id) {
    const { error } = await client.from("sponsors").delete().eq("id", id);
    if (error) throw error;
  }

  // 改贊助者名稱。跟新增贊助時一樣，同一份名單內名字不分大小寫比對，
  // 避免改成跟同名單裡另一位贊助者一樣的名字，前台顯示時卻分不出是哪一位。
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
    if (dup) throw new Error(`這份名單裡已經有「${dup.name}」了，換一個名字，或直接把紀錄改到那位贊助者底下`);

    const { error } = await client.from("sponsors").update({ name: cleanName }).eq("id", id);
    if (error) throw error;
  }

  // 改單筆贊助紀錄裡的「一項獎勵」(reward_name + qty)。用 sponsor_rewards 的列 id 精準指定，
  // 只改這一列，同一次贊助(entry_id)底下其他獎勵項目、以及其他次贊助紀錄都不受影響。
  async function updateSponsorReward(rewardId, { name, qty }) {
    const cleanName = (name || "").trim();
    const cleanQty = Number(qty);
    if (!cleanName) throw new Error("獎勵名稱不能空白");
    if (!Number.isFinite(cleanQty) || cleanQty <= 0) throw new Error("數量要是大於 0 的數字");
    const { error } = await client.from("sponsor_rewards").update({ reward_name: cleanName, qty: cleanQty }).eq("id", rewardId);
    if (error) throw error;
  }

  // 把一群贊助者(sponsors，每個帶著自己的 sponsor_rewards)依「獎勵名稱」加總，
  // 回傳依第一次出現順序排列的 [{ name， qty }， ...]。用來算單一贊助者總額、
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

  // 把單一贊助者底下的 sponsor_rewards 依 entry_id(同一次贊助)分組，新到舊排序，
  // 回傳 [{ entryId， createdAt， items: [{ reward_name， qty }， ...] }， ...]。
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
  // 首頁抓「最新一則」當精選公告(hero)，其餘依時間新到舊排序丟進「更多公告」收合區。
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

  // file 是 <input type="file"> 選出來的檔案，回傳可以直接存進 announcements.image_url 的公開網址
  async function uploadAnnouncementImage(file) {
    const ext = (file.name.split(".").pop() || "png").toLowerCase();
    const path = `${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await client.storage.from("announcement-images").upload(path, file, { upsert: false });
    if (error) throw error;
    const { data } = client.storage.from("announcement-images").getPublicUrl(path);
    return data.publicUrl;
  }

  // ---------- 職業養成對決(獨立第三種遊戲類型,自己的資料表,見 career.html / career.js) ----------

  // 玩家在這場活動裡選好的職業建置。Phase1 一次寫入(選線 = 整組 tier1+tier2+最終職業一起定案),
  // upsert 讓玩家能重選(對戰前重新選一次不用另外做「轉職」介面,Phase2 塔爬上線後轉職才會是真的
  // 花幣行為)。
  async function getMyCareerBuild(eventId, playerId) {
    const { data, error } = await client
      .from("career_builds")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function saveCareerBuild(eventId, playerId, { path, finalClass, skillKeys }) {
    const { data, error } = await client
      .from("career_builds")
      .upsert(
        { event_id: eventId, player_id: playerId, path, final_class: finalClass, skill_keys: skillKeys },
        { onConflict: "event_id,player_id" }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getCareerBuildFor(eventId, playerId) {
    const { data, error } = await client
      .from("career_builds")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // ---- 配對佇列 ----
  async function getMyCareerQueueEntry(eventId, playerId) {
    const { data, error } = await client
      .from("career_pvp_queue")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // 加入配對佇列(已經在裡面就直接回傳現有那筆,不重置 last_matched_at,避免插隊)
  async function joinCareerQueue(eventId, playerId) {
    const existing = await getMyCareerQueueEntry(eventId, playerId);
    if (existing) return existing;
    const { data, error } = await client
      .from("career_pvp_queue")
      .insert({ event_id: eventId, player_id: playerId, status: "waiting" })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function listCareerQueue(eventId) {
    const { data, error } = await client
      .from("career_pvp_queue")
      .select("*, player:player_id(name)")
      .eq("event_id", eventId)
      .order("current_score", { ascending: false });
    if (error) throw error;
    return data || [];
  }

  // 呼叫 match_career_players RPC:撈佇列裡等最久的兩人配對。任何開著頁面的分頁都能呼叫,
  // 沒人可配對時回傳 null,不用特別處理。
  async function scanCareerMatchmaking(eventId) {
    const { data, error } = await client.rpc("match_career_players", { p_event_id: eventId });
    if (error) throw error;
    return data;
  }

  // 找自己目前是不是在一場進行中的對戰裡(配對成功後兩邊都要能查到同一場)
  async function getMyActiveCareerMatch(eventId, playerId) {
    const { data, error } = await client
      .from("career_matches")
      .select("*, p1:player1_id(name,is_bot), p2:player2_id(name,is_bot)")
      .eq("event_id", eventId)
      .eq("status", "active")
      .or(`player1_id.eq.${playerId},player2_id.eq.${playerId}`)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getCareerMatch(matchId) {
    const { data, error } = await client
      .from("career_matches")
      .select("*, p1:player1_id(name,is_bot), p2:player2_id(name,is_bot)")
      .eq("id", matchId)
      .single();
    if (error) throw error;
    return data;
  }

  // 配對成功後,第一個偵測到的分頁把雙方完整戰鬥數值(HP/攻防速幸運/職業)寫進 state。
  // initialized=false 這個條件本身就是原子鎖,兩邊分頁同時搶著寫也只有一個會成功,
  // 不需要另外設計樂觀鎖重試。
  async function initializeCareerMatch(match) {
    const [build1, build2] = await Promise.all([
      getCareerBuildFor(match.event_id, match.player1_id),
      getCareerBuildFor(match.event_id, match.player2_id),
    ]);
    if (!build1 || !build2) return null; // 理論上配對前雙方都該選好職業了,防呆用
    // Phase3 銜接:玩家只要去爬過塔(有 career_progress 這筆資料)，PVP 數值就改用
    // 「職業基礎值 + 加點 + 裝備」算，沒去爬過塔的人(或還沒接訓練期的舊測試活動)就還是
    // 用 Phase1 那個固定基礎值，兩種情況都能正常開打，不會因為對手沒爬過塔就打不成。
    const [progress1, progress2] = await Promise.all([
      getCareerProgressFor(match.event_id, match.player1_id),
      getCareerProgressFor(match.event_id, match.player2_id),
    ]);
    const stats1 = progress1
      ? window.CareerData.applyProgress(build1.final_class, progress1.stat_alloc, progress1.equipment)
      : window.CareerData.computeStats(build1.final_class);
    const stats2 = progress2
      ? window.CareerData.applyProgress(build2.final_class, progress2.stat_alloc, progress2.equipment)
      : window.CareerData.computeStats(build2.final_class);
    const initState = window.CareerEngine.initialMatchState(
      { classKey: build1.final_class, stats: stats1 },
      { classKey: build2.final_class, stats: stats2 }
    );
    const { data, error } = await client
      .from("career_matches")
      .update({ state: initState, initialized: true })
      .eq("id", match.id)
      .eq("initialized", false)
      .select();
    if (error) throw error;
    return data && data.length ? data[0] : null;
  }

  async function submitCareerMove(matchId, slot, payload) {
    const { error } = await client.rpc("submit_career_move", {
      p_match_id: matchId,
      p_slot: slot,
      p_payload: payload,
    });
    if (error) throw error;
  }

  async function updateCareerMatchState(matchId, patch) {
    const { error } = await client.from("career_matches").update(patch).eq("id", matchId);
    if (error) throw error;
  }

  // 一場結束時呼叫:寫入 winner_id、雙方 +10/+2 分並退回佇列繼續配對(RPC 用 status='active'
  // 當條件鎖,兩邊分頁同時判定結束也只會真的結算一次)。
  async function finishCareerMatch(matchId, winnerId, loserId) {
    const { error } = await client.rpc("finish_career_match", {
      p_match_id: matchId,
      p_winner_id: winnerId,
      p_loser_id: loserId,
    });
    if (error) throw error;
  }

  // 主辦人/玩家自己測試用:建一個機器人玩家、隨機挑一個職業建置、直接排進佇列,
  // 方便一個人也能測完整場 PVP 流程,不用真的找第二個人。
  async function addCareerTestBot(eventId) {
    const botName = `🤖 測試機器人 ${Math.floor(Math.random() * 1000)}`;
    const { data: player, error: playerErr } = await client
      .from("players")
      .insert({ name: botName, is_bot: true })
      .select()
      .single();
    if (playerErr) throw playerErr;
    const classes = window.CareerData.listClasses();
    const pick = classes[Math.floor(Math.random() * classes.length)];
    const build = await saveCareerBuild(eventId, player.id, {
      path: pick.path,
      finalClass: pick.key,
      skillKeys: pick.skillKeys,
    });
    const queueEntry = await joinCareerQueue(eventId, player.id);
    return { player, build, queueEntry };
  }

  // ---------- 職業養成對決 Phase2:爬塔骨架(career_progress，見 tower.html / tower.js) ----------

  const CAREER_TRAIN_COOLDOWN_SEC = 90; // 企劃書第五、八節:特訓每90秒可領一次
  const CAREER_TRAIN_COIN_MIN = 6;
  const CAREER_TRAIN_COIN_MAX = 14; // 平均約10幣，跟企劃書經濟平衡表估算一致
  const CAREER_TRAIN_EXP_MIN = 2;
  const CAREER_TRAIN_EXP_MAX = 5;
  const CAREER_AUTO_FARM_INTERVAL_SEC = 25; // 掛機每隔幾秒背景推進一次
  const CAREER_AUTO_FARM_EFFICIENCY = 0.7; // 掛機效率打七折(企劃書第五、八節)

  function _emptyStatAlloc() {
    return { atk: 0, def: 0, spd: 0, hp: 0, luck: 0 };
  }

  // 等級曲線用 career-floors.js 的 expToNextLevel，在本地把 exp 疊代扣光算出最終等級，
  // 一次特訓/一場戰鬥要連跳好幾級也能一次算完。
  function _applyExpGain(progress, expGain) {
    let exp = progress.exp + expGain;
    let level = progress.level;
    let statPoints = progress.stat_points;
    let leveledUp = false;
    while (exp >= window.CareerFloors.expToNextLevel(level)) {
      exp -= window.CareerFloors.expToNextLevel(level);
      level += 1;
      statPoints += 2; // 每升一級送2自由數值點(企劃書第三節；技能點目前沒有可花的地方，Phase2先不發)
      leveledUp = true;
    }
    return { exp, level, stat_points: statPoints, leveledUp, newLevel: level };
  }

  async function getOrCreateCareerProgress(eventId, playerId) {
    const { data: existing, error: readErr } = await client
      .from("career_progress")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (readErr) throw readErr;
    if (existing) return existing;
    const { data, error } = await client
      .from("career_progress")
      .insert({
        event_id: eventId,
        player_id: playerId,
        stat_alloc: _emptyStatAlloc(),
        equipment: { weapon: null, armor: null, accessory: null },
      })
      .select()
      .single();
    if (error) {
      // 兩個分頁同時第一次進來，其中一個會撞到 unique(event_id,player_id)；
      // 撞到就代表另一個分頁已經幫忙建好了，直接回頭讀那一筆就好。
      const { data: raceWinner, error: reReadErr } = await client
        .from("career_progress")
        .select("*")
        .eq("event_id", eventId)
        .eq("player_id", playerId)
        .maybeSingle();
      if (reReadErr) throw reReadErr;
      if (raceWinner) return raceWinner;
      throw error;
    }
    return data;
  }

  // 特訓領幣:跟拍賣「打工」同一套機制，用 train_ready_at<=now 當樂觀鎖，
  // 同一秒連點兩次也只會成功一次。
  async function trainForCareerCoins(eventId, playerId) {
    const progress = await getOrCreateCareerProgress(eventId, playerId);
    if (new Date(progress.train_ready_at).getTime() > Date.now()) {
      throw new Error("還在冷卻中");
    }
    const coinGain = CAREER_TRAIN_COIN_MIN + Math.floor(Math.random() * (CAREER_TRAIN_COIN_MAX - CAREER_TRAIN_COIN_MIN + 1));
    const expGain = CAREER_TRAIN_EXP_MIN + Math.floor(Math.random() * (CAREER_TRAIN_EXP_MAX - CAREER_TRAIN_EXP_MIN + 1));
    const leveled = _applyExpGain(progress, expGain);
    const nextReady = new Date(Date.now() + CAREER_TRAIN_COOLDOWN_SEC * 1000).toISOString();
    const { data: updated, error } = await client
      .from("career_progress")
      .update({
        coins: progress.coins + coinGain,
        exp: leveled.exp,
        level: leveled.level,
        stat_points: leveled.stat_points,
        train_ready_at: nextReady,
      })
      .eq("id", progress.id)
      .eq("train_ready_at", progress.train_ready_at)
      .select();
    if (error) throw error;
    if (!updated || !updated.length) throw new Error("手慢了，請再按一次");
    return { coinGain, expGain, leveledUp: leveled.leveledUp, newLevel: leveled.newLevel, progress: updated[0] };
  }

  // 挑戰樓層:無CD，AI對手直接算完整場(見 career-pve.js)，贏了才推進樓層拿獎勵，
  // 輸了留在原樓層、不扣任何東西，可以馬上重試。floorNumber 可以是「下一個還沒清的樓層」
  // (真的推進進度)，也可以是任何已經清過的樓層(單純想farm，不會改變 floor 記錄)。
  async function challengeCareerFloor(eventId, playerId, floorNumber) {
    const [progress, build] = await Promise.all([
      getOrCreateCareerProgress(eventId, playerId),
      getCareerBuildFor(eventId, playerId),
    ]);
    if (!build) throw new Error("請先選好職業再挑戰樓層");
    if (floorNumber > progress.floor + 1) throw new Error("還沒清到這一層，請先按順序往上爬");
    const floorDef = window.CareerFloors.getFloor(floorNumber);
    if (!floorDef) throw new Error("找不到這一層的資料");

    const playerStats = window.CareerData.applyProgress(build.final_class, progress.stat_alloc, progress.equipment);
    const battle = window.CareerPve.simulateFloorBattle(
      { classKey: build.final_class, stats: playerStats },
      { classKey: floorDef.classKey, stats: floorDef.stats }
    );

    if (!battle.won) {
      return { won: false, log: battle.log, progress, floorDef };
    }

    const leveled = _applyExpGain(progress, floorDef.expReward);
    const isAdvance = floorNumber === progress.floor + 1;
    const drop = window.CareerFloors.rollDrop(floorDef);
    let equipment = progress.equipment;
    let equippedDrop = null;
    if (drop) {
      const current = equipment[drop.slot];
      // 沒裝備、或新掉的是稀有而目前是普通，就直接自動穿上(Phase2先不做背包/比較介面)
      const shouldEquip = !current || (drop.rarity === "rare" && current.rarity !== "rare");
      if (shouldEquip) {
        equipment = { ...equipment, [drop.slot]: drop };
        equippedDrop = drop;
      }
    }

    const { data: updated, error } = await client
      .from("career_progress")
      .update({
        floor: isAdvance ? floorNumber : progress.floor,
        coins: progress.coins + floorDef.coinReward,
        exp: leveled.exp,
        level: leveled.level,
        stat_points: leveled.stat_points,
        equipment,
      })
      .eq("id", progress.id)
      .select()
      .single();
    if (error) throw error;

    return {
      won: true,
      log: battle.log,
      floorDef,
      coinGain: floorDef.coinReward,
      expGain: floorDef.expReward,
      leveledUp: leveled.leveledUp,
      newLevel: leveled.newLevel,
      drop: equippedDrop,
      progress: updated,
    };
  }

  // 花一點自由數值點(atk/def/spd/hp/luck 其中一項 +1)
  async function allocateCareerStatPoint(eventId, playerId, statKey) {
    const progress = await getOrCreateCareerProgress(eventId, playerId);
    if (progress.stat_points <= 0) throw new Error("沒有可以分配的數值點了");
    const alloc = { ...progress.stat_alloc, [statKey]: (progress.stat_alloc[statKey] || 0) + 1 };
    const { data: updated, error } = await client
      .from("career_progress")
      .update({ stat_points: progress.stat_points - 1, stat_alloc: alloc })
      .eq("id", progress.id)
      .eq("stat_points", progress.stat_points)
      .select();
    if (error) throw error;
    if (!updated || !updated.length) throw new Error("手慢了，請再按一次");
    return updated[0];
  }

  // 開關練功掛機。floorNumber=null 表示關閉；開啟時樓層必須是已經清過的(<=目前floor)。
  async function toggleCareerAutoFarm(eventId, playerId, floorNumber) {
    const progress = await getOrCreateCareerProgress(eventId, playerId);
    if (floorNumber != null && floorNumber > progress.floor) {
      throw new Error("只有已經清過的樓層才能開自動掛機");
    }
    const { data: updated, error } = await client
      .from("career_progress")
      .update({ auto_farm_floor: floorNumber, auto_farm_last_at: new Date().toISOString() })
      .eq("id", progress.id)
      .select()
      .single();
    if (error) throw error;
    return updated;
  }

  // 背景推進所有玩家的自動掛機。任何一個開著頁面的分頁(不一定是掛機玩家本人)都能呼叫，
  // 跟夜市拍賣「前景分頁互相支援」同一個原則。用 auto_farm_last_at 當樂觀鎖，
  // 兩個分頁同時想幫同一個人推進也只會有一個成功。
  async function processCareerAutoFarmTicks(eventId) {
    const cutoff = new Date(Date.now() - CAREER_AUTO_FARM_INTERVAL_SEC * 1000).toISOString();
    const { data: dueRows, error } = await client
      .from("career_progress")
      .select("*")
      .eq("event_id", eventId)
      .not("auto_farm_floor", "is", null)
      .lte("auto_farm_last_at", cutoff);
    if (error) throw error;
    if (!dueRows || !dueRows.length) return [];

    const results = [];
    for (const progress of dueRows) {
      try {
        const build = await getCareerBuildFor(eventId, progress.player_id);
        if (!build) continue;
        const floorDef = window.CareerFloors.getFloor(progress.auto_farm_floor);
        if (!floorDef) continue;
        const playerStats = window.CareerData.applyProgress(build.final_class, progress.stat_alloc, progress.equipment);
        const battle = window.CareerPve.simulateFloorBattle(
          { classKey: build.final_class, stats: playerStats },
          { classKey: floorDef.classKey, stats: floorDef.stats }
        );
        const patch = { auto_farm_last_at: new Date().toISOString() };
        if (battle.won) {
          const coinGain = Math.round(floorDef.coinReward * CAREER_AUTO_FARM_EFFICIENCY);
          const expGain = Math.round(floorDef.expReward * CAREER_AUTO_FARM_EFFICIENCY);
          const leveled = _applyExpGain(progress, expGain);
          patch.coins = progress.coins + coinGain;
          patch.exp = leveled.exp;
          patch.level = leveled.level;
          patch.stat_points = leveled.stat_points;
        }
        const { data: updated, error: updErr } = await client
          .from("career_progress")
          .update(patch)
          .eq("id", progress.id)
          .eq("auto_farm_last_at", progress.auto_farm_last_at)
          .select();
        if (updErr) throw updErr;
        if (updated && updated.length) results.push({ playerId: progress.player_id, won: battle.won });
      } catch (e) {
        console.error("processCareerAutoFarmTicks row failed", e);
      }
    }
    return results;
  }

  // ---------- 職業養成對決 Phase3:訓練期/對戰期銜接、排行榜、獎勵、稱號 ----------
  //
  // 訓練期/對戰期的「相」存在 events.rules(舊有的 dice 規則、auction 設定也是存在同一個
  // jsonb 欄位裡，同一套模式)，不新增欄位:
  //   rules.careerPhase: 'training' | 'battle'(沒設定過就當作沒開啟分期，兩邊頁面都直接開放，
  //                       跟 Phase1/2 原本的行為完全一樣，不會讓還沒設定過的舊測試活動壞掉)
  //   rules.trainingEndsAt: 訓練期結束時間(ISO字串)

  async function getCareerProgressFor(eventId, playerId) {
    const { data, error } = await client
      .from("career_progress")
      .select("*")
      .eq("event_id", eventId)
      .eq("player_id", playerId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // 主辦人開始訓練期:設定倒數分鐘數，寫入 trainingEndsAt。
  async function startCareerTrainingPhase(eventId, minutes) {
    const ev = await getEvent(eventId);
    const trainingEndsAt = new Date(Date.now() + minutes * 60 * 1000).toISOString();
    const rules = { ...(ev.rules || {}), careerPhase: "training", trainingMinutes: minutes, trainingEndsAt };
    const { error } = await client.from("events").update({ rules }).eq("id", eventId);
    if (error) throw error;
  }

  // 主辦人提前結束訓練期(有時候大家練完想早點開戰)，立刻切到對戰期。
  async function endCareerTrainingPhaseNow(eventId) {
    const ev = await getEvent(eventId);
    const rules = { ...(ev.rules || {}), careerPhase: "battle" };
    const { error } = await client.from("events").update({ rules }).eq("id", eventId);
    if (error) throw error;
  }

  // 時間到自動切:任何開著 tower.html/career.html 的分頁都會定期呼叫這個檢查，
  // 這是單純的「設成同一個值」，兩個分頁同時觸發也沒關係，不需要額外加鎖。
  async function maybeAdvanceCareerPhase(eventId) {
    const ev = await getEvent(eventId);
    const rules = ev.rules || {};
    if (rules.careerPhase !== "training" || !rules.trainingEndsAt) return false;
    if (new Date(rules.trainingEndsAt).getTime() > Date.now()) return false;
    await client
      .from("events")
      .update({ rules: { ...rules, careerPhase: "battle" } })
      .eq("id", eventId);
    return true;
  }

  // 最終積分 = PVP戰績分(含連勝加成，已經算在 current_score 裡) + 爬塔高度加成(每爬10層+5分)
  // (企劃書第九節；戰功勳章分目前還沒有可以買的商店，先跳過，等 Phase4 商店上線再併進來)
  async function computeCareerStandings(eventId) {
    const [queueRows, progressRows] = await Promise.all([
      client.from("career_pvp_queue").select("*, player:player_id(name)").eq("event_id", eventId),
      client.from("career_progress").select("player_id, floor").eq("event_id", eventId),
    ]);
    if (queueRows.error) throw queueRows.error;
    if (progressRows.error) throw progressRows.error;
    const floorByPlayer = {};
    (progressRows.data || []).forEach((p) => (floorByPlayer[p.player_id] = p.floor));
    const rows = (queueRows.data || []).map((q) => {
      const floor = floorByPlayer[q.player_id] || 0;
      const floorBonus = Math.floor(floor / 10) * 5;
      return { queueEntry: q, floor, floorBonus, score: q.current_score + floorBonus };
    });
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }

  // 職業養成對決結束時呼叫:結算名次、套用 reward_plan、順便判定稱號。
  async function closeCareerEvent(eventId) {
    const standings = await computeCareerStandings(eventId);
    const ev = await getEvent(eventId);
    for (let i = 0; i < standings.length; i++) {
      const rank = i + 1;
      const row = standings[i];
      await client
        .from("career_pvp_queue")
        .update({ final_rank: rank, reward: row.queueEntry.reward || rewardForRank(ev, rank) })
        .eq("id", row.queueEntry.id);
    }
    await setEventStatus(eventId, "closed");
    await awardCareerTitles(eventId, standings);
    return standings;
  }

  // 檢查「夜市擂台之王」(積分第一)、「爬塔霸主」(爬完目前開放的所有樓層)這兩個稱號，
  // 拿第一名的話也順手疊加 total_championships，讓 first_championship/triple_champion
  // 這兩個原本給錦標賽制用的稱號也能透過職業養成對決拿到，不用另外重寫一套判定。
  // 「歷史最高樓層」是取最大值、不是累加，grantTitleAndStats 只做累加，所以這裡另外用
  // 讀出來比大小再寫回去的方式處理，不能跟其他累計數字混在同一個 statPatch 裡。
  async function awardCareerTitles(eventId, standings) {
    if (!standings || !standings.length) return;
    const topFloor = window.CareerFloors ? window.CareerFloors.FLOORS.length : 20;
    for (let i = 0; i < standings.length; i++) {
      const row = standings[i];
      const playerId = row.queueEntry.player_id;
      const titleKeys = [];
      const profile = await getOrCreatePlayerProfile(playerId);

      if (i === 0) {
        titleKeys.push("career_champion", "first_championship");
        const totalChampionships = ((profile.lifetime_stats || {}).total_championships || 0) + 1;
        if (totalChampionships >= 3) titleKeys.push("triple_champion");
      }
      if (row.floor >= topFloor) titleKeys.push("tower_conqueror");

      const prevHighest = (profile.lifetime_stats || {}).career_highest_floor || 0;
      if (row.floor > prevHighest) {
        await client
          .from("player_profiles")
          .update({ lifetime_stats: { ...(profile.lifetime_stats || {}), career_highest_floor: row.floor } })
          .eq("player_id", playerId);
      }

      const statPatch = { career_total_wins: row.queueEntry.wins || 0 };
      if (i === 0) statPatch.total_championships = 1;
      if (titleKeys.length || row.queueEntry.wins) await grantTitleAndStats(playerId, titleKeys, statPatch);
    }
  }

  return {
    client,
    cancelAllRequests,
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
    TITLE_CATALOG,
    getPlayerProfile,
    getPlayerProfiles,
    setDisplayTitle,
    joinEvent,
    addTestBot,
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
    forceMatchWin,
    onTableChange,
    electLeader,
    joinAuctionEvent,
    getMyAuctionParticipant,
    listAuctionParticipants,
    listAuctionLots,
    startAuction,
    activateDueAuctionLots,
    settleExpiredAuctionLots,
    placeAuctionBid,
    submitSealedBid,
    claimFlashLot,
    useAppraisal,
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
    useAuctionSnipeTicket,
    inviteAuctionPartner,
    respondAuctionPartner,
    cancelAuctionPartner,
    submitAuctionPriceGuess,
    listMyAuctionPriceGuesses,
    listMySealedBids,
    computeAuctionStandings,
    closeAuctionEvent,
    setAuctionReward,
    getMyCareerBuild,
    saveCareerBuild,
    getCareerBuildFor,
    getMyCareerQueueEntry,
    joinCareerQueue,
    listCareerQueue,
    scanCareerMatchmaking,
    getMyActiveCareerMatch,
    getCareerMatch,
    initializeCareerMatch,
    submitCareerMove,
    updateCareerMatchState,
    finishCareerMatch,
    addCareerTestBot,
    getOrCreateCareerProgress,
    trainForCareerCoins,
    challengeCareerFloor,
    allocateCareerStatPoint,
    toggleCareerAutoFarm,
    processCareerAutoFarmTicks,
    getCareerProgressFor,
    startCareerTrainingPhase,
    endCareerTrainingPhaseNow,
    maybeAdvanceCareerPhase,
    computeCareerStandings,
    closeCareerEvent,
    awardCareerTitles,
  };
})();
