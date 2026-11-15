// Ciervo — FSM: GRAZE (pastar) → ALERT (alerta) → FLEE (huir) → DEAD (muerto / despellejado).
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { smoothstep, distXZ } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';
import { Animal } from './Animal.js';

const DEER_STATE = { GRAZE: 'graze', ALERT: 'alert', FLEE: 'flee', DEAD: 'dead' };

function buildDeer(isBuck, rand) {
  const fur = new THREE.Color(0x8b5a32).multiplyScalar(0.85 + rand() * 0.3).getHex();
  const meshes = [];
  const root = new THREE.Group(), pose = new THREE.Group(); root.add(pose);
  const mk = (geo, parent) => { const m = new THREE.Mesh(geo, MAT.vc); m.castShadow = true; parent.add(m); meshes.push(m); return m; };
  mk(new GeoBuilder()
    .add(new THREE.BoxGeometry(0.42, 0.48, 1.15), fur, 0, 1.02, 0)
    .add(new THREE.BoxGeometry(0.36, 0.12, 0.9), 0xd8c4a0, 0, 0.78, 0)
    .add(new THREE.BoxGeometry(0.32, 0.32, 0.06), 0xeee6d6, 0, 1.04, -0.58)
    .add(new THREE.BoxGeometry(0.12, 0.2, 0.07), 0x5e3c22, 0, 1.15, -0.62, -0.3, 0, 0)
    .add(new THREE.BoxGeometry(0.44, 0.3, 0.3), fur, 0, 1.1, 0.42)
    .build(), pose);
  const neck = new THREE.Group(); neck.position.set(0, 1.15, 0.5); pose.add(neck);
  mk(new GeoBuilder().add(new THREE.BoxGeometry(0.18, 0.62, 0.22), fur, 0, 0.28, 0).build(), neck);
  const head = new THREE.Group(); head.position.y = 0.58; neck.add(head);
  const hb = new GeoBuilder()
    .add(new THREE.BoxGeometry(0.17, 0.19, 0.36), fur, 0, 0.03, 0.12)
    .add(new THREE.BoxGeometry(0.12, 0.12, 0.12), 0x3a2a20, 0, -0.01, 0.33)
    .add(new THREE.BoxGeometry(0.05, 0.03, 0.02), 0x111111, 0, 0.02, 0.4)
    .add(new THREE.ConeGeometry(0.05, 0.18, 4), fur, 0.09, 0.15, -0.02, 0, 0, -0.7)
    .add(new THREE.ConeGeometry(0.05, 0.18, 4), fur, -0.09, 0.15, -0.02, 0, 0, 0.7)
    .add(new THREE.BoxGeometry(0.03, 0.03, 0.03), 0x111111, 0.085, 0.07, 0.17)
    .add(new THREE.BoxGeometry(0.03, 0.03, 0.03), 0x111111, -0.085, 0.07, 0.17);
  if (isBuck) {
    [1, -1].forEach((s) => {
      hb.add(new THREE.CylinderGeometry(0.014, 0.02, 0.38, 4), 0xd8c8a4, 0.07 * s, 0.28, 0.0, -0.3, 0, -0.45 * s)
        .add(new THREE.CylinderGeometry(0.01, 0.014, 0.2, 4), 0xd8c8a4, 0.12 * s, 0.38, 0.08, 0.5, 0, -0.2 * s)
        .add(new THREE.CylinderGeometry(0.01, 0.014, 0.18, 4), 0xd8c8a4, 0.16 * s, 0.46, -0.04, -0.6, 0, -0.5 * s);
    });
  }
  const headMesh = mk(hb.build(), head);
  const legs = [];
  [[0.14, 0.44], [-0.14, 0.44], [0.14, -0.44], [-0.14, -0.44]].forEach(([x, z]) => {
    const leg = new THREE.Group(); leg.position.set(x, 0.84, z); pose.add(leg);
    mk(new GeoBuilder()
      .add(new THREE.BoxGeometry(0.09, 0.42, 0.11), fur, 0, -0.2, 0)
      .add(new THREE.BoxGeometry(0.06, 0.38, 0.07), 0x6e4626, 0, -0.6, 0)
      .add(new THREE.BoxGeometry(0.07, 0.06, 0.08), 0x1e1712, 0, -0.81, 0.01)
      .build(), leg);
    legs.push(leg);
  });
  const hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.95, 1.8), MAT.hitbox);
  hitbox.position.set(0, 1.1, 0.25); hitbox.visible = false; pose.add(hitbox);
  const center = new THREE.Object3D(); center.position.set(0, 1.0, 0); pose.add(center);
  return { root, pose, neck, head, headMesh, legs, hitbox, center, meshes };
}

class Deer extends Animal {
  constructor(game, herd, rand) {
    const isBuck = rand() < 0.4;
    super(game, 'deer', buildDeer(isBuck, rand), rand, { instinctMat: MAT.instinctDeer, hp: 60, deathLift: 0.22, gallopAt: 4, legAmp: 0.45 });
    this.isBuck = isBuck; this.herd = herd;
    this.spawn(herd.x, herd.z);
  }
  spawn(cx, cz) {
    const a = this.rand() * Math.PI * 2, r = this.rand() * 8;
    this.resetBody(cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    this.home.set(cx, 0, cz);
    this.setState(DEER_STATE.GRAZE);
    this.hasTarget = false; this.grazeTimer = 2 + this.rand() * 4; this.alertStartDist = 0; this.calmTime = 0; this.pendingFlee = -1;
  }
  scheduleFlee(from, delay) {
    if (!this.alive || this.state === DEER_STATE.FLEE) return;
    if (this.pendingFlee < 0 || delay < this.pendingFlee) { this.pendingFlee = delay; this.fleeFrom.copy(from); }
  }
  startFlee(from) {
    if (!this.alive) return;
    const was = this.state === DEER_STATE.FLEE;
    this.fleeFrom.copy(from); this.setState(DEER_STATE.FLEE); this.pendingFlee = -1;
    if (!was) {
      this.game.audio.playSnort(distXZ(this.position, this.game.player.position));
      this.game.wildlife.propagateFlee(this);
    }
  }
  onHurt() { this.startFlee(this.game.player.position); }
  onKilled() {
    this.game.audio.playDeerDeath(distXZ(this.position, this.game.player.position));
    this.game.wildlife.propagateFlee(this);
  }

  update(dt, ctx) {
    this.stateTime += dt;
    if (!this.alive) {
      this._updateDead(dt);
      if (this._canRespawn(ctx, CONFIG.DEER_RESPAWN_SECONDS)) {
        const far = CONFIG.HERDS.filter((h) => Math.hypot(h.x - ctx.playerPos.x, h.z - ctx.playerPos.z) > 110)
          .sort((a, b) => Math.hypot(a.x - ctx.playerPos.x, a.z - ctx.playerPos.z) - Math.hypot(b.x - ctx.playerPos.x, b.z - ctx.playerPos.z));
        if (far.length) { this.herd = far[0]; this.spawn(far[0].x, far[0].z); }
      }
      return;
    }
    const dist = ctx.dist;
    if (this.pendingFlee >= 0) { this.pendingFlee -= dt; if (this.pendingFlee < 0) this.startFlee(this.fleeFrom); }
    let targetSpeed = 0, desired = this.heading, turnRate = 3;
    this.neckTarget = 0.6; this.headTarget = 0.25;
    switch (this.state) {
      case DEER_STATE.GRAZE: {
        if (dist < ctx.noiseRadius) { this.setState(DEER_STATE.ALERT); this.alertStartDist = dist; this.calmTime = 0; break; }
        if (this.grazeTimer > 0) {
          this.grazeTimer -= dt; this.neckTarget = 2.45; this.headTarget = 1.25 + Math.sin(this.stateTime * 9) * 0.05;
        } else {
          if (!this.hasTarget || distXZ(this.position, this.target) < 1.2) {
            if (this.hasTarget && this.rand() < 0.6) { this.grazeTimer = 3 + this.rand() * 6; this.hasTarget = false; break; }
            const a = this.rand() * Math.PI * 2, r = 4 + this.rand() * 16;
            this.target.set(this.home.x + Math.cos(a) * r, 0, this.home.z + Math.sin(a) * r);
            this.hasTarget = true;
          }
          desired = Math.atan2(this.target.x - this.position.x, this.target.z - this.position.z);
          targetSpeed = 1.1;
        }
        break;
      }
      case DEER_STATE.ALERT: {
        desired = Math.atan2(ctx.playerPos.x - this.position.x, ctx.playerPos.z - this.position.z);
        turnRate = 4; this.neckTarget = 0.05; this.headTarget = 0.05;
        if (dist < 9 || (ctx.playerRunning && dist < 30) || dist < this.alertStartDist - 4) { this.startFlee(ctx.playerPos); break; }
        if (dist > ctx.noiseRadius * 1.3 + 3) this.calmTime += dt; else this.calmTime = 0;
        if (this.calmTime > 3 || (this.stateTime > 10 && dist > 15)) { this.setState(DEER_STATE.GRAZE); this.grazeTimer = 1 + this.rand() * 2; }
        break;
      }
      case DEER_STATE.FLEE: {
        const away = this._tmp.set(this.position.x - this.fleeFrom.x, 0, this.position.z - this.fleeFrom.z);
        if (away.lengthSq() < 0.01) away.set(Math.sin(this.heading), 0, Math.cos(this.heading));
        away.normalize();
        const edge = Math.max(Math.abs(this.position.x), Math.abs(this.position.z));
        if (edge > 780) { const k = smoothstep(780, 880, edge) * 1.5; away.x -= Math.sign(this.position.x) * k * (Math.abs(this.position.x) > 780 ? 1 : 0); away.z -= Math.sign(this.position.z) * k * (Math.abs(this.position.z) > 780 ? 1 : 0); }
        desired = Math.atan2(away.x, away.z) + Math.sin(this.stateTime * 1.7 + this.phase) * 0.35;
        targetSpeed = 9.5; turnRate = 5; this.neckTarget = 0.4; this.headTarget = 0.15;
        if (this.stateTime > 7 && dist > 55) {
          this.setState(DEER_STATE.GRAZE); this.home.set(this.position.x, 0, this.position.z);
          this.hasTarget = false; this.grazeTimer = 2 + this.rand() * 3;
        }
        break;
      }
    }
    this.heading = this.heading + Math.atan2(Math.sin(desired - this.heading), Math.cos(desired - this.heading)) * (1 - Math.exp(-turnRate * dt));
    this.speed += (targetSpeed - this.speed) * (1 - Math.exp(-(targetSpeed > this.speed ? 3 : 5) * dt));
    this._move(dt, 0.5);
    if (ctx.animate) this._animate(dt);
    this._applyTransform();
  }
}

export { Deer, DEER_STATE, buildDeer };
