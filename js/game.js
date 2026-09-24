/* =========================================================
   game.js - 메인 게임 루프
   ========================================================= */

window.GAME_BUILD = 30; // 로드된 번들 확인용

(function () {
  'use strict';

  /* ---------------- DOM ---------------- */
  const $ = (s) => document.querySelector(s);
  const canvas = $('#game');
  const hudEl = $('#hud');
  const screens = {
    start: $('#start'),
    pause: $('#pause'),
    gameover: $('#gameover'),
  };
  const el = {
    wave: $('#wave'),
    remaining: $('#remaining').querySelector('b'),
    kills: $('#killcount'),
    hpFill: $('#hp-fill'),
    hpText: $('#hp-text'),
    stamFill: $('#stam-fill'),
    ammo: $('#ammo'),
    wname: $('#wname'),
    slots: $('#slots'),
    reloadInd: $('#reload-ind'),
    reloadBar: $('#reload-bar'),
    reloadBarFill: $('#reload-bar span'),
    announce: $('#announce'),
    announceBig: $('#announce .big'),
    announceSub: $('#announce .sub'),
    toasts: $('#toasts'),
    hitmarker: $('#hitmarker'),
    damage: $('#damage-flash'),
    lowhp: $('#lowhp'),
    ch: {
      t: $('#ch-t'), b: $('#ch-b'), l: $('#ch-l'), r: $('#ch-r'),
    },
    points: $('#points').querySelector('b'),
    sbCount: $('#sb-count'),
    sbRows: $('#sb-rows'),
    shieldWrap: $('#shield-wrap'),
    shieldFill: $('#shield-fill'),
    shieldText: $('#shield-text'),
    squad: $('#squad'),
    shop: $('#shop'),
    shopPoints: $('#shop-points'),
    shopSummon: $('#shop-summon'),
    shopUpgrade: $('#shop-upgrade'),
    shopMsg: $('#shop-msg'),
  };

  /* ---------------- 설정 ---------------- */
  const settings = {
    difficulty: 'normal',
    players: 20,
    quality: 'medium',
    sensitivity: 1.0,
    volume: 0.7,
  };

  const DIFF = {
    easy: { hp: 0.78, speed: 0.9, dmg: 0.6, count: 0.75, label: '신입생' },
    normal: { hp: 1, speed: 1, dmg: 1, count: 1, label: '재학생' },
    hard: { hp: 1.35, speed: 1.12, dmg: 1.45, count: 1.3, label: '졸업생' },
  };

  /* ---------------- 코어 ---------------- */
  let renderer, scene, camera;
  let viewScene, viewCamera, viewKey, viewFlash;
  let flashlight, muzzleLight;
  let clock;
  let state = 'menu'; // menu | playing | paused | dead
  let built = false;

  const tmpV1 = new THREE.Vector3();
  const tmpV2 = new THREE.Vector3();
  const tmpV3 = new THREE.Vector3();

  /* ---------------- 플레이어 ---------------- */
  const player = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    hp: 100,
    maxHp: 100,
    stamina: 100,
    maxStamina: 100,
    height: 1.72,
    curHeight: 1.72,
    crouching: false,
    onGround: true,
    radius: 0.4,
    bobT: 0,
    bobAmt: 0,
    stepDist: 0,
    invuln: 0,
    shield: 0,      // 마법 힐팩이 주는 보조 체력
    shieldHits: 0,  // 5번 맞을 때마다 보조 체력 1 감소
    shakeT: 0,
    shakeAmt: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    flashlightOn: true,
  };

  /*
  #6 대응: 질주 7.4 는 가장 빠른 좀비보다 확실히 빨라서
  넓은 곳에서 원만 그려도 안 잡혔다. 속도를 낮추고 스태미나를 빡빡하게 해
  '치고 빠지기'는 되지만 '계속 도망'은 안 되게 만든다.
*/
const PLAYER_MAX_SHIELD = 20; // 마법 힐팩이 주는 보조 체력 최대치
const SPEED = { walk: 4.6, sprint: 6.6, crouch: 2.3, air: 0.35 };

  /* ---------------- 입력 ---------------- */
  const keys = Object.create(null);
  let mouseDown = false;
  let pointerLocked = false;
  let mouseSwayX = 0;
  let mouseSwayY = 0;
  let tapFireRelease = false;

  /*
    조준 방식. 기본은 포인터 잠금이지만 iframe 등 잠금이 막힌 환경에서는
    화면 중앙 기준 커서 위치로 선회하는 방식으로 자동 전환한다.
  */
  let aimMode = 'lock'; // 'lock' | 'cursor'
  const cursorAim = { x: 0, y: 0, active: false };

  /* ---------------- 무기 ---------------- */
  let weapons = [];
  let curWeapon = 0;
  let fireCooldown = 0;
  let reloadTimer = 0;
  let reloading = false;
  let spreadHeat = 0;
  let viewModel = null;
  let viewModelId = null;
  let viewRoot = null;
  let vmRecoil = 0;
  let vmSwitch = 0;
  let muzzleMesh = null;
  let muzzleTimer = 0;


  /* ---------------- 좀비 / 웨이브 ---------------- */
  let zombies = [];
  let flowField = null;
  let flowTimer = 0;
  let clearedRooms = 0;


  /* ---------------- 아이템 ---------------- */
  let pickups = [];

  /* ---------------- 방 단위 좀비 / 사물함 ---------------- */
  let roomStates = [];     // 각 방: {room, count, triggered, cleared}
  let lockers = [];        // {x,z,ry, searched, loot}
  let nearLocker = null;
  let victory = false;

  /* ---------------- 매치(봇) ---------------- */
  /*
    정적 호스팅이라 실제 네트워크 대전은 불가능하다.
    명단은 10~100명을 채우되, 3D 로 실제 움직이는 봇은 성능 때문에
    MAX_LIVE_BOTS 명까지만 만들고 나머지는 점수판에만 존재한다.
  */
  const MAX_LIVE_BOTS = 8;
  let bots = [];
  let roster = [];
  let rosterTimer = 0;

  /* ---------------- 부하 ---------------- */
  let allies = [];
  let killPoints = 0;
  let shopOpen = false;

  /* ---------------- 통계 ---------------- */
  const stats = { kills: 0, headshots: 0, shots: 0, hits: 0, time: 0 };

  /* =========================================================
     초기화
     ========================================================= */
  function initRenderer() {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.82;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x04060a);
    scene.fog = new THREE.FogExp2(0x070a0e, 0.024);

    camera = new THREE.PerspectiveCamera(76, window.innerWidth / window.innerHeight, 0.04, 320);
    camera.rotation.order = 'YXZ';
    scene.add(camera);

    TEX.setRenderer(renderer);

    // 기본 환경광 — 폐교는 어두워야 하므로 최소한만
    scene.add(new THREE.AmbientLight(0x0c1420, 0.28));
    const hemi = new THREE.HemisphereLight(0x1b2836, 0x070806, 0.16);
    scene.add(hemi);
    const moon = new THREE.DirectionalLight(0x4a668f, 0.1);
    moon.position.set(-40, 60, -30);
    scene.add(moon);

    // 손전등
    flashlight = new THREE.SpotLight(0xfff0d2, 2.0, 62, 0.44, 0.48, 1.0);
    /*
      광원을 카메라 원점에 두면 원뿔 가장자리(약 27도)에 뷰모델이 걸려
      총이 새하얗게 타버린다. 총(z=-0.52~-0.58)보다 앞에 두어 아예 제외한다.
      타겟도 같이 멀리 보내야 광축이 정면을 향한다.
    */
    flashlight.position.set(0.12, -0.05, -0.8);
    flashlight.target.position.set(0, 0, -24);
    camera.add(flashlight);
    camera.add(flashlight.target);
    flashlight.shadow.mapSize.set(1024, 1024);
    flashlight.shadow.camera.near = 0.4;
    flashlight.shadow.camera.far = 55;
    flashlight.shadow.bias = -0.0022;
    flashlight.shadow.normalBias = 0.03;
    flashlight.castShadow = false;

    // 머즐 플래시 광원 (월드를 비춘다)
    muzzleLight = new THREE.PointLight(0xffd08a, 0, 16, 1.6);
    muzzleLight.position.set(0.2, -0.1, -0.7);
    camera.add(muzzleLight);

    /*
      뷰모델 전용 씬.
      총을 메인 씬에 두면 복도 형광등 같은 월드 광원이 코앞의 총을 덮쳐
      실루엣이 하얗게 날아가고, 벽에 붙으면 총이 벽을 뚫고 나간다.
      별도 씬 + 별도 카메라로 겹쳐 그리면 둘 다 사라진다. (FPS의 표준 방식)
    */
    viewScene = new THREE.Scene();
    viewCamera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 6);

    viewRoot = new THREE.Group();
    viewScene.add(viewRoot);

    // 총에만 닿는 조명 — 키라이트 + 아주 약한 앰비언트
    viewScene.add(new THREE.AmbientLight(0x30363d, 0.55));
    viewKey = new THREE.DirectionalLight(0xffe9c8, 0.85);
    viewKey.position.set(0.6, 0.9, 0.4);
    viewScene.add(viewKey);
    const viewRim = new THREE.DirectionalLight(0x6d86a8, 0.35);
    viewRim.position.set(-0.7, 0.2, -0.6);
    viewScene.add(viewRim);

    // 발사 순간 총을 번쩍이게 하는 전용 광원 (월드용 muzzleLight 와 별개)
    viewFlash = new THREE.PointLight(0xffd08a, 0, 1.6, 1.4);
    viewFlash.position.set(0.2, -0.1, -0.75);
    viewScene.add(viewFlash);

    let resizeQueued = false;
    const queueResize = function () {
      if (resizeQueued) return;
      resizeQueued = true;
      setTimeout(function () {
        resizeQueued = false;
        onResize();
      }, 120);
    };
    window.addEventListener('resize', queueResize);
    window.addEventListener('orientationchange', queueResize);
  }

  let lastW = 0;
  let lastH = 0;
  function onResize() {
    if (!renderer) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    /*
      주소창이 접히는 정도(수십 px)로는 다시 그리지 않는다.
      매번 setSize 를 부르면 프레임이 튀고 화면이 출렁인다.
    */
    if (Math.abs(w - lastW) < 2 && Math.abs(h - lastH) < 64) return;
    lastW = w;
    lastH = h;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (viewCamera) {
      viewCamera.aspect = camera.aspect;
      viewCamera.updateProjectionMatrix();
    }
    renderer.setSize(w, h);
  }

  function applyQuality() {
    const q = settings.quality;
    /*
      휴대폰은 화면 밀도가 3배씩 되는 경우가 많아 그대로 그리면
      픽셀 수가 9배가 되어 프레임이 무너진다. 1배로 제한한다.
    */
    const cap = TOUCH.enabled ? 1.5 : q === 'low' ? 1 : q === 'high' ? 2 : 1.5;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap));
    flashlight.castShadow = q === 'high' && !TOUCH.enabled;
    flashlight.shadow.mapSize.set(q === 'high' ? 1024 : 512, q === 'high' ? 1024 : 512);
    scene.fog.density = q === 'low' ? 0.03 : 0.024;
    onResize();
  }

  /* =========================================================
     파티클 / 데칼 / 머즐
     ========================================================= */
  /*
    파티클.
    한 덩어리에 vertexColors 로 색을 섞어 쓰면 이 환경에서 색이 적용되지 않아
    피가 흰색으로 튄다. 색이 다른 것끼리 시스템을 나누고
    각 시스템은 머티리얼 색 하나만 쓰도록 한다.
  */
  /* 부드러운 원형 점 텍스처 (파티클용) */
  let dotTex = null;
  function dotTexture() {
    if (dotTex) return dotTex;
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.45, 'rgba(255,255,255,.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 32, 32);
    dotTex = new THREE.CanvasTexture(c);
    dotTex.encoding = THREE.sRGBEncoding;
    return dotTex;
  }

  function makeParticleSystem(max, baseColor, size, blending) {
    const sys = { max, cursor: 0, list: [] };
    const pos = new Float32Array(max * 3);
    const alpha = new Float32Array(max);
    for (let i = 0; i < max; i++) {
      pos[i * 3 + 1] = -1000;
      sys.list.push({ life: 0, maxLife: 1, vel: new THREE.Vector3(), g: 14 });
    }
    sys.geo = new THREE.BufferGeometry();
    sys.posAttr = new THREE.BufferAttribute(pos, 3);
    sys.geo.setAttribute('position', sys.posAttr);
    sys.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5000);

    sys.mesh = new THREE.Points(
      sys.geo,
      new THREE.PointsMaterial({
        color: baseColor,
        size: size,
        sizeAttenuation: true,
        map: dotTexture(),
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        blending: blending || THREE.NormalBlending,
      })
    );
    sys.mesh.frustumCulled = false;
    scene.add(sys.mesh);
    return sys;
  }

  const particleSystems = {};

  function initParticles() {
    particleSystems.blood = makeParticleSystem(420, 0x8e0d0d, 0.085);
    particleSystems.debris = makeParticleSystem(280, 0x9a958a, 0.07);
  }

  function emitInto(sys, x, y, z, count, opts) {
    for (let i = 0; i < count; i++) {
      const idx = sys.cursor;
      sys.cursor = (sys.cursor + 1) % sys.max;
      const p = sys.list[idx];
      p.life = p.maxLife = rand(opts.life[0], opts.life[1]);
      p.g = opts.gravity;
      const sp = rand(opts.speed[0], opts.speed[1]);
      let vx = rand(-1, 1);
      let vy = rand(-1, 1);
      let vz = rand(-1, 1);
      const l = Math.hypot(vx, vy, vz) || 1;
      vx /= l; vy /= l; vz /= l;
      if (opts.dir) {
        const spread = opts.spread === undefined ? 0.6 : opts.spread;
        vx = opts.dir.x + vx * spread;
        vy = opts.dir.y + vy * spread;
        vz = opts.dir.z + vz * spread;
        const l2 = Math.hypot(vx, vy, vz) || 1;
        vx /= l2; vy /= l2; vz /= l2;
      }
      p.vel.set(vx * sp, vy * sp, vz * sp);
      sys.posAttr.setXYZ(idx, x, y, z);
    }
    sys.posAttr.needsUpdate = true;
  }

  function updateSystem(sys, dt) {
    const pa = sys.posAttr;
    let dirty = false;
    for (let i = 0; i < sys.max; i++) {
      const p = sys.list[i];
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        pa.setXYZ(i, 0, -1000, 0);
        dirty = true;
        continue;
      }
      p.vel.y -= p.g * dt;
      let x = pa.getX(i) + p.vel.x * dt;
      let y = pa.getY(i) + p.vel.y * dt;
      let z = pa.getZ(i) + p.vel.z * dt;
      if (y < 0.02) {
        y = 0.02;
        p.vel.set(p.vel.x * 0.3, 0, p.vel.z * 0.3);
        p.life = Math.min(p.life, 0.25);
      }
      pa.setXYZ(i, x, y, z);
      dirty = true;
    }
    if (dirty) pa.needsUpdate = true;
  }

  function updateParticles(dt) {
    updateSystem(particleSystems.blood, dt);
    updateSystem(particleSystems.debris, dt);
  }

  function clearParticles() {
    [particleSystems.blood, particleSystems.debris].forEach((sys) => {
      for (let i = 0; i < sys.max; i++) {
        sys.list[i].life = 0;
        sys.posAttr.setXYZ(i, 0, -1000, 0);
      }
      sys.posAttr.needsUpdate = true;
    });
  }

  function bloodBurst(point, dir, amount) {
    emitInto(particleSystems.blood, point.x, point.y, point.z, amount, {
      life: [0.5, 1.1],
      gravity: 16,
      speed: [1.5, 6],
      dir: dir,
      spread: 0.75,
    });
  }

  function dustBurst(point, normal) {
    emitInto(particleSystems.debris, point.x, point.y, point.z, 7, {
      life: [0.25, 0.55],
      gravity: 5,
      speed: [1, 3.5],
      dir: normal,
      spread: 0.7,
    });
  }

  /* ---------- 탄흔 데칼 ---------- */
  const decals = { pool: [], cursor: 0, max: 56 };
  function initDecals() {
    const geo = new THREE.PlaneGeometry(0.17, 0.17);
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.bulletHole(),
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    for (let i = 0; i < decals.max; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.renderOrder = 2;
      scene.add(m);
      decals.pool.push(m);
    }
  }
  function addDecal(point, normal) {
    const m = decals.pool[decals.cursor];
    decals.cursor = (decals.cursor + 1) % decals.max;
    m.visible = true;
    m.position.copy(point).addScaledVector(normal, 0.012);
    m.lookAt(tmpV1.copy(point).add(normal));
    m.rotation.z = rand(0, Math.PI * 2);
    const s = rand(0.75, 1.3);
    m.scale.set(s, s, s);
  }

  /* ---------- 머즐 플래시 ---------- */
  function initMuzzle() {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,250,220,1)');
    g.addColorStop(0.25, 'rgba(255,196,90,.9)');
    g.addColorStop(0.6, 'rgba(255,120,30,.35)');
    g.addColorStop(1, 'rgba(255,80,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
    // 별 모양 스파이크
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(255,230,160,.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      ctx.beginPath();
      ctx.moveTo(32 - Math.cos(a) * 30, 32 - Math.sin(a) * 30);
      ctx.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30);
      ctx.stroke();
    }
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;

    muzzleMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: t,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        toneMapped: false,
      })
    );
    muzzleMesh.visible = false;
    muzzleMesh.renderOrder = 10;
    viewRoot.add(muzzleMesh);
  }

  /* =========================================================
     무기
     ========================================================= */
  function setupWeapons() {
    // 웨이브 해금이 없어졌으므로 무기는 처음부터 전부 쓸 수 있다
    weapons = WEAPON_DEFS.map((d) => new WeaponState(d, true));
    curWeapon = 0;
    equip(0, true);
    renderSlots();
  }

  function equip(i, instant) {
    if (i < 0 || i >= weapons.length) return;
    if (!weapons[i].unlocked) return;
    // 이미 "그 무기의 뷰모델이 실제로 들려 있을 때"만 건너뛴다.
    // curWeapon 만 비교하면 재시작 직후 모델과 실제 무기가 어긋난다.
    if (viewModel && viewModelId === weapons[i].def.id && i === curWeapon) return;
    curWeapon = i;
    reloading = false;
    reloadTimer = 0;
    spreadHeat = 0;
    // 재장전 중에 교체하면 표시가 남으므로 여기서 반드시 끈다
    el.reloadInd.classList.remove('on');
    el.reloadBar.classList.remove('on');
    vmSwitch = instant ? 0 : 0.28;
    if (viewModel) viewRoot.remove(viewModel);
    viewModelId = weapons[i].def.id;
    viewModel = WeaponModels.build(viewModelId);
    viewRoot.add(viewModel);
    renderSlots();
    updateAmmoHud();
  }

  function renderSlots() {
    el.slots.innerHTML = '';
    weapons.forEach((w, i) => {
      const d = document.createElement('div');
      d.className =
        'slot' + (i === curWeapon ? ' active' : '') + (w.unlocked ? '' : ' locked');
      d.innerHTML = '<i>' + (i + 1) + '</i>' + (w.unlocked ? w.def.name : '???');
      el.slots.appendChild(d);
    });
  }

  function tryFire(dt) {
    const w = weapons[curWeapon];
    const def = w.def;
    if (reloading || state !== 'playing') return;
    if (fireCooldown > 0) return;
    if (!mouseDown) return;
    if (!def.auto && mouseHeldSince > 0) return;

    if (w.ammo <= 0) {
      SFX.dryFire();
      fireCooldown = 0.35;
      mouseHeldSince = 1;
      startReload();
      return;
    }

    fire();
  }

  function fire() {
    const w = weapons[curWeapon];
    const def = w.def;
    w.ammo--;
    stats.shots++;
    fireCooldown = def.fireDelay;
    mouseHeldSince = 1;

    SFX.shot(def.sound);

    // 반동
    player.recoilPitch += def.recoil.pitch * (player.crouching ? 0.7 : 1);
    player.recoilYaw += rand(-1, 1) * def.recoil.yaw;
    vmRecoil = Math.min(1.4, vmRecoil + def.kick * 8);
    addShake(def.kick * 0.9, 0.12);

    // 머즐
    muzzleTimer = 0.05;
    muzzleMesh.visible = true;
    const mz = def.muzzle;
    muzzleMesh.position.set(def.view.x + mz.x, def.view.y + mz.y, def.view.z + mz.z);
    const fs = def.flashSize * rand(0.85, 1.25);
    muzzleMesh.scale.set(fs, fs, fs);
    muzzleMesh.rotation.z = rand(0, Math.PI * 2);
    muzzleLight.intensity = 5.5;
    viewFlash.intensity = 3.2;

    // 탄피 연기.
    // 뷰모델은 이제 별도 씬(= 카메라 로컬 좌표)에 있으므로
    // 파티클을 월드에 뿌리려면 카메라 행렬로 직접 변환해야 한다.
    const worldMuzzle = muzzleMesh.position.clone().applyMatrix4(camera.matrixWorld);
    emitInto(particleSystems.debris, worldMuzzle.x, worldMuzzle.y, worldMuzzle.z, 3, {
      life: [0.18, 0.4],
      gravity: -1.2,
      speed: [0.4, 1.4],
      dir: camera.getWorldDirection(tmpV3).clone(),
      spread: 0.7,
    });

    // 탄착
    const baseDir = camera.getWorldDirection(new THREE.Vector3());
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const spread = currentSpread(def);

    let anyHit = false;
    let anyKill = false;
    resetShotFeedback();
    for (let p = 0; p < def.pellets; p++) {
      const dir = baseDir.clone();
      if (spread > 0) {
        dir.x += rand(-1, 1) * spread;
        dir.y += rand(-1, 1) * spread;
        dir.z += rand(-1, 1) * spread;
        dir.normalize();
      }
      const res = hitscan(origin, dir, def);
      if (res && res.zombie) {
        anyHit = true;
        if (res.head) shotFeedback.headHits++;
        else shotFeedback.bodyHits++;
        if (res.killed) anyKill = true;
      }
    }
    playShotFeedback();
    if (anyHit) {
      stats.hits++;
      showHitmarker(anyKill);
    }

    // 무기별 증가값을 실제로 반영한다 (예전엔 무조건 0.25라 4발이면 최대 퍼짐)
    if (def.spreadGain > 0 && def.spreadMax > def.spread) {
      spreadHeat = Math.min(1, spreadHeat + def.spreadGain / (def.spreadMax - def.spread));
    }
    if (w.ammo <= 0) {
      setTimeout(() => {
        if (state === 'playing' && weapons[curWeapon] === w && w.ammo <= 0) startReload();
      }, 180);
    }
    updateAmmoHud();
  }

  function currentSpread(def) {
    // 걷기(4.6m/s -> 제곱 21)는 페널티 없음. 질주(7.4 -> 제곱 55)부터 벌린다.
    const sq = player.vel.x * player.vel.x + player.vel.z * player.vel.z;
    const moveFactor = sq > 30 ? 1.8 : sq > 4 ? 1.15 : 1;
    const crouchFactor = player.crouching ? 0.6 : 1;
    return (def.spread + (def.spreadMax - def.spread) * spreadHeat) * moveFactor * crouchFactor;
  }

  function hitscan(origin, dir, def) {
    const wall = SCHOOL.raycast(origin, dir, def.range);
    let maxT = wall ? wall.dist : def.range;

    let best = null;
    let bestT = maxT;
    let bestHead = false;

    for (let i = 0; i < zombies.length; i++) {
      const z = zombies[i];
      if (z.dead) continue;
      const th = raySphere(origin, dir, z.headCenter(tmpV1), z.headRadius);
      if (th >= 0 && th < bestT) {
        best = z; bestT = th; bestHead = true;
      }
      const tb = rayCapsuleY(origin, dir, z.bodyBase(tmpV2), z.bodyHeight, z.bodyRadius);
      if (tb >= 0 && tb < bestT) {
        best = z; bestT = tb; bestHead = false;
      }
    }

    if (best) {
      const point = new THREE.Vector3()
        .copy(origin)
        .addScaledVector(dir, bestT);
      const dmg = def.damage * (bestHead ? def.headMult : 1);
      const killed = best.hurt(dmg, bestHead);
      bloodBurst(point, dir, bestHead ? 16 : 9);
      if (bestHead && killed) stats.headshots++;
      if (killed) onZombieKilled(best, bestHead, point);
      return { zombie: best, killed, head: bestHead };
    }

    if (wall) {
      addDecal(wall.point, wall.normal);
      dustBurst(wall.point, wall.normal);
      shotFeedback.wallDist = Math.min(shotFeedback.wallDist, wall.dist);
      shotFeedback.wallHits++;
    }
    return null;
  }

  /*
    산탄총은 한 발에 펠릿이 9개라 펠릿마다 소리를 내면
    같은 효과음이 9~18개 겹쳐 찢어진다. 발사 단위로 한 번만 재생한다.
  */
  const shotFeedback = { wallHits: 0, wallDist: Infinity, bodyHits: 0, headHits: 0 };
  function resetShotFeedback() {
    shotFeedback.wallHits = 0;
    shotFeedback.wallDist = Infinity;
    shotFeedback.bodyHits = 0;
    shotFeedback.headHits = 0;
  }
  function playShotFeedback() {
    if (shotFeedback.headHits) SFX.headshot();
    if (shotFeedback.bodyHits || shotFeedback.headHits) {
      SFX.flesh(clamp(0.55 + (shotFeedback.bodyHits + shotFeedback.headHits) * 0.12, 0.55, 1.1));
    }
    if (shotFeedback.wallHits && shotFeedback.wallDist < Infinity) {
      SFX.impact(clamp(1 - shotFeedback.wallDist / 40, 0.15, 1));
    }
  }

  function startReload() {
    const w = weapons[curWeapon];
    if (reloading) return;
    if (w.ammo >= w.def.magSize) return;
    if (w.reserve !== Infinity && w.reserve <= 0) return;
    reloading = true;
    reloadTimer = w.def.reload;
    SFX.reload(w.def.reload);
    el.reloadInd.classList.add('on');
    el.reloadBar.classList.add('on');
  }

  function finishReload() {
    const w = weapons[curWeapon];
    const need = w.def.magSize - w.ammo;
    if (w.reserve === Infinity) {
      w.ammo = w.def.magSize;
    } else {
      const take = Math.min(need, w.reserve);
      w.ammo += take;
      w.reserve -= take;
    }
    reloading = false;
    spreadHeat = 0;
    el.reloadInd.classList.remove('on');
    el.reloadBar.classList.remove('on');
    updateAmmoHud();
  }

  /* =========================================================
     아이템
     ========================================================= */
  /*
    아이템은 웨이브마다 생성/제거되므로 지오메트리·머티리얼을 매번 새로 만들면
    치울 때마다 GPU 자원이 쌓인다. 종류별로 한 벌만 만들어 공유한다.
  */
  const pickupAssets = {};
  function getPickupAssets(type) {
    if (pickupAssets[type]) return pickupAssets[type];
    // 색깔별 그룹 + 각자 머티리얼 (vertexColors 는 이 환경에서 적용되지 않는다)
    const groups = groupPartsByColor(buildPickupParts(type)).map((g) => ({
      geo: g.geo,
      mat: new THREE.MeshStandardMaterial({
        color: g.color,
        roughness: 0.7,
        metalness: 0.15,
        emissive: type === 'magic' ? 0x4a3a00 : type === 'health' ? 0x300804 : 0x1d2208,
      }),
    }));
    pickupAssets[type] = {
      groups,
      beamGeo: new THREE.CylinderGeometry(0.22, 0.22, 3.4, 8, 1, true),
      beamMat: new THREE.MeshBasicMaterial({
        color: type === 'magic' ? 0xffd84a : type === 'health' ? 0xff4436 : 0xc9e24a,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    };
    return pickupAssets[type];
  }

  function buildPickupParts(type) {
    const parts = [];
    if (type === 'magic') {
      // 마법 힐팩 — 금빛 상자에 십자
      parts.push({ geo: new THREE.BoxGeometry(0.4, 0.3, 0.3), matrix: MAT(0, 0, 0), color: 0x4a3d12 });
      parts.push({ geo: new THREE.BoxGeometry(0.42, 0.06, 0.32), matrix: MAT(0, 0.1, 0), color: 0xffd84a });
      parts.push({ geo: new THREE.BoxGeometry(0.42, 0.06, 0.32), matrix: MAT(0, -0.1, 0), color: 0xffd84a });
      parts.push({ geo: new THREE.BoxGeometry(0.2, 0.08, 0.33), matrix: MAT(0, 0, 0), color: 0xffe98a });
      parts.push({ geo: new THREE.BoxGeometry(0.08, 0.22, 0.33), matrix: MAT(0, 0, 0), color: 0xffe98a });
    } else if (type === 'health') {
      parts.push({ geo: new THREE.BoxGeometry(0.42, 0.3, 0.3), matrix: MAT(0, 0, 0), color: 0xe8e4d8 });
      parts.push({ geo: new THREE.BoxGeometry(0.2, 0.07, 0.32), matrix: MAT(0, 0.05, 0), color: 0xcc2418 });
      parts.push({ geo: new THREE.BoxGeometry(0.07, 0.2, 0.32), matrix: MAT(0, 0.05, 0), color: 0xcc2418 });
    } else {
      parts.push({ geo: new THREE.BoxGeometry(0.44, 0.26, 0.3), matrix: MAT(0, 0, 0), color: 0x4c5433 });
      parts.push({ geo: new THREE.BoxGeometry(0.46, 0.06, 0.32), matrix: MAT(0, 0.06, 0), color: 0xd8b13a });
      parts.push({ geo: new THREE.BoxGeometry(0.1, 0.16, 0.12), matrix: MAT(0.1, 0.16, 0), color: 0x2f3324 });
    }
    return parts;
  }

  function makePickupMesh(type) {
    const a = getPickupAssets(type);
    const g = new THREE.Group();

    // 상자 본체는 따로 묶어서 위아래로 흔든다 (빛기둥은 제자리 유지)
    const bob = new THREE.Group();
    a.groups.forEach((grp) => {
      const mesh = new THREE.Mesh(grp.geo, grp.mat);
      mesh.castShadow = true;
      bob.add(mesh);
    });
    g.add(bob);

    // 어둠 속에서도 보이도록 빛기둥
    const beam = new THREE.Mesh(a.beamGeo, a.beamMat);
    beam.position.y = 1.6;
    g.add(beam);
    return { group: g, bobNode: bob };
  }

  function spawnPickup(type, x, z) {
    const built = makePickupMesh(type);
    built.group.position.set(x, 0.45, z);
    scene.add(built.group);
    pickups.push({
      type,
      group: built.group,
      bobNode: built.bobNode,
      t: rand(0, 6.28),
      taken: false,
    });
  }

  /* 게임 시작 시 학교 곳곳에 보급품을 흩뿌린다 */
  function scatterPickups(n) {
    for (let i = 0; i < n; i++) {
      const spot = SCHOOL.randomSpawnCell(player.pos, 10, flowField);
      if (!spot) continue;
      spawnPickup(Math.random() < 0.45 ? 'health' : 'ammo', spot.x, spot.z);
    }
  }

  function updatePickups(dt) {
    for (let i = pickups.length - 1; i >= 0; i--) {
      const p = pickups[i];
      p.t += dt;
      p.group.rotation.y += dt * 1.3;
      p.bobNode.position.y = Math.sin(p.t * 2) * 0.09;

      const dx = p.group.position.x - player.pos.x;
      const dz = p.group.position.z - player.pos.z;
      if (dx * dx + dz * dz < 2.4) {
        let used = false;
        if (p.type === 'magic') {
          player.shield = PLAYER_MAX_SHIELD;
          player.shieldHits = 0;
          SFX.magicHeal();
          toast('마법 힐팩 — 보조 체력 ' + PLAYER_MAX_SHIELD, true);
          used = true;
        } else if (p.type === 'health') {
          if (player.hp < player.maxHp) {
            player.hp = Math.min(player.maxHp, player.hp + 35);
            toast('구급상자 +35 체력');
            used = true;
          }
        } else {
          let gained = false;
          weapons.forEach((w) => {
            if (!w.unlocked) return;
            if (w.addAmmo(0.34)) gained = true;
            // 예비탄이 무한인 무기(권총)는 addAmmo 가 항상 false 라
            // 이것만 보면 상자를 영영 못 먹는다. 탄창이라도 덜 찼으면 채워 준다.
            if (w.ammo < w.def.magSize) {
              if (w.reserve === Infinity) {
                w.ammo = w.def.magSize;
                gained = true;
              }
            }
          });
          if (gained) {
            toast('탄약 보급');
            used = true;
          }
        }
        if (used) {
          if (p.type !== 'magic') SFX.pickup(p.type);
          scene.remove(p.group);
          pickups.splice(i, 1);
          updateAmmoHud();
        }
      }
    }
  }

  function clearPickups() {
    pickups.forEach((p) => scene.remove(p.group));
    pickups = [];
  }


  /* =========================================================
     부하 (아군 병사)
     ========================================================= */

  /* 총알 궤적 - 짧게 번쩍이는 선 */
  const tracers = { pool: [], cursor: 0, max: 14 };
  function initTracers() {
    const geo = new THREE.BoxGeometry(0.03, 0.03, 1);
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffe2a0,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    for (let i = 0; i < tracers.max; i++) {
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.life = 0;
      scene.add(m);
      tracers.pool.push(m);
    }
  }

  function spawnTracer(from, to) {
    const len = from.distanceTo(to);
    if (len < 0.1) return;
    const m = tracers.pool[tracers.cursor];
    tracers.cursor = (tracers.cursor + 1) % tracers.max;
    m.visible = true;
    m.life = 0.055;
    m.position.copy(from).lerp(to, 0.5);
    m.lookAt(to);
    m.scale.set(1, 1, len);
  }

  function updateTracers(dt) {
    for (let i = 0; i < tracers.pool.length; i++) {
      const m = tracers.pool[i];
      if (!m.visible) continue;
      m.life -= dt;
      if (m.life <= 0) m.visible = false;
    }
  }

  function allySpawnSpot() {
    // 플레이어 주변에서 설 수 있는 자리를 찾는다
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = rand(1.4, 3.2);
      const x = player.pos.x + Math.cos(a) * d;
      const z = player.pos.z + Math.sin(a) * d;
      if (SCHOOL.isSpotFree(x, z, 0.5)) return { x: x, z: z };
    }
    return { x: player.pos.x, z: player.pos.z };
  }

  function summonAlly() {
    if (allies.length >= ALLY_MAX) {
      shopMessage('부하는 최대 ' + ALLY_MAX + '명까지입니다');
      return false;
    }
    if (killPoints < ALLY_SUMMON_COST) {
      shopMessage('킬 포인트가 부족합니다');
      return false;
    }
    killPoints -= ALLY_SUMMON_COST;
    const a = new Ally(allySpawnSpot(), 0);
    a.addTo(scene);
    allies.push(a);
    SFX.pickup('ammo');
    toast(ALLY_RANKS[0].name + ' 합류');
    return true;
  }

  function upgradeAlly(index) {
    const a = allies[index];
    if (!a || a.dead) return false;
    if (a.rank >= ALLY_RANKS.length - 1) {
      shopMessage('이미 최고 계급입니다');
      return false;
    }
    const cost = ALLY_UPGRADE_COST[a.rank + 1];
    if (killPoints < cost) {
      shopMessage('킬 포인트가 부족합니다');
      return false;
    }
    killPoints -= cost;
    a.promote(scene);
    SFX.waveClear();
    toast(a.spec.name + ' 승급');
    return true;
  }

  /* =========================================================
     매치 / 점수판
     ========================================================= */
  function setupMatch() {
    clearBots();
    roster = [{ name: '나', kills: 0, me: true, bot: null }];

    const total = settings.players;
    for (let i = 0; i < total - 1; i++) {
      roster.push({ name: botName(i), kills: 0, me: false, bot: null });
    }

    // 앞쪽 몇 명만 실제 3D 봇으로 내보낸다
    const live = Math.min(MAX_LIVE_BOTS, total - 1);
    for (let i = 0; i < live; i++) {
      const spot = SCHOOL.randomSpawnCell(player.pos, 6, flowField);
      if (!spot) continue;
      const b = new Bot({ x: spot.x, z: spot.z }, randInt(0, 3), roster[i + 1].name);
      b.addTo(scene);
      bots.push(b);
      roster[i + 1].bot = b;
    }
    renderScoreboard();
  }

  function clearBots() {
    bots.forEach(function (b) { b.removeFrom(scene); });
    bots = [];
  }

  function updateBots(dt) {
    const ctx = {
      playerPos: player.pos,
      zombies: zombies,
      bots: bots,
      tracer: spawnTracer,
      onBotHit: function (z, point, killed, head) {
        bloodBurst(point, { x: 0, y: 1, z: 0 }, head ? 10 : 6);
        SFX.flesh(0.45);
        if (killed) onZombieKilled(z, head, point);
      },
    };
    for (let i = bots.length - 1; i >= 0; i--) {
      const b = bots[i];
      b.update(dt, ctx);
      if (b.removeMe) {
        b.removeFrom(scene);
        bots.splice(i, 1);
      }
    }

    /* 명단에 없는(화면 밖) 참가자들의 점수를 천천히 굴린다 */
    rosterTimer -= dt;
    if (rosterTimer <= 0) {
      rosterTimer = 2.5;
      for (let i = 1; i < roster.length; i++) {
        const r = roster[i];
        if (r.bot) r.kills = r.bot.kills;
        else if (Math.random() < 0.28) r.kills++;
      }
      roster[0].kills = stats.kills;
      renderScoreboard();
    }
  }

  function renderScoreboard() {
    if (!roster.length) return;
    el.sbCount.textContent = roster.length;
    const sorted = roster.slice().sort(function (a, b) { return b.kills - a.kills; });
    const myRank = sorted.findIndex(function (r) { return r.me; });

    // 상위 4명 + 내가 그 밖이면 내 줄도 붙인다
    const show = sorted.slice(0, 4);
    if (myRank >= 4) show.push(sorted[myRank]);

    el.sbRows.innerHTML = show
      .map(function (r) {
        const rank = sorted.indexOf(r) + 1;
        return (
          '<div class="sb-row' + (r.me ? ' me' : '') + '">' +
          '<i>' + rank + '</i><span>' + r.name + '</span><b>' + r.kills + '</b></div>'
        );
      })
      .join('');
  }

  function clearAllies() {
    allies.forEach(function (a) { a.removeFrom(scene); });
    allies = [];
  }

  function updateAllies(dt) {
    const ctx = {
      playerPos: player.pos,
      flow: flowField,
      zombies: zombies,
      allies: allies,
      tracer: spawnTracer,
      onAllyHit: function (z, point, killed, head) {
        bloodBurst(point, { x: 0, y: 1, z: 0 }, head ? 10 : 6);
        SFX.flesh(0.5);
        if (killed) onZombieKilled(z, head, point);
      },
    };
    for (let i = allies.length - 1; i >= 0; i--) {
      const a = allies[i];
      a.update(dt, ctx);
      if (a.removeMe) {
        a.removeFrom(scene);
        allies.splice(i, 1);
        toast(a.spec.name + ' 전사', true);
        if (shopOpen) renderShop();
      }
    }
  }

  /* =========================================================
     상점
     ========================================================= */
  function openShop() {
    if (state !== 'playing') return;
    shopOpen = true;
    state = 'shop';
    el.shop.classList.add('show');
    hudEl.classList.remove('on');
    TOUCH.setVisible(false);
    shopMessage('');
    renderShop();
    // 버튼을 클릭해야 하므로 포인터 잠금을 푼다.
    // state 를 먼저 'shop' 으로 바꿔 두어 일시정지로 빠지지 않는다.
    if (document.exitPointerLock) document.exitPointerLock();
  }

  function closeShop() {
    if (!shopOpen) return;
    shopOpen = false;
    el.shop.classList.remove('show');
    hudEl.classList.add('on');
    TOUCH.setVisible(true);
    state = 'playing';
    requestLock();
  }

  function shopMessage(text) {
    el.shopMsg.textContent = text;
  }

  function statLine(spec) {
    return (
      '<div>체력 <b>' + spec.hp + '</b></div>' +
      '<div>피해 <b>' + spec.dmg + '</b></div>' +
      '<div>연사 <b>' + spec.cooldown.toFixed(2) + '초</b></div>' +
      '<div>사거리 <b>' + spec.range + 'm</b></div>' +
      '<div>명중률 <b>' + Math.round(spec.accuracy * 100) + '%</b></div>'
    );
  }

  function renderShop() {
    el.shopPoints.textContent = killPoints;

    /* --- 소환 --- */
    const canSummon = allies.length < ALLY_MAX && killPoints >= ALLY_SUMMON_COST;
    const s0 = ALLY_RANKS[0];
    el.shopSummon.innerHTML =
      '<button class="unit" id="btn-summon"' + (canSummon ? '' : ' disabled') + '>' +
      '<div class="u-top"><span class="u-name">' + s0.name + ' 소환</span>' +
      '<span class="u-cost">' + ALLY_SUMMON_COST + ' KP</span></div>' +
      '<div class="u-stats">' + statLine(s0) + '</div>' +
      '<div class="u-note">현재 ' + allies.length + ' / ' + ALLY_MAX + '명' +
      (allies.length >= ALLY_MAX ? ' — 자리가 없습니다' : '') + '</div>' +
      '</button>';
    const bs = document.getElementById('btn-summon');
    if (bs) {
      bs.addEventListener('click', function () {
        if (summonAlly()) renderShop();
      });
    }

    /* --- 승급 --- */
    if (!allies.length) {
      el.shopUpgrade.innerHTML =
        '<div class="u-note" style="color:#6f7368">먼저 부하를 소환하세요.</div>';
      return;
    }
    el.shopUpgrade.innerHTML = allies
      .map(function (a, i) {
        const maxed = a.rank >= ALLY_RANKS.length - 1;
        const next = maxed ? null : ALLY_RANKS[a.rank + 1];
        const cost = maxed ? 0 : ALLY_UPGRADE_COST[a.rank + 1];
        const can = !maxed && killPoints >= cost;
        const chain = ALLY_RANKS.map(function (r, ri) {
          const cls = ri <= a.rank ? ' on' : ri === a.rank + 1 ? ' next' : '';
          return '<span class="rank-chip' + cls + '">' + r.name + '</span>';
        }).join('');
        return (
          '<button class="unit" data-ally="' + i + '"' + (can ? '' : ' disabled') + '>' +
          '<div class="u-top"><span class="u-name">' + (i + 1) + '번 ' + a.spec.name + '</span>' +
          '<span class="u-cost' + (maxed ? ' free' : '') + '">' +
          (maxed ? 'MAX' : cost + ' KP') + '</span></div>' +
          '<div class="u-stats">' + statLine(next || a.spec) + '</div>' +
          '<div class="rank-chain">' + chain + '</div>' +
          '<div class="u-note">체력 ' + Math.ceil(a.hp) + ' / ' + a.maxHp + '</div>' +
          '</button>'
        );
      })
      .join('');
    el.shopUpgrade.querySelectorAll('[data-ally]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (upgradeAlly(parseInt(b.dataset.ally, 10))) renderShop();
      });
    });
  }

  function updateSquadHud() {
    setText(el.points, 'kp', String(killPoints));
    const key = allies.map(function (a) { return a.rank + ':' + Math.ceil(a.hp); }).join('|');
    if (hudCache.squad === key) return;
    hudCache.squad = key;
    el.squad.innerHTML = allies
      .map(function (a) {
        return (
          '<div class="squad-row"><i>' + a.spec.short + '</i>' +
          '<div class="squad-hp"><span style="transform:scaleX(' +
          clamp(a.hp / a.maxHp, 0, 1).toFixed(2) + ')"></span></div>' +
          '<span>' + a.spec.name + '</span></div>'
        );
      })
      .join('');
  }

  /* =========================================================
     웨이브
     ========================================================= */
  /* =========================================================
     방 단위 진행
     웨이브로 몰려오는 대신, 학교 각 방에 좀비가 미리 들어 있다.
     플레이어가 그 방에 들어서면(= 문을 열면) 그 방 좀비들이 깨어난다.
     ========================================================= */

  function roomZombieCount(room) {
    const d = DIFF[settings.difficulty];
    if (room.type === 'gym') return Math.round(rand(20, 26) * d.count);
    return Math.round(rand(4, 7) * d.count);
  }

  function setupRooms() {
    roomStates = SCHOOL.rooms.map(function (room) {
      return { room: room, count: roomZombieCount(room), triggered: false };
    });
  }

  function totalRemaining() {
    let n = aliveZombieCount();
    for (let i = 0; i < roomStates.length; i++) {
      if (!roomStates[i].triggered) n += roomStates[i].count;
    }
    return n;
  }

  function roomsLeft() {
    let n = 0;
    for (let i = 0; i < roomStates.length; i++) if (!roomStates[i].triggered) n++;
    return n;
  }

  function roomLabel(room) {
    return room.type === 'gym' ? '체육관' : room.id + '반 교실';
  }

  /* 방 안의 빈 자리를 찾아 좀비를 풀어 놓는다 */
  function triggerRoom(st) {
    st.triggered = true;
    const r = st.room;
    const d = DIFF[settings.difficulty];
    let placed = 0;

    for (let attempt = 0; attempt < st.count * 25 && placed < st.count; attempt++) {
      const gx = randInt(r.x0, r.x1);
      const gy = randInt(r.y0, r.y1);
      const x = SCHOOL.wx(gx) + rand(-1.4, 1.4);
      const z = SCHOOL.wz(gy) + rand(-1.4, 1.4);
      if (!SCHOOL.isSpotFree(x, z, 0.55)) continue;
      // 플레이어 코앞에서 튀어나오지는 않게
      if (Math.hypot(x - player.pos.x, z - player.pos.z) < 5) continue;

      let type = 'walker';
      const roll = Math.random();
      if (r.type === 'gym') type = roll < 0.3 ? 'runner' : roll < 0.42 ? 'brute' : 'walker';
      else type = roll < 0.18 ? 'runner' : roll < 0.23 ? 'brute' : 'walker';

      const z2 = new Zombie(type, { x: x, z: z }, { hp: d.hp, speed: d.speed, dmg: d.dmg });
      z2.addTo(scene);
      zombies.push(z2);
      placed++;
    }

    SFX.alarm();
    announce(roomLabel(r), placed + '마리가 깨어났다');
    updateHud();
  }

  /* 플레이어가 어느 방에 들어갔는지 확인 */
  function checkRoomEntry() {
    const gx = SCHOOL.cx(player.pos.x);
    const gy = SCHOOL.cz(player.pos.z);
    for (let i = 0; i < roomStates.length; i++) {
      const st = roomStates[i];
      if (st.triggered) continue;
      const r = st.room;
      if (gx >= r.x0 && gx <= r.x1 && gy >= r.y0 && gy <= r.y1) {
        triggerRoom(st);
        return;
      }
    }
  }

  function checkVictory() {
    if (victory) return;
    if (roomsLeft() > 0) return;
    if (aliveZombieCount() > 0) return;
    victory = true;
    state = 'dead'; // 조작을 멈춘다
    SFX.waveClear();
    SFX.stopAmbient();
    document.exitPointerLock && document.exitPointerLock();
    hudEl.classList.remove('on');
    TOUCH.setVisible(false);
    $('#gameover').querySelector('h1').textContent = '탈 출';
    $('#go-sub').textContent = '학교를 전부 비웠다';
    $('#g-wave').textContent = SCHOOL.rooms.length;
    $('#g-kills').textContent = stats.kills;
    $('#g-head').textContent = stats.headshots;
    $('#g-acc').textContent =
      (stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0) + '%';
    $('#g-time').textContent = fmtTime(stats.time);
    setTimeout(function () { showScreen('gameover'); }, 700);
  }

  /* =========================================================
     사물함 수색 / 마법 힐팩
     ========================================================= */
  function setupLockers() {
    const rng = mulberry32(4823);
    lockers = SCHOOL.lockerSpots.map(function (spot) {
      const roll = rng();
      // 대부분은 비어 있고, 가끔 탄약, 드물게 마법 힐팩
      const loot = roll < 0.1 ? 'magic' : roll < 0.34 ? 'ammo' : 'empty';
      return { x: spot.x, z: spot.z, ry: spot.ry, searched: false, loot: loot };
    });
  }

  function updateLockerPrompt() {
    nearLocker = null;
    let best = 3.2 * 3.2;
    for (let i = 0; i < lockers.length; i++) {
      const L = lockers[i];
      if (L.searched) continue;
      const dx = L.x - player.pos.x;
      const dz = L.z - player.pos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < best) {
        best = d2;
        nearLocker = L;
      }
    }
    const el2 = $('#search-prompt');
    const show = !!nearLocker;
    if (el2.hidden === show) el2.hidden = !show;
  }

  function searchLocker() {
    if (!nearLocker) return;
    const L = nearLocker;
    L.searched = true;
    SFX.lockerOpen();

    if (L.loot === 'magic') {
      setTimeout(function () {
        spawnPickup('magic', L.x, L.z);
        toast('사물함에서 무언가 빛난다', true);
      }, 380);
    } else if (L.loot === 'ammo') {
      setTimeout(function () {
        spawnPickup('ammo', L.x, L.z);
        toast('탄약을 찾았다');
      }, 380);
    } else {
      toast('비어 있다');
    }
    nearLocker = null;
    $('#search-prompt').hidden = true;
  }

  function onZombieKilled(z, head, point) {
    stats.kills++;
    limitCorpses();
    const gain = (KILL_VALUE[z.typeKey] || 1) + (head ? 1 : 0);
    killPoints += gain;
    if (shopOpen) renderShop();
    SFX.zombieDeath(z.pos.distanceTo(player.pos));
    bloodBurst(point, { x: 0, y: 1, z: 0 }, 14);
    if (Math.random() < 0.1 && SCHOOL.isSpotFree(z.pos.x, z.pos.z, 0.5)) {
      spawnPickup(Math.random() < 0.45 ? 'health' : 'ammo', z.pos.x, z.pos.z);
    }
    updateHud();
    checkVictory();
  }

  /* =========================================================
     플레이어
     ========================================================= */
  function resetPlayer() {
    const sp = SCHOOL.spawnPoint;
    player.pos.set(sp.x, 0, sp.z);
    player.vel.set(0, 0, 0);
    player.yaw = -Math.PI / 2; // 복도 동쪽(학교 안쪽)을 바라봄
    player.pitch = 0;
    player.hp = player.maxHp;
    player.shield = 0;
    player.shieldHits = 0;
    player.stamina = player.maxStamina;
    player.crouching = false;
    player.curHeight = player.height;
    player.onGround = true;
    player.invuln = 0;
    player.recoilPitch = 0;
    player.recoilYaw = 0;
    player.shakeT = 0;
  }

  function damagePlayer(amount, src) {
    if (state !== 'playing') return;
    if (player.invuln > 0) return;
    // 전역 무적이라 동시에 몰려도 초당 피격 횟수가 고정된다.
    // 너무 길면 포위가 안 무서워지므로 짧게 잡는다.
    player.invuln = 0.22;

    /*
      마법 힐팩의 보조 체력.
      체력을 대신 받아 주되, 좀비에게 5번 맞아야 1 이 닳는다.
      (20 이면 100대를 버틴다 — 그만큼 드문 아이템)
    */
    if (player.shield > 0) {
      player.shieldHits++;
      if (player.shieldHits >= 5) {
        player.shieldHits = 0;
        player.shield--;
        SFX.shieldChip();
      }
      SFX.hurt();
      addShake(0.3, 0.25);
      flashDamage();
      updateHud();
      return;
    }

    player.hp -= amount;
    SFX.hurt();
    addShake(0.45, 0.35);
    flashDamage();
    updateHud();
    if (player.hp <= 0) {
      player.hp = 0;
      die();
    }
  }

  function addShake(amt, t) {
    player.shakeAmt = Math.max(player.shakeAmt, amt);
    player.shakeT = Math.max(player.shakeT, t);
  }

  function updatePlayer(dt) {
    // 터치 조준: 오른쪽 화면을 드래그한 만큼 시점을 돌린다
    if (TOUCH.enabled) {
      const l = TOUCH.consumeLook();
      if (l.dx || l.dy) {
        const ts = 0.0032 * settings.sensitivity;
        player.yaw -= l.dx * ts;
        player.pitch -= l.dy * ts;
        player.pitch = clamp(player.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
        mouseSwayX = clamp(mouseSwayX + l.dx * 0.004, -1.2, 1.2);
        mouseSwayY = clamp(mouseSwayY + l.dy * 0.004, -1.2, 1.2);
      }
    }

    // 커서 조준 모드: 화면 중앙에서 벗어난 만큼 계속 선회한다
    if (aimMode === 'cursor' && cursorAim.active) {
      const DEAD = 0.14;
      const ramp = (v) => {
        const a = Math.abs(v);
        if (a < DEAD) return 0;
        const t = (a - DEAD) / (1 - DEAD);
        return Math.sign(v) * t * t; // 중앙 근처는 섬세하게, 가장자리는 빠르게
      };
      player.yaw -= ramp(cursorAim.x) * 3.2 * settings.sensitivity * dt;
      player.pitch -= ramp(cursorAim.y) * 2.2 * settings.sensitivity * dt;
      player.pitch = clamp(player.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
    }

    // 시선
    let pitch = player.pitch + player.recoilPitch;
    pitch = clamp(pitch, -Math.PI / 2 + 0.02, Math.PI / 2 - 0.02);
    camera.rotation.set(pitch, player.yaw + player.recoilYaw, 0);
    player.recoilPitch = dampen(player.recoilPitch, 0, 9, dt);
    player.recoilYaw = dampen(player.recoilYaw, 0, 9, dt);

    // 이동 입력 (키보드 + 가상 조이스틱)
    let fwd = (keys['KeyW'] ? 1 : 0) - (keys['KeyS'] ? 1 : 0);
    let side = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
    if (TOUCH.enabled && TOUCH.move.active) {
      fwd = -TOUCH.move.y; // 위로 밀면 전진
      side = TOUCH.move.x;
    }

    const sinY = Math.sin(player.yaw);
    const cosY = Math.cos(player.yaw);
    let wishX = -sinY * fwd + cosY * side;
    let wishZ = -cosY * fwd - sinY * side;
    const wl = Math.hypot(wishX, wishZ);
    if (wl > 0.0001) {
      wishX /= wl;
      wishZ /= wl;
    }

    // 앉기
    const wantCrouch =
      !!(keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC']) ||
      (TOUCH.enabled && TOUCH.buttons.crouch);
    player.crouching = wantCrouch && player.onGround;
    const targetH = player.crouching ? 1.05 : player.height;
    player.curHeight = dampen(player.curHeight, targetH, 12, dt);

    // 질주 / 스태미나
    const moving = wl > 0.01;
    const wantSprint =
      (!!keys['ShiftLeft'] || (TOUCH.enabled && TOUCH.buttons.sprint)) &&
      moving && fwd > 0 && !player.crouching;
    const sprinting = wantSprint && player.stamina > 1;
    if (sprinting) {
      player.stamina = Math.max(0, player.stamina - 32 * dt);
    } else {
      player.stamina = Math.min(player.maxStamina, player.stamina + (moving ? 8 : 17) * dt);
    }

    const targetSpeed = player.crouching
      ? SPEED.crouch
      : sprinting
      ? SPEED.sprint
      : SPEED.walk;

    const accel = player.onGround ? 42 : 12;
    const desiredX = wishX * targetSpeed;
    const desiredZ = wishZ * targetSpeed;
    player.vel.x = dampen(player.vel.x, desiredX, accel * 0.35, dt);
    player.vel.z = dampen(player.vel.z, desiredZ, accel * 0.35, dt);
    if (!moving && player.onGround) {
      player.vel.x = dampen(player.vel.x, 0, 14, dt);
      player.vel.z = dampen(player.vel.z, 0, 14, dt);
    }

    // 점프 / 중력
    if ((keys['Space'] || (TOUCH.enabled && TOUCH.buttons.jump)) && player.onGround) {
      player.vel.y = 6.2;
      player.onGround = false;
    }
    player.vel.y -= 21 * dt;
    player.pos.y += player.vel.y * dt;
    if (player.pos.y <= 0) {
      player.pos.y = 0;
      player.vel.y = 0;
      player.onGround = true;
    }

    // 수평 이동 + 충돌
    const nx = player.pos.x + player.vel.x * dt;
    const nz = player.pos.z + player.vel.z * dt;
    if (!SCHOOL.circleBlocked(nx, player.pos.z, player.radius, 'all')) player.pos.x = nx;
    else player.vel.x *= 0.2;
    if (!SCHOOL.circleBlocked(player.pos.x, nz, player.radius, 'all')) player.pos.z = nz;
    else player.vel.z *= 0.2;

    // 발소리 + 헤드밥
    const hspeed = Math.hypot(player.vel.x, player.vel.z);
    if (player.onGround && hspeed > 0.6) {
      player.stepDist += hspeed * dt;
      const stride = sprinting ? 1.85 : player.crouching ? 2.6 : 2.15;
      if (player.stepDist > stride) {
        player.stepDist = 0;
        SFX.step(sprinting);
      }
      player.bobT += dt * (sprinting ? 12 : 8.6);
      player.bobAmt = dampen(player.bobAmt, sprinting ? 0.075 : 0.045, 8, dt);
    } else {
      player.bobAmt = dampen(player.bobAmt, 0, 8, dt);
    }

    // 카메라 배치
    const bobY = Math.sin(player.bobT * 2) * player.bobAmt;
    const bobX = Math.sin(player.bobT) * player.bobAmt * 0.6;
    let shakeX = 0;
    let shakeY = 0;
    if (player.shakeT > 0) {
      player.shakeT -= dt;
      const k = clamp(player.shakeT / 0.35, 0, 1) * player.shakeAmt;
      shakeX = rand(-1, 1) * k * 0.12;
      shakeY = rand(-1, 1) * k * 0.12;
      if (player.shakeT <= 0) player.shakeAmt = 0;
    }
    camera.position.set(
      player.pos.x + bobX * 0.4 + shakeX,
      player.pos.y + player.curHeight + bobY + shakeY,
      player.pos.z
    );

    if (player.invuln > 0) player.invuln -= dt;

    // 스태미나가 바닥나면 숨소리 대신 심장박동
    if (player.hp <= 32) {
      heartbeatTimer -= dt;
      if (heartbeatTimer <= 0) {
        heartbeatTimer = lerp(1.1, 0.55, 1 - player.hp / 32);
        SFX.heartbeat(clamp(1 - player.hp / 40, 0.3, 1));
      }
    }
  }

  let heartbeatTimer = 0;

  /* ---------- 뷰모델 애니메이션 ---------- */
  function updateViewModel(dt) {
    if (!viewModel) return;
    const def = weapons[curWeapon].def;

    vmRecoil = dampen(vmRecoil, 0, 12, dt);
    vmSwitch = Math.max(0, vmSwitch - dt);

    const hspeed = Math.hypot(player.vel.x, player.vel.z);
    const bob = Math.min(hspeed / SPEED.sprint, 1);
    const t = player.bobT;

    const swayX = clamp(mouseSwayX, -1, 1) * 0.035;
    const swayY = clamp(mouseSwayY, -1, 1) * 0.03;
    mouseSwayX = dampen(mouseSwayX, 0, 8, dt);
    mouseSwayY = dampen(mouseSwayY, 0, 8, dt);

    let px = def.view.x + Math.sin(t) * 0.014 * bob - swayX;
    let py = def.view.y + Math.abs(Math.sin(t * 2)) * 0.012 * bob - swayY;
    let pz = def.view.z + vmRecoil * 0.06;

    // def.view 의 기준 회전을 실제로 반영한다 (예전엔 정의만 해두고 무시했다)
    let rx = def.view.rx - vmRecoil * 0.32 + swayY * 0.5;
    let ry = def.view.ry + swayX * 0.8;
    let rz = def.view.rz + Math.sin(t) * 0.02 * bob;

    // 재장전 모션
    if (reloading) {
      const total = def.reload;
      const p = 1 - reloadTimer / total;
      const s = Math.sin(clamp(p, 0, 1) * Math.PI);
      py -= s * 0.16;
      pz += s * 0.05;
      rx += s * 0.9;
      rz += s * 0.35;
    }
    // 무기 교체 모션
    if (vmSwitch > 0) {
      const s = vmSwitch / 0.28;
      py -= s * 0.28;
      rx += s * 1.0;
    }
    // 질주 모션
    const sprinting = keys['ShiftLeft'] && hspeed > 5 && player.onGround;
    if (sprinting && !reloading) {
      py -= 0.05;
      rz += 0.35;
      ry += 0.25;
      px += 0.04;
    }

    viewModel.position.set(px, py, pz);
    viewModel.rotation.set(rx, ry, rz);

    // 머즐 플래시
    if (muzzleTimer > 0) {
      muzzleTimer -= dt;
      if (muzzleTimer <= 0) muzzleMesh.visible = false;
    }
    muzzleLight.intensity = dampen(muzzleLight.intensity, 0, 30, dt);
    viewFlash.intensity = dampen(viewFlash.intensity, 0, 26, dt);
    // 손전등을 끄면 총도 같이 어두워져야 자연스럽다
    viewKey.intensity = dampen(viewKey.intensity, player.flashlightOn ? 0.85 : 0.3, 6, dt);
  }

  /* =========================================================
     HUD
     ========================================================= */
  /* 값이 실제로 바뀐 항목만 DOM 에 쓴다 (매 프레임 6곳을 새로 쓰던 것을 방지) */
  const hudCache = {};
  function setText(node, key, value) {
    if (hudCache[key] === value) return;
    hudCache[key] = value;
    node.textContent = value;
  }

  function aliveZombieCount() {
    let n = 0;
    for (let i = 0; i < zombies.length; i++) if (!zombies[i].dead) n++;
    return n;
  }

  function updateHud() {
    setText(el.wave, 'wave', String(totalRemaining()));
    setText(el.remaining, 'remain', String(roomsLeft()));
    setText(el.kills, 'kills', '처치 ' + stats.kills + ' · 생존 ' + fmtTime(stats.time));

    const hpR = clamp(player.hp / player.maxHp, 0, 1);
    if (hudCache.hp !== hpR) {
      hudCache.hp = hpR;
      el.hpFill.style.transform = 'scaleX(' + hpR + ')';
      el.hpText.textContent = Math.ceil(player.hp);
      el.hpFill.classList.toggle('low', hpR < 0.3);
      el.lowhp.style.opacity = hpR < 0.32 ? String((0.32 - hpR) * 2.6) : '0';
    }

    const stR = Math.round(clamp(player.stamina / player.maxStamina, 0, 1) * 100) / 100;
    if (hudCache.stam !== stR) {
      hudCache.stam = stR;
      el.stamFill.style.transform = 'scaleX(' + stR + ')';
    }

    // 마법 힐팩이 준 보조 체력
    if (hudCache.shield !== player.shield) {
      hudCache.shield = player.shield;
      const on = player.shield > 0;
      if (el.shieldWrap.hidden === on) el.shieldWrap.hidden = !on;
      if (on) {
        el.shieldText.textContent = player.shield;
        el.shieldFill.style.transform =
          'scaleX(' + clamp(player.shield / PLAYER_MAX_SHIELD, 0, 1) + ')';
      }
    }
  }

  function updateAmmoHud() {
    const w = weapons[curWeapon];
    el.wname.textContent = w.def.name;
    el.ammo.innerHTML = w.ammo + ' <small>/ ' + w.ammoText + '</small>';
    el.ammo.classList.toggle('empty', w.ammo === 0);
  }

  function updateCrosshair() {
    const def = weapons[curWeapon].def;
    const s = currentSpread(def);
    const px = clamp(6 + s * 420, 5, 34);
    el.ch.t.style.top = -px + 22 - 8 + 'px';
    el.ch.b.style.bottom = -px + 22 - 8 + 'px';
    el.ch.l.style.left = -px + 22 - 8 + 'px';
    el.ch.r.style.right = -px + 22 - 8 + 'px';
  }

  let hitmarkerTimer = 0;
  function showHitmarker(kill) {
    el.hitmarker.style.opacity = '1';
    el.hitmarker.classList.toggle('kill', !!kill);
    hitmarkerTimer = kill ? 0.22 : 0.12;
  }

  function flashDamage() {
    el.damage.style.opacity = '0.85';
    setTimeout(() => {
      el.damage.style.opacity = '0';
    }, 130);
  }

  let announceTimer = 0;
  function announce(big, sub) {
    el.announceBig.textContent = big;
    el.announceSub.textContent = sub || '';
    el.announce.style.opacity = '1';
    announceTimer = 2.6;
  }

  function toast(text, warn) {
    const d = document.createElement('div');
    d.className = 'toast' + (warn ? ' warn' : '');
    d.textContent = text;
    el.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2200);
  }

  /* =========================================================
     상태 전환
     ========================================================= */
  function startGame() {
    if (!built) return;
    applyQuality();
    resetGame();
    state = 'playing';
    hudEl.classList.add('on');
    TOUCH.setVisible(true);
    hideScreens();
    SFX.init();
    SFX.resume();
    SFX.setVolume(settings.volume);
    SFX.startAmbient();
    requestLock();
    announce('폐교에 들어섰다', '교실을 하나씩 비워라');
  }

  function resetGame() {
    zombies.forEach((z) => z.removeFrom(scene));
    zombies = [];
    clearPickups();
    decals.pool.forEach((d) => (d.visible = false));
    clearParticles();

    clearAllies();
    clearBots();
    killPoints = 0;
    shopOpen = false;
    el.shop.classList.remove('show');
    tracers.pool.forEach(function (m) { m.visible = false; });

    clearedRooms = 0;
    victory = false;
    $('#gameover').querySelector('h1').textContent = '사 망';
    setupRooms();
    setupLockers();
    nearLocker = null;
    $('#search-prompt').hidden = true;
    stats.kills = 0;
    stats.headshots = 0;
    stats.shots = 0;
    stats.hits = 0;
    stats.time = 0;
    reloading = false;
    fireCooldown = 0;
    spreadHeat = 0;

    resetPlayer();
    setupWeapons();
    flowField = computeFlowField(player.pos.x, player.pos.z);
    scatterPickups(6);
    setupMatch();
    updateHud();
    updateAmmoHud();
  }

  /*
    사망 점프스케어.
    좀비 얼굴이 화면을 덮치고 비명이 난 뒤 게임오버로 넘어간다.
  */
  function playJumpscare() {
    const box = $('#jumpscare');
    const face = $('#js-face');
    const flash = $('#js-flash');

    face.style.backgroundImage = 'url(' + TEX.jumpscareFace() + ')';
    box.classList.remove('out');
    box.classList.add('on');

    // 애니메이션을 처음부터 다시 돌리려면 한 번 끊어 줘야 한다
    [face, flash].forEach(function (elm) {
      elm.style.animation = 'none';
      void elm.offsetWidth;
      elm.style.animation = '';
    });

    SFX.scream();

    setTimeout(function () {
      box.classList.add('out');
    }, 1250);
    setTimeout(function () {
      box.classList.remove('on', 'out');
    }, 1700);
  }

  function die() {
    shopOpen = false;
    el.shop.classList.remove('show');
    state = 'dead';
    playJumpscare();
    SFX.gameOver();
    SFX.stopAmbient();
    document.exitPointerLock && document.exitPointerLock();
    hudEl.classList.remove('on');
    TOUCH.setVisible(false);
    $('#g-wave').textContent = SCHOOL.rooms.length - roomsLeft();
    $('#g-kills').textContent = stats.kills;
    $('#g-head').textContent = stats.headshots;
    $('#g-acc').textContent =
      (stats.shots ? Math.round((stats.hits / stats.shots) * 100) : 0) + '%';
    $('#g-time').textContent = fmtTime(stats.time);
    $('#go-sub').textContent =
      stats.kills >= 60 ? '거의 다 왔었다' : stats.kills >= 25 ? '꽤 버텼다' : '학교는 다시 조용해졌다';
    setTimeout(() => showScreen('gameover'), 1750);
  }

  function pauseGame() {
    if (state !== 'playing') return;
    state = 'paused';
    hudEl.classList.remove('on');
    TOUCH.setVisible(false);
    $('#p-wave').textContent = SCHOOL.rooms.length - roomsLeft();
    $('#p-kills').textContent = stats.kills;
    $('#p-time').textContent = fmtTime(stats.time);
    showScreen('pause');
  }

  function resumeGame() {
    if (state !== 'paused') return;
    hideScreens();
    hudEl.classList.add('on');
    TOUCH.setVisible(true);
    state = 'playing';
    SFX.resume();
    requestLock();
  }

  function toMenu() {
    shopOpen = false;
    el.shop.classList.remove('show');
    TOUCH.setVisible(false);
    state = 'menu';
    SFX.stopAmbient();
    hudEl.classList.remove('on');
    document.exitPointerLock && document.exitPointerLock();
    showScreen('start');
  }

  function showScreen(name) {
    Object.keys(screens).forEach((k) => screens[k].classList.toggle('show', k === name));
  }
  function hideScreens() {
    Object.keys(screens).forEach((k) => screens[k].classList.remove('show'));
  }

  function toggleFlashlight() {
    player.flashlightOn = !player.flashlightOn;
    flashlight.intensity = player.flashlightOn ? 2.0 : 0;
    toast(player.flashlightOn ? '손전등 켜짐' : '손전등 꺼짐');
  }

  function requestLock() {
    // 터치 기기는 포인터 잠금 자체가 없다. 드래그로 조준한다.
    if (TOUCH.enabled) {
      aimMode = 'touch';
      return;
    }
    if (aimMode === 'cursor') return;
    if (!canvas.requestPointerLock) {
      enableCursorAim();
      return;
    }
    let p;
    try {
      p = canvas.requestPointerLock();
    } catch (e) {
      enableCursorAim();
      return;
    }
    if (p && typeof p.catch === 'function') p.catch(enableCursorAim);
    // 일부 브라우저는 조용히 실패하므로 잠깐 뒤에 확인한다
    setTimeout(() => {
      if (!pointerLocked && (state === 'playing' || state === 'paused')) enableCursorAim();
    }, 500);
  }

  function enableCursorAim() {
    if (aimMode === 'cursor') return;
    aimMode = 'cursor';
    canvas.style.cursor = 'none';
    toast('포인터 잠금이 막혀 커서 조준으로 전환했습니다', true);
  }

  /* =========================================================
     입력 핸들러
     ========================================================= */
  let mouseHeldSince = 0;

  function bindInput() {
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (shopOpen) {
          closeShop();
          return;
        }
        // 잠금 모드에서는 브라우저가 해제를 처리하지만, 커서 조준에서는 직접 멈춘다
        if (aimMode === 'cursor' && state === 'playing') pauseGame();
        return;
      }
      if (e.code === 'KeyB' && shopOpen) {
        closeShop();
        return;
      }
      keys[e.code] = true;

      if (state !== 'playing') return;

      if (e.code === 'KeyB') {
        openShop();
        return;
      }
      if (e.code === 'KeyE') searchLocker();
      if (e.code === 'KeyR') startReload();
      if (e.code === 'KeyF') toggleFlashlight();
      if (e.code === 'Digit1') equip(0);
      if (e.code === 'Digit2') equip(1);
      if (e.code === 'Digit3') equip(2);
      if (e.code === 'Space') e.preventDefault();
    });

    document.addEventListener('keyup', (e) => {
      keys[e.code] = false;
    });

    // Alt+Tab 등으로 포커스를 잃으면 keyup 이 안 와서 키가 눌린 채로 굳는다
    const releaseAll = () => {
      for (const k in keys) keys[k] = false;
      mouseDown = false;
      mouseHeldSince = 0;
      cursorAim.active = false;
    };
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) releaseAll();
    });

    canvas.addEventListener('mousedown', (e) => {
      if (state === 'playing') {
        if (e.button === 0) {
          mouseDown = true;
          mouseHeldSince = 0;
        }
        if (!pointerLocked) requestLock();
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) {
        mouseDown = false;
        mouseHeldSince = 0;
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (state !== 'playing') return;

      if (aimMode === 'cursor') {
        // 화면 중앙에서 얼마나 벗어났는지를 선회 속도로 쓴다
        cursorAim.x = (e.clientX / window.innerWidth) * 2 - 1;
        cursorAim.y = (e.clientY / window.innerHeight) * 2 - 1;
        cursorAim.active = true;
        return;
      }

      if (!pointerLocked) return;
      const s = 0.0021 * settings.sensitivity;
      player.yaw -= e.movementX * s;
      player.pitch -= e.movementY * s;
      player.pitch = clamp(player.pitch, -Math.PI / 2 + 0.05, Math.PI / 2 - 0.05);
      mouseSwayX = clamp(mouseSwayX + e.movementX * 0.006, -1.2, 1.2);
      mouseSwayY = clamp(mouseSwayY + e.movementY * 0.006, -1.2, 1.2);
    });

    document.addEventListener('wheel', (e) => {
      if (state !== 'playing') return;
      const unlocked = weapons.map((w, i) => (w.unlocked ? i : -1)).filter((i) => i >= 0);
      if (unlocked.length < 2) return;
      let k = unlocked.indexOf(curWeapon);
      k = (k + (e.deltaY > 0 ? 1 : -1) + unlocked.length) % unlocked.length;
      equip(unlocked[k]);
    }, { passive: true });

    document.addEventListener('pointerlockchange', () => {
      const nowLocked = document.pointerLockElement === canvas;
      // 잠겨 있던 상태에서 풀렸을 때만 일시정지 (애초에 잠기지 않는 환경은 제외)
      if (!nowLocked && pointerLocked && state === 'playing') pauseGame();
      pointerLocked = nowLocked;
      if (nowLocked) {
        aimMode = 'lock';
        cursorAim.active = false;
      }
    });
    document.addEventListener('pointerlockerror', enableCursorAim);

    // 일시정지 화면에서 클릭하면 재개
    screens.pause.addEventListener('click', (e) => {
      if (e.target === screens.pause) resumeGame();
    });

    /* 메뉴 버튼 */
    document.querySelectorAll('[data-diff]').forEach((b) => {
      b.addEventListener('click', () => {
        settings.difficulty = b.dataset.diff;
        document.querySelectorAll('[data-diff]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
      });
    });
    document.querySelectorAll('[data-players]').forEach((b) => {
      b.addEventListener('click', () => {
        settings.players = parseInt(b.dataset.players, 10);
        document.querySelectorAll('[data-players]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
      });
    });
    document.querySelectorAll('[data-quality]').forEach((b) => {
      b.addEventListener('click', () => {
        settings.quality = b.dataset.quality;
        document.querySelectorAll('[data-quality]').forEach((x) => x.classList.remove('sel'));
        b.classList.add('sel');
      });
    });

    const sens = $('#sens');
    sens.addEventListener('input', () => {
      settings.sensitivity = sens.value / 100;
      $('#sens-val').textContent = settings.sensitivity.toFixed(2);
    });
    const vol = $('#vol');
    vol.addEventListener('input', () => {
      settings.volume = vol.value / 100;
      $('#vol-val').textContent = vol.value + '%';
      SFX.setVolume(settings.volume);
    });

    $('#shop-close').addEventListener('click', closeShop);
    $('#btn-start').addEventListener('click', startGame);
    $('#btn-resume').addEventListener('click', resumeGame);
    $('#btn-quit').addEventListener('click', toMenu);
    $('#btn-retry').addEventListener('click', startGame);
    $('#btn-menu').addEventListener('click', toMenu);
  }

  /* =========================================================
     메인 루프
     ========================================================= */
  let menuAngle = 0;

  let crashed = false;
  function animate() {
    if (crashed) return;
    requestAnimationFrame(animate);
    try {
      frame();
    } catch (e) {
      // 한 번 던지고 나면 루프가 멈춰 화면이 굳는다. 원인을 보여주고 정지.
      crashed = true;
      bootFailed(e);
    }
  }

  function frame() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const time = clock.getElapsedTime();
    step(dt, time);
    render();
  }

  /* 시뮬레이션 한 스텝. 테스트에서 프레임과 무관하게 돌릴 수 있도록 분리했다 */
  function step(dt, time) {
    if (state === 'playing') {
      stats.time += dt;

      // 입력 -> 사격
      if (fireCooldown > 0) fireCooldown -= dt;

      if (TOUCH.enabled) {
        // 발사 버튼을 누르고 있으면 계속, 화면을 짧게 탭하면 한 발
        const held = TOUCH.buttons.fire;
        if (held && !mouseDown) mouseHeldSince = 0;
        mouseDown = held;
        if (TOUCH.consume('tapFire') && !held) {
          mouseDown = true;
          mouseHeldSince = 0;
          tapFireRelease = true;
        }
        if (TOUCH.consume('reload')) startReload();
        if (TOUCH.consume('search')) searchLocker();
        if (TOUCH.consume('weapon1')) equip(0);
        if (TOUCH.consume('weapon2')) equip(1);
        if (TOUCH.consume('weapon3')) equip(2);
        if (TOUCH.consume('shop')) openShop();
        if (TOUCH.consume('flashlight')) toggleFlashlight();
        if (TOUCH.consume('pause')) pauseGame();
      }

      if (mouseDown) {
        const def = weapons[curWeapon].def;
        if (def.auto || mouseHeldSince === 0) tryFire(dt);
      }
      // 쏘는 중에도 조금씩 회복시켜 지속사격이 최대 퍼짐에 고정되지 않게 한다
      spreadHeat = dampen(spreadHeat, 0, mouseDown ? 1.1 : 3.4, dt);

      if (reloading) {
        reloadTimer -= dt;
        el.reloadBarFill.style.width =
          (1 - reloadTimer / weapons[curWeapon].def.reload) * 100 + '%';
        if (reloadTimer <= 0) finishReload();
      }

      updatePlayer(dt);
      updateViewModel(dt);

      // 경로 필드
      flowTimer -= dt;
      if (flowTimer <= 0) {
        flowTimer = 0.32;
        flowField = computeFlowField(player.pos.x, player.pos.z);
      }

      // 좀비
      const ctx = {
        playerPos: camera.position,
        flow: flowField,
        neighbors: () => zombies,
        damagePlayer,
        allies: allies.concat(bots),
        damageAlly: function (ally, amount) {
          if (ally.hurt(amount)) {
            // 전사 처리는 updateAllies 에서 정리한다
          }
          addShake(0.12, 0.12);
        },
      };
      for (let i = zombies.length - 1; i >= 0; i--) {
        const z = zombies[i];
        z.update(dt, ctx);
        if (z.removeMe) {
          z.removeFrom(scene);
          zombies.splice(i, 1);
        }
      }

      // 방에 들어서면 그 방 좀비가 깨어난다
      checkRoomEntry();
      updateLockerPrompt();

      updateAllies(dt);
      updateBots(dt);
      updateTracers(dt);
      updatePickups(dt);
      updateParticles(dt);
      SCHOOL.update(dt, player.pos, time);
      if (tapFireRelease) {
        mouseDown = false;
        tapFireRelease = false;
      }

      updateCrosshair();
      updateHud();
      updateSquadHud();

      // 히트마커 / 안내문 타이머
      if (hitmarkerTimer > 0) {
        hitmarkerTimer -= dt;
        if (hitmarkerTimer <= 0) el.hitmarker.style.opacity = '0';
      }
      if (announceTimer > 0) {
        announceTimer -= dt;
        if (announceTimer <= 0) el.announce.style.opacity = '0';
      }
    } else if (state === 'shop') {
      // 상점 중에는 전투가 멈춘다. 화면만 갱신.
      updateTracers(dt);
      updateParticles(dt);
      SCHOOL.update(dt, player.pos, time);
    } else if (state === 'menu') {
      // 메뉴 배경: 복도를 천천히 둘러보는 카메라
      menuAngle += dt * 0.08;
      const sp = SCHOOL.spawnPoint;
      camera.position.set(sp.x + 6 + Math.sin(menuAngle * 0.7) * 3, 1.7, sp.z + Math.sin(menuAngle) * 1.2);
      camera.rotation.set(Math.sin(menuAngle * 0.5) * 0.06, Math.PI / 2 + Math.sin(menuAngle) * 0.25, 0);
      SCHOOL.update(dt, camera.position, time);
      updateParticles(dt);
    } else if (state === 'dead') {
      // 사망 연출: 시점이 바닥으로 쓰러짐
      camera.position.y = dampen(camera.position.y, 0.4, 3, dt);
      camera.rotation.z = dampen(camera.rotation.z, 1.1, 2.2, dt);
      camera.rotation.x = dampen(camera.rotation.x, -0.25, 2.2, dt);
      const ctx = { playerPos: camera.position, flow: flowField, neighbors: () => zombies, damagePlayer: null };
      zombies.forEach((z) => z.update(dt, ctx));
      updateParticles(dt);
      SCHOOL.update(dt, camera.position, time);
    }

  }

  function render() {
    renderer.render(scene, camera);

    // 뷰모델을 월드 위에 겹쳐 그린다 (깊이만 초기화해서 벽을 뚫지 않게)
    if (state !== 'menu' && state !== 'shop' && viewRoot.visible) {
      renderer.autoClear = false;
      renderer.clearDepth();
      renderer.render(viewScene, viewCamera);
      renderer.autoClear = true;
    }
  }

  /* =========================================================
     부팅
     ========================================================= */
  function bootFailed(err) {
    console.error(err);
    const box = $('#loading');
    box.innerHTML =
      '<h1 style="font-size:26px;color:#c4281f">실행할 수 없습니다</h1>' +
      '<p style="color:#8a8f84;font-size:14px;line-height:1.8;max-width:520px;text-align:center">' +
      '이 브라우저나 컴퓨터에서 3D 그래픽(WebGL)을 사용할 수 없습니다.<br>' +
      '크롬 또는 엣지 최신 버전에서 열어 보시고, 그래도 안 되면<br>' +
      '브라우저 설정에서 “하드웨어 가속”을 켜 주세요.</p>' +
      '<p style="color:#4b4f47;font-size:11px;margin-top:6px">' +
      String((err && err.message) || err).slice(0, 200) +
      '</p>';
    box.style.display = 'flex';
  }

  function boot() {
    initRenderer();
    initParticles();
    initDecals();
    initMuzzle();
    initTracers();

    SCHOOL.build(scene, 'medium');
    built = true;

    setupWeapons();
    resetPlayer();
    flowField = computeFlowField(player.pos.x, player.pos.z);

    bindInput();
    // 나중에 터치로 켜지면 플레이 중일 때 바로 UI를 띄운다
    TOUCH.init(function () {
      TOUCH.setVisible(state === 'playing');
    });
    TOUCH.setVisible(false);
    clock = new THREE.Clock();

    // 디버그 핸들 (개발 중 장면 점검용)
    window.__dbg = {
      scene, camera, viewRoot,
      get viewModel() { return viewModel; },
      get player() { return player; },
      get allies() { return allies; },
      get zombies() { return zombies; },
      get lockers() { return lockers; },
      get roomStates() { return roomStates; },
      searchLocker: searchLocker,
      get killPoints() { return killPoints; },
      // 브라우저가 rAF 를 멈춰도 시뮬레이션을 돌려 볼 수 있게
      step: function (dt, count) {
        const n = count || 1;
        for (let i = 0; i < n; i++) step(dt || 0.016, clock.getElapsedTime());
        render();
      },
      set killPoints(v) {
        killPoints = v;
        if (shopOpen) renderShop();
      },
    };

    $('#loading').style.display = 'none';
    animate();
  }

  function safeBoot() {
    if (!window.THREE) {
      bootFailed(new Error('three.js를 불러오지 못했습니다 (네트워크 확인)'));
      return;
    }
    try {
      boot();
    } catch (e) {
      bootFailed(e);
    }
  }

  if (document.readyState === 'complete') safeBoot();
  else window.addEventListener('load', safeBoot);
})();
