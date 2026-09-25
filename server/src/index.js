/* =========================================================
   폐교 좀비 킬러 - 멀티플레이 중계 서버
   Cloudflare Worker + Durable Object

   방(Durable Object) 하나가 한 매치를 맡는다.
   클라이언트는 WebSocket 으로 자기 위치/상태를 보내고,
   서버는 그걸 같은 방의 다른 사람들에게 뿌린다.
   (권위 서버가 아니라 단순 중계다 - 발표용 게임이라 치팅 방지는 범위 밖)
   ========================================================= */

import { World } from './world.js';

const TICK_MS = 50; // 20Hz 로 상태를 뿌린다
const ZOMBIE_HZ = 10; // 좀비는 10Hz 로 계산해서 보낸다
const IDLE_MS = 15000; // 15초간 소식 없으면 끊어진 것으로 본다
const MAX_PER_ROOM = 100; // 한 방 정원. 차면 다음 방이 열린다
const MAX_SHARDS = 50; // 같은 이름으로 열 수 있는 방 개수
const MIN_TO_START = 10; // 이 인원이 모이면 시작한다

export class MatchRoom {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.players = new Map(); // id -> {ws, name, num, last, state}
    this.nextId = 1;
    this.usedNumbers = new Set(); // 방 안에서 겹치지 않는 플레이어 번호
    this.started = false;         // 한 번 시작하면 이후 들어오는 사람은 바로 합류한다
    this.timer = null;

    /* 좀비는 서버가 계산한다. 모두가 같은 좀비를 본다. */
    this.world = new World();
    this.lastTick = Date.now();
    this.zAccum = 0;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname.endsWith('/count')) {
      return json({
        players: this.players.size,
        props: this.world.props.length,
        zombies: this.world.aliveCount(),
        rooms: this.world.roomsLeft(),
      });
    }

    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('websocket 전용', { status: 426 });
    }

    if (this.players.size >= MAX_PER_ROOM) {
      // 정원 초과. 클라이언트가 다음 방으로 넘어가도록 알려 준다
      return json({ full: true, players: this.players.size }, 503);
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();

    const id = this.nextId++;
    // 실제 사람은 '플레이어 001' 처럼 방 안에서 겹치지 않는 번호를 받는다
    const num = this.allocNumber();
    const name = '플레이어 ' + String(num).padStart(3, '0');
    const entry = { ws: server, name, num, last: Date.now(), state: null, kills: 0 };
    this.players.set(id, entry);

    // 정원이 모이면 시작. 이미 시작된 방이면 새로 온 사람은 곧바로 합류한다
    if (!this.started && this.players.size >= MIN_TO_START) {
      this.started = true;
      this.broadcast({ t: 'start' });
    }

    send(server, {
      t: 'welcome',
      id,
      name,
      players: this.roster(),
      size: this.players.size,
      started: this.started,
      need: MIN_TO_START,
      rooms: this.world.roomState.map((st) => (st.triggered ? 1 : 0)),
      zs: this.world.snapshot(),
    });
    this.broadcast({ t: 'join', id, name }, id);
    this.ensureTimer();

    server.addEventListener('message', (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch (e) {
        return;
      }
      entry.last = Date.now();

      if (msg.t === 'state') {
        // 위치/자세/체력 등 한 덩어리
        entry.state = msg.s;
        entry.dead = !!msg.s.d;
      } else if (msg.t === 'kill') {
        entry.kills = msg.n | 0;
      } else if (msg.t === 'shot') {
        // 총격은 즉시 중계해서 반응이 늦지 않게
        this.broadcast({ t: 'shot', id, a: msg.a, b: msg.b }, id);
      } else if (msg.t === 'hit') {
        /*
          맞췄다는 판정은 클라이언트가 한다(반응 속도 때문).
          서버는 거리만 대충 확인하고 피해를 적용한다.
        */
        const z = this.world.zombies.find((q) => q.id === msg.id && !q.dead);
        if (z && entry.state) {
          const d = Math.hypot(entry.state.x - z.x, entry.state.z - z.z);
          if (d < 160) {
            const killed = this.world.hurt(msg.id, Math.max(0, Math.min(600, msg.d | 0)));
            if (killed) {
              entry.kills++;
              this.broadcast({
                t: 'zdie',
                id: killed.id,
                x: Math.round(killed.x * 10) / 10,
                z: Math.round(killed.z * 10) / 10,
                by: id,
                h: msg.h ? 1 : 0,
              });
            }
          }
        }
      } else if (msg.t === 'forcestart') {
        // '기다리지 않고 시작' - 인원이 안 차도 이 방을 진행 상태로 만든다
        if (!this.started) {
          this.started = true;
          this.broadcast({ t: 'start' });
        }
      } else if (msg.t === 'respawn') {
        entry.dead = false;
      } else if (msg.t === 'ping') {
        send(server, { t: 'pong', at: msg.at });
      }
    });

    const close = () => {
      this.usedNumbers.delete(num);
      this.players.delete(id);
      this.broadcast({ t: 'leave', id });
      if (!this.players.size && this.timer) {
        clearInterval(this.timer);
        this.timer = null;
      }
    };
    server.addEventListener('close', close);
    server.addEventListener('error', close);

    return new Response(null, { status: 101, webSocket: client });
  }

  /* 방 안에서 쓰지 않는 번호를 하나 고른다 (001~999) */
  allocNumber() {
    for (let i = 0; i < 400; i++) {
      const n = 1 + Math.floor(Math.random() * 999);
      if (!this.usedNumbers.has(n)) {
        this.usedNumbers.add(n);
        return n;
      }
    }
    // 거의 다 찼으면 빈 번호를 순서대로 찾는다
    for (let n = 1; n <= 999; n++) {
      if (!this.usedNumbers.has(n)) {
        this.usedNumbers.add(n);
        return n;
      }
    }
    return 0;
  }

  roster() {
    const out = [];
    for (const [id, p] of this.players) {
      out.push({ id, name: p.name, kills: p.kills, s: p.state });
    }
    return out;
  }

  ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      const now = Date.now();
      // 조용한 연결 정리
      for (const [id, p] of this.players) {
        if (now - p.last > IDLE_MS) {
          try {
            p.ws.close(1000, 'idle');
          } catch (e) {
            /* 이미 닫힘 */
          }
          this.usedNumbers.delete(p.num);
          this.players.delete(id);
          this.broadcast({ t: 'leave', id });
        }
      }
      if (!this.players.size) {
        this.started = false; // 방이 비면 처음부터 다시 모은다
        clearInterval(this.timer);
        this.timer = null;
        return;
      }
      if (!this.started && this.players.size >= MIN_TO_START) {
        this.started = true;
        this.broadcast({ t: 'start' });
      }

      /* ---- 좀비 시뮬레이션 ---- */
      const dt = Math.min(0.2, (now - this.lastTick) / 1000);
      this.lastTick = now;

      if (this.started) {
        const list = Array.from(this.players.values());

        this.world.checkRooms(list, (room, spawned) => {
          this.broadcast({ t: 'room', id: room.id, n: spawned, gym: room.gym ? 1 : 0 });
        });

        const result = this.world.update(dt, list, (target, dmg) => {
          send(target.ws, { t: 'hurt', d: dmg });
        });

        if (result === 'cleared') this.broadcast({ t: 'cleared' });

        this.zAccum += dt;
        if (this.zAccum >= 1 / ZOMBIE_HZ) {
          this.zAccum = 0;
          this.broadcast({
            t: 'z',
            zs: this.world.snapshot(),
            remain: this.world.aliveCount() + this.world.pendingCount(),
            rooms: this.world.roomsLeft(),
          });
        }
      }

      this.broadcast({
        t: 'sync',
        players: this.roster(),
        size: this.players.size,
        started: this.started,
        need: MIN_TO_START,
      });
    }, TICK_MS);
  }

  broadcast(obj, exceptId) {
    const data = JSON.stringify(obj);
    for (const [id, p] of this.players) {
      if (id === exceptId) continue;
      try {
        p.ws.send(data);
      } catch (e) {
        /* 끊긴 소켓은 타이머가 정리한다 */
      }
    }
  }
}

function send(ws, obj) {
  try {
    ws.send(JSON.stringify(obj));
  } catch (e) {
    /* 무시 */
  }
}

function json(obj, statusCode) {
  return new Response(JSON.stringify(obj), {
    status: statusCode || 200,
    headers: { 'content-type': 'application/json', 'access-control-allow-origin': '*' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('폐교 좀비 킬러 매치 서버', {
        headers: { 'access-control-allow-origin': '*' },
      });
    }

    /*
      /join?room=main
      빈 자리가 있는 방을 찾아 이름을 돌려준다.
      main-1 이 100명으로 차면 main-2 가 열리는 식이다.
    */
    if (url.pathname === '/join') {
      const base = (url.searchParams.get('room') || 'main').slice(0, 24);
      for (let i = 1; i <= MAX_SHARDS; i++) {
        const shard = base + '-' + i;
        const stub = env.MATCH.get(env.MATCH.idFromName(shard));
        let count = 0;
        try {
          const r = await stub.fetch('https://do/count');
          count = (await r.json()).players || 0;
        } catch (e) {
          count = 0;
        }
        if (count < MAX_PER_ROOM) {
          return json({ room: shard, players: count, capacity: MAX_PER_ROOM, index: i });
        }
      }
      // 전부 찼다 (5000명). 마지막 방으로 보낸다
      return json({ room: base + '-' + MAX_SHARDS, full: true, capacity: MAX_PER_ROOM });
    }

    // /room/<이름> 으로 방을 나눈다
    if (url.pathname.startsWith('/room/')) {
      const roomName = url.pathname.slice(6).split('/')[0] || 'main';
      const id = env.MATCH.idFromName(roomName);
      return env.MATCH.get(id).fetch(request);
    }

    return new Response('없는 경로', { status: 404 });
  },
};
