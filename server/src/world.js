/* =========================================================
   world.js - 서버가 돌리는 좀비 시뮬레이션

   클라이언트(js/school.js, js/zombie.js)와 같은 맵 구조를 서버에서
   다시 만들어, 좀비 생성·길찾기·이동·공격을 전부 여기서 계산한다.
   클라이언트는 결과만 받아 그린다.
   ========================================================= */

export const TILE = 4;
export const MAP_W = 44;
export const MAP_H = 16;
const HALF_W = (MAP_W * TILE) / 2;
const HALF_H = (MAP_H * TILE) / 2;

const ROOM_X = [[1, 7], [9, 15], [17, 23], [25, 31]];
const TOP_Y = [1, 5];
const BOT_Y = [10, 14];
const COR_Y = [7, 8];
const GYM_X = [33, 42];
const GYM_Y = [1, 14];

/* 좀비 종류 (클라이언트와 수치를 맞춘다) */
const TYPES = [
  { key: 'walker', hp: 100, speed: 2.25, dmg: 13, reach: 1.77, cd: 1.15 },
  { key: 'runner', hp: 62, speed: 6.3, dmg: 9, reach: 1.74, cd: 0.75 },
  { key: 'brute', hp: 430, speed: 1.75, dmg: 34, reach: 1.96, cd: 1.8 },
];

const idx = (x, y) => y * MAP_W + x;
const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;
export const wx = (gx) => (gx + 0.5) * TILE - HALF_W;
export const wz = (gy) => (gy + 0.5) * TILE - HALF_H;
const cx = (x) => Math.floor((x + HALF_W) / TILE);
const cz = (z) => Math.floor((z + HALF_H) / TILE);

/* ---------------- 격자 ---------------- */
function buildGrid() {
  const grid = new Uint8Array(MAP_W * MAP_H).fill(1);
  const rooms = [];

  const carve = (x0, y0, x1, y1) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (inBounds(x, y)) grid[idx(x, y)] = 0;
      }
    }
  };

  carve(1, COR_Y[0], 31, COR_Y[1]); // 복도
  ROOM_X.forEach((rx, i) => {
    carve(rx[0], TOP_Y[0], rx[1], TOP_Y[1]);
    rooms.push({ id: i + 1, x0: rx[0], y0: TOP_Y[0], x1: rx[1], y1: TOP_Y[1], gym: false });
    carve(rx[0], BOT_Y[0], rx[1], BOT_Y[1]);
    rooms.push({ id: i + 5, x0: rx[0], y0: BOT_Y[0], x1: rx[1], y1: BOT_Y[1], gym: false });
  });
  carve(GYM_X[0], GYM_Y[0], GYM_X[1], GYM_Y[1]);
  rooms.push({ id: 9, x0: GYM_X[0], y0: GYM_Y[0], x1: GYM_X[1], y1: GYM_Y[1], gym: true });

  ROOM_X.forEach((rx) => {
    const dx = rx[0] + 3;
    carve(dx, 6, dx + 1, 6);
    carve(dx, 9, dx + 1, 9);
  });
  carve(32, COR_Y[0], 32, COR_Y[1]);
  carve(32, 12, 32, 13);
  carve(8, 3, 8, 3);
  carve(16, 4, 16, 4);
  carve(24, 12, 24, 12);
  carve(16, 11, 16, 11);

  return { grid, rooms };
}

export class World {
  constructor() {
    const g = buildGrid();
    this.grid = g.grid;
    this.rooms = g.rooms;
    this.roomState = this.rooms.map((r) => ({ room: r, triggered: false, count: roomCount(r) }));

    this.zombies = [];
    this.nextZid = 1;
    this.flow = new Int16Array(MAP_W * MAP_H).fill(-1);
    this.flowTimer = 0;
    this.cleared = false;
  }

  isSolid(x, y) {
    return !inBounds(x, y) || this.grid[idx(x, y)] === 1;
  }

  blocked(x, z, r) {
    const minX = cx(x - r), maxX = cx(x + r), minZ = cz(z - r), maxZ = cz(z + r);
    for (let gy = minZ; gy <= maxZ; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (!this.isSolid(gx, gy)) continue;
        const cxw = wx(gx), czw = wz(gy);
        const nx = Math.max(cxw - TILE / 2, Math.min(x, cxw + TILE / 2));
        const nz = Math.max(czw - TILE / 2, Math.min(z, czw + TILE / 2));
        const dx = x - nx, dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }
    return false;
  }

  /* 살아 있는 모든 플레이어에서 동시에 퍼지는 BFS.
     각 칸은 '가장 가까운 사람까지의 거리'를 갖게 된다. */
  computeFlow(players) {
    const dist = this.flow;
    dist.fill(-1);
    const queue = new Int32Array(MAP_W * MAP_H);
    let head = 0, tail = 0;

    for (const p of players) {
      if (!p.state || p.dead) continue;
      const gx = cx(p.state.x), gy = cz(p.state.z);
      if (!inBounds(gx, gy) || this.grid[idx(gx, gy)] === 1) continue;
      const k = idx(gx, gy);
      if (dist[k] !== -1) continue;
      dist[k] = 0;
      queue[tail++] = k;
    }

    const dirs = [1, -1, MAP_W, -MAP_W];
    while (head < tail) {
      const cur = queue[head++];
      const d = dist[cur];
      const colX = cur % MAP_W;
      for (let i = 0; i < 4; i++) {
        const n = cur + dirs[i];
        if (n < 0 || n >= MAP_W * MAP_H) continue;
        if (i < 2 && Math.abs((n % MAP_W) - colX) !== 1) continue;
        if (dist[n] !== -1 || this.grid[n] === 1) continue;
        dist[n] = d + 1;
        queue[tail++] = n;
      }
    }
  }

  flowDir(x, z) {
    const gx = cx(x), gy = cz(z);
    if (!inBounds(gx, gy)) return null;
    const cur = this.flow[idx(gx, gy)];
    if (cur < 0) return null;
    let best = cur, bx = 0, by = 0, found = false;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = gx + dx, ny = gy + dy;
        if (!inBounds(nx, ny) || this.grid[idx(nx, ny)] === 1) continue;
        if (dx && dy && (this.isSolid(gx + dx, gy) || this.isSolid(gx, gy + dy))) continue;
        const d = this.flow[idx(nx, ny)];
        if (d < 0 || d >= best) continue;
        best = d; bx = nx; by = ny; found = true;
      }
    }
    if (!found) return null;
    const vx = wx(bx) - x, vz = wz(by) - z;
    const l = Math.hypot(vx, vz) || 1;
    return { x: vx / l, z: vz / l };
  }

  /* 플레이어가 방에 들어가면 그 방 좀비를 깨운다 */
  checkRooms(players, onTrigger) {
    for (const st of this.roomState) {
      if (st.triggered) continue;
      const r = st.room;
      for (const p of players) {
        if (!p.state || p.dead) continue;
        const gx = cx(p.state.x), gy = cz(p.state.z);
        if (gx >= r.x0 && gx <= r.x1 && gy >= r.y0 && gy <= r.y1) {
          this.spawnRoom(st);
          if (onTrigger) onTrigger(r, st.spawned);
          break;
        }
      }
    }
  }

  spawnRoom(st) {
    st.triggered = true;
    const r = st.room;
    let placed = 0;
    for (let a = 0; a < st.count * 30 && placed < st.count; a++) {
      const gx = r.x0 + Math.floor(Math.random() * (r.x1 - r.x0 + 1));
      const gy = r.y0 + Math.floor(Math.random() * (r.y1 - r.y0 + 1));
      const x = wx(gx) + (Math.random() * 2.8 - 1.4);
      const z = wz(gy) + (Math.random() * 2.8 - 1.4);
      if (this.blocked(x, z, 0.55)) continue;

      const roll = Math.random();
      let t = 0;
      if (r.gym) t = roll < 0.3 ? 1 : roll < 0.42 ? 2 : 0;
      else t = roll < 0.18 ? 1 : roll < 0.23 ? 2 : 0;

      const spec = TYPES[t];
      this.zombies.push({
        id: this.nextZid++,
        t,
        x, z,
        f: Math.random() * Math.PI * 2,
        hp: spec.hp,
        maxHp: spec.hp,
        cd: 0,
        dead: false,
        deadAt: 0,
      });
      placed++;
    }
    st.spawned = placed;
  }

  hurt(zid, dmg) {
    const z = this.zombies.find((q) => q.id === zid && !q.dead);
    if (!z) return null;
    z.hp -= dmg;
    if (z.hp <= 0) {
      z.dead = true;
      z.deadAt = Date.now();
      return z;
    }
    return null;
  }

  aliveCount() {
    let n = 0;
    for (const z of this.zombies) if (!z.dead) n++;
    return n;
  }

  pendingCount() {
    let n = 0;
    for (const st of this.roomState) if (!st.triggered) n += st.count;
    return n;
  }

  roomsLeft() {
    let n = 0;
    for (const st of this.roomState) if (!st.triggered) n++;
    return n;
  }

  /* 한 스텝 */
  update(dt, players, onAttack) {
    this.flowTimer -= dt;
    if (this.flowTimer <= 0) {
      this.flowTimer = 0.4;
      this.computeFlow(players);
    }

    const live = players.filter((p) => p.state && !p.dead);
    const now = Date.now();

    for (const z of this.zombies) {
      if (z.dead) continue;
      const spec = TYPES[z.t];

      // 가장 가까운 플레이어
      let near = null, nd = Infinity;
      for (const p of live) {
        const d = Math.hypot(p.state.x - z.x, p.state.z - z.z);
        if (d < nd) { nd = d; near = p; }
      }
      if (!near) continue;

      if (z.cd > 0) z.cd -= dt;

      // 공격 사거리
      if (nd < spec.reach) {
        z.f = Math.atan2(near.state.x - z.x, near.state.z - z.z);
        if (z.cd <= 0) {
          z.cd = spec.cd;
          if (onAttack) onAttack(near, spec.dmg);
        }
        continue;
      }

      // 이동: 가까우면 직선, 멀면 흐름장
      let dx = 0, dz = 0;
      if (nd < 14) {
        dx = (near.state.x - z.x) / nd;
        dz = (near.state.z - z.z) / nd;
      } else {
        const d = this.flowDir(z.x, z.z);
        if (d) { dx = d.x; dz = d.z; }
        else { dx = (near.state.x - z.x) / nd; dz = (near.state.z - z.z) / nd; }
      }

      // 좀비끼리 밀어내기 (가까운 것만 훑는다)
      for (const o of this.zombies) {
        if (o === z || o.dead) continue;
        const ox = z.x - o.x, oz = z.z - o.z;
        const d2 = ox * ox + oz * oz;
        if (d2 > 1.2 || d2 < 0.0001) continue;
        const d = Math.sqrt(d2);
        dx += (ox / d) * 0.8;
        dz += (oz / d) * 0.8;
      }

      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;

      const step = spec.speed * dt;
      const nx = z.x + dx * step;
      const nz2 = z.z + dz * step;
      if (!this.blocked(nx, z.z, 0.42)) z.x = nx;
      if (!this.blocked(z.x, nz2, 0.42)) z.z = nz2;
      z.f = Math.atan2(dx, dz);
    }

    // 쓰러진 지 오래된 것은 목록에서 뺀다
    if (this.zombies.length > 200) {
      this.zombies = this.zombies.filter((z) => !z.dead || now - z.deadAt < 9000);
    }

    if (!this.cleared && this.roomsLeft() === 0 && this.aliveCount() === 0) {
      this.cleared = true;
      return 'cleared';
    }
    return null;
  }

  /* 전송용 압축 스냅샷 */
  snapshot() {
    const out = [];
    for (const z of this.zombies) {
      if (z.dead) continue;
      out.push([z.id, Math.round(z.x * 10) / 10, Math.round(z.z * 10) / 10,
                Math.round(z.f * 100) / 100, z.t]);
    }
    return out;
  }
}

function roomCount(r) {
  return r.gym ? 20 + Math.floor(Math.random() * 7) : 4 + Math.floor(Math.random() * 4);
}
