/* =========================================================
   audio.js - WebAudio 합성 사운드 (외부 음원 파일 없음)
   ========================================================= */

const SFX = (function () {
  let ctx = null;
  let master = null; // 모든 소스가 모이는 버스 (컴프레서 앞)
  let outGain = null; // 사용자 음량 (컴프레서 뒤)
  let noiseBuf = null;
  let ambientNodes = [];
  let muted = false;
  let volume = 0.8;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();

    master = ctx.createGain();
    master.gain.value = 1;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 10;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;

    // 음량은 컴프레서 "뒤"에 둔다. 앞에 두면 볼륨을 올릴수록
    // 컴프레서가 더 눌러버려서 오히려 소리가 납작해진다.
    outGain = ctx.createGain();
    outGain.gain.value = muted ? 0 : volume;

    master.connect(comp);
    comp.connect(outGain);
    outGain.connect(ctx.destination);

    // 화이트노이즈 버퍼 (2초)
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function resume() {
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function setVolume(v) {
    volume = v;
    if (outGain) outGain.gain.value = muted ? 0 : v;
  }

  function setMuted(m) {
    muted = m;
    if (outGain) outGain.gain.value = muted ? 0 : volume;
  }

  function now() {
    return ctx.currentTime;
  }

  function noiseSource() {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    s.playbackRate.value = rand(0.8, 1.2);
    return s;
  }

  function env(gainNode, t0, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t0);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak), t0 + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  }

  /* ---------- 총성 ---------- */
  function shot(kind, vol) {
    if (!ctx) return;
    vol = (vol === undefined ? 1 : vol) * 0.9;
    const t = now();

    const cfg = {
      pistol: { low: 150, decay: 0.16, lp: 3000, body: 0.55, crack: 0.5 },
      shotgun: { low: 90, decay: 0.34, lp: 2000, body: 0.9, crack: 0.75 },
      rifle: { low: 120, decay: 0.2, lp: 4200, body: 0.6, crack: 0.62 },
    }[kind] || { low: 150, decay: 0.16, lp: 3000, body: 0.5, crack: 0.5 };

    // 노이즈 크랙
    const n = noiseSource();
    const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.setValueAtTime(cfg.lp * 2.4, t);
    nf.frequency.exponentialRampToValueAtTime(320, t + cfg.decay);
    nf.Q.value = 0.8;
    env(ng, t, cfg.crack * vol, 0.002, cfg.decay);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    n.start(t);
    n.stop(t + cfg.decay + 0.06);

    // 저역 펀치
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(cfg.low, t);
    o.frequency.exponentialRampToValueAtTime(38, t + cfg.decay * 0.9);
    env(og, t, cfg.body * vol, 0.003, cfg.decay * 0.9);
    o.connect(og);
    og.connect(master);
    o.start(t);
    o.stop(t + cfg.decay + 0.06);

    // 복도 잔향(짧은 테일)
    const tail = noiseSource();
    const tg = ctx.createGain();
    const tf = ctx.createBiquadFilter();
    tf.type = 'bandpass';
    tf.frequency.value = 700;
    tf.Q.value = 1.4;
    env(tg, t + 0.03, 0.12 * vol, 0.04, 0.5);
    tail.connect(tf);
    tf.connect(tg);
    tg.connect(master);
    tail.start(t + 0.02);
    tail.stop(t + 0.65);
  }

  /* ---------- 빈 탄창 딸깍 ---------- */
  function dryFire() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(900, t);
    o.frequency.exponentialRampToValueAtTime(240, t + 0.04);
    env(g, t, 0.14, 0.002, 0.05);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.1);
  }

  /* ---------- 재장전 (여러 번의 금속음) ---------- */
  function reload(dur) {
    if (!ctx) return;
    const steps = [0.0, dur * 0.35, dur * 0.72];
    steps.forEach((off, i) => {
      const t = now() + off;
      const n = noiseSource();
      const g = ctx.createGain();
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1400 + i * 700;
      f.Q.value = 3.5;
      env(g, t, 0.3, 0.003, 0.07);
      n.connect(f);
      f.connect(g);
      g.connect(master);
      n.start(t);
      n.stop(t + 0.14);
    });
  }

  /* ---------- 피격(살점) ---------- */
  function flesh(vol) {
    if (!ctx) return;
    const t = now();
    const n = noiseSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(1600, t);
    f.frequency.exponentialRampToValueAtTime(240, t + 0.12);
    env(g, t, 0.34 * (vol || 1), 0.002, 0.13);
    n.connect(f);
    f.connect(g);
    g.connect(master);
    n.start(t);
    n.stop(t + 0.2);
  }

  /* ---------- 헤드샷 확인음 ---------- */
  function headshot() {
    if (!ctx) return;
    const t = now();
    [1400, 2100].forEach((fr, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = fr;
      env(g, t + i * 0.035, 0.16, 0.003, 0.09);
      o.connect(g);
      g.connect(master);
      o.start(t + i * 0.035);
      o.stop(t + i * 0.035 + 0.16);
    });
  }

  /* ---------- 벽 탄착 ---------- */
  function impact(vol) {
    if (!ctx) return;
    const t = now();
    const n = noiseSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 1800;
    env(g, t, 0.16 * (vol || 1), 0.001, 0.08);
    n.connect(f);
    f.connect(g);
    g.connect(master);
    n.start(t);
    n.stop(t + 0.14);
  }

  /* ---------- 좀비 신음 ---------- */
  function groan(dist, aggressive) {
    if (!ctx) return;
    const att = clamp(1 - dist / 45, 0.05, 1);
    if (att <= 0.06) return;
    const t = now();
    const dur = aggressive ? rand(0.5, 0.8) : rand(0.9, 1.5);
    const base = aggressive ? rand(115, 165) : rand(58, 96);

    const o = ctx.createOscillator();
    const o2 = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o2.type = 'square';
    o.frequency.setValueAtTime(base, t);
    o.frequency.linearRampToValueAtTime(base * rand(0.6, 0.85), t + dur);
    o2.frequency.setValueAtTime(base * 1.01, t);
    o2.frequency.linearRampToValueAtTime(base * 0.62, t + dur);
    f.type = 'lowpass';
    f.frequency.setValueAtTime(rand(400, 800), t);
    f.frequency.linearRampToValueAtTime(220, t + dur);
    f.Q.value = 5;

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22 * att, t + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    o.connect(f);
    o2.connect(f);
    f.connect(g);
    g.connect(master);
    o.start(t);
    o2.start(t);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
  }

  /* ---------- 좀비 사망 ---------- */
  function zombieDeath(dist) {
    if (!ctx) return;
    const att = clamp(1 - dist / 40, 0.05, 1);
    const t = now();
    const dur = rand(0.6, 0.9);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(150, 210), t);
    o.frequency.exponentialRampToValueAtTime(42, t + dur);
    f.type = 'lowpass';
    f.frequency.value = 900;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25 * att, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f);
    f.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + dur + 0.05);
    flesh(0.6 * att);
  }

  /* ---------- 플레이어 피격 ---------- */
  function hurt() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.3);
    env(g, t, 0.5, 0.004, 0.3);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 0.4);

    const n = noiseSource();
    const ng = ctx.createGain();
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 900;
    env(ng, t, 0.3, 0.003, 0.22);
    n.connect(nf);
    nf.connect(ng);
    ng.connect(master);
    n.start(t);
    n.stop(t + 0.3);
  }

  /* ---------- 아이템 획득 ---------- */
  function pickup(kind) {
    if (!ctx) return;
    const t = now();
    const seq = kind === 'health' ? [523, 659, 784] : [392, 523, 659];
    seq.forEach((fr, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = fr;
      env(g, t + i * 0.06, 0.2, 0.005, 0.14);
      o.connect(g);
      g.connect(master);
      o.start(t + i * 0.06);
      o.stop(t + i * 0.06 + 0.22);
    });
  }

  /* ---------- 웨이브 시작 경보 ---------- */
  function alarm() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'sawtooth';
    f.type = 'lowpass';
    f.frequency.value = 1400;
    o.frequency.setValueAtTime(330, t);
    o.frequency.linearRampToValueAtTime(560, t + 0.5);
    o.frequency.linearRampToValueAtTime(330, t + 1.0);
    o.frequency.linearRampToValueAtTime(560, t + 1.5);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.18, t + 0.12);
    g.gain.setValueAtTime(0.18, t + 1.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.9);
    o.connect(f);
    f.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 2.0);
  }

  /* ---------- 웨이브 클리어 ---------- */
  function waveClear() {
    if (!ctx) return;
    const t = now();
    [523, 659, 784, 1047].forEach((fr, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.value = fr;
      env(g, t + i * 0.1, 0.18, 0.01, 0.3);
      o.connect(g);
      g.connect(master);
      o.start(t + i * 0.1);
      o.stop(t + i * 0.1 + 0.42);
    });
  }

  /* ---------- 발소리 ---------- */
  function step(run) {
    if (!ctx) return;
    const t = now();
    const n = noiseSource();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = rand(180, 340);
    f.Q.value = 1.1;
    env(g, t, run ? 0.14 : 0.08, 0.004, 0.075);
    n.connect(f);
    f.connect(g);
    g.connect(master);
    n.start(t);
    n.stop(t + 0.13);
  }

  /* ---------- 게임오버 ---------- */
  function gameOver() {
    if (!ctx) return;
    const t = now();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 2.2);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.28, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    o.connect(g);
    g.connect(master);
    o.start(t);
    o.stop(t + 2.5);
  }

  /* ---------- 환경음(저주파 드론 + 바람) ---------- */
  function startAmbient() {
    if (!ctx || ambientNodes.length) return;
    const t = now();

    const o1 = ctx.createOscillator();
    const g1 = ctx.createGain();
    o1.type = 'sine';
    o1.frequency.value = 47;
    g1.gain.setValueAtTime(0.0001, t);
    g1.gain.exponentialRampToValueAtTime(0.1, t + 3);
    o1.connect(g1);
    g1.connect(master);
    o1.start(t);

    const o2 = ctx.createOscillator();
    const g2 = ctx.createGain();
    o2.type = 'sine';
    o2.frequency.value = 71;
    g2.gain.setValueAtTime(0.0001, t);
    g2.gain.exponentialRampToValueAtTime(0.045, t + 5);
    o2.connect(g2);
    g2.connect(master);
    o2.start(t);

    const wind = noiseSource();
    const wf = ctx.createBiquadFilter();
    const wg = ctx.createGain();
    wf.type = 'bandpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.6;
    wg.gain.setValueAtTime(0.0001, t);
    wg.gain.exponentialRampToValueAtTime(0.035, t + 4);
    wind.connect(wf);
    wf.connect(wg);
    wg.connect(master);
    wind.start(t);

    // 바람 세기 흔들기
    const lfo = ctx.createOscillator();
    const lfoG = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.08;
    lfoG.gain.value = 0.022;
    lfo.connect(lfoG);
    lfoG.connect(wg.gain);
    lfo.start(t);

    ambientNodes = [o1, o2, wind, lfo];
  }

  function stopAmbient() {
    ambientNodes.forEach((n) => {
      try {
        n.stop();
      } catch (e) {
        /* 이미 멈춘 노드 */
      }
    });
    ambientNodes = [];
  }

  /* ---------- 심장박동(체력 낮을 때) ---------- */
  function heartbeat(intensity) {
    if (!ctx) return;
    const t = now();
    [0, 0.19].forEach((off, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(72, t + off);
      o.frequency.exponentialRampToValueAtTime(34, t + off + 0.14);
      env(g, t + off, (i ? 0.22 : 0.33) * intensity, 0.008, 0.15);
      o.connect(g);
      g.connect(master);
      o.start(t + off);
      o.stop(t + off + 0.25);
    });
  }

  return {
    init,
    resume,
    setVolume,
    setMuted,
    shot,
    dryFire,
    reload,
    flesh,
    headshot,
    impact,
    groan,
    zombieDeath,
    hurt,
    pickup,
    alarm,
    waveClear,
    step,
    gameOver,
    startAmbient,
    stopAmbient,
    heartbeat,
    get ready() {
      return !!ctx;
    },
  };
})();
