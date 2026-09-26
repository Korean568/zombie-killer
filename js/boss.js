/* =========================================================
   boss.js - 최종 보스 '세뇌자'
   좀비 바이러스를 퍼뜨리고 좀비들을 세뇌한 자.
   체력은 100뿐이지만 사람처럼 움직이고, 조준이 정확하다.
   ========================================================= */

const BOSS_SPEC = {
  name: '세뇌자',
  sub: '좀비 바이러스를 퍼뜨린 자',
  hp: 100,
  speed: 5.6,
  radius: 0.4,
  /* 사격 */
  burst: 3,          // 한 번에 쏘는 발수
  burstGap: 0.12,    // 버스트 안의 간격
  cooldown: 1.35,    // 버스트 사이 간격
  damage: 7,
  accuracy: 0.78,    // 명중 확률 (사거리에 따라 조금 떨어진다)
  range: 38,
  /* 무빙 */
  keepMin: 8,        // 이보다 가까우면 물러선다
  keepMax: 16,       // 이보다 멀면 붙는다
  strafeMin: 0.6,
  strafeMax: 1.5,
  dashSpeed: 11,
  dashTime: 0.28,
  dashCooldown: 2.2,
};

const BossAssets = (function () {
  let cached = null;

  const COAT = 0x1d2a24;   // 짙은 초록 방역복
  const COAT2 = 0x16211c;
  const MASK = 0x2b2f31;   // 방독면
  const LENS = 0x46ff9b;   // 초록 렌즈
  const GLOVE = 0x141719;
  const GUN = 0x24282c;
  const VIAL = 0x3ff08a;

  function parts() {
    const p = [];
    // 몸통 (긴 코트)
    p.push({ geo: new THREE.BoxGeometry(0.54, 0.78, 0.32), matrix: MAT(0, 1.3, 0), color: COAT });
    p.push({ geo: new THREE.BoxGeometry(0.58, 0.62, 0.36), matrix: MAT(0, 0.78, 0), color: COAT2 });
    // 어깨 / 골반
    p.push({ geo: new THREE.BoxGeometry(0.66, 0.13, 0.36), matrix: MAT(0, 1.64, 0), color: COAT2 });
    p.push({ geo: new THREE.BoxGeometry(0.48, 0.18, 0.3), matrix: MAT(0, 0.96, 0), color: COAT2 });
    // 목 / 머리 / 방독면
    p.push({ geo: new THREE.BoxGeometry(0.19, 0.12, 0.19), matrix: MAT(0, 1.74, 0), color: MASK });
    p.push({ geo: new THREE.BoxGeometry(0.3, 0.32, 0.3), matrix: MAT(0, 1.94, 0.01), color: MASK });
    p.push({ geo: new THREE.BoxGeometry(0.15, 0.13, 0.12), matrix: MAT(0, 1.88, 0.18), color: GLOVE }); // 필터통
    // 렌즈 두 개 (정면 = +Z)
    p.push({ geo: new THREE.BoxGeometry(0.09, 0.07, 0.04), matrix: MAT(-0.07, 1.99, 0.16), color: LENS });
    p.push({ geo: new THREE.BoxGeometry(0.09, 0.07, 0.04), matrix: MAT(0.07, 1.99, 0.16), color: LENS });
    // 후드
    p.push({ geo: new THREE.BoxGeometry(0.36, 0.2, 0.34), matrix: MAT(0, 2.11, -0.02), color: COAT });
    // 등에 멘 배양조
    p.push({ geo: new THREE.BoxGeometry(0.18, 0.44, 0.16), matrix: MAT(-0.13, 1.36, -0.24), color: VIAL });
    p.push({ geo: new THREE.BoxGeometry(0.18, 0.44, 0.16), matrix: MAT(0.13, 1.36, -0.24), color: VIAL });
    // 군화
    p.push({ geo: new THREE.BoxGeometry(0.21, 0.15, 0.28), matrix: MAT(-0.14, 0.075, 0.03), color: GLOVE });
    p.push({ geo: new THREE.BoxGeometry(0.21, 0.15, 0.28), matrix: MAT(0.14, 0.075, 0.03), color: GLOVE });
    // 소총 (로컬 +Z 가 정면)
    p.push({ geo: new THREE.BoxGeometry(0.08, 0.1, 0.62), matrix: MAT(0.19, 1.46, 0.46), color: GUN });
    p.push({ geo: new THREE.BoxGeometry(0.06, 0.15, 0.1), matrix: MAT(0.19, 1.35, 0.3), color: GUN });
    p.push({ geo: new THREE.BoxGeometry(0.05, 0.06, 0.2), matrix: MAT(0.19, 1.52, 0.2), color: GUN });
    return p;
  }

  function get() {
    if (!cached) {
      cached = {
        body: groupPartsByColor(parts()),
        arm: (function () {
          const g = new THREE.BoxGeometry(0.16, 0.62, 0.16);
          g.translate(0, -0.31, 0);
          return g;
        })(),
        leg: (function () {
          const g = new THREE.BoxGeometry(0.19, 0.9, 0.21);
          g.translate(0, -0.45, 0);
          return g;
        })(),
      };
    }
    return cached;
  }

  const matCache = {};
  function material(hex) {
    if (!matCache[hex]) {
      matCache[hex] = new THREE.MeshStandardMaterial({
        color: hex,
        roughness: 0.78,
        metalness: 0.12,
        emissive: hex === 0x46ff9b || hex === 0x3ff08a ? hex : 0x000000,
        emissiveIntensity: hex === 0x46ff9b ? 1.4 : hex === 0x3ff08a ? 0.7 : 0,
      });
    }
    return matCache[hex];
  }

  return { get, material, COAT: COAT };
})();

class Boss {
  constructor(pos) {
    this.isBoss = true;
    this.spec = BOSS_SPEC;
    this.maxHp = BOSS_SPEC.hp;
    this.hp = BOSS_SPEC.hp;
    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.vel = new THREE.Vector3();
    this.facing = 0;
    this.radius = BOSS_SPEC.radius;

    this.dead = false;
    this.removeMe = false;
    this.animTime = rand(0, 10);
    this.flashTimer = 0;
    this.muzzleTimer = 0;

    /* 사격 상태 */
    this.fireCd = 1.6;      // 등장 직후 한 박자 쉰다
    this.burstLeft = 0;
    this.burstTimer = 0;

    /* 무빙 상태 */
    this.strafeDir = Math.random() < 0.5 ? 1 : -1;
    this.strafeTimer = rand(BOSS_SPEC.strafeMin, BOSS_SPEC.strafeMax);
    this.dashTimer = 0;
    this.dashCd = 1.5;
    this.dashVec = new THREE.Vector3();

    this._eye = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._muzzleWorld = new THREE.Vector3();

    this._buildMesh();
  }

  _buildMesh() {
    const A = BossAssets.get();
    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(1.12); // 사람보다 조금 크다

    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);

    this.bodyMeshes = A.body.map((g) => {
      const m = new THREE.Mesh(g.geo, BossAssets.material(g.color));
      m.castShadow = true;
      this.bodyRoot.add(m);
      return m;
    });

    const limbMat = BossAssets.material(BossAssets.COAT);
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-0.35, 1.6, 0);
    this.armR.position.set(0.35, 1.6, 0);
    this.armL.rotation.x = -1.3;
    this.armL.rotation.z = 0.24;
    this.armR.rotation.x = -1.46;
    this.armR.rotation.z = -0.14;
    [this.armL, this.armR].forEach((g) => {
      g.add(new THREE.Mesh(A.arm, limbMat));
      this.bodyRoot.add(g);
    });

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.14, 0.96, 0);
    this.legR.position.set(0.14, 0.96, 0);
    [this.legL, this.legR].forEach((g) => {
      g.add(new THREE.Mesh(A.leg, limbMat));
      this.bodyRoot.add(g);
    });

    this.muzzle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.42, 0.42),
      new THREE.MeshBasicMaterial({
        color: 0xbaffd6,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.muzzle.position.set(0.19, 1.47, 0.82);
    this.muzzle.visible = false;
    this.bodyRoot.add(this.muzzle);

    // 주변을 물들이는 초록 불빛
    this.aura = new THREE.PointLight(0x3dff95, 1.1, 9, 2);
    this.aura.position.set(0, 1.7, 0);
    this.group.add(this.aura);
  }

  addTo(scene) { scene.add(this.group); }
  removeFrom(scene) { scene.remove(this.group); }

  /* ---- 피격 판정용 (좀비와 같은 인터페이스) ---- */
  headCenter(out) {
    return (out || this._tmp).set(this.pos.x, 2.17, this.pos.z);
  }
  get headRadius() { return 0.26; }
  bodyBase(out) {
    return (out || this._tmp).set(this.pos.x, 0.1, this.pos.z);
  }
  get bodyHeight() { return 1.95; }
  get bodyRadius() { return 0.44; }

  hurt(amount, head) {
    if (this.dead) return false;
    this.hp -= head ? amount : amount;
    this.flashTimer = 0.1;
    // 맞으면 옆으로 굴러 피한다
    if (this.dashCd <= 0 && Math.random() < 0.5) this._startDash();
    if (this.hp <= 0) {
      this.hp = 0;
      this.dead = true;
      this.muzzle.visible = false;
      this.aura.intensity = 0;
      return true;
    }
    return false;
  }

  _startDash() {
    this.dashTimer = BOSS_SPEC.dashTime;
    this.dashCd = BOSS_SPEC.dashCooldown;
    this.strafeDir *= -1;
  }

  /*
    ctx = {
      playerPos,          // 카메라 위치 (눈높이)
      playerGround,       // 발 위치
      los(a, b),          // 시야 확보 여부
      blocked(x, z, r),   // 이동 충돌
      damagePlayer(dmg),
      tracer(from, to),
      onShot(dist),
    }
  */
  update(dt, ctx) {
    if (this.dead) {
      this._animateDeath(dt);
      return;
    }

    this.animTime += dt;
    if (this.flashTimer > 0) this.flashTimer -= dt;
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzle.visible = false;
    }
    if (this.dashCd > 0) this.dashCd -= dt;

    const px = ctx.playerGround.x;
    const pz = ctx.playerGround.z;
    let dx = px - this.pos.x;
    let dz = pz - this.pos.z;
    const dist = Math.hypot(dx, dz) || 0.001;
    dx /= dist;
    dz /= dist;

    // 항상 플레이어를 본다
    const want = Math.atan2(dx, dz);
    let diff = want - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * clamp(12 * dt, 0, 1);
    this.group.rotation.y = this.facing;

    this._eye.set(this.pos.x, 1.62, this.pos.z);
    const clear = ctx.los(this._eye, ctx.playerPos);

    /* ---- 무빙 ---- */
    this.strafeTimer -= dt;
    if (this.strafeTimer <= 0) {
      this.strafeTimer = rand(BOSS_SPEC.strafeMin, BOSS_SPEC.strafeMax);
      if (Math.random() < 0.65) this.strafeDir *= -1;
    }
    // 시야가 막혀 있으면 옆으로 크게 돌아 각을 잡는다
    if (!clear && this.dashCd <= 0 && Math.random() < 0.02) this._startDash();

    let mx = 0;
    let mz = 0;
    // 앞뒤: 거리 유지
    if (dist < BOSS_SPEC.keepMin) {
      mx -= dx; mz -= dz;
    } else if (dist > BOSS_SPEC.keepMax || !clear) {
      mx += dx; mz += dz;
    }
    // 좌우: 스트레이프 (진행 방향 수직)
    mx += -dz * this.strafeDir * 1.15;
    mz += dx * this.strafeDir * 1.15;

    const ml = Math.hypot(mx, mz);
    let speed = BOSS_SPEC.speed;
    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      speed = BOSS_SPEC.dashSpeed;
    }
    if (ml > 0.0001) {
      mx = (mx / ml) * speed * dt;
      mz = (mz / ml) * speed * dt;
      if (!ctx.blocked(this.pos.x + mx, this.pos.z, this.radius)) this.pos.x += mx;
      else this.strafeDir *= -1;
      if (!ctx.blocked(this.pos.x, this.pos.z + mz, this.radius)) this.pos.z += mz;
      else this.strafeDir *= -1;
    }
    this.group.position.set(this.pos.x, 0, this.pos.z);

    /* ---- 사격 ---- */
    if (this.burstLeft > 0) {
      this.burstTimer -= dt;
      if (this.burstTimer <= 0) {
        this.burstTimer = BOSS_SPEC.burstGap;
        this.burstLeft--;
        this._fire(ctx, dist, clear);
        if (this.burstLeft <= 0) this.fireCd = rand(BOSS_SPEC.cooldown * 0.8, BOSS_SPEC.cooldown * 1.3);
      }
    } else {
      this.fireCd -= dt;
      if (this.fireCd <= 0 && clear && dist < BOSS_SPEC.range) {
        this.burstLeft = BOSS_SPEC.burst;
        this.burstTimer = 0;
      }
    }

    this._animateWalk(ml > 0.0001 ? speed : 0);
  }

  _fire(ctx, dist, clear) {
    this.muzzle.visible = true;
    this.muzzleTimer = 0.05;

    // 총구 위치(월드)
    this._muzzleWorld.set(0.19 * 1.12, 1.47 * 1.12, 0.82 * 1.12);
    this._muzzleWorld.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.facing);
    this._muzzleWorld.add(this.pos);

    ctx.onShot(dist);

    // 거리가 멀수록 조금씩 빗나간다
    const acc = clamp(BOSS_SPEC.accuracy * (1 - (dist - 8) / 60), 0.35, 0.95);
    const hit = clear && Math.random() < acc;

    if (hit) {
      ctx.tracer(this._muzzleWorld, ctx.playerPos);
      ctx.damagePlayer(BOSS_SPEC.damage);
    } else {
      // 빗나간 총알은 플레이어 근처를 스쳐 간다
      const miss = this._tmp.copy(ctx.playerPos);
      miss.x += rand(-1.6, 1.6);
      miss.y += rand(-0.7, 0.9);
      miss.z += rand(-1.6, 1.6);
      ctx.tracer(this._muzzleWorld, miss);
    }
  }

  _animateWalk(speed) {
    const t = this.animTime * (4.2 + speed * 0.5);
    const amp = speed > 0 ? 0.55 : 0.08;
    this.legL.rotation.x = Math.sin(t) * amp;
    this.legR.rotation.x = -Math.sin(t) * amp;
    this.bodyRoot.position.y = Math.abs(Math.sin(t)) * 0.035;
    this.bodyRoot.rotation.z = Math.sin(t * 0.5) * 0.02;
    // 피격 시 잠깐 붉게
    const f = this.flashTimer > 0 ? 1 : 0;
    this.aura.color.setRGB(f ? 1 : 0.24, f ? 0.25 : 1, f ? 0.2 : 0.58);
  }

  _animateDeath(dt) {
    this.bodyRoot.rotation.x = dampen(this.bodyRoot.rotation.x, -1.5, 3.4, dt);
    this.bodyRoot.position.y = dampen(this.bodyRoot.position.y, 0.15, 3.0, dt);
    this.legL.rotation.x = dampen(this.legL.rotation.x, 0.4, 3, dt);
    this.legR.rotation.x = dampen(this.legR.rotation.x, -0.3, 3, dt);
  }
}
