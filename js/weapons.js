/* =========================================================
   weapons.js - 무기 정의 + 1인칭 뷰모델
   ========================================================= */

const WEAPON_DEFS = [
  {
    id: 'pistol',
    name: '권총',
    short: 'P9',
    sound: 'pistol',
    damage: 38,
    // 2.6이면 98.8 로 일반 좀비(100)를 딱 1.2 모자라게 남긴다. 헤드샷 한 방이 되도록 올림.
    headMult: 2.85,
    pellets: 1,
    spread: 0.005,
    spreadMax: 0.03,
    spreadGain: 0.006,
    fireDelay: 0.155,
    auto: false,
    magSize: 12,
    reserveMax: Infinity,
    reload: 1.25,
    range: 130,
    recoil: { pitch: 0.022, yaw: 0.006 },
    kick: 0.055,
    view: { x: 0.23, y: -0.215, z: -0.52, rx: 0.03, ry: -0.2, rz: 0.05 },
    muzzle: { x: 0, y: 0.035, z: -0.33 },
    flashSize: 0.16,
  },
  {
    id: 'shotgun',
    name: '산탄총',
    short: 'SG',
    sound: 'shotgun',
    damage: 17,
    headMult: 1.7,
    pellets: 9,
    spread: 0.075,
    spreadMax: 0.075,
    spreadGain: 0,
    fireDelay: 0.8,
    auto: false,
    magSize: 6,
    reserveMax: 48,
    reload: 2.55,
    range: 45,
    recoil: { pitch: 0.075, yaw: 0.012 },
    kick: 0.16,
    view: { x: 0.24, y: -0.225, z: -0.58, rx: 0.025, ry: -0.16, rz: 0.04 },
    muzzle: { x: 0, y: 0.03, z: -0.72 },
    flashSize: 0.3,
  },
  {
    id: 'rifle',
    name: '소총',
    short: 'AR',
    sound: 'rifle',
    damage: 27,
    headMult: 2.2,
    pellets: 1,
    spread: 0.008,
    spreadMax: 0.055,
    spreadGain: 0.0065,
    fireDelay: 0.093,
    auto: true,
    magSize: 30,
    reserveMax: 210,
    reload: 2.15,
    range: 150,
    recoil: { pitch: 0.017, yaw: 0.007 },
    kick: 0.05,
    view: { x: 0.23, y: -0.225, z: -0.56, rx: 0.025, ry: -0.18, rz: 0.04 },
    muzzle: { x: 0, y: 0.045, z: -0.66 },
    flashSize: 0.2,
  },
];

const WeaponModels = (function () {
  const METAL = 0x33383d;
  const DARK = 0x1c1f22;
  const GRIP = 0x2a2420;
  const WOOD = 0x5a4228;

  function pistol() {
    const p = [];
    p.push({ geo: new THREE.BoxGeometry(0.085, 0.085, 0.3), matrix: MAT(0, 0.03, -0.09), color: METAL });
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.07, 0.12), matrix: MAT(0, 0.03, -0.27), color: DARK });
    p.push({ geo: new THREE.BoxGeometry(0.075, 0.09, 0.12), matrix: MAT(0, -0.04, 0.0), color: DARK });
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.2, 0.1), matrix: MAT(0, -0.14, 0.05, 0.22, 0, 0), color: GRIP });
    p.push({ geo: new THREE.BoxGeometry(0.02, 0.05, 0.02), matrix: MAT(0, -0.09, -0.02), color: DARK });
    p.push({ geo: new THREE.BoxGeometry(0.018, 0.022, 0.018), matrix: MAT(0, 0.085, -0.22), color: 0x8a9096 });
    return p; // 색깔별로 묶기 위해 파트 배열 그대로 반환
  }

  function shotgun() {
    const p = [];
    p.push({ geo: new THREE.BoxGeometry(0.085, 0.1, 0.42), matrix: MAT(0, 0.0, -0.1), color: METAL });
    const barrel = new THREE.CylinderGeometry(0.026, 0.026, 0.62, 10);
    barrel.rotateX(Math.PI / 2);
    p.push({ geo: barrel, matrix: MAT(0, 0.035, -0.5), color: DARK });
    const tube = new THREE.CylinderGeometry(0.021, 0.021, 0.5, 8);
    tube.rotateX(Math.PI / 2);
    p.push({ geo: tube, matrix: MAT(0, -0.025, -0.45), color: METAL });
    p.push({ geo: new THREE.BoxGeometry(0.075, 0.07, 0.15), matrix: MAT(0, -0.025, -0.36), color: WOOD });
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.17, 0.09), matrix: MAT(0, -0.12, 0.02, 0.2, 0, 0), color: WOOD });
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.12, 0.28), matrix: MAT(0, -0.04, 0.22, -0.13, 0, 0), color: WOOD });
    p.push({ geo: new THREE.BoxGeometry(0.018, 0.024, 0.018), matrix: MAT(0, 0.075, -0.76), color: 0x8a9096 });
    return p; // 색깔별로 묶기 위해 파트 배열 그대로 반환
  }

  function rifle() {
    const p = [];
    p.push({ geo: new THREE.BoxGeometry(0.08, 0.11, 0.46), matrix: MAT(0, 0.0, -0.08), color: DARK });
    const barrel = new THREE.CylinderGeometry(0.021, 0.021, 0.5, 10);
    barrel.rotateX(Math.PI / 2);
    p.push({ geo: barrel, matrix: MAT(0, 0.045, -0.5), color: METAL });
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.075, 0.26), matrix: MAT(0, 0.02, -0.42), color: 0x24282b });
    p.push({ geo: new THREE.BoxGeometry(0.055, 0.2, 0.1), matrix: MAT(0, -0.14, -0.02, -0.22, 0, 0), color: METAL });
    p.push({ geo: new THREE.BoxGeometry(0.065, 0.16, 0.09), matrix: MAT(0, -0.13, 0.12, 0.16, 0, 0), color: GRIP });
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.11, 0.26), matrix: MAT(0, -0.01, 0.27), color: 0x2f3438 });
    p.push({ geo: new THREE.BoxGeometry(0.05, 0.035, 0.16), matrix: MAT(0, 0.08, -0.05), color: 0x14171a });
    p.push({ geo: new THREE.BoxGeometry(0.02, 0.03, 0.02), matrix: MAT(0, 0.1, -0.68), color: 0x8a9096 });
    return p; // 색깔별로 묶기 위해 파트 배열 그대로 반환
  }

  const builders = { pistol, shotgun, rifle };
  const cache = {};
  const matCache = {};

  function materialFor(hex) {
    if (!matCache[hex]) {
      matCache[hex] = new THREE.MeshStandardMaterial({
        color: hex,
        roughness: hex === WOOD || hex === GRIP ? 0.85 : 0.5,
        metalness: hex === WOOD || hex === GRIP ? 0.0 : 0.55,
      });
    }
    return matCache[hex];
  }

  /*
    색을 정점 속성(vertexColors)으로 넣으면 이 환경에서 적용되지 않아
    총 전체가 흰색 알베도로 렌더링됐다.
    색깔별로 지오메트리를 묶어 각자 머티리얼을 주는 방식으로 바꾼다.
    뷰모델은 한 자루뿐이라 드로우콜 3~4개는 부담이 되지 않는다.
  */
  function buildParts(id) {
    const parts = builders[id]();
    const byColor = new Map();
    for (const p of parts) {
      if (!byColor.has(p.color)) byColor.set(p.color, []);
      byColor.get(p.color).push({ geo: p.geo, matrix: p.matrix });
    }
    const meshes = [];
    byColor.forEach((group, hex) => {
      meshes.push(new THREE.Mesh(mergeParts(group), materialFor(hex)));
    });
    return meshes;
  }

  function build(id) {
    if (!cache[id]) cache[id] = buildParts(id);
    const group = new THREE.Group();
    cache[id].forEach((m) => group.add(m.clone()));
    return group;
  }

  return { build };
})();

/* 무기 런타임 상태 */
class WeaponState {
  constructor(def, unlocked) {
    this.def = def;
    this.ammo = def.magSize;
    this.reserve = def.reserveMax === Infinity ? Infinity : Math.floor(def.reserveMax * 0.5);
    this.unlocked = !!unlocked;
  }
  reset() {
    this.ammo = this.def.magSize;
    this.reserve =
      this.def.reserveMax === Infinity ? Infinity : Math.floor(this.def.reserveMax * 0.5);
  }
  addAmmo(fraction) {
    if (this.reserve === Infinity) return false;
    const before = this.reserve;
    this.reserve = Math.min(this.def.reserveMax, this.reserve + Math.ceil(this.def.reserveMax * fraction));
    return this.reserve > before;
  }
  get ammoText() {
    return this.reserve === Infinity ? '∞' : String(this.reserve);
  }
}
