// Arroyo y puente de madera en el camino al pueblo.
//  - El arroyo es una hendidura del terreno (WorldGen.creekDepth); el agua es una cinta que sigue el fondo (1 draw call).
//  - El tablero del puente NO es terreno: World.getHeightAt devuelve la altura del tablero dentro de su huella, así que jugador,
//    caballo, animales y balas lo tratan como suelo sin cambiar nada más. Las barandillas son círculos con altura:
//    bloquean el paso y sirven de cobertura baja.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { _m4, _q, _e, _v1, _sc, mergeGeos, GeoBuilder, MAT } from '../render/GeometryKit.js';

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s);

function buildBridge(world) {
  const K = CONFIG.CREEK, c = world.gen.creek, L = K.bridgeLen, W = K.bridgeWidth;
  const rx = c.roadDx, rz = c.roadDz, lx = rz, lz = -rx;           // eje del camino y eje lateral
  const hA = world.gen.getHeightAt(K.x - rx * L / 2, K.z - rz * L / 2), hB = world.gen.getHeightAt(K.x + rx * L / 2, K.z + rz * L / 2);
  const y0 = (hA + hB) / 2 + 0.02, slope = (hB - hA) / L, yaw = Math.atan2(rx, rz), pitch = -Math.atan(slope);

  const b = new GeoBuilder();
  b.add(Box(W, 0.22, L + 0.4), 0x7a5a38, 0, -0.11, 0);
  for (let z = -L / 2 + 0.3; z < L / 2; z += 0.62) b.add(Box(W, 0.03, 0.05), 0x4a3320, 0, 0.012, z);
  [-1.8, 1.8].forEach((x) => b.add(Box(0.3, 0.42, L), 0x5a4026, x, -0.45, 0));
  for (const z of [-6.2, 0, 6.2]) for (const x of [-2.3, 2.3]) b.add(Cyl(0.18, 0.22, 4.4, 6), 0x4a3420, x, -2.2, z);
  const rail = L / 2 + 0.1;
  for (const x of [-2.62, 2.62]) {
    b.add(Box(0.12, 0.1, L + 0.2), 0x6b4a2e, x, 1.05, 0).add(Box(0.1, 0.08, L + 0.2), 0x5a4026, x, 0.52, 0);
    for (let z = -rail; z <= rail + 0.01; z += 2.0) b.add(Cyl(0.08, 0.1, 1.15, 6), 0x5a3d26, x, 0.5, z);
  }
  const geo = b.build();
  _m4.compose(_v1.set(K.x, y0, K.z), _q.setFromEuler(_e.set(pitch, yaw, 0, 'YXZ')), _sc.set(1, 1, 1));
  geo.applyMatrix4(_m4);
  const mesh = new THREE.Mesh(geo, MAT.vcDouble);
  mesh.castShadow = true; mesh.receiveShadow = true;
  world.scene.add(mesh); world.solidTargets.push(mesh);

  // Colisión/cobertura de las barandillas
  const zone = world.addZone(K.x, K.z, L / 2 + 6);
  for (const side of [-1, 1]) for (let z = -L / 2 - 0.3; z <= L / 2 + 0.31; z += 1.0) {
    zone.obstacles.push({ x: K.x + lx * side * 2.78 + rx * z, z: K.z + lz * side * 2.78 + rz * z, r: 0.45, h: 1.1 });
  }
  // Cabeceras: dos postes con farol en los extremos
  // Altura del tablero para World.getHeightAt (r2 = radio² de descarte rápido)
  world.bridgeDeck = { x: K.x, z: K.z, rx, rz, lx, lz, halfL: L / 2, halfW: W / 2 - 0.05, y0: y0 - 0.0, slope, r2: (L / 2 + 4) * (L / 2 + 4) };

  // Agua: cinta que sigue el fondo del arroyo (mínimo local para que no suba por encima del cauce)
  const pts = [], step = 6, n = Math.floor(K.halfLen * 0.9 / step);
  const gh = (u) => world.gen.getHeightAt(K.x + c.dx * u, K.z + c.dz * u);
  for (let i = -n; i <= n; i++) {
    const u = i * step, y = Math.min(gh(u - 6), gh(u), gh(u + 6)) + 0.42;
    pts.push([u, y]);
  }
  const pos = [], idx = [], hw = K.width * 0.42;
  pts.forEach(([u, y], i) => {
    const cx = K.x + c.dx * u, cz = K.z + c.dz * u;
    pos.push(cx - rx * hw, y, cz - rz * hw, cx + rx * hw, y, cz + rz * hw);
    if (i) { const a = (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const wg = new THREE.BufferGeometry();
  wg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); wg.setIndex(idx); wg.computeVertexNormals();
  const water = new THREE.Mesh(wg, new THREE.MeshLambertMaterial({ color: 0x4f7488, transparent: true, opacity: 0.78 }));
  water.receiveShadow = true; world.scene.add(water);

  return { center: new THREE.Vector3(K.x, y0, K.z), dir: { x: rx, z: rz }, lateral: { x: lx, z: lz }, mesh, water, zone, halfLen: L / 2 };
}

export { buildBridge };
