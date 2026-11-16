// Generación procedural determinista: altura, biomas y camino.
// Las alturas se guardan en "tiles" (una rejilla por chunk) para que la física
// y la malla usen exactamente los mismos vértices, y se calculan solo una vez.
import { CONFIG } from '../core/Config.js';
import { Noise2D, smoothstep, lerp, clamp } from '../core/MathUtils.js';

class WorldGen {
  constructor(seed = 9137) {
    this.noise = new Noise2D(seed);
    this.biomeNoise = new Noise2D(seed + 11);
    this.size = CONFIG.CHUNK_SIZE;
    this.res = CONFIG.CHUNK_RES;
    this.cell = this.size / this.res;
    this.half = CONFIG.WORLD_HALF;
    this.tiles = new Map();
    this._lastKey = null; this._lastTile = null;
    this.roads = [CONFIG.ROAD, CONFIG.ROAD_TOWN];
    this.flatZones = [
      { x: CONFIG.CAMP.x, z: CONFIG.CAMP.z, r0: 13, r1: 30, h: 0 },
      { x: CONFIG.TRADING_POST.x, z: CONFIG.TRADING_POST.z, r0: 12, r1: 28, h: 0 },
      { x: CONFIG.TOWN.x, z: CONFIG.TOWN.z, r0: 36, r1: 62, h: 0 },
      ...CONFIG.BANDIT_CAMPS.filter((c) => c.flat).map((c) => ({ x: c.x, z: c.z, r0: 14, r1: 30, h: 0 })),
      ...Object.entries(CONFIG.CAMP_SITES).filter(([id]) => !id.startsWith('cedar')).map(([, c]) => ({ x: c.x, z: c.z, r0: 15, r1: 32, h: 0 })),
    ];
    this.infinite = false;   // modo post-juego: sin montañas de borde y con chunks ilimitados
    const C = CONFIG.CANYON, xs = C.path.map((p) => p[0]), zs = C.path.map((p) => p[1]), m = C.width * 2.8;
    this.canyonBox = { x0: Math.min(...xs) - m, x1: Math.max(...xs) + m, z0: Math.min(...zs) - m, z1: Math.max(...zs) + m };
    this._cs = { d: 0, u: 0 };
    this.flatZones.forEach((f) => { f.h = this._smoothHeight(f.x, f.z) + this.noise.fbm(f.x * 0.03 + 100, f.z * 0.03 - 50, 2) * 1.6; });
  }

  // --- Biomas: 0 = pradera dorada abierta, 1 = bosque denso de pinos ---
  forestWeight(x, z) {
    const b = this.biomeNoise.fbm(x * 0.0028, z * 0.0028, 2);
    let w = smoothstep(-0.05, 0.22, b);
    const dc = Math.hypot(x - CONFIG.CAMP.x, z - CONFIG.CAMP.z);
    w *= smoothstep(45, 130, dc);
    const dt = Math.hypot(x - CONFIG.TRADING_POST.x, z - CONFIG.TRADING_POST.z);
    w *= smoothstep(22, 45, dt);
    for (const zn of CONFIG.CLEAR_ZONES) w *= smoothstep(zn.r * 0.5, zn.r * 1.15, Math.hypot(x - zn.x, z - zn.z));
    return w;
  }

  _edge(x, z) { return this.infinite ? 0 : Math.max(Math.abs(x), Math.abs(z)) / this.half; }
  _smoothHeight(x, z) {
    const n = this.noise;
    let h = n.fbm(x * 0.0045, z * 0.0045, 2) * 22;
    h += smoothstep(0.8, 0.97, this._edge(x, z)) * 60;
    return h;
  }
  _rawHeight(x, z) {
    const n = this.noise;
    let h = n.fbm(x * 0.0045, z * 0.0045, 4) * 22;
    h += n.fbm(x * 0.03 + 100, z * 0.03 - 50, 2) * 1.6;
    const ridge = 1 - Math.abs(n.noise(x * 0.0021 + 40, z * 0.0021 - 12));
    h += Math.pow(ridge, 4) * 16;
    h += this.forestWeight(x, z) * n.fbm(x * 0.012 + 9, z * 0.012 + 4, 2) * 7;
    const e = this._edge(x, z);
    h += smoothstep(0.8, 0.97, e) * (60 + n.fbm(x * 0.012 + 7, z * 0.012 + 3, 3) * 35);
    return h;
  }
  roadDistance(x, z) {
    let best = Infinity;
    for (const r of this.roads) {
      for (let i = 0; i < r.length - 1; i++) {
        const ax = r[i][0], az = r[i][1], bx = r[i + 1][0], bz = r[i + 1][1];
        const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
        const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
        const d = Math.hypot(wx - vx * t, wz - vz * t);
        if (d < best) best = d;
      }
    }
    return best;
  }
  // Distancia (d) al eje del cañón y distancia recorrida (u) hasta la proyección: u sirve para la rampa de entrada.
  canyonSample(x, z) {
    const p = CONFIG.CANYON.path;
    let best = Infinity, bu = 0, acc = 0;
    for (let i = 0; i < p.length - 1; i++) {
      const ax = p[i][0], az = p[i][1], vx = p[i + 1][0] - ax, vz = p[i + 1][1] - az, L2 = vx * vx + vz * vz;
      const wx = x - ax, wz = z - az, t = clamp((wx * vx + wz * vz) / L2, 0, 1);
      const d = Math.hypot(wx - vx * t, wz - vz * t);
      if (d < best) { best = d; bu = acc + t * Math.sqrt(L2); }
      acc += Math.sqrt(L2);
    }
    this._cs.d = best; this._cs.u = bu;
    return this._cs;
  }
  heightFn(x, z) {
    let h = this._rawHeight(x, z);
    const rd = this.roadDistance(x, z);
    if (rd < 10) h = lerp(h, this._smoothHeight(x, z) + 0.6, smoothstep(10, 3, rd) * 0.8);
    const B = this.canyonBox;
    if (x > B.x0 && x < B.x1 && z > B.z0 && z < B.z1) {
      const C = CONFIG.CANYON, W = C.width, s = this.canyonSample(x, z);
      const w = 1 - smoothstep(W * 1.7, W * 2.7, s.d);
      if (w > 0) {
        const base = this._smoothHeight(x, z), t = smoothstep(W * 0.45, W * 0.82, s.d);
        h = lerp(h, lerp(base - C.depth, base + C.rim, t), w * smoothstep(0, C.ramp, s.u));
      }
    }
    for (const m of CONFIG.MOUNTAINS) {   // montañas aditivas (campana gaussiana)
      const dx = (x - m.x) / m.r, dz = (z - m.z) / m.r, d2 = dx * dx + dz * dz;
      if (d2 < 9) h += m.h * Math.exp(-d2);
    }
    for (const b of CONFIG.BIOMES) {   // el pantano es llano y bajo
      if (!b.flatten) continue;
      const w = 1 - smoothstep(b.r * 0.6, b.r * 1.05, Math.hypot(x - b.x, z - b.z));
      if (w > 0) h = lerp(h, 1.6 + this.noise.fbm(x * 0.05, z * 0.05, 2) * 0.7, w * b.flatten);
    }
    for (const f of this.flatZones) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r1) h = lerp(f.h, h, smoothstep(f.r0, f.r1, d));
    }
    return h;
  }

  // --- Tiles de altura (cacheados para siempre: ~6.7 KB por chunk) ---
  getTile(cx, cz) {
    const key = cx * 131072 + cz;
    if (key === this._lastKey) return this._lastTile;
    let t = this.tiles.get(key);
    if (!t) {
      const n = this.res + 1;
      t = new Float32Array(n * n);
      const x0 = cx * this.size, z0 = cz * this.size;
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) t[iz * n + ix] = this.heightFn(x0 + ix * this.cell, z0 + iz * this.cell);
      this.tiles.set(key, t);
      if (this.infinite && this.tiles.size > 900) {   // modo infinito: descarta los tiles más antiguos para acotar la memoria
        let n = 0; for (const k of this.tiles.keys()) { if (k === key) continue; this.tiles.delete(k); if (++n >= 250) break; }
      }
    }
    this._lastKey = key; this._lastTile = t;
    return t;
  }
  getHeightAt(x, z) {
    if (!this.infinite) { x = clamp(x, -this.half, this.half - 0.01); z = clamp(z, -this.half, this.half - 0.01); }
    const cx = Math.floor(x / this.size), cz = Math.floor(z / this.size);
    const t = this.getTile(cx, cz), n = this.res + 1;
    const gx = clamp((x - cx * this.size) / this.cell, 0, this.res - 0.0001);
    const gz = clamp((z - cz * this.size) / this.cell, 0, this.res - 0.0001);
    const ix = Math.floor(gx), iz = Math.floor(gz), fx = gx - ix, fz = gz - iz;
    const h00 = t[iz * n + ix], h10 = t[iz * n + ix + 1], h01 = t[(iz + 1) * n + ix], h11 = t[(iz + 1) * n + ix + 1];
    if (fx + fz <= 1) return h00 + (h10 - h00) * fx + (h01 - h00) * fz;
    return h11 + (h01 - h11) * (1 - fx) + (h10 - h11) * (1 - fz);
  }
  getSlopeAt(x, z) {
    const e = 1.0;
    const hx = this.getHeightAt(x - e, z) - this.getHeightAt(x + e, z);
    const hz = this.getHeightAt(x, z - e) - this.getHeightAt(x, z + e);
    return 2 * e / Math.hypot(hx, 2 * e, hz);
  }
}

export { WorldGen };
