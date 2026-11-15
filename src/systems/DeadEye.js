// Dead Eye: núcleo/medidor que se recarga cazando, con tiros a la cabeza y bebiendo tónicos.
//
//   Apuntar (clic der.) + [Q]  → el tiempo baja a 0.25x, filtro sepia cálido, la cámara queda fija en la mira.
//   Clic izq.                  → marca el objetivo bajo la mira con una cruz roja (tantas marcas como balas en el cargador, máx. 6).
//   Soltar clic der. o [Q]     → ejecuta la ráfaga: un disparo instantáneo y letal por marca, la cámara salta de blanco en blanco.
//
// El medidor se gasta mientras Dead Eye está activo (≈9 s con el núcleo lleno, en tiempo real, no en tiempo ralentizado).
import * as THREE from 'three';
import { clamp, damp } from '../core/MathUtils.js';

const MAX_MARKS = 6, DRAIN = 11, SHOT_GAP = 0.15;
const _v = new THREE.Vector3(), _p = new THREE.Vector3();
const RECHARGE = { hit: 2, headshot: 14, animalKill: 9, banditKill: 7, tonic: 30 };

class DeadEye {
  constructor(game) {
    this.game = game; this.value = 35; this.active = false; this.executing = false; this.marks = [];
    this.timeScale = 1; this._targetScale = 1; this._prevRight = false; this._queue = []; this._shotT = 0; this._endT = 0; this.unlocked = true;
    this._unlockedHint = false;
  }
  get ready() { return this.value >= 10; }
  add(v) { this.value = clamp(this.value + v, 0, 100); if (this.value >= 99.5 && !this._unlockedHint) { this._unlockedHint = true; this.game.ui.notify('Dead Eye cargado', 'Apunta (clic der.) y pulsa [Q].'); } if (this.value < 60) this._unlockedHint = false; }
  addTonic() { this.add(RECHARGE.tonic); }

  // Resultado de cada disparo del jugador (lo llama PlayerController._applyHit).
  onShot({ kind, headshot, killed }) {
    if (this.executing) return;   // la ráfaga no se recarga a sí misma
    if (kind === 'animal' || kind === 'bandit') this.add(RECHARGE.hit);
    if (headshot && (kind === 'animal' || kind === 'bandit')) { this.add(RECHARGE.headshot); this.game.ui.notify('Tiro a la cabeza', '+Dead Eye'); }
    if (killed) this.add(kind === 'animal' ? RECHARGE.animalKill : kind === 'bandit' ? RECHARGE.banditKill : 0);
  }

  canStart() {
    const g = this.game, p = g.player;
    return g.mode === 'explore' && g.started && !g.paused && !g.duel.active && p.isAiming && this.ready;
  }
  toggle() {
    if (this.executing) return;
    if (!this.active) { if (this.canStart()) this.activate(); else if (this.game.player.isAiming && !this.ready) this.game.ui.notify('Dead Eye sin carga', 'Caza, apunta a la cabeza o bebe un tónico para recargarlo.'); return; }
    this.finish();
  }
  activate() {
    const g = this.game;
    this.active = true; this.marks.length = 0; this._targetScale = 0.25;
    g.instinct.deactivate();
    document.body.classList.add('deadeye');
    g.audio.setSlowmo(true); g.audio.playDeadEye(true);
    g.ui.notify('Dead Eye', 'Clic izq. marca · soltar clic der. o [Q] dispara');
  }
  // Ejecutar la ráfaga (si hay marcas) o cancelar.
  finish() {
    if (!this.active || this.executing) return;
    this._queue = this.marks.filter((m) => m.entity.alive);
    if (!this._queue.length) { this.deactivate(); return; }
    this.executing = true; this._shotT = 0.12; this._endT = 0.45; this._targetScale = 0.4; this.game.player.invulnerable = true;
    this.game.audio.playDeadEye(false);
  }
  deactivate() {
    if (!this.active) return;
    this.active = false; this.executing = false; this._queue.length = 0; this.marks.length = 0; this._targetScale = 1;
    this.game.player.invulnerable = false;
    document.body.classList.remove('deadeye');
    this.game.audio.setSlowmo(false); this.game.ui.clearMarks();
  }

  _mark() {
    const g = this.game, p = g.player;
    if (p.mag <= this.marks.length) { g.ui.notify('Sin balas', 'Recarga: no puedes marcar más objetivos.'); return; }
    if (this.marks.length >= MAX_MARKS) return;
    const t = p.findMarkTarget();
    if (!t || this.marks.some((m) => m.entity === t.entity)) return;
    this.marks.push(t); g.audio.playMark();
  }

  update(dt, input) {   // dt = tiempo real (no ralentizado)
    const g = this.game;
    this.timeScale = damp(this.timeScale, this._targetScale, this._targetScale < this.timeScale ? 14 : 6, dt);
    if (Math.abs(this.timeScale - this._targetScale) < 0.003) this.timeScale = this._targetScale;
    const right = input.mouse.right;
    if (this.active && (g.mode !== 'explore' || g.paused)) { this.deactivate(); this._prevRight = right; return; }
    if (this.active && !this.executing) {
      this.value = Math.max(0, this.value - DRAIN * dt);
      if (input.mouse.leftPressed) this._mark();
      if (this._prevRight && !right) this.finish();   // soltar clic derecho = disparar
      else if (this.value <= 0) this.finish();
    }
    if (this.executing) this._runBurst(dt);
    this._prevRight = right;
    g.ui.setDeadEye(this.value, this.active);
    this._projectMarks();
  }

  // Ráfaga: cada `SHOT_GAP` segundos reales se dispara a una marca; la cámara gira hacia ella.
  _runBurst(dt) {
    const p = this.game.player, cam = this.game.camera;
    this._shotT -= dt;
    const cur = this._queue[0];
    if (cur && cur.entity.alive) {   // la cámara persigue la marca actual (la mira salta de blanco en blanco)
      this.game.player.markPoint(cur, _p);
      const dx = _p.x - cam.position.x, dy = _p.y - cam.position.y, dz = _p.z - cam.position.z, hd = Math.hypot(dx, dz);
      p.yaw = this._lerpAngle(p.yaw, Math.atan2(dx, dz), 1 - Math.exp(-16 * dt));
      p.pitch = clamp(p.pitch + (Math.atan2(dy, hd) - p.pitch) * (1 - Math.exp(-16 * dt)), -0.95, 0.65);
    }
    if (this._shotT <= 0) {
      const t = this._queue.shift();
      if (t) {
        if (t.entity.alive && !p.fireDeadEye(t)) { this._queue.length = 0; this.game.ui.notify('Sin balas', 'Se acabó el cargador.'); }
        this._shotT = SHOT_GAP; this._endT = 0.45;
      } else { this._endT -= dt; if (this._endT <= 0) this.deactivate(); }
    }
  }
  _lerpAngle(a, b, k) { const d = Math.atan2(Math.sin(b - a), Math.cos(b - a)); return a + d * k; }

  // Cruces rojas: se proyectan a pantalla cada frame sobre elementos DOM reutilizados (pool en UIManager).
  _projectMarks() {
    const ui = this.game.ui;
    if (!this.active) return;
    const cam = this.game.camera, W = window.innerWidth, H = window.innerHeight;
    for (let i = 0; i < MAX_MARKS; i++) {
      const m = this.marks[i];
      if (!m || !m.entity.alive) { ui.setMark(i, 0, 0, false); continue; }
      this.game.player.markPoint(m, _v); _v.project(cam);
      ui.setMark(i, (_v.x * 0.5 + 0.5) * W, (-_v.y * 0.5 + 0.5) * H, _v.z < 1);
    }
  }
  toJSON() { return { value: this.value }; }
  fromJSON(d) { if (d && typeof d.value === 'number') this.value = clamp(d.value, 0, 100); }
}

export { DeadEye };
