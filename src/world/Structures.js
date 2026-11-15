// Estructuras fijas del mapa (no se hacen streaming: son pocas y la niebla las oculta).
// Cada una se fusiona en una sola malla con color por vértice = 1 draw call.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { _m4, _q, _e, _v1, _sc, mergeGeos, GeoBuilder, MAT, makeGlowTexture } from '../render/GeometryKit.js';

const Box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const Cyl = (rt, rb, h, s, open = false) => new THREE.CylinderGeometry(rt, rb, h, s, 1, open);

// Convierte coordenadas locales (lx, lz) de una estructura rotada a coordenadas de mundo.
function toWorld(ox, oz, yaw, lx, lz) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { x: ox + lx * c + lz * s, z: oz - lx * s + lz * c };
}

/* ------------------------------------------------------------------ Campamento */
// Fase 5B: el campamento es reubicable. `site` = { x, z, style } de CONFIG.CAMP_SITES.
// Estilos: tents (Cedar Hollow) · swamp (Sauces Negros) · mesa (Mesa Quebrada) · ranch (Rancho La Rueda) · ruins (Cedar Hollow quemado).
// Los obstáculos se devuelven en `obstacles` (el mundo los añade/quita al mudar de sitio) y la luz del fuego es UNA sola, compartida.
function buildCamp(world, site = CONFIG.CAMP_SITES.cedar) {
  const scene = world.scene, cx = site.x, cz = site.z, style = site.style || 'tents';
  const y0 = world.getHeightAt(cx, cz);
  const all = [], obs = [];
  const TENT = { tents: 0xd8c9a3, swamp: 0xa9b08c, mesa: 0xd89a72, ruins: 0x2c2622, ranch: 0xd8c9a3 }[style] || 0xd8c9a3;
  const place = (builder, x, z, yaw) => {
    const g = builder.build();
    _m4.compose(_v1.set(cx + x, y0, cz + z), _q.setFromEuler(_e.set(0, yaw, 0, 'YXZ')), _sc.set(1, 1, 1));
    g.applyMatrix4(_m4); all.push(g);
  };
  const tent = () => new GeoBuilder()
    .add(Cyl(1.7, 1.7, 3.2, 3), TENT, 0, 0.85, 0, -Math.PI / 2, 0, 0)
    .add(Cyl(0.75, 0.75, 0.04, 3), 0x2a2018, 0, 0.42, 1.62, -Math.PI / 2, 0, 0)
    .add(Cyl(0.04, 0.04, 2.9, 4), 0x5a3d26, 0, 1.45, 1.66)
    .add(Cyl(0.04, 0.04, 2.9, 4), 0x5a3d26, 0, 1.45, -1.66)
    .add(Box(1.2, 0.12, 2.0), 0x6b4a3a, 0.4, 0.06, 2.6);
  if (style !== 'ranch') {
    place(tent(), 6.8, 3.2, -2.0);
    place(tent(), -5.4, 6.2, 2.5);
    obs.push({ x: cx + 6.8, z: cz + 3.2, r: 2.0 }, { x: cx - 5.4, z: cz + 6.2, r: 2.0 });
  }
  if (style === 'swamp') {   // plataforma de tablones sobre el barro y postes con farolas
    place(new GeoBuilder().add(Box(9, 0.22, 9), 0x5a4630, 0, 0.1, 0).add(Box(4, 0.2, 14), 0x4e3c28, 6, 0.09, 4), 0, 0, 0.2);
    [[-4.2, -4.2], [4.2, 4.2], [4.2, -4.2]].forEach(([x, z]) => place(new GeoBuilder().add(Cyl(0.07, 0.09, 2.6, 5), 0x4a3a28, 0, 1.3, 0).add(Box(0.22, 0.28, 0.22), 0xffc070, 0, 2.55, 0), x, z, 0));
  } else if (style === 'mesa') {   // abrigo de rocas contra el viento y toldo de lona
    [[-3.5, -6, 1.7], [-1.2, -6.8, 1.3], [1.4, -6.3, 1.5], [3.6, -5.6, 1.2]].forEach(([x, z, r]) => {
      place(new GeoBuilder().add(new THREE.DodecahedronGeometry(r, 0), 0x9a7c62, 0, r * 0.5, 0, 0, 0.6, 0, 1, 0.75, 1), x, z, 0); obs.push({ x: cx + x, z: cz + z, r: r * 0.9 });
    });
    place(new GeoBuilder().add(Box(3.4, 0.08, 2.4), 0xe2d2ad, 0, 2.2, 0, 0.12, 0, 0).add(Cyl(0.05, 0.06, 2.2, 5), 0x5a3d26, -1.6, 1.1, -1.1).add(Cyl(0.05, 0.06, 2.0, 5), 0x5a3d26, 1.6, 1.0, -1.1), -8, 1.5, 0.3);
  } else if (style === 'ranch') {   // casa de troncos, establo abierto y corral
    const house = new GeoBuilder().add(Box(8, 3, 5.6), 0x7a5536, 0, 1.5, 0).add(Box(8.8, 0.18, 3.6), 0x4a3a2c, 0, 3.55, 1.45, 0.5, 0, 0).add(Box(8.8, 0.18, 3.6), 0x4a3a2c, 0, 3.55, -1.45, -0.5, 0, 0)
      .add(Box(1.2, 2.1, 0.1), 0x2a1e14, 0, 1.05, 2.82).add(Box(0.9, 0.9, 0.1), 0x2a1e14, -2.4, 1.6, 2.82).add(Box(0.8, 5.0, 0.8), 0x7d756c, 3.2, 3.0, -1.4);
    place(house, -4, 3, 0.35); obs.push({ x: cx - 4, z: cz + 3, r: 3.8 }, { x: cx - 2, z: cz + 4.2, r: 3.0 });
    const fence = new GeoBuilder();
    for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; fence.add(Cyl(0.07, 0.08, 1.3, 5), 0x6b4a2e, Math.sin(a) * 6.5, 0.65, Math.cos(a) * 6.5).add(Box(0.07, 0.08, 4.1), 0x7a5a38, Math.sin(a + 0.2) * 6.5, 1.0, Math.cos(a + 0.2) * 6.5, 0, a + 0.2 + Math.PI / 2, 0); }
    place(fence, 11, -3, 0);
    place(new GeoBuilder().add(Box(5.5, 0.18, 4), 0x4a3a2c, 0, 3.0, 0, 0.14, 0, 0).add(Cyl(0.1, 0.12, 3, 5), 0x5a3d26, -2.6, 1.5, -1.8).add(Cyl(0.1, 0.12, 2.6, 5), 0x5a3d26, 2.6, 1.3, -1.8).add(Box(1.4, 0.7, 0.8), 0x8a6a42, 1.4, 0.35, 0.2), 4, 9, -0.3);
  } else if (style === 'ruins') {   // postes quemados, carro volcado, pilas de cenizas
    for (let i = 0; i < 9; i++) { const a = i * 0.7 + 0.4, r = 5 + (i % 3) * 3.2; place(new GeoBuilder().add(Cyl(0.07, 0.1, 1.2 + (i % 4) * 0.5, 5), 0x1e1a18, 0, 0.5, 0, (i % 3 - 1) * 0.25, 0, (i % 2 - 0.5) * 0.3), Math.sin(a) * r, Math.cos(a) * r, 0); }
    place(new GeoBuilder().add(Box(1.6, 0.5, 3.2), 0x2a2220, 0, 0.5, 0, 0, 0, 1.2).add(Cyl(0.55, 0.55, 0.08, 10), 0x1c1816, 1.0, 0.9, 0.9, 0, 0, Math.PI / 2), -8, 7, 0.9);
    for (let i = 0; i < 6; i++) place(new GeoBuilder().add(Cyl(1.0 + (i % 2) * 0.6, 1.3, 0.05, 7), 0x211c1a, 0, 0.03, 0), Math.sin(i * 1.3) * 7, Math.cos(i * 1.3) * 7 - 2, 0);
  }

  const fire = new GeoBuilder().add(Cyl(0.75, 0.8, 0.05, 10), 0x2a2522, 0, 0.03, 0);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    fire.add(new THREE.DodecahedronGeometry(0.22, 0), 0x77706a, Math.sin(a) * 0.88, 0.1, Math.cos(a) * 0.88, a, a * 2, 0, 1, 0.75, 1);
  }
  for (let i = 0; i < 4; i++) fire.add(Cyl(0.08, 0.09, 1.1, 5), 0x3a2a1c, 0, 0.16, 0, Math.PI / 2 - 0.25, i * Math.PI / 4, 0);
  place(fire, 0, 0, 0);
  obs.push({ x: cx, z: cz, r: 1.1 });

  [0.6, 1.9, 5.4].filter(() => style !== 'ruins').forEach((a) => {
    const lx = Math.sin(a) * 3.3, lz = Math.cos(a) * 3.3;
    place(new GeoBuilder().add(Cyl(0.25, 0.27, 2.2, 7), 0x6b4a2e, 0, 0.24, 0, 0, 0, Math.PI / 2), lx, lz, a + Math.PI / 2);
    const tx = Math.cos(a) * 0.7, tz = -Math.sin(a) * 0.7;
    obs.push({ x: cx + lx + tx, z: cz + lz + tz, r: 0.5 }, { x: cx + lx - tx, z: cz + lz - tz, r: 0.5 });
  });

  place(new GeoBuilder()
    .add(Box(0.8, 0.6, 0.6), 0x8a6a42, 0, 0.3, 0)
    .add(Box(0.7, 0.5, 0.55), 0x7a5a36, 0.05, 0.85, 0.02, 0, 0.3, 0)
    .add(Cyl(0.32, 0.32, 0.9, 8), 0x6e4b2a, 1.0, 0.45, 0.2)
    .add(Cyl(0.335, 0.335, 0.05, 8), 0x2c2c30, 1.0, 0.25, 0.2)
    .add(Cyl(0.335, 0.335, 0.05, 8), 0x2c2c30, 1.0, 0.68, 0.2), -6.5, -4.0, 0.4);
  obs.push({ x: cx - 6.3, z: cz - 3.8, r: 1.1 });

  const wagon = new GeoBuilder()
    .add(Box(1.6, 0.5, 3.2), 0x7a5634, 0, 1.0, 0)
    .add(new THREE.CylinderGeometry(0.85, 0.85, 2.6, 8, 1, true, Math.PI / 2, Math.PI), 0xe2d6b6, 0, 1.25, -0.1, Math.PI / 2, 0, 0)
    .add(Box(0.1, 0.1, 1.8), 0x4a3420, 0, 0.75, 2.4);
  [[-0.88, 1.1], [0.88, 1.1], [-0.88, -1.1], [0.88, -1.1]].forEach(([wx, wz]) =>
    wagon.add(Cyl(0.55, 0.55, 0.08, 10), 0x4a3420, wx, 0.55, wz, 0, 0, Math.PI / 2));
  place(wagon, 9.5, -6.0, 0.4);
  obs.push({ x: cx + 9.5 + Math.sin(0.4), z: cz - 6.0 + Math.cos(0.4), r: 1.3 }, { x: cx + 9.5 - Math.sin(0.4), z: cz - 6.0 - Math.cos(0.4), r: 1.3 });

  place(new GeoBuilder()
    .add(Cyl(0.06, 0.07, 2.2, 5), 0x5a3d26, 0, 1.1, 0)
    .add(Box(0.5, 0.05, 0.05), 0x5a3d26, 0.2, 2.1, 0), 3.6, 5.8, 0.6);

  // Barandilla para atar al caballo
  place(new GeoBuilder()
    .add(Cyl(0.07, 0.08, 1.2, 5), 0x5a3d26, -1.2, 0.6, 0)
    .add(Cyl(0.07, 0.08, 1.2, 5), 0x5a3d26, 1.2, 0.6, 0)
    .add(Cyl(0.05, 0.05, 2.7, 5), 0x6b4a2e, 0, 1.1, 0, 0, 0, Math.PI / 2), 8.5, -13.5, 0);
  obs.push({ x: cx + 7.3, z: cz - 13.5, r: 0.25 }, { x: cx + 9.7, z: cz - 13.5, r: 0.25 });

  const mesh = new THREE.Mesh(mergeGeos(all), MAT.vcDouble);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  world.solidTargets.push(mesh);

  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  lantern.position.set(cx + 3.6 + Math.cos(0.6) * 0.38, y0 + 1.95, cz + 5.8 - Math.sin(0.6) * 0.38);
  scene.add(lantern);

  // Fuego: llamas aditivas + luz puntual permanente (sin recompilar shaders)
  const flames = new THREE.Group();
  flames.position.set(cx, y0 + 0.12, cz);
  const mkFlame = (color, r, h, x, z) => {
    const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 6, 1, true),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.position.set(x, h / 2, z); m.userData.h = h; flames.add(m); return m;
  };
  const flameMeshes = [mkFlame(0xff5a14, 0.42, 1.1, 0, 0), mkFlame(0xff8a2a, 0.3, 0.9, 0.12, 0.08), mkFlame(0xffc860, 0.18, 0.7, -0.08, -0.05)];
  const fireGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeGlowTexture('rgba(255,240,180,1)', 'rgba(255,120,30,0.8)'), color: 0xffa050, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 }));
  fireGlow.scale.set(3.2, 3.2, 1); fireGlow.position.y = 0.6; flames.add(fireGlow);
  scene.add(flames);
  const fireLight = world.campLight;   // luz compartida entre sitios (una sola luz = sin recompilar shaders al mudarse)

  // Objetos que aparecen cuando el campamento está alimentado (estado del mundo)
  const fed = new GeoBuilder();
  for (let i = 0; i < 3; i++) {
    const a = i * (Math.PI * 2 / 3);
    fed.add(Cyl(0.03, 0.035, 2.0, 4), 0x4a3420, Math.sin(a) * 0.45, 0.92, Math.cos(a) * 0.45, -Math.cos(a) * 0.24, 0, Math.sin(a) * 0.24);
  }
  fed.add(Cyl(0.3, 0.24, 0.35, 8), 0x26262a, 0, 0.78, 0).add(Cyl(0.28, 0.28, 0.02, 8), 0x6b3a20, 0, 0.94, 0);
  const rack = new GeoBuilder()
    .add(Cyl(0.05, 0.05, 1.9, 5), 0x5a3d26, -1.0, 0.95, 0)
    .add(Cyl(0.05, 0.05, 1.9, 5), 0x5a3d26, 1.0, 0.95, 0)
    .add(Cyl(0.04, 0.04, 2.2, 5), 0x5a3d26, 0, 1.85, 0, 0, 0, Math.PI / 2);
  [-0.6, 0, 0.6].forEach((mx) => rack.add(Box(0.22, 0.5, 0.12), 0x7a2a22, mx, 1.45, 0, 0, 0, 0.1));
  rack.add(Box(1.3, 0.9, 0.04), 0x9a7a52, 2.1, 0.75, 0.2, 0.15, 0.3, 0);
  const fedA = fed.build();
  _m4.compose(_v1.set(cx, y0, cz), _q.identity(), _sc.set(1, 1, 1)); fedA.applyMatrix4(_m4);
  const fedB = rack.build();
  _m4.compose(_v1.set(cx - 3.0, y0, cz + 3.6), _q.setFromEuler(_e.set(0, 0.5, 0, 'YXZ')), _sc.set(1, 1, 1)); fedB.applyMatrix4(_m4);
  const fedProps = new THREE.Mesh(mergeGeos([fedA, fedB]), MAT.vcDouble);
  fedProps.castShadow = true; fedProps.visible = false;
  scene.add(fedProps);

  const objects = [mesh, lantern, flames, fedProps];
  return { mesh, lantern, flames, flameMeshes, fireGlow, fireLight, fedProps, firePos: new THREE.Vector3(cx, y0, cz), obstacles: obs, objects, site, style };
}

/* ------------------------------------------------------- Puesto de comercio (cabaña del trampero) */
function makeSignTexture(lines) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#5b3d22'; g.fillRect(0, 0, 512, 128);
  g.strokeStyle = '#2e1d0e'; g.lineWidth = 10; g.strokeRect(5, 5, 502, 118);
  g.fillStyle = '#ead7a8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = 'bold 46px Georgia'; g.fillText(lines[0], 256, 50);
  g.font = 'italic 26px Georgia'; g.fillText(lines[1], 256, 98);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

function buildTradingPost(world) {
  const tp = CONFIG.TRADING_POST, scene = world.scene;
  const y0 = world.getHeightAt(tp.x, tp.z);
  const yaw = Math.atan2(CONFIG.CAMP.x - tp.x, CONFIG.CAMP.z - tp.z);
  const LOG = 0x7a5536, LOG2 = 0x6b4a2e, ROOF = 0x4a3a2c, STONE = 0x7d756c;
  const W = 6.4, D = 5.2, R = 0.17, N = 8;
  const b = new GeoBuilder();
  b.add(Box(7.2, 0.35, 6.2), 0x5a4030, 0, 0.17, 0);
  for (let i = 0; i < N; i++) {
    const y = 0.5 + i * 0.33, c = i % 2 ? LOG : LOG2;
    b.add(Cyl(R, R, W + 0.4, 6), c, 0, y, -D / 2, 0, 0, Math.PI / 2);
    b.add(Cyl(R, R, D + 0.4, 6), c, W / 2, y, 0, Math.PI / 2, 0, 0);
    b.add(Cyl(R, R, D + 0.4, 6), c, -W / 2, y, 0, Math.PI / 2, 0, 0);
    if (i < 6) {
      const seg = (W - 1.3) / 2;
      b.add(Cyl(R, R, seg + 0.2, 6), c, -(0.65 + seg / 2), y, D / 2, 0, 0, Math.PI / 2);
      b.add(Cyl(R, R, seg + 0.2, 6), c, 0.65 + seg / 2, y, D / 2, 0, 0, Math.PI / 2);
    } else b.add(Cyl(R, R, W + 0.4, 6), c, 0, y, D / 2, 0, 0, Math.PI / 2);
  }
  const wallTop = 0.5 + (N - 1) * 0.33 + R;
  b.add(Box(1.3, 2.05, 0.08), 0x2a1e14, 0, 1.35, D / 2 - 0.06);
  b.add(Cyl(3.23, 3.23, W + 0.3, 3), LOG2, 0, wallTop + 0.53, 0, -Math.PI / 2, Math.PI / 2, 0, 1, 1, 0.33);
  b.add(Box(W + 1.2, 0.15, 3.6), ROOF, 0, wallTop + 0.85, 1.45, 0.476, 0, 0);
  b.add(Box(W + 1.2, 0.15, 3.6), ROOF, 0, wallTop + 0.85, -1.45, -0.476, 0, 0);
  b.add(Box(0.9, 5.4, 0.9), STONE, W / 2 + 0.45, 2.7, -1.0);
  b.add(Box(W + 0.6, 0.15, 2.0), 0x6a4a30, 0, 0.27, D / 2 + 1.0);
  b.add(Cyl(0.08, 0.08, 2.6, 5), LOG2, W / 2, 1.45, D / 2 + 1.9).add(Cyl(0.08, 0.08, 2.6, 5), LOG2, -W / 2, 1.45, D / 2 + 1.9);
  b.add(Box(W + 0.8, 0.1, 2.3), ROOF, 0, 2.82, D / 2 + 1.0, 0.18, 0, 0);
  b.add(Cyl(0.32, 0.32, 0.9, 8), 0x6e4b2a, W / 2 - 0.4, 0.8, D / 2 + 1.5).add(Cyl(0.32, 0.32, 0.9, 8), 0x6e4b2a, W / 2 - 1.1, 0.8, D / 2 + 1.6);
  b.add(Box(0.8, 0.6, 0.6), 0x8a6a42, -W / 2 + 0.7, 0.65, D / 2 + 1.4).add(Box(0.6, 0.45, 0.5), 0x7a5a36, -W / 2 + 0.75, 1.17, D / 2 + 1.4, 0, 0.4, 0);
  [-0.18, 0.18].forEach((s) => {
    b.add(Cyl(0.02, 0.03, 0.55, 4), 0xd8c8a4, s, 2.75, D / 2 + 0.25, 0, 0, s > 0 ? -0.7 : 0.7);
    b.add(Cyl(0.015, 0.02, 0.25, 4), 0xd8c8a4, s * 1.9, 2.92, D / 2 + 0.25, 0, 0, s > 0 ? 0.3 : -0.3);
  });
  const rx = -W / 2 - 2.0, rz = 1.2;
  b.add(Cyl(0.06, 0.07, 2.0, 5), LOG2, rx, 1.0, rz - 1.0).add(Cyl(0.06, 0.07, 2.0, 5), LOG2, rx, 1.0, rz + 1.0)
    .add(Cyl(0.05, 0.05, 2.3, 5), LOG2, rx, 1.95, rz, Math.PI / 2, 0, 0);
  [[-0.6, 0x8a6a48], [0.05, 0x9a7a55], [0.65, 0x6e6a64]].forEach(([dz, c]) => b.add(Box(0.05, 1.0, 0.55), c, rx, 1.35, rz + dz));
  const geo = b.build();
  _m4.compose(_v1.set(tp.x, y0, tp.z), _q.setFromEuler(_e.set(0, yaw, 0, 'YXZ')), _sc.set(1, 1, 1));
  geo.applyMatrix4(_m4);
  const mesh = new THREE.Mesh(geo, MAT.vcDouble);
  mesh.castShadow = true; mesh.receiveShadow = true;
  scene.add(mesh);
  world.solidTargets.push(mesh);

  const group = new THREE.Group();
  group.position.set(tp.x, y0, tp.z); group.rotation.y = yaw;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.65),
    new THREE.MeshLambertMaterial({ map: makeSignTexture(['PUESTO DE COMERCIO', 'Pieles · Munición · J. Pike']) }));
  sign.position.set(0, 3.25, D / 2 + 2.12); sign.rotation.x = -0.05;
  group.add(sign);
  const lantern = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.2, 0.14), new THREE.MeshBasicMaterial({ color: 0xffc070 }));
  lantern.position.set(W / 2 - 0.2, 2.35, D / 2 + 1.75);
  group.add(lantern);
  scene.add(group);

  const obs = world.staticObstacles;
  [[-1.6, -1.3, 1.9], [1.6, -1.3, 1.9], [-1.6, 1.3, 1.9], [1.6, 1.3, 1.9], [W / 2 + 0.45, -1.0, 0.6],
    [W / 2 - 0.75, D / 2 + 1.55, 0.7], [-W / 2 + 0.7, D / 2 + 1.4, 0.6], [rx, rz, 1.1], [W / 2, D / 2 + 1.9, 0.2], [-W / 2, D / 2 + 1.9, 0.2]]
    .forEach(([lx, lz, r]) => { const w = toWorld(tp.x, tp.z, yaw, lx, lz); obs.push({ x: w.x, z: w.z, r }); });

  const trader = toWorld(tp.x, tp.z, yaw, 1.4, D / 2 + 2.7);
  const face = toWorld(tp.x, tp.z, yaw, 1.4, D / 2 + 12);
  return { mesh, lantern, sign, traderPos: trader, traderFace: face, yaw };
}

export { buildCamp, buildTradingPost, toWorld };
