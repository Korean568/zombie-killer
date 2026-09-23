/* =========================================================
   textures.js - 캔버스로 직접 그리는 절차적 텍스처
   (외부 이미지 파일 없이 폐교 분위기를 만든다)
   ========================================================= */

const TEX = (function () {
  let maxAniso = 4;
  const cache = {};

  function setRenderer(renderer) {
    maxAniso = renderer.capabilities.getMaxAnisotropy();
  }

  function cv(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
  }

  function finish(canvas, repeat, srgb) {
    const t = new THREE.CanvasTexture(canvas);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (repeat) t.repeat.set(repeat, repeat);
    t.anisotropy = maxAniso;
    if (srgb !== false) t.encoding = THREE.sRGBEncoding;
    return t;
  }

  /* 얼룩 / 노이즈 공통 */
  function grain(ctx, size, amount, alpha) {
    const img = ctx.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (Math.random() - 0.5) * amount;
      d[i] = clamp(d[i] + n, 0, 255);
      d[i + 1] = clamp(d[i + 1] + n, 0, 255);
      d[i + 2] = clamp(d[i + 2] + n, 0, 255);
    }
    ctx.putImageData(img, 0, 0);
    if (alpha) {
      ctx.globalAlpha = alpha;
      ctx.globalAlpha = 1;
    }
  }

  function blotches(ctx, size, count, color, rMin, rMax, alphaMax) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      const r = rand(rMin, rMax);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, color.replace('ALPHA', rand(alphaMax * 0.4, alphaMax).toFixed(3)));
      g.addColorStop(1, color.replace('ALPHA', '0'));
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }

  function cracks(ctx, size, count, color, width) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      let x = Math.random() * size;
      let y = Math.random() * size;
      let a = Math.random() * Math.PI * 2;
      ctx.lineWidth = rand(width * 0.5, width);
      ctx.beginPath();
      ctx.moveTo(x, y);
      const seg = randInt(4, 10);
      for (let s = 0; s < seg; s++) {
        a += rand(-0.7, 0.7);
        const len = rand(6, 26);
        x += Math.cos(a) * len;
        y += Math.sin(a) * len;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  /* ---------- 복도 장판 (체크 타일) ---------- */
  function corridorFloor() {
    if (cache.corridorFloor) return cache.corridorFloor;
    const s = 512;
    const c = cv(s);
    const ctx = c.getContext('2d');
    const tiles = 4;
    const tw = s / tiles;
    for (let y = 0; y < tiles; y++) {
      for (let x = 0; x < tiles; x++) {
        const dark = (x + y) % 2 === 0;
        ctx.fillStyle = dark ? '#4a4b45' : '#5d5e56';
        ctx.fillRect(x * tw, y * tw, tw, tw);
        // 타일별 미묘한 색편차
        ctx.fillStyle = 'rgba(0,0,0,' + rand(0, 0.08).toFixed(3) + ')';
        ctx.fillRect(x * tw, y * tw, tw, tw);
      }
    }
    // 타일 줄눈
    ctx.strokeStyle = 'rgba(20,20,18,0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= tiles; i++) {
      ctx.beginPath();
      ctx.moveTo(i * tw, 0);
      ctx.lineTo(i * tw, s);
      ctx.moveTo(0, i * tw);
      ctx.lineTo(s, i * tw);
      ctx.stroke();
    }
    blotches(ctx, s, 40, 'rgba(30,26,20,ALPHA)', 10, 70, 0.4);
    blotches(ctx, s, 10, 'rgba(90,85,70,ALPHA)', 20, 90, 0.16);
    cracks(ctx, s, 14, 'rgba(15,15,14,0.5)', 2);
    grain(ctx, s, 26);
    cache.corridorFloor = finish(c, 1);
    return cache.corridorFloor;
  }

  /* ---------- 교실 바닥 (낡은 마루) ---------- */
  function classFloor() {
    if (cache.classFloor) return cache.classFloor;
    const s = 512;
    const c = cv(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#4b3c2a';
    ctx.fillRect(0, 0, s, s);
    const planks = 8;
    const ph = s / planks;
    for (let i = 0; i < planks; i++) {
      const shade = rand(-16, 16);
      ctx.fillStyle =
        'rgb(' + (92 + shade) + ',' + (72 + shade) + ',' + (48 + shade) + ')';
      ctx.fillRect(0, i * ph, s, ph - 1);
      // 나뭇결
      ctx.strokeStyle = 'rgba(40,28,16,0.35)';
      ctx.lineWidth = 1;
      for (let k = 0; k < 8; k++) {
        const y = i * ph + rand(2, ph - 3);
        ctx.beginPath();
        ctx.moveTo(0, y);
        for (let x = 0; x <= s; x += 32) {
          ctx.lineTo(x, y + Math.sin(x * 0.05 + i) * 1.6);
        }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(10,6,2,0.55)';
      ctx.fillRect(0, i * ph + ph - 2, s, 2);
    }
    blotches(ctx, s, 34, 'rgba(18,12,4,ALPHA)', 14, 80, 0.45);
    cracks(ctx, s, 8, 'rgba(12,8,4,0.45)', 2);
    grain(ctx, s, 22);
    cache.classFloor = finish(c, 1);
    return cache.classFloor;
  }

  /* ---------- 체육관 마루 ---------- */
  function gymFloor() {
    if (cache.gymFloor) return cache.gymFloor;
    const s = 512;
    const c = cv(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#7d5f37';
    ctx.fillRect(0, 0, s, s);
    const planks = 12;
    const ph = s / planks;
    for (let i = 0; i < planks; i++) {
      const shade = rand(-14, 14);
      ctx.fillStyle =
        'rgb(' + (134 + shade) + ',' + (100 + shade) + ',' + (56 + shade) + ')';
      ctx.fillRect(0, i * ph, s, ph - 1);
      ctx.strokeStyle = 'rgba(70,48,20,0.3)';
      for (let k = 0; k < 5; k++) {
        const y = i * ph + rand(2, ph - 3);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(s, y + rand(-1.5, 1.5));
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(30,18,4,0.5)';
      ctx.fillRect(0, i * ph + ph - 2, s, 2);
    }
    blotches(ctx, s, 26, 'rgba(24,14,2,ALPHA)', 16, 70, 0.38);
    grain(ctx, s, 18);
    cache.gymFloor = finish(c, 1);
    return cache.gymFloor;
  }

  /* ---------- 벽 (벗겨진 회벽) ---------- */
  function wall() {
    if (cache.wall) return cache.wall;
    const s = 512;
    const c = cv(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#9aa091';
    ctx.fillRect(0, 0, s, s);

    // 아래쪽 허리 페인트(학교 특유의 두 톤 벽)
    ctx.fillStyle = '#5d7364';
    ctx.fillRect(0, s * 0.62, s, s * 0.38);
    ctx.fillStyle = 'rgba(30,40,34,0.6)';
    ctx.fillRect(0, s * 0.62, s, 4);

    // 페인트 벗겨짐
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * s;
      const y = s * 0.62 + Math.random() * s * 0.38;
      ctx.fillStyle = 'rgba(150,152,138,' + rand(0.3, 0.75).toFixed(2) + ')';
      ctx.beginPath();
      const r = rand(6, 26);
      ctx.moveTo(x, y);
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        ctx.lineTo(x + Math.cos(a) * r * rand(0.6, 1.3), y + Math.sin(a) * r * rand(0.6, 1.3));
      }
      ctx.closePath();
      ctx.fill();
    }

    blotches(ctx, s, 50, 'rgba(58,50,34,ALPHA)', 14, 90, 0.4);
    blotches(ctx, s, 14, 'rgba(24,34,22,ALPHA)', 30, 110, 0.28);
    cracks(ctx, s, 22, 'rgba(45,45,42,0.55)', 2.2);
    grain(ctx, s, 24);
    cache.wall = finish(c, 1);
    return cache.wall;
  }

  /* ---------- 천장 텍스 ---------- */
  function ceiling() {
    if (cache.ceiling) return cache.ceiling;
    const s = 256;
    const c = cv(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#8f8d82';
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(40,40,36,0.8)';
    ctx.lineWidth = 4;
    ctx.strokeRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(55,55,50,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.stroke();
    blotches(ctx, s, 22, 'rgba(70,52,20,ALPHA)', 12, 60, 0.5); // 누수 자국
    grain(ctx, s, 22);
    cache.ceiling = finish(c, 1);
    return cache.ceiling;
  }

  /* ---------- 칠판 ---------- */
  function blackboard() {
    if (cache.blackboard) return cache.blackboard;
    const w = 1024;
    const h = 512;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#1d2a22';
    ctx.fillRect(0, 0, w, h);
    // 분필 지운 자국
    for (let i = 0; i < 90; i++) {
      ctx.strokeStyle = 'rgba(210,220,205,' + rand(0.02, 0.09).toFixed(3) + ')';
      ctx.lineWidth = rand(8, 30);
      ctx.beginPath();
      const y = Math.random() * h;
      ctx.moveTo(rand(-40, w * 0.4), y);
      ctx.lineTo(rand(w * 0.5, w + 40), y + rand(-16, 16));
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(226,232,220,0.82)';
    ctx.font = 'bold 74px "Malgun Gothic", sans-serif';
    ctx.fillText('졸업을 축하합니다', 90, 150);
    ctx.font = 'bold 58px "Malgun Gothic", sans-serif';
    ctx.fillStyle = 'rgba(226,232,220,0.45)';
    ctx.fillText('2009. 2. 12.  제 47회', 110, 250);
    ctx.font = 'bold 92px "Malgun Gothic", sans-serif';
    ctx.fillStyle = 'rgba(190,40,30,0.78)';
    ctx.save();
    ctx.rotate(-0.06);
    ctx.fillText('나가지 마', 150, 420);
    ctx.restore();
    grain(ctx, Math.min(w, h), 14);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = maxAniso;
    t.encoding = THREE.sRGBEncoding;
    cache.blackboard = t;
    return t;
  }

  /* ---------- 사물함 ---------- */
  function locker() {
    if (cache.locker) return cache.locker;
    const s = 256;
    const c = cv(s);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#3f5a63';
    ctx.fillRect(0, 0, s, s);
    const cols = 2;
    const rows = 3;
    const cw = s / cols;
    const ch = s / rows;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const px = x * cw;
        const py = y * ch;
        ctx.fillStyle = 'rgb(' + randInt(58, 80) + ',' + randInt(86, 104) + ',' + randInt(94, 112) + ')';
        ctx.fillRect(px + 4, py + 4, cw - 8, ch - 8);
        ctx.strokeStyle = 'rgba(15,25,28,0.9)';
        ctx.lineWidth = 3;
        ctx.strokeRect(px + 4, py + 4, cw - 8, ch - 8);
        // 통풍구
        ctx.fillStyle = 'rgba(12,20,22,0.85)';
        for (let v = 0; v < 4; v++) {
          ctx.fillRect(px + cw * 0.22, py + 14 + v * 7, cw * 0.56, 3);
        }
        // 손잡이
        ctx.fillStyle = '#20282a';
        ctx.fillRect(px + cw - 26, py + ch * 0.48, 12, 16);
      }
    }
    blotches(ctx, s, 26, 'rgba(90,40,10,ALPHA)', 6, 34, 0.55); // 녹
    grain(ctx, s, 20);
    cache.locker = finish(c, 1);
    return cache.locker;
  }

  /* ---------- 창문 (달빛) ---------- */
  function window_() {
    if (cache.window) return cache.window;
    const s = 256;
    const c = cv(s);
    const ctx = c.getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, s);
    g.addColorStop(0, '#5b7fa8');
    g.addColorStop(0.55, '#33506e');
    g.addColorStop(1, '#16222f');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    // 창틀
    ctx.fillStyle = '#20241f';
    ctx.fillRect(0, 0, s, 8);
    ctx.fillRect(0, s - 8, s, 8);
    ctx.fillRect(0, 0, 8, s);
    ctx.fillRect(s - 8, 0, 8, s);
    ctx.fillRect(s / 2 - 4, 0, 8, s);
    ctx.fillRect(0, s / 2 - 4, s, 8);
    // 깨진 유리 금
    ctx.strokeStyle = 'rgba(200,225,255,0.5)';
    cracks(ctx, s, 5, 'rgba(210,230,255,0.45)', 1.6);
    // 먼지
    blotches(ctx, s, 18, 'rgba(10,14,18,ALPHA)', 10, 46, 0.5);
    cache.window = finish(c, 1);
    return cache.window;
  }

  /* ---------- 혈흔 데칼 (알파) ---------- */
  function blood() {
    if (cache.blood) return cache.blood;
    const s = 256;
    const c = cv(s);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    const cy = s / 2;
    const g = ctx.createRadialGradient(cx, cy, 4, cx, cy, s * 0.36);
    g.addColorStop(0, 'rgba(96,6,6,0.95)');
    g.addColorStop(0.6, 'rgba(70,4,4,0.7)');
    g.addColorStop(1, 'rgba(48,2,2,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(cx + s * 0.3, cy);
    for (let a = 0; a < Math.PI * 2; a += 0.28) {
      const r = s * 0.3 * rand(0.6, 1.25);
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    // 튄 자국
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(s * 0.2, s * 0.48);
      const r = rand(1.5, 8);
      ctx.fillStyle = 'rgba(' + randInt(70, 110) + ',4,4,' + rand(0.3, 0.85).toFixed(2) + ')';
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = maxAniso;
    t.encoding = THREE.sRGBEncoding;
    cache.blood = t;
    return t;
  }

  /* ---------- 탄흔 ---------- */
  function bulletHole() {
    if (cache.bulletHole) return cache.bulletHole;
    const s = 64;
    const c = cv(s);
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, s, s);
    const g = ctx.createRadialGradient(s / 2, s / 2, 2, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.95)');
    g.addColorStop(0.35, 'rgba(18,16,14,0.8)');
    g.addColorStop(0.62, 'rgba(120,115,105,0.45)');
    g.addColorStop(1, 'rgba(120,115,105,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = maxAniso;
    t.encoding = THREE.sRGBEncoding;
    cache.bulletHole = t;
    return t;
  }

  /* ---------- 경고 포스터 ---------- */
  function poster(idx) {
    const key = 'poster' + idx;
    if (cache[key]) return cache[key];
    const w = 256;
    const h = 362;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    const texts = [
      ['대피 안내', '지하 체육관', '집결'],
      ['출입 금지', '감염 구역', '1999'],
      ['가을 운동회', '10월 9일', '전교생'],
      ['폐교 안내', '본교는 2009년', '폐교되었습니다'],
    ][idx % 4];
    ctx.fillStyle = idx % 2 ? '#d8d2bd' : '#cfd8cc';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = idx % 2 ? '#9c2018' : '#1e3a5c';
    ctx.fillRect(0, 0, w, 64);
    ctx.fillStyle = '#f5f2e6';
    ctx.font = 'bold 40px "Malgun Gothic", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(texts[0], w / 2, 46);
    ctx.fillStyle = '#20242a';
    ctx.font = 'bold 30px "Malgun Gothic", sans-serif';
    ctx.fillText(texts[1], w / 2, 150);
    ctx.font = '24px "Malgun Gothic", sans-serif';
    ctx.fillText(texts[2], w / 2, 200);
    ctx.strokeStyle = 'rgba(40,40,40,0.5)';
    ctx.lineWidth = 3;
    ctx.strokeRect(12, 80, w - 24, h - 100);
    blotches(ctx, Math.max(w, h), 22, 'rgba(60,44,20,ALPHA)', 10, 60, 0.45);
    grain(ctx, Math.min(w, h), 18);
    const t = new THREE.CanvasTexture(c);
    t.anisotropy = maxAniso;
    t.encoding = THREE.sRGBEncoding;
    cache[key] = t;
    return t;
  }

  /* ---------- 좀비 피부(얼룩덜룩한 회녹색) ---------- */
  function zombieSkin(variant) {
    const key = 'skin' + variant;
    if (cache[key]) return cache[key];
    const s = 128;
    const c = cv(s);
    const ctx = c.getContext('2d');
    const base = [
      [124, 134, 106],
      [108, 118, 104],
      [136, 128, 108],
      [96, 110, 96],
    ][variant % 4];
    ctx.fillStyle = 'rgb(' + base[0] + ',' + base[1] + ',' + base[2] + ')';
    ctx.fillRect(0, 0, s, s);
    blotches(ctx, s, 26, 'rgba(60,30,26,ALPHA)', 4, 26, 0.6);
    blotches(ctx, s, 14, 'rgba(120,20,16,ALPHA)', 3, 16, 0.7);
    blotches(ctx, s, 16, 'rgba(160,168,140,ALPHA)', 4, 20, 0.35);
    grain(ctx, s, 34);
    cache[key] = finish(c, 1);
    return cache[key];
  }


  /* ---------- 점프스케어용 좀비 얼굴 ---------- */
  function jumpscareFace() {
    if (cache.scareFace) return cache.scareFace;
    const s = 768;
    const c = cv(s);
    const ctx = c.getContext('2d');
    const cx = s / 2;
    const cy = s * 0.5;

    ctx.fillStyle = '#070605';
    ctx.fillRect(0, 0, s, s);

    /* 얼굴 덩어리 */
    const skin = ctx.createRadialGradient(cx, cy - s * 0.12, s * 0.04, cx, cy, s * 0.5);
    skin.addColorStop(0, '#c2bfa2');
    skin.addColorStop(0.45, '#8e8d72');
    skin.addColorStop(0.78, '#55583f');
    skin.addColorStop(1, '#1a1c14');
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(cx, cy, s * 0.33, s * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 광대와 관자놀이 음영 */
    ctx.globalCompositeOperation = 'multiply';
    [[-0.19, -0.02, 0.1], [0.19, -0.02, 0.1], [0, 0.3, 0.16]].forEach(function (p) {
      const g = ctx.createRadialGradient(
        cx + p[0] * s, cy + p[1] * s, 2, cx + p[0] * s, cy + p[1] * s, s * p[2]
      );
      g.addColorStop(0, 'rgba(60,58,44,1)');
      g.addColorStop(1, 'rgba(255,255,255,1)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    });
    ctx.globalCompositeOperation = 'source-over';

    /* 눈구멍 + 붉은 눈 */
    function socket(ex, ey) {
      const g = ctx.createRadialGradient(ex, ey, 2, ex, ey, s * 0.115);
      g.addColorStop(0, 'rgba(0,0,0,1)');
      g.addColorStop(0.62, 'rgba(10,6,5,.95)');
      g.addColorStop(1, 'rgba(20,16,10,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(ex, ey, s * 0.115, s * 0.088, 0, 0, Math.PI * 2);
      ctx.fill();

      // 눈알
      ctx.fillStyle = '#d8d2c0';
      ctx.beginPath();
      ctx.ellipse(ex, ey + s * 0.006, s * 0.052, s * 0.04, 0, 0, Math.PI * 2);
      ctx.fill();
      // 실핏줄
      ctx.strokeStyle = 'rgba(150,20,14,.75)';
      ctx.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        const a = Math.random() * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(ex + Math.cos(a) * s * 0.012, ey + Math.sin(a) * s * 0.01);
        ctx.lineTo(ex + Math.cos(a) * s * 0.05, ey + Math.sin(a) * s * 0.038);
        ctx.stroke();
      }
      // 홍채
      const ig = ctx.createRadialGradient(ex, ey, 1, ex, ey, s * 0.024);
      ig.addColorStop(0, '#ff6a4a');
      ig.addColorStop(0.5, '#b0170c');
      ig.addColorStop(1, '#2a0603');
      ctx.fillStyle = ig;
      ctx.beginPath();
      ctx.arc(ex, ey, s * 0.024, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#000';
      ctx.beginPath();
      ctx.arc(ex, ey, s * 0.009, 0, Math.PI * 2);
      ctx.fill();
    }
    socket(cx - s * 0.145, cy - s * 0.1);
    socket(cx + s * 0.145, cy - s * 0.1);

    /* 코 */
    ctx.fillStyle = 'rgba(8,6,4,.92)';
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.02);
    ctx.lineTo(cx - s * 0.042, cy + s * 0.075);
    ctx.lineTo(cx + s * 0.042, cy + s * 0.075);
    ctx.closePath();
    ctx.fill();

    /* 벌어진 입 */
    ctx.fillStyle = '#0a0403';
    ctx.beginPath();
    ctx.ellipse(cx, cy + s * 0.22, s * 0.15, s * 0.135, 0, 0, Math.PI * 2);
    ctx.fill();

    /* 이빨 */
    ctx.fillStyle = '#cfc6a8';
    const tw = s * 0.032;
    for (let i = -4; i <= 4; i++) {
      const tx = cx + i * tw;
      const h = s * (0.03 + Math.random() * 0.026);
      // 윗니
      ctx.beginPath();
      ctx.moveTo(tx - tw * 0.42, cy + s * 0.09);
      ctx.lineTo(tx + tw * 0.42, cy + s * 0.09);
      ctx.lineTo(tx, cy + s * 0.09 + h);
      ctx.closePath();
      ctx.fill();
      // 아랫니
      if (Math.random() > 0.25) {
        const h2 = s * (0.024 + Math.random() * 0.022);
        ctx.beginPath();
        ctx.moveTo(tx - tw * 0.4, cy + s * 0.352);
        ctx.lineTo(tx + tw * 0.4, cy + s * 0.352);
        ctx.lineTo(tx, cy + s * 0.352 - h2);
        ctx.closePath();
        ctx.fill();
      }
    }

    /* 입가 핏자국 */
    for (let i = 0; i < 16; i++) {
      const bx = cx + rand(-0.15, 0.15) * s;
      const by = cy + s * 0.33 + Math.random() * s * 0.12;
      ctx.fillStyle = 'rgba(' + randInt(90, 140) + ',6,6,' + rand(0.4, 0.9).toFixed(2) + ')';
      ctx.beginPath();
      ctx.ellipse(bx, by, rand(3, 11), rand(8, 34), 0, 0, Math.PI * 2);
      ctx.fill();
    }

    /* 피부 얼룩과 갈라짐 */
    blotches(ctx, s, 40, 'rgba(46,26,20,ALPHA)', 10, 70, 0.55);
    blotches(ctx, s, 16, 'rgba(120,18,12,ALPHA)', 6, 34, 0.5);
    cracks(ctx, s, 26, 'rgba(24,14,10,0.55)', 2.4);
    grain(ctx, s, 26);

    /* 가장자리를 어둠에 묻는다 */
    const vig = ctx.createRadialGradient(cx, cy, s * 0.26, cx, cy, s * 0.56);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, s, s);

    cache.scareFace = c.toDataURL('image/png');
    return cache.scareFace;
  }

  /* ---------- 하늘/배경 없음: 안개색만 사용 ---------- */

  return {
    setRenderer,
    corridorFloor,
    classFloor,
    gymFloor,
    wall,
    ceiling,
    blackboard,
    locker,
    window: window_,
    blood,
    bulletHole,
    poster,
    zombieSkin,
    jumpscareFace,
  };
})();
