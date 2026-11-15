import * as THREE from 'three';
import { smoothstep } from '../core/MathUtils.js';

class ParticleSystem {
  constructor(scene, capacity, blending) {
    this.capacity = capacity; this.cursor = 0; this.alive = 0;
    this.pos = new Float32Array(capacity * 3); this.col = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity); this.alpha = new Float32Array(capacity);
    this.vel = new Float32Array(capacity * 3); this.life = new Float32Array(capacity); this.maxLife = new Float32Array(capacity);
    this.gravity = new Float32Array(capacity); this.drag = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity); this.grow = new Float32Array(capacity); this.alpha0 = new Float32Array(capacity);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize); geo.setAttribute('aAlpha', this.aAlpha);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          vec2 c = gl_PointCoord - 0.5; float d = length(c);
          if (d > 0.5 || vAlpha <= 0.001) discard;
          gl_FragColor = vec4(vColor, smoothstep(0.5, 0.12, d) * vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this._c = new THREE.Color();
  }
  emit(p, v, o = {}) {
    const i = this.cursor; this.cursor = (this.cursor + 1) % this.capacity;
    this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y; this.vel[i * 3 + 2] = v.z;
    this._c.set(o.color ?? 0xffffff);
    this.col[i * 3] = this._c.r; this.col[i * 3 + 1] = this._c.g; this.col[i * 3 + 2] = this._c.b;
    this.life[i] = this.maxLife[i] = o.life ?? 1;
    this.size0[i] = this.size[i] = o.size ?? 0.2;
    this.alpha0[i] = this.alpha[i] = o.alpha ?? 1;
    this.gravity[i] = o.gravity ?? 0; this.drag[i] = o.drag ?? 0; this.grow[i] = o.grow ?? 0;
  }
  burst(p, count, o) {
    const v = new THREE.Vector3();
    for (let k = 0; k < count; k++) {
      v.set((Math.random() - 0.5) * 2, Math.random() * (o.up ?? 1), (Math.random() - 0.5) * 2).multiplyScalar(o.speed ?? 2);
      this.emit(p, v, { ...o, life: (o.life ?? 1) * (0.6 + Math.random() * 0.6), size: (o.size ?? 0.2) * (0.6 + Math.random() * 0.8) });
    }
  }
  update(dt, camera, renderer) {
    this.material.uniforms.uScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    let alive = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      alive++;
      const j = i * 3, dr = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[j + 1] -= this.gravity[i] * dt;
      this.vel[j] *= dr; this.vel[j + 1] *= dr; this.vel[j + 2] *= dr;
      this.pos[j] += this.vel[j] * dt; this.pos[j + 1] += this.vel[j + 1] * dt; this.pos[j + 2] += this.vel[j + 2] * dt;
      const k = this.life[i] / this.maxLife[i];
      this.alpha[i] = this.alpha0[i] * Math.min(1, k * 2.5);
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - k));
    }
    if (alive > 0 || this.alive > 0) {
      this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
    }
    this.alive = alive;
  }
}

export { ParticleSystem };
