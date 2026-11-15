// Gestor de encuentros aleatorios del camino (mundo vivo). Solo hay UN encuentro activo y un enfriamiento entre ellos.
//   · Viajero mordido por una serpiente  → dale un tónico: Honor + recompensa futura en la tienda de Hattie.
//   · Emboscada en el puente             → bandidos a ambos lados del arroyo (delegada en AmbushDirector).
//   · Prisionero escapado                → dispara a los grilletes (¿inocente o culpable?): Honor y ubicación de un alijo.
//   · Emboscada / asalto a viajero       → eventos genéricos de AmbushDirector sobre cualquier camino.
//
// CICLO DE VIDA SIN OBJETOS HUÉRFANOS: los actores (2 personas, cadenas, hitboxes) y todas las mallas se crean UNA vez
// en el constructor y se reutilizan. start() solo coloca y muestra; end() oculta, apaga colisiones, vacía referencias y
// reinicia el enfriamiento. No hay setTimeout, ni listeners por evento, ni add/remove de nodos de escena en juego.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { clamp, distXZ, dampAngle } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';
import { PALETTES, buildHumanoid, poseHumanoid } from '../entities/CharacterFactory.js';

const E = CONFIG.ENCOUNTERS;
const rr = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];

class EncounterDirector {
  constructor(game, data) {
    this.game = game; this.data = data;
    this.active = null; this.timer = E.FIRST_DELAY; this.bridgeCd = 0; this.pendingShopReward = false; this.count = 0;
    const mk = (palette) => {
      const model = buildHumanoid(PALETTES[palette], false, { lite: true });
      model.root.visible = false; model.root.rotation.order = 'YXZ'; game.scene.add(model.root);
      return { model, root: model.root, pos: new THREE.Vector3(), heading: 0, speed: 0, phase: 0 };
    };
    this.traveler = mk('traveler'); this.prisoner = mk('tomas');
    // grilletes: cadena visual + dos cajas de impacto (grilletes y cuerpo), creadas una vez
    const chain = new THREE.Mesh(new GeoBuilder().add(new THREE.BoxGeometry(0.2, 0.05, 0.05), 0x2a2a2e, 0, 0, 0).add(new THREE.BoxGeometry(0.08, 0.1, 0.08), 0x3a3a40, -0.14, 0, 0).add(new THREE.BoxGeometry(0.08, 0.1, 0.08), 0x3a3a40, 0.14, 0, 0).build(), MAT.vcDouble);
    chain.position.set(0, 0.06, 0.4); this.prisoner.model.torso.add(chain); this.chain = chain;
    this.shackleBox = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.4, 0.4), MAT.hitbox); this.shackleBox.visible = false; this.shackleBox.position.set(0, 0.08, 0.4);
    this.bodyBox = new THREE.Mesh(new THREE.BoxGeometry(0.6, 1.75, 0.5), MAT.hitbox); this.bodyBox.visible = false; this.bodyBox.position.y = 0.9;
    this.prisoner.model.torso.add(this.shackleBox); this.prisoner.root.add(this.bodyBox);
    this.shackleTarget = { alive: true, takeDamage: (a, d, p, src) => { if (src === 'player') this._prisonerShot('shackle', p); } };
    this.bodyTarget = { alive: true, takeDamage: (a, d, p, src) => { if (src === 'player') this._prisonerShot('body', p); } };
    this.shackleBox.userData.actor = this.shackleTarget; this.bodyBox.userData.actor = this.bodyTarget;
    this.hitboxes = [];   // se llena solo mientras el prisionero está encadenado
    game.bandits.ambush.auto = false;   // este gestor decide cuándo ocurre cada evento
  }

  get radarPos() { const a = this.active; return a && (a.type === 'snake' || a.type === 'prisoner') && !a.over ? a.pos : null; }

  /* ---------------- selección y colocación ---------------- */
  _inSafe(x, z) {
    const w = this.game.world;
    if (distXZ({ x, z }, w.town.center) < E.SAFE_TOWN || distXZ({ x, z }, CONFIG.CAMP) < 75 || distXZ({ x, z }, CONFIG.TRADING_POST) < 60) return true;
    const b = w.bridge.center; return distXZ({ x, z }, b) < 45;
  }
  update(dt) {
    const g = this.game, p = g.player;
    this._pose(dt);
    if (this.active) { this._tick(dt); return; }
    if (!g.started || g.mode !== 'explore') return;
    this.bridgeCd = Math.max(0, this.bridgeCd - dt);
    this.timer -= dt;
    if (this.timer > 0) return;
    const w = g.world, speed = p.riding ? g.horse.speed : p.velocity.length();
    if (g.bandits.ambush.state !== 'idle' || g.bandits.hostileNear(p.position, 90) || !p.riding || speed < 2 || w.gen.roadDistance(p.position.x, p.position.z) > 11) { this.timer = 4; return; }
    // puente: si te acercas por el camino al pueblo, a veces te espera una emboscada
    const b = w.bridge.center, db = distXZ(p.position, b), heading = g.horse.heading;
    const toB = Math.atan2(b.x - p.position.x, b.z - p.position.z);
    if (this.bridgeCd <= 0 && db < 150 && db > 95 && Math.cos(heading - toB) > 0.7 && w.gen.townRoadDistance(p.position.x, p.position.z) < 11) {
      if (Math.random() < 0.7) { this._startBridge(); return; }
      this.bridgeCd = 240; this.timer = 6; return;
    }
    if (this._inSafe(p.position.x, p.position.z)) { this.timer = 6; return; }
    const onTown = w.gen.townRoadDistance(p.position.x, p.position.z) < 11;
    const bag = onTown ? [['snake', 25], ['prisoner', 20], ['ambush', 30], ['rescue', 15]] : [['ambush', 65], ['rescue', 35]];
    let r = Math.random() * bag.reduce((s, [, w2]) => s + w2, 0), kind = bag[0][0];
    for (const [k, w2] of bag) { if ((r -= w2) <= 0) { kind = k; break; } }
    if (!this._start(kind)) this.timer = 12;
  }
  _spot(minD = 80, maxD = 100) {
    const g = this.game, p = g.player, w = g.world, h = g.horse.heading;
    for (let k = 0; k < 8; k++) {
      const a = h + (k ? (Math.random() - 0.5) * 0.5 : 0), d = rr(minD, maxD), x = p.position.x + Math.sin(a) * d, z = p.position.z + Math.cos(a) * d;
      if (Math.abs(x) > 900 || Math.abs(z) > 900 || w.gen.townRoadDistance(x, z) > 5 || this._inSafe(x, z)) continue;
      return { x, z, a };
    }
    return null;
  }
  _start(kind) {
    const g = this.game;
    if (kind === 'ambush' || kind === 'rescue') {
      if (!g.bandits.ambush._start(kind)) return false;
      this.active = { type: kind === 'ambush' ? 'road' : 'rescue', t: 0 }; this.count++; return true;
    }
    const s = this._spot(); if (!s) return false;
    const w = g.world, side = Math.random() < 0.5 ? -1 : 1, lx = Math.cos(s.a) * side * 3.3, lz = -Math.sin(s.a) * side * 3.3;
    const x = s.x + lx, z = s.z + lz;
    if (kind === 'snake') {
      const P = this.traveler; P.pos.set(x, w.getHeightAt(x, z), z); P.heading = s.a + Math.PI + (Math.random() - 0.5);
      P.root.visible = true; this._sync(P);
      this.active = { type: 'snake', t: 0, pos: P.pos, name: pick(this.data.snake.names), helped: false, over: false, cryT: 0, collapsed: false, endT: 0 };
    } else {
      const P = this.prisoner; P.pos.set(x, w.getHeightAt(x, z), z); P.heading = s.a + Math.PI;
      P.root.visible = true; P.root.rotation.set(0, P.heading, 0); P.root.position.copy(P.pos);
      this.chain.visible = true; this.hitboxes = [this.shackleBox, this.bodyBox];
      this.active = { type: 'prisoner', t: 0, pos: P.pos, state: 'chained', innocent: Math.random() < 0.6, cryT: 0, over: false, endT: 0, runDir: s.a + 0.3 };
    }
    g.fx.dust.burst(this.active.pos, 8, { color: 0x9a8a70, size: 0.8, life: 1.4, speed: 1.2, up: 0.4, alpha: 0.35, grow: 3 });
    g.ui.notify(kind === 'snake' ? '¡Alguien pide ayuda!' : '¡Voces en el camino!', kind === 'snake' ? 'Un viajero yace junto al camino.' : 'Alguien encadenado grita junto al camino.');
    this.count++;
    return true;
  }
  _startBridge() {
    const g = this.game, br = g.world.bridge, p = g.player.position;
    const side = Math.sign((p.x - br.center.x) * br.dir.x + (p.z - br.center.z) * br.dir.z) || 1;
    const rd = br.dir, ly = br.lateral;
    const at = (a, l) => ({ x: br.center.x - rd.x * side * a + ly.x * l, z: br.center.z - rd.z * side * a + ly.z * l });
    const positions = [at(11, 3.2), at(2, 16), at(2, -16)];
    const crates = [at(9, 2.2), at(9, -2.2), at(0, 12)];
    if (!g.bandits.ambush.begin('ambush', { positions, crates, center: br.center })) { this.bridgeCd = 120; return; }
    this.bridgeCd = 300; this.active = { type: 'bridge', t: 0 };
    g.ui.bark('Bandido', this.data.bridge.cry); this.count++;
  }

  /* ---------------- ciclo de vida ---------------- */
  _tick(dt) {
    const a = this.active, g = this.game, d = distXZ(g.player.position, a.pos || g.world.bridge.center);
    a.t += dt;
    if (a.type === 'road' || a.type === 'rescue' || a.type === 'bridge') {
      if (g.bandits.ambush.state === 'idle') this.end();
      return;
    }
    if (a.type === 'snake') {
      const P = this.traveler;
      if (!a.helped && !a.collapsed) {
        a.cryT -= dt; if (a.cryT <= 0 && d < 45) { a.cryT = 7; g.ui.bark(a.name, pick(this.data.snake.cry)); }
        if (a.t > 200) { a.collapsed = true; a.endT = 0; }
      }
      if (a.helped || a.collapsed) { a.endT += dt; if (a.endT > (a.helped ? 16 : 25) && d > 25) { this.end(); return; } }
      if (d > 190) this.end();
      P.heading = dampAngle(P.heading, Math.atan2(g.player.position.x - P.pos.x, g.player.position.z - P.pos.z), 2, dt);
    } else if (a.type === 'prisoner') {
      const P = this.prisoner, cfg = this.data.prisoner;
      if (a.state === 'chained') {
        a.cryT -= dt; if (a.cryT <= 0 && d < 50) { a.cryT = 8; g.ui.bark(cfg.name, pick(a.innocent ? cfg.innocentCry : cfg.guiltyCry)); }
        P.heading = dampAngle(P.heading, Math.atan2(g.player.position.x - P.pos.x, g.player.position.z - P.pos.z), 2, dt);
        if (a.t > 420) a.state = 'abandoned';
      } else if (a.state === 'freed') {   // huye corriendo por el camino
        a.endT += dt; P.speed = 5.2; P.heading = dampAngle(P.heading, a.runDir, 4, dt);
        P.pos.x += Math.sin(P.heading) * P.speed * dt; P.pos.z += Math.cos(P.heading) * P.speed * dt; P.pos.y = g.world.getHeightAt(P.pos.x, P.pos.z);
        if (a.endT > 7) { this.end(); return; }
      } else { a.endT += dt; if (a.endT > 20 && d > 25) { this.end(); return; } }
      if (d > 190 || a.state === 'abandoned') this.end();
    }
  }
  end() {
    const g = this.game;
    this.active = null; this.hitboxes = []; this.timer = rr(E.MIN_GAP, E.MAX_GAP);
    for (const P of [this.traveler, this.prisoner]) { P.root.visible = false; P.speed = 0; P.root.rotation.set(0, 0, 0); }
    this.shackleBox.visible = false; this.chain.visible = true;
  }
  _sync(P) { P.root.position.copy(P.pos); P.root.rotation.set(0, P.heading, 0); }
  _pose(dt) {
    const a = this.active, g = this.game; if (!a) return;
    if (a.type === 'snake') {
      const P = this.traveler; this._sync(P);
      const down = !a.helped; if (a.collapsed) P.root.rotation.set(-1.45, P.heading, 0);
      P.root.visible = distXZ(g.player.position, P.pos) < 160;
      poseHumanoid(P.model, { t: g.elapsed, sit: a.collapsed ? 0 : down ? 1 : 0, gesture: a.collapsed ? 0 : 1, phase: 0, speed: 0 });
    } else if (a.type === 'prisoner') {
      const P = this.prisoner, run = a.state === 'freed';
      if (a.state !== 'dead') { P.root.position.copy(P.pos); P.root.rotation.set(0, P.heading, 0); }
      P.root.visible = distXZ(g.player.position, P.pos) < 160;
      if (a.state === 'dead') { P.root.rotation.set(-1.45, P.heading, 0); P.root.position.set(P.pos.x, P.pos.y + 0.12, P.pos.z); }
      P.phase += dt * (P.speed / 3) * Math.PI * 2;
      poseHumanoid(P.model, { t: g.elapsed, bound: a.state === 'chained' ? 1 : 0, phase: P.phase, speed: run ? 1 : 0, run: run ? 0.8 : 0 });
      this.chain.visible = a.state === 'chained';
    }
  }

  /* ---------------- interacción y disparos ---------------- */
  getInteraction(pos) {
    const a = this.active, g = this.game;
    if (!a || a.type !== 'snake' || a.helped || a.collapsed || distXZ(pos, a.pos) > 2.9) return null;
    const has = g.inventory.count('tonic') + g.inventory.count('tonic_strong') > 0;
    return { prompt: has ? `Darle un tónico a ${a.name}` : `${a.name} necesita un tónico (no tienes)`, action: () => this._help() };
  }
  _help() {
    const g = this.game, a = this.active, c = this.data.snake;
    if (!a || a.helped) return;
    const id = g.inventory.count('tonic') ? 'tonic' : g.inventory.count('tonic_strong') ? 'tonic_strong' : null;
    if (!id) { g.ui.notify('Sin tónicos', c.noTonic); return; }
    g.inventory.remove(id, 1, true); a.helped = true; a.endT = 0; this.pendingShopReward = true;
    g.honor.add(c.honor, 'Viajero salvado'); g.audio.playDrink(); g.ui.bark(a.name, c.thanks);
  }
  getHitboxes() {
    if (!this.hitboxes.length) return this.hitboxes;
    for (const h of this.hitboxes) h.updateWorldMatrix(true, false);
    return this.hitboxes;
  }
  _prisonerShot(part, point) {
    const g = this.game, a = this.active, c = this.data.prisoner;
    if (!a || a.type !== 'prisoner' || a.state !== 'chained') return;
    this.hitboxes = [];
    if (part === 'shackle') {
      a.state = 'freed'; a.endT = 0;
      g.fx.glow.burst(point || a.pos, 12, { color: 0xffc070, size: 0.06, life: 0.4, speed: 4, up: 1, gravity: 9 }); g.audio.playItem();
      g.honor.add(a.innocent ? c.honorInnocent : c.honorGuilty, a.innocent ? 'Liberaste a un inocente' : 'Liberaste a un fugitivo');
      const t = g.treasure.reveal();
      if (t) g.ui.bark(c.name, c.freed); else { g.inventory.addMoney(10); g.ui.bark(c.name, c.freedNoStash); }
    } else {
      a.state = 'dead'; a.endT = 0; g.honor.add(c.honorKilled, 'Ejecutaste a un prisionero');
      g.fx.dust.burst(point || a.pos, 10, { color: 0x8a1a12, size: 0.09, life: 0.7, speed: 2.2, up: 1.2, gravity: 9, alpha: 0.95 });
    }
  }
  toJSON() { return { shopReward: this.pendingShopReward }; }
  fromJSON(d) { if (d) this.pendingShopReward = !!d.shopReward; }
}

export { EncounterDirector };
