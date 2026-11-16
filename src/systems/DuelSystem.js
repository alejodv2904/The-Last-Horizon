// Duelo del Oeste (jefes de capítulo).
//
//   · Cinemática: barras negras, cámara lateral, el rival a 11 pasos y música de duelo.
//   · "Estar a la espera": mantén el CLIC IZQUIERDO con suavidad para cargar el medidor de desenfunde rápido. Sube mientras
//     lo mantienes y baja al soltar; la zona dorada es la ideal: por debajo desenfundas lento, y si te pasas "te tiembla el pulso".
//   · Suena la campana: pulsa el CLIC DERECHO (o ESPACIO) para desenfundar lo antes posible. Desenfundar antes de la campana
//     es un falso desenfunde (disparas más tarde y el rival se adelanta). Gana quien dispare antes y acierte.
//   · Si el duelo admite clemencia (mercy), pulsa X para disparar al aire y perdonar al rival.
//   · Perder no mata: el duelo se repite y el rival se vuelve un poco más lento cada intento.
import * as THREE from 'three';
import { clamp, lerp, damp, dampAngle } from '../core/MathUtils.js';
import { paletteFor, poseHumanoid } from '../entities/CharacterFactory.js';

const SWEET = [62, 88];
const _v = new THREE.Vector3();
const rr = (a, b) => a + Math.random() * (b - a);
const quality = (f, jitter) => {
  const q = f >= SWEET[0] && f <= SWEET[1] ? 1 : f < SWEET[0] ? lerp(0.15, 1, f / SWEET[0]) : lerp(1, 0.2, (f - SWEET[1]) / (100 - SWEET[1]));
  return jitter > 0 ? q * 0.5 : q;
};

class DuelSystem {
  constructor(game) {
    this.game = game; this.active = false; this.phase = 'idle'; this.opp = null; this.cfg = null; this.leftovers = [];
    this.cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 40 };
    this.slow = 1; this._t = 0; this.attempts = 0;
  }

  // cfg: { id, name, palette?, skill?, mercy?, toward?: {x,z}, onEnd(result) }  result: 'win' | 'mercy'
  start(cfg) {
    const g = this.game;
    if (this.active) return;
    this.clearLeftovers();
    this.cfg = cfg; this.active = true; this.attempts = 0; this.skill = cfg.skill ?? 0.6;
    if (g.player.riding) g.player.dismountHorse();
    g.deadEye.deactivate(); g.instinct.deactivate(); g.setMode('duel'); g.ui.setLetterbox(true);
    this._setup(true);
  }

  _setup(first) {
    const g = this.game, p = g.player, cfg = this.cfg;
    let dx, dz;
    if (cfg.toward) { dx = cfg.toward.x - p.position.x; dz = cfg.toward.z - p.position.z; }
    if (!cfg.toward || Math.hypot(dx, dz) < 4) { dx = Math.sin(p.heading); dz = Math.cos(p.heading); }
    const len = Math.hypot(dx, dz) || 1; dx /= len; dz /= len;
    let ox = p.position.x + dx * 11, oz = p.position.z + dz * 11;
    _v.set(ox, 0, oz); g.world.pushOut(_v, 0.6); ox = _v.x; oz = _v.z;
    if (!this.opp) {
      this.opp = g.bandits.addGunman({ id: `duel_${cfg.id}_${Date.now()}`, name: cfg.name, faction: 'bandit', role: 'duelist', palette: paletteFor(cfg.palette || cfg.id), x: ox, z: oz, skill: this.skill });
      this.opp.active = false; this.opp.talking = false;
    } else this.opp.spawn(ox, oz);
    const o = this.opp; o.position.set(ox, g.world.getHeightAt(ox, oz), oz); o.heading = Math.atan2(-dx, -dz); o.model.rifle.visible = true; o.root.visible = true;
    p.faceTarget = o.position; p.velocity.set(0, 0, 0);
    this.focus = 0; this.jitter = 0; this.over = 0; this.pressed = false; this.early = false; this.shotsOpp = 0; this.shotsPl = 0;
    this.oppAim = 0; this.plAim = 0; this.oppAt = Infinity; this.plAt = Infinity; this.signalAt = 0; this.decided = null; this._t = 0; this._tick = 0;
    this._prevRight = g.input.mouse.right; this.slow = 1;
    this.phase = 'intro';
    this.stareFor = rr(3.6, 6.4);
    g.ui.duelShow(this.cfg.name, first ? 'Duelo del Oeste' : `Intento ${this.attempts + 1}`);
    g.ui.duelPrompt('');
  }

  get oppTime() { return lerp(0.64, 0.34, clamp(this.skill, 0, 1)) + rr(0, 0.08); }

  update(dt, input) {
    if (!this.active) return;
    const g = this.game;
    this._t += dt;
    // ---- entrada del jugador ----
    const hold = input.mouse.left, right = input.mouse.right, drawPress = (right && !this._prevRight) || input.wasPressed('Space');
    this._prevRight = right;
    const mercyPress = this.cfg.mercy && input.wasPressed('KeyX');
    if (this.phase === 'stare' || this.phase === 'signal') {
      if (!this.pressed && !this.decided) {
        if (hold) this.focus = Math.min(100, this.focus + 30 * dt); else this.focus = Math.max(0, this.focus - 38 * dt);
        if (this.focus >= 100) { this.over += dt; if (this.over > 0.45) { this.focus = 45; this.jitter = 0.9; this.over = 0; g.audio.playDuelTick(); } } else this.over = 0;
        this.jitter = Math.max(0, this.jitter - dt);
      }
      g.ui.duelGauge(this.focus, SWEET, this.jitter > 0);
    }

    switch (this.phase) {
      case 'intro':
        if (this._t > 1.6) { this.phase = 'stare'; this._t = 0; g.ui.duelPrompt('Mantén el CLIC IZQUIERDO para concentrarte · Zona dorada = desenfunde rápido'); }
        break;
      case 'stare':
        if (this._t - this._tick > 0.9) { this._tick = this._t; g.audio.playDuelTick(); }
        if (mercyPress) { this._mercy(); break; }
        if (drawPress) { this.early = true; this._beginSignal(true); this._playerDraw(); break; }
        if (this._t > this.stareFor) this._beginSignal(false);
        break;
      case 'signal': {
        const t = g.elapsed;
        if (mercyPress) { this._mercy(); break; }
        if (drawPress && !this.pressed) this._playerDraw();
        // El rival levanta el arma poco antes de disparar.
        this.oppAim = clamp(1 - (this.oppAt - t) / 0.3, 0, 1);
        let guard = 4;
        while (!this.decided && guard-- > 0) {
          const next = this.oppAt <= this.plAt ? 'opp' : 'pl', at = next === 'opp' ? this.oppAt : this.plAt;
          if (t < at) break;
          this._fire(next);
        }
        break;
      }
      case 'result':
        if (this._t > this._resultFor) this._end();
        break;
      default: break;
    }

    if (!this.active || !this.opp) return;   // el duelo pudo terminar (o repetirse) dentro de este mismo frame
    this._animate(dt);
    if (this.decided && this.phase === 'signal') { this.phase = 'result'; this._t = 0; }
  }

  _beginSignal(early) {
    const g = this.game, t = g.elapsed;
    this.phase = 'signal'; this._t = 0; this.signalAt = t;
    this.oppAt = t + Math.max(0.2, this.oppTime - (early ? 0.12 : 0)); this.plAt = Infinity;
    if (!early) { g.audio.playBell(); g.audio.music && g.audio.music.stinger('draw'); g.ui.duelFlash('¡FUEGO!'); g.ui.duelPrompt('Clic derecho o ESPACIO: desenfunda'); }
    else { g.ui.duelFlash('¡FALSO DESENFUNDE!'); g.ui.duelPrompt(''); }
  }
  _playerDraw() {
    const g = this.game, t = g.elapsed, q = quality(this.focus, this.jitter);
    this.pressed = true; this.pq = q;
    this.plAt = t + lerp(0.5, 0.2, q) + (this.early ? 0.45 : 0);
    g.player.readyTimer = 2.5;
  }
  _fire(who) {
    const g = this.game, o = this.opp, p = g.player, t = g.elapsed;
    if (who === 'opp') {
      this.shotsOpp++;
      const hit = Math.random() < clamp(0.38 + this.skill * 0.4 + (this.shotsOpp - 1) * 0.15 - (this.attempts > 2 ? 0.1 : 0), 0.1, 0.95);
      this.oppAim = 1; o.model.muzzle.getWorldPosition(o._muzzle);
      g.fx.glow.burst(o._muzzle, 4, { color: 0xffc070, size: 0.22, life: 0.1, speed: 0.4, up: 1 }); g.audio.playShotAt(12);
      g.fx.impact.tracer(o._muzzle, _v.set(p.position.x, p.position.y + 1.25, p.position.z), 0.09, null);
      if (hit) { this.decided = 'lose'; p.shake = 1; g.ui.damageFlash(); g.audio.playHurt(); this._resultFor = 2.4; g.ui.duelFlash('¡HAS PERDIDO EL DUELO!'); g.audio.music && g.audio.music.stinger('defeat'); }
      else { this.oppAt = t + 0.75; }
      return;
    }
    this.shotsPl++;
    const hit = Math.random() < clamp(0.45 + this.pq * 0.5 + (this.shotsPl - 1) * 0.15, 0.1, 0.97);
    if (hit) {
      const lethal = !this.cfg.mercy;
      p.duelShot(o, lethal ? 'kill' : 'wound');
      if (lethal) { o.active = true; o.kill(_v.set(Math.sin(o.heading), 0, Math.cos(o.heading)), 'player', false); setTimeout(() => g.bandits.removeGunman(o), 70000); }
      this.decided = 'win'; this.slow = 0.3; this._resultFor = 2.6;
      g.ui.duelFlash(lethal ? '¡DUELO GANADO!' : `${this.cfg.name} cae herido`);
      g.audio.music && g.audio.music.stinger('victory');
    } else { p.duelShot(o, 'miss'); this.plAt = t + 0.6; this.pq = Math.min(1, this.pq + 0.1); }
  }
  _mercy() {
    const g = this.game;
    this.game.player.duelShot(this.opp, 'air'); this.decided = 'mercy'; this._resultFor = 2.4; this.phase = 'result'; this._t = 0;
    g.ui.duelFlash('Disparas al aire'); g.ui.duelPrompt('');
  }

  // Pose del rival (está congelado fuera de la IA) y cámara cinemática.
  _animate(dt) {
    const g = this.game, o = this.opp, p = g.player;
    const toP = Math.atan2(p.position.x - o.position.x, p.position.z - o.position.z);
    o.heading = dampAngle(o.heading, toP, 8, dt);
    const lose = this.decided === 'win';
    const hands = this.decided === 'mercy' || (lose && this.cfg.mercy) ? 1 : 0;
    this.oppAimBlend = damp(this.oppAimBlend ?? 0, hands ? 0 : this.oppAim, 14, dt);
    o._applyTransform();
    if (!(lose && !this.cfg.mercy)) {   // el rival abatido (kill) lo anima Gunman._updateDead
      poseHumanoid(o.model, { t: g.elapsed + o.seed, aim: this.oppAimBlend, rifleAim: this.oppAimBlend, pitch: 0, hands: hands ? 0.9 : 0, crouch: hands ? 0.6 : 0, gesture: 0 });
    }
    const m = this.cam, mx = (p.position.x + o.position.x) / 2, mz = (p.position.z + o.position.z) / 2;
    const dx = o.position.x - p.position.x, dz = o.position.z - p.position.z, len = Math.hypot(dx, dz) || 1;
    const dist = this.phase === 'signal' ? 9.4 : lerp(11.5, 9.8, clamp(this._t / 5, 0, 1));   // ambos duelistas siempre dentro de cuadro (16:9)
    m.pos.set(mx + dz / len * dist, Math.max(g.world.getHeightAt(mx, mz) + 1.5, 1), mz - dx / len * dist);
    m.pos.y = Math.max(m.pos.y, g.world.getHeightAt(m.pos.x, m.pos.z) + 0.8);
    m.look.set(mx, g.world.getHeightAt(mx, mz) + 1.25, mz);
    m.fov = this.phase === 'signal' ? 38 : 44;
  }

  _end() {
    const g = this.game, o = this.opp, result = this.decided;
    if (result === 'lose') {   // el duelo se repite: rival más lento, sin muerte
      this.attempts++; this.skill = Math.max(0.25, this.skill - 0.05);
      o.spawn(o.position.x, o.position.z); o.active = false;
      g.player.health = Math.max(g.player.health, 40);
      g.ui.duelHide(); this._setup(false);
      if (this.attempts === 3) g.ui.notify('Consejo del duelo', 'Mantén el medidor en la zona dorada y desenfunda en cuanto suene la campana.');
      return;
    }
    this.active = false; this.phase = 'idle'; this.slow = 1;
    g.player.faceTarget = null; g.ui.duelHide(); g.ui.setLetterbox(false); g.setMode('explore');
    if (result === 'win' && !this.cfg.mercy) { /* abatido: ya cayó y se retira solo */ }
    else this.leftovers.push(o);   // vivo (clemencia o herido): permanece en escena hasta que termine la misión
    this.opp = null;
    const cb = this.cfg.onEnd; this.cfg = null;
    if (cb) cb(result);
  }
  // Retira a los rivales que quedaron vivos tras un duelo con clemencia.
  clearLeftovers() { this.leftovers.forEach((o) => this.game.bandits.removeGunman(o)); this.leftovers.length = 0; }
  // Cancela un duelo en curso (p. ej. al morir o cargar partida).
  abort() {
    if (!this.active) return;
    const g = this.game; this.active = false; this.phase = 'idle'; this.slow = 1;
    if (this.opp) { g.bandits.removeGunman(this.opp); this.opp = null; }
    g.player.faceTarget = null; g.ui.duelHide(); g.ui.setLetterbox(false); if (g.mode === 'duel') g.setMode('explore');
    this.cfg = null;
  }
}

export { DuelSystem };
