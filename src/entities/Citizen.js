// Ciudadano del pueblo. Humanoide "lite" (6 mallas). Estados:
//   walk/wait (recorre su ruta) · stand (charla) · greet (saluda) · alarm (te ve con el arma fuera: manos arriba)
//   cower (agachado, tras un disparo cercano) · flee (corre a una puerta) · inside (oculto en un edificio) · dead
import * as THREE from 'three';
import { clamp, damp, dampAngle, easeInOut, wrapAngle } from '../core/MathUtils.js';
import { MAT } from '../render/GeometryKit.js';
import { PALETTES, buildHumanoid, poseHumanoid } from './CharacterFactory.js';

const rr = (a, b) => a + Math.random() * (b - a);

class Citizen {
  constructor(game, life, def) {
    this.game = game; this.life = life; this.def = def; this.id = def.id; this.name = def.name; this.bold = !!def.bold;
    this.model = buildHumanoid(PALETTES[def.palette], false, { lite: true });
    this.root = this.model.root; this.root.rotation.order = 'YXZ'; game.scene.add(this.root);
    this.hitbox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.8, 0.5), MAT.hitbox);
    this.hitbox.visible = false; this.hitbox.position.y = 0.9; this.hitbox.userData.actor = this; this.root.add(this.hitbox);
    this.path = def.path.map(([x, z]) => life.town.local(x, z));
    this.face = def.face ? life.town.local(def.face[0], def.face[1]) : null;
    this.position = new THREE.Vector3(); this.seed = Math.random() * 100; this.phase = Math.random() * 10;
    this.maxHp = 30;
    this.respawn();
  }
  get alive() { return this.state !== 'dead'; }
  get hidden() { return this.state === 'inside'; }
  respawn() {
    const p0 = this.path[0], w = this.game.world;
    this.position.set(p0.x, w.getHeightAt(p0.x, p0.z), p0.z);
    this.hp = this.maxHp; this.state = this.def.mode === 'stand' ? 'stand' : 'walk'; this.timer = 0; this.pathIdx = this.path.length > 1 ? 1 : 0; this.dir = 1;
    this.heading = Math.random() * 6.28; this.speed = 0; this.deathT = 0; this.deadTime = 0; this.looted = false;
    this.hands = 0; this.hunker = 0; this.wave = 0; this.alarmT = 0; this.door = null; this.greetCd = rr(3, 10);
    this.root.rotation.set(0, this.heading, 0); this.root.visible = false; this._sync();
  }
  _sync() { this.root.position.copy(this.position); this.root.rotation.y = this.heading; }

  _step(tx, tz, speed, dt, turn = 8) {
    const p = this.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
    if (d > 0.05) {
      this.heading = dampAngle(this.heading, Math.atan2(dx, dz), turn, dt);
      this.speed = damp(this.speed, d < 0.6 ? Math.min(speed, 0.8) : speed, 8, dt);
      p.x += Math.sin(this.heading) * this.speed * dt; p.z += Math.cos(this.heading) * this.speed * dt;
      const w = this.game.world; w.pushOut(p, 0.35); p.y = w.getHeightAt(p.x, p.z);
    }
    return d;
  }

  takeDamage(amount, dir, point, source = 'player') {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) this.kill(source);
    else if (this.state !== 'flee') this.flee();
  }
  kill(source) {
    this.state = 'dead'; this.deathT = 0; this.deadTime = 0; this.speed = 0;
    this.life.onCitizenKilled(this, source);
  }
  flee() {
    if (!this.alive) return;
    this.door = this.life.pickDoor(this.position, this.life.panic > 0 ? this.life.panicPos : this.game.player.position);
    this.state = 'flee'; this.timer = 0;
  }
  cower(seconds = 8) { if (!this.alive) return; this.state = 'cower'; this.timer = seconds; }
  greet() { if (!this.alive || this.state === 'flee' || this.state === 'cower') return; this.state = 'greet'; this.timer = 2.6; }

  update(dt, c) {
    const p = this.position, g = this.game;
    this.greetCd -= dt;
    if (this.state === 'dead') {
      this.deadTime += dt;
      if (this.deathT < 1) { this.deathT = Math.min(1, this.deathT + dt * 2.2); const e = easeInOut(this.deathT); this.root.rotation.set(-e * 1.5, this.heading, 0); this.root.position.set(p.x, p.y + e * 0.14, p.z); poseHumanoid(this.model, { t: g.elapsed }); }
      return;
    }
    const toP = Math.atan2(c.pp.x - p.x, c.pp.z - p.z), dist = c.dist;
    let handsT = 0, hunkT = 0, waveT = 0, moving = false;

    // --- reacciones (por orden de prioridad) ---
    const st = this.state;
    if (st !== 'flee' && st !== 'inside' && st !== 'cower') {
      if (this.life.panic > 0 && p.distanceTo(this.life.panicPos) < 58) {
        if (this.bold && p.distanceTo(this.life.panicPos) > 10) { this.state = 'alarm'; this.alarmT = 0; }
        else if (p.distanceTo(this.life.panicPos) < 7) this.cower(rr(6, 10)); else this.flee();
      } else if (g.law.level > 0 && dist < 18 && !this.bold) { this.flee(); g.townLife.shoutBy(this, 'wanted'); }
      else if (c.weaponDrawn && dist < (this.bold ? 8 : 15) && st !== 'alarm') { this.state = 'alarm'; this.alarmT = 0; g.townLife.shoutBy(this, 'alarm'); }
    }

    switch (this.state) {
      case 'inside': this.timer -= dt; if (this.timer <= 0 && this.life.panic <= 0 && !c.weaponDrawn && g.law.level === 0) this._emerge(); break;
      case 'flee': {
        const d = this._step(this.door.x, this.door.z, 5.4, dt, 10); moving = true;
        if (d < 0.8 || this.timer > 9) { this.state = 'inside'; this.timer = rr(14, 26); this.root.visible = false; }
        this.timer += dt; hunkT = 0; break;
      }
      case 'cower': hunkT = 1; handsT = 0.9; this.timer -= dt; this.heading = dampAngle(this.heading, toP + Math.PI, 3, dt); if (this.timer <= 0) { if (this.life.panic > 0) this.flee(); else this.state = this.def.mode === 'stand' ? 'stand' : 'walk'; } break;
      case 'alarm':
        handsT = 0.75; this.heading = dampAngle(this.heading, toP, 6, dt);
        if (c.weaponDrawn && dist < 18) this.alarmT += dt; else this.alarmT -= dt * 1.5;
        if (this.alarmT > 2.4 && !this.bold) this.flee();
        else if (this.alarmT < -2) this.state = this.def.mode === 'stand' ? 'stand' : 'walk';
        break;
      case 'greet': waveT = 1; this.heading = dampAngle(this.heading, toP, 6, dt); this.timer -= dt; if (this.timer <= 0) this.state = this.def.mode === 'stand' ? 'stand' : 'walk'; break;
      case 'stand': {
        const f = this.face; if (f) this.heading = dampAngle(this.heading, Math.atan2(f.x - p.x, f.z - p.z), 3, dt);
        if (dist < 6) this.heading = dampAngle(this.heading, toP, 3, dt);
        waveT = 0.35 * (Math.sin(g.elapsed * 1.7 + this.seed) > 0.4 ? 1 : 0);
        this.speed = damp(this.speed, 0, 8, dt); break;
      }
      default: { // walk / wait
        if (this.timer > 0) { this.timer -= dt; this.speed = damp(this.speed, 0, 8, dt); if (dist < 5) this.heading = dampAngle(this.heading, toP, 3, dt); break; }
        const t = this.path[this.pathIdx];
        const d = this._step(t.x, t.z, 1.25, dt, 5); moving = true;
        if (d < 0.7 && this.def.mode === 'stand') this.state = 'stand';
        else if (d < 0.7) {
          if (this.def.mode === 'loop') this.pathIdx = (this.pathIdx + 1) % this.path.length;
          else { if (this.pathIdx === this.path.length - 1) this.dir = -1; else if (this.pathIdx === 0) this.dir = 1; this.pathIdx = clamp(this.pathIdx + this.dir, 0, this.path.length - 1); }
          this.timer = rr(1.5, 5);
        }
      }
    }
    if (!moving) this.speed = damp(this.speed, 0, 8, dt);

    this.hands = damp(this.hands, handsT, 8, dt); this.hunker = damp(this.hunker, hunkT, 8, dt); this.wave = damp(this.wave, waveT, 6, dt);
    this._sync();
    this.hitbox.scale.y = 1 - this.hunker * 0.45; this.hitbox.position.y = 0.9 * this.hitbox.scale.y;
    if (c.animate && this.state !== 'inside') {
      const run = clamp((this.speed - 3.3) / 3.7, 0, 1), cyc = 2.5 + run * 1.1;
      this.phase += dt * (this.speed / cyc) * Math.PI * 2;
      poseHumanoid(this.model, {
        phase: this.phase, speed: clamp(this.speed / 3.3, 0, 1), run, hunker: this.hunker, hands: this.hands, gesture: this.wave, t: g.elapsed + this.seed,
        headYaw: dist < 9 && (this.state === 'walk' || this.state === 'stand' || this.state === 'greet') ? clamp(wrapAngle(toP - this.heading), -0.8, 0.8) : 0,
      });
    }
  }
  _emerge() {
    const d = this.door || this.path[0];
    this.position.set(d.x, this.game.world.getHeightAt(d.x, d.z), d.z); this.state = this.def.mode === 'stand' ? 'stand' : 'walk';
    this.root.visible = true; this.pathIdx = 0; this.timer = 0;
    // vuelve a su ruta caminando desde la puerta
  }
}

export { Citizen };
