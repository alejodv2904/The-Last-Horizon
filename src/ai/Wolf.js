// Lobo — FSM agresiva por manadas:
// PATROL (patrulla la guarida) → ALERT (gruñe y acecha) → ATTACK (carga y muerde) → FLEE (huye) → DEAD.
// Valor ("courage"): baja con disparos cercanos, heridas y bajas de la manada; si cae, el lobo huye.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { distXZ, wrapAngle } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';
import { Animal } from './Animal.js';

const WOLF_STATE = { PATROL: 'patrol', ALERT: 'alert', ATTACK: 'attack', FLEE: 'flee', DEAD: 'dead' };

function buildWolf(rand) {
  const FUR = new THREE.Color(0x6e6a64).multiplyScalar(0.85 + rand() * 0.3).getHex();
  const BACK = 0x46423e, BELLY = 0xa8a29a, DARK = 0x1e1c1a;
  const meshes = [];
  const root = new THREE.Group(), pose = new THREE.Group(); root.add(pose);
  const mk = (geo, parent) => { const m = new THREE.Mesh(geo, MAT.vc); m.castShadow = true; parent.add(m); meshes.push(m); return m; };
  mk(new GeoBuilder()
    .add(new THREE.BoxGeometry(0.34, 0.36, 0.95), FUR, 0, 0.66, 0)
    .add(new THREE.BoxGeometry(0.3, 0.06, 0.9), BACK, 0, 0.85, -0.02)
    .add(new THREE.BoxGeometry(0.28, 0.08, 0.7), BELLY, 0, 0.49, 0.02)
    .add(new THREE.BoxGeometry(0.36, 0.42, 0.32), FUR, 0, 0.7, 0.38)
    .add(new THREE.BoxGeometry(0.38, 0.18, 0.32), BACK, 0, 0.9, 0.34)
    .build(), pose);
  const neck = new THREE.Group(); neck.position.set(0, 0.78, 0.5); pose.add(neck);
  mk(new GeoBuilder().add(new THREE.BoxGeometry(0.2, 0.32, 0.24), FUR, 0, 0.12, 0).build(), neck);
  const head = new THREE.Group(); head.position.y = 0.26; neck.add(head);
  const headMesh = mk(new GeoBuilder()
    .add(new THREE.BoxGeometry(0.22, 0.2, 0.26), FUR, 0, 0, 0.08)
    .add(new THREE.BoxGeometry(0.11, 0.1, 0.22), BELLY, 0, -0.03, 0.3)
    .add(new THREE.BoxGeometry(0.06, 0.04, 0.03), DARK, 0, 0.0, 0.42)
    .add(new THREE.ConeGeometry(0.05, 0.14, 4), BACK, 0.07, 0.14, -0.02)
    .add(new THREE.ConeGeometry(0.05, 0.14, 4), BACK, -0.07, 0.14, -0.02)
    .add(new THREE.BoxGeometry(0.03, 0.025, 0.02), 0xd8b030, 0.065, 0.04, 0.21)
    .add(new THREE.BoxGeometry(0.03, 0.025, 0.02), 0xd8b030, -0.065, 0.04, 0.21)
    .build(), head);
  const legs = [];
  [[0.11, 0.33], [-0.11, 0.33], [0.11, -0.33], [-0.11, -0.33]].forEach(([x, z]) => {
    const leg = new THREE.Group(); leg.position.set(x, 0.5, z); pose.add(leg);
    mk(new GeoBuilder()
      .add(new THREE.BoxGeometry(0.07, 0.48, 0.08), FUR, 0, -0.24, 0)
      .add(new THREE.BoxGeometry(0.08, 0.05, 0.1), DARK, 0, -0.49, 0.01)
      .build(), leg);
    legs.push(leg);
  });
  const tail = new THREE.Group(); tail.position.set(0, 0.8, -0.47); pose.add(tail);
  mk(new GeoBuilder().add(new THREE.BoxGeometry(0.09, 0.09, 0.5), FUR, 0, 0, -0.25).add(new THREE.BoxGeometry(0.07, 0.07, 0.1), DARK, 0, 0, -0.5).build(), tail);
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.75, 1.3), MAT.hitbox);
  hitbox.position.set(0, 0.62, 0.1); hitbox.visible = false; pose.add(hitbox);
  const center = new THREE.Object3D(); center.position.set(0, 0.65, 0); pose.add(center);
  return { root, pose, neck, head, headMesh, legs, tail, hitbox, center, meshes };
}

class Wolf extends Animal {
  constructor(game, pack, index, rand) {
    super(game, 'wolf', buildWolf(rand), rand, { instinctMat: MAT.instinctWolf, hp: 100, deathLift: 0.17, gallopAt: 4.5, legAmp: 0.42 });
    this.pack = pack; this.index = index;
    this.spawn();
  }
  spawn() {
    const a = this.rand() * Math.PI * 2, r = 3 + this.rand() * 6;
    this.resetBody(this.pack.x + Math.cos(a) * r, this.pack.z + Math.sin(a) * r);
    this.setState(WOLF_STATE.PATROL);
    this.courage = 1; this.attackCd = 0; this.growlCd = 0; this.lostTime = 0; this.lunge = 0;
    this.wp = this.index; this.pause = this.rand() * 3;
  }
  _waypoint(i, out) {
    const a = (i % 5) / 5 * Math.PI * 2 + this.index * 0.7;
    return out.set(this.pack.x + Math.cos(a) * 30, 0, this.pack.z + Math.sin(a) * 30);
  }
  _growl(dist) { if (this.growlCd <= 0) { this.game.audio.playGrowl(dist); this.growlCd = 2.5 + this.rand() * 1.5; } }
  _flee(from) { this.fleeFrom.copy(from); this.setState(WOLF_STATE.FLEE); }

  onGunshot(pos, dist) {
    if (!this.alive) return;
    this.courage -= dist < 40 ? 0.35 : 0.15;
    if (this.courage < 0.25) this._flee(pos);
    else if (this.state === WOLF_STATE.PATROL && dist < 110) this.setState(WOLF_STATE.ALERT);
  }
  onHurt() {
    this.courage -= 0.3;
    if (this.hp < 45 && this.courage < 0.6) this._flee(this.game.player.position);
    else this.setState(WOLF_STATE.ATTACK);
  }
  onPackmateDied() {
    if (!this.alive) return;
    this.courage -= 0.45;
    if (this.courage < 0.25) this._flee(this.game.player.position);
  }
  onKilled() { this.game.audio.playDeerDeath(distXZ(this.position, this.game.player.position) + 20); }

  update(dt, ctx) {
    this.stateTime += dt;
    if (!this.alive) {
      this._updateDead(dt);
      if (this._canRespawn(ctx, CONFIG.WOLF_RESPAWN_SECONDS) && Math.hypot(this.pack.x - ctx.playerPos.x, this.pack.z - ctx.playerPos.z) > 150) this.spawn();
      return;
    }
    const dist = ctx.dist, pp = ctx.playerPos;
    this.attackCd -= dt; this.growlCd -= dt;
    this.courage = Math.min(1, this.courage + 0.03 * dt);
    this.lunge = Math.max(0, this.lunge - dt * 2);
    const detect = (ctx.night > 0.5 ? 48 : 36) + (ctx.playerRunning ? 10 : 0);
    const toPlayer = Math.atan2(pp.x - this.position.x, pp.z - this.position.z);
    let targetSpeed = 0, desired = this.heading, turnRate = 4, tailUp = -0.6;
    this.neckTarget = 0.9; this.headTarget = 0.25;
    switch (this.state) {
      case WOLF_STATE.PATROL: {
        if (dist < detect && !ctx.playerDead) { this.setState(WOLF_STATE.ALERT); break; }
        if (this.pause > 0) { this.pause -= dt; this.neckTarget = 1.6; this.headTarget = 1.1; break; }
        const wp = this._waypoint(this.wp, this.target);
        if (distXZ(this.position, wp) < 2) { this.wp++; if (this.rand() < 0.3) this.pause = 2 + this.rand() * 3; }
        desired = Math.atan2(wp.x - this.position.x, wp.z - this.position.z);
        targetSpeed = 1.7; turnRate = 2.5;
        break;
      }
      case WOLF_STATE.ALERT: {
        this._growl(dist);
        desired = toPlayer + (this.index - 1) * 0.6;
        targetSpeed = dist > 14 ? 1.6 : 0.5;
        this.neckTarget = 1.25; this.headTarget = 0.35; tailUp = -0.15;
        if (dist > detect * 1.7) this.lostTime += dt; else this.lostTime = 0;
        if (this.lostTime > 4 || ctx.playerDead) { this.setState(WOLF_STATE.PATROL); this.lostTime = 0; break; }
        if (this.stateTime > 3.5 + this.index * 0.6 || dist < 9) this.setState(WOLF_STATE.ATTACK);
        break;
      }
      case WOLF_STATE.ATTACK: {
        this.neckTarget = 1.0; this.headTarget = 0.15; tailUp = -0.05;
        desired = toPlayer + (dist > 6 ? (this.index - 1) * 0.35 : 0);
        targetSpeed = dist > 1.8 ? 8.6 * (this.speedMul || 1) : 0.8; turnRate = 7;
        if (dist < 2.0 && this.attackCd <= 0 && !ctx.playerDead) {
          this.attackCd = 1.3; this.lunge = -0.35;
          this.game.audio.playBite();
          this.game.player.takeDamage((10 + this.rand() * 8) * (this.biteMul || 1), this.position);
        }
        if (dist > 70 || ctx.playerDead) { this.setState(WOLF_STATE.PATROL); break; }
        if (ctx.mounted && ctx.horseSpeed > 10 && dist > 25 && this.stateTime > 6) this.setState(WOLF_STATE.PATROL);
        break;
      }
      case WOLF_STATE.FLEE: {
        desired = Math.atan2(this.position.x - this.fleeFrom.x, this.position.z - this.fleeFrom.z);
        targetSpeed = 9; turnRate = 5; tailUp = -0.9; this.neckTarget = 0.7;
        if (this.stateTime > 6 && dist > 50) { this.setState(WOLF_STATE.PATROL); this.courage = Math.max(this.courage, 0.6); }
        break;
      }
    }
    this.heading += wrapAngle(desired - this.heading) * (1 - Math.exp(-turnRate * dt));
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-(targetSpeed > this.speed ? 4 : 6) * dt));
    this._move(dt, 0.4);
    if (ctx.animate) {
      this._animate(dt);
      this.model.tail.rotation.x += (tailUp - this.model.tail.rotation.x) * Math.min(1, dt * 5);
    }
    this._applyTransform();
  }
}

export { Wolf, buildWolf, WOLF_STATE };
