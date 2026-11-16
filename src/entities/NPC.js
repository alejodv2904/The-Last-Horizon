// NPC de historia: Silas, Jonás Pike y, en Fase 3, los personajes del pueblo con misiones/tienda (diálogo o comercio).
import * as THREE from 'three';
import { clamp, damp, wrapAngle, dampAngle, distXZ } from '../core/MathUtils.js';
import { makeMarkerTexture } from '../render/GeometryKit.js';
import { PALETTES, buildHumanoid, poseHumanoid } from './CharacterFactory.js';

let SHARED_MARKERS = null;   // las texturas de los iconos se crean una sola vez para todos los PNJ
const sharedMarkers = () => (SHARED_MARKERS ||= {
  available: makeMarkerTexture('!', '#e8c25a'), ready: makeMarkerTexture('!', '#ffffff'), shop: makeMarkerTexture('$', '#9fd08a'),
});

class NPC {
  constructor(game, cfg) {
    this.game = game; this.id = cfg.id;
    this.name = game.story.npcs[cfg.id].name;
    this.interaction = cfg.interaction; this.shopId = cfg.shopId || null;
    this.viewDist = cfg.viewDist || 250; this.active = true;
    this.model = buildHumanoid(PALETTES[cfg.palette], false, { lite: !!cfg.lite });
    this.root = this.model.root; game.scene.add(this.root);
    this.position = new THREE.Vector3(cfg.x, game.world.getHeightAt(cfg.x, cfg.z), cfg.z);
    this.root.position.copy(this.position);
    this.baseHeading = Math.atan2(cfg.faceX - cfg.x, cfg.faceZ - cfg.z);
    this.heading = this.baseHeading; this.talking = false; this.gesture = 0; this.hands = 0;
    this.markers = sharedMarkers();
    this.marker = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.markers.available, depthWrite: false, fog: false, transparent: true }));
    this.marker.scale.set(0.5, 0.5, 1); this.root.add(this.marker);
    this.obstacle = { x: cfg.x, z: cfg.z, r: 0.4 };
    game.world.staticObstacles.push(this.obstacle);
    // Fase 5B: acompañantes que siguen al jugador (escoltas, aliados de combate)
    this.follow = !!cfg.follow; this.followDist = cfg.followDist || 3.4; this.speed = 0; this.phase = 0; this.moveHeading = this.heading;
  }
  // Retira al PNJ del mundo (libera mallas y obstáculo de colisión).
  dispose() {
    const g = this.game, i = g.world.staticObstacles.indexOf(this.obstacle); if (i >= 0) g.world.staticObstacles.splice(i, 1);
    g.scene.remove(this.root); this.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.isSprite) o.material.dispose(); });
  }
  _updateFollow(dt) {
    const g = this.game, p = g.player.position, w = g.world, pos = this.position;
    const dx = p.x - pos.x, dz = p.z - pos.z, d = Math.hypot(dx, dz);
    if (d > 60) {   // se quedó muy atrás: reaparece detrás del jugador, fuera de cuadro
      const h = g.player.riding ? g.horse.heading : g.player.heading;
      pos.x = p.x - Math.sin(h) * 9 + Math.cos(h) * ((this.index || 1) % 2 ? 2 : -2); pos.z = p.z - Math.cos(h) * 9; this.speed = 0;
    }
    const want = d > this.followDist + 0.8 ? Math.min(g.player.riding ? 9 : 5.8, (d - this.followDist) * 1.5 + 1.2) : 0;
    this.speed = damp(this.speed, want, 5, dt);
    if (this.speed > 0.05) {
      this.moveHeading = dampAngle(this.moveHeading, Math.atan2(dx, dz), 7, dt);
      pos.x += Math.sin(this.moveHeading) * this.speed * dt; pos.z += Math.cos(this.moveHeading) * this.speed * dt;
      w.pushOut(pos, 0.4); w.clampToWorld(pos);
    }
    pos.y = w.getHeightAt(pos.x, pos.z);
    this.phase += dt * (this.speed / (this.speed > 4 ? 3.4 : 2.5)) * Math.PI * 2;
    this.obstacle.x = pos.x; this.obstacle.z = pos.z;
    this.root.position.copy(pos);
  }
  getMarker() { return this.interaction === 'shop' ? 'shop' : (this.game.campaign && this.game.campaign.getMarkerFor(this.id)) || this.game.missions.getMarkerFor(this.id); }
  // El PNJ se muda (p. ej. Tomás a la celda) o desaparece del pueblo.
  moveTo(x, z, faceX, faceZ) {
    this.position.set(x, this.game.world.getHeightAt(x, z), z); this.root.position.copy(this.position);
    this.baseHeading = Math.atan2(faceX - x, faceZ - z); this.heading = this.baseHeading;
    this.obstacle.x = x; this.obstacle.z = z;
  }
  setFollow(on) { this.follow = on; if (!on) { this.speed = 0; this.baseHeading = this.heading; } }
  setActive(on) { this.active = on; this.obstacle.r = on ? 0.4 : 0; if (!on) this.root.visible = false; }
  update(dt) {
    if (!this.active) { this.root.visible = false; return; }
    const g = this.game, p = g.player.position, d = distXZ(p, this.position);
    this.root.visible = d < this.viewDist;
    if (!this.root.visible) return;
    const toPlayer = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    const following = this.follow && !this.talking;
    if (following) this._updateFollow(dt);
    const engaged = this.talking || d < 7;
    this.heading = following ? (this.speed > 0.3 ? this.moveHeading : dampAngle(this.heading, toPlayer, 3, dt)) : dampAngle(this.heading, engaged ? toPlayer : this.baseHeading, 3, dt);
    this.root.rotation.y = this.heading;
    this.gesture = damp(this.gesture, this.talking ? 1 : 0, 4, dt);
    // Fase 3: si sacas el arma cerca, el PNJ levanta las manos
    const scared = g.townLife && !this.talking && g.townLife.weaponDrawn() && d < 12;
    this.hands = damp(this.hands, scared ? 0.7 : 0, 6, dt);
    poseHumanoid(this.model, { t: g.elapsed + this.position.x, phase: this.phase, speed: Math.min(1, this.speed / 3.3), run: Math.max(0, Math.min(1, (this.speed - 3.3) / 3)), gesture: this.gesture, hands: this.hands, headYaw: clamp(wrapAngle(toPlayer - this.heading), -0.8, 0.8) * (engaged ? 1 : 0) });
    const m = this.getMarker();
    this.marker.visible = !!m && g.mode !== 'dialogue' && g.mode !== 'shop' && d < 90;
    if (m) this.marker.material.map = this.markers[m];
    this.marker.position.y = 2.35 + Math.sin(g.elapsed * 2.5) * 0.06;
  }
}

export { NPC };
