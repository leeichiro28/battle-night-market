// 夜市自走棋 · 音效(階段 5「逼——」)。純 WebAudio 合成,沒有音檔;瀏覽器要求使用者操作後才能出聲,所以第一次播放時才建立。
// 靜音設定記在 localStorage(讀寫都包 try/catch,存不到就當這次有效)。
window.AutochessSfx = (function () {
  const KEY = "ac_sfx_muted";
  let ctx = null, muted = false;
  try { muted = localStorage.getItem(KEY) === "1"; } catch (e) { /* 無痕模式等 */ }
  function ac() {
    if (ctx) return ctx;
    try { const C = window.AudioContext || window.webkitAudioContext; if (C) ctx = new C(); } catch (e) { ctx = null; }
    return ctx;
  }
  // 一個音:頻率、長度、波形、起始延遲、音量
  function tone(c, f, dur, type, at, vol) {
    const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + (at || 0);
    o.type = type || "sine"; o.frequency.setValueAtTime(f, t0);
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
  }
  const SOUNDS = {
    bell: (c) => { tone(c, 880, 0.9, "sine", 0, 0.18); tone(c, 1320, 0.5, "sine", 0, 0.06); },          // 逼——:階段開始
    tick: (c) => tone(c, 1200, 0.06, "square", 0, 0.05),                                                  // 倒數最後幾秒
    seal: (c) => { tone(c, 520, 0.12, "triangle", 0, 0.14); tone(c, 780, 0.18, "triangle", 0.1, 0.14); }, // 封板、開打
    win: (c) => { tone(c, 660, 0.14, "triangle", 0, 0.14); tone(c, 880, 0.14, "triangle", 0.12, 0.14); tone(c, 1320, 0.3, "triangle", 0.24, 0.14); },
    lose: (c) => { tone(c, 330, 0.2, "sawtooth", 0, 0.08); tone(c, 247, 0.35, "sawtooth", 0.18, 0.08); },
    out: (c) => { tone(c, 196, 1.1, "sine", 0, 0.2); tone(c, 196, 1.1, "sine", 0.55, 0.14); },            // 打烊鐘:淘汰
    champ: (c) => { [523, 659, 784, 1047].forEach((f, i) => tone(c, f, 0.25, "triangle", i * 0.13, 0.15)); },
  };
  function play(kind) {
    if (muted || !SOUNDS[kind]) return;
    const c = ac(); if (!c) return;
    try { if (c.state === "suspended") c.resume(); SOUNDS[kind](c); } catch (e) { /* 出不了聲就算了 */ }
  }
  function setMuted(m) { muted = !!m; try { localStorage.setItem(KEY, muted ? "1" : "0"); } catch (e) { /* ignore */ } }
  return { play, setMuted, isMuted: () => muted, kinds: Object.keys(SOUNDS) };
})();
