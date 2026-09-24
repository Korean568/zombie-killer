/* =========================================================
   remote.js 역할 - 다른 실제 플레이어의 아바타
   (봇은 제거됐다. 매치에는 실제 접속자만 들어온다)
   ========================================================= */

/*
  다른 실제 플레이어의 아바타.
  AI 가 없고 서버에서 받은 좌표를 따라가기만 한다.
*/
class RemotePlayer extends Ally {
  constructor(pos, rank, name, id) {
    super(pos, rank);
    this.isRemote = true;
    this.netId = id;
    this.name = name || '플레이어';
    this.kills = 0;
    this.targetX = pos.x;
    this.targetZ = pos.z;
    this.targetYaw = 0;
  }

  applyState(s) {
    if (!s) return;
    this.targetX = s.x;
    this.targetZ = s.z;
    this.targetYaw = s.y;
    if (typeof s.k === 'number') this.kills = s.k;
  }

  update(dt) {
    if (this.dead) return;
    this.animTime += dt;

    // 20Hz 로 오는 좌표라 부드럽게 따라간다
    const px = this.pos.x;
    const pz = this.pos.z;
    this.pos.x = dampen(this.pos.x, this.targetX, 12, dt);
    this.pos.z = dampen(this.pos.z, this.targetZ, 12, dt);
    this.group.position.set(this.pos.x, 0, this.pos.z);

    const moved = Math.hypot(this.pos.x - px, this.pos.z - pz) > 0.012;
    // 서버가 주는 yaw 는 플레이어 시점 기준이라 모델 정면(+Z)에 맞춰 뒤집는다
    const face = this.targetYaw + Math.PI;
    let diff = face - this.facing;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.facing += diff * clamp(10 * dt, 0, 1);
    this.group.rotation.y = this.facing;

    this._animate(moved);
  }
}
