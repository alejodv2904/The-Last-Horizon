// Campamentos de bandidos: un asentamiento fijo por cada entrada de CONFIG.BANDIT_CAMPS.
// Todo el mobiliario se fusiona en UNA malla por campamento. Las cajas, barriles, rocas y carros son a la vez
// colisión Y cobertura: cada uno se registra con su altura ("h") para que las balas pasen por encima de lo bajo
// y para que la IA sepa si puede asomarse (cobertura baja) o debe salirse de lado (cobertura alta).
import * as THREE from 'three';
import { mulberry32 } from '../core/MathUtils.js';
import { _m4, _q, _e, _v1, _sc, mergeGeos, GeoBuilder, MAT, makeGlowTexture } from '../render/GeometryKit.js';

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s) => new THREE.CylinderGeometry(rt, rb, h, s);

function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

function buildBanditCamp(world, def) {
  const scene = world.scene, cx = def.x, cz = def.z;
  const rand = mulberry32(hashStr(def.id));
  const y0 = world.getHeightAt(cx, cz);
  const zone = world.addZone(cx, cz, 17);
  const all = [], cover = [], idleSpots = [];
  const ground = (x, z) => world.getHeightAt(cx + x, cz + z);
  const place = (builder, x, z, yaw = 0) => {
    const g = builder.build();
    _m4.compose(_v1.set(cx + x, ground(x, z), cz + z), _q.setFromEuler(_e.set(0, yaw, 0, 'YXZ')), _sc.set(1, 1, 1));
    g.applyMatrix4(_m4); all.push(g);
  };
  const solid = (x, z, r, h, isCover = true) => {
    const o = { x: cx + x, z: cz + z, r, h };
    zone.obstacles.push(o);
    if (isCover) cover.push(o);
    return o;
  };

  // --- Fogata ---
  const fire = new GeoBuilder().add(Cyl(0.7, 0.75, 0.05, 9), 0x2a2522, 0, 0.03, 0);
  for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; fire.add(new THREE.DodecahedronGeometry(0.2, 0), 0x77706a, Math.sin(a) * 0.82, 0.1, Math.cos(a) * 0.82, a, a * 2, 0, 1, 0.75, 1); }
  for (let i = 0; i < 4; i++) fire.add(Cyl(0.07, 0.08, 1.0, 5), 0x3a2a1c, 0, 0.15, 0, Math.PI / 2 - 0.25, i * Math.PI / 4, 0);
  place(fire, 0, 0);
  solid(0, 0, 0.95, 0.4, false);
  // troncos para sentarse y puestos de los bandidos (alrededor del fuego)
  const n = def.members.length;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.4, r = 3.6;
    idleSpots.push(new THREE.Vector3(cx + Math.sin(a) * r, ground(Math.sin(a) * r, Math.cos(a) * r), cz + Math.cos(a) * r));
    if (i % 2 === 0) place(new GeoBuilder().add(Cyl(0.24, 0.26, 1.8, 7), 0x6b4a2e, 0, 0.26, 0, 0, 0, Math.PI / 2), Math.sin(a) * 2.6, Math.cos(a) * 2.6, a + Math.PI / 2);
  }

  // --- Tiendas ---
  const tent = (c1, c2) => new GeoBuilder()
    .add(Cyl(1.7, 1.7, 3.2, 3), c1, 0, 0.85, 0, -Math.PI / 2, 0, 0)
    .add(Cyl(0.75, 0.75, 0.04, 3), 0x1a1410, 0, 0.42, 1.62, -Math.PI / 2, 0, 0)
    .add(Cyl(0.04, 0.04, 2.9, 4), c2, 0, 1.45, 1.66).add(Cyl(0.04, 0.04, 2.9, 4), c2, 0, 1.45, -1.66)
    .add(Box(1.1, 0.12, 1.8), 0x4a3a2a, 0.3, 0.06, 2.4);
  const a1 = rand() * Math.PI * 2, a2 = a1 + 2.4 + rand() * 0.8;
  [[a1, 9.8, 0x6a5a44], [a2, 10.2, 0x5a4a3a]].forEach(([a, r, c]) => {
    const x = Math.sin(a) * r, z = Math.cos(a) * r;
    place(tent(c, 0x4a3420), x, z, a + Math.PI);
    solid(x, z, 2.0, 1.9, false);
  });
  const leader = def.members.includes('leader');
  if (leader) {   // tienda grande del cabecilla, bandera y botín
    const a = a1 + 4.4, x = Math.sin(a) * 11, z = Math.cos(a) * 11;
    place(tent(0x2a2a30, 0x6a5a40), x, z, a + Math.PI);
    place(new GeoBuilder().add(Cyl(0.05, 0.06, 4.2, 5), 0x3a2a1c, 0, 2.1, 0).add(Box(1.3, 0.8, 0.04), 0x7a1810, 0.7, 3.6, 0).add(Cyl(0.16, 0.16, 0.05, 6), 0xe8e0d0, 0.6, 3.62, 0.03, Math.PI / 2, 0, 0), Math.sin(a) * 6 + 1.5, Math.cos(a) * 6, 0);
    solid(x, z, 2.2, 2.0, false);
  }

  // --- Cobertura: cajas (bajas), barriles (bajos), rocas (altas) y un carro destrozado ---
  const crates = (x, z, yaw) => {
    const gb = new GeoBuilder()
      .add(Box(1.0, 1.0, 1.0), 0x8a6a42, 0, 0.5, 0, 0, yaw, 0).add(Box(0.9, 0.9, 0.9), 0x7a5a36, 1.05 * Math.cos(yaw), 0.45, -1.05 * Math.sin(yaw), 0, yaw + 0.3, 0)
      .add(Box(0.8, 0.8, 0.8), 0x9a7a52, 0.5, 1.4, 0.1, 0, yaw + 0.6, 0);
    place(gb, x, z);
    solid(x, z, 0.85, 1.2); solid(x + 1.05 * Math.cos(yaw), z - 1.05 * Math.sin(yaw), 0.7, 0.95);
  };
  const barrel = (x, z) => {
    place(new GeoBuilder().add(Cyl(0.34, 0.34, 0.92, 8), 0x6e4b2a, 0, 0.46, 0).add(Cyl(0.355, 0.355, 0.05, 8), 0x2c2c30, 0, 0.22, 0).add(Cyl(0.355, 0.355, 0.05, 8), 0x2c2c30, 0, 0.7, 0), x, z);
    solid(x, z, 0.45, 1.0);
  };
  const rock = (x, z, s) => {
    const col = [0x8a7f72, 0x7d7062, 0x9a8f80][Math.floor(rand() * 3)];
    place(new GeoBuilder().add(new THREE.IcosahedronGeometry(1, 0), col, 0, s * 0.55, 0, rand(), rand() * 6, 0, s * 1.1, s * 0.85, s)
      .add(new THREE.IcosahedronGeometry(1, 0), 0x6f655a, s * 0.9, s * 0.25, s * 0.3, 0, rand() * 6, 0, s * 0.5, s * 0.4, s * 0.5), x, z, rand() * 6);
    solid(x, z, s * 1.0, s * 1.15);
  };
  const ringPos = (r, a) => [Math.sin(a) * r, Math.cos(a) * r];
  for (let i = 0; i < 3; i++) { const [x, z] = ringPos(7 + rand() * 1.5, (i / 3) * Math.PI * 2 + 0.9 + rand() * 0.5); crates(x, z, rand() * 3); }
  for (let i = 0; i < 3; i++) { const [x, z] = ringPos(6 + rand() * 3, rand() * Math.PI * 2); if (Math.hypot(x, z) > 4.5) barrel(x, z); }
  for (let i = 0; i < 6; i++) { const [x, z] = ringPos(10.5 + rand() * 2.5, (i / 6) * Math.PI * 2 + rand() * 0.6); rock(x, z, 1.2 + rand() * 0.9); }
  {   // carro destrozado
    const [x, z] = ringPos(8.5, a1 + 1.3), yaw = rand() * 3;
    const wagon = new GeoBuilder().add(Box(1.6, 0.5, 3.0), 0x6a4a2c, 0, 0.9, 0, 0.1, 0, 0.08).add(Cyl(0.55, 0.55, 0.08, 10), 0x4a3420, -0.88, 0.55, 0.9, 0, 0, Math.PI / 2)
      .add(Cyl(0.55, 0.55, 0.08, 10), 0x4a3420, 0.88, 0.2, -0.9, 0.3, 0, Math.PI / 2 - 0.5).add(Box(0.1, 0.1, 1.8), 0x4a3420, 0, 0.5, 2.3);
    place(wagon, x, z, yaw);
    solid(x, z, 1.3, 1.25); solid(x + Math.sin(yaw) * 1.1, z + Math.cos(yaw) * 1.1, 1.0, 1.1);
  }

  const mesh = new THREE.Mesh(mergeGeos(all), MAT.vcDouble);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh); world.solidTargets.push(mesh);

  // --- Llamas (solo cuando el jugador está cerca) ---
  const flames = new THREE.Group(); flames.position.set(cx, ground(0, 0) + 0.1, cz); flames.visible = false;
  const flameMeshes = [[0xff5a14, 0.38, 1.0, 0, 0], [0xffa030, 0.26, 0.8, 0.1, 0.06]].map(([color, r, h, x, z]) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6, 1, true), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, h / 2, z); m.userData.h = h; flames.add(m); return m;
  });
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(255,240,180,1)', 'rgba(255,120,30,0.8)'), color: 0xffa050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }));
  glow.scale.set(3.4, 3.4, 1); glow.position.y = 0.6; flames.add(glow);
  scene.add(flames);

  return {
    def, center: new THREE.Vector3(cx, y0, cz), zone, cover, idleSpots, mesh, leader,
    update(dist, night, t, noise) {
      flames.visible = dist < 130;
      if (!flames.visible) return;
      flameMeshes.forEach((m, i) => {
        const k = 1 + noise.noise(t * (4 + i) + cx, i * 10) * 0.35;
        m.scale.set(1 + noise.noise(t * 5 + i, 2) * 0.15, k, 1); m.position.y = m.userData.h * k / 2; m.rotation.y = t * (0.7 + i * 0.3);
      });
      glow.material.opacity = 0.3 + night * 0.5 + noise.noise(t * 6, cz) * 0.08;
    },
  };
}

export { buildBanditCamp };
