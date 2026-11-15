// Vida del pueblo: ciudadanos, saludos según Honor, reacciones ante armas y disparos, testigos de delitos,
// cofre robable, saqueo de cadáveres y colocación de los PNJ de historia según las decisiones del jugador.
// Solo se simula si el jugador está a menos de 130 m del pueblo (LOD): fuera de ahí todo queda congelado y oculto.
import * as THREE from 'three';
import { distXZ } from '../core/MathUtils.js';
import { Citizen } from '../entities/Citizen.js';

const rr = (a, b) => a + Math.random() * (b - a);

class TownLife {
  constructor(game, town, data) {
    this.game = game; this.town = town; this.data = data;
    this.citizens = data.citizens.map((def) => new Citizen(game, this, def));
    this.panic = 0; this.panicPos = new THREE.Vector3(); this.barkCd = 0; this.greetBarkCd = 4;
    this.strongboxCd = 0; this.lidOpen = 0; this.near = false;
    this._ctx = { pp: null, dist: 0, weaponDrawn: false, animate: true, rain: 0 };
    game.bus.on('gunshot', (e) => this._onShot(e));
  }

  _onShot(e) {
    if (distXZ(e.position, this.town.center) > this.town.radius + 25) return;
    this.panic = 16; this.panicPos.copy(e.position);
  }
  pickDoor(from, threat) {
    let best = null, bs = 1e9;
    for (const d of this.town.doors) {
      const dx = d.x - from.x, dz = d.z - from.z, dd = Math.hypot(dx, dz), tx = threat.x - from.x, tz = threat.z - from.z, tl = Math.hypot(tx, tz) || 1;
      const toward = (dx * tx + dz * tz) / (dd * tl + 1e-6);   // 1 = la puerta está en dirección al peligro
      const s = dd + Math.max(0, toward) * 30;
      if (s < bs) { bs = s; best = d; }
    }
    return best;
  }
  calm() { return this.panic <= 0; }
  weaponDrawn() { const p = this.game.player; return p.isAiming || p.readyTimer > 0.2; }

  onCitizenKilled(c, source) {
    if (source === 'player') this.game.law.reportCrime('killCitizen', c.position, c);
    this.panic = 20; this.panicPos.copy(c.position);
  }
  hasWitness(pos, ignore) {
    const w = this.game.world;
    for (const c of this.citizens) {
      if (!c.alive || c === ignore || c.hidden) continue;
      if (distXZ(c.position, pos) < 30 && !w.lineBlocked(c.position.x, c.position.y + 1.5, c.position.z, pos.x, pos.y + 1.4, pos.z)) return true;
    }
    return false;
  }
  // frases con enfriamiento global (no saturan la pantalla)
  shoutBy(c, kind) {
    const t = this.game.elapsed; if (t < this.barkCd) return;
    const list = this.data[kind]; if (!Array.isArray(list) || distXZ(c.position, this.game.player.position) > 40) return;
    this.barkCd = t + 3.2; this.game.ui.bark(c.name, list[Math.floor(Math.random() * list.length)]);
  }
  shout(kind) {
    let best = null, bd = 40;
    for (const c of this.citizens) { if (!c.alive || c.hidden) continue; const d = distXZ(c.position, this.game.player.position); if (d < bd) { bd = d; best = c; } }
    if (best) this.shoutBy(best, kind);
  }

  getHitboxes() {
    if (!this.near) return [];
    const out = [];
    for (const c of this.citizens) { if (!c.alive || c.hidden) continue; c.root.updateMatrixWorld(true); out.push(c.hitbox); }
    return out;
  }
  nearestCitizen(pos, r) {
    let best = null, bd = r;
    for (const c of this.citizens) { if (!c.alive || c.hidden) continue; const d = distXZ(c.position, pos); if (d < bd) { bd = d; best = c; } }
    return best;
  }
  nearestCorpse(pos, r) {
    for (const c of this.citizens) if (!c.alive && !c.looted && c.deathT >= 1 && distXZ(c.position, pos) < r) return c;
    return null;
  }
  lootCorpse(c) {
    const g = this.game, amount = Math.round(rr(0.5, 4) * 100) / 100;
    c.looted = true; g.inventory.addMoney(amount); g.ui.notify(`+$${amount.toFixed(2)}`, 'Saqueaste un cadáver'); g.audio.playCash();
    g.law.reportCrime('lootBody', c.position, c);
  }
  greetCitizen(c) {
    const g = this.game;
    c.greet(); g.audio.playUI();
    if (g.honor.canGreet(c.id)) g.honor.greeted(c.id);
    g.ui.bark(c.name, g.honor.reply());
  }

  /* ---- cofre del tendero: robo con testigos ---- */
  get strongboxReady() { return this.strongboxCd <= 0; }
  robStrongbox() {
    const g = this.game, amount = Math.round(rr(14, 26) * 100) / 100;
    this.strongboxCd = 300; this.lidOpen = 6;
    g.inventory.addMoney(amount); g.ui.notify(`+$${amount.toFixed(2)}`, 'Forzaste el cofre de la tienda'); g.audio.playCash();
    g.law.reportCrime('robbery', g.player.position);
    this.panic = Math.max(this.panic, 8); this.panicPos.copy(g.player.position);
  }

  // PNJ de historia: se mueven o desaparecen según las decisiones (banderas) del jugador.
  applyFlag(f) {
    const npc = (id) => this.game.npcs.find((n) => n.id === id), s = this.town.spots;
    if (f === 'tomas_turned') { const t = npc('tomas'); if (t) t.moveTo(s.tomasCell.x, s.tomasCell.z, s.tomasCell.x, s.tomasCell.z + 10); }
    else if (f === 'tomas_freed' || f === 'tomas_paid') npc('tomas')?.setActive(false);
    else if (f === 'pruitt_paid' || f === 'pruitt_scared') npc('pruitt')?.setActive(false);
    else if (f === 'pruitt_bribed') npc('clara')?.setActive(false);
  }

  update(dt) {
    const g = this.game, pp = g.player.position, ctx = this._ctx, d = distXZ(pp, this.town.center);
    this.panic = Math.max(0, this.panic - dt); this.strongboxCd = Math.max(0, this.strongboxCd - dt);
    this.near = d < 130;
    // tapa del cofre
    this.lidOpen = Math.max(0, this.lidOpen - dt);
    const lid = this.town.strongbox.lid; lid.rotation.x = -1.25 * Math.min(1, this.lidOpen / 0.4);
    lid.visible = this.near; this.town.strongbox.base.visible = this.near;
    for (const c of this.citizens) {
      if (!this.near) { c.root.visible = false; continue; }
      c.root.visible = c.state !== 'inside' && !(c.state === 'dead' && c.deadTime > 60);
      if (c.state === 'dead' && c.deadTime > 360 && d > 100) c.respawn();
    }
    if (!this.near) return;
    ctx.pp = pp; ctx.weaponDrawn = this.weaponDrawn(); ctx.animate = d < 110; ctx.rain = g.world.weather.rain;
    this.greetBarkCd -= dt;
    for (const c of this.citizens) {
      ctx.dist = distXZ(c.position, pp);
      c.update(dt, ctx);
      // saludo espontáneo según tu honor (si no vas armado ni te buscan)
      if (this.greetBarkCd <= 0 && c.alive && !c.hidden && c.greetCd <= 0 && ctx.dist < 6 && !ctx.weaponDrawn && c.state !== 'flee' && c.state !== 'cower' && this.panic <= 0 && g.mode === 'explore') {
        c.greetCd = rr(40, 70); this.greetBarkCd = 5; g.ui.bark(c.name, g.law.level > 0 ? this.data.wanted[0] : g.honor.greeting());
      }
    }
  }
}

export { TownLife };
