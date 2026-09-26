/* =========================================================
   school.js - 폐교 맵 생성 (그리드 -> 지오메트리 / 소품 / 조명)
   ========================================================= */

const SCHOOL = (function () {
  const TILE = 4;
  const WALL_H = 4.6;
  const GYM_H = 8.4;
  const CAVE_H = 7.2;
  /*
    격자는 동쪽으로 늘려 운동장과 동굴을 붙였다.
    원점은 예전 학교(44칸) 기준 그대로 둔다 — 이걸 바꾸면 서버가 보내는
    좀비 좌표와 학교 위치가 통째로 어긋난다.
  */
  const MAP_W = 80;
  const ORIGIN_W = 44;
  const MAP_H = 16;

  const HALF_W = (ORIGIN_W * TILE) / 2;
  const HALF_H = (MAP_H * TILE) / 2;

  /* zone: 0=벽, 1=복도, 2=교실, 3=체육관, 4=운동장, 5=동굴 */
  const grid = new Uint8Array(MAP_W * MAP_H); // 1 = 벽
  const zone = new Uint8Array(MAP_W * MAP_H);
  // 벽 칸의 실제 높이. 체육관에 면한 벽은 GYM_H 까지 올라간다.
  // (zone 은 통행 가능한 칸에만 찍히므로 벽 높이 판정에 쓸 수 없다)
  const wallTop = new Float32Array(MAP_W * MAP_H);

  const rooms = [];
  const fixtures = []; // 형광등 {x,z,y,alive,phase,rate,base,on}
  const navCells = [];
  const lockerSpots = []; // 사물함 위치 (아이템 수색용)
  const doors = [];       // 교실 문 {pivot, roomId, open, angle, target}

  /*
    소품 충돌.
    맵 전체를 매번 훑으면 수백 개를 검사하게 되므로,
    각 소품을 자기가 걸치는 격자 칸에 등록해 두고(브로드페이즈)
    충돌 검사 때는 주변 칸의 것만 본다.
  */
  const colliderCells = new Array(MAP_W * MAP_H);

  /*
    칸 중심이 '넘을 수 없는' 소품에 막혀 있는 칸.
    경로 탐색(BFS)은 격자만 보기 때문에, 이런 칸을 목표로 잡으면
    좀비가 기둥이나 의자 더미에 붙어 비비게 된다. 아예 길에서 제외한다.
  */
  const navBlocked = new Uint8Array(MAP_W * MAP_H);

  let root = null;
  let lightPool = [];
  let lightBudget = 6;
  let tubeMesh = null;
  let doorWood = null;
  let doorGlass = null;
  let tubeColorNeedsUpdate = false;
  let sortTimer = 0;
  let sortedFixtures = [];

  const idx = (x, y) => y * MAP_W + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < MAP_W && y < MAP_H;

  /*
    맵 배치용 난수. utils.js 의 전역 rand/randInt 를 이 모듈 안에서만 가려서
    소품 위치·회전까지 전부 시드를 따르게 한다.
    (예전엔 시드를 만들어 놓고 정작 좌표는 Math.random 을 써서 매번 달라졌다)
  */
  let srng = Math.random;
  function rand(a, b) {
    return a + srng() * (b - a);
  }
  function randInt(a, b) {
    return Math.floor(a + srng() * (b - a + 1));
  }

  /*
    소품 콜라이더 등록.
    회전한 가구는 회전을 무시하고 긴 변 기준으로 감싸는 AABB 로 다룬다
    (책상 하나 때문에 OBB 판정까지 갈 필요는 없다).
    tall = true 면 좀비도 넘지 못한다.
  */
  function addPropCollider(x, z, hw, hd, tall) {
    const c = { x, z, hw, hd, tall: !!tall };
    const gx0 = cx(x - hw);
    const gx1 = cx(x + hw);
    const gz0 = cz(z - hd);
    const gz1 = cz(z + hd);
    for (let gy = gz0; gy <= gz1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (!inBounds(gx, gy)) continue;
        const k = idx(gx, gy);
        if (!colliderCells[k]) colliderCells[k] = [];
        colliderCells[k].push(c);
      }
    }
  }

  function isSolid(x, y) {
    if (!inBounds(x, y)) return true;
    return grid[idx(x, y)] === 1;
  }
  function isWalkable(x, y) {
    return inBounds(x, y) && grid[idx(x, y)] === 0;
  }
  const wx = (gx) => (gx + 0.5) * TILE - HALF_W;
  const wz = (gy) => (gy + 0.5) * TILE - HALF_H;
  const cx = (x) => Math.floor((x + HALF_W) / TILE);
  const cz = (z) => Math.floor((z + HALF_H) / TILE);

  /* ---------------- 그리드 레이아웃 ---------------- */
  const ROOM_X = [
    [1, 7],
    [9, 15],
    [17, 23],
    [25, 31],
  ];
  const TOP_Y = [1, 5];
  const BOT_Y = [10, 14];
  const COR_Y = [7, 8];
  const GYM_X = [33, 42];
  const GYM_Y = [1, 14];

  /* 체육관 뒤 운동장 */
  const FIELD_X = [45, 56];
  const FIELD_Y = [2, 13];
  /* 운동장 안쪽 벽에 생기는 문 (학교를 다 비워야 열린다) */
  const CAVE_DOOR = [57, 7, 57, 8];
  /* 보스 아레나 입구 (동굴 방을 다 비워야 열린다) */
  const BOSS_DOOR = [71, 7, 71, 8];
  const caveRooms = [];

  function carve(x0, y0, x1, y1, z) {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inBounds(x, y)) continue;
        grid[idx(x, y)] = 0;
        zone[idx(x, y)] = z;
      }
    }
  }

  function buildGrid() {
    grid.fill(1);
    zone.fill(0);

    // 중앙 복도
    carve(1, COR_Y[0], 31, COR_Y[1], 1);

    // 교실 8개
    ROOM_X.forEach((rx, i) => {
      carve(rx[0], TOP_Y[0], rx[1], TOP_Y[1], 2);
      rooms.push({
        x0: rx[0], y0: TOP_Y[0], x1: rx[1], y1: TOP_Y[1],
        type: 'class', side: 'top', id: i + 1,
      });
      carve(rx[0], BOT_Y[0], rx[1], BOT_Y[1], 2);
      rooms.push({
        x0: rx[0], y0: BOT_Y[0], x1: rx[1], y1: BOT_Y[1],
        type: 'class', side: 'bottom', id: i + 5,
      });
    });

    // 체육관
    carve(GYM_X[0], GYM_Y[0], GYM_X[1], GYM_Y[1], 3);
    rooms.push({
      x0: GYM_X[0], y0: GYM_Y[0], x1: GYM_X[1], y1: GYM_Y[1],
      type: 'gym', side: 'east', id: 9,
    });

    // 교실 -> 복도 출입문
    ROOM_X.forEach((rx) => {
      const dx = rx[0] + 3;
      carve(dx, 6, dx + 1, 6, 1);
      carve(dx, 9, dx + 1, 9, 1);
    });

    // 복도 -> 체육관 (정문 + 측면 통로)
    carve(32, COR_Y[0], 32, COR_Y[1], 1);
    carve(32, 12, 32, 13, 1);

    // 교실 간 샛문 (측면 우회로)
    carve(8, 3, 8, 3, 2);
    carve(16, 4, 16, 4, 2);
    carve(24, 12, 24, 12, 2);
    carve(16, 11, 16, 11, 2);

    buildOutside();

    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (grid[idx(x, y)] === 0) navCells.push([x, y]);
      }
    }
  }

  /*
    운동장 + 동굴.
    동굴은 방 4개와 보스 아레나로 이루어져 있고,
    두 개의 문(운동장 안쪽 / 보스 아레나)은 처음에 막혀 있다.
  */
  function buildOutside() {
    caveRooms.length = 0;

    // 운동장
    carve(FIELD_X[0], FIELD_Y[0], FIELD_X[1], FIELD_Y[1], 4);
    carve(43, 7, 44, 8, 4); // 체육관 -> 운동장

    // 동굴 입구 (문 칸은 나중에 다시 막는다)
    carve(CAVE_DOOR[0], CAVE_DOOR[1], CAVE_DOOR[2], CAVE_DOOR[3], 5);
    carve(58, 7, 60, 8, 5);

    // 중앙 홀
    carve(61, 4, 65, 11, 5);

    // 방 A (북) / 방 B (남)
    carve(61, 1, 65, 2, 5);
    carve(62, 3, 62, 3, 5);
    carve(61, 13, 65, 14, 5);
    carve(64, 12, 64, 12, 5);

    // 동쪽 통로
    carve(66, 7, 70, 8, 5);

    // 방 C (북동) / 방 D (남동)
    carve(67, 1, 70, 5, 5);
    carve(68, 6, 68, 6, 5);
    carve(67, 10, 70, 14, 5);
    carve(68, 9, 68, 9, 5);

    // 보스 아레나 (문 칸은 나중에 다시 막는다)
    carve(BOSS_DOOR[0], BOSS_DOOR[1], BOSS_DOOR[2], BOSS_DOOR[3], 5);
    carve(72, 3, 78, 12, 5);

    caveRooms.push({ x0: 61, y0: 1, x1: 65, y1: 2, id: 101, name: '북쪽 굴' });
    caveRooms.push({ x0: 61, y0: 13, x1: 65, y1: 14, id: 102, name: '남쪽 굴' });
    caveRooms.push({ x0: 67, y0: 1, x1: 70, y1: 5, id: 103, name: '동북 갱도' });
    caveRooms.push({ x0: 67, y0: 10, x1: 70, y1: 14, id: 104, name: '동남 갱도' });
  }

  /* ---------------- 지오메트리 ---------------- */

  /*
    같은 텍스처를 반복 횟수만 바꿔 쓰려고 clone() 하면
    복제본마다 GPU에 따로 올라간다(512^2 한 장이 밉맵 포함 약 1.3MB).
    교실 8개가 전부 같은 크기라 반복값도 같으므로 캐시해서 재사용한다.
  */
  const tiledCache = new Map();
  let tiledSeq = 0;
  function tiled(tex, rx, ry) {
    if (!tex.__id) tex.__id = 'tex' + ++tiledSeq;
    const key = tex.__id + ':' + rx + 'x' + ry;
    let t = tiledCache.get(key);
    if (t) return t;
    t = tex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    tiledCache.set(key, t);
    return t;
  }

  function addFloor(scene, x0, y0, x1, y1, tex, y) {
    const w = (x1 - x0 + 1) * TILE;
    const d = (y1 - y0 + 1) * TILE;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        map: tiled(tex, w / TILE, d / TILE),
        roughness: 0.94,
        metalness: 0.0,
      })
    );
    m.position.set(
      (wx(x0) + wx(x1)) / 2,
      y || 0,
      (wz(y0) + wz(y1)) / 2
    );
    m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  function addCeiling(scene, x0, y0, x1, y1, h) {
    const w = (x1 - x0 + 1) * TILE;
    const d = (y1 - y0 + 1) * TILE;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(Math.PI / 2);
    const m = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        map: tiled(TEX.ceiling(), w / TILE, d / TILE),
        roughness: 1.0,
        color: 0x8c8c86,
      })
    );
    m.position.set((wx(x0) + wx(x1)) / 2, h, (wz(y0) + wz(y1)) / 2);
    scene.add(m);
    return m;
  }

  function buildWalls(scene) {
    // 바닥과 맞닿은 벽 셀만 인스턴싱
    const cells = [];
    const gymUpper = [];
    const rockCells = [];  // 동굴 암반
    const fieldCells = []; // 운동장 담장
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        if (grid[idx(x, y)] !== 1) continue;
        let touches = false;
        let touchesGym = false;
        let touchesCave = false;
        let touchesField = false;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            if (isWalkable(x + dx, y + dy)) {
              touches = true;
              const zn = zone[idx(x + dx, y + dy)];
              if (zn === 3) touchesGym = true;
              if (zn === 4) touchesField = true;
              if (zn === 5) touchesCave = true;
            }
          }
        }
        if (!touches) continue;
        if (touchesCave) {
          rockCells.push([x, y]);
          wallTop[idx(x, y)] = CAVE_H;
        } else if (touchesField) {
          fieldCells.push([x, y]);
          wallTop[idx(x, y)] = WALL_H;
        } else {
          cells.push([x, y]);
          wallTop[idx(x, y)] = WALL_H;
          if (touchesGym) {
            gymUpper.push([x, y]);
            wallTop[idx(x, y)] = GYM_H;
          }
        }
      }
    }

    // 동굴 암반 / 운동장 담장
    if (rockCells.length) {
      const rm = new THREE.MeshStandardMaterial({
        map: tiled(TEX.rock(), 1, 1), roughness: 1.0, metalness: 0.0, color: 0x9a938c,
      });
      const rg = new THREE.BoxGeometry(TILE, CAVE_H, TILE);
      const ri = new THREE.InstancedMesh(rg, rm, rockCells.length);
      const rmtx = new THREE.Matrix4();
      rockCells.forEach((c, i) => {
        rmtx.makeTranslation(wx(c[0]), CAVE_H / 2, wz(c[1]));
        ri.setMatrixAt(i, rmtx);
      });
      ri.instanceMatrix.needsUpdate = true;
      ri.frustumCulled = false;
      ri.receiveShadow = true;
      scene.add(ri);
    }
    if (fieldCells.length) {
      const fm = new THREE.MeshStandardMaterial({
        map: tiled(TEX.wall(), 1, 1), roughness: 1.0, color: 0x5c605a,
      });
      const fg = new THREE.BoxGeometry(TILE, WALL_H, TILE);
      const fi = new THREE.InstancedMesh(fg, fm, fieldCells.length);
      const fmtx = new THREE.Matrix4();
      fieldCells.forEach((c, i) => {
        fmtx.makeTranslation(wx(c[0]), WALL_H / 2, wz(c[1]));
        fi.setMatrixAt(i, fmtx);
      });
      fi.instanceMatrix.needsUpdate = true;
      fi.frustumCulled = false;
      fi.receiveShadow = true;
      scene.add(fi);
    }

    const wallMat = new THREE.MeshStandardMaterial({
      map: tiled(TEX.wall(), 1, 1),
      roughness: 0.95,
      metalness: 0.0,
    });

    const boxGeo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
    const im = new THREE.InstancedMesh(boxGeo, wallMat, cells.length);
    im.castShadow = true;
    im.receiveShadow = true;
    const mtx = new THREE.Matrix4();
    cells.forEach((c, i) => {
      mtx.makeTranslation(wx(c[0]), WALL_H / 2, wz(c[1]));
      im.setMatrixAt(i, mtx);
    });
    im.instanceMatrix.needsUpdate = true;
    im.frustumCulled = false;
    scene.add(im);

    // 체육관 상부 벽
    const upH = GYM_H - WALL_H;
    const upGeo = new THREE.BoxGeometry(TILE, upH, TILE);
    const upMat = new THREE.MeshStandardMaterial({
      map: tiled(TEX.wall(), 1, 0.5),
      roughness: 0.95,
      color: 0x8f938a,
    });
    const im2 = new THREE.InstancedMesh(upGeo, upMat, gymUpper.length);
    gymUpper.forEach((c, i) => {
      mtx.makeTranslation(wx(c[0]), WALL_H + upH / 2, wz(c[1]));
      im2.setMatrixAt(i, mtx);
    });
    im2.instanceMatrix.needsUpdate = true;
    im2.frustumCulled = false;
    im2.receiveShadow = true;
    scene.add(im2);
  }

  /* ---------------- 소품 ---------------- */

  function deskParts() {
    const parts = [];
    const top = new THREE.BoxGeometry(1.2, 0.07, 0.65);
    parts.push({ geo: top, matrix: MAT(0, 0.74, 0), color: 0x8a6b45 });
    const shelf = new THREE.BoxGeometry(1.1, 0.05, 0.5);
    parts.push({ geo: shelf, matrix: MAT(0, 0.5, 0), color: 0x6d5537 });
    const leg = new THREE.BoxGeometry(0.06, 0.72, 0.06);
    [[-0.52, -0.26], [0.52, -0.26], [-0.52, 0.26], [0.52, 0.26]].forEach((p) => {
      parts.push({ geo: leg.clone(), matrix: MAT(p[0], 0.37, p[1]), color: 0x4a4e52 });
    });
    return parts;
  }

  function chairParts() {
    const parts = [];
    parts.push({ geo: new THREE.BoxGeometry(0.42, 0.05, 0.42), matrix: MAT(0, 0.45, 0), color: 0x8a6b45 });
    parts.push({ geo: new THREE.BoxGeometry(0.42, 0.42, 0.05), matrix: MAT(0, 0.68, 0.19), color: 0x8a6b45 });
    const leg = new THREE.BoxGeometry(0.05, 0.45, 0.05);
    [[-0.17, -0.17], [0.17, -0.17], [-0.17, 0.17], [0.17, 0.17]].forEach((p) => {
      parts.push({ geo: leg.clone(), matrix: MAT(p[0], 0.225, p[1]), color: 0x4a4e52 });
    });
    return parts;
  }

  function debrisParts() {
    const parts = [];
    parts.push({ geo: new THREE.BoxGeometry(0.5, 0.06, 0.4), matrix: MAT(0, 0.03, 0, 0, 0.3, 0), color: 0x8e8a7c });
    parts.push({ geo: new THREE.BoxGeometry(0.3, 0.09, 0.28), matrix: MAT(0.25, 0.05, 0.15, 0, -0.5, 0.1), color: 0x6f6a5e });
    parts.push({ geo: new THREE.BoxGeometry(0.22, 0.04, 0.3), matrix: MAT(-0.2, 0.02, -0.1, 0, 0.9, 0), color: 0xb5ae9a });
    return parts;
  }

  function instanced(scene, geo, mat, transforms) {
    if (!transforms.length) return null;
    const im = new THREE.InstancedMesh(geo, mat, transforms.length);
    transforms.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
    im.castShadow = true;
    im.receiveShadow = true;
    im.frustumCulled = false;
    scene.add(im);
    return im;
  }

  function buildProps(scene, rng) {
    const propMatCache = {};
    const propMat = (hex) => {
      if (!propMatCache[hex]) {
        propMatCache[hex] = new THREE.MeshStandardMaterial({
          color: hex,
          roughness: 0.85,
          metalness: 0.05,
        });
      }
      return propMatCache[hex];
    };

    // 색깔별로 나눠 인스턴싱한다 (변환 행렬은 색 그룹끼리 동일하게 재사용)
    const deskGroups = groupPartsByColor(deskParts());
    const chairGroups = groupPartsByColor(chairParts());
    const debrisGroups = groupPartsByColor(debrisParts());

    const desks = [];
    const chairs = [];
    const debris = [];

    rooms.forEach((r) => {
      if (r.type !== 'class') return;
      const x0 = wx(r.x0) - TILE / 2;
      const x1 = wx(r.x1) + TILE / 2;
      const z0 = wz(r.y0) - TILE / 2;
      const z1 = wz(r.y1) + TILE / 2;
      const cols = 6;
      const rows = 4;
      const sx = (x1 - x0) / (cols + 1);
      const sz = (z1 - z0) / (rows + 1);
      for (let c = 0; c < cols; c++) {
        for (let rr = 0; rr < rows; rr++) {
          if (rng() < 0.18) continue; // 비어 있는 자리
          const px = x0 + sx * (c + 1) + rand(-0.35, 0.35);
          const pz = z0 + sz * (rr + 1) + rand(-0.35, 0.35);
          const flipped = rng() < 0.22;
          if (flipped) {
            desks.push(MAT(px, 0.45, pz, rand(-0.4, 0.4), rand(0, 6.28), Math.PI * 0.5 + rand(-0.4, 0.4)));
            // 뒤집힌 책상은 아무 방향으로나 누워 있어 정사각으로 감싼다
            addPropCollider(px, pz, 0.45, 0.45, false);
          } else {
            desks.push(MAT(px, 0, pz, 0, rand(-0.25, 0.25), 0));
            addPropCollider(px, pz, 0.62, 0.36, false);
            if (rng() < 0.7) {
              const cxp = px + rand(-0.3, 0.3);
              const czp = pz + rand(0.55, 0.95);
              chairs.push(MAT(cxp, 0, czp, 0, rand(-0.6, 0.6) + Math.PI, 0));
              addPropCollider(cxp, czp, 0.24, 0.24, false);
            }
          }
        }
      }
      for (let i = 0; i < 10; i++) {
        debris.push(MAT(rand(x0 + 1, x1 - 1), 0, rand(z0 + 1, z1 - 1), 0, rand(0, 6.28), 0, rand(0.6, 1.5), 1, rand(0.6, 1.5)));
      }
    });

    // 복도 잔해
    for (let i = 0; i < 70; i++) {
      const c = navCells[(rng() * navCells.length) | 0];
      debris.push(MAT(wx(c[0]) + rand(-1.5, 1.5), 0, wz(c[1]) + rand(-1.5, 1.5), 0, rand(0, 6.28), 0, rand(0.5, 1.4), 1, rand(0.5, 1.4)));
    }

    deskGroups.forEach((g) => instanced(scene, g.geo, propMat(g.color), desks));
    chairGroups.forEach((g) => instanced(scene, g.geo, propMat(g.color), chairs));
    // 잔해는 작고 바닥에 붙어 있어 그림자를 드리워도 보이지 않는다.
    // 그림자 패스에서 빼면 '높음' 품질에서 드로우콜이 그만큼 준다.
    debrisGroups.forEach((g) => {
      const im = instanced(scene, g.geo, propMat(g.color), debris);
      if (im) im.castShadow = false;
    });

    buildLockers(scene);
    buildBlackboards(scene);
    buildWindows(scene);
    buildPosters(scene, rng);
    buildGymProps(scene);
    buildBloodStains(scene, rng);
  }

  /* 복도 사물함 */
  function buildLockers(scene) {
    const geo = new THREE.BoxGeometry(2.2, 2.3, 0.55);
    const mat = new THREE.MeshStandardMaterial({
      map: TEX.locker(),
      roughness: 0.6,
      metalness: 0.35,
    });
    const tr = [];
    const push = (x, z, ry) => {
      tr.push(MAT(x, 1.15, z, 0, ry, 0));
      // 수색 가능한 사물함 목록 (ry 는 사물함이 바라보는 방향)
      lockerSpots.push({ x: x, z: z, ry: ry });
      // 사물함은 2.2 x 0.55. 벽을 따라 놓이므로 방향에 맞춰 반치수를 준다
      const alongX = Math.abs(Math.sin(ry)) < 0.5;
      addPropCollider(x, z, alongX ? 1.1 : 0.3, alongX ? 0.3 : 1.1, true);
    };

    for (let x = 1; x <= 31; x++) {
      // 복도 위쪽 벽 (y=6)
      if (isSolid(x, 6) && isWalkable(x, 7)) {
        push(wx(x) - 1.1, wz(6) + TILE / 2 + 0.3, 0);
        push(wx(x) + 1.1, wz(6) + TILE / 2 + 0.3, 0);
      }
      // 복도 아래쪽 벽 (y=9)
      if (isSolid(x, 9) && isWalkable(x, 8)) {
        push(wx(x) - 1.1, wz(9) - TILE / 2 - 0.3, Math.PI);
        push(wx(x) + 1.1, wz(9) - TILE / 2 - 0.3, Math.PI);
      }
    }
    instanced(scene, geo, mat, tr);
  }

  /* 교실 칠판 */
  function buildBlackboards(scene) {
    const mat = new THREE.MeshStandardMaterial({ map: TEX.blackboard(), roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x6b5836, roughness: 0.8 });
    // 해당 측벽에 뚫린 칸(샛문)이 있는지 검사 — 있으면 칠판으로 막으면 안 된다
    const wallClear = (col, y0, y1) => {
      for (let y = y0; y <= y1; y++) if (!isSolid(col, y)) return false;
      return true;
    };

    const frameTr = [];
    rooms.forEach((r) => {
      if (r.type !== 'class') return;
      const zc = (wz(r.y0) + wz(r.y1)) / 2;

      // 왼쪽 측벽 우선, 막혀 있으면 오른쪽 측벽
      let xw;
      let ry;
      if (wallClear(r.x0 - 1, r.y0, r.y1)) {
        xw = wx(r.x0) - TILE / 2 + 0.09;
        ry = Math.PI / 2; // +X 를 바라봄
      } else if (wallClear(r.x1 + 1, r.y0, r.y1)) {
        xw = wx(r.x1) + TILE / 2 - 0.09;
        ry = -Math.PI / 2; // -X 를 바라봄
      } else {
        return; // 양쪽 다 통로면 칠판 생략
      }

      const m = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.6), mat);
      const push = ry > 0 ? 0.03 : -0.03;
      m.position.set(xw + push, 2.2, zc);
      m.rotation.y = ry;
      scene.add(m);
      frameTr.push(MAT(xw, 2.2, zc, 0, ry, 0));
    });
    instanced(scene, new THREE.BoxGeometry(7.7, 3.1, 0.14), frameMat, frameTr);
  }

  /* 창문 */
  function buildWindows(scene) {
    const mat = new THREE.MeshBasicMaterial({ map: TEX.window(), toneMapped: false });
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x2b2f28, roughness: 0.8 });
    const geo = new THREE.PlaneGeometry(3.2, 2.1);
    const frameGeo = new THREE.BoxGeometry(3.5, 2.4, 0.12);
    const panes = [];
    const frames = [];
    const put = (x, z, ry) => {
      panes.push(MAT(x, 2.7, z, 0, ry, 0));
      // 프레임은 창 뒤쪽(벽 안)으로 0.09만큼 밀어 넣는다
      frames.push(MAT(x - Math.sin(ry) * 0.09, 2.7, z - Math.cos(ry) * 0.09, 0, ry, 0));
    };

    for (let x = 1; x < MAP_W - 1; x++) {
      if (isSolid(x, 0) && isWalkable(x, 1)) put(wx(x), wz(0) + TILE / 2 + 0.08, 0);
      if (isSolid(x, MAP_H - 1) && isWalkable(x, MAP_H - 2))
        put(wx(x), wz(MAP_H - 1) - TILE / 2 - 0.08, Math.PI);
    }
    for (let y = 1; y < MAP_H - 1; y++) {
      if (isSolid(MAP_W - 1, y) && isWalkable(MAP_W - 2, y))
        put(wx(MAP_W - 1) - TILE / 2 - 0.08, wz(y), -Math.PI / 2);
    }

    const paneMesh = instanced(scene, geo, mat, panes);
    if (paneMesh) paneMesh.castShadow = false;
    instanced(scene, frameGeo, frameMat, frames);

    // 서쪽 복도 끝: 판자로 막힌 출입문
    const boardMat = new THREE.MeshStandardMaterial({ color: 0x5a452c, roughness: 0.95 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x23282b, roughness: 0.9 });
    const door = new THREE.Mesh(new THREE.BoxGeometry(0.18, 3.0, 3.4), doorMat);
    door.position.set(wx(1) - TILE / 2 + 0.1, 1.5, wz(7) + TILE / 2);
    scene.add(door);
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.34, 4.0), boardMat);
      b.position.set(wx(1) - TILE / 2 + 0.22, 0.7 + i * 0.62, wz(7) + TILE / 2);
      b.rotation.x = rand(-0.08, 0.08);
      scene.add(b);
    }
  }

  /* 포스터 */
  function buildPosters(scene, rng) {
    const geo = new THREE.PlaneGeometry(1.1, 1.55);
    for (let x = 2; x <= 30; x += 2) {
      if (rng() < 0.55) continue;
      const top = rng() < 0.5;
      if (top && isSolid(x, 6) && isWalkable(x, 7)) {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: TEX.poster(randInt(0, 3)), roughness: 0.95 }));
        m.position.set(wx(x) + rand(-1, 1), 3.1, wz(6) + TILE / 2 + 0.05);
        m.rotation.z = rand(-0.05, 0.05);
        scene.add(m);
      } else if (isSolid(x, 9) && isWalkable(x, 8)) {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: TEX.poster(randInt(0, 3)), roughness: 0.95 }));
        m.position.set(wx(x) + rand(-1, 1), 3.1, wz(9) - TILE / 2 - 0.05);
        m.rotation.y = Math.PI;
        m.rotation.z = rand(-0.05, 0.05);
        scene.add(m);
      }
    }
  }

  /* 체육관 소품: 농구 골대 / 매트 */
  function buildGymProps(scene) {
    const gxc = (wx(GYM_X[0]) + wx(GYM_X[1])) / 2;
    const boardMat = new THREE.MeshStandardMaterial({ color: 0xd8d4c4, roughness: 0.7 });
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x2f3438, roughness: 0.5, metalness: 0.6 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xc8501e, roughness: 0.5, metalness: 0.5 });

    [wz(GYM_Y[0]) + 1.5, wz(GYM_Y[1]) - 1.5].forEach((z, i) => {
      const dir = i === 0 ? 1 : -1;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 5.4, 8), poleMat);
      pole.position.set(gxc, 2.7, z);
      pole.castShadow = true;
      scene.add(pole);
      addPropCollider(gxc, z, 0.28, 0.28, true);
      const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.0, 0.12), boardMat);
      board.position.set(gxc, 4.5, z + dir * 0.9);
      board.castShadow = true;
      scene.add(board);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.05, 6, 16), rimMat);
      rim.position.set(gxc, 3.8, z + dir * 1.55);
      rim.rotation.x = Math.PI / 2;
      scene.add(rim);
    });

    // 낡은 체조 매트 (높이 22cm 라 걸려 넘어지지 않도록 콜라이더는 두지 않는다)
    const matMat = new THREE.MeshStandardMaterial({ color: 0x2d4a6b, roughness: 0.95 });
    const matTr = [];
    for (let i = 0; i < 7; i++) {
      matTr.push(MAT(gxc + rand(-14, 14), 0.11, rand(wz(GYM_Y[0]) + 4, wz(GYM_Y[1]) - 4), 0, rand(0, 6.28), 0));
    }
    const matIm = instanced(scene, new THREE.BoxGeometry(2.4, 0.22, 1.3), matMat, matTr);
    if (matIm) matIm.castShadow = false;

    // 접이식 의자 더미
    const stackMat = new THREE.MeshStandardMaterial({ color: 0x4b4034, roughness: 0.9 });
    const stackTr = [];
    for (let i = 0; i < 4; i++) {
      const h = rand(0.8, 1.6);
      const sx = wx(GYM_X[1]) - rand(1, 4);
      const sz = rand(wz(GYM_Y[0]) + 6, wz(GYM_Y[1]) - 6);
      stackTr.push(MAT(sx, h / 2, sz, 0, rand(-0.3, 0.3), 0, 1, h / 1.2, 1));
      addPropCollider(sx, sz, 0.9, 0.55, true);
    }
    instanced(scene, new THREE.BoxGeometry(1.6, 1.2, 0.9), stackMat, stackTr);
  }

  /* 바닥 혈흔 */
  function buildBloodStains(scene, rng) {
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.blood(),
      transparent: true,
      depthWrite: false,
      opacity: 0.75,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    const geo = new THREE.PlaneGeometry(1, 1);
    geo.rotateX(-Math.PI / 2);
    const tr = [];
    for (let i = 0; i < 46; i++) {
      const c = navCells[(rng() * navCells.length) | 0];
      const s = rand(2.2, 6.5);
      tr.push(MAT(wx(c[0]) + rand(-1.6, 1.6), 0.02, wz(c[1]) + rand(-1.6, 1.6), 0, rand(0, 6.28), 0, s, 1, s));
    }
    const im = instanced(scene, geo, mat, tr);
    if (im) {
      im.castShadow = false;
      im.receiveShadow = false;
      im.renderOrder = 1;
    }

    // 벽에 흐른 핏자국
    const wallBloodMat = mat.clone();
    wallBloodMat.opacity = 0.6;
    for (let i = 0; i < 14; i++) {
      const c = navCells[(rng() * navCells.length) | 0];
      // 인접한 벽 찾기
      const dirs = [[1, 0, -Math.PI / 2], [-1, 0, Math.PI / 2], [0, 1, Math.PI], [0, -1, 0]];
      const d = dirs[(rng() * 4) | 0];
      if (!isSolid(c[0] + d[0], c[1] + d[1])) continue;
      const g = new THREE.PlaneGeometry(rand(1.6, 3.2), rand(2.0, 3.6));
      const m = new THREE.Mesh(g, wallBloodMat);
      m.position.set(
        wx(c[0]) + d[0] * (TILE / 2 - 0.04),
        rand(1.2, 2.6),
        wz(c[1]) + d[1] * (TILE / 2 - 0.04)
      );
      m.rotation.y = d[2];
      m.renderOrder = 1;
      scene.add(m);
    }
  }

  /* ---------------- 교실 문 ---------------- */
  /*
    출입구는 격자 2칸(8m)이라 양쪽으로 열리는 여닫이문 두 짝을 단다.
    각 짝은 바깥쪽 모서리에 경첩(pivot)이 있고 그 축으로 회전한다.
  */
  function buildDoors(scene) {
    /*
      문은 36짝이나 된다. 짝마다 메시를 따로 두면 드로우콜이 140개를 넘어
      저사양 기기에서 이것만으로 프레임이 무너진다.
      문짝 전체를 InstancedMesh 두 개(나무판 / 유리창)로 묶고,
      열릴 때마다 인스턴스 행렬만 갱신한다. -> 드로우콜 2개
    */
    const W = TILE - 0.12;
    const H = 3.1;

    const woodGeo = new THREE.BoxGeometry(W, H, 0.1);
    const glassGeo = new THREE.BoxGeometry(W * 0.6, 0.95, 0.12);
    const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5533, roughness: 0.88 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0x8fa6ae, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.35,
    });

    const defs = [];
    const add = (hingeX, hingeZ, axisZ, dir, roomId) => {
      defs.push({ hx: hingeX, hz: hingeZ, base: axisZ ? Math.PI / 2 : 0, dir: dir, roomId: roomId });
    };

    ROOM_X.forEach(function (rx, i) {
      const dx = rx[0] + 3;
      const xL = wx(dx) - TILE / 2;
      const xR = wx(dx + 1) + TILE / 2;
      add(xL, wz(6), false, 1, i + 1);
      add(xR, wz(6), false, -1, i + 1);
      add(xL, wz(9), false, 1, i + 5);
      add(xR, wz(9), false, -1, i + 5);
    });
    [[7, 8], [12, 13]].forEach(function (pair) {
      add(wx(32), wz(pair[0]) - TILE / 2, true, -1, 9);
      add(wx(32), wz(pair[1]) + TILE / 2, true, 1, 9);
    });

    doorWood = new THREE.InstancedMesh(woodGeo, woodMat, defs.length);
    doorGlass = new THREE.InstancedMesh(glassGeo, glassMat, defs.length);
    doorWood.castShadow = true;
    doorWood.frustumCulled = false;
    doorGlass.frustumCulled = false;
    scene.add(doorWood);
    scene.add(doorGlass);

    defs.forEach(function (dfn, i) {
      doors.push({
        i: i, hx: dfn.hx, hz: dfn.hz, base: dfn.base, dir: dfn.dir,
        roomId: dfn.roomId, angle: 0, target: 0, W: W, H: H,
      });
      writeDoor(doors[doors.length - 1]);
    });
    doorWood.instanceMatrix.needsUpdate = true;
    doorGlass.instanceMatrix.needsUpdate = true;
  }

  /* 경첩을 기준으로 문짝 한 짝의 행렬을 다시 쓴다 */
  const _dq = new THREE.Quaternion();
  const _de = new THREE.Euler();
  const _dm = new THREE.Matrix4();
  const _dp = new THREE.Vector3();
  const _ds = new THREE.Vector3(1, 1, 1);
  const _doff = new THREE.Vector3();

  function writeDoor(d) {
    const ang = d.base + d.angle;
    _de.set(0, ang, 0);
    _dq.setFromEuler(_de);

    // 나무판: 경첩에서 폭의 절반만큼 떨어진 곳이 중심
    _doff.set((d.W / 2) * d.dir, d.H / 2, 0).applyQuaternion(_dq);
    _dp.set(d.hx + _doff.x, _doff.y, d.hz + _doff.z);
    _dm.compose(_dp, _dq, _ds);
    doorWood.setMatrixAt(d.i, _dm);

    // 유리창: 같은 축, 높이만 다름
    _doff.set((d.W / 2) * d.dir, d.H * 0.72, 0).applyQuaternion(_dq);
    _dp.set(d.hx + _doff.x, _doff.y, d.hz + _doff.z);
    _dm.compose(_dp, _dq, _ds);
    doorGlass.setMatrixAt(d.i, _dm);
  }

  /* 해당 방의 문을 연다 */
  function openRoomDoors(roomId) {
    for (let i = 0; i < doors.length; i++) {
      if (doors[i].roomId === roomId) {
        doors[i].target = (Math.PI * 0.62) * -doors[i].dir;
      }
    }
  }

  /* 다시 시작할 때 문을 전부 닫아 둔다 (맵은 한 번만 만들어지므로 상태가 남는다) */
  function closeAllDoors() {
    for (let i = 0; i < doors.length; i++) {
      doors[i].angle = 0;
      doors[i].target = 0;
      writeDoor(doors[i]);
    }
    if (doorWood) doorWood.instanceMatrix.needsUpdate = true;
    if (doorGlass) doorGlass.instanceMatrix.needsUpdate = true;
  }

  function updateDoors(dt) {
    let dirty = false;
    for (let i = 0; i < doors.length; i++) {
      const d = doors[i];
      if (Math.abs(d.angle - d.target) < 0.002) continue;
      d.angle += (d.target - d.angle) * clamp(3.2 * dt, 0, 1);
      writeDoor(d);
      dirty = true;
    }
    if (dirty) {
      doorWood.instanceMatrix.needsUpdate = true;
      doorGlass.instanceMatrix.needsUpdate = true;
    }
  }

  /* ---------------- 조명 ---------------- */

  function buildLights(scene, rng, quality) {
    const housingGeo = new THREE.BoxGeometry(2.4, 0.16, 0.5);
    const housingMat = new THREE.MeshStandardMaterial({ color: 0x33352f, roughness: 0.8, metalness: 0.3 });
    const tubeGeo = new THREE.BoxGeometry(2.1, 0.09, 0.28);
    const tubeMat = new THREE.MeshBasicMaterial({ toneMapped: false });

    const housings = [];
    const tubes = [];

    const put = (x, z, h, aliveChance) => {
      const alive = rng() < aliveChance;
      fixtures.push({
        x,
        z,
        y: h - 0.35,
        alive,
        on: alive,
        phase: rand(0, 100),
        rate: rand(0.6, 2.4),
        flickery: rng() < 0.45,
        level: 1,
        index: fixtures.length,
      });
      housings.push(MAT(x, h - 0.12, z));
      tubes.push(MAT(x, h - 0.26, z));
    };

    // 복도
    for (let x = 2; x <= 31; x += 3) put(wx(x), wz(7) + TILE / 2, WALL_H, 0.75);
    // 교실
    rooms.forEach((r) => {
      if (r.type !== 'class') return;
      const xc = (wx(r.x0) + wx(r.x1)) / 2;
      const zc = (wz(r.y0) + wz(r.y1)) / 2;
      // 둘 다 0.55 확률이면 20% 의 교실이 완전 암흑이 된다.
      // 하나는 반드시 살려서 교실마다 최소한의 형태는 보이게 한다.
      put(xc - 6, zc - 4, WALL_H, 1.0);
      put(xc + 6, zc + 4, WALL_H, 0.45);
    });
    // 체육관
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 3; j++) {
        put(
          wx(GYM_X[0]) + 5 + j * 12,
          wz(GYM_Y[0]) + 6 + i * 14,
          GYM_H,
          0.7
        );
      }
    }

    // 동굴에 남은 작업등 (갱도에 매달린 형광등)
    [[59, 7], [63, 7], [62, 2], [63, 13], [68, 3], [68, 12], [68, 7],
     [74, 5], [77, 7], [74, 10]].forEach(function (c) {
      put(wx(c[0]), wz(c[1]), CAVE_H, 0.8);
    });

    const hm = instanced(scene, housingGeo, housingMat, housings);
    if (hm) hm.castShadow = false;

    tubeMesh = new THREE.InstancedMesh(tubeGeo, tubeMat, tubes.length);
    tubes.forEach((m, i) => tubeMesh.setMatrixAt(i, m));
    tubeMesh.instanceMatrix.needsUpdate = true;
    tubeMesh.frustumCulled = false;
    const col = new THREE.Color();
    fixtures.forEach((f, i) => {
      col.setHex(f.alive ? 0xdfe8ff : 0x1a1c1e);
      tubeMesh.setColorAt(i, col);
    });
    if (tubeMesh.instanceColor) tubeMesh.instanceColor.needsUpdate = true;
    scene.add(tubeMesh);

    // 근처 형광등에만 실제 광원을 붙이는 라이트 풀
    /*
      점광원은 픽셀마다 계산되므로 개수가 곧 프레임이다.
      넉넉히 만들어 두고 품질에 따라 쓰는 개수만 바꾼다.
    */
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xcfe0ff, 0, 19, 1.9);
      l.visible = false;
      scene.add(l);
      lightPool.push(l);
    }
    lightBudget = lightPool.length;
  }

  /* ---------------- 업데이트 ---------------- */

  function update(dt, playerPos, time) {
    sortTimer -= dt;
    if (sortTimer <= 0) {
      sortTimer = 0.3;
      sortedFixtures = fixtures
        .filter((f) => f.alive)
        .map((f) => {
          const dx = f.x - playerPos.x;
          const dz = f.z - playerPos.z;
          f.dist2 = dx * dx + dz * dz;
          return f;
        })
        .sort((a, b) => a.dist2 - b.dist2)
        .slice(0, lightBudget);
    }

    const col = new THREE.Color();
    let changed = false;

    // 깜빡임 계산 (전체 형광등)
    for (let i = 0; i < fixtures.length; i++) {
      const f = fixtures[i];
      if (!f.alive) continue;
      let lv = 1;
      if (f.flickery) {
        const n = Math.sin(time * f.rate * 6.0 + f.phase) * 0.5 + 0.5;
        const n2 = Math.sin(time * f.rate * 17.3 + f.phase * 2.1) * 0.5 + 0.5;
        lv = 0.45 + 0.55 * n * n2;
        if (n2 > 0.93) lv = 0.05;
      } else {
        lv = 0.86 + 0.14 * Math.sin(time * 3.1 + f.phase);
      }
      if (Math.abs(lv - f.level) > 0.02) {
        f.level = lv;
        col.setRGB(0.82 * lv + 0.05, 0.88 * lv + 0.05, 1.0 * lv + 0.05);
        tubeMesh.setColorAt(i, col);
        changed = true;
      }
    }
    if (changed && tubeMesh.instanceColor) tubeMesh.instanceColor.needsUpdate = true;

    for (let i = 0; i < lightPool.length; i++) {
      const l = lightPool[i];
      const f = i < lightBudget ? sortedFixtures[i] : null;
      if (!f) {
        l.visible = false;
        continue;
      }
      l.visible = true;
      l.position.set(f.x, f.y, f.z);
      l.intensity = 0.85 * f.level;
    }
  }

  /* ---------------- 그리드 레이캐스트(DDA) ---------------- */
  /* 벽/바닥/천장 중 가장 가까운 충돌 지점 반환 */
  function raycast(origin, dir, maxDist) {
    let gx = cx(origin.x);
    let gy = cz(origin.z);

    const stepX = dir.x > 0 ? 1 : -1;
    const stepY = dir.z > 0 ? 1 : -1;
    const tDeltaX = Math.abs(dir.x) < 1e-8 ? Infinity : Math.abs(TILE / dir.x);
    const tDeltaY = Math.abs(dir.z) < 1e-8 ? Infinity : Math.abs(TILE / dir.z);

    const bx = wx(gx) - TILE / 2;
    const bz = wz(gy) - TILE / 2;
    let tMaxX =
      dir.x > 0 ? (bx + TILE - origin.x) / dir.x : dir.x < 0 ? (bx - origin.x) / dir.x : Infinity;
    let tMaxY =
      dir.z > 0 ? (bz + TILE - origin.z) / dir.z : dir.z < 0 ? (bz - origin.z) / dir.z : Infinity;

    let t = 0;
    let axis = 0;
    let guard = 0;

    // 바닥 / 천장
    let planeT = Infinity;
    let planeNormal = null;
    if (dir.y < -1e-6) {
      planeT = -origin.y / dir.y;
      planeNormal = new THREE.Vector3(0, 1, 0);
    } else if (dir.y > 1e-6) {
      const h = origin.x > wx(GYM_X[0]) - TILE / 2 ? GYM_H : WALL_H;
      planeT = (h - origin.y) / dir.y;
      planeNormal = new THREE.Vector3(0, -1, 0);
    }

    while (guard++ < 400) {
      if (tMaxX < tMaxY) {
        gx += stepX;
        t = tMaxX;
        tMaxX += tDeltaX;
        axis = 0;
      } else {
        gy += stepY;
        t = tMaxY;
        tMaxY += tDeltaY;
        axis = 1;
      }
      if (t > maxDist) break;
      if (!inBounds(gx, gy) || grid[idx(gx, gy)] === 1) {
        const hy = origin.y + dir.y * t;
        const top = inBounds(gx, gy) ? wallTop[idx(gx, gy)] || WALL_H : GYM_H;
        if (hy >= 0 && hy <= top) {
          if (planeT < t) break;
          return {
            dist: t,
            point: new THREE.Vector3(
              origin.x + dir.x * t,
              hy,
              origin.z + dir.z * t
            ),
            normal:
              axis === 0
                ? new THREE.Vector3(-stepX, 0, 0)
                : new THREE.Vector3(0, 0, -stepY),
          };
        }
      }
    }

    if (planeT < maxDist && planeT > 0) {
      return {
        dist: planeT,
        point: new THREE.Vector3(
          origin.x + dir.x * planeT,
          origin.y + dir.y * planeT,
          origin.z + dir.z * planeT
        ),
        normal: planeNormal,
      };
    }
    return null;
  }

  /*
    원-벽 충돌 + 소품 충돌.

    props:
      'all'  - 책상/의자까지 전부 막힘 (플레이어)
      'tall' - 사물함·기둥처럼 넘어갈 수 없는 것만 (좀비)
      'none' - 벽만

    좀비에게 책상까지 막으면 교실에서 길이 막혀 끼기 때문에,
    좀비는 낮은 가구를 타고 넘는 것으로 취급한다.
  */
  function circleBlocked(x, z, r, props) {
    const minX = cx(x - r);
    const maxX = cx(x + r);
    const minZ = cz(z - r);
    const maxZ = cz(z + r);
    for (let gy = minZ; gy <= maxZ; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (!isSolid(gx, gy)) continue;
        const cxw = wx(gx);
        const czw = wz(gy);
        const nx = clamp(x, cxw - TILE / 2, cxw + TILE / 2);
        const nz = clamp(z, czw - TILE / 2, czw + TILE / 2);
        const dx = x - nx;
        const dz = z - nz;
        if (dx * dx + dz * dz < r * r) return true;
      }
    }

    const mode = props === undefined ? 'all' : props;
    if (mode === 'none') return false;
    const tallOnly = mode === 'tall';

    for (let gy = minZ; gy <= maxZ; gy++) {
      for (let gx = minX; gx <= maxX; gx++) {
        if (!inBounds(gx, gy)) continue;
        const bucket = colliderCells[idx(gx, gy)];
        if (!bucket) continue;
        for (let i = 0; i < bucket.length; i++) {
          const c = bucket[i];
          if (tallOnly && !c.tall) continue;
          const nx = clamp(x, c.x - c.hw, c.x + c.hw);
          const nz = clamp(z, c.z - c.hd, c.z + c.hd);
          const dx = x - nx;
          const dz = z - nz;
          if (dx * dx + dz * dz < r * r) return true;
        }
      }
    }
    return false;
  }

  /* 사람/좀비가 설 수 있는 자리인지 (아이템·좀비 스폰 검사용) */
  function isSpotFree(x, z, r) {
    return !circleBlocked(x, z, r === undefined ? 0.5 : r, 'all');
  }

  /* =========================================================
     운동장 · 동굴
     ========================================================= */
  let caveCeil = null;
  const gateMeshes = {};   // 'cave' / 'boss' -> {slab, frame, glow}
  const gateOpen = { cave: false, boss: false };

  function addCaveCeiling(scene) {
    const x0 = 57, x1 = MAP_W - 1;
    const w = (x1 - x0 + 1) * TILE;
    const d = MAP_H * TILE;
    const g = new THREE.PlaneGeometry(w, d);
    g.rotateX(Math.PI / 2);
    caveCeil = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({
        map: tiled(TEX.rock(), w / TILE, d / TILE),
        roughness: 1.0,
        color: 0x5a5450,
      })
    );
    caveCeil.position.set((wx(x0) + wx(x1)) / 2, CAVE_H, 0);
    scene.add(caveCeil);
    return caveCeil;
  }

  /* 운동장: 녹슨 골대와 조회대 */
  function buildFieldProps(scene, rng) {
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x6e6257, roughness: 0.85, metalness: 0.4 });
    const bar = new THREE.BoxGeometry(0.16, 0.16, 7.2);
    const post = new THREE.BoxGeometry(0.16, 2.6, 0.16);
    // 문 앞을 가리지 않도록 운동장 남북 끝에 세운다
    [[wx(50), wz(3)], [wx(50), wz(12)]].forEach(function (p) {
      const g1 = new THREE.Mesh(bar, poleMat);
      g1.rotation.y = Math.PI / 2;
      g1.position.set(p[0], 2.6, p[1]);
      scene.add(g1);
      [-3.6, 3.6].forEach(function (o) {
        const m = new THREE.Mesh(post, poleMat);
        m.position.set(p[0] + o, 1.3, p[1]);
        scene.add(m);
        addPropCollider(p[0] + o, p[1], 0.22, 0.22, true);
      });
    });

    // 조회대
    const stand = new THREE.Mesh(
      new THREE.BoxGeometry(4.4, 0.9, 3.0),
      new THREE.MeshStandardMaterial({ color: 0x5f5a50, roughness: 0.95 })
    );
    stand.position.set(wx(47), 0.45, wz(10));
    stand.receiveShadow = true;
    scene.add(stand);
    addPropCollider(wx(47), wz(10), 2.2, 1.5, true);
  }

  /* 동굴: 종유석·석순과 보스 아레나 기둥 */
  function buildCaveProps(scene, rng) {
    const rockMat = new THREE.MeshStandardMaterial({
      map: tiled(TEX.rock(), 1, 1), roughness: 1.0, color: 0x8b847d,
    });

    // 석순 / 종유석 (장식)
    const up = [];
    const down = [];
    for (let i = 0; i < 90; i++) {
      const gx = randInt(58, MAP_W - 2);
      const gy = randInt(1, MAP_H - 2);
      if (!isWalkable(gx, gy)) continue;
      const x = wx(gx) + rand(-1.6, 1.6);
      const z = wz(gy) + rand(-1.6, 1.6);
      if (rng() < 0.55) {
        const h = rand(0.5, 1.5);
        up.push(MAT(x, h / 2, z, 0, rand(0, 6.2), 0, 1, h / 1.0, 1));
      } else {
        const h = rand(0.7, 2.0);
        down.push(MAT(x, CAVE_H - h / 2, z, Math.PI, rand(0, 6.2), 0, 1, h / 1.0, 1));
      }
    }
    const coneGeo = new THREE.ConeGeometry(0.42, 1.0, 5);
    instanced(scene, coneGeo, rockMat, up);
    instanced(scene, coneGeo.clone(), rockMat, down);

    // 보스 아레나 기둥 (엄폐물)
    const pillarGeo = new THREE.CylinderGeometry(1.15, 1.45, CAVE_H, 7);
    [[74, 5], [74, 10], [76, 7], [77, 11], [73, 8]].forEach(function (c) {
      const m = new THREE.Mesh(pillarGeo, rockMat);
      m.position.set(wx(c[0]), CAVE_H / 2, wz(c[1]));
      m.castShadow = true;
      scene.add(m);
      addPropCollider(wx(c[0]), wz(c[1]), 1.2, 1.2, true);
    });

    // 바이러스 배양조 (초록 발광)
    const vatGlass = new THREE.MeshStandardMaterial({
      color: 0x3ff08a, emissive: 0x2ad06f, emissiveIntensity: 0.9,
      transparent: true, opacity: 0.55, roughness: 0.3,
    });
    const vatGeo = new THREE.CylinderGeometry(0.62, 0.62, 2.1, 10);
    [[73, 4], [75, 12], [78, 6], [63, 6], [69, 12]].forEach(function (c) {
      const m = new THREE.Mesh(vatGeo, vatGlass);
      m.position.set(wx(c[0]), 1.05, wz(c[1]));
      scene.add(m);
      addPropCollider(wx(c[0]), wz(c[1]), 0.7, 0.7, true);
    });
    /*
      배양조마다 점광원을 달면 저사양에서 픽셀당 조명 계산이 확 늘어난다.
      발광 재질만으로도 충분히 초록빛이 돈다.
    */
  }

  /* ---- 잠긴 문 ---- */
  function gateCenter(d) {
    return {
      x: wx(d[0]),
      z: (wz(d[1]) + wz(d[3])) / 2,
      w: (d[2] - d[0] + 1) * TILE,
      dep: (d[3] - d[1] + 1) * TILE,
    };
  }

  function buildGates(scene) {
    [['cave', CAVE_DOOR], ['boss', BOSS_DOOR]].forEach(function (pair) {
      const key = pair[0];
      const c = gateCenter(pair[1]);

      // 닫혀 있을 때 보이는 암반 슬래브
      const slab = new THREE.Mesh(
        new THREE.BoxGeometry(TILE * 0.98, CAVE_H, c.dep * 0.98),
        new THREE.MeshStandardMaterial({
          map: tiled(TEX.rock(), 1, 1), roughness: 1.0, color: 0x7d766f,
        })
      );
      slab.position.set(c.x, CAVE_H / 2, c.z);
      scene.add(slab);

      // 열렸을 때 보이는 철문 틀 + 초록 불빛
      const frame = new THREE.Group();
      const fmat = new THREE.MeshStandardMaterial({ color: 0x4a4038, roughness: 0.7, metalness: 0.55 });
      const side = new THREE.BoxGeometry(0.5, 4.4, 0.5);
      [-c.dep / 2 + 0.4, c.dep / 2 - 0.4].forEach(function (o) {
        const m = new THREE.Mesh(side, fmat);
        m.position.set(c.x, 2.2, c.z + o);
        frame.add(m);
      });
      const lint = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, c.dep), fmat);
      lint.position.set(c.x, 4.5, c.z);
      frame.add(lint);
      const glow = new THREE.PointLight(0x45ff98, 3.2, 34, 2);
      glow.position.set(c.x, 2.6, c.z);
      frame.add(glow);

      /*
        어두운 운동장 저편에서도 보이도록 문틀 안에 빛나는 막을 세운다.
        (여기가 들어가는 곳이라는 걸 한눈에 알아야 한다)
      */
      const veilGeo = new THREE.PlaneGeometry(c.dep - 0.9, 4.0);
      veilGeo.rotateY(Math.PI / 2);
      const veil = new THREE.Mesh(
        veilGeo,
        new THREE.MeshBasicMaterial({
          color: 0x4bffa0,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
          toneMapped: false,
        })
      );
      veil.position.set(c.x, 2.0, c.z);
      frame.add(veil);

      frame.visible = false;
      scene.add(frame);

      gateMeshes[key] = { slab: slab, frame: frame, door: pair[1] };
    });
  }

  function setGateOpen(d, open) {
    const key = d === CAVE_DOOR ? 'cave' : 'boss';
    gateOpen[key] = !!open;
    for (let y = d[1]; y <= d[3]; y++) {
      for (let x = d[0]; x <= d[2]; x++) {
        grid[idx(x, y)] = open ? 0 : 1;
        navBlocked[idx(x, y)] = open ? 0 : 1;
      }
    }
    const g = gateMeshes[key];
    if (g) {
      g.slab.visible = !open;
      g.frame.visible = !!open;
    }
  }

  /* 두 점 사이 시야 확보 여부 */
  function hasLineOfSight(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 0.001) return true;
    const dir = new THREE.Vector3(dx / len, dy / len, dz / len);
    const hit = raycast(a, dir, len);
    return !hit || hit.dist >= len - 0.05;
  }

  /* ---------------- 빌드 ---------------- */
  function build(scene, quality) {
    root = scene;
    rooms.length = 0;
    fixtures.length = 0;
    navCells.length = 0;
    lockerSpots.length = 0;
    doors.length = 0;
    lightPool = [];
    const rng = mulberry32(20090212);
    srng = rng; // 이 시점부터 모듈 내 rand/randInt 도 시드를 따른다

    buildGrid();

    // 바닥 (출입문 칸까지 빈틈 없도록 전체 베이스를 먼저 깔고 구역별로 덮는다)
    addFloor(scene, 0, 0, MAP_W - 1, MAP_H - 1, TEX.corridorFloor(), -0.02);
    addFloor(scene, 1, COR_Y[0], 32, COR_Y[1], TEX.corridorFloor(), 0);
    rooms.forEach((r) => {
      if (r.type === 'class') addFloor(scene, r.x0, r.y0, r.x1, r.y1, TEX.classFloor(), 0);
    });
    addFloor(scene, GYM_X[0], GYM_Y[0], GYM_X[1], GYM_Y[1], TEX.gymFloor(), 0);

    // 천장
    addCeiling(scene, 0, 0, 32, MAP_H - 1, WALL_H);
    addCeiling(scene, GYM_X[0], GYM_Y[0], GYM_X[1], GYM_Y[1], GYM_H);

    // 운동장 흙바닥 / 동굴 암반 바닥
    addFloor(scene, 43, 0, 56, MAP_H - 1, TEX.dirt(), 0);
    addFloor(scene, 57, 0, MAP_W - 1, MAP_H - 1, TEX.rock(), 0);
    addCaveCeiling(scene);

    buildWalls(scene);
    buildProps(scene, rng);
    buildLights(scene, rng, quality);
    buildDoors(scene);
    buildFieldProps(scene, rng);
    buildCaveProps(scene, rng);
    buildGates(scene);

    // 두 문은 잠긴 채로 시작한다
    setGateOpen(CAVE_DOOR, false);
    setGateOpen(BOSS_DOOR, false);

    // 소품이 다 놓인 뒤에 계산해야 한다
    navBlocked.fill(0);
    for (const c of navCells) {
      if (circleBlocked(wx(c[0]), wz(c[1]), 0.45, 'tall')) navBlocked[idx(c[0], c[1])] = 1;
    }
  }

  /* maxDist 를 주면 그 반경 안에서만 고른다 (안 주면 맵 전체) */
  function randomSpawnCell(playerPos, minDist, flowDist, maxDist) {
    const cands = [];
    for (let i = 0; i < navCells.length; i++) {
      const c = navCells[i];
      const x = wx(c[0]);
      const z = wz(c[1]);
      const d = Math.hypot(x - playerPos.x, z - playerPos.z);
      if (d < minDist) continue;
      if (maxDist && d > maxDist) continue;
      if (flowDist && flowDist[idx(c[0], c[1])] < 0) continue;
      cands.push(c);
    }
    if (!cands.length) return null;

    /*
      칸 중심이 책상 위일 수 있으므로, 칸 안에서 실제로 설 수 있는 지점을 찾는다.
      몇 번 시도해서 실패하면 그 칸은 포기하고 다른 칸을 고른다.
    */
    for (let attempt = 0; attempt < 24; attempt++) {
      const c = cands[(Math.random() * cands.length) | 0];
      for (let k = 0; k < 6; k++) {
        const px = wx(c[0]) + (k === 0 ? 0 : (Math.random() * 2 - 1) * (TILE / 2 - 0.7));
        const pz = wz(c[1]) + (k === 0 ? 0 : (Math.random() * 2 - 1) * (TILE / 2 - 0.7));
        if (isSpotFree(px, pz, 0.55)) return { cell: c, x: px, z: pz };
      }
    }
    const fallback = cands[(Math.random() * cands.length) | 0];
    return { cell: fallback, x: wx(fallback[0]), z: wz(fallback[1]) };
  }

  return {
    TILE,
    WALL_H,
    GYM_H,
    MAP_W,
    MAP_H,
    grid,
    zone,
    rooms,
    navCells,
    lockerSpots,
    navBlocked,
    idx,
    isSolid,
    isWalkable,
    wx,
    wz,
    cx,
    cz,
    build,
    update,
    raycast,
    circleBlocked,
    isSpotFree,
    openRoomDoors,
    updateDoors,
    closeAllDoors,
    caveRooms,
    CAVE_H,
    gateOpen,
    openCaveGate: function () { setGateOpen(CAVE_DOOR, true); },
    openBossGate: function () { setGateOpen(BOSS_DOOR, true); },
    lockGates: function () {
      setGateOpen(CAVE_DOOR, false);
      setGateOpen(BOSS_DOOR, false);
    },
    get caveDoorPos() {
      const c = gateCenter(CAVE_DOOR);
      return new THREE.Vector3(c.x, 0, c.z);
    },
    get caveSpawn() {
      return new THREE.Vector3(wx(59), 0, wz(7) + TILE / 2);
    },
    get bossSpawn() {
      return new THREE.Vector3(wx(77), 0, wz(7) + TILE / 2);
    },
    get bossArenaCenter() {
      return new THREE.Vector3(wx(75), 0, wz(7) + TILE / 2);
    },
    setLightBudget: function (n) {
      lightBudget = clamp(n, 0, lightPool.length);
    },
    hasLineOfSight,
    randomSpawnCell,
    get spawnPoint() {
      return new THREE.Vector3(wx(2), 0, wz(7) + TILE / 2);
    },
  };
})();
