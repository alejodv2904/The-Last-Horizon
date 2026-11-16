// Efectos con object pooling: estelas de disparo, agujeros de bala, huellas (rastros) y efectos de impacto.
// Cada familia es UN InstancedMesh con capacidad fija (1 draw call) y un ObjectPool que reutiliza los registros:
// durante horas de juego no se crea ni un solo objeto nuevo por disparo, paso o impacto.
import * as THREE from 'three';
import { ObjectPool } from '../core/ObjectPool.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const _Z = new THREE.Vector3(0, 0, 1), _qy = new THREE.Quaternion(), _d = new THREE.Vector3(), _zero = new THREE.Matrix4().makeScale(0, 0, 0);

function radialTexture(draw) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  draw(c.getContext('2d')); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

/* ------------------------------------------------------------------ Estelas de disparo */
class TracerPool {
  constructor(scene, cap = 12) {
    const geo = new THREE.BoxGeometry(0.05, 0.05, 1); geo.translate(0, 0, 0.5);   // de z=0 (cañón) a z=1 (impacto)
    this.mesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }), cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false;
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, _zero); this.mesh.setColorAt(i, _c.set(0)); }
    scene.add(this.mesh);
    let n = 0;
    this.pool = new ObjectPool(() => ({ i: n++, life: 0, max: 0.1, ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0 }), (t) => { t.life = 0; }, cap, { recycleOldest: true });
    this.base = new THREE.Color(0xffe2a0);
  }
  // from → to (puntos del mundo). `tint` opcional (p. ej. Dead Eye: ráfaga más roja).
  fire(from, to, life = 0.1, tint = null) {
    const t = this.pool.acquire(); if (!t) return;
    t.ax = from.x; t.ay = from.y; t.az = from.z; t.bx = to.x; t.by = to.y; t.bz = to.z; t.life = t.max = life; t.tint = tint;
  }
  update(dt) {
    const act = this.pool.active; if (!act.length) return;
    for (let k = act.length - 1; k >= 0; k--) {
      const t = act[k];
      t.life -= dt;
      if (t.life <= 0) { this.mesh.setMatrixAt(t.i, _zero); this.pool.release(t); continue; }
      _d.set(t.bx - t.ax, t.by - t.ay, t.bz - t.az); const len = Math.max(0.01, _d.length()); _d.divideScalar(len);
      _q.setFromUnitVectors(_Z, _d); _p.set(t.ax, t.ay, t.az); _s.set(1, 1, len);
      this.mesh.setMatrixAt(t.i, _m.compose(_p, _q, _s));
      this.mesh.setColorAt(t.i, _c.copy(t.tint || this.base).multiplyScalar(0.8 * (t.life / t.max)));
    }
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  clear() { this.pool.releaseAll(); for (let i = 0; i < this.mesh.count; i++) this.mesh.setMatrixAt(i, _zero); this.mesh.instanceMatrix.needsUpdate = true; }
}

/* ------------------------------------------------------------------ Decals (agujeros de bala, huellas) */
class DecalPool {
  constructor(scene, texture, size, cap, life, { opacity = 0.85, recycleOldest = true } = {}) {
    const geo = new THREE.PlaneGeometry(size, size);
    const mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, fog: true });
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false; this.cap = cap; this.life = life;
    for (let i = 0; i < cap; i++) { this.mesh.setMatrixAt(i, _zero); this.mesh.setColorAt(i, _c.set(0xffffff)); }
    scene.add(this.mesh);
    let n = 0;
    this.pool = new ObjectPool(() => ({ i: n++, age: 0 }), (d) => { d.age = 0; this.mesh.setMatrixAt(d.i, _zero); this.dirty = true; }, cap, { recycleOldest });
    this.dirty = false; this.enabled = true;
  }
  // normal: dirección a la que mira el decal (por defecto, arriba). yaw: giro sobre la normal.
  place(x, y, z, nx = 0, ny = 1, nz = 0, yaw = 0, scale = 1) {
    if (!this.enabled) return;
    const d = this.pool.acquire(); if (!d) return;
    d.age = 0; _d.set(nx, ny, nz).normalize();
    _q.setFromUnitVectors(_Z, _d);
    if (yaw) _q.multiply(_qy.setFromAxisAngle(_Z, yaw));
    _p.set(x + _d.x * 0.03, y + _d.y * 0.03, z + _d.z * 0.03); _s.set(scale, scale, 1);
    this.mesh.setMatrixAt(d.i, _m.compose(_p, _q, _s)); this.mesh.setColorAt(d.i, _c.set(0xffffff));
    this.mesh.instanceMatrix.needsUpdate = true; if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  update(dt) {
    const act = this.pool.active; if (!act.length) { return; }
    let fade = false;
    for (let k = act.length - 1; k >= 0; k--) {
      const d = act[k]; d.age += dt;
      if (d.age > this.life) { this.pool.release(d); continue; }
      if (d.age > this.life - 3) { this.mesh.setColorAt(d.i, _c.setScalar(Math.max(0, (this.life - d.age) / 3))); fade = true; }
    }
    if (fade && this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    if (this.dirty) { this.mesh.instanceMatrix.needsUpdate = true; this.dirty = false; }
  }
  clear() { this.pool.releaseAll(); this.mesh.instanceMatrix.needsUpdate = true; }
  setEnabled(on) { this.enabled = on; this.mesh.visible = on; if (!on) this.clear(); }
}

const holeTexture = () => radialTexture((g) => {
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 30); grd.addColorStop(0, 'rgba(10,6,4,0.95)'); grd.addColorStop(0.45, 'rgba(25,16,10,0.7)'); grd.addColorStop(1, 'rgba(25,16,10,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
});
const printTexture = () => radialTexture((g) => {
  g.fillStyle = 'rgba(40,26,14,0.8)';
  g.beginPath(); g.ellipse(22, 32, 8, 18, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(42, 32, 8, 18, 0, 0, Math.PI * 2); g.fill();
});

/* ------------------------------------------------------------------ Facade de impactos */
// game.fx.impact.hit(point, normal, kind): partículas (pool del ParticleSystem) + agujero de bala (pool de decals).
class EffectsHub {
  constructor(game) {
    this.game = game; const scene = game.scene;
    this.tracers = new TracerPool(scene, 14);
    this.holes = new DecalPool(scene, holeTexture(), 0.34, 48, 40);
    this.prints = new DecalPool(scene, printTexture(), 0.4, 110, 70, { opacity: 0.55 });
    this._lastPrint = new THREE.Vector3(1e9, 0, 1e9); this._printSide = 1; this.particleScale = 1;
  }
  setQuality(q) { this.particleScale = q.particles; this.prints.setEnabled(q.id !== 'low'); }
  tracer(from, to, life, tint) { this.tracers.fire(from, to, life, tint); }
  // kind: 'dirt' | 'rock' | 'flesh' | 'wood'
  hit(point, normal, kind = 'dirt') {
    const fx = this.game.fx, n = (c) => Math.max(1, Math.round(c * this.particleScale));
    if (kind === 'flesh') { fx.dust.burst(point, n(14), { color: 0x8a1a12, size: 0.09, life: 0.7, speed: 2.2, up: 1.2, gravity: 9, alpha: 0.95 }); return; }
    if (kind === 'rock') {
      fx.dust.burst(point, n(10), { color: 0x9a948a, size: 0.18, life: 0.9, speed: 1.6, up: 1.5, gravity: 4, alpha: 0.7, grow: 1.5, drag: 1.2 });
      fx.glow.burst(point, n(6), { color: 0xffc070, size: 0.04, life: 0.25, speed: 4, up: 1, gravity: 9 });
    } else fx.dust.burst(point, n(kind === 'wood' ? 6 : 10), { color: kind === 'wood' ? 0xa08058 : 0x8a7050, size: 0.18, life: 0.9, speed: 1.6, up: 1.5, gravity: 4, alpha: 0.7, grow: 1.5, drag: 1.2 });
    if (normal) this.holes.place(point.x, point.y, point.z, normal.x, normal.y, normal.z, Math.random() * 6.28, 0.7 + Math.random() * 0.6);
    else this.holes.place(point.x, point.y, point.z, 0, 1, 0, Math.random() * 6.28, 0.7 + Math.random() * 0.6);
  }
  // Huellas pooled de un actor que camina (jugador a pie o caballo): una cada `stride` metros.
  footprint(x, y, z, heading, stride, wide) {
    if (!this.prints.enabled) return;
    const dx = x - this._lastPrint.x, dz = z - this._lastPrint.z;
    if (dx * dx + dz * dz < stride * stride) return;
    this._lastPrint.set(x, y, z); this._printSide = -this._printSide;
    const off = wide ? 0.35 : 0.14, ox = Math.cos(heading) * off * this._printSide, oz = -Math.sin(heading) * off * this._printSide;
    this.prints.place(x + ox, y, z + oz, 0, 1, 0, heading, wide ? 1.15 : 0.7);
  }
  update(dt) { this.tracers.update(dt); this.holes.update(dt); this.prints.update(dt); }
  get stats() { return { tracers: this.tracers.pool.stats, holes: this.holes.pool.stats, prints: this.prints.pool.stats }; }
}

export { TracerPool, DecalPool, EffectsHub };
