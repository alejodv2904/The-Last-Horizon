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
    this.road = CONFIG.ROAD;
    this.flatZones = [
      { x: CONFIG.CAMP.x, z: CONFIG.CAMP.z, r0: 13, r1: 30, h: 0 },
      { x: CONFIG.TRADING_POST.x, z: CONFIG.TRADING_POST.z, r0: 12, r1: 28, h: 0 },
    ];
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
    return w;
  }

  _edge(x, z) { return Math.max(Math.abs(x), Math.abs(z)) / this.half; }
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
    const r = this.road;
    for (let i = 0; i < r.length - 1; i++) {
      const ax = r[i][0], az = r[i][1], bx = r[i + 1][0], bz = r[i + 1][1];
      const vx = bx - ax, vz = bz - az, wx = x - ax, wz = z - az;
      const t = clamp((wx * vx + wz * vz) / (vx * vx + vz * vz), 0, 1);
      const d = Math.hypot(wx - vx * t, wz - vz * t);
      if (d < best) best = d;
    }
    return best;
  }
  heightFn(x, z) {
    let h = this._rawHeight(x, z);
    const rd = this.roadDistance(x, z);
    if (rd < 10) h = lerp(h, this._smoothHeight(x, z) + 0.6, smoothstep(10, 3, rd) * 0.8);
    for (const f of this.flatZones) {
      const d = Math.hypot(x - f.x, z - f.z);
      if (d < f.r1) h = lerp(f.h, h, smoothstep(f.r0, f.r1, d));
    }
    return h;
  }

  // --- Tiles de altura (cacheados para siempre: ~6.7 KB por chunk) ---
  getTile(cx, cz) {
    const key = cx * 4096 + cz;
    if (key === this._lastKey) return this._lastTile;
    let t = this.tiles.get(key);
    if (!t) {
      const n = this.res + 1;
      t = new Float32Array(n * n);
      const x0 = cx * this.size, z0 = cz * this.size;
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) t[iz * n + ix] = this.heightFn(x0 + ix * this.cell, z0 + iz * this.cell);
      this.tiles.set(key, t);
    }
    this._lastKey = key; this._lastTile = t;
    return t;
  }
  getHeightAt(x, z) {
    x = clamp(x, -this.half, this.half - 0.01); z = clamp(z, -this.half, this.half - 0.01);
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
