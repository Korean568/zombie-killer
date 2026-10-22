/* =========================================================
   net.js - 멀티플레이 클라이언트

   server/ 의 Cloudflare Worker 에 WebSocket 으로 붙어
   내 위치를 보내고 다른 사람들의 위치를 받는다.
   서버 주소가 없거나 접속에 실패하면 조용히 오프라인으로 떨어진다
   (그때는 전부 봇으로 채운다).
   ========================================================= */

const NET = (function () {
  /*
    서버를 배포한 뒤 이 주소를 바꾸면 된다.
    예) 'wss://zombie-killer-match.<계정>.workers.dev'
    비워 두면 멀티플레이를 시도하지 않는다.
  */
  let SERVER = '';

  let ws = null;
  let myId = null;
  let want = false;      // 붙어 있어야 하는 상태인가 (disconnect 하면 꺼진다)
  let everOnline = false; // 한 번이라도 붙은 적이 있는가
  let roomBase = 'main';
  let retry = 0;
  let retryTimer = null;
  let beat = null;       // 화면 갱신과 상관없이 뛰는 심장박동
  let myName = '';
  let started = false;
  let needCount = 10;
  let status = 'off'; // off | connecting | online | failed
  let remotes = new Map(); // id -> {id, name, kills, s}
  let sendTimer = 0;
  let onRosterChange = null;
  let lastError = '';

  /* 서버가 계산한 좀비 */
  let zombieSnap = [];
  let zombieRemain = 0;
  let roomsLeft = 9;
  let handlers = {}; // zdie / room / hurt / cleared

  function configure(url) {
    SERVER = (url || '').trim();
  }

  let roomName = '';

  /*
    접속 절차
    1) /join 으로 빈 자리가 있는 방 이름을 받는다 (100명 차면 다음 방이 열린다)
    2) 그 방에 WebSocket 으로 붙는다
  */
  function connect(room, cb) {
    onRosterChange = cb || null;
    if (!SERVER) {
      status = 'off';
      return false;
    }
    closeSocket();       // 열려 있던 연결이 있으면 먼저 닫는다 (안 닫으면 유령이 남는다)
    want = true;
    everOnline = false;
    roomBase = room || 'main';
    retry = 0;
    tryJoin();
    return true;
  }

  function tryJoin() {
    status = 'connecting';
    if (onRosterChange) onRosterChange();

    const base = SERVER.replace(/\/$/, '');
    const httpBase = base.replace(/^ws/, 'http');

    fetch(httpBase + '/join?room=' + encodeURIComponent(roomBase))
      .then(function (r) { return r.json(); })
      .then(function (info) {
        roomName = info.room || roomBase + '-1';
        openSocket(base + '/room/' + encodeURIComponent(roomName));
      })
      .catch(function (e) {
        status = 'failed';
        lastError = '방 배정 실패';
        if (onRosterChange) onRosterChange();
        scheduleRetry();
      });
  }

  /*
    경기 도중 끊겼을 때만 다시 붙는다.
    처음부터 서버에 못 붙은 경우는 예전처럼 조용히 오프라인(봇)으로 간다.
    (중간에 붙으면 혼자 놀던 좀비와 서버 좀비가 겹쳐 버린다)
  */
  function scheduleRetry() {
    if (!want || !everOnline || retryTimer || retry >= 6) return;
    retry++;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      if (want) tryJoin();
    }, 1000 * retry);
  }

  /* 옛 소켓을 조용히 닫는다 (onclose 가 새 연결 상태를 건드리지 않게 손도 떼고) */
  function closeSocket() {
    if (!ws) return;
    const old = ws;
    ws = null;
    old.onopen = old.onmessage = old.onerror = old.onclose = null;
    try {
      old.close();
    } catch (e) {
      /* 이미 닫힘 */
    }
  }

  function openSocket(u) {
    try {
      ws = new WebSocket(u);
    } catch (e) {
      status = 'failed';
      lastError = String(e && e.message);
      if (onRosterChange) onRosterChange();
      return;
    }

    ws.onopen = function () {
      status = 'online';
      everOnline = true;
      retry = 0;
      /*
        탭을 다른 데로 넘기면 화면 갱신(requestAnimationFrame)이 멈춰
        update() 가 안 불리고, 서버는 15초 뒤 '나간 사람' 으로 보고 끊어 버린다.
        화면과 상관없이 도는 시계로 2초에 한 번 살아 있다고 알린다.
      */
      if (beat) clearInterval(beat);
      beat = setInterval(function () {
        if (!ws || ws.readyState !== 1) return;
        try {
          ws.send(JSON.stringify({ t: 'ping', at: Date.now() }));
        } catch (e) {
          /* 다음 번에 다시 */
        }
      }, 2000);
      if (onRosterChange) onRosterChange();
    };

    ws.onmessage = function (ev) {
      let m;
      try {
        m = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      if (m.t === 'welcome') {
        myId = m.id;
        myName = m.name || '';
        started = !!m.started;
        if (m.need) needCount = m.need;
        if (m.zs) zombieSnap = m.zs;
        remotes.clear();
        (m.players || []).forEach(function (p) {
          if (p.id !== myId) remotes.set(p.id, p);
        });
        if (handlers.welcome) handlers.welcome(m);
        if (onRosterChange) onRosterChange();
      } else if (m.t === 'start') {
        started = true;
        if (onRosterChange) onRosterChange();
      } else if (m.t === 'sync') {
        if (m.started) started = true;
        if (m.need) needCount = m.need;
        const seen = new Set();
        (m.players || []).forEach(function (p) {
          if (p.id === myId) return;
          seen.add(p.id);
          remotes.set(p.id, p);
        });
        // 목록에서 사라진 사람 정리
        for (const id of Array.from(remotes.keys())) {
          if (!seen.has(id)) remotes.delete(id);
        }
        if (onRosterChange) onRosterChange();
      } else if (m.t === 'z') {
        zombieSnap = m.zs || [];
        zombieRemain = m.remain || 0;
        roomsLeft = m.rooms === undefined ? roomsLeft : m.rooms;
      } else if (m.t === 'shot') {
        if (handlers.shot) handlers.shot(m);
      } else if (m.t === 'zdie') {
        if (handlers.zdie) handlers.zdie(m);
      } else if (m.t === 'room') {
        if (handlers.room) handlers.room(m);
      } else if (m.t === 'hurt') {
        if (handlers.hurt) handlers.hurt(m.d || 0);
      } else if (m.t === 'reset') {
        zombieSnap = [];
        if (handlers.reset) handlers.reset();
      } else if (m.t === 'cleared') {
        if (handlers.cleared) handlers.cleared();
      } else if (m.t === 'leave') {
        remotes.delete(m.id);
        if (onRosterChange) onRosterChange();
      }
    };

    ws.onerror = function () {
      status = 'failed';
      lastError = '연결 실패';
    };

    ws.onclose = function () {
      if (status !== 'failed') status = 'off';
      if (beat) { clearInterval(beat); beat = null; }
      ws = null;
      myId = null;
      remotes.clear();
      zombieSnap = [];
      if (onRosterChange) onRosterChange();
      scheduleRetry();
    };
  }

  function disconnect() {
    want = false;
    everOnline = false;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (beat) { clearInterval(beat); beat = null; }
    closeSocket();
    myId = null;
    started = false;
    remotes.clear();
    status = 'off';
  }

  /* 내 상태를 주기적으로 보낸다 (20Hz) */
  function update(dt, snapshot) {
    if (status !== 'online' || !ws || ws.readyState !== 1) return;
    sendTimer -= dt;
    if (sendTimer > 0) return;
    sendTimer = 0.05;
    try {
      ws.send(JSON.stringify({ t: 'state', s: snapshot }));
    } catch (e) {
      /* 다음 틱에 다시 시도 */
    }
  }

  /* 좀비를 맞췄다고 서버에 알린다 */
  function sendHit(zid, dmg, head) {
    if (status !== 'online' || !ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ t: 'hit', id: zid, d: Math.round(dmg), h: head ? 1 : 0 }));
    } catch (e) {
      /* 무시 */
    }
  }

  /* 내가 쏜 총을 남들에게도 보여 준다 (a: 총구, b: 탄착) */
  function sendShot(a, b) {
    if (status !== 'online' || !ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({
        t: 'shot',
        a: [+a.x.toFixed(2), +a.y.toFixed(2), +a.z.toFixed(2)],
        b: [+b.x.toFixed(2), +b.y.toFixed(2), +b.z.toFixed(2)],
      }));
    } catch (e) {
      /* 무시 */
    }
  }

  function forceStart() {
    if (status !== 'online' || !ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ t: 'forcestart' }));
    } catch (e) {
      /* 무시 */
    }
  }

  function on(name, fn) {
    handlers[name] = fn;
  }

  function sendKills(n) {
    if (status !== 'online' || !ws || ws.readyState !== 1) return;
    try {
      ws.send(JSON.stringify({ t: 'kill', n: n }));
    } catch (e) {
      /* 무시 */
    }
  }

  function list() {
    return Array.from(remotes.values());
  }

  return {
    configure,
    connect,
    disconnect,
    update,
    sendKills,
    sendHit,
    sendShot,
    forceStart,
    on,
    list,
    get zombies() {
      return zombieSnap;
    },
    get zombieRemain() {
      return zombieRemain;
    },
    get roomsLeft() {
      return roomsLeft;
    },
    get status() {
      return status;
    },
    get myId() {
      return myId;
    },
    get myName() {
      return myName;
    },
    get count() {
      return remotes.size;
    },
    get error() {
      return lastError;
    },
    get configured() {
      return !!SERVER;
    },
    get room() {
      return roomName;
    },
    get started() {
      return started;
    },
    get need() {
      return needCount;
    },
  };
})();
