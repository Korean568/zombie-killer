/* =========================================================
   utils.js - 공용 헬퍼
   ========================================================= */

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const dampen = (cur, target, rate, dt) => lerp(cur, target, 1 - Math.exp(-rate * dt));

/* 시드 기반 난수 (맵 장식을 매번 동일하게 만들고 싶을 때) */
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* 변환 행렬 간편 생성 */
function MAT(x, y, z, rx, ry, rz, sx, sy, sz) {
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rx || 0, ry || 0, rz || 0, 'XYZ')
  );
  m.compose(
    new THREE.Vector3(x || 0, y || 0, z || 0),
    q,
    new THREE.Vector3(sx === undefined ? 1 : sx, sy === undefined ? 1 : sy, sz === undefined ? 1 : sz)
  );
  return m;
}

/*
  여러 개의 지오메트리를 하나로 합친다.
  parts: [{ geo, matrix, color }]
  색을 넘기면 vertexColors 용 color 속성이 만들어진다. -> 드로우콜 1회로 소품 렌더링
*/
function mergeParts(parts) {
  const geos = [];
  const colors = [];
  let total = 0;
  let useColor = false;

  for (const p of parts) {
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    if (p.matrix) g.applyMatrix4(p.matrix);
    geos.push(g);
    colors.push(p.color ? new THREE.Color(p.color) : null);
    if (p.color) useColor = true;
    total += g.attributes.position.count;
  }

  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = useColor ? new Float32Array(total * 3) : null;

  let po = 0;
  let uo = 0;
  for (let i = 0; i < geos.length; i++) {
    const g = geos[i];
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array, po);
    nor.set(g.attributes.normal.array, po);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, uo);
    if (col) {
      const c = colors[i] || new THREE.Color(0xffffff);
      for (let k = 0; k < n; k++) {
        col[po + k * 3] = c.r;
        col[po + k * 3 + 1] = c.g;
        col[po + k * 3 + 2] = c.b;
      }
    }
    po += n * 3;
    uo += n * 2;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (col) out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/*
  파트를 색깔별로 묶어 [{geo, color}] 로 돌려준다.
  vertexColors 로 색을 넣으면 이 환경에서 적용되지 않아 전부 흰색으로 렌더링되므로,
  색마다 지오메트리를 따로 합쳐 각자 머티리얼을 주는 방식을 쓴다.
*/
function groupPartsByColor(parts) {
  const byColor = new Map();
  for (const p of parts) {
    const key = p.color === undefined ? 0xffffff : p.color;
    if (!byColor.has(key)) byColor.set(key, []);
    byColor.get(key).push({ geo: p.geo, matrix: p.matrix });
  }
  const out = [];
  byColor.forEach((group, hex) => out.push({ geo: mergeParts(group), color: hex }));
  return out;
}

/* 레이 - 구 교차. 맞으면 t(거리), 아니면 -1 */
function raySphere(ro, rd, center, radius) {
  const ox = ro.x - center.x;
  const oy = ro.y - center.y;
  const oz = ro.z - center.z;
  const b = ox * rd.x + oy * rd.y + oz * rd.z;
  const c = ox * ox + oy * oy + oz * oz - radius * radius;
  if (c > 0 && b > 0) return -1;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t < 0 ? -1 : t;
}

/* 레이 - 수직 캡슐(중심축이 Y축) 교차. 대략적인 몸통 히트박스용 */
function rayCapsuleY(ro, rd, base, height, radius) {
  // 무한 실린더와 먼저 교차
  const dx = ro.x - base.x;
  const dz = ro.z - base.z;
  const a = rd.x * rd.x + rd.z * rd.z;
  let best = -1;
  if (a > 1e-6) {
    const b = 2 * (dx * rd.x + dz * rd.z);
    const c = dx * dx + dz * dz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b - sq) / (2 * a), (-b + sq) / (2 * a)]) {
        if (t < 0) continue;
        const y = ro.y + rd.y * t;
        if (y >= base.y && y <= base.y + height) {
          if (best < 0 || t < best) best = t;
        }
      }
    }
  }
  // 위/아래 반구
  for (const cy of [base.y, base.y + height]) {
    const t = raySphere(ro, rd, { x: base.x, y: cy, z: base.z }, radius);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

/* 값 포맷 */
function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}
