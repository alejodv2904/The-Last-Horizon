import * as THREE from 'three';
import { lerp } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';

const PALETTES = {
  player: { skin: 0xc58c63, shirt: 0xa0906c, coat: 0x4a3324, belt: 0x2a1c12, pants: 0x3b3a40, boots: 0x2a1d14,
    hat: 0x3b2a1c, hatBand: 0x16100b, bandana: 0x8f2b22, beard: 0x3a2617, glove: 0x6b4a30, beardLong: false },
  silas: { skin: 0xb27a58, shirt: 0x6d7180, coat: 0x34402f, belt: 0x22170f, pants: 0x4d3c2b, boots: 0x22170f,
    hat: 0x5c4b39, hatBand: 0x2a2018, bandana: 0x2c3c5c, beard: 0xa3a39a, glove: 0xb27a58, beardLong: true },
  trader: { skin: 0xc8946c, shirt: 0x8a3a2a, coat: 0x7a6248, belt: 0x2a1c12, pants: 0x4a4038, boots: 0x2a1d14,
    hat: 0x6e5a40, hatBand: 0x3a2a1a, bandana: 0xc8b48a, beard: 0x5a3a22, glove: 0x6b4a30, beardLong: true },
};
// Fase 3: bandidos, ley y ciudadanos. "beard: skin" quita la barba (para mujeres e imberbes).
const P = (o) => Object.assign({ skin: 0xc58c63, shirt: 0xa0906c, coat: 0x4a3324, belt: 0x2a1c12, pants: 0x3b3a40, boots: 0x2a1d14,
  hat: 0x3b2a1c, hatBand: 0x16100b, bandana: 0x8f2b22, beard: 0x3a2617, glove: 0x6b4a30, beardLong: false }, o);
Object.assign(PALETTES, {
  bandit1: P({ skin: 0xb98660, shirt: 0x6b5a46, coat: 0x3a2f27, hat: 0x2a2420, hatBand: 0x7a1f18, bandana: 0xa42a20, beard: 0x2a1c12 }),
  bandit2: P({ skin: 0xc79a74, shirt: 0x7a6a50, coat: 0x6a5f4c, pants: 0x4a4034, hat: 0x4a3b2a, hatBand: 0x2a2018, bandana: 0x2e4a5a, beard: 0x5a3a22, beardLong: true }),
  bandit3: P({ skin: 0xa8744f, shirt: 0x5a4a3a, coat: 0x5a2a24, pants: 0x34302c, hat: 0x1e1a18, hatBand: 0xb0a070, bandana: 0x1e1e22, beard: 0x1a1210 }),
  leader: P({ skin: 0xb98660, shirt: 0xd8d0b8, coat: 0x1d1d22, belt: 0x120d08, pants: 0x1f1f24, boots: 0x15100c, hat: 0x1a1a1c, hatBand: 0xb8b8c0, bandana: 0xd8c9a3, beard: 0x2a2a2e, beardLong: true }),
  sheriff: P({ skin: 0xc08a64, shirt: 0xcfc6ae, coat: 0x8a6e48, belt: 0x2a1c12, pants: 0x4a4a52, hat: 0xb0a078, hatBand: 0x4a3a22, bandana: 0x2c3c5c, beard: 0x8a8a82, beardLong: true }),
  deputy: P({ skin: 0xc58c63, shirt: 0xb8b0a0, coat: 0x5a5a48, pants: 0x3c3c44, hat: 0x7a6a50, hatBand: 0x2a2018, bandana: 0x5a6a7a, beard: 0x4a3322 }),
  townA: P({ skin: 0xc8946c, shirt: 0x7a8aa0, coat: 0x6a4a34, pants: 0x4a4038, hat: 0x5a4a38, hatBand: 0x2a2018, bandana: 0xb8a888, beard: 0x5a3a22 }),
  townB: P({ skin: 0xb27a58, shirt: 0xd0c8b0, coat: 0x2a2a30, pants: 0x34343a, hat: 0x1a1a1c, hatBand: 0x3a3a40, bandana: 0x6a2a2a, beard: 0x8a8a82, beardLong: true }),
  miner: P({ skin: 0xa8744f, shirt: 0x8a7a64, coat: 0x6a6258, pants: 0x4a4a42, hat: 0x6a5a44, hatBand: 0x3a2e22, bandana: 0x7a7a6a, beard: 0x3a2a1a, beardLong: true }),
  woman1: P({ skin: 0xd0a07a, shirt: 0xe4dccb, coat: 0xb88a9a, belt: 0x6a3a4a, pants: 0x6a3a4a, hat: 0xe8dcc8, hatBand: 0x9a5a6a, bandana: 0xe4dccb, beard: 0xd0a07a, glove: 0xd0a07a }),
  woman2: P({ skin: 0xb88866, shirt: 0xe4dccb, coat: 0x4a6a8a, belt: 0x2a3a4a, pants: 0x2a3a4a, hat: 0x5a4a6a, hatBand: 0xd0c8b0, bandana: 0xe4dccb, beard: 0xb88866, glove: 0xb88866 }),
  storekeeper: P({ skin: 0xc8946c, shirt: 0xe4dccb, coat: 0x5a7a4a, belt: 0x3a2a1a, pants: 0x4a3a2a, hat: 0xd8cfa8, hatBand: 0x5a7a4a, bandana: 0xe4dccb, beard: 0xc8946c, glove: 0xc8946c }),
  barkeep: P({ skin: 0xc58c63, shirt: 0xf0e8d8, coat: 0x2a2428, pants: 0x2a2a30, hat: 0x1c1c20, hatBand: 0x1c1c20, bandana: 0xa02a2a, beard: 0x2a1c12 }),
  pruitt: P({ skin: 0xd0a07a, shirt: 0xf0e8d8, coat: 0x16161a, belt: 0x16161a, pants: 0x1c1c22, boots: 0x101010, hat: 0x101012, hatBand: 0x303038, bandana: 0x8a1a1a, beard: 0x6a6a6a }),
  tomas: P({ skin: 0xb27a58, shirt: 0xa89878, coat: 0x6a5a48, pants: 0x4a4238, hat: 0x7a6a50, hatBand: 0x4a3a2a, bandana: 0xa89878, beard: 0xb27a58 }),
  clara: P({ skin: 0xd0a07a, shirt: 0xd8d0c0, coat: 0x2a2a32, belt: 0x1a1a20, pants: 0x1a1a20, hat: 0x1c1c22, hatBand: 0x1c1c22, bandana: 0xd8d0c0, beard: 0xd0a07a, glove: 0xd0a07a }),
  traveler: P({ skin: 0xc8946c, shirt: 0xc8b890, coat: 0x4a6a5a, pants: 0x5a4a3a, hat: 0x8a7a5a, hatBand: 0x3a2a1a, bandana: 0xb8a888, beard: 0x7a5a3a }),
});
const WOOD = 0x6e4526, METAL = 0x2c2c30;
const RIFLE_BACK_POS = new THREE.Vector3(0.03, 0.3, -0.18);
const RIFLE_BACK_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0.55, 'ZXY'));
const RIFLE_AIM_POS = new THREE.Vector3(-0.1, 0.5, 0.16);
const RIFLE_AIM_Q = new THREE.Quaternion();

// opts.lite: versión de 6 mallas (ciudadanos). opts.shadow: 'all' | 'body' (solo el torso proyecta sombra).
// Menos mallas = menos draw calls (y menos pasadas de sombra) cuando hay mucha gente en pantalla.
function buildHumanoid(p, withRifle, opts = {}) {
  const mat = MAT.vcDouble;
  const meshes = [];
  const lite = !!opts.lite, bodyShadowOnly = lite || opts.shadow === 'body';
  let first = true;
  const mk = (geo, parent) => {
    const m = new THREE.Mesh(geo, mat); m.castShadow = !bodyShadowOnly || first; first = false;
    parent.add(m); meshes.push(m); return m;
  };
  const root = new THREE.Group();
  const hips = new THREE.Group(); hips.position.y = 0.98; root.add(hips);
  const torso = new THREE.Group(); hips.add(torso);

  mk(new GeoBuilder()
    .add(new THREE.BoxGeometry(0.4, 0.56, 0.23), p.shirt, 0, 0.33, 0)
    .add(new THREE.CylinderGeometry(0.255, 0.34, 1.05, 9, 1, true, 0.5, Math.PI * 2 - 1.0), p.coat, 0, 0.1, 0, 0, 0, 0, 1, 1, 0.66)
    .add(new THREE.BoxGeometry(0.5, 0.12, 0.26), p.coat, 0, 0.57, 0)
    .add(new THREE.BoxGeometry(0.42, 0.06, 0.25), p.belt, 0, 0.06, 0)
    .add(new THREE.BoxGeometry(0.07, 0.06, 0.03), 0xc9a24a, 0, 0.06, 0.13)
    .add(new THREE.CylinderGeometry(0.065, 0.07, 0.1, 6), p.skin, 0, 0.66, 0)
    .add(new THREE.CylinderGeometry(0.09, 0.13, 0.08, 7), p.bandana, 0, 0.6, 0)
    .add(new THREE.ConeGeometry(0.08, 0.14, 4), p.bandana, 0, 0.53, 0.1, Math.PI, 0, 0)
    .build(), torso);

  const head = new THREE.Group(); head.position.y = 0.7; torso.add(head);
  mk(new GeoBuilder()
    .add(new THREE.SphereGeometry(0.125, 8, 6), p.skin, 0, 0.13, 0, 0, 0, 0, 0.95, 1.1, 1.0)
    .add(new THREE.BoxGeometry(0.04, 0.06, 0.05), p.skin, 0, 0.12, 0.125)
    .add(new THREE.BoxGeometry(0.035, 0.02, 0.012), 0x1a1410, -0.045, 0.16, 0.118)
    .add(new THREE.BoxGeometry(0.035, 0.02, 0.012), 0x1a1410, 0.045, 0.16, 0.118)
    .add(new THREE.BoxGeometry(0.2, p.beardLong ? 0.15 : 0.07, 0.1), p.beard, 0, p.beardLong ? 0.02 : 0.05, 0.075)
    .add(new THREE.BoxGeometry(0.13, 0.025, 0.03), p.beard, 0, 0.088, 0.125)
    .add(new THREE.BoxGeometry(0.25, 0.08, 0.2), p.beard, 0, 0.2, -0.04)
    .add(new THREE.CylinderGeometry(0.31, 0.31, 0.025, 14), p.hat, 0, 0.245, 0)
    .add(new THREE.CylinderGeometry(0.135, 0.155, 0.16, 10), p.hat, 0, 0.335, 0)
    .add(new THREE.CylinderGeometry(0.157, 0.157, 0.035, 10), p.hatBand, 0, 0.275, 0)
    .build(), head);

  const makeArm = (side) => {
    const arm = new THREE.Group(); arm.position.set(0.27 * side, 0.56, 0); torso.add(arm);
    const fore = new THREE.Group(); fore.position.y = -0.32; arm.add(fore);
    if (lite) {   // brazo y antebrazo en una sola malla (sin codo articulado)
      mk(new GeoBuilder()
        .add(new THREE.BoxGeometry(0.12, 0.34, 0.13), p.coat, 0, -0.16, 0)
        .add(new THREE.BoxGeometry(0.11, 0.28, 0.12), p.coat, 0, -0.45, 0)
        .add(new THREE.BoxGeometry(0.115, 0.05, 0.125), p.shirt, 0, -0.59, 0)
        .add(new THREE.BoxGeometry(0.085, 0.1, 0.1), p.glove, 0, -0.66, 0.01)
        .build(), arm);
      return [arm, fore];
    }
    mk(new GeoBuilder().add(new THREE.BoxGeometry(0.12, 0.34, 0.13), p.coat, 0, -0.16, 0).build(), arm);
    mk(new GeoBuilder()
      .add(new THREE.BoxGeometry(0.11, 0.28, 0.12), p.coat, 0, -0.13, 0)
      .add(new THREE.BoxGeometry(0.115, 0.05, 0.125), p.shirt, 0, -0.27, 0)
      .add(new THREE.BoxGeometry(0.085, 0.1, 0.1), p.glove, 0, -0.34, 0.01)
      .build(), fore);
    return [arm, fore];
  };
  const [armL, foreL] = makeArm(1);
  const [armR, foreR] = makeArm(-1);

  const makeLeg = (side) => {
    const leg = new THREE.Group(); leg.position.set(0.11 * side, 0, 0); hips.add(leg);
    const shin = new THREE.Group(); shin.position.y = -0.48; leg.add(shin);
    if (lite) {   // pierna entera en una malla (el balanceo sale de la cadera)
      mk(new GeoBuilder()
        .add(new THREE.BoxGeometry(0.15, 0.48, 0.17), p.pants, 0, -0.24, 0)
        .add(new THREE.BoxGeometry(0.135, 0.3, 0.15), p.pants, 0, -0.63, 0)
        .add(new THREE.BoxGeometry(0.15, 0.24, 0.17), p.boots, 0, -0.84, 0)
        .add(new THREE.BoxGeometry(0.14, 0.08, 0.13), p.boots, 0, -0.94, 0.1)
        .build(), leg);
      return [leg, shin];
    }
    mk(new GeoBuilder().add(new THREE.BoxGeometry(0.15, 0.48, 0.17), p.pants, 0, -0.24, 0).build(), leg);
    mk(new GeoBuilder()
      .add(new THREE.BoxGeometry(0.135, 0.3, 0.15), p.pants, 0, -0.15, 0)
      .add(new THREE.BoxGeometry(0.15, 0.24, 0.17), p.boots, 0, -0.36, 0)
      .add(new THREE.BoxGeometry(0.14, 0.08, 0.13), p.boots, 0, -0.46, 0.1)
      .build(), shin);
    return [leg, shin];
  };
  const [legL, shinL] = makeLeg(1);
  const [legR, shinR] = makeLeg(-1);

  let rifle = null, muzzle = null;
  if (withRifle) {
    rifle = new THREE.Group(); torso.add(rifle);
    mk(new GeoBuilder()
      .add(new THREE.BoxGeometry(0.045, 0.11, 0.28), WOOD, 0, -0.02, -0.2)
      .add(new THREE.BoxGeometry(0.04, 0.06, 0.12), WOOD, 0, 0, -0.02)
      .add(new THREE.BoxGeometry(0.05, 0.08, 0.17), METAL, 0, 0.01, 0.12)
      .add(new THREE.CylinderGeometry(0.016, 0.016, 0.66, 6), METAL, 0, 0.03, 0.52, Math.PI / 2, 0, 0)
      .add(new THREE.CylinderGeometry(0.012, 0.012, 0.5, 6), METAL, 0, 0, 0.44, Math.PI / 2, 0, 0)
      .add(new THREE.BoxGeometry(0.045, 0.045, 0.24), WOOD, 0, -0.005, 0.3)
      .add(new THREE.BoxGeometry(0.015, 0.05, 0.1), METAL, 0, -0.06, 0.1)
      .build(), rifle);
    muzzle = new THREE.Object3D(); muzzle.position.set(0, 0.03, 0.87); rifle.add(muzzle);
    rifle.position.copy(RIFLE_BACK_POS); rifle.quaternion.copy(RIFLE_BACK_Q);
  }
  return { root, hips, torso, head, armL, armR, foreL, foreR, legL, legR, shinL, shinR, rifle, muzzle, meshes };
}

function poseHumanoid(h, s) {
  const phase = s.phase || 0, speed = Math.min(s.speed || 0, 1), run = s.run || 0, aim = s.aim || 0;
  const pitch = s.pitch || 0, crouch = s.crouch || 0, t = s.t || 0, gesture = s.gesture || 0;
  const sw = Math.sin(phase);
  const legAmp = speed * (0.5 + run * 0.35);
  let lL = -sw * legAmp, lR = sw * legAmp;
  let sL = Math.max(0, Math.sin(phase - 1.3)) * legAmp * 1.5 + 0.05;
  let sR = Math.max(0, Math.sin(phase + Math.PI - 1.3)) * legAmp * 1.5 + 0.05;
  const armAmp = speed * (0.35 + run * 0.55);
  let aLx = sw * armAmp, aRx = -sw * armAmp, aLz = 0.1, aRz = -0.1;
  let fL = -0.15 - run * 0.9 * speed, fR = fL;
  let hipY = 0.98 - Math.abs(sw) * 0.04 * speed - run * 0.03;
  let torsoX = run * 0.2 * speed + Math.sin(t * 1.6) * 0.012;

  if (aim > 0) {
    aLx = lerp(aLx, -1.42, aim); aLz = lerp(aLz, -0.5, aim); fL = lerp(fL, -0.25, aim);
    aRx = lerp(aRx, -1.2, aim); aRz = lerp(aRz, 0.42, aim); fR = lerp(fR, -0.95, aim);
    torsoX = lerp(torsoX, -pitch * 0.85, aim);
  }
  const ride = s.ride || 0;
  if (ride > 0) {
    // Jinete: piernas abiertas sobre la silla, rodillas flexionadas, manos en las riendas.
    const lean = s.rideLean || 0;
    hipY = lerp(hipY, 0.98, ride);
    lL = lerp(lL, -1.05, ride); lR = lerp(lR, -1.05, ride);
    sL = lerp(sL, 1.25, ride); sR = lerp(sR, 1.25, ride);
    torsoX = lerp(torsoX, 0.08 + lean * 0.3, ride);
    if (aim < 0.5) {
      aLx = lerp(aLx, -0.75, ride); aLz = lerp(aLz, -0.15, ride); fL = lerp(fL, -0.8, ride);
      aRx = lerp(aRx, -0.75, ride); aRz = lerp(aRz, 0.15, ride); fR = lerp(fR, -0.8, ride);
    }
  }
  if (gesture > 0) {
    aRx += (-0.45 + Math.sin(t * 2.3) * 0.25) * gesture;
    fR += -0.7 * gesture;
  }
  if (crouch > 0) {
    hipY = lerp(hipY, 0.5, crouch);
    lL = lerp(lL, -1.55, crouch); sL = lerp(sL, 2.3, crouch);
    lR = lerp(lR, -0.15, crouch); sR = lerp(sR, 1.55, crouch);
    torsoX = lerp(torsoX, 0.45, crouch);
    const saw = Math.sin(t * 9) * 0.25;
    aRx = lerp(aRx, -0.9 + saw, crouch); fR = lerp(fR, -0.6, crouch);
    aLx = lerp(aLx, -0.7, crouch); fL = lerp(fL, -0.5, crouch);
  }
  // --- Fase 3 ---
  const hunker = s.hunker || 0, hands = s.hands || 0, bound = s.bound || 0;
  if (hunker > 0) {   // agachado tras una cobertura, fusil cruzado sobre el pecho
    hipY = lerp(hipY, 0.62, hunker);
    lL = lerp(lL, -0.95, hunker); sL = lerp(sL, 1.6, hunker);
    lR = lerp(lR, -0.75, hunker); sR = lerp(sR, 1.4, hunker);
    torsoX = lerp(torsoX, 0.3, hunker);
    aLx = lerp(aLx, -0.9, hunker); fL = lerp(fL, -1.1, hunker); aRx = lerp(aRx, -0.8, hunker); fR = lerp(fR, -1.2, hunker);
  }
  const sit = s.sit || 0, chop = s.chop || 0;
  if (sit > 0) {      // sentado sobre un tronco, manos sobre las rodillas (piernas rectas en la versión lite)
    hipY = lerp(hipY, 0.5, sit);
    lL = lerp(lL, -1.45, sit); lR = lerp(lR, -1.45, sit); sL = lerp(sL, 1.5, sit); sR = lerp(sR, 1.5, sit);
    torsoX = lerp(torsoX, 0.08, sit); aLx = lerp(aLx, -0.55, sit); aRx = lerp(aRx, -0.55, sit); fL = lerp(fL, -0.9, sit); fR = lerp(fR, -0.9, sit);
  }
  if (chop > 0) {     // hachazo: los dos brazos suben y bajan con el torso
    const ph = 0.5 + 0.5 * Math.sin(t * 3.4), up = ph * ph;
    aLx = lerp(aLx, -0.5 - up * 1.9, chop); aRx = lerp(aRx, -0.5 - up * 1.9, chop); aLz = lerp(aLz, -0.12, chop); aRz = lerp(aRz, 0.12, chop);
    fL = lerp(fL, -0.35, chop); fR = lerp(fR, -0.35, chop); torsoX = lerp(torsoX, 0.5 - up * 0.45, chop); hipY = lerp(hipY, 0.92, chop);
  }
  if (bound > 0) {    // muñecas atadas al frente
    aLx = lerp(aLx, -0.75, bound); aLz = lerp(aLz, -0.12, bound); fL = lerp(fL, -1.2, bound);
    aRx = lerp(aRx, -0.75, bound); aRz = lerp(aRz, 0.12, bound); fR = lerp(fR, -1.2, bound);
    torsoX = lerp(torsoX, 0.12, bound);
  }
  if (hands > 0) {    // manos arriba (rendición, miedo)
    aLx = lerp(aLx, -2.85, hands); aLz = lerp(aLz, -0.25, hands); fL = lerp(fL, -0.3, hands);
    aRx = lerp(aRx, -2.85, hands); aRz = lerp(aRz, 0.25, hands); fR = lerp(fR, -0.3, hands);
  }
  h.hips.position.y = hipY;
  h.torso.rotation.x = torsoX;
  h.legL.rotation.set(lL, 0, 0.42 * ride); h.legR.rotation.set(lR, 0, -0.42 * ride);
  h.shinL.rotation.x = sL; h.shinR.rotation.x = sR;
  h.armL.rotation.set(aLx, 0, aLz); h.armR.rotation.set(aRx, 0, aRz);
  h.foreL.rotation.x = fL; h.foreR.rotation.x = fR;
  h.head.rotation.y = s.headYaw || 0;
  h.head.rotation.x = aim > 0 ? lerp(0, pitch * -0.1, aim) : (s.headPitch || 0);
  if (h.rifle) {
    const ra = s.rifleAim ?? aim;
    h.rifle.position.lerpVectors(RIFLE_BACK_POS, RIFLE_AIM_POS, ra);
    h.rifle.quaternion.slerpQuaternions(RIFLE_BACK_Q, RIFLE_AIM_Q, ra);
  }
}

export { PALETTES, WOOD, METAL, RIFLE_BACK_POS, RIFLE_BACK_Q, RIFLE_AIM_POS, RIFLE_AIM_Q, buildHumanoid, poseHumanoid };
