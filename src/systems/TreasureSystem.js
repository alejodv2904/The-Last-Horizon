// Alijos enterrados (data/world.json). Se revelan por pistas de los compañeros o por el prisionero liberado.
// Un solo InstancedMesh para todos los cofres; un cofre solo es visible si está revelado y sin recoger.
import * as THREE from 'three';
import { distXZ } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';

const rr = (a, b) => a + Math.random() * (b - a);
const _o = new THREE.Object3D(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

class TreasureSystem {
  constructor(game, list) {
    this.game = game;
    this.items = list.map((t) => ({ ...t, revealed: false, collected: false, y: game.world.getHeightAt(t.x, t.z) }));
    const geo = new GeoBuilder().add(new THREE.BoxGeometry(0.85, 0.42, 0.58), 0x6a4a2c, 0, 0.21, 0).add(new THREE.BoxGeometry(0.9, 0.18, 0.62), 0x7a5a38, 0, 0.5, 0, 0.12, 0, 0)
      .add(new THREE.BoxGeometry(0.08, 0.44, 0.62), 0x2c2c30, -0.28, 0.22, 0).add(new THREE.BoxGeometry(0.08, 0.44, 0.62), 0x2c2c30, 0.28, 0.22, 0).add(new THREE.BoxGeometry(0.1, 0.1, 0.06), 0xd8b040, 0, 0.42, 0.31).build();
    this.mesh = new THREE.InstancedMesh(geo, MAT.vc, Math.max(1, this.items.length)); this.mesh.frustumCulled = false; this.mesh.castShadow = true;
    for (let i = 0; i < this.items.length; i++) this.mesh.setMatrixAt(i, _zero);
    game.scene.add(this.mesh);
    this._sp = 0;
  }
  get unrevealed() { return this.items.filter((t) => !t.revealed && !t.collected); }
  _show(i) {
    const t = this.items[i];
    _o.position.set(t.x, t.y - 0.08, t.z); _o.rotation.set(0.05, (i * 2.1) % 6.28, 0.04); _o.scale.setScalar(1); _o.updateMatrix(); this.mesh.setMatrixAt(i, _o.matrix); this.mesh.instanceMatrix.needsUpdate = true;
  }
  reveal(pickIndex = null) {
    const free = this.items.map((t, i) => i).filter((i) => !this.items[i].revealed && !this.items[i].collected);
    if (!free.length) return null;
    const i = pickIndex !== null && free.includes(pickIndex) ? pickIndex : free[Math.floor(Math.random() * free.length)];
    this.items[i].revealed = true; this._show(i);
    this.game.ui.notify('Alijo localizado', `${this.items[i].name}: marcado en tu mapa (M).`);
    return this.items[i];
  }
  nearest(pos, r) {
    let best = null, bd = r;
    this.items.forEach((t, i) => { if (!t.revealed || t.collected) return; const d = distXZ(t, pos); if (d < bd) { bd = d; best = i; } });
    return best;
  }
  getInteraction(pos) {
    const i = this.nearest(pos, 2.6);
    return i === null ? null : { prompt: 'Abrir el alijo enterrado', action: () => this.collect(i) };
  }
  collect(i) {
    const g = this.game, t = this.items[i]; if (t.collected) return;
    t.collected = true; this.mesh.setMatrixAt(i, _zero); this.mesh.instanceMatrix.needsUpdate = true;
    const money = Math.round(rr(t.money[0], t.money[1]) * 100) / 100;
    g.inventory.addMoney(money); g.ui.notify(`+$${money.toFixed(2)}`, t.name); g.audio.playCash();
    Object.entries(t.items || {}).forEach(([id, n]) => g.inventory.add(id, n));
    g.fx.glow.burst({ x: t.x, y: t.y + 0.6, z: t.z }, 14, { color: 0xffd870, size: 0.09, life: 0.9, speed: 2, up: 1.4, gravity: 3 });
  }
  update(dt) {
    this._sp -= dt;
    if (this._sp > 0) return;
    this._sp = 0.6;
    const pp = this.game.player.position;
    this.items.forEach((t) => { if (t.revealed && !t.collected && distXZ(t, pp) < 70) this.game.fx.glow.emit({ x: t.x, y: t.y + 0.7, z: t.z }, { x: 0, y: 0.5, z: 0 }, { life: 1.4, size: 0.1, color: 0xffd870, gravity: -0.1 }); });
  }
  toJSON() { return { revealed: this.items.filter((t) => t.revealed).map((t) => t.id), collected: this.items.filter((t) => t.collected).map((t) => t.id) }; }
  fromJSON(d) {
    if (!d) return;
    this.items.forEach((t, i) => {
      t.collected = (d.collected || []).includes(t.id); t.revealed = t.collected || (d.revealed || []).includes(t.id);
      if (t.revealed && !t.collected) this._show(i); else this.mesh.setMatrixAt(i, _zero);
    });
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

export { TreasureSystem };
