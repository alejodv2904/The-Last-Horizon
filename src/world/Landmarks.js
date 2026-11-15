// Hitos visuales de los lugares de la campaña (cabañas, vías, mina, cuevas, río, presa, hacienda, rancho, cima…).
// Cada hito es UNA malla fusionada con color por vértice (1 draw call) y se oculta lejos del jugador:
// los ~15 hitos del mapa cuestan en pantalla lo mismo que uno solo cuando estás cerca de uno.
import * as THREE from 'three';
import { _m4, _q, _e, _v1, _sc, GeoBuilder, MAT } from '../render/GeometryKit.js';
import { LOCATION_COORDS } from '../narrative/LocationMap.js';

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s = 6) => new THREE.CylinderGeometry(rt, rb, h, s);
const WOOD = 0x7a5536, WOOD2 = 0x6b4a2e, ROOF = 0x4a3a2c, ADOBE = 0xc9a77a, STONE = 0x8a8278, DARK = 0x1c1612, IRON = 0x3a3a40;

const cabin = (b, x, z, ry = 0, w = 4.6, d = 3.6, col = WOOD) => {
  b.add(Box(w, 2.5, d), col, x, 1.25, z, 0, ry, 0).add(Box(w + 0.6, 0.15, d / 2 + 0.4), ROOF, x, 2.85, z, 0.5, ry, 0)
    .add(Box(w + 0.6, 0.15, d / 2 + 0.4), ROOF, x, 2.85, z, -0.5, ry, 0).add(Box(0.9, 1.7, 0.1), DARK, x, 0.85, z + d / 2 + 0.02, 0, ry, 0);
};
const rockPile = (b, n, spread, col = STONE) => { for (let i = 0; i < n; i++) { const a = i * 2.4, r = spread * (0.2 + (i % 5) / 6), s = 1.2 + (i % 4) * 0.9; b.add(new THREE.DodecahedronGeometry(s, 0), col, Math.sin(a) * r, s * 0.4, Math.cos(a) * r, i, i * 0.7, 0, 1, 0.8, 1); } };
const fence = (b, n, radius, col = WOOD2) => { for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; b.add(Cyl(0.07, 0.08, 1.3, 5), col, Math.sin(a) * radius, 0.65, Math.cos(a) * radius).add(Box(0.07, 0.08, radius * 6.28 / n), col, Math.sin(a + Math.PI / n) * radius, 1.0, Math.cos(a + Math.PI / n) * radius, 0, a + Math.PI / n + Math.PI / 2, 0); } };

const BUILDERS = {
  town(b) { cabin(b, 0, 0, 0.2, 6, 4.4); cabin(b, 10, 4, -0.3); cabin(b, -10, 5, 0.5, 4.2, 3.4); cabin(b, 4, -11, 0.1, 5, 4); cabin(b, -8, -9, 0.7, 4, 3.4, 0x8a6a48); b.add(Box(5, 0.2, 2), WOOD2, 0, 0.1, 6); },
  rocks(b) { rockPile(b, 14, 16); },
  cave(b) { rockPile(b, 10, 8, 0x6e665c); b.add(Box(3.4, 3, 1.2), DARK, 0, 1.5, 5.6).add(Cyl(0.3, 0.35, 3.6, 6), WOOD2, -1.9, 1.7, 5.4).add(Cyl(0.3, 0.35, 3.6, 6), WOOD2, 1.9, 1.7, 5.4).add(Box(4.6, 0.4, 0.5), WOOD2, 0, 3.5, 5.3); },
  fair(b) { for (let i = 0; i < 6; i++) { const x = -15 + i * 6; b.add(Cyl(0.08, 0.1, 4.6, 5), WOOD2, x, 2.3, -6).add(Box(5.6, 0.45, 0.04), [0xb8402f, 0xe8c25a, 0x4a6a9a][i % 3], x + 3, 3.9, -6.05, 0, 0, -0.07 * (i % 2 ? 1 : -1)); } b.add(Box(9, 0.6, 5), WOOD, 0, 0.3, 4).add(Box(9.4, 0.15, 5.4), ROOF, 0, 3.5, 4, 0.12, 0, 0).add(Cyl(0.1, 0.12, 3.2, 5), WOOD2, -4.2, 1.6, 6.2).add(Cyl(0.1, 0.12, 3.2, 5), WOOD2, 4.2, 1.6, 6.2); },
  farm(b) { cabin(b, 0, 0, 0.3, 5.2, 4); b.add(Box(8, 4.2, 6), 0x8a3a2a, 14, 2.1, -4, 0, 0.2, 0).add(Box(8.6, 0.2, 3.6), ROOF, 14, 4.6, -5.2, 0.5, 0.2, 0).add(Box(8.6, 0.2, 3.6), ROOF, 14, 4.6, -2.8, -0.5, 0.2, 0); fence(b, 14, 9, WOOD2); },
  ranchBig(b) { cabin(b, 0, 0, 0, 12, 7, 0xd8d0b8); b.add(Box(13, 0.2, 5), ROOF, 0, 3.6, 2.2, 0.35, 0, 0).add(Box(13, 0.2, 5), ROOF, 0, 3.6, -2.2, -0.35, 0, 0); cabin(b, 18, 5, 0.1, 6, 5, WOOD); fence(b, 18, 12, WOOD2); },
  hacienda(b) { b.add(Box(14, 3.4, 1), ADOBE, 0, 1.7, -7).add(Box(14, 3.4, 1), ADOBE, 0, 1.7, 7).add(Box(1, 3.4, 14), ADOBE, -7, 1.7, 0).add(Box(1, 3.4, 14), ADOBE, 7, 1.7, 0).add(Box(15, 0.3, 2.4), 0x9a4a2a, 0, 3.55, -7).add(Box(15, 0.3, 2.4), 0x9a4a2a, 0, 3.55, 7).add(Cyl(0.3, 0.35, 4.4, 6), ADOBE, 0, 2.2, 0).add(Box(3, 0.3, 3), 0x6a6a72, 0, 0.15, 0); },
  dam(b) { b.add(Box(30, 3.4, 2.4), STONE, 0, 1.7, 0).add(Box(4, 2.2, 3), WOOD2, -8, 3.4, 0).add(Box(4, 2.2, 3), WOOD2, 0, 3.4, 0).add(Box(4, 2.2, 3), WOOD2, 8, 3.4, 0).add(Box(7, 4.4, 6), WOOD, 18, 2.2, 0).add(Cyl(2.6, 2.6, 0.6, 12), IRON, 21, 3.8, 0, 0, 0, Math.PI / 2); },
  tracks(b) { for (let i = -30; i <= 30; i++) b.add(Box(3, 0.14, 0.34), WOOD2, 0, 0.1, i * 3); b.add(Box(0.14, 0.2, 180), IRON, -0.74, 0.25, 0).add(Box(0.14, 0.2, 180), IRON, 0.74, 0.25, 0).add(Box(6, 3.4, 5), WOOD, 10, 1.7, 14).add(Box(6.6, 0.2, 5.6), ROOF, 10, 3.5, 14); },
  mine(b) { b.add(Box(0.5, 4.4, 0.5), WOOD2, -2.2, 2.2, 0).add(Box(0.5, 4.4, 0.5), WOOD2, 2.2, 2.2, 0).add(Box(5.4, 0.5, 0.6), WOOD2, 0, 4.4, 0).add(Box(3.8, 3.8, 0.4), DARK, 0, 1.9, -0.2); rockPile(b, 9, 9, 0x7a6a5a); cabin(b, 12, 6, 0.4, 5, 4, 0x6a5a48); b.add(Box(1.6, 0.8, 1.1), IRON, -4, 0.7, 4).add(Box(18, 0.1, 0.3), IRON, -4, 0.15, 1); },
  pueblo(b) { for (let i = 0; i < 7; i++) { const a = i * 0.9, r = 9 + (i % 3) * 3.4; b.add(Box(4, 2.6, 3.6), ADOBE, Math.sin(a) * r, 1.3, Math.cos(a) * r, 0, a, 0).add(Box(4.4, 0.25, 4), 0x8a5a3a, Math.sin(a) * r, 2.7, Math.cos(a) * r, 0, a, 0); } b.add(Cyl(0.9, 1.1, 1.2, 8), STONE, 0, 0.6, 0).add(Cyl(0.7, 0.7, 0.1, 8), 0x2a6aa0, 0, 1.22, 0); },
  prison(b) { b.add(Box(24, 5, 1.2), STONE, 0, 2.5, -10).add(Box(24, 5, 1.2), STONE, 0, 2.5, 10).add(Box(1.2, 5, 20), STONE, -12, 2.5, 0).add(Box(1.2, 5, 20), STONE, 12, 2.5, 0).add(Box(6, 8, 6), 0x6e665c, 0, 4, 0).add(Box(2.4, 3.2, 1.3), DARK, 0, 1.6, 10); },
  peak(b) { b.add(Box(5, 3, 5), WOOD, 0, 1.5, 0).add(Box(6, 0.2, 3.2), ROOF, 0, 3.15, 1.4, 0.45, 0, 0).add(Box(6, 0.2, 3.2), ROOF, 0, 3.15, -1.4, -0.45, 0, 0).add(Box(0.9, 1.6, 0.1), DARK, 0, 0.8, 2.52).add(Cyl(0.06, 0.08, 6, 5), WOOD2, 3.4, 3, 0).add(Box(1.4, 0.8, 0.04), 0xb8402f, 4.1, 5.4, 0); rockPile(b, 8, 7, 0xd8e2e8); },
};

function riverMesh(world, cx, cz) {   // cinta de agua azul que serpentea de norte a sur siguiendo el terreno
  const pts = [], N = 70, half = 8;
  for (let i = 0; i <= N; i++) { const z = cz - 330 + i * 10, x = cx + Math.sin(i * 0.18) * 14; pts.push([x, z]); }
  const pos = [], idx = [], col = [];
  pts.forEach(([x, z], i) => {
    const y = world.getHeightAt(x, z) + 0.28;
    pos.push(x - half, y, z, x + half, y, z); col.push(0.18, 0.36, 0.5, 0.18, 0.36, 0.5);
    if (i < pts.length - 1) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
  const m = new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false, side: THREE.DoubleSide }));
  m.frustumCulled = false; return m;
}

function buildLandmarks(world) {
  const items = [];
  for (const [id, loc] of Object.entries(LOCATION_COORDS)) {
    if (!loc.kind || (loc.kind !== 'river' && !BUILDERS[loc.kind])) continue;
    const y0 = world.getHeightAt(loc.x, loc.z);
    let mesh;
    if (loc.kind === 'river') mesh = riverMesh(world, loc.x, loc.z);
    else {
      const builder = new GeoBuilder(); BUILDERS[loc.kind](builder);
      const geo = builder.build();
      _m4.compose(_v1.set(loc.x, y0, loc.z), _q.setFromEuler(_e.set(0, (id.length * 0.7) % 6.28, 0, 'YXZ')), _sc.set(1, 1, 1)); geo.applyMatrix4(_m4);
      mesh = new THREE.Mesh(geo, MAT.vcDouble); mesh.castShadow = true; mesh.receiveShadow = true;
    }
    mesh.visible = false; world.scene.add(mesh);
    // obstáculo circular (broad-phase) para que no se pueda atravesar el núcleo del hito
    items.push({ id, loc, mesh, shown: false });
    if (loc.kind !== 'river' && loc.kind !== 'tracks') world.staticObstacles.push({ x: loc.x, z: loc.z, r: Math.min(3.2, loc.r * 0.12) });
  }
  const SHOW = 480;
  return {
    items,
    update(p) { for (const it of items) { const d = Math.hypot(p.x - it.loc.x, p.z - it.loc.z), on = d < SHOW; if (on !== it.shown) { it.shown = on; it.mesh.visible = on; } } },
    get(id) { return items.find((i) => i.id === id) || null; },
  };
}

export { buildLandmarks };
