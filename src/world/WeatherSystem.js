// Clima dinámico: Despejado ⇄ Nublado ⇄ Niebla densa ⇄ Tormenta eléctrica, con transiciones suaves.
//
// Memoria y rendimiento:
//  - La lluvia es UN LineSegments (2400 gotas) + UN Points (salpicaduras) creados una sola vez. Las gotas NO se mueven en CPU:
//    el vertex shader calcula la posición de cada gota a partir del tiempo y la cámara (mod sobre una caja que sigue al jugador),
//    así que el coste por frame es cero en CPU y una actualización de 4 uniformes. Con la lluvia a 0 la malla se oculta.
//  - Los rayos y los truenos usan estructuras fijas (una cola de truenos con cuenta atrás, sin setTimeout) → nada queda huérfano.
//  - El clima modifica el estado de TimeOfDay (que se recalcula cada frame) en lugar de crear luces o materiales nuevos.
import * as THREE from 'three';
import { lerp, smoothstep, clamp } from '../core/MathUtils.js';

const rr = (a, b) => a + Math.random() * (b - a);
const GRAY = new THREE.Color(0x8d949c), STORM = new THREE.Color(0x3c424c), FLASH = new THREE.Color(0xdbe6ff);
const DROPS = 2400, SPLASH = 420;

const RAIN_VERT = `
  uniform float uTime; uniform vec3 uCam; uniform float uIntensity; uniform vec3 uWind; uniform vec3 uBox;
  attribute vec4 aSeed; varying float vA;
  void main() {
    float r = fract(sin(dot(aSeed.xyz, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float on = step(r, uIntensity);
    vec3 vel = vec3(uWind.x, -19.0 - 7.0 * aSeed.y, uWind.z);
    vec3 base = aSeed.xyz * uBox + vel * uTime;
    vec3 p = uCam + (mod(base - uCam, uBox) - 0.5 * uBox);
    p -= normalize(vel) * 0.85 * aSeed.w;                       // la cola de la gota
    vA = (1.0 - aSeed.w) * on * 0.55;
    vec4 mv = viewMatrix * vec4(p, 1.0);
    gl_Position = on > 0.5 ? projectionMatrix * mv : vec4(9.0, 9.0, 9.0, 1.0);
  }`;
const RAIN_FRAG = `
  varying float vA;
  void main() {
    gl_FragColor = vec4(0.72, 0.8, 0.9, vA);
    #include <colorspace_fragment>
  }`;
const SPLASH_VERT = `
  uniform float uTime; uniform vec3 uCam; uniform float uIntensity; uniform float uGround; uniform float uScale;
  attribute vec3 aSeed; varying float vA;
  void main() {
    float r = fract(sin(dot(aSeed, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    float on = step(r, uIntensity);
    float ph = fract(uTime * (1.3 + aSeed.z) + aSeed.x * 7.0);
    vec2 box = vec2(26.0);
    vec2 xz = uCam.xz + (mod(aSeed.xy * box - uCam.xz + 13.0, box) - 13.0);
    vec4 mv = viewMatrix * vec4(xz.x, uGround + 0.03, xz.y, 1.0);
    vA = (1.0 - ph) * on * 0.3;
    // tamaño en píxeles acotado; las salpicaduras a menos de 2,5 m de la cámara se anulan (evita anillos gigantes)
    gl_PointSize = -mv.z < 2.5 ? 0.0 : min(9.0, (2.0 + ph * 7.0) * uScale / max(-mv.z, 1.0) * 0.22);
    gl_Position = projectionMatrix * mv;
  }`;
const SPLASH_FRAG = `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5 || d < 0.3) discard;
    gl_FragColor = vec4(0.8, 0.86, 0.95, vA);
    #include <colorspace_fragment>
  }`;

class WeatherSystem {
  constructor(game, cfg) {
    this.game = game; this.cfg = cfg; this.names = Object.keys(cfg.states);
    this.cur = 'clear'; this.trans = null;
    this.v = { cover: 0, fog: 0, rain: 0, wind: 0.3 };
    this.timer = rr(...cfg.firstDelay); this.time = 0;
    this.flash = 0; this.flashT = -1; this.boltT = rr(5, 10); this.thunderQ = []; this.visibility = 1;
    this._tmpC = new THREE.Color();
    this._buildRain(game.scene);
  }
  get state() { return this.cfg.states[this.trans ? this.trans.to : this.cur]; }
  get stateId() { return this.trans ? this.trans.to : this.cur; }
  get rain() { return this.v.rain; }

  _buildRain(scene) {
    const g = new THREE.BufferGeometry(), seed = new Float32Array(DROPS * 2 * 4), pos = new Float32Array(DROPS * 2 * 3);
    for (let i = 0; i < DROPS; i++) {
      const a = Math.random(), b = Math.random(), c = Math.random();
      for (let k = 0; k < 2; k++) { const o = (i * 2 + k) * 4; seed[o] = a; seed[o + 1] = b; seed[o + 2] = c; seed[o + 3] = k; }
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));   // requerido por Three; el shader ignora su valor
    g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uIntensity: { value: 0 }, uWind: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(40, 26, 40) } };
    this.rain3d = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.rainU, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false }));
    this.rain3d.frustumCulled = false; this.rain3d.visible = false; this.rain3d.renderOrder = 8;
    scene.add(this.rain3d);

    const sg = new THREE.BufferGeometry(), ss = new Float32Array(SPLASH * 3);
    for (let i = 0; i < ss.length; i++) ss[i] = Math.random();
    sg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(SPLASH * 3), 3));
    sg.setAttribute('aSeed', new THREE.BufferAttribute(ss, 3));
    sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.splashU = { uTime: this.rainU.uTime, uCam: this.rainU.uCam, uIntensity: { value: 0 }, uGround: { value: 0 }, uScale: { value: 500 } };
    this.splash3d = new THREE.Points(sg, new THREE.ShaderMaterial({ uniforms: this.splashU, vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG, transparent: true, depthWrite: false }));
    this.splash3d.frustumCulled = false; this.splash3d.visible = false; this.splash3d.renderOrder = 8;
    scene.add(this.splash3d);
  }

  /* ---------------- máquina de estados ---------------- */
  force(id, instant = true) {
    if (!this.cfg.states[id]) return;
    if (instant) { this.cur = id; this.trans = null; Object.assign(this.v, this._target(id)); this.timer = rr(...this.cfg.duration); }
    else this._begin(id);
  }
  _target(id) { const s = this.cfg.states[id]; return { cover: s.cover, fog: s.fog, rain: s.rain, wind: s.wind }; }
  _begin(to) {
    this.trans = { from: { ...this.v }, to, t: 0, dur: rr(...this.cfg.transition) };
    if (this.game.started && this.cfg.announce[to]) this.game.ui.notify(this.cfg.states[to].name, this.cfg.announce[to]);
  }
  _pickNext() {
    const table = this.cfg.next[this.cur]; let r = Math.random();
    for (const [id, w] of Object.entries(table)) { if ((r -= w) <= 0) return id; }
    return Object.keys(table)[0];
  }

  update(dt, camera, pp, s) {
    this.time += dt;
    if (this.trans) {
      const T = this.trans; T.t += dt;
      const k = smoothstep(0, 1, T.t / T.dur), tg = this._target(T.to);
      for (const key of ['cover', 'fog', 'rain', 'wind']) this.v[key] = lerp(T.from[key], tg[key], k);
      if (T.t >= T.dur) { this.cur = T.to; this.trans = null; this.timer = rr(...this.cfg.duration); Object.assign(this.v, tg); }
    } else { this.timer -= dt; if (this.timer <= 0) this._begin(this._pickNext()); }
    const v = this.v;
    this.visibility = clamp(1 - v.fog * 0.5 - v.rain * 0.22, 0.35, 1);

    // --- rayos y truenos (solo en tormenta fuerte) ---
    if (v.rain > 0.55) {
      this.boltT -= dt;
      if (this.boltT <= 0) {
        this.boltT = rr(6, 18) * (1.6 - v.rain * 0.6); this.flashT = 0;
        const dist = rr(120, 1500); this.thunderQ.push({ t: dist / 340, dist });   // sonido a 340 m/s
      }
    }
    if (this.flashT >= 0) {
      this.flashT += dt; const t = this.flashT;
      this.flash = t < 0.06 ? t / 0.06 : t < 0.13 ? lerp(1, 0.25, (t - 0.06) / 0.07) : t < 0.2 ? lerp(0.25, 0.85, (t - 0.13) / 0.07) : Math.max(0, 0.85 - (t - 0.2) * 3.2);
      if (t > 0.5) { this.flashT = -1; this.flash = 0; }
    }
    for (let i = this.thunderQ.length - 1; i >= 0; i--) {
      const q = this.thunderQ[i]; q.t -= dt;
      if (q.t <= 0) { this.game.audio.playThunder(q.dist); this.thunderQ.splice(i, 1); }
    }

    // --- modulación del cielo y la luz ---
    const c = v.cover; s.cloud = c;
    const day = 0.35 + 0.65 * (1 - s.night);
    s.sunI *= lerp(1, 0.32, c); s.hI *= lerp(1, 0.82, c) * lerp(1, 0.9, v.rain);
    s.sun.multiplyScalar(lerp(1, 0.4, c));
    this._tmpC.copy(GRAY).multiplyScalar(day * (1 - 0.45 * v.rain)).lerp(STORM, v.rain * 0.45);
    s.top.lerp(this._tmpC, c * 0.8); s.fog.lerp(this._tmpC, clamp(c * 0.55 + v.fog * 0.5, 0, 0.9));
    s.hs.lerp(this._tmpC, c * 0.35);
    s.fd = s.fd * (1 + v.fog * 3.4 + v.rain * 0.7);
    if (this.flash > 0) {
      s.hI += this.flash * 1.5; s.sunI += this.flash * 1.5; s.lightIntensityScale = Math.max(s.lightIntensityScale, this.flash * 0.7);
      s.top.lerp(FLASH, this.flash * 0.4); s.fog.lerp(FLASH, this.flash * 0.22);
    }

    // --- lluvia GPU: solo uniformes ---
    const R = v.rain, on = R > 0.02;
    this.rain3d.visible = this.splash3d.visible = on;
    if (on) {
      const u = this.rainU, wind = v.wind;
      u.uTime.value = this.time; u.uCam.value.copy(camera.position); u.uIntensity.value = Math.min(1, R * 1.05);
      u.uWind.value.set(-3.2 * wind, 0, -1.4 * wind);
      this.splashU.uIntensity.value = Math.min(1, R * 1.05); this.splashU.uGround.value = this.game.world.getHeightAt(camera.position.x, camera.position.z);
      this.splashU.uScale.value = this.game.renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    }
    return v;
  }
  toJSON() { return { state: this.stateId }; }
  fromJSON(d) { if (d && this.cfg.states[d.state]) this.force(d.state, true); }
}

export { WeatherSystem };
