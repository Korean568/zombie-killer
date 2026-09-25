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
    status = 'connecting';
    if (onRosterChange) onRosterChange();

    const base = SERVER.replace(/\/$/, '');
    const httpBase = base.replace(/^ws/, 'http');

    fetch(httpBase + '/join?room=' + encodeURIComponent(room || 'main'))
      .then(function (r) { return r.json(); })
      .then(function (info) {
        roomName = info.room || (room || 'main') + '-1';
        openSocket(base + '/room/' + encodeURIComponent(roomName));
      })
      .catch(function (e) {
        status = 'failed';
        lastError = '방 배정 실패';
        if (onRosterChange) onRosterChange();
      });
    return true;
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
      } else if (m.t === 'zdie') {
        if (handlers.zdie) handlers.zdie(m);
      } else if (m.t === 'room') {
        if (handlers.room) handlers.room(m);
      } else if (m.t === 'hurt') {
        if (handlers.hurt) handlers.hurt(m.d || 0);
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
      remotes.clear();
      if (onRosterChange) onRosterChange();
    };
  }

  function disconnect() {
    if (ws) {
      try {
        ws.close();
      } catch (e) {
        /* 이미 닫힘 */
      }
    }
    ws = null;
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
