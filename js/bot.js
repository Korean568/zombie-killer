/* =========================================================
   remote.js 역할 - 다른 실제 플레이어의 아바타
   (봇은 제거됐다. 매치에는 실제 접속자만 들어온다)
   ========================================================= */

/*
  다른 실제 플레이어의 아바타.
  AI 가 없고 서버에서 받은 좌표를 따라가기만 한다.
*/
/*
  다른 플레이어 전용 외형 - 미 육군 정복(대령) 차림.
  부하(올리브색 전투복)와 한눈에 구분되도록 남색 정복에
  정모 + 은색 독수리 견장 + 금색 소매줄을 얹는다.
*/
const PLAYER_RANK = '대령';

const PlayerAssets = (function () {
  /*
    손전등을 정면으로 받으면 재질이 확 밝아진다.
    정복이 파랗게 떠 보이지 않도록 바탕색은 거의 검정에 가깝게 잡는다.
  */
  const NAVY = 0x05070d;   // 정복 상의 (검정에 가까운 남색)
  const TROUSER = 0x080b14; // 정복 바지
  const GOLD = 0xc9a227;   // 소매줄 / 모자 휘장 / 벨트
  const SILVER = 0xd6dbe2; // 대령 계급장(은독수리)
  const SKIN = 0x7a6450;
  const BLACK = 0x14161a;  // 정모 챙 / 구두
  const SHIRT = 0x8a939e;  // 셔츠
  let cached = null;

  function parts() {
    const p = [];
    // 상의
    p.push({ geo: new THREE.BoxGeometry(0.5, 0.72, 0.3), matrix: MAT(0, 1.26, 0), color: NAVY });
    // 셔츠와 넥타이 (깃 사이로 보이는 부분)
    p.push({ geo: new THREE.BoxGeometry(0.17, 0.26, 0.05), matrix: MAT(0, 1.5, 0.15), color: SHIRT });
    p.push({ geo: new THREE.BoxGeometry(0.06, 0.24, 0.03), matrix: MAT(0, 1.48, 0.18), color: BLACK });
    // 목 / 머리
    p.push({ geo: new THREE.BoxGeometry(0.18, 0.12, 0.18), matrix: MAT(0, 1.68, 0), color: SKIN });
    p.push({ geo: new THREE.BoxGeometry(0.27, 0.28, 0.27), matrix: MAT(0, 1.86, 0.01), color: SKIN });
    // 정모 (챙모자) - 크라운 / 띠 / 챙 / 금색 휘장
    p.push({ geo: new THREE.BoxGeometry(0.33, 0.13, 0.33), matrix: MAT(0, 2.03, -0.01), color: NAVY });
    p.push({ geo: new THREE.BoxGeometry(0.34, 0.05, 0.34), matrix: MAT(0, 1.955, -0.01), color: BLACK });
    p.push({ geo: new THREE.BoxGeometry(0.3, 0.03, 0.13), matrix: MAT(0, 1.945, 0.19), color: BLACK });
    p.push({ geo: new THREE.BoxGeometry(0.08, 0.07, 0.03), matrix: MAT(0, 2.02, 0.17), color: GOLD });
    // 어깨 + 대령 견장 (은색 독수리)
    p.push({ geo: new THREE.BoxGeometry(0.58, 0.11, 0.32), matrix: MAT(0, 1.58, 0), color: NAVY });
    [-0.21, 0.21].forEach(function (sx) {
      // 견장판
      p.push({ geo: new THREE.BoxGeometry(0.17, 0.05, 0.28), matrix: MAT(sx, 1.64, 0), color: NAVY });
      // 독수리 몸통 + 펼친 날개
      p.push({ geo: new THREE.BoxGeometry(0.06, 0.035, 0.1), matrix: MAT(sx, 1.675, 0), color: SILVER });
      p.push({ geo: new THREE.BoxGeometry(0.15, 0.022, 0.045), matrix: MAT(sx, 1.675, 0), color: SILVER });
    });
    // 가슴 약장 (색색의 리본)
    [[0xa8322d, -0.15], [0x2f5fa8, -0.09], [0xc9a227, -0.03]].forEach(function (r) {
      p.push({ geo: new THREE.BoxGeometry(0.055, 0.035, 0.03), matrix: MAT(r[1], 1.42, 0.16), color: r[0] });
    });
    // 오른쪽 가슴 명찰
    p.push({ geo: new THREE.BoxGeometry(0.13, 0.04, 0.03), matrix: MAT(0.13, 1.42, 0.16), color: BLACK });
    // 벨트
    p.push({ geo: new THREE.BoxGeometry(0.52, 0.07, 0.32), matrix: MAT(0, 0.96, 0), color: BLACK });
    p.push({ geo: new THREE.BoxGeometry(0.09, 0.07, 0.33), matrix: MAT(0, 0.96, 0), color: GOLD });
    // 골반
    p.push({ geo: new THREE.BoxGeometry(0.46, 0.16, 0.28), matrix: MAT(0, 0.88, 0), color: TROUSER });
    // 구두
    p.push({ geo: new THREE.BoxGeometry(0.2, 0.13, 0.27), matrix: MAT(-0.14, 0.065, 0.03), color: BLACK });
    p.push({ geo: new THREE.BoxGeometry(0.2, 0.13, 0.27), matrix: MAT(0.14, 0.065, 0.03), color: BLACK });
    // 소총
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.09, 0.5), matrix: MAT(0.18, 1.42, 0.42), color: 0x2b3035 });
    p.push({ geo: new THREE.BoxGeometry(0.05, 0.13, 0.09), matrix: MAT(0.18, 1.33, 0.3), color: 0x2b3035 });
    return p;
  }

  function get() {
    if (!cached) {
      cached = {
        body: groupPartsByColor(parts()),
        arm: (function () {
          const g = new THREE.BoxGeometry(0.15, 0.6, 0.15);
          g.translate(0, -0.3, 0);
          return g;
        })(),
        leg: (function () {
          const g = new THREE.BoxGeometry(0.18, 0.86, 0.2);
          g.translate(0, -0.43, 0);
          return g;
        })(),
        // 소매 금줄 (장교 표식)
        chevron: new THREE.BoxGeometry(0.16, 0.12, 0.16),
      };
    }
    return cached;
  }

  const matCache = {};
  function material(hex) {
    if (!matCache[hex]) {
      matCache[hex] = new THREE.MeshStandardMaterial({
        color: hex,
        roughness: hex === SILVER ? 0.35 : 0.72,
        metalness: hex === GOLD || hex === SILVER ? 0.65 : 0.12,
      });
    }
    return matCache[hex];
  }

  return { get, material, NAVY: NAVY, TROUSER: TROUSER, GOLD: GOLD, SILVER: SILVER };
})();

/* 머리 위 이름표 */
function makeNameTag(text) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(8,10,12,.72)';
  ctx.fillRect(0, 14, 256, 36);
  ctx.strokeStyle = 'rgba(201,162,39,.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 15, 254, 34);
  ctx.fillStyle = '#f0e9d2';
  ctx.font = 'bold 24px "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 33);
  const tex = new THREE.CanvasTexture(c);
  tex.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, toneMapped: false })
  );
  sp.scale.set(1.5, 0.375, 1);
  sp.position.y = 2.35;
  sp.renderOrder = 6;
  return sp;
}

class RemotePlayer extends Ally {
  constructor(pos, rank, name, id) {
    super(pos, rank);
    this.isRemote = true;
    // 이름표는 모델이 만들어진 뒤에 붙인다
    this.tag = makeNameTag(PLAYER_RANK + ' ' + (name || '플레이어'));
    this.group.add(this.tag);
    this.netId = id;
    this.name = name || '플레이어';
    this.kills = 0;
    this.targetX = pos.x;
    this.targetZ = pos.z;
    this.targetYaw = 0;
  }

  /* 부하와 구분되도록 정복 차림으로 만든다 */
  _buildMesh() {
    const A = PlayerAssets.get();

    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(1.02);

    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);

    this.bodyMeshes = A.body.map((g) => {
      const m = new THREE.Mesh(g.geo, PlayerAssets.material(g.color));
      m.castShadow = true;
      this.bodyRoot.add(m);
      return m;
    });

    const sleeveMat = PlayerAssets.material(PlayerAssets.NAVY);
    const trouserMat = PlayerAssets.material(PlayerAssets.TROUSER);
    const goldMat = PlayerAssets.material(PlayerAssets.GOLD);

    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-0.32, 1.54, 0);
    this.armR.position.set(0.32, 1.54, 0);
    this.armL.rotation.x = -1.28;
    this.armL.rotation.z = 0.22;
    this.armR.rotation.x = -1.44;
    this.armR.rotation.z = -0.12;
    [this.armL, this.armR].forEach((g) => {
      g.add(new THREE.Mesh(A.arm, sleeveMat));
      // 소매 계급장
      const ch = new THREE.Mesh(A.chevron, goldMat);
      ch.position.y = -0.16;
      ch.scale.set(1.04, 0.22, 1.04);
      g.add(ch);
      this.bodyRoot.add(g);
    });

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.13, 0.93, 0);
    this.legR.position.set(0.13, 0.93, 0);
    [this.legL, this.legR].forEach((g) => {
      g.add(new THREE.Mesh(A.leg, trouserMat));
      this.bodyRoot.add(g);
    });

    // 총구 화염
    this.muzzle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({
        color: 0xffd08a, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      })
    );
    this.muzzle.position.set(0.18, 1.43, 0.72);
    this.muzzle.visible = false;
    this.bodyRoot.add(this.muzzle);
  }

  applyState(s) {
    if (!s) return;
    this.targetX = s.x;
    this.targetZ = s.z;
    this.targetYaw = s.y;
    if (typeof s.k === 'number') this.kills = s.k;
  }

  update(dt) {
    if (this.dead) return;
    this.animTime += dt;

    // 20Hz 로 오는 좌표라 부드럽게 따라간다
    const px = this.pos.x;
    const pz = this.pos.z;
    this.pos.x = dampen(this.pos.x, this.targetX, 12, dt);
    this.pos.z = dampen(this.pos.z, this.targetZ, 12, dt);
    this.group.position.set(this.pos.x, 0, this.pos.z);

    const moved = Math.hypot(this.pos.x - px, this.pos.z - pz) > 0.012;
    // 서버가 주는 yaw 는 플레이어 시점 기준이라 모델 정면(+Z)에 맞춰 뒤집는다
    const face = this.targetYaw + Math.PI;
    let diff = face - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * clamp(10 * dt, 0, 1);
    this.group.rotation.y = this.facing;

    this._animate(moved);
  }
}
