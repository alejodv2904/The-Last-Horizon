// Streaming de terreno por chunks de 200x200 m.
// - Solo existen 9 "slots" (chunk del jugador + 8 vecinos). Al moverse, los slots lejanos
//   se reciclan: se reescriben sus buffers en lugar de crear geometría nueva (cero basura para el GC).
// - La vegetación de los 9 chunks comparte UN InstancedMesh por tipo (5 draw calls en total);
//   cada slot posee un rango fijo de instancias y solo ese rango se sube a la GPU (addUpdateRange).
// - La construcción es diferida: como máximo CHUNK_BUILDS_PER_FRAME chunks por frame.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { smoothstep, mulberry32, clamp } from '../core/MathUtils.js';
import { GeoBuilder, MAT, varyFaceColors } from '../render/GeometryKit.js';

const VEG_TYPES = ['pine', 'oak', 'rock', 'sage', 'grass'];
const _dummy = new THREE.Object3D();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _col = new THREE.Color(), _tmpC = new THREE.Color();
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _e1 = new THREE.Vector3(), _e2 = new THREE.Vector3();
const SNOWC = new THREE.Color(0xe6eef2), _bc = new THREE.Color();
const GROUND = {
  prairieA: new THREE.Color(0xb59d55), prairieB: new THREE.Color(0x9c9a52),
  forestA: new THREE.Color(0x4d6533), forestB: new THREE.Color(0x5e5a3a),
  high: new THREE.Color(0x9a8b6a), rock: new THREE.Color(0x7d7062), road: new THREE.Color(0x8a6844), dirt: new THREE.Color(0x8a6a48),
};
const TINT = {
  pine: new THREE.Color(0x9fb59a), oak: new THREE.Color(0xc8b878), rock: new THREE.Color(0xb0a898), sage: new THREE.Color(0xd8d4b8),
  grassGold: new THREE.Color(0xffe2a0), grassGreen: new THREE.Color(0xa8c890),
};

class ChunkManager {
  constructor(world) {
    this.world = world; this.gen = world.gen; this.scene = world.scene;
    this.size = CONFIG.CHUNK_SIZE; this.res = CONFIG.CHUNK_RES;
    this.minC = -Math.round(CONFIG.WORLD_HALF / this.size); this.maxC = -this.minC - 1;
    this.slots = []; this.active = new Map(); this.queue = []; this.center = null;
    this.stats = { builds: 0, lastBuildMs: 0 };
    // Calidad gráfica: distancia de carga de chunks y densidad de vegetación (instancias por chunk y tipo).
    this.viewDist = 230; this.cap = { ...CONFIG.VEG_MAX_PER_CHUNK }; this._ex = 1e9; this._ez = 1e9;
    this.biomes = CONFIG.BIOMES.map((b) => ({ ...b, c0: new THREE.Color(b.ground[0]), c1: new THREE.Color(b.ground[1]) }));
    this._buildVegetationMeshes();
    for (let i = 0; i < 9; i++) this.slots.push(this._createSlot(i));
  }

  _buildVegetationMeshes() {
    const rand = mulberry32(4242);
    const pine = varyFaceColors(new GeoBuilder()
      .add(new THREE.CylinderGeometry(0.18, 0.28, 2.0, 5, 1, true), 0x5a3d26, 0, 1.0, 0)
      .add(new THREE.ConeGeometry(1.9, 2.8, 7), 0x2f4a2a, 0, 2.8, 0)
      .add(new THREE.ConeGeometry(1.5, 2.4, 7, 1, true), 0x355330, 0, 4.1, 0, 0, 0.4, 0)
      .add(new THREE.ConeGeometry(1.05, 2.0, 7, 1, true), 0x3b5c35, 0, 5.3, 0, 0, 0.8, 0)
      .add(new THREE.ConeGeometry(0.55, 1.4, 6, 1, true), 0x426538, 0, 6.4, 0)
      .build(), rand, 0.08);
    const oak = varyFaceColors(new GeoBuilder()
      .add(new THREE.CylinderGeometry(0.22, 0.35, 2.8, 6, 1, true), 0x5e4630, 0, 1.4, 0)
      .add(new THREE.CylinderGeometry(0.08, 0.14, 1.4, 5, 1, true), 0x5e4630, 0.45, 2.7, 0, 0, 0, -0.7)
      .add(new THREE.IcosahedronGeometry(1.8, 0), 0x7d8a3c, 0, 3.8, 0)
      .add(new THREE.IcosahedronGeometry(1.3, 0), 0x9a9442, 1.0, 3.3, 0.4)
      .add(new THREE.IcosahedronGeometry(1.2, 0), 0x6f7d36, -0.8, 3.5, -0.5)
      .build(), rand, 0.1);
    const rockBase = new THREE.IcosahedronGeometry(1, 1);
    const rp = rockBase.attributes.position, jit = new Map();
    for (let i = 0; i < rp.count; i++) {
      const key = `${rp.getX(i).toFixed(3)},${rp.getY(i).toFixed(3)},${rp.getZ(i).toFixed(3)}`;
      if (!jit.has(key)) jit.set(key, 0.78 + rand() * 0.4);
      const k = jit.get(key);
      rp.setXYZ(i, rp.getX(i) * k, rp.getY(i) * k * 0.72, rp.getZ(i) * k);
    }
    const rock = varyFaceColors(new GeoBuilder().add(rockBase, 0x8a7f72).build(), rand, 0.12);
    const sage = varyFaceColors(new GeoBuilder()
      .add(new THREE.IcosahedronGeometry(0.55, 0), 0x7f8a6a, 0, 0.25, 0, 0, 0, 0, 1, 0.6, 1)
      .add(new THREE.IcosahedronGeometry(0.4, 0), 0x8d9676, 0.35, 0.2, 0.1, 0, 0, 0, 1, 0.6, 1)
      .build(), rand, 0.1);
    const grass = new GeoBuilder()
      .add(new THREE.ConeGeometry(0.1, 0.75, 3, 1, true), 0xa59a55, 0, 0.37, 0, 0.15, 0, 0.1)
      .add(new THREE.ConeGeometry(0.09, 0.6, 3, 1, true), 0x8d9047, 0.12, 0.3, 0.05, -0.1, 0, -0.25)
      .add(new THREE.ConeGeometry(0.09, 0.55, 3, 1, true), 0xb3a35c, -0.1, 0.27, -0.06, 0.2, 0, 0.3)
      .build();
    const geos = { pine, oak, rock, sage, grass };
    const mats = { pine: MAT.pine, oak: MAT.oak, rock: MAT.vc, sage: MAT.grass, grass: MAT.grass };
    this.veg = {};
    const white = new THREE.Color(1, 1, 1);
    for (const type of VEG_TYPES) {
      const max = CONFIG.VEG_MAX_PER_CHUNK[type] * 9;
      const mesh = new THREE.InstancedMesh(geos[type], mats[type], max);
      for (let i = 0; i < max; i++) { mesh.setMatrixAt(i, _zero); mesh.setColorAt(i, white); }
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.castShadow = type === 'pine' || type === 'oak' || type === 'rock';
      mesh.receiveShadow = type === 'rock';
      mesh.frustumCulled = false;
      mesh.userData.vegType = type;
      this.scene.add(mesh);
      this.veg[type] = mesh;
    }
  }

  _createSlot(index) {
    const verts = this.res * this.res * 6;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(verts * 3), 3).setUsage(THREE.DynamicDrawUsage));
    const mesh = new THREE.Mesh(geo, MAT.vc);
    mesh.receiveShadow = true; mesh.matrixAutoUpdate = false; mesh.visible = false;
    this.scene.add(mesh);
    return { index, key: null, cx: 0, cz: 0, x0: 0, z0: 0, mesh, obstacles: [], ready: false };
  }

  _key(cx, cz) { return `${cx},${cz}`; }

  setInfinite(on) {   // modo post-juego: chunks sin límite de mundo
    this.minC = on ? -4000 : -Math.round(CONFIG.WORLD_HALF / this.size); this.maxC = on ? 4000 : -this.minC - 1;
    this.world.gen.infinite = on; this.world.gen.tiles.clear(); this.world.gen._lastKey = null;
    this._ex = 1e9; this.refresh();
  }
  // Aplica un preset de calidad: distancia de vista y densidad de vegetación (cap por chunk). Reconstruye los chunks cargados.
  applyQuality(q) {
    this.viewDist = q.viewDist;
    for (const type of VEG_TYPES) {
      this.cap[type] = Math.max(6, Math.floor(CONFIG.VEG_MAX_PER_CHUNK[type] * q.veg));
      this.veg[type].count = 9 * this.cap[type];
    }
    this.refresh(true);
  }
  // Reconstruye todos los chunks cargados (tras un cambio de calidad) y reevalúa el conjunto visible.
  refresh(full = false) {
    if (full) {
      for (const type of VEG_TYPES) {
        const mesh = this.veg[type], total = CONFIG.VEG_MAX_PER_CHUNK[type] * 9;
        for (let i = 0; i < total; i++) mesh.setMatrixAt(i, _zero);
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.needsUpdate = true;
      }
      for (const slot of this.active.values()) { slot.ready = false; slot.obstacles.length = 0; if (!this.queue.includes(slot)) this.queue.push(slot); }
    }
    this._ex = 1e9;
  }

  update(p, force = false) {
    const size = this.size;
    const pcx = clamp(Math.floor(p.x / size), this.minC, this.maxC), pcz = clamp(Math.floor(p.z / size), this.minC, this.maxC);
    const dx = p.x - this._ex, dz = p.z - this._ez;
    if (force || !this.center || pcx !== this.center.cx || pcz !== this.center.cz || dx * dx + dz * dz > 100) this._reevaluate(pcx, pcz, p);
    let budget = force ? Infinity : CONFIG.CHUNK_BUILDS_PER_FRAME;
    while (budget-- > 0 && this.queue.length) this._build(this.queue.shift());
  }

  // Conjunto visible = chunk del jugador + vecinos (3x3) cuya caja esté a menos de `viewDist` metros (con histéresis de 30 m).
  _reevaluate(ccx, ccz, p) {
    this.center = { cx: ccx, cz: ccz }; this._ex = p.x; this._ez = p.z;
    const size = this.size, wanted = new Map();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ccx + dx, cz = ccz + dz;
      if (cx < this.minC || cx > this.maxC || cz < this.minC || cz > this.maxC) continue;
      const x0 = cx * size, z0 = cz * size, ox = Math.max(x0 - p.x, p.x - (x0 + size), 0), oz = Math.max(z0 - p.z, p.z - (z0 + size), 0);
      const key = this._key(cx, cz), d = Math.hypot(ox, oz);
      if ((dx === 0 && dz === 0) || d < this.viewDist + (this.active.has(key) ? 30 : 0)) wanted.set(key, { cx, cz, d });
    }
    for (const [key, slot] of this.active) if (!wanted.has(key)) { this._release(slot); this.active.delete(key); }
    const free = this.slots.filter((s) => s.key === null);
    const toBuild = [...wanted].filter(([k]) => !this.active.has(k)).sort((a, b) => a[1].d - b[1].d);
    for (const [key, w] of toBuild) {
      const slot = free.pop();
      slot.key = key; slot.cx = w.cx; slot.cz = w.cz; slot.x0 = w.cx * this.size; slot.z0 = w.cz * this.size; slot.ready = false;
      this.active.set(key, slot);
      this.queue.push(slot);
    }
  }

  _release(slot) {
    slot.key = null; slot.ready = false; slot.mesh.visible = false; slot.obstacles.length = 0;
    this.queue = this.queue.filter((s) => s !== slot);
    for (const type of VEG_TYPES) {
      const mesh = this.veg[type], max = this.cap[type], base = slot.index * max;
      for (let i = 0; i < max; i++) mesh.setMatrixAt(base + i, _zero);
      mesh.instanceMatrix.addUpdateRange(base * 16, max * 16);
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  _groundColor(out, x, y, z, ny, rand) {
    const g = this.gen;
    const fw = g.forestWeight(x, z);
    const patch = g.noise.noise(x * 0.025, z * 0.025) * 0.5 + 0.5;
    out.lerpColors(GROUND.prairieA, GROUND.prairieB, smoothstep(0.3, 0.75, patch));
    _tmpC.lerpColors(GROUND.forestA, GROUND.forestB, patch);
    out.lerp(_tmpC, fw);
    out.lerp(GROUND.high, smoothstep(32, 58, y));
    out.lerp(GROUND.rock, smoothstep(0.88, 0.7, ny));
    out.lerp(GROUND.road, smoothstep(3.6, 1.8, g.roadDistance(x, z)) * 0.95);
    const dc = Math.hypot(x - CONFIG.CAMP.x, z - CONFIG.CAMP.z), dt = Math.hypot(x - CONFIG.TRADING_POST.x, z - CONFIG.TRADING_POST.z);
    let dirt = Math.max(smoothstep(17, 8, dc), smoothstep(15, 7, dt));
    for (const zn of CONFIG.CLEAR_ZONES) dirt = Math.max(dirt, smoothstep(zn.dirt1, zn.dirt0, Math.hypot(x - zn.x, z - zn.z)));
    out.lerp(GROUND.dirt, dirt * 0.9);
    for (const b of this.biomes) {   // biomas nuevos: pantano, desierto, nieve
      const w = 1 - smoothstep(b.r * 0.62, b.r * 1.02, Math.hypot(x - b.x, z - b.z));
      if (w <= 0) continue;
      _bc.lerpColors(b.c0, b.c1, smoothstep(0.3, 0.75, patch));
      out.lerp(_bc, w * 0.92);
      if (b.id === 'snow') out.lerp(SNOWC, w * (0.35 + smoothstep(8, 40, y) * 0.55));
    }
    out.multiplyScalar(0.93 + rand() * 0.12);
  }
  // Multiplicador de densidad de un tipo de vegetación según los biomas que cubren (x, z); 1 = pradera.
  _vegFactor(type, x, z) {
    let f = 1;
    for (const b of this.biomes) {
      const w = 1 - smoothstep(b.r * 0.62, b.r * 1.02, Math.hypot(x - b.x, z - b.z));
      if (w > 0) f *= 1 + (b.veg[type] - 1) * w;
    }
    return f;
  }
  _snowWeight(x, z) {
    for (const b of this.biomes) if (b.id === 'snow') return 1 - smoothstep(b.r * 0.62, b.r * 1.02, Math.hypot(x - b.x, z - b.z));
    return 0;
  }

  _build(slot) {
    const t0 = performance.now();
    const size = this.size, res = this.res, cell = size / res, n = res + 1;
    const tile = this.gen.getTile(slot.cx, slot.cz);
    const geo = slot.mesh.geometry, pos = geo.attributes.position.array, col = geo.attributes.color.array;
    const rand = mulberry32(((slot.cx + 64) * 73856093) ^ ((slot.cz + 64) * 19349663));
    let o = 0;
    const tri = (x0, z0, y0, x1, z1, y1, x2, z2, y2) => {
      _a.set(x0, y0, z0); _b.set(x1, y1, z1); _c.set(x2, y2, z2);
      _e1.subVectors(_b, _a); _e2.subVectors(_c, _a); _e1.cross(_e2).normalize();
      this._groundColor(_col, (x0 + x1 + x2) / 3, (y0 + y1 + y2) / 3, (z0 + z1 + z2) / 3, _e1.y, rand);
      pos[o] = x0; pos[o + 1] = y0; pos[o + 2] = z0; pos[o + 3] = x1; pos[o + 4] = y1; pos[o + 5] = z1; pos[o + 6] = x2; pos[o + 7] = y2; pos[o + 8] = z2;
      for (let k = 0; k < 9; k += 3) { col[o + k] = _col.r; col[o + k + 1] = _col.g; col[o + k + 2] = _col.b; }
      o += 9;
    };
    for (let iz = 0; iz < res; iz++) for (let ix = 0; ix < res; ix++) {
      const x0 = slot.x0 + ix * cell, x1 = x0 + cell, z0 = slot.z0 + iz * cell, z1 = z0 + cell;
      const h00 = tile[iz * n + ix], h10 = tile[iz * n + ix + 1], h01 = tile[(iz + 1) * n + ix], h11 = tile[(iz + 1) * n + ix + 1];
      tri(x0, z0, h00, x0, z1, h01, x1, z0, h10);
      tri(x0, z1, h01, x1, z1, h11, x1, z0, h10);
    }
    geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
    geo.computeBoundingSphere();
    slot.mesh.visible = true;
    slot.obstacles.length = 0;
    this._scatter(slot, rand);
    slot.ready = true;
    this.stats.builds++; this.stats.lastBuildMs = performance.now() - t0;
  }

  _scatter(slot, rand) {
    const g = this.gen, size = this.size, max = this.cap;
    const lists = { pine: [], oak: [], rock: [], sage: [], grass: [] };
    const camp = CONFIG.CAMP, tp = CONFIG.TRADING_POST;
    const clear = (x, z, rCamp, rRoad, rHerd) => {
      if (Math.hypot(x - camp.x, z - camp.z) < rCamp || Math.hypot(x - tp.x, z - tp.z) < rCamp - 4) return false;
      for (const zn of CONFIG.CLEAR_ZONES) if (Math.hypot(x - zn.x, z - zn.z) < zn.r + (rCamp - 30)) return false;
      if (rRoad > 0 && g.roadDistance(x, z) < rRoad) return false;
      if (rHerd > 0 && CONFIG.HERDS.some((h) => Math.hypot(x - h.x, z - h.z) < rHerd)) return false;
      return true;
    };
    const attempt = (type, tries, fn) => {
      const list = lists[type];
      for (let k = 0; k < tries && list.length < max[type]; k++) {
        const x = slot.x0 + rand() * size, z = slot.z0 + rand() * size, r1 = rand(), r2 = rand(), r3 = rand();
        const item = fn(x, z, r1, r2, r3);
        if (item) list.push(item);
      }
    };
    attempt('pine', 900, (x, z, r1, r2, r3) => {
      const fw = g.forestWeight(x, z);
      if (r1 > (0.012 + fw * 0.6) * this._vegFactor('pine', x, z) || !clear(x, z, 30, 5.5, 18) || g.getSlopeAt(x, z) < 0.74) return null;
      const sw = this._snowWeight(x, z);
      return { x, z, s: 0.75 + r2 * 0.75, r: r3 * Math.PI * 2, tint: sw > 0.05 ? TINT.pine.clone().lerp(SNOWC, sw * 0.7) : TINT.pine, tv: 0.1 };
    });
    attempt('oak', 160, (x, z, r1, r2, r3) => {
      const fw = g.forestWeight(x, z);
      if (r1 > (1 - fw) * 0.22 * this._vegFactor('oak', x, z) || !clear(x, z, 26, 5.5, 12) || g.getHeightAt(x, z) > 32 || g.getSlopeAt(x, z) < 0.86) return null;
      return { x, z, s: 0.8 + r2 * 0.6, r: r3 * Math.PI * 2, tint: TINT.oak, tv: 0.15 };
    });
    attempt('rock', 140, (x, z, r1, r2, r3) => {
      const slope = g.getSlopeAt(x, z);
      if (r1 > (0.1 + (1 - slope) * 2.2) * this._vegFactor('rock', x, z) || !clear(x, z, 22, 4, 0)) return null;
      const s = 0.5 + r2 * r2 * 2.6, sw = this._snowWeight(x, z);
      return { x, z, s, sy: s * (0.7 + r3 * 0.6), r: r3 * 6.283, sink: 0.3, tint: sw > 0.05 ? TINT.rock.clone().lerp(SNOWC, sw * 0.5) : TINT.rock, tv: 0.12 };
    });
    attempt('sage', 260, (x, z, r1, r2, r3) => {
      const fw = g.forestWeight(x, z);
      if (r1 > ((1 - fw) * 0.45 + 0.03) * this._vegFactor('sage', x, z) || !clear(x, z, 12, 3, 0) || g.getSlopeAt(x, z) < 0.8) return null;
      return { x, z, s: 0.6 + r2 * 0.9, r: r3 * Math.PI * 2, tint: TINT.sage, tv: 0.15 };
    });
    attempt('grass', 700, (x, z, r1, r2, r3) => {
      if (r1 > 0.55 * this._vegFactor('grass', x, z) || !clear(x, z, 9, 2.2, 0) || g.getSlopeAt(x, z) < 0.82) return null;
      const fw = g.forestWeight(x, z);
      return { x, z, s: 0.7 + r2 * 0.8, r: r3 * Math.PI * 2, tint: _tmpC.lerpColors(TINT.grassGold, TINT.grassGreen, fw).clone(), tv: 0.2 };
    });

    for (const type of VEG_TYPES) {
      const mesh = this.veg[type], m = max[type], base = slot.index * m, list = lists[type];
      for (let i = 0; i < m; i++) {
        const p = list[i];
        if (!p) { mesh.setMatrixAt(base + i, _zero); continue; }
        const y = g.getHeightAt(p.x, p.z) - (p.sink ? p.sink * p.s : 0.05);
        _dummy.position.set(p.x, y, p.z); _dummy.rotation.set(0, p.r, 0); _dummy.scale.set(p.s, p.sy ?? p.s, p.s);
        _dummy.updateMatrix();
        mesh.setMatrixAt(base + i, _dummy.matrix);
        _col.copy(p.tint).multiplyScalar(1 - p.tv + rand() * p.tv * 2);
        _col.r = Math.min(_col.r, 1); _col.g = Math.min(_col.g, 1); _col.b = Math.min(_col.b, 1);
        mesh.setColorAt(base + i, _col);
        if (type === 'pine') slot.obstacles.push({ x: p.x, z: p.z, r: 0.45 * p.s });
        else if (type === 'oak') slot.obstacles.push({ x: p.x, z: p.z, r: 0.5 * p.s });
        else if (type === 'rock' && p.s > 0.6) slot.obstacles.push({ x: p.x, z: p.z, r: 0.85 * p.s });
      }
      mesh.instanceMatrix.addUpdateRange(base * 16, m * 16); mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.addUpdateRange(base * 3, m * 3); mesh.instanceColor.needsUpdate = true;
      if (mesh.castShadow) mesh.computeBoundingSphere();
    }
  }

  // Recorre los obstáculos de los chunks cargados que tocan el área [x±r, z±r].
  forEachSlotNear(x, z, r, fn) {
    const size = this.size;
    for (const slot of this.active.values()) {
      if (!slot.ready) continue;
      if (x + r < slot.x0 - 3 || x - r > slot.x0 + size + 3 || z + r < slot.z0 - 3 || z - r > slot.z0 + size + 3) continue;
      fn(slot);
    }
  }
  get pendingBuilds() { return this.queue.length; }
}

export { ChunkManager };
