// Ley y "Se busca": recompensa por la cabeza del jugador, testigos, agentes (sheriff + 2 ayudantes) y arresto.
//
//  - Un delito (matar a un inocente, robar, agredir a la ley…) siempre resta Honor; solo suma recompensa si lo ve un testigo
//    (un agente o un ciudadano con línea de visión cercana).
//  - Nivel 1-2: los agentes intentan ARRESTAR (se acercan, avisan; si te quedas quieto y sin apuntar, te detienen).
//    Nivel 3, o si disparas/apuntas a un agente: fuego letal (comparten la IA táctica de los bandidos, con cobertura del pueblo).
//  - La recompensa se paga en el tablón, o se diluye si nadie te ve durante un rato.
import { CONFIG } from '../core/Config.js';
import { distXZ } from '../core/MathUtils.js';

class LawSystem {
  constructor(game, bandits, town, data) {
    this.game = game; this.bandits = bandits; this.town = town; this.data = data;
    this.bounty = 0; this.level = 0; this.lethal = false; this.unseenT = 0; this.warnT = 0; this.warnCount = 0; this.disturbCd = 0; this.threatT = 0;
    this.agents = [];
    const s = town.spots;
    const mk = (id, name, palette, role, spot, patrol, extra = {}) => bandits.addGunman({
      id, name, faction: 'law', role, palette, x: spot.x, z: spot.z, spot, patrol, hp: role === 'sheriff' ? 140 : 100, skill: role === 'sheriff' ? 0.8 : 0.65, camp: 'town', ...extra,
    });
    this.sheriff = mk('sheriff', 'Sheriff Amos Reed', 'sheriff', 'sheriff', s.sheriff, s.sheriffPatrol, { interaction: 'dialogue', facing: 0.0 });
    this.agents.push(this.sheriff,
      mk('deputy1', 'Ayudante Cole', 'deputy', 'deputy', s.deputyPatrolA[0], s.deputyPatrolA),
      mk('deputy2', 'Ayudante Boyd', 'deputy', 'deputy', s.deputyPatrolB[0], s.deputyPatrolB));
    game.bus.on('gunshot', (e) => this._onShot(e));
  }
  get active() { return this.level > 0; }

  _levelFor(b) { const L = this.data.levels; return b <= 0 ? 0 : b < L[1] ? 1 : b < L[2] ? 2 : 3; }
  _refresh() {
    const old = this.level;
    this.level = this._levelFor(this.bounty);
    if (this.level >= 3) this.lethal = true;
    if (this.level === 0) { this.lethal = false; this.agents.forEach((a) => { if (a.alive) a.mode = 'peace'; }); }
    else this.agents.forEach((a) => { if (a.alive) a.mode = this.lethal ? 'lethal' : 'arrest'; });
    if (this.level !== old) {
      this.game.ui.setWanted(this.level, Math.round(this.bounty));
      if (this.level > old) this.game.audio.playWanted();
      if (this.level === 0 && old > 0) this.game.ui.notify('Ya no te buscan', 'La ley te ha perdido el rastro.');
    } else this.game.ui.setWanted(this.level, Math.round(this.bounty));
  }
  addBounty(amount, reason = '') {
    if (amount <= 0) return;
    const wasZero = this.bounty <= 0;
    this.bounty += amount; this.unseenT = 0;
    if (wasZero) this.game.ui.notify('SE BUSCA', reason ? `${reason} · recompensa $${Math.round(this.bounty)}` : `Recompensa $${Math.round(this.bounty)}`);
    this._refresh();
  }
  clear(note = true) { this.bounty = 0; this.lethal = false; this.unseenT = 0; this._refresh(); if (note) this.game.ui.notify('Recompensa pagada', 'Tu nombre queda limpio.'); }
  payBounty() {
    const g = this.game, due = Math.ceil(this.bounty);
    if (due <= 0) return false;
    if (g.inventory.money < due) { g.ui.notify('No te alcanza', `La recompensa es de $${due}`); return false; }
    g.inventory.addMoney(-due); this.clear(); g.audio.playCash(); return true;
  }

  // ¿Alguien con vista despejada presencia el delito en pos?
  hasWitness(pos, ignore = null) {
    const w = this.game.world, y = pos.y + 1.4;
    for (const a of this.agents) {
      if (!a.alive || a === ignore || a.state === 'jailed') continue;
      if (distXZ(a.position, pos) < 55 && !w.lineBlocked(a.position.x, a.position.y + 1.5, a.position.z, pos.x, y, pos.z)) return true;
    }
    const life = this.game.townLife;
    return life ? life.hasWitness(pos, ignore) : false;
  }
  // kind: clave de data.crimes
  reportCrime(kind, pos, ignore = null) {
    const c = this.data.crimes[kind]; if (!c) return;
    if (c.honor) this.game.honor.add(c.honor, c.label);
    if (c.bounty > 0 && this.hasWitness(pos, ignore)) {
      this.addBounty(c.bounty, c.label);
      if (this.game.townLife) this.game.townLife.shout('witness');
    }
  }

  // El jugador ataca a un agente: la víctima siempre lo sabe, y todos pasan a fuego letal.
  onLawHit(agent, killed) {
    const c = this.data.crimes[killed ? 'killLaw' : 'shootLaw'];
    if (killed || !this.lethal) {
      this.game.honor.add(c.honor, c.label);
      this.lethal = true; this.addBounty(c.bounty, c.label);
    }
    this.lethal = true; this.unseenT = 0; this._refresh();
    this.agents.forEach((a) => { if (a.alive && a !== agent) a.alertTo(this.game.player.position, 0.2); });
  }
  _onShot(e) {
    if (e.source === 'enemy' || this.game.mode === 'dead') return;
    const t = this.town;
    if (distXZ(e.position, t.center) > t.radius || this.disturbCd > 0) return;
    if (this.bandits.hostileNear(t.center, t.radius + 20)) return;   // un tiroteo contra bandidos en el pueblo no es alteración del orden
    this.disturbCd = 7;
    const near = this.agents.find((a) => a.alive && distXZ(a.position, e.position) < 45);
    if (!near) return;
    this.warnCount++;
    if (this.warnCount >= 2) { this.reportCrime('disturb', this.game.player.position); this.warnCount = 0; }
    else this.bandits.bark(near, 'warn', true);
  }

  update(dt) {
    const g = this.game, p = g.player;
    this.disturbCd = Math.max(0, this.disturbCd - dt);
    // Apuntar con el arma a la gente dentro del pueblo
    const inTown = distXZ(p.position, this.town.center) < this.town.radius - 4;
    if (inTown && p.isAiming && g.mode === 'explore' && !this.bandits.hostileNear(this.town.center, this.town.radius + 20)) {
      this.threatT += dt;
      const near = this.agents.find((a) => a.alive && distXZ(a.position, p.position) < 30);
      if (near && this.threatT > 3.2) { this.threatT = -20; this.reportCrime('threaten', p.position); this.bandits.bark(near, 'warn', true); }
    } else this.threatT = Math.min(0, this.threatT + dt) ;
    if (this.level <= 0) return;
    // ¿Alguien te ve? Si pasan 75 s sin ser visto, la recompensa se diluye a la mitad.
    let seen = false;
    for (const a of this.agents) if (a.alive && a.hostile && (a.state === 'arrest' || a.inCombat) ) { seen = true; break; }
    if (!seen && distXZ(p.position, this.town.center) > this.town.radius + 25) this.unseenT += dt; else this.unseenT = 0;
    if (this.unseenT > 75) { this.unseenT = 0; this.bounty = this.bounty < 12 ? 0 : this.bounty / 2; this._refresh(); }
    if (g.mode === 'dead') { this.bounty = 0; this._refresh(); }
  }

  // Los agentes te alcanzan y te detienen: multa, noche en el calabozo, recompensa borrada.
  arrest(agent) {
    const g = this.game;
    if (g.mode !== 'explore') return;
    const fine = Math.min(g.inventory.money, Math.ceil(this.bounty));
    g.setMode('arrested');
    g.ui.setFade(true, 'ARRESTADO');
    this.bandits.releaseAllTokens();
    setTimeout(() => {
      if (fine > 0) g.inventory.addMoney(-fine);
      this.bounty = 0; this.lethal = false; this._refresh();
      const spot = this.town.spots.jailExit;
      g.player.respawnAt(spot.x, spot.z);
      g.player.heading = Math.PI; g.player.yaw = Math.PI;
      g.world.time.hour = (g.world.time.hour + 8) % 24;
      this.agents.forEach((a) => { if (a.alive) { a.mode = 'peace'; a.setState('idle'); a.spawn(a.def.x, a.def.z); } });
      g.world.chunks.update(g.player.position, true);
      g.ui.setFade(false); g.setMode('explore');
      g.ui.notify(this.data.law.arrested, fine > 0 ? `Pagaste una multa de $${fine}. ${this.data.law.released}` : this.data.law.released);
      g.save.save();
    }, 2200);
  }
  respawnIfFar() {
    const p = this.game.player.position;
    this.agents.forEach((a) => { if (!a.alive && a.deadTime > 360 && distXZ(p, this.town.center) > 120) { a.spawn(a.def.x, a.def.z); a.mode = this.level > 0 ? (this.lethal ? 'lethal' : 'arrest') : 'peace'; } });
  }
  toJSON() { return { bounty: this.bounty }; }
  fromJSON(d) { if (d && typeof d.bounty === 'number') { this.bounty = d.bounty; this.lethal = this._levelFor(d.bounty) >= 3; this._refresh(); } }
}

export { LawSystem };
