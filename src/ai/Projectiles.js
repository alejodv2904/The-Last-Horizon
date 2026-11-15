// Proyectiles enemigos: balas trazadoras visibles (UN InstancedMesh = 1 draw call) con colisión analítica.
// Cada frame cada bala recorre un segmento y se prueba contra: jugador (cilindro), sólidos del mundo
// (círculos/cajas por World.segmentHit) y terreno. Sin THREE.Raycaster y sin asignar memoria.
// Fase 5B: los registros de bala viven en un ObjectPool (reutilizados, nunca se crean en caliente) y cada impacto
// deja agujero de bala + chispas mediante el hub de efectos (también pooled).
import * as THREE from 'three';
import { clamp } from '../core/MathUtils.js';
import { ObjectPool } from '../core/ObjectPool.js';

const CAP = 32;
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _Z = new THREE.Vector3(0, 0, 1);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0), _n = new THREE.Vector3();

class Projectiles {
  constructor(game) {
    this.game = game;
    const geo = new THREE.BoxGeometry(0.07, 0.07, 2.6); geo.translate(0, 0, -1.3);   // el extremo delantero es la bala
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false;
    for (let i = 0; i < CAP; i++) this.mesh.setMatrixAt(i, _zero);
    game.scene.add(this.mesh);
    let n = 0;
    this.pool = new ObjectPool(
      () => ({ i: n++, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, life: 0, dmg: 0, owner: null, whizzed: false }),
      (b) => { b.owner = null; this.mesh.setMatrixAt(b.i, _zero); },
      CAP, { recycleOldest: true },
    );
    this.activeCount = 0;
  }

  // Devuelve la bala reservada del pool (o null si no cabe; con recycleOldest siempre habrá una).
  fire(origin, dir, speed, dmg, owner) {
    const b = this.pool.acquire(); if (!b) return null;
    b.pos.copy(origin); b.dir.copy(dir); b.speed = speed; b.life = 2.2; b.dmg = dmg; b.owner = owner; b.whizzed = false;
    return b;
  }

  update(dt) {
    const g = this.game, w = g.world, pl = g.player, pp = pl.position, act = this.pool.active;
    this.activeCount = act.length;
    if (!act.length) return;
    const playerDead = g.mode === 'dead' || !g.started;
    for (let k = act.length - 1; k >= 0; k--) {
      const b = act[k];
      if (!b) continue;   // la lista pudo vaciarse a mitad de bucle (el jugador murió → clear()): los registros ya están liberados
      const step = b.speed * dt, ax = b.pos.x, ay = b.pos.y, az = b.pos.z;
      const bx = ax + b.dir.x * step, by = ay + b.dir.y * step, bz = az + b.dir.z * step;
      b.life -= dt;
      let kill = b.life <= 0, impact = null, nx = 0, ny = 1, nz = 0;

      // 1) jugador: cilindro vertical (más alto si va a caballo)
      if (!playerDead && !pl.invulnerable) {
        const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz;
        const t = L2 > 1e-9 ? clamp(((pp.x - ax) * vx + (pp.z - az) * vz) / L2, 0, 1) : 0;
        const cx = ax + vx * t, cz = az + vz * t, cy = ay + (by - ay) * t;
        const d = Math.hypot(cx - pp.x, cz - pp.z), lo = pp.y + (pl.riding ? 0.7 : 0), hi = pp.y + (pl.riding ? 2.5 : 1.85);
        if (d < 0.46 && cy > lo && cy < hi) impact = { x: cx, y: cy, z: cz, player: true };
        else if (!b.whizzed && d < 2.0 && cy > pp.y - 0.3 && cy < hi + 0.6) {
          b.whizzed = true; g.audio.playWhiz(); pl.shake = Math.max(pl.shake, 0.25);
        }
      }
      // 2) mundo
      if (!impact) {
        const t = w.segmentHit(ax, ay, az, bx, by, bz);
        if (t >= 0) { impact = { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t }; nx = -b.dir.x; ny = -b.dir.y; nz = -b.dir.z; }
        else if (by < w.getHeightAt(bx, bz)) impact = { x: bx, y: Math.max(by, w.getHeightAt(bx, bz)), z: bz };
      }
      if (impact) {
        kill = true; _p.set(impact.x, impact.y, impact.z);
        if (impact.player) pl.takeDamage(b.dmg, b.owner ? b.owner.position : null);
        else {
          _n.set(nx, ny, nz);
          g.fx.impact.hit(_p, _n, 'dirt');
          g.fx.glow.burst(_p, 2, { color: 0xffc070, size: 0.04, life: 0.2, speed: 3, up: 1, gravity: 8 });
        }
      }
      if (kill) { this.pool.release(b); continue; }
      b.pos.set(bx, by, bz);
      _q.setFromUnitVectors(_Z, b.dir); _m.compose(b.pos, _q, _s); this.mesh.setMatrixAt(b.i, _m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { this.pool.releaseAll(); this.mesh.instanceMatrix.needsUpdate = true; }
}

export { Projectiles };
