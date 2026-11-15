// Base común de la fauna: vida, daño, muerte, despellejado, huellas, resaltado del Instinto
// y animación procedural de 4 patas. Deer y Wolf solo implementan su FSM.
import * as THREE from 'three';
import { lerp, damp, easeInOut, distXZ } from '../core/MathUtils.js';
import { MAT } from '../render/GeometryKit.js';
import { TrackTrail } from '../systems/HunterInstinct.js';

const DEAD = 'dead';

class Animal {
  constructor(game, species, model, rand, opts) {
    this.game = game; this.species = species; this.model = model; this.rand = rand;
    this.instinctMat = opts.instinctMat; this.maxHp = opts.hp; this.deathLift = opts.deathLift;
    this.gallopAt = opts.gallopAt; this.legAmp = opts.legAmp;
    model.hitbox.userData.animal = this;
    game.scene.add(model.root);
    this.position = new THREE.Vector3(); this.home = new THREE.Vector3(); this.target = new THREE.Vector3();
    this.fleeFrom = new THREE.Vector3(); this._tmp = new THREE.Vector3();
    this.tracks = new TrackTrail(16, 2.2);
    this.highlighted = false; this.skinned = false;
    this.heading = 0; this.speed = 0; this.phase = rand() * 10; this.stateTime = 0;
    this.neckAngle = 0.5; this.headAngle = 0.2; this.neckTarget = 0.5; this.headTarget = 0.2;
    this.deathT = 0; this.deathSide = 1; this.deadTime = 0; this.hp = this.maxHp; this.state = 'idle';
  }
  get alive() { return this.state !== DEAD; }
  setState(s) { this.state = s; this.stateTime = 0; }
  getCenter(out) { return this.model.center.getWorldPosition(out); }

  resetBody(x, z) {
    const m = this.model;
    this.position.set(x, this.game.world.getHeightAt(x, z), z);
    this.home.set(x, 0, z);
    this.heading = this.rand() * Math.PI * 2; this.speed = 0;
    this.hp = this.maxHp; this.deathT = 0; this.deadTime = 0; this.skinned = false;
    m.pose.position.set(0, 0, 0); m.pose.rotation.set(0, 0, 0);
    this.tracks.reset();
    this._applyMaterials();
    m.root.visible = true;
  }
  setHighlight(on) { if (on === this.highlighted) return; this.highlighted = on; this._applyMaterials(); }
  _applyMaterials() {
    const m = this.model;
    m.meshes.forEach((mesh) => {
      mesh.material = (this.skinned && mesh !== m.headMesh) ? MAT.skinned : this.highlighted ? this.instinctMat : MAT.vc;
    });
  }
  setSkinned() { this.skinned = true; this.deadTime = 0; this._applyMaterials(); }

  takeDamage(amount, dir) {
    if (!this.alive) return;
    this.hp -= amount;
    if (this.hp <= 0) this.kill(dir); else this.onHurt(dir);
  }
  onHurt() {}
  onKilled() {}
  kill(dir) {
    if (!this.alive) return;
    this.setState(DEAD);
    this.speed = 0; this.deathT = 0; this.deadTime = 0; this.hp = 0;
    const right = Math.cos(this.heading) * dir.x - Math.sin(this.heading) * dir.z;
    this.deathSide = right >= 0 ? 1 : -1;
    this.onKilled();
    this.game.bus.emit('animal:killed', this);
  }

  // Integra la posición con colisiones y terreno.
  _move(dt, radius) {
    const w = this.game.world, p = this.position;
    p.x += Math.sin(this.heading) * this.speed * dt; p.z += Math.cos(this.heading) * this.speed * dt;
    w.pushOut(p, radius);
    w.clampToWorld(p);
    p.y = w.getHeightAt(p.x, p.z);
    this.tracks.push(p);
  }
  _applyTransform() {
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.heading;
  }
  _animate(dt) {
    const m = this.model, s = this.speed;
    this.neckAngle = damp(this.neckAngle, this.neckTarget, 5, dt);
    this.headAngle = damp(this.headAngle, this.headTarget, 6, dt);
    if (s > this.gallopAt) {
      this.phase += dt * s * 0.95;
      const a = this.legAmp * 1.9, ph = this.phase;
      m.legs[0].rotation.x = Math.sin(ph) * a; m.legs[1].rotation.x = Math.sin(ph + 0.3) * a;
      m.legs[2].rotation.x = Math.sin(ph + 2.6) * a; m.legs[3].rotation.x = Math.sin(ph + 2.9) * a;
      m.pose.position.y = Math.abs(Math.sin(ph)) * 0.2 * (this.legAmp / 0.45);
      m.pose.rotation.x = Math.cos(ph) * 0.08;
    } else {
      this.phase += dt * s * 3.2;
      const a = Math.min(s / 1.4, 1) * this.legAmp, ph = this.phase;
      m.legs[0].rotation.x = Math.sin(ph) * a; m.legs[3].rotation.x = Math.sin(ph) * a;
      m.legs[1].rotation.x = -Math.sin(ph) * a; m.legs[2].rotation.x = -Math.sin(ph) * a;
      m.pose.position.y = damp(m.pose.position.y, 0, 8, dt);
      m.pose.rotation.x = damp(m.pose.rotation.x, this.lunge || 0, 10, dt);
    }
    m.neck.rotation.x = this.neckAngle;
    m.head.rotation.x = this.headAngle - this.neckAngle;
  }
  _updateDead(dt) {
    const m = this.model;
    this.deadTime += dt;
    if (this.deathT < 1) {
      this.deathT = Math.min(1, this.deathT + dt * 2.2);
      const e = easeInOut(this.deathT);
      m.pose.rotation.set(0, 0, e * Math.PI / 2 * this.deathSide);
      m.pose.position.set(0, e * this.deathLift, 0);
      m.legs.forEach((l, i) => { l.rotation.x = lerp(l.rotation.x, (i % 2 ? 0.25 : -0.2), e); });
      m.neck.rotation.x = lerp(this.neckAngle, 1.1, e);
      m.head.rotation.x = lerp(this.headAngle - this.neckAngle, -0.3, e);
    }
  }
  // Reaparece cuando lleva tiempo muerto y el jugador está lejos (y fuera de la vista por la niebla).
  _canRespawn(ctx, seconds) {
    if (this.alive || this.deadTime < seconds) return false;
    if (!this.skinned && this.deadTime < seconds * 2.5) return false;
    return distXZ(this.position, ctx.playerPos) > 110;
  }
}

export { Animal, DEAD };
