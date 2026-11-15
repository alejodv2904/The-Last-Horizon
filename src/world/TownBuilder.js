// Redwood Gulch: pueblo fronterizo fijo. Calle principal Este-Oeste, edificios alineados a los ejes.
//
// Rendimiento:
//  - Todos los edificios y el mobiliario se fusionan en UNA malla con color por vértice (1 draw call).
//    Ventanas y farolas van en otras dos mallas emisivas que se encienden de noche (2 draw calls).
//    Los 8 carteles comparten UN atlas de textura (1 draw call). El cofre son 2 mallas pequeñas.
//  - Colisiones: cada edificio es una caja AABB (no se colisiona contra la malla). Todo el pueblo vive
//    en una "zona" del WorldManager con círculo envolvente: fuera de él, el coste de colisión es cero.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { _m4, _q, _e, _v1, _sc, GeoBuilder, MAT } from '../render/GeometryKit.js';

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s);
const WHITE = 0xffffff;

/* ---------- Atlas de carteles: 2 columnas x 4 filas de 512x128 ---------- */
const SIGNS = [
  { t: 'SALOON', s: 'The Golden Spur', bg: '#6a2f22', fg: '#f0d9a0' },
  { t: 'SHERIFF', s: 'Oficina y calabozo', bg: '#2f3c4c', fg: '#e8dcb8' },
  { t: 'TIENDA GENERAL', s: 'H. Bell · Víveres · Tónicos', bg: '#3c4a30', fg: '#ead7a8' },
  { t: 'ESTABLO', s: 'Caballos · Heno', bg: '#5b3d22', fg: '#ead7a8' },
  { t: 'REDWOOD GULCH', s: 'Pop. 112 · Bienvenido, forastero', bg: '#4a2e1c', fg: '#f0d9a0' },
  { t: 'SE BUSCA', s: 'Recompensas · Sheriff', bg: '#d8c496', fg: '#4a1a10' },
  { t: 'TELÉGRAFO', s: 'Noticias · Giros', bg: '#3a3a40', fg: '#e8dcb8' },
  { t: 'CLÍNICA', s: 'Dr. A. Pym · Tónicos', bg: '#3a5266', fg: '#e8e2d0' },
];
function makeSignAtlas() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  SIGNS.forEach((sg, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 128;
    g.fillStyle = sg.bg; g.fillRect(x, y, 512, 128);
    g.strokeStyle = 'rgba(20,10,4,.85)'; g.lineWidth = 10; g.strokeRect(x + 5, y + 5, 502, 118);
    g.strokeStyle = sg.fg; g.lineWidth = 2; g.strokeRect(x + 14, y + 14, 484, 100);
    g.fillStyle = sg.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${sg.t.length > 11 ? 44 : 54}px Georgia`; g.fillText(sg.t, x + 256, y + 52);
    g.font = 'italic 24px Georgia'; g.fillText(sg.s, x + 256, y + 100);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}
// Fusiona planos con UV del atlas (mergeGeos de GeometryKit no copia UV).
function buildSignGeometry(list) {
  const pos = [], nor = [], uv = [];
  for (const s of list) {
    const g = new THREE.PlaneGeometry(s.w, s.h).toNonIndexed();
    _m4.compose(_v1.set(s.x, s.y, s.z), _q.setFromEuler(_e.set(0, s.ry, 0, 'YXZ')), _sc.set(1, 1, 1));
    g.applyMatrix4(_m4);
    const col = s.slot % 2, row = Math.floor(s.slot / 2), p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nor.push(n.getX(i), n.getY(i), n.getZ(i));
      uv.push(col * 0.5 + u.getX(i) * 0.5, 0.75 - row * 0.25 + u.getY(i) * 0.25);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.computeBoundingSphere();
  return out;
}

function buildTown(world) {
  const { x: TX, z: TZ, radius } = CONFIG.TOWN, scene = world.scene;
  const y0 = world.getHeightAt(TX, TZ);
  const zone = world.addZone(TX, TZ, radius + 8);
  const b = new GeoBuilder(), win = new GeoBuilder(), lan = new GeoBuilder();
  const signs = [], covers = [], doors = [];
  let boardPos = null;
  const L = (lx, lz) => new THREE.Vector3(TX + lx, y0, TZ + lz);   // local -> mundo

  /* ---- primitivas (coordenadas locales: x a lo largo de la calle, z a través) ---- */
  const rect = (x0, x1, z0, z1, ya, yb, color) => b.add(Box(x1 - x0, yb - ya, z1 - z0), color, (x0 + x1) / 2, (ya + yb) / 2, (z0 + z1) / 2);
  const slab = (cx, cy, cz, w, h, d, rx, ry, rz, color) => b.add(Box(w, h, d), color, cx, cy, cz, rx, ry, rz);
  const post = (x, z, h, color, r = 0.1) => b.add(Cyl(r, r * 1.15, h, 6), color, x, h / 2, z);
  const colBox = (x0, x1, z0, z1, h) => zone.boxes.push({ x0: TX + x0, x1: TX + x1, z0: TZ + z0, z1: TZ + z1, y0, y1: y0 + h });
  const colCircle = (x, z, r, h) => { const o = { x: TX + x, z: TZ + z, r }; if (h !== undefined) o.h = h; zone.obstacles.push(o); return o; };
  const cover = (x, z, r, h) => covers.push(colCircle(x, z, r, h));
  const sign = (slot, x, y, z, w, h, dir) => signs.push({ slot, x, y, z, w, h, ry: dir > 0 ? 0 : Math.PI });
  const windowAt = (x, y, fz, dir, w = 0.95, h = 1.2) => {
    win.add(Box(w, h, 0.08), WHITE, x, y, fz + dir * 0.05);
    const a = dir > 0 ? fz : fz - 0.03, c = dir > 0 ? fz + 0.03 : fz;
    rect(x - w / 2 - 0.12, x + w / 2 + 0.12, a, c, y - h / 2 - 0.12, y + h / 2 + 0.12, 0xd9ceb0);
  };
  const barrel = (x, z) => {
    b.add(Cyl(0.34, 0.34, 0.92, 8), 0x6e4b2a, x, 0.46, z).add(Cyl(0.355, 0.355, 0.05, 8), 0x2c2c30, x, 0.22, z).add(Cyl(0.355, 0.355, 0.05, 8), 0x2c2c30, x, 0.7, z);
    cover(x, z, 0.42, 0.95);
  };
  const crate = (x, z, s = 0.9, yaw = 0, color = 0x8a6a42) => {
    b.add(Box(s, s, s), color, x, s / 2, z, 0, yaw, 0).add(Box(s + 0.04, 0.08, s + 0.04), 0x5a4026, x, s * 0.2, z, 0, yaw, 0).add(Box(s + 0.04, 0.08, s + 0.04), 0x5a4026, x, s * 0.8, z, 0, yaw, 0);
    cover(x, z, s * 0.78, s + 0.1);
  };
  const lamp = (x, z) => {
    b.add(Cyl(0.06, 0.08, 3.2, 6), 0x2a2a2e, x, 1.6, z).add(Box(0.5, 0.06, 0.06), 0x2a2a2e, x + 0.2, 3.1, z);
    lan.add(Box(0.26, 0.34, 0.26), WHITE, x + 0.4, 2.9, z);
    colCircle(x, z, 0.15, 3.2);
  };
  const rail = (x0, x1, z) => {
    post(x0, z, 1.1, 0x5a3d26, 0.07); post(x1, z, 1.1, 0x5a3d26, 0.07);
    b.add(Box(x1 - x0, 0.09, 0.09), 0x6b4a2e, (x0 + x1) / 2, 0.95, z);
    zone.boxes.push({ x0: TX + x0, x1: TX + x1, z0: TZ + z - 0.12, z1: TZ + z + 0.12, y0, y1: y0 + 1.0 });
  };

  /* ---- edificio genérico con fachada hacia la calle ---- */
  // dir=+1: fachada hacia +z (lado norte, z<0). dir=-1: fachada hacia -z (lado sur, z>0).
  function building(o) {
    const { x0, x1, z0, z1, dir, h, wall, trim, roof, doorX, doorW = 1.4, doorH = 2.4 } = o;
    const T = 0.3, fz = dir > 0 ? z1 : z0, bz = dir > 0 ? z0 : z1;
    const f0 = Math.min(fz, fz - dir * T), f1 = Math.max(fz, fz - dir * T);
    const wallBox = (ax, bx, az, bz2, ya = 0, yb = h) => {
      rect(ax, bx, az, bz2, ya, yb, wall);
      for (let y = 1.0; y < yb - 0.3; y += 1.15) rect(ax - 0.02, bx + 0.02, az - 0.02, bz2 + 0.02, y, y + 0.09, trim);
    };
    wallBox(x0, x0 + T, z0, z1); wallBox(x1 - T, x1, z0, z1);
    wallBox(x0, x1, Math.min(bz, bz + dir * T), Math.max(bz, bz + dir * T));
    wallBox(x0 + T, doorX - doorW / 2, f0, f1); wallBox(doorX + doorW / 2, x1 - T, f0, f1);
    wallBox(doorX - doorW / 2, doorX + doorW / 2, f0, f1, doorH, h);
    const dz0 = dir > 0 ? fz : fz - 0.1, dz1 = dir > 0 ? fz + 0.1 : fz;
    rect(doorX - doorW / 2 + 0.05, doorX + doorW / 2 - 0.05, dz0, dz1, 0, doorH - 0.05, 0x2c1e14);
    rect(doorX - doorW / 2 - 0.1, doorX - doorW / 2 + 0.05, dz0, dz1, 0, doorH, trim); rect(doorX + doorW / 2 - 0.05, doorX + doorW / 2 + 0.1, dz0, dz1, 0, doorH, trim);
    colBox(x0, x1, z0, z1, o.parapet ? o.parapet + 0.3 : h + (o.rise || 0));
    doors.push(L(doorX, fz + dir * 1.5));
    const cx = (x0 + x1) / 2, w = x1 - x0, d = z1 - z0;
    if (o.parapet) {   // fachada falsa del Oeste: pretil + cornisa, techo casi plano detrás
      const pz0 = dir > 0 ? fz - T : fz - 0.05, pz1 = dir > 0 ? fz + 0.05 : fz + T;
      rect(x0 - 0.1, x1 + 0.1, pz0, pz1, h, o.parapet, wall);
      rect(x0 - 0.3, x1 + 0.3, pz0 - 0.1 * dir, pz1 + 0.1 * dir + (dir > 0 ? 0.25 : -0.25), o.parapet, o.parapet + 0.3, trim);
      for (let x = x0 + 1.2; x < x1 - 0.6; x += 2.4) rect(x, x + 0.12, dir > 0 ? fz : fz - 0.05, dir > 0 ? fz + 0.05 : fz, h + 0.2, o.parapet - 0.2, trim);
      slab(cx, h + 0.1, (z0 + z1) / 2, w - 0.2, 0.2, d - 0.2, dir * 0.06, 0, 0, roof);
    } else {            // tejado a dos aguas con la cumbrera de frente a fondo
      const rise = o.rise, ang = Math.atan2(rise, w / 2), sl = Math.hypot(w / 2, rise) + 0.5;
      slab(x0 + w / 4, h + rise / 2, (z0 + z1) / 2, sl, 0.18, d + 0.7, 0, 0, ang, roof);
      slab(x1 - w / 4, h + rise / 2, (z0 + z1) / 2, sl, 0.18, d + 0.7, 0, 0, -ang, roof);
      [z0 - 0.05, z1 - 0.05].forEach((gz) => b.add(Cyl(1, 1, 0.12, 3), wall, cx, h + rise / 3, gz + 0.05, -Math.PI / 2, 0, 0, w / 1.732, 1, rise / 1.5));
    }
    return { fz, cx, w, d };
  }
  // Porche / acera de madera con postes y techado (opcionalmente balcón).
  function porch(o) {
    const { x0, x1, fz, dir, depth, roofY, roof, doorX } = o;
    const w = x1 - x0, cx = (x0 + x1) / 2, pz = fz + dir * depth / 2;
    b.add(Box(w + 0.6, 0.14, depth), 0x6a4a30, cx, 0.07, pz);
    slab(cx, roofY, pz + dir * 0.2, w + 0.8, 0.16, depth + 0.4, dir * 0.04, 0, 0, roof);
    // Postes simétricos respecto a la puerta (nunca delante de ella) y cada ~3.6 m hacia los extremos.
    const xs = [], addPost = (x) => { if (x > x0 + 0.1 && x < x1 - 0.1 && xs.every((v) => Math.abs(v - x) > 1.4)) xs.push(x); };
    for (let k = 0; k < 8; k++) { addPost(doorX - 2.2 - k * 3.6); addPost(doorX + 2.2 + k * 3.6); }
    if (Math.abs(x0 + 0.15 - doorX) > 1.6) addPost(x0 + 0.15);
    if (Math.abs(x1 - 0.15 - doorX) > 1.6) addPost(x1 - 0.15);
    for (const px of xs) { post(px, fz + dir * (depth - 0.2), roofY, 0x5a3d26); colCircle(px, fz + dir * (depth - 0.2), 0.14, roofY); }
    return pz;
  }

  /* ================= LADO NORTE (z < 0): saloon, sheriff, celda, tienda ================= */
  // --- Saloon (dos plantas, balcón) ---
  {
    const o = { x0: -24, x1: -8, z0: -19, z1: -8, dir: 1, h: 4.4, parapet: 6.1, wall: 0x8c4a35, trim: 0xd9c7a0, roof: 0x4a3a30, doorX: -16, doorW: 2.4, doorH: 2.5 };
    const r = building(o), fz = r.fz;
    [-21.2, -19, -13, -10.8].forEach((x) => windowAt(x, 1.6, fz, 1, 1.0, 1.3));
    [-22.2, -19.4, -16.6, -13.8, -11, -9.4 + 0.0].slice(0, 5).forEach((x) => windowAt(x, 3.6, fz, 1));
    porch({ x0: -23.6, x1: -8.4, fz, dir: 1, depth: 2.9, roofY: 3.05, roof: 0x4a3a30, doorX: -16 });
    for (let x = -23.4; x <= -8.6; x += 1.45) b.add(Cyl(0.04, 0.04, 0.9, 4), 0x5a3d26, x, 3.05 + 0.45, fz + 2.62);   // balaustres del balcón
    b.add(Box(15.2, 0.08, 0.1), 0x6b4a2e, -16, 3.95, fz + 2.62);
    b.add(Box(0.8, 1.0, 0.05), 0x7a4a2c, -16.45, 1.35, fz + 0.1, 0, 0.35, 0).add(Box(0.8, 1.0, 0.05), 0x7a4a2c, -15.55, 1.35, fz + 0.1, 0, -0.35, 0);
    sign(0, -16, 5.15, fz + 0.12, 4.4, 1.1, 1);
    barrel(-23.1, -6.6); barrel(-22.3, -7.1); crate(-9.3, -6.9, 0.8, 0.3);
    lamp(-20, -4.7); lamp(-10.5, -4.7);
    rail(-21, -17, -4.5); rail(-14, -10, -4.5);
  }
  // --- Oficina del Sheriff ---
  {
    const o = { x0: -6, x1: 5.5, z0: -18, z1: -8, dir: 1, h: 3.6, parapet: 4.7, wall: 0xa08a62, trim: 0xe6dcc0, roof: 0x3c3430, doorX: -0.5, doorW: 1.6, doorH: 2.4 };
    const r = building(o), fz = r.fz;
    [-4.3, -2.6, 1.7, 3.5].forEach((x) => windowAt(x, 1.6, fz, 1));
    porch({ x0: -5.6, x1: 5.1, fz, dir: 1, depth: 2.4, roofY: 2.8, roof: 0x3c3430, doorX: -0.5 });
    b.add(Cyl(0.38, 0.38, 0.06, 5), 0xd8b040, -0.5, 4.15, fz + 0.1, Math.PI / 2, 0, 0).add(Cyl(0.18, 0.18, 0.07, 5), 0xa07820, -0.5, 4.15, fz + 0.12, Math.PI / 2, 0, 0);
    sign(1, -0.5, 3.3, fz + 0.1, 2.9, 0.73, 1);
    // Celda: jaula adosada, visible desde la calle por el callejón entre la oficina y la tienda.
    rect(5.9, 10.1, -17.6, -17.3, 0, 3.0, 0x7a5a3c); rect(5.9, 6.1, -17.6, -12.4, 0, 3.0, 0x7a5a3c);
    b.add(Box(4.2, 0.12, 5.2), 0x2a2420, 8, 0.06, -15) .add(Box(4.7, 0.2, 5.6), 0x3c3430, 8, 3.1, -15);
    for (let x = 6.3; x <= 9.9; x += 0.3) b.add(Cyl(0.03, 0.03, 2.95, 5), 0x2a2a2e, x, 1.48, -12.45);
    for (let z = -17.2; z <= -12.6; z += 0.3) b.add(Cyl(0.03, 0.03, 2.95, 5), 0x2a2a2e, 10.05, 1.48, z);
    [0.4, 1.5, 2.85].forEach((y) => { b.add(Box(3.9, 0.06, 0.06), 0x2a2a2e, 8, y, -12.45); b.add(Box(0.06, 0.06, 4.7), 0x2a2a2e, 10.05, y, -15); });
    b.add(Box(1.7, 0.4, 0.55), 0x6a4a30, 7, 0.3, -17.0).add(Cyl(0.18, 0.15, 0.3, 7), 0x55555a, 9.3, 0.15, -16.6);
    colBox(5.9, 10.1, -17.6, -12.4, 3.2);
    // Tablón de recompensas, en el porche a la izquierda de la puerta
    const bx = -4.4, bz = -6.5;
    post(bx - 0.95, bz, 2.6, 0x5a3d26, 0.07); post(bx + 0.95, bz, 2.6, 0x5a3d26, 0.07);
    rect(bx - 1.05, bx + 1.05, bz - 0.06, bz + 0.06, 0.9, 2.3, 0x6b4a2e);
    slab(bx, 2.62, bz + 0.12, 2.4, 0.1, 0.9, -0.2, 0, 0, 0x3c3430);
    [[-0.55, 1.75, 0xe8dcb8], [0.0, 1.55, 0xd8c8a0], [0.55, 1.8, 0xe8dcb8], [-0.3, 1.2, 0xd0c098], [0.35, 1.25, 0xe0d0a8]].forEach(([px, py, c]) => b.add(Box(0.42, 0.55, 0.02), c, bx + px, py, bz + 0.08).add(Box(0.14, 0.14, 0.025), 0x5a4a3a, bx + px, py + 0.1, bz + 0.09));
    sign(5, bx, 2.1, bz + 0.1, 1.5, 0.375, 1);
    colBox(bx - 1.1, bx + 1.1, bz - 0.25, bz + 0.25, 2.6);
    lamp(-2, -4.7);
    boardPos = L(bx, bz + 2.0);
  }
  // --- Tienda general ---
  {
    const o = { x0: 10.5, x1: 24, z0: -18.5, z1: -8, dir: 1, h: 3.9, parapet: 5.3, wall: 0x6e7c5c, trim: 0xd9ceb0, roof: 0x45382e, doorX: 17, doorW: 2.0, doorH: 2.4 };
    const r = building(o), fz = r.fz;
    [12.9, 14.9, 19.2, 21.2].forEach((x) => windowAt(x, 1.7, fz, 1, 1.3, 1.4));
    porch({ x0: 10.9, x1: 23.6, fz, dir: 1, depth: 2.4, roofY: 2.85, roof: 0x45382e, doorX: 17 });
    sign(2, 17, 4.45, fz + 0.12, 4.0, 1.0, 1);
    barrel(11.6, -6.8); barrel(12.4, -7.1); crate(13.5, -6.9, 0.8, 0.2); crate(14.35, -6.7, 0.65, 0.5, 0x9a7a52);
    b.add(Box(0.7, 0.5, 0.5), 0xb89a62, 20.1, 0.25, -7.0).add(Box(0.6, 0.4, 0.45), 0xa88a52, 20.2, 0.7, -7.0, 0, 0.3, 0);   // sacos
    lamp(13, -4.7); lamp(22, -4.7);
    rail(12, 16, -4.5); rail(19, 23, -4.5);
  }

  /* ================= LADO SUR (z > 0): establo, casas, telégrafo ================= */
  // --- Establo (abierto por delante, cobertizo con boxes) ---
  {
    const x0 = -24, x1 = -8, z0 = 8, z1 = 19.5, wall = 0x7a5a3c, trim = 0x5a4026;
    const wallBox = (ax, bx, az, bz2, ya, yb) => { rect(ax, bx, az, bz2, ya, yb, wall); for (let y = 0.7; y < yb - 0.2; y += 0.9) rect(ax - 0.02, bx + 0.02, az - 0.02, bz2 + 0.02, y, y + 0.08, trim); };
    wallBox(x0, x1, 19.2, 19.5, 0, 3.4); wallBox(x0, x0 + 0.3, z0, 19.5, 0, 3.2); wallBox(x1 - 0.3, x1, z0, 19.5, 0, 3.2);
    colBox(x0, x1, 19.1, 19.6, 3.4); colBox(x0, x0 + 0.3, z0, 19.5, 3.2); colBox(x1 - 0.3, x1, z0, 19.5, 3.2);
    [-20, -16, -12].forEach((dx) => { rect(dx - 0.1, dx + 0.1, 11.5, 19.1, 0, 1.5, 0x8a6a46); rect(dx - 0.12, dx + 0.12, 11.5, 19.1, 1.45, 1.55, trim); colBox(dx - 0.1, dx + 0.1, 11.5, 19.1, 1.5); });
    slab((x0 + x1) / 2, 3.9, 14.0, x1 - x0 + 1.0, 0.18, 12.4, 0.1, 0, 0, 0x4a3a2c);
    [-23.6, -19.2, -14.5, -9.8, -8.4].forEach((px) => { post(px, 8.5, 4.3, 0x5a3d26, 0.13); colCircle(px, 8.5, 0.15, 4.3); });
    b.add(Box(x1 - x0, 0.3, 0.3), 0x5a3d26, (x0 + x1) / 2, 4.2, 8.5);
    sign(3, -16, 3.55, 8.35, 3.4, 0.85, -1);
    [[-22, 18.4], [-21.2, 18.5], [-17.8, 18.4], [-13.6, 18.5], [-9.6, 18.3]].forEach(([hx, hz]) => { b.add(Box(1.0, 0.55, 0.6), 0xc9a94a, hx, 0.28, hz, 0, 0.2, 0).add(Box(0.9, 0.12, 0.5), 0xd8b85a, hx, 0.6, hz, 0, 0.2, 0); });
    cover(-22.2, 18.4, 0.7, 0.7);
    b.add(Box(3.4, 0.55, 0.7), 0x5a4026, -15.5, 0.5, 6.4).add(Box(3.0, 0.1, 0.5), 0x2a4a5a, -15.5, 0.78, 6.4);
    colBox(-17.2, -13.8, 6.0, 6.8, 0.8);
    crate(-9.4, 7.2, 0.8, 0.4);
    rail(-23, -19, 4.6);
    doors.push(L(-16, 6.8));
  }
  // --- Casa de Clara (cara oeste de la calle sur) ---
  {
    const o = { x0: -3.5, x1: 5, z0: 9, z1: 17.5, dir: -1, h: 3.0, rise: 1.7, wall: 0xb59f7c, trim: 0xefe4c8, roof: 0x5a3a2a, doorX: 0.75, doorW: 1.2, doorH: 2.2 };
    const r = building(o);
    [-2, 3.5].forEach((x) => windowAt(x, 1.6, r.fz, -1, 0.9, 1.2));
    porch({ x0: -3.1, x1: 4.6, fz: r.fz, dir: -1, depth: 1.7, roofY: 2.6, roof: 0x5a3a2a, doorX: 0.75 });
    b.add(Box(0.8, 0.5, 0.5), 0x7a5a36, 3.7, 0.3, 7.6).add(Cyl(0.3, 0.3, 0.5, 8), 0x6e4b2a, -2.6, 0.25, 7.5);
    rail(-2, 2, 4.6);
  }
  // --- Clínica del doctor ---
  {
    const o = { x0: 7.5, x1: 16, z0: 9, z1: 17.5, dir: -1, h: 3.1, rise: 1.8, wall: 0x6f8797, trim: 0xe6e2d4, roof: 0x3e3a3a, doorX: 11.75, doorW: 1.3, doorH: 2.3 };
    const r = building(o);
    [9.2, 14.2].forEach((x) => windowAt(x, 1.6, r.fz, -1, 1.0, 1.2));
    porch({ x0: 7.9, x1: 15.6, fz: r.fz, dir: -1, depth: 1.7, roofY: 2.65, roof: 0x3e3a3a, doorX: 11.75 });
    sign(7, 11.75, 3.55, r.fz - 0.1, 2.6, 0.65, -1);
    rail(9, 13, 4.6);
  }
  // --- Telégrafo ---
  {
    const o = { x0: 18.5, x1: 24.5, z0: 9.5, z1: 16.5, dir: -1, h: 3.0, rise: 1.5, wall: 0x9a8a78, trim: 0xe6dcc0, roof: 0x4a3a30, doorX: 21.5, doorW: 1.2, doorH: 2.2 };
    const r = building(o);
    windowAt(19.8, 1.6, r.fz, -1, 0.8, 1.1); windowAt(23.2, 1.6, r.fz, -1, 0.8, 1.1);
    sign(6, 21.5, 3.35, r.fz - 0.1, 2.4, 0.6, -1);
    barrel(18.6, 8.2); crate(24.2, 8.2, 0.7, 0.3);
    post(27.5, 6, 6.5, 0x4a3420, 0.1); b.add(Box(0.14, 0.12, 1.6), 0x4a3420, 27.5, 6.2, 6).add(Box(0.14, 0.12, 1.2), 0x4a3420, 27.5, 5.7, 6);
    colCircle(27.5, 6, 0.2, 6.5);
  }

  /* ================= Centro y entrada ================= */
  {   // pozo
    const wx = 3, wz = 0.5;
    b.add(Cyl(1.0, 1.06, 0.9, 10), 0x7d756c, wx, 0.45, wz).add(Cyl(0.78, 0.78, 0.06, 10), 0x16242e, wx, 0.88, wz);
    post(wx - 0.92, wz, 2.5, 0x5a3d26, 0.08); post(wx + 0.92, wz, 2.5, 0x5a3d26, 0.08);
    b.add(Cyl(1, 1, 0.1, 3), 0x5a3a2a, wx, 2.5 + 0.2, wz, -Math.PI / 2, Math.PI / 2, 0, 1.0, 1, 0.25).add(Cyl(0.04, 0.04, 1.9, 5), 0x4a3420, wx, 2.0, wz, 0, 0, Math.PI / 2)
      .add(Cyl(0.16, 0.13, 0.22, 7), 0x6e4b2a, wx, 1.45, wz);
    colCircle(wx, wz, 1.25, 2.6);
    lamp(1, 3.6);
  }
  {   // arco de entrada oeste (cruza el camino)
    const ax = -31;
    post(ax, -5, 4.6, 0x5a3d26, 0.17); post(ax, 5, 4.6, 0x5a3d26, 0.17);
    b.add(Box(0.35, 0.4, 10.6), 0x5a3d26, ax, 4.55, 0);
    colCircle(ax, -5, 0.3, 4.6); colCircle(ax, 5, 0.3, 4.6);
    sign(4, ax - 0.2, 3.7, 0, 3.6, 0.9, 1); signs[signs.length - 1].ry = -Math.PI / 2;
    lamp(-28, 4.6); lamp(-28, -4.6);
  }
  {   // torre de agua: referencia visual desde lejos
    const wx = 31, wz = -13;
    [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]].forEach(([dx, dz]) => b.add(Cyl(0.14, 0.2, 7.2, 6), 0x4a3420, wx + dx * 0.95, 3.6, wz + dz * 0.95, dz * 0.04, 0, -dx * 0.04));
    b.add(Box(3.0, 0.14, 0.1), 0x4a3420, wx, 2.2, wz - 1.3).add(Box(3.0, 0.14, 0.1), 0x4a3420, wx, 2.2, wz + 1.3);
    b.add(Cyl(1.85, 1.85, 2.6, 10), 0x6e4e30, wx, 8.5, wz).add(Cyl(1.9, 1.9, 0.1, 10), 0x2c2c30, wx, 7.5, wz).add(Cyl(1.9, 1.9, 0.1, 10), 0x2c2c30, wx, 9.5, wz)
      .add(new THREE.ConeGeometry(2.1, 1.2, 10), 0x4a3a2c, wx, 10.4, wz);
    colCircle(wx, wz, 1.9, 10.8);
  }
  // Barricadas y cajas sueltas en el centro: cobertura para tiroteos
  crate(-3.5, 3.95, 0.9, 0.2); barrel(8.5, -3.4); crate(8.9, 3.95, 0.8, 0.6); barrel(-6.2, -3.5);

  /* ---- mallas finales ---- */
  const geo = b.build(); geo.translate(TX, y0, TZ);
  const mesh = new THREE.Mesh(geo, MAT.vcDouble);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh); world.solidTargets.push(mesh);

  const wGeo = win.build(); wGeo.translate(TX, y0, TZ);
  const windows = new THREE.Mesh(wGeo, new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x26323e }));
  scene.add(windows);
  const lGeo = lan.build(); lGeo.translate(TX, y0, TZ);
  const lanterns = new THREE.Mesh(lGeo, new THREE.MeshBasicMaterial({ vertexColors: true, color: 0x6a5a40 }));
  scene.add(lanterns);

  const atlas = makeSignAtlas();
  const sGeo = buildSignGeometry(signs); sGeo.translate(TX, y0, TZ);
  const signMesh = new THREE.Mesh(sGeo, new THREE.MeshLambertMaterial({ map: atlas, side: THREE.DoubleSide }));
  scene.add(signMesh);

  // Cofre del tendero (robable): base + tapa articulada
  const sbPos = L(22.7, -6.6);
  const chestMat = MAT.vcDouble;
  const chestBase = new THREE.Mesh(new GeoBuilder().add(Box(0.95, 0.5, 0.6), 0x6a4a2c, 0, 0.25, 0).add(Box(1.0, 0.08, 0.64), 0x2c2c30, 0, 0.12, 0).add(Box(0.08, 0.5, 0.64), 0x2c2c30, -0.3, 0.25, 0).add(Box(0.08, 0.5, 0.64), 0x2c2c30, 0.3, 0.25, 0).build(), chestMat);
  const chestLid = new THREE.Mesh(new GeoBuilder().add(Box(0.95, 0.2, 0.6), 0x7a5a38, 0, 0.1, -0.3).add(Box(0.1, 0.12, 0.08), 0xd8b040, 0, 0.0, -0.62).build(), chestMat);
  chestBase.position.copy(sbPos); chestLid.position.set(sbPos.x, sbPos.y + 0.5, sbPos.z + 0.3);
  chestBase.castShadow = chestLid.castShadow = true;
  scene.add(chestBase, chestLid);
  zone.obstacles.push({ x: sbPos.x, z: sbPos.z, r: 0.55, h: 0.6 });

  const spots = {
    hattie: L(17, -6.7), sheriff: L(1.6, -6.9), clara: L(-0.3, 6.6), pruitt: L(-11.4, -6.7), sal: L(-19.2, -6.7), tomas: L(-14, 16.8), tomasCell: L(8, -15.2),
    cellDoor: L(8, -11.4), jailExit: L(8.2, -9.6),
    sheriffPatrol: [L(-2, -6.7), L(4, -6.7), L(4, -4)], deputyPatrolA: [L(-26, 2.4), L(26, 2.4)], deputyPatrolB: [L(26, -2.4), L(-26, -2.4)],
  };

  return {
    id: CONFIG.TOWN.id, name: CONFIG.TOWN.name, center: new THREE.Vector3(TX, y0, TZ), y0, radius, mesh, windows, lanterns, signMesh, zone, covers, doors,
    board: { pos: boardPos }, strongbox: { pos: sbPos, base: chestBase, lid: chestLid }, spots, local: L,
    // De noche las ventanas y farolas se encienden (solo si el jugador está cerca: ahorra trabajo sin recompilar nada).
    update(night, dist, t) {
      const on = dist < 200;
      windows.visible = lanterns.visible = on;
      if (!on) return;
      windows.material.color.setRGB(0.15 + night * 0.9, 0.2 + night * 0.62, 0.26 + night * 0.28);
      const fl = 0.92 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 13.1) * 0.03;
      lanterns.material.color.setRGB((0.42 + night * 0.58) * fl, (0.34 + night * 0.4) * fl, 0.22 + night * 0.08);
    },
  };
}

export { buildTown };
