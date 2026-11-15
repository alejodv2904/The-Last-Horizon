// Gestor de pistoleros: campamentos de bandidos, agentes de la ley y emboscadas.
// Responsabilidades: ciclo de vida y LOD de IA, "fichas de disparo" (máx. 2 tiradores simultáneos), cobertura,
// ladridos (frases), botín, honor, recompensas y reaparición.
import * as THREE from 'three';
import { CONFIG } from '../core/Config.js';
import { distXZ } from '../core/MathUtils.js';
import { Gunman } from './Gunman.js';
import { Projectiles } from './Projectiles.js';
import { AmbushDirector } from './AmbushDirector.js';

const B = CONFIG.BANDIT;
const NAMES = ['Cutter', 'Hank Moss', 'Ramón Vega', 'Dutch Colby', 'Sparrow', 'Jebediah', 'Lefty Rudd', 'Tuco', 'Mac Garrity', 'Joaquín', 'Pete Rawls', 'El Tuerto'];
const PALS = ['bandit1', 'bandit2', 'bandit3'];
const rr = (a, b) => a + Math.random() * (b - a);
const _v = new THREE.Vector3();

class BanditSystem {
  constructor(game) {
    this.game = game; this.data = game.townData;
    this.projectiles = new Projectiles(game);
    this.gunmen = []; this.camps = new Map(); this.tokens = [];
    this.law = null; this.barkCd = 0; this.nameIdx = 0;
    this._ctx = { pp: null, dist: 0, night: 0, playerDead: false, animate: true };
    game.world.banditCamps.forEach((wc) => this._initCamp(wc));
    this.ambush = new AmbushDirector(game, this);
    game.bus.on('gunshot', (e) => this._onShot(e));
  }

  addGunman(def) { const g = new Gunman(this.game, this, def); g.active = def.active !== false; this.gunmen.push(g); return g; }

  _initCamp(wc) {
    const def = wc.def, members = [];
    def.members.forEach((kind, i) => {
      const spot = wc.idleSpots[i], leader = kind === 'leader';
      members.push(this.addGunman({
        id: `${def.id}_${i}`, name: leader ? 'Boone «Dos Dedos» Hargrove' : NAMES[this.nameIdx++ % NAMES.length], faction: 'bandit', role: kind, leader,
        palette: leader ? 'leader' : PALS[i % 3], x: spot.x, z: spot.z, spot, look: wc.center, camp: def.id, skill: leader ? 0.85 : undefined,
      }));
    });
    this.camps.set(def.id, { def, world: wc, members, lastKill: -1e9 });
  }
  campMembers(id) { const c = this.camps.get(id); return c ? c.members : []; }
  // Reanima a los muertos de un campamento (al aceptar un contrato). Devuelve false si el jugador está demasiado cerca.
  repopulate(id, includeLeader) {
    const c = this.camps.get(id); if (!c) return false;
    if (distXZ(c.world.center, this.game.player.position) < 110) return false;
    c.members.forEach((m) => { if (!m.alive && (!m.leader || includeLeader)) { m.spawn(m.def.x, m.def.z); } });
    return true;
  }

  /* ---------- servicios para los pistoleros ---------- */
  coversFor(g) {
    const base = g.faction === 'law' ? this.game.world.town.covers : g.campId === 'ambush' ? this.ambush.covers : (this.camps.get(g.campId)?.world.cover || []);
    const t = this.game.elapsed, c = g._cc;
    if (c && t - c.t < 4 && distXZ(g.position, c) < 15) return c.list;
    const list = base.slice();
    this.game.world.collectCover(g.position.x, g.position.z, 45, list);
    g._cc = { t, x: g.position.x, z: g.position.z, list };
    return list;
  }
  requestToken(g, dur = 2) {
    const t = this.game.elapsed;
    this.tokens = this.tokens.filter((k) => k.until > t && k.g.alive);
    const mine = this.tokens.find((k) => k.g === g);
    if (mine) { mine.until = Math.max(mine.until, t + dur); return true; }
    if (this.tokens.length >= B.MAX_SHOOTERS) return false;
    this.tokens.push({ g, until: t + dur });
    return true;
  }
  releaseToken(g) { this.tokens = this.tokens.filter((k) => k.g !== g); }
  releaseAllTokens() { this.tokens.length = 0; }
  alertGroup(g, pos) {
    for (const o of this.gunmen) if (o !== g && o.active && o.alive && o.faction === g.faction && o.campId === g.campId && distXZ(o.position, g.position) < 48) o.alertTo(pos);
  }
  aliveAllies(g) { let n = 0; for (const o of this.gunmen) if (o !== g && o.active && o.alive && o.campId === g.campId && o.faction === g.faction) n++; return n; }
  hostileNear(center, r) { return this.gunmen.some((g) => g.active && g.alive && g.faction === 'bandit' && g.inCombat && distXZ(g.position, center) < r); }
  bark(g, kind, force = false) {
    const t = this.game.elapsed;
    if (!force && t < this.barkCd) return;
    if (distXZ(g.position, this.game.player.position) > 48) return;
    const list = (g.faction === 'law' ? this.data.law : this.data.bandit)[kind];
    if (!Array.isArray(list)) return;
    this.barkCd = t + 2.8;
    this.game.ui.bark(g.name, list[Math.floor(Math.random() * list.length)]);
  }
  canSurrender(g) { return this.game.bounties.canCapture(g); }
  // El prisionero te sigue; si se queda muy atrás y no se ve, se recoloca cerca (nunca delante de la cámara).
  leashCaptive(g, ctx) {
    if (ctx.dist < 48) return;
    const cam = this.game.camera, fwd = cam.getWorldDirection(_v);
    const behind = (g.position.x - cam.position.x) * fwd.x + (g.position.z - cam.position.z) * fwd.z < 0;
    if (behind || ctx.dist > 140) {
      const p = this.game.player, h = p.riding ? this.game.horse.heading : p.heading;
      g.position.x = p.position.x - Math.sin(h) * 9; g.position.z = p.position.z - Math.cos(h) * 9;
      g.position.y = this.game.world.getHeightAt(g.position.x, g.position.z); g.speed = 0;
    }
  }

  /* ---------- eventos de combate ---------- */
  onGunmanHit(g, source, wasSurrendered) {
    if (g.faction === 'law' && source === 'player') this.law.onLawHit(g, false);
  }
  onGunmanKilled(g, source, wasSurrendered) {
    const game = this.game;
    this.releaseToken(g);
    if (g.faction === 'law') { this.law.onLawHit(g, true); return; }
    if (wasSurrendered) this.law.reportCrime('executeCaptive', g.position);
    else if (source === 'player') game.honor.add(game.honor.deed('banditKilled'), 'Bandido abatido');
    const loot = [];
    if (g.leader) { loot.push({ kind: 'money', amount: Math.round(rr(8, 14) * 100) / 100 }, { kind: 'item', id: 'tonic_strong', n: 1 }, { kind: 'item', id: 'ammo', n: 10 }); }
    else {
      loot.push({ kind: 'money', amount: Math.round(rr(0.6, 3.6) * 100) / 100 });
      if (Math.random() < 0.65) loot.push({ kind: 'item', id: 'ammo', n: 3 + Math.floor(Math.random() * 6) });
      if (Math.random() < 0.3) loot.push({ kind: 'item', id: 'tonic', n: 1 });
    }
    const proof = game.bounties.proofFor(g);
    if (proof && source === 'player' && !wasSurrendered) loot.push({ kind: 'item', id: proof, n: 1 });
    game.loot.drop(g.position, loot);
    const camp = this.camps.get(g.campId); if (camp) camp.lastKill = game.elapsed;
    game.bus.emit('bandit:killed', g);
  }

  _onShot(e) {
    if (e.source === 'enemy') return;
    for (const g of this.gunmen) if (g.active && g.alive && g.faction === 'bandit' && distXZ(g.position, e.position) < 95) g.alertTo(e.position, 0.4 + Math.random() * 0.9);
  }

  // Cajas de impacto para los disparos del jugador (se actualizan solo las matrices de los candidatos).
  getHitboxes() {
    const out = [];
    for (const g of this.gunmen) {
      if (!g.active || !g.alive || g.state === 'jailed' || !g.root.visible) continue;
      g.root.updateMatrixWorld(true); out.push(g.hitbox);
    }
    return out;
  }
  getNearestSurrendered(pos, r) {
    let best = null, bd = r;
    for (const g of this.gunmen) { if (!g.active || g.state !== 'surrender') continue; const d = distXZ(g.position, pos); if (d < bd) { bd = d; best = g; } }
    return best;
  }

  update(dt) {
    const game = this.game, pp = game.player.position, ctx = this._ctx;
    ctx.pp = pp; ctx.night = game.world.time.state.night; ctx.playerDead = game.mode === 'dead';
    this.projectiles.update(dt);
    let active = 0;
    for (const g of this.gunmen) {
      if (!g.active) continue;
      const d = distXZ(g.position, pp);
      g.root.visible = d < B.VISIBLE_RADIUS && !(g.state === 'dead' && g.deadTime > 40);
      if (d > B.ACTIVE_RADIUS && g.alive && !g.inCombat) continue;
      active++; ctx.dist = d; ctx.animate = d < 110 && g.root.visible;
      g.update(dt, ctx);
    }
    this.activeCount = active;
    // reaparición de campamentos (solo si el jugador está lejos y pasó un buen rato)
    for (const c of this.camps.values()) {
      if (game.elapsed - c.lastKill < B.RESPAWN_SECONDS || distXZ(c.world.center, pp) < 170) continue;
      c.members.forEach((m) => { if (!m.alive && m.deadTime > 30 && (!m.leader || !game.bounties.leaderRetired)) m.spawn(m.def.x, m.def.z); });
    }
    this.law.respawnIfFar();
    this.ambush.update(dt);
  }
}

export { BanditSystem };
