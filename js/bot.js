/* =========================================================
   remote.js 역할 - 다른 실제 플레이어의 아바타
   (봇은 제거됐다. 매치에는 실제 접속자만 들어온다)
   ========================================================= */

/*
  다른 실제 플레이어의 아바타.
  AI 가 없고 서버에서 받은 좌표를 따라가기만 한다.
*/
/*
  다른 플레이어 전용 외형 - 미 육군 전투복(대령) 차림.
  부하(짙은 올리브 전투복 + 방탄헬멧)와 구분되도록
  밝은 탄색 OCP 전투복 + 전투모 + 가슴의 은색 독수리로 만든다.
*/
const PLAYER_RANK = '대령';

const PlayerAssets = (function () {
  /*
    부하는 짙은 올리브(녹색 계열) 전투복이다.
    같은 손전등 아래서도 구분되도록 이쪽은 따뜻한 탄색(황갈색)으로 확실히 민다.
  */
  const OCP = 0x8c7a4e;    // 전투복 (탄색 OCP)
  const OCP_D = 0x6b5a38;  // 방탄조끼 / 장구류
  const TROUSER = 0x82724a; // 전투복 하의
  const CAP = 0x7f6f47;    // 전투모
  const BOOT = 0x4a3a28;   // 전투화 (코요테 브라운)
  const SILVER = 0xc3c9d0; // 대령 계급장 (무광 은독수리)
  const PATCH = 0x453f2f;  // 이름표 / 부대 마크
  const SKIN = 0x7a6450;
  const GUN = 0x2b3035;
  let cached = null;

  function parts() {
    const p = [];
    // 전투복 상의
    p.push({ geo: new THREE.BoxGeometry(0.5, 0.72, 0.3), matrix: MAT(0, 1.26, 0), color: OCP });
    // 방탄조끼 (부하보다 장비가 좋아 보이게 두껍게)
    p.push({ geo: new THREE.BoxGeometry(0.57, 0.48, 0.37), matrix: MAT(0, 1.36, 0), color: OCP_D });
    // 조끼 어깨 패드
    p.push({ geo: new THREE.BoxGeometry(0.63, 0.1, 0.36), matrix: MAT(0, 1.6, 0), color: OCP_D });
    // 탄창 파우치 세 개
    [-0.14, 0, 0.14].forEach(function (x) {
      p.push({ geo: new THREE.BoxGeometry(0.11, 0.14, 0.06), matrix: MAT(x, 1.22, 0.2), color: PATCH });
    });
    // 가슴 한가운데 대령 계급장 (은독수리)
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.04, 0.03), matrix: MAT(0, 1.5, 0.2), color: SILVER });
    p.push({ geo: new THREE.BoxGeometry(0.17, 0.025, 0.03), matrix: MAT(0, 1.5, 0.2), color: SILVER });
    // 이름표 / US ARMY 테이프
    p.push({ geo: new THREE.BoxGeometry(0.15, 0.035, 0.02), matrix: MAT(0.13, 1.43, 0.2), color: PATCH });
    p.push({ geo: new THREE.BoxGeometry(0.15, 0.035, 0.02), matrix: MAT(-0.13, 1.43, 0.2), color: PATCH });
    // 목 / 머리
    p.push({ geo: new THREE.BoxGeometry(0.18, 0.12, 0.18), matrix: MAT(0, 1.68, 0), color: SKIN });
    p.push({ geo: new THREE.BoxGeometry(0.27, 0.28, 0.27), matrix: MAT(0, 1.86, 0.01), color: SKIN });
    // 전투모 (패트롤 캡) - 각진 크라운 + 짧은 챙
    p.push({ geo: new THREE.BoxGeometry(0.3, 0.12, 0.31), matrix: MAT(0, 2.0, 0), color: CAP });
    p.push({ geo: new THREE.BoxGeometry(0.28, 0.025, 0.11), matrix: MAT(0, 1.95, 0.19), color: CAP });
    // 전투모 정면 계급장
    p.push({ geo: new THREE.BoxGeometry(0.05, 0.035, 0.02), matrix: MAT(0, 2.01, 0.16), color: SILVER });
    // 벨트 / 골반
    p.push({ geo: new THREE.BoxGeometry(0.53, 0.08, 0.33), matrix: MAT(0, 0.97, 0), color: OCP_D });
    p.push({ geo: new THREE.BoxGeometry(0.46, 0.16, 0.28), matrix: MAT(0, 0.88, 0), color: TROUSER });
    // 허벅지 파우치
    p.push({ geo: new THREE.BoxGeometry(0.11, 0.18, 0.1), matrix: MAT(0.2, 0.78, 0.04), color: PATCH });
    // 전투화
    p.push({ geo: new THREE.BoxGeometry(0.21, 0.16, 0.28), matrix: MAT(-0.14, 0.08, 0.03), color: BOOT });
    p.push({ geo: new THREE.BoxGeometry(0.21, 0.16, 0.28), matrix: MAT(0.14, 0.08, 0.03), color: BOOT });
    // 소총
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.09, 0.5), matrix: MAT(0.18, 1.42, 0.42), color: GUN });
    p.push({ geo: new THREE.BoxGeometry(0.05, 0.13, 0.09), matrix: MAT(0.18, 1.33, 0.3), color: GUN });
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
        // 어깨 부대 마크
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
        roughness: hex === SILVER ? 0.45 : 0.88,
        metalness: hex === SILVER ? 0.55 : 0.05,
      });
    }
    return matCache[hex];
  }

  return {
    get, material,
    UNIFORM: OCP, TROUSER: TROUSER, GEAR: OCP_D, PATCH: PATCH, SILVER: SILVER,
  };
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

    const sleeveMat = PlayerAssets.material(PlayerAssets.UNIFORM);
    const trouserMat = PlayerAssets.material(PlayerAssets.TROUSER);
    const patchMat = PlayerAssets.material(PlayerAssets.PATCH);

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
      // 어깨 부대 마크 (소매 윗부분)
      const ch = new THREE.Mesh(A.chevron, patchMat);
      ch.position.y = -0.08;
      ch.scale.set(1.06, 0.3, 1.06);
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
