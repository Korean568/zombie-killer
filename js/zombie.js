/* =========================================================
   zombie.js - 좀비 모델 / AI
   ========================================================= */

const ZOMBIE_TYPES = {
  walker: {
    name: '좀비',
    hp: 100,
    speed: 2.25,
    dmg: 13,
    scale: 1.0,
    attackCd: 1.15,
    score: 10,
    eye: 0xff2a1a,
    staggerable: true,
  },
  runner: {
    name: '달리는 좀비',
    hp: 62,
    speed: 6.3, // 질주(7.4)보다 느리되, 직선으로 도망만 쳐서는 못 떨어뜨리게

    dmg: 9,
    scale: 0.92,
    attackCd: 0.75,
    score: 20,
    eye: 0xffd21a,
    staggerable: true,
  },
  brute: {
    name: '거대 좀비',
    hp: 430,
    speed: 1.75,
    dmg: 34,
    scale: 1.45,
    attackCd: 1.8,
    score: 60,
    eye: 0xff6a00,
    staggerable: false,
  },
};

/* 죽은 좀비의 눈 색. 매 프레임 새로 만들지 않도록 상수로 둔다 */
const DEAD_EYE_COLOR = new THREE.Color(0x120404);

const ZombieAssets = (function () {
  let cached = null;
  function get() {
    if (cached) return cached;

    const bodyParts = [
      { geo: new THREE.BoxGeometry(0.56, 0.78, 0.32), matrix: MAT(0, 1.28, 0) }, // 몸통
      { geo: new THREE.BoxGeometry(0.2, 0.14, 0.2), matrix: MAT(0, 1.72, 0) }, // 목
      { geo: new THREE.BoxGeometry(0.3, 0.32, 0.3), matrix: MAT(0, 1.88, 0.02) }, // 머리
      { geo: new THREE.BoxGeometry(0.62, 0.12, 0.36), matrix: MAT(0, 1.6, 0) }, // 어깨
      { geo: new THREE.BoxGeometry(0.5, 0.2, 0.3), matrix: MAT(0, 0.94, 0) }, // 골반
    ];
    const body = mergeParts(bodyParts);

    const eyes = mergeParts([
      { geo: new THREE.BoxGeometry(0.07, 0.05, 0.03), matrix: MAT(-0.08, 1.92, 0.18) },
      { geo: new THREE.BoxGeometry(0.07, 0.05, 0.03), matrix: MAT(0.08, 1.92, 0.18) },
    ]);

    const arm = new THREE.BoxGeometry(0.18, 0.74, 0.18);
    arm.translate(0, -0.37, 0);
    const leg = new THREE.BoxGeometry(0.21, 0.9, 0.23);
    leg.translate(0, -0.45, 0);

    cached = { body, eyes, arm, leg };
    return cached;
  }
  return { get };
})();

class Zombie {
  constructor(typeKey, pos, mult) {
    const t = ZOMBIE_TYPES[typeKey];
    this.typeKey = typeKey;
    this.type = t;
    this.maxHp = t.hp * (mult.hp || 1);
    this.hp = this.maxHp;
    this.speed = t.speed * (mult.speed || 1);
    this.dmg = t.dmg * (mult.dmg || 1);
    this.scale = t.scale * rand(0.94, 1.07);
    this.attackCd = t.attackCd;

    this.pos = new THREE.Vector3(pos.x, 0, pos.z);
    this.facing = rand(0, Math.PI * 2);
    this.radius = 0.42 * this.scale;

    this.state = 'chase';
    this.attackTimer = 0;
    this.windup = 0;
    this.staggerTimer = 0;
    this.deathTimer = 0;
    this.groanTimer = rand(1, 6);
    this.animTime = rand(0, 10);
    this.flashTimer = 0;
    this.repathJitter = rand(0, 0.4);
    this.dead = false;
    this.removeMe = false;
    this.losTimer = rand(0, 0.2);
    this.losClear = false;
    this._losEye = new THREE.Vector3();

    this._buildMesh();
  }

  _buildMesh() {
    const A = ZombieAssets.get();
    const variant = randInt(0, 3);

    this.material = new THREE.MeshStandardMaterial({
      map: TEX.zombieSkin(variant),
      roughness: 0.92,
      metalness: 0.0,
      color: this.typeKey === 'brute' ? 0x9aa07e : 0xffffff,
    });
    this.eyeMaterial = new THREE.MeshBasicMaterial({
      color: this.type.eye,
      toneMapped: false,
    });

    this.group = new THREE.Group();
    this.group.position.copy(this.pos);
    this.group.scale.setScalar(this.scale);

    this.bodyRoot = new THREE.Group();
    this.group.add(this.bodyRoot);

    this.bodyMesh = new THREE.Mesh(A.body, this.material);
    this.bodyMesh.castShadow = true;
    this.bodyRoot.add(this.bodyMesh);

    this.eyeMesh = new THREE.Mesh(A.eyes, this.eyeMaterial);
    this.bodyRoot.add(this.eyeMesh);

    this.armL = new THREE.Group();
    this.armR = new THREE.Group();
    this.armL.position.set(-0.36, 1.56, 0);
    this.armR.position.set(0.36, 1.56, 0);
    [this.armL, this.armR].forEach((g) => {
      const m = new THREE.Mesh(A.arm, this.material);
      g.add(m);
      this.bodyRoot.add(g);
    });

    this.legL = new THREE.Group();
    this.legR = new THREE.Group();
    this.legL.position.set(-0.15, 0.95, 0);
    this.legR.position.set(0.15, 0.95, 0);
    [this.legL, this.legR].forEach((g) => {
      const m = new THREE.Mesh(A.leg, this.material);
      g.add(m);
      this.bodyRoot.add(g);
    });
  }

  addTo(scene) {
    scene.add(this.group);
  }

  removeFrom(scene) {
    scene.remove(this.group);
    this.material.dispose();
    this.eyeMaterial.dispose();
  }

  /* 히트박스 */
  headCenter(out) {
    return out.set(this.pos.x, 1.88 * this.scale, this.pos.z);
  }
  bodyBase(out) {
    return out.set(this.pos.x, 0.55 * this.scale, this.pos.z);
  }
  get headRadius() {
    return 0.24 * this.scale;
  }
  get bodyRadius() {
    return 0.36 * this.scale;
  }
  get bodyHeight() {
    return 1.05 * this.scale;
  }

  hurt(amount, isHead) {
    if (this.dead) return false;
    this.hp -= amount;
    this.flashTimer = 0.12;
    if (this.type.staggerable && !isHead) this.staggerTimer = 0.18;
    if (this.type.staggerable && isHead) this.staggerTimer = 0.3;
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    return false;
  }

  die() {
    this.dead = true;
    this.state = 'dead';
    this.deathTimer = 0;
    this.sinkAfter = 7; // 시체가 너무 쌓이면 게임 쪽에서 앞당긴다
    // 시체는 더 이상 움직이지 않으므로 그림자 패스에서 뺀다
    this.bodyMesh.castShadow = false;
    this.fallDir = Math.random() < 0.5 ? 1 : -1;
    this.fallSpin = rand(-0.5, 0.5);
  }

  /* ---------- 업데이트 ---------- */
  update(dt, ctx) {
    this.animTime += dt;

    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      const f = clamp(this.flashTimer / 0.12, 0, 1);
      this.material.emissive.setRGB(f * 0.6, 0, 0);
    }

    if (this.dead) {
      this.deathTimer += dt;

      // 쓰러지는 연출(0.55초) 동안만 자세를 갱신한다
      if (this.deathTimer <= 0.6) {
        const t = clamp(this.deathTimer / 0.55, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        this.bodyRoot.rotation.x = e * (Math.PI / 2) * this.fallDir;
        this.bodyRoot.rotation.z = e * this.fallSpin;
        this.bodyRoot.position.y = -e * 0.15;
        this.eyeMaterial.color.lerp(DEAD_EYE_COLOR, dt * 3);
      }

      // 가라앉기 시작하기 전까지는 아무 일도 하지 않는다
      if (this.deathTimer > this.sinkAfter) {
        this.group.position.y -= dt * 0.9;
        if (this.group.position.y < -2.2) this.removeMe = true;
      }
      return;
    }

    const player = ctx.playerPos;
    const dx = player.x - this.pos.x;
    const dz = player.z - this.pos.z;
    const dist = Math.hypot(dx, dz);

    // 신음
    this.groanTimer -= dt;
    if (this.groanTimer <= 0) {
      this.groanTimer = rand(3.5, 9);
      if (dist < 42) SFX.groan(dist, this.typeKey === 'runner');
    }

    if (this.staggerTimer > 0) this.staggerTimer -= dt;
    if (this.attackTimer > 0) this.attackTimer -= dt;

    const reach = 1.35 + this.radius;

    /* 공격 */
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windup <= 0) {
        if (dist < reach + 0.6 && ctx.damagePlayer) {
          ctx.damagePlayer(this.dmg, this);
        }
        this.attackTimer = this.attackCd;
      }
      this._faceTowards(dx, dz, dt, 9);
      this._animateAttack();
      return;
    }

    if (dist < reach && this.attackTimer <= 0) {
      this.windup = 0.32;
      this._animateAttack();
      return;
    }

    /* 이동 */
    let dirX = 0;
    let dirZ = 0;

    /*
      시야 검사는 격자 레이캐스트라 매 프레임 34마리분을 돌리면
      이 게임에서 가장 비싼 연산이 된다. 좀비별로 0.2초마다만 갱신한다.
    */
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.2 + Math.random() * 0.08; // 한 프레임에 몰리지 않게 분산
      this._losEye.set(this.pos.x, 1.6 * this.scale, this.pos.z);
      this.losClear = dist < 34 && SCHOOL.hasLineOfSight(this._losEye, player);
    }
    const useDirect = this.losClear && dist < 34;

    if (useDirect && dist > 0.01) {
      dirX = dx / dist;
      dirZ = dz / dist;
    } else if (ctx.flow) {
      const d = flowDirection(ctx.flow, this.pos.x, this.pos.z);
      if (d) {
        dirX = d.x;
        dirZ = d.z;
      } else if (dist > 0.01) {
        dirX = dx / dist;
        dirZ = dz / dist;
      }
    }

    // 좀비끼리 밀어내기
    let sepX = 0;
    let sepZ = 0;
    const near = ctx.neighbors(this);
    for (let i = 0; i < near.length; i++) {
      const o = near[i];
      if (o === this || o.dead) continue;
      const ox = this.pos.x - o.pos.x;
      const oz = this.pos.z - o.pos.z;
      const d2 = ox * ox + oz * oz;
      const minD = this.radius + o.radius;
      if (d2 > 0.0001 && d2 < minD * minD) {
        const d = Math.sqrt(d2);
        const push = (minD - d) / minD;
        sepX += (ox / d) * push;
        sepZ += (oz / d) * push;
      }
    }
    dirX += sepX * 1.6;
    dirZ += sepZ * 1.6;

    const dl = Math.hypot(dirX, dirZ);
    if (dl > 0.0001) {
      dirX /= dl;
      dirZ /= dl;
    }

    let spd = this.speed;
    if (this.staggerTimer > 0) spd *= 0.25;
    // 걸을 때의 뒤뚱거림
    spd *= 0.88 + 0.12 * Math.sin(this.animTime * 4);

    const step = spd * dt;
    const nx = this.pos.x + dirX * step;
    const nz = this.pos.z + dirZ * step;

    if (!SCHOOL.circleBlocked(nx, this.pos.z, this.radius, 'tall')) this.pos.x = nx;
    else {
      // 벽을 따라 미끄러지기
      const slide = this.pos.z + (dirZ >= 0 ? step : -step) * 0.6;
      if (!SCHOOL.circleBlocked(this.pos.x, slide, this.radius, 'tall')) this.pos.z = slide;
    }
    if (!SCHOOL.circleBlocked(this.pos.x, nz, this.radius, 'tall')) this.pos.z = nz;

    this.group.position.set(this.pos.x, this.group.position.y, this.pos.z);
    this._faceTowards(dirX, dirZ, dt, 6);
    this._animateWalk(spd);
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

  _animateWalk(spd) {
    const t = this.animTime * (2.6 + spd * 0.7);
    const s = Math.sin(t);
    const c = Math.cos(t);
    this.legL.rotation.x = s * 0.68;
    this.legR.rotation.x = -s * 0.68;
    this.armL.rotation.x = -1.25 + c * 0.22;
    this.armR.rotation.x = -1.32 - c * 0.22;
    this.armL.rotation.z = 0.2 + s * 0.08;
    this.armR.rotation.z = -0.24 - s * 0.08;
    this.bodyRoot.position.y = Math.abs(s) * 0.055;
    this.bodyRoot.rotation.x = 0.16 + s * 0.04;
    this.bodyRoot.rotation.z = c * 0.07;
  }

  _animateAttack() {
    const p = 1 - clamp(this.windup / 0.32, 0, 1);
    const swing = Math.sin(p * Math.PI) * 1.5;
    this.armL.rotation.x = -1.6 - swing;
    this.armR.rotation.x = -1.6 - swing;
    this.bodyRoot.rotation.x = 0.16 + swing * 0.18;
    this.legL.rotation.x = 0.1;
    this.legR.rotation.x = -0.1;
  }
}

/* ---------------------------------------------------------
   플로우 필드 (플레이어 위치에서의 BFS 거리맵)
   --------------------------------------------------------- */
function computeFlowField(targetX, targetZ) {
  const W = SCHOOL.MAP_W;
  const H = SCHOOL.MAP_H;
  const dist = new Int16Array(W * H).fill(-1);
  const tx = SCHOOL.cx(targetX);
  const ty = SCHOOL.cz(targetZ);
  if (!SCHOOL.isWalkable(tx, ty)) {
    // 타겟이 벽 안이면 가장 가까운 통행 가능 칸으로 대체
    let found = null;
    for (let r = 1; r <= 3 && !found; r++) {
      for (let dy = -r; dy <= r && !found; dy++) {
        for (let dx = -r; dx <= r && !found; dx++) {
          if (SCHOOL.isWalkable(tx + dx, ty + dy)) found = [tx + dx, ty + dy];
        }
      }
    }
    if (!found) return dist;
    return bfs(dist, found[0], found[1], W, H);
  }
  return bfs(dist, tx, ty, W, H);
}

function bfs(dist, sx, sy, W, H) {
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  dist[sy * W + sx] = 0;
  queue[tail++] = sy * W + sx;
  const dirs = [1, -1, W, -W];
  while (head < tail) {
    const cur = queue[head++];
    const d = dist[cur];
    const cxx = cur % W;
    for (let i = 0; i < 4; i++) {
      const n = cur + dirs[i];
      if (n < 0 || n >= W * H) continue;
      // 좌우 이동 시 행 경계를 넘지 않도록
      if (i < 2 && Math.abs((n % W) - cxx) !== 1) continue;
      if (dist[n] !== -1) continue;
      if (SCHOOL.grid[n] === 1) continue;
      if (SCHOOL.navBlocked[n]) continue; // 기둥·의자 더미가 칸 중심을 막은 곳
      dist[n] = d + 1;
      queue[tail++] = n;
    }
  }
  return dist;
}

/* 현재 위치에서 거리맵이 줄어드는 방향 */
function flowDirection(flow, x, z) {
  const W = SCHOOL.MAP_W;
  const gx = SCHOOL.cx(x);
  const gy = SCHOOL.cz(z);
  if (!SCHOOL.isWalkable(gx, gy)) return null;
  const cur = flow[gy * W + gx];
  if (cur < 0) return null;

  let bestD = cur;
  let bestX = 0;
  let bestZ = 0;
  let found = false;

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = gx + dx;
      const ny = gy + dy;
      if (!SCHOOL.isWalkable(nx, ny)) continue;
      if (SCHOOL.navBlocked[ny * W + nx]) continue;
      // 대각선은 양 옆이 뚫려 있을 때만
      if (dx && dy && (!SCHOOL.isWalkable(gx + dx, gy) || !SCHOOL.isWalkable(gx, gy + dy))) continue;
      const d = flow[ny * W + nx];
      if (d < 0) continue;
      if (d < bestD) {
        bestD = d;
        bestX = nx;
        bestZ = ny;
        found = true;
      }
    }
  }
  if (!found) return null;

  const tx = SCHOOL.wx(bestX);
  const tz = SCHOOL.wz(bestZ);
  const vx = tx - x;
  const vz = tz - z;
  const l = Math.hypot(vx, vz);
  if (l < 0.0001) return null;
  return { x: vx / l, z: vz / l };
}
