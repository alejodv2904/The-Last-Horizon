// Caballo: modelo low-poly, FSM (IDLE / CALLED / MOUNTED) y andares procedurales
// (paso, trote, medio galope y galope) mezclados por velocidad.
// Rendimiento: 1 entidad, 9 mallas, sin físicas: solo ecuaciones de movimiento + altura del terreno.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { clamp, lerp, damp, dampAngle, wrapAngle, distXZ, smoothstep } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';
import { TrackTrail } from '../systems/HunterInstinct.js';

const HORSE_STATE = { IDLE: 'idle', CALLED: 'called', MOUNTED: 'mounted' };
const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s);
const TAU = Math.PI * 2;
// Desfase de cada pata (FL, FR, BL, BR) como fracción de ciclo para cada andar.
const GAIT_OFFSETS = { walk: [0, 0.5, 0.75, 0.25], trot: [0, 0.5, 0.5, 0], gallop: [0.4, 0.5, 0, 0.1] };

function buildHorse() {
  const COAT = 0x6b4226, DARK = 0x231710, MANE = 0x1c140e, LEG = 0x4a2e1a;
  const meshes = [];
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const body = new THREE.Group(); root.add(body);
  const mk = (geo, parent) => { const m = new THREE.Mesh(geo, MAT.vc); m.castShadow = true; parent.add(m); meshes.push(m); return m; };
  mk(new GeoBuilder()
    .add(Box(0.62, 0.72, 1.7), COAT, 0, 1.28, 0)
    .add(Box(0.66, 0.66, 0.5), COAT, 0, 1.3, 0.72)
    .add(Box(0.66, 0.68, 0.55), COAT, 0, 1.33, -0.7)
    .add(Box(0.7, 0.05, 0.85), 0x8a2a22, 0, 1.66, 0.02)
    .add(Box(0.72, 0.052, 0.12), 0xd8b46a, 0, 1.662, 0.3)
    .add(Box(0.5, 0.14, 0.62), 0x5a3a22, 0, 1.74, 0)
    .add(Box(0.42, 0.12, 0.12), 0x5a3a22, 0, 1.86, 0.26)
    .add(Cyl(0.04, 0.05, 0.14, 5), 0x4a2e1a, 0, 1.97, 0.3)
    .add(Box(0.42, 0.14, 0.1), 0x5a3a22, 0, 1.86, -0.27)
    .add(Box(0.03, 0.5, 0.06), 0x3a2414, 0.36, 1.45, 0.02)
    .add(Box(0.03, 0.5, 0.06), 0x3a2414, -0.36, 1.45, 0.02)
    .add(Box(0.1, 0.04, 0.12), 0x777070, 0.37, 1.18, 0.04)
    .add(Box(0.1, 0.04, 0.12), 0x777070, -0.37, 1.18, 0.04)
    .add(Box(0.26, 0.3, 0.32), 0x7a5a3a, 0.36, 1.42, -0.62)
    .add(Box(0.26, 0.3, 0.32), 0x7a5a3a, -0.36, 1.42, -0.62)
    .build(), body);
  const saddle = new THREE.Object3D(); saddle.position.set(0, 1.83, 0.0); body.add(saddle);

  const neck = new THREE.Group(); neck.position.set(0, 1.5, 0.85); body.add(neck);
  mk(new GeoBuilder()
    .add(Box(0.3, 1.0, 0.42), COAT, 0, 0.45, 0)
    .add(Box(0.08, 0.95, 0.14), MANE, 0, 0.5, -0.2)
    .build(), neck);
  const head = new THREE.Group(); head.position.set(0, 0.95, 0.02); neck.add(head);
  mk(new GeoBuilder()
    .add(Box(0.28, 0.3, 0.68), COAT, 0, 0.02, 0.24)
    .add(Box(0.24, 0.24, 0.2), DARK, 0, -0.02, 0.62)
    .add(Box(0.06, 0.02, 0.42), 0xe8e0d0, 0, 0.175, 0.3)
    .add(Box(0.3, 0.03, 0.04), 0x2a1a10, 0, 0.0, 0.5)
    .add(Box(0.3, 0.03, 0.04), 0x2a1a10, 0, 0.12, 0.05)
    .add(new THREE.ConeGeometry(0.05, 0.18, 4), COAT, 0.08, 0.24, -0.05)
    .add(new THREE.ConeGeometry(0.05, 0.18, 4), COAT, -0.08, 0.24, -0.05)
    .add(Box(0.03, 0.04, 0.04), 0x0a0a0a, 0.145, 0.08, 0.18)
    .add(Box(0.03, 0.04, 0.04), 0x0a0a0a, -0.145, 0.08, 0.18)
    .add(Box(0.14, 0.12, 0.12), MANE, 0, 0.2, 0.05)
    .build(), head);

  const tail = new THREE.Group(); tail.position.set(0, 1.55, -0.98); body.add(tail);
  mk(new GeoBuilder().add(Box(0.12, 0.85, 0.14), MANE, 0, -0.42, 0).build(), tail);

  const legs = [];
  [[0.2, 0.98, 0.68], [-0.2, 0.98, 0.68], [0.2, 1.0, -0.68], [-0.2, 1.0, -0.68]].forEach(([x, y, z]) => {
    const upper = new THREE.Group(); upper.position.set(x, y, z); body.add(upper);
    mk(new GeoBuilder().add(Box(0.17, 0.52, 0.22), COAT, 0, -0.26, 0).build(), upper);
    const lower = new THREE.Group(); lower.position.y = -0.52; upper.add(lower);
    mk(new GeoBuilder()
      .add(Box(0.1, 0.4, 0.12), LEG, 0, -0.2, 0)
      .add(Box(0.14, 0.09, 0.16), DARK, 0, -0.44, 0.01)
      .build(), lower);
    legs.push({ upper, lower });
  });
  return { root, body, neck, head, tail, legs, saddle, meshes };
}

class Horse {
  constructor(game, x, z) {
    this.game = game;
    this.name = 'Ceniza';
    this.model = buildHorse();
    game.scene.add(this.model.root);
    this.position = new THREE.Vector3(x, game.world.getHeightAt(x, z), z);
    this.heading = Math.PI / 2; this.speed = 0; this.phase = 0; this.pitch = 0;
    this.state = HORSE_STATE.IDLE;
    this.stamina = 100; this.exhausted = false; this.staminaDelay = 0;
    this.neckAngle = 0.55; this.headAngle = 0.3; this.grazeTimer = 3; this.grazing = false;
    this.drive = { dir: new THREE.Vector3(), moving: false, gallop: false, slow: false };
    this.tracks = new TrackTrail(14, 2.4);
    this._legPrev = [0, 0, 0, 0];
    this._avoidTimer = 0; this._avoidOffset = 0;
    this._fwd = new THREE.Vector3();
    this.highlighted = false;
  }
  get mounted() { return this.state === HORSE_STATE.MOUNTED; }

  call(playerPos) {
    if (this.mounted) return false;
    const d = distXZ(this.position, playerPos);
    if (d > CONFIG.HORSE.CALL_TELEPORT_DIST) {
      // Muy lejos: reaparece fuera de la vista (entre la niebla) y llega galopando.
      const dx = this.position.x - playerPos.x, dz = this.position.z - playerPos.z, len = Math.hypot(dx, dz) || 1;
      this.position.set(playerPos.x + dx / len * 110, 0, playerPos.z + dz / len * 110);
      this.game.world.clampToWorld(this.position);
      this.position.y = this.game.world.getHeightAt(this.position.x, this.position.z);
      this.tracks.reset();
    }
    if (d > 4) this.state = HORSE_STATE.CALLED;
    return true;
  }
  mount() { this.state = HORSE_STATE.MOUNTED; this.grazing = false; }
  dismount() { this.state = HORSE_STATE.IDLE; this.grazeTimer = 4; this.drive.moving = false; }
  setDrive(dir, moving, gallop, slow) {
    this.drive.dir.copy(dir); this.drive.moving = moving; this.drive.gallop = gallop; this.drive.slow = slow;
  }
  getSaddleWorld(out) { return this.model.saddle.getWorldPosition(out); }
  setHighlight(on) {
    if (on === this.highlighted) return;
    this.highlighted = on;
    this.model.meshes.forEach((m) => { m.material = on ? MAT.instinctHorse : MAT.vc; });
  }

  _avoid(dt) {
    this._avoidTimer -= dt;
    if (this._avoidTimer > 0) return this._avoidOffset;
    this._avoidTimer = 0.2;
    const w = this.game.world, p = this.position;
    const probe = (a) => w.isBlocked(p.x + Math.sin(this.heading + a) * 3.5, p.z + Math.cos(this.heading + a) * 3.5, 0.9);
    this._avoidOffset = 0;
    if (probe(0)) for (const a of [0.6, -0.6, 1.2, -1.2]) if (!probe(a)) { this._avoidOffset = a; break; }
    return this._avoidOffset;
  }

  update(dt) {
    const g = this.game, H = CONFIG.HORSE, player = g.player;
    let targetSpeed = 0, desired = this.heading, turnRate = 3;
    if (this.state === HORSE_STATE.MOUNTED) {
      const d = this.drive;
      if (d.moving) {
        desired = Math.atan2(d.dir.x, d.dir.z);
        const gallop = d.gallop && !this.exhausted;
        targetSpeed = d.slow ? H.WALK : gallop ? H.GALLOP : d.gallop ? H.CANTER : H.TROT;
        if (Math.abs(wrapAngle(desired - this.heading)) > 1.9 && this.speed > 4) targetSpeed = Math.min(targetSpeed, H.TROT * 0.6);
      }
      turnRate = lerp(3.4, 1.5, clamp(this.speed / H.GALLOP, 0, 1));
    } else if (this.state === HORSE_STATE.CALLED) {
      const dist = distXZ(this.position, player.position);
      desired = Math.atan2(player.position.x - this.position.x, player.position.z - this.position.z) + this._avoid(dt);
      targetSpeed = dist > 30 ? H.GALLOP * 0.85 : dist > 10 ? H.TROT : H.WALK;
      turnRate = 4;
      if (dist < 3.4) { this.state = HORSE_STATE.IDLE; targetSpeed = 0; this.grazeTimer = 5; }
    } else {
      this.grazeTimer -= dt;
      if (this.grazeTimer <= 0) { this.grazing = !this.grazing; this.grazeTimer = this.grazing ? 5 + Math.random() * 6 : 3 + Math.random() * 4; }
    }

    if (this.speed > H.CANTER + 0.5) {
      this.stamina = Math.max(0, this.stamina - H.STAMINA_DRAIN * dt); this.staminaDelay = 1.2;
      if (this.stamina <= 0) this.exhausted = true;
    } else {
      this.staminaDelay -= dt;
      if (this.staminaDelay <= 0) this.stamina = Math.min(100, this.stamina + H.STAMINA_REGEN * dt * (this.speed < 0.5 ? 1.6 : 1));
      if (this.stamina > H.EXHAUSTED_UNTIL) this.exhausted = false;
    }

    this.heading = dampAngle(this.heading, desired, turnRate, dt);
    this.speed = damp(this.speed, targetSpeed, targetSpeed > this.speed ? 1.6 : 3.5, dt);
    const w = g.world, p = this.position, ox = p.x, oz = p.z, oh = w.getHeightAt(ox, oz);
    this._fwd.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    p.x += this._fwd.x * this.speed * dt; p.z += this._fwd.z * this.speed * dt;
    if (w.pushOut(p, 0.75) && this.speed > 6) this.speed *= 0.7;
    w.clampToWorld(p);
    const nh = w.getHeightAt(p.x, p.z), horiz = Math.hypot(p.x - ox, p.z - oz);
    if (nh > oh && nh - oh > horiz * 1.2 + 0.02) { p.x = ox; p.z = oz; this.speed *= 0.3; }
    p.y = w.getHeightAt(p.x, p.z);
    const hf = w.getHeightAt(p.x + this._fwd.x * 0.9, p.z + this._fwd.z * 0.9), hb = w.getHeightAt(p.x - this._fwd.x * 0.9, p.z - this._fwd.z * 0.9);
    this.pitch = damp(this.pitch, -Math.atan2(hf - hb, 1.8), 8, dt);
    this.tracks.push(p);
    if (this.speed > 2) g.fx.impact.footprint(p.x, p.y, p.z, this.heading, 2.4, true);   // huellas de herradura (pool de decals)

    const dCam = g.camera.position.distanceTo(p);
    const visible = dCam < 260;
    this.model.root.visible = visible;
    if (visible) this._animate(dt, dCam);
    this.model.root.position.copy(p);
    this.model.root.rotation.set(this.pitch, this.heading, 0);
    this.model.root.updateMatrixWorld(true);
  }

  _animate(dt, dCam) {
    const m = this.model, s = this.speed, H = CONFIG.HORSE, t = this.game.elapsed;
    const freq = s < 0.05 ? 0 : s < H.TROT ? lerp(0.9, 1.5, s / H.TROT) : s < H.CANTER ? lerp(1.5, 1.9, (s - H.TROT) / (H.CANTER - H.TROT)) : lerp(1.9, 2.3, clamp((s - H.CANTER) / (H.GALLOP - H.CANTER), 0, 1));
    this.phase += dt * freq * TAU;
    const gallopK = smoothstep(H.TROT + 0.5, H.CANTER, s);
    const trotK = smoothstep(H.WALK + 0.3, H.TROT, s) * (1 - gallopK);
    const amp = s < 0.05 ? 0 : lerp(0.32, 0.5, trotK) + gallopK * 0.35;
    for (let i = 0; i < 4; i++) {
      const off = lerp(lerp(GAIT_OFFSETS.walk[i], GAIT_OFFSETS.trot[i], trotK), GAIT_OFFSETS.gallop[i], gallopK) * TAU;
      const ph = this.phase + off, sw = Math.sin(ph);
      const leg = m.legs[i];
      leg.upper.rotation.x = damp(leg.upper.rotation.x, -sw * amp, 20, dt);
      leg.lower.rotation.x = damp(leg.lower.rotation.x, Math.max(0, Math.sin(ph + 1.4)) * amp * (i < 2 ? 1.6 : 1.2), 20, dt);
      if (this._legPrev[i] > 0 && sw <= 0 && s > 0.4 && dCam < 70) this.game.audio.playHoof(gallopK, dCam);
      this._legPrev[i] = sw;
    }
    const moving = s > 0.05 ? 1 : 0;
    m.body.position.y = trotK * Math.abs(Math.sin(this.phase * 2)) * 0.05 + gallopK * Math.sin(this.phase) * 0.09
      + (1 - trotK - gallopK) * Math.abs(Math.sin(this.phase * 2)) * 0.02 * moving;
    m.body.rotation.x = gallopK * Math.cos(this.phase) * 0.07;
    const grazing = this.state === HORSE_STATE.IDLE && this.grazing && s < 0.2;
    const neckT = grazing ? 2.3 : moving ? lerp(0.55, 0.95, gallopK) : 0.5;
    const headT = grazing ? 1.35 + Math.sin(t * 7) * 0.04 : moving ? lerp(0.35, 0.6, gallopK) : 0.35;
    this.neckAngle = damp(this.neckAngle, neckT, 3, dt);
    this.headAngle = damp(this.headAngle, headT, 4, dt);
    m.neck.rotation.x = this.neckAngle + gallopK * Math.sin(this.phase + 1) * 0.08;
    m.head.rotation.x = this.headAngle - this.neckAngle;
    m.tail.rotation.x = 0.35 + gallopK * 0.7 + trotK * 0.2;
    m.tail.rotation.z = Math.sin(t * 1.3) * 0.15 * (1 - gallopK);
  }
}

export { Horse, HORSE_STATE };
