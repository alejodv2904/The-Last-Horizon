// Botín en el suelo: todos los objetos son instancias de UN InstancedMesh (1 draw call), color por tipo.
// Se recogen al pasar cerca. Caducan a los 2 minutos.
import * as THREE from 'three';
import { clamp } from '../core/MathUtils.js';

const CAP = 28;
const COLORS = { money: 0x7fe06a, ammo: 0xffa840, tonic: 0xff5a5a, proof: 0xf4f0e0, other: 0x9ad0ff };
const _o = new THREE.Object3D(), _c = new THREE.Color(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

class LootSystem {
  constructor(game) {
    this.game = game;
    const geo = new THREE.OctahedronGeometry(0.2, 0); geo.translate(0, 0.3, 0);
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff }), CAP);
    this.mesh.frustumCulled = false; this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < CAP; i++) { this.mesh.setMatrixAt(i, _zero); this.mesh.setColorAt(i, _c.set(0xffffff)); }
    game.scene.add(this.mesh);
    this.items = Array.from({ length: CAP }, () => ({ alive: false, x: 0, y: 0, z: 0, entry: null, age: 0 }));
  }
  // entries: [{ kind:'money', amount }, { kind:'item', id, n }]
  drop(pos, entries) {
    entries.forEach((entry, k) => {
      const it = this.items.find((i) => !i.alive) || this.items.reduce((a, b) => (a.age > b.age ? a : b));
      const a = k * 2.4 + Math.random(), r = 0.5 + Math.random() * 0.6, w = this.game.world;
      it.alive = true; it.entry = entry; it.age = 0;
      it.x = pos.x + Math.sin(a) * r; it.z = pos.z + Math.cos(a) * r; it.y = w.getHeightAt(it.x, it.z);
      const i = this.items.indexOf(it);
      const kind = entry.kind === 'money' ? 'money' : entry.id === 'ammo' ? 'ammo' : entry.id && entry.id.startsWith('tonic') ? 'tonic' : entry.id && entry.id.startsWith('proof') ? 'proof' : 'other';
      this.mesh.setColorAt(i, _c.set(COLORS[kind]));
    });
    this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const g = this.game, pp = g.player.position, t = g.elapsed;
    let dirty = false;
    for (let i = 0; i < CAP; i++) {
      const it = this.items[i];
      if (!it.alive) continue;
      it.age += dt; dirty = true;
      if (it.age > 120) { it.alive = false; this.mesh.setMatrixAt(i, _zero); continue; }
      const dx = pp.x - it.x, dz = pp.z - it.z;
      if (g.mode === 'explore' && dx * dx + dz * dz < 2.6 * 2.6 && Math.abs(pp.y - it.y) < 3) { this._collect(it); it.alive = false; this.mesh.setMatrixAt(i, _zero); continue; }
      _o.position.set(it.x, it.y + 0.15 + Math.sin(t * 3 + i) * 0.06, it.z); _o.rotation.set(0, t * 2 + i, 0);
      _o.scale.setScalar(clamp((120 - it.age) / 8, 0, 1)); _o.updateMatrix(); this.mesh.setMatrixAt(i, _o.matrix);
      if (Math.random() < dt * 1.5) g.fx.glow.emit(_o.position, { x: 0, y: 0.4, z: 0 }, { life: 0.8, size: 0.06, color: 0xfff0b0, gravity: -0.2 });
    }
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
  _collect(it) {
    const g = this.game, e = it.entry;
    if (e.kind === 'money') { g.inventory.addMoney(e.amount); g.ui.notify(`+$${e.amount.toFixed(2)}`, 'Botín'); g.audio.playCash(); }
    else g.inventory.add(e.id, e.n || 1);
  }
  clear() { for (let i = 0; i < CAP; i++) { this.items[i].alive = false; this.mesh.setMatrixAt(i, _zero); } this.mesh.instanceMatrix.needsUpdate = true; }
}

export { LootSystem };
