// Compañero del campamento con rutina diaria (según la hora del juego y el clima):
//   Tobías (leñador): corta leña de día · se sienta en la fogata al anochecer · duerme en su tienda
//   Rosa (cocinera):  cocina y va y viene entre la lumbre y la mesa · se sienta · duerme
//   Jim (vigía, con rifle): patrulla el perímetro · se sienta un rato · hace guardia nocturna junto a su puesto
// Con lluvia fuerte o tormenta todos se refugian en las tiendas (desaparecen al entrar → 0 draw calls).
// Cumple la interfaz de NPC (id, name, position, talking, active) para reutilizar prompts y diálogos.
import * as THREE from 'three';
import { clamp, damp, dampAngle, distXZ, wrapAngle } from '../core/MathUtils.js';
import { GeoBuilder, MAT } from '../render/GeometryKit.js';
import { PALETTES, buildHumanoid, poseHumanoid } from './CharacterFactory.js';

const rr = (a, b) => a + Math.random() * (b - a);
const between = (h, a, b) => (a <= b ? h >= a && h < b : h >= a || h < b);

class Companion {
  constructor(game, camp, cfg) {
    this.game = game; this.camp = camp; this.id = cfg.id; this.role = cfg.role; this.name = game.story.npcs[cfg.id].name;
    this.interaction = 'dialogue'; this.shopId = null; this.active = true; this.talking = false; this.viewDist = 150;
    const watch = cfg.role === 'watch';
    this.model = buildHumanoid(PALETTES[cfg.palette], watch, { lite: !watch, shadow: 'body' });
    this.root = this.model.root; this.root.rotation.order = 'YXZ'; game.scene.add(this.root);
    this.position = new THREE.Vector3(cfg.x, game.world.getHeightAt(cfg.x, cfg.z), cfg.z);
    this.heading = Math.random() * 6.28; this.speed = 0; this.phase = Math.random() * 10; this.seed = Math.random() * 50;
    this.sit = 0; this.chop = 0; this.gesture = 0; this.seat = cfg.seat; this.tent = cfg.tent; this.hidden = false; this.pause = 0; this.wp = 0; this.kind = 'idle';
    if (cfg.role === 'woodcutter') {   // hacha en la mano derecha (1 malla pequeña, visible solo al cortar)
      this.axe = new THREE.Mesh(new GeoBuilder().add(new THREE.BoxGeometry(0.05, 0.62, 0.05), 0x6e4526, 0, -0.78, 0.04).add(new THREE.BoxGeometry(0.22, 0.17, 0.035), 0x6a6a72, 0.08, -1.02, 0.04).build(), MAT.vcDouble);
      this.axe.visible = false; this.model.armR.add(this.axe);
    }
    this._sync();
  }
  get marker() { return null; }
  getMarker() { return null; }

  // Objetivo según rutina: { kind, x, z, fx, fz }
  _goal(hour, rain, lay) {
    const storm = rain > 0.35, door = lay.tentDoors[this.tent];
    const sleep = { kind: 'sleep', x: door.x, z: door.z };
    if (this.role === 'woodcutter') {
      if (storm || between(hour, 23, 6.2)) return sleep;
      if (between(hour, 18.2, 23)) return { kind: 'sit', ...lay.seats[this.seat], x: lay.seats[this.seat].x, z: lay.seats[this.seat].z };
      return { kind: 'chop', x: lay.chop.x, z: lay.chop.z, fx: lay.chop.fx, fz: lay.chop.fz };
    }
    if (this.role === 'cook') {
      if (storm || between(hour, 23.5, 6)) return sleep;
      if (between(hour, 19, 23.5)) return { kind: 'sit', ...lay.seats[this.seat] };
      return { kind: 'tend', wps: lay.cook };
    }
    // vigía
    if (storm && between(hour, 6, 21)) return sleep;
    if (between(hour, 20, 22.5)) return { kind: 'sit', ...lay.seats[this.seat] };
    if (between(hour, 22.5, 5.5)) return storm ? sleep : { kind: 'watch', x: lay.watch.x, z: lay.watch.z, fx: lay.watch.fx, fz: lay.watch.fz };
    return { kind: 'patrol', wps: lay.patrol };
  }

  _go(x, z, speed, dt, free = false) {
    const p = this.position, dx = x - p.x, dz = z - p.z, d = Math.hypot(dx, dz);
    if (d > 0.08) {
      this.heading = dampAngle(this.heading, Math.atan2(dx, dz), 6, dt);
      this.speed = damp(this.speed, d < 0.7 ? Math.min(speed, 0.9) : speed, 8, dt);
      p.x += Math.sin(this.heading) * this.speed * dt; p.z += Math.cos(this.heading) * this.speed * dt;
      if (!free) this.game.world.pushOut(p, 0.35, true);
      p.y = this.game.world.getHeightAt(p.x, p.z);
    } else this.speed = damp(this.speed, 0, 8, dt);
    return d;
  }
  _sync() { this.root.position.copy(this.position); this.root.rotation.set(0, this.heading, 0); }

  update(dt) {
    const g = this.game, hour = g.world.time.hour, rain = g.world.weather.rain, lay = this.camp.layout, pp = g.player.position;
    const goal = this._goal(hour, rain, lay), dPlayer = distXZ(pp, this.position);
    this.kind = goal.kind;
    let sitT = 0, chopT = 0, gestT = 0, moving = false;

    if (this.hidden) {   // durmiendo en la tienda
      if (goal.kind !== 'sleep') { this.hidden = false; this.active = true; this.root.visible = true; }
      else { this.root.visible = false; return; }
    }
    this.root.visible = dPlayer < this.viewDist;

    if (this.talking) { this.speed = damp(this.speed, 0, 8, dt); this.heading = dampAngle(this.heading, Math.atan2(pp.x - this.position.x, pp.z - this.position.z), 5, dt); gestT = 1; }
    else switch (goal.kind) {
      case 'sleep': {
        const d = this._go(goal.x, goal.z, 1.8, dt, true); moving = true;
        if (d < 0.5) { this.hidden = true; this.active = false; this.root.visible = false; this.speed = 0; return; }
        break;
      }
      case 'sit': {
        const d = distXZ(this.position, goal);
        if (d > 0.25) { this._go(goal.x, goal.z, 1.5, dt, d < 1.2); moving = true; }
        else { this.speed = damp(this.speed, 0, 8, dt); this.heading = dampAngle(this.heading, Math.atan2(goal.fx - this.position.x, goal.fz - this.position.z), 4, dt); sitT = 1; }
        break;
      }
      case 'chop': {
        const d = this._go(goal.x, goal.z, 1.5, dt); moving = d > 0.4;
        if (!moving) { this.heading = dampAngle(this.heading, Math.atan2(goal.fx - this.position.x, goal.fz - this.position.z), 6, dt); chopT = 1; }
        break;
      }
      case 'watch': {
        const d = this._go(goal.x, goal.z, 1.5, dt); moving = d > 0.4;
        if (!moving) this.heading = dampAngle(this.heading, Math.atan2(goal.fx - this.position.x, goal.fz - this.position.z) + Math.sin(g.elapsed * 0.3 + this.seed) * 0.8, 2, dt);
        break;
      }
      default: {   // 'tend' (cocinar) y 'patrol' recorren puntos con pausas
        if (this.pause > 0) {
          this.pause -= dt; this.speed = damp(this.speed, 0, 8, dt);
          if (goal.kind === 'tend') { gestT = 0.9; const f = lay.seats[0]; this.heading = dampAngle(this.heading, Math.atan2(f.fx - this.position.x, f.fz - this.position.z), 3, dt); }
          else this.heading += Math.sin(g.elapsed * 0.7 + this.seed) * dt * 0.6;
          break;
        }
        const w = goal.wps[this.wp % goal.wps.length], d = this._go(w.x, w.z, goal.kind === 'patrol' ? 1.7 : 1.3, dt); moving = true;
        if (d < 0.6) { this.wp++; this.pause = goal.kind === 'tend' ? rr(5, 11) : rr(2, 5); }
      }
    }
    if (!moving && goal.kind !== 'sit' && goal.kind !== 'chop') this.speed = damp(this.speed, 0, 8, dt);
    // cercanía del jugador: se vuelve a mirarlo si no está ocupado
    if (!this.talking && dPlayer < 4 && (goal.kind === 'tend' || goal.kind === 'patrol' || goal.kind === 'watch') && !moving) this.heading = dampAngle(this.heading, Math.atan2(pp.x - this.position.x, pp.z - this.position.z), 3, dt);

    this.sit = damp(this.sit, sitT, 6, dt); this.chop = damp(this.chop, chopT, 8, dt); this.gesture = damp(this.gesture, gestT, 5, dt);
    if (this.axe) this.axe.visible = this.chop > 0.2;
    this._sync();
    if (this.root.visible) {
      const sp = this.speed, cyc = 2.5 + clamp((sp - 3.3) / 3.7, 0, 1) * 1.1;
      this.phase += dt * (sp / cyc) * Math.PI * 2;
      poseHumanoid(this.model, {
        phase: this.phase, speed: clamp(sp / 3.3, 0, 1), run: clamp((sp - 3.3) / 3.7, 0, 1), sit: this.sit, chop: this.chop, gesture: this.gesture,
        t: g.elapsed + this.seed, headYaw: dPlayer < 6 && !this.chop ? clamp(wrapAngle(Math.atan2(pp.x - this.position.x, pp.z - this.position.z) - this.heading), -0.8, 0.8) : 0,
        rifleAim: 0, aim: 0,
      });
    }
  }
}

export { Companion };
