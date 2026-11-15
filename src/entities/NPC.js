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
  }
  getMarker() { return this.interaction === 'shop' ? 'shop' : this.game.missions.getMarkerFor(this.id); }
  // El PNJ se muda (p. ej. Tomás a la celda) o desaparece del pueblo.
  moveTo(x, z, faceX, faceZ) {
    this.position.set(x, this.game.world.getHeightAt(x, z), z); this.root.position.copy(this.position);
    this.baseHeading = Math.atan2(faceX - x, faceZ - z); this.heading = this.baseHeading;
    this.obstacle.x = x; this.obstacle.z = z;
  }
  setActive(on) { this.active = on; this.obstacle.r = on ? 0.4 : 0; if (!on) this.root.visible = false; }
  update(dt) {
    if (!this.active) { this.root.visible = false; return; }
    const g = this.game, p = g.player.position, d = distXZ(p, this.position);
    this.root.visible = d < this.viewDist;
    if (!this.root.visible) return;
    const toPlayer = Math.atan2(p.x - this.position.x, p.z - this.position.z);
    const engaged = this.talking || d < 7;
    this.heading = dampAngle(this.heading, engaged ? toPlayer : this.baseHeading, 3, dt);
    this.root.rotation.y = this.heading;
    this.gesture = damp(this.gesture, this.talking ? 1 : 0, 4, dt);
    // Fase 3: si sacas el arma cerca, el PNJ levanta las manos
    const scared = g.townLife && !this.talking && g.townLife.weaponDrawn() && d < 12;
    this.hands = damp(this.hands, scared ? 0.7 : 0, 6, dt);
    poseHumanoid(this.model, { t: g.elapsed + this.position.x, gesture: this.gesture, hands: this.hands, headYaw: clamp(wrapAngle(toPlayer - this.heading), -0.8, 0.8) * (engaged ? 1 : 0) });
    const m = this.getMarker();
    this.marker.visible = !!m && g.mode !== 'dialogue' && g.mode !== 'shop' && d < 90;
    if (m) this.marker.material.map = this.markers[m];
    this.marker.position.y = 2.35 + Math.sin(g.elapsed * 2.5) * 0.06;
  }
}

export { NPC };
