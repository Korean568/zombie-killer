/* =========================================================
   bot.js - 다른 플레이어 자리를 채우는 봇
   부하와 같은 모습이지만 명령을 받지 않고 혼자 돌아다니며
   좀비를 사냥하고 무기도 알아서 바꾼다.
   ========================================================= */

/* 봇이 드는 무기 (플레이어 무기와 비슷한 성격) */
const BOT_WEAPONS = [
  { name: '권총', dmg: 16, cooldown: 0.85, range: 26, accuracy: 0.74 },
  { name: '산탄총', dmg: 38, cooldown: 1.5, range: 14, accuracy: 0.66 },
  { name: '소총', dmg: 21, cooldown: 0.5, range: 34, accuracy: 0.8 },
];

const BOT_NAMES = [
  '김민준', '이서연', '박도윤', '최지우', '정하준', '강서준', '조유진', '윤시우',
  '장하은', '임채원', '한지호', '오예린', '신건우', '권수아', '황시윤', '안루하',
  '송민서', '류지안', '배현우', '남시은', '문준영', '양서윤', '고은우', '백채은',
];

function botName(i) {
  const base = BOT_NAMES[i % BOT_NAMES.length];
  // 이름이 겹치면 숫자를 붙인다
  return i < BOT_NAMES.length ? base : base + (Math.floor(i / BOT_NAMES.length) + 1);
}

class Bot extends Ally {
  constructor(pos, rank, name) {
    super(pos, rank);
    this.isBot = true;
    this.name = name || '봇';
    this.kills = 0;

    this.weapon = randInt(0, BOT_WEAPONS.length - 1);
    this.weaponTimer = rand(8, 20);

    this.dest = null;
    this.destTimer = 0;
    this.stuckTimer = 0;
    this.lastX = pos.x;
    this.lastZ = pos.z;
  }

  /* 부하는 계급 사양을 쓰지만 봇은 자기 무기 사양을 쓴다 */
  get combat() {
    const w = BOT_WEAPONS[this.weapon];
    const r = this.spec;
    return {
      dmg: w.dmg,
      cooldown: w.cooldown,
      range: w.range,
      accuracy: w.accuracy,
      hp: r.hp,
    };
  }

  pickDestination() {
    const cells = SCHOOL.navCells;
    for (let i = 0; i < 30; i++) {
      const c = cells[(Math.random() * cells.length) | 0];
      const x = SCHOOL.wx(c[0]);
      const z = SCHOOL.wz(c[1]);
      if (SCHOOL.navBlocked[c[1] * SCHOOL.MAP_W + c[0]]) continue;
      if (Math.hypot(x - this.pos.x, z - this.pos.z) < 8) continue;
      this.dest = { x: x, z: z };
      this.destTimer = rand(12, 26);
      return;
    }
    this.dest = null;
    this.destTimer = 3;
  }

  update(dt, ctx) {
    if (this.dead) return;
    this.animTime += dt;

    const c = this.combat;

    /* 무기를 가끔 바꾼다 */
    this.weaponTimer -= dt;
    if (this.weaponTimer <= 0) {
      this.weaponTimer = rand(10, 24);
      this.weapon = randInt(0, BOT_WEAPONS.length - 1);
    }

    /* 사격 대상 */
    this.losTimer -= dt;
    if (this.losTimer <= 0) {
      this.losTimer = 0.3 + Math.random() * 0.15;
      this.target = this._findTarget(ctx, c.range);
    }
    if (this.target && (this.target.dead || this.target.removeMe)) this.target = null;

    /* 목적지 */
    this.destTimer -= dt;
    if (!this.dest || this.destTimer <= 0) this.pickDestination();

    let moving = false;
    // 교전 중이면 제자리에서 쏘고, 아니면 목적지로 이동
    if (!this.target && this.dest) {
      const dx = this.dest.x - this.pos.x;
      const dz = this.dest.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 1.5) {
        this.pickDestination();
      } else {
        let dirX = dx / dist;
        let dirZ = dz / dist;

        // 서로 겹치지 않게
        for (let i = 0; i < ctx.bots.length; i++) {
          const o = ctx.bots[i];
          if (o === this || o.dead) continue;
          const ox = this.pos.x - o.pos.x;
          const oz = this.pos.z - o.pos.z;
          const d2 = ox * ox + oz * oz;
          const minD = this.radius + o.radius;
          if (d2 > 0.0001 && d2 < minD * minD) {
            const dd = Math.sqrt(d2);
            dirX += (ox / dd) * 1.3;
            dirZ += (oz / dd) * 1.3;
          }
        }
        const dl = Math.hypot(dirX, dirZ) || 1;
        dirX /= dl;
        dirZ /= dl;

        const step = 3.6 * dt;
        const nx = this.pos.x + dirX * step;
        const nz = this.pos.z + dirZ * step;
        if (!SCHOOL.circleBlocked(nx, this.pos.z, this.radius, 'tall')) this.pos.x = nx;
        if (!SCHOOL.circleBlocked(this.pos.x, nz, this.radius, 'tall')) this.pos.z = nz;
        this.group.position.set(this.pos.x, 0, this.pos.z);
        moving = true;
        this._faceTowards(dirX, dirZ, dt, 5);
      }
    }

    /* 벽에 끼면 목적지를 새로 잡는다 */
    const movedDist = Math.hypot(this.pos.x - this.lastX, this.pos.z - this.lastZ);
    this.lastX = this.pos.x;
    this.lastZ = this.pos.z;
    if (moving && movedDist < 0.004) {
      this.stuckTimer += dt;
      if (this.stuckTimer > 0.8) {
        this.stuckTimer = 0;
        this.pickDestination();
      }
    } else {
      this.stuckTimer = 0;
    }

    /* 교전 */
    if (this.target) {
      this._faceTowards(
        this.target.pos.x - this.pos.x,
        this.target.pos.z - this.pos.z,
        dt,
        8
      );
      if (this.fireTimer > 0) this.fireTimer -= dt;
      if (this.fireTimer <= 0) {
        this._botShoot(ctx, c);
        this.fireTimer = c.cooldown * rand(0.85, 1.15);
      }
    } else if (this.fireTimer > 0) {
      this.fireTimer -= dt;
    }

    if (this.muzzleTimer > 0) {
      this.muzzleTimer -= dt;
      if (this.muzzleTimer <= 0) this.muzzle.visible = false;
    }
    if (this.flashTimer > 0) this.flashTimer -= dt;

    this._animate(moving);
  }

  _botShoot(ctx, c) {
    const z = this.target;
    this.muzzle.visible = true;
    this.muzzleTimer = 0.05;

    const from = new THREE.Vector3(this.pos.x, 1.45, this.pos.z);
    const to = new THREE.Vector3(z.pos.x, 1.2 * z.scale, z.pos.z);
    if (ctx.tracer) ctx.tracer(from, to);
    SFX.allyShot(this.pos.distanceTo(ctx.playerPos));

    if (Math.random() > c.accuracy) return;
    const head = Math.random() < 0.15;
    const killed = z.hurt(c.dmg * (head ? 2.2 : 1), head);
    if (killed) this.kills++;
    if (ctx.onBotHit) ctx.onBotHit(z, to, killed, head);
  }
}
