/* =========================================================
   ally.js - 부하(아군 병사) 유닛
   킬 포인트로 소환하고 계급을 올린다.
   ========================================================= */

const ALLY_RANKS = [
  {
    name: '이등병',
    short: 'PVT',
    hp: 90,
    dmg: 13,
    cooldown: 1.15,
    range: 24,
    accuracy: 0.72,
    uniform: 0x2c3226,
    badge: 0x6e7468,
    scale: 1.0,
  },
  {
    name: '일등병',
    short: 'PFC',
    hp: 130,
    dmg: 17,
    cooldown: 0.9,
    range: 28,
    accuracy: 0.8,
    uniform: 0x2a3024,
    badge: 0xb6bcae,
    scale: 1.02,
  },
  {
    name: '상등병',
    short: 'CPL',
    hp: 185,
    dmg: 23,
    cooldown: 0.68,
    range: 32,
    accuracy: 0.87,
    uniform: 0x272d20,
    badge: 0xd9c273,
    scale: 1.05,
  },
  {
    name: '병장',
    short: 'SGT',
    hp: 255,
    dmg: 31,
    cooldown: 0.48,
    range: 38,
    accuracy: 0.93,
    uniform: 0x232a1d,
    badge: 0xf2d24f,
    scale: 1.09,
  },
];

/* 소환 / 승급 비용 (킬 포인트) */
const ALLY_SUMMON_COST = 12;
const ALLY_UPGRADE_COST = [0, 18, 32, 55]; // 해당 계급이 '되기 위한' 비용
const ALLY_MAX = 4;

const AllyAssets = (function () {
  let cached = null;

  /* 계급마다 군복 색이 달라 색깔별로 파트를 나눠 둔다 */
  function parts(rank) {
    const R = ALLY_RANKS[rank];
    const SKIN = 0x6d5a45;
    const BOOT = 0x22252a;
    const GUN = 0x2b3035;

    const p = [];
    // 몸통 / 방탄조끼
    p.push({ geo: new THREE.BoxGeometry(0.5, 0.72, 0.3), matrix: MAT(0, 1.26, 0), color: R.uniform });
    p.push({ geo: new THREE.BoxGeometry(0.54, 0.4, 0.34), matrix: MAT(0, 1.34, 0), color: 0x20241b });
    // 목 / 머리
    p.push({ geo: new THREE.BoxGeometry(0.18, 0.12, 0.18), matrix: MAT(0, 1.68, 0), color: SKIN });
    p.push({ geo: new THREE.BoxGeometry(0.27, 0.28, 0.27), matrix: MAT(0, 1.86, 0.01), color: SKIN });
    // 헬멧
    p.push({ geo: new THREE.BoxGeometry(0.32, 0.16, 0.33), matrix: MAT(0, 2.0, 0.01), color: R.uniform });
    p.push({ geo: new THREE.BoxGeometry(0.33, 0.05, 0.12), matrix: MAT(0, 1.94, 0.16), color: R.uniform });
    // 계급장 (가슴)
    p.push({ geo: new THREE.BoxGeometry(0.12, 0.09, 0.03), matrix: MAT(0.14, 1.45, 0.17), color: R.badge });
    // 어깨 / 골반
    p.push({ geo: new THREE.BoxGeometry(0.58, 0.11, 0.32), matrix: MAT(0, 1.58, 0), color: R.uniform });
    p.push({ geo: new THREE.BoxGeometry(0.46, 0.18, 0.28), matrix: MAT(0, 0.94, 0), color: R.uniform });
    // 군화
    p.push({ geo: new THREE.BoxGeometry(0.2, 0.14, 0.26), matrix: MAT(-0.14, 0.07, 0.03), color: BOOT });
    p.push({ geo: new THREE.BoxGeometry(0.2, 0.14, 0.26), matrix: MAT(0.14, 0.07, 0.03), color: BOOT });
    // 소총 (앞으로 겨눈 자세로 고정)
    /*
      이 캐릭터들은 atan2(dx, dz) 로 회전하므로 로컬 +Z 가 정면이다.
      총이 -Z 에 있어서 등 뒤에 매달려 보였다. 팔이 뻗는 +Z 쪽,
      손이 오는 높이(y 약 1.42)에 맞춰 놓는다.
    */
    p.push({ geo: new THREE.BoxGeometry(0.07, 0.09, 0.5), matrix: MAT(0.18, 1.42, 0.42), color: GUN });
    p.push({ geo: new THREE.BoxGeometry(0.05, 0.13, 0.09), matrix: MAT(0.18, 1.33, 0.3), color: GUN });
    p.push({ geo: new THREE.BoxGeometry(0.045, 0.05, 0.17), matrix: MAT(0.18, 1.47, 0.18), color: GUN });
    return p;
  }

  function get(rank) {
    if (!cached) cached = {};
    if (!cached[rank]) {
      cached[rank] = {
        body: groupPartsByColor(parts(rank)),
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
      };
    }
    return cached[rank];
  }

  const matCache = {};
  function material(hex) {
    if (!matCache[hex]) {
      matCache[hex] = new THREE.MeshStandardMaterial({
        color: hex,
        roughness: 0.82,
        metalness: 0.1,
      });
    }
    return matCache[hex];
  }

  return { get, material };
})();

class Ally {
  constructor(pos, rank) {
    this.rank = rank || 0;
    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.facing = 0;
    this.radius = 0.38;
    this.animTime = rand(0, 10);
    this.fireTimer = rand(0, 0.5);
    this.target = null;
    this.losTimer = 0;
    this.flashTimer = 0;
    this.muzzleTimer = 0;
    this.dead = false;
    this.removeMe = false;
    this._eye = new THREE.Vector3();

    this._applyRank(true);
    this._buildMesh();
  }

  get spec() {
    return ALLY_RANKS[this.rank];
  }

  _applyRank(fresh) {
    const s = this.spec;
    if (fresh) {
      this.maxHp = s.hp;
      this.hp = s.hp;
    } else {
      // 승급하면 최대 체력이 오르고 그만큼 회복된다
      const gain = s.hp - this.maxHp;
      this.maxHp = s.hp;
      this.hp = Math.min(this.maxHp, this.hp + Math.max(0, gain));
    }
  }

  _buildMesh() {
    const A = AllyAssets.get(this.rank);
    const s = this.spec;

    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(s.scale);

    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);

    this.bodyMeshes = A.body.map((g) => {
      const m = new THREE.Mesh(g.geo, AllyAssets.material(g.color));
      m.castShadow = true;
      this.bodyRoot.add(m);
      return m;
    });

    const limbMat = AllyAssets.material(s.uniform);
    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-0.32, 1.54, 0);
    this.armR.position.set(0.32, 1.54, 0);
    // 소총을 잡은 자세
    // 팔은 +Z(정면)로 뻗어 총을 잡는 자세
    this.armL.rotation.x = -1.28;
    this.armL.rotation.z = 0.22;
    this.armR.rotation.x = -1.44;
    this.armR.rotation.z = -0.12;
    [this.armL, this.armR].forEach((g) => {
      g.add(new THREE.Mesh(A.arm, limbMat));
      this.bodyRoot.add(g);
    });

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.13, 0.93, 0);
    this.legR.position.set(0.13, 0.93, 0);
    [this.legL, this.legR].forEach((g) => {
      g.add(new THREE.Mesh(A.leg, limbMat));
      this.bodyRoot.add(g);
    });

    // 총구 화염
    this.muzzle = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.34),
      new THREE.MeshBasicMaterial({
        color: 0xffd08a,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      })
    );
    this.muzzle.position.set(0.18, 1.43, 0.72);
    this.muzzle.visible = false;
    this.bodyRoot.add(this.muzzle);
  }

  /* 계급 승급 - 모델을 다시 만든다 */
  promote(scene) {
    if (this.rank >= ALLY_RANKS.length - 1) return false;
    this.rank++;
    this._applyRank(false);
    scene.remove(this.group);
    this._buildMesh();
    this.group.position.copy(this.pos);
    this.group.rotation.y = this.facing;
    scene.add(this.group);
    return true;
  }

  addTo(scene) {
    scene.add(this.group);
  }

  removeFrom(scene) {
    scene.remove(this.group);
  }

  hurt(amount) {
    if (this.dead) return false;
    this.hp -= amount;
    this.flashTimer = 0.12;
    if (this.hp <= 0) {
      this.dead = true;
      this.removeMe = true;
      return true;
    }
    return false;
  }

  update(dt, ctx) {
    if (this.dead) return;
    this.animTime += dt;

    const s = this.spec;
    const player = ctx.playerPos;
    const dxp = player.x - this.pos.x;
    const dzp = player.z - this.pos.z;
    const distToPlayer = Math.hypot(dxp, dzp);

    /* --- 사격 대상 찾기 (0.25초마다) --- */
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.25 + Math.random() * 0.1;
      this.target = this._findTarget(ctx, s.range);
    }
    if (this.target && (this.target.dead || this.target.removeMe)) this.target = null;

    /* --- 이동: 플레이어에게서 너무 멀어지면 따라붙는다 --- */
    const followDist = 5.5;
    let moving = false;
    if (distToPlayer > followDist) {
      let dirX = 0;
      let dirZ = 0;
      this._eye.set(this.pos.x, 1.6, this.pos.z);
      const clear = SCHOOL.hasLineOfSight(this._eye, player);
      if (clear && distToPlayer > 0.01) {
        dirX = dxp / distToPlayer;
        dirZ = dzp / distToPlayer;
      } else if (ctx.flow) {
        const d = flowDirection(ctx.flow, this.pos.x, this.pos.z);
        if (d) {
          dirX = d.x;
          dirZ = d.z;
        }
      }

      // 서로 겹치지 않게
      for (let i = 0; i < ctx.allies.length; i++) {
        const o = ctx.allies[i];
        if (o === this || o.dead) continue;
        const ox = this.pos.x - o.pos.x;
        const oz = this.pos.z - o.pos.z;
        const d2 = ox * ox + oz * oz;
        const minD = this.radius + o.radius;
        if (d2 > 0.0001 && d2 < minD * minD) {
          const d = Math.sqrt(d2);
          dirX += (ox / d) * 1.4;
          dirZ += (oz / d) * 1.4;
        }
      }

      const dl = Math.hypot(dirX, dirZ);
      if (dl > 0.0001) {
        dirX /= dl;
        dirZ /= dl;
        // 멀수록 빨리 달려온다 (낙오 방지)
        const speed = clamp(3.4 + (distToPlayer - followDist) * 0.5, 3.4, 8.5);
        const step = speed * dt;
        const nx = this.pos.x + dirX * step;
        const nz = this.pos.z + dirZ * step;
        if (!SCHOOL.circleBlocked(nx, this.pos.z, this.radius, 'tall')) this.pos.x = nx;
        if (!SCHOOL.circleBlocked(this.pos.x, nz, this.radius, 'tall')) this.pos.z = nz;
        moving = true;
      }
      this.group.position.set(this.pos.x, 0, this.pos.z);
    }

    /* --- 조준 방향: 대상이 있으면 대상, 없으면 진행 방향 --- */
    if (this.target) {
      this._faceTowards(this.target.pos.x - this.pos.x, this.target.pos.z - this.pos.z, dt, 8);
    } else if (moving) {
      this._faceTowards(dxp, dzp, dt, 6);
    }

    /* --- 사격 --- */
    if (this.fireTimer > 0) this.fireTimer -= dt;
    if (this.target && this.fireTimer <= 0) {
      this._shoot(ctx);
      this.fireTimer = s.cooldown * rand(0.85, 1.15);
    }

    /* --- 연출 --- */
    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzle.visible = false;
    }
    if (this.flashTimer > 0) this.flashTimer -= dt;

    this._animate(moving);
  }

  _findTarget(ctx, range) {
    let best = null;
    let bestD = range * range;
    this._eye.set(this.pos.x, 1.5, this.pos.z);
    for (let i = 0; i < ctx.zombies.length; i++) {
      const z = ctx.zombies[i];
      if (z.dead) continue;
      const dx = z.pos.x - this.pos.x;
      const dz = z.pos.z - this.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 >= bestD) continue;
      if (!SCHOOL.hasLineOfSight(this._eye, { x: z.pos.x, y: 1.3, z: z.pos.z })) continue;
      best = z;
      bestD = d2;
    }
    return best;
  }

  _shoot(ctx) {
    const s = this.spec;
    const z = this.target;
    this.muzzle.visible = true;
    this.muzzleTimer = 0.05;

    const from = new THREE.Vector3(this.pos.x, 1.45, this.pos.z);
    const to = new THREE.Vector3(z.pos.x, 1.2 * z.scale, z.pos.z);
    if (ctx.tracer) ctx.tracer(from, to);
    SFX.allyShot(this.pos.distanceTo(ctx.playerPos));

    // 명중률 판정 - 빗나가면 피해 없음
    if (Math.random() > s.accuracy) return;

    const head = Math.random() < 0.18;
    const dmg = s.dmg * (head ? 2.2 : 1);
    const killed = z.hurt(dmg, head);
    if (ctx.onAllyHit) ctx.onAllyHit(z, to, killed, head);
  }

  _faceTowards(dx, dz, dt, rate) {
    if (Math.abs(dx) < 0.0001 && Math.abs(dz) < 0.0001) return;
    const target = Math.atan2(dx, dz);
    let diff = target - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * clamp(rate * dt, 0, 1);
    this.group.rotation.y = this.facing;
  }

  _animate(moving) {
    if (moving) {
      const t = this.animTime * 9;
      const sn = Math.sin(t);
      this.legL.rotation.x = sn * 0.7;
      this.legR.rotation.x = -sn * 0.7;
      this.bodyRoot.position.y = Math.abs(sn) * 0.04;
      this.bodyRoot.rotation.z = Math.cos(t) * 0.04;
    } else {
      this.legL.rotation.x = dampen(this.legL.rotation.x, 0, 10, 0.016);
      this.legR.rotation.x = dampen(this.legR.rotation.x, 0, 10, 0.016);
      this.bodyRoot.position.y = dampen(this.bodyRoot.position.y, 0, 10, 0.016);
      this.bodyRoot.rotation.z = dampen(this.bodyRoot.rotation.z, 0, 10, 0.016);
    }
    // 반동으로 상체가 살짝 젖혀짐
    const kick = clamp(this.muzzleTimer / 0.05, 0, 1);
    this.bodyRoot.rotation.x = -kick * 0.12;
  }
}
