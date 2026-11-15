// Instinto de Cazador (tecla V).
// - Filtro desaturado/azulado: CSS filter sobre el canvas (lo compone la GPU, sin pasada extra de render).
// - Rastros: un único THREE.Points (1 draw call) que se rellena con las huellas de cada animal
//   (TrackTrail = buffer circular de posiciones) y una línea punteada del jugador a los animales cercanos.
// - Los animales se resaltan cambiando su material por uno con emisivo.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { damp, distXZ } from '../core/MathUtils.js';

class TrackTrail {
  constructor(n = 16, spacing = 2.2) {
    this.n = n; this.spacing2 = spacing * spacing;
    this.pts = new Float32Array(n * 3); this.count = 0; this.head = 0; this.lx = null; this.lz = null;
  }
  push(p) {
    if (this.lx !== null) { const dx = p.x - this.lx, dz = p.z - this.lz; if (dx * dx + dz * dz < this.spacing2) return; }
    this.lx = p.x; this.lz = p.z;
    const i = this.head * 3;
    this.pts[i] = p.x; this.pts[i + 1] = p.y; this.pts[i + 2] = p.z;
    this.head = (this.head + 1) % this.n; this.count = Math.min(this.count + 1, this.n);
  }
  reset() { this.count = 0; this.head = 0; this.lx = null; this.lz = null; }
  forEach(fn) {
    for (let k = 0; k < this.count; k++) {
      const i = ((this.head - 1 - k + this.n) % this.n) * 3;
      fn(this.pts[i], this.pts[i + 1], this.pts[i + 2], k);
    }
  }
}

const SPECIES_COLOR = { deer: new THREE.Color(0xffc860), wolf: new THREE.Color(0xff4a3a), horse: new THREE.Color(0xdde8ff) };

class HunterInstinct {
  constructor(game) {
    this.game = game;
    this.active = false; this.timer = 0; this.cooldown = 0; this.blend = 0; this._lastQ = -1;
    this.capacity = 1000;
    this.pos = new Float32Array(this.capacity * 3); this.col = new Float32Array(this.capacity * 3);
    this.size = new Float32Array(this.capacity); this.alpha = new Float32Array(this.capacity);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos); geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize); geo.setAttribute('aAlpha', this.aAlpha);
    geo.setDrawRange(0, 0);
    this.material = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: `
        attribute vec3 aColor; attribute float aSize; attribute float aAlpha;
        uniform float uScale; varying vec3 vColor; varying float vAlpha;
        void main() {
          vColor = aColor; vAlpha = aAlpha;
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = max(aSize * uScale / max(-mv.z, 0.1), 2.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: `
        varying vec3 vColor; varying float vAlpha;
        void main() {
          float d = length(gl_PointCoord - 0.5);
          if (d > 0.5) discard;
          gl_FragColor = vec4(vColor * 1.6, smoothstep(0.5, 0.05, d) * vAlpha);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false; this.points.visible = false; this.points.renderOrder = 5;
    game.scene.add(this.points);
    this.overlay = document.getElementById('instinct-overlay');
    this.canvas = game.renderer.domElement;
  }

  toggle() {
    if (this.active) { this.deactivate(); return; }
    if (this.cooldown > 0) { this.game.ui.notify('Instinto agotado', `Disponible en ${Math.ceil(this.cooldown)} s`); return; }
    this.active = true; this.timer = CONFIG.INSTINCT_DURATION;
    this.game.audio.playInstinct(true);
  }
  deactivate() {
    if (!this.active) return;
    this.active = false; this.cooldown = CONFIG.INSTINCT_COOLDOWN;
    this.game.audio.playInstinct(false);
  }

  update(dt) {
    if (this.active) { this.timer -= dt; if (this.timer <= 0) this.deactivate(); }
    else this.cooldown = Math.max(0, this.cooldown - dt);
    this.blend = damp(this.blend, this.active ? 1 : 0, 5, dt);
    const q = Math.round(this.blend * 20) / 20;
    if (q !== this._lastQ) {
      this._lastQ = q;
      this.canvas.style.filter = q > 0
        ? `saturate(${(1 - 0.7 * q).toFixed(2)}) brightness(${(1 - 0.06 * q).toFixed(2)}) contrast(${(1 + 0.1 * q).toFixed(2)}) hue-rotate(${(-8 * q).toFixed(1)}deg)`
        : '';
      if (this.overlay) this.overlay.style.opacity = q;
      const on = q > 0.3;
      this.game.wildlife.setHighlight(on);
      this.game.horse.setHighlight(on);
    }
    if (this.blend > 0.01) this._fill(); else this.points.visible = false;
  }

  _fill() {
    const g = this.game, pp = g.player.position, t = g.elapsed, cam = g.camera, w = g.world;
    this.material.uniforms.uScale.value = g.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(cam.fov) / 2));
    let i = 0;
    const cap = this.capacity, b = this.blend;
    const add = (x, y, z, c, a, s) => {
      if (i >= cap) return;
      this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.alpha[i] = a; this.size[i] = s; i++;
    };
    const list = g.wildlife.getTrackables();
    list.push({ entity: g.horse, species: 'horse', alive: true });
    for (const it of list) {
      const e = it.entity, d = distXZ(e.position, pp);
      if (d > 150) continue;
      const c = SPECIES_COLOR[it.species];
      e.tracks.forEach((x, y, z, k) => {
        const pulse = 0.55 + 0.45 * Math.sin(t * 4 - k * 0.6);
        add(x, y + 0.08, z, c, b * pulse * (1 - k / e.tracks.n * 0.6), 0.32);
      });
      if (!it.alive) add(e.position.x, e.position.y + 1.6 + Math.sin(t * 3) * 0.1, e.position.z, c, b * 0.9, 0.7);
      if (d < 70 && d > 3 && it.species !== 'horse') {
        const steps = Math.floor(d / 2.2), dx = (e.position.x - pp.x) / d, dz = (e.position.z - pp.z) / d;
        for (let k = 1; k < steps; k++) {
          const x = pp.x + dx * k * 2.2, z = pp.z + dz * k * 2.2;
          add(x, w.getHeightAt(x, z) + 0.1, z, c, b * (0.25 + 0.2 * Math.sin(t * 6 - k * 0.5)), 0.16);
        }
      }
    }
    this.points.geometry.setDrawRange(0, i);
    this.points.visible = i > 0;
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }
}

export { HunterInstinct, TrackTrail };
