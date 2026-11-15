// Props del campamento vivo (Fase 4). Coordenadas locales al campamento (CONFIG.CAMP).
//  - Estáticos fusionados en 1 malla: Caja de Contribuciones, Libro de Contabilidad, leña y mesa de cocina.
//  - Un cartel doble en 1 textura.
//  - 3 mallas de mejora, ocultas hasta comprarlas en el libro (Carreta de Municiones, Botiquín, Tienda Mejorada).
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { _m4, _q, _e, _v1, _sc, mergeGeos, GeoBuilder, MAT } from '../render/GeometryKit.js';

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s);

function makeSigns() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  [['CONTRIBUCIONES', 'Para el campamento'], ['LIBRO DE CUENTAS', 'Mejoras · Fondos']].forEach(([t, s], i) => {
    const y = i * 128;
    g.fillStyle = '#5b3d22'; g.fillRect(0, y, 512, 128); g.strokeStyle = '#2e1d0e'; g.lineWidth = 10; g.strokeRect(5, y + 5, 502, 118);
    g.fillStyle = '#ead7a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `bold ${t.length > 14 ? 42 : 48}px Georgia`; g.fillText(t, 256, y + 50); g.font = 'italic 26px Georgia'; g.fillText(s, 256, y + 98);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function buildCampLife(world) {
  const cx = CONFIG.CAMP.x, cz = CONFIG.CAMP.z, scene = world.scene, obs = world.staticObstacles;
  const W = (x, z) => new THREE.Vector3(cx + x, world.getHeightAt(cx + x, cz + z), cz + z);
  const place = (gb, x, z, yaw = 0) => {
    const g = gb.build();
    _m4.compose(_v1.set(cx + x, world.getHeightAt(cx + x, cz + z), cz + z), _q.setFromEuler(_e.set(0, yaw, 0, 'YXZ')), _sc.set(1, 1, 1));
    g.applyMatrix4(_m4); return g;
  };
  const circ = (x, z, r, h) => obs.push({ x: cx + x, z: cz + z, r, h });

  /* ---- estáticos ---- */
  const parts = [];
  // Caja de Contribuciones (3, -5.2): arca con ranura sobre un poste
  parts.push(place(new GeoBuilder()
    .add(Box(0.95, 0.75, 0.7), 0x6a4a2c, 0, 0.62, 0).add(Box(1.0, 0.08, 0.74), 0x2c2c30, 0, 0.3, 0).add(Box(1.0, 0.1, 0.76), 0x7a5a38, 0, 1.03, 0)
    .add(Box(0.45, 0.02, 0.06), 0x15100a, 0, 1.09, 0).add(Box(0.9, 0.3, 0.6), 0x5a3d26, 0, 0.15, 0).add(Cyl(0.06, 0.07, 2.0, 5), 0x5a3d26, 0.7, 1.0, 0.1), 3.0, -5.2, 0.15));
  circ(3.0, -5.2, 0.7, 1.1);
  // Libro de Contabilidad: mesa, libro abierto, tintero y banqueta
  parts.push(place(new GeoBuilder()
    .add(Box(1.7, 0.08, 0.85), 0x7a5a38, 0, 0.9, 0)
    .add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, -0.75, 0.45, -0.35).add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, 0.75, 0.45, -0.35)
    .add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, -0.75, 0.45, 0.35).add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, 0.75, 0.45, 0.35)
    .add(Box(0.55, 0.04, 0.4), 0xe8dcb8, -0.1, 0.96, 0, 0, 0.1, 0).add(Box(0.04, 0.05, 0.4), 0x5a2a20, -0.1, 0.96, 0, 0, 0.1, 0)
    .add(Cyl(0.05, 0.05, 0.1, 6), 0x15161a, 0.5, 0.99, 0.1).add(Box(0.45, 0.35, 0.4), 0x6a4a30, 0.2, 0.18, 1.0), -0.6, -5.7, -0.1));
  circ(-0.6, -5.7, 1.0, 1.0);
  // Mesa de cocina de Rosa
  parts.push(place(new GeoBuilder()
    .add(Box(1.5, 0.07, 0.75), 0x8a6a42, 0, 0.88, 0).add(Cyl(0.05, 0.06, 0.88, 5), 0x5a3d26, -0.65, 0.44, -0.3).add(Cyl(0.05, 0.06, 0.88, 5), 0x5a3d26, 0.65, 0.44, 0.3)
    .add(Cyl(0.05, 0.06, 0.88, 5), 0x5a3d26, 0.65, 0.44, -0.3).add(Cyl(0.05, 0.06, 0.88, 5), 0x5a3d26, -0.65, 0.44, 0.3)
    .add(Cyl(0.2, 0.17, 0.2, 8), 0x2a2a2e, -0.3, 1.02, 0).add(Box(0.35, 0.05, 0.25), 0xb8a888, 0.35, 0.94, 0.05), 5.0, -3.1, 0.3));
  circ(5.0, -3.1, 0.9, 1.0);
  // Leña: tocón con hacha clavada, pila de troncos y astillas
  const wood = new GeoBuilder().add(Cyl(0.36, 0.42, 0.55, 9), 0x6b4a2e, 0, 0.27, 0).add(Cyl(0.3, 0.3, 0.03, 9), 0xb08a58, 0, 0.56, 0);
  for (let r = 0; r < 3; r++) for (let i = 0; i < 4 - r; i++) wood.add(Cyl(0.15, 0.15, 1.7, 6), r % 2 ? 0x7a5536 : 0x6b4a2e, -1.2 - r * 0.05, 0.16 + r * 0.26, 1.7 + (i - (3 - r) / 2) * 0.32 + 0.0, 0, Math.PI / 2, Math.PI / 2);
  for (let i = 0; i < 7; i++) wood.add(Cyl(0.07, 0.07, 0.3, 5), 0xa07a4a, -0.3 + Math.sin(i * 2.1) * 0.7, 0.07, -0.1 + Math.cos(i * 1.7) * 0.8, Math.random(), Math.random() * 3, 1.4);
  parts.push(place(wood, -9.5, 2.0, 0));
  circ(-9.5, 2.0, 0.5, 0.6); circ(-10.8, 3.7, 1.2, 0.8);
  const gParts = parts;
  const merged = mergeGeos;
  const mesh = new THREE.Mesh(merged(gParts), MAT.vcDouble);
  mesh.castShadow = true; mesh.receiveShadow = true; scene.add(mesh); world.solidTargets.push(mesh);

  // Carteles dobles (plano doble cara con UV a media textura)
  const tex = makeSigns();
  const sg = (slot, x, y, z, w, h, ry) => {
    const g = new THREE.PlaneGeometry(w, h); const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, slot === 0 ? 0.5 + uv.getY(i) * 0.5 : uv.getY(i) * 0.5);
    g.rotateY(ry); g.translate(cx + x, world.getHeightAt(cx + x, cz + z) + y, cz + z); return g;
  };
  const sgeo = new THREE.BufferGeometry();
  // cada cartel son dos planos (anverso y reverso) para que el texto se lea bien por los dos lados
  const A = sg(0, 3.7, 1.9, -5.1, 1.7, 0.42, 0.15), A2 = sg(0, 3.7, 1.9, -5.1, 1.7, 0.42, 0.15 + Math.PI), B = sg(1, -0.6, 1.7, -6.1, 1.5, 0.375, 0), B2 = sg(1, -0.6, 1.7, -6.1, 1.5, 0.375, Math.PI);
  const pos = [], nor = [], uvs = [];
  [A, A2, B, B2].forEach((g, k) => { const ng = g.toNonIndexed(); const off = k % 2 ? 0.012 : 0; for (let i = 0; i < ng.attributes.position.count; i++) { pos.push(ng.attributes.position.getX(i) + off, ng.attributes.position.getY(i), ng.attributes.position.getZ(i)); nor.push(ng.attributes.normal.getX(i), ng.attributes.normal.getY(i), ng.attributes.normal.getZ(i)); uvs.push(ng.attributes.uv.getX(i), ng.attributes.uv.getY(i)); } });
  sgeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sgeo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); sgeo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  sgeo.computeBoundingSphere();
  const signMesh = new THREE.Mesh(sgeo, new THREE.MeshLambertMaterial({ map: tex })); scene.add(signMesh);
  // poste del cartel del libro
  const post2 = new THREE.Mesh(merged([place(new GeoBuilder().add(Cyl(0.05, 0.06, 1.9, 5), 0x5a3d26, 0, 0.95, 0).add(Cyl(0.05, 0.06, 1.9, 5), 0x5a3d26, 1.1, 0.95, 0), -1.15, -6.1, 0)]), MAT.vcDouble);
  post2.castShadow = true; scene.add(post2);

  /* ---- mejoras (ocultas) ---- */
  const upMesh = (gb, x, z, yaw = 0) => { const m = new THREE.Mesh(merged([place(gb, x, z, yaw)]), MAT.vcDouble); m.visible = false; m.castShadow = true; m.receiveShadow = true; scene.add(m); return m; };
  const ammo = new GeoBuilder();
  ammo.add(Box(1.1, 0.7, 0.8), 0x5a4a32, 0, 0.35, 0).add(Box(1.0, 0.6, 0.7), 0x6a5a3c, 0.9, 0.3, 0.2, 0, 0.3, 0).add(Box(0.5, 0.3, 0.35), 0xb08a30, 0, 0.85, 0).add(Box(0.45, 0.28, 0.3), 0x9a7a28, 0.2, 1.1, 0.1, 0, 0.5, 0);
  ammo.add(Box(0.6, 0.35, 0.45), 0x6a5a3c, 0, 0.85 + 0.0, 0).add(Box(0.04, 0.5, 0.04), 0x3a2a1c, -0.5, 1.5, 0).add(Box(0.35, 0.22, 0.02), 0xc0392b, -0.33, 1.65, 0);
  const ammoUp = upMesh(ammo, 11.3, -4.4, 0.3);
  const cross = (gb, x, y, z) => gb.add(Box(0.6, 0.18, 0.04), 0xc0392b, x, y, z).add(Box(0.18, 0.6, 0.04), 0xc0392b, x, y, z);
  const med = new GeoBuilder();
  med.add(Box(1.5, 0.08, 0.8), 0xe0d8c4, 0, 0.9, 0).add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, -0.65, 0.45, -0.3).add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, 0.65, 0.45, 0.3)
    .add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, 0.65, 0.45, -0.3).add(Cyl(0.05, 0.06, 0.9, 5), 0x5a3d26, -0.65, 0.45, 0.3)
    .add(Box(0.5, 0.3, 0.35), 0x7a1a14, -0.3, 1.08, 0).add(Cyl(0.07, 0.07, 0.22, 6), 0x2e7a50, 0.25, 1.04, 0.1).add(Cyl(0.07, 0.07, 0.22, 6), 0xa0402a, 0.45, 1.04, -0.1)
    .add(Cyl(0.04, 0.04, 2.3, 5), 0x5a3d26, -0.9, 1.15, -0.5).add(Cyl(0.04, 0.04, 2.3, 5), 0x5a3d26, 0.9, 1.15, -0.5)
    .add(Box(2.2, 0.06, 1.6), 0xe8e2d0, 0, 2.3, -0.1, 0.12, 0, 0);
  cross(med, 0, 1.75, -0.55);
  const medUp = upMesh(med, 7.0, -1.0, -0.2);
  const tent = new GeoBuilder();
  tent.add(Cyl(0.05, 0.06, 2.6, 5), 0x5a3d26, -1.3, 1.3, 0).add(Cyl(0.05, 0.06, 2.6, 5), 0x5a3d26, 1.3, 1.3, 0)
    .add(Box(3.0, 0.07, 2.2), 0xb8a070, 0, 2.55, 1.0, -0.3, 0, 0).add(Box(0.5, 0.12, 0.9), 0x3a5a3a, -0.6, 0.06, 1.3).add(Box(0.5, 0.12, 0.9), 0x7a3a2a, 0.5, 0.06, 1.4, 0, 0.2, 0)
    .add(Box(0.05, 0.5, 0.05), 0x3a2a1c, 1.3, 2.8, 0).add(Box(0.45, 0.28, 0.02), 0xd8b46a, 1.5, 2.95, 0).add(Box(0.14, 0.2, 0.14), 0xffc070, -1.3, 2.4, 0.1);
  const tentUp = upMesh(tent, -4.2, 3.6, 0.45);

  obs.forEach((o) => { const d = Math.hypot(o.x - cx, o.z - cz); if (o.r === 0.5 && d > 2.5 && d < 4.3) o.passable = true; });   // troncos-asiento de la fogata
  const layout = {
    seats: [0.6, 1.9, 5.4].map((a) => ({ x: cx + Math.sin(a) * 3.3, z: cz + Math.cos(a) * 3.3, fx: cx, fz: cz })),
    tentDoors: [{ x: cx + 4.6, z: cz + 2.2 }, { x: cx - 4.0, z: cz + 4.3 }],
    chop: { x: cx - 8.5, z: cz + 2.3, fx: cx - 9.5, fz: cz + 2.0 },
    cook: [{ x: cx + 2.4, z: cz - 2.5 }, { x: cx + 4.6, z: cz - 2.0 }, { x: cx + 1.0, z: cz + 2.4 }],
    patrol: [[12, 2], [14, -8], [4, -14], [-10, -10], [-14, 0], [-9, 9], [2, 13]].map(([x, z]) => ({ x: cx + x, z: cz + z })),
    watch: { x: cx - 11.5, z: cz + 8.5, fx: cx - 30, fz: cz + 25 },
  };
  const points = { box: W(3.0, -4.1), ledger: W(-0.6, -4.6), wagon: W(10.2, -3.6), med: W(7.0, 0.4) };
  return { mesh, signMesh, upgrades: { ammo_wagon: ammoUp, medkit: medUp, tent: tentUp }, layout, points };
}

export { buildCampLife };
