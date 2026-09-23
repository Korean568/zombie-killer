/* =========================================================
   touch.js - 모바일 터치 조작
   왼쪽: 가상 조이스틱(이동) / 오른쪽: 화면 드래그(시점) + 버튼
   ========================================================= */

const TOUCH = (function () {
  let enabled = false;
  let root = null;

  /* 이동 입력 (-1..1) */
  const move = { x: 0, y: 0, active: false };
  /* 이번 프레임에 누적된 시점 이동량 (픽셀) */
  const look = { dx: 0, dy: 0 };

  const buttons = {
    fire: false,
    sprint: false,
    jump: false,
    crouch: false,
  };

  /* 눌린 순간 한 번만 소비되는 신호 */
  const pressed = {};

  let stickBase = null;
  let stickKnob = null;
  let stickId = null;
  let stickOrigin = { x: 0, y: 0 };
  let lookId = null;
  let lookLast = { x: 0, y: 0 };
  let lookMoved = 0;
  let lookStart = 0;

  const STICK_RADIUS = 58;

  function isTouchDevice() {
    return (
      window.matchMedia('(pointer: coarse)').matches ||
      navigator.maxTouchPoints > 0 ||
      'ontouchstart' in window
    );
  }

  function el(tag, cls, parent, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text) e.textContent = text;
    (parent || root).appendChild(e);
    return e;
  }

  function build() {
    root = document.createElement('div');
    root.id = 'touch-ui';
    document.body.appendChild(root);

    /* 왼쪽 조이스틱 */
    stickBase = el('div', 'tc-stick');
    stickKnob = el('div', 'tc-knob', stickBase);

    /* 오른쪽 버튼들 */
    const pad = el('div', 'tc-pad');
    mkButton(pad, 'tc-fire', '발사', 'fire');
    mkButton(pad, 'tc-jump', '점프', 'jump');
    mkButton(pad, 'tc-reload', '재장전', 'reload', true);
    mkButton(pad, 'tc-crouch', '앉기', 'crouch');

    /* 왼쪽 보조 버튼 */
    const left = el('div', 'tc-left');
    mkButton(left, 'tc-sprint', '질주', 'sprint');

    /* 상단 보조 버튼 */
    const top = el('div', 'tc-top');
    mkButton(top, 'tc-slot', '1', 'weapon1', true);
    mkButton(top, 'tc-slot', '2', 'weapon2', true);
    mkButton(top, 'tc-slot', '3', 'weapon3', true);
    mkButton(top, 'tc-shop', 'B 상점', 'shop', true);
    mkButton(top, 'tc-light', '손전등', 'flashlight', true);
    mkButton(top, 'tc-pause', '❚❚', 'pause', true);
  }

  /*
    tap = true 면 '눌린 순간 1회' 신호(pressed)로 처리하고,
    아니면 누르고 있는 동안 참인 상태(buttons)로 처리한다.
  */
  function mkButton(parent, cls, label, key, tap) {
    const b = el('div', 'tc-btn ' + cls, parent, label);
    b.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        e.stopPropagation();
        b.classList.add('on');
        if (tap) pressed[key] = true;
        else buttons[key] = true;
      },
      { passive: false }
    );
    const release = (e) => {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      b.classList.remove('on');
      if (!tap) buttons[key] = false;
    };
    b.addEventListener('touchend', release, { passive: false });
    b.addEventListener('touchcancel', release, { passive: false });
    return b;
  }

  function onStart(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      // 버튼 위에서 시작한 터치는 버튼이 이미 처리했다
      if (t.target.closest && t.target.closest('.tc-btn')) continue;

      if (t.clientX < window.innerWidth * 0.45 && stickId === null) {
        stickId = t.identifier;
        stickOrigin.x = t.clientX;
        stickOrigin.y = t.clientY;
        move.active = true;
        stickBase.style.left = t.clientX + 'px';
        stickBase.style.top = t.clientY + 'px';
        stickBase.classList.add('on');
      } else if (lookId === null) {
        lookId = t.identifier;
        lookLast.x = t.clientX;
        lookLast.y = t.clientY;
        lookMoved = 0;
        lookStart = performance.now();
      }
    }
  }

  function onMove(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === stickId) {
        let dx = t.clientX - stickOrigin.x;
        let dy = t.clientY - stickOrigin.y;
        const len = Math.hypot(dx, dy);
        if (len > STICK_RADIUS) {
          dx = (dx / len) * STICK_RADIUS;
          dy = (dy / len) * STICK_RADIUS;
        }
        stickKnob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
        move.x = dx / STICK_RADIUS;
        move.y = dy / STICK_RADIUS;
      } else if (t.identifier === lookId) {
        const dx = t.clientX - lookLast.x;
        const dy = t.clientY - lookLast.y;
        look.dx += dx;
        look.dy += dy;
        lookMoved += Math.abs(dx) + Math.abs(dy);
        lookLast.x = t.clientX;
        lookLast.y = t.clientY;
      }
    }
  }

  function onEnd(e) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (t.identifier === stickId) {
        stickId = null;
        move.x = 0;
        move.y = 0;
        move.active = false;
        stickKnob.style.transform = '';
        stickBase.classList.remove('on');
      } else if (t.identifier === lookId) {
        // 거의 움직이지 않은 짧은 탭이면 사격으로 친다
        if (lookMoved < 12 && performance.now() - lookStart < 250) {
          pressed.tapFire = true;
        }
        lookId = null;
      }
    }
  }

  /*
    부팅 시점에 터치 기기로 보이지 않아도(예: 터치 지원 노트북, 늦게 보고하는 기기)
    실제로 손가락이 닿으면 그때 켠다.
  */
  function armLazy() {
    const arm = function () {
      if (!enabled) activate();
      window.removeEventListener('touchstart', arm);
    };
    window.addEventListener('touchstart', arm, { passive: true });
  }

  function activate() {
    if (enabled) return true;
    enabled = true;
    document.body.classList.add('touch-mode');
    build();

    const opt = { passive: false };
    document.addEventListener('touchstart', onStart, opt);
    document.addEventListener('touchmove', onMove, opt);
    document.addEventListener('touchend', onEnd, opt);
    document.addEventListener('touchcancel', onEnd, opt);

    // 화면 확대/스크롤/길게눌러 메뉴 방지
    document.addEventListener('gesturestart', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => {
      if (enabled) e.preventDefault();
    });
    if (onActivate) onActivate();
    return true;
  }

  let onActivate = null;
  function init(cb) {
    onActivate = cb || null;
    if (isTouchDevice()) return activate();
    armLazy();
    return false;
  }

  /* 한 프레임에서 누적된 시점 이동량을 읽고 비운다 */
  function consumeLook() {
    const r = { dx: look.dx, dy: look.dy };
    look.dx = 0;
    look.dy = 0;
    return r;
  }

  /* 탭 신호를 읽고 비운다 */
  function consume(key) {
    if (!pressed[key]) return false;
    pressed[key] = false;
    return true;
  }

  function setVisible(v) {
    if (root) root.classList.toggle('hidden', !v);
  }

  return {
    init,
    get enabled() {
      return enabled;
    },
    move,
    buttons,
    consume,
    consumeLook,
    setVisible,
    isTouchDevice,
  };
})();
