// Orquestador del mundo: generación, chunks, cielo, luz, estructuras y estado del mundo.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { distXZ, mulberry32 } from '../core/MathUtils.js';
import { MAT } from '../render/GeometryKit.js';
import { TimeOfDay } from './TimeOfDay.js';
import { WorldGen } from './WorldGen.js';
import { ChunkManager } from './ChunkManager.js';
import { buildCamp, buildTradingPost } from './Structures.js';

const _v = new THREE.Vector3();
const _lanternColor = new THREE.Color(0xffc070);

class WorldManager {
  constructor(game) {
    this.game = game; this.scene = game.scene;
    this.gen = new WorldGen(9137);
    this.noise = this.gen.noise;
    this.staticObstacles = [];
    this.solidTargets = [];
    this.flags = new Set();
    this.time = new TimeOfDay(CONFIG.START_HOUR);
    this.elapsed = 0;
    this._emitAcc = { ember: 0, smoke: 0 };
    this._buildLights();
    this._buildSky();
    this.chunks = new ChunkManager(this);
    this.solidTargets.push(this.chunks.veg.pine, this.chunks.veg.oak, this.chunks.veg.rock);
    this.camp = buildCamp(this);
    this.firePos = this.camp.firePos;
    this.post = buildTradingPost(this);
    this.chunks.update({ x: CONFIG.PLAYER_SPAWN.x, z: CONFIG.PLAYER_SPAWN.z }, true);
  }

  getHeightAt(x, z) { return this.gen.getHeightAt(x, z); }
  getSlopeAt(x, z) { return this.gen.getSlopeAt(x, z); }
  forestWeight(x, z) { return this.gen.forestWeight(x, z); }

  raycastTerrain(origin, dir, maxDist) {
    const step = 1.0; let prevT = 0;
    for (let t = step; t <= maxDist; t += step) {
      const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
      if (y < this.getHeightAt(x, z)) {
        let lo = prevT, hi = t;
        for (let k = 0; k < 8; k++) {
          const mid = (lo + hi) / 2;
          if (origin.y + dir.y * mid < this.getHeightAt(origin.x + dir.x * mid, origin.z + dir.z * mid)) hi = mid; else lo = mid;
        }
        return hi;
      }
      prevT = t;
    }
    return Infinity;
  }

  // Empuja un punto fuera de los obstáculos cercanos (estáticos + chunk actual). Devuelve true si chocó.
  pushOut(p, radius) {
    let hit = false;
    const test = (o) => {
      const dx = p.x - o.x, dz = p.z - o.z, min = o.r + radius;
      if (dx > min || dx < -min || dz > min || dz < -min) return;
      const d2 = dx * dx + dz * dz;
      if (d2 < min * min && d2 > 1e-6) { const d = Math.sqrt(d2), k = (min - d) / d; p.x += dx * k; p.z += dz * k; hit = true; }
    };
    for (const o of this.staticObstacles) test(o);
    this.chunks.forEachSlotNear(p.x, p.z, radius + 2, (slot) => { for (const o of slot.obstacles) test(o); });
    return hit;
  }
  // ¿Hay un obstáculo en el círculo (x, z, r)? Útil para que la IA esquive.
  isBlocked(x, z, r) {
    let blocked = false;
    const test = (o) => { if (!blocked && Math.hypot(x - o.x, z - o.z) < o.r + r) blocked = true; };
    for (const o of this.staticObstacles) test(o);
    if (!blocked) this.chunks.forEachSlotNear(x, z, r + 2, (slot) => { for (const o of slot.obstacles) test(o); });
    return blocked;
  }
  clampToWorld(p) {
    const L = CONFIG.WORLD_LIMIT;
    p.x = Math.max(-L, Math.min(L, p.x)); p.z = Math.max(-L, Math.min(L, p.z));
  }

  _buildLights() {
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    this.sun.castShadow = true;
    const sh = this.sun.shadow, ext = CONFIG.SHADOW_EXTENT;
    sh.mapSize.set(CONFIG.SHADOW_MAP_SIZE, CONFIG.SHADOW_MAP_SIZE);
    sh.camera.left = -ext; sh.camera.right = ext; sh.camera.top = ext; sh.camera.bottom = -ext;
    sh.camera.near = 1; sh.camera.far = 400; sh.bias = -0.0005; sh.normalBias = 0.04;
    sh.camera.updateProjectionMatrix();
    this.scene.add(this.sun, this.sun.target);
    this.hemi = new THREE.HemisphereLight(0xb4cce6, 0x63513a, 1.2);
    this.scene.add(this.hemi);
    this.scene.fog = new THREE.FogExp2(0xe2cfa8, 0.0065);
  }

  _buildSky() {
    this.skyGroup = new THREE.Group();
    this.skyUniforms = {
      topColor: { value: new THREE.Color() }, horizonColor: { value: new THREE.Color() }, sunColor: { value: new THREE.Color() },
      sunDir: { value: new THREE.Vector3(0, 1, 0) }, moonDir: { value: new THREE.Vector3(0, -1, 0) }, nightFactor: { value: 0 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.skyUniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: `
        varying vec3 vDir;
        void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
      fragmentShader: `
        uniform vec3 topColor; uniform vec3 horizonColor; uniform vec3 sunColor;
        uniform vec3 sunDir; uniform vec3 moonDir; uniform float nightFactor;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float h = d.y;
          vec3 col = mix(horizonColor, topColor, pow(clamp(h, 0.0, 1.0), 0.45));
          col = mix(col, horizonColor * 0.7, clamp(-h * 4.0, 0.0, 1.0));
          float sunVis = smoothstep(-0.08, 0.04, sunDir.y);
          float sd = max(dot(d, normalize(sunDir)), 0.0);
          col += sunColor * (pow(sd, 6.0) * 0.35 + pow(sd, 64.0) * 0.45) * sunVis;
          col += sunColor * smoothstep(0.9993, 0.9997, sd) * 1.5 * sunVis;
          float md = max(dot(d, normalize(moonDir)), 0.0);
          col += vec3(0.85, 0.9, 1.0) * smoothstep(0.9994, 0.99965, md) * nightFactor;
          col += vec3(0.35, 0.45, 0.7) * pow(md, 30.0) * 0.18 * nightFactor;
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
        }`,
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), skyMat);
    sky.renderOrder = -10; sky.frustumCulled = false;
    this.skyGroup.add(sky);
    const rand = mulberry32(5), starPos = [];
    for (let i = 0; i < 1400; i++) {
      const u = rand() * 2 - 1, th = rand() * Math.PI * 2, y = Math.abs(u), r = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(th) * r * 850, y * 850 + 20, Math.sin(th) * r * 850);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(sg, this.starMat); this.stars.frustumCulled = false; this.stars.renderOrder = -9;
    this.skyGroup.add(this.stars);
    this.scene.add(this.skyGroup);
  }

  applyFlag(flag) {
    if (this.flags.has(flag)) return;
    this.flags.add(flag);
    if (flag === 'camp_fed') {
      this.camp.fedProps.visible = true;
      this.staticObstacles.push({ x: CONFIG.CAMP.x - 3.0, z: CONFIG.CAMP.z + 3.6, r: 1.0 });
    }
  }

  update(dt, playerPos, camera) {
    this.elapsed += dt;
    MAT.windUniforms.uTime.value = this.elapsed;
    const s = this.time.update(dt);
    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI * s.lightIntensityScale;
    this.hemi.color.copy(s.hs); this.hemi.groundColor.copy(s.hg); this.hemi.intensity = s.hI;
    this.scene.fog.color.copy(s.fog); this.scene.fog.density = s.fd;
    const u = this.skyUniforms;
    u.topColor.value.copy(s.top); u.horizonColor.value.copy(s.fog); u.sunColor.value.copy(s.sun);
    u.sunDir.value.copy(s.sunDir); u.moonDir.value.copy(s.moonDir); u.nightFactor.value = s.night;
    this.starMat.opacity = s.night * 0.9;
    this.stars.rotation.y += dt * 0.004;
    this.skyGroup.position.copy(camera.position);

    this.chunks.update(playerPos);

    const tx = Math.round(playerPos.x / 2) * 2, tz = Math.round(playerPos.z / 2) * 2;
    this.sun.target.position.set(tx, playerPos.y, tz);
    this.sun.position.set(tx + s.lightDir.x * 150, playerPos.y + s.lightDir.y * 150, tz + s.lightDir.z * 150);
    this.sun.target.updateMatrixWorld();

    const c = this.camp, t = this.elapsed;
    const nearCamp = distXZ(playerPos, this.firePos) < 160;
    c.flames.visible = nearCamp;
    if (nearCamp) {
      const flick = this.noise.noise(t * 3.1, 0.5) * 0.5 + this.noise.noise(t * 7.3, 3.1) * 0.25;
      c.fireLight.intensity = (26 + flick * 14) * (0.55 + s.night * 0.7);
      c.flameMeshes.forEach((m, i) => {
        const k = 1 + this.noise.noise(t * (4 + i), i * 10) * 0.35;
        m.scale.set(1 + this.noise.noise(t * 5 + i, 2) * 0.15, k, 1 + this.noise.noise(t * 5 + i, 7) * 0.15);
        m.position.y = m.userData.h * k / 2; m.rotation.y = t * (0.6 + i * 0.3);
      });
      c.fireGlow.material.opacity = 0.35 + s.night * 0.45 + flick * 0.1;
      this._emitFire(dt);
    } else c.fireLight.intensity = 0;
    c.lantern.material.color.setScalar(0.5 + s.night * 0.5).multiply(_lanternColor);
    this.post.lantern.material.color.setScalar(0.5 + s.night * 0.5).multiply(_lanternColor);
    return s;
  }

  _emitFire(dt) {
    const fx = this.game.fx, fp = this.firePos;
    this._emitAcc.ember += dt * 14; this._emitAcc.smoke += dt * 3.5;
    while (this._emitAcc.ember >= 1) {
      this._emitAcc.ember -= 1;
      fx.glow.emit(_v.set(fp.x + (Math.random() - 0.5) * 0.6, fp.y + 0.3, fp.z + (Math.random() - 0.5) * 0.6),
        { x: (Math.random() - 0.5) * 0.6, y: 1.2 + Math.random() * 1.5, z: (Math.random() - 0.5) * 0.6 },
        { life: 1.4 + Math.random() * 1.2, size: 0.05 + Math.random() * 0.04, color: Math.random() < 0.5 ? 0xff8a30 : 0xffc060, gravity: -0.3, drag: 0.6 });
    }
    while (this._emitAcc.smoke >= 1) {
      this._emitAcc.smoke -= 1;
      fx.dust.emit(_v.set(fp.x + (Math.random() - 0.5) * 0.3, fp.y + 1.2, fp.z + (Math.random() - 0.5) * 0.3),
        { x: 0.25 + (Math.random() - 0.5) * 0.3, y: 0.7 + Math.random() * 0.4, z: (Math.random() - 0.5) * 0.3 },
        { life: 4.5, size: 0.5, grow: 4, color: 0x55504a, alpha: 0.22, drag: 0.15 });
    }
  }
}

export { WorldManager };
