// Proyectiles enemigos: balas trazadoras visibles (UN InstancedMesh = 1 draw call) con colisión analítica.
// Cada frame cada bala recorre un segmento y se prueba contra: jugador (cilindro), sólidos del mundo
// (círculos/cajas por World.segmentHit) y terreno. Sin THREE.Raycaster y sin asignar memoria.
import * as THREE from 'three';
import { clamp } from '../core/MathUtils.js';

const CAP = 32;
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _Z = new THREE.Vector3(0, 0, 1);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

class Projectiles {
  constructor(game) {
    this.game = game;
    const geo = new THREE.BoxGeometry(0.07, 0.07, 2.6); geo.translate(0, 0, -1.3);   // el extremo delantero es la bala
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe0a0, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.InstancedMesh(geo, mat, CAP);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.mesh.frustumCulled = false;
    for (let i = 0; i < CAP; i++) this.mesh.setMatrixAt(i, _zero);
    game.scene.add(this.mesh);
    this.list = Array.from({ length: CAP }, () => ({ alive: false, pos: new THREE.Vector3(), dir: new THREE.Vector3(), speed: 0, life: 0, dmg: 0, owner: null, whizzed: false }));
    this.cursor = 0; this.activeCount = 0;
  }

  fire(origin, dir, speed, dmg, owner) {
    for (let k = 0; k < CAP; k++) {
      const b = this.list[(this.cursor + k) % CAP];
      if (b.alive) continue;
      this.cursor = (this.cursor + k + 1) % CAP;
      b.alive = true; b.pos.copy(origin); b.dir.copy(dir); b.speed = speed; b.life = 2.2; b.dmg = dmg; b.owner = owner; b.whizzed = false;
      return b;
    }
    return null;
  }

  update(dt) {
    const g = this.game, w = g.world, pl = g.player, pp = pl.position;
    let active = 0, dirty = false;
    const playerDead = g.mode === 'dead' || !g.started;
    for (let i = 0; i < CAP; i++) {
      const b = this.list[i];
      if (!b.alive) continue;
      active++; dirty = true;
      const step = b.speed * dt, ax = b.pos.x, ay = b.pos.y, az = b.pos.z;
      const bx = ax + b.dir.x * step, by = ay + b.dir.y * step, bz = az + b.dir.z * step;
      b.life -= dt;
      let kill = b.life <= 0, impact = null;

      // 1) jugador: cilindro vertical (más alto si va a caballo)
      if (!playerDead) {
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
        if (t >= 0) impact = { x: ax + (bx - ax) * t, y: ay + (by - ay) * t, z: az + (bz - az) * t };
        else if (by < w.getHeightAt(bx, bz)) impact = { x: bx, y: Math.max(by, w.getHeightAt(bx, bz)), z: bz };
      }
      if (impact) {
        kill = true; _p.set(impact.x, impact.y, impact.z);
        if (impact.player) pl.takeDamage(b.dmg, b.owner ? b.owner.position : null);
        else {
          g.fx.dust.burst(_p, 6, { color: 0x9a8a70, size: 0.16, life: 0.7, speed: 1.4, up: 1.4, gravity: 4, alpha: 0.7, grow: 1.5, drag: 1.2 });
          g.fx.glow.burst(_p, 2, { color: 0xffc070, size: 0.04, life: 0.2, speed: 3, up: 1, gravity: 8 });
        }
      }
      if (kill) { b.alive = false; this.mesh.setMatrixAt(i, _zero); continue; }
      b.pos.set(bx, by, bz);
      _q.setFromUnitVectors(_Z, b.dir); _m.compose(b.pos, _q, _s); this.mesh.setMatrixAt(i, _m);
    }
    this.activeCount = active;
    if (dirty) this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear() { for (let i = 0; i < CAP; i++) { this.list[i].alive = false; this.mesh.setMatrixAt(i, _zero); } this.mesh.instanceMatrix.needsUpdate = true; }
}

export { Projectiles };
