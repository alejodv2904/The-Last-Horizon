// Director de eventos de camino: asaltos ocasionales mientras viajas por una carretera.
//   - EMBOSCADA: 3 bandidos aparecen delante, tras una barricada de cajas, y te atacan.
//   - AUXILIO: 2 bandidos están asaltando a un viajero (manos arriba). Si los abates sin que muera, ganas Honor y una propina.
// Todo sale de un POOL creado al inicio (3 pistoleros, 1 viajero, 6 cajas en un InstancedMesh): cero asignaciones en juego.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { distXZ, clamp } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';
import { PALETTES, buildHumanoid, poseHumanoid } from '../entities/CharacterFactory.js';

const A = CONFIG.AMBUSH;
const PALS = ['bandit1', 'bandit2', 'bandit3'];
const NAMES = ['Salteador', 'Bandolero', 'Asaltante'];
const _o = new THREE.Object3D(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const rr = (a, b) => a + Math.random() * (b - a);

class AmbushDirector {
  constructor(game, bandits) {
    this.game = game; this.bandits = bandits;
    this.state = 'idle'; this.auto = true; this.timer = A.FIRST_DELAY; this.t = 0; this.kind = null; this.center = new THREE.Vector3(); this.reward = null;
    this.members = [0, 1, 2].map((i) => bandits.addGunman({ id: `amb_${i}`, name: `${NAMES[i]}`, faction: 'bandit', palette: PALS[i], x: 0, z: -2000, camp: 'ambush', active: false }));
    this.members.forEach((m) => { m.root.visible = false; });
    // viajero (humanoide lite) y cajas de la barricada
    this.trav = { model: buildHumanoid(PALETTES.traveler, false, { lite: true }), position: new THREE.Vector3(), hands: 1, thanks: 0, heading: 0 };
    this.trav.model.root.visible = false; game.scene.add(this.trav.model.root);
    const crate = new GeoBuilder().add(new THREE.BoxGeometry(0.95, 0.95, 0.95), 0x8a6a42, 0, 0.475, 0).add(new THREE.BoxGeometry(1.0, 0.08, 1.0), 0x5a4026, 0, 0.2, 0).add(new THREE.BoxGeometry(1.0, 0.08, 1.0), 0x5a4026, 0, 0.75, 0).build();
    this.crates = new THREE.InstancedMesh(crate, MAT.vc, 6); this.crates.frustumCulled = false; this.crates.castShadow = true;
    for (let i = 0; i < 6; i++) this.crates.setMatrixAt(i, _zero);
    game.scene.add(this.crates);
    this.zone = game.world.addZone(0, 0, 40); this.zone.active = false;
    this.cover = []; this.covers = [];
  }

  get radarPos() { return this.state === 'rescue' && !this.done ? this.center : null; }

  update(dt) {
    const g = this.game, p = g.player;
    if (this.state === 'rescue') this._poseTraveler();
    if (this.state === 'idle') {
      if (!this.auto || !g.started || g.mode !== 'explore') return;
      this.timer -= dt;
      if (this.timer > 0) return;
      const onRoad = g.world.gen.roadDistance(p.position.x, p.position.z) < 12, moving = (p.riding ? g.horse.speed : p.velocity.length()) > 1.5;
      if (!onRoad || !moving || this._inSafeZone(p.position)) { this.timer = 5; return; }
      if (!this._start()) this.timer = 12;
      return;
    }
    this.t += dt;
    const d = distXZ(p.position, this.center);
    const alive = this.members.filter((m) => m.active && m.alive).length;
    if (!this.done && alive === 0) {
      this.done = true; this.doneT = 0;
      if (this.kind === 'rescue') this._rescued(); else g.honor.add(g.honor.deed('ambushSurvived'), 'Emboscada superada');
    }
    if (this.done) { this.doneT += dt; if (this.doneT > 35 && d > 25) this._end(); return; }
    if (d > 175 || this.t > 420) this._end();
  }

  _inSafeZone(pos) {
    const w = this.game.world;
    if (distXZ(pos, w.town.center) < A.SAFE_RADIUS || distXZ(pos, CONFIG.TRADING_POST) < 70 || distXZ(pos, CONFIG.CAMP) < 70) return true;
    return w.banditCamps.some((c) => distXZ(pos, c.center) < 70);
  }

  _start(force = null) {
    const g = this.game, p = g.player, w = g.world;
    const heading = p.riding ? g.horse.heading : p.heading;
    for (let k = 0; k < 8; k++) {
      const ang = heading + (k === 0 ? 0 : (Math.random() - 0.5) * 0.7), dist = rr(85, 105);
      const x = p.position.x + Math.sin(ang) * dist, z = p.position.z + Math.cos(ang) * dist;
      if (Math.abs(x) > 900 || Math.abs(z) > 900 || w.gen.roadDistance(x, z) > 14 || w.getSlopeAt(x, z) < 0.86 || this._inSafeZone({ x, z })) continue;
      this.kind = force || (Math.random() < A.RESCUE_CHANCE ? 'rescue' : 'ambush');
      this._spawn(x, z, ang);
      return true;
    }
    return false;
  }

  // Inicio dirigido por el EncounterDirector en un lugar concreto (p. ej. el puente): opts = { positions, crates, center }
  begin(kind, opts) {
    if (this.state !== 'idle') return false;
    this.kind = kind; this._spawn(opts.center.x, opts.center.z, 0, opts);
    return true;
  }
  _spawn(cx, cz, ang, opts = null) {
    const g = this.game, w = g.world, p = g.player.position, toP = Math.atan2(p.x - cx, p.z - cz);
    this.state = this.kind; this.t = 0; this.done = false; this.doneT = 0;
    this.center.set(cx, w.getHeightAt(cx, cz), cz);
    this.zone.x = cx; this.zone.z = cz; this.zone.active = true; this.zone.obstacles.length = 0; this.cover.length = 0;
    const fx = Math.sin(toP), fz = Math.cos(toP), rx = Math.cos(toP), rz = -Math.sin(toP);
    const free = (x, z, r) => !w.isBlocked(x, z, r);
    const crateAt = (i, x, z, s) => {
      _o.position.set(x, w.getHeightAt(x, z), z); _o.rotation.set(0, Math.random() * 3, 0); _o.scale.setScalar(s); _o.updateMatrix(); this.crates.setMatrixAt(i, _o.matrix);
      const o = { x, z, r: 0.72 * s, h: 1.05 * s }; this.zone.obstacles.push(o); this.cover.push(o);
    };
    if (this.kind === 'ambush') {
      // 3 bandidos en abanico mirando al jugador; cada uno con una caja delante
      this.members.forEach((m, i) => {
        const side = (i - 1) * rr(7, 10), back = i === 1 ? 4 : 0;
        let x = cx + rx * side - fx * back, z = cz + rz * side - fz * back;
        if (!opts && !free(x, z, 0.8)) { x += rx * 2; z += rz * 2; }
        let mx = x + fx * 2.0, mz = z + fz * 2.0;
        if (opts) { x = opts.positions[i].x; z = opts.positions[i].z; mx = opts.crates[i].x; mz = opts.crates[i].z; }
        if (free(mx, mz, 0.6)) crateAt(i, mx, mz, 1.0); else this.crates.setMatrixAt(i, _zero);
        this._place(m, x, z);
        m.def.holdTarget = null; m.def.spot = { x, z }; m.def.look = p;
      });
      for (let i = 3; i < 6; i++) { if (opts) { this.crates.setMatrixAt(i, _zero); continue; } const x = cx + rx * (i - 4) * 2.4 + fx * 5, z = cz + rz * (i - 4) * 2.4 + fz * 5; if (free(x, z, 0.7)) crateAt(i, x, z, 0.9); else this.crates.setMatrixAt(i, _zero); }
      if (!opts) {   // emboscada de camino: te atacan enseguida. En el puente esperan quietos y atacan al verte u oírte.
        this.members.forEach((m, i) => m.alertTo(p, 2.0 + i * 0.5));
        g.ui.notify('¡Emboscada!', 'Bandidos en el camino, adelante. Busca cobertura.');
        g.ui.bark('Bandido', '¡Ahí viene! ¡Dispárenle!');
      }
    } else {
      // asalto a un viajero: 2 bandidos lo encañonan; el 3.º no se usa
      this.trav.position.copy(this.center); this.trav.heading = toP + Math.PI; this.trav.hands = 1; this.trav.thanks = 0;
      this.trav.model.root.visible = true; this.trav.model.root.position.copy(this.center); this.trav.model.root.rotation.y = this.trav.heading;
      this.members.forEach((m, i) => {
        if (i > 1) { m.active = false; m.root.visible = false; return; }
        const a = toP + (i ? 2.2 : -2.2), x = cx + Math.sin(a) * 3.2, z = cz + Math.cos(a) * 3.2;
        this._place(m, x, z);
        m.def.holdTarget = { x: cx, z: cz }; m.setState('holdup'); m.heading = Math.atan2(cx - x, cz - z);
        m.def.look = null;
      });
      for (let i = 0; i < 6; i++) this.crates.setMatrixAt(i, _zero);
      crateAt(0, cx + rx * 7 - fx * 2, cz + rz * 7 - fz * 2, 1.0); crateAt(1, cx - rx * 7 - fx * 2, cz - rz * 7 - fz * 2, 0.9);
      g.ui.notify('¡Auxilio!', 'Alguien está siendo asaltado en el camino. Ayúdalo y ganarás Honor.');
    }
    this.crates.instanceMatrix.needsUpdate = true;
    this.covers = this.cover.slice(); g.world.collectCover(cx, cz, 40, this.covers);
    g.fx.dust.burst(this.center, 12, { color: 0x9a8a70, size: 0.9, life: 1.6, speed: 1.5, up: 0.4, alpha: 0.4, grow: 3 });
  }
  _place(m, x, z) {
    m.spawn(x, z); m.active = true; m.mode = 'lethal'; m.def.x = x; m.def.z = z; m.root.visible = true; m._cc = null;
    m.hp = m.maxHp; m.lockT = 0;
  }
  _rescued() {
    const g = this.game;
    this.trav.hands = 0; this.trav.thanks = 1;
    g.honor.add(g.honor.deed('rescue'), 'Viajero rescatado');
    g.inventory.addMoney(5); g.inventory.add('tonic', 1);
    g.ui.bark('Viajero', '¡Dios lo bendiga, forastero! Tome esto, es todo lo que tengo.');
  }
  _end() {
    this.members.forEach((m) => { m._dropCover(); this.bandits.releaseToken(m); m.active = false; m.root.visible = false; m.def.holdTarget = null; });
    this.trav.model.root.visible = false;
    for (let i = 0; i < 6; i++) this.crates.setMatrixAt(i, _zero);
    this.crates.instanceMatrix.needsUpdate = true;
    this.zone.active = false; this.zone.obstacles.length = 0; this.cover.length = 0; this.covers = [];
    this.state = 'idle'; this.timer = rr(A.MIN_GAP, A.MAX_GAP);
  }
  _poseTraveler() {
    const t = this.trav, g = this.game;
    t.hands = clamp(t.hands, 0, 1);
    const alive = this.members.some((m) => m.alive && m.active);
    t.model.root.visible = distXZ(g.player.position, t.position) < 140;
    poseHumanoid(t.model, { t: g.elapsed, hands: this.kind === 'rescue' && alive ? 1 : 0, crouch: 0, gesture: this.done ? 1 : 0 });
  }
}

export { AmbushDirector };
